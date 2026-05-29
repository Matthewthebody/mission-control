import type { PoolClient } from "pg";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  OutlookAccount,
  OutlookCalendar,
  OutlookCalendarVisibilityPreference,
  OutlookConnectResponse,
  OutlookEvent,
  OutlookMessage,
  OutlookMailFolder,
  OutlookReconciliationReport,
  OutlookReplaySummary,
  OutlookStatusPayload,
  OutlookSyncRun
} from "../types/outlook.js";
import { enrichOutlookEventsWithLocationIntelligence } from "./locations.js";
import {
  createGraphConnectResponse,
  GraphOutlookCalendarProvider,
  handleGraphOauthCallback,
  markGraphConnectionAttention,
  OutlookGraphError,
  toSyncError,
  type GraphContext
} from "./outlookGraph.js";
import {
  applySyncOutcome,
  buildDefaultAccount,
  buildGraphDiagnosticsAccount,
  clearPilotTenantOutlookData,
  clearProviderConnectionState,
  createOutlookAudit,
  ensureMockConnection,
  isGraphConfigured,
  listCalendarVisibilityPreferences,
  listSyncRuns,
  listUpcomingShoots,
  loadOutlookTenantState,
  mapConnectionToAccount,
  recordSyncRun,
  resolveOutlookAccount,
  setCalendarVisibilityPreference,
  setActiveProviderMode,
  upsertConnection,
  type OutlookConnectionRow,
  type RequestAuditContext
} from "./outlookStore.js";
import { replayIntegrationSyncOperationsByFilter, type SyncOperationStatus } from "./integrationSync.js";

type OutlookCalendarWindow = "today" | "3day" | "week";

type OutlookPreviewFilters = {
  date: string;
  calendarId?: string;
  calendarIds?: string[];
  window?: OutlookCalendarWindow;
  enabledOnly?: boolean;
  folderId?: string;
  overlapOnly?: boolean;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  importantOnly?: boolean;
};

type OutlookReplayFilters = {
  dateFrom?: string | null;
  dateTo?: string | null;
  statuses?: SyncOperationStatus[] | null;
  limit?: number;
};

export type OutlookResetScope = "mock_preview" | "graph_live_connection" | "pilot_tenant_test_data";

export interface OutlookCalendarProvider {
  getStatus(context: GraphContext): Promise<OutlookAccount>;
  connect(context: GraphContext): Promise<OutlookAccount>;
  disconnect(context: GraphContext): Promise<OutlookAccount>;
  sync(context: GraphContext): Promise<OutlookSyncRun>;
  listCalendars(context: GraphContext): Promise<OutlookCalendar[]>;
  previewEvents(context: GraphContext, filters: OutlookPreviewFilters): Promise<OutlookEvent[]>;
}

export interface OutlookProvider extends OutlookCalendarProvider {
  listFolders(context: GraphContext): Promise<OutlookMailFolder[]>;
  previewMessages(context: GraphContext, filters: OutlookPreviewFilters): Promise<OutlookMessage[]>;
}

export class MockOutlookCalendarProvider implements OutlookProvider {
  async getStatus(context: GraphContext): Promise<OutlookAccount> {
    return context.connection ? mapConnectionToAccount(context.connection) : buildDefaultAccount(context.tenantId, "mock");
  }

  async connect(context: GraphContext): Promise<OutlookAccount> {
    const connection = await ensureMockConnection(context.client, context.actor, { connect: true, makeActive: true });
    return mapConnectionToAccount(connection);
  }

  async disconnect(context: GraphContext): Promise<OutlookAccount> {
    const connection = await ensureMockConnection(context.client, context.actor, { connect: false, makeActive: true });
    return mapConnectionToAccount(connection);
  }

  async sync(context: GraphContext): Promise<OutlookSyncRun> {
    const connection = await ensureMockConnection(context.client, context.actor, { connect: true, makeActive: true });
    const calendars = await this.listCalendars(context);
    const events = await this.previewEvents(context, { date: context.date, window: "week" });
    const warnings = [
      "Outlook stays delegated and read-only in this Phase 1 pilot. Calendar writeback and mailbox access remain disabled.",
      context.shoots.length
        ? "Mock Outlook preview stays available so leadership can compare live schedules against the seeded Outlook view."
        : "No shoots were available to compare against the mock Outlook preview."
    ];

    const run = await recordSyncRun(context.client, {
      tenantId: context.actor.tenantId,
      connectionId: connection.id,
      actorUserId: context.actor.id,
      providerMode: "mock",
      status: "warning",
      recordsSynced: calendars.length + events.length,
      warnings,
      errors: []
    });

    await applySyncOutcome(context.client, connection, run);
    return run;
  }

  async listCalendars(context: GraphContext): Promise<OutlookCalendar[]> {
    const connection = context.connection;
    if (!connection || connection.connection_status !== "connected") {
      return [];
    }
    return buildMockCalendarCatalog(context);
  }

  async listFolders(context: GraphContext): Promise<OutlookMailFolder[]> {
    void context;
    return [];
  }

  async previewEvents(context: GraphContext, filters: OutlookPreviewFilters): Promise<OutlookEvent[]> {
    const connection = context.connection;
    if (!connection || connection.connection_status !== "connected") {
      return [];
    }
    return buildMockCalendarEvents(context, filters);
  }

  async previewMessages(context: GraphContext, filters: OutlookPreviewFilters): Promise<OutlookMessage[]> {
    void context;
    void filters;
    return [];
  }
}

export const MockOutlookProvider = MockOutlookCalendarProvider;

export async function getOutlookStatus(client: PoolClient, auth: AuthUser, date: string): Promise<OutlookStatusPayload> {
  const context = await buildContext(client, auth, date);
  return buildStatusPayload(client, context);
}

export async function connectOutlook(
  client: PoolClient,
  auth: AuthUser,
  date: string,
  provider: "mock" | "graph" = "mock",
  metadata: RequestAuditContext = {}
): Promise<OutlookConnectResponse> {
  const context = await buildContext(client, auth, date);
  const statusPayload: OutlookConnectResponse = {
    ...(await buildStatusPayload(client, context)),
    connect_mode: "connected",
    authorization_url: null
  };

  if (provider === "graph") {
    if (!isGraphConfigured()) {
      throw new ApiError(
        400,
        "Microsoft Outlook delegated pilot is not configured in this environment. Add the approved OUTLOOK_* settings or use the mock preview."
      );
    }
    return createGraphConnectResponse(client, auth, statusPayload);
  }

  const account = await new MockOutlookProvider().connect(context);
  await createOutlookAudit(
    client,
    {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "outlook.integration.connected",
      entityType: "outlook_account",
      entityId: account.id,
      metadata: { provider_mode: account.provider_mode, connected_as: account.connected_as }
    },
    metadata
  );

  return {
    ...(await buildStatusPayload(client, await buildContext(client, auth, date))),
    connect_mode: "mock",
    authorization_url: null
  };
}

export async function disconnectOutlook(
  client: PoolClient,
  auth: AuthUser,
  date: string,
  metadata: RequestAuditContext = {}
) {
  const context = await buildContext(client, auth, date);
  const current = context.connection;

  if (context.activeProviderMode === "graph_live") {
    if (current) {
      await createGraphDisconnect(client, current, auth);
    } else {
      await setActiveProviderMode(client, auth.tenantId, "graph_live");
    }
  } else {
    await new MockOutlookProvider().disconnect(context);
  }

  await createOutlookAudit(
    client,
    {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "outlook.integration.disconnected",
      entityType: "outlook_account",
      entityId: current?.id ?? null,
      metadata: { provider_mode: current?.provider_mode ?? context.activeProviderMode }
    },
    metadata
  );

  return buildStatusPayload(client, await buildContext(client, auth, date));
}

export async function syncOutlook(
  client: PoolClient,
  auth: AuthUser,
  date: string,
  metadata: RequestAuditContext = {}
) {
  const context = await buildContext(client, auth, date);
  const provider = getActiveProvider(context);
  if (!provider) {
    throw new ApiError(400, "Connect Outlook before running sync");
  }

  try {
    let syncRun = await provider.sync(context);
    if (context.connection?.provider_mode === "graph_live") {
      syncRun = await recordSyncRun(client, {
        tenantId: auth.tenantId,
        connectionId: context.connection.id,
        actorUserId: auth.id,
        providerMode: "graph_live",
        status: syncRun.status,
        recordsSynced: syncRun.records_synced,
        warnings: syncRun.warnings,
        errors: syncRun.errors
      });
      await applySyncOutcome(client, context.connection, syncRun);
    }
    if (context.connection) {
      syncRun = applyConnectionOwnershipToSyncRun(syncRun, context.connection.connected_account_email);
      await createOutlookAudit(
        client,
        {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          action: "outlook.integration.sync_requested",
          entityType: "outlook_sync_run",
          entityId: syncRun.id,
          metadata: {
            provider_mode: syncRun.provider_mode ?? context.connection.provider_mode,
            status: syncRun.status,
            records_synced: syncRun.records_synced
          }
        },
        metadata
      );
    }
    return {
      ...(await buildStatusPayload(client, await buildContext(client, auth, date))),
      sync_run: syncRun
    };
  } catch (error) {
    if (context.connection?.provider_mode === "graph_live" && error instanceof OutlookGraphError) {
      await markGraphConnectionAttention(client, context.connection, error, auth, metadata);
      const failedRun = await recordSyncRun(client, {
        tenantId: auth.tenantId,
        connectionId: context.connection.id,
        actorUserId: auth.id,
        providerMode: "graph_live",
        status: "error",
        recordsSynced: 0,
        warnings: [],
        errors: [toSyncError(error)]
      });
      const decoratedFailedRun = applyConnectionOwnershipToSyncRun(
        failedRun,
        context.connection.connected_account_email
      );
      await applySyncOutcome(client, context.connection, failedRun);
      return {
        ...(await buildStatusPayload(client, await buildContext(client, auth, date))),
        sync_run: decoratedFailedRun
      };
    }
    throw error;
  }
}

export async function listOutlookCalendars(client: PoolClient, auth: AuthUser, date: string) {
  const context = await buildContext(client, auth, date);
  const provider = getActiveProvider(context);
  if (!provider) {
    return [];
  }
  try {
    const source = await loadCalendarSource(client, auth, date, context, provider);
    const events = await provider.previewEvents(context, {
      date,
      calendarIds: source.calendars.map((calendar) => calendar.id),
      window: "week"
    });
    const counts = countEventsByCalendar(events);
    return source.calendars.map((calendar) => ({
      ...calendar,
      upcoming_count: counts.get(calendar.id) ?? 0
    }));
  } catch (error) {
    return handleGraphPreviewFailure(client, context, auth, error, []);
  }
}

export async function listOutlookFolders(client: PoolClient, auth: AuthUser, date: string) {
  const context = await buildContext(client, auth, date);
  const provider = getActiveProvider(context);
  if (!provider) {
    return [];
  }
  try {
    return await provider.listFolders(context);
  } catch (error) {
    return handleGraphPreviewFailure(client, context, auth, error, []);
  }
}

export async function previewOutlookEvents(client: PoolClient, auth: AuthUser, filters: OutlookPreviewFilters) {
  const context = await buildContext(client, auth, filters.date);
  const provider = getActiveProvider(context);
  if (!provider) {
    return [];
  }
  try {
    const source = await loadCalendarSource(client, auth, filters.date, context, provider);
    const activeCalendarIds = source.calendars.filter((calendar) => calendar.visible_in_app).map((calendar) => calendar.id);
    const allCalendarIds = source.calendars.map((calendar) => calendar.id);
    const targetCalendarIds = filters.calendarId
      ? [filters.calendarId]
      : filters.calendarIds?.length
        ? filters.calendarIds
        : filters.enabledOnly === false
          ? allCalendarIds
          : activeCalendarIds;

    if (!targetCalendarIds.length) {
      return [];
    }

    const events = await provider.previewEvents(context, {
      ...filters,
      calendarIds: targetCalendarIds
    });
    return await enrichOutlookEventsWithLocationIntelligence(client, auth, events);
  } catch (error) {
    return handleGraphPreviewFailure(client, context, auth, error, []);
  }
}

export async function updateOutlookCalendarVisibility(
  client: PoolClient,
  auth: AuthUser,
  input: { calendarId: string; visibleInApp: boolean; date: string },
  metadata: RequestAuditContext = {}
) {
  const source = await loadCalendarSource(client, auth, input.date);
  if (!source.provider) {
    throw new ApiError(400, "Connect Outlook before updating calendar visibility");
  }

  const targetCalendar = source.calendars.find((calendar) => calendar.id === input.calendarId);
  if (!targetCalendar) {
    throw new ApiError(404, "Outlook calendar not found");
  }

  await setCalendarVisibilityPreference(client, {
    tenantId: auth.tenantId,
    userId: auth.id,
    providerMode: source.context.activeProviderMode,
    calendarId: input.calendarId,
    visibleInApp: input.visibleInApp
  });

  await createOutlookAudit(
    client,
    {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "outlook.calendar.visibility_updated",
      entityType: "outlook_calendar",
      entityId: input.calendarId,
      metadata: {
        calendar_name: targetCalendar.name,
        visible_in_app: input.visibleInApp
      }
    },
    metadata
  );

  return listOutlookCalendars(client, auth, input.date);
}

export async function previewOutlookMessages(client: PoolClient, auth: AuthUser, filters: OutlookPreviewFilters) {
  const context = await buildContext(client, auth, filters.date);
  const provider = getActiveProvider(context);
  if (!provider) {
    return [];
  }
  try {
    return await provider.previewMessages(context, filters);
  } catch (error) {
    return handleGraphPreviewFailure(client, context, auth, error, []);
  }
}

export async function replayOutlookSyncHistory(
  client: PoolClient,
  auth: AuthUser,
  input: OutlookReplayFilters
): Promise<OutlookReplaySummary> {
  const replay = await replayIntegrationSyncOperationsByFilter(client, auth, {
    provider: "outlook",
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    statuses: input.statuses ?? null,
    limit: input.limit ?? 200
  });
  const context = await buildContext(client, auth, getLocalDateString());

  return {
    provider_mode: context.activeProviderMode,
    queued_count: replay.operations.length,
    queued_operation_ids: replay.operations.map((operation) => operation.id),
    replay_scope: replay.replayScope,
    date_from: replay.dateFrom,
    date_to: replay.dateTo,
    status_filter: replay.statusFilter
  };
}

export async function getOutlookReconciliationReport(
  client: PoolClient,
  auth: AuthUser,
  input: Pick<OutlookPreviewFilters, "date" | "window">
): Promise<OutlookReconciliationReport> {
  const context = await buildContext(client, auth, input.date);
  const provider = getActiveProvider(context);
  const window = input.window ?? "week";
  if (!provider) {
    return {
      compared_at: new Date().toISOString(),
      provider_mode: context.activeProviderMode,
      connection_status: "disconnected",
      window,
      date: input.date,
      system_shoot_count: context.shoots.length,
      outlook_event_count: 0,
      matched_overlap_count: 0,
      missing_in_outlook: context.shoots.map((shoot) => ({
        id: shoot.id,
        label: `${shoot.shoot_code} | ${shoot.title}`,
        starts_at: shoot.start_time ?? null,
        ends_at: shoot.end_time_est ?? null,
        location: shoot.location_name ?? null
      })),
      outlook_only: []
    };
  }

  const source = await loadCalendarSource(client, auth, input.date, context, provider);
  const activeCalendarIds = source.calendars.filter((calendar) => calendar.visible_in_app).map((calendar) => calendar.id);
  const events =
    activeCalendarIds.length > 0
      ? await provider.previewEvents(context, {
          date: input.date,
          calendarIds: activeCalendarIds,
          window
        })
      : [];

  const matchedShootCodes = new Set(events.filter((event) => event.shoot_code).map((event) => event.shoot_code as string));
  const missingInOutlook = context.shoots
    .filter((shoot) => !matchedShootCodes.has(shoot.shoot_code))
    .map((shoot) => ({
      id: shoot.id,
      label: `${shoot.shoot_code} | ${shoot.title}`,
      starts_at: shoot.start_time ?? null,
      ends_at: shoot.end_time_est ?? null,
      location: shoot.location_name ?? null
    }));
  const outlookOnly = events
    .filter((event) => !event.overlaps_with_shoots)
    .map((event) => ({
      id: event.id,
      label: event.subject,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      location: event.location ?? null
    }));

  return {
    compared_at: new Date().toISOString(),
    provider_mode: context.activeProviderMode,
    connection_status: context.connection?.connection_status ?? "disconnected",
    window,
    date: input.date,
    system_shoot_count: context.shoots.length,
    outlook_event_count: events.length,
    matched_overlap_count: matchedShootCodes.size,
    missing_in_outlook: missingInOutlook,
    outlook_only: outlookOnly
  };
}

export async function handleOutlookOAuthCallback(
  client: PoolClient,
  input: { code?: string; state?: string; error?: string; errorDescription?: string },
  metadata: RequestAuditContext = {}
) {
  return handleGraphOauthCallback(client, input, metadata);
}

export async function resetOutlookState(
  client: PoolClient,
  auth: AuthUser,
  date: string,
  scope: OutlookResetScope,
  metadata: RequestAuditContext = {}
) {
  if (scope === "pilot_tenant_test_data" && config.NODE_ENV === "production") {
    throw new ApiError(409, "Full local pilot Outlook reset is only available outside production.");
  }

  if (scope === "mock_preview") {
    await clearProviderConnectionState(client, auth.tenantId, "mock");
  } else if (scope === "graph_live_connection") {
    await clearProviderConnectionState(client, auth.tenantId, "graph_live");
  } else {
    await clearPilotTenantOutlookData(client, auth.tenantId);
  }

  await createOutlookAudit(
    client,
    {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action:
        scope === "mock_preview"
          ? "outlook.integration.mock_reset"
          : scope === "graph_live_connection"
            ? "outlook.integration.live_reset"
            : "outlook.integration.local_pilot_reset",
      entityType: "outlook_account",
      metadata: { reset_scope: scope }
    },
    metadata
  );

  return buildStatusPayload(client, await buildContext(client, auth, date));
}

async function buildContext(client: PoolClient, auth: AuthUser, date: string): Promise<GraphContext> {
  const tenantState = await loadOutlookTenantState(client, auth.tenantId);

  return {
    client,
    tenantId: auth.tenantId,
    actor: {
      id: auth.id,
      tenantId: auth.tenantId,
      sessionId: auth.sessionId,
      email: auth.email,
      fullName: auth.fullName
    },
    shoots: await listUpcomingShoots(client, date),
    activeProviderMode: tenantState.activeProviderMode,
    connection: tenantState.activeConnection,
    date
  };
}

async function buildStatusPayload(client: PoolClient, context: GraphContext): Promise<OutlookStatusPayload> {
  const tenantState = await loadOutlookTenantState(client, context.tenantId);
  const account = resolveOutlookAccount(context.tenantId, tenantState);
  return {
    account,
    graph_stub: buildGraphDiagnosticsAccount(context.tenantId),
    sync_runs: (await listSyncRuns(client, context.tenantId, tenantState.activeProviderMode)).map((run) => ({
      ...run,
      target_object: {
        ...(run.target_object ?? {
          type: "mission_control_outlook_status",
          id: tenantState.activeProviderMode
        }),
        owner_email: tenantState.activeConnection?.connected_account_email ?? null
      },
      last_successful_sync_at: run.last_successful_sync_at ?? account.last_sync_at ?? null,
      last_failed_sync_at: run.last_failed_sync_at ?? account.last_failed_sync_at ?? null
    }))
  };
}

function applyConnectionOwnershipToSyncRun(syncRun: OutlookSyncRun, connectedAccountEmail: string | null | undefined) {
  return {
    ...syncRun,
    target_object: {
      ...(syncRun.target_object ?? {
        type: "mission_control_outlook_status",
        id: syncRun.provider_mode ?? null
      }),
      owner_email: connectedAccountEmail ?? null
    }
  } satisfies OutlookSyncRun;
}

function getActiveProvider(context: GraphContext): OutlookProvider | null {
  const connection = context.connection;
  if (!connection || connection.connection_status === "disconnected") {
    return null;
  }
  if (connection.provider_mode === "graph_live") {
    return new GraphOutlookCalendarProvider();
  }
  return new MockOutlookCalendarProvider();
}

async function handleGraphPreviewFailure<T>(
  _client: PoolClient,
  context: GraphContext,
  _auth: AuthUser,
  error: unknown,
  fallback: T
) {
  if (context.connection?.provider_mode === "graph_live" && error instanceof OutlookGraphError) {
    return fallback;
  }
  throw error;
}

async function createGraphDisconnect(client: PoolClient, connection: OutlookConnectionRow, auth: AuthUser) {
  await recordSyncRun(client, {
    tenantId: auth.tenantId,
    connectionId: connection.id,
    actorUserId: auth.id,
    providerMode: "graph_live",
    status: "warning",
    recordsSynced: 0,
    warnings: ["Microsoft Graph connection was intentionally disconnected by leadership."],
    errors: []
  });

  await ensureDisconnectedGraph(client, connection, auth);
}

async function ensureDisconnectedGraph(client: PoolClient, connection: OutlookConnectionRow, auth: AuthUser) {
  await upsertConnection(client, auth.tenantId, {
    connected_by_user_id: auth.id,
    auth_session_id: auth.sessionId,
    provider_mode: "graph_live",
    connection_status: "disconnected",
    health_state: "disconnected",
    connected_account_email: null,
    provider_tenant_id: connection.provider_tenant_id,
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    access_token_expires_at: null,
    scopes: [],
    disconnected_at: new Date().toISOString()
  });
  await setActiveProviderMode(client, auth.tenantId, "graph_live");
}

function filterMessages(messages: OutlookMessage[], filters: OutlookPreviewFilters) {
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

async function loadCalendarSource(
  client: PoolClient,
  auth: AuthUser,
  date: string,
  existingContext?: GraphContext,
  existingProvider?: OutlookProvider | null
) {
  const context = existingContext ?? (await buildContext(client, auth, date));
  const provider = existingProvider ?? getActiveProvider(context);
  if (!provider) {
    return { context, provider: null, calendars: [] as OutlookCalendar[] };
  }

  const rawCalendars = await provider.listCalendars(context);
  const visibilityPreferences = await listCalendarVisibilityPreferences(
    client,
    auth.tenantId,
    auth.id,
    context.activeProviderMode
  );

  return {
    context,
    provider,
    calendars: applyVisibilityPreferences(rawCalendars, visibilityPreferences)
  };
}

function applyVisibilityPreferences(
  calendars: OutlookCalendar[],
  preferences: OutlookCalendarVisibilityPreference[]
) {
  const preferenceMap = new Map(preferences.map((preference) => [preference.calendar_id, preference.visible_in_app]));
  return calendars.map((calendar) => ({
    ...calendar,
    visible_in_app: preferenceMap.has(calendar.id) ? Boolean(preferenceMap.get(calendar.id)) : calendar.visible_in_app
  }));
}

function countEventsByCalendar(events: OutlookEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.calendar_id, (counts.get(event.calendar_id) ?? 0) + 1);
  }
  return counts;
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildMockCalendarCatalog(context: GraphContext): OutlookCalendar[] {
  const overlappingShootCodes = new Set(context.shoots.map((shoot) => shoot.shoot_code));
  return [
    {
      id: "calendar-leadership",
      name: "Leadership Command",
      color_hex: "#436f9f",
      is_primary: true,
      owner_label: "Leadership",
      visible_in_app: true,
      scheduling_impact_enabled: true,
      overlaps_with_shoots: overlappingShootCodes.size > 0,
      upcoming_count: 0
    },
    {
      id: "calendar-schools",
      name: "Schools Portraits",
      color_hex: "#8f6f3d",
      is_primary: false,
      owner_label: "Schools Team",
      visible_in_app: true,
      scheduling_impact_enabled: true,
      overlaps_with_shoots: true,
      upcoming_count: 0
    },
    {
      id: "calendar-sports",
      name: "Sports Coverage",
      color_hex: "#5f7d64",
      is_primary: false,
      owner_label: "Sports Team",
      visible_in_app: true,
      scheduling_impact_enabled: true,
      overlaps_with_shoots: true,
      upcoming_count: 0
    },
    {
      id: "calendar-studio",
      name: "Studio Operations",
      color_hex: "#7b6aa6",
      is_primary: false,
      owner_label: "Studio Floor",
      visible_in_app: true,
      scheduling_impact_enabled: true,
      overlaps_with_shoots: false,
      upcoming_count: 0
    },
    {
      id: "calendar-travel",
      name: "Travel Holds",
      color_hex: "#c68945",
      is_primary: false,
      owner_label: "Operations",
      visible_in_app: false,
      scheduling_impact_enabled: true,
      overlaps_with_shoots: false,
      upcoming_count: 0
    },
    {
      id: "calendar-office",
      name: "Office Coordination",
      color_hex: "#607991",
      is_primary: false,
      owner_label: "Office",
      visible_in_app: false,
      scheduling_impact_enabled: false,
      overlaps_with_shoots: false,
      upcoming_count: 0
    }
  ];
}

function buildMockCalendarEvents(context: GraphContext, filters: OutlookPreviewFilters) {
  const calendars = buildMockCalendarCatalog(context);
  const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const window = buildPreviewWindow(filters.date, filters.window ?? "today");
  const events: OutlookEvent[] = [
    ...context.shoots.map((shoot, index) => {
      const calendar = calendars[index % 2 === 0 ? 1 : 2];
      const startsAt = shoot.arrival_time ?? shoot.start_time ?? buildMockDate(filters.date, index, 8, 0);
      const endsAt = shoot.start_time ?? shoot.end_time_est ?? buildMockDate(filters.date, index, 10, 30);
      return {
        id: `event-shoot-${shoot.id}`,
        calendar_id: calendar.id,
        calendar_name: calendar.name,
        calendar_color_hex: calendar.color_hex,
        subject: `${shoot.shoot_code} | ${shoot.title}`,
        starts_at: startsAt,
        ends_at: endsAt,
        organizer: calendar.owner_label ?? "Mission Control",
        location: shoot.location_name,
        overlaps_with_shoots: true,
        scheduling_impact: true,
        preview_note: `Mock Outlook hold aligned to ${shoot.shoot_code} so leadership can compare calendar visibility against published shoots.`,
        web_link: buildOutlookWebLink(`event-shoot-${shoot.id}`),
        shoot_id: shoot.id,
        shoot_code: shoot.shoot_code
      };
    }),
    {
      id: "event-lead-standup",
      calendar_id: "calendar-leadership",
      calendar_name: "Leadership Command",
      calendar_color_hex: "#436f9f",
      subject: "Leadership staffing standup",
      starts_at: buildMockDate(filters.date, 0, 7, 15),
      ends_at: buildMockDate(filters.date, 0, 7, 45),
      organizer: "Leadership",
      location: "Mission Control room",
      overlaps_with_shoots: false,
      scheduling_impact: true,
      preview_note: "Leadership pulse before the day opens.",
      web_link: buildOutlookWebLink("event-lead-standup"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-studio-load",
      calendar_id: "calendar-studio",
      calendar_name: "Studio Operations",
      calendar_color_hex: "#7b6aa6",
      subject: "Studio load-out and prep block",
      starts_at: buildMockDate(filters.date, 0, 6, 30),
      ends_at: buildMockDate(filters.date, 0, 7, 30),
      organizer: "Studio Floor",
      location: "18336 Minnetonka Boulevard",
      overlaps_with_shoots: false,
      scheduling_impact: true,
      preview_note: "Pre-shoot studio prep segment.",
      web_link: buildOutlookWebLink("event-studio-load"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-travel-buffer",
      calendar_id: "calendar-travel",
      calendar_name: "Travel Holds",
      calendar_color_hex: "#c68945",
      subject: "South metro travel buffer",
      starts_at: buildMockDate(filters.date, 0, 8, 45),
      ends_at: buildMockDate(filters.date, 0, 9, 30),
      organizer: "Operations",
      location: "South route corridor",
      overlaps_with_shoots: false,
      scheduling_impact: true,
      preview_note: "Used to sanity-check calendar pressure before the crew leaves.",
      web_link: buildOutlookWebLink("event-travel-buffer"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-portrait-review",
      calendar_id: "calendar-schools",
      calendar_name: "Schools Portraits",
      calendar_color_hex: "#8f6f3d",
      subject: "Portrait workflow review",
      starts_at: buildMockDate(filters.date, 1, 13, 0),
      ends_at: buildMockDate(filters.date, 1, 13, 45),
      organizer: "Schools Team",
      location: "Production mezzanine",
      overlaps_with_shoots: false,
      scheduling_impact: false,
      preview_note: "Schools follow-up that does not map directly to a shoot.",
      web_link: buildOutlookWebLink("event-portrait-review"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-sports-check",
      calendar_id: "calendar-sports",
      calendar_name: "Sports Coverage",
      calendar_color_hex: "#5f7d64",
      subject: "Sports coach arrival call",
      starts_at: buildMockDate(filters.date, 2, 9, 15),
      ends_at: buildMockDate(filters.date, 2, 9, 45),
      organizer: "Sports Team",
      location: "Coach office",
      overlaps_with_shoots: false,
      scheduling_impact: true,
      preview_note: "Non-shoot coordination hold that still matters to day-of staffing.",
      web_link: buildOutlookWebLink("event-sports-check"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-office-sweep",
      calendar_id: "calendar-office",
      calendar_name: "Office Coordination",
      calendar_color_hex: "#607991",
      subject: "Hours edit approval sweep",
      starts_at: buildMockDate(filters.date, 2, 15, 30),
      ends_at: buildMockDate(filters.date, 2, 16, 0),
      organizer: "Office",
      location: "Admin office",
      overlaps_with_shoots: false,
      scheduling_impact: false,
      preview_note: "Office-only calendar block that can stay hidden in the dashboard view.",
      web_link: buildOutlookWebLink("event-office-sweep"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-studio-return",
      calendar_id: "calendar-studio",
      calendar_name: "Studio Operations",
      calendar_color_hex: "#7b6aa6",
      subject: "Return unload and card ingest",
      starts_at: buildMockDate(filters.date, 3, 17, 0),
      ends_at: buildMockDate(filters.date, 3, 18, 0),
      organizer: "Studio Floor",
      location: "18336 Minnetonka Boulevard",
      overlaps_with_shoots: false,
      scheduling_impact: true,
      preview_note: "Post-shoot operational block in the studio.",
      web_link: buildOutlookWebLink("event-studio-return"),
      shoot_id: null,
      shoot_code: null
    },
    {
      id: "event-travel-return",
      calendar_id: "calendar-travel",
      calendar_name: "Travel Holds",
      calendar_color_hex: "#c68945",
      subject: "North route return window",
      starts_at: buildMockDate(filters.date, 4, 18, 30),
      ends_at: buildMockDate(filters.date, 4, 19, 15),
      organizer: "Operations",
      location: "North route corridor",
      overlaps_with_shoots: false,
      scheduling_impact: true,
      preview_note: "Travel hold used for calendar visibility checks.",
      web_link: buildOutlookWebLink("event-travel-return"),
      shoot_id: null,
      shoot_code: null
    }
  ];

  return events
    .filter((event) => {
      if (filters.calendarId && event.calendar_id !== filters.calendarId) {
        return false;
      }
      if (filters.calendarIds?.length && !filters.calendarIds.includes(event.calendar_id)) {
        return false;
      }
      if (filters.overlapOnly && !event.overlaps_with_shoots) {
        return false;
      }
      const startsAt = new Date(event.starts_at).getTime();
      return startsAt >= window.start.getTime() && startsAt <= window.end.getTime();
    })
    .map((event) => {
      const calendar = calendarById.get(event.calendar_id);
      return {
        ...event,
        calendar_name: calendar?.name ?? event.calendar_name,
        calendar_color_hex: calendar?.color_hex ?? event.calendar_color_hex
      };
    })
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

function buildPreviewWindow(date: string, window: OutlookCalendarWindow) {
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

  return { start, end };
}

function buildMockDate(date: string, dayOffset: number, hour: number, minute: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + dayOffset);
  next.setHours(hour, minute, 0, 0);
  return next.toISOString();
}

function buildOutlookWebLink(id: string) {
  return `https://outlook.office.com/calendar/item/${encodeURIComponent(id)}`;
}
