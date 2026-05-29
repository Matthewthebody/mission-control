import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { JobDepartmentType } from "../domain/jobTruth/index.js";
import { getOperatingSystemQueryScope } from "./operatingSystemAccess.js";
import type { AuthUser } from "../types/auth.js";
import { getOperationalProductionSection } from "./jobTruth/productionBoardReportingService.js";
import type {
  OperationalApprovalsReportingSection,
  OperationalAttendanceReportingSection,
  OperationalModelReportingResponse,
  OperationalProductionReportingSection,
  OperationalReportingBucket,
  OperationalReportingBucketMetric,
  OperationalReportingPeriod,
  OperationalReportingSummaryCard,
  OperationalSchoolsReportingSection,
  OperationalReportingTrendPoint,
  OperationalWatchReportingSection
} from "../types/operationalReporting.js";

type ReportBucket = OperationalReportingBucket & {
  startsAt: Date;
  endsBefore: Date;
};

type WatchItemRow = {
  id: string;
  watch_type: string;
  severity: "red" | "yellow";
  status: "active" | "snoozed" | "handled" | "resolved";
  due_at: string | null;
  first_seen_at: string;
  resolved_at: string | null;
  scope_department: string | null;
  source_snapshot: Record<string, unknown> | null;
};

type WatchEventRow = {
  urgent_watch_item_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  scope_department: string | null;
  watch_type: string;
  source_snapshot: Record<string, unknown> | null;
};

type AttendanceShiftRow = {
  shift_id: string;
  starts_at: string;
  department: string | null;
  current_state: string | null;
  coverage_impact: boolean;
  critical_role_missing: boolean;
  understaffed_due_to_attendance: boolean;
};

type AttendanceHistoryRow = {
  shift_id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  department: string | null;
  starts_at: string;
};

type ProductionProjectRow = {
  id: string;
  created_at: string;
  completed_at: string | null;
  due_date: string | null;
  status: string;
  stage: string;
  job_type: string;
  department: string | null;
};

type ProductionTaskRow = {
  id: string;
  project_id: string;
  task_type: string;
  status: string;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  department: string | null;
};

type ProductionBlockerRow = {
  project_id: string;
  blocker_type: string;
  reason: string;
  resolved_at: string | null;
  created_at: string;
  department: string | null;
};

type ProductionReviewRow = {
  project_id: string;
  result: string;
  created_at: string;
  department: string | null;
};

type ApprovalRequestRow = {
  id: string;
  request_type: string;
  status: string;
  requester_department: string | null;
  created_at: string;
  decided_at: string | null;
  sla_due_at: string | null;
  overdue_at: string | null;
};

type ApprovalEventRow = {
  approval_request_id: string;
  event_type: string;
  created_at: string;
  requester_department: string | null;
};

type SchoolWorkItemRow = {
  id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  due_date: string | null;
  status: string;
  stage: string;
  waiting_on: string;
  priority: string;
  department: string | null;
};

type SchoolDeliverableRow = {
  id: string;
  created_at: string;
  due_date: string | null;
  ready_date: string | null;
  delivered_date: string | null;
  status: string;
  deliverable_type: string;
  department: string | null;
};

type AttendanceOutcome = "on_time" | "late" | "no_show" | "callout" | "other";

const ISSUE_ATTENDANCE_STATES = new Set(["late", "late_acknowledged", "unresolved_no_check_in", "called_out", "replacement_needed", "no_show"]);
const RESOLVED_ATTENDANCE_STATES = new Set(["checked_in", "on_time", "late_acknowledged", "manager_excused", "completed"]);
const ACTIVE_TASK_STATUSES = new Set(["todo", "in_progress", "blocked"]);

function toJobDepartmentType(value: string | null): JobDepartmentType | null {
  return value === "schools" || value === "sports" || value === "corporate" || value === "headshots" || value === "other" ? value : null;
}

export async function getOperationalModelReport(
  client: PoolClient,
  auth: AuthUser,
  input: {
    anchorDate: string;
    period: OperationalReportingPeriod;
    department?: string | null;
  }
): Promise<OperationalModelReportingResponse> {
  const scope = getOperatingSystemQueryScope(auth, "reports");
  if (scope.level === "none") {
    throw new ApiError(403, "You do not have access to view reporting.");
  }

  const scopedDepartment = resolveScopedDepartment(auth, scope.level, input.department ?? null);
  const window = buildReportingWindow(input.anchorDate, input.period);

  const watchItems = await loadWatchItems(client, auth.tenantId, window.startsAt, window.endsBefore);
  const watchEvents = await loadWatchEvents(client, auth.tenantId, window.startsAt, window.endsBefore);
  const attendanceShifts = await loadAttendanceShifts(client, auth.tenantId, window.startsAt, window.endsBefore);
  const attendanceHistory = await loadAttendanceHistory(client, auth.tenantId, window.startsAt, window.endsBefore);
  const approvalRequests = await loadApprovalRequests(client, auth.tenantId, window.startsAt, window.endsBefore);
  const approvalEvents = await loadApprovalEvents(client, auth.tenantId, window.startsAt, window.endsBefore);
  const schoolWorkItems = await loadSchoolWorkItems(client, auth.tenantId, window.startsAt, window.endsBefore);
  const schoolDeliverables = await loadSchoolDeliverables(client, auth.tenantId, window.startsAt, window.endsBefore);

  const filteredWatchItems = watchItems.filter((row) => matchesDepartment(scopedDepartment, row.scope_department));
  const filteredWatchEvents = watchEvents.filter((row) => matchesDepartment(scopedDepartment, row.scope_department));
  const filteredAttendanceShifts = attendanceShifts.filter((row) => matchesDepartment(scopedDepartment, row.department));
  const filteredAttendanceHistory = attendanceHistory.filter((row) => matchesDepartment(scopedDepartment, row.department));
  const filteredApprovalRequests = approvalRequests.filter((row) => matchesDepartment(scopedDepartment, row.requester_department));
  const filteredApprovalEvents = approvalEvents.filter((row) => matchesDepartment(scopedDepartment, row.requester_department));
  const filteredSchoolWorkItems = schoolWorkItems.filter((row) => matchesDepartment(scopedDepartment, row.department));
  const filteredSchoolDeliverables = schoolDeliverables.filter((row) => matchesDepartment(scopedDepartment, row.department));

  const watch = buildWatchSection(filteredWatchItems, filteredWatchEvents, window);
  const attendance = buildAttendanceSection(filteredAttendanceShifts, filteredAttendanceHistory, window);
  const production = await getOperationalProductionSection(client, auth, {
    department_type: toJobDepartmentType(scopedDepartment),
    anchorDate: input.anchorDate,
    periodLabel: window.periodLabel,
    buckets: window.buckets,
    startsAt: window.startsAt,
    endsBefore: window.endsBefore
  });
  const approvals = buildApprovalsSection(filteredApprovalRequests, filteredApprovalEvents, window);
  const schools = buildSchoolsSection(filteredSchoolWorkItems, filteredSchoolDeliverables, window);

  const summaryStrip: OperationalReportingSummaryCard[] = [
    {
      id: "watch_red",
      label: "Watch Red Breaches",
      value: String(watch.red_breaches),
      detail: watch.summary_line,
      tone: watch.red_breaches > 0 ? "action_needed" : "good",
      action_hash: watch.action_hash
    },
    {
      id: "attendance_on_time_rate",
      label: "Attendance On-Time Rate",
      value: formatPercent(attendance.on_time_rate),
      detail: `${attendance.staffing_incidents_driven_by_attendance} staffing incident${attendance.staffing_incidents_driven_by_attendance === 1 ? "" : "s"} in range`,
      tone: attendance.on_time_rate >= 90 ? "good" : attendance.on_time_rate >= 80 ? "heads_up" : "action_needed",
      action_hash: attendance.action_hash
    },
    {
      id: "production_overdue_tasks",
      label: "Production Overdue Tasks",
      value: String(production.overdue_tasks),
      detail: `${production.peer_review_backlog} peer review | ${production.qc_backlog} QC backlog`,
      tone: production.overdue_tasks > 0 ? "action_needed" : "neutral",
      action_hash: production.action_hash
    },
    {
      id: "approvals_overdue",
      label: "Approval Overdue Count",
      value: String(approvals.overdue_count),
      detail: `${approvals.escalation_count} escalated in ${window.periodLabel.toLowerCase()} window`,
      tone: approvals.overdue_count > 0 ? "action_needed" : approvals.escalation_count > 0 ? "heads_up" : "neutral",
      action_hash: approvals.action_hash
    },
    {
      id: "schools_overdue",
      label: "Schools Overdue Work",
      value: String(schools.overdue_count),
      detail: `${schools.blocked_count} blocked | ${schools.deliveries_ready_count} ready to deliver`,
      tone: schools.overdue_count > 0 ? "action_needed" : schools.blocked_count > 0 ? "heads_up" : "neutral",
      action_hash: schools.action_hash
    }
  ];

  return {
    generated_at: new Date().toISOString(),
    anchor_date: input.anchorDate,
    period: input.period,
    period_label: window.periodLabel,
    date_range: {
      starts_at: window.startsAt.toISOString(),
      ends_before: window.endsBefore.toISOString(),
      bucket_count: window.buckets.length
    },
    scope_department: scopedDepartment,
    summary_strip: summaryStrip,
    watch,
    attendance,
    production,
    approvals,
    schools,
    technical_debt: [
      "Watch history still depends on item timestamps for resolution timing instead of a dedicated breach-state event model.",
      "Production turnaround and backlog use a mix of current-state tables and historical review records; a reporting projection would scale better.",
      "Production department scoping still falls back to linked shoot or owner department because projects do not store a first-class department.",
      "Schools reporting still infers department ownership from the Schools workspace instead of a first-class department column on school work and deliverables."
    ],
    recommended_phase_2: [
      "Move these aggregates into a scheduled reporting projection once operational volume grows past direct transactional reporting.",
      "Persist first-class reason codes on watch and production events instead of inferring from snapshots and review outcomes.",
      "Reuse this exact contract for export packets and Phase 2 operational scorecards instead of rebuilding metrics per page.",
      "Persist a first-class school operations event stream for deliverables and waiting-state transitions instead of deriving patterns from current-state timestamps."
    ]
  };
}

function resolveScopedDepartment(auth: AuthUser, scopeLevel: "none" | "own" | "department" | "all", requestedDepartment: string | null) {
  if (scopeLevel === "department") {
    if (requestedDepartment && requestedDepartment !== auth.department) {
      throw new ApiError(403, "You can only report on your scoped department.");
    }
    return auth.department;
  }
  return requestedDepartment;
}

function matchesDepartment(expectedDepartment: string | null, value: string | null) {
  if (!expectedDepartment) {
    return true;
  }
  return value === expectedDepartment;
}

function loadWatchItems(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<WatchItemRow>(
      `
        SELECT
          item.id,
          item.watch_type,
          item.severity::text AS severity,
          item.status::text AS status,
          item.due_at::text,
          item.first_seen_at::text,
          item.resolved_at::text,
          item.scope_department,
          item.source_snapshot
        FROM urgent_watch_item item
        WHERE item.tenant_id = $1
          AND item.first_seen_at < $2::timestamptz
          AND COALESCE(item.resolved_at, $2::timestamptz) >= $3::timestamptz
      `,
      [tenantId, endsBefore.toISOString(), startsAt.toISOString()]
    )
    .then((result) => result.rows);
}

function loadWatchEvents(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<WatchEventRow>(
      `
        SELECT
          event.urgent_watch_item_id,
          event.event_type,
          event.metadata,
          event.created_at::text,
          item.scope_department,
          item.watch_type,
          item.source_snapshot
        FROM urgent_watch_event event
        JOIN urgent_watch_item item
          ON item.tenant_id = event.tenant_id
         AND item.id = event.urgent_watch_item_id
        WHERE event.tenant_id = $1
          AND event.created_at >= $2::timestamptz
          AND event.created_at < $3::timestamptz
      `,
      [tenantId, startsAt.toISOString(), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function loadAttendanceShifts(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<AttendanceShiftRow>(
      `
        SELECT
          ws.id AS shift_id,
          ws.starts_at::text,
          ws.department::text,
          runtime.current_state::text,
          COALESCE(runtime.coverage_impact, false) AS coverage_impact,
          COALESCE(runtime.critical_role_missing, false) AS critical_role_missing,
          COALESCE(runtime.understaffed_due_to_attendance, false) AS understaffed_due_to_attendance
        FROM work_shift ws
        LEFT JOIN shift_attendance_runtime runtime
          ON runtime.shift_id = ws.id
        WHERE ws.tenant_id = $1
          AND ws.starts_at >= $2::timestamptz
          AND ws.starts_at < $3::timestamptz
      `,
      [tenantId, startsAt.toISOString(), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function loadAttendanceHistory(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<AttendanceHistoryRow>(
      `
        SELECT
          history.shift_id,
          history.event_type,
          history.from_state::text,
          history.to_state::text,
          history.metadata,
          history.created_at::text,
          ws.department::text,
          ws.starts_at::text
        FROM shift_attendance_history history
        JOIN work_shift ws
          ON ws.id = history.shift_id
        WHERE history.tenant_id = $1
          AND ws.starts_at >= $2::timestamptz
          AND ws.starts_at < $3::timestamptz
        ORDER BY history.shift_id, history.created_at ASC
      `,
      [tenantId, startsAt.toISOString(), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function loadProductionProjects(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<ProductionProjectRow>(
      `
        SELECT
          project.id,
          project.created_at::text,
          project.completed_at::text,
          project.due_date::text,
          project.status::text,
          project.stage::text,
          project.job_type::text,
          COALESCE(shoot.department::text, owner.department::text) AS department
        FROM production_project project
        LEFT JOIN shoot shoot
          ON shoot.id = project.linked_shoot_id
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        WHERE project.tenant_id = $1
          AND project.created_at < $2::timestamptz
          AND COALESCE(project.completed_at, $2::timestamptz) >= $3::timestamptz
      `,
      [tenantId, endsBefore.toISOString(), startsAt.toISOString()]
    )
    .then((result) => result.rows);
}

function loadProductionTasks(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<ProductionTaskRow>(
      `
        SELECT
          task.id,
          task.project_id,
          task.task_type::text,
          task.status::text,
          task.due_date::text,
          task.created_at::text,
          task.completed_at::text,
          COALESCE(shoot.department::text, owner.department::text) AS department
        FROM production_project_task task
        JOIN production_project project
          ON project.tenant_id = task.tenant_id
         AND project.id = task.project_id
        LEFT JOIN shoot shoot
          ON shoot.id = project.linked_shoot_id
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        WHERE task.tenant_id = $1
          AND task.created_at < $2::timestamptz
          AND COALESCE(task.completed_at, $2::timestamptz) >= $3::timestamptz
      `,
      [tenantId, endsBefore.toISOString(), startsAt.toISOString()]
    )
    .then((result) => result.rows);
}

function loadProductionBlockers(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<ProductionBlockerRow>(
      `
        SELECT
          blocker.project_id,
          blocker.blocker_type::text,
          blocker.reason,
          blocker.resolved_at::text,
          blocker.created_at::text,
          COALESCE(shoot.department::text, owner.department::text) AS department
        FROM production_project_blocker blocker
        JOIN production_project project
          ON project.tenant_id = blocker.tenant_id
         AND project.id = blocker.project_id
        LEFT JOIN shoot shoot
          ON shoot.id = project.linked_shoot_id
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        WHERE blocker.tenant_id = $1
          AND blocker.created_at < $2::timestamptz
          AND COALESCE(blocker.resolved_at, $2::timestamptz) >= $3::timestamptz
      `,
      [tenantId, endsBefore.toISOString(), startsAt.toISOString()]
    )
    .then((result) => result.rows);
}

function loadProductionReviews(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<ProductionReviewRow>(
      `
        SELECT
          review.project_id,
          review.result::text,
          review.created_at::text,
          COALESCE(shoot.department::text, owner.department::text) AS department
        FROM production_project_review review
        JOIN production_project project
          ON project.tenant_id = review.tenant_id
         AND project.id = review.project_id
        LEFT JOIN shoot shoot
          ON shoot.id = project.linked_shoot_id
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        WHERE review.tenant_id = $1
          AND review.created_at >= $2::timestamptz
          AND review.created_at < $3::timestamptz
      `,
      [tenantId, startsAt.toISOString(), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function loadApprovalRequests(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<ApprovalRequestRow>(
      `
        SELECT
          request.id,
          request.request_type::text,
          request.status::text,
          request.requester_department,
          request.created_at::text,
          request.decided_at::text,
          request.sla_due_at::text,
          request.overdue_at::text
        FROM operational_approval_request request
        WHERE request.tenant_id = $1
          AND request.created_at < $2::timestamptz
          AND COALESCE(request.decided_at, $2::timestamptz) >= $3::timestamptz
      `,
      [tenantId, endsBefore.toISOString(), startsAt.toISOString()]
    )
    .then((result) => result.rows);
}

function loadApprovalEvents(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<ApprovalEventRow>(
      `
        SELECT
          event.approval_request_id,
          event.event_type,
          event.created_at::text,
          request.requester_department
        FROM operational_approval_event event
        JOIN operational_approval_request request
          ON request.tenant_id = event.tenant_id
         AND request.id = event.approval_request_id
        WHERE event.tenant_id = $1
          AND event.created_at >= $2::timestamptz
          AND event.created_at < $3::timestamptz
      `,
      [tenantId, startsAt.toISOString(), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function loadSchoolWorkItems(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<SchoolWorkItemRow>(
      `
        SELECT
          item.id::text,
          item.created_at,
          item.updated_at,
          item.completed_at,
          item.due_date::text AS due_date,
          item.status::text AS status,
          item.stage::text AS stage,
          item.waiting_on::text AS waiting_on,
          item.priority::text AS priority,
          'schools'::text AS department
        FROM school_work_item item
        WHERE item.tenant_id = $1
          AND item.created_at < $3
          AND (item.completed_at IS NULL OR item.completed_at >= $2)
      `,
      [tenantId, startsAt.toISOString(), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function loadSchoolDeliverables(client: PoolClient, tenantId: string, startsAt: Date, endsBefore: Date) {
  return client
    .query<SchoolDeliverableRow>(
      `
        SELECT
          deliverable.id::text,
          deliverable.created_at,
          deliverable.due_date::text AS due_date,
          deliverable.ready_date::text AS ready_date,
          deliverable.delivered_date::text AS delivered_date,
          deliverable.status::text AS status,
          deliverable.deliverable_type::text AS deliverable_type,
          'schools'::text AS department
        FROM school_deliverable deliverable
        WHERE deliverable.tenant_id = $1
          AND deliverable.created_at < $3
          AND (
            deliverable.delivered_date IS NULL
            OR deliverable.delivered_date >= $2::date
          )
      `,
      [tenantId, startsAt.toISOString().slice(0, 10), endsBefore.toISOString()]
    )
    .then((result) => result.rows);
}

function buildWatchSection(items: WatchItemRow[], events: WatchEventRow[], window: ReturnType<typeof buildReportingWindow>): OperationalWatchReportingSection {
  const anchorTime = window.endsBefore.getTime();
  const activeItems = items.filter((item) => item.status === "active");
  const overdueByType = groupCounts(
    activeItems.filter((item) => item.due_at && new Date(item.due_at).getTime() < anchorTime),
    (item) => item.watch_type
  )
    .map(([watchType, count]) => ({
      watch_type: watchType,
      label: humanizeLabel(watchType),
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const resolutionHours = items
    .filter((item) => item.resolved_at && isWithinRange(item.resolved_at, window.startsAt, window.endsBefore))
    .map((item) => hoursBetween(item.first_seen_at, item.resolved_at));
  const averageResolutionHours = average(resolutionHours);

  const breachEvents = events.filter((event) => {
    if (!["watch.generated", "watch.reopened", "watch.updated"].includes(event.event_type)) {
      return false;
    }
    const severity = getStringMetadata(event.metadata, "severity");
    return severity === "red";
  });

  const reasonCodeCounts = groupCounts(
    breachEvents,
    (event) => resolveReasonCode(event.metadata, event.source_snapshot, event.watch_type)
  )
    .map(([reasonCode, count]) => ({
      reason_code: reasonCode,
      label: humanizeLabel(reasonCode),
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 6);

  const trend = window.buckets.map((bucket): OperationalReportingTrendPoint => {
    const bucketBreachEvents = breachEvents.filter((event) => isWithinRange(event.created_at, bucket.startsAt, bucket.endsBefore));
    const bucketResolved = items
      .filter((item) => item.resolved_at && isWithinRange(item.resolved_at, bucket.startsAt, bucket.endsBefore))
      .map((item) => hoursBetween(item.first_seen_at, item.resolved_at));
    return {
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("red_breaches", "Red breaches", bucketBreachEvents.length),
        makeBucketMetric("resolved", "Resolved", bucketResolved.length),
        makeBucketMetric(
          "reason_codes",
          "Reason codes",
          uniqueCount(bucketBreachEvents.map((event) => resolveReasonCode(event.metadata, event.source_snapshot, event.watch_type)))
        )
      ]
    };
  });

  const redBreaches = activeItems.filter((item) => item.severity === "red").length;
  return {
    action_hash: "#operations/exceptions",
    summary_line:
      redBreaches > 0
        ? `${redBreaches} live exception${redBreaches === 1 ? "" : "s"} are blocking or overdue right now.`
        : "No blocking live exceptions are active in this reporting window.",
    red_breaches: redBreaches,
    overdue_count_by_type: overdueByType,
    average_resolution_hours: averageResolutionHours,
    average_resolution_label: formatDurationHours(averageResolutionHours),
    reason_code_trends: reasonCodeCounts,
    trend
  };
}

function buildAttendanceSection(
  shifts: AttendanceShiftRow[],
  historyRows: AttendanceHistoryRow[],
  window: ReturnType<typeof buildReportingWindow>
): OperationalAttendanceReportingSection {
  const historyByShift = groupBy(historyRows, (row) => row.shift_id);
  const trackedShifts = shifts.filter((shift) => shift.current_state !== "canceled");
  const summaries = trackedShifts.map((shift) => {
    const events = historyByShift.get(shift.shift_id) ?? [];
    return summarizeAttendanceShift(shift, events);
  });

  const denominator = trackedShifts.length;
  const onTimeCount = summaries.filter((summary) => summary.outcome === "on_time").length;
  const lateCount = summaries.filter((summary) => summary.outcome === "late").length;
  const noShowCount = summaries.filter((summary) => summary.outcome === "no_show").length;
  const calloutCount = summaries.filter((summary) => summary.outcome === "callout").length;
  const staffingIncidents = summaries.filter((summary) => summary.staffingIncident).length;
  const averageResolutionHours = average(
    summaries.map((summary) => summary.resolutionHours).filter((value): value is number => value !== null)
  );

  const trend = window.buckets.map((bucket): OperationalReportingTrendPoint => {
    const bucketSummaries = summaries.filter((summary) => isWithinRange(summary.startsAt, bucket.startsAt, bucket.endsBefore));
    const bucketCount = bucketSummaries.length;
    return {
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("on_time_rate", "On-time rate", Math.round(rate(bucketSummaries.filter((item) => item.outcome === "on_time").length, bucketCount))),
        makeBucketMetric("late_rate", "Late rate", Math.round(rate(bucketSummaries.filter((item) => item.outcome === "late").length, bucketCount))),
        makeBucketMetric("no_show_rate", "No-show rate", Math.round(rate(bucketSummaries.filter((item) => item.outcome === "no_show").length, bucketCount))),
        makeBucketMetric("staffing_incidents", "Staffing incidents", bucketSummaries.filter((item) => item.staffingIncident).length)
      ]
    };
  });

  return {
    action_hash: "#operations/attendance",
    summary_line:
      denominator === 0
        ? "No attendance-tracked assignments landed in this reporting window."
        : `${staffingIncidents} attendance-driven staffing incident${staffingIncidents === 1 ? "" : "s"} came out of ${denominator} tracked assignment${denominator === 1 ? "" : "s"}.`,
    tracked_assignments: denominator,
    on_time_rate: rate(onTimeCount, denominator),
    late_rate: rate(lateCount, denominator),
    no_show_rate: rate(noShowCount, denominator),
    callout_rate: rate(calloutCount, denominator),
    average_resolution_hours: averageResolutionHours,
    average_resolution_label: formatDurationHours(averageResolutionHours),
    staffing_incidents_driven_by_attendance: staffingIncidents,
    trend
  };
}

function buildProductionSection(
  projects: ProductionProjectRow[],
  tasks: ProductionTaskRow[],
  blockers: ProductionBlockerRow[],
  reviews: ProductionReviewRow[],
  window: ReturnType<typeof buildReportingWindow>
): OperationalProductionReportingSection {
  const anchorDate = window.anchorDate;
  const completedProjects = projects.filter((project) => project.completed_at && isWithinRange(project.completed_at, window.startsAt, window.endsBefore));
  const turnaroundHours = completedProjects.map((project) => hoursBetween(project.created_at, project.completed_at));
  const overdueTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status) && task.due_date !== null && task.due_date < anchorDate).length;
  const blockedReasons = groupCounts(
    blockers.filter((blocker) => blocker.resolved_at === null),
    (blocker) => blocker.blocker_type
  )
    .map(([blockerType, count]) => ({
      blocker_type: blockerType,
      label: humanizeLabel(blockerType),
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 6);
  const peerReviewBacklog = tasks.filter((task) => task.task_type === "peer_review" && task.status !== "done").length;
  const qcBacklog = tasks.filter((task) => task.task_type === "final_qc" && task.status !== "done").length;
  const createdProjectsCount = projects.filter((project) => isWithinRange(project.created_at, window.startsAt, window.endsBefore)).length;
  const correctionReworkCreated = projects.filter(
    (project) => project.job_type === "correction_rework" && isWithinRange(project.created_at, window.startsAt, window.endsBefore)
  ).length;
  const sendBackCount = reviews.filter((review) => review.result === "correction_needed").length;
  const averageTurnaroundHours = average(turnaroundHours);

  const trend = window.buckets.map((bucket): OperationalReportingTrendPoint => {
    const completed = completedProjects.filter((project) => project.completed_at && isWithinRange(project.completed_at, bucket.startsAt, bucket.endsBefore));
    const overdue = tasks.filter(
      (task) =>
        ACTIVE_TASK_STATUSES.has(task.status) &&
        task.due_date !== null &&
        task.due_date >= bucket.startsAt.toISOString().slice(0, 10) &&
        task.due_date < bucket.endsBefore.toISOString().slice(0, 10)
    ).length;
    const bucketReviews = reviews.filter((review) => isWithinRange(review.created_at, bucket.startsAt, bucket.endsBefore));
    return {
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("jobs_completed", "Jobs completed", completed.length),
        makeBucketMetric("overdue_tasks", "Overdue tasks", overdue),
        makeBucketMetric("send_backs", "Send-backs", bucketReviews.filter((review) => review.result === "correction_needed").length),
        makeBucketMetric("blocked_reviews", "Blocked reviews", bucketReviews.filter((review) => review.result === "blocked").length)
      ]
    };
  });

  return {
    action_hash: "#production",
    summary_line:
      completedProjects.length > 0
        ? `${completedProjects.length} production job${completedProjects.length === 1 ? "" : "s"} completed in this ${window.periodLabel.toLowerCase()} window.`
        : "No production jobs completed in this reporting window yet.",
    jobs_completed: completedProjects.length,
    average_turnaround_hours: averageTurnaroundHours,
    average_turnaround_label: formatDurationHours(averageTurnaroundHours),
    overdue_tasks: overdueTasks,
    blocked_reasons: blockedReasons,
    peer_review_backlog: peerReviewBacklog,
    qc_backlog: qcBacklog,
    rework_rate: rate(correctionReworkCreated, createdProjectsCount),
    send_back_rate: rate(sendBackCount, Math.max(reviews.length, 1)),
    trend
  };
}

function buildApprovalsSection(
  requests: ApprovalRequestRow[],
  events: ApprovalEventRow[],
  window: ReturnType<typeof buildReportingWindow>
): OperationalApprovalsReportingSection {
  const createdInRange = requests.filter((request) => isWithinRange(request.created_at, window.startsAt, window.endsBefore));
  const decidedInRange = requests.filter((request) => request.decided_at && isWithinRange(request.decided_at, window.startsAt, window.endsBefore));
  const volumeByType = groupCounts(createdInRange, (request) => request.request_type)
    .map(([requestType, count]) => ({
      request_type: requestType,
      label: humanizeLabel(requestType),
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const averageDecisionHours = average(
    decidedInRange
      .filter((request) => request.decided_at)
      .map((request) => hoursBetween(request.created_at, request.decided_at))
  );
  const overdueCount = requests.filter((request) => isApprovalOverdue(request, window.endsBefore)).length;
  const escalationCount = events.filter((event) => event.event_type === "approval.escalated").length;
  const rejectionRate = rate(
    decidedInRange.filter((request) => request.status === "rejected").length,
    decidedInRange.length
  );
  const sentBackRequestIds = new Set(events.filter((event) => event.event_type === "approval.sent_back").map((event) => event.approval_request_id));

  const trend = window.buckets.map((bucket): OperationalReportingTrendPoint => {
    const bucketCreated = createdInRange.filter((request) => isWithinRange(request.created_at, bucket.startsAt, bucket.endsBefore));
    const bucketDecided = decidedInRange.filter((request) => request.decided_at && isWithinRange(request.decided_at, bucket.startsAt, bucket.endsBefore));
    const bucketEvents = events.filter((event) => isWithinRange(event.created_at, bucket.startsAt, bucket.endsBefore));
    return {
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric("volume", "Volume", bucketCreated.length),
        makeBucketMetric("overdue", "Overdue", bucketCreated.filter((request) => isApprovalOverdue(request, bucket.endsBefore)).length),
        makeBucketMetric("escalated", "Escalated", bucketEvents.filter((event) => event.event_type === "approval.escalated").length),
        makeBucketMetric("rejected", "Rejected", bucketDecided.filter((request) => request.status === "rejected").length)
      ]
    };
  });

  return {
    action_hash: "#approvals",
    summary_line:
      createdInRange.length > 0
        ? `${createdInRange.length} approval request${createdInRange.length === 1 ? "" : "s"} were created in this ${window.periodLabel.toLowerCase()} window.`
        : "No approval requests were created in this reporting window yet.",
    volume_by_type: volumeByType,
    average_decision_hours: averageDecisionHours,
    average_decision_label: formatDurationHours(averageDecisionHours),
    overdue_count: overdueCount,
    escalation_count: escalationCount,
    rejection_rate: rejectionRate,
    send_back_rate: rate(sentBackRequestIds.size, Math.max(createdInRange.length, 1)),
    trend
  };
}

function buildSchoolsSection(
  workItems: SchoolWorkItemRow[],
  deliverables: SchoolDeliverableRow[],
  window: ReturnType<typeof buildReportingWindow>
): OperationalSchoolsReportingSection {
  const activeWorkItems = workItems.filter((item) => item.status !== "completed" && item.status !== "cancelled");
  const overdueCount = activeWorkItems.filter((item) => item.due_date && item.due_date < window.anchorDate).length;
  const dueTodayCount = activeWorkItems.filter((item) => item.due_date === window.anchorDate).length;
  const blockedCount = activeWorkItems.filter((item) => item.status === "blocked" || Boolean(item.stage === "waiting_on_internal" && item.priority === "critical")).length;
  const waitingOnSchoolCount = activeWorkItems.filter((item) => item.waiting_on === "school").length;
  const waitingOnInternalCount = activeWorkItems.filter((item) => item.waiting_on === "internal_production" || item.waiting_on === "internal_ops").length;
  const deliveriesReadyCount = deliverables.filter((item) => item.status === "ready").length;
  const averageResolutionHours = average(
    workItems
      .filter((item) => item.completed_at && isWithinRange(item.completed_at, window.startsAt, window.endsBefore))
      .map((item) => hoursBetween(item.created_at, item.completed_at))
      .filter((value) => value > 0)
  );
  const trend = window.buckets.map((bucket): OperationalReportingTrendPoint => {
    const bucketOpen = activeWorkItems.filter((item) => item.created_at < bucket.endsBefore.toISOString());
    return {
      bucket: stripBucketInternals(bucket),
      metrics: [
        makeBucketMetric(
          "overdue",
          "Overdue",
          bucketOpen.filter((item) => item.due_date && item.due_date < bucket.endsBefore.toISOString().slice(0, 10)).length
        ),
        makeBucketMetric(
          "blocked",
          "Blocked",
          bucketOpen.filter((item) => item.status === "blocked").length
        ),
        makeBucketMetric(
          "waiting_on_school",
          "Waiting on school",
          bucketOpen.filter((item) => item.waiting_on === "school").length
        ),
        makeBucketMetric(
          "deliveries_ready",
          "Deliveries ready",
          deliverables.filter(
            (item) =>
              item.status === "ready" &&
              ((item.ready_date && item.ready_date >= bucket.startsAt.toISOString().slice(0, 10) && item.ready_date < bucket.endsBefore.toISOString().slice(0, 10)) ||
                (!item.ready_date && isWithinRange(item.created_at, bucket.startsAt, bucket.endsBefore)))
          ).length
        )
      ]
    };
  });

  return {
    action_hash: "#schools",
    summary_line:
      overdueCount > 0 || blockedCount > 0
        ? `${overdueCount} overdue and ${blockedCount} blocked school work item${overdueCount + blockedCount === 1 ? "" : "s"} need operational follow-through.`
        : activeWorkItems.length
          ? `${waitingOnSchoolCount} waiting on school and ${deliveriesReadyCount} deliverable${deliveriesReadyCount === 1 ? "" : "s"} are ready to move.`
          : "No active school-work risk is open in this reporting window.",
    open_work_count: activeWorkItems.length,
    overdue_count: overdueCount,
    due_today_count: dueTodayCount,
    blocked_count: blockedCount,
    waiting_on_school_count: waitingOnSchoolCount,
    waiting_on_internal_count: waitingOnInternalCount,
    deliveries_ready_count: deliveriesReadyCount,
    average_resolution_hours: averageResolutionHours,
    average_resolution_label: formatDurationHours(averageResolutionHours),
    trend
  };
}

function summarizeAttendanceShift(shift: AttendanceShiftRow, events: AttendanceHistoryRow[]) {
  const currentState = String(shift.current_state ?? "scheduled");
  const toStates = events.map((event) => String(event.to_state ?? ""));
  const hadNoShow = currentState === "no_show" || toStates.includes("no_show");
  const hadCallout = ["called_out", "replacement_needed"].includes(currentState) || toStates.some((state) => ["called_out", "replacement_needed"].includes(state));
  const hadLate = ["late", "late_acknowledged", "unresolved_no_check_in"].includes(currentState) || toStates.some((state) => ["late", "late_acknowledged", "unresolved_no_check_in"].includes(state));
  const hadOnTimeSignal =
    ["checked_in", "on_time", "completed"].includes(currentState) || toStates.some((state) => ["checked_in", "on_time", "completed"].includes(state));

  let outcome: AttendanceOutcome = "other";
  if (hadNoShow) {
    outcome = "no_show";
  } else if (hadCallout) {
    outcome = "callout";
  } else if (hadLate) {
    outcome = "late";
  } else if (hadOnTimeSignal) {
    outcome = "on_time";
  }

  const issueStart = events.find((event) => ISSUE_ATTENDANCE_STATES.has(String(event.to_state ?? "")))?.created_at ?? null;
  const resolvedAt =
    issueStart == null
      ? null
      : events.find((event) => new Date(event.created_at).getTime() >= new Date(issueStart).getTime() && RESOLVED_ATTENDANCE_STATES.has(String(event.to_state ?? "")))?.created_at ??
        (RESOLVED_ATTENDANCE_STATES.has(currentState) ? shift.starts_at : null);

  const staffingIncident =
    shift.coverage_impact ||
    shift.critical_role_missing ||
    shift.understaffed_due_to_attendance ||
    events.some(
      (event) =>
        event.event_type === "staffing_impact_changed" &&
        Boolean(event.metadata?.coverage_impact || event.metadata?.critical_role_missing || event.metadata?.understaffed_due_to_attendance)
    );

  return {
    shiftId: shift.shift_id,
    startsAt: shift.starts_at,
    outcome,
    staffingIncident,
    resolutionHours: issueStart && resolvedAt ? hoursBetween(issueStart, resolvedAt) : null
  };
}

function isApprovalOverdue(request: ApprovalRequestRow, compareDate: Date) {
  if (["approved", "rejected", "canceled"].includes(request.status)) {
    return false;
  }
  if (request.overdue_at) {
    return true;
  }
  return Boolean(request.sla_due_at && new Date(request.sla_due_at).getTime() < compareDate.getTime());
}

function buildReportingWindow(anchorDate: string, period: OperationalReportingPeriod) {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  const endsBefore = new Date(anchor.getTime());
  endsBefore.setDate(endsBefore.getDate() + 1);

  if (period === "monthly") {
    const startsAt = new Date(endsBefore.getTime());
    startsAt.setDate(startsAt.getDate() - 28);
    const buckets = Array.from({ length: 4 }, (_, index) => {
      const bucketStart = new Date(startsAt.getTime());
      bucketStart.setDate(bucketStart.getDate() + index * 7);
      const bucketEnd = index === 3 ? endsBefore : new Date(bucketStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      return makeBucket(
        `week_${index + 1}`,
        `${formatMonthDay(bucketStart)}-${formatMonthDay(new Date(bucketEnd.getTime() - 24 * 60 * 60 * 1000))}`,
        bucketStart,
        bucketEnd
      );
    });
    return {
      anchorDate,
      periodLabel: "Monthly",
      startsAt,
      endsBefore,
      buckets
    };
  }

  const monthCount = period === "quarterly" ? 3 : 12;
  const periodLabel = period === "quarterly" ? "Quarterly" : "Annual";
  const currentMonthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startsAt = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - (monthCount - 1), 1);
  const buckets: ReportBucket[] = [];
  for (let index = 0; index < monthCount; index += 1) {
    const bucketStart = new Date(startsAt.getFullYear(), startsAt.getMonth() + index, 1);
    const bucketEnd = index === monthCount - 1 ? endsBefore : new Date(startsAt.getFullYear(), startsAt.getMonth() + index + 1, 1);
    buckets.push(makeBucket(`month_${index + 1}`, formatMonthLabel(bucketStart), bucketStart, bucketEnd));
  }

  return {
    anchorDate,
    periodLabel,
    startsAt,
    endsBefore,
    buckets
  };
}

function makeBucket(key: string, label: string, startsAt: Date, endsBefore: Date): ReportBucket {
  return {
    key,
    label,
    starts_at: startsAt.toISOString(),
    ends_before: endsBefore.toISOString(),
    startsAt,
    endsBefore
  };
}

function stripBucketInternals(bucket: ReportBucket): OperationalReportingBucket {
  return {
    key: bucket.key,
    label: bucket.label,
    starts_at: bucket.starts_at,
    ends_before: bucket.ends_before
  };
}

function makeBucketMetric(key: string, label: string, value: number): OperationalReportingBucketMetric {
  return { key, label, value };
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function groupCounts<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()];
}

function uniqueCount(values: string[]) {
  return new Set(values).size;
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(1));
}

function rate(count: number, total: number) {
  if (!total) {
    return 0;
  }
  return Number(((count / total) * 100).toFixed(1));
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function hoursBetween(startsAt: string, endsAt: string | null) {
  if (!endsAt) {
    return 0;
  }
  return Number(((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 36e5).toFixed(1));
}

function formatDurationHours(value: number | null) {
  if (value == null) {
    return "No resolved history yet";
  }
  return `${value.toFixed(1)}h average`;
}

function isWithinRange(value: string, startsAt: Date, endsBefore: Date) {
  const time = new Date(value).getTime();
  return time >= startsAt.getTime() && time < endsBefore.getTime();
}

function getStringMetadata(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function resolveReasonCode(metadata: Record<string, unknown> | null | undefined, snapshot: Record<string, unknown> | null | undefined, fallback: string) {
  return (
    getStringMetadata(metadata, "reason_code") ??
    getStringMetadata(snapshot, "reason_code") ??
    getStringMetadata(snapshot, "blocked_reason") ??
    getStringMetadata(snapshot, "state") ??
    fallback
  );
}

function formatMonthLabel(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatMonthDay(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function humanizeLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
