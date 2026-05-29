import type { PoolClient } from "pg";
import { isOutlookOauthConfigured } from "../config/outlook.js";
import type { AuthUser } from "../types/auth.js";
import type {
  OutlookAccount,
  OutlookCalendarVisibilityPreference,
  OutlookSyncError,
  OutlookSyncRun
} from "../types/outlook.js";
import { createAuditLog } from "./audit.js";

export type OutlookProviderMode = "mock" | "graph_live";

export type RequestAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ShootSnapshot = {
  id: string;
  shoot_code: string;
  title: string;
  location_name: string;
  location_address: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
};

export type OutlookConnectionRow = {
  id: string;
  tenant_id: string;
  connected_by_user_id: string | null;
  auth_session_id: string | null;
  provider_mode: OutlookProviderMode;
  connection_status: "connected" | "disconnected" | "attention";
  health_state:
    | "mock"
    | "disconnected"
    | "connected_pending_sync"
    | "connected_healthy"
    | "connected_warning"
    | "connected_error";
  connected_account_email: string | null;
  provider_tenant_id: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string | null;
  scopes: string[] | null;
  records_synced: number;
  warning_count: number;
  error_count: number;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  last_error_message: string | null;
  disconnected_at: string | null;
};

type OutlookSyncRunRow = {
  id: string;
  connection_id: string | null;
  provider_mode: OutlookProviderMode;
  started_at: string;
  finished_at: string | null;
  status: "success" | "warning" | "error";
  records_synced: number;
  warnings: unknown;
  errors: unknown;
};

export type OutlookOauthStateRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  auth_session_id: string;
  redirect_path: string;
};

type OutlookTenantStateRow = {
  tenant_id: string;
  active_provider_mode: OutlookProviderMode;
  updated_at: string;
};

export type OutlookCalendarVisibilityRow = {
  provider_mode: OutlookProviderMode;
  calendar_id: string;
  visible_in_app: boolean;
  updated_at: string;
};

export type ResolvedOutlookTenantState = {
  activeProviderMode: OutlookProviderMode;
  activeConnection: OutlookConnectionRow | null;
  connectionsByMode: Record<OutlookProviderMode, OutlookConnectionRow | null>;
};

export async function listConnections(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<OutlookConnectionRow>(
    `
      SELECT *
      FROM outlook_connection
      WHERE tenant_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [tenantId]
  );
  return rows;
}

export async function loadConnectionByProvider(
  client: PoolClient,
  tenantId: string,
  providerMode: OutlookProviderMode
) {
  const { rows } = await client.query<OutlookConnectionRow>(
    `
      SELECT *
      FROM outlook_connection
      WHERE tenant_id = $1
        AND provider_mode = $2::outlook_provider_mode
      LIMIT 1
    `,
    [tenantId, providerMode]
  );
  return rows[0] ?? null;
}

export async function loadConnection(client: PoolClient, tenantId: string) {
  const tenantState = await loadOutlookTenantState(client, tenantId);
  return tenantState.activeConnection;
}

export async function loadActiveProviderMode(client: PoolClient, tenantId: string) {
  const tenantState = await loadOutlookTenantState(client, tenantId);
  return tenantState.activeProviderMode;
}

export async function setActiveProviderMode(
  client: PoolClient,
  tenantId: string,
  providerMode: OutlookProviderMode
) {
  await client.query(
    `
      INSERT INTO outlook_tenant_state (tenant_id, active_provider_mode, updated_at)
      VALUES ($1, $2::outlook_provider_mode, now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        active_provider_mode = EXCLUDED.active_provider_mode,
        updated_at = now()
    `,
    [tenantId, providerMode]
  );
}

export async function loadOutlookTenantState(
  client: PoolClient,
  tenantId: string
): Promise<ResolvedOutlookTenantState> {
  const tenantStateResult = await client.query<OutlookTenantStateRow>(
    `
      SELECT tenant_id, active_provider_mode::text AS active_provider_mode, updated_at::text AS updated_at
      FROM outlook_tenant_state
      WHERE tenant_id = $1
      LIMIT 1
    `,
    [tenantId]
  );
  const connections = await listConnections(client, tenantId);

  const connectionsByMode: Record<OutlookProviderMode, OutlookConnectionRow | null> = {
    mock: null,
    graph_live: null
  };
  for (const connection of connections) {
    connectionsByMode[connection.provider_mode] = connection;
  }

  const persistedMode = tenantStateResult.rows[0]?.active_provider_mode ?? null;
  const activeProviderMode = resolveActiveProviderMode(persistedMode, connectionsByMode);

  return {
    activeProviderMode,
    activeConnection: connectionsByMode[activeProviderMode],
    connectionsByMode
  };
}

export async function listSyncRuns(
  client: PoolClient,
  tenantId: string,
  providerMode?: OutlookProviderMode | null
): Promise<OutlookSyncRun[]> {
  const { rows } = await client.query<OutlookSyncRunRow>(
    `
      SELECT
        id,
        connection_id::text,
        provider_mode::text AS provider_mode,
        started_at::text,
        finished_at::text,
        status::text,
        records_synced,
        warnings,
        errors
      FROM outlook_sync_run
      WHERE tenant_id = $1
        AND ($2::outlook_provider_mode IS NULL OR provider_mode = $2::outlook_provider_mode)
      ORDER BY created_at DESC
      LIMIT 6
    `,
    [tenantId, providerMode ?? null]
  );

  return rows.map(mapSyncRunRow);
}

export async function listCalendarVisibilityPreferences(
  client: PoolClient,
  tenantId: string,
  userId: string,
  providerMode: OutlookProviderMode
): Promise<OutlookCalendarVisibilityPreference[]> {
  const { rows } = await client.query<OutlookCalendarVisibilityRow>(
    `
      SELECT provider_mode::text AS provider_mode, calendar_id, visible_in_app, updated_at::text
      FROM outlook_calendar_visibility_preference
      WHERE tenant_id = $1
        AND user_id = $2
        AND provider_mode = $3::outlook_provider_mode
      ORDER BY updated_at DESC
    `,
    [tenantId, userId, providerMode]
  );

  return rows.map((row) => ({
    calendar_id: row.calendar_id,
    visible_in_app: Boolean(row.visible_in_app)
  }));
}

export async function setCalendarVisibilityPreference(
  client: PoolClient,
  input: {
    tenantId: string;
    userId: string;
    providerMode: OutlookProviderMode;
    calendarId: string;
    visibleInApp: boolean;
  }
): Promise<OutlookCalendarVisibilityPreference> {
  const { rows } = await client.query<OutlookCalendarVisibilityRow>(
    `
      INSERT INTO outlook_calendar_visibility_preference (
        tenant_id,
        user_id,
        provider_mode,
        calendar_id,
        visible_in_app,
        updated_at
      )
      VALUES ($1,$2,$3::outlook_provider_mode,$4,$5,now())
      ON CONFLICT (tenant_id, user_id, provider_mode, calendar_id) DO UPDATE SET
        visible_in_app = EXCLUDED.visible_in_app,
        updated_at = now()
      RETURNING provider_mode::text AS provider_mode, calendar_id, visible_in_app, updated_at::text
    `,
    [input.tenantId, input.userId, input.providerMode, input.calendarId, input.visibleInApp]
  );

  return {
    calendar_id: rows[0].calendar_id,
    visible_in_app: Boolean(rows[0].visible_in_app)
  };
}

export async function upsertConnection(
  client: PoolClient,
  tenantId: string,
  patch: Partial<OutlookConnectionRow> & {
    provider_mode: OutlookProviderMode;
    connection_status: "connected" | "disconnected" | "attention";
    health_state: OutlookConnectionRow["health_state"];
  }
) {
  const { rows } = await client.query<OutlookConnectionRow>(
    `
      INSERT INTO outlook_connection (
        tenant_id,
        connected_by_user_id,
        auth_session_id,
        provider_mode,
        connection_status,
        health_state,
        connected_account_email,
        provider_tenant_id,
        encrypted_access_token,
        encrypted_refresh_token,
        access_token_expires_at,
        scopes,
        records_synced,
        warning_count,
        error_count,
        last_successful_sync_at,
        last_failed_sync_at,
        last_error_message,
        disconnected_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,$14,$15,$16,$17,$18,$19,now()
      )
      ON CONFLICT (tenant_id, provider_mode) DO UPDATE SET
        connected_by_user_id = EXCLUDED.connected_by_user_id,
        auth_session_id = EXCLUDED.auth_session_id,
        connection_status = EXCLUDED.connection_status,
        health_state = EXCLUDED.health_state,
        connected_account_email = EXCLUDED.connected_account_email,
        provider_tenant_id = COALESCE(EXCLUDED.provider_tenant_id, outlook_connection.provider_tenant_id),
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        scopes = EXCLUDED.scopes,
        records_synced = COALESCE(EXCLUDED.records_synced, outlook_connection.records_synced),
        warning_count = COALESCE(EXCLUDED.warning_count, outlook_connection.warning_count),
        error_count = COALESCE(EXCLUDED.error_count, outlook_connection.error_count),
        last_successful_sync_at = COALESCE(EXCLUDED.last_successful_sync_at, outlook_connection.last_successful_sync_at),
        last_failed_sync_at = COALESCE(EXCLUDED.last_failed_sync_at, outlook_connection.last_failed_sync_at),
        last_error_message = EXCLUDED.last_error_message,
        disconnected_at = EXCLUDED.disconnected_at,
        updated_at = now()
      RETURNING *
    `,
    [
      tenantId,
      patch.connected_by_user_id ?? null,
      patch.auth_session_id ?? null,
      patch.provider_mode,
      patch.connection_status,
      patch.health_state,
      patch.connected_account_email ?? null,
      patch.provider_tenant_id ?? null,
      patch.encrypted_access_token ?? null,
      patch.encrypted_refresh_token ?? null,
      patch.access_token_expires_at ?? null,
      patch.scopes ?? [],
      patch.records_synced ?? 0,
      patch.warning_count ?? 0,
      patch.error_count ?? 0,
      patch.last_successful_sync_at ?? null,
      patch.last_failed_sync_at ?? null,
      patch.last_error_message ?? null,
      patch.disconnected_at ?? null
    ]
  );
  return rows[0];
}

export async function recordSyncRun(
  client: PoolClient,
  input: {
    tenantId: string;
    connectionId: string | null;
    actorUserId: string | null;
    providerMode: OutlookProviderMode;
    status: "success" | "warning" | "error";
    recordsSynced: number;
    warnings: string[];
    errors: OutlookSyncError[];
  }
) {
  const { rows } = await client.query<OutlookSyncRunRow>(
    `
      INSERT INTO outlook_sync_run (
        tenant_id, connection_id, actor_user_id, provider_mode, started_at, finished_at, status, records_synced, warnings, errors
      )
      VALUES ($1,$2,$3,$4, now(), now(), $5, $6, $7::jsonb, $8::jsonb)
      RETURNING
        id,
        connection_id::text,
        provider_mode::text AS provider_mode,
        started_at::text,
        finished_at::text,
        status::text,
        records_synced,
        warnings,
        errors
    `,
    [
      input.tenantId,
      input.connectionId,
      input.actorUserId,
      input.providerMode,
      input.status,
      input.recordsSynced,
      JSON.stringify(input.warnings),
      JSON.stringify(input.errors)
    ]
  );

  const row = rows[0];
  return mapSyncRunRow(row);
}

function mapSyncRunRow(row: OutlookSyncRunRow): OutlookSyncRun {
  const warnings = Array.isArray(row.warnings) ? (row.warnings as string[]) : [];
  const errors = Array.isArray(row.errors) ? (row.errors as OutlookSyncError[]) : [];
  const firstError = errors[0];

  return {
    id: row.id,
    provider_mode: row.provider_mode,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    records_synced: Number(row.records_synced ?? 0),
    warnings,
    errors,
    source_object: {
      type: row.provider_mode === "graph_live" ? "outlook_connection" : "outlook_mock_workspace",
      id: row.connection_id
    },
    target_object: {
      type: "mission_control_outlook_status",
      id: row.provider_mode
    },
    last_attempted_sync_at: row.finished_at ?? row.started_at,
    last_successful_sync_at: row.status === "error" ? null : row.finished_at,
    last_failed_sync_at: row.status === "error" ? row.finished_at : null,
    retry_state: firstError?.retry_state ?? (row.status === "error" ? "manual_retry_required" : "none"),
    retry_after_seconds: firstError?.retry_after_seconds ?? null
  } satisfies OutlookSyncRun;
}

export async function listUpcomingShoots(client: PoolClient, date: string): Promise<ShootSnapshot[]> {
  const { rows } = await client.query<ShootSnapshot>(
    `
      SELECT id, shoot_code, title, location_name, location_address, arrival_time, start_time, end_time_est
      FROM shoot
      WHERE shoot_date BETWEEN $1::date AND ($1::date + INTERVAL '10 days')::date
        AND deleted_at IS NULL
      ORDER BY start_time NULLS LAST, created_at
    `,
    [date]
  );
  return rows;
}

export async function ensureMockConnection(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "id" | "sessionId">,
  options: { connect?: boolean; makeActive?: boolean } = {}
) {
  const existing = await loadConnectionByProvider(client, auth.tenantId, "mock");
  const connected = options.connect ?? true;
  const makeActive = options.makeActive ?? true;
  if (makeActive) {
    await setActiveProviderMode(client, auth.tenantId, "mock");
  }
  if (existing && existing.connection_status === (connected ? "connected" : "disconnected")) {
    return existing;
  }

  const connection = await upsertConnection(client, auth.tenantId, {
    connected_by_user_id: auth.id,
    auth_session_id: auth.sessionId,
    provider_mode: "mock",
    connection_status: connected ? "connected" : "disconnected",
    health_state: connected ? "mock" : "disconnected",
    connected_account_email: null,
    provider_tenant_id: null,
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    access_token_expires_at: null,
    scopes: [],
    disconnected_at: connected ? null : new Date().toISOString()
  });

  const existingRuns = await listSyncRuns(client, auth.tenantId, "mock");
  if (!existingRuns.length && connected) {
    const seededRuns = [
      await recordSyncRun(client, {
        tenantId: auth.tenantId,
        connectionId: connection.id,
        actorUserId: auth.id,
        providerMode: "mock",
        status: "success",
        recordsSynced: 14,
        warnings: [],
        errors: []
      }),
      await recordSyncRun(client, {
        tenantId: auth.tenantId,
        connectionId: connection.id,
        actorUserId: auth.id,
        providerMode: "mock",
        status: "warning",
        recordsSynced: 13,
        warnings: ["One hidden calendar stayed out of the dashboard preview until leadership turned it on."],
        errors: []
      }),
      await recordSyncRun(client, {
        tenantId: auth.tenantId,
        connectionId: connection.id,
        actorUserId: auth.id,
        providerMode: "mock",
        status: "success",
        recordsSynced: 16,
        warnings: [],
        errors: []
      }),
      await recordSyncRun(client, {
        tenantId: auth.tenantId,
        connectionId: connection.id,
        actorUserId: auth.id,
        providerMode: "mock",
        status: "warning",
        recordsSynced: 12,
        warnings: [
          "Graph writeback is disabled in this thin calendar pass.",
          "Mock calendar previews stay available so leadership can review visibility controls without Microsoft credentials."
        ],
        errors: []
      })
    ];
    const initialRun = seededRuns.at(-1)!;

    return upsertConnection(client, auth.tenantId, {
      connected_by_user_id: auth.id,
      auth_session_id: auth.sessionId,
      provider_mode: "mock",
      connection_status: "connected",
      health_state: "mock",
      connected_account_email: null,
      provider_tenant_id: null,
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      access_token_expires_at: null,
      scopes: [],
      records_synced: initialRun.records_synced,
      warning_count: initialRun.warnings.length,
      error_count: 0,
      last_successful_sync_at: initialRun.finished_at,
      last_failed_sync_at: null,
      last_error_message: null,
      disconnected_at: null
    });
  }

  return connection;
}

export async function applySyncOutcome(client: PoolClient, connection: OutlookConnectionRow, run: OutlookSyncRun) {
  await upsertConnection(client, connection.tenant_id, {
    connected_by_user_id: connection.connected_by_user_id,
    auth_session_id: connection.auth_session_id,
    provider_mode: connection.provider_mode,
    connection_status: run.status === "error" ? "attention" : "connected",
    health_state:
      connection.provider_mode === "mock"
        ? "mock"
        : run.status === "error"
          ? "connected_error"
          : run.status === "warning"
            ? "connected_warning"
            : "connected_healthy",
    connected_account_email: connection.connected_account_email,
    provider_tenant_id: connection.provider_tenant_id,
    encrypted_access_token: connection.encrypted_access_token,
    encrypted_refresh_token: connection.encrypted_refresh_token,
    access_token_expires_at: connection.access_token_expires_at,
    scopes: connection.scopes ?? [],
    records_synced: run.records_synced,
    warning_count: run.warnings.length,
    error_count: run.errors.length,
    last_successful_sync_at: run.status === "error" ? connection.last_successful_sync_at : run.finished_at,
    last_failed_sync_at: run.status === "error" ? run.finished_at : null,
    last_error_message: run.errors[0]?.message ?? null,
    disconnected_at: null
  });
}

export async function clearProviderConnectionState(
  client: PoolClient,
  tenantId: string,
  providerMode: OutlookProviderMode
) {
  await client.query(
    `
      DELETE FROM outlook_calendar_visibility_preference
      WHERE tenant_id = $1
        AND provider_mode = $2::outlook_provider_mode
    `,
    [tenantId, providerMode]
  );
  await client.query(
    `
      DELETE FROM outlook_sync_run
      WHERE tenant_id = $1
        AND provider_mode = $2::outlook_provider_mode
    `,
    [tenantId, providerMode]
  );
  await client.query(
    `
      DELETE FROM outlook_connection
      WHERE tenant_id = $1
        AND provider_mode = $2::outlook_provider_mode
    `,
    [tenantId, providerMode]
  );

  if (providerMode === "graph_live") {
    await client.query(
      `
        DELETE FROM outlook_oauth_state
        WHERE tenant_id = $1
      `,
      [tenantId]
    );
  }

  await setActiveProviderMode(client, tenantId, providerMode);
}

export async function clearPilotTenantOutlookData(client: PoolClient, tenantId: string) {
  await client.query("DELETE FROM outlook_calendar_visibility_preference WHERE tenant_id = $1", [tenantId]);
  await client.query("DELETE FROM outlook_sync_run WHERE tenant_id = $1", [tenantId]);
  await client.query("DELETE FROM outlook_connection WHERE tenant_id = $1", [tenantId]);
  await client.query("DELETE FROM outlook_oauth_state WHERE tenant_id = $1", [tenantId]);
  await client.query("DELETE FROM integration_sync_operation WHERE tenant_id = $1 AND provider = 'outlook'", [tenantId]);
  await setActiveProviderMode(client, tenantId, getDefaultProviderMode());
}

export async function createOutlookAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
  meta: RequestAuditContext = {}
) {
  return createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
}

export function resolveOutlookAccount(tenantId: string, tenantState: ResolvedOutlookTenantState): OutlookAccount {
  return tenantState.activeConnection
    ? mapConnectionToAccount(tenantState.activeConnection)
    : buildDefaultAccount(tenantId, tenantState.activeProviderMode);
}

export function buildDefaultAccount(tenantId: string, providerMode: OutlookProviderMode = getDefaultProviderMode()): OutlookAccount {
  return providerMode === "graph_live"
    ? {
        id: `outlook-account-${tenantId}`,
        tenant_id: tenantId,
        provider_mode: "graph_live",
        connection_status: "disconnected",
        health_state: "disconnected",
        connected_as: null,
        connection_label: "Microsoft Graph is configured, but this tenant has not connected Outlook calendars yet.",
        degraded_reason: null,
        last_error_message: null,
        last_sync_at: null,
        last_failed_sync_at: null,
        records_synced: 0,
        warning_count: 0,
        error_count: 0
      }
    : {
        id: `mock-account-${tenantId}`,
        tenant_id: tenantId,
        provider_mode: "mock",
        connection_status: "disconnected",
        health_state: "disconnected",
        connected_as: null,
        connection_label: "Connect the mock Outlook workspace to preview leadership calendar data locally.",
        degraded_reason: null,
        last_error_message: null,
        last_sync_at: null,
        last_failed_sync_at: null,
        records_synced: 0,
        warning_count: 0,
        error_count: 0
      };
}

export function buildGraphDiagnosticsAccount(tenantId: string): OutlookAccount {
  const configured = isGraphConfigured();
  return {
    id: `graph-stub-${tenantId}`,
    tenant_id: tenantId,
    provider_mode: "graph_stub",
    connection_status: configured ? "attention" : "disconnected",
    health_state: configured ? "connected_warning" : "disconnected",
    connected_as: configured ? "Microsoft Graph credentials detected" : null,
    connection_label: configured
      ? "Microsoft Graph app credentials are present. The live read-only calendar provider is available for tenant connection."
      : "Microsoft Graph app credentials are not configured, so the Outlook calendar module stays in mock mode.",
    degraded_reason: configured ? "Live Microsoft 365 is available but not connected for this tenant." : null,
    last_error_message: null,
    last_sync_at: null,
    last_failed_sync_at: null,
    records_synced: 0,
    warning_count: configured ? 1 : 0,
    error_count: 0
  };
}

export function mapConnectionToAccount(connection: OutlookConnectionRow): OutlookAccount {
  return {
    id: connection.id,
    tenant_id: connection.tenant_id,
    provider_mode: connection.provider_mode,
    connection_status: connection.connection_status,
    health_state: connection.health_state,
    connected_as: connection.provider_mode === "mock" ? null : connection.connected_account_email,
    connection_label: buildConnectionLabel(connection),
    degraded_reason: deriveOutlookDegradedReason(connection),
    last_error_message: connection.last_error_message,
    last_sync_at: connection.last_successful_sync_at,
    last_failed_sync_at: connection.last_failed_sync_at,
    records_synced: Number(connection.records_synced ?? 0),
    warning_count: Number(connection.warning_count ?? 0),
    error_count: Number(connection.error_count ?? 0)
  };
}

export function buildConnectionLabel(connection: OutlookConnectionRow) {
  if (connection.provider_mode === "mock") {
    return connection.connection_status === "connected"
      ? "Mock workspace connected. Leadership can preview calendars and dashboard visibility without Microsoft credentials."
      : "Mock workspace disconnected. Reconnect the mock workspace to keep local Outlook calendar previews available.";
  }

  if (connection.health_state === "connected_pending_sync") {
    return "Microsoft Graph is connected. Run a sync to capture the first durable read-only health snapshot.";
  }
  if (connection.health_state === "connected_healthy") {
    return "Microsoft Graph is connected and the last read-only sync completed successfully.";
  }
  if (connection.health_state === "connected_warning") {
    return connection.last_error_message || "Microsoft Graph is connected with warnings. Review the latest sync health details.";
  }
  if (connection.health_state === "connected_error") {
    return connection.last_error_message || "Microsoft Graph needs attention. Reconnect or retry sync to restore live previews.";
  }
  return "Microsoft Graph is configured for this tenant, but no active Outlook connection is currently available.";
}

function deriveOutlookDegradedReason(connection: OutlookConnectionRow) {
  if (connection.provider_mode === "mock") {
    return null;
  }
  if (connection.last_error_message) {
    return connection.last_error_message;
  }
  if (connection.connection_status === "attention") {
    return "Microsoft Graph needs attention before live calendar previews can be trusted.";
  }
  if (connection.connection_status === "disconnected") {
    return "Microsoft Graph is configured, but this tenant is not currently connected.";
  }
  if (!connection.access_token_expires_at) {
    return null;
  }
  const expiresAtMs = Date.parse(connection.access_token_expires_at);
  if (Number.isNaN(expiresAtMs) || expiresAtMs > Date.now()) {
    return null;
  }
  if (connection.encrypted_refresh_token) {
    return "Delegated Outlook access has expired. Use Refresh Live Preview to renew the preview session.";
  }
  return "Delegated Outlook access has expired and no refresh token is available. Reconnect Microsoft 365.";
}

export function isGraphConfigured() {
  return isOutlookOauthConfigured();
}

function getDefaultProviderMode(): OutlookProviderMode {
  return isGraphConfigured() ? "graph_live" : "mock";
}

function resolveActiveProviderMode(
  persistedMode: OutlookProviderMode | null,
  connectionsByMode: Record<OutlookProviderMode, OutlookConnectionRow | null>
): OutlookProviderMode {
  if (persistedMode) {
    return persistedMode;
  }
  if (connectionsByMode.graph_live && !connectionsByMode.mock) {
    return "graph_live";
  }
  if (connectionsByMode.mock && !connectionsByMode.graph_live) {
    return "mock";
  }
  if (connectionsByMode.graph_live && isGraphConfigured()) {
    return "graph_live";
  }
  if (connectionsByMode.mock) {
    return "mock";
  }
  return getDefaultProviderMode();
}
