import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { buildShellRouteHash } from "../../navigation";
import { canAccessRoute, canCreateShootRecords } from "../../permissions";
import { getHomeDashboard } from "../../services/homeDashboard";
import type {
  HomeDepartmentTaskCounts,
  HomeDashboardResponse,
  HomeSurfaceFocusItem,
  HomeSurfaceMyDayItem,
  HomeSurfaceStaffingBand,
  HomeSurfaceTimeBand,
  HomeUrgentWatchItem,
  HomeWidgetTone,
  SessionUser
} from "../../types";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  onOpenConcierge?: (initialQuery?: string) => void;
  createEventHash: string;
  createTaskHash: string;
};

type TopAction = {
  label: string;
  hash: string;
  tone: "primary" | "secondary";
};

type OperationalSummaryCard = {
  key: string;
  title: string;
  count: number;
  summary: string;
  actionLabel: string;
  hash: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

type MovingItem = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  metaPrimary: string;
  metaSecondary: string | null;
  actionLabel: string;
  actionHash: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

type CachedHomeDashboard = {
  loadedAt: number;
  payload: HomeDashboardResponse;
};

const HOME_CACHE_TTL_MS = 45_000;
const homeDashboardCache = new Map<string, CachedHomeDashboard>();
const EMPTY_TASK_COUNTS: HomeDepartmentTaskCounts = {
  schools: null,
  sports: null,
  production: null
};

function isCacheFresh(loadedAt: number, ttlMs: number) {
  return Date.now() - loadedAt <= ttlMs;
}

function navigateToHash(hash: string) {
  window.location.hash = hash;
}

function formatHomeTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function mapTone(tone: HomeWidgetTone | undefined): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (tone) {
    case "good":
      return "success";
    case "heads_up":
      return "warning";
    case "action_needed":
      return "danger";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

function getTimeClockHeadline(timeBand: HomeSurfaceTimeBand) {
  switch (timeBand.state) {
    case "active":
      return "Clocked in now";
    case "off_shift":
      return "Ready to clock in";
    case "action_needed":
      return "Clock-in needed";
    case "needs_review":
      return "Time review needed";
    case "ended_today":
      return "Clocked out";
    default:
      return timeBand.label;
  }
}

function getTimeClockActionLabel(timeBand: HomeSurfaceTimeBand) {
  switch (timeBand.state) {
    case "active":
      return "Clock Out";
    case "off_shift":
    case "action_needed":
      return "Clock In";
    case "needs_review":
      return "Review Time";
    case "ended_today":
      return "View Schedule";
    default:
      return timeBand.action_label || "Open Time Clock";
  }
}

function getTimeClockTone(timeBand: HomeSurfaceTimeBand) {
  if (timeBand.state === "active") {
    return "success";
  }
  if (timeBand.state === "ended_today") {
    return "neutral";
  }
  if (timeBand.state === "off_shift") {
    return "info";
  }
  return "warning";
}

function getAttendanceMetrics(staffingBand: HomeSurfaceStaffingBand | null) {
  if (!staffingBand?.visible) {
    return [];
  }

  const order: Array<{
    id: "in_field" | "in_office" | "assigned_but_missing";
    label: string;
  }> = [
    { id: "in_field", label: "Clocked In - Field" },
    { id: "in_office", label: "Clocked In - Office" },
    { id: "assigned_but_missing", label: "Expected In, Not Clocked In" }
  ];

  return order
    .map((entry) => {
      const metric = staffingBand.metrics.find((item) => item.id === entry.id);
      if (!metric) {
        return null;
      }
      return {
        ...metric,
        label: entry.label,
        tone: mapTone(metric.tone)
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
}

function findCompactWidget(payload: HomeDashboardResponse | null, id: string) {
  return payload?.home_surface?.compact_widgets.find((widget) => widget.id === id) ?? null;
}

function buildMovingItems(payload: HomeDashboardResponse | null): MovingItem[] {
  const homeSurface = payload?.home_surface;
  if (!homeSurface) {
    return [];
  }

  if (homeSurface.today_and_next_up?.visible) {
    return [...homeSurface.today_and_next_up.today, ...homeSurface.today_and_next_up.next_up]
      .slice(0, 4)
      .map((item: HomeSurfaceFocusItem) => ({
        id: item.id,
        eyebrow: item.source_label,
        title: item.title,
        summary: item.summary,
        metaPrimary: item.owner_label,
        metaSecondary: item.due_label,
        actionLabel: item.next_action,
        actionHash: item.action_hash,
        tone: mapTone(item.tone)
      }));
  }

  if (homeSurface.my_day?.visible) {
    return homeSurface.my_day.items.slice(0, 4).map((item: HomeSurfaceMyDayItem) => ({
      id: item.id,
      eyebrow: item.time_label,
      title: item.title,
      summary: item.summary,
      metaPrimary: item.role_label,
      metaSecondary: item.location_label,
      actionLabel: item.next_action,
      actionHash: item.action_hash,
      tone: mapTone(item.tone)
    }));
  }

  return [];
}

function buildSummaryCards(input: {
  payload: HomeDashboardResponse | null;
  taskCounts: HomeDepartmentTaskCounts;
  canOpenToday: boolean;
  canOpenStaffing: boolean;
  canOpenSchoolTasks: boolean;
  canOpenSportsTasks: boolean;
  canOpenProductionTasks: boolean;
  canOpenProductionQueue: boolean;
}) {
  const cards: OperationalSummaryCard[] = [];
  const todayShoots = input.payload?.widgets.today_shoots ?? null;
  const productionProjects = input.payload?.widgets.production_projects ?? null;
  const staffingWidget = findCompactWidget(input.payload, "staffing_health");
  const productionWidget = findCompactWidget(input.payload, "production_snapshot");

  if (input.canOpenToday && todayShoots) {
    cards.push({
      key: "shoots_today",
      title: "Shoots Today",
      count: todayShoots.total,
      summary: "Scheduled shoots happening today",
      actionLabel: "View Today's Jobs",
      hash: "#operations/today",
      tone: todayShoots.needs_attention_count > 0 ? "warning" : "info"
    });
  }

  if (input.canOpenStaffing) {
    const fallbackCount =
      input.payload?.widgets.today_shoots.shoots.filter(
        (shoot) => shoot.staffing_readiness_tone === "action_needed" || shoot.staffing_readiness_tone === "heads_up"
      ).length ?? 0;
    const staffingTone = staffingWidget ? mapTone(staffingWidget.tone) : fallbackCount > 0 ? "warning" : "success";

    cards.push({
      key: "staffing_gaps",
      title: "Staffing Gaps",
      count: staffingWidget?.count ?? fallbackCount,
      summary: "Jobs missing leads or needed coverage",
      actionLabel: "View Staffing Gaps",
      hash: staffingWidget?.action_hash || "#operations/staffing?area=staffing",
      tone: staffingTone
    });
  }

  if (input.canOpenProductionQueue && productionProjects) {
    cards.push({
      key: "digital_production",
      title: "Jobs in Digital Production",
      count: productionWidget?.count ?? productionProjects.counts.active_jobs,
      summary: "Jobs currently moving through digital production",
      actionLabel: "View Production Queue",
      hash: productionWidget?.action_hash || buildShellRouteHash("production-workload"),
      tone:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? "warning"
          : mapTone(productionWidget?.tone)
    });
  }

  if (input.canOpenSchoolTasks && input.taskCounts.schools != null) {
    cards.push({
      key: "school_tasks",
      title: "School Tasks",
      count: input.taskCounts.schools,
      summary: "Open school-related tasks in this scope",
      actionLabel: "View School Tasks",
      hash: "#schools/tasks",
      tone: input.taskCounts.schools > 0 ? "info" : "success"
    });
  }

  if (input.canOpenSportsTasks && input.taskCounts.sports != null) {
    cards.push({
      key: "sports_tasks",
      title: "Sports Tasks",
      count: input.taskCounts.sports,
      summary: "Open sports-related tasks in this scope",
      actionLabel: "View Sports Tasks",
      hash: "#sports/tasks",
      tone: input.taskCounts.sports > 0 ? "info" : "success"
    });
  }

  if (input.canOpenProductionTasks && input.taskCounts.production != null) {
    cards.push({
      key: "production_tasks",
      title: "Production Tasks",
      count: input.taskCounts.production,
      summary: "Open production-related tasks in this scope",
      actionLabel: "View Production Tasks",
      hash: "#production/tasks",
      tone: input.taskCounts.production > 0 ? "info" : "success"
    });
  }

  return cards.slice(0, 6);
}

export function HomeCommandSurface({
  token,
  currentUser,
  socket,
  onOpenConcierge = () => undefined,
  createEventHash,
  createTaskHash
}: Props) {
  const cacheKey = `${token}:${currentUser.id}`;
  const cachedDashboard = homeDashboardCache.get(cacheKey);
  const [dashboard, setDashboard] = useState<HomeDashboardResponse | null>(cachedDashboard?.payload ?? null);
  const [loading, setLoading] = useState(cachedDashboard == null);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");

  const canCreateEvent = canCreateShootRecords(currentUser);
  const canCreateTask = canAccessRoute(currentUser, "task-new");
  const canOpenSchedule = canAccessRoute(currentUser, "dashboard-my-schedule");
  const canOpenAlerts = canAccessRoute(currentUser, "dashboard-alerts");
  const canOpenMyTasks = canAccessRoute(currentUser, "dashboard-my-tasks");
  const canOpenAttendance = canAccessRoute(currentUser, "operations-attendance");
  const canOpenToday = canAccessRoute(currentUser, "operations-today");
  const canOpenStaffing = canAccessRoute(currentUser, "operations-staffing");
  const canOpenProductionQueue = canAccessRoute(currentUser, "production") || canAccessRoute(currentUser, "production-workload");
  const canOpenSchoolTasks = canAccessRoute(currentUser, "operations-schools");
  const canOpenSportsTasks = canAccessRoute(currentUser, "sports");
  const canOpenProductionTasks = canAccessRoute(currentUser, "production-workload");
  const taskCounts = dashboard?.widgets.department_task_counts ?? EMPTY_TASK_COUNTS;

  async function loadHome(options: { quiet?: boolean; force?: boolean } = {}) {
    const quiet = options.quiet ?? false;
    const dashboardEntry = homeDashboardCache.get(cacheKey);
    const needsDashboard = options.force || !dashboardEntry || !isCacheFresh(dashboardEntry.loadedAt, HOME_CACHE_TTL_MS);

    if (!quiet && dashboard == null) {
      setLoading(true);
    }

    try {
      const dashboardPayload = needsDashboard ? await getHomeDashboard(token, "app") : dashboardEntry?.payload ?? dashboard;

      if (dashboardPayload) {
        setDashboard(dashboardPayload);
        homeDashboardCache.set(cacheKey, { payload: dashboardPayload, loadedAt: Date.now() });
      }
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load Home right now.");
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const dashboardEntry = homeDashboardCache.get(cacheKey);
    const dashboardFresh = dashboardEntry ? isCacheFresh(dashboardEntry.loadedAt, HOME_CACHE_TTL_MS) : false;

    setDashboard(dashboardEntry?.payload ?? null);

    if (dashboardFresh) {
      setDashboard(dashboardEntry?.payload ?? null);
      setLoading(false);
      return;
    }

    void loadHome({ quiet: dashboardFresh });
  }, [cacheKey, token]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadHome({ quiet: true, force: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [cacheKey, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2400);
    const onRefresh = () => {
      setLiveMessage("Live update: Home refreshed.");
      void loadHome({ quiet: true, force: true });
      clearLiveMessage();
    };

    socket.on("schedule_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    socket.on("attendance_changed", onRefresh);

    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("notification_created", onRefresh);
      socket.off("attendance_changed", onRefresh);
    };
  }, [cacheKey, socket, token]);

  const topActions = useMemo(
    () =>
      [
        canCreateEvent ? { label: "Create Event", hash: createEventHash, tone: "primary" } : null,
        canCreateTask ? { label: "Create Task", hash: createTaskHash, tone: "primary" } : null,
        canOpenSchedule ? { label: "My Schedule", hash: buildShellRouteHash("dashboard-my-schedule"), tone: "secondary" } : null,
        canOpenAlerts ? { label: "Alerts", hash: buildShellRouteHash("dashboard-alerts"), tone: "secondary" } : null,
        canOpenMyTasks ? { label: "My Tasks", hash: buildShellRouteHash("dashboard-my-tasks"), tone: "secondary" } : null
      ].filter((action): action is TopAction => action != null),
    [canCreateEvent, canCreateTask, canOpenAlerts, canOpenMyTasks, canOpenSchedule, createEventHash, createTaskHash]
  );

  const timeBand = dashboard?.home_surface?.time_band ?? null;
  const attendanceMetrics = useMemo(() => getAttendanceMetrics(dashboard?.home_surface?.staffing_band ?? null), [dashboard]);
  const summaryCards = useMemo(
    () =>
      buildSummaryCards({
        payload: dashboard,
        taskCounts,
        canOpenToday,
        canOpenStaffing,
        canOpenSchoolTasks,
        canOpenSportsTasks,
        canOpenProductionTasks,
        canOpenProductionQueue
      }),
    [canOpenProductionQueue, canOpenProductionTasks, canOpenSchoolTasks, canOpenSportsTasks, canOpenStaffing, canOpenToday, dashboard, taskCounts]
  );
  const urgentItems = dashboard?.home_surface?.urgent_attention?.visible
    ? dashboard.home_surface.urgent_attention.items.slice(0, 4)
    : [];
  const movingItems = useMemo(() => buildMovingItems(dashboard), [dashboard]);
  const updatedLabel = dashboard ? `Updated ${formatHomeTimestamp(dashboard.generated_at)}` : null;

  if (loading && dashboard == null) {
    return (
      <WorkspaceLoadingBlock
        title="Loading Home"
        summary="Pulling today's work, alerts, schedule, time clock status, and staffing visibility into one operational surface."
      />
    );
  }

  return (
    <section className="home-operational">
      <WorkspacePageHeader title="Home" summary="Today's work, alerts, and schedule" compact className="home-operational__header" />

      {error ? <div className="error-banner">{error}</div> : null}
      {liveMessage ? <div className="feedback-strip feedback-strip--info">{liveMessage}</div> : null}

      <section className="panel home-operational__top-panel">
        <div className="home-operational__search-row">
          <button type="button" className="home-operational__search-launcher" onClick={() => onOpenConcierge()}>
            <span className="home-operational__search-label">Search or ask Concierge</span>
            <strong>Search jobs, people, schedules, and alerts</strong>
            <span>{updatedLabel ?? "Ask Concierge anything from Home."}</span>
          </button>

          {topActions.length ? (
            <div className="home-operational__top-actions" aria-label="Home shortcuts">
              {topActions.map((action) => (
                <button
                  key={`${action.label}-${action.hash}`}
                  type="button"
                  className={action.tone === "primary" ? "" : "secondary-button"}
                  onClick={() => navigateToHash(action.hash)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="home-operational__top-grid">
        {timeBand?.visible ? (
          <section className={`panel home-operational__clock-panel home-operational__clock-panel--${getTimeClockTone(timeBand)}`}>
            <WorkspaceSectionHeader title="Time Clock" summary={timeBand.summary_line} compact />
            <div className="home-operational__clock-grid">
              <div className="home-operational__clock-stat">
                <span>Status</span>
                <strong>{getTimeClockHeadline(timeBand)}</strong>
                <p>{timeBand.elapsed_label ?? timeBand.label}</p>
              </div>
              <div className="home-operational__clock-stat">
                <span>Current context</span>
                <strong>{timeBand.shift_label ?? "No scheduled shift in view"}</strong>
                <p>{timeBand.location_label ?? "Open your schedule for assignment details."}</p>
              </div>
            </div>
            <WorkspaceActionBar align="end" compact>
              <button type="button" onClick={() => navigateToHash(timeBand.action_hash)}>
                {getTimeClockActionLabel(timeBand)}
              </button>
              {timeBand.schedule_hash ? (
                <button type="button" className="secondary-button" onClick={() => navigateToHash(timeBand.schedule_hash!)}>
                  View Schedule
                </button>
              ) : canOpenSchedule ? (
                <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("dashboard-my-schedule"))}>
                  View Schedule
                </button>
              ) : null}
            </WorkspaceActionBar>
          </section>
        ) : null}

        {attendanceMetrics.length ? (
          <section className="panel home-operational__attendance-panel" aria-label="Attendance visibility">
            <WorkspaceSectionHeader
              title="Attendance"
              summary="Who is clocked in, who is in the field or office, and who still needs follow-through."
              compact
              actions={
                canOpenAttendance ? (
                  <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("operations-attendance"))}>
                    Open Attendance
                  </button>
                ) : null
              }
            />
            <div className="home-operational__attendance-grid">
              {attendanceMetrics.map((metric) => (
                <button
                  key={metric.id}
                  type="button"
                  className={`home-operational__attendance-card home-operational__attendance-card--${metric.tone}`}
                  onClick={() => navigateToHash(metric.action_hash)}
                >
                  <span>{metric.label}</span>
                  <strong>{metric.count}</strong>
                  <p>{metric.detail}</p>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {summaryCards.length ? (
        <section className="panel home-operational__summary-panel">
          <WorkspaceSectionHeader
            title="Today at a glance"
            summary="Start with the main operating counts, then open the workspace that owns the next action."
            compact
          />
          <div className="home-operational__summary-grid">
            {summaryCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={`home-operational__summary-card home-operational__summary-card--${card.tone}`}
                onClick={() => navigateToHash(card.hash)}
              >
                <span>{card.title}</span>
                <strong>{card.count}</strong>
                <p>{card.summary}</p>
                <em>{card.actionLabel}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="home-operational__action-grid">
        {urgentItems.length ? (
          <section className="panel home-operational__urgent-panel">
            <WorkspaceSectionHeader
              title="Urgent Issues"
              summary="What needs attention first, with direct drilldown into the owning job or operational record."
              compact
              actions={
                canOpenAlerts ? (
                  <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("dashboard-alerts"))}>
                    View Alerts
                  </button>
                ) : null
              }
            />
            <div className="home-operational__issue-list">
              {urgentItems.map((item: HomeUrgentWatchItem) => (
                <button
                  key={item.id}
                  type="button"
                  className={`home-operational__issue-card home-operational__issue-card--${mapTone(item.tone)}`}
                  onClick={() => navigateToHash(item.action_hash)}
                >
                  <div className="home-operational__issue-top">
                    <span>{item.kind_label}</span>
                    <strong>{item.urgency_label}</strong>
                  </div>
                  <div className="home-operational__issue-body">
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </div>
                  <div className="home-operational__issue-meta">
                    <span>{item.supporting_label ?? "Needs attention"}</span>
                    <em>{item.action_label}</em>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {movingItems.length ? (
          <section className="panel home-operational__moving-panel">
            <WorkspaceSectionHeader
              title="Work moving now"
              summary="The clearest next work already in motion, without turning Home into a long queue page."
              compact
            />
            <div className="home-operational__moving-list">
              {movingItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`home-operational__moving-card home-operational__moving-card--${item.tone}`}
                  onClick={() => navigateToHash(item.actionHash)}
                >
                  <div className="home-operational__moving-top">
                    <span>{item.eyebrow}</span>
                    <em>{item.actionLabel}</em>
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                  <div className="home-operational__moving-meta">
                    <span>{item.metaPrimary}</span>
                    {item.metaSecondary ? <span>{item.metaSecondary}</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
