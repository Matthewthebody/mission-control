import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { createAuditLog } from "../audit.js";
import {
  buildVersionEligibilitySql,
  isKnowledgeReviewer,
  requireKnowledgeReviewer
} from "./knowledgeGovernance.js";
import { queueIngestionJob } from "./knowledgeIngestion.js";

// Ask Bailey knowledge authoring (charter H5).
//
// The operational desk behind Bailey: governed revisions, draft editing,
// source workspace queries, unresolved-question conversion, segment
// split/merge, and knowledge health. Every mutation is reviewer-gated in the
// service layer and audited with before/after state. The NON-NEGOTIABLE
// version rule lives here: approved content is never edited in place — a
// material change is a NEW draft version that supersedes the approved one
// only when IT is approved (approveKnowledgeVersion already performs the
// supersession atomically).

// ---------------------------------------------------------------------------
// Governed revisions (H5-C).
// ---------------------------------------------------------------------------
export async function createKnowledgeSourceVersion(
  client: PoolClient,
  auth: AuthUser,
  sourceId: string,
  input: { inlineBody?: string | null; note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const source = await client.query<{ id: string; title: string; current_version_id: string | null }>(
    `SELECT id::text, title, current_version_id::text FROM knowledge_source WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, sourceId]
  );
  if (!source.rows[0]) {
    throw new ApiError(404, "Knowledge source not found");
  }
  // Concurrency guard: one in-flight revision per source.
  const inFlight = await client.query(
    `SELECT id FROM knowledge_source_version
     WHERE tenant_id = $1 AND source_id = $2 AND publication_status IN ('draft', 'pending_review')
     LIMIT 1`,
    [auth.tenantId, sourceId]
  );
  if (inFlight.rows[0]) {
    throw new ApiError(409, "A draft or pending revision already exists for this source. Finish or reject it first.");
  }
  const template = await client.query<{
    id: string;
    version_number: number;
    source_type: string;
    authority_class: string;
    knowledge_mode: string;
    inline_body: string | null;
    department_scope: string[];
    role_scope: string[];
    confidential: boolean;
    review_due_at: string | null;
  }>(
    `SELECT id::text, version_number, source_type, authority_class, knowledge_mode, inline_body,
            department_scope, role_scope, confidential, review_due_at::text
     FROM knowledge_source_version
     WHERE tenant_id = $1 AND source_id = $2
     ORDER BY version_number DESC
     LIMIT 1`,
    [auth.tenantId, sourceId]
  );
  const previous = template.rows[0];
  if (!previous) {
    throw new ApiError(409, "This source has no versions to revise.");
  }
  // The new draft supersedes the CURRENT APPROVED version (if any) — which
  // keeps answering until this draft is approved.
  const supersedesId = source.rows[0].current_version_id;
  const created = await client.query<{ id: string; version_number: number }>(
    `INSERT INTO knowledge_source_version
       (tenant_id, source_id, version_number, source_type, authority_class, publication_status,
        knowledge_mode, inline_body, supersedes_version_id, department_scope, role_scope,
        confidential, review_due_at, submitted_by_user_id)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9::text[], $10::text[], $11, $12, $13)
     RETURNING id::text, version_number`,
    [
      auth.tenantId,
      sourceId,
      previous.version_number + 1,
      previous.source_type,
      previous.authority_class,
      previous.knowledge_mode,
      input.inlineBody !== undefined ? input.inlineBody : previous.inline_body,
      supersedesId,
      previous.department_scope,
      previous.role_scope,
      previous.confidential,
      previous.review_due_at,
      auth.id
    ]
  );
  const versionId = created.rows[0].id;
  const jobKind = ["training_video", "training_audio", "meeting_recording"].includes(previous.source_type)
    ? ("media_transcribe" as const)
    : ("document_extract" as const);
  await queueIngestionJob(client, auth.tenantId, versionId, jobKind, auth.id);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.revision_created",
    entityType: "knowledge_source_version",
    entityId: versionId,
    metadata: {
      source_id: sourceId,
      version_number: created.rows[0].version_number,
      supersedes_version_id: supersedesId,
      note: input.note ?? null
    }
  });
  return { version_id: versionId, version_number: created.rows[0].version_number, supersedes_version_id: supersedesId };
}

export async function updateDraftVersion(
  client: PoolClient,
  auth: AuthUser,
  versionId: string,
  input: {
    inlineBody?: string | null;
    authorityClass?: string;
    knowledgeMode?: string;
    departmentScope?: string[];
    roleScope?: string[];
    confidential?: boolean;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
    reviewDueAt?: string | null;
    note?: string | null;
  }
) {
  requireKnowledgeReviewer(auth);
  const existing = await client.query<{
    id: string;
    source_id: string;
    publication_status: string;
    inline_body: string | null;
    authority_class: string;
    knowledge_mode: string;
    source_type: string;
  }>(
    `SELECT id::text, source_id::text, publication_status, inline_body, authority_class, knowledge_mode, source_type
     FROM knowledge_source_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  const version = existing.rows[0];
  if (!version) {
    throw new ApiError(404, "Knowledge source version not found");
  }
  // The version rule: only unapproved work is editable in place.
  if (!["draft", "rejected"].includes(version.publication_status)) {
    throw new ApiError(409, `Only a draft or rejected version can be edited (current: ${version.publication_status}). Create a revision instead.`);
  }
  const updated = await client.query(
    `UPDATE knowledge_source_version
     SET inline_body = COALESCE($3, inline_body),
         authority_class = COALESCE($4, authority_class),
         knowledge_mode = COALESCE($5, knowledge_mode),
         department_scope = COALESCE($6::text[], department_scope),
         role_scope = COALESCE($7::text[], role_scope),
         confidential = COALESCE($8, confidential),
         effective_from = COALESCE($9, effective_from),
         effective_until = COALESCE($10, effective_until),
         review_due_at = COALESCE($11, review_due_at),
         publication_status = 'draft',
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text, publication_status, authority_class, knowledge_mode`,
    [
      auth.tenantId,
      versionId,
      input.inlineBody ?? null,
      input.authorityClass ?? null,
      input.knowledgeMode ?? null,
      input.departmentScope ?? null,
      input.roleScope ?? null,
      input.confidential ?? null,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.reviewDueAt ?? null
    ]
  );
  if (input.inlineBody !== undefined && input.inlineBody !== version.inline_body) {
    const jobKind = ["training_video", "training_audio", "meeting_recording"].includes(version.source_type)
      ? ("media_transcribe" as const)
      : ("document_extract" as const);
    await queueIngestionJob(client, auth.tenantId, versionId, jobKind, auth.id);
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.draft_updated",
    entityType: "knowledge_source_version",
    entityId: versionId,
    metadata: {
      note: input.note ?? null,
      before: { authority_class: version.authority_class, knowledge_mode: version.knowledge_mode },
      changed_fields: Object.keys(input).filter((key) => key !== "note")
    }
  });
  return updated.rows[0];
}

export async function updateKnowledgeSourceMeta(
  client: PoolClient,
  auth: AuthUser,
  sourceId: string,
  input: { title?: string; description?: string | null; ownerUserId?: string | null; departmentOwner?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const existing = await client.query<{ title: string; owner_user_id: string | null; department_owner: string | null }>(
    `SELECT title, owner_user_id::text, department_owner FROM knowledge_source WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, sourceId]
  );
  if (!existing.rows[0]) {
    throw new ApiError(404, "Knowledge source not found");
  }
  const updated = await client.query(
    `UPDATE knowledge_source
     SET title = COALESCE($3, title), description = COALESCE($4, description),
         owner_user_id = COALESCE($5, owner_user_id), department_owner = COALESCE($6, department_owner),
         updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text, title, owner_user_id::text, department_owner`,
    [auth.tenantId, sourceId, input.title ?? null, input.description ?? null, input.ownerUserId ?? null, input.departmentOwner ?? null]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.source_meta_updated",
    entityType: "knowledge_source",
    entityId: sourceId,
    metadata: { before: existing.rows[0], changed_fields: Object.keys(input) }
  });
  return updated.rows[0];
}

// ---------------------------------------------------------------------------
// Source workspace (H5-B).
// ---------------------------------------------------------------------------
export async function listKnowledgeSources(
  client: PoolClient,
  auth: AuthUser,
  filters: { query?: string; status?: string; authority?: string; mode?: string; limit?: number; offset?: number }
) {
  requireKnowledgeReviewer(auth);
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const clauses: string[] = ["s.tenant_id = $1"];
  const params: unknown[] = [auth.tenantId];
  if (filters.query) {
    params.push(`%${filters.query}%`);
    clauses.push(`s.title ILIKE $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`v.publication_status = $${params.length}`);
  }
  if (filters.authority) {
    params.push(filters.authority);
    clauses.push(`v.authority_class = $${params.length}`);
  }
  if (filters.mode) {
    params.push(filters.mode);
    clauses.push(`v.knowledge_mode = $${params.length}`);
  }
  const where = clauses.join(" AND ");
  const totalResult = await client.query<{ total: number }>(
    `SELECT count(DISTINCT s.id)::int AS total
     FROM knowledge_source s
     LEFT JOIN knowledge_source_version v ON v.id = COALESCE(s.current_version_id,
       (SELECT v2.id FROM knowledge_source_version v2 WHERE v2.source_id = s.id ORDER BY v2.version_number DESC LIMIT 1))
     WHERE ${where}`,
    params
  );
  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;
  const rows = await client.query(
    `SELECT s.id::text, s.title, s.department_owner, owner.full_name AS owner_name,
            v.id::text AS version_id, v.version_number, v.source_type, v.authority_class,
            v.publication_status, v.knowledge_mode, v.confidential, v.extraction_status,
            v.effective_until::text, v.review_due_at::text, s.updated_at::text
     FROM knowledge_source s
     LEFT JOIN knowledge_source_version v ON v.id = COALESCE(s.current_version_id,
       (SELECT v2.id FROM knowledge_source_version v2 WHERE v2.source_id = s.id ORDER BY v2.version_number DESC LIMIT 1))
     LEFT JOIN app_user owner ON owner.id = s.owner_user_id
     WHERE ${where}
     ORDER BY s.updated_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return { total: totalResult.rows[0]?.total ?? 0, sources: rows.rows, limit, offset };
}

/**
 * Dual-mode source detail (H5 source-detail requirement). Reviewers get the
 * full governance record; everyone else gets an eligibility-gated read-only
 * view (the destination for Ask Bailey source cards) — and an ineligible
 * source is an opaque 404, indistinguishable from nonexistent.
 */
export async function getKnowledgeSourceDetail(client: PoolClient, auth: AuthUser, sourceId: string) {
  if (!isKnowledgeReviewer(auth)) {
    const params: unknown[] = [auth.tenantId, sourceId];
    const planningEligibility = buildVersionEligibilitySql(auth, "planning", params);
    const historicalEligibility = buildVersionEligibilitySql(auth, "historical", params);
    const visible = await client.query(
      `SELECT s.id::text, s.title, s.description, s.resource_library_item_id::text,
              v.source_type, v.authority_class, v.knowledge_mode, v.approved_at::text,
              v.media_duration_seconds::float, v.id::text AS version_id
       FROM knowledge_source s
       JOIN knowledge_source_version v ON v.id = s.current_version_id AND v.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.id = $2
         AND ((${planningEligibility}) OR (${historicalEligibility}))
       LIMIT 1`,
      params
    );
    const source = visible.rows[0];
    if (!source) {
      throw new ApiError(404, "Knowledge source not found");
    }
    const segments = await client.query(
      `SELECT seg.id::text, seg.ordinal, seg.segment_kind, seg.heading, seg.locator_label,
              seg.start_seconds::float, seg.end_seconds::float
       FROM knowledge_segment seg
       WHERE seg.tenant_id = $1 AND seg.source_version_id = $2
         AND (seg.reviewer_classification IS NULL OR seg.reviewer_classification IN (
           'approved_instruction', 'approved_training', 'current_workflow_observation'
         ))
       ORDER BY seg.ordinal`,
      [auth.tenantId, source.version_id]
    );
    return { mode: "employee" as const, source, segments: segments.rows };
  }

  const source = await client.query(
    `SELECT s.id::text, s.title, s.description, s.department_owner, s.resource_library_item_id::text,
            s.current_version_id::text, owner.full_name AS owner_name, creator.full_name AS created_by_name,
            s.created_at::text, s.updated_at::text,
            item.file_name AS asset_file_name, item.content_type AS asset_content_type
     FROM knowledge_source s
     LEFT JOIN app_user owner ON owner.id = s.owner_user_id
     LEFT JOIN app_user creator ON creator.id = s.created_by_user_id
     LEFT JOIN resource_library_item item ON item.id = s.resource_library_item_id
     WHERE s.tenant_id = $1 AND s.id = $2 LIMIT 1`,
    [auth.tenantId, sourceId]
  );
  if (!source.rows[0]) {
    throw new ApiError(404, "Knowledge source not found");
  }
  const versions = await client.query(
    `SELECT v.id::text, v.version_number, v.source_type, v.authority_class, v.publication_status,
            v.knowledge_mode, v.confidential, v.department_scope, v.role_scope,
            v.effective_from::text, v.effective_until::text, v.review_due_at::text,
            v.supersedes_version_id::text, v.superseded_by_version_id::text,
            v.extraction_status, v.media_duration_seconds::float, v.inline_body,
            v.approved_at::text, approver.full_name AS approved_by_name, v.review_notes, v.created_at::text
     FROM knowledge_source_version v
     LEFT JOIN app_user approver ON approver.id = v.approved_by_user_id
     WHERE v.tenant_id = $1 AND v.source_id = $2
     ORDER BY v.version_number DESC`,
    [auth.tenantId, sourceId]
  );
  const embeddingHealth = await client.query(
    `SELECT e.status, count(*)::int AS n
     FROM knowledge_segment_embedding e
     JOIN knowledge_source_version v ON v.id = e.source_version_id
     WHERE e.tenant_id = $1 AND v.source_id = $2
     GROUP BY e.status`,
    [auth.tenantId, sourceId]
  );
  const jobs = await client.query(
    `SELECT j.id::text, j.source_version_id::text, j.job_kind, j.status, j.attempts, j.error_message, j.provider, j.created_at::text
     FROM knowledge_ingestion_job j
     JOIN knowledge_source_version v ON v.id = j.source_version_id
     WHERE j.tenant_id = $1 AND v.source_id = $2
     ORDER BY j.created_at DESC LIMIT 20`,
    [auth.tenantId, sourceId]
  );
  const conflicts = await client.query(
    `SELECT c.id::text, c.status, c.note, c.resolution_note, c.created_at::text,
            c.version_a_id::text, c.version_b_id::text
     FROM knowledge_source_conflict c
     WHERE c.tenant_id = $1 AND (
       c.version_a_id IN (SELECT id FROM knowledge_source_version WHERE source_id = $2)
       OR c.version_b_id IN (SELECT id FROM knowledge_source_version WHERE source_id = $2)
     )
     ORDER BY c.created_at DESC LIMIT 20`,
    [auth.tenantId, sourceId]
  );
  const usage = await client.query<{ citations: number }>(
    `SELECT count(*)::int AS citations
     FROM ai_message_citation c
     JOIN knowledge_source_version v ON v.id = c.source_version_id
     WHERE c.tenant_id = $1 AND v.source_id = $2`,
    [auth.tenantId, sourceId]
  );
  const reports = await client.query(
    `SELECT f.id::text, f.feedback_kind, f.note, f.review_status, f.created_at::text
     FROM ai_message_feedback f
     WHERE f.tenant_id = $1
       AND f.feedback_kind IN ('report_incorrect', 'source_outdated', 'missing_information')
       AND f.message_id IN (
         SELECT DISTINCT c.message_id FROM ai_message_citation c
         JOIN knowledge_source_version v ON v.id = c.source_version_id
         WHERE c.tenant_id = $1 AND v.source_id = $2
       )
     ORDER BY f.created_at DESC LIMIT 20`,
    [auth.tenantId, sourceId]
  );
  const audit = await client.query(
    `SELECT a.action, a.created_at::text, actor.full_name AS actor_name, a.metadata
     FROM audit_log a
     LEFT JOIN app_user actor ON actor.id = a.actor_user_id
     WHERE a.tenant_id = $1 AND (
       (a.entity_type = 'knowledge_source' AND a.entity_id = $2::text)
       OR (a.entity_type = 'knowledge_source_version' AND a.entity_id IN (
         SELECT id::text FROM knowledge_source_version WHERE source_id = $2::uuid
       ))
     )
     ORDER BY a.created_at DESC LIMIT 30`,
    [auth.tenantId, sourceId]
  );
  return {
    mode: "reviewer" as const,
    source: source.rows[0],
    versions: versions.rows,
    embedding_health: embeddingHealth.rows,
    jobs: jobs.rows,
    conflicts: conflicts.rows,
    usage: usage.rows[0] ?? { citations: 0 },
    reports: reports.rows,
    audit: audit.rows
  };
}

// ---------------------------------------------------------------------------
// Unresolved question → draft guidance (H5-E). Draft until approved — always.
// ---------------------------------------------------------------------------
export async function convertUnresolvedQuestionToDraft(
  client: PoolClient,
  auth: AuthUser,
  questionId: string,
  input: { title: string; body: string; departmentOwner?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const question = await client.query<{ id: string; example_question: string; status: string }>(
    `SELECT id::text, example_question, status FROM ai_unresolved_question
     WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, questionId]
  );
  if (!question.rows[0]) {
    throw new ApiError(404, "Unresolved question not found");
  }
  if (!["open", "assigned"].includes(question.rows[0].status)) {
    throw new ApiError(409, "Only an open or assigned question can be converted.");
  }
  // Reuse the ONE creation path — the draft goes through the normal lifecycle.
  const { createKnowledgeSource } = await import("./knowledgeGovernance.js");
  const created = await createKnowledgeSource(client, auth, {
    title: input.title,
    description: `Draft expert guidance created from the unresolved employee question: "${question.rows[0].example_question}". The original question remains evidence, not policy.`,
    sourceType: "verified_expert_answer",
    authorityClass: "approved_expert_guidance",
    inlineBody: input.body,
    departmentOwner: input.departmentOwner ?? null
  });
  await queueIngestionJob(client, auth.tenantId, created.version_id, "document_extract", auth.id);
  await client.query(
    `UPDATE ai_unresolved_question
     SET status = 'assigned', assigned_owner_user_id = $3, proposed_source_version_id = $4, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, questionId, auth.id, created.version_id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.question_converted_to_draft",
    entityType: "ai_unresolved_question",
    entityId: questionId,
    metadata: { source_id: created.source_id, version_id: created.version_id, title: input.title }
  });
  return { source_id: created.source_id, version_id: created.version_id };
}

// ---------------------------------------------------------------------------
// Segment split / merge (H5-F). No fabricated evidence: transcript splits
// require a reviewer-supplied boundary inside the segment's REAL time range;
// merges take the union of two real adjacent ranges. Word timings are cleared
// (no longer reliable); embeddings for replaced rows CASCADE away and the new
// rows re-embed on the next sweep.
// ---------------------------------------------------------------------------
type SegmentRow = {
  id: string;
  source_version_id: string;
  ordinal: number;
  segment_kind: string;
  heading: string | null;
  locator_label: string | null;
  content: string;
  start_seconds: number | null;
  end_seconds: number | null;
  speaker_label: string | null;
  reviewer_classification: string | null;
  review_notes: string | null;
  publication_status: string;
};

async function loadSegmentForEdit(client: PoolClient, auth: AuthUser, segmentId: string): Promise<SegmentRow> {
  const { rows } = await client.query<SegmentRow>(
    `SELECT seg.id::text, seg.source_version_id::text, seg.ordinal, seg.segment_kind, seg.heading,
            seg.locator_label, seg.content, seg.start_seconds::float, seg.end_seconds::float,
            seg.speaker_label, seg.reviewer_classification, seg.review_notes, v.publication_status
     FROM knowledge_segment seg
     JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
     WHERE seg.tenant_id = $1 AND seg.id = $2 LIMIT 1`,
    [auth.tenantId, segmentId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Knowledge segment not found");
  }
  return rows[0];
}

function requireEditReason(segment: SegmentRow, note: string | null | undefined) {
  if (segment.publication_status === "approved" && !(note && note.trim())) {
    throw new ApiError(400, "Editing segments of an approved version requires a note explaining the change.");
  }
}

function clockLabel(startSeconds: number, endSeconds: number): string {
  const clock = (total: number) =>
    `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
  return `${clock(startSeconds)}–${clock(endSeconds)}`;
}

async function shiftOrdinalsUp(client: PoolClient, tenantId: string, versionId: string, aboveOrdinal: number) {
  const { rows } = await client.query<{ id: string; ordinal: number }>(
    `SELECT id::text, ordinal FROM knowledge_segment
     WHERE tenant_id = $1 AND source_version_id = $2 AND ordinal > $3
     ORDER BY ordinal DESC`,
    [tenantId, versionId, aboveOrdinal]
  );
  for (const row of rows) {
    await client.query(`UPDATE knowledge_segment SET ordinal = $3 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      row.id,
      row.ordinal + 1
    ]);
  }
}

async function shiftOrdinalsDown(client: PoolClient, tenantId: string, versionId: string, aboveOrdinal: number) {
  const { rows } = await client.query<{ id: string; ordinal: number }>(
    `SELECT id::text, ordinal FROM knowledge_segment
     WHERE tenant_id = $1 AND source_version_id = $2 AND ordinal > $3
     ORDER BY ordinal ASC`,
    [tenantId, versionId, aboveOrdinal]
  );
  for (const row of rows) {
    await client.query(`UPDATE knowledge_segment SET ordinal = $3 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      row.id,
      row.ordinal - 1
    ]);
  }
}

export async function splitSegment(
  client: PoolClient,
  auth: AuthUser,
  segmentId: string,
  input: { offsetChars?: number; splitSeconds?: number; note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const segment = await loadSegmentForEdit(client, auth, segmentId);
  requireEditReason(segment, input.note);

  const offset = input.offsetChars ?? Math.floor(segment.content.length / 2);
  if (offset < 5 || offset > segment.content.length - 5) {
    throw new ApiError(400, "The split point must leave meaningful text on both sides.");
  }
  const firstText = segment.content.slice(0, offset).trim();
  const secondText = segment.content.slice(offset).trim();
  if (!firstText || !secondText) {
    throw new ApiError(400, "The split point must leave meaningful text on both sides.");
  }

  let firstRange: [number | null, number | null] = [segment.start_seconds, segment.end_seconds];
  let secondRange: [number | null, number | null] = [segment.start_seconds, segment.end_seconds];
  if (segment.start_seconds !== null && segment.end_seconds !== null) {
    // Timestamped segments need a reviewer-supplied boundary INSIDE the real
    // range — the system never invents a timestamp.
    const boundary = input.splitSeconds;
    if (boundary === undefined || boundary <= segment.start_seconds || boundary >= segment.end_seconds) {
      throw new ApiError(400, "Splitting a timestamped segment requires split_seconds strictly inside its time range.");
    }
    firstRange = [segment.start_seconds, boundary];
    secondRange = [boundary, segment.end_seconds];
  }

  await shiftOrdinalsUp(client, auth.tenantId, segment.source_version_id, segment.ordinal);
  await client.query(`DELETE FROM knowledge_segment WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, segmentId]);

  const inserted: string[] = [];
  const parts: Array<{ text: string; range: [number | null, number | null]; ordinal: number }> = [
    { text: firstText, range: firstRange, ordinal: segment.ordinal },
    { text: secondText, range: secondRange, ordinal: segment.ordinal + 1 }
  ];
  for (const part of parts) {
    const locator =
      part.range[0] !== null && part.range[1] !== null && segment.segment_kind === "transcript"
        ? clockLabel(part.range[0], part.range[1])
        : `${segment.locator_label ?? "Segment"} (split)`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO knowledge_segment
         (tenant_id, source_version_id, ordinal, segment_kind, heading, locator_label, content,
          start_seconds, end_seconds, speaker_label, reviewer_classification, review_notes, original_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id::text`,
      [
        auth.tenantId,
        segment.source_version_id,
        part.ordinal,
        segment.segment_kind,
        segment.heading,
        locator,
        part.text,
        part.range[0],
        part.range[1],
        segment.speaker_label,
        segment.reviewer_classification,
        segment.review_notes,
        segment.content
      ]
    );
    inserted.push(rows[0].id);
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.segment_split",
    entityType: "knowledge_segment",
    entityId: segmentId,
    metadata: {
      version_id: segment.source_version_id,
      note: input.note ?? null,
      before: { content: segment.content, start_seconds: segment.start_seconds, end_seconds: segment.end_seconds },
      after_segment_ids: inserted,
      split_seconds: input.splitSeconds ?? null,
      offset_chars: offset
    }
  });
  return { segment_ids: inserted };
}

export async function mergeSegmentWithNext(
  client: PoolClient,
  auth: AuthUser,
  segmentId: string,
  input: { note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const first = await loadSegmentForEdit(client, auth, segmentId);
  requireEditReason(first, input.note);
  const next = await client.query<SegmentRow>(
    `SELECT seg.id::text, seg.source_version_id::text, seg.ordinal, seg.segment_kind, seg.heading,
            seg.locator_label, seg.content, seg.start_seconds::float, seg.end_seconds::float,
            seg.speaker_label, seg.reviewer_classification, seg.review_notes, v.publication_status
     FROM knowledge_segment seg
     JOIN knowledge_source_version v ON v.id = seg.source_version_id AND v.tenant_id = seg.tenant_id
     WHERE seg.tenant_id = $1 AND seg.source_version_id = $2 AND seg.ordinal = $3 AND seg.segment_kind = $4
     LIMIT 1`,
    [auth.tenantId, first.source_version_id, first.ordinal + 1, first.segment_kind]
  );
  const second = next.rows[0];
  if (!second) {
    throw new ApiError(404, "No adjacent segment of the same kind to merge with.");
  }

  const mergedContent = `${first.content.trim()}${first.segment_kind === "transcript" ? " " : "\n\n"}${second.content.trim()}`;
  const start = first.start_seconds;
  const end = second.end_seconds ?? first.end_seconds;
  const locator =
    start !== null && end !== null && first.segment_kind === "transcript"
      ? clockLabel(start, end)
      : `${first.locator_label ?? "Segment"} (merged)`;

  await client.query(`DELETE FROM knowledge_segment WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
    auth.tenantId,
    [first.id, second.id]
  ]);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO knowledge_segment
       (tenant_id, source_version_id, ordinal, segment_kind, heading, locator_label, content,
        start_seconds, end_seconds, speaker_label, reviewer_classification, review_notes, original_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id::text`,
    [
      auth.tenantId,
      first.source_version_id,
      first.ordinal,
      first.segment_kind,
      first.heading,
      locator,
      mergedContent,
      start,
      end,
      first.speaker_label,
      first.reviewer_classification,
      first.review_notes,
      `${first.content}\n---\n${second.content}`
    ]
  );
  await shiftOrdinalsDown(client, auth.tenantId, first.source_version_id, first.ordinal + 1);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.segment_merged",
    entityType: "knowledge_segment",
    entityId: rows[0].id,
    metadata: {
      version_id: first.source_version_id,
      note: input.note ?? null,
      merged_segment_ids: [first.id, second.id],
      before: {
        first: { content: first.content, start_seconds: first.start_seconds, end_seconds: first.end_seconds },
        second: { content: second.content, start_seconds: second.start_seconds, end_seconds: second.end_seconds }
      }
    }
  });
  return { segment_id: rows[0].id };
}

// ---------------------------------------------------------------------------
// Knowledge health (H5-G). Descriptive product metrics only.
// ---------------------------------------------------------------------------
export async function getKnowledgeHealth(client: PoolClient, auth: AuthUser) {
  requireKnowledgeReviewer(auth);
  const counts = await client.query<{
    active_approved: number;
    pending_review: number;
    overdue_review: number;
    expiring_soon: number;
    open_conflicts: number;
    failed_ingestion: number;
    failed_embeddings: number;
    open_questions: number;
    open_reports: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM knowledge_source_version v WHERE v.tenant_id = $1 AND v.publication_status = 'approved' AND v.superseded_by_version_id IS NULL) AS active_approved,
       (SELECT count(*)::int FROM knowledge_source_version v WHERE v.tenant_id = $1 AND v.publication_status = 'pending_review') AS pending_review,
       (SELECT count(*)::int FROM knowledge_source_version v WHERE v.tenant_id = $1 AND v.publication_status = 'approved' AND v.superseded_by_version_id IS NULL AND v.review_due_at IS NOT NULL AND v.review_due_at < CURRENT_DATE) AS overdue_review,
       (SELECT count(*)::int FROM knowledge_source_version v WHERE v.tenant_id = $1 AND v.publication_status = 'approved' AND v.superseded_by_version_id IS NULL AND v.effective_until IS NOT NULL AND v.effective_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS expiring_soon,
       (SELECT count(*)::int FROM knowledge_source_conflict c WHERE c.tenant_id = $1 AND c.status = 'open') AS open_conflicts,
       (SELECT count(*)::int FROM knowledge_ingestion_job j WHERE j.tenant_id = $1 AND j.status IN ('failed', 'not_configured')) AS failed_ingestion,
       (SELECT count(*)::int FROM knowledge_segment_embedding e WHERE e.tenant_id = $1 AND e.status = 'failed') AS failed_embeddings,
       (SELECT count(*)::int FROM ai_unresolved_question q WHERE q.tenant_id = $1 AND q.status IN ('open', 'assigned')) AS open_questions,
       (SELECT count(*)::int FROM ai_message_feedback f WHERE f.tenant_id = $1 AND f.review_status = 'open' AND f.feedback_kind IN ('report_incorrect', 'missing_information', 'source_outdated')) AS open_reports`,
    [auth.tenantId]
  );
  const topUnanswered = await client.query(
    `SELECT example_question, occurrence_count, last_asked_at::text
     FROM ai_unresolved_question WHERE tenant_id = $1 AND status IN ('open', 'assigned')
     ORDER BY occurrence_count DESC, last_asked_at DESC LIMIT 5`,
    [auth.tenantId]
  );
  const mostCited = await client.query(
    `SELECT s.id::text, s.title, count(*)::int AS citations
     FROM ai_message_citation c
     JOIN knowledge_source_version v ON v.id = c.source_version_id
     JOIN knowledge_source s ON s.id = v.source_id
     WHERE c.tenant_id = $1
     GROUP BY s.id, s.title
     ORDER BY citations DESC LIMIT 5`,
    [auth.tenantId]
  );
  const mostReported = await client.query(
    `SELECT s.id::text, s.title, count(*)::int AS reports
     FROM ai_message_feedback f
     JOIN ai_message_citation c ON c.message_id = f.message_id AND c.tenant_id = f.tenant_id
     JOIN knowledge_source_version v ON v.id = c.source_version_id
     JOIN knowledge_source s ON s.id = v.source_id
     WHERE f.tenant_id = $1 AND f.feedback_kind IN ('report_incorrect', 'source_outdated')
     GROUP BY s.id, s.title
     ORDER BY reports DESC LIMIT 5`,
    [auth.tenantId]
  );
  return {
    counts: counts.rows[0],
    top_unanswered: topUnanswered.rows,
    most_cited: mostCited.rows,
    most_reported: mostReported.rows
  };
}
