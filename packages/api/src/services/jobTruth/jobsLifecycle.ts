import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import { hasReadScope, requireManageAccess, getJobDetail } from "./jobService.js";
import { writeJobActivity } from "./activityLogService.js";
import { hasAuthorityTier } from "../../authz/authority.js";

// ── Jobs lifecycle reconciliation + archival (Phase 3C) ──────────────────────
// Canonical, tenant-scoped, idempotent, dry-run-capable, auditable. Refreshes
// derived lifecycle state from canonical records, archives only records meeting a
// deterministic policy, and NEVER: creates Shoot links, deletes history, infers
// completion from age alone, or hides unresolved work. See
// docs/jobs-data-lifecycle-and-cleanup-audit.md.

// Centralized recent-completion window for the default operating view.
export const JOBS_RECENT_COMPLETION_DAYS = 30;

const ALL_DEPARTMENTS: JobDepartmentType[] = ["schools", "sports", "corporate", "headshots", "other"];

export type JobLifecycleClass =
  | "active"
  | "upcoming"
  | "needs_attention"
  | "waiting"
  | "recently_completed"
  | "historical_completed"
  | "canceled"
  | "archived"
  | "review_required";

// Canonical signals for one Job (computed by the reconcile CTE below).
type JobSignals = {
  id: string;
  department_type: JobDepartmentType;
  job_status: string;
  production_status: string;
  readiness_status: string;
  risk_status: string;
  staffing_status: string;
  account_owner_user_id: string | null;
  scheduled_start_at: string | null;
  archived_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  data_origin: string | null;
  open_blocker_count: number;
  open_watch_flag_count: number;
  open_workflow_count: number;
  open_production_count: number;
  last_meaningful_activity_at: string;
};

function isCanonicallyComplete(s: JobSignals): boolean {
  return s.job_status === "execution_complete" || s.production_status === "delivered" || s.production_status === "complete" || s.completed_at != null;
}
function isCanceled(s: JobSignals): boolean {
  return s.job_status === "cancelled" || s.cancelled_at != null;
}
function hasOpenWork(s: JobSignals): boolean {
  return s.open_blocker_count > 0 || s.open_workflow_count > 0 || s.open_production_count > 0;
}
function isStale(s: JobSignals, nowMs: number): boolean {
  return new Date(s.last_meaningful_activity_at).getTime() < nowMs - JOBS_RECENT_COMPLETION_DAYS * 86400000;
}

// Pure classifier. Conflicts (looks complete but has open work) => review_required;
// they are never silently overwritten or auto-archived.
export function classifyJobLifecycle(s: JobSignals, nowMs: number): { lifecycle: JobLifecycleClass; review_reason: string | null } {
  if (s.archived_at != null) return { lifecycle: "archived", review_reason: null };
  if (isCanceled(s)) return { lifecycle: "canceled", review_reason: null };
  if (isCanonicallyComplete(s)) {
    if (hasOpenWork(s)) {
      return { lifecycle: "review_required", review_reason: "Marked complete but has open blockers, workflow, or production work." };
    }
    return { lifecycle: isStale(s, nowMs) ? "historical_completed" : "recently_completed", review_reason: null };
  }
  const needsAttention =
    s.readiness_status === "at_risk" || s.readiness_status === "off_track" || s.risk_status === "high" || s.risk_status === "critical" || hasOpenWork(s) || s.account_owner_user_id == null;
  if (needsAttention) return { lifecycle: "needs_attention", review_reason: null };
  if (s.job_status === "weather_hold" || s.job_status === "postponed") return { lifecycle: "waiting", review_reason: null };
  if (s.scheduled_start_at != null && new Date(s.scheduled_start_at).getTime() > nowMs) return { lifecycle: "upcoming", review_reason: null };
  return { lifecycle: "active", review_reason: null };
}

// The signals CTE — canonical job columns + the same derived aggregates used by the
// index, plus open-workflow (conservative: any non-terminal workflow_run) and
// open-production (non-terminal production_items) and last_meaningful_activity_at.
const SIGNALS_CTE = `
  signals AS (
    SELECT
      j.id, j.department_type, j.job_status::text AS job_status, j.production_status::text AS production_status,
      j.readiness_status::text AS readiness_status, j.risk_status::text AS risk_status, j.staffing_status::text AS staffing_status,
      j.account_owner_user_id, j.scheduled_start_at, j.archived_at, j.cancelled_at, j.completed_at, j.data_origin,
      (SELECT count(*) FROM job_readiness_items r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id AND r.is_blocker AND NOT r.is_complete)::int AS open_blocker_count,
      (SELECT count(*) FROM job_watch_flags w WHERE w.tenant_id=j.tenant_id AND w.job_id=j.id AND w.status IN ('open','acknowledged','snoozed'))::int AS open_watch_flag_count,
      (SELECT count(*) FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id)::int AS open_workflow_count,
      (SELECT count(*) FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id AND p.status::text NOT IN ('delivered','complete','cancelled'))::int AS open_production_count,
      GREATEST(
        j.updated_at, j.created_at,
        COALESCE((SELECT max(a.created_at) FROM activity_log_entries a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id),'epoch'),
        COALESCE((SELECT max(wr.updated_at) FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id),'epoch'),
        COALESCE((SELECT max(p.updated_at) FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id),'epoch')
      ) AS last_meaningful_activity_at
    FROM jobs j
    WHERE j.tenant_id = $1 AND j.department_type::text = ANY($2::text[])
  )`;

function readableDepartments(auth: AuthUser): JobDepartmentType[] {
  return ALL_DEPARTMENTS.filter((d) => hasReadScope(auth, d) != null);
}

export type JobsReconcileReport = {
  dry_run: boolean;
  recent_completion_days: number;
  total: number;
  by_class: Record<JobLifecycleClass, number>;
  applied: { completed_at_backfilled: number; auto_archived: number };
  review_required: Array<{ job_id: string; reason: string }>;
};

// Reconcile derived lifecycle state. Idempotent: a second run applies nothing new.
export async function reconcileJobsLifecycle(
  client: PoolClient,
  auth: AuthUser,
  options: { dryRun?: boolean } = {}
): Promise<JobsReconcileReport> {
  const dryRun = options.dryRun !== false; // default to dry-run for safety
  // Applying safe state is a maintenance mutation — require an administrative role.
  // Dry-run (read-only classification) is allowed for any authorized reader.
  if (!dryRun && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Lifecycle maintenance apply requires an administrative role");
  }
  const departments = readableDepartments(auth);
  const empty: JobsReconcileReport = {
    dry_run: dryRun,
    recent_completion_days: JOBS_RECENT_COMPLETION_DAYS,
    total: 0,
    by_class: { active: 0, upcoming: 0, needs_attention: 0, waiting: 0, recently_completed: 0, historical_completed: 0, canceled: 0, archived: 0, review_required: 0 },
    applied: { completed_at_backfilled: 0, auto_archived: 0 }
  } as JobsReconcileReport;
  if (!departments.length) return empty;

  const rows = (await client.query<JobSignals>(`WITH ${SIGNALS_CTE} SELECT * FROM signals`, [auth.tenantId, departments])).rows;
  const nowMs = Date.now();
  const report: JobsReconcileReport = { ...empty, total: rows.length, review_required: [] };

  for (const s of rows) {
    const { lifecycle, review_reason } = classifyJobLifecycle(s, nowMs);
    report.by_class[lifecycle] = (report.by_class[lifecycle] ?? 0) + 1;
    if (lifecycle === "review_required" && review_reason) {
      report.review_required.push({ job_id: s.id, reason: review_reason });
      continue; // never auto-apply to a conflicted record
    }

    // Safe apply 1: backfill completed_at on a canonically-complete Job that lacks it.
    if (isCanonicallyComplete(s) && !hasOpenWork(s) && s.completed_at == null) {
      report.applied.completed_at_backfilled += 1;
      if (!dryRun) {
        await client.query(`UPDATE jobs SET completed_at = $3, updated_at = now() WHERE tenant_id=$1 AND id=$2 AND completed_at IS NULL`, [
          auth.tenantId,
          s.id,
          s.last_meaningful_activity_at
        ]);
        await writeJobActivity(client, { tenantId: auth.tenantId, jobId: s.id, actorUserId: auth.id, eventType: "lifecycle_reconciled", summary: "Backfilled completion date from canonical state", departmentType: s.department_type });
      }
    }

    // Safe apply 2: auto-archive a completed/canceled Job with NO open work, outside
    // the recent-completion window. Age alone never qualifies — completion/cancel +
    // zero open work are required.
    if ((isCanonicallyComplete(s) || isCanceled(s)) && !hasOpenWork(s) && s.archived_at == null && isStale(s, nowMs)) {
      report.applied.auto_archived += 1;
      if (!dryRun) {
        await client.query(
          `UPDATE jobs SET archived_at = now(), archived_by_user_id = $3,
                  archive_reason = 'lifecycle maintenance: completed/canceled with no open work, outside recent window',
                  job_status = 'archived', updated_at = now()
             WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL`,
          [auth.tenantId, s.id, auth.id]
        );
        await writeJobActivity(client, { tenantId: auth.tenantId, jobId: s.id, actorUserId: auth.id, eventType: "job_archived", summary: "Auto-archived by lifecycle maintenance", departmentType: s.department_type });
      }
    }
  }
  return report;
}

async function loadJobDepartment(client: PoolClient, auth: AuthUser, jobId: string): Promise<{ department_type: JobDepartmentType; archived_at: string | null }> {
  const rows = (await client.query<{ department_type: JobDepartmentType; archived_at: string | null }>(
    `SELECT department_type, archived_at::text FROM jobs WHERE tenant_id=$1 AND id=$2`,
    [auth.tenantId, jobId]
  )).rows;
  if (!rows.length) throw new ApiError(404, "Job not found");
  return rows[0];
}

// Audit-aware archive: records who/why and clears any prior restore marker. Reuses
// the existing archived_at column; idempotent (already-archived is a no-op).
export async function archiveJobLifecycle(client: PoolClient, auth: AuthUser, jobId: string, reason: string | null) {
  const job = await loadJobDepartment(client, auth, jobId);
  requireManageAccess(auth, job.department_type);
  if (job.archived_at == null) {
    await client.query(
      `UPDATE jobs SET archived_at = now(), archived_by_user_id = $3, archive_reason = $4, restored_at = NULL, restored_by_user_id = NULL,
              job_status = 'archived', updated_at = now()
         WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL`,
      [auth.tenantId, jobId, auth.id, reason]
    );
    await writeJobActivity(client, { tenantId: auth.tenantId, jobId, actorUserId: auth.id, eventType: "job_archived", summary: "Archived job", departmentType: job.department_type, newValues: { archived: true, archive_reason: reason } });
  }
  return getJobDetail(client, auth, jobId);
}

// Restore an archived Job. Idempotent (not-archived is a no-op).
export async function restoreJobLifecycle(client: PoolClient, auth: AuthUser, jobId: string) {
  const job = await loadJobDepartment(client, auth, jobId);
  requireManageAccess(auth, job.department_type);
  if (job.archived_at != null) {
    await client.query(
      // Return to a re-triage status (the prior status was overwritten at archive time).
      `UPDATE jobs SET archived_at = NULL, restored_at = now(), restored_by_user_id = $3,
              job_status = CASE WHEN job_status = 'archived' THEN 'pending_confirmation' ELSE job_status END, updated_at = now()
         WHERE tenant_id=$1 AND id=$2 AND archived_at IS NOT NULL`,
      [auth.tenantId, jobId, auth.id]
    );
    await writeJobActivity(client, { tenantId: auth.tenantId, jobId, actorUserId: auth.id, eventType: "job_restored", summary: "Restored job from archive", departmentType: job.department_type, newValues: { archived: false } });
  }
  return getJobDetail(client, auth, jobId);
}
