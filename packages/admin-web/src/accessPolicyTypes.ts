export type AccessPolicyScopeType =
  | "global"
  | "department"
  | "organization"
  | "location"
  | "owned"
  | "assigned"
  | "self"
  | "team"
  | "custom";

export type AccessPolicyEffect = "allow" | "deny";
export type AccessVisibilityState = "hidden" | "masked" | "readonly" | "editable";
export type AccessMaskingStrategy =
  | "partial_email"
  | "partial_phone"
  | "money_summary_only"
  | "initials_only"
  | "redacted_text"
  | "none";

export type AccessPolicyRoleRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  department_type: string | null;
  is_system_role: boolean;
  is_assignable: boolean;
  created_at: string;
  updated_at: string;
};

export type AccessPolicyPermissionRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  resource_type: string | null;
  action_group: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessPolicyRoleGrantRecord = {
  id: string;
  role_id: string;
  permission_id: string;
  permission_code: string;
  scope_type: AccessPolicyScopeType;
  scope_value: string | null;
  effect: AccessPolicyEffect;
  created_at: string;
  updated_at: string;
};

export type AccessPolicyUserSummary = {
  user_id: string;
  full_name: string;
  email: string;
  department: string;
  membership_status: "invited" | "pending_approval" | "active" | "suspended" | "revoked";
  authority_tier: string | null;
  primary_job_function_profile: string | null;
  active_role_codes: string[];
  microsoft_user_id: string | null;
  microsoft_tenant_id: string | null;
  auth_provider: string | null;
  communication_enabled: boolean;
  communication_posting_disabled_at: string | null;
  communication_posting_disabled_reason: string | null;
  teams_chat_default_target: string | null;
  linked_at: string | null;
  last_verified_at: string | null;
  communication_identity_status: "linked_ready" | "disabled" | "incomplete" | "unlinked";
};

export type AccessPolicyAssignmentRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  role_id: string;
  role_code: string;
  role_name: string;
  scope_type: AccessPolicyScopeType;
  scope_value: string | null;
  starts_at: string | null;
  ends_at: string | null;
  assigned_by_user_id: string | null;
  assigned_by_name: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessPolicyOverrideRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  permission_id: string;
  permission_code: string;
  scope_type: AccessPolicyScopeType;
  scope_value: string | null;
  effect: AccessPolicyEffect;
  starts_at: string | null;
  ends_at: string | null;
  reason: string;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessPolicyDelegationRecord = {
  id: string;
  tenant_id: string;
  from_user_id: string;
  from_user_name: string | null;
  to_user_id: string;
  to_user_name: string | null;
  role_id: string | null;
  role_code: string | null;
  role_name: string | null;
  permission_bundle_key: string | null;
  scope_type: AccessPolicyScopeType;
  scope_value: string | null;
  starts_at: string;
  ends_at: string;
  status: "pending" | "active" | "expired" | "revoked";
  reason: string;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessFieldVisibilityRule = {
  id: string;
  resource_type: string;
  field_key: string;
  sensitivity_category: string;
  required_permission_code: string | null;
  default_visibility: AccessVisibilityState;
  masking_strategy: AccessMaskingStrategy | null;
  department_type: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessSectionVisibilityRule = {
  id: string;
  resource_type: string;
  section_key: string;
  required_permission_code: string | null;
  sensitivity_category: string | null;
  default_visibility: AccessVisibilityState;
  department_type: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessPolicyAuditEvent = {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  policy_event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  permission_code: string | null;
  result: string;
  details_json: Record<string, unknown> | null;
  created_at: string;
};

export type AccessPolicyWorkspace = {
  summary: {
    role_count: number;
    assignment_count: number;
    delegation_count: number;
    override_count: number;
    audit_event_count: number;
  };
  roles: AccessPolicyRoleRecord[];
  permissions: AccessPolicyPermissionRecord[];
  role_grants: AccessPolicyRoleGrantRecord[];
  users: AccessPolicyUserSummary[];
  assignments: AccessPolicyAssignmentRecord[];
  delegations: AccessPolicyDelegationRecord[];
  overrides: AccessPolicyOverrideRecord[];
  field_rules: AccessFieldVisibilityRule[];
  section_rules: AccessSectionVisibilityRule[];
  audit_events: AccessPolicyAuditEvent[];
};

export type AccessPolicyPreview = {
  user_id: string;
  route_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  allowed: boolean;
  permissions: string[];
  fields: Record<string, AccessVisibilityState>;
  sections: Record<string, AccessVisibilityState>;
  actions: Record<string, boolean>;
  explanation: string[];
  trace_id: string;
};

export type AccessPolicyAssignmentInput = {
  user_id: string;
  role_code: string;
  scope_type: AccessPolicyScopeType;
  scope_value?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  reason?: string | null;
};

export type AccessPolicyOverrideInput = {
  user_id: string;
  permission_code: string;
  scope_type: AccessPolicyScopeType;
  scope_value?: string | null;
  effect: AccessPolicyEffect;
  starts_at?: string | null;
  ends_at?: string | null;
  reason: string;
};

export type AccessPolicyDelegationInput = {
  from_user_id: string;
  to_user_id: string;
  role_code?: string | null;
  permission_bundle_key?: string | null;
  scope_type: AccessPolicyScopeType;
  scope_value?: string | null;
  starts_at: string;
  ends_at: string;
  reason: string;
};

export type AccessPolicyRuleUpdateInput = {
  required_permission_code?: string | null;
  default_visibility: AccessVisibilityState;
  masking_strategy?: AccessMaskingStrategy | null;
};

export type AccessSectionRuleUpdateInput = {
  required_permission_code?: string | null;
  default_visibility: AccessVisibilityState;
};

export type AccessPolicyPreviewInput = {
  target_user_id: string;
  route_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  permission_keys?: string[];
  context?: {
    departmentType?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    ownerUserIds?: string[];
    assignedUserIds?: string[];
    targetUserId?: string | null;
    customScopeValues?: string[];
  };
};
