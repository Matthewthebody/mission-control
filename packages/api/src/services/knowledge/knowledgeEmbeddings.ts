import type { PoolClient } from "pg";
import { resolveEmbeddingProvider } from "../ai/providers/embedding.js";
import type { EmbeddingProvider } from "../ai/providers/types.js";

// Ask Bailey embedding lifecycle (charter H1-C).
//
// Vectors live INSIDE the governed schema (knowledge_segment_embedding, RLS,
// CASCADE from segments) — there is no second knowledge store. Eligibility is
// never evaluated here: retrieval joins embeddings back to segments/versions
// with the same predicate as the lexical path, so a stale, retired, draft, or
// confidential vector can never answer on its own.
//
// Idempotency: one row per (segment, provider, model), fingerprinted with
// md5(content). Content changes flip the row back to pending; re-ingestion
// replaces segments, which CASCADE-deletes their vectors outright.

const MAX_EMBED_BATCH = 32;
const MAX_ATTEMPTS = 5;

export type EmbeddingSweepOutcome = {
  provider: string;
  model: string;
  ensured_pending: number;
  embedded: number;
  failed: number;
  not_configured: boolean;
  reason?: string;
};

/**
 * Make sure every segment of an approved, non-superseded version has an
 * embedding row for the active provider/model — new rows start pending, and
 * rows whose stored fingerprint no longer matches the segment content are
 * flipped back to pending (re-embed on change).
 */
export async function ensurePendingEmbeddings(
  client: PoolClient,
  tenantId: string,
  provider: EmbeddingProvider
): Promise<number> {
  const inserted = await client.query(
    `INSERT INTO knowledge_segment_embedding
       (tenant_id, segment_id, source_version_id, provider, model, dimensions, content_fingerprint, status)
     SELECT seg.tenant_id, seg.id, seg.source_version_id, $2, $3, 0, md5(seg.content), 'pending'
     FROM knowledge_segment seg
     JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
     WHERE seg.tenant_id = $1
       AND v.publication_status = 'approved'
       AND v.superseded_by_version_id IS NULL
     ON CONFLICT (tenant_id, segment_id, provider, model)
     DO UPDATE SET
       status = 'pending',
       content_fingerprint = EXCLUDED.content_fingerprint,
       attempts = 0,
       error_message = NULL,
       updated_at = now()
     WHERE knowledge_segment_embedding.content_fingerprint <> EXCLUDED.content_fingerprint
     RETURNING id`,
    [tenantId, provider.name, provider.model]
  );
  return inserted.rows.length;
}

/** Embed pending (and retryable failed) rows in bounded batches. */
export async function processPendingEmbeddings(
  client: PoolClient,
  tenantId: string,
  options: { limit?: number; provider?: EmbeddingProvider } = {}
): Promise<EmbeddingSweepOutcome> {
  const provider = options.provider ?? resolveEmbeddingProvider();
  const limit = Math.min(options.limit ?? MAX_EMBED_BATCH, MAX_EMBED_BATCH);
  const ensured = await ensurePendingEmbeddings(client, tenantId, provider);

  const outcome: EmbeddingSweepOutcome = {
    provider: provider.name,
    model: provider.model,
    ensured_pending: ensured,
    embedded: 0,
    failed: 0,
    not_configured: false
  };

  const pending = await client.query<{ id: string; segment_id: string; content: string }>(
    `SELECT e.id::text, e.segment_id::text, seg.content
     FROM knowledge_segment_embedding e
     JOIN knowledge_segment seg ON seg.id = e.segment_id
     WHERE e.tenant_id = $1 AND e.provider = $2 AND e.model = $3
       AND (e.status = 'pending' OR (e.status = 'failed' AND e.attempts < $4))
     ORDER BY e.updated_at ASC
     LIMIT $5`,
    [tenantId, provider.name, provider.model, MAX_ATTEMPTS, limit]
  );
  if (pending.rows.length === 0) {
    return outcome;
  }

  const result = await provider.embed(pending.rows.map((row) => row.content));
  if (result.status === "not_configured") {
    // Honest configuration state: rows stay pending, nothing is consumed.
    outcome.not_configured = true;
    outcome.reason = result.reason;
    return outcome;
  }
  if (result.status === "failed") {
    await client.query(
      `UPDATE knowledge_segment_embedding
       SET status = 'failed', attempts = attempts + 1, error_message = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, pending.rows.map((row) => row.id), result.reason.slice(0, 500)]
    );
    outcome.failed = pending.rows.length;
    outcome.reason = result.reason;
    return outcome;
  }

  for (const [index, row] of pending.rows.entries()) {
    await client.query(
      `UPDATE knowledge_segment_embedding
       SET embedding = $3, dimensions = $4, status = 'completed', attempts = attempts + 1,
           error_message = NULL, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, row.id, result.vectors[index], result.dimensions]
    );
  }
  outcome.embedded = pending.rows.length;
  return outcome;
}
