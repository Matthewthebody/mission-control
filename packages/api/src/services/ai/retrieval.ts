import type { PoolClient } from "pg";
import { config } from "../../config.js";
import type { AuthUser } from "../../types/auth.js";
import {
  buildVersionEligibilitySql,
  SEGMENT_ELIGIBILITY_SQL,
  type KnowledgeMode
} from "../knowledge/knowledgeGovernance.js";
import { cosineSimilarity, resolveEmbeddingProvider } from "./providers/embedding.js";

// Ask Bailey hybrid retrieval (charter H1-B/H1-D).
//
// The eligibility + authorization predicate (buildVersionEligibilitySql +
// SEGMENT_ELIGIBILITY_SQL) is composed INSIDE every SQL path here — lexical,
// semantic, and the candidate re-fetch. Nothing ineligible reaches ranking,
// scoring, the provider, or the trace's content fields.
//
// Signals, combined into one configurable score:
//   lexical rank (english-stemmed FTS) · matched-concept ratio · semantic
//   cosine similarity · exact phrase · heading match · source authority ·
//   effective-date freshness. Context labels join the query terms, so the
//   current record biases retrieval without ever widening authorization.
//
// Conservative-by-design guards:
//   - a multi-concept question must match >= ASK_BAILEY_MIN_MATCHED_CONCEPTS
//     distinct concepts lexically, OR clear the semantic similarity gate —
//     one incidental shared word can never support an answer;
//   - a configurable minimum evidence score below which the pipeline returns
//     an honest no-answer rather than a weak citation;
//   - a per-source segment cap keeps enough source diversity for conflict
//     detection;
//   - no caching across users, modes, or source versions: every ask runs the
//     predicate fresh.

export type RetrievedRow = {
  segment_id: string;
  source_version_id: string;
  source_id: string;
  source_title: string;
  source_type: string;
  authority_class: string;
  locator_label: string | null;
  heading: string | null;
  content: string;
  start_seconds: number | null;
  end_seconds: number | null;
  resource_library_item_id: string | null;
  media_url: string | null;
  approved_at: string | null;
  rank: number;
  matched_concepts: number;
  semantic_similarity: number;
  score: number;
};

export type QueryConcept = {
  term: string;
  variants: string[];
  fromSynonym: boolean;
  typoEligible: boolean;
};

export type RetrievalTrace = {
  question: string;
  normalized_terms: string[];
  concepts: Array<{ term: string; variants: string[]; from_synonym: boolean }>;
  min_matched_concepts_required: number;
  embedding: { provider: string; model: string; used: boolean; fallback_reason: string | null };
  lexical_candidates: Array<{ segment_id: string; matched_concepts: number; rank: number }>;
  semantic_candidates: Array<{ segment_id: string; similarity: number }>;
  scored: Array<{ segment_id: string; score: number; selected: boolean; excluded_reason: string | null }>;
  ineligible_matches: Array<{ segment_id: string; reasons: string[] }>;
  thresholds: { min_evidence_score: number; semantic_min_similarity: number };
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "from", "by",
  "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "could", "should",
  "would", "will", "have", "has", "had", "how", "what", "when", "where", "why", "who", "which",
  "i", "we", "you", "it", "they", "my", "our", "your", "me", "us", "if", "then", "than",
  "this", "that", "these", "those", "there", "here", "not", "no", "so", "as", "about", "into",
  "okay", "ok", "please"
]);

export const AUTHORITY_RANK: Record<string, number> = {
  official_company_policy: 6,
  approved_sop: 5,
  approved_training: 4,
  approved_visual_standard: 4,
  approved_expert_guidance: 3,
  verified_current_workflow: 2,
  future_design_only: 1,
  historical_only: 1
};

const MAX_CONCEPTS = 12;

export function normalizeQuestionToTerms(question: string, contextLabel: string | null): string[] {
  return [
    ...new Set(
      `${question} ${contextLabel ?? ""}`
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/[\s-]+/)
        .filter((term) => term.length >= 2 && !STOPWORDS.has(term))
    )
  ].slice(0, MAX_CONCEPTS);
}

function sanitizeLexeme(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

/** Expand terms through the company-owned, reviewer-audited synonym map. */
export async function expandConcepts(
  client: PoolClient,
  tenantId: string,
  terms: string[]
): Promise<QueryConcept[]> {
  if (terms.length === 0) return [];
  const { rows } = await client.query<{ term: string; expansion: string[] }>(
    `SELECT term, expansion FROM knowledge_synonym WHERE tenant_id = $1 AND term = ANY($2::text[])`,
    [tenantId, terms]
  );
  const synonymByTerm = new Map(rows.map((row) => [row.term, row.expansion]));
  return terms.map((term) => {
    const expansionWords = (synonymByTerm.get(term) ?? [])
      .flatMap((entry) => entry.toLowerCase().split(/\s+/))
      .map(sanitizeLexeme)
      .filter((word) => word.length >= 2);
    return {
      term,
      variants: [...new Set([sanitizeLexeme(term), ...expansionWords])].filter(Boolean),
      fromSynonym: expansionWords.length > 0,
      typoEligible: term.length >= 5
    };
  });
}

function conceptTsQuery(concept: QueryConcept): string {
  return concept.variants.join(" | ");
}

function normalizePhrase(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Retrieval.
// ---------------------------------------------------------------------------
export async function retrieveSegmentsHybrid(
  client: PoolClient,
  auth: AuthUser,
  mode: KnowledgeMode,
  question: string,
  contextLabel: string | null,
  options: { includeTrace?: boolean } = {}
): Promise<{ rows: RetrievedRow[]; trace: RetrievalTrace }> {
  const terms = normalizeQuestionToTerms(question, contextLabel);
  const trace: RetrievalTrace = {
    question,
    normalized_terms: terms,
    concepts: [],
    min_matched_concepts_required: 0,
    embedding: { provider: "none", model: "none", used: false, fallback_reason: null },
    lexical_candidates: [],
    semantic_candidates: [],
    scored: [],
    ineligible_matches: [],
    thresholds: {
      min_evidence_score: config.ASK_BAILEY_MIN_EVIDENCE_SCORE,
      semantic_min_similarity: config.ASK_BAILEY_SEMANTIC_MIN_SIMILARITY
    }
  };
  if (terms.length === 0) {
    return { rows: [], trace };
  }

  const concepts = await expandConcepts(client, auth.tenantId, terms);
  trace.concepts = concepts.map((concept) => ({
    term: concept.term,
    variants: concept.variants,
    from_synonym: concept.fromSynonym
  }));
  const requiredConcepts = Math.min(config.ASK_BAILEY_MIN_MATCHED_CONCEPTS, concepts.length);
  trace.min_matched_concepts_required = requiredConcepts;

  // ---- Lexical candidates (eligibility inside the SQL) --------------------
  const params: unknown[] = [auth.tenantId];
  const eligibility = buildVersionEligibilitySql(auth, mode, params);

  const conceptExpressions = concepts.map((concept) => {
    params.push(conceptTsQuery(concept));
    const queryParam = params.length;
    let expression = `(CASE WHEN seg.search_document @@ to_tsquery('english', $${queryParam}) THEN 1`;
    if (concept.typoEligible) {
      params.push(concept.term);
      const termParam = params.length;
      params.push(config.ASK_BAILEY_TYPO_SIMILARITY);
      const similarityParam = params.length;
      expression += ` WHEN strict_word_similarity($${termParam}, seg.content) >= $${similarityParam} THEN 1`;
    }
    expression += ` ELSE 0 END)`;
    return expression;
  });
  const matchedExpression = conceptExpressions.join(" + ");

  params.push(concepts.flatMap((concept) => concept.variants).join(" | "));
  const fullQueryParam = params.length;
  const phrase = normalizePhrase(question);
  params.push(phrase);
  const phraseParam = params.length;
  params.push(requiredConcepts);
  const requiredParam = params.length;
  params.push(config.ASK_BAILEY_MAX_RETRIEVED_SEGMENTS * 3);
  const lexicalLimitParam = params.length;

  const lexical = await client.query<RetrievedRow & { exact_phrase: boolean; heading_match: boolean }>(
    `SELECT * FROM (
       SELECT
         seg.id::text AS segment_id,
         v.id::text AS source_version_id,
         s.id::text AS source_id,
         s.title AS source_title,
         v.source_type,
         v.authority_class,
         seg.locator_label,
         seg.heading,
         seg.content,
         seg.start_seconds::float AS start_seconds,
         seg.end_seconds::float AS end_seconds,
         s.resource_library_item_id::text,
         item.file_url AS media_url,
         v.approved_at::text AS approved_at,
         ts_rank_cd(seg.search_document, to_tsquery('english', $${fullQueryParam}))::float AS rank,
         (${matchedExpression}) AS matched_concepts,
         (length($${phraseParam}) >= 8 AND position($${phraseParam} in lower(seg.content)) > 0) AS exact_phrase,
         (to_tsvector('english', coalesce(seg.heading, '')) @@ to_tsquery('english', $${fullQueryParam})) AS heading_match
       FROM knowledge_segment seg
       JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
       JOIN knowledge_source s ON s.id = v.source_id AND s.tenant_id = v.tenant_id
       LEFT JOIN resource_library_item item ON item.id = s.resource_library_item_id
       WHERE seg.tenant_id = $1
         AND ${eligibility}
         AND ${SEGMENT_ELIGIBILITY_SQL}
     ) candidates
     WHERE candidates.matched_concepts >= $${requiredParam}
     ORDER BY candidates.matched_concepts DESC, candidates.rank DESC
     LIMIT $${lexicalLimitParam}`,
    params
  );
  trace.lexical_candidates = lexical.rows.map((row) => ({
    segment_id: row.segment_id,
    matched_concepts: row.matched_concepts,
    rank: row.rank
  }));

  // ---- Semantic candidates (same predicate, vectors joined to segments) ---
  const provider = resolveEmbeddingProvider();
  trace.embedding.provider = provider.name;
  trace.embedding.model = provider.model;
  // Semantic-only admission is gated at max(config gate, the adapter's own
  // floor): the deterministic char-trigram adapter scores long unrelated
  // texts hot, so its floor sits in near-duplicate territory.
  const semanticGate = Math.max(config.ASK_BAILEY_SEMANTIC_MIN_SIMILARITY, provider.semanticGateFloor);
  trace.thresholds.semantic_min_similarity = semanticGate;
  const semanticById = new Map<string, number>();
  let semanticRows: Array<RetrievedRow & { exact_phrase: boolean; heading_match: boolean }> = [];

  const questionEmbedding = await provider.embed([question]);
  if (questionEmbedding.status !== "ok") {
    trace.embedding.fallback_reason = questionEmbedding.reason;
  } else {
    trace.embedding.used = true;
    const semanticParams: unknown[] = [auth.tenantId];
    const semanticEligibility = buildVersionEligibilitySql(auth, mode, semanticParams);
    semanticParams.push(provider.name);
    const providerParam = semanticParams.length;
    semanticParams.push(provider.model);
    const modelParam = semanticParams.length;
    const embeddings = await client.query<{ segment_id: string; embedding: number[] }>(
      `SELECT e.segment_id::text, e.embedding
       FROM knowledge_segment_embedding e
       JOIN knowledge_segment seg ON seg.id = e.segment_id AND seg.tenant_id = e.tenant_id
       JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
       JOIN knowledge_source s ON s.id = v.source_id AND s.tenant_id = v.tenant_id
       WHERE e.tenant_id = $1
         AND e.provider = $${providerParam} AND e.model = $${modelParam}
         AND e.status = 'completed'
         AND e.content_fingerprint = md5(seg.content)
         AND ${semanticEligibility}
         AND ${SEGMENT_ELIGIBILITY_SQL}
       LIMIT 2000`,
      semanticParams
    );
    const questionVector = questionEmbedding.vectors[0];
    const ranked = embeddings.rows
      .map((row) => ({ segment_id: row.segment_id, similarity: cosineSimilarity(questionVector, row.embedding) }))
      .filter((entry) => entry.similarity >= semanticGate)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, config.ASK_BAILEY_SEMANTIC_TOP_K);
    for (const entry of ranked) {
      semanticById.set(entry.segment_id, entry.similarity);
    }
    trace.semantic_candidates = ranked;

    const lexicalIds = new Set(lexical.rows.map((row) => row.segment_id));
    const semanticOnlyIds = ranked.map((entry) => entry.segment_id).filter((id) => !lexicalIds.has(id));
    if (semanticOnlyIds.length > 0) {
      const fetchParams: unknown[] = [auth.tenantId];
      const fetchEligibility = buildVersionEligibilitySql(auth, mode, fetchParams);
      fetchParams.push(semanticOnlyIds);
      const idsParam = fetchParams.length;
      const fetched = await client.query<RetrievedRow>(
        `SELECT
           seg.id::text AS segment_id,
           v.id::text AS source_version_id,
           s.id::text AS source_id,
           s.title AS source_title,
           v.source_type,
           v.authority_class,
           seg.locator_label,
           seg.heading,
           seg.content,
           seg.start_seconds::float AS start_seconds,
           seg.end_seconds::float AS end_seconds,
           s.resource_library_item_id::text,
           item.file_url AS media_url,
           v.approved_at::text AS approved_at
         FROM knowledge_segment seg
         JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
         JOIN knowledge_source s ON s.id = v.source_id AND s.tenant_id = v.tenant_id
         LEFT JOIN resource_library_item item ON item.id = s.resource_library_item_id
         WHERE seg.tenant_id = $1 AND seg.id = ANY($${idsParam}::uuid[])
           AND ${fetchEligibility}
           AND ${SEGMENT_ELIGIBILITY_SQL}`,
        fetchParams
      );
      semanticRows = fetched.rows.map((row) => ({
        ...row,
        rank: 0,
        matched_concepts: 0,
        exact_phrase: phrase.length >= 8 && row.content.toLowerCase().includes(phrase),
        heading_match: false
      }));
    }
  }

  // ---- Scoring, thresholds, caps ------------------------------------------
  const merged = [...lexical.rows, ...semanticRows];
  const scored = merged.map((row) => {
    const semantic = semanticById.get(row.segment_id) ?? 0;
    const lexicalNorm = Math.min(1, row.rank * 4);
    const matchedRatio = concepts.length === 0 ? 0 : row.matched_concepts / concepts.length;
    const authorityNorm = (AUTHORITY_RANK[row.authority_class] ?? 0) / 6;
    const ageDays = row.approved_at ? (Date.now() - new Date(row.approved_at).getTime()) / 86_400_000 : null;
    const freshness = ageDays === null ? 0.5 : Math.max(0, 1 - ageDays / 730);
    const score =
      0.3 * lexicalNorm +
      0.2 * matchedRatio +
      0.22 * semantic +
      0.1 * (row.exact_phrase ? 1 : 0) +
      0.06 * (row.heading_match ? 1 : 0) +
      0.07 * authorityNorm +
      0.05 * freshness;
    return { ...row, semantic_similarity: semantic, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const perSourceCount = new Map<string, number>();
  const selected: RetrievedRow[] = [];
  for (const row of scored) {
    let excludedReason: string | null = null;
    const supportedLexically = row.matched_concepts >= requiredConcepts;
    const supportedSemantically = row.semantic_similarity >= semanticGate;
    if (!supportedLexically && !supportedSemantically) {
      excludedReason = "below concept and semantic gates";
    } else if (row.score < config.ASK_BAILEY_MIN_EVIDENCE_SCORE) {
      excludedReason = "below minimum evidence score";
    } else if ((perSourceCount.get(row.source_id) ?? 0) >= config.ASK_BAILEY_MAX_SEGMENTS_PER_SOURCE) {
      excludedReason = "per-source segment cap";
    } else if (selected.length >= config.ASK_BAILEY_MAX_RETRIEVED_SEGMENTS) {
      excludedReason = "total candidate cap";
    }
    if (!excludedReason) {
      perSourceCount.set(row.source_id, (perSourceCount.get(row.source_id) ?? 0) + 1);
      selected.push(row);
    }
    trace.scored.push({
      segment_id: row.segment_id,
      score: Number(row.score.toFixed(4)),
      selected: !excludedReason,
      excluded_reason: excludedReason
    });
  }

  // ---- Trace-only diagnostic: WHY content was ineligible (ids + reason
  // codes only — no text, no titles, nothing protected) --------------------
  if (options.includeTrace) {
    const diagnosticParams: unknown[] = [auth.tenantId, concepts.flatMap((concept) => concept.variants).join(" | ")];
    const notEligibility = buildVersionEligibilitySql(auth, mode, diagnosticParams);
    const ineligible = await client.query<{
      segment_id: string;
      publication_status: string;
      authority_class: string;
      confidential: boolean;
      superseded: boolean;
      expired: boolean;
    }>(
      `SELECT seg.id::text AS segment_id, v.publication_status, v.authority_class, v.confidential,
              (v.superseded_by_version_id IS NOT NULL) AS superseded,
              (v.effective_until IS NOT NULL AND v.effective_until < CURRENT_DATE) AS expired
       FROM knowledge_segment seg
       JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
       WHERE seg.tenant_id = $1
         AND seg.search_document @@ to_tsquery('english', $2)
         AND NOT (${notEligibility})
       LIMIT 50`,
      diagnosticParams
    );
    trace.ineligible_matches = ineligible.rows.map((row) => {
      const reasons: string[] = [];
      if (row.publication_status !== "approved") reasons.push(`status:${row.publication_status}`);
      if (row.superseded) reasons.push("superseded");
      if (row.expired) reasons.push("expired");
      if (row.confidential) reasons.push("confidential");
      if (!(AUTHORITY_RANK[row.authority_class] > 1) && ["future_design_only", "historical_only", "observation_only", "raw_evidence"].includes(row.authority_class)) {
        reasons.push(`authority:${row.authority_class}`);
      }
      if (reasons.length === 0) reasons.push("scope");
      return { segment_id: row.segment_id, reasons };
    });
  }

  return { rows: selected, trace };
}
