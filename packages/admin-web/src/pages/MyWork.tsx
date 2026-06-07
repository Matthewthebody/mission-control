import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { EmployeeShiftDetailPanel } from "../components/EmployeeShiftDetailPanel";
import { QuickWorkflowNextStepMover } from "../components/projectTracking/QuickWorkflowNextStepMover";
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

type HeadsUpItem = {
  id: string;
  label: string;
  title: string;
  summary: string;
  detail?: string | null;
  tone: "good" | "info" | "heads_up" | "action_needed";
};

type ActiveLaunchpadSection = "schedule" | "tasks" | "workflow" | "heads-up";

export function MyWork({ token, currentUser, socket }: Props) {
  const [anchorDate, setAnchorDate] = useState(getLocalDateString());
  const [payload, setPayload] = useState<EmployeeMyWorkResponse | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEventDetail, setSelectedEventDetail] = useState<EmployeeEventDetailResponse | null>(null);
  const [activeLaunchpadSection, setActiveLaunchpadSection] = useState<ActiveLaunchpadSection>("schedule");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scheduleStats = useMemo(() => buildScheduleWeekStats(payload), [payload]);
  const scheduleWeekDays = useMemo(() => buildScheduleWeekDays(payload), [payload]);
  const liveWorkflowSteps = payload?.live_workflow_steps ?? [];
  const headsUpItems = useMemo(() => buildHeadsUpItems(payload), [payload]);

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

    const onRefresh = () => {
      void load();
      if (selectedEventId) {
        void loadEventDetail(selectedEventId);
      }
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
          <div className="eyebrow">Employee Launchpad</div>
          <h2>My Work</h2>
          <p>Tasks assigned to you, workflows you're part of, and things your department may need help with.</p>
        </div>
        <div className="page-intro-actions">
          <a className="primary-button" href="#employees/attendance">Clocked Out</a>
          <details className="employee-date-disclosure">
            <summary>Change week</summary>
            <label className="filter-field">
              <span>Week starting</span>
              <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
            </label>
            <button className="secondary-button" onClick={() => void load()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </details>
        </div>
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel employee-day-command">
        <div>
          <div className="section-title">Launchpad</div>
          <p className="section-subtitle">A short scan of your schedule, assigned tasks, workflow steps, and heads-up items.</p>
        </div>
        <div className="employee-day-command__cards">
          <LaunchpadSummaryTile
            eyebrow="My Schedule This Week"
            value={`${payload?.events.length ?? 0}`}
            detail={buildScheduleSummary(scheduleStats)}
            helper={buildLookaheadSummary(payload)}
            active={activeLaunchpadSection === "schedule"}
            onSelect={() => setActiveLaunchpadSection("schedule")}
          />
          <LaunchpadSummaryTile
            eyebrow="Assigned Tasks"
            value={payload?.summary.assigned_task_count ?? 0}
            detail="Tasks directly assigned to you."
            helper={buildTaskSummary(payload)}
            active={activeLaunchpadSection === "tasks"}
            onSelect={() => setActiveLaunchpadSection("tasks")}
          />
          <LaunchpadSummaryTile
            eyebrow="Workflow Steps Waiting on Me"
            value={payload?.summary.live_workflow_step_count ?? 0}
            detail="Work steps that need your action."
            helper={liveWorkflowSteps[0]?.next_action ?? "No work step is waiting on you."}
            active={activeLaunchpadSection === "workflow"}
            onSelect={() => setActiveLaunchpadSection("workflow")}
          />
          <LaunchpadSummaryTile
            eyebrow="Heads Up"
            value={headsUpItems.length}
            detail={headsUpItems.length ? "Important items to notice before work stalls." : "No important acknowledgements are waiting."}
            helper={headsUpItems[0]?.summary ?? "Your day looks clear from the current demo data."}
            tone={headsUpItems.length ? "heads_up" : "good"}
            active={activeLaunchpadSection === "heads-up"}
            onSelect={() => setActiveLaunchpadSection("heads-up")}
          />
        </div>
      </section>

      <section className="employee-work-layout employee-work-layout--launchpad">
        <div className="panel employee-shift-rail" id="my-work-schedule">
          <div className="employee-section-heading">
            <div>
              <div className="section-title">My Schedule This Week</div>
              <p className="section-subtitle">Short preview of published work. Choose an event only when you need field actions or details.</p>
            </div>
            <a className="secondary-button" href="#my-schedule">View schedule</a>
          </div>

          <div className="employee-schedule-stats" aria-label="Schedule week summary">
            <span>{scheduleStats.scheduledHoursLabel}</span>
            <span>{scheduleStats.workedHoursLabel}</span>
            <span>{scheduleStats.remainingHoursLabel}</span>
          </div>

          {loading ? <div className="empty-state empty-state--panel">Loading your events...</div> : null}
          {!loading && !payload?.events.length ? <div className="empty-state empty-state--panel">No events are assigned right now.</div> : null}

          <div className="employee-week-strip" aria-label="Compact weekly schedule">
            {scheduleWeekDays.map((day) => (
              <div key={day.key} className="employee-week-day">
                <span>{day.label}</span>
                <strong>{day.shortDate}</strong>
                {day.events.length ? (
                  <div className="employee-week-day__events">
                    {day.events.slice(0, 2).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={`employee-week-event${selectedEvent?.id === event.id ? " employee-week-event--selected" : ""}`}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <span className="employee-week-event__kind">{formatEventKind(event)}</span>
                        <span>{formatShortWindow(event.starts_at, event.ends_at)}</span>
                        <strong>{event.title}</strong>
                        <small>{event.location_name || event.location_address || "Location pending"}</small>
                      </button>
                    ))}
                    {day.events.length > 2 ? <small>{day.events.length - 2} more on schedule</small> : null}
                  </div>
                ) : (
                  <small>Available</small>
                )}
              </div>
            ))}
          </div>

          <details className="employee-collapsible-list">
            <summary>Related jobs ({payload?.jobs.length ?? 0})</summary>
            <PanelList
              title="Related Job Context"
              subtitle="Jobs tied to your tasks or scheduled events."
              items={payload?.jobs ?? []}
              getKey={(job) => job.id}
              empty="No linked jobs are visible for your current work."
              renderItem={(job) => <JobCard job={job} />}
              limit={2}
            />
          </details>
        </div>
      </section>

      {activeLaunchpadSection !== "schedule" ? (
        <section className="panel employee-detail-panel employee-detail-panel--compact" aria-live="polite">
          {activeLaunchpadSection === "tasks" ? (
            <PanelList
              title="Assigned Tasks"
              subtitle="Open work assigned to you. Blocked or overdue items should show the reason and the next useful place to act."
              items={payload?.tasks ?? []}
              getKey={(task) => task.id}
              empty="No open assigned tasks are in your queue."
              renderItem={(task) => <TaskCard task={task} />}
              limit={4}
            />
          ) : null}

          {activeLaunchpadSection === "workflow" ? (
            <PanelList
              title="Workflow Steps Waiting on Me"
              subtitle="Work steps that need your action."
              items={liveWorkflowSteps}
              getKey={(step) => step.id}
              empty="No work steps are waiting on you."
              renderItem={(step) => (
                <WorkflowStepCard
                  step={step}
                  token={token}
                  onSaved={async () => {
                    await load();
                  }}
                />
              )}
              limit={4}
            />
          ) : null}

          {activeLaunchpadSection === "heads-up" ? (
            <PanelList
              title="Heads Up"
              subtitle="Acknowledgements, schedule notes, and important changes folded into one short queue."
              items={headsUpItems}
              getKey={(item) => item.id}
              empty="No important acknowledgements are waiting here."
              renderItem={(item) => <HeadsUpCard item={item} />}
              limit={4}
            />
          ) : null}
        </section>
      ) : null}

      {selectedEventId || detailLoading || selectedEventDetail ? (
      <section className="panel employee-detail-panel">
        <div className="section-title">Selected Event Detail</div>
        <p className="section-subtitle">Detailed field actions stay here after you pick a schedule item, so the launchpad stays calm until you need the full workflow.</p>
        {detailLoading && !selectedEventDetail ? <div className="empty-state empty-state--panel">Loading event detail...</div> : null}
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
      ) : null}
    </>
  );
}

function LaunchpadSummaryTile({
  eyebrow,
  value,
  detail,
  helper,
  tone = "info",
  active = false,
  onSelect
}: {
  eyebrow: string;
  value: number | string;
  detail: string;
  helper: string;
  tone?: "good" | "info" | "heads_up" | "action_needed";
  active?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <span className="eyebrow">{eyebrow}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
      <small>{helper}</small>
    </>
  );
  return (
    <button
      type="button"
      className={`employee-summary-tile employee-summary-tile--${tone}${active ? " employee-summary-tile--active" : ""}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

function buildScheduleWeekStats(payload: EmployeeMyWorkResponse | null) {
  if (!payload) {
    return {
      scheduledHours: 0,
      remainingHours: 0,
      scheduledHoursLabel: "Scheduled hours loading",
      workedHoursLabel: "Worked hours load from punches",
      remainingHoursLabel: "Remaining hours loading"
    };
  }
  const scheduledHours = payload.events.reduce((total, event) => total + calculateHoursBetween(event.starts_at, event.ends_at), 0);
  const remainingEvents = payload.events.filter((event) => new Date(event.ends_at).getTime() >= Date.now());
  const remainingHours = remainingEvents.reduce((total, event) => total + calculateHoursBetween(event.starts_at, event.ends_at), 0);
  const workedHours = Math.max(0, scheduledHours - remainingHours);
  return {
    scheduledHours,
    remainingHours,
    workedHours,
    scheduledHoursLabel: `Scheduled Hours: ${formatHours(scheduledHours)}`,
    workedHoursLabel: `Worked Hours: ${formatHours(workedHours)}`,
    remainingHoursLabel: `Remaining Hours: ${formatHours(remainingHours)}`
  };
}

function buildScheduleWeekDays(payload: EmployeeMyWorkResponse | null) {
  const events = payload?.events ?? [];
  const firstEventDate = events[0]?.starts_at.slice(0, 10);
  const baseDateString = payload?.anchor_date || firstEventDate || getLocalDateString();
  const baseDate = new Date(`${baseDateString}T12:00:00`);
  if (Number.isNaN(baseDate.getTime())) {
    return [];
  }
  const start = getMondayForDate(baseDate);
  const hasWeekendWork = events.some((event) => {
    const day = new Date(event.starts_at).getDay();
    return day === 0 || day === 6;
  });
  const dayCount = hasWeekendWork ? 7 : 5;
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      shortDate: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      events: events.filter((event) => event.starts_at.slice(0, 10) === key)
    };
  });
}

function getMondayForDate(date: Date) {
  const monday = new Date(date);
  const day = monday.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + offset);
  return monday;
}

function buildScheduleSummary(stats: ReturnType<typeof buildScheduleWeekStats>) {
  if (stats.scheduledHours <= 0) {
    return "No published schedule hours are visible for this week.";
  }
  return stats.scheduledHoursLabel;
}

function buildTaskSummary(payload: EmployeeMyWorkResponse | null) {
  if (!payload) {
    return "Loading assigned tasks.";
  }
  const blocked = payload.tasks.filter((task) => task.status === "blocked").length;
  if (blocked) {
    return `${blocked} blocked task${blocked === 1 ? "" : "s"} ${blocked === 1 ? "needs" : "need"} context before ${blocked === 1 ? "it" : "they"} can move.`;
  }
  return payload.tasks[0]?.title ?? "No assigned task needs action right now.";
}

function buildLookaheadSummary(payload: EmployeeMyWorkResponse | null) {
  if (!payload) {
    return "Checking the next few days of published work.";
  }
  const end = new Date(`${payload.window_end_date}T12:00:00`);
  const endLabel = Number.isNaN(end.getTime())
    ? payload.window_end_date
    : end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (payload.summary.upcoming_events > 0) {
    return `${payload.summary.upcoming_events} upcoming event${payload.summary.upcoming_events === 1 ? " is" : "s are"} visible through ${endLabel}.`;
  }
  return `No additional published events are visible through ${endLabel}.`;
}

function buildHeadsUpItems(payload: EmployeeMyWorkResponse | null): HeadsUpItem[] {
  if (!payload) {
    return [];
  }
  const acknowledgements: HeadsUpItem[] = payload.acknowledgements.map((item) => ({
    id: `ack-${item.id}`,
    label: "Heads Up",
    title: item.title,
    summary: item.summary,
    detail: `${formatDepartmentLabel(item.department)} - ${item.action_label}`,
    tone: "heads_up" as const
  }));
  const exceptions: HeadsUpItem[] = payload.exceptions.map((item) => ({
    id: `exception-${item.id}`,
    label: "Heads Up",
    title: item.scope_label,
    summary: item.notes ?? item.exception_type_label,
    detail: `${item.exception_type_label} - ${formatDepartmentLabel(item.department)} - ${humanizeLabel(item.severity)}`,
    tone: item.tone
  }));
  const approvals: HeadsUpItem[] = payload.approvals.map((item) => ({
    id: `approval-${item.id}`,
    label: item.blocking || item.overdue ? "Decision Needed" : "Review",
    title: item.request_title,
    summary: item.request_summary ?? item.source_entity_label ?? "Approval is waiting on your decision.",
    detail: item.blocking ? "Blocking downstream work until reviewed." : "Keeps the shared work record moving.",
    tone: toneForApproval(item)
  }));
  const recentChanges: HeadsUpItem[] = payload.recent_changes
    .filter((item) => item.tone === "action_needed" || item.tone === "heads_up")
    .map((item) => ({
      id: `change-${item.id}`,
      label: "Changed",
      title: item.title,
      summary: item.summary,
      detail: item.department ? formatDepartmentLabel(item.department) : null,
      tone: item.tone
    }));
  return [...acknowledgements, ...exceptions, ...approvals, ...recentChanges];
}

function calculateHoursBetween(startsAt: string, endsAt: string) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }
  return (end - start) / 3_600_000;
}

function formatHours(value: number) {
  if (value <= 0) {
    return "0h";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

function PanelList<T>({
  title,
  subtitle,
  items,
  getKey,
  empty,
  renderItem,
  limit
}: {
  title: string;
  subtitle: string;
  items: T[];
  getKey: (item: T) => string;
  empty: string;
  renderItem: (item: T) => ReactNode;
  limit?: number;
}) {
  const visibleItems = typeof limit === "number" ? items.slice(0, limit) : items;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <div className="employee-notifications">
      <div className="section-title">{title}</div>
      <p className="section-subtitle">{subtitle}</p>
      <div className="ops-preview-list">
        {visibleItems.length ? visibleItems.map((item) => <div key={getKey(item)}>{renderItem(item)}</div>) : <div className="empty-state">{empty}</div>}
      </div>
      {hiddenCount ? <div className="empty-state empty-state--compact">{hiddenCount} more item{hiddenCount === 1 ? "" : "s"} available in the detailed workspace.</div> : null}
    </div>
  );
}

function JobCard({ job }: { job: EmployeeMyWorkJobRecord }) {
  return (
    <article className="notification-card notification-card--normal">
      <strong>{job.job_number ? `${job.job_number}  -  ${job.title}` : job.title}</strong>
      <div className="muted">{formatDepartmentLabel(job.department)}  -  {job.status_label}</div>
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
  onSaved
}: {
  step: EmployeeMyWorkWorkflowStepRecord;
  token: string;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(toneForWorkflowStep(step))}`}>
      <strong>{step.job_number ? `${step.job_number} - ${step.job_title}` : step.job_title}</strong>
      <div className="muted">Department: {formatDepartmentLabel(step.assigned_queue ?? step.department)}</div>
      <div className="muted">Assigned to you</div>
      <div className="muted">
        What to do now:{" "}
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
        <a className="secondary-button" href={step.deep_link}>Open work detail</a>
      </div>
      <details className="employee-workflow-step-card__details">
        <summary>More context</summary>
        <div className="employee-workflow-step-card__details-grid">
          <div>
            <span>Next action</span>
            <strong>{step.next_action}</strong>
          </div>
          <div>
            <span>Done when</span>
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
          <span className="meta-pill">Workflow</span>
          {step.assigned_queue ? <span className="meta-pill">{formatDepartmentLabel(step.assigned_queue)}</span> : null}
          <span className="meta-pill">{humanizeLabel(step.operational_status)}</span>
        </div>
      </details>
    </article>
  );
}

function TaskCard({ task }: { task: EmployeeMyWorkTaskRecord }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(toneForTask(task))}`}>
      <strong>{task.task_number}  -  {task.title}</strong>
      <div className="muted">{formatDepartmentLabel(task.department)}  -  {task.status_label}</div>
      {task.linked_job_number || task.linked_job_title ? (
        <div className="muted">
          {task.linked_job_number ? `${task.linked_job_number}  -  ` : ""}
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

function HeadsUpCard({ item }: { item: HeadsUpItem }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(item.tone)}`}>
      <div className="employee-shift-card__top">
        <strong>{item.title}</strong>
        <span className="meta-pill">{item.label}</span>
      </div>
      <div className="muted">{item.summary}</div>
      {item.detail ? <div className="muted">{item.detail}</div> : null}
    </article>
  );
}

function AcknowledgementCard({ item }: { item: EmployeeMyWorkAcknowledgementRecord }) {
  return (
    <article className="notification-card notification-card--high">
      <strong>{item.title}</strong>
      <div className="muted">{formatDepartmentLabel(item.department)}  -  {item.action_label}</div>
      <div className="muted">{item.summary}</div>
      <div className="muted">Why it matters: this change may affect how you arrive, set up, communicate, or close out the linked work.</div>
      {item.linked_job_number || item.linked_job_title ? (
        <div className="muted">
          {item.linked_job_number ? `${item.linked_job_number}  -  ` : ""}
          {item.linked_job_title ?? "Linked job"}
        </div>
      ) : null}
      {item.due_at ? <div className="muted">Before {formatDateTime(item.due_at)}</div> : null}
      <div className="employee-shift-card__flags">
        <span className="meta-pill">Next: {item.action_label}</span>
      </div>
    </article>
  );
}

function ExceptionCard({ item }: { item: EmployeeMyWorkExceptionRecord }) {
  return (
    <article className={`notification-card notification-card--${toneToNotificationClass(item.tone)}`}>
      <strong>{item.scope_label}</strong>
      <div className="muted">{item.exception_type_label}  -  {humanizeLabel(item.status)}</div>
      <div className="muted">{formatDepartmentLabel(item.department)}  -  {humanizeLabel(item.severity)}</div>
      {item.notes ? <div className="muted">{item.notes}</div> : null}
      {item.linked_job_number || item.linked_job_title ? (
        <div className="muted">
          {item.linked_job_number ? `${item.linked_job_number}  -  ` : ""}
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
      <div className="muted">
        Why it matters: {item.blocking ? "this is blocking downstream work until someone reviews it." : "this decision keeps the shared work record moving cleanly."}
      </div>
      <div className="muted">Context: {item.source_entity_label ?? humanizeLabel(item.source_entity_type)}</div>
      <div className="muted">Owner/requester: {item.current_approver_role_group_label ?? "Approver group pending"}</div>
      <div className="employee-shift-card__flags">
        {item.blocking ? <span className="meta-pill">Blocking</span> : null}
        {item.overdue ? <span className="meta-pill">Overdue</span> : null}
        {item.escalated ? <span className="meta-pill">Escalated</span> : null}
        <span className="meta-pill">Next: Review approval</span>
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
      <div className="muted">{item.department ? `${formatDepartmentLabel(item.department)}  -  ` : ""}{formatDateTime(item.created_at)}</div>
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

function formatEventKind(event: EmployeeMyWorkEventRecord) {
  const source = `${event.source} ${event.source_record_type} ${event.status} ${event.action_label}`.toLowerCase();
  if (source.includes("pto") || source.includes("time off")) {
    return "PTO";
  }
  if (source.includes("office")) {
    return "Office work";
  }
  if (event.linked_job_id || event.linked_job_title) {
    return "Assigned shoot";
  }
  if (source.includes("shift")) {
    return "Shift";
  }
  return "Event";
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
