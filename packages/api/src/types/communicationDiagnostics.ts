import type { AuditEventListItem } from "./diagnostics.js";

export type CommunicationArea =
  | "identity_linking"
  | "teams_messaging"
  | "teams_meetings"
  | "in_app_actions"
  | "communication_history"
  | "proactive_messaging_rules"
  | "post_call_follow_up"
  | "pre_call_context"
  | "governance"
  | "teams_embedded_entry_points"
  | "config";

export type CommunicationHealthStatus = "healthy" | "warning" | "failing" | "disabled";
export type CommunicationValidationSeverity = "warning" | "error";

export interface CommunicationFeatureFlags {
  diagnostics_enabled: boolean;
  identity_linking_enabled: boolean;
  teams_messaging_enabled: boolean;
  teams_meetings_enabled: boolean;
  in_app_actions_enabled: boolean;
  communication_history_enabled: boolean;
  proactive_messaging_rules_enabled: boolean;
  post_call_follow_up_enabled: boolean;
  pre_call_context_enabled: boolean;
  teams_embedded_entry_points_enabled: boolean;
}

export interface CommunicationValidationIssue {
  area: CommunicationArea;
  severity: CommunicationValidationSeverity;
  code: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface CommunicationHealthCheck {
  area: CommunicationArea;
  status: CommunicationHealthStatus;
  summary: string;
  detail_count: number;
  last_event_at: string | null;
  details: Record<string, unknown>;
}

export interface CommunicationAdminControls {
  default_meeting_mode: "calendar_event" | "standalone_online_meeting";
  strict_startup_validation: boolean;
  diagnostics_lookback_days: number;
  embedded_defaults: {
    max_assigned_jobs: number;
    max_assigned_tasks: number;
    max_entries: number;
  };
  rollout_controls: {
    communication_history_enabled: boolean;
    proactive_messaging_rules_enabled: boolean;
    post_call_follow_up_enabled: boolean;
    pre_call_context_enabled: boolean;
  };
}

export interface CommunicationSupportExample {
  id: string;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  result: string;
  summary: string;
  created_at: string;
  details: Record<string, unknown>;
}

export interface CommunicationSupportBucket {
  count: number;
  last_event_at: string | null;
  summary: string;
  examples: CommunicationSupportExample[];
  details: Record<string, unknown>;
}

export interface CommunicationSupportWorkspace {
  failed_launches: CommunicationSupportBucket;
  failed_sends: CommunicationSupportBucket;
  broken_meeting_references: CommunicationSupportBucket;
  routing_rule_problems: CommunicationSupportBucket;
  permission_failures: CommunicationSupportBucket;
}

export interface CommunicationDiagnosticsPayload {
  generated_at: string;
  feature_flags: CommunicationFeatureFlags;
  admin_controls: CommunicationAdminControls;
  startup_validation: {
    valid: boolean;
    issues: CommunicationValidationIssue[];
  };
  health_checks: CommunicationHealthCheck[];
  support_workspace: CommunicationSupportWorkspace;
  recent_events: AuditEventListItem[];
}
