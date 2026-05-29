import type { JobDepartmentType } from "../domain/jobTruth/index.js";
import type { SharedFieldVisibilityMap, SharedSectionVisibilityMap } from "./policy.js";

type TimestampValue = string | Date;

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

export interface AuditEventRecord {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  event_category: string;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  target_user_id: string | null;
  department_type: JobDepartmentType | null;
  request_id: string | null;
  trace_id: string | null;
  old_values_json: Record<string, unknown> | null;
  new_values_json: Record<string, unknown> | null;
  context_json: Record<string, unknown> | null;
  result: string;
  created_at: TimestampValue;
}

export interface DiagnosticFindingRecord {
  id: string;
  tenant_id: string;
  finding_type: string;
  severity: DiagnosticSeverity;
  status: DiagnosticFindingStatus;
  resource_type: string | null;
  resource_id: string | null;
  related_resource_type: string | null;
  related_resource_id: string | null;
  department_type: JobDepartmentType | null;
  title: string;
  description: string;
  rule_key: string;
  detected_at: TimestampValue;
  owner_user_id: string | null;
  recommended_action: string | null;
  repairable: boolean;
  resolved_at: TimestampValue | null;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface DiagnosticRuleRunRecord {
  id: string;
  tenant_id: string;
  rule_key: string;
  scope_type: string;
  scope_value: string | null;
  status: string;
  started_at: TimestampValue;
  completed_at: TimestampValue | null;
  result_summary_json: Record<string, unknown> | null;
  trigger_type: string;
  triggered_by_user_id: string | null;
  created_at: TimestampValue;
}

export interface RepairActionRecord {
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
  created_at: TimestampValue;
  executed_at: TimestampValue | null;
  rolled_back_at: TimestampValue | null;
}

export interface SyncHealthRecord {
  id: string;
  tenant_id: string;
  sync_key: string;
  resource_type: string | null;
  resource_id: string | null;
  status: SyncHealthStatus;
  last_success_at: TimestampValue | null;
  last_failure_at: TimestampValue | null;
  failure_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface PolicyDecisionTraceRecord {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  permission_key: string;
  resource_type: string | null;
  resource_id: string | null;
  scope_context_json: Record<string, unknown>;
  decision: string;
  decision_reason: string;
  matched_rules_json: Record<string, unknown> | null;
  created_at: TimestampValue;
}

export interface SystemHealthCheckRecord {
  id: string;
  tenant_id: string;
  check_key: string;
  scope_type: string;
  scope_value: string | null;
  status: SystemHealthStatus;
  summary: string;
  details_json: Record<string, unknown> | null;
  checked_at: TimestampValue;
  created_at: TimestampValue;
}

export interface ImportAuditRecord {
  id: string;
  tenant_id: string;
  import_type: string;
  started_by_user_id: string;
  status: string;
  source_reference: string | null;
  row_count_total: number | null;
  row_count_created: number | null;
  row_count_updated: number | null;
  row_count_rejected: number | null;
  errors_json: Record<string, unknown> | null;
  created_at: TimestampValue;
  completed_at: TimestampValue | null;
}

export interface ExportAuditRecord {
  id: string;
  tenant_id: string;
  export_type: string;
  requested_by_user_id: string;
  status: string;
  scope_summary_json: Record<string, unknown>;
  row_count: number | null;
  column_keys_json: string[] | null;
  file_reference: string | null;
  created_at: TimestampValue;
  completed_at: TimestampValue | null;
}

export interface DiagnosticFindingListItem extends DiagnosticFindingRecord {
  owner_name: string | null;
  resolved_by_name: string | null;
  department_label: string | null;
}

export interface AuditEventListItem extends AuditEventRecord {
  actor_name: string | null;
  target_name: string | null;
  message: string;
}

export interface RepairActionListItem extends RepairActionRecord {
  requested_by_name: string | null;
  approved_by_name: string | null;
  executed_by_name: string | null;
}

export interface PolicyDecisionTraceListItem extends PolicyDecisionTraceRecord {
  actor_name: string | null;
}

export interface ImportAuditListItem extends ImportAuditRecord {
  started_by_name: string | null;
}

export interface ExportAuditListItem extends ExportAuditRecord {
  requested_by_name: string | null;
}

export interface TraceTimelineItem {
  id: string;
  kind: "activity" | "audit" | "finding" | "repair" | "alert" | "policy";
  created_at: TimestampValue;
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
}

export interface EntityTraceResponse {
  resource_type: string;
  resource_id: string;
  resource_label: string;
  timeline: TraceTimelineItem[];
}

export interface DiagnosticsWorkspaceSummary {
  active_critical_findings: number;
  open_repairs: number;
  sync_failures: number;
  recent_import_failures: number;
  recent_export_count: number;
  last_scan_at: string | null;
}

export interface DiagnosticsWorkspaceResponse {
  summary: DiagnosticsWorkspaceSummary;
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
}

export interface DiagnosticRuleRunSummary {
  run: DiagnosticRuleRunRecord;
  findings_created: number;
  findings_updated: number;
  findings_resolved: number;
}

export interface RepairPreviewResponse {
  repair_action: RepairActionListItem;
  preview_summary: {
    risk_level: "low" | "medium" | "high";
    reversible: boolean;
    changes: string[];
  };
}

export interface PolicyTracePreviewResponse {
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
