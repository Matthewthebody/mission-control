import type { OperatingSystemAccessProfile } from "./operatingSystem";

export type CommunicationIdentityStatus = "linked_ready" | "disabled" | "incomplete" | "unlinked";

export type CommunicationIdentity = {
  provider: "microsoft_teams";
  microsoftUserId: string | null;
  microsoftTenantId: string | null;
  communicationEnabled: boolean;
  postingDisabledAt?: string | null;
  postingDisabledReason?: string | null;
  canPost?: boolean;
  teamsChatDefaultTarget: string | null;
  linkedAt: string | null;
  lastVerifiedAt: string | null;
  status: CommunicationIdentityStatus;
};

export type SessionUser = {
  id: string;
  tenantId: string;
  accountId: string | null;
  sessionId: string;
  email: string;
  fullName: string;
  status: string;
  department: string;
  isEmailVerified: boolean;
  authVersion: number;
  roles: string[];
  permissions: string[];
  authorityTier: string;
  baseRole?: "Admin" | "Leadership" | "Manager" | "OfficeStaff" | "SeniorPhotographer" | "AssociatePhotographer" | null;
  capabilityOverlays?: Array<"Finance" | "CommunicationsModerator" | "UserAccessAdmin" | "SecurityAdmin">;
  primaryJobFunctionProfile: string;
  jobFunctionProfiles: string[];
  permissionGrants: Array<{
    domain: string;
    action: string;
    scope: string;
  }>;
  policyRoles?: string[];
  internalRoleGroups?: string[];
  communicationIdentity?: CommunicationIdentity;
  microsoftEntraAuthorization?: {
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
      sessionAssurance: "standard" | "mfa" | "phishing_resistant";
      rawClaims: Record<string, unknown>;
    };
    resolved: {
      authorityTier: string | null;
      baseRole?: "Admin" | "Leadership" | "Manager" | "OfficeStaff" | "SeniorPhotographer" | "AssociatePhotographer" | null;
      capabilityOverlays?: Array<"Finance" | "CommunicationsModerator" | "UserAccessAdmin" | "SecurityAdmin">;
      internalRoleGroups: string[];
      policyRoles: string[];
      permissionKeys: string[];
      mappedAppRoles: string[];
      mappedGroupIds: string[];
      financeSensitiveAccess?: boolean;
      communicationsModeration?: boolean;
      userAccessAdministration?: boolean;
      securityAdministration?: boolean;
    };
    issues: Array<{
      code: string;
      severity: "warning" | "error";
      message: string;
    }>;
    signInAllowed: boolean;
  } | null;
  policyGrants?: Array<{
    permissionKey: string;
    scopeType: string;
    scopeValue: string | null;
    effect: "allow" | "deny";
    source: "role" | "override" | "delegation";
    roleKey: string | null;
    delegationId: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  effectiveScopes: string[];
  authorizationFlags?: {
    financeSensitiveAccess: boolean;
    communicationsModeration: boolean;
    userAccessAdministration: boolean;
    securityAdministration: boolean;
  };
  sessionTrust: {
    identityProvider: "local_password" | "microsoft_entra" | "dev";
    sessionAssurance: "standard" | "mfa" | "phishing_resistant";
    requestTransport: "bearer" | "cookie" | "socket" | "unknown";
    authenticatedAt?: string | null;
    lastReauthenticatedAt?: string | null;
    activeAuthContextIds?: string[];
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
};

export type ProductionAssetValidationStatus = "unvalidated" | "validated" | "deprecated";
export type ProductionAssetLicenseStatus = "active" | "inactive" | "expiring" | "expired";
export type ProductionAssetLicenseType = "subscription" | "perpetual" | "floating" | "device" | "seat" | "other";
export type ProductionAssetJobType =
  | "standard_school_production"
  | "sports_production"
  | "specialty_graphics"
  | "banner_specialty_product"
  | "gallery_prep_upload"
  | "qa_final_review"
  | "correction_rework";

export type ProductionAssetPresetVersion = {
  id: string;
  preset_id: string;
  version_label: string;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionAssetPreset = {
  id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  job_types: ProductionAssetJobType[];
  glasses_handling: string | null;
  known_issues: string | null;
  notes: string | null;
  versions: ProductionAssetPresetVersion[];
  created_at: string;
  updated_at: string;
};

export type ProductionBackgroundVariant = {
  id: string;
  pack_id: string;
  name: string;
  active_status: boolean;
  notes: string | null;
  storage_key: string | null;
  file_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionBackgroundPack = {
  id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  job_types: ProductionAssetJobType[];
  notes: string | null;
  variants: ProductionBackgroundVariant[];
  created_at: string;
  updated_at: string;
};

export type ProductionToolLicense = {
  id: string;
  tool_name: string;
  license_type: ProductionAssetLicenseType;
  seat_count: number | null;
  status: ProductionAssetLicenseStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  renewal_date: string | null;
  notes: string | null;
  restrictions: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionAssetWorkspace = {
  generated_at: string;
  presets: ProductionAssetPreset[];
  background_packs: ProductionBackgroundPack[];
  licenses: ProductionToolLicense[];
};

export type SecurityApprovalRequestRecord = {
  id: string;
  request_type: string;
  action_code: string;
  subject_resource_type: string;
  subject_resource_id: string | null;
  status: "pending" | "approved" | "rejected" | "canceled" | "executed";
  required_approver_tier: string;
  requested_by_user_id: string;
  target_user_id: string | null;
  reason: string;
  current_state: Record<string, unknown>;
  requested_state: Record<string, unknown>;
  decision_note: string | null;
  approved_by_user_id: string | null;
  rejected_by_user_id: string | null;
  canceled_by_user_id: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  target_name?: string | null;
  target_email?: string | null;
  approver_name?: string | null;
  rejector_name?: string | null;
};

export type OperationalApprovalRoleGroup =
  | "leadership"
  | "operations_lead"
  | "department_manager"
  | "scheduling_lead"
  | "production_manager";

export type OperationalApprovalRequestType =
  | "staffing_exception_approval"
  | "schedule_change_approval"
  | "role_override_approval"
  | "overtime_labor_exception_approval"
  | "rush_order_approval"
  | "fee_refund_approval"
  | "due_date_extension_approval"
  | "deadline_override_approval"
  | "peer_review_exception_approval"
  | "qc_exception_approval"
  | "release_override_approval"
  | "rework_waiver_approval"
  | "cancellation_approval"
  | "policy_exception_approval";

export type OperationalApprovalRequestSummary = {
  id: string;
  request_type: OperationalApprovalRequestType;
  request_type_label: string;
  status: "pending" | "needs_clarification" | "approved" | "rejected" | "canceled";
  status_label: string;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  requested_action_code: string;
  request_title: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  blocking: boolean;
  requester_department: string | null;
  requested_by_user_id: string;
  requested_by_name: string | null;
  approval_chain: OperationalApprovalRoleGroup[];
  current_approver_user_id: string | null;
  current_approver_name: string | null;
  current_approver_role_group: OperationalApprovalRoleGroup | null;
  current_approver_role_group_label: string | null;
  sla_due_at: string | null;
  overdue: boolean;
  escalated: boolean;
  escalation_level: number;
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  can_decide: boolean;
  can_cancel: boolean;
  can_resubmit: boolean;
  can_delegate: boolean;
};

export type OperationalApprovalStepRecord = {
  id: string;
  step_order: number;
  approver_role_group: OperationalApprovalRoleGroup;
  approver_role_group_label: string;
  approver_department: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  status: "queued" | "pending" | "approved" | "rejected" | "sent_back" | "delegated" | "canceled";
  status_label: string;
  acted_by_user_id: string | null;
  acted_by_name: string | null;
  delegated_from_user_id: string | null;
  delegated_from_name: string | null;
  note: string | null;
  due_at: string | null;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OperationalApprovalEventRecord = {
  id: string;
  approval_step_id: string | null;
  event_type: string;
  event_type_label: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OperationalApprovalCandidateApprover = {
  id: string;
  label: string;
  detail: string | null;
};

export type OperationalApprovalDetail = {
  request: OperationalApprovalRequestSummary;
  steps: OperationalApprovalStepRecord[];
  events: OperationalApprovalEventRecord[];
  candidate_approvers: OperationalApprovalCandidateApprover[];
  current_state: Record<string, unknown>;
  requested_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type OperationalApprovalWorkspace = {
  generated_at: string;
  summary: {
    awaiting_my_decision: number;
    submitted_by_me: number;
    overdue: number;
    escalated: number;
    pending_blocking: number;
    needs_clarification: number;
  };
  awaiting_my_decision: OperationalApprovalRequestSummary[];
  submitted_by_me: OperationalApprovalRequestSummary[];
  overdue: OperationalApprovalRequestSummary[];
  escalated: OperationalApprovalRequestSummary[];
};

export type OperationalApprovalSourceSummary = {
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  open_count: number;
  blocking_open_count: number;
  overdue_count: number;
  escalated_count: number;
  items: OperationalApprovalRequestSummary[];
};

export type OperationalApprovalCreateInput = {
  request_type: OperationalApprovalRequestType;
  source_module: string;
  source_entity_type: "job" | "production_item";
  source_entity_id: string;
  requested_action_code: string;
  request_title: string;
  request_summary?: string | null;
  reason: string;
  severity?: "low" | "normal" | "high" | "critical" | null;
  blocking?: boolean | null;
  current_state?: Record<string, unknown>;
  requested_state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dedupe_key?: string | null;
};

export type BreakGlassEventRecord = {
  id: string;
  scope_type: string | null;
  scope_id: string | null;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  review_status: string;
  actor_name?: string | null;
  reviewer_name?: string | null;
  ended_by_name?: string | null;
};

export type SecurityOverview = {
  session_policy: {
    elevated_minutes: number;
    privileged_mode_minutes: number;
    break_glass_max_minutes: number;
  };
  current_session: {
    identity_provider: string;
    session_assurance: string;
    authenticated_at: string | null;
    last_reauthenticated_at: string | null;
    active_auth_context_ids: string[];
    elevated_session_active: boolean;
    privileged_mode_active: boolean;
    break_glass_mode_active: boolean;
  };
  microsoft_auth_diagnostics: {
    raw_inputs: {
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
      sessionAssurance: "standard" | "mfa" | "phishing_resistant";
      rawClaims: Record<string, unknown>;
    } | null;
    resolved_access: {
      authorityTier: string | null;
      baseRole?: "Admin" | "Leadership" | "Manager" | "OfficeStaff" | "SeniorPhotographer" | "AssociatePhotographer" | null;
      capabilityOverlays?: Array<"Finance" | "CommunicationsModerator" | "UserAccessAdmin" | "SecurityAdmin">;
      internalRoleGroups: string[];
      policyRoles: string[];
      permissionKeys: string[];
      mappedAppRoles: string[];
      mappedGroupIds: string[];
      financeSensitiveAccess?: boolean;
      communicationsModeration?: boolean;
      userAccessAdministration?: boolean;
      securityAdministration?: boolean;
    } | null;
    issues: Array<{
      code: string;
      severity: "warning" | "error";
      message: string;
    }>;
    sign_in_allowed: boolean;
  } | null;
  risky_fallbacks: {
    allow_dev_login: boolean;
    allow_password_login: boolean;
    allow_password_login_break_glass_only: boolean;
    teams_dev_bypass_auth: boolean;
  };
  pending_approval_count: number;
  active_break_glass_count: number;
  pending_break_glass_review_count: number;
  recent_dangerous_actions: Array<{
    id: string;
    action_code: string;
    status: string;
    entity_type: string;
    entity_id: string | null;
    source_module: string;
    reason: string | null;
    created_at: string;
    actor_name?: string | null;
  }>;
};

export type MicrosoftSecurityTruthStatus = "healthy" | "at_risk" | "blocked";

export type MicrosoftSecurityTruthWorkspace = {
  generated_at: string;
  overall_status: MicrosoftSecurityTruthStatus;
  summary: {
    healthy: number;
    at_risk: number;
    blocked: number;
  };
  controls: Array<{
    control_key: string;
    title: string;
    status: MicrosoftSecurityTruthStatus;
    what: string;
    why: string;
    fix: string;
    owner: string;
    retest: string;
    evidence: Array<{
      kind: "screenshot" | "file" | "link" | "note";
      label: string;
      href?: string | null;
      note?: string | null;
    }>;
    checked_at: string | null;
    expires_at: string | null;
    updated_at: string | null;
    blocking: boolean;
    live_issues: Array<{
      area: string;
      severity: "warning" | "error";
      code: string;
      summary: string;
      details?: Record<string, unknown>;
    }>;
  }>;
  re_audit_checklist: Array<{
    control_key: string;
    title: string;
    status: MicrosoftSecurityTruthStatus;
    pass_criteria: string;
    retest_action: string;
    blocking: boolean;
  }>;
};

export type AccessUser = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  department: string;
  last_login_at: string | null;
  latest_invite_id?: string | null;
  latest_invite_expires_at?: string | null;
  authority_tier?: string | null;
  primary_job_function_profile?: string | null;
  job_function_profiles?: string[];
  roles: string[];
  microsoft_user_id?: string | null;
  microsoft_tenant_id?: string | null;
  auth_provider?: string | null;
  linked_at?: string | null;
  account_last_login_at?: string | null;
  communication_enabled?: boolean;
  teams_chat_default_target?: string | null;
  last_verified_at?: string | null;
  communication_identity_status?: CommunicationIdentityStatus;
  internal_role_groups?: string[];
};

export type MicrosoftIdentityReview = {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  email: string;
  full_name: string;
  microsoft_user_id: string;
  microsoft_tenant_id: string;
  auth_provider: string;
  review_status: "pending_review" | "linked" | "rejected";
  reason_code: string;
  matched_user_id: string | null;
  matched_account_id: string | null;
  matched_user_email: string | null;
  matched_user_name: string | null;
  matched_user_status: string | null;
  matched_user_department: string | null;
  matched_user_authority_tier: string | null;
  matched_user_primary_job_function_profile: string | null;
  matched_user_job_function_profiles: string[];
  matched_user_internal_role_groups: string[];
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  linked_at: string | null;
  last_login_at: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AuditLogEntry = {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_email?: string | null;
  actor_name?: string | null;
  target_email?: string | null;
  target_name?: string | null;
};

export type IntegrationSyncOperationRecord = {
  id: string;
  provider: "outlook" | "monday";
  direction: "outbound" | "inbound";
  entity_type: string;
  entity_id: string | null;
  external_object_type: string;
  external_id: string | null;
  operation_type: string;
  source_system: string;
  source_change_key: string | null;
  status: "pending" | "processing" | "succeeded" | "failed" | "conflict";
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  triggered_by_user_id: string | null;
  payload: Record<string, unknown>;
  result_payload: Record<string, unknown>;
  last_error: string | null;
  last_error_at: string | null;
  conflict_summary: string | null;
  conflict_payload: Record<string, unknown>;
  replay_of_operation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationGovernanceProviderKey = "outlook" | "zendesk" | "monday";
export type IntegrationGovernanceHealthState = "healthy" | "warning" | "degraded" | "failing" | "disabled";
export type IntegrationGovernanceSyncMode =
  | "read_only_import"
  | "controlled_one_way_writeback"
  | "controlled_two_way_sync"
  | "manual_reconciliation";
export type IntegrationLinkedRecordSyncState =
  | "never_synced"
  | "sync_pending"
  | "synced"
  | "partially_synced"
  | "conflict_detected"
  | "sync_failed"
  | "disabled"
  | "archived_link";

export type IntegrationGovernanceSummary = {
  provider_count: number;
  connected_count: number;
  warning_count: number;
  failing_count: number;
  unresolved_conflict_count: number;
  pending_sync_count: number;
  linked_record_count: number;
  last_updated_at: string;
  freshness: {
    state: "live" | "recently_updated" | "daily_computed";
    label: string;
  };
};

export type IntegrationGovernanceProviderSummary = {
  provider: IntegrationGovernanceProviderKey;
  display_name: string;
  enabled: boolean;
  connection_status: "connected" | "disconnected" | "attention";
  health_state: IntegrationGovernanceHealthState;
  health_label: string;
  sync_mode: IntegrationGovernanceSyncMode;
  sync_mode_label: string;
  source_of_truth_summary: string;
  owner_contact: string;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  next_scheduled_sync_at: string | null;
  failure_count: number;
  unresolved_conflict_count: number;
  pending_sync_count: number;
  linked_record_count: number;
  mapping_status: string;
  external_label: string;
  owned_domains: string[];
  mirrored_domains: string[];
  overlay_domains: string[];
  writeback_domains: string[];
  replayable_operation_id: string | null;
};

export type IntegrationSourceOfTruthRule = {
  id: string;
  field_group: string;
  owner: string;
  ownership_type: "source_of_truth" | "mirror" | "derived" | "overlay" | "transitional";
  sync_direction: string;
  edit_policy: string;
  summary: string;
};

export type IntegrationConflictReview = {
  operation_id: string;
  provider: IntegrationGovernanceProviderKey;
  title: string;
  summary: string;
  entity_type: string;
  entity_id: string | null;
  status: "failed" | "conflict";
  occurred_at: string;
  source_system: string;
  local_value: string | null;
  external_value: string | null;
  source_policy: string;
  recommended_action: string;
  resolution_paths: string[];
  can_replay: boolean;
};

export type IntegrationLinkedRecordSummary = {
  provider: IntegrationGovernanceProviderKey;
  record_type: string;
  local_record_id: string;
  local_label: string;
  external_record_id: string | null;
  external_url: string | null;
  sync_state: IntegrationLinkedRecordSyncState;
  sync_state_label: string;
  last_sync_at: string | null;
  source_ownership_summary: string;
  conflict_banner: string | null;
  recommended_action: string | null;
};

export type IntegrationGovernanceOperation = {
  id: string;
  provider: IntegrationGovernanceProviderKey;
  direction: "inbound" | "outbound";
  entity_type: string;
  entity_id: string | null;
  operation_type: string;
  external_object_type: string;
  external_id: string | null;
  source_system: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "conflict";
  attempt_count: number;
  created_at: string;
  updated_at: string;
  message: string | null;
};

export type IntegrationGovernancePayload = {
  summary: IntegrationGovernanceSummary;
  providers: IntegrationGovernanceProviderSummary[];
  source_of_truth_rules: IntegrationSourceOfTruthRule[];
  recent_conflicts: IntegrationConflictReview[];
  linked_records: IntegrationLinkedRecordSummary[];
  recent_operations: IntegrationGovernanceOperation[];
};

export type ScheduleRecordIntegrationState = {
  provider: "outlook";
  link_state: "linked" | "not_linked";
  sync_state: "not_linked" | "pending_sync" | "in_sync" | "sync_warning" | "sync_error";
  sync_required: boolean;
  sync_health: "neutral" | "pending" | "healthy" | "warning" | "error";
  last_synced_at: string | null;
  last_sync_direction: "none" | "inbound" | "outbound";
  last_sync_error: string | null;
  manual_review_required: boolean;
  review_reason: string | null;
  changed_fields: string[];
  changed_field_labels: string[];
  external_last_modified_at: string | null;
  external_record_id: string | null;
  external_calendar_id: string | null;
  source_system: string | null;
  source_of_truth: string;
  pending_external_changes: boolean;
  stale_data_warning: boolean;
  recommended_next_action: string | null;
};

export type AlertRecord = {
  id: string;
  shoot_id?: string | null;
  shoot_code?: string | null;
  alert_type: string;
  message: string;
  status: string;
  created_at: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
};

export type ShootLocationCategory = "school" | "sports" | "studio" | "venue" | "other";
export type MondayMigrationState = "not_yet_migrated" | "coexisting" | "partially_migrated" | "mission_control_owned";
export type MondayLocationIntegrationState = {
  provider: "monday";
  link_state: "linked" | "not_linked";
  migration_state: MondayMigrationState;
  last_synced_at: string | null;
  monday_item_id: string | null;
  monday_item_url: string | null;
  externally_controlled_fields: string[];
  source_label: string;
  warnings: string[];
};

export type ShootLocationArea = {
  id: string;
  name: string;
  location_details: string | null;
  commentary: string | null;
  photo_urls: string[];
};

export type ShootLocationPhoto = {
  id: string;
  image_url: string;
  source: "catalog" | "mission_control" | "monday";
  caption: string;
  photo_category?:
    | "arrival_entrance"
    | "parking_load_in"
    | "check_in_flow_area"
    | "room_wide_shot"
    | "final_camera_background_setup"
    | "power_staging_storage"
    | "special_constraint_watch_out"
    | null;
  memory_state?: "submitted" | "reviewed" | "added_to_memory" | null;
  promote_to_location_memory?: boolean;
  reviewed_at?: string | null;
  review_note?: string | null;
  uploaded_at: string | null;
  uploader_name?: string | null;
  monday_asset_id?: string | null;
};

export type ShootLocationEvaluation = {
  id: string;
  source: "mission_control" | "monday" | "mock_monday";
  monday_item_id?: string | null;
  shift_id?: string | null;
  eval_status?: "draft" | "submitted" | "reviewed" | "closed" | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: string;
  on_time: string;
  easy_access: string;
  overall_rating: number;
  photos_uploaded: string;
  overall_outcome?: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
  staffing_fit?: "understaffed" | "right_sized" | "overstaffed" | null;
  setup_difficulty?: "low" | "medium" | "high" | null;
  customer_school_readiness?: "ready" | "minor_friction" | "major_friction" | null;
  data_roster_readiness?: "ready" | "minor_friction" | "major_friction" | null;
  equipment_workflow_issue?: "none" | "minor" | "major" | null;
  started_on_time?: boolean | null;
  short_summary_note?: string | null;
  next_time_recommendation?: string | null;
  follow_up_required?: boolean;
  major_issue_flag?: boolean;
  location_memory_update_suggested?: boolean;
  leadership_review_needed?: boolean;
  issue_category?:
    | "staffing"
    | "attendance_no_show"
    | "setup_room_problem"
    | "parking_load_in"
    | "school_readiness"
    | "data_roster"
    | "equipment_technical"
    | "lighting_environment"
    | "line_flow_traffic"
    | "student_parent_flow"
    | "communication_contact_issue"
    | "special_product_deliverable_issue"
    | "other"
    | null;
  top_watch_out?: string | null;
  location_memory_promotion_text?: string | null;
  recommended_staffing_next_time?: number | null;
  recommended_arrival_buffer_minutes?: number | null;
  recommended_room_setup_change?: string | null;
  special_gear_needed_next_time?: string | null;
  customer_follow_up_needed?: boolean;
  reviewed_at?: string | null;
  closed_at?: string | null;
  late_details?: string | null;
  access_details?: string | null;
  notes?: string | null;
  outreach_notes?: string | null;
  recommendations?: string | null;
  image_quality?: string | null;
  submitted_by_name?: string | null;
  created_at: string;
};

export type LocationHistoricalContext = {
  quick_context: {
    first_time_location: boolean;
    total_prior_visits: number;
    last_visit_date: string | null;
    last_confirmed_memory_date: string | null;
    top_watch_outs: string[];
    recommended_arrival_buffer_minutes: number | null;
    recommended_staffing_note: string | null;
    freshness_state: "fresh" | "aging" | "needs_refresh";
    memory_status: "active" | "needs_refresh" | "archived";
    open_issue_count: number;
    trust_source: "reviewed_memory" | "repeated_pattern" | "recent_eval" | "no_history";
  };
  last_time_here: {
    shoot_date: string | null;
    shoot_type: string | null;
    overall_outcome: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
    staffing_fit: "understaffed" | "right_sized" | "overstaffed" | null;
    setup_difficulty: "low" | "medium" | "high" | null;
    major_issue: boolean;
    next_time_recommendation: string | null;
    setup_photos_exist: boolean;
  } | null;
  repeat_pattern_signals: Array<{
    key: string;
    label: string;
    detail: string;
    evidence_count: number;
    severity: "info" | "warning" | "high";
    source: "repeated_structured_pattern";
  }>;
  open_follow_ups: Array<{
    id: string;
    type: "eval_follow_up" | "memory_review" | "photo_review";
    title: string;
    detail: string;
    related_shoot_name: string | null;
    related_shoot_date: string | null;
    created_at: string | null;
    source_label: string;
  }>;
  setup_visuals: {
    photos: ShootLocationPhoto[];
    top_setup_instruction: string | null;
    top_load_in_instruction: string | null;
  };
  recent_comparable_shoots: Array<{
    id: string;
    shoot_name: string;
    shoot_date: string;
    shoot_type: string;
    overall_outcome: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
    staffing_fit: "understaffed" | "right_sized" | "overstaffed" | null;
    setup_difficulty: "low" | "medium" | "high" | null;
    issue_category:
      | "staffing"
      | "attendance_no_show"
      | "setup_room_problem"
      | "parking_load_in"
      | "school_readiness"
      | "data_roster"
      | "equipment_technical"
      | "lighting_environment"
      | "line_flow_traffic"
      | "student_parent_flow"
      | "communication_contact_issue"
      | "special_product_deliverable_issue"
      | "other"
      | null;
    next_time_recommendation: string | null;
    major_issue: boolean;
  }>;
};

export type ShootLocationStats = {
  avg_rating: number | null;
  on_time_percent: number;
  easy_access_percent: number;
  evaluation_count: number;
  setup_photo_count: number;
};

export type ShootLocationSummary = {
  id: string;
  name: string;
  address: string | null;
  location_details: string | null;
  commentary: string | null;
  custodian_contact: string | null;
  category: ShootLocationCategory;
  navigation_url: string | null;
  latitude: number | null;
  longitude: number | null;
  estimated_drive_minutes: number | null;
  stats: ShootLocationStats;
  photo_count: number;
  area_count: number;
  latest_recommendation: string | null;
  distance_miles?: number | null;
  integration: MondayLocationIntegrationState | null;
};

export type ShootLocationDetail = ShootLocationSummary & {
  photo_gallery: ShootLocationPhoto[];
  areas: ShootLocationArea[];
  evaluations: ShootLocationEvaluation[];
  resource_library: ResourceLibraryView;
  location_memory: {
    status: "active" | "needs_refresh" | "archived";
    last_confirmed_at: string | null;
    last_updated_by: string | null;
    where_to_go: string | null;
    where_to_park: string | null;
    where_to_set_up: string | null;
    top_watch_out: string | null;
    notes: Array<{
      id: string;
      body: string;
      pinned: boolean;
      publication_state: "active" | "proposed";
      created_at: string;
      updated_at: string;
      author_name: string | null;
      can_publish_location_memory: boolean;
    }>;
    setup_photos: ShootLocationPhoto[];
  };
  historical_context?: LocationHistoricalContext | null;
};

export type LocationMatchCandidate = {
  location_id: string;
  name: string;
  address: string | null;
  confidence: number;
  reason: string;
};

export type LocationComplianceAlert = {
  id: string;
  alert_type: string;
  message: string;
  status: string;
  created_at: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
};

export type ShootLocationIntelligence = {
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  shoot_code?: string | null;
  matched_location_id: string | null;
  match_source: "manual" | "shoot" | "event_location" | "fuzzy" | "none";
  confidence: number;
  location: ShootLocationSummary | null;
  recent_evaluations: ShootLocationEvaluation[];
  recent_photos: ShootLocationPhoto[];
  suggestions: LocationMatchCandidate[];
  missing_setup_photo_alert: LocationComplianceAlert | null;
  historical_context?: LocationHistoricalContext | null;
};

export type LocationPhotographerPerformanceRow = {
  photographer_name: string;
  evaluation_count: number;
  avg_rating: number | null;
  on_time_percent: number;
  easy_access_percent: number;
  latest_location_name: string | null;
  latest_shoot_date: string | null;
};

export type LocationTopRatedRow = {
  location_id: string;
  location_name: string;
  address: string | null;
  avg_rating: number | null;
  evaluation_count: number;
  easy_access_percent: number;
  on_time_percent: number;
};

export type LocationCatalogResponse = {
  locations: ShootLocationSummary[];
  cache: {
    fetchedAt: string;
    stale: boolean;
    source: "live" | "stale_cache";
  };
};

export type OrganizationAccountType =
  | "schools_underclass_portraits"
  | "schools_events"
  | "sports"
  | "events"
  | "studio"
  | "headshots"
  | "commercial"
  | "internal";

export type DirectoryActiveStatus = "active" | "inactive";
export type DirectoryContactStatus = "active" | "needs_review" | "inactive" | "archived";
export type DirectoryContactRelationshipRole =
  | "general"
  | "planning"
  | "billing"
  | "decision_maker"
  | "day_of"
  | "operations"
  | "other";
export type DirectoryContactRoleCategory =
  | "district_leadership"
  | "school_leadership"
  | "school_administration"
  | "yearbook_publications"
  | "athletics_activities"
  | "day_of_logistics"
  | "data_roster"
  | "finance_billing"
  | "technology_systems"
  | "front_office_secretary"
  | "facilities_building_access"
  | "vendor_external_partner"
  | "other";
export type DirectoryDecisionInfluence =
  | "decision_maker"
  | "approver"
  | "recommender"
  | "gatekeeper"
  | "day_to_day_operator"
  | "logistics_owner"
  | "billing_owner"
  | "informational_only";
export type DirectoryOperationalImportance = "critical" | "high" | "normal" | "low";
export type DirectoryRelationshipStrength =
  | "introduced"
  | "working_relationship"
  | "strong_relationship"
  | "trusted_relationship"
  | "unknown";
export type DirectoryRelationshipOwnershipState = "owned" | "shared" | "unassigned" | "needs_reassignment";
export type DirectoryFreshnessState = "fresh" | "aging" | "needs_review";
export type DirectoryTouchpointChannel =
  | "call"
  | "email"
  | "text"
  | "meeting"
  | "onsite"
  | "note"
  | "picture_day_conversation"
  | "internal_debrief"
  | "portal_message"
  | "other";
export type DirectoryTouchpointCategory =
  | "planning"
  | "pre_shoot_confirmation"
  | "day_of_readiness"
  | "post_shoot_follow_up"
  | "yearbook_deliverables"
  | "customer_issue_resolution"
  | "relationship_maintenance"
  | "renewal_contract"
  | "billing_finance"
  | "operational_change"
  | "thank_you_appreciation"
  | "executive_leadership_checkin";
export type DirectoryTouchpointPlanStatus = "planned" | "due_soon" | "completed" | "skipped" | "cancelled" | "overdue";
export type DirectoryCommunicationOutcome =
  | "informational_only"
  | "confirmed"
  | "waiting_on_customer"
  | "waiting_on_internal_team"
  | "follow_up_needed"
  | "resolved"
  | "escalated"
  | "relationship_building"
  | "problem_identified";
export type DirectoryRelationshipMemoryType =
  | "communication_preference"
  | "operational_expectation"
  | "cadence_timing_preference"
  | "escalation_preference"
  | "day_of_coordination_preference"
  | "yearbook_deliverable_preference"
  | "relationship_sensitivity"
  | "appreciation_hospitality_note"
  | "other";
export type DirectoryRelationshipMemoryStatus = "active" | "needs_review" | "archived";
export type DirectoryRelationshipMemoryVisibility = "assignment_relevant" | "manager_plus" | "leadership_only";
export type DirectoryRelationshipFollowUpStatus = "open" | "in_progress" | "completed" | "cancelled" | "overdue";
export type DirectoryRelationshipHealthState = "healthy" | "needs_attention" | "fragile" | "at_risk" | "unknown";
export type SchoolRelationshipHealthState = "healthy" | "needs_attention" | "fragile" | "at_risk" | "unknown";
export type SchoolContactCategory =
  | "principal"
  | "secretary"
  | "district_contact"
  | "photo_day_contact"
  | "yearbook_contact"
  | "billing_contact"
  | "athletics_contact"
  | "graduation_contact"
  | "other";
export type SchoolRuleType =
  | "additional_language_needs"
  | "qr_organization_rules"
  | "hat_policy"
  | "additional_shoot_rules"
  | "punch_id_rules"
  | "sticker_counts"
  | "subject_directory_requirements"
  | "subject_directory_counts"
  | "yearbook_participation"
  | "delivery_preferences"
  | "mailing_preferences"
  | "special_handling";
export type SchoolActivityType =
  | "profile_created"
  | "profile_updated"
  | "contact_categories_updated"
  | "rule_created"
  | "rule_updated"
  | "note_added"
  | "automation_generated"
  | "automation_escalated"
  | "automation_trigger_received";
export type DirectoryDuplicateReviewStatus = "open" | "resolved" | "dismissed";
export type DirectoryDuplicateReviewDecision = "pending" | "keep_separate" | "merge_candidate" | "merged_later";
export type DirectoryImportSessionStatus = "staged" | "applied" | "partially_applied" | "cancelled";
export type DirectoryImportRowStatus = "staged" | "ready" | "needs_review" | "applied" | "skipped" | "error";
export type DirectoryImportRowAction = "create_contact" | "link_existing" | "skip" | "needs_review";
export type DirectoryImportMatchConfidence = "exact" | "strong" | "possible";
export type DirectoryImportColumnKey =
  | "first_name"
  | "last_name"
  | "preferred_name"
  | "title"
  | "email"
  | "phone"
  | "organization_name"
  | "organization_type"
  | "relationship_role"
  | "notes"
  | "start_date"
  | "end_date"
  | "current_flag";

export type OrganizationSummary = {
  id: string;
  canonical_name: string;
  logo_url: string | null;
  display_name: string;
  account_type: OrganizationAccountType;
  active_status: DirectoryActiveStatus;
  aliases: string[];
  notes: string | null;
  contact_count: number;
  location_count: number;
  created_at: string;
  updated_at: string;
};

export type OrganizationContactRelationshipHistoryRecord = {
  id: string;
  organization_id: string;
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  is_current: boolean;
  relationship_state: "current" | "previous";
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationContact = {
  id: string;
  organization_id: string;
  canonical_organization_id?: string;
  first_name: string;
  last_name: string;
  full_name: string;
  preferred_name?: string | null;
  title: string | null;
  department_program?: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  active_status: DirectoryActiveStatus;
  contact_status?: DirectoryContactStatus;
  role_category?: DirectoryContactRoleCategory;
  operational_importance?: DirectoryOperationalImportance;
  decision_influence?: DirectoryDecisionInfluence;
  relationship_strength?: DirectoryRelationshipStrength;
  primary_internal_owner?: DirectoryInternalOwner;
  backup_internal_owner?: DirectoryInternalOwner;
  ownership_state?: DirectoryRelationshipOwnershipState;
  freshness_state?: DirectoryFreshnessState;
  last_confirmed_at?: string | null;
  last_meaningful_interaction_at?: string | null;
  primary_location_id?: string | null;
  primary_location_name?: string | null;
  linked_location_names?: string[];
  strongest_internal_relationship?: DirectoryInternalOwner | null;
  last_spoke_with?: DirectoryInternalOwner | null;
  additional_internal_connected_staff?: DirectoryInternalOwner[];
  handoff_ready?: boolean;
  uncertainty_flag?: boolean;
  maintenance_signals?: DirectoryRelationshipMaintenanceSignal[];
  last_updated_by_name?: string | null;
  relationship_role?: DirectoryContactRelationshipRole | null;
  is_primary?: boolean;
  school_contact_categories?: SchoolContactCategory[];
  relationship_history?: OrganizationContactRelationshipHistoryRecord[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolProfile = {
  organization_id: string;
  district_name: string | null;
  school_type: string | null;
  school_year_label: string | null;
  relationship_health_state: SchoolRelationshipHealthState;
  relationship_summary: string | null;
  primary_internal_owner?: DirectoryInternalOwner | null;
  backup_internal_owner?: DirectoryInternalOwner | null;
  primary_location_id: string | null;
  primary_location_name: string | null;
  primary_location_address: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolRule = {
  id: string;
  organization_id: string;
  rule_type: SchoolRuleType;
  active_status: DirectoryActiveStatus;
  title: string;
  summary: string | null;
  structured_value: Record<string, unknown>;
  sort_order: number;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolActivityLog = {
  id: string;
  organization_id: string;
  activity_type: SchoolActivityType;
  summary: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  related_contact_id: string | null;
  related_contact_name: string | null;
  related_rule_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
};

export type DirectoryContactSummary = OrganizationContact & {
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
  organization_logo_url?: string | null;
};

export type OrganizationLocation = {
  id: string;
  organization_id: string | null;
  location_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address_display: string | null;
  maps_label: string | null;
  maps_url: string | null;
  active_status: DirectoryActiveStatus;
  contact_links?: LocationContactLinkRecord[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryLocationSummary = OrganizationLocation & {
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
};

export type OrganizationRecentShoot = {
  id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  location_name: string | null;
};

export type OrganizationUpcomingShoot = OrganizationRecentShoot & {
  showtime: string | null;
  start_time: string | null;
};

export type OrganizationSalesOpportunityPreview = {
  id: string;
  pipeline_type: "schools" | "sports";
  opportunity_type: "new" | "renewal" | "expansion";
  stage:
    | "lead"
    | "contacted"
    | "meeting_scheduled"
    | "proposal_sent"
    | "follow_up"
    | "negotiation"
    | "contract_sent"
    | "won"
    | "lost"
    | "dormant";
  status: "active" | "dormant" | "won" | "lost";
  owner_id: string;
  owner_name: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  estimated_value: number | null;
  next_action_date: string | null;
  last_touch_date: string;
  follow_up_date: string | null;
  attention_state: "standard" | "warning" | "critical";
  open_alert_count: number;
  notes: string | null;
};

export type OrganizationAccountIssue = {
  issue_type: "agreement_warning" | "crm_alert" | "shoot_risk";
  severity: "warning" | "major" | "critical";
  title: string;
  summary: string;
  linked_entity_id: string | null;
};

export type LocationContactLinkRecord = {
  contact_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  canonical_organization_id: string;
};

export type DirectoryTouchpointRecord = {
  id: string;
  organization_id: string | null;
  location_id: string | null;
  shoot_id: string | null;
  contact_id: string | null;
  channel: DirectoryTouchpointChannel;
  category?: DirectoryTouchpointCategory | null;
  subject?: string | null;
  summary: string;
  outcome: string | null;
  outcome_state?: DirectoryCommunicationOutcome | null;
  owner_user_id: string | null;
  owner_name: string | null;
  occurred_at: string;
  follow_up_date: string | null;
  follow_up_needed?: boolean;
  follow_up_owner?: DirectoryInternalOwner | null;
  relationship_memory_suggested?: boolean;
  attachment_reference?: string | null;
  touchpoint_plan_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryTouchpointPlanTemplate = {
  id: string;
  template_key: string;
  template_name: string;
  category: DirectoryTouchpointCategory;
  scope_hint: "organization" | "location" | "contact";
  summary: string;
  default_offset_days: number | null;
  default_due_time: string | null;
  active_status: boolean;
};

export type DirectoryTouchpointPlan = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
  template_id: string | null;
  category: DirectoryTouchpointCategory;
  title: string;
  summary: string | null;
  status: DirectoryTouchpointPlanStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  backup_owner?: DirectoryInternalOwner | null;
  due_at: string;
  completed_at: string | null;
  skipped_reason: string | null;
  cancelled_reason: string | null;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryRelationshipMemoryRecord = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  source_touchpoint_id: string | null;
  memory_type: DirectoryRelationshipMemoryType;
  summary: string;
  why_it_matters: string;
  source_label: string | null;
  visibility: DirectoryRelationshipMemoryVisibility;
  status: DirectoryRelationshipMemoryStatus;
  created_by?: DirectoryInternalOwner | null;
  reviewed_by?: DirectoryInternalOwner | null;
  reviewed_at: string | null;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryRelationshipFollowUpRecord = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
  source_touchpoint_id: string | null;
  source_touchpoint_plan_id: string | null;
  title: string;
  summary: string | null;
  owner?: DirectoryInternalOwner | null;
  backup_owner?: DirectoryInternalOwner | null;
  due_at: string;
  status: DirectoryRelationshipFollowUpStatus;
  completed_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryRelationshipContinuitySummary = {
  relationship_health_state: DirectoryRelationshipHealthState;
  relationship_health_summary: string;
  last_communication_at: string | null;
  last_communication_label: string;
  next_touchpoint_due_at: string | null;
  next_touchpoint_label: string;
  open_follow_up_count: number;
  overdue_follow_up_count: number;
  due_soon_touchpoint_count: number;
  overdue_touchpoint_count: number;
  active_memory_count: number;
  needs_review_memory_count: number;
  stale_key_contact_count: number;
};

export type DirectoryRelationshipContinuityBundle = {
  scope: "organization" | "contact";
  organization_id: string;
  contact_id: string | null;
  generated_at: string;
  summary: DirectoryRelationshipContinuitySummary;
  touchpoint_templates: DirectoryTouchpointPlanTemplate[];
  touchpoint_plans: DirectoryTouchpointPlan[];
  communication_logs: DirectoryTouchpointRecord[];
  relationship_memory: DirectoryRelationshipMemoryRecord[];
  follow_ups: DirectoryRelationshipFollowUpRecord[];
};

export type DirectoryDuplicateReviewRecord = {
  id: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  suspected_duplicate_contact_id: string | null;
  suspected_duplicate_contact_name: string | null;
  status: DirectoryDuplicateReviewStatus;
  decision: DirectoryDuplicateReviewDecision;
  summary: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationOperationsTone = "good" | "info" | "warning" | "critical";

export type OrganizationOperationsHealthCue = {
  code: string;
  label: string;
  detail: string;
  tone: OrganizationOperationsTone;
};

export type OrganizationOperationsQueueItem = {
  id: string;
  kind: "contact_cleanup" | "follow_up" | "duplicate_review" | "project";
  title: string;
  summary: string;
  tone: OrganizationOperationsTone;
  next_action: string;
  action_hash: string;
  owner_label: string;
  due_label: string | null;
  related_contact_id: string | null;
  related_location_id: string | null;
  related_shoot_id: string | null;
};

export type OrganizationOperationsQueue = {
  count: number;
  items: OrganizationOperationsQueueItem[];
};

export type OrganizationOperationsTimelineItem = {
  id: string;
  kind:
    | "touchpoint"
    | "follow_up"
    | "upcoming_shoot"
    | "recent_shoot"
    | "duplicate_review"
    | "project"
    | "account_issue"
    | "sales_follow_up";
  title: string;
  summary: string;
  tone: OrganizationOperationsTone;
  occurred_at: string;
  owner_label: string;
  related_contact_id: string | null;
  related_location_id: string | null;
  related_shoot_id: string | null;
  due_label: string | null;
  action_hash?: string | null;
};

export type OrganizationOperationsHub = {
  organization_id: string;
  generated_at: string;
  summary: {
    last_touch_at: string | null;
    last_touch_label: string;
    next_action: string;
    owner_label: string;
    follow_up_date: string | null;
    follow_up_label: string;
    relationship_health_state: "healthy" | "watch" | "at_risk";
    relationship_health_summary: string;
  };
  health_cues: OrganizationOperationsHealthCue[];
  queues: {
    contact_cleanup: OrganizationOperationsQueue;
    follow_up: OrganizationOperationsQueue;
    duplicate_review: OrganizationOperationsQueue;
    projects: OrganizationOperationsQueue;
  };
  timeline: OrganizationOperationsTimelineItem[];
};

export type ShootDirectoryContactLinkRecord = {
  contact_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  contact_role: "primary" | "additional";
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  sort_order: number;
};

export type AgreementType = "schools" | "sports" | "events" | "studio_client" | "nda" | "image_release";

export type AgreementStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_signed"
  | "signed"
  | "countersigned"
  | "active"
  | "expiring_soon"
  | "expired"
  | "replaced"
  | "cancelled";

export type AgreementFileType = "pdf" | "image" | "document" | "other";

export type AgreementLinkedEntityType = "organization" | "client_account" | "organization_contact" | "shoot_location";

export type AgreementActivityType =
  | "created"
  | "metadata_updated"
  | "status_changed"
  | "file_uploaded"
  | "file_marked_current"
  | "legacy_file_registered"
  | "prior_agreement_linked"
  | "replacement_linked"
  | "note_added"
  | "template_created"
  | "template_updated"
  | "draft_created_from_template"
  | "signer_added"
  | "signer_updated"
  | "reminder_sent"
  | "renewal_draft_created"
  | "version_created"
  | "version_superseded"
  | "sent_via_provider"
  | "provider_sync_updated"
  | "provider_send_failed"
  | "provider_sync_failed"
  | "provider_viewed"
  | "provider_signed"
  | "provider_countersigned"
  | "provider_voided"
  | "provider_cancelled"
  | "provider_reminder_sent"
  | "final_signed_file_registered";

export type AgreementLifecycleBucket = "active" | "pending_signature" | "expiring_soon" | "expired" | "replaced_archived";
export type AgreementSignerType = "external" | "internal" | "countersigner";
export type AgreementSignerStatus = "pending" | "viewed" | "signed" | "replaced" | "cancelled";
export type AgreementExternalProviderName = "provider_stub" | "dropbox_sign";
export type AgreementProviderEventDirection = "outbound" | "inbound";
export type AgreementProviderEventType =
  | "send_requested"
  | "sent"
  | "reminder_requested"
  | "reminder_sent"
  | "sync_requested"
  | "sync_updated"
  | "viewed"
  | "signed"
  | "countersigned"
  | "completed_package_registered"
  | "voided"
  | "cancelled"
  | "send_failed"
  | "sync_failed";
export type AgreementProviderLifecycleBucket =
  | "not_sent"
  | "queued_to_send"
  | "sent_unsigned"
  | "viewed_not_signed"
  | "partially_signed"
  | "countersign_pending"
  | "completed"
  | "issue";
export type AgreementProviderSyncHealth = "clear" | "warning" | "error";
export type AgreementVersionStage = "draft" | "revised" | "signed" | "countersigned_final" | "legacy_import";
export type AgreementReminderType =
  | "unsigned_3_day"
  | "unsigned_7_day"
  | "unsigned_30_day"
  | "expiration_6_month"
  | "expiration_90_day"
  | "expiration_30_day"
  | "manual_follow_up";
export type AgreementReminderChannel = "email" | "internal_notice";
export type AgreementReminderStatus = "queued" | "sent" | "skipped" | "cancelled";
export type AgreementWarningCode =
  | "no_active_agreement"
  | "pending_unsigned_agreement"
  | "expiring_agreement"
  | "expired_agreement"
  | "renewal_needed"
  | "upcoming_shoot_risk";
export type AgreementWarningSeverity = "clear" | "warning" | "major";

export type AgreementAccess = {
  can_view: boolean;
  can_manage: boolean;
};

export type AgreementFileRecord = {
  id: string;
  agreement_id: string;
  agreement_version_id: string | null;
  file_type: AgreementFileType;
  file_name: string;
  storage_reference: string;
  file_url: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  version_label: string | null;
  is_current: boolean;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

export type AgreementLinkRecord = {
  id: string;
  agreement_id: string;
  linked_entity_type: AgreementLinkedEntityType;
  linked_entity_id: string;
  relationship_type: string;
  label: string | null;
  secondary_label: string | null;
  created_at: string;
};

export type AgreementActivityRecord = {
  id: string;
  agreement_id: string;
  activity_type: AgreementActivityType;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  timestamp: string;
  note: string | null;
  metadata: Record<string, unknown>;
};

export type AgreementTemplateRecord = {
  id: string;
  template_name: string;
  agreement_type: AgreementType;
  active_status: boolean;
  template_body: string | null;
  template_file_reference: string | null;
  merge_fields: string[];
  created_by_user_id: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type AgreementSignerRecord = {
  id: string;
  agreement_id: string;
  contact_id: string | null;
  signer_name: string;
  signer_email: string | null;
  signer_role: string | null;
  signer_order: number | null;
  signer_type: AgreementSignerType;
  status: AgreementSignerStatus;
  external_recipient_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgreementProviderEventRecord = {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  provider_name: string;
  external_envelope_id: string | null;
  external_recipient_id: string | null;
  direction: AgreementProviderEventDirection;
  event_type: AgreementProviderEventType;
  provider_status: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
};

export type AgreementVersionRecord = {
  id: string;
  agreement_id: string;
  version_number: number;
  version_label: string;
  version_stage: AgreementVersionStage;
  prior_version_id: string | null;
  source_template_id: string | null;
  source_template_name: string | null;
  rendered_body: string | null;
  merge_snapshot: Record<string, unknown>;
  is_current: boolean;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  files: AgreementFileRecord[];
};

export type AgreementReminderRecord = {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  reminder_type: AgreementReminderType;
  reminder_channel: AgreementReminderChannel;
  status: AgreementReminderStatus;
  follow_up_state: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  due_at: string | null;
  sent_at: string | null;
  triggered_by_user_id: string | null;
  triggered_by_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgreementAccountWarningRecord = {
  code: AgreementWarningCode;
  severity: AgreementWarningSeverity;
  summary: string;
};

export type AgreementUpcomingShootRisk = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  severity: AgreementWarningSeverity;
  summary: string;
  organization_id: string | null;
  organization_display_name: string | null;
  agreement_status: AgreementStatus | null;
};

export type AgreementRecord = {
  id: string;
  agreement_title: string;
  agreement_type: AgreementType;
  status: AgreementStatus;
  lifecycle_bucket: AgreementLifecycleBucket;
  organization_id: string | null;
  organization_display_name: string | null;
  client_account_id: string | null;
  client_account_display_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  source_template_id: string | null;
  source_template_name: string | null;
  description: string | null;
  contract_value: number | null;
  revenue_share_terms: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_date: string | null;
  notice_deadline: string | null;
  auto_renew: boolean | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  countersigned_at: string | null;
  internal_countersigner_user_id: string | null;
  internal_countersigner_name: string | null;
  created_by_user_id: string;
  created_by_name: string | null;
  updated_by_user_id: string;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  replaced_by_agreement_id: string | null;
  replaced_by_agreement_title: string | null;
  prior_agreement_id: string | null;
  prior_agreement_title: string | null;
  signers: AgreementSignerRecord[];
  versions: AgreementVersionRecord[];
  files: AgreementFileRecord[];
  links: AgreementLinkRecord[];
  reminders: AgreementReminderRecord[];
  due_reminders: AgreementReminderType[];
  warning_codes: AgreementWarningCode[];
  warning_severity: AgreementWarningSeverity;
  warning_summary: string | null;
  external_provider_name: AgreementExternalProviderName | null;
  external_envelope_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  provider_error_state: string | null;
  provider_metadata: Record<string, unknown>;
  provider_lifecycle_bucket: AgreementProviderLifecycleBucket;
  provider_sync_health: AgreementProviderSyncHealth;
  provider_events: AgreementProviderEventRecord[];
  activity_log: AgreementActivityRecord[];
};

export type OrganizationAgreementSummary = {
  total: number;
  active: number;
  pending_signature: number;
  expiring_soon: number;
  expired: number;
  replaced_archived: number;
  renewals_needed: number;
  accounts_missing_active: number;
  upcoming_shoot_risk_count: number;
  has_active_agreement: boolean;
  has_pending_signature: boolean;
  has_expiring_soon: boolean;
  has_expired: boolean;
  needs_attention: boolean;
  warning_severity: AgreementWarningSeverity;
  warnings: AgreementAccountWarningRecord[];
};

export type SalesEmailTemplateKey =
  | "proposal_email"
  | "contract_follow_up"
  | "renewal_outreach"
  | "onboarding_message"
  | "post_shoot_follow_up";

export type SalesEmailTriggerType = "manual" | "automated";
export type SalesEmailCommunicationStatus = "queued" | "sent" | "skipped" | "failed";
export type SalesEmailEventType = "queued" | "sent" | "skipped" | "failed";

export type SalesEmailTemplateRecord = {
  id: string;
  template_key: SalesEmailTemplateKey;
  template_name: string;
  subject_template: string;
  body_template: string;
  merge_fields: string[];
  active_status: boolean;
  automation_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SalesEmailCommunicationEventRecord = {
  id: string;
  communication_id: string;
  event_type: SalesEmailEventType;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
  created_at: string;
};

export type SalesEmailCommunicationRecord = {
  id: string;
  template_id: string | null;
  template_key: SalesEmailTemplateKey | null;
  template_name: string | null;
  opportunity_id: string | null;
  organization_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  trigger_type: SalesEmailTriggerType;
  status: SalesEmailCommunicationStatus;
  subject: string;
  body: string;
  queued_at: string;
  sent_at: string | null;
  last_delivery_attempt_at: string | null;
  delivery_provider: string | null;
  delivery_reference: string | null;
  provider_error_state: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  events: SalesEmailCommunicationEventRecord[];
};

export type ResourceLibraryType = "image" | "document" | "qr_code" | "video";

export type ResourceLibraryCategory =
  | "setup_photo"
  | "location_reference"
  | "prior_successful_example"
  | "product_example"
  | "issue_concern"
  | "equipment_setup_need"
  | "qr_code_job_document"
  | "sop_reference"
  | "contract_document"
  | "proof_document"
  | "support_document"
  | "misc_internal_reference";

export type ResourceLibraryApprovalStatus =
  | "pending_review"
  | "approved"
  | "leadership_only"
  | "rejected_not_useful";

export type ResourceLibraryBestReferenceCategory =
  | "best_setup_example"
  | "best_team_photo_example"
  | "best_entrance_location_example"
  | "best_product_poster_example"
  | "best_logistics_example";

export type ResourceLibraryVisibilityScope = "leadership_only" | "photographer_prep";

export type ResourceLibraryLinkedScope = "shoot" | "location" | "organization";

export type ResourceLibraryItem = {
  id: string;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  uploader_user_id: string | null;
  uploader_name: string | null;
  resource_type: ResourceLibraryType;
  category: ResourceLibraryCategory;
  note: string | null;
  issue_type: string | null;
  approval_status: ResourceLibraryApprovalStatus;
  visibility_scope: ResourceLibraryVisibilityScope;
  best_reference_candidate: boolean;
  is_best_reference: boolean;
  best_reference_category: ResourceLibraryBestReferenceCategory | null;
  file_name: string;
  content_type: string | null;
  file_size_bytes: number | null;
  storage_key: string | null;
  preview_url: string | null;
  download_url: string | null;
  upload_source?: "mobile_camera" | "mobile_library" | "mobile_document" | "web_upload" | "system_migration" | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  shoot_date: string | null;
  captured_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  linked_scope: ResourceLibraryLinkedScope;
};

export type ResourceLibraryLearning = {
  id: string;
  organization_id?: string | null;
  organization_display_name?: string | null;
  location_id?: string | null;
  location_name?: string | null;
  shoot_id?: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  overall_rating: number;
  recommendations: string | null;
  notes: string | null;
  access_details: string | null;
  late_details: string | null;
};

export type ResourceLibraryRecurringContact = {
  id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
};

export type ResourceLibraryRecurringReminder = {
  id: string;
  source: "resource_library" | "post_shoot_evaluation";
  label: string;
  detail: string;
  created_at: string | null;
  shoot_name: string | null;
  shoot_date: string | null;
};

export type ResourceLibraryRecurringLocationIntelligence = {
  best_reference: ResourceLibraryItem[];
  setup_photos_last_two_years: ResourceLibraryItem[];
  prior_successful_examples: ResourceLibraryItem[];
  documents_and_qr: ResourceLibraryItem[];
  issue_watchouts: ResourceLibraryItem[];
  recent_post_shoot_evaluations: ResourceLibraryLearning[];
  recurring_contacts: ResourceLibraryRecurringContact[];
  reminders: ResourceLibraryRecurringReminder[];
};

export type ResourceLibraryView = {
  access: {
    can_manage: boolean;
    can_download: boolean;
    limited_view: boolean;
    historical_window_years: number | null;
  };
  summary: {
    total_items: number;
    media_count: number;
    document_count: number;
    best_reference_count: number;
    pending_review_count: number;
    leadership_only_count: number;
    rejected_count: number;
    prep_highlight_count: number;
  };
  review_queue: ResourceLibraryItem[];
  prep_highlights: ResourceLibraryItem[];
  media: ResourceLibraryItem[];
  documents: ResourceLibraryItem[];
  historical_references: ResourceLibraryItem[];
  post_shoot_learnings: ResourceLibraryLearning[];
  recurring_location_intelligence: ResourceLibraryRecurringLocationIntelligence | null;
};

export type OrganizationDetail = {
  organization: OrganizationSummary;
  contacts: OrganizationContact[];
  locations: OrganizationLocation[];
  school_profile?: SchoolProfile | null;
  school_rules?: SchoolRule[];
  school_activity?: SchoolActivityLog[];
  touchpoints?: DirectoryTouchpointRecord[];
  relationship_continuity?: DirectoryRelationshipContinuityBundle;
  recent_shoots: OrganizationRecentShoot[];
  next_shoot?: OrganizationUpcomingShoot | null;
  sales_opportunities?: OrganizationSalesOpportunityPreview[];
  account_overview?: {
    contract_status: string;
    expiration_timeline: string;
    last_shoot: OrganizationRecentShoot | null;
    next_shoot: OrganizationUpcomingShoot | null;
    key_contacts: OrganizationContact[];
    account_health_state: "healthy" | "watch" | "at_risk";
    account_health_summary: string;
    account_health_reasons: string[];
    recent_issues: OrganizationAccountIssue[];
    revenue_check_status: "not_tracked";
    revenue_check_summary: string;
  };
  agreements_access: AgreementAccess;
  agreement_summary: OrganizationAgreementSummary;
  agreements: AgreementRecord[];
  agreement_templates: AgreementTemplateRecord[];
  upcoming_shoot_agreement_risks: AgreementUpcomingShootRisk[];
  sales_pipeline_summary: {
    linked_opportunities: number;
    active_opportunities: number;
    dormant_opportunities: number;
    open_alerts: number;
    missing_next_action: number;
    inactive_opportunities: number;
    meeting_scheduled: number;
    schools_pipeline_count?: number;
    sports_pipeline_count?: number;
    renewal_opportunities?: number;
    contract_sent?: number;
    last_touch_date?: string | null;
    last_verified_contact_date?: string | null;
    next_action_due_date?: string | null;
  };
  sales_pipeline_alerts: Array<{
    id: string;
    alert_type: "missing_next_action" | "inactive_opportunity" | "meeting_scheduled";
    status: "open" | "resolved";
    severity: "warning" | "major" | "critical";
    dedupe_key: string;
    pipeline_type: "schools" | "sports" | null;
    opportunity_id: string | null;
    organization_id: string | null;
    agreement_id: string | null;
    linked_shoot_id: string | null;
    title: string;
    message: string;
    due_at: string | null;
    first_triggered_at: string;
    last_triggered_at: string;
    first_notified_at: string | null;
    last_notified_at: string | null;
    resolved_at: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
  sales_email_templates?: SalesEmailTemplateRecord[];
  sales_communications?: SalesEmailCommunicationRecord[];
  resource_library: ResourceLibraryView;
  placeholders: {
    agreement_summary: string;
    sales_pipeline_summary: string;
    recent_shoots_summary: string;
    resource_library_summary: string;
  };
};

export type OrganizationListResponse = {
  organizations: OrganizationSummary[];
  search: {
    query: string;
    total: number;
  };
};

export type DirectoryContactListResponse = {
  contacts: DirectoryContactSummary[];
  search: {
    query: string;
    total: number;
  };
};

export type DirectoryLocationListResponse = {
  locations: DirectoryLocationSummary[];
  search: {
    query: string;
    total: number;
  };
};

export type DirectoryTouchpointListResponse = {
  touchpoints: DirectoryTouchpointRecord[];
  total: number;
};

export type DirectoryContactDetailResponse = {
  contact: OrganizationContact;
  touchpoints: DirectoryTouchpointRecord[];
  relationship_continuity?: DirectoryRelationshipContinuityBundle;
};

export type DirectoryInternalOwner = {
  user_id: string;
  full_name: string;
  email: string | null;
  department: string | null;
  status: string | null;
  relationship_weight?: number;
  last_interaction_at?: string | null;
};

export type DirectoryRelationshipMaintenanceSignal = {
  code: string;
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
};

export type DirectoryOwnerOption = {
  user_id: string;
  full_name: string;
  email: string | null;
  department: string | null;
  status: string | null;
};

export type DirectoryDuplicateReviewListResponse = {
  reviews: DirectoryDuplicateReviewRecord[];
  total: number;
};

export type DirectoryImportColumnMapping = Partial<Record<DirectoryImportColumnKey, string | null>>;

export type DirectoryImportCandidateMatch = {
  contact_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_organization_labels: string[];
  confidence: DirectoryImportMatchConfidence;
  reason: string;
};

export type DirectoryImportNormalizedContactValues = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  organization_name: string | null;
  organization_type: OrganizationAccountType | null;
  relationship_role: DirectoryContactRelationshipRole | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  active_status?: DirectoryActiveStatus;
  resolved_organization_id?: string | null;
  resolved_organization_name: string | null;
};

export type DirectoryImportRowRecord = {
  id: string;
  row_number: number;
  status: DirectoryImportRowStatus;
  proposed_action: DirectoryImportRowAction;
  selected_action: DirectoryImportRowAction | null;
  selected_contact_id: string | null;
  resolved_organization_id: string | null;
  review_note: string | null;
  raw_values: Record<string, string | null>;
  normalized_values: DirectoryImportNormalizedContactValues;
  validation_errors: string[];
  warning_messages: string[];
  candidate_matches: DirectoryImportCandidateMatch[];
  applied_contact_id: string | null;
  applied_relationship_id: string | null;
  result_summary: string | null;
};

export type DirectoryImportSessionSummary = {
  total_rows: number;
  ready_to_create: number;
  ready_to_link: number;
  needs_review: number;
  skipped: number;
  invalid: number;
  applied: number;
  errors: number;
};

export type DirectoryImportSessionRecord = {
  id: string;
  source_file_name: string;
  import_kind: "contacts_csv";
  status: DirectoryImportSessionStatus;
  has_header_row: boolean;
  default_organization_id: string | null;
  mapping: DirectoryImportColumnMapping;
  summary: DirectoryImportSessionSummary;
  created_by_user_id: string | null;
  applied_by_user_id: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  rows: DirectoryImportRowRecord[];
};

export type DirectoryImportSessionListItem = {
  id: string;
  source_file_name: string;
  import_kind: "contacts_csv";
  status: DirectoryImportSessionStatus;
  has_header_row: boolean;
  default_organization_id: string | null;
  summary: DirectoryImportSessionSummary;
  created_by_user_id: string | null;
  applied_by_user_id: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryImportSessionListResponse = {
  sessions: DirectoryImportSessionListItem[];
  total: number;
};

export type ShootDirectoryContactLinkResponse = {
  shoot_id: string;
  organization_id: string | null;
  primary_contact_id: string | null;
  contact_links: ShootDirectoryContactLinkRecord[];
};

export type ShootTypeCode = OrganizationAccountType;

export type ShootLinkedContact = {
  id: string;
  full_name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type EvaluationSubmitInput = {
  location_id: string;
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: "Sports" | "Schools";
  on_time: "Yes" | "No";
  easy_access: "Yes" | "No";
  overall_rating: number;
  photos_uploaded: "Yes" | "No";
  late_details?: string | null;
  access_details?: string | null;
  notes?: string | null;
  outreach_notes?: string | null;
  recommendations?: string | null;
  image_quality?: string | null;
};

export type SetupPhotoUploadInput = {
  location_id: string;
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  file_name: string;
  content_type: string;
  data_url: string;
  photo_category?:
    | "arrival_entrance"
    | "parking_load_in"
    | "check_in_flow_area"
    | "room_wide_shot"
    | "final_camera_background_setup"
    | "power_staging_storage"
    | "special_constraint_watch_out"
    | null;
  caption?: string | null;
  promote_to_location_memory?: boolean;
};

export type ShiftSegmentRecord = {
  id: string;
  segment_kind: string;
  label: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  rate_code: string;
  hourly_rate_cents: number;
  sort_order: number;
};

export type ShiftPunchRecord = {
  id: string;
  direction: "in" | "out";
  client_timestamp: string;
  geofence_status: string;
  gps_confidence: string;
  approval_state: string;
  unscheduled: boolean;
  timing_status?: string;
  early_minutes?: number | null;
  late_minutes?: number | null;
  missed_punch_required?: boolean;
};

export type ShiftRecord = {
  id: string;
  assigned_user_id: string;
  assigned_user_name: string;
  assigned_user_email?: string | null;
  manager_user_id?: string | null;
  manager_name?: string | null;
  shoot_id?: string | null;
  shoot_code?: string | null;
  shoot_title?: string | null;
  shift_kind: string;
  status: string;
  department: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  navigation_url?: string | null;
  projected_students?: number | null;
  attendance_state?: string;
  attendance_state_note?: string | null;
  staffing_role?: string;
  satisfies_lead_coverage?: boolean;
  segments: ShiftSegmentRecord[];
  punches: ShiftPunchRecord[];
  latest_punch_direction?: "in" | "out" | null;
  latest_punch_at?: string | null;
  latest_geofence_status?: string | null;
  latest_gps_confidence?: string | null;
  latest_approval_state?: string | null;
};

export type ShootImportanceTier = "standard" | "elevated" | "big_shoot" | "critical_shoot";
export type ShootPriorityLabel = ShootImportanceTier | "high_priority";
export type ShootStatus =
  | "DRAFT"
  | "TENTATIVE"
  | "CONFIRMED"
  | "READY"
  | "LIVE"
  | "SHOOT_COMPLETE"
  | "POST_PRODUCTION"
  | "COMPLETE"
  | "ON_HOLD"
  | "CANCELLED";
export type ShootPostProductionSubstage =
  | "INTAKE_PENDING"
  | "ASSETS_RECEIVED"
  | "EDITING_PROCESSING"
  | "GRAPHICS_PACKAGING"
  | "UPLOAD_DELIVERY_PREP"
  | "QA_REVIEW"
  | "CORRECTION_NEEDED"
  | "READY_TO_RELEASE";
export type ShootReadinessRequirement = {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  detail?: string | null;
};
export type ShootOperationalFlag = {
  code: string;
  label: string;
  tone: OperationalActionTone;
  detail?: string | null;
};
export type ReadyToShootTone = "neutral" | "info" | "good" | "heads_up" | "action_needed";
export type ReadyToShootStatus =
  | "not_available"
  | "awaiting_confirmation"
  | "reminder_due"
  | "escalation_due"
  | "confirmed_clean"
  | "confirmed_exception";
export type ReadyToShootCheck = {
  key:
    | "lead_on_site"
    | "required_photographers_present"
    | "minimum_staffing_met"
    | "no_critical_missing_staff_signal"
    | "required_pre_service_items_complete";
  label: string;
  passed: boolean;
  detail: string;
};
export type ReadyToShootParticipant = {
  shift_id: string;
  user_id: string;
  name: string;
  role_label: string;
  is_photographer_role: boolean;
  is_lead_assignment: boolean;
  accounted_for: boolean;
  accounted_label: string;
  latest_punch_direction: "in" | "out" | null;
  latest_punch_at: string | null;
  presence_state: string | null;
  presence_captured_at: string | null;
};
export type ReadyToShootState = {
  lead_confirmed_ready: boolean;
  lead_confirmed_ready_at: string | null;
  lead_confirmed_ready_by_user_id: string | null;
  lead_confirmed_ready_by_name: string | null;
  lead_confirmed_ready_exception_flag: boolean;
  lead_confirmed_ready_confirmation_id: string | null;
  ready_to_shoot_status: ReadyToShootStatus;
  ready_to_shoot_label: string | null;
  ready_to_shoot_tone: ReadyToShootTone | null;
  ready_to_shoot_available: boolean;
  ready_to_shoot_setup_window_active: boolean;
  ready_to_shoot_reminder_due: boolean;
  ready_to_shoot_escalation_due: boolean;
  ready_to_shoot_minutes_until_start: number | null;
  show_action: boolean;
  already_confirmed: boolean;
  actor_is_authorized: boolean;
  actor_has_exception_authority: boolean;
  actor_on_site: boolean;
  checks: ReadyToShootCheck[];
  missing_items: string[];
  can_confirm_clean: boolean;
  can_confirm_with_exception: boolean;
  participants: ReadyToShootParticipant[];
  staffing_snapshot: {
    assigned_staff_count: number;
    minimum_staff_count: number;
    lead_coverage_count: number;
    open_required_slot_count: number;
    staffing_state: string | null;
    staffing_clean_for_ready: boolean;
    staffing_hard_blockers: string[];
    staffing_warnings: string[];
  };
  latest_confirmation: {
    id: string;
    confirmed_at: string;
    confirmed_by_user_id: string | null;
    confirmed_by_name: string | null;
    clean_confirmation: boolean;
    exception_reason: string | null;
    note: string | null;
    all_assigned_photographers_present: boolean;
  } | null;
  window: {
    shoot_is_today: boolean;
    starts_at: string | null;
    opens_at: string | null;
    closes_at: string | null;
    minutes_until_start: number | null;
  };
};

export type ShootSummary = {
  id: string;
  studio_id?: string | null;
  department?: string | null;
  shoot_category?: "sports" | "schools" | "events" | "studio" | null;
  shoot_type?: ShootTypeCode | null;
  shoot_subtype?: string | null;
  shoot_code: string;
  title: string;
  shoot_date?: string | null;
  organization_id?: string | null;
  organization_display_name?: string | null;
  organization_account_type?: OrganizationAccountType | null;
  location_id?: string | null;
  location_name: string;
  location_address?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  geofence_radius_meters?: number | null;
  navigation_url?: string | null;
  estimated_drive_minutes?: number | null;
  showtime?: string | null;
  arrival_time?: string | null;
  start_time?: string | null;
  end_time_est?: string | null;
  projected_students?: number | null;
  status?: string | null;
  status_display?: string | null;
  normalized_status?: ShootStatus | null;
  status_reason?: string | null;
  status_changed_at?: string | null;
  status_changed_by_user_id?: string | null;
  on_hold_return_status?: ShootStatus | null;
  post_production_substage?: ShootPostProductionSubstage | null;
  post_production_substage_display?: string | null;
  operations_priority?: "standard" | "elevated" | "high_priority" | null;
  big_shoot_manual_override?: boolean;
  camera_station_count?: number | null;
  shoot_structure?: "standard" | "open_house" | null;
  first_year_customer_flag?: boolean;
  flagship_priority_account_flag?: boolean;
  weather_travel_risk_flag?: boolean;
  manual_leadership_boost?: number | null;
  importance_score?: number | null;
  importance_tier?: ShootImportanceTier | null;
  importance_tier_display?: string | null;
  importance_calculated_tier?: ShootImportanceTier | null;
  importance_calculated_tier_display?: string | null;
  importance_reasons?: Array<{ label: string; detail: string }>;
  importance_override_applied?: boolean;
  importance_override_tier?: ShootImportanceTier | null;
  importance_override_reason?: string | null;
  importance_override_source?: "manual_override" | "legacy_big_shoot" | null;
  importance_override_at?: string | null;
  importance_override_by_user_id?: string | null;
  primary_contact_id?: string | null;
  primary_contact_name?: string | null;
  primary_contact_title?: string | null;
  primary_contact_phone?: string | null;
  primary_contact_email?: string | null;
  additional_contact_ids?: string[];
  additional_contacts?: ShootLinkedContact[];
  secondary_contact_name?: string | null;
  secondary_contact_phone?: string | null;
  secondary_contact_email?: string | null;
  special_instructions?: string | null;
  access_notes?: string | null;
  additional_products?: string | null;
  additional_products_flag?: boolean;
  special_equipment?: string | null;
  special_equipment_flag?: boolean;
  setup_notes?: string | null;
  day_of_notes?: string | null;
  internal_notes?: string | null;
  pre_service_notes_complete?: boolean;
  special_deliverables_ready?: boolean;
  gear_requirements_ready?: boolean;
  roster_data_required?: boolean;
  roster_data_ready?: boolean;
  ready_eligible?: boolean;
  readiness_summary?: string | null;
  readiness_requirements?: ShootReadinessRequirement[];
  readiness_blocking_keys?: string[];
  operational_flags?: ShootOperationalFlag[];
  revenue_potential_score?: number | null;
  strategic_district_importance?: boolean;
  account_growth_importance_score?: number | null;
  complexity_score?: number | null;
  customer_history_risk_score?: number | null;
  multi_team_coordination?: boolean;
  scheduled_employee_count?: number | null;
  clocked_in_employee_count?: number | null;
  open_attendance_exception_count?: number | null;
  planned_staff_count?: number | null;
  required_lead_count?: number | null;
  lead_coverage_count?: number | null;
  lead_name?: string | null;
  lead_confirmed_ready?: boolean;
  lead_confirmed_ready_at?: string | null;
  lead_confirmed_ready_by_user_id?: string | null;
  lead_confirmed_ready_by_name?: string | null;
  lead_confirmed_ready_exception_flag?: boolean;
  lead_confirmed_ready_confirmation_id?: string | null;
  ready_to_shoot_status?: ReadyToShootStatus | null;
  ready_to_shoot_label?: string | null;
  ready_to_shoot_tone?: ReadyToShootTone | null;
  ready_to_shoot_available?: boolean;
  ready_to_shoot_setup_window_active?: boolean;
  ready_to_shoot_reminder_due?: boolean;
  ready_to_shoot_escalation_due?: boolean;
  ready_to_shoot_minutes_until_start?: number | null;
  staffing_state?: string | null;
  under_staffed?: boolean;
  over_staffed?: boolean;
  missing_lead?: boolean;
  conflict_warning_count?: number | null;
  draft_shift_count?: number | null;
  published_shift_count?: number | null;
  publish_state?: "draft" | "ready_to_publish" | "published";
  schedule_sync_state?: string | null;
  schedule_sync_required?: boolean;
  scale_label?: string | null;
  priority_label?: ShootPriorityLabel | null;
  priority_label_display?: string | null;
  priority_weighted_score?: number | null;
  priority_reasons?: Array<{ label: string; detail: string }>;
  big_shoot?: boolean;
  future_profitability_flag?: "favorable" | "neutral" | "watch" | "needs_review" | null;
  future_profitability_display?: string | null;
  future_profitability_explanation?: string | null;
  agreement_warning_severity?: AgreementWarningSeverity;
  agreement_warning_summary?: string | null;
  agreement_warning_codes?: AgreementWarningCode[];
  agreement_has_active?: boolean;
  latest_event_type?: string | null;
  latest_event_at?: string | null;
  integration?: ScheduleRecordIntegrationState | null;
};

export type LiveShootQueueBucket = "needs_staffing" | "needs_review" | "unscheduled" | "scheduled" | "completed";

export type LiveShootQueueTone = "neutral" | "info" | "success" | "warning" | "critical";

export type LiveShootQueueFlag = {
  code: string;
  label: string;
  tone: LiveShootQueueTone;
};

export type LiveShootQueueStaffingSummary = {
  label: string;
  tone: LiveShootQueueTone;
  assigned_count: number;
  planned_count: number;
  gap_count: number;
  lead_missing: boolean;
  staffing_state?: string | null;
  publish_state?: string | null;
};

export type LiveShootQueueSyncSummary = {
  label: string;
  tone: LiveShootQueueTone;
  schedule_sync_state?: string | null;
  schedule_sync_required: boolean;
  manual_review_required: boolean;
  has_error: boolean;
  link_state?: string | null;
};

export type LiveShootQueueEntry = {
  shoot: ShootSummary;
  bucket: LiveShootQueueBucket;
  bucket_label: string;
  status_label: string;
  status_tone: LiveShootQueueTone;
  next_action: string;
  key_flags: LiveShootQueueFlag[];
  staffing_summary: LiveShootQueueStaffingSummary;
  sync_summary: LiveShootQueueSyncSummary;
  summary_string: string;
  owner_label: string;
};

export type LiveShootQueueSection = {
  id: LiveShootQueueBucket;
  title: string;
  summary: string;
  empty_state: string;
  items: LiveShootQueueEntry[];
};

export type LiveShootQueueResponse = {
  date?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  generated_at: string;
  summary: {
    in_view: number;
    needs_staffing: number;
    needs_review: number;
    unscheduled: number;
    scheduled: number;
    completed: number;
  };
  sections: LiveShootQueueSection[];
};

export type OperationalActionTone = "neutral" | "info" | "success" | "warning" | "critical";

export type ManagerCockpitFlag = {
  label: string;
  tone: OperationalActionTone;
};

export type ManagerCockpitQueueItem = {
  id: string;
  entity_kind:
    | "shoot"
    | "organization"
    | "contact"
    | "location"
    | "approval_request"
    | "project"
    | "employee"
    | "compliance_review"
    | "payroll_review";
  entity_id: string | null;
  organization_id: string | null;
  shoot_id: string | null;
  title: string;
  summary: string;
  owner_label: string;
  due_label: string | null;
  status_label: string;
  status_tone: OperationalActionTone;
  next_action: string;
  action_hash: string;
  flags: ManagerCockpitFlag[];
};

export type ManagerCockpitQueue = {
  id:
    | "needs_staffing"
    | "needs_contact_cleanup"
    | "needs_approval"
    | "needs_follow_up"
    | "needs_project_setup"
    | "needs_project_follow_up"
    | "overdue_project_tasks"
    | "needs_payroll_compliance_review";
  label: string;
  summary: string;
  count: number;
  items: ManagerCockpitQueueItem[];
};

export type ManagerCockpitResponse = {
  generated_at: string;
  anchor_date: string;
  headline: string;
  summary: {
    total_open: number;
    needs_staffing: number;
    needs_contact_cleanup: number;
    needs_approval: number;
    needs_follow_up: number;
    needs_project_setup: number;
    needs_project_follow_up: number;
    overdue_project_tasks: number;
    needs_payroll_compliance_review: number;
  };
  queues: ManagerCockpitQueue[];
};

export type ProductionProjectStatus = "new" | "active" | "blocked" | "waiting" | "completed" | "canceled";
export type ProductionProjectPriority = "low" | "normal" | "high" | "critical";
export type ProductionProjectTaskStatus = "todo" | "in_progress" | "blocked" | "done" | "skipped";
export type ProductionProjectTaskType = "production" | "peer_review" | "final_qc" | "release" | "handoff" | "rework";
export type ProductionProjectTaskDependencyState = "ready" | "blocked" | "complete";
export type ProductionProjectDueState = "overdue" | "due_today" | "upcoming" | "unscheduled";
export type ProductionProjectJobType =
  | "standard_school_production"
  | "sports_production"
  | "specialty_graphics"
  | "banner_specialty_product"
  | "gallery_prep_upload"
  | "qa_final_review"
  | "correction_rework";
export type ProductionProjectQaState =
  | "not_started"
  | "ready_for_qa"
  | "in_qa_review"
  | "qa_hold"
  | "passed"
  | "failed"
  | "correction_needed"
  | "peer_review_required"
  | "final_review_required";
export type ProductionProjectQaCheckStatus = "pass" | "fail" | "not_applicable" | "needs_review";
export type ProductionProjectQaCheckKey =
  | "count_reconciliation"
  | "blocking_exceptions"
  | "buddy_workflow"
  | "virtual_team"
  | "asset_validation"
  | "final_review_notes";
export type ProductionProjectReleaseState = "not_ready" | "ready_to_release" | "released";
export type ProductionProjectBlockerType =
  | "missing_files"
  | "bad_incomplete_data"
  | "waiting_on_decision"
  | "waiting_on_customer_school"
  | "upload_failure"
  | "qa_issue"
  | "system_tool_problem"
  | "staffing_capacity_issue"
  | "external_vendor_dependency"
  | "other";
export type ProductionProjectReviewResult = "passed" | "correction_needed" | "blocked" | "released";
export type ProductionProjectHealthSignal =
  | "healthy"
  | "due_soon"
  | "overdue"
  | "blocked"
  | "release_risk"
  | "fragile"
  | "escalated";
export type ProductionProjectOwnershipState =
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "waiting_review"
  | "returned_for_correction"
  | "complete";
export type ProductionProjectTeamOwner = "production" | "graphics" | "upload" | "qa" | "release" | "corrections";
export type ProductionProjectCategory =
  | "production_follow_up"
  | "photography_production"
  | "digital_production"
  | "qa_peer_review"
  | "remediation";
export type LegacyProductionProjectStageAlias =
  | "needs_peer_review"
  | "changes_requested"
  | "qa_approved"
  | "ready_for_release"
  | "released";
export type ProductionProjectStage =
  | "intake_pending"
  | "ready_for_production"
  | "in_production"
  | "blocked"
  | "ready_for_qa"
  | "in_qa_review"
  | "qa_hold"
  | "correction_needed"
  | "ready_to_release"
  | "released_complete"
  | "on_hold"
  | "cancelled"
  | "not_started";
export type LegacyProductionProjectQueueAlias =
  | "needs_setup"
  | "needs_follow_up"
  | "overdue_tasks"
  | "active"
  | "completed_recently";
export type ProductionProjectQueueId =
  | "my_queue"
  | "team_queue"
  | "blocked_queue"
  | "qa_queue"
  | "ready_to_release_queue"
  | "at_risk_queue";
export type ProductionProjectWorkspaceView = "lead_board" | "staff_workspace";
export type ProductionLeadBoardSort =
  | "overdue_severity"
  | "due_date"
  | "priority"
  | "last_touched"
  | "owner"
  | "current_step";
export type ProductionLeadBoardFocus = "all" | "blocked" | "overdue" | "waiting";
export type ProductionProjectWorkflowFamily = "general" | "schools" | "sports";
export type ProductionProjectWorkflowMode =
  | "manual_follow_up"
  | "post_shoot_wrap"
  | "digital_delivery"
  | "issue_remediation"
  | "resource_follow_up";
export type ProductionProjectWorkflowSeason = "all_year" | "spring" | "fall";
export type ProductionProjectLaneType = "buddy_photos" | "virtual_teams";
export type ProductionProjectExceptionStatus = "open" | "resolved" | "dismissed";
export type ProductionProjectExceptionSeverity = "low" | "normal" | "high" | "critical";
export type ProductionProjectExceptionType =
  | "buddy_unresolved_group"
  | "buddy_duplicate_handling_needed"
  | "vt_ambiguous_match"
  | "vt_coach_tag_missing"
  | "vt_split_group_mismatch"
  | "vt_attribute_validation_failed";
export type ProductionProjectFollowUpType = "training" | "ops_followup" | "coaching" | "process_update";
export type ProductionProjectFollowUpStatus = "open" | "in_progress" | "complete";

export type ProductionProjectBuddyWorkflow = {
  id: string;
  status: ProductionProjectTaskStatus;
  owner_user_id: string | null;
  owner_label: string | null;
  duplicate_handling_required: boolean;
  cleanup_completed_at: string | null;
  cleanup_completed_by_user_id: string | null;
  cleanup_completed_by_label: string | null;
  unresolved_group_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionProjectVirtualTeamWorkflow = {
  id: string;
  status: ProductionProjectTaskStatus;
  owner_user_id: string | null;
  owner_label: string | null;
  attributes_validated: boolean;
  coach_tags_validated: boolean;
  split_by_group_validated: boolean;
  ambiguous_match_required: boolean;
  ambiguous_match_resolved_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionProjectExceptionRecord = {
  id: string;
  lane_type: ProductionProjectLaneType;
  exception_type: ProductionProjectExceptionType;
  exception_type_label: string;
  severity: ProductionProjectExceptionSeverity;
  severity_label: string;
  blocking: boolean;
  status: ProductionProjectExceptionStatus;
  status_label: string;
  assignee_user_id: string | null;
  assignee_label: string | null;
  notes: string | null;
  resolution_notes: string | null;
  issue_tag: string | null;
  follow_up_type: ProductionProjectFollowUpType | null;
  follow_up_status: ProductionProjectFollowUpStatus | null;
  follow_up_owner_user_id: string | null;
  follow_up_owner_label: string | null;
  follow_up_notes: string | null;
  created_by_user_id: string | null;
  created_by_label: string | null;
  resolved_by_user_id: string | null;
  resolved_by_label: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ProductionProjectBlockerRecord = {
  id: string;
  blocker_type: ProductionProjectBlockerType;
  blocker_type_label: string;
  blocker_owner_user_id: string | null;
  blocker_owner_label: string | null;
  reason: string;
  dependency: string | null;
  expected_resolution_date: string | null;
  expected_resolution_label: string | null;
  notes: string | null;
  blocked_at: string;
};

export type ProductionProjectReviewRecord = {
  id: string;
  review_stage: ProductionProjectStage;
  review_stage_label: string;
  reviewer_user_id: string | null;
  reviewer_label: string | null;
  result: ProductionProjectReviewResult;
  result_label: string;
  correction_reason: string | null;
  note: string | null;
  qa_checks: ProductionProjectQaCheckRecord[] | null;
  qa_checklist_complete: boolean;
  reassigned_owner_user_id: string | null;
  reassigned_owner_label: string | null;
  created_at: string;
};

export type ProductionProjectQaCheckRecord = {
  key: ProductionProjectQaCheckKey;
  label: string;
  status: ProductionProjectQaCheckStatus;
  notes?: string | null;
};

export type ProductionProjectReferenceUserOption = {
  id: string;
  label: string;
  detail: string | null;
};

export type ProductionProjectReferenceOrganizationOption = {
  id: string;
  label: string;
  detail: string | null;
};

export type ProductionProjectReferenceLocationOption = {
  id: string;
  organization_id: string | null;
  organization_label: string | null;
  label: string;
  detail: string | null;
};

export type ProductionProjectReferenceShootOption = {
  id: string;
  organization_id: string | null;
  organization_label: string | null;
  location_id: string | null;
  location_label: string | null;
  shoot_code: string | null;
  label: string;
  detail: string | null;
};

export type ProductionProjectReferenceTriggerOption = {
  key: string;
  label: string;
};

export type ProductionProjectReferenceData = {
  generated_at: string;
  owners: ProductionProjectReferenceUserOption[];
  organizations: ProductionProjectReferenceOrganizationOption[];
  locations: ProductionProjectReferenceLocationOption[];
  shoots: ProductionProjectReferenceShootOption[];
  source_triggers: ProductionProjectReferenceTriggerOption[];
};

export type ProductionProjectTemplateTaskRecord = {
  id: string;
  task_key: string;
  title: string;
  summary: string | null;
  due_offset_days: number;
  required: boolean;
  sort_order: number;
  task_type: ProductionProjectTaskType;
  task_type_label: string;
  handoff_required: boolean;
  blocks_release: boolean;
  dependency_task_keys: string[];
};

export type ProductionProjectTemplateRecord = {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  workflow_family: ProductionProjectWorkflowFamily;
  workflow_family_label: string;
  workflow_mode: ProductionProjectWorkflowMode;
  workflow_mode_label: string;
  season_key: ProductionProjectWorkflowSeason;
  season_label: string;
  default_priority: ProductionProjectPriority;
  job_type: ProductionProjectJobType;
  job_type_label: string;
  category: ProductionProjectCategory;
  category_label: string;
  default_stage: ProductionProjectStage;
  default_stage_label: string;
  peer_review_required: boolean;
  final_qc_required: boolean;
  task_count: number;
  tasks?: ProductionProjectTemplateTaskRecord[];
};

export type ProductionProjectFlag = {
  label: string;
  tone: OperationalActionTone;
};

export type ProductionProjectSummaryRecord = {
  id: string;
  template_id: string | null;
  template_key: string | null;
  template_name: string | null;
  workflow_family: ProductionProjectWorkflowFamily | null;
  workflow_family_label: string | null;
  workflow_mode: ProductionProjectWorkflowMode | null;
  workflow_mode_label: string | null;
  season_key: ProductionProjectWorkflowSeason | null;
  season_label: string | null;
  title: string;
  summary: string | null;
  status: ProductionProjectStatus;
  job_type: ProductionProjectJobType;
  job_type_label: string;
  category: ProductionProjectCategory;
  category_label: string;
  stage: ProductionProjectStage;
  stage_label: string;
  current_step_key: string | null;
  current_step_label: string;
  current_step_task_type: ProductionProjectTaskType | null;
  current_step_task_type_label: string | null;
  current_step_order: number | null;
  qa_state: ProductionProjectQaState;
  qa_state_label: string;
  release_state: ProductionProjectReleaseState;
  release_state_label: string;
  health_signal: ProductionProjectHealthSignal;
  health_signal_label: string;
  ownership_state: ProductionProjectOwnershipState;
  ownership_state_label: string;
  team_owner: ProductionProjectTeamOwner;
  team_owner_label: string;
  priority: ProductionProjectPriority;
  owner_user_id: string | null;
  owner_label: string;
  peer_review_required: boolean;
  final_qc_required: boolean;
  peer_reviewer_user_id: string | null;
  peer_reviewer_label: string | null;
  final_qc_reviewer_user_id: string | null;
  final_qc_reviewer_label: string | null;
  due_date: string | null;
  due_label: string | null;
  follow_up_date: string | null;
  follow_up_label: string | null;
  snoozed_until: string | null;
  latest_note: string | null;
  source_type: "manual" | "trigger";
  source_trigger_key: string | null;
  source_trigger_label: string | null;
  created_reason: string;
  linked_organization_id: string | null;
  linked_organization_name: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  linked_shoot_id: string | null;
  linked_shoot_date: string | null;
  linked_shoot_date_label: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_shoot_type_label: string | null;
  linked_shoot_importance_tier: "standard" | "elevated" | "big_shoot" | "critical_shoot" | null;
  linked_shoot_importance_label: string | null;
  shoot_photographer_count: number | null;
  shoot_camera_station_count: number | null;
  context_label: string | null;
  open_task_count: number;
  open_required_task_count: number;
  completed_task_count: number;
  blocked_task_count: number;
  overdue_task_count: number;
  pending_peer_review: boolean;
  pending_final_qc: boolean;
  pending_release_tasks: number;
  release_blocked: boolean;
  buddy_workflow_status: ProductionProjectTaskStatus | null;
  buddy_duplicate_required: boolean;
  buddy_cleanup_complete: boolean;
  buddy_unresolved_group_count: number;
  vt_workflow_status: ProductionProjectTaskStatus | null;
  vt_ambiguous_match_required: boolean;
  vt_coach_tags_validated: boolean;
  vt_split_by_group_validated: boolean;
  vt_attributes_validated: boolean;
  task_authority_label: string;
  task_authority_reasons: string[];
  next_owner_label: string | null;
  blocker_count: number;
  current_blocker: ProductionProjectBlockerRecord | null;
  due_within_24_hours: boolean;
  overdue: boolean;
  stale_active: boolean;
  stale_label: string | null;
  last_touched_label: string;
  has_latest_note: boolean;
  corrections_needed: boolean;
  waiting_to_send: boolean;
  ready_to_send: boolean;
  production_can_touch: boolean;
  production_touch_label: string;
  production_touch_reasons: string[];
  next_action: string;
  status_tone: OperationalActionTone;
  flags: ProductionProjectFlag[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ProductionProjectBoardSection = {
  id: ProductionProjectQueueId;
  label: string;
  summary: string;
  count: number;
  items: ProductionProjectSummaryRecord[];
};

export type ProductionProjectIntakeIssueKind =
  | "duplicate_source"
  | "conflicting_link"
  | "sync_failed"
  | "sync_stale"
  | "backfill_failed";

export type ProductionProjectIntakeIssue = {
  id: string;
  issue_kind: ProductionProjectIntakeIssueKind;
  issue_kind_label: string;
  tone: OperationalActionTone;
  tone_label: string;
  title: string;
  summary: string;
  source_label: string;
  source_system_label: string;
  source_reference: string | null;
  context_label: string | null;
  linked_project_id: string | null;
  linked_project_title: string | null;
  action_hash: string;
  last_seen_at: string | null;
};

export type ProductionProjectIntakeSummary = {
  generated_at: string;
  summary_line: string;
  counts: {
    sources_considered: number;
    created: number;
    linked: number;
    duplicates: number;
    conflicts: number;
    sync_failures: number;
    stale_syncs: number;
  };
  issues: ProductionProjectIntakeIssue[];
};

export type ProductionProjectBoardResponse = {
  generated_at: string;
  anchor_date: string;
  default_workspace_view: ProductionProjectWorkspaceView;
  filters: {
    status: "open" | "completed" | "all";
    queue: ProductionProjectQueueId | "all";
    workspace_view: ProductionProjectWorkspaceView;
    search: string;
    owner_user_id: string | "unassigned" | null;
    priority: ProductionProjectPriority | "all";
    template_id: string | null;
    source_type: "manual" | "trigger" | "all";
    source_trigger_key: string | null;
    category: ProductionProjectCategory | "all";
    job_type: ProductionProjectJobType | "all";
    stage: ProductionProjectStage | "all";
    team_owner: ProductionProjectTeamOwner | "all";
    linked_organization_id: string | null;
    linked_location_id: string | null;
    linked_shoot_id: string | null;
    due_state: ProductionProjectDueState | "all";
    big_critical_only: boolean;
    lead_board_sort: ProductionLeadBoardSort;
    lead_board_focus: ProductionLeadBoardFocus;
  };
  summary: {
    total_visible: number;
    open_projects: number;
    all_unfinished: number;
    my_queue: number;
    team_queue: number;
    blocked_queue: number;
    qa_queue: number;
    ready_to_release_queue: number;
    at_risk_queue: number;
    unassigned_jobs: number;
    active_jobs: number;
    on_time: number;
    blocked: number;
    due_within_24_hours: number;
    overdue: number;
    jobs_in_qa: number;
    ready_to_release: number;
    stale_active: number;
    corrections_needed: number;
    waiting_to_send: number;
    ready_to_send: number;
    trigger_intake_waiting?: number;
    needs_setup?: number;
    needs_follow_up?: number;
    overdue_tasks?: number;
    completed_recently?: number;
    in_production?: number;
    blocked_or_corrections?: number;
    blocked_or_changes_requested?: number;
    awaiting_peer_review?: number;
    awaiting_final_qc?: number;
    release_blockers?: number;
    jobs_needing_owner_reassignment?: number;
  };
  lead_board: {
    summary_line: string;
    items: ProductionProjectSummaryRecord[];
  };
  intake: ProductionProjectIntakeSummary;
  sections: ProductionProjectBoardSection[];
};

export type ProductionProjectTaskRecord = {
  id: string;
  template_task_id: string | null;
  task_key: string | null;
  title: string;
  summary: string | null;
  status: ProductionProjectTaskStatus;
  task_type: ProductionProjectTaskType;
  task_type_label: string;
  owner_user_id: string | null;
  owner_label: string | null;
  due_date: string | null;
  due_label: string | null;
  latest_note: string | null;
  required: boolean;
  sort_order: number;
  handoff_required: boolean;
  blocks_release: boolean;
  started_at: string | null;
  completed_at: string | null;
  overdue: boolean;
  at_risk: boolean;
  dependency_state: ProductionProjectTaskDependencyState;
  dependency_state_label: string;
  blocking_dependencies: Array<{
    task_id: string;
    title: string;
    status: ProductionProjectTaskStatus;
    status_label: string;
  }>;
  dependent_task_count: number;
  last_handoff_at: string | null;
  last_handoff_to_user_id: string | null;
  last_handoff_to_label: string | null;
};

export type ProductionProjectTaskHandoffRecord = {
  id: string;
  task_id: string;
  task_title: string;
  from_user_id: string | null;
  from_user_label: string | null;
  to_user_id: string | null;
  to_user_label: string | null;
  note: string | null;
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
};

export type ProductionProjectTaskEventRecord = {
  id: string;
  task_id: string;
  task_title: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type ProductionProjectWorkflowSummary = {
  release_blocked: boolean;
  can_move_to_ready_to_release: boolean;
  can_release: boolean;
  blocked_reasons: string[];
  open_required_tasks: number;
  blocked_task_count: number;
  overdue_task_count: number;
  pending_peer_review: boolean;
  pending_final_qc: boolean;
  pending_release_tasks: number;
  deadline_ladder: Array<{
    task_id: string;
    title: string;
    due_date: string | null;
    due_label: string | null;
    status: ProductionProjectTaskStatus;
    status_label: string;
    owner_label: string | null;
    task_type: ProductionProjectTaskType;
    task_type_label: string;
    dependency_state: ProductionProjectTaskDependencyState;
    dependency_state_label: string;
  }>;
};

export type ProductionProjectEventRecord = {
  id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type ProductionProjectDetail = {
  project: ProductionProjectSummaryRecord;
  tasks: ProductionProjectTaskRecord[];
  reviews: ProductionProjectReviewRecord[];
  events: ProductionProjectEventRecord[];
  task_handoffs: ProductionProjectTaskHandoffRecord[];
  task_events: ProductionProjectTaskEventRecord[];
  workflow_summary: ProductionProjectWorkflowSummary;
  approval_summary: OperationalApprovalSourceSummary | null;
  buddy_workflow: ProductionProjectBuddyWorkflow | null;
  virtual_team_workflow: ProductionProjectVirtualTeamWorkflow | null;
  exceptions: ProductionProjectExceptionRecord[];
};

export type ProductionProjectQaWorkspaceReview = {
  review: ProductionProjectReviewRecord;
  project: ProductionProjectSummaryRecord;
};

export type ProductionProjectQaWorkspace = {
  generated_at: string;
  anchor_date: string;
  qa_hold: ProductionProjectSummaryRecord[];
  ready_for_qa: ProductionProjectSummaryRecord[];
  blocked_by_exceptions: ProductionProjectSummaryRecord[];
  ready_for_release: ProductionProjectSummaryRecord[];
  recent_reviews: ProductionProjectQaWorkspaceReview[];
};

export type ProductionProjectAnalyticsRow = {
  key: string;
  label: string;
  count: number;
};

export type ProductionProjectAnalyticsStageRow = {
  stage: ProductionProjectStage;
  stage_label: string;
  count: number;
  avg_days_in_stage: number;
  oldest_days_in_stage: number;
};

export type ProductionProjectAnalytics = {
  generated_at: string;
  window_start: string;
  window_end: string;
  qa_issues_by_photographer: ProductionProjectAnalyticsRow[];
  qa_issues_by_job_type: ProductionProjectAnalyticsRow[];
  qa_issues_by_account: ProductionProjectAnalyticsRow[];
  qa_issues_by_location: ProductionProjectAnalyticsRow[];
  exception_type_frequency: ProductionProjectAnalyticsRow[];
  recurring_issue_tags: ProductionProjectAnalyticsRow[];
  buddy_workload: {
    total: number;
    duplicate_handling_required: number;
    unresolved_groups: number;
  };
  virtual_team_workload: {
    total: number;
    ambiguous_matches: number;
  };
  release_delay_stages: ProductionProjectAnalyticsStageRow[];
};

export type ShootStatusEventRecord = {
  id: string;
  type: string;
  captured_at: string;
  geofence_status?: string | null;
};

export type ShootMediaAsset = {
  id: string;
  kind: string;
  storage_key: string;
  url?: string | null;
  created_at: string;
};

export type ShootShiftRecord = {
  id: string;
  assigned_user_name: string;
  starts_at: string;
  ends_at: string;
  shift_kind: string;
  status: string;
  segments?: Array<Pick<ShiftSegmentRecord, "id" | "label" | "rate_code">>;
};

export type ShootDetail = ShootSummary & {
  alerts?: AlertRecord[];
  status_events?: ShootStatusEventRecord[];
  media?: ShootMediaAsset[];
  resource_library?: ResourceLibraryView;
  shifts?: ShootShiftRecord[];
  attendance_exceptions?: AttendanceExceptionRecord[];
  location_intelligence?: ShootLocationIntelligence | null;
  ready_to_shoot?: ReadyToShootState | null;
};

export type StatusEventSocketPayload = {
  type?: string;
  shoot_code?: string;
  shoot_id?: string;
};

export type AlertSocketPayload = {
  alert_type?: string;
  shoot_code?: string;
  shoot_id?: string;
};

export type AttendanceExceptionRecord = {
  id: string;
  user_id?: string;
  exception_type: string;
  status: string;
  severity: string;
  classification?: string | null;
  reason_code?: string | null;
  notes?: string | null;
  requested_value?: Record<string, unknown> | null;
  original_value?: Record<string, unknown> | null;
  resolved_value?: Record<string, unknown> | null;
  requested_approver_user_id?: string | null;
  requested_approver_name?: string | null;
  approved_by_user_id?: string | null;
  approved_by_name?: string | null;
  shift_id?: string | null;
  shoot_code?: string | null;
  shift_title?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  shift_attendance_state?: string | null;
  attendance_state_note?: string | null;
  user_name?: string | null;
  manager_name?: string | null;
  created_at: string;
  updated_at?: string;
  approved_at?: string | null;
  time_clock_exception_request_id?: string | null;
  time_clock_request_status?: string | null;
  time_clock_request_type?: string | null;
  time_clock_requested_state?: string | null;
  time_clock_requested_start_time?: string | null;
  time_clock_requested_end_time?: string | null;
  time_clock_reporting_flags?: string[] | null;
  time_clock_original_values?: Record<string, unknown> | null;
  time_clock_resolved_values?: Record<string, unknown> | null;
  latest_punch_id?: string | null;
  latest_punch_direction?: "in" | "out" | null;
  latest_punch_at?: string | null;
  latest_punch_geofence_status?: string | null;
  latest_punch_approval_state?: string | null;
  latest_punch_reason_code?: string | null;
  latest_punch_requires_approval?: boolean | null;
  latest_punch_source?: string | null;
  latest_punch_notes?: string | null;
  time_record_clock_in_at?: string | null;
  time_record_clock_out_at?: string | null;
  time_record_worked_minutes?: number | null;
  time_entry_attendance_state?: string | null;
  time_record_break_override?: boolean | null;
  time_session_status?: string | null;
  time_session_work_date?: string | null;
  time_record_state?: string | null;
  time_record_state_label?: string | null;
  time_record_correction_state?: string | null;
  time_record_correction_label?: string | null;
  time_record_finalization_state?: string | null;
  time_record_finalization_label?: string | null;
  time_record_nearing_finalization?: boolean | null;
  time_record_locked?: boolean | null;
  time_record_location_state?: string | null;
  time_record_location_label?: string | null;
  time_review_priority?: string | null;
  time_review_priority_label?: string | null;
  time_clock_approval_records?: Array<{
    id: string;
    approver_id: string;
    approver_role: string;
    decision: string;
    comment?: string | null;
    decided_at: string;
  }> | null;
};

export type AttendanceLiveState =
  | "scheduled"
  | "upcoming"
  | "grace_window"
  | "checked_in"
  | "on_time"
  | "late"
  | "late_acknowledged"
  | "unresolved_no_check_in"
  | "called_out"
  | "replacement_needed"
  | "no_show"
  | "manager_excused"
  | "completed"
  | "canceled";

export type AttendanceOperationsAction =
  | "mark_present"
  | "acknowledge_late"
  | "mark_called_out"
  | "request_replacement"
  | "mark_no_show"
  | "excuse";

export type AttendanceOperationsItemRecord = {
  shift_id: string;
  shoot_id: string | null;
  employee_id: string;
  employee_name: string;
  employee_email: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  department: string;
  shift_title: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  location_address: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
  school_name: string | null;
  current_state: AttendanceLiveState;
  current_state_reason: string;
  signal_source: string;
  escalation_level: number;
  last_signal_at: string | null;
  first_present_at: string | null;
  latest_check_in_at: string | null;
  latest_time_clock_start_at: string | null;
  manager_mark_present_at: string | null;
  late_acknowledged_at: string | null;
  called_out_at: string | null;
  replacement_needed_at: string | null;
  no_show_marked_at: string | null;
  manager_excused_at: string | null;
  open_alert_types: string[];
  coverage_impact: boolean;
  critical_role_missing: boolean;
  understaffed_due_to_attendance: boolean;
  minimum_staff_count: number;
  planned_staff_count: number;
  required_lead_count: number;
  active_present_count: number;
  present_lead_count: number;
  minutes_from_start: number | null;
  minutes_until_start: number | null;
  health_tone: "neutral" | "warning" | "critical" | "success";
  state_label: string;
  alert_labels: string[];
  scheduling_hash: string | null;
};

export type AttendanceOperationsWorkspaceRecord = {
  generated_at: string;
  date: string;
  scope: "all" | "department" | "own";
  timing_rules: {
    awarenessWindowMinutes: number;
    graceWindowMinutes: number;
    unresolvedThresholdMinutes: number;
    noShowThresholdMinutes: number;
  };
  summary: {
    tracked_shift_count: number;
    on_time_count: number;
    checked_in_count: number;
    late_count: number;
    unresolved_count: number;
    called_out_count: number;
    replacement_needed_count: number;
    no_show_count: number;
    coverage_impact_count: number;
    critical_role_missing_count: number;
    understaffed_due_to_attendance_count: number;
  };
  sections: Array<{
    key: "critical_risk" | "late_watch" | "coverage_replacement" | "checked_in" | "resolved";
    label: string;
    description: string;
    count: number;
    items: AttendanceOperationsItemRecord[];
  }>;
  home_ready_summary: {
    visible: boolean;
    summary_line: string;
    urgent_count: number;
    staffing_risk_count: number;
    items: Array<{
      shift_id: string;
      title: string;
      summary: string;
      urgency_label: string;
      state: AttendanceLiveState;
      scheduling_hash: string | null;
    }>;
  };
};

export type AttendanceOperationDetailRecord = {
  generated_at: string;
  item: AttendanceOperationsItemRecord;
  available_actions: AttendanceOperationsAction[];
  staffing_impact: {
    coverage_impact: boolean;
    critical_role_missing: boolean;
    understaffed_due_to_attendance: boolean;
    minimum_staff_count: number;
    planned_staff_count: number;
    required_lead_count: number;
    active_present_count: number;
    present_lead_count: number;
    scheduling_hash: string | null;
  };
  history: Array<{
    id: string;
    event_type: string;
    from_state: AttendanceLiveState | null;
    to_state: AttendanceLiveState | null;
    signal_source: string | null;
    escalation_level: number | null;
    note: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    actor_user_id: string | null;
    actor_user_name: string | null;
  }>;
};

export type OpsNotificationRecord = {
  id: string;
  group_key: string;
  recipient_user_id: string;
  related_user_id?: string | null;
  shift_id?: string | null;
  shoot_id?: string | null;
  attendance_exception_id?: string | null;
  notification_type: string;
  category?: string;
  severity?: "low" | "medium" | "high" | "critical";
  channel: string;
  delivery_channels?: string[];
  priority: "normal" | "high" | "critical";
  status: string;
  delivery_status?: string;
  title: string;
  body: string;
  deep_link?: string | null;
  created_at: string;
  updated_at?: string;
  due_at?: string | null;
  action_required?: boolean;
  action_owner_user_id?: string | null;
  requires_acknowledgement?: boolean;
  allow_snooze?: boolean;
  acknowledged_at?: string | null;
  seen_at?: string | null;
  snoozed_until?: string | null;
  resolved_at?: string | null;
  expired_at?: string | null;
  escalated_at?: string | null;
  escalation_level?: number;
  digest_eligible?: boolean;
  quiet_hours_deferred?: boolean;
  source_event?: string | null;
  metadata?: Record<string, unknown>;
};

export type NotificationCenterViewId = "all" | "my_action_needed" | "team_risk" | "approval_queue" | "escalated" | "resolved_recent";

export type NotificationCenterResponse = {
  generated_at: string;
  view: NotificationCenterViewId;
  summary: {
    active_count: number;
    new_count: number;
    action_required_count: number;
    critical_count: number;
    escalated_count: number;
    resolved_recent_count: number;
  };
  saved_views: Array<{
    id: NotificationCenterViewId;
    label: string;
    count: number;
  }>;
  items: OpsNotificationRecord[];
};

export type DashboardSummary = {
  all_shoots_today: number;
  scheduled_employees: number;
  clocked_in_employees: number;
  late_employees: number;
  no_shows: number;
  excused_exceptions: number;
  unscheduled_punches: number;
  out_of_bounds_punches: number;
  studio_staff_on_shift: number;
  scheduled_labor_hours: number;
  actual_labor_hours: number;
  payable_labor_hours?: number;
  break_deduction_hours?: number;
  late_warning_count?: number;
  missed_punch_count?: number;
  missed_clock_out_count?: number;
  no_show_suspected_count?: number;
  break_override_count?: number;
  early_clock_in_exception_count?: number;
  fill_rate_percent?: number;
  overtime_risk_count?: number;
  under_staffed_shoot_count?: number;
  trade_request_count?: number;
  average_setup_to_live_lag_minutes?: number;
};

export type DashboardShootMetric = {
  scope_id: string;
  scope_code: string;
  scope_title: string;
  projected_students: number;
  scheduled_employees: number;
  scheduled_hours: number;
  actual_hours: number;
  rigorous_shoot_score: number;
};

export type LaborReportRow = {
  assigned_user_id: string;
  assigned_user_name: string;
  department: string;
  manager_name?: string | null;
  shift_count: number | string;
  clocked_in_shift_count: number | string;
  scheduled_hours: number | string;
  actual_hours: number | string;
  labor_delta_hours: number | string;
  open_exception_count: number | string;
};

export type PunchReportRow = {
  id: string;
  shift_id?: string | null;
  shift_title?: string | null;
  shoot_code?: string | null;
  assigned_user_name: string;
  manager_name?: string | null;
  department?: string | null;
  direction: "in" | "out";
  client_timestamp: string;
  geofence_status: string;
  gps_confidence: string;
  approval_state: string;
  reason_code?: string | null;
  notes?: string | null;
};

export type ExceptionReportRow = AttendanceExceptionRecord & {
  department?: string | null;
};

export type PayrollReportRow = {
  id: string;
  shift_id?: string | null;
  shift_title?: string | null;
  shoot_code?: string | null;
  assigned_user_name?: string | null;
  manager_name?: string | null;
  department?: string | null;
  location_name?: string | null;
  clock_in_at: string;
  clock_out_at?: string | null;
  scheduled_minutes?: number | null;
  gross_minutes?: number | null;
  break_deduction_minutes?: number | null;
  break_deduction_applied?: boolean;
  break_deduction_source?: string | null;
  break_deduction_overridden?: boolean;
  break_deduction_override_reason?: string | null;
  payable_minutes?: number | null;
  approved_payable_minutes?: number | null;
  payroll_state?: string | null;
  attendance_state?: string | null;
};

export type OperationsDashboard = {
  summary: DashboardSummary;
  shoots: DashboardShootMetric[];
  shifts: Array<
    Omit<ShiftRecord, "segments" | "punches"> & {
      segments?: ShiftSegmentRecord[];
      punches?: ShiftPunchRecord[];
      scheduled_hours?: number | string;
      actual_hours?: number | string;
      punch_in_count?: number | string;
      open_exception_count?: number | string;
    }
  >;
  reporting: {
    labor: LaborReportRow[];
    punches: PunchReportRow[];
    exceptions: ExceptionReportRow[];
    payroll: PayrollReportRow[];
  };
  insights?: {
    hours_by_department?: Array<{
      department: string;
      scheduled_hours: number;
      actual_hours: number;
      employee_count: number;
    }>;
    hours_by_shoot?: Array<{
      scope_id: string;
      scope_code: string;
      scope_title: string;
      department: string;
      scheduled_hours: number;
      actual_hours: number;
      planned_staff_count: number;
      scheduled_employees: number;
      fill_rate_percent: number;
      rigorous_shoot_score: number;
    }>;
    attendance_reliability_by_employee?: Array<{
      assigned_user_id: string;
      assigned_user_name: string;
      department: string;
      late_count: number;
      missed_punch_count: number;
      no_show_count: number;
      open_exception_count: number;
      reliability_score: number;
    }>;
    labor_exceptions_trend?: Array<{
      bucket_label: string;
      late_count: number;
      missed_punch_count: number;
      no_show_count: number;
      outside_geofence_count: number;
    }>;
    shift_trade_frequency?: Array<{
      department: string;
      total_requests: number;
      approved_requests: number;
      pending_requests: number;
    }>;
    staffing_efficiency_by_shoot_type?: Array<{
      department: string;
      scheduled_hours: number;
      actual_hours: number;
      fill_rate_percent: number;
    }>;
    fill_rate_percent?: number;
    average_setup_to_live_lag_minutes?: number;
  };
};

export type OperationsControlRoomTone = "neutral" | "info" | "success" | "warning" | "critical";

export type OperationsControlRoomChip = {
  label: string;
  tone?: OperationsControlRoomTone;
};

export type OperationsControlRoomMetric = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: OperationsControlRoomTone;
  action_hash: string;
};

export type OperationsControlRoomItem = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  owner_label: string;
  status_label: string;
  tone: OperationsControlRoomTone;
  meta: OperationsControlRoomChip[];
  flags: OperationsControlRoomChip[];
  next_action: string;
  action_hash: string;
};

export type OperationsControlRoomRouteCard = {
  id: string;
  title: string;
  count: number | null;
  summary: string;
  tone: OperationsControlRoomTone;
  action_hash: string;
};

export type OperationsControlRoomActivityItem = {
  id: string;
  module_label: string;
  summary: string;
  actor_label: string;
  created_at: string;
  action_hash: string;
};

export type OperationsControlRoomReadySignal = {
  id: string;
  shoot_code: string;
  title: string;
  status_label: string;
  tone: "neutral" | "info" | "success" | "warning" | "critical";
  detail: string;
  confirmed_at: string | null;
  confirmed_by_label: string | null;
  action_hash: string;
};

export type OperationsControlRoomResponse = {
  generated_at: string;
  anchor_date: string;
  refresh_interval_seconds: number;
  summary_band: OperationsControlRoomMetric[];
  urgent_watch: {
    generated_at: string;
    headline: string;
    summary_line: string;
    action_hash: string;
    items: OperationsControlRoomItem[];
  };
  staffing_pressure: {
    generated_at: string | null;
    headline: string;
    summary_line: string;
    action_hash: string;
    metrics: OperationsControlRoomMetric[];
    items: OperationsControlRoomItem[];
  };
  attendance_impact: {
    generated_at: string | null;
    headline: string;
    summary_line: string;
    action_hash: string;
    metrics: OperationsControlRoomMetric[];
    items: OperationsControlRoomItem[];
  };
  live_execution: {
    generated_at: string | null;
    headline: string;
    summary_line: string;
    routes: OperationsControlRoomRouteCard[];
    ready_signals: OperationsControlRoomReadySignal[];
    items: OperationsControlRoomItem[];
  };
  recent_activity: {
    generated_at: string;
    headline: string;
    summary_line: string;
    items: OperationsControlRoomActivityItem[];
  };
};

export type HomeDashboardMode = "app" | "tv";
export type HomeWidgetTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";

export type HomeBusinessPulseTile = {
  id: "shoots_this_week" | "subjects_this_week" | "id_cards_to_print" | "jobs_needing_attention" | "labor_today";
  label: string;
  value: number;
  context_label: string;
  tone: HomeWidgetTone;
  trend_label: string | null;
  source_mode: "live" | "derived_adapter";
};

export type HomeWeekScheduleItem = {
  date: string;
  label: string;
  short_label: string;
  shoot_count: number;
  big_shoot_count: number;
  attention_count: number;
  is_today: boolean;
};

export type HomeTodayShootPreview = {
  id: string;
  shoot_code: string;
  title: string;
  department: string | null;
  shoot_date: string | null;
  location_name: string;
  location_address: string | null;
  navigation_url: string | null;
  estimated_drive_minutes: number | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  projected_students: number | null;
  status: string | null;
  scheduled_employee_count: number | null;
  big_shoot: boolean;
  lead_name?: string | null;
  lead_confirmed_ready?: boolean;
  lead_confirmed_ready_at?: string | null;
  lead_confirmed_ready_by_name?: string | null;
  lead_confirmed_ready_exception_flag?: boolean;
  ready_to_shoot_status?: ReadyToShootStatus | null;
  ready_to_shoot_label?: string | null;
  ready_to_shoot_tone?: ReadyToShootTone | null;
  staffing_readiness_label?: string | null;
  staffing_readiness_tone?: HomeWidgetTone | null;
  priority_label?: ShootPriorityLabel | null;
  priority_display?: string | null;
  priority_reasons?: Array<{ label: string; detail: string }>;
  scale_label: string;
  phase: "upcoming" | "in_progress" | "complete" | "needs_attention";
  status_label: string;
  status_tone: HomeWidgetTone;
  attention_label: string | null;
  attention_tone: HomeWidgetTone | null;
  sync_label: string;
  sync_tone: HomeWidgetTone;
  next_action: string;
};

export type HomeWeatherTravelItem = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  location_name: string;
  time_label: string;
  kind: "weather" | "travel";
  severity: HomeWidgetTone;
  summary: string;
};

export type HomeCustomerServiceCategory = {
  label: string;
  count: number;
};

export type HomeLocationNeedsLoveItem = {
  location_id: string;
  name: string;
  category: string;
  tone: HomeWidgetTone;
  theme_label: string;
  summary: string;
  affecting_today: boolean;
  recent_improvement: string | null;
};

export type HomeLaborRollup = {
  label: string;
  scheduled_hours: number;
  actual_hours: number;
};

export type HomeAttendanceAwarenessEntry = {
  id: string;
  employee_id: string;
  employee_name: string;
  shift_id: string | null;
  shoot_id: string | null;
  primary_label: string;
  secondary_label: string | null;
  supporting_label: string | null;
  current_state: "off_clock" | "office_drive" | "photography" | "needs_end_of_day_confirmation";
  captured_at: string | null;
  operational_state?:
    | "on_time"
    | "early"
    | "grace_window"
    | "late"
    | "critically_late"
    | "missing_clock_in"
    | "wrong_location"
    | "probable_no_show"
    | "excused_exception"
    | "corrected_after_review";
  severity?: "low" | "medium" | "high" | "critical";
  severity_label?: string;
  location_classification?:
    | "valid_on_site"
    | "near_site"
    | "wrong_location"
    | "outside_allowed_zone"
    | "manual_override"
    | "clock_in_pending_location_review"
    | null;
  location_label?: string | null;
  staffing_risk?: boolean;
  minutes_from_start?: number | null;
};

export type HomeUrgentWatchState = "action_needed_today" | "due_within_24h" | "overdue" | "at_risk";

export type HomeUrgentWatchItem = {
  id: string;
  kind: "shoot" | "weather" | "travel" | "customer_service" | "location" | "labor" | "project" | "attendance" | "scheduling" | "approval";
  kind_label: string;
  title: string;
  summary: string;
  supporting_label: string | null;
  tone: HomeWidgetTone;
  urgency_state: HomeUrgentWatchState;
  urgency_label: string;
  action_label: string;
  action_hash: string;
  shoot_id: string | null;
  location_id: string | null;
  project_id: string | null;
};

export type HomeSurfaceStripItem = {
  id: string;
  label: string;
  value: number;
  detail: string;
  tone: HomeWidgetTone;
  action_hash: string;
};

export type HomeSurfaceFocusItem = {
  id: string;
  source_label: string;
  title: string;
  summary: string;
  owner_label: string;
  due_label: string | null;
  status_label: string;
  tone: HomeWidgetTone;
  next_action: string;
  action_hash: string;
};

export type HomeSurfaceCompactWidget = {
  id: "attendance_awareness" | "production_snapshot" | "approvals_summary" | "staffing_health" | "my_follow_ups" | "schools_risk";
  title: string;
  count: number;
  summary: string;
  tone: HomeWidgetTone;
  action_hash: string;
};

export type HomeSurfaceMyDayItem = {
  id: string;
  title: string;
  summary: string;
  location_label: string;
  time_label: string;
  role_label: string;
  status_label: string;
  tone: HomeWidgetTone;
  next_action: string;
  action_hash: string;
};

export type HomeSurfaceUpdateItem = {
  id: string;
  title: string;
  summary: string;
  created_at_label: string;
  action_hash: string | null;
};

export type HomeSurfaceVisibilityMatrix = {
  staffing_tracker: boolean;
  time_band: boolean;
  today_strip: boolean;
  urgent_watch: boolean;
  today_and_next_up: boolean;
  my_day: boolean;
  attendance_awareness: boolean;
  production_snapshot: boolean;
  approvals_summary: boolean;
  staffing_health: boolean;
  my_follow_ups: boolean;
  schools_risk: boolean;
};

export type HomeSurfaceStaffingBandMetric = {
  id: "clocked_in" | "in_office" | "in_field" | "assigned_but_missing";
  label: string;
  count: number;
  detail: string;
  tone: HomeWidgetTone;
  action_hash: string;
};

export type HomeSurfaceStaffingBand = {
  visible: boolean;
  headline: string;
  summary_line: string;
  action_hash: string;
  metrics: HomeSurfaceStaffingBandMetric[];
};

export type HomeSurfaceTimeBand = {
  visible: boolean;
  headline: string;
  state: "action_needed" | "active" | "ended_today" | "needs_review" | "off_shift";
  emphasis: "red" | "green" | "amber" | "neutral";
  label: string;
  summary_line: string;
  elapsed_label: string | null;
  shift_label: string | null;
  location_label: string | null;
  action_label: string;
  action_hash: string;
  schedule_hash: string | null;
};

export type HomeSurface = {
  role_template: OperatingSystemAccessProfile["role_template"];
  layout: "manager" | "employee";
  visibility_matrix: HomeSurfaceVisibilityMatrix;
  module_access: OperatingSystemAccessProfile["module_access"];
  staffing_band: HomeSurfaceStaffingBand | null;
  time_band: HomeSurfaceTimeBand | null;
  today_strip: {
    headline: string;
    items: HomeSurfaceStripItem[];
  };
  urgent_attention: {
    visible: boolean;
    headline: string;
    summary_line: string;
    items: HomeUrgentWatchItem[];
  };
  today_and_next_up: {
    visible: boolean;
    headline: string;
    summary_line: string;
    today: HomeSurfaceFocusItem[];
    next_up: HomeSurfaceFocusItem[];
  } | null;
  my_day: {
    visible: boolean;
    headline: string;
    summary_line: string;
    next_shift_label: string | null;
    items: HomeSurfaceMyDayItem[];
    updates: HomeSurfaceUpdateItem[];
  } | null;
  compact_widgets: HomeSurfaceCompactWidget[];
};

export type HomeDepartmentTaskCounts = {
  schools: number | null;
  sports: number | null;
  production: number | null;
};

export type HomeDashboardResponse = {
  generated_at: string;
  anchor_date: string;
  mode: HomeDashboardMode;
  refresh_interval_seconds: number;
  tv_rotation_seconds: number;
  public_safe: boolean;
  tv_names_enabled: boolean;
  critical_banner: {
    tone: HomeWidgetTone;
    label: string;
    message: string;
  } | null;
  home_surface?: HomeSurface;
  widgets: {
    today_strip: {
      shoot_count: number;
      urgent_issue_count: number;
      approvals_waiting_count: number;
      late_arrival_count: number;
      production_at_risk_count: number;
    };
    business_pulse: {
      tiles: HomeBusinessPulseTile[];
      week_start: string;
      week_end: string;
      week_schedule: HomeWeekScheduleItem[];
      weekly_department_mix: Array<{ department: string; shoots: number; subjects: number }>;
      jobs: Array<{ id: string; label: string; detail: string; tone: HomeWidgetTone }>;
    };
    today_shoots: {
      total: number;
      upcoming_count: number;
      in_progress_count: number;
      complete_count: number;
      needs_attention_count: number;
      big_shoot_count: number;
      shoots: HomeTodayShootPreview[];
    };
    weather_travel_watch: {
      tone: HomeWidgetTone;
      summary_line: string;
      items: HomeWeatherTravelItem[];
    };
    customer_service_pulse: {
      safe_summary: true;
      tone: HomeWidgetTone;
      summary_line: string;
      open_tickets: number;
      urgent_signal_count: number;
      backlog_count: number;
      trend_label: string;
      top_categories: HomeCustomerServiceCategory[];
      connected: boolean;
      drilldown_enabled: boolean;
    };
    places_that_need_more_love: {
      summary_line: string;
      items: HomeLocationNeedsLoveItem[];
    };
    labor_snapshot_today: {
      visible: boolean;
      public_safe: true;
      tone: HomeWidgetTone;
      summary_line: string;
      scheduled_hours: number;
      actual_hours: number;
      overtime_risk_count: number;
      department_rollup: HomeLaborRollup[];
      shoot_rollup: HomeLaborRollup[];
    } | null;
    attendance_awareness: {
      visible: boolean;
      summary: {
        clocked_in_count: number;
        grace_window_count?: number;
        not_clocked_in_count: number;
        late_count: number;
        critically_late_count?: number;
        missing_clock_in_count?: number;
        probable_no_show_count?: number;
        missing_count: number;
        wrong_location_count: number;
        staffing_risk_count?: number;
      };
      clocked_in: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      grace_window?: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      not_clocked_in: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      late: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      critically_late?: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      missing_clock_in?: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      probable_no_show?: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      missing: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      wrong_location: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      in_office: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      in_field: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
      assigned_but_missing: {
        count: number;
        items: HomeAttendanceAwarenessEntry[];
      };
    };
    urgent_watch: {
      visible: boolean;
      tone: HomeWidgetTone;
      summary_line: string;
      items: HomeUrgentWatchItem[];
    };
    department_task_counts: HomeDepartmentTaskCounts;
    production_projects: {
      visible: boolean;
      generated_at: string;
      summary_line: string;
      tone: HomeWidgetTone;
      counts: {
        unassigned_jobs: number;
        active_jobs: number;
        on_time: number;
        overdue: number;
        blocked: number;
        due_within_24_hours: number;
        jobs_in_qa: number;
        ready_to_release: number;
        peer_review_lag?: number;
        final_qc_lag?: number;
        release_blockers?: number;
        stale_active?: number;
        attention_needed?: number;
        in_production?: number;
        blocked_or_corrections?: number;
        blocked_or_changes_requested?: number;
        awaiting_peer_review?: number;
        awaiting_final_qc?: number;
      };
      assessment_cards: Array<{
        id:
          | "unassigned_jobs"
          | "active_jobs"
          | "on_time"
          | "overdue"
          | "blocked"
          | "due_within_24_hours"
          | "jobs_in_qa"
          | "ready_to_release"
          | "peer_review_lag"
          | "final_qc_lag"
          | "release_blockers"
          | "stale_active";
        label: string;
        value: number;
        tone: HomeWidgetTone;
        detail: string;
        action_hash: string;
      }>;
      owners: Array<{
        owner_user_id: string | null;
        owner_label: string;
        assignment_label: string;
        open_count: number;
        in_production_count: number;
        qa_queue_count: number;
        ready_to_release_count: number;
        overdue_count: number;
        awaiting_peer_review_count?: number;
        awaiting_final_qc_count?: number;
        pressure_label: string;
        action_hash: string;
      }>;
      focus_items: Array<{
        project_id: string;
        title: string;
        summary: string;
        owner_label: string;
        stage_label: string;
        queue_label: string;
        reviewer_label: string | null;
        due_label: string | null;
        next_action: string;
        tone: HomeWidgetTone;
        action_hash: string;
      }>;
      urgent_items: Array<{
        project_id: string;
        title: string;
        summary: string;
        owner_label: string;
        stage_label: string;
        due_label: string | null;
        urgency_state: "overdue" | "due_within_24h" | "action_needed_today";
        urgency_label: string;
        action_hash: string;
      }>;
    };
  };
};

export type ScheduleSyncSummary = {
  source_of_truth: string;
  outlook_connected: boolean;
  outlook_health_state: string;
  last_sync_at: string | null;
  last_failed_sync_at: string | null;
  pending_sync_count: number;
};

export type UnifiedScheduleShootItem = {
  item_kind: "shoot";
  id: string;
  shoot_id: string;
  date_key: string;
  title: string;
  shoot_code: string;
  department: string;
  shoot_category?: "sports" | "schools" | "events" | "studio" | null;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  showtime?: string | null;
  arrival_time?: string | null;
  start_time?: string | null;
  end_time_est?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  navigation_url?: string | null;
  estimated_drive_minutes?: number | null;
  projected_students?: number | null;
  planned_staff_count: number | null;
  assigned_staff_count: number | null;
  required_lead_count: number | null;
  lead_coverage_count: number | null;
  lead_name?: string | null;
  operations_priority?: "standard" | "elevated" | "high_priority" | null;
  big_shoot_manual_override?: boolean;
  special_equipment?: string | null;
  missing_fields: string[];
  open_alert_count: number | null;
  open_attendance_exception_count: number | null;
  schedule_sync_state: string;
  schedule_sync_required: boolean;
  staffing_state: string;
  staffing_health_state?: string | null;
  staffing_health_label?: string | null;
  staffing_detail_visibility?: "full" | "limited";
  staffing_gap_count?: number | null;
  unconfirmed_staff_count?: number | null;
  scale_label: string;
  priority_label?: ShootPriorityLabel | null;
  priority_label_display?: string | null;
  priority_reasons?: Array<{ label: string; detail: string }>;
  future_profitability_flag?: "favorable" | "neutral" | "watch" | "needs_review" | null;
  future_profitability_display?: string | null;
  board_day_part: string;
  under_staffed: boolean;
  missing_lead: boolean;
  over_staffed?: boolean;
  conflict_warning_count?: number | null;
  draft_shift_count?: number | null;
  published_shift_count?: number | null;
  publish_state?: "draft" | "ready_to_publish" | "published" | null;
  integration: ScheduleRecordIntegrationState;
};

export type UnifiedScheduleEventItem = {
  item_kind: "event";
  id: string;
  date_key: string;
  title: string;
  department: string;
  event_kind: string;
  status: string;
  starts_at: string;
  ends_at: string;
  location_name?: string | null;
  location_address?: string | null;
  navigation_url?: string | null;
  lead_user_id?: string | null;
  lead_name?: string | null;
  notes?: string | null;
  linked_shoot_id?: string | null;
  schedule_sync_state: string;
  schedule_sync_required: boolean;
  integration: ScheduleRecordIntegrationState;
};

export type AvailabilityRequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled_by_employee"
  | "cancelled_by_manager_admin"
  | "expired"
  | "needs_review";

export type AvailabilityRequestType =
  | "full_day_off"
  | "partial_day_off"
  | "multi_day_off"
  | "sick_illness"
  | "personal_appointment"
  | "unavailable_for_assignment"
  | "availability_restriction_update"
  | "company_holiday"
  | "manager_blocked_day"
  | "training_meeting_hold"
  | "admin_unavailable"
  | "protected_blackout";

export type LiveOperationalAbsenceState =
  | "reported_absent"
  | "excused"
  | "unexcused"
  | "pending_coverage_review";

export type AvailabilityImpactSummary = {
  affected_assignment_count: number;
  published_assignment_count: number;
  minimum_staffing_break_count: number;
  lead_coverage_break_count: number;
  protected_date_count: number;
  protected_date_severity: "soft" | "hard" | null;
  staffing_risk: "none" | "warning" | "high" | "critical";
  same_day_request: boolean;
  coverage_needed: boolean;
  escalation_required: boolean;
};

export type AvailabilityRequestRecord = {
  id: string;
  user_id: string;
  user_name: string;
  department: string;
  request_type: AvailabilityRequestType;
  human_request_type_label: string;
  starts_on: string;
  ends_on: string;
  requested_on: string;
  request_unit: "half_day" | "full_day";
  requested_hours: number;
  status: AvailabilityRequestStatus;
  human_status_label: string;
  approver_user_id?: string | null;
  approver_name?: string | null;
  decided_by_user_id?: string | null;
  decided_by_name?: string | null;
  notes?: string | null;
  reason?: string | null;
  reason_category?: string | null;
  all_day: boolean;
  partial_day: boolean;
  start_time?: string | null;
  end_time?: string | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
  impacted_assignments: Array<{
    assignment_id?: string | null;
    shift_id?: string | null;
    shoot_id?: string | null;
    shoot_code?: string | null;
    title: string;
    starts_at?: string | null;
    ends_at?: string | null;
    location_name?: string | null;
    published: boolean;
    breaks_minimum_staffing: boolean;
    breaks_lead_coverage: boolean;
  }>;
  staffing_impact_summary: AvailabilityImpactSummary;
  coverage_found: boolean;
  crosses_protected_date: boolean;
  protected_date_severity: "soft" | "hard" | null;
  live_operational_absence_state: LiveOperationalAbsenceState | null;
  warning_level: "low" | "medium" | "high" | "critical";
  requested_recurring_rule?: Record<string, unknown> | null;
};

export type UnifiedScheduleAvailabilityItem = {
  item_kind: "availability";
  id: string;
  date_key: string;
  title: string;
  department: string;
  availability_kind: "request" | "blocked_date" | "absence";
  status: AvailabilityRequestStatus | "blocked";
  starts_at?: string | null;
  ends_at?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  location_name?: string | null;
  request_type?: string | null;
  reason_category?: string | null;
  note?: string | null;
  warning_level: "low" | "medium" | "high" | "critical";
  impacted_assignment_count: number;
  minimum_staffing_break_count: number;
  lead_coverage_break_count: number;
  coverage_found: boolean;
  protected_date_severity: "soft" | "hard" | null;
  live_operational_absence_state: string | null;
  badge_label?: string | null;
};

export type UnifiedScheduleItem =
  | UnifiedScheduleShootItem
  | UnifiedScheduleEventItem
  | UnifiedScheduleAvailabilityItem;

export type UnifiedScheduleCalendarResponse = {
  anchor_date: string;
  window: "today" | "3day" | "week" | "30day";
  range: {
    start_date: string;
    end_date: string;
  };
  sync: ScheduleSyncSummary;
  items: UnifiedScheduleItem[];
};

export type UnifiedScheduleBoardResponse = {
  anchor_date: string;
  window: "today" | "3day" | "week" | "30day";
  group_by: "status" | "department" | "lead_photographer" | "day_part";
  groups: Array<{
    key: string;
    label: string;
    shoots: UnifiedScheduleShootItem[];
  }>;
};

export type StaffingDashboardMember = {
  user_id: string;
  name: string;
  title: string;
  status: string;
  current_assignment: string | null;
  time_window: string | null;
  quick_note: string | null;
  lead_qualified: boolean;
};

export type StaffingDashboardCoverageRow = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  department: string;
  location_label: string;
  time_label: string;
  assigned_staff_count: number;
  planned_staff_count: number;
  required_lead_count: number;
  lead_coverage_count: number;
  lead_present: boolean;
  lead_name: string | null;
  missing_lead: boolean;
  under_staffed: boolean;
  conflict_warning_count: number;
  sync_state: string;
  priority_label?: ShootPriorityLabel | null;
  priority_label_display?: string | null;
  priority_reasons?: Array<{ label: string; detail: string }>;
  next_action: string;
};

export type StaffingDashboardResponse = {
  generated_at?: string;
  anchor_date: string;
  summary: {
    shoots_today: number;
    shoots_tomorrow: number;
    open_staffing_slots: number;
    shoots_missing_lead: number;
    understaffed_shoots: number;
    conflict_warnings: number;
    available_staff_today: number;
    unavailable_staff_today: number;
  };
  open_coverage: StaffingDashboardCoverageRow[];
  missing_lead: StaffingDashboardCoverageRow[];
  availability_groups: Array<{
    key: string;
    label: string;
    count: number;
    staff: StaffingDashboardMember[];
  }>;
};

export type StaffingCandidateOption = {
  user_id: string;
  name: string;
  title: string;
  status: string;
  short_reason: string | null;
  before_label: string | null;
  during_label: string | null;
  after_label: string | null;
  availability_state: "current_assignment" | "best_available" | "warning" | "conflicted_override" | "unavailable";
  requires_override: boolean;
  disabled: boolean;
  calendar_conflict_status?: "clear" | "warning" | "blocking";
  calendar_conflict_detail?: Record<string, unknown> | null;
};

export type ShootStaffingSlot = {
  slot_key: string;
  requirement_id: string | null;
  source_of_creation: string;
  label: string;
  staffing_role: string;
  satisfies_lead_coverage: boolean;
  lead_eligible: boolean;
  lead_required: boolean;
  required_for_ready: boolean;
  is_required_slot: boolean;
  minimum_count: number;
  ideal_count: number;
  call_time: string | null;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  location_address: string | null;
  required_qualification_tags: string[];
  notes: string | null;
  assigned_shift_id: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_title: string | null;
  shift_status: string | null;
  assignment_status: "draft" | "open" | "assigned" | "active" | "completed" | "cancelled";
  assignment_source: string | null;
  reassignment_history: Array<{
    action: string;
    actor_user_id: string | null;
    actor_name: string | null;
    changed_at: string;
    reason: string | null;
    from_user_id: string | null;
    from_user_name: string | null;
    to_user_id: string | null;
    to_user_name: string | null;
  }> | null;
  option_groups: Array<{
    key: "current_assignment" | "best_available" | "warning" | "conflicted_override" | "unavailable";
    label: string;
    options: StaffingCandidateOption[];
  }>;
  warnings: string[];
};

export type StaffingRequirementResponse = {
  requirement_id: string;
  source_of_creation: string;
  source_of_creation_display: string;
  staffing_role: string;
  label: string;
  minimum_count: number;
  ideal_count: number;
  required_for_ready: boolean;
  lead_eligible: boolean;
  lead_required: boolean;
  call_offset_minutes: number;
  start_offset_minutes: number;
  end_offset_minutes: number;
  location_name_override: string | null;
  location_address_override: string | null;
  required_qualification_tags: string[];
  notes: string | null;
  sort_order: number;
  assigned_count: number;
  open_count: number;
};

export type ShootStaffingSnapshot = {
  shoot: {
    id: string;
    shoot_code: string;
    title: string;
    shoot_date: string;
    department: string;
    shoot_category?: "sports" | "schools" | "events" | "studio" | null;
    location_name: string | null;
    location_address: string | null;
    arrival_time: string | null;
    start_time: string | null;
    end_time_est: string | null;
    planned_staff_count: number;
    minimum_staff_count: number;
    assigned_staff_count: number;
    required_lead_count: number;
    lead_coverage_count: number;
    lead_name: string | null;
    operations_priority?: "standard" | "elevated" | "high_priority" | null;
    big_shoot_manual_override?: boolean;
    special_equipment?: string | null;
    conflict_warning_count: number;
    draft_shift_count: number;
    published_shift_count: number;
    schedule_sync_state: string;
    schedule_sync_required: boolean;
    staffing_state: string;
    staffing_state_display: string;
    staffing_clean_for_ready: boolean;
    staffing_hard_blockers: string[];
    staffing_warnings: string[];
    open_slot_count: number;
    open_required_slot_count: number;
    priority_label?: ShootPriorityLabel | null;
    priority_label_display?: string | null;
    priority_reasons?: Array<{ label: string; detail: string }>;
    future_profitability_flag?: "favorable" | "neutral" | "watch" | "needs_review" | null;
    future_profitability_display?: string | null;
    publish_state: "draft" | "ready_to_publish" | "published";
    under_staffed: boolean;
    over_staffed: boolean;
    missing_lead: boolean;
  };
  warnings: string[];
  requirements: StaffingRequirementResponse[];
  slots: ShootStaffingSlot[];
  approval_summary: OperationalApprovalSourceSummary;
};

export type StaffingTemplateRole = {
  id?: string;
  staffing_role: string;
  label: string;
  headcount: number;
  satisfies_lead_coverage: boolean;
  minimum_count?: number;
  ideal_count?: number;
  required_for_ready?: boolean;
  lead_eligible?: boolean;
  lead_required?: boolean;
  call_offset_minutes?: number;
  start_offset_minutes?: number;
  end_offset_minutes?: number;
  location_name_override?: string | null;
  location_address_override?: string | null;
  required_qualification_tags?: string[];
  role_notes?: string | null;
  sort_order?: number;
};

export type StaffingTemplateRecord = {
  id: string;
  department: string;
  name: string;
  description?: string | null;
  planned_staff_count: number;
  minimum_staff_count?: number;
  required_lead_count: number;
  roles: StaffingTemplateRole[];
};

export type ShootContactReference = {
  label: string;
  name: string;
  phone: string | null;
  email: string | null;
  source_kind: string;
  source_label: string;
  location_id: string | null;
  last_used_at: string | null;
};

export type ShootReferenceDataResponse = {
  contacts: ShootContactReference[];
};

export type CanonicalLeadershipReportId =
  | "executive_overview"
  | "shoot_operations_health"
  | "staffing_attendance"
  | "production_qa_health"
  | "customer_relationship_follow_through"
  | "location_intelligence_repeat_issues"
  | "workflow_compliance_data_quality";

export type LegacyLeadershipReportAliasId =
  | "todays_operations_summary"
  | "weekly_labor_summary"
  | "attendance_exceptions_report"
  | "unfilled_shifts_report"
  | "late_no_show_trend"
  | "post_shoot_evaluation_summary"
  | "location_issue_tracker"
  | "big_shoot_readiness_report"
  | "calendar_staffing_overview"
  | "open_approvals_report"
  | "operational_intelligence_report"
  | "zendesk_operational_summary"
  | "monday_migration_progress_report";

export type LeadershipReportId = CanonicalLeadershipReportId | LegacyLeadershipReportAliasId;

export type LeadershipReportLayer =
  | "live_operational_dashboard"
  | "management_trend_dashboard"
  | "strategic_seasonal_dashboard";

export type LeadershipReportFreshnessState = "live" | "recently_updated" | "daily_computed" | "needs_refresh";

export type LeadershipReportTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";

export type LeadershipReportFreshness = {
  state: LeadershipReportFreshnessState;
  label: string;
  last_updated_at: string;
  data_latency: "live" | "near_real_time" | "daily_computed";
  current_day_may_be_incomplete: boolean;
};

export type LeadershipSavedView = {
  id: string;
  label: string;
  summary: string;
  report_id: CanonicalLeadershipReportId;
  window:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date"
    | "custom";
  date_from?: string | null;
  date_to?: string | null;
  department?: string | null;
  source_module?: "reporting_dashboard" | "schedule" | "staffing" | "attendance_review" | "production_tracker" | "relationship_follow_through" | "directory_review";
  visibility?: "private" | "team_role_shared" | "department_shared" | "leadership_shared" | "company_shared";
  owner_user_id?: string | null;
  owner_name?: string | null;
  department_code?: string | null;
  is_default?: boolean;
  is_pinned?: boolean;
  system_defined?: boolean;
  share_hash?: string;
  grouping_state?: string[];
  sort_state?: string[];
  column_state?: string[];
  scope_state?: Record<string, unknown>;
  updated_at?: string;
};

export type LeadershipPacketSectionConfig = {
  report_id: CanonicalLeadershipReportId;
  enabled: boolean;
  title?: string | null;
};

export type LeadershipPacketNarrativeObservation = {
  id: string;
  tone: "steady" | "watch" | "risk";
  text: string;
};

export type LeadershipPacketActionItem = {
  id: string;
  title: string;
  detail: string;
  action_hash: string | null;
};

export type LeadershipPacketPayloadSection = {
  report_id: CanonicalLeadershipReportId;
  title: string;
  summary_line: string;
  filter_summary: Array<{ label: string; value: string }>;
  freshness: LeadershipReportFreshness | null;
  top_metrics: LeadershipReportMetric[];
  observations: LeadershipPacketNarrativeObservation[];
  exception_rows: Array<{
    id: string;
    primary: string;
    secondary: string | null;
    chips: Array<{ label: string; tone?: string }>;
    next_action: string | null;
    action_hash: string | null;
  }>;
};

export type LeadershipPacketPayload = {
  title: string;
  audience: string;
  date_range_label: string;
  run_timestamp: string;
  freshness_note: string;
  summary_strip: LeadershipReportMetric[];
  observations: LeadershipPacketNarrativeObservation[];
  sections: LeadershipPacketPayloadSection[];
  action_sections: Array<{
    id: string;
    title: string;
    items: LeadershipPacketActionItem[];
  }>;
};

export type LeadershipPacketTemplateRecord = {
  id: string;
  name: string;
  audience: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  visibility: "private" | "team_role_shared" | "department_shared" | "leadership_shared" | "company_shared";
  default_window: LeadershipSavedView["window"];
  department_code: string | null;
  section_config: LeadershipPacketSectionConfig[];
  system_defined: boolean;
  is_pinned: boolean;
  updated_at: string;
};

export type LeadershipPacketRunRecord = {
  id: string;
  run_label: string;
  source_type: "packet_template" | "saved_view";
  template_id: string | null;
  template_name: string | null;
  saved_view_id: string | null;
  saved_view_name: string | null;
  schedule_id: string | null;
  anchor_date: string;
  date_from: string | null;
  date_to: string | null;
  summary_snapshot: LeadershipReportMetric[];
  freshness_snapshot: LeadershipReportFreshness | null;
  recipient_snapshot: Array<{ user_id: string; name: string | null; email: string | null }>;
  delivery_result: Record<string, unknown>;
  record_count: number | null;
  status: "completed" | "failed";
  pdf_reference: string | null;
  created_at: string;
  completed_at: string;
  packet_payload: LeadershipPacketPayload | null;
};

export type ReportingExportJobRecord = {
  id: string;
  export_name: string;
  source_module: LeadershipSavedView["source_module"];
  report_id: string | null;
  format: "csv" | "pdf" | "link";
  status: "requested" | "completed" | "failed";
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  requested_at: string;
  completed_at: string | null;
  record_count: number | null;
  file_reference: string | null;
  error_message: string | null;
  freshness_snapshot: LeadershipReportFreshness | null;
  filter_summary: Array<{ label: string; value: string }>;
};

export type LeadershipDeliveryRecipientOption = {
  id: string;
  full_name: string;
  email: string;
  department: string;
  authority_tier: string | null;
};

export type LeadershipDeliveryScheduleRecord = {
  id: string;
  label: string;
  source_type: "packet_template" | "saved_view";
  template_id: string | null;
  template_name: string | null;
  saved_view_id: string | null;
  saved_view_name: string | null;
  cadence: "weekly" | "daily" | "monthly";
  day_of_week: number;
  hour_local: number;
  minute_local: number;
  timezone: string;
  delivery_channel: "in_app_summary" | "email_link";
  active_status: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  recipient_snapshot: Array<{ user_id: string; name: string | null; email: string | null }>;
  updated_at: string;
};

export type ReportingDeliveryCenter = {
  generated_at: string;
  anchor_date: string;
  saved_views: LeadershipSavedView[];
  packet_templates: LeadershipPacketTemplateRecord[];
  recent_packet_runs: LeadershipPacketRunRecord[];
  export_history: ReportingExportJobRecord[];
  delivery_schedules: LeadershipDeliveryScheduleRecord[];
  recipient_options: LeadershipDeliveryRecipientOption[];
};

export type LeadershipReportMetric = {
  id?: string;
  label: string;
  value: string | number;
  tone?: LeadershipReportTone;
  detail?: string | null;
  definition?: string | null;
  action_hash?: string | null;
};

export type LeadershipReportRow = {
  id: string;
  primary: string;
  secondary?: string | null;
  chips?: Array<{ label: string; tone?: LeadershipReportTone }>;
  values?: Array<{ label: string; value: string | number; tone?: LeadershipReportTone }>;
  next_action?: string | null;
  action_hash?: string | null;
};

export type LeadershipReportSection = {
  id: string;
  title: string;
  summary?: string | null;
  metrics?: LeadershipReportMetric[];
  rows?: LeadershipReportRow[];
  action_hash?: string | null;
};

export type LeadershipReportDetailPanel = {
  title: string;
  summary?: string | null;
  items: Array<{
    label: string;
    value: string;
    helper?: string | null;
  }>;
};

export type LeadershipReportDetail = {
  id: LeadershipReportId;
  title: string;
  layer?: LeadershipReportLayer;
  audience: string;
  formats: {
    onscreen: true;
    pdf: boolean;
    csv: boolean;
  };
  summary_line: string;
  tone: LeadershipReportTone;
  leadership_only: boolean;
  generated_at: string;
  freshness?: LeadershipReportFreshness;
  filter_summary?: Array<{ label: string; value: string }>;
  top_summary?: LeadershipReportMetric[];
  trend_cards?: LeadershipReportMetric[];
  exception_sections?: LeadershipReportSection[];
  drilldown_sections?: LeadershipReportSection[];
  detail_panel?: LeadershipReportDetailPanel;
  metrics: LeadershipReportMetric[];
  sections: LeadershipReportSection[];
};

export type LeadershipReportCard = {
  id: CanonicalLeadershipReportId;
  title: string;
  layer: LeadershipReportLayer;
  audience: string;
  summary_line: string;
  tone: LeadershipReportTone;
  action_needed_count: number;
  default_window:
    | "today"
    | "yesterday"
    | "last_7_days"
    | "last_30_days"
    | "last_90_days"
    | "season_to_date"
    | "year_to_date";
  freshness_state: LeadershipReportFreshnessState;
  export_pdf: boolean;
  export_csv: boolean;
};

export type BigShootUpcomingCard = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  location_label: string;
  priority_label: ShootPriorityLabel;
  priority_display: string;
  readiness_label: "On Track" | "Needs Attention" | "At Risk";
  readiness_reason: string;
  profitability_display: string | null;
  prep_due_label: string | null;
  reason_chips: Array<{ label: string; detail: string }>;
};

export type LeadershipReportsIndex = {
  generated_at: string;
  anchor_date: string;
  freshness: LeadershipReportFreshness;
  summary_strip: LeadershipReportMetric[];
  saved_views: LeadershipSavedView[];
  scheduled_summaries: Array<{
    id: string;
    label: string;
    cadence: string;
    audience: string;
  }>;
  big_shoots_coming_up: {
    summary_line: string;
    items: BigShootUpcomingCard[];
  };
  reports: LeadershipReportCard[];
};

export type OutlookCalendarAccount = {
  id: string;
  tenant_id: string;
  provider_mode: "mock" | "graph_stub" | "graph_live";
  connection_status: "connected" | "disconnected" | "attention";
  health_state: "mock" | "disconnected" | "connected_pending_sync" | "connected_healthy" | "connected_warning" | "connected_error";
  connected_as: string | null;
  connection_label: string;
  degraded_reason?: string | null;
  last_error_message?: string | null;
  last_sync_at: string | null;
  last_failed_sync_at?: string | null;
  records_synced: number;
  warning_count: number;
  error_count: number;
};

export type OutlookCalendar = {
  id: string;
  name: string;
  color_hex: string;
  is_primary: boolean;
  owner_label: string | null;
  visible_in_app: boolean;
  scheduling_impact_enabled: boolean;
  overlaps_with_shoots: boolean;
  upcoming_count: number;
};

export type OutlookCalendarVisibilityPreference = {
  calendar_id: string;
  visible_in_app: boolean;
};

export type OutlookMailFolder = {
  id: string;
  display_name: string;
  unread_count: number;
  flagged_count: number;
  important_count: number;
};

export type OutlookCalendarEvent = {
  id: string;
  calendar_id: string;
  calendar_name: string;
  calendar_color_hex: string;
  subject: string;
  starts_at: string;
  ends_at: string;
  organizer: string;
  location: string;
  overlaps_with_shoots: boolean;
  scheduling_impact: boolean;
  preview_note: string;
  web_link?: string | null;
  shoot_id?: string | null;
  shoot_code?: string | null;
  location_intelligence?: ShootLocationIntelligence | null;
};

export type OutlookMessage = {
  id: string;
  folder_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  preview: string;
  received_at: string;
  unread: boolean;
  flagged: boolean;
  important: boolean;
  convertible_to_alert: boolean;
  matching_hint?: string | null;
};

export type OutlookCalendarSyncError = {
  code: string;
  message: string;
  scope: string;
  occurred_at: string;
};

export type OutlookCalendarSyncRun = {
  id: string;
  provider_mode?: "mock" | "graph_stub" | "graph_live";
  started_at: string;
  finished_at: string | null;
  status: "success" | "warning" | "error";
  records_synced: number;
  warnings: string[];
  errors: OutlookCalendarSyncError[];
};

export type OutlookCalendarStatusPayload = {
  account: OutlookCalendarAccount;
  graph_stub: OutlookCalendarAccount;
  sync_runs: OutlookCalendarSyncRun[];
};

export type OutlookCalendarConnectResponse = OutlookCalendarStatusPayload & {
  connect_mode: "mock" | "oauth_redirect" | "connected";
  authorization_url?: string | null;
};

export type OutlookAccount = OutlookCalendarAccount;
export type OutlookEvent = OutlookCalendarEvent;
export type OutlookSyncError = OutlookCalendarSyncError;
export type OutlookSyncRun = OutlookCalendarSyncRun;
export type OutlookStatusPayload = OutlookCalendarStatusPayload;
export type OutlookConnectResponse = OutlookCalendarConnectResponse;

export type TrainingReadinessState = "cleared" | "cleared_with_oversight" | "not_cleared" | "retraining_required";

export type TrainingModuleStatus = "not_started" | "in_progress" | "completed" | "overdue" | "needs_review";

export type TrainingSignoffStatus = "pending" | "complete" | "not_required";

export type TrainingIdentity = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[];
  employment_status: string;
};

export type TrainingWorkbook = {
  id: string;
  title: string;
  summary: string;
  version: string;
  updated_at: string;
  sections: TrainingSection[];
};

export type TrainingSection = {
  id: string;
  title: string;
  summary: string;
  sort_order: number;
  module_ids: string[];
};

export type TrainingContentBlock = {
  id: string;
  type: "overview" | "checklist" | "scenario" | "callout";
  title: string;
  body: string;
  bullets?: string[];
};

export type TrainingModule = {
  id: string;
  section_id: string;
  title: string;
  summary: string;
  estimated_minutes: number;
  required: boolean;
  signoff_required: boolean;
  last_updated: string;
  version: string;
  content_blocks: TrainingContentBlock[];
  checkpoint_ids: string[];
  acknowledgement_ids: string[];
  question_ids: string[];
};

export type TrainingCheckpoint = {
  id: string;
  module_id: string;
  title: string;
  summary: string;
  required_for_clearance: boolean;
};

export type TrainingAcknowledgement = {
  id: string;
  module_id: string;
  title: string;
  summary: string;
};

export type TrainingQuizChoice = {
  id: string;
  label: string;
  correct: boolean;
  explanation: string;
};

export type TrainingQuizQuestion = {
  id: string;
  module_id: string;
  roles: string[];
  prompt: string;
  scenario: string;
  choices: TrainingQuizChoice[];
};

export type TrainingQuizRound = {
  id: string;
  mode: "dashboard" | "profile" | "module";
  title: string;
  module_id?: string | null;
  question_ids: string[];
  pass_threshold: number;
  best_score: number;
  streak_placeholder: number;
};

export type TrainingQuizAttempt = {
  id: string;
  round_title: string;
  module_id?: string | null;
  played_at: string;
  score_percent: number;
  passed: boolean;
  correct_count: number;
  question_count: number;
  missed_question_ids: string[];
};

export type EmployeeTrainingModuleProgress = {
  module_id: string;
  status: TrainingModuleStatus;
  progress_percent: number;
  due_at?: string | null;
  last_started_at?: string | null;
  completed_at?: string | null;
  best_score?: number | null;
  signoff_status: TrainingSignoffStatus;
  acknowledgement_complete: boolean;
  version_completed?: string | null;
};

export type EmployeeCheckpointResult = {
  checkpoint_id: string;
  status: "pass" | "attention" | "pending";
  notes: string;
  reviewed_at?: string | null;
};

export type EmployeeAcknowledgementState = {
  acknowledgement_id: string;
  acknowledged: boolean;
  acknowledged_at?: string | null;
};

export type EmployeeTrainingProfile = {
  employee: TrainingIdentity;
  assigned_learning_path: string;
  onboarding_stage: string;
  readiness_state: TrainingReadinessState;
  readiness_note: string;
  workbook_progress_percent: number;
  required_progress_percent: number;
  optional_progress_percent: number;
  manager_signoff_status: TrainingSignoffStatus;
  modules: EmployeeTrainingModuleProgress[];
  quiz_history: TrainingQuizAttempt[];
  checkpoints: EmployeeCheckpointResult[];
  acknowledgements: EmployeeAcknowledgementState[];
  last_completed_at?: string | null;
  oversight_note?: string | null;
};

export type TrainingRecentCompletion = {
  employee_name: string;
  module_title: string;
  completed_at: string;
};

export type TrainingRecentSignoff = {
  employee_name: string;
  module_title: string;
  signed_off_by: string;
  signed_off_at: string;
};

export type TrainingOverdueRecord = {
  employee_name: string;
  module_title: string;
  due_at: string;
  readiness_state: TrainingReadinessState;
};

export type TrainingTeamCompletion = {
  team: string;
  completion_percent: number;
  cleared_count: number;
  total_count: number;
};

export type TrainingDashboardSnapshot = {
  org_completion_percent: number;
  required_completion_percent: number;
  optional_completion_percent: number;
  overdue_module_count: number;
  not_cleared_count: number;
  oversight_count: number;
  retraining_required_count: number;
  new_hires_in_onboarding: number;
  recent_completions: TrainingRecentCompletion[];
  recent_quiz_scores: Array<{ employee_name: string; score_percent: number; played_at: string }>;
  recent_signoffs: TrainingRecentSignoff[];
  most_overdue_modules: TrainingOverdueRecord[];
  completion_by_team: TrainingTeamCompletion[];
};

export type TrainingEmployeeSummary = {
  identity: TrainingIdentity;
  readiness_state: TrainingReadinessState;
  readiness_note: string;
  onboarding_stage: string;
  workbook_progress_percent: number;
  required_progress_percent: number;
  optional_progress_percent: number;
  overdue_module_count: number;
  needs_signoff: boolean;
  next_module_title: string;
};

export type TrainingCatalogResponse = {
  workbook: TrainingWorkbook;
  modules: TrainingModule[];
  acknowledgements: TrainingAcknowledgement[];
};

export type TrainingQuizRoundResponse = {
  round: TrainingQuizRound;
  questions: TrainingQuizQuestion[];
};

export type TrainingQuizSubmitResponse = {
  profile: EmployeeTrainingProfile;
  attempt: TrainingQuizAttempt;
  questions: TrainingQuizQuestion[];
};

export type ZendeskProviderMode = "mock" | "zendesk_live";
export type ZendeskConnectionStatus = "connected" | "disconnected" | "attention";
export type ZendeskHealthState = "mock" | "disabled" | "connected_pending_sync" | "connected_healthy" | "connected_warning" | "connected_error";
export type ZendeskTicketCategory = "schools" | "sports" | "other";

export type ZendeskConnection = {
  id: string;
  tenant_id: string;
  provider_mode: ZendeskProviderMode;
  connection_status: ZendeskConnectionStatus;
  health_state: ZendeskHealthState;
  connected_account_email: string | null;
  connection_label: string;
  live_enabled: boolean;
  demo_mode: boolean;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  records_synced: number;
  warning_count: number;
  error_count: number;
  stale_sync: boolean;
  last_error_message?: string | null;
};

export type ZendeskSyncError = {
  code: string;
  message: string;
  scope: string;
  occurred_at: string;
};

export type ZendeskSyncRun = {
  id: string;
  provider_mode: ZendeskProviderMode;
  started_at: string;
  finished_at: string | null;
  status: "success" | "warning" | "error";
  records_synced: number;
  warnings: string[];
  errors: ZendeskSyncError[];
};

export type ZendeskCategoryRule = {
  id: string;
  category: ZendeskTicketCategory;
  rule_type: "tag" | "group" | "form" | "organization" | "custom_field" | "keyword";
  field_key: string | null;
  match_value: string;
  priority: number;
  enabled: boolean;
};

export type ZendeskStatusPayload = {
  connection: ZendeskConnection;
  sync_runs: ZendeskSyncRun[];
  category_rules: ZendeskCategoryRule[];
};

export type ZendeskCategoryBreakdownRow = {
  category: ZendeskTicketCategory;
  total_count: number;
  open_count: number;
  resolved_count: number;
  unassigned_count: number;
};

export type ZendeskLeadershipSummary = {
  connection: ZendeskConnection;
  kpis: {
    open_tickets: number;
    new_tickets_this_week: number;
    resolved_tickets_this_week: number;
    unassigned_tickets: number;
    median_first_reply_minutes: number | null;
    median_resolution_minutes: number | null;
    oldest_open_tickets: number;
  };
  comparisons: {
    new_tickets_week_over_week: number | null;
    resolved_tickets_week_over_week: number | null;
    open_backlog_change: number | null;
    first_reply_change_minutes: number | null;
    resolution_change_minutes: number | null;
  };
  queue_health: {
    total_open: number;
    aging_buckets: Array<{ label: string; count: number }>;
    status_breakdown: Array<{ status: string; count: number }>;
  };
  category_breakdown: ZendeskCategoryBreakdownRow[];
  flags: {
    backlog_rising: boolean;
    reply_time_degrading: boolean;
    unusual_ticket_spike: boolean;
  };
};

export type ZendeskTrendPoint = {
  metric_date: string;
  label: string;
  opened_count: number;
  resolved_count: number;
  open_backlog_count: number;
  median_first_reply_minutes: number | null;
  median_resolution_minutes: number | null;
};

export type ZendeskLeadershipTrends = {
  connection: ZendeskConnection;
  range: "7d" | "30d" | "this_week" | "this_month";
  points: ZendeskTrendPoint[];
};

export type ZendeskTicketSummary = {
  zendesk_ticket_id: string;
  subject: string;
  requester_name: string | null;
  requester_email: string | null;
  assignee_name: string | null;
  organization_name: string | null;
  group_name: string | null;
  status: string;
  priority: string | null;
  category: ZendeskTicketCategory;
  ticket_created_at: string;
  ticket_updated_at: string;
  ticket_solved_at: string | null;
  first_reply_minutes: number | null;
  resolution_minutes: number | null;
  is_unassigned: boolean;
  external_url: string | null;
  tags: string[];
};

export type ZendeskLeadershipTicketList = {
  connection: ZendeskConnection;
  tickets: ZendeskTicketSummary[];
};

export type ZendeskTestPayload = {
  ok: boolean;
  mode: ZendeskProviderMode | "disabled";
  message: string;
};
