import { config } from "../config.js";
import type { PoolClient } from "pg";
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

type GraphChatMessageResponse = {
  id?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

type DeliveryRow = {
  id: string;
  actor_user_id: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "throttled";
  message_text: string;
  app_deep_link: string | null;
  request_payload: Record<string, unknown> | null;
  reference_id: string;
  reference_status: "active" | "disabled";
  reference_label: string;
  reference_type: "chat" | "channel";
  teams_web_url: string;
  team_id: string | null;
  channel_id: string | null;
  chat_id: string | null;
};

let cachedToken: CachedGraphToken | null = null;

export class TeamsMessagingGraphError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}

function isTeamsMessagingConfigured() {
  return Boolean(
    config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED &&
      config.MICROSOFT_TEAMS_BOT_APP_ID &&
      config.MICROSOFT_TEAMS_BOT_APP_PASSWORD &&
      config.MICROSOFT_GRAPH_TENANT_ID
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMessageHtml(delivery: Pick<DeliveryRow, "message_text" | "app_deep_link">) {
  const body = escapeHtml(delivery.message_text).replace(/\r?\n/g, "<br/>");
  if (!delivery.app_deep_link) {
    return body;
  }
  return `${body}<br/><br/><a href="${escapeHtml(delivery.app_deep_link)}">Open in Mission Control</a>`;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TeamsMessagingGraphError("graph_timeout", "Microsoft Graph timed out while sending the Teams message.", true);
    }
    throw new TeamsMessagingGraphError(
      "graph_network_error",
      error instanceof Error ? error.message : "Microsoft Graph network request failed.",
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
    client_id: config.MICROSOFT_TEAMS_BOT_APP_ID,
    client_secret: config.MICROSOFT_TEAMS_BOT_APP_PASSWORD,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials"
  });

  const tokenUrl = `https://login.microsoftonline.com/${config.MICROSOFT_GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const trace = startIntegrationTrace({
    provider: "teams",
    operation: "bot_token_exchange",
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
      const error = new TeamsMessagingGraphError(
        payload.error ?? "graph_token_exchange_failed",
        payload.error_description ?? "Microsoft Graph token exchange failed for Teams messaging.",
        response.status >= 500 || response.status === 429
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
    if (!(error instanceof TeamsMessagingGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function fetchGraphJson<T>(
  accessToken: string,
  url: string,
  init: RequestInit,
  options: { operation: string; correlationId?: string | null }
): Promise<T> {
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
    let payload = {} as T & { error?: { code?: string; message?: string } };
    if (raw) {
      try {
        payload = JSON.parse(raw) as T & { error?: { code?: string; message?: string } };
      } catch {
        payload = {
          error: {
            code: "graph_response_not_json",
            message: raw
          }
        } as T & { error?: { code?: string; message?: string } };
      }
    }

    if (!response.ok) {
      const error = new TeamsMessagingGraphError(
        payload.error?.code ?? "graph_request_failed",
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}.`,
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
    if (!(error instanceof TeamsMessagingGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function loadDelivery(client: PoolClient, tenantId: string, deliveryId: string) {
  const { rows } = await client.query<DeliveryRow>(
    `
      SELECT
        delivery.id::text,
        delivery.actor_user_id::text AS actor_user_id,
        delivery.status::text AS status,
        delivery.message_text,
        delivery.app_deep_link,
        delivery.request_payload,
        reference.id::text AS reference_id,
        reference.status::text AS reference_status,
        reference.label AS reference_label,
        reference.reference_type::text AS reference_type,
        reference.teams_web_url,
        reference.team_id,
        reference.channel_id,
        reference.chat_id
      FROM teams_communication_delivery delivery
      JOIN teams_communication_reference reference
        ON reference.tenant_id = delivery.tenant_id
       AND reference.id = delivery.reference_id
      WHERE delivery.tenant_id = $1
        AND delivery.id = $2
      LIMIT 1
    `,
    [tenantId, deliveryId]
  );
  return rows[0] ?? null;
}

async function insertDeliveryEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    eventType: "sending" | "sent" | "failed";
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

async function writeCommunicationAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    deliveryId: string;
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
      VALUES ($1,$2,'communication',$3,'teams_communication_delivery',$4,NULL,NULL,NULL,$5,NULL,NULL,$6::jsonb,$7)
    `,
    [
      input.tenantId,
      input.actorUserId,
      input.eventType,
      input.deliveryId,
      `communication:${input.eventType}:${input.deliveryId}`,
      JSON.stringify(input.context ?? {}),
      input.result
    ]
  );
}

async function markSending(client: PoolClient, tenantId: string, deliveryId: string) {
  await client.query(
    `
      UPDATE teams_communication_delivery
      SET
        status = 'sending'::teams_communication_delivery_status,
        attempt_count = attempt_count + 1,
        first_attempted_at = COALESCE(first_attempted_at, now()),
        last_attempted_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, deliveryId]
  );
}

async function markSent(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    responsePayload: Record<string, unknown>;
    externalMessageId: string | null;
    referenceId: string;
  }
) {
  await client.query(
    `
      UPDATE teams_communication_delivery
      SET
        status = 'sent'::teams_communication_delivery_status,
        sent_at = now(),
        last_error = NULL,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $3::jsonb,
        external_message_id = COALESCE($4, external_message_id),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.deliveryId, JSON.stringify(input.responsePayload), input.externalMessageId]
  );
  await client.query(
    `
      UPDATE teams_communication_reference
      SET last_verified_at = now(), updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.referenceId]
  );
}

async function markFailed(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    errorMessage: string;
    responsePayload: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE teams_communication_delivery
      SET
        status = 'failed'::teams_communication_delivery_status,
        failed_at = now(),
        last_error = $3,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $4::jsonb,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.deliveryId, input.errorMessage, JSON.stringify(input.responsePayload)]
  );
}

function buildGraphEndpoint(delivery: DeliveryRow) {
  if (delivery.reference_type === "chat" && delivery.chat_id) {
    return `${GRAPH_API_BASE}/chats/${encodeURIComponent(delivery.chat_id)}/messages`;
  }
  if (delivery.reference_type === "channel" && delivery.team_id && delivery.channel_id) {
    return `${GRAPH_API_BASE}/teams/${encodeURIComponent(delivery.team_id)}/channels/${encodeURIComponent(delivery.channel_id)}/messages`;
  }
  throw new TeamsMessagingGraphError("destination_invalid", "Teams destination is missing the Graph ids required for message delivery.");
}

export async function dispatchTeamsCommunicationDelivery(client: PoolClient, tenantId: string, deliveryId: string) {
  const delivery = await loadDelivery(client, tenantId, deliveryId);
  if (!delivery) {
    return;
  }
  if (delivery.status === "sent" || delivery.status === "throttled") {
    return;
  }
  if (!isTeamsMessagingConfigured()) {
    await markFailed(client, {
      tenantId,
      deliveryId,
      errorMessage: "Teams messaging is disabled or missing credentials.",
      responsePayload: {
        reason: "feature_disabled"
      }
    });
    await insertDeliveryEvent(client, {
      tenantId,
      deliveryId,
      eventType: "failed",
      actorUserId: delivery.actor_user_id,
      note: "Teams messaging send skipped because the feature is disabled.",
      metadata: {
        reason: "feature_disabled"
      }
    });
    await writeCommunicationAudit(client, {
      tenantId,
      actorUserId: delivery.actor_user_id,
      deliveryId,
      eventType: "communication.teams_message.failed",
      result: "failed",
      context: {
        reason: "feature_disabled"
      }
    });
    return;
  }
  if (delivery.reference_status !== "active") {
    await markFailed(client, {
      tenantId,
      deliveryId,
      errorMessage: "Teams destination is disabled.",
      responsePayload: {
        reason: "destination_disabled"
      }
    });
    await insertDeliveryEvent(client, {
      tenantId,
      deliveryId,
      eventType: "failed",
      actorUserId: delivery.actor_user_id,
      note: "Teams destination is disabled.",
      metadata: {
        reason: "destination_disabled"
      }
    });
    await writeCommunicationAudit(client, {
      tenantId,
      actorUserId: delivery.actor_user_id,
      deliveryId,
      eventType: "communication.teams_message.failed",
      result: "failed",
      context: {
        reason: "destination_disabled"
      }
    });
    return;
  }

  const accessToken = await ensureGraphAccessToken(deliveryId);
  await markSending(client, tenantId, deliveryId);
  await insertDeliveryEvent(client, {
    tenantId,
    deliveryId,
    eventType: "sending",
    actorUserId: delivery.actor_user_id,
    note: "Dispatching Teams message through Microsoft Graph.",
    metadata: {
      reference_type: delivery.reference_type
    }
  });

  try {
    const endpoint = buildGraphEndpoint(delivery);
    const payload = await fetchGraphJson<GraphChatMessageResponse>(
      accessToken,
      endpoint,
      {
        method: "POST",
        body: JSON.stringify({
          body: {
            contentType: "html",
            content: buildMessageHtml(delivery)
          }
        })
      },
      {
        operation: delivery.reference_type === "chat" ? "send_chat_message" : "send_channel_message",
        correlationId: deliveryId
      }
    );

    await markSent(client, {
      tenantId,
      deliveryId,
      responsePayload: {
        graph_message_id: payload.id ?? null,
        endpoint
      },
      externalMessageId: payload.id ?? null,
      referenceId: delivery.reference_id
    });
    await insertDeliveryEvent(client, {
      tenantId,
      deliveryId,
      eventType: "sent",
      actorUserId: delivery.actor_user_id,
      note: "Teams message sent.",
      metadata: {
        graph_message_id: payload.id ?? null
      }
    });
    await writeCommunicationAudit(client, {
      tenantId,
      actorUserId: delivery.actor_user_id,
      deliveryId,
      eventType: "communication.teams_message.sent",
      result: "sent",
      context: {
        graph_message_id: payload.id ?? null,
        reference_type: delivery.reference_type,
        reference_label: delivery.reference_label
      }
    });
  } catch (error) {
    const typed =
      error instanceof TeamsMessagingGraphError
        ? error
        : new TeamsMessagingGraphError("graph_send_failed", error instanceof Error ? error.message : "Teams send failed.", true);

    await markFailed(client, {
      tenantId,
      deliveryId,
      errorMessage: typed.message,
      responsePayload: {
        code: typed.code,
        retryable: typed.retryable
      }
    });
    await insertDeliveryEvent(client, {
      tenantId,
      deliveryId,
      eventType: "failed",
      actorUserId: delivery.actor_user_id,
      note: typed.message,
      metadata: {
        code: typed.code,
        retryable: typed.retryable
      }
    });
    await writeCommunicationAudit(client, {
      tenantId,
      actorUserId: delivery.actor_user_id,
      deliveryId,
      eventType: "communication.teams_message.failed",
      result: "failed",
      context: {
        code: typed.code,
        retryable: typed.retryable,
        reference_type: delivery.reference_type,
        reference_label: delivery.reference_label
      }
    });

    if (typed.retryable) {
      throw typed;
    }
  }
}
