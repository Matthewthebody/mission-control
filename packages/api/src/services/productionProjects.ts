import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { createAuditLog } from "./audit.js";
import type { AuthUser } from "../types/auth.js";
import type { ManagerCockpitFlag, ManagerCockpitQueueItem } from "../types/managerCockpit.js";
import { hasLeadershipApprovalAuthority, hasManagerApprovalAuthority } from "./approvalRights.js";
import {
  consumeApprovedOperationalApproval,
  ensureOperationalApprovalRequest,
  listOperationalApprovalSourceSummary,
  markOperationalApprovalExecuted
} from "./operationalApprovals.js";
import { evaluateShootPriority, type ShootImportanceTier } from "./shootPriority.js";
import type {
  ProductionLeadBoardFocus,
  ProductionLeadBoardSort,
  ProductionProjectBoardResponse,
  ProductionProjectBoardSection,
  ProductionProjectBlockerRecord,
  ProductionProjectBlockerType,
  ProductionProjectCategory,
  ProductionProjectDetail,
  ProductionProjectAnalytics,
  ProductionProjectAnalyticsRow,
  ProductionProjectAnalyticsStageRow,
  ProductionProjectDueState,
  ProductionProjectEventRecord,
  ProductionProjectFlag,
  ProductionProjectHealthSignal,
  ProductionProjectIntakeSummary,
  ProductionProjectJobType,
  ProductionProjectOwnershipState,
  ProductionProjectPriority,
  ProductionProjectQaCheckKey,
  ProductionProjectQaCheckRecord,
  ProductionProjectQaCheckStatus,
  ProductionProjectQaState,
  ProductionProjectQaWorkspace,
  ProductionProjectQaWorkspaceReview,
  ProductionProjectQueueId,
  ProductionProjectReferenceData,
  ProductionProjectReleaseState,
  ProductionProjectReviewRecord,
  ProductionProjectReviewResult,
  ProductionProjectStage,
  ProductionProjectStatus,
  ProductionProjectSummaryRecord,
  ProductionProjectTeamOwner,
  ProductionProjectTaskRecord,
  ProductionProjectTaskStatus,
  ProductionProjectTaskType,
  ProductionProjectTaskDependencyState,
  ProductionProjectTaskEventRecord,
  ProductionProjectTaskHandoffRecord,
  ProductionProjectTemplateRecord,
  ProductionProjectTemplateTaskRecord,
  ProductionProjectWorkflowFamily,
  ProductionProjectWorkflowMode,
  ProductionProjectWorkflowSeason,
  ProductionProjectWorkspaceView,
  ProductionProjectWorkflowSummary,
  ProductionProjectMutationResult
} from "../types/productionProjects.js";

export type CreateProductionProjectInput = {
  templateId?: string | null;
  title: string;
  summary?: string | null;
  status?: ProductionProjectStatus;
  jobType?: ProductionProjectJobType;
  category?: ProductionProjectCategory;
  stage?: ProductionProjectStage;
  priority?: ProductionProjectPriority;
  ownerUserId?: string | null;
  peerReviewerUserId?: string | null;
  finalQcReviewerUserId?: string | null;
  dueDate?: string | null;
  followUpDate?: string | null;
  linkedOrganizationId?: string | null;
  linkedLocationId?: string | null;
  linkedShootId?: string | null;
  latestNote?: string | null;
};

export type UpdateProductionProjectInput = {
  title?: string;
  summary?: string | null;
  status?: ProductionProjectStatus;
  jobType?: ProductionProjectJobType;
  stage?: ProductionProjectStage;
  priority?: ProductionProjectPriority;
  ownerUserId?: string | null;
  peerReviewerUserId?: string | null;
  finalQcReviewerUserId?: string | null;
  dueDate?: string | null;
  followUpDate?: string | null;
  snoozedUntil?: string | null;
  latestNote?: string | null;
  blockerType?: ProductionProjectBlockerType | null;
  blockerOwnerUserId?: string | null;
  blockerReason?: string | null;
  blockerDependency?: string | null;
  blockerExpectedResolutionDate?: string | null;
  blockerNotes?: string | null;
  clearBlocker?: boolean;
  correctionReason?: string | null;
  qaChecks?: ProductionProjectQaCheckRecord[] | null;
  qaChecklistComplete?: boolean;
};

export type UpdateProductionProjectTaskInput = {
  status?: ProductionProjectTaskStatus;
  ownerUserId?: string | null;
  dueDate?: string | null;
  latestNote?: string | null;
  handoffToUserId?: string | null;
  handoffNote?: string | null;
};

export type UpdateProductionProjectBuddyWorkflowInput = {
  status?: ProductionProjectTaskStatus;
  ownerUserId?: string | null;
  duplicateHandlingRequired?: boolean;
  cleanupCompleted?: boolean;
  unresolvedGroupCount?: number;
  notes?: string | null;
};

export type UpdateProductionProjectVirtualTeamWorkflowInput = {
  status?: ProductionProjectTaskStatus;
  ownerUserId?: string | null;
  attributesValidated?: boolean;
  coachTagsValidated?: boolean;
  splitByGroupValidated?: boolean;
  ambiguousMatchRequired?: boolean;
  ambiguousMatchResolved?: boolean;
  notes?: string | null;
};

export type CreateProductionProjectExceptionInput = {
  laneType: "buddy_photos" | "virtual_teams";
  exceptionType:
    | "buddy_unresolved_group"
    | "buddy_duplicate_handling_needed"
    | "vt_ambiguous_match"
    | "vt_coach_tag_missing"
    | "vt_split_group_mismatch"
    | "vt_attribute_validation_failed";
  severity?: "low" | "normal" | "high" | "critical";
  blocking?: boolean;
  assigneeUserId?: string | null;
  notes?: string | null;
  issueTag?: string | null;
  followUpType?: "training" | "ops_followup" | "coaching" | "process_update" | null;
  followUpStatus?: "open" | "in_progress" | "complete" | null;
  followUpOwnerUserId?: string | null;
  followUpNotes?: string | null;
};

export type UpdateProductionProjectExceptionInput = {
  status?: "open" | "resolved" | "dismissed";
  blocking?: boolean;
  assigneeUserId?: string | null;
  notes?: string | null;
  resolutionNotes?: string | null;
  issueTag?: string | null;
  followUpType?: "training" | "ops_followup" | "coaching" | "process_update" | null;
  followUpStatus?: "open" | "in_progress" | "complete" | null;
  followUpOwnerUserId?: string | null;
  followUpNotes?: string | null;
};

type TriggeredProjectInput = {
  triggerKey: string;
  sourceEventKey: string;
  title: string;
  summary?: string | null;
  createdReason: string;
  anchorDate: string;
  ownerUserId?: string | null;
  priority?: ProductionProjectPriority | null;
  jobType?: ProductionProjectJobType | null;
  category?: ProductionProjectCategory | null;
  stage?: ProductionProjectStage | null;
  dueDate?: string | null;
  followUpDate?: string | null;
  linkedOrganizationId?: string | null;
  linkedLocationId?: string | null;
  linkedShootId?: string | null;
  latestNote?: string | null;
};

type ProjectListOptions = {
  anchorDate: string;
  workspaceView?: ProductionProjectWorkspaceView | null;
  status?: "open" | "completed" | "all";
  queue?: ProductionProjectQueueId | "all";
  search?: string | null;
  ownerUserId?: string | "unassigned" | null;
  priority?: ProductionProjectPriority | null;
  templateId?: string | null;
  sourceType?: "manual" | "trigger" | null;
  sourceTriggerKey?: string | null;
  category?: ProductionProjectCategory | null;
  jobType?: ProductionProjectJobType | null;
  stage?: ProductionProjectStage | null;
  teamOwner?: ProductionProjectTeamOwner | null;
  linkedOrganizationId?: string | null;
  linkedLocationId?: string | null;
  linkedShootId?: string | null;
  dueState?: ProductionProjectDueState | null;
  bigCriticalOnly?: boolean;
  leadBoardSort?: ProductionLeadBoardSort;
  leadBoardFocus?: ProductionLeadBoardFocus;
};

type ProjectRow = {
  id: string;
  template_id: string | null;
  template_key: string | null;
  template_name: string | null;
  template_workflow_family: ProductionProjectWorkflowFamily | null;
  template_workflow_mode: ProductionProjectWorkflowMode | null;
  template_season_key: ProductionProjectWorkflowSeason | null;
  title: string;
  summary: string | null;
  status: ProductionProjectStatus;
  job_type: ProductionProjectJobType;
  category: ProductionProjectCategory;
  template_category: ProductionProjectCategory | null;
  template_default_stage: ProductionProjectStage | null;
  stage: ProductionProjectStage;
  qa_state: ProductionProjectQaState;
  release_state: ProductionProjectReleaseState;
  previous_active_stage: ProductionProjectStage | null;
  correction_reason: string | null;
  priority: ProductionProjectPriority;
  owner_user_id: string | null;
  owner_name: string | null;
  peer_review_required: boolean;
  final_qc_required: boolean;
  peer_reviewer_user_id: string | null;
  peer_reviewer_name: string | null;
  final_qc_reviewer_user_id: string | null;
  final_qc_reviewer_name: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  snoozed_until: string | null;
  latest_note: string | null;
  source_type: "manual" | "trigger";
  source_trigger_key: string | null;
  source_trigger_label: string | null;
  created_reason: string;
  linked_organization_id: string | null;
  linked_organization_name: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  linked_shoot_id: string | null;
  linked_shoot_date: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_shoot_type: string | null;
  shoot_projected_students: number | string | null;
  shoot_camera_station_count: number | string | null;
  shoot_template_photographer_count: number | string | null;
  shoot_estimated_drive_minutes: number | string | null;
  shoot_first_year_customer_flag: boolean | null;
  shoot_flagship_priority_account_flag: boolean | null;
  shoot_strategic_district_importance: boolean | null;
  shoot_revenue_potential_score: number | string | null;
  shoot_account_growth_importance_score: number | string | null;
  shoot_complexity_score: number | string | null;
  shoot_customer_history_risk_score: number | string | null;
  shoot_multi_team_coordination: boolean | null;
  shoot_weather_travel_risk_flag: boolean | null;
  shoot_manual_leadership_boost: number | string | null;
  shoot_importance_override_tier: ShootImportanceTier | null;
  shoot_importance_override_reason: string | null;
  shoot_missing_staffing_coverage_count: number;
  shoot_missing_required_prep_count: number;
  blocker_id: string | null;
  blocker_type: ProductionProjectBlockerType | null;
  blocker_owner_user_id: string | null;
  blocker_owner_name: string | null;
  blocker_reason: string | null;
  blocker_dependency: string | null;
  blocker_expected_resolution_date: string | null;
  blocker_notes: string | null;
  blocker_created_at: string | null;
  blocker_count: number;
  open_task_count: number;
  open_required_task_count: number;
  completed_task_count: number;
  blocked_task_count: number;
  overdue_task_count: number;
  pending_peer_review: boolean;
  pending_final_qc: boolean;
  pending_release_tasks: number;
  buddy_status: ProductionProjectTaskStatus | null;
  buddy_duplicate_handling_required: boolean;
  buddy_cleanup_completed_at: string | null;
  buddy_unresolved_group_count: number;
  vt_status: ProductionProjectTaskStatus | null;
  vt_attributes_validated: boolean;
  vt_coach_tags_validated: boolean;
  vt_split_by_group_validated: boolean;
  vt_ambiguous_match_required: boolean;
  vt_ambiguous_match_resolved_at: string | null;
  current_step_task_id: string | null;
  current_step_task_key: string | null;
  current_step_title: string | null;
  current_step_task_type: ProductionProjectTaskType | null;
  current_step_sort_order: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProjectTaskRow = {
  id: string;
  template_task_id: string | null;
  task_key: string | null;
  title: string;
  summary: string | null;
  status: ProductionProjectTaskStatus;
  task_type: ProductionProjectTaskType;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  latest_note: string | null;
  required: boolean;
  sort_order: number;
  handoff_required: boolean;
  blocks_release: boolean;
  started_at: string | null;
  completed_at: string | null;
  last_handoff_at: string | null;
  last_handoff_to_user_id: string | null;
  last_handoff_to_name: string | null;
  dependency_count: number;
  unresolved_dependency_count: number;
  blocking_dependency_titles: string[] | null;
  blocking_dependency_statuses: string[] | null;
  blocking_dependency_ids: string[] | null;
  dependent_task_count: number;
};

type ProjectEventRow = {
  id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type ProjectReviewRow = {
  id: string;
  review_stage: ProductionProjectStage;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  result: ProductionProjectReviewResult;
  correction_reason: string | null;
  note: string | null;
  qa_checks: ProductionProjectQaCheckRecord[] | null;
  qa_checklist_complete: boolean;
  reassigned_owner_user_id: string | null;
  reassigned_owner_name: string | null;
  created_at: string;
  project_id?: string;
};

type BuddyWorkflowRow = {
  id: string;
  status: ProductionProjectTaskStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  duplicate_handling_required: boolean;
  cleanup_completed_at: string | null;
  cleanup_completed_by_user_id: string | null;
  cleanup_completed_by_name: string | null;
  unresolved_group_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type VirtualTeamWorkflowRow = {
  id: string;
  status: ProductionProjectTaskStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  attributes_validated: boolean;
  coach_tags_validated: boolean;
  split_by_group_validated: boolean;
  ambiguous_match_required: boolean;
  ambiguous_match_resolved_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectExceptionRow = {
  id: string;
  lane_type: "buddy_photos" | "virtual_teams";
  exception_type:
    | "buddy_unresolved_group"
    | "buddy_duplicate_handling_needed"
    | "vt_ambiguous_match"
    | "vt_coach_tag_missing"
    | "vt_split_group_mismatch"
    | "vt_attribute_validation_failed";
  severity: "low" | "normal" | "high" | "critical";
  blocking: boolean;
  status: "open" | "resolved" | "dismissed";
  assignee_user_id: string | null;
  assignee_name: string | null;
  notes: string | null;
  resolution_notes: string | null;
  issue_tag: string | null;
  follow_up_type: "training" | "ops_followup" | "coaching" | "process_update" | null;
  follow_up_status: "open" | "in_progress" | "complete" | null;
  follow_up_owner_user_id: string | null;
  follow_up_owner_name: string | null;
  follow_up_notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
};

type TemplateRow = {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  workflow_family: ProductionProjectWorkflowFamily;
  workflow_mode: ProductionProjectWorkflowMode;
  season_key: ProductionProjectWorkflowSeason;
  default_priority: ProductionProjectPriority;
  job_type: ProductionProjectJobType;
  category: ProductionProjectCategory;
  default_stage: ProductionProjectStage;
  peer_review_required: boolean;
  final_qc_required: boolean;
  task_count: number;
};

type TemplateTaskRow = {
  id: string;
  template_id: string;
  task_key: string;
  title: string;
  summary: string | null;
  due_offset_days: number;
  required: boolean;
  sort_order: number;
  task_type: ProductionProjectTaskType;
  handoff_required: boolean;
  blocks_release: boolean;
  dependency_task_keys: string[] | null;
};

type ProjectTaskHandoffRow = {
  id: string;
  task_id: string;
  task_title: string;
  from_user_id: string | null;
  from_user_name: string | null;
  to_user_id: string | null;
  to_user_name: string | null;
  note: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
};

type ProjectTaskEventRow = {
  id: string;
  task_id: string;
  task_title: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type TriggerRuleRow = {
  id: string;
  trigger_key: string;
  name: string;
  template_id: string;
  template_key: string;
  template_name: string;
  template_description: string | null;
  template_workflow_family: ProductionProjectWorkflowFamily;
  template_workflow_mode: ProductionProjectWorkflowMode;
  template_season_key: ProductionProjectWorkflowSeason;
  template_default_priority: ProductionProjectPriority;
  template_job_type: ProductionProjectJobType;
  template_category: ProductionProjectCategory;
  template_default_stage: ProductionProjectStage;
  template_peer_review_required: boolean;
  template_final_qc_required: boolean;
  default_due_offset_days: number;
  default_follow_up_offset_days: number | null;
};

type ProductionProjectWorkflowGate = {
  openRequiredTaskCount: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  pendingPeerReview: boolean;
  pendingFinalQc: boolean;
  pendingReleaseTasks: number;
  blockedReasons: string[];
};

export type ProductionProjectHomeSnapshot = {
  generated_at: string;
  anchor_date: string;
  summary_line: string;
  tone: "neutral" | "good" | "heads_up" | "action_needed" | "info";
  counts: {
    unassigned_jobs: number;
    active_jobs: number;
    on_time: number;
    overdue: number;
    blocked: number;
    due_within_24_hours: number;
    jobs_in_qa: number;
    ready_to_release: number;
    peer_review_lag: number;
    final_qc_lag: number;
    release_blockers: number;
    stale_active: number;
    attention_needed: number;
  };
  assessment_cards: Array<{
    id:
      | "unassigned_jobs"
      | "overdue"
      | "blocked"
      | "due_within_24_hours"
      | "jobs_in_qa"
      | "ready_to_release"
      | "peer_review_lag"
      | "final_qc_lag"
      | "release_blockers"
      | "stale_active";
    label: string;
    value: number;
    tone: "neutral" | "good" | "heads_up" | "action_needed" | "info";
    detail: string;
    action_hash: string;
  }>;
  owners: Array<{
    owner_user_id: string | null;
    owner_label: string;
    assignment_label: string;
    open_count: number;
    in_production_count: number;
    qa_queue_count: number;
    ready_to_release_count: number;
    overdue_count: number;
    pressure_label: string;
    action_hash: string;
  }>;
  focus_items: Array<{
    project_id: string;
    title: string;
    summary: string;
    owner_label: string;
    stage_label: string;
    queue_label: string;
    reviewer_label: string | null;
    due_label: string | null;
    next_action: string;
    tone: "neutral" | "good" | "heads_up" | "action_needed" | "info";
    action_hash: string;
  }>;
  urgent_items: Array<{
    project_id: string;
    title: string;
    summary: string;
    owner_label: string;
    stage_label: string;
    due_label: string | null;
    urgency_state: "overdue" | "due_within_24h" | "action_needed_today";
    urgency_label: string;
    action_hash: string;
  }>;
};

export type ProductionUrgentWatchFact = {
  project: ProductionProjectSummaryRecord;
  action_hash: string;
  due_at: string | null;
  workflow_gate: {
    blocked_task_count: number;
    overdue_task_count: number;
    blocked_reasons: string[];
  };
};

type LinkedContext = {
  organizationId: string | null;
  organizationName: string | null;
  locationId: string | null;
  locationName: string | null;
  shootId: string | null;
  shootCode: string | null;
  shootTitle: string | null;
};

export async function listProductionProjectTemplates(
  client: PoolClient,
  auth: AuthUser
): Promise<ProductionProjectTemplateRecord[]> {
  const templateResult = await client.query<TemplateRow>(
    `
      SELECT
        template.id,
        template.template_key,
        template.name,
        template.description,
        template.workflow_family,
        template.workflow_mode,
        template.season_key,
        template.default_priority::text AS default_priority,
        template.job_type::text AS job_type,
        template.category::text AS category,
        template.default_stage::text AS default_stage,
        template.peer_review_required,
        template.final_qc_required,
        COUNT(task.id)::int AS task_count
      FROM production_project_template template
      LEFT JOIN production_project_template_task task
        ON task.tenant_id = template.tenant_id
       AND task.template_id = template.id
      WHERE template.tenant_id = $1
        AND template.active_status = true
      GROUP BY template.id
      ORDER BY template.name ASC
    `,
    [auth.tenantId]
  );

  const taskResult = await client.query<TemplateTaskRow>(
    `
      SELECT
        id,
        template_id,
        task_key,
        title,
        summary,
        due_offset_days,
        required,
        sort_order,
        task_type::text AS task_type,
        handoff_required,
        blocks_release,
        COALESCE(
          ARRAY(
            SELECT dependency_task.task_key
            FROM production_project_template_task_dependency dependency
            JOIN production_project_template_task dependency_task
              ON dependency_task.tenant_id = dependency.tenant_id
             AND dependency_task.id = dependency.depends_on_template_task_id
            WHERE dependency.tenant_id = production_project_template_task.tenant_id
              AND dependency.task_template_id = production_project_template_task.id
            ORDER BY dependency_task.sort_order ASC, dependency_task.task_key ASC
          ),
          ARRAY[]::text[]
        ) AS dependency_task_keys
      FROM production_project_template_task
      WHERE tenant_id = $1
      ORDER BY sort_order ASC, title ASC
    `,
    [auth.tenantId]
  );

  const tasksByTemplate = new Map<string, ProductionProjectTemplateTaskRecord[]>();
  for (const row of taskResult.rows) {
    const bucket = tasksByTemplate.get(row.template_id) ?? [];
    bucket.push({
      id: row.id,
      task_key: row.task_key,
      title: row.title,
      summary: row.summary,
      due_offset_days: row.due_offset_days,
      required: row.required,
      sort_order: row.sort_order,
      task_type: row.task_type,
      task_type_label: humanizeProjectTaskType(row.task_type),
      handoff_required: row.handoff_required,
      blocks_release: row.blocks_release,
      dependency_task_keys: row.dependency_task_keys ?? []
    });
    tasksByTemplate.set(row.template_id, bucket);
  }

  return templateResult.rows.map((row) => ({
    id: row.id,
    template_key: row.template_key,
    name: row.name,
    description: row.description,
    workflow_family: row.workflow_family,
    workflow_family_label: humanizeProductionWorkflowFamily(row.workflow_family),
    workflow_mode: row.workflow_mode,
    workflow_mode_label: humanizeProductionWorkflowMode(row.workflow_mode),
    season_key: row.season_key,
    season_label: humanizeProductionWorkflowSeason(row.season_key),
    default_priority: row.default_priority,
    job_type: row.job_type,
    job_type_label: humanizeProjectJobType(row.job_type),
    category: row.category,
    category_label: humanizeProjectCategory(row.category),
    default_stage: row.default_stage,
    default_stage_label: humanizeProjectStage(row.default_stage),
    peer_review_required: row.peer_review_required,
    final_qc_required: row.final_qc_required,
    task_count: row.task_count,
    tasks: tasksByTemplate.get(row.id) ?? []
  }));
}

export async function getProductionProjectReferenceData(
  client: PoolClient,
  auth: AuthUser,
  options: {
    linkedOrganizationId?: string | null;
    linkedLocationId?: string | null;
  } = {}
): Promise<ProductionProjectReferenceData> {
  const [owners, organizations, locations, shoots, triggerRules] = await Promise.all([
    client.query<{
      id: string;
      full_name: string | null;
      email: string;
      department: string | null;
    }>(
      `
        SELECT
          user_record.id,
          user_record.full_name,
          user_record.email,
          user_record.department
        FROM app_user user_record
        WHERE user_record.tenant_id = $1
          AND user_record.status = 'active'
        ORDER BY user_record.full_name ASC NULLS LAST, user_record.email ASC
        LIMIT 80
      `,
      [auth.tenantId]
    ),
    client.query<{
      id: string;
      display_name: string;
      account_type: string;
      active_status: string;
    }>(
      `
        SELECT
          organization.id,
          organization.display_name,
          organization.account_type::text AS account_type,
          organization.active_status::text AS active_status
        FROM organization
        WHERE organization.tenant_id = $1
          AND organization.active_status = 'active'
        ORDER BY (organization.id = $2::uuid) DESC, organization.display_name ASC
        LIMIT 120
      `,
      [auth.tenantId, options.linkedOrganizationId ?? null]
    ),
    client.query<{
      id: string;
      organization_id: string | null;
      organization_name: string | null;
      location_name: string;
      address_display: string | null;
      active_status: string;
    }>(
      `
        SELECT
          location.id,
          location.organization_id,
          organization.display_name AS organization_name,
          location.name AS location_name,
          NULLIF(
            concat_ws(', ', location.address_line_1, location.city, location.state),
            ''
          ) AS address_display,
          location.active_status::text AS active_status
        FROM shoot_location location
        LEFT JOIN organization
          ON organization.tenant_id = location.tenant_id
         AND organization.id = location.organization_id
        WHERE location.tenant_id = $1
          AND location.active_status = 'active'
          AND ($2::uuid IS NULL OR location.organization_id = $2::uuid)
        ORDER BY organization.display_name ASC NULLS LAST, location.name ASC
        LIMIT 160
      `,
      [auth.tenantId, options.linkedOrganizationId ?? null]
    ),
    client.query<{
      id: string;
      organization_id: string | null;
      organization_name: string | null;
      location_id: string | null;
      location_name: string | null;
      shoot_code: string | null;
      title: string;
      shoot_date: string;
    }>(
      `
        SELECT
          shoot.id,
          shoot.organization_id,
          organization.display_name AS organization_name,
          shoot.location_id,
          location.name AS location_name,
          shoot.shoot_code,
          shoot.title,
          shoot.shoot_date::text AS shoot_date
        FROM shoot
        LEFT JOIN organization
          ON organization.tenant_id = shoot.tenant_id
         AND organization.id = shoot.organization_id
        LEFT JOIN shoot_location location
          ON location.tenant_id = shoot.tenant_id
         AND location.id = shoot.location_id
        WHERE shoot.tenant_id = $1
          AND shoot.deleted_at IS NULL
          AND ($2::uuid IS NULL OR shoot.organization_id = $2::uuid)
          AND ($3::uuid IS NULL OR shoot.location_id = $3::uuid)
        ORDER BY shoot.shoot_date DESC, shoot.created_at DESC
        LIMIT 160
      `,
      [auth.tenantId, options.linkedOrganizationId ?? null, options.linkedLocationId ?? null]
    ),
    client.query<{ trigger_key: string; name: string }>(
      `
        SELECT trigger_key, name
        FROM production_project_trigger_rule
        WHERE tenant_id = $1
          AND active_status = true
        ORDER BY name ASC
      `,
      [auth.tenantId]
    )
  ]);

  return {
    generated_at: new Date().toISOString(),
    owners: owners.rows.map((row) => ({
      id: row.id,
      label: row.full_name || row.email,
      detail: row.department ? humanizeValue(row.department) : row.email
    })),
    organizations: organizations.rows.map((row) => ({
      id: row.id,
      label: row.display_name,
      detail: `${humanizeValue(row.account_type)} account`
    })),
    locations: locations.rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      organization_label: row.organization_name,
      label: row.location_name,
      detail: row.address_display || row.organization_name || null
    })),
    shoots: shoots.rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      organization_label: row.organization_name,
      location_id: row.location_id,
      location_label: row.location_name,
      shoot_code: row.shoot_code,
      label: row.shoot_code ? `${row.shoot_code} - ${row.title}` : row.title,
      detail: [row.organization_name, row.location_name, row.shoot_date ? formatDateLabel(row.shoot_date) : null].filter(Boolean).join(" | ")
    })),
    source_triggers: triggerRules.rows.map((row) => ({
      key: row.trigger_key,
      label: row.name
    }))
  };
}

export async function listProductionProjects(
  client: PoolClient,
  auth: AuthUser,
  options: ProjectListOptions,
  intake: ProductionProjectIntakeSummary | null = null
): Promise<ProductionProjectBoardResponse> {
  const workspaceView = options.workspaceView ?? resolveProductionWorkspaceView(auth);
  const leadBoardSort = options.leadBoardSort ?? "overdue_severity";
  const leadBoardFocus = options.leadBoardFocus ?? "all";
  const rows = await loadProjectRows(client, auth.tenantId, options);
  const summaryRows = rows
    .map((row) => toProjectSummaryRecord(row, options.anchorDate))
    .filter((project) => matchesPostQueryProjectFilters(project, options));
  const allUnfinishedRows = summaryRows.filter((project) => !isClosedProject(project.status));
  const unfinishedRows = allUnfinishedRows
    .filter((project) => matchesLeadBoardFocus(project, leadBoardFocus))
    .sort((left, right) => compareProjectLeadBoardOrder(left, right, options.anchorDate, leadBoardSort));
  const selectedQueue = options.queue ?? "all";
  const visibleRows = summaryRows.filter((project) => matchesQueueFilter(project, options.anchorDate, selectedQueue, auth.id));
  const sectionIds =
    selectedQueue === "all"
      ? (["blocked_queue", "qa_queue", "ready_to_release_queue", "at_risk_queue", "team_queue"] as const)
      : ([selectedQueue] as const);
  const sections: ProductionProjectBoardSection[] = sectionIds
    .map((sectionId) =>
      buildSection(
        sectionId,
        buildQueueLabel(sectionId),
        buildQueueSummary(sectionId),
        visibleRows,
        options.anchorDate,
        auth.id,
        workspaceView !== "lead_board"
      )
    )
    .filter((section) => section.count > 0 || shouldKeepEmptySection(section.id, selectedQueue));

  return {
    generated_at: new Date().toISOString(),
    anchor_date: options.anchorDate,
    default_workspace_view: resolveProductionWorkspaceView(auth),
    filters: {
      status: options.status ?? "open",
      queue: selectedQueue,
      workspace_view: workspaceView,
      search: options.search?.trim() ?? "",
      owner_user_id: options.ownerUserId ?? null,
      priority: options.priority ?? "all",
      template_id: options.templateId ?? null,
      source_type: options.sourceType ?? "all",
      source_trigger_key: options.sourceTriggerKey ?? null,
      category: options.category ?? "all",
      job_type: options.jobType ?? "all",
      stage: options.stage ?? "all",
      team_owner: options.teamOwner ?? "all",
      linked_organization_id: options.linkedOrganizationId ?? null,
      linked_location_id: options.linkedLocationId ?? null,
      linked_shoot_id: options.linkedShootId ?? null,
      due_state: options.dueState ?? "all",
      big_critical_only: Boolean(options.bigCriticalOnly),
      lead_board_sort: leadBoardSort,
      lead_board_focus: leadBoardFocus
    },
    summary: {
      total_visible: visibleRows.length,
      open_projects: summaryRows.filter((project) => !isClosedProject(project.status)).length,
      all_unfinished: unfinishedRows.length,
      my_queue: summaryRows.filter((project) => isMyQueueProject(project, auth.id)).length,
      team_queue: summaryRows.filter((project) => classifyProjectQueue(project, options.anchorDate, auth.id) === "team_queue").length,
      blocked_queue: summaryRows.filter((project) => classifyProjectQueue(project, options.anchorDate, auth.id) === "blocked_queue").length,
      qa_queue: summaryRows.filter((project) => classifyProjectQueue(project, options.anchorDate, auth.id) === "qa_queue").length,
      ready_to_release_queue: summaryRows.filter((project) => classifyProjectQueue(project, options.anchorDate, auth.id) === "ready_to_release_queue").length,
      at_risk_queue: summaryRows.filter((project) => classifyProjectQueue(project, options.anchorDate, auth.id) === "at_risk_queue").length,
      unassigned_jobs: summaryRows.filter((project) => !isClosedProject(project.status) && !project.owner_user_id).length,
      active_jobs: summaryRows.filter((project) => !isClosedProject(project.status)).length,
      on_time: summaryRows.filter((project) => isProjectOnTime(project, options.anchorDate)).length,
      blocked: summaryRows.filter((project) => isBlockedProject(project)).length,
      due_within_24_hours: summaryRows.filter((project) => project.due_within_24_hours).length,
      overdue: summaryRows.filter((project) => project.overdue).length,
      jobs_in_qa: summaryRows.filter((project) => isQaQueueProject(project)).length,
      ready_to_release: summaryRows.filter((project) => isReadyForRelease(project)).length,
      stale_active: summaryRows.filter((project) => !isClosedProject(project.status) && project.stale_active).length,
      corrections_needed: summaryRows.filter((project) => !isClosedProject(project.status) && project.corrections_needed).length,
      waiting_to_send: summaryRows.filter((project) => !isClosedProject(project.status) && project.waiting_to_send).length,
      ready_to_send: summaryRows.filter((project) => !isClosedProject(project.status) && project.ready_to_send).length,
      trigger_intake_waiting: summaryRows.filter(
        (project) =>
          !isClosedProject(project.status) &&
          project.source_type === "trigger" &&
          ["intake_pending", "ready_for_production"].includes(project.stage)
      ).length,
      needs_setup: summaryRows.filter((project) => !isClosedProject(project.status) && ["intake_pending", "ready_for_production"].includes(project.stage)).length,
      needs_follow_up: summaryRows.filter((project) => !isClosedProject(project.status) && Boolean(project.follow_up_date && project.follow_up_date <= options.anchorDate)).length,
      overdue_tasks: summaryRows.reduce((total, project) => total + project.overdue_task_count, 0),
      completed_recently: summaryRows.filter((project) => Boolean(project.completed_at)).length,
      in_production: summaryRows.filter((project) => !isClosedProject(project.status) && project.stage === "in_production").length,
      blocked_or_corrections: summaryRows.filter((project) => !isClosedProject(project.status) && (project.stage === "blocked" || project.stage === "correction_needed" || project.release_blocked)).length,
      blocked_or_changes_requested: summaryRows.filter((project) => !isClosedProject(project.status) && (project.stage === "blocked" || project.stage === "correction_needed" || project.release_blocked)).length,
      awaiting_peer_review: summaryRows.filter((project) => !isClosedProject(project.status) && project.pending_peer_review).length,
      awaiting_final_qc: summaryRows.filter((project) => !isClosedProject(project.status) && project.pending_final_qc).length,
      release_blockers: summaryRows.filter((project) => !isClosedProject(project.status) && project.release_blocked).length,
      jobs_needing_owner_reassignment: summaryRows.filter(
        (project) =>
          !isClosedProject(project.status) &&
          (!project.owner_user_id ||
            (project.pending_peer_review && !project.peer_reviewer_user_id) ||
            (project.pending_final_qc && !project.final_qc_reviewer_user_id))
      ).length
    },
    lead_board: {
      summary_line:
        unfinishedRows.length > 0
          ? leadBoardFocus === "all"
            ? `${unfinishedRows.length} unfinished production job${unfinishedRows.length === 1 ? "" : "s"} are still in flight.`
            : `Showing ${unfinishedRows.length} ${leadBoardFocus} production job${unfinishedRows.length === 1 ? "" : "s"} out of ${allUnfinishedRows.length} unfinished jobs.`
          : "No unfinished production jobs are open right now.",
      items: unfinishedRows
    },
    intake: intake ?? buildEmptyProductionIntakeSummary(),
    sections
  };
}

export async function getProductionProjectQaWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string }
): Promise<ProductionProjectQaWorkspace> {
  const rows = await loadProjectRows(client, auth.tenantId, {
    anchorDate: options.anchorDate,
    status: "all"
  });
  const projects = rows.map((row) => toProjectSummaryRecord(row, options.anchorDate));
  const openProjects = projects.filter((project) => !isClosedProject(project.status));
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const exceptionResult = await client.query<{ project_id: string }>(
    `
      SELECT DISTINCT project_id::text AS project_id
      FROM production_project_exception
      WHERE tenant_id = $1
        AND blocking = true
        AND status = 'open'
    `,
    [auth.tenantId]
  );
  const exceptionProjectIds = new Set(exceptionResult.rows.map((row) => row.project_id));

  const reviewResult = await client.query<ProjectReviewRow>(
    `
      SELECT
        review.id,
        review.review_stage::text AS review_stage,
        review.reviewer_user_id,
        reviewer.full_name AS reviewer_name,
        review.result::text AS result,
        review.correction_reason,
        review.note,
        review.qa_checks,
        review.qa_checklist_complete,
        review.reassigned_owner_user_id,
        reassigned_owner.full_name AS reassigned_owner_name,
        review.created_at::text AS created_at,
        review.project_id::text AS project_id
      FROM production_project_review review
      LEFT JOIN app_user reviewer
        ON reviewer.id = review.reviewer_user_id
      LEFT JOIN app_user reassigned_owner
        ON reassigned_owner.id = review.reassigned_owner_user_id
      WHERE review.tenant_id = $1
        AND review.result IN ('passed', 'correction_needed', 'blocked')
        AND review.created_at >= (now() - interval '14 days')
      ORDER BY review.created_at DESC, review.id DESC
      LIMIT 14
    `,
    [auth.tenantId]
  );

  const recentReviews: ProductionProjectQaWorkspaceReview[] = reviewResult.rows
    .map((review) => {
      const project = projectMap.get((review as ProjectReviewRow & { project_id: string }).project_id ?? "");
      if (!project) {
        return null;
      }
      return {
        project,
        review: {
          id: review.id,
          review_stage: review.review_stage,
          review_stage_label: humanizeProjectStage(review.review_stage),
          reviewer_user_id: review.reviewer_user_id,
          reviewer_label: review.reviewer_name ?? null,
          result: review.result,
          result_label: humanizeProjectReviewResult(review.result),
          correction_reason: review.correction_reason,
          note: review.note,
          qa_checks: review.qa_checks ?? null,
          qa_checklist_complete: review.qa_checklist_complete,
          reassigned_owner_user_id: review.reassigned_owner_user_id,
          reassigned_owner_label: review.reassigned_owner_name ?? null,
          created_at: review.created_at
        }
      };
    })
    .filter((entry): entry is ProductionProjectQaWorkspaceReview => entry !== null);

  return {
    generated_at: new Date().toISOString(),
    anchor_date: options.anchorDate,
    qa_hold: openProjects.filter((project) => project.stage === "qa_hold"),
    ready_for_qa: openProjects.filter((project) => project.stage === "ready_for_qa"),
    blocked_by_exceptions: openProjects.filter((project) => exceptionProjectIds.has(project.id)),
    ready_for_release: openProjects.filter((project) => isReadyForRelease(project)),
    recent_reviews: recentReviews
  };
}

export async function getProductionProjectAnalytics(
  client: PoolClient,
  auth: AuthUser,
  input?: { windowDays?: number }
): Promise<ProductionProjectAnalytics> {
  const windowDays = Math.min(Math.max(input?.windowDays ?? 90, 7), 365);
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
  const windowStartIso = windowStart.toISOString();
  const windowStartLabel = windowStartIso.slice(0, 10);
  const windowEndLabel = getLocalDateString();

  const [
    qaIssuesByJobType,
    qaIssuesByAccount,
    qaIssuesByLocation,
    qaIssuesByPhotographer,
    exceptionTypes,
    issueTags,
    buddyLoad,
    vtLoad,
    releaseDelays
  ] = await Promise.all([
    client.query<{ key: string; count: number }>(
      `
        WITH qa_events AS (
          SELECT id, project_id
          FROM production_project_exception
          WHERE tenant_id = $1
            AND created_at >= $2
          UNION ALL
          SELECT id, project_id
          FROM production_project_review
          WHERE tenant_id = $1
            AND created_at >= $2
            AND result IN ('correction_needed', 'blocked')
        )
        SELECT project.job_type::text AS key, COUNT(DISTINCT qa_events.id)::int AS count
        FROM qa_events
        JOIN production_project project
          ON project.tenant_id = $1
         AND project.id = qa_events.project_id
        GROUP BY project.job_type
        ORDER BY COUNT(DISTINCT qa_events.id) DESC
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ key: string | null; label: string | null; count: number }>(
      `
        WITH qa_events AS (
          SELECT id, project_id
          FROM production_project_exception
          WHERE tenant_id = $1
            AND created_at >= $2
          UNION ALL
          SELECT id, project_id
          FROM production_project_review
          WHERE tenant_id = $1
            AND created_at >= $2
            AND result IN ('correction_needed', 'blocked')
        )
        SELECT org.id::text AS key, org.display_name AS label, COUNT(DISTINCT qa_events.id)::int AS count
        FROM qa_events
        JOIN production_project project
          ON project.tenant_id = $1
         AND project.id = qa_events.project_id
        LEFT JOIN organization org
          ON org.id = project.linked_organization_id
        GROUP BY org.id, org.display_name
        ORDER BY COUNT(DISTINCT qa_events.id) DESC
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ key: string | null; label: string | null; count: number }>(
      `
        WITH qa_events AS (
          SELECT id, project_id
          FROM production_project_exception
          WHERE tenant_id = $1
            AND created_at >= $2
          UNION ALL
          SELECT id, project_id
          FROM production_project_review
          WHERE tenant_id = $1
            AND created_at >= $2
            AND result IN ('correction_needed', 'blocked')
        )
        SELECT location.id::text AS key, location.name AS label, COUNT(DISTINCT qa_events.id)::int AS count
        FROM qa_events
        JOIN production_project project
          ON project.tenant_id = $1
         AND project.id = qa_events.project_id
        LEFT JOIN shoot_location location
          ON location.id = project.linked_location_id
        GROUP BY location.id, location.name
        ORDER BY COUNT(DISTINCT qa_events.id) DESC
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ key: string | null; label: string | null; count: number }>(
      `
        WITH qa_events AS (
          SELECT id, project_id
          FROM production_project_exception
          WHERE tenant_id = $1
            AND created_at >= $2
          UNION ALL
          SELECT id, project_id
          FROM production_project_review
          WHERE tenant_id = $1
            AND created_at >= $2
            AND result IN ('correction_needed', 'blocked')
        ),
        lead_photographer AS (
          SELECT DISTINCT ON (shoot_id)
            shoot_id,
            assigned_user_id
          FROM work_shift
          WHERE tenant_id = $1
            AND shift_kind = 'shoot'
            AND satisfies_lead_coverage = true
          ORDER BY shoot_id, starts_at DESC
        )
        SELECT photographer.id::text AS key, photographer.full_name AS label, COUNT(DISTINCT qa_events.id)::int AS count
        FROM qa_events
        JOIN production_project project
          ON project.tenant_id = $1
         AND project.id = qa_events.project_id
        LEFT JOIN lead_photographer lead
          ON lead.shoot_id = project.linked_shoot_id
        LEFT JOIN app_user photographer
          ON photographer.id = lead.assigned_user_id
        GROUP BY photographer.id, photographer.full_name
        ORDER BY COUNT(DISTINCT qa_events.id) DESC
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ key: string; count: number }>(
      `
        SELECT exception_type::text AS key, COUNT(*)::int AS count
        FROM production_project_exception
        WHERE tenant_id = $1
          AND created_at >= $2
        GROUP BY exception_type
        ORDER BY COUNT(*) DESC
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ key: string; count: number }>(
      `
        SELECT issue_tag AS key, COUNT(*)::int AS count
        FROM production_project_exception
        WHERE tenant_id = $1
          AND created_at >= $2
          AND issue_tag IS NOT NULL
          AND issue_tag <> ''
        GROUP BY issue_tag
        ORDER BY COUNT(*) DESC
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ total: number; duplicate_handling_required: number; unresolved_groups: number }>(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE duplicate_handling_required)::int AS duplicate_handling_required,
          COUNT(*) FILTER (WHERE unresolved_group_count > 0)::int AS unresolved_groups
        FROM production_project_buddy_workflow
        WHERE tenant_id = $1
          AND created_at >= $2
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ total: number; ambiguous_matches: number }>(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ambiguous_match_required)::int AS ambiguous_matches
        FROM production_project_virtual_team_workflow
        WHERE tenant_id = $1
          AND created_at >= $2
      `,
      [auth.tenantId, windowStartIso]
    ),
    client.query<{ stage: ProductionProjectStage; count: number; avg_days_in_stage: number; oldest_days_in_stage: number }>(
      `
        SELECT
          stage::text AS stage,
          COUNT(*)::int AS count,
          COALESCE(AVG(DATE_PART('day', now() - updated_at)), 0)::int AS avg_days_in_stage,
          COALESCE(MAX(DATE_PART('day', now() - updated_at)), 0)::int AS oldest_days_in_stage
        FROM production_project
        WHERE tenant_id = $1
          AND status <> 'completed'
          AND stage IN ('qa_hold', 'correction_needed', 'blocked', 'ready_to_release')
        GROUP BY stage
        ORDER BY COUNT(*) DESC
      `,
      [auth.tenantId]
    )
  ]);

  const mapRows = (rows: Array<{ key: string | null; label?: string | null; count: number }>, labelFallback: string) =>
    rows.map((row) => ({
      key: row.key ?? "unlinked",
      label: row.label ?? labelFallback,
      count: row.count
    }));

  return {
    generated_at: new Date().toISOString(),
    window_start: windowStartLabel,
    window_end: windowEndLabel,
    qa_issues_by_photographer: mapRows(qaIssuesByPhotographer.rows, "Unassigned photographer"),
    qa_issues_by_job_type: qaIssuesByJobType.rows.map((row) => ({
      key: row.key,
      label: humanizeProjectJobType(row.key as ProductionProjectJobType),
      count: row.count
    })),
    qa_issues_by_account: mapRows(qaIssuesByAccount.rows, "Unlinked account"),
    qa_issues_by_location: mapRows(qaIssuesByLocation.rows, "Unlinked location"),
    exception_type_frequency: exceptionTypes.rows.map((row) => ({
      key: row.key,
      label: humanizeProductionExceptionType(row.key as ProjectExceptionRow["exception_type"]),
      count: row.count
    })),
    recurring_issue_tags: issueTags.rows.map((row) => ({
      key: row.key,
      label: row.key,
      count: row.count
    })),
    buddy_workload: {
      total: buddyLoad.rows[0]?.total ?? 0,
      duplicate_handling_required: buddyLoad.rows[0]?.duplicate_handling_required ?? 0,
      unresolved_groups: buddyLoad.rows[0]?.unresolved_groups ?? 0
    },
    virtual_team_workload: {
      total: vtLoad.rows[0]?.total ?? 0,
      ambiguous_matches: vtLoad.rows[0]?.ambiguous_matches ?? 0
    },
    release_delay_stages: releaseDelays.rows.map((row) => ({
      stage: row.stage,
      stage_label: humanizeProjectStage(row.stage),
      count: row.count,
      avg_days_in_stage: row.avg_days_in_stage,
      oldest_days_in_stage: row.oldest_days_in_stage
    }))
  };
}

const QA_CHECK_DEFINITIONS: Array<{ key: ProductionProjectQaCheckKey; label: string }> = [
  { key: "count_reconciliation", label: "Count reconciliation complete" },
  { key: "blocking_exceptions", label: "No blocking exceptions" },
  { key: "buddy_workflow", label: "Buddy workflow complete" },
  { key: "virtual_team", label: "Virtual team validation complete" },
  { key: "asset_validation", label: "Presets/assets validated" },
  { key: "final_review_notes", label: "Final review notes captured" }
];

function normalizeQaChecks(input: ProductionProjectQaCheckRecord[]): ProductionProjectQaCheckRecord[] {
  const provided = new Map(input.map((item) => [item.key, item]));
  return QA_CHECK_DEFINITIONS.map((definition) => {
    const existing = provided.get(definition.key);
    return {
      key: definition.key,
      label: definition.label,
      status: existing?.status ?? "needs_review",
      notes: existing?.notes ?? null
    };
  });
}

function isQaChecklistComplete(checks: ProductionProjectQaCheckRecord[]) {
  return checks.every((check) => check.status === "pass" || check.status === "not_applicable");
}

function buildEmptyProductionIntakeSummary(): ProductionProjectIntakeSummary {
  return {
    generated_at: new Date().toISOString(),
    summary_line: "Production intake is relying on canonical upstream sources with no active funnel issues surfaced in this snapshot.",
    counts: {
      sources_considered: 0,
      created: 0,
      linked: 0,
      duplicates: 0,
      conflicts: 0,
      sync_failures: 0,
      stale_syncs: 0
    },
    issues: []
  };
}

export async function getProductionProjectHomeSnapshot(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string; tvSafe?: boolean }
): Promise<ProductionProjectHomeSnapshot> {
  const rows = await loadProjectRows(client, auth.tenantId, {
    anchorDate: options.anchorDate,
    status: "open"
  });
  const projects = rows.map((row) => toProjectSummaryRecord(row, options.anchorDate));
  const counts = {
    unassigned_jobs: projects.filter((project) => !project.owner_user_id).length,
    active_jobs: projects.filter((project) => !isClosedProject(project.status)).length,
    on_time: projects.filter((project) => isProjectOnTime(project, options.anchorDate)).length,
    overdue: projects.filter((project) => isProjectOverdue(project, options.anchorDate)).length,
    blocked: projects.filter((project) => isBlockedProject(project)).length,
    due_within_24_hours: projects.filter((project) => project.due_within_24_hours).length,
    jobs_in_qa: projects.filter((project) => isQaQueueProject(project)).length,
    ready_to_release: projects.filter((project) => isReadyForRelease(project)).length,
    peer_review_lag: projects.filter((project) => isPeerReviewLagProject(project, options.anchorDate)).length,
    final_qc_lag: projects.filter((project) => isFinalQcLagProject(project, options.anchorDate)).length,
    release_blockers: projects.filter((project) => isReleaseBlockerProject(project, options.anchorDate)).length,
    stale_active: projects.filter((project) => !isClosedProject(project.status) && project.stale_active).length,
    attention_needed: projects.filter((project) => isHomeAttentionProject(project, options.anchorDate)).length
  };

  const ownerBuckets = new Map<
    string,
    {
      owner_user_id: string | null;
      owner_label: string;
      assignment_label: string;
      open_count: number;
      in_production_count: number;
      qa_queue_count: number;
      ready_to_release_count: number;
      overdue_count: number;
    }
  >();

  for (const project of projects) {
    const key = project.owner_user_id ?? "unassigned";
    const existing = ownerBuckets.get(key) ?? {
      owner_user_id: project.owner_user_id,
      owner_label: options.tvSafe ? (project.owner_user_id ? "Assigned owner" : "Unassigned") : project.owner_label,
      assignment_label: project.owner_user_id ? "Assigned" : "Needs owner",
      open_count: 0,
      in_production_count: 0,
      qa_queue_count: 0,
      ready_to_release_count: 0,
      overdue_count: 0,
      pressure_label: "",
      action_hash: "#production"
    };
    existing.open_count += 1;
    if (isInProductionProject(project)) {
      existing.in_production_count += 1;
    }
    if (isQaQueueProject(project)) {
      existing.qa_queue_count += 1;
    }
    if (project.stage === "ready_to_release") {
      existing.ready_to_release_count += 1;
    }
    if (isProjectOverdue(project, options.anchorDate)) {
      existing.overdue_count += 1;
    }
    ownerBuckets.set(key, existing);
  }

  const owners = [...ownerBuckets.values()]
    .map((owner) => ({
      ...owner,
      pressure_label: buildOwnerPressureLabel(owner),
      action_hash: buildOwnerActionHash(owner)
    }))
    .sort((left, right) => {
      if (right.overdue_count !== left.overdue_count) {
        return right.overdue_count - left.overdue_count;
      }
      if (right.open_count !== left.open_count) {
        return right.open_count - left.open_count;
      }
      return left.owner_label.localeCompare(right.owner_label);
    })
    .slice(0, options.tvSafe ? 0 : 6);

  const urgentItems = options.tvSafe
    ? []
    : projects
        .map((project) => toProjectUrgentHomeItem(project, options.anchorDate))
        .filter((item): item is ProductionProjectHomeSnapshot["urgent_items"][number] => item !== null)
        .sort(compareProjectHomeUrgency)
        .slice(0, 3);

  const focusItems = options.tvSafe
    ? []
    : projects
        .map((project) => toProjectFocusHomeItem(project, options.anchorDate))
        .filter((item): item is ProductionProjectHomeSnapshot["focus_items"][number] => item !== null)
        .sort(compareProjectFocusItems)
        .slice(0, 4);

  return {
    generated_at: new Date().toISOString(),
    anchor_date: options.anchorDate,
    summary_line: buildHomeSnapshotSummaryLine(counts),
    tone: deriveHomeSnapshotTone(counts),
    counts,
    assessment_cards: buildHomeAssessmentCards(counts),
    owners,
    focus_items: focusItems,
    urgent_items: urgentItems
  };
}

export async function listProductionUrgentWatchFacts(
  client: PoolClient,
  tenantId: string,
  anchorDate: string
): Promise<ProductionUrgentWatchFact[]> {
  const rows = await loadProjectRows(client, tenantId, {
    anchorDate,
    status: "open"
  });
  const projects = rows.map((row) => toProjectSummaryRecord(row, anchorDate));
  const gateCandidates = projects.filter(
    (project) =>
      project.stage === "blocked" ||
      project.overdue ||
      project.due_within_24_hours ||
      project.peer_review_required ||
      project.final_qc_required ||
      project.release_blocked ||
      project.stale_active
  );
  const gates: Array<{ projectId: string; gate: ProductionProjectWorkflowGate }> = [];
  for (const project of gateCandidates) {
    gates.push({
      projectId: project.id,
      gate: await loadProductionProjectWorkflowGate(client, tenantId, project.id, {
        includeReleaseTasksAsOpen: true
      })
    });
  }
  const gateMap = new Map(gates.map((entry) => [entry.projectId, entry.gate]));

  return projects.map<ProductionUrgentWatchFact>((project) => {
    const gate = gateMap.get(project.id) ?? {
      openRequiredTaskCount: 0,
      blockedTaskCount: 0,
      overdueTaskCount: 0,
      pendingPeerReview: false,
      pendingFinalQc: false,
      pendingReleaseTasks: 0,
      blockedReasons: []
    };
    return {
      project,
      action_hash: buildProjectHash({
        projectId: project.id,
        queue: classifyProjectQueue(project, anchorDate, null),
        stage: project.stage,
        dueState: resolveProjectDueState(project, anchorDate)
      }),
      due_at: buildProductionUrgentDueAt(project.follow_up_date ?? project.due_date),
      workflow_gate: {
        blocked_task_count: gate.blockedTaskCount,
        overdue_task_count: gate.overdueTaskCount,
        blocked_reasons: gate.blockedReasons
      }
    };
  });
}

export async function getProductionProjectDetail(
  client: PoolClient,
  auth: AuthUser,
  projectId: string
): Promise<ProductionProjectDetail> {
  const row = await loadProjectRowById(client, auth.tenantId, projectId);
  if (!row) {
    throw new ApiError(404, "Production project not found");
  }

  const taskResult = await client.query<ProjectTaskRow>(
      `
        SELECT
          task.id,
          task.template_task_id,
          template_task.task_key,
          task.title,
          task.summary,
          task.status::text AS status,
          task.task_type::text AS task_type,
          task.owner_user_id,
          owner.full_name AS owner_name,
          task.due_date::text AS due_date,
          task.latest_note,
          task.required,
          task.sort_order,
          task.handoff_required,
          task.blocks_release,
          task.started_at::text AS started_at,
          task.completed_at::text AS completed_at,
          task.last_handoff_at::text AS last_handoff_at,
          task.last_handoff_to_user_id,
          handoff_owner.full_name AS last_handoff_to_name,
          COALESCE(dependency_summary.dependency_count, 0)::int AS dependency_count,
          COALESCE(dependency_summary.unresolved_dependency_count, 0)::int AS unresolved_dependency_count,
          dependency_summary.blocking_dependency_titles,
          dependency_summary.blocking_dependency_statuses,
          dependency_summary.blocking_dependency_ids,
          COALESCE(dependent_summary.dependent_task_count, 0)::int AS dependent_task_count
        FROM production_project_task task
        LEFT JOIN production_project_template_task template_task
          ON template_task.tenant_id = task.tenant_id
         AND template_task.id = task.template_task_id
        LEFT JOIN app_user owner
          ON owner.id = task.owner_user_id
        LEFT JOIN app_user handoff_owner
          ON handoff_owner.id = task.last_handoff_to_user_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS dependency_count,
            COUNT(*) FILTER (WHERE predecessor.status NOT IN ('done', 'skipped'))::int AS unresolved_dependency_count,
            ARRAY_AGG(predecessor.title ORDER BY predecessor.sort_order ASC, predecessor.created_at ASC)
              FILTER (WHERE predecessor.status NOT IN ('done', 'skipped')) AS blocking_dependency_titles,
            ARRAY_AGG(predecessor.status::text ORDER BY predecessor.sort_order ASC, predecessor.created_at ASC)
              FILTER (WHERE predecessor.status NOT IN ('done', 'skipped')) AS blocking_dependency_statuses,
            ARRAY_AGG(predecessor.id::text ORDER BY predecessor.sort_order ASC, predecessor.created_at ASC)
              FILTER (WHERE predecessor.status NOT IN ('done', 'skipped')) AS blocking_dependency_ids
          FROM production_project_task_dependency dependency
          JOIN production_project_task predecessor
            ON predecessor.tenant_id = dependency.tenant_id
           AND predecessor.id = dependency.depends_on_task_id
          WHERE dependency.tenant_id = task.tenant_id
            AND dependency.project_id = task.project_id
            AND dependency.task_id = task.id
        ) dependency_summary ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS dependent_task_count
          FROM production_project_task_dependency dependency
          WHERE dependency.tenant_id = task.tenant_id
            AND dependency.project_id = task.project_id
            AND dependency.depends_on_task_id = task.id
        ) dependent_summary ON true
        WHERE task.tenant_id = $1
          AND task.project_id = $2
        ORDER BY task.sort_order ASC, task.created_at ASC
      `,
      [auth.tenantId, projectId]
    );
  const eventResult = await client.query<ProjectEventRow>(
      `
        SELECT
          event.id,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.created_at::text AS created_at,
          event.metadata
        FROM production_project_event event
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND event.project_id = $2
        ORDER BY event.created_at DESC, event.id DESC
      `,
      [auth.tenantId, projectId]
    );
  const reviewResult = await client.query<ProjectReviewRow>(
      `
        SELECT
          review.id,
          review.review_stage::text AS review_stage,
          review.reviewer_user_id,
          reviewer.full_name AS reviewer_name,
          review.result::text AS result,
          review.correction_reason,
          review.note,
          review.qa_checks,
          review.qa_checklist_complete,
          review.reassigned_owner_user_id,
          reassigned_owner.full_name AS reassigned_owner_name,
          review.created_at::text AS created_at
        FROM production_project_review review
        LEFT JOIN app_user reviewer
          ON reviewer.id = review.reviewer_user_id
        LEFT JOIN app_user reassigned_owner
          ON reassigned_owner.id = review.reassigned_owner_user_id
        WHERE review.tenant_id = $1
          AND review.project_id = $2
        ORDER BY review.created_at DESC, review.id DESC
      `,
      [auth.tenantId, projectId]
    );
  const taskHandoffResult = await client.query<ProjectTaskHandoffRow>(
      `
        SELECT
          handoff.id,
          handoff.task_id,
          task.title AS task_title,
          handoff.from_user_id,
          from_user.full_name AS from_user_name,
          handoff.to_user_id,
          to_user.full_name AS to_user_name,
          handoff.note,
          handoff.created_by_user_id,
          created_by.full_name AS created_by_name,
          handoff.created_at::text AS created_at
        FROM production_project_task_handoff handoff
        JOIN production_project_task task
          ON task.tenant_id = handoff.tenant_id
         AND task.id = handoff.task_id
        LEFT JOIN app_user from_user
          ON from_user.id = handoff.from_user_id
        LEFT JOIN app_user to_user
          ON to_user.id = handoff.to_user_id
        LEFT JOIN app_user created_by
          ON created_by.id = handoff.created_by_user_id
        WHERE handoff.tenant_id = $1
          AND handoff.project_id = $2
        ORDER BY handoff.created_at DESC, handoff.id DESC
      `,
      [auth.tenantId, projectId]
    );
  const taskEventResult = await client.query<ProjectTaskEventRow>(
      `
        SELECT
          event.id,
          event.task_id,
          task.title AS task_title,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.created_at::text AS created_at,
          event.metadata
        FROM production_project_task_event event
        JOIN production_project_task task
          ON task.tenant_id = event.tenant_id
         AND task.id = event.task_id
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND event.project_id = $2
        ORDER BY event.created_at DESC, event.id DESC
      `,
      [auth.tenantId, projectId]
    );
  const approvalSummary = await listOperationalApprovalSourceSummary(client, auth, {
    sourceModule: "production",
    sourceEntityType: "production_project",
    sourceEntityId: projectId
  });
  const buddyWorkflowResult = await client.query<BuddyWorkflowRow>(
      `
        SELECT
          workflow.id,
          workflow.status::text AS status,
          workflow.owner_user_id,
          owner.full_name AS owner_name,
          workflow.duplicate_handling_required,
          workflow.cleanup_completed_at::text AS cleanup_completed_at,
          workflow.cleanup_completed_by_user_id,
          completed_by.full_name AS cleanup_completed_by_name,
          workflow.unresolved_group_count,
          workflow.notes,
          workflow.created_at::text AS created_at,
          workflow.updated_at::text AS updated_at
        FROM production_project_buddy_workflow workflow
        LEFT JOIN app_user owner
          ON owner.id = workflow.owner_user_id
        LEFT JOIN app_user completed_by
          ON completed_by.id = workflow.cleanup_completed_by_user_id
        WHERE workflow.tenant_id = $1
          AND workflow.project_id = $2
        LIMIT 1
      `,
      [auth.tenantId, projectId]
    );
  const virtualTeamWorkflowResult = await client.query<VirtualTeamWorkflowRow>(
      `
        SELECT
          workflow.id,
          workflow.status::text AS status,
          workflow.owner_user_id,
          owner.full_name AS owner_name,
          workflow.attributes_validated,
          workflow.coach_tags_validated,
          workflow.split_by_group_validated,
          workflow.ambiguous_match_required,
          workflow.ambiguous_match_resolved_at::text AS ambiguous_match_resolved_at,
          workflow.completed_at::text AS completed_at,
          workflow.completed_by_user_id,
          completed_by.full_name AS completed_by_name,
          workflow.notes,
          workflow.created_at::text AS created_at,
          workflow.updated_at::text AS updated_at
        FROM production_project_virtual_team_workflow workflow
        LEFT JOIN app_user owner
          ON owner.id = workflow.owner_user_id
        LEFT JOIN app_user completed_by
          ON completed_by.id = workflow.completed_by_user_id
        WHERE workflow.tenant_id = $1
          AND workflow.project_id = $2
        LIMIT 1
      `,
      [auth.tenantId, projectId]
    );
  const exceptionResult = await client.query<ProjectExceptionRow>(
      `
        SELECT
          exception.id,
          exception.lane_type::text AS lane_type,
          exception.exception_type::text AS exception_type,
          exception.severity::text AS severity,
          exception.blocking,
          exception.status::text AS status,
          exception.assignee_user_id,
          assignee.full_name AS assignee_name,
          exception.notes,
          exception.resolution_notes,
          exception.issue_tag,
          exception.follow_up_type::text AS follow_up_type,
          exception.follow_up_status::text AS follow_up_status,
          exception.follow_up_owner_user_id,
          follow_up_owner.full_name AS follow_up_owner_name,
          exception.follow_up_notes,
          exception.created_by_user_id,
          created_by.full_name AS created_by_name,
          exception.resolved_by_user_id,
          resolved_by.full_name AS resolved_by_name,
          exception.created_at::text AS created_at,
          exception.resolved_at::text AS resolved_at
        FROM production_project_exception exception
        LEFT JOIN app_user assignee
          ON assignee.id = exception.assignee_user_id
        LEFT JOIN app_user follow_up_owner
          ON follow_up_owner.id = exception.follow_up_owner_user_id
        LEFT JOIN app_user created_by
          ON created_by.id = exception.created_by_user_id
        LEFT JOIN app_user resolved_by
          ON resolved_by.id = exception.resolved_by_user_id
        WHERE exception.tenant_id = $1
          AND exception.project_id = $2
        ORDER BY exception.created_at DESC
      `,
      [auth.tenantId, projectId]
    );

  const taskRecords = taskResult.rows.map((task) => toProductionProjectTaskRecord(task));
  const workflowSummary = buildProductionProjectWorkflowSummary(taskRecords, row);
  const buddyWorkflow = buddyWorkflowResult.rows[0] ?? null;
  const virtualTeamWorkflow = virtualTeamWorkflowResult.rows[0] ?? null;

  return {
    project: toProjectSummaryRecord(row, getLocalDateString()),
    tasks: taskRecords,
  reviews: reviewResult.rows.map((review) => ({
      id: review.id,
      review_stage: review.review_stage,
      review_stage_label: humanizeProjectStage(review.review_stage),
      reviewer_user_id: review.reviewer_user_id,
      reviewer_label: review.reviewer_name ?? null,
      result: review.result,
      result_label: humanizeProjectReviewResult(review.result),
      correction_reason: review.correction_reason,
      note: review.note,
      qa_checks: review.qa_checks ?? null,
      qa_checklist_complete: review.qa_checklist_complete,
      reassigned_owner_user_id: review.reassigned_owner_user_id,
      reassigned_owner_label: review.reassigned_owner_name ?? null,
      created_at: review.created_at
    })),
    events: eventResult.rows.map((event): ProductionProjectEventRecord => ({
      id: event.id,
      event_type: event.event_type,
      summary: event.summary,
      note: event.note,
      actor_user_id: event.actor_user_id,
      actor_name: event.actor_name ?? null,
      created_at: event.created_at,
      metadata: event.metadata ?? {}
    })),
    task_handoffs: taskHandoffResult.rows.map((handoff) => ({
      id: handoff.id,
      task_id: handoff.task_id,
      task_title: handoff.task_title,
      from_user_id: handoff.from_user_id,
      from_user_label: handoff.from_user_name ?? null,
      to_user_id: handoff.to_user_id,
      to_user_label: handoff.to_user_name ?? null,
      note: handoff.note,
      created_by_user_id: handoff.created_by_user_id,
      created_by_label: handoff.created_by_name ?? null,
      created_at: handoff.created_at
    })),
    task_events: taskEventResult.rows.map((event) => ({
      id: event.id,
      task_id: event.task_id,
      task_title: event.task_title,
      event_type: event.event_type,
      summary: event.summary,
      note: event.note,
      actor_user_id: event.actor_user_id,
      actor_name: event.actor_name ?? null,
      created_at: event.created_at,
      metadata: event.metadata ?? {}
    })),
    workflow_summary: workflowSummary,
    approval_summary: approvalSummary,
    buddy_workflow: buddyWorkflow
      ? {
          id: buddyWorkflow.id,
          status: buddyWorkflow.status,
          owner_user_id: buddyWorkflow.owner_user_id,
          owner_label: buddyWorkflow.owner_name ?? null,
          duplicate_handling_required: buddyWorkflow.duplicate_handling_required,
          cleanup_completed_at: buddyWorkflow.cleanup_completed_at,
          cleanup_completed_by_user_id: buddyWorkflow.cleanup_completed_by_user_id,
          cleanup_completed_by_label: buddyWorkflow.cleanup_completed_by_name ?? null,
          unresolved_group_count: buddyWorkflow.unresolved_group_count,
          notes: buddyWorkflow.notes,
          created_at: buddyWorkflow.created_at,
          updated_at: buddyWorkflow.updated_at
        }
      : null,
    virtual_team_workflow: virtualTeamWorkflow
      ? {
          id: virtualTeamWorkflow.id,
          status: virtualTeamWorkflow.status,
          owner_user_id: virtualTeamWorkflow.owner_user_id,
          owner_label: virtualTeamWorkflow.owner_name ?? null,
          attributes_validated: virtualTeamWorkflow.attributes_validated,
          coach_tags_validated: virtualTeamWorkflow.coach_tags_validated,
          split_by_group_validated: virtualTeamWorkflow.split_by_group_validated,
          ambiguous_match_required: virtualTeamWorkflow.ambiguous_match_required,
          ambiguous_match_resolved_at: virtualTeamWorkflow.ambiguous_match_resolved_at,
          completed_at: virtualTeamWorkflow.completed_at,
          completed_by_user_id: virtualTeamWorkflow.completed_by_user_id,
          completed_by_label: virtualTeamWorkflow.completed_by_name ?? null,
          notes: virtualTeamWorkflow.notes,
          created_at: virtualTeamWorkflow.created_at,
          updated_at: virtualTeamWorkflow.updated_at
        }
      : null,
    exceptions: exceptionResult.rows.map((exception) => ({
      id: exception.id,
      lane_type: exception.lane_type,
      exception_type: exception.exception_type,
      exception_type_label: humanizeProductionExceptionType(exception.exception_type),
      severity: exception.severity,
      severity_label: humanizeProductionExceptionSeverity(exception.severity),
      blocking: exception.blocking,
      status: exception.status,
      status_label: humanizeProductionExceptionStatus(exception.status),
      assignee_user_id: exception.assignee_user_id,
      assignee_label: exception.assignee_name ?? null,
      notes: exception.notes,
      resolution_notes: exception.resolution_notes,
      issue_tag: exception.issue_tag ?? null,
      follow_up_type: exception.follow_up_type ?? null,
      follow_up_status: exception.follow_up_status ?? null,
      follow_up_owner_user_id: exception.follow_up_owner_user_id ?? null,
      follow_up_owner_label: exception.follow_up_owner_name ?? null,
      follow_up_notes: exception.follow_up_notes ?? null,
      created_by_user_id: exception.created_by_user_id,
      created_by_label: exception.created_by_name ?? null,
      resolved_by_user_id: exception.resolved_by_user_id,
      resolved_by_label: exception.resolved_by_name ?? null,
      created_at: exception.created_at,
      resolved_at: exception.resolved_at
    }))
  };
}

export async function createProductionProject(
  client: PoolClient,
  auth: AuthUser,
  input: CreateProductionProjectInput
): Promise<ProductionProjectDetail> {
  const template = input.templateId ? await loadTemplateById(client, auth.tenantId, input.templateId) : null;
  const resolvedCategory = input.category ?? template?.category ?? "production_follow_up";
  const resolvedJobType =
    input.jobType ??
    template?.job_type ??
    (resolvedCategory === "remediation"
      ? "correction_rework"
      : resolvedCategory === "qa_peer_review"
        ? "qa_final_review"
        : resolvedCategory === "digital_production"
          ? "gallery_prep_upload"
          : "standard_school_production");
  const resolvedStage =
    input.stage ??
    template?.default_stage ??
    deriveDefaultStageForJobType(resolvedJobType, input.status ?? "new");
  const reviewDefaults = deriveReviewRequirements(resolvedCategory, template ?? null);
  const linkedContext = await resolveLinkedContext(client, auth.tenantId, {
    linkedOrganizationId: input.linkedOrganizationId ?? null,
    linkedLocationId: input.linkedLocationId ?? null,
    linkedShootId: input.linkedShootId ?? null
  });
  const projectInsert = await client.query<{ id: string }>(
    `
      INSERT INTO production_project (
        tenant_id,
        template_id,
        source_type,
        created_reason,
        title,
        summary,
        status,
        job_type,
        category,
        stage,
        priority,
        owner_user_id,
        peer_review_required,
        final_qc_required,
        peer_reviewer_user_id,
        final_qc_reviewer_user_id,
        due_date,
        follow_up_date,
        latest_note,
        linked_organization_id,
        linked_location_id,
        linked_shoot_id,
        created_by_user_id,
        updated_by_user_id,
        completed_at,
        completed_by_user_id
      )
      VALUES (
        $1,$2::uuid,'manual',$3,$4,$5,$6::production_project_status,$7::production_project_job_type,$8::production_project_category,$9::production_project_stage,$10::production_project_priority,$11::uuid,$12,$13,$14::uuid,$15::uuid,$16::date,$17::date,$18,$19::uuid,$20::uuid,$21::uuid,$22::uuid,$22::uuid,
        CASE WHEN $6::production_project_status = 'completed' THEN now() ELSE NULL END,
        CASE WHEN $6::production_project_status = 'completed' THEN $22::uuid ELSE NULL END
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      template?.id ?? null,
      "Manual production item created directly in Production.",
      input.title.trim(),
      normalizeNullableText(input.summary),
      deriveLegacyStatusForStage(resolvedStage),
      resolvedJobType,
      resolvedCategory,
      resolvedStage,
      input.priority ?? template?.default_priority ?? "normal",
      input.ownerUserId ?? null,
      reviewDefaults.peerReviewRequired,
      reviewDefaults.finalQcRequired,
      input.peerReviewerUserId ?? null,
      input.finalQcReviewerUserId ?? null,
      input.dueDate ?? null,
      input.followUpDate ?? null,
      normalizeNullableText(input.latestNote),
      linkedContext.organizationId,
      linkedContext.locationId,
      linkedContext.shootId,
      auth.id
    ]
  );

  const projectId = projectInsert.rows[0].id;
  if (template) {
    await createProjectTasksFromTemplate(client, auth.tenantId, projectId, template.id, input.dueDate ?? getLocalDateString(), auth.id);
  }

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    actorUserId: auth.id,
    eventType: "project.created_manual",
    summary: "Manual production item created in Production",
    note: normalizeNullableText(input.latestNote),
      metadata: {
        template_key: template?.template_key ?? null,
        job_type: resolvedJobType,
        category: resolvedCategory,
        stage: resolvedStage,
      linked_organization_id: linkedContext.organizationId,
      linked_location_id: linkedContext.locationId,
      linked_shoot_id: linkedContext.shootId
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.created_manual",
    entityType: "production_project",
    entityId: projectId,
    metadata: {
      template_key: template?.template_key ?? null,
      linked_organization_id: linkedContext.organizationId,
      linked_location_id: linkedContext.locationId,
      linked_shoot_id: linkedContext.shootId
    },
    newValues: {
      title: input.title.trim(),
      status: deriveLegacyStatusForStage(resolvedStage),
      job_type: resolvedJobType,
      category: resolvedCategory,
      stage: resolvedStage,
      priority: input.priority ?? template?.default_priority ?? "normal",
      owner_user_id: input.ownerUserId ?? null,
      peer_reviewer_user_id: input.peerReviewerUserId ?? null,
      final_qc_reviewer_user_id: input.finalQcReviewerUserId ?? null,
      due_date: input.dueDate ?? null,
      follow_up_date: input.followUpDate ?? null
    }
  });

  return getProductionProjectDetail(client, auth, projectId);
}

export async function updateProductionProjectBuddyWorkflow(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  patch: UpdateProductionProjectBuddyWorkflowInput
): Promise<ProductionProjectDetail> {
  await assertProjectExists(client, auth.tenantId, projectId);
  const existing = await client.query<{
    id: string;
    status: ProductionProjectTaskStatus;
    owner_user_id: string | null;
    duplicate_handling_required: boolean;
    cleanup_completed_at: string | null;
    cleanup_completed_by_user_id: string | null;
    unresolved_group_count: number;
    notes: string | null;
  }>(
    `
      SELECT
        id,
        status::text AS status,
        owner_user_id,
        duplicate_handling_required,
        cleanup_completed_at::text AS cleanup_completed_at,
        cleanup_completed_by_user_id,
        unresolved_group_count,
        notes
      FROM production_project_buddy_workflow
      WHERE tenant_id = $1
        AND project_id = $2
      LIMIT 1
    `,
    [auth.tenantId, projectId]
  );
  const current = existing.rows[0] ?? null;

  const nextStatus = patch.status ?? current?.status ?? "todo";
  const nextOwnerUserId = patch.ownerUserId !== undefined ? patch.ownerUserId : current?.owner_user_id ?? null;
  const nextDuplicateRequired =
    patch.duplicateHandlingRequired !== undefined
      ? patch.duplicateHandlingRequired
      : current?.duplicate_handling_required ?? false;
  const nextUnresolvedGroupCount =
    patch.unresolvedGroupCount !== undefined ? patch.unresolvedGroupCount : current?.unresolved_group_count ?? 0;
  const nextNotes = patch.notes !== undefined ? patch.notes : current?.notes ?? null;

  let cleanupCompletedAt = current?.cleanup_completed_at ?? null;
  let cleanupCompletedByUserId = current?.cleanup_completed_by_user_id ?? null;
  if (patch.cleanupCompleted === true) {
    cleanupCompletedAt = new Date().toISOString();
    cleanupCompletedByUserId = auth.id;
  } else if (patch.cleanupCompleted === false) {
    cleanupCompletedAt = null;
    cleanupCompletedByUserId = null;
  }

  if (nextStatus === "done") {
    if (nextDuplicateRequired && !cleanupCompletedAt) {
      throw new ApiError(400, "Buddy workflow cannot be completed until duplicate cleanup is marked complete.");
    }
    if (nextUnresolvedGroupCount > 0) {
      throw new ApiError(400, "Buddy workflow cannot be completed while unresolved groups remain.");
    }
  }

  if (current) {
    await client.query(
      `
        UPDATE production_project_buddy_workflow
        SET status = $3::production_project_task_status,
            owner_user_id = $4::uuid,
            duplicate_handling_required = $5,
            cleanup_completed_at = $6::timestamptz,
            cleanup_completed_by_user_id = $7::uuid,
            unresolved_group_count = $8,
            notes = $9,
            updated_at = now()
        WHERE tenant_id = $1
          AND project_id = $2
      `,
      [
        auth.tenantId,
        projectId,
        nextStatus,
        nextOwnerUserId,
        nextDuplicateRequired,
        cleanupCompletedAt,
        cleanupCompletedByUserId,
        nextUnresolvedGroupCount,
        normalizeNullableText(nextNotes)
      ]
    );
  } else {
    await client.query(
      `
        INSERT INTO production_project_buddy_workflow (
          tenant_id,
          project_id,
          status,
          owner_user_id,
          duplicate_handling_required,
          cleanup_completed_at,
          cleanup_completed_by_user_id,
          unresolved_group_count,
          notes,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3::production_project_task_status,$4::uuid,$5,$6::timestamptz,$7::uuid,$8,$9,now(),now())
      `,
      [
        auth.tenantId,
        projectId,
        nextStatus,
        nextOwnerUserId,
        nextDuplicateRequired,
        cleanupCompletedAt,
        cleanupCompletedByUserId,
        nextUnresolvedGroupCount,
        normalizeNullableText(nextNotes)
      ]
    );
  }

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    actorUserId: auth.id,
    eventType: "buddy_workflow.updated",
    summary: "Buddy photo workflow updated",
    note: normalizeNullableText(nextNotes),
    metadata: {
      status: nextStatus,
      duplicate_handling_required: nextDuplicateRequired,
      unresolved_group_count: nextUnresolvedGroupCount
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.buddy_workflow.updated",
    entityType: "production_project",
    entityId: projectId,
    metadata: {
      status: nextStatus,
      duplicate_handling_required: nextDuplicateRequired,
      unresolved_group_count: nextUnresolvedGroupCount
    }
  });

  return getProductionProjectDetail(client, auth, projectId);
}

export async function updateProductionProjectVirtualTeamWorkflow(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  patch: UpdateProductionProjectVirtualTeamWorkflowInput
): Promise<ProductionProjectDetail> {
  await assertProjectExists(client, auth.tenantId, projectId);
  const existing = await client.query<{
    id: string;
    status: ProductionProjectTaskStatus;
    owner_user_id: string | null;
    attributes_validated: boolean;
    coach_tags_validated: boolean;
    split_by_group_validated: boolean;
    ambiguous_match_required: boolean;
    ambiguous_match_resolved_at: string | null;
    completed_at: string | null;
    completed_by_user_id: string | null;
    notes: string | null;
  }>(
    `
      SELECT
        id,
        status::text AS status,
        owner_user_id,
        attributes_validated,
        coach_tags_validated,
        split_by_group_validated,
        ambiguous_match_required,
        ambiguous_match_resolved_at::text AS ambiguous_match_resolved_at,
        completed_at::text AS completed_at,
        completed_by_user_id,
        notes
      FROM production_project_virtual_team_workflow
      WHERE tenant_id = $1
        AND project_id = $2
      LIMIT 1
    `,
    [auth.tenantId, projectId]
  );
  const current = existing.rows[0] ?? null;

  const nextStatus = patch.status ?? current?.status ?? "todo";
  const nextOwnerUserId = patch.ownerUserId !== undefined ? patch.ownerUserId : current?.owner_user_id ?? null;
  const nextAttributesValidated =
    patch.attributesValidated !== undefined ? patch.attributesValidated : current?.attributes_validated ?? false;
  const nextCoachTagsValidated =
    patch.coachTagsValidated !== undefined ? patch.coachTagsValidated : current?.coach_tags_validated ?? false;
  const nextSplitByGroupValidated =
    patch.splitByGroupValidated !== undefined ? patch.splitByGroupValidated : current?.split_by_group_validated ?? false;
  const nextAmbiguousRequired =
    patch.ambiguousMatchRequired !== undefined ? patch.ambiguousMatchRequired : current?.ambiguous_match_required ?? false;
  const nextNotes = patch.notes !== undefined ? patch.notes : current?.notes ?? null;

  let ambiguousMatchResolvedAt = current?.ambiguous_match_resolved_at ?? null;
  if (patch.ambiguousMatchResolved === true) {
    ambiguousMatchResolvedAt = new Date().toISOString();
  } else if (patch.ambiguousMatchResolved === false) {
    ambiguousMatchResolvedAt = null;
  }

  let completedAt = current?.completed_at ?? null;
  let completedByUserId = current?.completed_by_user_id ?? null;
  if (nextStatus === "done") {
    if (!nextAttributesValidated || !nextCoachTagsValidated || !nextSplitByGroupValidated) {
      throw new ApiError(400, "Virtual team workflow cannot be completed until validation checks are confirmed.");
    }
    if (nextAmbiguousRequired && !ambiguousMatchResolvedAt) {
      throw new ApiError(400, "Virtual team workflow cannot be completed while ambiguous matches remain unresolved.");
    }
    completedAt = new Date().toISOString();
    completedByUserId = auth.id;
  } else if (patch.status && patch.status !== "done") {
    completedAt = null;
    completedByUserId = null;
  }

  if (current) {
    await client.query(
      `
        UPDATE production_project_virtual_team_workflow
        SET status = $3::production_project_task_status,
            owner_user_id = $4::uuid,
            attributes_validated = $5,
            coach_tags_validated = $6,
            split_by_group_validated = $7,
            ambiguous_match_required = $8,
            ambiguous_match_resolved_at = $9::timestamptz,
            completed_at = $10::timestamptz,
            completed_by_user_id = $11::uuid,
            notes = $12,
            updated_at = now()
        WHERE tenant_id = $1
          AND project_id = $2
      `,
      [
        auth.tenantId,
        projectId,
        nextStatus,
        nextOwnerUserId,
        nextAttributesValidated,
        nextCoachTagsValidated,
        nextSplitByGroupValidated,
        nextAmbiguousRequired,
        ambiguousMatchResolvedAt,
        completedAt,
        completedByUserId,
        normalizeNullableText(nextNotes)
      ]
    );
  } else {
    await client.query(
      `
        INSERT INTO production_project_virtual_team_workflow (
          tenant_id,
          project_id,
          status,
          owner_user_id,
          attributes_validated,
          coach_tags_validated,
          split_by_group_validated,
          ambiguous_match_required,
          ambiguous_match_resolved_at,
          completed_at,
          completed_by_user_id,
          notes,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3::production_project_task_status,$4::uuid,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11::uuid,$12,now(),now())
      `,
      [
        auth.tenantId,
        projectId,
        nextStatus,
        nextOwnerUserId,
        nextAttributesValidated,
        nextCoachTagsValidated,
        nextSplitByGroupValidated,
        nextAmbiguousRequired,
        ambiguousMatchResolvedAt,
        completedAt,
        completedByUserId,
        normalizeNullableText(nextNotes)
      ]
    );
  }

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    actorUserId: auth.id,
    eventType: "virtual_team_workflow.updated",
    summary: "Virtual team workflow updated",
    note: normalizeNullableText(nextNotes),
    metadata: {
      status: nextStatus,
      attributes_validated: nextAttributesValidated,
      coach_tags_validated: nextCoachTagsValidated,
      split_by_group_validated: nextSplitByGroupValidated,
      ambiguous_match_required: nextAmbiguousRequired
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.virtual_team_workflow.updated",
    entityType: "production_project",
    entityId: projectId,
    metadata: {
      status: nextStatus,
      attributes_validated: nextAttributesValidated,
      coach_tags_validated: nextCoachTagsValidated,
      split_by_group_validated: nextSplitByGroupValidated,
      ambiguous_match_required: nextAmbiguousRequired
    }
  });

  return getProductionProjectDetail(client, auth, projectId);
}

export async function createProductionProjectException(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  input: CreateProductionProjectExceptionInput
): Promise<ProductionProjectDetail> {
  await assertProjectExists(client, auth.tenantId, projectId);
  await client.query(
    `
      INSERT INTO production_project_exception (
        tenant_id,
        project_id,
        lane_type,
        exception_type,
        severity,
        blocking,
        status,
        assignee_user_id,
        notes,
        issue_tag,
        follow_up_type,
        follow_up_status,
        follow_up_owner_user_id,
        follow_up_notes,
        created_by_user_id,
        created_at
      )
      VALUES ($1,$2,$3::production_project_lane_type,$4::production_project_exception_type,$5::production_project_exception_severity,$6,$7::production_project_exception_status,$8::uuid,$9,$10,$11::production_follow_up_type,$12::production_follow_up_status,$13::uuid,$14,$15::uuid,now())
    `,
    [
      auth.tenantId,
      projectId,
      input.laneType,
      input.exceptionType,
      input.severity ?? "normal",
      input.blocking ?? false,
      "open",
      input.assigneeUserId ?? null,
      normalizeNullableText(input.notes),
      normalizeNullableText(input.issueTag),
      input.followUpType ?? null,
      input.followUpStatus ?? null,
      input.followUpOwnerUserId ?? null,
      normalizeNullableText(input.followUpNotes),
      auth.id
    ]
  );

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    actorUserId: auth.id,
    eventType: "production_exception.created",
    summary: "Production exception recorded",
    note: normalizeNullableText(input.notes),
    metadata: {
      lane_type: input.laneType,
      exception_type: input.exceptionType,
      severity: input.severity ?? "normal",
      blocking: input.blocking ?? false,
      issue_tag: normalizeNullableText(input.issueTag),
      follow_up_type: input.followUpType ?? null,
      follow_up_status: input.followUpStatus ?? null
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.exception.created",
    entityType: "production_project_exception",
    entityId: projectId,
    metadata: {
      lane_type: input.laneType,
      exception_type: input.exceptionType,
      severity: input.severity ?? "normal",
      blocking: input.blocking ?? false,
      issue_tag: normalizeNullableText(input.issueTag),
      follow_up_type: input.followUpType ?? null,
      follow_up_status: input.followUpStatus ?? null
    }
  });

  return getProductionProjectDetail(client, auth, projectId);
}

export async function updateProductionProjectException(
  client: PoolClient,
  auth: AuthUser,
  exceptionId: string,
  patch: UpdateProductionProjectExceptionInput
): Promise<ProductionProjectDetail> {
  const existing = await client.query<{ project_id: string; status: "open" | "resolved" | "dismissed" }>(
    `
      SELECT project_id, status::text AS status
      FROM production_project_exception
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, exceptionId]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new ApiError(404, "Production exception not found");
  }
  const nextStatus = patch.status ?? row.status;
  const resolvedAt = nextStatus === "resolved" || nextStatus === "dismissed" ? new Date().toISOString() : null;
  const resolvedBy = nextStatus === "resolved" || nextStatus === "dismissed" ? auth.id : null;

  await client.query(
    `
      UPDATE production_project_exception
      SET status = $3::production_project_exception_status,
          blocking = COALESCE($4, blocking),
          assignee_user_id = COALESCE($5::uuid, assignee_user_id),
          notes = COALESCE($6, notes),
          resolution_notes = COALESCE($7, resolution_notes),
          issue_tag = COALESCE($8, issue_tag),
          follow_up_type = COALESCE($9::production_follow_up_type, follow_up_type),
          follow_up_status = COALESCE($10::production_follow_up_status, follow_up_status),
          follow_up_owner_user_id = COALESCE($11::uuid, follow_up_owner_user_id),
          follow_up_notes = COALESCE($12, follow_up_notes),
          resolved_at = $13::timestamptz,
          resolved_by_user_id = $14::uuid
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      exceptionId,
      nextStatus,
      patch.blocking ?? null,
      patch.assigneeUserId ?? null,
      normalizeNullableText(patch.notes) ?? null,
      normalizeNullableText(patch.resolutionNotes) ?? null,
      normalizeNullableText(patch.issueTag),
      patch.followUpType ?? null,
      patch.followUpStatus ?? null,
      patch.followUpOwnerUserId ?? null,
      normalizeNullableText(patch.followUpNotes),
      resolvedAt,
      resolvedBy
    ]
  );

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId: row.project_id,
    actorUserId: auth.id,
    eventType: "production_exception.updated",
    summary: `Production exception ${nextStatus}`,
    note: normalizeNullableText(patch.resolutionNotes ?? patch.notes ?? null)
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.exception.updated",
    entityType: "production_project_exception",
    entityId: exceptionId,
    metadata: {
      status: nextStatus,
      issue_tag: normalizeNullableText(patch.issueTag),
      follow_up_type: patch.followUpType ?? null,
      follow_up_status: patch.followUpStatus ?? null
    }
  });

  return getProductionProjectDetail(client, auth, row.project_id);
}

async function resolveProductionApprovalGate(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  input: {
    requiresApproval: boolean;
    reason: string | null;
    reasonRequiredMessage: string;
    dedupeKey: string;
    requestType:
      | "due_date_extension_approval"
      | "deadline_override_approval"
      | "peer_review_exception_approval"
      | "qc_exception_approval"
      | "release_override_approval"
      | "rework_waiver_approval"
      | "cancellation_approval"
      | "policy_exception_approval";
    severity: "normal" | "high" | "critical";
    requestedActionCode: string;
    requestTitle: string;
    requestSummary: string;
    sourceEntityLabel: string;
    currentState: Record<string, unknown>;
    requestedState: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<{ approvalRequestId: string | null; approvalResponse: ProductionProjectMutationResult | null }> {
  const consumedApproval = await consumeApprovedOperationalApproval(client, auth, input.dedupeKey);
  if ("approval_required" in consumedApproval) {
    if (consumedApproval.consumed_approval_request_id) {
      return {
        approvalRequestId: consumedApproval.consumed_approval_request_id,
        approvalResponse: null
      };
    }
    if (!input.requiresApproval) {
      return { approvalRequestId: null, approvalResponse: null };
    }
    const reason = normalizeNullableText(input.reason);
    if (!reason) {
      throw new ApiError(400, input.reasonRequiredMessage);
    }
    const approvalRequest = await ensureOperationalApprovalRequest(client, auth, {
      requestType: input.requestType,
      sourceModule: "production",
      sourceEntityType: "production_project",
      sourceEntityId: projectId,
      sourceEntityLabel: input.sourceEntityLabel,
      requesterDepartment: auth.department,
      requestedActionCode: input.requestedActionCode,
      requestTitle: input.requestTitle,
      requestSummary: input.requestSummary,
      reason,
      severity: input.severity,
      blocking: true,
      dedupeKey: input.dedupeKey,
      currentState: input.currentState,
      requestedState: input.requestedState,
      metadata: input.metadata
    });
    return {
      approvalRequestId: null,
      approvalResponse: {
        approval_required: true,
        approval_request: approvalRequest,
        detail: await getProductionProjectDetail(client, auth, projectId)
      }
    };
  }

  return {
    approvalRequestId: null,
    approvalResponse: {
      approval_required: true,
      approval_request: consumedApproval,
      detail: await getProductionProjectDetail(client, auth, projectId)
    }
  };
}

function buildProductionApprovalDedupeKey(input: {
  projectId: string;
  actionCode: string;
  nextStage?: string | null;
  nextDueDate?: string | null;
  extra?: Array<string | null | undefined>;
}) {
  return [input.projectId, input.actionCode, input.nextStage ?? "na", input.nextDueDate ?? "na", ...(input.extra ?? []).filter(Boolean)]
    .map((value) => String(value))
    .join(":");
}

export async function updateProductionProject(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  patch: UpdateProductionProjectInput
): Promise<ProductionProjectMutationResult> {
  const current = await loadProjectRowById(client, auth.tenantId, projectId);
  if (!current) {
    throw new ApiError(404, "Production project not found");
  }

  const nextJobType = patch.jobType ?? current.job_type;
  const nextStage = patch.stage ?? current.stage;
  const nextPriority = patch.priority ?? current.priority;
  const nextOwnerUserId = Object.prototype.hasOwnProperty.call(patch, "ownerUserId") ? patch.ownerUserId ?? null : current.owner_user_id;
  const nextPeerReviewerUserId = Object.prototype.hasOwnProperty.call(patch, "peerReviewerUserId")
    ? patch.peerReviewerUserId ?? null
    : current.peer_reviewer_user_id;
  const nextFinalQcReviewerUserId = Object.prototype.hasOwnProperty.call(patch, "finalQcReviewerUserId")
    ? patch.finalQcReviewerUserId ?? null
    : current.final_qc_reviewer_user_id;
  const nextDueDate = Object.prototype.hasOwnProperty.call(patch, "dueDate") ? patch.dueDate ?? null : current.due_date;
  const nextFollowUpDate = Object.prototype.hasOwnProperty.call(patch, "followUpDate") ? patch.followUpDate ?? null : current.follow_up_date;
  const nextSnoozedUntil = Object.prototype.hasOwnProperty.call(patch, "snoozedUntil") ? patch.snoozedUntil ?? null : current.snoozed_until;
  const nextSummary = Object.prototype.hasOwnProperty.call(patch, "summary") ? normalizeNullableText(patch.summary) : current.summary;
  const nextLatestNote = Object.prototype.hasOwnProperty.call(patch, "latestNote") ? normalizeNullableText(patch.latestNote) : current.latest_note;
  const nextTitle = patch.title?.trim() ? patch.title.trim() : current.title;
  const nextCorrectionReason = Object.prototype.hasOwnProperty.call(patch, "correctionReason")
    ? normalizeNullableText(patch.correctionReason)
    : current.correction_reason;
  const nextQaChecks = Object.prototype.hasOwnProperty.call(patch, "qaChecks") ? patch.qaChecks ?? null : null;
  const nextQaChecklistComplete =
    nextQaChecks === null ? true : Boolean(Object.prototype.hasOwnProperty.call(patch, "qaChecklistComplete") ? patch.qaChecklistComplete : false);
  const nextStatus = deriveLegacyStatusForStage(nextStage);
  const nextQaState = deriveQaStateFromStage(nextStage, {
    peerReviewRequired: current.peer_review_required,
    finalQcRequired: current.final_qc_required
  });
  const nextReleaseState = deriveReleaseStateFromStage(nextStage);
  const nextPreviousActiveStage = derivePreviousActiveStage(current, nextStage);

  assertProductionStageTransitionRights(auth, {
    currentStage: current.stage,
    nextStage,
    currentPreviousActiveStage: current.previous_active_stage,
    note: nextLatestNote
  });

  const workflowGate = await loadProductionProjectWorkflowGate(client, auth.tenantId, projectId, {
    includeReleaseTasksAsOpen: false
  });
  const approvalReason = nextLatestNote ?? nextCorrectionReason ?? normalizeNullableText(patch.blockerReason) ?? null;
  let consumedApprovalRequestId: string | null = null;
  const maybeRequireApproval = async (input: Parameters<typeof resolveProductionApprovalGate>[3]) => {
    const gate = await resolveProductionApprovalGate(client, auth, projectId, input);
    if (gate.approvalResponse) {
      return gate.approvalResponse;
    }
    if (gate.approvalRequestId) {
      consumedApprovalRequestId = gate.approvalRequestId;
    }
    return null;
  };

  if (nextStage === "cancelled" && current.stage !== "cancelled") {
    const approvalResponse = await maybeRequireApproval({
      requiresApproval: true,
      reason: approvalReason,
      reasonRequiredMessage: "Canceling a production job requires an approval note.",
      dedupeKey: buildProductionApprovalDedupeKey({
        projectId,
        actionCode: "production.cancel",
        nextStage
      }),
      requestType: "cancellation_approval",
      severity: current.priority === "critical" ? "critical" : "high",
      requestedActionCode: "production.cancel",
      requestTitle: `Approval needed to cancel ${current.title}`,
      requestSummary: `${current.title} is being moved to Cancelled.`,
      sourceEntityLabel: current.title,
      currentState: {
        stage: current.stage,
        status: current.status,
        due_date: current.due_date
      },
      requestedState: {
        stage: nextStage,
        status: nextStatus,
        latest_note: approvalReason
      },
      metadata: {
        current_blocker_type: current.blocker_type,
        linked_shoot_id: current.linked_shoot_id
      }
    });
    if (approvalResponse) {
      return approvalResponse;
    }
  }

  if (
    nextDueDate &&
    current.due_date &&
    nextDueDate > current.due_date &&
    current.status !== "completed" &&
    current.stage !== "released_complete"
  ) {
    const approvalResponse = await maybeRequireApproval({
      requiresApproval: true,
      reason: approvalReason,
      reasonRequiredMessage: "Extending a production due date requires an approval note.",
      dedupeKey: buildProductionApprovalDedupeKey({
        projectId,
        actionCode: "production.extend_due_date",
        nextDueDate
      }),
      requestType: "due_date_extension_approval",
      severity: current.priority === "critical" ? "high" : "normal",
      requestedActionCode: "production.extend_due_date",
      requestTitle: `Approval needed to extend the due date for ${current.title}`,
      requestSummary: `${current.title} is moving from ${current.due_date} to ${nextDueDate}.`,
      sourceEntityLabel: current.title,
      currentState: {
        due_date: current.due_date,
        follow_up_date: current.follow_up_date,
        stage: current.stage
      },
      requestedState: {
        due_date: nextDueDate,
        follow_up_date: nextFollowUpDate,
        latest_note: approvalReason
      },
      metadata: {
        priority: current.priority,
        owner_user_id: nextOwnerUserId
      }
    });
    if (approvalResponse) {
      return approvalResponse;
    }
  }

  if (
    current.stage === "correction_needed" &&
    current.stage !== nextStage &&
    (nextStage === "ready_to_release" || nextStage === "released_complete")
  ) {
    const approvalResponse = await maybeRequireApproval({
      requiresApproval: true,
      reason: approvalReason,
      reasonRequiredMessage: "Moving a correction-needed job forward requires a waiver note.",
      dedupeKey: buildProductionApprovalDedupeKey({
        projectId,
        actionCode: "production.rework_waiver",
        nextStage
      }),
      requestType: "rework_waiver_approval",
      severity: current.priority === "critical" ? "critical" : "high",
      requestedActionCode: "production.rework_waiver",
      requestTitle: `Approval needed to bypass rework on ${current.title}`,
      requestSummary: `${current.title} is leaving Correction Needed without completing the normal remediation path.`,
      sourceEntityLabel: current.title,
      currentState: {
        stage: current.stage,
        correction_reason: current.correction_reason
      },
      requestedState: {
        stage: nextStage,
        latest_note: approvalReason
      },
      metadata: {
        workflow_blocked_reasons: workflowGate.blockedReasons
      }
    });
    if (approvalResponse) {
      return approvalResponse;
    }
  }

  if (nextStage === "ready_to_release") {
    const missingPeerReviewer = current.peer_review_required && !nextPeerReviewerUserId;
    const missingFinalQcReviewer = current.final_qc_required && !nextFinalQcReviewerUserId;
    const peerReviewException =
      missingPeerReviewer || workflowGate.blockedReasons.some((reason) => reason.toLowerCase().includes("peer review"));
    const qcException =
      missingFinalQcReviewer || workflowGate.blockedReasons.some((reason) => reason.toLowerCase().includes("final qc"));
    if (peerReviewException || qcException || workflowGate.blockedReasons.length > 0) {
      const approvalResponse = await maybeRequireApproval({
        requiresApproval: true,
        reason: approvalReason,
        reasonRequiredMessage: "Moving a production job to Ready to Release requires an approval note when quality gates are incomplete.",
        dedupeKey: buildProductionApprovalDedupeKey({
          projectId,
          actionCode: "production.ready_to_release_override",
          nextStage,
          extra: workflowGate.blockedReasons
        }),
        requestType: peerReviewException
          ? "peer_review_exception_approval"
          : qcException
            ? "qc_exception_approval"
            : "release_override_approval",
        severity: current.priority === "critical" || workflowGate.blockedReasons.length > 1 ? "critical" : "high",
        requestedActionCode: "production.ready_to_release_override",
        requestTitle: `Approval needed to move ${current.title} to Ready to Release`,
        requestSummary:
          workflowGate.blockedReasons[0] ??
          (peerReviewException ? "Peer review requirements are incomplete." : "Final QC requirements are incomplete."),
        sourceEntityLabel: current.title,
        currentState: {
          stage: current.stage,
          peer_reviewer_user_id: current.peer_reviewer_user_id,
          final_qc_reviewer_user_id: current.final_qc_reviewer_user_id
        },
        requestedState: {
          stage: nextStage,
          peer_reviewer_user_id: nextPeerReviewerUserId,
          final_qc_reviewer_user_id: nextFinalQcReviewerUserId,
          latest_note: approvalReason
        },
        metadata: {
          blocked_reasons: workflowGate.blockedReasons
        }
      });
      if (approvalResponse) {
        return approvalResponse;
      }
    }
  }

  if (nextStage === "released_complete") {
    const releaseBlocked =
      workflowGate.blockedReasons.length > 0 ||
      (current.peer_review_required && !nextPeerReviewerUserId) ||
      (current.final_qc_required && !nextFinalQcReviewerUserId);
    if (releaseBlocked) {
      const approvalResponse = await maybeRequireApproval({
        requiresApproval: true,
        reason: approvalReason,
        reasonRequiredMessage: "Releasing a production job past incomplete gates requires an approval note.",
        dedupeKey: buildProductionApprovalDedupeKey({
          projectId,
          actionCode: "production.release_override",
          nextStage,
          extra: workflowGate.blockedReasons
        }),
        requestType: "release_override_approval",
        severity: current.priority === "critical" || workflowGate.blockedReasons.length > 0 ? "critical" : "high",
        requestedActionCode: "production.release_override",
        requestTitle: `Approval needed to release ${current.title}`,
        requestSummary:
          workflowGate.blockedReasons[0] ??
          "Release is being requested while required QA or release gates are incomplete.",
        sourceEntityLabel: current.title,
        currentState: {
          stage: current.stage,
          qa_state: current.qa_state,
          release_state: current.release_state
        },
        requestedState: {
          stage: nextStage,
          status: nextStatus,
          latest_note: approvalReason
        },
        metadata: {
          blocked_reasons: workflowGate.blockedReasons
        }
      });
      if (approvalResponse) {
        return approvalResponse;
      }
    }
  }

  if ((nextStage === "ready_for_qa" || nextStage === "in_qa_review") && current.peer_review_required && !nextPeerReviewerUserId) {
    throw new ApiError(400, "Assign a peer reviewer before moving this production job into the review queue.");
  }

  if (nextStage === "ready_to_release") {
    assertProjectReadyForRelease({
      project: current,
      gate: workflowGate,
      peerReviewerUserId: nextPeerReviewerUserId,
      finalQcReviewerUserId: nextFinalQcReviewerUserId
    });
  }

  if (nextStage === "released_complete") {
    assertProjectCanRelease({
      project: current,
      gate: workflowGate,
      peerReviewerUserId: nextPeerReviewerUserId,
      finalQcReviewerUserId: nextFinalQcReviewerUserId
    });
  }

  if (nextStage === "blocked" && (!patch.blockerType || !normalizeNullableText(patch.blockerReason))) {
    throw new ApiError(400, "Blocking a production job requires a blocker type and reason.");
  }

  if (nextStage === "correction_needed" && !nextCorrectionReason) {
    throw new ApiError(400, "Routing a job into Correction Needed requires a correction reason.");
  }

  await client.query(
    `
      UPDATE production_project
      SET
        title = $3,
        summary = $4,
        status = $5::production_project_status,
        job_type = $6::production_project_job_type,
        stage = $7::production_project_stage,
        qa_state = $8::production_project_qa_state,
        release_state = $9::production_project_release_state,
        previous_active_stage = $10::production_project_stage,
        correction_reason = $11,
        priority = $12::production_project_priority,
        owner_user_id = $13,
        peer_reviewer_user_id = $14::uuid,
        final_qc_reviewer_user_id = $15::uuid,
        due_date = $16::date,
        follow_up_date = $17::date,
        snoozed_until = $18::date,
        latest_note = $19,
        completed_at = CASE
          WHEN $5::production_project_status = 'completed' AND status <> 'completed' THEN now()
          WHEN $5::production_project_status <> 'completed' THEN NULL
          ELSE completed_at
        END,
        completed_by_user_id = CASE
          WHEN $5::production_project_status = 'completed' AND status <> 'completed' THEN $2
          WHEN $5::production_project_status <> 'completed' THEN NULL
          ELSE completed_by_user_id
        END,
        reopened_at = CASE
          WHEN stage = 'released_complete'::production_project_stage
               AND $7::production_project_stage <> 'released_complete'::production_project_stage
            THEN now()
          ELSE reopened_at
        END,
        reopened_by_user_id = CASE
          WHEN stage = 'released_complete'::production_project_stage
               AND $7::production_project_stage <> 'released_complete'::production_project_stage
            THEN $2
          ELSE reopened_by_user_id
        END,
        updated_by_user_id = $2,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $20
    `,
    [
      auth.tenantId,
      auth.id,
      nextTitle,
      nextSummary,
      nextStatus,
      nextJobType,
      nextStage,
      nextQaState,
      nextReleaseState,
      nextPreviousActiveStage,
      nextCorrectionReason,
      nextPriority,
      nextOwnerUserId,
      nextPeerReviewerUserId,
      nextFinalQcReviewerUserId,
      nextDueDate,
      nextFollowUpDate,
      nextSnoozedUntil,
      nextLatestNote,
      projectId
    ]
  );

  await syncProjectBlocker(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    projectId,
    currentBlockerId: current.blocker_id,
    nextStage,
    blockerType: patch.blockerType ?? null,
    blockerOwnerUserId: patch.blockerOwnerUserId ?? null,
    blockerReason: normalizeNullableText(patch.blockerReason),
    blockerDependency: normalizeNullableText(patch.blockerDependency),
    blockerExpectedResolutionDate: patch.blockerExpectedResolutionDate ?? null,
    blockerNotes: normalizeNullableText(patch.blockerNotes),
    clearBlocker: Boolean(patch.clearBlocker),
    resolutionNote: nextLatestNote
  });

  await maybeRecordProductionReview(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    projectId,
    currentStage: current.stage,
    nextStage,
    correctionReason: nextCorrectionReason,
    note: nextLatestNote,
    reviewerUserId:
      nextStage === "ready_to_release"
        ? nextFinalQcReviewerUserId ?? nextPeerReviewerUserId ?? auth.id
        : nextStage === "correction_needed" || nextStage === "in_qa_review"
          ? nextPeerReviewerUserId ?? nextFinalQcReviewerUserId ?? auth.id
          : auth.id,
    reassignedOwnerUserId: nextOwnerUserId,
    qaChecks: nextQaChecks,
    qaChecklistComplete: nextQaChecklistComplete
  });

  const changeLabels: string[] = [];
  if (current.stage !== nextStage) {
    changeLabels.push(`stage ${humanizeProjectStage(current.stage)} -> ${humanizeProjectStage(nextStage)}`);
  }
  if (current.job_type !== nextJobType) {
    changeLabels.push(`job type ${humanizeProjectJobType(current.job_type)} -> ${humanizeProjectJobType(nextJobType)}`);
  }
  if (current.owner_user_id !== nextOwnerUserId) {
    changeLabels.push(nextOwnerUserId ? "owner assigned" : "owner cleared");
  }
  if (current.peer_reviewer_user_id !== nextPeerReviewerUserId) {
    changeLabels.push(nextPeerReviewerUserId ? "peer reviewer assigned" : "peer reviewer cleared");
  }
  if (current.final_qc_reviewer_user_id !== nextFinalQcReviewerUserId) {
    changeLabels.push(nextFinalQcReviewerUserId ? "final QC reviewer assigned" : "final QC reviewer cleared");
  }
  if ((current.due_date ?? null) !== nextDueDate) {
    changeLabels.push(nextDueDate ? "due date updated" : "due date cleared");
  }
  if ((current.follow_up_date ?? null) !== nextFollowUpDate) {
    changeLabels.push(nextFollowUpDate ? "follow-up updated" : "follow-up cleared");
  }
  if ((current.snoozed_until ?? null) !== nextSnoozedUntil) {
    changeLabels.push(nextSnoozedUntil ? "snoozed" : "snooze cleared");
  }
  if ((current.latest_note ?? null) !== nextLatestNote && nextLatestNote) {
    changeLabels.push("note added");
  }
  if ((current.correction_reason ?? null) !== nextCorrectionReason && nextCorrectionReason) {
    changeLabels.push("correction reason updated");
  }

  if (changeLabels.length) {
    await recordProductionProjectEvent(client, {
      tenantId: auth.tenantId,
      projectId,
      actorUserId: auth.id,
      eventType: "project.updated",
      summary: `Production item updated: ${changeLabels.join(" | ")}`,
      note: nextLatestNote,
      metadata: {
        status: nextStatus,
        job_type: nextJobType,
        stage: nextStage,
        qa_state: nextQaState,
        release_state: nextReleaseState,
        owner_user_id: nextOwnerUserId,
        peer_reviewer_user_id: nextPeerReviewerUserId,
        final_qc_reviewer_user_id: nextFinalQcReviewerUserId,
        due_date: nextDueDate,
        follow_up_date: nextFollowUpDate,
        snoozed_until: nextSnoozedUntil,
        correction_reason: nextCorrectionReason
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.updated",
    entityType: "production_project",
    entityId: projectId,
    previousValues: {
      title: current.title,
      summary: current.summary,
      status: current.status,
      job_type: current.job_type,
      stage: current.stage,
      qa_state: current.qa_state,
      release_state: current.release_state,
      correction_reason: current.correction_reason,
      priority: current.priority,
      owner_user_id: current.owner_user_id,
      peer_reviewer_user_id: current.peer_reviewer_user_id,
      final_qc_reviewer_user_id: current.final_qc_reviewer_user_id,
      due_date: current.due_date,
      follow_up_date: current.follow_up_date,
      snoozed_until: current.snoozed_until,
      latest_note: current.latest_note
    },
    newValues: {
      title: nextTitle,
      summary: nextSummary,
      status: nextStatus,
      job_type: nextJobType,
      stage: nextStage,
      qa_state: nextQaState,
      release_state: nextReleaseState,
      correction_reason: nextCorrectionReason,
      priority: nextPriority,
      owner_user_id: nextOwnerUserId,
      peer_reviewer_user_id: nextPeerReviewerUserId,
      final_qc_reviewer_user_id: nextFinalQcReviewerUserId,
      due_date: nextDueDate,
      follow_up_date: nextFollowUpDate,
      snoozed_until: nextSnoozedUntil,
      latest_note: nextLatestNote
    }
  });

  if (nextStage === "released_complete") {
    await completeReleaseTasksForProject(client, {
      tenantId: auth.tenantId,
      projectId,
      actorUserId: auth.id,
      note: nextLatestNote
    });
  }
  await markOperationalApprovalExecuted(
    client,
    auth,
    consumedApprovalRequestId,
    `Production action ${nextStage} executed for ${current.title}.`
  );

  return getProductionProjectDetail(client, auth, projectId);
}

export async function submitProductionProjectQaReview(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  input: {
    result: "passed" | "correction_needed" | "blocked";
    note: string | null;
    correctionReason: string | null;
    qaChecks: ProductionProjectQaCheckRecord[];
  }
): Promise<ProductionProjectMutationResult> {
  await assertProjectExists(client, auth.tenantId, projectId);
  const normalizedChecks = normalizeQaChecks(input.qaChecks);
  const checklistComplete = isQaChecklistComplete(normalizedChecks);
  const note = normalizeNullableText(input.note);
  const correctionReason = normalizeNullableText(input.correctionReason);

  if (input.result !== "passed" && !note && !correctionReason) {
    throw new ApiError(400, "QA reviews that fail or hold must include a note or correction reason.");
  }
  if (input.result === "passed" && !checklistComplete) {
    throw new ApiError(400, "QA cannot pass until all checklist items are cleared.");
  }

  const nextStage: ProductionProjectStage =
    input.result === "passed" ? "ready_to_release" : input.result === "blocked" ? "qa_hold" : "correction_needed";

  return updateProductionProject(client, auth, projectId, {
    stage: nextStage,
    latestNote: note ?? correctionReason ?? "QA review updated.",
    correctionReason: input.result === "correction_needed" ? correctionReason ?? note : null,
    qaChecks: normalizedChecks,
    qaChecklistComplete: checklistComplete
  });
}

export async function updateProductionProjectTask(
  client: PoolClient,
  auth: AuthUser,
  projectId: string,
  taskId: string,
  patch: UpdateProductionProjectTaskInput
): Promise<ProductionProjectDetail> {
  const project = await loadProjectRowById(client, auth.tenantId, projectId);
  if (!project) {
    throw new ApiError(404, "Production project not found");
  }

  const taskResult = await client.query<ProjectTaskRow>(
    `
      SELECT
        task.id,
        task.template_task_id,
        template_task.task_key,
        task.title,
        task.summary,
        task.status::text AS status,
        task.task_type::text AS task_type,
        task.owner_user_id,
        owner.full_name AS owner_name,
        task.due_date::text AS due_date,
        task.latest_note,
        task.required,
        task.sort_order,
        task.handoff_required,
        task.blocks_release,
        task.started_at::text AS started_at,
        task.completed_at::text AS completed_at,
        task.last_handoff_at::text AS last_handoff_at,
        task.last_handoff_to_user_id,
        handoff_owner.full_name AS last_handoff_to_name,
        COALESCE(dependency_summary.dependency_count, 0)::int AS dependency_count,
        COALESCE(dependency_summary.unresolved_dependency_count, 0)::int AS unresolved_dependency_count,
        dependency_summary.blocking_dependency_titles,
        dependency_summary.blocking_dependency_statuses,
        dependency_summary.blocking_dependency_ids,
        COALESCE(dependent_summary.dependent_task_count, 0)::int AS dependent_task_count
      FROM production_project_task task
      LEFT JOIN production_project_template_task template_task
        ON template_task.tenant_id = task.tenant_id
       AND template_task.id = task.template_task_id
      LEFT JOIN app_user owner
        ON owner.id = task.owner_user_id
      LEFT JOIN app_user handoff_owner
        ON handoff_owner.id = task.last_handoff_to_user_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS dependency_count,
          COUNT(*) FILTER (WHERE predecessor.status NOT IN ('done', 'skipped'))::int AS unresolved_dependency_count,
          ARRAY_AGG(predecessor.title ORDER BY predecessor.sort_order ASC, predecessor.created_at ASC)
            FILTER (WHERE predecessor.status NOT IN ('done', 'skipped')) AS blocking_dependency_titles,
          ARRAY_AGG(predecessor.status::text ORDER BY predecessor.sort_order ASC, predecessor.created_at ASC)
            FILTER (WHERE predecessor.status NOT IN ('done', 'skipped')) AS blocking_dependency_statuses,
          ARRAY_AGG(predecessor.id::text ORDER BY predecessor.sort_order ASC, predecessor.created_at ASC)
            FILTER (WHERE predecessor.status NOT IN ('done', 'skipped')) AS blocking_dependency_ids
        FROM production_project_task_dependency dependency
        JOIN production_project_task predecessor
          ON predecessor.tenant_id = dependency.tenant_id
         AND predecessor.id = dependency.depends_on_task_id
        WHERE dependency.tenant_id = task.tenant_id
          AND dependency.project_id = task.project_id
          AND dependency.task_id = task.id
      ) dependency_summary ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS dependent_task_count
        FROM production_project_task_dependency dependency
        WHERE dependency.tenant_id = task.tenant_id
          AND dependency.project_id = task.project_id
          AND dependency.depends_on_task_id = task.id
      ) dependent_summary ON true
      WHERE task.tenant_id = $1
        AND task.project_id = $2
        AND task.id = $3
      LIMIT 1
    `,
    [auth.tenantId, projectId, taskId]
  );
  const task = taskResult.rows[0];
  if (!task) {
    throw new ApiError(404, "Production project task not found");
  }

  const nextStatus = patch.status ?? task.status;
  const requestedOwnerUserId = Object.prototype.hasOwnProperty.call(patch, "ownerUserId") ? patch.ownerUserId ?? null : task.owner_user_id;
  const nextDueDate = Object.prototype.hasOwnProperty.call(patch, "dueDate") ? patch.dueDate ?? null : task.due_date;
  const nextLatestNote = Object.prototype.hasOwnProperty.call(patch, "latestNote")
    ? normalizeNullableText(patch.latestNote)
    : task.latest_note;
  const nextHandoffToUserId = Object.prototype.hasOwnProperty.call(patch, "handoffToUserId")
    ? patch.handoffToUserId ?? null
    : null;
  const nextHandoffNote = Object.prototype.hasOwnProperty.call(patch, "handoffNote")
    ? normalizeNullableText(patch.handoffNote)
    : nextLatestNote;
  const nextOwnerUserId = nextHandoffToUserId ?? requestedOwnerUserId;

  if (nextStatus === "skipped" && task.blocks_release) {
    throw new ApiError(400, `${task.title} is a required quality gate and cannot be skipped.`);
  }

  if ((nextStatus === "in_progress" || nextStatus === "done") && task.unresolved_dependency_count > 0) {
    const dependencySummary = (task.blocking_dependency_titles ?? []).join(", ");
    throw new ApiError(
      400,
      dependencySummary
        ? `${task.title} is still waiting on: ${dependencySummary}.`
        : `${task.title} still has open dependency work that must be completed first.`
    );
  }

  if (nextHandoffToUserId && nextHandoffToUserId === task.owner_user_id) {
    throw new ApiError(400, "Choose a different owner to record a handoff.");
  }

  await client.query(
    `
      UPDATE production_project_task
      SET
        status = $4::production_project_task_status,
        owner_user_id = $5::uuid,
        due_date = $6::date,
        latest_note = $7,
        started_at = CASE
          WHEN $4::production_project_task_status = 'in_progress' AND started_at IS NULL THEN now()
          ELSE started_at
        END,
        last_handoff_at = CASE
          WHEN $9::uuid IS NOT NULL THEN now()
          ELSE last_handoff_at
        END,
        last_handoff_to_user_id = CASE
          WHEN $9::uuid IS NOT NULL THEN $9::uuid
          ELSE last_handoff_to_user_id
        END,
        completed_at = CASE
          WHEN $4::production_project_task_status IN ('done', 'skipped') AND status NOT IN ('done', 'skipped') THEN now()
          WHEN $4::production_project_task_status NOT IN ('done', 'skipped') THEN NULL
          ELSE completed_at
        END,
        completed_by_user_id = CASE
          WHEN $4::production_project_task_status IN ('done', 'skipped') AND status NOT IN ('done', 'skipped') THEN $3
          WHEN $4::production_project_task_status NOT IN ('done', 'skipped') THEN NULL
          ELSE completed_by_user_id
        END,
        updated_by_user_id = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $8
    `,
    [auth.tenantId, projectId, auth.id, nextStatus, nextOwnerUserId, nextDueDate, nextLatestNote, taskId, nextHandoffToUserId]
  );

  const changeLabels: string[] = [];
  if (task.status !== nextStatus) {
    changeLabels.push(`status ${humanizeValue(task.status)} -> ${humanizeValue(nextStatus)}`);
  }
  if (task.owner_user_id !== nextOwnerUserId) {
    changeLabels.push(nextOwnerUserId ? "owner assigned" : "owner cleared");
  }
  if ((task.due_date ?? null) !== nextDueDate) {
    changeLabels.push(nextDueDate ? "due date updated" : "due date cleared");
  }
  if ((task.latest_note ?? null) !== nextLatestNote && nextLatestNote) {
    changeLabels.push(nextStatus === "done" ? "resolution note added" : "note added");
  }
  if (nextHandoffToUserId) {
    changeLabels.push("handoff recorded");
  }

  if (nextHandoffToUserId) {
    await client.query(
      `
        INSERT INTO production_project_task_handoff (
          tenant_id,
          project_id,
          task_id,
          from_user_id,
          to_user_id,
          note,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::uuid)
      `,
      [auth.tenantId, projectId, taskId, task.owner_user_id, nextHandoffToUserId, nextHandoffNote, auth.id]
    );
  }

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    actorUserId: auth.id,
    eventType: "project.task_updated",
    summary: changeLabels.length ? `${task.title}: ${changeLabels.join(" | ")}` : `${task.title} updated`,
    note: nextLatestNote,
    metadata: {
      task_id: taskId,
      previous_status: task.status,
      status: nextStatus,
      owner_user_id: nextOwnerUserId,
      due_date: nextDueDate
    }
  });

  await recordProductionProjectTaskEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    taskId,
    actorUserId: auth.id,
    eventType: nextHandoffToUserId ? "task.handoff" : "task.updated",
    summary: nextHandoffToUserId
      ? `${task.title} handed off${nextOwnerUserId ? " to the next owner" : ""}`
      : changeLabels.length
        ? `${task.title}: ${changeLabels.join(" | ")}`
        : `${task.title} updated`,
    note: nextHandoffToUserId ? nextHandoffNote : nextLatestNote,
    metadata: {
      previous_status: task.status,
      status: nextStatus,
      previous_owner_user_id: task.owner_user_id,
      owner_user_id: nextOwnerUserId,
      handoff_to_user_id: nextHandoffToUserId,
      due_date: nextDueDate
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project_task.updated",
    entityType: "production_project_task",
    entityId: taskId,
    metadata: {
      project_id: projectId,
      title: task.title
    },
    previousValues: {
      status: task.status,
      owner_user_id: task.owner_user_id,
      due_date: task.due_date,
      latest_note: task.latest_note
    },
    newValues: {
      status: nextStatus,
      owner_user_id: nextOwnerUserId,
      due_date: nextDueDate,
      latest_note: nextLatestNote
    }
  });

  if (nextStatus === "done" && project.status === "new") {
    await client.query(
      `
        UPDATE production_project
        SET status = 'active', updated_by_user_id = $3, updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'new'
      `,
      [auth.tenantId, projectId, auth.id]
    );
  }

  return getProductionProjectDetail(client, auth, projectId);
}

export async function ensureTriggeredProductionProject(
  client: PoolClient,
  auth: AuthUser,
  input: TriggeredProjectInput
): Promise<{ project: ProductionProjectDetail; created: boolean }> {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM production_project
      WHERE tenant_id = $1
        AND source_event_key = $2
      LIMIT 1
    `,
    [auth.tenantId, input.sourceEventKey]
  );
  if (existing.rows[0]) {
    return {
      project: await getProductionProjectDetail(client, auth, existing.rows[0].id),
      created: false
    };
  }

  const triggerRule = await loadTriggerRule(client, auth.tenantId, input.triggerKey);
  const linkedContext = await resolveLinkedContext(client, auth.tenantId, {
    linkedOrganizationId: input.linkedOrganizationId ?? null,
    linkedLocationId: input.linkedLocationId ?? null,
    linkedShootId: input.linkedShootId ?? null
  });
  const resolvedJobType = input.jobType ?? triggerRule.template_job_type;
  const resolvedCategory = input.category ?? triggerRule.template_category;
  const resolvedStage = input.stage ?? triggerRule.template_default_stage;
  const reviewDefaults =
    input.jobType != null || input.category != null || input.stage != null
      ? deriveReviewRequirements(resolvedCategory, null)
      : {
          peerReviewRequired: triggerRule.template_peer_review_required,
          finalQcRequired: triggerRule.template_final_qc_required
        };
  const dueDate = input.dueDate ?? addDays(input.anchorDate, triggerRule.default_due_offset_days);
  const followUpDate =
    input.followUpDate ??
    (triggerRule.default_follow_up_offset_days == null ? null : addDays(input.anchorDate, triggerRule.default_follow_up_offset_days));

  const insertResult = await client.query<{ id: string }>(
    `
      INSERT INTO production_project (
        tenant_id,
        template_id,
        trigger_rule_id,
        source_type,
        source_event_key,
        source_trigger_key,
        source_trigger_label,
        created_reason,
        title,
        summary,
        status,
        job_type,
        category,
        stage,
        priority,
        owner_user_id,
        peer_review_required,
        final_qc_required,
        peer_reviewer_user_id,
        final_qc_reviewer_user_id,
        due_date,
        follow_up_date,
        latest_note,
        linked_organization_id,
        linked_location_id,
        linked_shoot_id,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,$2::uuid,$3::uuid,'trigger',$4,$5,$6,$7,$8,$9,$10::production_project_status,$11::production_project_job_type,$12::production_project_category,$13::production_project_stage,$14::production_project_priority,$15::uuid,$16,$17,$18::uuid,$19::uuid,$20::date,$21::date,$22,$23::uuid,$24::uuid,$25::uuid,$26::uuid,$26::uuid
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      triggerRule.template_id,
      triggerRule.id,
      input.sourceEventKey,
      input.triggerKey,
      triggerRule.name,
      input.createdReason,
      input.title.trim(),
      normalizeNullableText(input.summary),
      deriveLegacyStatusForStage(resolvedStage),
      resolvedJobType,
      resolvedCategory,
      resolvedStage,
      input.priority ?? triggerRule.template_default_priority,
      input.ownerUserId ?? null,
      reviewDefaults.peerReviewRequired,
      reviewDefaults.finalQcRequired,
      null,
      null,
      dueDate,
      followUpDate,
      normalizeNullableText(input.latestNote),
      linkedContext.organizationId,
      linkedContext.locationId,
      linkedContext.shootId,
      auth.id
    ]
  );

  const projectId = insertResult.rows[0].id;
  await createProjectTasksFromTemplate(client, auth.tenantId, projectId, triggerRule.template_id, input.anchorDate, auth.id);

  await recordProductionProjectEvent(client, {
    tenantId: auth.tenantId,
    projectId,
    actorUserId: auth.id,
    eventType: "project.created_from_trigger",
    summary: triggerRule.name,
    note: normalizeNullableText(input.latestNote),
    metadata: {
      trigger_key: input.triggerKey,
      source_event_key: input.sourceEventKey,
      job_type: resolvedJobType,
      category: resolvedCategory,
      stage: resolvedStage,
      linked_organization_id: linkedContext.organizationId,
      linked_location_id: linkedContext.locationId,
      linked_shoot_id: linkedContext.shootId
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_project.created_trigger",
    entityType: "production_project",
    entityId: projectId,
    metadata: {
      trigger_key: input.triggerKey,
      source_event_key: input.sourceEventKey,
      job_type: resolvedJobType,
      category: resolvedCategory,
      stage: resolvedStage,
      linked_organization_id: linkedContext.organizationId,
      linked_location_id: linkedContext.locationId,
      linked_shoot_id: linkedContext.shootId
    },
    newValues: {
      title: input.title.trim(),
      status: deriveLegacyStatusForStage(resolvedStage),
      job_type: resolvedJobType,
      category: resolvedCategory,
      stage: resolvedStage,
      priority: input.priority ?? triggerRule.template_default_priority,
      due_date: dueDate,
      follow_up_date: followUpDate,
      owner_user_id: input.ownerUserId ?? null
    }
  });

  return {
    project: await getProductionProjectDetail(client, auth, projectId),
    created: true
  };
}

function resolveShootCompletionTriggerKey(input: { shootDate: string; shootType?: string | null }) {
  if ((input.shootType ?? "").toLowerCase() === "sports") {
    return "shoot_completed_post_production_sports";
  }
  const season = deriveProductionWorkflowSeasonFromDate(input.shootDate);
  if (season === "spring") {
    return "shoot_completed_post_production_schools_spring";
  }
  if (season === "all_year") {
    return "shoot_completed_post_production";
  }
  return "shoot_completed_post_production_schools_fall";
}

function deriveProductionWorkflowSeasonFromDate(date: string): ProductionProjectWorkflowSeason {
  const directMatch = String(date ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  const matchedMonth = directMatch ? Number.parseInt(directMatch[2], 10) : Number.NaN;
  const parsedDate = Number.isFinite(matchedMonth) ? null : new Date(String(date ?? ""));
  const parsedMonth = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getUTCMonth() + 1 : Number.NaN;
  const month = Number.isFinite(matchedMonth) ? matchedMonth : parsedMonth;
  if (Number.isFinite(month) && month >= 1 && month <= 6) {
    return "spring";
  }
  if (Number.isFinite(month) && month >= 7 && month <= 12) {
    return "fall";
  }
  return "all_year";
}

export async function triggerProductionProjectFromShootCompletion(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    shootCode: string | null;
    shootTitle: string;
    shootDate: string;
    organizationId: string | null;
    locationId: string | null;
    shootType?: string | null;
    ownerUserId?: string | null;
  }
) {
  const preferredTriggerKey = resolveShootCompletionTriggerKey(input);
  const triggerInput: Omit<TriggeredProjectInput, "triggerKey"> = {
    sourceEventKey: `shoot_completed_post_production:${input.shootId}`,
    title: `${input.shootCode ?? "Shoot"} production wrap`,
    summary: `Production wrap opened because ${input.shootCode ?? input.shootTitle} moved into post-production.`,
    createdReason: `${input.shootCode ?? input.shootTitle} entered POST-PRODUCTION and the production wrap checklist should start.`,
    anchorDate: input.shootDate,
    ownerUserId: input.ownerUserId ?? null,
    jobType: input.shootType === "sports" ? "sports_production" : null,
    linkedOrganizationId: input.organizationId ?? null,
    linkedLocationId: input.locationId ?? null,
    linkedShootId: input.shootId
  };

  try {
    return await ensureTriggeredProductionProject(client, auth, {
      ...triggerInput,
      triggerKey: preferredTriggerKey
    });
  } catch (error) {
    if (
      preferredTriggerKey !== "shoot_completed_post_production" &&
      error instanceof ApiError &&
      error.status === 404
    ) {
      return ensureTriggeredProductionProject(client, auth, {
        ...triggerInput,
        triggerKey: "shoot_completed_post_production"
      });
    }
    throw error;
  }
}

export async function triggerProductionProjectFromPostShootIssue(
  client: PoolClient,
  auth: AuthUser,
  input: {
    evaluationId: string;
    shootId: string;
    shootCode: string | null;
    shootTitle: string;
    shootDate: string;
    organizationId: string | null;
    locationId: string | null;
    ownerUserId?: string | null;
    issueSummary: string;
  }
) {
  return ensureTriggeredProductionProject(client, auth, {
    triggerKey: "post_shoot_issue_flagged",
    sourceEventKey: `post_shoot_issue_flagged:${input.evaluationId}`,
    title: `${input.shootCode ?? "Shoot"} issue remediation`,
    summary: input.issueSummary,
    createdReason: `${input.shootCode ?? input.shootTitle} was submitted with issue follow-up and needs production remediation.`,
    anchorDate: input.shootDate,
    ownerUserId: input.ownerUserId ?? null,
    priority: "critical",
    linkedOrganizationId: input.organizationId ?? null,
    linkedLocationId: input.locationId ?? null,
    linkedShootId: input.shootId
  });
}

export async function triggerProductionProjectFromResourceIssue(
  client: PoolClient,
  auth: AuthUser,
  input: {
    resourceUploadId: string;
    category: string;
    fileName: string;
    note?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    shootId?: string | null;
    anchorDate?: string | null;
  }
) {
  return ensureTriggeredProductionProject(client, auth, {
    triggerKey: "resource_issue_follow_up",
    sourceEventKey: `resource_issue_follow_up:${input.resourceUploadId}`,
    title: `${humanizeValue(input.category)} follow-up`,
    summary: input.note?.trim() || `${input.fileName} created a production follow-up from uploaded issue evidence.`,
    createdReason: `${humanizeValue(input.category)} media was uploaded and now needs production follow-up.`,
    anchorDate: input.anchorDate ?? getLocalDateString(),
    ownerUserId: auth.id,
    priority: "high",
    linkedOrganizationId: input.organizationId ?? null,
    linkedLocationId: input.locationId ?? null,
    linkedShootId: input.shootId ?? null,
    latestNote: input.note ?? null
  });
}

export async function getProductionProjectManagerQueues(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string }
) {
  const rows = await loadProjectRows(client, auth.tenantId, {
    anchorDate: options.anchorDate,
    status: "open"
  });
  const projects = rows.map((row) => toProjectSummaryRecord(row, options.anchorDate));

  const visibleProjects = projects.filter((project) => !isFutureSnoozed(project.snoozed_until, options.anchorDate));
  const needsProjectSetup = visibleProjects
    .filter(
      (project) =>
        project.stage === "intake_pending" ||
        project.stage === "ready_for_production" ||
        (!project.owner_user_id && project.stage !== "blocked")
    )
    .sort((left, right) => compareProjectQueueOrder(left, right, options.anchorDate))
    .slice(0, 8)
    .map((project) => toManagerQueueItem(project, "needs_project_setup", options.anchorDate));
  const needsProjectFollowUp = visibleProjects
    .filter(
      (project) =>
        project.stage === "blocked" ||
        project.stage === "ready_for_qa" ||
        project.stage === "in_qa_review" ||
        project.stage === "correction_needed" ||
        project.stage === "ready_to_release"
    )
    .sort((left, right) => compareProjectQueueOrder(left, right, options.anchorDate))
    .slice(0, 8)
    .map((project) => toManagerQueueItem(project, "needs_project_follow_up", options.anchorDate));
  const overdueProjectTasks = visibleProjects
    .filter((project) => project.overdue || project.overdue_task_count > 0)
    .sort((left, right) => compareProjectQueueOrder(left, right, options.anchorDate))
    .slice(0, 8)
    .map((project) => toManagerQueueItem(project, "overdue_project_tasks", options.anchorDate));

  return {
    needs_project_setup: needsProjectSetup,
    needs_project_follow_up: needsProjectFollowUp,
    overdue_project_tasks: overdueProjectTasks
  };
}

async function loadProjectRows(
  client: PoolClient,
  tenantId: string,
  options: ProjectListOptions
) {
  const values: unknown[] = [tenantId, options.anchorDate];
  let where = "project.tenant_id = $1";

  if ((options.status ?? "open") === "open") {
    where += " AND project.status NOT IN ('completed', 'canceled')";
  } else if (options.status === "completed") {
    where += " AND project.status IN ('completed', 'canceled')";
  }

  if (options.search?.trim()) {
    values.push(`%${options.search.trim().toLowerCase()}%`);
    where += ` AND (
      lower(project.title) LIKE $${values.length}
      OR lower(COALESCE(project.summary, '')) LIKE $${values.length}
      OR lower(COALESCE(org.display_name, '')) LIKE $${values.length}
      OR lower(COALESCE(location.name, '')) LIKE $${values.length}
      OR lower(COALESCE(shoot.shoot_code, '')) LIKE $${values.length}
      OR lower(COALESCE(shoot.title, '')) LIKE $${values.length}
    )`;
  }

  if (options.ownerUserId === "unassigned") {
    where += " AND project.owner_user_id IS NULL";
  } else if (options.ownerUserId) {
    values.push(options.ownerUserId);
    where += ` AND project.owner_user_id = $${values.length}::uuid`;
  }

  if (options.priority) {
    values.push(options.priority);
    where += ` AND project.priority = $${values.length}::production_project_priority`;
  }

  if (options.templateId) {
    values.push(options.templateId);
    where += ` AND project.template_id = $${values.length}::uuid`;
  }

  if (options.sourceType) {
    values.push(options.sourceType);
    where += ` AND project.source_type = $${values.length}::production_project_source_type`;
  }

  if (options.sourceTriggerKey?.trim()) {
    values.push(options.sourceTriggerKey.trim());
    where += ` AND project.source_trigger_key = $${values.length}`;
  }

  if (options.category) {
    values.push(options.category);
    where += ` AND project.category = $${values.length}::production_project_category`;
  }

  if (options.jobType) {
    values.push(options.jobType);
    where += ` AND project.job_type = $${values.length}::production_project_job_type`;
  }

  if (options.stage) {
    values.push(options.stage);
    where += ` AND project.stage = $${values.length}::production_project_stage`;
  }

  if (options.linkedOrganizationId) {
    values.push(options.linkedOrganizationId);
    where += ` AND project.linked_organization_id = $${values.length}::uuid`;
  }

  if (options.linkedLocationId) {
    values.push(options.linkedLocationId);
    where += ` AND project.linked_location_id = $${values.length}::uuid`;
  }

  if (options.linkedShootId) {
    values.push(options.linkedShootId);
    where += ` AND project.linked_shoot_id = $${values.length}::uuid`;
  }

  if (options.dueState === "overdue") {
    where += " AND COALESCE(project.follow_up_date, project.due_date) < $2::date";
  } else if (options.dueState === "due_today") {
    where += " AND COALESCE(project.follow_up_date, project.due_date) = $2::date";
  } else if (options.dueState === "upcoming") {
    where += " AND COALESCE(project.follow_up_date, project.due_date) > $2::date";
  } else if (options.dueState === "unscheduled") {
    where += " AND COALESCE(project.follow_up_date, project.due_date) IS NULL";
  }

  const result = await client.query<ProjectRow>(
    `
      SELECT
        project.id,
        project.template_id,
        template.template_key,
        template.name AS template_name,
        template.workflow_family AS template_workflow_family,
        template.workflow_mode AS template_workflow_mode,
        template.season_key AS template_season_key,
        project.job_type::text AS job_type,
        project.category::text AS category,
        template.category::text AS template_category,
        template.default_stage::text AS template_default_stage,
        project.stage::text AS stage,
        project.qa_state::text AS qa_state,
        project.release_state::text AS release_state,
        project.previous_active_stage::text AS previous_active_stage,
        project.correction_reason,
        project.title,
        project.summary,
        project.status::text AS status,
        project.priority::text AS priority,
        project.owner_user_id,
        owner.full_name AS owner_name,
        project.peer_review_required,
        project.final_qc_required,
        project.peer_reviewer_user_id,
        peer_reviewer.full_name AS peer_reviewer_name,
        project.final_qc_reviewer_user_id,
        final_qc_reviewer.full_name AS final_qc_reviewer_name,
        project.due_date::text AS due_date,
        project.follow_up_date::text AS follow_up_date,
        project.snoozed_until::text AS snoozed_until,
        project.latest_note,
        project.source_type::text AS source_type,
        project.source_trigger_key,
        project.source_trigger_label,
        project.created_reason,
        project.linked_organization_id,
        org.display_name AS linked_organization_name,
        project.linked_location_id,
        location.name AS linked_location_name,
        project.linked_shoot_id,
        shoot.shoot_date::text AS linked_shoot_date,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        shoot.shoot_type AS linked_shoot_type,
        shoot.projected_students AS shoot_projected_students,
        shoot.camera_station_count AS shoot_camera_station_count,
        COALESCE(shoot_template.template_photographer_count, 0)::int AS shoot_template_photographer_count,
        shoot.estimated_drive_minutes AS shoot_estimated_drive_minutes,
        shoot.first_year_customer_flag AS shoot_first_year_customer_flag,
        shoot.flagship_priority_account_flag AS shoot_flagship_priority_account_flag,
        shoot.strategic_district_importance AS shoot_strategic_district_importance,
        shoot.revenue_potential_score AS shoot_revenue_potential_score,
        shoot.account_growth_importance_score AS shoot_account_growth_importance_score,
        shoot.complexity_score AS shoot_complexity_score,
        shoot.customer_history_risk_score AS shoot_customer_history_risk_score,
        shoot.multi_team_coordination AS shoot_multi_team_coordination,
        shoot.weather_travel_risk_flag AS shoot_weather_travel_risk_flag,
        shoot.manual_leadership_boost AS shoot_manual_leadership_boost,
        shoot.importance_override_tier::text AS shoot_importance_override_tier,
        shoot.importance_override_reason AS shoot_importance_override_reason,
        GREATEST(COALESCE(shoot_staff.minimum_staffing_count, 0) - COALESCE(shoot_staff.assigned_staff_count, 0), 0)::int AS shoot_missing_staffing_coverage_count,
        (
          (CASE WHEN shoot.arrival_time IS NULL THEN 1 ELSE 0 END) +
          (CASE WHEN shoot.start_time IS NULL THEN 1 ELSE 0 END) +
          (CASE WHEN shoot.end_time_est IS NULL THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(location.name, '') = '' AND COALESCE(location.address, '') = '' THEN 1 ELSE 0 END) +
          (CASE WHEN shoot.primary_contact_id IS NULL THEN 1 ELSE 0 END) +
          (
            CASE
              WHEN (COALESCE(shoot.additional_products_flag, false) OR COALESCE(shoot.special_equipment_flag, false))
                   AND COALESCE(NULLIF(trim(shoot.setup_notes), ''), NULLIF(trim(shoot.day_of_notes), '')) IS NULL
                THEN 1
              ELSE 0
            END
          )
        )::int AS shoot_missing_required_prep_count,
        current_blocker.blocker_id,
        current_blocker.blocker_type,
        current_blocker.blocker_owner_user_id,
        current_blocker.blocker_owner_name,
        current_blocker.blocker_reason,
        current_blocker.blocker_dependency,
        current_blocker.blocker_expected_resolution_date,
        current_blocker.blocker_notes,
        current_blocker.blocker_created_at,
        COALESCE(blocker_summary.blocker_count, 0)::int AS blocker_count,
        COALESCE(task_summary.open_task_count, 0)::int AS open_task_count,
        COALESCE(task_summary.open_required_task_count, 0)::int AS open_required_task_count,
        COALESCE(task_summary.completed_task_count, 0)::int AS completed_task_count,
        COALESCE(task_summary.blocked_task_count, 0)::int AS blocked_task_count,
        COALESCE(task_summary.overdue_task_count, 0)::int AS overdue_task_count,
        COALESCE(task_summary.pending_peer_review, false) AS pending_peer_review,
        COALESCE(task_summary.pending_final_qc, false) AS pending_final_qc,
        COALESCE(task_summary.pending_release_tasks, 0)::int AS pending_release_tasks,
        buddy_workflow.buddy_status,
        COALESCE(buddy_workflow.duplicate_handling_required, false) AS buddy_duplicate_handling_required,
        buddy_workflow.cleanup_completed_at AS buddy_cleanup_completed_at,
        COALESCE(buddy_workflow.unresolved_group_count, 0)::int AS buddy_unresolved_group_count,
        vt_workflow.vt_status,
        COALESCE(vt_workflow.attributes_validated, false) AS vt_attributes_validated,
        COALESCE(vt_workflow.coach_tags_validated, false) AS vt_coach_tags_validated,
        COALESCE(vt_workflow.split_by_group_validated, false) AS vt_split_by_group_validated,
        COALESCE(vt_workflow.ambiguous_match_required, false) AS vt_ambiguous_match_required,
        vt_workflow.ambiguous_match_resolved_at AS vt_ambiguous_match_resolved_at,
        current_step.current_step_task_id,
        current_step.current_step_task_key,
        current_step.current_step_title,
        current_step.current_step_task_type,
        current_step.current_step_sort_order,
        project.created_at::text AS created_at,
        project.updated_at::text AS updated_at,
        project.completed_at::text AS completed_at
      FROM production_project project
      LEFT JOIN production_project_template template
        ON template.tenant_id = project.tenant_id
       AND template.id = project.template_id
      LEFT JOIN app_user owner
        ON owner.id = project.owner_user_id
      LEFT JOIN app_user peer_reviewer
        ON peer_reviewer.id = project.peer_reviewer_user_id
      LEFT JOIN app_user final_qc_reviewer
        ON final_qc_reviewer.id = project.final_qc_reviewer_user_id
      LEFT JOIN organization org
        ON org.tenant_id = project.tenant_id
       AND org.id = project.linked_organization_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = project.tenant_id
       AND location.id = project.linked_location_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = project.tenant_id
       AND shoot.id = project.linked_shoot_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(str.headcount), 0)::int AS template_photographer_count
        FROM staffing_template_role str
        WHERE str.tenant_id = shoot.tenant_id
          AND str.staffing_template_id = shoot.staffing_template_id
          AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
      ) shoot_template ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(ssr.minimum_count), 0)::int AS minimum_staffing_count,
          COUNT(ws.id)::int AS assigned_staff_count
        FROM shoot_staffing_requirement ssr
        LEFT JOIN work_shift ws
          ON ws.tenant_id = ssr.tenant_id
         AND ws.staffing_requirement_id = ssr.id
         AND ws.cancelled_at IS NULL
         AND ws.status IN ('draft', 'published', 'completed')
        WHERE ssr.tenant_id = project.tenant_id
          AND ssr.shoot_id = project.linked_shoot_id
      ) shoot_staff ON true
      LEFT JOIN LATERAL (
        SELECT
          blocker.id AS blocker_id,
          blocker.blocker_type::text AS blocker_type,
          blocker.blocker_owner_user_id,
          blocker_owner.full_name AS blocker_owner_name,
          blocker.reason AS blocker_reason,
          blocker.dependency AS blocker_dependency,
          blocker.expected_resolution_date::text AS blocker_expected_resolution_date,
          blocker.notes AS blocker_notes,
          blocker.created_at::text AS blocker_created_at
        FROM production_project_blocker blocker
        LEFT JOIN app_user blocker_owner
          ON blocker_owner.id = blocker.blocker_owner_user_id
        WHERE blocker.tenant_id = project.tenant_id
          AND blocker.project_id = project.id
          AND blocker.resolved_at IS NULL
        ORDER BY blocker.created_at DESC
        LIMIT 1
      ) current_blocker ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS blocker_count
        FROM production_project_blocker blocker
        WHERE blocker.tenant_id = project.tenant_id
          AND blocker.project_id = project.id
          AND blocker.resolved_at IS NULL
      ) blocker_summary ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE task.status NOT IN ('done', 'skipped')) AS open_task_count,
          COUNT(*) FILTER (WHERE task.required AND task.status NOT IN ('done', 'skipped')) AS open_required_task_count,
          COUNT(*) FILTER (WHERE task.status = 'done') AS completed_task_count,
          COUNT(*) FILTER (
            WHERE task.status = 'blocked'
              OR EXISTS (
                SELECT 1
                FROM production_project_task_dependency dependency
                JOIN production_project_task predecessor
                  ON predecessor.tenant_id = dependency.tenant_id
                 AND predecessor.project_id = dependency.project_id
                 AND predecessor.id = dependency.depends_on_task_id
                WHERE dependency.tenant_id = task.tenant_id
                  AND dependency.project_id = task.project_id
                  AND dependency.task_id = task.id
                  AND predecessor.status NOT IN ('done', 'skipped')
              )
          ) AS blocked_task_count,
          COUNT(*) FILTER (
            WHERE task.status NOT IN ('done', 'skipped')
              AND task.due_date IS NOT NULL
              AND task.due_date < $2::date
          ) AS overdue_task_count,
          BOOL_OR(task.task_type = 'peer_review' AND task.status <> 'done') AS pending_peer_review,
          BOOL_OR(task.task_type = 'final_qc' AND task.status <> 'done') AS pending_final_qc,
          COUNT(*) FILTER (
            WHERE task.task_type = 'release'
              AND task.status NOT IN ('done', 'skipped')
          ) AS pending_release_tasks
        FROM production_project_task task
        WHERE task.tenant_id = project.tenant_id
          AND task.project_id = project.id
      ) task_summary ON true
      LEFT JOIN LATERAL (
        SELECT
          workflow.status::text AS buddy_status,
          workflow.duplicate_handling_required,
          workflow.cleanup_completed_at::text AS cleanup_completed_at,
          workflow.unresolved_group_count
        FROM production_project_buddy_workflow workflow
        WHERE workflow.tenant_id = project.tenant_id
          AND workflow.project_id = project.id
        LIMIT 1
      ) buddy_workflow ON true
      LEFT JOIN LATERAL (
        SELECT
          workflow.status::text AS vt_status,
          workflow.attributes_validated,
          workflow.coach_tags_validated,
          workflow.split_by_group_validated,
          workflow.ambiguous_match_required,
          workflow.ambiguous_match_resolved_at::text AS ambiguous_match_resolved_at
        FROM production_project_virtual_team_workflow workflow
        WHERE workflow.tenant_id = project.tenant_id
          AND workflow.project_id = project.id
        LIMIT 1
      ) vt_workflow ON true
      LEFT JOIN LATERAL (
        SELECT
          task.id::text AS current_step_task_id,
          COALESCE(template_task.task_key, task.id::text) AS current_step_task_key,
          task.title AS current_step_title,
          task.task_type::text AS current_step_task_type,
          task.sort_order::int AS current_step_sort_order
        FROM production_project_task task
        LEFT JOIN production_project_template_task template_task
          ON template_task.tenant_id = task.tenant_id
         AND template_task.id = task.template_task_id
        WHERE task.tenant_id = project.tenant_id
          AND task.project_id = project.id
          AND task.status NOT IN ('done', 'skipped')
        ORDER BY
          task.sort_order ASC,
          CASE task.status
            WHEN 'blocked' THEN 0
            WHEN 'in_progress' THEN 1
            ELSE 2
          END,
          task.due_date ASC NULLS LAST,
          task.created_at ASC
        LIMIT 1
      ) current_step ON true
      WHERE ${where}
      ORDER BY
        CASE project.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        COALESCE(project.follow_up_date, project.due_date) ASC NULLS LAST,
        project.created_at DESC
    `,
    values
  );

  return result.rows;
}

async function loadProjectRowById(client: PoolClient, tenantId: string, projectId: string) {
  const rows = await client.query<ProjectRow>(
    `
      SELECT
        project.id,
        project.template_id,
        template.template_key,
        template.name AS template_name,
        template.workflow_family AS template_workflow_family,
        template.workflow_mode AS template_workflow_mode,
        template.season_key AS template_season_key,
        project.job_type::text AS job_type,
        project.category::text AS category,
        template.category::text AS template_category,
        template.default_stage::text AS template_default_stage,
        project.stage::text AS stage,
        project.qa_state::text AS qa_state,
        project.release_state::text AS release_state,
        project.previous_active_stage::text AS previous_active_stage,
        project.correction_reason,
        project.title,
        project.summary,
        project.status::text AS status,
        project.priority::text AS priority,
        project.owner_user_id,
        owner.full_name AS owner_name,
        project.peer_review_required,
        project.final_qc_required,
        project.peer_reviewer_user_id,
        peer_reviewer.full_name AS peer_reviewer_name,
        project.final_qc_reviewer_user_id,
        final_qc_reviewer.full_name AS final_qc_reviewer_name,
        project.due_date::text AS due_date,
        project.follow_up_date::text AS follow_up_date,
        project.snoozed_until::text AS snoozed_until,
        project.latest_note,
        project.source_type::text AS source_type,
        project.source_trigger_key,
        project.source_trigger_label,
        project.created_reason,
        project.linked_organization_id,
        org.display_name AS linked_organization_name,
        project.linked_location_id,
        location.name AS linked_location_name,
        project.linked_shoot_id,
        shoot.shoot_date::text AS linked_shoot_date,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        shoot.shoot_type AS linked_shoot_type,
        shoot.projected_students AS shoot_projected_students,
        shoot.camera_station_count AS shoot_camera_station_count,
        COALESCE(shoot_template.template_photographer_count, 0)::int AS shoot_template_photographer_count,
        shoot.estimated_drive_minutes AS shoot_estimated_drive_minutes,
        shoot.first_year_customer_flag AS shoot_first_year_customer_flag,
        shoot.flagship_priority_account_flag AS shoot_flagship_priority_account_flag,
        shoot.strategic_district_importance AS shoot_strategic_district_importance,
        shoot.revenue_potential_score AS shoot_revenue_potential_score,
        shoot.account_growth_importance_score AS shoot_account_growth_importance_score,
        shoot.complexity_score AS shoot_complexity_score,
        shoot.customer_history_risk_score AS shoot_customer_history_risk_score,
        shoot.multi_team_coordination AS shoot_multi_team_coordination,
        shoot.weather_travel_risk_flag AS shoot_weather_travel_risk_flag,
        shoot.manual_leadership_boost AS shoot_manual_leadership_boost,
        shoot.importance_override_tier::text AS shoot_importance_override_tier,
        shoot.importance_override_reason AS shoot_importance_override_reason,
        GREATEST(COALESCE(shoot_staff.minimum_staffing_count, 0) - COALESCE(shoot_staff.assigned_staff_count, 0), 0)::int AS shoot_missing_staffing_coverage_count,
        (
          (CASE WHEN shoot.arrival_time IS NULL THEN 1 ELSE 0 END) +
          (CASE WHEN shoot.start_time IS NULL THEN 1 ELSE 0 END) +
          (CASE WHEN shoot.end_time_est IS NULL THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(location.name, '') = '' AND COALESCE(location.address, '') = '' THEN 1 ELSE 0 END) +
          (CASE WHEN shoot.primary_contact_id IS NULL THEN 1 ELSE 0 END) +
          (
            CASE
              WHEN (COALESCE(shoot.additional_products_flag, false) OR COALESCE(shoot.special_equipment_flag, false))
                   AND COALESCE(NULLIF(trim(shoot.setup_notes), ''), NULLIF(trim(shoot.day_of_notes), '')) IS NULL
                THEN 1
              ELSE 0
            END
          )
        )::int AS shoot_missing_required_prep_count,
        current_blocker.blocker_id,
        current_blocker.blocker_type,
        current_blocker.blocker_owner_user_id,
        current_blocker.blocker_owner_name,
        current_blocker.blocker_reason,
        current_blocker.blocker_dependency,
        current_blocker.blocker_expected_resolution_date,
        current_blocker.blocker_notes,
        current_blocker.blocker_created_at,
        COALESCE(blocker_summary.blocker_count, 0)::int AS blocker_count,
        COALESCE(task_summary.open_task_count, 0)::int AS open_task_count,
        COALESCE(task_summary.open_required_task_count, 0)::int AS open_required_task_count,
        COALESCE(task_summary.completed_task_count, 0)::int AS completed_task_count,
        COALESCE(task_summary.blocked_task_count, 0)::int AS blocked_task_count,
        COALESCE(task_summary.overdue_task_count, 0)::int AS overdue_task_count,
        COALESCE(task_summary.pending_peer_review, false) AS pending_peer_review,
        COALESCE(task_summary.pending_final_qc, false) AS pending_final_qc,
        COALESCE(task_summary.pending_release_tasks, 0)::int AS pending_release_tasks,
        buddy_workflow.buddy_status,
        COALESCE(buddy_workflow.duplicate_handling_required, false) AS buddy_duplicate_handling_required,
        buddy_workflow.cleanup_completed_at AS buddy_cleanup_completed_at,
        COALESCE(buddy_workflow.unresolved_group_count, 0)::int AS buddy_unresolved_group_count,
        vt_workflow.vt_status,
        COALESCE(vt_workflow.attributes_validated, false) AS vt_attributes_validated,
        COALESCE(vt_workflow.coach_tags_validated, false) AS vt_coach_tags_validated,
        COALESCE(vt_workflow.split_by_group_validated, false) AS vt_split_by_group_validated,
        COALESCE(vt_workflow.ambiguous_match_required, false) AS vt_ambiguous_match_required,
        vt_workflow.ambiguous_match_resolved_at AS vt_ambiguous_match_resolved_at,
        current_step.current_step_task_id,
        current_step.current_step_task_key,
        current_step.current_step_title,
        current_step.current_step_task_type,
        current_step.current_step_sort_order,
        project.created_at::text AS created_at,
        project.updated_at::text AS updated_at,
        project.completed_at::text AS completed_at
      FROM production_project project
      LEFT JOIN production_project_template template
        ON template.tenant_id = project.tenant_id
       AND template.id = project.template_id
      LEFT JOIN app_user owner
        ON owner.id = project.owner_user_id
      LEFT JOIN app_user peer_reviewer
        ON peer_reviewer.id = project.peer_reviewer_user_id
      LEFT JOIN app_user final_qc_reviewer
        ON final_qc_reviewer.id = project.final_qc_reviewer_user_id
      LEFT JOIN organization org
        ON org.tenant_id = project.tenant_id
       AND org.id = project.linked_organization_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = project.tenant_id
       AND location.id = project.linked_location_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = project.tenant_id
       AND shoot.id = project.linked_shoot_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(str.headcount), 0)::int AS template_photographer_count
        FROM staffing_template_role str
        WHERE str.tenant_id = shoot.tenant_id
          AND str.staffing_template_id = shoot.staffing_template_id
          AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
      ) shoot_template ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(ssr.minimum_count), 0)::int AS minimum_staffing_count,
          COUNT(ws.id)::int AS assigned_staff_count
        FROM shoot_staffing_requirement ssr
        LEFT JOIN work_shift ws
          ON ws.tenant_id = ssr.tenant_id
         AND ws.staffing_requirement_id = ssr.id
         AND ws.cancelled_at IS NULL
         AND ws.status IN ('draft', 'published', 'completed')
        WHERE ssr.tenant_id = project.tenant_id
          AND ssr.shoot_id = project.linked_shoot_id
      ) shoot_staff ON true
      LEFT JOIN LATERAL (
        SELECT
          blocker.id AS blocker_id,
          blocker.blocker_type::text AS blocker_type,
          blocker.blocker_owner_user_id,
          blocker_owner.full_name AS blocker_owner_name,
          blocker.reason AS blocker_reason,
          blocker.dependency AS blocker_dependency,
          blocker.expected_resolution_date::text AS blocker_expected_resolution_date,
          blocker.notes AS blocker_notes,
          blocker.created_at::text AS blocker_created_at
        FROM production_project_blocker blocker
        LEFT JOIN app_user blocker_owner
          ON blocker_owner.id = blocker.blocker_owner_user_id
        WHERE blocker.tenant_id = project.tenant_id
          AND blocker.project_id = project.id
          AND blocker.resolved_at IS NULL
        ORDER BY blocker.created_at DESC
        LIMIT 1
      ) current_blocker ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS blocker_count
        FROM production_project_blocker blocker
        WHERE blocker.tenant_id = project.tenant_id
          AND blocker.project_id = project.id
          AND blocker.resolved_at IS NULL
      ) blocker_summary ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE task.status NOT IN ('done', 'skipped')) AS open_task_count,
          COUNT(*) FILTER (WHERE task.required AND task.status NOT IN ('done', 'skipped')) AS open_required_task_count,
          COUNT(*) FILTER (WHERE task.status = 'done') AS completed_task_count,
          COUNT(*) FILTER (
            WHERE task.status = 'blocked'
              OR EXISTS (
                SELECT 1
                FROM production_project_task_dependency dependency
                JOIN production_project_task predecessor
                  ON predecessor.tenant_id = dependency.tenant_id
                 AND predecessor.project_id = dependency.project_id
                 AND predecessor.id = dependency.depends_on_task_id
                WHERE dependency.tenant_id = task.tenant_id
                  AND dependency.project_id = task.project_id
                  AND dependency.task_id = task.id
                  AND predecessor.status NOT IN ('done', 'skipped')
              )
          ) AS blocked_task_count,
          COUNT(*) FILTER (
            WHERE task.status NOT IN ('done', 'skipped')
              AND task.due_date IS NOT NULL
              AND task.due_date < $3::date
          ) AS overdue_task_count,
          BOOL_OR(task.task_type = 'peer_review' AND task.status <> 'done') AS pending_peer_review,
          BOOL_OR(task.task_type = 'final_qc' AND task.status <> 'done') AS pending_final_qc,
          COUNT(*) FILTER (
            WHERE task.task_type = 'release'
              AND task.status NOT IN ('done', 'skipped')
          ) AS pending_release_tasks
        FROM production_project_task task
        WHERE task.tenant_id = project.tenant_id
          AND task.project_id = project.id
      ) task_summary ON true
      LEFT JOIN LATERAL (
        SELECT
          workflow.status::text AS buddy_status,
          workflow.duplicate_handling_required,
          workflow.cleanup_completed_at::text AS cleanup_completed_at,
          workflow.unresolved_group_count
        FROM production_project_buddy_workflow workflow
        WHERE workflow.tenant_id = project.tenant_id
          AND workflow.project_id = project.id
        LIMIT 1
      ) buddy_workflow ON true
      LEFT JOIN LATERAL (
        SELECT
          workflow.status::text AS vt_status,
          workflow.attributes_validated,
          workflow.coach_tags_validated,
          workflow.split_by_group_validated,
          workflow.ambiguous_match_required,
          workflow.ambiguous_match_resolved_at::text AS ambiguous_match_resolved_at
        FROM production_project_virtual_team_workflow workflow
        WHERE workflow.tenant_id = project.tenant_id
          AND workflow.project_id = project.id
        LIMIT 1
      ) vt_workflow ON true
      LEFT JOIN LATERAL (
        SELECT
          task.id::text AS current_step_task_id,
          COALESCE(template_task.task_key, task.id::text) AS current_step_task_key,
          task.title AS current_step_title,
          task.task_type::text AS current_step_task_type,
          task.sort_order::int AS current_step_sort_order
        FROM production_project_task task
        LEFT JOIN production_project_template_task template_task
          ON template_task.tenant_id = task.tenant_id
         AND template_task.id = task.template_task_id
        WHERE task.tenant_id = project.tenant_id
          AND task.project_id = project.id
          AND task.status NOT IN ('done', 'skipped')
        ORDER BY
          task.sort_order ASC,
          CASE task.status
            WHEN 'blocked' THEN 0
            WHEN 'in_progress' THEN 1
            ELSE 2
          END,
          task.due_date ASC NULLS LAST,
          task.created_at ASC
        LIMIT 1
      ) current_step ON true
      WHERE project.tenant_id = $1
        AND project.id = $2
      LIMIT 1
    `,
    [tenantId, projectId, getLocalDateString()]
  );
  return rows.rows[0] ?? null;
}

async function assertProjectExists(client: PoolClient, tenantId: string, projectId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM production_project
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, projectId]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Production project not found");
  }
}

async function loadTemplateById(client: PoolClient, tenantId: string, templateId: string) {
  const result = await client.query<{
    id: string;
    template_key: string;
    name: string;
    description: string | null;
    default_priority: ProductionProjectPriority;
    job_type: ProductionProjectJobType;
    category: ProductionProjectCategory;
    default_stage: ProductionProjectStage;
    peer_review_required: boolean;
    final_qc_required: boolean;
  }>(
    `
      SELECT
        id,
        template_key,
        name,
        description,
        default_priority::text AS default_priority,
        job_type::text AS job_type,
        category::text AS category,
        default_stage::text AS default_stage,
        peer_review_required,
        final_qc_required
      FROM production_project_template
      WHERE tenant_id = $1
        AND id = $2
        AND active_status = true
      LIMIT 1
    `,
    [tenantId, templateId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "Production project template not found");
  }
  return row;
}

async function loadTriggerRule(client: PoolClient, tenantId: string, triggerKey: string) {
  const result = await client.query<TriggerRuleRow>(
    `
      SELECT
        rule.id,
        rule.trigger_key,
        rule.name,
        rule.template_id,
        template.template_key,
        template.name AS template_name,
        template.description AS template_description,
        template.workflow_family AS template_workflow_family,
        template.workflow_mode AS template_workflow_mode,
        template.season_key AS template_season_key,
        template.default_priority::text AS template_default_priority,
        template.job_type::text AS template_job_type,
        template.category::text AS template_category,
        template.default_stage::text AS template_default_stage,
        template.peer_review_required AS template_peer_review_required,
        template.final_qc_required AS template_final_qc_required,
        rule.default_due_offset_days,
        rule.default_follow_up_offset_days
      FROM production_project_trigger_rule rule
      JOIN production_project_template template
        ON template.tenant_id = rule.tenant_id
       AND template.id = rule.template_id
      WHERE rule.tenant_id = $1
        AND rule.trigger_key = $2
        AND rule.active_status = true
      LIMIT 1
    `,
    [tenantId, triggerKey]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, `Production project trigger ${triggerKey} is not configured`);
  }
  return row;
}

async function createProjectTasksFromTemplate(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  templateId: string,
  anchorDate: string,
  actorUserId: string
) {
  const taskResult = await client.query<TemplateTaskRow>(
    `
      SELECT
        id,
        template_id,
        task_key,
        title,
        summary,
        due_offset_days,
        required,
        sort_order,
        task_type::text AS task_type,
        handoff_required,
        blocks_release
      FROM production_project_template_task
      WHERE tenant_id = $1
        AND template_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, templateId]
  );

  const createdTaskIdsByTemplateTaskId = new Map<string, string>();

  for (const task of taskResult.rows) {
    const createdTask = await client.query<{ id: string }>(
      `
        INSERT INTO production_project_task (
          tenant_id,
          project_id,
          template_task_id,
          task_type,
          title,
          summary,
          due_date,
          required,
          sort_order,
          handoff_required,
          blocks_release,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,$3,$4::production_project_task_type,$5,$6,$7::date,$8,$9,$10,$11,$12,$12)
        RETURNING id
      `,
      [
        tenantId,
        projectId,
        task.id,
        task.task_type,
        task.title,
        task.summary,
        addDays(anchorDate, task.due_offset_days),
        task.required,
        task.sort_order,
        task.handoff_required,
        task.blocks_release,
        actorUserId
      ]
    );
    createdTaskIdsByTemplateTaskId.set(task.id, createdTask.rows[0].id);
  }

  const dependencyResult = await client.query<{
    task_template_id: string;
    depends_on_template_task_id: string;
  }>(
    `
      SELECT
        task_template_id,
        depends_on_template_task_id
      FROM production_project_template_task_dependency
      WHERE tenant_id = $1
        AND template_id = $2
    `,
    [tenantId, templateId]
  );

  for (const dependency of dependencyResult.rows) {
    const taskId = createdTaskIdsByTemplateTaskId.get(dependency.task_template_id);
    const dependsOnTaskId = createdTaskIdsByTemplateTaskId.get(dependency.depends_on_template_task_id);
    if (!taskId || !dependsOnTaskId) {
      continue;
    }
    await client.query(
      `
        INSERT INTO production_project_task_dependency (
          tenant_id,
          project_id,
          task_id,
          depends_on_task_id
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, task_id, depends_on_task_id) DO NOTHING
      `,
      [tenantId, projectId, taskId, dependsOnTaskId]
    );
  }
}

async function resolveLinkedContext(
  client: PoolClient,
  tenantId: string,
  input: {
    linkedOrganizationId: string | null;
    linkedLocationId: string | null;
    linkedShootId: string | null;
  }
): Promise<LinkedContext> {
  let organizationId = input.linkedOrganizationId ?? null;
  let organizationName: string | null = null;
  let locationId = input.linkedLocationId ?? null;
  let locationName: string | null = null;
  let shootId = input.linkedShootId ?? null;
  let shootCode: string | null = null;
  let shootTitle: string | null = null;

  if (shootId) {
    const shootResult = await client.query<{
      id: string;
      shoot_code: string | null;
      title: string;
      organization_id: string | null;
      location_id: string | null;
    }>(
      `
        SELECT id, shoot_code, title, organization_id, location_id
        FROM shoot
        WHERE tenant_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [tenantId, shootId]
    );
    const shoot = shootResult.rows[0];
    if (!shoot) {
      throw new ApiError(404, "Linked shoot not found");
    }
    if (organizationId && shoot.organization_id && organizationId !== shoot.organization_id) {
      throw new ApiError(400, "The linked organization does not match the linked shoot");
    }
    if (locationId && shoot.location_id && locationId !== shoot.location_id) {
      throw new ApiError(400, "The linked location does not match the linked shoot");
    }
    organizationId = shoot.organization_id ?? organizationId;
    locationId = shoot.location_id ?? locationId;
    shootCode = shoot.shoot_code ?? null;
    shootTitle = shoot.title;
  }

  if (organizationId) {
    const organizationResult = await client.query<{ display_name: string }>(
      `
        SELECT display_name
        FROM organization
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, organizationId]
    );
    organizationName = organizationResult.rows[0]?.display_name ?? null;
    if (!organizationName) {
      throw new ApiError(404, "Linked organization not found");
    }
  }

  if (locationId) {
    const locationResult = await client.query<{ name: string; organization_id: string | null }>(
      `
        SELECT name, organization_id
        FROM shoot_location
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, locationId]
    );
    const location = locationResult.rows[0];
    if (!location) {
      throw new ApiError(404, "Linked location not found");
    }
    if (organizationId && location.organization_id && location.organization_id !== organizationId) {
      throw new ApiError(400, "The linked location does not belong to the linked organization");
    }
    if (!organizationId && location.organization_id) {
      organizationId = location.organization_id;
      const organizationResult = await client.query<{ display_name: string }>(
        `SELECT display_name FROM organization WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, organizationId]
      );
      organizationName = organizationResult.rows[0]?.display_name ?? organizationName;
    }
    locationName = location.name;
  }

  return {
    organizationId,
    organizationName,
    locationId,
    locationName,
    shootId,
    shootCode,
    shootTitle
  };
}

async function recordProductionProjectEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    projectId: string;
    actorUserId?: string | null;
    eventType: string;
    summary: string;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO production_project_event (
        tenant_id,
        project_id,
        event_type,
        summary,
        note,
        actor_user_id,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    `,
    [
      input.tenantId,
      input.projectId,
      input.eventType,
      input.summary,
      input.note ?? null,
      input.actorUserId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function recordProductionProjectTaskEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    projectId: string;
    taskId: string;
    actorUserId?: string | null;
    eventType: string;
    summary: string;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO production_project_task_event (
        tenant_id,
        project_id,
        task_id,
        event_type,
        summary,
        note,
        actor_user_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      input.tenantId,
      input.projectId,
      input.taskId,
      input.eventType,
      input.summary,
      input.note ?? null,
      input.actorUserId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

function buildSection(
  sectionId: ProductionProjectQueueId,
  label: string,
  summary: string,
  items: ProductionProjectSummaryRecord[],
  anchorDate: string,
  currentUserId: string | null,
  includeItems: boolean
): ProductionProjectBoardSection {
  const sectionItems = items
    .filter((project) => matchesQueueFilter(project, anchorDate, sectionId, currentUserId))
    .sort((left, right) => compareProjectQueueOrder(left, right, anchorDate));
  return {
    id: sectionId,
    label,
    summary,
    count: sectionItems.length,
    items: includeItems ? sectionItems : []
  };
}

function buildProjectTaskAuthority(row: ProjectRow) {
  const openNonReleaseRequiredTasks = Math.max(row.open_required_task_count - row.pending_release_tasks, 0);
  const releaseBlocked =
    row.blocker_count > 0 ||
    row.blocked_task_count > 0 ||
    row.overdue_task_count > 0 ||
    row.pending_peer_review ||
    row.pending_final_qc ||
    openNonReleaseRequiredTasks > 0;
  const reasons: string[] = [];

  if (row.blocker_reason) {
    reasons.push(row.blocker_reason);
  }
  if (openNonReleaseRequiredTasks > 0) {
    reasons.push(
      `${openNonReleaseRequiredTasks} required task${openNonReleaseRequiredTasks === 1 ? "" : "s"} still open`
    );
  }
  if (row.blocked_task_count > 0) {
    reasons.push(`${row.blocked_task_count} blocked or dependency-held task${row.blocked_task_count === 1 ? "" : "s"}`);
  }
  if (row.overdue_task_count > 0) {
    reasons.push(`${row.overdue_task_count} overdue task deadline${row.overdue_task_count === 1 ? "" : "s"}`);
  }
  if (row.pending_peer_review) {
    reasons.push("peer review gate incomplete");
  }
  if (row.pending_final_qc) {
    reasons.push("final QC gate incomplete");
  }
  if (!row.owner_user_id && !isClosedProject(row.status)) {
    reasons.push("production owner missing");
  }

  let taskAuthorityLabel = humanizeProjectStage(row.stage);
  if (isClosedProject(row.status)) {
    taskAuthorityLabel = row.release_state === "released" ? "Released complete" : "Workflow closed";
  } else if (row.blocker_count > 0 || row.blocked_task_count > 0 || row.stage === "blocked") {
    taskAuthorityLabel = "Blocked";
  } else if (row.overdue_task_count > 0) {
    taskAuthorityLabel = "Overdue task pressure";
  } else if (row.pending_peer_review) {
    taskAuthorityLabel = "Peer review waiting";
  } else if (row.pending_final_qc) {
    taskAuthorityLabel = "Final QC waiting";
  } else if (releaseBlocked) {
    taskAuthorityLabel = "Release blocked";
  } else if (row.stage === "ready_to_release") {
    taskAuthorityLabel = "Ready to release";
  } else if (openNonReleaseRequiredTasks > 0) {
    taskAuthorityLabel = row.stage === "in_production" ? "Production work open" : "Required workflow open";
  } else if (row.pending_release_tasks > 0) {
    taskAuthorityLabel = "Release action next";
  } else if (row.stage === "intake_pending" || row.stage === "ready_for_production") {
    taskAuthorityLabel = "Needs setup";
  }

  let nextOwnerLabel: string | null = row.owner_name ?? null;
  if (!row.owner_user_id && !isClosedProject(row.status)) {
    nextOwnerLabel = "Production owner unassigned";
  } else if (row.pending_peer_review) {
    nextOwnerLabel = row.peer_reviewer_name ?? "Peer reviewer unassigned";
  } else if (row.pending_final_qc) {
    nextOwnerLabel = row.final_qc_reviewer_name ?? "Final QC reviewer unassigned";
  } else if (row.pending_release_tasks > 0 || row.stage === "ready_to_release") {
    nextOwnerLabel = row.final_qc_reviewer_name ?? row.owner_name ?? "Release owner unassigned";
  }

  return {
    releaseBlocked,
    taskAuthorityLabel,
    taskAuthorityReasons: reasons,
    nextOwnerLabel
  };
}

function toProjectSummaryRecord(row: ProjectRow, anchorDate: string): ProductionProjectSummaryRecord {
  const linkedShootImportance = evaluateLinkedShootImportance(row);
  const dueWithin24Hours = isProjectDueWithin24Hours(row, anchorDate);
  const overdue = isProjectOverdue(row, anchorDate);
  const teamOwner = resolveProjectTeamOwner(row.job_type, row.stage);
  const ownershipState = deriveProjectOwnershipState(row.stage, row.status, row.owner_user_id);
  const authority = buildProjectTaskAuthority(row);
  const touchState = deriveProductionTouchState(row, authority, anchorDate);
  const staleState = deriveProjectStaleState(row, anchorDate);
  const correctionsNeeded = row.stage === "correction_needed" || row.qa_state === "correction_needed";
  const waitingToSend = row.stage === "ready_to_release" || row.pending_release_tasks > 0;
  const readyToSend = row.stage === "ready_to_release" && !authority.releaseBlocked;
  const buddyCleanupComplete = Boolean(row.buddy_cleanup_completed_at);
  const vtAmbiguousOpen = row.vt_ambiguous_match_required && !row.vt_ambiguous_match_resolved_at;
  const workflowFamilyLabel = row.template_workflow_family ? humanizeProductionWorkflowFamily(row.template_workflow_family) : null;
  const workflowModeLabel = row.template_workflow_mode ? humanizeProductionWorkflowMode(row.template_workflow_mode) : null;
  const seasonLabel = row.template_season_key ? humanizeProductionWorkflowSeason(row.template_season_key) : null;
  const currentStepLabel = normalizeNullableText(row.current_step_title) ?? humanizeProjectStage(row.stage);
  const currentStepTaskTypeLabel = row.current_step_task_type ? humanizeProjectTaskType(row.current_step_task_type) : null;
  const healthSignal = deriveProjectHealthSignal({
    stage: row.stage,
    status: row.status,
    priority: row.priority,
    ownerUserId: row.owner_user_id,
    dueDate: row.due_date,
    followUpDate: row.follow_up_date,
    openRequiredTaskCount: row.open_required_task_count,
    blockedTaskCount: row.blocked_task_count,
    overdueTaskCount: row.overdue_task_count,
    pendingPeerReview: row.pending_peer_review,
    pendingFinalQc: row.pending_final_qc,
    releaseBlocked: authority.releaseBlocked,
    dueWithin24Hours,
    overdue,
    blockerCount: row.blocker_count,
    linkedShootImportanceTier: linkedShootImportance?.tier ?? null
  });
  const currentBlocker: ProductionProjectBlockerRecord | null = row.blocker_id
    ? {
        id: row.blocker_id,
        blocker_type: row.blocker_type ?? "other",
        blocker_type_label: humanizeProjectBlockerType(row.blocker_type ?? "other"),
        blocker_owner_user_id: row.blocker_owner_user_id,
        blocker_owner_label: row.blocker_owner_name ?? null,
        reason: row.blocker_reason ?? "Blocked",
        dependency: row.blocker_dependency,
        expected_resolution_date: row.blocker_expected_resolution_date,
        expected_resolution_label: row.blocker_expected_resolution_date
          ? formatDueLabel(row.blocker_expected_resolution_date, anchorDate)
          : null,
        notes: row.blocker_notes,
        blocked_at: row.blocker_created_at ?? row.updated_at
      }
    : null;
  const flags = buildProjectFlags(row, anchorDate);
  return {
    id: row.id,
    template_id: row.template_id,
    template_key: row.template_key,
    template_name: row.template_name,
    workflow_family: row.template_workflow_family,
    workflow_family_label: workflowFamilyLabel,
    workflow_mode: row.template_workflow_mode,
    workflow_mode_label: workflowModeLabel,
    season_key: row.template_season_key,
    season_label: seasonLabel,
    title: row.title,
    summary: row.summary,
    status: row.status,
    job_type: row.job_type,
    job_type_label: humanizeProjectJobType(row.job_type),
    category: row.category,
    category_label: humanizeProjectCategory(row.category),
    stage: row.stage,
    stage_label: humanizeProjectStage(row.stage),
    current_step_key: row.current_step_task_key,
    current_step_label: currentStepLabel,
    current_step_task_type: row.current_step_task_type,
    current_step_task_type_label: currentStepTaskTypeLabel,
    current_step_order: row.current_step_sort_order,
    qa_state: row.qa_state,
    qa_state_label: humanizeProjectQaState(row.qa_state),
    release_state: row.release_state,
    release_state_label: humanizeProjectReleaseState(row.release_state),
    health_signal: healthSignal,
    health_signal_label: humanizeProjectHealthSignal(healthSignal),
    ownership_state: ownershipState,
    ownership_state_label: humanizeProjectOwnershipState(ownershipState),
    team_owner: teamOwner,
    team_owner_label: humanizeProjectTeamOwner(teamOwner),
    priority: row.priority,
    owner_user_id: row.owner_user_id,
    owner_label: row.owner_name ?? "Owner unassigned",
    peer_review_required: row.peer_review_required,
    final_qc_required: row.final_qc_required,
    peer_reviewer_user_id: row.peer_reviewer_user_id,
    peer_reviewer_label: row.peer_reviewer_name ?? null,
    final_qc_reviewer_user_id: row.final_qc_reviewer_user_id,
    final_qc_reviewer_label: row.final_qc_reviewer_name ?? null,
    due_date: row.due_date,
    due_label: row.due_date ? formatDueLabel(row.due_date, anchorDate) : null,
    follow_up_date: row.follow_up_date,
    follow_up_label: row.follow_up_date ? formatDueLabel(row.follow_up_date, anchorDate) : null,
    snoozed_until: row.snoozed_until,
    latest_note: row.latest_note,
    source_type: row.source_type,
    source_trigger_key: row.source_trigger_key,
    source_trigger_label: row.source_trigger_label,
    created_reason: row.created_reason,
    linked_organization_id: row.linked_organization_id,
    linked_organization_name: row.linked_organization_name,
    linked_location_id: row.linked_location_id,
    linked_location_name: row.linked_location_name,
    linked_shoot_id: row.linked_shoot_id,
    linked_shoot_date: row.linked_shoot_date,
    linked_shoot_date_label: row.linked_shoot_date ? formatDateLabel(row.linked_shoot_date) : null,
    linked_shoot_code: row.linked_shoot_code,
    linked_shoot_title: row.linked_shoot_title,
    linked_shoot_type_label: row.linked_shoot_type ? humanizeValue(row.linked_shoot_type) : null,
    linked_shoot_importance_tier: linkedShootImportance?.tier ?? null,
    linked_shoot_importance_label: linkedShootImportance ? humanizeShootImportanceTier(linkedShootImportance.tier) : null,
    shoot_photographer_count:
      row.shoot_template_photographer_count == null ? null : Number(row.shoot_template_photographer_count),
    shoot_camera_station_count: row.shoot_camera_station_count == null ? null : Number(row.shoot_camera_station_count),
    context_label: buildProjectContextLabel(row),
    open_task_count: row.open_task_count,
    open_required_task_count: row.open_required_task_count,
    completed_task_count: row.completed_task_count,
    blocked_task_count: row.blocked_task_count,
    overdue_task_count: row.overdue_task_count,
    pending_peer_review: row.pending_peer_review,
    pending_final_qc: row.pending_final_qc,
    pending_release_tasks: row.pending_release_tasks,
    release_blocked: authority.releaseBlocked,
    buddy_workflow_status: row.buddy_status,
    buddy_duplicate_required: row.buddy_duplicate_handling_required,
    buddy_cleanup_complete: buddyCleanupComplete,
    buddy_unresolved_group_count: row.buddy_unresolved_group_count,
    vt_workflow_status: row.vt_status,
    vt_ambiguous_match_required: vtAmbiguousOpen,
    vt_coach_tags_validated: row.vt_coach_tags_validated,
    vt_split_by_group_validated: row.vt_split_by_group_validated,
    vt_attributes_validated: row.vt_attributes_validated,
    task_authority_label: authority.taskAuthorityLabel,
    task_authority_reasons: authority.taskAuthorityReasons,
    next_owner_label: authority.nextOwnerLabel,
    blocker_count: row.blocker_count,
    current_blocker: currentBlocker,
    due_within_24_hours: dueWithin24Hours,
    overdue,
    stale_active: staleState.stale,
    stale_label: staleState.label,
    last_touched_label: staleState.lastTouchedLabel,
    has_latest_note: Boolean(normalizeNullableText(row.latest_note)),
    corrections_needed: correctionsNeeded,
    waiting_to_send: waitingToSend,
    ready_to_send: readyToSend,
    production_can_touch: touchState.canTouch,
    production_touch_label: touchState.label,
    production_touch_reasons: touchState.reasons,
    next_action: buildProjectNextAction(row, anchorDate),
    status_tone: deriveProjectTone(row, anchorDate),
    flags,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at
  };
}

function buildProjectContextLabel(
  row: Pick<ProjectRow, "linked_organization_name" | "linked_shoot_type" | "linked_location_name" | "linked_shoot_title">
) {
  const parts = [
    row.linked_organization_name,
    row.linked_shoot_type ? humanizeValue(row.linked_shoot_type) : null,
    row.linked_location_name
  ].filter(Boolean);
  if (parts.length) {
    return parts.join(" | ");
  }
  return row.linked_shoot_title ?? null;
}

function deriveProjectStaleState(
  row: Pick<ProjectRow, "status" | "stage" | "updated_at" | "snoozed_until">,
  anchorDate: string
) {
  const updatedDate = extractDatePart(row.updated_at);
  const daysSinceTouch = dayDelta(updatedDate, anchorDate);
  const stale =
    !isClosedProject(row.status) &&
    !isFutureSnoozed(row.snoozed_until ?? null, anchorDate) &&
    daysSinceTouch >= 3 &&
    row.stage !== "on_hold";

  return {
    stale,
    label: stale ? `Stale for ${daysSinceTouch} day${daysSinceTouch === 1 ? "" : "s"}` : null,
    lastTouchedLabel: buildLastTouchedLabel(updatedDate, anchorDate)
  };
}

function deriveProductionTouchState(
  row: Pick<
    ProjectRow,
    "status" | "stage" | "blocker_reason" | "blocker_count" | "blocked_task_count" | "pending_release_tasks" | "latest_note"
  >,
  authority: ReturnType<typeof buildProjectTaskAuthority>,
  anchorDate: string
) {
  if (isClosedProject(row.status)) {
    return { canTouch: false, label: "Workflow closed", reasons: [] as string[] };
  }
  if (row.stage === "blocked" || row.blocker_count > 0 || row.blocked_task_count > 0) {
    return {
      canTouch: false,
      label: "Blocked",
      reasons: [row.blocker_reason ?? authority.taskAuthorityReasons[0] ?? "A blocker still has to clear first."]
    };
  }
  if (row.stage === "intake_pending") {
    return {
      canTouch: false,
      label: "Waiting on intake",
      reasons: ["Triggered intake landed, but kickoff detail still needs confirmation."]
    };
  }
  if (row.stage === "ready_for_production" || row.stage === "in_production") {
    return {
      canTouch: true,
      label: "Production can work now",
      reasons: authority.taskAuthorityReasons.length
        ? authority.taskAuthorityReasons
        : [row.stage === "in_production" ? "Work is already in motion." : "Kickoff detail is ready for production."]
    };
  }
  if (row.stage === "correction_needed") {
    return {
      canTouch: true,
      label: "Corrections can work now",
      reasons: [normalizeNullableText(row.latest_note) ?? "QA returned this job for correction."]
    };
  }
  if (row.stage === "ready_for_qa" || row.stage === "in_qa_review") {
    return {
      canTouch: false,
      label: "Waiting on review",
      reasons: authority.taskAuthorityReasons.length ? authority.taskAuthorityReasons : ["QA review is the current gate."]
    };
  }
  if (row.stage === "ready_to_release" || row.pending_release_tasks > 0) {
    return {
      canTouch: false,
      label: "Waiting to send",
      reasons: authority.taskAuthorityReasons.length
        ? authority.taskAuthorityReasons
        : ["Release is the next controlled action, not new production work."]
    };
  }
  if (row.stage === "on_hold") {
    return { canTouch: false, label: "On hold", reasons: ["This job is paused until the hold is cleared."] };
  }
  return {
    canTouch: false,
    label: authority.taskAuthorityLabel,
    reasons: authority.taskAuthorityReasons.length ? authority.taskAuthorityReasons : [`Anchor date ${anchorDate}`]
  };
}

function toProductionProjectTaskRecord(task: ProjectTaskRow, anchorDate = getLocalDateString()): ProductionProjectTaskRecord {
  const dependencyState: ProductionProjectTaskDependencyState =
    task.status === "done" || task.status === "skipped"
      ? "complete"
      : task.unresolved_dependency_count > 0
        ? "blocked"
        : "ready";
  const overdue = Boolean(task.due_date && task.due_date < anchorDate && task.status !== "done" && task.status !== "skipped");
  const atRisk =
    overdue ||
    task.status === "blocked" ||
    dependencyState === "blocked" ||
    Boolean(task.blocks_release && task.status !== "done" && task.status !== "skipped");

  return {
    id: task.id,
    template_task_id: task.template_task_id,
    task_key: task.task_key,
    title: task.title,
    summary: task.summary,
    status: task.status,
    task_type: task.task_type,
    task_type_label: humanizeProjectTaskType(task.task_type),
    owner_user_id: task.owner_user_id,
    owner_label: task.owner_name ?? null,
    due_date: task.due_date,
    due_label: task.due_date ? formatDueLabel(task.due_date, anchorDate) : null,
    latest_note: task.latest_note,
    required: task.required,
    sort_order: task.sort_order,
    handoff_required: task.handoff_required,
    blocks_release: task.blocks_release,
    started_at: task.started_at,
    completed_at: task.completed_at,
    overdue,
    at_risk: atRisk,
    dependency_state: dependencyState,
    dependency_state_label: humanizeProjectTaskDependencyState(dependencyState),
    blocking_dependencies: (task.blocking_dependency_titles ?? []).map((title, index) => ({
      task_id: task.blocking_dependency_ids?.[index] ?? `dependency-${index}`,
      title,
      status: ((task.blocking_dependency_statuses?.[index] as ProductionProjectTaskStatus | undefined) ?? "todo"),
      status_label: humanizeValue((task.blocking_dependency_statuses?.[index] as string | undefined) ?? "todo")
    })),
    dependent_task_count: task.dependent_task_count,
    last_handoff_at: task.last_handoff_at,
    last_handoff_to_user_id: task.last_handoff_to_user_id,
    last_handoff_to_label: task.last_handoff_to_name ?? null
  };
}

function isIncompleteQualityGateTask(task: Pick<ProductionProjectTaskRecord, "task_type" | "status">) {
  return (task.task_type === "peer_review" || task.task_type === "final_qc") && task.status !== "done";
}

function buildProductionProjectWorkflowSummary(
  tasks: ProductionProjectTaskRecord[],
  project: Pick<ProjectRow, "peer_review_required" | "final_qc_required" | "stage">
): ProductionProjectWorkflowSummary {
  const openRequiredTasks = tasks.filter((task) => task.required && !["done", "skipped"].includes(task.status));
  const blockedReasons: string[] = [];
  const blockedTaskCount = tasks.filter((task) => task.status === "blocked" || task.dependency_state === "blocked").length;
  const overdueTaskCount = tasks.filter((task) => task.overdue).length;
  const pendingPeerReview = Boolean(
    project.peer_review_required && tasks.some((task) => isIncompleteQualityGateTask(task) && task.task_type === "peer_review")
  );
  const pendingFinalQc = Boolean(
    project.final_qc_required && tasks.some((task) => isIncompleteQualityGateTask(task) && task.task_type === "final_qc")
  );
  const pendingReleaseTasks = tasks.filter((task) => task.task_type === "release" && !["done", "skipped"].includes(task.status)).length;
  const openNonReleaseRequiredTasks = openRequiredTasks.filter((task) => task.task_type !== "release");

  if (openNonReleaseRequiredTasks.length) {
    blockedReasons.push(
      `${openNonReleaseRequiredTasks.length} required production task${openNonReleaseRequiredTasks.length === 1 ? "" : "s"} still open`
    );
  }
  if (blockedTaskCount) {
    blockedReasons.push(`${blockedTaskCount} blocked or dependency-held task${blockedTaskCount === 1 ? "" : "s"}`);
  }
  if (overdueTaskCount) {
    blockedReasons.push(`${overdueTaskCount} overdue task deadline${overdueTaskCount === 1 ? "" : "s"}`);
  }
  if (pendingPeerReview) {
    blockedReasons.push("peer review gate incomplete");
  }
  if (pendingFinalQc) {
    blockedReasons.push("final QC gate incomplete");
  }

  const canMoveToReadyToRelease = blockedReasons.length === 0;
  const canRelease = blockedReasons.length === 0 && pendingReleaseTasks <= 1;

  return {
    release_blocked: blockedReasons.length > 0,
    can_move_to_ready_to_release: canMoveToReadyToRelease,
    can_release: canRelease,
    blocked_reasons: blockedReasons,
    open_required_tasks: openRequiredTasks.length,
    blocked_task_count: blockedTaskCount,
    overdue_task_count: overdueTaskCount,
    pending_peer_review: pendingPeerReview,
    pending_final_qc: pendingFinalQc,
    pending_release_tasks: pendingReleaseTasks,
    deadline_ladder: [...tasks]
      .sort((left, right) => {
        const leftDue = left.due_date ?? "9999-12-31";
        const rightDue = right.due_date ?? "9999-12-31";
        if (leftDue !== rightDue) {
          return leftDue.localeCompare(rightDue);
        }
        return left.sort_order - right.sort_order;
      })
      .map((task) => ({
        task_id: task.id,
        title: task.title,
        due_date: task.due_date,
        due_label: task.due_label,
        status: task.status,
        status_label: humanizeValue(task.status),
        owner_label: task.owner_label,
        task_type: task.task_type,
        task_type_label: task.task_type_label,
        dependency_state: task.dependency_state,
        dependency_state_label: task.dependency_state_label
      }))
  };
}

function buildProjectFlags(row: ProjectRow, anchorDate: string): ProductionProjectFlag[] {
  const flags: ProductionProjectFlag[] = [];
  const linkedShootImportance = evaluateLinkedShootImportance(row);
  const authority = buildProjectTaskAuthority(row);
  flags.push({ label: humanizeProjectJobType(row.job_type), tone: "info" });
  flags.push({ label: humanizeProjectStage(row.stage), tone: stageTone(row.stage) });
  if (row.priority === "critical") {
    flags.push({ label: "Critical priority", tone: "critical" });
  } else if (row.priority === "high") {
    flags.push({ label: "High priority", tone: "warning" });
  }
  if (!row.owner_user_id && !isClosedProject(row.status)) {
    flags.push({ label: "Owner missing", tone: "warning" });
  }
  if (row.peer_review_required && !row.peer_reviewer_user_id && !isClosedProject(row.status)) {
    flags.push({ label: "Peer reviewer needed", tone: "warning" });
  }
  if (row.final_qc_required && !row.final_qc_reviewer_user_id && !isClosedProject(row.status)) {
    flags.push({ label: "Final QC reviewer needed", tone: "warning" });
  }
  if (linkedShootImportance && (linkedShootImportance.tier === "big_shoot" || linkedShootImportance.tier === "critical_shoot")) {
    flags.push({
      label: humanizeShootImportanceTier(linkedShootImportance.tier),
      tone: linkedShootImportance.tier === "critical_shoot" ? "critical" : "warning"
    });
  }
  if (row.open_required_task_count > 0 && !isClosedProject(row.status)) {
    flags.push({
      label: `${row.open_required_task_count} required workflow item${row.open_required_task_count === 1 ? "" : "s"} open`,
      tone: "warning"
    });
  }
  if (row.pending_peer_review && !isClosedProject(row.status)) {
    flags.push({ label: "Peer review waiting", tone: "warning" });
  }
  if (row.pending_final_qc && !isClosedProject(row.status)) {
    flags.push({ label: "Final QC waiting", tone: "warning" });
  }
  if (row.blocked_task_count > 0 && !isClosedProject(row.status)) {
    flags.push({
      label: `${row.blocked_task_count} blocked task${row.blocked_task_count === 1 ? "" : "s"}`,
      tone: "critical"
    });
  }
  if (row.overdue_task_count > 0) {
    flags.push({
      label: `${row.overdue_task_count} overdue task${row.overdue_task_count === 1 ? "" : "s"}`,
      tone: "critical"
    });
  }
  if (isProjectOverdue(row, anchorDate)) {
    flags.push({ label: "Overdue", tone: "critical" });
  } else if (isProjectDueWithin24Hours(row, anchorDate)) {
    flags.push({ label: "Due in 24h", tone: "warning" });
  }
  if (row.blocker_id && row.blocker_type) {
    flags.push({ label: humanizeProjectBlockerType(row.blocker_type), tone: "critical" });
  }
  if (!isClosedProject(row.status) && ["ready_for_qa", "in_qa_review", "correction_needed"].includes(row.stage)) {
    flags.push({ label: "QA handoff", tone: "warning" });
  }
  if (row.stage === "ready_to_release") {
    flags.push({ label: "Ready to release", tone: "success" });
  }
  if (authority.releaseBlocked && !isClosedProject(row.status)) {
    flags.push({ label: "Release unsafe", tone: "critical" });
  }
  if (row.snoozed_until && row.snoozed_until > anchorDate && !isClosedProject(row.status)) {
    flags.push({ label: `Snoozed until ${formatDateLabel(row.snoozed_until)}`, tone: "info" });
  }
  if (row.source_trigger_label) {
    flags.push({ label: row.source_trigger_label, tone: "info" });
  }
  return flags;
}

function deriveProjectTone(row: ProjectRow, anchorDate: string) {
  const authority = buildProjectTaskAuthority(row);
  const signal = deriveProjectHealthSignal({
    stage: row.stage,
    status: row.status,
    priority: row.priority,
    ownerUserId: row.owner_user_id,
    dueDate: row.due_date,
    followUpDate: row.follow_up_date,
    openRequiredTaskCount: row.open_required_task_count,
    blockedTaskCount: row.blocked_task_count,
    overdueTaskCount: row.overdue_task_count,
    pendingPeerReview: row.pending_peer_review,
    pendingFinalQc: row.pending_final_qc,
    releaseBlocked: authority.releaseBlocked,
    dueWithin24Hours: isProjectDueWithin24Hours(row, anchorDate),
    overdue: isProjectOverdue(row, anchorDate),
    blockerCount: row.blocker_count,
    linkedShootImportanceTier: evaluateLinkedShootImportance(row)?.tier ?? null
  });
  if (signal === "healthy") {
    return "success" as const;
  }
  if (signal === "due_soon") {
    return "warning" as const;
  }
  if (signal === "blocked" || signal === "overdue" || signal === "release_risk" || signal === "escalated") {
    return "critical" as const;
  }
  if (signal === "fragile") {
    return "warning" as const;
  }
  if (row.status === "completed") {
    return "success" as const;
  }
  return "info" as const;
}

function buildProjectNextAction(row: ProjectRow, anchorDate: string) {
  const authority = buildProjectTaskAuthority(row);
  if (isClosedProject(row.status)) {
    return "Review release history";
  }
  if (!row.owner_user_id) {
    return "Assign an owner";
  }
  if (row.blocker_count > 0 || row.blocked_task_count > 0 || row.stage === "blocked") {
    return "Resolve blockers before more work moves";
  }
  if (row.overdue_task_count > 0) {
    return "Clear overdue task deadlines";
  }
  if (row.pending_peer_review) {
    return row.peer_reviewer_user_id ? "Complete peer review" : "Assign a peer reviewer";
  }
  if (row.pending_final_qc) {
    return row.final_qc_reviewer_user_id ? "Complete final QC" : "Assign a final QC reviewer";
  }
  if (Math.max(row.open_required_task_count - row.pending_release_tasks, 0) > 0) {
    return row.stage === "in_production" ? "Work the next required production task" : "Clear required workflow items";
  }
  if (row.pending_release_tasks > 0 && !authority.releaseBlocked) {
    return "Complete the release step";
  }
  if (row.stage === "intake_pending") {
    return "Confirm intake and instructions";
  }
  if (row.stage === "ready_for_production") {
    return "Start production";
  }
  if (row.stage === "ready_for_qa") {
    return row.peer_reviewer_user_id ? "Start QA review" : "Assign a QA reviewer";
  }
  if (row.stage === "in_qa_review") {
    return "Complete QA review";
  }
  if (row.stage === "correction_needed") {
    return "Clear corrections and return to QA";
  }
  if (row.stage === "ready_to_release") {
    return "Release the deliverable";
  }
  if (row.stage === "on_hold") {
    return "Review hold reason and resume";
  }
  if (!row.due_date) {
    return "Set a due date";
  }
  if (row.follow_up_date && row.follow_up_date <= anchorDate) {
    return "Log follow-up and update the date";
  }
  if (row.open_task_count > 0) {
    return row.stage === "in_production" ? "Work the next production task" : "Work the next checklist item";
  }
  return "Open production detail";
}

function classifyProjectQueue(
  project: ProductionProjectSummaryRecord,
  anchorDate: string,
  currentUserId: string | null
): ProductionProjectQueueId {
  if (isBlockedProject(project)) {
    return "blocked_queue";
  }
  if (project.stage === "ready_to_release") {
    return "ready_to_release_queue";
  }
  if (isQaQueueProject(project)) {
    return "qa_queue";
  }
  if (isAtRiskQueueProject(project, anchorDate)) {
    return "at_risk_queue";
  }
  if (isMyQueueProject(project, currentUserId)) {
    return "my_queue";
  }
  return "team_queue";
}

function matchesQueueFilter(
  project: ProductionProjectSummaryRecord,
  anchorDate: string,
  queue: ProductionProjectQueueId | "all",
  currentUserId: string | null
) {
  if (queue === "all") {
    return true;
  }
  if (queue === "my_queue") {
    return isMyQueueProject(project, currentUserId);
  }
  return classifyProjectQueue(project, anchorDate, currentUserId) === queue;
}

function shouldKeepEmptySection(sectionId: ProductionProjectQueueId, queue: ProductionProjectQueueId | "all") {
  return queue === sectionId;
}

function toManagerQueueItem(
  project: ProductionProjectSummaryRecord,
  queueId: "needs_project_setup" | "needs_project_follow_up" | "overdue_project_tasks",
  anchorDate: string
): ManagerCockpitQueueItem {
  const queueLabel =
    queueId === "needs_project_setup"
      ? "Needs Production Setup"
      : queueId === "needs_project_follow_up"
        ? "Needs Production Follow-Up"
        : "Overdue Production Tasks";

  const metaFlags: ManagerCockpitFlag[] = project.flags.map((flag) => ({
    label: flag.label,
    tone: flag.tone
  }));

  return {
    id: `project:${project.id}`,
    entity_kind: "project",
    entity_id: project.id,
    organization_id: project.linked_organization_id,
    shoot_id: project.linked_shoot_id,
    title: project.title,
    summary: project.summary ?? project.created_reason,
    owner_label: project.owner_label,
    due_label: project.due_label ?? project.follow_up_label,
    status_label: queueLabel,
    status_tone: project.status_tone,
    next_action: project.next_action,
    action_hash: buildProjectHash({
      projectId: project.id,
      queue:
        queueId === "needs_project_setup"
          ? project.owner_user_id
            ? "team_queue"
            : "my_queue"
          : queueId === "needs_project_follow_up"
            ? project.stage === "ready_to_release"
              ? "ready_to_release_queue"
              : project.stage === "blocked"
                ? "blocked_queue"
                : "qa_queue"
            : "at_risk_queue",
      stage: project.stage,
      dueState: resolveProjectDueState(project, anchorDate)
    }),
    flags: metaFlags
  };
}

function buildProjectHash(options: {
  projectId?: string | null;
  queue?: string | null;
  ownerUserId?: string | "unassigned" | null;
  stage?: ProductionProjectStage | "all" | null;
  dueState?: ProductionProjectDueState | "all" | null;
  status?: "open" | "completed" | "all" | null;
}) {
  const params = new URLSearchParams();
  if (options.projectId) {
    params.set("project", options.projectId);
  }
  if (options.status && options.status !== "open") {
    params.set("status", options.status);
  }
  if (options.queue && options.queue !== "all") {
    params.set("queue", options.queue);
  }
  if (options.ownerUserId) {
    params.set("owner_user_id", options.ownerUserId);
  }
  if (options.stage && options.stage !== "all") {
    params.set("stage", options.stage);
  }
  if (options.dueState && options.dueState !== "all") {
    params.set("due_state", options.dueState);
  }
  const query = params.toString();
  if (options.queue === "qa_queue" || (options.stage && ["ready_for_qa", "in_qa_review", "correction_needed"].includes(options.stage))) {
    return query ? `#production/qa?${query}` : "#production/qa";
  }
  if (options.queue === "ready_to_release_queue" || (options.stage && ["ready_to_release", "released_complete"].includes(options.stage))) {
    return query ? `#production/release?${query}` : "#production/release";
  }
  if (options.queue === "my_queue" || options.ownerUserId) {
    return query ? `#production/workload?${query}` : "#production/workload";
  }
  return query ? `#production?${query}` : "#production";
}

function buildHomeSnapshotSummaryLine(counts: ProductionProjectHomeSnapshot["counts"]) {
  if (counts.overdue > 0) {
    return `${counts.overdue} overdue production job${counts.overdue === 1 ? "" : "s"} are slipping and need intervention.`;
  }
  if (counts.blocked > 0) {
    return `${counts.blocked} blocked production job${counts.blocked === 1 ? "" : "s"} need intervention.`;
  }
  if (counts.peer_review_lag > 0) {
    return `${counts.peer_review_lag} production job${counts.peer_review_lag === 1 ? "" : "s"} have been waiting on peer review too long.`;
  }
  if (counts.final_qc_lag > 0) {
    return `${counts.final_qc_lag} production job${counts.final_qc_lag === 1 ? "" : "s"} have been waiting on final QC too long.`;
  }
  if (counts.release_blockers > 0) {
    return `${counts.release_blockers} production job${counts.release_blockers === 1 ? "" : "s"} are waiting to send but still unsafe to release.`;
  }
  if (counts.stale_active > 0) {
    return `${counts.stale_active} active production job${counts.stale_active === 1 ? "" : "s"} have gone stale and need follow-through.`;
  }
  if (counts.jobs_in_qa > 0) {
    return `${counts.jobs_in_qa} production job${counts.jobs_in_qa === 1 ? "" : "s"} are sitting in QA or correction lanes.`;
  }
  if (counts.ready_to_release > 0) {
    return `${counts.ready_to_release} production job${counts.ready_to_release === 1 ? "" : "s"} are ready to release.`;
  }
  if (counts.due_within_24_hours > 0) {
    return `${counts.due_within_24_hours} production job${counts.due_within_24_hours === 1 ? "" : "s"} are due within 24 hours.`;
  }
  if (counts.unassigned_jobs > 0) {
    return `${counts.unassigned_jobs} production item${counts.unassigned_jobs === 1 ? "" : "s"} still need an owner.`;
  }
  if (counts.active_jobs > 0) {
    return `${counts.active_jobs} production job${counts.active_jobs === 1 ? "" : "s"} are actively moving through post-shoot production.`;
  }
  return "Production is on track right now.";
}

function deriveHomeSnapshotTone(counts: ProductionProjectHomeSnapshot["counts"]): ProductionProjectHomeSnapshot["tone"] {
  if (counts.attention_needed > 0) {
    return "action_needed";
  }
  if (counts.jobs_in_qa > 0 || counts.ready_to_release > 0 || counts.due_within_24_hours > 0 || counts.unassigned_jobs > 0) {
    return "heads_up";
  }
  if (counts.active_jobs > 0 || counts.on_time > 0) {
    return "good";
  }
  return "neutral";
}

function buildHomeAssessmentCards(
  counts: ProductionProjectHomeSnapshot["counts"]
): ProductionProjectHomeSnapshot["assessment_cards"] {
  return [
    {
      id: "overdue",
      label: "Overdue",
      value: counts.overdue,
      tone: counts.overdue ? "action_needed" : "good",
      detail: "Checklist or follow-up work already overdue.",
      action_hash: buildProjectHash({ queue: "at_risk_queue", dueState: "overdue" })
    },
    {
      id: "blocked",
      label: "Blocked",
      value: counts.blocked,
      tone: counts.blocked ? "action_needed" : "neutral",
      detail: "Blocked production jobs waiting on a fix or dependency.",
      action_hash: buildProjectHash({ queue: "blocked_queue", stage: "blocked" })
    },
    {
      id: "peer_review_lag",
      label: "Peer Review Lag",
      value: counts.peer_review_lag,
      tone: counts.peer_review_lag ? "action_needed" : "neutral",
      detail: "Peer review has been waiting too long and is now putting work at risk.",
      action_hash: buildProjectHash({ queue: "qa_queue" })
    },
    {
      id: "final_qc_lag",
      label: "Final QC Lag",
      value: counts.final_qc_lag,
      tone: counts.final_qc_lag ? "action_needed" : "neutral",
      detail: "Final QC has been waiting too long and is blocking release confidence.",
      action_hash: buildProjectHash({ queue: "ready_to_release_queue", stage: "ready_to_release" })
    },
    {
      id: "release_blockers",
      label: "Release Blockers",
      value: counts.release_blockers,
      tone: counts.release_blockers ? "action_needed" : "neutral",
      detail: "Jobs are in the send lane but still not safe to release.",
      action_hash: buildProjectHash({ queue: "ready_to_release_queue", stage: "ready_to_release" })
    },
    {
      id: "stale_active",
      label: "Stale Active",
      value: counts.stale_active,
      tone: counts.stale_active ? "heads_up" : "neutral",
      detail: "Active jobs have not been touched recently and could get missed.",
      action_hash: buildProjectHash({ queue: "at_risk_queue" })
    },
    {
      id: "jobs_in_qa",
      label: "In QA",
      value: counts.jobs_in_qa,
      tone: counts.jobs_in_qa ? "heads_up" : "neutral",
      detail: "Jobs waiting on QA review or returned for correction.",
      action_hash: buildProjectHash({ queue: "qa_queue", stage: "ready_for_qa" })
    },
    {
      id: "ready_to_release",
      label: "Ready to Release",
      value: counts.ready_to_release,
      tone: counts.ready_to_release ? "heads_up" : "neutral",
      detail: "Jobs cleared through QA and waiting on release.",
      action_hash: buildProjectHash({ queue: "ready_to_release_queue", stage: "ready_to_release" })
    },
    {
      id: "due_within_24_hours",
      label: "Due in 24h",
      value: counts.due_within_24_hours,
      tone: counts.due_within_24_hours ? "heads_up" : "neutral",
      detail: "Jobs that are close enough to threaten release timing.",
      action_hash: buildProjectHash({ queue: "at_risk_queue" })
    },
    {
      id: "unassigned_jobs",
      label: "Unassigned",
      value: counts.unassigned_jobs,
      tone: counts.unassigned_jobs ? "heads_up" : "good",
      detail: "Production work still missing an owner or kickoff.",
      action_hash: buildProjectHash({ queue: "team_queue", ownerUserId: "unassigned" })
    }
  ];
}

function buildOwnerPressureLabel(
  owner: Pick<
    ProductionProjectHomeSnapshot["owners"][number],
    "open_count" | "overdue_count" | "qa_queue_count" | "ready_to_release_count" | "in_production_count"
  >
) {
  if (owner.overdue_count > 0) {
    return `${owner.overdue_count} overdue | ${owner.open_count} open`;
  }
  if (owner.ready_to_release_count > 0) {
    return `${owner.ready_to_release_count} ready to release`;
  }
  if (owner.qa_queue_count > 0) {
    return `${owner.qa_queue_count} in QA or correction`;
  }
  if (owner.in_production_count > 0) {
    return `${owner.in_production_count} actively in production`;
  }
  return `${owner.open_count} open project${owner.open_count === 1 ? "" : "s"}`;
}

function buildOwnerActionHash(
  owner: Pick<
    ProductionProjectHomeSnapshot["owners"][number],
    | "owner_user_id"
    | "open_count"
    | "overdue_count"
    | "qa_queue_count"
    | "ready_to_release_count"
    | "in_production_count"
  >
) {
  const ownerUserId = owner.owner_user_id ?? "unassigned";
  if (owner.overdue_count > 0) {
    return buildProjectHash({ ownerUserId, queue: "at_risk_queue", dueState: "overdue" });
  }
  if (owner.ready_to_release_count > 0) {
    return buildProjectHash({ ownerUserId, queue: "ready_to_release_queue", stage: "ready_to_release" });
  }
  if (owner.qa_queue_count > 0) {
    return buildProjectHash({ ownerUserId, queue: "qa_queue", stage: "ready_for_qa" });
  }
  if (owner.in_production_count > 0) {
    return buildProjectHash({ ownerUserId, queue: "my_queue", stage: "in_production" });
  }
  return buildProjectHash({ ownerUserId, queue: "my_queue" });
}

function toProjectFocusHomeItem(
  project: ProductionProjectSummaryRecord,
  anchorDate: string
): ProductionProjectHomeSnapshot["focus_items"][number] | null {
  if (isClosedProject(project.status) || isFutureSnoozed(project.snoozed_until, anchorDate)) {
    return null;
  }

  let queueLabel: string | null = null;
  let reviewerLabel: string | null = null;
  let tone: ProductionProjectHomeSnapshot["focus_items"][number]["tone"] = "info";

  if (project.stage === "blocked") {
    queueLabel = "Blocked";
    reviewerLabel = project.current_blocker?.blocker_owner_label ?? null;
    tone = "action_needed";
  } else if (isQaQueueProject(project)) {
    queueLabel = "QA Queue";
    reviewerLabel = project.peer_reviewer_label ? `Peer reviewer: ${project.peer_reviewer_label}` : "Peer reviewer needed";
    tone = "heads_up";
  } else if (project.stage === "ready_to_release") {
    queueLabel = "Ready To Release";
    reviewerLabel = project.final_qc_reviewer_label ? `Final QC: ${project.final_qc_reviewer_label}` : "Final QC reviewer needed";
    tone = "good";
  } else if (isAtRiskQueueProject(project, anchorDate)) {
    queueLabel = "At Risk";
    reviewerLabel = project.linked_shoot_importance_label;
    tone = project.overdue ? "action_needed" : "heads_up";
  }

  if (!queueLabel) {
    return null;
  }

  return {
    project_id: project.id,
    title: project.title,
    summary: project.summary ?? project.created_reason,
    owner_label: project.owner_label,
    stage_label: project.stage_label,
    queue_label: queueLabel,
    reviewer_label: reviewerLabel,
    due_label: project.follow_up_label ?? project.due_label,
    next_action: project.next_action,
    tone,
    action_hash: buildProjectHash({
      projectId: project.id,
      queue: classifyProjectQueue(project, anchorDate, project.owner_user_id),
      stage: project.stage,
      dueState: resolveProjectDueState(project, anchorDate)
    })
  };
}

function compareProjectFocusItems(
  left: ProductionProjectHomeSnapshot["focus_items"][number],
  right: ProductionProjectHomeSnapshot["focus_items"][number]
) {
  const toneDelta = focusToneWeight(right.tone) - focusToneWeight(left.tone);
  if (toneDelta !== 0) {
    return toneDelta;
  }
  return left.title.localeCompare(right.title);
}

function focusToneWeight(value: ProductionProjectHomeSnapshot["focus_items"][number]["tone"]) {
  if (value === "action_needed") {
    return 4;
  }
  if (value === "heads_up") {
    return 3;
  }
  if (value === "good") {
    return 2;
  }
  if (value === "info") {
    return 1;
  }
  return 0;
}

function stageTone(stage: ProductionProjectStage): ProductionProjectFlag["tone"] {
  if (stage === "blocked" || stage === "correction_needed" || stage === "cancelled") {
    return "critical";
  }
  if (stage === "ready_for_qa" || stage === "in_qa_review" || stage === "qa_hold" || stage === "on_hold") {
    return "warning";
  }
  if (stage === "released_complete" || stage === "ready_to_release") {
    return "success";
  }
  return "info";
}

function isProjectOverdue(
  project: Pick<ProductionProjectSummaryRecord, "status" | "overdue_task_count" | "due_date" | "follow_up_date">,
  anchorDate: string
) {
  return (
    !isClosedProject(project.status) &&
    (project.overdue_task_count > 0 ||
      (project.follow_up_date != null && project.follow_up_date < anchorDate) ||
      (project.follow_up_date == null && project.due_date != null && project.due_date < anchorDate))
  );
}

function toProjectUrgentHomeItem(
  project: ProductionProjectSummaryRecord,
  anchorDate: string
): ProductionProjectHomeSnapshot["urgent_items"][number] | null {
  const urgencyState = getProjectHomeUrgencyState(project, anchorDate);
  if (!urgencyState) {
    return null;
  }

  return {
    project_id: project.id,
    title: project.title,
    summary: project.next_action,
    owner_label: project.owner_label,
    stage_label: project.stage_label,
    due_label: project.follow_up_label ?? project.due_label,
    urgency_state: urgencyState,
    urgency_label: humanizeProjectUrgencyState(urgencyState),
    action_hash: buildProjectHash({
      projectId: project.id,
      queue: classifyProjectQueue(project, anchorDate, project.owner_user_id),
      stage: project.stage,
      dueState: resolveProjectDueState(project, anchorDate)
    })
  };
}

function compareProjectHomeUrgency(
  left: ProductionProjectHomeSnapshot["urgent_items"][number],
  right: ProductionProjectHomeSnapshot["urgent_items"][number]
) {
  const urgencyDelta = projectUrgencyWeight(right.urgency_state) - projectUrgencyWeight(left.urgency_state);
  if (urgencyDelta !== 0) {
    return urgencyDelta;
  }
  return left.title.localeCompare(right.title);
}

function getProjectHomeUrgencyState(
  project: Pick<
    ProductionProjectSummaryRecord,
    | "status"
    | "stage"
    | "due_date"
    | "follow_up_date"
    | "overdue_task_count"
    | "snoozed_until"
      | "final_qc_required"
      | "pending_peer_review"
      | "pending_final_qc"
      | "release_blocked"
      | "stale_active"
      | "waiting_to_send"
  >,
  anchorDate: string
): ProductionProjectHomeSnapshot["urgent_items"][number]["urgency_state"] | null {
  if (isClosedProject(project.status) || isFutureSnoozed(project.snoozed_until, anchorDate)) {
    return null;
  }
  if (isProjectOverdue(project, anchorDate)) {
    return "overdue";
  }
  if (isProjectActionNeededToday(project, anchorDate)) {
    return "action_needed_today";
  }
  if (isProjectDueWithin24Hours(project, anchorDate)) {
    return "due_within_24h";
  }
  return null;
}

function isProjectOnTime(
  project: Pick<
    ProductionProjectSummaryRecord,
    | "status"
    | "overdue_task_count"
    | "due_date"
    | "follow_up_date"
    | "snoozed_until"
    | "due_within_24_hours"
    | "stage"
    | "pending_peer_review"
    | "pending_final_qc"
    | "final_qc_required"
    | "release_blocked"
    | "stale_active"
    | "waiting_to_send"
  >,
  anchorDate: string
) {
  if (isClosedProject(project.status) || isFutureSnoozed(project.snoozed_until, anchorDate)) {
    return false;
  }
  return (
    !isProjectOverdue(project, anchorDate) &&
    !project.due_within_24_hours &&
    project.stage !== "blocked" &&
    !isPeerReviewLagProject(project, anchorDate) &&
    !isFinalQcLagProject(project, anchorDate) &&
    !isReleaseBlockerProject(project, anchorDate) &&
    !project.stale_active
  );
}

function isInProductionProject(project: Pick<ProductionProjectSummaryRecord, "status" | "stage">) {
  return !isClosedProject(project.status) && (project.stage === "ready_for_production" || project.stage === "in_production");
}

function isChangesRequested(project: Pick<ProductionProjectSummaryRecord, "status" | "stage">) {
  return !isClosedProject(project.status) && (project.stage === "correction_needed" || project.status === "blocked");
}

function isReadyForRelease(project: Pick<ProductionProjectSummaryRecord, "status" | "stage" | "release_blocked">) {
  return !isClosedProject(project.status) && project.stage === "ready_to_release" && !project.release_blocked;
}

function isProjectActionNeededToday(
  project: Pick<
    ProductionProjectSummaryRecord,
    | "status"
    | "stage"
    | "due_date"
    | "follow_up_date"
    | "overdue_task_count"
    | "final_qc_required"
    | "release_blocked"
    | "pending_peer_review"
    | "pending_final_qc"
    | "stale_active"
    | "waiting_to_send"
  >,
  anchorDate: string
) {
  return (
    !isClosedProject(project.status) &&
    ((project.follow_up_date != null && project.follow_up_date === anchorDate) ||
      (project.follow_up_date == null && project.due_date != null && project.due_date === anchorDate) ||
      isPeerReviewLagProject(project, anchorDate) ||
      isFinalQcLagProject(project, anchorDate) ||
      isChangesRequested(project) ||
      isReleaseBlockerProject(project, anchorDate) ||
      project.stale_active)
  );
}

function isPeerReviewLagProject(
  project: Pick<
    ProductionProjectSummaryRecord,
    "status" | "stage" | "pending_peer_review" | "stale_active" | "due_date" | "follow_up_date" | "overdue_task_count"
  >,
  anchorDate: string
) {
  return !isClosedProject(project.status) && isAwaitingPeerReview(project) && (project.stale_active || isProjectOverdue(project, anchorDate));
}

function isFinalQcLagProject(
  project: Pick<
    ProductionProjectSummaryRecord,
    "status" | "stage" | "final_qc_required" | "pending_final_qc" | "stale_active" | "due_date" | "follow_up_date" | "overdue_task_count"
  >,
  anchorDate: string
) {
  return !isClosedProject(project.status) && isAwaitingFinalQc(project) && (project.stale_active || isProjectOverdue(project, anchorDate));
}

function isReleaseBlockerProject(
  project: Pick<
    ProductionProjectSummaryRecord,
    "status" | "release_blocked" | "waiting_to_send" | "pending_peer_review" | "pending_final_qc"
  >,
  anchorDate: string
) {
  void anchorDate;
  return (
    !isClosedProject(project.status) &&
    project.release_blocked &&
    project.waiting_to_send &&
    !project.pending_peer_review &&
    !project.pending_final_qc
  );
}

function isHomeAttentionProject(
  project: Pick<
    ProductionProjectSummaryRecord,
    | "status"
    | "stage"
    | "blocker_count"
    | "blocked_task_count"
    | "due_date"
    | "follow_up_date"
    | "overdue_task_count"
    | "pending_peer_review"
    | "pending_final_qc"
    | "final_qc_required"
    | "release_blocked"
    | "stale_active"
    | "waiting_to_send"
  >,
  anchorDate: string
) {
  return (
    !isClosedProject(project.status) &&
    (isProjectOverdue(project, anchorDate) ||
      isBlockedProject(project) ||
      isPeerReviewLagProject(project, anchorDate) ||
      isFinalQcLagProject(project, anchorDate) ||
      isReleaseBlockerProject(project, anchorDate) ||
      project.stale_active)
  );
}

function isProjectDueWithin24Hours(
  project: Pick<ProductionProjectSummaryRecord, "status" | "due_date" | "follow_up_date" | "snoozed_until">,
  anchorDate: string
) {
  if (isClosedProject(project.status) || isFutureSnoozed(project.snoozed_until, anchorDate)) {
    return false;
  }
  const nextDate = addDays(anchorDate, 1);
  const dueTarget = project.follow_up_date ?? project.due_date;
  return dueTarget === anchorDate || dueTarget === nextDate;
}

function isAwaitingPeerReview(
  project: Pick<ProductionProjectSummaryRecord, "status" | "stage" | "pending_peer_review">
) {
  return !isClosedProject(project.status) && (project.pending_peer_review || project.stage === "ready_for_qa" || project.stage === "in_qa_review");
}

function isAwaitingFinalQc(
  project: Pick<ProductionProjectSummaryRecord, "status" | "stage" | "final_qc_required" | "pending_final_qc">
) {
  return !isClosedProject(project.status) && project.final_qc_required && (project.pending_final_qc || project.stage === "ready_to_release");
}

function resolveProjectDueState(
  project: Pick<
    ProductionProjectSummaryRecord,
    "status" | "overdue_task_count" | "due_date" | "follow_up_date" | "snoozed_until"
  >,
  anchorDate: string
): ProductionProjectDueState | null {
  if (isClosedProject(project.status) || isFutureSnoozed(project.snoozed_until, anchorDate)) {
    return null;
  }
  if (isProjectOverdue(project, anchorDate)) {
    return "overdue";
  }
  const dueTarget = project.follow_up_date ?? project.due_date;
  if (!dueTarget) {
    return "unscheduled";
  }
  if (dueTarget === anchorDate) {
    return "due_today";
  }
  if (dueTarget > anchorDate) {
    return "upcoming";
  }
  return null;
}

function humanizeProjectUrgencyState(
  value: ProductionProjectHomeSnapshot["urgent_items"][number]["urgency_state"]
) {
  switch (value) {
    case "overdue":
      return "Overdue";
    case "due_within_24h":
      return "Due within 24h";
    default:
      return "Action needed today";
  }
}

function projectUrgencyWeight(
  value: ProductionProjectHomeSnapshot["urgent_items"][number]["urgency_state"]
) {
  if (value === "overdue") {
    return 3;
  }
  if (value === "action_needed_today") {
    return 2;
  }
  return 1;
}

function humanizeProjectCategory(value: ProductionProjectCategory) {
  switch (value) {
    case "photography_production":
      return "Photography Production";
    case "digital_production":
      return "Post-Shoot Production";
    case "qa_peer_review":
      return "QA / Peer Review";
    case "remediation":
      return "Remediation";
    default:
      return "Production Follow-Up";
  }
}

function humanizeProductionWorkflowFamily(value: ProductionProjectWorkflowFamily) {
  switch (value) {
    case "schools":
      return "Schools";
    case "sports":
      return "Sports";
    default:
      return "General";
  }
}

function humanizeProductionWorkflowMode(value: ProductionProjectWorkflowMode) {
  switch (value) {
    case "manual_follow_up":
      return "Manual Follow-Up";
    case "post_shoot_wrap":
      return "Post-Shoot Wrap";
    case "digital_delivery":
      return "Digital Delivery";
    case "issue_remediation":
      return "Issue Remediation";
    case "resource_follow_up":
      return "Resource Follow-Up";
    default:
      return humanizeValue(value);
  }
}

function humanizeProductionWorkflowSeason(value: ProductionProjectWorkflowSeason) {
  switch (value) {
    case "spring":
      return "Spring";
    case "fall":
      return "Fall";
    default:
      return "All Year";
  }
}

function humanizeProjectStage(value: ProductionProjectStage) {
  switch (value) {
    case "intake_pending":
      return "Intake Pending";
    case "ready_for_production":
      return "Ready for Production";
    case "in_production":
      return "In Production";
    case "blocked":
      return "Blocked";
    case "ready_for_qa":
      return "Ready for QA";
    case "in_qa_review":
      return "In QA Review";
    case "qa_hold":
      return "QA Hold";
    case "correction_needed":
      return "Correction Needed";
    case "ready_to_release":
      return "Ready to Release";
    case "released_complete":
      return "Released / Complete";
    case "on_hold":
      return "On Hold";
    case "cancelled":
      return "Cancelled";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectJobType(value: ProductionProjectJobType) {
  switch (value) {
    case "standard_school_production":
      return "Standard School Production";
    case "sports_production":
      return "Sports Production";
    case "specialty_graphics":
      return "Specialty / Graphics";
    case "banner_specialty_product":
      return "Banner / Specialty Product";
    case "gallery_prep_upload":
      return "Gallery Prep / Upload";
    case "qa_final_review":
      return "QA / Final Review";
    case "correction_rework":
      return "Correction / Rework";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectQaState(value: ProductionProjectQaState) {
  switch (value) {
    case "ready_for_qa":
      return "Ready for QA";
    case "in_qa_review":
      return "In QA Review";
    case "qa_hold":
      return "QA Hold";
    case "correction_needed":
      return "Correction Needed";
    case "peer_review_required":
      return "Peer Review Required";
    case "final_review_required":
      return "Final Review Required";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectReleaseState(value: ProductionProjectReleaseState) {
  switch (value) {
    case "not_ready":
      return "Not Ready";
    case "ready_to_release":
      return "Ready to Release";
    default:
      return "Released";
  }
}

function humanizeProjectHealthSignal(value: ProductionProjectHealthSignal) {
  switch (value) {
    case "due_soon":
      return "Due Soon";
    case "release_risk":
      return "Release Risk";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectTeamOwner(value: ProductionProjectTeamOwner) {
  switch (value) {
    case "qa":
      return "QA";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectOwnershipState(value: ProductionProjectOwnershipState) {
  switch (value) {
    case "in_progress":
      return "In Progress";
    case "waiting_review":
      return "Waiting Review";
    case "returned_for_correction":
      return "Returned for Correction";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectReviewResult(value: ProductionProjectReviewResult) {
  if (value === "correction_needed") {
    return "Correction Needed";
  }
  return humanizeValue(value);
}

function humanizeProductionExceptionStatus(value: "open" | "resolved" | "dismissed") {
  switch (value) {
    case "open":
      return "Open";
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
    default:
      return humanizeValue(value);
  }
}

function humanizeProductionExceptionSeverity(value: "low" | "normal" | "high" | "critical") {
  switch (value) {
    case "low":
      return "Low";
    case "normal":
      return "Normal";
    case "high":
      return "High";
    case "critical":
      return "Critical";
    default:
      return humanizeValue(value);
  }
}

function humanizeProductionExceptionType(value: ProjectExceptionRow["exception_type"]) {
  switch (value) {
    case "buddy_unresolved_group":
      return "Buddy group unresolved";
    case "buddy_duplicate_handling_needed":
      return "Buddy duplicate handling needed";
    case "vt_ambiguous_match":
      return "Virtual team match ambiguous";
    case "vt_coach_tag_missing":
      return "Coach tag missing";
    case "vt_split_group_mismatch":
      return "Split-by-group mismatch";
    case "vt_attribute_validation_failed":
      return "Virtual team attributes not validated";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectTaskType(value: ProductionProjectTaskType) {
  switch (value) {
    case "peer_review":
      return "Peer Review";
    case "final_qc":
      return "Final QC";
    case "handoff":
      return "Handoff";
    default:
      return humanizeValue(value);
  }
}

function humanizeProjectTaskDependencyState(value: ProductionProjectTaskDependencyState) {
  switch (value) {
    case "blocked":
      return "Waiting on Dependency";
    case "complete":
      return "Complete";
    default:
      return "Ready";
  }
}

function humanizeProjectBlockerType(value: ProductionProjectBlockerType) {
  switch (value) {
    case "bad_incomplete_data":
      return "Bad or Incomplete Data";
    case "waiting_on_decision":
      return "Waiting on Decision";
    case "waiting_on_customer_school":
      return "Waiting on Customer / School";
    case "upload_failure":
      return "Upload Failure";
    case "qa_issue":
      return "QA Issue";
    case "system_tool_problem":
      return "System / Tool Problem";
    case "staffing_capacity_issue":
      return "Staffing Capacity Issue";
    case "external_vendor_dependency":
      return "External Vendor Dependency";
    default:
      return humanizeValue(value);
  }
}

function humanizeShootImportanceTier(value: ShootImportanceTier) {
  if (value === "big_shoot") {
    return "Big Shoot";
  }
  if (value === "critical_shoot") {
    return "Critical Shoot";
  }
  return humanizeValue(value);
}

function deriveDefaultStageForJobType(jobType: ProductionProjectJobType, status: ProductionProjectStatus): ProductionProjectStage {
  if (status === "completed") {
    return "released_complete";
  }
  if (status === "canceled") {
    return "cancelled";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (jobType === "qa_final_review") {
    return "ready_for_qa";
  }
  if (jobType === "correction_rework") {
    return "correction_needed";
  }
  return "intake_pending";
}

function deriveReviewRequirements(
  category: ProductionProjectCategory,
  template: { peer_review_required: boolean; final_qc_required: boolean } | null
) {
  if (template) {
    return {
      peerReviewRequired: template.peer_review_required,
      finalQcRequired: template.final_qc_required
    };
  }
  const peerReviewRequired = category === "photography_production" || category === "digital_production" || category === "qa_peer_review";
  const finalQcRequired = category === "photography_production" || category === "digital_production";
  return { peerReviewRequired, finalQcRequired };
}

function buildQueueLabel(queueId: ProductionProjectQueueId) {
  switch (queueId) {
    case "my_queue":
      return "My Queue";
    case "blocked_queue":
      return "Blocked Queue";
    case "qa_queue":
      return "QA Queue";
    case "ready_to_release_queue":
      return "Ready to Release";
    case "at_risk_queue":
      return "Overdue / At Risk";
    default:
      return "Team Queue";
  }
}

function buildQueueSummary(queueId: ProductionProjectQueueId) {
  switch (queueId) {
    case "my_queue":
      return "Production work currently owned by you.";
    case "blocked_queue":
      return "Jobs blocked on files, decisions, QA, systems, or external dependencies.";
    case "qa_queue":
      return "Jobs waiting on QA review or returned for correction.";
    case "ready_to_release_queue":
      return "Jobs that cleared QA and are waiting on final release.";
    case "at_risk_queue":
      return "Jobs that are overdue, due within 24 hours, unassigned, or slipping.";
    default:
      return "Open team production work that is moving without immediate queue risk.";
  }
}

function matchesPostQueryProjectFilters(project: ProductionProjectSummaryRecord, options: ProjectListOptions) {
  if (options.teamOwner && project.team_owner !== options.teamOwner) {
    return false;
  }
  if (options.bigCriticalOnly && !project.linked_shoot_importance_tier) {
    return false;
  }
  if (
    options.bigCriticalOnly &&
    project.linked_shoot_importance_tier !== "big_shoot" &&
    project.linked_shoot_importance_tier !== "critical_shoot"
  ) {
    return false;
  }
  return true;
}

function resolveProjectTeamOwner(jobType: ProductionProjectJobType, stage: ProductionProjectStage): ProductionProjectTeamOwner {
  if (stage === "ready_for_qa" || stage === "in_qa_review") {
    return "qa";
  }
  if (stage === "ready_to_release" || stage === "released_complete") {
    return "release";
  }
  if (stage === "correction_needed") {
    return "corrections";
  }
  switch (jobType) {
    case "specialty_graphics":
    case "banner_specialty_product":
      return "graphics";
    case "gallery_prep_upload":
      return "upload";
    case "qa_final_review":
      return "qa";
    case "correction_rework":
      return "corrections";
    default:
      return "production";
  }
}

function deriveProjectOwnershipState(
  stage: ProductionProjectStage,
  status: ProductionProjectStatus,
  ownerUserId: string | null
): ProductionProjectOwnershipState {
  if (status === "completed" || stage === "released_complete") {
    return "complete";
  }
  if (!ownerUserId) {
    return "unassigned";
  }
  if (stage === "correction_needed") {
    return "returned_for_correction";
  }
  if (stage === "ready_for_qa" || stage === "in_qa_review" || stage === "ready_to_release") {
    return "waiting_review";
  }
  if (stage === "in_production") {
    return "in_progress";
  }
  return "assigned";
}

function deriveProjectHealthSignal(input: {
  stage: ProductionProjectStage;
  status: ProductionProjectStatus;
  priority: ProductionProjectPriority;
  ownerUserId: string | null;
  dueDate: string | null;
  followUpDate: string | null;
  openRequiredTaskCount: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  pendingPeerReview: boolean;
  pendingFinalQc: boolean;
  releaseBlocked: boolean;
  dueWithin24Hours: boolean;
  overdue: boolean;
  blockerCount: number;
  linkedShootImportanceTier: ShootImportanceTier | null;
}): ProductionProjectHealthSignal {
  const bigOrCritical =
    input.linkedShootImportanceTier === "big_shoot" || input.linkedShootImportanceTier === "critical_shoot";
  if (input.stage === "blocked" || input.blockerCount > 0 || input.blockedTaskCount > 0) {
    return bigOrCritical || input.priority === "critical" ? "escalated" : "blocked";
  }
  if (input.overdue || input.overdueTaskCount > 0) {
    return bigOrCritical || input.priority === "critical" ? "escalated" : "overdue";
  }
  if (input.releaseBlocked || input.pendingPeerReview || input.pendingFinalQc || input.stage === "correction_needed" || input.stage === "ready_to_release") {
    return input.dueWithin24Hours ? "release_risk" : "fragile";
  }
  if (!input.ownerUserId || !input.dueDate || input.openRequiredTaskCount > 0) {
    return "fragile";
  }
  if (input.dueWithin24Hours) {
    return "due_soon";
  }
  return "healthy";
}

function evaluateLinkedShootImportance(row: ProjectRow): { tier: ShootImportanceTier; score: number } | null {
  if (!row.linked_shoot_id) {
    return null;
  }
  const priority = evaluateShootPriority({
    projectedHeadcount: row.shoot_projected_students == null ? null : Number(row.shoot_projected_students),
    photographerHeadcount: row.shoot_template_photographer_count == null ? null : Number(row.shoot_template_photographer_count),
    assignedStaffCount:
      row.shoot_template_photographer_count == null ? null : Number(row.shoot_template_photographer_count) - Number(row.shoot_missing_staffing_coverage_count ?? 0),
    plannedStaffCount:
      row.shoot_template_photographer_count == null ? null : Number(row.shoot_template_photographer_count),
    estimatedDriveMinutes: row.shoot_estimated_drive_minutes == null ? null : Number(row.shoot_estimated_drive_minutes),
    cameraStationCount: row.shoot_camera_station_count == null ? null : Number(row.shoot_camera_station_count),
    firstYearCustomerFlag: Boolean(row.shoot_first_year_customer_flag),
    flagshipPriorityAccountFlag: Boolean(row.shoot_flagship_priority_account_flag),
    strategicDistrictImportance: Boolean(row.shoot_strategic_district_importance),
    revenuePotentialScore: row.shoot_revenue_potential_score == null ? null : Number(row.shoot_revenue_potential_score),
    accountGrowthImportanceScore:
      row.shoot_account_growth_importance_score == null ? null : Number(row.shoot_account_growth_importance_score),
    complexityScore: row.shoot_complexity_score == null ? null : Number(row.shoot_complexity_score),
    customerHistoryRiskScore:
      row.shoot_customer_history_risk_score == null ? null : Number(row.shoot_customer_history_risk_score),
    multiTeamCoordination: Boolean(row.shoot_multi_team_coordination),
    missingStaffingCoverageCount: Number(row.shoot_missing_staffing_coverage_count ?? 0),
    missingRequiredPrepCount: Number(row.shoot_missing_required_prep_count ?? 0),
    weatherTravelRiskFlag: Boolean(row.shoot_weather_travel_risk_flag),
    manualLeadershipBoost: row.shoot_manual_leadership_boost == null ? null : Number(row.shoot_manual_leadership_boost),
    importanceOverrideTier: row.shoot_importance_override_tier ?? null,
    importanceOverrideReason: row.shoot_importance_override_reason ?? null
  });

  return {
    tier: priority.priorityLabel,
    score: priority.weightedScore
  };
}

function compareProjectQueueOrder(
  left: ProductionProjectSummaryRecord,
  right: ProductionProjectSummaryRecord,
  anchorDate: string
) {
  const weightDelta = projectQueuePriorityWeight(left, anchorDate) - projectQueuePriorityWeight(right, anchorDate);
  if (weightDelta !== 0) {
    return weightDelta;
  }
  const leftDue = left.follow_up_date ?? left.due_date ?? "9999-12-31";
  const rightDue = right.follow_up_date ?? right.due_date ?? "9999-12-31";
  if (leftDue !== rightDue) {
    return leftDue.localeCompare(rightDue);
  }
  return right.updated_at.localeCompare(left.updated_at);
}

function compareProjectLeadBoardOrder(
  left: ProductionProjectSummaryRecord,
  right: ProductionProjectSummaryRecord,
  anchorDate: string,
  sortBy: ProductionLeadBoardSort
) {
  switch (sortBy) {
    case "due_date": {
      const leftDue = left.follow_up_date ?? left.due_date ?? "9999-12-31";
      const rightDue = right.follow_up_date ?? right.due_date ?? "9999-12-31";
      if (leftDue !== rightDue) {
        return leftDue.localeCompare(rightDue);
      }
      return right.updated_at.localeCompare(left.updated_at);
    }
    case "priority": {
      const weightDelta = priorityWeight(left.priority) - priorityWeight(right.priority);
      if (weightDelta !== 0) {
        return weightDelta;
      }
      return left.title.localeCompare(right.title);
    }
    case "last_touched":
      return right.updated_at.localeCompare(left.updated_at) || left.title.localeCompare(right.title);
    case "owner":
      return left.owner_label.localeCompare(right.owner_label) || left.title.localeCompare(right.title);
    case "current_step":
      return (
        compareNullableNumber(left.current_step_order, right.current_step_order) ||
        left.current_step_label.localeCompare(right.current_step_label) ||
        left.title.localeCompare(right.title)
      );
    default: {
      const weightDelta = projectLeadBoardPriorityWeight(left, anchorDate) - projectLeadBoardPriorityWeight(right, anchorDate);
      if (weightDelta !== 0) {
        return weightDelta;
      }
      const leftDue = left.follow_up_date ?? left.due_date ?? "9999-12-31";
      const rightDue = right.follow_up_date ?? right.due_date ?? "9999-12-31";
      if (leftDue !== rightDue) {
        return leftDue.localeCompare(rightDue);
      }
      return right.updated_at.localeCompare(left.updated_at);
    }
  }
}

function compareNullableNumber(left: number | null, right: number | null) {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function priorityWeight(priority: ProductionProjectPriority) {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "normal":
      return 2;
    default:
      return 3;
  }
}

function projectLeadBoardPriorityWeight(project: ProductionProjectSummaryRecord, anchorDate: string) {
  if (project.overdue || project.overdue_task_count > 0) {
    return 0;
  }
  if (isBlockedProject(project)) {
    return 1;
  }
  if (project.corrections_needed) {
    return 2;
  }
  if (project.stale_active) {
    return 3;
  }
  if (project.due_within_24_hours) {
    return 4;
  }
  if (project.ready_to_send) {
    return 5;
  }
  if (project.waiting_to_send) {
    return 6;
  }
  return projectQueuePriorityWeight(project, anchorDate) + 10;
}

function matchesLeadBoardFocus(project: ProductionProjectSummaryRecord, focus: ProductionLeadBoardFocus) {
  switch (focus) {
    case "blocked":
      return project.blocker_count > 0 || project.blocked_task_count > 0 || project.stage === "blocked";
    case "overdue":
      return project.overdue || project.overdue_task_count > 0;
    case "waiting":
      return project.status === "waiting" || project.pending_peer_review || project.pending_final_qc || project.waiting_to_send;
    default:
      return true;
  }
}

function projectQueuePriorityWeight(project: ProductionProjectSummaryRecord, anchorDate: string) {
  const bigOrCritical =
    project.linked_shoot_importance_tier === "big_shoot" || project.linked_shoot_importance_tier === "critical_shoot";
  if (isBlockedProject(project) && (bigOrCritical || project.priority === "critical")) {
    return 0;
  }
  if (project.due_within_24_hours) {
    return 1;
  }
  if (project.overdue) {
    return 2;
  }
  if (bigOrCritical) {
    return 3;
  }
  if (project.priority === "critical") {
    return 4;
  }
  if (project.priority === "high") {
    return 5;
  }
  if (classifyProjectQueue(project, anchorDate, project.owner_user_id) === "blocked_queue") {
    return 6;
  }
  return 7;
}

function isBlockedProject(project: Pick<ProductionProjectSummaryRecord, "status" | "stage" | "blocker_count" | "blocked_task_count">) {
  return !isClosedProject(project.status) && (project.stage === "blocked" || project.blocker_count > 0 || project.blocked_task_count > 0);
}

function isQaQueueProject(
  project: Pick<ProductionProjectSummaryRecord, "status" | "stage" | "pending_peer_review" | "pending_final_qc">
) {
  return (
    !isClosedProject(project.status) &&
    (project.pending_peer_review || project.pending_final_qc || ["ready_for_qa", "in_qa_review", "correction_needed"].includes(project.stage))
  );
}

function isAtRiskQueueProject(
  project: Pick<
    ProductionProjectSummaryRecord,
    | "status"
    | "owner_user_id"
    | "due_within_24_hours"
    | "overdue"
    | "stage"
    | "health_signal"
    | "release_blocked"
    | "overdue_task_count"
  >,
  _anchorDate: string
) {
  return (
    !isClosedProject(project.status) &&
    (!project.owner_user_id ||
      project.overdue ||
      project.overdue_task_count > 0 ||
      project.due_within_24_hours ||
      project.release_blocked ||
      project.stage === "correction_needed" ||
      project.health_signal === "fragile" ||
      project.health_signal === "release_risk" ||
      project.health_signal === "escalated")
  );
}

function isMyQueueProject(project: Pick<ProductionProjectSummaryRecord, "status" | "owner_user_id">, currentUserId: string | null) {
  return Boolean(currentUserId && !isClosedProject(project.status) && project.owner_user_id === currentUserId);
}

function resolveProductionWorkspaceView(
  auth: Pick<AuthUser, "authorityTier" | "department" | "primaryJobFunctionProfile" | "jobFunctionProfiles">
): ProductionProjectWorkspaceView {
  const profiles = new Set([auth.primaryJobFunctionProfile, ...(auth.jobFunctionProfiles ?? [])]);
  if (
    auth.authorityTier === "super_admin" ||
    auth.authorityTier === "leadership" ||
    auth.authorityTier === "director_admin" ||
    profiles.has("director_of_digital_production") ||
    (auth.department === "production" && auth.authorityTier === "supervisor")
  ) {
    return "lead_board";
  }
  return "staff_workspace";
}

function deriveLegacyStatusForStage(stage: ProductionProjectStage): ProductionProjectStatus {
  switch (stage) {
    case "intake_pending":
      return "new";
    case "ready_for_production":
    case "in_production":
      return "active";
    case "blocked":
    case "correction_needed":
      return "blocked";
    case "ready_for_qa":
    case "in_qa_review":
    case "ready_to_release":
    case "on_hold":
      return "waiting";
    case "released_complete":
      return "completed";
    case "cancelled":
      return "canceled";
    default:
      return "active";
  }
}

function deriveQaStateFromStage(
  stage: ProductionProjectStage,
  options: { peerReviewRequired: boolean; finalQcRequired: boolean }
): ProductionProjectQaState {
  switch (stage) {
    case "ready_for_qa":
      return options.peerReviewRequired ? "peer_review_required" : "ready_for_qa";
    case "in_qa_review":
      return "in_qa_review";
    case "qa_hold":
      return "qa_hold";
    case "correction_needed":
      return "correction_needed";
    case "ready_to_release":
    case "released_complete":
      return options.finalQcRequired ? "final_review_required" : "passed";
    default:
      return "not_started";
  }
}

function deriveReleaseStateFromStage(stage: ProductionProjectStage): ProductionProjectReleaseState {
  if (stage === "ready_to_release") {
    return "ready_to_release";
  }
  if (stage === "released_complete") {
    return "released";
  }
  return "not_ready";
}

function derivePreviousActiveStage(current: Pick<ProjectRow, "stage" | "previous_active_stage">, nextStage: ProductionProjectStage) {
  const currentStage = current.stage;
  const previousActiveStage = current.previous_active_stage;

  if (nextStage === "blocked" || nextStage === "on_hold") {
    return currentStage === "blocked" || currentStage === "on_hold"
      ? previousActiveStage ?? "in_production"
      : currentStage;
  }
  if (currentStage === "on_hold") {
    return previousActiveStage ?? nextStage;
  }
  return previousActiveStage ?? null;
}

function assertProductionStageTransitionRights(
  auth: AuthUser,
  input: {
    currentStage: ProductionProjectStage;
    nextStage: ProductionProjectStage;
    currentPreviousActiveStage: ProductionProjectStage | null;
    note: string | null;
  }
) {
  if (input.currentStage === input.nextStage) {
    return;
  }

  const note = input.note?.trim() ?? "";
  const allowed = new Map<ProductionProjectStage, ProductionProjectStage[]>([
    ["intake_pending", ["ready_for_production", "blocked", "on_hold", "cancelled"]],
    ["ready_for_production", ["in_production", "ready_for_qa", "ready_to_release", "blocked", "on_hold", "cancelled"]],
    ["in_production", ["ready_for_qa", "ready_to_release", "blocked", "on_hold", "cancelled"]],
    ["blocked", [input.currentPreviousActiveStage ?? "in_production", "on_hold", "cancelled"]],
    ["ready_for_qa", ["in_qa_review", "qa_hold", "correction_needed", "ready_to_release", "on_hold"]],
    ["in_qa_review", ["correction_needed", "qa_hold", "ready_to_release", "blocked", "on_hold"]],
    ["qa_hold", ["in_qa_review", "correction_needed", "ready_to_release", "on_hold", "blocked"]],
    ["correction_needed", ["in_production", "ready_for_qa", "on_hold"]],
    ["ready_to_release", ["released_complete", "correction_needed", "on_hold"]],
    ["on_hold", [input.currentPreviousActiveStage ?? "in_production", "cancelled"]],
    ["released_complete", ["ready_to_release", "correction_needed", "in_production"]],
    ["cancelled", []]
  ]);

  if (!(allowed.get(input.currentStage) ?? []).includes(input.nextStage)) {
    throw new ApiError(400, `Cannot move a production job from ${humanizeProjectStage(input.currentStage)} to ${humanizeProjectStage(input.nextStage)}.`);
  }

  const isProductionOperator =
    hasManagerApprovalAuthority(auth) ||
    auth.department === "production" ||
    auth.jobFunctionProfiles.includes("graphic_artist") ||
    auth.jobFunctionProfiles.includes("director_of_digital_production");

  if (!isProductionOperator) {
    throw new ApiError(403, "Only authorized production staff, managers, leadership, or admins can change production workflow stages.");
  }

  if (input.nextStage === "on_hold" && !hasManagerApprovalAuthority(auth)) {
    throw new ApiError(403, "Only a manager, leadership user, or admin can place a production job On Hold.");
  }

  if (input.nextStage === "cancelled" && !hasLeadershipApprovalAuthority(auth)) {
    throw new ApiError(403, "Only leadership or admin can cancel a production job in Phase 1.");
  }

  if (input.nextStage === "cancelled" && !note) {
    throw new ApiError(400, "Cancelling a production job requires a reason.");
  }

  if (input.currentStage === "released_complete" && input.nextStage !== "released_complete") {
    if (!hasLeadershipApprovalAuthority(auth)) {
      throw new ApiError(403, "Only leadership or admin can reopen a released production job.");
    }
    if (!note) {
      throw new ApiError(400, "Reopening a released production job requires a reason.");
    }
  }
}

async function syncProjectBlocker(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    currentBlockerId: string | null;
    nextStage: ProductionProjectStage;
    blockerType: ProductionProjectBlockerType | null;
    blockerOwnerUserId: string | null;
    blockerReason: string | null;
    blockerDependency: string | null;
    blockerExpectedResolutionDate: string | null;
    blockerNotes: string | null;
    clearBlocker: boolean;
    resolutionNote: string | null;
  }
) {
  if (input.nextStage === "blocked") {
    if (input.currentBlockerId) {
      await client.query(
        `
          UPDATE production_project_blocker
          SET
            blocker_type = $4::production_project_blocker_type,
            blocker_owner_user_id = $5::uuid,
            reason = $6,
            dependency = $7,
            expected_resolution_date = $8::date,
            notes = $9
          WHERE tenant_id = $1
            AND project_id = $2
            AND id = $3
        `,
        [
          input.tenantId,
          input.projectId,
          input.currentBlockerId,
          input.blockerType ?? "other",
          input.blockerOwnerUserId,
          input.blockerReason ?? "Blocked",
          input.blockerDependency,
          input.blockerExpectedResolutionDate,
          input.blockerNotes
        ]
      );
      return;
    }

    await client.query(
      `
        INSERT INTO production_project_blocker (
          tenant_id,
          project_id,
          blocker_type,
          blocker_owner_user_id,
          reason,
          dependency,
          expected_resolution_date,
          notes,
          created_by_user_id
        )
        VALUES ($1, $2, $3::production_project_blocker_type, $4::uuid, $5, $6, $7::date, $8, $9::uuid)
      `,
      [
        input.tenantId,
        input.projectId,
        input.blockerType ?? "other",
        input.blockerOwnerUserId,
        input.blockerReason ?? "Blocked",
        input.blockerDependency,
        input.blockerExpectedResolutionDate,
        input.blockerNotes,
        input.actorUserId
      ]
    );
    return;
  }

  if (!input.currentBlockerId) {
    return;
  }

  await client.query(
    `
      UPDATE production_project_blocker
      SET
        resolved_at = now(),
        resolved_by_user_id = $4,
        notes = COALESCE($5, notes)
      WHERE tenant_id = $1
        AND project_id = $2
        AND id = $3
        AND resolved_at IS NULL
    `,
    [input.tenantId, input.projectId, input.currentBlockerId, input.actorUserId, input.resolutionNote]
  );
}

async function maybeRecordProductionReview(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    currentStage: ProductionProjectStage;
    nextStage: ProductionProjectStage;
    correctionReason: string | null;
    note: string | null;
    reviewerUserId: string | null;
    reassignedOwnerUserId: string | null;
    qaChecks: ProductionProjectQaCheckRecord[] | null;
    qaChecklistComplete: boolean;
  }
) {
  let result: ProductionProjectReviewResult | null = null;
  if (input.nextStage === "correction_needed" && input.currentStage !== "correction_needed") {
    result = "correction_needed";
  } else if (input.nextStage === "ready_to_release" && input.currentStage !== "ready_to_release") {
    result = "passed";
  } else if (input.nextStage === "released_complete" && input.currentStage !== "released_complete") {
    result = "released";
  } else if (input.nextStage === "blocked" && input.currentStage !== "blocked") {
    result = "blocked";
  }

  if (!result) {
    return;
  }

  await client.query(
    `
      INSERT INTO production_project_review (
        tenant_id,
        project_id,
        reviewer_user_id,
        review_stage,
        result,
        correction_reason,
        note,
        reassigned_owner_user_id,
        qa_checks,
        qa_checklist_complete
      )
      VALUES ($1, $2, $3::uuid, $4::production_project_stage, $5::production_project_review_result, $6, $7, $8::uuid, $9::jsonb, $10::boolean)
    `,
    [
      input.tenantId,
      input.projectId,
      input.reviewerUserId ?? input.actorUserId,
      input.nextStage,
      result,
      input.correctionReason,
      input.note,
      input.reassignedOwnerUserId,
      input.qaChecks ? JSON.stringify(input.qaChecks) : null,
      input.qaChecklistComplete
    ]
  );
}

async function loadProductionProjectWorkflowGate(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  options: { includeReleaseTasksAsOpen: boolean }
): Promise<ProductionProjectWorkflowGate> {
  const result = await client.query<{
    open_required_task_count: number;
    blocked_task_count: number;
    overdue_task_count: number;
    pending_peer_review: boolean;
    pending_final_qc: boolean;
    pending_release_tasks: number;
    blocked_reasons: string[] | null;
  }>(
    `
      WITH task_context AS (
        SELECT
          task.id,
          task.status::text AS status,
          task.required,
          task.task_type::text AS task_type,
          task.due_date::text AS due_date,
          EXISTS (
            SELECT 1
            FROM production_project_task_dependency dependency
            JOIN production_project_task predecessor
              ON predecessor.tenant_id = dependency.tenant_id
             AND predecessor.id = dependency.depends_on_task_id
            WHERE dependency.tenant_id = task.tenant_id
              AND dependency.project_id = task.project_id
              AND dependency.task_id = task.id
              AND predecessor.status NOT IN ('done', 'skipped')
          ) AS dependency_blocked
        FROM production_project_task task
        WHERE task.tenant_id = $1
          AND task.project_id = $2
      )
      SELECT
        COUNT(*) FILTER (
          WHERE required
            AND status NOT IN ('done', 'skipped')
            AND ($3 OR task_type <> 'release')
        )::int AS open_required_task_count,
        COUNT(*) FILTER (WHERE status = 'blocked' OR dependency_blocked)::int AS blocked_task_count,
        COUNT(*) FILTER (
          WHERE due_date IS NOT NULL
            AND due_date < $4
            AND status NOT IN ('done', 'skipped')
        )::int AS overdue_task_count,
        BOOL_OR(task_type = 'peer_review' AND status <> 'done') AS pending_peer_review,
        BOOL_OR(task_type = 'final_qc' AND status <> 'done') AS pending_final_qc,
        COUNT(*) FILTER (WHERE task_type = 'release' AND status NOT IN ('done', 'skipped'))::int AS pending_release_tasks,
        ARRAY_REMOVE(
          ARRAY[
            CASE
              WHEN COUNT(*) FILTER (
                WHERE required
                  AND status NOT IN ('done', 'skipped')
                  AND ($3 OR task_type <> 'release')
              )::int > 0
                THEN CONCAT(
                  COUNT(*) FILTER (
                    WHERE required
                      AND status NOT IN ('done', 'skipped')
                      AND ($3 OR task_type <> 'release')
                  )::int,
                  ' required task(s) still open'
                )
              ELSE NULL
            END,
            CASE
              WHEN COUNT(*) FILTER (WHERE status = 'blocked' OR dependency_blocked)::int > 0
                THEN CONCAT(COUNT(*) FILTER (WHERE status = 'blocked' OR dependency_blocked)::int, ' blocked task(s)')
              ELSE NULL
            END,
            CASE
              WHEN COUNT(*) FILTER (
                WHERE due_date IS NOT NULL
                  AND due_date < $4
                  AND status NOT IN ('done', 'skipped')
              )::int > 0
                THEN CONCAT(
                  COUNT(*) FILTER (
                    WHERE due_date IS NOT NULL
                      AND due_date < $4
                      AND status NOT IN ('done', 'skipped')
                  )::int,
                  ' overdue deadline(s)'
                )
              ELSE NULL
            END,
            CASE WHEN BOOL_OR(task_type = 'peer_review' AND status <> 'done') THEN 'peer review gate incomplete' ELSE NULL END,
            CASE WHEN BOOL_OR(task_type = 'final_qc' AND status <> 'done') THEN 'final QC gate incomplete' ELSE NULL END
          ],
          NULL
        ) AS blocked_reasons
      FROM task_context
    `,
    [tenantId, projectId, options.includeReleaseTasksAsOpen, getLocalDateString()]
  );

  const row = result.rows[0];
  const exceptionResult = await client.query<{ blocking_count: number }>(
    `
      SELECT COUNT(*)::int AS blocking_count
      FROM production_project_exception
      WHERE tenant_id = $1
        AND project_id = $2
        AND blocking = true
        AND status = 'open'
    `,
    [tenantId, projectId]
  );
  const buddyResult = await client.query<{ status: ProductionProjectTaskStatus; unresolved_group_count: number; duplicate_handling_required: boolean }>(
    `
      SELECT status::text AS status,
             unresolved_group_count,
             duplicate_handling_required
      FROM production_project_buddy_workflow
      WHERE tenant_id = $1
        AND project_id = $2
      LIMIT 1
    `,
    [tenantId, projectId]
  );
  const virtualTeamResult = await client.query<{
    status: ProductionProjectTaskStatus;
    ambiguous_match_required: boolean;
    ambiguous_match_resolved_at: string | null;
  }>(
    `
      SELECT status::text AS status,
             ambiguous_match_required,
             ambiguous_match_resolved_at::text AS ambiguous_match_resolved_at
      FROM production_project_virtual_team_workflow
      WHERE tenant_id = $1
        AND project_id = $2
      LIMIT 1
    `,
    [tenantId, projectId]
  );
  const reviewResult = await client.query<{ qa_checklist_complete: boolean }>(
    `
      SELECT qa_checklist_complete
      FROM production_project_review
      WHERE tenant_id = $1
        AND project_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, projectId]
  );

  const blockedReasons = new Set(row?.blocked_reasons ?? []);
  const blockingCount = exceptionResult.rows[0]?.blocking_count ?? 0;
  if (blockingCount > 0) {
    blockedReasons.add(`${blockingCount} blocking exception${blockingCount === 1 ? "" : "s"} still open`);
  }
  const buddy = buddyResult.rows[0];
  if (buddy && !["done", "skipped"].includes(buddy.status)) {
    blockedReasons.add("Buddy workflow incomplete");
  }
  if (buddy && buddy.unresolved_group_count > 0) {
    blockedReasons.add("Buddy groups still unresolved");
  }
  if (buddy && buddy.duplicate_handling_required && !["done", "skipped"].includes(buddy.status)) {
    blockedReasons.add("Buddy duplicate handling still required");
  }
  const virtualTeam = virtualTeamResult.rows[0];
  if (virtualTeam && !["done", "skipped"].includes(virtualTeam.status)) {
    blockedReasons.add("Virtual team validation incomplete");
  }
  if (virtualTeam && virtualTeam.ambiguous_match_required && !virtualTeam.ambiguous_match_resolved_at) {
    blockedReasons.add("Virtual team ambiguous match unresolved");
  }
  const latestReviewChecklistComplete = reviewResult.rows[0]?.qa_checklist_complete;
  if (latestReviewChecklistComplete === false) {
    blockedReasons.add("QA checklist incomplete");
  }

  return {
    openRequiredTaskCount: row?.open_required_task_count ?? 0,
    blockedTaskCount: row?.blocked_task_count ?? 0,
    overdueTaskCount: row?.overdue_task_count ?? 0,
    pendingPeerReview: row?.pending_peer_review ?? false,
    pendingFinalQc: row?.pending_final_qc ?? false,
    pendingReleaseTasks: row?.pending_release_tasks ?? 0,
    blockedReasons: [...blockedReasons]
  };
}

function assertProjectReadyForRelease(input: {
  project: Pick<ProjectRow, "title" | "peer_review_required" | "final_qc_required">;
  gate: ProductionProjectWorkflowGate;
  peerReviewerUserId: string | null;
  finalQcReviewerUserId: string | null;
}) {
  if (input.project.peer_review_required && !input.peerReviewerUserId) {
    throw new ApiError(400, "Assign a peer reviewer before moving this production job to Ready to Release.");
  }
  if (input.project.final_qc_required && !input.finalQcReviewerUserId) {
    throw new ApiError(400, "Assign a final QC reviewer before moving this production job to Ready to Release.");
  }
  if (input.gate.blockedReasons.length > 0) {
    throw new ApiError(400, `${input.project.title} cannot move to Ready to Release until ${input.gate.blockedReasons.join(", ")}.`);
  }
}

function assertProjectCanRelease(input: {
  project: Pick<ProjectRow, "title" | "peer_review_required" | "final_qc_required">;
  gate: ProductionProjectWorkflowGate;
  peerReviewerUserId: string | null;
  finalQcReviewerUserId: string | null;
}) {
  assertProjectReadyForRelease(input);
}

async function completeReleaseTasksForProject(
  client: PoolClient,
  input: {
    tenantId: string;
    projectId: string;
    actorUserId: string;
    note: string | null;
  }
) {
  const releaseTasks = await client.query<{
    id: string;
    title: string;
  }>(
    `
      SELECT id, title
      FROM production_project_task
      WHERE tenant_id = $1
        AND project_id = $2
        AND task_type = 'release'::production_project_task_type
        AND status NOT IN ('done', 'skipped')
    `,
    [input.tenantId, input.projectId]
  );

  for (const task of releaseTasks.rows) {
    await client.query(
      `
        UPDATE production_project_task
        SET
          status = 'done',
          completed_at = COALESCE(completed_at, now()),
          completed_by_user_id = COALESCE(completed_by_user_id, $4::uuid),
          updated_by_user_id = $4::uuid,
          updated_at = now(),
          latest_note = COALESCE($5, latest_note)
        WHERE tenant_id = $1
          AND project_id = $2
          AND id = $3
      `,
      [input.tenantId, input.projectId, task.id, input.actorUserId, input.note]
    );

    await recordProductionProjectTaskEvent(client, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      taskId: task.id,
      actorUserId: input.actorUserId,
      eventType: "task.release_completed",
      summary: `${task.title} completed during final release`,
      note: input.note,
      metadata: { status: "done" }
    });
  }
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function addDays(anchorDate: string | Date, offsetDays: number) {
  const anchor = new Date(toStableIso(anchorDate));
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return anchor.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(toStableIso(value)));
}

function formatDueLabel(value: string, anchorDate: string) {
  if (value < anchorDate) {
    return `Overdue since ${formatDateLabel(value)}`;
  }
  if (value === anchorDate) {
    return "Due today";
  }
  return `Due ${formatDateLabel(value)}`;
}

function buildProductionUrgentDueAt(value: string | null) {
  if (!value) {
    return null;
  }
  return new Date(`${value}T17:00:00`).toISOString();
}

function buildLastTouchedLabel(updatedDate: string, anchorDate: string) {
  const delta = dayDelta(updatedDate, anchorDate);
  if (delta <= 0) {
    return "Touched today";
  }
  if (delta === 1) {
    return "Touched yesterday";
  }
  return `Touched ${formatDateLabel(updatedDate)}`;
}

function extractDatePart(value: string | null | undefined) {
  if (!value) {
    return getLocalDateString();
  }
  return normalizeDateOnly(value);
}

function dayDelta(fromDate: string, toDate: string) {
  const from = new Date(toStableIso(fromDate)).getTime();
  const to = new Date(toStableIso(toDate)).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function toStableIso(dateValue: string | Date) {
  const normalized = normalizeDateOnly(dateValue);
  return `${normalized}T12:00:00.000Z`;
}

function isClosedProject(status: ProductionProjectStatus) {
  return status === "completed" || status === "canceled";
}

function isFutureSnoozed(snoozedUntil: string | null, anchorDate: string) {
  return Boolean(snoozedUntil && snoozedUntil > anchorDate);
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError("Invalid time value");
  }
  return parsed.toISOString().slice(0, 10);
}
