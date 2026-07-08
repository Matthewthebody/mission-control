import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeOvertimeWarning,
  approveOvertimeWarning,
  createExportBatch,
  ensureCurrentPeriod,
  sendApprovedTimeToQuickBooks,
  type QuickBooksSyncResult,
  formatMinutesAsHours,
  getLaborCommandCenter,
  getQuickBooksStatus,
  getSelfCheckBoard,
  openSelfCheckWindow,
  PERIOD_STATUS_LABELS,
  resolveSelfCheckItem,
  SELF_CHECK_RESPONSE_LABELS,
  transitionPayrollPeriod,
  updatePayrollPeriodSchedule,
  type LaborCommandCenterOverview,
  type PayrollPeriodStatus,
  type QuickBooksStatus,
  type SelfCheckBoard
} from "../services/laborCommandCenterApi";

type Props = {
  token: string;
};

type LoadState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; overview: LaborCommandCenterOverview; board: SelfCheckBoard; quickbooks: QuickBooksStatus | null };

// Mirrors the server-side lifecycle so the UI only offers legal next steps. The
// server re-validates every transition; this map is presentation only.
const NEXT_STATUSES: Record<PayrollPeriodStatus, PayrollPeriodStatus[]> = {
  open: ["self_check_open", "manager_review"],
  self_check_open: ["manager_review"],
  manager_review: ["payroll_review", "self_check_open"],
  payroll_review: ["owner_review", "manager_review", "correction_needed"],
  owner_review: ["locked", "payroll_review", "correction_needed"],
  locked: ["exported", "correction_needed"],
  exported: ["synced", "correction_needed"],
  synced: ["correction_needed"],
  correction_needed: ["payroll_review"]
};

// Locking, exporting, and marking synced are owner-only actions server-side.
const OWNER_ONLY_NEXT = new Set<PayrollPeriodStatus>(["locked", "exported", "synced"]);

const STATUS_TONES: Record<PayrollPeriodStatus, string> = {
  open: "",
  self_check_open: "meta-pill--warning",
  manager_review: "meta-pill--warning",
  payroll_review: "meta-pill--warning",
  owner_review: "meta-pill--warning",
  locked: "meta-pill--success",
  exported: "meta-pill--success",
  synced: "meta-pill--success",
  correction_needed: "meta-pill--critical"
};

function formatMoment(value: string | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Labor Command Center: leadership/payroll operating surface over the canonical
// labor state — pay-period lifecycle, self-check board, overtime warnings, payroll
// blockers, and the QuickBooks export boundary. Exception-first: blockers come
// before dense tables. No labor cost or pay rates render here.
export function LaborCommandCenter({ token }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [lockScheduleDraft, setLockScheduleDraft] = useState("");
  const [syncResult, setSyncResult] = useState<QuickBooksSyncResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      let overview: LaborCommandCenterOverview;
      try {
        overview = await getLaborCommandCenter(token);
      } catch (firstError) {
        // No period yet for this week: payroll admins can create it directly; for
        // everyone else the worker sweep creates it within a minute.
        try {
          await ensureCurrentPeriod(token);
        } catch {
          throw firstError;
        }
        overview = await getLaborCommandCenter(token);
      }
      const board = await getSelfCheckBoard(token, overview.period.id);
      const quickbooks = overview.access.can_manage_periods ? await getQuickBooksStatus(token) : null;
      setLoad({ state: "ready", overview, board, quickbooks });
    } catch (error) {
      setLoad({ state: "error", message: error instanceof Error ? error.message : "We couldn't load the Labor Command Center." });
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(key: string, action: () => Promise<unknown>) {
    if (busyAction) {
      return;
    }
    setBusyAction(key);
    setActionError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That action failed.");
    } finally {
      setBusyAction("");
    }
  }

  if (load.state === "loading") {
    return (
      <section className="panel">
        <div className="section-title">Labor Command Center</div>
        <p className="section-subtitle">Loading the live labor state…</p>
      </section>
    );
  }

  if (load.state === "error") {
    return (
      <section className="panel">
        <div className="section-title">Labor Command Center</div>
        <p className="section-subtitle">{load.message}</p>
        <button type="button" className="secondary-button" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    );
  }

  const { overview, board, quickbooks } = load;
  const period = overview.period;
  const canManage = overview.access.can_manage_periods;
  const canFinalize = overview.access.can_finalize_payroll;
  const nextStatuses = (NEXT_STATUSES[period.status] ?? []).filter(
    (next) => canFinalize || !OWNER_ONLY_NEXT.has(next)
  );
  const blockerEntries: Array<{ label: string; count: number; hash: string | null }> = [
    { label: "Open time exception requests", count: overview.blockers.open_exception_requests, hash: "#operations/attendance" },
    { label: "Unresolved geofence punch exceptions", count: overview.blockers.unresolved_geofence_punches, hash: "#operations/attendance" },
    { label: "Unresolved self-check problem reports", count: overview.blockers.open_self_check_items, hash: null },
    { label: "Sessions awaiting manager approval", count: overview.blockers.missing_manager_approvals, hash: "#operations/attendance" },
    { label: "Sessions edited after payroll review", count: overview.blockers.edited_after_review_count, hash: null }
  ];
  const activeBlockers = blockerEntries.filter((entry) => entry.count > 0);

  return (
    <div className="workspace-shell labor-command-center">
      <header className="page-intro">
        <div>
          <div className="eyebrow">Leadership</div>
          <h2>Labor Command Center</h2>
          <p className="section-subtitle">
            Pay period {period.period_start} – {period.period_end}. Mission Control owns operational labor truth; QuickBooks owns
            payroll processing.
          </p>
        </div>
        <div className="page-intro-actions">
          <span className={`meta-pill ${STATUS_TONES[period.status]}`}>{PERIOD_STATUS_LABELS[period.status]}</span>
        </div>
      </header>

      {actionError ? (
        <section className="panel">
          <span className="meta-pill meta-pill--critical">{actionError}</span>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">Period pulse</div>
        <div className="labor-command-center__stat-row">
          <div className="stat-card">
            <strong>{board.summary.confirmed_count}</strong>
            <span>of {board.summary.employee_count} employees confirmed</span>
          </div>
          <div className="stat-card">
            <strong>{board.summary.open_discrepancy_items}</strong>
            <span>open problem reports</span>
          </div>
          <div className="stat-card">
            <strong>{overview.overtime.active_warning_count}</strong>
            <span>overtime warnings ({overview.overtime.critical_warning_count} critical)</span>
          </div>
          <div className="stat-card">
            <strong>{board.summary.payroll_ready_count}</strong>
            <span>payroll-ready employees</span>
          </div>
        </div>
        <p className="section-subtitle">
          Lock scheduled: {formatMoment(period.lock_scheduled_at)} · Self-check opened: {formatMoment(period.self_check_opened_at)} ·
          Locked: {formatMoment(period.locked_at)} · Exported: {formatMoment(period.exported_at)}
        </p>
        {period.status === "correction_needed" && period.correction_reason ? (
          <span className="meta-pill meta-pill--critical">Correction needed: {period.correction_reason}</span>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-title">Payroll blockers</div>
        {activeBlockers.length === 0 ? (
          <p className="section-subtitle">No unresolved payroll blockers for this period.</p>
        ) : (
          <ul className="labor-command-center__blockers">
            {activeBlockers.map((entry) => (
              <li key={entry.label}>
                <span className="meta-pill meta-pill--warning">{entry.count}</span> {entry.label}
                {entry.hash ? (
                  <button type="button" className="link-button" onClick={() => (window.location.hash = entry.hash as string)}>
                    Review
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="section-title">Employee self-check board</div>
        <p className="section-subtitle">
          {board.summary.confirmed_count} confirmed · {board.summary.pending_count} not confirmed · {board.summary.discrepancy_count}{" "}
          reported a problem · {board.summary.no_break_claims} no-break claim(s) · {board.summary.missing_punch_claims} missing-punch
          claim(s)
          {board.summary.travel_review_minutes > 0
            ? ` · ${formatMinutesAsHours(board.summary.travel_review_minutes)} part-time drive time held for payroll review`
            : ""}
        </p>
        {board.rows.length === 0 ? (
          <p className="section-subtitle">No employees with recorded time in this period yet.</p>
        ) : (
          <div className="labor-command-center__table-wrap">
            <table className="labor-command-center__table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Hours</th>
                  <th>Self-check</th>
                  <th>Open reports</th>
                  <th>Exceptions</th>
                  <th>Ready</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={row.employee_id}>
                    <td>{row.employee_name ?? row.employee_id}</td>
                    <td>{row.department ?? "—"}</td>
                    <td>
                      {formatMinutesAsHours(row.payable_minutes)}
                      <div className="section-subtitle">
                        {Object.entries(row.pay_code_minutes ?? {})
                          .map(([code, minutes]) => `${code.replace(/_/g, " ")}: ${formatMinutesAsHours(minutes)}`)
                          .join(" · ") || "no pay-code detail"}
                      </div>
                      {row.edited_after_review ? <span className="meta-pill meta-pill--critical">edited after review</span> : null}
                      {row.is_part_time && row.travel_review_minutes > 0 ? (
                        <span className="meta-pill meta-pill--warning">
                          {formatMinutesAsHours(row.travel_review_minutes)} part-time drive time needs payroll review
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`meta-pill ${
                          row.self_check_status === "confirmed"
                            ? "meta-pill--success"
                            : row.self_check_status === "discrepancy_reported"
                              ? "meta-pill--critical"
                              : "meta-pill--warning"
                        }`}
                      >
                        {row.self_check_status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>{row.open_discrepancy_count}</td>
                    <td>
                      {row.open_exception_requests + row.unresolved_geofence_punches === 0
                        ? "—"
                        : `${row.open_exception_requests} time · ${row.unresolved_geofence_punches} geofence`}
                    </td>
                    <td>{row.payroll_ready ? <span className="meta-pill meta-pill--success">Ready</span> : <span className="meta-pill">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">Open problem reports</div>
        {board.open_items.length === 0 ? (
          <p className="section-subtitle">No unresolved self-check reports. Nothing is blocking lock from this workflow.</p>
        ) : (
          <ul className="labor-command-center__open-items">
            {board.open_items.map((item) => (
              <li key={item.item_id}>
                <span className="meta-pill meta-pill--warning">{SELF_CHECK_RESPONSE_LABELS[item.response]}</span>{" "}
                <strong>{item.employee_name ?? item.employee_id}</strong> · {item.work_date}
                {item.note ? <span className="section-subtitle"> — “{item.note}”</span> : null}
                {item.manager_approved_claimed ? (
                  <span className="meta-pill meta-pill--warning">employee says manager approved</span>
                ) : null}
                {item.linked_exception_request_id ? (
                  <span className="meta-pill">correction request filed</span>
                ) : null}
                <button
                  type="button"
                  className="link-button"
                  disabled={busyAction === `resolve:${item.item_id}`}
                  onClick={() =>
                    void runAction(`resolve:${item.item_id}`, () =>
                      resolveSelfCheckItem(token, item.item_id, { resolution: "resolved" })
                    )
                  }
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={busyAction === `dismiss:${item.item_id}`}
                  onClick={() =>
                    void runAction(`dismiss:${item.item_id}`, () =>
                      resolveSelfCheckItem(token, item.item_id, { resolution: "dismissed" })
                    )
                  }
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="section-title">Overtime warnings</div>
        {overview.overtime.warnings.length === 0 ? (
          <p className="section-subtitle">No active overtime warnings this workweek.</p>
        ) : (
          <ul className="labor-command-center__warnings">
            {overview.overtime.warnings.map((warning) => (
              <li key={warning.id}>
                <span
                  className={`meta-pill ${
                    warning.severity === "critical" ? "meta-pill--critical" : warning.severity === "warning" ? "meta-pill--warning" : ""
                  }`}
                >
                  {warning.warning_type.replace(/_/g, " ")}
                </span>{" "}
                <strong>{warning.employee_name ?? warning.employee_id}</strong> — {warning.details?.message ?? ""}{" "}
                <span className="section-subtitle">
                  ({formatMinutesAsHours(warning.actual_minutes)} actual / {formatMinutesAsHours(warning.projected_minutes)} projected /
                  threshold {formatMinutesAsHours(warning.threshold_minutes)})
                </span>
                {warning.status === "approved" ? (
                  <span className="meta-pill meta-pill--success">OT approved</span>
                ) : (
                  <>
                    {warning.status === "active" ? (
                      <button
                        type="button"
                        className="link-button"
                        disabled={busyAction === `ack:${warning.id}`}
                        onClick={() => void runAction(`ack:${warning.id}`, () => acknowledgeOvertimeWarning(token, warning.id))}
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="meta-pill">acknowledged</span>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      disabled={busyAction === `approve-ot:${warning.id}`}
                      onClick={() => void runAction(`approve-ot:${warning.id}`, () => approveOvertimeWarning(token, warning.id))}
                    >
                      Approve OT
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="panel">
          <div className="section-title">Period lifecycle</div>
          <p className="section-subtitle">
            Current status: {PERIOD_STATUS_LABELS[period.status]}. Payroll review hands off to Owner Review; locking, exporting, and
            syncing are owner-only. Only owner-approved, locked time can be exported, and locking is refused while blockers remain.
          </p>
          <div className="labor-command-center__lifecycle-actions">
            {nextStatuses.map((next) => (
              <span key={next}>
                {next === "correction_needed" ? (
                  <span className="labor-command-center__correction">
                    <input
                      type="text"
                      placeholder="Correction reason (required)"
                      value={correctionReason}
                      onChange={(event) => setCorrectionReason(event.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyAction !== "" || !correctionReason.trim()}
                      onClick={() =>
                        void runAction("transition", () =>
                          transitionPayrollPeriod(token, period.id, { to_status: next, reason: correctionReason.trim() })
                        )
                      }
                    >
                      Mark correction needed
                    </button>
                  </span>
                ) : next === "self_check_open" && period.status === "open" ? (
                  <button
                    type="button"
                    disabled={busyAction !== ""}
                    onClick={() => void runAction("open-self-check", () => openSelfCheckWindow(token, period.id))}
                  >
                    Open self-check window
                  </button>
                ) : (
                  <button
                    type="button"
                    className={next === "locked" ? "" : "secondary-button"}
                    disabled={busyAction !== ""}
                    onClick={() => void runAction("transition", () => transitionPayrollPeriod(token, period.id, { to_status: next }))}
                  >
                    Move to {PERIOD_STATUS_LABELS[next]}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="labor-command-center__schedule">
            <label className="filter-field">
              <span>Schedule payroll lock (drives 72/48/24h reminders)</span>
              <input type="datetime-local" value={lockScheduleDraft} onChange={(event) => setLockScheduleDraft(event.target.value)} />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction !== "" || !lockScheduleDraft}
              onClick={() =>
                void runAction("schedule", () =>
                  updatePayrollPeriodSchedule(token, period.id, new Date(lockScheduleDraft).toISOString())
                )
              }
            >
              Save lock schedule
            </button>
          </div>
        </section>
      ) : null}

      {canManage ? (
        <section className="panel">
          <div className="section-title">Export &amp; QuickBooks readiness</div>
          <p className="section-subtitle">
            CSV export is the current handoff to payroll. Direct QuickBooks sync is scaffolded but not connected —{" "}
            {quickbooks
              ? `connection status: ${quickbooks.connection.connection_status.replace(/_/g, " ")}.`
              : "connection status unavailable."}
          </p>
          <div className="labor-command-center__stat-row">
            <div className="stat-card">
              <strong>{overview.export_readiness.export_batch_count}</strong>
              <span>export batch(es) · last {formatMoment(overview.export_readiness.last_export_at)}</span>
            </div>
            <div className="stat-card">
              <strong>
                {quickbooks ? `${quickbooks.employee_mappings.mapped_count}/${quickbooks.employee_mappings.active_employee_count}` : "—"}
              </strong>
              <span>employees mapped to QuickBooks</span>
            </div>
            <div className="stat-card">
              <strong>{quickbooks ? quickbooks.pay_type_mappings.missing_categories.length : "—"}</strong>
              <span>pay type mappings missing</span>
            </div>
          </div>
          <div className="labor-command-center__lifecycle-actions">
            <button
              type="button"
              disabled={busyAction !== "" || !overview.export_readiness.can_export}
              title={overview.export_readiness.can_export ? "Generate and download the payroll CSV" : "Lock the period first"}
              onClick={() =>
                void runAction("export", async () => {
                  const result = await createExportBatch(token, period.id);
                  downloadCsv(result.batch.file_name, result.csv);
                })
              }
            >
              {busyAction === "export" ? "Generating…" : "Generate payroll CSV"}
            </button>
            {!overview.export_readiness.can_export ? (
              <span className="section-subtitle">Export unlocks once the period is locked.</span>
            ) : null}
          </div>
          {quickbooks && quickbooks.employee_mappings.unmapped_employees.length > 0 ? (
            <p className="section-subtitle">
              Unmapped employees:{" "}
              {quickbooks.employee_mappings.unmapped_employees.map((employee) => employee.employee_name ?? employee.employee_id).join(", ")}
            </p>
          ) : null}

          {canFinalize ? (
            <div className="labor-command-center__owner-sync">
              <div className="section-title">Owner final step</div>
              <p className="section-subtitle">
                Sending records approved hours in QuickBooks Online only — it never runs payroll. QuickBooks handles pay,
                taxes, and direct deposit from there.
              </p>
              <button
                type="button"
                disabled={
                  busyAction !== "" ||
                  !overview.export_readiness.can_export ||
                  !quickbooks ||
                  quickbooks.connection.connection_status !== "connected"
                }
                title={
                  !overview.export_readiness.can_export
                    ? "The period must be owner-approved and locked first"
                    : quickbooks?.connection.connection_status !== "connected"
                      ? "QuickBooks Online is not connected yet — use the CSV export"
                      : "Send approved locked hours to QuickBooks Online"
                }
                onClick={() =>
                  void runAction("qb-sync", async () => {
                    setSyncResult(await sendApprovedTimeToQuickBooks(token, period.id));
                  })
                }
              >
                {busyAction === "qb-sync" ? "Sending…" : "Send Approved Time to QuickBooks"}
              </button>
              {quickbooks?.connection.connection_status !== "connected" ? (
                <p className="section-subtitle">
                  QuickBooks Online is not connected (scaffolding phase — no OAuth credentials configured). The CSV export
                  above is the working handoff today.
                </p>
              ) : null}
              {syncResult ? (
                <p className="section-subtitle">
                  Last send: {syncResult.success_count} succeeded · {syncResult.duplicate_count} skipped as duplicates ·{" "}
                  {syncResult.error_count} failed of {syncResult.line_count} line(s).
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">Recent period activity</div>
        {overview.recent_events.length === 0 ? (
          <p className="section-subtitle">No lifecycle events recorded yet.</p>
        ) : (
          <ul className="labor-command-center__events">
            {overview.recent_events.slice(0, 12).map((event) => (
              <li key={event.id}>
                <span className="meta-pill">{event.event_type}</span> {event.from_status ? `${event.from_status} → ` : ""}
                {event.to_status ?? ""} {event.reason ? `· ${event.reason.replace(/_/g, " ")}` : ""} ·{" "}
                {event.actor_name ?? "System"} · {formatMoment(event.created_at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
