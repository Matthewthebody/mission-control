import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { getLocalDateString } from "../utils/localDate.js";
import { listPTORequests } from "./availabilityRequests.js";
import { listEmployeeMyWork } from "./employeeExperience.js";
import { canViewOperationalApprovals, listOperationalApprovalWorkspace } from "./operationalApprovals.js";
import { listTradeRequests } from "./scheduling.js";
import { getTrainingDashboard, listTrainingSummaries } from "./training.js";
import { getTimeClockShellControlState } from "./timeClockRuntime.js";

export type EmployeesWorkspaceTone = "neutral" | "info" | "success" | "warning" | "critical";

export type EmployeesWorkspaceSummaryCard = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: EmployeesWorkspaceTone;
  action_hash: string;
};

export type EmployeesWorkspaceHighlight = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  status_label: string;
  tone: EmployeesWorkspaceTone;
  action_hash: string;
};

export type EmployeesWorkspaceModule = {
  visible: boolean;
  headline: string;
  summary_line: string;
  cards: EmployeesWorkspaceSummaryCard[];
  highlights: EmployeesWorkspaceHighlight[];
  primary_action_hash: string;
  primary_action_label: string;
  secondary_action_hash: string | null;
  secondary_action_label: string | null;
};

export type EmployeesWorkspaceTimeBand = {
  visible: boolean;
  headline: string;
  state: "action_needed" | "active" | "ended_today" | "needs_review" | "off_shift";
  emphasis: "red" | "green" | "amber" | "neutral";
  label: string;
  summary_line: string;
  helper_text: string;
  elapsed_label: string | null;
  shift_label: string | null;
  location_label: string | null;
  review_label: string | null;
  action_hash: string;
  action_label: string;
  schedule_hash: string | null;
  secondary_action_hash: string | null;
  secondary_action_label: string | null;
  metrics: EmployeesWorkspaceSummaryCard[];
};

export type EmployeesWorkspaceRecord = {
  visible: boolean;
  headline: string;
  summary_line: string;
  items: Array<{ label: string; value: string }>;
  links: Array<{ label: string; action_hash: string }>;
};

export type EmployeesWorkspaceRoleMode = "employee" | "manager" | "admin";

export type EmployeesWorkspaceResponse = {
  generated_at: string;
  anchor_date: string;
  refresh_interval_seconds: number;
  role_mode: EmployeesWorkspaceRoleMode;
  summary_strip: EmployeesWorkspaceSummaryCard[];
  my_work: EmployeesWorkspaceModule | null;
  time_pay: EmployeesWorkspaceTimeBand | null;
  requests_approvals: EmployeesWorkspaceModule | null;
  training_readiness: EmployeesWorkspaceModule | null;
  record: EmployeesWorkspaceRecord | null;
};

type EmployeesWorkspaceSummaryInputs = {
  roleMode: EmployeesWorkspaceRoleMode;
  requestActionCount: number;
  approvalActionCount: number;
  openTimeReviewCount: number;
  trainingDueCount: number;
  signoffDueCount: number;
  availabilityConflictCount: number;
  timeStatusLabel: string;
};

type EmployeesWorkspaceRequestSummary = {
  openRequestCount: number;
  awaitingDecisionCount: number;
  availabilityConflictCount: number;
  cards: EmployeesWorkspaceSummaryCard[];
  highlights: EmployeesWorkspaceHighlight[];
  summaryLine: string;
};

type EmployeesWorkspaceTrainingSummary = {
  trainingDueCount: number;
  signoffDueCount: number;
  cards: EmployeesWorkspaceSummaryCard[];
  highlights: EmployeesWorkspaceHighlight[];
  summaryLine: string;
};

function hasAnyPermission(auth: Pick<AuthUser, "permissions">, codes: string[]) {
  return codes.some((code) => auth.permissions.includes(code));
}

export function canViewEmployeesWorkspace(auth: AuthUser) {
  return (
    auth.status === "active" &&
    (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer", "supervisor"]) ||
      hasAnyPermission(auth, [
        "dashboard.read",
        "schedule.read",
        "time.clock",
        "pto.request",
        "trade.request",
        "pto.approve",
        "trade.approve",
        "approval.read",
        "training.view",
        "certifications.view",
        "labor.read",
        "reports.view",
        "attendance.read",
        "people_ops.view",
        "requests.view",
        "approvals.view"
      ]))
  );
}

export function getEmployeesWorkspaceRoleMode(auth: Pick<AuthUser, "authorityTier" | "permissions">): EmployeesWorkspaceRoleMode {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return "admin";
  }
  if (
    hasAuthorityTier(auth, "supervisor") ||
    hasAnyPermission(auth, ["pto.approve", "trade.approve", "attendance.manage", "labor.read", "reports.view"])
  ) {
    return "manager";
  }
  return "employee";
}

function humanizeLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function mapStatusTone(count: number, criticalThreshold = 1, warningThreshold = 1): EmployeesWorkspaceTone {
  if (count >= criticalThreshold && criticalThreshold > 0) {
    return "critical";
  }
  if (count >= warningThreshold && warningThreshold > 0) {
    return "warning";
  }
  return "success";
}

function mapTimeEmphasisToTone(emphasis: EmployeesWorkspaceTimeBand["emphasis"]): EmployeesWorkspaceTone {
  switch (emphasis) {
    case "red":
      return "critical";
    case "green":
      return "success";
    case "amber":
      return "warning";
    default:
      return "neutral";
  }
}

function buildTimePayStateLabel(input: {
  latestSessionStatus:
    | EmployeesWorkspaceTimeBand["state"]
    | "approved"
    | "payroll_exported"
    | "closed"
    | "open"
    | "needs_end_of_day_confirmation"
    | null;
  openReviewCount: number;
}) {
  if (input.openReviewCount > 0) {
    return input.openReviewCount === 1 ? "1 time review item open." : `${input.openReviewCount} time review items are open.`;
  }
  switch (input.latestSessionStatus) {
    case "needs_review":
      return "The latest time session still needs review.";
    case "needs_end_of_day_confirmation":
      return "The latest time session still needs end-of-day confirmation.";
    case "ended_today":
    case "closed":
      return "Today's time is closed but not yet finalized.";
    case "approved":
      return "The latest time session is approved.";
    case "payroll_exported":
      return "The latest approved time is already in payroll export.";
    case "active":
    case "open":
      return "A live time session is active right now.";
    default:
      return "No open time review items are currently stacked up.";
  }
}

export function buildEmployeesWorkspaceSummaryStrip(input: EmployeesWorkspaceSummaryInputs): EmployeesWorkspaceSummaryCard[] {
  return [
    {
      id: "requests_awaiting_action",
      label: input.roleMode === "employee" ? "My Requests" : "Requests Awaiting Action",
      count: input.requestActionCount,
      detail:
        input.requestActionCount > 0
          ? `${input.requestActionCount} request${input.requestActionCount === 1 ? "" : "s"} still need follow-through.`
          : "Requests look clear right now.",
      tone: mapStatusTone(input.requestActionCount, 2, 1),
      action_hash: "#employees/requests"
    },
    {
      id: "approvals_awaiting_me",
      label: "Approvals Awaiting Me",
      count: input.approvalActionCount,
      detail:
        input.approvalActionCount > 0
          ? `${input.approvalActionCount} approval${input.approvalActionCount === 1 ? "" : "s"} are sitting on you.`
          : "No approvals are waiting on you.",
      tone: mapStatusTone(input.approvalActionCount, 2, 1),
      action_hash: "#approvals"
    },
    {
      id: "time_review_status",
      label: "Time / Pay Review",
      count: input.openTimeReviewCount,
      detail: input.timeStatusLabel,
      tone: input.openTimeReviewCount > 0 ? "warning" : "info",
      action_hash: "#dashboard/my-day"
    },
    {
      id: "training_due",
      label: "Training Due",
      count: input.trainingDueCount,
      detail:
        input.trainingDueCount > 0
          ? `${input.trainingDueCount} training requirement${input.trainingDueCount === 1 ? "" : "s"} still need attention.`
          : "Training requirements look clear.",
      tone: mapStatusTone(input.trainingDueCount, 2, 1),
      action_hash: "#employees/training"
    },
    {
      id: "readiness_signoff",
      label: "Readiness / Signoff",
      count: input.signoffDueCount,
      detail:
        input.signoffDueCount > 0
          ? `${input.signoffDueCount} readiness signoff${input.signoffDueCount === 1 ? "" : "s"} still need clearance.`
          : "No readiness signoffs are waiting.",
      tone: mapStatusTone(input.signoffDueCount, 2, 1),
      action_hash: "#employees/readiness"
    },
    {
      id: "availability_conflicts",
      label: "Availability Conflicts",
      count: input.availabilityConflictCount,
      detail:
        input.availabilityConflictCount > 0
          ? `${input.availabilityConflictCount} availability conflict${input.availabilityConflictCount === 1 ? "" : "s"} may affect people follow-through.`
          : "No availability conflicts are currently stacked up.",
      tone: mapStatusTone(input.availabilityConflictCount, 2, 1),
      action_hash: "#employees/availability"
    }
  ];
}

function buildMyWorkModule(input: {
  roleMode: EmployeesWorkspaceRoleMode;
  myWork: Awaited<ReturnType<typeof listEmployeeMyWork>> | null;
}): EmployeesWorkspaceModule | null {
  if (!input.myWork) {
    return null;
  }

  const summary = input.myWork.summary;
  const cards: EmployeesWorkspaceSummaryCard[] = [
    {
      id: "my_work_today",
      label: "Today",
      count: summary.shifts_today,
      detail: summary.shifts_today ? "Published assignments are on your board." : "No shifts are published for today yet.",
      tone: summary.shifts_today > 0 ? "info" : "neutral",
      action_hash: "#dashboard/my-day"
    },
    {
      id: "my_work_next",
      label: "Up Next",
      count: summary.upcoming_shifts,
      detail: summary.next_shift_label ?? "Nothing is lined up after today yet.",
      tone: summary.upcoming_shifts > 0 ? "info" : "neutral",
      action_hash: "#schedule"
    },
    {
      id: "my_work_attention",
      label: "Needs Attention",
      count: summary.attention_needed_count,
      detail:
        summary.attention_needed_count > 0
          ? "Something in your work queue still needs action."
          : "Your immediate work queue looks clear.",
      tone: mapStatusTone(summary.attention_needed_count, 2, 1),
      action_hash: "#dashboard/my-day"
    }
  ];

  const highlights = input.myWork.shifts.slice(0, 3).map((shift) => ({
    id: shift.id,
    eyebrow: shift.shoot_code ?? humanizeLabel(shift.shift_kind),
    title: shift.title,
    summary: `${formatShortWindow(shift.starts_at, shift.ends_at)} | ${shift.location_name ?? shift.location_address ?? "Location pending"}`,
    status_label: shift.follow_through_label ?? shift.attendance_state_note ?? "Open My Day",
    tone: mapShiftTone(shift.attendance_state, shift.follow_through_tone),
    action_hash: "#dashboard/my-day"
  }));

  return {
    visible: true,
    headline: "My Work / My Day",
    summary_line:
      input.roleMode === "employee"
        ? "See today's assignment picture, what needs action next, and where to open the full employee work surface."
        : "Keep your own day legible here without collapsing Schedule and Scheduling back into one mixed page.",
    cards,
    highlights,
    primary_action_hash: "#dashboard/my-day",
    primary_action_label: "Open My Day",
    secondary_action_hash: "#schedule",
    secondary_action_label: "Open Schedule"
  };
}

function buildTimePayModule(input: {
  timeClockState: Awaited<ReturnType<typeof getTimeClockShellControlState>>;
  myWork: Awaited<ReturnType<typeof listEmployeeMyWork>> | null;
  canViewPayroll: boolean;
  canViewCompliance: boolean;
}): EmployeesWorkspaceTimeBand {
  const reviewCount = input.timeClockState.review.open_request_count + Number(input.myWork?.summary.late_or_exception_count ?? 0);
  const closeoutCount = Number(input.myWork?.summary.closeout_due_count ?? 0);
  const mileageReviewCount = Number(input.myWork?.summary.mileage_review_count ?? 0);
  const latestSessionStatus = input.timeClockState.latest_session?.session_status ?? input.timeClockState.state;
  return {
    visible: true,
    headline: "Time / Pay / Review",
    state: input.timeClockState.state,
    emphasis: input.timeClockState.emphasis,
    label: input.timeClockState.label,
    summary_line: buildTimePayStateLabel({
      latestSessionStatus,
      openReviewCount: reviewCount
    }),
    helper_text: input.timeClockState.helper_text,
    elapsed_label:
      input.timeClockState.latest_session && input.timeClockState.state === "active"
        ? `Live since ${new Date(input.timeClockState.latest_session.last_changed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : null,
    shift_label: input.timeClockState.active_shift?.title ?? input.timeClockState.next_shift?.title ?? null,
    location_label: input.timeClockState.active_shift?.location_name ?? input.timeClockState.next_shift?.location_name ?? null,
    review_label: input.timeClockState.review.label,
    action_hash: "#dashboard/my-day",
    action_label: "Open My Day",
    schedule_hash: "#schedule",
    secondary_action_hash: input.canViewPayroll ? "#employees/payroll" : input.canViewCompliance ? "#compliance" : null,
    secondary_action_label: input.canViewPayroll ? "Open Payroll Review" : input.canViewCompliance ? "Open Compliance" : null,
    metrics: [
      {
        id: "time_review_open",
        label: "Review Open",
        count: reviewCount,
        detail: reviewCount > 0 ? "Missed punch or review items still need follow-through." : "No open time review items are visible.",
        tone: mapStatusTone(reviewCount, 2, 1),
        action_hash: input.canViewCompliance ? "#compliance" : "#dashboard/my-day"
      },
      {
        id: "closeout_due",
        label: "Closeout Due",
        count: closeoutCount,
        detail: closeoutCount > 0 ? "Post-shift follow-through still needs to be logged." : "Closeout is clear right now.",
        tone: mapStatusTone(closeoutCount, 2, 1),
        action_hash: "#dashboard/my-day"
      },
      {
        id: "mileage_review",
        label: "Mileage Review",
        count: mileageReviewCount,
        detail: mileageReviewCount > 0 ? "Mileage or follow-through still needs review." : "Mileage review is clear right now.",
        tone: mapStatusTone(mileageReviewCount, 2, 1),
        action_hash: input.canViewPayroll ? "#employees/payroll" : "#dashboard/my-day"
      }
    ]
  };
}

function buildRequestsApprovalsSummary(input: {
  roleMode: EmployeesWorkspaceRoleMode;
  authUserId: string;
  approvals:
    | Awaited<ReturnType<typeof listOperationalApprovalWorkspace>>
    | null;
  ptoRequests: Awaited<ReturnType<typeof listPTORequests>>;
  tradeRequests: Awaited<ReturnType<typeof listTradeRequests>>;
}): EmployeesWorkspaceRequestSummary {
  const ptoAwaitingAction = input.ptoRequests.filter((item) => ["submitted", "needs_review"].includes(String(item.status)));
  const ptoRequestedByMe = input.ptoRequests.filter((item) => String(item.user_id) === input.authUserId);
  const ptoAwaitingMyDecision = ptoAwaitingAction.filter((item) => String(item.approver_user_id ?? "") === input.authUserId);
  const tradeAwaitingAction = input.tradeRequests.filter((item: any) => String(item.status) === "pending_manager");
  const tradePendingWithMe = input.tradeRequests.filter((item: any) =>
    ["pending_recipient", "pending_manager"].includes(String(item.status))
  );
  const tradeRequestedByMe = tradePendingWithMe.filter((item: any) => String(item.requester_user_id ?? "") === input.authUserId);
  const availabilityConflictCount =
    input.ptoRequests.filter(
      (item) =>
        ["high", "critical"].includes(String(item.warning_level)) || String(item.live_operational_absence_state) === "pending_coverage_review"
    ).length + input.tradeRequests.filter((item: any) => Boolean(item.requested_with_conflict)).length;

  const openRequestCount =
    input.roleMode === "employee" ? ptoRequestedByMe.length + tradeRequestedByMe.length : ptoAwaitingAction.length + tradePendingWithMe.length;
  const awaitingDecisionCount = (input.approvals?.summary.awaiting_my_decision ?? 0) + tradeAwaitingAction.length + ptoAwaitingMyDecision.length;

  const cards: EmployeesWorkspaceSummaryCard[] = [
    {
      id: "requests_open",
      label: input.roleMode === "employee" ? "My Open Requests" : "Request Pressure",
      count: openRequestCount,
      detail:
        openRequestCount > 0
          ? `${openRequestCount} request${openRequestCount === 1 ? "" : "s"} still need follow-through.`
          : "Request follow-through looks clear.",
      tone: mapStatusTone(openRequestCount, 2, 1),
      action_hash: "#employees/requests"
    },
    {
      id: "approvals_awaiting_me",
      label: "Awaiting My Approval",
      count: awaitingDecisionCount,
      detail:
        awaitingDecisionCount > 0
          ? `${awaitingDecisionCount} people-facing approval${awaitingDecisionCount === 1 ? "" : "s"} are still waiting on you.`
          : "No approvals are waiting on you.",
      tone: mapStatusTone(awaitingDecisionCount, 2, 1),
      action_hash: "#approvals"
    },
    {
      id: "availability_conflicts",
      label: "Availability Conflicts",
      count: availabilityConflictCount,
      detail:
        availabilityConflictCount > 0
          ? `${availabilityConflictCount} availability conflict${availabilityConflictCount === 1 ? "" : "s"} could affect follow-through.`
          : "Availability conflicts are quiet right now.",
      tone: mapStatusTone(availabilityConflictCount, 2, 1),
      action_hash: "#employees/availability"
    }
  ];

  const highlights: EmployeesWorkspaceHighlight[] = [];
  for (const approval of input.approvals?.awaiting_my_decision.slice(0, 2) ?? []) {
    highlights.push({
      id: approval.id,
      eyebrow: approval.request_type_label,
      title: approval.request_title,
      summary: approval.request_summary ?? approval.reason,
      status_label: approval.status_label,
      tone: approval.overdue || approval.blocking ? "critical" : approval.escalated ? "warning" : "info",
      action_hash: "#approvals"
    });
  }
  for (const request of ptoAwaitingAction.slice(0, Math.max(0, 3 - highlights.length))) {
    highlights.push({
      id: request.id,
      eyebrow: humanizeLabel(request.request_type),
      title: `${request.user_name ?? "Team member"} | ${request.starts_on}${request.ends_on !== request.starts_on ? ` - ${request.ends_on}` : ""}`,
      summary: request.reason ?? request.notes ?? "Availability request submitted.",
      status_label: humanizeLabel(request.status),
      tone: ["high", "critical"].includes(String(request.warning_level)) ? "critical" : "warning",
      action_hash: "#employees/requests"
    });
  }
  for (const request of tradePendingWithMe.slice(0, Math.max(0, 3 - highlights.length))) {
    highlights.push({
      id: String(request.id),
      eyebrow: "Shift Trade",
      title: String(request.shift_title ?? request.shoot_title ?? "Trade request"),
      summary: String(request.reason ?? "Shift trade still needs follow-through."),
      status_label: humanizeLabel(String(request.status ?? "pending")),
      tone: Boolean(request.requested_with_conflict) ? "critical" : "warning",
      action_hash: "#employees/requests"
    });
  }

  return {
    openRequestCount,
    awaitingDecisionCount,
    availabilityConflictCount,
    cards,
    highlights,
    summaryLine:
      awaitingDecisionCount > 0
        ? "Requests and people-facing approvals still need follow-through."
        : openRequestCount > 0
          ? "Your request queue still has active items."
          : "Requests, approvals, and availability follow-through look clear."
  };
}

function buildTrainingSummary(input: {
  roleMode: EmployeesWorkspaceRoleMode;
  dashboard: Awaited<ReturnType<typeof getTrainingDashboard>>;
  summaries: Awaited<ReturnType<typeof listTrainingSummaries>>;
}): EmployeesWorkspaceTrainingSummary {
  const signoffDueCount = input.summaries.filter((item) => item.needs_signoff).length;
  const dueCount =
    input.roleMode === "employee"
      ? input.summaries.reduce((sum, item) => sum + Number(item.overdue_module_count ?? 0), 0)
      : Number(input.dashboard.overdue_module_count ?? 0);

  const cards: EmployeesWorkspaceSummaryCard[] = [
    {
      id: "training_due",
      label: "Training Due",
      count: dueCount,
      detail:
        dueCount > 0
          ? `${dueCount} required training item${dueCount === 1 ? "" : "s"} still need attention.`
          : "Required training looks clear right now.",
      tone: mapStatusTone(dueCount, 2, 1),
      action_hash: "#employees/training"
    },
    {
      id: "readiness_not_cleared",
      label: "Not Cleared",
      count: Number(input.dashboard.not_cleared_count ?? 0),
      detail:
        Number(input.dashboard.not_cleared_count ?? 0) > 0
          ? `${Number(input.dashboard.not_cleared_count ?? 0)} employee${Number(input.dashboard.not_cleared_count ?? 0) === 1 ? "" : "s"} are not yet cleared.`
          : "Readiness is currently clear.",
      tone: mapStatusTone(Number(input.dashboard.not_cleared_count ?? 0), 2, 1),
      action_hash: "#employees/readiness"
    },
    {
      id: "signoff_due",
      label: "Signoffs Due",
      count: signoffDueCount,
      detail:
        signoffDueCount > 0
          ? `${signoffDueCount} readiness signoff${signoffDueCount === 1 ? "" : "s"} still need clearance.`
          : "No readiness signoffs are waiting.",
      tone: mapStatusTone(signoffDueCount, 2, 1),
      action_hash: "#employees/training"
    }
  ];

  const highlights: EmployeesWorkspaceHighlight[] = [];
  for (const record of input.dashboard.most_overdue_modules.slice(0, 2)) {
    highlights.push({
      id: `${record.employee_name}-${record.module_title}`,
      eyebrow: humanizeLabel(record.readiness_state),
      title: record.employee_name,
      summary: `${record.module_title} was due ${record.due_at.slice(0, 10)}.`,
      status_label: "Overdue",
      tone: "critical",
      action_hash: "#employees/training"
    });
  }
  for (const summary of input.summaries.filter((item) => item.needs_signoff).slice(0, Math.max(0, 3 - highlights.length))) {
    highlights.push({
      id: summary.identity.id,
      eyebrow: humanizeLabel(summary.readiness_state),
      title: summary.identity.full_name,
      summary: summary.next_module_title ? `Next up: ${summary.next_module_title}` : "Manager signoff is still required.",
      status_label: "Needs Signoff",
      tone: "warning",
      action_hash: "#employees/readiness"
    });
  }

  return {
    trainingDueCount: dueCount,
    signoffDueCount,
    cards,
    highlights,
    summaryLine:
      dueCount > 0 || signoffDueCount > 0
        ? "Training, readiness, and certification-adjacent signoffs still need follow-through."
        : "Training and readiness are clear right now."
  };
}

function buildRecordModule(input: { auth: AuthUser; canViewPayroll: boolean }): EmployeesWorkspaceRecord {
  return {
    visible: true,
    headline: "Personal / Employee Record",
    summary_line: "Keep profile basics and people-system links calm and secondary. This is record context, not an operations board.",
    items: [
      { label: "Name", value: input.auth.fullName },
      { label: "Email", value: input.auth.email },
      { label: "Department", value: humanizeLabel(input.auth.department) },
      {
        label: "Authority",
        value: humanizeLabel(input.auth.authorityTier)
      }
    ],
    links: [
      { label: "Open My Account", action_hash: "#account" },
      { label: "Open Schedule", action_hash: "#schedule" },
      ...(input.canViewPayroll ? [{ label: "Open Payroll Review", action_hash: "#employees/payroll" }] : [])
    ]
  };
}

function formatShortWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${end.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function mapShiftTone(attendanceState: string | null | undefined, followThroughTone: string | null | undefined): EmployeesWorkspaceTone {
  if (["missed_clock_in", "no_show_suspected"].includes(String(attendanceState ?? ""))) {
    return "critical";
  }
  if (["late_warning", "late", "missed_clock_out"].includes(String(attendanceState ?? ""))) {
    return "warning";
  }
  switch (String(followThroughTone ?? "")) {
    case "action_needed":
      return "critical";
    case "heads_up":
      return "warning";
    case "good":
      return "success";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

function canViewPayrollReview(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) || hasAnyPermission(auth, ["labor.read", "reports.view"]);
}

function canViewComplianceReview(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) || hasAnyPermission(auth, [
    "attendance.manage",
    "attendance_exceptions.approve",
    "missed_punches.approve",
    "compliance.view"
  ]);
}

export async function getEmployeesWorkspace(
  client: PoolClient,
  auth: AuthUser,
  input: { anchorDate?: string | null } = {}
): Promise<EmployeesWorkspaceResponse> {
  if (!canViewEmployeesWorkspace(auth)) {
    throw new ApiError(403, "Forbidden");
  }

  const anchorDate = input.anchorDate ?? getLocalDateString();
  const roleMode = getEmployeesWorkspaceRoleMode(auth);
  const canViewPayroll = canViewPayrollReview(auth);
  const canViewCompliance = canViewComplianceReview(auth);

  const [myWork, timeClockState, approvals, ptoRequests, tradeRequests, trainingDashboard, trainingSummaries] = await Promise.all([
    hasAnyPermission(auth, ["schedule.read", "dashboard.read"]) ? listEmployeeMyWork(client, auth, anchorDate) : Promise.resolve(null),
    getTimeClockShellControlState(client, auth),
    canViewOperationalApprovals(auth) ? listOperationalApprovalWorkspace(client, auth) : Promise.resolve(null),
    listPTORequests(client, auth, null),
    hasAnyPermission(auth, ["schedule.read", "trade.request", "trade.approve"]) ? listTradeRequests(client, auth, null) : Promise.resolve([]),
    getTrainingDashboard(client, auth),
    listTrainingSummaries(client, auth)
  ]);

  const requestsApprovalsSummary = buildRequestsApprovalsSummary({
    roleMode,
    authUserId: auth.id,
    approvals,
    ptoRequests,
    tradeRequests
  });
  const trainingSummary = buildTrainingSummary({
    roleMode,
    dashboard: trainingDashboard,
    summaries: trainingSummaries
  });
  const timePay = buildTimePayModule({
    timeClockState,
    myWork,
    canViewPayroll,
    canViewCompliance
  });
  const summaryStrip = buildEmployeesWorkspaceSummaryStrip({
    roleMode,
    requestActionCount: requestsApprovalsSummary.openRequestCount,
    approvalActionCount: requestsApprovalsSummary.awaitingDecisionCount,
    openTimeReviewCount: timePay.metrics[0]?.count ?? 0,
    trainingDueCount: trainingSummary.trainingDueCount,
    signoffDueCount: trainingSummary.signoffDueCount,
    availabilityConflictCount: requestsApprovalsSummary.availabilityConflictCount,
    timeStatusLabel: `${timeClockState.label}. ${timePay.summary_line}`
  });

  return {
    generated_at: new Date().toISOString(),
    anchor_date: anchorDate,
    refresh_interval_seconds: 90,
    role_mode: roleMode,
    summary_strip: summaryStrip,
    my_work: buildMyWorkModule({
      roleMode,
      myWork
    }),
    time_pay: timePay,
    requests_approvals: {
      visible: true,
      headline: "Requests / Approvals / Availability",
      summary_line: requestsApprovalsSummary.summaryLine,
      cards: requestsApprovalsSummary.cards,
      highlights: requestsApprovalsSummary.highlights,
      primary_action_hash: "#approvals",
      primary_action_label: "Open Approvals",
      secondary_action_hash: "#employees/requests",
      secondary_action_label: "Open Requests"
    },
    training_readiness: {
      visible: true,
      headline: "Training / Readiness / Certifications",
      summary_line: trainingSummary.summaryLine,
      cards: trainingSummary.cards,
      highlights: trainingSummary.highlights,
      primary_action_hash: "#employees/training",
      primary_action_label: "Open Training",
      secondary_action_hash: "#employees/readiness",
      secondary_action_label: "Open Readiness"
    },
    record: buildRecordModule({
      auth,
      canViewPayroll
    })
  };
}
