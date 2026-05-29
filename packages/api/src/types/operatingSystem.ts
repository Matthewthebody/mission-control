import type { DepartmentCode } from "./auth.js";

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
  /**
   * @deprecated Use `exceptions`. Legacy compatibility alias only.
   */
  "urgent_watch",
  "scheduling",
  "schedule",
  "production",
  "approvals",
  "reports"
] as const;

export type OperatingSystemModuleKey = (typeof OPERATING_SYSTEM_MODULE_KEYS)[number];

export const OPERATING_SYSTEM_SCOPE_LEVELS = ["none", "own", "department", "all"] as const;
export type OperatingSystemScopeLevel = (typeof OPERATING_SYSTEM_SCOPE_LEVELS)[number];

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

export const OPERATING_SYSTEM_HOME_SECTION_KEYS = [
  "staffing_tracker",
  "time_band",
  "today_strip",
  "urgent_watch",
  "today_and_next_up",
  "my_day",
  "attendance_awareness",
  "production_snapshot",
  "approvals_summary",
  "staffing_health",
  "my_follow_ups",
  "schools_risk"
] as const;

export type OperatingSystemHomeSectionKey = (typeof OPERATING_SYSTEM_HOME_SECTION_KEYS)[number];

export const OPERATING_SYSTEM_HOME_COMPACT_WIDGET_KEYS = [
  "attendance_awareness",
  "production_snapshot",
  "approvals_summary",
  "staffing_health",
  "my_follow_ups",
  "schools_risk"
] as const;

export type OperatingSystemHomeCompactWidgetKey = (typeof OPERATING_SYSTEM_HOME_COMPACT_WIDGET_KEYS)[number];

export type OperatingSystemModuleAccess = {
  module: OperatingSystemModuleKey;
  can_view: boolean;
  can_manage: boolean;
  scope: OperatingSystemScopeLevel;
  route_path: string;
  description: string;
  manager_only: boolean;
};

export type OperatingSystemVisibilityMatrixEntry = OperatingSystemModuleAccess;

export type OperatingSystemQueryScope = {
  module: OperatingSystemModuleKey;
  level: OperatingSystemScopeLevel;
  department: DepartmentCode | null;
  actor_user_id: string | null;
};

export type OperatingSystemAccessProfile = {
  role_template: OperatingSystemRoleTemplate;
  default_route_path: string;
  module_access: Record<OperatingSystemModuleKey, OperatingSystemModuleAccess>;
  visibility_matrix: OperatingSystemVisibilityMatrixEntry[];
  query_scopes: Record<OperatingSystemModuleKey, OperatingSystemQueryScope>;
  home_widget_visibility: Record<HomeWidgetVisibilityKey, boolean>;
};
