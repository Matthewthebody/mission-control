import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { JobDepartmentType, JobWatchFlagSeverity, JobWatchFlagStatus, WorkDepartmentType, WorkTaskStatus } from "../domain/jobTruth/index.js";
import type {
  CreatePostCallOutcomeInput,
  PostCallAssigneeOption,
  PostCallFollowUpView,
  PostCallOutcomeRecord,
  PostCallOutcomeStatus
} from "../types/postCallFollowUp.js";
import type { TeamsMeetingLinkedObjectType, TeamsMeetingRecordView } from "../types/teamsMeetings.js";
import { createAuditLog } from "./audit.js";
import { captureCommunicationFailure, writeCommunicationAuditEvent } from "./communicationObservability.js";
import { canManageTaskDepartment, createWorkTask } from "./jobTruth/workTaskService.js";
import { createOrResolveWatchFlag } from "./jobTruth/jobService.js";
import { getTeamsMeetingRecordView } from "./teamsMeetings.js";
import { canManageSchoolsHub, canCreateOrEditShootDepartment, hasAuthorityTier } from "../authz/authority.js";
import { canSharedPolicy } from "./policy/index.js";

type PostCallOutcomeRow = {
  id: string;
  related_record_type: TeamsMeetingLinkedObjectType;
  related_record_id: string;
  meeting_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  handled_by_user_id: string | null;
  handled_by_name: string | null;
  outcome_status: PostCallOutcomeStatus;
  summary: string;
  notes: string | null;
  reason_for_call: string | null;
  meeting_target_id: string | null;
  meeting_join_url: string | null;
  follow_up_task_id: string | null;
  follow_up_task_number: string | null;
  follow_up_task_title: string | null;
  follow_up_task_status: string | null;
  follow_up_task_assigned_to_user_id: string | null;
  follow_up_task_assigned_to_name: string | null;
  watch_flag_id: string | null;
  watch_flag_title: string | null;
  watch_flag_severity: JobWatchFlagSeverity | null;
  watch_flag_status: string | null;
  issue_flagged: boolean;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
};

type PostCallRecordContext = {
  objectType: TeamsMeetingLinkedObjectType;
  objectId: string;
  objectLabel: string;
  taskDepartmentType: WorkDepartmentType;
  relatedJobId: string | null;
  issueJobId: string | null;
  issueDepartmentType: JobDepartmentType | null;
  assignedUserIds: string[];
  defaultTaskTitle: string;
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeTimestamp(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "Date/time values must be valid ISO timestamps.");
  }
  return parsed.toISOString();
}

function mapJobDepartmentToTaskDepartment(departmentType: JobDepartmentType): WorkDepartmentType {
  switch (departmentType) {
    case "schools":
      return "schools";
    case "sports":
      return "sports";
    case "corporate":
    case "headshots":
    case "other":
    default:
      return "operations";
  }
}

function mapOutcomeRow(row: PostCallOutcomeRow): PostCallOutcomeRecord {
  return {
    id: row.id,
    related_record_type: row.related_record_type,
    related_record_id: row.related_record_id,
    meeting_id: row.meeting_id,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    handled_by_user_id: row.handled_by_user_id,
    handled_by_name: row.handled_by_name,
    outcome_status: row.outcome_status,
    summary: row.summary,
    notes: row.notes,
    reason_for_call: row.reason_for_call,
    meeting_target_id: row.meeting_target_id,
    meeting_join_url: row.meeting_join_url,
    follow_up_task: row.follow_up_task_id
      ? {
          id: row.follow_up_task_id,
          task_number: row.follow_up_task_number ?? "Task",
          title: row.follow_up_task_title ?? "Follow-up task",
          status: (row.follow_up_task_status ?? "not_started") as WorkTaskStatus,
          assigned_to_user_id: row.follow_up_task_assigned_to_user_id,
          assigned_to_name: row.follow_up_task_assigned_to_name
        }
      : null,
    follow_up_issue: row.watch_flag_id
      ? {
          id: row.watch_flag_id,
          title: row.watch_flag_title ?? "Flagged issue",
          severity: row.watch_flag_severity ?? "medium",
          status: (row.watch_flag_status ?? "open") as JobWatchFlagStatus
        }
      : null,
    issue_flagged: row.issue_flagged,
    handled_at: row.handled_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function hasPostCallOutcomeSchema(client: PoolClient) {
  const { rows } = await client.query<{ ready: boolean }>(`
    SELECT (to_regclass('public.communication_post_call_outcome') IS NOT NULL) AS ready
  `);
  return Boolean(rows[0]?.ready);
}

async function listJobAssignedUsers(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<{ user_id: string }>(
    `
      SELECT DISTINCT assignment.user_id::text AS user_id
      FROM job_staff_assignments assignment
      WHERE assignment.tenant_id = $1
        AND assignment.job_id = $2
        AND assignment.user_id IS NOT NULL
    `,
    [tenantId, jobId]
  );
  return rows.map((row) => row.user_id);
}

async function resolvePostCallRecordContext(
  client: PoolClient,
  auth: AuthUser,
  meetingView: TeamsMeetingRecordView,
  objectType: TeamsMeetingLinkedObjectType,
  objectId: string
): Promise<PostCallRecordContext> {
  if (objectType === "job") {
    const { rows } = await client.query<{
      id: string;
      title: string;
      job_number: string | null;
      department_type: JobDepartmentType;
    }>(
      `
        SELECT
          id::text,
          title,
          job_number,
          department_type::text AS department_type
        FROM jobs
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    const objectLabel = row.job_number ? `${row.job_number} | ${row.title}` : row.title;
    return {
      objectType,
      objectId,
      objectLabel,
      taskDepartmentType: mapJobDepartmentToTaskDepartment(row.department_type),
      relatedJobId: row.id,
      issueJobId: row.id,
      issueDepartmentType: row.department_type,
      assignedUserIds: await listJobAssignedUsers(client, auth.tenantId, row.id),
      defaultTaskTitle: `Follow up: ${objectLabel}`
    };
  }

  if (objectType === "task") {
    const { rows } = await client.query<{
      id: string;
      title: string;
      task_number: string;
      department_type: WorkDepartmentType;
      related_job_id: string | null;
      related_job_department: JobDepartmentType | null;
    }>(
      `
        SELECT
          task.id::text,
          task.title,
          task.task_number,
          task.department_type::text AS department_type,
          task.related_job_id::text,
          job.department_type::text AS related_job_department
        FROM work_task task
        LEFT JOIN jobs job
          ON job.tenant_id = task.tenant_id
         AND job.id = task.related_job_id
        WHERE task.tenant_id = $1
          AND task.id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType,
      objectId,
      objectLabel: meetingView.object_label,
      taskDepartmentType: row.department_type,
      relatedJobId: row.related_job_id,
      issueJobId: row.related_job_id,
      issueDepartmentType: row.related_job_department,
      assignedUserIds: row.related_job_id ? await listJobAssignedUsers(client, auth.tenantId, row.related_job_id) : [],
      defaultTaskTitle: `Follow up: ${row.task_number}`
    };
  }

  if (objectType === "production_item") {
    const { rows } = await client.query<{
      id: string;
      title: string;
      job_id: string | null;
      department_type: JobDepartmentType | null;
    }>(
      `
        SELECT
          item.id::text,
          item.title,
          item.job_id::text,
          item.department_type::text AS department_type
        FROM production_items item
        WHERE item.tenant_id = $1
          AND item.id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType,
      objectId,
      objectLabel: meetingView.object_label,
      taskDepartmentType: "production",
      relatedJobId: row.job_id,
      issueJobId: row.job_id,
      issueDepartmentType: row.department_type,
      assignedUserIds: row.job_id ? await listJobAssignedUsers(client, auth.tenantId, row.job_id) : [],
      defaultTaskTitle: `Follow up: ${row.title}`
    };
  }

  if (objectType === "organization") {
    const { rows } = await client.query<{ id: string; display_name: string }>(
      `
        SELECT id::text, display_name
        FROM organization
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    return {
      objectType,
      objectId,
      objectLabel: row.display_name,
      taskDepartmentType: "operations",
      relatedJobId: null,
      issueJobId: null,
      issueDepartmentType: null,
      assignedUserIds: [],
      defaultTaskTitle: `Follow up: ${row.display_name}`
    };
  }

  const { rows } = await client.query<{ id: string; location_name: string }>(
    `
      SELECT id::text, location_name
      FROM location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, objectId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Record not found");
  }
  return {
    objectType,
    objectId,
    objectLabel: row.location_name,
    taskDepartmentType: "operations",
    relatedJobId: null,
    issueJobId: null,
    issueDepartmentType: null,
    assignedUserIds: [],
    defaultTaskTitle: `Follow up: ${row.location_name}`
  };
}

function canManageSportsDepartment(auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (auth.department === "sports" && hasAuthorityTier(auth, "supervisor")) ||
    auth.jobFunctionProfiles.some((profile) => ["sports_client_success", "director_of_sports_photography"].includes(profile)) ||
    auth.permissions.includes("sports_hub.manage")
  );
}

function canCreateJobWatchFlag(auth: AuthUser, departmentType: JobDepartmentType, assignedUserIds: string[]) {
  if (
    canSharedPolicy(auth, "job.update", { departmentType }) ||
    canSharedPolicy(auth, "job.publish", { departmentType }) ||
    canSharedPolicy(auth, "job.assign_staff", { departmentType }) ||
    canSharedPolicy(auth, "job.manage_readiness", { departmentType }) ||
    canSharedPolicy(auth, "production.update", { departmentType }) ||
    canSharedPolicy(auth, "watchflag.resolve", { departmentType })
  ) {
    return true;
  }

  if (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (departmentType === "schools" && canManageSchoolsHub(auth)) ||
    (departmentType === "sports" && canManageSportsDepartment(auth))
  ) {
    return true;
  }

  return assignedUserIds.includes(auth.id);
}

function buildAssigneeOptions(auth: AuthUser, meetingView: TeamsMeetingRecordView): PostCallAssigneeOption[] {
  const base = meetingView.defaults.suggested_participants.map((participant) => ({
    user_id: participant.user_id,
    full_name: participant.full_name
  }));
  const withActor = [
    ...base,
    {
      user_id: auth.id,
      full_name: auth.fullName
    }
  ];
  const seen = new Set<string>();
  return withActor.filter((option) => {
    if (!option.user_id || seen.has(option.user_id)) {
      return false;
    }
    seen.add(option.user_id);
    return true;
  });
}

async function listRecentOutcomes(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsMeetingLinkedObjectType,
  objectId: string
) {
  const { rows } = await client.query<PostCallOutcomeRow>(
    `
      SELECT
        outcome.id::text,
        outcome.related_record_type::text AS related_record_type,
        outcome.related_record_id::text,
        outcome.meeting_id::text,
        outcome.actor_user_id::text,
        actor.full_name AS actor_name,
        outcome.handled_by_user_id::text,
        handled_by.full_name AS handled_by_name,
        outcome.outcome_status::text,
        outcome.summary,
        outcome.notes,
        outcome.reason_for_call,
        outcome.meeting_target_id,
        outcome.meeting_join_url,
        outcome.follow_up_task_id::text,
        task.task_number AS follow_up_task_number,
        task.title AS follow_up_task_title,
        task.status::text AS follow_up_task_status,
        task.assigned_to_user_id::text AS follow_up_task_assigned_to_user_id,
        task_user.full_name AS follow_up_task_assigned_to_name,
        outcome.watch_flag_id::text,
        flag.title AS watch_flag_title,
        flag.severity::text AS watch_flag_severity,
        flag.status::text AS watch_flag_status,
        outcome.issue_flagged,
        outcome.handled_at::text,
        outcome.created_at::text,
        outcome.updated_at::text
      FROM communication_post_call_outcome outcome
      LEFT JOIN app_user actor
        ON actor.tenant_id = outcome.tenant_id
       AND actor.id = outcome.actor_user_id
      LEFT JOIN app_user handled_by
        ON handled_by.tenant_id = outcome.tenant_id
       AND handled_by.id = outcome.handled_by_user_id
      LEFT JOIN work_task task
        ON task.tenant_id = outcome.tenant_id
       AND task.id = outcome.follow_up_task_id
      LEFT JOIN app_user task_user
        ON task_user.tenant_id = outcome.tenant_id
       AND task_user.id = task.assigned_to_user_id
      LEFT JOIN job_watch_flags flag
        ON flag.tenant_id = outcome.tenant_id
       AND flag.id = outcome.watch_flag_id
      WHERE outcome.tenant_id = $1
        AND outcome.related_record_type = $2::teams_meeting_link_object_type
        AND outcome.related_record_id = $3
      ORDER BY outcome.created_at DESC
      LIMIT 8
    `,
    [tenantId, objectType, objectId]
  );
  return rows.map(mapOutcomeRow);
}

function buildSuggestedReason(meetingView: TeamsMeetingRecordView) {
  return meetingView.meeting?.title ?? meetingView.object_label ?? null;
}

export async function getPostCallFollowUpView(
  client: PoolClient,
  auth: AuthUser,
  input: { objectType: TeamsMeetingLinkedObjectType; objectId: string }
): Promise<PostCallFollowUpView> {
  let meetingView: TeamsMeetingRecordView | null = null;
  try {
    meetingView = await getTeamsMeetingRecordView(client, auth, input);
    const hasSchema = await hasPostCallOutcomeSchema(client);
    const featureEnabled = Boolean(config.COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED && hasSchema);
    const baseCanLogOutcome = Boolean(meetingView.permissions.can_use || meetingView.permissions.can_manage);
    if (!baseCanLogOutcome) {
      throw new ApiError(403, "Forbidden");
    }

    const context = await resolvePostCallRecordContext(client, auth, meetingView, input.objectType, input.objectId);
    const assigneeOptions = buildAssigneeOptions(auth, meetingView);
    const canCreateFollowUpTask = featureEnabled && canManageTaskDepartment(auth, context.taskDepartmentType);
    const canFlagIssue = Boolean(
      featureEnabled &&
        context.issueJobId &&
        context.issueDepartmentType &&
        canCreateJobWatchFlag(auth, context.issueDepartmentType, context.assignedUserIds)
    );
    const recentOutcomes = hasSchema ? await listRecentOutcomes(client, auth.tenantId, input.objectType, input.objectId) : [];

    return {
      object_type: input.objectType,
      object_id: input.objectId,
      object_label: meetingView.object_label,
      feature_enabled: featureEnabled,
      permissions: {
        can_log_outcome: featureEnabled && baseCanLogOutcome,
        can_create_follow_up_task: canCreateFollowUpTask,
        can_flag_issue: canFlagIssue
      },
      defaults: {
        suggested_reason: buildSuggestedReason(meetingView),
        suggested_task_title: context.defaultTaskTitle,
        assignee_options: assigneeOptions,
        default_assignee_user_id: assigneeOptions[0]?.user_id ?? null
      },
      meeting: meetingView.meeting
        ? {
            id: meetingView.meeting.id,
            title: meetingView.meeting.title,
            meeting_status: meetingView.meeting.meeting_status,
            meeting_join_url: meetingView.meeting.meeting_join_url,
            scheduled_start_at: meetingView.meeting.scheduled_start_at,
            scheduled_end_at: meetingView.meeting.scheduled_end_at
          }
        : null,
      summary: {
        latest_outcome: recentOutcomes[0] ?? null,
        open_follow_up_count: recentOutcomes.filter((entry) => entry.outcome_status === "follow_up_open").length,
        handled_count: recentOutcomes.filter((entry) => entry.outcome_status === "handled").length
      },
      recent_outcomes: recentOutcomes
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.post_call.view_failed",
      resourceType: input.objectType,
      resourceId: input.objectId,
      area: "post_call_follow_up",
      action: "view_post_call",
      error,
      context: {
        object_type: input.objectType,
        object_id: input.objectId,
        object_label: meetingView?.object_label ?? null
      }
    });
    throw error;
  }
}

async function findLatestCreatedWatchFlag(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  actorUserId: string,
  title: string,
  sourceEntityType: string,
  sourceEntityId: string
) {
  const { rows } = await client.query<{
    id: string;
    title: string;
    severity: JobWatchFlagSeverity;
    status: string;
  }>(
    `
      SELECT
        id::text,
        title,
        severity::text AS severity,
        status::text AS status
      FROM job_watch_flags
      WHERE tenant_id = $1
        AND job_id = $2
        AND created_by_user_id = $3
        AND title = $4
        AND source_entity_type = $5
        AND source_entity_id = $6
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, jobId, actorUserId, title, sourceEntityType, sourceEntityId]
  );
  return rows[0] ?? null;
}

export async function createPostCallOutcome(
  client: PoolClient,
  auth: AuthUser,
  input: CreatePostCallOutcomeInput
) {
  let meetingView: TeamsMeetingRecordView | null = null;
  let meetingId: string | null = null;
  let outcomeId: string | null = null;
  try {
    meetingView = await getTeamsMeetingRecordView(client, auth, {
      objectType: input.object_type,
      objectId: input.object_id
    });
    const canLogOutcome = Boolean(meetingView.permissions.can_use || meetingView.permissions.can_manage);
    if (!canLogOutcome) {
      throw new ApiError(403, "Forbidden");
    }
    if (!config.COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED) {
      throw new ApiError(409, "Post-call follow-up is not enabled in this environment.");
    }
    if (!(await hasPostCallOutcomeSchema(client))) {
      throw new ApiError(503, "Post-call follow-up data model is not available in this environment.");
    }

    const context = await resolvePostCallRecordContext(client, auth, meetingView, input.object_type, input.object_id);
    const summary = normalizeText(input.summary);
    if (!summary) {
      throw new ApiError(400, "A post-call summary is required.");
    }

    meetingId = input.meeting_id ?? meetingView.meeting?.id ?? null;
    if (meetingId && meetingView.meeting && meetingId !== meetingView.meeting.id) {
      throw new ApiError(400, "The selected meeting does not belong to this record.");
    }
    if (!meetingId && !meetingView.meeting) {
      throw new ApiError(400, "Link a Teams meeting to this record before logging post-call follow-up.");
    }

    const assigneeOptions = buildAssigneeOptions(auth, meetingView);
    const allowedAssigneeIds = new Set(assigneeOptions.map((option) => option.user_id));
    const canCreateFollowUpTask = canManageTaskDepartment(auth, context.taskDepartmentType);
    const canFlagIssue = Boolean(
      context.issueJobId &&
        context.issueDepartmentType &&
        canCreateJobWatchFlag(auth, context.issueDepartmentType, context.assignedUserIds)
    );

    const createFollowUpTask = Boolean(input.create_follow_up_task);
    const flagIssue = Boolean(input.flag_issue);
    if (createFollowUpTask && !canCreateFollowUpTask) {
      throw new ApiError(403, "You do not have access to create follow-up tasks for this record.");
    }
    if (flagIssue && !canFlagIssue) {
      throw new ApiError(403, "You do not have access to flag an issue from this record.");
    }

    const followUpAssigneeUserId =
      normalizeText(input.follow_up_task_assignee_user_id) ??
      assigneeOptions[0]?.user_id ??
      null;
    if (createFollowUpTask && followUpAssigneeUserId && !allowedAssigneeIds.has(followUpAssigneeUserId)) {
      throw new ApiError(400, "Choose a valid follow-up assignee from the meeting context.");
    }

    const reasonForCall = normalizeText(input.reason_for_call) ?? buildSuggestedReason(meetingView);
    const notes = normalizeText(input.notes);
    const followUpTaskTitle = normalizeText(input.follow_up_task_title) ?? context.defaultTaskTitle;
    const followUpTaskDueAt = normalizeTimestamp(input.follow_up_task_due_at);
    const issueSeverity = input.issue_severity ?? "medium";
    const issueTitle = normalizeText(input.issue_title) ?? summary;
    const issueDescription = normalizeText(input.issue_description) ?? notes ?? summary;
    const markHandled = Boolean(input.mark_handled);

    const createdTask = createFollowUpTask
      ? await createWorkTask(
          client,
          auth,
          {
            title: followUpTaskTitle,
            description: notes,
            task_type: "post_call_follow_up",
            department_type: context.taskDepartmentType,
            related_job_id: context.relatedJobId,
            assigned_to_user_id: followUpAssigneeUserId,
            status: "not_started",
            priority: "normal",
            due_at: followUpTaskDueAt,
            completion_notes: null
          },
          {
            sourceSurface: "post_call_follow_up"
          }
        )
      : null;

    let createdWatchFlag:
      | {
          id: string;
          title: string;
          severity: JobWatchFlagSeverity;
          status: string;
        }
      | null = null;

    if (flagIssue && context.issueJobId) {
      await createOrResolveWatchFlag(client, auth, context.issueJobId, {
        severity: issueSeverity,
        flag_type: "post_call_follow_up",
        title: issueTitle,
        description: issueDescription,
        status: "open",
        owner_user_id: followUpAssigneeUserId,
        source_entity_type: input.object_type,
        source_entity_id: input.object_id
      });
      createdWatchFlag = await findLatestCreatedWatchFlag(
        client,
        auth.tenantId,
        context.issueJobId,
        auth.id,
        issueTitle,
        input.object_type,
        input.object_id
      );
    }

    const outcomeStatus: PostCallOutcomeStatus = markHandled ? "handled" : "follow_up_open";
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO communication_post_call_outcome (
          tenant_id,
          related_record_type,
          related_record_id,
          meeting_id,
          actor_user_id,
          handled_by_user_id,
          outcome_status,
          summary,
          notes,
          reason_for_call,
          meeting_target_id,
          meeting_join_url,
          follow_up_task_id,
          follow_up_assignee_user_id,
          watch_flag_id,
          issue_flagged,
          handled_at,
          metadata
        )
        VALUES (
          $1,
          $2::teams_meeting_link_object_type,
          $3,
          $4,
          $5,
          $6,
          $7::post_call_outcome_status,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18::jsonb
        )
        RETURNING id::text AS id
      `,
      [
        auth.tenantId,
        input.object_type,
        input.object_id,
        meetingId,
        auth.id,
        markHandled ? auth.id : null,
        outcomeStatus,
        summary,
        notes,
        reasonForCall,
        meetingView.meeting?.external_meeting_id ?? meetingView.meeting?.external_calendar_event_id ?? null,
        meetingView.meeting?.meeting_join_url ?? null,
        createdTask?.task.id ?? null,
        followUpAssigneeUserId,
        createdWatchFlag?.id ?? null,
        flagIssue,
        markHandled ? new Date().toISOString() : null,
        JSON.stringify({
          meeting_title: meetingView.meeting?.title ?? null,
          record_label: context.objectLabel,
          created_follow_up_task: Boolean(createdTask),
          flagged_issue: Boolean(createdWatchFlag)
        })
      ]
    );

    outcomeId = rows[0]?.id ?? null;
    if (!outcomeId) {
      throw new Error("Failed to save post-call outcome.");
    }

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "communication.post_call_outcome.created",
      entityType: "communication_post_call_outcome",
      entityId: outcomeId,
      metadata: {
        related_record_type: input.object_type,
        related_record_id: input.object_id,
        meeting_id: meetingId,
        follow_up_task_id: createdTask?.task.id ?? null,
        watch_flag_id: createdWatchFlag?.id ?? null
      },
      newValues: {
        outcome_status: outcomeStatus,
        summary,
        reason_for_call: reasonForCall
      },
      sourceSurface: "post_call_follow_up"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.post_call_outcome.created",
      resourceType: "communication_post_call_outcome",
      resourceId: outcomeId,
      result: "succeeded",
      context: {
        related_record_type: input.object_type,
        related_record_id: input.object_id,
        meeting_id: meetingId,
        follow_up_task_id: createdTask?.task.id ?? null,
        watch_flag_id: createdWatchFlag?.id ?? null
      },
      newValues: {
        outcome_status: outcomeStatus,
        summary,
        reason_for_call: reasonForCall
      }
    });

    const view = await getPostCallFollowUpView(client, auth, {
      objectType: input.object_type,
      objectId: input.object_id
    });
    return {
      outcome: view.recent_outcomes.find((entry) => entry.id === outcomeId) ?? view.recent_outcomes[0] ?? null,
      view
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.post_call_outcome.create_failed",
      resourceType: "communication_post_call_outcome",
      resourceId: outcomeId ?? meetingId ?? input.object_id,
      area: "post_call_follow_up",
      action: "create_post_call_outcome",
      error,
      context: {
        object_type: input.object_type,
        object_id: input.object_id,
        meeting_id: meetingId,
        object_label: meetingView?.object_label ?? null
      }
    });
    throw error;
  }
}
