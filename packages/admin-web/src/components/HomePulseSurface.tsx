import { Children, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../api";
import { ShootBriefingBody } from "./ShootBriefing";
import { OperationalDetailSection } from "./OperationalDetailSection";
import {
  canAccessGraphicsWorkspace,
  canViewCustomerService,
  canViewLabor,
  canViewLeadershipReports,
  getPrimaryBusinessRole,
  hasCapability
} from "../permissions";
import { buildLocationHash, getShootLocationDetail } from "../services/locationApi";
import {
  formatHours,
  formatRefreshTime,
  getHomeDashboard,
  HOME_WIDGET_DEFINITIONS,
  humanizeDepartment
} from "../services/homeDashboard";
import { buildShootBriefing, type ShootBriefingViewModel } from "../services/shootHotSheet";
import type {
  HomeBusinessPulseTile,
  HomeDashboardResponse,
  HomeUrgentWatchItem,
  HomeTodayShootPreview,
  HomeWeatherTravelItem,
  SessionUser,
  ShootDetail,
  ShootLocationDetail
} from "../types";

type SurfaceMode = "dashboard" | "status-board";

type Props = {
  token: string;
  currentUser?: SessionUser | null;
  socket: Socket | null;
  surfaceMode: SurfaceMode;
  presentationMode?: boolean;
  showIntro?: boolean;
};

type TodayFilter = "all" | "upcoming" | "in_progress" | "complete" | "needs_attention";

type DetailState =
  | { kind: "business_pulse"; tileId?: HomeBusinessPulseTile["id"] }
  | { kind: "shoot"; shootId: string }
  | { kind: "weather"; shootId?: string }
  | { kind: "customer_service" }
  | { kind: "location"; locationId: string }
  | { kind: "labor" };

type TodayPriorityItem = {
  id: string;
  kind: "shoot" | "weather" | "customer_service" | "location" | "labor";
  label: string;
  detail: string;
  tone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
  supporting?: string;
  detailState: DetailState;
};

type HeadsUpItem = {
  id: string;
  label: string;
  detail: string;
  tone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
  kindLabel: string;
  supporting?: string;
  detailState: DetailState;
};

type HomeFollowUpItem = {
  id: string;
  label: string;
  detail: string;
  actionHash: string;
  tone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
};

type HomeRecentActivityItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  actionHash?: string;
};

type UrgentWatchCardItem = HomeUrgentWatchItem;

const TODAY_FILTERS: Array<{ id: TodayFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Coming Up" },
  { id: "in_progress", label: "In Progress" },
  { id: "needs_attention", label: "Needs Attention" },
  { id: "complete", label: "Complete" }
];

const TV_PAGE_LABELS = ["Today", "Weather + Support", "Places + Flagged Shoots"];

export function HomePulseSurface({
  token,
  currentUser = null,
  socket,
  surfaceMode,
  presentationMode = false,
  showIntro = true
}: Props) {
  const homeMode = surfaceMode === "dashboard" ? "app" : "tv";
  const interactive = surfaceMode === "dashboard";
  const [dashboard, setDashboard] = useState<HomeDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<DetailState | null>(null);
  const [todayFilter, setTodayFilter] = useState<TodayFilter>("all");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [shootBriefing, setShootBriefing] = useState<ShootBriefingViewModel | null>(null);
  const [locationDetail, setLocationDetail] = useState<ShootLocationDetail | null>(null);
  const [rotationPage, setRotationPage] = useState(0);
  const [rotationFrozen, setRotationFrozen] = useState(false);

  async function load(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const payload = await getHomeDashboard(token, homeMode);
      setDashboard(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the home screen right now.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, [token, homeMode]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load({ quiet: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [token, homeMode]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2400);
    const onRefresh = () => {
      setLiveMessage("Live update: home pulse refreshed.");
      void load({ quiet: true });
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
  }, [socket, token, homeMode]);

  useEffect(() => {
    if (homeMode !== "tv" || rotationFrozen) {
      return;
    }
    const interval = window.setInterval(() => {
      setRotationPage((value) => (value + 1) % TV_PAGE_LABELS.length);
    }, (dashboard?.tv_rotation_seconds ?? 15) * 1000);
    return () => window.clearInterval(interval);
  }, [dashboard?.tv_rotation_seconds, homeMode, rotationFrozen]);

  useEffect(() => {
    if (homeMode !== "app" || !dashboard) {
      return;
    }

    const urgentCount = dashboard.widgets.urgent_watch.visible ? dashboard.widgets.urgent_watch.items.length : 0;
    if (!urgentCount) {
      return;
    }

    const userKey = currentUser?.id ?? "dashboard";
    const storageKey = `home-urgent-notice:${userKey}:${dashboard.anchor_date}`;

    try {
      if (window.sessionStorage.getItem(storageKey)) {
        return;
      }
      window.sessionStorage.setItem(storageKey, "true");
    } catch {
      return;
    }

    const message = `${urgentCount} urgent issue${urgentCount === 1 ? "" : "s"} need attention today.`;
    setLiveMessage(message);
    const timeout = window.setTimeout(() => {
      setLiveMessage((current) => (current === message ? "" : current));
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [currentUser?.id, dashboard, homeMode]);

  useEffect(() => {
    if (homeMode !== "app" || !selectedDetail) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedDetail(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [homeMode, selectedDetail]);

  const visibleTodayShoots = useMemo(() => {
    const shoots = [...(dashboard?.widgets.today_shoots.shoots ?? [])].sort(compareTodayShoots);
    if (todayFilter === "all") {
      return shoots;
    }
    return shoots.filter((shoot) => shoot.phase === todayFilter);
  }, [dashboard?.widgets.today_shoots.shoots, todayFilter]);

  const bigShoots = useMemo(
    () => (dashboard?.widgets.today_shoots.shoots ?? []).filter((shoot) => shoot.big_shoot).sort(compareTodayShoots),
    [dashboard?.widgets.today_shoots.shoots]
  );

  async function openShootDetail(shootId: string) {
    setSelectedDetail({ kind: "shoot", shootId });
    setDetailLoading(true);
    setDetailError("");
    setLocationDetail(null);
    try {
      const detail = await apiFetch<ShootDetail>(`/api/shoots/${shootId}`, token);
      setShootBriefing(buildShootBriefing(detail, detail));
    } catch (loadError) {
      setShootBriefing(null);
      setDetailError(loadError instanceof Error ? loadError.message : "We couldn't load that shoot briefing.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openLocationDetail(locationId: string) {
    setSelectedDetail({ kind: "location", locationId });
    setDetailLoading(true);
    setDetailError("");
    setShootBriefing(null);
    try {
      const detail = await getShootLocationDetail(token, locationId);
      setLocationDetail(detail);
    } catch (loadError) {
      setLocationDetail(null);
      setDetailError(loadError instanceof Error ? loadError.message : "We couldn't load that location history.");
    } finally {
      setDetailLoading(false);
    }
  }

  function openStaticDetail(detail: DetailState) {
    setSelectedDetail(detail);
    setDetailLoading(false);
    setDetailError("");
    setShootBriefing(null);
    setLocationDetail(null);
  }

  function openDetail(detail: DetailState) {
    if (detail.kind === "shoot") {
      void openShootDetail(detail.shootId);
      return;
    }
    if (detail.kind === "location") {
      void openLocationDetail(detail.locationId);
      return;
    }
    openStaticDetail(detail);
  }

  const businessPulse = dashboard?.widgets.business_pulse;
  const todayShoots = dashboard?.widgets.today_shoots;
  const customerService = dashboard?.widgets.customer_service_pulse;
  const places = dashboard?.widgets.places_that_need_more_love;
  const labor = dashboard?.widgets.labor_snapshot_today;
  const attendanceAwareness = dashboard?.widgets.attendance_awareness;
  const urgentWatch = dashboard?.widgets.urgent_watch;
  const productionProjects = dashboard?.widgets.production_projects;
  const headsUpItems = useMemo(() => (dashboard ? buildHeadsUpItems(dashboard) : []), [dashboard]);
  const headsUpTone = dashboard ? getHeadsUpSectionTone(dashboard, headsUpItems) : "good";
  const hasUrgentWatch = Boolean(urgentWatch?.visible && urgentWatch.items.length);
  const canSeeOperationalWatch = !currentUser || hasAnyDashboardAttentionAccess(currentUser);
  const canSeeAttendanceAwareness = !currentUser || hasCapability(currentUser, "attendance.view");
  const canSeeProductionTracker = !currentUser || canAccessGraphicsWorkspace(currentUser);
  const primaryRole = currentUser ? getPrimaryBusinessRole(currentUser) : "leadership";
  const showLeadershipCommandCenter = primaryRole === "manager" || primaryRole === "leadership" || primaryRole === "admin";
  const canSeeBusinessContext = !currentUser || canViewLeadershipReports(currentUser);
  const canSeeCustomerServiceWidget = !currentUser || canViewCustomerService(currentUser);
  const canSeeLaborWidget = !currentUser || canViewLabor(currentUser);
  const canSeePerformanceSignals =
    !currentUser ||
    canViewLeadershipReports(currentUser) ||
    canViewCustomerService(currentUser) ||
    canViewLabor(currentUser);

  const detailDefinition = selectedDetail
    ? HOME_WIDGET_DEFINITIONS[
        selectedDetail.kind === "shoot"
          ? "today_shoots"
          : selectedDetail.kind === "weather"
            ? "weather_travel_watch"
            : selectedDetail.kind === "customer_service"
              ? "customer_service_pulse"
              : selectedDetail.kind === "location"
                ? "places_that_need_more_love"
                : selectedDetail.kind === "labor"
                  ? "labor_snapshot_today"
                  : "business_pulse"
      ]
    : null;

  return (
    <div className={`home-pulse-surface${homeMode === "tv" ? " home-pulse-surface--tv" : ""}${presentationMode ? " home-pulse-surface--display" : ""}`}>
      {surfaceMode === "dashboard" && showIntro ? (
        <section className="page-intro">
          <div>
            <div className="eyebrow">Dashboard</div>
            <h2>Home Mission Control</h2>
            <p>Exceptions, today&apos;s execution, this week&apos;s plan, attendance issues, production pressure, and follow-through in one operational front door.</p>
          </div>
          <div className="page-intro-actions">
            <span className="metric-pill">Last refresh {formatRefreshTime(dashboard?.generated_at)}</span>
            {liveMessage ? <span className="status-pill status-pill--connected">{liveMessage}</span> : null}
            <button className="secondary-button" onClick={() => void load()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>
      ) : surfaceMode === "dashboard" ? null : presentationMode ? (
        <section className="status-board-display-bar panel">
          <div>
            <div className="eyebrow">TV Mode</div>
            <strong>{new Date(`${dashboard?.anchor_date ?? getLocalDateString()}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</strong>
          </div>
          <div className="status-board-display-bar__meta">
            <span className="metric-pill">Last refresh {formatRefreshTime(dashboard?.generated_at)}</span>
            <span className="metric-pill">{rotationFrozen ? "Rotation frozen" : `Page ${rotationPage + 1} of ${TV_PAGE_LABELS.length}`}</span>
            <button className="secondary-button" onClick={() => setRotationFrozen((value) => !value)}>
              {rotationFrozen ? "Resume Rotation" : "Freeze Rotation"}
            </button>
          </div>
        </section>
      ) : (
        <section className="page-intro">
          <div>
            <div className="eyebrow">Status Board</div>
            <h2>Office Operations Board</h2>
            <p>A public-safe live board for the office floor: big business counts, today&apos;s shoots, travel watch, support health, and warm location context.</p>
          </div>
          <div className="page-intro-actions">
            <span className="metric-pill">Last refresh {formatRefreshTime(dashboard?.generated_at)}</span>
            <span className="metric-pill">{rotationFrozen ? "Rotation frozen" : `Page ${rotationPage + 1} of ${TV_PAGE_LABELS.length}`}</span>
            <button className="secondary-button" onClick={() => setRotationFrozen((value) => !value)}>
              {rotationFrozen ? "Resume Rotation" : "Freeze Rotation"}
            </button>
            <button className="secondary-button" onClick={() => void load()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="secondary-button"
              onClick={() => window.open(`${window.location.pathname}#status-board-display`, "_blank", "noopener,noreferrer")}
            >
              Open Display Window
            </button>
          </div>
        </section>
      )}

      {error ? <div className="error-banner">{error}</div> : null}
      {loading && !dashboard ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading home screen</div>
          <p className="section-subtitle">Pulling the live business pulse, today&apos;s shoots, weather watch, support pulse, and location context.</p>
        </section>
      ) : null}

      {dashboard ? (
        homeMode === "app" ? (
          <>
            <section className={`home-dashboard-flow${showLeadershipCommandCenter ? " home-dashboard-flow--command" : ""}`}>
              {canSeeOperationalWatch && hasUrgentWatch ? <UrgentAlertStrip data={urgentWatch!} /> : null}
              {canSeeOperationalWatch ? (
                <AttentionNowWidget
                  dashboard={dashboard}
                  urgentWatch={urgentWatch}
                  items={headsUpItems}
                  sectionTone={headsUpTone}
                  onOpenDetail={openDetail}
                />
              ) : null}
              {showLeadershipCommandCenter ? (
                <>
                  <TodayStripWidget
                    dashboard={dashboard}
                    productionProjects={productionProjects}
                    attendanceAwareness={attendanceAwareness}
                  />
                  <HomeCommandRow layout="asymmetric">
                    <TodayShootsWidget
                      data={todayShoots}
                      interactive
                      filter={todayFilter}
                      visibleShoots={visibleTodayShoots}
                      onFilterChange={setTodayFilter}
                      onShootClick={openShootDetail}
                    />
                    <ThisWeekPreviewWidget dashboard={dashboard} />
                  </HomeCommandRow>
                  <HomeCommandRow layout="balanced">
                    {canSeeAttendanceAwareness ? <AttendanceAwarenessWidget data={attendanceAwareness} /> : null}
                    {canSeeProductionTracker ? <ProjectTrackerWidget data={productionProjects} /> : null}
                  </HomeCommandRow>
                  <HomeCommandRow layout="support">
                    <MyFollowUpsWidget dashboard={dashboard} currentUser={currentUser} />
                    {canSeeCustomerServiceWidget && hasMeaningfulCustomerServiceRisk(customerService) ? (
                      <CustomerServiceWidget data={customerService} interactive onOpen={() => openStaticDetail({ kind: "customer_service" })} />
                    ) : null}
                  </HomeCommandRow>
                  <RecentActivityHomeWidget dashboard={dashboard} />
                </>
              ) : (
                <>
                  <TodayShootsWidget
                    data={todayShoots}
                    interactive
                    filter={todayFilter}
                    visibleShoots={visibleTodayShoots}
                    onFilterChange={setTodayFilter}
                    onShootClick={openShootDetail}
                  />
                  {canSeeAttendanceAwareness ? <AttendanceAwarenessWidget data={attendanceAwareness} /> : null}
                  {canSeeProductionTracker ? <ProjectTrackerWidget data={productionProjects} /> : null}
                  <MyFollowUpsWidget dashboard={dashboard} currentUser={currentUser} />
                  {canSeeCustomerServiceWidget && hasMeaningfulCustomerServiceRisk(customerService) ? (
                    <CustomerServiceWidget data={customerService} interactive onOpen={() => openStaticDetail({ kind: "customer_service" })} />
                  ) : null}
                  <RecentActivityHomeWidget dashboard={dashboard} />
                </>
              )}
            </section>
            {selectedDetail ? (
              <HomeDetailOverlay
                currentUser={currentUser}
                dashboard={dashboard}
                selectedDetail={selectedDetail}
                detailDefinition={detailDefinition}
                detailLoading={detailLoading}
                detailError={detailError}
                shootBriefing={shootBriefing}
                locationDetail={locationDetail}
                onClose={() => setSelectedDetail(null)}
              />
            ) : null}
          </>
        ) : (
          <TvStatusBoard dashboard={dashboard} currentPage={rotationPage} onPageSelect={setRotationPage} presentationMode={presentationMode} bigShoots={bigShoots} />
        )
      ) : null}
    </div>
  );
}

function UrgentAlertStrip({ data }: { data: HomeDashboardResponse["widgets"]["urgent_watch"] }) {
  const overdueCount = data.items.filter((item) => item.urgency_state === "overdue").length;
  const actionTodayCount = data.items.filter((item) => item.urgency_state === "action_needed_today").length;
  const dueSoonCount = data.items.filter((item) => item.urgency_state === "due_within_24h").length;
  const atRiskCount = data.items.filter((item) => item.urgency_state === "at_risk").length;

  return (
    <section className={`panel home-urgent-strip home-urgent-strip--${data.tone}`} role="status" aria-live="polite">
      <div className="home-urgent-strip__header">
        <div>
          <div className="eyebrow">Urgent Alert</div>
          <strong>{data.summary_line}</strong>
        </div>
        <div className="home-urgent-strip__chips">
          {overdueCount ? <span className="home-urgent-watch-badge">{overdueCount} overdue</span> : null}
          {actionTodayCount ? <span className="metric-pill metric-pill--warning">{actionTodayCount} today</span> : null}
          {dueSoonCount ? <span className="metric-pill">{dueSoonCount} within 24h</span> : null}
          {atRiskCount ? <span className="metric-pill">{atRiskCount} at risk</span> : null}
        </div>
      </div>
    </section>
  );
}

function AttentionNowWidget({
  dashboard,
  urgentWatch,
  items,
  sectionTone,
  onOpenDetail
}: {
  dashboard: HomeDashboardResponse;
  urgentWatch: HomeDashboardResponse["widgets"]["urgent_watch"] | undefined;
  items: HeadsUpItem[];
  sectionTone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
  onOpenDetail: (detail: DetailState) => void;
}) {
  if (urgentWatch?.visible && urgentWatch.items.length) {
    return <UrgentWatchWidget data={urgentWatch} onOpenDetail={onOpenDetail} />;
  }

  return (
    <HeadsUpWidget
      dashboard={dashboard}
      items={items}
      sectionTone={sectionTone}
      compactByDefault
      onOpenDetail={onOpenDetail}
    />
  );
}

function HomeCommandRow({
  children,
  layout
}: {
  children: ReactNode;
  layout: "asymmetric" | "balanced" | "support";
}) {
  const items = Children.toArray(children).filter(Boolean);
  if (!items.length) {
    return null;
  }

  return (
    <div className={`home-command-row home-command-row--${layout}${items.length === 1 ? " home-command-row--single" : ""}`}>
      {items.map((child, index) => (
        <div key={index} className="home-command-row__cell">
          {child}
        </div>
      ))}
    </div>
  );
}

function TodayStripWidget({
  dashboard,
  productionProjects,
  attendanceAwareness
}: {
  dashboard: HomeDashboardResponse;
  productionProjects: HomeDashboardResponse["widgets"]["production_projects"] | undefined;
  attendanceAwareness: HomeDashboardResponse["widgets"]["attendance_awareness"] | undefined;
}) {
  const today = dashboard.widgets.today_strip;
  const attendanceSummary = attendanceAwareness?.summary;
  const lateOrMissingStaffCount =
    (attendanceSummary?.late_count ?? 0) +
    (attendanceSummary?.critically_late_count ?? 0) +
    (attendanceSummary?.missing_clock_in_count ?? attendanceAwareness?.not_clocked_in.count ?? 0) +
    (attendanceSummary?.probable_no_show_count ?? attendanceAwareness?.missing.count ?? 0);
  const blockedProductionCount = productionProjects?.counts.blocked ?? 0;
  const items: Array<{
    id: string;
    label: string;
    value: number;
    detail: string;
    tone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
    actionHash: string;
  }> = [
    {
      id: "shoots",
      label: "Today's Shoots",
      value: today.shoot_count,
      detail: today.shoot_count === 1 ? "1 shoot on the board" : `${today.shoot_count} shoots on the board`,
      tone: "neutral",
      actionHash: "#operations/shoots"
    },
    {
      id: "urgent",
      label: "Urgent Issues",
      value: today.urgent_issue_count,
      detail: "Highest-priority risks inside the next 24 hours.",
      tone: today.urgent_issue_count ? "action_needed" : "good",
      actionHash: "#dashboard/alerts"
    },
    {
      id: "attendance",
      label: "Late / Missing Staff",
      value: lateOrMissingStaffCount,
      detail: "Clock-ins, lateness, and no-show risk affecting today.",
      tone: lateOrMissingStaffCount ? "action_needed" : "good",
      actionHash: "#operations/attendance"
    },
    {
      id: "approvals",
      label: "Approvals Waiting",
      value: today.approvals_waiting_count,
      detail: "Approvals still waiting on action.",
      tone: today.approvals_waiting_count ? "heads_up" : "good",
      actionHash: "#approvals"
    },
    {
      id: "production_at_risk",
      label: "Production At Risk",
      value: today.production_at_risk_count,
      detail: "Unassigned, overdue, or slipping production work.",
      tone: today.production_at_risk_count ? "action_needed" : "good",
      actionHash: "#production/workload"
    },
    {
      id: "production_blocked",
      label: "Blocked Production",
      value: blockedProductionCount,
      detail: "Jobs blocked or waiting on requested changes.",
      tone: blockedProductionCount ? "action_needed" : "good",
      actionHash: "#production/qa?queue=blocked_queue&stage=blocked"
    }
  ];

  return (
    <section className="panel home-widget home-widget--today-strip home-widget--compact">
      <div className="home-widget__header home-widget__header--strip">
        <div>
          <div className="eyebrow">Today</div>
          <div className="section-title">Today Strip</div>
        </div>
        <div className="home-widget__support muted">
          {new Date(`${dashboard.anchor_date}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </div>
      </div>
      <div className="home-today-strip-grid">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`home-today-strip-card home-today-strip-card--${item.tone}`}
            onClick={() => {
              window.location.hash = item.actionHash;
            }}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ThisWeekPreviewWidget({ dashboard }: { dashboard: HomeDashboardResponse }) {
  const businessPulse = dashboard.widgets.business_pulse;
  const weekShootCount =
    businessPulse.tiles.find((tile) => tile.id === "shoots_this_week")?.value ??
    businessPulse.week_schedule.reduce((total, day) => total + day.shoot_count, 0);
  const highRiskDays = businessPulse.week_schedule.filter((day) => day.attention_count > 0);
  const bigDays = businessPulse.week_schedule.filter((day) => day.big_shoot_count > 0);
  const highRiskLabel = highRiskDays.length
    ? `${highRiskDays.map((day) => day.short_label).join(", ")} need extra watch`
    : "No high-risk days are bubbling up right now.";
  const bigShootLabel = bigDays.length
    ? `${bigDays.reduce((total, day) => total + day.big_shoot_count, 0)} big or critical shoots hit ${bigDays.map((day) => day.short_label).join(", ")}`
    : "No unusually large shoots are stacking up this week.";
  const thisWeekSummary = businessPulse.jobs.length
    ? `${weekShootCount} shoots are scheduled this week, with ${businessPulse.jobs.length} deadline or readiness item${businessPulse.jobs.length === 1 ? "" : "s"} still needing follow-through.`
    : `${weekShootCount} shoots are scheduled this week, and the current rhythm looks steady.`;

  return (
    <section className="panel home-widget home-widget--week-preview home-widget--compact">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Planning</div>
          <div className="section-title">This Week Preview</div>
        </div>
        <div className="home-widget__support muted">
          {formatShortDate(businessPulse.week_start)} to {formatShortDate(businessPulse.week_end)}
        </div>
      </div>
      <p className="home-widget__summary">{thisWeekSummary}</p>
      <div className="week-glance-grid week-glance-grid--compact">
        {businessPulse.week_schedule.map((day) => (
          <article key={day.date} className={`week-glance-day${day.is_today ? " week-glance-day--today" : ""}`}>
            <div className="week-glance-day__label">
              <span>{day.short_label}</span>
              <strong>{day.shoot_count}</strong>
            </div>
            <div className="muted">{day.label}</div>
            <div className="week-glance-day__chips">
              {day.big_shoot_count ? <span className="home-tone-chip home-tone-chip--info">{day.big_shoot_count} big</span> : null}
              {day.attention_count ? (
                <span className={`home-tone-chip home-tone-chip--${day.attention_count > 1 ? "action_needed" : "heads_up"}`}>
                  {day.attention_count} watch
                </span>
              ) : (
                <span className="home-tone-chip home-tone-chip--good">Clear</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="home-widget__stack">
        <button
          type="button"
          className="home-list-row home-list-row--button"
          onClick={() => {
            window.location.hash = "#operations/schedule";
          }}
        >
          <div>
            <strong>High-Risk Days</strong>
            <div className="muted">{highRiskLabel}</div>
          </div>
          <span className={`home-tone-chip home-tone-chip--${highRiskDays.length ? "action_needed" : "good"}`}>
            {highRiskDays.length ? `${highRiskDays.length} watch` : "Clear"}
          </span>
        </button>
        <button
          type="button"
          className="home-list-row home-list-row--button"
          onClick={() => {
            window.location.hash = "#operations/shoots";
          }}
        >
          <div>
            <strong>Big / Critical Shoots</strong>
            <div className="muted">{bigShootLabel}</div>
          </div>
          <span className={`home-tone-chip home-tone-chip--${bigDays.length ? "info" : "good"}`}>
            {bigDays.length ? `${bigDays.length} day${bigDays.length === 1 ? "" : "s"}` : "Normal"}
          </span>
        </button>
        {businessPulse.jobs.slice(0, 2).map((job) => (
          <button
            key={job.id}
            type="button"
            className="home-list-row home-list-row--button"
            onClick={() => {
              window.location.hash = "#production/workload";
            }}
          >
            <div>
              <strong>{job.label}</strong>
              <div className="muted">{job.detail}</div>
            </div>
            <span className={`home-tone-chip home-tone-chip--${job.tone}`}>{toneCopy(job.tone)}</span>
          </button>
        ))}
        {!businessPulse.jobs.length ? (
          <div className="empty-state empty-state--panel">No week-level deadlines or weak-coverage days are slipping right now.</div>
        ) : null}
      </div>
      <div className="home-detail-actions">
        <button
          className="secondary-button"
          onClick={() => {
            window.location.hash = "#operations/schedule";
          }}
        >
          Open This Week
        </button>
      </div>
    </section>
  );
}

function UrgentWatchWidget({
  data,
  onOpenDetail
}: {
  data: HomeDashboardResponse["widgets"]["urgent_watch"];
  onOpenDetail: (detail: DetailState) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overdueCount = data.items.filter((item) => item.urgency_state === "overdue").length;
  const atRiskCount = data.items.filter((item) => item.urgency_state === "at_risk").length;
  const shouldAutoExpand = data.tone === "action_needed" || overdueCount > 0 || data.items.length <= 2;

  useEffect(() => {
    setExpanded(shouldAutoExpand);
    setExpandedId(shouldAutoExpand ? data.items[0]?.id ?? null : null);
  }, [data.items, shouldAutoExpand]);

  return (
    <section
      className={`panel home-widget home-widget--heads-up home-widget--urgent-watch home-widget--attention-now${
        shouldAutoExpand ? " home-widget--urgent-watch-strong" : ""
      }`}
    >
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Attention Now</div>
          <div className="section-title">What Needs Attention Right Now</div>
        </div>
        <div className="home-widget__support">
          <span className={`home-tone-chip home-tone-chip--${data.tone}`}>{toneCopy(data.tone)}</span>
          <span className={`metric-pill${overdueCount ? " metric-pill--warning" : ""}`}>{data.items.length} urgent</span>
          <span className="metric-pill">{atRiskCount ? `${atRiskCount} at risk` : "Next 24 hours"}</span>
          <button type="button" className="home-inline-button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Compact" : `Show ${data.items.length} detail${data.items.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      <p className="home-widget__summary">{data.summary_line}</p>
      {expanded ? (
        <div className="home-urgent-watch-list">
          {data.items.map((item) => {
            const itemExpanded = expandedId === item.id;
            const previewState = resolveUrgentWatchDetailState(item);
            return (
              <article
                key={item.id}
                className={`home-urgent-watch-card home-urgent-watch-card--${item.urgency_state}`}
              >
                <button
                  type="button"
                  className="home-urgent-watch-card__toggle"
                  aria-expanded={itemExpanded}
                  onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                >
                  <div className="home-urgent-watch-card__top">
                    <span className="home-urgent-watch-badge">
                      <span aria-hidden="true">!</span>
                      {item.urgency_label}
                    </span>
                    <span className="home-tone-chip home-tone-chip--action_needed">{item.kind_label}</span>
                    {item.supporting_label ? <span className="muted">{item.supporting_label}</span> : null}
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </button>
                {itemExpanded ? (
                  <div className="home-urgent-watch-card__detail">
                    <div className="home-urgent-watch-card__actions">
                      {previewState ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => onOpenDetail(previewState)}
                        >
                          Preview on Home
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary-button home-urgent-watch-card__action-primary"
                        onClick={() => {
                          window.location.hash = item.action_hash;
                        }}
                      >
                        {item.action_label}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="home-heads-up-compact-list">
          {data.items.slice(0, 3).map((item) => {
            const previewState = resolveUrgentWatchDetailState(item);
            return (
              <button
                key={item.id}
                type="button"
                className={`home-heads-up-mini home-heads-up-mini--${item.tone}`}
                onClick={() => {
                  if (previewState) {
                    onOpenDetail(previewState);
                    return;
                  }
                  window.location.hash = item.action_hash;
                }}
              >
                <span className="home-tone-chip home-tone-chip--action_needed">{item.kind_label}</span>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HeadsUpWidget({
  dashboard,
  items,
  sectionTone,
  compactByDefault = false,
  onOpenDetail
}: {
  dashboard: HomeDashboardResponse;
  items: HeadsUpItem[];
  sectionTone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
  compactByDefault?: boolean;
  onOpenDetail: (detail: DetailState) => void;
}) {
  const [expanded, setExpanded] = useState(!compactByDefault);
  const compactMode = compactByDefault && !expanded;

  useEffect(() => {
    setExpanded(!compactByDefault);
  }, [compactByDefault, items.length, sectionTone]);

  return (
    <section className={`panel home-widget home-widget--heads-up home-widget--attention-now${compactMode ? " home-widget--heads-up-collapsed" : ""}`}>
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Attention Now</div>
          <div className="section-title">What Needs Attention Right Now</div>
        </div>
        <div className="home-widget__support">
          <span className={`home-tone-chip home-tone-chip--${sectionTone}`}>{toneCopy(sectionTone)}</span>
          <span className="metric-pill">Next 24 hours</span>
          {compactByDefault ? (
            <button type="button" className="home-inline-button" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "Compact" : items.length ? `Show ${items.length} detail${items.length === 1 ? "" : "s"}` : "Expand"}
            </button>
          ) : null}
        </div>
      </div>
      <p className="home-widget__summary">{dashboard.critical_banner?.message ?? buildHeadsUpSummary(items)}</p>
      {compactMode ? (
        <div className="home-heads-up-compact-list">
          {items.slice(0, 2).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`home-heads-up-mini home-heads-up-mini--${item.tone}`}
              onClick={() => onOpenDetail(item.detailState)}
            >
              <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{item.kindLabel}</span>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
          {!items.length ? <div className="home-heads-up-compact-empty">No same-day escalations are raised right now.</div> : null}
        </div>
      ) : (
        <div className="home-heads-up-grid">
          {items.map((item) => (
            <button key={item.id} type="button" className={`home-heads-up-card home-heads-up-card--${item.tone}`} onClick={() => onOpenDetail(item.detailState)}>
              <div className="home-heads-up-card__top">
                <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{item.kindLabel}</span>
                {item.supporting ? <span className="muted">{item.supporting}</span> : null}
              </div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </button>
          ))}
          {!items.length ? <div className="empty-state empty-state--panel">No same-day escalations are raised right now.</div> : null}
        </div>
      )}
    </section>
  );
}

function MyFollowUpsWidget({
  dashboard,
  currentUser
}: {
  dashboard: HomeDashboardResponse;
  currentUser?: SessionUser | null;
}) {
  const items = buildHomeFollowUpItems(dashboard, currentUser);

  return (
    <section className="panel home-widget home-widget--follow-ups home-widget--compact">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Follow-Through</div>
          <div className="section-title">My Follow-Ups</div>
        </div>
        <div className="home-widget__support">
          <span className="metric-pill">{items.length} open</span>
        </div>
      </div>
        <p className="home-widget__summary">Approvals, owned work at risk, unresolved tasks due soon, and operational follow-through still waiting on you.</p>
      <div className="home-widget__stack">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`home-list-row home-list-row--button home-list-row--${item.tone}`}
            onClick={() => {
              window.location.hash = item.actionHash;
            }}
          >
            <div>
              <strong>{item.label}</strong>
              <div className="muted">{item.detail}</div>
            </div>
            <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{toneCopy(item.tone)}</span>
          </button>
        ))}
        {!items.length ? <div className="empty-state empty-state--panel">No follow-ups need your attention right now.</div> : null}
      </div>
    </section>
  );
}

function RecentActivityHomeWidget({ dashboard }: { dashboard: HomeDashboardResponse }) {
  const items = buildHomeRecentActivityItems(dashboard);

  return (
    <section className="panel home-widget home-widget--recent-activity home-widget--compact">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Recent Activity</div>
          <div className="section-title">Recent Activity</div>
        </div>
        <div className="home-widget__support muted">Updated {formatRefreshTime(dashboard.generated_at)}</div>
      </div>
      <div className="home-widget__stack">
        {items.map((item) =>
          item.actionHash ? (
            <button
              key={item.id}
              type="button"
              className="home-list-row home-list-row--button"
              onClick={() => {
                window.location.hash = item.actionHash!;
              }}
            >
              <div>
                <strong>{item.title}</strong>
                <div className="muted">{item.detail}</div>
              </div>
              <div className="home-list-row__meta">
                <span>{item.meta}</span>
              </div>
            </button>
          ) : (
            <div key={item.id} className="home-list-row">
              <div>
                <strong>{item.title}</strong>
                <div className="muted">{item.detail}</div>
              </div>
              <div className="home-list-row__meta">
                <span>{item.meta}</span>
              </div>
            </div>
          )
        )}
        {!items.length ? <div className="empty-state empty-state--panel">No recent activity is bubbling up right now.</div> : null}
      </div>
    </section>
  );
}

function ProjectTrackerWidget({
  data
}: {
  data: HomeDashboardResponse["widgets"]["production_projects"] | undefined;
}) {
  if (!data?.visible) {
    return null;
  }

  const activeJobsCount = data.owners.reduce((total, owner) => total + owner.open_count, 0);
  const dueWithin24HoursCount = data.urgent_items.filter((item) => item.urgency_state === "due_within_24h").length;
  const snapshotCards: Array<{
    id: string;
    label: string;
    value: number;
    tone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"];
    detail: string;
    actionHash: string;
  }> = [
    {
      id: "work_in_progress",
      label: "Active Jobs",
      value: activeJobsCount,
      tone: "info",
      detail: "Total open production work still moving today.",
      actionHash: "#production/workload"
    },
    {
      id: "overdue",
      label: "Overdue",
      value: data.counts.overdue,
      tone: data.counts.overdue ? "action_needed" : "good",
      detail: "Checklist or release work already past due.",
      actionHash: "#production?queue=at_risk_queue&due_state=overdue"
    },
    {
      id: "due_within_24h",
      label: "Due in 24h",
      value: dueWithin24HoursCount,
      tone: dueWithin24HoursCount ? "heads_up" : "good",
      detail: "Jobs that will slip soon without same-day movement.",
      actionHash: "#production/workload"
    },
    {
      id: "blocked",
      label: "Blocked",
      value: data.counts.blocked,
      tone: data.counts.blocked ? "action_needed" : "good",
      detail: "Work waiting on changes, fixes, or input.",
      actionHash: "#production/qa?queue=blocked_queue&stage=blocked"
    },
    {
      id: "qa_issues",
      label: "QA Issues",
      value: data.counts.jobs_in_qa,
      tone: data.counts.jobs_in_qa ? "heads_up" : "good",
      detail: "Jobs waiting on peer review or QA attention.",
      actionHash: "#production/qa?queue=qa_queue&stage=ready_for_qa"
    },
    {
      id: "waiting_on_release",
      label: "Waiting on Release",
      value: data.counts.ready_to_release,
      tone: data.counts.ready_to_release ? "heads_up" : "good",
      detail: "Jobs waiting on upload, delivery prep, or final release signoff.",
      actionHash: "#production/release?queue=ready_to_release_queue&stage=ready_to_release"
    },
    {
      id: "unassigned",
      label: "Unassigned",
      value: data.counts.unassigned_jobs,
      tone: data.counts.unassigned_jobs ? "action_needed" : "good",
      detail: "Production work without a clear owner.",
      actionHash: "#production/workload"
    }
  ];

  return (
    <section className="panel home-widget home-widget--project-tracker">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Production</div>
          <div className="section-title">Production Snapshot</div>
        </div>
        <div className="home-widget__support">
          <span className={`home-tone-chip home-tone-chip--${data.tone}`}>{toneCopy(data.tone)}</span>
          <span className="metric-pill">Active {activeJobsCount}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              window.location.hash = "#production";
            }}
          >
            Open Production
          </button>
        </div>
      </div>
      <p className="home-widget__summary">{data.summary_line}</p>
      <div className="home-project-snapshot-grid">
        {snapshotCards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="home-project-count-card home-project-count-card--button"
            onClick={() => {
              window.location.hash = card.actionHash;
            }}
          >
            <span className="muted">{card.label}</span>
            <strong>{card.value}</strong>
            <span className="home-project-count-card__detail">{card.detail}</span>
            <span className={`home-tone-chip home-tone-chip--${card.tone}`}>{toneCopy(card.tone)}</span>
          </button>
        ))}
      </div>
      {data.focus_items.length ? (
        <div className="home-project-focus-list">
          <div className="eyebrow">Review &amp; Release Focus</div>
          <div className="home-project-focus-stack">
            {data.focus_items.map((item) => (
              <button
                key={item.project_id}
                type="button"
                className={`home-project-focus-row home-project-focus-row--${item.tone}`}
                onClick={() => {
                  window.location.hash = item.action_hash;
                }}
              >
                <div className="home-project-focus-row__top">
                  <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{item.queue_label}</span>
                  <span className="home-tone-chip home-tone-chip--info">{item.stage_label}</span>
                  {item.reviewer_label ? <span className="muted">{item.reviewer_label}</span> : null}
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <div className="home-project-focus-row__meta">
                  <span>{item.owner_label}</span>
                  {item.due_label ? <span>{item.due_label}</span> : null}
                  <span>{item.next_action}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : data.urgent_items.length ? (
        <div className="home-project-focus-list">
          <div className="eyebrow">Immediate Production Watch</div>
          <div className="home-project-focus-stack">
            {data.urgent_items.map((item) => (
              <button
                key={item.project_id}
                type="button"
                className={`home-project-focus-row home-project-focus-row--${item.urgency_state === "overdue" ? "action_needed" : "heads_up"}`}
                onClick={() => {
                  window.location.hash = item.action_hash;
                }}
              >
                <div className="home-project-focus-row__top">
                  <span className="home-urgent-watch-badge">
                    <span aria-hidden="true">!</span>
                    {item.urgency_label}
                  </span>
                  <span className="home-tone-chip home-tone-chip--heads_up">{item.stage_label}</span>
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <div className="home-project-focus-row__meta">
                  <span>{item.owner_label}</span>
                  {item.due_label ? <span>{item.due_label}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="home-project-owners">
        <div className="eyebrow">Who Is Working On What</div>
        {data.owners.length ? (
          <div className="home-project-owner-list">
            {data.owners.map((owner) => (
              <button
                key={owner.owner_user_id ?? owner.owner_label}
                type="button"
                className="home-project-owner-row home-project-owner-row--button"
                onClick={() => {
                  window.location.hash = owner.action_hash;
                }}
              >
                <div>
                  <strong>{owner.owner_label}</strong>
                  <div className="muted">{owner.assignment_label}</div>
                  <div className="muted">{owner.pressure_label}</div>
                </div>
                <div className="home-project-owner-metrics">
                  <span>{owner.open_count} open</span>
                  <span>{owner.in_production_count} in production</span>
                  {owner.qa_queue_count ? <span>{owner.qa_queue_count} in QA</span> : null}
                  {owner.ready_to_release_count ? <span>{owner.ready_to_release_count} ready to release</span> : null}
                  {owner.overdue_count ? <span className="home-project-owner-overdue">{owner.overdue_count} overdue</span> : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No production work needs owner visibility right now.</div>
        )}
      </div>
    </section>
  );
}

function WeekAtGlanceWidget({
  data,
  onOpenBusinessPulse
}: {
  data: HomeDashboardResponse["widgets"]["business_pulse"] | undefined;
  onOpenBusinessPulse: () => void;
}) {
  const shootsTile = data?.tiles.find((tile) => tile.id === "shoots_this_week");
  const subjectsTile = data?.tiles.find((tile) => tile.id === "subjects_this_week");
  const attentionTile = data?.tiles.find((tile) => tile.id === "jobs_needing_attention");
  const bigShootCount = (data?.week_schedule ?? []).reduce((total, day) => total + day.big_shoot_count, 0);

  return (
    <section className="panel home-widget home-widget--week-glance">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Week at a Glance</div>
          <div className="section-title">What matters this week</div>
        </div>
        <div className="home-widget__support muted">
          {data ? `Week of ${formatShortDate(data.week_start)} to ${formatShortDate(data.week_end)}` : "Loading weekly overview"}
        </div>
      </div>
      <div className="home-stat-strip home-stat-strip--week">
        <div>
          <span>Shoots</span>
          <strong>{shootsTile?.value ?? 0}</strong>
        </div>
        <div>
          <span>Subjects</span>
          <strong>{subjectsTile?.value?.toLocaleString() ?? "0"}</strong>
        </div>
        <div>
          <span>Big / Critical</span>
          <strong>{bigShootCount}</strong>
        </div>
        <div>
          <span>Need Attention</span>
          <strong>{attentionTile?.value ?? 0}</strong>
        </div>
      </div>
      <div className="week-glance-grid">
        {(data?.week_schedule ?? []).map((day) => (
          <article key={day.date} className={`week-glance-day${day.is_today ? " week-glance-day--today" : ""}`}>
            <div className="week-glance-day__label">
              <span>{day.short_label}</span>
              <strong>{day.shoot_count}</strong>
            </div>
            <div className="muted">{day.label}</div>
            <div className="week-glance-day__chips">
              {day.big_shoot_count ? <span className="home-tone-chip home-tone-chip--info">{day.big_shoot_count} big / critical shoot{day.big_shoot_count === 1 ? "" : "s"}</span> : null}
              {day.attention_count ? (
                <span className={`home-tone-chip home-tone-chip--${day.attention_count > 1 ? "action_needed" : "heads_up"}`}>
                  {day.attention_count} watch item{day.attention_count === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="home-tone-chip home-tone-chip--good">Clear</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="home-detail-actions">
        <button className="secondary-button" onClick={onOpenBusinessPulse}>
          Open Business Pulse
        </button>
      </div>
    </section>
  );
}

function WhatsHappeningTodayWidget({
  dashboard,
  onOpenDetail
}: {
  dashboard: HomeDashboardResponse;
  onOpenDetail: (detail: DetailState) => void;
}) {
  const priorityItems = buildTodayPriorityItems(dashboard);
  const next24HourLabel = `${priorityItems.length} watch item${priorityItems.length === 1 ? "" : "s"} in the next 24 hours`;

  return (
    <section className="panel home-widget home-widget--today-brief">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Today / 24-Hour Risk</div>
          <div className="section-title">What&apos;s Happening Today</div>
        </div>
        <div className="home-widget__support home-widget__support--today">
          <span className="metric-pill">{next24HourLabel}</span>
          <span className="muted">
            {new Date(`${dashboard.anchor_date}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
      </div>
      <div className="home-stat-strip home-stat-strip--today">
        <div>
          <span>On The Board</span>
          <strong>{dashboard.widgets.today_shoots.total}</strong>
        </div>
        <div>
          <span>In Progress</span>
          <strong>{dashboard.widgets.today_shoots.in_progress_count}</strong>
        </div>
        <div>
          <span>Need Attention</span>
          <strong>{dashboard.widgets.today_shoots.needs_attention_count}</strong>
        </div>
        <div>
          <span>Weather / Travel</span>
          <strong>{dashboard.widgets.weather_travel_watch.items.length}</strong>
        </div>
        <div>
          <span>Big / Critical</span>
          <strong>{dashboard.widgets.today_shoots.big_shoot_count}</strong>
        </div>
      </div>
      <div className="home-today-brief__layout">
        <div className="home-priority-list">
          {priorityItems.map((item) => (
            <button key={item.id} type="button" className="home-priority-row" onClick={() => onOpenDetail(item.detailState)}>
              <PriorityRowContent item={item} />
            </button>
          ))}
          {!priorityItems.length ? <div className="empty-state empty-state--panel">Today looks steady. No same-day watch items are raised right now.</div> : null}
        </div>
        <div className="home-detail-callout home-today-brief__callout">
          <strong>
            {dashboard.widgets.today_shoots.needs_attention_count
              ? `${dashboard.widgets.today_shoots.needs_attention_count} same-day shoot${dashboard.widgets.today_shoots.needs_attention_count === 1 ? "" : "s"} need a closer look.`
              : dashboard.widgets.weather_travel_watch.summary_line}
          </strong>
          <div className="muted">
            The next 24 hours stays focused on same-day staffing, travel, support risk, and readiness instead of week-level reporting.
          </div>
          <div className="home-detail-actions">
            <button
              className="secondary-button"
              onClick={() => {
                window.location.hash = "#operations/shoots";
              }}
            >
              Open Shoots Queue
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                window.location.hash = "#operations/schedule";
              }}
            >
              Open Operations Calendar
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PriorityRowContent({ item }: { item: TodayPriorityItem }) {
  return (
    <>
      <div>
        <strong>{item.label}</strong>
        <div className="muted">{item.detail}</div>
      </div>
      <div className="home-list-row__meta">
        <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{buildTodayPriorityKindLabel(item.kind)}</span>
        {item.supporting ? <span className="muted">{item.supporting}</span> : null}
      </div>
    </>
  );
}

function BusinessPulseWidget({
  data,
  interactive,
  onTileClick
}: {
  data: HomeDashboardResponse["widgets"]["business_pulse"] | undefined;
  interactive: boolean;
  onTileClick: (tileId: HomeBusinessPulseTile["id"]) => void;
}) {
  return (
    <section className="panel home-widget home-widget--business-pulse">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Business Pulse</div>
          <div className="section-title">Operational Health</div>
        </div>
        <div className="home-widget__support muted">
          {data ? `Week of ${formatShortDate(data.week_start)} to ${formatShortDate(data.week_end)}` : "Loading weekly pulse"}
        </div>
      </div>
      <p className="home-widget__summary">Health and queue indicators that help leadership gauge load, pressure, and throughput without leaving the home screen.</p>
      <div className="business-pulse-ribbon">
        {(data?.tiles ?? []).map((tile) =>
          interactive ? (
            <button key={tile.id} type="button" className={`business-pulse-tile business-pulse-tile--${tile.tone}`} onClick={() => onTileClick(tile.id)}>
              <span className="business-pulse-tile__label">{tile.label}</span>
              <strong>{tile.value.toLocaleString()}</strong>
              <span className="business-pulse-tile__context">{tile.context_label}</span>
              <span className="business-pulse-tile__trend">{tile.trend_label ?? "Steady"}</span>
            </button>
          ) : (
            <article key={tile.id} className={`business-pulse-tile business-pulse-tile--${tile.tone}`}>
              <span className="business-pulse-tile__label">{tile.label}</span>
              <strong>{tile.value.toLocaleString()}</strong>
              <span className="business-pulse-tile__context">{tile.context_label}</span>
              <span className="business-pulse-tile__trend">{tile.trend_label ?? "Steady"}</span>
            </article>
          )
        )}
      </div>
      <div className="home-widget__stack">
        {(data?.jobs ?? []).slice(0, 2).map((job) => (
          <div key={job.id} className="home-list-row">
            <div>
              <strong>{job.label}</strong>
              <div className="muted">{job.detail}</div>
            </div>
            <span className={`home-tone-chip home-tone-chip--${job.tone}`}>{toneCopy(job.tone)}</span>
          </div>
        ))}
        {!data?.jobs.length ? <div className="empty-state">No week-level job pressure is raised right now.</div> : null}
      </div>
    </section>
  );
}

function AttendanceAwarenessWidget({
  data
}: {
  data: HomeDashboardResponse["widgets"]["attendance_awareness"] | undefined;
}) {
  if (!data?.visible) {
    return null;
  }

  const graceWindow = data.grace_window ?? { count: 0, items: [] };
  const criticallyLate = data.critically_late ?? { count: 0, items: [] };
  const missingClockIn = data.missing_clock_in ?? data.not_clocked_in;
  const probableNoShow = data.probable_no_show ?? data.missing;
  const missingClockInCount = data.summary.missing_clock_in_count ?? data.not_clocked_in.count;
  const criticallyLateCount = data.summary.critically_late_count ?? 0;
  const probableNoShowCount = data.summary.probable_no_show_count ?? data.missing.count;
  const staffingRiskCount = data.summary.staffing_risk_count ?? 0;

  const sections = [
    {
      id: "missing_clock_in",
      title: "Missing Clock-In",
      items: missingClockIn.items,
      count: missingClockIn.count,
      empty: "No missing clock-ins right now."
    },
    {
      id: "probable_no_show",
      title: "Probable No-Show",
      items: probableNoShow.items,
      count: probableNoShow.count,
      empty: "No probable no-shows right now."
    },
    {
      id: "critically_late",
      title: "Critically Late",
      items: criticallyLate.items,
      count: criticallyLate.count,
      empty: "No critically late arrivals right now."
    },
    {
      id: "wrong_location",
      title: "Wrong Location",
      items: data.wrong_location.items,
      count: data.wrong_location.count,
      empty: "No wrong-location signals right now."
    },
    {
      id: "late",
      title: "Late",
      items: data.late.items,
      count: data.late.count,
      empty: "No late arrivals right now."
    },
    {
      id: "grace_window",
      title: "Grace Window",
      items: graceWindow.items,
      count: graceWindow.count,
      empty: "No grace-window arrivals right now."
    },
    {
      id: "clocked_in",
      title: "Clocked In",
      items: data.clocked_in.items,
      count: data.clocked_in.count,
      empty: "No one is clocked in right now."
    }
  ] as const;
  const visibleSections = sections.filter((section) => section.id !== "clocked_in" && section.count > 0);
  const lateAndCriticalCount = data.summary.late_count + criticallyLateCount;

  return (
    <section className="panel home-widget home-widget--attendance-awareness home-widget--compact">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Attendance Awareness</div>
          <div className="section-title">Attendance Awareness</div>
        </div>
        <div className="home-widget__support">
          <span className="metric-pill">Clocked In {data.summary.clocked_in_count}</span>
          <span className={`metric-pill${missingClockInCount ? " metric-pill--warning" : ""}`}>
            Missing Clock-In {missingClockInCount}
          </span>
          <span className={`metric-pill${lateAndCriticalCount ? " metric-pill--warning" : ""}`}>Late {lateAndCriticalCount}</span>
          {probableNoShowCount ? (
            <span className="metric-pill metric-pill--warning">Probable No-Show {probableNoShowCount}</span>
          ) : null}
          <span className={`metric-pill${staffingRiskCount ? " metric-pill--warning" : ""}`}>
            Staffing Risk {staffingRiskCount}
          </span>
        </div>
      </div>
      <p className="home-widget__summary">Exception-based watch for missing clock-ins, late arrivals, no-show risk, wrong-location punches, and minimum-staffing pressure.</p>
      <div className="attendance-awareness-grid">
        {visibleSections.map((section) => (
          <article
            key={section.id}
            className={`attendance-awareness-column${
              section.count && section.id !== "clocked_in" ? " attendance-awareness-column--missing" : ""
            }`}
          >
            <div className="attendance-awareness-column__header">
              <strong>{section.title}</strong>
              <span className="metric-pill">{section.count}</span>
            </div>
            {section.items.length ? (
              <div className="attendance-awareness-list">
                {section.items.slice(0, 3).map((item) => (
                  <div key={item.id} className="attendance-awareness-item">
                    <div className="attendance-awareness-item__primary">
                      {item.primary_label}
                      <span className={`metric-pill${item.staffing_risk ? " metric-pill--warning" : ""}`}>
                        {item.severity_label ?? "Watch"}
                      </span>
                    </div>
                    {item.secondary_label ? <div className="attendance-awareness-item__secondary">{item.secondary_label}</div> : null}
                    {item.supporting_label ? <div className="attendance-awareness-item__supporting">{item.supporting_label}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state empty-state--panel">{section.empty}</div>
            )}
          </article>
        ))}
        {!visibleSections.length ? (
          <article className="attendance-awareness-column">
            <div className="attendance-awareness-column__header">
              <strong>All Clear</strong>
              <span className="metric-pill">{data.summary.clocked_in_count}</span>
            </div>
            <div className="empty-state empty-state--panel">No attendance exceptions are bubbling up right now. Clocked-in coverage looks steady.</div>
          </article>
        ) : null}
      </div>
      <div className="home-detail-actions">
        <button
          className="secondary-button"
          onClick={() => {
            window.location.hash = "#operations/attendance";
          }}
        >
          Open Attendance
        </button>
      </div>
    </section>
  );
}

function TodayShootsWidget({
  data,
  interactive,
  filter,
  visibleShoots,
  onFilterChange,
  onShootClick
}: {
  data: HomeDashboardResponse["widgets"]["today_shoots"] | undefined;
  interactive: boolean;
  filter: TodayFilter;
  visibleShoots: HomeTodayShootPreview[];
  onFilterChange: (value: TodayFilter) => void;
  onShootClick: (shootId: string) => void;
}) {
  return (
    <section className="panel home-widget home-widget--today-shoots">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Execution</div>
          <div className="section-title">Today&apos;s Shoots</div>
        </div>
        <div className="home-widget__support">
          <span className="metric-pill">{data?.total ?? 0} on the board</span>
          <span className="metric-pill">{data?.big_shoot_count ?? 0} big / critical</span>
        </div>
      </div>
      <div className="home-filter-row" role="tablist" aria-label="Today's shoot filters">
        {TODAY_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`home-filter-chip${filter === option.id ? " is-active" : ""}`}
            onClick={() => onFilterChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="today-shoots-hero__summary">
        <span className="metric-pill">{data?.upcoming_count ?? 0} coming up</span>
        <span className="metric-pill">{data?.in_progress_count ?? 0} in progress</span>
        <span className="metric-pill">{data?.needs_attention_count ?? 0} need attention</span>
      </div>
      <div className="today-shoots-list">
        {visibleShoots.map((shoot) =>
          interactive ? (
            <button key={shoot.id} type="button" className="today-shoot-row" onClick={() => onShootClick(shoot.id)}>
              <TodayShootRowContent shoot={shoot} />
            </button>
          ) : (
            <article key={shoot.id} className="today-shoot-row">
              <TodayShootRowContent shoot={shoot} />
            </article>
          )
        )}
        {!visibleShoots.length ? (
          <div className="empty-state empty-state--panel">
            {data?.total ? "Nothing matches the current view." : "No shoots or meetings scheduled for today."}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TodayShootRowContent({ shoot }: { shoot: HomeTodayShootPreview }) {
  const readyToShootChip = buildReadyToShootChip(shoot);
  return (
    <>
      <div className="today-shoot-row__time">
        <strong>{buildPreviewTimeRange(shoot)}</strong>
        <span>{shoot.phase === "in_progress" ? "Happening now" : shoot.phase === "complete" ? "Wrapped" : shoot.phase === "needs_attention" ? "Needs a closer look" : "Coming up"}</span>
      </div>
      <div className="today-shoot-row__body">
        <div className="today-shoot-row__title-line">
          <strong>{shoot.title}</strong>
          <div className="today-shoot-row__chips">
            {shoot.department ? <span className="home-tone-chip home-tone-chip--info">{humanizeDepartment(shoot.department)}</span> : null}
            {shoot.priority_display && shoot.priority_label && shoot.priority_label !== "standard" ? (
              <span className={`home-tone-chip home-tone-chip--${priorityTone(shoot.priority_label)}`} title={(shoot.priority_reasons ?? []).map((reason) => reason.label).join(", ")}>
                {shoot.priority_display}
              </span>
            ) : shoot.big_shoot ? (
              <span className="home-tone-chip home-tone-chip--neutral">{shoot.scale_label}</span>
            ) : null}
          </div>
        </div>
        <div className="muted">{shoot.location_name || shortenAddress(shoot.location_address)}</div>
        <div className="today-shoot-row__meta-line">
          <span>{shoot.shoot_code}</span>
          <span>{shoot.lead_name ? `Lead: ${shoot.lead_name}` : "Lead pending"}</span>
          {shoot.staffing_readiness_label ? (
            <span className={`today-shoot-row__meta-pill today-shoot-row__meta-pill--${shoot.staffing_readiness_tone ?? "neutral"}`}>
              {shoot.staffing_readiness_label}
            </span>
          ) : null}
          {shoot.projected_students ? <span>{shoot.projected_students} projected</span> : null}
          {shoot.estimated_drive_minutes ? <span>{shoot.estimated_drive_minutes} min drive</span> : null}
        </div>
      </div>
      <div className="today-shoot-row__status">
        <span className={`home-tone-chip home-tone-chip--${shoot.status_tone}`}>{shoot.status_label}</span>
        {shoot.attention_label ? <span className={`home-tone-chip home-tone-chip--${shoot.attention_tone ?? "heads_up"}`}>{shoot.attention_label}</span> : null}
        {readyToShootChip ? <span className={`home-tone-chip home-tone-chip--${readyToShootChip.tone}`}>{readyToShootChip.label}</span> : null}
        <span className={`home-tone-chip home-tone-chip--${shoot.sync_tone}`}>{shoot.sync_label}</span>
        <span className="today-shoot-row__next">{shoot.next_action}</span>
      </div>
    </>
  );
}

function buildReadyToShootChip(shoot: HomeTodayShootPreview) {
  if (shoot.lead_confirmed_ready_exception_flag) {
    return {
      label: "Ready with exception",
      tone: "heads_up" as const
    };
  }
  if (shoot.lead_confirmed_ready) {
    return {
      label: "Lead Confirmed Ready",
      tone: "good" as const
    };
  }
  if (shoot.ready_to_shoot_label) {
    return {
      label: shoot.ready_to_shoot_label,
      tone: shoot.ready_to_shoot_tone ?? "info"
    };
  }
  return null;
}

function WeatherTravelWidget({
  data,
  interactive,
  onOpen
}: {
  data: HomeDashboardResponse["widgets"]["weather_travel_watch"] | undefined;
  interactive: boolean;
  onOpen: (shootId?: string) => void;
}) {
  return (
    <section className="panel home-widget home-widget--weather">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Today Watch</div>
          <div className="section-title">Weather &amp; Travel</div>
        </div>
        <span className={`home-tone-chip home-tone-chip--${data?.tone ?? "neutral"}`}>{toneCopy(data?.tone ?? "neutral")}</span>
      </div>
      <p className="home-widget__summary">{data?.summary_line ?? "No weather or travel issues right now."}</p>
      <div className="home-widget__stack">
        {(data?.items ?? []).map((item) =>
          interactive ? (
            <button key={`${item.kind}-${item.shoot_id}`} type="button" className="home-list-row" onClick={() => onOpen(item.shoot_id)}>
              <WeatherTravelRow item={item} />
            </button>
          ) : (
            <article key={`${item.kind}-${item.shoot_id}`} className="home-list-row">
              <WeatherTravelRow item={item} />
            </article>
          )
        )}
        {!data?.items.length ? <div className="empty-state">No weather or travel issues right now.</div> : null}
      </div>
    </section>
  );
}

function WeatherTravelRow({ item }: { item: HomeDashboardResponse["widgets"]["weather_travel_watch"]["items"][number] }) {
  return (
    <>
      <div>
        <strong>{item.title}</strong>
        <div className="muted">
          {item.location_name} | {item.time_label}
        </div>
      </div>
      <div className="home-list-row__meta">
        <span className={`home-tone-chip home-tone-chip--${item.severity}`}>{item.kind === "weather" ? "Weather" : "Travel"}</span>
        <span className="muted">{item.summary}</span>
      </div>
    </>
  );
}

function CustomerServiceWidget({
  data,
  interactive,
  onOpen
}: {
  data: HomeDashboardResponse["widgets"]["customer_service_pulse"] | undefined;
  interactive: boolean;
  onOpen: () => void;
}) {
  return (
    <section className="panel home-widget home-widget--customer-service home-widget--compact">
        <div className="home-widget__header">
          <div>
            <div className="eyebrow">Support</div>
            <div className="section-title">Customer Service Pulse</div>
          </div>
          <span className={`home-tone-chip home-tone-chip--${data?.tone ?? "neutral"}`}>{toneCopy(data?.tone ?? "neutral")}</span>
        </div>
      <p className="home-widget__summary">{data?.summary_line ?? "Support looks steady right now."}</p>
      <div className="home-stat-strip">
          <div>
            <span>Open</span>
            <strong>{data?.open_tickets ?? 0}</strong>
          </div>
          <div>
            <span>Spike Watch</span>
            <strong>{data?.urgent_signal_count ?? 0}</strong>
          </div>
          <div>
            <span>Aging Issues</span>
            <strong>{data?.backlog_count ?? 0}</strong>
          </div>
        </div>
        <div className="home-widget__stack">
          {data?.trend_label ? (
            <div className="home-mini-row">
              <span>Complaint Trend</span>
              <strong>{data.trend_label}</strong>
            </div>
          ) : null}
          {(data?.top_categories ?? []).slice(0, 2).map((category) => (
            <div key={category.label} className="home-mini-row">
              <span>{category.label}</span>
            <strong>{category.count}</strong>
          </div>
        ))}
        {!data?.top_categories.length ? <div className="empty-state">Nothing urgent in customer service.</div> : null}
      </div>
      {interactive ? (
        <button className="secondary-button home-widget__footer-button" onClick={onOpen}>
          Open Support Summary
        </button>
      ) : null}
    </section>
  );
}

function PlacesThatNeedLoveWidget({
  data,
  interactive,
  onOpen
}: {
  data: HomeDashboardResponse["widgets"]["places_that_need_more_love"] | undefined;
  interactive: boolean;
  onOpen: (locationId: string) => void;
}) {
  return (
    <section className="panel home-widget home-widget--places home-widget--compact">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Location Context</div>
          <div className="section-title">Location Exceptions</div>
        </div>
      </div>
      <p className="home-widget__summary">{data?.summary_line ?? "No locations need extra love right now."}</p>
      <div className="home-widget__stack">
        {(data?.items ?? []).slice(0, 3).map((item) =>
          interactive ? (
            <button key={item.location_id} type="button" className="home-list-row home-list-row--warm" onClick={() => onOpen(item.location_id)}>
              <PlacesRow item={item} />
            </button>
          ) : (
            <article key={item.location_id} className="home-list-row home-list-row--warm">
              <PlacesRow item={item} />
            </article>
          )
        )}
        {!data?.items.length ? <div className="empty-state">No locations need extra love right now.</div> : null}
      </div>
    </section>
  );
}

function PlacesRow({ item }: { item: HomeDashboardResponse["widgets"]["places_that_need_more_love"]["items"][number] }) {
  return (
    <>
      <div>
        <strong>{item.name}</strong>
        <div className="muted">{item.theme_label}</div>
      </div>
      <div className="home-list-row__meta">
        <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{buildLocationImpactLabel(item)}</span>
        <span className="muted">{item.summary}</span>
      </div>
    </>
  );
}

function LaborSnapshotWidget({
  data,
  interactive,
  onOpen
}: {
  data: NonNullable<HomeDashboardResponse["widgets"]["labor_snapshot_today"]>;
  interactive: boolean;
  onOpen: () => void;
}) {
  return (
    <section className="panel home-widget home-widget--labor home-widget--compact">
      <div className="home-widget__header">
        <div>
          <div className="eyebrow">Labor</div>
          <div className="section-title">Today&apos;s Labor</div>
        </div>
        <span className={`home-tone-chip home-tone-chip--${data.tone}`}>{toneCopy(data.tone)}</span>
      </div>
      <p className="home-widget__summary">{data.summary_line}</p>
      <div className="home-stat-strip home-stat-strip--labor">
        <div>
          <span>Scheduled</span>
          <strong>{formatHours(data.scheduled_hours)}</strong>
        </div>
        <div>
          <span>Actual{data.hours_source === "canonical" ? "" : " (legacy)"}</span>
          <strong>{formatHours(data.actual_hours)}</strong>
        </div>
        <div>
          <span>OT Risk</span>
          <strong>{data.overtime_risk_count}</strong>
        </div>
      </div>
      {/* G2 honesty: say WHICH truth the Actual figure comes from. */}
      {data.hours_source_label ? <p className="muted home-widget__footnote">{data.hours_source_label}</p> : null}
      {interactive ? (
        <button className="secondary-button home-widget__footer-button" onClick={onOpen}>
          Open Labor Summary
        </button>
      ) : null}
    </section>
  );
}

function HomeDetailOverlay({
  currentUser,
  dashboard,
  selectedDetail,
  detailDefinition,
  detailLoading,
  detailError,
  shootBriefing,
  locationDetail,
  onClose
}: {
  currentUser: SessionUser | null;
  dashboard: HomeDashboardResponse;
  selectedDetail: DetailState;
  detailDefinition: typeof HOME_WIDGET_DEFINITIONS[keyof typeof HOME_WIDGET_DEFINITIONS] | null;
  detailLoading: boolean;
  detailError: string;
  shootBriefing: ShootBriefingViewModel | null;
  locationDetail: ShootLocationDetail | null;
  onClose: () => void;
}) {
  const isShootWorkspace = selectedDetail.kind === "shoot";
  const shootPreview = isShootWorkspace
    ? dashboard.widgets.today_shoots.shoots.find((shoot) => shoot.id === selectedDetail.shootId) ?? null
    : null;
  const shootWatchItems = isShootWorkspace
    ? dashboard.widgets.weather_travel_watch.items.filter((item) => item.shoot_id === selectedDetail.shootId)
    : [];

  return (
    <div className={`drawer-overlay home-detail-overlay${isShootWorkspace ? " home-detail-overlay--workspace" : ""}`} role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className={`panel home-detail-overlay__content${isShootWorkspace ? " home-detail-overlay__content--workspace" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {isShootWorkspace ? (
          <div className="home-shoot-workspace__header">
            <div>
              <div className="eyebrow">Shoot Workspace</div>
              <h3>{shootBriefing?.title ?? shootPreview?.title ?? "Operational Briefing"}</h3>
              <p className="section-subtitle">
                {shootBriefing
                  ? `${shootBriefing.shootCode} | ${shootBriefing.locationLine} | ${shootBriefing.timeRange}`
                  : "Loading the selected shoot workspace."}
              </p>
            </div>
            <button className="secondary-button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="home-detail-overlay__header">
              <div>
                <div className="eyebrow">Operational Detail</div>
                <h3>{detailDefinition?.title ?? "Detail"}</h3>
                <p className="section-subtitle">{detailDefinition?.purpose ?? "Select a widget to open deeper operational context."}</p>
              </div>
              <button className="secondary-button" onClick={onClose}>
                Close
              </button>
            </div>
            <div className="home-detail-overlay__meta">
              <span className="metric-pill">Refresh {detailDefinition?.refreshBehavior ?? "Manual"}</span>
              <span className="metric-pill">Data {detailDefinition?.dataSource ?? "Operational reporting"}</span>
            </div>
          </>
        )}
        {detailError ? <div className="error-banner">{detailError}</div> : null}
        <div className="home-detail-overlay__scroll">
          <HomeDetailContent
            currentUser={currentUser}
            dashboard={dashboard}
            selectedDetail={selectedDetail}
            detailLoading={detailLoading}
            shootBriefing={shootBriefing}
            shootPreview={shootPreview}
            shootWatchItems={shootWatchItems}
            locationDetail={locationDetail}
          />
        </div>
      </div>
    </div>
  );
}

function HomeDetailContent({
  currentUser,
  dashboard,
  selectedDetail,
  detailLoading,
  shootBriefing,
  shootPreview,
  shootWatchItems,
  locationDetail
}: {
  currentUser: SessionUser | null;
  dashboard: HomeDashboardResponse;
  selectedDetail: DetailState | null;
  detailLoading: boolean;
  shootBriefing: ShootBriefingViewModel | null;
  shootPreview: HomeTodayShootPreview | null;
  shootWatchItems: HomeWeatherTravelItem[];
  locationDetail: ShootLocationDetail | null;
}) {
  if (!selectedDetail) {
    return <div className="empty-state empty-state--panel">Open a widget to see the deeper operational context without crowding the main home screen.</div>;
  }

  if (selectedDetail.kind === "business_pulse") {
    const tile = selectedDetail.tileId ? dashboard.widgets.business_pulse.tiles.find((entry) => entry.id === selectedDetail.tileId) : null;
    return (
      <div className="home-detail-content">
        <div className="home-detail-callout">
          <strong>{tile?.label ?? "Business Pulse"}</strong>
          <div className="muted">{tile?.context_label ?? "Week-level business totals and queue context."}</div>
        </div>
        <OperationalDetailSection title="Weekly Mix" summary="Department volume at a glance" defaultOpen>
          <div className="home-detail-list">
            {dashboard.widgets.business_pulse.weekly_department_mix.map((row) => (
              <div key={row.department} className="home-mini-row">
                <span>{humanizeDepartment(row.department)}</span>
                <strong>
                  {row.shoots} shoots | {row.subjects.toLocaleString()} subjects
                </strong>
              </div>
            ))}
            {!dashboard.widgets.business_pulse.weekly_department_mix.length ? <div className="empty-state">No weekly department totals are in view.</div> : null}
          </div>
        </OperationalDetailSection>
        <OperationalDetailSection title="Jobs Needing Attention" summary="Late, at-risk, or sync-watch jobs">
          <div className="home-detail-list">
            {dashboard.widgets.business_pulse.jobs.map((job) => (
              <div key={job.id} className="home-list-row">
                <div>
                  <strong>{job.label}</strong>
                  <div className="muted">{job.detail}</div>
                </div>
                <span className={`home-tone-chip home-tone-chip--${job.tone}`}>{toneCopy(job.tone)}</span>
              </div>
            ))}
            {!dashboard.widgets.business_pulse.jobs.length ? <div className="empty-state">Nothing urgent right now.</div> : null}
          </div>
        </OperationalDetailSection>
        <div className="home-detail-actions">
          <button className="secondary-button" onClick={() => {
            window.location.hash = "#operations/schedule";
          }}>
            Open Schedule Board
          </button>
        </div>
      </div>
    );
  }

  if (selectedDetail.kind === "shoot") {
    return detailLoading ? (
      <div className="empty-state empty-state--panel">Loading the operational briefing...</div>
    ) : shootBriefing ? (
      <div className="home-detail-content home-shoot-workspace">
        <div className="home-shoot-workspace__chips">
          {shootPreview?.department ? <span className="home-tone-chip home-tone-chip--info">{humanizeDepartment(shootPreview.department)}</span> : null}
          {shootPreview?.priority_display && shootPreview.priority_label && shootPreview.priority_label !== "standard" ? (
            <span className={`home-tone-chip home-tone-chip--${priorityTone(shootPreview.priority_label)}`}>{shootPreview.priority_display}</span>
          ) : null}
          {shootPreview?.attention_label ? <span className={`home-tone-chip home-tone-chip--${shootPreview.attention_tone ?? "heads_up"}`}>{shootPreview.attention_label}</span> : null}
          {shootPreview?.status_label ? <span className={`home-tone-chip home-tone-chip--${shootPreview.status_tone}`}>{shootPreview.status_label}</span> : null}
          {shootPreview?.sync_label ? <span className={`home-tone-chip home-tone-chip--${shootPreview.sync_tone}`}>{shootPreview.sync_label}</span> : null}
        </div>
        <div className="home-stat-strip home-stat-strip--workspace">
          <div>
            <span>Time Window</span>
            <strong>{shootBriefing.timeRange}</strong>
          </div>
          <div>
            <span>Staffing</span>
            <strong>{shootBriefing.staffingDetail}</strong>
          </div>
          <div>
            <span>Profitability / Complexity</span>
            <strong>{shootBriefing.profitabilityDisplay ?? "Needs Review"}</strong>
          </div>
          <div>
            <span>Weather / Travel</span>
            <strong>{shootWatchItems.length ? `${shootWatchItems.length} flagged` : "Clear"}</strong>
          </div>
        </div>
        <div className="home-detail-callout home-shoot-workspace__callout">
          <strong>{shootBriefing.statusNote}</strong>
          <div className="muted">
            {shootPreview?.next_action ?? (shootBriefing.statusNote.includes("No unresolved") ? "Today looks dialed in." : "A closer look helps keep the day smooth.")}
          </div>
        </div>
        <ShootBriefingBody briefing={shootBriefing} travelWatchItems={shootWatchItems} hidePrioritySection />
        <div className="home-detail-actions">
          <button className="secondary-button" onClick={() => {
            window.location.hash = "#operations/shoots";
          }}>
            Open Shoots Queue
          </button>
          <button className="secondary-button" onClick={() => {
            window.location.hash = "#operations/schedule";
          }}>
            Open Operations Calendar
          </button>
          {shootBriefing.mapsUrl ? (
            <a className="secondary-button" href={shootBriefing.mapsUrl} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
          ) : null}
        </div>
      </div>
    ) : (
      <div className="empty-state empty-state--panel">We couldn&apos;t load that shoot briefing.</div>
    );
  }

  if (selectedDetail.kind === "weather") {
    const focused = selectedDetail.shootId
      ? dashboard.widgets.weather_travel_watch.items.filter((item) => item.shoot_id === selectedDetail.shootId)
      : dashboard.widgets.weather_travel_watch.items;
    return (
      <div className="home-detail-content">
        <div className="home-detail-callout">
          <strong>{dashboard.widgets.weather_travel_watch.summary_line}</strong>
          <div className="muted">Open the impacted shoot to see the deeper location and route context.</div>
        </div>
        <div className="home-detail-list">
          {focused.map((item) => (
            <div key={`${item.kind}-${item.shoot_id}`} className="home-list-row">
              <div>
                <strong>{item.title}</strong>
                <div className="muted">
                  {item.location_name} | {item.time_label}
                </div>
              </div>
              <div className="home-list-row__meta">
                <span className={`home-tone-chip home-tone-chip--${item.severity}`}>{item.kind === "weather" ? "Weather" : "Travel"}</span>
                <span className="muted">{item.summary}</span>
              </div>
            </div>
          ))}
          {!focused.length ? <div className="empty-state">No weather or travel issues right now.</div> : null}
        </div>
        <div className="home-detail-actions">
          <button className="secondary-button" onClick={() => {
            window.location.hash = "#operations/schedule";
          }}>
            Open Today&apos;s Schedule
          </button>
        </div>
      </div>
    );
  }

  if (selectedDetail.kind === "customer_service") {
    return (
      <div className="home-detail-content">
        <div className="home-detail-callout">
          <strong>{dashboard.widgets.customer_service_pulse.summary_line}</strong>
          <div className="muted">{dashboard.widgets.customer_service_pulse.trend_label}</div>
        </div>
        <OperationalDetailSection title="Top Categories" summary="Safe summary only" defaultOpen>
          <div className="home-detail-list">
            {dashboard.widgets.customer_service_pulse.top_categories.map((category) => (
              <div key={category.label} className="home-mini-row">
                <span>{category.label}</span>
                <strong>{category.count}</strong>
              </div>
            ))}
            {!dashboard.widgets.customer_service_pulse.top_categories.length ? <div className="empty-state">Nothing urgent in customer service.</div> : null}
          </div>
        </OperationalDetailSection>
        <div className="home-detail-actions">
          {currentUser && canViewCustomerService(currentUser) && dashboard.widgets.customer_service_pulse.drilldown_enabled ? (
            <button className="secondary-button" onClick={() => {
              window.location.hash = "#reports/customer-service";
            }}>
              Open Customer Service
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (selectedDetail.kind === "location") {
    return detailLoading ? (
      <div className="empty-state empty-state--panel">Loading location history...</div>
    ) : locationDetail ? (
      <div className="home-detail-content">
        <div className="home-detail-callout">
          <strong>{locationDetail.name}</strong>
          <div className="muted">{locationDetail.address ?? "Address pending"}</div>
        </div>
        <div className="home-stat-strip">
          <div>
            <span>Setup Readiness</span>
            <strong>{getLocationReadinessLabel(locationDetail)}</strong>
          </div>
          <div>
            <span>Last Rating</span>
            <strong>{locationDetail.stats.avg_rating ?? "—"}</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{getLocationConfidenceLabel(locationDetail)}</strong>
          </div>
        </div>
        <OperationalDetailSection title="Highlights" summary="The most useful things to know first" defaultOpen>
          <ul className="detail-bullet-list">
            {buildLocationHighlights(locationDetail).map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </OperationalDetailSection>
        <OperationalDetailSection title="Setup Photos" summary="Recent visual references">
          <div className="shoot-briefing__gallery">
            {locationDetail.photo_gallery.slice(0, 3).map((photo) => (
              <figure key={photo.id} className="setup-photo-card">
                <img src={photo.image_url} alt={photo.caption} />
                <figcaption>{photo.caption}</figcaption>
              </figure>
            ))}
            {!locationDetail.photo_gallery.length ? <div className="empty-state">No setup photos are attached yet.</div> : null}
          </div>
        </OperationalDetailSection>
        <OperationalDetailSection title="Recent Evaluations" summary="What has helped lately">
          <div className="home-detail-list">
            {locationDetail.evaluations.slice(0, 4).map((evaluation) => (
              <div key={evaluation.id} className="home-list-row">
                <div>
                  <strong>{evaluation.shoot_name}</strong>
                  <div className="muted">
                    {evaluation.shoot_date} | {evaluation.photographer_name}
                  </div>
                </div>
                <div className="home-list-row__meta">
                  <span className="home-tone-chip home-tone-chip--info">{evaluation.overall_rating}/5</span>
                  <span className="muted">{evaluation.recommendations || evaluation.notes || "No extra note was captured."}</span>
                </div>
              </div>
            ))}
            {!locationDetail.evaluations.length ? <div className="empty-state">No post-shoot history is attached yet.</div> : null}
          </div>
        </OperationalDetailSection>
        <div className="home-detail-actions">
          <button className="secondary-button" onClick={() => {
            window.location.hash = buildLocationHash(locationDetail.id);
          }}>
            Open Location Guide
          </button>
          {locationDetail.navigation_url ? (
            <a className="secondary-button" href={locationDetail.navigation_url} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
          ) : null}
        </div>
      </div>
    ) : (
      <div className="empty-state empty-state--panel">We couldn&apos;t load that location context.</div>
    );
  }

  if (selectedDetail.kind === "labor") {
    const labor = dashboard.widgets.labor_snapshot_today;
    if (!labor?.visible) {
      return <div className="empty-state empty-state--panel">Labor snapshot is not visible for this account.</div>;
    }
    return (
      <div className="home-detail-content">
        <div className="home-detail-callout">
          <strong>{labor.summary_line}</strong>
          <div className="muted">Public-safe labor visibility only. No payroll, wages, or person-level disciplinary detail.</div>
        </div>
        <OperationalDetailSection title="Department Rollup" summary="Scheduled vs actual by department" defaultOpen>
          <div className="home-detail-list">
            {labor.department_rollup.map((row) => (
              <div key={row.label} className="home-mini-row">
                <span>{humanizeDepartment(row.label)}</span>
                <strong>
                  {formatHours(row.actual_hours)} actual | {formatHours(row.scheduled_hours)} scheduled
                </strong>
              </div>
            ))}
            {!labor.department_rollup.length ? <div className="empty-state">No department labor rollup is available yet.</div> : null}
          </div>
        </OperationalDetailSection>
        <OperationalDetailSection title="Shoot Rollup" summary="The shoots carrying the most hours">
          <div className="home-detail-list">
            {labor.shoot_rollup.map((row) => (
              <div key={row.label} className="home-mini-row">
                <span>{row.label}</span>
                <strong>
                  {formatHours(row.actual_hours)} actual | {formatHours(row.scheduled_hours)} scheduled
                </strong>
              </div>
            ))}
            {!labor.shoot_rollup.length ? <div className="empty-state">No shoot labor rollup is available yet.</div> : null}
          </div>
        </OperationalDetailSection>
        <div className="home-detail-actions">
          {currentUser && canViewLabor(currentUser) ? (
            <button className="secondary-button" onClick={() => {
              window.location.hash = "#reports/labor";
            }}>
              Open Labor
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function TvStatusBoard({
  dashboard,
  currentPage,
  onPageSelect,
  presentationMode,
  bigShoots
}: {
  dashboard: HomeDashboardResponse;
  currentPage: number;
  onPageSelect: (page: number) => void;
  presentationMode: boolean;
  bigShoots: HomeTodayShootPreview[];
}) {
  return (
    <div className="tv-board-layout">
      <BusinessPulseWidget data={dashboard.widgets.business_pulse} interactive={false} onTileClick={() => undefined} />
      {!presentationMode ? (
        <div className="tv-page-nav">
          {TV_PAGE_LABELS.map((label, index) => (
            <button key={label} type="button" className={`home-filter-chip${currentPage === index ? " is-active" : ""}`} onClick={() => onPageSelect(index)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {currentPage === 0 ? (
        <section className="panel home-widget home-widget--tv-hero">
          <div className="home-widget__header">
            <div>
              <div className="eyebrow">Today&apos;s Shoots</div>
              <div className="section-title">Today&apos;s Shoots</div>
            </div>
            <div className="home-widget__support">
              <span className="metric-pill">{dashboard.widgets.today_shoots.total} on the board</span>
              <span className="metric-pill">{dashboard.widgets.today_shoots.big_shoot_count} big / critical</span>
            </div>
          </div>
          <div className="tv-shoot-groups">
            {groupShootsForTv(dashboard.widgets.today_shoots.shoots).map((group) => (
              <section key={group.label} className="tv-shoot-group">
                <div className="tv-shoot-group__label">{group.label}</div>
                <div className="tv-shoot-group__rows">
                  {group.shoots.map((shoot) => (
                    <article key={shoot.id} className="tv-shoot-row">
                      <div>
                        <strong>{shoot.title}</strong>
                        <div className="muted">{shoot.location_name || shortenAddress(shoot.location_address)}</div>
                      </div>
                      <div className="tv-shoot-row__meta">
                        {shoot.priority_display && shoot.priority_label && shoot.priority_label !== "standard" ? (
                          <span className={`home-tone-chip home-tone-chip--${priorityTone(shoot.priority_label)}`}>{shoot.priority_display}</span>
                        ) : shoot.big_shoot ? (
                          <span className="home-tone-chip home-tone-chip--info">{shoot.scale_label}</span>
                        ) : null}
                        {shoot.attention_label ? <span className={`home-tone-chip home-tone-chip--${shoot.attention_tone ?? "heads_up"}`}>{shoot.attention_label}</span> : null}
                        <span className={`home-tone-chip home-tone-chip--${shoot.status_tone}`}>{shoot.status_label}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {!dashboard.widgets.today_shoots.shoots.length ? <div className="empty-state empty-state--panel">No shoots or meetings scheduled for today.</div> : null}
          </div>
        </section>
      ) : null}
      {currentPage === 1 ? (
        <div className="tv-split-grid">
          <WeatherTravelWidget data={dashboard.widgets.weather_travel_watch} interactive={false} onOpen={() => undefined} />
          <CustomerServiceWidget data={dashboard.widgets.customer_service_pulse} interactive={false} onOpen={() => undefined} />
        </div>
      ) : null}
      {currentPage === 2 ? (
        <div className="tv-split-grid">
          <PlacesThatNeedLoveWidget data={dashboard.widgets.places_that_need_more_love} interactive={false} onOpen={() => undefined} />
          <section className="panel home-widget">
            <div className="home-widget__header">
              <div>
                <div className="eyebrow">Flagged Shoots</div>
                <div className="section-title">Big and Critical Callouts</div>
              </div>
            </div>
            <div className="home-widget__stack">
              {bigShoots.map((shoot) => (
                <article key={shoot.id} className="home-list-row">
                  <div>
                    <strong>{shoot.title}</strong>
                    <div className="muted">{shoot.location_name || shortenAddress(shoot.location_address)}</div>
                  </div>
                  <div className="home-list-row__meta">
                    <span className={`home-tone-chip home-tone-chip--${shoot.priority_label ? priorityTone(shoot.priority_label) : "info"}`}>
                      {shoot.priority_display ?? shoot.scale_label}
                    </span>
                    <span className="muted">{buildPreviewTimeRange(shoot)}</span>
                  </div>
                </article>
              ))}
              {!bigShoots.length ? <div className="empty-state">Today looks dialed in.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function groupShootsForTv(shoots: HomeTodayShootPreview[]) {
  const groups = new Map<string, HomeTodayShootPreview[]>();
  for (const shoot of [...shoots].sort(compareTodayShoots)) {
    const label = buildTvTimeBucket(shoot);
    const list = groups.get(label);
    if (list) {
      list.push(shoot);
    } else {
      groups.set(label, [shoot]);
    }
  }
  return [...groups.entries()].map(([label, groupShoots]) => ({ label, shoots: groupShoots }));
}

function buildTodayPriorityItems(dashboard: HomeDashboardResponse): TodayPriorityItem[] {
  const items: TodayPriorityItem[] = [];
  const pushItem = (item: TodayPriorityItem) => {
    if (!items.some((entry) => entry.id === item.id)) {
      items.push(item);
    }
  };

  const sameDayAttention = [...dashboard.widgets.today_shoots.shoots]
    .filter((shoot) => shoot.phase === "needs_attention" || shoot.phase === "in_progress" || shoot.phase === "upcoming")
    .sort(compareTodayShoots)
    .slice(0, 2);

  for (const shoot of sameDayAttention) {
    pushItem({
      id: `shoot-${shoot.id}`,
      kind: "shoot",
      label: shoot.title,
      detail:
        shoot.phase === "in_progress"
          ? "Currently in progress and worth a quick leadership check."
          : shoot.attention_label ?? shoot.next_action,
      tone: shoot.attention_tone ?? shoot.status_tone,
      supporting: buildPreviewTimeRange(shoot),
      detailState: { kind: "shoot", shootId: shoot.id }
    });
  }

  for (const item of dashboard.widgets.weather_travel_watch.items.slice(0, 1)) {
    if (items.some((entry) => entry.id === `shoot-${item.shoot_id}`)) {
      continue;
    }
    pushItem({
      id: `weather-${item.shoot_id}-${item.kind}`,
      kind: "weather",
      label: item.title,
      detail: item.summary,
      tone: item.severity,
      supporting: `${item.location_name} | ${item.time_label}`,
      detailState: item.shoot_id ? { kind: "shoot", shootId: item.shoot_id } : { kind: "weather" }
    });
  }

  const customerService = dashboard.widgets.customer_service_pulse;
  if (customerService.urgent_signal_count > 0 || customerService.tone === "heads_up" || customerService.tone === "action_needed") {
    pushItem({
      id: "today-customer-service",
      kind: "customer_service",
      label: "Customer Service",
      detail: customerService.summary_line,
      tone: customerService.tone,
      supporting: `${customerService.urgent_signal_count} urgent | ${customerService.backlog_count} backlog`,
      detailState: { kind: "customer_service" }
    });
  }

  const locationItem = [...dashboard.widgets.places_that_need_more_love.items].sort((left, right) => {
    if (left.affecting_today !== right.affecting_today) {
      return Number(right.affecting_today) - Number(left.affecting_today);
    }
    return toneWeight(right.tone) - toneWeight(left.tone);
  })[0];

  if (locationItem && (locationItem.affecting_today || locationItem.tone === "heads_up" || locationItem.tone === "action_needed")) {
    pushItem({
      id: `today-location-${locationItem.location_id}`,
      kind: "location",
      label: locationItem.name,
      detail: locationItem.summary,
      tone: locationItem.tone,
      supporting: buildLocationImpactLabel(locationItem),
      detailState: { kind: "location", locationId: locationItem.location_id }
    });
  }

  const labor = dashboard.widgets.labor_snapshot_today;
  if (labor?.visible && (labor.overtime_risk_count > 0 || labor.tone === "heads_up" || labor.tone === "action_needed")) {
    pushItem({
      id: "today-labor",
      kind: "labor",
      label: "Today's Labor",
      detail: labor.summary_line,
      tone: labor.tone === "neutral" && labor.overtime_risk_count > 0 ? "heads_up" : labor.tone,
      supporting: `${labor.overtime_risk_count} OT risk`,
      detailState: { kind: "labor" }
    });
  }

  return items.slice(0, 5);
}

function buildHeadsUpItems(dashboard: HomeDashboardResponse): HeadsUpItem[] {
  const items: HeadsUpItem[] = [];
  const pushItem = (item: HeadsUpItem) => {
    if (!items.some((entry) => entry.id === item.id)) {
      items.push(item);
    }
  };

  const highestRiskShoot = [...dashboard.widgets.today_shoots.shoots]
    .filter(
      (shoot) =>
        shoot.phase === "needs_attention" ||
        shoot.attention_tone === "action_needed" ||
        shoot.status_tone === "action_needed" ||
        shoot.sync_tone === "action_needed"
    )
    .sort(compareTodayShoots)[0];

  if (highestRiskShoot) {
    pushItem({
      id: `shoot-${highestRiskShoot.id}`,
      label: highestRiskShoot.title,
      detail: highestRiskShoot.attention_label ?? highestRiskShoot.next_action,
      supporting: buildPreviewTimeRange(highestRiskShoot),
      tone: highestRiskShoot.attention_tone ?? highestRiskShoot.status_tone,
      kindLabel: "Shoot risk",
      detailState: { kind: "shoot", shootId: highestRiskShoot.id }
    });
  }

  const weatherSummary = dashboard.widgets.weather_travel_watch;
  if (weatherSummary.items.length) {
    pushItem({
      id: "weather-summary",
      label: "Weather & Travel",
      detail: weatherSummary.summary_line,
      supporting: weatherSummary.items[0] ? `${weatherSummary.items[0].location_name} | ${weatherSummary.items[0].time_label}` : undefined,
      tone: weatherSummary.tone,
      kindLabel: "Today risk",
      detailState: { kind: "weather" }
    });
  }

  const customerService = dashboard.widgets.customer_service_pulse;
  if (customerService.urgent_signal_count > 0 || customerService.tone !== "neutral") {
    pushItem({
      id: "customer-service",
      label: "Customer Service",
      detail: customerService.summary_line,
      supporting: `${customerService.urgent_signal_count} urgent | ${customerService.backlog_count} backlog`,
      tone: customerService.tone,
      kindLabel: "Support",
      detailState: { kind: "customer_service" }
    });
  }

  const locationItem = [...dashboard.widgets.places_that_need_more_love.items].sort((left, right) => {
    if (left.affecting_today !== right.affecting_today) {
      return Number(right.affecting_today) - Number(left.affecting_today);
    }
    return toneWeight(right.tone) - toneWeight(left.tone);
  })[0];

  if (locationItem) {
    pushItem({
      id: `location-${locationItem.location_id}`,
      label: locationItem.name,
      detail: locationItem.summary,
      supporting: buildLocationImpactLabel(locationItem),
      tone: locationItem.tone,
      kindLabel: "Location",
      detailState: { kind: "location", locationId: locationItem.location_id }
    });
  }

  const labor = dashboard.widgets.labor_snapshot_today;
  if (labor?.visible && (labor.overtime_risk_count > 0 || labor.tone === "heads_up" || labor.tone === "action_needed")) {
    pushItem({
      id: "labor-risk",
      label: "Today's Labor",
      detail: labor.summary_line,
      supporting: `${labor.overtime_risk_count} OT risk`,
      tone: labor.tone === "neutral" && labor.overtime_risk_count > 0 ? "heads_up" : labor.tone,
      kindLabel: "Labor",
      detailState: { kind: "labor" }
    });
  }

  return items.slice(0, 4);
}

function hasMeaningfulCustomerServiceRisk(data: HomeDashboardResponse["widgets"]["customer_service_pulse"] | undefined) {
  if (!data) {
    return false;
  }
  return data.urgent_signal_count > 0 || data.tone === "heads_up" || data.tone === "action_needed";
}

function buildHomeFollowUpItems(dashboard: HomeDashboardResponse, currentUser?: SessionUser | null): HomeFollowUpItem[] {
  const items: HomeFollowUpItem[] = [];
  const pushItem = (item: HomeFollowUpItem) => {
    if (!items.some((entry) => entry.id === item.id)) {
      items.push(item);
    }
  };

  if (dashboard.widgets.today_strip.approvals_waiting_count > 0) {
    pushItem({
      id: "approvals",
      label:
        dashboard.widgets.today_strip.approvals_waiting_count === 1
          ? "1 approval is waiting on you"
          : `${dashboard.widgets.today_strip.approvals_waiting_count} approvals are waiting on you`,
        detail: "Employees and security approvals are still open.",
        actionHash: "#approvals",
      tone: "heads_up"
    });
  }

  const attendanceSummary = dashboard.widgets.attendance_awareness.summary;
  const attendanceCount =
    (attendanceSummary.missing_clock_in_count ?? dashboard.widgets.attendance_awareness.not_clocked_in.count) +
    attendanceSummary.late_count +
    (attendanceSummary.critically_late_count ?? 0) +
    (attendanceSummary.probable_no_show_count ?? dashboard.widgets.attendance_awareness.missing.count) +
    attendanceSummary.wrong_location_count;
  if (attendanceCount > 0) {
    pushItem({
      id: "attendance",
      label: attendanceCount === 1 ? "1 attendance issue needs review" : `${attendanceCount} attendance issues need review`,
      detail: "Missing clock-ins, critical lateness, probable no-shows, or wrong-location punches still need intervention.",
      actionHash: "#operations/attendance",
      tone: "action_needed"
    });
  }

  const ownedProductionPressure = currentUser
    ? dashboard.widgets.production_projects.focus_items.filter((item) => item.owner_label === currentUser.fullName)
    : [];
  if (ownedProductionPressure.length > 0) {
    pushItem({
      id: "owned-production",
      label:
        ownedProductionPressure.length === 1
          ? "1 job you own is at risk"
          : `${ownedProductionPressure.length} jobs you own are at risk`,
      detail: ownedProductionPressure[0]?.next_action ?? "Owned production work still needs follow-through.",
      actionHash: ownedProductionPressure[0]?.action_hash ?? "#production/workload",
      tone: ownedProductionPressure.some((item) => item.tone === "action_needed") ? "action_needed" : "heads_up"
    });
  }

  if (dashboard.widgets.today_strip.production_at_risk_count > 0) {
    pushItem({
      id: "production",
      label:
        dashboard.widgets.today_strip.production_at_risk_count === 1
          ? "1 production item is at risk"
          : `${dashboard.widgets.today_strip.production_at_risk_count} production items are at risk`,
      detail: "Blocked, overdue, or unassigned work could miss the expected deadline.",
      actionHash: "#production/workload",
      tone: "action_needed"
    });
  }

  if (hasMeaningfulCustomerServiceRisk(dashboard.widgets.customer_service_pulse)) {
    pushItem({
      id: "customer-service",
      label: "Customer service needs follow-through",
      detail: dashboard.widgets.customer_service_pulse.summary_line,
      actionHash: "#reports/customer-service",
      tone: dashboard.widgets.customer_service_pulse.tone
    });
  }

  if (dashboard.widgets.business_pulse.jobs.length > 0) {
    pushItem({
      id: "weekly-jobs",
      label:
        dashboard.widgets.business_pulse.jobs.length === 1
          ? "1 week-level job needs follow-through"
          : `${dashboard.widgets.business_pulse.jobs.length} week-level jobs need follow-through`,
      detail: dashboard.widgets.business_pulse.jobs[0]?.detail ?? "This week's schedule still has follow-through pressure.",
      actionHash: "#operations/shoots",
      tone: dashboard.widgets.business_pulse.jobs.some((job) => job.tone === "action_needed") ? "action_needed" : "heads_up"
    });
  }

  return items.slice(0, 4);
}

function buildHomeRecentActivityItems(dashboard: HomeDashboardResponse): HomeRecentActivityItem[] {
  const activity: HomeRecentActivityItem[] = [];
  const probableNoShowItems = dashboard.widgets.attendance_awareness.probable_no_show?.items ?? [];
  const missingClockInItems = dashboard.widgets.attendance_awareness.missing_clock_in?.items ?? [];
  const criticallyLateItems = dashboard.widgets.attendance_awareness.critically_late?.items ?? [];
  const attendanceBuckets = [
    { label: "Probable no-show escalated", items: probableNoShowItems, hash: "#operations/attendance" },
    {
      label: "Missing clock-in escalated",
      items: missingClockInItems,
      hash: "#operations/attendance"
    },
    {
      label: "Critically late arrival flagged",
      items: criticallyLateItems,
      hash: "#operations/attendance"
    },
    { label: "Late arrival flagged", items: dashboard.widgets.attendance_awareness.late.items, hash: "#operations/attendance" },
    { label: "Wrong location warning", items: dashboard.widgets.attendance_awareness.wrong_location.items, hash: "#operations/attendance" },
    { label: "Clock-in still missing", items: dashboard.widgets.attendance_awareness.not_clocked_in.items, hash: "#operations/attendance" }
  ] as const;

  for (const bucket of attendanceBuckets) {
    for (const item of bucket.items.slice(0, 1)) {
      activity.push({
        id: `${bucket.label}-${item.id}`,
        title: bucket.label,
        detail: `${item.employee_name}${item.secondary_label ? ` | ${item.secondary_label}` : ""}`,
        meta: item.captured_at ? formatRelativeTime(item.captured_at) : "This refresh",
        actionHash: bucket.hash
      });
    }
  }

  for (const item of dashboard.widgets.production_projects.focus_items.slice(0, 2)) {
    activity.push({
      id: `production-${item.project_id}`,
      title: item.title,
      detail: `${item.stage_label} | ${item.next_action}`,
      meta: item.due_label ?? "Production watch",
      actionHash: item.action_hash
    });
  }

  if (!activity.length && dashboard.widgets.today_shoots.shoots[0]) {
    const shoot = dashboard.widgets.today_shoots.shoots[0];
    activity.push({
      id: `shoot-${shoot.id}`,
      title: shoot.title,
      detail: shoot.next_action,
      meta: buildPreviewTimeRange(shoot),
      actionHash: `#operations/shoots?shoot=${shoot.id}`
    });
  }

  return activity.slice(0, 4);
}

function hasAnyDashboardAttentionAccess(user: SessionUser) {
  return (
    hasCapability(user, "operations.view") ||
    hasCapability(user, "schedule.view") ||
    hasCapability(user, "attendance.view") ||
    canAccessGraphicsWorkspace(user) ||
    canViewLeadershipReports(user)
  );
}

function resolveUrgentWatchDetailState(item: UrgentWatchCardItem): DetailState | null {
  if ((item.kind === "shoot" || item.kind === "weather" || item.kind === "travel") && item.shoot_id) {
    return { kind: "shoot", shootId: item.shoot_id };
  }
  if (item.kind === "customer_service") {
    return { kind: "customer_service" };
  }
  if (item.kind === "location" && item.location_id) {
    return { kind: "location", locationId: item.location_id };
  }
  if (item.kind === "labor") {
    return { kind: "labor" };
  }
  return null;
}

function buildHeadsUpSummary(items: HeadsUpItem[]) {
  if (!items.length) {
    return "No same-day escalations are raised right now.";
  }
  return `${items.length} same-day signal${items.length === 1 ? "" : "s"} deserve leadership awareness in the next 24 hours.`;
}

function getHeadsUpSectionTone(
  dashboard: HomeDashboardResponse,
  items: HeadsUpItem[]
): HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"] {
  return (
    dashboard.critical_banner?.tone ??
    (items.some((item) => item.tone === "action_needed")
      ? "action_needed"
      : items.some((item) => item.tone === "heads_up")
        ? "heads_up"
        : "good")
  );
}

function isHeadsUpUrgentTone(tone: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"]) {
  return tone === "action_needed" || tone === "heads_up";
}

function buildTodayPriorityKindLabel(kind: TodayPriorityItem["kind"]) {
  if (kind === "shoot") {
    return "Shoot";
  }
  if (kind === "weather") {
    return "Weather";
  }
  if (kind === "customer_service") {
    return "Support";
  }
  if (kind === "location") {
    return "Location";
  }
  return "Labor";
}

function buildLocationImpactLabel(item: HomeDashboardResponse["widgets"]["places_that_need_more_love"]["items"][number]) {
  if (item.affecting_today) {
    return "Affects today";
  }
  if (item.tone === "action_needed" || item.tone === "heads_up") {
    return "Affects this week";
  }
  return "Monitor only";
}

function toneWeight(value: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"]) {
  if (value === "action_needed") {
    return 4;
  }
  if (value === "heads_up") {
    return 3;
  }
  if (value === "info") {
    return 2;
  }
  if (value === "good") {
    return 1;
  }
  return 0;
}

function buildTvTimeBucket(shoot: HomeTodayShootPreview) {
  const base = shoot.start_time ?? shoot.arrival_time ?? shoot.end_time_est;
  if (!base) {
    return "Timing Pending";
  }
  return new Date(base).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function compareTodayShoots(left: HomeTodayShootPreview, right: HomeTodayShootPreview) {
  const leftTime = new Date(left.start_time ?? left.arrival_time ?? left.end_time_est ?? `${left.shoot_date ?? getLocalDateString()}T23:59:00`).getTime();
  const rightTime = new Date(right.start_time ?? right.arrival_time ?? right.end_time_est ?? `${right.shoot_date ?? getLocalDateString()}T23:59:00`).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.title.localeCompare(right.title);
}

function buildPreviewTimeRange(shoot: HomeTodayShootPreview) {
  const start = shoot.start_time ?? shoot.arrival_time;
  const end = shoot.end_time_est ?? shoot.start_time;
  if (!start && !end) {
    return "Time pending";
  }
  if (!start) {
    return `Until ${formatTime(end)}`;
  }
  if (!end) {
    return `From ${formatTime(start)}`;
  }
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "TBD";
  }
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatShortDate(value?: string | null) {
  if (!value) {
    return "Pending";
  }
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "This refresh";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "This refresh";
  }

  const deltaMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (deltaMinutes < 1) {
    return "Just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function shortenAddress(value?: string | null) {
  if (!value) {
    return "Location pending";
  }
  return value.split(",").slice(0, 2).join(", ");
}

function toneCopy(value: HomeDashboardResponse["widgets"]["weather_travel_watch"]["tone"]) {
  if (value === "good") {
    return "Good";
  }
  if (value === "heads_up") {
    return "Heads Up";
  }
  if (value === "action_needed") {
    return "Action Needed";
  }
  if (value === "info") {
    return "Info";
  }
  return "Neutral";
}

function priorityTone(value: HomeTodayShootPreview["priority_label"]) {
  if (value === "critical_shoot") {
    return "action_needed";
  }
  if (value === "big_shoot") {
    return "info";
  }
  if (value === "high_priority") {
    return "heads_up";
  }
  if (value === "elevated") {
    return "neutral";
  }
  return "neutral";
}

function getLocationReadinessLabel(detail: ShootLocationDetail) {
  if (detail.photo_gallery.length >= 3 && detail.evaluations.length >= 2) {
    return "Ready";
  }
  if (detail.photo_gallery.length || detail.evaluations.length) {
    return "Needs a quick review";
  }
  return "Fresh eyes help here";
}

function getLocationConfidenceLabel(detail: ShootLocationDetail) {
  if (detail.stats.avg_rating != null && detail.stats.avg_rating >= 4.4) {
    return "Easy";
  }
  if (detail.stats.avg_rating != null && detail.stats.avg_rating >= 3.8) {
    return "Normal";
  }
  return "Hard";
}

function buildLocationHighlights(detail: ShootLocationDetail) {
  const highlights = [
    detail.latest_recommendation,
    detail.commentary,
    detail.location_details,
    ...detail.evaluations.slice(0, 3).flatMap((evaluation) => [evaluation.recommendations, evaluation.notes, evaluation.access_details, evaluation.late_details])
  ].filter((value): value is string => Boolean(value));
  return [...new Set(highlights)].slice(0, 5);
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
