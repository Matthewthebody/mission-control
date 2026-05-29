import type {
  SharedMaskingStrategy,
  SharedPolicyEffect,
  SharedPolicyScopeType,
  SharedSensitivityCategory,
  SharedVisibilityState
} from "./auth.js";

export interface PolicyRoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  department_type: string | null;
  is_system_role: boolean;
  is_assignable: boolean;
  created_at: string;
  updated_at: string;
}

export interface PolicyPermissionRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  resource_type: string | null;
  action_group: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyRolePermissionGrantRecord {
  id: string;
  role_id: string;
  permission_id: string;
  permission_code: string;
  scope_type: SharedPolicyScopeType;
  scope_value: string | null;
  effect: SharedPolicyEffect;
  created_at: string;
  updated_at: string;
}

export interface UserRoleAssignmentRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  role_id: string;
  role_code: string;
  role_name: string;
  scope_type: SharedPolicyScopeType;
  scope_value: string | null;
  starts_at: string | null;
  ends_at: string | null;
  assigned_by_user_id: string | null;
  assigned_by_name: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PermissionOverrideRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  permission_id: string;
  permission_code: string;
  scope_type: SharedPolicyScopeType;
  scope_value: string | null;
  effect: SharedPolicyEffect;
  starts_at: string | null;
  ends_at: string | null;
  reason: string;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DelegationAssignmentRecord {
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
  scope_type: SharedPolicyScopeType;
  scope_value: string | null;
  starts_at: string;
  ends_at: string;
  status: "pending" | "active" | "expired" | "revoked";
  reason: string;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldVisibilityRuleRecord {
  id: string;
  resource_type: string;
  field_key: string;
  sensitivity_category: SharedSensitivityCategory;
  required_permission_code: string | null;
  default_visibility: SharedVisibilityState;
  masking_strategy: SharedMaskingStrategy | null;
  department_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface SectionVisibilityRuleRecord {
  id: string;
  resource_type: string;
  section_key: string;
  required_permission_code: string | null;
  sensitivity_category: SharedSensitivityCategory | null;
  default_visibility: SharedVisibilityState;
  department_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyAuditEventRecord {
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
}

export type SharedFieldVisibilityMap = Record<string, SharedVisibilityState>;
export type SharedSectionVisibilityMap = Record<string, SharedVisibilityState>;

export interface SharedResourcePolicySnapshot {
  permissions: string[];
  fields: SharedFieldVisibilityMap;
  sections: SharedSectionVisibilityMap;
  actions: Record<string, boolean>;
  reasons: Record<string, string>;
}

export interface AccessPolicyPreview {
  user_id: string;
  route_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  allowed: boolean;
  permissions: string[];
  fields: SharedFieldVisibilityMap;
  sections: SharedSectionVisibilityMap;
  actions: Record<string, boolean>;
  explanation: string[];
  trace_id: string;
}

export interface AccessPolicyWorkspace {
  summary: {
    role_count: number;
    assignment_count: number;
    delegation_count: number;
    override_count: number;
    audit_event_count: number;
  };
  roles: PolicyRoleRecord[];
  permissions: PolicyPermissionRecord[];
  role_grants: PolicyRolePermissionGrantRecord[];
  users: Array<{
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
  }>;
  assignments: UserRoleAssignmentRecord[];
  delegations: DelegationAssignmentRecord[];
  overrides: PermissionOverrideRecord[];
  field_rules: FieldVisibilityRuleRecord[];
  section_rules: SectionVisibilityRuleRecord[];
  audit_events: PolicyAuditEventRecord[];
}
