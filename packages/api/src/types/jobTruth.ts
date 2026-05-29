import type {
  AlertDeliveryChannel,
  AlertDeliveryStatus,
  DashboardHealthState,
  JobApprovalStatus,
  JobAssignmentRole,
  JobAssignmentStatus,
  JobCategory,
  JobDeliverableStatus,
  JobDayStatus,
  JobDepartmentType,
  JobHandoffStatus,
  JobPriorityLevel,
  JobProductionStatus,
  JobProductionIssueStatus,
  JobQaReviewStatus,
  JobReadinessStatus,
  JobRiskStatus,
  JobStatus,
  JobSyncStatus,
  JobWatchFlagSeverity,
  JobWatchFlagStatus,
  ProductionBoardFileMatchStatus,
  ProductionBoardHealthState,
  ProductionBoardReleaseStatus,
  ProductionBoardSyncState,
  ProductionBoardUploadStatus,
  ProductionBoardWorkflowStatus
} from "../domain/jobTruth/index.js";
import type { ChecklistTransitionValidation } from "./checklists.js";
import type { ChecklistAttentionItem, ChecklistAttentionSummary } from "./checklists.js";
import type { SharedResourcePolicySnapshot } from "./policy.js";
import type { ActivityTimelineEntry } from "./activityTimeline.js";
import type { SharedWorkflowJobDetail } from "./sharedWorkflow.js";

type TimestampValue = string | Date;

export interface JobRecord {
  id: string;
  tenant_id: string;
  legacy_shoot_id: string | null;
  job_number: string | null;
  department_type: JobDepartmentType;
  job_category: JobCategory;
  organization_id: string | null;
  primary_location_id: string | null;
  primary_contact_id: string | null;
  account_owner_user_id: string | null;
  title: string;
  event_name: string | null;
  description_internal: string | null;
  job_status: JobStatus;
  production_status: JobProductionStatus;
  staffing_status: import("../domain/jobTruth/index.js").JobStaffingStatus;
  readiness_status: JobReadinessStatus;
  sync_status: JobSyncStatus;
  risk_status: JobRiskStatus;
  priority_level: JobPriorityLevel;
  delivery_type: string | null;
  gallery_type: string | null;
  scheduled_start_at: TimestampValue | null;
  scheduled_end_at: TimestampValue | null;
  timezone: string;
  estimated_subject_count: number | null;
  actual_subject_count: number | null;
  estimated_staff_count: number | null;
  actual_staff_count: number | null;
  client_deadline_at: TimestampValue | null;
  production_deadline_at: TimestampValue | null;
  published_at: TimestampValue | null;
  archived_at: TimestampValue | null;
  cancelled_at: TimestampValue | null;
  cancel_reason: string | null;
  production_required: boolean;
  location_override_note: string | null;
  contact_override_note: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/**
 * Canonical operational event record for the phase-one spine.
 *
 * The backing table and many routes still use legacy "day" terminology.
 * That naming remains for compatibility, but engineering should treat this
 * object as the canonical `Event`.
 */
export interface EventRecord {
  id: string;
  tenant_id: string;
  job_id: string;
  legacy_shoot_day_id: string | null;
  day_label: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  location_id: string | null;
  onsite_contact_id: string | null;
  lead_user_id: string | null;
  day_status: JobDayStatus;
  weather_sensitive: boolean;
  indoor_outdoor: string | null;
  access_notes: string | null;
  parking_notes: string | null;
  setup_notes: string | null;
  travel_notes: string | null;
  check_in_window_start: TimestampValue | null;
  check_in_window_end: TimestampValue | null;
  ready_confirmed_at: TimestampValue | null;
  ready_confirmed_by_user_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/** @deprecated Use `EventRecord` in new code. */
export type JobDayRecord = EventRecord;

/**
 * Canonical staffing assignment record for the phase-one spine.
 *
 * The backing table still uses `job_day_id` for compatibility with legacy job-day naming.
 * New code should treat this object as the canonical `StaffAssignment`.
 */
export interface StaffAssignmentRecord {
  id: string;
  tenant_id: string;
  job_id: string;
  job_day_id: string | null;
  user_id: string;
  assignment_role: JobAssignmentRole;
  assignment_status: JobAssignmentStatus;
  is_lead: boolean;
  check_in_at: TimestampValue | null;
  check_out_at: TimestampValue | null;
  is_ready_present: boolean;
  notes: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/** @deprecated Use `StaffAssignmentRecord` in new code. */
export type JobStaffAssignmentRecord = StaffAssignmentRecord;

export interface JobDetailEventRecord extends EventRecord {
  location_name: string | null;
  onsite_contact_name: string | null;
  lead_user_name: string | null;
}

export interface JobDetailStaffAssignmentRecord extends StaffAssignmentRecord {
  user_name: string | null;
}

/**
 * Compatibility detail record for legacy job-scoped watch flag payloads.
 *
 * @deprecated New operator-facing issue work should use the canonical Exceptions
 * contracts in `types/exceptions.ts` or the canonical job-scoped exception
 * contracts later in this file.
 */
export interface JobDetailExceptionRecord extends JobWatchFlagRecord {
  owner_name: string | null;
  resolved_by_name: string | null;
}

export interface JobReadinessItemRecord {
  id: string;
  tenant_id: string;
  job_id: string;
  job_day_id: string | null;
  section_key: string;
  label: string;
  description: string | null;
  is_required: boolean;
  is_blocker: boolean;
  is_complete: boolean;
  completed_at: TimestampValue | null;
  completed_by_user_id: string | null;
  due_at: TimestampValue | null;
  sort_order: number;
  source_template_key: string | null;
  notes: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/**
 * Production records remain a compatibility seam during phase one.
 *
 * They may continue to exist temporarily, but they are not the canonical permanent
 * operating spine. New cross-department workflow design should anchor to
 * Job -> Event -> StaffAssignment -> Task and treat production-specific records as
 * an internal compatibility layer until the shared workflow engine absorbs them.
 */
export interface ProductionItemRecord {
  id: string;
  tenant_id: string;
  job_id: string;
  job_day_id: string | null;
  production_group_key: string;
  title: string;
  job_type: string | null;
  production_type: string;
  production_template_key: string | null;
  completion_rule_key: string | null;
  created_from_source: string;
  status: JobProductionStatus;
  workflow_status: ProductionBoardWorkflowStatus;
  health_state: ProductionBoardHealthState;
  sync_state: ProductionBoardSyncState;
  priority: JobPriorityLevel;
  assigned_to_user_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  primary_contact_id: string | null;
  account_owner_user_id: string | null;
  department_owner_user_id: string | null;
  assigned_peer_reviewer_user_id: string | null;
  assigned_release_reviewer_user_id: string | null;
  escalation_owner_user_id: string | null;
  department_type: JobDepartmentType;
  shoot_date_start: string | null;
  shoot_date_end: string | null;
  production_start_at: TimestampValue | null;
  approval_required: boolean;
  proof_required: boolean;
  qa_required: boolean;
  due_at: TimestampValue | null;
  release_due_at: TimestampValue | null;
  delivery_deadline_at: TimestampValue | null;
  completed_at: TimestampValue | null;
  closed_at: TimestampValue | null;
  readiness_score: number;
  blocker_count: number;
  rework_count: number;
  file_count_expected: number | null;
  file_count_received: number | null;
  file_match_status: ProductionBoardFileMatchStatus;
  roster_received: boolean;
  naming_verified: boolean;
  folder_structure_verified: boolean;
  tags_or_flags_verified: boolean;
  handoff_complete: boolean;
  upload_status: ProductionBoardUploadStatus;
  release_status: ProductionBoardReleaseStatus;
  release_target: string | null;
  gallery_or_output_reference: string | null;
  vendor_name: string | null;
  vendor_reference: string | null;
  blocked_reason: string | null;
  client_visible_label: string | null;
  qa_status: string;
  creator_review_complete: boolean;
  peer_review_complete: boolean;
  final_release_review_complete: boolean;
  qa_fail_count: number;
  first_pass_approved: boolean;
  internal_notes: string | null;
  production_notes: string | null;
  post_shoot_eval_summary: string | null;
  risk_flag: boolean;
  legacy_source_reference: string | null;
  imported_status_source: string | null;
  legacy_owner_history_json: Array<Record<string, unknown>> | null;
  hold_reason: string | null;
  hold_owner_user_id: string | null;
  hold_review_at: TimestampValue | null;
  merged_into_production_item_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface JobShootLinkRecord {
  id: string;
  tenant_id: string;
  job_id: string;
  shoot_id: string;
  link_reason: string;
  created_at: TimestampValue;
}

export interface ProductionItemShootLinkRecord {
  id: string;
  tenant_id: string;
  production_item_id: string;
  shoot_id: string;
  created_at: TimestampValue;
}

export interface ProductionHandoffRecord {
  id: string;
  tenant_id: string;
  production_item_id: string;
  handoff_type: string;
  from_stage: string;
  to_stage: string;
  from_user_id: string | null;
  to_user_id: string | null;
  status: JobHandoffStatus;
  note: string | null;
  completed_at: TimestampValue | null;
  created_at: TimestampValue;
}

export interface ApprovalRequestRecord {
  id: string;
  tenant_id: string;
  production_item_id: string;
  job_id: string;
  job_day_id: string | null;
  approval_type: string;
  approver_contact_id: string | null;
  approver_user_id: string | null;
  status: JobApprovalStatus;
  requested_at: TimestampValue | null;
  viewed_at: TimestampValue | null;
  approved_at: TimestampValue | null;
  rejected_at: TimestampValue | null;
  revision_requested_at: TimestampValue | null;
  due_at: TimestampValue | null;
  last_follow_up_at: TimestampValue | null;
  revision_count: number;
  summary: string | null;
  notes: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface QaReviewRecord {
  id: string;
  tenant_id: string;
  production_item_id: string;
  job_id: string;
  review_type: string;
  review_stage: string;
  reviewer_user_id: string;
  requested_by_user_id: string | null;
  status: JobQaReviewStatus;
  decision: string | null;
  reviewed_at: TimestampValue | null;
  sample_size_percent: number | null;
  checklist_template_key: string | null;
  question_answers_json: Record<string, unknown>;
  notes: string | null;
  decision_reason: string | null;
  issue_category: string | null;
  rework_required: boolean;
  sent_back_to_user_id: string | null;
  override_same_reviewer: boolean;
  override_reason: string | null;
  original_owner_user_id: string | null;
  accountability_stage_key: string | null;
  accountable_owner_user_id: string | null;
  accountable_reviewer_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface QaReviewFindingRecord {
  id: string;
  tenant_id: string;
  qa_review_record_id: string;
  finding_type: string;
  severity: JobWatchFlagSeverity;
  title: string;
  description: string;
  is_blocking: boolean;
  resolved_at: TimestampValue | null;
  resolved_by_user_id: string | null;
  created_at: TimestampValue;
}

export interface DeliverableItemRecord {
  id: string;
  tenant_id: string;
  production_item_id: string;
  parent_deliverable_item_id: string | null;
  deliverable_type: string;
  deliverable_group_key: string | null;
  completion_marker_key: string | null;
  title: string;
  quantity: number | null;
  delivery_method: string;
  status: JobDeliverableStatus;
  vendor_name: string | null;
  tracking_reference: string | null;
  delivered_at: TimestampValue | null;
  recipient_contact_id: string | null;
  recipient_organization_id: string | null;
  notes: string | null;
  legacy_source_reference: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ProductionIssueRecord {
  id: string;
  tenant_id: string;
  production_item_id: string;
  job_id: string;
  issue_type: string;
  severity: JobWatchFlagSeverity;
  title: string;
  description: string;
  status: JobProductionIssueStatus;
  is_blocking: boolean;
  source_key: string | null;
  owner_user_id: string | null;
  created_by_user_id: string | null;
  due_at: TimestampValue | null;
  resolved_at: TimestampValue | null;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export type ProductionBlockerRecord = ProductionIssueRecord;

/**
 * Compatibility storage and legacy-route record for jobs/watch and watchlist era payloads.
 *
 * @deprecated New operator-facing issue work should use the canonical Exceptions
 * contracts in `types/exceptions.ts`. New job-scoped queue work should prefer
 * `JobExceptionListItem`, `JobExceptionQueueSummary`, and `JobExceptionQueueResponse`.
 */
export interface JobWatchFlagRecord {
  id: string;
  tenant_id: string;
  job_id: string;
  job_day_id: string | null;
  production_item_id: string | null;
  approval_request_id: string | null;
  qa_review_record_id: string | null;
  deliverable_item_id: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  severity: JobWatchFlagSeverity;
  flag_type: string;
  title: string;
  description: string | null;
  status: JobWatchFlagStatus;
  owner_user_id: string | null;
  created_by_user_id: string | null;
  due_at: TimestampValue | null;
  snooze_until: TimestampValue | null;
  escalated_at: TimestampValue | null;
  escalated_to_role: string | null;
  resolved_at: TimestampValue | null;
  resolved_by_user_id: string | null;
  auto_key: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface AlertEventRecord {
  id: string;
  tenant_id: string;
  watch_flag_id: string | null;
  source_entity_type: string;
  source_entity_id: string | null;
  alert_type: string;
  severity: JobWatchFlagSeverity;
  title: string;
  message: string;
  status: string;
  triggered_at: TimestampValue;
  dedupe_key: string;
  payload_json: Record<string, unknown> | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface AlertDeliveryRecord {
  id: string;
  tenant_id: string;
  alert_event_id: string;
  recipient_user_id: string;
  delivery_channel: AlertDeliveryChannel;
  delivery_status: AlertDeliveryStatus;
  delivered_at: TimestampValue | null;
  read_at: TimestampValue | null;
  acted_at: TimestampValue | null;
  action_type: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface DashboardWidgetPreferenceRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  dashboard_scope: string;
  widget_key: string;
  position_index: number;
  is_visible: boolean;
  settings_json: Record<string, unknown> | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/**
 * Canonical saved-view record for job-scoped exception queues.
 *
 * Storage and legacy routes still use watchlist terminology for compatibility,
 * but new code should anchor to `ExceptionSavedViewRecord`.
 */
export interface ExceptionSavedViewRecord {
  id: string;
  tenant_id: string;
  owner_user_id: string | null;
  scope_type: string;
  department_type: JobDepartmentType | null;
  name: string;
  filters_json: Record<string, unknown>;
  is_default: boolean;
  is_shared: boolean;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/** @deprecated Use `ExceptionSavedViewRecord` in new code. */
export type WatchlistSavedViewRecord = ExceptionSavedViewRecord;

export interface EscalationRuleRecord {
  id: string;
  tenant_id: string;
  rule_key: string;
  department_type: JobDepartmentType | null;
  flag_type: string;
  severity: JobWatchFlagSeverity;
  threshold_minutes: number | null;
  threshold_hours: number | null;
  threshold_days: number | null;
  escalate_to_role: string;
  is_active: boolean;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ActivityLogEntryRecord {
  id: string;
  tenant_id: string;
  job_id: string | null;
  job_day_id: string | null;
  production_item_id: string | null;
  watch_flag_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  contact_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  resource_type: string | null;
  resource_id: string | null;
  parent_resource_type: string | null;
  parent_resource_id: string | null;
  department_type: JobDepartmentType | null;
  message: string | null;
  old_values_json: Record<string, unknown> | null;
  new_values_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
  visibility_level: string | null;
  created_at: TimestampValue;
}

export interface SchoolJobProfileRecord {
  job_id: string;
  tenant_id: string;
  school_type: string | null;
  district_id: string | null;
  school_year: string | null;
  grade_scope: string | null;
  roster_source: string | null;
  id_cards_required: boolean;
  yearbook_required: boolean;
  composite_required: boolean;
  admin_portal_required: boolean;
  submission_deadline: string | null;
  advisor_sorting_required: boolean;
  homeroom_sorting_required: boolean;
  data_import_mode: string | null;
  special_instructions: string | null;
}

export interface SportsJobProfileRecord {
  job_id: string;
  tenant_id: string;
  sport_type: string | null;
  season: string | null;
  league_name: string | null;
  division: string | null;
  team_structure: string | null;
  estimated_team_count: number | null;
  proof_required: boolean;
  approval_contact_id: string | null;
  billing_contact_id: string | null;
  revenue_share_enabled: boolean | null;
  revenue_share_terms_summary: string | null;
  banner_work_required: boolean;
  specialty_products_required: boolean;
  buddy_photos_required: boolean;
  sponsor_graphics_required: boolean;
  client_expectations_notes: string | null;
}

export interface SchoolJobProfileView extends SchoolJobProfileRecord {
  district_name: string | null;
}

export interface SportsJobProfileView extends SportsJobProfileRecord {
  approval_contact_name: string | null;
  billing_contact_name: string | null;
}

export interface JobValidationIssue {
  field: string;
  message: string;
  code: string;
}

export interface JobValidationResult {
  valid: boolean;
  errors: JobValidationIssue[];
}

export type WorkflowIssueLevel = "hard_block" | "warning";
export type WorkflowCheckpointState = "clear" | "warning" | "blocked";
export type WorkflowSubjectType = "job" | "job_day" | "production_item" | "approval_request" | "evaluation";

export interface WorkflowIssue {
  code: string;
  level: WorkflowIssueLevel;
  subject_type: WorkflowSubjectType;
  subject_id: string | null;
  field: string | null;
  message: string;
  action_label: string | null;
  metadata: Record<string, unknown> | null;
}

export interface WorkflowCheckpointSummary {
  key: string;
  label: string;
  state: WorkflowCheckpointState;
  blocker_count: number;
  warning_count: number;
  summary: string;
  next_action: string | null;
  issues: WorkflowIssue[];
}

export interface WorkflowTransitionValidation {
  subject_type: WorkflowSubjectType;
  subject_id: string | null;
  transition_key: string;
  current_state: string | null;
  target_state: string;
  allowed: boolean;
  hard_blocked: boolean;
  blocker_count: number;
  warning_count: number;
  issues: WorkflowIssue[];
  checklist_validation: ChecklistTransitionValidation | null;
}

export interface JobWorkflowSummary {
  publish: WorkflowCheckpointSummary;
  readiness: WorkflowCheckpointSummary;
  production: WorkflowCheckpointSummary;
  approvals: WorkflowCheckpointSummary;
  evaluations: WorkflowCheckpointSummary;
}

export interface JobStatusSnapshot {
  readiness_percent: number;
  job_status: JobStatus;
  production_status: JobProductionStatus;
  staffing_status: import("../domain/jobTruth/index.js").JobStaffingStatus;
  readiness_status: JobReadinessStatus;
  risk_status: JobRiskStatus;
  blocker_count: number;
  open_watch_flag_count: number;
}

export type JobPrepReadinessStatus = "ready" | "needs_attention" | "blocked";
export type JobPrepReadinessWarningSeverity = "info" | "warning" | "blocker";
export type JobPrepLocationAttachmentAudience = "client_facing" | "employee_facing" | "internal_only";

export interface JobPrepRecipientPreview {
  id: string;
  display_name: string;
  title: string | null;
  email: string | null;
  mobile_phone: string | null;
  client_roles: string[];
}

export interface JobPrepExcludedContactPreview extends JobPrepRecipientPreview {
  prep_email_exclusion_reason: string | null;
  prep_sms_exclusion_reason: string | null;
}

export interface JobPrepLocationAttachmentPreview {
  id: string;
  title: string;
  description: string | null;
  attachment_type: string;
  audience: JobPrepLocationAttachmentAudience;
  file_url: string | null;
  storage_key: string | null;
}

export interface JobPrepClientLocationPreview {
  id: string;
  location_name: string;
  address_display: string | null;
  google_maps_url: string | null;
  client_facing_notes: string | null;
  reference_attachments: JobPrepLocationAttachmentPreview[];
}

export interface JobPrepEmployeeLocationPreview extends JobPrepClientLocationPreview {
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
  employee_facing_notes: string | null;
  internal_only_notes: string | null;
}

export interface JobPrepReadinessWarning {
  code: string;
  severity: JobPrepReadinessWarningSeverity;
  label: string;
  detail: string | null;
}

export interface JobPrepMessagePreview {
  preview_only: true;
  template_key: "client_prep_email_v1" | "client_prep_sms_v1" | "employee_briefing_v1";
  label: string;
  channel: "email" | "sms" | "internal_briefing";
  can_preview: boolean;
  recipients: JobPrepRecipientPreview[];
  subject: string | null;
  body_lines: string[];
  warnings: JobPrepReadinessWarning[];
  reference_attachments: JobPrepLocationAttachmentPreview[];
}

export interface JobPrepReadinessPreview {
  preview_only: true;
  generated_at: string;
  status: JobPrepReadinessStatus;
  client_prep: {
    account_name: string | null;
    job_name: string;
    job_date: string | null;
    primary_location: JobPrepClientLocationPreview | null;
    eligible_email_recipients: JobPrepRecipientPreview[];
    eligible_sms_recipients: JobPrepRecipientPreview[];
    excluded_contacts: JobPrepExcludedContactPreview[];
  };
  employee_briefing: {
    primary_location: JobPrepEmployeeLocationPreview | null;
  };
  message_previews: {
    client_prep_email: JobPrepMessagePreview;
    client_prep_sms: JobPrepMessagePreview;
    employee_briefing: JobPrepMessagePreview;
  };
  warnings: JobPrepReadinessWarning[];
}

export type JobPrepReadinessQueueIssue =
  | "missing_location"
  | "missing_prep_recipient"
  | "missing_sms_eligibility"
  | "missing_location_details"
  | "message_preview_blocked";

export interface JobPrepReadinessQueueItem {
  job_id: string;
  job_number: string | null;
  organization_id: string | null;
  organization_name: string | null;
  job_name: string;
  job_date: string | null;
  department_type: JobDepartmentType;
  job_category: JobCategory;
  readiness_status: JobPrepReadinessStatus;
  warnings: JobPrepReadinessWarning[];
  issue_codes: JobPrepReadinessQueueIssue[];
  primary_location_status: "ready" | "missing" | "needs_details";
  prep_email_recipient_status: "ready" | "missing";
  sms_readiness_status: "ready" | "missing" | "not_ready";
  message_preview_status: "ready" | "needs_review" | "blocked";
  job_command_center_href: string;
  client_command_center_href: string | null;
}

export interface JobPrepReadinessQueueResponse {
  generated_at: string;
  preview_only: true;
  summary: {
    total_count: number;
    ready_count: number;
    needs_review_count: number;
    blocked_count: number;
    missing_location_count: number;
    missing_prep_recipient_count: number;
    missing_sms_eligibility_count: number;
  };
  items: JobPrepReadinessQueueItem[];
}

export interface ProductionQueueSummary {
  total_count: number;
  blocked_count: number;
  overdue_count: number;
  awaiting_approval_count: number;
  qa_pending_count: number;
  due_today_count: number;
}

export interface ProductionExceptionQueueSummary {
  total_count: number;
  critical_count: number;
  high_count: number;
  blocked_count: number;
  overdue_count: number;
  next_24_hours_count: number;
}

/** @deprecated Use `ProductionExceptionQueueSummary`. */
export type ProductionUrgentWatchSummary = ProductionExceptionQueueSummary;

export interface ProductionExceptionQueueResponse {
  items: JobExceptionListItem[];
  summary: ProductionExceptionQueueSummary;
}

/** @deprecated Use `ProductionExceptionQueueResponse`. */
export type ProductionUrgentWatchResponse = ProductionExceptionQueueResponse;

export interface ProductionManagementExceptionItem extends ProductionQueueItem {
  exception_types: string[];
}

export interface ProductionManagementExceptionSummary {
  total_count: number;
  blocked_count: number;
  overdue_count: number;
  missing_owner_count: number;
  reviewer_gap_count: number;
  stalled_count: number;
  rework_exception_count: number;
  hold_review_due_count: number;
}

export interface ProductionManagementExceptionResponse {
  items: ProductionManagementExceptionItem[];
  summary: ProductionManagementExceptionSummary;
}

export interface JobExceptionSavedViewSummary extends ExceptionSavedViewRecord {
  owner_name: string | null;
}

/** @deprecated Use `JobExceptionSavedViewSummary`. */
export type WatchlistSavedViewSummary = JobExceptionSavedViewSummary;

/**
 * Canonical job-scoped exception signal exposed by legacy jobs/watch routes.
 *
 * This is distinct from the operator-facing exception-center contract in
 * `types/exceptions.ts`, but it replaces watchlist wording as the primary
 * public shape in this file.
 */
export interface JobExceptionListItem extends JobWatchFlagRecord {
  department_type: JobDepartmentType;
  job_number: string | null;
  job_title: string;
  organization_id: string | null;
  organization_name: string | null;
  owner_name: string | null;
  created_by_name: string | null;
  resolved_by_name: string | null;
  source_entity_label: string | null;
  source_scope_label: string | null;
  next_action_label: string;
  priority_rank: number;
}

/** @deprecated Use `JobExceptionListItem`. */
export type WatchFlagListItem = JobExceptionListItem;

export interface JobExceptionQueueSummary {
  total_count: number;
  critical_count: number;
  high_count: number;
  snoozed_count: number;
  ownerless_count: number;
  next_24_hours_count: number;
}

/** @deprecated Use `JobExceptionQueueSummary`. */
export type WatchlistSummary = JobExceptionQueueSummary;

export interface JobExceptionQueueResponse {
  items: JobExceptionListItem[];
  summary: JobExceptionQueueSummary;
  saved_views: JobExceptionSavedViewSummary[];
}

/** @deprecated Use `JobExceptionQueueResponse`. */
export type WatchlistResponse = JobExceptionQueueResponse;

export interface AlertFeedItem extends AlertDeliveryRecord {
  alert_event: AlertEventRecord;
  watch_flag_id: string | null;
  watch_flag: (JobWatchFlagRecord & { owner_name: string | null }) | null;
  job_id: string | null;
  job_number: string | null;
  job_title: string | null;
  department_type: JobDepartmentType | null;
  organization_name: string | null;
  recipient_name: string | null;
}

export interface AlertCenterSummary {
  unread_count: number;
  critical_count: number;
  acted_count: number;
}

export interface AlertCenterResponse {
  items: AlertFeedItem[];
  summary: AlertCenterSummary;
}

export interface DashboardHealthSummary {
  score: number;
  state: DashboardHealthState;
  explanation: string[];
}

export interface ProductionReportingSummary {
  total_open_items: number;
  overdue_items: number;
  blocked_items: number;
  due_today: number;
  due_this_week: number;
  average_turnaround_days: number | null;
  on_time_release_percentage: number | null;
  average_stage_duration_days: number | null;
  rework_rate: number;
  first_pass_approval_rate: number | null;
  file_mismatch_rate: number;
  upload_failure_rate: number;
  vendor_turnaround_days: number | null;
  completion_volume_this_week: number;
  ready_for_qa_count: number;
  ready_for_release_count: number;
  awaiting_files_count: number;
  awaiting_upload_count: number;
  vendor_pending_count: number;
}

export interface ProductionOwnerBacklogItem {
  owner_user_id: string | null;
  owner_name: string;
  open_count: number;
  blocked_count: number;
  overdue_count: number;
  due_this_week_count: number;
  ready_for_qa_count: number;
  ready_for_release_count: number;
  average_stage_age_days: number | null;
  work_share_percent: number;
  load_score: number;
}

export interface ProductionDepartmentBacklogItem {
  department_type: JobDepartmentType;
  open_count: number;
  blocked_count: number;
  overdue_count: number;
  due_this_week_count: number;
  rework_rate: number;
  on_time_release_percentage: number | null;
}

export interface ProductionQaFailureCategoryItem {
  category: string;
  label: string;
  count: number;
}

export interface ProductionQaPerformanceItem {
  reviewer_user_id: string | null;
  reviewer_name: string;
  reviews_completed: number;
  send_back_count: number;
  first_pass_approvals: number;
  accountability_failures: number;
  average_review_turnaround_days: number | null;
}

export interface ProductionTrendBucket {
  key: string;
  label: string;
  starts_at: string;
  ends_before: string;
  completions: number;
  releases: number;
  overdue: number;
  blocked: number;
  rework: number;
}

export interface ProductionAccountBurdenItem {
  account_owner_user_id: string | null;
  account_owner_name: string;
  open_count: number;
  blocked_count: number;
  overdue_count: number;
  at_risk_count: number;
  burden_score: number;
}

export interface ProductionOrganizationRiskItem {
  organization_id: string | null;
  organization_name: string;
  blocked_count: number;
  overdue_count: number;
  rework_count: number;
  file_mismatch_count: number;
  issue_count: number;
  risk_score: number;
}

export interface ProductionDelaySignalItem {
  production_item_id: string;
  title: string;
  organization_name: string | null;
  workflow_status: ProductionBoardWorkflowStatus;
  health_state: ProductionBoardHealthState;
  delay_days: number;
  post_shoot_eval_summary: string;
}

export interface ProductionTopPerformerItem {
  owner_user_id: string | null;
  owner_name: string;
  items_completed: number;
  on_time_release_percentage: number | null;
  first_pass_approval_rate: number | null;
  average_turnaround_days: number | null;
  qa_fail_rate: number;
  performance_score: number;
}

export interface ProductionRestrictedOverlayCard {
  key: string;
  title: string;
  availability: "live" | "scaffolded";
  summary: string;
  metric: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}

export interface ProductionReportingResponse {
  generated_at: TimestampValue;
  department_type: JobDepartmentType | null;
  summary: ProductionReportingSummary;
  management: {
    overdue_queue: ProductionQueueItem[];
    blocked_queue: ProductionQueueItem[];
    exception_view: ProductionManagementExceptionItem[];
    team_workload: ProductionOwnerBacklogItem[];
    qa_performance: ProductionQaPerformanceItem[];
  };
  insights: {
    backlog_by_owner: ProductionOwnerBacklogItem[];
    backlog_by_department: ProductionDepartmentBacklogItem[];
    qa_failure_categories: ProductionQaFailureCategoryItem[];
    operational_burden_by_account: ProductionAccountBurdenItem[];
    work_concentration_by_person: ProductionOwnerBacklogItem[];
    repeat_problem_organizations: ProductionOrganizationRiskItem[];
    post_shoot_eval_delay_signals: ProductionDelaySignalItem[];
    top_performers: ProductionTopPerformerItem[];
  };
  trends: {
    by_day: ProductionTrendBucket[];
    by_week: ProductionTrendBucket[];
  };
  urgent_watch: ProductionUrgentWatchSummary;
  restricted_overlays: ProductionRestrictedOverlayCard[] | null;
}

export interface DashboardProductionSnapshot {
  open_items: number;
  overdue_items: number;
  blocked_items: number;
  due_this_week: number;
  average_turnaround_days: number | null;
  on_time_release_percentage: number | null;
  rework_rate: number;
  first_pass_approval_rate: number | null;
}

export type DashboardWidgetRoleKey = "photographer" | "production" | "schools" | "sports" | "leadership" | "default";

export interface DashboardWidgetLayoutItem {
  widget_key: string;
  required: boolean;
  default_visible: boolean;
  default_position: number;
  reason: string;
}

export interface DashboardWidgetLayout {
  role_key: DashboardWidgetRoleKey;
  supports_personalization: boolean;
  items: DashboardWidgetLayoutItem[];
}

export interface DashboardWidgetSummary {
  widget_key: string;
  title: string;
  description: string;
  metric: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  count: number;
  route_hash: string;
}

export interface DashboardTodayJobItem extends JobListItem {
  urgent_flag_count: number;
  critical_flag_count: number;
}

export interface WorkloadPressureItem {
  owner_user_id: string | null;
  owner_name: string;
  open_flag_count: number;
  blocked_production_count: number;
  due_today_count: number;
  score: number;
}

export interface RecentMovementItem {
  id: string;
  event_type: string;
  summary: string;
  created_at: TimestampValue;
  actor_name: string | null;
  department_type: JobDepartmentType | null;
  job_id: string | null;
  job_number: string | null;
  organization_name: string | null;
}

export interface DashboardResponse {
  scope: "home" | "department" | "executive" | "today";
  department_type: JobDepartmentType | null;
  summary: {
    jobs_today: number;
    jobs_next_7_days: number;
    urgent_count: number;
    critical_watch_count: number;
    high_watch_count: number;
    blocked_production_count: number;
    overdue_approval_count: number;
    delivery_risk_count: number;
    staffing_gap_count: number;
    missing_ready_confirmation_count: number;
    overdue_checklist_count: number;
    awaiting_checklist_approval_count: number;
    rejected_checklist_count: number;
    blocked_job_count: number;
  };
  health: DashboardHealthSummary;
  widgets: DashboardWidgetSummary[];
  widget_layout: DashboardWidgetLayout;
  urgent_watch: WatchFlagListItem[];
  checklist_attention_summary: ChecklistAttentionSummary;
  checklist_attention: ChecklistAttentionItem[];
  upcoming_risks: WatchFlagListItem[];
  today_jobs: DashboardTodayJobItem[];
  blocked_production: ProductionQueueItem[];
  overdue_approvals: ProductionQueueItem[];
  delivery_risks: ProductionQueueItem[];
  my_open_flags: WatchFlagListItem[];
  recent_movement: RecentMovementItem[];
  workload_pressure: WorkloadPressureItem[];
  production_snapshot: DashboardProductionSnapshot | null;
}

export interface ProductionQueueItem extends ProductionItemRecord {
  job_number: string | null;
  job_title: string;
  organization_id: string | null;
  organization_name: string | null;
  primary_location_name: string | null;
  primary_contact_name: string | null;
  assigned_to_name: string | null;
  approval_status: JobApprovalStatus;
  qa_summary_status: JobQaReviewStatus;
  deliverable_status: JobDeliverableStatus;
  file_receipt_state: "not_applicable" | "missing_receipt" | "partial_receipt" | "exact_match" | "extra_files";
  overdue_approval_count: number;
  open_issue_count: number;
  blocking_issue_count: number;
  job_risk_status: JobRiskStatus;
  job_readiness_status: JobReadinessStatus;
  linked_shoot_ids: string[];
  days_since_shoot: number | null;
  days_open: number;
  days_to_due: number | null;
  days_past_due: number | null;
  stage_age: number;
  turnaround_days: number | null;
  on_time_flag: boolean | null;
  open_blocker_count: number;
  overdue_flag: boolean;
  release_lag_days: number | null;
  checklist_total_count: number;
  checklist_overdue_count: number;
  checklist_awaiting_approval_count: number;
  checklist_rejected_count: number;
  checklist_blocked_count: number;
  checklist_missing_proof_count: number;
  blocking_checklist_instance_id: string | null;
  blocking_checklist_title: string | null;
}

export interface JobListItem extends JobRecord {
  organization_name: string | null;
  primary_location_name: string | null;
  primary_location_address: string | null;
  primary_contact_name: string | null;
  account_owner_name: string | null;
  lead_owner_user_id: string | null;
  lead_owner_name: string | null;
  primary_day_date: string | null;
  primary_day_start_time: string | null;
  primary_day_end_time: string | null;
  primary_day_label: string | null;
  school_profile: SchoolJobProfileView | null;
  sports_profile: SportsJobProfileView | null;
  department_summary: Record<string, unknown>;
  proof_status: string | null;
  open_watch_flag_count: number;
  readiness_percent: number;
  blocker_count: number;
  day_count: number;
  assigned_staff_count: number;
  checked_in_staff_count: number;
  ready_present_count: number;
}

export interface JobSummaryView {
  organization_name: string | null;
  organization_account_type: string | null;
  primary_location_name: string | null;
  primary_location_address: string | null;
  primary_contact_name: string | null;
  primary_contact_title: string | null;
  account_owner_name: string | null;
  lead_owner_user_id: string | null;
  lead_owner_name: string | null;
  primary_day_date: string | null;
  primary_day_start_time: string | null;
  primary_day_end_time: string | null;
  primary_day_label: string | null;
  latest_activity_at: TimestampValue | null;
  department_summary: Record<string, unknown>;
  proof_status: string | null;
}

export interface DepartmentPublishContext {
  school_profile?: Partial<SchoolJobProfileRecord> | null;
  sports_profile?: Partial<SportsJobProfileRecord> | null;
}

export interface JobDraftInput {
  department_type: JobDepartmentType;
  job_category?: JobCategory | null;
  organization_id?: string | null;
  primary_location_id?: string | null;
  primary_contact_id?: string | null;
  account_owner_user_id?: string | null;
  title?: string | null;
  event_name?: string | null;
  description_internal?: string | null;
  priority_level?: JobPriorityLevel | null;
  delivery_type?: string | null;
  gallery_type?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  timezone?: string | null;
  estimated_subject_count?: number | null;
  estimated_staff_count?: number | null;
  client_deadline_at?: string | null;
  production_deadline_at?: string | null;
  production_required?: boolean | null;
  location_override_note?: string | null;
  contact_override_note?: string | null;
  school_profile?: Partial<SchoolJobProfileRecord> | null;
  sports_profile?: Partial<SportsJobProfileRecord> | null;
  workflow_template_key?: string | null;
  workflow_template_version_id?: string | null;
  events?: Array<Partial<EventRecord>> | null;
  /**
   * @deprecated Use `events`. The draft routes still normalize `days` for compatibility.
   */
  days?: Array<Partial<JobDayRecord>> | null;
}

export interface JobDetailResponse {
  job: JobRecord;
  summary: JobSummaryView;
  school_profile: SchoolJobProfileView | null;
  sports_profile: SportsJobProfileView | null;
  job_shoot_links: JobShootLinkRecord[];
  events: JobDetailEventRecord[];
  /**
   * @deprecated Use `events`. The backing tables and some routes still use `days`
   * during the compatibility window.
   */
  days: JobDetailEventRecord[];
  staff_assignments: JobDetailStaffAssignmentRecord[];
  readiness_items: Array<JobReadinessItemRecord & { completed_by_name: string | null }>;
  production_items: Array<
    ProductionItemRecord & {
      assigned_to_name: string | null;
      account_owner_name: string | null;
      primary_contact_name: string | null;
      location_name: string | null;
      assigned_peer_reviewer_name: string | null;
      assigned_release_reviewer_name: string | null;
      escalation_owner_name: string | null;
      hold_owner_name: string | null;
      linked_shoot_ids: string[];
      days_since_shoot: number | null;
      days_open: number;
      days_to_due: number | null;
      days_past_due: number | null;
      stage_age: number;
      turnaround_days: number | null;
      on_time_flag: boolean | null;
      open_blocker_count: number;
      overdue_flag: boolean;
      release_lag_days: number | null;
    }
  >;
  production_item_shoot_links: ProductionItemShootLinkRecord[];
  production_handoffs: Array<ProductionHandoffRecord & { from_user_name: string | null; to_user_name: string | null }>;
  approval_requests: Array<ApprovalRequestRecord & { approver_contact_name: string | null; approver_user_name: string | null }>;
  qa_reviews: Array<
    QaReviewRecord & {
      reviewer_name: string | null;
      requested_by_name: string | null;
      sent_back_to_name: string | null;
      original_owner_name: string | null;
      accountable_owner_name: string | null;
      accountable_reviewer_name: string | null;
    }
  >;
  qa_findings: Array<QaReviewFindingRecord & { resolved_by_name: string | null }>;
  deliverable_items: Array<DeliverableItemRecord & { recipient_contact_name: string | null; recipient_organization_name: string | null }>;
  production_issues: Array<ProductionIssueRecord & { owner_name: string | null; resolved_by_name: string | null }>;
  production_blockers: Array<ProductionBlockerRecord & { owner_name: string | null; resolved_by_name: string | null }>;
  job_exceptions: JobDetailExceptionRecord[];
  /**
   * @deprecated Use `job_exceptions`. This alias remains only for compatibility with
   * legacy consumers during the exception-model migration.
   */
  watch_flags: JobDetailExceptionRecord[];
  activity: ActivityTimelineEntry[];
  status: JobStatusSnapshot;
  workflow: JobWorkflowSummary;
  shared_workflow: SharedWorkflowJobDetail | null;
  prep_readiness: JobPrepReadinessPreview;
  policy: SharedResourcePolicySnapshot;
}
