import type { PoolClient } from "pg";
import {
  canViewLeadershipReports,
  hasAuthorityTier,
  hasJobFunctionProfile,
  hasPermissionCode,
  isDepartmentScopedScheduler,
  isOwnOnlyScheduleUser
} from "../authz/authority.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import type { OperatingSystemVisibilityOverrideConfig } from "../types/adminConfiguration.js";
import { OPERATING_SYSTEM_MODULE_KEYS } from "../types/operatingSystem.js";
import type {
  HomeWidgetVisibilityKey,
  OperatingSystemAccessProfile,
  OperatingSystemModuleAccess,
  OperatingSystemModuleKey,
  OperatingSystemQueryScope,
  OperatingSystemRoleTemplate,
  OperatingSystemScopeLevel
} from "../types/operatingSystem.js";
import { getDefaultOperatingSystemRouteModule, getOperatingSystemVisibilityOverrides } from "./adminConfiguration.js";

type AccessSubject = Pick<AuthUser, "id" | "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles">;
type ConfiguredAccessSubject = AccessSubject & Pick<AuthUser, "tenantId" | "internalRoleGroups">;

const MODULE_ROUTE_PATHS: Record<OperatingSystemModuleKey, string> = {
  home: "/home",
  operations: "/operations",
  exceptions: "/operations/exceptions",
  urgent_watch: "/operations/exceptions",
  scheduling: "/scheduling",
  schedule: "/schedule",
  production: "/production",
  approvals: "/approvals",
  reports: "/reports"
};

const MODULE_DESCRIPTIONS: Record<OperatingSystemModuleKey, string> = {
  home: "Role-aware front door for what matters right now.",
  operations: "Manager and lead execution layer for live day-of operations.",
  exceptions: "Operator exception center for work that needs human follow-through.",
  urgent_watch: "Legacy alias for the exception center.",
  scheduling: "Planning and staffing control layer for schedule owners.",
  schedule: "Assignment and calendar visibility tied to each user or team scope.",
  production: "Post-shoot production management and delivery pressure surface.",
  approvals: "Decision queue for requests, exceptions, and protected review actions.",
  reports: "Trend and outlier reporting for scoped managers and leadership."
};

const MANAGER_ONLY_MODULES = new Set<OperatingSystemModuleKey>(["operations", "exceptions", "urgent_watch", "scheduling", "reports"]);

function isLeadershipAccess(auth: AccessSubject) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]);
}

function isProductionManagementProfile(auth: AccessSubject) {
  return (
    hasJobFunctionProfile(auth, "director_of_digital_production") ||
    (auth.department === "production" && hasAuthorityTier(auth, "supervisor"))
  );
}

function isSchedulingLeadProfile(auth: AccessSubject) {
  return (
    hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"]) ||
    (["schools", "sports", "customer_service", "office"].includes(String(auth.department)) &&
      hasAuthorityTier(auth, "supervisor")) ||
    hasPermissionCode(auth, "schedule.manage")
  );
}

function isOperationsLeadProfile(auth: AccessSubject) {
  return (
    hasJobFunctionProfile(auth, [
      "senior_photographer",
      "director_of_photography",
      "director_of_school_photography",
      "director_of_sports_photography"
    ]) ||
    (auth.department === "operations" && hasAuthorityTier(auth, "supervisor"))
  );
}

function isDepartmentManager(auth: AccessSubject) {
  return hasAuthorityTier(auth, "supervisor") && !isProductionManagementProfile(auth) && !isSchedulingLeadProfile(auth) && !isOperationsLeadProfile(auth);
}

export function getOperatingSystemRoleTemplate(auth: AccessSubject): OperatingSystemRoleTemplate {
  if (isLeadershipAccess(auth)) {
    return "leadership";
  }
  if (isOperationsLeadProfile(auth)) {
    return "operations_lead";
  }
  if (isSchedulingLeadProfile(auth)) {
    return "scheduling_lead";
  }
  if (isProductionManagementProfile(auth)) {
    return "production_manager";
  }
  if (isDepartmentManager(auth)) {
    return "department_manager";
  }
  return "standard_employee";
}

export function getOperatingSystemScope(auth: AccessSubject, module: OperatingSystemModuleKey): OperatingSystemScopeLevel {
  switch (module) {
    case "home":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (
        isOperationsLeadProfile(auth) ||
        isSchedulingLeadProfile(auth) ||
        isProductionManagementProfile(auth) ||
        isDepartmentManager(auth)
      ) {
        return "department";
      }
      if (
        (isOwnOnlyScheduleUser(auth) &&
          (hasPermissionCode(auth, "dashboard.read") ||
            hasPermissionCode(auth, "schedule.read") ||
            hasPermissionCode(auth, "notification.read"))) ||
        hasPermissionCode(auth, "dashboard.read") ||
        hasPermissionCode(auth, "schedule.read")
      ) {
        return "own";
      }
      return "none";
    case "operations":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (isOperationsLeadProfile(auth) || isSchedulingLeadProfile(auth) || isDepartmentManager(auth)) {
        return "department";
      }
      return "none";
    case "exceptions":
    case "urgent_watch":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (
        isOperationsLeadProfile(auth) ||
        isSchedulingLeadProfile(auth) ||
        isProductionManagementProfile(auth) ||
        isDepartmentManager(auth)
      ) {
        return "department";
      }
      return "none";
    case "scheduling":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (isSchedulingLeadProfile(auth) || isDepartmentManager(auth)) {
        return "department";
      }
      return "none";
    case "schedule":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (isDepartmentScopedScheduler(auth) || hasPermissionCode(auth, "schedule.manage")) {
        return "department";
      }
      if ((isOwnOnlyScheduleUser(auth) && hasPermissionCode(auth, "schedule.read")) || hasPermissionCode(auth, "schedule.read")) {
        return "own";
      }
      return "none";
    case "production":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (isProductionManagementProfile(auth)) {
        return "department";
      }
      if (
        hasJobFunctionProfile(auth, "graphic_artist") ||
        hasPermissionCode(auth, "production_projects.view") ||
        hasPermissionCode(auth, "production.view") ||
        hasPermissionCode(auth, "project.read") ||
        hasPermissionCode(auth, "projects.read")
      ) {
        return "own";
      }
      return "none";
    case "approvals":
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      if (
        hasAuthorityTier(auth, "supervisor") ||
        hasPermissionCode(auth, "attendance.manage") ||
        hasPermissionCode(auth, "attendance_exceptions.approve") ||
        hasPermissionCode(auth, "missed_punches.approve") ||
        hasPermissionCode(auth, "pto.approve") ||
        hasPermissionCode(auth, "trade.approve")
      ) {
        return "department";
      }
      if (
        hasPermissionCode(auth, "trade.request") ||
        hasPermissionCode(auth, "pto.request") ||
        hasPermissionCode(auth, "approval.read")
      ) {
        return "own";
      }
      return "none";
    case "reports":
      if (!canViewLeadershipReports(auth)) {
        return "none";
      }
      if (isLeadershipAccess(auth)) {
        return "all";
      }
      return hasAuthorityTier(auth, "supervisor") || hasPermissionCode(auth, "reporting_exports.view") ? "department" : "none";
    default:
      return "none";
  }
}

export function canManageOperatingSystemModule(auth: AccessSubject, module: OperatingSystemModuleKey) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return module !== "home";
  }
  switch (module) {
    case "home":
      return false;
    case "operations":
    case "exceptions":
    case "urgent_watch":
      return isOperationsLeadProfile(auth) || isSchedulingLeadProfile(auth) || isDepartmentManager(auth);
    case "scheduling":
      return isSchedulingLeadProfile(auth) || hasPermissionCode(auth, "schedule.manage");
    case "schedule":
      return hasPermissionCode(auth, "schedule.manage");
    case "production":
      return isProductionManagementProfile(auth) || hasPermissionCode(auth, "production.manage") || hasPermissionCode(auth, "project.manage");
    case "approvals":
      return (
        hasAuthorityTier(auth, "supervisor") ||
        hasPermissionCode(auth, "attendance.manage") ||
        hasPermissionCode(auth, "attendance_exceptions.approve") ||
        hasPermissionCode(auth, "missed_punches.approve")
      );
    case "reports":
      return hasPermissionCode(auth, "reports.manage") || hasPermissionCode(auth, "reporting_exports.export");
    default:
      return false;
  }
}

export function getOperatingSystemQueryScope(auth: AccessSubject, module: OperatingSystemModuleKey): OperatingSystemQueryScope {
  const level = getOperatingSystemScope(auth, module);
  return {
    module,
    level,
    department: level === "department" ? (auth.department as DepartmentCode) : null,
    actor_user_id: level === "own" ? auth.id : null
  };
}

function buildModuleAccess(auth: AccessSubject, module: OperatingSystemModuleKey): OperatingSystemModuleAccess {
  const scope = getOperatingSystemScope(auth, module);
  return {
    module,
    can_view: scope !== "none",
    can_manage: scope !== "none" && canManageOperatingSystemModule(auth, module),
    scope,
    route_path: MODULE_ROUTE_PATHS[module],
    description: MODULE_DESCRIPTIONS[module],
    manager_only: MANAGER_ONLY_MODULES.has(module)
  };
}

function buildHomeWidgetVisibility(access: Record<OperatingSystemModuleKey, OperatingSystemModuleAccess>) {
  const visibility = {} as Record<HomeWidgetVisibilityKey, boolean>;

  visibility.personal_schedule = access.schedule.can_view;
  visibility.urgent_watch = access.exceptions.can_view;
  visibility.operations_overview = access.operations.can_view;
  visibility.scheduling_overview = access.scheduling.can_view;
  visibility.production_overview = access.production.can_view;
  visibility.approvals_overview = access.approvals.can_view;
  visibility.reports_overview = access.reports.can_view;

  return visibility;
}

export function getDefaultOperatingSystemRoutePath(auth: AccessSubject) {
  const access = getOperatingSystemModuleAccessMap(auth);
  const module = pickDefaultOperatingSystemModule(access);
  return module ? access[module].route_path : "/home";
}

export function getOperatingSystemVisibilityMatrix(auth: AccessSubject) {
  return OPERATING_SYSTEM_MODULE_KEYS.map((module) => buildModuleAccess(auth, module));
}

export function getOperatingSystemModuleAccessMap(auth: AccessSubject) {
  return Object.fromEntries(
    getOperatingSystemVisibilityMatrix(auth).map((entry) => [entry.module, entry])
  ) as Record<OperatingSystemModuleKey, OperatingSystemModuleAccess>;
}

export function getOperatingSystemAccessProfile(auth: AccessSubject): OperatingSystemAccessProfile {
  const visibilityMatrix = getOperatingSystemVisibilityMatrix(auth);
  const moduleAccess = Object.fromEntries(visibilityMatrix.map((entry) => [entry.module, entry])) as Record<
    OperatingSystemModuleKey,
    OperatingSystemModuleAccess
  >;
  return {
    role_template: getOperatingSystemRoleTemplate(auth),
    default_route_path: getDefaultOperatingSystemRoutePath(auth),
    module_access: moduleAccess,
    visibility_matrix: visibilityMatrix,
    query_scopes: {
      home: getOperatingSystemQueryScope(auth, "home"),
      operations: getOperatingSystemQueryScope(auth, "operations"),
      exceptions: getOperatingSystemQueryScope(auth, "exceptions"),
      urgent_watch: getOperatingSystemQueryScope(auth, "urgent_watch"),
      scheduling: getOperatingSystemQueryScope(auth, "scheduling"),
      schedule: getOperatingSystemQueryScope(auth, "schedule"),
      production: getOperatingSystemQueryScope(auth, "production"),
      approvals: getOperatingSystemQueryScope(auth, "approvals"),
      reports: getOperatingSystemQueryScope(auth, "reports")
    },
    home_widget_visibility: buildHomeWidgetVisibility(moduleAccess)
  };
}

function pickDefaultOperatingSystemModule(
  access: Record<OperatingSystemModuleKey, OperatingSystemModuleAccess>,
  preferred?: OperatingSystemModuleKey | null
) {
  if (preferred && access[preferred]?.can_view) {
    return preferred;
  }
  const ordered: OperatingSystemModuleKey[] = ["home", "operations", "exceptions", "schedule", "production", "approvals", "reports"];
  return ordered.find((entry) => access[entry].can_view) ?? null;
}

export function applyOperatingSystemAccessConfiguration(
  profile: OperatingSystemAccessProfile,
  input: {
    visibilityOverrides: OperatingSystemVisibilityOverrideConfig;
    defaultRouteModule: OperatingSystemModuleKey;
  }
): OperatingSystemAccessProfile {
  const hiddenModules = new Set(input.visibilityOverrides.hidden_modules);
  if (hiddenModules.has("exceptions")) {
    hiddenModules.add("urgent_watch");
  }
  if (hiddenModules.has("urgent_watch")) {
    hiddenModules.add("exceptions");
  }
  const hiddenHomeWidgets = new Set<HomeWidgetVisibilityKey>(input.visibilityOverrides.hidden_home_widgets);
  const moduleAccess = { ...profile.module_access };
  const queryScopes = { ...profile.query_scopes };

  for (const moduleKey of OPERATING_SYSTEM_MODULE_KEYS) {
    if (!hiddenModules.has(moduleKey)) {
      continue;
    }
    moduleAccess[moduleKey] = {
      ...moduleAccess[moduleKey],
      can_view: false,
      can_manage: false,
      scope: "none"
    };
    queryScopes[moduleKey] = {
      ...queryScopes[moduleKey],
      level: "none",
      department: null,
      actor_user_id: null
    };
  }

  const homeWidgetVisibility = buildHomeWidgetVisibility(moduleAccess);
  for (const widgetKey of Object.keys(homeWidgetVisibility) as HomeWidgetVisibilityKey[]) {
    if (hiddenHomeWidgets.has(widgetKey)) {
      homeWidgetVisibility[widgetKey] = false;
    }
  }

  const visibilityMatrix = OPERATING_SYSTEM_MODULE_KEYS.map((module) => moduleAccess[module]);
  const defaultModule = pickDefaultOperatingSystemModule(moduleAccess, input.defaultRouteModule);

  return {
    ...profile,
    default_route_path: defaultModule ? moduleAccess[defaultModule].route_path : "/home",
    module_access: moduleAccess,
    visibility_matrix: visibilityMatrix,
    query_scopes: queryScopes,
    home_widget_visibility: homeWidgetVisibility
  };
}

export async function getConfiguredOperatingSystemAccessProfile(
  client: PoolClient,
  auth: ConfiguredAccessSubject
): Promise<OperatingSystemAccessProfile> {
  const [visibilityOverrides, defaultRouteModule] = await Promise.all([
    getOperatingSystemVisibilityOverrides(client, auth),
    getDefaultOperatingSystemRouteModule(client, auth)
  ]);
  return applyOperatingSystemAccessConfiguration(getOperatingSystemAccessProfile(auth), {
    visibilityOverrides,
    defaultRouteModule
  });
}
