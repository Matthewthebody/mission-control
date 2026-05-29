export type ChecklistScopeType = "shoot" | "production_item" | "job" | "location";

export type ChecklistTriggerType =
  | "manual"
  | "shoot_status_transition"
  | "production_status_transition"
  | "job_publish"
  | "shoot_complete"
  | "upload_verified"
  | "release_review";

export type ChecklistBlockingLevel = "none" | "soft_block" | "hard_block";

export type ChecklistItemType =
  | "checkbox"
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "time"
  | "select"
  | "multi_select"
  | "yes_no"
  | "user_picker"
  | "photo_upload"
  | "file_upload"
  | "signature";

export type ChecklistConditionEffect = "show" | "hide" | "require" | "disable";
export type ChecklistConditionLogic = "AND" | "OR";
export type ChecklistInstanceStatus = "not_started" | "in_progress" | "submitted" | "approved" | "rejected" | "overdue" | "waived";
export type ChecklistTemplateVersionStatus = "draft" | "published" | "archived";
export type ChecklistApprovalDecision = "submitted" | "approved" | "rejected" | "waived";
export type ChecklistReminderType = "before_due" | "at_due" | "overdue" | "escalation";
export type ChecklistCommentVisibility = "standard_internal" | "manager_only" | "leadership_only";
export type WorkflowBlockResourceType = "shoot" | "production_item";
export type ChecklistDepartmentType = "schools" | "sports" | "corporate" | "headshots" | "other" | null;

export type ChecklistTemplateRecord = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  department_type: ChecklistDepartmentType;
  scope_type: ChecklistScopeType;
  active_version_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistTemplateVersionRecord = {
  id: string;
  tenant_id: string;
  template_id: string;
  version_number: number;
  status: ChecklistTemplateVersionStatus;
  trigger_type: ChecklistTriggerType;
  due_rule_json: Record<string, unknown>;
  approval_required: boolean;
  blocking_level: ChecklistBlockingLevel;
  summary: string | null;
  created_by_user_id: string | null;
  published_by_user_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistItemConditionRecord = {
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
  created_at: string;
};

export type ChecklistItemRecord = {
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
  created_at: string;
  updated_at: string;
};

export type ChecklistSectionRecord = {
  id: string;
  tenant_id: string;
  template_version_id: string;
  section_key: string;
  title: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ChecklistItemBundle = ChecklistItemRecord & {
  conditions: ChecklistItemConditionRecord[];
};

export type ChecklistSectionBundle = ChecklistSectionRecord & {
  items: ChecklistItemBundle[];
};

export type ChecklistTemplateVersionBundle = ChecklistTemplateVersionRecord & {
  sections: ChecklistSectionBundle[];
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

export type ChecklistResponseRecord = {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  checklist_item_id: string;
  checklist_section_id: string;
  response_json: unknown;
  is_complete: boolean;
  answered_by_user_id: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistAttachmentRecord = {
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
  created_at: string;
};

export type ChecklistCommentRecord = {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  checklist_response_id: string | null;
  checklist_item_id: string | null;
  author_user_id: string | null;
  body: string;
  visibility: ChecklistCommentVisibility;
  created_at: string;
  updated_at: string;
};

export type ChecklistApprovalRecord = {
  id: string;
  tenant_id: string;
  checklist_instance_id: string;
  decision: ChecklistApprovalDecision;
  actor_user_id: string | null;
  note: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
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

export type ChecklistInstanceRecord = {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version_id: string;
  scope_type: ChecklistScopeType;
  job_id: string | null;
  shoot_id: string | null;
  production_item_id: string | null;
  location_id: string | null;
  department_type: ChecklistDepartmentType;
  title: string;
  trigger_type: ChecklistTriggerType;
  status: ChecklistInstanceStatus;
  approval_required: boolean;
  blocking_level: ChecklistBlockingLevel;
  owner_user_id: string | null;
  reviewer_user_id: string | null;
  approver_user_id: string | null;
  due_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  waived_at: string | null;
  rejection_note: string | null;
  waiver_note: string | null;
  progress_percent: number;
  created_from_trigger_key: string | null;
  source_metadata_json: Record<string, unknown>;
  last_reminded_at: string | null;
  escalated_at: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
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

export type ChecklistTemplateVersionInput = {
  name?: string | null;
  description?: string | null;
  code?: string | null;
  department_type?: ChecklistDepartmentType;
  scope_type: ChecklistScopeType;
  trigger_type?: ChecklistTriggerType;
  due_rule_json?: Record<string, unknown> | null;
  approval_required?: boolean;
  blocking_level?: ChecklistBlockingLevel;
  summary?: string | null;
  sections: Array<{
    section_key?: string | null;
    title: string;
    description?: string | null;
    sort_order?: number | null;
    items: Array<{
      item_key?: string | null;
      label: string;
      help_text?: string | null;
      item_type: ChecklistItemType;
      required?: boolean;
      proof_required?: boolean;
      validation_json?: Record<string, unknown> | null;
      options_json?: unknown[] | null;
      sort_order?: number | null;
      conditions?: Array<{
        condition_group_key?: string | null;
        logic_operator?: ChecklistConditionLogic;
        source_item_key: string;
        comparison_operator?: string | null;
        expected_value_json?: unknown;
        effect: ChecklistConditionEffect;
        sort_order?: number | null;
      }>;
    }>;
  }>;
};

export type CreateChecklistInstanceInput = {
  template_id?: string | null;
  template_code?: string | null;
  template_version_id?: string | null;
  scope_type: ChecklistScopeType;
  scope_id: string;
  title?: string | null;
  owner_user_id?: string | null;
  reviewer_user_id?: string | null;
  approver_user_id?: string | null;
  due_at?: string | null;
  created_from_trigger_key?: string | null;
  trigger_type?: ChecklistTriggerType;
  source_metadata_json?: Record<string, unknown> | null;
};

export type ChecklistResponseInput = {
  checklist_item_id: string;
  response_json: unknown;
};

export type ChecklistAttachmentInput = {
  checklist_response_id?: string | null;
  attachment_type: string;
  file_name: string;
  content_type: string;
  storage_key: string;
  object_url: string;
};

export type ChecklistCommentInput = {
  checklist_response_id?: string | null;
  checklist_item_id?: string | null;
  body: string;
  visibility?: ChecklistCommentVisibility;
};

export type ChecklistTemplateQuery = {
  department_type?: ChecklistDepartmentType | "all";
  scope_type?: ChecklistScopeType;
  include_archived?: boolean;
};

export type ChecklistInstancesQuery = {
  scope_type: ChecklistScopeType;
  scope_id: string;
};

export type ChecklistTransitionValidationInput = {
  resource_type: WorkflowBlockResourceType;
  from_stage?: string | null;
  to_stage: string;
  department_type?: ChecklistDepartmentType;
  job_id?: string | null;
  shoot_id?: string | null;
  production_item_id?: string | null;
  location_id?: string | null;
  allow_soft_override?: boolean;
  override_reason?: string | null;
};

export type ChecklistSeedDefaultsResult = {
  template_count: number;
  version_count: number;
  workflow_rule_count: number;
  reminder_rule_count: number;
};

export type ChecklistReminderSweepResult = {
  scanned_instance_count: number;
  alert_count: number;
  watch_flag_count: number;
};

export type ChecklistUploadAsset = {
  file_name: string;
  content_type: string;
  storage_key: string;
  object_url: string;
};
