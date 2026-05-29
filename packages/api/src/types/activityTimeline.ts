export type ActivityTimelineObjectType =
  | "job"
  | "staffing_assignment"
  | "organization"
  | "location"
  | "contact"
  | "production_item"
  | "evaluation"
  | "approval";

export type ActivityTimelineSourceKind =
  | "activity_log"
  | "audit_log"
  | "approval_request"
  | "approval_event"
  | "notification"
  | "sync";

export type ActivityTimelineTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ActivityTimelineEntry {
  id: string;
  tenant_id: string;
  object_type: ActivityTimelineObjectType;
  object_id: string;
  related_object_type: string | null;
  related_object_id: string | null;
  source_kind: ActivityTimelineSourceKind;
  event_type: string;
  action_label: string;
  summary: string;
  detail: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  tone: ActivityTimelineTone;
  metadata: Record<string, unknown>;
  job_id: string | null;
  job_day_id: string | null;
  production_item_id: string | null;
  watch_flag_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  contact_id: string | null;
}

export interface ActivityTimelineResponse {
  object_type: ActivityTimelineObjectType;
  object_id: string;
  object_label: string | null;
  items: ActivityTimelineEntry[];
}
