export type OperationalAlertType =
  | "shoot_changed_within_48h"
  | "job_missing_required_data"
  | "staff_assignment_conflict_detected"
  | "understaffed_job"
  | "red_flag_post_shoot_eval"
  | "overdue_production_item"
  | "approval_needed"
  | "gallery_job_completed";

export type OperationalAlertDeliveryChannel = "teams_webhook" | "email" | "sms" | "push";

export type OperationalAlertDeliveryStatus = "queued" | "throttled" | "sent" | "failed";

export type OperationalAlertRouteRecord = {
  id: string;
  tenant_id: string;
  alert_type: OperationalAlertType;
  delivery_channel: OperationalAlertDeliveryChannel;
  route_name: string;
  destination_label: string;
  destination_config: Record<string, unknown>;
  severity_threshold: "low" | "medium" | "high" | "critical";
  throttle_window_minutes: number;
  enabled: boolean;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  masked_destination: string | null;
  last_delivery_at: string | null;
  last_delivery_status: OperationalAlertDeliveryStatus | null;
  failure_count_14d: number;
};

export type OperationalAlertDeliveryRecord = {
  id: string;
  tenant_id: string;
  route_id: string;
  delivery_channel: OperationalAlertDeliveryChannel;
  alert_type: OperationalAlertType;
  source_event_type: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  dedupe_key: string;
  status: OperationalAlertDeliveryStatus;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  deep_link: string | null;
  app_event_id: string | null;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  attempt_count: number;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  route_name: string;
  destination_label: string;
};

export type OperationalAlertDefinition = {
  type: OperationalAlertType;
  label: string;
  summary: string;
  recommended_severity: "low" | "medium" | "high" | "critical";
  recommended_throttle_minutes: number;
};

export type OperationalAlertAdminPayload = {
  generated_at: string;
  teams_enabled: boolean;
  definitions: OperationalAlertDefinition[];
  routes: OperationalAlertRouteRecord[];
  recent_deliveries: OperationalAlertDeliveryRecord[];
};

export type OperationalAlertRouteWriteInput = {
  alert_type: OperationalAlertType;
  delivery_channel: OperationalAlertDeliveryChannel;
  route_name: string;
  destination_label: string;
  destination_config: Record<string, unknown>;
  severity_threshold: "low" | "medium" | "high" | "critical";
  throttle_window_minutes: number;
  enabled?: boolean;
};
