import type {
  ProjectWorkflowHealthState,
  ProjectWorkflowMilestoneStatus,
  ProjectWorkflowStepStatus,
  ProjectWorkflowTransitionType
} from "../domain/projectTracking/index.js";
import type { WorkDepartmentType } from "../domain/jobTruth/index.js";

export type ProjectWorkflowTemplateStepInput = {
  step_key: string;
  name: string;
  description?: string | null;
  department: WorkDepartmentType;
  role_key?: string | null;
  assigned_user_id?: string | null;
  required?: boolean | null;
  skippable?: boolean | null;
  blocking?: boolean | null;
  expected_duration_minutes?: number | null;
  depends_on_step_keys?: string[] | null;
};

export type ProjectWorkflowTemplateMilestoneInput = {
  milestone_key: string;
  name: string;
  description?: string | null;
  steps: ProjectWorkflowTemplateStepInput[];
};

export type ProjectWorkflowTemplateInput = {
  template_key: string;
  name: string;
  description?: string | null;
  departments_involved: WorkDepartmentType[];
  milestones: ProjectWorkflowTemplateMilestoneInput[];
};

export type WorkflowTemplateBuilderVersionStatus = "draft" | "published" | "archived";

export type WorkflowTemplateBuilderOwnerType =
  | "department"
  | "role"
  | "user"
  | "account_owner"
  | "job_owner"
  | "qa_reviewer"
  | "production_lead";

export type WorkflowTemplateBuilderDependencyMode =
  | "can_start_immediately"
  | "waits_for_prior_step"
  | "waits_for_dependencies"
  | "waits_for_milestone_completion";

export type WorkflowTemplateBuilderTemplateInput = {
  template_key: string;
  name: string;
  description?: string | null;
  job_type?: string | null;
  category?: string | null;
  departments_involved: WorkDepartmentType[];
};

export type WorkflowTemplateBuilderMilestoneInput = {
  milestone_key: string;
  name: string;
  description?: string | null;
  sort_order?: number | null;
  default_owner_type?: WorkflowTemplateBuilderOwnerType | null;
  default_owner_value?: string | null;
};

export type WorkflowTemplateBuilderStepInput = {
  milestone_template_id: string;
  step_key: string;
  name: string;
  description?: string | null;
  sort_order?: number | null;
  department: WorkDepartmentType;
  role_key?: string | null;
  assigned_user_id?: string | null;
  owner_type: WorkflowTemplateBuilderOwnerType;
  owner_value?: string | null;
  required?: boolean | null;
  skippable?: boolean | null;
  blocking?: boolean | null;
  expected_duration_minutes?: number | null;
  due_offset_minutes?: number | null;
  dependency_mode?: WorkflowTemplateBuilderDependencyMode | null;
  blocked_behavior?: string | null;
  checklist_template_id?: string | null;
  depends_on_step_keys?: string[] | null;
};

export type WorkflowTemplateBuilderStepUpdateInput = WorkflowTemplateBuilderStepInput;
export type WorkflowTemplateBuilderStepMoveDirection = "up" | "down";

export type WorkflowTemplateBuilderStepSummary = {
  id: string;
  step_key: string;
  name: string;
  description: string | null;
  sort_order: number;
  department: WorkDepartmentType;
  role_key: string | null;
  assigned_user_id: string | null;
  owner_type: WorkflowTemplateBuilderOwnerType | null;
  owner_value: string | null;
  required: boolean;
  skippable: boolean;
  blocking: boolean;
  expected_duration_minutes: number;
  due_offset_minutes: number | null;
  dependency_mode: WorkflowTemplateBuilderDependencyMode;
  blocked_behavior: string | null;
  checklist_template_id: string | null;
  checklist_template_name: string | null;
  depends_on_step_keys: string[];
};

export type WorkflowTemplateBuilderMilestoneSummary = {
  id: string;
  milestone_key: string;
  name: string;
  description: string | null;
  sort_order: number;
  default_owner_type: WorkflowTemplateBuilderOwnerType | null;
  default_owner_value: string | null;
  steps: WorkflowTemplateBuilderStepSummary[];
};

export type WorkflowTemplateBuilderDetail = {
  template: {
    id: string;
    template_key: string;
    name: string;
    description: string | null;
    job_type: string | null;
    category: string | null;
    status: "active" | "archived";
    updated_at: string;
  };
  version: {
    id: string;
    version_number: number;
    status: WorkflowTemplateBuilderVersionStatus;
    default_for_new_jobs: boolean;
    departments_involved: WorkDepartmentType[];
    published_at: string | null;
    published_by_user_id: string | null;
  };
  milestones: WorkflowTemplateBuilderMilestoneSummary[];
};

export type ProjectWorkflowStepTiming = {
  elapsed_minutes: number;
  remaining_minutes: number;
  overdue_minutes: number;
  idle_minutes: number;
  sla_percent: number;
  alert_level: "none" | "early_warning" | "risk" | "urgent" | "overdue";
  health_state: ProjectWorkflowHealthState;
};

export type ProjectWorkflowAssignmentStatus =
  | "needs_assignment"
  | "queued"
  | "claimed"
  | "assigned"
  | "in_progress"
  | "waiting_on_info"
  | "completed"
  | "returned";

export type ProjectWorkflowWaitingOnParty =
  | "school"
  | "kp"
  | "production"
  | "graphics"
  | "customer_service"
  | "vendor"
  | "family"
  | "other"
  | "none"
  | "unknown";

export type ProjectWorkflowStepSummary = {
  id: string;
  workflow_run_id: string;
  job_id: string;
  milestone_key: string;
  step_key: string;
  name: string;
  description: string | null;
  department: WorkDepartmentType;
  role_key: string | null;
  assigned_user_id: string | null;
  assigned_user_name?: string | null;
  assignment_status: ProjectWorkflowAssignmentStatus | null;
  assigned_queue: WorkDepartmentType | null;
  assigned_by_user_id: string | null;
  assigned_by_user_name?: string | null;
  assigned_at: string | null;
  waiting_on_party: ProjectWorkflowWaitingOnParty | null;
  waiting_detail: string | null;
  status: ProjectWorkflowStepStatus;
  required: boolean;
  skippable: boolean;
  blocking: boolean;
  expected_duration_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  notes: string | null;
  exception_reason: string | null;
  rework_count: number;
  dependency_step_ids: string[];
  timing: ProjectWorkflowStepTiming;
  updated_at: string;
};

export type ProjectWorkflowMilestoneSummary = {
  id: string;
  milestone_key: string;
  name: string;
  description: string | null;
  status: ProjectWorkflowMilestoneStatus;
  steps: ProjectWorkflowStepSummary[];
};

export type ProjectWorkflowInstanceDetail = {
  workflow_run: {
    id: string;
    job_id: string;
    template_id: string;
    template_version_id: string;
    template_key: string;
    template_name: string | null;
    template_version_label: string;
    workflow_family: "project_tracking";
    status: string;
    started_at: string | null;
    completed_at: string | null;
  };
  job: {
    id: string;
    title: string;
    job_type: string | null;
    organization_id: string;
    organization_name: string | null;
    account_owner_user_id: string | null;
  };
  milestones: ProjectWorkflowMilestoneSummary[];
  handoffs: ProjectWorkflowHandoffSummary[];
  audit_events: ProjectWorkflowAuditEvent[];
};

export type ProjectWorkflowTransitionInput = {
  status: ProjectWorkflowStepStatus;
  reason?: string | null;
  notes?: string | null;
  assigned_user_id?: string | null;
  assigned_queue?: WorkDepartmentType | null;
  expected_duration_minutes?: number | null;
  last_seen_updated_at?: string | null;
};

export type ProjectWorkflowSendBackInput = {
  target_step_id: string;
  reason: string;
  assigned_user_id: string;
  expected_duration_minutes: number;
  expectations?: string | null;
};

export type ProjectWorkflowSendToProductionInput = {
  step_id: string;
  notes?: string | null;
  readiness?: {
    files_confirmed?: boolean | null;
    data_confirmed?: boolean | null;
    job_type_confirmed?: boolean | null;
    due_date_confirmed?: boolean | null;
  } | null;
};

export type ProjectWorkflowClaimInput = {
  assigned_queue?: WorkDepartmentType | null;
  assigned_user_id?: string | null;
  notes?: string | null;
};

export type ProjectWorkflowWaitingInput = {
  waiting_on_party: ProjectWorkflowWaitingOnParty;
  waiting_detail: string;
};

export type ProjectWorkflowReturnInput = {
  return_reason: string;
  issue_flag?: boolean | null;
};

export type ProjectWorkflowAuditEvent = {
  transition_type: ProjectWorkflowTransitionType;
  previous_status: ProjectWorkflowStepStatus | null;
  new_status: ProjectWorkflowStepStatus;
  reason: string | null;
  workflow_step_id?: string;
  actor_user_id?: string | null;
  actor_name?: string | null;
  previous_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  created_at?: string;
};

export type ProjectWorkflowCommandCenterSummary = {
  open_steps: number;
  overdue_steps: number;
  due_soon_steps: number;
  blocked_steps: number;
  assigned_steps: number;
  rework_steps: number;
  at_risk_steps: number;
  total_active_workflows: number;
  total_open_work: number;
  total_needs_attention: number;
  total_blocked: number;
  total_running_late: number;
  total_due_soon: number;
  total_returned_for_fixes: number;
  total_waiting_on_school: number;
  total_waiting_on_kp: number;
  total_missing_info: number;
  total_complete: number;
  total_no_workflow_linked: number;
  source: "true_totals";
  confidence: "explicit" | "mixed";
};

export type ProjectWorkflowJobHealth =
  | "on_track"
  | "due_soon"
  | "running_late"
  | "blocked"
  | "at_risk"
  | "complete"
  | "no_workflow"
  | "unknown";

export type ProjectWorkflowFileStatus =
  | "not_connected"
  | "not_started"
  | "waiting_for_files"
  | "count_images"
  | "confirm_files"
  | "verify_image_count"
  | "in_production"
  | "qa_review"
  | "ready_to_release"
  | "released"
  | "unknown";

export type ProjectWorkflowDeadlineState = "none" | "due_soon" | "running_late" | "blocked" | "complete" | "unknown";

export type ProjectWorkflowOperationalStatus =
  | "active"
  | "needs_action"
  | "waiting"
  | "blocked"
  | "overdue"
  | "at_risk"
  | "ready_to_advance"
  | "missing_owner"
  | "missing_next_action";

export type ProjectWorkflowQueueIntelligence = {
  reason: string;
  trigger: string;
  owner_lane: string;
  next_action: string;
  clear_condition: string;
  operational_status: ProjectWorkflowOperationalStatus;
};

export type ProjectWorkflowJobRow = {
  job_id: string;
  job_number: string | null;
  job_code: string | null;
  job_title: string;
  organization_id: string | null;
  organization_name: string | null;
  account_id: string | null;
  account_name: string | null;
  workflow_run_id: string | null;
  workflow_template_id: string | null;
  workflow_template_name: string | null;
  workflow_template_version: string | null;
  current_step: (ProjectWorkflowStepSummary & { phase: string }) | null;
  phase: string;
  owner_display: string;
  owner_type: "user" | "role" | "department" | "account_owner" | "unknown";
  job_date: string | null;
  next_deadline_at: string | null;
  deadline_state: ProjectWorkflowDeadlineState;
  waiting_on_party: ProjectWorkflowWaitingOnParty;
  health: ProjectWorkflowJobHealth;
  health_reasons: string[];
  file_status: ProjectWorkflowFileStatus;
  missing_info_flags: string[];
  rework_count: number;
  blocked_reason: string | null;
  queue_intelligence: ProjectWorkflowQueueIntelligence;
  updated_at: string;
};

export type ProjectWorkflowHandoffStatus =
  | "pending"
  | "acknowledged"
  | "completed"
  | "rejected"
  | "sent_to_production"
  | "accepted_by_production"
  | "waiting_on_info"
  | "production_complete"
  | "returned_to_schools"
  | "returned_with_issue";

export type ProjectWorkflowHandoffSummary = {
  id: string;
  workflow_run_id: string;
  from_step_id: string | null;
  to_step_id: string;
  from_step_name: string | null;
  to_step_name: string;
  from_department: WorkDepartmentType | null;
  to_department: WorkDepartmentType;
  from_user_id: string | null;
  from_user_name: string | null;
  to_user_id: string | null;
  to_user_name: string | null;
  status: ProjectWorkflowHandoffStatus;
  reason: string | null;
  expectations: string | null;
  notes: string | null;
  issue_flag: boolean;
  return_reason: string | null;
  sent_by_user_id: string | null;
  sent_by_user_name: string | null;
  sent_at: string | null;
  accepted_by_user_id: string | null;
  accepted_by_user_name: string | null;
  accepted_at: string | null;
  returned_by_user_id: string | null;
  returned_by_user_name: string | null;
  returned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectWorkflowCommandCenterAlert = {
  step_id: string;
  workflow_run_id: string;
  job_id: string;
  level: ProjectWorkflowStepTiming["alert_level"] | "blocked";
  title: string;
  summary: string;
  department: WorkDepartmentType;
  assigned_user_id: string | null;
  job_title: string;
  organization_name: string | null;
};

export type ProjectWorkflowCommandCenter = {
  generated_at: string;
  view: "personal" | "department" | "global";
  summary: ProjectWorkflowCommandCenterSummary;
  alerts: ProjectWorkflowCommandCenterAlert[];
  steps: Array<ProjectWorkflowStepSummary & { job_title: string; organization_name: string | null }>;
  job_rows: ProjectWorkflowJobRow[];
};

export type ProjectWorkflowProductionQueueItem = {
  source: "handoff" | "live_workflow_assignment";
  handoff_id: string | null;
  workflow_run_id: string;
  job_id: string;
  job_title: string;
  job_type: string | null;
  organization_name: string | null;
  step_id: string;
  production_step: string;
  step_status: ProjectWorkflowStepStatus;
  needed_work: string;
  due_at: string | null;
  status: ProjectWorkflowHandoffStatus;
  assignment_status: ProjectWorkflowAssignmentStatus | null;
  assigned_queue: WorkDepartmentType | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  waiting_on_party: ProjectWorkflowWaitingOnParty | null;
  waiting_detail: string | null;
  missing_info: string | null;
  notes: string | null;
  lane_reason: string;
  next_action: string;
  clear_condition: string;
  operational_status: ProjectWorkflowOperationalStatus;
  last_updated: string;
};

export type ProjectWorkflowProductionQueue = {
  generated_at: string;
  summary: {
    ready_for_production: number;
    needs_assignment: number;
    waiting_on_info: number;
    due_today: number;
    overdue: number;
  };
  items: ProjectWorkflowProductionQueueItem[];
};
