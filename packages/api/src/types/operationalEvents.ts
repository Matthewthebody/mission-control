import type { NotificationCategory, NotificationChannel, NotificationSeverity } from "./domain.js";

export const OPERATIONAL_EVENT_TYPES = [
  "job.assigned",
  "job.assignment_changed",
  "job.changed",
  "job.call_time_changed",
  "job.required_data_missing",
  "job.urgent_update",
  "staffing.assignment_conflict",
  "evaluation.flagged",
  "approval.requested",
  "client_intake.review_required",
  "client_intake.escalated",
  "client_intake.digest",
  "production.overdue",
  "task.completed",
  "task.overdue"
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

export type OperationalEventDeliveryStatus = "queued" | "dispatched" | "throttled" | "suppressed";

export type OperationalEventDefinition = {
  type: OperationalEventType;
  label: string;
  summary: string;
  defaultCategory: NotificationCategory;
  defaultSeverity: NotificationSeverity;
  defaultChannels: NotificationChannel[];
  defaultActionRequired: boolean;
  defaultDigestEligible: boolean;
  defaultThrottleWindowMinutes: number;
};

export type OperationalEventRecord = {
  id: string;
  tenant_id: string;
  event_type: OperationalEventType;
  source_module: string;
  source_object_type: string;
  source_object_id: string;
  source_object_label: string | null;
  actor_user_id: string | null;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  summary: string;
  deep_link: string | null;
  action_required: boolean;
  digest_eligible: boolean;
  throttle_window_minutes: number;
  recipient_user_ids: string[];
  delivery_channels: NotificationChannel[];
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  occurred_at: string;
  created_at: string;
};

export type OperationalEventDeliveryRecord = {
  id: string;
  tenant_id: string;
  operational_event_id: string;
  recipient_user_id: string | null;
  notification_group_key: string;
  delivery_channels: NotificationChannel[];
  dispatch_status: OperationalEventDeliveryStatus;
  notification_app_event_id: string | null;
  notification_id: string | null;
  throttled_by_delivery_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type EmitOperationalEventInput = {
  tenantId: string;
  actorUserId?: string | null;
  eventType: OperationalEventType;
  sourceModule: string;
  sourceObjectType: string;
  sourceObjectId: string;
  sourceObjectLabel?: string | null;
  title: string;
  summary: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  deepLink?: string | null;
  recipientUserIds?: string[];
  deliveryChannels?: NotificationChannel[];
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  actionRequired?: boolean;
  actionOwnerUserId?: string | null;
  dueAt?: string | null;
  requiresAcknowledgement?: boolean;
  allowSnooze?: boolean;
  digestEligible?: boolean;
  throttleWindowMinutes?: number | null;
  relatedUserId?: string | null;
  shiftId?: string | null;
  shootId?: string | null;
  attendanceExceptionId?: string | null;
};

export type EmitOperationalEventResult = {
  event: OperationalEventRecord;
  deliveries: OperationalEventDeliveryRecord[];
  queued_count: number;
  throttled_count: number;
};
