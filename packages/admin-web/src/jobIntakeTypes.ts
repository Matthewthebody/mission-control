import type {
  DirectoryOwnerOption,
  OrganizationAccountType,
  OrganizationContact,
  OrganizationDetail,
  OrganizationLocation,
  OrganizationSummary
} from "./types";

export const CENTRAL_JOB_DEPARTMENTS = ["schools", "sports"] as const;
export type CentralJobDepartment = (typeof CENTRAL_JOB_DEPARTMENTS)[number];

export const CENTRAL_JOB_REQUEST_SOURCES = [
  "manual",
  "smart_paste",
  "bulk_import",
  "api",
  "converted_from_inquiry",
  "internal_request"
] as const;
export type CentralJobRequestSource = (typeof CENTRAL_JOB_REQUEST_SOURCES)[number];

export const CENTRAL_JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CentralJobPriority = (typeof CENTRAL_JOB_PRIORITIES)[number];

export const CENTRAL_JOB_DELIVERY_TYPES = [
  "ship_to_home",
  "school_delivery",
  "digital_gallery",
  "specialty_products",
  "mixed"
] as const;
export type CentralJobDeliveryType = (typeof CENTRAL_JOB_DELIVERY_TYPES)[number];

export const CENTRAL_JOB_PRODUCTION_GROUPING_RULES = [
  "one_per_job",
  "one_per_day",
  "one_per_delivery",
  "one_per_gallery",
  "manual"
] as const;
export type CentralJobProductionGroupingRule = (typeof CENTRAL_JOB_PRODUCTION_GROUPING_RULES)[number];

export type CentralJobRecordState = "draft" | "published" | "cancelled" | "archived";
export type CentralJobStatus = "new" | "confirmed" | "scheduled" | "in_progress" | "in_production" | "complete" | "cancelled";
export type CentralJobReadinessStatus = "blocked" | "needs_info" | "ready";
export type CentralJobSyncStatus = "not_linked" | "pending_sync" | "in_sync" | "sync_warning" | "sync_error";
export type CentralJobReadinessItemStatus = "pending" | "resolved" | "waived";
export type CentralJobDuplicateDisposition = "clear" | "soft_warning" | "hard_block";
export type CentralJobValidationSeverity = "error" | "warning";
export type CentralJobSmartPasteConfidenceBand = "high" | "medium" | "low";
export type CentralJobCanonicalJobType = OrganizationAccountType;

export interface CentralSchoolJobDetailInput {
  school_job_type?: string | null;
  school_type?: string | null;
  student_count_estimate?: number | null;
  staff_count_estimate?: number | null;
  grade_range?: string | null;
  camera_count_estimate?: number | null;
  roster_status?: string | null;
  roster_due_date?: string | null;
  id_required?: boolean | null;
  id_sort_method?: string | null;
  yearbook_required?: boolean | null;
  yearbook_due_date?: string | null;
  staff_packages_required?: boolean | null;
  parent_communication_needed?: boolean | null;
  background_requirements?: string | null;
  school_day_notes?: string | null;
  building_instructions?: string | null;
  photo_day_special_notes?: string | null;
}

export interface CentralSportsJobDetailInput {
  sports_job_type?: string | null;
  sport_name?: string | null;
  season?: string | null;
  level_or_age_group?: string | null;
  team_count_estimate?: number | null;
  athlete_count_estimate?: number | null;
  coach_count_estimate?: number | null;
  coach_contact_id?: string | null;
  alternate_team_contact_id?: string | null;
  specialty_products_required?: boolean | null;
  specialty_product_types?: string[] | null;
  gallery_required?: boolean | null;
  delivery_deadline_type?: string | null;
  uniform_notes?: string | null;
  sponsor_notes?: string | null;
  event_notes?: string | null;
  on_site_sales_notes?: string | null;
}

export interface CentralJobDayInput {
  day_index?: number | null;
  shoot_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  location_id?: string | null;
  date_only?: boolean | null;
  start_time_confirmed?: boolean | null;
}

export interface CentralJobIntakeInput {
  department?: CentralJobDepartment | null;
  job_type?: CentralJobCanonicalJobType | null;
  job_title?: string | null;
  request_source?: CentralJobRequestSource | null;
  source_reference?: string | null;
  organization_id?: string | null;
  unresolved_organization_name?: string | null;
  location_id?: string | null;
  unresolved_location_name?: string | null;
  primary_contact_id?: string | null;
  unresolved_primary_contact_name?: string | null;
  account_owner_user_id?: string | null;
  job_owner_user_id?: string | null;
  start_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  date_only?: boolean | null;
  is_multi_day?: boolean | null;
  delivery_due_date?: string | null;
  production_required?: boolean | null;
  staffing_required?: boolean | null;
  staffing_estimate?: number | null;
  priority?: CentralJobPriority | null;
  delivery_type?: CentralJobDeliveryType | null;
  production_grouping_rule?: CentralJobProductionGroupingRule | null;
  internal_notes?: string | null;
  client_notes?: string | null;
  special_instructions?: string | null;
  raw_source_text?: string | null;
  duplicate_override_note?: string | null;
  days?: CentralJobDayInput[] | null;
  school_detail?: CentralSchoolJobDetailInput | null;
  sports_detail?: CentralSportsJobDetailInput | null;
}

export interface CentralJobValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: CentralJobValidationSeverity;
}

export interface CentralJobValidationResult {
  valid: boolean;
  errors: CentralJobValidationIssue[];
  warnings: CentralJobValidationIssue[];
}

export interface CentralJobReadinessIssue {
  code: string;
  label: string;
  message: string;
  field: string;
  blocking: boolean;
}

export interface CentralJobReadinessEvaluation {
  readiness_status: CentralJobReadinessStatus;
  blockers: CentralJobReadinessIssue[];
  warnings: CentralJobReadinessIssue[];
  items: Array<{
    code: string;
    label: string;
    blocking: boolean;
    status: CentralJobReadinessItemStatus;
    detail: string | null;
  }>;
}

export interface CentralJobDuplicateMatch {
  id: string;
  shoot_code: string;
  job_number: string | null;
  title: string;
  match_source?: "existing_job" | "import_row";
  department: CentralJobDepartment;
  job_type: CentralJobCanonicalJobType | null;
  job_subtype: string | null;
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  unresolved_location_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  start_date: string | null;
  delivery_due_date: string | null;
  record_state: CentralJobRecordState;
  job_status: CentralJobStatus;
  hard_block: boolean;
  soft_warning: boolean;
  matched_rules: string[];
}

export interface CentralJobDuplicateResult {
  disposition: CentralJobDuplicateDisposition;
  hard_block: boolean;
  soft_warning: boolean;
  matching_records: CentralJobDuplicateMatch[];
  checked_at: string;
}

export interface CentralJobSmartPasteSourceSpan {
  start: number;
  end: number;
  text: string;
}

export interface CentralJobSmartPasteFieldInference {
  field: string;
  label: string;
  value: string | number | boolean | string[] | null;
  display_value: string | null;
  confidence_band: CentralJobSmartPasteConfidenceBand;
  confidence_score: number;
  source_span: CentralJobSmartPasteSourceSpan | null;
  requires_confirmation: boolean;
}

export interface CentralJobSmartPasteEntityCandidate {
  kind: "organization" | "location" | "primary_contact";
  value: string;
  confidence_band: CentralJobSmartPasteConfidenceBand;
  confidence_score: number;
  source_span: CentralJobSmartPasteSourceSpan | null;
  requires_confirmation: boolean;
}

export interface CentralJobSmartPasteParseResult {
  raw_text: string;
  department_hint: CentralJobDepartment | null;
  parsed_input: CentralJobIntakeInput;
  inferred_fields: CentralJobSmartPasteFieldInference[];
  unresolved_entities: {
    organization: CentralJobSmartPasteEntityCandidate | null;
    location: CentralJobSmartPasteEntityCandidate | null;
    primary_contact: CentralJobSmartPasteEntityCandidate | null;
  };
  warnings: string[];
}

export interface CentralJobOrganizationDefaults {
  organization_id: string;
  organization_name: string;
  department: CentralJobDepartment;
  account_owner_user_id: string | null;
  default_location_id: string | null;
  default_location_name: string | null;
  default_primary_contact_id: string | null;
  default_primary_contact_name: string | null;
  timezone: string;
  production_required: boolean;
  staffing_required: boolean;
}

export interface CentralJobRecord {
  id: string;
  tenant_id: string;
  shoot_code: string;
  title: string;
  organization_display_name?: string | null;
  location_display_name?: string | null;
  primary_contact_name?: string | null;
  account_owner_name?: string | null;
  job_owner_name?: string | null;
  job_number: string | null;
  department: CentralJobDepartment;
  job_type: CentralJobCanonicalJobType | null;
  source_reference: string | null;
  record_state: CentralJobRecordState;
  job_status: CentralJobStatus;
  readiness_status: CentralJobReadinessStatus;
  sync_status: CentralJobSyncStatus;
  organization_id: string | null;
  unresolved_organization_name: string | null;
  location_id: string | null;
  unresolved_location_name: string | null;
  primary_contact_id: string | null;
  unresolved_primary_contact_name: string | null;
  account_owner_user_id: string | null;
  job_owner_user_id: string | null;
  start_date: string | null;
  schedule_date_placeholder: boolean;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  date_only: boolean;
  start_time_confirmed: boolean;
  is_multi_day: boolean;
  delivery_due_date: string | null;
  production_required: boolean;
  staffing_required: boolean;
  staffing_estimate: number | null;
  priority: CentralJobPriority;
  delivery_type: CentralJobDeliveryType | null;
  production_grouping_rule: CentralJobProductionGroupingRule;
  request_source: CentralJobRequestSource;
  internal_notes: string | null;
  client_notes: string | null;
  special_instructions: string | null;
  raw_source_text: string | null;
  merge_parent_job_id: string | null;
  duplicate_override_note: string | null;
  duplicate_check_completed_at: string | null;
  created_by: string | null;
  updated_by_user_id: string | null;
  published_by_user_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CentralJobDayRecord {
  id: string;
  shoot_id: string;
  day_index: number;
  shoot_date: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  location_id: string | null;
  date_only: boolean;
  start_time_confirmed: boolean;
}

export interface CentralSchoolJobDetailRecord {
  shoot_id: string;
  school_job_type: string | null;
  school_type: string | null;
  student_count_estimate: number | null;
  staff_count_estimate: number | null;
  grade_range: string | null;
  camera_count_estimate: number | null;
  roster_status: string | null;
  roster_due_date: string | null;
  id_required: boolean;
  id_sort_method: string | null;
  yearbook_required: boolean;
  yearbook_due_date: string | null;
  staff_packages_required: boolean;
  parent_communication_needed: boolean;
  background_requirements: string | null;
  school_day_notes: string | null;
  building_instructions: string | null;
  photo_day_special_notes: string | null;
}

export interface CentralSportsJobDetailRecord {
  shoot_id: string;
  sports_job_type: string | null;
  sport_name: string | null;
  season: string | null;
  level_or_age_group: string | null;
  team_count_estimate: number | null;
  athlete_count_estimate: number | null;
  coach_count_estimate: number | null;
  coach_contact_id: string | null;
  alternate_team_contact_id: string | null;
  specialty_products_required: boolean;
  specialty_product_types: string[];
  gallery_required: boolean;
  delivery_deadline_type: string | null;
  uniform_notes: string | null;
  sponsor_notes: string | null;
  event_notes: string | null;
  on_site_sales_notes: string | null;
}

export interface CentralJobProductionItemRecord {
  id: string;
  tenant_id: string;
  linked_shoot_id: string;
  title: string;
  status: string;
  stage: string | null;
  priority: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  current_step_label: string | null;
  created_reason: string;
  source_trigger_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface CentralJobStaffingRequirementRecord {
  id: string;
  tenant_id: string;
  shoot_id: string;
  source_of_creation: string;
  staffing_role: string;
  label: string;
  minimum_count: number;
  ideal_count: number;
  required_for_ready: boolean;
  lead_required: boolean;
  role_notes: string | null;
  sort_order: number;
  assigned_count: number;
  open_count: number;
  created_at: string;
  updated_at: string;
}

export interface CentralJobActivityLogRecord {
  id: string;
  tenant_id: string;
  shoot_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_name?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CentralJobDraftListItem {
  id: string;
  title: string;
  department: CentralJobDepartment;
  job_number: string | null;
  organization_display_name: string | null;
  unresolved_organization_name: string | null;
  start_date: string | null;
  updated_at: string;
  created_at: string;
  job_owner_user_id: string | null;
  job_owner_name: string | null;
  created_by: string | null;
  updated_by_user_id: string | null;
  is_user_relevant: boolean;
}

export interface CentralJobIntakeResponse {
  job: CentralJobRecord;
  job_days: CentralJobDayRecord[];
  school_detail: CentralSchoolJobDetailRecord | null;
  sports_detail: CentralSportsJobDetailRecord | null;
  draft_validation: CentralJobValidationResult;
  publish_validation: CentralJobValidationResult;
  readiness: CentralJobReadinessEvaluation;
  production_items: CentralJobProductionItemRecord[];
  staffing_requirements: CentralJobStaffingRequirementRecord[];
  activity_log: CentralJobActivityLogRecord[];
}

export type CentralJobDraftResponse = CentralJobIntakeResponse;

export interface CentralJobPublishResult {
  intake: CentralJobIntakeResponse;
  duplicates: CentralJobDuplicateResult;
  redirect_target: string;
  downstream: {
    production_project_ids: string[];
    staffing_requirement_ids: string[];
  };
}

export type CentralJobFormErrors = {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
  duplicateResult: CentralJobDuplicateResult | null;
};

export type CentralJobLookupBundle = {
  owners: DirectoryOwnerOption[];
  organizations: OrganizationSummary[];
  organizationDetail: OrganizationDetail | null;
  locations: OrganizationLocation[];
  contacts: OrganizationContact[];
};

export type CentralJobImportCommitMode =
  | "create_drafts_only"
  | "publish_valid_rows_leave_exceptions"
  | "publish_all_valid_rows_with_acknowledgement";

export type CentralJobImportFieldKey =
  | "job_type"
  | "job_title"
  | "source_reference"
  | "organization_name"
  | "location_name"
  | "primary_contact_name"
  | "job_owner"
  | "account_owner"
  | "start_date"
  | "start_time"
  | "end_time"
  | "timezone"
  | "date_only"
  | "is_multi_day"
  | "delivery_due_date"
  | "production_required"
  | "staffing_required"
  | "staffing_estimate"
  | "priority"
  | "delivery_type"
  | "production_grouping_rule"
  | "internal_notes"
  | "client_notes"
  | "special_instructions"
  | "school_job_type"
  | "school_type"
  | "roster_status"
  | "roster_due_date"
  | "id_required"
  | "id_sort_method"
  | "yearbook_required"
  | "yearbook_due_date"
  | "background_requirements"
  | "school_day_notes"
  | "building_instructions"
  | "photo_day_special_notes"
  | "sports_job_type"
  | "sport_name"
  | "season"
  | "level_or_age_group"
  | "specialty_products_required"
  | "specialty_product_types"
  | "gallery_required"
  | "delivery_deadline_type"
  | "uniform_notes"
  | "sponsor_notes"
  | "event_notes"
  | "on_site_sales_notes";

export interface CentralJobImportFieldOption {
  key: CentralJobImportFieldKey;
  label: string;
  section: string;
  department: CentralJobDepartment | "shared";
  required_for_publish?: boolean;
}

export type CentralJobImportColumnMapping = Partial<Record<CentralJobImportFieldKey, string | null>>;

export interface CentralJobImportIssueSummary {
  field: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface CentralJobImportRowSummary {
  row_number: number;
  title: string;
  department: CentralJobDepartment;
  organization_name: string | null;
  location_name: string | null;
  primary_contact_name: string | null;
  start_date: string | null;
  delivery_due_date: string | null;
  job_type: CentralJobCanonicalJobType | null;
  department_subtype: string | null;
}

export interface CentralJobImportRowReview {
  id: string;
  row_number: number;
  status: string;
  summary: CentralJobImportRowSummary;
  normalized_input: CentralJobIntakeInput | null;
  validation_errors: CentralJobImportIssueSummary[];
  validation_warnings: CentralJobImportIssueSummary[];
  duplicate_result: CentralJobDuplicateResult | null;
  readiness: CentralJobReadinessEvaluation | null;
  can_create_draft: boolean;
  can_publish: boolean;
  can_publish_with_acknowledgement: boolean;
  linked_job_id: string | null;
}

export interface CentralJobImportSessionRecord {
  id: string;
  tenant_id: string;
  department: CentralJobDepartment | null;
  source_filename: string;
  source_type: string;
  status: string;
  mappings: Record<string, unknown>;
  stats: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CentralJobImportSessionSummary {
  total_rows: number;
  uploaded_rows: number;
  exception_rows: number;
  draft_ready_rows: number;
  publish_ready_rows: number;
  publish_ack_required_rows: number;
  hard_duplicate_rows: number;
  soft_duplicate_rows: number;
  drafts_created: number;
  jobs_published: number;
  duplicates_blocked: number;
  duplicates_overridden: number;
}

export interface CentralJobImportSessionResponse {
  session: CentralJobImportSessionRecord;
  headers: string[];
  mapping: CentralJobImportColumnMapping;
  supported_fields: CentralJobImportFieldOption[];
  rows: CentralJobImportRowReview[];
  summary: CentralJobImportSessionSummary;
}

export interface CentralJobImportCommitResult {
  session: CentralJobImportSessionRecord;
  summary: CentralJobImportSessionSummary;
  rows: CentralJobImportRowReview[];
  commit_mode: CentralJobImportCommitMode;
}
