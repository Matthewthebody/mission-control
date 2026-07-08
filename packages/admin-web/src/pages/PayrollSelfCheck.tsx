import { useCallback, useEffect, useMemo, useState } from "react";
import {
  confirmSelfCheck,
  formatMinutesAsHours,
  getMySelfCheck,
  SELF_CHECK_RESPONSE_LABELS,
  submitSelfCheckResponse,
  type MySelfCheckPayload,
  type SelfCheckDay,
  type SelfCheckResponseKind
} from "../services/laborCommandCenterApi";

type Props = {
  token: string;
};

type LoadState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; payload: MySelfCheckPayload };

const PROBLEM_RESPONSES: SelfCheckResponseKind[] = [
  "something_wrong",
  "missing_punch",
  "no_break_taken",
  "wrong_job_location",
  "worked_extra_time"
];

function formatDayLabel(workDate: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(
    new Date(`${workDate}T12:00:00`)
  );
}

function formatClock(value: string | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatLockMoment(value: string | null) {
  if (!value) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value)
  );
}

// Employee payroll self-check: review each day in the pay period, confirm the hours,
// or report a problem. Problem reports create canonical correction requests — this
// page never edits time directly. Employees see hours only, never rates or cost.
export function PayrollSelfCheck({ token }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [activeProblemDay, setActiveProblemDay] = useState<string | null>(null);
  const [problemResponse, setProblemResponse] = useState<SelfCheckResponseKind>("something_wrong");
  const [problemNote, setProblemNote] = useState("");
  const [breakNoteDay, setBreakNoteDay] = useState<string | null>(null);
  const [breakNote, setBreakNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const payload = await getMySelfCheck(token);
      setLoad({ state: "ready", payload });
    } catch (error) {
      setLoad({ state: "error", message: error instanceof Error ? error.message : "We couldn't load your payroll self-check." });
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const payload = load.state === "ready" ? load.payload : null;
  const windowOpen = payload?.window_state === "open";
  const confirmed = payload?.self_check?.status === "confirmed";

  const allDaysReviewed = useMemo(() => {
    if (!payload) {
      return false;
    }
    return payload.days.every((day) => day.responses.length > 0);
  }, [payload]);

  async function handleLooksCorrect(day: SelfCheckDay) {
    if (!payload?.period || submitting) {
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await submitSelfCheckResponse(token, {
        period_id: payload.period.id,
        work_date: day.work_date,
        response: "looks_correct"
      });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't save your review.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNoBreakClaim(day: SelfCheckDay, managerApproved: boolean, note: string) {
    if (!payload?.period || submitting) {
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await submitSelfCheckResponse(token, {
        period_id: payload.period.id,
        work_date: day.work_date,
        response: "no_break_taken",
        manager_approved_claimed: managerApproved,
        note: note.trim() || null
      });
      setActiveProblemDay(null);
      setProblemNote("");
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't file your break report.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProblemSubmit(day: SelfCheckDay) {
    if (!payload?.period || submitting) {
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await submitSelfCheckResponse(token, {
        period_id: payload.period.id,
        work_date: day.work_date,
        response: problemResponse,
        note: problemNote.trim()
      });
      setActiveProblemDay(null);
      setProblemNote("");
      setProblemResponse("something_wrong");
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't file your report.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!payload?.period || submitting) {
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await confirmSelfCheck(token, payload.period.id);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't record your confirmation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (load.state === "loading") {
    return (
      <section className="panel">
        <div className="section-title">Payroll Self-Check</div>
        <p className="section-subtitle">Loading your pay period review…</p>
      </section>
    );
  }

  if (load.state === "error") {
    return (
      <section className="panel">
        <div className="section-title">Payroll Self-Check</div>
        <p className="section-subtitle">{load.message}</p>
        <button type="button" className="secondary-button" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    );
  }

  const period = payload?.period ?? null;
  const lockLabel = formatLockMoment(period?.lock_scheduled_at ?? null);

  return (
    <div className="workspace-shell payroll-self-check">
      <header className="page-intro">
        <div>
          <div className="eyebrow">My Work</div>
          <h2>Payroll Self-Check</h2>
          <p className="section-subtitle">
            {period
              ? `Pay period ${period.period_start} – ${period.period_end}.`
              : "No pay period found."}
            {lockLabel ? ` Payroll locks ${lockLabel}.` : ""}
          </p>
        </div>
        <div className="page-intro-actions">
          {confirmed ? (
            <span className="meta-pill meta-pill--success">Confirmed</span>
          ) : windowOpen ? (
            <span className="meta-pill meta-pill--warning">Review needed</span>
          ) : (
            <span className="meta-pill">{payload?.window_state === "closed" ? "Window closed" : "Not open yet"}</span>
          )}
        </div>
      </header>

      {!windowOpen && !confirmed ? (
        <section className="panel empty-state--panel">
          <div className="section-title">
            {payload?.window_state === "closed" ? "The self-check window for this period has closed." : "Self-check is not open yet."}
          </div>
          <p className="section-subtitle">
            {payload?.window_state === "closed"
              ? "Talk to your manager or payroll if something about this period still looks wrong."
              : lockLabel
                ? `You'll be asked to review your time three days before payroll locks (${lockLabel}).`
                : "You'll be asked to review your time three days before payroll locks."}
          </p>
        </section>
      ) : null}

      {actionError ? (
        <section className="panel">
          <span className="meta-pill meta-pill--critical">{actionError}</span>
        </section>
      ) : null}

      {payload && payload.days.length === 0 ? (
        <section className="panel empty-state--panel">
          <div className="section-title">No recorded time in this pay period.</div>
          <p className="section-subtitle">If you worked and see no days here, report a missing punch to your manager.</p>
        </section>
      ) : null}

      {payload?.days.map((day) => {
        const reviewed = day.responses.length > 0;
        const openProblems = day.responses.filter(
          (response) => response.response !== "looks_correct" && response.resolution_status === "open"
        );
        return (
          <section key={day.work_date} className="panel payroll-self-check__day">
            <div className="section-title">{formatDayLabel(day.work_date)}</div>
            <p className="section-subtitle">
              {formatClock(day.clock_in_at)} – {formatClock(day.clock_out_at)} · {formatMinutesAsHours(day.total_worked_minutes)} worked
              {day.lunch_deduction_minutes > 0 ? ` · ${day.lunch_deduction_minutes}m break deducted` : " · no break deducted"}
            </p>
            <p className="section-subtitle">
              {day.shoot_title ?? day.shift_title ?? "No linked assignment"}
              {day.location_name ? ` · ${day.location_name}` : ""}
            </p>
            <div className="payroll-self-check__badges">
              {day.manager_edit_count > 0 ? (
                <span className="meta-pill meta-pill--warning">{day.manager_edit_count} manager edit(s)</span>
              ) : null}
              {day.open_exception_count > 0 ? (
                <span className="meta-pill meta-pill--warning">{day.open_exception_count} open correction(s)</span>
              ) : null}
              {day.geofence_exception ? <span className="meta-pill meta-pill--warning">Location exception</span> : null}
              {day.responses.map((response) => (
                <span
                  key={response.id}
                  className={`meta-pill ${
                    response.response === "looks_correct"
                      ? "meta-pill--success"
                      : response.resolution_status === "open"
                        ? "meta-pill--critical"
                        : "meta-pill--success"
                  }`}
                >
                  {SELF_CHECK_RESPONSE_LABELS[response.response]}
                  {response.response !== "looks_correct" && response.resolution_status !== "open" ? " (resolved)" : ""}
                </span>
              ))}
            </div>

            {windowOpen && !confirmed && day.lunch_deduction_minutes > 0 && !day.responses.some((response) => response.response === "no_break_taken") ? (
              <div className="payroll-self-check__break-prompt">
                <p className="section-subtitle">
                  A 30-minute break was auto-deducted from this shift because it was over 5 hours. If you did not get a
                  break, report it before payroll review closes.
                </p>
                <div className="payroll-self-check__day-actions">
                  <button type="button" disabled={submitting} onClick={() => void handleLooksCorrect(day)}>
                    Break deduction is correct
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() => void handleNoBreakClaim(day, false, breakNoteDay === day.work_date ? breakNote : "")}
                  >
                    I did not get a break
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() => void handleNoBreakClaim(day, true, breakNoteDay === day.work_date ? breakNote : "")}
                  >
                    Manager approved no break
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={submitting}
                    onClick={() => {
                      setBreakNoteDay(breakNoteDay === day.work_date ? null : day.work_date);
                      setBreakNote("");
                    }}
                  >
                    Add note
                  </button>
                </div>
                {breakNoteDay === day.work_date ? (
                  <label className="filter-field filter-field--wide">
                    <span>Note for your manager (optional)</span>
                    <textarea
                      rows={2}
                      value={breakNote}
                      onChange={(event) => setBreakNote(event.target.value)}
                      placeholder="Example: We shot straight through lunch; my lead said we'd fix it in payroll."
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            {windowOpen && !confirmed ? (
              activeProblemDay === day.work_date ? (
                <div className="payroll-self-check__problem-form">
                  <label className="filter-field filter-field--wide">
                    <span>What is wrong?</span>
                    <select value={problemResponse} onChange={(event) => setProblemResponse(event.target.value as SelfCheckResponseKind)}>
                      {PROBLEM_RESPONSES.map((response) => (
                        <option key={response} value={response}>
                          {SELF_CHECK_RESPONSE_LABELS[response]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Tell us what happened (required)</span>
                    <textarea
                      rows={3}
                      value={problemNote}
                      onChange={(event) => setProblemNote(event.target.value)}
                      placeholder="Example: I worked until 6:15pm but the day shows 5:30pm."
                    />
                  </label>
                  <div className="payroll-self-check__problem-actions">
                    <button type="button" disabled={submitting || !problemNote.trim()} onClick={() => void handleProblemSubmit(day)}>
                      {submitting ? "Submitting…" : "Submit report"}
                    </button>
                    <button type="button" className="secondary-button" disabled={submitting} onClick={() => setActiveProblemDay(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="payroll-self-check__day-actions">
                  <button type="button" disabled={submitting || (reviewed && openProblems.length === 0)} onClick={() => void handleLooksCorrect(day)}>
                    {reviewed && openProblems.length === 0 ? "Reviewed" : "Looks correct"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() => {
                      setActiveProblemDay(day.work_date);
                      setProblemNote("");
                    }}
                  >
                    Something is wrong
                  </button>
                </div>
              )
            ) : null}
          </section>
        );
      })}

      {windowOpen && !confirmed && payload && payload.days.length > 0 ? (
        <section className="panel">
          <div className="section-title">Finish your self-check</div>
          <p className="section-subtitle">
            {payload.open_discrepancy_count > 0
              ? `You have ${payload.open_discrepancy_count} open problem report(s). A manager must resolve them before you can confirm.`
              : allDaysReviewed
                ? "Every day is reviewed. Confirm to tell payroll your time is correct."
                : "Review each day above, then confirm your pay period."}
          </p>
          <button
            type="button"
            disabled={submitting || payload.open_discrepancy_count > 0 || !allDaysReviewed}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Saving…" : "Confirm my time is correct"}
          </button>
        </section>
      ) : null}

      {confirmed && payload?.self_check?.confirmed_at ? (
        <section className="panel empty-state--panel">
          <div className="section-title">You confirmed this pay period.</div>
          <p className="section-subtitle">
            Confirmed {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(payload.self_check.confirmed_at))}.
            If something changes, tell your manager before payroll locks.
          </p>
        </section>
      ) : null}
    </div>
  );
}
