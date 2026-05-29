import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  CreateTeamsCommunicationReferenceInput,
  QueueTeamsCommunicationMessageInput,
  TeamsCommunicationDeliveryRecord,
  TeamsCommunicationLinkedObjectType,
  TeamsCommunicationRecordView,
  TeamsCommunicationReferenceRecord
} from "../types/teamsMessaging.js";
import { createAuditLog } from "./audit.js";
import { hasCommunicationModerationRights } from "./appAuthorization.js";
import { captureCommunicationFailure, writeCommunicationAuditEvent } from "./communicationObservability.js";
import { evaluateCommunicationGovernance, getCommunicationGovernanceModule } from "./communicationGovernance.js";
import { resolveCommunicationRecordContext, type CommunicationRecordContext } from "./communicationRecords.js";
import { buildTeamsEmbeddedAppUrl } from "./microsoftTeamsLinks.js";
import { createAppEvent } from "./outbox.js";
import { canViewRecords } from "./policy/operationalAuthorization.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type ReferenceRow = {
  id: string;
  reference_type: "chat" | "channel";
  status: "active" | "disabled";
  label: string;
  description: string | null;
  teams_web_url: string;
  team_id: string | null;
  channel_id: string | null;
  chat_id: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  last_verified_at: string | null;
};

type DeliveryRow = {
  id: string;
  reference_id: string;
  reference_label: string;
  reference_type: "chat" | "channel";
  status: "queued" | "sending" | "sent" | "failed" | "throttled";
  visibility_status: "visible" | "moderated_hidden";
  message_text: string;
  app_deep_link: string | null;
  teams_destination_url: string;
  attempt_count: number;
  first_attempted_at: string | null;
  last_attempted_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  external_message_id: string | null;
  moderated_at: string | null;
  moderated_by_user_id: string | null;
  moderation_reason: string | null;
  created_at: string;
  updated_at: string;
};

type DestinationLookupRow = {
  id: string;
  status: "active" | "disabled";
  label: string;
  reference_type: "chat" | "channel";
  teams_web_url: string;
  team_id: string | null;
  channel_id: string | null;
  chat_id: string | null;
  link_id: string | null;
  link_object_type: TeamsCommunicationLinkedObjectType | null;
  link_object_id: string | null;
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toReferenceRecord(row: ReferenceRow): TeamsCommunicationReferenceRecord {
  return {
    id: row.id,
    reference_type: row.reference_type,
    status: row.status,
    label: row.label,
    description: row.description,
    teams_web_url: row.teams_web_url,
    team_id: row.team_id,
    channel_id: row.channel_id,
    chat_id: row.chat_id,
    is_primary: row.is_primary,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_verified_at: row.last_verified_at
  };
}

function toDeliveryRecord(row: DeliveryRow): TeamsCommunicationDeliveryRecord {
  return {
    id: row.id,
    reference_id: row.reference_id,
    reference_label: row.reference_label,
    reference_type: row.reference_type,
    status: row.status,
    visibility_status: row.visibility_status,
    message_text: row.message_text,
    app_deep_link: row.app_deep_link,
    teams_destination_url: row.teams_destination_url,
    attempt_count: Number(row.attempt_count ?? 0),
    first_attempted_at: row.first_attempted_at,
    last_attempted_at: row.last_attempted_at,
    sent_at: row.sent_at,
    failed_at: row.failed_at,
    last_error: row.last_error,
    external_message_id: row.external_message_id,
    moderated_at: row.moderated_at,
    moderated_by_user_id: row.moderated_by_user_id,
    moderation_reason: row.moderation_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildMessageThrottleKey(referenceId: string, objectType: TeamsCommunicationLinkedObjectType, objectId: string, messageText: string, appDeepLink: string | null) {
  const digest = createHash("sha256")
    .update([referenceId, objectType, objectId, messageText.trim(), appDeepLink ?? ""].join("|"))
    .digest("hex");
  return `teams-message:${referenceId}:${objectType}:${objectId}:${digest}`;
}

function normalizeAppDeepLink(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  return buildTeamsEmbeddedAppUrl(normalized.startsWith("#") ? normalized : `#${normalized.replace(/^\/+/, "")}`);
}

function normalizeTeamsWebUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiError(400, "Teams destination URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new ApiError(400, "Teams destination URL must use HTTPS.");
  }
  if (!/teams\.microsoft\.com|teams\.live\.com/i.test(parsed.hostname)) {
    throw new ApiError(400, "Teams destination URL must point to teams.microsoft.com or teams.live.com.");
  }
  return parsed.toString();
}

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

function canViewCommunicationRecord(auth: AuthUser, record: CommunicationRecordContext) {
  return canViewRecords(auth, record.permissionEntity, buildPolicyContext(record));
}

function assertRecordVisible(auth: AuthUser, record: CommunicationRecordContext) {
  if (!canViewCommunicationRecord(auth, record)) {
    throw new ApiError(403, "Forbidden");
  }
}

async function resolveRecordContext(
  client: PoolClient,
  auth: AuthUser,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string
): Promise<CommunicationRecordContext> {
  return resolveCommunicationRecordContext(client, auth, objectType, objectId);
  if (objectType === "job") {
    const jobResult = await client.query<{
      id: string;
      title: string;
      job_number: string | null;
      department_type: string;
      organization_id: string | null;
      primary_location_id: string | null;
      account_owner_user_id: string | null;
      created_by_user_id: string | null;
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
          created_by_user_id::text AS created_by_user_id
        FROM jobs
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const row = jobResult.rows[0];
    if (!row) {
      throw new ApiError(404, "Record not found");
    }
    const assignedUsers = await client.query<{ user_id: string }>(
      `
        SELECT DISTINCT user_id::text AS user_id
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = $2
      `,
      [auth.tenantId, objectId]
    );
    return {
      objectType,
      objectId,
      objectLabel: row.job_number ? `${row.job_number} · ${row.title}` : row.title,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "job",
      policyContext: {
        departmentType: row.department_type,
        organizationId: row.organization_id,
        locationId: row.primary_location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: assignedUsers.rows.map((entry) => entry.user_id)
      }
    };
  }

  if (objectType === "production_item") {
    const result = await client.query<{
      id: string;
      title: string;
      assigned_to_user_id: string | null;
      created_by_user_id: string | null;
      job_department_type: string;
      organization_id: string | null;
      location_id: string | null;
      account_owner_user_id: string | null;
    }>(
      `
        SELECT
          item.id::text,
          item.title,
          item.assigned_to_user_id::text AS assigned_to_user_id,
          item.created_by_user_id::text AS created_by_user_id,
          job.department_type::text AS job_department_type,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS location_id,
          job.account_owner_user_id::text AS account_owner_user_id
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
    return {
      objectType,
      objectId,
      objectLabel: row.title,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "production",
      policyContext: {
        departmentType: row.job_department_type,
        organizationId: row.organization_id,
        locationId: row.location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [row.assigned_to_user_id].filter((value): value is string => Boolean(value))
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
          job.account_owner_user_id::text AS account_owner_user_id
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
    return {
      objectType,
      objectId,
      objectLabel: row.task_number ? `${row.task_number} · ${row.title}` : row.title,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "task",
      policyContext: {
        departmentType: row.department_type,
        organizationId: row.organization_id,
        locationId: row.location_id,
        ownerUserIds: [row.account_owner_user_id, row.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [row.assigned_to_user_id].filter((value): value is string => Boolean(value)),
        customScopeValues: row.related_job_id ? [row.related_job_id].filter((value): value is string => Boolean(value)) : []
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
    return {
      objectType,
      objectId,
      objectLabel: row.display_name,
      module: getCommunicationGovernanceModule(objectType),
      permissionEntity: "organization",
      policyContext: {
        organizationId: row.id,
        ownerUserIds: [row.account_owner_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: []
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
    module: getCommunicationGovernanceModule(objectType),
    permissionEntity: "location",
    policyContext: {
      organizationId: row.organization_id,
      locationId: row.id,
      ownerUserIds: [],
      assignedUserIds: []
    }
  };
}

function isTeamsMessagingConfigured() {
  return Boolean(
    config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED &&
      config.MICROSOFT_TEAMS_BOT_APP_ID &&
      config.MICROSOFT_TEAMS_BOT_APP_PASSWORD &&
      config.MICROSOFT_GRAPH_TENANT_ID
  );
}

async function hasTeamsMessagingSchema(client: PoolClient) {
  const { rows } = await client.query<{
    has_reference: boolean;
    has_reference_link: boolean;
    has_delivery: boolean;
    has_delivery_event: boolean;
  }>(
    `
      SELECT
        (to_regclass('public.teams_communication_reference') IS NOT NULL) AS has_reference,
        (to_regclass('public.teams_communication_reference_link') IS NOT NULL) AS has_reference_link,
        (to_regclass('public.teams_communication_delivery') IS NOT NULL) AS has_delivery,
        (to_regclass('public.teams_communication_delivery_event') IS NOT NULL) AS has_delivery_event
    `
  );

  const row = rows[0];
  return Boolean(row?.has_reference && row?.has_reference_link && row?.has_delivery && row?.has_delivery_event);
}

async function insertDeliveryEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    eventType: "queued" | "sending" | "sent" | "failed" | "throttled";
    actorUserId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO teams_communication_delivery_event (
        tenant_id,
        delivery_id,
        event_type,
        actor_user_id,
        note,
        metadata
      )
      VALUES ($1,$2,$3::teams_communication_delivery_event_type,$4,$5,$6::jsonb)
    `,
    [input.tenantId, input.deliveryId, input.eventType, input.actorUserId ?? null, input.note ?? null, JSON.stringify(input.metadata ?? {})]
  );
}

async function listReferencesForRecord(client: PoolClient, tenantId: string, objectType: TeamsCommunicationLinkedObjectType, objectId: string) {
  const { rows } = await client.query<ReferenceRow>(
    `
      SELECT
        reference.id::text,
        reference.reference_type::text AS reference_type,
        reference.status::text AS status,
        reference.label,
        reference.description,
        reference.teams_web_url,
        reference.team_id,
        reference.channel_id,
        reference.chat_id,
        link.is_primary,
        reference.created_at::text,
        reference.updated_at::text,
        reference.last_verified_at::text
      FROM teams_communication_reference_link link
      JOIN teams_communication_reference reference
        ON reference.tenant_id = link.tenant_id
       AND reference.id = link.reference_id
      WHERE link.tenant_id = $1
        AND link.object_type = $2::teams_communication_link_object_type
        AND link.object_id = $3
      ORDER BY link.is_primary DESC, reference.label ASC, reference.created_at DESC
    `,
    [tenantId, objectType, objectId]
  );
  return rows.map(toReferenceRecord);
}

async function listRecentDeliveriesForRecord(
  client: PoolClient,
  tenantId: string,
  objectType: TeamsCommunicationLinkedObjectType,
  objectId: string,
  includeModerated = false
) {
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.reference_id::text AS reference_id,
        reference.label AS reference_label,
        reference.reference_type::text AS reference_type,
        delivery.status::text AS status,
        delivery.visibility_status::text AS visibility_status,
        delivery.message_text,
        delivery.app_deep_link,
        delivery.teams_destination_url,
        delivery.attempt_count,
        delivery.first_attempted_at::text,
        delivery.last_attempted_at::text,
        delivery.sent_at::text,
        delivery.failed_at::text,
        delivery.last_error,
        delivery.external_message_id,
        delivery.moderated_at::text AS moderated_at,
        delivery.moderated_by_user_id::text AS moderated_by_user_id,
        delivery.moderation_reason,
        delivery.created_at::text,
        delivery.updated_at::text
      FROM teams_communication_delivery delivery
      JOIN teams_communication_reference reference
        ON reference.tenant_id = delivery.tenant_id
       AND reference.id = delivery.reference_id
      WHERE delivery.tenant_id = $1
        AND delivery.object_type = $2::teams_communication_link_object_type
        AND delivery.object_id = $3
        AND ($4::boolean = true OR delivery.visibility_status = 'visible'::communication_message_visibility_status)
      ORDER BY delivery.created_at DESC
      LIMIT 12
    `,
    [tenantId, objectType, objectId, includeModerated]
  );
  return rows.map(toDeliveryRecord);
}

async function loadReferenceByIdForRecord(
  client: PoolClient,
  tenantId: string,
  referenceId: string,
  linkedRecord: { objectType: TeamsCommunicationLinkedObjectType; objectId: string } | null
) {
  if (linkedRecord) {
    const { rows } = await client.query<DestinationLookupRow>(
      `
        SELECT
          reference.id::text,
          reference.status::text AS status,
          reference.label,
          reference.reference_type::text AS reference_type,
          reference.teams_web_url,
          reference.team_id,
          reference.channel_id,
          reference.chat_id,
          link.id::text AS link_id,
          link.object_type::text AS link_object_type,
          link.object_id::text AS link_object_id
        FROM teams_communication_reference reference
        JOIN teams_communication_reference_link link
          ON link.tenant_id = reference.tenant_id
         AND link.reference_id = reference.id
         AND link.object_type = $3::teams_communication_link_object_type
         AND link.object_id = $4
        WHERE reference.tenant_id = $1
          AND reference.id = $2
        ORDER BY link.is_primary DESC, link.created_at DESC
        LIMIT 1
      `,
      [tenantId, referenceId, linkedRecord.objectType, linkedRecord.objectId]
    );
    return rows[0] ?? null;
  }

  const { rows } = await client.query<DestinationLookupRow>(
    `
      SELECT
        reference.id::text,
        reference.status::text AS status,
        reference.label,
        reference.reference_type::text AS reference_type,
        reference.teams_web_url,
        reference.team_id,
        reference.channel_id,
        reference.chat_id,
        link.id::text AS link_id,
        link.object_type::text AS link_object_type,
        link.object_id::text AS link_object_id
      FROM teams_communication_reference reference
      LEFT JOIN teams_communication_reference_link link
        ON link.tenant_id = reference.tenant_id
       AND link.reference_id = reference.id
      WHERE reference.tenant_id = $1
        AND reference.id = $2
      ORDER BY link.is_primary DESC, link.created_at DESC
      LIMIT 1
    `,
    [tenantId, referenceId]
  );
  return rows[0] ?? null;
}

async function findReferenceByDestination(
  client: PoolClient,
  tenantId: string,
  input: Pick<CreateTeamsCommunicationReferenceInput, "reference_type" | "team_id" | "channel_id" | "chat_id">
) {
  if (input.reference_type === "chat") {
    const { rows } = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM teams_communication_reference
        WHERE tenant_id = $1
          AND chat_id = $2
        LIMIT 1
      `,
      [tenantId, input.chat_id]
    );
    return rows[0]?.id ?? null;
  }

  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM teams_communication_reference
      WHERE tenant_id = $1
        AND team_id = $2
        AND channel_id = $3
      LIMIT 1
    `,
    [tenantId, input.team_id, input.channel_id]
  );
  return rows[0]?.id ?? null;
}

function validateReferenceInput(input: CreateTeamsCommunicationReferenceInput) {
  const label = normalizeText(input.label);
  if (!label) {
    throw new ApiError(400, "Destination label is required.");
  }

  const teamsWebUrl = normalizeTeamsWebUrl(input.teams_web_url);
  if (input.reference_type === "chat") {
    const chatId = normalizeText(input.chat_id);
    if (!chatId) {
      throw new ApiError(400, "Existing chat id is required for Teams chat destinations.");
    }
    return {
      label,
      description: normalizeText(input.description),
      teamsWebUrl,
      teamId: null,
      channelId: null,
      chatId
    };
  }

  const teamId = normalizeText(input.team_id);
  const channelId = normalizeText(input.channel_id);
  if (!teamId || !channelId) {
    throw new ApiError(400, "Existing team id and channel id are required for Teams channel destinations.");
  }
  return {
    label,
    description: normalizeText(input.description),
    teamsWebUrl,
    teamId,
    channelId,
    chatId: null
  };
}

export async function getTeamsCommunicationRecordView(
  client: PoolClient,
  auth: AuthUser,
  input: { objectType: TeamsCommunicationLinkedObjectType; objectId: string }
): Promise<TeamsCommunicationRecordView> {
  let record: CommunicationRecordContext | null = null;
  try {
    record = await resolveRecordContext(client, auth, input.objectType, input.objectId);
    assertRecordVisible(auth, record);
    const governance = evaluateCommunicationGovernance(auth, buildGovernanceContext(record));
    if (!governance.permissions.can_use && !governance.permissions.can_configure) {
      throw new ApiError(403, "Forbidden");
    }
    const includeModerated = hasCommunicationModerationRights(auth) || auth.permissions.includes("communication.moderate");

    const schemaReady = await hasTeamsMessagingSchema(client);
    if (!schemaReady) {
      return {
        object_type: record.objectType,
        object_id: record.objectId,
        object_label: record.objectLabel,
        module: governance.module,
        permissions: {
          can_use: governance.permissions.can_use,
          can_send: governance.permissions.can_send,
          can_configure: governance.permissions.can_configure,
          can_view_history: governance.permissions.can_view_history,
          can_send_proactive: governance.permissions.can_send_proactive,
          can_message_chats: governance.permissions.can_message_chats,
          can_message_channels: governance.permissions.can_message_channels,
          can_message_assigned_staff: governance.permissions.can_message_assigned_staff
        },
        feature_enabled: false,
        references: [],
        recent_deliveries: []
      };
    }

    const [references, deliveries] = await Promise.all([
      listReferencesForRecord(client, auth.tenantId, input.objectType, input.objectId),
      listRecentDeliveriesForRecord(client, auth.tenantId, input.objectType, input.objectId, includeModerated)
    ]);

    return {
      object_type: record.objectType,
      object_id: record.objectId,
      object_label: record.objectLabel,
      module: governance.module,
      permissions: {
        can_use: governance.permissions.can_use,
        can_send: governance.permissions.can_send,
        can_configure: governance.permissions.can_configure,
        can_view_history: governance.permissions.can_view_history,
        can_send_proactive: governance.permissions.can_send_proactive,
        can_message_chats: governance.permissions.can_message_chats,
        can_message_channels: governance.permissions.can_message_channels,
        can_message_assigned_staff: governance.permissions.can_message_assigned_staff
      },
      feature_enabled: isTeamsMessagingConfigured(),
      references,
      recent_deliveries: deliveries
    };
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.record_view.load_failed",
      resourceType: input.objectType,
      resourceId: input.objectId,
      area: "in_app_actions",
      action: "load_record_view",
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

export async function createTeamsCommunicationReference(
  client: PoolClient,
  auth: AuthUser,
  input: CreateTeamsCommunicationReferenceInput,
  requestMeta: RequestMeta = {}
): Promise<TeamsCommunicationReferenceRecord> {
  let record: CommunicationRecordContext | null = null;
  let referenceId: string | null = null;
  try {
    record = await resolveRecordContext(client, auth, input.object_type, input.object_id);
    assertRecordVisible(auth, record);
    const governance = evaluateCommunicationGovernance(auth, buildGovernanceContext(record));
    if (!governance.permissions.can_configure) {
      throw new ApiError(403, "Forbidden");
    }
    if (!(await hasTeamsMessagingSchema(client))) {
      throw new ApiError(503, "Teams messaging data model is not available in this environment.");
    }

    const normalized = validateReferenceInput(input);
    const existingReferenceId = await findReferenceByDestination(client, auth.tenantId, input);

    referenceId = existingReferenceId;
    if (referenceId) {
      await client.query(
        `
          UPDATE teams_communication_reference
          SET
            status = 'active'::teams_communication_reference_status,
            label = $3,
            description = $4,
            teams_web_url = $5,
            updated_by_user_id = $2,
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $6
        `,
        [auth.tenantId, auth.id, normalized.label, normalized.description, normalized.teamsWebUrl, referenceId]
      );
    } else {
      const insert = await client.query<{ id: string }>(
        `
          INSERT INTO teams_communication_reference (
            tenant_id,
            reference_type,
            status,
            label,
            description,
            teams_web_url,
            team_id,
            channel_id,
            chat_id,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES ($1,$2::teams_communication_reference_type,'active',$3,$4,$5,$6,$7,$8,$9,$9)
          RETURNING id::text
        `,
        [
          auth.tenantId,
          input.reference_type,
          normalized.label,
          normalized.description,
          normalized.teamsWebUrl,
          normalized.teamId,
          normalized.channelId,
          normalized.chatId,
          auth.id
        ]
      );
      referenceId = insert.rows[0]?.id ?? null;
    }

    if (!referenceId) {
      throw new Error("Failed to create Teams communication reference.");
    }

    if (input.is_primary ?? true) {
      await client.query(
        `
          UPDATE teams_communication_reference_link
          SET is_primary = false
          WHERE tenant_id = $1
            AND object_type = $2::teams_communication_link_object_type
            AND object_id = $3
        `,
        [auth.tenantId, input.object_type, input.object_id]
      );
    }

    await client.query(
      `
        INSERT INTO teams_communication_reference_link (
          tenant_id,
          reference_id,
          object_type,
          object_id,
          is_primary,
          created_by_user_id
        )
        VALUES ($1,$2,$3::teams_communication_link_object_type,$4,$5,$6)
        ON CONFLICT (tenant_id, reference_id, object_type, object_id) DO UPDATE SET
          is_primary = EXCLUDED.is_primary
      `,
      [auth.tenantId, referenceId, input.object_type, input.object_id, Boolean(input.is_primary ?? true), auth.id]
    );

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "communication.teams_reference.upsert",
      entityType: "teams_communication_reference",
      entityId: referenceId,
      metadata: {
        object_type: input.object_type,
        object_id: input.object_id,
        reference_type: input.reference_type
      },
      newValues: {
        label: normalized.label,
        teams_web_url: normalized.teamsWebUrl,
        team_id: normalized.teamId,
        channel_id: normalized.channelId,
        chat_id: normalized.chatId,
        is_primary: Boolean(input.is_primary ?? true)
      },
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_reference.upsert",
      resourceType: "teams_communication_reference",
      resourceId: referenceId,
      result: "linked",
      context: {
        object_type: input.object_type,
        object_id: input.object_id,
        reference_type: input.reference_type,
        is_primary: Boolean(input.is_primary ?? true)
      },
      newValues: {
        label: normalized.label,
        teams_web_url: normalized.teamsWebUrl,
        status: "active"
      }
    });

    const references = await listReferencesForRecord(client, auth.tenantId, input.object_type, input.object_id);
    const created = references.find((reference) => reference.id === referenceId);
    if (!created) {
      throw new Error("Failed to reload Teams communication reference.");
    }
    return created;
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_reference.upsert_failed",
      resourceType: "teams_communication_reference",
      resourceId: referenceId,
      area: "teams_messaging",
      action: "upsert_reference",
      error,
      context: {
        object_type: input.object_type,
        object_id: input.object_id,
        record_label: record?.objectLabel ?? null,
        reference_type: input.reference_type,
        source_surface: requestMeta.sourceSurface ?? "communications"
      }
    });
    throw error;
  }
}

export async function queueTeamsCommunicationMessage(
  client: PoolClient,
  auth: AuthUser,
  input: QueueTeamsCommunicationMessageInput,
  requestMeta: RequestMeta = {}
): Promise<TeamsCommunicationDeliveryRecord> {
  let record: CommunicationRecordContext | null = null;
  let reference: DestinationLookupRow | null = null;
  let deliveryId: string | null = null;
  try {
    record = await resolveRecordContext(client, auth, input.object_type, input.object_id);
    assertRecordVisible(auth, record);
    const governance = evaluateCommunicationGovernance(auth, buildGovernanceContext(record));
    if (!(await hasTeamsMessagingSchema(client))) {
      throw new ApiError(503, "Teams messaging data model is not available in this environment.");
    }
    if (!isTeamsMessagingConfigured()) {
      throw new ApiError(409, "Teams messaging send is not enabled in this environment.");
    }

    const messageText = normalizeText(input.message_text);
    if (!messageText) {
      throw new ApiError(400, "Message text is required.");
    }
    if (!auth.communicationIdentity?.communicationEnabled) {
      throw new ApiError(403, "Your communication access is currently disabled.");
    }
    if (!auth.communicationIdentity?.canPost) {
      throw new ApiError(
        403,
        auth.communicationIdentity?.postingDisabledReason
          ? `Your posting ability is currently limited: ${auth.communicationIdentity.postingDisabledReason}`
          : "Your posting ability is currently limited."
      );
    }

    reference = await loadReferenceByIdForRecord(client, auth.tenantId, input.reference_id, {
      objectType: input.object_type,
      objectId: input.object_id
    });
    if (!reference) {
      throw new ApiError(404, "Teams destination not found.");
    }
    if (reference.status !== "active") {
      throw new ApiError(409, "This Teams destination is not active.");
    }
    if (!governance.permissions.can_use || !governance.permissions.can_send) {
      throw new ApiError(403, "Forbidden");
    }
    if (reference.reference_type === "chat" && !governance.permissions.can_message_chats) {
      throw new ApiError(403, "Forbidden");
    }
    if (reference.reference_type === "channel" && !governance.permissions.can_message_channels) {
      throw new ApiError(403, "Forbidden");
    }

    const appDeepLink = normalizeAppDeepLink(input.app_deep_link);
    const throttleKey = buildMessageThrottleKey(reference.id, input.object_type, input.object_id, messageText, appDeepLink);
    const recent = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM teams_communication_delivery
        WHERE tenant_id = $1
          AND throttle_key = $2
          AND status IN ('queued', 'sending', 'sent')
          AND created_at >= now() - ($3::text || ' minutes')::interval
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [auth.tenantId, throttleKey, String(config.TEAMS_COMMUNICATION_THROTTLE_MINUTES)]
    );

    const status = recent.rows[0] ? "throttled" : "queued";
    const insert = await client.query<{ id: string }>(
      `
        INSERT INTO teams_communication_delivery (
          tenant_id,
          reference_id,
          reference_link_id,
          object_type,
          object_id,
          actor_user_id,
          status,
          message_text,
          app_deep_link,
          teams_destination_url,
          throttle_key,
          request_payload
        )
        VALUES ($1,$2,$3,$4::teams_communication_link_object_type,$5,$6,$7::teams_communication_delivery_status,$8,$9,$10,$11,$12::jsonb)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        reference.id,
        reference.link_id,
        input.object_type,
        input.object_id,
        auth.id,
        status,
        messageText,
        appDeepLink,
        reference.teams_web_url,
        throttleKey,
        JSON.stringify({
          reference_type: reference.reference_type,
          reference_label: reference.label,
          team_id: reference.team_id,
          channel_id: reference.channel_id,
          chat_id: reference.chat_id,
          object_label: record.objectLabel,
          visibility_status: "visible"
        })
      ]
    );
    deliveryId = insert.rows[0]?.id ?? null;
    if (!deliveryId) {
      throw new Error("Failed to create Teams communication delivery.");
    }

    await insertDeliveryEvent(client, {
      tenantId: auth.tenantId,
      deliveryId,
      eventType: status === "throttled" ? "throttled" : "queued",
      actorUserId: auth.id,
      note: status === "throttled" ? "Suppressed by Teams messaging throttle window." : "Queued for Teams delivery.",
      metadata: {
        reference_id: reference.id,
        object_type: input.object_type,
        object_id: input.object_id
      }
    });

    let appEventId: string | null = null;
    if (status === "queued") {
      const appEvent = await createAppEvent(client, {
        tenantId: auth.tenantId,
        eventType: "teams.communication.dispatch",
        aggregateType: "teams_communication_delivery",
        aggregateId: deliveryId,
        dedupeKey: `teams-communication:${deliveryId}:dispatch`,
        payload: {
          delivery_id: deliveryId
        }
      });
      appEventId = String(appEvent.id);
      await client.query(
        `
          UPDATE teams_communication_delivery
          SET app_event_id = $3, updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [auth.tenantId, deliveryId, appEventId]
      );
    }

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: status === "throttled" ? "communication.teams_message.throttled" : "communication.teams_message.queued",
      entityType: "teams_communication_delivery",
      entityId: deliveryId,
      metadata: {
        reference_id: reference.id,
        reference_type: reference.reference_type,
        object_type: input.object_type,
        object_id: input.object_id,
        app_event_id: appEventId
      },
      newValues: {
        status,
        message_text: messageText,
        app_deep_link: appDeepLink
      },
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null,
      sourceSurface: requestMeta.sourceSurface ?? "communications"
    });

    await writeCommunicationAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: status === "throttled" ? "communication.teams_message.throttled" : "communication.teams_message.queued",
      resourceType: "teams_communication_delivery",
      resourceId: deliveryId,
      result: status,
      context: {
        reference_id: reference.id,
        reference_type: reference.reference_type,
        object_type: input.object_type,
        object_id: input.object_id,
        app_event_id: appEventId
      },
      newValues: {
        status,
        message_text: messageText,
        app_deep_link: appDeepLink
      }
    });

    const deliveries = await listRecentDeliveriesForRecord(
      client,
      auth.tenantId,
      input.object_type,
      input.object_id,
      hasCommunicationModerationRights(auth) || auth.permissions.includes("communication.moderate")
    );
    const delivery = deliveries.find((entry) => entry.id === deliveryId);
    if (!delivery) {
      throw new Error("Failed to reload Teams communication delivery.");
    }
    return delivery;
  } catch (error) {
    await captureCommunicationFailure(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventType: "communication.teams_message.queue_failed",
      resourceType: "teams_communication_delivery",
      resourceId: deliveryId ?? reference?.id ?? input.reference_id,
      area: "teams_messaging",
      action: "queue_message",
      error,
      context: {
        object_type: input.object_type,
        object_id: input.object_id,
        record_label: record?.objectLabel ?? null,
        reference_id: reference?.id ?? input.reference_id,
        reference_type: reference?.reference_type ?? null,
        source_surface: requestMeta.sourceSurface ?? "communications"
      }
    });
    throw error;
  }
}
