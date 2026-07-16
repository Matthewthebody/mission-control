import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../../authz/authority.js";
import { isActiveMembership } from "../../authz/policy.js";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { createAuditLog } from "../audit.js";
import { buildProtectedMediaUrl } from "../knowledge/knowledgeMedia.js";

// Ask Bailey H6 — Fall Field Coach role-based training.
//
// The governed lesson layer built ON TOP of approved Ask Bailey knowledge. It
// reuses the knowledge-governance shape (draft → pending_review → approved →
// superseded/retired) and the migration-012 training-state authority model.
//
// Non-negotiables encoded here:
//  * A lesson only teaches through an APPROVED, effective, non-retired version.
//  * AI may DRAFT sections/questions (ai_drafted flag) but approval is a human
//    act — an ai_drafted version still has to be submitted and approved.
//  * Assignments PIN an exact lesson_version, so retiring/revising a lesson
//    never silently changes what an in-flight assignment teaches.
//  * Readiness scoring maps every question to reviewable approved content and
//    frames results as coaching. Nothing here creates discipline or ranking.

// ---------------------------------------------------------------------------
// Authority — mirrors services/training.ts canManageTraining and the API's
// knowledge reviewer gate. Managers create/approve/assign; employees act only
// on their own assignments.
// ---------------------------------------------------------------------------
export function isTrainingManager(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function requireTrainingManager(auth: AuthUser) {
  if (!isActiveMembership(auth) || !isTrainingManager(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}

type Choice = { id: string; label: string; correct: boolean; explanation?: string };
type SectionInput = {
  title: string;
  section_kind?: "reading" | "video_clip" | "checklist" | "scenario";
  body?: string | null;
  knowledge_source_version_id?: string | null;
  knowledge_segment_id?: string | null;
  media_start_seconds?: number | null;
  media_end_seconds?: number | null;
};
type QuestionInput = {
  prompt: string;
  scenario?: string | null;
  choices: Choice[];
  review_section_ordinal?: number | null;
  knowledge_segment_id?: string | null;
  allow_open_text?: boolean;
};

// ---------------------------------------------------------------------------
// Segment/source integrity — a section that claims a knowledge segment must
// reference a real segment in this tenant, and the media timestamps must sit
// inside that segment's real range (timestamps are never invented).
// ---------------------------------------------------------------------------
async function resolveSectionSource(client: PoolClient, tenantId: string, section: SectionInput) {
  if (!section.knowledge_segment_id) {
    return { source_version_id: section.knowledge_source_version_id ?? null, start: null as number | null, end: null as number | null };
  }
  const seg = await client.query<{
    id: string;
    source_version_id: string;
    start_seconds: number | null;
    end_seconds: number | null;
  }>(
    `SELECT id::text, source_version_id::text, start_seconds, end_seconds
     FROM knowledge_segment WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, section.knowledge_segment_id]
  );
  if (!seg.rows[0]) {
    throw new ApiError(400, "Section references a knowledge segment that does not exist.");
  }
  const row = seg.rows[0];
  let start = section.media_start_seconds ?? null;
  let end = section.media_end_seconds ?? null;
  if (start !== null || end !== null) {
    if (row.start_seconds === null || row.end_seconds === null) {
      throw new ApiError(400, "This segment has no timestamps; a video clip range cannot be attached.");
    }
    const lo = Number(row.start_seconds);
    const hi = Number(row.end_seconds);
    if (start === null) start = lo;
    if (end === null) end = hi;
    if (start < lo || end > hi || start > end) {
      throw new ApiError(400, `Clip range must sit inside the segment's real range (${lo}–${hi}s).`);
    }
  }
  return { source_version_id: row.source_version_id, start, end };
}

async function insertSectionsAndQuestions(
  client: PoolClient,
  tenantId: string,
  versionId: string,
  sections: SectionInput[],
  questions: QuestionInput[]
) {
  const sectionIds: string[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const resolved = await resolveSectionSource(client, tenantId, section);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO training_lesson_section
         (tenant_id, lesson_version_id, ordinal, section_kind, title, body,
          knowledge_source_version_id, knowledge_segment_id, media_start_seconds, media_end_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`,
      [
        tenantId,
        versionId,
        i,
        section.section_kind ?? "reading",
        section.title,
        section.body ?? null,
        resolved.source_version_id,
        section.knowledge_segment_id ?? null,
        resolved.start,
        resolved.end
      ]
    );
    sectionIds.push(rows[0].id);
  }
  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    if (!Array.isArray(question.choices) || (!question.allow_open_text && question.choices.length < 2)) {
      throw new ApiError(400, "Each multiple-choice question needs at least two choices.");
    }
    if (!question.allow_open_text && !question.choices.some((choice) => choice.correct)) {
      throw new ApiError(400, "Each scored question must mark a correct choice (the visible rubric).");
    }
    const reviewSectionId =
      question.review_section_ordinal != null && sectionIds[question.review_section_ordinal]
        ? sectionIds[question.review_section_ordinal]
        : null;
    await client.query(
      `INSERT INTO training_lesson_question
         (tenant_id, lesson_version_id, ordinal, prompt, scenario, choices, review_section_id, knowledge_segment_id, allow_open_text)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [
        tenantId,
        versionId,
        i,
        question.prompt,
        question.scenario ?? null,
        JSON.stringify(question.choices),
        reviewSectionId,
        question.knowledge_segment_id ?? null,
        Boolean(question.allow_open_text)
      ]
    );
  }
  return sectionIds;
}

// ---------------------------------------------------------------------------
// H6-B — Governed lesson creation. Always mints a DRAFT v1.
// ---------------------------------------------------------------------------
export async function createLesson(
  client: PoolClient,
  auth: AuthUser,
  input: {
    title: string;
    objective?: string | null;
    intended_role?: string | null;
    intended_department?: string | null;
    prerequisite_lesson_id?: string | null;
    pass_threshold_percent?: number;
    ai_drafted?: boolean;
    is_demo?: boolean;
    sections?: SectionInput[];
    questions?: QuestionInput[];
  }
) {
  requireTrainingManager(auth);
  if (!input.title || !input.title.trim()) {
    throw new ApiError(400, "A lesson title is required.");
  }
  const lesson = await client.query<{ id: string }>(
    `INSERT INTO training_lesson
       (tenant_id, title, objective, intended_role, intended_department, prerequisite_lesson_id, owner_user_id, is_demo, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7) RETURNING id::text`,
    [
      auth.tenantId,
      input.title.trim(),
      input.objective ?? null,
      input.intended_role ?? null,
      input.intended_department ?? null,
      input.prerequisite_lesson_id ?? null,
      auth.id,
      Boolean(input.is_demo)
    ]
  );
  const lessonId = lesson.rows[0].id;
  const version = await client.query<{ id: string }>(
    `INSERT INTO training_lesson_version
       (tenant_id, lesson_id, version_number, publication_status, authored_by_user_id, ai_drafted, pass_threshold_percent, created_by_user_id)
     VALUES ($1,$2,1,'draft',$3,$4,$5,$3) RETURNING id::text`,
    [auth.tenantId, lessonId, auth.id, Boolean(input.ai_drafted), input.pass_threshold_percent ?? 80]
  );
  const versionId = version.rows[0].id;
  await insertSectionsAndQuestions(client, auth.tenantId, versionId, input.sections ?? [], input.questions ?? []);
  // current_version_id stays NULL until a version is approved — a draft is never
  // the "current" (assignable) version. approveLessonVersion sets it.
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.created",
    entityType: "training_lesson",
    entityId: lessonId,
    metadata: { version_id: versionId, ai_drafted: Boolean(input.ai_drafted) }
  });
  return { lesson_id: lessonId, version_id: versionId };
}

// ---------------------------------------------------------------------------
// Governed revision — new draft version, refuses a second in-flight draft.
// ---------------------------------------------------------------------------
export async function createLessonRevision(
  client: PoolClient,
  auth: AuthUser,
  lessonId: string,
  input: { copyFromCurrent?: boolean; ai_drafted?: boolean; note?: string | null }
) {
  requireTrainingManager(auth);
  const lesson = await client.query<{ id: string; current_version_id: string | null }>(
    `SELECT id::text, current_version_id::text FROM training_lesson WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, lessonId]
  );
  if (!lesson.rows[0]) throw new ApiError(404, "Lesson not found");
  const inFlight = await client.query(
    `SELECT id FROM training_lesson_version
     WHERE tenant_id = $1 AND lesson_id = $2 AND publication_status IN ('draft', 'pending_review') LIMIT 1`,
    [auth.tenantId, lessonId]
  );
  if (inFlight.rows[0]) {
    throw new ApiError(409, "A draft or pending revision already exists for this lesson. Finish or reject it first.");
  }
  const latest = await client.query<{ id: string; version_number: number; pass_threshold_percent: number }>(
    `SELECT id::text, version_number, pass_threshold_percent FROM training_lesson_version
     WHERE tenant_id = $1 AND lesson_id = $2 ORDER BY version_number DESC LIMIT 1`,
    [auth.tenantId, lessonId]
  );
  const previous = latest.rows[0];
  const approved = lesson.rows[0].current_version_id;
  const version = await client.query<{ id: string }>(
    `INSERT INTO training_lesson_version
       (tenant_id, lesson_id, version_number, publication_status, authored_by_user_id, ai_drafted, pass_threshold_percent, supersedes_version_id, review_notes, created_by_user_id)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$4) RETURNING id::text`,
    [
      auth.tenantId,
      lessonId,
      (previous?.version_number ?? 0) + 1,
      auth.id,
      Boolean(input.ai_drafted),
      previous?.pass_threshold_percent ?? 80,
      approved,
      input.note ?? null
    ]
  );
  const versionId = version.rows[0].id;
  if (input.copyFromCurrent && previous) {
    await copyContent(client, auth.tenantId, previous.id, versionId);
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.revision_created",
    entityType: "training_lesson",
    entityId: lessonId,
    metadata: { version_id: versionId, supersedes: approved }
  });
  return { version_id: versionId };
}

async function copyContent(client: PoolClient, tenantId: string, fromVersionId: string, toVersionId: string) {
  const sections = await client.query<{
    ordinal: number;
    section_kind: string;
    title: string;
    body: string | null;
    knowledge_source_version_id: string | null;
    knowledge_segment_id: string | null;
    media_start_seconds: number | null;
    media_end_seconds: number | null;
    id: string;
  }>(
    `SELECT id::text, ordinal, section_kind, title, body, knowledge_source_version_id::text, knowledge_segment_id::text,
            media_start_seconds, media_end_seconds
     FROM training_lesson_section WHERE tenant_id = $1 AND lesson_version_id = $2 ORDER BY ordinal`,
    [tenantId, fromVersionId]
  );
  const idMap = new Map<string, string>();
  for (const s of sections.rows) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO training_lesson_section
         (tenant_id, lesson_version_id, ordinal, section_kind, title, body, knowledge_source_version_id, knowledge_segment_id, media_start_seconds, media_end_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`,
      [tenantId, toVersionId, s.ordinal, s.section_kind, s.title, s.body, s.knowledge_source_version_id, s.knowledge_segment_id, s.media_start_seconds, s.media_end_seconds]
    );
    idMap.set(s.id, inserted.rows[0].id);
  }
  const questions = await client.query<{
    ordinal: number;
    prompt: string;
    scenario: string | null;
    choices: unknown;
    review_section_id: string | null;
    knowledge_segment_id: string | null;
    allow_open_text: boolean;
  }>(
    `SELECT ordinal, prompt, scenario, choices, review_section_id::text, knowledge_segment_id::text, allow_open_text
     FROM training_lesson_question WHERE tenant_id = $1 AND lesson_version_id = $2 ORDER BY ordinal`,
    [tenantId, fromVersionId]
  );
  for (const q of questions.rows) {
    await client.query(
      `INSERT INTO training_lesson_question
         (tenant_id, lesson_version_id, ordinal, prompt, scenario, choices, review_section_id, knowledge_segment_id, allow_open_text)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [
        tenantId,
        toVersionId,
        q.ordinal,
        q.prompt,
        q.scenario,
        JSON.stringify(q.choices ?? []),
        q.review_section_id ? idMap.get(q.review_section_id) ?? null : null,
        q.knowledge_segment_id,
        q.allow_open_text
      ]
    );
  }
}

// Replace draft content (draft/rejected only). Approved is never edited in place.
export async function replaceDraftContent(
  client: PoolClient,
  auth: AuthUser,
  versionId: string,
  input: { sections: SectionInput[]; questions: QuestionInput[]; pass_threshold_percent?: number }
) {
  requireTrainingManager(auth);
  const version = await client.query<{ id: string; publication_status: string; lesson_id: string }>(
    `SELECT id::text, publication_status, lesson_id::text FROM training_lesson_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  if (!version.rows[0]) throw new ApiError(404, "Lesson version not found");
  if (!["draft", "rejected"].includes(version.rows[0].publication_status)) {
    throw new ApiError(409, "Only draft or rejected lesson versions can be edited. Approved content needs a new revision.");
  }
  await client.query(`DELETE FROM training_lesson_section WHERE tenant_id = $1 AND lesson_version_id = $2`, [auth.tenantId, versionId]);
  await client.query(`DELETE FROM training_lesson_question WHERE tenant_id = $1 AND lesson_version_id = $2`, [auth.tenantId, versionId]);
  await insertSectionsAndQuestions(client, auth.tenantId, versionId, input.sections ?? [], input.questions ?? []);
  await client.query(
    `UPDATE training_lesson_version SET publication_status = 'draft',
       pass_threshold_percent = COALESCE($3, pass_threshold_percent), updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, input.pass_threshold_percent ?? null]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.draft_updated",
    entityType: "training_lesson_version",
    entityId: versionId
  });
  return { version_id: versionId };
}

export async function submitLessonVersion(client: PoolClient, auth: AuthUser, versionId: string) {
  requireTrainingManager(auth);
  const version = await client.query<{ publication_status: string }>(
    `SELECT publication_status FROM training_lesson_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  if (!version.rows[0]) throw new ApiError(404, "Lesson version not found");
  if (!["draft", "rejected"].includes(version.rows[0].publication_status)) {
    throw new ApiError(409, "Only a draft or rejected version can be submitted for review.");
  }
  const sectionCount = await client.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM training_lesson_section WHERE tenant_id = $1 AND lesson_version_id = $2`,
    [auth.tenantId, versionId]
  );
  if (Number(sectionCount.rows[0].n) === 0) {
    throw new ApiError(400, "A lesson needs at least one source-backed section before review.");
  }
  await client.query(
    `UPDATE training_lesson_version SET publication_status = 'pending_review', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.submitted",
    entityType: "training_lesson_version",
    entityId: versionId
  });
  return { version_id: versionId };
}

// Approval supersedes the prior approved version atomically.
export async function approveLessonVersion(
  client: PoolClient,
  auth: AuthUser,
  versionId: string,
  input: { effective_from?: string | null; review_due_at?: string | null } = {}
) {
  requireTrainingManager(auth);
  const version = await client.query<{ id: string; lesson_id: string; publication_status: string; supersedes_version_id: string | null }>(
    `SELECT id::text, lesson_id::text, publication_status, supersedes_version_id::text
     FROM training_lesson_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  if (!version.rows[0]) throw new ApiError(404, "Lesson version not found");
  if (version.rows[0].publication_status !== "pending_review") {
    throw new ApiError(409, "Only a version pending review can be approved.");
  }
  const lessonId = version.rows[0].lesson_id;
  const priorApproved = await client.query<{ id: string }>(
    `SELECT id::text FROM training_lesson_version
     WHERE tenant_id = $1 AND lesson_id = $2 AND publication_status = 'approved'`,
    [auth.tenantId, lessonId]
  );
  await client.query(
    `UPDATE training_lesson_version
       SET publication_status = 'approved', approved_by_user_id = $3, approved_at = now(),
           effective_from = COALESCE($4, now()), review_due_at = $5, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, auth.id, input.effective_from ?? null, input.review_due_at ?? null]
  );
  for (const prior of priorApproved.rows) {
    await client.query(
      `UPDATE training_lesson_version
         SET publication_status = 'superseded', superseded_by_version_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, prior.id, versionId]
    );
  }
  await client.query(`UPDATE training_lesson SET current_version_id = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`, [
    versionId,
    auth.tenantId,
    lessonId
  ]);
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.approved",
    entityType: "training_lesson_version",
    entityId: versionId,
    metadata: { superseded: priorApproved.rows.map((r) => r.id) }
  });
  return { version_id: versionId, superseded: priorApproved.rows.map((r) => r.id) };
}

export async function rejectLessonVersion(client: PoolClient, auth: AuthUser, versionId: string, note: string) {
  requireTrainingManager(auth);
  const version = await client.query<{ publication_status: string }>(
    `SELECT publication_status FROM training_lesson_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  if (!version.rows[0]) throw new ApiError(404, "Lesson version not found");
  if (version.rows[0].publication_status !== "pending_review") {
    throw new ApiError(409, "Only a version pending review can be sent back.");
  }
  await client.query(
    `UPDATE training_lesson_version SET publication_status = 'rejected', review_notes = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, note]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.rejected",
    entityType: "training_lesson_version",
    entityId: versionId,
    metadata: { note }
  });
  return { version_id: versionId };
}

export async function retireLessonVersion(client: PoolClient, auth: AuthUser, versionId: string, note?: string | null) {
  requireTrainingManager(auth);
  const version = await client.query<{ lesson_id: string; publication_status: string }>(
    `SELECT lesson_id::text, publication_status FROM training_lesson_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, versionId]
  );
  if (!version.rows[0]) throw new ApiError(404, "Lesson version not found");
  if (version.rows[0].publication_status !== "approved") {
    throw new ApiError(409, "Only an approved version can be retired.");
  }
  await client.query(
    `UPDATE training_lesson_version SET publication_status = 'retired', review_notes = COALESCE($3, review_notes), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, versionId, note ?? null]
  );
  await client.query(
    `UPDATE training_lesson SET current_version_id = NULL, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND current_version_id = $3`,
    [auth.tenantId, version.rows[0].lesson_id, versionId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.retired",
    entityType: "training_lesson_version",
    entityId: versionId,
    metadata: { note: note ?? null }
  });
  return { version_id: versionId };
}

// ---------------------------------------------------------------------------
// Manager reads.
// ---------------------------------------------------------------------------
export async function listLessons(
  client: PoolClient,
  auth: AuthUser,
  filters: { query?: string; status?: string; role?: string; includeDemo?: boolean } = {}
) {
  requireTrainingManager(auth);
  const params: unknown[] = [auth.tenantId];
  const where: string[] = ["l.tenant_id = $1"];
  if (filters.query) {
    params.push(`%${filters.query}%`);
    where.push(`l.title ILIKE $${params.length}`);
  }
  if (filters.role) {
    params.push(filters.role);
    where.push(`l.intended_role = $${params.length}`);
  }
  if (filters.includeDemo === false) {
    where.push("l.is_demo = false");
  }
  let statusFilter = "";
  if (filters.status) {
    params.push(filters.status);
    statusFilter = ` AND cv.publication_status = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT l.id::text, l.title, l.objective, l.intended_role, l.intended_department, l.is_demo,
            l.current_version_id::text,
            cv.publication_status AS current_status, cv.version_number AS current_version_number,
            latest.publication_status AS latest_status, latest.version_number AS latest_version_number,
            (SELECT count(*)::int FROM training_lesson_assignment a WHERE a.tenant_id = l.tenant_id AND a.lesson_id = l.id) AS assignment_count
     FROM training_lesson l
     LEFT JOIN training_lesson_version cv ON cv.id = l.current_version_id
     LEFT JOIN LATERAL (
       SELECT publication_status, version_number FROM training_lesson_version v
       WHERE v.tenant_id = l.tenant_id AND v.lesson_id = l.id ORDER BY version_number DESC LIMIT 1
     ) latest ON true
     WHERE ${where.join(" AND ")}${statusFilter}
     ORDER BY l.updated_at DESC
     LIMIT 200`,
    params
  );
  return { lessons: rows };
}

export async function getLessonDetail(client: PoolClient, auth: AuthUser, lessonId: string) {
  requireTrainingManager(auth);
  const lesson = await client.query(
    `SELECT l.id::text, l.title, l.objective, l.intended_role, l.intended_department, l.is_demo,
            l.current_version_id::text, l.prerequisite_lesson_id::text,
            owner.full_name AS owner_name, l.created_at::text
     FROM training_lesson l
     LEFT JOIN app_user owner ON owner.id = l.owner_user_id
     WHERE l.tenant_id = $1 AND l.id = $2 LIMIT 1`,
    [auth.tenantId, lessonId]
  );
  if (!lesson.rows[0]) throw new ApiError(404, "Lesson not found");
  const versions = await client.query(
    `SELECT v.id::text, v.version_number, v.publication_status, v.ai_drafted, v.pass_threshold_percent,
            v.approved_at::text, approver.full_name AS approved_by_name, v.effective_from::text,
            v.effective_until::text, v.review_due_at::text, v.supersedes_version_id::text,
            v.superseded_by_version_id::text, v.review_notes, v.created_at::text
     FROM training_lesson_version v
     LEFT JOIN app_user approver ON approver.id = v.approved_by_user_id
     WHERE v.tenant_id = $1 AND v.lesson_id = $2 ORDER BY v.version_number DESC`,
    [auth.tenantId, lessonId]
  );
  const versionIds = versions.rows.map((v: { id: string }) => v.id);
  const sections = versionIds.length
    ? (
        await client.query(
          `SELECT s.id::text, s.lesson_version_id::text, s.ordinal, s.section_kind, s.title, s.body,
                  s.knowledge_source_version_id::text, s.knowledge_segment_id::text, s.media_start_seconds, s.media_end_seconds,
                  ks.title AS source_title
           FROM training_lesson_section s
           LEFT JOIN knowledge_source_version ksv ON ksv.id = s.knowledge_source_version_id
           LEFT JOIN knowledge_source ks ON ks.id = ksv.source_id
           WHERE s.tenant_id = $1 AND s.lesson_version_id = ANY($2::uuid[]) ORDER BY s.ordinal`,
          [auth.tenantId, versionIds]
        )
      ).rows
    : [];
  // Manager sees the full rubric (correct flags visible).
  const questions = versionIds.length
    ? (
        await client.query(
          `SELECT id::text, lesson_version_id::text, ordinal, prompt, scenario, choices, review_section_id::text, allow_open_text
           FROM training_lesson_question WHERE tenant_id = $1 AND lesson_version_id = ANY($2::uuid[]) ORDER BY ordinal`,
          [auth.tenantId, versionIds]
        )
      ).rows
    : [];
  return { mode: "manager", lesson: lesson.rows[0], versions: versions.rows, sections, questions };
}

// ---------------------------------------------------------------------------
// H6-G — Pilot cohort controls (disabled by default).
// ---------------------------------------------------------------------------
export async function createCohort(
  client: PoolClient,
  auth: AuthUser,
  input: { name: string; description?: string | null; starts_on?: string | null; ends_on?: string | null; support_contact?: string | null; is_demo?: boolean }
) {
  requireTrainingManager(auth);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO training_pilot_cohort (tenant_id, name, description, starts_on, ends_on, support_contact, is_demo, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
    [auth.tenantId, input.name.trim(), input.description ?? null, input.starts_on ?? null, input.ends_on ?? null, input.support_contact ?? null, Boolean(input.is_demo), auth.id]
  );
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "training.cohort.created", entityType: "training_pilot_cohort", entityId: rows[0].id });
  return { cohort_id: rows[0].id };
}

export async function setCohortState(
  client: PoolClient,
  auth: AuthUser,
  cohortId: string,
  input: { enabled?: boolean; status?: "draft" | "active" | "ended" }
) {
  requireTrainingManager(auth);
  const existing = await client.query(`SELECT id FROM training_pilot_cohort WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [auth.tenantId, cohortId]);
  if (!existing.rows[0]) throw new ApiError(404, "Cohort not found");
  await client.query(
    `UPDATE training_pilot_cohort SET enabled = COALESCE($3, enabled), status = COALESCE($4, status), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, cohortId, input.enabled ?? null, input.status ?? null]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.cohort.state_changed",
    entityType: "training_pilot_cohort",
    entityId: cohortId,
    metadata: { enabled: input.enabled ?? null, status: input.status ?? null }
  });
  return { cohort_id: cohortId };
}

export async function addCohortMember(client: PoolClient, auth: AuthUser, cohortId: string, userId: string) {
  requireTrainingManager(auth);
  const cohort = await client.query(`SELECT id FROM training_pilot_cohort WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [auth.tenantId, cohortId]);
  if (!cohort.rows[0]) throw new ApiError(404, "Cohort not found");
  const user = await client.query(`SELECT id FROM app_user WHERE tenant_id = $1 AND id = $2 AND status <> 'revoked' LIMIT 1`, [auth.tenantId, userId]);
  if (!user.rows[0]) throw new ApiError(404, "Employee not found");
  await client.query(
    `INSERT INTO training_pilot_cohort_member (tenant_id, cohort_id, user_id, added_by_user_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, cohort_id, user_id) DO NOTHING`,
    [auth.tenantId, cohortId, userId, auth.id]
  );
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, targetUserId: userId, action: "training.cohort.member_added", entityType: "training_pilot_cohort", entityId: cohortId });
  return { cohort_id: cohortId, user_id: userId };
}

export async function removeCohortMember(client: PoolClient, auth: AuthUser, cohortId: string, userId: string) {
  requireTrainingManager(auth);
  await client.query(`DELETE FROM training_pilot_cohort_member WHERE tenant_id = $1 AND cohort_id = $2 AND user_id = $3`, [auth.tenantId, cohortId, userId]);
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, targetUserId: userId, action: "training.cohort.member_removed", entityType: "training_pilot_cohort", entityId: cohortId });
  return { cohort_id: cohortId, user_id: userId };
}

export async function listCohorts(client: PoolClient, auth: AuthUser) {
  requireTrainingManager(auth);
  const { rows } = await client.query(
    `SELECT c.id::text, c.name, c.description, c.status, c.enabled, c.is_demo, c.starts_on::text, c.ends_on::text, c.support_contact,
            (SELECT count(*)::int FROM training_pilot_cohort_member m WHERE m.tenant_id = c.tenant_id AND m.cohort_id = c.id) AS member_count
     FROM training_pilot_cohort c WHERE c.tenant_id = $1 ORDER BY c.created_at DESC`,
    [auth.tenantId]
  );
  return { cohorts: rows };
}

// ---------------------------------------------------------------------------
// H6-F — Assignment. Pins the current APPROVED version. Cohort gating: when a
// cohort is supplied it must be enabled and the employee must be a member.
// ---------------------------------------------------------------------------
export async function assignLesson(
  client: PoolClient,
  auth: AuthUser,
  input: { lesson_id: string; user_id: string; cohort_id?: string | null; reason?: string | null; due_at?: string | null }
) {
  requireTrainingManager(auth);
  const lesson = await client.query<{ id: string; current_version_id: string | null }>(
    `SELECT id::text, current_version_id::text FROM training_lesson WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, input.lesson_id]
  );
  if (!lesson.rows[0]) throw new ApiError(404, "Lesson not found");
  if (!lesson.rows[0].current_version_id) {
    throw new ApiError(409, "This lesson has no approved version to assign yet.");
  }
  const user = await client.query(`SELECT id FROM app_user WHERE tenant_id = $1 AND id = $2 AND status <> 'revoked' LIMIT 1`, [auth.tenantId, input.user_id]);
  if (!user.rows[0]) throw new ApiError(404, "Employee not found");
  if (input.cohort_id) {
    const cohort = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM training_pilot_cohort WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, input.cohort_id]
    );
    if (!cohort.rows[0]) throw new ApiError(404, "Cohort not found");
    if (!cohort.rows[0].enabled) throw new ApiError(409, "This pilot cohort is disabled; enable it before assigning.");
    const member = await client.query(
      `SELECT 1 FROM training_pilot_cohort_member WHERE tenant_id = $1 AND cohort_id = $2 AND user_id = $3 LIMIT 1`,
      [auth.tenantId, input.cohort_id, input.user_id]
    );
    if (!member.rows[0]) throw new ApiError(409, "This employee is not a member of the pilot cohort.");
  }
  const versionId = lesson.rows[0].current_version_id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO training_lesson_assignment
       (tenant_id, lesson_id, lesson_version_id, user_id, cohort_id, assigned_by_user_id, assignment_reason, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, lesson_version_id, user_id) DO UPDATE SET
       assignment_reason = EXCLUDED.assignment_reason, due_at = EXCLUDED.due_at, cohort_id = EXCLUDED.cohort_id
     RETURNING id::text`,
    [auth.tenantId, input.lesson_id, versionId, input.user_id, input.cohort_id ?? null, auth.id, input.reason ?? null, input.due_at ?? null]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.user_id,
    action: "training.lesson.assigned",
    entityType: "training_lesson_assignment",
    entityId: inserted.rows[0].id,
    metadata: { lesson_id: input.lesson_id, version_id: versionId, cohort_id: input.cohort_id ?? null }
  });
  return { assignment_id: inserted.rows[0].id, lesson_version_id: versionId };
}

// ---------------------------------------------------------------------------
// H6-C — Employee experience. Employees act only on their own assignments.
// ---------------------------------------------------------------------------
export async function listMyAssignments(client: PoolClient, auth: AuthUser) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const { rows } = await client.query(
    `SELECT a.id::text, a.lesson_id::text, a.lesson_version_id::text, a.status, a.due_at::text, a.assigned_at::text,
            a.completed_at::text, a.assignment_reason,
            l.title, l.objective, v.version_number, v.pass_threshold_percent,
            p.progress_percent, p.acknowledged,
            (SELECT count(*)::int FROM training_lesson_section s WHERE s.tenant_id = a.tenant_id AND s.lesson_version_id = a.lesson_version_id) AS section_count,
            (SELECT count(*)::int FROM training_lesson_question q WHERE q.tenant_id = a.tenant_id AND q.lesson_version_id = a.lesson_version_id) AS question_count,
            (SELECT max(ra.score_percent) FROM training_readiness_attempt ra WHERE ra.tenant_id = a.tenant_id AND ra.assignment_id = a.id) AS best_score
     FROM training_lesson_assignment a
     JOIN training_lesson l ON l.id = a.lesson_id
     JOIN training_lesson_version v ON v.id = a.lesson_version_id
     LEFT JOIN training_lesson_progress p ON p.assignment_id = a.id
     WHERE a.tenant_id = $1 AND a.user_id = $2
     ORDER BY (a.status = 'completed'), a.due_at NULLS LAST, a.assigned_at DESC`,
    [auth.tenantId, auth.id]
  );
  const now = Date.now();
  return {
    assignments: rows.map((r: { due_at: string | null; status: string }) => ({
      ...r,
      overdue: r.status !== "completed" && r.due_at != null && new Date(r.due_at).getTime() < now
    }))
  };
}

async function loadOwnAssignment(client: PoolClient, auth: AuthUser, assignmentId: string) {
  const { rows } = await client.query<{
    id: string;
    lesson_id: string;
    lesson_version_id: string;
    status: string;
    user_id: string;
  }>(
    `SELECT id::text, lesson_id::text, lesson_version_id::text, status, user_id::text
     FROM training_lesson_assignment WHERE tenant_id = $1 AND id = $2 AND user_id = $3 LIMIT 1`,
    [auth.tenantId, assignmentId, auth.id]
  );
  if (!rows[0]) throw new ApiError(404, "Assignment not found");
  return rows[0];
}

export async function getMyLesson(client: PoolClient, auth: AuthUser, assignmentId: string) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const assignment = await loadOwnAssignment(client, auth, assignmentId);
  const lesson = await client.query(
    `SELECT l.title, l.objective, v.version_number, v.pass_threshold_percent, v.publication_status
     FROM training_lesson l JOIN training_lesson_version v ON v.id = $2
     WHERE l.tenant_id = $1 AND l.id = $3 LIMIT 1`,
    [auth.tenantId, assignment.lesson_version_id, assignment.lesson_id]
  );
  const sections = await client.query(
    `SELECT s.id::text, s.ordinal, s.section_kind, s.title, s.body, s.knowledge_source_version_id::text,
            s.knowledge_segment_id::text, s.media_start_seconds, s.media_end_seconds, ks.id::text AS source_id, ks.title AS source_title
     FROM training_lesson_section s
     LEFT JOIN knowledge_source_version ksv ON ksv.id = s.knowledge_source_version_id
     LEFT JOIN knowledge_source ks ON ks.id = ksv.source_id
     WHERE s.tenant_id = $1 AND s.lesson_version_id = $2 ORDER BY s.ordinal`,
    [auth.tenantId, assignment.lesson_version_id]
  );
  // Employee questions NEVER include correct flags or explanations.
  const questions = await client.query<{ id: string; ordinal: number; prompt: string; scenario: string | null; choices: Choice[]; allow_open_text: boolean }>(
    `SELECT id::text, ordinal, prompt, scenario, choices, allow_open_text
     FROM training_lesson_question WHERE tenant_id = $1 AND lesson_version_id = $2 ORDER BY ordinal`,
    [auth.tenantId, assignment.lesson_version_id]
  );
  const progress = await client.query(
    `SELECT viewed_section_ids::text[] AS viewed_section_ids, progress_percent, acknowledged FROM training_lesson_progress WHERE tenant_id = $1 AND assignment_id = $2 LIMIT 1`,
    [auth.tenantId, assignmentId]
  );
  return {
    assignment: { id: assignment.id, status: assignment.status },
    lesson: lesson.rows[0],
    sections: sections.rows.map((s: { source_id: string | null; media_start_seconds: number | null }) => ({
      ...s,
      // Protected media URL re-checks eligibility server-side on access.
      media_url: s.source_id && s.media_start_seconds != null ? buildProtectedMediaUrl(s.source_id, s.media_start_seconds) : null
    })),
    questions: questions.rows.map((q) => ({
      id: q.id,
      ordinal: q.ordinal,
      prompt: q.prompt,
      scenario: q.scenario,
      allow_open_text: q.allow_open_text,
      choices: (q.choices ?? []).map((c) => ({ id: c.id, label: c.label }))
    })),
    progress: progress.rows[0] ?? { viewed_section_ids: [], progress_percent: 0, acknowledged: false }
  };
}

async function upsertProgress(client: PoolClient, auth: AuthUser, assignmentId: string, versionId: string) {
  const sectionCount = await client.query<{ n: string; ids: string[] }>(
    `SELECT count(*)::int AS n, array_agg(id::text) AS ids FROM training_lesson_section WHERE tenant_id = $1 AND lesson_version_id = $2`,
    [auth.tenantId, versionId]
  );
  return { total: Number(sectionCount.rows[0]?.n ?? 0), allIds: sectionCount.rows[0]?.ids ?? [] };
}

export async function recordSectionViewed(client: PoolClient, auth: AuthUser, assignmentId: string, sectionId: string) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const assignment = await loadOwnAssignment(client, auth, assignmentId);
  const belongs = await client.query(
    `SELECT 1 FROM training_lesson_section WHERE tenant_id = $1 AND id = $2 AND lesson_version_id = $3 LIMIT 1`,
    [auth.tenantId, sectionId, assignment.lesson_version_id]
  );
  if (!belongs.rows[0]) throw new ApiError(400, "That section is not part of this lesson.");
  const { total } = await upsertProgress(client, auth, assignmentId, assignment.lesson_version_id);
  await client.query(
    `INSERT INTO training_lesson_progress (tenant_id, assignment_id, user_id, viewed_section_ids, progress_percent, last_viewed_at)
     VALUES ($1,$2,$3, ARRAY[$4::uuid], 0, now())
     ON CONFLICT (assignment_id) DO UPDATE SET
       viewed_section_ids = (
         SELECT ARRAY(SELECT DISTINCT unnest(training_lesson_progress.viewed_section_ids || ARRAY[$4::uuid]))
       ),
       last_viewed_at = now(),
       updated_at = now()`,
    [auth.tenantId, assignmentId, auth.id, sectionId]
  );
  // Recompute percent from distinct viewed sections.
  const viewed = await client.query<{ n: string }>(
    `SELECT coalesce(array_length(viewed_section_ids, 1), 0)::int AS n FROM training_lesson_progress WHERE tenant_id = $1 AND assignment_id = $2`,
    [auth.tenantId, assignmentId]
  );
  const percent = total > 0 ? Math.min(100, Math.round((Number(viewed.rows[0].n) / total) * 100)) : 0;
  await client.query(`UPDATE training_lesson_progress SET progress_percent = $3 WHERE tenant_id = $1 AND assignment_id = $2`, [auth.tenantId, assignmentId, percent]);
  if (assignment.status === "assigned") {
    await client.query(`UPDATE training_lesson_assignment SET status = 'in_progress' WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, assignmentId]);
  }
  return { progress_percent: percent };
}

export async function acknowledgeLesson(client: PoolClient, auth: AuthUser, assignmentId: string) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const assignment = await loadOwnAssignment(client, auth, assignmentId);
  await client.query(
    `INSERT INTO training_lesson_progress (tenant_id, assignment_id, user_id, acknowledged, acknowledged_at, progress_percent)
     VALUES ($1,$2,$3,true, now(), 100)
     ON CONFLICT (assignment_id) DO UPDATE SET acknowledged = true, acknowledged_at = now(), updated_at = now()`,
    [auth.tenantId, assignmentId, auth.id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.lesson.acknowledged",
    entityType: "training_lesson_assignment",
    entityId: assignmentId
  });
  return { assignment_id: assignmentId, acknowledged: true };
}

// ---------------------------------------------------------------------------
// H6-D — Readiness check. Deterministic scoring against the pinned version's
// visible rubric; missed questions map to review sections; open-text answers
// are flagged for human review. No result becomes discipline.
// ---------------------------------------------------------------------------
export async function submitReadiness(
  client: PoolClient,
  auth: AuthUser,
  assignmentId: string,
  answers: Record<string, string>
) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const assignment = await loadOwnAssignment(client, auth, assignmentId);
  const questionsRes = await client.query<{
    id: string;
    prompt: string;
    choices: Choice[];
    review_section_id: string | null;
    allow_open_text: boolean;
  }>(
    `SELECT id::text, prompt, choices, review_section_id::text, allow_open_text
     FROM training_lesson_question WHERE tenant_id = $1 AND lesson_version_id = $2 ORDER BY ordinal`,
    [auth.tenantId, assignment.lesson_version_id]
  );
  const questions = questionsRes.rows;
  if (!questions.length) throw new ApiError(400, "This lesson has no readiness questions.");
  const threshold = await client.query<{ pass_threshold_percent: number }>(
    `SELECT pass_threshold_percent FROM training_lesson_version WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, assignment.lesson_version_id]
  );
  const passThreshold = threshold.rows[0]?.pass_threshold_percent ?? 80;

  const sectionTitles = new Map<string, string>();
  const secRows = await client.query<{ id: string; title: string }>(
    `SELECT id::text, title FROM training_lesson_section WHERE tenant_id = $1 AND lesson_version_id = $2`,
    [auth.tenantId, assignment.lesson_version_id]
  );
  secRows.rows.forEach((s) => sectionTitles.set(s.id, s.title));

  let correct = 0;
  let needsHumanReview = false;
  const missed: string[] = [];
  const feedback = questions.map((q) => {
    const answer = answers[q.id];
    if (q.allow_open_text) {
      needsHumanReview = true;
      return {
        question_id: q.id,
        prompt: q.prompt,
        result: "needs_review" as const,
        review_topic: q.review_section_id ? sectionTitles.get(q.review_section_id) ?? null : null,
        coaching: "Your written answer will be reviewed by a trainer."
      };
    }
    const chosen = (q.choices ?? []).find((c) => c.id === answer);
    const isCorrect = Boolean(chosen?.correct);
    if (isCorrect) {
      correct += 1;
    } else {
      missed.push(q.id);
    }
    const correctChoice = (q.choices ?? []).find((c) => c.correct);
    return {
      question_id: q.id,
      prompt: q.prompt,
      result: isCorrect ? ("correct" as const) : ("incorrect" as const),
      review_topic: q.review_section_id ? sectionTitles.get(q.review_section_id) ?? null : null,
      // Coaching frames the miss as something to review, citing the approved lesson content.
      coaching: isCorrect
        ? chosen?.explanation ?? "Correct."
        : `Review “${(q.review_section_id && sectionTitles.get(q.review_section_id)) || "the lesson"}”. ${correctChoice?.explanation ?? ""}`.trim()
    };
  });

  const scorable = questions.filter((q) => !q.allow_open_text).length;
  const scorePercent = scorable > 0 ? Math.round((correct / scorable) * 100) : 0;
  const passed = !needsHumanReview && scorable > 0 && scorePercent >= passThreshold;

  const attempt = await client.query<{ id: string }>(
    `INSERT INTO training_readiness_attempt
       (tenant_id, assignment_id, lesson_version_id, user_id, score_percent, passed, correct_count, question_count, missed_question_ids, needs_human_review, answers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11::jsonb) RETURNING id::text`,
    [
      auth.tenantId,
      assignmentId,
      assignment.lesson_version_id,
      auth.id,
      scorePercent,
      passed,
      correct,
      scorable,
      missed,
      needsHumanReview,
      JSON.stringify(answers)
    ]
  );

  // Completion requires a pass AND acknowledgment (approval-before-instruction
  // analog: the employee must have read and acknowledged the material).
  const ack = await client.query<{ acknowledged: boolean }>(
    `SELECT acknowledged FROM training_lesson_progress WHERE tenant_id = $1 AND assignment_id = $2 LIMIT 1`,
    [auth.tenantId, assignmentId]
  );
  if (passed && ack.rows[0]?.acknowledged) {
    await client.query(
      `UPDATE training_lesson_assignment SET status = 'completed', completed_at = now() WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, assignmentId]
    );
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "training.readiness.submitted",
    entityType: "training_lesson_assignment",
    entityId: assignmentId,
    metadata: { score_percent: scorePercent, passed, needs_human_review: needsHumanReview }
  });

  return {
    attempt_id: attempt.rows[0].id,
    score_percent: scorePercent,
    passed,
    pass_threshold_percent: passThreshold,
    needs_human_review: needsHumanReview,
    correct_count: correct,
    question_count: scorable,
    feedback
  };
}

// ---------------------------------------------------------------------------
// H6-F/H — Manager visibility + pilot metrics (coaching, never ranking).
// ---------------------------------------------------------------------------
export async function getLessonResults(client: PoolClient, auth: AuthUser, lessonId: string) {
  requireTrainingManager(auth);
  const assignments = await client.query(
    `SELECT a.id::text, a.status, a.due_at::text, a.completed_at::text,
            u.full_name AS employee_name, v.version_number,
            p.progress_percent, p.acknowledged,
            (SELECT max(ra.score_percent) FROM training_readiness_attempt ra WHERE ra.tenant_id = a.tenant_id AND ra.assignment_id = a.id) AS best_score,
            (SELECT count(*)::int FROM training_readiness_attempt ra WHERE ra.tenant_id = a.tenant_id AND ra.assignment_id = a.id) AS attempt_count,
            (SELECT bool_or(ra.needs_human_review) FROM training_readiness_attempt ra WHERE ra.tenant_id = a.tenant_id AND ra.assignment_id = a.id) AS needs_review
     FROM training_lesson_assignment a
     JOIN app_user u ON u.id = a.user_id
     JOIN training_lesson_version v ON v.id = a.lesson_version_id
     LEFT JOIN training_lesson_progress p ON p.assignment_id = a.id
     WHERE a.tenant_id = $1 AND a.lesson_id = $2
     ORDER BY u.full_name`,
    [auth.tenantId, lessonId]
  );
  // Question difficulty: miss rate across attempts, aggregate only.
  const difficulty = await client.query(
    `SELECT q.id::text, q.prompt,
            count(ra.*)::int AS attempts,
            sum(CASE WHEN q.id = ANY(ra.missed_question_ids) THEN 1 ELSE 0 END)::int AS misses
     FROM training_lesson_question q
     JOIN training_lesson_version v ON v.id = q.lesson_version_id AND v.lesson_id = $2
     LEFT JOIN training_readiness_attempt ra ON ra.lesson_version_id = q.lesson_version_id
     WHERE q.tenant_id = $1
     GROUP BY q.id, q.prompt
     ORDER BY misses DESC NULLS LAST`,
    [auth.tenantId, lessonId]
  );
  return { assignments: assignments.rows, question_difficulty: difficulty.rows };
}

export async function getPilotMetrics(client: PoolClient, auth: AuthUser, cohortId?: string | null) {
  requireTrainingManager(auth);
  const params: unknown[] = [auth.tenantId];
  let cohortFilter = "";
  if (cohortId) {
    params.push(cohortId);
    cohortFilter = ` AND a.cohort_id = $${params.length}`;
  }
  const totals = await client.query(
    `SELECT
       count(*)::int AS assigned,
       sum(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END)::int AS completed,
       sum(CASE WHEN a.status = 'in_progress' THEN 1 ELSE 0 END)::int AS in_progress
     FROM training_lesson_assignment a WHERE a.tenant_id = $1${cohortFilter}`,
    params
  );
  const readiness = await client.query(
    `SELECT
       count(*)::int AS attempts,
       sum(CASE WHEN ra.passed THEN 1 ELSE 0 END)::int AS passed,
       sum(CASE WHEN ra.needs_human_review THEN 1 ELSE 0 END)::int AS needs_review,
       round(avg(ra.score_percent))::int AS avg_score
     FROM training_readiness_attempt ra
     JOIN training_lesson_assignment a ON a.id = ra.assignment_id
     WHERE ra.tenant_id = $1${cohortFilter}`,
    params
  );
  return {
    assignments: totals.rows[0],
    readiness: readiness.rows[0]
  };
}
