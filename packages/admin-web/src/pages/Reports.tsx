import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import {
  downloadLeadershipPacketRunPdf,
  runLeadershipDeliverySchedule,
  runLeadershipPacketTemplate,
  runLeadershipSavedView
} from "../services/leadershipReports";
import {
  downloadReportsWorkspaceCsv,
  getReportsWorkspace,
  type ReportsWorkspaceFilters,
  type ReportsWorkspaceHistoryFocus,
  type ReportsWorkspaceResponse
} from "../services/reportsWorkspace";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

const PERIOD_OPTIONS: Array<{ value: ReportsWorkspaceFilters["period"]; label: string }> = [
  { value: "monthly", label: "Last 30 Days" },
  { value: "quarterly", label: "Last 90 Days" },
  { value: "annual", label: "Year To Date" }
];

const HISTORY_SECTION_ID = "reports-history";
const DELIVERY_SECTION_ID = "reports-delivery";

export function Reports({ token, currentUser }: Props) {
  const [filters, setFilters] = useState<ReportsWorkspaceFilters>(() => parseReportsHash());
  const [workspace, setWorkspace] = useState<ReportsWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => {
      setFilters((current) => {
        const next = parseReportsHash();
        return areFiltersEqual(current, next) ? current : next;
      });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const nextHash = buildReportsHash(filters);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getReportsWorkspace(token, filters)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setWorkspace(payload);
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load Reports right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, token]);

  useEffect(() => {
    if (!workspace?.refresh_interval_seconds) {
      return;
    }
    const interval = window.setInterval(() => {
      setRefreshing(true);
      void getReportsWorkspace(token, filters)
        .then((payload) => {
          setWorkspace(payload);
          setError("");
        })
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "We couldn't refresh Reports right now.");
        })
        .finally(() => {
          setRefreshing(false);
        });
    }, workspace.refresh_interval_seconds * 1000);
    return () => window.clearInterval(interval);
  }, [filters, token, workspace?.refresh_interval_seconds]);

  const historyFocusOptions = workspace?.history?.focus_options ?? [];
  const selectedHistoryFocus = workspace?.history?.focus ?? filters.focus ?? "all";
  const operationalModel = workspace?.operational_model;
  const freshness = workspace?.freshness;
  const deliverySummary = workspace?.delivery_summary;
  const savedViews = workspace?.saved_views ?? [];
  const packetTemplates = workspace?.packet_templates ?? [];
  const deliverySchedules = workspace?.delivery_schedules ?? [];
  const recentPacketRuns = workspace?.recent_packet_runs ?? [];
  const exportHistory = workspace?.export_history ?? [];
  const topSummary = operationalModel?.summary_strip ?? [];

  async function refreshNow() {
    setRefreshing(true);
    setError("");
    try {
      const payload = await getReportsWorkspace(token, filters);
      setWorkspace(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't refresh Reports right now.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    setNotice("");
    setError("");
    try {
      await downloadReportsWorkspaceCsv(token, filters);
      setNotice("Reports CSV exported.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "We couldn't export Reports right now.");
    } finally {
      setExporting(false);
    }
  }

  async function handleRunSavedView(savedViewId: string) {
    setRunningId(savedViewId);
    setNotice("");
    setError("");
    try {
      const run = await runLeadershipSavedView(token, savedViewId, {
        anchor_date: filters.date,
        channel: null
      });
      setNotice(`Saved view packet ready: ${run.run_label}`);
      await refreshNow();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "We couldn't run that saved view.");
    } finally {
      setRunningId("");
    }
  }

  async function handleRunPacketTemplate(templateId: string) {
    setRunningId(templateId);
    setNotice("");
    setError("");
    try {
      const run = await runLeadershipPacketTemplate(token, templateId, {
        anchor_date: filters.date,
        channel: null
      });
      setNotice(`Packet ready: ${run.run_label}`);
      await refreshNow();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "We couldn't run that packet template.");
    } finally {
      setRunningId("");
    }
  }

  async function handleRunSchedule(scheduleId: string) {
    setRunningId(scheduleId);
    setNotice("");
    setError("");
    try {
      const run = await runLeadershipDeliverySchedule(token, scheduleId);
      setNotice(`Recurring delivery ran: ${run.run_label}`);
      await refreshNow();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "We couldn't run that schedule.");
    } finally {
      setRunningId("");
    }
  }

  async function handleDownloadPacketRun(packetRunId: string) {
    setRunningId(packetRunId);
    setNotice("");
    setError("");
    try {
      await downloadLeadershipPacketRunPdf(token, packetRunId);
      setNotice("Packet PDF downloaded.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "We couldn't download that packet PDF.");
    } finally {
      setRunningId("");
    }
  }

  async function handleCopySavedViewLink(shareHash: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${shareHash}`);
      setNotice("Saved view link copied.");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "We couldn't copy that saved view link.");
    }
  }

  function setHistoryFocus(focus: ReportsWorkspaceHistoryFocus) {
    setFilters((current) => ({ ...current, focus }));
    scrollToSection(HISTORY_SECTION_ID);
  }

  return (
    <>
      <WorkspacePageHeader
        eyebrow="Reports"
        title="Trend, Performance, And Audit"
        summary="Reports is the calm leadership and manager lens on drift, bottlenecks, and confidence. Live firefighting stays in Home and Operations."
        meta={
          workspace
            ? [
                { label: `Updated ${formatCompactDateTime(workspace.generated_at)}`, tone: "info" },
                { label: operationalModel?.period_label ?? "Reporting window pending" }
              ]
            : [{ label: `Viewer: ${currentUser.fullName}` }]
        }
        compact
      />

      <WorkspaceFilterToolbar>
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Period</span>
            <select
              value={filters.period}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  period: event.target.value as ReportsWorkspaceFilters["period"]
                }))
              }
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Anchor</span>
            <input
              type="date"
              value={filters.date}
              onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Department</span>
            <select
              value={filters.department ?? "all"}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  department: event.target.value === "all" ? null : event.target.value
                }))
              }
            >
              <option value="all">All Departments</option>
              <option value="executive">Executive</option>
              <option value="operations">Operations</option>
              <option value="schools">Schools</option>
              <option value="sports">Sports</option>
              <option value="office">Office</option>
              <option value="production">Production</option>
              <option value="customer_service">Customer Service</option>
            </select>
          </label>
        </div>
        <div className="workspace-toolbar__actions reports-workspace-actions">
          <button className="secondary-button" type="button" onClick={() => void handleExportCsv()} disabled={exporting}>
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
          <button className="secondary-button" type="button" onClick={() => scrollToSection(DELIVERY_SECTION_ID)}>
            Delivery Tools
          </button>
          <button className="secondary-button" type="button" onClick={() => scrollToSection(HISTORY_SECTION_ID)}>
            History
          </button>
          <button className="secondary-button" type="button" onClick={() => void refreshNow()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </WorkspaceFilterToolbar>

      {notice ? <div className="feedback-strip feedback-strip--success">{notice}</div> : null}
      {error ? <div className="feedback-strip feedback-strip--warning">{error}</div> : null}

      {loading && !workspace ? (
        <WorkspaceLoadingBlock
          title="Loading Reports"
          summary="Pulling trend, performance, audit, and delivery reporting into one reporting workspace."
        />
      ) : null}

      {workspace || !loading ? (
        <>
          <section className="panel reports-freshness-panel">
            <WorkspaceSectionHeader
              title="Freshness"
              summary={
                freshness?.summary_line ??
                "Reports is server-backed and intentionally slower than live control surfaces. Freshness appears when the workspace loads."
              }
            />
            <div className="reports-freshness-grid">
              {(freshness?.sources ?? []).map((source) => (
                <article key={source.id} className="reports-freshness-card">
                  <div className="eyebrow">{source.label}</div>
                  <strong>{source.updated_at ? formatRelativeFreshness(source.updated_at) : "No recent update"}</strong>
                  <p>{source.detail}</p>
                  <span className={`ops-preview-chip ops-preview-chip--${toneToPreviewTone(source.tone)}`}>
                    {source.updated_at ? formatTimestamp(source.updated_at) : "Pending"}
                  </span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel dashboard-panel">
            <WorkspaceSectionHeader
              title="Top Summary Strip"
              summary={
                workspace
                  ? `${operationalModel?.period_label ?? "Current"} view of recurring risk, drift, and confidence.`
                  : "Loading reporting summary."
              }
            />
            <section className="metrics-grid metrics-grid--compact">
              {topSummary.map((metric) => (
                <article key={metric.id} className="stat-card panel">
                  <div className="eyebrow">{metric.label}</div>
                  <strong>{metric.value}</strong>
                  <span className="muted">{metric.detail}</span>
                </article>
              ))}
              {!loading && !topSummary.length ? (
                <div className="empty-state empty-state--panel">No reporting summary metrics are available yet.</div>
              ) : null}
            </section>
          </section>
        </>
      ) : null}

      <section className="reports-workspace-layout">
        <div className="reports-workspace-stack">
          <TrendBlock
            title="Exceptions / Risk Trends"
            summary={operationalModel?.watch.summary_line ?? "Loading exception trends."}
            primaryActionHash={operationalModel?.watch.action_hash ?? "#operations/exceptions"}
            metrics={[
              {
                label: "Red Breaches",
                value: operationalModel?.watch.red_breaches ?? 0,
                detail: operationalModel?.watch.average_resolution_label ?? "No resolution history yet"
              }
            ]}
            trend={operationalModel?.watch.trend ?? []}
            detailSection={
              <OperationalDetailSection
                title="Outlier Drivers"
                summary="Recurring overdue types and reason-code patterns worth investigating, not live queue execution."
                defaultOpen={Boolean(filters.focus === "watch")}
                actions={
                  <button type="button" className="secondary-button" onClick={() => setHistoryFocus("watch")}>
                    Investigate History
                  </button>
                }
              >
                <div className="reports-signal-grid">
                  {(operationalModel?.watch.overdue_count_by_type ?? []).map((item) => (
                    <OperationalPreviewCard
                      key={item.watch_type}
                      title={item.label}
                      summary={`${item.count} overdue signal${item.count === 1 ? "" : "s"} in range.`}
                      density="compact"
                    />
                  ))}
                  {(operationalModel?.watch.reason_code_trends ?? []).map((item) => (
                    <OperationalPreviewCard
                      key={item.reason_code}
                      title={item.label}
                      summary={`${item.count} recurring reason-code hit${item.count === 1 ? "" : "s"} in range.`}
                      density="compact"
                    />
                  ))}
                </div>
              </OperationalDetailSection>
            }
          />

          <TrendBlock
            title="Attendance / Staffing Trends"
            summary={operationalModel?.attendance.summary_line ?? "Loading attendance and staffing drift."}
            primaryActionHash={operationalModel?.attendance.action_hash ?? "#operations/attendance"}
            metrics={[
              {
                label: "On-Time",
                value: formatPercent(operationalModel?.attendance.on_time_rate ?? 0),
                detail: `${operationalModel?.attendance.tracked_assignments ?? 0} tracked assignments`
              },
              {
                label: "Staffing Incidents",
                value: operationalModel?.attendance.staffing_incidents_driven_by_attendance ?? 0,
                detail: operationalModel?.attendance.average_resolution_label ?? "No resolution history yet"
              }
            ]}
            trend={operationalModel?.attendance.trend ?? []}
            detailSection={
              <OperationalDetailSection
                title="Rate View"
                summary="Attendance drift is useful here because it shows recurrence and staffing burden over time."
                defaultOpen={Boolean(filters.focus === "staffing" || filters.focus === "attendance")}
                actions={
                  <button type="button" className="secondary-button" onClick={() => setHistoryFocus("attendance")}>
                    Investigate History
                  </button>
                }
              >
                <section className="metrics-grid metrics-grid--compact">
                  <article className="stat-card panel">
                    <div className="eyebrow">Late Rate</div>
                    <strong>{formatPercent(operationalModel?.attendance.late_rate ?? 0)}</strong>
                  </article>
                  <article className="stat-card panel">
                    <div className="eyebrow">No-Show Rate</div>
                    <strong>{formatPercent(operationalModel?.attendance.no_show_rate ?? 0)}</strong>
                  </article>
                  <article className="stat-card panel">
                    <div className="eyebrow">Callout Rate</div>
                    <strong>{formatPercent(operationalModel?.attendance.callout_rate ?? 0)}</strong>
                  </article>
                </section>
              </OperationalDetailSection>
            }
          />

          <section className="reports-split-blocks">
            <TrendBlock
              title="Production Trends"
              summary={operationalModel?.production.summary_line ?? "Loading production drift."}
              primaryActionHash={operationalModel?.production.action_hash ?? "#production"}
              metrics={[
                {
                  label: "Overdue Tasks",
                  value: operationalModel?.production.overdue_tasks ?? 0,
                  detail: operationalModel?.production.average_turnaround_label ?? "No turnaround history yet"
                },
                {
                  label: "Review / QC",
                  value: `${operationalModel?.production.peer_review_backlog ?? 0} / ${operationalModel?.production.qc_backlog ?? 0}`,
                  detail: "Peer review backlog / final QC backlog"
                }
              ]}
              trend={operationalModel?.production.trend ?? []}
              compact
              detailSection={
                <OperationalDetailSection
                  title="Blocked And Rework Signals"
                  summary="Use this to see recurring drag, then jump into Production for actual work."
                  defaultOpen={Boolean(filters.focus === "production")}
                  actions={
                    <button type="button" className="secondary-button" onClick={() => setHistoryFocus("production")}>
                      Investigate History
                    </button>
                  }
                >
                  <div className="reports-signal-grid">
                    {(operationalModel?.production.blocked_reasons ?? []).map((item) => (
                      <OperationalPreviewCard
                        key={item.blocker_type}
                        title={item.label}
                        summary={`${item.count} blocker${item.count === 1 ? "" : "s"} in range.`}
                        density="compact"
                      />
                    ))}
                  </div>
                  <section className="metrics-grid metrics-grid--compact">
                    <article className="stat-card panel">
                      <div className="eyebrow">Rework Rate</div>
                      <strong>{formatPercent(operationalModel?.production.rework_rate ?? 0)}</strong>
                    </article>
                    <article className="stat-card panel">
                      <div className="eyebrow">Send Back Rate</div>
                      <strong>{formatPercent(operationalModel?.production.send_back_rate ?? 0)}</strong>
                    </article>
                  </section>
                </OperationalDetailSection>
              }
            />

            <TrendBlock
              title="Approval Trends"
              summary={operationalModel?.approvals.summary_line ?? "Loading approval drift."}
              primaryActionHash={operationalModel?.approvals.action_hash ?? "#approvals"}
              metrics={[
                {
                  label: "Overdue",
                  value: operationalModel?.approvals.overdue_count ?? 0,
                  detail: `${operationalModel?.approvals.escalation_count ?? 0} escalated`
                },
                {
                  label: "Decision Time",
                  value: operationalModel?.approvals.average_decision_label ?? "No decision history yet",
                  detail: "Average time to decision"
                }
              ]}
              trend={operationalModel?.approvals.trend ?? []}
              compact
              detailSection={
                <OperationalDetailSection
                  title="Approval Aging"
                  summary="Keep approval decisions in Approvals. Use Reports for pattern detection and drift."
                  defaultOpen={Boolean(filters.focus === "approvals")}
                  actions={
                    <button type="button" className="secondary-button" onClick={() => setHistoryFocus("approvals")}>
                      Investigate History
                    </button>
                  }
                >
                  <div className="reports-signal-grid">
                    {(operationalModel?.approvals.volume_by_type ?? []).map((item) => (
                      <OperationalPreviewCard
                        key={item.request_type}
                        title={item.label}
                        summary={`${item.count} request${item.count === 1 ? "" : "s"} in range.`}
                        density="compact"
                      />
                    ))}
                  </div>
                  <section className="metrics-grid metrics-grid--compact">
                    <article className="stat-card panel">
                      <div className="eyebrow">Rejection Rate</div>
                      <strong>{formatPercent(operationalModel?.approvals.rejection_rate ?? 0)}</strong>
                    </article>
                    <article className="stat-card panel">
                      <div className="eyebrow">Send Back Rate</div>
                      <strong>{formatPercent(operationalModel?.approvals.send_back_rate ?? 0)}</strong>
                    </article>
                  </section>
                </OperationalDetailSection>
              }
            />
          </section>

          <section id={DELIVERY_SECTION_ID} className="panel dashboard-panel">
            <WorkspaceSectionHeader
              title="Saved Views, Packets, And Exports"
              summary="Delivery and export tooling stays here because Reports owns repeatable reporting outputs, not because the page should become a packet builder maze."
            />

            <section className="metrics-grid metrics-grid--compact">
              <article className="stat-card panel">
                <div className="eyebrow">Saved Views</div>
                <strong>{deliverySummary?.saved_view_count ?? 0}</strong>
              </article>
              <article className="stat-card panel">
                <div className="eyebrow">Packet Templates</div>
                <strong>{deliverySummary?.packet_template_count ?? 0}</strong>
              </article>
              <article className="stat-card panel">
                <div className="eyebrow">Active Schedules</div>
                <strong>{deliverySummary?.active_schedule_count ?? 0}</strong>
              </article>
              <article className="stat-card panel">
                <div className="eyebrow">Failed Exports</div>
                <strong>{deliverySummary?.failed_export_count ?? 0}</strong>
              </article>
            </section>

            <div className="reports-delivery-grid">
              <OperationalDetailSection title="Saved Views" summary="Shared reporting entry points that can be run or copied without rebuilding filters." defaultOpen>
                <div className="ops-preview-list">
                  {savedViews.map((item) => (
                    <OperationalPreviewCard
                      key={item.id}
                      eyebrow={humanizeWindow(item.window)}
                      title={item.label}
                      summary={item.summary}
                      meta={[
                        { label: item.visibility.replace(/_/g, " "), tone: "neutral" },
                        ...(item.department ? [{ label: humanizeDepartment(item.department), tone: "info" as const }] : [])
                      ]}
                      nextAction="Run or share this view"
                      density="compact"
                      actions={[
                        {
                          label: runningId === item.id ? "Running..." : "Run",
                          onClick: () => {
                            void handleRunSavedView(item.id);
                          }
                        },
                        {
                          label: "Copy Link",
                          onClick: () => {
                            void handleCopySavedViewLink(item.share_hash);
                          }
                        }
                      ]}
                    />
                  ))}
                  {!loading && !savedViews.length ? (
                    <div className="empty-state empty-state--panel">No saved reporting views exist yet.</div>
                  ) : null}
                </div>
              </OperationalDetailSection>

              <OperationalDetailSection title="Packet Templates" summary="Repeatable report packets for leadership reviews and recurring delivery." defaultOpen>
                <div className="ops-preview-list">
                  {packetTemplates.map((item) => (
                    <OperationalPreviewCard
                      key={item.id}
                      eyebrow={humanizeWindow(item.default_window)}
                      title={item.name}
                      summary={item.description ?? item.audience}
                      meta={[{ label: item.visibility.replace(/_/g, " "), tone: "neutral" }]}
                      nextAction="Run packet"
                      density="compact"
                      actions={[
                        {
                          label: runningId === item.id ? "Running..." : "Run Packet",
                          onClick: () => {
                            void handleRunPacketTemplate(item.id);
                          }
                        }
                      ]}
                    />
                  ))}
                </div>
              </OperationalDetailSection>

              <OperationalDetailSection title="Recurring Delivery" summary="Schedules belong here because they are report distribution controls, not operational work." defaultOpen>
                <div className="ops-preview-list">
                  {deliverySchedules.map((item) => (
                    <OperationalPreviewCard
                      key={item.id}
                      eyebrow={humanizeValue(item.cadence)}
                      title={item.label}
                      summary={item.last_error ?? item.last_status ?? "No recent delivery status."}
                      statusLabel={item.active_status ? "Active" : "Paused"}
                      statusTone={item.last_error ? "critical" : item.active_status ? "success" : "warning"}
                      meta={[
                        { label: humanizeValue(item.delivery_channel), tone: "neutral" },
                        ...(item.next_run_at ? [{ label: `Next ${formatCompactDateTime(item.next_run_at)}`, tone: "info" as const }] : [])
                      ]}
                      nextAction={item.template_name ?? item.saved_view_name ?? "Review schedule source"}
                      density="compact"
                      actions={[
                        {
                          label: runningId === item.id ? "Running..." : "Run Now",
                          onClick: () => {
                            void handleRunSchedule(item.id);
                          }
                        }
                      ]}
                    />
                  ))}
                </div>
              </OperationalDetailSection>
            </div>

            <div className="reports-delivery-grid reports-delivery-grid--secondary">
              <OperationalDetailSection title="Packet History" summary="Recent generated packets, with PDF access when available.">
                <div className="ops-preview-list">
                  {recentPacketRuns.map((item) => (
                    <OperationalPreviewCard
                      key={item.id}
                      eyebrow={humanizeValue(item.source_type)}
                      title={item.run_label}
                      summary={item.template_name ?? item.saved_view_name ?? "Generated packet"}
                      statusLabel={humanizeValue(item.status)}
                      statusTone={item.status === "failed" ? "critical" : "success"}
                      meta={[{ label: formatCompactDateTime(item.created_at), tone: "neutral" }]}
                      nextAction={item.pdf_available ? "Download packet PDF" : "Review packet run"}
                      density="compact"
                      actions={
                        item.pdf_available
                          ? [
                              {
                                label: runningId === item.id ? "Downloading..." : "Download PDF",
                                onClick: () => {
                                  void handleDownloadPacketRun(item.id);
                                }
                              }
                            ]
                          : []
                      }
                    />
                  ))}
                </div>
              </OperationalDetailSection>

              <OperationalDetailSection title="Export History" summary="Recent reporting exports, so failed or stale export behavior is obvious.">
                <div className="ops-preview-list">
                  {exportHistory.map((item) => (
                    <OperationalPreviewCard
                      key={item.id}
                      eyebrow={item.format.toUpperCase()}
                      title={item.export_name}
                      summary={item.requested_by_name ? `Requested by ${item.requested_by_name}` : "Requested by system"}
                      statusLabel={humanizeValue(item.status)}
                      statusTone={item.status === "failed" ? "critical" : item.status === "completed" ? "success" : "warning"}
                      meta={[{ label: formatCompactDateTime(item.requested_at), tone: "neutral" }]}
                      nextAction={item.record_count != null ? `${item.record_count} rows included` : "Record count pending"}
                      density="compact"
                    />
                  ))}
                </div>
              </OperationalDetailSection>
            </div>
          </section>

          <section id={HISTORY_SECTION_ID} className="panel dashboard-panel">
            <WorkspaceSectionHeader
              title="Audit And History Investigation"
              summary={
                workspace?.history?.summary_line ??
                "Loading workflow, notification, and audit history that can explain recurring drift."
              }
            />

            <div className="reports-history-focuses" role="tablist" aria-label="Reports history focus">
              {historyFocusOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`reports-history-focus${selectedHistoryFocus === option.id ? " is-active" : ""}`}
                  onClick={() => setHistoryFocus(option.id)}
                >
                  {option.label} <span>{option.count}</span>
                </button>
              ))}
            </div>

            <div className="ops-preview-list">
              {(workspace?.history?.items ?? []).map((item) => (
                <OperationalPreviewCard
                  key={item.id}
                  eyebrow={`${item.module_label} | ${item.confidence_label}`}
                  title={item.title}
                  summary={
                    <>
                      <div>{item.summary}</div>
                      {item.note ? <div className="muted">{item.note}</div> : null}
                    </>
                  }
                  owner={item.actor_label}
                  meta={[
                    { label: formatCompactDateTime(item.created_at), tone: "neutral" },
                    ...item.chips.map((chip) => ({ label: chip.label, tone: chip.tone ?? "neutral" }))
                  ]}
                  nextAction="Open owning workspace"
                  density="compact"
                  actions={[
                    {
                      label: "Open",
                      onClick: () => {
                        window.location.hash = item.action_hash;
                      }
                    }
                  ]}
                />
              ))}
              {!loading && !(workspace?.history?.items ?? []).length ? (
                <div className="empty-state empty-state--panel">No report-ready history items match this filter right now.</div>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </>
  );
}

type TrendBlockProps = {
  title: string;
  summary: string;
  primaryActionHash: string;
  metrics: Array<{ label: string; value: string | number; detail: string }>;
  trend: ReportsWorkspaceResponse["operational_model"]["watch"]["trend"];
  detailSection: ReactNode;
  compact?: boolean;
};

function TrendBlock({ title, summary, primaryActionHash, metrics, trend, detailSection, compact = false }: TrendBlockProps) {
  return (
    <section className={`panel dashboard-panel${compact ? " dashboard-panel--compact" : ""}`}>
      <WorkspaceSectionHeader
        title={title}
        summary={summary}
        actions={
          <WorkspaceActionBar compact>
          <a className="secondary-button" href={primaryActionHash}>
            Open Owner Workspace
          </a>
          </WorkspaceActionBar>
        }
      />

      <section className="metrics-grid metrics-grid--compact">
        {metrics.map((metric) => (
          <article key={metric.label} className="stat-card panel">
            <div className="eyebrow">{metric.label}</div>
            <strong>{metric.value}</strong>
            <span className="muted">{metric.detail}</span>
          </article>
        ))}
      </section>

      <OperationalDetailSection title="Trend Comparison" summary="Compare buckets, then use the owner workspace for the actual records and actions." defaultOpen>
        <TrendTable trend={trend} />
      </OperationalDetailSection>

      {detailSection}
    </section>
  );
}

function TrendTable({ trend }: { trend: ReportsWorkspaceResponse["operational_model"]["watch"]["trend"] }) {
  if (!trend.length) {
    return <div className="empty-state empty-state--panel">No trend buckets are available in this period yet.</div>;
  }
  const metricLabels = trend[0]?.metrics.map((metric) => metric.label) ?? [];
  return (
    <div className="reports-trend-table">
      <div className="reports-trend-table__row reports-trend-table__row--header">
        <span>Bucket</span>
        {metricLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {trend.map((point) => (
        <div key={point.bucket.key} className="reports-trend-table__row">
          <strong>{point.bucket.label}</strong>
          {point.metrics.map((metric) => (
            <span key={`${point.bucket.key}-${metric.key}`}>{metric.value}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function parseReportsHash(): ReportsWorkspaceFilters {
  const raw = window.location.hash.replace(/^#/, "");
  const [path, queryString = ""] = raw.split("?");
  const params = new URLSearchParams(queryString);
  return {
    date: params.get("date") ?? getLocalDateString(),
    period: parsePeriod(params.get("period")),
    department: params.get("department"),
    focus: parseFocus(params.get("focus") ?? inferFocusFromPath(path))
  };
}

function buildReportsHash(filters: ReportsWorkspaceFilters) {
  const params = new URLSearchParams();
  params.set("date", filters.date);
  params.set("period", filters.period);
  if (filters.department) {
    params.set("department", filters.department);
  }
  if (filters.focus && filters.focus !== "all") {
    params.set("focus", filters.focus);
  }
  const query = params.toString();
  return query ? `#reports?${query}` : "#reports";
}

function parsePeriod(value: string | null): ReportsWorkspaceFilters["period"] {
  if (value === "quarterly" || value === "annual") {
    return value;
  }
  return "monthly";
}

function parseFocus(value: string | null): ReportsWorkspaceHistoryFocus {
  switch (value) {
    case "watch":
    case "staffing":
    case "attendance":
    case "production":
    case "approvals":
    case "notifications":
    case "audit":
      return value;
    default:
      return "all";
  }
}

function inferFocusFromPath(path: string) {
  if (path === "reports/operations" || path === "reports/trends") {
    return "watch";
  }
  if (path === "reports/executive") {
    return "all";
  }
  return null;
}

function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (element && typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toneToPreviewTone(value: ReportsWorkspaceResponse["freshness"]["sources"][number]["tone"]) {
  if (value === "action_needed") return "critical";
  if (value === "heads_up") return "warning";
  if (value === "good") return "success";
  if (value === "info") return "info";
  return "neutral";
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatRelativeFreshness(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatCompactDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function humanizeWindow(value: string) {
  return humanizeValue(value);
}

function humanizeDepartment(value: string) {
  return humanizeValue(value);
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getLocalDateString() {
  return new Date().toISOString().slice(0, 10);
}

function areFiltersEqual(left: ReportsWorkspaceFilters, right: ReportsWorkspaceFilters) {
  return (
    left.date === right.date &&
    left.period === right.period &&
    (left.department ?? null) === (right.department ?? null) &&
    (left.focus ?? "all") === (right.focus ?? "all")
  );
}
