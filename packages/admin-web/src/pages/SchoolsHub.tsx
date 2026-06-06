import { useEffect, useMemo, useState } from "react";
import { buildSharedJobHash } from "../components/jobs/sharedJobRouting";
import { QuickCreateJobDrawer } from "../components/jobIntake/QuickCreateJobDrawer";
import { ProjectTrackingDepartmentQueue } from "../components/projectTracking/ProjectTrackingDepartmentQueue";
import { ResumeDraftsDrawer } from "../components/jobIntake/ResumeDraftsDrawer";
import { StatusPill, formatDate, formatDateTime, humanizeToken, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import { featureFlags } from "../featureFlags";
import type { SharedDashboardResponse, SharedExceptionListItem, SharedJobListItem } from "../jobTruthTypes";
import { canCreateShootRecords, canReadNotifications, getSchoolsHubAccessScope } from "../permissions";
import type { SchoolWorkItemRecord, SchoolsHubWorkspaceResponse } from "../schoolsHubTypes";
import { getSharedDashboard, listSharedExceptions, listSharedJobs } from "../services/jobsApi";
import { getProjectWorkflowCommandCenter } from "../services/projectTracking";
import { getSchoolsHubWorkspace } from "../services/schoolsHubApi";
import { listSharedTasks } from "../services/tasksApi";
import type { ProjectWorkflowJobRow } from "../projectTrackingTypes";
import type { SessionUser } from "../types";
import type { SharedTaskListItem } from "../workModelTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type SchoolsPrimaryTab = "jobs" | "tasks" | "exceptions";
type JobsFocus = "all" | "open" | "overdue" | "stalled";
type TasksView = "my" | "employee" | "role" | "overdue" | "today" | "week";
type ExceptionsFocus =
  | "all"
  | "critical_high"
  | "ownerless"
  | "stalled"
  | "missing_data"
  | "gallery_release"
  | "yearbook"
  | "delivery"
  | "id_issues";

type SourceErrors = {
  workspace: string;
  jobs: string;
  tasks: string;
  exceptions: string;
  dashboard: string;
  projectTracking: string;
};

type SelectOption = {
  value: string;
  label: string;
};

type AttentionItem = {
  id: string;
  title: string;
  summary: string;
  owner: string;
  dueLabel: string;
  tone: "warning" | "danger";
  routeHash: string;
};

type OverviewCard = {
  label: string;
  value: number;
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
  routeHash: string;
  actionLabel: string;
};

type BoardWorkflowHealth = "green" | "yellow" | "red";

type BoardWorkflowSummary = {
  key: string;
  name: string;
  sourceLabel: string;
  openCount: number;
  overdueCount: number;
  blockedCount: number;
  dueThisWeekCount: number;
  waitingOnSchoolCount: number;
  waitingOnKpCount: number;
  missingInfoCount: number;
  nextDeadline: string | null;
  primaryOwner: string;
  health: BoardWorkflowHealth;
  routeHash: string;
};

type SchoolsDashboardRow = {
  id: string;
  jobId: string | null;
  dueDate: string;
  school: string;
  contactLabel: string;
  jobType: string;
  currentStep: string;
  nextAction: string;
  owner: string;
  status: string;
  riskLabel: string;
  riskTone: "neutral" | "info" | "success" | "warning" | "danger";
  updatedAt: string;
  workflowHash: string;
  jobHash: string;
  accountHash: string | null;
  hasWorkflow: boolean;
  actionLabel: string;
  openTaskCount: number;
  exceptionCount: number;
  proofApprovalPending: boolean;
  staffingIssue: boolean;
  productionIssue: boolean;
  clientConcern: boolean;
};

type TaskGroup = {
  key: string;
  label: string;
  items: SharedTaskListItem[];
  overdueCount: number;
};

const EMPTY_ERRORS: SourceErrors = {
  workspace: "",
  jobs: "",
  tasks: "",
  exceptions: "",
  dashboard: "",
  projectTracking: ""
};

const JOBS_PAGE_SIZE = 8;
const TASKS_PAGE_SIZE = 8;
const EXCEPTIONS_PAGE_SIZE = 8;
const WORKSPACE_QUEUE_PAGE_SIZE = 100;
const SCHOOLS_OPERATING_BOARD_ROW_LIMIT = 14;

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getActiveTab(path: string): SchoolsPrimaryTab {
  switch (path) {
    case "schools/tasks":
    case "schools/workload":
    case "schools/production":
      return "tasks";
    case "schools/watchlist":
    case "schools/exceptions":
      return "exceptions";
    default:
      return "jobs";
  }
}

function isJobsFocus(value: string | null): value is JobsFocus {
  return value === "all" || value === "open" || value === "overdue" || value === "stalled";
}

function isTasksView(value: string | null): value is TasksView {
  return value === "my" || value === "employee" || value === "role" || value === "overdue" || value === "today" || value === "week";
}

function isExceptionsFocus(value: string | null): value is ExceptionsFocus {
  return value === "all" || value === "critical_high" || value === "ownerless" || value === "stalled" || value === "missing_data" || value === "gallery_release" || value === "yearbook" || value === "delivery" || value === "id_issues";
}

function buildSchoolsTabHash(tab: SchoolsPrimaryTab, query: Record<string, string | null | undefined> = {}) {
  const baseHash = tab === "jobs" ? "#schools/jobs" : tab === "tasks" ? "#schools/tasks" : "#schools/exceptions";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }
  return params.toString() ? `${baseHash}?${params.toString()}` : baseHash;
}

function navigateToSchoolsTab(tab: SchoolsPrimaryTab, query: Record<string, string | null | undefined> = {}) {
  window.location.hash = buildSchoolsTabHash(tab, query);
}

function navigateToUtility(hash: string) {
  window.location.hash = hash;
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function endOfToday() {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return today;
}

function isBeforeToday(value: string | null | undefined) {
  const parsed = parseDate(value);
  return parsed ? parsed.getTime() < startOfToday().getTime() : false;
}

function isToday(value: string | null | undefined) {
  const parsed = parseDate(value);
  return parsed ? parsed.getTime() >= startOfToday().getTime() && parsed.getTime() <= endOfToday().getTime() : false;
}

function isThisWeek(value: string | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) {
    return false;
  }
  const diffDays = (parsed.getTime() - startOfToday().getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

function toneForState(value: string | null | undefined): "neutral" | "info" | "success" | "warning" | "danger" {
  switch ((value ?? "").toLowerCase()) {
    case "completed":
    case "done":
    case "ready":
      return "success";
    case "blocked":
    case "critical":
    case "cancelled":
    case "overdue":
      return "danger";
    case "at_risk":
    case "on_hold":
    case "waiting":
    case "warning":
      return "warning";
    case "active":
    case "published":
    case "in_progress":
      return "info";
    default:
      return "neutral";
  }
}

function matchesSearch(query: string, values: Array<string | null | undefined>) {
  if (!query.trim()) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function isOpenJob(job: SharedJobListItem) {
  return job.archived_at == null && job.cancelled_at == null && !["completed", "cancelled"].includes(job.job_status);
}

function isJobOverdue(job: SharedJobListItem) {
  return isOpenJob(job) && (isBeforeToday(job.client_deadline_at) || isBeforeToday(job.production_deadline_at));
}

function isJobStalled(job: SharedJobListItem) {
  return (
    isOpenJob(job) &&
    (job.blocker_count > 0 ||
      job.open_watch_flag_count > 0 ||
      ["on_hold", "blocked"].includes(job.job_status) ||
      ["at_risk", "blocked", "critical"].includes(job.risk_status))
  );
}

function jobCurrentStep(job: SharedJobListItem) {
  if (isJobStalled(job)) {
    return "Needs follow-through";
  }
  if ((job.primary_day_date && isToday(job.primary_day_date)) || (job.scheduled_start_at && isToday(job.scheduled_start_at))) {
    return "Picture day";
  }
  if ((job.primary_day_date && !isBeforeToday(job.primary_day_date)) || (job.scheduled_start_at && !isBeforeToday(job.scheduled_start_at))) {
    return "Prep";
  }
  if (job.production_required && !["completed", "delivered", "published"].includes((job.production_status ?? "").toLowerCase())) {
    return "Digital production";
  }
  if (job.school_profile?.submission_deadline || job.client_deadline_at || job.production_deadline_at) {
    return "Release and delivery";
  }
  return humanizeToken(job.job_status);
}

function isTaskOverdue(task: SharedTaskListItem) {
  return task.status !== "completed" && isBeforeToday(task.due_at);
}

function isTaskDueToday(task: SharedTaskListItem) {
  return task.status !== "completed" && isToday(task.due_at);
}

function isTaskDueThisWeek(task: SharedTaskListItem) {
  return task.status !== "completed" && isThisWeek(task.due_at);
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(page, 1);
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1);
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    currentPage,
    totalPages,
    items: items.slice(start, start + pageSize)
  };
}

function buildSelectOptions(entries: SelectOption[]) {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (entry.value && entry.label && !seen.has(entry.value)) {
      seen.set(entry.value, entry.label);
    }
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label));
}

function roleKeyForTask(task: SharedTaskListItem) {
  if (task.assigned_team_id?.trim()) {
    return `team:${task.assigned_team_id.trim().toLowerCase()}`;
  }
  const normalized = (task.task_type || "").toLowerCase();
  if (normalized.includes("director")) {
    return "role:director_of_school_photography";
  }
  if (normalized.includes("client_success") || normalized.includes("csr")) {
    return "role:client_success_team";
  }
  if (normalized.includes("gallery")) {
    return "role:gallery_release";
  }
  if (normalized.includes("yearbook")) {
    return "role:yearbook";
  }
  if (normalized.includes("id")) {
    return "role:id_team";
  }
  if (normalized.includes("delivery")) {
    return "role:delivery";
  }
  return "role:unassigned_role";
}

function roleLabelForTaskKey(key: string) {
  if (key.startsWith("team:")) {
    return humanizeToken(key.slice(5));
  }
  switch (key) {
    case "role:director_of_school_photography":
      return "Director of School Photography";
    case "role:client_success_team":
      return "Client Success Team";
    case "role:gallery_release":
      return "Gallery Release";
    case "role:yearbook":
      return "Yearbook";
    case "role:id_team":
      return "ID Team";
    case "role:delivery":
      return "Delivery";
    default:
      return "Unassigned Role";
  }
}

function buildTaskGroups(tasks: SharedTaskListItem[], mode: "employee" | "role"): TaskGroup[] {
  const grouped = new Map<string, SharedTaskListItem[]>();
  for (const task of tasks) {
    const key = mode === "employee" ? task.assigned_to_name?.trim() || "Unassigned" : roleKeyForTask(task);
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  return [...grouped.entries()]
    .map(([key, items]) => ({
      key,
      label: mode === "employee" ? key : roleLabelForTaskKey(key),
      items: [...items].sort((left, right) => (parseDate(left.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseDate(right.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER)),
      overdueCount: items.filter((item) => isTaskOverdue(item)).length
    }))
    .sort((left, right) => right.items.length - left.items.length || left.label.localeCompare(right.label));
}

function exceptionCategory(item: SharedExceptionListItem): Exclude<ExceptionsFocus, "all" | "critical_high" | "ownerless"> {
  const haystack = [item.flag_type, item.title, item.description, item.next_action_label, item.source_entity_label].filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes("gallery")) {
    return "gallery_release";
  }
  if (haystack.includes("yearbook")) {
    return "yearbook";
  }
  if (haystack.includes("delivery")) {
    return "delivery";
  }
  if (haystack.includes(" id ") || haystack.startsWith("id") || haystack.includes("badge")) {
    return "id_issues";
  }
  if (haystack.includes("missing") || haystack.includes("roster") || haystack.includes("data")) {
    return "missing_data";
  }
  return "stalled";
}

function matchesExceptionsFocus(item: SharedExceptionListItem, focus: ExceptionsFocus) {
  if (focus === "all") {
    return true;
  }
  if (focus === "critical_high") {
    return item.severity === "critical" || item.severity === "high";
  }
  if (focus === "ownerless") {
    return !item.owner_user_id;
  }
  return exceptionCategory(item) === focus;
}

function toTaskHash(taskId: string) {
  return `#tasks/${taskId}`;
}

function toSchoolsJobHash(jobId: string) {
  return buildSharedJobHash("#schools/jobs", jobId);
}

function toWorkflowTarget(row: ProjectWorkflowJobRow | undefined, fallbackJobId: string | null | undefined) {
  if (row?.workflow_run_id) {
    return {
      actionLabel: "Open Job Workflow",
      hasWorkflow: true,
      hash: `#project-tracking/workflows/${row.workflow_run_id}`
    };
  }
  return {
    actionLabel: "Open Job Detail",
    hasWorkflow: false,
    hash: fallbackJobId ? toSchoolsJobHash(fallbackJobId) : "#schools/jobs"
  };
}

function toSchoolsReviewTarget() {
  return {
    actionLabel: "Review in Schools",
    hasWorkflow: false,
    hash: "#schools"
  };
}

function jobOwnerName(job: SharedJobListItem) {
  return job.lead_owner_name ?? job.account_owner_name ?? "Unassigned";
}

function startOfAnchorDay(anchorDate: string | null | undefined) {
  const parsed = anchorDate ? new Date(`${anchorDate}T00:00:00`) : startOfToday();
  if (Number.isNaN(parsed.getTime())) {
    return startOfToday();
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function endOfNextSevenDays(anchorDate: string | null | undefined) {
  const end = startOfAnchorDay(anchorDate);
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return end;
}

function dueDateForSchoolJob(job: SharedJobListItem) {
  const dates = [job.production_deadline_at, job.client_deadline_at, job.primary_day_date, job.scheduled_start_at]
    .map(parseDate)
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  return dates[0]?.toISOString() ?? null;
}

function isDueTodayFromAnchor(value: string | null | undefined, anchorDate: string | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) {
    return false;
  }
  const start = startOfAnchorDay(anchorDate);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return parsed.getTime() >= start.getTime() && parsed.getTime() <= end.getTime();
}

function isOverdueFromAnchor(value: string | null | undefined, anchorDate: string | null | undefined) {
  const parsed = parseDate(value);
  return parsed ? parsed.getTime() < startOfAnchorDay(anchorDate).getTime() : false;
}

function isDueWithinSevenDays(value: string | null | undefined, anchorDate: string | null | undefined) {
  const parsed = parseDate(value);
  return parsed ? parsed.getTime() <= endOfNextSevenDays(anchorDate).getTime() : false;
}

function workflowRowStatus(row: ProjectWorkflowJobRow | undefined, fallback: string) {
  if (!row) {
    return humanizeToken(fallback);
  }
  const labels: Record<ProjectWorkflowJobRow["health"], string> = {
    on_track: "On track",
    due_soon: "Due soon",
    running_late: "Running late",
    blocked: "Needs attention",
    at_risk: "Needs attention",
    complete: "Complete",
    no_workflow: "No workflow linked",
    unknown: "Needs review"
  };
  return labels[row.health];
}

function nextActionForSchoolJob(job: SharedJobListItem, row: ProjectWorkflowJobRow | undefined) {
  if (row?.health_reasons[0]) {
    return row.health_reasons[0];
  }
  if (isJobStalled(job)) {
    return "Review issue and move the next step.";
  }
  if (job.production_required && !["completed", "delivered", "published"].includes((job.production_status ?? "").toLowerCase())) {
    return "Keep production moving.";
  }
  return "Open workflow and move the next step.";
}

function nextActionForOperatingBoard(input: {
  job: SharedJobListItem;
  workflowRow: ProjectWorkflowJobRow | undefined;
  jobTasks: SharedTaskListItem[];
  jobExceptions: SharedExceptionListItem[];
  jobWorkItems: SchoolWorkItemRecord[];
}) {
  const urgentException = input.jobExceptions.find((item) => item.severity === "critical" || item.severity === "high");
  if (urgentException) {
    return urgentException.next_action_label;
  }

  const overdueTask = input.jobTasks.find(isTaskOverdue);
  if (overdueTask) {
    return overdueTask.title;
  }

  const waitingWorkItem = input.jobWorkItems.find((item) => item.waiting_on !== "none" || item.stage === "waiting_on_school");
  if (waitingWorkItem) {
    return waitingWorkItem.waiting_on_label || waitingWorkItem.title;
  }

  return input.workflowRow?.queue_intelligence?.next_action || nextActionForSchoolJob(input.job, input.workflowRow);
}

function isIdRelatedText(...values: Array<string | null | undefined>) {
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return /\bids?\b/.test(haystack) || haystack.includes("id card") || haystack.includes("badge") || haystack.includes("admin");
}

function schoolDashboardJobType(job: SharedJobListItem, row: ProjectWorkflowJobRow | undefined) {
  const title = [job.title, row?.job_title].filter(Boolean).join(" ").toLowerCase();
  if (isIdRelatedText(job.title, job.job_category, job.school_profile?.school_type)) {
    return "ID / admin work";
  }
  if (title.includes("retake") || title.includes("makeup") || title.includes("reshoot")) {
    return "Retake Day";
  }
  if (title.includes("graduation")) {
    return "Graduation";
  }
  if (title.includes("family") || title.includes("follow-up") || title.includes("follow up")) {
    return "Family follow-up";
  }
  if (title.includes("yearbook")) {
    return "Yearbook deadline";
  }
  if (title.includes("picture") || title.includes("portrait") || title.includes("photo")) {
    return "Photo Day";
  }
  return humanizeToken(job.job_category ?? job.school_profile?.school_type ?? job.job_status);
}

function isProofApprovalPending(job: SharedJobListItem) {
  const normalized = (job.proof_status ?? "").toLowerCase();
  return Boolean(normalized) && !["approved", "not_required", "not required", "complete", "completed"].includes(normalized);
}

function hasStaffingIssue(job: SharedJobListItem) {
  return ["unassigned", "partially_staffed", "gap_flagged"].includes(job.staffing_status) || job.blocker_count > 0;
}

function hasProductionIssue(job: SharedJobListItem, exceptions: SharedExceptionListItem[]) {
  const productionStatus = (job.production_status ?? "").toLowerCase();
  return (
    (job.production_required && ["blocked", "awaiting_internal_review", "awaiting_approval", "revisions_requested"].includes(productionStatus)) ||
    exceptions.some((item) => ["gallery_release", "yearbook", "delivery"].includes(exceptionCategory(item)))
  );
}

function hasClientConcern(workItems: SchoolWorkItemRecord[], exceptions: SharedExceptionListItem[]) {
  return (
    workItems.some((item) => item.waiting_on === "school" || item.stage === "waiting_on_school" || isSchoolWorkMissingKeyInfo(item)) ||
    exceptions.some((item) => exceptionCategory(item) === "missing_data")
  );
}

function riskForOperatingBoard(input: {
  job: SharedJobListItem;
  workflowRow: ProjectWorkflowJobRow | undefined;
  proofApprovalPending: boolean;
  staffingIssue: boolean;
  productionIssue: boolean;
  clientConcern: boolean;
}) {
  if (input.job.risk_status === "critical" || input.job.risk_status === "high" || input.job.blocker_count > 0 || input.workflowRow?.health === "blocked") {
    return { label: input.job.blocker_count > 0 ? "Blocked" : "High risk", tone: "danger" as const };
  }
  if (isJobOverdue(input.job) || input.workflowRow?.health === "running_late") {
    return { label: "Overdue", tone: "danger" as const };
  }
  if (input.staffingIssue) {
    return { label: "Staffing issue", tone: "warning" as const };
  }
  if (input.productionIssue) {
    return { label: "Production issue", tone: "warning" as const };
  }
  if (input.proofApprovalPending) {
    return { label: "Proof pending", tone: "warning" as const };
  }
  if (input.clientConcern) {
    return { label: "Waiting on school", tone: "warning" as const };
  }
  if (input.workflowRow?.health === "due_soon" || input.job.risk_status === "medium") {
    return { label: "Due soon", tone: "info" as const };
  }
  return { label: "On track", tone: "success" as const };
}

function groupByRelatedJob<T extends { related_job_id?: string | null; job_id?: string | null }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const jobId = item.related_job_id ?? item.job_id ?? null;
    if (!jobId) {
      continue;
    }
    grouped.set(jobId, [...(grouped.get(jobId) ?? []), item]);
  }
  return grouped;
}

function groupWorkItemsBySchoolJob(items: SchoolWorkItemRecord[]) {
  const grouped = new Map<string, SchoolWorkItemRecord[]>();
  for (const item of items) {
    if (!item.school_job_id) {
      continue;
    }
    grouped.set(item.school_job_id, [...(grouped.get(item.school_job_id) ?? []), item]);
  }
  return grouped;
}

function buildSchoolsDashboardRows(
  jobs: SharedJobListItem[],
  queueItems: SchoolWorkItemRecord[],
  workflowRows: ProjectWorkflowJobRow[],
  tasks: SharedTaskListItem[],
  exceptions: SharedExceptionListItem[],
  anchorDate: string | null | undefined
): SchoolsDashboardRow[] {
  const workflowByJob = new Map(workflowRows.map((row) => [row.job_id, row]));
  const tasksByJob = groupByRelatedJob(tasks);
  const exceptionsByJob = groupByRelatedJob(exceptions);
  const workItemsByJob = groupWorkItemsBySchoolJob(queueItems);
  const rows: SchoolsDashboardRow[] = [];

  for (const job of jobs.filter(isOpenJob)) {
    if (!job.organization_name) {
      continue;
    }
    const dueDate = dueDateForSchoolJob(job) ?? job.updated_at;
    const workflowRow = workflowByJob.get(job.id);
    const target = toWorkflowTarget(workflowRow, job.id);
    const jobTasks = tasksByJob.get(job.id) ?? [];
    const jobExceptions = exceptionsByJob.get(job.id) ?? [];
    const jobWorkItems = workItemsByJob.get(job.id) ?? [];
    const proofApprovalPending = isProofApprovalPending(job);
    const staffingIssue = hasStaffingIssue(job);
    const productionIssue = hasProductionIssue(job, jobExceptions);
    const clientConcern = hasClientConcern(jobWorkItems, jobExceptions);
    const risk = riskForOperatingBoard({ job, workflowRow, proofApprovalPending, staffingIssue, productionIssue, clientConcern });
    rows.push({
      id: `job:${job.id}`,
      jobId: job.id,
      dueDate,
      school: job.organization_name,
      contactLabel: job.primary_contact_name ?? "Contact pending",
      jobType: schoolDashboardJobType(job, workflowRow),
      currentStep: workflowRow?.current_step?.name ?? jobCurrentStep(job),
      nextAction: nextActionForOperatingBoard({ job, workflowRow, jobTasks, jobExceptions, jobWorkItems }),
      owner: workflowRow?.owner_display ?? jobOwnerName(job),
      status: workflowRowStatus(workflowRow, job.job_status),
      riskLabel: risk.label,
      riskTone: risk.tone,
      updatedAt: workflowRow?.updated_at ?? job.updated_at,
      workflowHash: target.hash,
      jobHash: toSchoolsJobHash(job.id),
      accountHash: job.organization_id ? "#schools/accounts" : null,
      hasWorkflow: target.hasWorkflow,
      actionLabel: target.actionLabel,
      openTaskCount: jobTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
      exceptionCount: job.open_watch_flag_count || jobExceptions.length,
      proofApprovalPending,
      staffingIssue,
      productionIssue,
      clientConcern
    });
  }

  for (const item of queueItems.filter((candidate) => isOpenSchoolWorkItem(candidate) && isIdRelatedText(candidate.work_type, candidate.title, candidate.description))) {
    if (!item.school_name) {
      continue;
    }
    const dueDate = workItemDeadline(item);
    if (!dueDate || !isDueWithinSevenDays(dueDate, anchorDate)) {
      continue;
    }
    const workflowRow = item.school_job_id ? workflowByJob.get(item.school_job_id) : undefined;
    const target = workflowRow?.workflow_run_id ? toWorkflowTarget(workflowRow, item.school_job_id) : toSchoolsReviewTarget();
    const riskTone = item.due_state === "overdue" || item.status === "blocked" ? "danger" : item.waiting_on !== "none" ? "warning" : "info";
    rows.push({
      id: `work:${item.id}`,
      jobId: item.school_job_id,
      dueDate,
      school: item.school_name,
      contactLabel: item.linked_contact_name ?? "Contact pending",
      jobType: "ID / admin work",
      currentStep: item.title,
      nextAction: item.waiting_on_label ?? "Review ID/admin item.",
      owner: item.owner_name ?? "Unassigned",
      status: item.status_label ?? humanizeToken(item.status),
      riskLabel: item.due_state === "overdue" ? "Overdue" : item.waiting_on_label,
      riskTone,
      updatedAt: item.updated_at,
      workflowHash: target.hash,
      jobHash: item.school_job_id ? toSchoolsJobHash(item.school_job_id) : "#schools/jobs",
      accountHash: "#schools/accounts",
      hasWorkflow: target.hasWorkflow,
      actionLabel: target.actionLabel,
      openTaskCount: 0,
      exceptionCount: item.flags.length,
      proofApprovalPending: false,
      staffingIssue: false,
      productionIssue: item.waiting_on === "internal_production",
      clientConcern: item.waiting_on === "school" || isSchoolWorkMissingKeyInfo(item)
    });
  }

  return rows.sort((left, right) => {
    const riskRank = { danger: 0, warning: 1, info: 2, neutral: 3, success: 4 };
    return (
      riskRank[left.riskTone] - riskRank[right.riskTone] ||
      (parseDate(left.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseDate(right.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      left.school.localeCompare(right.school)
    );
  });
}

function buildAttentionItems(jobs: SharedJobListItem[], tasks: SharedTaskListItem[], exceptions: SharedExceptionListItem[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const task of tasks.filter((candidate) => isTaskOverdue(candidate)).slice(0, 3)) {
    items.push({
      id: `task-overdue-${task.id}`,
      title: task.title,
      summary: `${task.related_job_title ?? "Task"} is overdue and still needs follow-through.`,
      owner: task.assigned_to_name ?? "Unassigned",
      dueLabel: task.due_at ? `Due ${formatDateTime(task.due_at)}` : "No due time",
      tone: "danger",
      routeHash: toTaskHash(task.id)
    });
  }
  for (const task of tasks.filter((candidate) => !isTaskOverdue(candidate) && isTaskDueToday(candidate)).slice(0, 2)) {
    items.push({
      id: `task-today-${task.id}`,
      title: task.title,
      summary: `${task.related_job_title ?? "Task"} is due today.`,
      owner: task.assigned_to_name ?? "Unassigned",
      dueLabel: task.due_at ? `Due ${formatDateTime(task.due_at)}` : "Due today",
      tone: "warning",
      routeHash: toTaskHash(task.id)
    });
  }
  for (const job of jobs.filter((candidate) => isJobStalled(candidate)).slice(0, 2)) {
    items.push({
      id: `job-stalled-${job.id}`,
      title: job.title,
      summary: `${job.organization_name ?? "School job"} is stalled and needs the next action owner clarified.`,
      owner: jobOwnerName(job),
      dueLabel: job.client_deadline_at ? `Due ${formatDate(job.client_deadline_at)}` : "Stalled",
      tone: "warning",
      routeHash: toSchoolsJobHash(job.id)
    });
  }
  for (const item of exceptions.filter((candidate) => candidate.status === "open" && (candidate.severity === "critical" || candidate.severity === "high")).slice(0, 2)) {
    items.push({
      id: `watch-${item.id}`,
      title: item.title,
      summary: item.next_action_label,
      owner: item.owner_name ?? "Unassigned",
      dueLabel: item.due_at ? `Due ${formatDateTime(item.due_at)}` : humanizeToken(item.severity),
      tone: item.severity === "critical" ? "danger" : "warning",
      routeHash: item.job_id ? toSchoolsJobHash(item.job_id) : "#schools/exceptions"
    });
  }
  return items.slice(0, 4);
}

function isOpenSchoolWorkItem(item: SchoolWorkItemRecord) {
  return item.status !== "completed" && item.status !== "cancelled" && item.completed_at == null;
}

function isBlockedSchoolWorkItem(item: SchoolWorkItemRecord) {
  return item.status === "blocked" || Boolean(item.blocker_reason);
}

function isWaitingOnKp(item: SchoolWorkItemRecord) {
  return item.waiting_on === "internal_ops" || item.waiting_on === "internal_production" || item.waiting_on === "billing";
}

function boardWorkflowNameForItem(item: SchoolWorkItemRecord) {
  const boardName = item.external_sync?.board_name?.trim();
  if (boardName) {
    return boardName;
  }
  if (item.school_job_type) {
    return `${humanizeToken(item.school_job_type)} workflow`;
  }
  return `${humanizeToken(item.work_type)} workflow`;
}

function boardWorkflowKeyForItem(item: SchoolWorkItemRecord) {
  if (item.external_sync?.board_id) {
    return `board:${item.external_sync.board_id}`;
  }
  if (item.external_sync?.board_name) {
    return `board-name:${item.external_sync.board_name.toLowerCase()}`;
  }
  return `workflow:${item.school_job_type ?? item.work_type}`;
}

function workItemDeadline(item: SchoolWorkItemRecord) {
  return item.due_date ?? item.sla_date ?? null;
}

function isSchoolWorkDueThisWeek(item: SchoolWorkItemRecord) {
  return isOpenSchoolWorkItem(item) && isThisWeek(workItemDeadline(item));
}

function isSchoolWorkMissingKeyInfo(item: SchoolWorkItemRecord) {
  return (
    isOpenSchoolWorkItem(item) &&
    (!item.school_job_id || !item.owner_user_id || !workItemDeadline(item) || (item.work_type === "pre_shoot_coordination" && !item.linked_shoot_id))
  );
}

function mostCommonLabel(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value.trim();
    if (label) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "Unassigned";
}

function healthForBoardWorkflow(summary: Pick<BoardWorkflowSummary, "overdueCount" | "blockedCount" | "missingInfoCount" | "dueThisWeekCount" | "waitingOnSchoolCount" | "waitingOnKpCount">): BoardWorkflowHealth {
  if (summary.overdueCount > 0 || summary.blockedCount > 0) {
    return "red";
  }
  if (summary.missingInfoCount > 0 || summary.dueThisWeekCount > 0 || summary.waitingOnSchoolCount > 0 || summary.waitingOnKpCount > 0) {
    return "yellow";
  }
  return "green";
}

function routeForBoardWorkflowSummary(summary: Pick<BoardWorkflowSummary, "overdueCount" | "blockedCount" | "missingInfoCount" | "dueThisWeekCount">) {
  if (summary.blockedCount > 0 || summary.missingInfoCount > 0) {
    return buildSchoolsTabHash("exceptions", { focus: "stalled" });
  }
  if (summary.overdueCount > 0 || summary.dueThisWeekCount > 0) {
    return buildSchoolsTabHash("tasks", { view: "week" });
  }
  return buildSchoolsTabHash("jobs", { focus: "open" });
}

function buildBoardWorkflowSummaries(items: SchoolWorkItemRecord[]): BoardWorkflowSummary[] {
  const openItems = items.filter(isOpenSchoolWorkItem);
  const grouped = new Map<string, SchoolWorkItemRecord[]>();
  for (const item of openItems) {
    const key = boardWorkflowKeyForItem(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return [...grouped.entries()]
    .map(([key, groupItems]) => {
      const deadlines = groupItems
        .map((item) => workItemDeadline(item))
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => (parseDate(left)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseDate(right)?.getTime() ?? Number.MAX_SAFE_INTEGER));
      const draftSummary = {
        key,
        name: boardWorkflowNameForItem(groupItems[0]),
        sourceLabel: groupItems[0].external_sync?.provider ? humanizeToken(groupItems[0].external_sync.provider) : humanizeToken(groupItems[0].source_system),
        openCount: groupItems.length,
        overdueCount: groupItems.filter((item) => item.due_state === "overdue").length,
        blockedCount: groupItems.filter(isBlockedSchoolWorkItem).length,
        dueThisWeekCount: groupItems.filter(isSchoolWorkDueThisWeek).length,
        waitingOnSchoolCount: groupItems.filter((item) => item.waiting_on === "school" || item.stage === "waiting_on_school").length,
        waitingOnKpCount: groupItems.filter(isWaitingOnKp).length,
        missingInfoCount: groupItems.filter(isSchoolWorkMissingKeyInfo).length,
        nextDeadline: deadlines[0] ?? null,
        primaryOwner: mostCommonLabel(groupItems.map((item) => item.owner_name ?? "")),
        health: "green" as BoardWorkflowHealth,
        routeHash: "#schools/jobs"
      };
      const health = healthForBoardWorkflow(draftSummary);
      return {
        ...draftSummary,
        health,
        routeHash: routeForBoardWorkflowSummary(draftSummary)
      };
    })
    .sort((left, right) => {
      const healthRank = { red: 0, yellow: 1, green: 2 };
      return (
        healthRank[left.health] - healthRank[right.health] ||
        right.overdueCount - left.overdueCount ||
        right.blockedCount - left.blockedCount ||
        right.openCount - left.openCount ||
        left.name.localeCompare(right.name)
      );
    });
}

function isRecentlyUpdated(item: SchoolWorkItemRecord) {
  const parsed = parseDate(item.updated_at);
  if (!parsed) {
    return false;
  }
  const ageMs = Date.now() - parsed.getTime();
  return ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000;
}

function buildOwnerWorkloadLabel(items: SchoolWorkItemRecord[]) {
  const openItems = items.filter(isOpenSchoolWorkItem);
  const owners = new Map<string, number>();
  for (const item of openItems) {
    const owner = item.owner_name?.trim() || "Unassigned";
    owners.set(owner, (owners.get(owner) ?? 0) + 1);
  }
  const topOwner = [...owners.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  return topOwner ? `${topOwner[0]} (${topOwner[1]})` : "No open owners";
}

function buildCalendarIntakeSummary(items: SchoolWorkItemRecord[]) {
  const openItems = items.filter(isOpenSchoolWorkItem);
  return {
    outlookEventsNotConnected: openItems.filter((item) => item.source_system === "outlook" && !item.school_job_id).length,
    workflowsMissingCalendarEvents: openItems.filter((item) => item.school_job_id && !item.linked_shoot_id && item.work_type === "pre_shoot_coordination").length
  };
}

function renderPagination(currentPage: number, totalPages: number, onChange: (page: number) => void) {
  if (totalPages <= 1) {
    return null;
  }
  return (
    <div className="schools-department__pagination">
      <button type="button" className="secondary-button" onClick={() => onChange(currentPage - 1)} disabled={currentPage <= 1}>
        Previous
      </button>
      <span>
        Page {currentPage} of {totalPages}
      </span>
      <button type="button" className="secondary-button" onClick={() => onChange(currentPage + 1)} disabled={currentPage >= totalPages}>
        Next
      </button>
    </div>
  );
}

export function SchoolsHub({ token, currentUser }: Props) {
  const { path, params } = useHashRouteSnapshot();
  const accessScope = getSchoolsHubAccessScope(currentUser);
  const canCreate = canCreateShootRecords(currentUser);
  const activeTab = getActiveTab(path);
  const defaultTasksView: TasksView = accessScope === "own" ? "my" : "employee";

  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<SchoolsHubWorkspaceResponse | null>(null);
  const [jobs, setJobs] = useState<SharedJobListItem[]>([]);
  const [tasks, setTasks] = useState<SharedTaskListItem[]>([]);
  const [exceptions, setExceptions] = useState<SharedExceptionListItem[]>([]);
  const [dashboard, setDashboard] = useState<SharedDashboardResponse | null>(null);
  const [workflowRows, setWorkflowRows] = useState<ProjectWorkflowJobRow[]>([]);
  const [errors, setErrors] = useState<SourceErrors>(EMPTY_ERRORS);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [resumeDraftsOpen, setResumeDraftsOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [jobSearch, setJobSearch] = useState("");
  const [workflowStep, setWorkflowStep] = useState("");
  const [jobAssignee, setJobAssignee] = useState("");
  const [jobClientSuccess, setJobClientSuccess] = useState("");
  const [jobDirector, setJobDirector] = useState("");
  const [jobsFocus, setJobsFocus] = useState<JobsFocus>("open");
  const [jobsPage, setJobsPage] = useState(1);
  const [taskSearch, setTaskSearch] = useState("");
  const [tasksView, setTasksView] = useState<TasksView>(defaultTasksView);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [tasksPage, setTasksPage] = useState(1);
  const [watchSearch, setWatchSearch] = useState("");
  const [exceptionsFocus, setExceptionsFocus] = useState<ExceptionsFocus>("all");
  const [exceptionsPage, setExceptionsPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const anchorDate = new Date().toISOString().slice(0, 10);
    setLoading(true);
    setErrors(EMPTY_ERRORS);

    void Promise.allSettled([
      getSchoolsHubWorkspace(token, {
        anchor_date: anchorDate,
        search: "",
        owner_user_id: accessScope === "own" ? currentUser.id : null,
        school_id: null,
        job_id: null,
        work_type: "all",
        priority: "all",
        waiting_on: "all",
        page: 1,
        page_size: WORKSPACE_QUEUE_PAGE_SIZE
      }),
      listSharedJobs(token, { department_type: "schools" }),
      listSharedTasks(token, { department_type: "schools", limit: 200 }),
      listSharedExceptions(token, { department_type: "schools", limit: 100, only_mine: accessScope === "own" }),
      getSharedDashboard(token, "home", "schools"),
      getProjectWorkflowCommandCenter(token, { view: "department", department: "schools", limit: 100 })
    ]).then((results) => {
      if (cancelled) {
        return;
      }

      const nextErrors: SourceErrors = { ...EMPTY_ERRORS };

      if (results[0].status === "fulfilled") {
        setWorkspace(results[0].value);
      } else {
        setWorkspace(null);
        nextErrors.workspace = messageFor(results[0].reason, "We couldn't load the Schools overview counts.");
      }

      if (results[1].status === "fulfilled") {
        setJobs(results[1].value.jobs);
      } else {
        setJobs([]);
        nextErrors.jobs = messageFor(results[1].reason, "We couldn't load school jobs.");
      }

      if (results[2].status === "fulfilled") {
        setTasks(results[2].value.items);
      } else {
        setTasks([]);
        nextErrors.tasks = messageFor(results[2].reason, "We couldn't load school tasks.");
      }

      if (results[3].status === "fulfilled") {
        setExceptions(results[3].value.items);
      } else {
        setExceptions([]);
        nextErrors.exceptions = messageFor(results[3].reason, "We couldn't load the school exceptions queue.");
      }

      if (results[4].status === "fulfilled") {
        setDashboard(results[4].value);
      } else {
        setDashboard(null);
        nextErrors.dashboard = messageFor(results[4].reason, "We couldn't load delivery risk data.");
      }

      if (results[5].status === "fulfilled") {
        setWorkflowRows(results[5].value.job_rows ?? []);
      } else {
        setWorkflowRows([]);
        nextErrors.projectTracking = messageFor(results[5].reason, "We couldn't load live workflow rows.");
      }

      setErrors(nextErrors);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [accessScope, currentUser.id, token]);

  useEffect(() => {
    setJobsPage(1);
  }, [jobSearch, workflowStep, jobAssignee, jobClientSuccess, jobDirector, jobsFocus]);

  useEffect(() => {
    setTasksPage(1);
  }, [taskSearch, tasksView, employeeFilter, roleFilter]);

  useEffect(() => {
    setExceptionsPage(1);
  }, [exceptionsFocus, watchSearch]);

  useEffect(() => {
    const focus = params.get("focus");
    const view = params.get("view");
    if (activeTab === "jobs" && isJobsFocus(focus) && focus !== jobsFocus) {
      setJobsFocus(focus);
    }
    if (activeTab === "tasks" && isTasksView(view) && view !== tasksView) {
      setTasksView(view);
    }
    if (activeTab === "exceptions" && isExceptionsFocus(focus) && focus !== exceptionsFocus) {
      setExceptionsFocus(focus);
    }
  }, [activeTab, exceptionsFocus, jobsFocus, params, tasksView]);

  const schoolJobs = useMemo(() => jobs.filter((item) => item.department_type === "schools"), [jobs]);
  const anchorDate = workspace?.anchor_date ?? null;
  const schoolDashboardRows = useMemo(
    () => buildSchoolsDashboardRows(schoolJobs, workspace?.queue_items ?? [], workflowRows, tasks, exceptions, anchorDate).slice(0, SCHOOLS_OPERATING_BOARD_ROW_LIMIT),
    [anchorDate, exceptions, schoolJobs, tasks, workflowRows, workspace?.queue_items]
  );
  const idTracker = useMemo(() => {
    const idRows = schoolDashboardRows.filter((row) => isIdRelatedText(row.jobType, row.currentStep, row.nextAction));
    return {
      active: idRows.length,
      dueSoon: idRows.filter((row) => isDueWithinSevenDays(row.dueDate, anchorDate)).length,
      overdue: idRows.filter((row) => isOverdueFromAnchor(row.dueDate, anchorDate)).length,
      waitingOnInfo: idRows.filter((row) => row.nextAction.toLowerCase().includes("waiting on school") || row.nextAction.toLowerCase().includes("waiting on info")).length,
      readyCompleted: idRows.filter((row) => ["ready", "complete", "completed"].some((token) => row.status.toLowerCase().includes(token))).length
    };
  }, [anchorDate, schoolDashboardRows]);
  const boardIssueCounts = useMemo(
    () => ({
      proofApprovals: (dashboard?.summary.overdue_approval_count ?? 0) + schoolDashboardRows.filter((row) => row.proofApprovalPending).length,
      staffingIssues: schoolDashboardRows.filter((row) => row.staffingIssue).length,
      productionBlockers: schoolDashboardRows.filter((row) => row.productionIssue).length,
      clientConcerns: schoolDashboardRows.filter((row) => row.clientConcern).length,
      exceptions: schoolDashboardRows.reduce((total, row) => total + row.exceptionCount, 0),
      tasks: schoolDashboardRows.reduce((total, row) => total + row.openTaskCount, 0)
    }),
    [dashboard?.summary.overdue_approval_count, schoolDashboardRows]
  );
  const commandSummaryCards = useMemo(
    () => [
      {
        label: "Active School Work",
        value: schoolDashboardRows.length,
        detail: "Open school jobs and school work in the current view.",
        hash: "#schools/jobs"
      },
      {
        label: "Due Soon",
        value: schoolDashboardRows.filter((row) => isDueWithinSevenDays(row.dueDate, anchorDate)).length,
        detail: "Work with a date or deadline inside the next seven days.",
        hash: buildSchoolsTabHash("jobs", { focus: "open" })
      },
      {
        label: "Waiting on School",
        value: (workspace?.summary.waiting_on_school ?? 0) + workflowRows.filter((row) => row.waiting_on_party === "school").length,
        detail: "Rows explicitly waiting on a school, roster, contact, or approval.",
        hash: buildSchoolsTabHash("exceptions", { focus: "missing_data" })
      },
      {
        label: "Blocked / Needs Review",
        value: schoolDashboardRows.filter((row) => row.riskTone === "danger" || row.riskTone === "warning").length,
        detail: "Blocked, overdue, high-risk, or review-needed work.",
        hash: "#needs-attention"
      },
      {
        label: "Recently Changed",
        value: schoolDashboardRows.filter((row) => Boolean(row.updatedAt)).length,
        detail: "Current rows with live update timestamps.",
        hash: "#project-tracking"
      }
    ],
    [anchorDate, schoolDashboardRows, workspace?.summary.waiting_on_school, workflowRows]
  );
  const workflowDataNote = errors.projectTracking ? "Project Tracking links are limited until work-spine rows load." : "Use Project Tracking for the full work spine when a workflow is connected.";
  const workflowOptions = useMemo(() => buildSelectOptions(schoolJobs.map((job) => ({ value: job.job_status, label: humanizeToken(job.job_status) }))), [schoolJobs]);
  const assigneeOptions = useMemo(
    () => buildSelectOptions(schoolJobs.map((job) => ({ value: job.lead_owner_user_id ?? job.account_owner_user_id ?? "", label: jobOwnerName(job) }))),
    [schoolJobs]
  );
  const clientSuccessOptions = useMemo(
    () => buildSelectOptions(schoolJobs.map((job) => ({ value: job.account_owner_user_id ?? "", label: job.account_owner_name ?? "" }))),
    [schoolJobs]
  );
  const directorOptions = useMemo(
    () => buildSelectOptions(schoolJobs.map((job) => ({ value: job.lead_owner_user_id ?? "", label: job.lead_owner_name ?? "" }))),
    [schoolJobs]
  );

  const filteredJobs = useMemo(() => {
    return schoolJobs.filter((job) => {
      if (!matchesSearch(jobSearch, [job.job_number, job.title, job.organization_name, job.account_owner_name, job.lead_owner_name])) {
        return false;
      }
      if (workflowStep && job.job_status !== workflowStep) {
        return false;
      }
      if (jobAssignee && (job.lead_owner_user_id ?? job.account_owner_user_id ?? "") !== jobAssignee) {
        return false;
      }
      if (jobClientSuccess && (job.account_owner_user_id ?? "") !== jobClientSuccess) {
        return false;
      }
      if (jobDirector && (job.lead_owner_user_id ?? "") !== jobDirector) {
        return false;
      }
      if (jobsFocus === "open" && !isOpenJob(job)) {
        return false;
      }
      if (jobsFocus === "overdue" && !isJobOverdue(job)) {
        return false;
      }
      if (jobsFocus === "stalled" && !isJobStalled(job)) {
        return false;
      }
      return true;
    });
  }, [jobAssignee, jobClientSuccess, jobDirector, jobSearch, jobsFocus, schoolJobs, workflowStep]);

  const pagedJobs = paginate(filteredJobs, jobsPage, JOBS_PAGE_SIZE);
  const employeeOptions = useMemo(() => buildSelectOptions(tasks.map((task) => ({ value: task.assigned_to_user_id ?? "", label: task.assigned_to_name ?? "" }))), [tasks]);
  const roleOptions = useMemo(() => buildSelectOptions(tasks.map((task) => ({ value: roleKeyForTask(task), label: roleLabelForTaskKey(roleKeyForTask(task)) }))), [tasks]);
  const filteredTasks = useMemo(() => {
    const searched = tasks.filter((task) =>
      matchesSearch(taskSearch, [task.title, task.task_number, task.assigned_to_name, task.related_job_title, task.organization_name, task.task_type])
    );
    switch (tasksView) {
      case "my":
        return searched.filter((task) => task.assigned_to_user_id === currentUser.id);
      case "employee":
        return employeeFilter ? searched.filter((task) => task.assigned_to_user_id === employeeFilter) : searched;
      case "role":
        return roleFilter ? searched.filter((task) => roleKeyForTask(task) === roleFilter) : searched;
      case "overdue":
        return searched.filter((task) => isTaskOverdue(task));
      case "today":
        return searched.filter((task) => isTaskDueToday(task));
      case "week":
        return searched.filter((task) => isTaskDueThisWeek(task));
      default:
        return searched;
    }
  }, [currentUser.id, employeeFilter, roleFilter, taskSearch, tasks, tasksView]);

  const taskGroups = useMemo(() => {
    return tasksView === "employee" ? buildTaskGroups(filteredTasks, "employee") : tasksView === "role" ? buildTaskGroups(filteredTasks, "role") : [];
  }, [filteredTasks, tasksView]);

  const pagedTasks = paginate(filteredTasks, tasksPage, TASKS_PAGE_SIZE);

  const exceptionCounts = useMemo(
    () => ({
      stalled: exceptions.filter((item) => exceptionCategory(item) === "stalled").length,
      missing_data: exceptions.filter((item) => exceptionCategory(item) === "missing_data").length,
      gallery_release: exceptions.filter((item) => exceptionCategory(item) === "gallery_release").length,
      yearbook: exceptions.filter((item) => exceptionCategory(item) === "yearbook").length,
      delivery: exceptions.filter((item) => exceptionCategory(item) === "delivery").length,
      id_issues: exceptions.filter((item) => exceptionCategory(item) === "id_issues").length
    }),
    [exceptions]
  );

  const filteredExceptions = useMemo(() => {
    return exceptions.filter((item) => matchesExceptionsFocus(item, exceptionsFocus) && matchesSearch(watchSearch, [item.title, item.description, item.next_action_label, item.job_title, item.organization_name, item.owner_name]));
  }, [exceptions, exceptionsFocus, watchSearch]);

  const pagedExceptions = paginate(filteredExceptions, exceptionsPage, EXCEPTIONS_PAGE_SIZE);
  const fullyBlocked = !workspace && !schoolJobs.length && !tasks.length && !exceptions.length && Object.values(errors).some(Boolean);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading Schools" summary="Pulling the school jobs, tasks, exceptions, and work-spine links the team needs today." />;
  }

  if (accessScope == null) {
    return (
      <section className="schools-department">
        <WorkspacePageHeader title="Schools" summary="School jobs, rosters, galleries, yearbooks, account follow-up, and work that needs a next owner." />
        <section className="panel">
          <WorkspaceEmptyState title="Schools access is not enabled for this account" summary="Ask an admin to add the Schools access your role needs before using this department page." />
        </section>
      </section>
    );
  }

  return (
    <section className="schools-department">
      <WorkspacePageHeader
        title="Schools"
        summary={
          accessScope === "own"
            ? "Your assigned school jobs, rosters, galleries, yearbooks, account follow-up, and next-owner work."
            : "School jobs, rosters, galleries, yearbooks, account follow-up, and work that needs a next owner."
        }
        actions={
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => navigateToUtility("#my-schedule")}>
              My Schedule
            </button>
            <button type="button" className="secondary-button" onClick={() => navigateToUtility("#search")}>
              Search
            </button>
            {canReadNotifications(currentUser) ? (
              <button type="button" className="secondary-button" onClick={() => navigateToUtility("#notifications")}>
                Notifications
              </button>
            ) : null}
          </WorkspaceActionBar>
        }
      />

      <section className="panel schools-dashboard-v1">
        <div className="schools-dashboard-v1__top">
          <WorkspaceSectionHeader
            title="Schools Command Hub"
            summary="Summary-first view of school work, due dates, blockers, next owners, and where to inspect the full work record."
          />
          <div className="segmented-toggle segmented-toggle--compact schools-department__primary-tabs" role="tablist" aria-label="Schools work modes">
            {([
              { key: "jobs", label: "Jobs" },
              { key: "tasks", label: "Tasks" },
              { key: "exceptions", label: "Exceptions" }
            ] as Array<{ key: SchoolsPrimaryTab; label: string }>).map((tab) => (
              <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? "is-active" : ""} onClick={() => navigateToSchoolsTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="schools-dashboard-v1__kpis" aria-label="Schools operating summary cards">
          {commandSummaryCards.map((card) => (
            <button key={card.label} type="button" className="schools-dashboard-v1__summary-card" onClick={() => navigateToUtility(card.hash)}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </button>
          ))}
        </div>

        <div className="schools-dashboard-v1__issue-strip" aria-label="Schools issue lanes">
          <div className="schools-dashboard-v1__issue-label">
            <strong>What needs attention</strong>
            <span>Preview only. Use Needs Attention for cross-operational blockers.</span>
          </div>
          <button type="button" className="schools-dashboard-v1__issue-chip" onClick={() => navigateToSchoolsTab("exceptions", { focus: "gallery_release" })}>
            <span>Proof approvals</span>
            <strong>{boardIssueCounts.proofApprovals}</strong>
          </button>
          <button type="button" className="schools-dashboard-v1__issue-chip" onClick={() => navigateToSchoolsTab("jobs", { focus: "stalled" })}>
            <span>Staffing issues</span>
            <strong>{boardIssueCounts.staffingIssues}</strong>
          </button>
          <button type="button" className="schools-dashboard-v1__issue-chip" onClick={() => navigateToSchoolsTab("exceptions", { focus: "delivery" })}>
            <span>Production blockers</span>
            <strong>{boardIssueCounts.productionBlockers}</strong>
          </button>
          <button type="button" className="schools-dashboard-v1__issue-chip" onClick={() => navigateToSchoolsTab("exceptions", { focus: "missing_data" })}>
            <span>Missing info / client</span>
            <strong>{boardIssueCounts.clientConcerns}</strong>
          </button>
          <button type="button" className="schools-dashboard-v1__issue-chip" onClick={() => navigateToSchoolsTab("tasks", { view: "week" })}>
            <span>Open tasks on board</span>
            <strong>{boardIssueCounts.tasks}</strong>
          </button>
        </div>

        <div className="schools-dashboard-v1__main">
          <WorkspaceSectionHeader
            title="Department work"
            summary={`${workflowDataNote} Use Open work for the next safe item, Open details for the job record, and Needs Attention for blockers that cross departments.`}
            compact
            badge={<span className="workspace-page-header__meta-pill">{schoolDashboardRows.length} visible items</span>}
          />
          {schoolDashboardRows.length ? (
            <div className="schools-dashboard-v1__table" role="table" aria-label="Schools department command list">
              <div className="schools-dashboard-v1__row schools-dashboard-v1__row--head" role="row">
                <span role="columnheader">School / account</span>
                <span role="columnheader">Department work</span>
                <span role="columnheader">Due / changed</span>
                <span role="columnheader">Next step / status</span>
                <span role="columnheader">Next action</span>
                <span role="columnheader">Next owner</span>
                <span role="columnheader">Blocker / review</span>
                <span role="columnheader">Open next</span>
              </div>
              {schoolDashboardRows.map((row) => (
                <div key={row.id} className="schools-dashboard-v1__row" role="row">
                  <div>
                    <strong title={row.school}>{row.school}</strong>
                    <span title={row.contactLabel}>Contact: {row.contactLabel}</span>
                  </div>
                  <div>
                    <strong>{row.jobType}</strong>
                    <span>{row.jobId ? "Job" : "Work item"}</span>
                  </div>
                  <div>
                    <strong>{formatDate(row.dueDate)}</strong>
                    <span>Changed {formatDateTime(row.updatedAt)}</span>
                  </div>
                  <div>
                    <strong title={row.currentStep}>{row.currentStep}</strong>
                    <StatusPill label={row.status} tone={toneForState(row.status)} />
                  </div>
                  <div>
                    <strong title={row.nextAction}>{row.nextAction}</strong>
                    <span>{row.openTaskCount} tasks | {row.exceptionCount} exceptions</span>
                  </div>
                  <div>
                    <strong>{row.owner}</strong>
                    <span>{row.hasWorkflow ? "Workflow connected" : "Schools review"}</span>
                  </div>
                  <div>
                    <StatusPill label={row.riskLabel} tone={row.riskTone} />
                    <div className="schools-dashboard-v1__row-flags" aria-label={`Issue types for ${row.school}`}>
                      {row.proofApprovalPending ? <span>Proof</span> : null}
                      {row.staffingIssue ? <span>Staffing</span> : null}
                      {row.productionIssue ? <span>Production</span> : null}
                      {row.clientConcern ? <span>Client/info</span> : null}
                    </div>
                  </div>
                  <div className="schools-dashboard-v1__row-actions">
                    <button type="button" className="secondary-button" onClick={() => (window.location.hash = row.workflowHash)}>
                      Open work
                    </button>
                    <button type="button" className="secondary-button" onClick={() => (window.location.hash = row.hasWorkflow ? row.workflowHash : "#project-tracking")}>
                      {row.hasWorkflow ? "View Workflow" : "Open Project Tracking"}
                    </button>
                    {(row.riskTone === "danger" || row.riskTone === "warning" || row.exceptionCount > 0) ? (
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#needs-attention")}>
                        Open Needs Attention
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => (window.location.hash = row.jobHash)}>
                      Open details
                    </button>
                    {row.accountHash ? (
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = row.accountHash!)}>
                        Account
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState
              title="No active school work is showing here yet"
              summary="Active school jobs appear here when the shared job queue has school, owner, and date context."
              compact
            />
          )}
        </div>

        <div className="schools-dashboard-v1__id-list schools-dashboard-v1__id-list--inline" aria-label="ID Card Tracker">
          <div>
            <span>ID jobs</span>
            <strong>{idTracker.active}</strong>
          </div>
          <div>
            <span>ID due soon</span>
            <strong>{idTracker.dueSoon}</strong>
          </div>
          <div>
            <span>ID waiting on info</span>
            <strong>{idTracker.waitingOnInfo}</strong>
          </div>
          <div>
            <span>ID ready / complete</span>
            <strong>{idTracker.readyCompleted}</strong>
          </div>
        </div>
      </section>

      {fullyBlocked ? (
        <section className="panel">
          <WorkspaceEmptyState
            title="Schools data is unavailable right now"
            summary={Object.values(errors).filter(Boolean).join(" ")}
            actions={
              <button type="button" onClick={() => window.location.reload()}>
                Retry
              </button>
            }
          />
        </section>
      ) : null}

      {activeTab === "jobs" ? (
        <>
          <ProjectTrackingDepartmentQueue
            token={token}
            department="schools"
            title="Schools Active Work"
            summary="Live Project Tracking work for roster/data issues, gallery releases, retakes, waiting-on-school items, and at-risk school jobs."
            limit={8}
            variant="compact"
            maxItems={6}
            emptyStateLabel="No active Schools workflow steps"
          />
          <section className="panel schools-department__work-panel">
            <WorkspaceSectionHeader
              title="Jobs"
              summary="All school jobs across the company with owner, current status, milestone dates, and stalled signals."
              badge={<span className="workspace-page-header__meta-pill">{filteredJobs.length} jobs</span>}
              actions={
                featureFlags.centralJobIntakeV1 && canCreate ? (
                  <WorkspaceActionBar align="end" compact>
                    <button type="button" onClick={() => setQuickCreateOpen(true)}>
                      New School Job
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setResumeDraftsOpen(true)}>
                      Resume Drafts
                    </button>
                    <button type="button" className="secondary-button" onClick={() => navigateToUtility("#schools/import")}>
                      Import Jobs
                    </button>
                  </WorkspaceActionBar>
                ) : null
              }
            />

            <div className="schools-department__filter-grid">
              <label className="filter-field">
                <span>Search jobs</span>
                <input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Job number, school, owner, or title" />
              </label>
              <label className="filter-field">
                <span>Current status</span>
                <select value={workflowStep} onChange={(event) => setWorkflowStep(event.target.value)}>
                  <option value="">All statuses</option>
                  {workflowOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Assignee</span>
                <select value={jobAssignee} onChange={(event) => setJobAssignee(event.target.value)}>
                  <option value="">All assignees</option>
                  {assigneeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Client Success Rep</span>
                <select value={jobClientSuccess} onChange={(event) => setJobClientSuccess(event.target.value)}>
                  <option value="">All reps</option>
                  {clientSuccessOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Director</span>
                <select value={jobDirector} onChange={(event) => setJobDirector(event.target.value)}>
                  <option value="">All directors</option>
                  {directorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="segmented-toggle segmented-toggle--compact schools-department__subtabs" aria-label="Job state filter">
              {([
                { key: "open", label: "Open" },
                { key: "overdue", label: "Overdue" },
                { key: "stalled", label: "Stalled" },
                { key: "all", label: "All Jobs" }
              ] as Array<{ key: JobsFocus; label: string }>).map((option) => (
                <button key={option.key} type="button" className={jobsFocus === option.key ? "is-active" : ""} onClick={() => setJobsFocus(option.key)}>
                  {option.label}
                </button>
              ))}
            </div>

            {errors.jobs ? <div className="error-banner">{errors.jobs}</div> : null}

            {pagedJobs.items.length ? (
              <>
                <div className="dashboard-stack dashboard-stack--compact">
                  {pagedJobs.items.map((job) => {
                    const milestones = [
                      { label: "Picture date", value: job.primary_day_date ? formatDate(job.primary_day_date) : job.scheduled_start_at ? formatDate(job.scheduled_start_at) : null },
                      { label: "Client due", value: job.client_deadline_at ? formatDate(job.client_deadline_at) : null },
                      { label: "Production due", value: job.production_deadline_at ? formatDate(job.production_deadline_at) : null },
                      { label: "Yearbook due", value: job.school_profile?.submission_deadline ? formatDate(job.school_profile.submission_deadline) : null }
                    ].filter((item) => item.value);
                    return (
                      <article key={job.id} className="request-card schools-department__record-card">
                        <div className="schools-department__record-top">
                          <div>
                            <strong>{job.title}</strong>
                            <div className="muted">
                              {job.job_number ?? "Draft"} | {job.organization_name ?? "Organization pending"}
                            </div>
                          </div>
                          <div className="schools-department__pill-row">
                            <StatusPill label={humanizeToken(job.job_status)} tone={toneForState(job.job_status)} />
                            <StatusPill label={humanizeToken(job.readiness_status)} tone={toneForState(job.readiness_status)} />
                            <StatusPill label={humanizeToken(job.risk_status)} tone={toneForState(job.risk_status)} />
                          </div>
                        </div>
                        <div className="schools-department__record-grid">
                          <div>
                            <span>Current step</span>
                            <strong>{jobCurrentStep(job)}</strong>
                          </div>
                          <div>
                            <span>Owner</span>
                            <strong>{jobOwnerName(job)}</strong>
                          </div>
                          <div>
                            <span>Client Success Rep</span>
                            <strong>{job.account_owner_name ?? "Unassigned"}</strong>
                          </div>
                          <div>
                            <span>Director</span>
                            <strong>{job.lead_owner_name ?? "Unassigned"}</strong>
                          </div>
                          <div>
                            <span>Exceptions</span>
                            <strong>{job.open_watch_flag_count}</strong>
                          </div>
                        </div>
                        {milestones.length ? (
                          <div className="schools-department__milestones">
                            {milestones.map((item) => (
                              <div key={`${job.id}-${item.label}`}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="schools-department__record-footer">
                          <div className="muted">{isJobStalled(job) ? "Needs an unblock or a new next action owner" : isJobOverdue(job) ? "Past a milestone date" : "Work is moving"}</div>
                          <WorkspaceActionBar align="end" compact>
                            <button type="button" className="secondary-button" onClick={() => (window.location.hash = toSchoolsJobHash(job.id))}>
                              Open job
                            </button>
                          </WorkspaceActionBar>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {renderPagination(pagedJobs.currentPage, pagedJobs.totalPages, setJobsPage)}
              </>
            ) : (
              <WorkspaceEmptyState title="No school jobs match these filters" summary="Change the filters or switch back to all jobs to see more of the department queue." compact />
            )}
          </section>
        </>
      ) : null}

      {activeTab === "tasks" ? (
        <section className="panel schools-department__work-panel">
          <WorkspaceSectionHeader
            title="Tasks"
            summary="Tasks are first-class here, with views by person, by role, and by urgency so the next action owner is obvious."
            badge={<span className="workspace-page-header__meta-pill">{filteredTasks.length} tasks</span>}
          />

          <div className="segmented-toggle segmented-toggle--compact schools-department__subtabs" aria-label="Task views">
            {([
              { key: "my", label: "My Tasks" },
              { key: "employee", label: "By Employee" },
              { key: "role", label: "By Role" },
              { key: "overdue", label: "Overdue" },
              { key: "today", label: "Due Today" },
              { key: "week", label: "Due This Week" }
            ] as Array<{ key: TasksView; label: string }>).map((option) => (
              <button key={option.key} type="button" className={tasksView === option.key ? "is-active" : ""} onClick={() => setTasksView(option.key)}>
                {option.label}
              </button>
            ))}
          </div>

          <div className="schools-department__filter-grid">
            <label className="filter-field">
              <span>Search tasks</span>
              <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Task, employee, school, or job" />
            </label>
            {tasksView === "employee" ? (
              <label className="filter-field">
                <span>Employee</span>
                <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                  <option value="">All employees</option>
                  {employeeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {tasksView === "role" ? (
              <label className="filter-field">
                <span>Role</span>
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                  <option value="">All roles</option>
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {errors.tasks ? <div className="error-banner">{errors.tasks}</div> : null}

          {tasksView === "employee" || tasksView === "role" ? (
            taskGroups.length ? (
              <div className="dashboard-stack dashboard-stack--compact">
                {taskGroups.map((group) => (
                  <details key={group.key} className="request-card schools-department__group-card" open>
                    <summary className="schools-department__group-summary">
                      <div>
                        <strong>{group.label}</strong>
                        <span>{group.items.length} tasks</span>
                      </div>
                      <StatusPill label={group.overdueCount ? `${group.overdueCount} overdue` : "On track"} tone={group.overdueCount ? "warning" : "success"} />
                    </summary>
                    <div className="dashboard-stack dashboard-stack--compact">
                      {group.items.map((task) => (
                        <article key={task.id} className="request-card schools-department__record-card schools-department__record-card--compact">
                          <div className="schools-department__record-top">
                            <div>
                              <strong>{task.title}</strong>
                              <div className="muted">
                                {task.task_number} | {task.related_job_title ?? "No linked job"}
                              </div>
                            </div>
                            <div className="schools-department__pill-row">
                              <StatusPill label={humanizeToken(task.status)} tone={toneForState(task.status)} />
                              <StatusPill label={humanizeToken(task.priority)} tone={toneForState(task.priority)} />
                            </div>
                          </div>
                          <div className="schools-department__record-grid">
                            <div>
                              <span>Owner</span>
                              <strong>{task.assigned_to_name ?? "Unassigned"}</strong>
                            </div>
                            <div>
                              <span>Due</span>
                              <strong>{task.due_at ? formatDateTime(task.due_at) : "No due time"}</strong>
                            </div>
                            <div>
                              <span>School</span>
                              <strong>{task.organization_name ?? "Not linked"}</strong>
                            </div>
                            <div>
                              <span>Role bucket</span>
                              <strong>{roleLabelForTaskKey(roleKeyForTask(task))}</strong>
                            </div>
                          </div>
                          {task.blocked_reason ? <p className="schools-department__blocked-note">Blocked: {task.blocked_reason}</p> : null}
                          <WorkspaceActionBar align="end" compact>
                            <button type="button" className="secondary-button" onClick={() => (window.location.hash = toTaskHash(task.id))}>
                              Open task
                            </button>
                          </WorkspaceActionBar>
                        </article>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState title="No tasks match this view" summary="Try another person, role, or due window to see more of the task queue." compact />
            )
          ) : pagedTasks.items.length ? (
            <>
              <div className="dashboard-stack dashboard-stack--compact">
                {pagedTasks.items.map((task) => (
                  <article key={task.id} className="request-card schools-department__record-card">
                    <div className="schools-department__record-top">
                      <div>
                        <strong>{task.title}</strong>
                        <div className="muted">
                          {task.task_number} | {task.related_job_title ?? "No linked job"}
                        </div>
                      </div>
                      <div className="schools-department__pill-row">
                        <StatusPill label={humanizeToken(task.status)} tone={toneForState(task.status)} />
                        <StatusPill label={humanizeToken(task.priority)} tone={toneForState(task.priority)} />
                      </div>
                    </div>
                    <div className="schools-department__record-grid">
                      <div>
                        <span>Owner</span>
                        <strong>{task.assigned_to_name ?? "Unassigned"}</strong>
                      </div>
                      <div>
                        <span>Due</span>
                        <strong>{task.due_at ? formatDateTime(task.due_at) : "No due time"}</strong>
                      </div>
                      <div>
                        <span>School</span>
                        <strong>{task.organization_name ?? "Not linked"}</strong>
                      </div>
                      <div>
                        <span>Role bucket</span>
                        <strong>{roleLabelForTaskKey(roleKeyForTask(task))}</strong>
                      </div>
                    </div>
                    {task.blocked_reason ? <p className="schools-department__blocked-note">Blocked: {task.blocked_reason}</p> : null}
                    <WorkspaceActionBar align="end" compact>
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = toTaskHash(task.id))}>
                        Open task
                      </button>
                    </WorkspaceActionBar>
                  </article>
                ))}
              </div>
              {renderPagination(pagedTasks.currentPage, pagedTasks.totalPages, setTasksPage)}
            </>
          ) : (
            <WorkspaceEmptyState title="No tasks match this view" summary={tasksView === "my" ? "You do not have any school tasks in this view right now." : "Try another due window or search term."} compact />
          )}
        </section>
      ) : null}

      {activeTab === "exceptions" ? (
        <section className="panel schools-department__work-panel">
          <WorkspaceSectionHeader
            title="Exceptions"
            summary="At-risk school work with a clear next action and owner."
            badge={<span className="workspace-page-header__meta-pill">{filteredExceptions.length} items</span>}
          />

          <div className="schools-department__overview-grid schools-department__overview-grid--compact">
            <button
              type="button"
              className={`schools-department__overview-card schools-department__overview-card--warning schools-department__overview-card--interactive${exceptionsFocus === "stalled" ? " schools-department__overview-card--selected" : ""}`}
              onClick={() => setExceptionsFocus("stalled")}
              aria-pressed={exceptionsFocus === "stalled"}
            >
              <span>Stalled jobs</span>
              <strong>{exceptionCounts.stalled}</strong>
              <p>Blocked or drifting work</p>
              <small>Filter stalled jobs</small>
            </button>
            <button
              type="button"
              className={`schools-department__overview-card schools-department__overview-card--warning schools-department__overview-card--interactive${exceptionsFocus === "missing_data" ? " schools-department__overview-card--selected" : ""}`}
              onClick={() => setExceptionsFocus("missing_data")}
              aria-pressed={exceptionsFocus === "missing_data"}
            >
              <span>Missing data</span>
              <strong>{exceptionCounts.missing_data}</strong>
              <p>Roster, data, or school input gaps</p>
              <small>Filter missing data</small>
            </button>
            <button
              type="button"
              className={`schools-department__overview-card schools-department__overview-card--warning schools-department__overview-card--interactive${exceptionsFocus === "gallery_release" ? " schools-department__overview-card--selected" : ""}`}
              onClick={() => setExceptionsFocus("gallery_release")}
              aria-pressed={exceptionsFocus === "gallery_release"}
            >
              <span>Gallery release risks</span>
              <strong>{exceptionCounts.gallery_release}</strong>
              <p>Gallery work close to slipping</p>
              <small>Filter gallery risks</small>
            </button>
            <button
              type="button"
              className={`schools-department__overview-card schools-department__overview-card--danger schools-department__overview-card--interactive${exceptionsFocus === "yearbook" ? " schools-department__overview-card--selected" : ""}`}
              onClick={() => setExceptionsFocus("yearbook")}
              aria-pressed={exceptionsFocus === "yearbook"}
            >
              <span>Yearbook deadline risks</span>
              <strong>{exceptionCounts.yearbook}</strong>
              <p>Deadline-sensitive work flagged</p>
              <small>Filter yearbook risks</small>
            </button>
            <button
              type="button"
              className={`schools-department__overview-card schools-department__overview-card--danger schools-department__overview-card--interactive${exceptionsFocus === "delivery" ? " schools-department__overview-card--selected" : ""}`}
              onClick={() => setExceptionsFocus("delivery")}
              aria-pressed={exceptionsFocus === "delivery"}
            >
              <span>Delivery risks</span>
              <strong>{exceptionCounts.delivery}</strong>
              <p>Delivery follow-through at risk</p>
              <small>Filter delivery risks</small>
            </button>
            <button
              type="button"
              className={`schools-department__overview-card schools-department__overview-card--warning schools-department__overview-card--interactive${exceptionsFocus === "id_issues" ? " schools-department__overview-card--selected" : ""}`}
              onClick={() => setExceptionsFocus("id_issues")}
              aria-pressed={exceptionsFocus === "id_issues"}
            >
              <span>ID issues</span>
              <strong>{exceptionCounts.id_issues}</strong>
              <p>ID work needing attention</p>
              <small>Filter ID issues</small>
            </button>
          </div>

          <div className="schools-department__filter-grid">
            <label className="filter-field">
              <span>Search exceptions</span>
              <input value={watchSearch} onChange={(event) => setWatchSearch(event.target.value)} placeholder="Risk, school, owner, or next action" />
            </label>
          </div>

          <div className="segmented-toggle segmented-toggle--compact schools-department__subtabs schools-department__subtabs--wrap" aria-label="Exceptions filter">
            {([
              { key: "all", label: "All" },
              { key: "critical_high", label: "Critical + High" },
              { key: "ownerless", label: "Ownerless" },
              { key: "stalled", label: "Stalled Jobs" },
              { key: "missing_data", label: "Missing Data" },
              { key: "gallery_release", label: "Gallery" },
              { key: "yearbook", label: "Yearbook" },
              { key: "delivery", label: "Delivery" },
              { key: "id_issues", label: "ID Issues" }
            ] as Array<{ key: ExceptionsFocus; label: string }>).map((option) => (
              <button key={option.key} type="button" className={exceptionsFocus === option.key ? "is-active" : ""} onClick={() => setExceptionsFocus(option.key)}>
                {option.label}
              </button>
            ))}
          </div>

          {errors.exceptions ? <div className="error-banner">{errors.exceptions}</div> : null}

          {pagedExceptions.items.length ? (
            <>
              <div className="dashboard-stack dashboard-stack--compact">
                {pagedExceptions.items.map((item) => (
                  <article key={item.id} className="request-card schools-department__record-card">
                    <div className="schools-department__record-top">
                      <div>
                        <strong>{item.title}</strong>
                        <div className="muted">
                          {item.job_number ?? "Draft"} | {item.organization_name ?? "School pending"}
                        </div>
                      </div>
                      <div className="schools-department__pill-row">
                        <StatusPill label={humanizeToken(item.severity)} tone={toneForState(item.severity)} />
                        <StatusPill label={humanizeToken(item.status)} tone={toneForState(item.status)} />
                      </div>
                    </div>
                    {item.description ? <p>{item.description}</p> : null}
                    <div className="schools-department__record-grid">
                      <div>
                        <span>Owner</span>
                        <strong>{item.owner_name ?? "Unassigned"}</strong>
                      </div>
                      <div>
                        <span>Next action</span>
                        <strong>{item.next_action_label}</strong>
                      </div>
                      <div>
                        <span>Risk type</span>
                        <strong>{humanizeToken(item.flag_type)}</strong>
                      </div>
                      <div>
                        <span>Due</span>
                        <strong>{item.due_at ? formatDateTime(item.due_at) : "No due time"}</strong>
                      </div>
                    </div>
                    <WorkspaceActionBar align="end" compact>
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = item.job_id ? toSchoolsJobHash(item.job_id) : "#schools/exceptions")}>
                        Open job
                      </button>
                    </WorkspaceActionBar>
                  </article>
                ))}
              </div>
              {renderPagination(pagedExceptions.currentPage, pagedExceptions.totalPages, setExceptionsPage)}
            </>
          ) : (
            <WorkspaceEmptyState title="No exceptions match this view" summary="Switch filters to see other at-risk jobs, delivery items, or missing-data issues." compact />
          )}
        </section>
      ) : null}

      {featureFlags.centralJobIntakeV1 ? (
        <>
          <ResumeDraftsDrawer
            open={resumeDraftsOpen}
            token={token}
            department="schools"
            launchLabel="Schools Department"
            onClose={() => setResumeDraftsOpen(false)}
            onResumeDraft={(draftId) => {
              setResumeDraftsOpen(false);
              setResumeDraftId(draftId);
              setQuickCreateOpen(true);
            }}
          />
          <QuickCreateJobDrawer
            open={quickCreateOpen}
            token={token}
            currentUser={currentUser}
            defaultDepartment="schools"
            launchLabel="Schools Department"
            resumeDraftId={resumeDraftId}
            onClose={() => {
              setQuickCreateOpen(false);
              setResumeDraftId(null);
            }}
            onPublished={(jobId) => {
              setQuickCreateOpen(false);
              setResumeDraftId(null);
              window.location.hash = toSchoolsJobHash(jobId);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
