import type {
  JobDepartmentType,
  JobDayStatus,
  JobPriorityLevel,
  JobStatus,
  ScheduleEntryType,
  WorkAssignmentStatus,
  WorkAssignmentType,
  WorkDepartmentType,
  WorkObjectKind,
  WorkTaskStatus
} from "../domain/jobTruth/index.js";
import type { EventRecord, StaffAssignmentRecord } from "./jobTruth.js";
import type { SharedResourcePolicySnapshot } from "./policy.js";
import type { SharedWorkflowFamily, SharedWorkflowRunStatus, SharedWorkflowTaskRuntimeDetail } from "./sharedWorkflow.js";

type TimestampValue = string | Date;

/**
 * Canonical operational event records live in `jobTruth.ts` as `EventRecord`.
 *
 * @deprecated Use `EventRecord`. `JobEventRecord` remains only as a compatibility alias
 * for legacy work-model consumers while the repo migrates off the old naming.
 */
export type JobEventRecord = EventRecord;

export interface WorkTaskRecord {
  id: string;
  tenant_id: string;
  task_number: string;
  title: string;
  description: string | null;
  task_type: string;
  department_type: WorkDepartmentType;
  /**
   * Canonical task-to-job linkage for the phase-one operating spine.
   */
  job_id: string | null;
  /**
   * Canonical optional linkage to the owning operational event.
   */
  event_id: string | null;
  /**
   * Canonical optional linkage to the owning shared workflow run.
   */
  workflow_run_id: string | null;
  /**
   * @deprecated Use `job_id`. The backing table still stores `related_job_id`, so this field
   * remains in API contracts during the compatibility window.
   */
  related_job_id: string | null;
  assigned_to_user_id: string | null;
  assigned_team_id: string | null;
  status: WorkTaskStatus;
  priority: JobPriorityLevel;
  due_at: TimestampValue | null;
  blocked_reason: string | null;
  proof_required: boolean;
  completion_notes: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

/**
 * Canonical staffing assignments live in `jobTruth.ts` as `StaffAssignmentRecord`.
 *
 * @deprecated Use `StaffAssignmentRecord`. `WorkAssignmentRecord` remains only as a compatibility alias
 * for legacy work-model consumers while staffing converges on one primary truth.
 */
export type WorkAssignmentRecord = StaffAssignmentRecord;

/**
 * Schedule projections are derived read models for calendar and board rendering.
 * They are not a primary peer truth beside Job, Event, StaffAssignment, or Task.
 */
export interface ScheduleProjectionRecord {
  id: string;
  schedule_type: ScheduleEntryType;
  /**
   * Canonical projection linkage back to the owning job.
   */
  source_job_id: string | null;
  /**
   * Canonical projection linkage back to the owning operational event.
   */
  source_event_id: string | null;
  /**
   * Canonical projection linkage back to the staffing assignment that rendered this schedule row.
   */
  source_staff_assignment_id: string | null;
  /**
   * @deprecated Use `source_job_id`.
   */
  related_job_id: string | null;
  /**
   * @deprecated Use `source_staff_assignment_id`.
   */
  related_assignment_id: string | null;
  user_id: string | null;
  team_id: string | null;
  title: string;
  start_datetime: TimestampValue;
  end_datetime: TimestampValue;
  location_id: string | null;
  department_type: JobDepartmentType | WorkDepartmentType | null;
  status: string;
  display_group: string | null;
}

/**
 * @deprecated Use `ScheduleProjectionRecord`.
 */
export type ScheduleEntryRecord = ScheduleProjectionRecord;

export interface WorkTaskAssignmentRecord {
  id: string;
  tenant_id: string;
  work_task_id: string;
  user_id: string;
  related_job_id: string | null;
  assignment_type: WorkAssignmentType;
  role_on_job: string | null;
  start_datetime: TimestampValue | null;
  end_datetime: TimestampValue | null;
  status: WorkAssignmentStatus;
  notes: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

export interface WorkModelSummary {
  object_kind: WorkObjectKind;
  title: string;
  description: string;
  relationships: string[];
}

export interface WorkTaskListItem extends WorkTaskRecord {
  assigned_to_name: string | null;
  related_job_number: string | null;
  related_job_title: string | null;
  organization_name: string | null;
  department_label: string;
  related_job_status: JobStatus | null;
  related_job_department: JobDepartmentType | null;
}

export interface WorkTaskListQuery {
  department_type?: WorkDepartmentType | null;
  search?: string | null;
  assigned_to_user_id?: string | null;
  job_id?: string | null;
  /**
   * @deprecated Use `job_id`.
   */
  related_job_id?: string | null;
  status?: WorkTaskStatus | null;
  due_bucket?: "overdue" | "today" | "next_7_days" | null;
  proof_required?: boolean | null;
  limit?: number | null;
}

export interface WorkTaskListResponse {
  items: WorkTaskListItem[];
}

export interface WorkTaskLinkageRecord {
  job_id: string | null;
  event_id: string | null;
  workflow_run_id: string | null;
}

export interface WorkTaskRelatedEventRecord extends Pick<EventRecord, "id" | "job_id" | "day_label" | "date" | "timezone"> {
  day_status: JobDayStatus;
}

export interface WorkTaskRelatedWorkflowRunRecord {
  id: string;
  job_id: string;
  template_id: string;
  template_version_id: string;
  template_key: string;
  template_name: string | null;
  version_number: number | null;
  workflow_family: SharedWorkflowFamily;
  status: SharedWorkflowRunStatus;
}

export interface WorkTaskDetailResponse {
  task: WorkTaskListItem;
  linkage: WorkTaskLinkageRecord;
  related_job: {
    id: string;
    job_number: string | null;
    title: string;
    department_type: JobDepartmentType;
    job_status: JobStatus;
  } | null;
  related_event: WorkTaskRelatedEventRecord | null;
  related_workflow_run: WorkTaskRelatedWorkflowRunRecord | null;
  shared_workflow_runtime: SharedWorkflowTaskRuntimeDetail | null;
  assignments: Array<WorkTaskAssignmentRecord & { user_name: string | null }>;
  work_model: WorkModelSummary[];
  policy: SharedResourcePolicySnapshot;
}

export interface WorkTaskCreateInput {
  title: string;
  description?: string | null;
  task_type?: string | null;
  department_type: WorkDepartmentType;
  job_id?: string | null;
  organization_id?: string | null;
  event_id?: string | null;
  workflow_run_id?: string | null;
  /**
   * @deprecated Use `job_id`.
   */
  related_job_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_team_id?: string | null;
  status?: WorkTaskStatus | null;
  priority?: JobPriorityLevel | null;
  due_at?: string | null;
  blocked_reason?: string | null;
  proof_required?: boolean | null;
  completion_notes?: string | null;
}

export interface WorkTaskUpdateInput {
  title?: string | null;
  description?: string | null;
  task_type?: string | null;
  assigned_to_user_id?: string | null;
  assigned_team_id?: string | null;
  status?: WorkTaskStatus | null;
  priority?: JobPriorityLevel | null;
  due_at?: string | null;
  blocked_reason?: string | null;
  proof_required?: boolean | null;
  completion_notes?: string | null;
}
