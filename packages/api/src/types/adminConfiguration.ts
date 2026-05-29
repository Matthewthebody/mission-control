import type { NotificationChannel, NotificationSeverity } from "./domain.js";
import type { OperationalEventType } from "./operationalEvents.js";
import type {
  HomeWidgetVisibilityKey,
  OperatingSystemHomeCompactWidgetKey,
  OperatingSystemHomeSectionKey,
  OperatingSystemModuleKey
} from "./operatingSystem.js";
import type { ProactiveCommunicationDefaultsConfig } from "./proactiveCommunication.js";

export const PUBLISH_REQUIRED_FIELD_KEYS = [
  "department_type",
  "organization_id",
  "title",
  "days",
  "primary_location_id",
  "primary_contact_id",
  "timezone"
] as const;

export type PublishRequiredFieldKey = (typeof PUBLISH_REQUIRED_FIELD_KEYS)[number];

export type OperatingSystemVisibilityOverrideConfig = {
  hidden_modules: OperatingSystemModuleKey[];
  hidden_home_widgets: HomeWidgetVisibilityKey[];
};

export type HomeDashboardDefaultsConfig = {
  hidden_sections: OperatingSystemHomeSectionKey[];
  hidden_compact_widgets: OperatingSystemHomeCompactWidgetKey[];
};

export type PublishRequiredFieldsConfig = {
  required_fields: PublishRequiredFieldKey[];
  allow_location_override_note: boolean;
  allow_contact_override_note: boolean;
};

export type DayReadyRequirementsConfig = {
  require_lead_assigned: boolean;
  missing_lead_level: "hard_block" | "warning";
  require_on_site_confirmed: boolean;
  require_setup_complete: boolean;
  require_all_required_staff_present: boolean;
  require_blockers_resolved: boolean;
  require_equipment_ready: boolean;
  require_client_contact_checked_in: boolean;
  manager_override_downgrades: boolean;
};

export type ProductionReleaseBlockersConfig = {
  require_peer_review_for_upload: boolean;
  require_final_review_for_release: boolean;
  require_approval_when_required: boolean;
  require_proof_reference_when_required: boolean;
  require_no_blocking_issues_for_final_release: boolean;
};

export type ProductionFinalReleaseStatusesConfig = {
  statuses: Array<"RELEASED" | "SENT_TO_VENDOR" | "DELIVERED" | "CLOSED">;
};

export type CommunicationMeetingDefaultMode = "calendar_event" | "standalone_online_meeting";

export type CommunicationMeetingDefaultsConfig = {
  default_mode: CommunicationMeetingDefaultMode;
};

export type TeamsEmbeddedCommunicationsDefaultsConfig = {
  max_assigned_jobs: number;
  max_assigned_tasks: number;
  max_entries: number;
};

export type { ProactiveCommunicationDefaultsConfig };

export type OperationalEventDefaultOverride = {
  severity?: NotificationSeverity;
  channels?: NotificationChannel[];
  throttle_window_minutes?: number;
  action_required?: boolean;
  digest_eligible?: boolean;
};

export type OperationalEventDefaultsConfig = {
  default_channels: NotificationChannel[];
  event_overrides: Partial<Record<OperationalEventType, OperationalEventDefaultOverride>>;
};
