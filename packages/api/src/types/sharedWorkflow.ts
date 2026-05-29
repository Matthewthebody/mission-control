import type { JobPriorityLevel, WorkDepartmentType, WorkTaskStatus } from "../domain/jobTruth/index.js";
import type { OperationalApprovalRequestType, OperationalApprovalStatus } from "./operationalApprovals.js";

export const SHARED_WORKFLOW_FAMILIES = ["schools", "sports", "graphics_handoff"] as const;
export type SharedWorkflowFamily = (typeof SHARED_WORKFLOW_FAMILIES)[number];

export const SHARED_WORKFLOW_PILOT_TEMPLATE_KEYS = {
  schools: "schools_phase_one_core",
  sports: "sports_phase_one_core",
  graphics_handoff: "graphics_handoff_phase_one_core"
} as const;

export const SHARED_WORKFLOW_PILOT_VERSION_BASELINE = 1 as const;

export interface SharedWorkflowPilotFamilyDefinition {
  workflow_family: SharedWorkflowFamily;
  template_key: (typeof SHARED_WORKFLOW_PILOT_TEMPLATE_KEYS)[SharedWorkflowFamily];
  template_name: string;
  current_version_number: number;
}

export const SHARED_WORKFLOW_PILOT_FAMILY_DEFINITIONS: readonly SharedWorkflowPilotFamilyDefinition[] = [
  {
    workflow_family: "schools",
    template_key: SHARED_WORKFLOW_PILOT_TEMPLATE_KEYS.schools,
    template_name: "Schools Phase-One Core Workflow",
    current_version_number: SHARED_WORKFLOW_PILOT_VERSION_BASELINE
  },
  {
    workflow_family: "sports",
    template_key: SHARED_WORKFLOW_PILOT_TEMPLATE_KEYS.sports,
    template_name: "Sports Phase-One Core Workflow",
    current_version_number: SHARED_WORKFLOW_PILOT_VERSION_BASELINE
  },
  {
    workflow_family: "graphics_handoff",
    template_key: SHARED_WORKFLOW_PILOT_TEMPLATE_KEYS.graphics_handoff,
    template_name: "Graphics Handoff Phase-One Workflow",
    current_version_number: SHARED_WORKFLOW_PILOT_VERSION_BASELINE
  }
];

export const SHARED_WORKFLOW_RUN_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export type SharedWorkflowRunStatus = (typeof SHARED_WORKFLOW_RUN_STATUSES)[number];

export const SHARED_WORKFLOW_ACK_STATUSES = ["pending", "acknowledged", "dismissed"] as const;
export type SharedWorkflowAcknowledgementStatus = (typeof SHARED_WORKFLOW_ACK_STATUSES)[number];

export const SHARED_WORKFLOW_ACK_TARGET_TYPES = ["task"] as const;
export type SharedWorkflowAcknowledgementTargetType = (typeof SHARED_WORKFLOW_ACK_TARGET_TYPES)[number];

export const SHARED_WORKFLOW_APPROVAL_CHECKPOINT_STATUSES = ["queued", "pending", "approved", "rejected", "canceled"] as const;
export type SharedWorkflowApprovalCheckpointStatus = (typeof SHARED_WORKFLOW_APPROVAL_CHECKPOINT_STATUSES)[number];

export const SHARED_WORKFLOW_APPROVAL_TARGET_TYPES = ["job", "task"] as const;
export type SharedWorkflowApprovalCheckpointTargetType = (typeof SHARED_WORKFLOW_APPROVAL_TARGET_TYPES)[number];

export const SHARED_WORKFLOW_APPROVAL_ACTIVATION_POINTS = ["on_run_start", "on_task_completion"] as const;
export type SharedWorkflowApprovalCheckpointActivationPoint =
  (typeof SHARED_WORKFLOW_APPROVAL_ACTIVATION_POINTS)[number];

export interface SharedWorkflowTemplateSummary {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  workflow_family: SharedWorkflowFamily;
}

export interface SharedWorkflowTemplateVersionSummary {
  id: string;
  template_id: string;
  version_number: number;
  status: "draft" | "active" | "retired";
  default_for_new_jobs: boolean;
}

export interface SharedWorkflowPilotRuntimeSummary {
  workflow_family: SharedWorkflowFamily;
  template_key: string;
  template_name: string;
  version_number: number;
  version_status: "draft" | "active" | "retired";
  version_label: string;
}

export interface SharedWorkflowRunSummary {
  id: string;
  job_id: string;
  template_id: string;
  template_version_id: string;
  template_key: string;
  workflow_family: SharedWorkflowFamily;
  status: SharedWorkflowRunStatus;
  generated_event_count: number;
  generated_task_count: number;
  pending_acknowledgement_count: number;
  pending_approval_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedWorkflowRunEventSummary {
  id: string;
  workflow_run_id: string;
  event_key: string;
  event_title: string;
  event_type: string;
  job_day_id: string;
  start_at: string | null;
  end_at: string | null;
  sort_order: number;
}

export interface SharedWorkflowTaskDependencyRecord {
  work_task_id: string;
  depends_on_work_task_id: string;
  depends_on_task_key: string;
  depends_on_title: string;
  depends_on_status: WorkTaskStatus;
  satisfied: boolean;
  blocking: boolean;
}

export interface SharedWorkflowRunTaskSummary {
  task_id: string;
  task_number: string;
  task_key: string;
  title: string;
  department_type: WorkDepartmentType;
  event_id: string | null;
  workflow_run_id: string;
  assigned_to_user_id: string | null;
  assigned_team_id: string | null;
  status: WorkTaskStatus;
  priority: JobPriorityLevel;
  due_at: string | null;
  blocked_reason: string | null;
  dependency_task_ids: string[];
  dependencies: SharedWorkflowTaskDependencyRecord[];
  dependency_blocked: boolean;
  requires_acknowledgement: boolean;
  acknowledgement_id: string | null;
  acknowledgement: SharedWorkflowAcknowledgementRecord | null;
  approval_checkpoint_ids: string[];
  approval_checkpoints: SharedWorkflowApprovalCheckpointRecord[];
}

export interface SharedWorkflowAcknowledgementRecord {
  id: string;
  workflow_run_id: string;
  rule_key: string;
  target_type: SharedWorkflowAcknowledgementTargetType;
  target_key: string | null;
  work_task_id: string | null;
  requested_user_id: string | null;
  acknowledged_by_user_id: string | null;
  status: SharedWorkflowAcknowledgementStatus;
  summary: string | null;
  require_on_assignment: boolean;
  require_on_claim: boolean;
  requested_at: string;
  acknowledged_at: string | null;
}

export interface SharedWorkflowApprovalCheckpointRecord {
  id: string;
  workflow_run_id: string;
  checkpoint_key: string;
  target_type: SharedWorkflowApprovalCheckpointTargetType;
  target_key: string | null;
  activate_when: SharedWorkflowApprovalCheckpointActivationPoint;
  work_task_id: string | null;
  operational_approval_request_id: string | null;
  title: string;
  request_type: OperationalApprovalRequestType;
  requested_action_code: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  blocking: boolean;
  status: SharedWorkflowApprovalCheckpointStatus;
  approval_request_status: OperationalApprovalStatus | null;
  activated_at: string | null;
  resolved_at: string | null;
}

export interface SharedWorkflowTaskRuntimeDetail {
  pilot_runtime: SharedWorkflowPilotRuntimeSummary;
  run: SharedWorkflowRunSummary;
  task: SharedWorkflowRunTaskSummary;
}

export interface SharedWorkflowJobDetail {
  pilot_runtime: SharedWorkflowPilotRuntimeSummary;
  template: SharedWorkflowTemplateSummary;
  version: SharedWorkflowTemplateVersionSummary;
  run: SharedWorkflowRunSummary;
  events: SharedWorkflowRunEventSummary[];
  tasks: SharedWorkflowRunTaskSummary[];
  acknowledgements: SharedWorkflowAcknowledgementRecord[];
  approval_checkpoints: SharedWorkflowApprovalCheckpointRecord[];
}
