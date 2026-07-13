import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canViewRecords, withDepartmentContext } from "./policy/operationalAuthorization.js";
import { createAuditLog } from "./audit.js";
import { queueNotificationDispatch } from "./opsNotifications.js";
import { upsertTeamsMeetingForRecord } from "./teamsMeetings.js";

// SSA-5 Record Threads V1 (migration 168). One conversation thread per record
// (Job, Organization): user messages plus system events — e.g. meeting_created
// when a Teams meeting is launched from the record. Design constraints
// (2026-07-08 sprint doc §5): reuse canViewRecords gating; mentions and
// attachments are stored references (mirroring operational_note); Teams
// involvement is limited to the meeting-link system event — no Graph message
// sync in V1.

export type RecordThreadObjectType = "job" | "organization";

export type RecordThreadMessage = {
  id: string;
  thread_id: string;
  message_kind: "user_message" | "system_event";
  body: string | null;
  event_type: string | null;
  author_user_id: string | null;
  author_name: string | null;
  mention_user_ids: string[];
  attachment_refs: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
};

type ThreadRecordContext = {
  entityType: RecordThreadObjectType;
  entityId: string;
  label: string;
  deepLink: string;
  policyContext: {
    departmentType?: string | null;
    organizationId?: string | null;
    ownerUserIds?: string[];
  };
};

async function resolveThreadRecordContext(
  client: PoolClient,
  tenantId: string,
  entityType: RecordThreadObjectType,
  entityId: string
): Promise<ThreadRecordContext> {
  if (entityType === "job") {
    const { rows } = await client.query<{
      id: string;
      title: string;
      department_type: string;
      organization_id: string | null;
      account_owner_user_id: string | null;
    }>(
      `SELECT id::text, title, department_type::text, organization_id::text, account_owner_user_id::text
       FROM jobs WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, entityId]
    );
    const job = rows[0];
    if (!job) {
      throw new ApiError(404, "Record not found.");
    }
    return {
      entityType,
      entityId,
      label: job.title,
      deepLink: `#jobs/${job.id}`,
      policyContext: {
        departmentType: job.department_type,
        organizationId: job.organization_id,
        ownerUserIds: job.account_owner_user_id ? [job.account_owner_user_id] : []
      }
    };
  }
  const { rows } = await client.query<{ id: string; display_name: string }>(
    `SELECT id::text, display_name FROM organization WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, entityId]
  );
  const organization = rows[0];
  if (!organization) {
    throw new ApiError(404, "Record not found.");
  }
  return {
    entityType,
    entityId,
    label: organization.display_name,
    deepLink: `#directory/organizations/${organization.id}`,
    policyContext: { organizationId: organization.id }
  };
}

function assertThreadAccess(auth: AuthUser, context: ThreadRecordContext) {
  const policyContext = withDepartmentContext(context.policyContext.departmentType ?? null, {
    organizationId: context.policyContext.organizationId ?? null,
    ownerUserIds: context.policyContext.ownerUserIds ?? []
  });
  if (!canViewRecords(auth, context.entityType, policyContext)) {
    throw new ApiError(403, "Forbidden");
  }
}

async function getOrCreateThread(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null,
  context: ThreadRecordContext
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO record_thread (tenant_id, entity_type, entity_id, created_by_user_id)
      VALUES ($1, $2::record_thread_object_type, $3, $4)
      ON CONFLICT (tenant_id, entity_type, entity_id)
      DO UPDATE SET updated_at = now()
      RETURNING id::text
    `,
    [tenantId, context.entityType, context.entityId, actorUserId]
  );
  return rows[0].id;
}

async function listMessagesForThread(client: PoolClient, tenantId: string, threadId: string): Promise<RecordThreadMessage[]> {
  const { rows } = await client.query<RecordThreadMessage>(
    `
      SELECT
        message.id::text,
        message.thread_id::text,
        message.message_kind::text AS message_kind,
        message.body,
        message.event_type,
        message.author_user_id::text,
        author.full_name AS author_name,
        COALESCE(message.mention_user_ids::text[], '{}') AS mention_user_ids,
        message.attachment_refs,
        message.metadata,
        message.created_at::text
      FROM record_thread_message message
      LEFT JOIN app_user author ON author.id = message.author_user_id
      WHERE message.tenant_id = $1
        AND message.thread_id = $2
      ORDER BY message.created_at ASC
      LIMIT 500
    `,
    [tenantId, threadId]
  );
  return rows;
}

export async function getRecordThreadView(
  client: PoolClient,
  auth: AuthUser,
  entityType: RecordThreadObjectType,
  entityId: string
) {
  const context = await resolveThreadRecordContext(client, auth.tenantId, entityType, entityId);
  assertThreadAccess(auth, context);
  const { rows } = await client.query<{ id: string }>(
    `SELECT id::text FROM record_thread WHERE tenant_id = $1 AND entity_type = $2::record_thread_object_type AND entity_id = $3 LIMIT 1`,
    [auth.tenantId, entityType, entityId]
  );
  const threadId = rows[0]?.id ?? null;
  return {
    entity_type: entityType,
    entity_id: entityId,
    entity_label: context.label,
    thread_id: threadId,
    messages: threadId ? await listMessagesForThread(client, auth.tenantId, threadId) : []
  };
}

export async function postRecordThreadMessage(
  client: PoolClient,
  auth: AuthUser,
  input: {
    entityType: RecordThreadObjectType;
    entityId: string;
    body: string;
    mentionUserIds?: string[];
    attachmentRefs?: unknown[];
  }
) {
  const body = input.body.trim();
  if (!body) {
    throw new ApiError(400, "Message body is required.");
  }
  const context = await resolveThreadRecordContext(client, auth.tenantId, input.entityType, input.entityId);
  assertThreadAccess(auth, context);
  const threadId = await getOrCreateThread(client, auth.tenantId, auth.id, context);
  const mentionUserIds = [...new Set(input.mentionUserIds ?? [])];
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO record_thread_message
        (tenant_id, thread_id, message_kind, body, author_user_id, mention_user_ids, attachment_refs)
      VALUES ($1, $2, 'user_message', $3, $4, $5::uuid[], $6::jsonb)
      RETURNING id::text
    `,
    [auth.tenantId, threadId, body, auth.id, mentionUserIds, JSON.stringify(input.attachmentRefs ?? [])]
  );
  const messageId = rows[0].id;
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "record_thread.message_posted",
    entityType: "record_thread_message",
    entityId: messageId,
    metadata: { thread_entity_type: input.entityType, thread_entity_id: input.entityId, mention_count: mentionUserIds.length }
  });
  if (mentionUserIds.length > 0) {
    // Mentions go beyond operational_note's stored-only pattern: a mention is a
    // request for attention, so it rides the existing notification outbox.
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: mentionUserIds.filter((userId) => userId !== auth.id),
      notificationType: "record_thread.mention",
      title: `You were mentioned on ${context.label}`,
      body: body.length > 240 ? `${body.slice(0, 237)}...` : body,
      deepLink: context.deepLink,
      appEventDedupeKey: `record_thread.mention:${messageId}`,
      metadata: { thread_id: threadId, message_id: messageId }
    });
  }
  return getRecordThreadView(client, auth, input.entityType, input.entityId);
}

export async function launchRecordThreadMeeting(
  client: PoolClient,
  auth: AuthUser,
  input: {
    entityType: RecordThreadObjectType;
    entityId: string;
    title?: string | null;
  }
) {
  const context = await resolveThreadRecordContext(client, auth.tenantId, input.entityType, input.entityId);
  assertThreadAccess(auth, context);
  // The meetings service owns its own (stricter) governance gating and the
  // Graph outbox; V1 threads only RECORD the launch as a system event. The
  // join URL is populated by the worker sync, so the event references the
  // meeting id and carries whatever URL exists at launch time.
  const meeting = await upsertTeamsMeetingForRecord(client, auth, {
    object_type: input.entityType,
    object_id: input.entityId,
    title: input.title ?? null
  });
  const threadId = await getOrCreateThread(client, auth.tenantId, auth.id, context);
  await client.query(
    `
      INSERT INTO record_thread_message
        (tenant_id, thread_id, message_kind, event_type, author_user_id, metadata)
      VALUES ($1, $2, 'system_event', 'meeting_created', $3, $4::jsonb)
    `,
    [
      auth.tenantId,
      threadId,
      auth.id,
      JSON.stringify({
        meeting_id: meeting.id,
        join_url: meeting.meeting_join_url,
        app_deep_link: meeting.app_deep_link ?? null,
        title: meeting.title
      })
    ]
  );
  return {
    meeting,
    thread: await getRecordThreadView(client, auth, input.entityType, input.entityId)
  };
}
