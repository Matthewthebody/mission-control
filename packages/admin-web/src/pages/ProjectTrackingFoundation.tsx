import { useEffect, useState } from "react";
import { ProjectWorkflowMap } from "../components/projectTracking/ProjectWorkflowMap";
import { QuickWorkflowNextStepMover } from "../components/projectTracking/QuickWorkflowNextStepMover";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { featureFlags } from "../featureFlags";
import { canManageWorkflowTemplates } from "../permissions";
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
  | "attention"
  | "blocked"
  | "running_late"
  | "due_soon"
  | "waiting_school"
  | "waiting_kp"
  | "missing_info"
  | "needs_assignment"
  | "complete"
  | "no_workflow";
type ProjectTrackingSort = "priority" | "organization" | "job" | "stage" | "owner" | "deadline" | "risk" | "updated";
type ProjectTrackingDepartmentFilter = "all" | "schools" | "sports" | "sessions" | "production" | "other";

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
  attention: "Needs Attention",
  blocked: "Blocked",
  running_late: "Running Late",
  due_soon: "Due Soon",
  waiting_school: "Waiting on School",
  waiting_kp: "Waiting on KP",
  missing_info: "Missing Info",
  needs_assignment: "Needs Assignment",
  complete: "Complete",
  no_workflow: "No Workflow Linked"
};

const SORT_LABELS: Record<ProjectTrackingSort, string> = {
  priority: "Priority",
  organization: "Organization / School",
  job: "Job",
  stage: "Current step",
  owner: "Assigned person",
  deadline: "Due",
  risk: "Late / At Risk",
  updated: "Last Updated"
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
    no_workflow: "No workflow linked",
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
    return "No workflow linked";
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
    return row.workflow_run_id ? "Deadline not set" : "No workflow linked";
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
  if (filter === "blocked") {
    return row.health === "blocked";
  }
  if (filter === "running_late") {
    return row.health === "running_late";
  }
  if (filter === "due_soon") {
    return row.health === "due_soon";
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

function ProjectTrackingJobBoard({
  token,
  payload,
  activeFilter,
  departmentFilter,
  searchQuery,
  sortKey,
  expandedRows,
  onFilterChange,
  onDepartmentFilterChange,
  onSearchQueryChange,
  onSortKeyChange,
  onClearFilters,
  onToggleRow,
  onOpenWorkflow,
  onWorkflowRowUpdated
}: {
  token: string;
  payload: ProjectWorkflowCommandCenter | null;
  activeFilter: ProjectTrackingFilter;
  departmentFilter: ProjectTrackingDepartmentFilter;
  searchQuery: string;
  sortKey: ProjectTrackingSort;
  expandedRows: Set<string>;
  onFilterChange: (filter: ProjectTrackingFilter) => void;
  onDepartmentFilterChange: (filter: ProjectTrackingDepartmentFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onSortKeyChange: (sortKey: ProjectTrackingSort) => void;
  onClearFilters: () => void;
  onToggleRow: (rowId: string) => void;
  onOpenWorkflow: (workflowRunId: string) => void;
  onWorkflowRowUpdated: () => Promise<void> | void;
}) {
  const rows = buildJobBoardRows(payload);
  const filteredRows = sortRows(rows.filter((row) => matchesDepartmentFilter(row, departmentFilter) && matchesFilter(row, activeFilter) && matchesSearch(row, searchQuery)), sortKey);
  const hasActiveControls = activeFilter !== "all" || departmentFilter !== "all" || searchQuery.trim().length > 0 || sortKey !== "priority";
  const filterSummary = activeFilter === "all" ? "all work" : FILTER_LABELS[activeFilter].toLowerCase();
  const departmentSummary = departmentFilter === "all" ? "all departments" : DEPARTMENT_FILTER_LABELS[departmentFilter];
  return (
    <section className="project-tracking-job-board">
      <div className="project-tracking-panel__heading">
        <div>
          <div className="section-title">Live Jobs</div>
          <p className="section-subtitle">Project Dashboard is the company-wide map. Queues, My Work, and Open Workflow all read from the same live workflow state.</p>
        </div>
        <div className="project-tracking-board-meta">
          <span className="badge">Showing {filteredRows.length} of {rows.length}</span>
          {payload?.generated_at ? <span className="badge">Updated {new Date(payload.generated_at).toLocaleTimeString()}</span> : null}
        </div>
      </div>
      <div className="project-tracking-controls" aria-label="Project tracking search and sorting">
        <label className="project-tracking-search">
          <span>Search</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="Search jobs, schools, owners, steps..."
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
        <button className="project-tracking-control-button" type="button" disabled title="Saved views need persistence before this becomes a real workflow tool. Planned levels: personal, department default, and company default.">
          Saved views planned
        </button>
      </div>
      <div className="project-tracking-filter-row" aria-label="Project tracking filters">
        {(Object.keys(FILTER_LABELS) as ProjectTrackingFilter[]).map((filter) => (
          <button
            className={`project-tracking-filter-button ${activeFilter === filter ? "is-active" : ""}`}
            type="button"
            key={filter}
            onClick={() => onFilterChange(filter)}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>
      <div className="project-tracking-active-filter">
        <span>
          Showing {filteredRows.length} of {rows.length} jobs - {departmentSummary} - Filtered by {filterSummary}
          {searchQuery.trim() ? ` - Search: "${searchQuery.trim()}"` : ""}
        </span>
        {hasActiveControls ? (
          <button type="button" onClick={onClearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
      {filteredRows.length ? (
        <div className="project-tracking-job-list" role="table" aria-label="Project tracking jobs operations grid">
          <div className="project-tracking-job-list__header" aria-hidden="true">
            <span>Organization / School</span>
            <span>Job</span>
            <span>Current step</span>
            <span>Assigned person</span>
            <span>Due</span>
            <span>Late / At Risk</span>
            <span>Waiting</span>
            <span>Status</span>
            <span>Open</span>
          </div>
          {filteredRows.map((row) => {
            const phase = phasePresentation(row.phase, row.health);
            const expanded = expandedRows.has(row.job_id);
            const currentStep = currentStepLabel(row);
            const owner = ownerPresentation(row);
            return (
              <article className={`project-tracking-job-row ${phase.className}`} key={row.job_id}>
                <div
                  className="project-tracking-job-row__summary"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${row.job_title}`}
                  onClick={() => onToggleRow(row.job_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleRow(row.job_id);
                    }
                  }}
                >
                  <span className="project-tracking-job-row__cell" data-label="Organization / School">
                    <strong title={row.organization_name ?? undefined}>{row.organization_name ?? "No account linked"}</strong>
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Job">
                    <strong title={row.job_title}>{row.job_title || "Untitled job"}</strong>
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Current step">
                    {row.workflow_run_id && row.current_step ? (
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
                    ) : (
                      <span className={`project-tracking-step-pill ${phase.pillClassName}`} title={currentStep}>
                        {currentStep}
                      </span>
                    )}
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Assigned person">
                    <strong className={owner.className} title={`${owner.primary} - ${owner.secondary}`}>{owner.primary}</strong>
                    <small>{owner.secondary}</small>
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Due">
                    <strong title={row.next_deadline_at ?? undefined}>{deadlineLabel(row)}</strong>
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Late / At Risk">
                    <span className={`project-tracking-risk-badge project-tracking-risk-badge--${healthToneForJob(row)}`}>{healthLabel(row.health)}</span>
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Waiting">
                    <strong title={row.waiting_on_party === "unknown" ? "Waiting party is not explicit yet." : waitingOnLabel(row)}>{waitingOnLabel(row)}</strong>
                  </span>
                  <span className="project-tracking-job-row__cell" data-label="Status">
                    <strong title={`${phase.label} - ${row.current_step ? statusLabel(row.current_step.status) : healthLabel(row.health)}`}>{row.current_step ? statusLabel(row.current_step.status) : phase.label}</strong>
                    <small className={`project-tracking-operational-status project-tracking-operational-status--${operationalToneForJob(row)}`}>
                      {operationalStatusLabel(row)}
                    </small>
                  </span>
                  <span className="project-tracking-job-row__cell project-tracking-job-row__action" data-label="Open">
                    {row.workflow_run_id ? (
                      <button
                        className="project-tracking-progress-link"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenWorkflow(row.workflow_run_id!);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        Open Workflow
                      </button>
                    ) : (
                      <span className="project-tracking-progress-link project-tracking-progress-link--disabled">No workflow yet</span>
                    )}
                  </span>
                </div>
                {expanded ? (
                  <div className="project-tracking-job-row__details">
                    <div>
                      <span>Job record</span>
                      <strong title={row.job_id}>{row.job_number ?? row.job_code ?? row.job_id}</strong>
                    </div>
                    <div>
                      <span>Linked workflow</span>
                      {row.workflow_run_id ? (
                        <button className="project-tracking-progress-link" type="button" onClick={() => onOpenWorkflow(row.workflow_run_id!)}>
                          Open Workflow
                        </button>
                      ) : (
                        <strong>No workflow linked yet.</strong>
                      )}
                    </div>
                    <div>
                      <span>Step details</span>
                      <strong>{row.current_step?.description || "No extra step notes yet."}</strong>
                    </div>
                    <div>
                      <span>Shared note</span>
                      <strong>{row.current_step?.notes || "No shared note yet."}</strong>
                    </div>
                    <div>
                      <span>Next action</span>
                      <strong>{row.queue_intelligence.next_action}</strong>
                    </div>
                    <div>
                      <span>Why surfaced</span>
                      <strong>{row.queue_intelligence.reason}</strong>
                    </div>
                    <div>
                      <span>Department</span>
                      <strong>{row.queue_intelligence.owner_lane}</strong>
                    </div>
                    <div>
                      <span>Clear condition</span>
                      <strong>{row.queue_intelligence.clear_condition}</strong>
                    </div>
                    <div>
                      <span>Waiting / blocker</span>
                      <strong>{row.blocked_reason || waitingOnLabel(row)}</strong>
                    </div>
                    <div>
                      <span>Recent activity</span>
                      <strong>{new Date(row.updated_at).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Assigned person source</span>
                      <strong>{owner.primary} - {owner.secondary}</strong>
                    </div>
                    <div>
                      <span>Job date</span>
                      <strong title={row.job_date ?? "Job date is not connected yet."}>{dateLabel(row.job_date) ?? "Job date not connected yet"}</strong>
                    </div>
                    <div>
                      <span>File status</span>
                      <strong>{fileStatusLabelForJob(row)}</strong>
                    </div>
                    {row.missing_info_flags.length ? (
                      <div className="project-tracking-job-row__wide">
                        <span>Missing info</span>
                        <strong>{row.missing_info_flags.map((flag) => friendlyName(flag)).join(", ")}</strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="section-subtitle">
          {rows.length ? `No jobs match ${FILTER_LABELS[activeFilter].toLowerCase()} right now.` : "No active project-tracking workflows are currently returned."}
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
  const [departmentFilter, setDepartmentFilter] = useState<ProjectTrackingDepartmentFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProjectTrackingSort>("priority");
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
    return <WorkspaceLoadingBlock title="Loading project dashboard" summary="Building the live jobs overview from workflow data." />;
  }

  const globalSummary = summaryFor(globalCommandCenter);
  const summaryMetrics: Array<{ filter: ProjectTrackingFilter; label: string; value: number; title?: string }> = [
    { filter: "all", label: "Total Active", value: globalSummary.total_active_workflows },
    { filter: "attention", label: "Needs Attention", value: globalSummary.total_needs_attention },
    { filter: "running_late", label: "Running Late", value: globalSummary.total_running_late },
    { filter: "due_soon", label: "Due Soon", value: globalSummary.total_due_soon },
    { filter: "blocked", label: "Blocked", value: globalSummary.total_blocked },
    {
      filter: "waiting_school",
      label: "Waiting on School",
      value: globalSummary.total_waiting_on_school,
      title: "Only counts rows where the backend has an explicit waiting-on-school value."
    },
    {
      filter: "waiting_kp",
      label: "Waiting on KP",
      value: globalSummary.total_waiting_on_kp,
      title: "Only counts rows where the backend has an explicit waiting-on-KP value."
    }
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
    setActiveFilter("all");
    setDepartmentFilter("all");
    setSearchQuery("");
    setSortKey("priority");
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
        <section className="project-tracking-board-header" aria-label="Project Dashboard">
          <div>
            <p className="section-kicker">Project Dashboard</p>
            <h1>Project Dashboard</h1>
            <p>Company-wide operating view of live jobs. Jobs are the shoots/events; Open Workflow for the deep job workflow view.</p>
          </div>
          <div className="project-tracking-board-header__actions">
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
        <section className="panel">
          <div className="section-title">Project dashboard is unavailable</div>
          <p className="section-subtitle">The workflow API did not respond. Try again before using this page for live decisions.</p>
        </section>
      ) : null}

      {isWorkflowRoute ? (
        workflow ? (
          <ProjectWorkflowMap workflow={workflow} token={token} currentUser={currentUser} onWorkflowUpdated={handleWorkflowUpdated} />
        ) : (
          <section className="panel">
            <div className="section-title">Live job workflow unavailable</div>
            <p className="section-subtitle">This workflow could not be loaded. Return to Project Dashboard and try another job.</p>
            <a className="button button-secondary" href="#project-tracking">
              Back to Project Dashboard
            </a>
          </section>
        )
      ) : (
        <>
          <section className="project-tracking-summary-strip" aria-label="Project tracking summary filters">
            <div className="project-tracking-summary-strip__label">
              <strong>Work Status</strong>
              <span>{globalSummary.source === "true_totals" ? "True totals before row limits" : "Shown rows only"}</span>
            </div>
            <div className="project-tracking-metric-grid">
              {summaryMetrics.map((metric) => (
                <button
                  className={activeFilter === metric.filter ? "is-active" : ""}
                  key={`${metric.filter}:${metric.label}`}
                  type="button"
                  title={metric.title}
                  onClick={() => setActiveFilter(metric.filter)}
                >
                  <span className="metric-label">{metric.label}</span>
                  <strong>{metric.value}</strong>
                </button>
              ))}
            </div>
          </section>

          <ProjectTrackingJobBoard
            token={token}
            payload={globalCommandCenter}
            activeFilter={activeFilter}
            departmentFilter={departmentFilter}
            searchQuery={searchQuery}
            sortKey={sortKey}
            expandedRows={expandedRows}
            onFilterChange={setActiveFilter}
            onDepartmentFilterChange={setDepartmentFilter}
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
