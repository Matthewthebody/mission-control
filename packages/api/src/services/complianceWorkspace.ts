import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { getLocalDateString, getLocalDayBounds } from "../utils/localDate.js";
import { listAttendanceExceptions, listMissedPunchRequests } from "./attendance.js";
import { shouldRestrictShiftList } from "./shiftAccess.js";
import {
  listTimeClockComplianceFlags,
  type TimeClockCompliancePreview
} from "./timeClockCompliance.js";

export type ComplianceWorkspaceSourceKind =
  | "compliance_flag"
  | "attendance_exception"
  | "presence_incident"
  | "exception_request"
  | "mileage_reimbursement";
export type ComplianceWorkspaceUrgency = "urgent" | "important" | "watch";
export type ComplianceWorkspaceStatusBucket = "unresolved" | "resolved";
export type ComplianceWorkspaceWindow = "today" | "this_week" | "overdue" | "all";
export type ComplianceWorkspaceBlockerState =
  | "payroll_blocked"
  | "mileage_blocked"
  | "closeout_blocked"
  | "presence_review"
  | "review_required"
  | "resolved";
export type ComplianceWorkspaceIssueType =
  | "missing_setup_photo"
  | "missing_post_shoot_evaluation"
  | "mileage_blocked_missing_post_shoot_evaluation"
  | "upload_while_off_clock"
  | "unresolved_end_of_day_confirmation"
  | "no_lunch_challenge"
  | "missed_clock_in_request"
  | "likely_present_missing_clock_in"
  | "assigned_but_missing"
  | "manual_time_adjustment"
  | "mileage_review_required";

export type ComplianceWorkspaceItem = {
  id: string;
  source_kind: ComplianceWorkspaceSourceKind;
  source_id: string;
  issue_type: ComplianceWorkspaceIssueType;
  issue_label: string;
  urgency: ComplianceWorkspaceUrgency;
  source_status: string;
  status_bucket: ComplianceWorkspaceStatusBucket;
  message: string;
  employee_id: string | null;
  employee_name: string | null;
  shift_id: string | null;
  shift_title: string | null;
  session_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  linked_exception_request_id: string | null;
  linked_attendance_exception_id: string | null;
  payroll_blocking: boolean;
  mileage_blocking: boolean;
  missing_closeout: boolean;
  unresolved_end_of_day_confirmation: boolean;
  blocker: {
    state: ComplianceWorkspaceBlockerState;
    label: string;
    summary: string;
    owning_workspace_label: string;
    owning_workspace_hash: string;
  };
  occurred_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type ComplianceWorkspaceHistoryEntry = {
  id: string;
  occurred_at: string;
  source_label: string;
  title: string;
  summary: string | null;
  actor_name: string | null;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
};

export type ComplianceWorkspaceDeepLink = {
  id: string;
  label: string;
  hash: string;
};

export type ComplianceWorkspaceAvailableAction = {
  id: string;
  label: string;
  kind: "review" | "drill_out" | "escalate";
  hash: string | null;
};

export type ComplianceWorkspacePayrollImpact = {
  blocked: boolean;
  reason: string | null;
  session_id: string | null;
  work_date: string | null;
  session_status: string | null;
  payable_minutes: number | null;
  lunch_challenge_status: string | null;
  manual_correction_count: number | null;
  missed_clock_in_approval_count: number | null;
};

export type ComplianceWorkspaceMileageImpact = {
  blocked: boolean;
  reason: string | null;
  reimbursement_id: string | null;
  work_date: string | null;
  status: string | null;
  review_reason_code: string | null;
  review_reason_label: string | null;
  issue_label: string | null;
  reimbursement_amount: string | null;
  zone_name: string | null;
  vehicle_type: string | null;
  submit_for_mileage: boolean | null;
};

// G1 Part 2 — linked labor/payroll categories. These are LINKS into the workspaces that own the
// records (Labor Command Center / Payroll Self-Check), never re-implemented compliance items:
// live counts + an exact destination, or available:false with a reason if the source is absent.
export type ComplianceWorkspaceLinkedCategory =
  | {
      key: "labor_command_center" | "payroll_self_check";
      label: string;
      available: true;
      destination_hash: string;
      counts: Record<string, number>;
      detail: string;
    }
  | {
      key: "labor_command_center" | "payroll_self_check";
      label: string;
      available: false;
      destination_hash: string;
      reason: string;
    };

export type ComplianceWorkspaceListPayload = {
  summary: {
    open_count: number;
    payroll_blocking_count: number;
    mileage_blocking_count: number;
    missing_closeout_count: number;
    unresolved_end_of_day_confirmation_count: number;
    missed_clock_in_review_count: number;
    no_lunch_review_count: number;
    off_clock_upload_review_count: number;
    presence_incident_review_count: number;
    // G1 Part 2 leadership counts — every count equals the number of matching rows in the
    // RETURNED item set (the count==rows invariant; resolved_today_count matches returned
    // resolved rows, so it is 0 when the status filter excludes resolved items).
    needs_manager_review_count: number;
    needs_employee_correction_count: number;
    overdue_count: number;
    resolved_today_count: number;
    counts_by_issue_type: Record<ComplianceWorkspaceIssueType, number>;
    counts_by_urgency: Record<ComplianceWorkspaceUrgency, number>;
  };
  linked_categories: ComplianceWorkspaceLinkedCategory[];
  freshness: {
    generated_at: string;
    latest_item_updated_at: string | null;
    latest_unresolved_item_updated_at: string | null;
  };
  filters: {
    employees: Array<{ id: string; name: string }>;
    organizations: Array<{ id: string; name: string }>;
    shoots: Array<{ id: string; title: string }>;
    issue_types: Array<{ id: ComplianceWorkspaceIssueType; label: string }>;
  };
  rows: ComplianceWorkspaceItem[];
};

export type ComplianceWorkspaceDetailPayload = {
  item: ComplianceWorkspaceItem;
  available_actions: ComplianceWorkspaceAvailableAction[];
  deep_links: ComplianceWorkspaceDeepLink[];
  history: ComplianceWorkspaceHistoryEntry[];
  payroll_impact: ComplianceWorkspacePayrollImpact;
  mileage_impact: ComplianceWorkspaceMileageImpact;
  linked_records: {
    shift: {
      id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      attendance_state: string | null;
      manager_user_id: string | null;
      manager_name: string | null;
      location_name: string | null;
      location_address: string | null;
      navigation_url: string | null;
    } | null;
    shoot: {
      id: string;
      shoot_code: string | null;
      title: string;
      shoot_date: string | null;
      showtime: string | null;
      start_time: string | null;
      estimated_end_time: string | null;
      status: string | null;
    } | null;
    organization: {
      id: string;
      display_name: string;
    } | null;
    location: {
      id: string;
      name: string;
      address: string | null;
      maps_url: string | null;
    } | null;
    correction_request: {
      id: string;
      request_type: string;
      status: string;
      submitted_at: string;
      reviewed_at: string | null;
      requested_state: string | null;
      requested_start_time: string | null;
      requested_end_time: string | null;
      note: string | null;
      reporting_flags: string[];
      original_values: Record<string, unknown>;
      resolved_values: Record<string, unknown>;
      requested_approver_id: string | null;
      requested_approver_name: string | null;
      reviewed_by_id: string | null;
      reviewed_by_name: string | null;
      approval_records: Array<{
        id: string;
        approver_id: string;
        approver_name: string | null;
        approver_role: string;
        decision: string;
        comment: string | null;
        decided_at: string;
      }>;
    } | null;
    post_shoot_evaluation: {
      id: string;
      submitted_at: string;
      photographer_name: string | null;
      overall_shoot_status: string | null;
      issue_flag: boolean;
      went_well: string | null;
      remember_next_time: string | null;
      open_comment: string | null;
      submit_for_mileage: boolean;
      vehicle_type: string | null;
    } | null;
    resource_uploads: Array<{
      id: string;
      file_name: string;
      category: string;
      approval_status: string;
      visibility_scope: string;
      note: string | null;
      issue_type: string | null;
      upload_source: string | null;
      uploader_name: string | null;
      captured_at: string | null;
      created_at: string;
      file_url: string | null;
    }>;
    presence_incident: {
      id: string;
      alert_type: string;
      current_state: string;
      geofence_classification: string;
      repeat_count: number;
      last_observed_at: string;
      last_notified_at: string | null;
      resolution_status: string;
      resolved_at: string | null;
      resolution_reason: string | null;
    } | null;
  };
};

type ComplianceWorkspaceShiftDetail = NonNullable<ComplianceWorkspaceDetailPayload["linked_records"]["shift"]>;
type ComplianceWorkspaceShootDetail = NonNullable<ComplianceWorkspaceDetailPayload["linked_records"]["shoot"]>;
type ComplianceWorkspaceOrganizationDetail = NonNullable<ComplianceWorkspaceDetailPayload["linked_records"]["organization"]>;
type ComplianceWorkspaceLocationDetail = NonNullable<ComplianceWorkspaceDetailPayload["linked_records"]["location"]>;
type ComplianceWorkspacePostShootEvaluationDetail = NonNullable<
  ComplianceWorkspaceDetailPayload["linked_records"]["post_shoot_evaluation"]
>;
type ComplianceWorkspacePresenceIncidentDetail = NonNullable<
  ComplianceWorkspaceDetailPayload["linked_records"]["presence_incident"]
>;

type ComplianceWorkspaceAttendanceHistoryRow = {
  id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  signal_source: string | null;
  note: string | null;
  created_at: string;
  actor_user_name: string | null;
};

type AttendanceExceptionLike = {
  id: string;
  user_id?: string;
  user_name?: string | null;
  shift_id?: string | null;
  shift_title?: string | null;
  shoot_code?: string | null;
  shoot_id?: string | null;
  shoot_title?: string | null;
  exception_type: string;
  workflow_kind?: string | null;
  missing_direction?: string | null;
  status: string;
  notes?: string | null;
  classification?: string | null;
  created_at: string;
  updated_at?: string;
  approved_at?: string | null;
  resolved_value?: Record<string, unknown> | null;
  time_clock_exception_request_id?: string | null;
  time_clock_request_status?: string | null;
  time_clock_request_type?: string | null;
  time_clock_requested_start_time?: string | null;
  time_clock_requested_end_time?: string | null;
  time_clock_requested_state?: string | null;
};

type AttendanceExceptionContext = {
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
};

type ComplianceWorkspaceItemBase = Omit<ComplianceWorkspaceItem, "blocker">;

type ComplianceWorkspaceTimeSessionRow = {
  id: string;
  work_date: string;
  status: string;
};

type ComplianceWorkspacePayrollImpactRow = {
  session_id: string;
  work_date: string;
  session_status: string;
  payable_minutes: number;
  lunch_challenge_status: string | null;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
};

type ComplianceWorkspaceMileageImpactRow = {
  id: string;
  work_date: string;
  status: string;
  review_reason_code: string | null;
  reimbursement_amount: string | null;
  zone_name: string | null;
  vehicle_type: string | null;
  submit_for_mileage: boolean | null;
};

type PresenceIncidentRow = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  shift_id: string | null;
  shift_title: string | null;
  session_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  linked_exception_request_id: string | null;
  alert_type: "assigned_but_missing" | "likely_present_missing_clock_in";
  current_state: string;
  geofence_classification: string;
  resolution_status: "open" | "resolved";
  repeat_count: number;
  created_at: string;
  updated_at: string;
  last_observed_at: string;
  last_notified_at: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
};

const ISSUE_LABELS: Record<ComplianceWorkspaceIssueType, string> = {
  missing_setup_photo: "Missing Setup Photo",
  missing_post_shoot_evaluation: "Missing Post-Shoot Evaluation",
  mileage_blocked_missing_post_shoot_evaluation: "Mileage Blocked By Missing Post-Shoot Evaluation",
  upload_while_off_clock: "Upload While Off Clock",
  unresolved_end_of_day_confirmation: "Unresolved End-of-Day Confirmation",
  no_lunch_challenge: "No-Lunch Challenge",
  missed_clock_in_request: "Missed Clock-In Request",
  likely_present_missing_clock_in: "Likely Present, Missing Clock-In",
  assigned_but_missing: "Assigned but Missing",
  manual_time_adjustment: "Manual Time Adjustment",
  mileage_review_required: "Mileage Review Required"
};

function emptyIssueCounts(): Record<ComplianceWorkspaceIssueType, number> {
  return {
    missing_setup_photo: 0,
    missing_post_shoot_evaluation: 0,
    mileage_blocked_missing_post_shoot_evaluation: 0,
    upload_while_off_clock: 0,
    unresolved_end_of_day_confirmation: 0,
    no_lunch_challenge: 0,
    missed_clock_in_request: 0,
    likely_present_missing_clock_in: 0,
    assigned_but_missing: 0,
    manual_time_adjustment: 0,
    mileage_review_required: 0
  };
}

function emptyUrgencyCounts(): Record<ComplianceWorkspaceUrgency, number> {
  return {
    urgent: 0,
    important: 0,
    watch: 0
  };
}

function humanizeLabel(value: string) {
  return value
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function startOfLocalWeek(value: string) {
  const { start } = getLocalDayBounds(value);
  const day = start.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + shift);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfLocalWeekExclusive(value: string) {
  const start = startOfLocalWeek(value);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 7);
  return end;
}

function normalizeStatusBucket(status: string): ComplianceWorkspaceStatusBucket {
  return status === "open" || status === "submitted" || status === "under_review" ? "unresolved" : "resolved";
}

function compareUrgency(a: ComplianceWorkspaceUrgency, b: ComplianceWorkspaceUrgency) {
  const order: Record<ComplianceWorkspaceUrgency, number> = {
    urgent: 0,
    important: 1,
    watch: 2
  };
  return order[a] - order[b];
}

function getBlockerSortWeight(item: ComplianceWorkspaceItem) {
  switch (item.blocker.state) {
    case "payroll_blocked":
      return 0;
    case "mileage_blocked":
      return 1;
    case "closeout_blocked":
      return 2;
    case "presence_review":
      return 3;
    case "review_required":
      return 4;
    case "resolved":
      return 5;
    default:
      return 6;
  }
}

function buildComplianceBlocker(item: ComplianceWorkspaceItemBase): ComplianceWorkspaceItem["blocker"] {
  if (item.status_bucket === "resolved") {
    return {
      state: "resolved",
      label: "Resolved",
      summary: item.resolution_note?.trim() || "No active trust blocker remains for this issue.",
      owning_workspace_label: "Compliance",
      owning_workspace_hash: "#employees/compliance"
    };
  }

  if (item.payroll_blocking) {
    if (item.issue_type === "manual_time_adjustment") {
      return {
        state: "payroll_blocked",
        label: "Payroll Blocked",
        summary: "Payroll confidence is blocked until the manual time adjustment request is approved or rejected.",
        owning_workspace_label: "Attendance",
        owning_workspace_hash: "#operations/attendance"
      };
    }
    if (item.issue_type === "unresolved_end_of_day_confirmation") {
      return {
        state: "payroll_blocked",
        label: "Payroll Blocked",
        summary: "Payroll confidence is blocked until the employee's unresolved end-of-day confirmation is reviewed.",
        owning_workspace_label: "Payroll Review",
        owning_workspace_hash: "#employees/payroll"
      };
    }
    if (item.issue_type === "missed_clock_in_request") {
      return {
        state: "payroll_blocked",
        label: "Payroll Blocked",
        summary: "Payroll confidence is blocked until the missed clock-in request is approved or rejected.",
        owning_workspace_label: "Attendance",
        owning_workspace_hash: "#operations/attendance"
      };
    }
    if (item.issue_type === "no_lunch_challenge") {
      return {
        state: "payroll_blocked",
        label: "Payroll Blocked",
        summary: "Payroll confidence is blocked until the no-lunch challenge is approved or rejected.",
        owning_workspace_label: "Attendance",
        owning_workspace_hash: "#operations/attendance"
      };
    }
    return {
      state: "payroll_blocked",
      label: "Payroll Blocked",
      summary: "Payroll confidence is blocked because presence suggests work happened without a valid clock-in.",
      owning_workspace_label: "Attendance",
      owning_workspace_hash: "#operations/attendance"
    };
  }

  if (item.mileage_blocking) {
    if (item.issue_type === "mileage_review_required") {
      return {
        state: "mileage_blocked",
        label: "Mileage Review Required",
        summary: "This mileage reimbursement needs manager review before it can move forward.",
        owning_workspace_label: "Payroll Review",
        owning_workspace_hash: "#employees/payroll"
      };
    }
    return {
      state: "mileage_blocked",
      label: "Mileage Blocked",
      summary: "Mileage reimbursement is blocked until the required post-shoot closeout is completed.",
      owning_workspace_label: "Compliance",
      owning_workspace_hash: "#employees/compliance"
    };
  }

  if (item.missing_closeout) {
    return {
      state: "closeout_blocked",
      label: "Closeout Blocked",
      summary:
        item.issue_type === "missing_setup_photo"
          ? "The required setup photo is still missing from closeout."
          : "The required post-shoot evaluation is still missing from closeout.",
      owning_workspace_label: "Compliance",
      owning_workspace_hash: "#employees/compliance"
    };
  }

  if (item.issue_type === "assigned_but_missing" || item.issue_type === "likely_present_missing_clock_in") {
    return {
      state: "presence_review",
      label: "Presence Review",
      summary:
        item.issue_type === "assigned_but_missing"
          ? "Assigned coverage is still missing and needs leadership follow-up."
          : "Presence was observed without a valid clock-in and needs review.",
      owning_workspace_label: "Attendance",
      owning_workspace_hash: "#operations/attendance"
    };
  }

  if (item.issue_type === "upload_while_off_clock") {
    return {
      state: "review_required",
      label: "Time Integrity Review",
      summary: "Operational media was uploaded while off clock and the related time record needs review.",
      owning_workspace_label: "Compliance",
      owning_workspace_hash: "#employees/compliance"
    };
  }

  return {
    state: "review_required",
    label: "Review Required",
    summary: "Leadership review is still required before this trust blocker is cleared.",
    owning_workspace_label: "Compliance",
    owning_workspace_hash: "#employees/compliance"
  };
}

function withComplianceBlocker(item: ComplianceWorkspaceItemBase): ComplianceWorkspaceItem {
  return {
    ...item,
    blocker: buildComplianceBlocker(item)
  };
}

function includesText(value: string | null | undefined, filter: string | undefined) {
  if (!filter?.trim()) {
    return true;
  }
  return value === filter;
}

function occursWithinWindow(item: ComplianceWorkspaceItem, anchorDate: string, window: ComplianceWorkspaceWindow) {
  if (window === "all") {
    return true;
  }

  const occurredAt = new Date(item.occurred_at);
  const { start: todayStart, endExclusive: tomorrowStart } = getLocalDayBounds(anchorDate);

  if (window === "today") {
    return occurredAt >= todayStart && occurredAt < tomorrowStart;
  }

  if (window === "this_week") {
    const weekStart = startOfLocalWeek(anchorDate);
    const weekEnd = endOfLocalWeekExclusive(anchorDate);
    return occurredAt >= weekStart && occurredAt < weekEnd;
  }

  return item.status_bucket === "unresolved" && occurredAt < todayStart;
}

function buildFlagUrgency(row: TimeClockCompliancePreview): ComplianceWorkspaceUrgency {
  if (row.severity === "high") {
    return "urgent";
  }
  if (row.item_type === "mileage_blocked_missing_post_shoot_evaluation" || row.item_type === "unresolved_end_of_day_confirmation") {
    return "important";
  }
  return "watch";
}

function buildPresenceUrgency(alertType: PresenceIncidentRow["alert_type"]): ComplianceWorkspaceUrgency {
  return alertType === "assigned_but_missing" ? "urgent" : "important";
}

function buildExceptionUrgency(issueType: ComplianceWorkspaceIssueType): ComplianceWorkspaceUrgency {
  return issueType === "no_lunch_challenge" || issueType === "missed_clock_in_request" ? "important" : "watch";
}

function buildPresenceMessage(row: PresenceIncidentRow) {
  if (row.alert_type === "assigned_but_missing") {
    return `${row.employee_name ?? "Assigned employee"} is still missing from the assigned Shoot context and needs immediate follow-up.`;
  }
  const placeLabel =
    row.geofence_classification === "inside_soft_radius"
      ? "inside the soft warning radius"
      : row.geofence_classification === "inside_shoot_radius"
        ? "inside the Shoot radius"
        : "near the assigned Shoot";
  return `${row.employee_name ?? "Employee"} appears ${placeLabel} but does not have a valid clock-in on record.`;
}

function buildExceptionMessage(row: AttendanceExceptionLike, issueType: ComplianceWorkspaceIssueType) {
  if (issueType === "no_lunch_challenge") {
    return row.notes?.trim()
      ? row.notes.trim()
      : "A lunch deduction challenge needs payroll review before the day is finalized.";
  }
  const requestedTime = row.time_clock_requested_start_time ?? row.time_clock_requested_end_time ?? null;
  if (requestedTime) {
    return `Missed clock-in correction requested for ${new Date(requestedTime).toLocaleString()}.`;
  }
  return row.notes?.trim() ? row.notes.trim() : "A missed clock-in request needs review.";
}

function buildComplianceFlagItem(row: TimeClockCompliancePreview): ComplianceWorkspaceItem {
  return withComplianceBlocker({
    id: `compliance_flag:${row.id}`,
    source_kind: "compliance_flag",
    source_id: row.id,
    issue_type: row.item_type,
    issue_label: row.item_label,
    urgency: buildFlagUrgency(row),
    source_status: row.status,
    status_bucket: normalizeStatusBucket(row.status),
    message: row.message,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    shift_id: row.shift_id,
    shift_title: row.shift_title,
    session_id: row.session_id,
    shoot_id: row.shoot_id,
    shoot_code: row.shoot_code,
    shoot_title: row.shoot_title,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    location_id: row.location_id,
    location_name: row.location_name,
    linked_exception_request_id: row.linked_exception_request_id,
    linked_attendance_exception_id: null,
    payroll_blocking: row.item_type === "unresolved_end_of_day_confirmation",
    mileage_blocking: row.item_type === "mileage_blocked_missing_post_shoot_evaluation",
    missing_closeout: row.item_type === "missing_setup_photo" || row.item_type === "missing_post_shoot_evaluation",
    unresolved_end_of_day_confirmation: row.item_type === "unresolved_end_of_day_confirmation",
    occurred_at: row.first_detected_at,
    updated_at: row.last_detected_at,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_note
  });
}

function buildAttendanceExceptionItem(
  row: AttendanceExceptionLike,
  issueType: ComplianceWorkspaceIssueType,
  context?: AttendanceExceptionContext | null
): ComplianceWorkspaceItem {
  return withComplianceBlocker({
    id: `attendance_exception:${row.id}`,
    source_kind: "attendance_exception",
    source_id: row.id,
    issue_type: issueType,
    issue_label: ISSUE_LABELS[issueType],
    urgency: buildExceptionUrgency(issueType),
    source_status: row.status,
    status_bucket: normalizeStatusBucket(row.status),
    message: buildExceptionMessage(row, issueType),
    employee_id: row.user_id ?? null,
    employee_name: row.user_name ?? null,
    shift_id: row.shift_id ?? null,
    shift_title: row.shift_title ?? null,
    session_id: null,
    shoot_id: context?.shoot_id ?? row.shoot_id ?? null,
    shoot_code: context?.shoot_code ?? row.shoot_code ?? null,
    shoot_title: context?.shoot_title ?? row.shoot_title ?? row.shift_title ?? null,
    organization_id: context?.organization_id ?? null,
    organization_display_name: context?.organization_display_name ?? null,
    location_id: context?.location_id ?? null,
    location_name: context?.location_name ?? null,
    linked_exception_request_id: row.time_clock_exception_request_id ?? null,
    linked_attendance_exception_id: row.id,
    payroll_blocking: true,
    mileage_blocking: false,
    missing_closeout: false,
    unresolved_end_of_day_confirmation: false,
    occurred_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    resolved_at: row.status === "approved" || row.status === "resolved" || row.status === "rejected" ? row.approved_at ?? row.updated_at ?? null : null,
    resolution_note: row.notes ?? null
  });
}

function buildPresenceIncidentItem(row: PresenceIncidentRow): ComplianceWorkspaceItem {
  return withComplianceBlocker({
    id: `presence_incident:${row.id}`,
    source_kind: "presence_incident",
    source_id: row.id,
    issue_type: row.alert_type,
    issue_label: ISSUE_LABELS[row.alert_type],
    urgency: buildPresenceUrgency(row.alert_type),
    source_status: row.resolution_status,
    status_bucket: normalizeStatusBucket(row.resolution_status),
    message: buildPresenceMessage(row),
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    shift_id: row.shift_id,
    shift_title: row.shift_title,
    session_id: row.session_id,
    shoot_id: row.shoot_id,
    shoot_code: row.shoot_code,
    shoot_title: row.shoot_title,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    location_id: row.location_id,
    location_name: row.location_name,
    linked_exception_request_id: row.linked_exception_request_id,
    linked_attendance_exception_id: null,
    payroll_blocking: row.alert_type === "likely_present_missing_clock_in",
    mileage_blocking: false,
    missing_closeout: false,
    unresolved_end_of_day_confirmation: false,
    occurred_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_reason
  });
}

async function listPresenceIncidents(client: PoolClient, auth: AuthUser, filters: { shootId?: string } = {}) {
  const values: unknown[] = [auth.tenantId];
  const where = ["incident.tenant_id = $1"];

  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    const authParam = `$${values.length}`;
    where.push(`(incident.employee_id = ${authParam} OR ws.manager_user_id = ${authParam})`);
  }

  if (filters.shootId) {
    values.push(filters.shootId);
    where.push(`COALESCE(incident.shoot_id, ws.shoot_id) = $${values.length}::uuid`);
  }

  const { rows } = await client.query<PresenceIncidentRow>(
    `
      SELECT
        incident.id,
        incident.employee_id,
        employee.full_name AS employee_name,
        incident.shift_id,
        ws.title AS shift_title,
        observation.session_id,
        incident.shoot_id,
        shoot.shoot_code,
        shoot.title AS shoot_title,
        shoot.organization_id,
        org.display_name AS organization_display_name,
        shoot.location_id,
        COALESCE(location.name, ws.location_name) AS location_name,
        incident.linked_correction_request_id AS linked_exception_request_id,
        incident.alert_type::text AS alert_type,
        incident.current_state::text AS current_state,
        incident.geofence_classification::text AS geofence_classification,
        incident.resolution_status::text AS resolution_status,
        incident.repeat_count,
        incident.created_at::text,
        incident.updated_at::text,
        incident.last_observed_at::text,
        incident.last_notified_at::text,
        incident.resolved_at::text,
        incident.resolution_reason
      FROM time_clock_presence_incident incident
      JOIN app_user employee
        ON employee.tenant_id = incident.tenant_id
       AND employee.id = incident.employee_id
      LEFT JOIN work_shift ws
        ON ws.id = incident.shift_id
      LEFT JOIN shoot
        ON shoot.id = incident.shoot_id
      LEFT JOIN organization org
        ON org.id = shoot.organization_id
      LEFT JOIN shoot_location location
        ON location.id = shoot.location_id
      LEFT JOIN time_clock_presence_observation observation
        ON observation.tenant_id = incident.tenant_id
       AND observation.employee_id = incident.employee_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE incident.alert_type
          WHEN 'assigned_but_missing' THEN 0
          ELSE 1
        END,
        incident.last_observed_at DESC,
        employee.full_name ASC
    `,
    values
  );

  return rows;
}

async function loadAttendanceExceptionContexts(client: PoolClient, tenantId: string, shiftIds: string[]) {
  if (!shiftIds.length) {
    return new Map<string, AttendanceExceptionContext>();
  }

  const { rows } = await client.query<
    AttendanceExceptionContext & {
      shift_id: string;
    }
  >(
    `
      SELECT
        ws.id AS shift_id,
        ws.shoot_id,
        shoot.shoot_code,
        shoot.title AS shoot_title,
        shoot.organization_id,
        org.display_name AS organization_display_name,
        shoot.location_id,
        COALESCE(location.name, ws.location_name) AS location_name
      FROM work_shift ws
      LEFT JOIN shoot
        ON shoot.id = ws.shoot_id
      LEFT JOIN organization org
        ON org.id = shoot.organization_id
      LEFT JOIN shoot_location location
        ON location.id = shoot.location_id
      WHERE ws.tenant_id = $1
        AND ws.id = ANY($2::uuid[])
    `,
    [tenantId, shiftIds]
  );

  return new Map(rows.map((row) => [row.shift_id, row]));
}

// G1 Part 2 — leadership triage classification. Who must act next for each issue type:
// employee-correction = the employee owes an artifact/confirmation; manager-review = a
// manager/leadership decision clears it. Declared explicitly so the summary counts are
// auditable rather than implied.
const EMPLOYEE_CORRECTION_ISSUE_TYPES = new Set<ComplianceWorkspaceIssueType>([
  "missing_setup_photo",
  "missing_post_shoot_evaluation",
  "mileage_blocked_missing_post_shoot_evaluation",
  "unresolved_end_of_day_confirmation"
]);
const MANAGER_REVIEW_ISSUE_TYPES = new Set<ComplianceWorkspaceIssueType>([
  "no_lunch_challenge",
  "missed_clock_in_request",
  "upload_while_off_clock",
  "likely_present_missing_clock_in",
  "assigned_but_missing",
  "manual_time_adjustment",
  "mileage_review_required"
]);

// G1 Part 2 — live links into the labor/payroll workspaces (landed migrations 165/166). Counts
// are read directly from the canonical tables those workspaces own; if a query fails because the
// source is genuinely absent, the category degrades to available:false with the reason — never a
// fabricated zero.
async function loadLinkedLaborCategories(client: PoolClient, tenantId: string): Promise<ComplianceWorkspaceLinkedCategory[]> {
  try {
    const [warnings, selfChecks, period] = await Promise.all([
      client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM overtime_warning WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId]
      ),
      client.query<{ n: string }>(
        `
          SELECT COUNT(*)::text AS n
          FROM payroll_self_check sc
          JOIN payroll_period p ON p.id = sc.payroll_period_id AND p.tenant_id = sc.tenant_id
          WHERE sc.tenant_id = $1
            AND sc.status = 'pending'
            AND p.status NOT IN ('exported', 'synced')
        `,
        [tenantId]
      ),
      client.query<{ status: string }>(
        `SELECT status::text AS status FROM payroll_period WHERE tenant_id = $1 ORDER BY period_start DESC LIMIT 1`,
        [tenantId]
      )
    ]);
    const activeWarnings = Number(warnings.rows[0]?.n ?? 0);
    const pendingSelfChecks = Number(selfChecks.rows[0]?.n ?? 0);
    const periodStatus = period.rows[0]?.status ?? null;
    return [
      {
        key: "labor_command_center",
        label: "Labor Command Center",
        available: true,
        destination_hash: "#labor/command-center",
        counts: { active_overtime_warnings: activeWarnings },
        detail: periodStatus
          ? `Current pay period is in ${periodStatus.replace(/_/g, " ")}.`
          : "No pay period has been created yet."
      },
      {
        key: "payroll_self_check",
        label: "Payroll Self-Check",
        available: true,
        destination_hash: "#my-work/payroll-self-check",
        counts: { pending_self_checks: pendingSelfChecks },
        detail: pendingSelfChecks
          ? `${pendingSelfChecks} employee self-check${pendingSelfChecks === 1 ? "" : "s"} still pending.`
          : "No employee self-checks are pending."
      }
    ];
  } catch {
    // Source tables missing/unreachable — report honestly instead of zeros.
    return [
      {
        key: "labor_command_center",
        label: "Labor Command Center",
        available: false,
        destination_hash: "#labor/command-center",
        reason: "Labor Command Center data is not reachable right now."
      },
      {
        key: "payroll_self_check",
        label: "Payroll Self-Check",
        available: false,
        destination_hash: "#my-work/payroll-self-check",
        reason: "Payroll self-check data is not reachable right now."
      }
    ];
  }
}

// G1 Part 2b — manual time adjustments as first-class compliance items, derived from the canonical
// exception_request correction types (time_segment_correction / work_state_change). Unresolved
// (submitted / under_review) requests block payroll confidence until reviewed.
async function listManualTimeAdjustmentItems(
  client: PoolClient,
  tenantId: string,
  filters: { shootId?: string } = {}
): Promise<ComplianceWorkspaceItem[]> {
  const params: unknown[] = [tenantId];
  let shootFilter = "";
  if (filters.shootId) {
    params.push(filters.shootId);
    shootFilter = `AND er.linked_shoot_id = $${params.length}`;
  }
  const { rows } = await client.query<{
    id: string;
    request_type: string;
    status: string;
    note: string | null;
    employee_id: string;
    employee_name: string | null;
    shift_id: string | null;
    shift_title: string | null;
    session_id: string | null;
    shoot_id: string | null;
    shoot_code: string | null;
    shoot_title: string | null;
    organization_id: string | null;
    organization_display_name: string | null;
    location_id: string | null;
    location_name: string | null;
    submitted_at: string;
    reviewed_at: string | null;
  }>(
    `
      SELECT
        er.id,
        er.request_type::text AS request_type,
        er.status::text AS status,
        er.note,
        er.employee_id,
        au.full_name AS employee_name,
        er.linked_shift_id AS shift_id,
        ws.title AS shift_title,
        er.linked_session_id AS session_id,
        er.linked_shoot_id AS shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        s.organization_id,
        o.display_name AS organization_display_name,
        s.location_id,
        s.location_name,
        er.submitted_at::text AS submitted_at,
        er.reviewed_at::text AS reviewed_at
      FROM exception_request er
      LEFT JOIN app_user au ON au.id = er.employee_id
      LEFT JOIN work_shift ws ON ws.id = er.linked_shift_id AND ws.tenant_id = er.tenant_id
      LEFT JOIN shoot s ON s.id = er.linked_shoot_id AND s.tenant_id = er.tenant_id
      LEFT JOIN organization o ON o.id = s.organization_id AND o.tenant_id = er.tenant_id
      WHERE er.tenant_id = $1
        AND er.request_type IN ('time_segment_correction', 'work_state_change')
        ${shootFilter}
    `,
    params
  );
  return rows.map((row) =>
    withComplianceBlocker({
      id: `exception_request:${row.id}`,
      source_kind: "exception_request",
      source_id: row.id,
      issue_type: "manual_time_adjustment",
      issue_label: ISSUE_LABELS.manual_time_adjustment,
      urgency: "important",
      source_status: row.status,
      status_bucket: normalizeStatusBucket(row.status),
      message: row.note?.trim()
        ? row.note.trim()
        : `A manual ${row.request_type === "work_state_change" ? "work-state change" : "time segment correction"} needs payroll review.`,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      shift_id: row.shift_id,
      shift_title: row.shift_title,
      session_id: row.session_id,
      shoot_id: row.shoot_id,
      shoot_code: row.shoot_code,
      shoot_title: row.shoot_title,
      organization_id: row.organization_id,
      organization_display_name: row.organization_display_name,
      location_id: row.location_id,
      location_name: row.location_name,
      linked_exception_request_id: row.id,
      linked_attendance_exception_id: null,
      payroll_blocking: normalizeStatusBucket(row.status) === "unresolved",
      mileage_blocking: false,
      missing_closeout: false,
      unresolved_end_of_day_confirmation: false,
      occurred_at: row.submitted_at,
      updated_at: row.reviewed_at ?? row.submitted_at,
      resolved_at: normalizeStatusBucket(row.status) === "resolved" ? row.reviewed_at : null,
      resolution_note: null
    })
  );
}

// G1 Part 2b — mileage rows needing manager review as first-class compliance items. Rows whose
// reason is missing_post_shoot_evaluation are deliberately EXCLUDED: that state is already owned
// by the mileage_blocked_missing_post_shoot_evaluation compliance flag (no duplicate items).
async function listMileageReviewRequiredItems(
  client: PoolClient,
  tenantId: string,
  filters: { shootId?: string } = {}
): Promise<ComplianceWorkspaceItem[]> {
  const params: unknown[] = [tenantId];
  let shootFilter = "";
  if (filters.shootId) {
    params.push(filters.shootId);
    shootFilter = `AND mr.linked_shoot_id = $${params.length}`;
  }
  const { rows } = await client.query<{
    id: string;
    work_date: string;
    review_reason_code: string | null;
    employee_id: string;
    employee_name: string | null;
    shift_id: string | null;
    shift_title: string | null;
    shoot_id: string | null;
    shoot_code: string | null;
    shoot_title: string | null;
    organization_id: string | null;
    organization_display_name: string | null;
    location_id: string | null;
    location_name: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        mr.id,
        mr.work_date::text AS work_date,
        mr.review_reason_code::text AS review_reason_code,
        mr.employee_id,
        au.full_name AS employee_name,
        mr.linked_shift_id AS shift_id,
        ws.title AS shift_title,
        mr.linked_shoot_id AS shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        mr.organization_id,
        o.display_name AS organization_display_name,
        mr.location_id,
        s.location_name,
        mr.created_at::text AS created_at,
        mr.updated_at::text AS updated_at
      FROM mileage_reimbursement mr
      LEFT JOIN app_user au ON au.id = mr.employee_id
      LEFT JOIN work_shift ws ON ws.id = mr.linked_shift_id AND ws.tenant_id = mr.tenant_id
      LEFT JOIN shoot s ON s.id = mr.linked_shoot_id AND s.tenant_id = mr.tenant_id
      LEFT JOIN organization o ON o.id = mr.organization_id AND o.tenant_id = mr.tenant_id
      WHERE mr.tenant_id = $1
        AND mr.status = 'review_required'
        AND mr.review_reason_code IS DISTINCT FROM 'missing_post_shoot_evaluation'
        ${shootFilter}
    `,
    params
  );
  return rows.map((row) =>
    withComplianceBlocker({
      id: `mileage_reimbursement:${row.id}`,
      source_kind: "mileage_reimbursement",
      source_id: row.id,
      issue_type: "mileage_review_required",
      issue_label: ISSUE_LABELS.mileage_review_required,
      urgency: "important",
      source_status: "review_required",
      status_bucket: "unresolved",
      message: mileageReasonLabel({ review_reason_code: row.review_reason_code } as ComplianceWorkspaceMileageImpactRow) ??
        `Mileage for ${row.work_date} needs manager review.`,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      shift_id: row.shift_id,
      shift_title: row.shift_title,
      session_id: null,
      shoot_id: row.shoot_id,
      shoot_code: row.shoot_code,
      shoot_title: row.shoot_title,
      organization_id: row.organization_id,
      organization_display_name: row.organization_display_name,
      location_id: row.location_id,
      location_name: row.location_name,
      linked_exception_request_id: null,
      linked_attendance_exception_id: null,
      payroll_blocking: false,
      mileage_blocking: true,
      missing_closeout: false,
      unresolved_end_of_day_confirmation: false,
      occurred_at: row.created_at,
      updated_at: row.updated_at,
      resolved_at: null,
      resolution_note: null
    })
  );
}

async function listComplianceWorkspaceSourceRows(client: PoolClient, auth: AuthUser, filters: { shootId?: string } = {}) {
  const complianceFlags = await listTimeClockComplianceFlags(client, auth, { status: "all", shootId: filters.shootId });
  const attendanceExceptions = await listAttendanceExceptions(client, auth, { shootId: filters.shootId });
  const missedPunches = await listMissedPunchRequests(client, auth, { shootId: filters.shootId });
  const presenceIncidents = await listPresenceIncidents(client, auth, { shootId: filters.shootId });
  const manualAdjustments = await listManualTimeAdjustmentItems(client, auth.tenantId, { shootId: filters.shootId });
  const mileageReviews = await listMileageReviewRequiredItems(client, auth.tenantId, { shootId: filters.shootId });

  const noLunchChallenges = (attendanceExceptions as unknown as AttendanceExceptionLike[]).filter(
    (row) => row.exception_type === "NO_LUNCH_CHALLENGE"
  );
  const missedClockIns = (missedPunches as AttendanceExceptionLike[]).filter(
    (row) => row.missing_direction === "in" || row.time_clock_request_type === "missing_clock_in"
  );
  const exceptionContexts = await loadAttendanceExceptionContexts(
    client,
    auth.tenantId,
    [...new Set([...noLunchChallenges, ...missedClockIns].map((row) => row.shift_id).filter((value): value is string => Boolean(value)))]
  );

  const items = [
    ...complianceFlags.rows.map((row) => buildComplianceFlagItem(row)),
    ...noLunchChallenges.map((row) =>
      buildAttendanceExceptionItem(row, "no_lunch_challenge", row.shift_id ? exceptionContexts.get(row.shift_id) ?? null : null)
    ),
    ...missedClockIns.map((row) =>
      buildAttendanceExceptionItem(row, "missed_clock_in_request", row.shift_id ? exceptionContexts.get(row.shift_id) ?? null : null)
    ),
    ...presenceIncidents.map((row) => buildPresenceIncidentItem(row)),
    ...manualAdjustments,
    ...mileageReviews
  ];

  return items.sort((left, right) => {
    const blockerOrder = getBlockerSortWeight(left) - getBlockerSortWeight(right);
    if (blockerOrder !== 0) {
      return blockerOrder;
    }
    const urgencyOrder = compareUrgency(left.urgency, right.urgency);
    if (urgencyOrder !== 0) {
      return urgencyOrder;
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function filterComplianceWorkspaceItems(
  items: ComplianceWorkspaceItem[],
  filters: {
    anchorDate: string;
    window?: ComplianceWorkspaceWindow;
    status?: "unresolved" | "resolved" | "all";
    employeeId?: string;
    organizationId?: string;
    shootId?: string;
    issueType?: ComplianceWorkspaceIssueType;
  }
) {
  return items.filter((item) => {
    if (!occursWithinWindow(item, filters.anchorDate, filters.window ?? "all")) {
      return false;
    }
    if (filters.status && filters.status !== "all" && item.status_bucket !== filters.status) {
      return false;
    }
    if (!includesText(item.employee_id, filters.employeeId)) {
      return false;
    }
    if (!includesText(item.organization_id, filters.organizationId)) {
      return false;
    }
    if (!includesText(item.shoot_id, filters.shootId)) {
      return false;
    }
    if (filters.issueType && item.issue_type !== filters.issueType) {
      return false;
    }
    return true;
  });
}

function buildFilterOptions(items: ComplianceWorkspaceItem[]) {
  const employees = new Map<string, string>();
  const organizations = new Map<string, string>();
  const shoots = new Map<string, string>();

  for (const item of items) {
    if (item.employee_id && item.employee_name) {
      employees.set(item.employee_id, item.employee_name);
    }
    if (item.organization_id && item.organization_display_name) {
      organizations.set(item.organization_id, item.organization_display_name);
    }
    if (item.shoot_id && (item.shoot_title || item.shoot_code)) {
      shoots.set(item.shoot_id, item.shoot_title ?? item.shoot_code ?? item.shoot_id);
    }
  }

  return {
    employees: [...employees.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    organizations: [...organizations.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    shoots: [...shoots.entries()]
      .map(([id, title]) => ({ id, title }))
      .sort((left, right) => left.title.localeCompare(right.title)),
    issue_types: (Object.entries(ISSUE_LABELS) as Array<[ComplianceWorkspaceIssueType, string]>).map(([id, label]) => ({
      id,
      label
    }))
  };
}

function buildLatestTimestamp(items: ComplianceWorkspaceItem[], predicate?: (item: ComplianceWorkspaceItem) => boolean) {
  let latest: string | null = null;
  for (const item of items) {
    if (predicate && !predicate(item)) {
      continue;
    }
    const candidate = item.updated_at || item.occurred_at;
    if (!latest || new Date(candidate).getTime() > new Date(latest).getTime()) {
      latest = candidate;
    }
  }
  return latest;
}

function buildComplianceWorkspaceDeepLinks(item: ComplianceWorkspaceItem): ComplianceWorkspaceDeepLink[] {
  const links: ComplianceWorkspaceDeepLink[] = [{ id: "compliance", label: "Open Compliance Workspace", hash: "#employees/compliance" }];

  const addLink = (id: string, label: string, hash: string) => {
    if (!links.some((entry) => entry.id === id)) {
      links.push({ id, label, hash });
    }
  };

  if (
    item.issue_type === "missed_clock_in_request" ||
    item.issue_type === "no_lunch_challenge" ||
    item.issue_type === "likely_present_missing_clock_in" ||
    item.issue_type === "assigned_but_missing"
  ) {
    addLink("attendance", "Open Attendance", "#operations/attendance");
  }

  if (item.payroll_blocking || item.unresolved_end_of_day_confirmation || item.mileage_blocking) {
    addLink("payroll_review", "Open Payroll Review", "#employees/payroll");
  }

  if (item.shift_id || item.employee_id) {
    addLink("employees", "Open Employees Workspace", "#employees");
  }

  return links;
}

function buildComplianceWorkspaceAvailableActions(item: ComplianceWorkspaceItem): ComplianceWorkspaceAvailableAction[] {
  const actions: ComplianceWorkspaceAvailableAction[] = [];

  const addAction = (action: ComplianceWorkspaceAvailableAction) => {
    if (!actions.some((candidate) => candidate.id === action.id && candidate.hash === action.hash)) {
      actions.push(action);
    }
  };

  if (item.status_bucket !== "resolved") {
    if (item.issue_type === "missed_clock_in_request") {
      addAction({ id: "approve_missed_clock_in", label: "Approve missed clock-in request", kind: "review", hash: null });
      addAction({ id: "reject_missed_clock_in", label: "Reject missed clock-in request", kind: "review", hash: null });
    }
    if (item.issue_type === "no_lunch_challenge") {
      addAction({ id: "approve_no_lunch", label: "Approve no-lunch challenge", kind: "review", hash: null });
      addAction({ id: "reject_no_lunch", label: "Reject no-lunch challenge", kind: "review", hash: null });
    }
    if (item.issue_type === "assigned_but_missing" || item.issue_type === "likely_present_missing_clock_in") {
      addAction({
        id: "escalate_attendance",
        label: "Escalate in Attendance",
        kind: "escalate",
        hash: "#operations/attendance"
      });
    }
  }

  addAction({
    id: `open_${item.blocker.owning_workspace_hash.replace(/[^a-z]/gi, "_").replace(/^_+|_+$/g, "")}`,
    label: `Open ${item.blocker.owning_workspace_label}`,
    kind: "drill_out",
    hash: item.blocker.owning_workspace_hash
  });
  addAction({ id: "open_compliance", label: "Open Compliance Workspace", kind: "drill_out", hash: "#employees/compliance" });

  return actions;
}

async function loadAttendanceHistory(client: PoolClient, tenantId: string, shiftId: string | null) {
  if (!shiftId) {
    return [];
  }

  const { rows } = await client.query<ComplianceWorkspaceAttendanceHistoryRow>(
    `
      SELECT
        history.id,
        history.event_type::text AS event_type,
        history.from_state::text AS from_state,
        history.to_state::text AS to_state,
        history.signal_source::text AS signal_source,
        history.note,
        history.created_at::text,
        actor.full_name AS actor_user_name
      FROM shift_attendance_history history
      LEFT JOIN app_user actor
        ON actor.tenant_id = history.tenant_id
       AND actor.id = history.actor_user_id
      WHERE history.tenant_id = $1
        AND history.shift_id = $2::uuid
      ORDER BY history.created_at DESC
      LIMIT 12
    `,
    [tenantId, shiftId]
  );

  return rows;
}

function buildComplianceWorkspaceHistory(input: {
  item: ComplianceWorkspaceItem;
  attendanceHistory: ComplianceWorkspaceAttendanceHistoryRow[];
  correctionRequest: ComplianceWorkspaceDetailPayload["linked_records"]["correction_request"];
  postShootEvaluation: ComplianceWorkspaceDetailPayload["linked_records"]["post_shoot_evaluation"];
  resourceUploads: ComplianceWorkspaceDetailPayload["linked_records"]["resource_uploads"];
  presenceIncident: ComplianceWorkspaceDetailPayload["linked_records"]["presence_incident"];
}) {
  const history: ComplianceWorkspaceHistoryEntry[] = [
    {
      id: `${input.item.id}:opened`,
      occurred_at: input.item.occurred_at,
      source_label: "Compliance",
      title: `${input.item.issue_label} detected`,
      summary: input.item.message,
      actor_name: null,
      tone: input.item.urgency === "urgent" ? "critical" : input.item.urgency === "important" ? "warning" : "info"
    }
  ];

  if (input.item.updated_at && input.item.updated_at !== input.item.occurred_at) {
    history.push({
      id: `${input.item.id}:updated`,
      occurred_at: input.item.updated_at,
      source_label: "Compliance",
      title: "Issue updated",
      summary: input.item.resolution_note ?? "Issue metadata or linked context changed.",
      actor_name: null,
      tone: "info"
    });
  }

  if (input.item.resolved_at) {
    history.push({
      id: `${input.item.id}:resolved`,
      occurred_at: input.item.resolved_at,
      source_label: "Compliance",
      title: "Issue resolved",
      summary: input.item.resolution_note ?? "This issue is no longer unresolved.",
      actor_name: null,
      tone: "success"
    });
  }

  for (const row of input.attendanceHistory) {
    const stateSummary =
      row.to_state && row.from_state
        ? `${humanizeLabel(row.from_state)} -> ${humanizeLabel(row.to_state)}`
        : row.to_state
          ? humanizeLabel(row.to_state)
          : row.note ?? null;
    history.push({
      id: `attendance:${row.id}`,
      occurred_at: row.created_at,
      source_label: "Attendance",
      title: humanizeLabel(row.event_type),
      summary: stateSummary,
      actor_name: row.actor_user_name,
      tone: row.to_state === "resolved" ? "success" : row.to_state === "no_show_suspected" ? "critical" : "neutral"
    });
  }

  if (input.correctionRequest) {
    history.push({
      id: `correction:${input.correctionRequest.id}:submitted`,
      occurred_at: input.correctionRequest.submitted_at,
      source_label: "Correction Request",
      title: humanizeLabel(input.correctionRequest.request_type),
      summary: input.correctionRequest.note ?? "Correction request submitted for review.",
      actor_name: null,
      tone: "warning"
    });

    for (const record of input.correctionRequest.approval_records) {
      history.push({
        id: `approval:${record.id}`,
        occurred_at: record.decided_at,
        source_label: "Approval",
        title: humanizeLabel(record.decision),
        summary: record.comment ?? `${humanizeLabel(record.approver_role)} decision recorded.`,
        actor_name: record.approver_name,
        tone: record.decision === "approved" ? "success" : record.decision === "rejected" ? "critical" : "neutral"
      });
    }
  }

  if (input.postShootEvaluation) {
    history.push({
      id: `evaluation:${input.postShootEvaluation.id}`,
      occurred_at: input.postShootEvaluation.submitted_at,
      source_label: "Post-Shoot Evaluation",
      title: "Evaluation submitted",
      summary: input.postShootEvaluation.overall_shoot_status ?? "Shoot closeout submitted.",
      actor_name: input.postShootEvaluation.photographer_name,
      tone: input.postShootEvaluation.issue_flag ? "warning" : "success"
    });
  }

  for (const upload of input.resourceUploads.slice(0, 6)) {
    history.push({
      id: `upload:${upload.id}`,
      occurred_at: upload.captured_at ?? upload.created_at,
      source_label: "Resource Upload",
      title: upload.file_name,
      summary: upload.note ?? humanizeLabel(upload.category),
      actor_name: upload.uploader_name,
      tone: upload.issue_type ? "warning" : "neutral"
    });
  }

  if (input.presenceIncident) {
    history.push({
      id: `presence:${input.presenceIncident.id}:observed`,
      occurred_at: input.presenceIncident.last_observed_at,
      source_label: "Presence",
      title: humanizeLabel(input.presenceIncident.alert_type),
      summary: humanizeLabel(input.presenceIncident.geofence_classification),
      actor_name: null,
      tone: input.presenceIncident.alert_type === "assigned_but_missing" ? "critical" : "warning"
    });

    if (input.presenceIncident.last_notified_at) {
      history.push({
        id: `presence:${input.presenceIncident.id}:notified`,
        occurred_at: input.presenceIncident.last_notified_at,
        source_label: "Presence",
        title: "Leadership notified",
        summary: "Presence escalation notification was sent for follow-up.",
        actor_name: null,
        tone: "info"
      });
    }
  }

  return history.sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime());
}

export async function listComplianceWorkspaceItems(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    date?: string;
    window?: ComplianceWorkspaceWindow;
    status?: "unresolved" | "resolved" | "all";
    employeeId?: string;
    organizationId?: string;
    shootId?: string;
    issueType?: ComplianceWorkspaceIssueType;
  } = {}
): Promise<ComplianceWorkspaceListPayload> {
  const anchorDate = filters.date ?? getLocalDateString();
  const allItems = await listComplianceWorkspaceSourceRows(client, auth, { shootId: filters.shootId });
  const filteredItems = filterComplianceWorkspaceItems(allItems, {
    anchorDate,
    window: filters.window ?? "all",
    status: filters.status ?? "all",
    employeeId: filters.employeeId,
    organizationId: filters.organizationId,
    shootId: filters.shootId,
    issueType: filters.issueType
  });

  const unresolvedItems = filteredItems.filter((item) => item.status_bucket === "unresolved");
  const countsByIssue = emptyIssueCounts();
  const countsByUrgency = emptyUrgencyCounts();
  for (const item of unresolvedItems) {
    countsByIssue[item.issue_type] += 1;
    countsByUrgency[item.urgency] += 1;
  }

  const { start: anchorDayStart, endExclusive: anchorDayEndExclusive } = getLocalDayBounds(anchorDate);
  const linkedCategories = await loadLinkedLaborCategories(client, auth.tenantId);

  return {
    summary: {
      open_count: unresolvedItems.length,
      payroll_blocking_count: unresolvedItems.filter((item) => item.payroll_blocking).length,
      mileage_blocking_count: unresolvedItems.filter((item) => item.mileage_blocking).length,
      missing_closeout_count: unresolvedItems.filter((item) => item.missing_closeout).length,
      unresolved_end_of_day_confirmation_count: unresolvedItems.filter((item) => item.unresolved_end_of_day_confirmation).length,
      missed_clock_in_review_count: unresolvedItems.filter((item) => item.issue_type === "missed_clock_in_request").length,
      no_lunch_review_count: unresolvedItems.filter((item) => item.issue_type === "no_lunch_challenge").length,
      off_clock_upload_review_count: unresolvedItems.filter((item) => item.issue_type === "upload_while_off_clock").length,
      presence_incident_review_count: unresolvedItems.filter(
        (item) => item.issue_type === "likely_present_missing_clock_in" || item.issue_type === "assigned_but_missing"
      ).length,
      needs_manager_review_count: unresolvedItems.filter((item) => MANAGER_REVIEW_ISSUE_TYPES.has(item.issue_type)).length,
      needs_employee_correction_count: unresolvedItems.filter((item) => EMPLOYEE_CORRECTION_ISSUE_TYPES.has(item.issue_type)).length,
      overdue_count: unresolvedItems.filter((item) => occursWithinWindow(item, anchorDate, "overdue")).length,
      resolved_today_count: filteredItems.filter((item) => {
        if (item.status_bucket !== "resolved" || !item.resolved_at) {
          return false;
        }
        const resolvedAt = new Date(item.resolved_at);
        return resolvedAt >= anchorDayStart && resolvedAt < anchorDayEndExclusive;
      }).length,
      counts_by_issue_type: countsByIssue,
      counts_by_urgency: countsByUrgency
    },
    linked_categories: linkedCategories,
    freshness: {
      generated_at: new Date().toISOString(),
      latest_item_updated_at: buildLatestTimestamp(filteredItems),
      latest_unresolved_item_updated_at: buildLatestTimestamp(filteredItems, (item) => item.status_bucket === "unresolved")
    },
    filters: buildFilterOptions(allItems),
    rows: filteredItems
  };
}

async function loadShiftRecord(client: PoolClient, tenantId: string, shiftId: string | null) {
  if (!shiftId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspaceShiftDetail>(
    `
      SELECT
        ws.id,
        ws.title,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.attendance_state::text AS attendance_state,
        ws.manager_user_id,
        manager.full_name AS manager_name,
        ws.location_name,
        ws.location_address,
        ws.navigation_url
      FROM work_shift ws
      LEFT JOIN app_user manager
        ON manager.tenant_id = ws.tenant_id
       AND manager.id = ws.manager_user_id
      WHERE ws.tenant_id = $1
        AND ws.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, shiftId]
  );

  return rows[0] ?? null;
}

async function loadShootRecord(client: PoolClient, tenantId: string, shootId: string | null) {
  if (!shootId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspaceShootDetail>(
    `
      SELECT
        s.id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        s.showtime::text,
        s.start_time::text,
        s.end_time_est::text AS estimated_end_time,
        s.status::text
      FROM shoot s
      WHERE s.tenant_id = $1
        AND s.id = $2::uuid
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId]
  );

  return rows[0] ?? null;
}

async function loadOrganizationRecord(client: PoolClient, tenantId: string, organizationId: string | null) {
  if (!organizationId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspaceOrganizationDetail>(
    `
      SELECT id, display_name
      FROM organization
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, organizationId]
  );

  return rows[0] ?? null;
}

async function loadLocationRecord(client: PoolClient, tenantId: string, locationId: string | null) {
  if (!locationId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspaceLocationDetail>(
    `
      SELECT
        id,
        name,
        COALESCE(
          NULLIF(trim(concat_ws(', ', address_line_1, address_line_2, concat_ws(', ', city, state), zip)), ''),
          address
        ) AS address,
        navigation_url AS maps_url
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, locationId]
  );

  return rows[0] ?? null;
}

async function loadCorrectionRequestRecord(client: PoolClient, tenantId: string, requestId: string | null) {
  if (!requestId) {
    return null;
  }

  const { rows } = await client.query<{
    id: string;
    request_type: string;
    status: string;
    submitted_at: string;
    reviewed_at: string | null;
    requested_state: string | null;
    requested_start_time: string | null;
    requested_end_time: string | null;
    note: string | null;
    reporting_flags: string[] | null;
    original_values: Record<string, unknown> | null;
    resolved_values: Record<string, unknown> | null;
    requested_approver_id: string | null;
    requested_approver_name: string | null;
    reviewed_by_id: string | null;
    reviewed_by_name: string | null;
    approval_records: Array<{
      id: string;
      approver_id: string;
      approver_name: string | null;
      approver_role: string;
      decision: string;
      comment: string | null;
      decided_at: string;
    }> | null;
  }>(
    `
      SELECT
        er.id,
        er.request_type::text,
        er.status::text,
        er.submitted_at::text,
        er.reviewed_at::text,
        er.requested_state::text,
        er.requested_start_time::text,
        er.requested_end_time::text,
        NULLIF(er.note, '') AS note,
        er.reporting_flags,
        er.original_values,
        er.resolved_values,
        er.requested_approver_id,
        requested_approver.full_name AS requested_approver_name,
        er.reviewed_by AS reviewed_by_id,
        reviewer.full_name AS reviewed_by_name,
        COALESCE(approval_records.records, '[]'::json) AS approval_records
      FROM exception_request er
      LEFT JOIN app_user requested_approver
        ON requested_approver.tenant_id = er.tenant_id
       AND requested_approver.id = er.requested_approver_id
      LEFT JOIN app_user reviewer
        ON reviewer.tenant_id = er.tenant_id
       AND reviewer.id = er.reviewed_by
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', ar.id,
            'approver_id', ar.approver_id,
            'approver_name', approver.full_name,
            'approver_role', ar.approver_role,
            'decision', ar.decision::text,
            'comment', ar.comment,
            'decided_at', ar.decided_at::text
          )
          ORDER BY ar.decided_at ASC
        ) AS records
        FROM approval_record ar
        LEFT JOIN app_user approver
          ON approver.tenant_id = ar.tenant_id
         AND approver.id = ar.approver_id
        WHERE ar.tenant_id = er.tenant_id
          AND ar.request_id = er.id
      ) approval_records ON true
      WHERE er.tenant_id = $1
        AND er.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, requestId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    ...row,
    reporting_flags: row.reporting_flags ?? [],
    original_values: row.original_values ?? {},
    resolved_values: row.resolved_values ?? {},
    approval_records: row.approval_records ?? []
  };
}

async function loadLatestPostShootEvaluationRecord(
  client: PoolClient,
  tenantId: string,
  input: { shiftId?: string | null; shootId?: string | null; employeeId?: string | null }
) {
  if (!input.shiftId && !input.shootId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspacePostShootEvaluationDetail>(
    `
      SELECT
        pse.id,
        pse.submitted_at::text,
        submitter.full_name AS photographer_name,
        pse.overall_shoot_status::text,
        pse.issue_flag,
        pse.went_well,
        pse.remember_next_time,
        pse.open_comment,
        pse.submit_for_mileage,
        pse.vehicle_type::text
      FROM post_shoot_evaluation pse
      LEFT JOIN app_user submitter
        ON submitter.tenant_id = pse.tenant_id
       AND submitter.id = pse.photographer_user_id
      WHERE pse.tenant_id = $1
        AND (($2::uuid IS NOT NULL AND pse.shift_id = $2::uuid) OR ($3::uuid IS NOT NULL AND pse.shoot_id = $3::uuid))
        AND ($4::uuid IS NULL OR pse.photographer_user_id = $4::uuid)
      ORDER BY pse.submitted_at DESC, pse.created_at DESC
      LIMIT 1
    `,
    [tenantId, input.shiftId ?? null, input.shootId ?? null, input.employeeId ?? null]
  );

  return rows[0] ?? null;
}

async function loadResourceUploadRecords(
  client: PoolClient,
  tenantId: string,
  input: { shootId?: string | null; organizationId?: string | null; locationId?: string | null; employeeId?: string | null }
) {
  if (!input.shootId && !input.organizationId && !input.locationId) {
    return [];
  }

  const { rows } = await client.query<ComplianceWorkspaceDetailPayload["linked_records"]["resource_uploads"][number]>(
    `
      SELECT
        r.id,
        r.file_name,
        r.category::text AS category,
        r.approval_status::text AS approval_status,
        r.visibility_scope::text AS visibility_scope,
        r.note,
        r.issue_type::text AS issue_type,
        r.upload_source,
        COALESCE(u.full_name, r.uploader_name) AS uploader_name,
        r.captured_at::text,
        r.created_at::text,
        r.file_url
      FROM resource_library_item r
      LEFT JOIN app_user u
        ON u.tenant_id = r.tenant_id
       AND u.id = r.uploader_user_id
      WHERE r.tenant_id = $1
        AND (
          ($2::uuid IS NOT NULL AND r.shoot_id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND r.organization_id = $3::uuid)
          OR ($4::uuid IS NOT NULL AND r.location_id = $4::uuid)
        )
        AND ($5::uuid IS NULL OR r.uploader_user_id = $5::uuid)
      ORDER BY COALESCE(r.captured_at, r.created_at) DESC, r.created_at DESC
      LIMIT 12
    `,
    [tenantId, input.shootId ?? null, input.organizationId ?? null, input.locationId ?? null, input.employeeId ?? null]
  );

  return rows;
}

async function loadPresenceIncidentRecord(client: PoolClient, tenantId: string, incidentId: string | null) {
  if (!incidentId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspacePresenceIncidentDetail>(
    `
      SELECT
        id,
        alert_type::text AS alert_type,
        current_state::text AS current_state,
        geofence_classification::text AS geofence_classification,
        repeat_count,
        last_observed_at::text,
        last_notified_at::text,
        resolution_status::text AS resolution_status,
        resolved_at::text,
        resolution_reason
      FROM time_clock_presence_incident
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [tenantId, incidentId]
  );

  return rows[0] ?? null;
}

async function loadLinkedTimeSessionRecord(
  client: PoolClient,
  tenantId: string,
  input: { sessionId?: string | null; employeeId?: string | null; shiftId?: string | null }
) {
  if (!input.sessionId && !(input.employeeId && input.shiftId)) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspaceTimeSessionRow>(
    `
      SELECT
        ts.id,
        ts.work_date::text,
        ts.status::text AS status
      FROM time_session ts
      WHERE ts.tenant_id = $1
        AND (
          ($2::uuid IS NOT NULL AND ts.id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND $4::uuid IS NOT NULL AND ts.employee_id = $3::uuid AND ts.source_shift_id = $4::uuid)
        )
      ORDER BY
        CASE WHEN $2::uuid IS NOT NULL AND ts.id = $2::uuid THEN 0 ELSE 1 END,
        CASE ts.status
          WHEN 'open' THEN 0
          WHEN 'needs_end_of_day_confirmation' THEN 1
          WHEN 'closed' THEN 2
          ELSE 3
        END,
        ts.created_at DESC
      LIMIT 1
    `,
    [tenantId, input.sessionId ?? null, input.employeeId ?? null, input.shiftId ?? null]
  );

  return rows[0] ?? null;
}

async function loadPayrollImpactRecord(client: PoolClient, tenantId: string, sessionId: string | null) {
  if (!sessionId) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspacePayrollImpactRow>(
    `
      SELECT
        ts.id AS session_id,
        ts.work_date::text AS work_date,
        ts.status::text AS session_status,
        ps.payable_minutes,
        ps.lunch_challenge_status::text AS lunch_challenge_status,
        ps.manual_correction_count,
        ps.missed_clock_in_approval_count
      FROM time_session ts
      LEFT JOIN time_session_payroll_summary ps
        ON ps.tenant_id = ts.tenant_id
       AND ps.session_id = ts.id
      WHERE ts.tenant_id = $1
        AND ts.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, sessionId]
  );

  return rows[0] ?? null;
}

async function loadMileageImpactRecord(
  client: PoolClient,
  tenantId: string,
  input: { shiftId?: string | null; shootId?: string | null; employeeId?: string | null; workDate?: string | null }
) {
  if (!input.shiftId && !input.shootId && !(input.employeeId && input.workDate)) {
    return null;
  }

  const { rows } = await client.query<ComplianceWorkspaceMileageImpactRow>(
    `
      SELECT
        mr.id,
        mr.work_date::text,
        mr.status::text AS status,
        mr.review_reason_code::text AS review_reason_code,
        mr.reimbursement_amount::text AS reimbursement_amount,
        mr.zone_name,
        mr.vehicle_type::text AS vehicle_type,
        source.submit_for_mileage
      FROM mileage_reimbursement mr
      LEFT JOIN LATERAL (
        SELECT mrs.submit_for_mileage
        FROM mileage_reimbursement_source mrs
        WHERE mrs.reimbursement_id = mr.id
        ORDER BY
          CASE
            WHEN mrs.eligible_for_selection THEN 0
            ELSE 1
          END,
          mrs.created_at DESC
        LIMIT 1
      ) source
        ON true
      WHERE mr.tenant_id = $1
        AND (
          ($2::uuid IS NOT NULL AND mr.linked_shift_id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND mr.linked_shoot_id = $3::uuid)
          OR ($4::uuid IS NOT NULL AND $5::date IS NOT NULL AND mr.employee_id = $4::uuid AND mr.work_date = $5::date)
        )
      ORDER BY
        CASE
          WHEN $2::uuid IS NOT NULL AND mr.linked_shift_id = $2::uuid THEN 0
          WHEN $3::uuid IS NOT NULL AND mr.linked_shoot_id = $3::uuid THEN 1
          ELSE 2
        END,
        mr.work_date DESC,
        mr.created_at DESC
      LIMIT 1
    `,
    [tenantId, input.shiftId ?? null, input.shootId ?? null, input.employeeId ?? null, input.workDate ?? null]
  );

  return rows[0] ?? null;
}

function buildComplianceWorkspacePayrollImpact(
  item: ComplianceWorkspaceItem,
  session: ComplianceWorkspaceTimeSessionRow | null,
  payrollImpact: ComplianceWorkspacePayrollImpactRow | null
): ComplianceWorkspacePayrollImpact {
  return {
    blocked: item.payroll_blocking,
    reason: item.payroll_blocking ? item.blocker.summary : null,
    session_id: payrollImpact?.session_id ?? session?.id ?? item.session_id,
    work_date: payrollImpact?.work_date ?? session?.work_date ?? null,
    session_status: payrollImpact?.session_status ?? session?.status ?? null,
    payable_minutes: payrollImpact?.payable_minutes ?? null,
    lunch_challenge_status: payrollImpact?.lunch_challenge_status ?? null,
    manual_correction_count: payrollImpact?.manual_correction_count ?? null,
    missed_clock_in_approval_count: payrollImpact?.missed_clock_in_approval_count ?? null
  };
}

// SSA-3 nuance: a photographer's explicit "not eligible" answer (status ineligible, reason
// submit_declined — set in-form or via POST /api/post-shoot/mileage-eligibility) must read as a
// DECISION, not as a problem to chase. NOTE: a true "eval submitted, answer still pending" state
// does not exist in canonical data today — the eval form always records an answer at submission
// (submit_for_mileage defaults to false); making the answer deferrable is the mobile UI slice.
function mileageReasonLabel(row: ComplianceWorkspaceMileageImpactRow): string | null {
  if (!row.review_reason_code) {
    return null;
  }
  if (row.review_reason_code === "submit_declined") {
    return "Mileage declined by the photographer for this shoot";
  }
  if (row.review_reason_code === "missing_post_shoot_evaluation") {
    return "Blocked — post-shoot evaluation not submitted";
  }
  return humanizeLabel(row.review_reason_code);
}

function buildComplianceWorkspaceMileageImpact(
  item: ComplianceWorkspaceItem,
  mileageImpact: ComplianceWorkspaceMileageImpactRow | null
): ComplianceWorkspaceMileageImpact {
  return {
    blocked: item.mileage_blocking,
    reason: item.mileage_blocking ? (mileageImpact ? mileageReasonLabel(mileageImpact) : null) ?? item.blocker.summary : null,
    reimbursement_id: mileageImpact?.id ?? null,
    work_date: mileageImpact?.work_date ?? null,
    status: mileageImpact?.status ?? null,
    review_reason_code: mileageImpact?.review_reason_code ?? null,
    review_reason_label: mileageImpact ? mileageReasonLabel(mileageImpact) : null,
    issue_label: mileageImpact ? mileageReasonLabel(mileageImpact) : null,
    reimbursement_amount: mileageImpact?.reimbursement_amount ?? null,
    zone_name: mileageImpact?.zone_name ?? null,
    vehicle_type: mileageImpact?.vehicle_type ?? null,
    submit_for_mileage: mileageImpact?.submit_for_mileage ?? null
  };
}

export async function getComplianceWorkspaceItemDetail(
  client: PoolClient,
  auth: AuthUser,
  input: {
    sourceKind: ComplianceWorkspaceSourceKind;
    sourceId: string;
  }
): Promise<ComplianceWorkspaceDetailPayload | null> {
  const items = await listComplianceWorkspaceSourceRows(client, auth);
  const item =
    items.find((candidate) => candidate.source_kind === input.sourceKind && candidate.source_id === input.sourceId) ?? null;

  if (!item) {
    return null;
  }

  const linkedSession = await loadLinkedTimeSessionRecord(client, auth.tenantId, {
    sessionId: item.session_id,
    employeeId: item.employee_id,
    shiftId: item.shift_id
  });
  const shift = await loadShiftRecord(client, auth.tenantId, item.shift_id);
  const shoot = await loadShootRecord(client, auth.tenantId, item.shoot_id);
  const organization = await loadOrganizationRecord(client, auth.tenantId, item.organization_id);
  const location = await loadLocationRecord(client, auth.tenantId, item.location_id);
  const correctionRequest = await loadCorrectionRequestRecord(client, auth.tenantId, item.linked_exception_request_id);
  const postShootEvaluation = await loadLatestPostShootEvaluationRecord(client, auth.tenantId, {
    shiftId: item.shift_id,
    shootId: item.shoot_id,
    employeeId: item.employee_id
  });
  const resourceUploads = await loadResourceUploadRecords(client, auth.tenantId, {
    shootId: item.shoot_id,
    organizationId: item.organization_id,
    locationId: item.location_id,
    employeeId: item.employee_id
  });
  const presenceIncident =
    input.sourceKind === "presence_incident" ? await loadPresenceIncidentRecord(client, auth.tenantId, input.sourceId) : null;
  const attendanceHistory = await loadAttendanceHistory(client, auth.tenantId, item.shift_id);

  const payrollImpactRow = await loadPayrollImpactRecord(client, auth.tenantId, linkedSession?.id ?? item.session_id);
  const mileageImpactRow = await loadMileageImpactRecord(client, auth.tenantId, {
    shiftId: item.shift_id,
    shootId: item.shoot_id,
    employeeId: item.employee_id,
    workDate: linkedSession?.work_date ?? null
  });

  const history = buildComplianceWorkspaceHistory({
    item,
    attendanceHistory,
    correctionRequest,
    postShootEvaluation,
    resourceUploads,
    presenceIncident
  });

  return {
    item,
    available_actions: buildComplianceWorkspaceAvailableActions(item),
    deep_links: buildComplianceWorkspaceDeepLinks(item),
    history,
    payroll_impact: buildComplianceWorkspacePayrollImpact(item, linkedSession, payrollImpactRow),
    mileage_impact: buildComplianceWorkspaceMileageImpact(item, mileageImpactRow),
    linked_records: {
      shift,
      shoot,
      organization,
      location,
      correction_request: correctionRequest,
      post_shoot_evaluation: postShootEvaluation,
      resource_uploads: resourceUploads,
      presence_incident: presenceIncident
    }
  };
}
