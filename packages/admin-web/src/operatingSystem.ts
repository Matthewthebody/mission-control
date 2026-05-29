import type { ShellRouteId } from "./navigation";

export const OPERATING_SYSTEM_ROLE_TEMPLATES = [
  "leadership",
  "operations_lead",
  "department_manager",
  "scheduling_lead",
  "production_manager",
  "standard_employee"
] as const;

export type OperatingSystemRoleTemplate = (typeof OPERATING_SYSTEM_ROLE_TEMPLATES)[number];

export const OPERATING_SYSTEM_MODULE_KEYS = [
  "home",
  "operations",
  "exceptions",
  "scheduling",
  "schedule",
  "graphics",
  "approvals",
  "reports"
] as const;

export type OperatingSystemModuleKey = (typeof OPERATING_SYSTEM_MODULE_KEYS)[number];

export const OPERATING_SYSTEM_SCOPE_LEVELS = ["none", "own", "department", "all"] as const;
export type OperatingSystemScopeLevel = (typeof OPERATING_SYSTEM_SCOPE_LEVELS)[number];

export const OPERATING_SYSTEM_ROUTE_IDS: Record<OperatingSystemModuleKey, ShellRouteId> = {
  home: "dashboard",
  operations: "operations",
  exceptions: "operations-exceptions",
  scheduling: "operations-scheduling",
  schedule: "operations-schedule",
  graphics: "graphics",
  approvals: "people-ops-approvals",
  reports: "business-health-reports"
};

export const HOME_WIDGET_VISIBILITY_KEYS = [
  "personal_schedule",
  "urgent_watch",
  "operations_overview",
  "scheduling_overview",
  "production_overview",
  "approvals_overview",
  "reports_overview"
] as const;

export type HomeWidgetVisibilityKey = (typeof HOME_WIDGET_VISIBILITY_KEYS)[number];

export type OperatingSystemModuleAccess = {
  module: OperatingSystemModuleKey;
  canView: boolean;
  canManage: boolean;
  scope: OperatingSystemScopeLevel;
  routeId: ShellRouteId;
  description: string;
  managerOnly: boolean;
};

export type OperatingSystemHomeWidgetVisibility = Record<HomeWidgetVisibilityKey, boolean>;

export type OperatingSystemQueryScope = {
  module: OperatingSystemModuleKey;
  level: OperatingSystemScopeLevel;
  department: string | null;
  actor_user_id: string | null;
};

export type OperatingSystemModuleVisibilitySnapshot = {
  module: OperatingSystemModuleKey;
  can_view: boolean;
  can_manage: boolean;
  scope: OperatingSystemScopeLevel;
  route_path: string;
  description: string;
  manager_only: boolean;
};

export type OperatingSystemAccessProfile = {
  role_template: OperatingSystemRoleTemplate;
  default_route_path: string;
  module_access: Record<OperatingSystemModuleKey, OperatingSystemModuleVisibilitySnapshot>;
  visibility_matrix: OperatingSystemModuleVisibilitySnapshot[];
  query_scopes: Record<OperatingSystemModuleKey, OperatingSystemQueryScope>;
  home_widget_visibility: Record<HomeWidgetVisibilityKey, boolean>;
};
