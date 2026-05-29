import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import { canAccessEmployeeMyWork, canAccessRoute, canAccessSection } from "../permissions";
import {
  getEmployeesWorkspace,
  type EmployeesWorkspaceHighlight,
  type EmployeesWorkspaceResponse,
  type EmployeesWorkspaceSummaryCard,
  type EmployeesWorkspaceTimeBand
} from "../services/employeesWorkspace";
import { TIME_CLOCK_STATE_CHANGED_EVENT } from "../services/timeClockApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

export function EmployeesWorkspace({ token, currentUser, socket }: Props) {
  const canViewWorkspace = canAccessSection(currentUser, "employees");
  const canOpenMyDay = canAccessEmployeeMyWork(currentUser);
  const canOpenSchedule = canAccessRoute(currentUser, "operations-schedule") || canAccessRoute(currentUser, "dashboard-my-schedule");
  const canOpenDirectoryInternal = canAccessRoute(currentUser, "directory-internal");
  const [date, setDate] = useState(getLocalDateString());
  const [workspace, setWorkspace] = useState<EmployeesWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(options: { quiet?: boolean } = {}) {
    if (!canViewWorkspace) {
      setWorkspace(null);
      setLoading(false);
      setError("");
      return;
    }
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const payload = await getEmployeesWorkspace(token, { date });
      setWorkspace(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the Employees workspace.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, [canViewWorkspace, date, token]);

  useEffect(() => {
    if (!workspace || !canViewWorkspace) {
      return;
    }
    const interval = window.setInterval(() => {
      void load({ quiet: true });
    }, Math.max(workspace.refresh_interval_seconds, 30) * 1000);
    return () => window.clearInterval(interval);
  }, [canViewWorkspace, token, workspace?.refresh_interval_seconds, date]);

  useEffect(() => {
    const onRefresh = () => {
      void load({ quiet: true });
    };
    window.addEventListener("focus", onRefresh);
    window.addEventListener(TIME_CLOCK_STATE_CHANGED_EVENT, onRefresh as EventListener);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(TIME_CLOCK_STATE_CHANGED_EVENT, onRefresh as EventListener);
    };
  }, [date, token, canViewWorkspace]);

  useEffect(() => {
    if (!socket || !canViewWorkspace) {
      return;
    }
    const onRefresh = () => {
      void load({ quiet: true });
    };
    socket.on("schedule_changed", onRefresh);
    socket.on("attendance_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    socket.on("status_event", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("attendance_changed", onRefresh);
      socket.off("notification_created", onRefresh);
      socket.off("status_event", onRefresh);
    };
  }, [canViewWorkspace, date, socket, token]);

  if (!canViewWorkspace) {
    return (
      <section className="panel employees-workspace employees-workspace--limited">
        <WorkspaceEmptyState
          title="Employees Workspace"
          summary="Employees owns requests, approvals, time status, readiness, and employee follow-through. It is not an operations control room."
          actions={
            <>
              {canOpenMyDay ? (
                <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#dashboard/my-day")}>
                  Open My Day
                </button>
              ) : null}
              {canOpenSchedule ? (
                <button className="secondary-button" type="button" onClick={() => (window.location.hash = "#schedule")}>
                  Open Schedule
                </button>
              ) : null}
              <button className="primary-button" type="button" onClick={() => (window.location.hash = "#approvals")}>
                Open Approvals
              </button>
            </>
          }
        />
      </section>
    );
  }

  return (
    <div className="employees-workspace">
      <WorkspacePageHeader
        eyebrow="Employees"
        title={workspace?.role_mode === "employee" ? "Stay ahead of your people-side work" : "Run the people side of the day"}
        summary="Employees owns requests, approvals, schedule context, time/pay review, readiness, and employee follow-through without turning into Operations."
        meta={
          workspace
            ? [
                { label: `Updated ${formatRefreshTime(workspace.generated_at)}`, tone: "info" },
                { label: `Mode: ${humanizeRoleMode(workspace.role_mode)}` }
              ]
            : []
        }
        compact
        className="employees-workspace__hero"
      />

      <WorkspaceFilterToolbar>
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Anchor Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <div className="workspace-toolbar__actions">
          <button className="secondary-button" type="button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </WorkspaceFilterToolbar>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading && !workspace ? (
        <WorkspaceLoadingBlock
          title="Loading Employees"
          summary="Pulling requests, time state, approvals, readiness, and employee follow-through into one workspace."
        />
      ) : null}

      {workspace ? (
        <>
          <div className="employees-workspace__summary">
            {workspace.summary_strip.map((card) => (
              <SummaryCard key={card.id} card={card} />
            ))}
          </div>

          {workspace.my_work ? (
            <section className="panel dashboard-panel employees-workspace__block">
              <OperationalDetailSection
                title={workspace.my_work.headline}
                summary={workspace.my_work.summary_line}
                badge={workspace.role_mode === "employee" ? "Personal" : "Personal Surface"}
                defaultOpen
                actions={
                  <WorkspaceActionBar compact>
                    <button type="button" className="secondary-button" onClick={() => (window.location.hash = workspace.my_work?.primary_action_hash ?? "#dashboard/my-day")}>
                      {workspace.my_work.primary_action_label}
                    </button>
                    {workspace.my_work.secondary_action_hash && workspace.my_work.secondary_action_label ? (
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = workspace.my_work?.secondary_action_hash ?? "#schedule")}>
                        {workspace.my_work.secondary_action_label}
                      </button>
                    ) : null}
                  </WorkspaceActionBar>
                }
              >
                <ModuleCardGrid cards={workspace.my_work.cards} />
                <HighlightGrid highlights={workspace.my_work.highlights} emptyLabel="No personal work items are standing out beyond the summary cards." />
              </OperationalDetailSection>
            </section>
          ) : null}

          {workspace.time_pay ? <TimePayBand timePay={workspace.time_pay} /> : null}

          {workspace.requests_approvals ? (
            <section className="panel dashboard-panel employees-workspace__block">
              <OperationalDetailSection
                title={workspace.requests_approvals.headline}
                summary={workspace.requests_approvals.summary_line}
                badge={workspace.role_mode === "employee" ? "My Queue" : "People Queue"}
                defaultOpen
                actions={
                  <WorkspaceActionBar compact>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => (window.location.hash = workspace.requests_approvals?.primary_action_hash ?? "#approvals")}
                    >
                      {workspace.requests_approvals.primary_action_label}
                    </button>
                    {workspace.requests_approvals.secondary_action_hash && workspace.requests_approvals.secondary_action_label ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => (window.location.hash = workspace.requests_approvals?.secondary_action_hash ?? "#employees/requests")}
                      >
                        {workspace.requests_approvals.secondary_action_label}
                      </button>
                    ) : null}
                  </WorkspaceActionBar>
                }
              >
                <ModuleCardGrid cards={workspace.requests_approvals.cards} />
                <HighlightGrid highlights={workspace.requests_approvals.highlights} emptyLabel="No request or approval rows are standing out right now." />
              </OperationalDetailSection>
            </section>
          ) : null}

          {workspace.training_readiness ? (
            <section className="panel dashboard-panel employees-workspace__block">
              <OperationalDetailSection
                title={workspace.training_readiness.headline}
                summary={workspace.training_readiness.summary_line}
                badge={workspace.role_mode === "employee" ? "Readiness" : "Team Readiness"}
                defaultOpen={workspace.role_mode !== "employee"}
                actions={
                  <WorkspaceActionBar compact>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => (window.location.hash = workspace.training_readiness?.primary_action_hash ?? "#employees/training")}
                    >
                      {workspace.training_readiness.primary_action_label}
                    </button>
                    {workspace.training_readiness.secondary_action_hash && workspace.training_readiness.secondary_action_label ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => (window.location.hash = workspace.training_readiness?.secondary_action_hash ?? "#employees/readiness")}
                      >
                        {workspace.training_readiness.secondary_action_label}
                      </button>
                    ) : null}
                  </WorkspaceActionBar>
                }
              >
                <ModuleCardGrid cards={workspace.training_readiness.cards} />
                <HighlightGrid highlights={workspace.training_readiness.highlights} emptyLabel="No training or readiness rows are standing out beyond the summary cards." />
              </OperationalDetailSection>
            </section>
          ) : null}

          {workspace.record ? (
            <section className="panel dashboard-panel employees-workspace__block employees-workspace__record">
              <OperationalDetailSection
                title={workspace.record.headline}
                summary={workspace.record.summary_line}
                badge="Record"
                actions={
                  <WorkspaceActionBar compact>
                    {workspace.record.links.map((link) => (
                      <button key={link.label} type="button" className="secondary-button" onClick={() => (window.location.hash = link.action_hash)}>
                        {link.label}
                      </button>
                    ))}
                    {canOpenDirectoryInternal ? (
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#directory/internal")}>
                        Open Internal Directory
                      </button>
                    ) : null}
                  </WorkspaceActionBar>
                }
              >
                <div className="employees-record-grid">
                  {workspace.record.items.map((item) => (
                    <div key={item.label} className="employees-record-field">
                      <span className="eyebrow">{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </OperationalDetailSection>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ card }: { card: EmployeesWorkspaceSummaryCard }) {
  return (
    <button
      type="button"
      className={`metric-card metric-card--button employees-summary-card employees-summary-card--${card.tone}`}
      onClick={() => (window.location.hash = card.action_hash)}
    >
      <div className="metric-card__label">{card.label}</div>
      <strong className="metric-card__value">{card.count}</strong>
      <div className="muted">{card.detail}</div>
    </button>
  );
}

function ModuleCardGrid({ cards, compact = false }: { cards: EmployeesWorkspaceSummaryCard[]; compact?: boolean }) {
  return (
    <div className={`employees-module-card-grid${compact ? " employees-module-card-grid--compact" : ""}`}>
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className={`metric-card metric-card--button employees-module-card employees-module-card--${card.tone}`}
          onClick={() => (window.location.hash = card.action_hash)}
        >
          <div className="metric-card__label">{card.label}</div>
          <strong className="metric-card__value">{card.count}</strong>
          <div className="muted">{card.detail}</div>
        </button>
      ))}
    </div>
  );
}

function HighlightGrid({ highlights, emptyLabel }: { highlights: EmployeesWorkspaceHighlight[]; emptyLabel: string }) {
  return (
    <div className="employees-highlight-grid">
      {highlights.map((highlight) => (
        <OperationalPreviewCard
          key={highlight.id}
          eyebrow={highlight.eyebrow}
          title={highlight.title}
          summary={highlight.summary}
          statusLabel={highlight.status_label}
          statusTone={highlight.tone}
          nextAction="Open owner workspace"
          density="compact"
          onClick={() => (window.location.hash = highlight.action_hash)}
        />
      ))}
      {!highlights.length ? <div className="empty-state empty-state--panel">{emptyLabel}</div> : null}
    </div>
  );
}

function TimePayBand({ timePay }: { timePay: EmployeesWorkspaceTimeBand }) {
  return (
    <section className={`panel employees-time-band employees-time-band--${mapEmphasisTone(timePay.emphasis)}`} aria-label="Time and pay status">
      <WorkspaceSectionHeader
        title={timePay.headline}
        summary={timePay.summary_line}
        badge={<span className={`home-tone-chip home-tone-chip--${mapEmphasisTone(timePay.emphasis)}`}>{timePay.label}</span>}
        actions={
          <WorkspaceActionBar compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = timePay.action_hash)}>
              {timePay.action_label}
            </button>
            {timePay.schedule_hash ? (
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = timePay.schedule_hash ?? "#schedule")}>
                Open Schedule
              </button>
            ) : null}
            {timePay.secondary_action_hash && timePay.secondary_action_label ? (
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = timePay.secondary_action_hash ?? "#employees/payroll")}>
                {timePay.secondary_action_label}
              </button>
            ) : null}
          </WorkspaceActionBar>
        }
      />
      <div className="employees-time-band__grid">
        <div className="employees-time-band__metric">
          <span className="eyebrow">Clock State</span>
          <strong>{timePay.label}</strong>
          <span className="muted">{timePay.elapsed_label ?? timePay.helper_text}</span>
        </div>
        <div className="employees-time-band__metric">
          <span className="eyebrow">Current Context</span>
          <strong>{timePay.shift_label ?? "No live shift context"}</strong>
          <span className="muted">{timePay.location_label ?? "Open Schedule if you need the full assignment view."}</span>
        </div>
        <div className="employees-time-band__metric">
          <span className="eyebrow">Review State</span>
          <strong>{timePay.review_label ?? "No open review"}</strong>
          <span className="muted">{timePay.helper_text}</span>
        </div>
      </div>
      <ModuleCardGrid cards={timePay.metrics} compact />
      <div className="employees-time-band__note">
        The shell punch control at the top of the app is still the live punch surface. Employees stays read-only here so it does not become a second timeclock.
      </div>
    </section>
  );
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRefreshTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function mapEmphasisTone(emphasis: EmployeesWorkspaceTimeBand["emphasis"]) {
  switch (emphasis) {
    case "red":
      return "action_needed";
    case "green":
      return "good";
    case "amber":
      return "heads_up";
    default:
      return "info";
  }
}

function humanizeRoleMode(value: EmployeesWorkspaceResponse["role_mode"]) {
  switch (value) {
    case "employee":
      return "Employee";
    case "manager":
      return "Manager";
    case "admin":
      return "Admin";
    default:
      return value;
  }
}
