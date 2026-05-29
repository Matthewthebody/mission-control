import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import type { SportsActivityEntry, SportsKpiCard, SportsOverviewListItem, SportsWatchFlagRecord } from "../../sportsTypes";

export function useHashRouteSnapshot() {
  const [hash, setHash] = useState(() => window.location.hash || "#home");

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash || "#home");
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return useMemo(() => {
    const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
    const [path, queryString = ""] = normalized.split("?");
    return {
      hash,
      path,
      params: new URLSearchParams(queryString)
    };
  }, [hash]);
}

export function humanizeToken(value: string | null | undefined) {
  if (!value) {
    return "Unspecified";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "TBD";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "TBD";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatTimeRange(startTime: string | null | undefined, endTime: string | null | undefined) {
  if (!startTime && !endTime) {
    return "Time TBD";
  }
  return [startTime ?? "TBD", endTime ?? "TBD"].join(" - ");
}

export function toneClass(tone: "neutral" | "info" | "success" | "warning" | "danger") {
  return `sports-tone sports-tone--${tone}`;
}

export function statusTone(status: string | null | undefined) {
  switch (status) {
    case "ready":
    case "ready_to_shoot":
    case "approved":
    case "complete":
    case "paid":
      return "success";
    case "on_track":
    case "clean":
    case "staffed":
    case "checked_in":
    case "ready_confirmed":
    case "sent":
    case "viewed":
      return "info";
    case "blocked":
    case "cancelled":
    case "critical":
    case "overdue":
    case "off_track":
    case "gap_flagged":
    case "error":
      return "danger";
    case "at_risk":
    case "warning":
    case "pending":
    case "queued":
    case "proof_build":
    case "awaiting_client_approval":
    case "revisions_requested":
    case "weather_hold":
      return "warning";
    default:
      return "neutral";
  }
}

export function StatusPill({ label, tone }: { label: string; tone?: "neutral" | "info" | "success" | "warning" | "danger" }) {
  const resolvedTone = tone ?? "neutral";
  return <span className={`sports-status-pill sports-status-pill--${resolvedTone}`}>{label}</span>;
}

export function RiskBadge({ level }: { level: string | null | undefined }) {
  const normalized = (level ?? "none").toLowerCase();
  return <span className={`sports-risk-badge sports-risk-badge--${normalized}`}>{humanizeToken(level ?? "none")}</span>;
}

export function KpiStatCard({ card }: { card: SportsKpiCard }) {
  return (
    <button type="button" className={`panel sports-kpi-card ${toneClass(card.tone)}`} onClick={() => (window.location.hash = card.action_hash)}>
      <span className="sports-kpi-card__label">{card.label}</span>
      <strong className="sports-kpi-card__value">{card.value}</strong>
      <span className="sports-kpi-card__detail">{card.detail}</span>
    </button>
  );
}

export function SavedViewBar({
  views,
  activeKey,
  onSelect
}: {
  views: Array<{ key: string; label: string; hash?: string }>;
  activeKey: string | null;
  onSelect?: (key: string) => void;
}) {
  return (
    <WorkspaceActionBar align="start" className="sports-saved-view-bar">
      {views.map((view) => (
        <button
          key={view.key}
          type="button"
          className={`secondary-button${activeKey === view.key ? " is-active" : ""}`}
          onClick={() => {
            if (onSelect) {
              onSelect(view.key);
            } else if (view.hash) {
              window.location.hash = view.hash;
            }
          }}
        >
          {view.label}
        </button>
      ))}
    </WorkspaceActionBar>
  );
}

export function DetailPreviewPanel({
  title,
  subtitle,
  children,
  actions
}: {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <aside className="panel sports-detail-preview">
      <div className="sports-detail-preview__header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="sports-detail-preview__actions">{actions}</div> : null}
      </div>
      {children}
    </aside>
  );
}

export function OverviewListCard({
  title,
  items,
  emptyTitle,
  emptyDescription
}: {
  title: string;
  items: SportsOverviewListItem[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section className="panel sports-list-card">
      <div className="sports-list-card__header">
        <h3>{title}</h3>
      </div>
      {items.length ? (
        <div className="sports-list-card__items">
          {items.map((item) => (
            <button key={item.id} type="button" className="sports-list-card__item" onClick={() => (window.location.hash = item.action_hash)}>
              <div className="sports-list-card__item-title-row">
                <strong>{item.title}</strong>
                <StatusPill label={humanizeToken(item.tone)} tone={item.tone} />
              </div>
              <div className="sports-list-card__item-summary">{item.summary}</div>
              <div className="sports-list-card__item-meta">
                {item.meta ? <span>{item.meta}</span> : null}
                {item.due_at ? <span>{formatDateTime(item.due_at)}</span> : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title={emptyTitle} summary={emptyDescription} />
      )}
    </section>
  );
}

export function ChangeLogTimeline({ items }: { items: SportsActivityEntry[] }) {
  if (!items.length) {
    return <WorkspaceEmptyState title="No activity yet" summary="Activity and audit entries will appear here as the job moves through execution." compact />;
  }
  return (
    <div className="sports-timeline">
      {items.map((item) => (
        <div key={`${item.source}-${item.id}`} className="sports-timeline__entry">
          <div className="sports-timeline__dot" aria-hidden="true" />
          <div className="sports-timeline__body">
            <div className="sports-timeline__heading">
              <strong>{humanizeToken(item.event_type)}</strong>
              <span>{formatDateTime(item.created_at)}</span>
            </div>
            <div className="sports-timeline__summary">{item.summary}</div>
            <div className="sports-timeline__meta">
              <span>{item.actor_name ?? "System"}</span>
              <span>{item.source === "audit_log" ? "Audit log" : "Department activity"}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WatchFlagList({
  items,
  emptyTitle,
  emptyDescription,
  onSelect
}: {
  items: SportsWatchFlagRecord[];
  emptyTitle: string;
  emptyDescription: string;
  onSelect?: (flag: SportsWatchFlagRecord) => void;
}) {
  if (!items.length) {
    return <WorkspaceEmptyState title={emptyTitle} summary={emptyDescription} compact />;
  }
  return (
    <div className="sports-watch-flag-list">
      {items.map((flag) => (
        <button
          key={flag.id}
          type="button"
          className={`sports-watch-flag-list__item sports-watch-flag-list__item--${flag.severity}`}
          onClick={() => {
            if (onSelect) {
              onSelect(flag);
            } else if (flag.shoot_id) {
      window.location.hash = `#sports/jobs/${flag.shoot_id}`;
            }
          }}
        >
          <div className="sports-watch-flag-list__title-row">
            <strong>{flag.title}</strong>
            <RiskBadge level={flag.severity} />
          </div>
          <div className="sports-watch-flag-list__summary">{flag.description ?? humanizeToken(flag.flag_type)}</div>
          <div className="sports-watch-flag-list__meta">
            <span>{flag.organization_name ?? "No account"}</span>
            <span>{flag.owner_name ?? "Unassigned"}</span>
            <span>{flag.due_at ? formatDateTime(flag.due_at) : "No due time"}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
