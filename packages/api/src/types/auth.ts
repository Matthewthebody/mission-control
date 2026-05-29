export type AuthRole =
  | "owner_admin"
  | "admin"
  | "leadership"
  | "senior_photographer"
  | "associate_photographer"
  | "office_employee"
  | "photographer";

export type AuthorityTier =
  | "super_admin"
  | "leadership"
  | "director_admin"
  | "supervisor"
  | "standard_employee"
  | "read_only_viewer";

export type JobFunctionProfile =
  | "associate_photographer"
  | "seasonal_photographer"
  | "part_time_photographer"
  | "senior_photographer"
  | "schools_client_success"
  | "sports_client_success"
  | "customer_service_rep"
  | "graphic_artist"
  | "director_of_photography"
  | "director_of_school_photography"
  | "director_of_sports_photography"
  | "director_of_digital_production"
  | "leadership_team_member"
  | "leadership_viewer";

export type PermissionDomain =
  | "training_documents"
  | "sales_pipeline"
  | "gear_assets"
  | "gear_kits"
  | "gear_custody"
  | "gear_service_records"
  | "shoot_locations"
  | "calendar_events"
  | "sessions_shoots"
  | "staffing_assignments"
  | "schedules_shifts"
  | "clock_in_out"
  | "time_edits"
  | "missed_punches"
  | "early_late_clock_in_approvals"
  | "pto_requests"
  | "pto_approvals"
  | "shift_swaps"
  | "attendance_exceptions"
  | "labor_cost"
  | "profitability_leadership"
  | "profitability_employee_signals"
  | "profitability_imports"
  | "customer_service_metrics"
  | "reporting_exports"
  | "audit_logs"
  | "system_settings_permissions";

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "approve"
  | "override"
  | "delete"
  | "export"
  | "receive_notifications";

export type PermissionScope =
  | "own_records_only"
  | "own_shift_only"
  | "own_pto_only"
  | "assigned_shoot_only"
  | "shoot_lead_scope_only"
  | "department_only"
  | "organization_wide_scope"
  | "trade_participant_scope_only";

export type SharedPolicyScopeType =
  | "global"
  | "department"
  | "organization"
  | "location"
  | "owned"
  | "assigned"
  | "self"
  | "team"
  | "custom";

export type SharedPolicyEffect = "allow" | "deny";

export type SharedVisibilityState = "hidden" | "masked" | "readonly" | "editable";

export type SharedSensitivityCategory =
  | "operational_standard"
  | "operational_sensitive"
  | "contact_private"
  | "financial_restricted"
  | "personnel_restricted"
  | "leadership_restricted"
  | "system_admin_only";

export type SharedMaskingStrategy =
  | "partial_email"
  | "partial_phone"
  | "money_summary_only"
  | "initials_only"
  | "redacted_text"
  | "none";

export type AuthPermissionGrant = {
  domain: PermissionDomain;
  action: PermissionAction;
  scope: PermissionScope;
};

export type SharedPolicyGrant = {
  permissionKey: string;
  scopeType: SharedPolicyScopeType;
  scopeValue: string | null;
  effect: SharedPolicyEffect;
  source: "role" | "override" | "delegation";
  roleKey: string | null;
  delegationId: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type MembershipStatus = "invited" | "pending_approval" | "active" | "suspended" | "revoked";

export type AuthIdentityProvider = "local_password" | "microsoft_entra" | "dev";
export type SessionAssuranceLevel = "standard" | "mfa" | "phishing_resistant";
export type SessionTransport = "bearer" | "cookie" | "socket" | "unknown";

export type AppBaseRole =
  | "Admin"
  | "Leadership"
  | "Manager"
  | "OfficeStaff"
  | "SeniorPhotographer"
  | "AssociatePhotographer";

export type CapabilityOverlay = "Finance" | "CommunicationsModerator" | "UserAccessAdmin" | "SecurityAdmin";

export type DepartmentCode =
  | "executive"
  | "operations"
  | "schools"
  | "sports"
  | "office"
  | "production"
  | "customer_service"
  | "unassigned";

export type InternalRoleGroup =
  | "system_admin"
  | "leadership"
  | "schools"
  | "sports"
  | "account_reps"
  | "senior_photographers"
  | "seasonal_photographers"
  | "graphics_production"
  | "customer_service";

export type CommunicationIdentityStatus = "linked_ready" | "disabled" | "incomplete" | "unlinked";

export type CommunicationIdentity = {
  provider: "microsoft_teams";
  microsoftUserId: string | null;
  microsoftTenantId: string | null;
  communicationEnabled: boolean;
  postingDisabledAt: string | null;
  postingDisabledReason: string | null;
  canPost: boolean;
  teamsChatDefaultTarget: string | null;
  linkedAt: string | null;
  lastVerifiedAt: string | null;
  status: CommunicationIdentityStatus;
};

export type MicrosoftEntraAuthorizationIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

export type MicrosoftEntraAuthorizationState = {
  provider: "microsoft_entra";
  sourceContractVersion: string;
  raw: {
    tenantId: string;
    userId: string;
    email: string;
    scopes: string[];
    appRoleValues: string[];
    groupIds: string[];
    groupClaimsOverage: boolean;
    authContextIds: string[];
    amr: string[];
    acr: string | null;
    sessionAssurance: SessionAssuranceLevel;
    rawClaims: Record<string, unknown>;
  };
  resolved: {
    authorityTier: AuthorityTier | null;
    baseRole: AppBaseRole | null;
    capabilityOverlays: CapabilityOverlay[];
    internalRoleGroups: InternalRoleGroup[];
    policyRoles: string[];
    permissionKeys: string[];
    mappedAppRoles: string[];
    mappedGroupIds: string[];
    financeSensitiveAccess: boolean;
    communicationsModeration: boolean;
    userAccessAdministration: boolean;
    securityAdministration: boolean;
  };
  issues: MicrosoftEntraAuthorizationIssue[];
  signInAllowed: boolean;
};

export interface AuthUser {
  id: string;
  tenantId: string;
  accountId: string | null;
  sessionId: string;
  email: string;
  fullName: string;
  status: MembershipStatus;
  department: DepartmentCode;
  isEmailVerified: boolean;
  authVersion: number;
  authorityTier: AuthorityTier;
  baseRole: AppBaseRole;
  capabilityOverlays: CapabilityOverlay[];
  jobFunctionProfiles: JobFunctionProfile[];
  primaryJobFunctionProfile: JobFunctionProfile;
  permissionGrants: AuthPermissionGrant[];
  policyGrants: SharedPolicyGrant[];
  policyRoles: string[];
  internalRoleGroups?: InternalRoleGroup[];
  communicationIdentity?: CommunicationIdentity;
  microsoftEntraAuthorization?: MicrosoftEntraAuthorizationState | null;
  effectiveScopes: PermissionScope[];
  roles: AuthRole[];
  permissions: string[];
  authorizationFlags: {
    financeSensitiveAccess: boolean;
    communicationsModeration: boolean;
    userAccessAdministration: boolean;
    securityAdministration: boolean;
  };
  sessionTrust: {
    identityProvider: AuthIdentityProvider;
    sessionAssurance: SessionAssuranceLevel;
    requestTransport: SessionTransport;
    authenticatedAt: string | null;
    lastReauthenticatedAt: string | null;
    activeAuthContextIds: string[];
    elevatedUntil: string | null;
    privilegedModeUntil: string | null;
    breakGlassStartedAt: string | null;
    breakGlassUntil: string | null;
    breakGlassReason: string | null;
    breakGlassScopeType: string | null;
    breakGlassScopeId: string | null;
    elevatedSessionActive: boolean;
    privilegedModeActive: boolean;
    breakGlassModeActive: boolean;
  };
}
