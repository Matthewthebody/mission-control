export type ClientEntityKind = "parent_organization" | "account";
export type ClientLifecycleStatus = "active" | "inactive" | "prospect" | "former_client" | "archived";
export type ClientLocationType =
  | "main_building"
  | "gym"
  | "stadium_field"
  | "district_office"
  | "offsite"
  | "school_main_entrance"
  | "school_media_center"
  | "sports_fieldhouse"
  | "other";

export type ClientLocationAttachmentType =
  | "parking_map"
  | "entrance_photo"
  | "setup_reference"
  | "field_map"
  | "screenshot"
  | "building_map"
  | "other";

export type ClientLocationAttachmentAudience = "client_facing" | "employee_facing" | "internal_only";
export type ClientOrganizationType =
  | "school_district"
  | "league"
  | "sports_association"
  | "company"
  | "nonprofit"
  | "elementary_school"
  | "middle_school"
  | "high_school"
  | "school"
  | "studio_client"
  | "corporate_client"
  | "other";
export type ClientContactRole =
  | "primary_decision_maker"
  | "principal"
  | "head_secretary"
  | "secretary_admin_assistant"
  | "administrative_assistant"
  | "athletic_director"
  | "activities_director"
  | "coach"
  | "yearbook_contact"
  | "picture_day_contact"
  | "picture_day_prep_recipient"
  | "day_before_reminder_recipient"
  | "billing_contact"
  | "gallery_recipient"
  | "approval_contact"
  | "contract_signer"
  | "contract_recipient"
  | "emergency_day_of_contact"
  | "district_contact"
  | "internal_employee"
  | "photographer"
  | "production_contact"
  | "csr_account_owner"
  | "primary_contact"
  | "other";
export type ClientOwnerType =
  | "studio_bestie"
  | "csr_owner"
  | "department_owner"
  | "sales_owner"
  | "escalation_owner"
  | "production_owner"
  | "support_owner";
export type AccountServiceType =
  | "fall_pictures"
  | "retakes"
  | "spring_pictures"
  | "graduation"
  | "yearbook"
  | "id_cards"
  | "sports"
  | "groups"
  | "staff_photos"
  | "studio_work"
  | "corporate_headshots"
  | "other";

export interface ClientOrganizationSummary {
  id: string;
  entity_kind: ClientEntityKind;
  name: string;
  parent_organization_id: string | null;
  parent_organization_name: string | null;
  client_organization_type: ClientOrganizationType | null;
  lifecycle_status: ClientLifecycleStatus;
  account_type: string;
  main_phone: string | null;
  office_phone: string | null;
  website: string | null;
  contact_count: number;
  service_count: number;
  open_job_count: number;
  readiness_issue_count: number;
  studio_bestie_name: string | null;
  updated_at: string;
}

export interface ClientContactSummary {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  office_phone: string | null;
  preferred_contact_method: string;
  active_status: "active" | "inactive";
  allow_email: boolean;
  allow_sms: boolean;
  allow_phone: boolean;
  do_not_contact: boolean;
  sms_consent_status: "unknown" | "opted_in" | "opted_out" | "not_eligible";
  sms_consent_source: string | null;
  sms_consent_at: string | null;
  sms_opted_out_at: string | null;
  prep_email_eligible: boolean;
  prep_email_exclusion_reason: string | null;
  prep_sms_eligible: boolean;
  prep_sms_exclusion_reason: string | null;
  notes: string | null;
  relationship_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  client_roles: ClientContactRole[];
  is_primary: boolean;
  receives_picture_day_emails: boolean;
  receives_yearbook_emails: boolean;
  receives_billing_emails: boolean;
  receives_gallery_emails: boolean;
  receives_approval_emails: boolean;
  receives_onboarding_emails: boolean;
  receives_internal_escalations: boolean;
}

export interface ClientLocationSummary {
  id: string;
  location_name: string;
  location_type: ClientLocationType;
  organization_id: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address_display: string | null;
  google_maps_url: string | null;
  active_status: "active" | "inactive";
  navigation_notes: string | null;
  parking_instructions: string | null;
  entrance_instructions: string | null;
  unloading_instructions: string | null;
  setup_area: string | null;
  backup_indoor_location: string | null;
  accessibility_notes: string | null;
  power_availability_notes: string | null;
  wifi_cell_notes: string | null;
  security_checkin_requirements: string | null;
  weather_contingency_notes: string | null;
  client_facing_notes: string | null;
  employee_facing_notes: string | null;
  internal_only_notes: string | null;
  reference_attachments: ClientLocationReferenceAttachment[];
  notes: string | null;
  updated_at: string;
}

export interface ClientLocationReferenceAttachment {
  id: string;
  location_id: string;
  title: string;
  description: string | null;
  attachment_type: ClientLocationAttachmentType;
  audience: ClientLocationAttachmentAudience;
  file_url: string | null;
  storage_key: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  active_status: "active" | "inactive";
}

export interface ClientInternalOwnerRecord {
  id: string;
  owner_user_id: string;
  owner_name: string;
  owner_email: string | null;
  owner_department: string | null;
  owner_type: ClientOwnerType;
  notes: string | null;
}

export interface AccountServiceRecord {
  id: string;
  service_type: AccountServiceType;
  status: "active" | "inactive" | "seasonal" | "unknown";
  notes: string | null;
}

export interface ClientReadinessIssue {
  code: string;
  severity: "warning" | "critical";
  label: string;
  detail: string;
  communication_type: string | null;
}

export interface ClientReadinessCheck {
  code: string;
  passed: boolean;
  label: string;
  detail: string;
}

export interface ClientReadinessResult {
  account_id: string;
  generated_at: string;
  status: "ready" | "needs_attention" | "blocked";
  checks: ClientReadinessCheck[];
  issues: ClientReadinessIssue[];
}

export interface ClientTimelineItem {
  id: string;
  kind: "note" | "activity" | "job" | "task";
  title: string;
  summary: string;
  occurred_at: string;
  actor_name: string | null;
  source_id: string | null;
}

export interface ClientAccountDetail {
  account: ClientOrganizationSummary;
  parent_organization: ClientOrganizationSummary | null;
  contacts: ClientContactSummary[];
  locations: ClientLocationSummary[];
  owners: ClientInternalOwnerRecord[];
  services: AccountServiceRecord[];
  readiness: ClientReadinessResult;
  upcoming_jobs: Array<{
    id: string;
    job_number: string | null;
    title: string;
    scheduled_start_at: string | null;
    job_status: string;
  }>;
  open_tasks: Array<{
    id: string;
    task_number: string;
    title: string;
    status: string;
    due_at: string | null;
    assigned_to_name: string | null;
  }>;
  timeline: ClientTimelineItem[];
}

export interface ClientCommandCenterDashboard {
  generated_at: string;
  summary: {
    active_accounts: number;
    accounts_missing_required_contacts: number;
    accounts_missing_studio_bestie: number;
    accounts_with_upcoming_jobs: number;
    readiness_issues: number;
  };
  accounts: ClientOrganizationSummary[];
  parent_organizations: ClientOrganizationSummary[];
  readiness_issues: Array<ClientReadinessIssue & { account_id: string; account_name: string }>;
  recently_updated: ClientOrganizationSummary[];
}
