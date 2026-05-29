import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../../api";
import { OperationalDetailSection } from "../OperationalDetailSection";
import { OperationalPreviewCard } from "../OperationalPreviewCard";
import { canManageAttendanceWorkspace } from "../../permissions";
import type {
  AttendanceLiveState,
  AttendanceOperationDetailRecord,
  AttendanceOperationsAction,
  AttendanceOperationsItemRecord,
  AttendanceOperationsWorkspaceRecord,
  SessionUser
} from "../../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  date: string;
};

export function AttendanceOperationsPanel({ token, currentUser, socket, date }: Props) {
  const [workspace, setWorkspace] = useState<AttendanceOperationsWorkspaceRecord | null>(null);
  const [detail, setDetail] = useState<AttendanceOperationDetailRecord | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actingAction, setActingAction] = useState<AttendanceOperationsAction | "">("");
  const [actionNote, setActionNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canManage = canManageAttendanceWorkspace(currentUser);
  const allItems = useMemo(() => workspace?.sections.flatMap((section) => section.items) ?? [], [workspace]);

  async function loadWorkspace() {
    setLoading(true);
    try {
      const payload = await apiFetch<AttendanceOperationsWorkspaceRecord>(`/api/attendance/operations?date=${date}`, token);
      setWorkspace(payload);
      setSelectedShiftId((current) => (payload.sections.some((section) => section.items.some((item) => item.shift_id === current)) ? current : payload.sections[0]?.items[0]?.shift_id ?? ""));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load live attendance right now.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(shiftId: string) {
    if (!shiftId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const payload = await apiFetch<AttendanceOperationDetailRecord>(`/api/attendance/operations/${shiftId}`, token);
      setDetail(payload);
      setActionNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load this attendance detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function runAction(action: AttendanceOperationsAction) {
    if (!detail || !canManage) {
      return;
    }
    setActingAction(action);
    try {
      const payload = await apiFetch<AttendanceOperationDetailRecord>(`/api/attendance/operations/${detail.item.shift_id}/actions`, token, {
        method: "POST",
        body: JSON.stringify({
          action,
          note: actionNote.trim() || null
        })
      });
      setDetail(payload);
      await loadWorkspace();
      setNotice(`${actionLabel(action)} saved.`);
      setActionNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that attendance action.");
    } finally {
      setActingAction("");
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [date, token]);

  useEffect(() => {
    if (!selectedShiftId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedShiftId);
  }, [selectedShiftId, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const refresh = () => {
      void loadWorkspace();
      if (selectedShiftId) {
        void loadDetail(selectedShiftId);
      }
    };
    socket.on("attendance_changed", refresh);
    socket.on("schedule_changed", refresh);
    socket.on("notification_created", refresh);
    return () => {
      socket.off("attendance_changed", refresh);
      socket.off("schedule_changed", refresh);
      socket.off("notification_created", refresh);
    };
  }, [selectedShiftId, socket, token, date]);

  return (
    <section className="attendance-ops-surface">
      <div className="page-header">
        <div>
          <div className="eyebrow">Live Attendance</div>
          <h2>Attendance Operating System</h2>
          <p className="muted">
            Evaluate arrival, callouts, coverage impact, and escalation off the scheduled assignment source of truth.
          </p>
        </div>
        <div className="detail-chip-row">
          <span className="detail-chip">Awareness {workspace?.timing_rules.awarenessWindowMinutes ?? 0}m</span>
          <span className="detail-chip">Grace {workspace?.timing_rules.graceWindowMinutes ?? 0}m</span>
          <span className="detail-chip">Unresolved {workspace?.timing_rules.unresolvedThresholdMinutes ?? 0}m</span>
          <span className="detail-chip">No-show {workspace?.timing_rules.noShowThresholdMinutes ?? 0}m</span>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <div className="attendance-ops-summary-grid">
        <OperationalPreviewCard
          eyebrow="Tracked"
          title={String(workspace?.summary.tracked_shift_count ?? 0)}
          summary="Shifts being actively evaluated for live attendance."
          statusLabel="Assignments"
        />
        <OperationalPreviewCard
          eyebrow="Coverage Risk"
          title={String(workspace?.summary.coverage_impact_count ?? 0)}
          summary="Attendance failures already impacting lead or minimum staffing."
          statusLabel="Critical"
          statusTone={workspace?.summary.coverage_impact_count ? "critical" : "success"}
        />
        <OperationalPreviewCard
          eyebrow="Late / Unresolved"
          title={String((workspace?.summary.late_count ?? 0) + (workspace?.summary.unresolved_count ?? 0))}
          summary="Arrivals and unresolved no-check-in issues needing follow-up."
          statusLabel="Attention"
          statusTone={workspace && (workspace.summary.late_count + workspace.summary.unresolved_count) > 0 ? "warning" : "success"}
        />
        <OperationalPreviewCard
          eyebrow="Callouts / No-shows"
          title={String((workspace?.summary.called_out_count ?? 0) + (workspace?.summary.no_show_count ?? 0) + (workspace?.summary.replacement_needed_count ?? 0))}
          summary="Callouts, replacement-needed shifts, and confirmed no-shows."
          statusLabel="Escalate"
          statusTone={workspace && (workspace.summary.called_out_count + workspace.summary.no_show_count + workspace.summary.replacement_needed_count) > 0 ? "critical" : "neutral"}
        />
      </div>

      {loading ? <div className="empty-state">Loading live attendance...</div> : null}

      {!loading && workspace ? (
        <div className="attendance-ops-layout">
          <div className="attendance-ops-list">
            <OperationalDetailSection
              title="Home-Ready Summary"
              summary={workspace.home_ready_summary.summary_line}
            >
              <div className="ops-preview-list">
                {workspace.home_ready_summary.items.map((item) => (
                  <OperationalPreviewCard
                    key={item.shift_id}
                    eyebrow={humanizeState(item.state)}
                    title={item.title}
                    summary={item.summary}
                    statusLabel={item.urgency_label}
                    statusTone={item.state === "no_show" || item.state === "replacement_needed" ? "critical" : "warning"}
                  />
                ))}
                {!workspace.home_ready_summary.items.length ? (
                  <div className="empty-state">Nothing urgent is ready for Home right now.</div>
                ) : null}
              </div>
            </OperationalDetailSection>

            {workspace.sections.map((section) => (
              <OperationalDetailSection key={section.key} title={section.label} summary={section.description}>
                <div className="ops-preview-list">
                  {section.items.map((item) => (
                    <button
                      key={item.shift_id}
                      type="button"
                      className={`attendance-ops-row ${selectedShiftId === item.shift_id ? "is-selected" : ""}`}
                      onClick={() => setSelectedShiftId(item.shift_id)}
                    >
                      <OperationalPreviewCard
                        eyebrow={item.school_name ?? item.department}
                        title={`${item.employee_name} - ${item.shift_title}`}
                        summary={buildSummary(item)}
                        statusLabel={item.state_label}
                        statusTone={item.health_tone}
                        meta={[
                          { label: buildShiftWindow(item.starts_at, item.ends_at) },
                          { label: item.location_name ?? "Location TBD" },
                          ...(item.coverage_impact ? [{ label: "Coverage risk", tone: "critical" as const }] : []),
                          ...(item.alert_labels.slice(0, 2).map((label) => ({ label })))
                        ]}
                      />
                    </button>
                  ))}
                  {!section.items.length ? <div className="empty-state">No items in this section for {date}.</div> : null}
                </div>
              </OperationalDetailSection>
            ))}
          </div>

          <aside className="attendance-ops-detail">
            <OperationalDetailSection
              title="Attendance Detail"
              summary="Inspect attendance signals, staffing impact, and manager actions for the selected assignment."
            >
              {detailLoading ? <div className="empty-state">Loading attendance detail...</div> : null}
              {!detailLoading && detail ? (
                <>
                  <div className="dashboard-summary-list">
                    <div className="dashboard-summary-row">
                      <span className="muted">Employee</span>
                      <strong>{detail.item.employee_name}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Shift</span>
                      <strong>{detail.item.shift_title}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">School / Shoot</span>
                      <strong>{detail.item.school_name ?? detail.item.shoot_title ?? "Standalone assignment"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">State</span>
                      <strong>{detail.item.state_label}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Signal Source</span>
                      <strong>{detail.item.signal_source.replace(/_/g, " ")}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Time Window</span>
                      <strong>{buildShiftWindow(detail.item.starts_at, detail.item.ends_at)}</strong>
                    </div>
                  </div>

                  <div className="detail-chip-row">
                    {detail.item.alert_labels.map((label) => (
                      <span key={label} className="detail-chip">
                        {label}
                      </span>
                    ))}
                    {!detail.item.alert_labels.length ? <span className="detail-chip">No active alerts</span> : null}
                  </div>

                  <p className="muted">{detail.item.current_state_reason}</p>

                  <OperationalDetailSection
                    title="Staffing Impact"
                    summary="Attendance risk links directly into staffing coverage, not just timekeeping."
                  >
                    <div className="dashboard-summary-list">
                      <div className="dashboard-summary-row">
                        <span className="muted">Coverage impact</span>
                        <strong>{detail.staffing_impact.coverage_impact ? "Yes" : "No"}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Present vs minimum</span>
                        <strong>
                          {detail.staffing_impact.active_present_count}/{Math.max(detail.staffing_impact.minimum_staff_count, 1)}
                        </strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Present leads</span>
                        <strong>
                          {detail.staffing_impact.present_lead_count}/{Math.max(detail.staffing_impact.required_lead_count, 0)}
                        </strong>
                      </div>
                    </div>
                    <div className="preview-detail-panel__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!detail.item.scheduling_hash}
                        onClick={() => {
                          if (detail.item.scheduling_hash) {
                            window.location.hash = detail.item.scheduling_hash;
                          }
                        }}
                      >
                        Open Scheduling
                      </button>
                    </div>
                  </OperationalDetailSection>

                  {canManage ? (
                    <OperationalDetailSection
                      title="Quick Actions"
                      summary="Manager and lead interventions update the live state, history, and escalation path."
                    >
                      <label className="filter-field">
                        <span>Action note</span>
                        <textarea
                          value={actionNote}
                          onChange={(event) => setActionNote(event.target.value)}
                          rows={3}
                          placeholder="Add context for the attendance timeline, leadership review, or the next person who picks this up."
                        />
                      </label>
                      <div className="preview-detail-panel__actions attendance-ops-actions">
                        {detail.available_actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className={action === "mark_no_show" || action === "request_replacement" ? "secondary-button" : "primary-button"}
                            disabled={actingAction === action}
                            onClick={() => void runAction(action)}
                          >
                            {actingAction === action ? "Saving..." : actionLabel(action)}
                          </button>
                        ))}
                      </div>
                    </OperationalDetailSection>
                  ) : null}

                  <OperationalDetailSection title="History" summary="Every manager action and state change is preserved for review and escalation context.">
                    <div className="ops-preview-list">
                      {detail.history.map((event) => (
                        <OperationalPreviewCard
                          key={event.id}
                          eyebrow={event.actor_user_name ?? "System"}
                          title={humanizeEventType(event.event_type)}
                          summary={event.note ?? formatHistoryTransition(event.from_state, event.to_state)}
                          statusLabel={new Date(event.created_at).toLocaleString()}
                          statusTone={event.to_state === "no_show" || event.to_state === "replacement_needed" ? "critical" : event.to_state === "late" || event.to_state === "unresolved_no_check_in" ? "warning" : "neutral"}
                        />
                      ))}
                      {!detail.history.length ? <div className="empty-state">No live attendance history yet.</div> : null}
                    </div>
                  </OperationalDetailSection>
                </>
              ) : null}
              {!detailLoading && !detail ? <div className="empty-state">Choose an attendance item to inspect details and staffing impact.</div> : null}
            </OperationalDetailSection>
          </aside>
        </div>
      ) : null}

      {!loading && workspace && !allItems.length ? (
        <div className="empty-state">No tracked attendance assignments matched {date}. Change the date or publish work into the day.</div>
      ) : null}
    </section>
  );
}

function actionLabel(action: AttendanceOperationsAction) {
  switch (action) {
    case "mark_present":
      return "Mark Present";
    case "acknowledge_late":
      return "Acknowledge Late";
    case "mark_called_out":
      return "Mark Called Out";
    case "request_replacement":
      return "Request Replacement";
    case "mark_no_show":
      return "Mark No-Show";
    case "excuse":
      return "Manager Excuse";
  }
}

function humanizeState(state: string) {
  return state.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeEventType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildSummary(item: AttendanceOperationsItemRecord) {
  return [
    item.current_state_reason,
    item.shoot_code ? `Shoot ${item.shoot_code}` : null,
    item.coverage_impact ? "Coverage risk" : null
  ]
    .filter(Boolean)
    .join(" | ");
}

function buildShiftWindow(startsAt: string, endsAt: string | null) {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const startLabel = `${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (!end) {
    return startLabel;
  }
  return `${startLabel} - ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function formatHistoryTransition(fromState: AttendanceLiveState | null, toState: AttendanceLiveState | null) {
  if (!fromState && toState) {
    return `Entered ${humanizeState(toState)}.`;
  }
  if (fromState && toState) {
    return `${humanizeState(fromState)} -> ${humanizeState(toState)}`;
  }
  return "Attendance event recorded.";
}
