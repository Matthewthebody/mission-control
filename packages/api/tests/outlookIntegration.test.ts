import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { OUTLOOK_PILOT_SCOPE_STRING } from "../src/config/outlook.js";
import { pool } from "../src/db/pool.js";
import { setActiveProviderMode, upsertConnection } from "../src/services/outlookStore.js";
import { encryptSecret } from "../src/utils/encryptedSecrets.js";
import { elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();
const referenceDate = "2026-03-25";

let leadershipToken = "";
let officeToken = "";
let leadershipUserId = "";
let leadershipTenantId = "";
const originalGraphConfig = {
  tenantId: process.env.OUTLOOK_TENANT_ID ?? "",
  clientId: process.env.OUTLOOK_CLIENT_ID ?? "",
  clientSecret: process.env.OUTLOOK_CLIENT_SECRET ?? "",
  redirectUri: process.env.OUTLOOK_REDIRECT_URI ?? "",
  scopes: process.env.OUTLOOK_SCOPES ?? "",
  adminWebUrl: config.ADMIN_WEB_URL
};

beforeAll(async () => {
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  officeToken = (await passwordLogin(app, "office@example.com")).body.token;
  const membership = await pool.query("SELECT id, tenant_id FROM app_user WHERE lower(email) = lower($1) LIMIT 1", ["leadership@example.com"]);
  leadershipUserId = membership.rows[0].id as string;
  leadershipTenantId = membership.rows[0].tenant_id as string;
});

beforeEach(async () => {
  await clearOutlookState();
  await elevateSession(app, leadershipToken, "LocalDemo123!");
  restoreGraphConfig();
});

afterEach(async () => {
  vi.restoreAllMocks();
  restoreGraphConfig();
  if (leadershipTenantId) {
    await clearOutlookState();
  }
});

describe("outlook calendar integration", () => {
  it("lets leadership load calendar status, visibility, and bounded preview windows", async () => {
    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(connect.status).toBe(200);

    const [status, calendars, todayEvents, weekEvents] = await Promise.all([
      request(app).get(`/api/integrations/outlook/status?date=${referenceDate}`).set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get(`/api/integrations/outlook/calendars?date=${referenceDate}`).set("Authorization", `Bearer ${leadershipToken}`),
      request(app)
        .get(`/api/integrations/outlook/events/preview?date=${referenceDate}&window=today&enabled_only=true`)
        .set("Authorization", `Bearer ${leadershipToken}`),
      request(app)
        .get(`/api/integrations/outlook/events/preview?date=${referenceDate}&window=week&enabled_only=true`)
        .set("Authorization", `Bearer ${leadershipToken}`)
    ]);

    expect(status.status).toBe(200);
    expect(status.body.account.provider_mode).toBe("mock");
    expect(status.body.graph_stub.provider_mode).toBe("graph_stub");
    expect(calendars.status).toBe(200);
    expect(calendars.body.length).toBeGreaterThanOrEqual(5);
    expect(calendars.body.some((calendar: { visible_in_app: boolean }) => calendar.visible_in_app)).toBe(true);
    expect(calendars.body.some((calendar: { visible_in_app: boolean }) => !calendar.visible_in_app)).toBe(true);
    expect(todayEvents.status).toBe(200);
    expect(weekEvents.status).toBe(200);
    expect(todayEvents.body.every((event: { calendar_name: string; calendar_color_hex: string }) => Boolean(event.calendar_name && event.calendar_color_hex))).toBe(true);
    expect(weekEvents.body.length).toBeGreaterThan(todayEvents.body.length);
  });

  it("persists calendar visibility preferences and filters preview events to only active calendars", async () => {
    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(connect.status).toBe(200);

    const calendars = await request(app)
      .get(`/api/integrations/outlook/calendars?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(calendars.status).toBe(200);
    const visibleCalendar = calendars.body.find((calendar: { visible_in_app: boolean }) => calendar.visible_in_app);
    expect(visibleCalendar).toBeTruthy();

    const hidden = await request(app)
      .patch(`/api/integrations/outlook/calendars/${encodeURIComponent(visibleCalendar.id)}/visibility?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ visible_in_app: false });
    expect(hidden.status).toBe(200);
    expect(hidden.body.find((calendar: { id: string }) => calendar.id === visibleCalendar.id)?.visible_in_app).toBe(false);

    const eventsAfterHide = await request(app)
      .get(`/api/integrations/outlook/events/preview?date=${referenceDate}&window=week&enabled_only=true`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(eventsAfterHide.status).toBe(200);
    expect(eventsAfterHide.body.some((event: { calendar_id: string }) => event.calendar_id === visibleCalendar.id)).toBe(false);

    const visibleAgain = await request(app)
      .patch(`/api/integrations/outlook/calendars/${encodeURIComponent(visibleCalendar.id)}/visibility?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ visible_in_app: true });
    expect(visibleAgain.status).toBe(200);
    expect(visibleAgain.body.find((calendar: { id: string }) => calendar.id === visibleCalendar.id)?.visible_in_app).toBe(true);
  });

  it("does not silently create mock Outlook state during disconnected status reads", async () => {
    disableGraphConfig();

    const status = await request(app)
      .get(`/api/integrations/outlook/status?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(status.status).toBe(200);
    expect(status.body.account.provider_mode).toBe("mock");
    expect(status.body.account.connection_status).toBe("disconnected");

    const connectionCount = await pool.query(
      "SELECT count(*)::int AS count FROM outlook_connection WHERE tenant_id = $1",
      [leadershipTenantId]
    );
    const tenantStateCount = await pool.query(
      "SELECT count(*)::int AS count FROM outlook_tenant_state WHERE tenant_id = $1",
      [leadershipTenantId]
    );

    expect(Number(connectionCount.rows[0].count)).toBe(0);
    expect(Number(tenantStateCount.rows[0].count)).toBe(0);
  });

  it("keeps the live Graph connection isolated when leadership switches to mock preview", async () => {
    enableGraphConfig();

    const client = await pool.connect();
    try {
      await upsertConnection(client, leadershipTenantId, {
        connected_by_user_id: leadershipUserId,
        provider_mode: "graph_live",
        connection_status: "connected",
        health_state: "connected_pending_sync",
        connected_account_email: "leader@contoso.com",
        warning_count: 0,
        error_count: 0
      });
      await setActiveProviderMode(client, leadershipTenantId, "graph_live");
    } finally {
      client.release();
    }

    const connectMock = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(connectMock.status).toBe(200);
    expect(connectMock.body.account.provider_mode).toBe("mock");
    expect(connectMock.body.account.connection_status).toBe("connected");
    expect(connectMock.body.account.connected_as).toBeNull();

    const connectionRows = await pool.query(
      `
        SELECT provider_mode::text AS provider_mode, connection_status::text AS connection_status, connected_account_email
        FROM outlook_connection
        WHERE tenant_id = $1
        ORDER BY provider_mode ASC
      `,
      [leadershipTenantId]
    );
    expect(connectionRows.rows).toEqual([
      {
        provider_mode: "graph_live",
        connection_status: "connected",
        connected_account_email: "leader@contoso.com"
      },
      {
        provider_mode: "mock",
        connection_status: "connected",
        connected_account_email: null
      }
    ]);

    const activeProvider = await pool.query(
      "SELECT active_provider_mode::text AS active_provider_mode FROM outlook_tenant_state WHERE tenant_id = $1",
      [leadershipTenantId]
    );
    expect(activeProvider.rows[0]?.active_provider_mode).toBe("mock");
  });

  it("keeps mock preview isolated when the live delegated callback succeeds", async () => {
    enableGraphConfig();

    const connectMock = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(connectMock.status).toBe(200);

    const connectGraph = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}&provider=graph`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const state = new URL(connectGraph.body.authorization_url as string).searchParams.get("state");
    expect(state).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/oauth2/v2.0/token")) {
          const body = readSearchParams(init?.body);
          expect(body.get("code_verifier")).toBeTruthy();
          return buildJsonResponse({
            access_token: "graph-access-token",
            refresh_token: "graph-refresh-token",
            expires_in: 3600,
            scope: OUTLOOK_PILOT_SCOPE_STRING
          });
        }
        if (url.includes("/me?$select=mail,userPrincipalName")) {
          return buildJsonResponse({
            mail: "leader@contoso.com",
            userPrincipalName: "leader@contoso.com"
          });
        }
        throw new Error(`Unexpected Graph fetch: ${url}`);
      })
    );

    const callback = await request(app).get(`/api/integrations/outlook/oauth/callback?state=${encodeURIComponent(state ?? "")}&code=graph-code`);
    expect(callback.status).toBe(302);

    const connectionRows = await pool.query(
      `
        SELECT provider_mode::text AS provider_mode, connection_status::text AS connection_status, connected_account_email
        FROM outlook_connection
        WHERE tenant_id = $1
        ORDER BY provider_mode ASC
      `,
      [leadershipTenantId]
    );
    expect(connectionRows.rows).toEqual([
      {
        provider_mode: "graph_live",
        connection_status: "connected",
        connected_account_email: "leader@contoso.com"
      },
      {
        provider_mode: "mock",
        connection_status: "connected",
        connected_account_email: null
      }
    ]);

    const status = await request(app)
      .get(`/api/integrations/outlook/status?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(status.status).toBe(200);
    expect(status.body.account.provider_mode).toBe("graph_live");
    expect(status.body.account.connected_as).toBe("leader@contoso.com");
  });

  it("resets only the targeted Outlook provider state and leaves the other path intact", async () => {
    enableGraphConfig();

    const connectMock = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(connectMock.status).toBe(200);

    const client = await pool.connect();
    try {
      await upsertConnection(client, leadershipTenantId, {
        connected_by_user_id: leadershipUserId,
        provider_mode: "graph_live",
        connection_status: "connected",
        health_state: "connected_pending_sync",
        connected_account_email: "leader@contoso.com",
        warning_count: 0,
        error_count: 0
      });
    } finally {
      client.release();
    }

    const resetMock = await request(app)
      .post(`/api/integrations/outlook/reset?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ scope: "mock_preview" });

    expect(resetMock.status).toBe(200);
    expect(resetMock.body.account.provider_mode).toBe("mock");
    expect(resetMock.body.account.connection_status).toBe("disconnected");

    const remainingRows = await pool.query(
      `
        SELECT provider_mode::text AS provider_mode, connection_status::text AS connection_status
        FROM outlook_connection
        WHERE tenant_id = $1
        ORDER BY provider_mode ASC
      `,
      [leadershipTenantId]
    );
    expect(remainingRows.rows).toEqual([
      {
        provider_mode: "graph_live",
        connection_status: "connected"
      }
    ]);

    const liveStatus = await request(app)
      .post(`/api/integrations/outlook/reset?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ scope: "graph_live_connection" });

    expect(liveStatus.status).toBe(200);
    expect(liveStatus.body.account.provider_mode).toBe("graph_live");
    expect(liveStatus.body.account.connection_status).toBe("disconnected");

    const finalRows = await pool.query("SELECT count(*)::int AS count FROM outlook_connection WHERE tenant_id = $1", [leadershipTenantId]);
    expect(Number(finalRows.rows[0].count)).toBe(0);
  });

  it("blocks lower-privilege users from the leadership-only module routes", async () => {
    const response = await request(app)
      .get(`/api/integrations/outlook/status?date=${referenceDate}`)
      .set("Authorization", `Bearer ${officeToken}`);

    expect(response.status).toBe(403);
  });

  it("audits connect, visibility updates, sync, and disconnect actions", async () => {
    const beforeCount = Number(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE action IN ('outlook.integration.connected','outlook.calendar.visibility_updated','outlook.integration.sync_requested','outlook.integration.disconnected')"
        )
      ).rows[0].count
    );

    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const calendarId = connect.body.sync_runs?.length ? "calendar-leadership" : "calendar-schools";
    const visibility = await request(app)
      .patch(`/api/integrations/outlook/calendars/${calendarId}/visibility?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ visible_in_app: false });
    const sync = await request(app)
      .post(`/api/integrations/outlook/sync?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const disconnect = await request(app)
      .post(`/api/integrations/outlook/disconnect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    const afterCount = Number(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE action IN ('outlook.integration.connected','outlook.calendar.visibility_updated','outlook.integration.sync_requested','outlook.integration.disconnected')"
        )
      ).rows[0].count
    );

    expect(connect.status).toBe(200);
    expect(visibility.status).toBe(200);
    expect(sync.status).toBe(200);
    expect(sync.body.sync_run).toMatchObject({
      source_object: {
        type: "outlook_mock_workspace"
      },
      target_object: {
        type: "mission_control_outlook_status",
        id: "mock"
      },
      last_attempted_sync_at: expect.any(String),
      retry_state: "none"
    });
    expect(disconnect.status).toBe(200);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 4);
  });

  it("returns a Microsoft OAuth redirect when Graph is configured and persists callback state securely", async () => {
    enableGraphConfig();

    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}&provider=graph`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(connect.status).toBe(200);
    expect(connect.body.connect_mode).toBe("oauth_redirect");
    expect(typeof connect.body.authorization_url).toBe("string");

    const authorizationUrl = new URL(connect.body.authorization_url as string);
    const returnedState = authorizationUrl.searchParams.get("state");
    expect(returnedState).toBeTruthy();
    expect(authorizationUrl.searchParams.get("redirect_uri")).toContain("/api/integrations/outlook/oauth/callback");
    expect(authorizationUrl.searchParams.get("scope")).toBe(OUTLOOK_PILOT_SCOPE_STRING);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();

    const oauthStateRows = await pool.query(
      "SELECT state_hash, auth_session_id, tenant_id FROM outlook_oauth_state WHERE tenant_id = $1 AND consumed_at IS NULL",
      [leadershipTenantId]
    );
    expect(oauthStateRows.rows).toHaveLength(1);
    expect(oauthStateRows.rows[0].state_hash).not.toBe(returnedState);
  });

  it("fails cleanly when leadership requests the Graph pilot without delegated Outlook config", async () => {
    disableGraphConfig();

    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}&provider=graph`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(connect.status).toBe(400);
    expect(connect.body.error).toContain("Microsoft Outlook delegated pilot is not configured");
  });

  it("reports configured but disconnected Outlook honestly in governance", async () => {
    enableGraphConfig();

    const governance = await request(app)
      .get("/api/integrations/governance")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(governance.status).toBe(200);
    const outlookProvider = governance.body.providers.find((provider: { provider: string }) => provider.provider === "outlook");
    expect(outlookProvider).toMatchObject({
      provider: "outlook",
      connection_status: "disconnected",
      health_label: "Disconnected",
      external_label: "Microsoft 365 ready to connect",
      sync_mode: "read_only_import",
      sync_mode_label: "Read-Only Delegated Preview",
      writeback_domains: []
    });
    expect(String(outlookProvider.mapping_status)).toMatch(/delegated preview is configured/i);
  });

  it("labels the mock preview honestly in governance", async () => {
    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(connect.status).toBe(200);

    const governance = await request(app)
      .get("/api/integrations/governance")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(governance.status).toBe(200);
    const outlookProvider = governance.body.providers.find((provider: { provider: string }) => provider.provider === "outlook");
    expect(outlookProvider).toMatchObject({
      provider: "outlook",
      connection_status: "connected",
      health_label: "Mock Preview",
      external_label: "Mock calendar preview active",
      sync_mode: "read_only_import",
      sync_mode_label: "Read-Only Delegated Preview",
      writeback_domains: []
    });
    expect(String(outlookProvider.mapping_status)).toMatch(/mock preview is active/i);
  });

  it("persists a real Graph calendar connection and serves read-only calendar data after callback", async () => {
    enableGraphConfig();

    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}&provider=graph`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const state = new URL(connect.body.authorization_url as string).searchParams.get("state");
    expect(state).toBeTruthy();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        const body = readSearchParams(init?.body);
        expect(body.get("code_verifier")).toBeTruthy();
        return buildJsonResponse({
          access_token: "graph-access-token",
          refresh_token: "graph-refresh-token",
          expires_in: 3600,
          scope: OUTLOOK_PILOT_SCOPE_STRING
        });
      }
      if (url.includes("/me?$select=mail,userPrincipalName")) {
        return buildJsonResponse({
          mail: "leader@contoso.com",
          userPrincipalName: "leader@contoso.com"
        });
      }
      if (url.includes("/graph-cal-1/calendarView")) {
        return buildJsonResponse({
          value: [
            {
              id: "graph-event-1",
              subject: "DEMO-001 staffing check",
              start: { dateTime: `${referenceDate}T14:00:00.000Z` },
              end: { dateTime: `${referenceDate}T15:00:00.000Z` },
              organizer: { emailAddress: { name: "Leadership" } },
              location: { displayName: "Main Gym" },
              webLink: "https://outlook.office.com/calendar/item/graph-event-1"
            }
          ]
        });
      }
      if (url.includes("/graph-cal-2/calendarView")) {
        return buildJsonResponse({
          value: [
            {
              id: "graph-event-2",
              subject: "Portrait prep block",
              start: { dateTime: `${referenceDate}T16:00:00.000Z` },
              end: { dateTime: `${referenceDate}T16:30:00.000Z` },
              organizer: { emailAddress: { name: "Schools Team" } },
              location: { displayName: "Studio" },
              webLink: "https://outlook.office.com/calendar/item/graph-event-2"
            }
          ]
        });
      }
      if (url.includes("/me/calendars")) {
        return buildJsonResponse({
          value: [
            { id: "graph-cal-1", name: "Leadership", color: "lightBlue", isDefaultCalendar: true, owner: { name: "Leader" } },
            { id: "graph-cal-2", name: "Schools Portraits", color: "lightGreen", isDefaultCalendar: false, owner: { name: "Schools Team" } }
          ]
        });
      }
      throw new Error(`Unexpected Graph fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const callback = await request(app).get(`/api/integrations/outlook/oauth/callback?state=${encodeURIComponent(state ?? "")}&code=graph-code`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain("#outlook?outlook_notice=connected");

    const connectionRow = await pool.query(
      "SELECT provider_mode::text AS provider_mode, connection_status::text AS connection_status, connected_account_email, encrypted_access_token, encrypted_refresh_token FROM outlook_connection WHERE tenant_id = $1",
      [leadershipTenantId]
    );
    expect(connectionRow.rows[0].provider_mode).toBe("graph_live");
    expect(connectionRow.rows[0].connection_status).toBe("connected");
    expect(connectionRow.rows[0].connected_account_email).toBe("leader@contoso.com");
    expect(connectionRow.rows[0].encrypted_access_token).not.toContain("graph-access-token");
    expect(connectionRow.rows[0].encrypted_refresh_token).not.toContain("graph-refresh-token");

    const [status, calendars, events] = await Promise.all([
      request(app).get(`/api/integrations/outlook/status?date=${referenceDate}`).set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get(`/api/integrations/outlook/calendars?date=${referenceDate}`).set("Authorization", `Bearer ${leadershipToken}`),
      request(app)
        .get(`/api/integrations/outlook/events/preview?date=${referenceDate}&window=today&enabled_only=true`)
        .set("Authorization", `Bearer ${leadershipToken}`)
    ]);

    expect(status.body.account.provider_mode).toBe("graph_live");
    expect(status.body.account.connected_as).toBe("leader@contoso.com");
    expect(calendars.body[0]).toMatchObject({ id: "graph-cal-1", is_primary: true, owner_label: "Leader" });
    expect(events.body[0]).toMatchObject({
      id: "graph-event-1",
      subject: "DEMO-001 staffing check",
      calendar_id: "graph-cal-1",
      calendar_name: "Leadership"
    });

    const sync = await request(app)
      .post(`/api/integrations/outlook/sync?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(sync.status).toBe(200);
    expect(sync.body.sync_run).toMatchObject({
      provider_mode: "graph_live",
      status: "success",
      source_object: {
        type: "outlook_connection"
      },
      target_object: {
        type: "mission_control_outlook_status",
        id: "graph_live",
        owner_email: "leader@contoso.com"
      },
      last_attempted_sync_at: expect.any(String),
      last_successful_sync_at: expect.any(String),
      retry_state: "none"
    });

    const statusAfterSync = await request(app)
      .get(`/api/integrations/outlook/status?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(statusAfterSync.body.account.last_sync_at).toBeTruthy();
    expect(statusAfterSync.body.account.health_state).toBe("connected_healthy");
  });

  it("keeps read-only calendar previews pure when Graph tokens are expired and refresh is unavailable", async () => {
    enableGraphConfig();

    await pool.query(
      `
        INSERT INTO outlook_connection (
          tenant_id,
          connected_by_user_id,
          auth_session_id,
          provider_mode,
          connection_status,
          health_state,
          connected_account_email,
          encrypted_access_token,
          encrypted_refresh_token,
          access_token_expires_at,
          scopes,
          records_synced,
          warning_count,
          error_count
        )
        SELECT
          $1,
          $2,
          s.id,
          'graph_live',
          'connected',
          'connected_pending_sync',
          'leader@contoso.com',
          $3,
          NULL,
          now() - interval '5 minutes',
          ARRAY['Calendars.Read'],
          0,
          0,
          0
        FROM auth_session s
        JOIN app_user u ON u.id = s.user_id
        WHERE u.id = $2
        ORDER BY s.created_at DESC
        LIMIT 1
      `,
      [leadershipTenantId, leadershipUserId, encryptSecret("expired-token", leadershipTenantId)]
    );

    const calendars = await request(app)
      .get(`/api/integrations/outlook/calendars?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(calendars.status).toBe(200);
    expect(calendars.body).toEqual([]);

    const status = await request(app)
      .get(`/api/integrations/outlook/status?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(status.status).toBe(200);
    expect(status.body.account.connection_status).toBe("connected");
    expect(status.body.account.health_state).toBe("connected_pending_sync");
    expect(status.body.account.error_count).toBe(0);
  });

  it("does not refresh or mutate state during read-only preview when a refresh token exists", async () => {
    enableGraphConfig();

    await pool.query(
      `
        INSERT INTO outlook_connection (
          tenant_id,
          connected_by_user_id,
          auth_session_id,
          provider_mode,
          connection_status,
          health_state,
          connected_account_email,
          encrypted_access_token,
          encrypted_refresh_token,
          access_token_expires_at,
          scopes,
          records_synced,
          warning_count,
          error_count
        )
        SELECT
          $1,
          $2,
          s.id,
          'graph_live',
          'connected',
          'connected_pending_sync',
          'leader@contoso.com',
          $3,
          $4,
          now() - interval '5 minutes',
          ARRAY['Calendars.Read'],
          0,
          0,
          0
        FROM auth_session s
        JOIN app_user u ON u.id = s.user_id
        WHERE u.id = $2
        ORDER BY s.created_at DESC
        LIMIT 1
      `,
      [
        leadershipTenantId,
        leadershipUserId,
        encryptSecret("expired-token", leadershipTenantId),
        encryptSecret("refresh-token", leadershipTenantId)
      ]
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const calendars = await request(app)
      .get(`/api/integrations/outlook/calendars?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(calendars.status).toBe(200);
    expect(calendars.body).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    const connection = await pool.query(
      "SELECT encrypted_access_token, access_token_expires_at, error_count FROM outlook_connection WHERE tenant_id = $1 AND provider_mode = 'graph_live'",
      [leadershipTenantId]
    );
    expect(connection.rows[0]?.error_count).toBe(0);
    expect(connection.rows[0]?.encrypted_access_token).toBeTruthy();
  });

  it("refreshes delegated tokens during explicit sync and records refresh telemetry", async () => {
    enableGraphConfig();

    await pool.query(
      `
        INSERT INTO outlook_connection (
          tenant_id,
          connected_by_user_id,
          auth_session_id,
          provider_mode,
          connection_status,
          health_state,
          connected_account_email,
          encrypted_access_token,
          encrypted_refresh_token,
          access_token_expires_at,
          scopes,
          records_synced,
          warning_count,
          error_count
        )
        SELECT
          $1,
          $2,
          s.id,
          'graph_live',
          'connected',
          'connected_pending_sync',
          'leader@contoso.com',
          $3,
          $4,
          now() - interval '5 minutes',
          ARRAY['Calendars.Read'],
          0,
          0,
          0
        FROM auth_session s
        JOIN app_user u ON u.id = s.user_id
        WHERE u.id = $2
        ORDER BY s.created_at DESC
        LIMIT 1
      `,
      [
        leadershipTenantId,
        leadershipUserId,
        encryptSecret("expired-token", leadershipTenantId),
        encryptSecret("refresh-token", leadershipTenantId)
      ]
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        return buildJsonResponse({
          access_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          expires_in: 3600,
          scope: OUTLOOK_PILOT_SCOPE_STRING
        });
      }
      if (url.includes("/me/calendars")) {
        return buildJsonResponse({
          value: [{ id: "graph-cal-1", name: "Leadership", color: "lightBlue", isDefaultCalendar: true, owner: { name: "Leader" } }]
        });
      }
      if (url.includes("/graph-cal-1/calendarView")) {
        return buildJsonResponse({
          value: [
            {
              id: "graph-event-1",
              subject: "DEMO-001 staffing check",
              start: { dateTime: `${referenceDate}T14:00:00.000Z` },
              end: { dateTime: `${referenceDate}T15:00:00.000Z` },
              organizer: { emailAddress: { name: "Leadership" } },
              location: { displayName: "Main Gym" },
              webLink: "https://outlook.office.com/calendar/item/graph-event-1"
            }
          ]
        });
      }
      throw new Error(`Unexpected Graph fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sync = await request(app)
      .post(`/api/integrations/outlook/sync?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(sync.status).toBe(200);
    expect(sync.body.sync_run.status).toBe("success");

    const connection = await pool.query(
      "SELECT encrypted_access_token, encrypted_refresh_token, access_token_expires_at FROM outlook_connection WHERE tenant_id = $1 AND provider_mode = 'graph_live'",
      [leadershipTenantId]
    );
    expect(connection.rows[0]?.encrypted_access_token).not.toContain("fresh-access-token");
    expect(connection.rows[0]?.encrypted_refresh_token).not.toContain("fresh-refresh-token");
    expect(connection.rows[0]?.access_token_expires_at).toBeTruthy();

    const telemetry = await pool.query(
      "SELECT event_type FROM microsoft_integration_event WHERE tenant_id = $1 AND integration_area = 'outlook_calendar_sync'::microsoft_integration_area ORDER BY occurred_at DESC",
      [leadershipTenantId]
    );
    expect(telemetry.rows.map((row) => row.event_type)).toContain("outlook.oauth.token_refreshed");
  });

  it("fails safely when Microsoft Graph returns a malformed calendar payload", async () => {
    enableGraphConfig();

    const client = await pool.connect();
    try {
      await upsertConnection(client, leadershipTenantId, {
        connected_by_user_id: leadershipUserId,
        provider_mode: "graph_live",
        connection_status: "connected",
        health_state: "connected_pending_sync",
        connected_account_email: "leader@contoso.com",
        encrypted_access_token: encryptSecret("graph-access-token", leadershipTenantId),
        encrypted_refresh_token: encryptSecret("graph-refresh-token", leadershipTenantId),
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        warning_count: 0,
        error_count: 0
      });
      await setActiveProviderMode(client, leadershipTenantId, "graph_live");
    } finally {
      client.release();
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/me/calendars")) {
          return buildJsonResponse({ value: [{ id: "", name: "Broken Calendar" }] });
        }
        throw new Error(`Unexpected Graph fetch: ${url}`);
      })
    );

    const calendars = await request(app)
      .get(`/api/integrations/outlook/calendars?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(calendars.status).toBe(200);
    expect(calendars.body).toEqual([]);

    const status = await request(app)
      .get(`/api/integrations/outlook/status?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(status.status).toBe(200);
    expect(status.body.account.connection_status).toBe("connected");
    expect(status.body.account.error_count).toBe(0);
  });

  it("degrades to a warning sync when one calendar batch fails but another succeeds", async () => {
    enableGraphConfig();

    const client = await pool.connect();
    try {
      await upsertConnection(client, leadershipTenantId, {
        connected_by_user_id: leadershipUserId,
        provider_mode: "graph_live",
        connection_status: "connected",
        health_state: "connected_pending_sync",
        connected_account_email: "leader@contoso.com",
        encrypted_access_token: encryptSecret("graph-access-token", leadershipTenantId),
        encrypted_refresh_token: encryptSecret("graph-refresh-token", leadershipTenantId),
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        warning_count: 0,
        error_count: 0
      });
      await setActiveProviderMode(client, leadershipTenantId, "graph_live");
    } finally {
      client.release();
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/graph-cal-1/calendarView")) {
          return buildJsonResponse({
            value: [
              {
                id: "graph-event-1",
                subject: "DEMO-001 staffing check",
                start: { dateTime: `${referenceDate}T14:00:00.000Z` },
                end: { dateTime: `${referenceDate}T15:00:00.000Z` },
                organizer: { emailAddress: { name: "Leadership" } },
                location: { displayName: "Main Gym" },
                webLink: "https://outlook.office.com/calendar/item/graph-event-1"
              }
            ]
          });
        }
        if (url.includes("/graph-cal-2/calendarView")) {
          return buildJsonResponse(
            {
              error: {
                code: "TooManyRequests",
                message: "Retry later."
              }
            },
            429,
            { "Retry-After": "30" }
          );
        }
        if (url.includes("/me/calendars")) {
          return buildJsonResponse({
            value: [
              { id: "graph-cal-1", name: "Leadership", color: "lightBlue", isDefaultCalendar: true, owner: { name: "Leader" } },
              { id: "graph-cal-2", name: "Broken", color: "lightGreen", isDefaultCalendar: false, owner: { name: "Broken" } }
            ]
          });
        }
        throw new Error(`Unexpected Graph fetch: ${url}`);
      })
    );

    const sync = await request(app)
      .post(`/api/integrations/outlook/sync?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(sync.status).toBe(200);
    expect(sync.body.sync_run.status).toBe("warning");
    expect(sync.body.sync_run.records_synced).toBeGreaterThan(0);
    expect(sync.body.sync_run.warnings.some((warning: string) => warning.includes("Calendar preview degraded for Broken"))).toBe(true);
  });

  it("queues Outlook replay operations for a selected date range", async () => {
    await pool.query(
      `
        INSERT INTO integration_sync_operation (
          tenant_id,
          provider,
          direction,
          entity_type,
          entity_id,
          external_object_type,
          external_id,
          operation_type,
          source_system,
          source_change_key,
          status,
          payload,
          created_at,
          updated_at
        )
        VALUES
          ($1, 'outlook', 'outbound', 'schedule_item', '11111111-1111-4111-8111-111111111111', 'event', 'evt-1', 'upsert', 'mission_control', 'change-1', 'failed', '{}'::jsonb, '2026-03-24T10:00:00.000Z', '2026-03-24T10:00:00.000Z'),
          ($1, 'outlook', 'outbound', 'schedule_item', '22222222-2222-4222-8222-222222222222', 'event', 'evt-2', 'upsert', 'mission_control', 'change-2', 'conflict', '{}'::jsonb, '2026-03-25T10:00:00.000Z', '2026-03-25T10:00:00.000Z'),
          ($1, 'outlook', 'outbound', 'schedule_item', '33333333-3333-4333-8333-333333333333', 'event', 'evt-3', 'upsert', 'mission_control', 'change-3', 'failed', '{}'::jsonb, '2026-03-28T10:00:00.000Z', '2026-03-28T10:00:00.000Z')
      `,
      [leadershipTenantId]
    );

    const replay = await request(app)
      .post("/api/integrations/outlook/replay")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        date_from: "2026-03-24",
        date_to: "2026-03-25",
        statuses: ["failed", "conflict"]
      });

    expect(replay.status).toBe(202);
    expect(replay.body.replay_scope).toBe("date_range");
    expect(replay.body.queued_count).toBe(2);

    const replayRows = await pool.query(
      "SELECT replay_of_operation_id FROM integration_sync_operation WHERE tenant_id = $1 AND provider = 'outlook' AND replay_of_operation_id IS NOT NULL ORDER BY created_at ASC",
      [leadershipTenantId]
    );
    expect(replayRows.rows).toHaveLength(2);
  });

  it("returns a read-only reconciliation report against the canonical shoot board", async () => {
    const connect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${referenceDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(connect.status).toBe(200);

    const [beforeSyncRuns, beforeConnections] = await Promise.all([
      pool.query("SELECT count(*)::int AS count FROM outlook_sync_run WHERE tenant_id = $1", [leadershipTenantId]),
      pool.query("SELECT count(*)::int AS count FROM outlook_connection WHERE tenant_id = $1", [leadershipTenantId])
    ]);

    const reconciliation = await request(app)
      .get(`/api/integrations/outlook/reconciliation?date=${referenceDate}&window=week`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    const [afterSyncRuns, afterConnections] = await Promise.all([
      pool.query("SELECT count(*)::int AS count FROM outlook_sync_run WHERE tenant_id = $1", [leadershipTenantId]),
      pool.query("SELECT count(*)::int AS count FROM outlook_connection WHERE tenant_id = $1", [leadershipTenantId])
    ]);

    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body.provider_mode).toBe("mock");
    expect(reconciliation.body.connection_status).toBe("connected");
    expect(reconciliation.body.window).toBe("week");
    expect(reconciliation.body.outlook_event_count).toBeGreaterThan(0);
    expect(reconciliation.body.matched_overlap_count).toBeLessThanOrEqual(reconciliation.body.system_shoot_count);
    expect(reconciliation.body.missing_in_outlook.length + reconciliation.body.matched_overlap_count).toBe(
      reconciliation.body.system_shoot_count
    );
    expect(Array.isArray(reconciliation.body.missing_in_outlook)).toBe(true);
    expect(Array.isArray(reconciliation.body.outlook_only)).toBe(true);
    expect(Number(afterSyncRuns.rows[0]?.count ?? 0)).toBe(Number(beforeSyncRuns.rows[0]?.count ?? 0));
    expect(Number(afterConnections.rows[0]?.count ?? 0)).toBe(Number(beforeConnections.rows[0]?.count ?? 0));
  });
});

function enableGraphConfig() {
  process.env.OUTLOOK_TENANT_ID = "graph-tenant-id";
  process.env.OUTLOOK_CLIENT_ID = "graph-client-id";
  process.env.OUTLOOK_CLIENT_SECRET = "graph-client-secret";
  process.env.OUTLOOK_REDIRECT_URI = "http://localhost:4000/api/integrations/outlook/oauth/callback";
  process.env.OUTLOOK_SCOPES = OUTLOOK_PILOT_SCOPE_STRING;
  config.ADMIN_WEB_URL = "http://localhost:5173";
}

function restoreGraphConfig() {
  process.env.OUTLOOK_TENANT_ID = originalGraphConfig.tenantId;
  process.env.OUTLOOK_CLIENT_ID = originalGraphConfig.clientId;
  process.env.OUTLOOK_CLIENT_SECRET = originalGraphConfig.clientSecret;
  process.env.OUTLOOK_REDIRECT_URI = originalGraphConfig.redirectUri;
  process.env.OUTLOOK_SCOPES = originalGraphConfig.scopes;
  config.ADMIN_WEB_URL = originalGraphConfig.adminWebUrl;
}

function disableGraphConfig() {
  process.env.OUTLOOK_TENANT_ID = "";
  process.env.OUTLOOK_CLIENT_ID = "";
  process.env.OUTLOOK_CLIENT_SECRET = "";
  process.env.OUTLOOK_REDIRECT_URI = "";
  process.env.OUTLOOK_SCOPES = "";
}

async function clearOutlookState() {
  if (!leadershipTenantId) {
    return;
  }

  await pool.query("DELETE FROM integration_sync_operation WHERE tenant_id = $1 AND provider = 'outlook'", [leadershipTenantId]);
  await pool.query(
    "DELETE FROM microsoft_integration_event WHERE tenant_id = $1 AND integration_area = 'outlook_calendar_sync'::microsoft_integration_area",
    [leadershipTenantId]
  );
  await pool.query("DELETE FROM outlook_calendar_visibility_preference WHERE tenant_id = $1", [leadershipTenantId]);
  await pool.query("DELETE FROM outlook_oauth_state WHERE tenant_id = $1", [leadershipTenantId]);
  await pool.query("DELETE FROM outlook_sync_run WHERE tenant_id = $1", [leadershipTenantId]);
  await pool.query("DELETE FROM outlook_connection WHERE tenant_id = $1", [leadershipTenantId]);
  await pool.query("DELETE FROM outlook_tenant_state WHERE tenant_id = $1", [leadershipTenantId]);
}

function buildJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async json() {
      return body;
    }
  } as Response;
}

function readSearchParams(body: BodyInit | null | undefined) {
  if (body instanceof URLSearchParams) {
    return body;
  }
  return new URLSearchParams(String(body ?? ""));
}
