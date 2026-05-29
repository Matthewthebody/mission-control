import type { PoolClient } from "pg";
import { config } from "../config.js";
import { failIntegrationTrace, finishIntegrationTrace, startIntegrationTrace } from "../utils/integrationTelemetry.js";

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

type CachedGraphToken = {
  accessToken: string;
  expiresAtMs: number;
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

type MeetingParticipantRecord = {
  user_id: string;
  full_name: string;
  email: string;
  role: "organizer" | "attendee";
};

type MeetingOperationRow = {
  id: string;
  tenant_id: string;
  meeting_id: string;
  operation_type: "create" | "update" | "cancel";
  trigger_source: string;
  actor_user_id: string | null;
  status: "queued" | "processing" | "succeeded" | "failed" | "throttled" | "skipped";
  request_payload: Record<string, unknown> | null;
  meeting_mode: "calendar_event" | "standalone_online_meeting";
  meeting_status: string;
  title: string;
  description: string | null;
  meeting_join_url: string | null;
  meeting_web_url: string | null;
  external_meeting_id: string | null;
  external_calendar_event_id: string | null;
  organizer_user_id: string | null;
  organizer_email: string | null;
  organizer_microsoft_user_id: string | null;
  participant_snapshot: MeetingParticipantRecord[] | null;
  app_deep_link: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
  linked_record_type: string;
  linked_record_id: string;
};

type GraphEventResponse = {
  id?: string;
  webLink?: string | null;
  onlineMeetingUrl?: string | null;
  onlineMeeting?: {
    joinUrl?: string | null;
  } | null;
};

type GraphOnlineMeetingResponse = {
  id?: string;
  joinWebUrl?: string | null;
};

type MeetingSyncResult = {
  meetingJoinUrl: string | null;
  meetingWebUrl: string | null;
  externalMeetingId: string | null;
  externalCalendarEventId: string | null;
  responsePayload: Record<string, unknown>;
};

let cachedToken: CachedGraphToken | null = null;

class TeamsMeetingGraphError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false
  ) {
    super(message);
  }
}

function isTeamsMeetingsConfigured() {
  return Boolean(
    config.MICROSOFT_TEAMS_MEETINGS_ENABLED &&
      config.MICROSOFT_GRAPH_CLIENT_ID &&
      config.MICROSOFT_GRAPH_CLIENT_SECRET &&
      config.MICROSOFT_GRAPH_TENANT_ID
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function buildCalendarMeetingBody(operation: MeetingOperationRow) {
  const lines = [
    escapeHtml(operation.description ?? `Internal Teams meeting linked to ${operation.linked_record_type} ${operation.linked_record_id}.`)
  ];
  if (operation.app_deep_link) {
    lines.push(`<a href="${escapeHtml(operation.app_deep_link)}">Open in Mission Control</a>`);
  }
  return lines.join("<br/><br/>");
}

function buildCalendarAttendees(operation: MeetingOperationRow) {
  return (operation.participant_snapshot ?? [])
    .filter((participant) => participant.role === "attendee" && participant.email)
    .map((participant) => ({
      emailAddress: {
        address: participant.email,
        name: participant.full_name
      },
      type: "required"
    }));
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.TEAMS_MEETING_GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TeamsMeetingGraphError("graph_timeout", "Microsoft Graph timed out while syncing the Teams meeting.", 408, true);
    }
    throw new TeamsMeetingGraphError(
      "graph_network_error",
      error instanceof Error ? error.message : "Microsoft Graph network request failed for Teams meetings.",
      503,
      true
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureGraphAccessToken(correlationId?: string | null) {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: config.MICROSOFT_GRAPH_CLIENT_ID,
    client_secret: config.MICROSOFT_GRAPH_CLIENT_SECRET,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials"
  });

  const tokenUrl = `https://login.microsoftonline.com/${config.MICROSOFT_GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const trace = startIntegrationTrace({
    provider: "teams",
    operation: "meeting_token_exchange",
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
      const error = new TeamsMeetingGraphError(
        payload.error ?? "graph_token_exchange_failed",
        payload.error_description ?? "Microsoft Graph token exchange failed for Teams meetings.",
        response.status,
        response.status === 429 || response.status >= 500
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryable: error.retryable
      });
      throw error;
    }

    cachedToken = {
      accessToken: payload.access_token,
      expiresAtMs: Date.now() + (payload.expires_in ?? 300) * 1000
    };
    finishIntegrationTrace(trace, { statusCode: response.status });
    return cachedToken.accessToken;
  } catch (error) {
    if (!(error instanceof TeamsMeetingGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function fetchGraphJson<T>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
  options: { operation: string; correlationId?: string | null }
) {
  const trace = startIntegrationTrace({
    provider: "teams",
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
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    const raw = await response.text();
    const payload = (raw ? JSON.parse(raw) : {}) as T & GraphErrorPayload;
    if (!response.ok) {
      const error = new TeamsMeetingGraphError(
        payload.error?.code ?? "graph_request_failed",
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}.`,
        response.status,
        response.status === 429 || response.status >= 500
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryable: error.retryable
      });
      throw error;
    }

    finishIntegrationTrace(trace, { statusCode: response.status });
    return payload;
  } catch (error) {
    if (!(error instanceof TeamsMeetingGraphError)) {
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
    provider: "teams",
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
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok && response.status !== 404) {
      const raw = await response.text();
      const payload = (raw ? JSON.parse(raw) : {}) as GraphErrorPayload;
      const error = new TeamsMeetingGraphError(
        payload.error?.code ?? "graph_request_failed",
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}.`,
        response.status,
        response.status === 429 || response.status >= 500
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryable: error.retryable
      });
      throw error;
    }
    finishIntegrationTrace(trace, { statusCode: response.status });
  } catch (error) {
    if (!(error instanceof TeamsMeetingGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function loadMeetingOperation(client: PoolClient, tenantId: string, operationId: string) {
  const { rows } = await client.query<MeetingOperationRow>(
    `
      SELECT
        operation.id::text,
        operation.tenant_id::text AS tenant_id,
        operation.meeting_id::text AS meeting_id,
        operation.operation_type::text AS operation_type,
        operation.trigger_source,
        operation.actor_user_id::text AS actor_user_id,
        operation.status::text AS status,
        operation.request_payload,
        meeting.meeting_mode::text AS meeting_mode,
        meeting.meeting_status::text AS meeting_status,
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
        meeting.linked_record_type::text AS linked_record_type,
        meeting.linked_record_id::text AS linked_record_id
      FROM teams_meeting_sync_operation operation
      JOIN teams_meeting_reference meeting
        ON meeting.tenant_id = operation.tenant_id
       AND meeting.id = operation.meeting_id
      WHERE operation.tenant_id = $1
        AND operation.id = $2
      LIMIT 1
    `,
    [tenantId, operationId]
  );
  return rows[0] ?? null;
}

async function markOperationProcessing(client: PoolClient, tenantId: string, operationId: string) {
  await client.query(
    `
      UPDATE teams_meeting_sync_operation
      SET
        status = 'processing'::teams_meeting_sync_operation_status,
        attempt_count = attempt_count + 1,
        first_attempted_at = COALESCE(first_attempted_at, now()),
        last_attempted_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, operationId]
  );
}

async function markOperationSucceeded(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    meetingId: string;
    operationType: MeetingOperationRow["operation_type"];
    meetingJoinUrl: string | null;
    meetingWebUrl: string | null;
    externalMeetingId: string | null;
    externalCalendarEventId: string | null;
    responsePayload: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE teams_meeting_sync_operation
      SET
        status = 'succeeded'::teams_meeting_sync_operation_status,
        completed_at = now(),
        failed_at = NULL,
        last_error = NULL,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $4::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.operationId, input.meetingId, JSON.stringify(input.responsePayload)]
  );

  await client.query(
    `
      UPDATE teams_meeting_reference
      SET
        meeting_status = CASE
          WHEN $3::teams_meeting_sync_operation_type = 'cancel'::teams_meeting_sync_operation_type
            THEN 'cancelled'::teams_meeting_status
          ELSE 'scheduled'::teams_meeting_status
        END,
        meeting_join_url = CASE
          WHEN $3::teams_meeting_sync_operation_type = 'cancel'::teams_meeting_sync_operation_type THEN NULL
          ELSE $4
        END,
        meeting_web_url = CASE
          WHEN $3::teams_meeting_sync_operation_type = 'cancel'::teams_meeting_sync_operation_type THEN NULL
          ELSE $5
        END,
        external_meeting_id = COALESCE($6, external_meeting_id),
        external_calendar_event_id = COALESCE($7, external_calendar_event_id),
        last_sync_attempt_at = now(),
        last_synced_at = now(),
        sync_error = NULL,
        cancelled_at = CASE
          WHEN $3::teams_meeting_sync_operation_type = 'cancel'::teams_meeting_sync_operation_type
            THEN COALESCE(cancelled_at, now())
          ELSE NULL
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      input.tenantId,
      input.meetingId,
      input.operationType,
      input.meetingJoinUrl,
      input.meetingWebUrl,
      input.externalMeetingId,
      input.externalCalendarEventId
    ]
  );
}

async function markOperationFailed(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    meetingId: string;
    errorMessage: string;
    responsePayload: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE teams_meeting_sync_operation
      SET
        status = 'failed'::teams_meeting_sync_operation_status,
        failed_at = now(),
        last_error = $4,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $5::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.operationId, input.meetingId, input.errorMessage, JSON.stringify(input.responsePayload)]
  );

  await client.query(
    `
      UPDATE teams_meeting_reference
      SET
        meeting_status = 'sync_error'::teams_meeting_status,
        last_sync_attempt_at = now(),
        sync_error = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.meetingId, input.errorMessage]
  );
}

async function writeMeetingAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    operationId: string;
    meetingId: string;
    eventType: string;
    result: string;
    context?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO audit_events (
        tenant_id,
        actor_user_id,
        event_category,
        event_type,
        resource_type,
        resource_id,
        target_user_id,
        department_type,
        request_id,
        trace_id,
        old_values_json,
        new_values_json,
        context_json,
        result
      )
      VALUES ($1,$2,'communication',$3,'teams_meeting_sync_operation',$4,NULL,NULL,NULL,$5,NULL,NULL,$6::jsonb,$7)
    `,
    [
      input.tenantId,
      input.actorUserId,
      input.eventType,
      input.operationId,
      `communication:${input.eventType}:${input.operationId}`,
      JSON.stringify({
        meeting_id: input.meetingId,
        ...(input.context ?? {})
      }),
      input.result
    ]
  );
}

function buildCalendarEventPayload(operation: MeetingOperationRow) {
  return {
    subject: operation.title,
    body: {
      contentType: "html",
      content: buildCalendarMeetingBody(operation)
    },
    start: {
      dateTime: formatGraphDateTime(operation.scheduled_start_at),
      timeZone: config.OUTLOOK_CALENDAR_TIMEZONE
    },
    end: {
      dateTime: formatGraphDateTime(operation.scheduled_end_at),
      timeZone: config.OUTLOOK_CALENDAR_TIMEZONE
    },
    attendees: buildCalendarAttendees(operation),
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    transactionId: `mission-control:teams-meeting:${operation.meeting_id}:${operation.scheduled_start_at}`
  };
}

function buildStandaloneMeetingPayload(operation: MeetingOperationRow) {
  return {
    subject: operation.title,
    startDateTime: operation.scheduled_start_at,
    endDateTime: operation.scheduled_end_at
  };
}

async function createCalendarMeeting(accessToken: string, organizerMicrosoftUserId: string, operation: MeetingOperationRow) {
    return fetchGraphJson<GraphEventResponse>(
      accessToken,
      `${GRAPH_API_BASE}/users/${encodeURIComponent(organizerMicrosoftUserId)}/events`,
      {
        method: "POST",
        body: JSON.stringify(buildCalendarEventPayload(operation))
      },
      { operation: "create_calendar_meeting", correlationId: operation.id }
    );
}

async function updateCalendarMeeting(
  accessToken: string,
  organizerMicrosoftUserId: string,
  eventId: string,
  operation: MeetingOperationRow
) {
  return fetchGraphJson<GraphEventResponse>(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(organizerMicrosoftUserId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(buildCalendarEventPayload(operation))
    },
    { operation: "update_calendar_meeting", correlationId: operation.id }
  );
}

async function cancelCalendarMeeting(accessToken: string, organizerMicrosoftUserId: string, eventId: string) {
  await fetchGraphNoContent(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(organizerMicrosoftUserId)}/events/${encodeURIComponent(eventId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({
        comment: "Mission Control cancelled this internal Teams meeting."
      })
    },
    { operation: "cancel_calendar_meeting", correlationId: eventId }
  );
}

async function createStandaloneMeeting(accessToken: string, organizerMicrosoftUserId: string, operation: MeetingOperationRow) {
  return fetchGraphJson<GraphOnlineMeetingResponse>(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(organizerMicrosoftUserId)}/onlineMeetings`,
    {
      method: "POST",
      body: JSON.stringify(buildStandaloneMeetingPayload(operation))
    },
    { operation: "create_online_meeting", correlationId: operation.id }
  );
}

async function updateStandaloneMeeting(
  accessToken: string,
  organizerMicrosoftUserId: string,
  meetingId: string,
  operation: MeetingOperationRow
) {
  return fetchGraphJson<GraphOnlineMeetingResponse>(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(organizerMicrosoftUserId)}/onlineMeetings/${encodeURIComponent(meetingId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(buildStandaloneMeetingPayload(operation))
    },
    { operation: "update_online_meeting", correlationId: operation.id }
  );
}

async function deleteStandaloneMeeting(accessToken: string, organizerMicrosoftUserId: string, meetingId: string) {
  await fetchGraphNoContent(
    accessToken,
    `${GRAPH_API_BASE}/users/${encodeURIComponent(organizerMicrosoftUserId)}/onlineMeetings/${encodeURIComponent(meetingId)}`,
    {
      method: "DELETE"
    },
    { operation: "delete_online_meeting", correlationId: meetingId }
  );
}

async function clearCrossModeBindings(accessToken: string, operation: MeetingOperationRow) {
  const organizerMicrosoftUserId = operation.organizer_microsoft_user_id;
  if (!organizerMicrosoftUserId) {
    return;
  }

  if (operation.meeting_mode === "calendar_event" && operation.external_meeting_id) {
    await deleteStandaloneMeeting(accessToken, organizerMicrosoftUserId, operation.external_meeting_id);
  }
  if (operation.meeting_mode === "standalone_online_meeting" && operation.external_calendar_event_id) {
    await cancelCalendarMeeting(accessToken, organizerMicrosoftUserId, operation.external_calendar_event_id);
  }
}

async function syncCalendarBackedMeeting(accessToken: string, operation: MeetingOperationRow): Promise<MeetingSyncResult> {
  const organizerMicrosoftUserId = operation.organizer_microsoft_user_id;
  if (!organizerMicrosoftUserId) {
    throw new TeamsMeetingGraphError(
      "organizer_not_linked",
      "The linked Teams meeting does not have a valid organizer Microsoft identity.",
      409,
      false
    );
  }

  await clearCrossModeBindings(accessToken, operation);

  if (operation.operation_type === "cancel") {
    if (operation.external_calendar_event_id) {
      await cancelCalendarMeeting(accessToken, organizerMicrosoftUserId, operation.external_calendar_event_id);
    }
    if (operation.external_meeting_id) {
      await deleteStandaloneMeeting(accessToken, organizerMicrosoftUserId, operation.external_meeting_id);
    }
    return {
      meetingJoinUrl: null,
      meetingWebUrl: null,
      externalMeetingId: operation.external_meeting_id,
      externalCalendarEventId: operation.external_calendar_event_id,
      responsePayload: {
        action: "cancelled",
        mode: "calendar_event",
        external_calendar_event_id: operation.external_calendar_event_id,
        external_meeting_id: operation.external_meeting_id
      }
    };
  }

  let response: GraphEventResponse;
  if (operation.external_calendar_event_id) {
    try {
      response = await updateCalendarMeeting(
        accessToken,
        organizerMicrosoftUserId,
        operation.external_calendar_event_id,
        operation
      );
    } catch (error) {
      if (error instanceof TeamsMeetingGraphError && error.status === 404) {
        response = await createCalendarMeeting(accessToken, organizerMicrosoftUserId, operation);
      } else {
        throw error;
      }
    }
  } else {
    response = await createCalendarMeeting(accessToken, organizerMicrosoftUserId, operation);
  }

  const eventId = response.id ?? operation.external_calendar_event_id;
  if (!eventId) {
    throw new TeamsMeetingGraphError("calendar_event_missing_id", "Microsoft Graph did not return an event id.", 502, true);
  }

  const joinUrl = response.onlineMeeting?.joinUrl ?? response.onlineMeetingUrl ?? operation.meeting_join_url ?? null;
  const webUrl = response.webLink ?? operation.meeting_web_url ?? null;

  return {
    meetingJoinUrl: joinUrl,
    meetingWebUrl: webUrl,
    externalMeetingId: operation.external_meeting_id,
    externalCalendarEventId: eventId,
    responsePayload: {
      action: operation.external_calendar_event_id ? "updated" : "created",
      mode: "calendar_event",
      external_calendar_event_id: eventId,
      meeting_join_url: joinUrl,
      meeting_web_url: webUrl
    }
  };
}

async function syncStandaloneMeeting(accessToken: string, operation: MeetingOperationRow): Promise<MeetingSyncResult> {
  const organizerMicrosoftUserId = operation.organizer_microsoft_user_id;
  if (!organizerMicrosoftUserId) {
    throw new TeamsMeetingGraphError(
      "organizer_not_linked",
      "The linked Teams meeting does not have a valid organizer Microsoft identity.",
      409,
      false
    );
  }

  await clearCrossModeBindings(accessToken, operation);

  if (operation.operation_type === "cancel") {
    if (operation.external_meeting_id) {
      await deleteStandaloneMeeting(accessToken, organizerMicrosoftUserId, operation.external_meeting_id);
    }
    if (operation.external_calendar_event_id) {
      await cancelCalendarMeeting(accessToken, organizerMicrosoftUserId, operation.external_calendar_event_id);
    }
    return {
      meetingJoinUrl: null,
      meetingWebUrl: null,
      externalMeetingId: operation.external_meeting_id,
      externalCalendarEventId: operation.external_calendar_event_id,
      responsePayload: {
        action: "cancelled",
        mode: "standalone_online_meeting",
        external_meeting_id: operation.external_meeting_id,
        external_calendar_event_id: operation.external_calendar_event_id
      }
    };
  }

  let response: GraphOnlineMeetingResponse;
  if (operation.external_meeting_id) {
    try {
      response = await updateStandaloneMeeting(accessToken, organizerMicrosoftUserId, operation.external_meeting_id, operation);
    } catch (error) {
      if (error instanceof TeamsMeetingGraphError && error.status === 404) {
        response = await createStandaloneMeeting(accessToken, organizerMicrosoftUserId, operation);
      } else {
        throw error;
      }
    }
  } else {
    response = await createStandaloneMeeting(accessToken, organizerMicrosoftUserId, operation);
  }

  const meetingId = response.id ?? operation.external_meeting_id;
  if (!meetingId) {
    throw new TeamsMeetingGraphError("online_meeting_missing_id", "Microsoft Graph did not return an online meeting id.", 502, true);
  }

  const joinUrl = response.joinWebUrl ?? operation.meeting_join_url ?? null;

  return {
    meetingJoinUrl: joinUrl,
    meetingWebUrl: joinUrl,
    externalMeetingId: meetingId,
    externalCalendarEventId: null,
    responsePayload: {
      action: operation.external_meeting_id ? "updated" : "created",
      mode: "standalone_online_meeting",
      external_meeting_id: meetingId,
      meeting_join_url: joinUrl
    }
  };
}

export async function dispatchTeamsMeetingSyncOperation(client: PoolClient, tenantId: string, operationId: string) {
  const operation = await loadMeetingOperation(client, tenantId, operationId);
  if (!operation) {
    return { code: "skipped", response: { reason: "missing_operation" } };
  }
  if (operation.status === "succeeded" || operation.status === "throttled" || operation.status === "skipped") {
    return { code: "skipped", response: { reason: "already_finalized" } };
  }
  if (operation.status === "processing") {
    return { code: "skipped", response: { reason: "already_processing" } };
  }

  if (!isTeamsMeetingsConfigured()) {
    const message = "Teams meetings are disabled or missing Graph credentials.";
    await markOperationFailed(client, {
      tenantId,
      operationId,
      meetingId: operation.meeting_id,
      errorMessage: message,
      responsePayload: {
        reason: "feature_disabled"
      }
    });
    await writeMeetingAudit(client, {
      tenantId,
      actorUserId: operation.actor_user_id,
      operationId,
      meetingId: operation.meeting_id,
      eventType: "communication.teams_meeting.failed",
      result: "failed",
      context: {
        reason: "feature_disabled",
        operation_type: operation.operation_type
      }
    });
    return { code: "failed", response: { reason: "feature_disabled" } };
  }

  await markOperationProcessing(client, tenantId, operationId);

  try {
    const accessToken = await ensureGraphAccessToken(operationId);
    const result =
      operation.meeting_mode === "calendar_event"
        ? await syncCalendarBackedMeeting(accessToken, operation)
        : await syncStandaloneMeeting(accessToken, operation);

    await markOperationSucceeded(client, {
      tenantId,
      operationId,
      meetingId: operation.meeting_id,
      operationType: operation.operation_type,
      meetingJoinUrl: result.meetingJoinUrl,
      meetingWebUrl: result.meetingWebUrl,
      externalMeetingId: result.externalMeetingId,
      externalCalendarEventId: result.externalCalendarEventId,
      responsePayload: result.responsePayload
    });
    await writeMeetingAudit(client, {
      tenantId,
      actorUserId: operation.actor_user_id,
      operationId,
      meetingId: operation.meeting_id,
      eventType:
        operation.operation_type === "cancel"
          ? "communication.teams_meeting.cancelled"
          : "communication.teams_meeting.synced",
      result: "sent",
      context: {
        operation_type: operation.operation_type,
        meeting_mode: operation.meeting_mode,
        trigger_source: operation.trigger_source,
        linked_record_type: operation.linked_record_type,
        linked_record_id: operation.linked_record_id,
        ...result.responsePayload
      }
    });
    return {
      code: "sent",
      response: result.responsePayload
    };
  } catch (error) {
    const typed =
      error instanceof TeamsMeetingGraphError
        ? error
        : new TeamsMeetingGraphError(
            "teams_meeting_sync_failed",
            error instanceof Error ? error.message : "Teams meeting sync failed.",
            500,
            true
          );

    await markOperationFailed(client, {
      tenantId,
      operationId,
      meetingId: operation.meeting_id,
      errorMessage: typed.message,
      responsePayload: {
        code: typed.code,
        status: typed.status,
        retryable: typed.retryable
      }
    });
    await writeMeetingAudit(client, {
      tenantId,
      actorUserId: operation.actor_user_id,
      operationId,
      meetingId: operation.meeting_id,
      eventType: "communication.teams_meeting.failed",
      result: "failed",
      context: {
        code: typed.code,
        status: typed.status,
        retryable: typed.retryable,
        operation_type: operation.operation_type,
        meeting_mode: operation.meeting_mode,
        trigger_source: operation.trigger_source,
        linked_record_type: operation.linked_record_type,
        linked_record_id: operation.linked_record_id
      }
    });

    if (typed.retryable) {
      throw typed;
    }

    return {
      code: "failed",
      response: {
        code: typed.code,
        message: typed.message
      }
    };
  }
}
