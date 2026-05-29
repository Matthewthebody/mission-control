import type { NotificationCategory, NotificationSeverity } from "./domain.js";
import type { OperationalEventType } from "./operationalEvents.js";
import type { TeamsCommunicationLinkedObjectType } from "./teamsMessaging.js";

export const PROACTIVE_COMMUNICATION_TRIGGER_TYPES = [
  "assignment_changed",
  "call_time_changed",
  "required_info_missing",
  "approval_needed",
  "conflict_detected",
  "urgent_job_update",
  "overdue_task_tied_to_job"
] as const;

export type ProactiveCommunicationTriggerType = (typeof PROACTIVE_COMMUNICATION_TRIGGER_TYPES)[number];

export const PROACTIVE_COMMUNICATION_ROUTE_TYPES = [
  "direct_teams_message",
  "channel_alert",
  "in_app_notification",
  "open_teams_recommendation"
] as const;

export type ProactiveCommunicationRouteType = (typeof PROACTIVE_COMMUNICATION_ROUTE_TYPES)[number];

export const PROACTIVE_COMMUNICATION_ROUTE_STATUSES = [
  "queued",
  "notified",
  "recommended",
  "throttled",
  "suppressed",
  "failed"
] as const;

export type ProactiveCommunicationRouteStatus = (typeof PROACTIVE_COMMUNICATION_ROUTE_STATUSES)[number];

export type ProactiveCommunicationTriggerOverride = {
  enabled?: boolean;
  preferred_route?: ProactiveCommunicationRouteType;
  throttle_window_minutes?: number;
  max_direct_message_recipients?: number;
};

export type ProactiveCommunicationDefaultsConfig = {
  default_fallback_route: "in_app_notification" | "open_teams_recommendation";
  default_throttle_window_minutes: number;
  max_direct_message_recipients: number;
  trigger_overrides: Partial<Record<ProactiveCommunicationTriggerType, ProactiveCommunicationTriggerOverride>>;
};

export type ProactiveCommunicationDecisionRecord = {
  id: string;
  trigger_type: ProactiveCommunicationTriggerType;
  source_module: string;
  source_object_type: string;
  source_object_id: string;
  source_object_label: string | null;
  communication_object_type: TeamsCommunicationLinkedObjectType;
  communication_object_id: string;
  route_kind: ProactiveCommunicationRouteType;
  route_status: ProactiveCommunicationRouteStatus;
  actor_user_id: string | null;
  recipient_user_ids: string[];
  teams_reference_id: string | null;
  teams_delivery_id: string | null;
  operational_event_id: string | null;
  title: string;
  summary: string;
  throttle_key: string | null;
  throttle_window_minutes: number;
  throttled_by_decision_id: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProactiveCommunicationTriggerInput = {
  triggerType: ProactiveCommunicationTriggerType;
  sourceModule: string;
  sourceObjectType: string;
  sourceObjectId: string;
  sourceObjectLabel?: string | null;
  communicationObjectType: TeamsCommunicationLinkedObjectType;
  communicationObjectId: string;
  title: string;
  summary: string;
  messageText?: string | null;
  recipientUserIds?: string[];
  appDeepLink?: string | null;
  operationalEventType?: OperationalEventType;
  notificationCategory?: NotificationCategory;
  severity?: NotificationSeverity;
  actionRequired?: boolean;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
};

export type ProactiveCommunicationRouteResult = {
  decision: ProactiveCommunicationDecisionRecord | null;
  route_kind: ProactiveCommunicationRouteType | null;
  route_status: ProactiveCommunicationRouteStatus;
  failure_reason: string | null;
};
