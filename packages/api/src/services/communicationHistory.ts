import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type {
  CommunicationHistoryEntry,
  CommunicationHistoryLatestSummary,
  CommunicationHistoryRecordView
} from "../types/communicationHistory.js";
import type { AuthUser } from "../types/auth.js";
import type { TeamsCommunicationLinkedObjectType } from "../types/teamsMessaging.js";
import { hasCommunicationModerationRights } from "./appAuthorization.js";
import { evaluateCommunicationGovernance } from "./communicationGovernance.js";
import { resolveCommunicationRecordContext, type CommunicationRecordContext } from "./communicationRecords.js";
import { canViewRecords } from "./policy/operationalAuthorization.js";

type DestinationHistoryRow = {
  id: string;
  target_reference_id: string;
  target_type: "chat" | "channel";
  target_id: string | null;
  target_label: string;
  target_url: string;
  actor_user_id: string | null;
  actor_name: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

type MessageHistoryRow = {
  id: string;
  target_reference_id: string;
  target_type: "chat" | "channel";
  target_id: string | null;
  target_label: string;
  target_url: string;
  actor_user_id: string | null;
  actor_name: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "throttled";
  visibility_status: "visible" | "moderated_hidden";
  moderated_at: string | null;
  moderated_by_user_id: string | null;
  moderation_reason: string | null;
  message_text: string;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type MeetingHistoryRow = {
  id: string;
  target_reference_id: string;
  target_id: string | null;
  target_label: string;
  target_url: string | null;
  join_url: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  operation_type: "create" | "update" | "cancel";
  status: "queued" | "processing" | "succeeded" | "failed" | "throttled" | "skipped";
  last_error: string | null;
  last_attempted_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
};

type PostCallHistoryRow = {
  id: string;
  target_reference_id: string | null;
  target_id: string | null;
  target_label: string | null;
  target_url: string | null;
  join_url: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  status: "follow_up_open" | "handled";
  summary: string;
  notes: string | null;
  reason_for_call: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  occurred_at: string;
};

type MeetingCurrentStateRow = {
  id: string;
  title: string;
  meeting_status: string;
  meeting_join_url: string | null;
  meeting_web_url: string | null;
  external_meeting_id: string | null;
  external_calendar_event_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  sync_error: string | null;
};

function buildPolicyContext(record: CommunicationRecordContext) {
  return {
    departmentType: record.policyContext.departmentType ?? null,
    organizationId: record.policyContext.organizationId ?? null,
    locationId: record.policyContext.locationId ?? null,
    ownerUserIds: record.policyContext.ownerUserIds ?? [],
    assignedUserIds: record.policyContext.assignedUserIds ?? [],
    customScopeValues: record.policyContext.customScopeValues ?? []
  };
}

function buildGovernanceContext(record: CommunicationRecordContext) {
  return {
    objectType: record.objectType,
    objectId: record.objectId,
    objectLabel: record.objectLabel,
    module: record.module,
    policyContext: buildPolicyContext(record)
  };
}

function assertHistoryRecordVisible(auth: AuthUser, record: CommunicationRecordContext) {
  if (!canViewRecords(auth, record.permissionEntity, buildPolicyContext(record))) {
    throw new ApiError(403, "Forbidden");
  }
}

function hasFailure(entry: CommunicationHistoryEntry | CommunicationHistoryLatestSummary | null | undefined) {
  if (!entry) {
    return false;
  }
  return Boolean(entry.failure_reason || entry.status === "failed" || entry.status === "sync_error");
}

function pickOccurredAt(values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value)) ?? null;
}

function humanizeStatus(value: string) {
  return value.replace(/_/g, " ");
}

function buildMessageSummary(row: MessageHistoryRow) {
  switch (row.status) {
    case "sent":
      return `Sent update to ${row.target_label}`;
    case "failed":
      return `Failed to send update to ${row.target_label}`;
    case "throttled":
      return `Throttled duplicate update to ${row.target_label}`;
    case "sending":
      return `Sending update to ${row.target_label}`;
    case "queued":
    default:
      return `Queued update to ${row.target_label}`;
  }
}

function buildMeetingSummary(row: MeetingHistoryRow) {
  const label = row.target_label || "Teams meeting";
  if (row.operation_type === "create") {
    switch (row.status) {
      case "failed":
        return `Failed to create ${label}`;
      case "succeeded":
        return `Created ${label}`;
      case "throttled":
        return `Throttled duplicate ${label} create`;
      default:
        return `Queued ${label} creation`;
    }
  }
  if (row.operation_type === "update") {
    switch (row.status) {
      case "failed":
        return `Failed to update ${label}`;
      case "succeeded":
        return `Updated ${label}`;
      case "throttled":
        return `Throttled duplicate ${label} update`;
      default:
        return `Queued ${label} update`;
    }
  }
  switch (row.status) {
    case "failed":
      return `Failed to cancel ${label}`;
    case "succeeded":
      return `Cancelled ${label}`;
    case "throttled":
      return `Throttled duplicate ${label} cancel`;
    default:
      return `Queued ${label} cancel`;
  }
}

function toLatestSummary(entry: CommunicationHistoryEntry, kind: CommunicationHistoryLatestSummary["kind"]): CommunicationHistoryLatestSummary {
  return {
    kind,
    action_type: entry.action_type,
    target_type: entry.target_type,
    target_reference_id: entry.target_reference_id,
    target_id: entry.target_id,
    target_label: entry.target_label,
    target_url: entry.target_url,
    actor_user_id: entry.actor_user_id,
    actor_name: entry.actor_name,
    status: entry.status,
    visibility_status: entry.visibility_status,
    moderated_at: entry.moderated_at ?? null,
    moderated_by_user_id: entry.moderated_by_user_id ?? null,
    moderation_reason: entry.moderation_reason ?? null,
    summary: entry.summary,
    join_url: entry.join_url,
    failure_reason: entry.failure_reason,
    occurred_at: entry.occurred_at,
    created_at: entry.created_at,
    updated_at: entry.updated_at
  };
}

function buildMeetingFallbackSummary(
  meeting: MeetingCurrentStateRow | null,
  canUseActions: boolean
): CommunicationHistoryLatestSummary | null {
  if (!meeting) {
    return null;
  }
  const statusSummary =
    meeting.meeting_status === "cancelled"
      ? `Cancelled ${meeting.title}`
      : meeting.meeting_status === "sync_error"
        ? `Meeting sync needs attention for ${meeting.title}`
        : `Linked ${meeting.title}`;
  return {
    kind: hasFailure({
      kind: "failure",
      action_type: "meeting.current_state",
      target_type: "meeting",
      target_reference_id: meeting.id,
      target_id: meeting.external_meeting_id ?? meeting.external_calendar_event_id,
      target_label: meeting.title,
      target_url: canUseActions ? meeting.meeting_web_url ?? meeting.meeting_join_url : null,
      actor_user_id: meeting.updated_by_user_id ?? meeting.created_by_user_id,
      actor_name: null,
      status: meeting.meeting_status,
      summary: statusSummary,
      join_url: canUseActions ? meeting.meeting_join_url : null,
      failure_reason: meeting.sync_error,
      occurred_at: meeting.updated_at,
      created_at: meeting.created_at,
      updated_at: meeting.updated_at
    })
      ? "failure"
      : "meeting",
    action_type: "meeting.current_state",
    target_type: "meeting",
    target_reference_id: meeting.id,
    target_id: meeting.external_meeting_id ?? meeting.external_calendar_event_id,
    target_label: meeting.title,
    target_url: canUseActions ? meeting.meeting_web_url ?? meeting.meeting_join_url : null,
    actor_user_id: meeting.updated_by_user_id ?? meeting.created_by_user_id,
    actor_name: null,
    status: meeting.meeting_status,
    summary: statusSummary,
    join_url: canUseActions ? meeting.meeting_join_url : null,
    failure_reason: meeting.sync_error,
    occurred_at: meeting.updated_at,
    created_at: meeting.created_at,
    updated_at: meeting.updated_at
  };
}

async function hasMessagingHistorySchema(client: PoolClient) {
  const { rows } = await client.query<{
    has_reference: boolean;
    has_reference_link: boolean;
    has_delivery: boolean;
  }>(`
    SELECT
      (to_regclass('public.teams_communication_reference') IS NOT NULL) AS has_reference,
      (to_regclass('public.teams_communication_reference_link') IS NOT NULL) AS has_reference_link,
      (to_regclass('public.teams_communication_delivery') IS NOT NULL) AS has_delivery
  `);
  const row = rows[0];
  return Boolean(row?.has_reference && row?.has_reference_link && row?.has_delivery);
}

async function hasMeetingHistorySchema(client: PoolClient) {
  const { rows } = await client.query<{
    has_reference: boolean;
    has_operation: boolean;
  }>(`
    SELECT
      (to_regclass('public.teams_meeting_reference') IS NOT NULL) AS has_reference,
      (to_regclass('public.teams_meeting_sync_operation') IS NOT NULL) AS has_operation
  `);
  const row = rows[0];
  return Boolean(row?.has_reference && row?.has_operation);
}

async function hasPostCallHistorySchema(client: PoolClient) {
  const { rows } = await client.query<{ ready: boolean }>(`
    SELECT (to_regclass('public.communication_post_call_outcome') IS NOT NULL) AS ready
  `);
  return Boolean(rows[0]?.ready);
}

async function listDestinationHistory(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
) {
  const { rows } = await client.query<DestinationHistoryRow>(
    `
      SELECT
        link.id::text AS id,
        reference.id::text AS target_reference_id,
        reference.reference_type::text AS target_type,
        COALESCE(reference.chat_id, reference.channel_id, reference.team_id) AS target_id,
        reference.label AS target_label,
        reference.teams_web_url AS target_url,
        link.created_by_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        link.is_primary,
        link.created_at::text AS created_at,
        reference.updated_at::text AS updated_at
      FROM teams_communication_reference_link link
      JOIN teams_communication_reference reference
        ON reference.tenant_id = link.tenant_id
       AND reference.id = link.reference_id
      LEFT JOIN app_user actor
        ON actor.tenant_id = link.tenant_id
       AND actor.id = link.created_by_user_id
      WHERE link.tenant_id = $1
        AND link.object_type = $2::teams_communication_link_object_type
        AND link.object_id = $3
      ORDER BY link.created_at DESC
      LIMIT 8
    `,
    [tenantId, objectType, objectId]
  );
  return rows.map<CommunicationHistoryEntry>((row) => ({
    id: `destination:${row.id}`,
    kind: "destination_linked",
    action_type: "destination_linked",
    target_type: row.target_type,
    target_reference_id: row.target_reference_id,
    target_id: row.target_id,
    target_label: row.target_label,
    target_url: row.target_url,
    related_record_type: objectType,
    related_record_id: objectId,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    status: "linked",
    summary: row.is_primary ? `Linked primary Teams ${row.target_type} ${row.target_label}` : `Linked Teams ${row.target_type} ${row.target_label}`,
    join_url: null,
    failure_reason: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    occurred_at: row.created_at
  }));
}

async function listMessageHistory(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string,
  includeModerated: boolean
) {
  const { rows } = await client.query<MessageHistoryRow>(
    `
      SELECT
        delivery.id::text AS id,
        reference.id::text AS target_reference_id,
        reference.reference_type::text AS target_type,
        COALESCE(reference.chat_id, reference.channel_id, reference.team_id) AS target_id,
        reference.label AS target_label,
        delivery.teams_destination_url AS target_url,
        delivery.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        delivery.status::text AS status,
        delivery.visibility_status::text AS visibility_status,
        delivery.moderated_at::text AS moderated_at,
        delivery.moderated_by_user_id::text AS moderated_by_user_id,
        delivery.moderation_reason,
        delivery.message_text,
        delivery.first_attempted_at::text AS first_attempted_at,
        delivery.last_attempted_at::text AS last_attempted_at,
        delivery.sent_at::text AS sent_at,
        delivery.failed_at::text AS failed_at,
        delivery.last_error,
        delivery.created_at::text AS created_at,
        delivery.updated_at::text AS updated_at
      FROM teams_communication_delivery delivery
      JOIN teams_communication_reference reference
        ON reference.tenant_id = delivery.tenant_id
       AND reference.id = delivery.reference_id
      LEFT JOIN app_user actor
        ON actor.tenant_id = delivery.tenant_id
       AND actor.id = delivery.actor_user_id
      WHERE delivery.tenant_id = $1
        AND delivery.object_type = $2::teams_communication_link_object_type
        AND delivery.object_id = $3
        AND ($4::boolean = true OR delivery.visibility_status = 'visible'::communication_message_visibility_status)
      ORDER BY delivery.created_at DESC
      LIMIT 12
    `,
    [tenantId, objectType, objectId, includeModerated]
  );
  return rows.map<CommunicationHistoryEntry>((row) => ({
    id: `message:${row.id}`,
    kind: "message",
    action_type: "message_send",
    target_type: row.target_type,
    target_reference_id: row.target_reference_id,
    target_id: row.target_id,
    target_label: row.target_label,
    target_url: row.target_url,
    related_record_type: objectType,
    related_record_id: objectId,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    status: row.status,
    visibility_status: row.visibility_status,
    moderated_at: row.moderated_at,
    moderated_by_user_id: row.moderated_by_user_id,
    moderation_reason: row.moderation_reason,
    summary: buildMessageSummary(row),
    join_url: null,
    failure_reason: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    occurred_at: pickOccurredAt([row.sent_at, row.failed_at, row.last_attempted_at, row.first_attempted_at, row.created_at]) ?? row.created_at
  }));
}

async function listMeetingHistory(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
) {
  const { rows } = await client.query<MeetingHistoryRow>(
    `
      SELECT
        operation.id::text AS id,
        meeting.id::text AS target_reference_id,
        COALESCE(meeting.external_meeting_id, meeting.external_calendar_event_id) AS target_id,
        meeting.title AS target_label,
        meeting.meeting_web_url AS target_url,
        meeting.meeting_join_url AS join_url,
        operation.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        operation.operation_type::text AS operation_type,
        operation.status::text AS status,
        operation.last_error,
        operation.last_attempted_at::text AS last_attempted_at,
        operation.completed_at::text AS completed_at,
        operation.failed_at::text AS failed_at,
        operation.created_at::text AS created_at,
        operation.updated_at::text AS updated_at
      FROM teams_meeting_reference meeting
      JOIN teams_meeting_sync_operation operation
        ON operation.tenant_id = meeting.tenant_id
       AND operation.meeting_id = meeting.id
      LEFT JOIN app_user actor
        ON actor.tenant_id = operation.tenant_id
       AND actor.id = operation.actor_user_id
      WHERE meeting.tenant_id = $1
        AND meeting.linked_record_type = $2::teams_meeting_link_object_type
        AND meeting.linked_record_id = $3
      ORDER BY operation.created_at DESC
      LIMIT 12
    `,
    [tenantId, objectType, objectId]
  );
  return rows.map<CommunicationHistoryEntry>((row) => ({
    id: `meeting:${row.id}`,
    kind: "meeting",
    action_type: `meeting_${row.operation_type}`,
    target_type: "meeting",
    target_reference_id: row.target_reference_id,
    target_id: row.target_id,
    target_label: row.target_label,
    target_url: row.target_url,
    related_record_type: objectType,
    related_record_id: objectId,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    status: row.status,
    summary: buildMeetingSummary(row),
    join_url: row.join_url,
    failure_reason: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    occurred_at: pickOccurredAt([row.completed_at, row.failed_at, row.last_attempted_at, row.created_at]) ?? row.created_at
  }));
}

async function listPostCallHistory(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
) {
  const { rows } = await client.query<PostCallHistoryRow>(
    `
      SELECT
        outcome.id::text AS id,
        outcome.meeting_id::text AS target_reference_id,
        outcome.meeting_target_id AS target_id,
        COALESCE(meeting.title, outcome.summary) AS target_label,
        outcome.meeting_join_url AS target_url,
        outcome.meeting_join_url AS join_url,
        outcome.actor_user_id::text AS actor_user_id,
        actor.full_name AS actor_name,
        outcome.outcome_status::text AS status,
        CASE
          WHEN outcome.follow_up_task_id IS NOT NULL AND outcome.watch_flag_id IS NOT NULL THEN CONCAT('Logged post-call follow-up, created task ', COALESCE(task.task_number, 'follow-up task'), ', and flagged an issue')
          WHEN outcome.follow_up_task_id IS NOT NULL THEN CONCAT('Logged post-call follow-up and created task ', COALESCE(task.task_number, 'follow-up task'))
          WHEN outcome.watch_flag_id IS NOT NULL THEN 'Logged post-call follow-up and flagged an issue'
          WHEN outcome.outcome_status = 'handled'::post_call_outcome_status THEN 'Marked communication handled'
          ELSE 'Logged post-call follow-up'
        END AS summary,
        outcome.notes,
        outcome.reason_for_call,
        NULL::text AS failure_reason,
        outcome.created_at::text AS created_at,
        outcome.updated_at::text AS updated_at,
        COALESCE(outcome.handled_at, outcome.created_at)::text AS occurred_at
      FROM communication_post_call_outcome outcome
      LEFT JOIN app_user actor
        ON actor.tenant_id = outcome.tenant_id
       AND actor.id = outcome.actor_user_id
      LEFT JOIN teams_meeting_reference meeting
        ON meeting.tenant_id = outcome.tenant_id
       AND meeting.id = outcome.meeting_id
      LEFT JOIN work_task task
        ON task.tenant_id = outcome.tenant_id
       AND task.id = outcome.follow_up_task_id
      WHERE outcome.tenant_id = $1
        AND outcome.related_record_type = $2::teams_meeting_link_object_type
        AND outcome.related_record_id = $3
      ORDER BY outcome.created_at DESC
      LIMIT 8
    `,
    [tenantId, objectType, objectId]
  );
  return rows.map<CommunicationHistoryEntry>((row) => ({
    id: `post-call:${row.id}`,
    kind: "post_call",
    action_type: "post_call_follow_up",
    target_type: "meeting",
    target_reference_id: row.target_reference_id,
    target_id: row.target_id,
    target_label: row.target_label,
    target_url: row.target_url,
    related_record_type: objectType,
    related_record_id: objectId,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    status: row.status,
    summary: row.summary,
    join_url: row.join_url,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    occurred_at: row.occurred_at
  }));
}

function applyEntryLinkVisibility(entry: CommunicationHistoryEntry, canUseActions: boolean): CommunicationHistoryEntry {
  if (canUseActions) {
    return entry;
  }
  return {
    ...entry,
    target_url: null,
    join_url: null
  };
}

function applyLatestSummaryLinkVisibility(
  summary: CommunicationHistoryLatestSummary | null,
  canUseActions: boolean
): CommunicationHistoryLatestSummary | null {
  if (!summary || canUseActions) {
    return summary;
  }
  return {
    ...summary,
    target_url: null,
    join_url: null
  };
}

async function loadCurrentMeetingState(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
) {
  const { rows } = await client.query<MeetingCurrentStateRow>(
    `
      SELECT
        meeting.id::text,
        meeting.title,
        meeting.meeting_status::text AS meeting_status,
        meeting.meeting_join_url,
        meeting.meeting_web_url,
        meeting.external_meeting_id,
        meeting.external_calendar_event_id,
        meeting.created_by_user_id::text AS created_by_user_id,
        meeting.updated_by_user_id::text AS updated_by_user_id,
        meeting.created_at::text AS created_at,
        meeting.updated_at::text AS updated_at,
        meeting.sync_error
      FROM teams_meeting_reference meeting
      WHERE meeting.tenant_id = $1
        AND meeting.linked_record_type = $2::teams_meeting_link_object_type
        AND meeting.linked_record_id = $3
      ORDER BY meeting.updated_at DESC
      LIMIT 1
    `,
    [tenantId, objectType, objectId]
  );
  return rows[0] ?? null;
}

export async function getCommunicationHistoryForRecord(
  client: PoolClient,
  auth: AuthUser,
  input: { objectType: TeamsCommunicationLinkedObjectType; objectId: string }
): Promise<CommunicationHistoryRecordView> {
  const record = await resolveCommunicationRecordContext(client, auth, input.objectType, input.objectId);
  assertHistoryRecordVisible(auth, record);

  const governance = evaluateCommunicationGovernance(auth, buildGovernanceContext(record));
  if (!governance.permissions.can_view_history) {
    throw new ApiError(403, "Forbidden");
  }

  const canUseActions = governance.permissions.can_use;
  const includeModerated = hasCommunicationModerationRights(auth) || auth.permissions.includes("communication.moderate");
  const messagingReady = await hasMessagingHistorySchema(client);
  const meetingsReady = await hasMeetingHistorySchema(client);
  const postCallReady = await hasPostCallHistorySchema(client);

  const destinationEntries = messagingReady ? await listDestinationHistory(client, auth.tenantId, input.objectType, input.objectId) : [];
  const messageEntries = messagingReady ? await listMessageHistory(client, auth.tenantId, input.objectType, input.objectId, includeModerated) : [];
  const meetingEntries = meetingsReady ? await listMeetingHistory(client, auth.tenantId, input.objectType, input.objectId) : [];
  const postCallEntries = postCallReady ? await listPostCallHistory(client, auth.tenantId, input.objectType, input.objectId) : [];
  const currentMeetingState = meetingsReady ? await loadCurrentMeetingState(client, auth.tenantId, input.objectType, input.objectId) : null;

  const entries = [...postCallEntries, ...messageEntries, ...meetingEntries, ...destinationEntries]
    .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())
    .slice(0, 20)
    .map((entry) => applyEntryLinkVisibility(entry, canUseActions));

  const latestMessageEntry = messageEntries[0] ?? null;
  const latestMeetingEntry = meetingEntries[0] ?? null;
  const latestFollowUpEntry = postCallEntries[0] ?? null;
  const latestMeetingFallback = latestMeetingEntry ? null : buildMeetingFallbackSummary(currentMeetingState, canUseActions);
  const latestMessage = applyLatestSummaryLinkVisibility(
    latestMessageEntry ? toLatestSummary(latestMessageEntry, "message") : null,
    canUseActions
  );
  const latestMeeting = applyLatestSummaryLinkVisibility(
    latestMeetingEntry ? toLatestSummary(latestMeetingEntry, hasFailure(latestMeetingEntry) ? "failure" : "meeting") : latestMeetingFallback,
    canUseActions
  );
  const latestFollowUp = applyLatestSummaryLinkVisibility(
    latestFollowUpEntry ? toLatestSummary(latestFollowUpEntry, hasFailure(latestFollowUpEntry) ? "failure" : "meeting") : null,
    canUseActions
  );
  const latestFailureEntry = entries.find((entry) => hasFailure(entry)) ?? null;
  const latestFailure =
    latestFailureEntry
      ? applyLatestSummaryLinkVisibility(toLatestSummary(latestFailureEntry, "failure"), canUseActions)
      : latestMeetingFallback && hasFailure(latestMeetingFallback)
        ? latestMeetingFallback
        : null;

  return {
    object_type: input.objectType,
    object_id: input.objectId,
    object_label: record.objectLabel,
    module: governance.module,
    feature_enabled: Boolean(
      config.COMMUNICATION_HISTORY_ENABLED &&
        (config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED || config.MICROSOFT_TEAMS_MEETINGS_ENABLED || postCallReady)
    ),
    permissions: {
      can_view_history: governance.permissions.can_view_history,
      can_use_actions: canUseActions,
      can_view_messages: messagingReady,
      can_view_meetings: meetingsReady
    },
    summary: {
      latest_activity_at: entries[0]?.occurred_at ?? latestMeetingFallback?.occurred_at ?? null,
      latest_message: latestMessage,
      latest_meeting: latestMeeting,
      latest_follow_up: latestFollowUp,
      latest_failure: latestFailure
    },
    entries
  };
}
