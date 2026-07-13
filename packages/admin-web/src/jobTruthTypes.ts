// ─── The ONE frontend job-status vocabulary (audit prompt 7 / MC-AUDIT-007) ───
// These runtime arrays mirror the server's canonical source
// (packages/api/src/domain/jobTruth/index.ts) value-for-value; the union types
// below are DERIVED from them. Every filter dropdown, badge map, and stage
// cascade must import from here — never re-declare a status list locally.
// (Five drifted local copies were deleted in favor of these on 2026-07-13; the
// worst was missing intake_blocked and 7 of 20 production statuses.)
export const JOB_DEPARTMENT_TYPES = ["schools", "sports", "corporate", "headshots", "other"] as const;
export type JobDepartmentType = (typeof JOB_DEPARTMENT_TYPES)[number];
export type JobCategory = "photo_day" | "makeup_day" | "reshoot" | "media_day" | "event" | "banner_day" | "specialty" | "delivery_only" | "other";
export const JOB_STATUSES = [
  "draft",
  "intake_blocked",
  "pending_confirmation",
  "confirmed",
  "ready_to_staff",
  "staffed",
  "ready_to_execute",
  "in_progress",
  "execution_complete",
  "postponed",
  "weather_hold",
  "cancelled",
  "archived"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_READINESS_STATUSES = ["off_track", "at_risk", "on_track", "ready"] as const;
export type JobReadinessStatus = (typeof JOB_READINESS_STATUSES)[number];
export const JOB_PRODUCTION_STATUSES = [
  "not_created",
  "queued",
  "awaiting_ingest",
  "ingest_complete",
  "editing",
  "awaiting_internal_review",
  "proof_build",
  "proof_sent",
  "awaiting_approval",
  "revisions_requested",
  "approved_for_production",
  "approved_for_final",
  "in_final_production",
  "ordered_or_printed",
  "ordered_or_sent",
  "packaged",
  "delivered",
  "complete",
  "blocked",
  "cancelled"
] as const;
export type JobProductionStatus = (typeof JOB_PRODUCTION_STATUSES)[number];
export const JOB_STAFFING_STATUSES = ["unassigned", "partially_staffed", "staffed", "checked_in", "ready_confirmed", "gap_flagged"] as const;
export type JobStaffingStatus = (typeof JOB_STAFFING_STATUSES)[number];
export const JOB_RISK_STATUSES = ["none", "low", "medium", "high", "critical"] as const;
export type JobRiskStatus = (typeof JOB_RISK_STATUSES)[number];
export type SharedVisibilityState = "hidden" | "masked" | "readonly" | "editable";

export type SharedResourcePolicySnapshot = {
  permissions: string[];
  fields: Record<string, SharedVisibilityState>;
  sections: Record<string, SharedVisibilityState>;
  actions: Record<string, boolean>;
  reasons: Record<string, string>;
};
export type JobSyncStatus = "clean" | "pending" | "warning" | "error";
export type JobPriorityLevel = "low" | "normal" | "high" | "urgent";
export type JobDayStatus = "scheduled" | "ready" | "in_progress" | "complete" | "postponed" | "cancelled";
export type JobAssignmentStatus = "assigned" | "confirmed" | "checked_in" | "checked_out" | "absent" | "cancelled";
export type JobApprovalStatus = "not_required" | "not_started" | "requested" | "viewed" | "approved" | "rejected" | "revisions_requested" | "overdue" | "cancelled";
export type JobQaReviewStatus = "not_required" | "queued" | "in_review" | "passed" | "passed_with_notes" | "failed" | "rework_in_progress" | "recheck_required" | "complete";
export type JobDeliverableStatus = "not_started" | "preparing" | "sent" | "in_transit" | "delivered" | "confirmed" | "issue_flagged" | "cancelled";
export type JobHandoffStatus = "pending" | "accepted" | "in_progress" | "completed" | "rejected" | "blocked";
export type JobProductionIssueStatus = "open" | "acknowledged" | "resolved" | "dismissed";
export type ProductionBoardWorkflowStatus =
  | "DRAFT"
  | "WAITING_ON_INTAKE"
  | "WAITING_ON_FILES"
  | "INTAKE_REVIEW"
  | "READY_FOR_PRODUCTION"
  | "IN_PRODUCTION"
  | "READY_FOR_QA"
  | "IN_PEER_REVIEW"
  | "REWORK_REQUIRED"
  | "READY_FOR_UPLOAD"
  | "UPLOADING"
  | "UPLOADED"
  | "READY_FOR_RELEASE"
  | "RELEASED"
  | "SENT_TO_VENDOR"
  | "DELIVERED_CLOSED"
  | "ON_HOLD"
  | "BLOCKED"
  | "CANCELLED";
export type ProductionBoardHealthState = "ON_TRACK" | "WATCH" | "AT_RISK" | "OVERDUE" | "BLOCKED";
export type ProductionBoardSyncState = "CLEAN" | "PENDING_SYNC" | "SYNCED" | "PARTIAL_ERROR" | "SYNC_ERROR" | "STALE";
export type ProductionBoardFileMatchStatus = "UNKNOWN" | "NOT_APPLICABLE" | "MISSING" | "PARTIAL" | "MATCHED" | "MISMATCH" | "EXTRA_FILES";
export type ProductionBoardUploadStatus = "NOT_STARTED" | "READY" | "UPLOADING" | "UPLOADED" | "VERIFIED" | "FAILED";
export type ProductionBoardReleaseStatus = "NOT_STARTED" | "PENDING_REVIEW" | "READY_FOR_RELEASE" | "RELEASED" | "SENT_TO_VENDOR" | "DELIVERED" | "CLOSED" | "FAILED";

export type SharedJobPrepReadinessStatus = "ready" | "needs_attention" | "blocked";
export type SharedJobPrepReadinessWarningSeverity = "info" | "warning" | "blocker";
export type SharedJobPrepLocationAttachmentAudience = "client_facing" | "employee_facing" | "internal_only";

export type SharedJobPrepRecipientPreview = {
  id: string;
  display_name: string;
  title: string | null;
  email: string | null;
  mobile_phone: string | null;
  client_roles: string[];
};

export type SharedJobPrepExcludedContactPreview = SharedJobPrepRecipientPreview & {
  prep_email_exclusion_reason: string | null;
  prep_sms_exclusion_reason: string | null;
};

export type SharedJobPrepLocationAttachmentPreview = {
  id: string;
  title: string;
  description: string | null;
  attachment_type: string;
  audience: SharedJobPrepLocationAttachmentAudience;
  file_url: string | null;
  storage_key: string | null;
};

export type SharedJobPrepClientLocationPreview = {
  id: string;
  location_name: string;
  address_display: string | null;
  google_maps_url: string | null;
  client_facing_notes: string | null;
  reference_attachments: SharedJobPrepLocationAttachmentPreview[];
};

export type SharedJobPrepEmployeeLocationPreview = SharedJobPrepClientLocationPreview & {
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
};

export type SharedJobPrepReadinessWarning = {
  code: string;
  severity: SharedJobPrepReadinessWarningSeverity;
  label: string;
  detail: string | null;
};

export type SharedJobPrepMessagePreview = {
  preview_only: true;
  template_key: "client_prep_email_v1" | "client_prep_sms_v1" | "employee_briefing_v1";
  label: string;
  channel: "email" | "sms" | "internal_briefing";
  can_preview: boolean;
  recipients: SharedJobPrepRecipientPreview[];
  subject: string | null;
  body_lines: string[];
  warnings: SharedJobPrepReadinessWarning[];
  reference_attachments: SharedJobPrepLocationAttachmentPreview[];
};

export type SharedJobPrepReadinessPreview = {
  preview_only: true;
  generated_at: string;
  status: SharedJobPrepReadinessStatus;
  client_prep: {
    account_name: string | null;
    job_name: string;
    job_date: string | null;
    primary_location: SharedJobPrepClientLocationPreview | null;
    eligible_email_recipients: SharedJobPrepRecipientPreview[];
    eligible_sms_recipients: SharedJobPrepRecipientPreview[];
    excluded_contacts: SharedJobPrepExcludedContactPreview[];
  };
  employee_briefing: {
    primary_location: SharedJobPrepEmployeeLocationPreview | null;
  };
  message_previews: {
    client_prep_email: SharedJobPrepMessagePreview;
    client_prep_sms: SharedJobPrepMessagePreview;
    employee_briefing: SharedJobPrepMessagePreview;
  };
  warnings: SharedJobPrepReadinessWarning[];
};

export type SharedJobPrepReadinessQueueIssue =
  | "missing_location"
  | "missing_prep_recipient"
  | "missing_sms_eligibility"
  | "missing_location_details"
  | "message_preview_blocked";

export type SharedJobPrepReadinessQueueItem = {
  job_id: string;
  job_number: string | null;
  organization_id: string | null;
  organization_name: string | null;
  job_name: string;
  job_date: string | null;
  department_type: JobDepartmentType;
  job_category: JobCategory;
  readiness_status: SharedJobPrepReadinessStatus;
  warnings: SharedJobPrepReadinessWarning[];
  issue_codes: SharedJobPrepReadinessQueueIssue[];
  primary_location_status: "ready" | "missing" | "needs_details";
  prep_email_recipient_status: "ready" | "missing";
  sms_readiness_status: "ready" | "missing" | "not_ready";
  message_preview_status: "ready" | "needs_review" | "blocked";
  job_command_center_href: string;
  client_command_center_href: string | null;
};

export type SharedJobPrepReadinessQueueResponse = {
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
  items: SharedJobPrepReadinessQueueItem[];
};

export type SharedJobRecord = {
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
  staffing_status: JobStaffingStatus;
  readiness_status: JobReadinessStatus;
  sync_status: JobSyncStatus;
  risk_status: JobRiskStatus;
  priority_level: JobPriorityLevel;
  delivery_type: string | null;
  gallery_type: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  timezone: string;
  estimated_subject_count: number | null;
  actual_subject_count: number | null;
  estimated_staff_count: number | null;
  actual_staff_count: number | null;
  client_deadline_at: string | null;
  production_deadline_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  production_required: boolean;
  location_override_note: string | null;
  contact_override_note: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SchoolJobProfileView = {
  job_id: string;
  tenant_id: string;
  district_id: string | null;
  district_name: string | null;
  school_type: string | null;
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
  specific_area: string | null;
};

export type SportsJobProfileView = {
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
  approval_contact_name: string | null;
  billing_contact_id: string | null;
  billing_contact_name: string | null;
  revenue_share_enabled: boolean | null;
  revenue_share_terms_summary: string | null;
  banner_work_required: boolean;
  specialty_products_required: boolean;
  buddy_photos_required: boolean;
  sponsor_graphics_required: boolean;
  client_expectations_notes: string | null;
};

export type SharedJobListItem = SharedJobRecord & {
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
};

export type SharedJobSummaryView = {
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
  latest_activity_at: string | null;
  department_summary: Record<string, unknown>;
  proof_status: string | null;
};

export type SharedJobDay = {
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
  location_name: string | null;
  onsite_contact_id: string | null;
  onsite_contact_name: string | null;
  lead_user_id: string | null;
  lead_user_name: string | null;
  day_status: JobDayStatus;
  weather_sensitive: boolean;
  indoor_outdoor: string | null;
  access_notes: string | null;
  parking_notes: string | null;
  setup_notes: string | null;
  travel_notes: string | null;
  check_in_window_start: string | null;
  check_in_window_end: string | null;
  ready_confirmed_at: string | null;
  ready_confirmed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedJobStaffAssignment = {
  id: string;
  tenant_id: string;
  job_id: string;
  job_day_id: string | null;
  user_id: string;
  user_name: string | null;
  assignment_role: string;
  assignment_status: string;
  is_lead: boolean;
  check_in_at: string | null;
  check_out_at: string | null;
  is_ready_present: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedJobReadinessItem = {
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
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_name: string | null;
  due_at: string | null;
  sort_order: number;
  source_template_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedProductionItem = {
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
  assigned_to_name: string | null;
  organization_id: string | null;
  location_id: string | null;
  location_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  account_owner_user_id: string | null;
  account_owner_name: string | null;
  department_owner_user_id: string | null;
  assigned_peer_reviewer_user_id: string | null;
  assigned_peer_reviewer_name: string | null;
  assigned_release_reviewer_user_id: string | null;
  assigned_release_reviewer_name: string | null;
  escalation_owner_user_id: string | null;
  escalation_owner_name: string | null;
  department_type: JobDepartmentType;
  shoot_date_start: string | null;
  shoot_date_end: string | null;
  production_start_at: string | null;
  approval_required: boolean;
  proof_required: boolean;
  qa_required: boolean;
  due_at: string | null;
  release_due_at: string | null;
  delivery_deadline_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
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
  hold_owner_name: string | null;
  hold_review_at: string | null;
  merged_into_production_item_id: string | null;
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
  created_at: string;
  updated_at: string;
};

export type SharedJobShootLink = {
  id: string;
  tenant_id: string;
  job_id: string;
  shoot_id: string;
  link_reason: string;
  created_at: string;
};

export type SharedProductionItemShootLink = {
  id: string;
  tenant_id: string;
  production_item_id: string;
  shoot_id: string;
  created_at: string;
};

export type SharedProductionHandoff = {
  id: string;
  tenant_id: string;
  production_item_id: string;
  handoff_type: string;
  from_stage: string;
  to_stage: string;
  from_user_id: string | null;
  from_user_name: string | null;
  to_user_id: string | null;
  to_user_name: string | null;
  status: JobHandoffStatus;
  note: string | null;
  completed_at: string | null;
  created_at: string;
};

export type SharedApprovalRequest = {
  id: string;
  tenant_id: string;
  production_item_id: string;
  job_id: string;
  job_day_id: string | null;
  approval_type: string;
  approver_contact_id: string | null;
  approver_contact_name: string | null;
  approver_user_id: string | null;
  approver_user_name: string | null;
  status: JobApprovalStatus;
  requested_at: string | null;
  viewed_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  revision_requested_at: string | null;
  due_at: string | null;
  last_follow_up_at: string | null;
  revision_count: number;
  summary: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedQaReview = {
  id: string;
  tenant_id: string;
  production_item_id: string;
  job_id: string;
  review_type: string;
  review_stage: string;
  reviewer_user_id: string;
  reviewer_name: string | null;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  status: JobQaReviewStatus;
  decision: string | null;
  reviewed_at: string | null;
  sample_size_percent: number | null;
  checklist_template_key: string | null;
  question_answers_json: Record<string, unknown>;
  notes: string | null;
  decision_reason: string | null;
  issue_category: string | null;
  rework_required: boolean;
  sent_back_to_user_id: string | null;
  sent_back_to_name: string | null;
  override_same_reviewer: boolean;
  override_reason: string | null;
  original_owner_user_id: string | null;
  original_owner_name: string | null;
  accountability_stage_key: string | null;
  accountable_owner_user_id: string | null;
  accountable_owner_name: string | null;
  accountable_reviewer_user_id: string | null;
  accountable_reviewer_name: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedQaFinding = {
  id: string;
  tenant_id: string;
  qa_review_record_id: string;
  finding_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  is_blocking: boolean;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  created_at: string;
};

export type SharedDeliverableItem = {
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
  delivered_at: string | null;
  recipient_contact_id: string | null;
  recipient_contact_name: string | null;
  recipient_organization_id: string | null;
  recipient_organization_name: string | null;
  notes: string | null;
  legacy_source_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedProductionIssue = {
  id: string;
  tenant_id: string;
  production_item_id: string;
  job_id: string;
  issue_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  status: JobProductionIssueStatus;
  is_blocking: boolean;
  source_key: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  due_at: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedJobWatchFlag = {
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
  severity: "info" | "low" | "medium" | "high" | "critical";
  flag_type: string;
  title: string;
  description: string | null;
  status: "open" | "acknowledged" | "snoozed" | "resolved" | "dismissed";
  owner_user_id: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  due_at: string | null;
  snooze_until: string | null;
  escalated_at: string | null;
  escalated_to_role: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  auto_key: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedActivityTimelineObjectType =
  | "job"
  | "staffing_assignment"
  | "organization"
  | "location"
  | "contact"
  | "production_item"
  | "evaluation"
  | "approval";

export type SharedActivityTimelineSourceKind =
  | "activity_log"
  | "audit_log"
  | "approval_request"
  | "approval_event"
  | "notification"
  | "sync";

export type SharedActivityTimelineTone = "neutral" | "info" | "success" | "warning" | "danger";

export type SharedJobActivityEntry = {
  id: string;
  tenant_id: string;
  object_type: SharedActivityTimelineObjectType;
  object_id: string;
  related_object_type: string | null;
  related_object_id: string | null;
  source_kind: SharedActivityTimelineSourceKind;
  job_id: string | null;
  job_day_id: string | null;
  production_item_id: string | null;
  watch_flag_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  contact_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  event_type: string;
  action_label: string;
  summary: string;
  detail: string | null;
  tone: SharedActivityTimelineTone;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type SharedJobStatusSnapshot = {
  readiness_percent: number;
  job_status: JobStatus;
  production_status: JobProductionStatus;
  staffing_status: JobStaffingStatus;
  readiness_status: JobReadinessStatus;
  risk_status: JobRiskStatus;
  blocker_count: number;
  open_watch_flag_count: number;
};

export type SharedJobValidationIssue = {
  field: string;
  message: string;
  code: string;
};

export type SharedJobValidationResult = {
  valid: boolean;
  errors: SharedJobValidationIssue[];
};

export type SharedWorkflowIssueLevel = "hard_block" | "warning";
export type SharedWorkflowCheckpointState = "clear" | "warning" | "blocked";
export type SharedWorkflowSubjectType = "job" | "job_day" | "production_item" | "approval_request" | "evaluation";

export type SharedWorkflowIssue = {
  code: string;
  level: SharedWorkflowIssueLevel;
  subject_type: SharedWorkflowSubjectType;
  subject_id: string | null;
  field: string | null;
  message: string;
  action_label: string | null;
  metadata: Record<string, unknown> | null;
};

export type SharedWorkflowCheckpointSummary = {
  key: string;
  label: string;
  state: SharedWorkflowCheckpointState;
  blocker_count: number;
  warning_count: number;
  summary: string;
  next_action: string | null;
  issues: SharedWorkflowIssue[];
};

export type SharedWorkflowTransitionValidation = {
  subject_type: SharedWorkflowSubjectType;
  subject_id: string | null;
  transition_key: string;
  current_state: string | null;
  target_state: string;
  allowed: boolean;
  hard_blocked: boolean;
  blocker_count: number;
  warning_count: number;
  issues: SharedWorkflowIssue[];
  checklist_validation: import("./checklistTypes").ChecklistTransitionValidation | null;
};

export type SharedJobWorkflowSummary = {
  publish: SharedWorkflowCheckpointSummary;
  readiness: SharedWorkflowCheckpointSummary;
  production: SharedWorkflowCheckpointSummary;
  approvals: SharedWorkflowCheckpointSummary;
  evaluations: SharedWorkflowCheckpointSummary;
};

export type SharedJobDetailResponse = {
  job: SharedJobRecord;
  summary: SharedJobSummaryView;
  school_profile: SchoolJobProfileView | null;
  sports_profile: SportsJobProfileView | null;
  job_shoot_links: SharedJobShootLink[];
  days: SharedJobDay[];
  staff_assignments: SharedJobStaffAssignment[];
  readiness_items: SharedJobReadinessItem[];
  production_items: SharedProductionItem[];
  production_item_shoot_links: SharedProductionItemShootLink[];
  production_handoffs: SharedProductionHandoff[];
  approval_requests: SharedApprovalRequest[];
  qa_reviews: SharedQaReview[];
  qa_findings: SharedQaFinding[];
  deliverable_items: SharedDeliverableItem[];
  production_issues: SharedProductionIssue[];
  production_blockers: SharedProductionIssue[];
  watch_flags: SharedJobWatchFlag[];
  activity: SharedJobActivityEntry[];
  status: SharedJobStatusSnapshot;
  workflow: SharedJobWorkflowSummary;
  prep_readiness: SharedJobPrepReadinessPreview;
  policy: SharedResourcePolicySnapshot;
};

export type SharedProductionQueueItem = SharedProductionItem & {
  job_number: string | null;
  job_title: string;
  organization_id: string | null;
  organization_name: string | null;
  primary_location_name: string | null;
  primary_contact_name: string | null;
  approval_status: JobApprovalStatus;
  qa_summary_status: JobQaReviewStatus;
  deliverable_status: JobDeliverableStatus;
  file_receipt_state: "not_applicable" | "missing_receipt" | "partial_receipt" | "exact_match" | "extra_files";
  overdue_approval_count: number;
  open_issue_count: number;
  blocking_issue_count: number;
  job_risk_status: JobRiskStatus;
  job_readiness_status: JobReadinessStatus;
};

export type SharedProductionQueueSummary = {
  total_count: number;
  blocked_count: number;
  overdue_count: number;
  awaiting_approval_count: number;
  qa_pending_count: number;
  due_today_count: number;
};

export type SharedProductionQueueResponse = {
  items: SharedProductionQueueItem[];
  summary: SharedProductionQueueSummary;
};

export type SharedJobDayInput = {
  day_label?: string | null;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  location_id?: string | null;
  onsite_contact_id?: string | null;
  lead_user_id?: string | null;
  day_status?: JobDayStatus | null;
  weather_sensitive?: boolean | null;
  indoor_outdoor?: string | null;
  access_notes?: string | null;
  parking_notes?: string | null;
  setup_notes?: string | null;
  travel_notes?: string | null;
};

export type SharedJobDraftInput = {
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
  actual_subject_count?: number | null;
  estimated_staff_count?: number | null;
  client_deadline_at?: string | null;
  production_deadline_at?: string | null;
  production_required?: boolean | null;
  location_override_note?: string | null;
  contact_override_note?: string | null;
  school_profile?: Partial<SchoolJobProfileView> | null;
  sports_profile?: Partial<SportsJobProfileView> | null;
  days?: SharedJobDayInput[] | null;
};

export type SharedJobListQuery = {
  department_type?: JobDepartmentType | "all";
  search?: string | null;
  day_date?: string | null;
  // Server-side status filters for coherent deep-linked views (see SharedJobsPage).
  production_status?: string | null;
  readiness_status?: string | null;
};

export type SharedJobLifecycleReasonInput = {
  reason: string;
};

export type SharedJobReadinessUpdateInput = {
  is_complete?: boolean | null;
  note?: string | null;
};

export type SharedJobReadyConfirmationInput = {
  on_site_confirmed: boolean;
  setup_complete: boolean;
  all_required_staff_present: boolean;
  blockers_resolved: boolean;
  equipment_ready?: boolean | null;
  client_contact_checked_in?: boolean | null;
  note?: string | null;
};

export type SharedJobStaffAssignmentUpdateInput = {
  assignment_role?: string | null;
  assignment_status?: JobAssignmentStatus | null;
  is_lead?: boolean | null;
  job_day_id?: string | null;
  is_ready_present?: boolean | null;
  notes?: string | null;
  request_backup?: boolean | null;
};

export type SharedJobStaffAssignmentCreateInput = {
  job_day_id?: string | null;
  user_id: string;
  assignment_role?: string | null;
  assignment_status?: JobAssignmentStatus | null;
  is_lead?: boolean | null;
  notes?: string | null;
};

export type SharedJobDayStatusUpdateInput = {
  day_status: JobDayStatus;
  note?: string | null;
};

export type SharedJobDayNoteInput = {
  note: string;
};

export type SharedJobWatchFlagInput = {
  id?: string | null;
  job_day_id?: string | null;
  production_item_id?: string | null;
  approval_request_id?: string | null;
  qa_review_record_id?: string | null;
  deliverable_item_id?: string | null;
  severity?: "info" | "low" | "medium" | "high" | "critical" | null;
  flag_type?: string | null;
  title?: string | null;
  description?: string | null;
  status?: "open" | "acknowledged" | "snoozed" | "resolved" | "dismissed" | null;
  owner_user_id?: string | null;
  due_at?: string | null;
};

export type SharedWatchFlagListItem = SharedJobWatchFlag & {
  department_type: JobDepartmentType;
  job_number: string | null;
  job_title: string;
  organization_id: string | null;
  organization_name: string | null;
  created_by_name: string | null;
  source_entity_label: string | null;
  source_scope_label: string | null;
  next_action_label: string;
  priority_rank: number;
};

export type SharedWatchlistSummary = {
  total_count: number;
  critical_count: number;
  high_count: number;
  snoozed_count: number;
  ownerless_count: number;
  next_24_hours_count: number;
};

export type SharedWatchlistSavedView = {
  id: string;
  tenant_id: string;
  owner_user_id: string | null;
  owner_name: string | null;
  scope_type: string;
  department_type: JobDepartmentType | null;
  name: string;
  filters_json: Record<string, unknown>;
  is_default: boolean;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
};

export type SharedWatchlistResponse = {
  items: SharedWatchFlagListItem[];
  summary: SharedWatchlistSummary;
  saved_views: SharedWatchlistSavedView[];
};

export type SharedWatchlistQuery = {
  department_type?: JobDepartmentType | "all";
  severity?: SharedJobWatchFlag["severity"] | "";
  flag_type?: string | null;
  owner_user_id?: string | null;
  status?: SharedJobWatchFlag["status"] | "";
  source_entity_type?: string | null;
  only_mine?: boolean;
  next_24_hours?: boolean;
  critical_high_only?: boolean;
  only_snoozed?: boolean;
  only_escalated?: boolean;
  view_id?: string | null;
  limit?: number;
};

export type SharedWatchlistSavedViewInput = {
  name: string;
  scope_type?: string | null;
  department_type?: JobDepartmentType | null;
  filters_json?: Record<string, unknown> | null;
  is_default?: boolean | null;
  is_shared?: boolean | null;
};

// Legacy watch/watchlist names remain as compatibility aliases while
// Exceptions becomes the canonical operator-facing vocabulary.
export type SharedExceptionListItem = SharedWatchFlagListItem;
export type SharedExceptionsSummary = SharedWatchlistSummary;
export type SharedExceptionsSavedView = SharedWatchlistSavedView;
export type SharedExceptionsResponse = SharedWatchlistResponse;
export type SharedExceptionsQuery = SharedWatchlistQuery;
export type SharedExceptionsSavedViewInput = SharedWatchlistSavedViewInput;

export type SharedAlertEvent = {
  id: string;
  tenant_id: string;
  watch_flag_id: string | null;
  source_entity_type: string;
  source_entity_id: string | null;
  alert_type: string;
  severity: SharedJobWatchFlag["severity"];
  title: string;
  message: string;
  status: string;
  triggered_at: string;
  dedupe_key: string;
  payload_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SharedAlertFeedItem = {
  id: string;
  tenant_id: string;
  alert_event_id: string;
  recipient_user_id: string;
  delivery_channel: "in_app" | "push" | "email" | "sms";
  delivery_status: "queued" | "delivered" | "failed" | "read" | "acted_on";
  delivered_at: string | null;
  read_at: string | null;
  acted_at: string | null;
  action_type: string | null;
  created_at: string;
  updated_at: string;
  alert_event: SharedAlertEvent;
  watch_flag: (SharedJobWatchFlag & { owner_name: string | null }) | null;
  job_id: string | null;
  job_number: string | null;
  job_title: string | null;
  department_type: JobDepartmentType | null;
  organization_name: string | null;
  recipient_name: string | null;
};

export type SharedAlertCenterSummary = {
  unread_count: number;
  critical_count: number;
  acted_count: number;
};

export type SharedAlertCenterResponse = {
  items: SharedAlertFeedItem[];
  summary: SharedAlertCenterSummary;
};

export type SharedAlertCenterQuery = {
  unread_only?: boolean;
  limit?: number;
};

export type SharedDashboardHealthState = "healthy" | "watch" | "at_risk" | "critical";

export type SharedDashboardHealthSummary = {
  score: number;
  state: SharedDashboardHealthState;
  explanation: string[];
};

export type SharedProductionReportingSummary = {
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
};

export type SharedProductionOwnerBacklogItem = {
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
};

export type SharedProductionDepartmentBacklogItem = {
  department_type: JobDepartmentType;
  open_count: number;
  blocked_count: number;
  overdue_count: number;
  due_this_week_count: number;
  rework_rate: number;
  on_time_release_percentage: number | null;
};

export type SharedProductionQaFailureCategoryItem = {
  category: string;
  label: string;
  count: number;
};

export type SharedProductionQaPerformanceItem = {
  reviewer_user_id: string | null;
  reviewer_name: string;
  reviews_completed: number;
  send_back_count: number;
  first_pass_approvals: number;
  accountability_failures: number;
  average_review_turnaround_days: number | null;
};

export type SharedProductionTrendBucket = {
  key: string;
  label: string;
  starts_at: string;
  ends_before: string;
  completions: number;
  releases: number;
  overdue: number;
  blocked: number;
  rework: number;
};

export type SharedProductionAccountBurdenItem = {
  account_owner_user_id: string | null;
  account_owner_name: string;
  open_count: number;
  blocked_count: number;
  overdue_count: number;
  at_risk_count: number;
  burden_score: number;
};

export type SharedProductionOrganizationRiskItem = {
  organization_id: string | null;
  organization_name: string;
  blocked_count: number;
  overdue_count: number;
  rework_count: number;
  file_mismatch_count: number;
  issue_count: number;
  risk_score: number;
};

export type SharedProductionDelaySignalItem = {
  production_item_id: string;
  title: string;
  organization_name: string | null;
  workflow_status: ProductionBoardWorkflowStatus;
  health_state: ProductionBoardHealthState;
  delay_days: number;
  post_shoot_eval_summary: string;
};

export type SharedProductionTopPerformerItem = {
  owner_user_id: string | null;
  owner_name: string;
  items_completed: number;
  on_time_release_percentage: number | null;
  first_pass_approval_rate: number | null;
  average_turnaround_days: number | null;
  qa_fail_rate: number;
  performance_score: number;
};

export type SharedProductionRestrictedOverlayCard = {
  key: string;
  title: string;
  availability: "live" | "scaffolded";
  summary: string;
  metric: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
};

export type SharedProductionReportingResponse = {
  generated_at: string;
  department_type: JobDepartmentType | null;
  summary: SharedProductionReportingSummary;
  management: {
    overdue_queue: SharedProductionQueueItem[];
    blocked_queue: SharedProductionQueueItem[];
    exception_view: Array<SharedProductionQueueItem & { exception_types: string[] }>;
    team_workload: SharedProductionOwnerBacklogItem[];
    qa_performance: SharedProductionQaPerformanceItem[];
  };
  insights: {
    backlog_by_owner: SharedProductionOwnerBacklogItem[];
    backlog_by_department: SharedProductionDepartmentBacklogItem[];
    qa_failure_categories: SharedProductionQaFailureCategoryItem[];
    operational_burden_by_account: SharedProductionAccountBurdenItem[];
    work_concentration_by_person: SharedProductionOwnerBacklogItem[];
    repeat_problem_organizations: SharedProductionOrganizationRiskItem[];
    post_shoot_eval_delay_signals: SharedProductionDelaySignalItem[];
    top_performers: SharedProductionTopPerformerItem[];
  };
  trends: {
    by_day: SharedProductionTrendBucket[];
    by_week: SharedProductionTrendBucket[];
  };
  urgent_watch: {
    total_count: number;
    critical_count: number;
    high_count: number;
    blocked_count: number;
    overdue_count: number;
    next_24_hours_count: number;
  };
  restricted_overlays: SharedProductionRestrictedOverlayCard[] | null;
};

export type SharedDashboardProductionSnapshot = {
  open_items: number;
  overdue_items: number;
  blocked_items: number;
  due_this_week: number;
  average_turnaround_days: number | null;
  on_time_release_percentage: number | null;
  rework_rate: number;
  first_pass_approval_rate: number | null;
};

export type SharedDashboardWidgetRoleKey = "photographer" | "production" | "schools" | "sports" | "leadership" | "default";

export type SharedDashboardWidgetLayoutItem = {
  widget_key: string;
  required: boolean;
  default_visible: boolean;
  default_position: number;
  reason: string;
};

export type SharedDashboardWidgetLayout = {
  role_key: SharedDashboardWidgetRoleKey;
  supports_personalization: boolean;
  items: SharedDashboardWidgetLayoutItem[];
};

export type SharedDashboardWidgetSummary = {
  widget_key: string;
  title: string;
  description: string;
  metric: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  count: number;
  route_hash: string;
};

export type SharedDashboardTodayJobItem = SharedJobListItem & {
  urgent_flag_count: number;
  critical_flag_count: number;
};

export type SharedWorkloadPressureItem = {
  owner_user_id: string | null;
  owner_name: string;
  open_flag_count: number;
  blocked_production_count: number;
  due_today_count: number;
  score: number;
};

export type SharedRecentMovementItem = {
  id: string;
  event_type: string;
  summary: string;
  created_at: string;
  actor_name: string | null;
  department_type: JobDepartmentType | null;
  job_id: string | null;
  job_number: string | null;
  organization_name: string | null;
};

export type SharedDashboardResponse = {
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
  health: SharedDashboardHealthSummary;
  widgets: SharedDashboardWidgetSummary[];
  widget_layout: SharedDashboardWidgetLayout;
  urgent_watch: SharedWatchFlagListItem[];
  checklist_attention_summary: SharedChecklistAttentionSummary;
  checklist_attention: SharedChecklistAttentionItem[];
  upcoming_risks: SharedWatchFlagListItem[];
  today_jobs: SharedDashboardTodayJobItem[];
  blocked_production: SharedProductionQueueItem[];
  overdue_approvals: SharedProductionQueueItem[];
  delivery_risks: SharedProductionQueueItem[];
  my_open_flags: SharedWatchFlagListItem[];
  recent_movement: SharedRecentMovementItem[];
  workload_pressure: SharedWorkloadPressureItem[];
  production_snapshot: SharedDashboardProductionSnapshot | null;
};

export type SharedChecklistAttentionState = "overdue" | "awaiting_approval" | "rejected" | "blocked" | "missing_proof" | "open";

export type SharedChecklistAttentionItem = {
  instance_id: string;
  scope_type: "shoot" | "production_item" | "job" | "location";
  scope_id: string;
  department_type: JobDepartmentType | null;
  job_id: string | null;
  shoot_id: string | null;
  production_item_id: string | null;
  title: string;
  template_name: string;
  target_title: string | null;
  organization_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  reviewer_user_id: string | null;
  approver_user_id: string | null;
  status: import("./checklistTypes").ChecklistInstanceStatus;
  attention_state: SharedChecklistAttentionState;
  blocking_level: import("./checklistTypes").ChecklistBlockingLevel;
  due_at: string | null;
  progress_percent: number;
  missing_required_count: number;
  missing_proof_count: number;
  missing_approval: boolean;
  blocked_transition: boolean;
  awaiting_approval: boolean;
  rejected: boolean;
  overdue: boolean;
};

export type SharedChecklistAttentionSummary = {
  total_count: number;
  overdue_count: number;
  awaiting_approval_count: number;
  rejected_count: number;
  blocked_count: number;
  missing_proof_count: number;
  assigned_to_me_count: number;
};

export type SharedDashboardWidgetPreference = {
  id: string;
  tenant_id: string;
  user_id: string;
  dashboard_scope: string;
  widget_key: string;
  position_index: number;
  is_visible: boolean;
  settings_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SharedDashboardWidgetPreferenceInput = {
  dashboard_scope: string;
  preferences: Array<{
    widget_key: string;
    position_index: number;
    is_visible: boolean;
    settings_json?: Record<string, unknown> | null;
  }>;
};

export type SharedProductionQueueQuery = {
  department_type?: JobDepartmentType | "all";
  status?: JobProductionStatus | "";
  workflow_status?: ProductionBoardWorkflowStatus | "";
  health_state?: ProductionBoardHealthState | "";
  approval_status?: JobApprovalStatus | "";
  qa_status?: JobQaReviewStatus | "";
  assigned_to_user_id?: string | null;
  blocked?: "yes" | "no" | "";
  priority?: JobPriorityLevel | "";
  due_bucket?: "today" | "overdue" | "next-7" | "";
  search?: string | null;
  deliverable_type?: string | null;
  organization_id?: string | null;
  release_status?: ProductionBoardReleaseStatus | "";
  checklist_state?: "overdue" | "awaiting_approval" | "rejected" | "blocked" | "";
};

export type SharedProductionReportingQuery = SharedProductionQueueQuery & {
  due_window?: "all" | "today" | "overdue" | "next_3" | "next_7" | "closed_last_7_days" | "";
};

export type SharedProductionItemInput = {
  id?: string | null;
  job_day_id?: string | null;
  production_group_key?: string | null;
  title?: string | null;
  job_type?: string | null;
  production_type?: string | null;
  production_template_key?: string | null;
  completion_rule_key?: string | null;
  created_from_source?: string | null;
  status?: JobProductionStatus | null;
  workflow_status?: ProductionBoardWorkflowStatus | null;
  health_state?: ProductionBoardHealthState | null;
  sync_state?: ProductionBoardSyncState | null;
  priority?: JobPriorityLevel | null;
  assigned_to_user_id?: string | null;
  assigned_peer_reviewer_user_id?: string | null;
  assigned_release_reviewer_user_id?: string | null;
  escalation_owner_user_id?: string | null;
  department_owner_user_id?: string | null;
  organization_id?: string | null;
  location_id?: string | null;
  primary_contact_id?: string | null;
  account_owner_user_id?: string | null;
  approval_required?: boolean | null;
  proof_required?: boolean | null;
  qa_required?: boolean | null;
  production_start_at?: string | null;
  due_at?: string | null;
  release_due_at?: string | null;
  delivery_deadline_at?: string | null;
  file_count_expected?: number | null;
  file_count_received?: number | null;
  file_match_status?: ProductionBoardFileMatchStatus | null;
  roster_received?: boolean | null;
  naming_verified?: boolean | null;
  folder_structure_verified?: boolean | null;
  tags_or_flags_verified?: boolean | null;
  handoff_complete?: boolean | null;
  upload_status?: ProductionBoardUploadStatus | null;
  release_status?: ProductionBoardReleaseStatus | null;
  release_target?: string | null;
  gallery_or_output_reference?: string | null;
  blocked_reason?: string | null;
  vendor_name?: string | null;
  vendor_reference?: string | null;
  client_visible_label?: string | null;
  qa_status?: string | null;
  creator_review_complete?: boolean | null;
  peer_review_complete?: boolean | null;
  final_release_review_complete?: boolean | null;
  internal_notes?: string | null;
  production_notes?: string | null;
  post_shoot_eval_summary?: string | null;
  risk_flag?: boolean | null;
  legacy_source_reference?: string | null;
  imported_status_source?: string | null;
  legacy_owner_history_json?: Array<Record<string, unknown>> | null;
  hold_reason?: string | null;
  hold_owner_user_id?: string | null;
  hold_review_at?: string | null;
  allow_checklist_override?: boolean | null;
  checklist_override_reason?: string | null;
  merged_into_production_item_id?: string | null;
};

export type SharedProductionHandoffInput = {
  id?: string | null;
  handoff_type?: string | null;
  from_stage?: string | null;
  to_stage?: string | null;
  from_user_id?: string | null;
  to_user_id?: string | null;
  status?: JobHandoffStatus | null;
  note?: string | null;
};

export type SharedApprovalRequestInput = {
  id?: string | null;
  job_day_id?: string | null;
  approval_type?: string | null;
  approver_contact_id?: string | null;
  approver_user_id?: string | null;
  status?: JobApprovalStatus | null;
  due_at?: string | null;
  summary?: string | null;
  notes?: string | null;
  log_follow_up?: boolean | null;
};

export type SharedQaReviewInput = {
  id?: string | null;
  review_type?: string | null;
  review_stage?: string | null;
  reviewer_user_id?: string | null;
  status?: JobQaReviewStatus | null;
  decision?: string | null;
  sample_size_percent?: number | null;
  checklist_template_key?: string | null;
  question_answers_json?: Record<string, unknown> | null;
  notes?: string | null;
  decision_reason?: string | null;
  issue_category?: string | null;
  rework_required?: boolean | null;
  sent_back_to_user_id?: string | null;
  override_same_reviewer?: boolean | null;
  override_reason?: string | null;
};

export type SharedQaFindingInput = {
  id?: string | null;
  finding_type?: string | null;
  severity?: "low" | "medium" | "high" | "critical" | null;
  title?: string | null;
  description?: string | null;
  is_blocking?: boolean | null;
  resolve?: boolean | null;
};

export type SharedDeliverableItemInput = {
  id?: string | null;
  parent_deliverable_item_id?: string | null;
  deliverable_type?: string | null;
  deliverable_group_key?: string | null;
  completion_marker_key?: string | null;
  title?: string | null;
  quantity?: number | null;
  delivery_method?: string | null;
  status?: JobDeliverableStatus | null;
  vendor_name?: string | null;
  tracking_reference?: string | null;
  recipient_contact_id?: string | null;
  recipient_organization_id?: string | null;
  notes?: string | null;
  legacy_source_reference?: string | null;
};

export type SharedProductionIssueInput = {
  id?: string | null;
  issue_type?: string | null;
  severity?: "low" | "medium" | "high" | "critical" | null;
  title?: string | null;
  description?: string | null;
  status?: JobProductionIssueStatus | null;
  owner_user_id?: string | null;
  due_at?: string | null;
};
