import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import type { Express } from "express";
import type { Pool } from "pg";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let demoTenantId = "";
let demoOrgId = "";

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function seedSearchIndexRow(
  payload: Partial<{
    id: string;
    entity_type: string;
    entity_id: string;
    title: string;
    subtitle: string | null;
    body_search_text: string | null;
    status: string | null;
    department: string | null;
    org_id: string | null;
    org_name: string | null;
    owner_id: string | null;
    assignee_ids: string[];
    related_ids: string[];
    primary_date: string | null;
    risk_level: string | null;
    permissions_payload: Record<string, unknown>;
    deep_link: string;
    has_notes: boolean;
    has_alerts: boolean;
    has_staffing_gap: boolean;
  }>
) {
  const id = payload.id ?? randomUUID();
  const entityId = payload.entity_id ?? randomUUID();
  await dbPool.query(
    `
      INSERT INTO global_search_index (
        id,
        tenant_id,
        entity_type,
        entity_id,
        title,
        subtitle,
        body_search_text,
        status,
        department,
        org_id,
        org_name,
        owner_id,
        assignee_ids,
        related_ids,
        primary_date,
        risk_level,
        permissions_payload,
        deep_link,
        updated_at,
        activity_at,
        has_notes,
        has_alerts,
        has_staffing_gap
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4::uuid,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::uuid,
        $11,
        $12::uuid,
        $13::uuid[],
        $14::uuid[],
        $15::timestamptz,
        $16,
        $17::jsonb,
        $18,
        now(),
        COALESCE($15::timestamptz, now()),
        $19,
        $20,
        $21
      )
      ON CONFLICT (tenant_id, entity_type, entity_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        body_search_text = EXCLUDED.body_search_text,
        status = EXCLUDED.status,
        department = EXCLUDED.department,
        org_id = EXCLUDED.org_id,
        org_name = EXCLUDED.org_name,
        owner_id = EXCLUDED.owner_id,
        assignee_ids = EXCLUDED.assignee_ids,
        related_ids = EXCLUDED.related_ids,
        primary_date = EXCLUDED.primary_date,
        risk_level = EXCLUDED.risk_level,
        permissions_payload = EXCLUDED.permissions_payload,
        deep_link = EXCLUDED.deep_link,
        updated_at = now(),
        activity_at = COALESCE(EXCLUDED.primary_date, now()),
        has_notes = EXCLUDED.has_notes,
        has_alerts = EXCLUDED.has_alerts,
        has_staffing_gap = EXCLUDED.has_staffing_gap
    `,
    [
      id,
      demoTenantId,
      payload.entity_type ?? "organization",
      entityId,
      payload.title ?? `Teams Search Seed ${Date.now()}`,
      payload.subtitle ?? null,
      payload.body_search_text ?? null,
      payload.status ?? null,
      payload.department ?? null,
      payload.org_id ?? null,
      payload.org_name ?? null,
      payload.owner_id ?? null,
      payload.assignee_ids ?? [],
      payload.related_ids ?? [],
      payload.primary_date ?? null,
      payload.risk_level ?? null,
      JSON.stringify(payload.permissions_payload ?? { access_model: "directory" }),
      payload.deep_link ?? "#home",
      Boolean(payload.has_notes),
      Boolean(payload.has_alerts),
      Boolean(payload.has_staffing_gap)
    ]
  );
  return { id, entityId };
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  const migrationSql = await readFile(
    resolve(process.cwd(), "../../db/migrations/111_teams_message_extension_search_phase4.sql"),
    "utf8"
  );
  await dbPool.query(migrationSql);

  leadershipToken = await login("leadership@example.com");
  const membership = await dbPool.query<{ tenant_id: string }>(
    "SELECT tenant_id::text FROM app_user WHERE lower(email) = lower($1) LIMIT 1",
    ["leadership@example.com"]
  );
  demoTenantId = membership.rows[0]?.tenant_id ?? "";

  const organization = await dbPool.query<{ id: string }>(
    "SELECT id::text FROM organization WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1",
    [demoTenantId]
  );
  demoOrgId = organization.rows[0]?.id ?? randomUUID();
});

beforeEach(async () => {
  config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED = true;
  config.MICROSOFT_TEAMS_DEV_BYPASS_AUTH = true;
  config.MICROSOFT_TEAMS_BOT_APP_ID = "11111111-1111-1111-1111-111111111111";
  config.API_PUBLIC_URL = "http://localhost:4000";
  config.ADMIN_WEB_URL = "http://localhost:5173";
  await dbPool.query("DELETE FROM audit_events WHERE tenant_id = $1 AND event_category = 'microsoft_teams_search'", [demoTenantId]);
});

describe("Teams message extension search", () => {
  it("returns compact permission-aware cards across multiple business object types", async () => {
    const suffix = Date.now();
    await seedSearchIndexRow({
      entity_type: "organization",
      title: `Monticello Organization ${suffix}`,
      subtitle: "Schools account",
      org_id: demoOrgId,
      org_name: `Monticello Organization ${suffix}`,
      related_ids: [demoOrgId],
      body_search_text: "Monticello school account profile",
      permissions_payload: { access_model: "directory" },
      deep_link: `#directory/organizations?organization=${demoOrgId}`
    });
    await seedSearchIndexRow({
      entity_type: "contact",
      title: `Monticello Contact ${suffix}`,
      subtitle: "Monticello Organization",
      org_id: demoOrgId,
      org_name: "Monticello Organization",
      related_ids: [demoOrgId],
      body_search_text: "Primary contact for Monticello",
      permissions_payload: { access_model: "directory" },
      deep_link: "#directory/contacts?view=contacts"
    });
    await seedSearchIndexRow({
      entity_type: "location",
      title: `Monticello Gym ${suffix}`,
      subtitle: "Monticello campus",
      org_id: demoOrgId,
      org_name: "Monticello Organization",
      related_ids: [demoOrgId],
      body_search_text: "Field entrance and parking details",
      permissions_payload: { access_model: "directory" },
      deep_link: "#directory/locations?location=11111111-1111-1111-1111-111111111111"
    });
    await seedSearchIndexRow({
      entity_type: "shoot",
      title: `Monticello Spring Pictures ${suffix}`,
      subtitle: "Upcoming school job",
      org_id: demoOrgId,
      org_name: "Monticello Organization",
      related_ids: [demoOrgId],
      body_search_text: "Upcoming school shoot",
      status: "active",
      department: "schools",
      primary_date: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      permissions_payload: { access_model: "shoot", department: "schools" },
      deep_link: "#photography/shoots?shoot=22222222-2222-2222-2222-222222222222"
    });
    await seedSearchIndexRow({
      entity_type: "resource_library_item",
      title: `Monticello SOP ${suffix}.pdf`,
      subtitle: "Job setup reference",
      org_id: demoOrgId,
      org_name: "Monticello Organization",
      related_ids: [demoOrgId],
      body_search_text: "SOP setup checklist and field reference",
      status: "approved",
      department: "schools",
      primary_date: new Date().toISOString(),
      permissions_payload: {
        access_model: "resource_library_item",
        linked_scope: "shoot",
        department: "schools",
        visibility_scope: "photographer_prep",
        approval_status: "approved",
        is_best_reference: true,
        uploader_user_id: null
      },
      deep_link: "#photography/shoots?shoot=22222222-2222-2222-2222-222222222222"
    });

    const response = await request(app)
      .post("/api/integrations/teams/message-extension")
      .set("X-PMC-Teams-Dev-User-Email", "leadership@example.com")
      .send({
        channelId: "msteams",
        from: { aadObjectId: "ignored" },
        conversation: { tenantId: "ignored" },
        value: {
          commandId: "search",
          parameters: [{ name: "query", value: `Monticello ${suffix}` }]
        }
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.composeExtension.type).toBe("result");
    expect(response.body.composeExtension.attachments.length).toBeGreaterThanOrEqual(4);
    const titles = response.body.composeExtension.attachments.map((attachment: { content: { title: string } }) => attachment.content.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        `Monticello Organization ${suffix}`,
        `Monticello Contact ${suffix}`,
        `Monticello Gym ${suffix}`,
        `Monticello Spring Pictures ${suffix}`
      ])
    );
    const firstButton = response.body.composeExtension.attachments[0].content.buttons[0].value as string;
    expect(firstButton).toContain("/api/integrations/teams/message-extension/open?token=");

    const telemetry = await request(app)
      .get("/api/integrations/teams/message-extension/telemetry?limit=10")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(telemetry.status).toBe(200);
    expect(telemetry.body.some((entry: { event_type: string; result: string }) => entry.event_type === "teams.message_extension.search" && entry.result === "results")).toBe(true);
  });

  it("logs no-result queries and returns an empty Teams result set", async () => {
    const query = `zzznomatch${Date.now()}alpha`;
    const response = await request(app)
      .post("/api/integrations/teams/message-extension")
      .set("X-PMC-Teams-Dev-User-Email", "leadership@example.com")
      .send({
        channelId: "msteams",
        from: { aadObjectId: "ignored" },
        conversation: { tenantId: "ignored" },
        value: {
          commandId: "search",
          parameters: [
            { name: "query", value: query },
            { name: "scope", value: "organizations" }
          ]
        }
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.composeExtension.attachments).toHaveLength(0);

    const rows = await dbPool.query<{ event_type: string; result: string }>(
      `
        SELECT event_type, result
        FROM audit_events
        WHERE tenant_id = $1
          AND event_category = 'microsoft_teams_search'
        ORDER BY created_at DESC
      `,
      [demoTenantId]
    );

    expect(rows.rows.some((row) => row.event_type === "teams.message_extension.no_results")).toBe(true);
    expect(rows.rows.some((row) => row.event_type === "teams.message_extension.search" && row.result === "no_results")).toBe(true);
  });

  it("redirects through the click telemetry endpoint and records the click type", async () => {
    const searchNeedle = `click-open-${Date.now()}`;
    const seeded = await seedSearchIndexRow({
      entity_type: "organization",
      title: `Click Open ${searchNeedle}`,
      subtitle: "Directory entry",
      org_id: demoOrgId,
      org_name: "Click Open Org",
      body_search_text: `Operational directory card ${searchNeedle}`,
      permissions_payload: { access_model: "directory" },
      deep_link: `#directory/organizations?organization=${demoOrgId}`
    });

    const searchResponse = await request(app)
      .post("/api/integrations/teams/message-extension")
      .set("X-PMC-Teams-Dev-User-Email", "leadership@example.com")
      .send({
        channelId: "msteams",
        from: { aadObjectId: "ignored" },
        conversation: { tenantId: "ignored" },
        value: {
          commandId: "search",
          parameters: [{ name: "query", value: searchNeedle }]
        }
      });

    expect(searchResponse.status, JSON.stringify(searchResponse.body)).toBe(200);
    const targetAttachment = searchResponse.body.composeExtension.attachments.find(
      (attachment: { content: { title: string } }) => attachment.content.title === `Click Open ${searchNeedle}`
    );
    expect(targetAttachment).toBeTruthy();
    const buttonUrl = String(targetAttachment.content.buttons[0].value);
    const url = new URL(buttonUrl);
    const openResponse = await request(app).get(`${url.pathname}${url.search}`);

    expect(openResponse.status).toBe(302);
    expect(String(openResponse.headers.location)).toBe(`http://localhost:5173/?teams=1#directory/organizations?organization=${demoOrgId}`);

    const openAudit = await dbPool.query<{ event_type: string; resource_id: string | null; result: string }>(
      `
        SELECT event_type, resource_id::text, result
        FROM audit_events
        WHERE tenant_id = $1
          AND event_type = 'teams.message_extension.open'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [demoTenantId]
    );

    expect(openAudit.rows[0]?.event_type).toBe("teams.message_extension.open");
    expect(openAudit.rows[0]?.resource_id).toBe(seeded.id);
    expect(openAudit.rows[0]?.result).toBe("open_button");
  });

  it("keeps restricted SOP/file records out of field-user Teams search", async () => {
    const restrictedNeedle = `restricted-sop-${Date.now()}`;
    const restrictedTitle = `Leadership SOP ${restrictedNeedle}.pdf`;
    await seedSearchIndexRow({
      entity_type: "resource_library_item",
      title: restrictedTitle,
      subtitle: "Restricted prep file",
      org_id: demoOrgId,
      org_name: "Restricted Org",
      body_search_text: `Do not show ${restrictedNeedle} to field users`,
      status: "leadership_only",
      department: "schools",
      primary_date: new Date().toISOString(),
      permissions_payload: {
        access_model: "resource_library_item",
        linked_scope: "organization",
        department: "schools",
        visibility_scope: "leadership_only",
        approval_status: "leadership_only",
        is_best_reference: false,
        uploader_user_id: null
      },
      deep_link: `#directory/organizations?organization=${demoOrgId}`
    });

    const response = await request(app)
      .post("/api/integrations/teams/message-extension")
      .set("X-PMC-Teams-Dev-User-Email", "photo@example.com")
      .send({
        channelId: "msteams",
        from: { aadObjectId: "ignored" },
        conversation: { tenantId: "ignored" },
        value: {
          commandId: "search",
          parameters: [
            { name: "query", value: restrictedNeedle },
            { name: "scope", value: "sops_files" }
          ]
        }
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const titles = response.body.composeExtension.attachments.map((attachment: { content: { title: string } }) => attachment.content.title);
    expect(titles).not.toContain(restrictedTitle);
  });
});
