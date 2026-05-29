import { useEffect, useState } from "react";
import { getProjectWorkflowCommandCenter } from "../../services/projectTracking";
import type { ProjectWorkflowCommandCenter, ProjectWorkflowJobRow } from "../../projectTrackingTypes";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import { buildSharedJobHash } from "../jobs/sharedJobRouting";
import { QuickWorkflowStepEditor } from "./QuickWorkflowStepEditor";
import { QuickWorkflowNextStepMover } from "./QuickWorkflowNextStepMover";

type ProjectTrackingDepartment = "schools" | "sports" | "production" | "photography" | "operations" | "other";

type Props = {
  token: string;
  department: ProjectTrackingDepartment;
  title: string;
  summary: string;
  limit?: number;
};

function friendlyName(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function ownerLabel(row: ProjectWorkflowJobRow) {
  if (row.current_step?.assignment_status === "needs_assignment") {
    return row.current_step.assigned_queue
      ? `Needs Assignment - ${friendlyName(row.current_step.assigned_queue)}`
      : "Needs Assignment";
  }
  if (row.current_step?.assigned_user_name) {
    return row.current_step.assigned_user_name;
  }
  if (row.current_step?.assigned_queue) {
    return `${friendlyName(row.current_step.assigned_queue)} Queue`;
  }
  if (row.missing_info_flags.includes("missing_owner") && row.workflow_run_id && row.current_step) {
    return "Needs Assignment";
  }
  if (row.owner_type === "department") {
    return `${friendlyName(row.current_step?.department)} Queue`;
  }
  if (row.owner_type === "unknown") {
    return "Owner not set";
  }
  return friendlyName(row.owner_display);
}

function healthLabel(row: ProjectWorkflowJobRow) {
  const labels: Record<ProjectWorkflowJobRow["health"], string> = {
    on_track: "On track",
    due_soon: "Due soon",
    running_late: "Running late",
    blocked: "Blocked",
    at_risk: "Needs attention",
    complete: "Complete",
    no_workflow: "No workflow linked",
    unknown: "Needs review"
  };
  return labels[row.health];
}

function healthTone(row: ProjectWorkflowJobRow) {
  if (row.health === "blocked" || row.health === "running_late") {
    return "danger";
  }
  if (row.health === "due_soon" || row.health === "at_risk" || row.health === "unknown") {
    return "warning";
  }
  return "success";
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

function operationalTone(row: ProjectWorkflowJobRow) {
  if (["blocked", "overdue", "missing_owner", "missing_next_action"].includes(row.queue_intelligence.operational_status)) {
    return "danger";
  }
  if (["waiting", "at_risk", "needs_action"].includes(row.queue_intelligence.operational_status)) {
    return "warning";
  }
  return "success";
}

function dateLabel(value: string | null) {
  if (!value) {
    return "Deadline not set";
  }
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function jobDateLabel(value: string | null) {
  if (!value) {
    return "Job date not set";
  }
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function waitingLabel(row: ProjectWorkflowJobRow) {
  const waiting = row.current_step?.waiting_on_party ?? row.waiting_on_party;
  if (!waiting || waiting === "none") {
    return "No wait";
  }
  if (waiting === "unknown") {
    return "Waiting not set";
  }
  return friendlyName(waiting);
}

function stepTeamLabel(row: ProjectWorkflowJobRow) {
  const department = row.current_step?.department;
  const assignedQueue = row.current_step?.assigned_queue;
  if (assignedQueue && normalizeDepartment(assignedQueue) !== normalizeDepartment(department)) {
    return `${friendlyName(department)} / ${friendlyName(assignedQueue)}`;
  }
  if (assignedQueue) {
    return friendlyName(assignedQueue);
  }
  return friendlyName(department);
}

function routingReasonLabel(row: ProjectWorkflowJobRow, department: ProjectTrackingDepartment) {
  const expected = normalizeDepartment(department);
  const stepDepartment = normalizeDepartment(row.current_step?.department);
  const assignedQueue = normalizeDepartment(row.current_step?.assigned_queue);
  if (assignedQueue === expected && stepDepartment === expected) {
    return "Here by current step department";
  }
  if (assignedQueue === expected && stepDepartment && stepDepartment !== expected) {
    return `Here by ${friendlyName(row.current_step?.assigned_queue)} department`;
  }
  if (stepDepartment === expected) {
    return "Here by current step department";
  }
  return "Needs routing review";
}

function normalizeDepartment(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  if (value === "graphics") {
    return "production";
  }
  if (value === "csr" || value === "customer_service" || value === "leadership") {
    return "operations";
  }
  return value;
}

function rowBelongsToDepartment(row: ProjectWorkflowJobRow, department: ProjectTrackingDepartment) {
  const expected = normalizeDepartment(department);
  const stepDepartment = normalizeDepartment(row.current_step?.department);
  const assignedQueue = normalizeDepartment(row.current_step?.assigned_queue);
  return stepDepartment === expected || assignedQueue === expected;
}

function jobDetailHash(row: ProjectWorkflowJobRow, department: ProjectTrackingDepartment) {
  if (department === "schools") {
    return buildSharedJobHash("#schools/jobs", row.job_id);
  }
  if (department === "sports") {
    return buildSharedJobHash("#sports/jobs", row.job_id);
  }
  return buildSharedJobHash("#jobs", row.job_id);
}

export function ProjectTrackingDepartmentQueue({ token, department, title, summary, limit = 6 }: Props) {
  const [payload, setPayload] = useState<ProjectWorkflowCommandCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const loadQueue = async (cancelledRef?: { current: boolean }) => {
    setLoading(true);
    setError("");
    try {
      const response = await getProjectWorkflowCommandCenter(token, { view: "department", department, limit });
      if (!cancelledRef?.current) {
        setPayload(response);
      }
    } catch (loadError) {
      if (!cancelledRef?.current) {
        setPayload(null);
        setError(loadError instanceof Error ? loadError.message : "Project Dashboard work could not load.");
      }
    } finally {
      if (!cancelledRef?.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const cancelledRef = { current: false };
    void loadQueue(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [department, limit, token]);

  if (loading) {
    return <WorkspaceLoadingBlock title={`Loading ${title.toLowerCase()}`} summary={summary} />;
  }

  const rows = (payload?.job_rows ?? []).filter((row) => rowBelongsToDepartment(row, department));

  return (
    <section className="panel project-tracking-department-queue">
      <WorkspaceSectionHeader
        eyebrow="Project Dashboard"
        title={title}
        summary={summary}
        compact
        badge={<span className="metric-pill">{rows.length} in queue</span>}
      />
      {error ? (
        <WorkspaceEmptyState title="Project Dashboard queue unavailable" summary={error} compact />
      ) : rows.length ? (
        <div className="project-tracking-department-queue__table" role="table" aria-label={title}>
          <div className="project-tracking-department-queue__row project-tracking-department-queue__row--head" role="row">
            <span role="columnheader">Organization / account</span>
            <span role="columnheader">Job</span>
            <span role="columnheader">Current step</span>
            <span role="columnheader">Department</span>
            <span role="columnheader">Assigned person</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Shared note</span>
            <span role="columnheader">Actions</span>
          </div>
          {rows.map((row) => {
            const expanded = expandedRowId === row.job_id;
            return (
            <div className="project-tracking-department-queue__row" role="row" key={row.job_id}>
              <span title={row.organization_name ?? undefined}>{row.organization_name ?? row.account_name ?? "Account not connected yet"}</span>
              <strong title={row.job_title}>{row.job_title || "Untitled job"}</strong>
              <span title={currentStepLabel(row)}>
                {row.workflow_run_id && row.current_step ? (
                  <QuickWorkflowNextStepMover
                    token={token}
                    workflowRunId={row.workflow_run_id}
                    step={{
                      id: row.current_step.id,
                      name: row.current_step.name,
                      workflow_run_id: row.workflow_run_id,
                      status: row.current_step.status,
                      assigned_user_id: row.current_step.assigned_user_id,
                      assigned_queue: row.current_step.assigned_queue,
                      updated_at: row.current_step.updated_at
                    }}
                    onSaved={loadQueue}
                  />
                ) : (
                  currentStepLabel(row)
                )}
              </span>
              <span className="project-tracking-department-queue__lane">
                <strong>{stepTeamLabel(row)}</strong>
                <small>{routingReasonLabel(row, department)}</small>
              </span>
              <span>{ownerLabel(row)}</span>
              <span className={`project-tracking-department-queue__risk project-tracking-department-queue__risk--${healthTone(row)}`}>
                {healthLabel(row)}
              </span>
              <span title={row.current_step?.notes ?? undefined}>{row.current_step?.notes ?? "No shared note yet"}</span>
              {row.workflow_run_id && row.current_step ? (
                <span className="project-tracking-department-queue__workflow-actions">
                  <button type="button" onClick={() => setEditingStepId(editingStepId === row.current_step?.id ? null : row.current_step?.id ?? null)}>
                    Assign / Status
                  </button>
                  <a href={`#project-tracking/workflows/${row.workflow_run_id}`}>Open Workflow</a>
                  <button type="button" aria-expanded={expanded} onClick={() => setExpandedRowId(expanded ? null : row.job_id)}>
                    Details
                  </button>
                </span>
              ) : (
                <span>No workflow map</span>
              )}
              {expanded ? (
                <div className="project-tracking-department-queue__details">
                  <div>
                    <span>Job date</span>
                    <strong>{jobDateLabel(row.job_date)}</strong>
                  </div>
                  <div>
                    <span>Next deadline</span>
                    <strong>{dateLabel(row.next_deadline_at)}</strong>
                  </div>
                  <div>
                    <span>Waiting</span>
                    <strong>{waitingLabel(row)}</strong>
                  </div>
                  <div>
                    <span>Status detail</span>
                    <strong className={`project-tracking-department-queue__risk project-tracking-department-queue__risk--${operationalTone(row)}`}>
                      {operationalStatusLabel(row)}
                    </strong>
                  </div>
                  <div>
                    <span>Why here</span>
                    <strong>{row.queue_intelligence.reason}</strong>
                  </div>
                  <div>
                    <span>Next action</span>
                    <strong>{row.queue_intelligence.next_action}</strong>
                  </div>
                  <div>
                    <span>Clear condition</span>
                    <strong>{row.queue_intelligence.clear_condition}</strong>
                  </div>
                  <div>
                    <span>Job record</span>
                    <a href={jobDetailHash(row, department)}>Open Job</a>
                  </div>
                </div>
              ) : null}
              {row.workflow_run_id && row.current_step && editingStepId === row.current_step.id ? (
                <div className="project-tracking-department-queue__quick-editor">
                  <QuickWorkflowStepEditor
                    token={token}
                    workflowRunId={row.workflow_run_id}
                    step={{
                      id: row.current_step.id,
                      name: row.current_step.name,
                      status: row.current_step.status,
                      assigned_user_id: row.current_step.assigned_user_id,
                      assigned_queue: row.current_step.assigned_queue,
                      notes: row.current_step.notes,
                      updated_at: row.current_step.updated_at
                    }}
                    onSaved={loadQueue}
                  />
                </div>
              ) : null}
            </div>
            );
          })}
        </div>
      ) : (
        <WorkspaceEmptyState
          title="No active Project Dashboard steps here"
          summary="When a workflow reaches this department, it will appear here automatically from the same job-row source as Project Dashboard."
          compact
        />
      )}
    </section>
  );
}
