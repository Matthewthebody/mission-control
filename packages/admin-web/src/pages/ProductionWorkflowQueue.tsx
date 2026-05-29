import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "../types";
import type { ProjectWorkflowProductionQueue, ProjectWorkflowProductionQueueItem } from "../projectTrackingTypes";
import {
  acceptProjectWorkflowHandoff,
  claimProjectWorkflowHandoff,
  getProjectWorkflowProductionQueue,
  markProjectWorkflowHandoffProductionComplete,
  markProjectWorkflowHandoffWaiting,
  returnProjectWorkflowHandoffToSchools
} from "../services/projectTracking";
import { QuickWorkflowStepEditor } from "../components/projectTracking/QuickWorkflowStepEditor";
import { QuickWorkflowNextStepMover } from "../components/projectTracking/QuickWorkflowNextStepMover";

type ProductionWorkflowQueueProps = {
  token: string;
  currentUser: SessionUser;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not connected yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not connected yet";
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not connected yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not connected yet";
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function friendly(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(item: ProjectWorkflowProductionQueueItem) {
  if (item.status === "pending" || item.status === "sent_to_production") {
    return "Ready for Production";
  }
  if (item.status === "accepted_by_production") {
    return item.assignment_status === "needs_assignment" ? "Needs Assignment" : "Accepted";
  }
  if (item.status === "waiting_on_info" || item.assignment_status === "waiting_on_info") {
    return "Waiting on Info";
  }
  if (item.status === "production_complete") {
    return "Production Complete";
  }
  return friendly(item.status);
}

function assignmentLabel(item: ProjectWorkflowProductionQueueItem) {
  if (item.assigned_user_name) {
    return item.assignment_status === "claimed" ? `Claimed by ${item.assigned_user_name}` : item.assigned_user_name;
  }
  if (item.assignment_status === "needs_assignment") {
    return `Needs Assignment · ${friendly(item.assigned_queue ?? "production")}`;
  }
  if (item.assigned_queue) {
    return `${friendly(item.assigned_queue)} Queue`;
  }
  return "Queue not set";
}

function waitingLabel(item: ProjectWorkflowProductionQueueItem) {
  if (item.waiting_detail) {
    return `${friendly(item.waiting_on_party ?? "unknown")}: ${item.waiting_detail}`;
  }
  if (item.missing_info) {
    return item.missing_info;
  }
  return "Nothing flagged";
}

function displayAssignmentLabel(item: ProjectWorkflowProductionQueueItem) {
  return assignmentLabel(item).replace(/\u00c2\u00b7/g, "-").replace(/\u00b7/g, "-");
}

function canAccept(item: ProjectWorkflowProductionQueueItem) {
  return item.source === "handoff" && item.status === "sent_to_production";
}

function canClaim(item: ProjectWorkflowProductionQueueItem) {
  return (
    item.source === "handoff" &&
    item.status === "accepted_by_production" &&
    !item.assigned_user_id &&
    !["claimed", "assigned", "in_progress", "completed"].includes(item.assignment_status ?? "")
  );
}

function canMarkMissingInfo(item: ProjectWorkflowProductionQueueItem) {
  return item.source === "handoff" && item.status === "accepted_by_production";
}

function canMarkComplete(item: ProjectWorkflowProductionQueueItem) {
  return item.source === "handoff" && (item.status === "accepted_by_production" || item.status === "waiting_on_info");
}

function canReturnToSchools(item: ProjectWorkflowProductionQueueItem) {
  return item.source === "handoff" && item.status === "production_complete";
}

function claimButtonLabel(item: ProjectWorkflowProductionQueueItem) {
  if (canClaim(item)) {
    return "Claim";
  }
  if (item.status !== "accepted_by_production" && !item.assigned_user_id) {
    return "Accept first";
  }
  return "Claimed / assigned";
}

export function ProductionWorkflowQueue({ token }: ProductionWorkflowQueueProps) {
  const [queue, setQueue] = useState<ProjectWorkflowProductionQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);

  const loadQueue = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await getProjectWorkflowProductionQueue(token, { limit: 50 });
      setQueue(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the Production Queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, [token]);

  const items = useMemo(() => queue?.items ?? [], [queue]);

  const runAction = async (item: ProjectWorkflowProductionQueueItem, label: string, action: () => Promise<unknown>) => {
    if (!item.handoff_id) {
      setNotice("");
      setError("Open Workflow to update department-owned work.");
      return;
    }
    setSavingId(item.handoff_id);
    setNotice("");
    setError("");
    try {
      await action();
      setNotice(label);
      await loadQueue();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "We couldn't update this Production handoff.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="production-workflow-queue">
      <div className="production-workflow-queue__header">
        <div>
          <span className="eyebrow">Production Queue V1</span>
          <h1>Production Queue</h1>
          <p>
            Filtered view of Production-owned workflow work. Project Dashboard is the company-wide map; this page is the Production department.
          </p>
        </div>
        <a className="button button-secondary" href="#project-tracking">
          Project Dashboard
        </a>
      </div>

      {queue ? (
        <div className="production-workflow-queue__summary" aria-label="Production queue summary">
          <button type="button"><span>Ready for Production</span><strong>{queue.summary.ready_for_production}</strong></button>
          <button type="button"><span>Needs Assignment</span><strong>{queue.summary.needs_assignment}</strong></button>
          <button type="button"><span>Waiting on Info</span><strong>{queue.summary.waiting_on_info}</strong></button>
          <button type="button"><span>Due Today</span><strong>{queue.summary.due_today}</strong></button>
          <button type="button"><span>Overdue</span><strong>{queue.summary.overdue}</strong></button>
        </div>
      ) : null}

      {notice ? <p className="production-workflow-queue__notice">{notice}</p> : null}
      {error ? <p className="production-workflow-queue__error">{error}</p> : null}

      <div className="production-workflow-table" role="table" aria-label="Production Queue handoffs">
        <div className="production-workflow-table__header" role="row">
          <span>Due</span>
          <span>School / Job</span>
          <span>Current step</span>
          <span>Assigned person</span>
          <span>Department</span>
          <span>Status</span>
          <span>Shared note</span>
          <span>Action</span>
        </div>
        {loading ? <p className="section-subtitle">Loading Production Queue...</p> : null}
        {!loading && items.length === 0 ? (
          <p className="section-subtitle">No Production-owned workflow work is waiting right now.</p>
        ) : null}
        {items.map((item) => {
          const itemKey = item.handoff_id ?? `${item.workflow_run_id}:${item.step_id}`;
          const expanded = expandedItemKey === itemKey;
          return (
          <article className="production-workflow-row" role="row" key={itemKey}>
            <span>{formatDate(item.due_at)}</span>
            <span>
              <strong title={item.organization_name ?? item.job_title}>{item.organization_name ?? item.job_title}</strong>
              <small title={item.job_title}>{item.job_title}</small>
            </span>
            <span>
              <QuickWorkflowNextStepMover
                token={token}
                workflowRunId={item.workflow_run_id}
                step={{
                  id: item.step_id,
                  name: item.production_step,
                  workflow_run_id: item.workflow_run_id,
                  status: item.step_status,
                  assigned_user_id: item.assigned_user_id,
                  assigned_queue: item.assigned_queue,
                  updated_at: item.last_updated
                }}
                onSaved={loadQueue}
              />
            </span>
            <span>{displayAssignmentLabel(item)}</span>
            <span>{friendly(item.assigned_queue ?? "production")}</span>
            <span><mark className={`production-workflow-status is-${item.status}`}>{statusLabel(item)}</mark></span>
            <span title={item.notes ?? undefined}>{item.notes ? item.notes : "No shared note yet"}</span>
            <span className="production-workflow-row__actions">
              <button type="button" className="button" onClick={() => setEditingStepId(editingStepId === item.step_id ? null : item.step_id)}>
                Assign / Status
              </button>
              <a className="button button-secondary" href={`#project-tracking/workflows/${item.workflow_run_id}`}>
                Open Workflow
              </a>
              <button
                type="button"
                className="button button-secondary"
                aria-expanded={expanded}
                onClick={() => setExpandedItemKey(expanded ? null : itemKey)}
              >
                Details
              </button>
            </span>
            {expanded ? (
              <div className="production-workflow-row__details">
                <div>
                  <span>Why here</span>
                  <strong>{item.lane_reason}</strong>
                </div>
                <div>
                  <span>Job type</span>
                  <strong>{friendly(item.job_type)}</strong>
                </div>
                <div>
                  <span>Needed work</span>
                  <strong>{item.needed_work}</strong>
                </div>
                <div>
                  <span>Waiting</span>
                  <strong>{waitingLabel(item)}</strong>
                </div>
                <div>
                  <span>Next action</span>
                  <strong>{item.next_action}</strong>
                </div>
                <div>
                  <span>Clear condition</span>
                  <strong>{item.clear_condition}</strong>
                </div>
                <div>
                  <span>Last updated</span>
                  <strong>{formatDateTime(item.last_updated)}</strong>
                </div>
                {item.source !== "handoff" ? (
                  <div className="production-workflow-row__details-wide">
                    <span>Source</span>
                    <strong>Current workflow step. Use Assign / Status for owner, department, and shared note changes.</strong>
                  </div>
                ) : (
                  <div className="production-workflow-row__handoff-actions production-workflow-row__details-wide">
                    <span>Handoff actions</span>
                    <div>
                      <button type="button" disabled={savingId === item.handoff_id || !canAccept(item)} onClick={() => void runAction(item, "Production accepted the handoff.", () => acceptProjectWorkflowHandoff(token, item.handoff_id!))}>
                        {canAccept(item) ? "Accept" : "Accepted"}
                      </button>
                      <button type="button" disabled={savingId === item.handoff_id || !canClaim(item)} onClick={() => void runAction(item, "Production claimed the work.", () => claimProjectWorkflowHandoff(token, item.handoff_id!, { assigned_queue: "production", notes: "Claimed from Production Queue." }))}>
                        {claimButtonLabel(item)}
                      </button>
                      <button type="button" disabled={savingId === item.handoff_id || !canMarkMissingInfo(item)} onClick={() => void runAction(item, "Marked waiting on info.", () => markProjectWorkflowHandoffWaiting(token, item.handoff_id!, { waiting_on_party: "school", waiting_detail: "Production needs missing information before continuing." }))}>Mark Missing Info</button>
                      <button type="button" disabled={savingId === item.handoff_id || !canMarkComplete(item)} onClick={() => void runAction(item, "Production marked complete.", () => markProjectWorkflowHandoffProductionComplete(token, item.handoff_id!))}>
                        {canMarkComplete(item) ? "Mark Complete" : "Production Complete"}
                      </button>
                      <button type="button" disabled={savingId === item.handoff_id || !canReturnToSchools(item)} onClick={() => void runAction(item, "Returned to Schools.", () => returnProjectWorkflowHandoffToSchools(token, item.handoff_id!, { return_reason: "Production complete and ready for Schools follow-up.", issue_flag: false }))}>Return to Schools</button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {editingStepId === item.step_id ? (
              <div className="production-workflow-row__quick-editor">
                <QuickWorkflowStepEditor
                  token={token}
                  workflowRunId={item.workflow_run_id}
                  step={{
                    id: item.step_id,
                    name: item.production_step,
                    status: item.step_status,
                    assigned_user_id: item.assigned_user_id,
                    assigned_queue: item.assigned_queue,
                    notes: item.notes,
                    updated_at: item.last_updated
                  }}
                  onSaved={loadQueue}
                />
              </div>
            ) : null}
          </article>
          );
        })}
      </div>
    </section>
  );
}
