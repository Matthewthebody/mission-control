export type MicrosoftIntegrationArea =
  | "auth"
  | "account_linking"
  | "outlook_calendar_sync"
  | "teams_alerts"
  | "teams_search"
  | "teams_personal_app"
  | "config";

export type MicrosoftIntegrationEventLevel = "info" | "warning" | "error";
export type MicrosoftIntegrationHealthStatus = "healthy" | "warning" | "failing" | "disabled";

export type MicrosoftIntegrationFeatureFlags = {
  auth_enabled: boolean;
  outlook_sync_enabled: boolean;
  teams_alerts_enabled: boolean;
  teams_search_enabled: boolean;
  teams_personal_app_enabled: boolean;
};

export type MicrosoftIntegrationValidationIssue = {
  area: MicrosoftIntegrationArea;
  severity: "warning" | "error";
  code: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type MicrosoftIntegrationHealthCheck = {
  area: MicrosoftIntegrationArea;
  status: MicrosoftIntegrationHealthStatus;
  summary: string;
  recent_failure_count: number;
  last_event_at: string | null;
  details: Record<string, unknown>;
};

export type MicrosoftIntegrationHealthPayload = {
  generated_at: string;
  feature_flags: MicrosoftIntegrationFeatureFlags;
  startup_validation: {
    valid: boolean;
    issues: MicrosoftIntegrationValidationIssue[];
  };
  health_checks: MicrosoftIntegrationHealthCheck[];
};

export type MicrosoftIntegrationEventRecord = {
  id: string;
  tenant_id: string | null;
  integration_area: MicrosoftIntegrationArea;
  event_level: MicrosoftIntegrationEventLevel;
  event_type: string;
  event_status: string;
  summary: string;
  detail: Record<string, unknown>;
  request_id: string | null;
  trace_id: string | null;
  actor_user_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  external_target: string | null;
  occurred_at: string;
};
