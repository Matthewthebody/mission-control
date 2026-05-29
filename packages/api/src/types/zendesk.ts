export type ZendeskProviderMode = "mock" | "zendesk_live";
export type ZendeskConnectionStatus = "connected" | "disconnected" | "attention";
export type ZendeskHealthState = "mock" | "disabled" | "connected_pending_sync" | "connected_healthy" | "connected_warning" | "connected_error";
export type ZendeskSyncStatus = "success" | "warning" | "error";
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
  status: ZendeskSyncStatus;
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

export type ZendeskCategoryBreakdownRow = {
  category: ZendeskTicketCategory;
  total_count: number;
  open_count: number;
  resolved_count: number;
  unassigned_count: number;
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

export type ZendeskLeadershipTrends = {
  connection: ZendeskConnection;
  range: "7d" | "30d" | "this_week" | "this_month";
  points: ZendeskTrendPoint[];
};

export type ZendeskLeadershipTicketList = {
  connection: ZendeskConnection;
  tickets: ZendeskTicketSummary[];
};

export type ZendeskStatusPayload = {
  connection: ZendeskConnection;
  sync_runs: ZendeskSyncRun[];
  category_rules: ZendeskCategoryRule[];
};

export type ZendeskTestPayload = {
  ok: boolean;
  mode: ZendeskProviderMode | "disabled";
  message: string;
};

export type ZendeskProviderTicket = {
  zendesk_ticket_id: string;
  subject: string;
  requester_name: string | null;
  requester_email: string | null;
  assignee_name: string | null;
  assignee_id: string | null;
  organization_name: string | null;
  group_name: string | null;
  form_name: string | null;
  status: string;
  priority: string | null;
  ticket_created_at: string;
  ticket_updated_at: string;
  ticket_solved_at: string | null;
  first_reply_minutes: number | null;
  resolution_minutes: number | null;
  tags: string[];
  external_url: string | null;
  is_deleted: boolean;
  custom_fields: Record<string, string>;
  raw_payload: Record<string, unknown>;
};

export type ZendeskProviderSyncResult = {
  provider_mode: ZendeskProviderMode;
  tickets: ZendeskProviderTicket[];
  next_cursor: string | null;
  records_synced: number;
  warnings: string[];
  errors: ZendeskSyncError[];
};
