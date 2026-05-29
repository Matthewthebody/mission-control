import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../../authz/authority.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type { ChecklistAttentionItem } from "../../types/checklists.js";
import type {
  DashboardResponse,
  DashboardTodayJobItem,
  RecentMovementItem,
  WatchFlagListItem,
  WorkloadPressureItem
} from "../../types/jobTruth.js";
import { listChecklistAttention } from "./checklistService.js";
import { buildDashboardWidgetLayout, buildDashboardWidgets } from "./dashboardWidgetLayout.js";
import { listJobs, listProductionQueue } from "./jobService.js";
import { computeOperationalHealth } from "./operationalHealthService.js";
import { buildDashboardProductionSnapshot, getProductionReporting } from "./productionBoardReportingService.js";
import { canAccessExecutiveCommandLayer, getReadableJobDepartments } from "./sharedCommandAccess.js";
import { listWatchFlags } from "./watchFlagService.js";

type DashboardScope = DashboardResponse["scope"];

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getTodayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function getNextSevenKey(now = new Date()) {
  return addDays(now, 7).toISOString().slice(0, 10);
}

function resolveDashboardDepartment(auth: AuthUser, requestedDepartment?: JobDepartmentType | null) {
  if (requestedDepartment) {
    return requestedDepartment;
  }
  if (auth.department === "schools" || auth.department === "sports") {
    return auth.department;
  }
  return null;
}

async function countJobsNextSevenDays(client: PoolClient, auth: AuthUser, departmentType: JobDepartmentType | null) {
  const readableDepartments = getReadableJobDepartments(auth);
  if (!readableDepartments.length) {
    return 0;
  }
  const today = getTodayKey();
  const nextWeek = getNextSevenKey();
  const { rows } = await client.query<{ job_id: string; department_type: JobDepartmentType; account_owner_user_id: string | null; created_by_user_id: string | null; is_assigned: boolean }>(
    `
      SELECT DISTINCT
        job.id::text AS job_id,
        job.department_type::text AS department_type,
        job.account_owner_user_id::text AS account_owner_user_id,
        job.created_by_user_id::text AS created_by_user_id,
        EXISTS(
          SELECT 1
          FROM job_staff_assignments assignment
          WHERE assignment.tenant_id = job.tenant_id
            AND assignment.job_id = job.id
            AND assignment.user_id = $2
            AND assignment.assignment_status <> 'cancelled'
        ) AS is_assigned
      FROM jobs job
      JOIN job_days day
        ON day.job_id = job.id
       AND day.tenant_id = job.tenant_id
      WHERE job.tenant_id = $1
        AND job.department_type::text = ANY($3::text[])
        AND ($4::text IS NULL OR job.department_type::text = $4::text)
        AND day.date BETWEEN $5::date AND $6::date
    `,
    [auth.tenantId, auth.id, readableDepartments, departmentType, today, nextWeek]
  );

  return rows.filter((row) => {
    const scope = getReadableJobDepartments(auth).includes(row.department_type) ? row.department_type : null;
    if (!scope) {
      return false;
    }
    if (canAccessExecutiveCommandLayer(auth)) {
      return true;
    }
    if (row.department_type === departmentType || departmentType == null) {
      if (auth.department === row.department_type || hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
        return true;
      }
      return row.account_owner_user_id === auth.id || row.created_by_user_id === auth.id || row.is_assigned;
    }
    return false;
  }).length;
}

async function loadRecentMovement(client: PoolClient, auth: AuthUser, departmentType: JobDepartmentType | null): Promise<RecentMovementItem[]> {
  const readableDepartments = getReadableJobDepartments(auth);
  if (!readableDepartments.length) {
    return [];
  }
  const { rows } = await client.query<RecentMovementItem>(
    `
      SELECT
        activity.id::text AS id,
        activity.event_type,
        activity.summary,
        activity.created_at,
        actor.full_name AS actor_name,
        job.department_type::text AS department_type,
        job.id::text AS job_id,
        job.job_number,
        org.display_name AS organization_name
      FROM activity_log_entries activity
      LEFT JOIN jobs job
        ON job.id = activity.job_id
       AND job.tenant_id = activity.tenant_id
      LEFT JOIN organization org
        ON org.id = job.organization_id
       AND org.tenant_id = job.tenant_id
      LEFT JOIN app_user actor
        ON actor.id = activity.actor_user_id
       AND actor.tenant_id = activity.tenant_id
      WHERE activity.tenant_id = $1
        AND job.department_type::text = ANY($2::text[])
        AND ($3::text IS NULL OR job.department_type::text = $3::text)
        AND activity.event_type = ANY($4::text[])
      ORDER BY activity.created_at DESC
      LIMIT 20
    `,
    [
      auth.tenantId,
      readableDepartments,
      departmentType,
      [
        "watch_flag_resolved",
        "watch_flag_escalated",
        "lead_ready_confirmed",
        "production_item_updated",
        "approval_request_updated",
        "deliverable_updated",
        "job_postponed",
        "job_cancelled",
        "job_archived",
        "staff_assignment_updated"
      ]
    ]
  );
  return rows;
}

async function loadWorkloadPressure(
  client: PoolClient,
  auth: AuthUser,
  departmentType: JobDepartmentType | null,
  watchItems: WatchFlagListItem[]
): Promise<WorkloadPressureItem[]> {
  const ownerMap = new Map<string | null, WorkloadPressureItem>();
  const blockedQueue = await listProductionQueue(client, auth, {
    department_type: departmentType ?? undefined,
    blocked: "yes",
    run_automation: false
  });
  const dueToday = await listProductionQueue(client, auth, {
    department_type: departmentType ?? undefined,
    due_bucket: "today",
    run_automation: false
  });

  for (const item of watchItems.filter((flag) => flag.status !== "resolved" && flag.status !== "dismissed")) {
    const key = item.owner_user_id ?? null;
    const current = ownerMap.get(key) ?? {
      owner_user_id: item.owner_user_id,
      owner_name: item.owner_name ?? "Unassigned",
      open_flag_count: 0,
      blocked_production_count: 0,
      due_today_count: 0,
      score: 0
    };
    current.open_flag_count += 1;
    ownerMap.set(key, current);
  }

  for (const item of blockedQueue.items) {
    const key = item.assigned_to_user_id ?? null;
    const current = ownerMap.get(key) ?? {
      owner_user_id: item.assigned_to_user_id ?? null,
      owner_name: item.assigned_to_name ?? "Unassigned",
      open_flag_count: 0,
      blocked_production_count: 0,
      due_today_count: 0,
      score: 0
    };
    current.blocked_production_count += 1;
    ownerMap.set(key, current);
  }

  for (const item of dueToday.items) {
    const key = item.assigned_to_user_id ?? null;
    const current = ownerMap.get(key) ?? {
      owner_user_id: item.assigned_to_user_id ?? null,
      owner_name: item.assigned_to_name ?? "Unassigned",
      open_flag_count: 0,
      blocked_production_count: 0,
      due_today_count: 0,
      score: 0
    };
    current.due_today_count += 1;
    ownerMap.set(key, current);
  }

  return [...ownerMap.values()]
    .map((item) => ({
      ...item,
      score: item.open_flag_count * 5 + item.blocked_production_count * 8 + item.due_today_count * 4
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
}

function buildBlockedChecklistJobCount(items: ChecklistAttentionItem[]) {
  const jobIds = new Set<string>();
  for (const item of items) {
    if (item.blocked_transition && item.job_id) {
      jobIds.add(item.job_id);
    }
  }
  return jobIds.size;
}

export async function getDashboard(client: PoolClient, auth: AuthUser, scope: DashboardScope, departmentType?: JobDepartmentType | null): Promise<DashboardResponse> {
  const resolvedDepartment = scope === "executive" ? null : resolveDashboardDepartment(auth, departmentType);
  if (scope === "executive" && !canAccessExecutiveCommandLayer(auth)) {
    throw new ApiError(403, "Forbidden");
  }

  const today = getTodayKey();
  const jobsToday = await listJobs(client, auth, { department_type: resolvedDepartment ?? undefined, day_date: today });
  const watchlist = await listWatchFlags(client, auth, {
    department_type: resolvedDepartment ?? undefined,
    limit: 200,
    run_automation: false
  });
  const blockedQueue = await listProductionQueue(client, auth, {
    department_type: resolvedDepartment ?? undefined,
    blocked: "yes",
    run_automation: false
  });
  const checklistAttention = await listChecklistAttention(client, auth, {
    department_type: resolvedDepartment ?? undefined,
    limit: 96
  });
  const overdueApprovals = await listProductionQueue(client, auth, {
    department_type: resolvedDepartment ?? undefined,
    approval_status: "overdue",
    run_automation: false
  });
  const deliveryQueue = await listProductionQueue(client, auth, {
    department_type: resolvedDepartment ?? undefined,
    due_bucket: "next-7",
    run_automation: false
  });

  const urgentWatch = watchlist.items.filter((item) => item.priority_rank >= 420 || item.next_action_label.includes("ready")).slice(0, 10);
  const upcomingRisks = watchlist.items.filter((item) => item.status !== "resolved" && item.status !== "dismissed").slice(0, 12);
  const todayJobItems: DashboardTodayJobItem[] = jobsToday.map((job) => ({
    ...job,
    urgent_flag_count: watchlist.items.filter((item) => item.job_id === job.id && (item.severity === "critical" || item.severity === "high")).length,
    critical_flag_count: watchlist.items.filter((item) => item.job_id === job.id && item.severity === "critical").length
  }));
  const deliveryRisks = deliveryQueue.items.filter(
    (item) =>
      item.deliverable_status === "issue_flagged" ||
      (normalizeTimestamp(item.delivery_deadline_at) != null &&
        ["requested", "overdue", "revisions_requested"].includes(item.approval_status) &&
        item.status !== "delivered" &&
        item.status !== "complete")
  );

  const summary: DashboardResponse["summary"] = {
    jobs_today: jobsToday.length,
    jobs_next_7_days: await countJobsNextSevenDays(client, auth, resolvedDepartment),
    urgent_count: urgentWatch.length,
    critical_watch_count: watchlist.items.filter((item) => item.severity === "critical" && item.status !== "resolved" && item.status !== "dismissed").length,
    high_watch_count: watchlist.items.filter((item) => item.severity === "high" && item.status !== "resolved" && item.status !== "dismissed").length,
    blocked_production_count: blockedQueue.summary.blocked_count,
    overdue_approval_count: overdueApprovals.summary.awaiting_approval_count,
    delivery_risk_count: deliveryRisks.length,
    staffing_gap_count: watchlist.items.filter((item) => item.flag_type === "staffing_gap").length,
    missing_ready_confirmation_count: watchlist.items.filter((item) => item.flag_type === "ready_confirmation_missing").length,
    overdue_checklist_count: checklistAttention.summary.overdue_count,
    awaiting_checklist_approval_count: checklistAttention.summary.awaiting_approval_count,
    rejected_checklist_count: checklistAttention.summary.rejected_count,
    blocked_job_count: buildBlockedChecklistJobCount(checklistAttention.items)
  };

  const health = computeOperationalHealth({
    criticalWatchCount: summary.critical_watch_count,
    highWatchCount: summary.high_watch_count,
    staffingGapCount: summary.staffing_gap_count,
    blockedProductionCount: summary.blocked_production_count,
    overdueApprovalCount: summary.overdue_approval_count,
    deliveryRiskCount: summary.delivery_risk_count,
    missingReadyConfirmationCount: summary.missing_ready_confirmation_count,
    jobsToday: summary.jobs_today
  });

  const productionReporting =
    blockedQueue.items.length || overdueApprovals.items.length || deliveryQueue.items.length || canAccessExecutiveCommandLayer(auth)
      ? await getProductionReporting(client, auth, { department_type: resolvedDepartment })
      : null;
  const widgets = buildDashboardWidgets(auth, summary, resolvedDepartment, scope);

  return {
    scope,
    department_type: resolvedDepartment,
    summary,
    health,
    widgets,
    widget_layout: buildDashboardWidgetLayout(auth, widgets, scope, resolvedDepartment),
    urgent_watch: urgentWatch,
    checklist_attention_summary: checklistAttention.summary,
    checklist_attention: checklistAttention.items.slice(0, 12),
    upcoming_risks: upcomingRisks,
    today_jobs: todayJobItems,
    blocked_production: blockedQueue.items.slice(0, 8),
    overdue_approvals: overdueApprovals.items.slice(0, 8),
    delivery_risks: deliveryRisks.slice(0, 8),
    my_open_flags: watchlist.items.filter((item) => item.owner_user_id === auth.id && item.status !== "resolved" && item.status !== "dismissed").slice(0, 8),
    recent_movement: await loadRecentMovement(client, auth, resolvedDepartment),
    workload_pressure: await loadWorkloadPressure(client, auth, resolvedDepartment, watchlist.items),
    production_snapshot: productionReporting ? buildDashboardProductionSnapshot(productionReporting.summary) : null
  };
}
