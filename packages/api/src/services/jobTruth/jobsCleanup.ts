import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import { hasReadScope } from "./jobService.js";
import { hasAuthorityTier } from "../../authz/authority.js";
import { classifyJobLifecycle, JOBS_RECENT_COMPLETION_DAYS } from "./jobsLifecycle.js";
import { getCuratedDemoJobIds, tenantIsDemo } from "./jobsProvenance.js";

// ── Jobs cleanup dry-run (Phase 3C, Commit 3) ────────────────────────────────
// Read-only. Classifies every Job, counts its protected dependencies, and proposes
// a safe action. It writes NO data and is stable on re-run. A hard purge is NEVER
// performed here — purge-eligible candidates are only reported, and any record with
// a protected dependency is blocked. The actual executor is a separately-approved,
// transactional, backed-up, batch-recorded step (see docs/jobs-data-lifecycle-and-
// cleanup-audit.md §7-9). This module deliberately contains no delete.

const ALL_DEPARTMENTS: JobDepartmentType[] = ["schools", "sports", "corporate", "headshots", "other"];

// Any of these child relationships blocks a hard purge (operational / workflow /
// production / staffing / audit value). Counted per Job from canonical job_id links.
export const JOB_PURGE_BLOCKING_DEPENDENCIES = [
  "workflow_runs",
  "tasks",
  "production_items",
  "staff_assignments",
  "readiness_items",
  "watch_flags",
  "activity_log",
  "job_days",
  "confirmed_shoot_links"
] as const;

export type JobPurgeProposedAction =
  | "keep_active" // keep operational
  | "keep_curated_demo" // keep a representative demo Job
  | "archive" // archive legitimate history (completed/canceled)
  | "archive_excess_demo" // archive demo with protected dependencies (not purgeable)
  | "manual_review"
  | "duplicate_review"
  | "purge"; // deterministic disposable demo/test with no protected dependencies

export type JobPurgeCandidate = {
  tenant_id: string;
  job_id: string;
  job_number: string | null;
  title: string;
  organization_id: string | null;
  created_at: string;
  scheduled_start_at: string | null;
  lifecycle_status: string;
  production_status: string;
  readiness_status: string;
  risk_status: string;
  owner_user_id: string | null;
  last_meaningful_activity_at: string;
  data_origin: string | null;
  // Provenance the backfill *would* assign (the dry-run is useful before the backfill
  // is applied): seed_demo when provably demo, else the current data_origin.
  proposed_data_origin: string | null;
  is_curated_demo: boolean;
  would_be_recreated_by_seed: boolean;
  source_seed_or_fixture: string | null;
  related_record_counts: Record<string, number>;
  blocking_dependencies: string[];
  proposed_action: JobPurgeProposedAction;
  classification_reason: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  survivor_job_id: string | null;
};

export type JobsPurgeDryRunReport = {
  dry_run: true;
  generated_for_tenant: string;
  tenant_is_demo: boolean;
  recent_completion_days: number;
  total_jobs: number;
  curated_demo_count: number;
  // Projected sizes of the operating view AFTER the proposed actions are applied:
  // default (demo hidden) vs Show-Demo-Data (curated demo included).
  projected_default_view_total: number;
  projected_demo_view_total: number;
  totals_by_action: Record<JobPurgeProposedAction, number>;
  hard_purge_candidates: JobPurgeCandidate[];
  blocked_candidates: JobPurgeCandidate[];
  duplicate_groups: Array<{ key: string; job_ids: string[] }>;
  candidates: JobPurgeCandidate[];
};

function readableDepartments(auth: AuthUser): JobDepartmentType[] {
  return ALL_DEPARTMENTS.filter((d) => hasReadScope(auth, d) != null);
}

export const JOB_DEMO_CURATION_ARCHIVE_REASON = "demo_curation_excess";

export type JobCurationSnapshot = {
  job_id: string;
  job_status: string;
  production_status: string;
  readiness_status: string;
  risk_status: string;
  staffing_status: string;
};

export type JobsCleanupApplyReport = {
  applied: true;
  batch_id: string;
  archive_reason: string;
  archived_excess_demo: number;
  kept_curated_demo: number;
  hard_purged: 0; // archival-only executor — it contains no DELETE and can never purge
  exported_candidates: JobCurationSnapshot[]; // the IDs + lifecycle snapshots, for the audit artifact
};

// Archival-only apply (Phase 3C.1, user-authorized demo curation). Archives the demo Jobs
// NOT in the curated set, through the audited, REVERSIBLE archive columns (records
// pre_archive_state so restore returns the prior status). It is structurally incapable of
// hard deletion — there is no DELETE here; a hard purge remains a separate, separately-
// authorized step. Admin-gated, idempotent (already-archived rows skipped). Before
// archiving it EXPORTS the candidate IDs + lifecycle snapshots and stamps every row with
// one batch id (in pre_archive_state) for traceability + rollback. Marking
// (data_origin='seed_demo') must already be applied or run in the same transaction.
export async function applyJobsCleanupArchival(client: PoolClient, auth: AuthUser): Promise<JobsCleanupApplyReport> {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Jobs cleanup apply requires an administrative role");
  }
  const curated = await getCuratedDemoJobIds(client, auth.tenantId);
  const curatedArr = [...curated];
  const batchId = (await client.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
  const candidateWhere = `tenant_id = $1 AND data_origin = 'seed_demo' AND archived_at IS NULL AND NOT (id = ANY($2::uuid[]))`;

  // Export the candidate IDs + lifecycle snapshots BEFORE archiving (the audit artifact).
  const exported = (
    await client.query<JobCurationSnapshot>(
      `SELECT id::text AS job_id, job_status::text AS job_status, production_status::text AS production_status,
              readiness_status::text AS readiness_status, risk_status::text AS risk_status, staffing_status::text AS staffing_status
         FROM jobs WHERE ${candidateWhere}`,
      [auth.tenantId, curatedArr]
    )
  ).rows;

  const res = await client.query(
    `UPDATE jobs SET archived_at = now(), archived_by_user_id = $3,
            archive_reason = '${JOB_DEMO_CURATION_ARCHIVE_REASON}',
            pre_archive_state = jsonb_build_object(
              'job_status', job_status::text, 'production_status', production_status::text,
              'readiness_status', readiness_status::text, 'risk_status', risk_status::text,
              'staffing_status', staffing_status::text, 'demo_curation_batch_id', $4::text),
            job_status = 'archived', updated_at = now()
       WHERE ${candidateWhere}`,
    [auth.tenantId, curatedArr, auth.id, batchId]
  );
  return {
    applied: true,
    batch_id: batchId,
    archive_reason: JOB_DEMO_CURATION_ARCHIVE_REASON,
    archived_excess_demo: res.rowCount ?? 0,
    kept_curated_demo: curatedArr.length,
    hard_purged: 0,
    exported_candidates: exported
  };
}

export async function getJobsPurgeDryRun(client: PoolClient, auth: AuthUser): Promise<JobsPurgeDryRunReport> {
  // Purge is the most destructive operation — even the dry-run is gated to an
  // administrative role (stronger than archive's manage access).
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Jobs cleanup requires an administrative role");
  }
  const departments = readableDepartments(auth);
  const isDemoTenant = await tenantIsDemo(client, auth.tenantId);
  const base: JobsPurgeDryRunReport = {
    dry_run: true,
    generated_for_tenant: auth.tenantId,
    tenant_is_demo: isDemoTenant,
    recent_completion_days: JOBS_RECENT_COMPLETION_DAYS,
    total_jobs: 0,
    curated_demo_count: 0,
    projected_default_view_total: 0,
    projected_demo_view_total: 0,
    totals_by_action: { keep_active: 0, keep_curated_demo: 0, archive: 0, archive_excess_demo: 0, manual_review: 0, duplicate_review: 0, purge: 0 },
    hard_purge_candidates: [],
    blocked_candidates: [],
    duplicate_groups: [],
    candidates: []
  };
  if (!departments.length) return base;
  const curatedSet = await getCuratedDemoJobIds(client, auth.tenantId);

  const rows = (
    await client.query(
      `
      SELECT
        j.id::text AS job_id, j.tenant_id::text AS tenant_id, j.job_number, j.title, j.organization_id::text AS organization_id,
        j.created_at::text AS created_at, j.scheduled_start_at::text AS scheduled_start_at,
        j.job_status::text AS job_status, j.production_status::text AS production_status, j.readiness_status::text AS readiness_status,
        j.risk_status::text AS risk_status, j.staffing_status::text AS staffing_status, j.account_owner_user_id::text AS account_owner_user_id,
        j.archived_at::text AS archived_at, j.cancelled_at::text AS cancelled_at, j.completed_at::text AS completed_at, j.data_origin,
        -- provenance signals (provable): a [marker] description prefix or a *-DEMO-* job number
        (j.description_internal ~ '^\\[[a-z_0-9]+\\]' OR j.job_number LIKE '%-DEMO-%') AS provable_demo_signal,
        substring(j.description_internal from '^\\[([a-z_0-9]+)\\]') AS demo_marker,
        (SELECT count(*) FROM job_readiness_items r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id AND r.is_blocker AND NOT r.is_complete)::int AS open_blocker_count,
        (SELECT count(*) FROM job_watch_flags w WHERE w.tenant_id=j.tenant_id AND w.job_id=j.id AND w.status IN ('open','acknowledged','snoozed'))::int AS open_watch_flag_count,
        GREATEST(j.updated_at, j.created_at,
          COALESCE((SELECT max(a.created_at) FROM activity_log_entries a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id),'epoch'),
          COALESCE((SELECT max(wr.updated_at) FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id),'epoch'),
          COALESCE((SELECT max(p.updated_at) FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id),'epoch'))::text AS last_meaningful_activity_at,
        -- protected dependency counts
        (SELECT count(*) FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id)::int AS dep_workflow_runs,
        (SELECT count(*) FROM work_task t WHERE t.tenant_id=j.tenant_id AND t.related_job_id=j.id)::int AS dep_tasks,
        (SELECT count(*) FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id)::int AS dep_production_items,
        (SELECT count(*) FROM job_staff_assignments sa WHERE sa.tenant_id=j.tenant_id AND sa.job_id=j.id)::int AS dep_staff_assignments,
        (SELECT count(*) FROM job_readiness_items r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id)::int AS dep_readiness_items,
        (SELECT count(*) FROM job_watch_flags w WHERE w.tenant_id=j.tenant_id AND w.job_id=j.id)::int AS dep_watch_flags,
        (SELECT count(*) FROM activity_log_entries a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id)::int AS dep_activity_log,
        (SELECT count(*) FROM job_days d WHERE d.tenant_id=j.tenant_id AND d.job_id=j.id)::int AS dep_job_days,
        (CASE WHEN j.legacy_shoot_id IS NOT NULL THEN 1 ELSE 0 END
          + (SELECT count(*) FROM job_shoot_links l WHERE l.tenant_id=j.tenant_id AND l.job_id=j.id))::int AS dep_confirmed_shoot_links
      FROM jobs j
      WHERE j.tenant_id=$1 AND j.department_type::text = ANY($2::text[])
      `,
      [auth.tenantId, departments]
    )
  ).rows as any[];

  const nowMs = Date.now();
  const candidates: JobPurgeCandidate[] = rows.map((r) => {
    const { lifecycle } = classifyJobLifecycle(
      {
        id: r.job_id, department_type: "sports", job_status: r.job_status, production_status: r.production_status,
        readiness_status: r.readiness_status, risk_status: r.risk_status, staffing_status: r.staffing_status,
        account_owner_user_id: r.account_owner_user_id, scheduled_start_at: r.scheduled_start_at, archived_at: r.archived_at,
        cancelled_at: r.cancelled_at, completed_at: r.completed_at, data_origin: r.data_origin,
        open_blocker_count: r.open_blocker_count, open_watch_flag_count: r.open_watch_flag_count, open_workflow_count: 0,
        open_production_count: 0, last_meaningful_activity_at: r.last_meaningful_activity_at
      },
      nowMs
    );
    const related: Record<string, number> = {
      workflow_runs: r.dep_workflow_runs, tasks: r.dep_tasks, production_items: r.dep_production_items,
      staff_assignments: r.dep_staff_assignments, readiness_items: r.dep_readiness_items, watch_flags: r.dep_watch_flags,
      activity_log: r.dep_activity_log, job_days: r.dep_job_days, confirmed_shoot_links: r.dep_confirmed_shoot_links
    };
    const blocking = JOB_PURGE_BLOCKING_DEPENDENCIES.filter((d) => (related[d] ?? 0) > 0);
    // Effective (proposed) provenance: the marked origin if present, else seed_demo when
    // provably demo (per-Job signal, or a conclusively demo tenant). Never name-only.
    const provableDemo = r.provable_demo_signal === true;
    const effectiveOrigin: string | null = r.data_origin ?? (provableDemo || isDemoTenant ? "seed_demo" : null);
    const isSynthetic = effectiveOrigin === "seed_demo" || effectiveOrigin === "test_fixture";
    const isCurated = curatedSet.has(r.job_id);
    const wouldBeRecreated = isSynthetic; // a seed re-run recreates the demo population
    const sourceSeed: string | null =
      r.demo_marker ??
      (typeof r.job_number === "string" && r.job_number.includes("-DEMO-") ? r.job_number.split("-DEMO-")[0] : null) ??
      (isSynthetic && isDemoTenant ? "seed-mission-control-demo" : null);
    const isOrphan = r.organization_id == null && blocking.length === 0;

    let action: JobPurgeProposedAction;
    let reason: string;
    let confidence: "high" | "medium" | "low" = "medium";
    if (r.archived_at != null) {
      action = "keep_active"; reason = "Already archived — retained."; confidence = "high";
    } else if (lifecycle === "review_required") {
      action = "manual_review"; reason = "Complete-looking but has open blockers/workflow/production."; confidence = "low";
    } else if (isSynthetic && isCurated) {
      action = "keep_curated_demo"; reason = "Representative demo record kept by the curated-demo policy."; confidence = "high";
    } else if (isSynthetic && blocking.length === 0) {
      action = "purge"; reason = `Disposable ${effectiveOrigin} record with no protected dependencies.`; confidence = "high";
    } else if (isSynthetic) {
      action = "archive_excess_demo"; reason = `Excess demo record with protected dependencies (${blocking.join(", ")}) — archive, do not purge.`; confidence = "high";
    } else if (isOrphan) {
      action = "manual_review"; reason = "Orphaned: no organization and no canonical child records."; confidence = "low";
    } else if (lifecycle === "historical_completed") {
      action = "archive"; reason = "Completed and outside the recent-completion window."; confidence = "high";
    } else if (lifecycle === "canceled") {
      action = "archive"; reason = "Canceled — exclude from the active view."; confidence = "high";
    } else {
      action = "keep_active"; reason = `Live operational record (${lifecycle}).`; confidence = "high";
    }
    const warnings: string[] = [];
    if (isSynthetic && !isCurated && blocking.length > 0) warnings.push(`Demo record retained by dependencies (archived, not purged): ${blocking.join(", ")}.`);

    return {
      tenant_id: r.tenant_id, job_id: r.job_id, job_number: r.job_number, title: r.title, organization_id: r.organization_id,
      created_at: r.created_at, scheduled_start_at: r.scheduled_start_at, lifecycle_status: lifecycle,
      production_status: r.production_status, readiness_status: r.readiness_status, risk_status: r.risk_status,
      owner_user_id: r.account_owner_user_id, last_meaningful_activity_at: r.last_meaningful_activity_at, data_origin: r.data_origin,
      proposed_data_origin: effectiveOrigin, is_curated_demo: isCurated, would_be_recreated_by_seed: wouldBeRecreated, source_seed_or_fixture: sourceSeed,
      related_record_counts: related, blocking_dependencies: blocking, proposed_action: action, classification_reason: reason,
      confidence, warnings, survivor_job_id: null
    };
  });

  // Deterministic duplicate groups (exact job_number — unique constraint => none today;
  // listed for completeness, never auto-merged).
  const byNumber = new Map<string, string[]>();
  for (const c of candidates) {
    if (!c.job_number) continue;
    byNumber.set(c.job_number, [...(byNumber.get(c.job_number) ?? []), c.job_id]);
  }
  const duplicate_groups = Array.from(byNumber.entries()).filter(([, v]) => v.length > 1).map(([key, job_ids]) => ({ key, job_ids }));

  const totals_by_action = { ...base.totals_by_action };
  for (const c of candidates) totals_by_action[c.proposed_action] += 1;

  // Projected operating-view sizes after the proposed actions. A Job stays in the
  // active view only if it is not archived and not slated for removal (purge/archive).
  const REMOVED = new Set<JobPurgeProposedAction>(["purge", "archive", "archive_excess_demo"]);
  const isDemo = (c: JobPurgeCandidate) => c.proposed_data_origin === "seed_demo" || c.proposed_data_origin === "test_fixture";
  const inActiveBase = (c: JobPurgeCandidate) => c.lifecycle_status !== "archived" && !REMOVED.has(c.proposed_action);
  const projected_default_view_total = candidates.filter((c) => inActiveBase(c) && !isDemo(c)).length;
  const projected_demo_view_total = candidates.filter((c) => inActiveBase(c) && (!isDemo(c) || c.is_curated_demo)).length;

  return {
    ...base,
    total_jobs: candidates.length,
    curated_demo_count: candidates.filter((c) => c.is_curated_demo).length,
    projected_default_view_total,
    projected_demo_view_total,
    totals_by_action,
    hard_purge_candidates: candidates.filter((c) => c.proposed_action === "purge"),
    blocked_candidates: candidates.filter((c) => c.warnings.length > 0),
    duplicate_groups,
    candidates
  };
}
