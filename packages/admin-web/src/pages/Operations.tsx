import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import {
  canAccessComplianceWorkspace,
  canAccessOperatingSystemModule
} from "../permissions";
import { getOperationsControlRoom } from "../services/operationsControlRoom";
import type { OperationsControlRoomItem, OperationsControlRoomResponse, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

export function Operations({ token, currentUser, socket }: Props) {
  const canViewControlRoom = canAccessOperatingSystemModule(currentUser, "operations");
  const canViewCompliance = canAccessComplianceWorkspace(currentUser);
  const [date, setDate] = useState(getLocalDateString());
  const [workspace, setWorkspace] = useState<OperationsControlRoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const liveReadySignals = workspace?.live_execution.ready_signals ?? [];

  async function load(options: { quiet?: boolean } = {}) {
    if (!canViewControlRoom) {
      setWorkspace(null);
      setLoading(false);
      setError("");
      return;
    }
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const payload = await getOperationsControlRoom(token, { date });
      setWorkspace(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the Operations control room.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, [canViewControlRoom, date, token]);

  useEffect(() => {
    if (!canViewControlRoom || !workspace) {
      return;
    }
    const interval = window.setInterval(() => {
      void load({ quiet: true });
    }, Math.max(workspace.refresh_interval_seconds, 30) * 1000);
    return () => window.clearInterval(interval);
  }, [canViewControlRoom, date, token, workspace?.refresh_interval_seconds]);

  useEffect(() => {
    if (!socket || !canViewControlRoom) {
      return;
    }
    const onRefresh = () => {
      void load({ quiet: true });
    };
    socket.on("schedule_changed", onRefresh);
    socket.on("attendance_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    socket.on("status_event", onRefresh);
    socket.on("alert_created", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("attendance_changed", onRefresh);
      socket.off("notification_created", onRefresh);
      socket.off("status_event", onRefresh);
      socket.off("alert_created", onRefresh);
    };
  }, [canViewControlRoom, date, socket, token]);

  if (!canViewControlRoom) {
    return (
      <section className="panel operations-control-room operations-control-room--limited">
        <WorkspaceEmptyState
          title="Operations Control Room"
          summary="Operations is for live day-of coordination. Personal assignment work still belongs in My Day, Schedule, and the Shoots queue."
          actions={
            <>
              <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#dashboard/my-day")}>
                Open My Day
              </button>
              <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#schedule")}>
                Open Schedule
              </button>
              <button className="primary-button" type="button" onClick={() => (window.location.hash = "#operations/shoots")}>
                Open Shoots
              </button>
            </>
          }
        />
      </section>
    );
  }

  return (
    <div className="operations-control-room">
      <WorkspacePageHeader
        eyebrow="Operations"
        title="Same-day live control room"
        summary="Operations owns live staffing, attendance, readiness, logistics, and exceptions for today. It should tell you what is going wrong now and who owns the fix."
        meta={workspace ? [{ label: `Updated ${formatRefreshTime(workspace.generated_at)}`, tone: "info" }] : []}
        actions={
          <>
            <label className="filter-field">
              <span>Anchor Date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void load()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </>
        }
        compact
        className="operations-control-room__hero"
      />

      {error ? <div className="error-banner">{error}</div> : null}

      {loading && !workspace ? (
        <WorkspaceLoadingBlock
          title="Loading Operations"
          summary="Pulling live exceptions, staffing, attendance, readiness, and shoot pressure into one control room."
        />
      ) : null}

      {workspace ? (
        <>
          <div className="operations-control-room__summary">
            {workspace.summary_band.map((metric) => (
              <button
                key={metric.id}
                type="button"
                className={`metric-card metric-card--button operations-summary-card operations-summary-card--${metric.tone}`}
                onClick={() => (window.location.hash = metric.action_hash)}
              >
                <div className="metric-card__label">{metric.label}</div>
                <strong className="metric-card__value">{metric.count}</strong>
                <div className="muted">{metric.detail}</div>
              </button>
            ))}
          </div>

          <section className="panel dashboard-panel operations-control-room__block operations-control-room__block--urgent">
            <WorkspaceSectionHeader
              title={workspace.urgent_watch.headline}
              summary={workspace.urgent_watch.summary_line}
              actions={
                <WorkspaceActionBar compact>
                  <span className="metric-pill">Updated {formatRefreshTime(workspace.urgent_watch.generated_at)}</span>
                  <button className="primary-button" type="button" onClick={() => (window.location.hash = workspace.urgent_watch.action_hash)}>
                    Open Full Exceptions Queue
                  </button>
                </WorkspaceActionBar>
              }
            />
            <div className="ops-preview-list">
              {workspace.urgent_watch.items.map((item) => (
                <PreviewItemCard key={item.id} item={item} onOpen={() => (window.location.hash = item.action_hash)} />
              ))}
              {!workspace.urgent_watch.items.length ? (
                <div className="empty-state empty-state--panel">No open exceptions are active for this date.</div>
              ) : null}
            </div>
          </section>

          <section className="panel dashboard-panel operations-control-room__block">
            <OperationalDetailSection
              title={workspace.staffing_pressure.headline}
              summary={workspace.staffing_pressure.summary_line}
              badge={workspace.staffing_pressure.generated_at ? `Updated ${formatRefreshTime(workspace.staffing_pressure.generated_at)}` : "Live"}
              defaultOpen
              actions={
                <button
                  type="button"
                  className="secondary-button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    window.location.hash = workspace.staffing_pressure.action_hash;
                  }}
                >
                  Open Scheduling
                </button>
              }
            >
              <div className="operations-block-metrics">
                {workspace.staffing_pressure.metrics.map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    className={`metric-card metric-card--button operations-inline-metric operations-inline-metric--${metric.tone}`}
                    onClick={() => (window.location.hash = metric.action_hash)}
                  >
                    <div className="metric-card__label">{metric.label}</div>
                    <strong className="metric-card__value">{metric.count}</strong>
                    <div className="muted">{metric.detail}</div>
                  </button>
                ))}
              </div>
              <div className="ops-preview-list">
                {workspace.staffing_pressure.items.map((item) => (
                  <PreviewItemCard key={item.id} item={item} onOpen={() => (window.location.hash = item.action_hash)} />
                ))}
                {!workspace.staffing_pressure.items.length ? (
                  <div className="empty-state empty-state--panel">No staffing rows are standing out beyond the summary counts.</div>
                ) : null}
              </div>
            </OperationalDetailSection>
          </section>

          <section className="panel dashboard-panel operations-control-room__block">
            <OperationalDetailSection
              title={workspace.attendance_impact.headline}
              summary={workspace.attendance_impact.summary_line}
              badge={workspace.attendance_impact.generated_at ? `Updated ${formatRefreshTime(workspace.attendance_impact.generated_at)}` : "Live"}
              defaultOpen
              actions={
                <button
                  type="button"
                  className="secondary-button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    window.location.hash = workspace.attendance_impact.action_hash;
                  }}
                >
                  Open Attendance
                </button>
              }
            >
              <div className="operations-block-metrics">
                {workspace.attendance_impact.metrics.map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    className={`metric-card metric-card--button operations-inline-metric operations-inline-metric--${metric.tone}`}
                    onClick={() => (window.location.hash = metric.action_hash)}
                  >
                    <div className="metric-card__label">{metric.label}</div>
                    <strong className="metric-card__value">{metric.count}</strong>
                    <div className="muted">{metric.detail}</div>
                  </button>
                ))}
              </div>
              <div className="ops-preview-list">
                {workspace.attendance_impact.items.map((item) => (
                  <PreviewItemCard key={item.id} item={item} onOpen={() => (window.location.hash = item.action_hash)} />
                ))}
                {!workspace.attendance_impact.items.length ? (
                  <div className="empty-state empty-state--panel">No attendance items are standing out beyond the summary counts.</div>
                ) : null}
              </div>
            </OperationalDetailSection>
          </section>

          <section className="panel dashboard-panel operations-control-room__block">
            <OperationalDetailSection
              title={workspace.live_execution.headline}
              summary={workspace.live_execution.summary_line}
              badge={workspace.live_execution.generated_at ? `Updated ${formatRefreshTime(workspace.live_execution.generated_at)}` : "Live"}
              defaultOpen
            >
              {liveReadySignals.length ? (
                <div className="operations-ready-signals">
                  <WorkspaceSectionHeader
                    eyebrow="Readiness"
                    title="Ready to Shoot"
                    summary="Lead photographers can confirm when they are on site and fully set up. Keep that signal visible here instead of burying it in a secondary route."
                    actions={
                      <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#operations/readiness")}>
                        Open Readiness
                      </button>
                    }
                    compact
                  />
                  <div className="operations-ready-signals__grid">
                    {liveReadySignals.map((signal) => (
                      <button
                        key={signal.id}
                        type="button"
                        className={`operations-ready-signal operations-ready-signal--${signal.tone}`}
                        onClick={() => (window.location.hash = signal.action_hash)}
                      >
                        <div className="operations-ready-signal__top">
                          <span className="eyebrow">{signal.shoot_code}</span>
                          <span className={`home-tone-chip home-tone-chip--${mapOperationsToneToHomeTone(signal.tone)}`}>{signal.status_label}</span>
                        </div>
                        <strong>{signal.title}</strong>
                        <p>{signal.detail}</p>
                        <div className="operations-ready-signal__meta">
                          <span>{signal.confirmed_at ? formatRefreshTime(signal.confirmed_at) : "Awaiting field signal"}</span>
                          <span>{signal.confirmed_by_label ?? "Lead photographer"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="operations-route-grid">
                {workspace.live_execution.routes.map((route) => (
                  <button
                    key={route.id}
                    type="button"
                    className={`metric-card metric-card--button operations-route-card operations-route-card--${route.tone}`}
                    onClick={() => (window.location.hash = route.action_hash)}
                  >
                    <div className="metric-card__label">{route.title}</div>
                    <strong className="metric-card__value">{route.count ?? "Open"}</strong>
                    <div className="muted">{route.summary}</div>
                  </button>
                ))}
              </div>

              <div className="ops-preview-list">
                {workspace.live_execution.items.map((item) => (
                  <PreviewItemCard key={item.id} item={item} onOpen={() => (window.location.hash = item.action_hash)} />
                ))}
                {!workspace.live_execution.items.length ? (
                  <div className="empty-state empty-state--panel">No live shoot items are surfacing outside the route summaries right now.</div>
                ) : null}
              </div>

              {canViewCompliance ? (
                <div className="operations-boundary-callout">
                  <div>
                    <strong>Needs Attention belongs beside Operations, not buried inside it.</strong>
                    <div className="muted">Payroll confidence, mileage blockers, off-clock uploads, and end-of-day accountability belong in the shared review queue.</div>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#needs-attention")}>
                    Open Needs Attention
                  </button>
                </div>
              ) : null}
            </OperationalDetailSection>
          </section>

          <section className="panel dashboard-panel operations-control-room__block">
            <OperationalDetailSection
              title={workspace.recent_activity.headline}
              summary={workspace.recent_activity.summary_line}
              badge={`Updated ${formatRefreshTime(workspace.recent_activity.generated_at)}`}
            >
              <div className="ops-preview-list">
                {workspace.recent_activity.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="operations-activity-row"
                    onClick={() => (window.location.hash = item.action_hash)}
                  >
                    <div className="eyebrow">{item.module_label}</div>
                    <strong>{item.summary}</strong>
                    <div className="muted">
                      {item.actor_label} | {formatRefreshTime(item.created_at)}
                    </div>
                  </button>
                ))}
                {!workspace.recent_activity.items.length ? (
                  <div className="empty-state empty-state--panel">No recent operational history is available yet.</div>
                ) : null}
              </div>
            </OperationalDetailSection>
          </section>
        </>
      ) : null}
    </div>
  );
}

function mapOperationsToneToHomeTone(tone: OperationsControlRoomItem["tone"] | "neutral") {
  switch (tone) {
    case "critical":
      return "action_needed";
    case "warning":
      return "heads_up";
    case "success":
      return "good";
    default:
      return "info";
  }
}

function PreviewItemCard({ item, onOpen }: { item: OperationsControlRoomItem; onOpen: () => void }) {
  return (
    <OperationalPreviewCard
      eyebrow={item.eyebrow}
      title={item.title}
      summary={item.summary}
      owner={item.owner_label}
      statusLabel={item.status_label}
      statusTone={item.tone}
      meta={item.meta}
      flags={item.flags}
      nextAction={item.next_action}
      density="compact"
      onClick={onOpen}
    />
  );
}

function formatRefreshTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function getLocalDateString() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
