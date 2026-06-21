import type { ShellRouteId, ShellSectionKey, TabKey } from "./navigation";
import {
  OPERATING_SYSTEM_ROUTE_IDS,
  type OperatingSystemModuleAccess,
  type OperatingSystemModuleKey,
  type OperatingSystemRoleTemplate,
  type OperatingSystemScopeLevel
} from "./operatingSystem";
import { featureFlags } from "./featureFlags";
import type { SessionUser } from "./types";

export type BusinessRole =
  | "employee"
  | "photographer"
  | "shoot_lead"
  | "production_staff"
  | "customer_service_staff"
  | "sales_growth_staff"
  | "manager"
  | "leadership"
  | "admin";

export type CapabilityDomain =
  | "dashboard"
  | "operations"
  | "workflow"
  | "shoots"
  | "schedule"
  | "staffing"
  | "attendance"
  | "travel_logistics"
  | "readiness"
  | "production"
  | "qa"
  | "release"
  | "directory_contacts"
  | "directory_internal"
  | "directory_locations"
  | "directory_accounts"
  | "assets"
  | "custody"
  | "repairs"
  | "people_ops"
  | "requests"
  | "approvals"
  | "training"
  | "certifications"
  | "growth"
  | "pipeline"
  | "proposals"
  | "rfps"
  | "renewals"
  | "business_health"
  | "reports"
  | "customer_service_metrics"
  | "executive_metrics"
  | "review_desk"
  | "admin"
  | "roles_permissions"
  | "integrations"
  | "automations"
  | "audit_controls";

export type CapabilityAction = "view" | "create" | "edit" | "delete" | "approve" | "assign" | "manage" | "configure";
export type AppCapability = `${CapabilityDomain}.${CapabilityAction}`;

type CapabilityActionMap = Partial<Record<CapabilityAction, true>>;
type CapabilityMatrix = Partial<Record<CapabilityDomain, CapabilityActionMap>>;

const FIELD_PROFILES = [
  "associate_photographer",
  "seasonal_photographer",
  "part_time_photographer",
  "senior_photographer",
  "lead_photographer"
] as const;

const SHOOT_LEAD_PROFILES = [
  "senior_photographer",
  "lead_photographer",
  "director_of_photography",
  "director_of_school_photography",
  "director_of_sports_photography"
] as const;

const PRODUCTION_PROFILES = ["graphic_artist", "director_of_digital_production", "production_artist"] as const;
const CUSTOMER_SERVICE_PROFILES = ["customer_service_rep", "schools_client_success", "sports_client_success"] as const;
const GROWTH_PROFILE_KEYWORDS = ["sales", "account_executive", "business_development", "growth"];

const HIGHER_AUTHORITY_TIERS = ["supervisor", "director_admin", "leadership", "super_admin"] as const;
const ADMIN_TIERS = ["super_admin"] as const;
const LEADERSHIP_TIERS = ["leadership", "super_admin"] as const;
const MANAGER_TIERS = ["supervisor", "director_admin", "leadership", "super_admin"] as const;

const LEGACY_EXCEPTIONS_PERMISSION_ALIASES = ["watchlist.read"] as const;
const LEGACY_GRAPHICS_VIEW_PERMISSION_ALIASES = [
  "production.read",
  "production.view",
  "production_projects.view",
  "project.read",
  "projects.read"
] as const;
const LEGACY_GRAPHICS_MANAGE_PERMISSION_ALIASES = ["production.manage", "project.manage"] as const;
const LEGACY_TASK_SCOPE_ALIASES = {
  graphics: ["production"],
  studios: ["photography"]
} as const;

const ALL_CAPABILITY_DOMAINS: CapabilityDomain[] = [
  "dashboard",
  "operations",
  "workflow",
  "shoots",
  "schedule",
  "staffing",
  "attendance",
  "travel_logistics",
  "readiness",
  "production",
  "qa",
  "release",
  "directory_contacts",
  "directory_internal",
  "directory_locations",
  "directory_accounts",
  "assets",
  "custody",
  "repairs",
  "people_ops",
  "requests",
  "approvals",
  "training",
  "certifications",
  "growth",
  "pipeline",
  "proposals",
  "rfps",
  "renewals",
  "business_health",
  "reports",
  "customer_service_metrics",
  "executive_metrics",
  "review_desk",
  "admin",
  "roles_permissions",
  "integrations",
  "automations",
  "audit_controls"
];

const CAPABILITY_PERMISSION_ALIASES: Partial<Record<CapabilityDomain, Partial<Record<CapabilityAction, string[]>>>> = {
  dashboard: {
    view: ["dashboard.read"]
  },
  operations: {
    view: ["shoot.read", "schedule.read", "attendance.read", "alerts.read"]
  },
  workflow: {
    view: ["workflow.read"],
    create: ["workflow.instance.manage", "workflow.template.manage"],
    edit: ["workflow.step.execute", "workflow.step.override", "workflow.instance.manage"],
    manage: ["workflow.instance.manage", "workflow.template.manage", "workflow.step.override"]
  },
  shoots: {
    view: ["shoot.read", "shoot.update", "shoot.create"],
    create: ["shoot.create"],
    edit: ["shoot.update"],
    manage: ["shoot.update"]
  },
  schedule: {
    view: ["schedule.read"],
    create: ["schedule.manage"],
    edit: ["schedule.manage"],
    assign: ["schedule.manage"],
    manage: ["schedule.manage"],
    configure: ["schedule.publish", "schedule.manage"]
  },
  staffing: {
    view: ["schedule.manage"],
    assign: ["schedule.manage"],
    manage: ["schedule.manage"]
  },
  attendance: {
    view: ["attendance.read", "time.clock", "attendance.manage"],
    edit: ["attendance.manage"],
    approve: ["attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
    manage: ["attendance.manage"]
  },
  travel_logistics: {
    view: ["schedule.read", "shoot.read"]
  },
  readiness: {
    view: ["schedule.read", "shoot.read", "alerts.read"],
    manage: ["schedule.manage"]
  },
  production: {
    view: ["production.view", "project.read", "projects.read", "production_projects.view", "project.manage"],
    create: ["project.create", "project.manage"],
    edit: ["project.update", "project.manage"],
    assign: ["project.manage"],
    manage: ["project.manage", "production.manage"]
  },
  qa: {
    view: ["project.read", "projects.read", "project.manage", "production.manage"],
    edit: ["project.manage", "production.manage"],
    approve: ["project.manage", "production.manage"],
    manage: ["project.manage", "production.manage"]
  },
  release: {
    view: ["project.read", "projects.read", "project.manage", "production.manage"],
    edit: ["project.manage", "production.manage"],
    approve: ["project.manage", "production.manage"],
    manage: ["project.manage", "production.manage"]
  },
  directory_contacts: {
    view: ["directory.read", "contacts.read", "user.read"],
    create: ["directory.manage", "organization_contacts.manage"],
    edit: ["directory.manage", "organization_contacts.manage"],
    manage: ["directory.manage", "organization_contacts.manage"]
  },
  directory_internal: {
    view: ["directory.read", "user.read"],
    edit: ["directory.manage", "user.manage"],
    manage: ["directory.manage", "user.manage"]
  },
  directory_locations: {
    view: ["directory.read", "shoot_locations.view"],
    create: ["shoot_locations.manage", "directory.manage"],
    edit: ["shoot_locations.manage", "directory.manage"],
    manage: ["shoot_locations.manage", "directory.manage"]
  },
  directory_accounts: {
    view: ["directory.read", "organizations.read", "user.read"],
    create: ["organizations.manage", "directory.manage"],
    edit: ["organizations.manage", "directory.manage"],
    manage: ["organizations.manage", "directory.manage"]
  },
  assets: {
    view: ["gear_assets.read", "gear_assets.edit", "gear_kits.read", "gear_kits.edit", "gear_custody.edit", "gear_service_records.create"],
    edit: ["gear_assets.edit", "gear_kits.edit"],
    manage: ["gear_assets.edit", "gear_kits.edit", "gear_custody.override"]
  },
  custody: {
    view: ["gear_custody.view", "gear_custody.edit", "gear_custody.override"],
    edit: ["gear_custody.edit", "gear_custody.override"],
    manage: ["gear_custody.override", "gear_custody.edit"]
  },
  repairs: {
    view: ["gear_service_records.read", "gear_service_records.create", "gear_assets.edit"],
    create: ["gear_service_records.create"],
    edit: ["gear_service_records.create"],
    manage: ["gear_service_records.create"]
  },
  people_ops: {
    view: ["training_documents.view", "approval.read", "pto.request", "trade.request"]
  },
  requests: {
    view: ["approval.read", "pto.request", "trade.request"],
    create: ["pto.request", "trade.request"],
    edit: ["pto.request", "trade.request"]
  },
  approvals: {
    view: ["approval.read", "attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
    approve: ["attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
    manage: ["attendance.manage"]
  },
  training: {
    view: ["training_documents.view"],
    manage: ["training_documents.manage"]
  },
  certifications: {
    view: ["training_documents.view"],
    manage: ["training_documents.manage"]
  },
  growth: {
    view: ["sales_pipeline.view", "sales.read", "opportunities.read", "proposals.read", "rfps.read", "renewals.read"]
  },
  pipeline: {
    view: ["sales_pipeline.view", "sales.read", "opportunities.read"],
    create: ["sales_pipeline.edit", "opportunities.create"],
    edit: ["sales_pipeline.edit", "opportunities.edit"],
    manage: ["sales_pipeline.manage", "sales_pipeline.edit"]
  },
  proposals: {
    view: ["proposals.read", "sales_pipeline.view"],
    create: ["proposals.create", "proposals.edit"],
    edit: ["proposals.edit"],
    manage: ["proposals.manage", "proposals.edit"]
  },
  rfps: {
    view: ["rfps.read", "sales_pipeline.view"],
    create: ["rfps.create", "rfps.edit"],
    edit: ["rfps.edit"],
    manage: ["rfps.manage", "rfps.edit"]
  },
  renewals: {
    view: ["renewals.read", "sales_pipeline.view"],
    create: ["renewals.create", "renewals.edit"],
    edit: ["renewals.edit"],
    manage: ["renewals.manage", "renewals.edit"]
  },
  business_health: {
    view: ["reports.read", "profitability_leadership.view", "labor.read", "customer_service.read"]
  },
  reports: {
    view: ["reports.read", "labor.read"],
    manage: ["reports.manage"]
  },
  customer_service_metrics: {
    view: ["customer_service.read"],
    manage: ["customer_service.manage"]
  },
  executive_metrics: {
    view: ["profitability_leadership.view", "reports.read"],
    manage: ["profitability_leadership.view"]
  },
  review_desk: {
    view: ["compliance.read", "attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
    approve: ["attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
    manage: ["attendance.manage"]
  },
  admin: {
    view: ["security.manage", "access.manage"],
    configure: ["security.manage", "access.manage"]
  },
  roles_permissions: {
    view: ["user.read", "access.manage"],
    edit: ["access.manage"],
    manage: ["access.manage"],
    configure: ["access.manage"]
  },
  integrations: {
    view: ["outlook_calendar.view", "integrations.view", "outlook.manage"],
    edit: ["outlook.manage", "integrations.manage"],
    manage: ["outlook.manage", "integrations.manage"]
  },
  automations: {
    view: ["automation.manage", "security.manage", "outlook.manage"],
    manage: ["automation.manage", "security.manage"],
    configure: ["automation.manage", "security.manage"]
  },
  audit_controls: {
    view: ["audit.read", "security.manage"],
    manage: ["security.manage"],
    configure: ["security.manage"]
  }
};

const ADMIN_CAPABILITY_MAP = Object.fromEntries(
  ALL_CAPABILITY_DOMAINS.map((domain) => [
    domain,
    { view: true, create: true, edit: true, delete: true, approve: true, assign: true, manage: true, configure: true }
  ])
) as CapabilityMatrix;

const ROLE_CAPABILITY_GRANTS: Record<BusinessRole, CapabilityMatrix> = {
  employee: {
    dashboard: { view: true },
    people_ops: { view: true },
    requests: { view: true, create: true, edit: true },
    training: { view: true },
    certifications: { view: true },
    schedule: { view: true },
    attendance: { view: true }
  },
  photographer: {
    dashboard: { view: true },
    operations: { view: true },
    shoots: { view: true },
    schedule: { view: true },
    attendance: { view: true },
    travel_logistics: { view: true },
    readiness: { view: true },
    directory_internal: { view: true },
    directory_locations: { view: true },
    people_ops: { view: true },
    requests: { view: true, create: true, edit: true },
    training: { view: true },
    certifications: { view: true }
  },
  shoot_lead: {
    dashboard: { view: true },
    operations: { view: true },
    shoots: { view: true },
    schedule: { view: true },
    staffing: { view: true },
    attendance: { view: true },
    travel_logistics: { view: true },
    readiness: { view: true },
    review_desk: { view: true },
    directory_internal: { view: true },
    directory_locations: { view: true },
    assets: { view: true },
    custody: { view: true },
    people_ops: { view: true },
    requests: { view: true, create: true, edit: true },
    training: { view: true },
    certifications: { view: true }
  },
  production_staff: {
    dashboard: { view: true },
    production: { view: true },
    qa: { view: true },
    release: { view: true },
    directory_internal: { view: true },
    directory_accounts: { view: true },
    people_ops: { view: true },
    requests: { view: true, create: true, edit: true },
    training: { view: true },
    certifications: { view: true }
  },
  customer_service_staff: {
    dashboard: { view: true },
    directory_contacts: { view: true },
    directory_accounts: { view: true },
    business_health: { view: true },
    reports: { view: true },
    customer_service_metrics: { view: true },
    review_desk: { view: true }
  },
  sales_growth_staff: {
    dashboard: { view: true },
    directory_contacts: { view: true },
    directory_accounts: { view: true },
    growth: { view: true },
    pipeline: { view: true },
    proposals: { view: true },
    rfps: { view: true },
    renewals: { view: true }
  },
  manager: {
    dashboard: { view: true },
    operations: { view: true },
    shoots: { view: true },
    schedule: { view: true },
    staffing: { view: true },
    attendance: { view: true },
    travel_logistics: { view: true },
    readiness: { view: true },
    production: { view: true },
    qa: { view: true },
    release: { view: true },
    directory_contacts: { view: true },
    directory_internal: { view: true },
    directory_locations: { view: true },
    directory_accounts: { view: true },
    assets: { view: true },
    custody: { view: true },
    repairs: { view: true },
    people_ops: { view: true },
    requests: { view: true, create: true, edit: true },
    approvals: { view: true, approve: true },
    training: { view: true },
    certifications: { view: true },
    business_health: { view: true },
    reports: { view: true },
    review_desk: { view: true }
  },
  leadership: {
    dashboard: { view: true },
    operations: { view: true },
    shoots: { view: true },
    schedule: { view: true },
    staffing: { view: true },
    attendance: { view: true },
    travel_logistics: { view: true },
    readiness: { view: true },
    production: { view: true },
    qa: { view: true },
    release: { view: true },
    directory_contacts: { view: true },
    directory_internal: { view: true },
    directory_locations: { view: true },
    directory_accounts: { view: true },
    assets: { view: true },
    custody: { view: true },
    repairs: { view: true },
    people_ops: { view: true },
    requests: { view: true, create: true, edit: true },
    approvals: { view: true, approve: true },
    training: { view: true },
    certifications: { view: true },
    growth: { view: true },
    pipeline: { view: true },
    proposals: { view: true },
    rfps: { view: true },
    renewals: { view: true },
    business_health: { view: true },
    reports: { view: true },
    customer_service_metrics: { view: true },
    executive_metrics: { view: true },
    review_desk: { view: true }
  },
  admin: ADMIN_CAPABILITY_MAP
};

function normalizeValue(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeSet(values: string[]) {
  return new Set(values.map(normalizeValue));
}

function matchesAny(values: Set<string>, targets: readonly string[]) {
  return targets.some((value) => values.has(normalizeValue(value)));
}

function getRoleSet(user: SessionUser) {
  return normalizeSet(user.roles);
}

function getInternalRoleGroupSet(user: SessionUser) {
  return normalizeSet(user.internalRoleGroups ?? []);
}

function getProfileSet(user: SessionUser) {
  return normalizeSet([user.primaryJobFunctionProfile, ...user.jobFunctionProfiles].filter(Boolean));
}

function getPermissionSet(user: SessionUser) {
  return normalizeSet(user.permissions);
}

function getPolicyAccessScope(user: SessionUser, permissionKey: string, department?: string | null): "all" | "own" | null {
  const normalizedPermission = normalizeValue(permissionKey);
  const normalizedDepartment = normalizeValue(department ?? "");
  const grants = (user.policyGrants ?? []).filter((grant) => normalizeValue(grant.permissionKey) === normalizedPermission);
  if (!grants.length) {
    return hasPermission(user, permissionKey) ? "all" : null;
  }
  const denied = grants.some((grant) => {
    if (grant.effect !== "deny") {
      return false;
    }
    if (grant.scopeType === "global") {
      return true;
    }
    if (grant.scopeType === "department") {
      return Boolean(normalizedDepartment && normalizeValue(grant.scopeValue ?? "") === normalizedDepartment);
    }
    return true;
  });
  if (denied) {
    return null;
  }
  if (
    grants.some(
      (grant) =>
        grant.effect === "allow" &&
        (grant.scopeType === "global" ||
          (grant.scopeType === "department" && normalizedDepartment && normalizeValue(grant.scopeValue ?? "") === normalizedDepartment))
    )
  ) {
    return "all";
  }
  return grants.some((grant) => grant.effect === "allow") ? "own" : null;
}

function getGrantedScopes(user: SessionUser) {
  return normalizeSet(user.effectiveScopes);
}

function capabilitySatisfies(requestedAction: CapabilityAction, grantedAction: CapabilityAction) {
  const implied: Record<CapabilityAction, CapabilityAction[]> = {
    view: ["view", "manage", "configure"],
    create: ["create", "manage", "configure"],
    edit: ["edit", "manage", "configure"],
    delete: ["delete", "manage", "configure"],
    approve: ["approve", "manage", "configure"],
    assign: ["assign", "manage", "configure"],
    manage: ["manage", "configure"],
    configure: ["configure"]
  };
  return implied[requestedAction].includes(grantedAction);
}

function parseCapability(capability: AppCapability) {
  const [domain, action] = capability.split(".") as [CapabilityDomain, CapabilityAction];
  return { domain, action };
}

function hasPermissionGrant(user: SessionUser, domain: string, action: CapabilityAction) {
  const normalizedDomain = normalizeValue(domain);
  return user.permissionGrants.some((grant) => {
    const grantDomain = normalizeValue(grant.domain);
    const grantAction = normalizeValue(grant.action) as CapabilityAction;
    return grantDomain === normalizedDomain && capabilitySatisfies(action, grantAction);
  });
}

function hasRoleCapability(user: SessionUser, capability: AppCapability) {
  const { domain, action } = parseCapability(capability);
  return getBusinessRoles(user).some((role) => {
    const grants = ROLE_CAPABILITY_GRANTS[role][domain];
    if (!grants) {
      return false;
    }
    return Object.keys(grants).some((grantedAction) =>
      grants[grantedAction as CapabilityAction] ? capabilitySatisfies(action, grantedAction as CapabilityAction) : false
    );
  });
}

function hasCapabilityAlias(user: SessionUser, capability: AppCapability) {
  const { domain, action } = parseCapability(capability);
  const aliases = CAPABILITY_PERMISSION_ALIASES[domain];
  if (!aliases) {
    return false;
  }
  const permissionSet = getPermissionSet(user);
  return Object.entries(aliases).some(([grantedAction, permissions]) => {
    if (!permissions?.length || !capabilitySatisfies(action, grantedAction as CapabilityAction)) {
      return false;
    }
    return permissions.some((permission) => permissionSet.has(normalizeValue(permission)));
  });
}

export function hasPermission(user: SessionUser, permission: string) {
  const normalizedPermission = normalizeValue(permission);
  if (getPermissionSet(user).has(normalizedPermission)) {
    return true;
  }
  const [domain, action] = normalizedPermission.split(".");
  if (domain && action) {
    return user.permissionGrants.some(
      (grant) => normalizeValue(grant.domain) === domain && normalizeValue(grant.action) === action
    );
  }
  return false;
}

export function hasAnyPermission(user: SessionUser, permissions: string[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function hasPermissionPrefix(user: SessionUser, prefix: string) {
  const normalizedPrefix = normalizeValue(prefix);
  return [...getPermissionSet(user)].some(
    (permission) => permission === normalizedPrefix || permission.startsWith(`${normalizedPrefix}.`)
  );
}

function hasLegacyExceptionsAccessAlias(user: SessionUser) {
  return hasAnyPermission(user, [...LEGACY_EXCEPTIONS_PERMISSION_ALIASES]);
}

function hasLegacyGraphicsAccessAlias(user: SessionUser) {
  return hasAnyPermission(user, [...LEGACY_GRAPHICS_VIEW_PERMISSION_ALIASES]);
}

function hasLegacyGraphicsManageAlias(user: SessionUser) {
  return hasAnyPermission(user, [...LEGACY_GRAPHICS_MANAGE_PERMISSION_ALIASES]);
}

function hasCanonicalGraphicsAccessSignal(user: SessionUser) {
  return hasJobFunctionProfile(user, "graphic_artist");
}

function getTaskScopeDepartments(department: "schools" | "sports" | "graphics" | "studios" | "operations") {
  return [department, ...(LEGACY_TASK_SCOPE_ALIASES[department as keyof typeof LEGACY_TASK_SCOPE_ALIASES] ?? [])];
}

function hasTaskScopeAccess(user: SessionUser, permissionKey: "task.read" | "task.create", department: "schools" | "sports" | "graphics" | "studios" | "operations") {
  return getTaskScopeDepartments(department).some((scopeKey) => getPolicyAccessScope(user, permissionKey, scopeKey) != null);
}

function hasTaskScopeManagement(user: SessionUser, department: "schools" | "sports" | "graphics" | "studios" | "operations") {
  return getTaskScopeDepartments(department).some((scopeKey) => getPolicyAccessScope(user, "task.create", scopeKey) === "all");
}

export function hasAuthorityTier(user: SessionUser, authorityTier: string | string[]) {
  const tiers = Array.isArray(authorityTier) ? authorityTier : [authorityTier];
  return tiers.some((tier) => normalizeValue(user.authorityTier) === normalizeValue(tier));
}

export function hasJobFunctionProfile(user: SessionUser, profile: string | string[]) {
  const profiles = Array.isArray(profile) ? profile : [profile];
  const profileSet = getProfileSet(user);
  return profiles.some((entry) => profileSet.has(normalizeValue(entry)));
}

export function hasInternalRoleGroup(user: SessionUser, roleGroup: string | string[]) {
  const roleGroups = Array.isArray(roleGroup) ? roleGroup : [roleGroup];
  const internalRoleGroups = getInternalRoleGroupSet(user);
  return roleGroups.some((entry) => internalRoleGroups.has(normalizeValue(entry)));
}

export function getBusinessRoles(user: SessionUser): BusinessRole[] {
  const roles = new Set<BusinessRole>();
  const roleSet = getRoleSet(user);
  const internalRoleGroups = getInternalRoleGroupSet(user);
  const profileSet = getProfileSet(user);
  const profileList = [...profileSet];
  const employeeTier = hasAuthorityTier(user, "standard_employee");

  const isAdmin =
    hasAuthorityTier(user, ADMIN_TIERS as unknown as string[]) ||
    internalRoleGroups.has("system_admin") ||
    (!employeeTier && matchesAny(roleSet, ["admin", "system_admin", "super_admin"]));
  const isLeadership =
    isAdmin ||
    internalRoleGroups.has("leadership") ||
    hasAuthorityTier(user, LEADERSHIP_TIERS as unknown as string[]) ||
    (!employeeTier && matchesAny(roleSet, ["leadership", "executive", "leadership_team"])) ||
    matchesAny(profileSet, ["leadership_team_member", "leadership_viewer"]);
  const isManager =
    isLeadership ||
    hasAuthorityTier(user, MANAGER_TIERS as unknown as string[]) ||
    (!employeeTier && matchesAny(roleSet, ["manager", "supervisor", "director", "operations_manager"]));
  const isShootLead =
    internalRoleGroups.has("senior_photographers") ||
    matchesAny(profileSet, SHOOT_LEAD_PROFILES) ||
    matchesAny(roleSet, ["shoot_lead", "lead_photographer"]);
  const isPhotographer =
    internalRoleGroups.has("senior_photographers") ||
    internalRoleGroups.has("seasonal_photographers") ||
    matchesAny(profileSet, FIELD_PROFILES) ||
    matchesAny(roleSet, ["photographer"]);
  const isProduction =
    internalRoleGroups.has("graphics_production") ||
    matchesAny(profileSet, PRODUCTION_PROFILES) ||
    matchesAny(roleSet, ["production", "production_staff", "digital_production"]);
  const isCustomerService =
    internalRoleGroups.has("customer_service") ||
    matchesAny(profileSet, CUSTOMER_SERVICE_PROFILES) || matchesAny(roleSet, ["customer_service", "support"]);
  const isGrowth =
    profileList.some((profile) => GROWTH_PROFILE_KEYWORDS.some((value) => profile.includes(normalizeValue(value)))) ||
    matchesAny(roleSet, ["sales", "growth", "sales_growth"]);

  if (isAdmin) {
    roles.add("admin");
  }
  if (isLeadership) {
    roles.add("leadership");
  }
  if (isManager) {
    roles.add("manager");
  }
  if (isShootLead) {
    roles.add("shoot_lead");
  }
  if (isPhotographer) {
    roles.add("photographer");
  }
  if (isProduction) {
    roles.add("production_staff");
  }
  if (isCustomerService) {
    roles.add("customer_service_staff");
  }
  if (isGrowth) {
    roles.add("sales_growth_staff");
  }
  if (!roles.size || (!isManager && !isLeadership && !isAdmin)) {
    roles.add("employee");
  }

  return [...roles];
}

export function getPrimaryBusinessRole(user: SessionUser): BusinessRole {
  const roles = getBusinessRoles(user);
  const priority: BusinessRole[] = [
    "admin",
    "leadership",
    "manager",
    "production_staff",
    "sales_growth_staff",
    "customer_service_staff",
    "shoot_lead",
    "photographer",
    "employee"
  ];
  return priority.find((role) => roles.includes(role)) ?? "employee";
}

export function hasBusinessRole(user: SessionUser, role: BusinessRole | BusinessRole[]) {
  const roles = Array.isArray(role) ? role : [role];
  const userRoles = getBusinessRoles(user);
  return roles.some((entry) => userRoles.includes(entry));
}

function hasPolicyPermissionAccess(user: SessionUser, permissionKey: string, department?: string | null) {
  const normalizedPermission = normalizeValue(permissionKey);
  const normalizedDepartment = normalizeValue(department ?? "");
  const grants = (user.policyGrants ?? []).filter((grant) => normalizeValue(grant.permissionKey) === normalizedPermission);

  if (!grants.length) {
    return hasPermission(user, permissionKey);
  }

  const denied = grants.some((grant) => {
    if (grant.effect !== "deny") {
      return false;
    }
    if (grant.scopeType === "global") {
      return true;
    }
    if (grant.scopeType === "department") {
      return Boolean(normalizedDepartment && normalizeValue(grant.scopeValue ?? "") === normalizedDepartment);
    }
    return true;
  });

  if (denied) {
    return false;
  }

  return grants.some((grant) => {
    if (grant.effect !== "allow") {
      return false;
    }
    if (grant.scopeType === "global") {
      return true;
    }
    if (grant.scopeType === "department") {
      return Boolean(normalizedDepartment && normalizeValue(grant.scopeValue ?? "") === normalizedDepartment);
    }
    return true;
  });
}

export function canAssignStaffingRecords(user: SessionUser, department?: string | null) {
  return (
    hasPolicyPermissionAccess(user, "job.assign_staff", department) ||
    hasCapability(user, "staffing.assign") ||
    hasCapability(user, "staffing.manage")
  );
}

export function canApproveOperationalExceptions(user: SessionUser, department?: string | null) {
  return (
    hasPolicyPermissionAccess(user, "exception.approve", department) ||
    hasPolicyPermissionAccess(user, "approval.manage", department) ||
    hasCapability(user, "approvals.approve")
  );
}

export function canChangeSharedJobStatus(user: SessionUser, department?: string | null) {
  return (
    hasPolicyPermissionAccess(user, "job.status.change", department) ||
    hasAnyPermission(user, ["job.update", "job.publish", "job.cancel", "job.archive"])
  );
}

// Centralized predicate for who may move a specific job through its workflow statuses.
// Reuses the existing shared job-status rule (leadership / managers / department status
// permissions) and additionally lets the job's own owner or lead update their own job.
// Global workflow TEMPLATE management stays separate and restricted
// (see canManageWorkflowTemplates) — owning a job never grants template-editing access.
export function canEditJobWorkflow(
  user: SessionUser,
  job: { department_type?: string | null; account_owner_user_id?: string | null; lead_owner_user_id?: string | null }
) {
  if (canChangeSharedJobStatus(user, job.department_type ?? null)) {
    return true;
  }
  return (
    (Boolean(job.account_owner_user_id) && job.account_owner_user_id === user.id) ||
    (Boolean(job.lead_owner_user_id) && job.lead_owner_user_id === user.id)
  );
}

export function canChangeSharedTaskStatus(user: SessionUser, department?: string | null) {
  return hasPolicyPermissionAccess(user, "task.status.change", department) || hasPermission(user, "task.update");
}

export function canChangeProductionStatus(user: SessionUser, department?: string | null) {
  return (
    hasPolicyPermissionAccess(user, "production.status.change", department) ||
    hasAnyPermission(user, ["production.update", "production.mark_blocked"])
  );
}

export function canViewSensitiveNotes(user: SessionUser, department?: string | null) {
  return (
    hasPolicyPermissionAccess(user, "note.read_sensitive", department) ||
    hasInternalRoleGroup(user, ["system_admin", "leadership"]) ||
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"])
  );
}

export function canViewSensitiveEvaluations(user: SessionUser, department?: string | null) {
  return (
    hasPolicyPermissionAccess(user, "evaluation.read_sensitive", department) ||
    hasInternalRoleGroup(user, ["system_admin", "leadership"]) ||
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"])
  );
}

export function canConfigureSystemBehavior(user: SessionUser) {
  return (
    hasPolicyPermissionAccess(user, "system.configure") ||
    hasAnyPermission(user, ["settings.permissions.manage", "settings.update", "security.manage"]) ||
    hasInternalRoleGroup(user, "system_admin") ||
    hasAuthorityTier(user, "super_admin")
  );
}

function isLeadershipOperatingTemplate(user: SessionUser) {
  return hasAuthorityTier(user, ["super_admin", "leadership", "director_admin", "read_only_viewer"]);
}

function isProductionManagerTemplate(user: SessionUser) {
  return (
    hasJobFunctionProfile(user, "director_of_digital_production") ||
    (normalizeValue(user.department) === "production" && hasAuthorityTier(user, "supervisor"))
  );
}

function isSchedulingLeadTemplate(user: SessionUser) {
  return (
    hasJobFunctionProfile(user, ["schools_client_success", "sports_client_success"]) ||
    (["schools", "sports", "customer_service", "office"].includes(normalizeValue(user.department)) &&
      hasAuthorityTier(user, "supervisor")) ||
    hasCapability(user, "schedule.manage") ||
    hasPermission(user, "schedule.manage")
  );
}

function isOperationsLeadTemplate(user: SessionUser) {
  return (
    hasJobFunctionProfile(user, [
      "senior_photographer",
      "director_of_photography",
      "director_of_school_photography",
      "director_of_sports_photography"
    ]) ||
    (normalizeValue(user.department) === "operations" && hasAuthorityTier(user, "supervisor"))
  );
}

function isDepartmentManagerTemplate(user: SessionUser) {
  return (
    hasAuthorityTier(user, "supervisor") &&
    !isProductionManagerTemplate(user) &&
    !isSchedulingLeadTemplate(user) &&
    !isOperationsLeadTemplate(user)
  );
}

function hasDepartmentScheduleScope(user: SessionUser) {
  return (
    hasCapability(user, "schedule.manage") ||
    hasPermission(user, "schedule.manage") ||
    hasJobFunctionProfile(user, ["schools_client_success", "sports_client_success", "customer_service_rep"])
  );
}

function hasOwnOnlyOperationalScope(user: SessionUser) {
  if (isLeadershipOperatingTemplate(user) || hasDepartmentScheduleScope(user)) {
    return false;
  }
  return hasJobFunctionProfile(user, [...FIELD_PROFILES, "graphic_artist"] as unknown as string[]) || getRoleSet(user).has("office_employee");
}

export function getOperatingSystemRoleTemplate(user: SessionUser): OperatingSystemRoleTemplate {
  if (isLeadershipOperatingTemplate(user)) {
    return "leadership";
  }
  if (isOperationsLeadTemplate(user)) {
    return "operations_lead";
  }
  if (isSchedulingLeadTemplate(user)) {
    return "scheduling_lead";
  }
  if (isProductionManagerTemplate(user)) {
    return "production_manager";
  }
  if (isDepartmentManagerTemplate(user)) {
    return "department_manager";
  }
  return "standard_employee";
}

export function getOperatingSystemScope(user: SessionUser, module: OperatingSystemModuleKey): OperatingSystemScopeLevel {
  switch (module) {
    case "home":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (
        isOperationsLeadTemplate(user) ||
        isSchedulingLeadTemplate(user) ||
        isProductionManagerTemplate(user) ||
        isDepartmentManagerTemplate(user)
      ) {
        return "department";
      }
      if (
        (hasOwnOnlyOperationalScope(user) &&
          (hasPermission(user, "dashboard.read") || hasPermission(user, "schedule.read") || hasPermission(user, "notification.read"))) ||
        hasPermission(user, "dashboard.read") ||
        hasPermission(user, "schedule.read")
      ) {
        return "own";
      }
      return "none";
    case "operations":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (isOperationsLeadTemplate(user) || isSchedulingLeadTemplate(user) || isDepartmentManagerTemplate(user)) {
        return "department";
      }
      return "none";
    case "exceptions":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (
        isOperationsLeadTemplate(user) ||
        isSchedulingLeadTemplate(user) ||
        isProductionManagerTemplate(user) ||
        isDepartmentManagerTemplate(user)
      ) {
        return "department";
      }
      return "none";
    case "scheduling":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (isSchedulingLeadTemplate(user) || isDepartmentManagerTemplate(user)) {
        return "department";
      }
      return "none";
    case "schedule":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (hasDepartmentScheduleScope(user)) {
        return "department";
      }
      if (
        (hasOwnOnlyOperationalScope(user) && hasPermission(user, "schedule.read")) ||
        hasCapability(user, "schedule.view") ||
        hasPermission(user, "schedule.read")
      ) {
        return "own";
      }
      return "none";
    case "graphics":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (isProductionManagerTemplate(user)) {
        return "department";
      }
      if (hasCanonicalGraphicsAccessSignal(user) || hasLegacyGraphicsAccessAlias(user)) {
        return "own";
      }
      return "none";
    case "approvals":
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      if (
        hasAuthorityTier(user, "supervisor") ||
        hasAnyPermission(user, [
          "attendance.manage",
          "attendance_exceptions.approve",
          "missed_punches.approve",
          "pto.approve",
          "trade.approve"
        ])
      ) {
        return "department";
      }
      if (hasAnyPermission(user, ["pto.request", "trade.request", "approval.read"]) || canAccessApprovalsHub(user)) {
        return "own";
      }
      return "none";
    case "reports":
      if (!canViewLeadershipReports(user)) {
        return "none";
      }
      if (isLeadershipOperatingTemplate(user)) {
        return "all";
      }
      return hasAuthorityTier(user, "supervisor") || hasPermission(user, "reporting_exports.view") ? "department" : "none";
    default:
      return "none";
  }
}

export function canManageOperatingSystemModule(user: SessionUser, module: OperatingSystemModuleKey) {
  if (hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"])) {
    return module !== "home";
  }
  switch (module) {
    case "home":
      return false;
    case "operations":
    case "exceptions":
      return isOperationsLeadTemplate(user) || isSchedulingLeadTemplate(user) || isDepartmentManagerTemplate(user);
    case "scheduling":
      return isSchedulingLeadTemplate(user) || hasCapability(user, "schedule.manage") || hasPermission(user, "schedule.manage");
    case "schedule":
      return hasCapability(user, "schedule.manage") || hasPermission(user, "schedule.manage");
    case "graphics":
      return (
        isProductionManagerTemplate(user) ||
        hasLegacyGraphicsManageAlias(user) ||
        hasAnyCapability(user, ["qa.manage", "release.manage"])
      );
    case "approvals":
      return hasAuthorityTier(user, "supervisor") || hasAnyPermission(user, ["attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"]);
    case "reports":
      return (
        hasCapability(user, "reports.manage") ||
        hasPermission(user, "reporting_exports.export") ||
        hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"])
      );
    default:
      return false;
  }
}

export function canAccessOperatingSystemModule(user: SessionUser, module: OperatingSystemModuleKey) {
  return getOperatingSystemScope(user, module) !== "none";
}

export function getOperatingSystemModuleVisibilityMatrix(user: SessionUser): Record<OperatingSystemModuleKey, OperatingSystemModuleAccess> {
  return {
    home: {
      module: "home",
      canView: canAccessOperatingSystemModule(user, "home"),
      canManage: canManageOperatingSystemModule(user, "home"),
      scope: getOperatingSystemScope(user, "home"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.home,
      description: "Role-aware front door for the operating system.",
      managerOnly: false
    },
    operations: {
      module: "operations",
      canView: canAccessOperatingSystemModule(user, "operations"),
      canManage: canManageOperatingSystemModule(user, "operations"),
      scope: getOperatingSystemScope(user, "operations"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.operations,
      description: "Live operational execution and manager coordination.",
      managerOnly: true
    },
    exceptions: {
      module: "exceptions",
      canView: canAccessOperatingSystemModule(user, "exceptions"),
      canManage: canManageOperatingSystemModule(user, "exceptions"),
      scope: getOperatingSystemScope(user, "exceptions"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.exceptions,
      description: "Exception queue for work that cannot wait.",
      managerOnly: true
    },
    scheduling: {
      module: "scheduling",
      canView: canAccessOperatingSystemModule(user, "scheduling"),
      canManage: canManageOperatingSystemModule(user, "scheduling"),
      scope: getOperatingSystemScope(user, "scheduling"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.scheduling,
      description: "Planning and staffing control for schedule owners.",
      managerOnly: true
    },
    schedule: {
      module: "schedule",
      canView: canAccessOperatingSystemModule(user, "schedule"),
      canManage: canManageOperatingSystemModule(user, "schedule"),
      scope: getOperatingSystemScope(user, "schedule"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.schedule,
      description: "Assignment calendar and shift visibility.",
      managerOnly: false
    },
    graphics: {
      module: "graphics",
      canView: canAccessOperatingSystemModule(user, "graphics"),
      canManage: canManageOperatingSystemModule(user, "graphics"),
      scope: getOperatingSystemScope(user, "graphics"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.graphics,
      description: "Downstream graphics workflow and deadlines.",
      managerOnly: false
    },
    approvals: {
      module: "approvals",
      canView: canAccessOperatingSystemModule(user, "approvals"),
      canManage: canManageOperatingSystemModule(user, "approvals"),
      scope: getOperatingSystemScope(user, "approvals"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.approvals,
      description: "Requests and review decisions that require action.",
      managerOnly: false
    },
    reports: {
      module: "reports",
      canView: canAccessOperatingSystemModule(user, "reports"),
      canManage: canManageOperatingSystemModule(user, "reports"),
      scope: getOperatingSystemScope(user, "reports"),
      routeId: OPERATING_SYSTEM_ROUTE_IDS.reports,
      description: "Trend and outlier reporting for scoped leaders.",
      managerOnly: true
    }
  };
}

export function hasCapability(user: SessionUser, capability: AppCapability) {
  if (hasRoleCapability(user, capability) || hasPermission(user, capability)) {
    return true;
  }
  const { domain, action } = parseCapability(capability);
  return hasPermissionGrant(user, domain, action) || hasCapabilityAlias(user, capability);
}

export function hasAnyCapability(user: SessionUser, capabilities: AppCapability[]) {
  return capabilities.some((capability) => hasCapability(user, capability));
}

export function canAccessEmployeeMyWork(user: SessionUser) {
  if (user.status !== "active") {
    return false;
  }
  const workSignals =
    hasAnyPermission(user, [
      "schedule.read",
      "time.clock",
      "trade.request",
      "pto.request",
      "approval.read",
      "notification.read",
      "shoot.read",
      "task.read",
      "task.update",
      "task.assign",
      "attendance.read",
      "attendance.manage",
      "media.attach"
    ]) ||
    hasAnyCapability(user, [
      "dashboard.view",
      "operations.view",
      "shoots.view",
      "schedule.view",
      "attendance.view",
      "requests.view",
      "approvals.view",
      "production.view",
      "reports.view"
    ]);

  if (hasAuthorityTier(user, HIGHER_AUTHORITY_TIERS as unknown as string[])) {
    return workSignals;
  }

  return (
    hasAuthorityTier(user, "standard_employee") &&
    hasJobFunctionProfile(user, FIELD_PROFILES as unknown as string[]) &&
    workSignals
  );
}

export function shouldLimitToEmployeeWorksurface(user: SessionUser) {
  const scopeSet = getGrantedScopes(user);
  const isLimitedScope = scopeSet.has("self_only") || scopeSet.has("self_only_scope");
  const hasOversightSignals =
    hasAuthorityTier(user, HIGHER_AUTHORITY_TIERS as unknown as string[]) ||
    hasAnyCapability(user, ["staffing.view", "approvals.view", "reports.view", "executive_metrics.view", "roles_permissions.view"]);
  return canAccessEmployeeMyWork(user) && (!hasOversightSignals || isLimitedScope);
}

export function canManagePermissions(user: SessionUser) {
  return (
    hasCapability(user, "roles_permissions.manage") ||
    hasCapability(user, "roles_permissions.configure") ||
    hasPermission(user, "settings.permissions.manage")
  );
}

export function canReadAuditLogs(user: SessionUser) {
  return hasCapability(user, "audit_controls.view") || hasPermission(user, "auditlog.read");
}

export function canViewCustomerService(user: SessionUser) {
  return hasCapability(user, "customer_service_metrics.view");
}

function inferFinanceOverlay(user: SessionUser) {
  return (
    hasPermissionPrefix(user, "finance") ||
    hasPermissionPrefix(user, "sports_finance") ||
    hasAnyPermission(user, ["labor.read", "profitability.read", "profitability_leadership.view"])
  );
}

export function hasFinanceOverlay(user: SessionUser) {
  if (typeof user.authorizationFlags?.financeSensitiveAccess === "boolean") {
    return user.authorizationFlags.financeSensitiveAccess;
  }
  if (user.capabilityOverlays?.includes("Finance")) {
    return true;
  }
  return inferFinanceOverlay(user);
}

export function canAccessFinanceSensitiveData(user: SessionUser) {
  return hasFinanceOverlay(user);
}

export function canModerateCommunications(user: SessionUser) {
  return user.authorizationFlags?.communicationsModeration ?? user.capabilityOverlays?.includes("CommunicationsModerator") ?? false;
}

export function canManageUserAccessOverlay(user: SessionUser) {
  return user.authorizationFlags?.userAccessAdministration ?? user.capabilityOverlays?.includes("UserAccessAdmin") ?? false;
}

export function canViewLabor(user: SessionUser) {
  return canAccessFinanceSensitiveData(user) && (hasPermission(user, "labor.read") || hasCapability(user, "reports.view"));
}

export function canViewLeadershipReports(user: SessionUser) {
  return (
    hasCapability(user, "reports.view") ||
    hasCapability(user, "executive_metrics.view") ||
    hasPermission(user, "report.read_global") ||
    hasPermission(user, "report.read_department")
  );
}

export function canViewProfitabilityLeadership(user: SessionUser) {
  return canAccessFinanceSensitiveData(user) && hasAnyPermission(user, ["profitability.read", "profitability_leadership.view"]);
}

export function canViewAccessDirectory(user: SessionUser) {
  return (
    hasCapability(user, "roles_permissions.view") ||
    hasPermission(user, "settings.permissions.read") ||
    canConfigureSystemBehavior(user)
  );
}

export function canAccessSecurityCenter(user: SessionUser) {
  return (
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"]) ||
    hasCapability(user, "audit_controls.view") ||
    hasCapability(user, "admin.configure") ||
    canConfigureSystemBehavior(user) ||
    hasPermission(user, "security.manage") ||
    hasPermission(user, "auditlog.read")
  );
}

export function canAccessAdminConfiguration(user: SessionUser) {
  return (
    canConfigureSystemBehavior(user) ||
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) ||
    hasAnyCapability(user, [
      "admin.view",
      "admin.configure",
      "audit_controls.view",
      "audit_controls.configure",
      "roles_permissions.view",
      "roles_permissions.configure",
      "integrations.view",
      "integrations.manage"
    ]) ||
    hasPermission(user, "settings.read") ||
    hasPermission(user, "settings.update") ||
    hasBusinessRole(user, ["leadership", "admin"])
  );
}

export function canAccessChecklistTemplates(user: SessionUser) {
  return (
    canAccessAdminConfiguration(user) ||
    hasPermission(user, "checklist.template.read") ||
    hasPermission(user, "checklist.template.manage")
  );
}

export function canAccessOutlook(user: SessionUser) {
  return (
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) ||
    hasCapability(user, "integrations.view") ||
    hasBusinessRole(user, ["leadership", "admin"])
  );
}

export function canAccessAdminWorkspace(user: SessionUser) {
  return (
    canConfigureSystemBehavior(user) ||
    canViewAccessDirectory(user) ||
    canAccessOutlook(user) ||
    canAccessSecurityCenter(user) ||
    canAccessAdminConfiguration(user) ||
    hasAnyPermission(user, [
      "system.diagnostics.read",
      "system.audit.read",
      "system.sync.read",
      "system.repairs.manage",
      "system.trace.read",
      "system.policy_trace.read",
      "system.import_audit.read",
      "system.export_audit.read"
    ])
  );
}

export function canAccessAdminSystem(user: SessionUser) {
  return (
    canConfigureSystemBehavior(user) ||
    hasAnyPermission(user, [
      "system.diagnostics.read",
      "system.audit.read",
      "system.sync.read",
      "system.repairs.manage",
      "system.trace.read",
      "system.policy_trace.read",
      "system.import_audit.read",
      "system.export_audit.read"
    ])
  );
}

export function canManageCanonicalDirectoryRecords(user: SessionUser) {
  return (
    hasPolicyPermissionAccess(user, "organization.update") ||
    hasPolicyPermissionAccess(user, "contact.update") ||
    hasPolicyPermissionAccess(user, "location.update") ||
    hasBusinessRole(user, ["manager", "leadership", "admin"]) ||
    hasCapability(user, "directory_accounts.manage") ||
    hasCapability(user, "directory_accounts.edit") ||
    hasCapability(user, "directory_contacts.manage") ||
    hasCapability(user, "directory_contacts.edit") ||
    hasCapability(user, "directory_locations.manage") ||
    hasCapability(user, "directory_locations.edit") ||
    hasCapability(user, "directory_internal.manage") ||
    hasCapability(user, "directory_internal.edit")
  );
}

export function canManageSchoolFoundation(user: SessionUser) {
  return (
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"]) ||
    (normalizeValue(user.department) === "schools" && hasAuthorityTier(user, "supervisor")) ||
    hasJobFunctionProfile(user, ["schools_client_success", "director_of_school_photography"])
  );
}

export function canAccessCanonicalDirectoryWorkspace(user: SessionUser) {
  return hasAnyCapability(user, [
    "directory_contacts.view",
    "directory_internal.view",
    "directory_locations.view",
    "directory_accounts.view"
  ]);
}

export function canManageSchoolsHub(user: SessionUser) {
  return (
    getPolicyAccessScope(user, "job.update", "schools") === "all" ||
    getPolicyAccessScope(user, "job.create", "schools") === "all" ||
    hasPermission(user, "schools_hub.manage") ||
    hasAuthorityTier(user, ["director_admin", "leadership", "super_admin"]) ||
    (normalizeValue(user.department) === "schools" && hasAuthorityTier(user, "supervisor")) ||
    hasJobFunctionProfile(user, ["schools_client_success", "director_of_school_photography"]) ||
    hasBusinessRole(user, ["leadership", "admin"])
  );
}

export function canManageSportsWorkspace(user: SessionUser) {
  return (
    getPolicyAccessScope(user, "job.update", "sports") === "all" ||
    getPolicyAccessScope(user, "job.create", "sports") === "all" ||
    hasPermission(user, "sports_hub.manage") ||
    hasAuthorityTier(user, ["director_admin", "leadership", "super_admin"]) ||
    (normalizeValue(user.department) === "sports" && hasAuthorityTier(user, "supervisor")) ||
    hasJobFunctionProfile(user, ["sports_client_success", "director_of_sports_photography"]) ||
    hasBusinessRole(user, ["leadership", "admin"])
  );
}

export function getSportsWorkspaceAccessScope(user: SessionUser): "all" | "own" | null {
  const policyScope = getPolicyAccessScope(user, "job.read", "sports");
  if (policyScope) {
    return policyScope;
  }
  if (canManageSportsWorkspace(user)) {
    return "all";
  }
  if (hasAuthorityTier(user, "read_only_viewer")) {
    return "all";
  }
  if (
    hasJobFunctionProfile(user, [
      "schools_client_success",
      "sports_client_success",
      "customer_service_rep",
      "graphic_artist",
      "director_of_digital_production",
      "director_of_school_photography"
    ])
  ) {
    return "all";
  }
  if (hasPermission(user, "sports_hub.view")) {
    return "all";
  }
  if (shouldLimitToEmployeeWorksurface(user)) {
    return "own";
  }
  return null;
}

export function canAccessSportsWorkspace(user: SessionUser) {
  return getSportsWorkspaceAccessScope(user) !== null;
}

export function hasReadOnlySportsWorkspaceAccess(user: SessionUser) {
  return canAccessSportsWorkspace(user) && !canManageSportsWorkspace(user);
}

export function canManageSportsFinance(user: SessionUser) {
  return (
    canAccessFinanceSensitiveData(user) &&
    (
    hasPermission(user, "finance.edit") ||
    hasPermission(user, "finance.view_costs") ||
    hasJobFunctionProfile(user, ["director_of_sports_photography"]) ||
    hasPermission(user, "sports_finance.manage")
    )
  );
}

export function canViewSportsFinance(user: SessionUser) {
  return (
    canManageSportsFinance(user) ||
    (canAccessFinanceSensitiveData(user) &&
      (hasPermission(user, "finance.view_summary") || hasPermission(user, "sports_finance.view") || canViewProfitabilityLeadership(user)))
  );
}

export function canAccessSportsSettings(user: SessionUser) {
  return (
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(user, ["director_of_sports_photography"]) ||
    hasPermission(user, "sports_hub.settings")
  );
}

export function canPublishSportsImports(user: SessionUser) {
  return (
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(user, ["director_of_sports_photography"]) ||
    hasPermission(user, "sports_hub.import_publish")
  );
}

export function canOverrideSportsDuplicates(user: SessionUser) {
  return (
    hasAuthorityTier(user, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(user, ["director_of_sports_photography"]) ||
    hasPermission(user, "sports_hub.duplicate_override")
  );
}

export function getSchoolsHubAccessScope(user: SessionUser): "all" | "own" | null {
  const policyScope = getPolicyAccessScope(user, "job.read", "schools");
  if (policyScope) {
    return policyScope;
  }
  if (canManageSchoolsHub(user)) {
    return "all";
  }
  if (hasPermission(user, "schools_hub.view")) {
    return "all";
  }
  if (hasJobFunctionProfile(user, ["sports_client_success", "customer_service_rep"])) {
    return "all";
  }
  if (hasAuthorityTier(user, "read_only_viewer")) {
    return "all";
  }
  if (
    hasJobFunctionProfile(user, [...FIELD_PROFILES, "graphic_artist"] as unknown as string[]) ||
    getRoleSet(user).has("office_employee")
  ) {
    return "own";
  }
  return null;
}

export function canAccessSchoolsHub(user: SessionUser) {
  return getSchoolsHubAccessScope(user) !== null;
}

export function hasReadOnlySchoolsHubAccess(user: SessionUser) {
  return (
    canAccessSchoolsHub(user) &&
    !canManageSchoolsHub(user)
  );
}

export function canAccessSalesPipeline(user: SessionUser) {
  return hasAnyCapability(user, ["growth.view", "pipeline.view", "proposals.view", "rfps.view", "renewals.view"]);
}

export function canAccessGearModule(user: SessionUser) {
  return hasAnyCapability(user, ["assets.view", "custody.view", "repairs.view"]);
}

export function canAccessComplianceWorkspace(user: SessionUser) {
  return (
    featureFlags.complianceWorkspaceV1 &&
    (
      hasAuthorityTier(user, ["super_admin", "leadership", "director_admin", "supervisor"]) ||
      hasAnyPermission(user, ["compliance.read", "attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"])
    )
  );
}

export function canCreateOrEditShoots(user: SessionUser) {
  return hasCapability(user, "shoots.create") || hasCapability(user, "shoots.edit");
}

export function canAccessGraphicsWorkspace(user: SessionUser) {
  return (
    hasCanonicalGraphicsAccessSignal(user) ||
    hasLegacyGraphicsAccessAlias(user) ||
    hasAnyPermission(user, ["qa.read", "release.read"])
  );
}

export function canAccessStudiosWorkspace(user: SessionUser) {
  return hasAnyCapability(user, [
    "shoots.view",
    "schedule.view",
    "staffing.view",
    "travel_logistics.view",
    "readiness.view"
  ]);
}

export function canAccessSharedExceptions(user: SessionUser) {
  return (
    canAccessOperatingSystemModule(user, "exceptions") ||
    canAccessOperatingSystemModule(user, "graphics") ||
    canManageSchoolsHub(user) ||
    canManageSportsWorkspace(user) ||
    hasLegacyExceptionsAccessAlias(user)
  );
}

/**
 * @deprecated Use canAccessGraphicsWorkspace.
 * Remove after all production-era page imports and callers use the canonical graphics wrapper.
 */
export function canAccessProductionProjects(user: SessionUser) {
  return canAccessGraphicsWorkspace(user);
}

/**
 * @deprecated Use canAccessStudiosWorkspace.
 * Remove after photography-era page imports and callers stop depending on this compatibility alias.
 */
export function canAccessPhotographyWorkspace(user: SessionUser) {
  return canAccessStudiosWorkspace(user);
}

/**
 * @deprecated Use canAccessSharedExceptions.
 * Remove after watchlist-era imports and callers stop depending on this compatibility alias.
 */
export function canAccessSharedWatchlist(user: SessionUser) {
  return canAccessSharedExceptions(user);
}

export function canAccessApprovalsHub(user: SessionUser) {
  return hasCapability(user, "approvals.view") || hasAnyPermission(user, ["trade.request", "pto.request"]);
}

export function canManageScheduleWorkspace(user: SessionUser) {
  return hasCapability(user, "schedule.manage");
}

export function canPublishScheduleWorkspace(user: SessionUser) {
  return hasCapability(user, "schedule.configure") || hasPermission(user, "schedule.publish");
}

export function canCreateShootRecords(user: SessionUser) {
  return hasCapability(user, "shoots.create");
}

export function canAccessSharedJobsShell(user: SessionUser) {
  return (
    canAccessSchoolsHub(user) ||
    canAccessSportsWorkspace(user) ||
    canCreateShootRecords(user) ||
    getPolicyAccessScope(user, "job.read", "schools") != null ||
    getPolicyAccessScope(user, "job.read", "sports") != null
  );
}

export function canManageSharedJobsShell(user: SessionUser) {
  return (
    canManageSchoolsHub(user) ||
    canManageSportsWorkspace(user) ||
    canCreateShootRecords(user) ||
    getPolicyAccessScope(user, "job.create", "schools") === "all" ||
    getPolicyAccessScope(user, "job.create", "sports") === "all"
  );
}

export function canAccessSharedTasksShell(user: SessionUser) {
  return (
    canManageSharedTasksShell(user) ||
    hasAnyPermission(user, ["task.read", "task.update", "task.assign"]) ||
    hasTaskScopeAccess(user, "task.read", "schools") ||
    hasTaskScopeAccess(user, "task.read", "sports") ||
    hasTaskScopeAccess(user, "task.read", "graphics") ||
    hasTaskScopeAccess(user, "task.read", "studios") ||
    hasTaskScopeAccess(user, "task.read", "operations")
  );
}

export function canManageSharedTasksShell(user: SessionUser) {
  return (
    canManageSchoolsHub(user) ||
    canManageSportsWorkspace(user) ||
    hasAnyPermission(user, ["task.create", "task.update", "task.assign"]) ||
    hasTaskScopeManagement(user, "schools") ||
    hasTaskScopeManagement(user, "sports") ||
    hasTaskScopeManagement(user, "graphics") ||
    hasTaskScopeManagement(user, "studios") ||
    hasTaskScopeManagement(user, "operations")
  );
}

export function canAccessAlertsHub(user: SessionUser) {
  return hasPermission(user, "alerts.read") || hasPermission(user, "alerts.read_own");
}

export function canAccessProjectTracking(user: SessionUser) {
  return (
    hasAnyPermission(user, ["workflow.read", "workflow.step.execute", "workflow.step.override", "workflow.instance.manage", "workflow.template.manage"]) ||
    hasCapability(user, "workflow.view") ||
    hasAuthorityTier(user, ["supervisor", "director_admin", "leadership", "super_admin"])
  );
}

export function canManageWorkflowTemplates(user: SessionUser) {
  return hasPermission(user, "workflow.template.manage") || hasAuthorityTier(user, ["director_admin", "leadership", "super_admin"]);
}

export function canAccessJobCloseoutV1(user: SessionUser) {
  return (
    featureFlags.jobCloseoutV1 &&
    (hasAuthorityTier(user, ["supervisor", "director_admin", "leadership", "super_admin"]) ||
      hasAnyPermission(user, [
        "job_closeout.read",
        "post_shoot_evaluation.read",
        "shoot_check_in.read",
        "mileage_review.read",
        "reports.read"
      ]) ||
      hasAnyCapability(user, ["shoots.view", "reports.view"]))
  );
}

export function canAccessClientCommandCenter(user: SessionUser) {
  return (
    hasAnyPermission(user, ["client_command_center.read", "client_command_center.manage"]) ||
    hasAnyCapability(user, ["directory_accounts.view", "directory_contacts.view"]) ||
    hasAuthorityTier(user, ["supervisor", "director_admin", "leadership", "super_admin"])
  );
}

export function canAccessExecutiveDashboard(user: SessionUser) {
  return (
    hasPermission(user, "executive.read") ||
    hasAuthorityTier(user, ["director_admin", "leadership", "super_admin"]) ||
    canViewLeadershipReports(user) ||
    canViewProfitabilityLeadership(user)
  );
}

function canAccessCanonicalDepartmentsSection(user: SessionUser) {
  return (
    canAccessSchoolsHub(user) ||
    canAccessSportsWorkspace(user) ||
    canAccessStudiosWorkspace(user) ||
    canAccessGraphicsWorkspace(user)
  );
}

function canAccessCanonicalOperationsSection(user: SessionUser) {
  return (
    hasCapability(user, "directory_accounts.view") ||
    canAccessClientCommandCenter(user) ||
    canAccessSharedJobsShell(user) ||
    canAccessProjectTracking(user) ||
    canAccessOperatingSystemModule(user, "schedule") ||
    canAccessSharedTasksShell(user) ||
    canAccessSharedExceptions(user) ||
    hasAnyCapability(user, ["people_ops.view", "requests.view", "approvals.view", "training.view", "certifications.view"]) ||
    canAccessComplianceWorkspace(user) ||
    canAccessGraphicsWorkspace(user)
  );
}

export function canAccessOperationsTodayBoard(user: SessionUser) {
  return (
    hasPermission(user, "dashboard.read") ||
    canAccessOperatingSystemModule(user, "operations") ||
    canAccessOperatingSystemModule(user, "exceptions") ||
    canManageSchoolsHub(user) ||
    canManageSportsWorkspace(user)
  );
}

export function canManageAttendanceWorkspace(user: SessionUser) {
  return hasCapability(user, "attendance.manage");
}

export function canApproveAttendanceExceptions(user: SessionUser) {
  return hasPermission(user, "attendance_exceptions.approve") || canManageAttendanceWorkspace(user);
}

export function canApproveMissedPunches(user: SessionUser) {
  return hasPermission(user, "missed_punches.approve") || canManageAttendanceWorkspace(user);
}

export function canRequestTrade(user: SessionUser) {
  return hasPermission(user, "trade.request");
}

export function canRequestPto(user: SessionUser) {
  return hasPermission(user, "pto.request");
}

export function canReadNotifications(user: SessionUser) {
  return hasPermission(user, "notification.read") || canAccessAlertsHub(user);
}

export function canUseCommunicationActions(user: SessionUser) {
  return hasPermission(user, "communication.use") && user.communicationIdentity?.status === "linked_ready";
}

export function canAccessTeamsCommunicationSurface(user: SessionUser) {
  return user.status === "active";
}

export function canSendCommunicationMessages(user: SessionUser) {
  return hasPermission(user, "communication.send") && user.communicationIdentity?.status === "linked_ready" && user.communicationIdentity?.canPost !== false;
}

export function canManageCommunicationMeetings(user: SessionUser) {
  return (
    hasAnyPermission(user, ["communication.meeting.manage", "system.configure"]) &&
    user.communicationIdentity?.status === "linked_ready"
  );
}

export function canConfigureCommunicationDestinations(user: SessionUser) {
  return hasAnyPermission(user, ["communication.configure", "system.configure"]);
}

export function canEditGearAssets(user: SessionUser) {
  return hasAnyPermission(user, ["gear_assets.edit", "gear_kits.edit"]);
}

export function canManageGearCustody(user: SessionUser) {
  return hasAnyPermission(user, ["gear_service_records.create", "gear_custody.edit"]);
}

export function canOverrideGearCustody(user: SessionUser) {
  return hasPermission(user, "gear_custody.override");
}

export function canViewWorkflowSnapshot(user: SessionUser) {
  return hasAnyCapability(user, ["operations.view", "schedule.view", "attendance.view"]) || canAccessComplianceWorkspace(user);
}

export function canViewManagerCockpit(user: SessionUser) {
  return hasBusinessRole(user, ["manager", "leadership", "admin"]) || hasAnyCapability(user, ["staffing.view", "approvals.view", "reports.view"]);
}

export function canReviewTradeRecord(
  user: SessionUser,
  approverUserId?: string | null,
  requesterUserId?: string | null,
  requestedWithUserId?: string | null
) {
  if ((requesterUserId && requesterUserId === user.id) || (requestedWithUserId && requestedWithUserId === user.id)) {
    return false;
  }
  if (approverUserId && approverUserId === user.id) {
    return true;
  }
  return hasCapability(user, "approvals.approve");
}

export function canReviewPtoRecord(user: SessionUser, approverUserId?: string | null, requesterUserId?: string | null) {
  if (requesterUserId && requesterUserId === user.id) {
    return false;
  }
  if (approverUserId && approverUserId === user.id) {
    return true;
  }
  return hasCapability(user, "approvals.approve");
}

export function canAccessTab(user: SessionUser, tab: TabKey) {
  switch (tab) {
    case "my-work":
      return canAccessEmployeeMyWork(user);
    case "dashboard":
      return hasCapability(user, "dashboard.view") || canAccessEmployeeMyWork(user);
    case "reports":
      return canViewLeadershipReports(user);
    case "profitability":
      return canViewProfitabilityLeadership(user);
    case "sales":
      return canAccessSalesPipeline(user);
    case "customer-service":
      return canViewCustomerService(user);
    case "training":
      return hasCapability(user, "training.view");
    case "outlook":
      return canAccessOutlook(user);
    case "organizations":
      return hasCapability(user, "directory_accounts.view");
    case "contacts":
      return hasAnyCapability(user, ["directory_contacts.view", "directory_internal.view"]);
    case "gear":
      return canAccessGearModule(user);
    case "locations":
      return hasCapability(user, "directory_locations.view");
    case "calendar":
      return hasCapability(user, "schedule.view");
    case "shoots":
      return hasCapability(user, "shoots.view");
    case "projects":
      return canAccessGraphicsWorkspace(user);
    case "alerts":
      return canAccessAlertsHub(user);
    case "labor":
    case "payroll":
      return canViewLabor(user);
    case "time":
      return hasCapability(user, "attendance.view");
    case "compliance":
      return canAccessComplianceWorkspace(user);
    case "approvals":
      return canAccessApprovalsHub(user);
    case "status-board":
    case "status-board-display":
      return hasCapability(user, "operations.view");
    case "access":
      return canViewAccessDirectory(user);
    case "security":
      return canAccessSecurityCenter(user);
    case "admin-config":
      return canAccessAdminConfiguration(user);
    case "account":
      return true;
    default:
      return false;
  }
}

export function canAccessSection(user: SessionUser, sectionKey: ShellSectionKey) {
  switch (sectionKey) {
    case "home":
      return canAccessOperatingSystemModule(user, "home") || canAccessEmployeeMyWork(user);
    case "needs-attention":
      return canAccessComplianceWorkspace(user);
    case "photography":
      return canAccessStudiosWorkspace(user);
    case "production":
      return canAccessGraphicsWorkspace(user) || canAccessProjectTracking(user);
    case "project-tracking":
      return canAccessProjectTracking(user);
    case "jobs":
      return canAccessSharedJobsShell(user);
    case "contacts":
      return canAccessCanonicalDirectoryWorkspace(user) || canAccessClientCommandCenter(user);
    case "schedule":
      return canAccessOperatingSystemModule(user, "schedule") || canAccessOperatingSystemModule(user, "scheduling");
    case "hr-admin":
      return (
        hasAnyCapability(user, ["people_ops.view", "requests.view", "approvals.view", "training.view", "certifications.view", "attendance.view", "assets.view"]) ||
        canAccessApprovalsHub(user) ||
        canAccessComplianceWorkspace(user) ||
        canAccessGearModule(user)
      );
    case "leadership":
      return (
        canAccessExecutiveDashboard(user) ||
        canAccessOperatingSystemModule(user, "reports") ||
        hasAnyCapability(user, ["business_health.view", "customer_service_metrics.view", "executive_metrics.view"]) ||
        canAccessSalesPipeline(user) ||
        canAccessSharedExceptions(user)
      );
    case "settings":
      return canAccessAdminWorkspace(user) || canManageWorkflowTemplates(user) || canAccessSportsSettings(user);
    case "departments":
      return canAccessCanonicalDepartmentsSection(user);
    case "operations":
      return canAccessCanonicalOperationsSection(user);
    case "my-work":
      return canAccessEmployeeMyWork(user);
    case "dashboard":
      return canAccessOperatingSystemModule(user, "home") || canAccessEmployeeMyWork(user);
    case "schools":
      return canAccessSchoolsHub(user);
    case "sports":
      return canAccessSportsWorkspace(user);
    case "graphics":
      return canAccessGraphicsWorkspace(user);
    case "studios":
      return canAccessStudiosWorkspace(user);
    case "directory":
      return canAccessCanonicalDirectoryWorkspace(user) || canAccessSalesPipeline(user);
    case "employees":
      return (
        hasAnyCapability(user, ["people_ops.view", "requests.view", "approvals.view", "training.view", "certifications.view"]) ||
        canAccessApprovalsHub(user) ||
        canAccessComplianceWorkspace(user)
      );
    case "reports":
      return (
        canAccessOperatingSystemModule(user, "reports") ||
        hasAnyCapability(user, ["business_health.view", "customer_service_metrics.view", "executive_metrics.view"])
      );
    case "admin":
      return canAccessAdminWorkspace(user);
    default:
      return false;
  }
}

export function canAccessRoute(user: SessionUser, routeId: ShellRouteId) {
  switch (routeId) {
    case "dashboard":
      return canAccessOperatingSystemModule(user, "home");
    case "teams-home":
      return canAccessEmployeeMyWork(user) || canAccessOperatingSystemModule(user, "home");
    case "teams-communications":
    case "communications":
      return canAccessTeamsCommunicationSurface(user);
    case "dashboard-my-day":
      return canAccessEmployeeMyWork(user);
    case "dashboard-my-schedule":
      return canAccessOperatingSystemModule(user, "schedule");
    case "search":
      return true;
    case "dashboard-my-tasks":
      return hasAnyCapability(user, ["requests.view", "production.view", "approvals.view"]) || canAccessComplianceWorkspace(user);
    case "dashboard-alerts":
      return canAccessAlertsHub(user);
    case "exceptions":
      return canAccessSharedExceptions(user);
    case "watchlist":
      return canAccessSharedExceptions(user);
    case "executive":
      return canAccessExecutiveDashboard(user);
    case "operations":
      return canAccessSection(user, "operations");
    case "operations-exceptions":
      return canAccessOperatingSystemModule(user, "exceptions");
    case "operations-watch":
      return canAccessOperatingSystemModule(user, "exceptions");
    case "urgent-window":
      return canAccessOperatingSystemModule(user, "exceptions");
    case "operations-today":
      return canAccessOperationsTodayBoard(user);
    case "studios":
      return canAccessSection(user, "studios");
    case "photography":
      return canAccessSection(user, "studios");
    case "studios-shoots":
      return hasCapability(user, "shoots.view");
    case "operations-shoots":
      return hasCapability(user, "shoots.view");
    case "studios-pre-service":
      return canAccessStudiosWorkspace(user);
    case "photography-pre-service":
      return canAccessStudiosWorkspace(user);
    case "studios-staffing":
      return canAccessOperatingSystemModule(user, "scheduling") || hasCapability(user, "staffing.view");
    case "photography-staffing":
      return canAccessOperatingSystemModule(user, "scheduling") || hasCapability(user, "staffing.view");
    case "studios-calendar":
      return canAccessOperatingSystemModule(user, "schedule");
    case "photography-calendar":
      return canAccessOperatingSystemModule(user, "schedule");
    case "studios-workload":
      return canAccessStudiosWorkspace(user);
    case "photography-workload":
      return canAccessStudiosWorkspace(user);
    case "operations-scheduling":
      return canAccessOperatingSystemModule(user, "scheduling");
    case "operations-schedule":
      return canAccessOperatingSystemModule(user, "schedule");
    case "operations-staffing":
      return canAccessOperatingSystemModule(user, "scheduling") || hasCapability(user, "staffing.view");
    case "operations-staffing-capacity": {
      // Mirrors the capacity view's own gate (manager-level schedule scope), so the route and the page agree.
      const capacityScope = getOperatingSystemScope(user, "schedule");
      return capacityScope === "all" || capacityScope === "department";
    }
    case "operations-attendance":
      return canAccessOperatingSystemModule(user, "operations") || hasCapability(user, "attendance.view");
    case "operations-status-board":
    case "status-board-display":
      return hasCapability(user, "operations.view");
    case "studios-travel":
      return hasCapability(user, "travel_logistics.view");
    case "operations-travel":
      return hasCapability(user, "travel_logistics.view");
    case "people-exceptions":
      return hasAnyCapability(user, ["approvals.view", "schedule.view"]);
    case "studios-readiness":
      return hasCapability(user, "readiness.view");
    case "operations-readiness":
      return hasCapability(user, "readiness.view");
    case "operations-job-admin":
      return canAccessSection(user, "operations") && canAccessSharedJobsShell(user);
    case "jobs":
    case "job-detail":
      return canAccessSharedJobsShell(user);
    case "project-tracking":
      return canAccessProjectTracking(user);
    case "prep-readiness-queue":
      return canAccessProjectTracking(user) || canAccessClientCommandCenter(user);
    case "production-workflow-queue":
      return canAccessProjectTracking(user) || canAccessGraphicsWorkspace(user);
    case "workflow-template-builder":
      return canManageWorkflowTemplates(user);
    case "client-command-center":
      return canAccessClientCommandCenter(user);
    case "job-closeout-v1":
      return canAccessJobCloseoutV1(user);
    case "job-new":
    case "job-edit":
      return canManageSharedJobsShell(user);
    case "task-detail":
      return canAccessSharedTasksShell(user);
    case "task-new":
      return canManageSharedTasksShell(user);
    case "operations-schools":
      return canAccessSchoolsHub(user);
    case "schools-jobs":
    case "schools-job-detail":
    case "schools-tasks":
    case "schools-exceptions":
      return canAccessSchoolsHub(user);
    case "schools-production":
    case "schools-watchlist":
      return canAccessSchoolsHub(user);
    case "schools-job-new":
    case "schools-job-edit":
      return canManageSchoolsHub(user) || canCreateShootRecords(user);
    case "sports":
      return canAccessSection(user, "sports");
    case "sports-shoots":
    case "sports-shoot-detail":
    case "sports-shoot-new":
    case "sports-shoot-edit":
    case "sports-accounts":
    case "sports-contacts":
    case "sports-graphics":
    case "sports-reports":
      return routeId === "sports-shoot-new" || routeId === "sports-shoot-edit"
        ? canManageSportsWorkspace(user) || canCreateShootRecords(user)
        : canAccessSportsWorkspace(user);
    case "sports-exceptions":
      return canAccessSportsWorkspace(user);
    case "sports-production":
    case "sports-watchlist":
      return canAccessSportsWorkspace(user);
    case "sports-settings":
      return canAccessSportsSettings(user);
    case "sports-shoots-import":
      return canCreateShootRecords(user);
    case "graphics":
      return canAccessGraphicsWorkspace(user);
    case "production":
      return canAccessGraphicsWorkspace(user) || canAccessProjectTracking(user);
    case "files":
      return canAccessGraphicsWorkspace(user);
    case "production-assets":
      return canAccessGraphicsWorkspace(user);
    case "graphics-queue":
    case "graphics-legacy-alias":
    case "graphics-workload":
      return canAccessGraphicsWorkspace(user);
    case "production-job-queue":
    case "production-digital":
    case "production-workload":
      return canAccessGraphicsWorkspace(user);
    case "graphics-qa":
      return canAccessGraphicsWorkspace(user) || hasAnyPermission(user, ["qa.read", "qa.manage"]);
    case "production-qa":
      return canAccessGraphicsWorkspace(user) || hasAnyPermission(user, ["qa.read", "qa.manage"]);
    case "graphics-release":
      return canAccessGraphicsWorkspace(user) || hasAnyPermission(user, ["deliverable.read", "deliverable.manage", "release.read"]);
    case "production-release":
      return canAccessGraphicsWorkspace(user) || hasAnyPermission(user, ["deliverable.read", "deliverable.manage", "release.read"]);
    case "production-post-shoot-review":
      return hasCapability(user, "review_desk.view");
    case "review-desk":
      return canAccessComplianceWorkspace(user);
    case "directory":
      return canAccessSection(user, "directory");
    case "directory-contacts":
    case "directory-contact-detail":
      return hasCapability(user, "directory_contacts.view");
    case "directory-internal":
      return hasCapability(user, "directory_internal.view");
    case "directory-locations":
    case "directory-location-detail":
      return hasCapability(user, "directory_locations.view");
    case "directory-accounts":
    case "directory-organization-detail":
      return hasCapability(user, "directory_accounts.view");
    case "assets":
      return canAccessGearModule(user);
    case "assets-gear":
      return hasCapability(user, "assets.view");
    case "assets-kits":
    case "assets-custody":
      return hasAnyCapability(user, ["assets.view", "custody.view"]);
    case "assets-repairs":
    case "assets-maintenance":
    case "assets-history":
      return hasAnyCapability(user, ["repairs.view", "assets.view"]);
    case "people-ops":
      return canAccessSection(user, "employees");
    case "people-ops-requests":
    case "people-ops-pto":
    case "people-ops-availability":
      return hasCapability(user, "requests.view");
    case "people-ops-approvals":
      return canAccessOperatingSystemModule(user, "approvals");
    case "people-ops-compliance":
      return canAccessComplianceWorkspace(user);
    case "people-ops-training":
      return hasCapability(user, "training.view");
    case "people-ops-certifications":
      return hasCapability(user, "certifications.view");
    case "people-ops-performance":
      return hasAnyCapability(user, ["people_ops.view", "approvals.view"]);
    case "people-ops-readiness":
      return hasAnyCapability(user, ["people_ops.view", "training.view", "certifications.view"]);
    case "people-ops-payroll":
      return canViewLabor(user);
    case "growth":
      return canAccessSalesPipeline(user);
    case "growth-pipeline":
    case "growth-opportunities":
      return hasAnyCapability(user, ["growth.view", "pipeline.view"]);
    case "growth-proposals":
      return hasAnyCapability(user, ["growth.view", "proposals.view"]);
    case "growth-rfps":
      return hasAnyCapability(user, ["growth.view", "rfps.view"]);
    case "growth-renewals":
      return hasAnyCapability(user, ["growth.view", "renewals.view"]);
    case "growth-accounts":
      return hasCapability(user, "directory_accounts.view");
    case "business-health":
      return canAccessSection(user, "reports");
    case "business-health-reports":
    case "business-health-kpis":
    case "business-health-trends":
    case "business-health-operations":
      return canAccessOperatingSystemModule(user, "reports");
    case "business-health-labor":
      return canViewLabor(user);
    case "business-health-profitability":
    case "business-health-executive-summary":
      return canViewProfitabilityLeadership(user) || canViewLeadershipReports(user);
    case "business-health-customer-service":
      return canViewCustomerService(user) || canViewLeadershipReports(user);
    case "admin":
      return canAccessSection(user, "admin");
    case "admin-roles":
      return canViewAccessDirectory(user);
    case "admin-integrations":
      return canAccessOutlook(user);
    case "admin-checklists":
      return canAccessChecklistTemplates(user);
    case "admin-automations":
      return canAccessAdminWorkspace(user);
    case "admin-settings":
      return canAccessAdminConfiguration(user);
      case "admin-audit":
        return canReadAuditLogs(user);
      case "admin-reference-data":
        return canAccessAdminConfiguration(user);
      case "admin-system":
      case "admin-system-diagnostics":
      case "admin-system-audit-log":
      case "admin-system-sync":
      case "admin-system-repairs":
      case "admin-system-access-debug":
      case "admin-system-imports":
      case "admin-system-exports":
      case "admin-system-trace":
        return canAccessAdminSystem(user);
      case "admin-review-tools":
        return canAccessAdminWorkspace(user) && canViewLabor(user);
    case "account":
      return true;
    default:
      return false;
  }
}

export function getDefaultLandingRoute(user: SessionUser): ShellRouteId {
  if (canAccessRoute(user, "dashboard")) {
    return "dashboard";
  }
  if (shouldLimitToEmployeeWorksurface(user)) {
    return "dashboard-my-day";
  }
  return "dashboard";
}
