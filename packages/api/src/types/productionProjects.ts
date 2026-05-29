import type { OperationalActionTone } from "./managerCockpit.js";
import type {
  OperationalApprovalRequestSummary,
  OperationalApprovalSourceSummary
} from "./operationalApprovals.js";

/**
 * Compatibility seam for the legacy production/graphics workspace.
 *
 * These records still exist for runtime stability, but they are not the canonical long-term operating spine.
 * New shared workflow work should converge on Job -> Event -> StaffAssignment -> Task plus shared exceptions.
 */
export type ProductionProjectStatus = "new" | "active" | "blocked" | "waiting" | "completed" | "canceled";
export type ProductionProjectPriority = "low" | "normal" | "high" | "critical";
export type ProductionProjectSourceType = "manual" | "trigger";
export type ProductionProjectTaskStatus = "todo" | "in_progress" | "blocked" | "done" | "skipped";
export type ProductionProjectTaskType = "production" | "peer_review" | "final_qc" | "release" | "handoff" | "rework";
export type ProductionProjectTaskDependencyState = "ready" | "blocked" | "complete";
export type ProductionProjectDueState = "overdue" | "due_today" | "upcoming" | "unscheduled";
export type ProductionProjectJobType =
  | "standard_school_production"
  | "sports_production"
  | "specialty_graphics"
  | "banner_specialty_product"
  | "gallery_prep_upload"
  | "qa_final_review"
  | "correction_rework";
export type ProductionProjectQaState =
  | "not_started"
  | "ready_for_qa"
  | "in_qa_review"
  | "qa_hold"
  | "passed"
  | "failed"
  | "correction_needed"
  | "peer_review_required"
  | "final_review_required";
export type ProductionProjectQaCheckStatus = "pass" | "fail" | "not_applicable" | "needs_review";
export type ProductionProjectQaCheckKey =
  | "count_reconciliation"
  | "blocking_exceptions"
  | "buddy_workflow"
  | "virtual_team"
  | "asset_validation"
  | "final_review_notes";
export type ProductionProjectReleaseState = "not_ready" | "ready_to_release" | "released";
export type ProductionProjectBlockerType =
  | "missing_files"
  | "bad_incomplete_data"
  | "waiting_on_decision"
  | "waiting_on_customer_school"
  | "upload_failure"
  | "qa_issue"
  | "system_tool_problem"
  | "staffing_capacity_issue"
  | "external_vendor_dependency"
  | "other";
export type ProductionProjectReviewResult = "passed" | "correction_needed" | "blocked" | "released";
export type ProductionProjectHealthSignal =
  | "healthy"
  | "due_soon"
  | "overdue"
  | "blocked"
  | "release_risk"
  | "fragile"
  | "escalated";
export type ProductionProjectOwnershipState =
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "waiting_review"
  | "returned_for_correction"
  | "complete";
export type ProductionProjectTeamOwner = "production" | "graphics" | "upload" | "qa" | "release" | "corrections";
export type ProductionProjectCategory =
  | "production_follow_up"
  | "photography_production"
  | "digital_production"
  | "qa_peer_review"
  | "remediation";
export type ProductionProjectStage =
  | "intake_pending"
  | "ready_for_production"
  | "in_production"
  | "blocked"
  | "ready_for_qa"
  | "in_qa_review"
  | "qa_hold"
  | "correction_needed"
  | "ready_to_release"
  | "released_complete"
  | "on_hold"
  | "cancelled";
export type ProductionProjectQueueId =
  | "my_queue"
  | "team_queue"
  | "blocked_queue"
  | "qa_queue"
  | "ready_to_release_queue"
  | "at_risk_queue";
export type ProductionProjectWorkspaceView = "lead_board" | "staff_workspace";
export type ProductionLeadBoardSort =
  | "overdue_severity"
  | "due_date"
  | "priority"
  | "last_touched"
  | "owner"
  | "current_step";
export type ProductionLeadBoardFocus = "all" | "blocked" | "overdue" | "waiting";

/**
 * @deprecated Compatibility-only workflow family for the legacy production workspace.
 * Shared workflow runtime work should use the canonical shared workflow model instead.
 */
export type ProductionProjectWorkflowFamily = "general" | "schools" | "sports";

/**
 * @deprecated Compatibility-only workflow mode for the legacy production workspace.
 * Shared workflow runtime work should use the canonical shared workflow model instead.
 */
export type ProductionProjectWorkflowMode =
  | "manual_follow_up"
  | "post_shoot_wrap"
  | "digital_delivery"
  | "issue_remediation"
  | "resource_follow_up";

/**
 * @deprecated Compatibility-only workflow season metadata for the legacy production workspace.
 */
export type ProductionProjectWorkflowSeason = "all_year" | "spring" | "fall";
export type ProductionProjectLaneType = "buddy_photos" | "virtual_teams";
export type ProductionProjectExceptionStatus = "open" | "resolved" | "dismissed";
export type ProductionProjectExceptionSeverity = "low" | "normal" | "high" | "critical";
export type ProductionProjectExceptionType =
  | "buddy_unresolved_group"
  | "buddy_duplicate_handling_needed"
  | "vt_ambiguous_match"
  | "vt_coach_tag_missing"
  | "vt_split_group_mismatch"
  | "vt_attribute_validation_failed";
export type ProductionProjectFollowUpType = "training" | "ops_followup" | "coaching" | "process_update";
export type ProductionProjectFollowUpStatus = "open" | "in_progress" | "complete";

export interface ProductionProjectBuddyWorkflow {
  id: string;
  status: ProductionProjectTaskStatus;
  owner_user_id: string | null;
  owner_label: string | null;
  duplicate_handling_required: boolean;
  cleanup_completed_at: string | null;
  cleanup_completed_by_user_id: string | null;
  cleanup_completed_by_label: string | null;
  unresolved_group_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionProjectVirtualTeamWorkflow {
  id: string;
  status: ProductionProjectTaskStatus;
  owner_user_id: string | null;
  owner_label: string | null;
  attributes_validated: boolean;
  coach_tags_validated: boolean;
  split_by_group_validated: boolean;
  ambiguous_match_required: boolean;
  ambiguous_match_resolved_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionProjectExceptionRecord {
  id: string;
  lane_type: ProductionProjectLaneType;
  exception_type: ProductionProjectExceptionType;
  exception_type_label: string;
  severity: ProductionProjectExceptionSeverity;
  severity_label: string;
  blocking: boolean;
  status: ProductionProjectExceptionStatus;
  status_label: string;
  assignee_user_id: string | null;
  assignee_label: string | null;
  notes: string | null;
  resolution_notes: string | null;
  issue_tag: string | null;
  follow_up_type: ProductionProjectFollowUpType | null;
  follow_up_status: ProductionProjectFollowUpStatus | null;
  follow_up_owner_user_id: string | null;
  follow_up_owner_label: string | null;
  follow_up_notes: string | null;
  created_by_user_id: string | null;
  created_by_label: string | null;
  resolved_by_user_id: string | null;
  resolved_by_label: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ProductionProjectBlockerRecord {
  id: string;
  blocker_type: ProductionProjectBlockerType;
  blocker_type_label: string;
  blocker_owner_user_id: string | null;
  blocker_owner_label: string | null;
  reason: string;
  dependency: string | null;
  expected_resolution_date: string | null;
  expected_resolution_label: string | null;
  notes: string | null;
  blocked_at: string;
}

export interface ProductionProjectReviewRecord {
  id: string;
  review_stage: ProductionProjectStage;
  review_stage_label: string;
  reviewer_user_id: string | null;
  reviewer_label: string | null;
  result: ProductionProjectReviewResult;
  result_label: string;
  correction_reason: string | null;
  note: string | null;
  qa_checks: ProductionProjectQaCheckRecord[] | null;
  qa_checklist_complete: boolean;
  reassigned_owner_user_id: string | null;
  reassigned_owner_label: string | null;
  created_at: string;
}

export interface ProductionProjectQaCheckRecord {
  key: ProductionProjectQaCheckKey;
  label: string;
  status: ProductionProjectQaCheckStatus;
  notes?: string | null;
}

export interface ProductionProjectReferenceUserOption {
  id: string;
  label: string;
  detail: string | null;
}

export interface ProductionProjectReferenceOrganizationOption {
  id: string;
  label: string;
  detail: string | null;
}

export interface ProductionProjectReferenceLocationOption {
  id: string;
  organization_id: string | null;
  organization_label: string | null;
  label: string;
  detail: string | null;
}

export interface ProductionProjectReferenceShootOption {
  id: string;
  organization_id: string | null;
  organization_label: string | null;
  location_id: string | null;
  location_label: string | null;
  shoot_code: string | null;
  label: string;
  detail: string | null;
}

export interface ProductionProjectReferenceTriggerOption {
  key: string;
  label: string;
}

export interface ProductionProjectReferenceData {
  generated_at: string;
  owners: ProductionProjectReferenceUserOption[];
  organizations: ProductionProjectReferenceOrganizationOption[];
  locations: ProductionProjectReferenceLocationOption[];
  shoots: ProductionProjectReferenceShootOption[];
  source_triggers: ProductionProjectReferenceTriggerOption[];
}

export interface ProductionProjectTemplateTaskRecord {
  id: string;
  task_key: string;
  title: string;
  summary: string | null;
  due_offset_days: number;
  required: boolean;
  sort_order: number;
  task_type: ProductionProjectTaskType;
  task_type_label: string;
  handoff_required: boolean;
  blocks_release: boolean;
  dependency_task_keys: string[];
}

/**
 * @deprecated Compatibility-only template contract for the legacy production workspace.
 * Shared workflow template/runtime contracts now live under the shared workflow model.
 */
export interface ProductionProjectTemplateRecord {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  workflow_family: ProductionProjectWorkflowFamily;
  workflow_family_label: string;
  workflow_mode: ProductionProjectWorkflowMode;
  workflow_mode_label: string;
  season_key: ProductionProjectWorkflowSeason;
  season_label: string;
  default_priority: ProductionProjectPriority;
  job_type: ProductionProjectJobType;
  job_type_label: string;
  category: ProductionProjectCategory;
  category_label: string;
  default_stage: ProductionProjectStage;
  default_stage_label: string;
  peer_review_required: boolean;
  final_qc_required: boolean;
  task_count: number;
  tasks?: ProductionProjectTemplateTaskRecord[];
}

export interface ProductionProjectFlag {
  label: string;
  tone: OperationalActionTone;
}

export interface ProductionProjectSummaryRecord {
  id: string;
  template_id: string | null;
  template_key: string | null;
  template_name: string | null;
  workflow_family: ProductionProjectWorkflowFamily | null;
  workflow_family_label: string | null;
  workflow_mode: ProductionProjectWorkflowMode | null;
  workflow_mode_label: string | null;
  season_key: ProductionProjectWorkflowSeason | null;
  season_label: string | null;
  title: string;
  summary: string | null;
  status: ProductionProjectStatus;
  job_type: ProductionProjectJobType;
  job_type_label: string;
  category: ProductionProjectCategory;
  category_label: string;
  stage: ProductionProjectStage;
  stage_label: string;
  current_step_key: string | null;
  current_step_label: string;
  current_step_task_type: ProductionProjectTaskType | null;
  current_step_task_type_label: string | null;
  current_step_order: number | null;
  qa_state: ProductionProjectQaState;
  qa_state_label: string;
  release_state: ProductionProjectReleaseState;
  release_state_label: string;
  health_signal: ProductionProjectHealthSignal;
  health_signal_label: string;
  ownership_state: ProductionProjectOwnershipState;
  ownership_state_label: string;
  team_owner: ProductionProjectTeamOwner;
  team_owner_label: string;
  priority: ProductionProjectPriority;
  owner_user_id: string | null;
  owner_label: string;
  peer_review_required: boolean;
  final_qc_required: boolean;
  peer_reviewer_user_id: string | null;
  peer_reviewer_label: string | null;
  final_qc_reviewer_user_id: string | null;
  final_qc_reviewer_label: string | null;
  due_date: string | null;
  due_label: string | null;
  follow_up_date: string | null;
  follow_up_label: string | null;
  snoozed_until: string | null;
  latest_note: string | null;
  source_type: ProductionProjectSourceType;
  source_trigger_key: string | null;
  source_trigger_label: string | null;
  created_reason: string;
  linked_organization_id: string | null;
  linked_organization_name: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  linked_shoot_id: string | null;
  linked_shoot_date: string | null;
  linked_shoot_date_label: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_shoot_type_label: string | null;
  linked_shoot_importance_tier: "standard" | "elevated" | "big_shoot" | "critical_shoot" | null;
  linked_shoot_importance_label: string | null;
  shoot_photographer_count: number | null;
  shoot_camera_station_count: number | null;
  context_label: string | null;
  open_task_count: number;
  open_required_task_count: number;
  completed_task_count: number;
  blocked_task_count: number;
  overdue_task_count: number;
  pending_peer_review: boolean;
  pending_final_qc: boolean;
  pending_release_tasks: number;
  release_blocked: boolean;
  buddy_workflow_status: ProductionProjectTaskStatus | null;
  buddy_duplicate_required: boolean;
  buddy_cleanup_complete: boolean;
  buddy_unresolved_group_count: number;
  vt_workflow_status: ProductionProjectTaskStatus | null;
  vt_ambiguous_match_required: boolean;
  vt_coach_tags_validated: boolean;
  vt_split_by_group_validated: boolean;
  vt_attributes_validated: boolean;
  task_authority_label: string;
  task_authority_reasons: string[];
  next_owner_label: string | null;
  blocker_count: number;
  current_blocker: ProductionProjectBlockerRecord | null;
  due_within_24_hours: boolean;
  overdue: boolean;
  stale_active: boolean;
  stale_label: string | null;
  last_touched_label: string;
  has_latest_note: boolean;
  corrections_needed: boolean;
  waiting_to_send: boolean;
  ready_to_send: boolean;
  production_can_touch: boolean;
  production_touch_label: string;
  production_touch_reasons: string[];
  next_action: string;
  status_tone: OperationalActionTone;
  flags: ProductionProjectFlag[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProductionProjectBoardSection {
  id: ProductionProjectQueueId;
  label: string;
  summary: string;
  count: number;
  items: ProductionProjectSummaryRecord[];
}

export type ProductionProjectIntakeIssueKind =
  | "duplicate_source"
  | "conflicting_link"
  | "sync_failed"
  | "sync_stale"
  | "backfill_failed";

export interface ProductionProjectIntakeIssue {
  id: string;
  issue_kind: ProductionProjectIntakeIssueKind;
  issue_kind_label: string;
  tone: OperationalActionTone;
  tone_label: string;
  title: string;
  summary: string;
  source_label: string;
  source_system_label: string;
  source_reference: string | null;
  context_label: string | null;
  linked_project_id: string | null;
  linked_project_title: string | null;
  action_hash: string;
  last_seen_at: string | null;
}

export interface ProductionProjectIntakeSummary {
  generated_at: string;
  summary_line: string;
  counts: {
    sources_considered: number;
    created: number;
    linked: number;
    duplicates: number;
    conflicts: number;
    sync_failures: number;
    stale_syncs: number;
  };
  issues: ProductionProjectIntakeIssue[];
}

export interface ProductionProjectBoardResponse {
  generated_at: string;
  anchor_date: string;
  default_workspace_view: ProductionProjectWorkspaceView;
  filters: {
    status: "open" | "completed" | "all";
    queue: ProductionProjectQueueId | "all";
    workspace_view: ProductionProjectWorkspaceView;
    search: string;
    owner_user_id: string | "unassigned" | null;
    priority: ProductionProjectPriority | "all";
    template_id: string | null;
    source_type: ProductionProjectSourceType | "all";
    source_trigger_key: string | null;
    category: ProductionProjectCategory | "all";
    job_type: ProductionProjectJobType | "all";
    stage: ProductionProjectStage | "all";
    team_owner: ProductionProjectTeamOwner | "all";
    linked_organization_id: string | null;
    linked_location_id: string | null;
    linked_shoot_id: string | null;
    due_state: ProductionProjectDueState | "all";
    big_critical_only: boolean;
    lead_board_sort: ProductionLeadBoardSort;
    lead_board_focus: ProductionLeadBoardFocus;
  };
  summary: {
    total_visible: number;
    open_projects: number;
    all_unfinished: number;
    my_queue: number;
    team_queue: number;
    blocked_queue: number;
    qa_queue: number;
    ready_to_release_queue: number;
    at_risk_queue: number;
    unassigned_jobs: number;
    active_jobs: number;
    on_time: number;
    blocked: number;
    due_within_24_hours: number;
    overdue: number;
    jobs_in_qa: number;
    ready_to_release: number;
    stale_active: number;
    corrections_needed: number;
    waiting_to_send: number;
    ready_to_send: number;
    trigger_intake_waiting?: number;
    needs_setup?: number;
    needs_follow_up?: number;
    overdue_tasks?: number;
    completed_recently?: number;
    in_production?: number;
    blocked_or_corrections?: number;
    blocked_or_changes_requested?: number;
    awaiting_peer_review?: number;
    awaiting_final_qc?: number;
    release_blockers?: number;
    jobs_needing_owner_reassignment?: number;
  };
  lead_board: {
    summary_line: string;
    items: ProductionProjectSummaryRecord[];
  };
  intake: ProductionProjectIntakeSummary;
  sections: ProductionProjectBoardSection[];
}

export interface ProductionProjectTaskRecord {
  id: string;
  template_task_id: string | null;
  task_key: string | null;
  title: string;
  summary: string | null;
  status: ProductionProjectTaskStatus;
  task_type: ProductionProjectTaskType;
  task_type_label: string;
  owner_user_id: string | null;
  owner_label: string | null;
  due_date: string | null;
  due_label: string | null;
  latest_note: string | null;
  required: boolean;
  sort_order: number;
  handoff_required: boolean;
  blocks_release: boolean;
  started_at: string | null;
  completed_at: string | null;
  overdue: boolean;
  at_risk: boolean;
  dependency_state: ProductionProjectTaskDependencyState;
  dependency_state_label: string;
  blocking_dependencies: Array<{
    task_id: string;
    title: string;
    status: ProductionProjectTaskStatus;
    status_label: string;
  }>;
  dependent_task_count: number;
  last_handoff_at: string | null;
  last_handoff_to_user_id: string | null;
  last_handoff_to_label: string | null;
}

export interface ProductionProjectTaskHandoffRecord {
  id: string;
  task_id: string;
  task_title: string;
  from_user_id: string | null;
  from_user_label: string | null;
  to_user_id: string | null;
  to_user_label: string | null;
  note: string | null;
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
}

export interface ProductionProjectTaskEventRecord {
  id: string;
  task_id: string;
  task_title: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

/**
 * @deprecated Compatibility-only workflow summary for the legacy production workspace.
 * New workflow execution surfaces should prefer shared workflow read models.
 */
export interface ProductionProjectWorkflowSummary {
  release_blocked: boolean;
  can_move_to_ready_to_release: boolean;
  can_release: boolean;
  blocked_reasons: string[];
  open_required_tasks: number;
  blocked_task_count: number;
  overdue_task_count: number;
  pending_peer_review: boolean;
  pending_final_qc: boolean;
  pending_release_tasks: number;
  deadline_ladder: Array<{
    task_id: string;
    title: string;
    due_date: string | null;
    due_label: string | null;
    status: ProductionProjectTaskStatus;
    status_label: string;
    owner_label: string | null;
    task_type: ProductionProjectTaskType;
    task_type_label: string;
    dependency_state: ProductionProjectTaskDependencyState;
    dependency_state_label: string;
  }>;
}

export interface ProductionProjectEventRecord {
  id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ProductionProjectDetail {
  project: ProductionProjectSummaryRecord;
  tasks: ProductionProjectTaskRecord[];
  reviews: ProductionProjectReviewRecord[];
  events: ProductionProjectEventRecord[];
  task_handoffs: ProductionProjectTaskHandoffRecord[];
  task_events: ProductionProjectTaskEventRecord[];
  workflow_summary: ProductionProjectWorkflowSummary;
  approval_summary: OperationalApprovalSourceSummary | null;
  buddy_workflow: ProductionProjectBuddyWorkflow | null;
  virtual_team_workflow: ProductionProjectVirtualTeamWorkflow | null;
  exceptions: ProductionProjectExceptionRecord[];
}

export interface ProductionProjectQaWorkspaceReview {
  review: ProductionProjectReviewRecord;
  project: ProductionProjectSummaryRecord;
}

export interface ProductionProjectQaWorkspace {
  generated_at: string;
  anchor_date: string;
  qa_hold: ProductionProjectSummaryRecord[];
  ready_for_qa: ProductionProjectSummaryRecord[];
  blocked_by_exceptions: ProductionProjectSummaryRecord[];
  ready_for_release: ProductionProjectSummaryRecord[];
  recent_reviews: ProductionProjectQaWorkspaceReview[];
}

export interface ProductionProjectAnalyticsRow {
  key: string;
  label: string;
  count: number;
}

export interface ProductionProjectAnalyticsStageRow {
  stage: ProductionProjectStage;
  stage_label: string;
  count: number;
  avg_days_in_stage: number;
  oldest_days_in_stage: number;
}

export interface ProductionProjectAnalytics {
  generated_at: string;
  window_start: string;
  window_end: string;
  qa_issues_by_photographer: ProductionProjectAnalyticsRow[];
  qa_issues_by_job_type: ProductionProjectAnalyticsRow[];
  qa_issues_by_account: ProductionProjectAnalyticsRow[];
  qa_issues_by_location: ProductionProjectAnalyticsRow[];
  exception_type_frequency: ProductionProjectAnalyticsRow[];
  recurring_issue_tags: ProductionProjectAnalyticsRow[];
  buddy_workload: {
    total: number;
    duplicate_handling_required: number;
    unresolved_groups: number;
  };
  virtual_team_workload: {
    total: number;
    ambiguous_matches: number;
  };
  release_delay_stages: ProductionProjectAnalyticsStageRow[];
}

export type ProductionProjectMutationResult =
  | ProductionProjectDetail
  | {
      approval_required: true;
      approval_request: OperationalApprovalRequestSummary;
      detail: ProductionProjectDetail;
    };
