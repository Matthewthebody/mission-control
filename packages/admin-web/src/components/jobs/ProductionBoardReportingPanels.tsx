import type { ReactNode } from "react";
import { StatusPill, formatDate, humanizeToken } from "../sports/SportsPrimitives";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import type {
  SharedProductionItem,
  SharedProductionOwnerBacklogItem,
  SharedProductionQueueItem,
  SharedProductionReportingResponse
} from "../../jobTruthTypes";

type ProductionBoardReportingPanelProps = {
  reporting: SharedProductionReportingResponse | null;
  loading: boolean;
  error?: string;
  onOpenItem: (itemId: string) => void;
};

type DepartmentProductionReportingStripProps = {
  reporting: SharedProductionReportingResponse | null;
  loading: boolean;
};

function toneClass(tone: "success" | "warning" | "danger" | "info" | "neutral") {
  return tone;
}

function renderCard(title: string, value: string | number, detail: string, tone: "success" | "warning" | "danger" | "info" | "neutral" = "neutral") {
  return (
    <section className={`shared-job-prod__summary-card tone-${toneClass(tone)}`}>
      <WorkspaceSectionHeader title={title} compact />
      <div className="shared-job-prod__summary-value">{value}</div>
      <div className="shared-job-prod__summary-detail">{detail}</div>
    </section>
  );
}

function healthTone(item: Pick<SharedProductionItem, "health_state" | "overdue_flag">) {
  if (item.health_state === "BLOCKED" || item.health_state === "OVERDUE" || item.overdue_flag) {
    return "danger";
  }
  if (item.health_state === "AT_RISK" || item.health_state === "WATCH") {
    return "warning";
  }
  return "success";
}

function renderQueueList(items: SharedProductionQueueItem[], emptyTitle: string, onOpenItem: (itemId: string) => void) {
  if (!items.length) {
    return <WorkspaceEmptyState title={emptyTitle} summary="Nothing in this management slice right now." compact />;
  }
  return (
    <div className="shared-job-prod__report-list">
      {items.slice(0, 6).map((item) => (
        <button key={item.id} type="button" className={`shared-job-prod__report-row tone-${healthTone(item)}`} onClick={() => onOpenItem(item.id)}>
          <div className="shared-job-prod__report-row-main">
            <strong>{item.title}</strong>
            <span>
              {item.organization_name ?? "Unknown organization"} | {humanizeToken(item.production_type)}
            </span>
          </div>
          <div className="shared-job-prod__report-row-meta">
            <StatusPill label={humanizeToken(item.workflow_status)} tone={healthTone(item) as any} />
            <span>{item.due_at ? `Due ${formatDate(item.due_at)}` : "No due date"}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function renderBacklogTable(items: SharedProductionOwnerBacklogItem[], emptyTitle: string, metricLabel: string) {
  if (!items.length) {
    return <WorkspaceEmptyState title={emptyTitle} summary="No active production load to summarize." compact />;
  }
  return (
    <div className="shared-job-prod__report-table">
      {items.slice(0, 8).map((item) => (
        <div key={`${item.owner_user_id ?? "unassigned"}-${item.load_score}`} className="shared-job-prod__report-table-row">
          <div>
            <strong>{item.owner_name}</strong>
            <span>
              {item.blocked_count} blocked | {item.overdue_count} overdue | {item.ready_for_release_count} ready for release
            </span>
          </div>
          <div className="shared-job-prod__report-table-metric">
            <strong>{item.open_count}</strong>
            <span>{metricLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderInsightList(items: Array<{ key: string; title: string; detail: string; metric: string | number; tone?: "success" | "warning" | "danger" | "info" | "neutral" }>, emptyTitle: string) {
  if (!items.length) {
    return <WorkspaceEmptyState title={emptyTitle} summary="No notable production outliers in this slice right now." compact />;
  }
  return (
    <div className="shared-job-prod__report-table">
      {items.map((item) => (
        <div key={item.key} className={`shared-job-prod__report-table-row tone-${toneClass(item.tone ?? "neutral")}`}>
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
          <div className="shared-job-prod__report-table-metric">
            <strong>{item.metric}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderTrendTable(
  items: SharedProductionReportingResponse["trends"]["by_week"],
  emptyTitle: string
) {
  if (!items.length) {
    return <WorkspaceEmptyState title={emptyTitle} summary="No trend data has accumulated yet." compact />;
  }
  return (
    <div className="shared-job-prod__report-table">
      {items.slice(-6).reverse().map((bucket) => (
        <div key={bucket.key} className="shared-job-prod__report-table-row">
          <div>
            <strong>{bucket.label}</strong>
            <span>
              {bucket.completions} completed | {bucket.releases} released | {bucket.rework} rework
            </span>
          </div>
          <div className="shared-job-prod__report-table-metric">
            <strong>{bucket.overdue + bucket.blocked}</strong>
            <span>risk events</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel shared-job-prod__report-panel">
      <WorkspaceSectionHeader title={title} compact />
      {children}
    </section>
  );
}

export function DepartmentProductionReportingStrip({ reporting, loading }: DepartmentProductionReportingStripProps) {
  if (loading) {
    return (
      <div className="shared-job-prod__metric-grid">
        <WorkspaceLoadingBlock title="Loading production metrics" summary="Refreshing department production reporting." />
      </div>
    );
  }
  if (!reporting) {
    return null;
  }

  return (
    <div className="shared-job-prod__metric-grid">
      {renderCard("Due This Week", reporting.summary.due_this_week, `${reporting.summary.total_open_items} open items in scope.`, reporting.summary.due_this_week ? "warning" : "success")}
      {renderCard(
        "On-Time Release",
        reporting.summary.on_time_release_percentage != null ? `${reporting.summary.on_time_release_percentage}%` : "N/A",
        "Release timeliness across completed Production items.",
        reporting.summary.on_time_release_percentage != null && reporting.summary.on_time_release_percentage < 90 ? "warning" : "success"
      )}
      {renderCard(
        "Rework Rate",
        `${reporting.summary.rework_rate}%`,
        `${reporting.summary.first_pass_approval_rate ?? 0}% first-pass approval.`,
        reporting.summary.rework_rate >= 20 ? "warning" : "success"
      )}
      {renderCard(
        "Avg Turnaround",
        reporting.summary.average_turnaround_days != null ? `${reporting.summary.average_turnaround_days}d` : "N/A",
        `${reporting.summary.blocked_items} blocked | ${reporting.summary.overdue_items} overdue`,
        reporting.summary.overdue_items ? "danger" : "info"
      )}
    </div>
  );
}

export function ProductionBoardReportingPanel({ reporting, loading, error, onOpenItem }: ProductionBoardReportingPanelProps) {
  if (loading) {
    return <WorkspaceLoadingBlock title="Loading production reporting" summary="Refreshing management metrics, queues, and trend snapshots." />;
  }
  if (error) {
    return (
      <section className="panel shared-job-prod__report-panel shared-job-prod__report-panel--error">
        <WorkspaceSectionHeader title="Production reporting" compact />
        <div className="shared-job-list__error" role="alert">
          {error}
        </div>
      </section>
    );
  }
  if (!reporting) {
    return <WorkspaceEmptyState title="Production reporting unavailable" summary="The board metrics couldn't be loaded right now." compact />;
  }

  return (
    <div className="shared-job-prod__reporting-stack">
      <section className="shared-job-prod__metric-grid">
        {renderCard(
          "Average Turnaround",
          reporting.summary.average_turnaround_days != null ? `${reporting.summary.average_turnaround_days}d` : "N/A",
          `${reporting.summary.completion_volume_this_week} completed in the last 7 days.`,
          "info"
        )}
        {renderCard(
          "On-Time Release %",
          reporting.summary.on_time_release_percentage != null ? `${reporting.summary.on_time_release_percentage}%` : "N/A",
          `${reporting.summary.ready_for_release_count} items are sitting at release.`,
          reporting.summary.on_time_release_percentage != null && reporting.summary.on_time_release_percentage < 90 ? "warning" : "success"
        )}
        {renderCard(
          "Average Stage Duration",
          reporting.summary.average_stage_duration_days != null ? `${reporting.summary.average_stage_duration_days}d` : "N/A",
          "Average age of current workflow stages across open work.",
          reporting.summary.average_stage_duration_days != null && reporting.summary.average_stage_duration_days >= 5 ? "warning" : "info"
        )}
        {renderCard(
          "Rework Rate",
          `${reporting.summary.rework_rate}%`,
          `${reporting.summary.first_pass_approval_rate ?? 0}% first-pass approval.`,
          reporting.summary.rework_rate >= 20 ? "warning" : "success"
        )}
        {renderCard(
          "File Mismatch Rate",
          `${reporting.summary.file_mismatch_rate}%`,
          `${reporting.urgent_watch.blocked_count} urgent blocked item(s) in watch.`,
          reporting.summary.file_mismatch_rate > 0 ? "warning" : "success"
        )}
        {renderCard(
          "Upload Failure Rate",
          `${reporting.summary.upload_failure_rate}%`,
          `${reporting.summary.awaiting_upload_count} item(s) still waiting to upload.`,
          reporting.summary.upload_failure_rate > 0 ? "danger" : "success"
        )}
        {renderCard(
          "Vendor Turnaround",
          reporting.summary.vendor_turnaround_days != null ? `${reporting.summary.vendor_turnaround_days}d` : "N/A",
          `${reporting.summary.vendor_pending_count} vendor item(s) still pending.`,
          reporting.summary.vendor_pending_count ? "warning" : "info"
        )}
        {renderCard(
          "Exceptions",
          reporting.urgent_watch.total_count,
          `${reporting.urgent_watch.next_24_hours_count} inside the next 24 hours.`,
          reporting.urgent_watch.critical_count ? "danger" : reporting.urgent_watch.high_count ? "warning" : "success"
        )}
      </section>

      <section className="shared-job-prod__report-grid shared-job-prod__report-grid--management">
        <ReportPanel title="Overdue Queue">{renderQueueList(reporting.management.overdue_queue, "No overdue production items", onOpenItem)}</ReportPanel>
        <ReportPanel title="Blocked Queue">{renderQueueList(reporting.management.blocked_queue, "No blocked production items", onOpenItem)}</ReportPanel>
        <ReportPanel title="Management Exceptions">
          {reporting.management.exception_view.length ? (
            <div className="shared-job-prod__report-list">
              {reporting.management.exception_view.slice(0, 6).map((item) => (
                <button key={item.id} type="button" className={`shared-job-prod__report-row tone-${healthTone(item)}`} onClick={() => onOpenItem(item.id)}>
                  <div className="shared-job-prod__report-row-main">
                    <strong>{item.title}</strong>
                    <span>{item.exception_types.map(humanizeToken).join(" | ")}</span>
                  </div>
                  <div className="shared-job-prod__report-row-meta">
                    <StatusPill label={humanizeToken(item.health_state)} tone={healthTone(item) as any} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No management exceptions" summary="No production items are currently flagged into the management exception lane." compact />
          )}
        </ReportPanel>
        <ReportPanel title="Team Workload">{renderBacklogTable(reporting.management.team_workload, "No active workload", "open items")}</ReportPanel>
        <ReportPanel title="QA Performance">
          {reporting.management.qa_performance.length ? (
            <div className="shared-job-prod__report-table">
              {reporting.management.qa_performance.slice(0, 8).map((reviewer) => (
                <div key={`${reviewer.reviewer_user_id ?? "unassigned"}-${reviewer.reviews_completed}`} className="shared-job-prod__report-table-row">
                  <div>
                    <strong>{reviewer.reviewer_name}</strong>
                    <span>
                      {reviewer.send_back_count} send back | {reviewer.accountability_failures} reviewer-linked failures
                    </span>
                  </div>
                  <div className="shared-job-prod__report-table-metric">
                    <strong>{reviewer.reviews_completed}</strong>
                    <span>reviews</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No QA reviews yet" summary="QA performance metrics will appear after review activity lands." compact />
          )}
        </ReportPanel>
      </section>

      <section className="shared-job-prod__report-grid">
        <ReportPanel title="Backlog by Department">
          {renderInsightList(
            reporting.insights.backlog_by_department.map((item) => ({
              key: item.department_type,
              title: humanizeToken(item.department_type),
              detail: `${item.blocked_count} blocked | ${item.overdue_count} overdue | ${item.due_this_week_count} due this week`,
              metric: item.open_count,
              tone: item.overdue_count ? "danger" : item.blocked_count ? "warning" : "info"
            })),
            "No department backlog"
          )}
        </ReportPanel>
        <ReportPanel title="Operational Burden by Account">
          {renderInsightList(
            reporting.insights.operational_burden_by_account.map((item) => ({
              key: `${item.account_owner_user_id ?? "unassigned"}-${item.burden_score}`,
              title: item.account_owner_name,
              detail: `${item.blocked_count} blocked | ${item.overdue_count} overdue | ${item.at_risk_count} at risk`,
              metric: item.burden_score,
              tone: item.overdue_count ? "danger" : item.blocked_count ? "warning" : "info"
            })),
            "No account burden signals"
          )}
        </ReportPanel>
        <ReportPanel title="QA Failure Categories">
          {renderInsightList(
            reporting.insights.qa_failure_categories.map((item) => ({
              key: item.category,
              title: item.label,
              detail: "Recurring QA send-back category in the current reporting window.",
              metric: item.count,
              tone: item.count >= 3 ? "warning" : "info"
            })),
            "No QA failure categories"
          )}
        </ReportPanel>
        <ReportPanel title="Repeat-Problem Organizations">
          {renderInsightList(
            reporting.insights.repeat_problem_organizations.map((item) => ({
              key: item.organization_id ?? item.organization_name,
              title: item.organization_name,
              detail: `${item.blocked_count} blocked | ${item.overdue_count} overdue | ${item.file_mismatch_count} file mismatch`,
              metric: item.risk_score,
              tone: item.overdue_count ? "danger" : item.blocked_count ? "warning" : "info"
            })),
            "No repeat-problem organizations"
          )}
        </ReportPanel>
        <ReportPanel title="Post-Shoot Delay Signals">
          {renderInsightList(
            reporting.insights.post_shoot_eval_delay_signals.map((item) => ({
              key: item.production_item_id,
              title: item.title,
              detail: `${item.organization_name ?? "Unknown organization"} | ${item.post_shoot_eval_summary}`,
              metric: `${item.delay_days}d`,
              tone: item.delay_days >= 3 ? "warning" : "info"
            })),
            "No delay signals tied to post-shoot evaluations"
          )}
        </ReportPanel>
        <ReportPanel title="Top Performers">
          {renderInsightList(
            reporting.insights.top_performers.map((item) => ({
              key: `${item.owner_user_id ?? "unassigned"}-${item.performance_score}`,
              title: item.owner_name,
              detail: `${item.items_completed} completed | ${item.average_turnaround_days ?? "N/A"} day avg turnaround`,
              metric: item.performance_score,
              tone: item.performance_score >= 90 ? "success" : item.performance_score >= 75 ? "info" : "warning"
            })),
            "No completed work yet"
          )}
        </ReportPanel>
        <ReportPanel title="Weekly Trend">{renderTrendTable(reporting.trends.by_week, "No weekly trend data")}</ReportPanel>
      </section>

      {reporting.restricted_overlays?.length ? (
        <section className="shared-job-prod__report-grid">
          {reporting.restricted_overlays.map((overlay) => (
            <ReportPanel key={overlay.key} title={overlay.title}>
              <div className={`shared-job-prod__overlay tone-${toneClass(overlay.tone)}`}>
                <div className="shared-job-prod__overlay-metric">{overlay.metric}</div>
                <p>{overlay.summary}</p>
                <span>{overlay.detail}</span>
                <StatusPill label={overlay.availability === "live" ? "Live" : "Scaffolded"} tone={overlay.availability === "live" ? "success" : "info"} />
              </div>
            </ReportPanel>
          ))}
        </section>
      ) : null}
    </div>
  );
}
