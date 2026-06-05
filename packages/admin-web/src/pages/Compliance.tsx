import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard, type OperationalPreviewTone } from "../components/OperationalPreviewCard";
import type {
  ComplianceWorkspaceDetailPayload,
  ComplianceWorkspaceItem,
  ComplianceWorkspaceListPayload,
  ComplianceWorkspaceStatusBucket,
  ComplianceWorkspaceWindow
} from "../complianceTypes";
import {
  canAccessComplianceWorkspace,
  canApproveAttendanceExceptions,
  canApproveMissedPunches
} from "../permissions";
import {
  getComplianceWorkspaceDetail,
  listComplianceWorkspace,
  reviewComplianceAttendanceException,
  reviewComplianceMissedClockIn
} from "../services/complianceApi";
import type { SessionUser } from "../types";
import { isProjectTrackingWorkflowHash, resolveWorkSpineActionHref } from "../workSpineRouting";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

type GroupBy = "blocker" | "urgency" | "issue_type" | "employee" | "shoot" | "organization" | "status_bucket";

const WINDOW_OPTIONS: Array<{ value: ComplianceWorkspaceWindow; label: string }> = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "overdue", label: "Overdue" }
];

const STATUS_OPTIONS: Array<{ value: ComplianceWorkspaceStatusBucket | "all"; label: string }> = [
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All statuses" }
];

const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "blocker", label: "Blocker type" },
  { value: "urgency", label: "Urgency" },
  { value: "issue_type", label: "Issue type" },
  { value: "employee", label: "Employee" },
  { value: "shoot", label: "Shoot" },
  { value: "organization", label: "Organization" },
  { value: "status_bucket", label: "Resolved vs unresolved" }
];

export function Compliance({ token, currentUser, socket }: Props) {
  const canViewWorkspace = canAccessComplianceWorkspace(currentUser);
  const canReviewAttendanceExceptions = canApproveAttendanceExceptions(currentUser);
  const canReviewMissedPunches = canApproveMissedPunches(currentUser);
  const [date, setDate] = useState(getLocalDateString());
  const [windowFilter, setWindowFilter] = useState<ComplianceWorkspaceWindow>("all");
  const [statusFilter, setStatusFilter] = useState<ComplianceWorkspaceStatusBucket | "all">("unresolved");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [shootFilter, setShootFilter] = useState("");
  const [issueTypeFilter, setIssueTypeFilter] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("blocker");
  const [workspace, setWorkspace] = useState<ComplianceWorkspaceListPayload | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [detail, setDetail] = useState<ComplianceWorkspaceDetailPayload | null>(null);
  const [correctedTime, setCorrectedTime] = useState("");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [focusedSection, setFocusedSection] = useState("");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const detailRequestIdRef = useRef(0);

  async function loadDetailForItem(item: ComplianceWorkspaceItem) {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setLoadingDetail(true);
    setDetail(null);
    try {
      const payload = await getComplianceWorkspaceDetail(token, item.source_kind, item.source_id);
      if (detailRequestIdRef.current !== requestId) {
        return;
      }
      setDetail(payload);
      setCorrectedTime(payload.linked_records.correction_request?.requested_start_time ?? "");
      setError("");
    } catch (loadError) {
      if (detailRequestIdRef.current !== requestId) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the Needs Attention detail view.");
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setLoadingDetail(false);
      }
    }
  }

  async function loadWorkspace() {
    if (!canViewWorkspace) {
      setLoadingWorkspace(false);
      return;
    }
    setLoadingWorkspace(true);
    try {
      const payload = await listComplianceWorkspace(token, {
        date,
        window: windowFilter,
        status: statusFilter,
        employeeId: employeeFilter || undefined,
        organizationId: organizationFilter || undefined,
        shootId: shootFilter || undefined,
        issueType: issueTypeFilter ? (issueTypeFilter as ComplianceWorkspaceItem["issue_type"]) : undefined
      });
      setWorkspace(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load Needs Attention.");
    } finally {
      setLoadingWorkspace(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [canViewWorkspace, date, employeeFilter, issueTypeFilter, organizationFilter, shootFilter, statusFilter, token, windowFilter]);

  const rows = workspace?.rows ?? [];
  const selectedItem = rows.find((row) => row.id === selectedItemId) ?? null;
  const urgencyCounts = workspace?.summary.counts_by_urgency ?? { urgent: 0, important: 0, watch: 0 };
  const issueCounts = workspace?.summary.counts_by_issue_type ?? {
    missing_setup_photo: 0,
    missing_post_shoot_evaluation: 0,
    mileage_blocked_missing_post_shoot_evaluation: 0,
    upload_while_off_clock: 0,
    unresolved_end_of_day_confirmation: 0,
    no_lunch_challenge: 0,
    missed_clock_in_request: 0,
    likely_present_missing_clock_in: 0,
    assigned_but_missing: 0
  };
  const freshestUpdate = workspace?.freshness?.latest_unresolved_item_updated_at ?? workspace?.freshness?.latest_item_updated_at ?? null;

  useEffect(() => {
    if (!rows.length) {
      setSelectedItemId("");
      setDetail(null);
      return;
    }
    setSelectedItemId((current) => {
      if (current && rows.some((row) => row.id === current)) {
        return current;
      }
      return rows[0].id;
    });
  }, [rows]);

  useEffect(() => {
    const activeItem = rows.find((row) => row.id === selectedItemId) ?? null;
    if (!canViewWorkspace || !activeItem) {
      if (!activeItem) {
        setDetail(null);
        setLoadingDetail(false);
      }
      return;
    }
    if (detail?.item.id === activeItem.id) {
      return;
    }
    void loadDetailForItem(activeItem);
  }, [canViewWorkspace, rows, selectedItemId, detail?.item.id, token]);

  useEffect(() => {
    if (detail?.item.issue_type !== "missed_clock_in_request") {
      return;
    }
    setCorrectedTime(detail.linked_records.correction_request?.requested_start_time ?? "");
  }, [detail?.item.id]);

  useEffect(() => {
    if (!socket || !canViewWorkspace) {
      return;
    }
    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onRefresh = (message: string) => {
      setLiveMessage(message);
      void loadWorkspace();
      clearLiveMessage();
    };
    const onAttendanceChanged = () => onRefresh("Live update: Needs Attention refreshed.");
    const onNotificationCreated = () => onRefresh("Live update: review notifications refreshed.");
    const onScheduleChanged = () => onRefresh("Live update: linked shift and shoot context refreshed.");

    socket.on("attendance_changed", onAttendanceChanged);
    socket.on("notification_created", onNotificationCreated);
    socket.on("schedule_changed", onScheduleChanged);
    return () => {
      socket.off("attendance_changed", onAttendanceChanged);
      socket.off("notification_created", onNotificationCreated);
      socket.off("schedule_changed", onScheduleChanged);
    };
  }, [canViewWorkspace, socket, token, date, windowFilter, statusFilter, employeeFilter, organizationFilter, shootFilter, issueTypeFilter]);

  const groupedRows = useMemo(() => buildGroups(rows, groupBy), [groupBy, rows]);

  async function handleReview(status: "approved" | "rejected") {
    if (!detail) {
      return;
    }
    const item = detail.item;
    setSubmittingReview(true);
    try {
      if (item.issue_type === "missed_clock_in_request") {
        await reviewComplianceMissedClockIn(token, item.source_id, {
          status,
          correctedTime: status === "approved" ? correctedTime : null
        });
      } else {
        await reviewComplianceAttendanceException(token, item.source_id, { status });
      }
      setNotice(status === "approved" ? "Review approved." : "Review rejected.");
      await loadWorkspace();
      const refreshed = await getComplianceWorkspaceDetail(token, item.source_kind, item.source_id).catch(() => null);
      setDetail(refreshed);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "We couldn't save that review decision.");
    } finally {
      setSubmittingReview(false);
    }
  }

  function jumpToSection(section: string) {
    setFocusedSection(section);
    window.setTimeout(() => {
      sectionRefs.current[section]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  }

  if (!canViewWorkspace) {
    return (
      <section className="panel">
        <div className="section-title">Needs Attention access is restricted</div>
        <p className="section-subtitle">This review queue is reserved for leadership-side operating review and follow-up.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="page-header">
          <div>
            <div className="eyebrow">Leadership Review Queue</div>
            <h1>Needs Attention</h1>
            <p className="section-subtitle">
              Leadership review queue for blocked, missing, overdue, or approval-required work.
            </p>
            <p className="section-subtitle">
              Home previews what matters. Needs Attention is the full review queue. Project Tracking is where full work records live.
            </p>
          </div>
        </div>
        {freshestUpdate ? <div className="detail-chip-row"><span className="detail-chip">Latest unresolved update: {formatDateTime(freshestUpdate)}</span></div> : null}
        <div className="metrics-grid workspace-summary-strip">
          <MetricCard label="Open Items" value={workspace?.summary.open_count ?? 0} />
          <MetricCard label="Overdue / Urgent" value={urgencyCounts.urgent} />
          <MetricCard label="Blocking Payroll or Mileage" value={(workspace?.summary.payroll_blocking_count ?? 0) + (workspace?.summary.mileage_blocking_count ?? 0)} />
          <MetricCard
            label="Waiting on Review"
            value={
              (workspace?.summary.missed_clock_in_review_count ?? 0) +
              (workspace?.summary.no_lunch_review_count ?? 0) +
              (workspace?.summary.off_clock_upload_review_count ?? 0) +
              (workspace?.summary.presence_incident_review_count ?? 0)
            }
          />
        </div>
        <div className="detail-chip-row">
          <span className="detail-chip">Urgent: {urgencyCounts.urgent}</span>
          <span className="detail-chip">Important: {urgencyCounts.important}</span>
          <span className="detail-chip">Missing Setup Photos: {issueCounts.missing_setup_photo}</span>
          <span className="detail-chip">Missing Post-Shoot Evaluations: {issueCounts.missing_post_shoot_evaluation}</span>
          <span className="detail-chip">Unresolved EOD Confirmations: {workspace?.summary.unresolved_end_of_day_confirmation_count ?? 0}</span>
        </div>
        <div className="schedule-filter-grid">
          <label className="filter-field">
            <span>Date anchor</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="filter-field">
            <span>Window</span>
            <select value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as ComplianceWorkspaceWindow)}>
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ComplianceWorkspaceStatusBucket | "all")}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Employee</span>
            <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="">All employees</option>
              {(workspace?.filters.employees ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Organization</span>
            <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)}>
              <option value="">All organizations</option>
              {(workspace?.filters.organizations ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Shoot</span>
            <select value={shootFilter} onChange={(event) => setShootFilter(event.target.value)}>
              <option value="">All shoots</option>
              {(workspace?.filters.shoots ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Issue type</span>
            <select value={issueTypeFilter} onChange={(event) => setIssueTypeFilter(event.target.value)}>
              <option value="">All issue types</option>
              {(workspace?.filters.issue_types ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Group queue by</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
              {GROUP_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
            {groupedRows.map((group) => (
              <section key={group.key} className="compliance-group">
                <div className="section-title">{group.label}</div>
                <div className="muted compliance-group__meta">
                  {group.items.length > 5 ? `Showing 5 of ${group.items.length} items` : `${group.items.length} items`}
                </div>
                <div className="ops-preview-list">
                  {group.items.slice(0, 5).map((item) => (
                    <OperationalPreviewCard
                      key={item.id}
                      eyebrow={item.issue_label}
                      title={item.employee_name ?? item.shoot_title ?? item.organization_display_name ?? "Needs Attention item"}
                      summary={
                        <>
                          <div>{item.blocker.summary}</div>
                          <div className="muted">
                            {item.message}
                          </div>
                          <div className="muted">
                            {item.shoot_title ?? item.shoot_code ?? "No linked Shoot"} | {item.organization_display_name ?? "No linked Organization"}
                          </div>
                        </>
                      }
                      statusLabel={item.blocker.label}
                      statusTone={getStatusTone(item)}
                      owner={item.employee_name ?? undefined}
                      meta={[
                        { label: humanizeLabel(item.urgency), tone: getStatusTone(item) },
                        { label: `Fix in ${displayWorkspaceLabel(item.blocker.owning_workspace_label)}` },
                        { label: formatDateTime(item.updated_at) }
                      ]}
                      flags={buildFlags(item)}
                      nextAction={getNextAction(item)}
                      selected={selectedItem?.id === item.id}
                      onClick={() => {
                        setSelectedItemId(item.id);
                        void loadDetailForItem(item);
                        setNotice("");
                        setError("");
                      }}
                    />
                  ))}
                </div>
                {group.items.length > 5 ? (
                  <p className="section-subtitle compliance-group__overflow-note">Use filters or select a queue to narrow the remaining {group.items.length - 5} items.</p>
                ) : null}
              </section>
            ))}
            {!loadingWorkspace && !rows.length ? (
              <div className="empty-state">Nothing needs review right now.</div>
            ) : null}
          </div>

          <aside className="preview-detail-panel">
            <div className="section-title">Review Detail</div>
            <p className="section-subtitle">Review what is wrong, why it matters, who owns the context, and which existing action is safe to open next.</p>
            {loadingDetail ? <div className="empty-state">Loading review detail...</div> : null}
            {!loadingDetail && detail ? (
              <div className="request-card detail-card">
                <div className="ops-preview-card__header">
                  <div>
                    <div className="eyebrow">{detail.item.issue_label}</div>
                    <strong className="ops-preview-card__title">{detail.item.blocker.summary}</strong>
                  </div>
                  <span className={`ops-preview-chip ops-preview-chip--${getStatusTone(detail.item)}`}>
                    {detail.item.blocker.label}
                  </span>
                </div>
                <div className="detail-chip-row">
                  <span className="detail-chip">{humanizeLabel(detail.item.urgency)}</span>
                  <span className="detail-chip">{detail.item.employee_name ?? "No linked employee"}</span>
                  <span className="detail-chip">{detail.item.shoot_title ?? detail.item.shoot_code ?? "No linked Shoot"}</span>
                  <span className="detail-chip">Fix in {displayWorkspaceLabel(detail.item.blocker.owning_workspace_label)}</span>
                </div>
                <div className="preview-detail-panel__actions compliance-actions-row">
                  <button className="secondary-button" type="button" onClick={() => jumpToSection("shift")} disabled={!detail.linked_records.shift}>
                    Open shift context
                  </button>
                  <button className="secondary-button" type="button" onClick={() => jumpToSection("shoot")} disabled={!detail.linked_records.shoot}>
                    Open shoot context
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => jumpToSection("correction")}
                    disabled={!detail.linked_records.correction_request}
                  >
                    Open correction request
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => jumpToSection("evaluation")}
                    disabled={!detail.linked_records.post_shoot_evaluation}
                  >
                    Open post-shoot evaluation
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => jumpToSection("uploads")}
                    disabled={!detail.linked_records.resource_uploads.length}
                  >
                    Open resource uploads
                  </button>
                </div>
                {detail.available_actions?.length ? (
                  <div className="preview-detail-panel__actions compliance-actions-row">
                    {detail.available_actions
                      .filter((action) => action.hash)
                      .map((action) => (
                        <a key={action.id} className="secondary-button" href={resolveComplianceActionHash(action.hash)}>
                          {displayActionLabel(action.label, action.hash)}
                        </a>
                      ))}
                  </div>
                ) : null}
                {detail.available_actions?.some((action) => !action.hash) ? (
                  <div className="detail-chip-row">
                    {detail.available_actions
                      .filter((action) => !action.hash)
                      .map((action) => (
                        <span key={action.id} className="detail-chip">
                          {displayActionLabel(action.label, action.hash)}
                        </span>
                      ))}
                  </div>
                ) : null}

                {renderReviewActions({
                  detail,
                  correctedTime,
                  submittingReview,
                  canReviewAttendanceExceptions,
                  canReviewMissedPunches,
                  onCorrectedTimeChange: setCorrectedTime,
                  onApprove: () => void handleReview("approved"),
                  onReject: () => void handleReview("rejected")
                })}

                <div ref={(node) => {
                  sectionRefs.current.summary = node;
                }}>
                  <OperationalDetailSection title="Blocker Summary" summary="This is the canonical blocker state, why it matters, and where the owning fix lives." defaultOpen={focusedSection === "summary"}>
                    <div className="dashboard-summary-list">
                      <SummaryRow label="Issue type" value={detail.item.issue_label} />
                      <SummaryRow label="Blocker" value={detail.item.blocker.label} />
                      <SummaryRow label="Why blocked" value={detail.item.blocker.summary} />
                      <SummaryRow label="Best next action" value={getNextAction(detail.item)} />
                      <SummaryRow
                        label="Fix workspace"
                        value={displayWorkspaceLabel(detail.item.blocker.owning_workspace_label)}
                      />
                      <SummaryRow label="Status" value={humanizeLabel(detail.item.source_status)} />
                      <SummaryRow label="Employee" value={detail.item.employee_name ?? "No linked employee"} />
                      <SummaryRow label="Organization" value={detail.item.organization_display_name ?? "No linked organization"} />
                      <SummaryRow label="Location" value={detail.item.location_name ?? "No linked location"} />
                      <SummaryRow label="Occurred" value={formatDateTime(detail.item.occurred_at)} />
                      <SummaryRow label="Updated" value={formatDateTime(detail.item.updated_at)} />
                      <SummaryRow label="Resolved" value={detail.item.resolved_at ? formatDateTime(detail.item.resolved_at) : "Still unresolved"} />
                    </div>
                    {buildFlags(detail.item).length ? (
                      <div className="detail-chip-row">
                        {buildFlags(detail.item).map((flag) => (
                          <span key={flag.label} className="detail-chip">
                            {flag.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {detail.item.resolution_note ? <div className="muted">Resolution note: {detail.item.resolution_note}</div> : null}
                  </OperationalDetailSection>
                </div>

                <OperationalDetailSection
                  title="Payroll Impact"
                  summary="When payroll confidence is affected, the linked session and summary stay visible here."
                  defaultOpen={focusedSection === "payroll"}
                >
                  {detail.payroll_impact ? (
                    <div className="dashboard-summary-list">
                      <SummaryRow label="Payroll blocked" value={detail.payroll_impact.blocked ? "Yes" : "No"} />
                      <SummaryRow label="Reason" value={detail.payroll_impact.reason ?? "No payroll blocker is attached to this item."} />
                      <SummaryRow label="Work date" value={detail.payroll_impact.work_date ?? "No linked work date"} />
                      <SummaryRow label="Session status" value={detail.payroll_impact.session_status ? humanizeLabel(detail.payroll_impact.session_status) : "No linked session"} />
                      <SummaryRow label="Payable minutes" value={detail.payroll_impact.payable_minutes !== null ? String(detail.payroll_impact.payable_minutes) : "Not calculated"} />
                      <SummaryRow label="No-lunch challenge" value={detail.payroll_impact.lunch_challenge_status ? humanizeLabel(detail.payroll_impact.lunch_challenge_status) : "None"} />
                      <SummaryRow
                        label="Missed clock-in approvals"
                        value={detail.payroll_impact.missed_clock_in_approval_count !== null ? String(detail.payroll_impact.missed_clock_in_approval_count) : "None"}
                      />
                    </div>
                  ) : (
                    <div className="empty-state">No payroll impact detail is available for this blocker.</div>
                  )}
                </OperationalDetailSection>

                <OperationalDetailSection
                  title="Mileage Impact"
                  summary="Mileage review context stays explicit when reimbursement is blocked or under review."
                  defaultOpen={focusedSection === "mileage"}
                >
                  {detail.mileage_impact ? (
                    <div className="dashboard-summary-list">
                      <SummaryRow label="Mileage blocked" value={detail.mileage_impact.blocked ? "Yes" : "No"} />
                      <SummaryRow label="Reason" value={detail.mileage_impact.reason ?? "No mileage blocker is attached to this item."} />
                      <SummaryRow label="Review status" value={detail.mileage_impact.status ? humanizeLabel(detail.mileage_impact.status) : "No linked reimbursement"} />
                      <SummaryRow label="Review reason" value={detail.mileage_impact.review_reason_label ?? "None"} />
                      <SummaryRow label="Work date" value={detail.mileage_impact.work_date ?? "No linked work date"} />
                      <SummaryRow label="Zone" value={detail.mileage_impact.zone_name ?? "No zone selected"} />
                      <SummaryRow
                        label="Reimbursement amount"
                        value={detail.mileage_impact.reimbursement_amount ? `$${Number(detail.mileage_impact.reimbursement_amount).toFixed(2)}` : "No reimbursement amount"}
                      />
                      <SummaryRow label="Vehicle" value={detail.mileage_impact.vehicle_type ? humanizeLabel(detail.mileage_impact.vehicle_type) : "Not provided"} />
                    </div>
                  ) : (
                    <div className="empty-state">No mileage impact detail is available for this blocker.</div>
                  )}
                </OperationalDetailSection>

                <div ref={(node) => {
                  sectionRefs.current.shift = node;
                }}>
                  <OperationalDetailSection title="Shift Context" summary="Open shift timing, manager routing, and map context stay attached here." defaultOpen={focusedSection === "shift"}>
                    {detail.linked_records.shift ? (
                      <>
                        <div className="dashboard-summary-list">
                          <SummaryRow label="Shift" value={detail.linked_records.shift.title} />
                          <SummaryRow
                            label="Window"
                            value={`${formatDateTime(detail.linked_records.shift.starts_at)} - ${formatDateTime(detail.linked_records.shift.ends_at)}`}
                          />
                          <SummaryRow label="Attendance state" value={detail.linked_records.shift.attendance_state ? humanizeLabel(detail.linked_records.shift.attendance_state) : "Not set"} />
                          <SummaryRow label="Manager" value={detail.linked_records.shift.manager_name ?? "No linked manager"} />
                          <SummaryRow label="Location" value={detail.linked_records.shift.location_name ?? "No linked location"} />
                        </div>
                        {detail.linked_records.shift.navigation_url ? (
                          <button className="secondary-button" type="button" onClick={() => window.open(detail.linked_records.shift?.navigation_url ?? "", "_blank", "noopener")}>
                            Open in Maps
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-state">No linked shift context was found for this review item.</div>
                    )}
                  </OperationalDetailSection>
                </div>

                <div ref={(node) => {
                  sectionRefs.current.shoot = node;
                }}>
                  <OperationalDetailSection title="Shoot Context" summary="Linked shoot timing and location context stays easy to review from here." defaultOpen={focusedSection === "shoot"}>
                    {detail.linked_records.shoot ? (
                      <div className="dashboard-summary-list">
                        <SummaryRow label="Shoot" value={detail.linked_records.shoot.title} />
                        <SummaryRow label="Shoot code" value={detail.linked_records.shoot.shoot_code ?? "No code"} />
                        <SummaryRow label="Shoot date" value={detail.linked_records.shoot.shoot_date ?? "No date"} />
                        <SummaryRow label="Show time" value={detail.linked_records.shoot.showtime ? formatDateTime(detail.linked_records.shoot.showtime) : "Not set"} />
                        <SummaryRow label="Estimated end" value={detail.linked_records.shoot.estimated_end_time ? formatDateTime(detail.linked_records.shoot.estimated_end_time) : "Not set"} />
                        <SummaryRow label="Status" value={detail.linked_records.shoot.status ? humanizeLabel(detail.linked_records.shoot.status) : "Not set"} />
                      </div>
                    ) : (
                      <div className="empty-state">No linked shoot context was found for this review item.</div>
                    )}
                  </OperationalDetailSection>
                </div>

                <div ref={(node) => {
                  sectionRefs.current.correction = node;
                }}>
                  <OperationalDetailSection title="Correction Request" summary="Exception Request state, approver routing, and audit trail stay visible here." defaultOpen={focusedSection === "correction"}>
                    {detail.linked_records.correction_request ? (
                      <>
                        <div className="dashboard-summary-list">
                          <SummaryRow label="Request type" value={humanizeLabel(detail.linked_records.correction_request.request_type)} />
                          <SummaryRow label="Request status" value={humanizeLabel(detail.linked_records.correction_request.status)} />
                          <SummaryRow label="Submitted" value={formatDateTime(detail.linked_records.correction_request.submitted_at)} />
                          <SummaryRow label="Requested approver" value={detail.linked_records.correction_request.requested_approver_name ?? "Auto route"} />
                          <SummaryRow label="Reviewed by" value={detail.linked_records.correction_request.reviewed_by_name ?? "Pending review"} />
                          <SummaryRow label="Requested state" value={detail.linked_records.correction_request.requested_state ? humanizeLabel(detail.linked_records.correction_request.requested_state) : "Not provided"} />
                          <SummaryRow label="Requested start" value={detail.linked_records.correction_request.requested_start_time ?? "Not provided"} />
                          <SummaryRow label="Requested end" value={detail.linked_records.correction_request.requested_end_time ?? "Not provided"} />
                        </div>
                        {detail.linked_records.correction_request.note ? <div className="muted">Notes: {detail.linked_records.correction_request.note}</div> : null}
                        {detail.linked_records.correction_request.reporting_flags.length ? (
                          <div className="detail-chip-row">
                            {detail.linked_records.correction_request.reporting_flags.map((flag) => (
                              <span key={flag} className="detail-chip">
                                {humanizeLabel(flag)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="ops-preview-list">
                          {detail.linked_records.correction_request.approval_records.map((record) => (
                            <OperationalPreviewCard
                              key={record.id}
                              eyebrow={humanizeLabel(record.approver_role)}
                              title={humanizeLabel(record.decision)}
                              summary={record.comment ?? "No review comment saved."}
                              statusLabel={formatDateTime(record.decided_at)}
                              statusTone={record.decision === "approved" ? "success" : record.decision === "rejected" ? "critical" : "warning"}
                            />
                          ))}
                          {!detail.linked_records.correction_request.approval_records.length ? (
                            <div className="empty-state">No Approval Record entries are attached yet.</div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">No linked correction request is attached to this item.</div>
                    )}
                  </OperationalDetailSection>
                </div>

                <div ref={(node) => {
                  sectionRefs.current.evaluation = node;
                }}>
                  <OperationalDetailSection title="Post-Shoot Evaluation" summary="Mileage dependency and closeout context remain connected here." defaultOpen={focusedSection === "evaluation"}>
                    {detail.linked_records.post_shoot_evaluation ? (
                      <div className="dashboard-summary-list">
                        <SummaryRow label="Submitted" value={formatDateTime(detail.linked_records.post_shoot_evaluation.submitted_at)} />
                        <SummaryRow label="Photographer" value={detail.linked_records.post_shoot_evaluation.photographer_name ?? "Unknown"} />
                        <SummaryRow label="Overall status" value={detail.linked_records.post_shoot_evaluation.overall_shoot_status ?? "Not provided"} />
                        <SummaryRow label="Mileage" value={detail.linked_records.post_shoot_evaluation.submit_for_mileage ? "Submitted for mileage" : "Not submitted for mileage"} />
                        <SummaryRow label="Vehicle" value={detail.linked_records.post_shoot_evaluation.vehicle_type ?? "Not provided"} />
                        <SummaryRow label="Issue flag" value={detail.linked_records.post_shoot_evaluation.issue_flag ? "Flagged" : "Clear"} />
                        <SummaryRow label="Went well" value={detail.linked_records.post_shoot_evaluation.went_well ?? "No summary saved"} />
                        <SummaryRow label="Remember next time" value={detail.linked_records.post_shoot_evaluation.remember_next_time ?? "No notes saved"} />
                      </div>
                    ) : (
                      <div className="empty-state">No linked Post-Shoot Evaluation is available for this item yet.</div>
                    )}
                  </OperationalDetailSection>
                </div>

                <div ref={(node) => {
                  sectionRefs.current.uploads = node;
                }}>
                  <OperationalDetailSection title="Resource Uploads" summary="Setup photos and off-clock upload context stay easy to inspect here." defaultOpen={focusedSection === "uploads"}>
                    <div className="ops-preview-list">
                      {detail.linked_records.resource_uploads.map((upload) => (
                        <OperationalPreviewCard
                          key={upload.id}
                          eyebrow={humanizeLabel(upload.category)}
                          title={upload.file_name}
                          summary={upload.note ?? "No upload note saved."}
                          statusLabel={humanizeLabel(upload.approval_status)}
                          statusTone={upload.approval_status === "approved" ? "success" : upload.approval_status === "leadership_only" ? "warning" : "neutral"}
                          meta={[
                            { label: upload.uploader_name ?? "Unknown uploader" },
                            { label: upload.captured_at ? formatDateTime(upload.captured_at) : formatDateTime(upload.created_at) }
                          ]}
                          flags={[
                            { label: humanizeLabel(upload.visibility_scope), tone: "info" },
                            ...(upload.issue_type ? [{ label: humanizeLabel(upload.issue_type), tone: "warning" as const }] : [])
                          ]}
                        />
                      ))}
                      {!detail.linked_records.resource_uploads.length ? (
                        <div className="empty-state">No linked resource uploads were found for this review item.</div>
                      ) : null}
                    </div>
                  </OperationalDetailSection>
                </div>

                <div ref={(node) => {
                  sectionRefs.current.presence = node;
                }}>
                  <OperationalDetailSection title="Presence Incident" summary="Geofence and assigned-but-missing context stays visible when a presence alert drove the review." defaultOpen={focusedSection === "presence"}>
                    {detail.linked_records.presence_incident ? (
                      <div className="dashboard-summary-list">
                        <SummaryRow label="Alert type" value={humanizeLabel(detail.linked_records.presence_incident.alert_type)} />
                        <SummaryRow label="Current state" value={humanizeLabel(detail.linked_records.presence_incident.current_state)} />
                        <SummaryRow label="Geofence classification" value={humanizeLabel(detail.linked_records.presence_incident.geofence_classification)} />
                        <SummaryRow label="Repeat count" value={String(detail.linked_records.presence_incident.repeat_count)} />
                        <SummaryRow label="Last observed" value={formatDateTime(detail.linked_records.presence_incident.last_observed_at)} />
                        <SummaryRow label="Last notified" value={detail.linked_records.presence_incident.last_notified_at ? formatDateTime(detail.linked_records.presence_incident.last_notified_at) : "Not notified"} />
                        <SummaryRow label="Resolution" value={humanizeLabel(detail.linked_records.presence_incident.resolution_status)} />
                        <SummaryRow label="Resolution reason" value={detail.linked_records.presence_incident.resolution_reason ?? "No reason saved"} />
                      </div>
                    ) : (
                      <div className="empty-state">This review item does not have a linked presence incident.</div>
                    )}
                  </OperationalDetailSection>
                </div>

                <div ref={(node) => {
                  sectionRefs.current.history = node;
                }}>
                  <OperationalDetailSection title="History" summary="Use the composed timeline to see what changed, when it changed, and which source recorded it." defaultOpen={focusedSection === "history"}>
                    <div className="ops-preview-list">
                      {(detail.history ?? []).map((entry) => (
                        <OperationalPreviewCard
                          key={entry.id}
                          eyebrow={entry.source_label}
                          title={entry.title}
                          summary={entry.summary ?? "No additional note saved."}
                          statusLabel={formatDateTime(entry.occurred_at)}
                          statusTone={getHistoryTone(entry.tone)}
                          meta={entry.actor_name ? [{ label: entry.actor_name }] : []}
                        />
                      ))}
                      {!detail.history?.length ? <div className="empty-state">No composed history is available for this item yet.</div> : null}
                    </div>
                  </OperationalDetailSection>
                </div>
              </div>
            ) : null}
            {!loadingDetail && !detail ? <div className="empty-state">Choose an item to review the linked operational context.</div> : null}
          </aside>
        </div>
      </section>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-summary-row">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function renderReviewActions(input: {
  detail: ComplianceWorkspaceDetailPayload;
  correctedTime: string;
  submittingReview: boolean;
  canReviewAttendanceExceptions: boolean;
  canReviewMissedPunches: boolean;
  onCorrectedTimeChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { detail, correctedTime, submittingReview, canReviewAttendanceExceptions, canReviewMissedPunches, onCorrectedTimeChange, onApprove, onReject } = input;
  if (detail.item.source_kind !== "attendance_exception") {
    return null;
  }
  if (detail.item.issue_type === "no_lunch_challenge") {
    if (!canReviewAttendanceExceptions) {
      return null;
    }
    return (
      <div className="compliance-review-actions">
        <div className="muted">This challenge uses the existing attendance exception approval path.</div>
        <div className="preview-detail-panel__actions">
          <button className="secondary-button" type="button" disabled={submittingReview} onClick={onReject}>
            Reject Challenge
          </button>
          <button className="primary-button" type="button" disabled={submittingReview} onClick={onApprove}>
            Approve Challenge
          </button>
        </div>
      </div>
    );
  }
  if (detail.item.issue_type === "missed_clock_in_request") {
    if (!canReviewMissedPunches) {
      return null;
    }
    return (
      <div className="compliance-review-actions">
        <label className="filter-field">
          <span>Corrected clock-in time</span>
          <input value={correctedTime} onChange={(event) => onCorrectedTimeChange(event.target.value)} />
        </label>
        <div className="preview-detail-panel__actions">
          <button className="secondary-button" type="button" disabled={submittingReview} onClick={onReject}>
            Reject Request
          </button>
          <button className="primary-button" type="button" disabled={submittingReview || !correctedTime} onClick={onApprove}>
            Approve Request
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function buildGroups(rows: ComplianceWorkspaceItem[], groupBy: GroupBy) {
  const grouped = new Map<string, { key: string; label: string; items: ComplianceWorkspaceItem[] }>();
  for (const row of rows) {
    const group = getGroupKey(row, groupBy);
    if (!grouped.has(group.key)) {
      grouped.set(group.key, { key: group.key, label: group.label, items: [] });
    }
    grouped.get(group.key)?.items.push(row);
  }
  return [...grouped.values()];
}

function getGroupKey(row: ComplianceWorkspaceItem, groupBy: GroupBy) {
  if (groupBy === "blocker") {
    return { key: row.blocker.state, label: row.blocker.label };
  }
  if (groupBy === "urgency") {
    return { key: row.urgency, label: humanizeLabel(row.urgency) };
  }
  if (groupBy === "issue_type") {
    return { key: row.issue_type, label: row.issue_label };
  }
  if (groupBy === "employee") {
    return { key: row.employee_id ?? "none", label: row.employee_name ?? "No linked employee" };
  }
  if (groupBy === "shoot") {
    return { key: row.shoot_id ?? "none", label: row.shoot_title ?? row.shoot_code ?? "No linked Shoot" };
  }
  if (groupBy === "organization") {
    return { key: row.organization_id ?? "none", label: row.organization_display_name ?? "No linked Organization" };
  }
  return { key: row.status_bucket, label: humanizeLabel(row.status_bucket) };
}

function getStatusTone(item: ComplianceWorkspaceItem): OperationalPreviewTone {
  if (item.status_bucket === "resolved") {
    return "success";
  }
  switch (item.blocker.state) {
    case "payroll_blocked":
      return "critical";
    case "mileage_blocked":
    case "closeout_blocked":
      return "warning";
    case "presence_review":
      return item.issue_type === "assigned_but_missing" ? "critical" : "warning";
    case "review_required":
      return "info";
    default:
      return item.urgency === "urgent" ? "critical" : item.urgency === "important" ? "warning" : "info";
  }
}

function getHistoryTone(tone: "neutral" | "info" | "warning" | "critical" | "success"): OperationalPreviewTone {
  if (tone === "critical") {
    return "critical";
  }
  if (tone === "warning") {
    return "warning";
  }
  if (tone === "success") {
    return "success";
  }
  if (tone === "info") {
    return "info";
  }
  return "neutral";
}

function buildFlags(item: ComplianceWorkspaceItem) {
  return [
    ...(item.payroll_blocking ? [{ label: "Payroll Blocking", tone: "warning" as const }] : []),
    ...(item.mileage_blocking ? [{ label: "Mileage Blocking", tone: "warning" as const }] : []),
    ...(item.missing_closeout ? [{ label: "Missing Closeout", tone: "info" as const }] : []),
    ...(item.unresolved_end_of_day_confirmation ? [{ label: "End-of-Day Confirmation", tone: "warning" as const }] : []),
    ...(item.blocker.owning_workspace_label ? [{ label: `Fix in ${displayWorkspaceLabel(item.blocker.owning_workspace_label)}`, tone: "info" as const }] : [])
  ];
}

function getNextAction(item: ComplianceWorkspaceItem) {
  if (item.issue_type === "no_lunch_challenge") {
    return "Approve or reject the lunch challenge";
  }
  if (item.issue_type === "missed_clock_in_request") {
    return "Approve or reject the missed clock-in request";
  }
  if (item.issue_type === "likely_present_missing_clock_in") {
    return "Open Attendance and confirm presence context";
  }
  if (item.issue_type === "assigned_but_missing") {
    return "Open Attendance and escalate missing coverage";
  }
  if (item.issue_type === "unresolved_end_of_day_confirmation") {
    return "Open Payroll Review and resolve end-of-day confirmation";
  }
  return `Open ${displayWorkspaceLabel(item.blocker.owning_workspace_label)}`;
}

function displayWorkspaceLabel(label: string) {
  return label === "Compliance" ? "Needs Attention" : label;
}

function displayActionLabel(label: string, hash?: string | null) {
  if (isProjectTrackingWorkflowHash(hash)) {
    return "View in Project Tracking";
  }
  return label
    .replace(/Open Compliance Workspace/g, "Open Needs Attention")
    .replace(/Open Compliance/g, "Open Needs Attention")
    .replace(/Open Attendance$/g, "Open Attendance Review")
    .replace(/Compliance Workspace/g, "Needs Attention")
    .replace(/Compliance/g, "Needs Attention");
}

function resolveComplianceActionHash(hash: string | null | undefined) {
  return resolveWorkSpineActionHref({ actionHash: hash, fallbackKind: "review" });
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
