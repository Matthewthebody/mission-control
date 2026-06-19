import { useEffect, useRef, useState } from "react";
import {
  acknowledgeEmployeeStaffingAssignment,
  declineEmployeeStaffingAssignment,
  fetchEmployeeStaffingAssignments,
  type EmployeeStaffingAssignment
} from "../services/employeeStaffing";
import {
  assignmentRoleSummary,
  assignmentStatusLabel,
  assignmentStatusTone,
  isOutstandingConfirmation
} from "../pages/employeeStaffingLabels";

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatWindow(assignment: EmployeeStaffingAssignment): string {
  const start = assignment.arrival_time ?? assignment.start_time;
  const end = assignment.end_time_est;
  if (start && end) {
    return `${formatDateTime(start)} – ${formatDateTime(end)}`;
  }
  return formatDateTime(start);
}

export function EmployeeStaffingConfirmations({
  token,
  focusShootId
}: {
  token: string;
  focusShootId?: string | null;
}) {
  const [assignments, setAssignments] = useState<EmployeeStaffingAssignment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusedShootId, setFocusedShootId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<EmployeeStaffingAssignment | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineError, setDeclineError] = useState("");
  const requestSeqRef = useRef(0);
  const declineTextareaRef = useRef<HTMLTextAreaElement>(null);
  const declineTriggerRef = useRef<HTMLButtonElement | null>(null);

  async function load() {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const response = await fetchEmployeeStaffingAssignments(token);
      if (requestSeqRef.current !== seq) return; // a newer load/merge superseded this GET
      setAssignments(response.assignments);
      setError("");
    } catch (loadError) {
      if (requestSeqRef.current !== seq) return;
      setError(loadError instanceof Error ? loadError.message : "We couldn't load your assignments.");
    } finally {
      if (requestSeqRef.current === seq) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Deep-link focus: a publication notification links to #my-work?focus_shoot=<id>. Once assignments load,
  // scroll the matching package into view and highlight it transiently. Pure presentation — never alters state.
  useEffect(() => {
    if (!focusShootId || !assignments) return;
    if (!assignments.some((item) => item.shoot_id === focusShootId)) return;
    const element = document.querySelector(`[data-shoot-id="${CSS.escape(focusShootId)}"]`);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setFocusedShootId(focusShootId);
    const timer = window.setTimeout(() => setFocusedShootId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [focusShootId, assignments]);

  function mergeAssignment(updated: EmployeeStaffingAssignment) {
    // Bump the sequence so any in-flight GET can't restore the prior state over an authoritative mutation.
    requestSeqRef.current += 1;
    setAssignments((prev) => (prev ?? []).map((item) => (item.recipient_id === updated.recipient_id ? updated : item)));
  }

  async function handleAcknowledge(assignment: EmployeeStaffingAssignment) {
    setBusyId(assignment.recipient_id);
    setNotice("");
    setError("");
    try {
      const response = await acknowledgeEmployeeStaffingAssignment(token, assignment.recipient_id);
      mergeAssignment(response.assignment);
      setNotice(`${assignment.shoot_title}: acknowledged.`);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "We couldn't acknowledge this assignment.";
      await load(); // re-sync to the current state (e.g. a stale / no-longer-current package)...
      setError(message); // ...then surface the conflict so the re-sync does not clear it
    } finally {
      setBusyId(null);
    }
  }

  function openDecline(assignment: EmployeeStaffingAssignment, trigger: HTMLButtonElement) {
    declineTriggerRef.current = trigger;
    setDeclineTarget(assignment);
    setDeclineReason("");
    setDeclineError("");
  }

  function closeDecline() {
    setDeclineTarget(null);
    declineTriggerRef.current?.focus(); // restore focus to the Decline trigger
  }

  async function submitDecline() {
    if (!declineTarget) return;
    if (!declineReason.trim()) {
      setDeclineError("A reason is required.");
      declineTextareaRef.current?.focus();
      return;
    }
    setBusyId(declineTarget.recipient_id);
    try {
      const response = await declineEmployeeStaffingAssignment(token, declineTarget.recipient_id, declineReason.trim());
      mergeAssignment(response.assignment);
      setNotice(`${declineTarget.shoot_title}: declined. Staffing leadership will see this needs a replacement.`);
      setDeclineTarget(null);
      declineTriggerRef.current?.focus();
    } catch (actionError) {
      setDeclineError(actionError instanceof Error ? actionError.message : "We couldn't submit your decline.");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (declineTarget) {
      declineTextareaRef.current?.focus();
    }
  }, [declineTarget]);

  if (loading && assignments === null) {
    return (
      <section className="employee-staffing-confirmations" data-testid="employee-staffing-confirmations">
        <div className="empty-state empty-state--panel">Loading your assignments…</div>
      </section>
    );
  }
  if (error && assignments === null) {
    return (
      <section className="employee-staffing-confirmations" data-testid="employee-staffing-confirmations">
        <div className="empty-state empty-state--panel" role="alert">
          {error}
        </div>
      </section>
    );
  }

  const list = assignments ?? [];
  if (!list.length) {
    return null; // nothing to confirm — keep My Work uncluttered
  }
  const sorted = [...list].sort(
    (a, b) => Number(isOutstandingConfirmation(b)) - Number(isOutstandingConfirmation(a))
  );

  return (
    <section className="employee-staffing-confirmations" data-testid="employee-staffing-confirmations">
      <header className="employee-staffing-confirmations__header">
        <div className="eyebrow">Assignments requiring confirmation</div>
      </header>
      {notice ? (
        <div className="muted" role="status" data-testid="confirmation-notice">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="ops-preview-flag ops-preview-flag--warning" role="alert">
          {error}
        </div>
      ) : null}
      <ul className="employee-staffing-confirmations__list">
        {sorted.map((assignment) => (
          <li
            key={assignment.recipient_id}
            data-shoot-id={assignment.shoot_id}
            className={`notification-card notification-card--${assignmentStatusTone(assignment)}${
              assignment.shoot_id === focusedShootId ? " notification-card--focus" : ""
            }`}
            data-testid={`assignment-${assignment.recipient_id}`}
          >
            <strong>{assignment.shoot_title}</strong>
            <div className="muted">
              {formatWindow(assignment)}
              {assignment.location_name ? ` · ${assignment.location_name}` : ""}
            </div>
            <div className="muted">{assignmentRoleSummary(assignment)}</div>
            <div data-testid={`assignment-status-${assignment.recipient_id}`}>{assignmentStatusLabel(assignment)}</div>
            {assignment.acknowledgment_due_at && assignment.can_acknowledge ? (
              <div className="muted">Confirm by {formatDateTime(assignment.acknowledgment_due_at)}</div>
            ) : null}
            {assignment.decline_reason ? <div className="muted">Your reason: {assignment.decline_reason}</div> : null}
            <div className="employee-staffing-confirmations__actions">
              {assignment.can_acknowledge ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === assignment.recipient_id}
                  onClick={() => void handleAcknowledge(assignment)}
                >
                  Acknowledge
                </button>
              ) : null}
              {assignment.can_decline ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyId === assignment.recipient_id}
                  onClick={(event) => openDecline(assignment, event.currentTarget)}
                >
                  Decline
                </button>
              ) : null}
              <a className="secondary-button" href={assignment.schedule_link}>
                Open assignment
              </a>
            </div>
          </li>
        ))}
      </ul>

      {declineTarget ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Decline ${declineTarget.shoot_title}`}
          data-testid="decline-dialog"
        >
          <div className="modal-card">
            <strong>Decline {declineTarget.shoot_title}?</strong>
            <p className="muted">
              Declining flags this shoot for staffing leadership to find a replacement. You are not removed from
              the schedule until they confirm the change.
            </p>
            <label className="filter-field filter-field--wide">
              <span>Reason</span>
              <textarea
                ref={declineTextareaRef}
                rows={3}
                value={declineReason}
                onChange={(event) => setDeclineReason(event.target.value)}
                data-testid="decline-reason"
              />
            </label>
            {declineError ? (
              <div className="ops-preview-flag ops-preview-flag--warning" role="alert">
                {declineError}
              </div>
            ) : null}
            <div className="employee-staffing-confirmations__actions">
              <button type="button" className="secondary-button" onClick={closeDecline}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busyId === declineTarget.recipient_id}
                onClick={() => void submitDecline()}
              >
                Submit decline
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
