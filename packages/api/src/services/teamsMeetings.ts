import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import type {
  CancelTeamsMeetingInput,
  TeamsMeetingLifecycleType,
  TeamsMeetingLinkedObjectType,
  TeamsMeetingMode,
  TeamsMeetingParticipantRecord,
  TeamsMeetingRecord,
  TeamsMeetingRecordDefaults,
  TeamsMeetingRecordSyncPolicy,
  TeamsMeetingRecordView,
  TeamsMeetingStatus,
  TeamsMeetingSyncOperationRecord,
  TeamsMeetingSyncOperationType,
  TeamsMeetingTimingState,
  UpsertTeamsMeetingInput
} from "../types/teamsMeetings.js";
import { getCommunicationMeetingDefaultMode } from "./adminConfiguration.js";
import { createAuditLog } from "./audit.js";
import {
  assertCommunicationIdentityReady,
  buildCommunicationIdentity,
  isCommunicationIdentityReady
} from "./communicationIdentity.js";
import { captureCommunicationFailure, writeCommunicationAuditEvent } from "./communicationObservability.js";
import { evaluateCommunicationGovernance } from "./communicationGovernance.js";
import { buildTeamsEmbeddedAppUrl } from "./microsoftTeamsLinks.js";
import { createAppEvent } from "./outbox.js";
import { canViewRecords } from "./policy/operationalAuthorization.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type RecordContext = {
  objectType: TeamsMeetingLinkedObjectType;
  objectId: string;
  objectLabel: string;
  permissionEntity: "job" | "task" | "production" | "organization" | "location";
  policyContext: {
    departmentType?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    ownerUserIds?: string[];
    assignedUserIds?: string[];
    customScopeValues?: string[];
  };
  defaults: TeamsMeetingRecordDefaults;
};

type ParticipantCandidateRow = {
  user_id: string;
  full_name: string;
  email: string;
  microsoft_user_id: string | null;
  microsoft_tenant_id: string | null;
  communication_enabled: boolean;
  linked_at: string | null;
  last_verified_at: string | null;
  auth_provider: string | null;
};

type MeetingRow = {
  id: string;
  linked_record_type: TeamsMeetingLinkedObjectType;
  linked_record_id: string;
  meeting_provider: string;
  meeting_mode: TeamsMeetingMode;
  meeting_status: TeamsMeetingStatus;
  metadata: Record<string, unknown> | null;
  title: string;
  description: string | null;
  meeting_join_url: string | null;
  meeting_web_url: string | null;
  external_meeting_id: string | null;
  external_calendar_event_id: string | null;
  organizer_user_id: string | null;
  organizer_email: string | null;
  organizer_microsoft_user_id: string | null;
  participant_snapshot: TeamsMeetingParticipantRecord[] | null;
  app_deep_link: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  last_sync_operation_id: string | null;
  last_sync_attempt_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

type MeetingOperationRow = {
  id: string;
  meeting_id: string;
  operation_type: TeamsMeetingSyncOperationType;
  trigger_source: string;
  actor_user_id: string | null;
  status: "queued" | "processing" | "succeeded" | "failed" | "throttled" | "skipped";
  app_event_id: string | null;
  attempt_count: number;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type MeetingLookupRow = MeetingRow & {
  object_label: string;
  permission_entity: "job" | "task" | "production" | "organization" | "location";
  department_type: string | null;
  organization_id: string | null;
  location_id: string | null;
  owner_user_ids: string[] | null;
  assigned_user_ids: string[] | null;
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeDateTime(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "Meeting date/time values must be valid ISO timestamps.");
  }
  return parsed.toISOString();
}

function toDepartmentCode(value: string | null | undefined): DepartmentCode | null {
  if (value === "schools" || value === "sports") {
    return value;
  }
  return null;
}

function toMeetingRecord(row: MeetingRow): TeamsMeetingRecord {
  const lifecycle = resolveMeetingLifecycle(row.linked_record_type, row.meeting_mode, row.metadata);
  return {
    id: row.id,
    linked_record_type: row.linked_record_type,
    linked_record_id: row.linked_record_id,
    meeting_provider: "microsoft_teams",
    meeting_mode: row.meeting_mode,
    meeting_status: row.meeting_status,
    lifecycle_type: lifecycle.lifecycleType,
    record_sync_policy: lifecycle.recordSyncPolicy,
    timing_state: deriveMeetingTimingState(row),
    status_summary: buildMeetingStatusSummary(row),
    record_behavior_summary: buildRecordBehaviorSummary(row.linked_record_type, lifecycle.lifecycleType, lifecycle.recordSyncPolicy),
    title: row.title,
    description: row.description,
    meeting_join_url: row.meeting_join_url,
    meeting_web_url: row.meeting_web_url,
    external_meeting_id: row.external_meeting_id,
    external_calendar_event_id: row.external_calendar_event_id,
    organizer_user_id: row.organizer_user_id,
    organizer_email: row.organizer_email,
    organizer_microsoft_user_id: row.organizer_microsoft_user_id,
    participant_snapshot: Array.isArray(row.participant_snapshot) ? row.participant_snapshot : [],
    app_deep_link: row.app_deep_link,
    scheduled_start_at: row.scheduled_start_at,
    scheduled_end_at: row.scheduled_end_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    last_sync_operation_id: row.last_sync_operation_id,
    last_sync_attempt_at: row.last_sync_attempt_at,
    last_synced_at: row.last_synced_at,
    sync_error: row.sync_error,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toMeetingOperationRecord(row: MeetingOperationRow): TeamsMeetingSyncOperationRecord {
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    operation_type: row.operation_type,
    trigger_source: row.trigger_source,
    actor_user_id: row.actor_user_id,
    status: row.status,
    app_event_id: row.app_event_id,
    attempt_count: Number(row.attempt_count ?? 0),
    first_attempted_at: row.first_attempted_at,
    last_attempted_at: row.last_attempted_at,
    completed_at: row.completed_at,
    failed_at: row.failed_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildPolicyContext(record: RecordContext) {
  return {
    departmentType: record.policyContext.departmentType ?? null,
    organizationId: record.policyContext.organizationId ?? null,
    locationId: record.policyContext.locationId ?? null,
    ownerUserIds: record.policyContext.ownerUserIds ?? [],
    assignedUserIds: record.policyContext.assignedUserIds ?? [],
    customScopeValues: record.policyContext.customScopeValues ?? []
  };
}

function canViewMeetingRecord(auth: AuthUser, record: RecordContext) {
  return canViewRecords(auth, record.permissionEntity, buildPolicyContext(record));
}

function canUseMeetingOnRecord(auth: AuthUser, record: RecordContext) {
  return evaluateCommunicationGovernance(auth, {
    objectType: record.objectType,
    objectId: record.objectId,
    objectLabel: record.objectLabel,
    policyContext: buildPolicyContext(record)
  }).permissions.can_use;
}

function canManageMeetingOnRecord(auth: AuthUser, record: RecordContext) {
  return evaluateCommunicationGovernance(auth, {
    objectType: record.objectType,
    objectId: record.objectId,
    objectLabel: record.objectLabel,
    policyContext: buildPolicyContext(record)
  }).permissions.can_manage_meetings;
}

function assertRecordVisible(auth: AuthUser, record: RecordContext) {
  if (!canViewMeetingRecord(auth, record)) {
    throw new ApiError(403, "Forbidden");
  }
}

function buildJobHash(departmentType: string | null | undefined, jobId: string, tab: string | null = null) {
  const base = departmentType === "schools" ? "#schools/shoots" : "#sports/shoots";
  return tab ? `${base}/${jobId}?tab=${encodeURIComponent(tab)}` : `${base}/${jobId}`;
}

function buildTaskHash(taskId: string) {
  return `#tasks/${taskId}`;
}

type ResolvedMeetingLifecycle = {
  lifecycleType: TeamsMeetingLifecycleType;
  recordSyncPolicy: TeamsMeetingRecordSyncPolicy;
};

function supportsScheduledRecordLifecycle(objectType: TeamsMeetingLinkedObjectType) {
  return objectType === "job" || objectType === "task" || objectType === "production_item";
}

function listAllowedLifecycleTypes(objectType: TeamsMeetingLinkedObjectType): TeamsMeetingLifecycleType[] {
  if (supportsScheduledRecordLifecycle(objectType)) {
    return ["scheduled_record_meeting", "internal_review"];
  }
  return ["internal_review"];
}

function getDefaultLifecycleType(objectType: TeamsMeetingLinkedObjectType): TeamsMeetingLifecycleType {
  return supportsScheduledRecordLifecycle(objectType) ? "scheduled_record_meeting" : "internal_review";
}

function deriveRecordSyncPolicy(
  objectType: TeamsMeetingLinkedObjectType,
  lifecycleType: TeamsMeetingLifecycleType
): TeamsMeetingRecordSyncPolicy {
  if (lifecycleType === "scheduled_record_meeting" && supportsScheduledRecordLifecycle(objectType)) {
    return "follow_record_schedule";
  }
  return "manual";
}

function isTeamsMeetingLifecycleType(value: unknown): value is TeamsMeetingLifecycleType {
  return value === "ad_hoc_call" || value === "scheduled_record_meeting" || value === "internal_review";
}

function isTeamsMeetingRecordSyncPolicy(value: unknown): value is TeamsMeetingRecordSyncPolicy {
  return value === "manual" || value === "follow_record_schedule";
}

function resolveMeetingLifecycle(
  objectType: TeamsMeetingLinkedObjectType,
  meetingMode: TeamsMeetingMode,
  metadata: Record<string, unknown> | null | undefined
): ResolvedMeetingLifecycle {
  const metadataLifecycle = metadata?.meeting_lifecycle_type;
  const metadataPolicy = metadata?.record_sync_policy;

  const lifecycleType =
    (isTeamsMeetingLifecycleType(metadataLifecycle) && metadataLifecycle) ||
    (meetingMode === "standalone_online_meeting"
      ? "ad_hoc_call"
      : objectType === "organization" || objectType === "location"
        ? "internal_review"
        : "scheduled_record_meeting");

  const recordSyncPolicy =
    (isTeamsMeetingRecordSyncPolicy(metadataPolicy) && metadataPolicy) || deriveRecordSyncPolicy(objectType, lifecycleType);

  return {
    lifecycleType,
    recordSyncPolicy
  };
}

function buildScheduleGuidance(objectType: TeamsMeetingLinkedObjectType) {
  if (objectType === "job") {
    return "Scheduled record meetings follow the job schedule. Internal review meetings keep their own manual schedule.";
  }
  if (objectType === "task") {
    return "Scheduled task meetings default to the task due time, or the related job window when available. Internal review meetings keep their own manual schedule.";
  }
  if (objectType === "production_item") {
    return "Scheduled production meetings default to the parent job window. Internal review meetings keep their own manual schedule.";
  }
  return "Use a manual schedule for coordination or escalation meetings linked to this record.";
}

function buildRecordBehaviorSummary(
  objectType: TeamsMeetingLinkedObjectType,
  lifecycleType: TeamsMeetingLifecycleType,
  recordSyncPolicy: TeamsMeetingRecordSyncPolicy
) {
  if (lifecycleType === "ad_hoc_call") {
    return "Ad hoc internal calls stay manual and do not auto-reschedule from record changes.";
  }
  if (recordSyncPolicy === "follow_record_schedule") {
    return `This meeting follows the linked ${objectType === "production_item" ? "production record" : objectType} schedule and participant context.`;
  }
  return "This meeting keeps its own manual schedule until someone updates it from the record.";
}

function deriveMeetingTimingState(meeting: {
  meeting_status: TeamsMeetingStatus;
  scheduled_start_at: string;
  scheduled_end_at: string;
  cancelled_at: string | null;
  sync_error: string | null;
}): TeamsMeetingTimingState {
  if (meeting.cancelled_at || meeting.meeting_status === "cancelled") {
    return "cancelled";
  }
  if (meeting.meeting_status === "sync_error") {
    return "attention_needed";
  }
  if (meeting.meeting_status === "pending_create" || meeting.meeting_status === "pending_update" || meeting.meeting_status === "pending_cancel") {
    return "pending";
  }

  const start = new Date(meeting.scheduled_start_at).getTime();
  const end = new Date(meeting.scheduled_end_at).getTime();
  const now = Date.now();
  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    if (now < start) {
      return "upcoming";
    }
    if (now <= end) {
      return "in_progress";
    }
  }
  return "ended";
}

function buildMeetingStatusSummary(meeting: {
  meeting_status: TeamsMeetingStatus;
  scheduled_start_at: string;
  scheduled_end_at: string;
  cancelled_at: string | null;
  sync_error: string | null;
}): string {
  const timingState = deriveMeetingTimingState(meeting);
  if (timingState === "cancelled") {
    return "Cancelled";
  }
  if (timingState === "attention_needed") {
    return meeting.sync_error ? `Needs attention: ${meeting.sync_error}` : "Needs attention";
  }
  if (meeting.meeting_status === "pending_create") {
    return "Create queued";
  }
  if (meeting.meeting_status === "pending_update") {
    return "Update queued";
  }
  if (meeting.meeting_status === "pending_cancel") {
    return "Cancel queued";
  }
  if (timingState === "upcoming") {
    return "Upcoming";
  }
  if (timingState === "in_progress") {
    return "In progress";
  }
  return "Ended";
}

function buildSuggestedParticipants(rows: ParticipantCandidateRow[]) {
  const participants = rows
    .map((row): TeamsMeetingParticipantRecord | null => {
      const identity = buildCommunicationIdentity({
        microsoftUserId: row.microsoft_user_id,
        microsoftTenantId: row.microsoft_tenant_id,
        communicationEnabled: row.communication_enabled,
        linkedAt: row.linked_at,
        lastVerifiedAt: row.last_verified_at,
        authProvider: row.auth_provider
      });
      if (!isCommunicationIdentityReady(identity)) {
        return null;
      }
      return {
        user_id: row.user_id,
        full_name: row.full_name,
        email: row.email,
        role: "attendee"
      };
    })
    .filter((row): row is TeamsMeetingParticipantRecord => Boolean(row));

  const seen = new Set<string>();
  return participants.filter((row) => {
    const key = row.user_id || row.email;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function loadReadyParticipantsForUsers(client: PoolClient, tenantId: string, userIds: string[]) {
  if (!userIds.length) {
    return [] as TeamsMeetingParticipantRecord[];
  }

  const { rows } = await client.query<ParticipantCandidateRow>(
    `
      SELECT
        u.id::text AS user_id,
        u.full_name,
        u.email,
        account.microsoft_user_id,
        account.microsoft_tenant_id,
        COALESCE(account.communication_enabled, false) AS communication_enabled,
        account.linked_at::text AS linked_at,
        account.last_verified_at::text AS last_verified_at,
        account.auth_provider
      FROM app_user u
      LEFT JOIN user_account account
        ON account.id = u.account_id
      WHERE u.tenant_id = $1
        AND u.id = ANY($2::uuid[])
        AND u.status = 'active'::membership_status
        AND u.email IS NOT NULL
      ORDER BY u.full_name ASC
    `,
    [tenantId, userIds]
  );

  return buildSuggestedParticipants(rows);
}

async function resolveRecordContext(
  client: PoolClient,
  auth: AuthUser,
  objectType: TeamsMeetingLinkedObjectType,
  objectId: string
): Promise<RecordContext> {
  if (objectType === "job") {
    const result = await client.query<{
      id: string;
      title: string;
      job_number: string | null;
      department_type: string;
      organization_id: string | null;
      primary_location_id: string | null;
      account_owner_user_id: string | null;
      created_by_user_id: string | null;
      scheduled_start_at: string | null;
      scheduled_end_at: string | null;
    }>(
      `
        SELECT
          id::text,
          title,
          job_number,
          department_type::text AS department_type,
          organization_id::text AS organization_id,
          primary_location_id::text AS primary_location_id,
          account_owner_user_id::text AS account_owner_user_id,
          created_by_user_id::text AS created_by_user_id,
          scheduled_start_at::text,
          scheduled_end_at::text
        FROM jobs
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }

    const assignmentResult = await client.query<{ user_id: string }>(
      `
        SELECT DISTINCT user_id::text AS user_id
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = $2
          AND user_id IS NOT NULL
      `,
      [auth.tenantId, objectId]
    );
    const userIds = [
      row.account_owner_user_id,
      row.created_by_user_id,
      ...assignmentResult.rows.map((entry) => entry.user_id)
    ].filter((value): value is string => Boolean(value));
    const participants = await loadReadyParticipantsForUsers(client, auth.tenantId, userIds);
    const objectLabel = row.job_number ? `${row.job_number} · ${row.title}` : row.title;
    return {
      objectType,
      objectId,
      objectLabel,
      permissionEntity: "job",
      policyContext: {
        departmentType: row.department_type,
        organizationId: row.organization_id,
        locationId: row.primary_location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: assignmentResult.rows.map((entry) => entry.user_id)
      },
      defaults: {
        suggested_title: `${objectLabel} Internal Teams Meeting`,
        suggested_description: `Internal Teams meeting linked to ${objectLabel}.`,
        scheduled_start_at: row.scheduled_start_at,
        scheduled_end_at: row.scheduled_end_at,
        app_deep_link: buildTeamsEmbeddedAppUrl(buildJobHash(row.department_type, row.id)),
        suggested_participants: participants,
        default_lifecycle_type: getDefaultLifecycleType(objectType),
        allowed_lifecycle_types: listAllowedLifecycleTypes(objectType),
        schedule_guidance: buildScheduleGuidance(objectType)
      }
    };
  }

  if (objectType === "production_item") {
    const result = await client.query<{
      id: string;
      title: string;
      assigned_to_user_id: string | null;
      created_by_user_id: string | null;
      job_id: string;
      job_department_type: string;
      organization_id: string | null;
      location_id: string | null;
      account_owner_user_id: string | null;
      job_scheduled_start_at: string | null;
      job_scheduled_end_at: string | null;
    }>(
      `
        SELECT
          item.id::text,
          item.title,
          item.assigned_to_user_id::text AS assigned_to_user_id,
          item.created_by_user_id::text AS created_by_user_id,
          item.job_id::text AS job_id,
          job.department_type::text AS job_department_type,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS location_id,
          job.account_owner_user_id::text AS account_owner_user_id,
          job.scheduled_start_at::text AS job_scheduled_start_at,
          job.scheduled_end_at::text AS job_scheduled_end_at
        FROM production_items item
        JOIN jobs job
          ON job.tenant_id = item.tenant_id
         AND job.id = item.job_id
        WHERE item.tenant_id = $1
          AND item.id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    const participants = await loadReadyParticipantsForUsers(
      client,
      auth.tenantId,
      [row.assigned_to_user_id, row.created_by_user_id, row.account_owner_user_id].filter((value): value is string => Boolean(value))
    );
    return {
      objectType,
      objectId,
      objectLabel: row.title,
      permissionEntity: "production",
      policyContext: {
        departmentType: row.job_department_type,
        organizationId: row.organization_id,
        locationId: row.location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [row.assigned_to_user_id].filter((value): value is string => Boolean(value))
      },
      defaults: {
        suggested_title: `${row.title} Internal Teams Meeting`,
        suggested_description: `Internal Teams meeting linked to production item ${row.title}.`,
        scheduled_start_at: row.job_scheduled_start_at,
        scheduled_end_at: row.job_scheduled_end_at,
        app_deep_link: buildTeamsEmbeddedAppUrl(buildJobHash(row.job_department_type, row.job_id, "production")),
        suggested_participants: participants,
        default_lifecycle_type: getDefaultLifecycleType(objectType),
        allowed_lifecycle_types: listAllowedLifecycleTypes(objectType),
        schedule_guidance: buildScheduleGuidance(objectType)
      }
    };
  }

  if (objectType === "task") {
    const result = await client.query<{
      id: string;
      title: string;
      task_number: string | null;
      department_type: string;
      related_job_id: string | null;
      assigned_to_user_id: string | null;
      created_by_user_id: string | null;
      organization_id: string | null;
      location_id: string | null;
      account_owner_user_id: string | null;
      due_at: string | null;
      related_job_scheduled_start_at: string | null;
      related_job_scheduled_end_at: string | null;
    }>(
      `
        SELECT
          task.id::text,
          task.title,
          task.task_number,
          task.department_type::text AS department_type,
          task.related_job_id::text AS related_job_id,
          task.assigned_to_user_id::text AS assigned_to_user_id,
          task.created_by_user_id::text AS created_by_user_id,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS location_id,
          job.account_owner_user_id::text AS account_owner_user_id,
          task.due_at::text AS due_at,
          job.scheduled_start_at::text AS related_job_scheduled_start_at,
          job.scheduled_end_at::text AS related_job_scheduled_end_at
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
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    const taskAssignments = await client.query<{ user_id: string }>(
      `
        SELECT DISTINCT user_id::text AS user_id
        FROM work_task_assignment
        WHERE tenant_id = $1
          AND work_task_id = $2
          AND user_id IS NOT NULL
      `,
      [auth.tenantId, objectId]
    );
    const participantIds = [
      row.assigned_to_user_id,
      row.created_by_user_id,
      row.account_owner_user_id,
      ...taskAssignments.rows.map((entry) => entry.user_id)
    ].filter((value): value is string => Boolean(value));
    const participants = await loadReadyParticipantsForUsers(client, auth.tenantId, participantIds);
    const objectLabel = row.task_number ? `${row.task_number} · ${row.title}` : row.title;
    const defaultStartAt = row.due_at ?? row.related_job_scheduled_start_at ?? null;
    const defaultEndAt =
      row.related_job_scheduled_end_at ??
      (defaultStartAt
        ? new Date(new Date(defaultStartAt).getTime() + 30 * 60_000).toISOString()
        : null);
    return {
      objectType,
      objectId,
      objectLabel,
      permissionEntity: "task",
      policyContext: {
        departmentType: row.department_type,
        organizationId: row.organization_id,
        locationId: row.location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [row.assigned_to_user_id, ...taskAssignments.rows.map((entry) => entry.user_id)].filter((value): value is string => Boolean(value)),
        customScopeValues: row.related_job_id ? [row.related_job_id] : []
      },
      defaults: {
        suggested_title: `${objectLabel} Internal Teams Meeting`,
        suggested_description: `Internal Teams meeting linked to ${objectLabel}.`,
        scheduled_start_at: defaultStartAt,
        scheduled_end_at: defaultEndAt,
        app_deep_link: buildTeamsEmbeddedAppUrl(buildTaskHash(row.id)),
        suggested_participants: participants,
        default_lifecycle_type: getDefaultLifecycleType(objectType),
        allowed_lifecycle_types: listAllowedLifecycleTypes(objectType),
        schedule_guidance: buildScheduleGuidance(objectType)
      }
    };
  }

  if (objectType === "organization") {
    const result = await client.query<{
      id: string;
      display_name: string;
      account_owner_user_id: string | null;
    }>(
      `
        SELECT
          id::text,
          display_name,
          account_owner_user_id::text AS account_owner_user_id
        FROM organization
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    const participants = await loadReadyParticipantsForUsers(
      client,
      auth.tenantId,
      [row.account_owner_user_id].filter((value): value is string => Boolean(value))
    );
    return {
      objectType,
      objectId,
      objectLabel: row.display_name,
      permissionEntity: "organization",
      policyContext: {
        organizationId: row.id,
        ownerUserIds: [row.account_owner_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: []
      },
      defaults: {
        suggested_title: `${row.display_name} Internal Teams Meeting`,
        suggested_description: `Internal Teams meeting linked to ${row.display_name}.`,
        scheduled_start_at: null,
        scheduled_end_at: null,
        app_deep_link: null,
        suggested_participants: participants,
        default_lifecycle_type: getDefaultLifecycleType(objectType),
        allowed_lifecycle_types: listAllowedLifecycleTypes(objectType),
        schedule_guidance: buildScheduleGuidance(objectType)
      }
    };
  }

  const result = await client.query<{
    id: string;
    location_name: string;
    organization_id: string | null;
  }>(
    `
      SELECT
        id::text,
        location_name,
        organization_id::text AS organization_id
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, objectId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "Record not found");
  }
  return {
    objectType,
    objectId,
    objectLabel: row.location_name,
    permissionEntity: "location",
    policyContext: {
      organizationId: row.organization_id,
      locationId: row.id,
      ownerUserIds: [],
      assignedUserIds: []
    },
    defaults: {
      suggested_title: `${row.location_name} Internal Teams Meeting`,
      suggested_description: `Internal Teams meeting linked to ${row.location_name}.`,
      scheduled_start_at: null,
      scheduled_end_at: null,
      app_deep_link: null,
      suggested_participants: [],
      default_lifecycle_type: getDefaultLifecycleType(objectType),
      allowed_lifecycle_types: listAllowedLifecycleTypes(objectType),
      schedule_guidance: buildScheduleGuidance(objectType)
    }
  };
}

function isTeamsMeetingsConfigured() {
  return Boolean(
    config.MICROSOFT_TEAMS_MEETINGS_ENABLED &&
      config.MICROSOFT_GRAPH_CLIENT_ID &&
      config.MICROSOFT_GRAPH_CLIENT_SECRET &&
      config.MICROSOFT_GRAPH_TENANT_ID
  );
}

async function hasTeamsMeetingsSchema(client: PoolClient) {
  const { rows } = await client.query<{
    has_reference: boolean;
    has_sync_operation: boolean;
  }>(
    `
      SELECT
        (to_regclass('public.teams_meeting_reference') IS NOT NULL) AS has_reference,
        (to_regclass('public.teams_meeting_sync_operation') IS NOT NULL) AS has_sync_operation
    `
  );

  const row = rows[0];
  return Boolean(row?.has_reference && row?.has_sync_operation);
}

async function loadMeetingForRecord(client: PoolClient, tenantId: string, objectType: TeamsMeetingLinkedObjectType, objectId: string) {
  const { rows } = await client.query<MeetingRow>(
    `
      SELECT
        id::text,
        linked_record_type::text AS linked_record_type,
        linked_record_id::text AS linked_record_id,
        meeting_provider,
        meeting_mode::text AS meeting_mode,
        meeting_status::text AS meeting_status,
        metadata,
        title,
        description,
        meeting_join_url,
        meeting_web_url,
        external_meeting_id,
        external_calendar_event_id,
        organizer_user_id::text AS organizer_user_id,
        organizer_email,
        organizer_microsoft_user_id,
        participant_snapshot,
        app_deep_link,
        scheduled_start_at::text,
        scheduled_end_at::text,
        created_by_user_id::text AS created_by_user_id,
        updated_by_user_id::text AS updated_by_user_id,
        last_sync_operation_id::text AS last_sync_operation_id,
        last_sync_attempt_at::text,
        last_synced_at::text,
        sync_error,
        cancelled_at::text,
        created_at::text,
        updated_at::text
      FROM teams_meeting_reference
      WHERE tenant_id = $1
        AND linked_record_type = $2::teams_meeting_link_object_type
        AND linked_record_id = $3
        AND cancelled_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, objectType, objectId]
  );
  return rows[0] ?? null;
}

async function loadMeetingById(client: PoolClient, tenantId: string, meetingId: string) {
  const { rows } = await client.query<MeetingLookupRow>(
    `
      SELECT
        meeting.id::text,
        meeting.linked_record_type::text AS linked_record_type,
        meeting.linked_record_id::text AS linked_record_id,
        meeting.meeting_provider,
        meeting.meeting_mode::text AS meeting_mode,
        meeting.meeting_status::text AS meeting_status,
        meeting.metadata,
        meeting.title,
        meeting.description,
        meeting.meeting_join_url,
        meeting.meeting_web_url,
        meeting.external_meeting_id,
        meeting.external_calendar_event_id,
        meeting.organizer_user_id::text AS organizer_user_id,
        meeting.organizer_email,
        meeting.organizer_microsoft_user_id,
        meeting.participant_snapshot,
        meeting.app_deep_link,
        meeting.scheduled_start_at::text,
        meeting.scheduled_end_at::text,
        meeting.created_by_user_id::text AS created_by_user_id,
        meeting.updated_by_user_id::text AS updated_by_user_id,
        meeting.last_sync_operation_id::text AS last_sync_operation_id,
        meeting.last_sync_attempt_at::text,
        meeting.last_synced_at::text,
        meeting.sync_error,
        meeting.cancelled_at::text,
        meeting.created_at::text,
        meeting.updated_at::text,
        CASE
          WHEN meeting.linked_record_type = 'job'::teams_meeting_link_object_type THEN COALESCE(job.job_number || ' · ' || job.title, job.title)
          WHEN meeting.linked_record_type = 'production_item'::teams_meeting_link_object_type THEN production.title
          WHEN meeting.linked_record_type = 'task'::teams_meeting_link_object_type THEN COALESCE(task_record.task_number || ' · ' || task_record.title, task_record.title)
          WHEN meeting.linked_record_type = 'organization'::teams_meeting_link_object_type THEN organization.display_name
          ELSE location.location_name
        END AS object_label,
        CASE
          WHEN meeting.linked_record_type = 'job'::teams_meeting_link_object_type THEN 'job'
          WHEN meeting.linked_record_type = 'production_item'::teams_meeting_link_object_type THEN 'production'
          WHEN meeting.linked_record_type = 'task'::teams_meeting_link_object_type THEN 'task'
          WHEN meeting.linked_record_type = 'organization'::teams_meeting_link_object_type THEN 'organization'
          ELSE 'location'
        END::text AS permission_entity,
        COALESCE(job.department_type::text, task_job.department_type::text, task_record.department_type::text) AS department_type,
        COALESCE(job.organization_id::text, task_job.organization_id::text, organization.id::text, location.organization_id::text) AS organization_id,
        COALESCE(job.primary_location_id::text, task_job.primary_location_id::text, location.id::text) AS location_id,
        CASE
          WHEN meeting.linked_record_type = 'job'::teams_meeting_link_object_type
            THEN array_remove(ARRAY[job.account_owner_user_id::text, job.created_by_user_id::text], NULL)
          WHEN meeting.linked_record_type = 'production_item'::teams_meeting_link_object_type
            THEN array_remove(ARRAY[job.account_owner_user_id::text, production.created_by_user_id::text], NULL)
          WHEN meeting.linked_record_type = 'task'::teams_meeting_link_object_type
            THEN array_remove(ARRAY[task_job.account_owner_user_id::text, task_record.created_by_user_id::text], NULL)
          WHEN meeting.linked_record_type = 'organization'::teams_meeting_link_object_type
            THEN array_remove(ARRAY[organization.account_owner_user_id::text], NULL)
          ELSE ARRAY[]::text[]
        END AS owner_user_ids,
        CASE
          WHEN meeting.linked_record_type = 'job'::teams_meeting_link_object_type
            THEN COALESCE(
              (
                SELECT array_agg(DISTINCT assignment.user_id::text)
                FROM job_staff_assignments assignment
                WHERE assignment.tenant_id = meeting.tenant_id
                  AND assignment.job_id = meeting.linked_record_id
                  AND assignment.user_id IS NOT NULL
              ),
              ARRAY[]::text[]
            )
          WHEN meeting.linked_record_type = 'production_item'::teams_meeting_link_object_type
            THEN array_remove(ARRAY[production.assigned_to_user_id::text], NULL)
          WHEN meeting.linked_record_type = 'task'::teams_meeting_link_object_type
            THEN COALESCE(
              (
                SELECT array_remove(
                  array_cat(
                    ARRAY[task_record.assigned_to_user_id::text],
                    COALESCE(
                      (
                        SELECT array_agg(DISTINCT assignment.user_id::text)
                        FROM work_task_assignment assignment
                        WHERE assignment.tenant_id = meeting.tenant_id
                          AND assignment.work_task_id = meeting.linked_record_id
                          AND assignment.user_id IS NOT NULL
                      ),
                      ARRAY[]::text[]
                    )
                  ),
                  NULL
                )
              ),
              ARRAY[]::text[]
            )
          ELSE ARRAY[]::text[]
        END AS assigned_user_ids
      FROM teams_meeting_reference meeting
      LEFT JOIN jobs job
        ON meeting.linked_record_type = 'job'::teams_meeting_link_object_type
       AND job.tenant_id = meeting.tenant_id
       AND job.id = meeting.linked_record_id
      LEFT JOIN production_items production
        ON meeting.linked_record_type = 'production_item'::teams_meeting_link_object_type
       AND production.tenant_id = meeting.tenant_id
       AND production.id = meeting.linked_record_id
      LEFT JOIN work_task task_record
        ON meeting.linked_record_type = 'task'::teams_meeting_link_object_type
       AND task_record.tenant_id = meeting.tenant_id
       AND task_record.id = meeting.linked_record_id
      LEFT JOIN jobs task_job
        ON task_job.tenant_id = meeting.tenant_id
       AND task_job.id = task_record.related_job_id
      LEFT JOIN organization
        ON meeting.linked_record_type = 'organization'::teams_meeting_link_object_type
       AND organization.tenant_id = meeting.tenant_id
       AND organization.id = meeting.linked_record_id
      LEFT JOIN shoot_location location
        ON meeting.linked_record_type = 'location'::teams_meeting_link_object_type
       AND location.tenant_id = meeting.tenant_id
       AND location.id = meeting.linked_record_id
      WHERE meeting.tenant_id = $1
        AND meeting.id = $2
      LIMIT 1
    `,
    [tenantId, meetingId]
  );
  return rows[0] ?? null;
}

async function listRecentOperationsForMeeting(client: PoolClient, tenantId: string, meetingId: string) {
  const { rows } = await client.query<MeetingOperationRow>(
    `
      SELECT
        id::text,
        meeting_id::text AS meeting_id,
        operation_type::text AS operation_type,
        trigger_source,
        actor_user_id::text AS actor_user_id,
        status::text AS status,
        app_event_id::text AS app_event_id,
        attempt_count,
        first_attempted_at::text,
        last_attempted_at::text,
        completed_at::text,
        failed_at::text,
        last_error,
        created_at::text,
        updated_at::text
      FROM teams_meeting_sync_operation
      WHERE tenant_id = $1
        AND meeting_id = $2
      ORDER BY created_at DESC
      LIMIT 12
    `,
    [tenantId, meetingId]
  );
  return rows.map(toMeetingOperationRecord);
}

function buildParticipantSnapshot(participants: TeamsMeetingParticipantRecord[], organizer: { userId: string; fullName: string; email: string }) {
  return [
    {
      user_id: organizer.userId,
      full_name: organizer.fullName,
      email: organizer.email,
      role: "organizer" as const
    },
    ...participants
      .filter((participant) => participant.user_id !== organizer.userId && participant.email !== organizer.email)
      .map((participant) => ({ ...participant, role: "attendee" as const }))
  ];
}

function buildOperationThrottleKey(
  meetingId: string,
  operationType: TeamsMeetingSyncOperationType,
  meetingMode: TeamsMeetingMode,
  title: string,
  scheduledStartAt: string,
  scheduledEndAt: string,
  meetingStatus: TeamsMeetingStatus
) {
  const digest = createHash("sha256")
    .update([meetingId, operationType, meetingMode, (title ?? "").trim(), scheduledStartAt, scheduledEndAt, meetingStatus].join("|"))
    .digest("hex");
  return `teams-meeting:${meetingId}:${operationType}:${digest}`;
}

async function queueMeetingSyncOperation(
  client: PoolClient,
  input: {
    tenantId: string;
    meetingId: string;
    actorUserId?: string | null;
    operationType: TeamsMeetingSyncOperationType;
    triggerSource: string;
    requestPayload: Record<string, unknown>;
    throttleKey: string;
  }
) {
  const recent = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM teams_meeting_sync_operation
      WHERE tenant_id = $1
        AND throttle_key = $2
        AND status IN ('queued', 'processing', 'succeeded')
        AND created_at >= now() - ($3::text || ' minutes')::interval
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.tenantId, input.throttleKey, String(config.TEAMS_MEETING_SYNC_THROTTLE_MINUTES)]
  );

  const status = recent.rows[0] ? "throttled" : "queued";
  const insert = await client.query<{ id: string }>(
    `
      INSERT INTO teams_meeting_sync_operation (
        tenant_id,
        meeting_id,
        operation_type,
        trigger_source,
        actor_user_id,
        status,
        throttle_key,
        request_payload
      )
      VALUES ($1,$2,$3::teams_meeting_sync_operation_type,$4,$5,$6::teams_meeting_sync_operation_status,$7,$8::jsonb)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.meetingId,
      input.operationType,
      input.triggerSource,
      input.actorUserId ?? null,
      status,
      input.throttleKey,
      JSON.stringify(input.requestPayload)
    ]
  );
  const operationId = insert.rows[0]?.id;
  if (!operationId) {
    throw new Error("Failed to create Teams meeting sync operation.");
  }

  let appEventId: string | null = null;
  if (status === "queued") {
    const appEvent = await createAppEvent(client, {
      tenantId: input.tenantId,
      eventType: "teams.meeting.sync",
      aggregateType: "teams_meeting_sync_operation",
      aggregateId: operationId,
      dedupeKey: `teams-meeting-sync:${operationId}`,
      payload: {
        operation_id: operationId,
        meeting_id: input.meetingId
      }
    });
    appEventId = String(appEvent.id);
    await client.query(
      `
        UPDATE teams_meeting_sync_operation
        SET app_event_id = $3, updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [input.tenantId, operationId, appEventId]
    );
  }

  await client.query(
    `
      UPDATE teams_meeting_reference
      SET
        last_sync_operation_id = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.meetingId, operationId]
  );

  const { rows } = await client.query<MeetingOperationRow>(
    `
      SELECT
        id::text,
        meeting_id::text AS meeting_id,
        operation_type::text AS operation_type,
        trigger_source,
        actor_user_id::text AS actor_user_id,
        status::text AS status,
        app_event_id::text AS app_event_id,
        attempt_count,
        first_attempted_at::text,
        last_attempted_at::text,
        completed_at::text,
        failed_at::text,
        last_error,
        created_at::text,
        updated_at::text
      FROM teams_meeting_sync_operation
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [input.tenantId, operationId]
  );
  return rows[0] ?? null;
}

function buildQueuedMeetingRequestPayload(record: RecordContext, meeting: TeamsMeetingRecord, operationType: TeamsMeetingSyncOperationType) {
  return {
    linked_record_type: record.objectType,
    linked_record_id: record.objectId,
    linked_record_label: record.objectLabel,
    meeting_mode: meeting.meeting_mode,
    meeting_status: meeting.meeting_status,
    lifecycle_type: meeting.lifecycle_type ?? null,
    record_sync_policy: meeting.record_sync_policy ?? null,
    title: meeting.title,
    description: meeting.description,
    scheduled_start_at: meeting.scheduled_start_at,
    scheduled_end_at: meeting.scheduled_end_at,
    app_deep_link: meeting.app_deep_link,
    participant_snapshot: meeting.participant_snapshot,
    requested_operation_type: operationType
  };
}

async function reloadMeeting(client: PoolClient, tenantId: string, meetingId: string) {
  const row = await loadMeetingById(client, tenantId, meetingId);
  if (!row) {
    throw new Error("Failed to reload Teams meeting.");
  }
  return toMeetingRecord(row);
}

async function saveMeetingState(
  client: PoolClient,
  input: {
    tenantId: string;
    meetingId?: string | null;
    objectType: TeamsMeetingLinkedObjectType;
    objectId: string;
    organizer: Awaited<ReturnType<typeof assertCommunicationIdentityReady>>;
    meetingMode: TeamsMeetingMode;
    lifecycleType: TeamsMeetingLifecycleType;
    recordSyncPolicy: TeamsMeetingRecordSyncPolicy;
    title: string;
    description: string | null;
    scheduledStartAt: string;
    scheduledEndAt: string;
    appDeepLink: string | null;
    participantSnapshot: TeamsMeetingParticipantRecord[];
    actorUserId: string;
    nextStatus: TeamsMeetingStatus;
  }
) {
  if (input.meetingId) {
    await client.query(
      `
        UPDATE teams_meeting_reference
        SET
          meeting_mode = $3::teams_meeting_mode,
          meeting_status = $4::teams_meeting_status,
          title = $5,
          description = $6,
          organizer_user_id = $7,
          organizer_email = $8,
          organizer_microsoft_user_id = $9,
          participant_snapshot = $10::jsonb,
          app_deep_link = $11,
          scheduled_start_at = $12,
          scheduled_end_at = $13,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('meeting_lifecycle_type', $14, 'record_sync_policy', $15),
          updated_by_user_id = $16,
          sync_error = NULL,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        input.tenantId,
        input.meetingId,
        input.meetingMode,
        input.nextStatus,
        input.title,
        input.description,
        input.organizer.userId,
        input.organizer.email,
        input.organizer.communicationIdentity.microsoftUserId,
        JSON.stringify(input.participantSnapshot),
        input.appDeepLink,
        input.scheduledStartAt,
        input.scheduledEndAt,
        input.lifecycleType,
        input.recordSyncPolicy,
        input.actorUserId
      ]
    );
    return input.meetingId;
  }

  const insert = await client.query<{ id: string }>(
    `
      INSERT INTO teams_meeting_reference (
        tenant_id,
        linked_record_type,
        linked_record_id,
        meeting_provider,
        meeting_mode,
        meeting_status,
        title,
        description,
        organizer_user_id,
        organizer_email,
        organizer_microsoft_user_id,
        participant_snapshot,
        app_deep_link,
        scheduled_start_at,
        scheduled_end_at,
        metadata,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2::teams_meeting_link_object_type,$3,'microsoft_teams',$4::teams_meeting_mode,$5::teams_meeting_status,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16,$16)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.objectType,
      input.objectId,
      input.meetingMode,
      input.nextStatus,
      input.title,
      input.description,
      input.organizer.userId,
      input.organizer.email,
      input.organizer.communicationIdentity.microsoftUserId,
      JSON.stringify(input.participantSnapshot),
      input.appDeepLink,
      input.scheduledStartAt,
      input.scheduledEndAt,
      JSON.stringify({
        meeting_lifecycle_type: input.lifecycleType,
        record_sync_policy: input.recordSyncPolicy
      }),
      input.actorUserId
    ]
  );
  return insert.rows[0]?.id ?? null;
}

export async function getTeamsMeetingRecordView(
  client: PoolClient,
  auth: AuthUser,
  input: { objectType: TeamsMeetingLinkedObjectType; objectId: string }
): Promise<TeamsMeetingRecordView> {
  let record: RecordContext | null = null;
  try {
    record = await resolveRecordContext(client, auth, input.objectType, input.objectId);
    assertRecordVisible(auth, record);
    const governance = evaluateCommunicationGovernance(auth, {
      objectType: record.objectType,
      objectId: record.objectId,
      objectLabel: record.objectLabel,
      policyContext: buildPolicyContext(record)
    });
    if (!governance.permissions.can_use && !governance.permissions.can_manage_meetings) {
      throw new ApiError(403, "Forbidden");
    }

    const schemaReady = await hasTeamsMeetingsSchema(client);
    if (!schemaReady) {
      return {
        object_type: record.objectType,
        object_id: record.objectId,
        object_label: record.objectLabel,
        module: governance.module,
        feature_enabled: false,
        permissions: {
          can_use: governance.permissions.can_use,
          can_manage: governance.permissions.can_manage_meetings,
          can_create: governance.permissions.can_create_meetings,
          can_view_history: governance.permissions.can_view_history
        },
        defaults: record.defaults,
        meeting: null,
        recent_operations: []
      };
    }

    const meetingRow = await loadMeetingForRecord(client, auth.tenantId, input.objectType, input.objectId);
    const operations = meetingRow ? await listRecentOperationsForMeeting(client, auth.tenantId, meetingRow.id) : [];

    return {
      object_type: record.objectType,
      object_id: record.objectId,
      object_label: record.objectLabel,
      module: governance.module,
      feature_enabled: isTeamsMeetingsConfigured(),
      permissions: {
        can_use: governance.permissions.can_use,
        can_manage: governance.permissions.can_manage_meetings,
        can_create: governance.permissions.can_create_meetings,
        can_view_history: governance.permissions.can_view_history
      },
      defaults: record.defaults,
      meeting: meetingRow ? toMeetingRecord(meetingRow) : null,
      recent_operations: operations
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.meeting_view.load_failed",
      resourceType: input.objectType,
      resourceId: input.objectId,
      area: "in_app_actions",
      action: "load_meeting_view",
      error,
      context: {
        object_type: input.objectType,
        object_id: input.objectId,
        record_label: record?.objectLabel ?? null
      }
    });
    throw error;
  }
}

export async function upsertTeamsMeetingForRecord(
  client: PoolClient,
  auth: AuthUser,
  input: UpsertTeamsMeetingInput,
  requestMeta: RequestMeta = {}
): Promise<TeamsMeetingRecord> {
  let record: RecordContext | null = null;
  let meetingId: string | null = null;
  try {
    record = await resolveRecordContext(client, auth, input.object_type, input.object_id);
    assertRecordVisible(auth, record);
    if (!canUseMeetingOnRecord(auth, record) || !canManageMeetingOnRecord(auth, record)) {
      throw new ApiError(403, "Forbidden");
    }
    if (!(await hasTeamsMeetingsSchema(client))) {
      throw new ApiError(503, "Teams meetings data model is not available in this environment.");
    }
    if (!isTeamsMeetingsConfigured()) {
      throw new ApiError(409, "Teams meetings are not enabled in this environment.");
    }

    const organizer = await assertCommunicationIdentityReady(client, auth.tenantId, auth.id, {
      label: "Meeting organizer"
    });
    const existing = await loadMeetingForRecord(client, auth.tenantId, input.object_type, input.object_id);
    const existingLifecycle = existing ? resolveMeetingLifecycle(existing.linked_record_type, existing.meeting_mode, existing.metadata) : null;
    const lifecycleType =
      input.lifecycle_type ??
      existingLifecycle?.lifecycleType ??
      record.defaults.default_lifecycle_type ??
      getDefaultLifecycleType(input.object_type);

    if (!listAllowedLifecycleTypes(input.object_type).includes(lifecycleType) && lifecycleType !== "ad_hoc_call") {
      throw new ApiError(400, "That meeting purpose is not supported for this record.");
    }

    const recordSyncPolicy = deriveRecordSyncPolicy(input.object_type, lifecycleType);
    const meetingMode =
      (lifecycleType === "ad_hoc_call" ? "standalone_online_meeting" : null) ??
      input.meeting_mode ??
      (await getCommunicationMeetingDefaultMode(client, auth, {
        department: toDepartmentCode(record.policyContext.departmentType)
      }));
    const title = normalizeText(input.title) ?? record.defaults.suggested_title;
    const description = normalizeText(input.description) ?? record.defaults.suggested_description;
    const scheduledStartAt = normalizeDateTime(input.scheduled_start_at ?? record.defaults.scheduled_start_at);
    const scheduledEndAt = normalizeDateTime(input.scheduled_end_at ?? record.defaults.scheduled_end_at);

    if (!scheduledStartAt || !scheduledEndAt) {
      throw new ApiError(400, "A linked Teams meeting needs a scheduled start and end time.");
    }
    if (new Date(scheduledEndAt).getTime() <= new Date(scheduledStartAt).getTime()) {
      throw new ApiError(400, "Meeting end time must be later than the start time.");
    }

    const nextStatus: TeamsMeetingStatus =
      existing && (existing.external_calendar_event_id || existing.external_meeting_id || existing.meeting_status === "scheduled")
        ? "pending_update"
        : "pending_create";
    const participantSnapshot = buildParticipantSnapshot(record.defaults.suggested_participants, {
      userId: organizer.userId,
      fullName: organizer.fullName,
      email: organizer.email
    });

    meetingId = await saveMeetingState(client, {
      tenantId: auth.tenantId,
      meetingId: existing?.id ?? null,
      objectType: input.object_type,
      objectId: input.object_id,
      organizer,
      meetingMode,
      lifecycleType,
      recordSyncPolicy,
      title,
      description,
      scheduledStartAt,
      scheduledEndAt,
      appDeepLink: record.defaults.app_deep_link,
      participantSnapshot,
      actorUserId: auth.id,
      nextStatus
    });
    if (!meetingId) {
      throw new Error("Failed to create Teams meeting reference.");
    }

    const meeting = await reloadMeeting(client, auth.tenantId, meetingId);
    const operationType: TeamsMeetingSyncOperationType = existing ? "update" : "create";
    const throttleKey = buildOperationThrottleKey(
      meeting.id,
      operationType,
      meeting.meeting_mode,
      meeting.title,
      meeting.scheduled_start_at,
      meeting.scheduled_end_at,
      meeting.meeting_status
    );
    const operation = await queueMeetingSyncOperation(client, {
      tenantId: auth.tenantId,
      meetingId: meeting.id,
      actorUserId: auth.id,
      operationType,
      triggerSource: existing ? "manual_update" : "manual_create",
      requestPayload: buildQueuedMeetingRequestPayload(record, meeting, operationType),
      throttleKey
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: existing ? "communication.teams_meeting.update_queued" : "communication.teams_meeting.create_queued",
      entityType: "teams_meeting_reference",
      entityId: meeting.id,
      metadata: {
        linked_record_type: input.object_type,
        linked_record_id: input.object_id,
        operation_id: operation?.id ?? null,
        meeting_mode: meeting.meeting_mode,
        lifecycle_type: meeting.lifecycle_type ?? lifecycleType,
        record_sync_policy: meeting.record_sync_policy ?? recordSyncPolicy
      },
      newValues: {
        title: meeting.title,
        scheduled_start_at: meeting.scheduled_start_at,
        scheduled_end_at: meeting.scheduled_end_at,
        meeting_status: meeting.meeting_status
      },
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: existing ? "communication.teams_meeting.update_queued" : "communication.teams_meeting.create_queued",
      resourceType: "teams_meeting_reference",
      resourceId: meeting.id,
      result: "queued",
      context: {
        linked_record_type: input.object_type,
        linked_record_id: input.object_id,
        operation_id: operation?.id ?? null,
        meeting_mode: meeting.meeting_mode,
        lifecycle_type: meeting.lifecycle_type ?? lifecycleType,
        record_sync_policy: meeting.record_sync_policy ?? recordSyncPolicy
      },
      newValues: {
        title: meeting.title,
        scheduled_start_at: meeting.scheduled_start_at,
        scheduled_end_at: meeting.scheduled_end_at,
        meeting_status: meeting.meeting_status
      }
    });

    return meeting;
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_meeting.upsert_failed",
      resourceType: "teams_meeting_reference",
      resourceId: meetingId ?? input.object_id,
      area: "teams_meetings",
      action: "upsert_meeting",
      error,
      context: {
        object_type: input.object_type,
        object_id: input.object_id,
        record_label: record?.objectLabel ?? null,
        source_surface: requestMeta.sourceSurface ?? "communications"
      }
    });
    throw error;
  }
}

export async function cancelTeamsMeeting(
  client: PoolClient,
  auth: AuthUser,
  input: CancelTeamsMeetingInput,
  requestMeta: RequestMeta = {}
): Promise<TeamsMeetingRecord> {
  let meetingLookup: MeetingLookupRow | null = null;
  let record: RecordContext | null = null;
  try {
    if (!(await hasTeamsMeetingsSchema(client))) {
      throw new ApiError(503, "Teams meetings data model is not available in this environment.");
    }
    meetingLookup = await loadMeetingById(client, auth.tenantId, input.meeting_id);
    if (!meetingLookup) {
      throw new ApiError(404, "Teams meeting not found.");
    }

    record = {
      objectType: meetingLookup.linked_record_type,
      objectId: meetingLookup.linked_record_id,
      objectLabel: meetingLookup.object_label,
      permissionEntity: meetingLookup.permission_entity,
      policyContext: {
        departmentType: meetingLookup.department_type,
        organizationId: meetingLookup.organization_id,
        locationId: meetingLookup.location_id,
        ownerUserIds: meetingLookup.owner_user_ids ?? [],
        assignedUserIds: meetingLookup.assigned_user_ids ?? []
      },
      defaults: {
        suggested_title: meetingLookup.title,
        suggested_description: meetingLookup.description,
        scheduled_start_at: meetingLookup.scheduled_start_at,
        scheduled_end_at: meetingLookup.scheduled_end_at,
        app_deep_link: meetingLookup.app_deep_link,
        suggested_participants: Array.isArray(meetingLookup.participant_snapshot) ? meetingLookup.participant_snapshot : [],
        default_lifecycle_type: resolveMeetingLifecycle(
          meetingLookup.linked_record_type,
          meetingLookup.meeting_mode,
          meetingLookup.metadata
        ).lifecycleType,
        allowed_lifecycle_types: listAllowedLifecycleTypes(meetingLookup.linked_record_type),
        schedule_guidance: buildScheduleGuidance(meetingLookup.linked_record_type)
      }
    };
    assertRecordVisible(auth, record);
    if (!canUseMeetingOnRecord(auth, record) || !canManageMeetingOnRecord(auth, record)) {
      throw new ApiError(403, "Forbidden");
    }

    if (meetingLookup.cancelled_at || meetingLookup.meeting_status === "cancelled") {
      return toMeetingRecord(meetingLookup);
    }

    await client.query(
      `
        UPDATE teams_meeting_reference
        SET
          meeting_status = 'pending_cancel'::teams_meeting_status,
          updated_by_user_id = $3,
          sync_error = NULL,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', $4),
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, input.meeting_id, auth.id, normalizeText(input.reason)]
    );

    const meeting = await reloadMeeting(client, auth.tenantId, input.meeting_id);
    const throttleKey = buildOperationThrottleKey(
      meeting.id,
      "cancel",
      meeting.meeting_mode,
      meeting.title,
      meeting.scheduled_start_at,
      meeting.scheduled_end_at,
      meeting.meeting_status
    );
    const operation = await queueMeetingSyncOperation(client, {
      tenantId: auth.tenantId,
      meetingId: meeting.id,
      actorUserId: auth.id,
      operationType: "cancel",
      triggerSource: "manual_cancel",
      requestPayload: {
        ...buildQueuedMeetingRequestPayload(record, meeting, "cancel"),
        reason: normalizeText(input.reason)
      },
      throttleKey
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "communication.teams_meeting.cancel_queued",
      entityType: "teams_meeting_reference",
      entityId: meeting.id,
      metadata: {
        linked_record_type: meeting.linked_record_type,
        linked_record_id: meeting.linked_record_id,
        operation_id: operation?.id ?? null
      },
      newValues: {
        meeting_status: meeting.meeting_status,
        cancel_reason: normalizeText(input.reason)
      },
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_meeting.cancel_queued",
      resourceType: "teams_meeting_reference",
      resourceId: meeting.id,
      result: "queued",
      context: {
        linked_record_type: meeting.linked_record_type,
        linked_record_id: meeting.linked_record_id,
        operation_id: operation?.id ?? null
      },
      newValues: {
        meeting_status: meeting.meeting_status,
        cancel_reason: normalizeText(input.reason)
      }
    });

    return meeting;
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_meeting.cancel_failed",
      resourceType: "teams_meeting_reference",
      resourceId: input.meeting_id,
      area: "teams_meetings",
      action: "cancel_meeting",
      error,
      context: {
        object_type: record?.objectType ?? meetingLookup?.linked_record_type ?? null,
        object_id: record?.objectId ?? meetingLookup?.linked_record_id ?? null,
        record_label: record?.objectLabel ?? meetingLookup?.object_label ?? null,
        source_surface: requestMeta.sourceSurface ?? "communications"
      }
    });
    throw error;
  }
}

async function queueTeamsMeetingRecordLifecycleSync(
  client: PoolClient,
  auth: AuthUser,
  input: {
    objectType: "job" | "task";
    objectId: string;
    mode: "update" | "cancel";
  }
) {
  if (!isTeamsMeetingsConfigured()) {
    return null;
  }
  if (!(await hasTeamsMeetingsSchema(client))) {
    return null;
  }

  const existing = await loadMeetingForRecord(client, auth.tenantId, input.objectType, input.objectId);
  if (!existing) {
    return null;
  }
  if (existing.cancelled_at || existing.meeting_status === "cancelled" || existing.meeting_status === "pending_cancel") {
    return toMeetingRecord(existing);
  }

  try {
    const record = await resolveRecordContext(client, auth, input.objectType, input.objectId);
    const lifecycle = resolveMeetingLifecycle(existing.linked_record_type, existing.meeting_mode, existing.metadata);

    if (input.mode === "cancel") {
      await client.query(
        `
          UPDATE teams_meeting_reference
          SET
            meeting_status = 'pending_cancel'::teams_meeting_status,
            sync_error = NULL,
            updated_by_user_id = $3,
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [auth.tenantId, existing.id, auth.id]
      );
      const meeting = await reloadMeeting(client, auth.tenantId, existing.id);
      await queueMeetingSyncOperation(client, {
        tenantId: auth.tenantId,
        meetingId: meeting.id,
        actorUserId: auth.id,
        operationType: "cancel",
        triggerSource: "record_lifecycle_cancel",
        requestPayload: buildQueuedMeetingRequestPayload(record, meeting, "cancel"),
        throttleKey: buildOperationThrottleKey(
          meeting.id,
          "cancel",
          meeting.meeting_mode,
          meeting.title,
          meeting.scheduled_start_at,
          meeting.scheduled_end_at,
          meeting.meeting_status
        )
      });
      return meeting;
    }

    if (lifecycle.recordSyncPolicy !== "follow_record_schedule") {
      return toMeetingRecord(existing);
    }

    const organizer = await assertCommunicationIdentityReady(client, auth.tenantId, auth.id, {
      label: "Meeting organizer"
    }).catch(async () => {
      if (!existing.organizer_user_id) {
        throw new ApiError(409, "The linked meeting no longer has a valid organizer for Teams sync.");
      }
      return assertCommunicationIdentityReady(client, auth.tenantId, existing.organizer_user_id, {
        label: "Meeting organizer"
      });
    });

    const scheduledStartAt = normalizeDateTime(record.defaults.scheduled_start_at);
    const scheduledEndAt = normalizeDateTime(record.defaults.scheduled_end_at);
    if (!scheduledStartAt || !scheduledEndAt) {
      await client.query(
        `
          UPDATE teams_meeting_reference
          SET
            meeting_status = 'sync_error'::teams_meeting_status,
            sync_error = 'Linked record no longer has a valid schedule for Teams meeting sync.',
            updated_by_user_id = $3,
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [auth.tenantId, existing.id, auth.id]
      );
      return reloadMeeting(client, auth.tenantId, existing.id);
    }

    const participantSnapshot = buildParticipantSnapshot(record.defaults.suggested_participants, {
      userId: organizer.userId,
      fullName: organizer.fullName,
      email: organizer.email
    });

    await client.query(
      `
        UPDATE teams_meeting_reference
        SET
          scheduled_start_at = $3,
          scheduled_end_at = $4,
          participant_snapshot = $5::jsonb,
          app_deep_link = $6,
          organizer_user_id = $7,
          organizer_email = $8,
          organizer_microsoft_user_id = $9,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('meeting_lifecycle_type', $10, 'record_sync_policy', $11),
          meeting_status = 'pending_update'::teams_meeting_status,
          sync_error = NULL,
          updated_by_user_id = $12,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        existing.id,
        scheduledStartAt,
        scheduledEndAt,
        JSON.stringify(participantSnapshot),
        record.defaults.app_deep_link,
        organizer.userId,
        organizer.email,
        organizer.communicationIdentity.microsoftUserId,
        lifecycle.lifecycleType,
        lifecycle.recordSyncPolicy,
        auth.id
      ]
    );

    const meeting = await reloadMeeting(client, auth.tenantId, existing.id);
    await queueMeetingSyncOperation(client, {
      tenantId: auth.tenantId,
      meetingId: meeting.id,
      actorUserId: auth.id,
      operationType: "update",
      triggerSource: "record_change",
      requestPayload: buildQueuedMeetingRequestPayload(record, meeting, "update"),
      throttleKey: buildOperationThrottleKey(
        meeting.id,
        "update",
        meeting.meeting_mode,
        meeting.title,
        meeting.scheduled_start_at,
        meeting.scheduled_end_at,
        meeting.meeting_status
      )
    });
    return meeting;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Teams meeting sync failure.";
    await client.query(
      `
        UPDATE teams_meeting_reference
        SET
          meeting_status = 'sync_error'::teams_meeting_status,
          sync_error = $3,
          updated_by_user_id = $4,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, existing.id, message, auth.id]
    );
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "communication.teams_meeting.record_sync_failed",
      entityType: "teams_meeting_reference",
      entityId: existing.id,
      metadata: {
        linked_record_type: input.objectType,
        linked_record_id: input.objectId,
        lifecycle_mode: input.mode,
        error: message
      },
      sourceSurface: input.objectType === "task" ? "task_service" : "job_service"
    });
    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_meeting.record_sync_failed",
      resourceType: "teams_meeting_reference",
      resourceId: existing.id,
      result: "failed",
      context: {
        linked_record_type: input.objectType,
        linked_record_id: input.objectId,
        lifecycle_mode: input.mode,
        error: message
      }
    });
    return reloadMeeting(client, auth.tenantId, existing.id);
  }
}

export async function queueTeamsMeetingJobRecordLifecycleSync(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  mode: "update" | "cancel"
) {
  return queueTeamsMeetingRecordLifecycleSync(client, auth, {
    objectType: "job",
    objectId: jobId,
    mode
  });
}

export async function queueTeamsMeetingTaskRecordLifecycleSync(
  client: PoolClient,
  auth: AuthUser,
  taskId: string,
  mode: "update" | "cancel"
) {
  return queueTeamsMeetingRecordLifecycleSync(client, auth, {
    objectType: "task",
    objectId: taskId,
    mode
  });
}
