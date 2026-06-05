import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { OUTLOOK_PILOT_SCOPE_STRING } from "../src/config/outlook.js";
import { pool } from "../src/db/pool.js";
import { setActiveProviderMode, upsertConnection } from "../src/services/outlookStore.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const outlookOauthEnvKeys = [
  "OUTLOOK_TENANT_ID",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "OUTLOOK_REDIRECT_URI",
  "OUTLOOK_SCOPES"
] as const;
const originalOutlookOauthEnv = Object.fromEntries(
  outlookOauthEnvKeys.map((key) => [key, process.env[key]])
) as Record<(typeof outlookOauthEnvKeys)[number], string | undefined>;

let leadershipToken = "";
let tenantId = "";

function configureOutlookOauthEnvForTest() {
  process.env.OUTLOOK_TENANT_ID = "tenant";
  process.env.OUTLOOK_CLIENT_ID = "client";
  process.env.OUTLOOK_CLIENT_SECRET = "secret";
  process.env.OUTLOOK_REDIRECT_URI = "http://localhost:4000/api/integrations/outlook/oauth/callback";
  process.env.OUTLOOK_SCOPES = OUTLOOK_PILOT_SCOPE_STRING;
}

function restoreOutlookOauthEnv() {
  for (const key of outlookOauthEnvKeys) {
    const value = originalOutlookOauthEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function enableOutlookSyncForTest() {
  configureOutlookOauthEnvForTest();
  Object.assign(config, {
    MICROSOFT_OUTLOOK_SYNC_ENABLED: true,
    OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: false,
    OUTLOOK_TOKEN_ENCRYPTION_SECRET: "phase1-local-secret"
  });
}

beforeAll(async () => {
  const migrationSql = await readFile(
    resolve(process.cwd(), "../../db/migrations/112_microsoft_integration_observability_phase6.sql"),
    "utf8"
  );
  try {
    await pool.query(migrationSql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists")) {
      throw error;
    }
  }

  leadershipToken = String((await devLogin(app, "leadership@example.com")).body.token);
  const tenantRow = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id::text FROM app_user WHERE lower(email) = lower($1) LIMIT 1",
    ["leadership@example.com"]
  );
  tenantId = tenantRow.rows[0]?.tenant_id ?? "";
});

beforeEach(async () => {
  configureOutlookOauthEnvForTest();
  config.MICROSOFT_ENTRA_AUTH_ENABLED = false;
  config.MICROSOFT_OUTLOOK_SYNC_ENABLED = false;
  config.TEAMS_OPERATIONAL_ALERTS_ENABLED = false;
  config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED = false;
  config.MICROSOFT_TEAMS_PERSONAL_APP_ENABLED = false;
  config.MICROSOFT_TEAMS_BOT_APP_ID = "";
  config.MICROSOFT_TEAMS_BOT_APP_PASSWORD = "";
  config.MICROSOFT_TEAMS_DEV_BYPASS_AUTH = true;
  config.MICROSOFT_GRAPH_CLIENT_ID = "";
  config.MICROSOFT_GRAPH_CLIENT_SECRET = "";
  config.MICROSOFT_GRAPH_TENANT_ID = "";
  config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE = "";
  config.MICROSOFT_ENTRA_REDIRECT_URI = "";
  config.MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI = "";
  config.WEBHOOK_SHARED_SECRET = "";
  config.ADMIN_WEB_URL = "http://localhost:5173";
  config.API_PUBLIC_URL = "http://localhost:4000";
  config.OUTLOOK_GRAPH_TIMEOUT_MS = 5000;

  await pool.query("DELETE FROM microsoft_integration_event WHERE tenant_id = $1 OR tenant_id IS NULL", [tenantId]);
  await pool.query("DELETE FROM integration_sync_operation WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM microsoft_mail_automation_delivery WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM operational_alert_delivery WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM microsoft_client_intake_submission WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM microsoft_sms_delivery WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM microsoft_sms_consent WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM outlook_connection WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM outlook_tenant_state WHERE tenant_id = $1", [tenantId]);
});

afterEach(() => {
  restoreOutlookOauthEnv();
});

describe("Microsoft integration observability", () => {
  it("surfaces startup validation issues and health checks for enabled Microsoft features", async () => {
    config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED = true;
    config.MICROSOFT_TEAMS_PERSONAL_APP_ENABLED = true;

    const response = await request(app)
      .get("/api/integrations/microsoft/health")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.feature_flags.teams_search_enabled).toBe(true);
    expect(response.body.startup_validation.valid).toBe(false);
    expect(
      response.body.startup_validation.issues.some(
        (issue: { code: string }) =>
          issue.code === "teams_search.bot_app_id.missing" || issue.code === "config.teams_manifest_placeholder_app_id"
      )
    ).toBe(true);
    expect(
      response.body.health_checks.some(
        (check: { area: string; status: string }) => check.area === "teams_search" && check.status === "failing"
      )
    ).toBe(true);
  });

  it("warns when Outlook webhook verification is not configured for pilot-safe change tracking", async () => {
    enableOutlookSyncForTest();
    config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE = "";
    config.WEBHOOK_SHARED_SECRET = "";

    const response = await request(app)
      .get("/api/integrations/microsoft/health")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.startup_validation.issues.some(
        (issue: { code: string }) => issue.code === "outlook_calendar_sync.webhook_verification_unconfigured"
      )
    ).toBe(true);
  });

  it("records Teams message extension authentication failures in Microsoft diagnostics", async () => {
    config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED = true;
    config.MICROSOFT_TEAMS_BOT_APP_ID = "11111111-1111-1111-1111-111111111111";
    config.MICROSOFT_TEAMS_DEV_BYPASS_AUTH = false;

    const response = await request(app).post("/api/integrations/teams/message-extension").send({
      channelId: "msteams",
      value: {
        commandId: "search",
        parameters: [{ name: "query", value: "monticello" }]
      }
    });

    expect(response.status).toBe(401);

    const diagnosticRows = await pool.query<{ event_type: string }>(
      `
        SELECT event_type
        FROM microsoft_integration_event
        WHERE integration_area = 'teams_search'::microsoft_integration_area
        ORDER BY occurred_at DESC
        LIMIT 5
      `
    );

    expect(diagnosticRows.rows.map((row) => row.event_type)).toContain("teams.message_extension.request_failed");
  });

  it("records Microsoft auth callback failures when the OAuth state is missing", async () => {
    config.MICROSOFT_ENTRA_AUTH_ENABLED = true;
    config.MICROSOFT_GRAPH_CLIENT_ID = "auth-client";
    config.MICROSOFT_GRAPH_CLIENT_SECRET = "auth-secret";
    config.MICROSOFT_GRAPH_TENANT_ID = "auth-tenant";
    config.MICROSOFT_ENTRA_REDIRECT_URI = "http://localhost:4000/auth/microsoft/callback";
    config.MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI = "http://localhost:5173";

    const response = await request(app).get("/auth/microsoft/callback?code=fake-code");

    expect(response.status).toBe(302);
    expect(String(response.headers.location)).toContain("reason=missing_state");

    const diagnosticRows = await pool.query<{ event_type: string }>(
      `
        SELECT event_type
        FROM microsoft_integration_event
        WHERE integration_area = 'auth'::microsoft_integration_area
        ORDER BY occurred_at DESC
        LIMIT 5
      `
    );

    expect(diagnosticRows.rows.map((row) => row.event_type)).toContain("auth.microsoft.callback.missing_state");
  });

  it("marks delegated Outlook health as warning when the live connection is disconnected", async () => {
    enableOutlookSyncForTest();

    const client = await pool.connect();
    try {
      await upsertConnection(client, tenantId, {
        provider_mode: "graph_live",
        connection_status: "disconnected",
        health_state: "disconnected",
        connected_account_email: "pilot.dummy@example.com",
        warning_count: 0,
        error_count: 0,
        disconnected_at: "2026-04-22T20:00:00.000Z"
      });
    } finally {
      client.release();
    }

    const response = await request(app)
      .get("/api/integrations/microsoft/health")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.health_checks.some(
        (check: { area: string; status: string; summary: string; details: Record<string, unknown> }) =>
          check.area === "outlook_calendar_sync" &&
          check.status === "warning" &&
          check.summary.includes("disconnected") &&
          check.details.connection_status === "disconnected" &&
          check.details.provider_mode === "graph_live"
      )
    ).toBe(true);
  });

  it("marks delegated Outlook health as warning when only mock preview is connected", async () => {
    enableOutlookSyncForTest();

    const client = await pool.connect();
    try {
      await upsertConnection(client, tenantId, {
        provider_mode: "mock",
        connection_status: "connected",
        health_state: "mock",
        connected_account_email: "leadership.mock@kemmetmueller.local",
        warning_count: 0,
        error_count: 0
      });
    } finally {
      client.release();
    }

    const response = await request(app)
      .get("/api/integrations/microsoft/health")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.health_checks.some(
        (check: { area: string; status: string; summary: string; details: Record<string, unknown> }) =>
          check.area === "outlook_calendar_sync" &&
          check.status === "warning" &&
          check.summary.includes("mock preview") &&
          check.details.connection_status === "connected" &&
          check.details.provider_mode === "mock"
      )
    ).toBe(true);
  });

  it("keeps observability pinned to the active provider so mock preview cannot mask live disconnection", async () => {
    enableOutlookSyncForTest();

    const client = await pool.connect();
    try {
      await upsertConnection(client, tenantId, {
        provider_mode: "mock",
        connection_status: "connected",
        health_state: "mock",
        connected_account_email: null,
        warning_count: 0,
        error_count: 0
      });
      await upsertConnection(client, tenantId, {
        provider_mode: "graph_live",
        connection_status: "disconnected",
        health_state: "disconnected",
        connected_account_email: "pilot.dummy@example.com",
        warning_count: 0,
        error_count: 0,
        disconnected_at: "2026-04-22T20:00:00.000Z"
      });
      await setActiveProviderMode(client, tenantId, "graph_live");
    } finally {
      client.release();
    }

    const response = await request(app)
      .get("/api/integrations/microsoft/health")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.health_checks.some(
        (check: { area: string; summary: string; details: Record<string, unknown> }) =>
          check.area === "outlook_calendar_sync" &&
          check.summary.includes("live Microsoft 365 connection is disconnected") &&
          check.details.provider_mode === "graph_live" &&
          check.details.connection_status === "disconnected"
      )
    ).toBe(true);
  });
});
