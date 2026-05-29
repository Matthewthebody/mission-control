export type TeamsMeetingLinkedObjectType = "job" | "production_item" | "organization" | "location" | "task";
export type TeamsMeetingMode = "calendar_event" | "standalone_online_meeting";
export type TeamsMeetingStatus = "pending_create" | "scheduled" | "pending_update" | "pending_cancel" | "cancelled" | "sync_error";
export type TeamsMeetingSyncOperationType = "create" | "update" | "cancel";
export type TeamsMeetingSyncOperationStatus = "queued" | "processing" | "succeeded" | "failed" | "throttled" | "skipped";
export type TeamsMeetingLifecycleType = "ad_hoc_call" | "scheduled_record_meeting" | "internal_review";
export type TeamsMeetingRecordSyncPolicy = "manual" | "follow_record_schedule";
export type TeamsMeetingTimingState = "upcoming" | "in_progress" | "ended" | "cancelled" | "pending" | "attention_needed";

export type TeamsMeetingParticipantRecord = {
  user_id: string;
  full_name: string;
  email: string;
  role: "organizer" | "attendee";
};

export type TeamsMeetingRecord = {
  id: string;
  linked_record_type: TeamsMeetingLinkedObjectType;
  linked_record_id: string;
  meeting_provider: "microsoft_teams";
  meeting_mode: TeamsMeetingMode;
  meeting_status: TeamsMeetingStatus;
  lifecycle_type?: TeamsMeetingLifecycleType;
  record_sync_policy?: TeamsMeetingRecordSyncPolicy;
  timing_state?: TeamsMeetingTimingState;
  status_summary?: string;
  record_behavior_summary?: string;
  title: string;
  description: string | null;
  meeting_join_url: string | null;
  meeting_web_url: string | null;
  external_meeting_id: string | null;
  external_calendar_event_id: string | null;
  organizer_user_id: string | null;
  organizer_email: string | null;
  organizer_microsoft_user_id: string | null;
  participant_snapshot: TeamsMeetingParticipantRecord[];
  app_deep_link: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  last_sync_operation_id: string | null;
  last_sync_attempt_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamsMeetingSyncOperationRecord = {
  id: string;
  meeting_id: string;
  operation_type: TeamsMeetingSyncOperationType;
  trigger_source: string;
  actor_user_id: string | null;
  status: TeamsMeetingSyncOperationStatus;
  app_event_id: string | null;
  attempt_count: number;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamsMeetingRecordDefaults = {
  suggested_title: string;
  suggested_description: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  app_deep_link: string | null;
  suggested_participants: TeamsMeetingParticipantRecord[];
  default_lifecycle_type?: TeamsMeetingLifecycleType;
  allowed_lifecycle_types?: TeamsMeetingLifecycleType[];
  schedule_guidance?: string;
};

export type TeamsMeetingRecordView = {
  object_type: TeamsMeetingLinkedObjectType;
  object_id: string;
  object_label: string;
  module?: "jobs" | "staffing" | "tasks" | "production" | "directory";
  feature_enabled: boolean;
  permissions: {
    can_use: boolean;
    can_manage: boolean;
    can_create: boolean;
    can_view_history: boolean;
  };
  defaults: TeamsMeetingRecordDefaults;
  meeting: TeamsMeetingRecord | null;
  recent_operations: TeamsMeetingSyncOperationRecord[];
};

export type UpsertTeamsMeetingInput = {
  object_type: TeamsMeetingLinkedObjectType;
  object_id: string;
  lifecycle_type?: TeamsMeetingLifecycleType | null;
  meeting_mode?: TeamsMeetingMode | null;
  title?: string | null;
  description?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
};

export type CancelTeamsMeetingInput = {
  meeting_id: string;
  reason?: string | null;
};
