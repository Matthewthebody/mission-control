import type {
  AgreementAccess,
  AgreementRecord,
  AgreementTemplateRecord,
  AgreementUpcomingShootRisk,
  OrganizationAgreementSummary
} from "./agreements.js";
import type { ResourceLibraryView } from "./resourceLibrary.js";
import type {
  SalesEmailCommunicationRecord,
  SalesEmailTemplateRecord,
  SalesOpportunityAttentionState,
  SalesOpportunityStage,
  SalesOpportunityStatus,
  SalesOpportunityType,
  SalesPipelineAlertRecord,
  SalesPipelineType
} from "./salesPipeline.js";

export type OrganizationAccountType =
  | "schools_underclass_portraits"
  | "schools_events"
  | "sports"
  | "events"
  | "studio"
  | "headshots"
  | "commercial"
  | "internal";

export type DirectoryActiveStatus = "active" | "inactive";
export type DirectoryContactStatus = "active" | "needs_review" | "inactive" | "archived";
export type DirectoryContactRelationshipRole =
  | "general"
  | "planning"
  | "billing"
  | "decision_maker"
  | "day_of"
  | "operations"
  | "other";
export type DirectoryContactRoleCategory =
  | "district_leadership"
  | "school_leadership"
  | "school_administration"
  | "yearbook_publications"
  | "athletics_activities"
  | "day_of_logistics"
  | "data_roster"
  | "finance_billing"
  | "technology_systems"
  | "front_office_secretary"
  | "facilities_building_access"
  | "vendor_external_partner"
  | "other";
export type DirectoryDecisionInfluence =
  | "decision_maker"
  | "approver"
  | "recommender"
  | "gatekeeper"
  | "day_to_day_operator"
  | "logistics_owner"
  | "billing_owner"
  | "informational_only";
export type DirectoryOperationalImportance = "critical" | "high" | "normal" | "low";
export type DirectoryRelationshipStrength =
  | "introduced"
  | "working_relationship"
  | "strong_relationship"
  | "trusted_relationship"
  | "unknown";
export type DirectoryRelationshipOwnershipState = "owned" | "shared" | "unassigned" | "needs_reassignment";
export type DirectoryFreshnessState = "fresh" | "aging" | "needs_review";

export type DirectoryTouchpointChannel =
  | "call"
  | "email"
  | "text"
  | "meeting"
  | "onsite"
  | "note"
  | "picture_day_conversation"
  | "internal_debrief"
  | "portal_message"
  | "other";
export type DirectoryTouchpointCategory =
  | "planning"
  | "pre_shoot_confirmation"
  | "day_of_readiness"
  | "post_shoot_follow_up"
  | "yearbook_deliverables"
  | "customer_issue_resolution"
  | "relationship_maintenance"
  | "renewal_contract"
  | "billing_finance"
  | "operational_change"
  | "thank_you_appreciation"
  | "executive_leadership_checkin";
export type DirectoryTouchpointPlanStatus = "planned" | "due_soon" | "completed" | "skipped" | "cancelled" | "overdue";
export type DirectoryCommunicationOutcome =
  | "informational_only"
  | "confirmed"
  | "waiting_on_customer"
  | "waiting_on_internal_team"
  | "follow_up_needed"
  | "resolved"
  | "escalated"
  | "relationship_building"
  | "problem_identified";
export type DirectoryRelationshipMemoryType =
  | "communication_preference"
  | "operational_expectation"
  | "cadence_timing_preference"
  | "escalation_preference"
  | "day_of_coordination_preference"
  | "yearbook_deliverable_preference"
  | "relationship_sensitivity"
  | "appreciation_hospitality_note"
  | "other";
export type DirectoryRelationshipMemoryStatus = "active" | "needs_review" | "archived";
export type DirectoryRelationshipMemoryVisibility = "assignment_relevant" | "manager_plus" | "leadership_only";
export type DirectoryRelationshipFollowUpStatus = "open" | "in_progress" | "completed" | "cancelled" | "overdue";
export type DirectoryRelationshipHealthState = "healthy" | "needs_attention" | "fragile" | "at_risk" | "unknown";
export type SchoolRelationshipHealthState = "healthy" | "needs_attention" | "fragile" | "at_risk" | "unknown";
export type SchoolContactCategory =
  | "principal"
  | "secretary"
  | "district_contact"
  | "photo_day_contact"
  | "yearbook_contact"
  | "billing_contact"
  | "athletics_contact"
  | "graduation_contact"
  | "other";
export type SchoolRuleType =
  | "additional_language_needs"
  | "qr_organization_rules"
  | "hat_policy"
  | "additional_shoot_rules"
  | "punch_id_rules"
  | "sticker_counts"
  | "subject_directory_requirements"
  | "subject_directory_counts"
  | "yearbook_participation"
  | "delivery_preferences"
  | "mailing_preferences"
  | "special_handling";
export type SchoolActivityType =
  | "profile_created"
  | "profile_updated"
  | "contact_categories_updated"
  | "rule_created"
  | "rule_updated"
  | "note_added"
  | "automation_generated"
  | "automation_escalated"
  | "automation_trigger_received";
export type DirectoryDuplicateReviewStatus = "open" | "resolved" | "dismissed";
export type DirectoryDuplicateReviewDecision = "pending" | "keep_separate" | "merge_candidate" | "merged_later";
export type DirectoryImportSessionStatus = "staged" | "applied" | "partially_applied" | "cancelled";
export type DirectoryImportRowStatus = "staged" | "ready" | "needs_review" | "applied" | "skipped" | "error";
export type DirectoryImportRowAction = "create_contact" | "link_existing" | "skip" | "needs_review";
export type DirectoryImportMatchConfidence = "exact" | "strong" | "possible";
export type DirectoryImportColumnKey =
  | "first_name"
  | "last_name"
  | "preferred_name"
  | "title"
  | "email"
  | "phone"
  | "organization_name"
  | "organization_type"
  | "relationship_role"
  | "notes"
  | "start_date"
  | "end_date"
  | "current_flag";

export interface OrganizationSummary {
  id: string;
  canonical_name: string;
  logo_url: string | null;
  display_name: string;
  account_type: OrganizationAccountType;
  active_status: DirectoryActiveStatus;
  primary_location_id?: string | null;
  primary_contact_id?: string | null;
  account_owner_user_id?: string | null;
  aliases: string[];
  notes: string | null;
  contact_count: number;
  location_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationContactRelationshipHistoryRecord {
  id: string;
  organization_id: string;
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  is_current: boolean;
  relationship_state: "current" | "previous";
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationContactRecord {
  id: string;
  organization_id: string;
  canonical_organization_id?: string;
  first_name: string;
  last_name: string;
  full_name: string;
  preferred_name?: string | null;
  title: string | null;
  department_program?: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  active_status: DirectoryActiveStatus;
  contact_status?: DirectoryContactStatus;
  role_category?: DirectoryContactRoleCategory;
  operational_importance?: DirectoryOperationalImportance;
  decision_influence?: DirectoryDecisionInfluence;
  relationship_strength?: DirectoryRelationshipStrength;
  primary_internal_owner?: DirectoryInternalOwnerRecord | null;
  backup_internal_owner?: DirectoryInternalOwnerRecord | null;
  ownership_state?: DirectoryRelationshipOwnershipState;
  freshness_state?: DirectoryFreshnessState;
  last_confirmed_at?: string | null;
  last_meaningful_interaction_at?: string | null;
  primary_location_id?: string | null;
  primary_location_name?: string | null;
  linked_location_names?: string[];
  strongest_internal_relationship?: DirectoryInternalOwnerRecord | null;
  last_spoke_with?: DirectoryInternalOwnerRecord | null;
  additional_internal_connected_staff?: DirectoryInternalOwnerRecord[];
  handoff_ready?: boolean;
  uncertainty_flag?: boolean;
  maintenance_signals?: DirectoryRelationshipMaintenanceSignal[];
  last_updated_by_name?: string | null;
  relationship_role?: DirectoryContactRelationshipRole | null;
  is_primary?: boolean;
  school_contact_categories?: SchoolContactCategory[];
  relationship_history?: OrganizationContactRelationshipHistoryRecord[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolProfileRecord {
  organization_id: string;
  district_name: string | null;
  school_type: string | null;
  school_year_label: string | null;
  relationship_health_state: SchoolRelationshipHealthState;
  relationship_summary: string | null;
  primary_internal_owner?: DirectoryInternalOwnerRecord | null;
  backup_internal_owner?: DirectoryInternalOwnerRecord | null;
  primary_location_id: string | null;
  primary_location_name: string | null;
  primary_location_address: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolRuleRecord {
  id: string;
  organization_id: string;
  rule_type: SchoolRuleType;
  active_status: DirectoryActiveStatus;
  title: string;
  summary: string | null;
  structured_value: Record<string, unknown>;
  sort_order: number;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolActivityLogRecord {
  id: string;
  organization_id: string;
  activity_type: SchoolActivityType;
  summary: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  related_contact_id: string | null;
  related_contact_name: string | null;
  related_rule_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface DirectoryContactSummary extends OrganizationContactRecord {
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
  organization_logo_url?: string | null;
}

export interface OrganizationLocationRecord {
  id: string;
  organization_id: string | null;
  location_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address_display: string | null;
  maps_label: string | null;
  maps_url: string | null;
  active_status: DirectoryActiveStatus;
  contact_links?: LocationContactLinkRecord[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryLocationSummary extends OrganizationLocationRecord {
  organization_display_name: string;
  organization_account_type: OrganizationAccountType;
}

export interface OrganizationRecentShootRecord {
  id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  location_name: string | null;
}

export interface OrganizationUpcomingShootRecord extends OrganizationRecentShootRecord {
  showtime: string | null;
  start_time: string | null;
}

export interface OrganizationSalesOpportunityPreview {
  id: string;
  pipeline_type: SalesPipelineType;
  opportunity_type: SalesOpportunityType;
  stage: SalesOpportunityStage;
  status: SalesOpportunityStatus;
  owner_id: string;
  owner_name: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  estimated_value: number | null;
  next_action_date: string | null;
  last_touch_date: string;
  follow_up_date: string | null;
  attention_state: SalesOpportunityAttentionState;
  open_alert_count: number;
  notes: string | null;
}

export interface OrganizationSalesPipelineSummary {
  linked_opportunities: number;
  active_opportunities: number;
  dormant_opportunities: number;
  open_alerts: number;
  missing_next_action: number;
  inactive_opportunities: number;
  meeting_scheduled: number;
  schools_pipeline_count: number;
  sports_pipeline_count: number;
  renewal_opportunities: number;
  contract_sent: number;
  last_touch_date: string | null;
  last_verified_contact_date: string | null;
  next_action_due_date: string | null;
}

export interface OrganizationAccountIssueRecord {
  issue_type: "agreement_warning" | "crm_alert" | "shoot_risk";
  severity: "warning" | "major" | "critical";
  title: string;
  summary: string;
  linked_entity_id: string | null;
}

export interface OrganizationAccountOverview {
  contract_status: string;
  expiration_timeline: string;
  last_shoot: OrganizationRecentShootRecord | null;
  next_shoot: OrganizationUpcomingShootRecord | null;
  key_contacts: OrganizationContactRecord[];
  account_health_state: "healthy" | "watch" | "at_risk";
  account_health_summary: string;
  account_health_reasons: string[];
  recent_issues: OrganizationAccountIssueRecord[];
  revenue_check_status: "not_tracked";
  revenue_check_summary: string;
}

export interface LocationContactLinkRecord {
  contact_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  canonical_organization_id: string;
}

export interface DirectoryTouchpointRecord {
  id: string;
  organization_id: string | null;
  location_id: string | null;
  shoot_id: string | null;
  contact_id: string | null;
  channel: DirectoryTouchpointChannel;
  category?: DirectoryTouchpointCategory | null;
  subject?: string | null;
  summary: string;
  outcome: string | null;
  outcome_state?: DirectoryCommunicationOutcome | null;
  owner_user_id: string | null;
  owner_name: string | null;
  occurred_at: string;
  follow_up_date: string | null;
  follow_up_needed?: boolean;
  follow_up_owner?: DirectoryInternalOwnerRecord | null;
  relationship_memory_suggested?: boolean;
  attachment_reference?: string | null;
  touchpoint_plan_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryTouchpointPlanTemplateRecord {
  id: string;
  template_key: string;
  template_name: string;
  category: DirectoryTouchpointCategory;
  scope_hint: "organization" | "location" | "contact";
  summary: string;
  default_offset_days: number | null;
  default_due_time: string | null;
  active_status: boolean;
}

export interface DirectoryTouchpointPlanRecord {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
  template_id: string | null;
  category: DirectoryTouchpointCategory;
  title: string;
  summary: string | null;
  status: DirectoryTouchpointPlanStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  backup_owner?: DirectoryInternalOwnerRecord | null;
  due_at: string;
  completed_at: string | null;
  skipped_reason: string | null;
  cancelled_reason: string | null;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryRelationshipMemoryRecord {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  source_touchpoint_id: string | null;
  memory_type: DirectoryRelationshipMemoryType;
  summary: string;
  why_it_matters: string;
  source_label: string | null;
  visibility: DirectoryRelationshipMemoryVisibility;
  status: DirectoryRelationshipMemoryStatus;
  created_by?: DirectoryInternalOwnerRecord | null;
  reviewed_by?: DirectoryInternalOwnerRecord | null;
  reviewed_at: string | null;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryRelationshipFollowUpRecord {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
  source_touchpoint_id: string | null;
  source_touchpoint_plan_id: string | null;
  title: string;
  summary: string | null;
  owner?: DirectoryInternalOwnerRecord | null;
  backup_owner?: DirectoryInternalOwnerRecord | null;
  due_at: string;
  status: DirectoryRelationshipFollowUpStatus;
  completed_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryRelationshipContinuitySummary {
  relationship_health_state: DirectoryRelationshipHealthState;
  relationship_health_summary: string;
  last_communication_at: string | null;
  last_communication_label: string;
  next_touchpoint_due_at: string | null;
  next_touchpoint_label: string;
  open_follow_up_count: number;
  overdue_follow_up_count: number;
  due_soon_touchpoint_count: number;
  overdue_touchpoint_count: number;
  active_memory_count: number;
  needs_review_memory_count: number;
  stale_key_contact_count: number;
}

export interface DirectoryRelationshipContinuityBundle {
  scope: "organization" | "contact";
  organization_id: string;
  contact_id: string | null;
  generated_at: string;
  summary: DirectoryRelationshipContinuitySummary;
  touchpoint_templates: DirectoryTouchpointPlanTemplateRecord[];
  touchpoint_plans: DirectoryTouchpointPlanRecord[];
  communication_logs: DirectoryTouchpointRecord[];
  relationship_memory: DirectoryRelationshipMemoryRecord[];
  follow_ups: DirectoryRelationshipFollowUpRecord[];
}

export interface DirectoryDuplicateReviewRecord {
  id: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  suspected_duplicate_contact_id: string | null;
  suspected_duplicate_contact_name: string | null;
  status: DirectoryDuplicateReviewStatus;
  decision: DirectoryDuplicateReviewDecision;
  summary: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryContactDetailResponse {
  contact: OrganizationContactRecord;
  touchpoints: DirectoryTouchpointRecord[];
  relationship_continuity?: DirectoryRelationshipContinuityBundle;
}

export interface DirectoryInternalOwnerRecord {
  user_id: string;
  full_name: string;
  email: string | null;
  department: string | null;
  status: string | null;
  relationship_weight?: number;
  last_interaction_at?: string | null;
}

export interface DirectoryRelationshipMaintenanceSignal {
  code: string;
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
}

export interface DirectoryOwnerOption {
  user_id: string;
  full_name: string;
  email: string | null;
  department: string | null;
  status: string | null;
}

export type DirectoryImportColumnMapping = Partial<Record<DirectoryImportColumnKey, string | null>>;

export interface DirectoryImportCandidateMatch {
  contact_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_organization_labels: string[];
  confidence: DirectoryImportMatchConfidence;
  reason: string;
}

export interface DirectoryImportNormalizedContactValues {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  organization_name: string | null;
  organization_type: OrganizationAccountType | null;
  relationship_role: DirectoryContactRelationshipRole | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  active_status: DirectoryActiveStatus;
  resolved_organization_id: string | null;
  resolved_organization_name: string | null;
}

export interface DirectoryImportRowRecord {
  id: string;
  row_number: number;
  status: DirectoryImportRowStatus;
  proposed_action: DirectoryImportRowAction;
  selected_action: DirectoryImportRowAction | null;
  selected_contact_id: string | null;
  resolved_organization_id: string | null;
  review_note: string | null;
  raw_values: Record<string, string | null>;
  normalized_values: DirectoryImportNormalizedContactValues;
  validation_errors: string[];
  warning_messages: string[];
  candidate_matches: DirectoryImportCandidateMatch[];
  applied_contact_id: string | null;
  applied_relationship_id: string | null;
  result_summary: string | null;
}

export interface DirectoryImportSessionSummary {
  total_rows: number;
  ready_to_create: number;
  ready_to_link: number;
  needs_review: number;
  skipped: number;
  invalid: number;
  applied: number;
  errors: number;
}

export interface DirectoryImportSessionListItem {
  id: string;
  source_file_name: string;
  import_kind: "contacts_csv";
  status: DirectoryImportSessionStatus;
  has_header_row: boolean;
  default_organization_id: string | null;
  summary: DirectoryImportSessionSummary;
  created_by_user_id: string | null;
  applied_by_user_id: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryImportSessionRecord {
  id: string;
  source_file_name: string;
  import_kind: "contacts_csv";
  status: DirectoryImportSessionStatus;
  has_header_row: boolean;
  default_organization_id: string | null;
  mapping: DirectoryImportColumnMapping;
  summary: DirectoryImportSessionSummary;
  created_by_user_id: string | null;
  applied_by_user_id: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  rows: DirectoryImportRowRecord[];
}

export interface DirectoryImportSessionListResponse {
  sessions: DirectoryImportSessionListItem[];
  total: number;
}

export type OrganizationOperationsTone = "good" | "info" | "warning" | "critical";

export interface OrganizationOperationsHealthCue {
  code: string;
  label: string;
  detail: string;
  tone: OrganizationOperationsTone;
}

export interface OrganizationOperationsQueueItem {
  id: string;
  kind: "contact_cleanup" | "follow_up" | "duplicate_review" | "project";
  title: string;
  summary: string;
  tone: OrganizationOperationsTone;
  next_action: string;
  action_hash: string;
  owner_label: string;
  due_label: string | null;
  related_contact_id: string | null;
  related_location_id: string | null;
  related_shoot_id: string | null;
}

export interface OrganizationOperationsQueue {
  count: number;
  items: OrganizationOperationsQueueItem[];
}

export interface OrganizationOperationsTimelineItem {
  id: string;
  kind:
    | "touchpoint"
    | "follow_up"
    | "upcoming_shoot"
    | "recent_shoot"
    | "duplicate_review"
    | "project"
    | "account_issue"
    | "sales_follow_up";
  title: string;
  summary: string;
  tone: OrganizationOperationsTone;
  occurred_at: string;
  owner_label: string;
  related_contact_id: string | null;
  related_location_id: string | null;
  related_shoot_id: string | null;
  due_label: string | null;
  action_hash?: string | null;
}

export interface OrganizationOperationsHub {
  organization_id: string;
  generated_at: string;
  summary: {
    last_touch_at: string | null;
    last_touch_label: string;
    next_action: string;
    owner_label: string;
    follow_up_date: string | null;
    follow_up_label: string;
    relationship_health_state: "healthy" | "watch" | "at_risk";
    relationship_health_summary: string;
  };
  health_cues: OrganizationOperationsHealthCue[];
  queues: {
    contact_cleanup: OrganizationOperationsQueue;
    follow_up: OrganizationOperationsQueue;
    duplicate_review: OrganizationOperationsQueue;
    projects: OrganizationOperationsQueue;
  };
  timeline: OrganizationOperationsTimelineItem[];
}

export interface ShootDirectoryContactLinkRecord {
  contact_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  contact_role: "primary" | "additional";
  relationship_role: DirectoryContactRelationshipRole;
  is_primary: boolean;
  sort_order: number;
}

export interface OrganizationDetail {
  organization: OrganizationSummary;
  contacts: OrganizationContactRecord[];
  locations: OrganizationLocationRecord[];
  school_profile?: SchoolProfileRecord | null;
  school_rules?: SchoolRuleRecord[];
  school_activity?: SchoolActivityLogRecord[];
  touchpoints?: DirectoryTouchpointRecord[];
  relationship_continuity?: DirectoryRelationshipContinuityBundle;
  recent_shoots: OrganizationRecentShootRecord[];
  next_shoot: OrganizationUpcomingShootRecord | null;
  sales_opportunities: OrganizationSalesOpportunityPreview[];
  account_overview: OrganizationAccountOverview;
  agreements_access: AgreementAccess;
  agreement_summary: OrganizationAgreementSummary;
  agreements: AgreementRecord[];
  agreement_templates: AgreementTemplateRecord[];
  upcoming_shoot_agreement_risks: AgreementUpcomingShootRisk[];
  sales_pipeline_summary: OrganizationSalesPipelineSummary;
  sales_pipeline_alerts: SalesPipelineAlertRecord[];
  sales_email_templates: SalesEmailTemplateRecord[];
  sales_communications: SalesEmailCommunicationRecord[];
  resource_library: ResourceLibraryView;
  placeholders: {
    agreement_summary: string;
    sales_pipeline_summary: string;
    recent_shoots_summary: string;
    resource_library_summary: string;
  };
}

export interface OrganizationListResponse {
  organizations: OrganizationSummary[];
  search: {
    query: string;
    total: number;
  };
}

export interface DirectoryContactListResponse {
  contacts: DirectoryContactSummary[];
  search: {
    query: string;
    total: number;
  };
}

export interface DirectoryLocationListResponse {
  locations: DirectoryLocationSummary[];
  search: {
    query: string;
    total: number;
  };
}

export interface DirectoryTouchpointListResponse {
  touchpoints: DirectoryTouchpointRecord[];
  total: number;
}

export interface DirectoryDuplicateReviewListResponse {
  reviews: DirectoryDuplicateReviewRecord[];
  total: number;
}

export interface ShootDirectoryContactLinkResponse {
  shoot_id: string;
  organization_id: string | null;
  primary_contact_id: string | null;
  contact_links: ShootDirectoryContactLinkRecord[];
}
