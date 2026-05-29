export type TeamsCommunicationReferenceType = "chat" | "channel";
export type TeamsCommunicationReferenceStatus = "active" | "disabled";
export type TeamsCommunicationLinkedObjectType = "job" | "production_item" | "organization" | "location" | "task";
export type TeamsCommunicationDeliveryStatus = "queued" | "sending" | "sent" | "failed" | "throttled";
export type TeamsCommunicationDeliveryVisibilityStatus = "visible" | "moderated_hidden";

export type TeamsCommunicationReferenceRecord = {
  id: string;
  reference_type: TeamsCommunicationReferenceType;
  status: TeamsCommunicationReferenceStatus;
  label: string;
  description: string | null;
  teams_web_url: string;
  team_id: string | null;
  channel_id: string | null;
  chat_id: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  last_verified_at: string | null;
};

export type TeamsCommunicationDeliveryRecord = {
  id: string;
  reference_id: string;
  reference_label: string;
  reference_type: TeamsCommunicationReferenceType;
  status: TeamsCommunicationDeliveryStatus;
  visibility_status: TeamsCommunicationDeliveryVisibilityStatus;
  message_text: string;
  app_deep_link: string | null;
  teams_destination_url: string;
  attempt_count: number;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  external_message_id: string | null;
  moderated_at: string | null;
  moderated_by_user_id: string | null;
  moderation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamsCommunicationRecordView = {
  object_type: TeamsCommunicationLinkedObjectType;
  object_id: string;
  object_label: string;
  module?: "jobs" | "staffing" | "tasks" | "production" | "directory";
  permissions: {
    can_use: boolean;
    can_send: boolean;
    can_configure: boolean;
    can_view_history?: boolean;
    can_send_proactive?: boolean;
    can_message_chats?: boolean;
    can_message_channels?: boolean;
    can_message_assigned_staff?: boolean;
  };
  feature_enabled: boolean;
  references: TeamsCommunicationReferenceRecord[];
  recent_deliveries: TeamsCommunicationDeliveryRecord[];
};

export type CreateTeamsCommunicationReferenceInput = {
  reference_type: TeamsCommunicationReferenceType;
  label: string;
  description?: string | null;
  teams_web_url: string;
  team_id?: string | null;
  channel_id?: string | null;
  chat_id?: string | null;
  is_primary?: boolean;
};

export type QueueTeamsCommunicationMessageInput = {
  reference_id: string;
  object_type: TeamsCommunicationLinkedObjectType;
  object_id: string;
  message_text: string;
  app_deep_link?: string | null;
};
