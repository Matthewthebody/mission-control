import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { TeamsEmbeddedCommunicationEntry, TeamsEmbeddedCommunicationHub, TeamsEmbeddedCommunicationObjectType } from "../types/teamsEmbeddedCommunications.js";
import { getTeamsEmbeddedCommunicationsDefaultsConfiguration } from "./adminConfiguration.js";
import { captureCommunicationFailure } from "./communicationObservability.js";
import {
  canConfigureCommunicationDestinations,
  canManageCommunicationMeetings,
  canSendCommunicationMessages,
  canSendProactiveCommunications,
  canViewCommunicationHistory,
  canUseCommunicationActions
} from "./communicationGovernance.js";
import { getTeamsMeetingRecordView } from "./teamsMeetings.js";
import { getTeamsCommunicationRecordView } from "./teamsMessaging.js";

type JobCandidateRow = {
  id: string;
  title: string;
  job_number: string | null;
  department_type: string;
  organization_label: string | null;
  location_label: string | null;
  scheduled_start_at: string | null;
};

type TaskCandidateRow = {
  id: string;
  title: string;
  task_number: string | null;
  department_type: string;
  organization_label: string | null;
  location_label: string | null;
  due_at: string | null;
};

type Candidate = {
  object_type: TeamsEmbeddedCommunicationObjectType;
  object_id: string;
  object_label: string;
  record_kind_label: string;
  route_hash: string;
  department_type: string | null;
  organization_label: string | null;
  location_label: string | null;
  scheduled_start_at: string | null;
  due_at: string | null;
  sort_at: string | null;
};

function buildJobRouteHash(departmentType: string | null | undefined, jobId: string) {
  if (departmentType === "schools") {
    return `#schools/shoots/${jobId}`;
  }
  if (departmentType === "sports") {
    return `#sports/shoots/${jobId}`;
  }
  return `#jobs/${jobId}`;
}

function buildTaskRouteHash(taskId: string) {
  return `#tasks/${taskId}`;
}

function compareCandidates(left: Candidate, right: Candidate) {
  const leftTime = left.sort_at ? new Date(left.sort_at).getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right.sort_at ? new Date(right.sort_at).getTime() : Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.object_label.localeCompare(right.object_label);
}

function countUrgentAlerts(entry: TeamsEmbeddedCommunicationEntry) {
  let count = 0;
  const latestDelivery = entry.communication.recent_deliveries[0] ?? null;

  if (entry.meeting.meeting?.sync_error) {
    count += 1;
  }
  if (latestDelivery?.status === "failed") {
    count += 1;
  }
  if (!entry.communication.references.length && (entry.communication.permissions.can_send || entry.communication.permissions.can_configure)) {
    count += 1;
  }

  return count;
}

function pickEntryLatestActivityAt<T extends Pick<TeamsEmbeddedCommunicationEntry, "communication" | "meeting" | "scheduled_start_at" | "due_at">>(
  entry: T
) {
  return (
    entry.communication.recent_deliveries[0]?.updated_at ??
    entry.meeting.recent_operations[0]?.updated_at ??
    entry.meeting.meeting?.updated_at ??
    entry.scheduled_start_at ??
    entry.due_at ??
    null
  );
}

function buildAvailability(auth: AuthUser, permissions: TeamsEmbeddedCommunicationHub["permissions"]): TeamsEmbeddedCommunicationHub["availability"] {
  if (!config.MICROSOFT_TEAMS_EMBEDDED_COMMUNICATIONS_ENABLED) {
    return {
      state: "limited",
      title: "Communications is turned off here",
      detail: "The Communications surface is currently disabled in this environment.",
      fix_hint: "Enable the embedded communications feature flag when rollout is ready."
    };
  }

  if (!auth.communicationIdentity || auth.communicationIdentity.status === "unlinked" || auth.communicationIdentity.status === "incomplete") {
    return {
      state: "setup_required",
      title: "Finish Microsoft communication setup",
      detail: "You can open the Communications workspace now, but Microsoft-linked send and meeting actions stay locked until your communication identity is fully linked.",
      fix_hint: "Open My Account or Access Control to finish Microsoft linking and verification."
    };
  }

  if (auth.communicationIdentity.status === "disabled" || !auth.communicationIdentity.communicationEnabled) {
    return {
      state: "revoked",
      title: "Communication access is currently disabled",
      detail: "An administrator has disabled your Microsoft communication access for now.",
      fix_hint: "Contact an Admin or Communications Moderator if this needs to be restored."
    };
  }

  if (!permissions.can_use && !permissions.can_send && !permissions.can_manage_meetings && !permissions.can_configure) {
    return {
      state: "limited",
      title: "Communications is available with limited actions",
      detail: "You can review urgent communication state and jump into linked work, but send, meeting, and destination controls are restricted for your current role.",
      fix_hint: "Use the full record workflow or ask an Admin if your role should carry extra communication capabilities."
    };
  }

  if (!auth.communicationIdentity.canPost) {
    return {
      state: "limited",
      title: "Posting is temporarily limited",
      detail: auth.communicationIdentity.postingDisabledReason
        ? `Your communication posting ability is paused: ${auth.communicationIdentity.postingDisabledReason}`
        : "Your communication posting ability is temporarily paused.",
      fix_hint: "An Admin or Communications Moderator can restore posting when appropriate."
    };
  }

  return {
    state: "ready",
    title: "Communications is ready",
    detail: "Record-linked messaging, meetings, and urgent communication actions are available where your role allows them.",
    fix_hint: null
  };
}

async function listAssignedJobCandidates(client: PoolClient, auth: AuthUser, limit: number) {
  const { rows } = await client.query<JobCandidateRow>(
    `
      SELECT DISTINCT
        job.id::text,
        job.title,
        job.job_number,
        job.department_type::text AS department_type,
        organization.display_name AS organization_label,
        location.location_name AS location_label,
        job.scheduled_start_at::text AS scheduled_start_at
      FROM job_staff_assignments assignment
      JOIN jobs job
        ON job.tenant_id = assignment.tenant_id
       AND job.id = assignment.job_id
      LEFT JOIN organization
        ON organization.tenant_id = job.tenant_id
       AND organization.id = job.organization_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = job.tenant_id
       AND location.id = job.primary_location_id
      WHERE assignment.tenant_id = $1
        AND assignment.user_id = $2
      ORDER BY
        CASE WHEN job.scheduled_start_at IS NULL THEN 1 ELSE 0 END,
        job.scheduled_start_at ASC NULLS LAST,
        job.updated_at DESC
      LIMIT $3
    `,
    [auth.tenantId, auth.id, limit]
  );

  return rows.map<Candidate>((row) => ({
    object_type: "job",
    object_id: row.id,
    object_label: row.job_number ? `${row.job_number} - ${row.title}` : row.title,
    record_kind_label: "Assigned job",
    route_hash: buildJobRouteHash(row.department_type, row.id),
    department_type: row.department_type,
    organization_label: row.organization_label,
    location_label: row.location_label,
    scheduled_start_at: row.scheduled_start_at,
    due_at: null,
    sort_at: row.scheduled_start_at
  }));
}

async function listAssignedTaskCandidates(client: PoolClient, auth: AuthUser, limit: number) {
  const { rows } = await client.query<TaskCandidateRow>(
    `
      SELECT
        task.id::text,
        task.title,
        task.task_number,
        task.department_type::text AS department_type,
        organization.display_name AS organization_label,
        location.location_name AS location_label,
        task.due_at::text AS due_at
      FROM work_task task
      LEFT JOIN jobs job
        ON job.tenant_id = task.tenant_id
       AND job.id = task.related_job_id
      LEFT JOIN organization
        ON organization.tenant_id = task.tenant_id
       AND organization.id = job.organization_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = task.tenant_id
       AND location.id = job.primary_location_id
      WHERE task.tenant_id = $1
        AND (
          task.assigned_to_user_id = $2
          OR EXISTS (
            SELECT 1
            FROM work_task_assignment assignment
            WHERE assignment.tenant_id = task.tenant_id
              AND assignment.work_task_id = task.id
              AND assignment.user_id = $2
          )
        )
        AND task.status NOT IN ('completed'::work_task_status_type, 'cancelled'::work_task_status_type)
      ORDER BY
        CASE WHEN task.due_at IS NULL THEN 1 ELSE 0 END,
        task.due_at ASC NULLS LAST,
        task.updated_at DESC
      LIMIT $3
    `,
    [auth.tenantId, auth.id, limit]
  );

  return rows.map<Candidate>((row) => ({
    object_type: "task",
    object_id: row.id,
    object_label: row.task_number ? `${row.task_number} - ${row.title}` : row.title,
    record_kind_label: "Assigned task",
    route_hash: buildTaskRouteHash(row.id),
    department_type: row.department_type,
    organization_label: row.organization_label,
    location_label: row.location_label,
    scheduled_start_at: null,
    due_at: row.due_at,
    sort_at: row.due_at
  }));
}

function buildFallbackCommunicationView(candidate: Candidate) {
  return {
    object_type: candidate.object_type,
    object_id: candidate.object_id,
    object_label: candidate.object_label,
    permissions: {
      can_use: false,
      can_send: false,
      can_configure: false,
      can_view_history: false,
      can_send_proactive: false,
      can_message_chats: false,
      can_message_channels: false,
      can_message_assigned_staff: false
    },
    feature_enabled: Boolean(config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED),
    references: [],
    recent_deliveries: []
  };
}

function buildFallbackMeetingView(candidate: Candidate) {
  return {
    object_type: candidate.object_type,
    object_id: candidate.object_id,
    object_label: candidate.object_label,
    feature_enabled: Boolean(config.MICROSOFT_TEAMS_MEETINGS_ENABLED),
    permissions: {
      can_use: false,
      can_manage: false,
      can_create: false,
      can_view_history: false
    },
    defaults: {
      suggested_title: `${candidate.object_label} Internal Teams Meeting`,
      suggested_description: null,
      scheduled_start_at: candidate.scheduled_start_at,
      scheduled_end_at: candidate.scheduled_start_at,
      app_deep_link: candidate.route_hash,
      suggested_participants: []
    },
    meeting: null,
    recent_operations: []
  };
}

async function buildEntry(client: PoolClient, auth: AuthUser, candidate: Candidate): Promise<TeamsEmbeddedCommunicationEntry> {
  const [communication, meeting] = await Promise.all([
    getTeamsCommunicationRecordView(client, auth, {
      objectType: candidate.object_type,
      objectId: candidate.object_id
    }).catch((error) => {
      if (error instanceof ApiError && error.status === 403) {
        return buildFallbackCommunicationView(candidate);
      }
      throw error;
    }),
    getTeamsMeetingRecordView(client, auth, {
      objectType: candidate.object_type,
      objectId: candidate.object_id
    }).catch((error) => {
      if (error instanceof ApiError && error.status === 403) {
        return buildFallbackMeetingView(candidate);
      }
      throw error;
    })
  ]);

  return {
    object_type: candidate.object_type,
    object_id: candidate.object_id,
    object_label: candidate.object_label,
    record_kind_label: candidate.record_kind_label,
    route_hash: candidate.route_hash,
    department_type: candidate.department_type,
    organization_label: candidate.organization_label,
    location_label: candidate.location_label,
    scheduled_start_at: candidate.scheduled_start_at,
    due_at: candidate.due_at,
    latest_activity_at: pickEntryLatestActivityAt({
      object_type: candidate.object_type,
      object_id: candidate.object_id,
      object_label: candidate.object_label,
      record_kind_label: candidate.record_kind_label,
      route_hash: candidate.route_hash,
      department_type: candidate.department_type,
      organization_label: candidate.organization_label,
      location_label: candidate.location_label,
      scheduled_start_at: candidate.scheduled_start_at,
      due_at: candidate.due_at,
      communication,
      meeting
    }),
    communication,
    meeting
  };
}

export async function getTeamsEmbeddedCommunicationHub(client: PoolClient, auth: AuthUser): Promise<TeamsEmbeddedCommunicationHub> {
  try {
    const permissions = {
      can_use: canUseCommunicationActions(auth),
      can_send: canSendCommunicationMessages(auth),
      can_manage_meetings: canManageCommunicationMeetings(auth),
      can_configure: canConfigureCommunicationDestinations(auth),
      can_view_history: canViewCommunicationHistory(auth),
      can_send_proactive: canSendProactiveCommunications(auth)
    };

    const defaults = await getTeamsEmbeddedCommunicationsDefaultsConfiguration(client, auth);

    const [jobCandidates, taskCandidates] = await Promise.all([
      listAssignedJobCandidates(client, auth, defaults.max_assigned_jobs),
      listAssignedTaskCandidates(client, auth, defaults.max_assigned_tasks)
    ]);

    const candidates = [...jobCandidates, ...taskCandidates].sort(compareCandidates).slice(0, defaults.max_entries);
    const entries = await Promise.all(candidates.map((candidate) => buildEntry(client, auth, candidate)));
    const latestActivityAt =
      entries
        .map((entry) => entry.latest_activity_at)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

    return {
      generated_at: new Date().toISOString(),
      feature_flags: {
        personal_app_enabled: config.MICROSOFT_TEAMS_PERSONAL_APP_ENABLED,
        messaging_enabled: config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED,
        meetings_enabled: config.MICROSOFT_TEAMS_MEETINGS_ENABLED
      },
      communication_identity_status: auth.communicationIdentity?.status ?? "unlinked",
      availability: buildAvailability(auth, permissions),
      permissions,
      summary: {
        action_records: entries.length,
        active_meetings: entries.filter((entry) => Boolean(entry.meeting.meeting)).length,
        urgent_alerts: entries.reduce((total, entry) => total + countUrgentAlerts(entry), 0),
        missing_destinations: entries.filter((entry) => entry.communication.references.length === 0).length,
        latest_activity_at: latestActivityAt
      },
      entries
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.embedded_hub.load_failed",
      resourceType: "teams_embedded_communications",
      resourceId: auth.id,
      area: "teams_embedded_entry_points",
      action: "load_embedded_hub",
      error,
      context: {
        communication_identity_status: auth.communicationIdentity?.status ?? "unlinked"
      }
    });
    throw error;
  }
}
