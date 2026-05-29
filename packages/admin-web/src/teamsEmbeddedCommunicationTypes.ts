import type { CommunicationIdentityStatus } from "./types";
import type { TeamsCommunicationRecordView } from "./teamsCommunicationTypes";
import type { TeamsMeetingRecordView } from "./teamsMeetingTypes";

export type TeamsEmbeddedCommunicationObjectType = "job" | "task";

export type TeamsEmbeddedCommunicationEntry = {
  object_type: TeamsEmbeddedCommunicationObjectType;
  object_id: string;
  object_label: string;
  record_kind_label: string;
  route_hash: string;
  department_type: string | null;
  organization_label: string | null;
  location_label: string | null;
  scheduled_start_at: string | null;
  due_at: string | null;
  latest_activity_at: string | null;
  communication: TeamsCommunicationRecordView;
  meeting: TeamsMeetingRecordView;
};

export type TeamsEmbeddedCommunicationHub = {
  generated_at: string;
  feature_flags: {
    personal_app_enabled: boolean;
    messaging_enabled: boolean;
    meetings_enabled: boolean;
  };
  communication_identity_status: CommunicationIdentityStatus;
  availability: {
    state: "ready" | "setup_required" | "limited" | "revoked";
    title: string;
    detail: string;
    fix_hint: string | null;
  };
  permissions: {
    can_use: boolean;
    can_send: boolean;
    can_manage_meetings: boolean;
    can_configure: boolean;
    can_view_history: boolean;
    can_send_proactive: boolean;
  };
  summary: {
    action_records: number;
    active_meetings: number;
    urgent_alerts: number;
    missing_destinations: number;
    latest_activity_at: string | null;
  };
  entries: TeamsEmbeddedCommunicationEntry[];
};
