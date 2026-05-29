export type Microsoft365ClientIntakeEnvironment = "development" | "staging" | "production";
export type Microsoft365ClientIntakeFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365ClientIntakeIssueSeverity = "warning" | "error";
export type Microsoft365ClientIntakeRiskSeverity = "low" | "medium" | "high";
export type Microsoft365ClientIntakeGoNoGo = "go" | "conditional_go" | "no_go";

export type Microsoft365ClientIntakeRecordType = "job" | "job_readiness_item";
export type Microsoft365ClientIntakeMappingStatus = "active" | "paused" | "archived";
export type Microsoft365ClientIntakeExceptionState = "none" | "waiting_on_client" | "paused" | "manually_overridden";
export type Microsoft365ClientIntakeSubmissionStatus =
  | "received_matched"
  | "received_unmatched"
  | "under_review"
  | "revision_requested"
  | "approved"
  | "rejected"
  | "archived";
export type Microsoft365ClientIntakeEventType =
  | "mapping_upserted"
  | "submission_received"
  | "submission_matched"
  | "submission_unmatched"
  | "reviewer_notified"
  | "reviewer_notification_failed"
  | "reviewer_assigned"
  | "client_confirmation_queued"
  | "client_confirmation_failed"
  | "reminder_queued"
  | "reminder_failed"
  | "revision_requested"
  | "exception_state_changed"
  | "escalation_queued"
  | "escalation_failed"
  | "digest_queued"
  | "digest_failed"
  | "manual_override_applied"
  | "approved"
  | "rejected"
  | "resource_linked";

export interface Microsoft365ClientIntakeValidationIssue {
  area: string;
  severity: Microsoft365ClientIntakeIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365ClientIntakeCurrentStateFinding {
  key: string;
  state: Microsoft365ClientIntakeFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365ClientIntakeRefactorItem {
  key: string;
  severity: Microsoft365ClientIntakeRiskSeverity;
  summary: string;
  consequence: string;
}

export interface Microsoft365ClientIntakeExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365ClientIntakeManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365ClientIntakeDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365ClientIntakeArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365ClientIntakeUploadArchitectureDefinition {
  upload_pattern: string;
  forms_policy: string;
  source_of_truth_rule: string;
  external_access_rule: string;
  traceability_rule: string;
  review_gate_rule: string;
}

export interface Microsoft365ClientIntakeMappingDefaultsDefinition {
  default_record_strategy: string;
  sharepoint_site_url: string;
  library_name: string;
  folder_path_pattern: string;
  request_link_policy: string;
  reviewer_resolution_rule: string;
  default_reminder_cadence_hours: number;
  default_request_mode: string;
}

export interface Microsoft365ClientIntakeMatchingRuleDefinition {
  order: number;
  key: string;
  description: string;
  confidence: "high" | "medium" | "low";
  escalation_rule: string;
}

export interface Microsoft365ClientIntakeNotificationFlowDefinition {
  provider: string;
  template_key?: string | null;
  overdue_template_key?: string | null;
  trigger_type?: string | null;
  overdue_trigger_type?: string | null;
  recipient_rule?: string | null;
  event_type?: string | null;
  channel?: string | null;
  deep_link_rule?: string | null;
  target?: string | null;
  suppression_rule?: string | null;
}

export interface Microsoft365ClientIntakeNotificationFlowsDefinition {
  client_confirmation: Microsoft365ClientIntakeNotificationFlowDefinition;
  reviewer_notification: Microsoft365ClientIntakeNotificationFlowDefinition;
  reminder_email: Microsoft365ClientIntakeNotificationFlowDefinition;
  failure_alerting: Microsoft365ClientIntakeNotificationFlowDefinition;
}

export interface Microsoft365ClientIntakeExceptionHandlingDefinition {
  unmatched_queue_rule: string;
  review_handling_rule: string;
  retry_rule: string;
  audit_rule: string;
  reconciliation_rule: string;
}

export interface Microsoft365ClientIntakeBaseline {
  phase: "phase5_secure_client_intake_mvp";
  baseline_version: string;
  environment: Microsoft365ClientIntakeEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  upload_architecture: Microsoft365ClientIntakeUploadArchitectureDefinition;
  mapping_defaults: Microsoft365ClientIntakeMappingDefaultsDefinition;
  matching_rules: Microsoft365ClientIntakeMatchingRuleDefinition[];
  notification_flows: Microsoft365ClientIntakeNotificationFlowsDefinition;
  exception_handling: Microsoft365ClientIntakeExceptionHandlingDefinition;
  execution_order: Microsoft365ClientIntakeExecutionStep[];
  manual_admin_checklist: Microsoft365ClientIntakeManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365ClientIntakeMappingRecord {
  id: string;
  tenant_id: string;
  related_record_type: Microsoft365ClientIntakeRecordType;
  related_record_id: string;
  canonical_dashboard_id: string;
  job_id: string | null;
  required_item_id: string | null;
  organization_id: string | null;
  primary_contact_id: string | null;
  department_scope: string | null;
  related_record_label: string | null;
  request_mode: string;
  request_link_url: string;
  request_link_external_id: string | null;
  sharepoint_site_url: string;
  sharepoint_library_name: string;
  sharepoint_folder_path: string;
  sharepoint_folder_url: string | null;
  forms_schema_key: string | null;
  recipient_name_override: string | null;
  recipient_email_override: string | null;
  reviewer_user_ids: string[];
  manager_user_ids: string[];
  department_lead_user_ids: string[];
  reminder_enabled: boolean;
  reminder_cadence_hours: number;
  review_due_hours: number;
  first_escalation_hours: number;
  second_escalation_hours: number;
  digest_enabled: boolean;
  last_submission_at: string | null;
  last_submission_status: Microsoft365ClientIntakeSubmissionStatus | null;
  last_submission_exception_state: Microsoft365ClientIntakeExceptionState | null;
  last_reminder_sent_at: string | null;
  last_reminder_trigger_type: string | null;
  status: Microsoft365ClientIntakeMappingStatus;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365ClientIntakeSubmissionRecord {
  id: string;
  tenant_id: string;
  mapping_id: string | null;
  related_record_type: Microsoft365ClientIntakeRecordType | null;
  related_record_id: string | null;
  canonical_dashboard_id: string | null;
  job_id: string | null;
  required_item_id: string | null;
  organization_id: string | null;
  primary_contact_id: string | null;
  request_link_external_id: string | null;
  request_link_url: string | null;
  sharepoint_site_url: string | null;
  sharepoint_library_name: string | null;
  sharepoint_folder_path: string | null;
  sharepoint_folder_url: string | null;
  provider_submission_key: string;
  microsoft_drive_id: string | null;
  microsoft_drive_item_id: string | null;
  resource_library_item_id: string | null;
  file_name: string;
  file_url: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  uploader_name: string | null;
  uploader_email: string | null;
  submitted_at: string;
  matching_status: Microsoft365ClientIntakeSubmissionStatus;
  match_rule: string | null;
  match_confidence: number;
  reviewer_user_ids: string[];
  assigned_reviewer_user_id: string | null;
  exception_state: Microsoft365ClientIntakeExceptionState;
  exception_note: string | null;
  exception_set_by_user_id: string | null;
  exception_set_at: string | null;
  review_note: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_due_at: string | null;
  first_escalation_at: string | null;
  second_escalation_at: string | null;
  escalated_at: string | null;
  escalation_level: number;
  revision_requested_by_user_id: string | null;
  revision_requested_at: string | null;
  revision_request_delivery_id: string | null;
  confirmation_delivery_id: string | null;
  metadata: Record<string, unknown>;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365ClientIntakeEventRecord {
  id: string;
  tenant_id: string;
  mapping_id: string | null;
  submission_id: string | null;
  event_type: Microsoft365ClientIntakeEventType;
  actor_user_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface Microsoft365ClientIntakeDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365ClientIntakeEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365ClientIntakeValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365ClientIntakeGoNoGo;
  };
  current_state_findings: Microsoft365ClientIntakeCurrentStateFinding[];
  refactor_first: Microsoft365ClientIntakeRefactorItem[];
  upload_architecture: Microsoft365ClientIntakeUploadArchitectureDefinition;
  mapping_defaults: Microsoft365ClientIntakeMappingDefaultsDefinition;
  matching_rules: Microsoft365ClientIntakeMatchingRuleDefinition[];
  notification_flows: Microsoft365ClientIntakeNotificationFlowsDefinition;
  exception_handling: Microsoft365ClientIntakeExceptionHandlingDefinition;
  execution_order: Microsoft365ClientIntakeExecutionStep[];
  configuration_artifacts: Microsoft365ClientIntakeArtifact[];
  governance_docs: Microsoft365ClientIntakeDocReference[];
  manual_admin_checklist: Microsoft365ClientIntakeManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface UpsertMicrosoft365ClientIntakeMappingInput {
  related_record_type: Microsoft365ClientIntakeRecordType;
  related_record_id: string;
  request_link_url: string;
  request_link_external_id?: string | null;
  sharepoint_site_url: string;
  sharepoint_library_name: string;
  sharepoint_folder_path: string;
  sharepoint_folder_url?: string | null;
  forms_schema_key?: string | null;
  recipient_name_override?: string | null;
  recipient_email_override?: string | null;
  reviewer_user_ids?: string[];
  manager_user_ids?: string[];
  department_lead_user_ids?: string[];
  reminder_enabled?: boolean;
  reminder_cadence_hours?: number;
  review_due_hours?: number;
  first_escalation_hours?: number;
  second_escalation_hours?: number;
  digest_enabled?: boolean;
  status?: Microsoft365ClientIntakeMappingStatus;
  metadata?: Record<string, unknown>;
}

export interface RecordMicrosoft365ClientIntakeSubmissionInput {
  mapping_id?: string | null;
  request_link_external_id?: string | null;
  request_link_url?: string | null;
  sharepoint_site_url?: string | null;
  sharepoint_library_name?: string | null;
  sharepoint_folder_path?: string | null;
  sharepoint_folder_url?: string | null;
  provider_submission_key?: string | null;
  microsoft_drive_id?: string | null;
  microsoft_drive_item_id?: string | null;
  file_name: string;
  file_url?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  uploader_name?: string | null;
  uploader_email?: string | null;
  submitted_at?: string | null;
  dashboard_entity_type_hint?: Microsoft365ClientIntakeRecordType | null;
  dashboard_entity_id_hint?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReviewMicrosoft365ClientIntakeSubmissionInput {
  decision: "match" | "approve" | "reject" | "request_revision";
  mapping_id?: string | null;
  target_record_type?: Microsoft365ClientIntakeRecordType | null;
  target_record_id?: string | null;
  create_mapping_from_submission?: boolean;
  note?: string | null;
  complete_required_item?: boolean;
}

export interface UpdateMicrosoft365ClientIntakeSubmissionControlInput {
  assigned_reviewer_user_id?: string | null;
  exception_state?: Microsoft365ClientIntakeExceptionState | null;
  note?: string | null;
  review_due_at?: string | null;
}

export interface SweepMicrosoft365ClientIntakeRemindersResult {
  scanned_mapping_count: number;
  reminder_queued_count: number;
  overdue_queued_count: number;
  suppressed_count: number;
  unmatched_open_count: number;
  failed_count: number;
}

export interface Microsoft365ClientIntakeOperationalQueueItem {
  submission: Microsoft365ClientIntakeSubmissionRecord;
  mapping: Microsoft365ClientIntakeMappingRecord | null;
  dashboard_url: string | null;
  related_record_label: string | null;
  organization_name: string | null;
  owner_name: string | null;
  risk_level: "low" | "medium" | "high" | "critical";
  overdue: boolean;
}

export interface Microsoft365ClientIntakeOperationsWorkspace {
  generated_at: string;
  summary: {
    open_backlog_count: number;
    review_queue_count: number;
    overdue_count: number;
    escalated_count: number;
    waiting_on_client_count: number;
    paused_count: number;
    unmatched_count: number;
    manual_override_count: number;
  };
  review_queue: Microsoft365ClientIntakeOperationalQueueItem[];
  overdue_items: Microsoft365ClientIntakeOperationalQueueItem[];
  escalated_items: Microsoft365ClientIntakeOperationalQueueItem[];
  backlog: Microsoft365ClientIntakeOperationalQueueItem[];
  exception_items: Microsoft365ClientIntakeOperationalQueueItem[];
}

export interface SweepMicrosoft365ClientIntakeOperationalControlResult {
  scanned_submission_count: number;
  review_assignment_count: number;
  escalated_count: number;
  digest_queued_count: number;
  suppressed_count: number;
  failed_count: number;
}

export interface Microsoft365ClientIntakeOperationalControlDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365ClientIntakeEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365ClientIntakeValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365ClientIntakeGoNoGo;
  };
  current_state_findings: Microsoft365ClientIntakeCurrentStateFinding[];
  refactor_first: Microsoft365ClientIntakeRefactorItem[];
  approval_workflow: Record<string, unknown>;
  escalation_rules: Record<string, unknown>;
  alerting_and_digests: Record<string, unknown>;
  exception_state_model: Record<string, unknown>;
  execution_order: Microsoft365ClientIntakeExecutionStep[];
  manual_admin_checklist: Microsoft365ClientIntakeManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
  workspace: Microsoft365ClientIntakeOperationsWorkspace;
}
