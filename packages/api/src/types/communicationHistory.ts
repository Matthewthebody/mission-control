import type { TeamsCommunicationLinkedObjectType } from "./teamsMessaging.js";

export type CommunicationHistoryTargetType = "chat" | "channel" | "meeting";
export type CommunicationHistoryEntryKind = "destination_linked" | "message" | "meeting" | "post_call";
export type CommunicationHistoryMessageStatus = "queued" | "sending" | "sent" | "failed" | "throttled";
export type CommunicationHistoryMeetingStatus =
  | "pending_create"
  | "scheduled"
  | "pending_update"
  | "pending_cancel"
  | "cancelled"
  | "sync_error"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "throttled"
  | "skipped";

export type CommunicationHistoryEntry = {
  id: string;
  kind: CommunicationHistoryEntryKind;
  action_type: string;
  target_type: CommunicationHistoryTargetType;
  target_reference_id: string | null;
  target_id: string | null;
  target_label: string | null;
  target_url: string | null;
  related_record_type: TeamsCommunicationLinkedObjectType;
  related_record_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  status: string;
  visibility_status?: "visible" | "moderated_hidden";
  moderated_at?: string | null;
  moderated_by_user_id?: string | null;
  moderation_reason?: string | null;
  summary: string;
  join_url: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  occurred_at: string;
};

export type CommunicationHistoryLatestSummary = {
  kind: "message" | "meeting" | "failure";
  action_type: string;
  target_type: CommunicationHistoryTargetType;
  target_reference_id: string | null;
  target_id: string | null;
  target_label: string | null;
  target_url: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  status: string;
  visibility_status?: "visible" | "moderated_hidden";
  moderated_at?: string | null;
  moderated_by_user_id?: string | null;
  moderation_reason?: string | null;
  summary: string;
  join_url: string | null;
  failure_reason: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type CommunicationHistorySummary = {
  latest_activity_at: string | null;
  latest_message: CommunicationHistoryLatestSummary | null;
  latest_meeting: CommunicationHistoryLatestSummary | null;
  latest_follow_up: CommunicationHistoryLatestSummary | null;
  latest_failure: CommunicationHistoryLatestSummary | null;
};

export type CommunicationHistoryRecordView = {
  object_type: TeamsCommunicationLinkedObjectType;
  object_id: string;
  object_label: string;
  module?: "jobs" | "staffing" | "tasks" | "production" | "directory";
  feature_enabled: boolean;
  permissions: {
    can_view_history: boolean;
    can_use_actions: boolean;
    can_view_messages: boolean;
    can_view_meetings: boolean;
  };
  summary: CommunicationHistorySummary;
  entries: CommunicationHistoryEntry[];
};
