export type Microsoft365MailAutomationEnvironment = "development" | "staging" | "production";
export type Microsoft365MailAutomationFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365MailAutomationIssueSeverity = "warning" | "error";
export type Microsoft365MailAutomationRiskSeverity = "low" | "medium" | "high";
export type Microsoft365MailAutomationGoNoGo = "go" | "conditional_go" | "no_go";

export type Microsoft365MailAutomationRecordType =
  | "organization"
  | "job"
  | "job_readiness_item"
  | "post_shoot_evaluation"
  | "work_task"
  | "operational_approval_request"
  | "communication_event";

export type Microsoft365MailAutomationTriggerType =
  | "kickoff"
  | "reminder"
  | "overdue"
  | "confirmation"
  | "approval_request"
  | "escalation"
  | "manual";

export type Microsoft365MailTemplateStorageType = "sharepoint_file" | "sharepoint_list_item";

export type Microsoft365MailAutomationStatus =
  | "queued"
  | "dispatching"
  | "flow_accepted"
  | "sent"
  | "failed"
  | "skipped"
  | "throttled"
  | "archived";

export type Microsoft365MailAutomationEventType =
  | "queued"
  | "dispatching"
  | "flow_accepted"
  | "sent"
  | "failed"
  | "skipped"
  | "throttled"
  | "replayed"
  | "callback_received"
  | "alerted";

export interface Microsoft365MailAutomationValidationIssue {
  area: string;
  severity: Microsoft365MailAutomationIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365MailAutomationCurrentStateFinding {
  key: string;
  state: Microsoft365MailAutomationFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365MailAutomationRefactorItem {
  key: string;
  severity: Microsoft365MailAutomationRiskSeverity;
  summary: string;
  consequence: string;
}

export interface Microsoft365MailAutomationExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365MailAutomationManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365MailAutomationDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365MailAutomationArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365SharedMailboxDefinition {
  mailbox_key: string;
  display_name: string;
  alias_address: string;
  department_scope: string | null;
  mailbox_purpose: string;
  send_as_mode: "shared_mailbox";
  fallback_mailbox_key: string | null;
  owner_groups: string[];
  member_groups: string[];
  allowed_trigger_types: Microsoft365MailAutomationTriggerType[];
  notes?: string | null;
}

export interface Microsoft365SenderAliasRule {
  key: string;
  applies_to_record_types: Microsoft365MailAutomationRecordType[];
  department_scope: string | null;
  trigger_types: Microsoft365MailAutomationTriggerType[];
  shared_mailbox_key: string;
  resolution_rule: string;
  notes?: string | null;
}

export interface Microsoft365TemplateLibraryColumnDefinition {
  internal_name: string;
  display_name: string;
  field_type: string;
  required: boolean;
  dashboard_source_field: string;
  notes: string;
}

export interface Microsoft365TemplateLibraryDefinition {
  site_url: string;
  library_name: string;
  folder_path_pattern: string;
  dashboard_source_of_truth_rule: string;
  edit_model: string;
  metadata_columns: Microsoft365TemplateLibraryColumnDefinition[];
}

export interface Microsoft365MailMergeTokenDefinition {
  key: string;
  required: boolean;
  source_rule: string;
  notes: string;
}

export interface Microsoft365MailTemplateDefinition {
  template_key: string;
  template_name: string;
  template_family: string;
  department_scope: string | null;
  shared_mailbox_key: string;
  storage_provider: Microsoft365MailTemplateStorageType;
  storage_path: string;
  template_url: string;
  subject_hint: string;
  merge_tokens: Microsoft365MailMergeTokenDefinition[];
  notes: string;
}

export interface Microsoft365MailAutomationFlowDefinition {
  flow_key: string;
  trigger_type: Microsoft365MailAutomationTriggerType;
  shared_mailbox_key: string;
  template_key: string;
  related_record_types: Microsoft365MailAutomationRecordType[];
  power_automate_owner: string;
  callback_required: boolean;
  failure_alert_target: string;
  retry_rule: string;
  notes: string;
}

export interface Microsoft365MailAutomationLoggingAndMonitoringDefinition {
  queue_of_record: string;
  callback_route: string;
  failure_queue_rule: string;
  alerting_rule: string;
  retention_rule: string;
  reconciliation_rule: string;
}

export interface Microsoft365MailAutomationBaseline {
  phase: "phase4_shared_mailboxes_templates_email_automation";
  baseline_version: string;
  environment: Microsoft365MailAutomationEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  shared_mailboxes: Microsoft365SharedMailboxDefinition[];
  sender_alias_rules: Microsoft365SenderAliasRule[];
  template_library: Microsoft365TemplateLibraryDefinition;
  template_schema: Microsoft365MailTemplateDefinition[];
  flow_inventory: Microsoft365MailAutomationFlowDefinition[];
  logging_and_monitoring: Microsoft365MailAutomationLoggingAndMonitoringDefinition;
  execution_order: Microsoft365MailAutomationExecutionStep[];
  manual_admin_checklist: Microsoft365MailAutomationManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365SharedMailboxContractRecord {
  id: string;
  tenant_id: string;
  mailbox_key: string;
  display_name: string;
  alias_address: string;
  department_scope: string | null;
  mailbox_purpose: string;
  send_as_mode: string;
  fallback_mailbox_key: string | null;
  microsoft_object_id: string | null;
  microsoft_url: string | null;
  owner_metadata: Record<string, unknown>;
  active_status: boolean;
  last_sync_error: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365MailTemplateContractRecord {
  id: string;
  tenant_id: string;
  template_key: string;
  template_name: string;
  template_family: string;
  department_scope: string | null;
  shared_mailbox_key: string;
  storage_provider: Microsoft365MailTemplateStorageType;
  sharepoint_site_url: string | null;
  sharepoint_library_name: string | null;
  storage_path: string | null;
  template_url: string | null;
  subject_hint: string | null;
  merge_tokens: string[];
  required_tokens: string[];
  owner_metadata: Record<string, unknown>;
  active_status: boolean;
  last_sync_error: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365MailAutomationDeliveryRecord {
  id: string;
  tenant_id: string;
  provider: string;
  related_record_type: Microsoft365MailAutomationRecordType;
  related_record_id: string;
  canonical_dashboard_id: string | null;
  contact_id: string | null;
  recipient_name: string | null;
  recipient_email: string;
  shared_mailbox_key: string;
  sender_alias: string;
  template_key: string;
  template_url: string | null;
  flow_key: string;
  trigger_type: Microsoft365MailAutomationTriggerType;
  status: Microsoft365MailAutomationStatus;
  subject_hint: string | null;
  merge_context: Record<string, unknown>;
  dashboard_url: string | null;
  microsoft_message_id: string | null;
  microsoft_message_url: string | null;
  flow_run_id: string | null;
  flow_run_url: string | null;
  sync_operation_id: string | null;
  source_change_key: string | null;
  attempt_count: number;
  queued_at: string;
  first_dispatched_at: string | null;
  last_dispatched_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  source_object?: {
    type: Microsoft365MailAutomationRecordType;
    id: string;
    canonical_dashboard_id: string | null;
  };
  target_object?: {
    type: "microsoft365_mail_delivery";
    id: string | null;
    owner_email: string;
    recipient_email: string;
    shared_mailbox_key: string;
    provider_message_id: string | null;
    provider_message_url: string | null;
    flow_run_id: string | null;
    flow_run_url: string | null;
  };
  sync_state?: {
    last_attempted_sync_at: string | null;
    last_successful_sync_at: string | null;
    last_failed_sync_at: string | null;
    retry_state: "pending_dispatch" | "dispatching" | "awaiting_callback" | "none" | "manual_retry_required";
    provider_accepted: boolean;
    delivery_confirmed: boolean;
    callback_status: Extract<Microsoft365MailAutomationStatus, "sent" | "failed" | "skipped"> | null;
  };
}

export interface Microsoft365MailAutomationEventRecord {
  id: string;
  tenant_id: string;
  delivery_id: string;
  event_type: Microsoft365MailAutomationEventType;
  actor_user_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface QueueMicrosoft365MailAutomationDeliveryInput {
  related_record_type: Microsoft365MailAutomationRecordType;
  related_record_id: string;
  template_key: string;
  trigger_type: Microsoft365MailAutomationTriggerType;
  contact_id?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  source_change_key?: string | null;
  secure_link?: string | null;
  extra_merge_context?: Record<string, string | null | undefined>;
}

export interface ReplayMicrosoft365MailAutomationDeliveryInput {
  delivery_id: string;
}

export interface RecordMicrosoft365MailAutomationCallbackInput {
  delivery_id: string;
  status: Extract<Microsoft365MailAutomationStatus, "sent" | "failed" | "skipped">;
  provider_message_id?: string | null;
  provider_message_url?: string | null;
  flow_run_id?: string | null;
  flow_run_url?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Microsoft365MailAutomationDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365MailAutomationEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365MailAutomationValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365MailAutomationGoNoGo;
  };
  current_state_findings: Microsoft365MailAutomationCurrentStateFinding[];
  refactor_first: Microsoft365MailAutomationRefactorItem[];
  shared_mailbox_model: Microsoft365SharedMailboxDefinition[];
  sender_alias_rules: Microsoft365SenderAliasRule[];
  template_library: Microsoft365TemplateLibraryDefinition;
  template_schema: Microsoft365MailTemplateDefinition[];
  flow_inventory: Microsoft365MailAutomationFlowDefinition[];
  logging_and_monitoring: Microsoft365MailAutomationLoggingAndMonitoringDefinition;
  configuration_artifacts: Microsoft365MailAutomationArtifact[];
  governance_docs: Microsoft365MailAutomationDocReference[];
  execution_order: Microsoft365MailAutomationExecutionStep[];
  manual_admin_checklist: Microsoft365MailAutomationManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}
