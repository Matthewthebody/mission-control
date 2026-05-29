import type { PoolClient } from "pg";
import { config } from "../config.js";
import {
  recordWorkerMicrosoftIntegrationEvent,
  upsertWorkerSyncHealthRecord,
  writeWorkerMicrosoftExternalAudit
} from "../diagnostics/microsoftIntegrationEvents.js";
import { failIntegrationTrace, finishIntegrationTrace, startIntegrationTrace } from "../utils/integrationTelemetry.js";

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const CALENDAR_WEBHOOK_SYNC_KEY = "microsoft_graph_calendar_webhook";
const CALENDAR_SUBSCRIPTION_SYNC_KEY = "microsoft_graph_calendar_subscription";

type IntegrationSyncOperation = {
  id: string;
  tenant_id: string;
  provider: string;
  direction: string;
  entity_type: string;
  entity_id: string | null;
  external_object_type: string;
  external_id: string | null;
  operation_type: string;
  source_system: string;
  source_change_key: string | null;
  status: string;
  triggered_by_user_id: string | null;
  payload: Record<string, unknown>;
};

type SyncOutcome = {
  code: "synced" | "disabled" | "conflict" | "skipped";
  externalId: string | null;
  response: Record<string, unknown>;
};

type CachedGraphToken = {
  accessToken: string;
  expiresAtMs: number;
};

type WorkShiftSyncRow = {
  id: string;
  tenant_id: string;
  shoot_id: string | null;
  assigned_user_id: string;
  assigned_user_email: string | null;
  assigned_user_name: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  location_address: string | null;
  notes: string | null;
  staffing_role: string | null;
  status: string;
  cancelled_at: string | null;
  outlook_event_id: string | null;
  outlook_calendar_owner_email: string | null;
  conflict_status: string | null;
  conflict_detail: Record<string, unknown> | null;
};

type GraphTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GraphErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

type GraphEventResponse = {
  id?: string;
  webLink?: string | null;
};

type MicrosoftGraphNotification = Record<string, unknown>;

class WorkerGraphError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(message);
  }
}

let cachedGraphToken: CachedGraphToken | null = null;

function parseRetryAfterSeconds(rawValue: string | null) {
  if (!rawValue) {
    return null;
  }

  const numericSeconds = Number(rawValue);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.ceil(numericSeconds);
  }

  const retryAt = Date.parse(rawValue);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  const deltaSeconds = Math.ceil((retryAt - Date.now()) / 1000);
  return deltaSeconds >= 0 ? deltaSeconds : null;
}

function extractRetryAfterSeconds(headers: Headers) {
  return parseRetryAfterSeconds(headers.get("Retry-After"));
}

function getConfiguredMicrosoftGraphWebhookClientState() {
  const clientState = config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE.trim();
  return clientState.length > 0 ? clientState : null;
}

function buildGraphRetryState(error: WorkerGraphError) {
  if (error.retryAfterSeconds !== null) {
    return "retry_after_backoff_required";
  }
  if (error.status === 429 || error.status >= 500) {
    return "retryable_graph_backoff";
  }
  return "manual_attention";
}

function buildGraphErrorMetadata(error: unknown) {
  if (!(error instanceof WorkerGraphError)) {
    return {};
  }

  return {
    error_code: error.code,
    http_status: error.status,
    retry_after_seconds: error.retryAfterSeconds,
    retry_state: buildGraphRetryState(error)
  };
}

function hasGraphCredentials() {
  return false;
}

function buildExternalId(entityType: string, entityId: string) {
  if (entityType === "shoot") {
    return `graph-shoot-${entityId}`;
  }
  if (entityType === "schedule_event") {
    return `graph-schedule-event-${entityId}`;
  }
  return `graph-shift-${entityId}`;
}

async function ensureGraphApplicationAccessToken(correlationId?: string | null) {
  if (cachedGraphToken && cachedGraphToken.expiresAtMs > Date.now() + 60_000) {
    return cachedGraphToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: config.MICROSOFT_GRAPH_CLIENT_ID,
    client_secret: config.MICROSOFT_GRAPH_CLIENT_SECRET,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials"
  });

  const tokenUrl = `https://login.microsoftonline.com/${config.MICROSOFT_GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const trace = startIntegrationTrace({
    provider: "outlook",
    operation: "app_token_exchange",
    direction: "outbound",
    method: "POST",
    target: tokenUrl,
    correlationId
  });
  try {
    const response = await fetchWithTimeout(
      tokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      }
    );

    const payload = (await response.json()) as GraphTokenResponse;
    if (!response.ok || !payload.access_token) {
      const retryAfterSeconds = extractRetryAfterSeconds(response.headers);
      const error = new WorkerGraphError(
        payload.error ?? "graph_token_exchange_failed",
        payload.error_description ?? "Microsoft Graph application token exchange failed",
        response.status,
        retryAfterSeconds
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryAfterSeconds,
        retryable: response.status === 429 || response.status >= 500
      });
      throw error;
    }

    cachedGraphToken = {
      accessToken: payload.access_token,
      expiresAtMs: Date.now() + (payload.expires_in ?? 300) * 1000
    };

    finishIntegrationTrace(trace, {
      statusCode: response.status,
      retryAfterSeconds: extractRetryAfterSeconds(response.headers)
    });
    return cachedGraphToken.accessToken;
  } catch (error) {
    if (!(error instanceof WorkerGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OUTLOOK_GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new WorkerGraphError("graph_timeout", "Microsoft Graph timed out", 408);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGraphJson<T>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
  options: { operation: string; correlationId?: string | null }
) {
  const trace = startIntegrationTrace({
    provider: "outlook",
    operation: options.operation,
    direction: "outbound",
    method: typeof init.method === "string" ? init.method.toUpperCase() : "GET",
    target: url,
    correlationId: options.correlationId
  });
  try {
    const response = await fetchWithTimeout(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {})
      }
    });

    const rawBody = await response.text();
    const payload = (rawBody ? JSON.parse(rawBody) : {}) as T & GraphErrorPayload;
    if (!response.ok) {
      const retryAfterSeconds = extractRetryAfterSeconds(response.headers);
      const error = new WorkerGraphError(
        payload.error?.code ?? "graph_request_failed",
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}`,
        response.status,
        retryAfterSeconds
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryAfterSeconds,
        retryable: response.status === 429 || response.status >= 500
      });
      throw error;
    }

    finishIntegrationTrace(trace, {
      statusCode: response.status,
      retryAfterSeconds: extractRetryAfterSeconds(response.headers)
    });
    return payload;
  } catch (error) {
    if (!(error instanceof WorkerGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function fetchGraphNoContent(
  accessToken: string,
  url: string,
  init: RequestInit = {},
  options: { operation: string; correlationId?: string | null }
) {
  const trace = startIntegrationTrace({
    provider: "outlook",
    operation: options.operation,
    direction: "outbound",
    method: typeof init.method === "string" ? init.method.toUpperCase() : "GET",
    target: url,
    correlationId: options.correlationId
  });
  try {
    const response = await fetchWithTimeout(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok && response.status !== 404) {
      let payload: GraphErrorPayload = {};
      try {
        payload = (await response.json()) as GraphErrorPayload;
      } catch {
        payload = {};
      }
      const retryAfterSeconds = extractRetryAfterSeconds(response.headers);
      const error = new WorkerGraphError(
        payload.error?.code ?? "graph_request_failed",
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}`,
        response.status,
        retryAfterSeconds
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryAfterSeconds,
        retryable: response.status === 429 || response.status >= 500
      });
      throw error;
    }

    finishIntegrationTrace(trace, {
      statusCode: response.status,
      retryAfterSeconds: extractRetryAfterSeconds(response.headers)
    });
    return response.status;
  } catch (error) {
    if (!(error instanceof WorkerGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

function formatGraphDateTime(iso: string) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.OUTLOOK_CALENDAR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = new Map(
    formatter
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}`;
}

function summarizeShiftNotes(notes: string | null) {
  if (!notes) {
    return null;
  }
  const compact = notes.replace(/\s+/g, " ").trim();
  return compact.length ? compact.slice(0, 240) : null;
}

function buildShiftBodyContent(shift: WorkShiftSyncRow) {
  const lines = [
    `Mission Control assignment`,
    `Role: ${shift.staffing_role ?? "photographer"}`,
    `Job ID: ${shift.shoot_id ?? "n/a"}`
  ];
  const noteSummary = summarizeShiftNotes(shift.notes);
  if (noteSummary) {
    lines.push(`Notes: ${noteSummary}`);
  }
  return lines.join("\n");
}

function buildShiftEventPayload(shift: WorkShiftSyncRow) {
  return {
    subject: shift.title,
    start: {
      dateTime: formatGraphDateTime(shift.starts_at),
      timeZone: config.OUTLOOK_CALENDAR_TIMEZONE
    },
    end: {
      dateTime: formatGraphDateTime(shift.ends_at),
      timeZone: config.OUTLOOK_CALENDAR_TIMEZONE
    },
    location: {
      displayName: [shift.location_name, shift.location_address].filter(Boolean).join(" | ")
    },
    body: {
      contentType: "text",
      content: buildShiftBodyContent(shift)
    },
    showAs: "busy",
    transactionId: `mission-control:${shift.id}:${shift.assigned_user_email ?? "unassigned"}:${shift.starts_at}`
  };
}

async function loadWorkShiftForSync(client: PoolClient, shiftId: string) {
  const { rows } = await client.query<WorkShiftSyncRow>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.shoot_id,
        ws.assigned_user_id,
        au.email AS assigned_user_email,
        au.full_name AS assigned_user_name,
        ws.title,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.location_name,
        ws.location_address,
        ws.notes,
        ws.staffing_role::text,
        ws.status::text,
        ws.cancelled_at::text,
        ws.outlook_event_id,
        ws.outlook_calendar_owner_email,
        ws.conflict_status::text,
        ws.conflict_detail
      FROM work_shift ws
      JOIN app_user au
        ON au.id = ws.assigned_user_id
      WHERE ws.id = $1
      LIMIT 1
    `,
    [shiftId]
  );

  return rows[0] ?? null;
}

async function loadSyncOperation(client: PoolClient, operationId: string) {
  const { rows } = await client.query<IntegrationSyncOperation>(
    `
      SELECT *
      FROM integration_sync_operation
      WHERE id = $1
      LIMIT 1
    `,
    [operationId]
  );
  return rows[0] ?? null;
}

async function markSyncOperation(
  client: PoolClient,
  operation: IntegrationSyncOperation,
  input: {
    status: "processing" | "succeeded" | "failed" | "conflict";
    externalId?: string | null;
    resultPayload?: Record<string, unknown>;
    lastError?: string | null;
    conflictSummary?: string | null;
    conflictPayload?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE integration_sync_operation
      SET status = $2,
          external_id = COALESCE($3, external_id),
          attempt_count = CASE WHEN $2 = 'processing' THEN attempt_count + 1 ELSE attempt_count END,
          last_attempt_at = CASE WHEN $2 = 'processing' THEN now() ELSE last_attempt_at END,
          result_payload = CASE WHEN $4::jsonb IS NULL THEN result_payload ELSE COALESCE(result_payload, '{}'::jsonb) || $4::jsonb END,
          last_error = CASE WHEN $5::text IS NULL THEN last_error ELSE $5 END,
          last_error_at = CASE WHEN $5::text IS NULL THEN last_error_at ELSE now() END,
          conflict_summary = $6,
          conflict_payload = CASE WHEN $7::jsonb IS NULL THEN conflict_payload ELSE $7::jsonb END,
          updated_at = now()
      WHERE id = $1
    `,
    [
      operation.id,
      input.status,
      input.externalId ?? null,
      input.resultPayload ? JSON.stringify(input.resultPayload) : null,
      input.lastError ?? null,
      input.conflictSummary ?? null,
      input.conflictPayload ? JSON.stringify(input.conflictPayload) : null
    ]
  );
}

async function createSyncAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    operationId: string;
    provider: string;
    direction: string;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO audit_log (tenant_id, actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1,$2,NULL,$3,$4,$5,$6::jsonb)
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify({
        integration_sync_operation_id: input.operationId,
        provider: input.provider,
        direction: input.direction,
        execution_mode: "sync-driven",
        ...(input.metadata ?? {})
      })
    ]
  );
}

async function upsertExternalObjectMap(
  client: PoolClient,
  input: {
    tenantId: string;
    externalId: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    }
  ) {
  const objectType = input.entityType === "work_shift" ? "shift" : input.entityType;
  await client.query(
    `
      INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload)
      VALUES ($1,'microsoft_graph',$2,$3,$4,$5::jsonb)
      ON CONFLICT (tenant_id, provider, external_id, object_type)
      DO UPDATE SET object_id = EXCLUDED.object_id, payload = EXCLUDED.payload
    `,
    [input.tenantId, input.externalId, objectType, input.entityId, JSON.stringify(input.payload)]
  );
}

async function deleteExternalObjectMap(
  client: PoolClient,
  input: {
    tenantId: string;
    externalId: string;
    entityType: string;
  }
) {
  const objectType = input.entityType === "work_shift" ? "shift" : input.entityType;
  await client.query(
    `
      DELETE FROM external_object_map
      WHERE tenant_id = $1
        AND provider = 'microsoft_graph'
        AND external_id = $2
        AND object_type = $3
    `,
    [input.tenantId, input.externalId, objectType]
  );
}

async function markScheduleEntitySynced(
  client: PoolClient,
  input: {
    entityType: string;
    entityId: string;
    synced: boolean;
    errorMessage?: string | null;
  }
) {
  if (input.entityType === "shoot") {
    await client.query(
      `
        UPDATE shoot
        SET schedule_sync_required = false,
            schedule_sync_state = CASE WHEN $2::boolean THEN 'in_sync'::schedule_sync_state ELSE 'sync_error'::schedule_sync_state END,
            schedule_last_synced_at = CASE WHEN $2::boolean THEN now() ELSE schedule_last_synced_at END,
            schedule_last_error = CASE WHEN $2::boolean THEN NULL ELSE $3 END,
            updated_at = now()
        WHERE id = $1
      `,
      [input.entityId, input.synced, input.errorMessage ?? "Microsoft Graph credentials missing"]
    );
    await client.query(
      `
        UPDATE schedule_event
        SET sync_required = false,
            sync_state = CASE WHEN $2::boolean THEN 'in_sync'::schedule_sync_state ELSE 'sync_error'::schedule_sync_state END,
            last_synced_at = CASE WHEN $2::boolean THEN now() ELSE last_synced_at END,
            last_sync_direction = CASE WHEN $2::boolean THEN 'outbound' ELSE last_sync_direction END,
            last_sync_error = CASE WHEN $2::boolean THEN NULL ELSE $3 END,
            sync_review_required = CASE WHEN $2::boolean THEN false ELSE sync_review_required END,
            sync_review_reason = CASE WHEN $2::boolean THEN NULL ELSE sync_review_reason END,
            external_changed_fields = CASE WHEN $2::boolean THEN '[]'::jsonb ELSE external_changed_fields END,
            external_change_snapshot = CASE WHEN $2::boolean THEN '{}'::jsonb ELSE external_change_snapshot END,
            updated_at = now()
        WHERE linked_shoot_id = $1
          AND deleted_at IS NULL
      `,
      [input.entityId, input.synced, input.errorMessage ?? "Microsoft Graph credentials missing"]
    );
    return;
  }

  if (input.entityType === "schedule_event") {
    await client.query(
      `
        UPDATE schedule_event
        SET sync_required = false,
            sync_state = CASE WHEN $2::boolean THEN 'in_sync'::schedule_sync_state ELSE 'sync_error'::schedule_sync_state END,
            last_synced_at = CASE WHEN $2::boolean THEN now() ELSE last_synced_at END,
            last_sync_direction = CASE WHEN $2::boolean THEN 'outbound' ELSE last_sync_direction END,
            last_sync_error = CASE WHEN $2::boolean THEN NULL ELSE $3 END,
            sync_review_required = CASE WHEN $2::boolean THEN false ELSE sync_review_required END,
            sync_review_reason = CASE WHEN $2::boolean THEN NULL ELSE sync_review_reason END,
            external_changed_fields = CASE WHEN $2::boolean THEN '[]'::jsonb ELSE external_changed_fields END,
            external_change_snapshot = CASE WHEN $2::boolean THEN '{}'::jsonb ELSE external_change_snapshot END,
            updated_at = now()
        WHERE id = $1
      `,
      [input.entityId, input.synced, input.errorMessage ?? "Microsoft Graph credentials missing"]
    );
    return;
  }

  await client.query(
    `
      UPDATE work_shift
      SET calendar_sync_required = false,
          calendar_last_synced_at = CASE WHEN $2::boolean THEN now() ELSE calendar_last_synced_at END,
          calendar_last_error = CASE WHEN $2::boolean THEN NULL ELSE $3 END,
          updated_at = now()
      WHERE id = $1
    `,
    [input.entityId, input.synced, input.errorMessage ?? "Microsoft Graph credentials missing"]
  );
}

type OutlookInboundBody = {
  event_id: string | null;
  calendar_id: string | null;
  subject: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  all_day: boolean;
  location: string | null;
  organizer: string | null;
  attendees: Array<Record<string, unknown>>;
  recurrence_master_id: string | null;
  recurrence_occurrence_id: string | null;
  body_preview: string | null;
  cancellation_state: string;
  last_modified_at: string | null;
};

type LinkedScheduleEventRow = {
  id: string;
  linked_shoot_id: string | null;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location_name: string | null;
  location_address: string | null;
  outlook_timezone: string | null;
  outlook_all_day: boolean | null;
  outlook_organizer: string | null;
  outlook_attendees: Array<Record<string, unknown>> | null;
  outlook_recurrence_master_id: string | null;
  outlook_recurrence_occurrence_id: string | null;
  outlook_body_preview: string | null;
  outlook_cancellation_state: string | null;
  external_last_modified_at: string | null;
  shift_count: string | null;
  planned_staff_count: number | null;
  shoot_title: string | null;
};

function toNullableString(value: unknown) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text.length ? text : null;
}

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeAttendees(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<Record<string, unknown>>;
  }
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractMicrosoftGraphNotifications(payload: Record<string, unknown>) {
  const body = asRecord(payload.body);
  const rawNotifications = Array.isArray(body?.value) ? body.value : Array.isArray(payload.value) ? payload.value : null;
  if (!rawNotifications) {
    return [] as MicrosoftGraphNotification[];
  }
  return rawNotifications
    .map((notification) => asRecord(notification))
    .filter((notification): notification is MicrosoftGraphNotification => Boolean(notification));
}

function extractMicrosoftGraphEventId(notification: MicrosoftGraphNotification) {
  const resourceData = asRecord(notification.resourceData);
  const directId = toNullableString(resourceData?.id);
  if (directId) {
    return directId;
  }
  const resource = toNullableString(notification.resource);
  if (!resource) {
    return null;
  }
  const match = resource.match(/\/events\/([^/?]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function buildNotificationChangeType(notification: MicrosoftGraphNotification) {
  return toNullableString(notification.changeType) ?? "updated";
}

function buildNotificationResourceLabel(notification: MicrosoftGraphNotification) {
  return toNullableString(notification.resource) ?? "microsoft_graph_notification";
}

function hasExpectedMicrosoftGraphClientState(notification: MicrosoftGraphNotification) {
  const expectedClientState = getConfiguredMicrosoftGraphWebhookClientState();
  if (!expectedClientState) {
    return true;
  }
  return typeof notification.clientState === "string" && notification.clientState === expectedClientState;
}

function buildNotificationSnapshot(notification: MicrosoftGraphNotification) {
  const resourceData = asRecord(notification.resourceData);
  const configuredClientState = getConfiguredMicrosoftGraphWebhookClientState();
  return {
    subscription_id: toNullableString(notification.subscriptionId),
    lifecycle_event: toNullableString(notification.lifecycleEvent),
    change_type: buildNotificationChangeType(notification),
    resource: buildNotificationResourceLabel(notification),
    resource_data: resourceData ?? {},
    client_state_present: typeof notification.clientState === "string" && notification.clientState.length > 0,
    client_state_valid: configuredClientState ? hasExpectedMicrosoftGraphClientState(notification) : null,
    tenant_id: toNullableString(notification.tenantId),
    subscription_expiration: toNullableString(notification.subscriptionExpirationDateTime)
  };
}

function normalizeInboundBody(payload: Record<string, unknown>): OutlookInboundBody {
  const body =
    payload.body && typeof payload.body === "object" && !Array.isArray(payload.body)
      ? (payload.body as Record<string, unknown>)
      : payload;
  const cancelled = toBoolean(body.cancelled) || toNullableString(body.cancellation_state) === "cancelled";
  return {
    event_id: toNullableString(body.event_id),
    calendar_id: toNullableString(body.calendar_id),
    subject: toNullableString(body.subject),
    starts_at: toNullableString(body.starts_at),
    ends_at: toNullableString(body.ends_at),
    timezone: toNullableString(body.timezone),
    all_day: toBoolean(body.all_day),
    location: toNullableString(body.location),
    organizer: toNullableString(body.organizer),
    attendees: normalizeAttendees(body.attendees),
    recurrence_master_id: toNullableString(body.recurrence_master_id),
    recurrence_occurrence_id: toNullableString(body.recurrence_occurrence_id),
    body_preview: toNullableString(body.body_preview),
    cancellation_state: cancelled ? "cancelled" : toNullableString(body.cancellation_state) ?? "active",
    last_modified_at: toNullableString(body.last_modified_at)
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function buildChangedFields(row: LinkedScheduleEventRow, incoming: OutlookInboundBody) {
  const changed = new Set<string>();
  if ((row.title ?? null) !== incoming.subject) {
    changed.add("title");
  }
  if ((row.starts_at ?? null) !== incoming.starts_at) {
    changed.add("starts_at");
  }
  if ((row.ends_at ?? null) !== incoming.ends_at) {
    changed.add("ends_at");
  }
  if ((row.outlook_timezone ?? null) !== incoming.timezone) {
    changed.add("timezone");
  }
  if (Boolean(row.outlook_all_day) !== incoming.all_day) {
    changed.add("all_day");
  }
  const currentLocation = row.location_name ?? row.location_address ?? null;
  if (currentLocation !== incoming.location) {
    changed.add("location");
  }
  if ((row.outlook_organizer ?? null) !== incoming.organizer) {
    changed.add("organizer");
  }
  if (!sameJson(row.outlook_attendees ?? [], incoming.attendees)) {
    changed.add("attendees");
  }
  if ((row.outlook_recurrence_master_id ?? null) !== incoming.recurrence_master_id) {
    changed.add("recurrence_master_id");
  }
  if ((row.outlook_recurrence_occurrence_id ?? null) !== incoming.recurrence_occurrence_id) {
    changed.add("recurrence_occurrence_id");
  }
  if ((row.outlook_body_preview ?? null) !== incoming.body_preview) {
    changed.add("body_preview");
  }
  if ((row.outlook_cancellation_state ?? "active") !== incoming.cancellation_state) {
    changed.add("cancellation_state");
  }
  return [...changed];
}

function buildReviewReason(changedFields: string[], hasLinkedShoot: boolean) {
  const important = changedFields.filter((field) =>
    ["starts_at", "ends_at", "location", "cancellation_state", "recurrence_master_id", "recurrence_occurrence_id", "organizer"].includes(field)
  );
  if (!important.length) {
    return null;
  }
  const reason = important
    .map((field) => {
      if (field === "starts_at" || field === "ends_at") {
        return "Outlook changed the event timing";
      }
      if (field === "location") {
        return "Outlook changed the event location";
      }
      if (field === "cancellation_state") {
        return "Outlook cancelled the event";
      }
      if (field.startsWith("recurrence")) {
        return "Outlook changed the recurrence pattern";
      }
      if (field === "organizer") {
        return "Outlook changed the organizer";
      }
      return "Outlook changed a calendar-owned field";
    })
    .filter((value, index, all) => all.indexOf(value) === index);
  return hasLinkedShoot
    ? `${reason.join(". ")}. Review staffing and readiness before treating this shoot as current.`
    : `${reason.join(". ")}. Review the linked event before trusting the current schedule.`;
}

async function loadLinkedScheduleEventByExternalId(client: PoolClient, tenantId: string, eventId: string, calendarId: string | null) {
  const values: unknown[] = [tenantId, eventId];
  let calendarClause = "";
  if (calendarId) {
    values.push(calendarId);
    calendarClause = ` AND ev.outlook_calendar_id = $${values.length}`;
  }
  const { rows } = await client.query<LinkedScheduleEventRow>(
    `
      SELECT
        ev.id,
        ev.linked_shoot_id,
        ev.title,
        ev.starts_at,
        ev.ends_at,
        ev.location_name,
        ev.location_address,
        ev.outlook_timezone,
        ev.outlook_all_day,
        ev.outlook_organizer,
        ev.outlook_attendees,
        ev.outlook_recurrence_master_id,
        ev.outlook_recurrence_occurrence_id,
        ev.outlook_body_preview,
        ev.outlook_cancellation_state,
        ev.external_last_modified_at,
        (
          SELECT count(*)::text
          FROM work_shift ws
          WHERE ws.shoot_id = ev.linked_shoot_id
            AND ws.cancelled_at IS NULL
        ) AS shift_count,
        s.planned_staff_count,
        s.title AS shoot_title
      FROM schedule_event ev
      LEFT JOIN shoot s ON s.id = ev.linked_shoot_id
      WHERE ev.tenant_id = $1
        AND ev.outlook_event_id = $2
        AND ev.deleted_at IS NULL
        ${calendarClause}
      ORDER BY ev.updated_at DESC
      LIMIT 1
    `,
    values
  );
  return rows[0] ?? null;
}

async function createInboundOperation(
  client: PoolClient,
  input: {
    tenantId: string;
    externalId: string;
    entityId?: string | null;
    status: "succeeded" | "conflict" | "failed";
    resultPayload: Record<string, unknown>;
    conflictSummary?: string | null;
    conflictPayload?: Record<string, unknown>;
    payload: Record<string, unknown>;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO integration_sync_operation (
        tenant_id, provider, direction, entity_type, entity_id, external_object_type, external_id,
        operation_type, source_system, source_change_key, status, payload, result_payload, conflict_summary, conflict_payload
      )
      VALUES ($1,'outlook','inbound','schedule_event',$2,'calendar_event',$3,'reconcile','microsoft_graph',$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb)
      RETURNING id
    `,
    [
      input.tenantId,
      input.entityId ?? null,
      input.externalId,
      `webhook:${input.externalId}:${Date.now()}`,
      input.status,
      JSON.stringify(input.payload),
      JSON.stringify(input.resultPayload),
      input.conflictSummary ?? null,
      JSON.stringify(input.conflictPayload ?? {})
    ]
  );
  return rows[0]?.id ?? null;
}

async function updateLinkedScheduleEventFromOutlook(
  client: PoolClient,
  tenantId: string,
  row: LinkedScheduleEventRow,
  incoming: OutlookInboundBody
) {
  const changedFields = buildChangedFields(row, incoming);
  const reviewReason = buildReviewReason(changedFields, Boolean(row.linked_shoot_id));
  const reviewRequired = Boolean(reviewReason);
  const snapshot = {
    title: incoming.subject,
    starts_at: incoming.starts_at,
    ends_at: incoming.ends_at,
    timezone: incoming.timezone,
    all_day: incoming.all_day,
    location: incoming.location,
    organizer: incoming.organizer,
    attendees: incoming.attendees,
    recurrence_master_id: incoming.recurrence_master_id,
    recurrence_occurrence_id: incoming.recurrence_occurrence_id,
    body_preview: incoming.body_preview,
    cancellation_state: incoming.cancellation_state,
    last_modified_at: incoming.last_modified_at
  };

  await client.query(
    `
      UPDATE schedule_event
      SET title = COALESCE($2, title),
          starts_at = COALESCE($3, starts_at),
          ends_at = COALESCE($4, ends_at),
          location_name = COALESCE($5, location_name),
          outlook_organizer = $6,
          outlook_timezone = $7,
          outlook_all_day = $8,
          outlook_attendees = $9::jsonb,
          outlook_recurrence_master_id = $10,
          outlook_recurrence_occurrence_id = $11,
          outlook_body_preview = $12,
          outlook_cancellation_state = $13,
          external_last_modified_at = COALESCE($14::timestamptz, external_last_modified_at),
          sync_required = false,
          sync_state = CASE WHEN $15::boolean THEN 'sync_warning'::schedule_sync_state ELSE 'in_sync'::schedule_sync_state END,
          last_synced_at = now(),
          last_sync_direction = 'inbound',
          last_sync_error = CASE WHEN $15::boolean THEN $16 ELSE NULL END,
          sync_review_required = $15,
          sync_review_reason = $16,
          external_changed_fields = $17::jsonb,
          external_change_snapshot = $18::jsonb,
          source_system = 'outlook',
          updated_at = now()
      WHERE id = $1
    `,
    [
      row.id,
      incoming.subject,
      incoming.starts_at,
      incoming.ends_at,
      incoming.location,
      incoming.organizer,
      incoming.timezone,
      incoming.all_day,
      JSON.stringify(incoming.attendees),
      incoming.recurrence_master_id,
      incoming.recurrence_occurrence_id,
      incoming.body_preview,
      incoming.cancellation_state,
      incoming.last_modified_at,
      reviewRequired,
      reviewReason,
      JSON.stringify(changedFields),
      JSON.stringify(snapshot)
    ]
  );

  if (row.linked_shoot_id) {
    await client.query(
      `
        UPDATE shoot
        SET schedule_sync_state = CASE WHEN $2::boolean THEN 'sync_warning'::schedule_sync_state ELSE 'in_sync'::schedule_sync_state END,
            schedule_last_synced_at = now(),
            schedule_last_error = CASE WHEN $2::boolean THEN $3 ELSE NULL END,
            updated_at = now()
        WHERE id = $1
      `,
      [row.linked_shoot_id, reviewRequired, reviewReason]
    );
  }

  const operationId = await createInboundOperation(client, {
    tenantId,
    externalId: incoming.event_id ?? row.id,
    entityId: row.id,
    status: reviewRequired ? "conflict" : "succeeded",
    resultPayload: {
      resolution: reviewRequired ? "review_required" : "accepted_external_change",
      changed_fields: changedFields,
      review_reason: reviewReason
    },
    conflictSummary: reviewRequired ? reviewReason : null,
    conflictPayload: reviewRequired ? { changed_fields: changedFields, snapshot } : {},
    payload: { body: snapshot }
  });

  await createSyncAudit(client, {
    tenantId,
    action: reviewRequired ? "integration.sync.conflict" : "integration.sync.succeeded",
    entityType: "schedule_event",
    entityId: row.id,
    operationId: operationId ?? `inbound-${row.id}`,
    provider: "outlook",
    direction: "inbound",
    metadata: {
      external_id: incoming.event_id,
      changed_fields: changedFields,
      review_required: reviewRequired,
      review_reason: reviewReason
    }
  });

  await client.query(
    `
      INSERT INTO audit_log (tenant_id, actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1,NULL,NULL,'calendar.external_change.reconciled','schedule_event',$2,$3::jsonb)
    `,
    [
      tenantId,
      row.id,
      JSON.stringify({
        integration_sync_operation_id: operationId,
        provider: "outlook",
        external_id: incoming.event_id,
        resolution: reviewRequired ? "review_required" : "accepted_external_change",
        changed_fields: changedFields,
        review_required: reviewRequired,
        review_reason: reviewReason,
        execution_mode: "sync-driven"
      })
    ]
  );

  if (incoming.event_id) {
    await upsertExternalObjectMap(client, {
      tenantId,
      externalId: incoming.event_id,
      entityType: "schedule_event",
      entityId: row.id,
      payload: snapshot
    });
  }

  return {
    externalId: incoming.event_id,
    changedFields,
    reviewRequired,
    reviewReason
  };
}

async function recordCalendarWebhookHealth(
  client: PoolClient,
  tenantId: string,
  input: {
    status: "healthy" | "warning" | "error";
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await upsertWorkerSyncHealthRecord(client, {
    tenantId,
    syncKey: CALENDAR_WEBHOOK_SYNC_KEY,
    resourceType: "graph_webhook",
    resourceId: "calendar_notifications",
    status: input.status,
    lastErrorCode: input.lastErrorCode ?? null,
    lastErrorMessage: input.lastErrorMessage ?? null,
    metadata: {
      provider: "microsoft_graph",
      channel: "calendar_notifications",
      retry_state: input.status === "healthy" ? "idle" : "inspect_webhook_payload",
      exception_category: "sync",
      exception_type: "calendar_webhook_attention",
      ...(input.metadata ?? {})
    }
  });
}

async function recordCalendarSubscriptionHealth(
  client: PoolClient,
  tenantId: string,
  input: {
    subscriptionId: string | null;
    resource: string | null;
    lifecycleEvent: string;
    status: "warning" | "error";
    message: string;
    retryState: string;
    metadata?: Record<string, unknown>;
  }
) {
  await upsertWorkerSyncHealthRecord(client, {
    tenantId,
    syncKey: CALENDAR_SUBSCRIPTION_SYNC_KEY,
    resourceType: "graph_subscription",
    resourceId: input.subscriptionId ?? input.resource ?? CALENDAR_SUBSCRIPTION_SYNC_KEY,
    status: input.status,
    lastErrorCode: input.lifecycleEvent,
    lastErrorMessage: input.message,
    metadata: {
      provider: "microsoft_graph",
      channel: "calendar_notifications",
      subscription_id: input.subscriptionId,
      resource: input.resource,
      lifecycle_event: input.lifecycleEvent,
      retry_state: input.retryState,
      exception_category: "sync",
      exception_type: "calendar_subscription_attention",
      ...(input.metadata ?? {})
    }
  });
}

async function markLinkedScheduleEventForExternalNotice(
  client: PoolClient,
  tenantId: string,
  row: LinkedScheduleEventRow,
  notification: MicrosoftGraphNotification,
  externalId: string
) {
  const changeType = buildNotificationChangeType(notification);
  const reviewReason =
    changeType === "deleted"
      ? "Microsoft Graph reported that the linked Outlook event was deleted. Review before Mission Control writes again."
      : "Microsoft Graph reported an external calendar change. Review before Mission Control writes again.";
  const snapshot = {
    observed_at: new Date().toISOString(),
    external_id: externalId,
    ...buildNotificationSnapshot(notification)
  };

  await client.query(
    `
      UPDATE schedule_event
      SET
        sync_required = false,
        sync_state = 'sync_warning'::schedule_sync_state,
        last_synced_at = now(),
        last_sync_direction = 'inbound',
        last_sync_error = $2,
        sync_review_required = true,
        sync_review_reason = $2,
        external_changed_fields = '["external_change_notice"]'::jsonb,
        external_change_snapshot = $3::jsonb,
        source_system = 'outlook',
        updated_at = now()
      WHERE id = $1
    `,
    [row.id, reviewReason, JSON.stringify(snapshot)]
  );

  if (row.linked_shoot_id) {
    await client.query(
      `
        UPDATE shoot
        SET
          schedule_sync_state = 'sync_warning'::schedule_sync_state,
          schedule_last_synced_at = now(),
          schedule_last_error = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [row.linked_shoot_id, reviewReason]
    );
  }

  const operationId = await createInboundOperation(client, {
    tenantId,
    externalId,
    entityId: row.id,
    status: "conflict",
    resultPayload: {
      resolution: "review_required",
      reason: "external_change_notice",
      changed_fields: ["external_change_notice"],
      review_reason: reviewReason
    },
    conflictSummary: reviewReason,
    conflictPayload: {
      change_type: changeType,
      notification: snapshot
    },
    payload: {
      body: snapshot
    }
  });

  await createSyncAudit(client, {
    tenantId,
    action: "integration.sync.conflict",
    entityType: "schedule_event",
    entityId: row.id,
    operationId: operationId ?? `notification-${row.id}`,
    provider: "outlook",
    direction: "inbound",
    metadata: {
      external_id: externalId,
      change_type: changeType,
      review_required: true,
      review_reason: reviewReason,
      resolution: "review_required"
    }
  });

  await client.query(
    `
      INSERT INTO audit_log (tenant_id, actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1,NULL,NULL,'calendar.external_change.reconciled','schedule_event',$2,$3::jsonb)
    `,
    [
      tenantId,
      row.id,
      JSON.stringify({
        integration_sync_operation_id: operationId,
        provider: "outlook",
        external_id: externalId,
        resolution: "review_required",
        changed_fields: ["external_change_notice"],
        review_required: true,
        review_reason: reviewReason,
        execution_mode: "sync-driven",
        change_type: changeType
      })
    ]
  );

  await recordWorkerMicrosoftIntegrationEvent(client, {
    tenantId,
    area: "outlook_calendar_sync",
    level: "warning",
    eventType: "outlook.calendar_notification.review_required",
    eventStatus: "review_required",
    summary: "A Microsoft Graph calendar notification marked a linked schedule event for review.",
    detail: snapshot,
    relatedEntityType: "schedule_event",
    relatedEntityId: row.id,
    externalTarget: buildNotificationResourceLabel(notification)
  });
  await writeWorkerMicrosoftExternalAudit(client, {
    tenantId,
    eventCategory: "microsoft_outlook_calendar",
    eventType: "outlook.calendar_notification.reconcile",
    resourceType: "schedule_event",
    resourceId: row.id,
    result: "review_required",
    context: snapshot
  });
}

async function handleMicrosoftGraphLifecycleNotification(
  client: PoolClient,
  tenantId: string,
  notification: MicrosoftGraphNotification
) {
  const lifecycleEvent = toNullableString(notification.lifecycleEvent) ?? "unknown_lifecycle_event";
  const subscriptionId = toNullableString(notification.subscriptionId);
  const resource = buildNotificationResourceLabel(notification);
  const message =
    lifecycleEvent === "reauthorizationRequired"
      ? "Microsoft Graph requires subscription reauthorization before calendar notifications stay healthy."
      : lifecycleEvent === "subscriptionRemoved"
        ? "Microsoft Graph removed a calendar subscription and Mission Control needs explicit renewal."
        : lifecycleEvent === "missed"
          ? "Microsoft Graph reported missed calendar notifications and Mission Control should run an explicit resync."
          : `Microsoft Graph reported the ${lifecycleEvent} lifecycle event for a calendar subscription.`;
  const status = lifecycleEvent === "subscriptionRemoved" ? "error" : "warning";
  const retryState =
    lifecycleEvent === "reauthorizationRequired"
      ? "reauthorization_required"
      : lifecycleEvent === "subscriptionRemoved"
        ? "manual_resubscribe_required"
        : lifecycleEvent === "missed"
          ? "delta_or_manual_resync_required"
          : "manual_attention";
  const detail = {
    ...buildNotificationSnapshot(notification),
    subscription_id: subscriptionId,
    resource,
    lifecycle_event: lifecycleEvent,
    retry_state: retryState
  };

  await recordCalendarSubscriptionHealth(client, tenantId, {
    subscriptionId,
    resource,
    lifecycleEvent,
    status,
    message,
    retryState,
    metadata: detail
  });
  await recordWorkerMicrosoftIntegrationEvent(client, {
    tenantId,
    area: "outlook_calendar_sync",
    level: status === "error" ? "error" : "warning",
    eventType: "outlook.calendar_subscription.lifecycle",
    eventStatus: lifecycleEvent,
    summary: message,
    detail,
    relatedEntityType: "graph_subscription",
    relatedEntityId: subscriptionId,
    externalTarget: resource
  });
  await writeWorkerMicrosoftExternalAudit(client, {
    tenantId,
    eventCategory: "microsoft_outlook_calendar",
    eventType: "outlook.calendar_subscription.lifecycle",
    resourceType: "graph_subscription",
    resourceId: subscriptionId,
    result: retryState,
    context: detail
  });
}

async function handleMicrosoftGraphInvalidClientStateNotification(
  client: PoolClient,
  tenantId: string,
  notification: MicrosoftGraphNotification
) {
  const detail = {
    reason: "invalid_client_state",
    retry_state: "inspect_subscription_client_state",
    ...buildNotificationSnapshot(notification)
  };
  await recordWorkerMicrosoftIntegrationEvent(client, {
    tenantId,
    area: "outlook_calendar_sync",
    level: "error",
    eventType: "outlook.calendar_notification.invalid_client_state",
    eventStatus: "ignored",
    summary: "Mission Control ignored a Microsoft Graph notification because its client state did not match the configured subscription secret.",
    detail,
    relatedEntityType: "graph_webhook",
    relatedEntityId: toNullableString(notification.subscriptionId),
    externalTarget: buildNotificationResourceLabel(notification)
  });
  await writeWorkerMicrosoftExternalAudit(client, {
    tenantId,
    eventCategory: "microsoft_outlook_calendar",
    eventType: "outlook.calendar_notification.invalid_client_state",
    resourceType: "graph_webhook",
    resourceId: toNullableString(notification.subscriptionId),
    result: "ignored",
    context: detail
  });
}

async function handleMicrosoftGraphMalformedNotification(
  client: PoolClient,
  tenantId: string,
  notification: MicrosoftGraphNotification
) {
  const detail = {
    reason: "missing_event_id",
    ...buildNotificationSnapshot(notification)
  };
  await recordWorkerMicrosoftIntegrationEvent(client, {
    tenantId,
    area: "outlook_calendar_sync",
    level: "warning",
    eventType: "outlook.calendar_notification.invalid",
    eventStatus: "ignored",
    summary: "Mission Control ignored a malformed Microsoft Graph calendar notification.",
    detail,
    relatedEntityType: "graph_webhook",
    relatedEntityId: toNullableString(notification.subscriptionId),
    externalTarget: buildNotificationResourceLabel(notification)
  });
  await writeWorkerMicrosoftExternalAudit(client, {
    tenantId,
    eventCategory: "microsoft_outlook_calendar",
    eventType: "outlook.calendar_notification.invalid",
    resourceType: "graph_webhook",
    resourceId: toNullableString(notification.subscriptionId),
    result: "ignored",
    context: detail
  });
}

async function handleMicrosoftGraphChangeNotification(
  client: PoolClient,
  tenantId: string,
  notification: MicrosoftGraphNotification
) {
  const externalId = extractMicrosoftGraphEventId(notification);
  if (!externalId) {
    await handleMicrosoftGraphMalformedNotification(client, tenantId, notification);
    return { resolution: "ignored", reason: "missing_event_id" } as const;
  }

  const linked = await loadLinkedScheduleEventByExternalId(client, tenantId, externalId, null);
  if (!linked) {
    const operationId = await createInboundOperation(client, {
      tenantId,
      externalId,
      status: "conflict",
      resultPayload: { resolution: "unmatched_external_change" },
      conflictSummary: "Mission Control could not match the Microsoft Graph notification to a linked schedule record.",
      conflictPayload: buildNotificationSnapshot(notification),
      payload: {
        body: buildNotificationSnapshot(notification)
      }
    });
    await createSyncAudit(client, {
      tenantId,
      action: "integration.sync.conflict",
      entityType: "schedule_event",
      entityId: null,
      operationId: operationId ?? `notification-unmatched-${externalId}`,
      provider: "outlook",
      direction: "inbound",
      metadata: {
        external_id: externalId,
        change_type: buildNotificationChangeType(notification),
        resolution: "unmatched_external_change"
      }
    });
    await recordWorkerMicrosoftIntegrationEvent(client, {
      tenantId,
      area: "outlook_calendar_sync",
      level: "warning",
      eventType: "outlook.calendar_notification.unmatched",
      eventStatus: "review_required",
      summary: "Mission Control could not match a Microsoft Graph calendar notification to a linked schedule record.",
      detail: buildNotificationSnapshot(notification),
      relatedEntityType: "graph_webhook",
      relatedEntityId: externalId,
      externalTarget: buildNotificationResourceLabel(notification)
    });
    await writeWorkerMicrosoftExternalAudit(client, {
      tenantId,
      eventCategory: "microsoft_outlook_calendar",
      eventType: "outlook.calendar_notification.reconcile",
      resourceType: "calendar_event",
      resourceId: externalId,
      result: "unmatched_external_change",
      context: buildNotificationSnapshot(notification)
    });
    return { resolution: "unmatched_external_change", externalId } as const;
  }

  await markLinkedScheduleEventForExternalNotice(client, tenantId, linked, notification, externalId);
  return { resolution: "review_required", externalId, scheduleEventId: linked.id } as const;
}

async function processMicrosoftGraphNotificationBatch(
  client: PoolClient,
  tenantId: string,
  payload: Record<string, unknown>,
  notifications: MicrosoftGraphNotification[]
) {
  const results: Array<Record<string, unknown>> = [];
  let changeCount = 0;
  let lifecycleCount = 0;
  let malformedCount = 0;
  let invalidClientStateCount = 0;

  for (const notification of notifications) {
    if (!hasExpectedMicrosoftGraphClientState(notification)) {
      invalidClientStateCount += 1;
      await handleMicrosoftGraphInvalidClientStateNotification(client, tenantId, notification);
      results.push({
        kind: "invalid",
        reason: "invalid_client_state",
        subscription_id: toNullableString(notification.subscriptionId)
      });
      continue;
    }

    const lifecycleEvent = toNullableString(notification.lifecycleEvent);
    if (lifecycleEvent) {
      lifecycleCount += 1;
      await handleMicrosoftGraphLifecycleNotification(client, tenantId, notification);
      results.push({
        kind: "lifecycle",
        lifecycle_event: lifecycleEvent,
        subscription_id: toNullableString(notification.subscriptionId)
      });
      continue;
    }

    const handled = await handleMicrosoftGraphChangeNotification(client, tenantId, notification);
    if ("reason" in handled && handled.reason === "missing_event_id") {
      malformedCount += 1;
    } else {
      changeCount += 1;
    }
    results.push(handled as Record<string, unknown>);
  }

  if (notifications.length > 0) {
    await recordCalendarWebhookHealth(client, tenantId, {
      status: invalidClientStateCount > 0 ? "error" : malformedCount > 0 && changeCount === 0 && lifecycleCount === 0 ? "warning" : "healthy",
      lastErrorCode: invalidClientStateCount > 0 ? "invalid_client_state" : malformedCount > 0 ? "partial_notification_decode" : null,
      lastErrorMessage:
        invalidClientStateCount > 0
          ? "One or more Microsoft Graph notifications did not match the configured subscription client state."
          : malformedCount > 0
            ? "One or more Microsoft Graph notifications were missing calendar event identifiers."
            : null,
      metadata: {
        notification_count: notifications.length,
        change_count: changeCount,
        lifecycle_count: lifecycleCount,
        malformed_count: malformedCount,
        invalid_client_state_count: invalidClientStateCount,
        body_keys: Object.keys(asRecord(payload.body) ?? {}),
        retry_state:
          invalidClientStateCount > 0
            ? "inspect_subscription_client_state"
            : malformedCount > 0
              ? "inspect_webhook_payload"
              : "idle"
      }
    });
  }

  return {
    code: "reconciled",
    response: {
      notification_count: notifications.length,
      change_count: changeCount,
      lifecycle_count: lifecycleCount,
      malformed_count: malformedCount,
      invalid_client_state_count: invalidClientStateCount,
      results
    }
  };
}

async function markWorkShiftSyncResult(
  client: PoolClient,
  input: {
    shiftId: string;
    status: "pending" | "processing" | "synced" | "failed" | "cancelled";
    externalId?: string | null;
    calendarOwnerEmail?: string | null;
    errorMessage?: string | null;
    clearBinding?: boolean;
  }
) {
  await client.query(
    `
      UPDATE work_shift
      SET calendar_sync_required = CASE WHEN $2::outlook_shift_sync_status IN ('synced', 'cancelled') THEN false ELSE true END,
          calendar_last_synced_at = CASE WHEN $2::outlook_shift_sync_status IN ('synced', 'cancelled') THEN now() ELSE calendar_last_synced_at END,
          calendar_last_error = CASE WHEN $2::outlook_shift_sync_status IN ('synced', 'cancelled') THEN NULL ELSE $5 END,
          sync_status = $2::outlook_shift_sync_status,
          synced_at = CASE WHEN $2::outlook_shift_sync_status IN ('synced', 'cancelled') THEN now() ELSE synced_at END,
          last_sync_attempt_at = now(),
          sync_error = CASE WHEN $2::outlook_shift_sync_status IN ('synced', 'cancelled') THEN NULL ELSE $5 END,
          outlook_event_id = CASE
            WHEN $6::boolean THEN NULL
            WHEN $3::text IS NULL THEN outlook_event_id
            ELSE $3
          END,
          outlook_calendar_owner_email = CASE
            WHEN $6::boolean THEN NULL
            WHEN $4::text IS NULL THEN outlook_calendar_owner_email
            ELSE $4
          END,
          updated_at = now()
      WHERE id = $1
    `,
    [
      input.shiftId,
      input.status,
      input.externalId ?? null,
      input.calendarOwnerEmail ?? null,
      input.errorMessage ?? null,
      Boolean(input.clearBinding)
    ]
  );
}

async function createGraphEvent(
  accessToken: string,
  ownerEmail: string,
  payload: Record<string, unknown>,
  correlationId?: string | null
) {
  return fetchGraphJson<GraphEventResponse>(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(ownerEmail)}/calendar/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    { operation: "create_calendar_event", correlationId }
  );
}

async function updateGraphEvent(
  accessToken: string,
  ownerEmail: string,
  eventId: string,
  payload: Record<string, unknown>,
  correlationId?: string | null
) {
  return fetchGraphJson<GraphEventResponse>(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(ownerEmail)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    { operation: "update_calendar_event", correlationId }
  );
}

async function cancelOrDeleteGraphEvent(
  accessToken: string,
  ownerEmail: string,
  eventId: string,
  correlationId?: string | null
) {
  if (config.OUTLOOK_SYNC_CANCEL_MODE === "delete") {
    return fetchGraphNoContent(
      accessToken,
      `${GRAPH_API_BASE}/users/${encodeURIComponent(ownerEmail)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE"
      },
      { operation: "delete_calendar_event", correlationId }
    );
  }

  return fetchGraphNoContent(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(ownerEmail)}/events/${encodeURIComponent(eventId)}/cancel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        comment: "Mission Control cancelled this assignment."
      })
    },
    { operation: "cancel_calendar_event", correlationId }
  );
}

async function syncWorkShiftToOutlookOperation(
  client: PoolClient,
  operation: IntegrationSyncOperation
): Promise<SyncOutcome> {
  if (!operation.entity_id) {
    return {
      code: "skipped",
      externalId: null,
      response: { reason: "missing_shift_id" }
    };
  }

  if (!hasGraphCredentials()) {
    await markWorkShiftSyncResult(client, {
      shiftId: operation.entity_id,
      status: "failed",
      errorMessage: "Outlook app-permission sync is disabled for the delegated read-only pilot"
    });
    return {
      code: "disabled",
      externalId: null,
      response: {
        provider: "microsoft_graph_disabled",
        reason: "delegated_read_only_pilot"
      }
    };
  }

  const shift = await loadWorkShiftForSync(client, operation.entity_id);
  if (!shift) {
    return {
      code: "skipped",
      externalId: null,
      response: { reason: "missing_shift_record" }
    };
  }

  const payload = operation.payload ?? {};
  const operationType = String(payload.operation_type ?? operation.operation_type ?? (shift.cancelled_at ? "cancel" : "upsert")).toLowerCase();
  const currentOwnerEmail = shift.assigned_user_email?.trim() || null;
  const previousOwnerEmail =
    (typeof payload.previous_outlook_calendar_owner_email === "string" && payload.previous_outlook_calendar_owner_email.trim()) ||
    shift.outlook_calendar_owner_email ||
    (typeof payload.previous_assigned_user_email === "string" && payload.previous_assigned_user_email.trim()) ||
    null;
  const previousEventId =
    (typeof payload.previous_outlook_event_id === "string" && payload.previous_outlook_event_id.trim()) ||
    shift.outlook_event_id ||
    null;

  await markWorkShiftSyncResult(client, {
    shiftId: shift.id,
    status: "processing",
    externalId: shift.outlook_event_id,
    calendarOwnerEmail: shift.outlook_calendar_owner_email,
    clearBinding: false
  });

  try {
    const accessToken = await ensureGraphApplicationAccessToken(operation.id);

    if (operationType === "cancel" || shift.cancelled_at) {
      if (previousEventId && previousOwnerEmail) {
        await cancelOrDeleteGraphEvent(accessToken, previousOwnerEmail, previousEventId, operation.id);
        await deleteExternalObjectMap(client, {
          tenantId: shift.tenant_id,
          externalId: previousEventId,
          entityType: "work_shift"
        });
      }

      await markWorkShiftSyncResult(client, {
        shiftId: shift.id,
        status: "cancelled",
        externalId: null,
        calendarOwnerEmail: null,
        clearBinding: true
      });

      return {
        code: "synced",
        externalId: previousEventId,
        response: {
          provider: "microsoft_graph",
          action: config.OUTLOOK_SYNC_CANCEL_MODE,
          owner_email: previousOwnerEmail,
          event_id: previousEventId
        }
      };
    }

    if (!currentOwnerEmail) {
      await markWorkShiftSyncResult(client, {
        shiftId: shift.id,
        status: "failed",
        errorMessage: "Assigned user email is required for Outlook calendar sync"
      });
      return {
        code: "conflict",
        externalId: null,
        response: {
          provider: "microsoft_graph",
          reason: "missing_assigned_user_email"
        }
      };
    }

    let eventId = shift.outlook_event_id;
    if (previousEventId && previousOwnerEmail && previousOwnerEmail !== currentOwnerEmail) {
      await cancelOrDeleteGraphEvent(accessToken, previousOwnerEmail, previousEventId);
      await deleteExternalObjectMap(client, {
        tenantId: shift.tenant_id,
        externalId: previousEventId,
        entityType: "work_shift"
      });
      eventId = null;
    }

    const eventPayload = buildShiftEventPayload(shift);
    let eventResponse: GraphEventResponse;
    if (eventId && (shift.outlook_calendar_owner_email ?? previousOwnerEmail) === currentOwnerEmail) {
      try {
        eventResponse = await updateGraphEvent(accessToken, currentOwnerEmail, eventId, eventPayload, operation.id);
      } catch (error) {
        if (error instanceof WorkerGraphError && error.status === 404) {
          eventResponse = await createGraphEvent(accessToken, currentOwnerEmail, eventPayload, operation.id);
        } else {
          throw error;
        }
      }
    } else {
      eventResponse = await createGraphEvent(accessToken, currentOwnerEmail, eventPayload, operation.id);
    }

    const nextEventId = eventResponse.id ?? eventId;
    if (!nextEventId) {
      throw new WorkerGraphError("graph_event_missing_id", "Microsoft Graph did not return an event id", 502);
    }

    const syncPayload = {
      provider: "microsoft_graph",
      owner_email: currentOwnerEmail,
      web_link: eventResponse.webLink ?? null,
      action: eventId ? "updated" : "created",
      shift_id: shift.id,
      conflict_status: shift.conflict_status ?? "clear",
      conflict_detail: shift.conflict_detail ?? {}
    };

    await upsertExternalObjectMap(client, {
      tenantId: shift.tenant_id,
      externalId: nextEventId,
      entityType: "work_shift",
      entityId: shift.id,
      payload: syncPayload
    });
    if (previousEventId && previousEventId !== nextEventId) {
      await deleteExternalObjectMap(client, {
        tenantId: shift.tenant_id,
        externalId: previousEventId,
        entityType: "work_shift"
      });
    }

    await markWorkShiftSyncResult(client, {
      shiftId: shift.id,
      status: "synced",
      externalId: nextEventId,
      calendarOwnerEmail: currentOwnerEmail
    });

    return {
      code: "synced",
      externalId: nextEventId,
      response: syncPayload
    };
  } catch (error) {
    await markWorkShiftSyncResult(client, {
      shiftId: shift.id,
      status: "failed",
      externalId: shift.outlook_event_id ?? previousEventId ?? null,
      calendarOwnerEmail: shift.outlook_calendar_owner_email ?? previousOwnerEmail ?? currentOwnerEmail,
      errorMessage: error instanceof Error ? error.message : "Unknown Outlook calendar sync failure",
      clearBinding: false
    });
    throw error;
  }
}

async function syncEntityToOutlook(
  client: PoolClient,
  operation: IntegrationSyncOperation
): Promise<SyncOutcome> {
  if (operation.entity_type === "work_shift") {
    return syncWorkShiftToOutlookOperation(client, operation);
  }

  if (!operation.entity_id) {
    return {
      code: "skipped",
      externalId: null,
      response: { reason: "missing_entity_id" }
    };
  }

  const externalId = buildExternalId(operation.entity_type, operation.entity_id);
  const response = {
    provider: "microsoft_graph_disabled",
    external_id: externalId,
    synced: false,
    reason: "delegated_read_only_pilot"
  };

  await markScheduleEntitySynced(client, {
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    synced: false,
    errorMessage: "Outlook app-permission sync is disabled for the delegated read-only pilot"
  });

  return {
    code: "disabled",
    externalId,
    response
  };
}

export async function processIntegrationSyncOperation(client: PoolClient, operationId: string) {
  const operation = await loadSyncOperation(client, operationId);
  if (!operation) {
    return { code: "skipped", response: { reason: "missing_operation" } };
  }
  if (operation.status === "succeeded") {
    return { code: "skipped", response: { reason: "already_succeeded" } };
  }
  if (operation.provider !== "outlook" && operation.status !== "pending") {
    return { code: "skipped", response: { reason: "already_finalized_non_outlook_operation" } };
  }

  await markSyncOperation(client, operation, { status: "processing" });
  await createSyncAudit(client, {
    tenantId: operation.tenant_id,
    actorUserId: operation.triggered_by_user_id,
    action: "integration.sync.processing",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    operationId: operation.id,
    provider: operation.provider,
    direction: operation.direction
  });

  try {
    if (operation.provider !== "outlook") {
      const message = "Only Outlook sync operations are worker-processed in phase 1";
      await markSyncOperation(client, operation, {
        status: "failed",
        lastError: message,
        resultPayload: { provider: operation.provider }
      });
      await createSyncAudit(client, {
        tenantId: operation.tenant_id,
        actorUserId: operation.triggered_by_user_id,
        action: "integration.sync.failed",
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        operationId: operation.id,
        provider: operation.provider,
        direction: operation.direction,
        metadata: { error: message }
      });
      return { code: "skipped", response: { reason: message } };
    }

    if (operation.direction !== "outbound") {
      const message = "Outbound processing only";
      await markSyncOperation(client, operation, {
        status: "failed",
        lastError: message
      });
      await createSyncAudit(client, {
        tenantId: operation.tenant_id,
        actorUserId: operation.triggered_by_user_id,
        action: "integration.sync.failed",
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        operationId: operation.id,
        provider: operation.provider,
        direction: operation.direction,
        metadata: { error: message }
      });
      return { code: "skipped", response: { reason: message } };
    }

    const outcome = await syncEntityToOutlook(client, operation);
    if (outcome.code === "synced" || outcome.code === "disabled" || outcome.code === "skipped") {
      await markSyncOperation(client, operation, {
        status: outcome.code === "synced" ? "succeeded" : outcome.code === "disabled" ? "failed" : "failed",
        externalId: outcome.externalId,
        resultPayload: outcome.response,
        lastError:
          outcome.code === "disabled"
            ? "Outlook app-permission sync is disabled for the delegated read-only pilot"
            : outcome.code === "skipped"
              ? "Sync skipped"
              : null
      });
      await createSyncAudit(client, {
        tenantId: operation.tenant_id,
        actorUserId: operation.triggered_by_user_id,
        action: outcome.code === "synced" ? "integration.sync.succeeded" : "integration.sync.failed",
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        operationId: operation.id,
        provider: operation.provider,
        direction: operation.direction,
        metadata: {
          external_id: outcome.externalId,
          result: outcome.response
        }
      });
    }
    return { code: outcome.code, response: outcome.response };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown integration sync error";
    const graphErrorMetadata = buildGraphErrorMetadata(error);
    await markSyncOperation(client, operation, {
      status: "failed",
      lastError: message,
      resultPayload: {
        error: message,
        ...graphErrorMetadata
      }
    });
    await createSyncAudit(client, {
      tenantId: operation.tenant_id,
      actorUserId: operation.triggered_by_user_id,
      action: "integration.sync.failed",
      entityType: operation.entity_type,
      entityId: operation.entity_id,
      operationId: operation.id,
      provider: operation.provider,
      direction: operation.direction,
      metadata: {
        error: message,
        ...graphErrorMetadata
      }
    });
    throw error;
  }
}

export async function syncShiftToOutlook(client: PoolClient, payload: Record<string, unknown>) {
  const entityId = String(payload.shift_id ?? payload.entity_id ?? "");
  if (!entityId) {
    return { code: "skipped", response: { reason: "missing_shift_id" } };
  }
  const operation: IntegrationSyncOperation = {
    id: `legacy-${entityId}`,
    tenant_id: String(payload.tenant_id ?? ""),
    provider: "outlook",
    direction: "outbound",
    entity_type: "work_shift",
    entity_id: entityId,
    external_object_type: "calendar_event",
    external_id: null,
    operation_type: "upsert",
    source_system: "mission_control",
    source_change_key: null,
    status: "processing",
    triggered_by_user_id: null,
    payload
  };
  return syncEntityToOutlook(client, operation);
}

export async function reconcileExternalCalendarChange(client: PoolClient, tenantId: string, payload: Record<string, unknown>) {
  const notifications = extractMicrosoftGraphNotifications(payload);
  if (notifications.length > 0) {
    return processMicrosoftGraphNotificationBatch(client, tenantId, payload, notifications);
  }

  const incoming = normalizeInboundBody(payload);
  const externalId = incoming.event_id ?? "unknown";
  if (!incoming.event_id) {
    const operationId = await createInboundOperation(client, {
      tenantId,
      externalId,
      status: "failed",
      resultPayload: { resolution: "ignored", reason: "missing_event_id" },
      payload
    });
    await createSyncAudit(client, {
      tenantId,
      action: "integration.sync.failed",
      entityType: "schedule_event",
      entityId: null,
      operationId: operationId ?? `inbound-missing-${Date.now()}`,
      provider: "outlook",
      direction: "inbound",
      metadata: {
        external_id: externalId,
        error: "Missing Outlook event id"
      }
    });
    return { code: "skipped", response: { reason: "missing_event_id" } };
  }

  const linked = await loadLinkedScheduleEventByExternalId(client, tenantId, incoming.event_id, incoming.calendar_id);
  if (!linked) {
    const operationId = await createInboundOperation(client, {
      tenantId,
      externalId: incoming.event_id,
      status: "conflict",
      resultPayload: { resolution: "unmatched_external_change" },
      conflictSummary: "Mission Control could not match the Outlook event to a linked schedule record.",
      conflictPayload: {
        external_id: incoming.event_id,
        calendar_id: incoming.calendar_id
      },
      payload
    });
    await createSyncAudit(client, {
      tenantId,
      action: "integration.sync.conflict",
      entityType: "schedule_event",
      entityId: null,
      operationId: operationId ?? `unmatched-${incoming.event_id}`,
      provider: "outlook",
      direction: "inbound",
      metadata: {
        external_id: incoming.event_id,
        calendar_id: incoming.calendar_id,
        resolution: "unmatched_external_change"
      }
    });
    await client.query(
      `
        INSERT INTO audit_log (tenant_id, actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
        VALUES ($1,NULL,NULL,'calendar.external_change.reconciled','schedule_event',NULL,$2::jsonb)
      `,
      [
        tenantId,
        JSON.stringify({
          integration_sync_operation_id: operationId,
          provider: "outlook",
          external_id: incoming.event_id,
          resolution: "unmatched_external_change",
          execution_mode: "sync-driven"
        })
      ]
    );
    return { code: "reconciled", response: { externalId: incoming.event_id, resolution: "unmatched_external_change" } };
  }

  const result = await updateLinkedScheduleEventFromOutlook(client, tenantId, linked, incoming);
  return {
    code: "reconciled",
    response: {
      externalId: result.externalId,
      resolution: result.reviewRequired ? "review_required" : "accepted_external_change",
      changedFields: result.changedFields
    }
  };
}
