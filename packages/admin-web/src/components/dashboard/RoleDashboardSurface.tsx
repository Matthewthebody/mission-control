import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { DashboardLeadershipSurface } from "../DashboardLeadershipSurface";
import { DashboardStaffingSurface } from "../DashboardStaffingSurface";
import { DashboardWorkflowSurface } from "../DashboardWorkflowSurface";
import { HomePulseSurface } from "../HomePulseSurface";
import { ManagerCockpitSurface } from "../ManagerCockpitSurface";
import { OperationalDetailSection } from "../OperationalDetailSection";
import { MobileMissionControl } from "./MobileMissionControl";
import {
  DASHBOARD_QUICK_ACTIONS,
  DASHBOARD_ROLE_LAYOUTS,
  DASHBOARD_WIDGET_DEFINITIONS,
  type DashboardLayoutSection,
  type DashboardLayoutWidgetPlacement,
  type DashboardQuickActionDefinition,
  type DashboardRoleLayout,
  type DashboardScopeId,
  type DashboardWidgetDataSourceKey,
  type DashboardWidgetDefinition,
  type DashboardWidgetId,
  type DashboardWidgetSize
} from "./dashboardConfig";
import {
  getDashboardWidgetContentSpec,
  type DashboardWidgetActionSpec,
  type DashboardWidgetContentSpec,
  type DashboardWidgetStateSpec
} from "./dashboardContent";
import {
  canAccessEmployeeMyWork,
  getPrimaryBusinessRole,
  hasBusinessRole,
  hasCapability,
  type BusinessRole
} from "../../permissions";
import {
  getFreshnessStatus,
  isDashboardWidgetCollapsed,
  loadDashboardPreferences,
  resolveDashboardScope,
  saveDashboardPreferences,
  setDashboardRoleScopePreference,
  setDashboardWidgetCollapsedPreference,
  trackDashboardEvent,
  type DashboardPreferences
} from "./dashboardRuntime";
import {
  fetchEmployeeMyWork,
  type EmployeeMyWorkResponse,
  type EmployeeShiftPreview
} from "../../services/employeeExperience";
import { getHomeDashboard } from "../../services/homeDashboard";
import { listProductionProjects, type ProductionProjectBoardFilters } from "../../services/productionProjects";
import { getSalesPipelineBoard } from "../../services/salesPipelineApi";
import { getZendeskLeadershipSummary } from "../../services/customerServiceApi";
import { getSecurityOverview } from "../../services/securityApi";
import type {
  HomeDashboardResponse,
  ProductionProjectBoardResponse,
  SecurityOverview,
  SessionUser,
  ZendeskLeadershipSummary
} from "../../types";
import type { SalesOpportunitySummary, SalesPipelineBoardView } from "../../salesPipelineTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

type DashboardDataState<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  loadedAt: number | null;
};

type DashboardActivityItem = {
  id: string;
  title: string;
  detail: string;
  meta?: string;
  hash?: string;
};

type DashboardAlertTone = "info" | "warning" | "critical";

type DashboardAlertItem = {
  id: string;
  title: string;
  detail: string;
  meta?: string;
  tone: DashboardAlertTone;
};

type DashboardContext = {
  currentUser: SessionUser;
  token: string;
  socket: Socket | null;
  role: BusinessRole;
  layout: DashboardRoleLayout;
  scope: DashboardScopeId | null;
  anchorDate: string;
  refreshKey: number;
  requestRefresh: (source?: string) => void;
  preferences: DashboardPreferences;
  persistWidgetCollapse: (widgetId: DashboardWidgetId, collapsed: boolean) => void;
  visibleQuickActions: DashboardQuickActionDefinition[];
  isNarrowLayout: boolean;
  currentFreshnessLabel: string | null;
  employeeState: DashboardDataState<EmployeeMyWorkResponse>;
  productionState: DashboardDataState<ProductionProjectBoardResponse>;
  salesState: DashboardDataState<SalesPipelineBoardView>;
  serviceState: DashboardDataState<ZendeskLeadershipSummary>;
  securityState: DashboardDataState<SecurityOverview>;
};

type ResolvedDashboardWidget = DashboardWidgetDefinition & {
  contentSpec: DashboardWidgetContentSpec;
  title: string;
  subtitle?: string;
  sizeHint: DashboardWidgetSize;
  priorityRank: number;
  defaultCollapsed: boolean;
  hideWhenEmpty: boolean;
};

type DashboardCardAction = {
  label: string;
  onClick: () => void;
};

const EMPLOYEE_WIDGETS = new Set<DashboardWidgetId>([
  "employee-day",
  "employee-schedule",
  "employee-alerts",
  "employee-follow-through",
  "employee-gear",
  "field-readiness",
  "field-travel",
  "recent-activity"
]);

const PRODUCTION_WIDGETS = new Set<DashboardWidgetId>(["production-queue", "production-qa-release", "recent-activity"]);
const SALES_WIDGETS = new Set<DashboardWidgetId>(["sales-pipeline", "sales-deadlines", "recent-activity"]);
const CUSTOMER_SERVICE_WIDGETS = new Set<DashboardWidgetId>(["service-summary", "service-metrics", "recent-activity"]);
const SECURITY_WIDGETS = new Set<DashboardWidgetId>(["admin-system-health", "admin-audit-watch", "recent-activity"]);
const DashboardRuntimeContext = createContext<DashboardContext | null>(null);

export function RoleDashboardSurface({ token, currentUser, socket }: Props) {
  const role = getPrimaryBusinessRole(currentUser);
  const layout = DASHBOARD_ROLE_LAYOUTS[role];
  const [anchorDate, setAnchorDate] = useState(getLocalDateString());
  const [refreshKey, setRefreshKey] = useState(0);
  const [isNarrowLayout, setIsNarrowLayout] = useState(() => matchesNarrowDashboardLayout());
  const [preferences, setPreferences] = useState<DashboardPreferences>(() => loadDashboardPreferences(currentUser.id));
  const [employeeState, setEmployeeState] = useState<DashboardDataState<EmployeeMyWorkResponse>>({
    data: null,
    loading: false,
    error: "",
    loadedAt: null
  });
  const [productionState, setProductionState] = useState<DashboardDataState<ProductionProjectBoardResponse>>({
    data: null,
    loading: false,
    error: "",
    loadedAt: null
  });
  const [homeState, setHomeState] = useState<DashboardDataState<HomeDashboardResponse>>({
    data: null,
    loading: false,
    error: "",
    loadedAt: null
  });
  const [salesState, setSalesState] = useState<DashboardDataState<SalesPipelineBoardView>>({
    data: null,
    loading: false,
    error: "",
    loadedAt: null
  });
  const [serviceState, setServiceState] = useState<DashboardDataState<ZendeskLeadershipSummary>>({
    data: null,
    loading: false,
    error: "",
    loadedAt: null
  });
  const [securityState, setSecurityState] = useState<DashboardDataState<SecurityOverview>>({
    data: null,
    loading: false,
    error: "",
    loadedAt: null
  });
  const trackedLayoutSignatureRef = useRef("");

  useEffect(() => {
    setPreferences(loadDashboardPreferences(currentUser.id));
  }, [currentUser.id]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
    };
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsNarrowLayout(event.matches);
    };

    handleChange(mediaQuery);

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    legacyMediaQuery.addListener?.(handleChange);
    return () => legacyMediaQuery.removeListener?.(handleChange);
  }, []);

  const plannedSections = useMemo(
    () =>
      layout.sections
        .map((section) => ({
          ...section,
        widgets: section.widgets
            .map((placement) => resolveWidgetPlacement(placement, role))
            .filter((definition) => canRenderWidget(currentUser, role, definition))
            .sort((left, right) => left.priorityRank - right.priorityRank)
        }))
        .filter((section) => section.widgets.length > 0),
    [currentUser, layout.sections, role]
  );

  const plannedWidgetIds = useMemo(
    () => plannedSections.flatMap((section) => section.widgets.map((widget) => widget.id)),
    [plannedSections]
  );

  const availableScopeOptions = useMemo(
    () =>
      (layout.scopeSelectorSupport ?? [])
        .map((scopeId) => resolveDashboardScope(role, [scopeId], currentUser, preferences))
        .filter((scope): scope is NonNullable<typeof scope> => Boolean(scope)),
    [currentUser, layout.scopeSelectorSupport, preferences, role]
  );

  const selectedScope = useMemo(
    () => resolveDashboardScope(role, layout.scopeSelectorSupport ?? [], currentUser, preferences),
    [currentUser, layout.scopeSelectorSupport, preferences, role]
  );

  const visibleQuickActions = useMemo(
    () =>
      layout.quickActionIds
        .map((actionId) => DASHBOARD_QUICK_ACTIONS[actionId])
        .filter((action) => canUseQuickAction(currentUser, role, action))
        .slice(0, isNarrowLayout ? 3 : 4),
    [currentUser, isNarrowLayout, layout.quickActionIds, role]
  );

  const needsEmployeeData = useMemo(
    () =>
      plannedWidgetIds.some((widgetId) => EMPLOYEE_WIDGETS.has(widgetId)) &&
      (canAccessEmployeeMyWork(currentUser) || hasBusinessRole(currentUser, ["employee", "photographer", "shoot_lead"])),
    [plannedWidgetIds, currentUser]
  );
  const needsProductionData = useMemo(() => plannedWidgetIds.some((widgetId) => PRODUCTION_WIDGETS.has(widgetId)), [plannedWidgetIds]);
  const needsHomeData = isNarrowLayout && role === "manager";
  const needsSalesData = useMemo(() => plannedWidgetIds.some((widgetId) => SALES_WIDGETS.has(widgetId)), [plannedWidgetIds]);
  const needsServiceData = useMemo(() => plannedWidgetIds.some((widgetId) => CUSTOMER_SERVICE_WIDGETS.has(widgetId)), [plannedWidgetIds]);
  const needsSecurityData = useMemo(() => plannedWidgetIds.some((widgetId) => SECURITY_WIDGETS.has(widgetId)), [plannedWidgetIds]);
  const showAnchorDate = role !== "manager" && role !== "leadership" && role !== "admin";

  useEffect(() => {
    let cancelled = false;

    if (!needsEmployeeData) {
      setEmployeeState({ data: null, loading: false, error: "", loadedAt: null });
    } else {
      setEmployeeState((current) => ({ ...current, loading: true, error: "" }));
      void fetchEmployeeMyWork(token, anchorDate)
        .then((data) => {
          if (!cancelled) {
            setEmployeeState({ data, loading: false, error: "", loadedAt: Date.now() });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setEmployeeState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : "We couldn't load your dashboard work right now."
            }));
          }
        });
    }

    if (!needsProductionData) {
      setProductionState({ data: null, loading: false, error: "", loadedAt: null });
    } else {
      const filters: ProductionProjectBoardFilters = {
        anchorDate,
        owner_user_id: currentUser.id,
        queue: role === "production_staff" ? "my_queue" : "all",
        status: "open"
      };
      setProductionState((current) => ({ ...current, loading: true, error: "" }));
      void listProductionProjects(token, filters)
        .then((data) => {
          if (!cancelled) {
            setProductionState({ data, loading: false, error: "", loadedAt: Date.now() });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setProductionState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : "We couldn't load production work right now."
            }));
          }
        });
    }

    if (!needsHomeData) {
      setHomeState({ data: null, loading: false, error: "", loadedAt: null });
    } else {
      setHomeState((current) => ({ ...current, loading: true, error: "" }));
      void getHomeDashboard(token, "app")
        .then((data) => {
          if (!cancelled) {
            setHomeState({ data, loading: false, error: "", loadedAt: Date.now() });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setHomeState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : "We couldn't load Home right now."
            }));
          }
        });
    }

    if (!needsSalesData) {
      setSalesState({ data: null, loading: false, error: "", loadedAt: null });
    } else {
      setSalesState((current) => ({ ...current, loading: true, error: "" }));
      void getSalesPipelineBoard(token, { ownerId: selectedScope?.id === "me" ? currentUser.id : null })
        .then((data) => {
          if (!cancelled) {
            setSalesState({ data, loading: false, error: "", loadedAt: Date.now() });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSalesState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : "We couldn't load the sales dashboard right now."
            }));
          }
        });
    }

    if (!needsServiceData) {
      setServiceState({ data: null, loading: false, error: "", loadedAt: null });
    } else {
      setServiceState((current) => ({ ...current, loading: true, error: "" }));
      void getZendeskLeadershipSummary(token)
        .then((data) => {
          if (!cancelled) {
            setServiceState({ data, loading: false, error: "", loadedAt: Date.now() });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setServiceState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : "We couldn't load service summary data right now."
            }));
          }
        });
    }

    if (!needsSecurityData) {
      setSecurityState({ data: null, loading: false, error: "", loadedAt: null });
    } else {
      setSecurityState((current) => ({ ...current, loading: true, error: "" }));
      void getSecurityOverview(token)
        .then((data) => {
          if (!cancelled) {
            setSecurityState({ data, loading: false, error: "", loadedAt: Date.now() });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSecurityState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : "We couldn't load system health right now."
            }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [anchorDate, currentUser, needsEmployeeData, needsHomeData, needsProductionData, needsSalesData, needsSecurityData, needsServiceData, refreshKey, role, selectedScope?.id, token]);

  useEffect(() => {
    if (!socket || !needsEmployeeData) {
      return;
    }

    const onRefresh = () => {
      requestRefresh("socket");
    };

    socket.on("schedule_changed", onRefresh);
    socket.on("attendance_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("attendance_changed", onRefresh);
      socket.off("notification_created", onRefresh);
    };
  }, [needsEmployeeData, socket]);

  function persistPreferences(nextPreferences: DashboardPreferences) {
    setPreferences(nextPreferences);
    saveDashboardPreferences(currentUser.id, nextPreferences);
  }

  function requestRefresh(source: string = "manual") {
    trackDashboardEvent({
      event: "refresh_requested",
      role,
      scope: selectedScope?.id,
      source
    });
    setRefreshKey((value) => value + 1);
  }

  const context: DashboardContext = {
    currentUser,
    token,
    socket,
    role,
    layout,
    scope: selectedScope?.id ?? null,
    anchorDate,
    refreshKey,
    requestRefresh,
    preferences,
    persistWidgetCollapse: (widgetId, collapsed) => {
      const nextPreferences = setDashboardWidgetCollapsedPreference(preferences, widgetId, collapsed);
      persistPreferences(nextPreferences);
      trackDashboardEvent({
        event: "widget_toggle",
        role,
        widgetId,
        scope: selectedScope?.id,
        source: collapsed ? "collapsed" : "expanded"
      });
    },
    visibleQuickActions,
    isNarrowLayout,
    currentFreshnessLabel: null,
    employeeState,
    productionState,
    salesState,
    serviceState,
    securityState
  };

  const visibleSections = useMemo(
    () =>
      plannedSections
        .map((section) => ({
          ...section,
          widgets: section.widgets.filter((widget) => shouldShowWidget(widget, context))
        }))
        .filter((section) => section.widgets.length > 0),
    [context, plannedSections]
  );

  const dashboardFreshness = useMemo(() => {
    const visibleStates = visibleSections
      .flatMap((section) => section.widgets)
      .map((widget) => getDashboardDataStateForWidget(widget.dataSourceKey, context))
      .filter((state): state is DashboardDataState<unknown> => Boolean(state && state.loadedAt));

    if (!visibleStates.length) {
      return null;
    }

    const freshestLoadedAt = Math.max(...visibleStates.map((state) => state.loadedAt ?? 0));
    return getFreshnessStatus(freshestLoadedAt, 15);
  }, [context, visibleSections]);

  const enrichedContext: DashboardContext = {
    ...context,
    currentFreshnessLabel: dashboardFreshness?.label ?? null
  };

  useEffect(() => {
    const visibleWidgets = visibleSections.flatMap((section) => section.widgets);
    const signature = `${role}:${selectedScope?.id ?? "none"}:${refreshKey}:${visibleWidgets.map((widget) => widget.id).join(",")}`;
    if (trackedLayoutSignatureRef.current === signature) {
      return;
    }
    trackedLayoutSignatureRef.current = signature;

    trackDashboardEvent({
      event: "layout_shown",
      role,
      scope: selectedScope?.id,
      source: layout.title
    });

    visibleWidgets.forEach((widget) => {
      trackDashboardEvent({
        event: "widget_impression",
        role,
        widgetId: widget.id,
        analyticsId: widget.analyticsId,
        scope: selectedScope?.id
      });
    });
  }, [layout.title, refreshKey, role, selectedScope?.id, visibleSections]);

  if (shouldUseMobileMissionControl(role, isNarrowLayout)) {
    return (
      <DashboardRuntimeContext.Provider value={enrichedContext}>
        <MobileMissionControl
          role={role}
          currentUser={currentUser}
          anchorDate={anchorDate}
          refreshLabel={enrichedContext.currentFreshnessLabel}
          onRefresh={() => requestRefresh("button")}
          employeeState={employeeState}
          productionState={productionState}
          homeState={homeState}
          visibleQuickActions={visibleQuickActions}
        />
      </DashboardRuntimeContext.Provider>
    );
  }

  return (
    <DashboardRuntimeContext.Provider value={enrichedContext}>
      <div className="role-dashboard-shell">
      <section className="page-intro page-intro--compact">
        <div>
          <div className="eyebrow">{layout.eyebrow}</div>
          <h2>{layout.title}</h2>
          <p>{layout.summary}</p>
          <div className="role-dashboard-frame-meta" aria-label="Dashboard context">
            <span className="metric-pill">{formatDashboardDate(anchorDate)}</span>
            {dashboardFreshness ? (
              <span className={`metric-pill${dashboardFreshness.stale ? " metric-pill--warning" : ""}`}>{dashboardFreshness.label}</span>
            ) : null}
            {selectedScope ? <span className="metric-pill">{selectedScope.label} Scope</span> : null}
          </div>
        </div>
        <div className="page-intro-actions">
          <span className="metric-pill">{currentUser.fullName}</span>
          <span className="metric-pill">{formatRoleLabel(role)}</span>
          {availableScopeOptions.length > 1 && selectedScope ? (
            <label className="filter-field">
              <span>Scope</span>
              <select
                aria-label="Dashboard scope"
                value={selectedScope.id}
                onChange={(event) => {
                  const nextScope = event.target.value as DashboardScopeId;
                  const nextPreferences = setDashboardRoleScopePreference(preferences, role, nextScope);
                  persistPreferences(nextPreferences);
                  trackDashboardEvent({
                    event: "scope_changed",
                    role,
                    scope: nextScope
                  });
                  requestRefresh("scope");
                }}
              >
                {availableScopeOptions.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scope.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showAnchorDate ? (
            <label className="filter-field">
              <span>Anchor Date</span>
              <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
            </label>
          ) : null}
          <button className="secondary-button" onClick={() => requestRefresh("button")}>
            Refresh
          </button>
        </div>
      </section>

        {visibleSections.map((section) => (
        <section key={section.id} className={`role-dashboard-section role-dashboard-section--${section.id}`}>
          {section.id !== "hero" ? (
            <div className="role-dashboard-section__header">
              <div className="eyebrow">{section.label}</div>
            </div>
          ) : null}
          <div className={`role-dashboard-grid role-dashboard-grid--${section.id}`}>
            {section.widgets.map((widget) => (
              <div key={widget.id} className={`role-dashboard-slot role-dashboard-slot--${widget.sizeHint}`}>
                {renderDashboardWidget(widget, enrichedContext)}
              </div>
            ))}
          </div>
        </section>
        ))}
      </div>
    </DashboardRuntimeContext.Provider>
  );
}

function canRenderWidget(user: SessionUser, role: BusinessRole, widget: DashboardWidgetDefinition) {
  if (!widget.supportedRoles.includes(role)) {
    return false;
  }
  if (!widget.requiredCapabilities?.length) {
    return true;
  }
  return widget.requiredCapabilities.every((capability) => hasCapability(user, capability));
}

function canUseQuickAction(user: SessionUser, role: BusinessRole, action: DashboardQuickActionDefinition) {
  if (!action.supportedRoles.includes(role)) {
    return false;
  }
  if (!action.requiredCapabilities?.length) {
    return true;
  }
  return action.requiredCapabilities.every((capability) => hasCapability(user, capability));
}

function resolveWidgetPlacement(placement: DashboardLayoutWidgetPlacement, role: BusinessRole): ResolvedDashboardWidget {
  const widget = DASHBOARD_WIDGET_DEFINITIONS[placement.widgetId];
  const contentSpec = getDashboardWidgetContentSpec(placement.widgetId, role);
  return {
    ...widget,
    contentSpec,
    title: placement.title ?? contentSpec.title ?? widget.title,
    subtitle: placement.subtitle ?? contentSpec.subtitle ?? widget.subtitle,
    sizeHint: placement.sizeHint ?? widget.sizeHint,
    priorityRank: placement.priorityRank ?? widget.defaultPriorityRank,
    defaultCollapsed: placement.defaultCollapsed ?? widget.defaultCollapsed,
    hideWhenEmpty: placement.hideWhenEmpty ?? false
  };
}

function shouldShowWidget(widget: ResolvedDashboardWidget, context: DashboardContext) {
  if (!widget.hideWhenEmpty) {
    return true;
  }

  switch (widget.id) {
    case "employee-alerts":
      return context.employeeState.loading || Boolean(context.employeeState.error) || buildEmployeeAlertItems(context.employeeState.data).length > 0;
    case "recent-activity":
      return buildRecentActivityItems(context).length > 0;
    default:
      return true;
  }
}

function getWidgetBadgeText(widget: ResolvedDashboardWidget, context: DashboardContext) {
  switch (widget.id) {
    case "employee-alerts": {
      const count = buildEmployeeAlertItems(context.employeeState.data).length;
      return count ? `${count} open` : null;
    }
    case "employee-schedule": {
      const count = context.employeeState.data?.shifts.length ?? 0;
      return count ? `${count} today` : null;
    }
    case "employee-follow-through": {
      const summary = context.employeeState.data?.summary;
      if (!summary) {
        return null;
      }
      const total = summary.pending_trade_requests + summary.mileage_review_count + summary.closeout_due_count;
      return total ? `${total} due` : null;
    }
    case "production-qa-release": {
      const board = context.productionState.data?.summary;
      if (!board) {
        return null;
      }
      const total = board.jobs_in_qa + board.ready_to_release + board.blocked;
      return total ? `${total} waiting` : null;
    }
    case "service-summary": {
      const count = context.serviceState.data?.kpis.open_tickets ?? 0;
      return count ? `${count} open` : null;
    }
    case "sales-deadlines": {
      const count = context.salesState.data?.automation_alerts.length ?? 0;
      return count ? `${count} due` : null;
    }
    case "admin-audit-watch": {
      const count = context.securityState.data?.recent_dangerous_actions.length ?? 0;
      return count ? `${count} recent` : null;
    }
    case "recent-activity": {
      const count = buildRecentActivityItems(context).length;
      return count ? `${count} recent` : null;
    }
    default:
      return null;
  }
}

function buildCardAction(
  spec: DashboardWidgetActionSpec | undefined,
  fallbackHash?: string,
  analytics?: {
    role: BusinessRole;
    widgetId?: DashboardWidgetId;
    analyticsId?: string;
    scope?: DashboardScopeId | null;
    source?: string;
  }
): DashboardCardAction | undefined {
  if (!spec?.label) {
    return undefined;
  }

  const target = spec.hash ?? fallbackHash;
  return {
    label: spec.label,
    onClick: () => {
      if (analytics) {
        trackDashboardEvent({
          event: "widget_cta_clicked",
          role: analytics.role,
          widgetId: analytics.widgetId,
          analyticsId: analytics.analyticsId,
          scope: analytics.scope ?? undefined,
          actionLabel: spec.label,
          source: analytics.source
        });
      }
      openWidgetTarget(target);
    }
  };
}

function openWidgetTarget(target?: string) {
  if (!target) {
    return;
  }

  if (/^https?:\/\//i.test(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }

  navigateToHash(target);
}

function getWidgetPrimaryAction(widget: ResolvedDashboardWidget, context: DashboardContext) {
  return buildCardAction(widget.contentSpec.primaryCta, widget.destinationHash, {
    role: context.role,
    widgetId: widget.id,
    analyticsId: widget.analyticsId,
    scope: context.scope,
    source: "primary"
  });
}

function getWidgetSecondaryAction(widget: ResolvedDashboardWidget, context: DashboardContext) {
  return buildCardAction(widget.contentSpec.secondaryCta, undefined, {
    role: context.role,
    widgetId: widget.id,
    analyticsId: widget.analyticsId,
    scope: context.scope,
    source: "secondary"
  });
}

function renderDashboardWidget(widget: ResolvedDashboardWidget, context: DashboardContext) {
  switch (widget.id) {
    case "employee-day":
      return <EmployeeDayWidget widget={widget} context={context} />;
    case "employee-schedule":
      return <EmployeeScheduleWidget widget={widget} context={context} />;
    case "employee-alerts":
      return <EmployeeAlertsWidget widget={widget} context={context} />;
    case "employee-follow-through":
      return <EmployeeFollowThroughWidget widget={widget} context={context} />;
    case "employee-gear":
      return <AssignedGearWidget widget={widget} context={context} />;
    case "field-readiness":
      return <FieldReadinessWidget widget={widget} context={context} />;
    case "field-travel":
      return <FieldTravelWidget widget={widget} context={context} />;
    case "field-exceptions":
      return <DashboardWorkflowSurface token={context.token} currentUser={context.currentUser} key={`field-exceptions-${context.refreshKey}`} />;
    case "production-queue":
      return <ProductionQueueWidget widget={widget} context={context} />;
    case "production-qa-release":
      return <ProductionQaReleaseWidget widget={widget} context={context} />;
    case "service-summary":
      return <CustomerServiceSummaryWidget widget={widget} context={context} />;
    case "service-metrics":
      return <CustomerServiceMetricsWidget widget={widget} context={context} />;
    case "sales-pipeline":
      return <SalesPipelineWidget widget={widget} context={context} />;
    case "sales-deadlines":
      return <SalesDeadlinesWidget widget={widget} context={context} />;
    case "manager-workflow":
      return <DashboardWorkflowSurface token={context.token} currentUser={context.currentUser} key={`workflow-${context.refreshKey}`} />;
    case "manager-cockpit":
      return <ManagerCockpitSurface token={context.token} currentUser={context.currentUser} key={`cockpit-${context.refreshKey}`} />;
    case "leadership-home-pulse":
      return <HomePulseSurface token={context.token} currentUser={context.currentUser} socket={context.socket} surfaceMode="dashboard" showIntro={false} key={`home-pulse-${context.refreshKey}`} />;
    case "leadership-workflow":
      return <DashboardWorkflowSurface token={context.token} currentUser={context.currentUser} key={`leadership-workflow-${context.refreshKey}`} />;
    case "leadership-cockpit":
      return <ManagerCockpitSurface token={context.token} currentUser={context.currentUser} key={`leadership-cockpit-${context.refreshKey}`} />;
    case "leadership-readiness":
      return <DashboardLeadershipSurface token={context.token} key={`leadership-readiness-${context.refreshKey}`} />;
    case "leadership-staffing":
      return (
        <OperationalDetailSection
          title="Staffing Command"
          summary="Fast assignment triage for leadership. Expand when you need coverage posture, lead gaps, and availability detail."
          compact
        >
          <DashboardStaffingSurface
            token={context.token}
            currentUser={context.currentUser}
            showHeader={false}
            key={`leadership-staffing-${context.refreshKey}`}
          />
        </OperationalDetailSection>
      );
    case "admin-system-health":
      return <AdminSystemHealthWidget widget={widget} context={context} />;
    case "admin-audit-watch":
      return <AdminAuditWatchWidget widget={widget} context={context} />;
    case "quick-actions":
      return <QuickActionsWidget widget={widget} context={context} />;
    case "recent-activity":
      return <RecentActivityWidget widget={widget} context={context} />;
    default:
      return null;
  }
}

function EmployeeDayWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const payload = context.employeeState.data;
  const stateNode = renderAsyncWidgetState(widget, context.employeeState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const secondaryAction = getWidgetSecondaryAction(widget, context);
  const sortedShifts = payload ? sortShiftsByStart(payload.shifts) : [];
  const nextShift = payload ? getNextShift(sortedShifts) : null;
  const secondShift = sortedShifts[1] ?? null;
  const priorityNote = payload ? buildEmployeeDayPriorityNote(payload, nextShift) : null;

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!payload) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{buildEmployeeDayPrimaryLine(payload, nextShift)}</strong>
        <p>{nextShift ? `${buildShiftLabel(nextShift)} | ${nextShift.location_name ?? nextShift.location_address ?? "Location pending"}` : "Check your schedule for future assignments and requests."}</p>
      </div>
      <div className="dashboard-summary-list">
        {nextShift ? (
          <DashboardSummaryRow
            label="Next Item"
            value={formatShortTimeRange(nextShift.starts_at, nextShift.ends_at)}
            detail={`${buildShiftLabel(nextShift)}${nextShift.location_name ? ` | ${nextShift.location_name}` : ""}`}
          />
        ) : null}
        {secondShift ? (
          <DashboardSummaryRow
            label="After That"
            value={formatShortTimeRange(secondShift.starts_at, secondShift.ends_at)}
            detail={`${buildShiftLabel(secondShift)}${secondShift.location_name ? ` | ${secondShift.location_name}` : ""}`}
          />
        ) : null}
        {priorityNote ? <DashboardSummaryRow label={priorityNote.label} value={priorityNote.value} detail={priorityNote.detail} /> : null}
      </div>
    </DashboardCard>
  );
}

function EmployeeScheduleWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const payload = context.employeeState.data;
  const stateNode = renderAsyncWidgetState(widget, context.employeeState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const shifts = payload ? sortShiftsByStart(payload.shifts).slice(0, 4) : [];
  const nextShift = shifts[0] ?? null;

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!shifts.length) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
      {nextShift ? (
        <div className="role-dashboard-hero-copy">
          <strong>{`${formatShortTimeRange(nextShift.starts_at, nextShift.ends_at)} | ${buildShiftLabel(nextShift)}`}</strong>
          <p>{nextShift.location_name ?? nextShift.location_address ?? "Location pending"}</p>
        </div>
      ) : null}
      <div className="role-dashboard-list">
        {shifts.slice(0, 3).map((shift) => (
          <button key={shift.id} type="button" className="role-dashboard-list-item" onClick={() => navigateToHash("#dashboard/my-day")}>
            <div>
              <strong>{buildShiftLabel(shift)}</strong>
              <div className="muted">{shift.location_name ?? shift.location_address ?? "Location pending"}</div>
            </div>
            <div className="role-dashboard-list-item__meta">
              <span>{formatShortTimeRange(shift.starts_at, shift.ends_at)}</span>
              <span>{shift.status === "published" ? "Published" : humanizeLabel(shift.status)}</span>
            </div>
          </button>
        ))}
      </div>
    </DashboardCard>
  );
}

function EmployeeAlertsWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const items = context.employeeState.data ? buildEmployeeAlertItems(context.employeeState.data) : [];
  const stateNode = renderAsyncWidgetState(widget, context.employeeState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!items.length) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{formatCountLine(items.length, "item needs attention", "items need attention")}</strong>
        <p>Review the alerts that could change timing, readiness, or follow-through.</p>
      </div>
      <div className="role-dashboard-alert-stack">
        {items.slice(0, 3).map((item) => (
          <article key={item.id} className={`role-dashboard-alert role-dashboard-alert--${item.tone}`}>
            <div className="role-dashboard-inline-head">
              <strong>{item.title}</strong>
              <span className={`home-tone-chip home-tone-chip--${item.tone}`}>{toneLabel(item.tone)}</span>
            </div>
            <p>{item.detail}</p>
            {item.meta ? <span className="muted">{item.meta}</span> : null}
          </article>
        ))}
      </div>
    </DashboardCard>
  );
}

function EmployeeFollowThroughWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const payload = context.employeeState.data;
  const stateNode = renderAsyncWidgetState(widget, context.employeeState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const secondaryAction = getWidgetSecondaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!payload) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  const totalDue = payload.summary.pending_trade_requests + payload.summary.mileage_review_count + payload.summary.closeout_due_count;

  if (!totalDue) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{formatCountLine(totalDue, "item needs attention", "items need attention")}</strong>
        <p>{payload.summary.mileage_review_count ? "Mileage, closeout, or requests still need follow-through." : "Close out the remaining work before the day is done."}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardSummaryRow label="Trade Requests" value={payload.summary.pending_trade_requests} detail={payload.summary.pending_trade_requests ? "Waiting on review or response." : "No open trade requests."} />
        <DashboardSummaryRow label="Mileage" value={payload.summary.mileage_review_count} detail={payload.summary.mileage_review_count ? "Mileage needs review." : "Mileage is clear right now."} />
        <DashboardSummaryRow label="Closeout" value={payload.summary.closeout_due_count} detail={payload.summary.closeout_due_count ? "Post-shoot follow-through is still open." : "Closeout looks clean right now."} />
      </div>
    </DashboardCard>
  );
}

function FieldReadinessWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const payload = context.employeeState.data;
  const stateNode = renderAsyncWidgetState(widget, context.employeeState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const nextShift = payload ? getNextShift(payload.shifts) : null;
  const readinessRows = nextShift ? buildReadinessRows(nextShift) : [];

  if (stateNode) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!nextShift) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{buildReadinessHeadline(nextShift)}</strong>
        <p>{buildShiftLabel(nextShift)}</p>
      </div>
      <div className="dashboard-summary-list">
        {readinessRows.map((row) => (
          <DashboardSummaryRow key={row.label} label={row.label} value={row.value} detail={row.detail} />
        ))}
      </div>
    </DashboardCard>
  );
}

function FieldTravelWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const payload = context.employeeState.data;
  const nextShift = payload ? getNextShift(payload.shifts) : null;
  const stateNode = renderAsyncWidgetState(widget, context.employeeState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const secondaryAction = nextShift?.navigation_url
    ? buildCardAction({ label: "Open Directions", hash: nextShift.navigation_url }, undefined, {
        role: context.role,
        widgetId: widget.id,
        analyticsId: widget.analyticsId,
        scope: context.scope,
        source: "directions"
      })
    : getWidgetSecondaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!nextShift) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} primaryAction={primaryAction} secondaryAction={secondaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{nextShift.location_name ?? "Location pending"}</strong>
        <p>{buildShiftLabel(nextShift)}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardSummaryRow label="Address" value={nextShift.location_address ?? "Pending"} detail="Next location" />
        <DashboardSummaryRow label="Call Time" value={formatTimeOnly(nextShift.starts_at)} detail="Arrival window" />
        <DashboardSummaryRow label="Travel Note" value={nextShift.navigation_url ? "Directions ready" : "No new travel note"} detail={nextShift.note_summary ?? "Use location details for parking and check-in context."} />
      </div>
    </DashboardCard>
  );
}

function AssignedGearWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  return (
    <DashboardCard widget={widget} primaryAction={getWidgetPrimaryAction(widget, context)} context={context}>
      <WidgetEmptyState spec={widget.contentSpec} />
    </DashboardCard>
  );
}

function ProductionQueueWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const board = context.productionState.data;
  const items = board ? flattenProductionItems(board).slice(0, 3) : [];
  const stateNode = renderAsyncWidgetState(widget, context.productionState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!board || !items.length) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{`${board.summary.open_projects} active jobs, ${countProductionDueToday(board)} due today`}</strong>
        <p>{items[0]?.next_action ?? "Open your queue to review the next production step."}</p>
      </div>
      <div className="role-dashboard-list">
        {items.map((item) => (
          <button key={item.id} type="button" className="role-dashboard-list-item" onClick={() => navigateToHash(`#production?project=${item.id}`)}>
            <div>
              <strong>{item.title}</strong>
              <div className="muted">{item.next_action}</div>
            </div>
            <div className="role-dashboard-list-item__meta">
              <span>{item.stage_label}</span>
              <span>{item.due_label ?? "No due date"}</span>
            </div>
          </button>
        ))}
      </div>
    </DashboardCard>
  );
}

function ProductionQaReleaseWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const board = context.productionState.data;
  const blockers = board
    ? flattenProductionItems(board)
        .filter((item) => item.stage === "ready_for_qa" || item.stage === "correction_needed" || item.stage === "ready_to_release")
        .slice(0, 4)
    : [];
  const stateNode = renderAsyncWidgetState(widget, context.productionState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const secondaryAction = getWidgetSecondaryAction(widget, context);
  const waitingCount = board ? board.summary.jobs_in_qa + board.summary.ready_to_release + board.summary.blocked : 0;

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!board || !waitingCount) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{formatCountLine(waitingCount, "job is waiting on QA or release", "jobs are waiting on QA or release")}</strong>
        <p>{blockers[0]?.next_action ?? "Open QA to clear the next blocker."}</p>
      </div>
      <div className="role-dashboard-list">
        {blockers.slice(0, 3).map((item) => (
          <button key={item.id} type="button" className="role-dashboard-list-item" onClick={() => navigateToHash(`#production?project=${item.id}`)}>
            <div>
              <strong>{item.title}</strong>
              <div className="muted">{item.next_action}</div>
            </div>
            <div className="role-dashboard-list-item__meta">
              <span className={`home-tone-chip home-tone-chip--${item.status_tone}`}>{item.stage_label}</span>
              <span>{item.due_label ?? "Needs review"}</span>
            </div>
          </button>
        ))}
      </div>
    </DashboardCard>
  );
}

function CustomerServiceSummaryWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const summary = context.serviceState.data;
  const stateNode = renderAsyncWidgetState(widget, context.serviceState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!summary) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{`${summary.kpis.open_tickets} open tickets`}</strong>
        <p>{buildServiceFlagSummary(summary)}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardSummaryRow label="Unassigned" value={summary.kpis.unassigned_tickets} detail={summary.kpis.unassigned_tickets ? "Need ownership now." : "All tickets have owners."} />
        <DashboardSummaryRow label="Oldest Open" value={`${summary.kpis.oldest_open_tickets}d`} detail="Longest-open ticket age" />
        <DashboardSummaryRow label="New This Week" value={summary.kpis.new_tickets_this_week} detail="Incoming volume this week" />
      </div>
    </DashboardCard>
  );
}

function CustomerServiceMetricsWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const summary = context.serviceState.data;
  const stateNode = renderAsyncWidgetState(widget, context.serviceState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!summary) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{summary.flags.reply_time_degrading ? "Support needs attention" : "Support looks stable"}</strong>
        <p>{buildServiceFlagSummary(summary)}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardSummaryRow label="First Reply" value={formatDurationMinutes(summary.kpis.median_first_reply_minutes)} detail="Median first reply time" />
        <DashboardSummaryRow label="Resolution" value={formatDurationMinutes(summary.kpis.median_resolution_minutes)} detail="Median resolution time" />
        <DashboardSummaryRow label="Backlog Change" value={formatSignedDelta(summary.comparisons.open_backlog_change)} detail="Week over week" />
      </div>
    </DashboardCard>
  );
}

function SalesPipelineWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const board = context.salesState.data;
  const stateNode = renderAsyncWidgetState(widget, context.salesState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const actionableOpportunities = board ? flattenSalesOpportunities(board).filter((item) => item.next_action_overdue || item.next_action_missing || item.open_alert_count > 0 || item.follow_up_date).slice(0, 3) : [];

  if (stateNode) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!board) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>
          {formatCountLine(
            board.summary.overdue_next_actions || actionableOpportunities.length,
            context.scope === "company" ? "company opportunity needs action" : "opportunity needs action",
            context.scope === "company" ? "company opportunities need action" : "opportunities need action"
          )}
        </strong>
        <p>
          {board.automation_alerts.length
            ? `${board.automation_alerts.length} ${context.scope === "company" ? "company-wide " : ""}deadline or follow-up alerts are open.`
            : "Pipeline momentum looks steady right now."}
        </p>
      </div>
      {actionableOpportunities.length ? (
        <div className="role-dashboard-list">
          {actionableOpportunities.map((item) => (
            <button key={item.id} type="button" className="role-dashboard-list-item" onClick={() => navigateToHash("#growth/pipeline")}>
              <div>
                <strong>{item.organization_display_name}</strong>
                <div className="muted">{buildOpportunityActionDetail(item)}</div>
              </div>
              <div className="role-dashboard-list-item__meta">
                <span>{item.follow_up_date ? `Due ${formatShortDate(item.follow_up_date)}` : "Needs follow-up"}</span>
                <span>{humanizeLabel(item.stage)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <WidgetEmptyState spec={widget.contentSpec} />
      )}
    </DashboardCard>
  );
}

function SalesDeadlinesWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const board = context.salesState.data;
  const alerts = board?.automation_alerts.slice(0, 4) ?? [];
  const stateNode = renderAsyncWidgetState(widget, context.salesState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const secondaryAction = getWidgetSecondaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!board || !alerts.length) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction} secondaryAction={secondaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{formatCountLine(alerts.length, "deadline needs attention", "deadlines need attention")}</strong>
        <p>{alerts[0]?.title ?? `Review the next ${context.scope === "company" ? "company" : "team"} renewal or proposal deadline.`}</p>
      </div>
      <div className="role-dashboard-alert-stack">
        {alerts.slice(0, 3).map((alert) => (
          <article key={alert.id} className={`role-dashboard-alert role-dashboard-alert--${mapAlertTone(alert.severity)}`}>
            <div className="role-dashboard-inline-head">
              <strong>{alert.title}</strong>
              <span className={`home-tone-chip home-tone-chip--${mapAlertTone(alert.severity)}`}>{severityLabel(alert.severity)}</span>
            </div>
            <p>{alert.message}</p>
            {alert.due_at ? <span className="muted">Due {formatShortDate(alert.due_at)}</span> : null}
          </article>
        ))}
      </div>
    </DashboardCard>
  );
}

function AdminSystemHealthWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const overview = context.securityState.data;
  const stateNode = renderAsyncWidgetState(widget, context.securityState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);
  const secondaryAction = getWidgetSecondaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!overview) {
    return (
      <DashboardCard widget={widget} primaryAction={primaryAction} secondaryAction={secondaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} primaryAction={primaryAction} secondaryAction={secondaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{buildSystemHealthHeadline(overview)}</strong>
        <p>{overview.active_break_glass_count ? `${overview.active_break_glass_count} break-glass session${overview.active_break_glass_count === 1 ? "" : "s"} still active.` : "No active break-glass sessions are open right now."}</p>
      </div>
      <div className="dashboard-summary-list">
        <DashboardSummaryRow label="Pending Approvals" value={overview.pending_approval_count} detail="Security approvals waiting" />
        <DashboardSummaryRow label="Break-Glass" value={overview.active_break_glass_count} detail="Active emergency sessions" />
        <DashboardSummaryRow label="Dangerous Actions" value={overview.recent_dangerous_actions.length} detail="Recent high-risk changes" />
      </div>
    </DashboardCard>
  );
}

function AdminAuditWatchWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const overview = context.securityState.data;
  const actions = overview?.recent_dangerous_actions.slice(0, 4) ?? [];
  const stateNode = renderAsyncWidgetState(widget, context.securityState, context);
  const primaryAction = getWidgetPrimaryAction(widget, context);

  if (stateNode) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        {stateNode}
      </DashboardCard>
    );
  }

  if (!actions.length) {
    return (
      <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
        <WidgetEmptyState spec={widget.contentSpec} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
      <div className="role-dashboard-hero-copy">
        <strong>{formatCountLine(actions.length, "item needs review", "items need review")}</strong>
        <p>{actions[0]?.reason ?? "Open Audit Controls to review the latest high-risk change."}</p>
      </div>
      <div className="role-dashboard-list">
        {actions.slice(0, 3).map((action) => (
          <button key={action.id} type="button" className="role-dashboard-list-item" onClick={() => navigateToHash("#admin/audit")}>
            <div>
              <strong>{humanizeLabel(action.action_code)}</strong>
              <div className="muted">{action.reason ?? `${action.entity_type} change from ${action.source_module}`}</div>
            </div>
            <div className="role-dashboard-list-item__meta">
              <span>{action.actor_name ?? "Unknown actor"}</span>
              <span>{formatShortDateTime(action.created_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </DashboardCard>
  );
}

function QuickActionsWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const fallbackActions = getFallbackQuickActions(context.role);
  const actions = context.visibleQuickActions.length ? context.visibleQuickActions : fallbackActions;

  return (
    <DashboardCard widget={widget}>
      {actions.length ? (
        <div className="role-dashboard-quick-actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="role-dashboard-quick-action"
              onClick={() => {
                trackDashboardEvent({
                  event: "quick_action_clicked",
                  role: context.role,
                  widgetId: widget.id,
                  analyticsId: widget.analyticsId,
                  actionId: action.id,
                  actionLabel: action.label,
                  scope: context.scope ?? undefined
                });
                navigateToHash(action.hash);
              }}
            >
              <strong>{action.label}</strong>
            </button>
          ))}
        </div>
      ) : (
        <WidgetEmptyState spec={widget.contentSpec} showAction />
      )}
    </DashboardCard>
  );
}

function RecentActivityWidget({ widget, context }: { widget: ResolvedDashboardWidget; context: DashboardContext }) {
  const items = buildRecentActivityItems(context).slice(0, 5);
  const primaryAction = getWidgetPrimaryAction(widget, context);

  return (
    <DashboardCard widget={widget} badge={getWidgetBadgeText(widget, context)} primaryAction={primaryAction}>
      {items.length ? (
        <div className="role-dashboard-list">
          {items.slice(0, 4).map((item) => (
            <button key={item.id} type="button" className="role-dashboard-list-item" onClick={() => navigateToHash(item.hash ?? widget.destinationHash)}>
              <div>
                <strong>{item.title}</strong>
                <div className="muted">{item.detail}</div>
              </div>
              <div className="role-dashboard-list-item__meta">{item.meta ? <span>{item.meta}</span> : null}</div>
            </button>
          ))}
        </div>
      ) : (
        <WidgetEmptyState spec={widget.contentSpec} />
      )}
    </DashboardCard>
  );
}

function getDashboardDataStateForWidget(
  dataSourceKey: DashboardWidgetDataSourceKey | undefined,
  context: DashboardContext
): DashboardDataState<unknown> | null {
  switch (dataSourceKey) {
    case "employee":
      return context.employeeState;
    case "production":
      return context.productionState;
    case "sales":
      return context.salesState;
    case "service":
      return context.serviceState;
    case "security":
      return context.securityState;
    default:
      return null;
  }
}

function getWidgetFreshness(widget: ResolvedDashboardWidget, context: DashboardContext) {
  return getFreshnessStatus(
    getDashboardDataStateForWidget(widget.dataSourceKey, context)?.loadedAt ?? null,
    widget.freshnessWindowMinutes ?? 15
  );
}

function getWidgetRecoveredError(widget: ResolvedDashboardWidget, context: DashboardContext) {
  const state = getDashboardDataStateForWidget(widget.dataSourceKey, context);
  if (!state?.data || !state.error) {
    return "";
  }
  return "Showing the last successful update. Refresh to try again.";
}

function useDashboardRuntime(explicitContext?: DashboardContext) {
  const runtimeContext = useContext(DashboardRuntimeContext);
  return explicitContext ?? runtimeContext;
}

function DashboardCard({
  widget,
  children,
  badge,
  context,
  primaryAction,
  secondaryAction
}: {
  widget: ResolvedDashboardWidget;
  children: ReactNode;
  badge?: string | null;
  context?: DashboardContext;
  primaryAction?: DashboardCardAction;
  secondaryAction?: DashboardCardAction;
}) {
  const runtimeContext = useDashboardRuntime(context);
  const headingId = useId();
  const contentId = useId();
  const recoveredError = runtimeContext ? getWidgetRecoveredError(widget, runtimeContext) : "";
  const freshness = runtimeContext ? getWidgetFreshness(widget, runtimeContext) : null;
  const scopeTag = runtimeContext?.scope && widget.supportedScopes?.includes(runtimeContext.scope) ? formatScopeLabel(runtimeContext.scope) : null;
  const [expanded, setExpanded] = useState(() =>
    runtimeContext ? !isDashboardWidgetCollapsed(runtimeContext.preferences, widget.id, widget.defaultCollapsed) : !widget.defaultCollapsed
  );

  useEffect(() => {
    if (!runtimeContext) {
      setExpanded(!widget.defaultCollapsed);
      return;
    }

    setExpanded(!isDashboardWidgetCollapsed(runtimeContext.preferences, widget.id, widget.defaultCollapsed));
  }, [runtimeContext?.preferences, widget.defaultCollapsed, widget.id]);

  function toggleExpanded() {
    setExpanded((current) => {
      const nextExpanded = !current;
      runtimeContext?.persistWidgetCollapse(widget.id, !nextExpanded);
      return nextExpanded;
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`panel dashboard-panel dashboard-panel--compact role-dashboard-card role-dashboard-card--${widget.sizeHint}${
        widget.defaultCollapsed ? " role-dashboard-card--collapsible" : ""
      }${freshness?.stale ? " role-dashboard-card--stale" : ""}`}
    >
      <div className="dashboard-panel__header">
        <div>
          <div className="eyebrow">{formatCategoryLabel(widget.category)}</div>
          <h3 id={headingId} className="section-title">
            {widget.title}
          </h3>
          {widget.subtitle ? <p className="section-subtitle">{widget.subtitle}</p> : null}
        </div>
        <div className="role-dashboard-card__actions">
          {scopeTag ? <span className="role-dashboard-badge role-dashboard-badge--subtle">{scopeTag}</span> : null}
          {freshness ? (
            <span className={`role-dashboard-badge${freshness.stale ? " role-dashboard-badge--warning" : " role-dashboard-badge--subtle"}`}>
              {freshness.label}
            </span>
          ) : null}
          {badge ? <span className="role-dashboard-badge">{badge}</span> : null}
          {widget.defaultCollapsed ? (
            <button
              type="button"
              className="secondary-button"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={toggleExpanded}
            >
              {expanded ? "Hide Details" : "Show Details"}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" className="secondary-button" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          ) : null}
          {primaryAction ? (
            <button type="button" className="secondary-button" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      </div>
      {recoveredError ? <div className="role-dashboard-card__notice">{recoveredError}</div> : null}
      <div id={contentId}>{expanded ? children : <div className="role-dashboard-card__preview">{widget.collapsedPreview ?? "Expand for more detail."}</div>}</div>
    </section>
  );
}

function DashboardSummaryRow({
  label,
  value,
  detail
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="dashboard-summary-row">
      <div>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
      </div>
      <span className="muted">{detail}</span>
    </div>
  );
}

function renderAsyncWidgetState<T>(widget: ResolvedDashboardWidget, state: DashboardDataState<T>, context: DashboardContext) {
  if (state.loading && !state.data) {
    return <WidgetLoadingState spec={widget.contentSpec} />;
  }

  if (state.error && !state.data) {
    return <WidgetErrorState spec={widget.contentSpec} onRetry={() => context.requestRefresh("retry")} errorMessage={state.error} />;
  }

  return null;
}

function WidgetLoadingState({ spec }: { spec: DashboardWidgetContentSpec }) {
  return (
    <div className={`role-dashboard-state role-dashboard-state--loading role-dashboard-state--${spec.loadingState.variant}`} role="status" aria-live="polite">
      <span className="muted">{spec.loadingState.message}</span>
      <div className="role-dashboard-skeleton" aria-hidden="true">
        {Array.from({ length: spec.loadingState.rowCount }).map((_, index) => (
          <span
            key={`${spec.widgetId}-skeleton-${index}`}
            className={`role-dashboard-skeleton__line${index === 0 && spec.loadingState.variant === "hero" ? " role-dashboard-skeleton__line--primary" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function WidgetErrorState({
  spec,
  onRetry,
  errorMessage
}: {
  spec: DashboardWidgetContentSpec;
  onRetry: () => void;
  errorMessage?: string;
}) {
  const runtimeContext = useDashboardRuntime();
  const secondaryAction = buildCardAction(spec.errorState.secondaryAction);

  useEffect(() => {
    if (!runtimeContext) {
      return;
    }
    trackDashboardEvent({
      event: "widget_error",
      role: runtimeContext.role,
      widgetId: spec.widgetId,
      analyticsId: spec.widgetId,
      scope: runtimeContext.scope ?? undefined,
      error: errorMessage ?? spec.errorState.message
    });
  }, [errorMessage, runtimeContext?.role, runtimeContext?.scope, spec.errorState.message, spec.widgetId]);

  return (
    <div className="error-banner role-dashboard-state role-dashboard-state--error" role="status" aria-live="polite">
      <span>{spec.errorState.message}</span>
      {spec.errorState.detail ? <span className="muted">{spec.errorState.detail}</span> : null}
      <div className="role-dashboard-state__actions">
        <button type="button" className="secondary-button" onClick={onRetry}>
          {spec.errorState.action.label}
        </button>
        {secondaryAction ? (
          <button type="button" className="secondary-button" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function WidgetEmptyState({
  spec,
  state,
  showAction = false
}: {
  spec: DashboardWidgetContentSpec;
  state?: DashboardWidgetStateSpec;
  showAction?: boolean;
}) {
  const runtimeContext = useDashboardRuntime();
  const resolvedState = state ?? spec.emptyState;
  const primaryAction = showAction ? buildCardAction(resolvedState.action) : undefined;
  const secondaryAction = showAction ? buildCardAction(resolvedState.secondaryAction) : undefined;

  useEffect(() => {
    if (!runtimeContext) {
      return;
    }
    trackDashboardEvent({
      event: "widget_empty",
      role: runtimeContext.role,
      widgetId: spec.widgetId,
      analyticsId: spec.widgetId,
      scope: runtimeContext.scope ?? undefined
    });
  }, [runtimeContext?.role, runtimeContext?.scope, spec.widgetId]);

  return (
    <div className="empty-state empty-state--panel role-dashboard-empty-state role-dashboard-state" role="status" aria-live="polite">
      <span>{resolvedState.message}</span>
      {resolvedState.detail ? <span className="muted">{resolvedState.detail}</span> : null}
      {primaryAction || secondaryAction ? (
        <div className="role-dashboard-state__actions">
          {primaryAction ? (
            <button type="button" className="secondary-button" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" className="secondary-button" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function sortShiftsByStart(shifts: EmployeeShiftPreview[]) {
  return [...shifts].sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

function buildShiftLabel(shift: EmployeeShiftPreview) {
  return shift.shoot_code ?? shift.shoot_title ?? shift.title;
}

function formatCountLine(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildEmployeeDayPrimaryLine(payload: EmployeeMyWorkResponse, nextShift: EmployeeShiftPreview | null) {
  if (payload.summary.shifts_today > 0 && nextShift) {
    return `${formatCountLine(payload.summary.shifts_today, "shift today", "shifts today")}, first call ${formatTimeOnly(nextShift.starts_at)}`;
  }

  if (payload.summary.attention_needed_count > 0) {
    return `${formatCountLine(payload.summary.attention_needed_count, "item needs attention", "items need attention")} today`;
  }

  return "Nothing scheduled today";
}

function buildEmployeeDayPriorityNote(payload: EmployeeMyWorkResponse, nextShift: EmployeeShiftPreview | null) {
  if (payload.summary.attention_needed_count > 0) {
    return {
      label: "At Risk",
      value: formatCountLine(payload.summary.attention_needed_count, "item", "items"),
      detail: nextShift?.mileage_issue_label ?? nextShift?.follow_through_label ?? "Something in today's work still needs attention."
    };
  }

  if (payload.summary.closeout_due_count > 0) {
    return {
      label: "Follow-Through",
      value: formatCountLine(payload.summary.closeout_due_count, "item due", "items due"),
      detail: "Post-shoot closeout is still open."
    };
  }

  return null;
}

function buildReadinessHeadline(shift: EmployeeShiftPreview) {
  if (shift.has_pre_service_notes && !shift.notes_acknowledged) {
    return "Needs attention";
  }

  if (Number(shift.closeout_missing_count ?? 0) > 0 || shift.follow_through_label || shift.mileage_issue_label) {
    return "Missing critical follow-through";
  }

  return "Ready";
}

function buildReadinessRows(shift: EmployeeShiftPreview) {
  return [
    {
      label: "Notes",
      value: shift.has_pre_service_notes && !shift.notes_acknowledged ? "Missing Info" : "Ready",
      detail: shift.note_summary ?? "No pre-service note issues are open."
    },
    {
      label: "Location",
      value: shift.location_name ? "Ready" : "Pending",
      detail: shift.location_name ?? shift.location_address ?? "Location details are still pending."
    },
    {
      label: "Follow-Through",
      value: shift.follow_through_label ?? "Ready",
      detail: shift.follow_through_label ? "This shoot still has a follow-through item." : "No follow-through flags are open."
    },
    {
      label: "Closeout",
      value: Number(shift.closeout_missing_count ?? 0) > 0 ? "Pending" : "Ready",
      detail: Number(shift.closeout_missing_count ?? 0) > 0 ? `${shift.closeout_missing_count} closeout item${shift.closeout_missing_count === 1 ? "" : "s"} still missing.` : "No closeout items are missing."
    }
  ];
}

function countProductionDueToday(board: ProductionProjectBoardResponse) {
  return flattenProductionItems(board).filter((item) => item.due_date === board.anchor_date || item.due_label?.toLowerCase().includes("today")).length;
}

function buildOpportunityActionDetail(item: SalesOpportunitySummary) {
  if (item.next_action_overdue && item.follow_up_date) {
    return `Next step overdue | Due ${formatShortDate(item.follow_up_date)}`;
  }

  if (item.next_action_missing) {
    return "Next step is still missing";
  }

  if (item.follow_up_date) {
    return `Follow up ${formatShortDate(item.follow_up_date)}`;
  }

  return item.primary_contact_name ?? "Contact follow-up is still pending.";
}

function buildSystemHealthHeadline(overview: SecurityOverview) {
  if (overview.active_break_glass_count || overview.pending_break_glass_review_count || overview.recent_dangerous_actions.length) {
    return "Needs attention";
  }

  return "Stable";
}

function toneLabel(value: DashboardAlertTone) {
  if (value === "critical") {
    return "High";
  }

  if (value === "warning") {
    return "Medium";
  }

  return "Low";
}

function severityLabel(value: "warning" | "major" | "critical") {
  if (value === "critical") {
    return "High";
  }

  if (value === "major") {
    return "Medium";
  }

  return "Low";
}

function getFallbackQuickActions(role: BusinessRole) {
  const fallbackActionIds: Record<BusinessRole, DashboardQuickActionDefinition["id"][]> = {
    employee: ["view-my-schedule", "submit-request", "check-training", "open-my-day"],
    photographer: ["open-next-shoot", "view-location-details", "check-readiness", "view-assigned-gear"],
    shoot_lead: ["open-staffing", "resolve-readiness-issue", "open-team-attendance", "view-field-exceptions"],
    production_staff: ["open-my-queue", "view-qa-blockers", "open-release-list", "review-flagged-job"],
    customer_service_staff: ["open-priority-issues", "review-escalations", "view-service-metrics", "open-account-contact"],
    sales_growth_staff: ["open-pipeline", "review-renewals", "open-proposal-deadlines", "view-account-contacts"],
    manager: ["review-approvals", "open-team-schedule", "resolve-exception", "check-team-workload"],
    leadership: ["open-executive-summary", "review-company-alerts", "view-business-health", "check-major-exceptions"],
    admin: ["open-integrations", "review-automation-failures", "check-audit-controls", "manage-permissions"]
  };

  return fallbackActionIds[role].map((actionId) => DASHBOARD_QUICK_ACTIONS[actionId]).filter(Boolean);
}

function buildEmployeeAlertItems(payload: EmployeeMyWorkResponse | null | undefined): DashboardAlertItem[] {
  if (!payload) {
    return [];
  }

  const shiftAlerts = payload.shifts
    .filter(
      (shift) =>
        isAttendanceRisk(shift.attendance_state) ||
        (shift.has_pre_service_notes && !shift.notes_acknowledged) ||
        Number(shift.closeout_missing_count ?? 0) > 0 ||
        Boolean(shift.mileage_issue_label)
    )
    .slice(0, 3)
    .map((shift) => ({
      id: `shift-${shift.id}`,
      title: shift.shoot_code ?? shift.title,
      detail:
        shift.mileage_issue_label ??
        shift.follow_through_label ??
        shift.attendance_state_note ??
        shift.note_summary ??
        "This assignment needs attention before the day is complete.",
      meta: shift.location_name ?? shift.location_address ?? undefined,
      tone: shiftTone(shift)
    }));

  const notifications: DashboardAlertItem[] = payload.notifications.slice(0, 2).map((notification) => ({
    id: notification.id,
    title: notification.title,
    detail: notification.body,
    meta: formatShortDateTime(notification.created_at),
    tone: notification.priority === "critical" ? "critical" : notification.priority === "high" ? "warning" : "info"
  }));

  return [...shiftAlerts, ...notifications].slice(0, 5);
}

function buildRecentActivityItems(context: DashboardContext): DashboardActivityItem[] {
  if (context.employeeState.data) {
    return context.employeeState.data.notifications.slice(0, 5).map((notification) => ({
      id: notification.id,
      title: notification.title,
      detail: notification.body,
      meta: formatShortDateTime(notification.created_at),
      hash: notification.deep_link ?? "#dashboard/alerts"
    }));
  }

  if (context.productionState.data) {
    return flattenProductionItems(context.productionState.data)
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.next_action,
        meta: item.stage_label,
        hash: `#production?project=${item.id}`
      }));
  }

  if (context.salesState.data) {
    return flattenSalesOpportunities(context.salesState.data)
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.organization_display_name,
        detail: `${humanizeLabel(item.stage)} | ${item.primary_contact_name ?? "Contact pending"}`,
        meta: item.follow_up_date ? `Follow up ${formatShortDate(item.follow_up_date)}` : "Next action pending",
        hash: "#growth/pipeline"
      }));
  }

  if (context.serviceState.data) {
    return context.serviceState.data.queue_health.aging_buckets.slice(0, 4).map((bucket) => ({
      id: bucket.label,
      title: bucket.label,
      detail: `${bucket.count} tickets in this aging bucket.`,
      meta: "Queue aging",
      hash: "#reports/customer-service"
    }));
  }

  if (context.securityState.data) {
    return context.securityState.data.recent_dangerous_actions.slice(0, 5).map((action) => ({
      id: action.id,
      title: humanizeLabel(action.action_code),
      detail: action.reason ?? `${action.entity_type} updated from ${action.source_module}.`,
      meta: formatShortDateTime(action.created_at),
      hash: "#admin/audit"
    }));
  }

  return [];
}

function flattenProductionItems(board: ProductionProjectBoardResponse) {
  return board.sections.flatMap((section) => section.items);
}

function flattenSalesOpportunities(board: SalesPipelineBoardView) {
  return board.pipelines.flatMap((pipeline) => [
    ...pipeline.resurfacing_soon,
    ...pipeline.stage_columns.flatMap((column) => column.opportunities)
  ]);
}

function getNextShift(shifts: EmployeeShiftPreview[]) {
  const now = Date.now();
  return [...shifts]
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
    .find((shift) => new Date(shift.ends_at).getTime() >= now) ?? shifts[0] ?? null;
}

function buildServiceFlagSummary(summary: ZendeskLeadershipSummary) {
  const flags: string[] = [];
  if (summary.flags.backlog_rising) {
    flags.push("Backlog rising");
  }
  if (summary.flags.reply_time_degrading) {
    flags.push("Reply time degrading");
  }
  if (summary.flags.unusual_ticket_spike) {
    flags.push("Ticket spike");
  }
  if (!flags.length) {
    return "Support pressure looks steady right now.";
  }
  return flags.join(" | ");
}

function shiftTone(shift: EmployeeShiftPreview): DashboardAlertTone {
  if (isAttendanceRisk(shift.attendance_state) || shift.mileage_issue_label) {
    return "critical";
  }
  if ((shift.has_pre_service_notes && !shift.notes_acknowledged) || Number(shift.closeout_missing_count ?? 0) > 0) {
    return "warning";
  }
  return "info";
}

function isAttendanceRisk(value?: string | null) {
  return ["late_warning", "late", "missed_clock_in", "missed_clock_out", "no_show_suspected"].includes(String(value ?? ""));
}

function mapAlertTone(value: "warning" | "major" | "critical"): DashboardAlertTone {
  if (value === "critical") {
    return "critical";
  }
  if (value === "major") {
    return "warning";
  }
  return "info";
}

function formatRoleLabel(role: BusinessRole) {
  if (role === "shoot_lead") {
    return "Shoot Lead";
  }
  if (role === "production_staff") {
    return "Production Staff";
  }
  if (role === "customer_service_staff") {
    return "Customer Service";
  }
  if (role === "sales_growth_staff") {
    return "Sales / Growth";
  }
  return humanizeLabel(role);
}

function formatCategoryLabel(value: DashboardWidgetDefinition["category"]) {
  const labels: Record<DashboardWidgetDefinition["category"], string> = {
    personal_summary: "Today",
    schedule: "Schedule",
    assignments: "Assignments",
    alerts: "Alerts",
    quick_actions: "Actions",
    readiness: "Readiness",
    travel_location: "Travel",
    gear_assets: "Assets",
    requests_approvals: "Follow-Through",
    queue_workload: "Queue",
    qa_release: "QA",
    review_desk: "Review Desk",
    recent_activity: "Activity",
    metrics_snapshot: "Metrics",
    trend_summary: "Trends",
    pipeline_summary: "Growth",
    executive_health: "Executive",
    system_health: "System"
  };
  return labels[value];
}

function formatScopeLabel(scope: DashboardScopeId) {
  if (scope === "me") {
    return "Me";
  }
  if (scope === "department") {
    return "Department";
  }
  return "Company";
}

function formatDashboardDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function shouldUseMobileMissionControl(role: BusinessRole, isNarrowLayout: boolean) {
  return isNarrowLayout && ["employee", "photographer", "shoot_lead", "production_staff", "manager"].includes(role);
}

function matchesNarrowDashboardLayout() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(max-width: 860px)").matches;
}

function navigateToHash(hash?: string) {
  if (!hash) {
    return;
  }
  window.location.hash = hash;
}

function formatSignedDelta(value: number | null) {
  if (value == null) {
    return "No baseline";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}`;
}

function formatDurationMinutes(value: number | null) {
  if (value == null) {
    return "Pending";
  }
  if (value < 60) {
    return `${Math.round(value)} min`;
  }
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return `${hours}h ${minutes}m`;
}

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatShortTimeRange(startsAt: string, endsAt: string) {
  return `${formatTimeOnly(startsAt)} - ${formatTimeOnly(endsAt)}`;
}

function formatTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getLocalDateString() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
