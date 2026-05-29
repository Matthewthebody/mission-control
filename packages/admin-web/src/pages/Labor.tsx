import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch, apiUrl } from "../api";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import type { OperationsDashboard, SessionUser, ShiftRecord } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

type RangePreset = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "custom";

export function Labor({ token, currentUser, socket }: Props) {
  const [rangePreset, setRangePreset] = useState<RangePreset>("today");
  const [department, setDepartment] = useState("all");
  const [dateFrom, setDateFrom] = useState(getLocalDateString());
  const [dateTo, setDateTo] = useState(getLocalDateString());
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (rangePreset === "custom") {
      return;
    }
    const nextRange = getRangeForPreset(rangePreset);
    setDateFrom(nextRange.dateFrom);
    setDateTo(nextRange.dateTo);
  }, [rangePreset]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo
    });
    if (department !== "all") {
      params.set("department", department);
    }
    return params.toString();
  }, [dateFrom, dateTo, department]);

  async function load() {
    setLoading(true);
    try {
      const [dashboardResponse, shiftRows] = await Promise.all([
        apiFetch<OperationsDashboard>(`/api/dashboard/operations?${query}`, token),
        apiFetch<ShiftRecord[]>(`/api/shifts?date_from=${dateFrom}&date_to=${dateTo}`, token)
      ]);
      setDashboard(dashboardResponse);
      setShifts(shiftRows.filter((shift) => department === "all" || shift.department === department));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load labor reporting.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [query, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onRefresh = () => {
      setLiveMessage("Live update: labor view refreshed.");
      void load();
      clearLiveMessage();
    };

    socket.on("schedule_changed", onRefresh);
    socket.on("attendance_changed", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("attendance_changed", onRefresh);
    };
  }, [query, socket, token]);

  async function downloadReport(kind: "labor" | "punches" | "exceptions" | "payroll") {
    setExporting(true);
    try {
      const response = await fetch(`${apiUrl}/api/dashboard/operations/export.csv?${query}&report=${kind}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`Export failed with ${response.status}`);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `mission-control-${kind}-${dateFrom}-to-${dateTo}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't export that report.");
    } finally {
      setExporting(false);
    }
  }

  const summary = dashboard?.summary;
  const laborRows = dashboard?.reporting.labor ?? [];
  const segmentMix = buildSegmentMix(shifts);
  const insights = dashboard?.insights;
  const atRiskEmployee = [...laborRows].sort((left, right) => Number(right.open_exception_count ?? 0) - Number(left.open_exception_count ?? 0))[0] ?? null;
  const lowestFillShoot = [...(insights?.hours_by_shoot ?? [])].sort((left, right) => left.fill_rate_percent - right.fill_rate_percent)[0] ?? null;
  const busiestDepartment = [...(insights?.hours_by_department ?? [])].sort((left, right) => Number(right.scheduled_hours ?? 0) - Number(left.scheduled_hours ?? 0))[0] ?? null;
  const latestExceptionBucket = (insights?.labor_exceptions_trend ?? []).slice(-1)[0] ?? null;

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Labor</div>
          <h2>Labor Review And Payroll Integrity</h2>
          <p>This is the leadership review surface for schedule-to-actual labor, payroll risk, and exception drift. Employee punch actions stay in the shell and Employees workspace, while live attendance triage stays in Attendance.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Viewer: {currentUser.fullName}</div>
          <label className="filter-field">
            <span>Range</span>
            <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="filter-field">
            <span>From</span>
            <input type="date" value={dateFrom} onChange={(event) => {
              setRangePreset("custom");
              setDateFrom(event.target.value);
            }} />
          </label>
          <label className="filter-field">
            <span>To</span>
            <input type="date" value={dateTo} onChange={(event) => {
              setRangePreset("custom");
              setDateTo(event.target.value);
            }} />
          </label>
          <label className="filter-field">
            <span>Department</span>
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="all">All Departments</option>
              <option value="executive">Executive</option>
              <option value="operations">Operations</option>
              <option value="schools">Schools</option>
              <option value="sports">Sports</option>
              <option value="office">Office</option>
              <option value="production">Production</option>
              <option value="customer_service">Customer Service</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <a className="secondary-button" href="#operations/attendance">
            Open Attendance
          </a>
          <a className="secondary-button" href="#employees/payroll">
            Open Payroll Review
          </a>
          <button className="secondary-button" disabled={exporting} onClick={() => void downloadReport("labor")}>
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Scheduled Hours</div>
          <strong>{formatHours(summary?.scheduled_labor_hours)}h</strong>
          <span className="muted">Published and draft labor planned in the current range.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Worked Hours</div>
          <strong>{formatHours(summary?.actual_labor_hours)}h</strong>
          <span className="muted">Punch-backed hours captured so far.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Fill Rate</div>
          <strong>{Number(summary?.fill_rate_percent ?? 0).toFixed(1)}%</strong>
          <span className="muted">Assigned versus planned headcount across shoots.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Late + Missed</div>
          <strong>{Number(summary?.late_warning_count ?? 0) + Number(summary?.missed_punch_count ?? 0)}</strong>
          <span className="muted">Late warnings and missed-punch exceptions in this window.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Under-Staffed Shoots</div>
          <strong>{Number(summary?.under_staffed_shoot_count ?? 0)}</strong>
          <span className="muted">Shoots still short of the planned staffing count.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Trade Requests</div>
          <strong>{Number(summary?.trade_request_count ?? 0)}</strong>
          <span className="muted">Shift trade requests created in the selected range.</span>
        </article>
      </section>

      <section className="location-preview-grid">
        <OperationalPreviewCard
          eyebrow="Operational Signal"
          title={atRiskEmployee?.assigned_user_name ?? "No employee pressure"}
          summary={atRiskEmployee ? `${Number(atRiskEmployee.open_exception_count ?? 0)} open exception${Number(atRiskEmployee.open_exception_count ?? 0) === 1 ? "" : "s"} | ${formatSignedHours(Number(atRiskEmployee.labor_delta_hours ?? 0))}` : "No employee currently stands out as a repeated exception concern in this range."}
          statusLabel={atRiskEmployee && Number(atRiskEmployee.open_exception_count ?? 0) > 0 ? "Needs review" : "Stable"}
          statusTone={atRiskEmployee && Number(atRiskEmployee.open_exception_count ?? 0) > 0 ? "warning" : "success"}
          nextAction="Open employee labor detail"
        />
        <OperationalPreviewCard
          eyebrow="Fill Pressure"
          title={lowestFillShoot?.scope_code ?? "No fill gap"}
          summary={lowestFillShoot ? `${lowestFillShoot.scope_title} | ${lowestFillShoot.fill_rate_percent.toFixed(1)}% fill rate` : "No shoot fill-rate signal is available in this range."}
          statusLabel={lowestFillShoot && lowestFillShoot.fill_rate_percent < 100 ? "Under-filled" : "Covered"}
          statusTone={lowestFillShoot && lowestFillShoot.fill_rate_percent < 100 ? "critical" : "success"}
          nextAction="Open shoot labor detail"
        />
        <OperationalPreviewCard
          eyebrow="Department Load"
          title={busiestDepartment ? humanizeLabel(busiestDepartment.department) : "No department data"}
          summary={busiestDepartment ? `${formatHours(busiestDepartment.scheduled_hours)}h scheduled | ${formatHours(busiestDepartment.actual_hours)}h worked` : "No department load signal is available in this range."}
          statusLabel="Hours"
          nextAction="Compare department load"
        />
        <OperationalPreviewCard
          eyebrow="Exception Trend"
          title={latestExceptionBucket?.bucket_label ?? "No trend bucket"}
          summary={latestExceptionBucket ? `${latestExceptionBucket.late_count} late | ${latestExceptionBucket.missed_punch_count} missed | ${latestExceptionBucket.outside_geofence_count} geo` : "No exception trend bucket is available in this range."}
          statusLabel={latestExceptionBucket && (latestExceptionBucket.late_count + latestExceptionBucket.missed_punch_count + latestExceptionBucket.outside_geofence_count) > 0 ? "Active" : "Quiet"}
          statusTone={latestExceptionBucket && (latestExceptionBucket.late_count + latestExceptionBucket.missed_punch_count + latestExceptionBucket.outside_geofence_count) > 0 ? "warning" : "success"}
          nextAction="Open exception trend detail"
        />
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {liveMessage ? <div className="live-banner">{liveMessage}</div> : null}
      {loading && !dashboard ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading labor</div>
          <p className="section-subtitle">Pulling schedule-to-actual reporting, exceptions, trends, and reliability summaries.</p>
        </section>
      ) : null}

      <section className="dashboard-layout">
        <div className="dashboard-stack">
          <section className="panel dashboard-panel">
            <OperationalDetailSection
              title="Labor By Employee"
              summary={`${laborRows.length} employee row${laborRows.length === 1 ? "" : "s"} | ${laborRows.filter((row) => Number(row.open_exception_count ?? 0) > 0).length} with open exceptions`}
              defaultOpen
            >
              <div className="report-table-shell">
                <table className="shoots-table report-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Manager</th>
                      <th>Shifts</th>
                      <th>Clocked In</th>
                      <th>Scheduled</th>
                      <th>Worked</th>
                      <th>Delta</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laborRows.map((row) => (
                      <tr key={row.assigned_user_id}>
                        <td>
                          <strong>{row.assigned_user_name}</strong>
                          <div className="muted">{humanizeLabel(row.department)}</div>
                        </td>
                        <td>{row.manager_name ?? "Auto route"}</td>
                        <td>{Number(row.shift_count ?? 0)}</td>
                        <td>{Number(row.clocked_in_shift_count ?? 0)}</td>
                        <td>{formatHours(row.scheduled_hours)}h</td>
                        <td>{formatHours(row.actual_hours)}h</td>
                        <td>{formatSignedHours(Number(row.labor_delta_hours ?? 0))}</td>
                        <td>{Number(row.open_exception_count ?? 0)}</td>
                      </tr>
                    ))}
                    {!laborRows.length ? (
                      <tr>
                        <td colSpan={8} className="empty-state">
                          No labor rows match this view yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </OperationalDetailSection>
          </section>

          <section className="panel dashboard-panel">
            <OperationalDetailSection
              title="Reliability By Employee"
              summary={`${insights?.attendance_reliability_by_employee?.length ?? 0} employee reliability row${(insights?.attendance_reliability_by_employee?.length ?? 0) === 1 ? "" : "s"} | repeated late, missed-punch, and no-show behavior`}
            >
              <div className="report-table-shell">
                <table className="shoots-table report-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Late</th>
                      <th>Missed Punches</th>
                      <th>No Shows</th>
                      <th>Open Exceptions</th>
                      <th>Reliability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(insights?.attendance_reliability_by_employee ?? []).map((row) => (
                      <tr key={row.assigned_user_id}>
                        <td><strong>{row.assigned_user_name}</strong></td>
                        <td>{humanizeLabel(row.department)}</td>
                        <td>{row.late_count}</td>
                        <td>{row.missed_punch_count}</td>
                        <td>{row.no_show_count}</td>
                        <td>{row.open_exception_count}</td>
                        <td>{row.reliability_score}</td>
                      </tr>
                    ))}
                    {!(insights?.attendance_reliability_by_employee ?? []).length ? (
                      <tr>
                        <td colSpan={7} className="empty-state">No employee reliability signals are available in this window.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </OperationalDetailSection>
          </section>

          <section className="panel dashboard-panel">
            <OperationalDetailSection
              title="Hours By Shoot"
              summary={`${insights?.hours_by_shoot?.length ?? 0} shoot row${(insights?.hours_by_shoot?.length ?? 0) === 1 ? "" : "s"} | fill rate and schedule-to-actual drift by shoot`}
            >
              <div className="report-table-shell">
                <table className="shoots-table report-table">
                  <thead>
                    <tr>
                      <th>Shoot</th>
                      <th>Department</th>
                      <th>Planned Staff</th>
                      <th>Assigned</th>
                      <th>Fill Rate</th>
                      <th>Scheduled</th>
                      <th>Worked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(insights?.hours_by_shoot ?? []).map((row) => (
                      <tr key={row.scope_id}>
                        <td>
                          <strong>{row.scope_code}</strong>
                          <div className="muted">{row.scope_title}</div>
                        </td>
                        <td>{humanizeLabel(row.department)}</td>
                        <td>{row.planned_staff_count}</td>
                        <td>{row.scheduled_employees}</td>
                        <td>{row.fill_rate_percent.toFixed(1)}%</td>
                        <td>{formatHours(row.scheduled_hours)}h</td>
                        <td>{formatHours(row.actual_hours)}h</td>
                      </tr>
                    ))}
                    {!(insights?.hours_by_shoot ?? []).length ? (
                      <tr>
                        <td colSpan={7} className="empty-state">No shoot-level labor rows are available yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </OperationalDetailSection>
          </section>
        </div>

        <aside className="panel dashboard-sidebar">
          <div className="section-title">Leadership Snapshot</div>
          <p className="section-subtitle">The sidebar keeps the range-level signals close at hand without turning this into a payroll console.</p>
          <div className="dashboard-summary-list">
            <div className="dashboard-summary-row">
              <span className="muted">Early Clock-In Exceptions</span>
              <strong>{Number(summary?.early_clock_in_exception_count ?? 0)}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">No-Show Suspected</span>
              <strong>{Number(summary?.no_show_suspected_count ?? 0)}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Break Overrides</span>
              <strong>{Number(summary?.break_override_count ?? 0)}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Overtime Risk</span>
              <strong>{Number(summary?.overtime_risk_count ?? 0)}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Setup To Live Lag</span>
              <strong>{Number(summary?.average_setup_to_live_lag_minutes ?? 0).toFixed(1)} min</strong>
            </div>
          </div>

          <section className="sidebar-section">
            <div className="section-title">Hours By Department</div>
            <div className="dashboard-summary-list">
              {(insights?.hours_by_department ?? []).map((row) => (
                <div key={row.department} className="dashboard-summary-row">
                  <span className="muted">{humanizeLabel(row.department)}</span>
                  <strong>{formatHours(row.scheduled_hours)}h / {formatHours(row.actual_hours)}h</strong>
                </div>
              ))}
              {!(insights?.hours_by_department ?? []).length ? <div className="empty-state">No department labor summary is available.</div> : null}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Exception Trend</div>
            <div className="dashboard-summary-list">
              {(insights?.labor_exceptions_trend ?? []).map((row) => (
                <div key={row.bucket_label} className="dashboard-summary-row">
                  <span className="muted">{row.bucket_label}</span>
                  <strong>
                    {row.late_count} late | {row.missed_punch_count} missed | {row.outside_geofence_count} geo
                  </strong>
                </div>
              ))}
              {!(insights?.labor_exceptions_trend ?? []).length ? <div className="empty-state">No exception trend buckets yet.</div> : null}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Trade Frequency</div>
            <div className="dashboard-summary-list">
              {(insights?.shift_trade_frequency ?? []).map((row) => (
                <div key={row.department} className="dashboard-summary-row">
                  <span className="muted">{humanizeLabel(row.department)}</span>
                  <strong>{row.total_requests} requests</strong>
                </div>
              ))}
              {!(insights?.shift_trade_frequency ?? []).length ? <div className="empty-state">No shift trades were created in this range.</div> : null}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Segment Mix</div>
            <div className="dashboard-summary-list">
              {segmentMix.map((segment) => (
                <div key={segment.key} className="dashboard-summary-row">
                  <span className="muted">{segment.label}</span>
                  <strong>{segment.hours.toFixed(2)}h</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Exports</div>
            <div className="schedule-sidebar-actions">
              <button className="secondary-button" disabled={exporting} onClick={() => void downloadReport("labor")}>Labor CSV</button>
              <button className="secondary-button" disabled={exporting} onClick={() => void downloadReport("exceptions")}>Exceptions CSV</button>
              <button className="secondary-button" disabled={exporting} onClick={() => void downloadReport("punches")}>Punches CSV</button>
              <button className="secondary-button" disabled={exporting} onClick={() => void downloadReport("payroll")}>Payroll View CSV</button>
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function buildSegmentMix(shifts: ShiftRecord[]) {
  const totals = new Map<string, number>();
  for (const shift of shifts) {
    for (const segment of shift.segments ?? []) {
      const hours =
        (new Date(segment.scheduled_end_at).getTime() - new Date(segment.scheduled_start_at).getTime()) / 3600000;
      totals.set(segment.segment_kind, (totals.get(segment.segment_kind) ?? 0) + Math.max(hours, 0));
    }
  }
  return [...totals.entries()]
    .map(([key, hours]) => ({
      key,
      label: humanizeLabel(key),
      hours
    }))
    .sort((left, right) => right.hours - left.hours);
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangeForPreset(preset: RangePreset) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (preset === "today") {
    const value = formatDate(today);
    return { dateFrom: value, dateTo: value };
  }
  if (preset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const value = formatDate(yesterday);
    return { dateFrom: value, dateTo: value };
  }
  if (preset === "this_week" || preset === "last_week") {
    const weekday = today.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset + (preset === "last_week" ? -7 : 0));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { dateFrom: formatDate(monday), dateTo: formatDate(sunday) };
  }
  if (preset === "this_month") {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12, 0, 0, 0);
    return { dateFrom: formatDate(monthStart), dateTo: formatDate(monthEnd) };
  }
  const value = formatDate(today);
  return { dateFrom: value, dateTo: value };
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatHours(value: number | string | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

function formatSignedHours(value: number) {
  return `${value >= 0 ? "+" : ""}${formatHours(value)}h`;
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
