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

type ProductionBoardLaneId =
  | "came_in"
  | "ready_to_start"
  | "in_production"
  | "blocked_waiting"
  | "qa_hold"
  | "ready_to_release"
  | "released_complete";

const PRODUCTION_BOARD_LANES: Array<{ id: ProductionBoardLaneId; title: string; summary: string }> = [
  { id: "came_in", title: "What came in", summary: "New handoffs from upstream workflow." },
  { id: "ready_to_start", title: "Ready to start", summary: "Accepted or queue-owned work missing an owner." },
  { id: "in_production", title: "In production", summary: "Active work Production can move now." },
  { id: "blocked_waiting", title: "Blocked / waiting", summary: "Real blocker or missing-info signals only." },
  { id: "qa_hold", title: "QA / on hold", summary: "QA, correction, or hold language from the current step." },
  { id: "ready_to_release", title: "Ready to release", summary: "Release-ready language from real workflow data." },
  { id: "released_complete", title: "Released / complete", summary: "Production-complete handoffs ready to return." }
];

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

function itemSearchText(item: ProjectWorkflowProductionQueueItem) {
  return [
    item.production_step,
    item.needed_work,
    item.next_action,
    item.clear_condition,
    item.notes,
    item.missing_info,
    item.step_status,
    item.status,
    item.assignment_status
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function laneForItem(item: ProjectWorkflowProductionQueueItem): ProductionBoardLaneId {
  const text = itemSearchText(item);
  if (item.status === "production_complete") {
    return "released_complete";
  }
  if (item.status === "sent_to_production" || item.status === "pending") {
    return "came_in";
  }
  if (item.status === "waiting_on_info" || item.assignment_status === "waiting_on_info" || item.step_status === "BLOCKED" || item.operational_status === "waiting") {
    return "blocked_waiting";
  }
  if (text.includes("ready to release") || text.includes("release ready")) {
    return "ready_to_release";
  }
  if (text.includes("qa") || text.includes("correction") || text.includes("hold")) {
    return "qa_hold";
  }
  if (item.assignment_status === "needs_assignment" || !item.assigned_user_id) {
    return "ready_to_start";
  }
  return "in_production";
}

function laneTone(laneId: ProductionBoardLaneId) {
  if (laneId === "blocked_waiting") {
    return "danger";
  }
  if (laneId === "ready_to_release" || laneId === "released_complete") {
    return "success";
  }
  if (laneId === "qa_hold") {
    return "warning";
  }
  return "neutral";
}

function ageLabel(value: string | null | undefined) {
  if (!value) {
    return "No age signal";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No age signal";
  }
  const elapsedMs = Date.now() - date.getTime();
  if (elapsedMs < 0) {
    return "Updated ahead";
  }
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 1) {
    return "Updated just now";
  }
  if (hours < 24) {
    return `${hours}h aging`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d aging`;
}

function riskLabel(item: ProjectWorkflowProductionQueueItem) {
  if (item.step_status === "BLOCKED") {
    return "Blocked";
  }
  if (item.status === "waiting_on_info" || item.assignment_status === "waiting_on_info" || item.operational_status === "waiting") {
    return "Waiting";
  }
  if (item.operational_status === "overdue") {
    return "Overdue";
  }
  if (item.operational_status === "missing_owner" || item.assignment_status === "needs_assignment" || !item.assigned_user_id) {
    return "Needs owner";
  }
  return "On track";
}

function jobDetailHref(item: ProjectWorkflowProductionQueueItem) {
  return `#jobs/detail?preview=${encodeURIComponent(item.job_id)}`;
}

function accountHref(item: ProjectWorkflowProductionQueueItem) {
  return item.organization_id ? `#client-command-center/accounts/${encodeURIComponent(item.organization_id)}` : null;
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
  const lanes = useMemo(
    () =>
      PRODUCTION_BOARD_LANES.map((lane) => ({
        ...lane,
        items: items.filter((item) => laneForItem(item) === lane.id)
      })),
    [items]
  );

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
          <span className="eyebrow">Production Operating Board V1</span>
          <h1>Production Operating Board</h1>
          <p>
            Spencer-facing board for real Production handoffs and queue-owned workflow steps. No fake automation, no synthetic urgency.
          </p>
        </div>
        <a className="button button-secondary" href="#project-tracking">
          Project Dashboard
        </a>
      </div>

      {queue ? (
        <div className="production-workflow-queue__summary" aria-label="Production queue summary">
          <div><span>Came in</span><strong>{queue.summary.ready_for_production}</strong></div>
          <div><span>Needs owner</span><strong>{queue.summary.needs_assignment}</strong></div>
          <div><span>Blocked / waiting</span><strong>{queue.summary.waiting_on_info}</strong></div>
          <div><span>Due today</span><strong>{queue.summary.due_today}</strong></div>
          <div><span>Overdue</span><strong>{queue.summary.overdue}</strong></div>
        </div>
      ) : null}

      {notice ? <p className="production-workflow-queue__notice">{notice}</p> : null}
      {error ? <p className="production-workflow-queue__error">{error}</p> : null}

      <div className="production-operating-board" aria-label="Production Operating Board lanes">
        {lanes.map((lane) => (
          <section className={`production-operating-board__lane is-${laneTone(lane.id)}`} key={lane.id} aria-label={lane.title}>
            <div className="production-operating-board__lane-header">
              <div>
                <h2>{lane.title}</h2>
                <p>{lane.summary}</p>
              </div>
              <strong>{lane.items.length}</strong>
            </div>
            <div className="production-operating-board__cards">
              {loading ? <p className="section-subtitle">Loading...</p> : null}
              {!loading && lane.items.length === 0 ? <p className="section-subtitle">No real rows in this lane.</p> : null}
              {lane.items.slice(0, 4).map((item) => {
                const itemKey = item.handoff_id ?? `${item.workflow_run_id}:${item.step_id}`;
                const accountLink = accountHref(item);
                return (
                  <article className="production-operating-card" key={`${lane.id}-${itemKey}`}>
                    <div className="production-operating-card__head">
                      <strong>{item.organization_name ?? item.job_title}</strong>
                      <span>{riskLabel(item)}</span>
                    </div>
                    <p>{item.production_step}</p>
                    <div className="production-operating-card__meta">
                      <span>{formatDate(item.due_at)}</span>
                      <span>{displayAssignmentLabel(item)}</span>
                      <span>{ageLabel(item.last_updated)}</span>
                    </div>
                    <div className="production-operating-card__next">
                      <span>Next action</span>
                      <strong>{item.next_action}</strong>
                    </div>
                    <div className="production-operating-card__links">
                      <a href={`#project-tracking/workflows/${item.workflow_run_id}`}>Open workflow</a>
                      <a href={jobDetailHref(item)}>Open job</a>
                      {accountLink ? <a href={accountLink}>Open account</a> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

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
          const accountLink = accountHref(item);
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
              <a className="button button-secondary" href={jobDetailHref(item)}>
                Open Job
              </a>
              {accountLink ? (
                <a className="button button-secondary" href={accountLink}>
                  Open Account
                </a>
              ) : null}
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
