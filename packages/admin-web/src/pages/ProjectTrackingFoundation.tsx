import { useEffect, useState } from "react";
import { DepartmentHubPattern, type DepartmentHubCard } from "../components/department/DepartmentHubPattern";
import { ProjectWorkflowMap } from "../components/projectTracking/ProjectWorkflowMap";
import { QuickWorkflowNextStepMover } from "../components/projectTracking/QuickWorkflowNextStepMover";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { featureFlags } from "../featureFlags";
import { canManageWorkflowTemplates } from "../permissions";
import { isProjectTrackingWorkflowHash, resolveWorkSpineActionHref } from "../workSpineRouting";
import {
  getProjectWorkflowCommandCenter,
  getProjectWorkflowInstance
} from "../services/projectTracking";
import type {
  ProjectWorkflowCommandCenter,
  ProjectWorkflowInstance,
  ProjectWorkflowJobHealth,
  ProjectWorkflowJobRow
} from "../projectTrackingTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type LoadState = "loading" | "ready" | "error";
type ProjectTrackingFilter =
  | "all"
  | "mine"
  | "attention"
  | "blocked"
  | "running_late"
  | "due_soon"
  | "waiting_review"
  | "recently_changed"
  | "waiting_school"
  | "waiting_kp"
  | "missing_info"
  | "needs_assignment"
  | "complete"
  | "no_workflow";
type ProjectTrackingSort = "priority" | "organization" | "job" | "stage" | "owner" | "deadline" | "risk" | "updated";
type ProjectTrackingDepartmentFilter = "all" | "schools" | "sports" | "sessions" | "production" | "other";
type ProjectTrackingPreset = "all_active" | "leadership_review" | "schools" | "sports" | "photography" | "blocked" | "due_soon" | "at_risk";
type ProjectTrackingViewMode = "command" | "board" | "table" | "timeline";
type ProjectTrackingCommandGroupId =
  | "at_risk"
  | "due_today"
  | "due_this_week"
  | "blocked"
  | "waiting_school_client"
  | "waiting_internal"
  | "recently_completed"
  | "missing_owner_info";
type ProjectWorkflowJobRowWithRouteHints = ProjectWorkflowJobRow & {
  action_hash?: string | null;
  actionHash?: string | null;
  workflowRunId?: string | null;
};
type ProjectTrackingCommandGroup = {
  id: ProjectTrackingCommandGroupId;
  label: string;
  emptyCopy: string;
  rows: ProjectWorkflowJobRow[];
  sortKey: ProjectTrackingSort;
};
type ProjectTrackingBoardLaneId = "blocked" | "intake" | "ready" | "production" | "review" | "delivery" | "complete";
type ProjectTrackingTimelineGroupId = "overdue" | "today" | "this_week" | "next_week" | "later" | "unscheduled";

const EMPTY_SUMMARY = {
  open_steps: 0,
  overdue_steps: 0,
  due_soon_steps: 0,
  blocked_steps: 0,
  assigned_steps: 0,
  rework_steps: 0,
  at_risk_steps: 0,
  total_active_workflows: 0,
  total_open_work: 0,
  total_needs_attention: 0,
  total_blocked: 0,
  total_running_late: 0,
  total_due_soon: 0,
  total_returned_for_fixes: 0,
  total_waiting_on_school: 0,
  total_waiting_on_kp: 0,
  total_missing_info: 0,
  total_complete: 0,
  total_no_workflow_linked: 0,
  source: "true_totals" as const,
  confidence: "mixed" as const
};
const FILTER_LABELS: Record<ProjectTrackingFilter, string> = {
  all: "All",
  mine: "Mine",
  attention: "Needs Attention",
  blocked: "Blocked",
  running_late: "Running late",
  due_soon: "Due soon",
  waiting_review: "Waiting on review",
  recently_changed: "Recently changed",
  waiting_school: "Waiting on School",
  waiting_kp: "Waiting on KP",
  missing_info: "Missing Info",
  needs_assignment: "Needs Assignment",
  complete: "Complete",
  no_workflow: "No Workflow Linked"
};
const PRIMARY_FILTERS: ProjectTrackingFilter[] = ["all", "due_soon", "blocked", "waiting_review", "mine", "recently_changed"];
const PRESET_LABELS: Record<ProjectTrackingPreset, string> = {
  all_active: "All Active",
  leadership_review: "Leadership Review",
  schools: "Schools",
  sports: "Sports",
  photography: "Photography",
  blocked: "Blocked",
  due_soon: "Due Soon",
  at_risk: "At Risk"
};

const PRESET_EMPTY_STATES: Record<ProjectTrackingPreset, string> = {
  all_active: "No active work is showing here yet.",
  leadership_review: "No Leadership Review items found.",
  schools: "No Schools active work found.",
  sports: "No Sports active work found.",
  photography: "No Photography active work found.",
  blocked: "No blocked work right now.",
  due_soon: "No due-soon work found.",
  at_risk: "No at-risk work found."
};

const PROJECT_TRACKING_PRESETS: ProjectTrackingPreset[] = ["all_active", "leadership_review", "schools", "sports", "photography", "blocked", "due_soon", "at_risk"];

const PROJECT_TRACKING_VIEW_MODES: Array<{ id: ProjectTrackingViewMode; label: string; summary: string }> = [
  { id: "command", label: "Command", summary: "Scan and act from the main work list." },
  { id: "board", label: "Board", summary: "Group the same work by current operating lane." },
  { id: "table", label: "Table", summary: "Review dense work details without extra card chrome." },
  { id: "timeline", label: "Timeline", summary: "Preview date pressure from the same filtered work." }
];

const PROJECT_TRACKING_BOARD_LANES: Array<{ id: ProjectTrackingBoardLaneId; label: string; description: string }> = [
  { id: "blocked", label: "Blocked / At Risk", description: "Blocked, late, missing owner, or missing next action." },
  { id: "intake", label: "Intake", description: "New or not-started work that needs setup." },
  { id: "ready", label: "Ready / Field Work", description: "Prep, shoot, or field work currently in motion." },
  { id: "production", label: "Production", description: "Production or graphics work underway." },
  { id: "review", label: "Review / QA", description: "Review, proofing, QA, or rework steps." },
  { id: "delivery", label: "Delivery", description: "Gallery, release, delivery, or closeout steps." },
  { id: "complete", label: "Complete", description: "Completed work still visible in the current filters." }
];

const PROJECT_TRACKING_TIMELINE_GROUPS: Array<{ id: ProjectTrackingTimelineGroupId; label: string; description: string }> = [
  { id: "overdue", label: "Overdue", description: "Late or blocked before the next step can move." },
  { id: "today", label: "Today", description: "Due today." },
  { id: "this_week", label: "This Week", description: "Due in the next seven days." },
  { id: "next_week", label: "Next Week", description: "Due in the next eight to fourteen days." },
  { id: "later", label: "Later", description: "Scheduled beyond the next two weeks." },
  { id: "unscheduled", label: "Unscheduled", description: "No next deadline is connected yet." }
];

const COMMAND_GROUP_ORDER: Array<{
  id: ProjectTrackingCommandGroupId;
  label: string;
  emptyCopy: string;
  sortKey: ProjectTrackingSort;
}> = [
  { id: "at_risk", label: "At Risk", emptyCopy: "No at-risk work right now.", sortKey: "risk" },
  { id: "due_today", label: "Due Today", emptyCopy: "Nothing due today.", sortKey: "deadline" },
  { id: "due_this_week", label: "Due This Week", emptyCopy: "Nothing due this week.", sortKey: "deadline" },
  { id: "blocked", label: "Blocked", emptyCopy: "No blocked work right now.", sortKey: "risk" },
  { id: "waiting_school_client", label: "Waiting on School / Client", emptyCopy: "No waiting-on-school items found.", sortKey: "updated" },
  { id: "waiting_internal", label: "Waiting on Internal Team", emptyCopy: "No internal handoff blockers found.", sortKey: "updated" },
  { id: "recently_completed", label: "Recently Completed", emptyCopy: "No recently completed work found.", sortKey: "updated" },
  { id: "missing_owner_info", label: "Missing Owner / Info", emptyCopy: "No missing owner or info flags found.", sortKey: "risk" }
];

const SORT_LABELS: Record<ProjectTrackingSort, string> = {
  priority: "Priority",
  organization: "Organization / School",
  job: "Work",
  stage: "Next step",
  owner: "Next owner",
  deadline: "Due",
  risk: "Blocked / due",
  updated: "Recently changed"
};
const DEPARTMENT_FILTER_LABELS: Record<ProjectTrackingDepartmentFilter, string> = {
  all: "All departments",
  schools: "Schools",
  sports: "Sports",
  sessions: "Sessions",
  production: "Production / Graphics",
  other: "Other"
};

function parseWorkflowRunIdFromHash() {
  const match = window.location.hash.match(/^#project-tracking\/workflows\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function friendlyName(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function departmentLabel(value: string | null | undefined) {
  if (!value) {
    return "Department not set";
  }
  const labels: Record<string, string> = {
    schools: "Schools",
    sports: "Sports",
    production: "Production",
    photography: "Photography",
    operations: "Operations",
    studios: "Studios",
    sessions: "Sessions"
  };
  return labels[value] ?? friendlyName(value);
}

function phasePresentation(phase: string, health: ProjectWorkflowJobHealth) {
  if (health === "complete" || phase === "complete") {
    return { label: "Complete", className: "project-tracking-job-row--phase-complete", pillClassName: "project-tracking-step-pill--complete" };
  }
  if (phase === "waiting") {
    return { label: "Waiting", className: "project-tracking-job-row--phase-waiting", pillClassName: "project-tracking-step-pill--waiting" };
  }
  if (phase === "intake") {
    return { label: "Intake / Setup", className: "project-tracking-job-row--phase-intake", pillClassName: "project-tracking-step-pill--intake" };
  }
  if (phase === "production" || phase === "qa") {
    return { label: "Production / QA", className: "project-tracking-job-row--phase-production", pillClassName: "project-tracking-step-pill--production" };
  }
  if (phase === "not_started" || health === "no_workflow" || health === "unknown") {
    return { label: "Not Started", className: "project-tracking-job-row--phase-none", pillClassName: "project-tracking-step-pill--none" };
  }
  return { label: "Active Work", className: "project-tracking-job-row--phase-active", pillClassName: "project-tracking-step-pill--active" };
}

function healthToneForJob(row: ProjectWorkflowJobRow) {
  if (row.health === "blocked" || row.health === "running_late") {
    return "critical";
  }
  if (row.health === "due_soon" || row.health === "at_risk" || row.health === "no_workflow" || row.health === "unknown") {
    return "warning";
  }
  return "normal";
}

function healthLabel(health: ProjectWorkflowJobHealth) {
  const labels: Record<ProjectWorkflowJobHealth, string> = {
    on_track: "On track",
    due_soon: "Due soon",
    running_late: "Running late",
    blocked: "Blocked",
    at_risk: "Needs attention",
    complete: "Complete",
    no_workflow: "Work record not connected",
    unknown: "Needs review"
  };
  return labels[health];
}

function operationalStatusLabel(row: ProjectWorkflowJobRow) {
  const labels: Record<ProjectWorkflowJobRow["queue_intelligence"]["operational_status"], string> = {
    active: "Active",
    needs_action: "Needs action",
    waiting: "Waiting",
    blocked: "Blocked",
    overdue: "Overdue",
    at_risk: "At risk",
    ready_to_advance: "Ready to advance",
    missing_owner: "Missing owner",
    missing_next_action: "Missing next action"
  };
  return labels[row.queue_intelligence.operational_status];
}

function operationalToneForJob(row: ProjectWorkflowJobRow) {
  if (["blocked", "overdue", "missing_owner", "missing_next_action"].includes(row.queue_intelligence.operational_status)) {
    return "critical";
  }
  if (["waiting", "at_risk", "needs_action"].includes(row.queue_intelligence.operational_status)) {
    return "warning";
  }
  return "normal";
}

function currentStepLabel(row: ProjectWorkflowJobRow) {
  if (row.current_step?.name) {
    return row.current_step.name;
  }
  if (row.health === "no_workflow") {
    return "Work record not connected";
  }
  if (row.health === "complete") {
    return "Complete";
  }
  return "Step unknown";
}

function dateLabel(value: string | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function deadlineLabel(row: ProjectWorkflowJobRow) {
  if (row.deadline_state === "blocked") {
    return "Blocked";
  }
  if (row.deadline_state === "complete") {
    return "Complete";
  }
  if (!row.next_deadline_at) {
    return row.workflow_run_id ? "Deadline not set" : "Work record not connected";
  }
  const date = dateLabel(row.next_deadline_at) ?? "Deadline not set";
  if (row.deadline_state === "running_late") {
    return `Late: ${date}`;
  }
  if (row.deadline_state === "due_soon") {
    return `Due soon: ${date}`;
  }
  return date;
}

function waitingOnLabel(row: ProjectWorkflowJobRow) {
  const labels: Record<ProjectWorkflowJobRow["waiting_on_party"], string> = {
    school: "School",
    kp: "KP",
    production: "Production",
    graphics: "Graphics",
    customer_service: "Customer Service",
    vendor: "Vendor",
    family: "Family",
    other: "Other",
    none: "No wait",
    unknown: "Waiting on unknown"
  };
  return labels[row.waiting_on_party];
}

function departmentFilterForJob(row: ProjectWorkflowJobRow): ProjectTrackingDepartmentFilter {
  const department = row.current_step?.department?.toLowerCase() ?? row.phase?.toLowerCase() ?? "";
  if (department === "schools") {
    return "schools";
  }
  if (department === "sports") {
    return "sports";
  }
  if (["photography", "studio", "studios", "session", "sessions"].includes(department)) {
    return "sessions";
  }
  if (department === "production") {
    return "production";
  }
  return "other";
}

function matchesDepartmentFilter(row: ProjectWorkflowJobRow, departmentFilter: ProjectTrackingDepartmentFilter) {
  return departmentFilter === "all" || departmentFilterForJob(row) === departmentFilter;
}

function isActiveWork(row: ProjectWorkflowJobRow) {
  return row.health !== "complete";
}

function isBlockedWork(row: ProjectWorkflowJobRow) {
  return row.health === "blocked" || row.deadline_state === "blocked" || Boolean(row.blocked_reason) || row.current_step?.status === "BLOCKED" || row.queue_intelligence.operational_status === "blocked";
}

function isDueSoonWork(row: ProjectWorkflowJobRow) {
  return row.health === "due_soon" || row.deadline_state === "due_soon";
}

function isAtRiskWork(row: ProjectWorkflowJobRow) {
  return (
    row.health === "at_risk" ||
    row.health === "unknown" ||
    row.rework_count > 0 ||
    row.queue_intelligence.operational_status === "at_risk" ||
    row.queue_intelligence.operational_status === "needs_action"
  );
}

function isWaitingWork(row: ProjectWorkflowJobRow) {
  return row.waiting_on_party !== "none" && row.waiting_on_party !== "unknown";
}

function isMissingOwnerOrInfo(row: ProjectWorkflowJobRow) {
  return row.missing_info_flags.length > 0 || row.current_step?.assignment_status === "needs_assignment";
}

function matchesPreset(row: ProjectWorkflowJobRow, preset: ProjectTrackingPreset) {
  if (preset === "all_active") {
    return isActiveWork(row);
  }
  if (preset === "leadership_review") {
    return (
      isBlockedWork(row) ||
      row.health === "running_late" ||
      isDueSoonWork(row) ||
      isAtRiskWork(row) ||
      isWaitingWork(row) ||
      isMissingOwnerOrInfo(row) ||
      ["overdue", "missing_owner", "missing_next_action", "waiting"].includes(row.queue_intelligence.operational_status)
    );
  }
  if (preset === "schools") {
    return departmentFilterForJob(row) === "schools";
  }
  if (preset === "sports") {
    return departmentFilterForJob(row) === "sports";
  }
  if (preset === "photography") {
    return departmentFilterForJob(row) === "sessions";
  }
  if (preset === "blocked") {
    return isBlockedWork(row);
  }
  if (preset === "due_soon") {
    return isDueSoonWork(row);
  }
  return isAtRiskWork(row);
}

function presetCountsFor(rows: ProjectWorkflowJobRow[]) {
  return PROJECT_TRACKING_PRESETS.map((preset) => ({
    preset,
    label: PRESET_LABELS[preset],
    count: rows.filter((row) => matchesPreset(row, preset)).length
  }));
}

function commandReferenceDate(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isSameLocalDay(value: string | null, referenceDate: Date) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.getFullYear() === referenceDate.getFullYear() && date.getMonth() === referenceDate.getMonth() && date.getDate() === referenceDate.getDate();
}

function isDueThisWeek(row: ProjectWorkflowJobRow, referenceDate: Date) {
  if (!row.next_deadline_at || row.health === "complete") {
    return false;
  }
  const dueAt = new Date(row.next_deadline_at).getTime();
  if (Number.isNaN(dueAt)) {
    return false;
  }
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return dueAt >= start.getTime() && dueAt <= end.getTime();
}

function hasSchoolClientWaitSignal(row: ProjectWorkflowJobRow) {
  if (["school", "family", "vendor", "other"].includes(row.waiting_on_party)) {
    return true;
  }
  const text = [row.blocked_reason, row.queue_intelligence.reason, row.queue_intelligence.next_action, ...row.health_reasons]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(school|client|customer|family|vendor)\b/.test(text);
}

function hasInternalWaitSignal(row: ProjectWorkflowJobRow) {
  return ["kp", "production", "graphics", "customer_service"].includes(row.waiting_on_party);
}

function isCommandAtRisk(row: ProjectWorkflowJobRow) {
  return (
    row.health === "running_late" ||
    row.health === "at_risk" ||
    row.health === "unknown" ||
    row.deadline_state === "running_late" ||
    row.queue_intelligence.operational_status === "overdue" ||
    row.queue_intelligence.operational_status === "at_risk" ||
    row.queue_intelligence.operational_status === "needs_action" ||
    row.rework_count > 0
  );
}

function matchesCommandGroup(row: ProjectWorkflowJobRow, groupId: ProjectTrackingCommandGroupId, referenceDate: Date) {
  if (groupId === "at_risk") {
    return isCommandAtRisk(row);
  }
  if (groupId === "due_today") {
    return row.health !== "complete" && isSameLocalDay(row.next_deadline_at, referenceDate);
  }
  if (groupId === "due_this_week") {
    return isDueThisWeek(row, referenceDate);
  }
  if (groupId === "blocked") {
    return isBlockedWork(row);
  }
  if (groupId === "waiting_school_client") {
    return row.health !== "complete" && hasSchoolClientWaitSignal(row);
  }
  if (groupId === "waiting_internal") {
    return row.health !== "complete" && hasInternalWaitSignal(row);
  }
  if (groupId === "recently_completed") {
    return row.health === "complete";
  }
  return isMissingOwnerOrInfo(row);
}

function commandGroupsFor(rows: ProjectWorkflowJobRow[], generatedAt: string | null | undefined): ProjectTrackingCommandGroup[] {
  const referenceDate = commandReferenceDate(generatedAt);
  return COMMAND_GROUP_ORDER.map((group) => ({
    ...group,
    rows: sortRows(rows.filter((row) => matchesCommandGroup(row, group.id, referenceDate)), group.sortKey)
  }));
}

function routeForCommandWork(row: ProjectWorkflowJobRow) {
  const routeHints = row as ProjectWorkflowJobRowWithRouteHints;
  const href = resolveWorkSpineActionHref({
    actionHash: routeHints.actionHash ?? routeHints.action_hash ?? null,
    workflowRunId: routeHints.workflowRunId ?? row.workflow_run_id,
    fallbackHash: "#project-tracking",
    fallbackKind: "project_tracking"
  });
  return {
    href,
    label: isProjectTrackingWorkflowHash(href) ? "View Workflow" : "Open in Project Tracking"
  };
}

function projectTrackingDomId(prefix: string, value: string) {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function workItemName(row: ProjectWorkflowJobRow) {
  return row.job_title || row.organization_name || row.account_name || "Untitled work";
}

function workItemAccountLabel(row: ProjectWorkflowJobRow) {
  return row.organization_name ?? row.account_name ?? "No account linked";
}

function actionLabelForWork(row: ProjectWorkflowJobRow, routeLabel: string) {
  return routeLabel === "View Workflow" ? `View workflow for ${workItemName(row)}` : `Open Project Tracking for ${workItemName(row)}`;
}

function ProjectTrackingWorkAction({
  row,
  onOpenWorkflow
}: {
  row: ProjectWorkflowJobRow;
  onOpenWorkflow: (workflowRunId: string) => void;
}) {
  const route = routeForCommandWork(row);
  const actionLabel = actionLabelForWork(row, route.label);
  if (row.workflow_run_id) {
    return (
      <button
        className="project-tracking-progress-link"
        type="button"
        aria-label={actionLabel}
        title={actionLabel}
        onClick={() => onOpenWorkflow(row.workflow_run_id!)}
      >
        View Workflow
      </button>
    );
  }
  if (route.href === "#project-tracking") {
    return <span className="project-tracking-progress-link project-tracking-progress-link--disabled">Not connected yet</span>;
  }
  return (
    <a className="project-tracking-progress-link" href={route.href} aria-label={actionLabel} title={actionLabel}>
      {route.label}
    </a>
  );
}

function boardLaneForRow(row: ProjectWorkflowJobRow): ProjectTrackingBoardLaneId {
  const stepText = `${currentStepLabel(row)} ${row.current_step?.description ?? ""} ${row.file_status}`.toLowerCase();
  if (row.health === "blocked" || row.health === "running_late" || ["blocked", "overdue", "missing_owner", "missing_next_action"].includes(row.queue_intelligence.operational_status)) {
    return "blocked";
  }
  if (row.health === "complete" || row.phase === "complete") {
    return "complete";
  }
  if (stepText.includes("qa") || stepText.includes("review") || stepText.includes("proof") || row.rework_count > 0) {
    return "review";
  }
  if (stepText.includes("gallery") || stepText.includes("deliver") || stepText.includes("release")) {
    return "delivery";
  }
  if (row.phase === "production" || row.phase === "qa" || stepText.includes("production") || stepText.includes("graphic")) {
    return "production";
  }
  if (stepText.includes("shoot") || stepText.includes("session") || stepText.includes("photograph") || stepText.includes("capture")) {
    return "ready";
  }
  if (row.phase === "intake" || row.phase === "not_started" || row.health === "no_workflow" || row.health === "unknown") {
    return "intake";
  }
  return "ready";
}

function timelineGroupForRow(row: ProjectWorkflowJobRow, referenceDate = new Date()): ProjectTrackingTimelineGroupId {
  if (row.deadline_state === "blocked" || row.deadline_state === "running_late" || row.health === "blocked" || row.health === "running_late") {
    return "overdue";
  }
  if (!row.next_deadline_at) {
    return "unscheduled";
  }
  const startOfToday = new Date(referenceDate);
  startOfToday.setHours(0, 0, 0, 0);
  const dueDate = new Date(row.next_deadline_at);
  dueDate.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.round((dueDate.getTime() - startOfToday.getTime()) / 86_400_000);
  if (daysUntilDue < 0) {
    return "overdue";
  }
  if (daysUntilDue === 0) {
    return "today";
  }
  if (daysUntilDue <= 7) {
    return "this_week";
  }
  if (daysUntilDue <= 14) {
    return "next_week";
  }
  return "later";
}

function departmentDisplayForRow(row: ProjectWorkflowJobRow) {
  return departmentLabel(row.current_step?.department);
}

function statusPhaseLabelForRow(row: ProjectWorkflowJobRow) {
  const phase = phasePresentation(row.phase, row.health);
  const status = row.current_step ? statusLabel(row.current_step.status) : phase.label;
  return `${status} / ${phase.label}`;
}

function waitingOrBlockedLabelForRow(row: ProjectWorkflowJobRow) {
  if (row.blocked_reason) {
    return row.blocked_reason;
  }
  if (row.waiting_on_party !== "none" && row.waiting_on_party !== "unknown") {
    return `Waiting on ${waitingOnLabel(row)}`;
  }
  if (row.missing_info_flags.includes("missing_owner")) {
    return "Missing owner";
  }
  if (row.missing_info_flags.length) {
    return "Missing info";
  }
  if (row.queue_intelligence.operational_status === "missing_next_action") {
    return "Missing next action";
  }
  if (row.rework_count > 0) {
    return `${row.rework_count} rework ${row.rework_count === 1 ? "item" : "items"}`;
  }
  return null;
}

function BoardCardMeta({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ownerPresentation(row: ProjectWorkflowJobRow) {
  const department = departmentLabel(row.current_step?.department);
  if (row.owner_type === "user") {
    return {
      primary: row.owner_display || "Assigned person",
      secondary: "Assigned person",
      className: "project-tracking-owner--person"
    };
  }
  if (row.missing_info_flags.includes("missing_owner") && row.workflow_run_id && row.current_step) {
    return {
      primary: "Needs Assignment",
      secondary: `${department} needs an owner`,
      className: "project-tracking-owner--needs-assignment"
    };
  }
  if (row.owner_type === "unknown") {
    return {
      primary: "Owner not set",
      secondary: "No assignment source yet",
      className: "project-tracking-owner--unknown"
    };
  }
  if (row.owner_type === "department") {
    return {
      primary: `${department} Queue`,
      secondary: "Team queue",
      className: "project-tracking-owner--queue"
    };
  }
  if (row.owner_type === "account_owner") {
    return {
      primary: friendlyName(row.owner_display || "account owner"),
      secondary: "Inherited owner",
      className: "project-tracking-owner--role"
    };
  }
  return {
    primary: friendlyName(row.owner_display),
    secondary: "Role owner",
    className: "project-tracking-owner--role"
  };
}

function fileStatusLabelForJob(row: ProjectWorkflowJobRow) {
  const labels: Record<ProjectWorkflowJobRow["file_status"], string> = {
    not_connected: "File status not connected yet",
    not_started: "Not started",
    waiting_for_files: "Waiting for files",
    count_images: "Count Images",
    confirm_files: "Confirm Files",
    verify_image_count: "Verify Image Count",
    in_production: "In production",
    qa_review: "QA review",
    ready_to_release: "Ready to release",
    released: "Released",
    unknown: "File status unknown"
  };
  return labels[row.file_status];
}

function matchesFilter(row: ProjectWorkflowJobRow, filter: ProjectTrackingFilter) {
  if (filter === "all") {
    return true;
  }
  if (filter === "mine") {
    return false;
  }
  if (filter === "blocked") {
    return row.health === "blocked";
  }
  if (filter === "running_late") {
    return row.health === "running_late";
  }
  if (filter === "due_soon") {
    return row.health === "due_soon";
  }
  if (filter === "waiting_review") {
    return row.rework_count > 0 || row.health === "at_risk" || row.health === "unknown" || row.queue_intelligence.operational_status === "needs_action";
  }
  if (filter === "recently_changed") {
    return Boolean(row.updated_at);
  }
  if (filter === "waiting_school") {
    return row.waiting_on_party === "school";
  }
  if (filter === "waiting_kp") {
    return row.waiting_on_party === "kp";
  }
  if (filter === "missing_info") {
    return row.missing_info_flags.length > 0;
  }
  if (filter === "needs_assignment") {
    return row.current_step?.assignment_status === "needs_assignment" || row.missing_info_flags.includes("missing_owner");
  }
  if (filter === "complete") {
    return row.health === "complete";
  }
  if (filter === "no_workflow") {
    return row.health === "no_workflow";
  }
  return ["blocked", "running_late", "due_soon", "at_risk", "unknown"].includes(row.health);
}

function isOwnedByCurrentUser(row: ProjectWorkflowJobRow, currentUser: SessionUser) {
  if (row.current_step?.assigned_user_id && row.current_step.assigned_user_id === currentUser.id) {
    return true;
  }
  return row.owner_display.trim().toLowerCase() === currentUser.fullName.trim().toLowerCase();
}

function matchesFilterForUser(row: ProjectWorkflowJobRow, filter: ProjectTrackingFilter, currentUser: SessionUser) {
  if (filter === "mine") {
    return isOwnedByCurrentUser(row, currentUser);
  }
  return matchesFilter(row, filter);
}

function searchableTextForJob(row: ProjectWorkflowJobRow) {
  const currentStep = currentStepLabel(row);
  const status = row.current_step ? statusLabel(row.current_step.status) : healthLabel(row.health);
  const owner = ownerPresentation(row);
  return [
    row.organization_name,
    row.account_name,
    row.job_title,
    row.job_number,
    row.job_code,
    currentStep,
    owner.primary,
    owner.secondary,
    departmentLabel(row.current_step?.department),
    DEPARTMENT_FILTER_LABELS[departmentFilterForJob(row)],
    row.workflow_template_name,
    row.workflow_template_version,
    waitingOnLabel(row),
    healthLabel(row.health),
    status,
    deadlineLabel(row),
    fileStatusLabelForJob(row),
    ...row.health_reasons,
    ...row.missing_info_flags
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesSearch(row: ProjectWorkflowJobRow, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return searchableTextForJob(row).includes(query);
}

function priorityRank(row: ProjectWorkflowJobRow) {
  if (row.health === "blocked") {
    return 0;
  }
  if (row.health === "running_late") {
    return 1;
  }
  if (row.health === "at_risk" || row.health === "unknown") {
    return 2;
  }
  if (row.health === "due_soon") {
    return 3;
  }
  if (row.waiting_on_party !== "none" && row.waiting_on_party !== "unknown") {
    return 4;
  }
  if (row.health === "no_workflow") {
    return 5;
  }
  if (row.health === "complete") {
    return 6;
  }
  return 5;
}

function dateSortValue(value: string | null) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function compareText(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function sortRows(rows: ProjectWorkflowJobRow[], sortKey: ProjectTrackingSort) {
  return [...rows].sort((a, b) => {
    if (sortKey === "organization") {
      return compareText(a.organization_name ?? a.account_name, b.organization_name ?? b.account_name) || compareText(a.job_title, b.job_title);
    }
    if (sortKey === "job") {
      return compareText(a.job_title, b.job_title);
    }
    if (sortKey === "stage") {
      return compareText(currentStepLabel(a), currentStepLabel(b)) || priorityRank(a) - priorityRank(b);
    }
    if (sortKey === "owner") {
      return compareText(ownerPresentation(a).primary, ownerPresentation(b).primary) || priorityRank(a) - priorityRank(b);
    }
    if (sortKey === "deadline") {
      return dateSortValue(a.next_deadline_at) - dateSortValue(b.next_deadline_at) || priorityRank(a) - priorityRank(b);
    }
    if (sortKey === "risk") {
      return priorityRank(a) - priorityRank(b) || dateSortValue(a.next_deadline_at) - dateSortValue(b.next_deadline_at);
    }
    if (sortKey === "updated") {
      return dateSortValue(b.updated_at) - dateSortValue(a.updated_at);
    }
    return priorityRank(a) - priorityRank(b) || dateSortValue(a.next_deadline_at) - dateSortValue(b.next_deadline_at);
  });
}

function summaryRecentlyChangedCount(payload: ProjectWorkflowCommandCenter | null) {
  return buildJobBoardRows(payload).filter((row) => Boolean(row.updated_at)).length;
}

function isGeneratedDemoNoise(row: ProjectWorkflowJobRow) {
  const text = [row.job_title, row.job_number, row.job_code, row.organization_name, row.account_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("command layer job") || text.includes("production reporting sports job");
}

function isCuratedProjectDashboardRow(row: ProjectWorkflowJobRow) {
  return Boolean(row.workflow_run_id) && !isGeneratedDemoNoise(row);
}

function buildJobBoardRows(payload: ProjectWorkflowCommandCenter | null): ProjectWorkflowJobRow[] {
  return (payload?.job_rows ?? []).filter(isCuratedProjectDashboardRow);
}

function summaryFor(payload: ProjectWorkflowCommandCenter | null) {
  return payload?.summary ?? EMPTY_SUMMARY;
}

function ProjectTrackingCommandView({
  payload,
  selectedCommandGroup,
  onCommandGroupSelect
}: {
  payload: ProjectWorkflowCommandCenter | null;
  selectedCommandGroup: ProjectTrackingCommandGroupId | null;
  onCommandGroupSelect: (group: ProjectTrackingCommandGroup) => void;
}) {
  const rows = buildJobBoardRows(payload);
  const groups = commandGroupsFor(rows, payload?.generated_at);
  return (
    <section className="project-tracking-command-view" aria-label="Project Tracking Command View">
      <div className="project-tracking-panel__heading">
        <div>
          <div className="section-title">Command View</div>
          <p className="section-subtitle">Start with risk, due dates, blockers, waits, and missing handoff details before opening the full work list.</p>
        </div>
        <a className="project-tracking-command-view__broad-link" href="#project-tracking">
          Open in Project Tracking
        </a>
      </div>
      <div className="project-tracking-command-grid">
        {groups.map((group) => {
          const previewRows = group.rows.slice(0, 3);
          const isSelected = selectedCommandGroup === group.id;
          return (
            <article
              className={`project-tracking-command-card ${isSelected ? "is-active" : ""}`}
              key={group.id}
              aria-label={`${group.label} command group${isSelected ? ", active command filter" : ""}`}
            >
              <div className="project-tracking-command-card__top">
                <div>
                  <h2>{group.label}</h2>
                  <small>{group.rows.length ? `Representative work, ${group.rows.length} ${group.rows.length === 1 ? "item" : "items"}` : "No active items"}</small>
                </div>
                <strong aria-label={`${group.rows.length} ${group.rows.length === 1 ? "item" : "items"}`}>{group.rows.length}</strong>
              </div>
              {previewRows.length ? (
                <div className="project-tracking-command-card__items">
                  {previewRows.map((row) => {
                    const route = routeForCommandWork(row);
                    const owner = ownerPresentation(row);
                    const label = actionLabelForWork(row, route.label);
                    return (
                      <div className="project-tracking-command-item" key={`${group.id}:${row.job_id}`}>
                        <div>
                          <span>{workItemAccountLabel(row)}</span>
                          <strong>{workItemName(row)}</strong>
                          <small>{currentStepLabel(row)} - {owner.primary} - {deadlineLabel(row)}</small>
                        </div>
                        <a href={route.href} aria-label={label} title={label}>{route.label}</a>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="project-tracking-command-card__empty">{group.emptyCopy}</p>
              )}
              {group.rows.length ? (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? "Active command filter: " : "Review "}${group.label.toLowerCase()} work`}
                  onClick={() => onCommandGroupSelect(group)}
                >
                  Review {group.label}
                  {isSelected ? <span className="project-tracking-active-marker">Active</span> : null}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectTrackingViewSwitcher({
  viewMode,
  onViewModeChange
}: {
  viewMode: ProjectTrackingViewMode;
  onViewModeChange: (viewMode: ProjectTrackingViewMode) => void;
}) {
  return (
    <div className="project-tracking-view-switcher" aria-label="Project Tracking view modes">
      <div>
        <strong>View</strong>
        <span>Same filtered work, different lens</span>
      </div>
      <div className="project-tracking-view-switcher__buttons">
        {PROJECT_TRACKING_VIEW_MODES.map((mode) => (
          <button
            className={viewMode === mode.id ? "is-active" : ""}
            type="button"
            key={mode.id}
            aria-pressed={viewMode === mode.id}
            title={mode.summary}
            onClick={() => onViewModeChange(mode.id)}
          >
            {mode.label}
            {viewMode === mode.id ? <span className="project-tracking-active-marker">Active</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectTrackingBoardView({
  rows,
  onOpenWorkflow
}: {
  rows: ProjectWorkflowJobRow[];
  onOpenWorkflow: (workflowRunId: string) => void;
}) {
  return (
    <section className="project-tracking-view-shell project-tracking-board-view" aria-label="Board View">
      <div className="project-tracking-view-intro">
        <strong>Board</strong>
        <span>Flow state by lane. Filters and search still control the work shown here.</span>
      </div>
      <div className="project-tracking-board-lanes" role="list" aria-label="Project Tracking board lanes">
        {PROJECT_TRACKING_BOARD_LANES.map((lane) => {
          const laneRows = rows.filter((row) => boardLaneForRow(row) === lane.id);
          const laneAttentionCount = laneRows.filter((row) => healthToneForJob(row) !== "normal" || waitingOrBlockedLabelForRow(row)).length;
          return (
            <article className={`project-tracking-board-lane project-tracking-board-lane--${lane.id}`} key={lane.id} role="listitem" aria-label={`${lane.label}, ${laneRows.length} ${laneRows.length === 1 ? "item" : "items"}`}>
              <header>
                <div>
                  <h3>{lane.label}</h3>
                  <p>{lane.description}</p>
                </div>
                <div className="project-tracking-lane-count">
                  <strong>{laneRows.length}</strong>
                  <span>{laneRows.length === 1 ? "item" : "items"}</span>
                  {laneAttentionCount ? <em>{laneAttentionCount} flagged</em> : null}
                </div>
              </header>
              {laneRows.length ? (
                <div className="project-tracking-board-lane__cards" role="list" aria-label={`${lane.label} work`}>
                  {laneRows.map((row) => {
                    const phase = phasePresentation(row.phase, row.health);
                    const owner = ownerPresentation(row);
                    const waiting = waitingOrBlockedLabelForRow(row);
                    return (
                      <article className={`project-tracking-board-card ${phase.className}`} key={`${lane.id}:${row.job_id}`} role="listitem">
                        <div className="project-tracking-board-card__top">
                          <div>
                            <span>{departmentDisplayForRow(row)} / {workItemAccountLabel(row)}</span>
                            <h4 title={row.job_title}>{workItemName(row)}</h4>
                          </div>
                          <span className={`project-tracking-risk-badge project-tracking-risk-badge--${healthToneForJob(row)}`}>{healthLabel(row.health)}</span>
                        </div>
                        <div className="project-tracking-board-card__chips">
                          <span className={`project-tracking-step-pill ${phase.pillClassName}`}>{phase.label}</span>
                          {waiting ? <span className="project-tracking-attention-chip">{waiting}</span> : null}
                        </div>
                        <dl>
                          <BoardCardMeta label="Owner / Queue" value={owner.primary} />
                          <BoardCardMeta label="Current Step" value={currentStepLabel(row)} />
                          <BoardCardMeta label="Due" value={deadlineLabel(row)} />
                        </dl>
                        <p><strong>Next:</strong> {row.queue_intelligence.next_action}</p>
                        <ProjectTrackingWorkAction row={row} onOpenWorkflow={onOpenWorkflow} />
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="project-tracking-view-empty">No work found for this view in this lane.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectTrackingTableView({
  rows,
  onOpenWorkflow
}: {
  rows: ProjectWorkflowJobRow[];
  onOpenWorkflow: (workflowRunId: string) => void;
}) {
  return (
    <section className="project-tracking-view-shell" aria-label="Table View">
      <div className="project-tracking-view-intro">
        <strong>Table</strong>
        <span>Precision review for owner, status, due date, health, and action.</span>
      </div>
      <div className="project-tracking-table-wrap">
        <table className="project-tracking-table" aria-label="Project Tracking table view">
          <thead>
            <tr>
              <th scope="col">Work</th>
              <th scope="col">Department</th>
              <th scope="col">Account</th>
              <th scope="col">Owner / Queue</th>
              <th scope="col">Status / Phase</th>
              <th scope="col">Current Step</th>
              <th scope="col">Due</th>
              <th scope="col">Health</th>
              <th scope="col">Waiting / Blocked</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const owner = ownerPresentation(row);
              const waiting = waitingOrBlockedLabelForRow(row) ?? "Clear";
              return (
                <tr key={row.job_id}>
                  <td>
                    <strong>{workItemName(row)}</strong>
                    <span>{row.job_number ?? row.job_code ?? row.job_id}</span>
                  </td>
                  <td>{departmentDisplayForRow(row)}</td>
                  <td>{workItemAccountLabel(row)}</td>
                  <td>{owner.primary}</td>
                  <td>{statusPhaseLabelForRow(row)}</td>
                  <td>{currentStepLabel(row)}</td>
                  <td>{deadlineLabel(row)}</td>
                  <td>
                    <span className={`project-tracking-risk-badge project-tracking-risk-badge--${healthToneForJob(row)}`}>{healthLabel(row.health)}</span>
                  </td>
                  <td>
                    <span className={waiting === "Clear" ? "project-tracking-table-muted" : "project-tracking-attention-chip"}>{waiting}</span>
                  </td>
                  <td>
                    <ProjectTrackingWorkAction row={row} onOpenWorkflow={onOpenWorkflow} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProjectTrackingTimelinePreview({
  rows,
  onOpenWorkflow,
  referenceDate
}: {
  rows: ProjectWorkflowJobRow[];
  onOpenWorkflow: (workflowRunId: string) => void;
  referenceDate: Date;
}) {
  return (
    <section className="project-tracking-view-shell project-tracking-timeline-view" aria-label="Timeline Preview">
      <div className="project-tracking-view-intro">
        <strong>Timeline</strong>
        <span>Date pressure from the same filtered work. Unscheduled work stays visible.</span>
      </div>
      <div className="project-tracking-timeline-groups" role="list" aria-label="Project Tracking timeline preview">
        {PROJECT_TRACKING_TIMELINE_GROUPS.map((group) => {
          const groupRows = rows.filter((row) => timelineGroupForRow(row, referenceDate) === group.id);
          return (
            <article className="project-tracking-timeline-group" key={group.id} role="listitem" aria-label={`${group.label}, ${groupRows.length} ${groupRows.length === 1 ? "item" : "items"}`}>
              <header>
                <div>
                  <h3>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
                <strong>{groupRows.length}</strong>
              </header>
              {groupRows.length ? (
                <div className="project-tracking-timeline-group__items" role="list" aria-label={`${group.label} timeline items`}>
                  {groupRows.map((row) => {
                    const owner = ownerPresentation(row);
                    const waiting = waitingOrBlockedLabelForRow(row);
                    return (
                      <article className="project-tracking-timeline-item" key={`${group.id}:${row.job_id}`} role="listitem">
                        <div className="project-tracking-timeline-item__date">
                          <span>{deadlineLabel(row)}</span>
                          <small>{row.next_deadline_at ? dateLabel(row.next_deadline_at) : "No date"}</small>
                        </div>
                        <div className="project-tracking-timeline-item__main">
                          <strong>{workItemName(row)}</strong>
                          <small>{departmentDisplayForRow(row)} / {workItemAccountLabel(row)}</small>
                          <span>{currentStepLabel(row)} - {owner.primary}</span>
                          <div className="project-tracking-timeline-item__chips">
                            <span className={`project-tracking-risk-badge project-tracking-risk-badge--${healthToneForJob(row)}`}>{healthLabel(row.health)}</span>
                            {waiting ? <span className="project-tracking-attention-chip">{waiting}</span> : null}
                          </div>
                        </div>
                        <ProjectTrackingWorkAction row={row} onOpenWorkflow={onOpenWorkflow} />
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="project-tracking-view-empty">No work found for this view in this date group.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectTrackingJobBoard({
  token,
  payload,
  currentUser,
  viewMode,
  activeFilter,
  selectedPreset,
  selectedCommandGroup,
  departmentFilter,
  searchQuery,
  sortKey,
  expandedRows,
  onViewModeChange,
  onFilterChange,
  onDepartmentFilterChange,
  onPresetChange,
  onSearchQueryChange,
  onSortKeyChange,
  onClearFilters,
  onToggleRow,
  onOpenWorkflow,
  onWorkflowRowUpdated
}: {
  token: string;
  payload: ProjectWorkflowCommandCenter | null;
  currentUser: SessionUser;
  viewMode: ProjectTrackingViewMode;
  activeFilter: ProjectTrackingFilter;
  selectedPreset: ProjectTrackingPreset;
  selectedCommandGroup: ProjectTrackingCommandGroupId | null;
  departmentFilter: ProjectTrackingDepartmentFilter;
  searchQuery: string;
  sortKey: ProjectTrackingSort;
  expandedRows: Set<string>;
  onViewModeChange: (viewMode: ProjectTrackingViewMode) => void;
  onFilterChange: (filter: ProjectTrackingFilter) => void;
  onDepartmentFilterChange: (filter: ProjectTrackingDepartmentFilter) => void;
  onPresetChange: (preset: ProjectTrackingPreset) => void;
  onSearchQueryChange: (query: string) => void;
  onSortKeyChange: (sortKey: ProjectTrackingSort) => void;
  onClearFilters: () => void;
  onToggleRow: (rowId: string) => void;
  onOpenWorkflow: (workflowRunId: string) => void;
  onWorkflowRowUpdated: () => Promise<void> | void;
}) {
  const rows = buildJobBoardRows(payload);
  const commandReference = commandReferenceDate(payload?.generated_at);
  const presetRows = rows.filter((row) => matchesPreset(row, selectedPreset) && (!selectedCommandGroup || matchesCommandGroup(row, selectedCommandGroup, commandReference)));
  const filteredRows = sortRows(presetRows.filter((row) => matchesDepartmentFilter(row, departmentFilter) && matchesFilterForUser(row, activeFilter, currentUser) && matchesSearch(row, searchQuery)), sortKey);
  const presetCounts = presetCountsFor(rows);
  const hasActiveControls = selectedPreset !== "all_active" || selectedCommandGroup !== null || activeFilter !== "all" || departmentFilter !== "all" || searchQuery.trim().length > 0 || sortKey !== "priority";
  const filterSummary = activeFilter === "all" ? "all work" : FILTER_LABELS[activeFilter].toLowerCase();
  const presetSummary = PRESET_LABELS[selectedPreset];
  const commandSummary = selectedCommandGroup ? COMMAND_GROUP_ORDER.find((group) => group.id === selectedCommandGroup)?.label : null;
  const departmentSummary = departmentFilter === "all" ? "all departments" : DEPARTMENT_FILTER_LABELS[departmentFilter];
  const searchSummary = searchQuery.trim();
  const activeFilterSummaryId = "project-tracking-active-filter-summary";
  const timelineReferenceDate = commandReferenceDate(payload?.generated_at);
  const emptyStateCopy = !rows.length
    ? "No active work data is available yet. This is not a filtered result."
    : selectedCommandGroup && !presetRows.length
      ? `No work items match the ${commandSummary ?? "selected"} command filter. Clear filters to return to all active work.`
      : searchSummary
        ? `No work items match "${searchSummary}" inside ${presetSummary}. Clear the search or filters to broaden the view.`
        : presetRows.length
          ? `No work items match the current filters inside ${presetSummary}. Clear filters to broaden the view.`
          : PRESET_EMPTY_STATES[selectedPreset];
  return (
    <section className="project-tracking-job-board">
      <div className="project-tracking-panel__heading">
        <div>
          <div className="section-title">Active Work</div>
          <p className="section-subtitle">Start here to see what work exists, who owns the next step, what is blocked, what is due soon, and what changed recently.</p>
        </div>
        <div className="project-tracking-board-meta">
          <span className="badge">Showing {filteredRows.length} of {presetRows.length}</span>
          {payload?.generated_at ? <span className="badge">Updated {new Date(payload.generated_at).toLocaleTimeString()}</span> : null}
        </div>
      </div>
      <ProjectTrackingViewSwitcher viewMode={viewMode} onViewModeChange={onViewModeChange} />
      <div className="project-tracking-preset-row" aria-label="Project Tracking preset lenses">
        <div className="project-tracking-preset-row__label">
          <strong>Preset lenses</strong>
          <span>Temporary view only</span>
        </div>
        <div className="project-tracking-preset-row__buttons">
          {presetCounts.map((presetOption) => (
            <button
              className={`project-tracking-preset-button ${selectedPreset === presetOption.preset ? "is-active" : ""}`}
              type="button"
              key={presetOption.preset}
              aria-pressed={selectedPreset === presetOption.preset}
              aria-label={`${presetOption.label}, ${presetOption.count} ${presetOption.count === 1 ? "item" : "items"}${selectedPreset === presetOption.preset ? ", active preset" : ""}`}
              onClick={() => onPresetChange(presetOption.preset)}
            >
              <span>{presetOption.label}</span>
              <strong>{presetOption.count}</strong>
              {selectedPreset === presetOption.preset ? <em>Active</em> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="project-tracking-controls" aria-label="Project tracking search and sorting">
        <label className="project-tracking-search">
          <span>Search</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="Search work, schools, owners, next steps..."
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </label>
        <label className="project-tracking-sort">
          <span>Department</span>
          <select
            value={departmentFilter}
            title="Uses the current workflow step department until job-level department/category is available."
            onChange={(event) => onDepartmentFilterChange(event.target.value as ProjectTrackingDepartmentFilter)}
          >
            {(Object.keys(DEPARTMENT_FILTER_LABELS) as ProjectTrackingDepartmentFilter[]).map((filterOption) => (
              <option key={filterOption} value={filterOption}>
                {DEPARTMENT_FILTER_LABELS[filterOption]}
              </option>
            ))}
          </select>
        </label>
        <label className="project-tracking-sort">
          <span>Sort</span>
          <select value={sortKey} onChange={(event) => onSortKeyChange(event.target.value as ProjectTrackingSort)}>
            {(Object.keys(SORT_LABELS) as ProjectTrackingSort[]).map((sortOption) => (
              <option key={sortOption} value={sortOption}>
                {SORT_LABELS[sortOption]}
              </option>
            ))}
          </select>
        </label>
        <button className="project-tracking-control-button" type="button" disabled title="Saved views need a setup pass before this becomes a real workflow tool. Planned levels: personal, department default, and company default.">
          Saved views planned
        </button>
      </div>
      <div className="project-tracking-filter-row" aria-label="Project tracking filters">
        {PRIMARY_FILTERS.map((filter) => (
          <button
            className={`project-tracking-filter-button ${activeFilter === filter ? "is-active" : ""}`}
            type="button"
            key={filter}
            aria-pressed={activeFilter === filter}
            aria-label={`${FILTER_LABELS[filter]} filter${activeFilter === filter ? ", active" : ""}`}
            onClick={() => onFilterChange(filter)}
          >
            {FILTER_LABELS[filter]}
            {activeFilter === filter ? <span className="project-tracking-active-marker">Active</span> : null}
          </button>
        ))}
      </div>
      <div className="project-tracking-active-filter" id={activeFilterSummaryId} aria-live="polite">
        <span>
          Showing {filteredRows.length} of {presetRows.length} work items - Preset: {presetSummary} - {departmentSummary} - Filtered by {filterSummary}
          {commandSummary ? ` - Command: ${commandSummary}` : ""}
          {searchSummary ? ` - Search: "${searchSummary}"` : ""}
        </span>
        {hasActiveControls ? (
          <button type="button" aria-label="Clear Project Tracking filters and return to all active work" onClick={onClearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
      {filteredRows.length ? (
        viewMode === "board" ? (
          <ProjectTrackingBoardView rows={filteredRows} onOpenWorkflow={onOpenWorkflow} />
        ) : viewMode === "table" ? (
          <ProjectTrackingTableView rows={filteredRows} onOpenWorkflow={onOpenWorkflow} />
        ) : viewMode === "timeline" ? (
          <ProjectTrackingTimelinePreview rows={filteredRows} onOpenWorkflow={onOpenWorkflow} referenceDate={timelineReferenceDate} />
        ) : (
          <div className="project-tracking-job-list" role="list" aria-label="Project Tracking active work list" aria-describedby={activeFilterSummaryId}>
            {filteredRows.map((row) => {
              const phase = phasePresentation(row.phase, row.health);
              const expanded = expandedRows.has(row.job_id);
              const currentStep = currentStepLabel(row);
              const owner = ownerPresentation(row);
              const rowName = workItemName(row);
              const detailsId = projectTrackingDomId("project-tracking-work-details", row.job_id);
              const titleId = projectTrackingDomId("project-tracking-work-title", row.job_id);
              const waiting = row.blocked_reason || (row.waiting_on_party !== "none" && row.waiting_on_party !== "unknown" ? waitingOnLabel(row) : null);
              return (
                <article className={`project-tracking-job-row ${phase.className}`} key={row.job_id} role="listitem" aria-labelledby={titleId}>
                  <div className="project-tracking-job-row__summary">
                    <div className="project-tracking-work-card__main">
                      <div className="project-tracking-work-card__title-row">
                        <div>
                          <span className="project-tracking-work-card__eyebrow">{departmentLabel(row.current_step?.department)} / {workItemAccountLabel(row)}</span>
                          <h3 id={titleId} title={row.job_title}>{rowName}</h3>
                        </div>
                        <span className={`project-tracking-step-pill ${phase.pillClassName}`} aria-label={`Phase: ${phase.label}`}>{phase.label}</span>
                      </div>
                      <div className="project-tracking-work-card__meta" aria-label={`${rowName} summary`}>
                        <span>
                          <small>Owner</small>
                          <strong className={owner.className} title={`${owner.primary} - ${owner.secondary}`}>{owner.primary}</strong>
                        </span>
                        <span>
                          <small>Due</small>
                          <strong title={row.next_deadline_at ?? undefined}>{deadlineLabel(row)}</strong>
                        </span>
                        <span>
                          <small>Next Step</small>
                          <strong title={currentStep}>{currentStep}</strong>
                        </span>
                      </div>
                      <div className="project-tracking-work-card__attention">
                        <span className={`project-tracking-risk-badge project-tracking-risk-badge--${healthToneForJob(row)}`} aria-label={`Risk: ${healthLabel(row.health)}`}>{healthLabel(row.health)}</span>
                        <span className={`project-tracking-operational-status project-tracking-operational-status--${operationalToneForJob(row)}`} aria-label={`Operational status: ${operationalStatusLabel(row)}`}>
                          {operationalStatusLabel(row)}
                        </span>
                        {waiting ? <span className="project-tracking-attention-chip">Waiting On: {waiting}</span> : null}
                        {row.missing_info_flags.length ? <span className="project-tracking-attention-chip">Missing Info</span> : null}
                      </div>
                      <p className="project-tracking-work-card__next-action">{row.queue_intelligence.next_action}</p>
                    </div>
                    <div className="project-tracking-work-card__actions">
                      <ProjectTrackingWorkAction row={row} onOpenWorkflow={onOpenWorkflow} />
                      <button
                        className="project-tracking-details-toggle"
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        aria-label={`${expanded ? "Collapse details for" : "Expand details for"} ${rowName}`}
                        onClick={() => onToggleRow(row.job_id)}
                      >
                        {expanded ? "Collapse details" : "Details"}
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="project-tracking-job-row__details" id={detailsId} aria-label={`${rowName} details`}>
                    <section>
                      <h4>Workflow Details</h4>
                      <div className="project-tracking-job-row__detail-grid">
                        <div>
                          <span>Current step</span>
                          <strong>{currentStep}</strong>
                        </div>
                        <div>
                          <span>Step status</span>
                          <strong>{row.current_step ? statusLabel(row.current_step.status) : phase.label}</strong>
                        </div>
                        <div>
                          <span>Step details</span>
                          <strong>{row.current_step?.description || "No extra step notes yet."}</strong>
                        </div>
                        {row.workflow_run_id && row.current_step ? (
                          <div>
                            <span>Move step</span>
                            <QuickWorkflowNextStepMover
                              token={token}
                              workflowRunId={row.workflow_run_id}
                              pillClassName={phase.pillClassName}
                              step={{
                                id: row.current_step.id,
                                name: currentStep,
                                workflow_run_id: row.workflow_run_id,
                                status: row.current_step.status,
                                assigned_user_id: row.current_step.assigned_user_id,
                                assigned_queue: row.current_step.assigned_queue,
                                updated_at: row.current_step.updated_at
                              }}
                              onSaved={onWorkflowRowUpdated}
                            />
                          </div>
                        ) : null}
                      </div>
                    </section>
                    <section>
                      <h4>Owner / Queue</h4>
                      <div className="project-tracking-job-row__detail-grid">
                        <div>
                          <span>Owner</span>
                          <strong>{owner.primary}</strong>
                        </div>
                        <div>
                          <span>Owner source</span>
                          <strong>{owner.secondary}</strong>
                        </div>
                        <div>
                          <span>Department</span>
                          <strong>{row.queue_intelligence.owner_lane}</strong>
                        </div>
                        <div>
                          <span>Shared note</span>
                          <strong>{row.current_step?.notes || "No shared note yet."}</strong>
                        </div>
                      </div>
                    </section>
                    <section>
                      <h4>Deadlines</h4>
                      <div className="project-tracking-job-row__detail-grid">
                        <div>
                          <span>Due</span>
                          <strong>{deadlineLabel(row)}</strong>
                        </div>
                        <div>
                          <span>Job date</span>
                          <strong title={row.job_date ?? "Job date is not connected yet."}>{dateLabel(row.job_date) ?? "Job date not connected yet"}</strong>
                        </div>
                        <div>
                          <span>Recent activity</span>
                          <strong>{new Date(row.updated_at).toLocaleString()}</strong>
                        </div>
                      </div>
                    </section>
                    <section>
                      <h4>Blockers / Waiting</h4>
                      <div className="project-tracking-job-row__detail-grid">
                        <div>
                          <span>Waiting On</span>
                          <strong>{row.blocked_reason || waitingOnLabel(row)}</strong>
                        </div>
                        <div>
                          <span>Why it matters</span>
                          <strong>{row.queue_intelligence.reason}</strong>
                        </div>
                        <div>
                          <span>Clear condition</span>
                          <strong>{row.queue_intelligence.clear_condition}</strong>
                        </div>
                      </div>
                    </section>
                    {row.missing_info_flags.length ? (
                      <section>
                        <h4>Missing Info</h4>
                        <p>{row.missing_info_flags.map((flag) => friendlyName(flag)).join(", ")}</p>
                      </section>
                    ) : null}
                    <section>
                      <h4>Related Job / Account</h4>
                      <div className="project-tracking-job-row__detail-grid">
                        <div>
                          <span>Job record</span>
                          <strong title={row.job_id}>{row.job_number ?? row.job_code ?? row.job_id}</strong>
                        </div>
                        <div>
                          <span>File status</span>
                          <strong>{fileStatusLabelForJob(row)}</strong>
                        </div>
                        <div>
                          <span>Workflow</span>
                          {row.workflow_run_id ? (
                            <ProjectTrackingWorkAction row={row} onOpenWorkflow={onOpenWorkflow} />
                          ) : (
                            <strong>This work is not connected to a workflow yet.</strong>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
                ) : null}
              </article>
            );
          })}
          </div>
        )
      ) : (
        <p className="section-subtitle project-tracking-empty-state" role="status" aria-live="polite">
          {emptyStateCopy}
        </p>
      )}
    </section>
  );
}

export function ProjectTrackingFoundation({ token, currentUser }: Props) {
  const [globalCommandCenter, setGlobalCommandCenter] = useState<ProjectWorkflowCommandCenter | null>(null);
  const [workflow, setWorkflow] = useState<ProjectWorkflowInstance | null>(null);
  const [workflowRunId, setWorkflowRunId] = useState(() => parseWorkflowRunIdFromHash());
  const [status, setStatus] = useState<LoadState>("loading");
  const [activeFilter, setActiveFilter] = useState<ProjectTrackingFilter>("all");
  const [selectedPreset, setSelectedPreset] = useState<ProjectTrackingPreset>("all_active");
  const [selectedCommandGroup, setSelectedCommandGroup] = useState<ProjectTrackingCommandGroupId | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<ProjectTrackingDepartmentFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProjectTrackingSort>("priority");
  const [viewMode, setViewMode] = useState<ProjectTrackingViewMode>("command");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const handleHashChange = () => setWorkflowRunId(parseWorkflowRunIdFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    Promise.all([
      getProjectWorkflowCommandCenter(token, { view: "global", limit: 100 }),
      workflowRunId ? getProjectWorkflowInstance(token, workflowRunId) : Promise.resolve(null)
    ])
      .then(([globalResponse, workflowResponse]) => {
        if (!active) {
          return;
        }
        setGlobalCommandCenter(globalResponse);
        setWorkflow(workflowResponse);
        setStatus("ready");
        setExpandedRows(new Set());
      })
      .catch(() => {
        if (active) {
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [token, workflowRunId]);

  if (status === "loading") {
    return <WorkspaceLoadingBlock title="Loading Project Tracking" summary="Building active work from live project data." />;
  }

  const globalSummary = summaryFor(globalCommandCenter);
  const summaryMetrics: Array<{ filter: ProjectTrackingFilter; label: string; value: number; title?: string }> = [
    { filter: "all", label: "Active Work", value: globalSummary.total_active_workflows },
    { filter: "due_soon", label: "Due Soon", value: globalSummary.total_due_soon },
    { filter: "blocked", label: "Blocked", value: globalSummary.total_blocked },
    {
      filter: "waiting_review",
      label: "Review Required",
      value: globalSummary.total_needs_attention,
      title: "Closest existing count: blocked, late, due-soon, or at-risk work that should be reviewed before it drifts."
    },
    {
      filter: "recently_changed",
      label: "Recently Changed",
      value: summaryRecentlyChangedCount(globalCommandCenter),
      title: "Rows in the current response that include a recent activity timestamp."
    }
  ];
  const jobBoardRows = buildJobBoardRows(globalCommandCenter);
  const commandGroups = commandGroupsFor(jobBoardRows, globalCommandCenter?.generated_at);
  const commandCount = (groupId: ProjectTrackingCommandGroupId) => commandGroups.find((group) => group.id === groupId)?.rows.length ?? 0;
  const openFirstCards: DepartmentHubCard[] = [
    { label: "Blocked Projects", value: commandCount("blocked"), detail: "Blocked work that needs an owner, clear condition, or leadership unblock.", href: "#project-tracking", tone: commandCount("blocked") ? "danger" : "success" },
    { label: "Due This Week", value: commandCount("due_this_week"), detail: "Projects and workflow steps with a deadline in the next seven days.", href: "#project-tracking", tone: commandCount("due_this_week") ? "warning" : "success" },
    { label: "Waiting On Owner", value: commandCount("missing_owner_info"), detail: "Missing owner, missing next action, or missing info before work moves.", href: "#project-tracking", tone: commandCount("missing_owner_info") ? "warning" : "success" },
    { label: "Leadership Decisions", value: commandCount("at_risk"), detail: "At-risk or overdue work that should be reviewed before it drifts.", href: "#needs-attention", tone: commandCount("at_risk") ? "danger" : "success" }
  ];
  const attentionCards: DepartmentHubCard[] = [
    { label: "Blocked", value: globalSummary.total_blocked, detail: "Blocked projects need a reason, owner, and clear next action.", href: "#project-tracking", tone: globalSummary.total_blocked ? "danger" : "success" },
    { label: "Needs Attention", value: globalSummary.total_needs_attention, detail: "Review required across blocked, late, due-soon, or at-risk work.", href: "#needs-attention", tone: globalSummary.total_needs_attention ? "warning" : "success" },
    { label: "Missing Owner / Info", value: commandCount("missing_owner_info"), detail: "Ownerless or incomplete work should not stay invisible.", href: "#project-tracking", tone: commandCount("missing_owner_info") ? "warning" : "success" }
  ];
  const weeklyCards: DepartmentHubCard[] = [
    { label: "Active Projects", value: globalSummary.total_active_workflows, detail: "Active workflow-backed work in the shared spine.", href: "#project-tracking", tone: "info" },
    { label: "Due This Week", value: commandCount("due_this_week"), detail: "Milestones and next steps due in the current week.", href: "#project-tracking", tone: commandCount("due_this_week") ? "warning" : "success" },
    { label: "Recently Changed", value: summaryRecentlyChangedCount(globalCommandCenter), detail: "Work records with current activity timestamps.", href: "#project-tracking", tone: "info" }
  ];
  const queueCards: DepartmentHubCard[] = [
    { label: "Active Projects", detail: "Open the main work list.", href: "#project-tracking", tone: "info" },
    { label: "Blocked", detail: "Use the Blocked lens in Project Tracking.", href: "#project-tracking", tone: "danger" },
    { label: "Due This Week", detail: "Use Command View to filter deadline pressure.", href: "#project-tracking", tone: "warning" },
    { label: "Waiting On Leadership", detail: "Open Needs Attention for decisions and exceptions.", href: "#needs-attention", tone: "warning" }
  ];
  const toggleExpandedRow = (rowId: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };
  const clearFilters = () => {
    setSelectedCommandGroup(null);
    setSelectedPreset("all_active");
    setActiveFilter("all");
    setDepartmentFilter("all");
    setSearchQuery("");
    setSortKey("priority");
  };
  const applyPreset = (preset: ProjectTrackingPreset) => {
    setSelectedCommandGroup(null);
    setSelectedPreset(preset);
    setActiveFilter("all");
    setDepartmentFilter("all");
    setSearchQuery("");
    setSortKey(preset === "due_soon" ? "deadline" : preset === "leadership_review" || preset === "blocked" || preset === "at_risk" ? "risk" : "priority");
  };
  const applyCommandGroup = (group: ProjectTrackingCommandGroup) => {
    setSelectedCommandGroup(group.id);
    setSelectedPreset("all_active");
    setActiveFilter("all");
    setDepartmentFilter("all");
    setSearchQuery("");
    setSortKey(group.sortKey);
  };
  const applyPrimaryFilter = (filter: ProjectTrackingFilter) => {
    setSelectedCommandGroup(null);
    setActiveFilter(filter);
  };
  const applySummaryMetric = (filter: ProjectTrackingFilter) => {
    setSelectedCommandGroup(null);
    setActiveFilter(filter);
    if (filter === "recently_changed") {
      setSortKey("updated");
    }
  };
  const refreshCommandCenter = async () => {
    const globalResponse = await getProjectWorkflowCommandCenter(token, { view: "global", limit: 100 });
    setGlobalCommandCenter(globalResponse);
  };
  const handleWorkflowUpdated = (updatedWorkflow: ProjectWorkflowInstance) => {
    setWorkflow(updatedWorkflow);
    void refreshCommandCenter().catch(() => undefined);
  };
  const openWorkflowProgress = (nextWorkflowRunId: string) => {
    setWorkflowRunId(nextWorkflowRunId);
    const nextHash = `#project-tracking/workflows/${encodeURIComponent(nextWorkflowRunId)}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  };
  const isWorkflowRoute = Boolean(workflowRunId);

  return (
    <main className="workspace-page project-tracking-foundation-page">
      {!isWorkflowRoute ? (
        <section className="project-tracking-board-header" aria-label="Project Tracking">
          <div>
            <p className="section-kicker">Operations</p>
            <h1>Project Tracking</h1>
            <p>Track internal projects, owners, blockers, milestones, and leadership decisions.</p>
          </div>
          <div className="project-tracking-board-header__actions">
            <a className="button button-secondary" href="#needs-attention">
              Open Needs Attention
            </a>
            <a className="button button-secondary" href="#prep-readiness">
              Prep Readiness
            </a>
            {featureFlags.workflowTemplateBuilderV1 && canManageWorkflowTemplates(currentUser) ? (
              <a className="button button-secondary" href="#project-tracking/workflow-templates">
                Workflow Templates
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="panel" role="alert" aria-label="Project dashboard unavailable">
          <div className="section-title">Project dashboard is unavailable</div>
          <p className="section-subtitle">Project Tracking did not load. Try again before using this page for live decisions.</p>
        </section>
      ) : null}

      {isWorkflowRoute ? (
        workflow ? (
          <ProjectWorkflowMap workflow={workflow} token={token} currentUser={currentUser} onWorkflowUpdated={handleWorkflowUpdated} />
        ) : (
          <section className="panel">
            <div className="section-title">Live job workflow unavailable</div>
            <p className="section-subtitle">This work record could not be loaded. Return to Project Tracking and try another item.</p>
            <a className="button button-secondary" href="#project-tracking">
              Back to Project Tracking
            </a>
          </section>
        )
      ) : (
        <>
          <DepartmentHubPattern
            department="Project Tracking"
            openFirst={openFirstCards}
            attention={attentionCards}
            weekly={weeklyCards}
            queues={queueCards}
            notes={<span>Command View tells what matters; the main work list and workflow detail keep the source of truth one click away.</span>}
          />

          <ProjectTrackingCommandView
            payload={globalCommandCenter}
            selectedCommandGroup={selectedCommandGroup}
            onCommandGroupSelect={applyCommandGroup}
          />

          <section className="project-tracking-summary-strip" aria-label="Project tracking summary filters">
            <div className="project-tracking-summary-strip__label">
              <strong>Operating Summary</strong>
              <span>{globalSummary.source === "true_totals" ? "True totals before row limits" : "Shown rows only"}</span>
              <small>Use Needs Attention for the review queue; use this page to inspect the work record.</small>
            </div>
            <div className="project-tracking-metric-grid">
              {summaryMetrics.map((metric) => (
                <button
                  className={activeFilter === metric.filter ? "is-active" : ""}
                  key={`${metric.filter}:${metric.label}`}
                  type="button"
                  title={metric.title}
                  aria-pressed={activeFilter === metric.filter}
                  aria-label={`${metric.label}, ${metric.value} ${metric.value === 1 ? "item" : "items"}${activeFilter === metric.filter ? ", active filter" : ""}`}
                  onClick={() => applySummaryMetric(metric.filter)}
                >
                  <span className="metric-label">{metric.label}</span>
                  <strong>{metric.value}</strong>
                  {activeFilter === metric.filter ? <span className="project-tracking-active-marker">Active</span> : null}
                </button>
              ))}
            </div>
          </section>

          <ProjectTrackingJobBoard
            token={token}
            payload={globalCommandCenter}
            currentUser={currentUser}
            viewMode={viewMode}
            activeFilter={activeFilter}
            selectedPreset={selectedPreset}
            selectedCommandGroup={selectedCommandGroup}
            departmentFilter={departmentFilter}
            searchQuery={searchQuery}
            sortKey={sortKey}
            expandedRows={expandedRows}
            onViewModeChange={setViewMode}
            onFilterChange={applyPrimaryFilter}
            onDepartmentFilterChange={setDepartmentFilter}
            onPresetChange={applyPreset}
            onSearchQueryChange={setSearchQuery}
            onSortKeyChange={setSortKey}
            onClearFilters={clearFilters}
            onToggleRow={toggleExpandedRow}
            onOpenWorkflow={openWorkflowProgress}
            onWorkflowRowUpdated={refreshCommandCenter}
          />
        </>
      )}
    </main>
  );
}
