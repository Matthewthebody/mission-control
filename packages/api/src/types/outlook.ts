import type { ShootLocationIntelligence } from "./locations.js";

export type OutlookConnectionStatus = "connected" | "disconnected" | "attention";

export type OutlookProviderMode = "mock" | "graph_stub" | "graph_live";

export type OutlookHealthState =
  | "mock"
  | "disconnected"
  | "connected_pending_sync"
  | "connected_healthy"
  | "connected_warning"
  | "connected_error";

export interface OutlookCalendarAccount {
  id: string;
  tenant_id: string;
  provider_mode: OutlookProviderMode;
  connection_status: OutlookConnectionStatus;
  health_state: OutlookHealthState;
  connected_as: string | null;
  connection_label: string;
  degraded_reason?: string | null;
  last_error_message?: string | null;
  last_sync_at: string | null;
  last_failed_sync_at?: string | null;
  records_synced: number;
  warning_count: number;
  error_count: number;
}

export interface OutlookCalendar {
  id: string;
  name: string;
  color_hex: string;
  is_primary: boolean;
  owner_label: string | null;
  visible_in_app: boolean;
  scheduling_impact_enabled: boolean;
  overlaps_with_shoots: boolean;
  upcoming_count: number;
}

export interface OutlookCalendarVisibilityPreference {
  calendar_id: string;
  visible_in_app: boolean;
}

export interface OutlookMailFolder {
  id: string;
  display_name: string;
  unread_count: number;
  flagged_count: number;
  important_count: number;
}

export interface OutlookCalendarEvent {
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
}

export interface OutlookMessage {
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
}

export interface OutlookCalendarSyncError {
  code: string;
  message: string;
  scope: string;
  occurred_at: string;
  retry_after_seconds?: number | null;
  retry_state?: "none" | "retry_after_delay" | "manual_retry_required";
  source_object?: {
    type: string;
    id: string | null;
  };
  target_object?: {
    type: string;
    id: string | null;
    owner_email?: string | null;
  };
}

export interface OutlookCalendarSyncRun {
  id: string;
  provider_mode?: OutlookProviderMode;
  started_at: string;
  finished_at: string | null;
  status: "success" | "warning" | "error";
  records_synced: number;
  warnings: string[];
  errors: OutlookCalendarSyncError[];
  source_object?: {
    type: string;
    id: string | null;
  };
  target_object?: {
    type: string;
    id: string | null;
    owner_email?: string | null;
  };
  last_attempted_sync_at?: string | null;
  last_successful_sync_at?: string | null;
  last_failed_sync_at?: string | null;
  retry_state?: "none" | "retry_after_delay" | "manual_retry_required";
  retry_after_seconds?: number | null;
}

export interface OutlookCalendarStatusPayload {
  account: OutlookCalendarAccount;
  graph_stub: OutlookCalendarAccount;
  sync_runs: OutlookCalendarSyncRun[];
}

export interface OutlookReplaySummary {
  provider_mode: OutlookProviderMode;
  queued_count: number;
  queued_operation_ids: string[];
  replay_scope: "full_history" | "date_range";
  date_from: string | null;
  date_to: string | null;
  status_filter: string[];
}

export interface OutlookReconciliationEntry {
  id: string;
  label: string;
  starts_at?: string | null;
  ends_at?: string | null;
  location?: string | null;
}

export interface OutlookReconciliationReport {
  compared_at: string;
  provider_mode: OutlookProviderMode | null;
  connection_status: OutlookConnectionStatus;
  window: "today" | "3day" | "week";
  date: string;
  system_shoot_count: number;
  outlook_event_count: number;
  matched_overlap_count: number;
  missing_in_outlook: OutlookReconciliationEntry[];
  outlook_only: OutlookReconciliationEntry[];
}

export interface OutlookCalendarConnectResponse extends OutlookCalendarStatusPayload {
  connect_mode: "mock" | "oauth_redirect" | "connected";
  authorization_url?: string | null;
}

export type OutlookAccount = OutlookCalendarAccount;
export type OutlookEvent = OutlookCalendarEvent;
export type OutlookSyncError = OutlookCalendarSyncError;
export type OutlookSyncRun = OutlookCalendarSyncRun;
export type OutlookStatusPayload = OutlookCalendarStatusPayload;
export type OutlookConnectResponse = OutlookCalendarConnectResponse;
