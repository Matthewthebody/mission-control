import type { JobDepartmentType, JobPriorityLevel, JobStatus, SharedResourcePolicySnapshot } from "./jobTruthTypes";

export type WorkObjectKind = "job_event" | "task" | "assignment" | "schedule_entry";
export type WorkDepartmentType = "schools" | "sports" | "production" | "photography" | "operations" | "other";
export type SharedTaskStatus = "not_started" | "in_progress" | "waiting" | "blocked" | "review" | "completed" | "cancelled";
export type SharedAssignmentType =
  | "photographer"
  | "assistant"
  | "account_rep"
  | "production_assignee"
  | "lead"
  | "backup"
  | "driver"
  | "editor"
  | "qa_reviewer";
export type SharedAssignmentStatus = "assigned" | "confirmed" | "in_progress" | "completed" | "cancelled";
export type SharedScheduleEntryType = "job_event" | "staffing" | "availability" | "hold" | "travel" | "internal";

export type SharedJobEventModel = {
  id: string;
  job_number: string | null;
  title: string;
  type: string;
  department_primary: JobDepartmentType;
  departments_involved: JobDepartmentType[];
  organization_id: string | null;
  location_id: string | null;
  contact_ids: string[];
  account_rep_id: string | null;
  owner_id: string | null;
  status: JobStatus;
  priority: JobPriorityLevel;
  risk_level: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  due_date: string | null;
  staffing_status: string | null;
  readiness_status: string | null;
  production_status: string | null;
  travel_status: string | null;
  notes: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedTaskRecord = {
  id: string;
  tenant_id: string;
  task_number: string;
  title: string;
  description: string | null;
  task_type: string;
  department_type: WorkDepartmentType;
  related_job_id: string | null;
  assigned_to_user_id: string | null;
  assigned_team_id: string | null;
  status: SharedTaskStatus;
  priority: JobPriorityLevel;
  due_at: string | null;
  blocked_reason: string | null;
  proof_required: boolean;
  completion_notes: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedAssignmentRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  related_job_id: string | null;
  related_task_id: string | null;
  role_on_job: string | null;
  assignment_type: SharedAssignmentType;
  start_datetime: string | null;
  end_datetime: string | null;
  status: SharedAssignmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedScheduleEntryRecord = {
  id: string;
  schedule_type: SharedScheduleEntryType;
  related_job_id: string | null;
  related_assignment_id: string | null;
  user_id: string | null;
  team_id: string | null;
  title: string;
  start_datetime: string;
  end_datetime: string;
  location_id: string | null;
  department_type: JobDepartmentType | WorkDepartmentType | null;
  status: string;
  display_group: string | null;
};

export type SharedTaskAssignment = {
  id: string;
  tenant_id: string;
  work_task_id: string;
  user_id: string;
  user_name: string | null;
  related_job_id: string | null;
  assignment_type: SharedAssignmentType;
  role_on_job: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  status: SharedAssignmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkModelSummary = {
  object_kind: WorkObjectKind;
  title: string;
  description: string;
  relationships: string[];
};

export type SharedTaskListItem = SharedTaskRecord & {
  assigned_to_name: string | null;
  related_job_number: string | null;
  related_job_title: string | null;
  related_job_status: JobStatus | null;
  related_job_department: JobDepartmentType | null;
  organization_name: string | null;
  department_label: string;
};

export type SharedTaskListQuery = {
  department_type?: WorkDepartmentType;
  search?: string;
  assigned_to_user_id?: string;
  related_job_id?: string;
  status?: SharedTaskStatus;
  due_bucket?: "overdue" | "today" | "next_7_days";
  proof_required?: boolean;
  limit?: number;
};

export type SharedTaskListResponse = {
  items: SharedTaskListItem[];
};

export type SharedTaskDetailResponse = {
  task: SharedTaskListItem;
  related_job: {
    id: string;
    job_number: string | null;
    title: string;
    department_type: JobDepartmentType;
    job_status: JobStatus;
  } | null;
  assignments: SharedTaskAssignment[];
  work_model: WorkModelSummary[];
  policy: SharedResourcePolicySnapshot;
};

export type SharedTaskCreateInput = {
  title: string;
  description?: string | null;
  task_type?: string | null;
  department_type: WorkDepartmentType;
  related_job_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_team_id?: string | null;
  status?: SharedTaskStatus | null;
  priority?: JobPriorityLevel | null;
  due_at?: string | null;
  blocked_reason?: string | null;
  proof_required?: boolean | null;
  completion_notes?: string | null;
};

export type SharedTaskUpdateInput = Partial<Omit<SharedTaskCreateInput, "department_type" | "related_job_id">>;
