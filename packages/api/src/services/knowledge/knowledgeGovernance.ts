import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { hasAuthorityTier } from "../../authz/authority.js";
import { config } from "../../config.js";
import { createAuditLog } from "../audit.js";

// Ask Bailey — knowledge governance (Phase B).
// Design: docs/ask-bailey/2026-07-13-ask-bailey-architecture.md (D1, D2, D6).
//
// The single most important rule lives here: ELIGIBILITY IS ONE SQL PREDICATE,
// applied inside retrieval queries BEFORE any content reaches ranking, a model,
// or the client. Segments inherit authorization from their source version.

export type KnowledgeMode = "operational" | "training" | "planning" | "historical";

export const OPERATIONAL_AUTHORITY_CLASSES = [
  "official_company_policy",
  "approved_sop",
  "approved_training",
  "approved_expert_guidance",
  "approved_visual_standard",
  "verified_current_workflow"
] as const;

// Modes widen honestly: planning may ALSO see future-design material (always
// labeled by the pipeline); historical may also see historical references.
// Raw evidence and observations never become instructions in any mode.
const MODE_AUTHORITY_CLASSES: Record<KnowledgeMode, readonly string[]> = {
  operational: OPERATIONAL_AUTHORITY_CLASSES,
  training: OPERATIONAL_AUTHORITY_CLASSES,
  planning: [...OPERATIONAL_AUTHORITY_CLASSES, "future_design_only"],
  historical: [...OPERATIONAL_AUTHORITY_CLASSES, "historical_only"]
};

export function isKnowledgeReviewer(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function requireKnowledgeReviewer(auth: AuthUser) {
  if (!isKnowledgeReviewer(auth)) {
    throw new ApiError(403, "Knowledge review requires an administrative role");
  }
}

/**
 * Build the eligibility + authorization predicate for source versions, as a SQL
 * fragment over alias `v` (knowledge_source_version). Pushes params onto the
 * caller's param array and returns the fragment. Everything ineligible is
 * excluded HERE — never by post-filtering.
 */
export function buildVersionEligibilitySql(
  auth: AuthUser,
  mode: KnowledgeMode,
  params: unknown[]
): string {
  const clauses: string[] = [
    `v.publication_status = 'approved'`,
    `(v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)`,
    `(v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)`,
    `v.superseded_by_version_id IS NULL`
  ];

  params.push([...MODE_AUTHORITY_CLASSES[mode]]);
  clauses.push(`v.authority_class = ANY($${params.length}::text[])`);

  // Department scope: empty array = unrestricted.
  params.push(auth.department ?? "");
  clauses.push(
    `(cardinality(v.department_scope) = 0 OR $${params.length} = ANY(v.department_scope))`
  );

  // Role scope: empty array = unrestricted; any overlap grants access.
  params.push(auth.roles ?? []);
  clauses.push(
    `(cardinality(v.role_scope) = 0 OR v.role_scope && $${params.length}::text[])`
  );

  // Confidential sources require leadership-tier access.
  if (!isKnowledgeReviewer(auth)) {
    clauses.push(`v.confidential = false`);
  }

  // H8 demo/production separation: in production (ASK_BAILEY_ALLOW_DEMO_CONTENT
  // = false) demo-flagged sources never enter retrieval — enforced here inside
  // the eligibility predicate, not by a title convention. Self-contained over
  // alias v so every retrieval path inherits it.
  if (!config.ASK_BAILEY_ALLOW_DEMO_CONTENT) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM knowledge_source s WHERE s.id = v.source_id AND s.is_demo = true)`
    );
  }

  return clauses.join(" AND ");
}

/**
 * Segment-level exclusions that apply in every mode (H3: reviewer
 * classification drives eligibility). NULL inherits the version's
 * classification; pain points, future-design ideas, raw discussion,
 * evidence-only, historical, and restricted segments never support answers
 * regardless of their version's status.
 */
export const SEGMENT_ELIGIBILITY_SQL = `
  (seg.reviewer_classification IS NULL OR seg.reviewer_classification IN (
    'approved_instruction', 'approved_training', 'current_workflow_observation'
  ))
`;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type CreateKnowledgeSourceInput = {
  title: string;
  description?: string | null;
  resourceLibraryItemId?: string | null;
  departmentOwner?: string | null;
  sourceType: string;
  authorityClass: string;
  knowledgeMode?: string;
  inlineBody?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  reviewDueAt?: string | null;
  departmentScope?: string[];
  roleScope?: string[];
  confidential?: boolean;
  isDemo?: boolean;
};

export async function createKnowledgeSource(client: PoolClient, auth: AuthUser, input: CreateKnowledgeSourceInput) {
  requireKnowledgeReviewer(auth);
  if (input.resourceLibraryItemId) {
    const asset = await client.query(
      `SELECT id FROM resource_library_item WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, input.resourceLibraryItemId]
    );
    if (!asset.rows[0]) {
      throw new ApiError(404, "Resource Library item not found");
    }
  }
  const source = await client.query<{ id: string }>(
    `INSERT INTO knowledge_source (tenant_id, resource_library_item_id, title, description, owner_user_id, department_owner, is_demo, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $5) RETURNING id::text`,
    [auth.tenantId, input.resourceLibraryItemId ?? null, input.title, input.description ?? null, auth.id, input.departmentOwner ?? null, input.isDemo ?? false]
  );
  const sourceId = source.rows[0].id;
  const version = await client.query<{ id: string }>(
    `INSERT INTO knowledge_source_version (
       tenant_id, source_id, version_number, source_type, authority_class, publication_status,
       knowledge_mode, inline_body, effective_from, effective_until, review_due_at,
       department_scope, role_scope, confidential, submitted_by_user_id
     )
     VALUES ($1, $2, 1, $3, $4, 'draft', $5, $6, $7, $8, $9, $10::text[], $11::text[], $12, $13)
     RETURNING id::text`,
    [
      auth.tenantId,
      sourceId,
      input.sourceType,
      input.authorityClass,
      input.knowledgeMode ?? "operational",
      input.inlineBody ?? null,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.reviewDueAt ?? null,
      input.departmentScope ?? [],
      input.roleScope ?? [],
      input.confidential ?? false,
      auth.id
    ]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.source_created",
    entityType: "knowledge_source",
    entityId: sourceId,
    metadata: { version_id: version.rows[0].id, source_type: input.sourceType, authority_class: input.authorityClass }
  });
  return { source_id: sourceId, version_id: version.rows[0].id };
}

async function loadVersion(client: PoolClient, tenantId: string, versionId: string) {
  const { rows } = await client.query(
    `SELECT * FROM knowledge_source_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, versionId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Knowledge source version not found");
  }
  return rows[0];
}

export async function submitKnowledgeVersionForReview(client: PoolClient, auth: AuthUser, versionId: string) {
  requireKnowledgeReviewer(auth);
  const version = await loadVersion(client, auth.tenantId, versionId);
  if (version.publication_status !== "draft" && version.publication_status !== "rejected") {
    throw new ApiError(409, `Only a draft or rejected version can be submitted for review (current: ${version.publication_status}).`);
  }
  await client.query(
    `UPDATE knowledge_source_version SET publication_status = 'pending_review', submitted_by_user_id = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, auth.id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.version_submitted",
    entityType: "knowledge_source_version",
    entityId: versionId,
    metadata: {}
  });
  return loadVersion(client, auth.tenantId, versionId);
}

export async function approveKnowledgeVersion(client: PoolClient, auth: AuthUser, versionId: string, note?: string | null) {
  requireKnowledgeReviewer(auth);
  const version = await loadVersion(client, auth.tenantId, versionId);
  if (!["draft", "pending_review"].includes(version.publication_status)) {
    throw new ApiError(409, `Only a draft or pending version can be approved (current: ${version.publication_status}).`);
  }
  await client.query(
    `UPDATE knowledge_source_version
     SET publication_status = 'approved', approved_by_user_id = $3, approved_at = now(),
         review_notes = COALESCE($4, review_notes), updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, auth.id, note ?? null]
  );
  // Supersession: approving a version that names a predecessor retires the
  // predecessor from retrieval in the same transaction.
  if (version.supersedes_version_id) {
    await client.query(
      `UPDATE knowledge_source_version
       SET publication_status = 'superseded', superseded_by_version_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, version.supersedes_version_id, versionId]
    );
  }
  await client.query(
    `UPDATE knowledge_source SET current_version_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, version.source_id, versionId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.version_approved",
    entityType: "knowledge_source_version",
    entityId: versionId,
    metadata: { superseded_version_id: version.supersedes_version_id ?? null, note: note ?? null }
  });
  return loadVersion(client, auth.tenantId, versionId);
}

export async function rejectKnowledgeVersion(client: PoolClient, auth: AuthUser, versionId: string, note: string) {
  requireKnowledgeReviewer(auth);
  const version = await loadVersion(client, auth.tenantId, versionId);
  if (version.publication_status !== "pending_review" && version.publication_status !== "draft") {
    throw new ApiError(409, `Only a draft or pending version can be rejected (current: ${version.publication_status}).`);
  }
  await client.query(
    `UPDATE knowledge_source_version SET publication_status = 'rejected', review_notes = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, note]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.version_rejected",
    entityType: "knowledge_source_version",
    entityId: versionId,
    metadata: { note }
  });
  return loadVersion(client, auth.tenantId, versionId);
}

export async function retireKnowledgeVersion(client: PoolClient, auth: AuthUser, versionId: string, note?: string | null) {
  requireKnowledgeReviewer(auth);
  const version = await loadVersion(client, auth.tenantId, versionId);
  if (version.publication_status !== "approved") {
    throw new ApiError(409, `Only an approved version can be retired (current: ${version.publication_status}).`);
  }
  await client.query(
    `UPDATE knowledge_source_version SET publication_status = 'retired', review_notes = COALESCE($3, review_notes), updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, note ?? null]
  );
  await client.query(
    `UPDATE knowledge_source SET current_version_id = NULL, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND current_version_id = $3`,
    [auth.tenantId, version.source_id, versionId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.version_retired",
    entityType: "knowledge_source_version",
    entityId: versionId,
    metadata: { note: note ?? null }
  });
  return loadVersion(client, auth.tenantId, versionId);
}

export async function openKnowledgeConflict(
  client: PoolClient,
  auth: AuthUser,
  input: { versionAId: string; versionBId: string; note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  await loadVersion(client, auth.tenantId, input.versionAId);
  await loadVersion(client, auth.tenantId, input.versionBId);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO knowledge_source_conflict (tenant_id, version_a_id, version_b_id, note, opened_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, version_a_id, version_b_id)
     DO UPDATE SET status = 'open', note = COALESCE(EXCLUDED.note, knowledge_source_conflict.note), updated_at = now()
     RETURNING id::text`,
    [auth.tenantId, input.versionAId, input.versionBId, input.note ?? null, auth.id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.conflict_opened",
    entityType: "knowledge_source_conflict",
    entityId: rows[0].id,
    metadata: { version_a_id: input.versionAId, version_b_id: input.versionBId }
  });
  return rows[0].id;
}

export async function resolveKnowledgeConflict(
  client: PoolClient,
  auth: AuthUser,
  conflictId: string,
  input: { resolution: "resolved" | "dismissed"; note: string }
) {
  requireKnowledgeReviewer(auth);
  const { rows } = await client.query(
    `UPDATE knowledge_source_conflict
     SET status = $3, resolution_note = $4, resolved_by_user_id = $5, resolved_at = now(), updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'open'
     RETURNING *`,
    [auth.tenantId, conflictId, input.resolution, input.note, auth.id]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Open conflict not found");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.conflict_resolved",
    entityType: "knowledge_source_conflict",
    entityId: conflictId,
    metadata: { resolution: input.resolution, note: input.note }
  });
  return rows[0];
}

export async function reviewAnswerReport(
  client: PoolClient,
  auth: AuthUser,
  feedbackId: string,
  input: { resolution: "reviewed" | "dismissed" }
) {
  requireKnowledgeReviewer(auth);
  const { rows } = await client.query(
    `UPDATE ai_message_feedback
     SET review_status = $3, reviewed_by_user_id = $4, reviewed_at = now()
     WHERE tenant_id = $1 AND id = $2 AND review_status = 'open'
     RETURNING id::text, feedback_kind, review_status`,
    [auth.tenantId, feedbackId, input.resolution, auth.id]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Open answer report not found");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.answer_report_reviewed",
    entityType: "ai_message_feedback",
    entityId: feedbackId,
    metadata: { resolution: input.resolution, feedback_kind: rows[0].feedback_kind }
  });
  return rows[0];
}

export async function resolveUnresolvedQuestion(
  client: PoolClient,
  auth: AuthUser,
  questionId: string,
  input: { resolution: "answered" | "dismissed"; note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const { rows } = await client.query(
    `UPDATE ai_unresolved_question
     SET status = $3, resolved_at = now(), updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status IN ('open', 'assigned')
     RETURNING id::text, normalized_question, status`,
    [auth.tenantId, questionId, input.resolution]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Open unresolved question not found");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.unresolved_question_resolved",
    entityType: "ai_unresolved_question",
    entityId: questionId,
    metadata: { resolution: input.resolution, note: input.note ?? null }
  });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Company-owned synonym / acronym map (charter H1-B). Reviewer-managed and
// audited: query expansion only ever widens through approved mappings.
// ---------------------------------------------------------------------------

export async function listKnowledgeSynonyms(client: PoolClient, auth: AuthUser) {
  requireKnowledgeReviewer(auth);
  const { rows } = await client.query(
    `SELECT s.id::text, s.term, s.expansion, s.note, s.created_at::text, u.full_name AS created_by_name
     FROM knowledge_synonym s
     LEFT JOIN app_user u ON u.id = s.created_by_user_id
     WHERE s.tenant_id = $1
     ORDER BY s.term
     LIMIT 500`,
    [auth.tenantId]
  );
  return rows;
}

export async function upsertKnowledgeSynonym(
  client: PoolClient,
  auth: AuthUser,
  input: { term: string; expansion: string[]; note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const term = input.term.trim().toLowerCase();
  const expansion = input.expansion.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!term || expansion.length === 0) {
    throw new ApiError(400, "A synonym needs a term and at least one expansion.");
  }
  // Circular-mapping protection (H5): a term may not expand to itself, and a
  // one-level cycle (a→b while b→a) is rejected.
  if (expansion.some((entry) => entry === term || entry.split(/\s+/).includes(term))) {
    throw new ApiError(400, "A synonym cannot expand to itself.");
  }
  const reverse = await client.query<{ term: string; expansion: string[] }>(
    `SELECT term, expansion FROM knowledge_synonym WHERE tenant_id = $1 AND term = ANY($2::text[])`,
    [auth.tenantId, expansion.flatMap((entry) => entry.split(/\s+/))]
  );
  for (const row of reverse.rows) {
    if (row.expansion.some((entry) => entry === term || entry.split(/\s+/).includes(term))) {
      throw new ApiError(400, `Circular mapping: '${row.term}' already expands to '${term}'.`);
    }
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO knowledge_synonym (tenant_id, term, expansion, note, created_by_user_id)
     VALUES ($1, $2, $3::text[], $4, $5)
     ON CONFLICT (tenant_id, term)
     DO UPDATE SET expansion = EXCLUDED.expansion, note = EXCLUDED.note, updated_at = now()
     RETURNING id::text`,
    [auth.tenantId, term, expansion, input.note ?? null, auth.id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.synonym_upserted",
    entityType: "knowledge_synonym",
    entityId: rows[0].id,
    metadata: { term, expansion, note: input.note ?? null }
  });
  return { id: rows[0].id, term, expansion };
}

export async function deleteKnowledgeSynonym(client: PoolClient, auth: AuthUser, term: string) {
  requireKnowledgeReviewer(auth);
  const { rows } = await client.query<{ id: string }>(
    `DELETE FROM knowledge_synonym WHERE tenant_id = $1 AND term = $2 RETURNING id::text`,
    [auth.tenantId, term.trim().toLowerCase()]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Synonym not found");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.synonym_deleted",
    entityType: "knowledge_synonym",
    entityId: rows[0].id,
    metadata: { term: term.trim().toLowerCase() }
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Review queues (Phase E read models live on these).
// ---------------------------------------------------------------------------

export async function listKnowledgeReviewQueue(client: PoolClient, auth: AuthUser) {
  requireKnowledgeReviewer(auth);
  const pending = await client.query(
    `SELECT v.id::text, v.source_id::text, s.title, v.version_number, v.source_type, v.authority_class,
            v.publication_status, v.knowledge_mode, v.extraction_status, v.created_at::text,
            submitter.full_name AS submitted_by_name
     FROM knowledge_source_version v
     JOIN knowledge_source s ON s.id = v.source_id AND s.tenant_id = v.tenant_id
     LEFT JOIN app_user submitter ON submitter.id = v.submitted_by_user_id
     WHERE v.tenant_id = $1 AND v.publication_status = 'pending_review'
     ORDER BY v.created_at ASC
     LIMIT 200`,
    [auth.tenantId]
  );
  const conflicts = await client.query(
    `SELECT c.id::text, c.status, c.note, c.created_at::text,
            sa.title AS source_a_title, sb.title AS source_b_title,
            c.version_a_id::text, c.version_b_id::text
     FROM knowledge_source_conflict c
     JOIN knowledge_source_version va ON va.id = c.version_a_id
     JOIN knowledge_source sa ON sa.id = va.source_id
     JOIN knowledge_source_version vb ON vb.id = c.version_b_id
     JOIN knowledge_source sb ON sb.id = vb.source_id
     WHERE c.tenant_id = $1 AND c.status = 'open'
     ORDER BY c.created_at ASC
     LIMIT 100`,
    [auth.tenantId]
  );
  const unresolved = await client.query(
    `SELECT id::text, normalized_question, example_question, occurrence_count, departments_asking,
            roles_asking, status, last_asked_at::text
     FROM ai_unresolved_question
     WHERE tenant_id = $1 AND status IN ('open', 'assigned')
     ORDER BY occurrence_count DESC, last_asked_at DESC
     LIMIT 200`,
    [auth.tenantId]
  );
  const reports = await client.query(
    `SELECT f.id::text, f.feedback_kind, f.note, f.created_at::text, m.question,
            reporter.full_name AS reporter_name
     FROM ai_message_feedback f
     JOIN ai_message m ON m.id = f.message_id
     LEFT JOIN app_user reporter ON reporter.id = f.user_id
     WHERE f.tenant_id = $1 AND f.review_status = 'open'
       AND f.feedback_kind IN ('report_incorrect', 'missing_information', 'source_outdated')
     ORDER BY f.created_at ASC
     LIMIT 200`,
    [auth.tenantId]
  );
  const failedIngestion = await client.query(
    `SELECT j.id::text, j.job_kind, j.status, j.attempts, j.error_message, j.created_at::text,
            s.title AS source_title, j.source_version_id::text
     FROM knowledge_ingestion_job j
     JOIN knowledge_source_version v ON v.id = j.source_version_id
     JOIN knowledge_source s ON s.id = v.source_id
     WHERE j.tenant_id = $1 AND j.status IN ('failed', 'needs_review', 'not_configured')
     ORDER BY j.created_at ASC
     LIMIT 100`,
    [auth.tenantId]
  );
  return {
    pending_versions: pending.rows,
    open_conflicts: conflicts.rows,
    unresolved_questions: unresolved.rows,
    open_reports: reports.rows,
    ingestion_attention: failedIngestion.rows
  };
}
