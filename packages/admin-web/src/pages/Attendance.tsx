import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../api";
import { AttendanceOperationsPanel } from "../components/attendance/AttendanceOperationsPanel";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { canManageAttendanceWorkspace } from "../permissions";
import type { AttendanceExceptionRecord, OperationsDashboard, OpsNotificationRecord, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

export function Attendance({ token, currentUser, socket }: Props) {
  const [exceptions, setExceptions] = useState<AttendanceExceptionRecord[]>([]);
  const [notifications, setNotifications] = useState<OpsNotificationRecord[]>([]);
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [date, setDate] = useState(getLocalDateString());
  const [statusFilter, setStatusFilter] = useState<"open" | "approved" | "rejected" | "resolved" | "all">("open");
  const [selectedExceptionId, setSelectedExceptionId] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const [leadershipWorkState, setLeadershipWorkState] = useState<"office_drive" | "photography">("photography");
  const [leadershipStartTime, setLeadershipStartTime] = useState("");
  const [leadershipEndTime, setLeadershipEndTime] = useState("");
  const [leadershipNote, setLeadershipNote] = useState("");
  const [submittingLeadershipEdit, setSubmittingLeadershipEdit] = useState(false);
  const [classificationByException, setClassificationByException] = useState<Record<string, string>>({});
  const [reviewNotesByException, setReviewNotesByException] = useState<Record<string, string>>({});
  const [correctedTimeByException, setCorrectedTimeByException] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveMessage, setLiveMessage] = useState("");

  const canManage = canManageAttendanceWorkspace(currentUser);

  async function load() {
    setLoading(true);
    try {
      const statusParam = statusFilter === "all" ? "" : `&status=${statusFilter}`;
      const [exceptionRows, notificationRows, dashboardResponse] = await Promise.all([
        apiFetch<AttendanceExceptionRecord[]>(`/api/attendance/exceptions?date=${date}${statusParam}`, token),
        apiFetch<OpsNotificationRecord[]>("/api/notifications", token),
        apiFetch<OperationsDashboard>(`/api/dashboard/operations?date=${date}`, token).catch(() => null)
      ]);
      setExceptions(exceptionRows);
      setNotifications(notificationRows);
      setDashboard(dashboardResponse);
      setSelectedExceptionId((current) => {
        if (exceptionRows.some((row) => row.id === current)) {
          return current;
        }
        return exceptionRows[0]?.id ?? "";
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load attendance updates for this date.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [date, statusFilter, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onAttendanceChanged = (payload: { change_type?: string }) => {
      const action = payload.change_type ? payload.change_type.replace(/_/g, " ") : "updated";
      setLiveMessage(`Live update: attendance ${action}.`);
      void load();
      clearLiveMessage();
    };
    const onNotificationCreated = () => {
      setLiveMessage("Live update: notification queue refreshed.");
      void load();
      clearLiveMessage();
    };
    const onScheduleChanged = () => {
      setLiveMessage("Live update: shift details refreshed.");
      void load();
      clearLiveMessage();
    };

    socket.on("attendance_changed", onAttendanceChanged);
    socket.on("notification_created", onNotificationCreated);
    socket.on("schedule_changed", onScheduleChanged);
    return () => {
      socket.off("attendance_changed", onAttendanceChanged);
      socket.off("notification_created", onNotificationCreated);
      socket.off("schedule_changed", onScheduleChanged);
    };
  }, [date, socket, token]);

  useEffect(() => {
    const selected = exceptions.find((exception) => exception.id === selectedExceptionId) ?? exceptions[0] ?? null;
    if (!selected) {
      return;
    }
    setLeadershipWorkState(
      selected.time_clock_requested_state === "office_drive" ? "office_drive" : "photography"
    );
    setLeadershipStartTime(
      selected.time_clock_requested_start_time ??
        (typeof selected.requested_value?.requested_start_time === "string"
          ? selected.requested_value.requested_start_time
          : typeof selected.requested_value?.start_time === "string"
            ? selected.requested_value.start_time
            : "")
    );
    setLeadershipEndTime(
      selected.time_clock_requested_end_time ??
        (typeof selected.requested_value?.requested_end_time === "string"
          ? selected.requested_value.requested_end_time
          : typeof selected.requested_value?.end_time === "string"
            ? selected.requested_value.end_time
            : "")
    );
    setLeadershipNote(selected.notes ?? "");
    setCorrectedTimeByException((current) =>
      current[selected.id] !== undefined
        ? current
        : {
            ...current,
            [selected.id]:
              selected.time_clock_requested_start_time ??
              selected.time_clock_requested_end_time ??
              (typeof selected.requested_value?.corrected_time === "string" ? selected.requested_value.corrected_time : "")
          }
    );
  }, [exceptions, selectedExceptionId]);

  async function review(exception: AttendanceExceptionRecord, status: "approved" | "rejected" | "resolved", nextClassification?: string) {
    const reviewNote = getReviewNote(exception).trim();
    if (!reviewNote) {
      setError("Manager correction decisions need a review note.");
      return;
    }
    const correctedTime = getCorrectedTime(exception).trim();
    const needsCorrectedTime = shouldCollectCorrectedTime(exception);
    if (status === "approved" && needsCorrectedTime && !correctedTime) {
      setError("Approving a missing punch needs a corrected clock time.");
      return;
    }

    setReviewingId(exception.id);
    setError("");
    setNotice("");
    try {
      const resolvedValue: Record<string, unknown> = {};
      if (needsCorrectedTime && correctedTime) {
        resolvedValue.corrected_time = correctedTime;
      }
      await apiFetch(`/api/attendance/exceptions/${exception.id}/review`, token, {
        method: "POST",
        body: JSON.stringify({
          status,
          notes: reviewNote,
          classification: nextClassification ?? null,
          resolved_value: Object.keys(resolvedValue).length ? resolvedValue : undefined
        })
      });
      setNotice(getReviewNotice(status));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update that attendance item.");
    } finally {
      setReviewingId("");
    }
  }

  async function submitLeadershipEdit() {
    if (!selectedException?.user_id) {
      setError("Leadership overrides need an employee context.");
      return;
    }
    if (!leadershipStartTime.trim() || !leadershipNote.trim()) {
      setError("Leadership overrides need a requested start time and a reason.");
      return;
    }

    setSubmittingLeadershipEdit(true);
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/attendance/time-clock/manual-adjustments", token, {
        method: "POST",
        body: JSON.stringify({
          employee_id: selectedException.user_id,
          shift_id: selectedException.shift_id ?? null,
          requested_work_state: leadershipWorkState,
          requested_start_time: leadershipStartTime,
          requested_end_time: leadershipEndTime || null,
          note: leadershipNote
        })
      });
      setNotice("Leadership override saved with a full Time Session audit trail.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that leadership override.");
    } finally {
      setSubmittingLeadershipEdit(false);
    }
  }

  function getClassification(exception: AttendanceExceptionRecord) {
    return classificationByException[exception.id] ?? exception.classification ?? "late";
  }

  function getReviewNote(exception: AttendanceExceptionRecord) {
    return reviewNotesByException[exception.id] ?? "";
  }

  function getCorrectedTime(exception: AttendanceExceptionRecord) {
    return correctedTimeByException[exception.id] ?? "";
  }

  const summary = dashboard?.summary;
  const watchList = [...(dashboard?.shifts ?? [])]
    .filter((shift) => Number(shift.open_exception_count ?? 0) > 0 || Number(shift.punch_in_count ?? 0) === 0)
    .slice(0, 6);
  const reviewQueue = [...exceptions].sort((left, right) => compareExceptionPriority(left, right));
  const selectedException = reviewQueue.find((exception) => exception.id === selectedExceptionId) ?? reviewQueue[0] ?? null;
  const selectedIsNoLunchChallenge = selectedException?.exception_type === "NO_LUNCH_CHALLENGE";

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Leadership Attendance Review</div>
          <h2>Attendance Operating System</h2>
          <p>Use this leadership desk for live coverage risk, unresolved punches, and payroll-safe attendance review. Employees should start from Home or My Work when they only need to clock in; cross-operational blockers should surface through Home, department hubs, and Project Tracking.</p>
        </div>
        <div className="page-intro-actions">
          <label className="filter-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="open">Open</option>
              <option value="approved">Approved</option>
              <option value="rejected">Sent Back</option>
              <option value="resolved">Resolved</option>
              <option value="all">All Statuses</option>
            </select>
          </label>
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <a className="secondary-button" href="#project-tracking" title="Open Project Tracking for blocked and at-risk work.">
            Open Project Tracking
          </a>
          <a className="secondary-button" href="#employees/payroll" title="Open the payroll review workspace.">
            Open Payroll Review
          </a>
        </div>
      </section>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? (
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <div className="error-banner">{error}</div>
          <button className="secondary-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}
      {liveMessage ? <div className="live-banner">{liveMessage}</div> : null}
      {loading && exceptions.length ? <div className="live-banner">Refreshing attendance items...</div> : null}
      {loading && !exceptions.length && !notifications.length ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading attendance</div>
          <p className="section-subtitle">Pulling open exceptions and recent notifications for the selected date.</p>
        </section>
      ) : null}

      <AttendanceOperationsPanel token={token} currentUser={currentUser} socket={socket} date={date} />

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Clocked In</div>
          <strong>
            {summary?.clocked_in_employees ?? 0}/{summary?.scheduled_employees ?? 0}
          </strong>
          <span className="muted">Team members with a recorded punch-in for the selected date.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Open Exceptions</div>
          <strong>{exceptions.length}</strong>
          <span className="muted">Items that still need classification, approval, or follow-up.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Late / No-Show</div>
          <strong>
            {summary?.late_employees ?? 0} / {summary?.no_shows ?? 0}
          </strong>
          <span className="muted">Current late attendance load and confirmed no-shows for this date.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Missed Punches</div>
          <strong>
            {summary?.missed_punch_count ?? 0} / {summary?.missed_clock_out_count ?? 0}
          </strong>
          <span className="muted">Clock-in and clock-out items that already crossed into correction workflow.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">No-Show Suspected</div>
          <strong>{summary?.no_show_suspected_count ?? 0}</strong>
          <span className="muted">Shifts now carrying a likely no-show risk state.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Flagged Punches</div>
          <strong>{(summary?.unscheduled_punches ?? 0) + (summary?.out_of_bounds_punches ?? 0)}</strong>
          <span className="muted">Unscheduled or out-of-bounds punches still needing an operator check.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Break Overrides</div>
          <strong>{summary?.break_override_count ?? 0}</strong>
          <span className="muted">Automatic break deductions manually overridden in this reporting window.</span>
        </article>
      </section>

      <section className="panel dashboard-panel">
        <div className="section-title">Clock-In Exceptions</div>
        <p className="section-subtitle">Use this quick read to spot shifts that are still missing activity or already carrying open attendance follow-up.</p>
        <div className="ops-preview-list">
          {watchList.map((shift) => (
            <OperationalPreviewCard
              key={shift.id}
              eyebrow={humanizeLabel(shift.shift_kind)}
              title={shift.title}
              summary={`${shift.assigned_user_name} | ${formatShiftWindow(shift.starts_at, shift.ends_at)}`}
              owner={shift.manager_name ?? "Auto route"}
              statusLabel={getClockWatchLabel(shift)}
              statusTone={Number(shift.open_exception_count ?? 0) > 0 ? "critical" : Number(shift.punch_in_count ?? 0) > 0 ? "success" : "warning"}
              meta={[
                { label: shift.location_name || shift.shoot_title || "Unassigned location" },
                { label: shift.attendance_state ? humanizeLabel(shift.attendance_state) : "Pending attendance" }
              ]}
              nextAction={Number(shift.open_exception_count ?? 0) > 0 ? "Review exception" : "Monitor shift"}
            />
          ))}
          {!loading && !watchList.length ? <div className="empty-state">No clock-in exceptions are standing out for this date.</div> : null}
        </div>
      </section>

      <section className="attendance-layout">
        <div className="panel notification-sidebar">
          <div className="section-title">Manager Time Review Queue</div>
          <p className="section-subtitle">Review missing punches, wrong-location punches, late records, and employee correction requests without losing the raw event history.</p>
          <div className="ops-preview-list">
            {reviewQueue.map((exception) => (
              <OperationalPreviewCard
                key={exception.id}
                eyebrow={humanizeExceptionType(exception.exception_type)}
                title={exception.user_name ?? "Team member"}
                summary={exception.shift_title ?? exception.shoot_code ?? "Attendance item"}
                owner={exception.manager_name ?? "Auto route"}
                statusLabel={exception.time_review_priority_label ?? humanizeLabel(exception.status)}
                statusTone={getReviewTone(exception)}
                meta={[
                  {
                    label:
                      exception.scheduled_start_at && exception.scheduled_end_at
                        ? formatShiftWindow(exception.scheduled_start_at, exception.scheduled_end_at)
                        : `Opened ${new Date(exception.created_at).toLocaleDateString()}`
                  },
                  { label: exception.time_record_state_label ?? "Pending Review", tone: getReviewTone(exception) }
                ]}
                flags={[
                  ...(exception.time_record_location_label ? [{ label: exception.time_record_location_label, tone: "warning" as const }] : []),
                  ...(exception.time_record_correction_label ? [{ label: exception.time_record_correction_label, tone: "success" as const }] : []),
                  ...(exception.time_record_nearing_finalization ? [{ label: "Nearing Finalization", tone: "critical" as const }] : []),
                  ...(exception.reason_code ? [{ label: humanizeLabel(exception.reason_code), tone: "warning" as const }] : [])
                ]}
                nextAction={canManage ? getReviewNextAction(exception) : "Await manager review"}
                selected={selectedException?.id === exception.id}
                onClick={() => setSelectedExceptionId(exception.id)}
              />
            ))}
            {!loading && !reviewQueue.length ? <div className="empty-state">No time records need manager review for this date.</div> : null}
          </div>
        </div>

        <aside className="panel notification-sidebar">
          <div className="section-title">Manager Correction Flow</div>
          <p className="section-subtitle">Review the raw punch context, interpreted time record, and saved correction trail before you approve, reject, excuse, or escalate a protected time edit.</p>
          {selectedException ? (
            <div className="request-card detail-card">
              <strong>{humanizeExceptionType(selectedException.exception_type)}</strong>
              <div className="detail-chip-row">
                <span className={`detail-chip detail-chip--${getReviewTone(selectedException)}`}>
                  {selectedException.time_review_priority_label ?? "Manager Review"}
                </span>
                {selectedException.time_record_state_label ? <span className="detail-chip">{selectedException.time_record_state_label}</span> : null}
                {selectedException.time_record_location_label ? <span className="detail-chip">{selectedException.time_record_location_label}</span> : null}
                {selectedException.time_record_finalization_label ? <span className="detail-chip">{selectedException.time_record_finalization_label}</span> : null}
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Employee</span>
                  <strong>{selectedException.user_name ?? "Team member"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Shift</span>
                  <strong>{selectedException.shift_title ?? selectedException.shoot_code ?? "Attendance item"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Scheduled window</span>
                  <strong>
                    {selectedException.scheduled_start_at && selectedException.scheduled_end_at
                      ? formatShiftWindow(selectedException.scheduled_start_at, selectedException.scheduled_end_at)
                      : "No linked schedule"}
                  </strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Time record</span>
                  <strong>{selectedException.time_record_state_label ?? "Pending Review"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Correction state</span>
                  <strong>{selectedException.time_record_correction_label ?? "No Correction"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Finalization</span>
                  <strong>{selectedException.time_record_finalization_label ?? "Open For Review"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Location state</span>
                  <strong>{selectedException.time_record_location_label ?? "No location issue"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Manager</span>
                  <strong>{selectedException.manager_name ?? "Auto route"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Requested approver</span>
                  <strong>{selectedException.requested_approver_name ?? "Auto route"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Approved by</span>
                  <strong>{selectedException.approved_by_name ?? "Pending review"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Reason code</span>
                  <strong>{selectedException.reason_code ? humanizeLabel(selectedException.reason_code) : "No extra reason"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Opened</span>
                  <strong>{new Date(selectedException.created_at).toLocaleString()}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Updated</span>
                  <strong>{selectedException.updated_at ? new Date(selectedException.updated_at).toLocaleString() : "Not updated yet"}</strong>
                </div>
              </div>
              {selectedException.notes ? <div className="muted">Request note: {selectedException.notes}</div> : null}
              <OperationalDetailSection title="Raw Clock Event" summary="Keep the original punch visible even when you approve a correction. The raw event never disappears.">
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Last clock event</span>
                    <strong>
                      {selectedException.latest_punch_direction && selectedException.latest_punch_at
                        ? `${selectedException.latest_punch_direction === "in" ? "Clock In" : "Clock Out"} at ${new Date(selectedException.latest_punch_at).toLocaleString()}`
                        : "No raw clock event saved yet"}
                    </strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Punch source</span>
                    <strong>{selectedException.latest_punch_source ? humanizeLabel(selectedException.latest_punch_source) : "Not captured"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Punch approval</span>
                    <strong>{selectedException.latest_punch_approval_state ? humanizeLabel(selectedException.latest_punch_approval_state) : "No approval state"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Punch reason</span>
                    <strong>{selectedException.latest_punch_reason_code ? humanizeLabel(selectedException.latest_punch_reason_code) : "No punch reason saved"}</strong>
                  </div>
                </div>
                {selectedException.latest_punch_notes ? <div className="muted">Punch note: {selectedException.latest_punch_notes}</div> : null}
              </OperationalDetailSection>
              <OperationalDetailSection title="Interpreted Time Record" summary="This operator-friendly state is derived from schedule, raw punches, and saved correction history.">
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Clock-in</span>
                    <strong>{selectedException.time_record_clock_in_at ? new Date(selectedException.time_record_clock_in_at).toLocaleString() : "Missing clock-in"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Clock-out</span>
                    <strong>{selectedException.time_record_clock_out_at ? new Date(selectedException.time_record_clock_out_at).toLocaleString() : "Missing clock-out or still active"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Worked duration</span>
                    <strong>{formatWorkedDuration(selectedException.time_record_worked_minutes)}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Attendance classification</span>
                    <strong>{selectedException.time_entry_attendance_state ? humanizeLabel(selectedException.time_entry_attendance_state) : "Not classified yet"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Time session</span>
                    <strong>{selectedException.time_session_status ? humanizeLabel(selectedException.time_session_status) : "No session created yet"}</strong>
                  </div>
                </div>
              </OperationalDetailSection>
              {canManage ? (
                <OperationalDetailSection title="Manager Review Decision" summary="Choose the correction path, capture a structured reason, and save the resulting audit trail.">
                  {!selectedIsNoLunchChallenge ? (
                    <label className="filter-field">
                      <span>Outcome classification</span>
                      <select
                        value={getClassification(selectedException)}
                        onChange={(event) =>
                          setClassificationByException((current) => ({
                            ...current,
                            [selectedException.id]: event.target.value
                          }))
                        }
                      >
                        <option value="late">Late</option>
                        <option value="critically_late">Critically Late</option>
                        <option value="wrong_location">Wrong Location</option>
                        <option value="excused_exception">Excused Exception</option>
                        <option value="corrected_after_review">Corrected After Review</option>
                        <option value="manager_approved_exception">Manager Approved Exception</option>
                      </select>
                    </label>
                  ) : null}
                  {shouldCollectCorrectedTime(selectedException) ? (
                    <label className="filter-field">
                      <span>Corrected clock time</span>
                      <input
                        value={getCorrectedTime(selectedException)}
                        onChange={(event) =>
                          setCorrectedTimeByException((current) => ({
                            ...current,
                            [selectedException.id]: event.target.value
                          }))
                        }
                        placeholder="2026-03-30T08:00:00.000Z"
                      />
                    </label>
                  ) : null}
                  <label className="filter-field">
                    <span>Manager review note</span>
                    <textarea
                      value={getReviewNote(selectedException)}
                      onChange={(event) =>
                        setReviewNotesByException((current) => ({
                          ...current,
                          [selectedException.id]: event.target.value
                        }))
                      }
                      rows={4}
                      placeholder="Explain what you verified, what changed, and why this decision is safe."
                    />
                  </label>
                  <div className="preview-detail-panel__actions">
                    <button className="secondary-button" disabled={reviewingId === selectedException.id} onClick={() => void review(selectedException, "rejected")}>
                      {selectedIsNoLunchChallenge ? "Reject Challenge" : "Reject Request"}
                    </button>
                    {!selectedIsNoLunchChallenge ? (
                      <button
                        className="secondary-button"
                        disabled={reviewingId === selectedException.id}
                        onClick={() => void review(selectedException, "resolved", getClassification(selectedException))}
                      >
                        Save Review Outcome
                      </button>
                    ) : null}
                    <button
                      className="primary-button"
                      disabled={reviewingId === selectedException.id}
                      onClick={() =>
                        void review(
                          selectedException,
                          "approved",
                          selectedIsNoLunchChallenge ? undefined : getClassification(selectedException)
                        )
                      }
                    >
                      {selectedIsNoLunchChallenge ? "Approve Challenge" : getApproveButtonLabel(selectedException)}
                    </button>
                  </div>
                </OperationalDetailSection>
              ) : null}
              <OperationalDetailSection title="Correction Payloads" summary="Original, requested, and resolved values are stored here when you need the full audit context.">
                <div className="detail-grid">
                  <div>
                    <div className="eyebrow">Original Value</div>
                    <pre className="detail-json">{formatRecordPreview(selectedException.original_value)}</pre>
                  </div>
                  <div>
                    <div className="eyebrow">Requested Value</div>
                    <pre className="detail-json">{formatRecordPreview(selectedException.requested_value)}</pre>
                  </div>
                  <div>
                    <div className="eyebrow">Resolved Value</div>
                    <pre className="detail-json">{formatRecordPreview(selectedException.resolved_value)}</pre>
                  </div>
                </div>
              </OperationalDetailSection>
              {selectedException.time_clock_exception_request_id ? (
                <OperationalDetailSection title="Time Session Correction" summary="Canonical correction state, approval routing, and manual-change flags stay visible here so the original record never disappears.">
                  <div className="dashboard-summary-list">
                    <div className="dashboard-summary-row">
                      <span className="muted">Exception Request</span>
                      <strong>{selectedException.time_clock_request_type ? humanizeLabel(selectedException.time_clock_request_type) : "Linked"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Request status</span>
                      <strong>{selectedException.time_clock_request_status ? humanizeLabel(selectedException.time_clock_request_status) : "Submitted"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Requested state</span>
                      <strong>{selectedException.time_clock_requested_state ? humanizeLabel(selectedException.time_clock_requested_state) : "Not provided"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Requested start</span>
                      <strong>{selectedException.time_clock_requested_start_time ? new Date(selectedException.time_clock_requested_start_time).toLocaleString() : "Not provided"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Requested end</span>
                      <strong>{selectedException.time_clock_requested_end_time ? new Date(selectedException.time_clock_requested_end_time).toLocaleString() : "Open / not provided"}</strong>
                    </div>
                  </div>
                  {selectedException.time_clock_reporting_flags?.length ? (
                    <div className="detail-chip-row">
                      {selectedException.time_clock_reporting_flags.map((flag) => (
                        <span key={flag} className="detail-chip">
                          {humanizeLabel(flag)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="detail-grid">
                    <div>
                      <div className="eyebrow">Canonical Original</div>
                      <pre className="detail-json">{formatRecordPreview(selectedException.time_clock_original_values)}</pre>
                    </div>
                    <div>
                      <div className="eyebrow">Canonical Resolved</div>
                      <pre className="detail-json">{formatRecordPreview(selectedException.time_clock_resolved_values)}</pre>
                    </div>
                  </div>
                  <div className="ops-preview-list">
                    {(selectedException.time_clock_approval_records ?? []).map((record) => (
                      <OperationalPreviewCard
                        key={record.id}
                        eyebrow={humanizeLabel(record.approver_role)}
                        title={humanizeLabel(record.decision)}
                        summary={record.comment ?? "No extra review comment saved."}
                        statusLabel={new Date(record.decided_at).toLocaleString()}
                        statusTone={record.decision === "approved" ? "success" : record.decision === "rejected" ? "critical" : "warning"}
                      />
                    ))}
                    {!selectedException.time_clock_approval_records?.length ? <div className="empty-state">No Approval Record entries yet.</div> : null}
                  </div>
                </OperationalDetailSection>
              ) : null}
              {canManage && selectedException.user_id ? (
                <OperationalDetailSection title="Leadership Time Override" summary="Escalate into a protected manual Time Segment adjustment without hiding the original record. This writes a leadership override, Approval Record, and full audit trail.">
                  <div className="detail-grid">
                    <label className="filter-field">
                      <span>Work State</span>
                      <select value={leadershipWorkState} onChange={(event) => setLeadershipWorkState(event.target.value as "office_drive" | "photography")}>
                        <option value="office_drive">Office/Drive</option>
                        <option value="photography">Photography</option>
                      </select>
                    </label>
                    <label className="filter-field">
                      <span>Requested Start</span>
                      <input value={leadershipStartTime} onChange={(event) => setLeadershipStartTime(event.target.value)} />
                    </label>
                    <label className="filter-field">
                      <span>Requested End</span>
                      <input value={leadershipEndTime} onChange={(event) => setLeadershipEndTime(event.target.value)} />
                    </label>
                  </div>
                  <label className="filter-field">
                    <span>Reason</span>
                    <textarea value={leadershipNote} onChange={(event) => setLeadershipNote(event.target.value)} rows={4} />
                  </label>
                  <div className="preview-detail-panel__actions">
                    <button className="primary-button" disabled={submittingLeadershipEdit} onClick={() => void submitLeadershipEdit()}>
                      {submittingLeadershipEdit ? "Saving..." : "Save Leadership Override"}
                    </button>
                  </div>
                </OperationalDetailSection>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">Choose a time-review item to inspect its raw punch history, interpreted record state, and correction options.</div>
          )}

          <OperationalDetailSection title="Recent Notifications" summary="Critical reminders and follow-up messages stay available here without overwhelming the review panel.">
            <div className="ops-preview-list">
              {notifications.map((notification) => (
                <OperationalPreviewCard
                  key={notification.id}
                  eyebrow={humanizeLabel(notification.channel)}
                  title={notification.title}
                  summary={notification.body}
                  statusLabel={humanizeLabel(notification.status)}
                  statusTone={notification.priority === "critical" ? "critical" : notification.priority === "high" ? "warning" : "neutral"}
                  meta={[
                    { label: humanizeLabel(notification.priority), tone: notification.priority === "critical" ? "critical" : notification.priority === "high" ? "warning" : "neutral" },
                    { label: new Date(notification.created_at).toLocaleString() }
                  ]}
                />
              ))}
              {!loading && !notifications.length ? <div className="empty-state">No recent attendance notifications yet.</div> : null}
            </div>
          </OperationalDetailSection>
        </aside>
      </section>
    </>
  );
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeExceptionType(value: string) {
  return humanizeLabel(value).replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeClassification(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getReviewNotice(status: "approved" | "rejected" | "resolved") {
  if (status === "approved") {
    return "Time record review approved and audit logged.";
  }
  if (status === "resolved") {
    return "Time review outcome saved for follow-up.";
  }
  return "Time record request rejected and sent back for follow-up.";
}

function formatShiftWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`;
  }
  return `${start.toLocaleString()} - ${end.toLocaleString()}`;
}

function getClockWatchLabel(shift: OperationsDashboard["shifts"][number]) {
  if (shift.attendance_state === "no_show_suspected") {
    return "No-show suspected";
  }
  if (shift.attendance_state === "missed_clock_in") {
    return "Missed clock-in";
  }
  if (shift.attendance_state === "missed_clock_out") {
    return "Missed clock-out";
  }
  if (Number(shift.open_exception_count ?? 0) > 0) {
    if (shift.latest_punch_direction === "in") {
      return "Early / flagged";
    }
    return "Missed / flagged";
  }
  if (Number(shift.punch_in_count ?? 0) > 0) {
    return shift.latest_punch_direction === "out" ? "Wrapped" : "Active clock-in";
  }
  return "Missing punch";
}

function formatRecordPreview(value: Record<string, unknown> | null | undefined) {
  if (!value || !Object.keys(value).length) {
    return "No structured values saved.";
  }
  return JSON.stringify(value, null, 2);
}

function shouldCollectCorrectedTime(exception: AttendanceExceptionRecord) {
  return (
    exception.time_clock_request_type === "missing_clock_in" ||
    exception.time_clock_request_type === "missing_clock_out" ||
    exception.exception_type === "FORGOT_TO_CLOCK_IN" ||
    exception.exception_type === "FORGOT_TO_CLOCK_OUT"
  );
}

function getApproveButtonLabel(exception: AttendanceExceptionRecord) {
  if (shouldCollectCorrectedTime(exception)) {
    return "Approve Correction";
  }
  if (exception.time_record_location_state === "wrong_location" || exception.time_record_location_state === "outside_allowed_zone") {
    return "Accept Location Review";
  }
  if (exception.exception_type === "LATE_CLOCK_IN" || exception.exception_type === "LATE_CLOCK_IN_WARNING") {
    return "Approve Late Exception";
  }
  return "Approve Review";
}

function getReviewNextAction(exception: AttendanceExceptionRecord) {
  if (shouldCollectCorrectedTime(exception)) {
    return "Correct missing punch";
  }
  if (exception.time_record_location_state === "wrong_location" || exception.time_record_location_state === "outside_allowed_zone") {
    return "Review location";
  }
  if (exception.time_record_nearing_finalization) {
    return "Resolve before lock";
  }
  return "Review time record";
}

function getReviewTone(exception: AttendanceExceptionRecord): "neutral" | "warning" | "critical" | "success" {
  if (exception.time_review_priority === "critical") {
    return "critical";
  }
  if (exception.time_review_priority === "high" || exception.severity === "high") {
    return "warning";
  }
  if (exception.status === "approved" || exception.status === "resolved") {
    return "success";
  }
  return "neutral";
}

function compareExceptionPriority(left: AttendanceExceptionRecord, right: AttendanceExceptionRecord) {
  const rank = (value: string | null | undefined) => {
    if (value === "critical") {
      return 4;
    }
    if (value === "high") {
      return 3;
    }
    if (value === "medium") {
      return 2;
    }
    return 1;
  };

  const priorityDelta = rank(right.time_review_priority) - rank(left.time_review_priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

function formatWorkedDuration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) {
    return "Not calculated yet";
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!hours) {
    return `${remaining}m`;
  }
  return `${hours}h ${String(remaining).padStart(2, "0")}m`;
}
