import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let demoTenantId = "";
let demoOrgId = "";
let leadershipUserId = "";

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
      payload.title ?? `Global Search Seed ${Date.now()}`,
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

  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");

  const tenantRow = await dbPool.query<{ tenant_id: string; id: string }>(
    `
      SELECT tenant_id::text AS tenant_id, id::text AS id
      FROM app_user
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    ["leadership@example.com"]
  );
  demoTenantId = tenantRow.rows[0]?.tenant_id ?? "";
  leadershipUserId = tenantRow.rows[0]?.id ?? "";

  const organizationRow = await dbPool.query<{ id: string }>(
    "SELECT id::text FROM organization WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1",
    [demoTenantId]
  );
  demoOrgId = organizationRow.rows[0]?.id ?? randomUUID();
}, 30000);

beforeEach(async () => {
  await dbPool.query("DELETE FROM audit_events WHERE tenant_id = $1 AND event_category = 'global_search'", [demoTenantId]);
});

describe("global search foundation", () => {
  it("coalesces nullable derived booleans before building search documents", async () => {
    const { mapPostShootEvaluationToSearchDocument } = await import("../src/services/concierge/searchIndexMappers.js");
    const document = mapPostShootEvaluationToSearchDocument({
      tenant_id: demoTenantId,
      id: randomUUID(),
      title: "Post-shoot eval nullable staffing flag",
      subtitle: null,
      body: null,
      department: "schools",
      photographer_user_id: leadershipUserId,
      manager_user_id: null,
      assigned_user_ids: [],
      lead_user_ids: [],
      org_id: demoOrgId,
      org_name: "Demo Org",
      status: "submitted",
      primary_date: null,
      risk_level: null,
      deep_link: "#job-closeout",
      updated_at: new Date().toISOString(),
      staffing_gap: null as unknown as boolean
    });

    expect(document.has_staffing_gap).toBe(false);
  });

  it("returns grouped, deep-linkable, permission-aware results across major search domains", async () => {
    const suffix = Date.now();

    await seedSearchIndexRow({
      entity_type: "organization",
      title: `Monticello ${suffix}`,
      subtitle: "Schools account",
      org_id: demoOrgId,
      org_name: `Monticello ${suffix}`,
      related_ids: [demoOrgId],
      body_search_text: "Primary school organization record",
      permissions_payload: { access_model: "directory" },
      deep_link: `#directory/organizations?organization=${demoOrgId}`
    });

    await seedSearchIndexRow({
      entity_type: "contact",
      title: `Monticello Contact ${suffix}`,
      subtitle: "Primary contact",
      org_id: demoOrgId,
      org_name: `Monticello ${suffix}`,
      related_ids: [demoOrgId],
      body_search_text: "Primary contact for Monticello account",
      permissions_payload: { access_model: "directory" },
      deep_link: "#directory/contacts?view=contacts"
    });

    await seedSearchIndexRow({
      entity_type: "shoot",
      title: `Monticello Spring Shoot ${suffix}`,
      subtitle: "Upcoming school job",
      status: "active",
      department: "schools",
      org_id: demoOrgId,
      org_name: `Monticello ${suffix}`,
      related_ids: [demoOrgId],
      primary_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      body_search_text: "Upcoming school shoot with final staffing",
      permissions_payload: { access_model: "shoot", department: "schools" },
      deep_link: "#photography/shoots?shoot=22222222-2222-2222-2222-222222222222"
    });

    await seedSearchIndexRow({
      entity_type: "resource_library_item",
      title: `Monticello SOP ${suffix}.pdf`,
      subtitle: "Field setup guide",
      status: "approved",
      department: "schools",
      org_id: demoOrgId,
      org_name: `Monticello ${suffix}`,
      related_ids: [demoOrgId],
      body_search_text: "Setup SOP and field reference document",
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
      .get("/api/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: `Monticello ${suffix}`, limit: 12 });

    expect(response.status).toBe(200);
    expect(response.body.product_name).toBe("Kemmetmueller Search");
    expect(response.body.query).toBe(`Monticello ${suffix}`);
    expect(Array.isArray(response.body.groups)).toBe(true);
    expect(response.body.groups[0].domain).toBe("organizations");
    expect(response.body.groups.some((group: { domain: string }) => group.domain === "jobs")).toBe(true);
    expect(response.body.groups.some((group: { domain: string }) => group.domain === "contacts")).toBe(true);
    expect(response.body.groups.some((group: { domain: string }) => group.domain === "resources")).toBe(true);

    const orgGroup = response.body.groups.find((group: { domain: string }) => group.domain === "organizations");
    expect(orgGroup.results[0].title).toBe(`Monticello ${suffix}`);
    expect(orgGroup.results[0].deep_link).toBe(`#directory/organizations?organization=${demoOrgId}`);
  });

  it("filters restricted results by permission and surfaces access-limited state", async () => {
    const restrictedTitle = `Restricted Search Task ${Date.now()}`;
    await seedSearchIndexRow({
      entity_type: "task",
      title: restrictedTitle,
      subtitle: "Production follow-up",
      status: "blocked",
      department: "production",
      org_id: demoOrgId,
      org_name: "Restricted Org",
      body_search_text: "Leadership-only production blocker",
      permissions_payload: {
        access_model: "task",
        department: "production",
        created_by_user_id: leadershipUserId
      },
      deep_link: "#tasks/restricted-task-1"
    });

    const response = await request(app)
      .get("/api/search")
      .set("Authorization", `Bearer ${photographerToken}`)
      .query({ q: restrictedTitle, limit: 8 });

    expect(response.status).toBe(200);
    expect(response.body.access_limited).toBe(true);
    const flattened = response.body.groups.flatMap((group: { results: Array<{ title: string }> }) => group.results);
    expect(flattened.some((result: { title: string }) => result.title === restrictedTitle)).toBe(false);
  });

  it("keeps GET search reads pure instead of writing telemetry records", async () => {
    const noHitQuery = `zzqv-no-hit-${Date.now()}-${randomUUID()}-alpha-omega`;
    const searchResponse = await request(app)
      .get("/api/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: noHitQuery, limit: 6, domain: "jobs,production" });

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.total_results).toBe(0);

    const telemetryResponse = await request(app)
      .get("/api/search/telemetry")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ limit: 10 });

    expect(telemetryResponse.status).toBe(200);
    expect(Array.isArray(telemetryResponse.body)).toBe(true);
    expect(telemetryResponse.body).toEqual([]);
  });
});
