export type DiagnosticSeverity = "info" | "low" | "medium" | "high" | "critical";
export type DiagnosticFindingStatus = "open" | "acknowledged" | "in_review" | "resolved" | "dismissed";
export type RepairActionStatus =
  | "queued"
  | "awaiting_approval"
  | "dry_run_complete"
  | "executing"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled";
export type SyncHealthStatus = "healthy" | "warning" | "error" | "disabled";
export type SystemHealthStatus = "healthy" | "watch" | "at_risk" | "critical";
export type CoreFoundationHealthStatus = "healthy" | "warning" | "failing" | "disabled";

export type AuditEventListItem = {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  event_category: string;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  target_user_id: string | null;
  target_name: string | null;
  department_type: string | null;
  request_id: string | null;
  trace_id: string | null;
  old_values_json: Record<string, unknown> | null;
  new_values_json: Record<string, unknown> | null;
  context_json: Record<string, unknown> | null;
  result: string;
  created_at: string;
  message: string;
};

export type DiagnosticFindingListItem = {
  id: string;
  tenant_id: string;
  finding_type: string;
  severity: DiagnosticSeverity;
  status: DiagnosticFindingStatus;
  resource_type: string | null;
  resource_id: string | null;
  related_resource_type: string | null;
  related_resource_id: string | null;
  department_type: string | null;
  title: string;
  description: string;
  rule_key: string;
  detected_at: string;
  owner_user_id: string | null;
  owner_name: string | null;
  recommended_action: string | null;
  repairable: boolean;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  department_label: string | null;
};

export type RepairActionListItem = {
  id: string;
  tenant_id: string;
  action_key: string;
  resource_type: string;
  resource_id: string | null;
  requested_by_user_id: string;
  approved_by_user_id: string | null;
  executed_by_user_id: string | null;
  status: RepairActionStatus;
  dry_run: boolean;
  input_json: Record<string, unknown> | null;
  before_snapshot_json: Record<string, unknown> | null;
  after_snapshot_json: Record<string, unknown> | null;
  result_summary_json: Record<string, unknown> | null;
  created_at: string;
  executed_at: string | null;
  rolled_back_at: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  executed_by_name: string | null;
};

export type SyncHealthRecord = {
  id: string;
  tenant_id: string;
  sync_key: string;
  resource_type: string | null;
  resource_id: string | null;
  status: SyncHealthStatus;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SystemHealthCheckRecord = {
  id: string;
  tenant_id: string;
  check_key: string;
  scope_type: string;
  scope_value: string | null;
  status: SystemHealthStatus;
  summary: string;
  details_json: Record<string, unknown> | null;
  checked_at: string;
  created_at: string;
};

export type PolicyDecisionTraceListItem = {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  actor_name: string | null;
  permission_key: string;
  resource_type: string | null;
  resource_id: string | null;
  scope_context_json: Record<string, unknown>;
  decision: string;
  decision_reason: string;
  matched_rules_json: Record<string, unknown> | null;
  created_at: string;
};

export type ImportAuditListItem = {
  id: string;
  tenant_id: string;
  import_type: string;
  started_by_user_id: string;
  started_by_name: string | null;
  status: string;
  source_reference: string | null;
  row_count_total: number | null;
  row_count_created: number | null;
  row_count_updated: number | null;
  row_count_rejected: number | null;
  errors_json: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
};

export type ExportAuditListItem = {
  id: string;
  tenant_id: string;
  export_type: string;
  requested_by_user_id: string;
  requested_by_name: string | null;
  status: string;
  scope_summary_json: Record<string, unknown>;
  row_count: number | null;
  column_keys_json: string[] | null;
  file_reference: string | null;
  created_at: string;
  completed_at: string | null;
};

export type TraceTimelineItem = {
  id: string;
  kind: "activity" | "audit" | "finding" | "repair" | "alert" | "policy";
  created_at: string;
  title: string;
  message: string;
  actor_name: string | null;
  severity: DiagnosticSeverity | null;
  status: string | null;
  resource_type: string | null;
  resource_id: string | null;
  old_values_json: Record<string, unknown> | null;
  new_values_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
};

export type EntityTraceResponse = {
  resource_type: string;
  resource_id: string;
  resource_label: string;
  timeline: TraceTimelineItem[];
};

export type DiagnosticsWorkspaceResponse = {
  summary: {
    active_critical_findings: number;
    open_repairs: number;
    sync_failures: number;
    recent_import_failures: number;
    recent_export_count: number;
    last_scan_at: string | null;
  };
  finding_counts: {
    open_count: number;
    repairable_count: number;
    critical_count: number;
  };
  health_checks: SystemHealthCheckRecord[];
  sync_health: SyncHealthRecord[];
  recent_findings: DiagnosticFindingListItem[];
  recent_repairs: RepairActionListItem[];
  recent_audit_events: AuditEventListItem[];
  recent_policy_traces: PolicyDecisionTraceListItem[];
  recent_imports: ImportAuditListItem[];
  recent_exports: ExportAuditListItem[];
};

export type CoreFoundationFeatureFlags = {
  diagnostics_enabled: boolean;
  workflow_engine_enabled: boolean;
  operational_events_enabled: boolean;
  global_search_enabled: boolean;
  activity_timeline_enabled: boolean;
  admin_configuration_enabled: boolean;
  approval_framework_enabled: boolean;
  reporting_enabled: boolean;
};

export type CoreFoundationValidationIssue = {
  area: string;
  severity: "warning" | "error";
  code: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type CoreFoundationHealthCheck = {
  area: string;
  status: CoreFoundationHealthStatus;
  summary: string;
  detail_count: number;
  last_event_at: string | null;
  details: Record<string, unknown>;
};

export type CoreFoundationDiagnosticsResponse = {
  generated_at: string;
  feature_flags: CoreFoundationFeatureFlags;
  startup_validation: {
    valid: boolean;
    issues: CoreFoundationValidationIssue[];
  };
  health_checks: CoreFoundationHealthCheck[];
  recent_events: AuditEventListItem[];
};

export type CommunicationFeatureFlags = {
  diagnostics_enabled: boolean;
  identity_linking_enabled: boolean;
  teams_messaging_enabled: boolean;
  teams_meetings_enabled: boolean;
  in_app_actions_enabled: boolean;
  teams_embedded_entry_points_enabled: boolean;
};

export type CommunicationValidationIssue = {
  area: string;
  severity: "warning" | "error";
  code: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type CommunicationHealthCheck = {
  area: string;
  status: CoreFoundationHealthStatus;
  summary: string;
  detail_count: number;
  last_event_at: string | null;
  details: Record<string, unknown>;
};

export type CommunicationAdminControls = {
  default_meeting_mode: "calendar_event" | "standalone_online_meeting";
  embedded_defaults: {
    max_assigned_jobs: number;
    max_assigned_tasks: number;
    max_entries: number;
  };
};

export type CommunicationDiagnosticsResponse = {
  generated_at: string;
  feature_flags: CommunicationFeatureFlags;
  admin_controls: CommunicationAdminControls;
  startup_validation: {
    valid: boolean;
    issues: CommunicationValidationIssue[];
  };
  health_checks: CommunicationHealthCheck[];
  recent_events: AuditEventListItem[];
};

export type DiagnosticRuleRunSummary = {
  run: {
    id: string;
    tenant_id: string;
    rule_key: string;
    scope_type: string;
    scope_value: string | null;
    status: string;
    started_at: string;
    completed_at: string | null;
    result_summary_json: Record<string, unknown> | null;
    trigger_type: string;
    triggered_by_user_id: string | null;
    created_at: string;
  };
  findings_created: number;
  findings_updated: number;
  findings_resolved: number;
};

export type RepairPreviewResponse = {
  repair_action: RepairActionListItem;
  preview_summary: {
    risk_level: "low" | "medium" | "high";
    reversible: boolean;
    changes: string[];
  };
};

export type RepairActionRequest = {
  action_key:
    | "job.regenerate_default_production_item"
    | "job.recompute_derived_status"
    | "diagnostics.rescan_record";
  resource_type: string;
  resource_id?: string | null;
  reason?: string | null;
  input?: Record<string, unknown> | null;
};

export type DiagnosticFindingUpdateInput = {
  status?: "acknowledged" | "resolved" | "dismissed" | null;
  owner_user_id?: string | null;
  resolution_note?: string | null;
};

export type SystemDiagnosticsView =
  | "overview"
  | "foundation"
  | "communications"
  | "diagnostics"
  | "audit"
  | "sync"
  | "repairs"
  | "access-debug"
  | "imports"
  | "exports"
  | "trace";
