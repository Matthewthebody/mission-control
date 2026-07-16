import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { MyAccount } from "./pages/MyAccount";
import { ApiClientError, apiFetch } from "./api";
import { clearToken, getToken, setToken } from "./auth";
import { BrandMark } from "./components/BrandMark";
import { CommunicationsLauncher } from "./components/communications/CommunicationsLauncher";
import { ConciergeCommandPalette } from "./components/concierge/ConciergeCommandPalette";
import { GlobalPunchControl } from "./components/GlobalPunchControl";
import { InstallPrompt } from "./components/InstallPrompt";
import type { ReleaseDisciplineSummary } from "./releaseDisciplineTypes";
import { getReleaseDisciplineHealth } from "./services/releaseDisciplineApi";
import { ThemeToggle, type ThemeMode } from "./components/ThemeToggle";
import { buildStandaloneAppUrl, detectTeamsMode, rememberTeamsMode } from "./teamsHost";
import {
  buildShellRouteHash,
  getDefaultRouteId,
  getPrimarySections as getPrimarySectionsFromNavigation,
  getRouteById,
  getSectionChildrenForLanding,
  getSectionDefinition,
  getVisibleChildRoutes,
  getVisibleUtilityRoutes,
  resolveRouteId,
  type ShellRouteId,
  type ShellSection,
  type TabKey
} from "./navigation";
import { AskBaileyProvider, useAskBailey } from "./components/askBailey/AskBaileyLauncher";
import {
  canAccessApprovalsHub,
  canAccessRoute,
  canAccessSection,
  canAccessTab,
  canAccessCanonicalDirectoryWorkspace,
  canAccessComplianceWorkspace,
  canAccessEmployeeMyWork,
  canAccessGearModule,
  canAccessOutlook,
  canAccessSalesPipeline,
  canAccessSecurityCenter,
  canViewAccessDirectory,
  canViewCustomerService,
  canViewLabor,
  canViewLeadershipReports,
  canViewProfitabilityLeadership,
  getDefaultLandingRoute,
  hasPermission,
  shouldLimitToEmployeeWorksurface
} from "./permissions";
import { connectRealtime } from "./realtime";
import type { SessionUser } from "./types";

const LIGHT_THEME_COLOR = "#f4efe6";
const DARK_THEME_COLOR = "#081523";
const HEADER_COLLAPSE_SCROLL_Y = 104;
const HEADER_EXPAND_SCROLL_Y = 36;
const LazyCustomerService = lazy(() =>
  import("./pages/CustomerService").then((module) => ({ default: module.CustomerService }))
);
const LazyAccessControl = lazy(() =>
  import("./pages/AccessControl").then((module) => ({ default: module.AccessControl }))
);
const LazyAdminSettings = lazy(() =>
  import("./pages/AdminSettings").then((module) => ({ default: module.AdminSettings }))
);
const LazySystemDiagnosticsPage = lazy(() =>
  import("./pages/SystemDiagnosticsPage").then((module) => ({ default: module.SystemDiagnosticsPage }))
);
const LazyChecklistTemplatesPage = lazy(() =>
  import("./pages/ChecklistTemplatesPage").then((module) => ({ default: module.ChecklistTemplatesPage }))
);
const LazySecurityCenter = lazy(() =>
  import("./pages/SecurityCenter").then((module) => ({ default: module.SecurityCenter }))
);
const LazyScheduling = lazy(() =>
  import("./pages/Scheduling").then((module) => ({ default: module.Scheduling }))
);
const LazySchedule = lazy(() =>
  import("./pages/Schedule").then((module) => ({ default: module.Schedule }))
);
const LazyStaffAssignmentBoard = lazy(() =>
  import("./pages/StaffAssignmentBoard").then((module) => ({ default: module.StaffAssignmentBoard }))
);
const LazyStaffingCapacityPlanning = lazy(() =>
  import("./pages/StaffingCapacityPlanning").then((module) => ({ default: module.StaffingCapacityPlanning }))
);
const LazyConciergeSearchPage = lazy(() =>
  import("./pages/ConciergeSearchPage").then((module) => ({ default: module.ConciergeSearchPage }))
);
const LazyOperations = lazy(() =>
  import("./pages/Operations").then((module) => ({ default: module.Operations }))
);
const LazyStudiosWorkspace = lazy(() =>
  import("./pages/PhotographyWorkspace").then((module) => ({ default: module.StudiosWorkspace }))
);
const LazyOperationsExceptions = lazy(() =>
  import("./pages/OperationsWatch").then((module) => ({ default: module.OperationsWatch }))
);
const LazyUrgentWindow = lazy(() =>
  import("./pages/UrgentWindowPage").then((module) => ({ default: module.UrgentWindowPage }))
);
const LazyLiveShoots = lazy(() =>
  import("./pages/LiveShoots").then((module) => ({ default: module.LiveShoots }))
);
const LazyAlerts = lazy(() =>
  import("./pages/Alerts").then((module) => ({ default: module.Alerts }))
);
const LazySharedExceptionsPage = lazy(() =>
  import("./pages/SharedWatchlistPage").then((module) => ({ default: module.SharedWatchlistPage }))
);
const LazyExecutiveDashboardPage = lazy(() =>
  import("./pages/ExecutiveDashboardPage").then((module) => ({ default: module.ExecutiveDashboardPage }))
);
const LazyOperationsTodayPage = lazy(() =>
  import("./pages/OperationsTodayPage").then((module) => ({ default: module.OperationsTodayPage }))
);
const LazyAttendance = lazy(() =>
  import("./pages/Attendance").then((module) => ({ default: module.Attendance }))
);
const LazyCompliance = lazy(() =>
  import("./pages/Compliance").then((module) => ({ default: module.Compliance }))
);
const LazyLabor = lazy(() =>
  import("./pages/Labor").then((module) => ({ default: module.Labor }))
);
const LazyPayrollReview = lazy(() =>
  import("./pages/PayrollReview").then((module) => ({ default: module.PayrollReview }))
);
const LazyReports = lazy(() =>
  import("./pages/Reports").then((module) => ({ default: module.Reports }))
);
const LazySchoolsHub = lazy(() =>
  import("./pages/SchoolsHub").then((module) => ({ default: module.SchoolsHub }))
);
const LazySharedJobsPage = lazy(() =>
  import("./pages/SharedJobsPage").then((module) => ({ default: module.SharedJobsPage }))
);
const LazyJobsIndexPage = lazy(() =>
  import("./pages/JobsIndexPage").then((module) => ({ default: module.JobsIndexPage }))
);
const LazySharedJobEditorPage = lazy(() =>
  import("./pages/SharedJobEditorPage").then((module) => ({ default: module.SharedJobEditorPage }))
);
const LazySharedJobDetailPage = lazy(() =>
  import("./pages/SharedJobDetailPage").then((module) => ({ default: module.SharedJobDetailPage }))
);
const LazySharedTaskPage = lazy(() =>
  import("./pages/SharedTaskPage").then((module) => ({ default: module.SharedTaskPage }))
);
const LazySharedProductionPage = lazy(() =>
  import("./pages/SharedProductionPage").then((module) => ({ default: module.SharedProductionPage }))
);
const LazyProductionAssetsPage = lazy(() =>
  import("./pages/ProductionAssetsPage").then((module) => ({ default: module.ProductionAssetsPage }))
);
const LazySportsOverview = lazy(() =>
  import("./pages/SportsOverview").then((module) => ({ default: module.SportsOverview }))
);
const LazySportsAccounts = lazy(() =>
  import("./pages/SportsAccounts").then((module) => ({ default: module.SportsAccounts }))
);
const LazySportsContacts = lazy(() =>
  import("./pages/SportsContacts").then((module) => ({ default: module.SportsContacts }))
);
const LazySportsPeerQaBoard = lazy(() =>
  import("./pages/SportsPeerQaBoard").then((module) => ({ default: module.SportsPeerQaBoard }))
);
const LazySportsReports = lazy(() =>
  import("./pages/SportsReports").then((module) => ({ default: module.SportsReports }))
);
const LazySportsSettings = lazy(() =>
  import("./pages/SportsSettings").then((module) => ({ default: module.SportsSettings }))
);
const LazyCentralJobImportPage = lazy(() =>
  import("./pages/CentralJobImportPage").then((module) => ({ default: module.CentralJobImportPage }))
);
const LazyApprovals = lazy(() =>
  import("./pages/Approvals").then((module) => ({ default: module.Approvals }))
);
const LazyStatusBoard = lazy(() =>
  import("./pages/StatusBoard").then((module) => ({ default: module.StatusBoard }))
);
const LazyOutlookIntegration = lazy(() =>
  import("./pages/OutlookIntegration").then((module) => ({ default: module.OutlookIntegration }))
);
const LazyShootLocations = lazy(() =>
  import("./pages/ShootLocations").then((module) => ({ default: module.ShootLocations }))
);
const LazyOrganizations = lazy(() =>
  import("./pages/Organizations").then((module) => ({ default: module.Organizations }))
);
const LazyDirectoryRecordDetailPage = lazy(() =>
  import("./pages/DirectoryRecordDetailPage").then((module) => ({ default: module.DirectoryRecordDetailPage }))
);
const LazyGear = lazy(() =>
  import("./pages/Gear").then((module) => ({ default: module.Gear }))
);
const LazySalesPipeline = lazy(() =>
  import("./pages/SalesPipeline").then((module) => ({ default: module.SalesPipeline }))
);
const LazyTraining = lazy(() =>
  import("./pages/Training").then((module) => ({ default: module.Training }))
);
const LazyMyWork = lazy(() =>
  import("./pages/MyWork").then((module) => ({ default: module.MyWork }))
);
const LazyTeamsHomePage = lazy(() =>
  import("./pages/TeamsHomePage").then((module) => ({ default: module.TeamsHomePage }))
);
const LazyTeamsCommunicationsPage = lazy(() =>
  import("./pages/TeamsCommunicationsPage").then((module) => ({ default: module.TeamsCommunicationsPage }))
);
const LazyDashboardMyTasksPage = lazy(() =>
  import("./pages/DashboardMyTasksPage").then((module) => ({ default: module.DashboardMyTasksPage }))
);
const LazyEmployeesWorkspace = lazy(() =>
  import("./pages/EmployeesWorkspace").then((module) => ({ default: module.EmployeesWorkspace }))
);
const LazyAdminWorkspace = lazy(() =>
  import("./pages/AdminWorkspace").then((module) => ({ default: module.AdminWorkspace }))
);
const LazyProfitability = lazy(() =>
  import("./pages/Profitability").then((module) => ({ default: module.Profitability }))
);
const LazyProjectTrackingFoundation = lazy(() =>
  import("./pages/ProjectTrackingFoundation").then((module) => ({ default: module.ProjectTrackingFoundation }))
);
const LazyPrepReadinessQueuePage = lazy(() =>
  import("./pages/PrepReadinessQueuePage").then((module) => ({ default: module.PrepReadinessQueuePage }))
);
const LazyProductionWorkflowQueue = lazy(() =>
  import("./pages/ProductionWorkflowQueue").then((module) => ({ default: module.ProductionWorkflowQueue }))
);
const LazyProductionHub = lazy(() =>
  import("./pages/ProductionHub").then((module) => ({ default: module.ProductionHub }))
);
const LazyProductionOperationsView = lazy(() =>
  import("./pages/ProductionOperationsView").then((module) => ({ default: module.ProductionOperationsView }))
);
const LazySchoolsLeadershipOperations = lazy(() =>
  import("./pages/SchoolsLeadershipOperations").then((module) => ({ default: module.SchoolsLeadershipOperations }))
);
const LazyLaborCommandCenter = lazy(() =>
  import("./pages/LaborCommandCenter").then((module) => ({ default: module.LaborCommandCenter }))
);
const LazyPayrollSelfCheck = lazy(() =>
  import("./pages/PayrollSelfCheck").then((module) => ({ default: module.PayrollSelfCheck }))
);
const LazyAskBailey = lazy(() => import("./pages/AskBailey"));
const LazyKnowledgeReview = lazy(() => import("./pages/KnowledgeReview"));
const LazyKnowledgeSources = lazy(() => import("./pages/KnowledgeSources"));
const LazyKnowledgeSourceDetail = lazy(() => import("./pages/KnowledgeSourceDetail"));
const LazyMyTraining = lazy(() => import("./pages/MyTraining"));
const LazyTrainingLessons = lazy(() => import("./pages/TrainingLessons"));
const LazyAskBaileyObservability = lazy(() => import("./pages/AskBaileyObservability"));

// Persistent shell entry for Ask Bailey (H4-B): opens the contextual drawer
// in general mode without leaving the current page.
function AskBaileyShellTrigger({ variant }: { variant: "topbar" | "mobile" }) {
  const { openAskBailey } = useAskBailey();
  return (
    <button
      type="button"
      className={variant === "topbar" ? "secondary-button" : "concierge-mobile-trigger"}
      onClick={() => openAskBailey()}
      aria-haspopup="dialog"
      aria-label="Open Ask Bailey"
    >
      {variant === "topbar" ? "Ask Bailey" : <span className="concierge-mobile-trigger__label">Ask Bailey</span>}
    </button>
  );
}
const LazyWorkflowTemplateBuilderPage = lazy(() =>
  import("./pages/WorkflowTemplateBuilderPage").then((module) => ({ default: module.WorkflowTemplateBuilderPage }))
);
const LazyClientCommandCenter = lazy(() =>
  import("./pages/ClientCommandCenter").then((module) => ({ default: module.ClientCommandCenter }))
);
const LazyJobCloseoutV1 = lazy(() =>
  import("./pages/JobCloseoutV1").then((module) => ({ default: module.JobCloseoutV1 }))
);

export function resolveHeaderCollapsedState(scrollY: number, currentState: boolean) {
  return currentState ? scrollY > HEADER_EXPAND_SCROLL_Y : scrollY > HEADER_COLLAPSE_SCROLL_Y;
}

function RouteLoadingPanel({ title, summary }: { title: string; summary: string }) {
  return (
    <section className="panel loading-panel">
      <div className="section-title">{title}</div>
      <p className="section-subtitle">{summary}</p>
    </section>
  );
}

function withRouteSuspense(node: ReactNode, title: string, summary: string) {
  return <Suspense fallback={<RouteLoadingPanel title={title} summary={summary} />}>{node}</Suspense>;
}

function HashRedirect({ targetHash, title, summary }: { targetHash: string; title: string; summary: string }) {
  useEffect(() => {
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }, [targetHash]);

  return <RouteLoadingPanel title={title} summary={summary} />;
}

function safeScrollToTop() {
  if (/jsdom/i.test(window.navigator.userAgent)) {
    return;
  }
  try {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  } catch {
    try {
      window.scrollTo(0, 0);
    } catch {
      // Embedded and test environments may not implement scrolling.
    }
  }
}

export default function App() {
  const [token, setSessionToken] = useState(() => getToken());
  const [routeId, setRouteId] = useState<ShellRouteId>(() => getInitialRouteId());
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionCheckNonce, setSessionCheckNonce] = useState(0);
  const [authNotice, setAuthNotice] = useState("");
  const [releaseDiscipline, setReleaseDiscipline] = useState<ReleaseDisciplineSummary | null>(null);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [mobileShell, setMobileShell] = useState(() => matchesMobileShell());
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [conciergeInitialQuery, setConciergeInitialQuery] = useState("");
  const headerCollapsedRef = useRef(false);
  const headerCollapseFrameRef = useRef<number | null>(null);
  const teamsMode = detectTeamsMode();

  const availableTabs = getAvailableTabs(currentUser);
  const employeeOnlyMode = currentUser ? shouldLimitToEmployeeWorksurface(currentUser) : false;
  const primarySections = getPrimarySectionsFromNavigation(availableTabs, employeeOnlyMode).filter((section) =>
    currentUser ? canAccessSection(currentUser, section.key) : false
  );
  const fallbackRouteId = currentUser
    ? getAccessibleFallbackRoute(currentUser, availableTabs, employeeOnlyMode, teamsMode)
    : teamsMode
      ? "teams-home"
      : getDefaultRouteId(availableTabs, employeeOnlyMode);
  const guardedRouteId = currentUser && canAccessRoute(currentUser, routeId) ? routeId : fallbackRouteId;
  const currentRoute = getRouteById(guardedRouteId);
  const displayMode = guardedRouteId === "status-board-display";
  const mobileBottomNavActive = Boolean(currentUser && !displayMode && shouldUseMobileBottomNav(currentUser, mobileShell));
  const desktopSidebarActive = Boolean(currentUser && !displayMode && !mobileBottomNavActive);
  const activeSection =
    currentRoute.sectionKey != null
      ? primarySections.find((section) => section.key === currentRoute.sectionKey) ?? null
      : null;
  const secondaryRoutes = activeSection
    ? getVisibleChildRoutes(activeSection.key, availableTabs, employeeOnlyMode).filter((route) =>
        currentUser ? canAccessRoute(currentUser, route.id) : route.id === "dashboard"
      )
    : [];
  const utilityRoutes = getVisibleUtilityRoutes(availableTabs, employeeOnlyMode).filter((route) =>
    currentUser ? canAccessRoute(currentUser, route.id) : false
  );
  const accountUtilityRoute = utilityRoutes.find((route) => route.id === "account") ?? null;
  const isHomeRoute = guardedRouteId === "dashboard";
  const isMyWorkLaunchpadRoute = guardedRouteId === "dashboard-my-day";
  const isScheduleLandingRoute = guardedRouteId === "operations-schedule" || guardedRouteId === "dashboard-my-schedule";
  const isDirectoryRoute = currentRoute.sectionKey === "contacts" || guardedRouteId.startsWith("directory-");
  const isJobsRoute = guardedRouteId === "jobs";
  const isPhotographySectionRoute = currentRoute.sectionKey === "photography";
  const isProjectTrackingOverviewRoute = guardedRouteId === "project-tracking";
  const isProductionSectionRoute = currentRoute.sectionKey === "production";
  const activeSectionDefinition = activeSection ? getSectionDefinition(activeSection.key) : null;
  const currentRouteRepeatsSectionLabel = activeSectionDefinition?.label === currentRoute.label;
  const topbarRouteLabel = isDirectoryRoute ? "Directory" : currentRoute.label;
  const visibleSecondaryRoutes = isHomeRoute || isDirectoryRoute || currentRouteRepeatsSectionLabel ? [] : secondaryRoutes;
  const visibleContextUtilityRoutes: typeof utilityRoutes = [];
  const visibleHeaderUtilityRoutes = isHomeRoute ? utilityRoutes.filter((route) => route.id === "account") : utilityRoutes;
  const showTopbarMeta = !isDirectoryRoute;
  const routeOwnsPrimaryHeader =
    isHomeRoute ||
    isMyWorkLaunchpadRoute ||
    isScheduleLandingRoute ||
    isDirectoryRoute ||
    isJobsRoute ||
    isPhotographySectionRoute ||
    isProjectTrackingOverviewRoute ||
    isProductionSectionRoute;
  const desktopNavGroups = buildDesktopNavGroups(primarySections);
  const sectionLandingCards =
    currentRoute.sectionKey != null
      ? getSectionChildrenForLanding(currentRoute.sectionKey, availableTabs, employeeOnlyMode).filter((card) =>
          currentUser ? canAccessRoute(currentUser, card.id) : card.id === "dashboard"
        )
      : [];
  const mobileBottomNavItems = currentUser ? buildMobileBottomNavItems(currentUser) : [];
  const mobileMoreLinks = currentUser ? buildMobileMoreLinks(currentUser) : [];

  useEffect(() => {
    const callback = consumeMicrosoftAuthCallback();
    if (!callback) {
      return;
    }

    if (callback.token) {
      setToken(callback.token);
      setSessionToken(callback.token);
      setAuthNotice("");
      window.location.hash = callback.returnHash || (detectTeamsMode() ? "#teams/home" : "#home");
      return;
    }

    if (callback.status === "step_up_complete") {
      setAuthNotice(callback.notice || "Microsoft reauthentication completed.");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      if (callback.returnHash) {
        window.location.hash = callback.returnHash;
      }
      setSessionCheckNonce((current) => current + 1);
      return;
    }

    clearToken();
    setSessionToken("");
    setCurrentUser(null);
    setAuthNotice(callback.notice || "Microsoft sign-in needs admin review before access can be granted.");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    rememberTeamsMode(teamsMode);
  }, [teamsMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("pmc-theme", theme);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", theme === "light" ? LIGHT_THEME_COLOR : DARK_THEME_COLOR);
    }
  }, [theme]);

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
      setMobileShell(event.matches);
    };

    handleChange(mediaQuery);

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    legacyMediaQuery.addListener?.(handleChange);
    return () => legacyMediaQuery.removeListener?.(handleChange);
  }, []);

  useEffect(() => {
    if (!token) {
      setCurrentUser(null);
      setSocket(null);
      setRealtimeStatus("connecting");
      setSessionError("");
      setReleaseDiscipline(null);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    setSessionError("");
    void apiFetch<{ user: SessionUser }>("/auth/session", token)
      .then((response) => {
        if (!cancelled) {
          setCurrentUser(response.user);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isAuthFailure(error)) {
          clearToken();
          setSessionToken("");
          setCurrentUser(null);
          setAuthNotice("Your session expired. Sign in again to continue.");
          setSessionError("");
          return;
        }
        setCurrentUser(null);
        setSessionError("Mission Control couldn't verify your session right now. Check that the API is running, then retry.");
      })
      .finally(() => {
        if (!cancelled) {
          setSessionLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, sessionCheckNonce]);

  useEffect(() => {
    if (!token || !currentUser) {
      setReleaseDiscipline(null);
      return;
    }

    let cancelled = false;
    void getReleaseDisciplineHealth(token)
      .then((payload) => {
        if (!cancelled) {
          setReleaseDiscipline(payload.release_discipline ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReleaseDiscipline(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, token]);

  useEffect(() => {
    if (!token || !currentUser) {
      return;
    }
    const realtimeSocket = connectRealtime(token);
    setSocket(realtimeSocket);
    setRealtimeStatus(realtimeSocket.connected ? "connected" : "connecting");

    const handleConnect = () => setRealtimeStatus("connected");
    const handleDisconnect = () => setRealtimeStatus("connecting");
    const handleConnectError = () => setRealtimeStatus("error");

    realtimeSocket.on("connect", handleConnect);
    realtimeSocket.on("disconnect", handleDisconnect);
    realtimeSocket.on("connect_error", handleConnectError);

    return () => {
      realtimeSocket.off("connect", handleConnect);
      realtimeSocket.off("disconnect", handleDisconnect);
      realtimeSocket.off("connect_error", handleConnectError);
      realtimeSocket.close();
    };
  }, [currentUser, token]);

  useEffect(() => {
    const nextRouteId =
      teamsMode && !window.location.hash
        ? "teams-home"
        : resolveRouteId(window.location.hash, availableTabs, employeeOnlyMode);
    const accessibleRouteId = currentUser
      ? ensureAccessibleRoute(currentUser, nextRouteId, availableTabs, employeeOnlyMode, teamsMode)
      : nextRouteId;
    setRouteId(accessibleRouteId);
    if (!window.location.hash || accessibleRouteId !== nextRouteId) {
      window.location.hash = buildShellRouteHash(accessibleRouteId || fallbackRouteId);
    }
  }, [availableTabs, currentUser, employeeOnlyMode, fallbackRouteId, teamsMode]);

  useEffect(() => {
    const syncRouteFromHash = () => {
      const nextRouteId =
        teamsMode && !window.location.hash
          ? "teams-home"
          : resolveRouteId(window.location.hash, availableTabs, employeeOnlyMode);
      const accessibleRouteId = currentUser
        ? ensureAccessibleRoute(currentUser, nextRouteId, availableTabs, employeeOnlyMode, teamsMode)
        : nextRouteId;
      if (accessibleRouteId !== nextRouteId) {
        window.location.hash = buildShellRouteHash(accessibleRouteId);
        return;
      }
      setRouteId(accessibleRouteId);
    };

    window.addEventListener("hashchange", syncRouteFromHash);
    return () => window.removeEventListener("hashchange", syncRouteFromHash);
  }, [availableTabs, currentUser, employeeOnlyMode, teamsMode]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        Boolean(target?.isContentEditable) || tagName === "input" || tagName === "textarea" || tagName === "select";
      if (isEditable) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openConcierge();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentUser]);

  useEffect(() => {
    if (displayMode) {
      if (headerCollapseFrameRef.current !== null) {
        window.cancelAnimationFrame(headerCollapseFrameRef.current);
        headerCollapseFrameRef.current = null;
      }
      headerCollapsedRef.current = false;
      setHeaderCollapsed(false);
      return;
    }

    const syncHeaderState = () => {
      headerCollapseFrameRef.current = null;
      const nextState = resolveHeaderCollapsedState(window.scrollY, headerCollapsedRef.current);
      if (nextState !== headerCollapsedRef.current) {
        headerCollapsedRef.current = nextState;
        setHeaderCollapsed(nextState);
      }
    };

    const queueSync = () => {
      if (headerCollapseFrameRef.current !== null) {
        return;
      }
      headerCollapseFrameRef.current = window.requestAnimationFrame(syncHeaderState);
    };

    queueSync();
    window.addEventListener("scroll", queueSync, { passive: true });
    window.addEventListener("resize", queueSync);
    return () => {
      window.removeEventListener("scroll", queueSync);
      window.removeEventListener("resize", queueSync);
      if (headerCollapseFrameRef.current !== null) {
        window.cancelAnimationFrame(headerCollapseFrameRef.current);
        headerCollapseFrameRef.current = null;
      }
    };
  }, [displayMode]);

  useEffect(() => {
    setMobileMoreOpen(false);
  }, [guardedRouteId, mobileBottomNavActive]);

  useEffect(() => {
    setConciergeOpen(false);
  }, [guardedRouteId]);

  useEffect(() => {
    if (displayMode) {
      return;
    }
    safeScrollToTop();
    headerCollapsedRef.current = false;
    setHeaderCollapsed(false);
  }, [displayMode, routeId]);

  function openConcierge(initialQuery = "") {
    setConciergeInitialQuery(initialQuery);
    setConciergeOpen(true);
  }

  function navigateToRoute(nextRouteId: ShellRouteId) {
    if (nextRouteId === "search") {
      openConcierge();
      return;
    }
    window.location.hash = buildShellRouteHash(nextRouteId);
  }

  const jobIntakeBackAction =
    guardedRouteId === "job-new" ? (
      <button type="button" className="secondary-button" onClick={() => navigateToRoute("jobs")}>
        Back
      </button>
    ) : null;

  function handleLoggedIn() {
    setAuthNotice("");
    setSessionError("");
    setSessionToken(getToken());
  }

  function handleLoggedOut(notice?: string) {
    clearToken();
    setSessionToken("");
    setCurrentUser(null);
    setSocket(null);
    setRealtimeStatus("connecting");
    setSessionError("");
    setAuthNotice(notice ?? "");
  }

  const shellTools = teamsMode ? null : (
    <div className={`shell-tools${token ? "" : " shell-tools--floating"}`}>
      <InstallPrompt />
      <ThemeToggle theme={theme} onChange={setTheme} />
    </div>
  );

  if (!token) {
    return (
      <>
        {shellTools}
        <Login notice={authNotice} onLoggedIn={handleLoggedIn} />
      </>
    );
  }

  if (sessionLoading) {
    return (
      <div className="app-shell">
        {shellTools}
        <section className="panel loading-panel">
          <div className="section-title">Loading session</div>
          <p className="section-subtitle">Checking your live membership and permissions before opening Mission Control.</p>
        </section>
      </div>
    );
  }

  if (!currentUser) {
    if (sessionError) {
      return (
        <div className="app-shell">
          {shellTools}
          <section className="panel loading-panel">
            <div className="section-title">Session Check Failed</div>
            <p className="section-subtitle">{sessionError}</p>
            <div className="access-actions">
              <button onClick={() => setSessionCheckNonce((value) => value + 1)}>Retry Session Check</button>
              <button
                className="secondary-button"
                onClick={() => handleLoggedOut("Signed out locally. Sign in again when the API is available.")}
              >
                Clear Saved Session
              </button>
            </div>
          </section>
        </div>
      );
    }
    return (
      <>
        {shellTools}
        <Login notice={authNotice} onLoggedIn={handleLoggedIn} />
      </>
    );
  }

  const routeContent = renderRouteContent({
    routeId: guardedRouteId,
    route: currentRoute,
    token,
    currentUser,
    socket,
    realtimeStatus,
    sectionLandingCards,
    onOpenConcierge: openConcierge,
    onSessionUpdated: setCurrentUser,
    onLoggedOut: handleLoggedOut,
    theme,
    onThemeChange: setTheme
  });
  const suppressDirtyBannerForInternalDemo =
    guardedRouteId === "project-tracking" || guardedRouteId === "operations-schools" || guardedRouteId.startsWith("schools-");
  const dirtyStateBanner =
    releaseDiscipline?.git.is_clean === false && !suppressDirtyBannerForInternalDemo ? (
      <section className="dirty-state-banner panel" role="alert" aria-live="assertive">
        <div className="dirty-state-banner__eyebrow">DIRTY STATE</div>
        <div className="dirty-state-banner__body">
          <strong>Pilot mode is blocked.</strong>
          <p>
            This repo has {releaseDiscipline.git.dirty_path_count} changed or untracked path
            {releaseDiscipline.git.dirty_path_count === 1 ? "" : "s"}. Runtime smoke must pass on a clean worktree before pilot mode can be enabled.
          </p>
        </div>
      </section>
    ) : null;

  if (teamsMode) {
    return (
      <div className={`app-shell app-shell--teams${mobileShell ? " app-shell--teams-mobile" : ""}`}>
        <div className="teams-shell">
          <header className="panel teams-shell__header">
            <div className="teams-shell__header-copy">
              <div className="eyebrow">Kemmetmueller Teams</div>
              <h1>{guardedRouteId === "teams-home" ? "Employee Home" : currentRoute.label}</h1>
              <p>
                {guardedRouteId === "teams-home"
                  ? "Focused daily launchpad for assignments, schedule, tasks, staffing pressure, search, and important updates."
                  : currentRoute.description}
              </p>
            </div>
            <div className="teams-shell__header-actions">
              {guardedRouteId !== "teams-home" ? (
                <button type="button" className="secondary-button" onClick={() => navigateToRoute("teams-home")}>
                  Back To Home
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => openConcierge()}>
                Ask Concierge
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => window.open(buildStandaloneAppUrl(window.location.hash || buildShellRouteHash("dashboard")), "_blank", "noopener,noreferrer")}
              >
                Open Full App
              </button>
            </div>
          </header>

          {dirtyStateBanner}
          <main className="teams-shell__content">{routeContent}</main>
        </div>
        <ConciergeCommandPalette
          token={token}
          open={conciergeOpen}
          mode="overlay"
          mobile={mobileShell}
          initialQuery={conciergeInitialQuery}
          onClose={() => {
            setConciergeOpen(false);
            setConciergeInitialQuery("");
          }}
        />
        <CommunicationsLauncher
          token={token}
          currentUser={currentUser}
          mobile={mobileShell}
          fullRouteId="teams-communications"
        />
      </div>
    );
  }

  return (
    <AskBaileyProvider token={token} userLine={`Your role: ${getShellRoleLabel(currentUser)}`}>
    <div
      className={`app-shell${displayMode ? " app-shell--display" : ""}${
        headerCollapsed ? " app-shell--header-collapsed" : ""
      }${mobileBottomNavActive ? " app-shell--mobile-nav" : ""}${
        desktopSidebarActive ? " app-shell--desktop-sidebar" : ""
      }`}
    >
      {dirtyStateBanner}
      {desktopSidebarActive ? (
        <div className="app-shell__desktop-frame">
          <aside className="shell-sidebar panel" aria-label="Mission Control Navigation">
            <div className="shell-sidebar__brand">
              <BrandMark size="sm" />
              <div className="shell-sidebar__brand-copy">
                <strong>Mission Control</strong>
                <span>Operating System</span>
              </div>
            </div>

            <nav className="shell-sidebar__groups" aria-label="Mission Control Navigation">
              {desktopNavGroups.map((group) => (
                <section key={group.id} className="shell-sidebar__group" aria-labelledby={`shell-sidebar-group-${group.id}`}>
                  <div id={`shell-sidebar-group-${group.id}`} className="shell-sidebar__group-label">
                    {group.label}
                  </div>
                  <div className="shell-sidebar__group-items">
                    {group.sections.map((section) => {
                      const isActive = activeSection?.key === section.key;
                      return (
                        <button
                          key={section.key}
                          type="button"
                          className={`shell-sidebar__route${isActive ? " is-active" : ""}`}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => navigateToRoute(section.routeId)}
                        >
                          <ShellSidebarIcon sectionKey={section.key} />
                          <span className="shell-sidebar__route-label">{section.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </nav>

            <div className="shell-sidebar__footer">
              <div className="shell-sidebar__identity">
                <strong>{getShellUserName(currentUser)}</strong>
                <span>
                  {getShellAuthorityLabel(currentUser)}
                  {" | "}
                  {getTrustLabel(currentUser)}
                </span>
              </div>
              {accountUtilityRoute ? (
                <button
                  type="button"
                  className={`shell-sidebar__account${routeId === accountUtilityRoute.id ? " is-active" : ""}`}
                  onClick={() => navigateToRoute(accountUtilityRoute.id)}
                >
                  My Account
                </button>
              ) : null}
              <div className="shell-sidebar__tools">{shellTools}</div>
            </div>
          </aside>

          <div className="app-shell__content">
            {!routeOwnsPrimaryHeader ? (
              <header className={`shell-topbar panel${headerCollapsed ? " shell-topbar--collapsed" : ""}`}>
                <div className="shell-topbar__heading">
                  <div className="eyebrow">{activeSectionDefinition?.label ?? "Mission Control"}</div>
                  <div className="shell-topbar__title-wrap">
                    <h1>{topbarRouteLabel}</h1>
                    {!headerCollapsed && activeSectionDefinition && !currentRouteRepeatsSectionLabel ? (
                      <div className="shell-topbar__supporting-line">
                        <span>{activeSectionDefinition.label}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="shell-topbar__actions">
                  {jobIntakeBackAction}
                  <button
                    type="button"
                    className="concierge-shell-trigger"
                    onClick={() => openConcierge()}
                    aria-haspopup="dialog"
                    aria-expanded={conciergeOpen}
                    aria-controls="concierge-command-palette"
                  >
                    <span className="concierge-shell-trigger__label">Ask Concierge anything...</span>
                    <span className="concierge-shell-trigger__shortcut">Cmd/Ctrl + K</span>
                  </button>
                  <AskBaileyShellTrigger variant="topbar" />
                  <GlobalPunchControl token={token} currentUser={currentUser} />
                  {showTopbarMeta ? (
                  <div className="shell-topbar__meta">
                    <div className={`status-pill status-pill--${realtimeStatus}`}>{getRealtimeStatusLabel(realtimeStatus)}</div>
                    <div
                      className={`metric-pill metric-pill--${
                        currentUser.sessionTrust.breakGlassModeActive
                          ? "danger"
                          : currentUser.sessionTrust.elevatedSessionActive
                            ? "success"
                            : "neutral"
                      }`}
                    >
                      {getTrustLabel(currentUser)}
                    </div>
                    <div className="metric-pill metric-pill--identity">{getShellRoleLabel(currentUser)}</div>
                  </div>
                  ) : null}
                </div>
              </header>
            ) : null}

            {visibleSecondaryRoutes.length || visibleContextUtilityRoutes.length ? (
              <section className="shell-context-bar panel shell-context-bar--sidebar-layout">
                {visibleSecondaryRoutes.length ? (
                  <div className="shell-context-bar__group">
                    <div className="shell-context-bar__label">In {activeSectionDefinition?.label ?? "this section"}</div>
                    <nav className="shell-context-nav" aria-label={`${activeSection?.label ?? "Section"} Navigation`}>
                      {visibleSecondaryRoutes.map((route) => (
                        <button
                          key={route.id}
                          type="button"
                          className={`shell-context-nav__button${route.id === routeId ? " is-active" : ""}`}
                          aria-current={route.id === routeId ? "page" : undefined}
                          onClick={() => navigateToRoute(route.id)}
                        >
                          {route.label}
                        </button>
                      ))}
                    </nav>
                  </div>
                ) : null}
                {visibleContextUtilityRoutes.length ? (
                  <div className="shell-context-bar__group shell-context-bar__group--utility">
                    <div className="shell-context-bar__label">Shortcuts</div>
                    <nav className="shell-context-utility" aria-label="Shortcuts">
                      {visibleContextUtilityRoutes.map((route) => (
                        <button
                          key={route.id}
                          type="button"
                          className={`shell-context-utility__button${
                            route.id === "search" ? (conciergeOpen ? " is-active" : "") : route.id === routeId ? " is-active" : ""
                          }`}
                          aria-current={route.id === "search" ? (conciergeOpen ? "page" : undefined) : route.id === routeId ? "page" : undefined}
                          onClick={() => navigateToRoute(route.id)}
                        >
                          {route.label}
                        </button>
                      ))}
                    </nav>
                  </div>
                ) : null}
              </section>
            ) : null}

            <main className="app-main">{routeContent}</main>
          </div>
        </div>
      ) : (
        <>
          {!displayMode ? (
            <header className={`app-header panel${headerCollapsed ? " app-header--collapsed" : ""}`}>
              <div className="app-header__top">
                <div className="brand-lockup">
                  <BrandMark size={headerCollapsed ? "sm" : "lg"} />
                  <div className="brand-copy">
                    {!headerCollapsed ? <div className="eyebrow">Kemmetmueller Photography</div> : null}
                    <h1>Mission Control</h1>
                    {!headerCollapsed && !isHomeRoute ? (
                      <p>
                        Operational command center for dashboard visibility, live execution, production, reporting, and shared follow-through.
                      </p>
                    ) : null}
                  </div>
                </div>
                {!isHomeRoute ? (
                  <div className="header-side">
                    <div className="header-tools">
                      <GlobalPunchControl token={token} currentUser={currentUser} />
                      <div className="shell-status-strip">
                        <div className={`status-pill status-pill--${realtimeStatus}`}>
                          {headerCollapsed ? getRealtimeStatusLabel(realtimeStatus) : `Realtime: ${getRealtimeStatusLabel(realtimeStatus)}`}
                        </div>
                        <div
                          className={`metric-pill metric-pill--${
                            currentUser.sessionTrust.breakGlassModeActive
                              ? "danger"
                              : currentUser.sessionTrust.elevatedSessionActive
                                ? "success"
                                : "neutral"
                          }`}
                        >
                          {headerCollapsed ? getTrustLabel(currentUser) : `Trust: ${getTrustLabel(currentUser)}`}
                        </div>
                        <div className="metric-pill metric-pill--identity">
                          {headerCollapsed
                            ? `${getShellUserName(currentUser)} | ${getShellAuthorityLabel(currentUser)}`
                            : `${getShellUserName(currentUser)} | ${getShellAuthorityLabel(currentUser)} | ${getShellRoleLabel(currentUser)}`}
                        </div>
                      </div>
                      {shellTools}
                    </div>
                  </div>
                ) : null}
              </div>
              {!isHomeRoute ? (
                <>
                  <button
                    type="button"
                    className="concierge-mobile-trigger"
                    onClick={() => openConcierge()}
                    aria-haspopup="dialog"
                    aria-expanded={conciergeOpen}
                    aria-controls="concierge-command-palette"
                  >
                    <span className="concierge-mobile-trigger__icon" aria-hidden="true">
                      Search
                    </span>
                    <span className="concierge-mobile-trigger__label">Ask Concierge anything...</span>
                  </button>
                  <AskBaileyShellTrigger variant="mobile" />
                </>
              ) : null}

              {!mobileBottomNavActive ? (
                <div className="app-header__nav">
                  <nav className="shell-primary-nav" aria-label="Mission Control Primary Navigation">
                    {primarySections.map((section) => (
                      <button
                        key={section.key}
                        type="button"
                        className={`shell-primary-nav__button${activeSection?.key === section.key ? " is-active" : ""}`}
                        onClick={() => navigateToRoute(section.routeId)}
                      >
                        {section.label}
                      </button>
                    ))}
                  </nav>
                  {visibleSecondaryRoutes.length || visibleHeaderUtilityRoutes.length ? (
                    <div className="shell-nav-meta">
                      {visibleSecondaryRoutes.length ? (
                      <nav className="shell-secondary-nav" aria-label={`${activeSection?.label ?? "Section"} Navigation`}>
                          {visibleSecondaryRoutes.map((route) => (
                          <button
                            key={route.id}
                            type="button"
                            className={`shell-secondary-nav__button${route.id === routeId ? " is-active" : ""}`}
                            onClick={() => navigateToRoute(route.id)}
                          >
                            {route.label}
                          </button>
                        ))}
                      </nav>
            ) : null}
                      {visibleHeaderUtilityRoutes.length ? (
                        <nav className="shell-utility-nav" aria-label="Personal And Quick Tools">
                          {visibleHeaderUtilityRoutes.map((route) => (
                          <button
                            key={route.id}
                            type="button"
                            className={`shell-utility-nav__button${
                              route.id === "search" ? (conciergeOpen ? " is-active" : "") : route.id === routeId ? " is-active" : ""
                            }`}
                            onClick={() => navigateToRoute(route.id)}
                          >
                            {route.label}
                          </button>
                        ))}
                        </nav>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </header>
          ) : null}

          {!displayMode ? (
            <section className="shell-context-bar panel shell-context-bar--route-identity">
              <div className="shell-context-bar__breadcrumbs">
                <span>{activeSectionDefinition?.label ?? "Shared Utility"}</span>
                <span>/</span>
                <strong>{currentRoute.label}</strong>
              </div>
              <div className="shell-context-bar__title-row">
                <div className="shell-context-bar__title">{currentRoute.label}</div>
                {jobIntakeBackAction}
                {currentRoute.utility ? <span className="shell-context-bar__tag">Utility Surface</span> : null}
              </div>
            </section>
          ) : null}

          <main className={`app-main${displayMode ? " app-main--display" : ""}`}>{routeContent}</main>
        </>
      )}
      {mobileBottomNavActive ? (
        <>
          {mobileMoreOpen ? (
            <section id="mobile-more-sheet" className="panel mobile-more-sheet" aria-label="More navigation">
              <div className="mobile-more-sheet__header">
                <div>
                  <div className="eyebrow">More</div>
                  <strong>Additional destinations</strong>
                </div>
                <button type="button" className="secondary-button" onClick={() => setMobileMoreOpen(false)}>
                  Close
                </button>
              </div>
              <div className="mobile-more-sheet__links">
                {mobileMoreLinks.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    className={`mobile-more-sheet__link${guardedRouteId === link.id ? " is-active" : ""}`}
                    onClick={() => navigateToRoute(link.id)}
                  >
                    <strong>{link.label}</strong>
                    <span>{link.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <nav className="mobile-bottom-nav panel" aria-label="Mobile navigation">
            {mobileBottomNavItems.map((item) =>
              item.kind === "more" ? (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-bottom-nav__button${mobileMoreOpen ? " is-active" : ""}`}
                  aria-expanded={mobileMoreOpen}
                  aria-controls="mobile-more-sheet"
                  onClick={() => setMobileMoreOpen((value) => !value)}
                >
                  {item.label}
                </button>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-bottom-nav__button${guardedRouteId === item.routeId ? " is-active" : ""}`}
                  onClick={() => navigateToRoute(item.routeId)}
                >
                  {item.label}
                </button>
              )
            )}
          </nav>
        </>
      ) : null}
      {currentUser ? (
        <>
          <ConciergeCommandPalette
            token={token}
            open={conciergeOpen}
            mode="overlay"
            mobile={mobileShell}
            initialQuery={conciergeInitialQuery}
            onClose={() => {
              setConciergeOpen(false);
              setConciergeInitialQuery("");
            }}
          />
          <CommunicationsLauncher
            token={token}
            currentUser={currentUser}
            mobile={mobileShell}
            fullRouteId="teams-communications"
          />
        </>
      ) : null}
    </div>
    </AskBaileyProvider>
  );
}

type RenderRouteContentArgs = {
  routeId: ShellRouteId;
  route: ReturnType<typeof getRouteById>;
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  realtimeStatus: "connecting" | "connected" | "error";
  sectionLandingCards: Array<{ id: string; label: string; description: string; hash: string }>;
  onOpenConcierge: (initialQuery?: string) => void;
  onSessionUpdated: (user: SessionUser) => void;
  onLoggedOut: (notice?: string) => void;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
};

function renderRouteContent({
  routeId,
  route,
  token,
  currentUser,
  socket,
  realtimeStatus,
  sectionLandingCards,
  onOpenConcierge,
  onSessionUpdated,
  onLoggedOut,
  theme,
  onThemeChange
}: RenderRouteContentArgs) {
  if (route.render.kind === "dashboard-root") {
    return <Dashboard token={token} currentUser={currentUser} socket={socket} onOpenConcierge={onOpenConcierge} />;
  }

  if (route.render.kind === "dashboard-my-tasks") {
    return withRouteSuspense(
      <LazyDashboardMyTasksPage token={token} currentUser={currentUser} />,
      "Loading My Tasks",
      "Opening your task queues and next actions."
    );
  }

  if (route.render.kind === "teams-home") {
    return withRouteSuspense(
      <LazyTeamsHomePage token={token} currentUser={currentUser} onOpenConcierge={onOpenConcierge} />,
      "Loading Teams home",
      "Opening the focused Teams employee home."
    );
  }

  if (route.render.kind === "teams-communications") {
    return withRouteSuspense(
      <LazyTeamsCommunicationsPage token={token} currentUser={currentUser} />,
      "Loading communication actions",
      "Opening record-linked communication actions."
    );
  }

  if (route.render.kind === "global-search") {
    return withRouteSuspense(
      <LazyConciergeSearchPage token={token} />,
      "Loading search",
      "Opening Kemmetmueller Concierge."
    );
  }

  if (route.render.kind === "studios-workspace") {
    return withRouteSuspense(
      <LazyStudiosWorkspace token={token} currentUser={currentUser} focus={route.render.focus} />,
      "Loading studios",
      "Opening the studios workspace."
    );
  }

  if (route.render.kind === "employees-workspace") {
    return withRouteSuspense(
      <LazyEmployeesWorkspace token={token} currentUser={currentUser} socket={socket} />,
      "Loading employees",
      "Opening the employees workspace."
    );
  }

  if (route.render.kind === "admin-workspace") {
    return withRouteSuspense(
      <LazyAdminWorkspace token={token} currentUser={currentUser} routeId={routeId} />,
      "Loading admin",
      "Opening the admin control workspace."
    );
  }

  if (route.render.kind === "checklist-templates") {
    return withRouteSuspense(
      <LazyChecklistTemplatesPage token={token} currentUser={currentUser} />,
      "Loading checklist templates",
      "Opening the checklist template library."
    );
  }

  if (route.render.kind === "hidden-redirect") {
    return (
      <HashRedirect
        targetHash={route.render.targetHash}
        title={`Redirecting ${route.label}`}
        summary={route.render.summary}
      />
    );
  }

  if (route.render.kind === "not-found") {
    // MC-AUDIT-018: an unknown deep link says so instead of silently opening
    // the dashboard as if it had worked.
    return (
      <section className="panel" aria-label="Page not found">
        <div className="page-intro page-intro--compact">
          <div>
            <div className="eyebrow">Not Found</div>
            <h2>This link doesn't match any page</h2>
            <p>
              {window.location.hash && window.location.hash !== "#not-found" ? (
                <>
                  <code>{window.location.hash}</code> isn't a Mission Control destination. The link may be
                  outdated, or the record it pointed to may have moved.
                </>
              ) : (
                <>The link you followed isn't a Mission Control destination.</>
              )}
            </p>
          </div>
        </div>
        <div className="page-intro-actions">
          <a className="secondary-button" href="#home">
            Go to Home
          </a>
          <a className="secondary-button" href="#search">
            Search instead
          </a>
        </div>
      </section>
    );
  }

  if (route.render.kind === "directory") {
    return withRouteSuspense(
      <LazyOrganizations
        token={token}
        currentUser={currentUser}
        entryView={route.render.entryView}
        defaultContactAudience={route.render.defaultContactAudience}
      />,
      "Loading directory",
      "Opening the directory workspace."
    );
  }

  if (route.render.kind === "directory-record-detail") {
    return withRouteSuspense(
      <LazyDirectoryRecordDetailPage token={token} currentUser={currentUser} recordType={route.render.recordType} />,
      "Loading record",
      "Opening the canonical directory record."
    );
  }

  if (route.render.kind === "shared-exceptions") {
    const title =
      route.render.department === "schools"
        ? "Schools Exceptions"
        : route.render.department === "sports"
          ? "Sports Exceptions"
          : "Exceptions";
    const summary =
      route.render.department === "schools"
        ? "Shared operational exceptions queue for school readiness, staffing, blocked downstream work, approvals, and delivery exceptions."
        : route.render.department === "sports"
          ? "Shared operational exceptions queue for sports readiness, staffing volatility, proof approvals, specialty product risk, and delivery drift."
          : "One actionable queue of unresolved operational exceptions across readiness, staffing, downstream production, approvals, delivery, and same-day execution.";
    return withRouteSuspense(
      <LazySharedExceptionsPage
        token={token}
        currentUser={currentUser}
        departmentType={route.render.department}
        title={title}
        summary={summary}
      />,
      `Loading ${title.toLowerCase()}`,
      "Opening the shared exceptions queue."
    );
  }

  if (route.render.kind === "executive-dashboard") {
    return withRouteSuspense(
      <LazyExecutiveDashboardPage token={token} currentUser={currentUser} />,
      "Loading executive dashboard",
      "Opening the cross-department executive command surface."
    );
  }

  if (route.render.kind === "operations-today") {
    return withRouteSuspense(
      <LazyOperationsTodayPage token={token} currentUser={currentUser} departmentType={route.render.department} />,
      route.render.department ? `Loading ${route.render.department} today` : "Loading operations today",
      "Opening the live same-day operations board."
    );
  }

  if (route.render.kind === "schools-hub") {
    return withRouteSuspense(
      <LazySchoolsHub token={token} currentUser={currentUser} />,
      "Loading schools",
      "Opening the schools workspace."
    );
  }

  if (route.render.kind === "shared-jobs-list") {
    // The global Jobs index uses the canonical Phase 3B/3C read model; department-
    // scoped lists keep the legacy adapter shell until they migrate.
    if (route.render.department == null) {
      return withRouteSuspense(<LazyJobsIndexPage token={token} currentUser={currentUser} />, "Loading jobs", "Opening the canonical jobs index.");
    }
    return withRouteSuspense(
      <LazySharedJobsPage
        token={token}
        currentUser={currentUser}
        departmentType={route.render.department}
        routeBase={route.render.routeBase}
      />,
      route.render.department === "schools" ? "Loading school jobs" : "Loading sports jobs",
      "Opening the shared jobs list shell."
    );
  }

  if (route.render.kind === "shared-job-editor") {
    return withRouteSuspense(
      <LazySharedJobEditorPage
        token={token}
        currentUser={currentUser}
        departmentType={route.render.department}
        routeBase={route.render.routeBase}
        mode={route.render.mode}
      />,
      route.render.department === "schools" ? "Loading school job editor" : route.render.department === "sports" ? "Loading sports job editor" : "Loading job editor",
      "Opening the shared job create and edit shell."
    );
  }

  if (route.render.kind === "shared-job-detail") {
    return withRouteSuspense(
      <LazySharedJobDetailPage
        token={token}
        currentUser={currentUser}
        departmentType={route.render.department}
        routeBase={route.render.routeBase}
      />,
      route.render.department === "schools" ? "Loading school job detail" : route.render.department === "sports" ? "Loading sports job detail" : "Loading job detail",
      "Opening the shared job detail shell."
    );
  }

  if (route.render.kind === "shared-task-page") {
    return withRouteSuspense(
      <LazySharedTaskPage token={token} currentUser={currentUser} mode={route.render.mode} />,
      route.render.mode === "create" ? "Loading task create" : "Loading task detail",
      route.render.mode === "create" ? "Opening the shared task create shell." : "Opening the shared task detail shell."
    );
  }

  if (route.render.kind === "sports-overview") {
    return withRouteSuspense(
      <LazySportsOverview token={token} currentUser={currentUser} />,
      "Loading sports",
      "Opening the sports overview."
    );
  }

  if (route.render.kind === "sports-accounts") {
    return withRouteSuspense(
      <LazySportsAccounts token={token} currentUser={currentUser} />,
      "Loading sports accounts",
      "Opening the sports account workspace."
    );
  }

  if (route.render.kind === "sports-contacts") {
    return withRouteSuspense(
      <LazySportsContacts token={token} currentUser={currentUser} />,
      "Loading sports contacts",
      "Opening the sports contact workspace."
    );
  }

  if (route.render.kind === "sports-graphics") {
    return withRouteSuspense(
      <LazySharedProductionPage
        token={token}
        currentUser={currentUser}
        departmentType="sports"
        routeBase="#sports/jobs"
        title="Sports Graphics"
        summary="Shared downstream graphics queue for proofs, specialty products, approvals, QA, blocked work, and delivery follow-through tied to sports jobs."
      />,
      "Loading sports graphics",
      "Opening the sports graphics queue."
    );
  }

  if (route.render.kind === "sports-peer-qa") {
    return withRouteSuspense(
      <LazySportsPeerQaBoard token={token} />,
      "Loading Sports peer QA",
      "Opening the Sports peer-to-peer QA board."
    );
  }

  if (route.render.kind === "sports-reports") {
    return withRouteSuspense(
      <LazySportsReports token={token} currentUser={currentUser} />,
      "Loading sports reports",
      "Opening sports reporting."
    );
  }

  if (route.render.kind === "sports-settings") {
    return withRouteSuspense(
      <LazySportsSettings token={token} currentUser={currentUser} />,
      "Loading sports settings",
      "Opening the sports settings workspace."
    );
  }

  if (route.render.kind === "central-job-import") {
    return withRouteSuspense(
      <LazyCentralJobImportPage
        token={token}
        currentUser={currentUser}
        department={route.render.department}
        contextLabel={route.render.contextLabel}
        routeHash={route.render.routeHash}
        returnHash={route.render.returnHash}
      />,
      "Loading bulk import",
      "Opening the staged import workspace."
    );
  }

  if (route.render.kind === "operations-exceptions") {
    return withRouteSuspense(
      <LazyOperationsExceptions token={token} currentUser={currentUser} />,
      "Loading exceptions",
      "Opening the operations exceptions queue."
    );
  }

  if (route.render.kind === "urgent-window") {
    return withRouteSuspense(
      <LazyUrgentWindow token={token} currentUser={currentUser} />,
      "Loading Urgent Window",
      "Opening the Urgent Window."
    );
  }

  if (route.render.kind === "operations-control-room") {
    return withRouteSuspense(
      <LazyOperations token={token} currentUser={currentUser} socket={socket} />,
      "Loading operations",
      "Opening the live operations control room."
    );
  }

  if (route.render.kind === "project-tracking-command-center") {
    return withRouteSuspense(
      <LazyProjectTrackingFoundation token={token} currentUser={currentUser} />,
      "Loading project tracking",
      "Opening the project workflow command center."
    );
  }

  if (route.render.kind === "prep-readiness-queue") {
    return withRouteSuspense(
      <LazyPrepReadinessQueuePage token={token} currentUser={currentUser} />,
      "Loading Prep Readiness",
      "Opening the prep data completion queue."
    );
  }

  if (route.render.kind === "production-workflow-queue") {
    return withRouteSuspense(
      <LazyProductionWorkflowQueue token={token} currentUser={currentUser} />,
      "Loading Production Queue",
      "Opening handoff-backed Production work."
    );
  }

  if (route.render.kind === "production-hub") {
    return withRouteSuspense(
      <LazyProductionHub token={token} currentUser={currentUser} />,
      "Loading Production",
      "Opening the Production department hub."
    );
  }

  if (route.render.kind === "production-operations") {
    return withRouteSuspense(
      <LazyProductionOperationsView token={token} />,
      "Loading Production Queue",
      "Opening the canonical Production operating queue."
    );
  }

  if (route.render.kind === "schools-leadership-operations") {
    return withRouteSuspense(
      <LazySchoolsLeadershipOperations token={token} />,
      "Loading Schools Leadership",
      "Opening the canonical Schools leadership operating view."
    );
  }

  if (route.render.kind === "labor-command-center") {
    return withRouteSuspense(
      <LazyLaborCommandCenter token={token} />,
      "Loading Labor Command Center",
      "Opening the payroll period, self-check, and overtime command surface."
    );
  }

  if (route.render.kind === "payroll-self-check") {
    return withRouteSuspense(
      <LazyPayrollSelfCheck token={token} />,
      "Loading Payroll Self-Check",
      "Opening your pay period review."
    );
  }

  if (route.render.kind === "ask-bailey") {
    return withRouteSuspense(
      <LazyAskBailey token={token} />,
      "Loading Ask Bailey",
      "Bailey is checking the playbook…"
    );
  }

  if (route.render.kind === "knowledge-review") {
    return withRouteSuspense(
      <LazyKnowledgeReview token={token} />,
      "Loading Knowledge Review",
      "Opening the knowledge-owner review queues."
    );
  }

  if (route.render.kind === "knowledge-sources") {
    return withRouteSuspense(
      <LazyKnowledgeSources token={token} />,
      "Loading Knowledge Sources",
      "Opening the knowledge authoring workspace."
    );
  }

  if (route.render.kind === "knowledge-source-detail") {
    return withRouteSuspense(
      <LazyKnowledgeSourceDetail token={token} />,
      "Loading knowledge source",
      "Opening the governed source record."
    );
  }

  if (route.render.kind === "my-training") {
    return withRouteSuspense(<LazyMyTraining token={token} />, "Loading my training", "Opening your assigned lessons.");
  }

  if (route.render.kind === "training-lessons") {
    return withRouteSuspense(
      <LazyTrainingLessons token={token} />,
      "Loading training lessons",
      "Opening the governed lesson desk."
    );
  }

  if (route.render.kind === "ask-bailey-observability") {
    return withRouteSuspense(
      <LazyAskBaileyObservability token={token} />,
      "Loading Ask Bailey health",
      "Opening production telemetry and the release gate."
    );
  }

  if (route.render.kind === "workflow-template-builder") {
    return withRouteSuspense(
      <LazyWorkflowTemplateBuilderPage token={token} currentUser={currentUser} />,
      "Loading workflow templates",
      "Opening the leadership workflow template builder."
    );
  }

  if (route.render.kind === "client-command-center") {
    return withRouteSuspense(
      <LazyClientCommandCenter token={token} currentUser={currentUser} />,
      "Loading client command center",
      "Opening the customer context layer."
    );
  }

  if (route.render.kind === "job-closeout-v1") {
    return withRouteSuspense(
      <LazyJobCloseoutV1 token={token} currentUser={currentUser} />,
      "Loading job closeout",
      "Opening the post-shoot closeout and operations reporting foundation."
    );
  }

  if (route.render.kind === "staff-assignment-board") {
    return withRouteSuspense(
      <LazyStaffAssignmentBoard token={token} currentUser={currentUser} socket={socket} />,
      "Loading staff assignment board",
      "Opening date-first staffing."
    );
  }

  if (route.render.kind === "staffing-capacity-planning") {
    return withRouteSuspense(
      <LazyStaffingCapacityPlanning token={token} currentUser={currentUser} socket={socket} />,
      "Loading capacity planning",
      "Opening staffing capacity by day, week, and month."
    );
  }

  if (route.render.kind === "scheduling-workspace") {
    if (route.render.area === "calendar" || route.render.area === "staffing") {
      return withRouteSuspense(
        <LazySchedule token={token} currentUser={currentUser} />,
        "Loading schedule",
        "Opening the master schedule workspace."
      );
    }
    return withRouteSuspense(
      <LazyScheduling token={token} currentUser={currentUser} socket={socket} initialArea={route.render.area} />,
      "Loading scheduling",
      "Opening the scheduling workspace."
    );
  }

  if (route.render.kind === "schedule-workspace") {
    return withRouteSuspense(
      <LazySchedule token={token} currentUser={currentUser} />,
      "Loading schedule",
      "Opening the schedule workspace."
    );
  }

  if (route.render.kind === "files-workspace") {
    return withRouteSuspense(
      <LazyProductionAssetsPage token={token} currentUser={currentUser} />,
      "Loading files",
      "Opening the files compatibility workspace."
    );
  }

  if (route.render.kind === "admin-system") {
    return withRouteSuspense(
      <LazySystemDiagnosticsPage token={token} currentUser={currentUser} view={route.render.view} />,
      "Loading system diagnostics",
      "Opening the shared audit, diagnostics, and debug workspace."
    );
  }

  if (route.render.kind === "tab") {
    switch (route.render.tab) {
      case "my-work":
        return withRouteSuspense(
          <LazyMyWork token={token} currentUser={currentUser} socket={socket} />,
          "Loading my work",
          "Opening your personal work surface."
        );
      case "dashboard":
        return <Dashboard token={token} currentUser={currentUser} socket={socket} onOpenConcierge={onOpenConcierge} />;
      case "shoots":
        return withRouteSuspense(
          <LazyLiveShoots
            token={token}
            currentUser={currentUser}
            socket={socket}
            realtimeStatus={realtimeStatus}
            workspaceMode={route.sectionKey === "photography" || route.sectionKey === "studios" ? "photography" : "operations"}
          />,
          "Loading shoots",
          "Opening the live shoots workspace."
        );
      case "projects":
        {
          // Internal shell note:
          // `projects` remains the Graphics workspace tab. The external account-facing
          // portal route plan also uses `/projects/...`, but it is owned by the
          // Microsoft client portal runtime outside the admin-web hash shell.
          const productionPage =
            routeId === "graphics-queue"
                ? {
                    departmentType: null,
                    routeBase: "#jobs",
                    title: "Graphics Queue",
                    summary: "New or unowned downstream work waiting on intake, ingest, owner assignment, or kickoff inside the shared production engine."
                  }
                : routeId === "graphics-qa"
                  ? {
                      departmentType: null,
                      routeBase: "#jobs",
                      title: "Graphics QA",
                      summary: "Shared QA and peer-review queue for downstream work waiting on review, recheck, or corrective follow-through."
                    }
                  : routeId === "graphics-release"
                    ? {
                        departmentType: null,
                        routeBase: "#jobs",
                        title: "Graphics Deliveries",
                        summary: "Final downstream release and delivery queue for work that is approaching send, handoff, or client confirmation."
                      }
                    : routeId === "graphics-workload"
                      ? {
                          departmentType: null,
                          routeBase: "#jobs",
                          title: "Graphics Workload",
                          summary: "Owner-focused workload view across the shared downstream production queue."
                        }
                      : {
                          departmentType: null,
                          routeBase: "#jobs",
                          title: "Graphics",
                          summary: "Shared downstream graphics workspace for ingest, editing, approvals, QA, specialty products, deliverables, and completion."
                        };
        return withRouteSuspense(
          <LazySharedProductionPage token={token} currentUser={currentUser} {...productionPage} />,
          "Loading graphics",
          "Opening the graphics workspace."
        );
        }
      case "profitability":
        return withRouteSuspense(
          <LazyProfitability token={token} currentUser={currentUser} />,
          "Loading profitability",
          "Opening the leadership profitability workspace."
        );
      case "alerts":
        return withRouteSuspense(<LazyAlerts token={token} socket={socket} />, "Loading alerts", "Opening the alerts workspace.");
      case "reports":
        return withRouteSuspense(
          <LazyReports token={token} currentUser={currentUser} />,
          "Loading reports",
          "Opening the reports workspace."
        );
      case "sales":
        return withRouteSuspense(
          <LazySalesPipeline token={token} currentUser={currentUser} />,
          "Loading sales",
          "Opening the sales pipeline."
        );
      case "customer-service":
        return withRouteSuspense(
          <LazyCustomerService token={token} currentUser={currentUser} />,
          "Loading customer service",
          "Opening the customer service workspace."
        );
      case "training":
        return withRouteSuspense(
          <LazyTraining token={token} currentUser={currentUser} />,
          "Loading training",
          "Opening the training workspace."
        );
      case "outlook":
        return withRouteSuspense(
          <LazyOutlookIntegration token={token} currentUser={currentUser} socket={socket} />,
          "Loading outlook",
          "Opening the Outlook integration workspace."
        );
      case "organizations":
        return withRouteSuspense(
          <LazyOrganizations token={token} currentUser={currentUser} entryView="organizations" />,
          "Loading organizations",
          "Opening the organizations workspace."
        );
      case "contacts":
        return withRouteSuspense(
          <LazyOrganizations token={token} currentUser={currentUser} entryView="contacts" />,
          "Loading contacts",
          "Opening the contacts workspace."
        );
      case "gear":
        return withRouteSuspense(
          <LazyGear token={token} currentUser={currentUser} />,
          "Loading gear",
          "Opening the gear workspace."
        );
      case "locations":
        return withRouteSuspense(
          <LazyShootLocations token={token} currentUser={currentUser} />,
          "Loading locations",
          "Opening the locations workspace."
        );
      case "calendar":
        return withRouteSuspense(
          <LazySchedule token={token} currentUser={currentUser} />,
          "Loading schedule",
          "Opening the schedule workspace."
        );
      case "labor":
        return withRouteSuspense(
          <LazyLabor token={token} currentUser={currentUser} socket={socket} />,
          "Loading labor",
          "Opening the labor workspace."
        );
      case "payroll":
        return withRouteSuspense(
          <LazyPayrollReview token={token} currentUser={currentUser} socket={socket} />,
          "Loading payroll review",
          "Opening the payroll review workspace."
        );
      case "time":
        return withRouteSuspense(
          <LazyAttendance token={token} currentUser={currentUser} socket={socket} />,
          "Loading attendance",
          "Opening the attendance desk."
        );
      case "compliance":
        return withRouteSuspense(
          <LazyCompliance token={token} currentUser={currentUser} socket={socket} />,
          "Loading compliance",
          "Opening the compliance workspace."
        );
      case "approvals":
        return withRouteSuspense(
          <LazyApprovals token={token} currentUser={currentUser} socket={socket} />,
          "Loading approvals",
          "Opening the approvals workspace."
        );
      case "status-board":
      case "status-board-display":
        return withRouteSuspense(
          <LazyStatusBoard token={token} socket={socket} presentationMode={routeId === "status-board-display"} />,
          "Loading status board",
          "Opening the status board."
        );
      case "access":
        return withRouteSuspense(
          <LazyAccessControl token={token} currentUser={currentUser} />,
          "Loading access control",
          "Opening the access control workspace."
        );
      case "admin-config":
        return withRouteSuspense(
          <LazyAdminSettings token={token} currentUser={currentUser} routeId={routeId} />,
          "Loading admin settings",
          "Opening the admin settings workspace."
        );
      case "security":
        return withRouteSuspense(
          <LazySecurityCenter token={token} currentUser={currentUser} />,
          "Loading security",
          "Opening the security workspace."
        );
      case "account":
        return (
          <MyAccount
            token={token}
            user={currentUser}
            theme={theme}
            onThemeChange={onThemeChange}
            onSessionUpdated={onSessionUpdated}
            onLoggedOut={onLoggedOut}
          />
        );
      default:
        break;
    }
  }

  return (
    <HashRedirect
      targetHash={sectionLandingCards[0]?.hash ?? "#home"}
      title={`Redirecting ${route.label}`}
      summary="Opening the nearest canonical workspace because this shell route no longer owns a standalone surface."
    />
  );
}

function buildDesktopNavGroups(sections: ShellSection[]) {
  return [
    {
      id: "start",
      label: "Start Here",
      keys: ["home"] as const
    },
    {
      id: "spine",
      label: "Work",
      keys: ["project-tracking", "schedule", "contacts", "jobs"] as const
    },
    {
      id: "departments",
      label: "Departments",
      keys: ["schools", "sports", "photography", "production"] as const
    },
    {
      id: "company",
      label: "Company",
      keys: ["hr-admin", "leadership", "settings", "admin"] as const
    }
  ]
    .map((group) => ({
      id: group.id,
      label: group.label,
      sections: group.keys
        .map((key) => sections.find((section) => section.key === key) ?? null)
        .filter((section): section is ShellSection => Boolean(section))
    }))
    .filter((group) => group.sections.length > 0);
}

function ShellSidebarIcon({ sectionKey }: { sectionKey: ShellSection["key"] }) {
  const iconProps = {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "shell-sidebar__route-icon",
    "aria-hidden": true
  };

  switch (sectionKey) {
    case "home":
      return (
        <svg {...iconProps}>
          <path d="M3.75 8.2 10 3.75l6.25 4.45v7.05a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1Z" />
          <path d="M8 16.25v-4.5h4v4.5" />
        </svg>
      );
    case "my-work":
    case "needs-attention":
      return (
        <svg {...iconProps}>
          <path d="M5 4.75h10v10.5H5z" />
          <path d="M7.25 8.25h5.5" />
          <path d="M7.25 11.25h3.5" />
        </svg>
      );
    case "schools":
    case "sports":
    case "photography":
      return (
        <svg {...iconProps}>
          <path d="M3.75 6.25 10 3.75l6.25 2.5L10 8.75Z" />
          <path d="M6 8.9v4.85" />
          <path d="M10 8.9v4.85" />
          <path d="M14 8.9v4.85" />
          <path d="M4 15.25h12" />
        </svg>
      );
    case "production":
    case "project-tracking":
    case "jobs":
    case "schedule":
    case "leadership":
      return (
        <svg {...iconProps}>
          <path d="M4.25 14.5h2.6l2.2-4.6 2.15 3.1 1.65-2.4h2.9" />
          <path d="M4.25 5.5h11.5" opacity="0.45" />
          <path d="M4.25 17h11.5" opacity="0.45" />
        </svg>
      );
    case "contacts":
    case "hr-admin":
    case "settings":
    case "admin":
      return (
        <svg {...iconProps}>
          <circle cx="10" cy="10" r="2.3" />
          <path d="M10 4.15v1.5" />
          <path d="M10 14.35v1.5" />
          <path d="M15.85 10h-1.5" />
          <path d="M5.65 10h-1.5" />
          <path d="m14.15 5.85-1.05 1.05" />
          <path d="m6.9 13.1-1.05 1.05" />
          <path d="m14.15 14.15-1.05-1.05" />
          <path d="M6.9 6.9 5.85 5.85" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
          <circle cx="10" cy="10" r="5.75" />
          <path d="M10 6.75v3.5l2.25 1.35" />
        </svg>
      );
  }
}

export function getAvailableTabs(user: SessionUser | null): TabKey[] {
  if (!user) {
    return ["dashboard"];
  }
  const orderedTabs: TabKey[] = [
    "my-work",
    "dashboard",
    "reports",
    "profitability",
    "sales",
    "customer-service",
    "training",
    "outlook",
    "organizations",
    "contacts",
    "gear",
    "locations",
    "calendar",
    "shoots",
    "projects",
    "alerts",
    "labor",
    "payroll",
    "time",
    "compliance",
    "approvals",
    "status-board",
    "access",
    "admin-config",
    "security",
    "account"
  ];

  const tabs = orderedTabs.filter((tab) => canAccessTab(user, tab));
  if (shouldLimitToEmployeeWorksurface(user)) {
    return tabs.filter((tab) => ["my-work", "dashboard", "training", "contacts", "locations", "gear", "calendar", "account", "approvals"].includes(tab));
  }
  return tabs;
}

export function getPrimarySections(availableTabs: TabKey[], employeeOnlyMode: boolean): ShellSection[] {
  return getPrimarySectionsFromNavigation(availableTabs, employeeOnlyMode);
}

function ensureAccessibleRoute(
  user: SessionUser,
  nextRouteId: ShellRouteId,
  availableTabs: TabKey[],
  employeeOnlyMode: boolean,
  preferTeamsHome = false
) {
  if (canAccessRoute(user, nextRouteId)) {
    return nextRouteId;
  }
  return getAccessibleFallbackRoute(user, availableTabs, employeeOnlyMode, preferTeamsHome);
}

function getAccessibleFallbackRoute(user: SessionUser, availableTabs: TabKey[], employeeOnlyMode: boolean, preferTeamsHome = false) {
  if (preferTeamsHome && canAccessRoute(user, "teams-home")) {
    return "teams-home";
  }
  const preferredRouteId = getDefaultLandingRoute(user);
  if (canAccessRoute(user, preferredRouteId)) {
    return preferredRouteId;
  }
  const navigationFallback = getDefaultRouteId(availableTabs, employeeOnlyMode);
  if (canAccessRoute(user, navigationFallback)) {
    return navigationFallback;
  }
  const accessiblePrimarySection = getPrimarySectionsFromNavigation(availableTabs, employeeOnlyMode).find((section) =>
    canAccessSection(user, section.key)
  );
  if (accessiblePrimarySection?.routeId && canAccessRoute(user, accessiblePrimarySection.routeId)) {
    return accessiblePrimarySection.routeId;
  }
  return "dashboard";
}

type MobileBottomNavItem =
  | {
      id: string;
      label: string;
      kind: "route";
      routeId: ShellRouteId;
    }
  | {
      id: string;
      label: string;
      kind: "more";
    };

function shouldUseMobileBottomNav(user: SessionUser, mobileShell: boolean) {
  return mobileShell && shouldLimitToEmployeeWorksurface(user);
}

function buildMobileBottomNavItems(user: SessionUser): MobileBottomNavItem[] {
  return [
    // Employees' home is their LIVE work surface (#my-work), never the leadership
    // dashboard shell — this nav only renders for employee-worksurface users.
    { id: "mobile-home", label: "My Work", kind: "route", routeId: resolveMobileRoute(user, ["dashboard-my-day", "dashboard"]) },
    {
      id: "mobile-schedule",
      label: "Schedule",
      kind: "route",
      routeId: resolveMobileRoute(user, ["dashboard-my-schedule", "operations-schedule", "dashboard"])
    },
    {
      id: "mobile-requests",
      label: "Requests",
      kind: "route",
      routeId: resolveMobileRoute(user, ["people-ops-requests", "dashboard-alerts", "dashboard"])
    },
    { id: "mobile-more", label: "More", kind: "more" }
  ];
}

function buildMobileMoreLinks(user: SessionUser) {
  return [
    "dashboard-my-day",
    "dashboard-my-schedule",
    "search",
    "dashboard-alerts",
    "people-ops-requests",
    "people-ops-training",
    "directory-internal",
    "directory-contacts",
    "directory-locations",
    "admin-settings"
  ]
    .filter((routeId) => canAccessRoute(user, routeId))
    .map((routeId) => {
      const route = getRouteById(routeId);
      return {
        id: route.id,
        label: route.label,
        description: route.description
      };
    });
}

function resolveMobileRoute(user: SessionUser, candidates: ShellRouteId[]) {
  return candidates.find((routeId) => canAccessRoute(user, routeId)) ?? "dashboard";
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getRealtimeStatusLabel(status: "connecting" | "connected" | "error") {
  if (status === "connected") {
    return "Connected";
  }
  return humanizeLabel(status);
}

function isDemoAdminShellUser(user: SessionUser) {
  return user.fullName.trim().toLowerCase() === "demo admin";
}

function getShellUserName(user: SessionUser) {
  return isDemoAdminShellUser(user) ? "Mission Control User" : user.fullName;
}

function getShellAuthorityLabel(user: SessionUser) {
  return isDemoAdminShellUser(user) ? "Team Member" : humanizeLabel(user.authorityTier);
}

function getShellRoleLabel(user: SessionUser) {
  const label = humanizeLabel(user.primaryJobFunctionProfile);
  return isDemoAdminShellUser(user) || label.toLowerCase() === "demo admin" ? "Team Member" : label;
}

function matchesMobileShell() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(max-width: 860px)").matches;
}

function getInitialTheme(): ThemeMode {
  const stored = window.localStorage.getItem("pmc-theme");
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return "dark";
}

function getInitialRouteId(): ShellRouteId {
  if (detectTeamsMode() && !window.location.hash) {
    return "teams-home";
  }
  return resolveRouteId(window.location.hash, ["dashboard"], false);
}

function consumeMicrosoftAuthCallback() {
  const hash = window.location.hash;
  if (!hash.startsWith("#auth/callback")) {
    return null;
  }

  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
  return {
    status: params.get("status") ?? "",
    token: params.get("token") ?? "",
    notice: params.get("notice") ?? "",
    reason: params.get("reason") ?? "",
    returnHash: params.get("return_hash")?.startsWith("#") ? params.get("return_hash") : ""
  };
}

function getTrustLabel(user: SessionUser) {
  if (user.sessionTrust.breakGlassModeActive) {
    return "Break Glass";
  }
  if (user.sessionTrust.elevatedSessionActive) {
    return "Elevated";
  }
  return "Standard";
}

function isAuthFailure(error: unknown) {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403);
}
