import type {
  AuthPermissionGrant,
  AuthRole,
  AuthUser,
  AuthorityTier,
  DepartmentCode,
  JobFunctionProfile,
  PermissionAction,
  PermissionDomain,
  PermissionScope
} from "../types/auth.js";

export const AUTHORITY_TIERS: AuthorityTier[] = [
  "super_admin",
  "leadership",
  "director_admin",
  "supervisor",
  "standard_employee",
  "read_only_viewer"
];

export const JOB_FUNCTION_PROFILES: JobFunctionProfile[] = [
  "associate_photographer",
  "seasonal_photographer",
  "part_time_photographer",
  "senior_photographer",
  "schools_client_success",
  "sports_client_success",
  "customer_service_rep",
  "graphic_artist",
  "director_of_photography",
  "director_of_school_photography",
  "director_of_sports_photography",
  "director_of_digital_production",
  "leadership_team_member",
  "leadership_viewer"
];

export const PERMISSION_DOMAINS: PermissionDomain[] = [
  "training_documents",
  "sales_pipeline",
  "gear_assets",
  "gear_kits",
  "gear_custody",
  "gear_service_records",
  "shoot_locations",
  "calendar_events",
  "sessions_shoots",
  "staffing_assignments",
  "schedules_shifts",
  "clock_in_out",
  "time_edits",
  "missed_punches",
  "early_late_clock_in_approvals",
  "pto_requests",
  "pto_approvals",
  "shift_swaps",
  "attendance_exceptions",
  "labor_cost",
  "profitability_leadership",
  "profitability_employee_signals",
  "profitability_imports",
  "customer_service_metrics",
  "reporting_exports",
  "audit_logs",
  "system_settings_permissions"
];

export const PERMISSION_ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "approve",
  "override",
  "delete",
  "export",
  "receive_notifications"
];

export const PERMISSION_SCOPES: PermissionScope[] = [
  "own_records_only",
  "own_shift_only",
  "own_pto_only",
  "assigned_shoot_only",
  "shoot_lead_scope_only",
  "department_only",
  "organization_wide_scope",
  "trade_participant_scope_only"
];

type AuthorityAssignment = {
  authorityTier: AuthorityTier;
  jobFunctionProfiles: JobFunctionProfile[];
  primaryJobFunctionProfile: JobFunctionProfile;
};

type GrantInput = {
  domain: PermissionDomain;
  actions: PermissionAction[];
  scope: PermissionScope;
};

type PermissionContext = {
  department?: DepartmentCode | null;
  subjectUserId?: string | null;
  shiftAssignedUserId?: string | null;
  ptoUserId?: string | null;
  shootLeadUserId?: string | null;
  isAssignedToShoot?: boolean;
  tradeParticipantUserIds?: string[];
};

const LEGACY_PERMISSION_CODES = [
  "schools_hub.view",
  "schools_hub.manage",
  "shoot.create",
  "shoot.read",
  "shoot.update",
  "shoot.delete",
  "schedule.read",
  "schedule.manage",
  "schedule.publish",
  "status_event.create",
  "time.clock",
  "time_entry.read",
  "mileage.create",
  "upload.presign",
  "media.attach",
  "attendance.read",
  "attendance.manage",
  "alerts.read",
  "alerts.resolve",
  "push.manage",
  "trade.request",
  "trade.approve",
  "pto.request",
  "pto.approve",
  "notification.read",
  "dashboard.read",
  "user.read",
  "user.invite",
  "user.approve",
  "user.role.update",
  "user.department.update",
  "user.suspend",
  "user.reactivate",
  "user.revoke",
  "audit.read",
  "security.manage"
] as const;

const ACCESS_POLICY_ADMIN_PERMISSION_CODES = [
  "settings.permissions.read",
  "settings.permissions.manage",
  "settings.roles.manage",
  "settings.delegations.manage",
  "settings.field_policies.manage",
  "access_preview.use"
] as const;

function grant(domain: PermissionDomain, actions: PermissionAction[], scope: PermissionScope): AuthPermissionGrant[] {
  return actions.map((action) => ({ domain, action, scope }));
}

function grantMany(inputs: GrantInput[]): AuthPermissionGrant[] {
  return inputs.flatMap((input) => grant(input.domain, input.actions, input.scope));
}

function canonicalCode(grant: Pick<AuthPermissionGrant, "domain" | "action">) {
  return `${grant.domain}.${grant.action}`;
}

const SUPER_ADMIN_GRANTS = PERMISSION_DOMAINS.flatMap((domain) => grant(domain, PERMISSION_ACTIONS, "organization_wide_scope"));

const LEADERSHIP_OPERATIONAL_DOMAINS: PermissionDomain[] = [
  "training_documents",
  "sales_pipeline",
  "gear_assets",
  "gear_kits",
  "gear_custody",
  "gear_service_records",
  "shoot_locations",
  "calendar_events",
  "sessions_shoots",
  "staffing_assignments",
  "schedules_shifts",
  "clock_in_out",
  "time_edits",
  "missed_punches",
  "early_late_clock_in_approvals",
  "pto_requests",
  "pto_approvals",
  "shift_swaps",
  "attendance_exceptions",
  "labor_cost",
  "profitability_leadership",
  "profitability_imports",
  "customer_service_metrics",
  "reporting_exports",
  "audit_logs"
];

const DIRECTOR_OPERATIONAL_DOMAINS: PermissionDomain[] = [
  "training_documents",
  "sales_pipeline",
  "gear_assets",
  "gear_kits",
  "gear_custody",
  "gear_service_records",
  "shoot_locations",
  "calendar_events",
  "sessions_shoots",
  "staffing_assignments",
  "schedules_shifts",
  "clock_in_out",
  "time_edits",
  "missed_punches",
  "early_late_clock_in_approvals",
  "pto_requests",
  "pto_approvals",
  "shift_swaps",
  "attendance_exceptions",
  "labor_cost",
  "profitability_leadership",
  "profitability_imports",
  "customer_service_metrics",
  "reporting_exports"
];

const TIER_GRANTS: Record<AuthorityTier, AuthPermissionGrant[]> = {
  super_admin: SUPER_ADMIN_GRANTS,
  leadership: [
    ...LEADERSHIP_OPERATIONAL_DOMAINS.flatMap((domain) => grant(domain, PERMISSION_ACTIONS, "organization_wide_scope")),
    ...grant("system_settings_permissions", ["view"], "organization_wide_scope")
  ],
  director_admin: DIRECTOR_OPERATIONAL_DOMAINS.flatMap((domain) =>
    grant(domain, ["view", "create", "edit", "approve", "override", "delete", "export", "receive_notifications"], "organization_wide_scope")
  ),
  supervisor: grantMany([
    { domain: "gear_assets", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "gear_kits", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "gear_custody", actions: ["view", "create", "edit"], scope: "organization_wide_scope" },
    { domain: "gear_service_records", actions: ["view", "create"], scope: "organization_wide_scope" }
  ]),
  standard_employee: [],
  read_only_viewer: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sessions_shoots", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "schedules_shifts", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "attendance_exceptions", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "labor_cost", actions: ["view", "export"], scope: "organization_wide_scope" },
    { domain: "customer_service_metrics", actions: ["view", "export"], scope: "organization_wide_scope" },
    { domain: "reporting_exports", actions: ["view", "export"], scope: "organization_wide_scope" },
    { domain: "audit_logs", actions: ["view", "export"], scope: "organization_wide_scope" }
  ])
};

const PROFILE_GRANTS: Record<JobFunctionProfile, AuthPermissionGrant[]> = {
  associate_photographer: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sessions_shoots", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "staffing_assignments", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "schedules_shifts", actions: ["view"], scope: "own_shift_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" }
  ]),
  seasonal_photographer: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sessions_shoots", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "staffing_assignments", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "schedules_shifts", actions: ["view"], scope: "own_shift_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" }
  ]),
  part_time_photographer: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sessions_shoots", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "staffing_assignments", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "schedules_shifts", actions: ["view"], scope: "own_shift_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" }
  ]),
  senior_photographer: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sessions_shoots", actions: ["view"], scope: "assigned_shoot_only" },
    { domain: "staffing_assignments", actions: ["view"], scope: "shoot_lead_scope_only" },
    { domain: "schedules_shifts", actions: ["view"], scope: "shoot_lead_scope_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "missed_punches", actions: ["create", "approve", "receive_notifications"], scope: "shoot_lead_scope_only" },
    { domain: "early_late_clock_in_approvals", actions: ["approve", "receive_notifications"], scope: "shoot_lead_scope_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" },
    { domain: "attendance_exceptions", actions: ["view", "approve", "receive_notifications"], scope: "shoot_lead_scope_only" }
  ]),
  schools_client_success: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sales_pipeline", actions: ["view", "create", "edit", "receive_notifications"], scope: "department_only" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "calendar_events", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "sessions_shoots", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "schedules_shifts", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" }
  ]),
  sports_client_success: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "sales_pipeline", actions: ["view", "create", "edit", "receive_notifications"], scope: "department_only" },
    { domain: "shoot_locations", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "calendar_events", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "sessions_shoots", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "schedules_shifts", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" }
  ]),
  customer_service_rep: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "calendar_events", actions: ["view", "create", "edit"], scope: "department_only" },
    { domain: "schedules_shifts", actions: ["view"], scope: "department_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" },
    { domain: "customer_service_metrics", actions: ["view", "receive_notifications"], scope: "organization_wide_scope" }
  ]),
  graphic_artist: grantMany([
    { domain: "training_documents", actions: ["view"], scope: "organization_wide_scope" },
    { domain: "schedules_shifts", actions: ["view"], scope: "own_shift_only" },
    { domain: "clock_in_out", actions: ["create"], scope: "own_shift_only" },
    { domain: "time_edits", actions: ["view"], scope: "own_records_only" },
    { domain: "attendance_exceptions", actions: ["view", "create"], scope: "own_records_only" },
    { domain: "missed_punches", actions: ["view", "create"], scope: "own_shift_only" },
    { domain: "pto_requests", actions: ["view", "create"], scope: "own_pto_only" },
    { domain: "shift_swaps", actions: ["view", "create", "approve", "receive_notifications"], scope: "trade_participant_scope_only" }
  ]),
  director_of_photography: [],
  director_of_school_photography: [],
  director_of_sports_photography: [],
  director_of_digital_production: [],
  leadership_team_member: [],
  leadership_viewer: []
};

const TIER_COMPATIBILITY_PERMISSIONS: Record<AuthorityTier, string[]> = {
  super_admin: [
    ...LEGACY_PERMISSION_CODES,
    ...ACCESS_POLICY_ADMIN_PERMISSION_CODES,
    "evaluation.read",
    "evaluation.create",
    "evaluation.update",
    "evaluation.review",
    "evaluation.read_sensitive",
    "system.diagnostics.read",
    "system.audit.read",
    "system.sync.read",
    "system.repairs.manage",
    "system.trace.read",
    "system.policy_trace.read",
    "system.import_audit.read",
    "system.export_audit.read"
  ],
  leadership: [
    "schools_hub.view",
    "schools_hub.manage",
    "shoot.create",
    "shoot.read",
    "shoot.update",
    "shoot.delete",
    "status_event.create",
    "time.clock",
    "time_entry.read",
    "mileage.create",
    "upload.presign",
    "media.attach",
    "schedule.read",
    "schedule.manage",
    "schedule.publish",
    "attendance.read",
    "attendance.manage",
    "alerts.read",
    "alerts.resolve",
    "push.manage",
    "trade.request",
    "trade.approve",
    "pto.request",
    "pto.approve",
    "notification.read",
    "dashboard.read",
    "user.read",
    "audit.read",
    "evaluation.read",
    "evaluation.create",
    "evaluation.update",
    "evaluation.review",
    "evaluation.read_sensitive",
    "system.diagnostics.read",
    "system.audit.read",
    "system.sync.read",
    "system.trace.read",
    "system.policy_trace.read",
    "system.import_audit.read",
    "system.export_audit.read"
  ],
  director_admin: [
    "schools_hub.view",
    "schools_hub.manage",
    ...ACCESS_POLICY_ADMIN_PERMISSION_CODES,
    "shoot.create",
    "shoot.read",
    "shoot.update",
    "shoot.delete",
    "status_event.create",
    "time.clock",
    "time_entry.read",
    "mileage.create",
    "upload.presign",
    "media.attach",
    "schedule.read",
    "schedule.manage",
    "schedule.publish",
    "attendance.read",
    "attendance.manage",
    "alerts.read",
    "alerts.resolve",
    "push.manage",
    "trade.request",
    "trade.approve",
    "pto.request",
    "pto.approve",
    "notification.read",
    "dashboard.read",
    "evaluation.read",
    "evaluation.create",
    "evaluation.update",
    "evaluation.review",
    "evaluation.read_sensitive",
    "system.diagnostics.read",
    "system.audit.read",
    "system.sync.read",
    "system.repairs.manage",
    "system.trace.read",
    "system.policy_trace.read",
    "system.import_audit.read",
    "system.export_audit.read"
  ],
  supervisor: ["schools_hub.view", "schools_hub.manage"],
  standard_employee: [],
  read_only_viewer: ["schools_hub.view", "shoot.read", "schedule.read", "attendance.read", "notification.read", "dashboard.read", "audit.read"]
};

const PROFILE_COMPATIBILITY_PERMISSIONS: Record<JobFunctionProfile, string[]> = {
  associate_photographer: ["shoot.read", "status_event.create", "time.clock", "time_entry.read", "mileage.create", "upload.presign", "media.attach", "push.manage", "schedule.read", "trade.request", "pto.request", "notification.read", "evaluation.read", "evaluation.create", "evaluation.update"],
  seasonal_photographer: ["shoot.read", "status_event.create", "time.clock", "time_entry.read", "mileage.create", "upload.presign", "media.attach", "push.manage", "schedule.read", "trade.request", "pto.request", "notification.read", "evaluation.read", "evaluation.create", "evaluation.update"],
  part_time_photographer: ["shoot.read", "status_event.create", "time.clock", "time_entry.read", "mileage.create", "upload.presign", "media.attach", "push.manage", "schedule.read", "trade.request", "pto.request", "notification.read", "evaluation.read", "evaluation.create", "evaluation.update"],
  senior_photographer: ["shoot.read", "status_event.create", "time.clock", "time_entry.read", "mileage.create", "upload.presign", "media.attach", "push.manage", "schedule.read", "attendance.read", "attendance.manage", "trade.request", "trade.approve", "pto.request", "notification.read", "evaluation.read", "evaluation.create", "evaluation.update"],
  schools_client_success: [
    "schools_hub.view",
    "schools_hub.manage",
    "shoot.create",
    "shoot.read",
    "shoot.update",
    "schedule.read",
    "schedule.manage",
    "schedule.publish",
    "time.clock",
    "time_entry.read",
    "trade.request",
    "pto.request",
    "notification.read",
    "dashboard.read",
    "job.create",
    "job.read",
    "job.update",
    "job.publish",
    "job.assign_staff",
    "job.manage_readiness",
    "jobday.create",
    "jobday.update",
    "watchlist.read",
    "task.read",
    "production.read"
  ],
  sports_client_success: [
    "shoot.create",
    "shoot.read",
    "shoot.update",
    "schedule.read",
    "schedule.manage",
    "schedule.publish",
    "time.clock",
    "time_entry.read",
    "trade.request",
    "pto.request",
    "notification.read",
    "dashboard.read",
    "job.create",
    "job.read",
    "job.update",
    "job.publish",
    "job.assign_staff",
    "job.manage_readiness",
    "jobday.create",
    "jobday.update",
    "watchlist.read",
    "task.read",
    "production.read"
  ],
  customer_service_rep: ["schools_hub.view", "dashboard.read", "schedule.read", "time.clock", "time_entry.read", "trade.request", "pto.request", "notification.read", "job.read", "watchlist.read", "task.read"],
  graphic_artist: ["schedule.read", "time.clock", "time_entry.read", "trade.request", "pto.request", "notification.read"],
  director_of_photography: ["evaluation.read", "evaluation.create", "evaluation.update", "evaluation.review", "evaluation.read_sensitive"],
  director_of_school_photography: ["schools_hub.view", "schools_hub.manage", "evaluation.read", "evaluation.create", "evaluation.update", "evaluation.review", "evaluation.read_sensitive"],
  director_of_sports_photography: ["evaluation.read", "evaluation.create", "evaluation.update", "evaluation.review", "evaluation.read_sensitive"],
  director_of_digital_production: [],
  leadership_team_member: ["evaluation.read", "evaluation.create", "evaluation.update", "evaluation.review", "evaluation.read_sensitive"],
  leadership_viewer: []
};

export function getDefaultAuthorityAssignmentForLegacyRole(role: AuthRole, department: DepartmentCode): AuthorityAssignment {
  switch (role) {
    case "owner_admin":
      return {
        authorityTier: "super_admin",
        primaryJobFunctionProfile: "leadership_team_member",
        jobFunctionProfiles: ["leadership_team_member"]
      };
    case "admin":
      return {
        authorityTier: "director_admin",
        primaryJobFunctionProfile: "director_of_photography",
        jobFunctionProfiles: ["director_of_photography"]
      };
    case "leadership":
      return {
        authorityTier: "leadership",
        primaryJobFunctionProfile: "leadership_team_member",
        jobFunctionProfiles: ["leadership_team_member"]
      };
    case "senior_photographer":
      return {
        authorityTier: "supervisor",
        primaryJobFunctionProfile: "senior_photographer",
        jobFunctionProfiles: ["senior_photographer"]
      };
    case "associate_photographer":
      return {
        authorityTier: "standard_employee",
        primaryJobFunctionProfile: "associate_photographer",
        jobFunctionProfiles: ["associate_photographer"]
      };
    case "photographer":
      return {
        authorityTier: "standard_employee",
        primaryJobFunctionProfile: "seasonal_photographer",
        jobFunctionProfiles: ["seasonal_photographer"]
      };
    case "office_employee":
    default: {
      const primaryJobFunctionProfile =
        department === "schools"
          ? "schools_client_success"
          : department === "sports"
            ? "sports_client_success"
            : department === "production"
              ? "graphic_artist"
              : "customer_service_rep";
      return {
        authorityTier: "standard_employee",
        primaryJobFunctionProfile,
        jobFunctionProfiles: [primaryJobFunctionProfile]
      };
    }
  }
}

export function getPrimaryLegacyRoleForAuthority(
  authorityTier: AuthorityTier,
  jobFunctionProfiles: JobFunctionProfile[]
): AuthRole {
  if (authorityTier === "super_admin") {
    return "owner_admin";
  }
  if (authorityTier === "leadership") {
    return "leadership";
  }
  if (authorityTier === "director_admin") {
    return "admin";
  }
  if (jobFunctionProfiles.includes("senior_photographer")) {
    return "senior_photographer";
  }
  if (jobFunctionProfiles.includes("associate_photographer")) {
    return "associate_photographer";
  }
  if (jobFunctionProfiles.includes("seasonal_photographer") || jobFunctionProfiles.includes("part_time_photographer")) {
    return "photographer";
  }
  return "office_employee";
}

export function getLegacyRolesForAuthority(authorityTier: AuthorityTier, jobFunctionProfiles: JobFunctionProfile[]) {
  return [getPrimaryLegacyRoleForAuthority(authorityTier, jobFunctionProfiles)];
}

export function buildEffectivePermissionGrants(
  authorityTier: AuthorityTier,
  jobFunctionProfiles: JobFunctionProfile[]
): AuthPermissionGrant[] {
  const grants = [...(TIER_GRANTS[authorityTier] ?? [])];
  for (const profile of jobFunctionProfiles) {
    grants.push(...(PROFILE_GRANTS[profile] ?? []));
  }

  const seen = new Set<string>();
  return grants.filter((grant) => {
    const key = `${grant.domain}:${grant.action}:${grant.scope}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildEffectiveScopes(grants: AuthPermissionGrant[]) {
  return [...new Set(grants.map((grant) => grant.scope))];
}

export function buildPermissionCodesForAuthority(
  authorityTier: AuthorityTier,
  jobFunctionProfiles: JobFunctionProfile[]
) {
  const codes = new Set<string>();
  const grants = buildEffectivePermissionGrants(authorityTier, jobFunctionProfiles);

  for (const grant of grants) {
    codes.add(canonicalCode(grant));
  }

  for (const code of TIER_COMPATIBILITY_PERMISSIONS[authorityTier] ?? []) {
    codes.add(code);
  }
  for (const profile of jobFunctionProfiles) {
    for (const code of PROFILE_COMPATIBILITY_PERMISSIONS[profile] ?? []) {
      codes.add(code);
    }
  }

  return [...codes];
}

export function getAuthorityGrantCatalog() {
  return {
    tiers: TIER_GRANTS,
    profiles: PROFILE_GRANTS
  };
}

export function getAuthorityCompatibilityPermissionCatalog() {
  return {
    tiers: TIER_COMPATIBILITY_PERMISSIONS,
    profiles: PROFILE_COMPATIBILITY_PERMISSIONS
  };
}

export function hasAuthorityTier(auth: Pick<AuthUser, "authorityTier">, tiers: AuthorityTier | AuthorityTier[]) {
  const allowed = Array.isArray(tiers) ? tiers : [tiers];
  return allowed.includes(auth.authorityTier);
}

export function hasJobFunctionProfile(auth: Pick<AuthUser, "jobFunctionProfiles">, profiles: JobFunctionProfile | JobFunctionProfile[]) {
  const allowed = Array.isArray(profiles) ? profiles : [profiles];
  return auth.jobFunctionProfiles.some((profile) => allowed.includes(profile));
}

export function hasPermissionCode(auth: Pick<AuthUser, "permissions">, code: string) {
  return auth.permissions.includes(code);
}

export function hasPermissionGrant(
  auth: Pick<AuthUser, "permissionGrants" | "department" | "id">,
  domain: PermissionDomain,
  action: PermissionAction,
  context: PermissionContext = {}
) {
  const relevant = auth.permissionGrants.filter((grant) => grant.domain === domain && grant.action === action);
  if (!relevant.length) {
    return false;
  }
  return relevant.some((grant) => matchesScope(grant.scope, auth, context));
}

function matchesScope(
  scope: PermissionScope,
  auth: Pick<AuthUser, "department" | "id">,
  context: PermissionContext
) {
  switch (scope) {
    case "organization_wide_scope":
      return true;
    case "department_only":
      return Boolean(context.department) && context.department === auth.department;
    case "own_records_only":
      return Boolean(context.subjectUserId) && context.subjectUserId === auth.id;
    case "own_shift_only":
      return Boolean(context.shiftAssignedUserId) && context.shiftAssignedUserId === auth.id;
    case "own_pto_only":
      return Boolean(context.ptoUserId) && context.ptoUserId === auth.id;
    case "assigned_shoot_only":
      return Boolean(context.isAssignedToShoot) || (Boolean(context.subjectUserId) && context.subjectUserId === auth.id);
    case "shoot_lead_scope_only":
      return Boolean(context.shootLeadUserId) && context.shootLeadUserId === auth.id;
    case "trade_participant_scope_only":
      return (context.tradeParticipantUserIds ?? []).includes(auth.id);
    default:
      return false;
  }
}

export function isFieldPhotographyProfile(auth: Pick<AuthUser, "jobFunctionProfiles" | "roles">) {
  return (
    auth.jobFunctionProfiles.some((profile) =>
      ["associate_photographer", "seasonal_photographer", "part_time_photographer", "senior_photographer"].includes(profile)
    ) ||
    auth.roles.some((role) => ["associate_photographer", "photographer", "senior_photographer"].includes(role))
  );
}

export function isDepartmentScopedScheduler(auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles">) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return false;
  }
  return hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success", "customer_service_rep"]);
}

export function isOwnOnlyScheduleUser(auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "roles">) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return false;
  }
  if (hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success", "customer_service_rep"])) {
    return false;
  }
  return isFieldPhotographyProfile(auth) || hasJobFunctionProfile(auth, "graphic_artist") || auth.roles.includes("office_employee");
}

export function canManagePermissions(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, "super_admin");
}

export function canViewUserDirectory(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership"]);
}

export function canReadAuditLogs(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "read_only_viewer"]);
}

export function canApprovePTO(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function canEditHours(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function canAssignStaffOnLiveShoot(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function canViewLaborCost(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) || hasPermissionCode(auth, "labor_cost.view");
}

// Labor Command Center: full pay-period lifecycle control (transition, lock, export,
// mappings). Payroll/admin scope — intentionally narrower than canReviewTeamTime.
export function canManagePayrollPeriods(auth: Pick<AuthUser, "authorityTier" | "permissions" | "roles">) {
  return (
    canFinalizePayroll(auth) ||
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "attendance.manage")
  );
}

// Labor Command Center: final payroll approval — locking a period, exporting it,
// and sending approved time to QuickBooks. Owner only (Matthew): super_admin tier
// or the legacy owner_admin role. Payroll admins prepare; the owner approves.
export function canFinalizePayroll(auth: Pick<AuthUser, "authorityTier" | "roles">) {
  return hasAuthorityTier(auth, "super_admin") || auth.roles.includes("owner_admin");
}

// Labor Command Center: manager-level review of team time — self-check board,
// overtime warnings, resolving employee discrepancy reports. Includes supervisors
// and anyone who can already approve time exceptions.
export function canReviewTeamTime(auth: Pick<AuthUser, "authorityTier" | "permissions" | "roles">) {
  return (
    canFinalizePayroll(auth) ||
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) ||
    hasPermissionCode(auth, "attendance.manage") ||
    hasPermissionCode(auth, "attendance_exceptions.approve") ||
    hasPermissionCode(auth, "missed_punches.approve")
  );
}

export function canViewAttendanceExceptions(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) || hasPermissionCode(auth, "attendance_exceptions.view");
}

export function canViewComplianceWorkspace(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) ||
    hasPermissionCode(auth, "compliance.read") ||
    hasPermissionCode(auth, "attendance.manage") ||
    hasPermissionCode(auth, "attendance_exceptions.approve") ||
    hasPermissionCode(auth, "missed_punches.approve")
  );
}

// Manager cockpit / owner command: aggregates company-wide payroll and compliance
// review queues, so dashboard.read alone is not enough — the caller needs
// manager-level time review or compliance workspace authority.
export function canViewManagerCockpit(auth: Pick<AuthUser, "authorityTier" | "permissions" | "roles">) {
  return canReviewTeamTime(auth) || canViewComplianceWorkspace(auth);
}

export function canViewCustomerServiceMetrics(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) || hasPermissionCode(auth, "customer_service_metrics.view");
}

export function canViewStrategicShootSignals(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) || hasPermissionCode(auth, "reporting_exports.view");
}

export function canViewLeadershipReports(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor", "read_only_viewer"]) || hasPermissionCode(auth, "reporting_exports.view");
}

export function canExportLeadershipReports(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor", "read_only_viewer"]) || hasPermissionCode(auth, "reporting_exports.export");
}

export function canViewProfitabilityLeadership(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) || hasPermissionCode(auth, "profitability_leadership.view");
}

export function canManageProfitabilityImports(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) || hasPermissionCode(auth, "profitability_imports.create");
}

export function canViewProfitabilityEmployeeSignals(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) || hasPermissionCode(auth, "profitability_employee_signals.view");
}

export function canViewAgreements(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function canManageAgreements(auth: Pick<AuthUser, "authorityTier">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

export function getAllowedSalesPipelineTypes(
  auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">
) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) || hasPermissionCode(auth, "sales_pipeline.view")) {
    if (
      hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
      hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"])
    ) {
      if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
        return ["schools", "sports"] as const;
      }
      if (hasJobFunctionProfile(auth, "schools_client_success") && hasJobFunctionProfile(auth, "sports_client_success")) {
        return ["schools", "sports"] as const;
      }
      if (hasJobFunctionProfile(auth, "schools_client_success")) {
        return ["schools"] as const;
      }
      if (hasJobFunctionProfile(auth, "sports_client_success")) {
        return ["sports"] as const;
      }
    }
  }
  return [] as const;
}

export function canViewSalesPipeline(auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">) {
  return getAllowedSalesPipelineTypes(auth).length > 0 || hasPermissionCode(auth, "sales_pipeline.view");
}

export function canManageSalesPipeline(auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  return hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"]) || hasPermissionCode(auth, "sales_pipeline.edit");
}

export function canManageGearRegistry(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasPermissionCode(auth, "gear_assets.edit") ||
    hasPermissionCode(auth, "gear_kits.edit")
  );
}

export function canViewGearInventory(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) ||
    hasPermissionCode(auth, "gear_assets.view") ||
    hasPermissionCode(auth, "gear_kits.view") ||
    hasPermissionCode(auth, "gear_custody.view")
  );
}

export function canManageGearCustody(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) || hasPermissionCode(auth, "gear_custody.create");
}

export function canOverrideGearCustodyConflict(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) || hasPermissionCode(auth, "gear_custody.override");
}

export function canAccessOutlookCalendarIntegration(auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"])
  );
}

export function canManageCanonicalDirectoryRecords(auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success", "customer_service_rep"])
  );
}

export function canManageSchoolsHub(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (auth.department === "schools" && hasAuthorityTier(auth, "supervisor")) ||
    hasJobFunctionProfile(auth, ["schools_client_success", "director_of_school_photography"]) ||
    hasPermissionCode(auth, "schools_hub.manage")
  );
}

export function canViewSchoolsHub(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles" | "id">
) {
  return getSchoolsHubAccessScope(auth) !== null;
}

export function canManageSportsWorkspace(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (auth.department === "sports" && hasAuthorityTier(auth, "supervisor")) ||
    hasJobFunctionProfile(auth, ["sports_client_success", "director_of_sports_photography"]) ||
    hasPermissionCode(auth, "sports_hub.manage")
  );
}

export function canViewSportsWorkspace(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles" | "id">
) {
  return getSportsWorkspaceAccessScope(auth) !== null;
}

export function getSportsWorkspaceAccessScope(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles" | "id">
): "all" | "own" | null {
  if (canManageSportsWorkspace(auth)) {
    return "all";
  }
  if (hasAuthorityTier(auth, ["read_only_viewer"])) {
    return "all";
  }
  if (
    hasJobFunctionProfile(auth, [
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
  if (hasPermissionCode(auth, "sports_hub.view")) {
    return "all";
  }
  if (isOwnOnlyScheduleUser(auth)) {
    return "own";
  }
  return null;
}

export function canManageSportsFinance(
  auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(auth, ["director_of_sports_photography"]) ||
    hasPermissionCode(auth, "sports_finance.manage")
  );
}

export function canViewSportsFinance(
  auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">
) {
  return (
    canManageSportsFinance(auth) ||
    hasPermissionCode(auth, "sports_finance.view") ||
    canViewProfitabilityLeadership(auth) ||
    canViewLeadershipReports(auth)
  );
}

export function canManageSportsSettings(
  auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(auth, ["director_of_sports_photography"]) ||
    hasPermissionCode(auth, "sports_hub.settings")
  );
}

export function canPublishSportsImports(
  auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(auth, ["director_of_sports_photography"]) ||
    hasPermissionCode(auth, "sports_hub.import_publish")
  );
}

export function canOverrideSportsDuplicates(
  auth: Pick<AuthUser, "authorityTier" | "jobFunctionProfiles" | "permissions">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    hasJobFunctionProfile(auth, ["director_of_sports_photography"]) ||
    hasPermissionCode(auth, "sports_hub.duplicate_override")
  );
}

export function getSchoolsHubAccessScope(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles" | "id">
): "all" | "own" | null {
  if (canManageSchoolsHub(auth)) {
    return "all";
  }
  if (hasAuthorityTier(auth, ["read_only_viewer"])) {
    return "all";
  }
  if (hasJobFunctionProfile(auth, ["sports_client_success", "customer_service_rep"])) {
    return "all";
  }
  if (hasPermissionCode(auth, "schools_hub.view")) {
    return "all";
  }
  if (isOwnOnlyScheduleUser(auth)) {
    return "own";
  }
  return null;
}

export function canManageSchoolFoundation(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles">
) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (auth.department === "schools" && hasAuthorityTier(auth, "supervisor")) ||
    hasJobFunctionProfile(auth, ["schools_client_success", "director_of_school_photography"])
  );
}

export function canCreateOrEditShootDepartment(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles">,
  department: DepartmentCode
) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  if (department === "schools" && hasJobFunctionProfile(auth, "schools_client_success")) {
    return true;
  }
  if (department === "sports" && hasJobFunctionProfile(auth, "sports_client_success")) {
    return true;
  }
  return false;
}

export function canCreateOrEditCalendarDepartment(
  auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles">,
  department: DepartmentCode
) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  if (department === "schools" && hasJobFunctionProfile(auth, "schools_client_success")) {
    return true;
  }
  if (department === "sports" && hasJobFunctionProfile(auth, "sports_client_success")) {
    return true;
  }
  if ((department === "office" || department === "customer_service") && hasJobFunctionProfile(auth, "customer_service_rep")) {
    return true;
  }
  return false;
}
