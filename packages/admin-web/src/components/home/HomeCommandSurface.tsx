import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { buildShellRouteHash } from "../../navigation";
import { canAccessRoute } from "../../permissions";
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
import { resolveWorkSpineActionHref } from "../../workSpineRouting";
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

type OperationalSummaryCard = {
  key: string;
  title: string;
  count: number;
  summary: string;
  explanation: string;
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

function resolveHomeActionHash(hash: string | null | undefined) {
  return resolveWorkSpineActionHref({ actionHash: hash, fallbackHash: hash });
}

function getPlainActionLabel(label: string, hash: string | null | undefined) {
  const normalizedHash = resolveHomeActionHash(hash);
  const lowerHash = normalizedHash.toLowerCase();
  const lowerLabel = label.toLowerCase();

  if (lowerHash.includes("needs-attention") || lowerHash.includes("compliance") || lowerLabel.includes("compliance")) {
    return "Review in Needs Attention";
  }
  if (lowerHash.includes("attendance")) {
    return "Open Attendance Review";
  }
  if (lowerHash.includes("project-tracking")) {
    return "View in Project Tracking";
  }
  if (lowerHash.includes("dashboard/my-day") || lowerHash.includes("my-work")) {
    return "Open My Work";
  }
  if (lowerHash.includes("staffing") || lowerHash.includes("scheduling")) {
    return "Open work";
  }
  if (lowerHash.startsWith("#studios")) {
    return "Open Photography Command Hub";
  }
  if (lowerHash.startsWith("#schools")) {
    return "Open Schools Command Hub";
  }
  if (lowerHash.startsWith("#sports")) {
    return "Open Sports Command Hub";
  }
  if (lowerHash.startsWith("#production")) {
    return "Open Production hub";
  }
  if (lowerLabel === "view" || lowerLabel === "details" || lowerLabel === "review" || lowerLabel === "action") {
    return "Open work";
  }
  return label.replace(/^View\b/i, "Open").replace(/^Open attendance$/i, "Open Attendance Review");
}

function getUrgentWhy(item: HomeUrgentWatchItem) {
  if (item.kind === "attendance" || item.kind === "labor") {
    return "Attendance issues can affect coverage, payroll review, and whether today's work has the right person on site.";
  }
  if (item.kind === "approval") {
    return "Review items can hold payroll, mileage, release, or follow-up until a leader confirms the next step.";
  }
  if (item.kind === "project") {
    return "Project blockers can turn into missed delivery, stalled ownership, or customer follow-up risk if no one opens the work record.";
  }
  if (item.kind === "shoot" || item.kind === "scheduling") {
    return "Shoot and schedule issues can affect field readiness, arrival timing, and same-day customer experience.";
  }
  return `${item.urgency_label} items need owner follow-through before they drift into delivery, staffing, payroll, or customer impact.`;
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
      title: "Today's Shoots",
      count: todayShoots.total,
      summary: "Photography field work scheduled for today",
      explanation:
        todayShoots.needs_attention_count > 0
          ? `${todayShoots.needs_attention_count} scheduled item${todayShoots.needs_attention_count === 1 ? "" : "s"} still need readiness follow-through before the day is safe.`
          : "Today's field work is visible here so the team can confirm timing, readiness, and staffing before jumping into details.",
      actionLabel: "Open Photography Command Hub",
      hash: "#studios/shoots",
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
      summary: "Coverage gaps that could slow down today's work",
      explanation:
        (staffingWidget?.count ?? fallbackCount) > 0
          ? "A staffing gap can delay arrivals, break lead coverage, or force a same-day replacement decision."
          : "No staffing gap is currently flagged, but this stays one click away for same-day coverage checks.",
      actionLabel: "Open work",
      hash: staffingWidget?.action_hash || "#operations/staffing?area=staffing",
      tone: staffingTone
    });
  }

  if (input.canOpenProductionQueue && productionProjects) {
    cards.push({
      key: "digital_production",
      title: "Production Work",
      count: productionWidget?.count ?? productionProjects.counts.active_jobs,
      summary: "Production work preview from the daily command center",
      explanation:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? `${productionProjects.counts.blocked} blocked and ${productionProjects.counts.overdue} overdue production item${productionProjects.counts.blocked + productionProjects.counts.overdue === 1 ? "" : "s"} need work-spine inspection.`
          : "Production is active; open the department hub when you need the owner, due state, or release blocker.",
      actionLabel:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? "View in Project Tracking"
          : "Open Production hub",
      hash:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? buildShellRouteHash("project-tracking")
          : productionWidget?.action_hash || buildShellRouteHash("production-workload"),
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
      summary: "School task preview",
      explanation:
        input.taskCounts.schools > 0
          ? "School tasks can affect photo-day readiness, client follow-up, or field handoff quality."
          : "No open school task count is currently flagged for this Home view.",
      actionLabel: "Open Schools Command Hub",
      hash: "#schools/tasks",
      tone: input.taskCounts.schools > 0 ? "info" : "success"
    });
  }

  if (input.canOpenSportsTasks && input.taskCounts.sports != null) {
    cards.push({
      key: "sports_tasks",
      title: "Sports Tasks",
      count: input.taskCounts.sports,
      summary: "Sports task preview",
      explanation:
        input.taskCounts.sports > 0
          ? "Sports tasks can affect roster readiness, shoot prep, graphics, or customer follow-through."
          : "No open sports task count is currently flagged for this Home view.",
      actionLabel: "Open Sports Command Hub",
      hash: "#sports/tasks",
      tone: input.taskCounts.sports > 0 ? "info" : "success"
    });
  }

  if (input.canOpenProductionTasks && input.taskCounts.production != null) {
    cards.push({
      key: "production_tasks",
      title: "Production Tasks",
      count: input.taskCounts.production,
      summary: "Production task preview",
      explanation:
        input.taskCounts.production > 0
          ? "Production tasks can turn into overdue delivery or release blockers if no one clears the next step."
          : "No open production task count is currently flagged for this Home view.",
      actionLabel: "Open Production hub",
      hash: "#production/tasks",
      tone: input.taskCounts.production > 0 ? "info" : "success"
    });
  }

  return cards.slice(0, 6);
}

function buildDailyBriefing(input: {
  payload: HomeDashboardResponse | null;
  summaryCards: OperationalSummaryCard[];
  urgentItems: HomeUrgentWatchItem[];
  movingItems: MovingItem[];
  timeBand: HomeSurfaceTimeBand | null;
  attendanceAttentionMetric: ReturnType<typeof getAttendanceMetrics>[number] | null;
}) {
  const lines: string[] = [];
  const todayShoots = input.payload?.widgets.today_shoots ?? null;
  const urgentSummary = input.payload?.home_surface?.urgent_attention?.summary_line ?? null;
  const myDaySummary = input.payload?.home_surface?.my_day?.summary_line ?? null;
  const todayAndNextSummary = input.payload?.home_surface?.today_and_next_up?.summary_line ?? null;

  if (input.timeBand?.visible) {
    lines.push(`${getTimeClockHeadline(input.timeBand)}: ${input.timeBand.summary_line}`);
  }
  if (todayShoots) {
    lines.push(
      todayShoots.needs_attention_count > 0
        ? `${todayShoots.total} shoot${todayShoots.total === 1 ? "" : "s"} today, with ${todayShoots.needs_attention_count} needing readiness attention.`
        : `${todayShoots.total} shoot${todayShoots.total === 1 ? "" : "s"} today; no shoot readiness count is red right now.`
    );
  }
  if (input.attendanceAttentionMetric) {
    lines.push(`${input.attendanceAttentionMetric.count} expected team member${input.attendanceAttentionMetric.count === 1 ? "" : "s"} still need attendance follow-up.`);
  }
  if (input.urgentItems.length) {
    lines.push(urgentSummary || `${input.urgentItems.length} urgent item${input.urgentItems.length === 1 ? "" : "s"} need action now.`);
  }
  if (!input.urgentItems.length && todayAndNextSummary) {
    lines.push(todayAndNextSummary);
  }
  if (!input.urgentItems.length && !todayAndNextSummary && myDaySummary) {
    lines.push(myDaySummary);
  }
  if (!lines.length && input.summaryCards.length) {
    lines.push("Home is ready. Use the cards below to open the exact area that needs attention.");
  }
  if (!lines.length && input.movingItems.length) {
    lines.push(`${input.movingItems.length} active work item${input.movingItems.length === 1 ? "" : "s"} are ready for follow-through.`);
  }
  return lines.slice(0, 4);
}

export function HomeCommandSurface({
  token,
  currentUser,
  socket,
  onOpenConcierge = () => undefined,
  createTaskHash
}: Props) {
  const cacheKey = `${token}:${currentUser.id}`;
  const cachedDashboard = homeDashboardCache.get(cacheKey);
  const [dashboard, setDashboard] = useState<HomeDashboardResponse | null>(cachedDashboard?.payload ?? null);
  const [loading, setLoading] = useState(cachedDashboard == null);
  const [error, setError] = useState("");
  const [urgentExpanded, setUrgentExpanded] = useState(false);

  const canCreateTask = canAccessRoute(currentUser, "task-new");
  const canOpenSchedule = canAccessRoute(currentUser, "dashboard-my-schedule");
  const canOpenAlerts = canAccessRoute(currentUser, "dashboard-alerts");
  const canOpenAttendance = canAccessRoute(currentUser, "operations-attendance");
  const canOpenNeedsAttention = canAccessRoute(currentUser, "people-ops-compliance");
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

    const onRefresh = () => {
      void loadHome({ quiet: true, force: true });
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

  const timeBand = dashboard?.home_surface?.time_band ?? null;
  const attendanceMetrics = useMemo(() => getAttendanceMetrics(dashboard?.home_surface?.staffing_band ?? null), [dashboard]);
  const attendanceAttentionMetric = attendanceMetrics.find((metric) => metric.id === "assigned_but_missing" && metric.count > 0) ?? null;
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
  const visibleUrgentItems = urgentExpanded ? urgentItems : urgentItems.slice(0, 2);
  const movingItems = useMemo(() => buildMovingItems(dashboard), [dashboard]);
  const briefingLines = useMemo(
    () =>
      buildDailyBriefing({
        payload: dashboard,
        summaryCards,
        urgentItems,
        movingItems,
        timeBand,
        attendanceAttentionMetric
      }),
    [attendanceAttentionMetric, dashboard, movingItems, summaryCards, timeBand, urgentItems]
  );
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
      <WorkspacePageHeader
        title="Home"
        summary="Daily operating view for today's schedule, staffing gaps, urgent issues, and department task counts."
        compact
        className="home-operational__header"
        actions={
          <div className="home-operational__header-actions">
            <button type="button" className="home-operational__search-launcher" onClick={() => onOpenConcierge()}>
              <span className="home-operational__search-label">Concierge</span>
              <strong>Ask Concierge or search jobs, people, schools, tasks...</strong>
              <span>{updatedLabel ?? "Focus or click to open Concierge search."}</span>
            </button>
            {timeBand?.visible ? (
              <button type="button" className="primary-button home-operational__primary-clock-action" onClick={() => navigateToHash(timeBand.action_hash)}>
                {getTimeClockActionLabel(timeBand)}
              </button>
            ) : null}
            {canCreateTask ? (
              <button type="button" className="secondary-button" onClick={() => navigateToHash(createTaskHash)} title="Open the task form. This is secondary to the daily clock and briefing actions.">
                Add Task
              </button>
            ) : null}
          </div>
        }
      />

      {error ? <div className="error-banner">{error}</div> : null}

      {briefingLines.length ? (
        <section className="panel home-operational__briefing-panel">
          <WorkspaceSectionHeader
            title="Today's Briefing"
            summary="The daily command center starts with what matters, why it matters, and where to act next."
            compact
          />
          <div className="home-operational__briefing-list">
            {briefingLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      ) : null}

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

        {attendanceAttentionMetric ? (
          <section className="panel home-operational__attendance-panel home-operational__attendance-panel--compact" aria-label="Attendance health">
            <WorkspaceSectionHeader
              title="Attendance needs attention"
              summary="Someone expected for today's work has not checked in yet."
              compact
              actions={
                canOpenAttendance ? (
                  <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("operations-attendance"))}>
                    Open Attendance
                  </button>
                ) : null
              }
            />
            <button
              type="button"
              className={`home-operational__attendance-card home-operational__attendance-card--${attendanceAttentionMetric.tone}`}
              onClick={() => navigateToHash(attendanceAttentionMetric.action_hash)}
            >
              <span>{attendanceAttentionMetric.label}</span>
              <strong>{attendanceAttentionMetric.count}</strong>
              <p>{attendanceAttentionMetric.detail}</p>
            </button>
          </section>
        ) : null}
      </div>

      {summaryCards.length ? (
        <section className="panel home-operational__summary-panel">
          <WorkspaceSectionHeader
            title="Today at a glance"
            summary="A compact preview of today's shoots, staffing gaps, department tasks, and work-spine risk. Open a card only when you need the full queue."
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
                <small>{card.explanation}</small>
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
              summary="The first issues to clear today. Expand only when you need the rest of the watch list."
              compact
              actions={
                <WorkspaceActionBar align="end" compact>
                  {urgentItems.length > 2 ? (
                    <button type="button" className="secondary-button" onClick={() => setUrgentExpanded((current) => !current)}>
                      {urgentExpanded ? "Show Fewer" : `Show All (${urgentItems.length})`}
                    </button>
                  ) : null}
                  {canOpenAlerts ? (
                    <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("dashboard-alerts"))}>
                      Open Alerts
                    </button>
                  ) : null}
                  {canOpenNeedsAttention ? (
                    <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("people-ops-compliance"))}>
                      Open Needs Attention
                    </button>
                  ) : null}
                </WorkspaceActionBar>
              }
            />
            <div className="home-operational__issue-list">
              {visibleUrgentItems.map((item: HomeUrgentWatchItem) => (
                <button
                  key={item.id}
                  type="button"
                  className={`home-operational__issue-card home-operational__issue-card--${mapTone(item.tone)}`}
                  onClick={() => navigateToHash(resolveHomeActionHash(item.action_hash))}
                >
                  <div className="home-operational__issue-top">
                    <span>{item.kind_label}</span>
                    <strong>{item.urgency_label}</strong>
                  </div>
                  <div className="home-operational__issue-body">
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </div>
                  <div className="home-operational__issue-explain">
                    <span>Why it matters</span>
                    <p>{getUrgentWhy(item)}</p>
                  </div>
                  <div className="home-operational__issue-meta">
                    <span>Owner/context: {item.supporting_label ?? "Unassigned or context pending"}</span>
                    <em>Next: {getPlainActionLabel(item.action_label, item.action_hash)}</em>
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
                  onClick={() => navigateToHash(resolveHomeActionHash(item.actionHash))}
                >
                  <div className="home-operational__moving-top">
                    <span>{item.eyebrow}</span>
                    <em>{getPlainActionLabel(item.actionLabel, item.actionHash)}</em>
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
