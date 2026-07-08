import type { PoolClient } from "pg";
import { config } from "../config.js";
import { canViewCustomerServiceMetrics, canViewLaborCost, canViewManagerCockpit, canViewSchoolsHub, hasAuthorityTier } from "../authz/authority.js";
import type { AuthUser } from "../types/auth.js";
import type { HomeDashboardDefaultsConfig } from "../types/adminConfiguration.js";
import { listShootLocations } from "./locations.js";
import { listShoots, type ShootListWindow } from "./shoots.js";
import { getZendeskLeadershipSummary } from "./zendesk.js";
import { getOperationsDashboard } from "./dashboard.js";
import { humanizePriorityLabel, importanceRank, isBigShootLabel } from "./shootPriority.js";
import {
  getHomeAttendanceAwarenessWidget,
  type HomeAttendanceAwarenessEntry as AttendanceAwarenessEntry,
  type HomeAttendanceAwarenessWidget
} from "./timeClockPresence.js";
import { getHomeDashboardDefaults } from "./adminConfiguration.js";
import { getConfiguredOperatingSystemAccessProfile } from "./operatingSystemAccess.js";
import { getProductionProjectHomeSnapshot } from "./productionProjects.js";
import { listSecurityApprovalRequests } from "./securityApprovals.js";
import { humanizeShootStatus, isShootFinishedOnSite, isShootTerminalStatus, normalizeShootStatusValue } from "./shootLifecycle.js";
import { getUrgentWatchHomeSummary } from "./urgentWatch.js";
import { loadManagerCockpit } from "../application/dashboard/load-manager-cockpit.action.js";
import { buildLiveShootQueueFromSources } from "../application/shoots/load-live-shoot-queue.action.js";
import { listEmployeeMyWork } from "./employeeExperience.js";
import { listOperationalApprovalWorkspace } from "./operationalApprovals.js";
import { getTimeClockShellControlState, type TimeClockShellControlState } from "./timeClockRuntime.js";
import { getSchoolsRiskSnapshot } from "./schoolsHub.js";
import type { OperatingSystemAccessProfile } from "../types/operatingSystem.js";
import type { ManagerCockpitQueueItem, ManagerCockpitResponse } from "../types/managerCockpit.js";
import type { OperationalApprovalRequestSummary, OperationalApprovalWorkspace } from "../types/operationalApprovals.js";
import { listOpenTaskCountsByDepartment, type WorkTaskDepartmentOpenCounts } from "./jobTruth/workTaskService.js";

export type HomeDashboardMode = "app" | "tv";
type SeverityTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";
type UrgentWatchState = "action_needed_today" | "due_within_24h" | "overdue" | "at_risk";
type UrgentWatchItem = {
  id: string;
  kind: "shoot" | "weather" | "travel" | "customer_service" | "location" | "labor" | "project" | "attendance" | "scheduling" | "approval";
  kind_label: string;
  title: string;
  summary: string;
  supporting_label: string | null;
  tone: SeverityTone;
  urgency_state: UrgentWatchState;
  urgency_label: string;
  action_label: string;
  action_hash: string;
  shoot_id: string | null;
  location_id: string | null;
  project_id: string | null;
};

type ShootRow = Awaited<ReturnType<typeof listShoots>>[number];

type BusinessPulseTile = {
  id: "shoots_this_week" | "subjects_this_week" | "id_cards_to_print" | "jobs_needing_attention" | "labor_today";
  label: string;
  value: number;
  context_label: string;
  tone: SeverityTone;
  trend_label: string | null;
  source_mode: "live" | "derived_adapter";
};

type WeekScheduleItem = {
  date: string;
  label: string;
  short_label: string;
  shoot_count: number;
  big_shoot_count: number;
  attention_count: number;
  is_today: boolean;
};

type TodayShootPreview = {
  id: string;
  shoot_code: string;
  title: string;
  department: string | null;
  shoot_date: string | null;
  location_name: string;
  location_address: string | null;
  navigation_url: string | null;
  estimated_drive_minutes: number | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  projected_students: number | null;
  status: string | null;
  scheduled_employee_count: number | null;
  big_shoot: boolean;
  lead_name: string | null;
  lead_confirmed_ready: boolean;
  lead_confirmed_ready_at: string | null;
  lead_confirmed_ready_by_name: string | null;
  lead_confirmed_ready_exception_flag: boolean;
  ready_to_shoot_status: string | null;
  ready_to_shoot_label: string | null;
  ready_to_shoot_tone: SeverityTone | null;
  staffing_readiness_label: string | null;
  staffing_readiness_tone: SeverityTone | null;
  priority_label: "standard" | "elevated" | "big_shoot" | "critical_shoot";
  priority_display: string;
  priority_reasons: Array<{ label: string; detail: string }>;
  scale_label: string;
  phase: "upcoming" | "in_progress" | "complete" | "needs_attention";
  status_label: string;
  status_tone: SeverityTone;
  attention_label: string | null;
  attention_tone: SeverityTone | null;
  sync_label: string;
  sync_tone: SeverityTone;
  next_action: string;
};

type WeatherTravelItem = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  location_name: string;
  time_label: string;
  kind: "weather" | "travel";
  severity: SeverityTone;
  summary: string;
};

type CustomerServiceCategory = {
  label: string;
  count: number;
};

type LocationNeedsLoveItem = {
  location_id: string;
  name: string;
  category: string;
  tone: SeverityTone;
  theme_label: string;
  summary: string;
  affecting_today: boolean;
  recent_improvement: string | null;
};

type LaborRollup = {
  label: string;
  scheduled_hours: number;
  actual_hours: number;
};

type JobNeedingAttention = {
  id: string;
  label: string;
  detail: string;
  tone: SeverityTone;
};

type HomeSurfaceStripItem = {
  id: string;
  label: string;
  value: number;
  detail: string;
  tone: SeverityTone;
  action_hash: string;
};

type HomeSurfaceFocusItem = {
  id: string;
  source_label: string;
  title: string;
  summary: string;
  owner_label: string;
  due_label: string | null;
  status_label: string;
  tone: SeverityTone;
  next_action: string;
  action_hash: string;
};

type HomeSurfaceCompactWidget = {
  id: "attendance_awareness" | "production_snapshot" | "approvals_summary" | "staffing_health" | "my_follow_ups" | "schools_risk";
  title: string;
  count: number;
  summary: string;
  tone: SeverityTone;
  action_hash: string;
};

type HomeSurfaceMyDayItem = {
  id: string;
  title: string;
  summary: string;
  location_label: string;
  time_label: string;
  role_label: string;
  status_label: string;
  tone: SeverityTone;
  next_action: string;
  action_hash: string;
};

type HomeSurfaceUpdateItem = {
  id: string;
  title: string;
  summary: string;
  created_at_label: string;
  action_hash: string | null;
};

type HomeSurfaceVisibilityMatrix = {
  staffing_tracker: boolean;
  time_band: boolean;
  today_strip: boolean;
  urgent_watch: boolean;
  today_and_next_up: boolean;
  my_day: boolean;
  attendance_awareness: boolean;
  production_snapshot: boolean;
  approvals_summary: boolean;
  staffing_health: boolean;
  my_follow_ups: boolean;
  schools_risk: boolean;
};

type HomeSurfaceStaffingBandMetric = {
  id: "clocked_in" | "in_office" | "in_field" | "assigned_but_missing";
  label: string;
  count: number;
  detail: string;
  tone: SeverityTone;
  action_hash: string;
};

type HomeSurfaceStaffingBand = {
  visible: boolean;
  headline: string;
  summary_line: string;
  action_hash: string;
  metrics: HomeSurfaceStaffingBandMetric[];
};

type HomeSurfaceTimeBand = {
  visible: boolean;
  headline: string;
  state: TimeClockShellControlState["state"];
  emphasis: TimeClockShellControlState["emphasis"];
  label: string;
  summary_line: string;
  elapsed_label: string | null;
  shift_label: string | null;
  location_label: string | null;
  action_label: string;
  action_hash: string;
  schedule_hash: string | null;
};

type HomeSurface = {
  role_template: OperatingSystemAccessProfile["role_template"];
  layout: "manager" | "employee";
  visibility_matrix: HomeSurfaceVisibilityMatrix;
  module_access: OperatingSystemAccessProfile["module_access"];
  staffing_band: HomeSurfaceStaffingBand | null;
  time_band: HomeSurfaceTimeBand | null;
  today_strip: {
    headline: string;
    items: HomeSurfaceStripItem[];
  };
  urgent_attention: {
    visible: boolean;
    headline: string;
    summary_line: string;
    items: UrgentWatchItem[];
  };
  today_and_next_up: {
    visible: boolean;
    headline: string;
    summary_line: string;
    today: HomeSurfaceFocusItem[];
    next_up: HomeSurfaceFocusItem[];
  } | null;
  my_day: {
    visible: boolean;
    headline: string;
    summary_line: string;
    next_shift_label: string | null;
    items: HomeSurfaceMyDayItem[];
    updates: HomeSurfaceUpdateItem[];
  } | null;
  compact_widgets: HomeSurfaceCompactWidget[];
};

export type HomeDashboardResponse = {
  generated_at: string;
  anchor_date: string;
  mode: HomeDashboardMode;
  refresh_interval_seconds: number;
  tv_rotation_seconds: number;
  public_safe: boolean;
  tv_names_enabled: boolean;
  critical_banner: {
    tone: SeverityTone;
    label: string;
    message: string;
  } | null;
  home_surface: HomeSurface;
  widgets: {
    today_strip: {
      shoot_count: number;
      urgent_issue_count: number;
      approvals_waiting_count: number;
      late_arrival_count: number;
      production_at_risk_count: number;
    };
    business_pulse: {
      tiles: BusinessPulseTile[];
      week_start: string;
      week_end: string;
      week_schedule: WeekScheduleItem[];
      weekly_department_mix: Array<{ department: string; shoots: number; subjects: number }>;
      jobs: JobNeedingAttention[];
    };
    today_shoots: {
      total: number;
      upcoming_count: number;
      in_progress_count: number;
      complete_count: number;
      needs_attention_count: number;
      big_shoot_count: number;
      shoots: TodayShootPreview[];
    };
    weather_travel_watch: {
      tone: SeverityTone;
      summary_line: string;
      items: WeatherTravelItem[];
    };
    customer_service_pulse: {
      safe_summary: true;
      tone: SeverityTone;
      summary_line: string;
      open_tickets: number;
      urgent_signal_count: number;
      backlog_count: number;
      trend_label: string;
      top_categories: CustomerServiceCategory[];
      connected: boolean;
      drilldown_enabled: boolean;
    };
    places_that_need_more_love: {
      summary_line: string;
      items: LocationNeedsLoveItem[];
    };
    labor_snapshot_today: {
      visible: boolean;
      public_safe: true;
      tone: SeverityTone;
      summary_line: string;
      scheduled_hours: number;
      actual_hours: number;
      overtime_risk_count: number;
      department_rollup: LaborRollup[];
      shoot_rollup: LaborRollup[];
    } | null;
    attendance_awareness: HomeAttendanceAwarenessWidget;
    urgent_watch: {
      visible: boolean;
      tone: SeverityTone;
      summary_line: string;
      items: UrgentWatchItem[];
    };
    department_task_counts: WorkTaskDepartmentOpenCounts;
    production_projects: {
      visible: boolean;
      generated_at: string;
      summary_line: string;
      tone: SeverityTone;
      counts: {
        unassigned_jobs: number;
        active_jobs: number;
        on_time: number;
        overdue: number;
        blocked: number;
        due_within_24_hours: number;
        jobs_in_qa: number;
        ready_to_release: number;
        peer_review_lag: number;
        final_qc_lag: number;
        release_blockers: number;
        stale_active: number;
        attention_needed: number;
      };
      assessment_cards: Array<{
        id:
          | "unassigned_jobs"
          | "overdue"
          | "blocked"
          | "due_within_24_hours"
          | "jobs_in_qa"
          | "ready_to_release"
          | "peer_review_lag"
          | "final_qc_lag"
          | "release_blockers"
          | "stale_active";
        label: string;
        value: number;
        tone: SeverityTone;
        detail: string;
        action_hash: string;
      }>;
      owners: Array<{
        owner_user_id: string | null;
        owner_label: string;
        assignment_label: string;
        open_count: number;
        in_production_count: number;
        qa_queue_count: number;
        ready_to_release_count: number;
        overdue_count: number;
        pressure_label: string;
        action_hash: string;
      }>;
      focus_items: Array<{
        project_id: string;
        title: string;
        summary: string;
        owner_label: string;
        stage_label: string;
        queue_label: string;
        reviewer_label: string | null;
        due_label: string | null;
        next_action: string;
        tone: SeverityTone;
        action_hash: string;
      }>;
      urgent_items: Array<{
        project_id: string;
        title: string;
        summary: string;
        owner_label: string;
        stage_label: string;
        due_label: string | null;
        urgency_state: "overdue" | "due_within_24h" | "action_needed_today";
        urgency_label: string;
        action_hash: string;
      }>;
    };
  };
};

type EmployeeMyWork = Awaited<ReturnType<typeof listEmployeeMyWork>>;
type ProductionProjectHomeSnapshot = Awaited<ReturnType<typeof getProductionProjectHomeSnapshot>>;
type HomeDashboardWidgets = HomeDashboardResponse["widgets"];
const EMPTY_HOME_TASK_COUNTS: WorkTaskDepartmentOpenCounts = {
  schools: null,
  sports: null,
  production: null
};

function buildHiddenAttendanceAwarenessWidget(): HomeAttendanceAwarenessWidget {
  return {
    visible: false,
    summary: {
      clocked_in_count: 0,
      grace_window_count: 0,
      not_clocked_in_count: 0,
      late_count: 0,
      critically_late_count: 0,
      missing_clock_in_count: 0,
      probable_no_show_count: 0,
      missing_count: 0,
      wrong_location_count: 0,
      staffing_risk_count: 0
    },
    clocked_in: { count: 0, items: [] },
    grace_window: { count: 0, items: [] },
    not_clocked_in: { count: 0, items: [] },
    late: { count: 0, items: [] },
    critically_late: { count: 0, items: [] },
    missing_clock_in: { count: 0, items: [] },
    probable_no_show: { count: 0, items: [] },
    missing: { count: 0, items: [] },
    wrong_location: { count: 0, items: [] },
    in_office: { count: 0, items: [] },
    in_field: { count: 0, items: [] },
    assigned_but_missing: { count: 0, items: [] }
  };
}

function buildHiddenProductionProjectSnapshot(anchorDate: string): ProductionProjectHomeSnapshot {
  return {
    generated_at: new Date().toISOString(),
    anchor_date: anchorDate,
    summary_line: "Production snapshot is not visible for this role.",
    tone: "neutral",
    counts: {
      unassigned_jobs: 0,
      active_jobs: 0,
      on_time: 0,
      overdue: 0,
      blocked: 0,
      due_within_24_hours: 0,
      jobs_in_qa: 0,
      ready_to_release: 0,
      peer_review_lag: 0,
      final_qc_lag: 0,
      release_blockers: 0,
      stale_active: 0,
      attention_needed: 0
    },
    assessment_cards: [],
    owners: [],
    focus_items: [],
    urgent_items: []
  };
}

function buildRoleSafeHomeWidgets(input: {
  layout: "manager" | "employee";
  anchorDate: string;
  employeeMyWork: EmployeeMyWork | null;
  widgets: HomeDashboardWidgets;
}): HomeDashboardWidgets {
  if (input.layout !== "employee") {
    return input.widgets;
  }

  return buildEmployeeRoleSafeWidgets(input.anchorDate, input.employeeMyWork);
}

function buildEmployeeRoleSafeWidgets(anchorDate: string, employeeMyWork: EmployeeMyWork | null): HomeDashboardWidgets {
  const summary = employeeMyWork?.summary;
  return {
    today_strip: {
      shoot_count: Number(summary?.shifts_today ?? 0),
      urgent_issue_count: Number(summary?.attention_needed_count ?? 0),
      approvals_waiting_count: 0,
      late_arrival_count: 0,
      production_at_risk_count: Number(summary?.closeout_due_count ?? 0)
    },
    business_pulse: {
      tiles: [],
      week_start: anchorDate,
      week_end: anchorDate,
      week_schedule: [],
      weekly_department_mix: [],
      jobs: []
    },
    today_shoots: {
      total: 0,
      upcoming_count: 0,
      in_progress_count: 0,
      complete_count: 0,
      needs_attention_count: 0,
      big_shoot_count: 0,
      shoots: []
    },
    weather_travel_watch: {
      tone: "neutral",
      summary_line: "Weather and travel watch is not visible for this role.",
      items: []
    },
    customer_service_pulse: {
      safe_summary: true,
      tone: "neutral",
      summary_line: "Customer service is not visible for this role.",
      open_tickets: 0,
      urgent_signal_count: 0,
      backlog_count: 0,
      trend_label: "Not visible for this role",
      top_categories: [],
      connected: false,
      drilldown_enabled: false
    },
    places_that_need_more_love: {
      summary_line: "Location exceptions are not visible for this role.",
      items: []
    },
    labor_snapshot_today: null,
    attendance_awareness: buildHiddenAttendanceAwarenessWidget(),
    urgent_watch: {
      visible: false,
      tone: "neutral",
      summary_line: "Exceptions are not visible for this role.",
      items: []
    },
    department_task_counts: EMPTY_HOME_TASK_COUNTS,
    production_projects: {
      visible: false,
      generated_at: new Date().toISOString(),
      summary_line: "Production snapshot is not visible for this role.",
      tone: "neutral",
      counts: {
        unassigned_jobs: 0,
        active_jobs: 0,
        on_time: 0,
        overdue: 0,
        blocked: 0,
        due_within_24_hours: 0,
        jobs_in_qa: 0,
        ready_to_release: 0,
        peer_review_lag: 0,
        final_qc_lag: 0,
        release_blockers: 0,
        stale_active: 0,
        attention_needed: 0
      },
      assessment_cards: [],
      owners: [],
      focus_items: [],
      urgent_items: []
    }
  };
}

export async function getHomeDashboard(
  client: PoolClient,
  auth: AuthUser,
  options: { date: string; mode: HomeDashboardMode }
): Promise<HomeDashboardResponse> {
  const accessProfile = await getConfiguredOperatingSystemAccessProfile(client, auth);
  const homeDashboardDefaults = await getHomeDashboardDefaults(client, auth);
  const homeLayout = accessProfile.role_template === "standard_employee" ? "employee" : "manager";
  const hiddenSections = new Set(homeDashboardDefaults.hidden_sections);
  const todayWindow: ShootListWindow = { date: options.date };
  const weekWindow = getWeekWindow(options.date);
  const canSeeSecurityApprovalCounts = options.mode !== "tv" && hasAuthorityTier(auth, ["supervisor", "leadership", "super_admin"]);
  const canSeeUrgentWatch =
    options.mode !== "tv" && homeLayout === "manager" && accessProfile.module_access.urgent_watch.can_view && !hiddenSections.has("urgent_watch");
  const shouldLoadAttendanceAwareness =
    options.mode !== "tv" &&
    homeLayout === "manager" &&
    accessProfile.module_access.operations.can_view &&
    (!hiddenSections.has("staffing_tracker") || !hiddenSections.has("attendance_awareness"));
  const shouldLoadProductionProjects =
    options.mode !== "tv" &&
    homeLayout === "manager" &&
    accessProfile.module_access.production.can_view &&
    !hiddenSections.has("production_snapshot");
  // The cockpit carries company-wide payroll/compliance queues — manager layout
  // alone (e.g. office/CSR shells) must not load it (MC-AUDIT-002).
  const shouldLoadManagerCockpit = options.mode !== "tv" && homeLayout === "manager" && canViewManagerCockpit(auth);
  const shouldLoadEmployeeMyWork = options.mode !== "tv" && homeLayout === "employee";
  const shouldLoadEmployeeTimeClockState =
    options.mode !== "tv" && homeLayout === "employee" && auth.permissions.includes("time.clock") && !hiddenSections.has("time_band");

  if (homeLayout === "employee") {
    const employeeMyWork = shouldLoadEmployeeMyWork ? await listEmployeeMyWork(client, auth, options.date).catch(() => null) : null;
    const employeeTimeClockState =
      shouldLoadEmployeeTimeClockState ? await getTimeClockShellControlState(client, auth).catch(() => null) : null;
    const attendanceAwareness = buildHiddenAttendanceAwarenessWidget();
    const productionProjects = buildHiddenProductionProjectSnapshot(options.date);
    const urgentWatch = {
      visible: false,
      tone: "neutral" as const,
      summary_line: options.mode === "tv" ? "Exceptions are hidden in TV mode." : "Exceptions are not visible for this role.",
      items: []
    };
    const widgets = buildEmployeeRoleSafeWidgets(options.date, employeeMyWork);
    const summary = employeeMyWork?.summary;
    const homeSurface = buildHomeSurface({
      accessProfile,
      homeDashboardDefaults,
      layout: homeLayout,
      productionVisible: false,
      todayStrip: {
        shoot_count: Number(summary?.shifts_today ?? 0),
        urgent_issue_count: Number(summary?.attention_needed_count ?? 0),
        approvals_waiting_count: 0,
        late_arrival_count: 0,
        production_at_risk_count: Number(summary?.closeout_due_count ?? 0)
      },
      urgentWatch,
      todayPreviews: [],
      attendanceAwareness,
      productionProjects,
      productionIntakeIssueCount: 0,
      managerCockpit: null,
      employeeMyWork,
      employeeTimeClockState,
      operationalApprovals: null,
      schoolsRiskSnapshot: null
    });

    return {
      generated_at: new Date().toISOString(),
      anchor_date: options.date,
      mode: options.mode,
      refresh_interval_seconds: 60,
      tv_rotation_seconds: 15,
      public_safe: options.mode === "tv",
      tv_names_enabled: options.mode === "tv" ? config.TV_MODE_SHOW_EMPLOYEE_NAMES : true,
      critical_banner: null,
      home_surface: homeSurface,
      widgets
    };
  }

  const shouldLoadOperationalApprovals =
    options.mode !== "tv" &&
    homeLayout === "manager" &&
    accessProfile.module_access.approvals.can_view &&
    !hiddenSections.has("approvals_summary");
  const shouldLoadSchoolsRisk =
    options.mode !== "tv" && homeLayout === "manager" && canViewSchoolsHub(auth) && !hiddenSections.has("schools_risk");
  const todayRows = await listShoots(client, todayWindow, auth);
  const weekRows = await listShoots(client, weekWindow, auth);
  const typicalWeek = await getTypicalWeek(client, auth.tenantId, weekWindow.dateFrom as string);
  const customerServiceSummary = await getSafeCustomerServiceSummary(client, auth);
  const locationCatalog = await listShootLocations(client, auth, { sort: "alpha" }).catch(() => ({
    locations: [],
    cache: { fetchedAt: new Date().toISOString(), stale: true, source: "stale_cache" as const }
  }));
  const laborSnapshot =
    canViewLaborCost(auth) && config.HOME_LABOR_WIDGET_ENABLED && options.mode !== "tv"
      ? await getOperationsDashboard(client, auth, { date: options.date })
      : null;
  const attendanceAwareness = shouldLoadAttendanceAwareness
    ? await getHomeAttendanceAwarenessWidget(client, { tenantId: auth.tenantId, anchorDate: options.date })
    : buildHiddenAttendanceAwarenessWidget();
  const productionProjects = shouldLoadProductionProjects
    ? await getProductionProjectHomeSnapshot(client, auth, {
        anchorDate: options.date,
        tvSafe: options.mode === "tv"
      })
    : buildHiddenProductionProjectSnapshot(options.date);
  const pendingSecurityApprovalRequests = canSeeSecurityApprovalCounts
    ? await listSecurityApprovalRequests(client, auth, { status: "pending" }).catch(() => [])
    : [];
  const managerCockpit = shouldLoadManagerCockpit
    ? await loadManagerCockpit(client, auth, {
        date: options.date,
        liveQueue: buildLiveShootQueueFromSources(todayRows, todayWindow)
      }).catch(() => null)
    : null;
  const employeeMyWork = shouldLoadEmployeeMyWork ? await listEmployeeMyWork(client, auth, options.date).catch(() => null) : null;
  const employeeTimeClockState =
    shouldLoadEmployeeTimeClockState ? await getTimeClockShellControlState(client, auth).catch(() => null) : null;
  const operationalApprovals =
    shouldLoadOperationalApprovals ? await listOperationalApprovalWorkspace(client, auth).catch(() => null) : null;
  const schoolsRiskSnapshot = shouldLoadSchoolsRisk ? await getSchoolsRiskSnapshot(client, auth, options.date).catch(() => null) : null;
  const departmentTaskCounts =
    options.mode !== "tv" ? await listOpenTaskCountsByDepartment(client, auth).catch(() => EMPTY_HOME_TASK_COUNTS) : EMPTY_HOME_TASK_COUNTS;

  const weatherTravelItems = buildWeatherTravelItems(todayRows);
  const todayPreviews = todayRows.map((row) => buildTodayShootPreview(row, options.date, weatherTravelItems));
  const businessPulse = buildBusinessPulse(weekRows, typicalWeek, laborSnapshot, options.date);
  const customerPulse = buildCustomerServicePulse(customerServiceSummary, canViewCustomerServiceMetrics(auth) && options.mode !== "tv");
  const places = buildPlacesThatNeedMoreLove(locationCatalog.locations, todayRows);
  const labor = buildLaborSnapshot(laborSnapshot);
  const urgentWatchSummary =
    canSeeUrgentWatch
      ? await getUrgentWatchHomeSummary(client, auth, { date: options.date })
      : {
          visible: false,
          tone: "neutral" as const,
          summary_line: options.mode === "tv" ? "Exceptions are hidden in TV mode." : "Exceptions are not visible for this role.",
          urgent_count: 0,
          items: []
        };
  const urgentWatch = {
    visible: urgentWatchSummary.visible,
    tone: urgentWatchSummary.tone,
    summary_line: urgentWatchSummary.summary_line,
    items: urgentWatchSummary.items.map(mapUrgentWatchHomeItem)
  };
  const productionIntakeIssueCount = urgentWatchSummary.items.filter(
    (item) => item.source_module === "production" && item.watch_type === "production_intake_issue"
  ).length;
  const criticalBanner = buildCriticalBanner(weatherTravelItems, businessPulse.tiles);
  const productionAtRiskCount = Number(productionProjects.counts.attention_needed ?? 0) + productionIntakeIssueCount;
  const approvalsWaitingCount =
    pendingSecurityApprovalRequests.length + Number(operationalApprovals?.summary.awaiting_my_decision ?? 0);
  const homeSurface = buildHomeSurface({
    accessProfile,
    homeDashboardDefaults,
    layout: homeLayout,
    productionVisible: options.mode !== "tv",
    todayStrip: {
      shoot_count: todayPreviews.length,
      urgent_issue_count: urgentWatch.items.length,
      approvals_waiting_count: approvalsWaitingCount,
      late_arrival_count: attendanceAwareness.summary.late_count + attendanceAwareness.summary.critically_late_count,
      production_at_risk_count: productionAtRiskCount
    },
    urgentWatch,
    todayPreviews,
    attendanceAwareness,
    productionProjects,
    productionIntakeIssueCount,
    managerCockpit,
    employeeMyWork,
    employeeTimeClockState,
    operationalApprovals,
    schoolsRiskSnapshot
  });
  const rawWidgets: HomeDashboardWidgets = {
    today_strip: {
      shoot_count: todayPreviews.length,
      urgent_issue_count: urgentWatch.items.length,
      approvals_waiting_count: approvalsWaitingCount,
      late_arrival_count: attendanceAwareness.summary.late_count + attendanceAwareness.summary.critically_late_count,
      production_at_risk_count: productionAtRiskCount
    },
    business_pulse: businessPulse,
    today_shoots: {
      total: todayPreviews.length,
      upcoming_count: todayPreviews.filter((shoot) => shoot.phase === "upcoming").length,
      in_progress_count: todayPreviews.filter((shoot) => shoot.phase === "in_progress").length,
      complete_count: todayPreviews.filter((shoot) => shoot.phase === "complete").length,
      needs_attention_count: todayPreviews.filter((shoot) => shoot.phase === "needs_attention").length,
      big_shoot_count: todayPreviews.filter((shoot) => shoot.big_shoot).length,
      shoots: todayPreviews
    },
    weather_travel_watch: {
      tone: weatherTravelItems.some((item) => item.severity === "action_needed")
        ? "action_needed"
        : weatherTravelItems.some((item) => item.severity === "heads_up")
          ? "heads_up"
          : "neutral",
      summary_line: weatherTravelItems.length
        ? buildWeatherSummaryLine(weatherTravelItems)
        : "No weather or travel issues right now.",
      items: weatherTravelItems
    },
    customer_service_pulse: customerPulse,
    places_that_need_more_love: places,
    labor_snapshot_today: options.mode === "tv" ? null : labor,
    attendance_awareness: attendanceAwareness,
    urgent_watch: urgentWatch,
    department_task_counts: departmentTaskCounts,
    production_projects: {
      visible: options.mode !== "tv",
      generated_at: productionProjects.generated_at,
      summary_line: productionProjects.summary_line,
      tone: productionProjects.tone,
      counts: productionProjects.counts,
      assessment_cards: productionProjects.assessment_cards,
      owners: productionProjects.owners,
      focus_items: productionProjects.focus_items,
      urgent_items: productionProjects.urgent_items
    }
  };
  const widgets = buildRoleSafeHomeWidgets({
    layout: homeLayout,
    anchorDate: options.date,
    employeeMyWork,
    widgets: rawWidgets
  });

  return {
    generated_at: new Date().toISOString(),
    anchor_date: options.date,
    mode: options.mode,
    refresh_interval_seconds: 60,
    tv_rotation_seconds: 15,
    public_safe: options.mode === "tv",
    tv_names_enabled: options.mode === "tv" ? config.TV_MODE_SHOW_EMPLOYEE_NAMES : true,
    critical_banner: criticalBanner,
    home_surface: homeSurface,
    widgets
  };
}

function buildHomeSurface(input: {
  accessProfile: OperatingSystemAccessProfile;
  homeDashboardDefaults: HomeDashboardDefaultsConfig;
  layout: "manager" | "employee";
  productionVisible: boolean;
  todayStrip: HomeDashboardResponse["widgets"]["today_strip"];
  urgentWatch: HomeDashboardResponse["widgets"]["urgent_watch"];
  todayPreviews: TodayShootPreview[];
  attendanceAwareness: HomeAttendanceAwarenessWidget;
  productionProjects: Awaited<ReturnType<typeof getProductionProjectHomeSnapshot>>;
  productionIntakeIssueCount: number;
  managerCockpit: ManagerCockpitResponse | null;
  employeeMyWork: Awaited<ReturnType<typeof listEmployeeMyWork>> | null;
  operationalApprovals: OperationalApprovalWorkspace | null;
  employeeTimeClockState: TimeClockShellControlState | null;
  schoolsRiskSnapshot: Awaited<ReturnType<typeof getSchoolsRiskSnapshot>> | null;
}): HomeSurface {
  const visibilityMatrix = buildHomeSurfaceVisibilityMatrix(input);
  return {
    role_template: input.accessProfile.role_template,
    layout: input.layout,
    visibility_matrix: visibilityMatrix,
    module_access: input.accessProfile.module_access,
    staffing_band: input.layout === "manager" ? buildManagerStaffingBand(input.attendanceAwareness, visibilityMatrix.staffing_tracker) : null,
    time_band: input.layout === "employee" ? buildEmployeeTimeBand(input.employeeTimeClockState) : null,
    today_strip: {
      headline: "Today Strip",
      items:
        input.layout === "employee"
          ? buildEmployeeTodayStrip(input.employeeMyWork)
          : buildManagerTodayStrip(input.todayStrip, input.todayPreviews)
    },
    urgent_attention: {
      visible: visibilityMatrix.urgent_watch,
      headline: "What Needs Attention Right Now",
      summary_line: visibilityMatrix.urgent_watch
        ? input.urgentWatch.summary_line
        : "Exceptions are not visible for this role.",
      items: visibilityMatrix.urgent_watch ? input.urgentWatch.items.slice(0, 6) : []
    },
    today_and_next_up: input.layout === "manager" ? buildManagerTodayAndNextUp(input.managerCockpit, input.operationalApprovals) : null,
    my_day: input.layout === "employee" ? buildEmployeeMyDay(input.employeeMyWork) : null,
    compact_widgets: buildHomeCompactWidgets({
      roleTemplate: input.accessProfile.role_template,
      visibilityMatrix,
      hiddenCompactWidgets: new Set(input.homeDashboardDefaults.hidden_compact_widgets),
      attendanceAwareness: input.attendanceAwareness,
      productionProjects: input.productionProjects,
      productionIntakeIssueCount: input.productionIntakeIssueCount,
      productionVisible: input.productionVisible,
      managerCockpit: input.managerCockpit,
      operationalApprovals: input.operationalApprovals,
      todayPreviews: input.todayPreviews,
      schoolsRiskSnapshot: input.schoolsRiskSnapshot
    })
  };
}

function buildHomeSurfaceVisibilityMatrix(input: {
  accessProfile: OperatingSystemAccessProfile;
  homeDashboardDefaults: HomeDashboardDefaultsConfig;
  layout: "manager" | "employee";
  attendanceAwareness: HomeAttendanceAwarenessWidget;
  productionVisible: boolean;
  managerCockpit: ManagerCockpitResponse | null;
  employeeTimeClockState: TimeClockShellControlState | null;
}) {
  const hiddenSections = new Set(input.homeDashboardDefaults.hidden_sections);
  if (input.layout === "employee") {
    const matrix: HomeSurfaceVisibilityMatrix = {
      staffing_tracker: false,
      time_band: Boolean(input.employeeTimeClockState),
      today_strip: true,
      urgent_watch: false,
      today_and_next_up: false,
      my_day: true,
      attendance_awareness: false,
      production_snapshot: false,
      approvals_summary: false,
      staffing_health: false,
      my_follow_ups: false,
      schools_risk: false
    };
    for (const section of hiddenSections) {
      matrix[section] = false;
    }
    return matrix;
  }

  const roleTemplate = input.accessProfile.role_template;
  const operationalRole = roleTemplate !== "production_manager";
  const planningRole =
    roleTemplate === "leadership" ||
    roleTemplate === "operations_lead" ||
    roleTemplate === "department_manager" ||
    roleTemplate === "scheduling_lead";

  const matrix: HomeSurfaceVisibilityMatrix = {
    staffing_tracker:
      operationalRole && input.accessProfile.module_access.operations.can_view && input.attendanceAwareness.visible,
    time_band: false,
    today_strip: true,
    urgent_watch: input.accessProfile.module_access.urgent_watch.can_view,
    today_and_next_up: true,
    my_day: false,
    attendance_awareness: false,
    production_snapshot: input.accessProfile.module_access.production.can_view && input.productionVisible,
    approvals_summary: input.accessProfile.module_access.approvals.can_view,
    staffing_health:
      planningRole &&
      (input.accessProfile.module_access.scheduling.can_view || input.accessProfile.module_access.operations.can_view),
    my_follow_ups: planningRole && Boolean(input.managerCockpit),
    schools_risk: planningRole
  };
  for (const section of hiddenSections) {
    matrix[section] = false;
  }
  return matrix;
}

function buildManagerStaffingBand(
  attendanceAwareness: HomeAttendanceAwarenessWidget,
  visible: boolean
): HomeSurfaceStaffingBand | null {
  if (!visible || !attendanceAwareness.visible) {
    return null;
  }

  const actionHash = "#operations/attendance";
  const metrics: HomeSurfaceStaffingBandMetric[] = [
    {
      id: "clocked_in",
      label: "Clocked In",
      count: Number(attendanceAwareness.summary.clocked_in_count ?? 0),
      tone: "good",
      detail: buildStaffingBandDetail(
        attendanceAwareness.clocked_in.items.map((item) => item.employee_name),
        "People already on the clock."
      ),
      action_hash: actionHash
    },
    {
      id: "in_office",
      label: "In Office",
      count: Number(attendanceAwareness.in_office.count ?? 0),
      tone: "info",
      detail: buildStaffingBandDetail(
        attendanceAwareness.in_office.items.map((item) => item.employee_name),
        "No one is currently marked in office."
      ),
      action_hash: actionHash
    },
    {
      id: "in_field",
      label: "In Field",
      count: Number(attendanceAwareness.in_field.count ?? 0),
      tone: "info",
      detail: buildStaffingBandDetail(
        attendanceAwareness.in_field.items.map((item) => item.employee_name),
        "No one is currently marked in field."
      ),
      action_hash: actionHash
    },
    {
      id: "assigned_but_missing",
      label: "Scheduled But Missing",
      count: Number(attendanceAwareness.assigned_but_missing.count ?? 0),
      tone: Number(attendanceAwareness.assigned_but_missing.count ?? 0) > 0 ? "action_needed" : "neutral",
      detail: buildStaffingBandDetail(
        attendanceAwareness.assigned_but_missing.items.map((item) => item.employee_name),
        "No scheduled people are missing a clock-in."
      ),
      action_hash: actionHash
    }
  ];

  const missingCount = metrics.find((metric) => metric.id === "assigned_but_missing")?.count ?? 0;
  const lateRiskCount =
    Number(attendanceAwareness.summary.late_count ?? 0) +
    Number(attendanceAwareness.summary.critically_late_count ?? 0) +
    Number(attendanceAwareness.summary.probable_no_show_count ?? 0);
  const clockedInCount = metrics.find((metric) => metric.id === "clocked_in")?.count ?? 0;

  return {
    visible: true,
    headline: "Staffing Login Tracker",
    summary_line:
      missingCount > 0
        ? `${missingCount} scheduled people still need a clock-in. Open Attendance before coverage slips.`
        : lateRiskCount > 0
          ? `${lateRiskCount} live attendance issues still need a manager decision.`
          : clockedInCount > 0
            ? `${clockedInCount} people are already on the clock. Staffing presence looks stable right now.`
            : "No one is on the clock yet. Open Attendance if that looks wrong for this part of the day.",
    action_hash: actionHash,
    metrics
  };
}

function buildStaffingBandDetail(names: string[], emptyLabel: string) {
  const preview = names.filter(Boolean).slice(0, 2).join(" | ");
  return preview || emptyLabel;
}

function buildManagerTodayStrip(
  summary: HomeDashboardResponse["widgets"]["today_strip"],
  todayPreviews: TodayShootPreview[]
): HomeSurfaceStripItem[] {
  const liveShoots = todayPreviews.filter((shoot) => shoot.phase === "in_progress").length;
  const staffingWarnings = todayPreviews.filter((shoot) => shoot.staffing_readiness_tone === "action_needed").length;
  return [
    {
      id: "today_shoots",
      label: "Today's Shoots",
      value: summary.shoot_count,
      detail:
        summary.shoot_count > 0
          ? `${liveShoots} live now${staffingWarnings ? `, ${staffingWarnings} with staffing pressure` : ""}`
          : "No shoots are on deck today.",
      tone: summary.shoot_count > 0 ? "info" : "neutral",
      action_hash: "#operations/shoots"
    },
    {
      id: "urgent_watch",
      label: "Urgent Issues",
      value: summary.urgent_issue_count,
      detail: summary.urgent_issue_count ? "Blocking and at-risk operating exceptions are active." : "No open exceptions are active.",
      tone: summary.urgent_issue_count ? "action_needed" : "good",
      action_hash: "#operations/exceptions"
    },
    {
      id: "approvals",
      label: "Approvals Waiting",
      value: summary.approvals_waiting_count,
      detail:
        summary.approvals_waiting_count > 0
          ? "Protected decisions are still waiting on review."
          : "Approval queues are clear.",
      tone: summary.approvals_waiting_count > 0 ? "heads_up" : "good",
      action_hash: "#approvals"
    },
    {
      id: "attendance",
      label: "Late / Missing Staff",
      value: summary.late_arrival_count,
      detail:
        summary.late_arrival_count > 0
          ? "Attendance risk could affect coverage."
          : "No late or missing staff are open.",
      tone: summary.late_arrival_count > 0 ? "action_needed" : "good",
      action_hash: "#operations/attendance"
    },
    {
      id: "production",
      label: "Production At Risk",
      value: summary.production_at_risk_count,
      detail:
        summary.production_at_risk_count > 0
          ? "Overdue, blocked, stale, or quality-gated production work needs follow-through."
          : "Production is steady right now.",
      tone: summary.production_at_risk_count > 0 ? "action_needed" : "good",
      action_hash: "#production"
    }
  ];
}

function buildEmployeeTodayStrip(employeeMyWork: Awaited<ReturnType<typeof listEmployeeMyWork>> | null): HomeSurfaceStripItem[] {
  const summary = employeeMyWork?.summary;
  if (!summary) {
    return [
      {
        id: "today_assignments",
        label: "Today",
        value: 0,
        detail: "Your schedule is loading.",
        tone: "neutral",
        action_hash: "#schedule"
      }
    ];
  }

  return [
    {
      id: "today_assignments",
      label: "Today's Assignments",
      value: summary.shifts_today,
      detail: summary.shifts_today ? summary.next_shift_label ?? "You have work lined up today." : "No published shifts are on the board yet.",
      tone: summary.shifts_today ? "info" : "neutral",
      action_hash: "#schedule"
    },
    {
      id: "up_next",
      label: "Up Next",
      value: summary.upcoming_shifts,
      detail: summary.upcoming_shifts ? "More shifts are coming up this week." : "Nothing else is queued after today.",
      tone: summary.upcoming_shifts ? "info" : "neutral",
      action_hash: "#schedule"
    },
    {
      id: "needs_attention",
      label: "Needs Attention",
      value: summary.attention_needed_count,
      detail:
        summary.attention_needed_count > 0
          ? "One or more items in your day still need action."
          : "Your day looks clear right now.",
      tone: summary.attention_needed_count > 0 ? "heads_up" : "good",
      action_hash: "#dashboard/my-day"
    },
    {
      id: "updates",
      label: "Unread Updates",
      value: summary.unread_notifications,
      detail:
        summary.unread_notifications > 0
          ? "Schedule or workflow updates are waiting for you."
          : "No unread updates are waiting right now.",
      tone: summary.unread_notifications > 0 ? "info" : "good",
      action_hash: "#dashboard/alerts"
    },
    {
      id: "follow_through",
      label: "Follow-Through",
      value: summary.closeout_due_count,
      detail:
        summary.closeout_due_count > 0
          ? "Closeout or mileage follow-through is still open."
          : "Closeout is clear right now.",
      tone: summary.closeout_due_count > 0 ? "heads_up" : "good",
      action_hash: "#dashboard/my-day"
    }
  ];
}

function buildEmployeeTimeBand(controlState: TimeClockShellControlState | null): HomeSurfaceTimeBand | null {
  if (!controlState) {
    return null;
  }
  const activeShift = controlState.active_shift ?? controlState.next_shift ?? null;
  const scheduleHash = "#schedule";
  const myDayHash = "#dashboard/my-day";
  return {
    visible: true,
    headline: "Time Clock Status",
    state: controlState.state,
    emphasis: controlState.emphasis,
    label: controlState.label,
    summary_line: buildEmployeeTimeBandSummary(controlState, activeShift),
    elapsed_label:
      controlState.state === "active" && controlState.time_clock_state.current_segment_started_at
        ? formatHomeTimeClockElapsed(controlState.time_clock_state.current_segment_started_at)
        : null,
    shift_label: activeShift ? `${activeShift.title} | ${formatTimeWindow(activeShift.starts_at, activeShift.ends_at)}` : null,
    location_label:
      activeShift?.location_name ??
      (controlState.state === "active"
        ? "Live location is syncing from the active Time Session."
        : "Open Schedule if you need the full assignment context."),
    action_label:
      controlState.state === "off_shift"
        ? "Open Schedule"
        : "Open My Day",
    action_hash: controlState.state === "off_shift" ? scheduleHash : myDayHash,
    schedule_hash: scheduleHash
  };
}

function buildEmployeeTimeBandSummary(
  controlState: TimeClockShellControlState,
  activeShift: TimeClockShellControlState["active_shift"] | TimeClockShellControlState["next_shift"] | null
) {
  if (controlState.state === "active") {
    return activeShift
      ? `You are on the clock right now. ${controlState.helper_text}`
      : "You are on the clock right now. Mission Control is syncing the active session.";
  }
  if (controlState.state === "action_needed") {
    return `You are off the clock. ${controlState.helper_text}`;
  }
  if (controlState.state === "needs_review") {
    return `Your time record still needs review. ${controlState.helper_text}`;
  }
  if (controlState.state === "ended_today") {
    return activeShift
      ? `Your latest session is closed. ${controlState.helper_text}`
      : "Your latest time session for today is already closed.";
  }
  if (activeShift) {
    return `No punch is needed yet. ${controlState.helper_text}`;
  }
  return "No punch action is needed right now.";
}

function formatHomeTimeClockElapsed(startedAt: string) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m active`;
  }
  return `${minutes}m active`;
}

function buildManagerTodayAndNextUp(
  managerCockpit: ManagerCockpitResponse | null,
  operationalApprovals: OperationalApprovalWorkspace | null
) {
  if (!managerCockpit) {
    return {
      visible: false,
      headline: "Today and Next Up",
      summary_line: "Manager queues are loading.",
      today: [],
      next_up: []
    };
  }

  const todayQueueIds = new Set<ManagerCockpitResponse["queues"][number]["id"]>([
    "needs_staffing",
    "needs_approval",
    "overdue_project_tasks",
    "needs_payroll_compliance_review"
  ]);
  const nextQueueIds = new Set<ManagerCockpitResponse["queues"][number]["id"]>([
    "needs_project_setup",
    "needs_project_follow_up",
    "needs_follow_up",
    "needs_contact_cleanup"
  ]);

  const todayItems = managerCockpit.queues
    .filter((queue) => todayQueueIds.has(queue.id))
    .flatMap((queue) => queue.items.slice(0, queue.id === "needs_staffing" ? 3 : 2).map((item) => mapCockpitItem(queue.label, item)));
  const nextUpItems = managerCockpit.queues
    .filter((queue) => nextQueueIds.has(queue.id))
    .flatMap((queue) => queue.items.slice(0, 2).map((item) => mapCockpitItem(queue.label, item)));

  const approvalTodayItems =
    operationalApprovals?.overdue.slice(0, 2).map((item) => mapOperationalApprovalItem("Overdue Approval", item)) ??
    [];
  const awaitingDecisionItems =
    operationalApprovals?.awaiting_my_decision.slice(0, 2).map((item) => mapOperationalApprovalItem("My Decision", item)) ??
    [];

  const today = [...todayItems, ...approvalTodayItems, ...awaitingDecisionItems].slice(0, 6);
  const next_up = nextUpItems.slice(0, 6);
  const summary_line = today.length
    ? `${today.length} actions need manager attention now${next_up.length ? `, with ${next_up.length} more queued next.` : "."}`
    : next_up.length
      ? `${next_up.length} operational follow-through items are lined up next.`
      : "The manager queues are steady right now.";

  return {
    visible: true,
    headline: "Today and Next Up",
    summary_line,
    today,
    next_up
  };
}

function buildEmployeeMyDay(employeeMyWork: Awaited<ReturnType<typeof listEmployeeMyWork>> | null) {
  if (!employeeMyWork) {
    return {
      visible: false,
      headline: "My Day",
      summary_line: "Your day is loading.",
      next_shift_label: null,
      items: [],
      updates: []
    };
  }

  const items = [...employeeMyWork.shifts]
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
    .slice(0, 4)
    .map<HomeSurfaceMyDayItem>((shift) => ({
      id: shift.id,
      title: shift.shoot_title ?? shift.title,
      summary: shift.note_summary ?? shift.shoot_code ?? humanizeLabel(shift.shift_kind),
      location_label: shift.location_name ?? shift.location_address ?? "Location pending",
      time_label: formatTimeWindow(shift.starts_at, shift.ends_at),
      role_label: humanizeLabel(shift.staffing_role ?? shift.shift_kind),
      status_label: shift.follow_through_label ?? buildEmployeeShiftStatusLabel(shift.attendance_state),
      tone: mapEmployeeShiftTone(shift),
      next_action:
        shift.has_pre_service_notes && !shift.notes_acknowledged
          ? "Review notes"
          : shift.closeout_missing_count
            ? "Complete closeout"
            : "Open shift detail",
      action_hash: "#dashboard/my-day"
    }));

  const updates = employeeMyWork.notifications.slice(0, 3).map<HomeSurfaceUpdateItem>((notification) => ({
    id: notification.id,
    title: notification.title,
    summary: notification.body,
    created_at_label: new Date(notification.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    action_hash: notification.deep_link ?? "#dashboard/alerts"
  }));

  return {
    visible: true,
    headline: "My Day",
    summary_line:
      employeeMyWork.summary.attention_needed_count > 0
        ? `${employeeMyWork.summary.attention_needed_count} items in your day still need action.`
        : "Your published assignments and updates are clear right now.",
    next_shift_label: employeeMyWork.summary.next_shift_label ?? null,
    items,
    updates
  };
}

function buildHomeCompactWidgets(input: {
  roleTemplate: OperatingSystemAccessProfile["role_template"];
  visibilityMatrix: HomeSurfaceVisibilityMatrix;
  hiddenCompactWidgets: Set<HomeSurfaceCompactWidget["id"]>;
  attendanceAwareness: HomeAttendanceAwarenessWidget;
  productionProjects: Awaited<ReturnType<typeof getProductionProjectHomeSnapshot>>;
  productionIntakeIssueCount: number;
  productionVisible: boolean;
  managerCockpit: ManagerCockpitResponse | null;
  operationalApprovals: OperationalApprovalWorkspace | null;
  todayPreviews: TodayShootPreview[];
  schoolsRiskSnapshot: Awaited<ReturnType<typeof getSchoolsRiskSnapshot>> | null;
}) {
  const widgets: HomeSurfaceCompactWidget[] = [];

  if (input.visibilityMatrix.attendance_awareness && !input.hiddenCompactWidgets.has("attendance_awareness")) {
    const attendanceRiskCount =
      Number(input.attendanceAwareness.summary.not_clocked_in_count ?? 0) +
      Number(input.attendanceAwareness.summary.late_count ?? 0) +
      Number(input.attendanceAwareness.summary.critically_late_count ?? 0) +
      Number(input.attendanceAwareness.summary.probable_no_show_count ?? 0) +
      Number(input.attendanceAwareness.summary.wrong_location_count ?? 0);
    widgets.push({
      id: "attendance_awareness",
      title: "Attendance Awareness",
      count: attendanceRiskCount,
      summary:
        attendanceRiskCount > 0
          ? `${attendanceRiskCount} attendance issues could affect coverage right now.`
          : "No live attendance exceptions are pressuring the day.",
      tone: attendanceRiskCount > 0 ? "action_needed" : "good",
      action_hash: "#operations/attendance"
    });
  }

  if (input.visibilityMatrix.production_snapshot && !input.hiddenCompactWidgets.has("production_snapshot")) {
    const productionRiskCount = Number(input.productionProjects.counts.attention_needed ?? 0) + input.productionIntakeIssueCount;
    widgets.push({
      id: "production_snapshot",
      title: "Production Snapshot",
      count: productionRiskCount,
      summary:
        input.productionIntakeIssueCount > 0
          ? `${input.productionProjects.summary_line} ${input.productionIntakeIssueCount} intake issue${input.productionIntakeIssueCount === 1 ? "" : "s"} are also surfacing in Exceptions.`
          : input.productionProjects.summary_line,
      tone: input.productionProjects.tone,
      action_hash: "#production"
    });
  }

  if (input.visibilityMatrix.approvals_summary && !input.hiddenCompactWidgets.has("approvals_summary")) {
    const approvalCount =
      Number(input.operationalApprovals?.summary.awaiting_my_decision ?? 0) +
      Number(input.operationalApprovals?.summary.overdue ?? 0) +
      Number(input.operationalApprovals?.summary.pending_blocking ?? 0);
    widgets.push({
      id: "approvals_summary",
      title: "Approvals Summary",
      count: approvalCount,
      summary:
        approvalCount > 0
          ? `${approvalCount} approval items are still open or overdue.`
          : "No blocking approvals are waiting right now.",
      tone: Number(input.operationalApprovals?.summary.overdue ?? 0) > 0 ? "action_needed" : approvalCount > 0 ? "heads_up" : "good",
      action_hash: "#approvals"
    });
  }

  if (input.visibilityMatrix.staffing_health && !input.hiddenCompactWidgets.has("staffing_health")) {
    const staffingHealthCount =
      Number(input.managerCockpit?.summary.needs_staffing ?? 0) ||
      input.todayPreviews.filter((shoot) => shoot.staffing_readiness_tone === "action_needed").length;
    widgets.push({
      id: "staffing_health",
      title: "Staffing Health",
      count: staffingHealthCount,
      summary:
        staffingHealthCount > 0
          ? `${staffingHealthCount} staffing issues still need coverage decisions.`
          : "Coverage looks stable across today's schedule.",
      tone: staffingHealthCount > 0 ? "heads_up" : "good",
      action_hash: "#scheduling"
    });
  }

  if (input.visibilityMatrix.my_follow_ups && !input.hiddenCompactWidgets.has("my_follow_ups")) {
    const followUpCount = Number(input.managerCockpit?.summary.needs_follow_up ?? 0);
    widgets.push({
      id: "my_follow_ups",
      title: "My Follow-Ups",
      count: followUpCount,
      summary:
        followUpCount > 0
          ? `${followUpCount} school or account follow-ups still need a touch.`
          : input.roleTemplate === "production_manager"
            ? "No extra operational follow-ups are parked in your queue."
            : "Relationship follow-ups are clear right now.",
      tone: followUpCount > 0 ? "heads_up" : "good",
      action_hash: "#directory/accounts"
    });
  }

  if (input.visibilityMatrix.schools_risk && input.schoolsRiskSnapshot && !input.hiddenCompactWidgets.has("schools_risk")) {
    widgets.push({
      id: "schools_risk",
      title: "Schools Risk",
      count: Number(input.schoolsRiskSnapshot.high_risk_count ?? 0),
      summary: input.schoolsRiskSnapshot.summary_line,
      tone:
        Number(input.schoolsRiskSnapshot.high_risk_count ?? 0) > 0
          ? "action_needed"
          : Number(input.schoolsRiskSnapshot.waiting_count ?? 0) > 0
            ? "heads_up"
            : "good",
      action_hash: input.schoolsRiskSnapshot.action_hash
    });
  }

  return widgets;
}

function mapCockpitItem(sourceLabel: string, item: ManagerCockpitQueueItem): HomeSurfaceFocusItem {
  return {
    id: item.id,
    source_label: sourceLabel,
    title: item.title,
    summary: item.summary,
    owner_label: item.owner_label,
    due_label: item.due_label,
    status_label: item.status_label,
    tone: mapOperationalTone(item.status_tone),
    next_action: item.next_action,
    action_hash: item.action_hash
  };
}

function mapOperationalApprovalItem(sourceLabel: string, item: OperationalApprovalRequestSummary): HomeSurfaceFocusItem {
  return {
    id: item.id,
    source_label: sourceLabel,
    title: item.request_title,
    summary: item.request_summary ?? item.reason,
    owner_label: item.current_approver_name ?? item.current_approver_role_group_label ?? "Awaiting approver",
    due_label: item.sla_due_at ? `SLA ${new Date(item.sla_due_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : null,
    status_label: item.status_label,
    tone: item.overdue ? "action_needed" : item.escalated || item.blocking ? "heads_up" : "info",
    next_action: item.can_decide ? "Review and decide" : "Track approval",
    action_hash: "#approvals"
  };
}

function mapOperationalTone(value: ManagerCockpitQueueItem["status_tone"]): SeverityTone {
  switch (value) {
    case "critical":
      return "action_needed";
    case "warning":
      return "heads_up";
    case "success":
      return "good";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

function mapEmployeeShiftTone(
  shift: Pick<
    Awaited<ReturnType<typeof listEmployeeMyWork>>["shifts"][number],
    "follow_through_tone" | "attendance_state" | "has_pre_service_notes" | "notes_acknowledged" | "closeout_missing_count"
  >
): SeverityTone {
  if (shift.follow_through_tone === "action_needed") {
    return "action_needed";
  }
  if (shift.follow_through_tone === "heads_up") {
    return "heads_up";
  }
  if (shift.has_pre_service_notes && !shift.notes_acknowledged) {
    return "heads_up";
  }
  if (shift.closeout_missing_count) {
    return "heads_up";
  }
  if (shift.attendance_state && ["late", "no_show", "unresolved_no_check_in"].includes(String(shift.attendance_state))) {
    return "action_needed";
  }
  return "info";
}

function buildEmployeeShiftStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "Ready";
  }
  return humanizeLabel(String(value));
}

function formatTimeWindow(startsAt: string, endsAt: string) {
  return `${new Date(startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${new Date(endsAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekWindow(anchorDate: string): ShootListWindow {
  const anchor = parseDateOnly(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(anchor, mondayOffset);
  return {
    dateFrom: formatDateOnly(monday),
    dateTo: formatDateOnly(addDays(monday, 6))
  };
}

async function getTypicalWeek(client: PoolClient, tenantId: string, weekStart: string) {
  const baselineStart = formatDateOnly(addDays(parseDateOnly(weekStart), -28));
  const { rows } = await client.query<{ avg_shoots: string | null; avg_subjects: string | null }>(
    `
      SELECT
        AVG(weekly.shoot_count)::numeric AS avg_shoots,
        AVG(weekly.subject_count)::numeric AS avg_subjects
      FROM (
        SELECT
          date_trunc('week', shoot_date::timestamp)::date AS week_bucket,
          COUNT(*)::numeric AS shoot_count,
          COALESCE(SUM(projected_students), 0)::numeric AS subject_count
        FROM shoot
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND shoot_date >= $2::date
          AND shoot_date < $3::date
        GROUP BY 1
      ) weekly
    `,
    [tenantId, baselineStart, weekStart]
  );
  return {
    avgShoots: Number(rows[0]?.avg_shoots ?? 0),
    avgSubjects: Number(rows[0]?.avg_subjects ?? 0)
  };
}

function buildBusinessPulse(
  weekRows: ShootRow[],
  typicalWeek: { avgShoots: number; avgSubjects: number },
  laborSnapshot: Awaited<ReturnType<typeof getOperationsDashboard>> | null,
  anchorDate: string
) {
  const shootsThisWeek = weekRows.length;
  const subjectsThisWeek = weekRows.reduce((sum, row) => sum + Number(row.projected_students ?? 0), 0);
  const idCardQueueCount = deriveIdCardQueueCount(subjectsThisWeek, shootsThisWeek);
  const jobsNeedingAttention = buildJobsNeedingAttention(weekRows);
  const weekRange = getWeekWindow(anchorDate);
  const weekSchedule = buildWeekSchedule(weekRows, anchorDate);
  const weeklyDepartmentMix = buildWeeklyDepartmentMix(weekRows);
  const tiles: BusinessPulseTile[] = [
    {
      id: "shoots_this_week",
      label: "Shoots This Week",
      value: shootsThisWeek,
      context_label: shootsThisWeek === 0 ? "No shoots scheduled" : compareAgainstTypical(shootsThisWeek, typicalWeek.avgShoots, "week"),
      tone: "info",
      trend_label: shootsThisWeek === 0 ? null : compareTrend(shootsThisWeek, typicalWeek.avgShoots),
      source_mode: "live"
    },
    {
      id: "subjects_this_week",
      label: "Subjects This Week",
      value: subjectsThisWeek,
      context_label: classifySubjectLoad(subjectsThisWeek, typicalWeek.avgSubjects),
      tone: "info",
      trend_label: subjectsThisWeek === 0 ? null : compareTrend(subjectsThisWeek, typicalWeek.avgSubjects),
      source_mode: "live"
    },
    {
      id: "id_cards_to_print",
      label: "ID Cards to Print",
      value: idCardQueueCount,
      context_label: classifyQueueStatus(idCardQueueCount),
      tone: idCardQueueCount >= 180 ? "action_needed" : idCardQueueCount >= 90 ? "heads_up" : idCardQueueCount > 0 ? "good" : "neutral",
      trend_label: idCardQueueCount === 0 ? null : `${idCardQueueCount >= 180 ? "Heavy" : idCardQueueCount >= 90 ? "Building" : "Under control"} queue`,
      source_mode: "derived_adapter"
    },
    {
      id: "jobs_needing_attention",
      label: "Jobs Needing Attention",
      value: jobsNeedingAttention.length,
      context_label: jobsNeedingAttention.length ? `${jobsNeedingAttention.length} jobs need a tune-up` : "No jobs currently behind",
      tone: jobsNeedingAttention.some((job) => job.tone === "action_needed")
        ? "action_needed"
        : jobsNeedingAttention.length
          ? "heads_up"
          : "good",
      trend_label: jobsNeedingAttention.length ? "Exception pressure this week" : "Nothing urgent right now",
      source_mode: "live"
    }
  ];

  if (laborSnapshot && config.HOME_LABOR_WIDGET_ENABLED) {
    tiles.push({
      id: "labor_today",
      label: "Labor Today",
      value: Math.round(Number(laborSnapshot.summary.actual_labor_hours ?? 0)),
      context_label: Number(laborSnapshot.summary.actual_labor_hours ?? 0) <= Number(laborSnapshot.summary.scheduled_labor_hours ?? 0)
        ? "On track"
        : "Variance rising",
      tone:
        Number(laborSnapshot.summary.actual_labor_hours ?? 0) - Number(laborSnapshot.summary.scheduled_labor_hours ?? 0) > 2
          ? "heads_up"
          : "neutral",
      trend_label: `${Number(laborSnapshot.summary.scheduled_labor_hours ?? 0).toFixed(1)}h scheduled`,
      source_mode: "live"
    });
  }

  return {
    tiles,
    week_start: weekRange.dateFrom as string,
    week_end: weekRange.dateTo as string,
    week_schedule: weekSchedule,
    weekly_department_mix: weeklyDepartmentMix,
    jobs: jobsNeedingAttention
  };
}

function buildWeekSchedule(weekRows: ShootRow[], anchorDate: string): WeekScheduleItem[] {
  const weekWindow = getWeekWindow(anchorDate);
  const todayKey = formatDateOnly(new Date());
  const start = parseDateOnly(weekWindow.dateFrom as string);
  const items: WeekScheduleItem[] = [];

  for (let index = 0; index < 7; index += 1) {
    const date = addDays(start, index);
    const dateKey = formatDateOnly(date);
    const rowsForDay = weekRows.filter((row) => row.shoot_date === dateKey);
    const bigShootCount = rowsForDay.filter((row) => isBigShootRow(row)).length;
    const attentionCount = rowsForDay.filter((row) => getJobAttentionDetail(row, todayKey)).length;

    items.push({
      date: dateKey,
      label: date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
      short_label: date.toLocaleDateString([], { weekday: "short" }),
      shoot_count: rowsForDay.length,
      big_shoot_count: bigShootCount,
      attention_count: attentionCount,
      is_today: dateKey === anchorDate
    });
  }

  return items;
}

function buildWeeklyDepartmentMix(weekRows: ShootRow[]) {
  const buckets = new Map<string, { department: string; shoots: number; subjects: number }>();
  for (const row of weekRows) {
    const department = String(row.department ?? "other");
    const current = buckets.get(department) ?? { department, shoots: 0, subjects: 0 };
    current.shoots += 1;
    current.subjects += Number(row.projected_students ?? 0);
    buckets.set(department, current);
  }
  return [...buckets.values()].sort((left, right) => right.shoots - left.shoots);
}

function buildJobsNeedingAttention(weekRows: ShootRow[]): JobNeedingAttention[] {
  const todayKey = formatDateOnly(new Date());
  return weekRows
    .map<JobNeedingAttention | null>((row) => {
      const detail = getJobAttentionDetail(row, todayKey);
      if (!detail) {
        return null;
      }
      return {
        id: row.id,
        label: `${row.shoot_code} | ${row.title}`,
        detail: detail.message,
        tone: detail.tone
      };
    })
    .filter((row): row is JobNeedingAttention => row !== null)
    .slice(0, 6);
}

function getJobAttentionDetail(row: ShootRow, todayKey: string) {
  const priorityRow = isBigShootRow(row) || String(row.priority_label ?? "standard") === "elevated";
  if (!row.arrival_time || !row.start_time || !(row.location_name || row.location_address)) {
    return {
      message: priorityRow ? "Priority shoot still has prep details missing" : "Timing or location details need a quick tune-up",
      tone: "heads_up" as const
    };
  }
  if (String(row.schedule_sync_state ?? "not_linked") === "sync_error") {
    return { message: "Schedule sync needs a retry", tone: "action_needed" as const };
  }
  if (String(row.schedule_sync_state ?? "not_linked") === "sync_warning") {
    return { message: "Schedule sync needs a review", tone: "heads_up" as const };
  }
  const normalizedStatus = normalizeShootStatusValue(row.status);
  const isBehind =
    row.shoot_date &&
    row.shoot_date < todayKey &&
    !isShootFinishedOnSite(normalizedStatus) &&
    !isShootTerminalStatus(normalizedStatus);
  if (isBehind) {
    return { message: "This job looks behind the expected schedule", tone: "action_needed" as const };
  }
  if (priorityRow && Number(row.open_alert_count ?? 0) > 0) {
    return { message: "Priority shoot has open alerts that still need review", tone: "heads_up" as const };
  }
  return null;
}

function isBigShootRow(row: ShootRow) {
  return Boolean(row.big_shoot) || isBigShootLabel((String(row.priority_label ?? "standard") as any) ?? "standard");
}

function deriveIdCardQueueCount(subjectsThisWeek: number, shootsThisWeek: number) {
  if (!subjectsThisWeek && !shootsThisWeek) {
    return 0;
  }
  const derived = Math.round(subjectsThisWeek * 0.16 + shootsThisWeek * 6);
  return Math.max(derived, shootsThisWeek ? 12 : 0);
}

function classifyQueueStatus(count: number) {
  if (count === 0) {
    return "No ID cards queued";
  }
  if (count >= 180) {
    return "Queue is heavy today";
  }
  if (count >= 90) {
    return "Queue is building";
  }
  return "ID card queue is under control";
}

function compareAgainstTypical(current: number, baseline: number, subject: string) {
  if (!baseline) {
    return `First clear ${subject} signal in view`;
  }
  const delta = Math.round(current - baseline);
  if (delta === 0) {
    return `On pace with a typical ${subject}`;
  }
  return `${delta > 0 ? "+" : ""}${delta} vs typical ${subject}`;
}

function compareTrend(current: number, baseline: number) {
  if (!baseline) {
    return null;
  }
  const deltaPercent = Math.round(((current - baseline) / Math.max(baseline, 1)) * 100);
  if (Math.abs(deltaPercent) < 5) {
    return "Near typical";
  }
  return `${deltaPercent > 0 ? "+" : ""}${deltaPercent}% vs typical`;
}

function classifySubjectLoad(current: number, baseline: number) {
  if (!current) {
    return "No subject volume scheduled";
  }
  if (!baseline) {
    return current >= 500 ? "Very busy" : current >= 220 ? "Busy" : "Normal";
  }
  const ratio = current / Math.max(baseline, 1);
  if (ratio >= 1.25) {
    return "Very busy";
  }
  if (ratio >= 0.95) {
    return "Busy";
  }
  return "Normal";
}

function buildTodayShootPreview(row: ShootRow, anchorDate: string, weatherTravelItems: WeatherTravelItem[]): TodayShootPreview {
  const now = new Date();
  const start = row.start_time ? new Date(row.start_time) : null;
  const end = row.end_time_est ? new Date(row.end_time_est) : null;
  const normalizedStatus = normalizeShootStatusValue(row.status);
  const syncState = String(row.schedule_sync_state ?? "not_linked");
  const syncLabel = syncState === "in_sync"
    ? "In Sync"
    : syncState === "pending_sync"
      ? "Sync Pending"
      : syncState === "sync_warning"
        ? "Sync Exception"
        : syncState === "sync_error"
          ? "Sync Needs Retry"
          : "Not Linked";
  const syncTone: SeverityTone =
    syncState === "sync_error" ? "action_needed" : syncState === "sync_warning" || syncState === "pending_sync" ? "heads_up" : "neutral";
  const missingCoreData = !row.arrival_time || !row.start_time || !(row.location_name || row.location_address);
  const weatherTravelIssue = weatherTravelItems.find((item) => item.shoot_id === row.id);
  const priorityLabel = (String(row.priority_label ?? "standard") as TodayShootPreview["priority_label"]) ?? "standard";
  const bigShoot = Boolean(row.big_shoot) || isBigShootLabel(priorityLabel);
  const leadName = typeof row.lead_names === "string" && row.lead_names.trim() ? row.lead_names.trim() : null;
  const plannedStaffCount = Math.max(Number(row.planned_staff_count ?? row.scheduled_employee_count ?? 0), 0);
  const assignedStaffCount = Math.max(Number(row.assigned_staff_count ?? row.scheduled_employee_count ?? 0), 0);
  const requiredLeadCount = Math.max(Number(row.required_lead_count ?? 1), 1);
  const leadCoverageCount = Math.max(Number(row.lead_coverage_count ?? (leadName ? 1 : 0)), 0);
  let phase: TodayShootPreview["phase"] = "upcoming";
  if (isShootFinishedOnSite(normalizedStatus) || isShootTerminalStatus(normalizedStatus) || (end && end.getTime() < now.getTime())) {
    phase = "complete";
  } else if (normalizedStatus === "LIVE" || (start && end && start.getTime() <= now.getTime() && end.getTime() >= now.getTime())) {
    phase = "in_progress";
  }
  let attentionLabel: string | null = null;
  let attentionTone: SeverityTone | null = null;
  if (Boolean(row.lead_confirmed_ready) && Boolean(row.lead_confirmed_ready_exception_flag)) {
    phase = "needs_attention";
    attentionLabel = "Ready with exception";
    attentionTone = "heads_up";
  } else if (Boolean(row.ready_to_shoot_escalation_due)) {
    phase = "needs_attention";
    attentionLabel = "Lead ready overdue";
    attentionTone = "action_needed";
  } else if (syncTone === "action_needed") {
    phase = "needs_attention";
    attentionLabel = "Sync risk";
    attentionTone = "action_needed";
  } else if (missingCoreData) {
    phase = "needs_attention";
    attentionLabel = "Details missing";
    attentionTone = "heads_up";
  } else if (weatherTravelIssue && weatherTravelIssue.severity !== "neutral") {
    phase = "needs_attention";
    attentionLabel = weatherTravelIssue.kind === "weather" ? "Weather watch" : "Travel watch";
    attentionTone = weatherTravelIssue.severity;
  } else if (Boolean(row.ready_to_shoot_reminder_due)) {
    phase = "needs_attention";
    attentionLabel = "Awaiting lead confirmation";
    attentionTone = "heads_up";
  }
  const statusLabel = humanizeShootStatus(normalizedStatus ?? row.status ?? "CONFIRMED");
  const statusTone: SeverityTone =
    phase === "complete" ? "good" : phase === "in_progress" ? "info" : phase === "needs_attention" ? (attentionTone ?? "heads_up") : "neutral";
  const staffingReadiness = buildStaffingReadinessSummary({
    assignedStaffCount,
    plannedStaffCount,
    requiredLeadCount,
    leadCoverageCount,
    leadName,
    bigShoot
  });

  return {
    id: row.id,
    shoot_code: row.shoot_code,
    title: row.title,
    department: row.department ? String(row.department) : null,
    shoot_date: row.shoot_date ? String(row.shoot_date) : anchorDate,
    location_name: String(row.location_name ?? ""),
    location_address: row.location_address ? String(row.location_address) : null,
    navigation_url: row.navigation_url ? String(row.navigation_url) : null,
    estimated_drive_minutes: row.estimated_drive_minutes != null ? Number(row.estimated_drive_minutes) : null,
    arrival_time: row.arrival_time ? String(row.arrival_time) : null,
    start_time: row.start_time ? String(row.start_time) : null,
    end_time_est: row.end_time_est ? String(row.end_time_est) : null,
    projected_students: row.projected_students != null ? Number(row.projected_students) : null,
    status: row.status ? String(row.status) : null,
    scheduled_employee_count: row.scheduled_employee_count != null ? Number(row.scheduled_employee_count) : null,
    big_shoot: bigShoot,
    lead_name: leadName,
    lead_confirmed_ready: Boolean(row.lead_confirmed_ready),
    lead_confirmed_ready_at: typeof row.lead_confirmed_ready_at === "string" ? row.lead_confirmed_ready_at : null,
    lead_confirmed_ready_by_name: typeof row.lead_confirmed_ready_by_name === "string" ? row.lead_confirmed_ready_by_name : null,
    lead_confirmed_ready_exception_flag: Boolean(row.lead_confirmed_ready_exception_flag),
    ready_to_shoot_status: typeof row.ready_to_shoot_status === "string" ? row.ready_to_shoot_status : null,
    ready_to_shoot_label: typeof row.ready_to_shoot_label === "string" ? row.ready_to_shoot_label : null,
    ready_to_shoot_tone: (row.ready_to_shoot_tone as SeverityTone | null | undefined) ?? null,
    staffing_readiness_label: staffingReadiness.label,
    staffing_readiness_tone: staffingReadiness.tone,
    priority_label: priorityLabel,
    priority_display: humanizePriorityLabel(priorityLabel),
    priority_reasons: Array.isArray(row.priority_reasons)
      ? row.priority_reasons.map((reason: unknown) => ({
          label: String((reason as { label?: string }).label ?? "Priority"),
          detail: String((reason as { detail?: string }).detail ?? "")
        }))
      : [],
    scale_label: scaleLabel(Number(row.projected_students ?? 0), Number(row.scheduled_employee_count ?? 0)),
    phase,
    status_label: statusLabel,
    status_tone: statusTone,
    attention_label: attentionLabel,
    attention_tone: attentionTone,
    sync_label: syncLabel,
    sync_tone: syncTone,
    next_action:
      phase === "needs_attention"
        ? attentionLabel === "Details missing"
          ? "Fill in timing and location details"
          : attentionLabel === "Sync risk"
            ? "Review sync status"
            : isBigShootLabel(priorityLabel)
              ? "Open the readiness briefing"
              : "Open the operational briefing"
        : phase === "in_progress"
          ? "Keep the day moving"
        : phase === "complete"
            ? normalizedStatus === "POST_PRODUCTION"
              ? "Open production follow-through"
              : "Review the wrap"
            : "Open the operational briefing"
  };
}

function buildStaffingReadinessSummary(input: {
  assignedStaffCount: number;
  plannedStaffCount: number;
  requiredLeadCount: number;
  leadCoverageCount: number;
  leadName: string | null;
  bigShoot: boolean;
}) {
  if (input.leadCoverageCount < input.requiredLeadCount) {
    return {
      label: "Lead missing",
      tone: "action_needed" as const
    };
  }
  if (input.plannedStaffCount > 0 && input.assignedStaffCount < input.plannedStaffCount) {
    return {
      label: `${input.assignedStaffCount}/${input.plannedStaffCount} staffed`,
      tone: input.bigShoot ? ("action_needed" as const) : ("heads_up" as const)
    };
  }
  if (input.plannedStaffCount > 0) {
    return {
      label: `${Math.max(input.assignedStaffCount, input.plannedStaffCount)}/${input.plannedStaffCount} staffed`,
      tone: "good" as const
    };
  }
  if (input.assignedStaffCount > 0) {
    return {
      label: `${input.assignedStaffCount} assigned`,
      tone: "good" as const
    };
  }
  if (input.leadName) {
    return {
      label: "Lead assigned",
      tone: "good" as const
    };
  }
  return {
    label: "Staffing review",
    tone: "neutral" as const
  };
}

function scaleLabel(projectedStudents: number, scheduledEmployees: number) {
  if (scheduledEmployees <= 1 || projectedStudents <= 24) {
    return "1-camera";
  }
  if (scheduledEmployees >= 4 || projectedStudents >= 120) {
    return "Large volume";
  }
  return "Multi-camera";
}

function buildWeatherTravelItems(rows: ShootRow[]): WeatherTravelItem[] {
  const items: WeatherTravelItem[] = [];
  for (const row of rows) {
    const driveMinutes = Number(row.estimated_drive_minutes ?? 0);
    const projectedStudents = Number(row.projected_students ?? 0);
    const scheduledEmployees = Number(row.scheduled_employee_count ?? 0);
    const priorityTravelWatch = isBigShootRow(row) && driveMinutes >= 30;
    const longTravelWatch = driveMinutes >= 40;
    const heavierTravelWatch = projectedStudents >= 90 && driveMinutes >= 30;
    if (priorityTravelWatch || longTravelWatch || heavierTravelWatch) {
      const actionNeeded = driveMinutes >= 55 || (isBigShootRow(row) && driveMinutes >= 40);
      items.push({
        shoot_id: row.id,
        shoot_code: row.shoot_code,
        title: row.title,
        location_name: row.location_name,
        time_label: buildTimeLabel(row),
        kind: "travel",
        severity: actionNeeded ? "action_needed" : "heads_up",
        summary: actionNeeded
          ? isBigShootRow(row) || scheduledEmployees >= 4
            ? "Travel pressure could tighten arrival on a priority shoot."
            : "Long travel time could tighten the arrival window."
          : isBigShootRow(row) || heavierTravelWatch
            ? "Travel should be checked early on this higher-pressure shoot."
            : "Travel time is longer than usual."
      });
    }
  }
  return items.slice(0, 4);
}

function buildTimeLabel(row: Pick<ShootRow, "arrival_time" | "start_time" | "end_time_est">) {
  const start = row.start_time ? new Date(row.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD";
  const end = row.end_time_est ? new Date(row.end_time_est).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD";
  return `${start} - ${end}`;
}

function buildWeatherSummaryLine(items: WeatherTravelItem[]) {
  const criticalCount = items.filter((item) => item.severity === "action_needed").length;
  const warningCount = items.filter((item) => item.severity === "heads_up").length;
  if (criticalCount) {
    return `${criticalCount} shoot${criticalCount === 1 ? "" : "s"} may be delayed by weather or travel.`;
  }
  if (warningCount) {
    return `${warningCount} shoot${warningCount === 1 ? "" : "s"} have a manageable travel or weather watch.`;
  }
  return "No weather or travel issues right now.";
}

async function getSafeCustomerServiceSummary(client: PoolClient, auth: AuthUser) {
  try {
    return await getZendeskLeadershipSummary(client, auth);
  } catch {
    return null;
  }
}

function buildCustomerServicePulse(summary: Awaited<ReturnType<typeof getSafeCustomerServiceSummary>>, drilldownEnabled: boolean) {
  if (!summary) {
    return {
      safe_summary: true as const,
      tone: "neutral" as const,
      summary_line: "Customer service signal is unavailable right now.",
      open_tickets: 0,
      urgent_signal_count: 0,
      backlog_count: 0,
      trend_label: "Waiting on support data",
      top_categories: [],
      connected: false,
      drilldown_enabled: false
    };
  }

  const agingRisk = summary.queue_health.aging_buckets.reduce((sum, bucket) => {
    const label = bucket.label.toLowerCase();
    return label.includes("7") || label.includes("14") || label.includes("old") ? sum + bucket.count : sum;
  }, 0);
  const urgentSignalCount = Number(summary.kpis.unassigned_tickets ?? 0) + agingRisk;
  const tone: SeverityTone =
    summary.flags.unusual_ticket_spike || summary.flags.reply_time_degrading
      ? "action_needed"
      : summary.flags.backlog_rising || agingRisk > 0
        ? "heads_up"
        : "good";

  return {
    safe_summary: true as const,
    tone,
    summary_line:
      tone === "good"
        ? "Support looks steady right now."
        : tone === "heads_up"
          ? "Backlog is building, but it still looks manageable."
          : "Customer service needs a closer look today.",
    open_tickets: summary.kpis.open_tickets,
    urgent_signal_count: urgentSignalCount,
    backlog_count: summary.queue_health.total_open,
    trend_label:
      summary.flags.unusual_ticket_spike
        ? "Incoming volume is spiking"
        : summary.flags.reply_time_degrading
          ? "Reply speed is slipping"
          : summary.flags.backlog_rising
            ? "Backlog is trending up"
            : "Nothing urgent in customer service",
    top_categories: summary.category_breakdown.slice(0, 3).map((row) => ({
      label: row.category,
      count: row.open_count
    })),
    connected: summary.connection.connection_status === "connected",
    drilldown_enabled: drilldownEnabled
  };
}

function buildPlacesThatNeedMoreLove(locations: Awaited<ReturnType<typeof listShootLocations>>["locations"], todayRows: ShootRow[]) {
  const todayLocationSet = new Set(
    todayRows
      .map((row) => normalizeText(`${row.location_name} ${row.location_address ?? ""}`))
      .filter(Boolean)
  );

  const scored = locations
    .map((location) => {
      const avgRating = Number(location.stats.avg_rating ?? 4.8);
      const onTime = Number(location.stats.on_time_percent ?? 100);
      const easyAccess = Number(location.stats.easy_access_percent ?? 100);
      const evaluationCount = Number(location.stats.evaluation_count ?? 0);
      const recentImprovement =
        avgRating >= 4.2 && evaluationCount >= 2
          ? "Recent feedback is trending steadier here."
          : null;
      const score =
        Math.max(0, 4.5 - avgRating) * 22 +
        Math.max(0, 90 - onTime) * 0.45 +
        Math.max(0, 88 - easyAccess) * 0.4 +
        (location.latest_recommendation ? 8 : 0);
      return {
        location,
        score,
        recentImprovement,
        theme: classifyLocationTheme(location.latest_recommendation ?? location.commentary ?? location.location_details ?? "")
      };
    })
    .filter((row) => row.score >= 6)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((row) => ({
      location_id: row.location.id,
      name: row.location.name,
      category: row.location.category,
      tone: row.score >= 20 ? ("action_needed" as const) : ("heads_up" as const),
      theme_label: row.theme,
      summary: row.location.latest_recommendation ?? row.location.commentary ?? row.location.location_details ?? "Extra prep helps here.",
      affecting_today: todayLocationSet.has(normalizeText(`${row.location.name} ${row.location.address ?? ""}`)),
      recent_improvement: row.recentImprovement
    }));

  return {
    summary_line: scored.length ? `${scored.length} locations could use extra prep or communication care.` : "No locations need extra love right now.",
    items: scored
  };
}

function classifyLocationTheme(value: string) {
  const text = value.toLowerCase();
  if (text.includes("parking") || text.includes("load") || text.includes("unload")) {
    return "Parking is tricky";
  }
  if (text.includes("access") || text.includes("door") || text.includes("entry")) {
    return "Access is inconsistent";
  }
  if (text.includes("setup") || text.includes("stage") || text.includes("lighting")) {
    return "Setup takes longer";
  }
  if (text.includes("last-minute") || text.includes("change")) {
    return "Frequent last-minute changes";
  }
  return "Extra prep helps here";
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildLaborSnapshot(laborSnapshot: Awaited<ReturnType<typeof getOperationsDashboard>> | null) {
  if (!laborSnapshot || !config.HOME_LABOR_WIDGET_ENABLED) {
    return null;
  }

  const scheduledHours = Number(laborSnapshot.summary.scheduled_labor_hours ?? 0);
  const actualHours = Number(laborSnapshot.summary.actual_labor_hours ?? 0);
  const delta = actualHours - scheduledHours;
  return {
    visible: true,
    public_safe: true as const,
    tone: delta > 2 ? ("heads_up" as const) : ("neutral" as const),
    summary_line:
      scheduledHours === 0 && actualHours === 0
        ? "No labor activity to show."
        : delta > 2
          ? "Labor variance is growing today."
          : "Labor is tracking close to plan.",
    scheduled_hours: scheduledHours,
    actual_hours: actualHours,
    overtime_risk_count: Number(laborSnapshot.summary.overtime_risk_count ?? 0),
    department_rollup: (laborSnapshot.insights?.hours_by_department ?? []).slice(0, 4).map((row) => ({
      label: row.department,
      scheduled_hours: Number(row.scheduled_hours ?? 0),
      actual_hours: Number(row.actual_hours ?? 0)
    })),
    shoot_rollup: (laborSnapshot.insights?.hours_by_shoot ?? []).slice(0, 4).map((row) => ({
      label: row.scope_code,
      scheduled_hours: Number(row.scheduled_hours ?? 0),
      actual_hours: Number(row.actual_hours ?? 0)
    }))
  };
}

function buildCriticalBanner(items: WeatherTravelItem[], tiles: BusinessPulseTile[]) {
  const criticalItems = items.filter((item) => item.severity === "action_needed");
  if (criticalItems.length) {
    const weatherCritical = criticalItems.filter((item) => item.kind === "weather").length;
    const travelCritical = criticalItems.filter((item) => item.kind === "travel").length;
    return {
      tone: "action_needed" as const,
      label: "Weather and Travel Watch",
      message:
        weatherCritical && travelCritical
          ? `Weather or travel pressure could affect ${criticalItems.length} ${criticalItems.length === 1 ? "shoot" : "shoots"} today.`
          : weatherCritical
            ? `Weather may affect ${weatherCritical} ${weatherCritical === 1 ? "shoot" : "shoots"} today.`
            : `Travel pressure could affect ${travelCritical} ${travelCritical === 1 ? "shoot" : "shoots"} today.`
    };
  }
  const jobsTile = tiles.find((tile) => tile.id === "jobs_needing_attention");
  if (jobsTile && jobsTile.value > 0 && jobsTile.tone === "action_needed") {
    return {
      tone: "action_needed" as const,
      label: "Business Pulse",
      message: `${jobsTile.value} jobs need extra attention today.`
    };
  }
  const queueTile = tiles.find((tile) => tile.id === "id_cards_to_print");
  if (queueTile && queueTile.tone === "action_needed") {
    return {
      tone: "heads_up" as const,
      label: "Production Queue",
      message: "ID card queue is heavy today."
    };
  }
  return null;
}

function toneWeight(value: SeverityTone) {
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

function buildUrgentWatch(input: {
  todayPreviews: TodayShootPreview[];
  weatherTravelItems: WeatherTravelItem[];
  customerPulse: HomeDashboardResponse["widgets"]["customer_service_pulse"];
  places: HomeDashboardResponse["widgets"]["places_that_need_more_love"];
  labor: HomeDashboardResponse["widgets"]["labor_snapshot_today"];
  attendanceAwareness: HomeDashboardResponse["widgets"]["attendance_awareness"];
  productionProjects: Awaited<ReturnType<typeof getProductionProjectHomeSnapshot>>;
}) {
  const items: UrgentWatchItem[] = [];
  const pushItem = (item: UrgentWatchItem) => {
    if (!items.some((entry) => entry.id === item.id)) {
      items.push(item);
    }
  };

  const readyConfirmationGap = [...input.todayPreviews]
    .filter((shoot) => !shoot.lead_confirmed_ready && shoot.ready_to_shoot_status === "escalation_due")
    .sort(compareTodayPreviewUrgency)[0];

  if (readyConfirmationGap) {
    pushItem({
      id: `shoot:${readyConfirmationGap.id}`,
      kind: "shoot",
      kind_label: "Lead ready",
      title: `${readyConfirmationGap.title} still needs Ready to Shoot`,
      summary: "Lead confirmation is still missing as start time approaches.",
      supporting_label: buildUrgentShootSupportingLabel(readyConfirmationGap),
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open shoot workspace",
      action_hash: `#operations/shoots?shoot=${readyConfirmationGap.id}`,
      shoot_id: readyConfirmationGap.id,
      location_id: null,
      project_id: null
    });
  }

  const highestRiskShoot = [...input.todayPreviews]
    .filter(
      (shoot) =>
        shoot.phase === "needs_attention" ||
        shoot.attention_tone === "action_needed" ||
        shoot.status_tone === "action_needed" ||
        shoot.sync_tone === "action_needed"
    )
    .sort(compareTodayPreviewUrgency)[0];

  if (highestRiskShoot) {
    pushItem({
      id: `shoot:${highestRiskShoot.id}`,
      kind: "shoot",
      kind_label: "Shoot risk",
      title: highestRiskShoot.title,
      summary: highestRiskShoot.attention_label ?? highestRiskShoot.next_action,
      supporting_label: buildUrgentShootSupportingLabel(highestRiskShoot),
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open shoot workspace",
      action_hash: `#operations/shoots?shoot=${highestRiskShoot.id}`,
      shoot_id: highestRiskShoot.id,
      location_id: null,
      project_id: null
    });
  }

  for (const weatherItem of input.weatherTravelItems.filter((item) => item.severity === "action_needed" || item.severity === "heads_up").slice(0, 2)) {
    pushItem({
      id: `shoot:${weatherItem.shoot_id}`,
      kind: weatherItem.kind,
      kind_label: weatherItem.kind === "weather" ? "Weather watch" : "Travel watch",
      title: weatherItem.title,
      summary: weatherItem.summary,
      supporting_label: `${weatherItem.location_name} | ${weatherItem.time_label}`,
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open shoot workspace",
      action_hash: `#operations/shoots?shoot=${weatherItem.shoot_id}`,
      shoot_id: weatherItem.shoot_id,
      location_id: null,
      project_id: null
    });
  }

  if (input.customerPulse.urgent_signal_count > 0 || input.customerPulse.tone === "action_needed") {
    pushItem({
      id: "customer-service",
      kind: "customer_service",
      kind_label: "Support",
      title: "Customer Service",
      summary: input.customerPulse.summary_line,
      supporting_label: `${input.customerPulse.urgent_signal_count} urgent | ${input.customerPulse.backlog_count} backlog`,
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open Customer Service Metrics",
      action_hash: "#reports/customer-service",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  const locationItem = [...input.places.items]
    .filter((item) => item.affecting_today && (item.tone === "action_needed" || item.tone === "heads_up"))
    .sort((left, right) => toneWeight(right.tone) - toneWeight(left.tone))[0];

  if (locationItem) {
    pushItem({
      id: `location:${locationItem.location_id}`,
      kind: "location",
      kind_label: "Location",
      title: locationItem.name,
      summary: locationItem.summary,
      supporting_label: "Affects today",
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open Location Record",
      action_hash: `#directory/locations?location=${locationItem.location_id}&tab=relationships`,
      shoot_id: null,
      location_id: locationItem.location_id,
      project_id: null
    });
  }

  if (
    input.labor?.visible &&
    (input.labor.overtime_risk_count > 0 || input.labor.tone === "heads_up" || input.labor.tone === "action_needed")
  ) {
    pushItem({
      id: "labor",
      kind: "labor",
      kind_label: "Labor",
      title: "Today's Labor",
      summary: input.labor.summary_line,
      supporting_label: `${input.labor.overtime_risk_count} OT risk`,
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open Labor",
      action_hash: "#labor",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  if (input.attendanceAwareness.summary.probable_no_show_count > 0) {
    pushItem({
      id: "attendance-probable-no-show",
      kind: "attendance",
      kind_label: "Attendance",
      title:
        input.attendanceAwareness.summary.probable_no_show_count === 1
          ? "1 probable no-show needs intervention"
          : `${input.attendanceAwareness.summary.probable_no_show_count} probable no-shows need intervention`,
      summary: summarizeAttendanceUrgency(
        input.attendanceAwareness.probable_no_show.items,
        "Probable no-shows are now putting same-day coverage at risk."
      ),
      supporting_label: summarizeAttendanceNames(input.attendanceAwareness.probable_no_show.items),
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Review attendance",
      action_hash: "#operations/attendance",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  if (input.attendanceAwareness.summary.missing_clock_in_count > 0) {
    pushItem({
      id: "attendance-missing-clock-in",
      kind: "attendance",
      kind_label: "Attendance",
      title:
        input.attendanceAwareness.summary.missing_clock_in_count === 1
          ? "1 clock-in is still missing"
          : `${input.attendanceAwareness.summary.missing_clock_in_count} clock-ins are still missing`,
      summary: summarizeAttendanceUrgency(
        input.attendanceAwareness.missing_clock_in.items,
        "Clock-ins are still missing for work that has already started."
      ),
      supporting_label: summarizeAttendanceNames(input.attendanceAwareness.missing_clock_in.items),
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Review attendance",
      action_hash: "#operations/attendance",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  if (input.attendanceAwareness.summary.critically_late_count > 0) {
    pushItem({
      id: "attendance-critically-late",
      kind: "attendance",
      kind_label: "Attendance",
      title:
        input.attendanceAwareness.summary.critically_late_count === 1
          ? "1 critically late arrival needs review"
          : `${input.attendanceAwareness.summary.critically_late_count} critically late arrivals need review`,
      summary: summarizeAttendanceUrgency(
        input.attendanceAwareness.critically_late.items,
        "Critically late arrivals could break same-day coverage."
      ),
      supporting_label: summarizeAttendanceNames(input.attendanceAwareness.critically_late.items),
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Open attendance",
      action_hash: "#operations/attendance",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  if (input.attendanceAwareness.summary.wrong_location_count > 0) {
    pushItem({
      id: "attendance-wrong-location",
      kind: "attendance",
      kind_label: "Attendance",
      title:
        input.attendanceAwareness.summary.wrong_location_count === 1
          ? "1 person may be at the wrong location"
          : `${input.attendanceAwareness.summary.wrong_location_count} people may be at the wrong location`,
      summary: summarizeAttendanceUrgency(
        input.attendanceAwareness.wrong_location.items,
        "Location mismatches need review before they create field delays."
      ),
      supporting_label: summarizeAttendanceNames(input.attendanceAwareness.wrong_location.items),
      tone: "action_needed",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Review attendance",
      action_hash: "#operations/attendance",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  if (input.attendanceAwareness.summary.late_count > 0) {
    pushItem({
      id: "attendance-late",
      kind: "attendance",
      kind_label: "Attendance",
      title:
        input.attendanceAwareness.summary.late_count === 1
          ? "1 late arrival needs review"
          : `${input.attendanceAwareness.summary.late_count} late arrivals need review`,
      summary: summarizeAttendanceUrgency(
        input.attendanceAwareness.late.items,
        "Late arrivals need review before they turn into same-day staffing problems."
      ),
      supporting_label: summarizeAttendanceNames(input.attendanceAwareness.late.items),
      tone: "heads_up",
      urgency_state: "action_needed_today",
      urgency_label: "Action needed today",
      action_label: "Review attendance",
      action_hash: "#operations/attendance",
      shoot_id: null,
      location_id: null,
      project_id: null
    });
  }

  for (const projectItem of input.productionProjects.urgent_items) {
    pushItem({
      id: `project:${projectItem.project_id}`,
      kind: "project",
      kind_label: "Project",
      title: projectItem.title,
      summary: projectItem.summary,
      supporting_label: [projectItem.stage_label, projectItem.owner_label, projectItem.due_label].filter(Boolean).join(" | "),
      tone: "action_needed",
      urgency_state: projectItem.urgency_state,
      urgency_label: projectItem.urgency_label,
      action_label: "Open production item",
      action_hash: projectItem.action_hash,
      shoot_id: null,
      location_id: null,
      project_id: projectItem.project_id
    });
  }

  const sortedItems = items.sort(compareUrgentWatchItems).slice(0, 5);

  return {
    visible: sortedItems.length > 0,
    tone: deriveUrgentWatchTone(sortedItems),
    summary_line: buildUrgentWatchSummaryLine(sortedItems),
    items: sortedItems
  };
}

function summarizeAttendanceNames(items: AttendanceAwarenessEntry[]) {
  if (!items.length) {
    return null;
  }
  const names = items.slice(0, 2).map((item) => item.employee_name);
  if (items.length > 2) {
    return `${names.join(", ")} +${items.length - 2} more`;
  }
  return names.join(", ");
}

function summarizeAttendanceUrgency(items: AttendanceAwarenessEntry[], fallback: string) {
  if (!items.length) {
    return fallback;
  }
  const leadItem = items[0];
  return leadItem.secondary_label
    ? `${leadItem.employee_name}: ${leadItem.secondary_label}`
    : fallback;
}

function buildUrgentShootSupportingLabel(shoot: TodayShootPreview) {
  const timing = buildTimeLabel({
    arrival_time: shoot.arrival_time,
    start_time: shoot.start_time,
    end_time_est: shoot.end_time_est
  });
  const locationLabel = shoot.location_name || shortenAddress(shoot.location_address);
  return `${timing} | ${locationLabel}`;
}

function mapUrgentWatchHomeItem(item: Awaited<ReturnType<typeof getUrgentWatchHomeSummary>>["items"][number]): UrgentWatchItem {
  const sourceSnapshot = item.source_snapshot ?? {};
  const shootId = typeof sourceSnapshot.shoot_id === "string" ? sourceSnapshot.shoot_id : null;
  const locationId = typeof sourceSnapshot.location_id === "string" ? sourceSnapshot.location_id : null;
  const projectId = typeof sourceSnapshot.project_id === "string" ? sourceSnapshot.project_id : null;

  return {
    id: item.id,
    kind:
      item.source_module === "scheduling"
        ? "scheduling"
        : item.source_module === "approvals"
          ? "approval"
          : item.source_module === "production"
            ? "project"
            : "attendance",
    kind_label: item.source_module_label,
    title: item.title,
    summary: item.summary,
    supporting_label:
      [item.owner_label !== "Needs owner" ? item.owner_label : null, item.source_entity_label, item.status_detail].filter(Boolean).join(" | ") ||
      null,
    tone: item.severity === "red" ? "action_needed" : "heads_up",
    urgency_state:
      item.timing_state === "overdue"
        ? "overdue"
        : item.timing_state === "due_within_24h"
          ? "action_needed_today"
          : "at_risk",
    urgency_label: item.timing_label,
    action_label: item.next_action_label,
    action_hash: item.action_hash,
    shoot_id: shootId,
    location_id: locationId,
    project_id: projectId
  };
}

function compareTodayPreviewUrgency(left: TodayShootPreview, right: TodayShootPreview) {
  const toneDelta = toneWeight(right.attention_tone ?? right.status_tone) - toneWeight(left.attention_tone ?? left.status_tone);
  if (toneDelta !== 0) {
    return toneDelta;
  }
  const importanceDelta = importanceRank(right.priority_label) - importanceRank(left.priority_label);
  if (importanceDelta !== 0) {
    return importanceDelta;
  }
  const leftTime = new Date(left.start_time ?? left.arrival_time ?? `${left.shoot_date ?? formatDateOnly(new Date())}T23:59:00`).getTime();
  const rightTime = new Date(right.start_time ?? right.arrival_time ?? `${right.shoot_date ?? formatDateOnly(new Date())}T23:59:00`).getTime();
  return leftTime - rightTime;
}

function compareUrgentWatchItems(left: UrgentWatchItem, right: UrgentWatchItem) {
  const urgencyDelta = urgentWatchWeight(right.urgency_state) - urgentWatchWeight(left.urgency_state);
  if (urgencyDelta !== 0) {
    return urgencyDelta;
  }
  return left.title.localeCompare(right.title);
}

function buildUrgentWatchSummaryLine(items: UrgentWatchItem[]) {
  if (!items.length) {
    return "No open exceptions are due in the next 24 hours.";
  }
  const overdueCount = items.filter((item) => item.urgency_state === "overdue").length;
  const todayCount = items.filter((item) => item.urgency_state === "action_needed_today").length;
  const dueSoonCount = items.filter((item) => item.urgency_state === "due_within_24h").length;
  const atRiskCount = items.filter((item) => item.urgency_state === "at_risk").length;

  if (overdueCount > 0) {
    const remaining = todayCount + dueSoonCount;
    return remaining > 0
      ? `${overdueCount} overdue item${overdueCount === 1 ? "" : "s"} and ${remaining} more need action now.`
      : `${overdueCount} overdue item${overdueCount === 1 ? "" : "s"} need action now.`;
  }
  if (todayCount > 0) {
    return dueSoonCount > 0
      ? `${todayCount} item${todayCount === 1 ? "" : "s"} need action today, with ${dueSoonCount} more due within 24 hours.`
      : `${todayCount} item${todayCount === 1 ? "" : "s"} need action today.`;
  }
  if (atRiskCount > 0) {
    return `${atRiskCount} item${atRiskCount === 1 ? "" : "s"} are at risk and need follow-through before they turn red.`;
  }
  return `${dueSoonCount} item${dueSoonCount === 1 ? "" : "s"} are due within the next 24 hours.`;
}

function deriveUrgentWatchTone(items: UrgentWatchItem[]): SeverityTone {
  if (items.some((item) => item.urgency_state === "overdue" || item.urgency_state === "action_needed_today")) {
    return "action_needed";
  }
  if (items.some((item) => item.urgency_state === "due_within_24h" || item.urgency_state === "at_risk")) {
    return "heads_up";
  }
  return "neutral";
}

function urgentWatchWeight(state: UrgentWatchState) {
  if (state === "overdue") {
    return 3;
  }
  if (state === "action_needed_today") {
    return 2;
  }
  if (state === "due_within_24h") {
    return 1;
  }
  return 0;
}

function shortenAddress(value?: string | null) {
  if (!value) {
    return "Location pending";
  }
  return value.split(",").slice(0, 2).join(", ");
}

