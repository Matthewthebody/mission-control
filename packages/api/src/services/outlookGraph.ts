import crypto from "node:crypto";
import { URLSearchParams } from "node:url";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { assertOutlookOauthConfig } from "../config/outlook.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  OutlookCalendar,
  OutlookConnectResponse,
  OutlookEvent,
  OutlookMessage,
  OutlookMailFolder,
  OutlookSyncError,
  OutlookSyncRun
} from "../types/outlook.js";
import { decryptSecret, encryptSecret } from "../utils/encryptedSecrets.js";
import { createOauthPkcePair } from "../utils/oauthPkce.js";
import { readRetryAfterSeconds } from "../utils/retryAfter.js";
import { hashOpaqueToken } from "./auth.js";
import { failIntegrationTrace, finishIntegrationTrace, startIntegrationTrace } from "./integrationTelemetry.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";
import type { OutlookProvider } from "./outlook.js";
import {
  OutlookGraphContractError,
  parseGraphCalendarResponse,
  parseGraphEventResponse,
  parseGraphFolderResponse,
  parseGraphMessageResponse,
  parseGraphTokenError,
  parseGraphTokenSuccess,
  parseGraphUserProfile,
  type GraphCalendarResponse,
  type GraphEventResponse,
  type GraphFolderResponse,
  type GraphMessageResponse,
  type GraphTokenError,
  type GraphTokenSuccess,
  type GraphUserProfile
} from "./outlookGraphContract.js";
import {
  buildDefaultAccount,
  createOutlookAudit,
  setActiveProviderMode,
  type OutlookConnectionRow,
  type OutlookOauthStateRow,
  type OutlookProviderMode,
  type RequestAuditContext,
  type ShootSnapshot,
  isGraphConfigured,
  upsertConnection
} from "./outlookStore.js";

export type GraphContext = {
  client: PoolClient;
  tenantId: string;
  actor: Pick<AuthUser, "id" | "tenantId" | "sessionId" | "email" | "fullName">;
  activeProviderMode: OutlookProviderMode;
  connection: OutlookConnectionRow | null;
  shoots: ShootSnapshot[];
  date: string;
};

export class OutlookGraphError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly options: {
      retryAfterSeconds?: number | null;
      statusCode?: number | null;
    } = {}
  ) {
    super(message);
  }
}

type OutlookPkceStateEnvelope = {
  state_handle: string;
  pkce_verifier_ciphertext: string;
};

type GraphAccessOptions = {
  allowRefresh: boolean;
  operation: "read_preview" | "manual_sync";
};

type GraphEventLoadResult = {
  events: OutlookEvent[];
  warnings: string[];
};

const OUTLOOK_GRAPH_API_VERSION = "v1.0";
const OUTLOOK_TOKEN_REFRESH_ANOMALY_THRESHOLD = 3;
const OUTLOOK_GRAPH_CALENDAR_BATCH_SIZE = 4;

export class GraphOutlookCalendarProvider implements OutlookProvider {
  async getStatus(context: GraphContext) {
    return buildDefaultAccount(context.tenantId, "graph_live");
  }

  async connect(context: GraphContext) {
    return buildDefaultAccount(context.tenantId, "graph_live");
  }

  async disconnect(context: GraphContext) {
    return buildDefaultAccount(context.tenantId, "graph_live");
  }

  async sync(context: GraphContext): Promise<OutlookSyncRun> {
    const [calendars, eventResult] = await Promise.all([
      loadGraphCalendars(context, { allowRefresh: true, operation: "manual_sync" }),
      loadGraphEvents(context, { date: context.date, window: "week" }, { allowRefresh: true, operation: "manual_sync" })
    ]);
    const events = eventResult.events;
    const overlapsWithShoots = events.filter((event) => event.overlaps_with_shoots).length;
    const warnings =
      overlapsWithShoots === 0 && context.shoots.length > 0
        ? ["Outlook preview completed, but no imported events overlapped the current Mission Control shoot window."]
        : [];

    return {
      id: crypto.randomUUID(),
      provider_mode: "graph_live",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: warnings.length > 0 || eventResult.warnings.length > 0 ? "warning" : "success",
      records_synced: calendars.length + events.length,
      warnings: [...warnings, ...eventResult.warnings],
      errors: []
    };
  }

  async listCalendars(context: GraphContext): Promise<OutlookCalendar[]> {
    return loadGraphCalendars(context, { allowRefresh: false, operation: "read_preview" });
  }

  async listFolders(context: GraphContext): Promise<OutlookMailFolder[]> {
    void context;
    return [];
  }

  async previewEvents(
    context: GraphContext,
    filters: { date: string; calendarId?: string; calendarIds?: string[]; window?: "today" | "3day" | "week"; overlapOnly?: boolean }
  ): Promise<OutlookEvent[]> {
    const result = await loadGraphEvents(context, filters, { allowRefresh: false, operation: "read_preview" });
    return result.events;
  }

  async previewMessages(
    context: GraphContext,
    filters: { date: string; folderId?: string; unreadOnly?: boolean; flaggedOnly?: boolean; importantOnly?: boolean }
  ): Promise<OutlookMessage[]> {
    void context;
    void filters;
    return [];
  }
}

export const GraphOutlookProvider = GraphOutlookCalendarProvider;

async function loadGraphCalendars(context: GraphContext, access: GraphAccessOptions): Promise<OutlookCalendar[]> {
  const token = await ensureGraphAccessToken(context, access);
  const outlookOauth = assertOutlookOauthConfig();
  const response = await fetchGraphJson<GraphCalendarResponse>(
    token,
    `${outlookOauth.graphBaseUrl}/me/calendars?$top=50&$select=id,name,color,isDefaultCalendar,owner`
  );
  const calendars = response.value ?? [];
  return calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name?.trim() || "Untitled calendar",
    color_hex: mapGraphColor(calendar.color),
    is_primary: Boolean(calendar.isDefaultCalendar),
    owner_label: calendar.owner?.name?.trim() || context.connection?.connected_account_email || "Microsoft 365",
    visible_in_app: Boolean(calendar.isDefaultCalendar) || !/birthday|holiday|personal/i.test(calendar.name ?? ""),
    scheduling_impact_enabled: true,
    overlaps_with_shoots: Boolean(context.shoots.length && (calendar.isDefaultCalendar || /school|portrait|senior/i.test(calendar.name ?? ""))),
    upcoming_count: 0
  }));
}

async function loadGraphEvents(
  context: GraphContext,
  filters: { date: string; calendarId?: string; calendarIds?: string[]; window?: "today" | "3day" | "week"; overlapOnly?: boolean },
  access: GraphAccessOptions
): Promise<GraphEventLoadResult> {
  const token = await ensureGraphAccessToken(context, access);
  const outlookOauth = assertOutlookOauthConfig();
  const allCalendars = await loadGraphCalendars(context, access);
  const targetCalendars = filters.calendarId
    ? allCalendars.filter((calendar) => calendar.id === filters.calendarId)
      : filters.calendarIds?.length
        ? allCalendars.filter((calendar) => filters.calendarIds?.includes(calendar.id))
        : allCalendars;
  if (!targetCalendars.length) {
    return { events: [], warnings: [] };
  }
  const { startDateTime, endDateTime } = buildGraphDateWindow(filters.date, filters.window);
  const warnings: string[] = [];
  const events: OutlookEvent[] = [];
  let firstFailure: unknown = null;

  for (let index = 0; index < targetCalendars.length; index += OUTLOOK_GRAPH_CALENDAR_BATCH_SIZE) {
    const batch = targetCalendars.slice(index, index + OUTLOOK_GRAPH_CALENDAR_BATCH_SIZE);
    const responses = await Promise.allSettled(
      batch.map(async (calendar) => {
        const params = new URLSearchParams({
          startDateTime,
          endDateTime,
          $top: "20",
          $orderby: "start/dateTime",
          $select: "id,subject,start,end,organizer,location,webLink"
        });
        const response = await fetchGraphJson<GraphEventResponse>(
          token,
          `${outlookOauth.graphBaseUrl}/me/calendars/${encodeURIComponent(calendar.id)}/calendarView?${params.toString()}`
        );
        return (response.value ?? []).map((event) => mapGraphEvent(event, context, calendar));
      })
    );

    let throttledBatch = false;
    for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
      const response = responses[responseIndex];
      const calendar = batch[responseIndex];
      if (response.status === "fulfilled") {
        events.push(...response.value);
        continue;
      }

      if (!firstFailure) {
        firstFailure = response.reason;
      }
      const graphError =
        response.reason instanceof OutlookGraphError
          ? response.reason
          : response.reason instanceof Error
            ? new OutlookGraphError("graph_request_failed", response.reason.message)
            : new OutlookGraphError("graph_request_failed", "Microsoft Graph calendar preview failed.");
      warnings.push(`Calendar preview degraded for ${calendar.name}: ${graphError.message}`);
      throttledBatch ||= graphError.code === "graph_throttled";
    }

    if (throttledBatch) {
      break;
    }
  }

  if (!events.length && firstFailure) {
    throw firstFailure;
  }

  return {
    events: events
    .filter((event) => (filters.overlapOnly ? event.overlaps_with_shoots : true))
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
    .slice(0, 24),
    warnings
  };
}

export async function createGraphConnectResponse(
  client: PoolClient,
  auth: AuthUser,
  statusPayload: OutlookConnectResponse
) {
  const outlookOauth = assertOutlookOauthConfig();
  if (!isGraphConfigured()) {
    throw new ApiError(400, "Microsoft Graph is not configured");
  }
  const pkce = createOauthPkcePair();
  const rawState = createOutlookOauthStateValue(pkce.codeVerifier);
  const stateHash = hashOpaqueToken(rawState);
  await client.query(
    `
      INSERT INTO outlook_oauth_state (tenant_id, user_id, auth_session_id, state_hash, redirect_path, expires_at)
      VALUES ($1,$2,$3,$4,'#outlook', now() + ($5::text || ' minutes')::interval)
    `,
    [auth.tenantId, auth.id, auth.sessionId, stateHash, String(config.OUTLOOK_OAUTH_STATE_MINUTES)]
  );

  const params = new URLSearchParams({
    client_id: outlookOauth.clientId,
    response_type: "code",
    redirect_uri: outlookOauth.redirectUri,
    response_mode: "query",
    scope: outlookOauth.scopesString,
    state: rawState,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod
  });

  return {
    ...statusPayload,
    connect_mode: "oauth_redirect" as const,
    authorization_url: `${outlookOauth.authorizeUrl}?${params.toString()}`
  };
}

export async function handleGraphOauthCallback(
  client: PoolClient,
  input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  },
  metadata: RequestAuditContext = {}
) {
  if (!input.state) {
    return buildCallbackRedirect("callback_missing_state");
  }

  let codeVerifier = "";
  try {
    codeVerifier = readOutlookPkceVerifier(input.state);
  } catch {
    return buildCallbackRedirect("callback_invalid_state");
  }

  const oauthState = await consumeOauthState(client, input.state);
  if (!oauthState) {
    return buildCallbackRedirect("callback_invalid_state");
  }

  if (input.error) {
    await createOutlookAudit(
      client,
      {
        tenantId: oauthState.tenant_id,
        actorUserId: oauthState.user_id,
        action: "outlook.integration.connect_failed",
        entityType: "outlook_account",
        metadata: { error: input.error, error_description: input.errorDescription ?? "" }
      },
      metadata
    );
    return buildCallbackRedirect("callback_denied", oauthState.redirect_path);
  }

  if (!input.code) {
    return buildCallbackRedirect("callback_missing_code", oauthState.redirect_path);
  }

  try {
    const tokens = await exchangeAuthorizationCode(input.code, codeVerifier);
    const profile = await fetchGraphProfile(tokens.access_token);
    await upsertConnection(client, oauthState.tenant_id, {
      connected_by_user_id: oauthState.user_id,
      auth_session_id: oauthState.auth_session_id,
      provider_mode: "graph_live",
      connection_status: "connected",
      health_state: "connected_pending_sync",
      connected_account_email: profile.mail ?? profile.userPrincipalName ?? null,
      provider_tenant_id: assertOutlookOauthConfig().tenantId,
      encrypted_access_token: encryptSecret(tokens.access_token, oauthState.tenant_id),
      encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token, oauthState.tenant_id) : null,
      access_token_expires_at: expiresAtFromSeconds(tokens.expires_in),
      scopes: assertOutlookOauthConfig().scopesArray,
      warning_count: 0,
      error_count: 0,
      last_error_message: null,
      disconnected_at: null
    });
    await setActiveProviderMode(client, oauthState.tenant_id, "graph_live");

    await createOutlookAudit(
      client,
      {
        tenantId: oauthState.tenant_id,
        actorUserId: oauthState.user_id,
        action: "outlook.integration.connected",
        entityType: "outlook_account",
        metadata: {
          provider_mode: "graph_live",
          connected_as: profile.mail ?? profile.userPrincipalName ?? null
        }
      },
      metadata
    );

    await safeRecordOutlookIntegrationEvent(client, {
      tenantId: oauthState.tenant_id,
      actorUserId: oauthState.user_id,
      eventLevel: "info",
      eventType: "outlook.oauth.connected",
      eventStatus: "connected",
      summary: "Outlook delegated OAuth connection succeeded.",
      detail: {
        provider_mode: "graph_live",
        graph_api_version: OUTLOOK_GRAPH_API_VERSION,
        connected_account_email: profile.mail ?? profile.userPrincipalName ?? null,
        approved_scopes: assertOutlookOauthConfig().scopesArray,
        token_expires_in_seconds: tokens.expires_in ?? null,
        refresh_token_present: Boolean(tokens.refresh_token)
      }
    });

    return buildCallbackRedirect("connected", oauthState.redirect_path);
  } catch (error) {
    await createOutlookAudit(
      client,
      {
        tenantId: oauthState.tenant_id,
        actorUserId: oauthState.user_id,
        action: "outlook.integration.connect_failed",
        entityType: "outlook_account",
        metadata: { error: error instanceof Error ? error.message : "oauth_exchange_failed" }
      },
      metadata
    );
    await safeRecordOutlookIntegrationEvent(client, {
      tenantId: oauthState.tenant_id,
      actorUserId: oauthState.user_id,
      eventLevel: "error",
      eventType: "outlook.oauth.connect_failed",
      eventStatus: "failed",
      summary: "Outlook delegated OAuth connection failed during callback processing.",
      detail: {
        graph_api_version: OUTLOOK_GRAPH_API_VERSION,
        message: error instanceof Error ? error.message : "oauth_exchange_failed"
      }
    });
    return buildCallbackRedirect("callback_exchange_failed", oauthState.redirect_path);
  }
}

export async function markGraphConnectionAttention(
  client: PoolClient,
  connection: OutlookConnectionRow,
  error: OutlookGraphError,
  auth: Pick<AuthUser, "tenantId" | "id">,
  metadata: RequestAuditContext = {}
) {
  await upsertConnection(client, connection.tenant_id, {
    connected_by_user_id: connection.connected_by_user_id,
    auth_session_id: connection.auth_session_id,
    provider_mode: "graph_live",
    connection_status: "attention",
    health_state: "connected_error",
    connected_account_email: connection.connected_account_email,
    provider_tenant_id: connection.provider_tenant_id,
    encrypted_access_token: error.code === "graph_refresh_missing" ? null : connection.encrypted_access_token,
    encrypted_refresh_token: error.code === "graph_refresh_missing" ? null : connection.encrypted_refresh_token,
    access_token_expires_at: connection.access_token_expires_at,
    scopes: connection.scopes ?? [],
    records_synced: connection.records_synced,
    warning_count: connection.warning_count,
    error_count: Number(connection.error_count ?? 0) + 1,
    last_successful_sync_at: connection.last_successful_sync_at,
    last_failed_sync_at: new Date().toISOString(),
    last_error_message: error.message,
    disconnected_at: null
  });
  await setActiveProviderMode(client, connection.tenant_id, "graph_live");

  await createOutlookAudit(
    client,
    {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "outlook.integration.token_refresh_failed",
      entityType: "outlook_account",
      entityId: connection.id,
      metadata: {
        code: error.code,
        message: error.message,
        retry_after_seconds: error.options.retryAfterSeconds ?? null,
        status_code: error.options.statusCode ?? null
      }
    },
    metadata
  );
}

export function toSyncError(error: OutlookGraphError): OutlookSyncError {
  return {
    code: error.code,
    message: error.message,
    scope: "outlook_graph",
    occurred_at: new Date().toISOString(),
    retry_after_seconds: error.options.retryAfterSeconds ?? null,
    retry_state: error.options.retryAfterSeconds ? "retry_after_delay" : "manual_retry_required",
    source_object: {
      type: "outlook_graph",
      id: null
    },
    target_object: {
      type: "mission_control_outlook_status",
      id: "graph_live"
    }
  };
}

async function consumeOauthState(client: PoolClient, rawState: string) {
  const { rows } = await client.query<OutlookOauthStateRow>(
    `
      UPDATE outlook_oauth_state os
      SET consumed_at = now()
      FROM auth_session s
      WHERE os.state_hash = $1
        AND os.consumed_at IS NULL
        AND os.expires_at > now()
        AND s.id = os.auth_session_id
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      RETURNING os.id, os.tenant_id, os.user_id, os.auth_session_id, os.redirect_path
    `,
    [hashOpaqueToken(rawState)]
  );
  return rows[0] ?? null;
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<GraphTokenSuccess> {
  const outlookOauth = assertOutlookOauthConfig();
  return fetchTokenEndpoint(
    new URLSearchParams({
      client_id: outlookOauth.clientId,
      client_secret: outlookOauth.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: outlookOauth.redirectUri,
      code_verifier: codeVerifier
    })
  );
}

async function refreshGraphTokens(refreshToken: string): Promise<GraphTokenSuccess> {
  const outlookOauth = assertOutlookOauthConfig();
  return fetchTokenEndpoint(
    new URLSearchParams({
      client_id: outlookOauth.clientId,
      client_secret: outlookOauth.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: outlookOauth.scopesString
    })
  );
}

async function fetchTokenEndpoint(body: URLSearchParams): Promise<GraphTokenSuccess> {
  const outlookOauth = assertOutlookOauthConfig();
  const trace = startIntegrationTrace({
    provider: "outlook",
    operation: "oauth_token_exchange",
    direction: "outbound",
    method: "POST",
    target: outlookOauth.tokenUrl
  });
  try {
    const response = await fetchWithTimeout(
      outlookOauth.tokenUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      }
    );

    const rawPayload = await readJsonPayload(response, "oauth_token_exchange");
    if (!response.ok) {
      const payload = parseWithContract(
        () => parseGraphTokenError(rawPayload),
        "oauth_token_exchange_error",
        response.status
      ) as GraphTokenError;
      const retryAfterSeconds = safeReadRetryAfterSeconds(response.headers);
      const error = new OutlookGraphError(
        payload.error ?? (response.status === 429 || response.status === 503 ? "graph_throttled" : "graph_token_exchange_failed"),
        payload.error_description ??
          (retryAfterSeconds
            ? `Microsoft token exchange was throttled. Retry after ${retryAfterSeconds} seconds.`
            : "Microsoft token exchange failed"),
        {
          retryAfterSeconds,
          statusCode: response.status
        }
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryAfterSeconds,
        retryable: response.status === 429 || response.status === 503
      });
      throw error;
    }
    const payload = parseWithContract(
      () => parseGraphTokenSuccess(rawPayload),
      "oauth_token_exchange_success",
      response.status
    );
    finishIntegrationTrace(trace, {
      statusCode: response.status,
      retryAfterSeconds: safeReadRetryAfterSeconds(response.headers)
    });
    return payload;
  } catch (error) {
    if (!(error instanceof OutlookGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function fetchGraphProfile(accessToken: string): Promise<GraphUserProfile> {
  return fetchGraphJson<GraphUserProfile>(
    accessToken,
    `${assertOutlookOauthConfig().graphBaseUrl}/me?$select=mail,userPrincipalName`
  );
}

async function ensureGraphAccessToken(context: GraphContext, options: GraphAccessOptions) {
  const connection = context.connection;
  if (!connection || connection.provider_mode !== "graph_live" || !connection.encrypted_access_token) {
    throw new OutlookGraphError("graph_not_connected", "Microsoft Graph is not connected for this tenant");
  }

  const accessToken = decryptSecret(connection.encrypted_access_token, context.tenantId);
  const refreshToken = connection.encrypted_refresh_token ? decryptSecret(connection.encrypted_refresh_token, context.tenantId) : null;
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  const isExpired = !expiresAt || expiresAt <= Date.now() + 60_000;
  if (!isExpired) {
    return accessToken;
  }
  if (!options.allowRefresh) {
    throw new OutlookGraphError(
      refreshToken ? "graph_refresh_required" : "graph_refresh_missing",
      refreshToken
        ? "Microsoft Graph access expired. Use the explicit Outlook refresh action to renew the delegated preview."
        : "Microsoft Graph refresh token is unavailable. Reconnect the tenant.",
      {
        statusCode: 401
      }
    );
  }
  if (!refreshToken) {
    throw new OutlookGraphError("graph_refresh_missing", "Microsoft Graph refresh token is unavailable. Reconnect the tenant.");
  }

  const refreshed = await refreshGraphTokens(refreshToken);
  const nextConnection = await upsertConnection(context.client, context.tenantId, {
    connected_by_user_id: connection.connected_by_user_id,
    auth_session_id: connection.auth_session_id,
    provider_mode: "graph_live",
    connection_status: "connected",
    health_state: connection.last_successful_sync_at ? "connected_healthy" : "connected_pending_sync",
    connected_account_email: connection.connected_account_email,
    provider_tenant_id: connection.provider_tenant_id,
    encrypted_access_token: encryptSecret(refreshed.access_token, context.tenantId),
    encrypted_refresh_token: refreshed.refresh_token ? encryptSecret(refreshed.refresh_token, context.tenantId) : connection.encrypted_refresh_token,
    access_token_expires_at: expiresAtFromSeconds(refreshed.expires_in),
    scopes: assertOutlookOauthConfig().scopesArray,
    records_synced: connection.records_synced,
    warning_count: connection.warning_count,
    error_count: connection.error_count,
    last_successful_sync_at: connection.last_successful_sync_at,
    last_failed_sync_at: connection.last_failed_sync_at,
    last_error_message: null,
    disconnected_at: null
  });
  context.connection = nextConnection;
  await safeRecordOutlookIntegrationEvent(context.client, {
    tenantId: context.tenantId,
    actorUserId: context.actor.id,
    eventLevel: "info",
    eventType: "outlook.oauth.token_refreshed",
    eventStatus: "refreshed",
    relatedEntityType: "outlook_account",
    relatedEntityId: nextConnection.id,
    summary: "Outlook delegated access token refreshed during an explicit sync.",
    detail: {
      graph_api_version: OUTLOOK_GRAPH_API_VERSION,
      connected_account_email: nextConnection.connected_account_email,
      token_expires_in_seconds: refreshed.expires_in ?? null,
      refresh_token_rotated: Boolean(refreshed.refresh_token)
    }
  });
  await detectOutlookRefreshAnomaly(context.client, context.tenantId, context.actor.id, nextConnection.id);
  return refreshed.access_token;
}

async function fetchGraphJson<T>(accessToken: string, url: string): Promise<T> {
  const trace = startIntegrationTrace({
    provider: "outlook",
    operation: describeGraphOperation(url),
    direction: "outbound",
    method: "GET",
    target: url
  });
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (response.status === 401) {
      const error = new OutlookGraphError("graph_unauthorized", "Microsoft Graph returned 401. Reconnect the tenant.");
      failIntegrationTrace(trace, error, { statusCode: response.status, retryable: false });
      throw error;
    }

    const rawPayload = await readJsonPayload(response, describeGraphOperation(url));
    if (!response.ok) {
      const retryAfterSeconds = safeReadRetryAfterSeconds(response.headers);
      const payload = rawPayload as { error?: { code?: string; message?: string } };
      const errorCode = payload.error?.code;
      const rawMessage = payload.error?.message;
      const message =
        typeof rawMessage === "string"
          ? rawMessage
          : retryAfterSeconds
            ? `Microsoft Graph throttled the request. Retry after ${retryAfterSeconds} seconds.`
            : `Microsoft Graph request failed with ${response.status}`;
      const error = new OutlookGraphError(
        typeof errorCode === "string"
          ? errorCode
          : response.status === 429 || response.status === 503
            ? "graph_throttled"
            : "graph_request_failed",
        message,
        {
          retryAfterSeconds,
          statusCode: response.status
        }
      );
      failIntegrationTrace(trace, error, {
        statusCode: response.status,
        retryAfterSeconds,
        retryable: response.status === 429 || response.status === 503
      });
      throw error;
    }
    finishIntegrationTrace(trace, {
      statusCode: response.status,
      retryAfterSeconds: safeReadRetryAfterSeconds(response.headers)
    });
    return parseWithContract(
      () => parseGraphResponseForUrl(url, rawPayload) as T,
      describeGraphOperation(url),
      response.status
    );
  } catch (error) {
    if (!(error instanceof OutlookGraphError)) {
      failIntegrationTrace(trace, error);
    }
    throw error;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OUTLOOK_GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OutlookGraphError("graph_timeout", "Microsoft Graph timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGraphDateWindow(date: string, window: "today" | "3day" | "week" = "today") {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59`);

  if (window === "3day") {
    end.setDate(end.getDate() + 2);
  }

  if (window === "week") {
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }

  return {
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString()
  };
}

function mapGraphColor(color?: string | null) {
  const value = (color ?? "").toLowerCase();
  const palette: Record<string, string> = {
    lightblue: "#5b8bd4",
    lightgreen: "#5f8c67",
    lightorange: "#c68945",
    lightteal: "#3f7d82",
    lightpink: "#b96b8d",
    lightgray: "#708090",
    maxcolor: "#436f9f"
  };
  return palette[value] ?? "#436f9f";
}

function mapGraphEvent(
  event: NonNullable<GraphEventResponse["value"]>[number],
  context: GraphContext,
  calendar: OutlookCalendar
): OutlookEvent {
  const startsAt = event.start?.dateTime || new Date(`${context.date}T14:00:00`).toISOString();
  const endsAt = event.end?.dateTime || new Date(`${context.date}T15:00:00`).toISOString();
  const matchingShoot = findMatchingShoot(context.shoots, event.subject ?? "", startsAt, endsAt);
  return {
    id: event.id,
    calendar_id: calendar.id,
    calendar_name: calendar.name,
    calendar_color_hex: calendar.color_hex,
    subject: event.subject?.trim() || "Untitled event",
    starts_at: startsAt,
    ends_at: endsAt,
    organizer: event.organizer?.emailAddress?.name?.trim() || "Microsoft Graph",
    location: event.location?.displayName?.trim() || "No location",
    overlaps_with_shoots: Boolean(matchingShoot),
    scheduling_impact: Boolean(matchingShoot),
    preview_note: matchingShoot
      ? `Live Microsoft Graph preview overlaps ${matchingShoot.shoot_code}.`
      : "Live Microsoft Graph preview. No direct overlap with the current shoot board was detected.",
    web_link: event.webLink ?? null,
    shoot_code: matchingShoot?.shoot_code ?? null
  };
}

function mapGraphMessage(
  message: NonNullable<GraphMessageResponse["value"]>[number],
  context: GraphContext
): OutlookMessage {
  const matchingShoot = findShootByText(context.shoots, `${message.subject ?? ""} ${message.bodyPreview ?? ""}`);
  return {
    id: message.id,
    folder_id: message.parentFolderId ?? "inbox",
    from_name: message.from?.emailAddress?.name?.trim() || "Microsoft Graph",
    from_email: message.from?.emailAddress?.address?.trim() || "unknown@outlook.local",
    subject: message.subject?.trim() || "Untitled message",
    preview: message.bodyPreview?.trim() || "No preview available",
    received_at: message.receivedDateTime || new Date().toISOString(),
    unread: !Boolean(message.isRead),
    flagged: (message.flag?.flagStatus ?? "").toLowerCase() === "flagged",
    important: (message.importance ?? "").toLowerCase() === "high",
    convertible_to_alert: Boolean(matchingShoot),
    matching_hint: matchingShoot?.shoot_code ?? null
  };
}

function findMatchingShoot(shoots: ShootSnapshot[], subject: string, startsAt: string, endsAt: string) {
  const subjectMatch = findShootByText(shoots, subject);
  if (subjectMatch) {
    return subjectMatch;
  }

  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return (
    shoots.find((shoot) => {
      const shootStart = new Date(shoot.arrival_time ?? shoot.start_time ?? startsAt).getTime();
      const shootEnd = new Date(shoot.end_time_est ?? shoot.start_time ?? endsAt).getTime();
      return start <= shootEnd && end >= shootStart;
    }) ?? null
  );
}

function findShootByText(shoots: ShootSnapshot[], text: string) {
  const normalized = text.toLowerCase();
  return shoots.find((shoot) => normalized.includes(shoot.shoot_code.toLowerCase())) ?? null;
}

function filterMessages(
  messages: OutlookMessage[],
  filters: { folderId?: string; unreadOnly?: boolean; flaggedOnly?: boolean; importantOnly?: boolean }
) {
  return messages.filter((message) => {
    if (filters.folderId && message.folder_id !== filters.folderId) {
      return false;
    }
    if (filters.unreadOnly && !message.unread) {
      return false;
    }
    if (filters.flaggedOnly && !message.flagged) {
      return false;
    }
    if (filters.importantOnly && !message.important) {
      return false;
    }
    return true;
  });
}

function expiresAtFromSeconds(expiresIn?: number) {
  if (!expiresIn) {
    return null;
  }
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function buildCallbackRedirect(notice: string, redirectPath = "#outlook") {
  const base = config.ADMIN_WEB_URL.replace(/\/$/, "");
  const safePath = redirectPath.startsWith("#") ? redirectPath : "#outlook";
  return `${base}/${safePath.includes("?") ? `${safePath}&` : `${safePath}?`}outlook_notice=${encodeURIComponent(notice)}`;
}

function createOutlookOauthStateValue(codeVerifier: string) {
  const payload: OutlookPkceStateEnvelope = {
    state_handle: crypto.randomBytes(24).toString("hex"),
    pkce_verifier_ciphertext: ""
  };
  payload.pkce_verifier_ciphertext = encryptSecret(codeVerifier, payload.state_handle);
  return `pmc_oauth.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function readOutlookPkceVerifier(rawState: string) {
  if (!rawState.startsWith("pmc_oauth.")) {
    throw new OutlookGraphError("graph_invalid_state", "Microsoft OAuth state is malformed.");
  }

  const encodedPayload = rawState.slice("pmc_oauth.".length);
  let payload: OutlookPkceStateEnvelope;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as OutlookPkceStateEnvelope;
  } catch {
    throw new OutlookGraphError("graph_invalid_state", "Microsoft OAuth state could not be decoded.");
  }

  if (
    typeof payload.state_handle !== "string" ||
    payload.state_handle.trim() === "" ||
    typeof payload.pkce_verifier_ciphertext !== "string" ||
    payload.pkce_verifier_ciphertext.trim() === ""
  ) {
    throw new OutlookGraphError("graph_invalid_state", "Microsoft OAuth state is incomplete.");
  }

  return decryptSecret(payload.pkce_verifier_ciphertext, payload.state_handle);
}

function parseGraphResponseForUrl(url: string, payload: unknown) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return payload;
  }

  if (pathname.endsWith("/me")) {
    return parseGraphUserProfile(payload);
  }
  if (pathname.endsWith("/me/calendars")) {
    return parseGraphCalendarResponse(payload);
  }
  if (pathname.includes("/calendarview")) {
    return parseGraphEventResponse(payload);
  }
  if (pathname.endsWith("/mailfolders")) {
    return parseGraphFolderResponse(payload);
  }
  if (pathname.endsWith("/messages")) {
    return parseGraphMessageResponse(payload);
  }
  return payload;
}

function parseWithContract<T>(parse: () => T, operation: string, statusCode?: number | null): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof OutlookGraphContractError) {
      throw new OutlookGraphError(
        "graph_contract_violation",
        `Microsoft Graph returned an unexpected payload for ${operation}: ${error.issues.join("; ")}`,
        { statusCode: statusCode ?? null }
      );
    }
    throw error;
  }
}

async function safeRecordOutlookIntegrationEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    eventLevel: "info" | "warning" | "error";
    eventType: string;
    eventStatus?: string;
    summary: string;
    detail?: Record<string, unknown>;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
  }
) {
  try {
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      integrationArea: "outlook_calendar_sync",
      eventLevel: input.eventLevel,
      eventType: input.eventType,
      eventStatus: input.eventStatus,
      summary: input.summary,
      detail: input.detail ?? {},
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      externalTarget: `microsoft_graph:${OUTLOOK_GRAPH_API_VERSION}`
    });
  } catch {
    // Observability must not break Outlook flows.
  }
}

async function detectOutlookRefreshAnomaly(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  connectionId: string
) {
  const { rows } = await client.query<{ refresh_count: string }>(
    `
      SELECT count(*)::text AS refresh_count
      FROM microsoft_integration_event
      WHERE tenant_id = $1
        AND integration_area = 'outlook_calendar_sync'::microsoft_integration_area
        AND event_type = 'outlook.oauth.token_refreshed'
        AND occurred_at >= now() - interval '1 hour'
    `,
    [tenantId]
  );
  const refreshCount = Number(rows[0]?.refresh_count ?? "0");
  if (refreshCount < OUTLOOK_TOKEN_REFRESH_ANOMALY_THRESHOLD) {
    return;
  }

  await safeRecordOutlookIntegrationEvent(client, {
    tenantId,
    actorUserId,
    eventLevel: "warning",
    eventType: "outlook.oauth.abnormal_refresh_pattern",
    eventStatus: "warning",
    relatedEntityType: "outlook_account",
    relatedEntityId: connectionId,
    summary: "Outlook delegated token refresh activity exceeded the expected hourly threshold.",
    detail: {
      graph_api_version: OUTLOOK_GRAPH_API_VERSION,
      refresh_count_last_hour: refreshCount,
      threshold: OUTLOOK_TOKEN_REFRESH_ANOMALY_THRESHOLD
    }
  });
}

async function readJsonPayload(response: Response, operation: string) {
  try {
    return await response.json();
  } catch {
    throw new OutlookGraphError(
      "graph_contract_violation",
      `Microsoft Graph returned an invalid JSON payload for ${operation}.`,
      {
        statusCode: response.status
      }
    );
  }
}

function describeGraphOperation(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith("/me/calendars")) {
      return "list_calendars";
    }
    if (pathname.includes("/calendarview")) {
      return "preview_events";
    }
    if (pathname.endsWith("/me")) {
      return "load_profile";
    }
  } catch {
    // Ignore malformed URLs and fall through to the generic label.
  }
  return "graph_request";
}

function safeReadRetryAfterSeconds(headers: Headers | undefined) {
  return headers ? readRetryAfterSeconds(headers) : null;
}
