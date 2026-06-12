import { useEffect, useState } from "react";
import type {
  SharedAlertCenterResponse,
  SharedAlertFeedItem,
  SharedDashboardResponse,
  SharedDashboardWidgetPreference,
  SharedDashboardWidgetSummary,
  SharedJobWatchFlag,
  SharedWatchFlagListItem,
  SharedWatchlistQuery,
  SharedWatchlistResponse
} from "../../jobTruthTypes";
import {
  acknowledgeSharedWatchFlag,
  dismissSharedWatchFlag,
  escalateSharedWatchFlag,
  getSharedDashboard,
  listSharedAlerts,
  listSharedDashboardWidgetPreferences,
  listSharedExceptions,
  markSharedAlertActed,
  markSharedAlertRead,
  resolveSharedWatchFlag,
  saveSharedDashboardWidgetPreferences,
  snoozeSharedWatchFlag
} from "../../services/jobsApi";
import { listDirectoryOwnerOptions } from "../../services/organizationApi";
import type { DirectoryOwnerOption, SessionUser } from "../../types";
import {
  applyHomeWidgetDraft,
  buildHomeWidgetDraft,
  buildWidgetLayoutMap,
  getRoleLayoutSummary,
  moveHomeWidgetDraftItem,
  reorderHomeWidgetDraft,
  type HomeWidgetDraftItem
} from "../home/homeWidgetLayout";
import { OverlayPanel } from "../OverlayPanel";
import { RiskBadge, SavedViewBar, StatusPill, formatDate, formatDateTime, humanizeToken } from "../sports/SportsPrimitives";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";

type CommandDepartment = "schools" | "sports" | null;

type SharedDashboardSurfaceProps = {
  token: string;
  currentUser: SessionUser;
  scope: "home" | "executive" | "today";
  departmentType?: CommandDepartment;
  title: string;
  summary: string;
  /** Optional leadership-only content rendered after execution pressure, before deeper workload. */
  operatingReportSlot?: React.ReactNode;
};

type SharedWatchlistPageProps = {
  token: string;
  currentUser: SessionUser;
  departmentType?: CommandDepartment;
  title?: string;
  summary?: string;
};

type SharedAlertsPageProps = {
  token: string;
  title?: string;
  summary?: string;
};

type DepartmentDashboardPanelProps = {
  token: string;
  currentUser: SessionUser;
  departmentType: Exclude<CommandDepartment, null>;
  title: string;
  summary: string;
  routeHash: string;
};

type SnoozeDraft = {
  snooze_until: string;
  note: string;
};

type ResolveDraft = {
  resolution_note: string;
  root_cause: string;
  follow_up_required: boolean;
};

type EscalationDraft = {
  severity: SharedJobWatchFlag["severity"];
  owner_user_id: string;
  escalated_to_role: string;
  due_at: string;
  note: string;
};

function messageFor(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function toJobHash(item: { department_type: string | null; job_id?: string | null; id?: string | null }) {
  const jobId = item.job_id ?? item.id ?? null;
  if (!jobId) {
    return "#dashboard";
  }
  if (item.department_type === "schools") {
    return `#schools/jobs/${jobId}`;
  }
  if (item.department_type === "sports") {
    return `#sports/jobs/${jobId}`;
  }
  return `#jobs/${jobId}`;
}

function toDepartmentProductionHash(departmentType: string | null) {
  if (departmentType === "schools") {
    return "#schools/production";
  }
  if (departmentType === "sports") {
    return "#sports/production";
  }
  return "#production";
}

function toChecklistHash(item: SharedDashboardResponse["checklist_attention"][number]) {
  if (item.scope_type === "production_item" && item.production_item_id) {
    return `${toDepartmentProductionHash(item.department_type)}?item=${item.production_item_id}`;
  }
  if (item.job_id) {
    return toJobHash({ department_type: item.department_type, job_id: item.job_id });
  }
  return toDepartmentProductionHash(item.department_type);
}

function widgetToneClass(tone: SharedDashboardWidgetSummary["tone"]) {
  return tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : tone === "info" ? "info" : "neutral";
}

function statusChipTone(status: string) {
  if (["critical", "blocked", "overdue", "open"].includes(status)) {
    return "danger";
  }
  if (["high", "watch", "at_risk", "requested", "viewed", "snoozed", "rejected", "awaiting_approval"].includes(status)) {
    return "warning";
  }
  if (["healthy", "ready", "confirmed", "resolved", "delivered", "complete", "approved"].includes(status)) {
    return "success";
  }
  return "info";
}

function defaultDateTimeLocal() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

function applyPreferences(widgets: SharedDashboardWidgetSummary[], preferences: SharedDashboardWidgetPreference[]) {
  if (!preferences.length) {
    return widgets;
  }
  const preferenceMap = new Map(preferences.map((item) => [item.widget_key, item]));
  return widgets
    .filter((widget) => preferenceMap.get(widget.widget_key)?.is_visible !== false)
    .sort((left, right) => {
      const leftIndex = preferenceMap.get(left.widget_key)?.position_index ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = preferenceMap.get(right.widget_key)?.position_index ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
}

export function AlertSeverityBadge({ severity }: { severity: SharedJobWatchFlag["severity"] }) {
  return <span className={`shared-command__severity shared-command__severity--${severity}`}>{humanizeToken(severity)}</span>;
}

export function DashboardWidgetFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel shared-command__widget">
      <WorkspaceSectionHeader title={title} compact />
      {children}
    </section>
  );
}

export function DashboardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="shared-command__section">
      <WorkspaceSectionHeader title={title} />
      {children}
    </section>
  );
}

export function OpsKpiCard({
  title,
  value,
  detail,
  tone = "neutral"
}: {
  title: string;
  value: string | number;
  detail: string;
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  return (
    <article className={`shared-command__kpi shared-command__kpi--${widgetToneClass(tone)}`}>
      <span className="shared-command__kpi-label">{title}</span>
      <strong className="shared-command__kpi-value">{value}</strong>
      <span className="shared-command__kpi-detail">{detail}</span>
    </article>
  );
}

export function OperationalHealthHeader({ dashboard }: { dashboard: SharedDashboardResponse }) {
  return (
    <section className={`panel shared-command__health shared-command__health--${dashboard.health.state}`}>
      <div>
        <div className="shared-command__eyebrow">Operational Health</div>
        <h3>{humanizeToken(dashboard.health.state)}</h3>
        <p>{dashboard.health.explanation[0] ?? "No major operational risk is open right now."}</p>
      </div>
      <div className="shared-command__health-score">
        <span>Score</span>
        <strong>{dashboard.health.score}</strong>
      </div>
    </section>
  );
}

export function CriticalIssuesBanner({ items }: { items: SharedWatchFlagListItem[] }) {
  const critical = items.filter((item) => item.severity === "critical");
  if (!critical.length) {
    return <div className="shared-command__banner shared-command__banner--success">No critical issues right now.</div>;
  }
  return (
    <div className="shared-command__banner shared-command__banner--danger">
      <strong>{critical.length} critical issue(s)</strong>
      <span>{critical[0].title}</span>
      <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#exceptions?critical_high_only=yes")}>
        Open Exceptions
      </button>
    </div>
  );
}

export function WatchFlagCard({ item, compact = false }: { item: SharedWatchFlagListItem; compact?: boolean }) {
  return (
    <article className={`shared-command__flag-card${compact ? " compact" : ""}`}>
      <div className="shared-command__flag-header">
        <AlertSeverityBadge severity={item.severity} />
        <StatusPill label={humanizeToken(item.status)} tone={statusChipTone(item.status) as any} />
      </div>
      <strong>{item.title}</strong>
      <p>{item.description}</p>
      <div className="shared-command__flag-meta">
        <span>{item.job_number ?? "Draft job"}</span>
        <span>{item.organization_name ?? humanizeToken(item.department_type)}</span>
        {item.due_at ? <span>Due {formatDateTime(item.due_at)}</span> : null}
      </div>
    </article>
  );
}

export function UrgentWatchBoard({ items }: { items: SharedWatchFlagListItem[] }) {
  if (!items.length) {
    return <WorkspaceEmptyState title="No priority exceptions" summary="Nothing needs immediate intervention in the next 24 hours." compact />;
  }
  return (
    <div className="shared-command__flag-list">
      {items.map((item) => (
        <button key={item.id} type="button" className="shared-command__flag-button" onClick={() => (window.location.hash = toJobHash(item))}>
          <WatchFlagCard item={item} compact />
        </button>
      ))}
    </div>
  );
}

export function UpcomingRiskBoard({ items }: { items: SharedWatchFlagListItem[] }) {
  if (!items.length) {
    return <WorkspaceEmptyState title="No upcoming risks" summary="Nothing unresolved is drifting into the near-term window." compact />;
  }
  return (
    <div className="shared-command__table">
      {items.map((item) => (
        <div key={item.id} className="shared-command__table-row">
          <div>
            <div className="shared-command__table-title">{item.title}</div>
            <div className="shared-command__table-subtitle">{item.organization_name ?? humanizeToken(item.department_type)}</div>
          </div>
          <div className="shared-command__table-status">
            <AlertSeverityBadge severity={item.severity} />
            {item.due_at ? <span>{formatDateTime(item.due_at)}</span> : <span>No due time</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DepartmentHealthCard({ title, dashboard }: { title: string; dashboard: SharedDashboardResponse }) {
  return (
    <DashboardWidgetFrame title={title}>
      <div className="shared-command__department-health">
        <div className="shared-command__department-health-top">
          <StatusPill label={humanizeToken(dashboard.health.state)} tone={statusChipTone(dashboard.health.state) as any} />
          <strong>{dashboard.health.score}</strong>
        </div>
        <ul className="shared-command__list-plain">
          <li>{dashboard.summary.critical_watch_count} critical flags</li>
          <li>{dashboard.summary.staffing_gap_count} staffing gaps</li>
          <li>{dashboard.summary.blocked_production_count} blocked production items</li>
        </ul>
      </div>
    </DashboardWidgetFrame>
  );
}

export function MissingStaffingCard({ items }: { items: SharedWatchFlagListItem[] }) {
  const staffing = items.filter((item) => item.flag_type === "staffing_gap");
  return (
    <DashboardWidgetFrame title="Missing Staffing">
      {staffing.length ? (
        <ul className="shared-command__list-plain">
          {staffing.slice(0, 5).map((item) => (
            <li key={item.id}>
              {item.job_number ?? "Draft"} | {item.title}
            </li>
          ))}
        </ul>
      ) : (
        <WorkspaceEmptyState title="No staffing gaps" summary="Coverage is holding across this scope." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function LeadReadyMonitorCard({ items }: { items: SharedWatchFlagListItem[] }) {
  const ready = items.filter((item) => item.flag_type === "ready_confirmation_missing");
  return (
    <DashboardWidgetFrame title="Missing Ready Confirmations">
      {ready.length ? (
        <ul className="shared-command__list-plain">
          {ready.slice(0, 5).map((item) => (
            <li key={item.id}>
              {item.job_number ?? "Draft"} | {item.organization_name ?? "Unlinked org"}
            </li>
          ))}
        </ul>
      ) : (
        <WorkspaceEmptyState title="No missing ready confirmations" summary="Lead confirmations are current." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function BlockedProductionCard({ items }: { items: SharedDashboardResponse["blocked_production"] }) {
  return (
    <DashboardWidgetFrame title="Blocked Production">
      {items.length ? (
        <div className="shared-command__table">
          {items.map((item) => (
            <div key={item.id} className="shared-command__table-row">
              <div>
                <div className="shared-command__table-title">{item.title}</div>
                <div className="shared-command__table-subtitle">
                  {item.job_number ?? "Draft"} | {item.organization_name ?? "Unlinked org"}
                </div>
              </div>
              <div className="shared-command__table-status">
                <StatusPill label={humanizeToken(item.status)} tone="danger" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="Nothing blocked in production today" summary="Downstream work is flowing cleanly right now." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function OverdueApprovalsCard({ items }: { items: SharedDashboardResponse["overdue_approvals"] }) {
  return (
    <DashboardWidgetFrame title="Overdue Approvals">
      {items.length ? (
        <div className="shared-command__table">
          {items.map((item) => (
            <div key={item.id} className="shared-command__table-row">
              <div>
                <div className="shared-command__table-title">{item.title}</div>
                <div className="shared-command__table-subtitle">{item.organization_name ?? "Unlinked org"}</div>
              </div>
              <div className="shared-command__table-status">
                <StatusPill label={humanizeToken(item.approval_status)} tone="warning" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No overdue approvals" summary="Client and internal approvals are on time in this view." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function DeliveryRiskCard({ items }: { items: SharedDashboardResponse["delivery_risks"] }) {
  return (
    <DashboardWidgetFrame title="Delivery Risks">
      {items.length ? (
        <div className="shared-command__table">
          {items.map((item) => (
            <div key={item.id} className="shared-command__table-row">
              <div>
                <div className="shared-command__table-title">{item.title}</div>
                <div className="shared-command__table-subtitle">{item.organization_name ?? "Unlinked org"}</div>
              </div>
              <div className="shared-command__table-status">
                <StatusPill label={humanizeToken(item.deliverable_status)} tone="warning" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No delivery risks" summary="Delivery commitments are healthy in this scope." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function RecentMovementFeed({ items }: { items: SharedDashboardResponse["recent_movement"] }) {
  return (
    <DashboardWidgetFrame title="Recent Movement">
      {items.length ? (
        <ul className="shared-command__movement-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.summary}</strong>
              <span>
                {item.actor_name ?? "System"} | {formatDateTime(item.created_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <WorkspaceEmptyState title="No recent movement yet" summary="Meaningful operational movement will appear here as the command layer fills in." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function EscalationSummaryCard({ items }: { items: SharedWatchFlagListItem[] }) {
  const escalated = items.filter((item) => item.escalated_at || item.escalated_to_role);
  return (
    <DashboardWidgetFrame title="Escalations">
      {escalated.length ? (
        <ul className="shared-command__list-plain">
          {escalated.slice(0, 5).map((item) => (
            <li key={item.id}>
              {item.title} | {item.escalated_to_role ?? "Manual escalation"}
            </li>
          ))}
        </ul>
      ) : (
        <WorkspaceEmptyState title="No recent escalations" summary="Escalated flags will appear here when ownership or severity steps up." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function WorkloadPressureCard({ items }: { items: SharedDashboardResponse["workload_pressure"] }) {
  return (
    <DashboardWidgetFrame title="Workload Pressure">
      {items.length ? (
        <div className="shared-command__table">
          {items.map((item) => (
            <div key={`${item.owner_user_id ?? "unassigned"}-${item.score}`} className="shared-command__table-row">
              <div>
                <div className="shared-command__table-title">{item.owner_name}</div>
                <div className="shared-command__table-subtitle">
                  {item.open_flag_count} flags | {item.blocked_production_count} blocked | {item.due_today_count} due today
                </div>
              </div>
              <div className="shared-command__table-status">
                <strong>{item.score}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="Pressure looks balanced" summary="No owner currently has a meaningful workload spike in this scope." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function ProductionSnapshotCard({ snapshot }: { snapshot: SharedDashboardResponse["production_snapshot"] }) {
  return (
    <DashboardWidgetFrame title="Production Snapshot">
      {snapshot ? (
        <div className="shared-command__table">
          <div className="shared-command__table-row">
            <div>
              <div className="shared-command__table-title">Open / Due This Week</div>
              <div className="shared-command__table-subtitle">Current downstream work still moving through the board.</div>
            </div>
            <div className="shared-command__table-status">
              <strong>
                {snapshot.open_items} / {snapshot.due_this_week}
              </strong>
            </div>
          </div>
          <div className="shared-command__table-row">
            <div>
              <div className="shared-command__table-title">Blocked / Overdue</div>
              <div className="shared-command__table-subtitle">Items leadership should keep close to the command surface.</div>
            </div>
            <div className="shared-command__table-status">
              <strong>
                {snapshot.blocked_items} / {snapshot.overdue_items}
              </strong>
            </div>
          </div>
          <div className="shared-command__table-row">
            <div>
              <div className="shared-command__table-title">On-Time / First-Pass</div>
              <div className="shared-command__table-subtitle">Quality and timeliness at a glance.</div>
            </div>
            <div className="shared-command__table-status">
              <strong>
                {snapshot.on_time_release_percentage ?? "N/A"}% / {snapshot.first_pass_approval_rate ?? "N/A"}%
              </strong>
            </div>
          </div>
        </div>
      ) : (
        <WorkspaceEmptyState title="No production snapshot yet" summary="Production reporting will appear here when shared board metrics are available in this scope." compact />
      )}
    </DashboardWidgetFrame>
  );
}

export function ChecklistAttentionCard({
  title,
  items,
  emptyTitle,
  emptySummary,
  routeHash
}: {
  title: string;
  items: SharedDashboardResponse["checklist_attention"];
  emptyTitle: string;
  emptySummary: string;
  routeHash: string;
}) {
  return (
    <DashboardWidgetFrame title={title}>
      {items.length ? (
        <div className="shared-command__table">
          {items.slice(0, 6).map((item) => (
            <button key={item.instance_id} type="button" className="shared-command__table-row shared-command__table-row--button" onClick={() => (window.location.hash = toChecklistHash(item))}>
              <div>
                <div className="shared-command__table-title">{item.template_name}</div>
                <div className="shared-command__table-subtitle">
                  {item.target_title ?? item.organization_name ?? humanizeToken(item.scope_type)}
                </div>
                <div className="shared-command__checklist-detail">
                  <span>{item.owner_name ?? "Unassigned"}</span>
                  {item.due_at ? <span>Due {formatDateTime(item.due_at)}</span> : null}
                  {item.missing_proof_count ? <span>{item.missing_proof_count} missing proof</span> : null}
                </div>
              </div>
              <div className="shared-command__table-status">
                <StatusPill label={humanizeToken(item.attention_state)} tone={statusChipTone(item.attention_state) as any} />
                {item.blocked_transition ? <StatusPill label="Blocks transition" tone="danger" /> : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title={emptyTitle} summary={emptySummary} compact />
      )}
      <WorkspaceActionBar align="end" compact>
        <button type="button" className="secondary-button" onClick={() => (window.location.hash = routeHash)}>
          Open Checklist View
        </button>
      </WorkspaceActionBar>
    </DashboardWidgetFrame>
  );
}

export function TodayRiskBoard({
  dashboard,
  productionHashBase = "#production"
}: {
  dashboard: SharedDashboardResponse;
  productionHashBase?: string;
}) {
  return (
    <div className="shared-command__today-grid">
      <div className="shared-command__today-list">
        {dashboard.today_jobs.length ? (
          dashboard.today_jobs.map((job) => (
            <button key={job.id} type="button" className="shared-command__today-card" onClick={() => (window.location.hash = toJobHash(job))}>
              <div className="shared-command__today-card-top">
                <span>{job.job_number ?? "Draft"}</span>
                <RiskBadge level={job.risk_status} />
              </div>
              <strong>{job.organization_name ?? job.title}</strong>
              <span>
                {job.primary_day_date ? formatDate(job.primary_day_date) : "Date TBD"} | {job.primary_location_name ?? "Location TBD"}
              </span>
              <div className="shared-command__today-card-meta">
                <span>{humanizeToken(job.staffing_status)}</span>
                <span>{humanizeToken(job.readiness_status)}</span>
                <span>{job.urgent_flag_count} urgent</span>
              </div>
            </button>
          ))
        ) : (
          <WorkspaceEmptyState title="No jobs today" summary="Nothing is scheduled for same-day execution in this view." compact />
        )}
      </div>
      <div className="shared-command__today-rail">
        <DashboardWidgetFrame title="Priority Exceptions">
          <UrgentWatchBoard items={dashboard.urgent_watch.slice(0, 6)} />
        </DashboardWidgetFrame>
        <ChecklistAttentionCard
          title="Checklist Blocks"
          items={dashboard.checklist_attention.filter((item) => item.overdue || item.blocked_transition || item.missing_proof_count > 0)}
          emptyTitle="No checklist blocks"
          emptySummary="Required proof, approvals, and checklist gates are flowing cleanly right now."
          routeHash={`${productionHashBase}?checklist_state=blocked`}
        />
        <LeadReadyMonitorCard items={dashboard.urgent_watch} />
        <MissingStaffingCard items={dashboard.urgent_watch} />
      </div>
    </div>
  );
}

export function AlertFeedList({
  items,
  onMarkRead,
  onAcknowledge,
  onResolve
}: {
  items: SharedAlertFeedItem[];
  onMarkRead: (deliveryId: string) => Promise<void>;
  onAcknowledge: (item: SharedAlertFeedItem) => Promise<void>;
  onResolve: (item: SharedAlertFeedItem) => Promise<void>;
}) {
  if (!items.length) {
    return <WorkspaceEmptyState title="No alerts" summary="You do not have any delivered alerts in this view right now." compact />;
  }
  return (
    <div className="shared-command__alert-list">
      {items.map((item) => (
        <article key={item.id} className="shared-command__alert-card">
          <div className="shared-command__alert-card-top">
            <AlertSeverityBadge severity={item.alert_event.severity} />
            {!item.read_at ? <span className="shared-command__unread-dot" aria-label="Unread alert" /> : null}
          </div>
          <strong>{item.alert_event.title}</strong>
          <p>{item.alert_event.message}</p>
          <div className="shared-command__alert-meta">
            <span>{item.job_number ?? "Unlinked alert"}</span>
            <span>{formatDateTime(item.alert_event.triggered_at)}</span>
          </div>
          <WorkspaceActionBar align="start">
            <button type="button" className="secondary-button" onClick={() => void onMarkRead(item.id)}>
              {item.read_at ? "Viewed" : "Mark Read"}
            </button>
            {item.watch_flag ? (
              <button type="button" className="secondary-button" onClick={() => void onAcknowledge(item)}>
                Acknowledge
              </button>
            ) : null}
            <button type="button" onClick={() => void onResolve(item)}>
              {item.watch_flag ? "Resolve" : "Open"}
            </button>
          </WorkspaceActionBar>
        </article>
      ))}
    </div>
  );
}

export function AlertBellMenu({ alerts, onOpenAlerts }: { alerts: SharedAlertFeedItem[]; onOpenAlerts: () => void }) {
  const unreadCount = alerts.filter((item) => !item.read_at).length;
  return (
    <button type="button" className="shared-command__alert-bell" onClick={onOpenAlerts}>
      Alerts
      {unreadCount ? <span className="shared-command__alert-bell-count">{unreadCount}</span> : null}
    </button>
  );
}

export function AlertCenterPanel({
  payload,
  onMarkRead,
  onAcknowledge,
  onResolve
}: {
  payload: SharedAlertCenterResponse;
  onMarkRead: (deliveryId: string) => Promise<void>;
  onAcknowledge: (item: SharedAlertFeedItem) => Promise<void>;
  onResolve: (item: SharedAlertFeedItem) => Promise<void>;
}) {
  return (
    <section className="shared-command__stack">
      <div className="shared-command__kpi-row">
        <OpsKpiCard title="Unread" value={payload.summary.unread_count} detail="Alert deliveries not yet marked read." tone={payload.summary.unread_count ? "warning" : "success"} />
        <OpsKpiCard title="Critical" value={payload.summary.critical_count} detail="Critical alert deliveries in your feed." tone={payload.summary.critical_count ? "danger" : "success"} />
        <OpsKpiCard title="Acted On" value={payload.summary.acted_count} detail="Alerts already acted on from this feed." tone="info" />
      </div>
      <AlertFeedList items={payload.items} onMarkRead={onMarkRead} onAcknowledge={onAcknowledge} onResolve={onResolve} />
    </section>
  );
}

export function WatchFlagOwnerPanel({
  ownerOptions,
  draft,
  onDraftChange,
  onSave
}: {
  ownerOptions: DirectoryOwnerOption[];
  draft: EscalationDraft;
  onDraftChange: (next: EscalationDraft) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="shared-command__owner-panel">
      <div className="shared-command__field-grid">
        <label>
          <span>Severity</span>
          <select value={draft.severity} onChange={(event) => onDraftChange({ ...draft, severity: event.target.value as EscalationDraft["severity"] })}>
            {["info", "low", "medium", "high", "critical"].map((value) => (
              <option key={value} value={value}>
                {humanizeToken(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Owner</span>
          <select value={draft.owner_user_id} onChange={(event) => onDraftChange({ ...draft, owner_user_id: event.target.value })}>
            <option value="">Keep current</option>
            {ownerOptions.map((option) => (
              <option key={option.user_id} value={option.user_id}>
                {option.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Escalate To Role</span>
          <input value={draft.escalated_to_role} onChange={(event) => onDraftChange({ ...draft, escalated_to_role: event.target.value })} placeholder="leadership" />
        </label>
        <label>
          <span>Due At</span>
          <input type="datetime-local" value={draft.due_at} onChange={(event) => onDraftChange({ ...draft, due_at: event.target.value })} />
        </label>
      </div>
      <label>
        <span>Escalation Note</span>
        <textarea value={draft.note} onChange={(event) => onDraftChange({ ...draft, note: event.target.value })} />
      </label>
      <WorkspaceActionBar align="start">
        <button type="button" onClick={() => void onSave()}>
          Save Escalation
        </button>
      </WorkspaceActionBar>
    </div>
  );
}

export function WatchFlagSnoozeModal({
  open,
  draft,
  onChange,
  onClose,
  onSave
}: {
  open: boolean;
  draft: SnoozeDraft;
  onChange: (next: SnoozeDraft) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <OverlayPanel open={open} onClose={onClose} ariaLabel="Snooze exception">
      <WorkspaceSectionHeader title="Snooze Exception" />
      <div className="shared-command__stack">
        <label>
          <span>Snooze Until</span>
          <input type="datetime-local" value={draft.snooze_until} onChange={(event) => onChange({ ...draft, snooze_until: event.target.value })} />
        </label>
        <label>
          <span>Note</span>
          <textarea value={draft.note} onChange={(event) => onChange({ ...draft, note: event.target.value })} />
        </label>
        <WorkspaceActionBar align="start">
          <button type="button" onClick={() => void onSave()}>
            Save Snooze
          </button>
        </WorkspaceActionBar>
      </div>
    </OverlayPanel>
  );
}

export function WatchFlagResolutionModal({
  open,
  mode,
  draft,
  onChange,
  onClose,
  onResolve,
  onDismiss
}: {
  open: boolean;
  mode: "resolve" | "dismiss";
  draft: ResolveDraft;
  onChange: (next: ResolveDraft) => void;
  onClose: () => void;
  onResolve: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  return (
    <OverlayPanel open={open} onClose={onClose} ariaLabel={mode === "resolve" ? "Resolve exception" : "Dismiss exception"}>
      <WorkspaceSectionHeader title={mode === "resolve" ? "Resolve Exception" : "Dismiss Exception"} />
      <div className="shared-command__stack">
        <label>
          <span>{mode === "resolve" ? "Resolution Note" : "Dismissal Reason"}</span>
          <textarea value={draft.resolution_note} onChange={(event) => onChange({ ...draft, resolution_note: event.target.value })} />
        </label>
        {mode === "resolve" ? (
          <>
            <label>
              <span>Root Cause</span>
              <textarea value={draft.root_cause} onChange={(event) => onChange({ ...draft, root_cause: event.target.value })} />
            </label>
            <label className="shared-command__checkbox">
              <input type="checkbox" checked={draft.follow_up_required} onChange={(event) => onChange({ ...draft, follow_up_required: event.target.checked })} />
              <span>Follow-up required</span>
            </label>
          </>
        ) : null}
        <WorkspaceActionBar align="start">
          <button type="button" onClick={() => void (mode === "resolve" ? onResolve() : onDismiss())}>
            {mode === "resolve" ? "Resolve Flag" : "Dismiss Flag"}
          </button>
        </WorkspaceActionBar>
      </div>
    </OverlayPanel>
  );
}

export function WatchlistTable({
  payload,
  selectedId,
  onSelect,
  onOpen,
  onAcknowledge,
  onSnooze,
  onResolve,
  onDismiss,
  onEscalate
}: {
  payload: SharedWatchlistResponse;
  selectedId: string | null;
  onSelect: (item: SharedWatchFlagListItem) => void;
  onOpen: (item: SharedWatchFlagListItem) => void;
  onAcknowledge: (item: SharedWatchFlagListItem) => Promise<void>;
  onSnooze: (item: SharedWatchFlagListItem) => void;
  onResolve: (item: SharedWatchFlagListItem) => void;
  onDismiss: (item: SharedWatchFlagListItem) => void;
  onEscalate: (item: SharedWatchFlagListItem) => void;
}) {
  if (!payload.items.length) {
    return <WorkspaceEmptyState title="No exceptions" summary="No unresolved operational exceptions match this view right now." compact />;
  }

  const selected = payload.items.find((item) => item.id === selectedId) ?? payload.items[0];

  return (
    <div className="shared-command__watchlist">
      <div className="shared-command__watchlist-table">
        {payload.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`shared-command__watchlist-row${selected?.id === item.id ? " selected" : ""}`}
            onClick={() => onSelect(item)}
          >
            <div className="shared-command__watchlist-primary">
              <AlertSeverityBadge severity={item.severity} />
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.job_number ?? "Draft"} | {item.organization_name ?? humanizeToken(item.department_type)}
                </span>
              </div>
            </div>
            <div className="shared-command__watchlist-secondary">
              <span>{item.owner_name ?? "Unassigned"}</span>
              <StatusPill label={humanizeToken(item.status)} tone={statusChipTone(item.status) as any} />
            </div>
          </button>
        ))}
      </div>
      <div className="shared-command__watchlist-detail">
        {selected ? (
          <>
            <WatchFlagCard item={selected} />
            <div className="shared-command__detail-grid">
              <div>
                <span>Owner</span>
                <strong>{selected.owner_name ?? "Unassigned"}</strong>
              </div>
              <div>
                <span>Due</span>
                <strong>{selected.due_at ? formatDateTime(selected.due_at) : "No due time"}</strong>
              </div>
              <div>
                <span>Scope</span>
                <strong>{selected.source_scope_label}</strong>
              </div>
              <div>
                <span>Entity</span>
                <strong>{selected.source_entity_label ?? "Job"}</strong>
              </div>
            </div>
            <WorkspaceActionBar align="start">
              <button type="button" onClick={() => onOpen(selected)}>
                Open Linked Record
              </button>
              <button type="button" className="secondary-button" onClick={() => void onAcknowledge(selected)}>
                Acknowledge
              </button>
              <button type="button" className="secondary-button" onClick={() => onSnooze(selected)}>
                Snooze
              </button>
              <button type="button" className="secondary-button" onClick={() => onEscalate(selected)}>
                Escalate
              </button>
              <button type="button" onClick={() => onResolve(selected)}>
                Resolve
              </button>
              <button type="button" className="secondary-button" onClick={() => onDismiss(selected)}>
                Dismiss
              </button>
            </WorkspaceActionBar>
          </>
        ) : (
          <WorkspaceEmptyState title="Select an exception" summary="The selected exception will show detail and command actions here." compact />
        )}
      </div>
    </div>
  );
}

export function RoleAwareHomeDashboard({
  token,
  currentUser,
  scope,
  departmentType,
  title,
  summary,
  operatingReportSlot
}: SharedDashboardSurfaceProps) {
  const [dashboard, setDashboard] = useState<SharedDashboardResponse | null>(null);
  const [alerts, setAlerts] = useState<SharedAlertCenterResponse | null>(null);
  const [preferences, setPreferences] = useState<SharedDashboardWidgetPreference[]>([]);
  const [preferenceDraft, setPreferenceDraft] = useState<HomeWidgetDraftItem[]>([]);
  const [draggedWidgetKey, setDraggedWidgetKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const preferenceRequest =
      scope === "home" && departmentType == null
        ? listSharedDashboardWidgetPreferences(token, scope).catch(() => ({ preferences: [] }))
        : Promise.resolve({ preferences: [] });
    Promise.all([
      getSharedDashboard(token, scope, departmentType ?? undefined),
      listSharedAlerts(token, { unread_only: true, limit: 8 }),
      preferenceRequest
    ])
      .then(([dashboardPayload, alertPayload, prefPayload]) => {
        if (cancelled) {
          return;
        }
        setDashboard(dashboardPayload);
        setAlerts(alertPayload);
        setPreferences(prefPayload.preferences);
        setPreferenceDraft(buildHomeWidgetDraft(dashboardPayload.widgets, prefPayload.preferences, dashboardPayload.widget_layout));
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(messageFor(loadError, "We couldn't load the shared command dashboard right now."));
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
  }, [departmentType, scope, token]);

  if (loading) {
    return <WorkspaceLoadingBlock title={`Loading ${title}`} summary={summary} />;
  }
  if (!dashboard) {
    return <WorkspaceEmptyState title="Dashboard unavailable" summary={error || "We couldn't load the role-aware command dashboard."} />;
  }

  const widgetLayoutMap = buildWidgetLayoutMap(dashboard.widget_layout);
  const visibleWidgets = applyHomeWidgetDraft(
    dashboard.widgets,
    preferenceDraft.length ? preferenceDraft : buildHomeWidgetDraft(dashboard.widgets, preferences, dashboard.widget_layout)
  );
  const widgetMap = new Map(dashboard.widgets.map((widget) => [widget.widget_key, widget]));
  const layoutSummary = getRoleLayoutSummary(dashboard.widget_layout);
  const supportsPersonalization = dashboard.widget_layout.supports_personalization;
  const hiddenOptionalCount = preferenceDraft.filter((item) => {
    const layoutItem = widgetLayoutMap.get(item.widget_key);
    return !layoutItem?.required && !item.is_visible;
  }).length;
  const productionHashBase = toDepartmentProductionHash(departmentType ?? null);
  const overdueChecklistItems = dashboard.checklist_attention.filter((item) => item.overdue);
  const checklistApprovalItems = dashboard.checklist_attention.filter((item) => item.awaiting_approval);
  const rejectedChecklistItems = dashboard.checklist_attention.filter((item) => item.rejected);
  const blockedChecklistItems = dashboard.checklist_attention.filter((item) => item.blocked_transition);

  return (
    <section className="shared-command">
      <WorkspacePageHeader
        eyebrow={scope === "executive" ? "Executive" : departmentType ? humanizeToken(departmentType) : "Dashboard"}
        title={title}
        summary={summary}
        meta={[
          { label: `${dashboard.summary.urgent_count} urgent`, tone: dashboard.summary.urgent_count ? "critical" : "success" },
          { label: `${dashboard.summary.jobs_today} jobs today`, tone: "info" }
        ]}
      />
      <WorkspaceActionBar>
        <AlertBellMenu alerts={alerts?.items ?? []} onOpenAlerts={() => (window.location.hash = "#notifications")} />
        <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#exceptions")}>
          Open Exceptions
        </button>
        {supportsPersonalization ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                setSavingPrefs(true);
                try {
                  const response = await saveSharedDashboardWidgetPreferences(token, {
                    dashboard_scope: scope,
                    preferences: preferenceDraft.map((item, index) => ({
                      widget_key: item.widget_key,
                      position_index: index,
                      is_visible: widgetLayoutMap.get(item.widget_key)?.required ? true : item.is_visible
                    }))
                  });
                  setPreferences(response.preferences);
                  setPreferenceDraft(buildHomeWidgetDraft(dashboard.widgets, response.preferences, dashboard.widget_layout));
                } catch (saveError) {
                  setError(messageFor(saveError, "We couldn't save your homepage layout right now."));
                } finally {
                  setSavingPrefs(false);
                }
              }}
              disabled={savingPrefs}
            >
              {savingPrefs ? "Saving..." : "Save Layout"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPreferenceDraft(buildHomeWidgetDraft(dashboard.widgets, [], dashboard.widget_layout))}
              disabled={savingPrefs}
            >
              Reset To Role Default
            </button>
          </>
        ) : null}
      </WorkspaceActionBar>
      {error ? <div className="error-banner">{error}</div> : null}
      <OperationalHealthHeader dashboard={dashboard} />
      <CriticalIssuesBanner items={dashboard.urgent_watch} />
      <section className="shared-command__kpi-row">
        <OpsKpiCard title="Jobs Today" value={dashboard.summary.jobs_today} detail="Live same-day jobs in this scope." tone={dashboard.summary.jobs_today ? "info" : "neutral"} />
        <OpsKpiCard title="Critical Flags" value={dashboard.summary.critical_watch_count} detail="Highest-severity unresolved work." tone={dashboard.summary.critical_watch_count ? "danger" : "success"} />
        <OpsKpiCard title="Overdue Approvals" value={dashboard.summary.overdue_approval_count} detail="Approval follow-through now late." tone={dashboard.summary.overdue_approval_count ? "warning" : "success"} />
        <OpsKpiCard title="Overdue Checklists" value={dashboard.summary.overdue_checklist_count} detail="Checklist work already past due." tone={dashboard.summary.overdue_checklist_count ? "danger" : "success"} />
        <OpsKpiCard title="Checklist Approvals" value={dashboard.summary.awaiting_checklist_approval_count} detail="Submitted checklist work still waiting on sign-off." tone={dashboard.summary.awaiting_checklist_approval_count ? "warning" : "success"} />
        <OpsKpiCard title="Rejected Checklists" value={dashboard.summary.rejected_checklist_count} detail="Checklist work sent back for correction." tone={dashboard.summary.rejected_checklist_count ? "warning" : "success"} />
        <OpsKpiCard title="Blocked Jobs" value={dashboard.summary.blocked_job_count} detail="Jobs or production records blocked by missing checklist work." tone={dashboard.summary.blocked_job_count ? "danger" : "success"} />
      </section>
      {supportsPersonalization ? (
        <DashboardSection title="Homepage Layout">
          <div className="shared-command__widget-layout-summary">
            <div className="shared-command__widget-layout-card">
              <span className="shared-command__widget-layout-label">Role Default</span>
              <strong>{humanizeToken(layoutSummary.roleLabel)}</strong>
              <span>{layoutSummary.requiredCount} required widget(s) stay pinned for this role.</span>
            </div>
            <div className="shared-command__widget-layout-card">
              <span className="shared-command__widget-layout-label">Optional Widgets</span>
              <strong>{layoutSummary.optionalCount}</strong>
              <span>{hiddenOptionalCount} currently hidden in your personal layout.</span>
            </div>
          </div>
          <div className="shared-command__widget-picker">
            {preferenceDraft.map((item, index) => {
              const widget = widgetMap.get(item.widget_key);
              if (!widget) {
                return null;
              }
              const guardrail = widgetLayoutMap.get(item.widget_key) ?? {
                required: false,
                default_visible: true,
                default_position: index,
                reason: "Optional widget. You can hide or reorder it for your homepage."
              };
              return (
                <div
                  key={item.widget_key}
                  className={`shared-command__widget-picker-row${draggedWidgetKey === item.widget_key ? " is-dragging" : ""}`}
                  draggable={!savingPrefs}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.widget_key);
                    setDraggedWidgetKey(item.widget_key);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceKey = event.dataTransfer.getData("text/plain") || draggedWidgetKey;
                    if (!sourceKey) {
                      return;
                    }
                    setPreferenceDraft((current) => reorderHomeWidgetDraft(current, sourceKey, item.widget_key));
                    setDraggedWidgetKey(null);
                  }}
                  onDragEnd={() => setDraggedWidgetKey(null)}
                >
                  <div className="shared-command__widget-picker-drag">
                    <span className="meta-pill">Drag</span>
                  </div>
                  <label className="shared-command__checkbox">
                    <input
                      type="checkbox"
                      checked={guardrail.required ? true : item.is_visible}
                      disabled={guardrail.required}
                      aria-label={widget.title}
                      onChange={(event) =>
                        setPreferenceDraft((current) =>
                          current.map((draftItem) =>
                            draftItem.widget_key === item.widget_key ? { ...draftItem, is_visible: event.target.checked } : draftItem
                          )
                        )
                      }
                    />
                    <span>{widget.title}</span>
                  </label>
                  <div className="shared-command__widget-picker-meta">
                    <span className={`meta-pill${guardrail.required ? " meta-pill--critical" : ""}`}>{guardrail.required ? "Required" : "Optional"}</span>
                    <span className="muted">{guardrail.reason}</span>
                  </div>
                  <div className="shared-command__widget-picker-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`Move ${widget.title} up`}
                      onClick={() => setPreferenceDraft((current) => moveHomeWidgetDraftItem(current, index, -1))}
                      disabled={index === 0}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`Move ${widget.title} down`}
                      onClick={() => setPreferenceDraft((current) => moveHomeWidgetDraftItem(current, index, 1))}
                      disabled={index === preferenceDraft.length - 1}
                    >
                      Down
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </DashboardSection>
      ) : null}
      <DashboardSection title="Widget Snapshot">
        <div className="shared-command__widget-grid">
          {visibleWidgets.map((widget) => (
            <DashboardWidgetFrame key={widget.widget_key} title={widget.title}>
              <div className={`shared-command__widget-summary shared-command__widget-summary--${widgetToneClass(widget.tone)}`}>
                <strong>{widget.metric}</strong>
                <p>{widget.description}</p>
                <button type="button" className="secondary-button" onClick={() => (window.location.hash = widget.route_hash)}>
                  Open
                </button>
              </div>
            </DashboardWidgetFrame>
          ))}
        </div>
      </DashboardSection>
      <DashboardSection title="Urgent Next 24 Hours">
        <div className="shared-command__widget-grid">
          <DashboardWidgetFrame title="Priority Exceptions">
            <UrgentWatchBoard items={dashboard.urgent_watch} />
          </DashboardWidgetFrame>
          <ChecklistAttentionCard
            title="Checklist Attention"
            items={dashboard.checklist_attention.filter((item) => item.overdue || item.awaiting_approval || item.blocked_transition)}
            emptyTitle="No urgent checklist items"
            emptySummary="No checklist gate is currently overdue, awaiting approval, or blocking progress."
            routeHash={`${productionHashBase}?checklist_state=overdue`}
          />
        </div>
      </DashboardSection>
      <DashboardSection title={scope === "today" ? "Today Operations" : "Today + Near-Term Visibility"}>
        <TodayRiskBoard dashboard={dashboard} productionHashBase={productionHashBase} />
      </DashboardSection>
      <DashboardSection title="Execution and Delivery Pressure">
        <div className="shared-command__widget-grid">
          <BlockedProductionCard items={dashboard.blocked_production} />
          <OverdueApprovalsCard items={dashboard.overdue_approvals} />
          <ChecklistAttentionCard
            title="Overdue Checklists"
            items={overdueChecklistItems}
            emptyTitle="No overdue checklists"
            emptySummary="Checklist due dates are on track in this scope."
            routeHash={`${productionHashBase}?checklist_state=overdue`}
          />
          <ChecklistAttentionCard
            title="Rejected Checklists"
            items={rejectedChecklistItems}
            emptyTitle="No rejected checklists"
            emptySummary="No checklist submissions are currently in send-back or correction."
            routeHash={`${productionHashBase}?checklist_state=rejected`}
          />
          <ChecklistAttentionCard
            title="Blocked Jobs"
            items={blockedChecklistItems}
            emptyTitle="No checklist-blocked jobs"
            emptySummary="No job or production transition is currently blocked by checklist requirements."
            routeHash={`${productionHashBase}?checklist_state=blocked`}
          />
          <ChecklistAttentionCard
            title="Checklist Approvals"
            items={checklistApprovalItems}
            emptyTitle="No checklist approvals pending"
            emptySummary="Submitted checklist work has no approval backlog right now."
            routeHash={`${productionHashBase}?checklist_state=awaiting_approval`}
          />
          <DeliveryRiskCard items={dashboard.delivery_risks} />
          <EscalationSummaryCard items={dashboard.urgent_watch} />
        </div>
      </DashboardSection>
      {operatingReportSlot}
      <DashboardSection title="Movement and Load">
        <div className="shared-command__widget-grid">
          <RecentMovementFeed items={dashboard.recent_movement} />
          <WorkloadPressureCard items={dashboard.workload_pressure} />
          <ProductionSnapshotCard snapshot={dashboard.production_snapshot} />
        </div>
      </DashboardSection>
    </section>
  );
}

export function ExecutiveDashboardShell(props: SharedDashboardSurfaceProps) {
  return <RoleAwareHomeDashboard {...props} scope="executive" />;
}

export function SharedAlertsCommandPage({
  token,
  title = "Notification Center",
  summary = "Delivered alerts, escalation events, and direct links into the work that needs attention now."
}: SharedAlertsPageProps) {
  const [payload, setPayload] = useState<SharedAlertCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await listSharedAlerts(token, { limit: 100 });
      setPayload(response);
      setError("");
    } catch (loadError) {
      setError(messageFor(loadError, "We couldn't load the shared alert center right now."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  if (loading) {
    return <WorkspaceLoadingBlock title={`Loading ${title}`} summary={summary} />;
  }

  return (
    <section className="shared-command">
      <WorkspacePageHeader eyebrow="Alerts" title={title} summary={summary} />
      {error ? <div className="error-banner">{error}</div> : null}
      {payload ? (
        <AlertCenterPanel
          payload={payload}
          onMarkRead={async (deliveryId) => {
            await markSharedAlertRead(token, deliveryId);
            await load();
          }}
          onAcknowledge={async (item) => {
            if (!item.watch_flag) {
              return;
            }
            await acknowledgeSharedWatchFlag(token, item.watch_flag.id);
            await markSharedAlertActed(token, item.id, "acknowledge_watch_flag");
            await load();
          }}
          onResolve={async (item) => {
            if (item.watch_flag) {
              await resolveSharedWatchFlag(token, item.watch_flag.id, { resolution_note: "Resolved from alert center", follow_up_required: false });
              await markSharedAlertActed(token, item.id, "resolve_watch_flag");
              await load();
              return;
            }
            window.location.hash = toJobHash(item);
          }}
        />
      ) : null}
    </section>
  );
}

export function SharedExceptionsPage({
  token,
  departmentType = null,
  title = "Exceptions",
  summary = "One actionable queue of unresolved operational exceptions across readiness, staffing, production, approvals, delivery, and same-day execution."
}: SharedWatchlistPageProps) {
  const [payload, setPayload] = useState<SharedWatchlistResponse | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [selectedFlag, setSelectedFlag] = useState<SharedWatchFlagListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<SharedWatchlistQuery>({ department_type: departmentType ?? "all" });
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [resolveMode, setResolveMode] = useState<"resolve" | "dismiss" | null>(null);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [snoozeDraft, setSnoozeDraft] = useState<SnoozeDraft>({ snooze_until: defaultDateTimeLocal(), note: "" });
  const [resolveDraft, setResolveDraft] = useState<ResolveDraft>({ resolution_note: "", root_cause: "", follow_up_required: false });
  const [escalationDraft, setEscalationDraft] = useState<EscalationDraft>({
    severity: "high",
    owner_user_id: "",
    escalated_to_role: "",
    due_at: defaultDateTimeLocal(),
    note: ""
  });

  async function load(nextFilters: SharedWatchlistQuery = filters) {
    setLoading(true);
    try {
      const [watchlist, owners] = await Promise.all([listSharedExceptions(token, nextFilters), listDirectoryOwnerOptions(token)]);
      setPayload(watchlist);
      setOwnerOptions(owners.owners);
      setSelectedFlag((current) => watchlist.items.find((item) => item.id === current?.id) ?? watchlist.items[0] ?? null);
      setError("");
    } catch (loadError) {
      setError(messageFor(loadError, "We couldn't load the shared exceptions queue right now."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function refreshAfter(mutator: () => Promise<void>) {
    setSaving(true);
    try {
      await mutator();
      await load();
    } catch (mutationError) {
      setError(messageFor(mutationError, "We couldn't update that exception right now."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <WorkspaceLoadingBlock title={`Loading ${title}`} summary={summary} />;
  }

  return (
    <section className="shared-command">
      <WorkspacePageHeader
        eyebrow={departmentType ? humanizeToken(departmentType) : "Shared"}
        title={title}
        summary={summary}
        meta={
          payload
            ? [
                { label: `${payload.summary.total_count} open exceptions`, tone: payload.summary.total_count ? "warning" : "success" },
                { label: `${payload.summary.next_24_hours_count} next 24h`, tone: payload.summary.next_24_hours_count ? "critical" : "success" }
              ]
            : []
        }
      />
      {payload ? (
        <section className="panel shared-command__saved-views">
          <SavedViewBar
            views={payload.saved_views.map((view) => ({ key: view.id, label: view.name }))}
            activeKey={filters.view_id ?? payload.saved_views[0]?.id ?? "manual"}
            onSelect={(key) => {
              const nextFilters = { ...filters, view_id: key };
              setFilters(nextFilters);
              void load(nextFilters);
            }}
          />
        </section>
      ) : null}
      <section className="panel shared-command__filters">
        {[
          { key: "next_24_hours", label: "Next 24 Hours" },
          { key: "critical_high_only", label: "Critical / High" },
          { key: "only_mine", label: "Only Mine" },
          { key: "only_snoozed", label: "Only Snoozed" }
        ].map((toggle) => (
          <label key={toggle.key} className="shared-command__checkbox">
            <input
              type="checkbox"
              checked={Boolean((filters as Record<string, unknown>)[toggle.key])}
              onChange={(event) => {
                const nextFilters = { ...filters, [toggle.key]: event.target.checked };
                setFilters(nextFilters);
                void load(nextFilters);
              }}
            />
            <span>{toggle.label}</span>
          </label>
        ))}
      </section>
      {error ? <div className="error-banner">{error}</div> : null}
      {payload ? (
        <WatchlistTable
          payload={payload}
          selectedId={selectedFlag?.id ?? null}
          onSelect={setSelectedFlag}
          onOpen={(item) => {
            window.location.hash = toJobHash(item);
          }}
          onAcknowledge={(item) => refreshAfter(() => acknowledgeSharedWatchFlag(token, item.id))}
          onSnooze={(item) => {
            setSelectedFlag(item);
            setSnoozeDraft({ snooze_until: defaultDateTimeLocal(), note: "" });
            setSnoozeOpen(true);
          }}
          onResolve={(item) => {
            setSelectedFlag(item);
            setResolveDraft({ resolution_note: "", root_cause: "", follow_up_required: false });
            setResolveMode("resolve");
          }}
          onDismiss={(item) => {
            setSelectedFlag(item);
            setResolveDraft({ resolution_note: "", root_cause: "", follow_up_required: false });
            setResolveMode("dismiss");
          }}
          onEscalate={(item) => {
            setSelectedFlag(item);
            setEscalationDraft({
              severity: item.severity,
              owner_user_id: item.owner_user_id ?? "",
              escalated_to_role: item.escalated_to_role ?? "",
              due_at: item.due_at ? item.due_at.slice(0, 16) : defaultDateTimeLocal(),
              note: ""
            });
            setEscalateOpen(true);
          }}
        />
      ) : null}
      <WatchFlagSnoozeModal
        open={snoozeOpen}
        draft={snoozeDraft}
        onChange={setSnoozeDraft}
        onClose={() => setSnoozeOpen(false)}
        onSave={async () => {
          if (!selectedFlag) {
            return;
          }
          await refreshAfter(() => snoozeSharedWatchFlag(token, selectedFlag.id, snoozeDraft.snooze_until, snoozeDraft.note));
          setSnoozeOpen(false);
        }}
      />
      <WatchFlagResolutionModal
        open={resolveMode != null}
        mode={resolveMode ?? "resolve"}
        draft={resolveDraft}
        onChange={setResolveDraft}
        onClose={() => setResolveMode(null)}
        onResolve={async () => {
          if (!selectedFlag) {
            return;
          }
          await refreshAfter(() =>
            resolveSharedWatchFlag(token, selectedFlag.id, {
              resolution_note: resolveDraft.resolution_note,
              root_cause: resolveDraft.root_cause,
              follow_up_required: resolveDraft.follow_up_required
            })
          );
          setResolveMode(null);
        }}
        onDismiss={async () => {
          if (!selectedFlag) {
            return;
          }
          await refreshAfter(() => dismissSharedWatchFlag(token, selectedFlag.id, resolveDraft.resolution_note || "Dismissed from exceptions"));
          setResolveMode(null);
        }}
      />
      <OverlayPanel open={escalateOpen} onClose={() => setEscalateOpen(false)} ariaLabel="Escalate exception">
        <WorkspaceSectionHeader title="Escalate Exception" />
        <WatchFlagOwnerPanel
          ownerOptions={ownerOptions}
          draft={escalationDraft}
          onDraftChange={setEscalationDraft}
          onSave={async () => {
            if (!selectedFlag) {
              return;
            }
            await refreshAfter(() =>
              escalateSharedWatchFlag(token, selectedFlag.id, {
                severity: escalationDraft.severity,
                owner_user_id: escalationDraft.owner_user_id || null,
                escalated_to_role: escalationDraft.escalated_to_role || null,
                due_at: escalationDraft.due_at || null,
                note: escalationDraft.note || null
              })
            );
            setEscalateOpen(false);
          }}
        />
      </OverlayPanel>
      {saving ? <div className="shared-command__saving">Saving exception changes...</div> : null}
    </section>
  );
}

export const SharedWatchlistPage = SharedExceptionsPage;

export function DepartmentDashboardPanel({ token, currentUser, departmentType, title, summary, routeHash }: DepartmentDashboardPanelProps) {
  return (
    <section className="shared-command__department-wrapper">
      <RoleAwareHomeDashboard token={token} currentUser={currentUser} scope="home" departmentType={departmentType} title={title} summary={summary} />
      <WorkspaceActionBar>
        <button type="button" onClick={() => (window.location.hash = routeHash)}>
          Open Department Workspace
        </button>
      </WorkspaceActionBar>
    </section>
  );
}
