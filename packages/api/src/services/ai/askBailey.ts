import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../../config.js";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { canViewRecords, withDepartmentContext } from "../policy/operationalAuthorization.js";
import { assertShootAccess } from "../shootAccess.js";
import { isKnowledgeReviewer, type KnowledgeMode } from "../knowledge/knowledgeGovernance.js";
import { resolveLanguageModelProvider } from "./providers/languageModel.js";
import type { LanguageModelProvider, RetrievedSegmentForModel } from "./providers/types.js";
import {
  AUTHORITY_RANK,
  retrieveSegmentsHybrid,
  type RetrievalTrace,
  type RetrievedRow
} from "./retrieval.js";

// Ask Bailey — the answer pipeline (architecture record §4, D2/D5/D6/D7).
//
// Authorization happens BEFORE retrieval: the eligibility+scope predicate is
// part of the search SQL, so ineligible or unauthorized content never reaches
// ranking, the provider, or the client. Citations are assembled server-side
// from database rows; a provider-invented segment id is rejected and logged.
// The provider never controls authorization and never receives content the
// caller could not read directly.

export type AskBaileyContextInput = {
  job_id?: string | null;
  shoot_id?: string | null;
  organization_id?: string | null;
};

type ContextEnvelope = {
  kind: "job" | "shoot" | "organization";
  id: string;
  label: string;
  detail: string | null;
} | null;

export type AskBaileyCitation = {
  segment_id: string;
  source_version_id: string;
  source_id: string;
  title: string;
  source_type: string;
  authority_class: string;
  locator_label: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  resource_library_item_id: string | null;
  media_url: string | null;
};

export type AskBaileyAnswer = {
  status:
    | "supported"
    | "partially_supported"
    | "no_approved_answer"
    | "source_conflict"
    | "provider_unavailable"
    | "access_limited"
    | "error";
  conversation_id: string;
  message_id: string;
  answer_markdown: string | null;
  citations: AskBaileyCitation[];
  warnings: string[];
  conflicts: Array<{
    conflict_id: string;
    source_a_title: string;
    source_b_title: string;
    owner_a_name: string | null;
    owner_b_name: string | null;
    note: string | null;
  }>;
  context: { kind: string; id: string; label: string } | null;
  evidence: { source_count: number; highest_authority: string | null; conflict_detected: boolean };
  /** Reviewer-only retrieval diagnostics; never populated for other users. */
  retrieval_trace?: RetrievalTrace;
};

// ---------------------------------------------------------------------------
// Context envelope — server-validated, allowlisted fields only (D7).
// ---------------------------------------------------------------------------
async function buildContextEnvelope(
  client: PoolClient,
  auth: AuthUser,
  input: AskBaileyContextInput | undefined
): Promise<ContextEnvelope> {
  if (!input) return null;
  const provided = [input.job_id, input.shoot_id, input.organization_id].filter(Boolean);
  if (provided.length === 0) return null;
  if (provided.length > 1) {
    throw new ApiError(400, "Provide at most one context record.");
  }

  if (input.job_id) {
    const { rows } = await client.query<{ id: string; title: string; department_type: string; organization_id: string | null; account_owner_user_id: string | null; scheduled_start_at: string | null }>(
      `SELECT id::text, title, department_type::text, organization_id::text, account_owner_user_id::text, scheduled_start_at::text
       FROM jobs WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, input.job_id]
    );
    const job = rows[0];
    if (!job) throw new ApiError(404, "Context record not found.");
    const policyContext = withDepartmentContext(job.department_type, {
      organizationId: job.organization_id,
      ownerUserIds: job.account_owner_user_id ? [job.account_owner_user_id] : []
    });
    if (!canViewRecords(auth, "job", policyContext)) {
      throw new ApiError(403, "You do not have access to that record.");
    }
    return {
      kind: "job",
      id: job.id,
      label: job.title,
      detail: [job.department_type, job.scheduled_start_at?.slice(0, 10)].filter(Boolean).join(" · ") || null
    };
  }
  if (input.shoot_id) {
    const { rows } = await client.query<{ id: string; title: string; shoot_date: string | null; department: string | null }>(
      `SELECT id::text, title, shoot_date::text, department::text
       FROM shoot WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
      [auth.tenantId, input.shoot_id]
    );
    const shoot = rows[0];
    if (!shoot) throw new ApiError(404, "Context record not found.");
    await assertShootAccess(client, auth, shoot.id);
    return {
      kind: "shoot",
      id: shoot.id,
      label: shoot.title,
      detail: [shoot.department, shoot.shoot_date].filter(Boolean).join(" · ") || null
    };
  }
  const { rows } = await client.query<{ id: string; display_name: string }>(
    `SELECT id::text, display_name FROM organization WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, input.organization_id]
  );
  const organization = rows[0];
  if (!organization) throw new ApiError(404, "Context record not found.");
  if (!canViewRecords(auth, "organization", { organizationId: organization.id })) {
    throw new ApiError(403, "You do not have access to that record.");
  }
  return { kind: "organization", id: organization.id, label: organization.display_name, detail: null };
}

// Retrieval lives in ./retrieval.ts (hybrid lexical + semantic, eligibility
// composed inside every SQL path — charter H1-B/H1-D).

async function findOpenConflicts(client: PoolClient, tenantId: string, versionIds: string[]) {
  if (versionIds.length < 2) return [];
  const { rows } = await client.query<{
    conflict_id: string;
    source_a_title: string;
    source_b_title: string;
    owner_a_name: string | null;
    owner_b_name: string | null;
    note: string | null;
  }>(
    `SELECT c.id::text AS conflict_id, sa.title AS source_a_title, sb.title AS source_b_title,
            oa.full_name AS owner_a_name, ob.full_name AS owner_b_name, c.note
     FROM knowledge_source_conflict c
     JOIN knowledge_source_version va ON va.id = c.version_a_id
     JOIN knowledge_source sa ON sa.id = va.source_id
     LEFT JOIN app_user oa ON oa.id = sa.owner_user_id
     JOIN knowledge_source_version vb ON vb.id = c.version_b_id
     JOIN knowledge_source sb ON sb.id = vb.source_id
     LEFT JOIN app_user ob ON ob.id = sb.owner_user_id
     WHERE c.tenant_id = $1 AND c.status = 'open'
       AND c.version_a_id = ANY($2::uuid[]) AND c.version_b_id = ANY($2::uuid[])`,
    [tenantId, versionIds]
  );
  return rows;
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

async function recordUnresolvedQuestion(client: PoolClient, auth: AuthUser, question: string) {
  const normalized = normalizeQuestion(question);
  const hash = createHash("sha256").update(normalized).digest("hex");
  const departments = auth.department ? [auth.department] : [];
  const roles = (auth.roles ?? []).filter(Boolean);
  await client.query(
    `INSERT INTO ai_unresolved_question
       (tenant_id, normalized_question, question_hash, example_question, departments_asking, roles_asking)
     VALUES ($1, $2, $3, $4, $5::text[], $6::text[])
     ON CONFLICT (tenant_id, question_hash)
     DO UPDATE SET
       occurrence_count = ai_unresolved_question.occurrence_count + 1,
       last_asked_at = now(),
       departments_asking = (
         SELECT COALESCE(array_agg(DISTINCT dept), '{}') FROM unnest(ai_unresolved_question.departments_asking || $5::text[]) AS dept
       ),
       roles_asking = (
         SELECT COALESCE(array_agg(DISTINCT role), '{}') FROM unnest(ai_unresolved_question.roles_asking || $6::text[]) AS role
       ),
       updated_at = now()`,
    [auth.tenantId, normalized, hash, question, departments, roles]
  );
}

async function recordUsage(
  client: PoolClient,
  auth: AuthUser,
  input: { provider: string; model: string | null; latencyMs: number; status: "ok" | "error" | "timeout"; promptTokens: number | null; completionTokens: number | null }
) {
  await client.query(
    `INSERT INTO ai_provider_usage_event (tenant_id, user_id, provider, model, operation, prompt_tokens, completion_tokens, latency_ms, status)
     VALUES ($1, $2, $3, $4, 'generate', $5, $6, $7, $8)`,
    [auth.tenantId, auth.id, input.provider, input.model, input.promptTokens, input.completionTokens, input.latencyMs, input.status]
  );
}

// ---------------------------------------------------------------------------
// The pipeline.
// ---------------------------------------------------------------------------
export async function askBailey(
  client: PoolClient,
  auth: AuthUser,
  input: {
    question: string;
    mode?: KnowledgeMode;
    conversationId?: string | null;
    context?: AskBaileyContextInput;
    /** Reviewer-only retrieval diagnostics (H1-E); ignored for other users. */
    trace?: boolean;
    // Test seam only: routes never pass this. Lets citation validation and
    // provider-failure paths be exercised against a controlled provider.
    providerOverride?: LanguageModelProvider;
  }
): Promise<AskBaileyAnswer> {
  const question = input.question.trim();
  if (!question) {
    throw new ApiError(400, "Question is required.");
  }
  const mode: KnowledgeMode = input.mode ?? "operational";
  const startedAt = Date.now();

  // 1-4. Context is validated server-side; only allowlisted fields survive.
  const context = await buildContextEnvelope(client, auth, input.context);

  // 5-7. Eligibility + scopes are INSIDE the retrieval SQL (both the lexical
  // and semantic paths — see retrieval.ts).
  const includeTrace = Boolean(input.trace) && isKnowledgeReviewer(auth);
  const retrieval = await retrieveSegmentsHybrid(client, auth, mode, question, context?.label ?? null, {
    includeTrace
  });
  const retrieved = retrieval.rows;
  const retrievedIds = new Set(retrieved.map((row) => row.segment_id));
  const versionIds = [...new Set(retrieved.map((row) => row.source_version_id))];

  // 8. Declared conflicts between retrieved sources are surfaced, never ranked away.
  const conflicts = await findOpenConflicts(client, auth.tenantId, versionIds);

  // Conversation shell (created up-front so every outcome is auditable).
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const owned = await client.query(
      `SELECT id FROM ai_conversation WHERE tenant_id = $1 AND id = $2 AND user_id = $3 LIMIT 1`,
      [auth.tenantId, conversationId, auth.id]
    );
    if (!owned.rows[0]) throw new ApiError(404, "Conversation not found.");
  } else {
    const created = await client.query<{ id: string }>(
      `INSERT INTO ai_conversation (tenant_id, user_id, title) VALUES ($1, $2, $3) RETURNING id::text`,
      [auth.tenantId, auth.id, question.slice(0, 120)]
    );
    conversationId = created.rows[0].id;
  }

  const warnings: string[] = [];
  let status: AskBaileyAnswer["status"];
  let answerMarkdown: string | null = null;
  let usedSegmentIds: string[] = [];
  let provider = "none";
  let model: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  if (conflicts.length > 0) {
    status = "source_conflict";
    answerMarkdown =
      "I found approved sources that do not agree. I'm not going to choose one silently. Here are the sources and the people responsible for resolving the conflict.";
  } else if (retrieved.length === 0) {
    status = "no_approved_answer";
    answerMarkdown =
      "I couldn't find an approved answer for that yet. I logged the question so the right owner can review it. I'm not going to make up a procedure.";
    await recordUnresolvedQuestion(client, auth, question);
  } else {
    // 9-11. Bounded provider request; retrieved text is data, not instructions.
    const providerImpl = input.providerOverride ?? resolveLanguageModelProvider();
    provider = providerImpl.name;
    const segmentsForModel: RetrievedSegmentForModel[] = retrieved.map((row) => ({
      segmentId: row.segment_id,
      sourceTitle: row.source_title,
      authorityClass: row.authority_class,
      locatorLabel: row.locator_label,
      content: row.content
    }));
    const result = await providerImpl.generateAnswer({
      question,
      mode,
      segments: segmentsForModel,
      contextSummary: context ? `${context.kind}: ${context.label}` : null,
      maxAnswerChars: config.ASK_BAILEY_MAX_ANSWER_CHARS
    });

    if (result.status === "ok") {
      model = result.model;
      promptTokens = result.promptTokens;
      completionTokens = result.completionTokens;
      // 12-13. Reject invented citation identifiers.
      const validIds = result.usedSegmentIds.filter((id) => retrievedIds.has(id));
      const inventedCount = result.usedSegmentIds.length - validIds.length;
      if (inventedCount > 0) {
        warnings.push(`${inventedCount} citation${inventedCount === 1 ? "" : "s"} returned by the provider did not map to retrieved sources and were rejected.`);
      }
      usedSegmentIds = validIds;
      if (validIds.length === 0) {
        status = "error";
        answerMarkdown =
          "Something went wrong assembling verified sources for this answer, so I'm not going to show it. The question has been logged.";
        await recordUnresolvedQuestion(client, auth, question);
      } else {
        answerMarkdown = result.answerMarkdown;
        // partially_supported = some of the provider's claimed support was
        // rejected as invented; what remains is real but weaker than claimed.
        status = inventedCount > 0 ? "partially_supported" : "supported";
        if (mode === "planning" && retrieved.some((row) => row.authority_class === "future_design_only")) {
          warnings.push("This answer draws on future-design material — it is not a current operating procedure.");
        }
      }
    } else if (result.status === "unavailable") {
      status = "provider_unavailable";
      answerMarkdown = `Bailey's answer engine isn't available right now: ${result.reason} The approved sources I found are listed below.`;
      // Even without a provider, the retrieved citations are real and safe to show.
      usedSegmentIds = retrieved.slice(0, 3).map((row) => row.segment_id);
    } else {
      status = "error";
      answerMarkdown = "Something went wrong while composing the answer. I'm not going to guess — please try again.";
    }
    await recordUsage(client, auth, {
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      status: result.status === "ok" ? "ok" : "error",
      promptTokens,
      completionTokens
    });
  }

  // 14. Citations assembled server-side from database rows only.
  const citationRows = retrieved.filter((row) => usedSegmentIds.includes(row.segment_id));
  const supportingRows = status === "source_conflict" ? retrieved.slice(0, 6) : citationRows;

  // 15. Auditable record.
  const message = await client.query<{ id: string }>(
    `INSERT INTO ai_message
       (tenant_id, conversation_id, user_id, knowledge_mode, question, context_envelope, status, answer_markdown, warnings, provider, model, latency_ms, prompt_tokens, completion_tokens)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
     RETURNING id::text`,
    [
      auth.tenantId,
      conversationId,
      auth.id,
      mode,
      question,
      JSON.stringify(context ? { kind: context.kind, id: context.id, label: context.label } : {}),
      status,
      answerMarkdown,
      JSON.stringify(warnings),
      provider,
      model,
      Date.now() - startedAt,
      promptTokens,
      completionTokens
    ]
  );
  const messageId = message.rows[0].id;
  for (const [index, row] of supportingRows.entries()) {
    await client.query(
      `INSERT INTO ai_message_citation (tenant_id, message_id, segment_id, source_version_id, ordinal)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [auth.tenantId, messageId, row.segment_id, row.source_version_id, index]
    );
  }
  await client.query(`UPDATE ai_conversation SET updated_at = now() WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, conversationId]);

  const highestAuthority =
    retrieved.length > 0
      ? retrieved.reduce((best, row) => ((AUTHORITY_RANK[row.authority_class] ?? 0) > (AUTHORITY_RANK[best] ?? 0) ? row.authority_class : best), retrieved[0].authority_class)
      : null;

  // 16. Safe structured answer.
  return {
    status,
    conversation_id: conversationId,
    message_id: messageId,
    answer_markdown: answerMarkdown,
    citations: supportingRows.map((row) => ({
      segment_id: row.segment_id,
      source_version_id: row.source_version_id,
      source_id: row.source_id,
      title: row.source_title,
      source_type: row.source_type,
      authority_class: row.authority_class,
      locator_label: row.locator_label,
      start_seconds: row.start_seconds,
      end_seconds: row.end_seconds,
      resource_library_item_id: row.resource_library_item_id,
      media_url: row.start_seconds != null && row.media_url ? `${row.media_url}#t=${Math.floor(row.start_seconds)}` : row.media_url
    })),
    warnings,
    conflicts,
    context: context ? { kind: context.kind, id: context.id, label: context.label } : null,
    evidence: {
      source_count: new Set(supportingRows.map((row) => row.source_id)).size,
      highest_authority: highestAuthority,
      conflict_detected: conflicts.length > 0
    },
    ...(includeTrace ? { retrieval_trace: retrieval.trace } : {})
  };
}

// ---------------------------------------------------------------------------
// Conversation history + feedback.
// ---------------------------------------------------------------------------
export async function listConversations(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query(
    `SELECT id::text, title, created_at::text, updated_at::text
     FROM ai_conversation WHERE tenant_id = $1 AND user_id = $2
     ORDER BY updated_at DESC LIMIT 50`,
    [auth.tenantId, auth.id]
  );
  return rows;
}

export async function getConversation(client: PoolClient, auth: AuthUser, conversationId: string) {
  const conversation = await client.query(
    `SELECT id::text, title, created_at::text FROM ai_conversation
     WHERE tenant_id = $1 AND id = $2 AND user_id = $3 LIMIT 1`,
    [auth.tenantId, conversationId, auth.id]
  );
  if (!conversation.rows[0]) throw new ApiError(404, "Conversation not found.");
  const messages = await client.query(
    `SELECT m.id::text, m.question, m.status, m.answer_markdown, m.warnings, m.knowledge_mode, m.context_envelope, m.created_at::text
     FROM ai_message m WHERE m.tenant_id = $1 AND m.conversation_id = $2
     ORDER BY m.created_at ASC LIMIT 100`,
    [auth.tenantId, conversationId]
  );
  const citations = await client.query(
    `SELECT c.message_id::text, c.segment_id::text, c.source_version_id::text, s.id::text AS source_id, s.title,
            v.source_type, v.authority_class, seg.locator_label, seg.start_seconds::float, seg.end_seconds::float,
            s.resource_library_item_id::text, item.file_url AS media_url, c.ordinal
     FROM ai_message_citation c
     JOIN knowledge_segment seg ON seg.id = c.segment_id
     JOIN knowledge_source_version v ON v.id = c.source_version_id
     JOIN knowledge_source s ON s.id = v.source_id
     LEFT JOIN resource_library_item item ON item.id = s.resource_library_item_id
     WHERE c.tenant_id = $1 AND c.message_id IN (SELECT id FROM ai_message WHERE tenant_id = $1 AND conversation_id = $2)
     ORDER BY c.ordinal`,
    [auth.tenantId, conversationId]
  );
  return { conversation: conversation.rows[0], messages: messages.rows, citations: citations.rows };
}

export async function submitMessageFeedback(
  client: PoolClient,
  auth: AuthUser,
  messageId: string,
  input: { kind: "helpful" | "not_helpful" | "report_incorrect" | "missing_information" | "source_outdated"; note?: string | null }
) {
  const message = await client.query(
    `SELECT id FROM ai_message WHERE tenant_id = $1 AND id = $2 AND user_id = $3 LIMIT 1`,
    [auth.tenantId, messageId, auth.id]
  );
  if (!message.rows[0]) throw new ApiError(404, "Message not found.");
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ai_message_feedback (tenant_id, message_id, user_id, feedback_kind, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, message_id, user_id, feedback_kind)
     DO UPDATE SET note = COALESCE(EXCLUDED.note, ai_message_feedback.note), created_at = ai_message_feedback.created_at
     RETURNING id::text`,
    [auth.tenantId, messageId, auth.id, input.kind, input.note ?? null]
  );
  return { feedback_id: rows[0].id };
}
