import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard, type OperationalPreviewTone } from "../components/OperationalPreviewCard";
import { canViewLabor } from "../permissions";
import type {
  PayrollExportPayload,
  PayrollReviewDetailPayload,
  PayrollReviewIssue,
  PayrollReviewRow
} from "../payrollReviewTypes";
import {
  downloadPayrollExportCsv,
  getPayrollExportPayload,
  getPayrollReview,
  getPayrollReviewDetail
} from "../services/payrollReviewApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

type StatusFilter = "all" | "blocked" | "ready" | "exported";

export function PayrollReview({ token, currentUser, socket }: Props) {
  const canAccess = canViewLabor(currentUser);
  const [date, setDate] = useState(getLocalDateString());
  const [department, setDepartment] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [review, setReview] = useState<Awaited<ReturnType<typeof getPayrollReview>> | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [detail, setDetail] = useState<PayrollReviewDetailPayload | null>(null);
  const [exportPreview, setExportPreview] = useState<PayrollExportPayload | null>(null);
  const [loadingReview, setLoadingReview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingExportPreview, setLoadingExportPreview] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const detailRequestIdRef = useRef(0);

  const filters = useMemo(
    () => ({
      date,
      department
    }),
    [date, department]
  );

  async function loadReview() {
    if (!canAccess) {
      setLoadingReview(false);
      return;
    }

    setLoadingReview(true);
    try {
      const payload = await getPayrollReview(token, filters);
      setReview(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load payroll review right now.");
    } finally {
      setLoadingReview(false);
    }
  }

  useEffect(() => {
    void loadReview();
    setExportPreview(null);
  }, [canAccess, token, filters]);

  const visibleRows = useMemo(() => {
    const baseRows = review?.rows ?? [];
    return baseRows.filter((row) => {
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "blocked" ? row.export_readiness === "blocked" : row.export_readiness === statusFilter;
      const matchesEmployee = employeeFilter ? row.employee_id === employeeFilter : true;
      return matchesStatus && matchesEmployee;
    });
  }, [employeeFilter, review?.rows, statusFilter]);

  useEffect(() => {
    if (!visibleRows.length) {
      setSelectedEmployeeId("");
      setDetail(null);
      return;
    }
    setSelectedEmployeeId((current) => (current && visibleRows.some((row) => row.employee_id === current) ? current : visibleRows[0].employee_id));
  }, [visibleRows]);

  useEffect(() => {
    const activeEmployeeId = selectedEmployeeId;
    if (!canAccess || !activeEmployeeId) {
      return;
    }

    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setLoadingDetail(true);
    setDetail(null);

    void getPayrollReviewDetail(token, activeEmployeeId, filters)
      .then((payload) => {
        if (detailRequestIdRef.current !== requestId) {
          return;
        }
        setDetail(payload);
        setError("");
      })
      .catch((loadError) => {
        if (detailRequestIdRef.current !== requestId) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't load payroll detail.");
      })
      .finally(() => {
        if (detailRequestIdRef.current === requestId) {
          setLoadingDetail(false);
        }
      });
  }, [canAccess, selectedEmployeeId, token, filters]);

  useEffect(() => {
    if (!socket || !canAccess) {
      return;
    }
    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onRefresh = (message: string) => {
      setLiveMessage(message);
      void loadReview();
      clearLiveMessage();
    };

    const onAttendanceChanged = () => onRefresh("Live update: payroll review refreshed.");
    const onNotificationCreated = () => onRefresh("Live update: payroll review notifications refreshed.");
    const onScheduleChanged = () => onRefresh("Live update: linked session and shift context refreshed.");

    socket.on("attendance_changed", onAttendanceChanged);
    socket.on("notification_created", onNotificationCreated);
    socket.on("schedule_changed", onScheduleChanged);
    return () => {
      socket.off("attendance_changed", onAttendanceChanged);
      socket.off("notification_created", onNotificationCreated);
      socket.off("schedule_changed", onScheduleChanged);
    };
  }, [canAccess, socket, token, filters]);

  async function previewExportPayload() {
    setLoadingExportPreview(true);
    try {
      const payload = await getPayrollExportPayload(token, filters);
      setExportPreview(payload);
      setNotice("Payroll export payload refreshed from canonical aggregates.");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't build the payroll export payload.");
    } finally {
      setLoadingExportPreview(false);
    }
  }

  async function downloadExport() {
    setExportingCsv(true);
    try {
      await downloadPayrollExportCsv(token, filters);
      setNotice("Payroll export CSV downloaded from canonical payroll aggregates.");
      setError("");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "We couldn't download the payroll export CSV.");
    } finally {
      setExportingCsv(false);
    }
  }

  if (!canAccess) {
    return (
      <section className="panel">
        <div className="section-title">Payroll review is restricted</div>
        <p className="section-subtitle">This workspace is reserved for leadership-side payroll review and export preparation.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="page-header">
          <div>
            <div className="eyebrow">Payroll Review</div>
            <h1>Canonical payroll review desk</h1>
            <p className="section-subtitle">
              Review pay-period aggregates, confidence flags, approvals, and mileage reimbursements from the canonical labor-state model before export.
            </p>
          </div>
          <div className="page-intro-actions">
            <label className="filter-field">
              <span>Pay period anchor</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="filter-field">
              <span>Department</span>
              <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                <option value="all">All departments</option>
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
            <button className="secondary-button" onClick={() => void loadReview()}>
              {loadingReview ? "Refreshing..." : "Refresh"}
            </button>
            <button className="secondary-button" onClick={() => void previewExportPayload()} disabled={loadingExportPreview}>
              {loadingExportPreview ? "Loading Export..." : "Preview Export Payload"}
            </button>
            <button className="secondary-button" onClick={() => void downloadExport()} disabled={exportingCsv}>
              {exportingCsv ? "Downloading..." : "Download Payroll CSV"}
            </button>
          </div>
        </div>

        <div className="metrics-grid workspace-summary-strip">
          <MetricCard label="Regular Office/Drive Hours" value={`${formatHours(review?.summary.regular_office_drive_hours)}h`} />
          <MetricCard label="Regular Photography Hours" value={`${formatHours(review?.summary.regular_photography_hours)}h`} />
          <MetricCard label="Overtime" value={`${formatHours(review?.summary.overtime_hours)}h`} />
          <MetricCard label="Lunch Deductions" value={`${formatHours(review?.summary.lunch_deduction_hours)}h`} />
          <MetricCard label="Missed Clock-In Approvals" value={review?.summary.missed_clock_in_approval_count ?? 0} />
          <MetricCard label="Manual Corrections" value={review?.summary.manual_correction_count ?? 0} />
          <MetricCard label="Mileage Reimbursements" value={formatCurrency(review?.summary.mileage_reimbursement_amount)} />
          <MetricCard label="Exception Count" value={review?.summary.exception_count ?? 0} />
        </div>

        <div className="location-preview-grid">
          <OperationalPreviewCard
            eyebrow="Export Readiness"
            title={`${review?.summary.ready_count ?? 0} ready | ${review?.summary.blocked_count ?? 0} blocked`}
            summary={`Pay period ${review?.pay_period.start ?? "--"} to ${review?.pay_period.end ?? "--"} | ${review?.summary.exported_count ?? 0} already exported`}
            statusLabel={review?.summary.blocked_count ? "Needs review" : "Ready"}
            statusTone={review?.summary.blocked_count ? "warning" : "success"}
          />
          <OperationalPreviewCard
            eyebrow="Canonical Break Overrides"
            title={`${review?.transition.canonical_break_override_count ?? 0} flagged sessions`}
            summary={`Legacy comparison mismatches: ${review?.transition.comparison.mismatch_employee_count ?? 0}`}
            statusLabel={
              review?.transition.comparison.mismatch_employee_count ? "Legacy drift" : "Aligned"
            }
            statusTone={review?.transition.comparison.mismatch_employee_count ? "warning" : "success"}
          />
          <OperationalPreviewCard
            eyebrow="Source Of Truth"
            title={review?.source_of_truth.primary_model ?? "canonical_labor_state"}
            summary={`Primary records: ${(review?.source_of_truth.canonical_records ?? []).join(", ")}`}
            statusLabel="Canonical"
            statusTone="info"
          />
        </div>

        <div className="schedule-filter-grid">
          <label className="filter-field">
            <span>Filter by employee</span>
            <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="">All employees</option>
              {(review?.rows ?? []).map((row) => (
                <option key={row.employee_id} value={row.employee_id}>
                  {row.employee_name ?? row.employee_id}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Readiness</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All rows</option>
              <option value="blocked">Blocked</option>
              <option value="ready">Ready</option>
              <option value="exported">Exported</option>
            </select>
          </label>
        </div>

        {error ? <div className="banner banner-error">{error}</div> : null}
        {notice ? <div className="banner banner-success">{notice}</div> : null}
        {liveMessage ? <div className="banner banner-info">{liveMessage}</div> : null}
      </section>

      <section className="panel">
        <div className="preview-detail-layout">
          <div>
            <div className="section-title">Review By Employee</div>
            <p className="section-subtitle">
              Each row reflects canonical payroll aggregates first, with unresolved blockers and legacy comparison drift called out explicitly.
            </p>
            <div className="ops-preview-list">
              {visibleRows.map((row) => (
                <OperationalPreviewCard
                  key={row.employee_id}
                  eyebrow={row.department ? humanizeLabel(row.department) : "Employee"}
                  title={row.employee_name ?? row.employee_id}
                  summary={
                    <>
                      <div>
                        Office/Drive {formatHours(toHours(row.regular_office_drive_minutes))}h | Photography {formatHours(toHours(row.regular_photography_minutes))}h | OT {formatHours(toHours(row.overtime_minutes))}h
                      </div>
                      <div className="muted">
                        Mileage {formatCurrency(Number(row.mileage_reimbursement_amount ?? 0))} | Exceptions {row.exception_request_count} | Approvals {row.approval_record_count}
                      </div>
                    </>
                  }
                  statusLabel={getReadinessLabel(row)}
                  statusTone={getReadinessTone(row)}
                  flags={buildRowFlags(row)}
                  nextAction="Open employee payroll detail"
                  selected={selectedEmployeeId === row.employee_id}
                  onClick={() => {
                    setSelectedEmployeeId(row.employee_id);
                    setNotice("");
                    setError("");
                  }}
                />
              ))}
            </div>
            {!loadingReview && !visibleRows.length ? (
              <div className="empty-state">No payroll rows match these filters yet.</div>
            ) : null}
          </div>

          <aside className="preview-detail-panel">
            <div className="section-title">Payroll Detail</div>
            <p className="section-subtitle">
              Drill into the exact sessions, segments, exception requests, approvals, and mileage reimbursements contributing to this employee's pay-period row.
            </p>
            {loadingDetail ? <div className="empty-state">Loading payroll detail...</div> : null}
            {!loadingDetail && detail ? (
              <div className="request-card detail-card">
                <div className="ops-preview-card__header">
                  <div>
                    <div className="eyebrow">{detail.row.department ? humanizeLabel(detail.row.department) : "Employee"}</div>
                    <strong className="ops-preview-card__title">{detail.row.employee_name ?? detail.row.employee_id}</strong>
                  </div>
                  <span className={`ops-preview-chip ops-preview-chip--${getReadinessTone(detail.row)}`}>
                    {getReadinessLabel(detail.row)}
                  </span>
                </div>

                <div className="detail-chip-row">
                  <span className="detail-chip">{detail.row.pay_period_start} to {detail.row.pay_period_end}</span>
                  <span className="detail-chip">Mileage {formatCurrency(Number(detail.row.mileage_reimbursement_amount ?? 0))}</span>
                  <span className="detail-chip">Exceptions {detail.row.exception_request_count}</span>
                  <span className="detail-chip">Approvals {detail.row.approval_record_count}</span>
                </div>

                <OperationalDetailSection
                  title="Review State"
                  summary={`${detail.row.review_issues.length} issue flags | ${detail.row.manual_correction_count} manual corrections | ${detail.row.missed_clock_in_approval_count} missed clock-in approvals`}
                  defaultOpen
                >
                  <div className="detail-chip-row">
                    <span className="detail-chip">Office/Drive {formatHours(toHours(detail.row.regular_office_drive_minutes))}h</span>
                    <span className="detail-chip">Photography {formatHours(toHours(detail.row.regular_photography_minutes))}h</span>
                    <span className="detail-chip">Overtime {formatHours(toHours(detail.row.overtime_minutes))}h</span>
                    <span className="detail-chip">Lunch {formatHours(toHours(detail.row.lunch_deduction_minutes))}h</span>
                  </div>
                  {detail.row.review_issues.length ? (
                    <div className="ops-preview-list">
                      {detail.row.review_issues.map((issue) => (
                        <OperationalPreviewCard
                          key={issue.code}
                          eyebrow={issue.blocks_export ? "Blocks export" : "Watch item"}
                          title={issue.label}
                          summary={issue.message}
                          statusLabel={issue.resolution_state === "unresolved" ? "Open" : "Resolved"}
                          statusTone={issue.severity === "important" ? "warning" : "info"}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">No unresolved payroll confidence issues for this employee.</div>
                  )}
                </OperationalDetailSection>

                <OperationalDetailSection
                  title="Contributing Sessions And Segments"
                  summary={`${detail.linked_records.sessions.length} session${detail.linked_records.sessions.length === 1 ? "" : "s"} in this pay period`}
                >
                  <div className="ops-preview-list">
                    {detail.linked_records.sessions.map((session) => (
                      <OperationalPreviewCard
                        key={session.session_id}
                        eyebrow={session.work_date}
                        title={session.shift_title ?? session.shoot_title ?? "Time Session"}
                        summary={
                          <>
                            <div>
                              Office/Drive {formatHours(toHours(session.office_drive_minutes))}h | Photography {formatHours(toHours(session.photography_minutes))}h | Payable {formatHours(toHours(session.payable_minutes))}h
                            </div>
                            <div className="muted">
                              {session.shoot_title ?? "No linked Shoot"} | {session.location_name ?? "No linked location"}
                            </div>
                            {session.segments.length ? (
                              <div className="detail-chip-row">
                                {session.segments.map((segment) => (
                                  <span key={segment.id} className="detail-chip">
                                    {humanizeLabel(segment.work_state)} {formatHours(toHours(segment.duration_minutes ?? 0))}h
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </>
                        }
                        statusLabel={humanizeLabel(session.session_status)}
                        statusTone={session.reporting_flags.length ? "warning" : "neutral"}
                        flags={session.reporting_flags.map((flag) => ({ label: humanizeLabel(flag), tone: "info" as const }))}
                      />
                    ))}
                  </div>
                </OperationalDetailSection>

                <OperationalDetailSection
                  title="Exceptions And Approval History"
                  summary={`${detail.linked_records.exception_requests.length} request${detail.linked_records.exception_requests.length === 1 ? "" : "s"} linked to this pay period`}
                >
                  {detail.linked_records.exception_requests.length ? (
                    <div className="ops-preview-list">
                      {detail.linked_records.exception_requests.map((request) => (
                        <OperationalPreviewCard
                          key={request.id}
                          eyebrow={humanizeLabel(request.request_type)}
                          title={request.note || request.shoot_title || "Exception Request"}
                          summary={
                            <>
                              <div>
                                {request.work_date ?? "No linked work date"} | {request.shift_title ?? request.shoot_title ?? "No linked shift"}
                              </div>
                              <div className="muted">
                                {request.approval_records.length
                                  ? request.approval_records.map((record) => `${record.decision} by ${record.approver_name ?? record.approver_role}`).join(" | ")
                                  : "No approval records yet"}
                              </div>
                            </>
                          }
                          statusLabel={humanizeLabel(request.status)}
                          statusTone={request.status === "approved" ? "success" : request.status === "rejected" ? "critical" : "warning"}
                          flags={request.reporting_flags.map((flag) => ({ label: humanizeLabel(flag), tone: "info" as const }))}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">No exception requests are linked to this pay period.</div>
                  )}
                </OperationalDetailSection>

                <OperationalDetailSection
                  title="Mileage Reimbursements"
                  summary={`${detail.linked_records.mileage_reimbursements.length} reimbursement day${detail.linked_records.mileage_reimbursements.length === 1 ? "" : "s"} kept separate from labor cost`}
                >
                  {detail.linked_records.mileage_reimbursements.length ? (
                    <div className="ops-preview-list">
                      {detail.linked_records.mileage_reimbursements.map((reimbursement) => (
                        <OperationalPreviewCard
                          key={reimbursement.id}
                          eyebrow={reimbursement.work_date}
                          title={reimbursement.linked_shoot_title ?? reimbursement.location_name ?? "Mileage Reimbursement"}
                          summary={
                            <>
                              <div>
                                {formatCurrency(Number(reimbursement.reimbursement_amount ?? 0))} | {reimbursement.zone_name ?? "No zone"} | {humanizeLabel(reimbursement.status)}
                              </div>
                              <div className="muted">
                                {reimbursement.sources.length} source{reimbursement.sources.length === 1 ? "" : "s"} | {reimbursement.review_reason_code ? humanizeLabel(reimbursement.review_reason_code) : "No review reason"}
                              </div>
                            </>
                          }
                          statusLabel={humanizeLabel(reimbursement.status)}
                          statusTone={reimbursement.status === "review_required" ? "warning" : reimbursement.status === "approved" || reimbursement.status === "exported" ? "success" : "neutral"}
                          flags={reimbursement.reporting_flags.map((flag) => ({ label: humanizeLabel(flag), tone: "info" as const }))}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">No mileage reimbursements are linked to this pay period.</div>
                  )}
                </OperationalDetailSection>

                <OperationalDetailSection
                  title="Export Payload Preview"
                  summary="This is the row that the canonical payroll export writer will emit."
                >
                  <div className="detail-chip-row">
                    <span className="detail-chip">Review {humanizeLabel(detail.export_payload_row.review_state)}</span>
                    <span className="detail-chip">Export {humanizeLabel(detail.export_payload_row.export_readiness)}</span>
                    <span className="detail-chip">Mileage {formatCurrency(detail.export_payload_row.mileage_reimbursement_amount)}</span>
                  </div>
                  <p className="muted">{detail.export_payload_row.notes || "No additional export notes."}</p>
                </OperationalDetailSection>
              </div>
            ) : null}
            {!loadingDetail && !detail ? <div className="empty-state">Select an employee row to review the payroll detail.</div> : null}
          </aside>
        </div>
      </section>

      {exportPreview ? (
        <section className="panel">
          <div className="section-title">Export Payload</div>
          <p className="section-subtitle">
            {exportPreview.summary.employee_count} employees | {exportPreview.summary.ready_count} ready | {exportPreview.summary.blocked_count} blocked | mileage remains separate from labor hours.
          </p>
          <div className="report-table-shell">
            <table className="shoots-table report-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Readiness</th>
                  <th>Office/Drive</th>
                  <th>Photography</th>
                  <th>Overtime</th>
                  <th>Lunch</th>
                  <th>Mileage</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {exportPreview.rows.map((row) => (
                  <tr key={row.employee_id}>
                    <td>
                      <strong>{row.employee_name ?? row.employee_id}</strong>
                      <div className="muted">{row.department ? humanizeLabel(row.department) : "No department"}</div>
                    </td>
                    <td>{humanizeLabel(row.export_readiness)}</td>
                    <td>{formatHours(row.regular_office_drive_hours)}h</td>
                    <td>{formatHours(row.regular_photography_hours)}h</td>
                    <td>{formatHours(row.overtime_hours)}h</td>
                    <td>{formatHours(row.lunch_deduction_hours)}h</td>
                    <td>{formatCurrency(row.mileage_reimbursement_amount)}</td>
                    <td>{row.notes || "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="stat-card panel">
      <div className="eyebrow">{label}</div>
      <strong>{value}</strong>
    </article>
  );
}

function getReadinessTone(row: PayrollReviewRow): OperationalPreviewTone {
  if (row.export_readiness === "blocked") {
    return "warning";
  }
  if (row.export_readiness === "exported") {
    return "success";
  }
  return "info";
}

function getReadinessLabel(row: PayrollReviewRow) {
  if (row.export_readiness === "blocked") {
    return "Needs review";
  }
  if (row.export_readiness === "exported") {
    return "Exported";
  }
  return "Ready";
}

function buildRowFlags(row: PayrollReviewRow) {
  const flags: Array<{ label: string; tone: OperationalPreviewTone }> = [];
  if (row.unresolved_issue_count > 0) {
    flags.push({ label: `${row.unresolved_issue_count} open issue${row.unresolved_issue_count === 1 ? "" : "s"}`, tone: "warning" });
  }
  if (row.manual_correction_count > 0) {
    flags.push({ label: `${row.manual_correction_count} manual correction${row.manual_correction_count === 1 ? "" : "s"}`, tone: "info" });
  }
  if (row.missed_clock_in_approval_count > 0) {
    flags.push({
      label: `${row.missed_clock_in_approval_count} missed clock-in approval${row.missed_clock_in_approval_count === 1 ? "" : "s"}`,
      tone: "info"
    });
  }
  return flags;
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value ?? 0));
}

function formatHours(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

function toHours(minutes: number) {
  return Number((Number(minutes ?? 0) / 60).toFixed(2));
}

function getLocalDateString() {
  return new Date().toISOString().slice(0, 10);
}
