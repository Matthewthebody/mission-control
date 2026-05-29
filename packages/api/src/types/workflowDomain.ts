import type { DepartmentCode } from "./auth.js";
import type { WorkShiftKind, WorkShiftStatus } from "./domain.js";
import type {
  OperationalApprovalRequestType,
  OperationalApprovalStatus,
  OperationalApprovalStepStatus
} from "./operationalApprovals.js";
import type {
  ProductionProjectJobType,
  ProductionProjectPriority,
  ProductionProjectStage,
  ProductionProjectStatus,
  ProductionProjectTaskStatus,
  ProductionProjectTaskType
} from "./productionProjects.js";
import type {
  UrgentWatchSeverity,
  UrgentWatchSourceModule,
  UrgentWatchStatus,
  UrgentWatchType
} from "./urgentWatch.js";

export const STAFFING_ISSUE_TYPES = [
  "coverage_gap",
  "critical_role_gap",
  "assignment_conflict",
  "overstaffed",
  "unconfirmed_labor",
  "attendance_impact",
  "replacement_needed",
  "missing_contact_info",
  "unconfirmed_shoot",
  "other"
] as const;
export type StaffingIssueType = (typeof STAFFING_ISSUE_TYPES)[number];

export const STAFFING_ISSUE_STATUSES = ["open", "acknowledged", "in_progress", "resolved", "canceled"] as const;
export type StaffingIssueStatus = (typeof STAFFING_ISSUE_STATUSES)[number];

export const STAFFING_ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type StaffingIssueSeverity = (typeof STAFFING_ISSUE_SEVERITIES)[number];

export const ATTENDANCE_RECORD_STATES = [
  "scheduled",
  "upcoming",
  "grace_window",
  "checked_in",
  "on_time",
  "late",
  "late_acknowledged",
  "unresolved_no_check_in",
  "called_out",
  "replacement_needed",
  "no_show",
  "manager_excused",
  "completed",
  "canceled"
] as const;
export type AttendanceRecordState = (typeof ATTENDANCE_RECORD_STATES)[number];

export const ATTENDANCE_EVENT_SOURCES = [
  "system_schedule",
  "employee_check_in",
  "manager_mark_present",
  "time_clock_start",
  "manager_acknowledge_late",
  "manager_mark_called_out",
  "manager_request_replacement",
  "manager_mark_no_show",
  "manager_excuse",
  "system_complete",
  "system_cancel"
] as const;
export type AttendanceEventSource = (typeof ATTENDANCE_EVENT_SOURCES)[number];

export const WORKFLOW_ENTITY_TYPES = [
  "assignment",
  "staffing_issue",
  "watch_item",
  "production_job",
  "production_task",
  "approval_request",
  "attendance_record"
] as const;
export type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

export interface AssignmentRecord {
  id: string;
  tenant_id: string;
  shoot_id: string | null;
  studio_id: string | null;
  assigned_user_id: string;
  assigned_user_name: string | null;
  manager_user_id: string | null;
  manager_user_name: string | null;
  shift_kind: WorkShiftKind;
  status: WorkShiftStatus;
  department: DepartmentCode;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  staffing_role: string | null;
  staffing_requirement_id: string | null;
  assignment_source: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export interface AssignmentEventRecord {
  id: string;
  assignment_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface StaffingIssueRecord {
  id: string;
  tenant_id: string;
  issue_type: StaffingIssueType;
  status: StaffingIssueStatus;
  severity: StaffingIssueSeverity;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  department: DepartmentCode | null;
  shift_id: string | null;
  shoot_id: string | null;
  staffing_requirement_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  acknowledged_by_user_id: string | null;
  resolved_by_user_id: string | null;
  dedupe_key: string | null;
  title: string;
  summary: string | null;
  resolution_note: string | null;
  source_snapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffingIssueEventRecord {
  id: string;
  staffing_issue_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WatchItemRecord {
  id: string;
  tenant_id: string;
  source_module: UrgentWatchSourceModule;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  scope_department: string | null;
  watch_type: UrgentWatchType;
  status: UrgentWatchStatus;
  severity: UrgentWatchSeverity;
  title: string;
  summary: string;
  owner_user_id: string | null;
  owner_name: string | null;
  due_at: string | null;
  next_action_label: string;
  action_hash: string;
  operational_impact_score: number;
  source_snapshot: Record<string, unknown>;
  snoozed_until: string | null;
  handled_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WatchItemEventRecord {
  id: string;
  watch_item_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProductionJobRecord {
  id: string;
  tenant_id: string;
  title: string;
  summary: string | null;
  job_type: ProductionProjectJobType;
  stage: ProductionProjectStage;
  status: ProductionProjectStatus;
  priority: ProductionProjectPriority;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  linked_organization_id: string | null;
  linked_location_id: string | null;
  linked_shoot_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProductionTaskRecord {
  id: string;
  tenant_id: string;
  production_job_id: string;
  title: string;
  summary: string | null;
  status: ProductionProjectTaskStatus;
  task_type: ProductionProjectTaskType;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  required: boolean;
  sort_order: number;
  handoff_required: boolean;
  blocks_release: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProductionJobEventRecord {
  id: string;
  production_job_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProductionTaskEventRecord {
  id: string;
  production_job_id: string;
  production_task_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ApprovalRequestRecord {
  id: string;
  tenant_id: string;
  request_type: OperationalApprovalRequestType;
  status: OperationalApprovalStatus;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  blocking: boolean;
  requested_action_code: string;
  request_title: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  requested_by_user_id: string;
  requested_by_name: string | null;
  current_approver_user_id: string | null;
  current_approver_name: string | null;
  current_step_status: OperationalApprovalStepStatus | null;
  sla_due_at: string | null;
  escalation_level: number;
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequestEventRecord {
  id: string;
  approval_request_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AttendanceRecord {
  shift_id: string;
  tenant_id: string;
  shoot_id: string | null;
  employee_id: string;
  employee_name: string | null;
  current_state: AttendanceRecordState;
  current_state_reason: string | null;
  signal_source: AttendanceEventSource;
  last_signal_at: string | null;
  first_present_at: string | null;
  escalation_level: number;
  coverage_impact: boolean;
  critical_role_missing: boolean;
  understaffed_due_to_attendance: boolean;
  active_present_count: number;
  present_lead_count: number;
  last_evaluated_at: string | null;
  last_state_changed_at: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceEventRecord {
  id: string;
  attendance_record_id: string;
  event_type: string;
  from_state: AttendanceRecordState | null;
  to_state: AttendanceRecordState | null;
  signal_source: AttendanceEventSource | null;
  escalation_level: number | null;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowHistoryRecord {
  id: string;
  module: "assignments" | "staffing" | "watch" | "production" | "approvals" | "attendance";
  scope_department?: string | null;
  entity_type: WorkflowEntityType;
  entity_id: string;
  parent_entity_type: WorkflowEntityType | null;
  parent_entity_id: string | null;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowEntityRecordMap {
  assignment: AssignmentRecord;
  staffing_issue: StaffingIssueRecord;
  watch_item: WatchItemRecord;
  production_job: ProductionJobRecord;
  production_task: ProductionTaskRecord;
  approval_request: ApprovalRequestRecord;
  attendance_record: AttendanceRecord;
}

export interface WorkflowEntityEventRecordMap {
  assignment: AssignmentEventRecord;
  staffing_issue: StaffingIssueEventRecord;
  watch_item: WatchItemEventRecord;
  production_job: ProductionJobEventRecord;
  production_task: ProductionTaskEventRecord;
  approval_request: ApprovalRequestEventRecord;
  attendance_record: AttendanceEventRecord;
}

export type WorkflowEntityRecord = WorkflowEntityRecordMap[WorkflowEntityType];
export type WorkflowEntityEventRecord = WorkflowEntityEventRecordMap[WorkflowEntityType];
