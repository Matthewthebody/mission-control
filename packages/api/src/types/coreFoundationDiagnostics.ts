import type { AuditEventListItem } from "./diagnostics.js";

export type CoreFoundationArea =
  | "data_model_integrity"
  | "permissions"
  | "workflow_engine"
  | "notification_event_engine"
  | "search"
  | "activity_history"
  | "admin_configuration"
  | "approvals"
  | "reporting_services"
  | "config";

export type CoreFoundationHealthStatus = "healthy" | "warning" | "failing" | "disabled";
export type CoreFoundationValidationSeverity = "warning" | "error";

export interface CoreFoundationFeatureFlags {
  diagnostics_enabled: boolean;
  workflow_engine_enabled: boolean;
  operational_events_enabled: boolean;
  global_search_enabled: boolean;
  activity_timeline_enabled: boolean;
  admin_configuration_enabled: boolean;
  approval_framework_enabled: boolean;
  reporting_enabled: boolean;
}

export interface CoreFoundationValidationIssue {
  area: CoreFoundationArea;
  severity: CoreFoundationValidationSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface CoreFoundationHealthCheck {
  area: CoreFoundationArea;
  status: CoreFoundationHealthStatus;
  summary: string;
  detail_count: number;
  last_event_at: string | null;
  details: Record<string, unknown>;
}

export interface CoreFoundationDiagnosticsPayload {
  generated_at: string;
  feature_flags: CoreFoundationFeatureFlags;
  startup_validation: {
    valid: boolean;
    issues: CoreFoundationValidationIssue[];
  };
  health_checks: CoreFoundationHealthCheck[];
  recent_events: AuditEventListItem[];
}
