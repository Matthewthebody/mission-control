import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { WORK_DEPARTMENT_TYPES } from "../../domain/jobTruth/index.js";
import type {
  JobDepartmentType,
  JobStatus,
  WorkAssignmentStatus,
  WorkAssignmentType,
  WorkDepartmentType
} from "../../domain/jobTruth/index.js";
import type {
  WorkModelSummary,
  WorkTaskCreateInput,
  WorkTaskDetailResponse,
  WorkTaskListQuery,
  WorkTaskListResponse,
  WorkTaskRelatedEventRecord,
  WorkTaskRelatedWorkflowRunRecord,
  WorkTaskRecord,
  WorkTaskUpdateInput
} from "../../types/workModel.js";
import { ApiError } from "../../errors/apiError.js";
import { canCreateOrEditShootDepartment, canManageSchoolsHub, hasAuthorityTier } from "../../authz/authority.js";
import { buildSharedResourcePolicySnapshot, canSharedPolicy } from "../policy/index.js";
import { emitTaskCompletedEvent } from "../operationalEvents.js";
import { applyProactiveCommunicationRule } from "../proactiveCommunicationRules.js";
import { queueTeamsMeetingTaskRecordLifecycleSync } from "../teamsMeetings.js";
import { writeJobActivity } from "./activityLogService.js";
import { getSharedWorkflowTaskRuntime, handleSharedWorkflowTaskMutation } from "../workflow/sharedWorkflowService.js";
import { nextWorkTaskNumber } from "./workTaskNumbering.js";

type WorkTaskRow = WorkTaskRecord & {
  assigned_to_name: string | null;
  related_job_number: string | null;
  related_job_title: string | null;
  organization_name: string | null;
  department_label: string;
  related_job_status: JobStatus | null;
  related_job_department: JobDepartmentType | null;
};

type WorkTaskAssignmentRow = {
  id: string;
  tenant_id: string;
  work_task_id: string;
  user_id: string;
  user_name: string | null;
  related_job_id: string | null;
  assignment_type: WorkAssignmentType;
  role_on_job: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  status: WorkAssignmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type RelatedEventRow = WorkTaskRelatedEventRecord;

type RelatedWorkflowRunRow = WorkTaskRelatedWorkflowRunRecord;

export type WorkTaskDepartmentOpenCounts = {
  schools: number | null;
  sports: number | null;
  production: number | null;
};

type HomeTaskCountDepartment = keyof WorkTaskDepartmentOpenCounts;

const HOME_TASK_COUNT_DEPARTMENTS: HomeTaskCountDepartment[] = ["schools", "sports", "production"];

const WORK_MODEL_SUMMARY: WorkModelSummary[] = [
  {
    object_kind: "job_event",
    title: "Job / Event",
    description: "Canonical operational object in the phase-one spine. Jobs own work, and events carry schedule-bearing execution context.",
    relationships: ["May create many tasks", "May have many staff assignments", "May render schedule projections"]
  },
  {
    object_kind: "task",
    title: "Task",
    description: "Execution item that belongs to the canonical spine through one job and, later, an optional event or workflow run.",
    relationships: ["Must belong to one job", "May later link to one event", "May have one or more assignees"]
  },
  {
    object_kind: "assignment",
    title: "Staff Assignment",
    description: "Canonical staffing link between a person and job/event coverage. Legacy assignment naming remains only for compatibility.",
    relationships: ["Belongs to one job", "May belong to one event", "May render staffing schedule projections"]
  },
  {
    object_kind: "schedule_entry",
    title: "Schedule Entry",
    description: "Derived schedule projection used for boards and calendars. It is not a primary operating record.",
    relationships: ["Generated from jobs / events", "Generated from staff assignments", "Supports schedule views only"]
  }
];

function mapDepartmentToLegacy(department: WorkDepartmentType) {
  switch (department) {
    case "schools":
      return "schools";
    case "sports":
      return "sports";
    case "production":
      return "production";
    case "photography":
      return "operations";
    case "operations":
    case "other":
    default:
      return "operations";
  }
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? normalized : date.toISOString();
}

function toActivityDepartmentType(department: WorkDepartmentType, relatedJobDepartment: JobDepartmentType | null): JobDepartmentType | null {
  if (department === "schools" || department === "sports") {
    return department;
  }
  return relatedJobDepartment;
}

function buildTaskPolicyContext(
  task: Pick<WorkTaskRecord, "department_type" | "job_id" | "related_job_id" | "assigned_to_user_id" | "created_by_user_id">
) {
  const jobId = task.job_id ?? task.related_job_id;
  return {
    departmentType: task.department_type,
    ownerUserIds: [task.created_by_user_id],
    assignedUserIds: task.assigned_to_user_id ? [task.assigned_to_user_id] : [],
    customScopeValues: jobId ? [jobId] : []
  };
}

export function canManageTaskDepartment(auth: AuthUser, department: WorkDepartmentType) {
  if (
    canSharedPolicy(auth, "task.create", { departmentType: department }) ||
    canSharedPolicy(auth, "task.update", { departmentType: department }) ||
    canSharedPolicy(auth, "task.assign", { departmentType: department }) ||
    canSharedPolicy(auth, "job.create", { departmentType: department }) ||
    canSharedPolicy(auth, "job.update", { departmentType: department }) ||
    canSharedPolicy(auth, "production.update", { departmentType: department })
  ) {
    return true;
  }

  const legacyDepartment = mapDepartmentToLegacy(department);
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (department === "schools" && canManageSchoolsHub(auth)) ||
    (department === "schools" || department === "sports"
      ? canCreateOrEditShootDepartment(auth, legacyDepartment)
      : false)
  );
}

export function canReadTaskDepartment(auth: AuthUser, department: WorkDepartmentType) {
  if (
    canSharedPolicy(auth, "task.read", { departmentType: department }) ||
    canSharedPolicy(auth, "task.update", { departmentType: department }) ||
    canSharedPolicy(auth, "task.assign", { departmentType: department }) ||
    canSharedPolicy(auth, "job.read", { departmentType: department }) ||
    canSharedPolicy(auth, "job.update", { departmentType: department }) ||
    canSharedPolicy(auth, "production.read", { departmentType: department }) ||
    canSharedPolicy(auth, "production.update", { departmentType: department })
  ) {
    return true;
  }

  return canManageTaskDepartment(auth, department);
}

function requireTaskWriteAccess(auth: AuthUser, department: WorkDepartmentType) {
  if (!canManageTaskDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
}

function requireTaskReadAccess(auth: AuthUser, department: WorkDepartmentType, task: WorkTaskRecord) {
  if (canReadTaskDepartment(auth, department)) {
    return;
  }
  if (task.assigned_to_user_id === auth.id || task.created_by_user_id === auth.id) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

async function loadRelatedJob(client: PoolClient, tenantId: string, jobId: string) {
  const result = await client.query<{
    id: string;
    job_number: string | null;
    title: string;
    department_type: JobDepartmentType;
    job_status: JobStatus;
    organization_id: string | null;
  }>(
    `
      SELECT
        job.id::text,
        job.job_number,
        job.title,
        job.department_type::text AS department_type,
        job.job_status::text AS job_status,
        job.organization_id::text AS organization_id
      FROM jobs job
      WHERE job.tenant_id = $1
        AND job.id = $2
      LIMIT 1
    `,
    [tenantId, jobId]
  );
  return result.rows[0] ?? null;
}

async function loadRelatedEvent(client: PoolClient, tenantId: string, eventId: string) {
  const result = await client.query<RelatedEventRow>(
    `
      SELECT
        day.id::text,
        day.job_id::text,
        day.day_label,
        day.date::text,
        day.timezone,
        day.day_status::text AS day_status
      FROM job_days day
      WHERE day.tenant_id = $1
        AND day.id = $2
      LIMIT 1
    `,
    [tenantId, eventId]
  );
  return result.rows[0] ?? null;
}

async function loadRelatedWorkflowRun(client: PoolClient, tenantId: string, workflowRunId: string) {
  const result = await client.query<RelatedWorkflowRunRow>(
    `
      SELECT
        run.id::text,
        run.job_id::text,
        run.template_id::text,
        run.template_version_id::text,
        run.template_key,
        template.name AS template_name,
        version_row.version_number,
        run.workflow_family::text AS workflow_family,
        run.status::text AS status
      FROM workflow_run run
      LEFT JOIN workflow_template template
        ON template.tenant_id = run.tenant_id
       AND template.id = run.template_id
      LEFT JOIN workflow_template_version version_row
        ON version_row.tenant_id = run.tenant_id
       AND version_row.id = run.template_version_id
      WHERE run.tenant_id = $1
        AND run.id = $2
      LIMIT 1
    `,
    [tenantId, workflowRunId]
  );
  return result.rows[0] ?? null;
}

async function resolveTaskLinkage(
  client: PoolClient,
  tenantId: string,
  input: Pick<WorkTaskCreateInput, "job_id" | "organization_id" | "related_job_id" | "event_id" | "workflow_run_id">
) {
  const explicitJobId = input.job_id ?? input.related_job_id ?? null;
  const relatedEvent = input.event_id ? await loadRelatedEvent(client, tenantId, input.event_id) : null;
  if (input.event_id && !relatedEvent) {
    throw new ApiError(404, "Related event not found");
  }
  const relatedWorkflowRun = input.workflow_run_id ? await loadRelatedWorkflowRun(client, tenantId, input.workflow_run_id) : null;
  if (input.workflow_run_id && !relatedWorkflowRun) {
    throw new ApiError(404, "Related workflow run not found");
  }

  const candidateJobIds = [explicitJobId, relatedEvent?.job_id ?? null, relatedWorkflowRun?.job_id ?? null].filter(
    (value): value is string => Boolean(value)
  );
  const resolvedJobId = candidateJobIds[0] ?? null;

  if (!resolvedJobId && !input.organization_id) {
    throw new ApiError(400, "Tasks must link to a job, event, workflow run, or client account.");
  }

  if (candidateJobIds.some((value) => value !== resolvedJobId)) {
    throw new ApiError(409, "Task linkage must resolve to one owning job.");
  }

  return {
    resolvedJobId,
    relatedEvent,
    relatedWorkflowRun
  };
}

async function loadTaskRow(client: PoolClient, tenantId: string, taskId: string) {
  const result = await client.query<WorkTaskRow>(
    `
      SELECT
        task.id::text,
        task.tenant_id::text,
        task.task_number,
        task.title,
        task.description,
        task.task_type,
        task.department_type::text AS department_type,
        task.related_job_id::text AS job_id,
        task.job_day_id::text AS event_id,
        task.workflow_run_id::text AS workflow_run_id,
        task.related_job_id::text,
        task.assigned_to_user_id::text,
        task.assigned_team_id,
        task.status::text,
        task.priority::text,
        task.due_at::text,
        task.blocked_reason,
        task.proof_required,
        task.completion_notes,
        task.created_by_user_id::text,
        task.updated_by_user_id::text,
        task.created_at::text,
        task.updated_at::text,
        assigned_user.full_name AS assigned_to_name,
        job.job_number AS related_job_number,
        job.title AS related_job_title,
        organization.display_name AS organization_name,
        initcap(replace(task.department_type::text, '_', ' ')) AS department_label,
        job.job_status::text AS related_job_status,
        job.department_type::text AS related_job_department
      FROM work_task task
      LEFT JOIN app_user assigned_user
        ON assigned_user.tenant_id = task.tenant_id
       AND assigned_user.id = task.assigned_to_user_id
      LEFT JOIN jobs job
        ON job.tenant_id = task.tenant_id
       AND job.id = task.related_job_id
      LEFT JOIN organization
        ON organization.id = job.organization_id
      WHERE task.tenant_id = $1
        AND task.id = $2
      LIMIT 1
    `,
    [tenantId, taskId]
  );
  return result.rows[0] ?? null;
}

async function listTaskAssignments(client: PoolClient, tenantId: string, taskId: string) {
  const result = await client.query<WorkTaskAssignmentRow>(
    `
      SELECT
        assignment.id::text,
        assignment.tenant_id::text,
        assignment.work_task_id::text,
        assignment.user_id::text,
        user_row.full_name AS user_name,
        assignment.related_job_id::text,
        assignment.assignment_type::text,
        assignment.role_on_job,
        assignment.start_datetime::text,
        assignment.end_datetime::text,
        assignment.status::text,
        assignment.notes,
        assignment.created_at::text,
        assignment.updated_at::text
      FROM work_task_assignment assignment
      LEFT JOIN app_user user_row
        ON user_row.tenant_id = assignment.tenant_id
       AND user_row.id = assignment.user_id
      WHERE assignment.tenant_id = $1
        AND assignment.work_task_id = $2
      ORDER BY assignment.created_at ASC
    `,
    [tenantId, taskId]
  );
  return result.rows;
}

export async function listWorkTasks(client: PoolClient, auth: AuthUser, filters: WorkTaskListQuery = {}): Promise<WorkTaskListResponse> {
  const allowedDepartments = WORK_DEPARTMENT_TYPES.filter((department) => canReadTaskDepartment(auth, department));
  const params: unknown[] = [auth.tenantId, auth.id, allowedDepartments];
  const limit = Math.min(Math.max(Number(filters.limit ?? 60), 1), 200);
  let sql = `
    SELECT
      task.id::text,
      task.tenant_id::text,
      task.task_number,
      task.title,
      task.description,
      task.task_type,
      task.department_type::text AS department_type,
      task.related_job_id::text AS job_id,
      task.job_day_id::text AS event_id,
      task.workflow_run_id::text AS workflow_run_id,
      task.related_job_id::text,
      task.assigned_to_user_id::text,
      task.assigned_team_id,
      task.status::text,
      task.priority::text,
      task.due_at::text,
      task.blocked_reason,
      task.proof_required,
      task.completion_notes,
      task.created_by_user_id::text,
      task.updated_by_user_id::text,
      task.created_at::text,
      task.updated_at::text,
      assigned_user.full_name AS assigned_to_name,
      job.job_number AS related_job_number,
      job.title AS related_job_title,
      organization.display_name AS organization_name,
      initcap(replace(task.department_type::text, '_', ' ')) AS department_label,
      job.job_status::text AS related_job_status,
      job.department_type::text AS related_job_department
    FROM work_task task
    LEFT JOIN app_user assigned_user
      ON assigned_user.tenant_id = task.tenant_id
     AND assigned_user.id = task.assigned_to_user_id
    LEFT JOIN jobs job
      ON job.tenant_id = task.tenant_id
     AND job.id = task.related_job_id
    LEFT JOIN organization
      ON organization.id = job.organization_id
    WHERE task.tenant_id = $1
      AND (
        task.department_type = ANY($3::work_department_type[])
        OR task.assigned_to_user_id = $2::uuid
        OR task.created_by_user_id = $2::uuid
      )
  `;

  if (filters.department_type) {
    params.push(filters.department_type);
    sql += ` AND task.department_type = $${params.length}::work_department_type`;
  }

  const search = normalizeNullableText(filters.search)?.toLowerCase() ?? null;
  if (search) {
    params.push(`%${search}%`);
    const searchIndex = params.length;
    sql += `
      AND (
        lower(task.title) LIKE $${searchIndex}
        OR lower(coalesce(task.task_number, '')) LIKE $${searchIndex}
        OR lower(coalesce(task.description, '')) LIKE $${searchIndex}
        OR lower(coalesce(task.task_type, '')) LIKE $${searchIndex}
        OR lower(coalesce(assigned_user.full_name, '')) LIKE $${searchIndex}
        OR lower(coalesce(job.job_number, '')) LIKE $${searchIndex}
        OR lower(coalesce(job.title, '')) LIKE $${searchIndex}
        OR lower(coalesce(organization.display_name, '')) LIKE $${searchIndex}
      )
    `;
  }

  if (filters.assigned_to_user_id) {
    params.push(filters.assigned_to_user_id);
    sql += ` AND task.assigned_to_user_id = $${params.length}::uuid`;
  }

  const relatedJobFilter = filters.job_id ?? filters.related_job_id ?? null;
  if (relatedJobFilter) {
    params.push(relatedJobFilter);
    sql += ` AND task.related_job_id = $${params.length}::uuid`;
  }

  if (filters.status) {
    params.push(filters.status);
    sql += ` AND task.status = $${params.length}::work_task_status_type`;
  }

  if (filters.proof_required !== null && filters.proof_required !== undefined) {
    params.push(filters.proof_required);
    sql += ` AND task.proof_required = $${params.length}`;
  }

  if (filters.due_bucket === "overdue") {
    sql += ` AND task.due_at IS NOT NULL AND task.due_at < now()`;
  } else if (filters.due_bucket === "today") {
    sql += ` AND task.due_at::date = current_date`;
  } else if (filters.due_bucket === "next_7_days") {
    sql += ` AND task.due_at IS NOT NULL AND task.due_at >= now() AND task.due_at < now() + interval '7 days'`;
  }

  params.push(limit);
  sql += `
    ORDER BY
      CASE WHEN task.due_at IS NULL THEN 1 ELSE 0 END,
      task.due_at ASC NULLS LAST,
      task.updated_at DESC
    LIMIT $${params.length}
  `;

  const result = await client.query<WorkTaskRow>(sql, params);
  const items = result.rows.filter((task) => {
    if (canReadTaskDepartment(auth, task.department_type)) {
      return true;
    }
    return task.assigned_to_user_id === auth.id || task.created_by_user_id === auth.id;
  });

  return { items };
}

export async function listOpenTaskCountsByDepartment(
  client: PoolClient,
  auth: AuthUser,
  departments: HomeTaskCountDepartment[] = HOME_TASK_COUNT_DEPARTMENTS
): Promise<WorkTaskDepartmentOpenCounts> {
  const requestedDepartments = departments.filter(
    (department): department is HomeTaskCountDepartment => HOME_TASK_COUNT_DEPARTMENTS.includes(department)
  );
  const counts: WorkTaskDepartmentOpenCounts = {
    schools: null,
    sports: null,
    production: null
  };

  if (!requestedDepartments.length) {
    return counts;
  }

  const readableDepartments = requestedDepartments.filter((department) => canReadTaskDepartment(auth, department));
  for (const department of readableDepartments) {
    counts[department] = 0;
  }

  const scopedDepartments = requestedDepartments.filter((department) => readableDepartments.includes(department));
  if (!scopedDepartments.length) {
    return counts;
  }

  const result = await client.query<{ department_type: HomeTaskCountDepartment; open_count: string }>(
    `
      SELECT
        task.department_type::text AS department_type,
        count(*)::text AS open_count
      FROM work_task task
      WHERE task.tenant_id = $1
        AND task.department_type = ANY($2::work_department_type[])
        AND task.status NOT IN ('completed'::work_task_status_type, 'cancelled'::work_task_status_type)
      GROUP BY task.department_type
    `,
    [auth.tenantId, scopedDepartments]
  );

  for (const row of result.rows) {
    counts[row.department_type] = Number(row.open_count ?? 0);
  }

  return counts;
}

async function syncPrimaryAssignment(
  client: PoolClient,
  task: Pick<WorkTaskRecord, "id" | "tenant_id" | "job_id" | "related_job_id">,
  assignedToUserId: string | null,
  taskType: string
) {
  const jobId = task.job_id ?? task.related_job_id;
  await client.query(
    `
      DELETE FROM work_task_assignment
      WHERE tenant_id = $1
        AND work_task_id = $2
        AND assignment_type = 'production_assignee'::work_assignment_type
    `,
    [task.tenant_id, task.id]
  );

  if (!assignedToUserId) {
    return;
  }

  await client.query(
    `
      INSERT INTO work_task_assignment (
        tenant_id,
        work_task_id,
        user_id,
        related_job_id,
        assignment_type,
        role_on_job,
        status
      )
      VALUES ($1,$2,$3,$4,'production_assignee'::work_assignment_type,$5,'assigned'::work_assignment_status_type)
      ON CONFLICT (work_task_id, user_id, assignment_type)
      DO UPDATE
      SET
        related_job_id = EXCLUDED.related_job_id,
        role_on_job = EXCLUDED.role_on_job,
        status = EXCLUDED.status,
        updated_at = now()
    `,
    [task.tenant_id, task.id, assignedToUserId, jobId, taskType]
  );
}

export async function createWorkTask(
  client: PoolClient,
  auth: AuthUser,
  input: WorkTaskCreateInput,
  meta: { requestId?: string | null; sourceSurface?: string | null } = {}
) {
  requireTaskWriteAccess(auth, input.department_type);

  const { resolvedJobId, relatedEvent, relatedWorkflowRun } = await resolveTaskLinkage(client, auth.tenantId, input);
  const relatedJob = resolvedJobId ? await loadRelatedJob(client, auth.tenantId, resolvedJobId) : null;
  if (resolvedJobId && !relatedJob) {
    throw new ApiError(404, "Related job not found");
  }
  if (input.organization_id) {
    const accountExists = await client.query<{ id: string }>(
      "SELECT id::text FROM organization WHERE tenant_id = $1 AND id = $2 LIMIT 1",
      [auth.tenantId, input.organization_id]
    );
    if (!accountExists.rows[0]) {
      throw new ApiError(404, "Related organization/account not found");
    }
  }
  const taskNumber = await nextWorkTaskNumber(client, auth.tenantId, input.department_type);
  const { rows } = await client.query<WorkTaskRecord>(
    `
      INSERT INTO work_task (
        tenant_id,
        task_number,
        title,
        description,
        task_type,
        department_type,
        organization_id,
        related_job_id,
        job_day_id,
        workflow_run_id,
        workflow_template_task_key,
        assigned_to_user_id,
        assigned_team_id,
        status,
        priority,
        due_at,
        blocked_reason,
        proof_required,
        completion_notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6::work_department_type,$7,$8,$9,$10,NULL,$11,$12,$13::work_task_status_type,$14::job_priority_level,$15,$16,$17,$18,$19,$19)
      RETURNING
        id::text,
        tenant_id::text,
        task_number,
        title,
        description,
        task_type,
        department_type::text,
        related_job_id::text AS job_id,
        job_day_id::text AS event_id,
        workflow_run_id::text AS workflow_run_id,
        related_job_id::text,
        assigned_to_user_id::text,
        assigned_team_id,
        status::text,
        priority::text,
        due_at::text,
        blocked_reason,
        proof_required,
        completion_notes,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
    `,
    [
      auth.tenantId,
      taskNumber,
      input.title.trim(),
      normalizeNullableText(input.description),
      normalizeNullableText(input.task_type) ?? "general",
      input.department_type,
      input.organization_id ?? relatedJob?.organization_id ?? null,
      resolvedJobId,
      relatedEvent?.id ?? null,
      relatedWorkflowRun?.id ?? null,
      input.assigned_to_user_id ?? null,
      normalizeNullableText(input.assigned_team_id),
      input.status ?? "not_started",
      input.priority ?? "normal",
      input.due_at ?? null,
      normalizeNullableText(input.blocked_reason),
      Boolean(input.proof_required),
      normalizeNullableText(input.completion_notes),
      auth.id
    ]
  );

  const created = rows[0];
  await syncPrimaryAssignment(client, created, created.assigned_to_user_id, created.task_type);
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    jobId: created.job_id,
    actorUserId: auth.id,
    eventType: "work_task_created",
    summary: `Created task ${created.task_number}`,
    departmentType: toActivityDepartmentType(created.department_type, relatedJob?.department_type ?? null),
    resourceType: "work_task",
    resourceId: created.id,
    parentResourceType: created.job_id ? "job" : null,
    parentResourceId: created.job_id,
    newValues: {
      title: created.title,
      task_number: created.task_number,
      task_type: created.task_type,
      status: created.status,
      priority: created.priority,
      job_id: created.job_id,
      event_id: created.event_id,
      workflow_run_id: created.workflow_run_id,
      related_job_id: created.related_job_id,
      assigned_to_user_id: created.assigned_to_user_id,
      proof_required: created.proof_required
    },
    metadata: {
      request_id: meta.requestId ?? null,
      source_surface: meta.sourceSurface ?? "shared_task_page"
    },
    sourceSurface: meta.sourceSurface ?? "shared_task_page"
  });

  return getWorkTaskDetail(client, auth, created.id);
}

export async function updateWorkTask(
  client: PoolClient,
  auth: AuthUser,
  taskId: string,
  input: WorkTaskUpdateInput,
  meta: { requestId?: string | null; sourceSurface?: string | null } = {}
) {
  const existing = await loadTaskRow(client, auth.tenantId, taskId);
  if (!existing) {
    throw new ApiError(404, "Task not found");
  }
  requireTaskWriteAccess(auth, existing.department_type);

  const nextAssignedToUserId = input.assigned_to_user_id === undefined ? existing.assigned_to_user_id : input.assigned_to_user_id;
  const nextStatus = input.status ?? existing.status;
  const nextPriority = input.priority ?? existing.priority;
  const nextTitle = normalizeNullableText(input.title) ?? existing.title;
  const nextDescription = input.description === undefined ? existing.description : normalizeNullableText(input.description);
  const nextTaskType = normalizeNullableText(input.task_type) ?? existing.task_type;
  const nextAssignedTeamId = input.assigned_team_id === undefined ? existing.assigned_team_id : normalizeNullableText(input.assigned_team_id);
  const nextDueAt = input.due_at === undefined ? existing.due_at : input.due_at;
  const nextBlockedReason = input.blocked_reason === undefined ? existing.blocked_reason : normalizeNullableText(input.blocked_reason);
  const nextProofRequired = input.proof_required ?? existing.proof_required;
  const nextCompletionNotes =
    input.completion_notes === undefined ? existing.completion_notes : normalizeNullableText(input.completion_notes);
  const meetingRelevantChange =
    existing.title !== nextTitle ||
    existing.assigned_to_user_id !== (nextAssignedToUserId ?? null) ||
    existing.status !== nextStatus ||
    normalizeTimestamp(existing.due_at) !== normalizeTimestamp(nextDueAt);

  await client.query(
    `
      UPDATE work_task
      SET
        title = $3,
        description = $4,
        task_type = $5,
        assigned_to_user_id = $6,
        assigned_team_id = $7,
        status = $8::work_task_status_type,
        priority = $9::job_priority_level,
        due_at = $10,
        blocked_reason = $11,
        proof_required = $12,
        completion_notes = $13,
        updated_by_user_id = $14,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      taskId,
      nextTitle,
      nextDescription,
      nextTaskType,
      nextAssignedToUserId ?? null,
      nextAssignedTeamId,
      nextStatus,
      nextPriority,
      nextDueAt ?? null,
      nextBlockedReason,
      nextProofRequired,
      nextCompletionNotes,
      auth.id
    ]
  );

  await syncPrimaryAssignment(
    client,
    {
      id: existing.id,
      tenant_id: existing.tenant_id,
      job_id: existing.job_id,
      related_job_id: existing.related_job_id
    },
    nextAssignedToUserId ?? null,
    nextTaskType
  );

  await handleSharedWorkflowTaskMutation(client, auth, existing, {
    assigned_to_user_id: nextAssignedToUserId ?? null,
    status: nextStatus
  });

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    jobId: existing.job_id,
    actorUserId: auth.id,
    eventType: "work_task_updated",
    summary: `Updated task ${existing.task_number}`,
    departmentType: toActivityDepartmentType(existing.department_type, existing.related_job_department),
    resourceType: "work_task",
    resourceId: existing.id,
    parentResourceType: existing.job_id ? "job" : null,
    parentResourceId: existing.job_id,
    oldValues: {
      title: existing.title,
      task_type: existing.task_type,
      job_id: existing.job_id,
      assigned_to_user_id: existing.assigned_to_user_id,
      status: existing.status,
      priority: existing.priority,
      due_at: existing.due_at,
      proof_required: existing.proof_required
    },
    newValues: {
      title: nextTitle,
      task_type: nextTaskType,
      job_id: existing.job_id,
      assigned_to_user_id: nextAssignedToUserId,
      status: nextStatus,
      priority: nextPriority,
      due_at: nextDueAt,
      proof_required: nextProofRequired
    },
    metadata: {
      request_id: meta.requestId ?? null,
      source_surface: meta.sourceSurface ?? "shared_task_page"
    },
    sourceSurface: meta.sourceSurface ?? "shared_task_page"
  });

  if (existing.status !== "completed" && nextStatus === "completed") {
    await emitTaskCompletedEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      taskId: existing.id,
      taskNumber: existing.task_number,
      taskTitle: nextTitle,
      relatedJobId: existing.job_id,
      recipientUserIds: [...new Set([existing.created_by_user_id, nextAssignedToUserId ?? null])]
        .filter((value): value is string => Boolean(value) && value !== auth.id)
    });
  }

  const overdueNow =
    Boolean(existing.job_id) &&
    Boolean(nextDueAt) &&
    nextStatus !== "completed" &&
    nextStatus !== "cancelled" &&
    new Date(nextDueAt as string).getTime() <= Date.now();

  if (overdueNow) {
    await applyProactiveCommunicationRule(client, auth, {
      triggerType: "overdue_task_tied_to_job",
      sourceModule: "tasks",
      sourceObjectType: "work_task",
      sourceObjectId: existing.id,
      sourceObjectLabel: existing.task_number,
      communicationObjectType: "task",
      communicationObjectId: existing.id,
      title: `Task overdue: ${existing.task_number}`,
      summary: `${nextTitle} is overdue and tied to active job work.`,
      messageText: `Overdue task: ${existing.task_number} needs attention in the linked job workflow.`,
      recipientUserIds: [...new Set([existing.created_by_user_id, nextAssignedToUserId, existing.assigned_to_user_id].filter((value): value is string => Boolean(value) && value !== auth.id))],
      appDeepLink: `#tasks/${encodeURIComponent(existing.id)}`,
      metadata: {
        job_id: existing.job_id,
        related_job_id: existing.related_job_id,
        due_at: nextDueAt,
        task_status: nextStatus
      }
    });
  }

  if (nextStatus === "completed" || nextStatus === "cancelled") {
    await queueTeamsMeetingTaskRecordLifecycleSync(client, auth, taskId, "cancel");
  } else if (meetingRelevantChange) {
    await queueTeamsMeetingTaskRecordLifecycleSync(client, auth, taskId, "update");
  }

  return getWorkTaskDetail(client, auth, taskId);
}

export async function getWorkTaskDetail(client: PoolClient, auth: AuthUser, taskId: string): Promise<WorkTaskDetailResponse> {
  const task = await loadTaskRow(client, auth.tenantId, taskId);
  if (!task) {
    throw new ApiError(404, "Task not found");
  }
  requireTaskReadAccess(auth, task.department_type, task);

  const assignments = await listTaskAssignments(client, auth.tenantId, task.id);
  const relatedEvent = task.event_id ? await loadRelatedEvent(client, auth.tenantId, task.event_id) : null;
  const relatedWorkflowRun = task.workflow_run_id
    ? await loadRelatedWorkflowRun(client, auth.tenantId, task.workflow_run_id)
    : null;
  const sharedWorkflowRuntime =
    task.job_id && task.workflow_run_id
      ? await getSharedWorkflowTaskRuntime(client, auth.tenantId, task.job_id, task.workflow_run_id, task.id)
      : null;
  const policy = await buildSharedResourcePolicySnapshot(client, auth, "shared_task", buildTaskPolicyContext(task), {
    read: "task.read",
    update: "task.update",
    assign: "task.assign"
  });

  return {
    task,
    linkage: {
      job_id: task.job_id,
      event_id: task.event_id,
      workflow_run_id: task.workflow_run_id
    },
    related_job: task.job_id
      ? {
          id: task.job_id,
          job_number: task.related_job_number,
          title: task.related_job_title ?? "Linked job",
          department_type: task.related_job_department ?? "other",
          job_status: task.related_job_status ?? "draft"
        }
      : null,
    related_event: relatedEvent,
    related_workflow_run: relatedWorkflowRun,
    shared_workflow_runtime: sharedWorkflowRuntime,
    assignments,
    work_model: WORK_MODEL_SUMMARY,
    policy
  };
}
