import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { EmployeeShiftDetailPanel } from "../components/EmployeeShiftDetailPanel";
import { QuickWorkflowNextStepMover } from "../components/projectTracking/QuickWorkflowNextStepMover";
import { QuickWorkflowStepEditor } from "../components/projectTracking/QuickWorkflowStepEditor";
import {
  fetchEmployeeMyWork,
  fetchEmployeeEventDetail,
  type EmployeeMyWorkApprovalRecord,
  type EmployeeMyWorkAcknowledgementRecord,
  type EmployeeMyWorkEventRecord,
  type EmployeeEventDetailResponse,
  type EmployeeMyWorkExceptionRecord,
  type EmployeeMyWorkJobRecord,
  type EmployeeMyWorkRecentChangeRecord,
  type EmployeeMyWorkResponse,
  type EmployeeMyWorkTaskRecord,
  type EmployeeMyWorkWorkflowStepRecord
} from "../services/employeeExperience";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

export function MyWork({ token, currentUser, socket }: Props) {
  const [anchorDate, setAnchorDate] = useState(getLocalDateString());
  const [payload, setPayload] = useState<EmployeeMyWorkResponse | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEventDetail, setSelectedEventDetail] = useState<EmployeeEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [editingWorkflowStepId, setEditingWorkflowStepId] = useState("");

  const selectedEvent = useMemo(
    () => payload?.events.find((event) => event.id === selectedEventId) ?? null,
    [payload?.events, selectedEventId]
  );

  async function load() {
    setLoading(true);
    try {
      const response = await fetchEmployeeMyWork(token, anchorDate);
      setPayload(response);
      setError("");
      setSelectedEventId((current) => (response.events.some((event) => event.id === current) ? current : ""));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load My Work.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEventDetail(eventId: string) {
    if (!eventId) {
      setSelectedEventDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const detail = await fetchEmployeeEventDetail(token, eventId);
      setSelectedEventDetail(detail);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load that event detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [anchorDate, token]);

  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEventDetail(null);
      return;
    }
    void loadEventDetail(selectedEventId);
  }, [selectedEventId, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2400);
    const onRefresh = () => {
      setLiveMessage("Live update: My Work refreshed.");
      void load();
      if (selectedEventId) {
        void loadEventDetail(selectedEventId);
      }
      clearLiveMessage();
    };

    socket.on("schedule_changed", onRefresh);
    socket.on("attendance_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("attendance_changed", onRefresh);
      socket.off("notification_created", onRefresh);
    };
  }, [selectedEventId, socket]);

  return (
    <>
      <section className="page-intro page-intro--compact">
        <div>
          <div className="eyebrow">My Work</div>
          <h2>Execution Center</h2>
          <p>Track assigned jobs, events, tasks, acknowledgements, exceptions, approvals, and recent changes across every department from one place.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">{currentUser.fullName}</div>
          <label className="filter-field">
            <span>Anchor Date</span>
            <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
          </label>
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {liveMessage ? <div className="feedback-strip feedback-strip--info">{liveMessage}</div> : null}

      <section className="employee-summary-strip">
        <SummaryTile eyebrow="Jobs" value={payload?.summary.assigned_job_count ?? 0} detail="Assigned jobs linked to your work." />
        <SummaryTile eyebrow="Current Steps" value={payload?.summary.live_workflow_step_count ?? 0} detail="Workflow steps assigned directly to you." />
        <SummaryTile eyebrow="Events" value={payload?.summary.assigned_event_count ?? 0} detail="Immediate schedule context and execution windows." />
        <SummaryTile eyebrow="Tasks" value={payload?.summary.assigned_task_count ?? 0} detail="Open tasks assigned directly to you." />
        <SummaryTile eyebrow="Acknowledge" value={payload?.summary.acknowledgement_count ?? 0} detail="Meaningful changes waiting on your acknowledgement." />
        <SummaryTile eyebrow="Exceptions" value={payload?.summary.owned_exception_count ?? 0} detail="Open exception records tied to your work." />
        <SummaryTile eyebrow="Approvals" value={payload?.summary.approval_waiting_count ?? 0} detail="Approvals currently waiting on you." />
        <SummaryTile eyebrow="Recent Changes" value={payload?.summary.recent_change_count ?? 0} detail="New or changed items that may need action." />
      </section>

      <section className="employee-work-layout">
        <div className="panel employee-shift-rail">
          <div className="section-title">Immediate Schedule</div>
          <p className="section-subtitle">Your next live execution windows, with the old field-detail console demoted behind selected event detail.</p>

          <div className="ops-preview-list">
            <ScheduleContextCard
              label="Current"
              event={payload?.schedule_context.current_event ?? null}
              emptyLabel={payload?.schedule_context.active_now_count ? "Active work is in progress." : "Nothing is active right now."}
            />
            <ScheduleContextCard
              label="Up Next"
              event={payload?.schedule_context.next_event ?? null}
              emptyLabel="No additional events are lined up from this anchor date."
            />
          </div>

          {loading ? <div className="empty-state empty-state--panel">Loading your events...</div> : null}
          {!loading && !payload?.events.length ? <div className="empty-state empty-state--panel">No events are assigned right now.</div> : null}

          <div className="employee-shift-list">
            {(payload?.events ?? []).map((event) => (
              <button
                key={event.id}
                className={`employee-shift-card${selectedEvent?.id === event.id ? " employee-shift-card--selected" : ""}`}
                onClick={() => setSelectedEventId(event.id)}
              >
                <div className="employee-shift-card__top">
                  <span className="eyebrow">{formatDepartmentLabel(event.department)}</span>
                  <span className={`home-tone-chip home-tone-chip--${toneForEvent(event)}`}>{event.action_label}</span>
                </div>
                <strong>{event.title}</strong>
                <div className="muted">{event.subtitle ?? humanizeLabel(event.status)}</div>
                <div className="employee-shift-card__meta">
                  <span>{formatShortWindow(event.starts_at, event.ends_at)}</span>
                  <span>{humanizeLabel(event.staffing_role ?? "assigned_event")}</span>
                </div>
                <div className="employee-shift-card__location">{event.location_name || event.location_address || "Location pending"}</div>
                {event.linked_job_number || event.linked_job_title ? (
                  <div className="muted">
                    {event.linked_job_number ? `${event.linked_job_number} · ` : ""}
                    {event.linked_job_title ?? "Linked job"}
                  </div>
                ) : null}
                <div className="employee-shift-card__flags">
                  {event.note_summary && !event.notes_acknowledged ? <span className="meta-pill">Notes To Review</span> : null}
                  {event.open_exception_count ? <span className="meta-pill">{event.open_exception_count} exception</span> : null}
                  {event.follow_through_label ? <span className="meta-pill">{event.follow_through_label}</span> : null}
                </div>
              </button>
            ))}
          </div>

          <PanelList
            title="Assigned Jobs"
            subtitle="Jobs tied to your tasks or scheduled events."
            items={payload?.jobs ?? []}
            getKey={(job) => job.id}
            empty="No linked jobs are visible for your current work."
            renderItem={(job) => <JobCard job={job} />}
          />
        </div>

        <div className="panel employee-detail-panel">
          <PanelList
            title="Assigned Tasks"
            subtitle="Work items pulled from the shared task layer, not a local page-only checklist."
            items={payload?.tasks ?? []}
            getKey={(task) => task.id}
            empty="No open assigned tasks are in your queue."
            renderItem={(task) => <TaskCard task={task} />}
          />

          <PanelList
            title="Current Steps"
            subtitle="Current workflow steps assigned directly to you."
            items={payload?.live_workflow_steps ?? []}
            getKey={(step) => step.id}
            empty="No workflow steps are personally assigned to you."
            renderItem={(step) => (
              <WorkflowStepCard
                step={step}
                token={token}
                editing={editingWorkflowStepId === step.id}
                onToggleEdit={() => setEditingWorkflowStepId((current) => (current === step.id ? "" : step.id))}
                onSaved={async () => {
                  await load();
                  setEditingWorkflowStepId("");
                }}
              />
            )}
          />

          <PanelList
            title="Required Acknowledgements"
            subtitle="Meaningful changes that need an explicit acknowledgement."
            items={payload?.acknowledgements ?? []}
            getKey={(item) => item.id}
            empty="No acknowledgements are waiting on you."
            renderItem={(item) => <AcknowledgementCard item={item} />}
          />

          <PanelList
            title="Owned Exceptions"
            subtitle="Exception records tied to your work that still need follow-through."
            items={payload?.exceptions ?? []}
            getKey={(item) => item.id}
            empty="No active exceptions are tied to your work."
            renderItem={(item) => <ExceptionCard item={item} />}
          />

          <PanelList
            title="Approvals Waiting On You"
            subtitle="Operational approvals that currently need your decision."
            items={payload?.approvals ?? []}
            getKey={(item) => item.id}
            empty="No approvals are waiting on you."
            renderItem={(item) => <ApprovalCard item={item} />}
          />

          <PanelList
            title="Recent Changes"
            subtitle="The most recent changes to your work records and related notifications."
            items={payload?.recent_changes ?? []}
            getKey={(item) => item.id}
            empty="No recent changes are waiting here."
            renderItem={(item) => <RecentChangeCard item={item} />}
          />
        </div>
      </section>

      <section className="panel employee-detail-panel">
        <div className="section-title">Selected Event Detail</div>
        <p className="section-subtitle">Detailed field actions are still available here, but they are now a secondary surface under the shared My Work execution model.</p>
        {detailLoading && !selectedEventDetail ? <div className="empty-state empty-state--panel">Loading event detail...</div> : null}
        {!detailLoading && !selectedEventDetail ? (
          <div className="empty-state empty-state--panel">Choose an event from Immediate Schedule to open its detailed field workflow.</div>
        ) : null}
        {selectedEventDetail ? (
          <EmployeeShiftDetailPanel
            token={token}
            currentUser={currentUser}
            detail={selectedEventDetail}
            onUpdated={async () => {
              await load();
              await loadEventDetail(selectedEventDetail.event.id);
            }}
            onNotice={setNotice}
            onError={setError}
          />
        ) : null}
      </section>
    </>
  );
}

function SummaryTile({ eyebrow, value, detail }: { eyebrow: string; value: number; detail: string }) {
  return (
    <article className="employee-summary-tile">
      <span className="eyebrow">{eyebrow}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PanelList<T>({
  title,
  subtitle,
  items,
  getKey,
  empty,
  renderItem
}: {
  title: string;
  subtitle: string;
  items: T[];
  getKey: (item: T) => string;
  empty: string;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <div className="employee-notifications">
      <div className="section-title">{title}</div>
      <p className="section-subtitle">{subtitle}</p>
      <div className="ops-preview-list">
        {items.length ? items.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>) : <div className="empty-state">{empty}</div>}
      </div>
    </div>
  );
}

function ScheduleContextCard({
  label,
  event,
  emptyLabel
}: {
  label: string;
  event: EmployeeMyWorkEventRecord | null;
  emptyLabel: string;
}) {
  return (
    <article className="notification-card notification-card--normal">
      <strong>{label}</strong>
      {event ? (
        <>
          <div>{event.title}</div>
          <div className="muted">{formatShortWindow(event.starts_at, event.ends_at)}</div>
          <div className="muted">{event.location_name || event.location_address || "Location pending"}</div>
        </>
      ) : (
        <div className="muted">{emptyLabel}</div>
      )}
    </article>
  );
}

function JobCard({ job }: { job: EmployeeMyWorkJobRecord }) {
  return (
    <article className="notification-card notification-card--normal">
      <strong>{job.job_number ? `${job.job_number} · ${job.title}` : job.title}</strong>
      <div className="muted">{formatDepartmentLabel(job.department)} · {job.status_label}</div>
      <div className="muted">{job.organization_display_name ?? "Organization pending"}</div>
      <div className="employee-shift-card__flags">
        <span className="meta-pill">{job.assigned_task_count} task{job.assigned_task_count === 1 ? "" : "s"}</span>
        <span className="meta-pill">{job.assigned_event_count} event{job.assigned_event_count === 1 ? "" : "s"}</span>
        {job.assigned_workflow_step_count ? <span className="meta-pill">{job.assigned_workflow_step_count} workflow step{job.assigned_workflow_step_count === 1 ? "" : "s"}</span> : null}
        {job.open_exception_count ? <span className="meta-pill">{job.open_exception_count} exception</span> : null}
      </div>
      {job.next_event_at ? <div className="muted">Next event {formatDateTime(job.next_event_at)}</div> : null}
    </article>
  );
}

function WorkflowStepCard({
  step,
  token,
  editing,
  onToggleEdit,
  onSaved
}: {
  step: EmployeeMyWorkWorkflowStepRecord;
  token: string;
  editing: boolean;
  onToggleEdit: () => void;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(toneForWorkflowStep(step))}`}>
      <strong>{step.job_number ? `${step.job_number} - ${step.job_title}` : step.job_title}</strong>
      <div className="muted">Department: {formatDepartmentLabel(step.assigned_queue ?? step.department)}</div>
      <div className="muted">Assigned person: You</div>
      <div className="muted">
        Current step:{" "}
        <QuickWorkflowNextStepMover
          token={token}
          workflowRunId={step.workflow_run_id}
          step={{
            id: step.id,
            name: step.step_name,
            workflow_run_id: step.workflow_run_id,
            status: step.status,
            assigned_user_id: step.assigned_user_id ?? null,
            assigned_queue: step.assigned_queue ?? null,
            updated_at: step.updated_at ?? null
          }}
          onSaved={onSaved}
        />
      </div>
      {step.notes ? <div className="muted">Shared note: {step.notes}</div> : null}
      <div className="employee-workflow-step-card__actions">
        <button type="button" className="button" onClick={onToggleEdit}>
          Assign / Status
        </button>
        <a className="secondary-button" href={step.deep_link}>Open Workflow</a>
      </div>
      <details className="employee-workflow-step-card__details">
        <summary>Details</summary>
        <div className="employee-workflow-step-card__details-grid">
          <div>
            <span>Next action</span>
            <strong>{step.next_action}</strong>
          </div>
          <div>
            <span>Clear condition</span>
            <strong>{step.clear_condition}</strong>
          </div>
          {step.organization_display_name ? (
            <div>
              <span>Organization</span>
              <strong>{step.organization_display_name}</strong>
            </div>
          ) : null}
          {step.due_at ? (
            <div>
              <span>Due</span>
              <strong>{formatDateTime(step.due_at)}</strong>
            </div>
          ) : null}
          {step.waiting_detail ? (
            <div>
              <span>Waiting</span>
              <strong>{step.waiting_detail}</strong>
            </div>
          ) : null}
        </div>
        <div className="employee-shift-card__flags">
          <span className="meta-pill">From workflow</span>
          {step.assigned_queue ? <span className="meta-pill">{formatDepartmentLabel(step.assigned_queue)}</span> : null}
          <span className="meta-pill">{humanizeLabel(step.operational_status)}</span>
        </div>
      </details>
      {editing ? (
        <QuickWorkflowStepEditor
          token={token}
          workflowRunId={step.workflow_run_id}
          step={{
            id: step.id,
            name: step.step_name,
            status: step.status,
            assigned_user_id: step.assigned_user_id ?? null,
            assigned_queue: step.assigned_queue ?? null,
            notes: step.notes ?? null,
            updated_at: step.updated_at ?? null
          }}
          onSaved={onSaved}
        />
      ) : null}
    </article>
  );
}

function TaskCard({ task }: { task: EmployeeMyWorkTaskRecord }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(toneForTask(task))}`}>
      <strong>{task.task_number} · {task.title}</strong>
      <div className="muted">{formatDepartmentLabel(task.department)} · {task.status_label}</div>
      {task.linked_job_number || task.linked_job_title ? (
        <div className="muted">
          {task.linked_job_number ? `${task.linked_job_number} · ` : ""}
          {task.linked_job_title ?? "Linked job"}
        </div>
      ) : null}
      {task.due_at ? <div className="muted">Due {formatDateTime(task.due_at)}</div> : null}
      {task.blocked_reason ? <div className="muted">{task.blocked_reason}</div> : null}
      <div className="employee-shift-card__flags">
        <span className="meta-pill">{humanizeLabel(task.priority)} priority</span>
        {task.proof_required ? <span className="meta-pill">Proof Required</span> : null}
      </div>
    </article>
  );
}

function AcknowledgementCard({ item }: { item: EmployeeMyWorkAcknowledgementRecord }) {
  return (
    <article className="notification-card notification-card--high">
      <strong>{item.title}</strong>
      <div className="muted">{formatDepartmentLabel(item.department)} · {item.action_label}</div>
      <div className="muted">{item.summary}</div>
      {item.linked_job_number || item.linked_job_title ? (
        <div className="muted">
          {item.linked_job_number ? `${item.linked_job_number} · ` : ""}
          {item.linked_job_title ?? "Linked job"}
        </div>
      ) : null}
      {item.due_at ? <div className="muted">Before {formatDateTime(item.due_at)}</div> : null}
    </article>
  );
}

function ExceptionCard({ item }: { item: EmployeeMyWorkExceptionRecord }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(item.tone)}`}>
      <strong>{item.scope_label}</strong>
      <div className="muted">{item.exception_type_label} · {humanizeLabel(item.status)}</div>
      <div className="muted">{formatDepartmentLabel(item.department)} · {humanizeLabel(item.severity)}</div>
      {item.notes ? <div className="muted">{item.notes}</div> : null}
      {item.linked_job_number || item.linked_job_title ? (
        <div className="muted">
          {item.linked_job_number ? `${item.linked_job_number} · ` : ""}
          {item.linked_job_title ?? "Linked job"}
        </div>
      ) : null}
    </article>
  );
}

function ApprovalCard({ item }: { item: EmployeeMyWorkApprovalRecord }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(toneForApproval(item))}`}>
      <strong>{item.request_title}</strong>
      <div className="muted">{item.request_type_label}</div>
      <div className="muted">{item.request_summary ?? item.source_entity_label ?? "Approval is waiting on your decision."}</div>
      <div className="employee-shift-card__flags">
        {item.blocking ? <span className="meta-pill">Blocking</span> : null}
        {item.overdue ? <span className="meta-pill">Overdue</span> : null}
        {item.escalated ? <span className="meta-pill">Escalated</span> : null}
      </div>
      {item.due_at ? <div className="muted">Due {formatDateTime(item.due_at)}</div> : null}
    </article>
  );
}

function RecentChangeCard({ item }: { item: EmployeeMyWorkRecentChangeRecord }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(item.tone)}`}>
      <strong>{item.title}</strong>
      <div className="muted">{item.summary}</div>
      <div className="muted">{item.department ? `${formatDepartmentLabel(item.department)} · ` : ""}{formatDateTime(item.created_at)}</div>
    </article>
  );
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} | ${start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })} - ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDepartmentLabel(value: string | null | undefined) {
  if (!value) {
    return "Operations";
  }
  return humanizeLabel(value);
}

function toneForTask(task: EmployeeMyWorkTaskRecord) {
  if (task.status === "blocked") {
    return "action_needed";
  }
  if (task.status === "review" || task.status === "waiting") {
    return "heads_up";
  }
  if (task.due_at && new Date(task.due_at).getTime() <= Date.now()) {
    return "action_needed";
  }
  return "info";
}

function toneForApproval(item: EmployeeMyWorkApprovalRecord) {
  if (item.overdue || item.blocking) {
    return "action_needed";
  }
  if (item.escalated) {
    return "heads_up";
  }
  return "info";
}

function toneForWorkflowStep(step: EmployeeMyWorkWorkflowStepRecord) {
  if (step.status === "BLOCKED" || step.operational_status === "blocked" || step.operational_status === "overdue") {
    return "action_needed";
  }
  if (step.operational_status === "waiting" || step.operational_status === "at_risk" || step.waiting_detail) {
    return "heads_up";
  }
  return "info";
}

function toneForEvent(event: EmployeeMyWorkEventRecord) {
  if (event.open_exception_count > 0 || (event.note_summary && !event.notes_acknowledged)) {
    return "heads_up";
  }
  if (event.action_label === "On now") {
    return "good";
  }
  return "info";
}

function toneToNotificationClass(tone: "good" | "info" | "heads_up" | "action_needed") {
  switch (tone) {
    case "good":
      return "normal";
    case "heads_up":
      return "high";
    case "action_needed":
      return "urgent";
    case "info":
    default:
      return "normal";
  }
}
