import type {
  AlertDeliveryChannel,
  ChecklistApprovalDecision,
  ChecklistAssignmentRoleKey,
  ChecklistBlockingLevel,
  ChecklistCommentVisibility,
  ChecklistConditionEffect,
  ChecklistConditionLogic,
  ChecklistInstanceStatus,
  ChecklistItemType,
  ChecklistReminderType,
  ChecklistScopeType,
  ChecklistTemplateVersionStatus,
  ChecklistTriggerType,
  JobDepartmentType,
  WorkflowBlockResourceType
} from "../domain/jobTruth/index.js";

type TimestampValue = string | Date;

export type ChecklistAssignmentDefaults = {
  owner_assignment_role?: ChecklistAssignmentRoleKey | null;
  reviewer_assignment_role?: ChecklistAssignmentRoleKey | null;
  approver_assignment_role?: ChecklistAssignmentRoleKey | null;
};

export interface ChecklistTemplateRecord {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  department_type: JobDepartmentType | null;
  scope_type: ChecklistScopeType;
  active_version_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  archived_at: TimestampValue | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistTemplateVersionRecord {
  id: string;
  tenant_id: string;
  template_id: string;
  version_number: number;
  status: ChecklistTemplateVersionStatus;
  trigger_type: ChecklistTriggerType;
  due_rule_json: Record<string, unknown>;
  approval_required: boolean;
  blocking_level: ChecklistBlockingLevel;
  assignment_defaults_json: ChecklistAssignmentDefaults;
  summary: string | null;
  created_by_user_id: string | null;
  published_by_user_id: string | null;
  published_at: TimestampValue | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistSectionRecord {
  id: string;
  tenant_id: string;
  template_version_id: string;
  section_key: string;
  title: string;
  description: string | null;
  sort_order: number;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistItemRecord {
  id: string;
  tenant_id: string;
  template_version_id: string;
  section_id: string;
  item_key: string;
  label: string;
  help_text: string | null;
  item_type: ChecklistItemType;
  required: boolean;
  proof_required: boolean;
  validation_json: Record<string, unknown>;
  options_json: unknown[];
  sort_order: number;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistItemConditionRecord {
  id: string;
  tenant_id: string;
  template_version_id: string;
  checklist_item_id: string;
  condition_group_key: string;
  logic_operator: ChecklistConditionLogic;
  source_item_key: string;
  comparison_operator: string;
  expected_value_json: unknown;
  effect: ChecklistConditionEffect;
  sort_order: number;
  created_at: TimestampValue;
}

export interface ChecklistInstanceRecord {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  scope_type: ChecklistScopeType;
  job_id: string | null;
  shoot_id: string | null;
  production_item_id: string | null;
  location_id: string | null;
  department_type: JobDepartmentType | null;
  title: string;
  trigger_type: ChecklistTriggerType;
  status: ChecklistInstanceStatus;
  approval_required: boolean;
  blocking_level: ChecklistBlockingLevel;
  owner_user_id: string | null;
  reviewer_user_id: string | null;
  approver_user_id: string | null;
  due_at: TimestampValue | null;
  submitted_at: TimestampValue | null;
  approved_at: TimestampValue | null;
  rejected_at: TimestampValue | null;
  waived_at: TimestampValue | null;
  rejection_note: string | null;
  waiver_note: string | null;
  progress_percent: number;
  created_from_trigger_key: string | null;
  source_metadata_json: Record<string, unknown>;
  last_reminded_at: TimestampValue | null;
  escalated_at: TimestampValue | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistResponseRecord {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  checklist_item_id: string;
  checklist_section_id: string;
  response_json: unknown;
  is_complete: boolean;
  answered_by_user_id: string | null;
  answered_at: TimestampValue | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistAttachmentRecord {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  checklist_response_id: string | null;
  attachment_type: string;
  file_name: string;
  content_type: string;
  storage_key: string;
  object_url: string;
  uploaded_by_user_id: string | null;
  created_at: TimestampValue;
}

export interface ChecklistCommentRecord {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  checklist_response_id: string | null;
  checklist_item_id: string | null;
  author_user_id: string | null;
  body: string;
  visibility: ChecklistCommentVisibility;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistApprovalRecord {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  decision: ChecklistApprovalDecision;
  actor_user_id: string | null;
  note: string | null;
  metadata_json: Record<string, unknown>;
  created_at: TimestampValue;
}

export interface WorkflowBlockRuleRecord {
  id: string;
  tenant_id: string;
  name: string;
  department_type: JobDepartmentType | null;
  resource_type: WorkflowBlockResourceType;
  from_stage: string | null;
  to_stage: string;
  required_template_code: string;
  required_instance_status: ChecklistInstanceStatus;
  approval_required: boolean;
  blocking_level: ChecklistBlockingLevel;
  allow_override: boolean;
  active_status: boolean;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface ChecklistReminderRuleRecord {
  id: string;
  tenant_id: string;
  template_id: string | null;
  template_version_id: string | null;
  department_type: JobDepartmentType | null;
  scope_type: ChecklistScopeType | null;
  reminder_type: ChecklistReminderType;
  offset_minutes: number;
  delivery_channel: AlertDeliveryChannel;
  escalation_role: string | null;
  active_status: boolean;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export type ChecklistTemplateUsageSummary = {
  template_id: string;
  usage_count: number;
  last_used_at: string | null;
};

export type ChecklistTemplateSummary = ChecklistTemplateRecord & {
  active_version_number: number | null;
  active_version_status: ChecklistTemplateVersionStatus | null;
  active_trigger_type: ChecklistTriggerType | null;
  active_approval_required: boolean;
  active_blocking_level: ChecklistBlockingLevel;
  usage_count: number;
  last_used_at: string | null;
};

export type ChecklistTemplateVersionBundle = ChecklistTemplateVersionRecord & {
  sections: ChecklistSectionBundle[];
};

export type ChecklistSectionBundle = ChecklistSectionRecord & {
  items: ChecklistItemBundle[];
};

export type ChecklistItemBundle = ChecklistItemRecord & {
  conditions: ChecklistItemConditionRecord[];
};

export type ChecklistTemplateDetail = ChecklistTemplateSummary & {
  versions: ChecklistTemplateVersionBundle[];
};

export type ChecklistDisplayTarget = {
  job_id: string | null;
  job_number: string | null;
  shoot_id: string | null;
  production_item_id: string | null;
  location_id: string | null;
  organization_name: string | null;
  title: string | null;
  owner_name: string | null;
  reviewer_name: string | null;
  approver_name: string | null;
};

export type ChecklistProgressSummary = {
  total_items: number;
  visible_items: number;
  required_items: number;
  completed_items: number;
  completed_required_items: number;
  proof_required_items: number;
  proof_satisfied_items: number;
  approval_required: boolean;
  approval_complete: boolean;
  progress_percent: number;
  missing_item_ids: string[];
  missing_proof_item_ids: string[];
  missing_approval: boolean;
};

export type ChecklistRuntimeItemView = ChecklistItemBundle & {
  response: ChecklistResponseRecord | null;
  attachments: ChecklistAttachmentRecord[];
  comments: ChecklistCommentRecord[];
  visible: boolean;
  effective_required: boolean;
  disabled: boolean;
  missing_required: boolean;
  missing_proof: boolean;
};

export type ChecklistRuntimeSectionView = ChecklistSectionBundle & {
  items: ChecklistRuntimeItemView[];
};

export type ChecklistInstanceDetail = ChecklistInstanceRecord & {
  template: ChecklistTemplateRecord;
  template_version: ChecklistTemplateVersionRecord;
  progress: ChecklistProgressSummary;
  sections: ChecklistRuntimeSectionView[];
  approvals: ChecklistApprovalRecord[];
  comments: ChecklistCommentRecord[];
  target: ChecklistDisplayTarget;
};

export type ChecklistTransitionBlockingIssue = {
  template_code: string;
  template_name: string;
  instance_id: string | null;
  blocking_level: ChecklistBlockingLevel;
  required_status: ChecklistInstanceStatus;
  current_status: ChecklistInstanceStatus | null;
  approval_required: boolean;
  progress_percent: number;
  missing_item_ids: string[];
  missing_proof_item_ids: string[];
  missing_item_labels: string[];
  missing_proof_item_labels: string[];
  missing_approval: boolean;
  message: string;
};

export type ChecklistTransitionValidation = {
  allowed: boolean;
  hard_blocked: boolean;
  soft_blocked: boolean;
  issues: ChecklistTransitionBlockingIssue[];
};

export type ChecklistAttentionState = "overdue" | "awaiting_approval" | "rejected" | "blocked" | "missing_proof" | "open";

export type ChecklistAttentionItem = {
  instance_id: string;
  scope_type: ChecklistScopeType;
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
  status: ChecklistInstanceStatus;
  attention_state: ChecklistAttentionState;
  blocking_level: ChecklistBlockingLevel;
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

export type ChecklistAttentionSummary = {
  total_count: number;
  overdue_count: number;
  awaiting_approval_count: number;
  rejected_count: number;
  blocked_count: number;
  missing_proof_count: number;
  assigned_to_me_count: number;
};
