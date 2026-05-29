export type Microsoft365SmsOptimizationEnvironment = "development" | "staging" | "production";
export type Microsoft365SmsOptimizationFindingState = "existing" | "partial" | "missing" | "conflict";
export type Microsoft365SmsOptimizationIssueSeverity = "warning" | "error";
export type Microsoft365SmsOptimizationRiskSeverity = "low" | "medium" | "high";
export type Microsoft365SmsOptimizationGoNoGo = "go" | "conditional_go" | "no_go";

export type Microsoft365SmsConsentStatus = "unknown" | "opted_in" | "opted_out" | "suppressed";
export type Microsoft365SmsConsentSource = "manual_internal" | "portal_opt_in" | "client_reply" | "compliance_import";
export type Microsoft365SmsRecordType = "job" | "job_readiness_item";
export type Microsoft365SmsTriggerType = "reminder" | "overdue" | "manual";
export type Microsoft365SmsDeliveryStatus =
  | "queued"
  | "dispatching"
  | "provider_accepted"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "throttled"
  | "archived";
export type Microsoft365SmsEventType =
  | "consent_upserted"
  | "queued"
  | "dispatching"
  | "provider_accepted"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "throttled"
  | "replayed"
  | "callback_received"
  | "opted_out"
  | "alerted";

export interface Microsoft365SmsOptimizationValidationIssue {
  area: string;
  severity: Microsoft365SmsOptimizationIssueSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface Microsoft365SmsOptimizationCurrentStateFinding {
  key: string;
  state: Microsoft365SmsOptimizationFindingState;
  summary: string;
  evidence: string[];
  recommended_refactor?: string | null;
}

export interface Microsoft365SmsOptimizationRefactorItem {
  key: string;
  severity: Microsoft365SmsOptimizationRiskSeverity;
  summary: string;
  consequence: string;
}

export interface Microsoft365SmsOptimizationExecutionStep {
  order: number;
  title: string;
  owner: string;
  requires_tenant_admin: boolean;
  rollback: string;
}

export interface Microsoft365SmsOptimizationManualChecklistItem {
  order: number;
  step: string;
  portal: string | null;
  requires_tenant_admin: boolean;
  owner: string;
}

export interface Microsoft365SmsOptimizationDocReference {
  key: string;
  title: string;
  path: string;
  summary: string;
}

export interface Microsoft365SmsOptimizationArtifact {
  kind: "baseline" | "script" | "doc" | "api";
  path: string;
  summary: string;
  tenant_admin_action: boolean;
}

export interface Microsoft365SmsSenderProfileDefinition {
  sender_key: string;
  display_name: string;
  provider: "azure_communication_services" | "power_automate_sms_bridge";
  sender_number: string;
  department_scope: string | null;
  related_record_types: Microsoft365SmsRecordType[];
  trigger_types: Microsoft365SmsTriggerType[];
  notes: string | null;
}

export interface Microsoft365SmsTemplateDefinition {
  template_key: string;
  trigger_type: Microsoft365SmsTriggerType;
  department_scope: string | null;
  sender_key: string;
  body_template: string;
  allowed_tokens: string[];
  max_length: number;
  forbidden_content_rules: string[];
  notes: string;
}

export interface Microsoft365SmsFlowDefinition {
  flow_key: string;
  trigger_type: Microsoft365SmsTriggerType;
  template_key: string;
  provider: "azure_communication_services" | "power_automate_sms_bridge";
  callback_required: boolean;
  failure_alert_target: string;
  retry_rule: string;
  notes: string;
}

export interface Microsoft365SmsPolicyDefinition {
  sms_scope_rule: string;
  sensitive_content_rule: string;
  secure_link_rule: string;
  opt_in_rule: string;
  opt_out_rule: string;
  manual_override_rule: string;
  consent_retention_rule: string;
}

export interface Microsoft365SmsKpiDefinition {
  key: string;
  title: string;
  description: string;
  target_rule: string;
  data_rule: string;
}

export interface Microsoft365SmsSlaDefinition {
  key: string;
  title: string;
  description: string;
  threshold_hours: number;
  breach_rule: string;
}

export interface Microsoft365SmsOptimizationBaseline {
  phase: "phase8_sms_analytics_optimization_layer";
  baseline_version: string;
  environment: Microsoft365SmsOptimizationEnvironment;
  tenant_tier: "sandbox" | "preproduction" | "production";
  sms_policy: Microsoft365SmsPolicyDefinition;
  sender_profiles: Microsoft365SmsSenderProfileDefinition[];
  template_schema: Microsoft365SmsTemplateDefinition[];
  flow_inventory: Microsoft365SmsFlowDefinition[];
  kpi_definitions: Microsoft365SmsKpiDefinition[];
  sla_definitions: Microsoft365SmsSlaDefinition[];
  optimization_rules: {
    reminder_effectiveness_window_hours: number;
    overdue_backlog_warning_threshold: number;
    review_cycle_warning_hours: number;
    upload_turnaround_warning_hours: number;
    bottleneck_grouping_rule: string;
  };
  execution_order: Microsoft365SmsOptimizationExecutionStep[];
  manual_admin_checklist: Microsoft365SmsOptimizationManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface Microsoft365SmsConsentRecord {
  id: string;
  tenant_id: string;
  organization_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  phone_number: string;
  normalized_phone_number: string;
  consent_status: Microsoft365SmsConsentStatus;
  consent_source: Microsoft365SmsConsentSource;
  consent_captured_at: string | null;
  consent_expires_at: string | null;
  last_confirmed_at: string | null;
  suppress_until: string | null;
  opt_out_reason: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365SmsDeliveryRecord {
  id: string;
  tenant_id: string;
  provider: string;
  related_record_type: Microsoft365SmsRecordType;
  related_record_id: string;
  canonical_dashboard_id: string | null;
  job_id: string | null;
  required_item_id: string | null;
  organization_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  consent_id: string | null;
  recipient_name: string | null;
  recipient_phone_number: string;
  normalized_phone_number: string;
  sender_key: string;
  sender_number: string;
  template_key: string;
  flow_key: string;
  trigger_type: Microsoft365SmsTriggerType;
  status: Microsoft365SmsDeliveryStatus;
  message_body: string;
  dashboard_url: string | null;
  secure_link_url: string | null;
  provider_message_id: string | null;
  provider_message_url: string | null;
  flow_run_id: string | null;
  flow_run_url: string | null;
  sync_operation_id: string | null;
  source_change_key: string | null;
  attempt_count: number;
  queued_at: string;
  first_dispatched_at: string | null;
  last_dispatched_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Microsoft365SmsEventRecord {
  id: string;
  tenant_id: string;
  delivery_id: string;
  event_type: Microsoft365SmsEventType;
  actor_user_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface Microsoft365SmsKpiCard {
  key: string;
  title: string;
  description: string;
  value: number;
  unit: "count" | "hours" | "percent";
  trend: "good" | "watch" | "action";
  target_rule: string;
}

export interface Microsoft365SmsSlaCard {
  key: string;
  title: string;
  threshold_hours: number;
  breach_count: number;
  open_count: number;
  trend: "good" | "watch" | "action";
  breach_rule: string;
}

export interface Microsoft365SmsBottleneckItem {
  key: string;
  label: string;
  department_scope: string | null;
  open_backlog_count: number;
  overdue_count: number;
  review_sla_breach_count: number;
  upload_sla_breach_count: number;
  reminder_effectiveness_rate: number | null;
}

export interface Microsoft365SmsOptimizationRecommendation {
  key: string;
  severity: "info" | "warning" | "action";
  summary: string;
  evidence: Record<string, unknown>;
}

export interface Microsoft365SmsOptimizationWorkspace {
  generated_at: string;
  summary: {
    opted_in_count: number;
    opted_out_count: number;
    suppressed_consent_count: number;
    pending_delivery_count: number;
    failed_delivery_count: number;
    backlog_count: number;
    overdue_required_item_count: number;
    review_sla_breach_count: number;
    upload_sla_breach_count: number;
    reminder_effectiveness_rate: number | null;
  };
  kpi_dashboard: Microsoft365SmsKpiCard[];
  sla_dashboard: Microsoft365SmsSlaCard[];
  bottleneck_analysis: Microsoft365SmsBottleneckItem[];
  optimization_findings: Microsoft365SmsOptimizationRecommendation[];
  recent_deliveries: Array<Microsoft365SmsDeliveryRecord & { events: Microsoft365SmsEventRecord[] }>;
}

export interface Microsoft365SmsOptimizationDiagnosticsResponse {
  generated_at: string;
  baseline_environment: Microsoft365SmsOptimizationEnvironment;
  startup_validation: {
    valid: boolean;
    issues: Microsoft365SmsOptimizationValidationIssue[];
  };
  phase_audit_summary: {
    implementation_status: string;
    current_state: string;
    recommendation: Microsoft365SmsOptimizationGoNoGo;
  };
  current_state_findings: Microsoft365SmsOptimizationCurrentStateFinding[];
  refactor_first: Microsoft365SmsOptimizationRefactorItem[];
  sms_policy: Microsoft365SmsPolicyDefinition;
  sender_profiles: Microsoft365SmsSenderProfileDefinition[];
  template_schema: Microsoft365SmsTemplateDefinition[];
  flow_inventory: Microsoft365SmsFlowDefinition[];
  kpi_definitions: Microsoft365SmsKpiDefinition[];
  sla_definitions: Microsoft365SmsSlaDefinition[];
  execution_order: Microsoft365SmsOptimizationExecutionStep[];
  configuration_artifacts: Microsoft365SmsOptimizationArtifact[];
  governance_docs: Microsoft365SmsOptimizationDocReference[];
  manual_admin_checklist: Microsoft365SmsOptimizationManualChecklistItem[];
  validation_checklist: string[];
  rollback_principles: string[];
}

export interface UpsertMicrosoft365SmsConsentInput {
  contact_id?: string | null;
  phone_number: string;
  consent_status: Microsoft365SmsConsentStatus;
  consent_source: Microsoft365SmsConsentSource;
  consent_captured_at?: string | null;
  consent_expires_at?: string | null;
  suppress_until?: string | null;
  opt_out_reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface QueueMicrosoft365SmsDeliveryInput {
  related_record_type: Microsoft365SmsRecordType;
  related_record_id: string;
  template_key: string;
  trigger_type: Microsoft365SmsTriggerType;
  contact_id?: string | null;
  recipient_name?: string | null;
  recipient_phone_number?: string | null;
  secure_link_url?: string | null;
  source_change_key?: string | null;
  extra_merge_context?: Record<string, string | null>;
}

export interface RecordMicrosoft365SmsCallbackInput {
  delivery_id: string;
  status: "sent" | "delivered" | "failed" | "skipped";
  provider_message_id?: string | null;
  provider_message_url?: string | null;
  flow_run_id?: string | null;
  flow_run_url?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  opted_out?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SweepMicrosoft365SmsRemindersResult {
  scanned_mapping_count: number;
  queued_count: number;
  overdue_queued_count: number;
  suppressed_count: number;
  ineligible_count: number;
  failed_count: number;
}
