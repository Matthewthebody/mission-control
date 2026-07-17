import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import { isActiveMembership } from "../../authz/policy.js";
import type { AuthUser } from "../../types/auth.js";
import { createAuditLog } from "../audit.js";
import { requireKnowledgeReviewer } from "../knowledge/knowledgeGovernance.js";
import { postRecordThreadMessage } from "../recordThreads.js";
import { askBailey } from "./askBailey.js";
import { deterministicLanguageModel } from "./providers/languageModel.js";

// Ask Bailey H9 — governed organizational learning + bounded assistive actions.
//
// Everything here is an OBSERVATION or a DRAFT. Nothing becomes operational
// truth automatically: gap insights are labelled inference, proposals stay
// drafts until a human accepts them, and assistive actions preview first, then
// require an explicit confirm that writes only through an existing typed API,
// is audited, and is duplicate-safe. No model gets arbitrary write authority.

// ---------------------------------------------------------------------------
// H9-A — Knowledge-gap intelligence (reviewer-only, aggregate, no employee ids).
// ---------------------------------------------------------------------------
export type KnowledgeGap = {
  kind: string;
  title: string;
  evidence_count: number;
  window_days: number;
  categories: string[];
  confidence: "observation" | "inference";
  dedup_key: string;
  examples: Array<{ label: string; ref: string | null }>;
};

export async function getKnowledgeGaps(client: PoolClient, auth: AuthUser, windowDays = 90): Promise<KnowledgeGap[]> {
  requireKnowledgeReviewer(auth);
  const days = Math.max(1, Math.min(365, windowDays));
  const gaps: KnowledgeGap[] = [];

  // Recurring unanswered questions.
  const unresolved = await client.query<{ id: string; example_question: string; occurrence_count: number; departments_asking: string[] }>(
    `SELECT id::text, example_question, occurrence_count, departments_asking
     FROM ai_unresolved_question
     WHERE tenant_id = $1 AND status = 'open'
     ORDER BY occurrence_count DESC LIMIT 10`,
    [auth.tenantId]
  );
  for (const row of unresolved.rows) {
    gaps.push({
      kind: "recurring_unanswered_question",
      title: row.example_question,
      evidence_count: Number(row.occurrence_count),
      window_days: days,
      categories: [...new Set(row.departments_asking ?? [])],
      confidence: "observation",
      dedup_key: `unanswered:${row.id}`,
      examples: [{ label: "unresolved question", ref: row.id }]
    });
  }

  // Frequently reported outdated/incorrect sources.
  const reports = await client.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM ai_message_feedback
     WHERE tenant_id = $1 AND review_status = 'open' AND feedback_kind IN ('report_incorrect', 'source_outdated')`,
    [auth.tenantId]
  );
  if (Number(reports.rows[0]?.n ?? 0) > 0) {
    gaps.push({
      kind: "reported_outdated_answers",
      title: "Answers reported as incorrect or outdated need review",
      evidence_count: Number(reports.rows[0].n),
      window_days: days,
      categories: ["feedback"],
      confidence: "observation",
      dedup_key: "reports:open",
      examples: [{ label: "open reports", ref: null }]
    });
  }

  // Conflicting approved sources.
  const conflicts = await client.query<{ id: string; note: string | null }>(
    `SELECT id::text, note FROM knowledge_source_conflict WHERE tenant_id = $1 AND status = 'open' LIMIT 10`,
    [auth.tenantId]
  );
  for (const row of conflicts.rows) {
    gaps.push({
      kind: "conflicting_sources",
      title: row.note ?? "Two approved sources disagree",
      evidence_count: 1,
      window_days: days,
      categories: ["conflict"],
      confidence: "observation",
      dedup_key: `conflict:${row.id}`,
      examples: [{ label: "source conflict", ref: row.id }]
    });
  }

  // Topics with high readiness-check misses (aggregate; no employee identity).
  const misses = await client.query<{ lesson_version_id: string; title: string; misses: string; attempts: string }>(
    `SELECT ra.lesson_version_id::text, l.title,
            sum(coalesce(array_length(ra.missed_question_ids, 1), 0))::int AS misses,
            count(*)::int AS attempts
     FROM training_readiness_attempt ra
     JOIN training_lesson_version v ON v.id = ra.lesson_version_id
     JOIN training_lesson l ON l.id = v.lesson_id
     WHERE ra.tenant_id = $1 AND ra.played_at > now() - ($2 || ' days')::interval
     GROUP BY ra.lesson_version_id, l.title
     HAVING sum(coalesce(array_length(ra.missed_question_ids, 1), 0)) > 0
     ORDER BY misses DESC LIMIT 10`,
    [auth.tenantId, String(days)]
  );
  for (const row of misses.rows) {
    gaps.push({
      kind: "high_readiness_miss_topic",
      title: `Trainees repeatedly miss questions in "${row.title}"`,
      evidence_count: Number(row.misses),
      window_days: days,
      categories: ["training"],
      confidence: "inference",
      dedup_key: `readiness_miss:${row.lesson_version_id}`,
      examples: [{ label: "lesson version", ref: row.lesson_version_id }]
    });
  }

  // Source review dates at risk.
  const reviewDue = await client.query<{ id: string; title: string }>(
    `SELECT v.id::text, s.title
     FROM knowledge_source_version v
     JOIN knowledge_source s ON s.id = v.source_id
     WHERE v.tenant_id = $1 AND v.publication_status = 'approved'
       AND v.review_due_at IS NOT NULL AND v.review_due_at < now() + interval '30 days'
     ORDER BY v.review_due_at LIMIT 10`,
    [auth.tenantId]
  );
  for (const row of reviewDue.rows) {
    gaps.push({
      kind: "review_date_at_risk",
      title: `"${row.title}" is due for review soon`,
      evidence_count: 1,
      window_days: days,
      categories: ["governance"],
      confidence: "observation",
      dedup_key: `review_due:${row.id}`,
      examples: [{ label: "source version", ref: row.id }]
    });
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// H9-B — Improvement proposal queue. Draft, deduplicated, evidence-preserving.
// ---------------------------------------------------------------------------
const GAP_TO_PROPOSAL: Record<string, string> = {
  recurring_unanswered_question: "add_or_update_sop",
  reported_outdated_answers: "add_or_update_sop",
  conflicting_sources: "resolve_source_conflict",
  high_readiness_miss_topic: "add_readiness_question",
  review_date_at_risk: "add_or_update_sop"
};

export async function generateProposalsFromGaps(client: PoolClient, auth: AuthUser) {
  requireKnowledgeReviewer(auth);
  const gaps = await getKnowledgeGaps(client, auth);
  const created: string[] = [];
  for (const gap of gaps) {
    const kind = GAP_TO_PROPOSAL[gap.kind] ?? "add_or_update_sop";
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO knowledge_improvement_proposal
         (tenant_id, proposal_kind, title, rationale, evidence, status, dedup_key, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6, $7)
       ON CONFLICT (tenant_id, dedup_key) WHERE status = 'draft' DO NOTHING
       RETURNING id::text`,
      [
        auth.tenantId,
        kind,
        gap.title,
        `Proposed from a ${gap.confidence} (${gap.kind}); evidence count ${gap.evidence_count} over ${gap.window_days} days.`,
        JSON.stringify({ gap_kind: gap.kind, evidence_count: gap.evidence_count, confidence: gap.confidence, examples: gap.examples }),
        gap.dedup_key,
        auth.id
      ]
    );
    if (inserted.rows[0]) created.push(inserted.rows[0].id);
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "knowledge.proposals_generated",
    entityType: "knowledge_improvement_proposal",
    metadata: { created: created.length }
  });
  return { created_count: created.length, created_ids: created };
}

export async function listProposals(client: PoolClient, auth: AuthUser, status?: string) {
  requireKnowledgeReviewer(auth);
  const params: unknown[] = [auth.tenantId];
  let statusClause = "";
  if (status) {
    params.push(status);
    statusClause = ` AND status = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT id::text, proposal_kind, title, rationale, evidence, status, dedup_key,
            reviewed_by_user_id::text, reviewed_at::text, review_note, created_at::text
     FROM knowledge_improvement_proposal
     WHERE tenant_id = $1${statusClause}
     ORDER BY created_at DESC LIMIT 200`,
    params
  );
  return { proposals: rows };
}

export async function reviewProposal(
  client: PoolClient,
  auth: AuthUser,
  proposalId: string,
  input: { decision: "accepted" | "dismissed"; note?: string | null }
) {
  requireKnowledgeReviewer(auth);
  const existing = await client.query<{ status: string }>(
    `SELECT status FROM knowledge_improvement_proposal WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, proposalId]
  );
  if (!existing.rows[0]) throw new ApiError(404, "Proposal not found");
  if (existing.rows[0].status !== "draft") {
    throw new ApiError(409, "Only a draft proposal can be reviewed.");
  }
  // Evidence is preserved on dismissal — we only change status.
  await client.query(
    `UPDATE knowledge_improvement_proposal
       SET status = $3, reviewed_by_user_id = $4, reviewed_at = now(), review_note = $5, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, proposalId, input.decision, auth.id, input.note ?? null]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: `knowledge.proposal_${input.decision}`,
    entityType: "knowledge_improvement_proposal",
    entityId: proposalId,
    metadata: { note: input.note ?? null }
  });
  return { proposal_id: proposalId, status: input.decision };
}

// ---------------------------------------------------------------------------
// H9-D — Bounded assistive actions. Preview → confirm → (typed write) → audit.
// Only the pre-shoot huddle is implemented; it grounds in approved sources and
// writes through the existing record-thread API. Duplicate-safe via a stable
// idempotency_key.
// ---------------------------------------------------------------------------
export async function previewPreShootHuddle(client: PoolClient, auth: AuthUser, jobId: string) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  // Ground the huddle in approved sources (citation-validated).
  const grounded = await askBailey(client, auth, {
    question: "What should the team cover in a pre-shoot huddle for a school picture day?",
    providerOverride: deterministicLanguageModel
  });
  const body =
    grounded.answer_markdown && grounded.citations.length > 0
      ? `Pre-shoot huddle (draft — review before sharing):\n\n${grounded.answer_markdown}`
      : "No approved huddle guidance was found. I'm not going to guess — add a pre-shoot checklist source first.";
  const evidence = grounded.citations.map((c) => ({ segment_id: c.segment_id, title: c.title, source_version_id: c.source_version_id }));
  const idempotencyKey = `pre_shoot_huddle:${jobId}`;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ai_assistive_action
       (tenant_id, action_kind, target_type, target_id, status, preview, evidence, idempotency_key, created_by_user_id)
     VALUES ($1, 'pre_shoot_huddle', 'job', $2, 'previewed', $3::jsonb, $4::jsonb, $5, $6)
     ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
       preview = EXCLUDED.preview, evidence = EXCLUDED.evidence, updated_at = now()
     RETURNING id::text`,
    [auth.tenantId, jobId, JSON.stringify({ body }), JSON.stringify(evidence), idempotencyKey, auth.id]
  );
  return {
    action_id: inserted.rows[0].id,
    action_kind: "pre_shoot_huddle",
    target: { type: "job", id: jobId },
    preview: { body },
    evidence,
    grounded: grounded.citations.length > 0
  };
}

export async function confirmAssistiveAction(client: PoolClient, auth: AuthUser, actionId: string) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const action = await client.query<{
    id: string;
    action_kind: string;
    target_type: string;
    target_id: string;
    status: string;
    preview: { body?: string };
    result_ref: string | null;
  }>(
    `SELECT id::text, action_kind, target_type, target_id::text, status, preview, result_ref
     FROM ai_assistive_action WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, actionId]
  );
  if (!action.rows[0]) throw new ApiError(404, "Assistive action not found");
  const row = action.rows[0];
  // Idempotent: confirming an already-confirmed action returns the same result
  // without writing again.
  if (row.status === "confirmed") {
    return { action_id: actionId, status: "confirmed", result_ref: row.result_ref, duplicate: true };
  }
  if (row.status === "cancelled") {
    throw new ApiError(409, "This action was cancelled and cannot be confirmed.");
  }
  if (row.action_kind !== "pre_shoot_huddle" || row.target_type !== "job") {
    throw new ApiError(400, "Unsupported assistive action.");
  }
  const body = row.preview?.body ?? "";
  // Write through the EXISTING typed API — it enforces record access + audits.
  const view = await postRecordThreadMessage(client, auth, { entityType: "job", entityId: row.target_id, body });
  const resultRef = (view as { thread_id?: string })?.thread_id ?? "posted";
  await client.query(
    `UPDATE ai_assistive_action SET status = 'confirmed', confirmed_by_user_id = $3, confirmed_at = now(), result_ref = $4, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, actionId, auth.id, resultRef]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "ai.assistive_action_confirmed",
    entityType: "ai_assistive_action",
    entityId: actionId,
    metadata: { action_kind: row.action_kind, target_type: row.target_type, target_id: row.target_id }
  });
  return { action_id: actionId, status: "confirmed", result_ref: resultRef, duplicate: false };
}

export async function cancelAssistiveAction(client: PoolClient, auth: AuthUser, actionId: string) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const existing = await client.query<{ status: string }>(
    `SELECT status FROM ai_assistive_action WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, actionId]
  );
  if (!existing.rows[0]) throw new ApiError(404, "Assistive action not found");
  if (existing.rows[0].status === "confirmed") {
    throw new ApiError(409, "A confirmed action cannot be cancelled.");
  }
  await client.query(
    `UPDATE ai_assistive_action SET status = 'cancelled', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, actionId]
  );
  return { action_id: actionId, status: "cancelled" };
}

// ---------------------------------------------------------------------------
// H9-E — Learning-memory transparency. Only explicit, useful, self-scoped state
// is stored; this endpoint shows the employee exactly what that is. No hidden
// profile, inference, or ranking exists to show.
// ---------------------------------------------------------------------------
export async function getMyLearningMemory(client: PoolClient, auth: AuthUser) {
  if (!isActiveMembership(auth)) throw new ApiError(403, "Forbidden");
  const assignments = await client.query(
    `SELECT l.title, a.status, a.completed_at::text
     FROM training_lesson_assignment a JOIN training_lesson l ON l.id = a.lesson_id
     WHERE a.tenant_id = $1 AND a.user_id = $2 ORDER BY a.assigned_at DESC LIMIT 50`,
    [auth.tenantId, auth.id]
  );
  // Topics to review = review sections of questions this employee has missed.
  const reviewTopics = await client.query<{ title: string }>(
    `SELECT DISTINCT s.title
     FROM training_readiness_attempt ra
     JOIN training_lesson_question q ON q.id = ANY(ra.missed_question_ids)
     JOIN training_lesson_section s ON s.id = q.review_section_id
     WHERE ra.tenant_id = $1 AND ra.user_id = $2`,
    [auth.tenantId, auth.id]
  );
  return {
    statement:
      "This is everything Ask Bailey stores about your learning. It is used to support your training and coaching — never for discipline, ranking, or any hidden profile.",
    assigned_and_completed_training: assignments.rows,
    topics_to_review: reviewTopics.rows.map((r) => r.title),
    correction_path: "If anything here is wrong, tell your training manager — they can correct or reassign it.",
    stored_categories: ["assigned/completed training", "readiness topics to review"],
    not_stored: ["personality profiles", "inferred personal attributes", "secret competence rankings", "disciplinary recommendations", "employment decisions"]
  };
}
