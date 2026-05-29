import type { PoolClient } from "pg";
import type { JobRecord, JobDraftInput } from "../../types/jobTruth.js";
import type { AuthUser } from "../../types/auth.js";
import type { JobPriorityLevel, WorkDepartmentType, WorkTaskStatus } from "../../domain/jobTruth/index.js";
import type { WorkTaskRecord } from "../../types/workModel.js";
import type {
  SharedWorkflowAcknowledgementRecord,
  SharedWorkflowApprovalCheckpointRecord,
  SharedWorkflowFamily,
  SharedWorkflowJobDetail,
  SharedWorkflowPilotRuntimeSummary,
  SharedWorkflowRunEventSummary,
  SharedWorkflowRunSummary,
  SharedWorkflowRunTaskSummary,
  SharedWorkflowRunStatus,
  SharedWorkflowTaskDependencyRecord,
  SharedWorkflowTaskRuntimeDetail,
  SharedWorkflowTemplateSummary,
  SharedWorkflowTemplateVersionSummary
} from "../../types/sharedWorkflow.js";
import type { OperationalApprovalRequestType } from "../../types/operationalApprovals.js";
import { ApiError } from "../../errors/apiError.js";
import { ensureOperationalApprovalRequest } from "../operationalApprovals.js";
import { writeJobActivity } from "../jobTruth/activityLogService.js";
import { nextWorkTaskNumber } from "../jobTruth/workTaskNumbering.js";

const WORKFLOW_DEPENDENCY_BLOCKED_REASON = "Waiting on dependent workflow tasks.";

type WorkflowTemplateVersionRow = {
  template_id: string;
  template_key: string;
  template_name: string;
  template_description: string | null;
  workflow_family: SharedWorkflowFamily;
  template_version_id: string;
  version_number: number;
  version_status: "draft" | "active" | "retired";
  default_for_new_jobs: boolean;
};

type WorkflowTemplateEventRow = {
  event_key: string;
  title: string;
  event_type: string;
  start_anchor: string;
  start_offset_days: number;
  start_offset_minutes: number;
  duration_minutes: number;
  required: boolean;
  sort_order: number;
};

type WorkflowTemplateTaskRow = {
  task_key: string;
  title: string;
  description: string | null;
  task_type: string;
  department_type: WorkDepartmentType;
  event_key: string | null;
  owner_default_type: string;
  owner_default_value: string | null;
  status: WorkTaskStatus;
  priority: JobPriorityLevel;
  due_anchor: string;
  due_offset_days: number;
  due_offset_minutes: number;
  required: boolean;
  sort_order: number;
};

type WorkflowTemplateTaskDependencyRow = {
  task_key: string;
  depends_on_task_key: string;
};

type WorkflowTemplateAcknowledgementRuleRow = {
  rule_key: string;
  target_type: string;
  target_key: string;
  require_on_assignment: boolean;
  require_on_claim: boolean;
  summary: string | null;
  sort_order: number;
};

type WorkflowTemplateApprovalCheckpointRow = {
  checkpoint_key: string;
  title: string;
  target_type: string;
  target_key: string | null;
  activate_when: string;
  request_type: string;
  requested_action_code: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  blocking: boolean;
  sort_order: number;
};

type WorkflowRunRow = {
  id: string;
  job_id: string;
  template_id: string;
  template_version_id: string;
  template_key: string;
  workflow_family: SharedWorkflowFamily;
  status: SharedWorkflowRunStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type WorkflowRunEventRow = SharedWorkflowRunEventSummary;

type WorkflowRunTaskRow = {
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
};

type WorkflowRunTaskDependencyRow = {
  work_task_id: string;
  depends_on_work_task_id: string;
  depends_on_task_key: string;
  depends_on_title: string;
  depends_on_status: WorkTaskStatus;
};

type WorkflowDayRow = {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  day_label: string | null;
};

type WorkflowTemplateBundle = {
  template: SharedWorkflowTemplateSummary;
  version: SharedWorkflowTemplateVersionSummary;
  events: WorkflowTemplateEventRow[];
  tasks: WorkflowTemplateTaskRow[];
  dependencies: WorkflowTemplateTaskDependencyRow[];
  acknowledgementRules: WorkflowTemplateAcknowledgementRuleRow[];
  approvalCheckpoints: WorkflowTemplateApprovalCheckpointRow[];
};

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function addOffset(base: Date, offsetDays: number, offsetMinutes: number) {
  return new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000 + offsetMinutes * 60 * 1000);
}

function formatPartsInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(value);

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour")}:${read("minute")}:${read("second")}`
  };
}

function resolveWorkflowTemplateKey(job: JobRecord, input: JobDraftInput) {
  const explicitVersionId = input.workflow_template_version_id ?? null;
  const explicitTemplateKey = normalizeNullableText(input.workflow_template_key);
  if (explicitVersionId || explicitTemplateKey) {
    return { explicitVersionId, explicitTemplateKey };
  }

  if (job.department_type === "schools") {
    return { explicitVersionId: null, explicitTemplateKey: "schools_phase_one_core" };
  }
  if (job.department_type === "sports") {
    return { explicitVersionId: null, explicitTemplateKey: "sports_phase_one_core" };
  }
  if (job.production_required) {
    return { explicitVersionId: null, explicitTemplateKey: "graphics_handoff_phase_one_core" };
  }
  return { explicitVersionId: null, explicitTemplateKey: null };
}

async function loadWorkflowTemplateVersion(
  client: PoolClient,
  tenantId: string,
  input: JobDraftInput,
  job: JobRecord
): Promise<WorkflowTemplateVersionRow | null> {
  const { explicitVersionId, explicitTemplateKey } = resolveWorkflowTemplateKey(job, input);
  if (!explicitVersionId && !explicitTemplateKey) {
    return null;
  }

  const { rows } = await client.query<WorkflowTemplateVersionRow>(
    `
      SELECT
        template.id::text AS template_id,
        template.template_key,
        template.name AS template_name,
        template.description AS template_description,
        template.workflow_family::text AS workflow_family,
        version_row.id::text AS template_version_id,
        version_row.version_number,
        version_row.status::text AS version_status,
        version_row.default_for_new_jobs
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
      WHERE template.tenant_id = $1
        AND (
          ($2::uuid IS NOT NULL AND version_row.id = $2::uuid)
          OR ($2::uuid IS NULL AND template.template_key = $3)
        )
        AND version_row.status = 'active'::shared_workflow_template_version_status_type
      ORDER BY version_row.version_number DESC
      LIMIT 1
    `,
    [tenantId, explicitVersionId, explicitTemplateKey]
  );

  return rows[0] ?? null;
}

async function loadWorkflowTemplateVersionById(client: PoolClient, tenantId: string, versionId: string): Promise<WorkflowTemplateVersionRow | null> {
  const { rows } = await client.query<WorkflowTemplateVersionRow>(
    `
      SELECT
        template.id::text AS template_id,
        template.template_key,
        template.name AS template_name,
        template.description AS template_description,
        template.workflow_family::text AS workflow_family,
        version_row.id::text AS template_version_id,
        version_row.version_number,
        version_row.status::text AS version_status,
        version_row.default_for_new_jobs
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
      WHERE template.tenant_id = $1
        AND version_row.id = $2
      LIMIT 1
    `,
    [tenantId, versionId]
  );
  return rows[0] ?? null;
}

async function loadWorkflowTemplateBundle(client: PoolClient, tenantId: string, versionRow: WorkflowTemplateVersionRow): Promise<WorkflowTemplateBundle> {
  const eventsResult = await client.query<WorkflowTemplateEventRow>(
    `
      SELECT
        event_key,
        title,
        event_type,
        start_anchor::text,
        start_offset_days,
        start_offset_minutes,
        duration_minutes,
        required,
        sort_order
      FROM workflow_template_event
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, versionRow.template_version_id]
  );
  const tasksResult = await client.query<WorkflowTemplateTaskRow>(
    `
      SELECT
        task_key,
        title,
        description,
        task_type,
        department_type::text AS department_type,
        event_key,
        owner_default_type,
        owner_default_value,
        status::text,
        priority::text,
        due_anchor::text,
        due_offset_days,
        due_offset_minutes,
        required,
        sort_order
      FROM workflow_template_task
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, versionRow.template_version_id]
  );
  const dependenciesResult = await client.query<WorkflowTemplateTaskDependencyRow>(
    `
      SELECT task_key, depends_on_task_key
      FROM workflow_template_task_dependency
      WHERE tenant_id = $1
        AND template_version_id = $2
    `,
    [tenantId, versionRow.template_version_id]
  );
  const acknowledgementResult = await client.query<WorkflowTemplateAcknowledgementRuleRow>(
    `
      SELECT
        rule_key,
        target_type,
        target_key,
        require_on_assignment,
        require_on_claim,
        summary,
        sort_order
      FROM workflow_template_acknowledgement_rule
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, versionRow.template_version_id]
  );
  const checkpointResult = await client.query<WorkflowTemplateApprovalCheckpointRow>(
    `
      SELECT
        checkpoint_key,
        title,
        target_type,
        target_key,
        activate_when,
        request_type,
        requested_action_code,
        request_summary,
        reason,
        severity,
        blocking,
        sort_order
      FROM workflow_template_approval_checkpoint
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, versionRow.template_version_id]
  );

  return {
    template: {
      id: versionRow.template_id,
      template_key: versionRow.template_key,
      name: versionRow.template_name,
      description: versionRow.template_description,
      workflow_family: versionRow.workflow_family
    },
    version: {
      id: versionRow.template_version_id,
      template_id: versionRow.template_id,
      version_number: versionRow.version_number,
      status: versionRow.version_status,
      default_for_new_jobs: versionRow.default_for_new_jobs
    },
    events: eventsResult.rows,
    tasks: tasksResult.rows,
    dependencies: dependenciesResult.rows,
    acknowledgementRules: acknowledgementResult.rows,
    approvalCheckpoints: checkpointResult.rows
  };
}

async function loadExistingWorkflowRun(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<WorkflowRunRow>(
    `
      SELECT
        id::text,
        job_id::text,
        template_id::text,
        template_version_id::text,
        template_key,
        workflow_family::text AS workflow_family,
        status::text,
        started_at::text,
        completed_at::text,
        created_at::text,
        updated_at::text
      FROM workflow_run
      WHERE tenant_id = $1
        AND job_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, jobId]
  );
  return rows[0] ?? null;
}

async function upsertWorkflowRun(client: PoolClient, auth: AuthUser, job: JobRecord, bundle: WorkflowTemplateBundle) {
  const existing = await loadExistingWorkflowRun(client, auth.tenantId, job.id);
  if (existing) {
    if (existing.template_key !== bundle.template.template_key || existing.template_version_id !== bundle.version.id) {
      throw new ApiError(409, "This job already has a shared workflow run attached.");
    }
    return existing;
  }

  const { rows } = await client.query<WorkflowRunRow>(
    `
      INSERT INTO workflow_run (
        tenant_id,
        job_id,
        template_id,
        template_version_id,
        template_key,
        workflow_family,
        status,
        created_by_user_id,
        updated_by_user_id,
        started_at
      )
      VALUES ($1,$2,$3,$4,$5,$6::shared_workflow_family_type,'active'::shared_workflow_run_status_type,$7,$7,now())
      RETURNING
        id::text,
        job_id::text,
        template_id::text,
        template_version_id::text,
        template_key,
        workflow_family::text AS workflow_family,
        status::text,
        started_at::text,
        completed_at::text,
        created_at::text,
        updated_at::text
    `,
    [auth.tenantId, job.id, bundle.template.id, bundle.version.id, bundle.template.template_key, bundle.template.workflow_family, auth.id]
  );

  const run = rows[0];
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: job.id,
    eventType: "shared_workflow_run_created",
    summary: `Attached shared workflow ${bundle.template.name}`,
    resourceType: "workflow_run",
    resourceId: run.id,
    parentResourceType: "job",
    parentResourceId: job.id,
    newValues: {
      workflow_run_id: run.id,
      template_key: bundle.template.template_key,
      workflow_family: bundle.template.workflow_family,
      version_number: bundle.version.version_number
    },
    sourceSurface: "shared_workflow_engine"
  });
  return run;
}

async function listJobDays(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<WorkflowDayRow>(
    `
      SELECT
        id::text,
        date::text,
        start_time::text,
        end_time::text,
        timezone,
        day_label
      FROM job_days
      WHERE tenant_id = $1
        AND job_id = $2
      ORDER BY date ASC, start_time ASC NULLS LAST, created_at ASC
    `,
    [tenantId, jobId]
  );
  return rows;
}

function resolveAnchorTimestamp(
  job: JobRecord,
  anchor: string,
  eventWindow?: { startAt: string | null; endAt: string | null } | null
) {
  const fallback =
    job.scheduled_start_at ??
    job.scheduled_end_at ??
    job.client_deadline_at ??
    job.production_deadline_at ??
    new Date().toISOString();

  switch (anchor) {
    case "job_scheduled_end":
      return new Date(job.scheduled_end_at ?? job.scheduled_start_at ?? fallback);
    case "job_client_deadline":
      return new Date(job.client_deadline_at ?? job.production_deadline_at ?? fallback);
    case "job_production_deadline":
      return new Date(job.production_deadline_at ?? job.client_deadline_at ?? fallback);
    case "event_start":
      return new Date(eventWindow?.startAt ?? job.scheduled_start_at ?? fallback);
    case "event_end":
      return new Date(eventWindow?.endAt ?? eventWindow?.startAt ?? job.scheduled_end_at ?? fallback);
    case "job_scheduled_start":
    default:
      return new Date(job.scheduled_start_at ?? fallback);
  }
}

async function createGeneratedJobDay(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  templateEvent: WorkflowTemplateEventRow
) {
  const anchor = resolveAnchorTimestamp(job, templateEvent.start_anchor, null);
  const startAt = addOffset(anchor, templateEvent.start_offset_days, templateEvent.start_offset_minutes);
  const endAt = addOffset(startAt, 0, templateEvent.duration_minutes);
  const timeZone = normalizeNullableText(job.timezone) ?? "America/Chicago";
  const startParts = formatPartsInTimeZone(startAt, timeZone);
  const endParts = formatPartsInTimeZone(endAt, timeZone);
  const compatibilityEndTime = startParts.date === endParts.date ? endParts.time : null;

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO job_days (
        tenant_id,
        job_id,
        day_label,
        date,
        start_time,
        end_time,
        timezone,
        location_id,
        onsite_contact_id,
        lead_user_id,
        day_status,
        weather_sensitive,
        indoor_outdoor,
        access_notes,
        parking_notes,
        setup_notes,
        travel_notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,'scheduled'::job_day_status_type,false,NULL,NULL,NULL,NULL,NULL)
      RETURNING id::text
    `,
    [auth.tenantId, job.id, templateEvent.title, startParts.date, startParts.time, compatibilityEndTime, timeZone, job.primary_location_id, job.primary_contact_id]
  );

  return {
    id: rows[0].id,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    title: templateEvent.title,
    eventType: templateEvent.event_type
  };
}

async function ensureWorkflowRunEvents(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  bundle: WorkflowTemplateBundle,
  run: WorkflowRunRow
) {
  if (!bundle.events.length) {
    return;
  }

  const existingResult = await client.query<{ event_key: string; job_day_id: string }>(
    `
      SELECT event_key, job_day_id::text
      FROM workflow_run_event
      WHERE tenant_id = $1
        AND workflow_run_id = $2
    `,
    [auth.tenantId, run.id]
  );
  const existingByKey = new Map(existingResult.rows.map((row) => [row.event_key, row.job_day_id]));
  const currentDays = await listJobDays(client, auth.tenantId, job.id);
  const linkedDayIds = new Set(existingResult.rows.map((row) => row.job_day_id));
  let attachIndex = 0;

  for (const templateEvent of bundle.events) {
    if (existingByKey.has(templateEvent.event_key)) {
      continue;
    }

    let linkedDay = currentDays.find((day, index) => index >= attachIndex && !linkedDayIds.has(day.id)) ?? null;
    if (linkedDay) {
      attachIndex = currentDays.findIndex((day) => day.id === linkedDay?.id) + 1;
    }

    let generatedDayId: string;
    let startAt: string | null = null;
    let endAt: string | null = null;
    if (linkedDay) {
      generatedDayId = linkedDay.id;
    } else {
      const created = await createGeneratedJobDay(client, auth, job, templateEvent);
      generatedDayId = created.id;
      startAt = created.startAt;
      endAt = created.endAt;
      linkedDayIds.add(created.id);
    }

    await client.query(
      `
        INSERT INTO workflow_run_event (
          tenant_id,
          workflow_run_id,
          event_key,
          job_day_id,
          event_title,
          event_type,
          start_at,
          end_at,
          sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (workflow_run_id, event_key)
        DO NOTHING
      `,
      [auth.tenantId, run.id, templateEvent.event_key, generatedDayId, templateEvent.title, templateEvent.event_type, startAt, endAt, templateEvent.sort_order]
    );
  }
}

async function listWorkflowRunEvents(client: PoolClient, tenantId: string, runId: string) {
  const { rows } = await client.query<WorkflowRunEventRow>(
    `
      SELECT
        id::text,
        workflow_run_id::text,
        event_key,
        event_title,
        event_type,
        job_day_id::text,
        start_at::text,
        end_at::text,
        sort_order
      FROM workflow_run_event
      WHERE tenant_id = $1
        AND workflow_run_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, runId]
  );
  return rows;
}

function resolveTaskOwner(job: JobRecord, auth: AuthUser, templateTask: WorkflowTemplateTaskRow) {
  switch (templateTask.owner_default_type) {
    case "account_owner":
      return { assignedToUserId: job.account_owner_user_id ?? job.created_by_user_id ?? auth.id, assignedTeamId: null };
    case "job_creator":
      return { assignedToUserId: job.created_by_user_id ?? auth.id, assignedTeamId: null };
    case "team":
      return { assignedToUserId: null, assignedTeamId: normalizeNullableText(templateTask.owner_default_value) };
    case "unassigned":
    default:
      return { assignedToUserId: null, assignedTeamId: null };
  }
}

function buildEventWindowMap(events: WorkflowRunEventRow[]) {
  return new Map(events.map((event) => [event.event_key, { startAt: event.start_at, endAt: event.end_at, jobDayId: event.job_day_id }]));
}

async function insertWorkflowGeneratedTask(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  run: WorkflowRunRow,
  templateTask: WorkflowTemplateTaskRow,
  eventWindow: { startAt: string | null; endAt: string | null; jobDayId: string } | null,
  hasDependencies: boolean
) {
  const owner = resolveTaskOwner(job, auth, templateTask);
  const dueAnchor = resolveAnchorTimestamp(job, templateTask.due_anchor, eventWindow ? { startAt: eventWindow.startAt, endAt: eventWindow.endAt } : null);
  const dueAt = addOffset(dueAnchor, templateTask.due_offset_days, templateTask.due_offset_minutes).toISOString();
  const taskNumber = await nextWorkTaskNumber(client, auth.tenantId, templateTask.department_type);

  const { rows } = await client.query<WorkTaskRecord>(
    `
      INSERT INTO work_task (
        tenant_id,
        task_number,
        title,
        description,
        task_type,
        department_type,
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
      VALUES (
        $1,$2,$3,$4,$5,$6::work_department_type,$7,$8,$9,$10,$11,$12,
        $13::work_task_status_type,$14::job_priority_level,$15,$16,false,NULL,$17,$17
      )
      RETURNING
        id::text,
        tenant_id::text,
        task_number,
        title,
        description,
        task_type,
        department_type::text AS department_type,
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
      templateTask.title,
      normalizeNullableText(templateTask.description),
      templateTask.task_type,
      templateTask.department_type,
      job.id,
      eventWindow?.jobDayId ?? null,
      run.id,
      templateTask.task_key,
      owner.assignedToUserId,
      owner.assignedTeamId,
      hasDependencies ? "blocked" : templateTask.status,
      templateTask.priority,
      dueAt,
      hasDependencies ? WORKFLOW_DEPENDENCY_BLOCKED_REASON : null,
      auth.id
    ]
  );

  const created = rows[0];
  if (created.assigned_to_user_id) {
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
        SET related_job_id = EXCLUDED.related_job_id,
            role_on_job = EXCLUDED.role_on_job,
            status = EXCLUDED.status,
            updated_at = now()
      `,
      [auth.tenantId, created.id, created.assigned_to_user_id, job.id, templateTask.task_type]
    );
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: job.id,
    eventType: "workflow_task_generated",
    summary: `Generated workflow task ${created.task_number}`,
    resourceType: "work_task",
    resourceId: created.id,
    parentResourceType: "job",
    parentResourceId: job.id,
    newValues: {
      workflow_run_id: run.id,
      task_key: templateTask.task_key,
      task_number: created.task_number,
      assigned_to_user_id: created.assigned_to_user_id,
      assigned_team_id: created.assigned_team_id,
      event_id: created.event_id
    },
    sourceSurface: "shared_workflow_engine"
  });

  return created;
}

async function listWorkflowRunTasks(client: PoolClient, tenantId: string, runId: string) {
  const { rows } = await client.query<WorkflowRunTaskRow>(
    `
      SELECT
        task.id::text AS task_id,
        task.task_number,
        task.workflow_template_task_key AS task_key,
        task.title,
        task.department_type::text AS department_type,
        task.job_day_id::text AS event_id,
        task.workflow_run_id::text AS workflow_run_id,
        task.assigned_to_user_id::text,
        task.assigned_team_id,
        task.status::text,
        task.priority::text,
        task.due_at::text,
        task.blocked_reason
      FROM work_task task
      WHERE task.tenant_id = $1
        AND task.workflow_run_id = $2
      ORDER BY task.created_at ASC, task.task_number ASC
    `,
    [tenantId, runId]
  );
  return rows;
}

async function ensureWorkflowRunTasks(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  bundle: WorkflowTemplateBundle,
  run: WorkflowRunRow
) {
  if (!bundle.tasks.length) {
    return;
  }

  const existingTasks = await listWorkflowRunTasks(client, auth.tenantId, run.id);
  const existingByKey = new Map(existingTasks.map((task) => [task.task_key, task]));
  const events = await listWorkflowRunEvents(client, auth.tenantId, run.id);
  const eventMap = buildEventWindowMap(events);
  const dependencyMap = new Map<string, string[]>();
  for (const dependency of bundle.dependencies) {
    dependencyMap.set(dependency.task_key, [...(dependencyMap.get(dependency.task_key) ?? []), dependency.depends_on_task_key]);
  }

  for (const templateTask of bundle.tasks) {
    if (existingByKey.has(templateTask.task_key)) {
      continue;
    }
    const eventWindow = templateTask.event_key ? eventMap.get(templateTask.event_key) ?? null : null;
    const created = await insertWorkflowGeneratedTask(
      client,
      auth,
      job,
      run,
      templateTask,
      eventWindow,
      (dependencyMap.get(templateTask.task_key)?.length ?? 0) > 0
    );
    existingByKey.set(templateTask.task_key, {
      task_id: created.id,
      task_number: created.task_number,
      task_key: templateTask.task_key,
      title: created.title,
      department_type: created.department_type,
      event_id: created.event_id,
      workflow_run_id: created.workflow_run_id ?? run.id,
      assigned_to_user_id: created.assigned_to_user_id,
      assigned_team_id: created.assigned_team_id,
      status: created.status,
      priority: created.priority,
      due_at: typeof created.due_at === "string" ? created.due_at : null,
      blocked_reason: created.blocked_reason
    });
  }

  for (const dependency of bundle.dependencies) {
    const task = existingByKey.get(dependency.task_key);
    const dependsOn = existingByKey.get(dependency.depends_on_task_key);
    if (!task || !dependsOn) {
      continue;
    }
    await client.query(
      `
        INSERT INTO workflow_run_task_dependency (
          tenant_id,
          workflow_run_id,
          work_task_id,
          depends_on_work_task_id
        )
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (workflow_run_id, work_task_id, depends_on_work_task_id) DO NOTHING
      `,
      [auth.tenantId, run.id, task.task_id, dependsOn.task_id]
    );
  }
}

async function ensureWorkflowAcknowledgements(
  client: PoolClient,
  auth: AuthUser,
  bundle: WorkflowTemplateBundle,
  run: WorkflowRunRow
) {
  if (!bundle.acknowledgementRules.length) {
    return;
  }
  const tasks = await listWorkflowRunTasks(client, auth.tenantId, run.id);
  const taskByKey = new Map(tasks.map((task) => [task.task_key, task]));
  for (const rule of bundle.acknowledgementRules) {
    const task = taskByKey.get(rule.target_key);
    if (!task) {
      continue;
    }
    const requestedUserId = rule.require_on_assignment ? task.assigned_to_user_id : null;
    await client.query(
      `
        INSERT INTO workflow_run_acknowledgement (
          tenant_id,
          workflow_run_id,
          rule_key,
          work_task_id,
          requested_user_id,
          status,
          summary
        )
        VALUES ($1,$2,$3,$4,$5,'pending'::shared_workflow_ack_status_type,$6)
        ON CONFLICT (workflow_run_id, rule_key, work_task_id)
        DO UPDATE
        SET requested_user_id = COALESCE(workflow_run_acknowledgement.requested_user_id, EXCLUDED.requested_user_id),
            summary = COALESCE(workflow_run_acknowledgement.summary, EXCLUDED.summary),
            updated_at = now()
      `,
      [auth.tenantId, run.id, rule.rule_key, task.task_id, requestedUserId, rule.summary]
    );
  }
}

function mapApprovalRequestStatus(status: string | null) {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "canceled":
      return "canceled";
    default:
      return "pending";
  }
}

async function activateApprovalCheckpoint(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  checkpointId: string
) {
  const { rows } = await client.query<{
    id: string;
    workflow_run_id: string;
    checkpoint_key: string;
    title: string;
    request_type: string;
    requested_action_code: string;
    request_summary: string | null;
    reason: string;
    severity: string;
    blocking: boolean;
    operational_approval_request_id: string | null;
  }>(
    `
      SELECT
        id::text,
        workflow_run_id::text,
        checkpoint_key,
        title,
        request_type,
        requested_action_code,
        request_summary,
        reason,
        severity,
        blocking,
        operational_approval_request_id::text
      FROM workflow_run_approval_checkpoint
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, checkpointId]
  );
  const checkpoint = rows[0];
  if (!checkpoint) {
    return;
  }

  const approvalRequest = checkpoint.operational_approval_request_id
    ? null
    : await ensureOperationalApprovalRequest(client, auth, {
        requestType: checkpoint.request_type as OperationalApprovalRequestType,
        sourceModule: "shared_workflow",
        sourceEntityType: "job",
        sourceEntityId: job.id,
        sourceEntityLabel: job.job_number ?? job.title,
        requesterDepartment: auth.department,
        requestedActionCode: checkpoint.requested_action_code,
        requestTitle: checkpoint.title,
        requestSummary: checkpoint.request_summary,
        reason: checkpoint.reason,
        blocking: checkpoint.blocking,
        severity: checkpoint.severity,
        dedupeKey: `workflow:${checkpoint.workflow_run_id}:checkpoint:${checkpoint.checkpoint_key}`,
        currentState: {
          workflow_run_id: checkpoint.workflow_run_id,
          job_status: job.job_status
        },
        requestedState: {
          checkpoint_key: checkpoint.checkpoint_key,
          requested_action_code: checkpoint.requested_action_code
        },
        metadata: {
          workflow_run_id: checkpoint.workflow_run_id,
          checkpoint_key: checkpoint.checkpoint_key
        }
      });

  const approvalRequestId = checkpoint.operational_approval_request_id ?? approvalRequest?.id ?? null;
  const approvalStatus = approvalRequest?.status ?? "pending";

  await client.query(
    `
      UPDATE workflow_run_approval_checkpoint
      SET
        operational_approval_request_id = COALESCE(operational_approval_request_id, $3),
        status = $4::shared_workflow_approval_checkpoint_status_type,
        activated_at = COALESCE(activated_at, now()),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, checkpointId, approvalRequestId, mapApprovalRequestStatus(approvalStatus)]
  );
}

async function ensureWorkflowApprovalCheckpoints(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  bundle: WorkflowTemplateBundle,
  run: WorkflowRunRow
) {
  const tasks = await listWorkflowRunTasks(client, auth.tenantId, run.id);
  const taskByKey = new Map(tasks.map((task) => [task.task_key, task]));

  for (const checkpoint of bundle.approvalCheckpoints) {
    const task = checkpoint.target_type === "task" && checkpoint.target_key ? taskByKey.get(checkpoint.target_key) ?? null : null;
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO workflow_run_approval_checkpoint (
          tenant_id,
          workflow_run_id,
          checkpoint_key,
          work_task_id,
          title,
          request_type,
          requested_action_code,
          request_summary,
          reason,
          severity,
          blocking,
          status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12::shared_workflow_approval_checkpoint_status_type
        )
        ON CONFLICT (workflow_run_id, checkpoint_key)
        DO UPDATE
        SET work_task_id = COALESCE(workflow_run_approval_checkpoint.work_task_id, EXCLUDED.work_task_id),
            updated_at = now()
        RETURNING id::text
      `,
      [
        auth.tenantId,
        run.id,
        checkpoint.checkpoint_key,
        task?.task_id ?? null,
        checkpoint.title,
        checkpoint.request_type,
        checkpoint.requested_action_code,
        checkpoint.request_summary,
        checkpoint.reason,
        checkpoint.severity,
        checkpoint.blocking,
        checkpoint.activate_when === "on_run_start" ? "pending" : "queued"
      ]
    );

    if (checkpoint.activate_when === "on_run_start") {
      await activateApprovalCheckpoint(client, auth, job, rows[0].id);
    }
  }
}

export async function ensureSharedWorkflowRunForJob(
  client: PoolClient,
  auth: AuthUser,
  job: JobRecord,
  input: JobDraftInput
) {
  const version = await loadWorkflowTemplateVersion(client, auth.tenantId, input, job);
  if (!version) {
    return null;
  }
  const bundle = await loadWorkflowTemplateBundle(client, auth.tenantId, version);
  const run = await upsertWorkflowRun(client, auth, job, bundle);
  await ensureWorkflowRunEvents(client, auth, job, bundle, run);
  await ensureWorkflowRunTasks(client, auth, job, bundle, run);
  await ensureWorkflowAcknowledgements(client, auth, bundle, run);
  await ensureWorkflowApprovalCheckpoints(client, auth, job, bundle, run);
  return run.id;
}

async function listWorkflowRunAcknowledgements(client: PoolClient, tenantId: string, runId: string) {
  const { rows } = await client.query<SharedWorkflowAcknowledgementRecord>(
    `
      SELECT
        ack.id::text,
        ack.workflow_run_id::text,
        ack.rule_key,
        coalesce(rule.target_type, 'task')::text AS target_type,
        rule.target_key,
        ack.work_task_id::text,
        ack.requested_user_id::text,
        ack.acknowledged_by_user_id::text,
        ack.status::text,
        ack.summary,
        coalesce(rule.require_on_assignment, false) AS require_on_assignment,
        coalesce(rule.require_on_claim, false) AS require_on_claim,
        ack.requested_at::text,
        ack.acknowledged_at::text
      FROM workflow_run_acknowledgement ack
      JOIN workflow_run run
        ON run.tenant_id = ack.tenant_id
       AND run.id = ack.workflow_run_id
      LEFT JOIN workflow_template_acknowledgement_rule rule
        ON rule.tenant_id = ack.tenant_id
       AND rule.template_version_id = run.template_version_id
       AND rule.rule_key = ack.rule_key
      WHERE ack.tenant_id = $1
        AND ack.workflow_run_id = $2
      ORDER BY ack.created_at ASC
    `,
    [tenantId, runId]
  );
  return rows;
}

async function listWorkflowRunApprovalCheckpoints(client: PoolClient, tenantId: string, runId: string) {
  const { rows } = await client.query<SharedWorkflowApprovalCheckpointRecord>(
    `
      SELECT
        checkpoint.id::text,
        checkpoint.workflow_run_id::text,
        checkpoint.checkpoint_key,
        coalesce(template_checkpoint.target_type, 'job')::text AS target_type,
        template_checkpoint.target_key,
        coalesce(template_checkpoint.activate_when, 'on_run_start')::text AS activate_when,
        checkpoint.work_task_id::text,
        checkpoint.operational_approval_request_id::text,
        checkpoint.title,
        checkpoint.request_type,
        checkpoint.requested_action_code,
        checkpoint.request_summary,
        checkpoint.reason,
        checkpoint.severity,
        checkpoint.blocking,
        checkpoint.status::text,
        approval_request.status::text AS approval_request_status,
        checkpoint.activated_at::text,
        checkpoint.resolved_at::text
      FROM workflow_run_approval_checkpoint checkpoint
      JOIN workflow_run run
        ON run.tenant_id = checkpoint.tenant_id
       AND run.id = checkpoint.workflow_run_id
      LEFT JOIN workflow_template_approval_checkpoint template_checkpoint
        ON template_checkpoint.tenant_id = checkpoint.tenant_id
       AND template_checkpoint.template_version_id = run.template_version_id
       AND template_checkpoint.checkpoint_key = checkpoint.checkpoint_key
      LEFT JOIN operational_approval_request approval_request
        ON approval_request.tenant_id = checkpoint.tenant_id
       AND approval_request.id = checkpoint.operational_approval_request_id
      WHERE checkpoint.tenant_id = $1
        AND checkpoint.workflow_run_id = $2
      ORDER BY checkpoint.created_at ASC
    `,
    [tenantId, runId]
  );
  return rows.map((row) => ({
    ...row,
    status: row.approval_request_status ? mapApprovalRequestStatus(row.approval_request_status) : row.status
  }));
}

async function listWorkflowRunTaskDependencies(client: PoolClient, tenantId: string, runId: string) {
  const { rows } = await client.query<WorkflowRunTaskDependencyRow>(
    `
      SELECT
        dependency.work_task_id::text,
        dependency.depends_on_work_task_id::text,
        depends_on_task.workflow_template_task_key AS depends_on_task_key,
        depends_on_task.title AS depends_on_title,
        depends_on_task.status::text AS depends_on_status
      FROM workflow_run_task_dependency dependency
      JOIN work_task depends_on_task
        ON depends_on_task.tenant_id = dependency.tenant_id
       AND depends_on_task.id = dependency.depends_on_work_task_id
      WHERE dependency.tenant_id = $1
        AND dependency.workflow_run_id = $2
      ORDER BY dependency.created_at ASC
    `,
    [tenantId, runId]
  );
  return rows;
}

function buildSharedWorkflowPilotRuntimeSummary(
  template: SharedWorkflowTemplateSummary,
  version: SharedWorkflowTemplateVersionSummary
): SharedWorkflowPilotRuntimeSummary {
  return {
    workflow_family: template.workflow_family,
    template_key: template.template_key,
    template_name: template.name,
    version_number: version.version_number,
    version_status: version.status,
    version_label: `v${version.version_number}`
  };
}

function buildSharedWorkflowRunSummary(
  run: WorkflowRunRow,
  events: SharedWorkflowRunEventSummary[],
  tasks: WorkflowRunTaskRow[],
  acknowledgements: SharedWorkflowAcknowledgementRecord[],
  checkpoints: SharedWorkflowApprovalCheckpointRecord[]
): SharedWorkflowRunSummary {
  return {
    id: run.id,
    job_id: run.job_id,
    template_id: run.template_id,
    template_version_id: run.template_version_id,
    template_key: run.template_key,
    workflow_family: run.workflow_family,
    status: run.status,
    generated_event_count: events.length,
    generated_task_count: tasks.length,
    pending_acknowledgement_count: acknowledgements.filter((item) => item.status === "pending").length,
    pending_approval_count: checkpoints.filter((item) => item.status === "pending").length,
    started_at: run.started_at,
    completed_at: run.completed_at,
    created_at: run.created_at,
    updated_at: run.updated_at
  };
}

function buildSharedWorkflowTaskSummaries(
  tasks: WorkflowRunTaskRow[],
  dependencies: WorkflowRunTaskDependencyRow[],
  acknowledgements: SharedWorkflowAcknowledgementRecord[],
  checkpoints: SharedWorkflowApprovalCheckpointRecord[]
): SharedWorkflowRunTaskSummary[] {
  const dependencyMap = new Map<string, SharedWorkflowTaskDependencyRecord[]>();
  for (const dependency of dependencies) {
    const dependencyRecord: SharedWorkflowTaskDependencyRecord = {
      work_task_id: dependency.work_task_id,
      depends_on_work_task_id: dependency.depends_on_work_task_id,
      depends_on_task_key: dependency.depends_on_task_key,
      depends_on_title: dependency.depends_on_title,
      depends_on_status: dependency.depends_on_status,
      satisfied: dependency.depends_on_status === "completed",
      blocking: dependency.depends_on_status !== "completed"
    };
    dependencyMap.set(dependency.work_task_id, [...(dependencyMap.get(dependency.work_task_id) ?? []), dependencyRecord]);
  }

  const acknowledgementByTaskId = new Map(
    acknowledgements
      .filter((item): item is SharedWorkflowAcknowledgementRecord & { work_task_id: string } => Boolean(item.work_task_id))
      .map((item) => [item.work_task_id, item])
  );

  const checkpointsByTaskId = new Map<string, SharedWorkflowApprovalCheckpointRecord[]>();
  for (const checkpoint of checkpoints) {
    if (!checkpoint.work_task_id) {
      continue;
    }
    checkpointsByTaskId.set(checkpoint.work_task_id, [...(checkpointsByTaskId.get(checkpoint.work_task_id) ?? []), checkpoint]);
  }

  return tasks.map((task) => {
    const taskDependencies = dependencyMap.get(task.task_id) ?? [];
    const acknowledgement = acknowledgementByTaskId.get(task.task_id) ?? null;
    const taskCheckpoints = checkpointsByTaskId.get(task.task_id) ?? [];
    return {
      ...task,
      dependency_task_ids: taskDependencies.map((dependency) => dependency.depends_on_work_task_id),
      dependencies: taskDependencies,
      dependency_blocked: taskDependencies.some((dependency) => dependency.blocking),
      requires_acknowledgement: Boolean(acknowledgement),
      acknowledgement_id: acknowledgement?.id ?? null,
      acknowledgement,
      approval_checkpoint_ids: taskCheckpoints.map((checkpoint) => checkpoint.id),
      approval_checkpoints: taskCheckpoints
    };
  });
}

async function loadSharedWorkflowRunReadModel(
  client: PoolClient,
  tenantId: string,
  run: WorkflowRunRow,
  bundle: WorkflowTemplateBundle
) {
  const events = await listWorkflowRunEvents(client, tenantId, run.id);
  const tasks = await listWorkflowRunTasks(client, tenantId, run.id);
  const dependencies = await listWorkflowRunTaskDependencies(client, tenantId, run.id);
  const acknowledgements = await listWorkflowRunAcknowledgements(client, tenantId, run.id);
  const checkpoints = await listWorkflowRunApprovalCheckpoints(client, tenantId, run.id);

  return {
    pilotRuntime: buildSharedWorkflowPilotRuntimeSummary(bundle.template, bundle.version),
    runSummary: buildSharedWorkflowRunSummary(run, events, tasks, acknowledgements, checkpoints),
    events,
    tasks: buildSharedWorkflowTaskSummaries(tasks, dependencies, acknowledgements, checkpoints),
    acknowledgements,
    checkpoints
  };
}

export async function getSharedWorkflowJobDetail(
  client: PoolClient,
  tenantId: string,
  jobId: string
): Promise<SharedWorkflowJobDetail | null> {
  const run = await loadExistingWorkflowRun(client, tenantId, jobId);
  if (!run) {
    return null;
  }

  const versionRow = await loadWorkflowTemplateVersionById(client, tenantId, run.template_version_id);
  if (!versionRow) {
    return null;
  }
  const bundle = await loadWorkflowTemplateBundle(client, tenantId, versionRow);
  const readModel = await loadSharedWorkflowRunReadModel(client, tenantId, run, bundle);

  return {
    pilot_runtime: readModel.pilotRuntime,
    template: {
      ...bundle.template,
      name: bundle.template.name || run.template_key,
      description: bundle.template.description
    },
    version: bundle.version,
    run: readModel.runSummary,
    events: readModel.events,
    tasks: readModel.tasks,
    acknowledgements: readModel.acknowledgements,
    approval_checkpoints: readModel.checkpoints
  };
}

export async function getSharedWorkflowTaskRuntime(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  workflowRunId: string,
  taskId: string
): Promise<SharedWorkflowTaskRuntimeDetail | null> {
  const run = await loadExistingWorkflowRun(client, tenantId, jobId);
  if (!run || run.id !== workflowRunId) {
    return null;
  }

  const versionRow = await loadWorkflowTemplateVersionById(client, tenantId, run.template_version_id);
  if (!versionRow) {
    return null;
  }

  const bundle = await loadWorkflowTemplateBundle(client, tenantId, versionRow);
  const readModel = await loadSharedWorkflowRunReadModel(client, tenantId, run, bundle);
  const task = readModel.tasks.find((item) => item.task_id === taskId) ?? null;
  if (!task) {
    return null;
  }

  return {
    pilot_runtime: readModel.pilotRuntime,
    run: readModel.runSummary,
    task
  };
}

async function resolveWorkflowJobForTask(client: PoolClient, tenantId: string, task: Pick<WorkTaskRecord, "job_id" | "workflow_run_id">) {
  if (!task.job_id || !task.workflow_run_id) {
    return null;
  }
  const { rows } = await client.query<JobRecord>(
    `
      SELECT *
      FROM jobs
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, task.job_id]
  );
  return rows[0] ?? null;
}

async function acknowledgeClaimedWorkflowTask(
  client: PoolClient,
  auth: AuthUser,
  task: WorkTaskRecord,
  nextAssignedToUserId: string | null
) {
  if (!task.workflow_run_id) {
    return;
  }
  const claimedByActor =
    Boolean(task.assigned_team_id) &&
    !task.assigned_to_user_id &&
    Boolean(nextAssignedToUserId) &&
    nextAssignedToUserId === auth.id;
  if (!claimedByActor) {
    return;
  }

  await client.query(
    `
      UPDATE workflow_run_acknowledgement
      SET
        requested_user_id = COALESCE(requested_user_id, $3),
        acknowledged_by_user_id = $3,
        status = 'acknowledged'::shared_workflow_ack_status_type,
        acknowledged_at = COALESCE(acknowledged_at, now()),
        updated_at = now()
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND work_task_id = $4
        AND status = 'pending'::shared_workflow_ack_status_type
    `,
    [auth.tenantId, task.workflow_run_id, auth.id, task.id]
  );

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: task.job_id,
    eventType: "workflow_task_claimed",
    summary: `Claimed workflow task ${task.task_number}`,
    resourceType: "work_task",
    resourceId: task.id,
    parentResourceType: task.job_id ? "job" : null,
    parentResourceId: task.job_id,
    newValues: {
      assigned_to_user_id: auth.id,
      workflow_run_id: task.workflow_run_id
    },
    sourceSurface: "shared_workflow_engine"
  });
}

async function releaseWorkflowDependentTasks(
  client: PoolClient,
  auth: AuthUser,
  task: WorkTaskRecord
) {
  if (!task.workflow_run_id) {
    return;
  }
  const { rows } = await client.query<{ work_task_id: string }>(
    `
      SELECT work_task_id::text
      FROM workflow_run_task_dependency
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND depends_on_work_task_id = $3
    `,
    [auth.tenantId, task.workflow_run_id, task.id]
  );

  for (const row of rows) {
    const readyResult = await client.query<{ ready: boolean }>(
      `
        SELECT coalesce(bool_and(dependency_task.status = 'completed'::work_task_status_type), false) AS ready
        FROM workflow_run_task_dependency dependency
        JOIN work_task dependency_task
          ON dependency_task.tenant_id = dependency.tenant_id
         AND dependency_task.id = dependency.depends_on_work_task_id
        WHERE dependency.tenant_id = $1
          AND dependency.workflow_run_id = $2
          AND dependency.work_task_id = $3
      `,
      [auth.tenantId, task.workflow_run_id, row.work_task_id]
    );
    if (!readyResult.rows[0]?.ready) {
      continue;
    }

    await client.query(
      `
        UPDATE work_task
        SET
          status = CASE WHEN status = 'blocked'::work_task_status_type THEN 'not_started'::work_task_status_type ELSE status END,
          blocked_reason = CASE WHEN blocked_reason = $2 THEN NULL ELSE blocked_reason END,
          updated_by_user_id = $4,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $3
          AND status NOT IN ('completed'::work_task_status_type, 'cancelled'::work_task_status_type)
      `,
      [auth.tenantId, WORKFLOW_DEPENDENCY_BLOCKED_REASON, row.work_task_id, auth.id]
    );
  }
}

async function activateCompletionApprovalCheckpoints(
  client: PoolClient,
  auth: AuthUser,
  task: WorkTaskRecord
) {
  if (!task.workflow_run_id) {
    return;
  }
  const job = await resolveWorkflowJobForTask(client, auth.tenantId, task);
  if (!job) {
    return;
  }
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_run_approval_checkpoint
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND work_task_id = $3
        AND status = 'queued'::shared_workflow_approval_checkpoint_status_type
    `,
    [auth.tenantId, task.workflow_run_id, task.id]
  );

  for (const row of rows) {
    await activateApprovalCheckpoint(client, auth, job, row.id);
  }
}

export async function handleSharedWorkflowTaskMutation(
  client: PoolClient,
  auth: AuthUser,
  task: WorkTaskRecord,
  nextValues: {
    assigned_to_user_id: string | null;
    status: WorkTaskStatus;
  }
) {
  if (!task.workflow_run_id) {
    return;
  }

  await acknowledgeClaimedWorkflowTask(client, auth, task, nextValues.assigned_to_user_id);

  if (task.status !== "completed" && nextValues.status === "completed") {
    await releaseWorkflowDependentTasks(client, auth, task);
    await activateCompletionApprovalCheckpoints(client, auth, task);
  }
}
