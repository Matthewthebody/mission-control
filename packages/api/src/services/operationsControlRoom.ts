import type { PoolClient } from "pg";
import { loadLiveShootQueue } from "../application/shoots/load-live-shoot-queue.action.js";
import type { LiveShootQueueEntry, LiveShootQueueProjection } from "../domain/lifecycle/live-shoot-queue-projection.js";
import type { AuthUser } from "../types/auth.js";
import type { OperationalApprovalWorkspace } from "../types/operationalApprovals.js";
import type { UrgentWatchListItem, UrgentWatchWorkspace } from "../types/urgentWatch.js";
import type { WorkflowHistoryRecord } from "../types/workflowDomain.js";
import type { AttendanceOperationsItemRecord, AttendanceOperationsWorkspaceRecord } from "./attendanceOperations.js";
import { getAttendanceOperationsWorkspace } from "./attendanceOperations.js";
import { listOperationalApprovalWorkspace } from "./operationalApprovals.js";
import { getOperatingSystemScope } from "./operatingSystemAccess.js";
import { getProductionProjectHomeSnapshot } from "./productionProjects.js";
import { getStaffingDashboardOverview } from "./scheduleStaffing.js";
import { getUrgentWatchWorkspace } from "./urgentWatch.js";
import { listWorkflowHistory } from "./workflowDomain.js";
import { getLocalDateString } from "../utils/localDate.js";

type StaffingDashboardResponse = Awaited<ReturnType<typeof getStaffingDashboardOverview>>;
type ProductionProjectHomeSnapshotResponse = Awaited<ReturnType<typeof getProductionProjectHomeSnapshot>>;

type OperationsControlRoomTone = "neutral" | "info" | "success" | "warning" | "critical";

type OperationsControlRoomChip = {
  label: string;
  tone?: OperationsControlRoomTone;
};

type OperationsControlRoomMetric = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: OperationsControlRoomTone;
  action_hash: string;
};

type OperationsControlRoomItem = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  owner_label: string;
  status_label: string;
  tone: OperationsControlRoomTone;
  meta: OperationsControlRoomChip[];
  flags: OperationsControlRoomChip[];
  next_action: string;
  action_hash: string;
};

type OperationsControlRoomReadySignal = {
  id: string;
  shoot_code: string;
  title: string;
  status_label: string;
  tone: OperationsControlRoomTone;
  detail: string;
  confirmed_at: string | null;
  confirmed_by_label: string | null;
  action_hash: string;
};

type OperationsControlRoomRouteCard = {
  id: string;
  title: string;
  count: number | null;
  summary: string;
  tone: OperationsControlRoomTone;
  action_hash: string;
};

type OperationsControlRoomActivityItem = {
  id: string;
  module_label: string;
  summary: string;
  actor_label: string;
  created_at: string;
  action_hash: string;
};

export type OperationsControlRoomResponse = {
  generated_at: string;
  anchor_date: string;
  refresh_interval_seconds: number;
  summary_band: OperationsControlRoomMetric[];
  urgent_watch: {
    generated_at: string;
    headline: string;
    summary_line: string;
    action_hash: string;
    items: OperationsControlRoomItem[];
  };
  staffing_pressure: {
    generated_at: string | null;
    headline: string;
    summary_line: string;
    action_hash: string;
    metrics: OperationsControlRoomMetric[];
    items: OperationsControlRoomItem[];
  };
  attendance_impact: {
    generated_at: string | null;
    headline: string;
    summary_line: string;
    action_hash: string;
    metrics: OperationsControlRoomMetric[];
    items: OperationsControlRoomItem[];
  };
  live_execution: {
    generated_at: string | null;
    headline: string;
    summary_line: string;
    routes: OperationsControlRoomRouteCard[];
    ready_signals: OperationsControlRoomReadySignal[];
    items: OperationsControlRoomItem[];
  };
  recent_activity: {
    generated_at: string;
    headline: string;
    summary_line: string;
    items: OperationsControlRoomActivityItem[];
  };
};

type OperationsSummaryBandInput = {
  urgentWatch: UrgentWatchWorkspace;
  staffing: StaffingDashboardResponse;
  attendance: AttendanceOperationsWorkspaceRecord;
  liveQueue: LiveShootQueueProjection;
  production: ProductionProjectHomeSnapshotResponse | null;
  approvals: OperationalApprovalWorkspace | null;
};

export async function getOperationsControlRoom(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
): Promise<OperationsControlRoomResponse> {
  const anchorDate = options.date?.trim() || getLocalDateString();
  const generatedAt = new Date().toISOString();
  const canViewApprovals = getOperatingSystemScope(auth, "approvals") !== "none";
  const canViewProduction = getOperatingSystemScope(auth, "production") !== "none";

  const [urgentWatch, staffing, attendance, liveQueue, production, approvals, history] = await Promise.all([
    getUrgentWatchWorkspace(client, auth, { date: anchorDate }),
    getStaffingDashboardOverview(client, auth, anchorDate),
    getAttendanceOperationsWorkspace(client, auth, { date: anchorDate }),
    loadLiveShootQueue(client, { date: anchorDate }, auth),
    canViewProduction ? getProductionProjectHomeSnapshot(client, auth, { anchorDate }) : Promise.resolve(null),
    canViewApprovals ? listOperationalApprovalWorkspace(client, auth) : Promise.resolve(null),
    listWorkflowHistory(client, auth.tenantId, { limit: 20 })
  ]);

  return {
    generated_at: generatedAt,
    anchor_date: anchorDate,
    refresh_interval_seconds: 60,
    summary_band: buildOperationsControlRoomSummaryBand({
      urgentWatch,
      staffing,
      attendance,
      liveQueue,
      production,
      approvals
    }),
    urgent_watch: {
      generated_at: urgentWatch.generated_at,
      headline: "Exceptions",
      summary_line: urgentWatch.home_ready_summary.summary_line,
      action_hash: "#operations/exceptions",
      items: urgentWatch.items.filter((item) => item.status === "active").slice(0, 6).map(mapUrgentWatchItem)
    },
    staffing_pressure: buildStaffingPressureSection(anchorDate, staffing, urgentWatch),
    attendance_impact: buildAttendanceImpactSection(attendance),
    live_execution: buildLiveExecutionSection(anchorDate, liveQueue, approvals, urgentWatch, production),
    recent_activity: {
      generated_at: generatedAt,
      headline: "Recent Operational Updates",
      summary_line: "Recent changes across exceptions, staffing, attendance, and approvals so the landing page feels current without pretending to own every queue.",
      items: buildOperationsRecentActivity(history)
    }
  };
}

export function buildOperationsControlRoomSummaryBand(
  input: OperationsSummaryBandInput
): OperationsControlRoomMetric[] {
  const unconfirmedShootCount = countActiveWatchItemsByType(input.urgentWatch.items, "unconfirmed_shoot");
  const missingContactCount = countActiveWatchItemsByType(input.urgentWatch.items, "missing_contact_info");
  const productionIntakeIssueCount = countActiveWatchItemsByType(input.urgentWatch.items, "production_intake_issue");
  const attendanceRiskCount =
    input.attendance.summary.late_count +
    input.attendance.summary.unresolved_count +
    input.attendance.summary.replacement_needed_count +
    input.attendance.summary.no_show_count;
  const liveShootPressureCount =
    input.liveQueue.summary.needs_staffing + input.liveQueue.summary.needs_review + input.liveQueue.summary.unscheduled;
  const unresolvedExceptionCount = input.approvals
    ? input.approvals.summary.pending_blocking +
      input.approvals.summary.needs_clarification +
      input.approvals.summary.overdue
    : 0;
  const productionRiskCount = input.production ? Number(input.production.counts.attention_needed ?? 0) + productionIntakeIssueCount : 0;

  return [
    {
      id: "active_red_watch",
      label: "Blocking",
      count: input.urgentWatch.summary.red_count,
      detail: input.urgentWatch.summary.red_count
        ? "Unsafe live work needs action now."
        : "No blocking exceptions are active right now.",
      tone: input.urgentWatch.summary.red_count ? "critical" : "success",
      action_hash: "#operations/exceptions"
    },
    {
      id: "yellow_watch",
      label: "At Risk",
      count: input.urgentWatch.summary.yellow_count,
      detail: input.urgentWatch.summary.yellow_count
        ? "Work is trending the wrong way before it becomes blocking."
        : "No at-risk exceptions are bubbling up right now.",
      tone: input.urgentWatch.summary.yellow_count ? "warning" : "success",
      action_hash: "#operations/exceptions"
    },
    {
      id: "staffing_gaps",
      label: "Staffing Gaps",
      count: input.staffing.summary.open_staffing_slots,
      detail:
        input.staffing.summary.shoots_missing_lead || unconfirmedShootCount || missingContactCount
          ? `${input.staffing.summary.shoots_missing_lead} missing lead, ${unconfirmedShootCount} unconfirmed, ${missingContactCount} contact risk.`
          : "No live staffing blockers are standing out right now.",
      tone:
        input.staffing.summary.shoots_missing_lead > 0
          ? "critical"
          : input.staffing.summary.open_staffing_slots > 0
            ? "warning"
            : "success",
      action_hash: "#operations/staffing?area=staffing"
    },
    {
      id: "attendance_risk",
      label: "Attendance Risk",
      count: attendanceRiskCount,
      detail:
        input.attendance.summary.coverage_impact_count > 0
          ? `${input.attendance.summary.coverage_impact_count} shifts are already hurting coverage.`
          : "No coverage-impact attendance issues are active right now.",
      tone:
        input.attendance.summary.coverage_impact_count > 0
          ? "critical"
          : attendanceRiskCount > 0
            ? "warning"
            : "success",
      action_hash: "#operations/attendance"
    },
    {
      id: "live_shoot_pressure",
      label: "Live Shoot Pressure",
      count: liveShootPressureCount,
      detail: liveShootPressureCount
        ? `${input.liveQueue.summary.needs_staffing} need staffing, ${input.liveQueue.summary.needs_review} need review, ${input.liveQueue.summary.unscheduled} are still incomplete.`
        : "Shoots in view look operationally stable right now.",
      tone: liveShootPressureCount ? "warning" : "success",
      action_hash: "#operations/shoots"
    },
    ...(input.production
      ? [
          {
            id: "production_risk",
            label: "Production Risk",
            count: productionRiskCount,
            detail:
              productionRiskCount > 0
                ? productionIntakeIssueCount > 0
                  ? `${input.production.summary_line} ${productionIntakeIssueCount} intake issue${productionIntakeIssueCount === 1 ? "" : "s"} are also surfacing in exceptions.`
                  : input.production.summary_line
                : "No overdue, blocked, stale, or release-gated production work is surfacing outside the department.",
            tone: mapProductionHomeToneToOperationsTone(input.production.tone, productionIntakeIssueCount),
            action_hash: "#production"
          }
        ]
      : []),
    {
      id: "unresolved_exceptions",
      label: "Unresolved Exceptions",
      count: unresolvedExceptionCount,
      detail: unresolvedExceptionCount
        ? "Blocking or overdue exception and approval work still needs a decision."
        : "No blocking exception queue is standing out right now.",
      tone: unresolvedExceptionCount ? "warning" : "success",
      action_hash: "#operations/exceptions?area=exceptions"
    }
  ];
}

export function buildOperationsRecentActivity(history: WorkflowHistoryRecord[]): OperationsControlRoomActivityItem[] {
  return history
    .filter((item) => item.module !== "production")
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      module_label: moduleLabelForHistory(item.module),
      summary: item.summary,
      actor_label: item.actor_name ?? "System",
      created_at: item.created_at,
      action_hash: actionHashForHistory(item.module)
    }));
}

function buildStaffingPressureSection(
  anchorDate: string,
  staffing: StaffingDashboardResponse,
  urgentWatch: UrgentWatchWorkspace
): OperationsControlRoomResponse["staffing_pressure"] {
  const unconfirmedShootCount = countActiveWatchItemsByType(urgentWatch.items, "unconfirmed_shoot");
  const missingContactCount = countActiveWatchItemsByType(urgentWatch.items, "missing_contact_info");
  const criticalRoleGapCount = countActiveWatchItemsByType(urgentWatch.items, "critical_role_gap");

  const summaryLine = staffing.summary.open_staffing_slots
    ? `${staffing.summary.open_staffing_slots} open slot${staffing.summary.open_staffing_slots === 1 ? "" : "s"}, ${staffing.summary.shoots_missing_lead} missing lead, ${unconfirmedShootCount} unconfirmed shoot${unconfirmedShootCount === 1 ? "" : "s"}.`
    : "Coverage looks stable. Use Scheduling for full assignment control and publication.";

  return {
    generated_at: (staffing as { generated_at?: string }).generated_at ?? null,
    headline: "Staffing / Schedule Pressure",
    summary_line: summaryLine,
    action_hash: "#operations/staffing?area=staffing",
    metrics: [
      {
        id: "critical_role_gaps",
        label: "Critical Role Gaps",
        count: criticalRoleGapCount || staffing.summary.shoots_missing_lead,
        detail: "Lead-qualified or critical-role coverage is still open.",
        tone: criticalRoleGapCount || staffing.summary.shoots_missing_lead ? "critical" : "success",
        action_hash: "#operations/staffing?area=staffing"
      },
      {
        id: "understaffed_shoots",
        label: "Understaffed",
        count: staffing.summary.understaffed_shoots,
        detail: "Shoots are below minimum planned coverage.",
        tone: staffing.summary.understaffed_shoots ? "warning" : "success",
        action_hash: "#operations/staffing?area=staffing"
      },
      {
        id: "unconfirmed_shoots",
        label: "Unconfirmed Labor",
        count: unconfirmedShootCount,
        detail: "Draft or unpublished labor still affects execution safety.",
        tone: unconfirmedShootCount ? "warning" : "success",
        action_hash: "#operations/staffing?area=staffing"
      },
      {
        id: "missing_contact_info",
        label: "Missing Contact",
        count: missingContactCount,
        detail: "Primary contact info is incomplete where it affects execution.",
        tone: missingContactCount ? "warning" : "success",
        action_hash: "#operations/staffing?area=staffing"
      }
    ],
    items: staffing.open_coverage.slice(0, 5).map<OperationsControlRoomItem>((item) => ({
      id: item.shoot_id,
      eyebrow: `${item.department} | ${item.shoot_date}`,
      title: item.title,
      summary: `${item.time_label} | ${item.location_label}`,
      owner_label: item.lead_name ?? "Lead still open",
      status_label: item.missing_lead ? "Missing lead" : `${item.assigned_staff_count}/${item.planned_staff_count} assigned`,
      tone: item.missing_lead ? "critical" : item.under_staffed || item.conflict_warning_count ? "warning" : "success",
      meta: [
        { label: item.priority_label_display, tone: item.priority_label === "critical_shoot" ? "critical" : "info" },
        { label: item.lead_present ? "Lead present" : "Lead missing", tone: item.lead_present ? "success" : "critical" }
      ],
      flags: [
        ...(item.conflict_warning_count > 0
          ? [{ label: `${item.conflict_warning_count} conflict${item.conflict_warning_count === 1 ? "" : "s"}`, tone: "warning" as const }]
          : []),
        ...(item.sync_state && item.sync_state !== "synced"
          ? [{ label: humanizeValue(item.sync_state), tone: item.sync_state === "sync_failed" ? "critical" as const : "warning" as const }]
          : [])
      ],
      next_action: item.next_action,
      action_hash: buildOperationsStaffingHash(anchorDate, item.shoot_id)
    }))
  };
}

function buildAttendanceImpactSection(
  attendance: AttendanceOperationsWorkspaceRecord
): OperationsControlRoomResponse["attendance_impact"] {
  const items = attendance.sections
    .flatMap((section) => section.items)
    .sort(compareAttendanceItems)
    .slice(0, 5)
    .map<OperationsControlRoomItem>((item) => ({
      id: item.shift_id,
      eyebrow: item.school_name ?? item.department,
      title: `${item.employee_name} - ${item.shift_title}`,
      summary: `${buildShiftWindow(item.starts_at, item.ends_at)} | ${item.location_name ?? "Location pending"}`,
      owner_label: item.manager_name ?? "Manager pending",
      status_label: item.state_label,
      tone: toneForAttendanceItem(item),
      meta: [
        { label: item.shoot_code ?? "Assignment", tone: "info" as const },
        ...(item.coverage_impact ? [{ label: "Coverage risk", tone: "critical" as const }] : []),
        ...(item.critical_role_missing ? [{ label: "Critical role", tone: "critical" as const }] : [])
      ],
      flags: item.alert_labels.slice(0, 2).map((label) => ({ label, tone: "warning" as const })),
      next_action: item.coverage_impact ? "Open Scheduling" : "Open attendance detail",
      action_hash: item.coverage_impact ? item.scheduling_hash ?? "#operations/attendance" : "#operations/attendance"
    }));

  return {
    generated_at: attendance.generated_at,
    headline: "Attendance Impact",
    summary_line: attendance.home_ready_summary.summary_line,
    action_hash: "#operations/attendance",
    metrics: [
      {
        id: "late_unresolved",
        label: "Late / Unresolved",
        count: attendance.summary.late_count + attendance.summary.unresolved_count,
        detail: "Late arrivals and unresolved no-check-in states still need action.",
        tone: attendance.summary.unresolved_count ? "critical" : attendance.summary.late_count ? "warning" : "success",
        action_hash: "#operations/attendance"
      },
      {
        id: "replacement_needed",
        label: "Replacement Needed",
        count: attendance.summary.replacement_needed_count,
        detail: "Someone called out or went missing and coverage still needs a backfill.",
        tone: attendance.summary.replacement_needed_count ? "critical" : "success",
        action_hash: "#operations/attendance"
      },
      {
        id: "callouts",
        label: "Callouts / No-Shows",
        count: attendance.summary.called_out_count + attendance.summary.no_show_count,
        detail: "Callouts and confirmed no-shows affecting same-day execution.",
        tone: attendance.summary.no_show_count ? "critical" : attendance.summary.called_out_count ? "warning" : "success",
        action_hash: "#operations/attendance"
      },
      {
        id: "coverage_impact",
        label: "Coverage Impact",
        count: attendance.summary.coverage_impact_count,
        detail: "Attendance failures are already reducing live staffing coverage.",
        tone: attendance.summary.coverage_impact_count ? "critical" : "success",
        action_hash: "#operations/attendance"
      }
    ],
    items
  };
}

function buildLiveExecutionSection(
  anchorDate: string,
  liveQueue: LiveShootQueueProjection,
  approvals: OperationalApprovalWorkspace | null,
  urgentWatch: UrgentWatchWorkspace,
  production: ProductionProjectHomeSnapshotResponse | null
): OperationsControlRoomResponse["live_execution"] {
  const entries = liveQueue.sections
    .filter((section) => section.id !== "completed")
    .flatMap((section) => section.items);
  const readinessIssueCount = entries.filter((entry) =>
    entry.key_flags.some((flag) => flag.code === "ready_to_shoot_overdue" || flag.code === "ready_to_shoot_waiting")
  ).length;
  const productionIntakeIssueCount = countActiveWatchItemsByType(urgentWatch.items, "production_intake_issue");
  const productionRiskCount = production ? Number(production.counts.attention_needed ?? 0) + productionIntakeIssueCount : 0;
  const exceptionCount = approvals
    ? approvals.summary.pending_blocking + approvals.summary.needs_clarification + approvals.summary.overdue
    : 0;
  const readySignals = entries
    .filter(
      (entry) =>
        Boolean(entry.shoot.ready_to_shoot_status) ||
        Boolean(entry.shoot.lead_confirmed_ready_at) ||
        entry.key_flags.some((flag) => flag.code === "ready_to_shoot_overdue" || flag.code === "ready_to_shoot_waiting")
    )
    .sort(compareReadySignals)
    .slice(0, 5)
    .map<OperationsControlRoomReadySignal>((entry) => ({
      id: entry.shoot.id,
      shoot_code: entry.shoot.shoot_code ?? entry.shoot.id,
      title: entry.shoot.title,
      status_label: entry.shoot.ready_to_shoot_label ?? "Ready signal pending",
      tone: toneForReadySignal(entry),
      detail: buildReadySignalDetail(entry),
      confirmed_at: entry.shoot.lead_confirmed_ready_at ?? null,
      confirmed_by_label: entry.shoot.lead_confirmed_ready_by_name ?? null,
      action_hash: buildLiveShootHash(anchorDate, entry.shoot.id)
    }));

  return {
    generated_at: liveQueue.generated_at,
    headline: "Live Shoot Execution / Readiness / Travel / Exceptions",
    summary_line:
      liveQueue.summary.needs_staffing || liveQueue.summary.needs_review || liveQueue.summary.unscheduled
        ? `${liveQueue.summary.needs_staffing} shoots need staffing, ${liveQueue.summary.needs_review} need review, and ${liveQueue.summary.unscheduled} are still incomplete.${productionRiskCount > 0 ? ` Production is also carrying ${productionRiskCount} risk item${productionRiskCount === 1 ? "" : "s"}.` : ""}`
        : productionRiskCount > 0
          ? `Live execution looks stable, but Production is still carrying ${productionRiskCount} risk item${productionRiskCount === 1 ? "" : "s"}. Use the route cards below when you need the owning workspace.`
          : "Live execution looks stable. Use the route cards below when you need the owning workspace.",
    routes: [
      {
        id: "shoots",
        title: "Shoots Queue",
        count: liveQueue.summary.in_view,
        summary: `${liveQueue.summary.needs_review} need review, ${liveQueue.summary.unscheduled} are incomplete, and ${liveQueue.summary.needs_staffing} still need staffing.`,
        tone:
          liveQueue.summary.needs_review || liveQueue.summary.needs_staffing || liveQueue.summary.unscheduled ? "warning" : "success",
        action_hash: "#operations/shoots"
      },
      ...(production
        ? [
            {
              id: "production",
              title: "Production Risk",
              count: productionRiskCount,
              summary:
                productionRiskCount > 0
                  ? productionIntakeIssueCount > 0
                    ? `${production.summary_line} ${productionIntakeIssueCount} intake issue${productionIntakeIssueCount === 1 ? "" : "s"} are also surfacing in exceptions.`
                    : production.summary_line
                  : "No overdue, blocked, stale, or release-gated production work is surfacing right now.",
              tone: mapProductionHomeToneToOperationsTone(production.tone, productionIntakeIssueCount),
              action_hash: "#production"
            }
          ]
        : []),
      {
        id: "readiness",
        title: "Readiness",
        count: readinessIssueCount,
        summary: readinessIssueCount
          ? "Ready-to-shoot reminders or overdue confirmations still need field confirmation."
          : "No readiness confirmations are escalating right now.",
        tone: readinessIssueCount ? "warning" : "success",
        action_hash: "#operations/readiness"
      },
      {
        id: "travel",
        title: "Travel & Logistics",
        count: null,
        summary: "Travel context stays with today's active shoots and linked schedule detail instead of becoming a separate record system.",
        tone: "info",
        action_hash: "#operations/travel"
      },
      {
        id: "exceptions",
        title: "Exceptions",
        count: approvals ? exceptionCount : null,
        summary: approvals
          ? exceptionCount
            ? "Blocking or overdue operational exceptions still need decisions."
            : "No blocking operational exceptions are standing out right now."
          : "Open the exceptions lane for planning-related approvals and exception work.",
        tone: exceptionCount ? "warning" : "neutral",
        action_hash: "#operations/exceptions?area=exceptions"
      }
    ],
    ready_signals: readySignals,
    items: entries.slice(0, 5).map((entry) => mapLiveShootEntry(anchorDate, entry))
  };
}

function mapUrgentWatchItem(item: UrgentWatchListItem): OperationsControlRoomItem {
  return {
    id: item.id,
    eyebrow: item.source_module_label,
    title: item.title,
    summary: item.summary,
    owner_label: item.owner_label ?? "Needs owner",
    status_label: `${item.severity_label} ${item.watch_type_label}`,
    tone: item.severity === "red" ? "critical" : "warning",
    meta: [
      { label: item.timing_label, tone: item.timing_state === "overdue" ? "critical" : "warning" },
      ...(item.source_entity_label ? [{ label: item.source_entity_label, tone: "info" as const }] : [])
    ],
    flags: item.scope_department ? [{ label: item.scope_department, tone: "neutral" as const }] : [],
    next_action: item.next_action_label,
    action_hash: item.action_hash
  };
}

function mapLiveShootEntry(anchorDate: string, entry: LiveShootQueueEntry): OperationsControlRoomItem {
  return {
    id: entry.shoot.id,
    eyebrow: entry.bucket_label,
    title: entry.shoot.title,
    summary: entry.summary_string,
    owner_label: entry.owner_label,
    status_label: entry.status_label,
    tone: toneForLiveShootEntry(entry),
    meta: [
      { label: entry.staffing_summary.label, tone: mapLiveShootTone(entry.staffing_summary.tone) },
      { label: entry.sync_summary.label, tone: mapLiveShootTone(entry.sync_summary.tone) }
    ],
    flags: entry.key_flags
      .filter((flag) => flag.code !== "profitability_watch")
      .slice(0, 3)
      .map((flag) => ({
        label: flag.label,
        tone: mapLiveShootTone(flag.tone)
      })),
    next_action: entry.next_action,
    action_hash: buildLiveShootHash(anchorDate, entry.shoot.id)
  };
}

function toneForAttendanceItem(item: AttendanceOperationsItemRecord): OperationsControlRoomTone {
  if (item.coverage_impact || item.critical_role_missing || item.current_state === "no_show") {
    return "critical";
  }
  if (item.current_state === "late" || item.current_state === "late_acknowledged" || item.current_state === "unresolved_no_check_in" || item.current_state === "replacement_needed") {
    return "warning";
  }
  if (item.current_state === "on_time" || item.current_state === "checked_in") {
    return "success";
  }
  return "neutral";
}

function toneForLiveShootEntry(entry: LiveShootQueueEntry): OperationsControlRoomTone {
  if (entry.status_tone === "critical") {
    return "critical";
  }
  if (entry.status_tone === "warning") {
    return "warning";
  }
  if (entry.status_tone === "success") {
    return "success";
  }
  if (entry.status_tone === "info") {
    return "info";
  }
  return "neutral";
}

function mapLiveShootTone(value: string): OperationsControlRoomTone {
  if (value === "critical" || value === "warning" || value === "success" || value === "info") {
    return value;
  }
  return "neutral";
}

function compareReadySignals(left: LiveShootQueueEntry, right: LiveShootQueueEntry) {
  return readySignalWeight(left) - readySignalWeight(right) || left.shoot.title.localeCompare(right.shoot.title);
}

function readySignalWeight(entry: LiveShootQueueEntry) {
  const status = entry.shoot.ready_to_shoot_status;
  if (status === "escalation_due") {
    return 0;
  }
  if (status === "reminder_due") {
    return 1;
  }
  if (status === "awaiting_confirmation") {
    return 2;
  }
  if (status === "confirmed_exception") {
    return 3;
  }
  if (status === "confirmed_clean") {
    return 4;
  }
  return 5;
}

function toneForReadySignal(entry: LiveShootQueueEntry): OperationsControlRoomTone {
  const status = entry.shoot.ready_to_shoot_status;
  if (status === "escalation_due") {
    return "critical";
  }
  if (status === "reminder_due" || status === "awaiting_confirmation") {
    return "warning";
  }
  if (status === "confirmed_exception") {
    return "info";
  }
  if (status === "confirmed_clean") {
    return "success";
  }
  return "neutral";
}

function buildReadySignalDetail(entry: LiveShootQueueEntry) {
  if (entry.shoot.lead_confirmed_ready_at) {
    const confirmer = entry.shoot.lead_confirmed_ready_by_name ?? "Lead photographer";
    return entry.shoot.lead_confirmed_ready_exception_flag
      ? `Confirmed on site by ${confirmer} with an exception flagged for follow-up.`
      : `Confirmed on site by ${confirmer}.`;
  }
  if (entry.shoot.ready_to_shoot_status === "escalation_due") {
    return "Lead-ready confirmation is overdue and should be checked immediately.";
  }
  if (entry.shoot.ready_to_shoot_status === "reminder_due") {
    return "Lead-ready confirmation reminder is due before execution trust slips.";
  }
  return "Lead-ready confirmation is still waiting from the field.";
}

function compareAttendanceItems(left: AttendanceOperationsItemRecord, right: AttendanceOperationsItemRecord) {
  const riskLeft =
    (left.coverage_impact ? 40 : 0) +
    (left.critical_role_missing ? 30 : 0) +
    (left.current_state === "no_show" ? 25 : 0) +
    (left.current_state === "replacement_needed" ? 20 : 0) +
    left.escalation_level * 5;
  const riskRight =
    (right.coverage_impact ? 40 : 0) +
    (right.critical_role_missing ? 30 : 0) +
    (right.current_state === "no_show" ? 25 : 0) +
    (right.current_state === "replacement_needed" ? 20 : 0) +
    right.escalation_level * 5;

  if (riskRight !== riskLeft) {
    return riskRight - riskLeft;
  }

  const leftTime = new Date(left.starts_at).getTime();
  const rightTime = new Date(right.starts_at).getTime();
  return leftTime - rightTime;
}

function countActiveWatchItemsByType(items: UrgentWatchListItem[], watchType: UrgentWatchListItem["watch_type"]) {
  return items.filter((item) => item.status === "active" && item.watch_type === watchType).length;
}

function mapProductionHomeToneToOperationsTone(
  tone: ProductionProjectHomeSnapshotResponse["tone"],
  intakeIssueCount: number
): OperationsControlRoomTone {
  if (tone === "action_needed") {
    return "critical";
  }
  if (tone === "heads_up" || intakeIssueCount > 0) {
    return "warning";
  }
  if (tone === "good") {
    return "success";
  }
  if (tone === "info") {
    return "info";
  }
  return "neutral";
}

function buildOperationsStaffingHash(anchorDate: string, shootId: string) {
  return `#operations/staffing?area=staffing&date=${encodeURIComponent(anchorDate)}&shoot=${encodeURIComponent(shootId)}`;
}

function buildLiveShootHash(anchorDate: string, shootId: string) {
  return `#operations/shoots?date=${encodeURIComponent(anchorDate)}&shoot=${encodeURIComponent(shootId)}`;
}

function actionHashForHistory(module: WorkflowHistoryRecord["module"]) {
  switch (module) {
    case "watch":
      return "#operations/exceptions";
    case "attendance":
      return "#operations/attendance";
    case "staffing":
    case "assignments":
      return "#operations/staffing?area=staffing";
    case "approvals":
      return "#operations/exceptions?area=exceptions";
    case "production":
      return "#production";
    default:
      return "#operations";
  }
}

function moduleLabelForHistory(module: WorkflowHistoryRecord["module"]) {
  switch (module) {
    case "assignments":
      return "Assignments";
    case "staffing":
      return "Staffing";
    case "watch":
      return "Exceptions";
    case "production":
      return "Production";
    case "approvals":
      return "Exceptions";
    case "attendance":
      return "Attendance";
    default:
      return humanizeValue(module);
  }
}

function buildShiftWindow(startsAt: string, endsAt: string | null) {
  const start = new Date(startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!endsAt) {
    return start;
  }
  const end = new Date(endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${start} - ${end}`;
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
