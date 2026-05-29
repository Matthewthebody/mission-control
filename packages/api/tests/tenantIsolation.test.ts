import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";

const app = createApp();

let primaryTenantId = "";
let primaryAdminId = "";
let primaryToken = "";
let secondaryTenantId = "";
let secondaryAdminId = "";
let secondaryToken = "";
let secondaryShootId = "";
let secondaryShootCode = "ISO-001";
let secondaryShootDate = "";
let secondaryPostShootEvaluationId = "";
let secondaryReportSnapshotId = "";

beforeAll(async () => {
  const primaryContext = await pool.query(
    `
      SELECT t.id AS tenant_id, u.id AS user_id
      FROM tenant t
      JOIN app_user u ON u.tenant_id = t.id
      WHERE t.name = 'Demo Studio' AND u.email = 'admin@example.com'
      LIMIT 1
    `
  );
  primaryTenantId = primaryContext.rows[0].tenant_id;
  primaryAdminId = primaryContext.rows[0].user_id;

  const adminRole = await pool.query("SELECT id FROM role WHERE code = 'admin' LIMIT 1");
  const adminRoleId = adminRole.rows[0].id;

  const tenantInsert = await pool.query(
    `
      INSERT INTO tenant (name)
      VALUES ('Isolation Test Studio')
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `
  );
  secondaryTenantId = tenantInsert.rows[0].id;

  const studioInsert = await pool.query(
    `
      INSERT INTO studio (tenant_id, name, latitude, longitude)
      VALUES ($1, 'Isolation Test Studio Main', 44.9801, -93.2701)
      ON CONFLICT (tenant_id, name)
      DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
      RETURNING id
    `,
    [secondaryTenantId]
  );
  const studioId = studioInsert.rows[0].id;

  const locationInsert = await pool.query(
    `
      WITH existing AS (
        SELECT id
        FROM shoot_location
        WHERE tenant_id = $1
          AND normalized_name = 'isolation test location'
        ORDER BY created_at ASC
        LIMIT 1
      ),
      inserted AS (
        INSERT INTO shoot_location (
          tenant_id,
          external_source,
          external_key,
          organization_id,
          name,
          normalized_name,
          address,
          normalized_address,
          address_line_1,
          city,
          state,
          zip
        )
        SELECT $1, 'tenant_isolation_test', 'tenant-isolation-location', NULL, 'Isolation Test Location', 'isolation test location', '100 Isolation Ave, Minneapolis, MN 55401', '100 isolation ave minneapolis mn 55401', '100 Isolation Ave', 'Minneapolis', 'MN', '55401'
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id
      )
      SELECT id FROM inserted
      UNION ALL
      SELECT id FROM existing
      LIMIT 1
    `,
    [secondaryTenantId]
  );
  const locationId = locationInsert.rows[0].id;

  const userInsert = await pool.query(
    `
      INSERT INTO app_user (tenant_id, email, full_name)
      VALUES ($1, 'isolation-admin@example.com', 'Isolation Admin')
      ON CONFLICT (tenant_id, email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id
    `,
    [secondaryTenantId]
  );
  secondaryAdminId = userInsert.rows[0].id;

  await pool.query(
    `
      INSERT INTO user_role (tenant_id, user_id, role_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `,
    [secondaryTenantId, secondaryAdminId, adminRoleId]
  );

  const shootInsert = await pool.query(
    `
      INSERT INTO shoot (
        tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_lat, location_lng,
        geofence_radius_meters, arrival_time, start_time, end_time_est, created_by
      )
      VALUES (
        $1, $2, $3, 'Isolation Coverage Shoot', CURRENT_DATE, 'Isolation Lot', 44.9805, -93.2706,
        200, now() + interval '15 minutes', now() + interval '30 minutes', now() + interval '90 minutes', $4
      )
      ON CONFLICT (tenant_id, shoot_code)
      DO UPDATE SET title = EXCLUDED.title, location_name = EXCLUDED.location_name
      RETURNING id, shoot_date::text AS shoot_date
    `,
    [secondaryTenantId, studioId, secondaryShootCode, secondaryAdminId]
  );
  secondaryShootId = shootInsert.rows[0].id;
  secondaryShootDate = shootInsert.rows[0].shoot_date;

  const evaluationInsert = await pool.query(
    `
      INSERT INTO post_shoot_evaluation (
        tenant_id,
        location_id,
        shoot_id,
        shoot_name,
        shoot_date,
        photographer_user_id,
        photographer_name,
        shoot_type,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        source,
        import_source
      )
      VALUES ($1,$2,$3,'Isolation Closeout Shoot',CURRENT_DATE,$4,'Isolation Admin','school','yes','yes',5,'yes','tenant_isolation_test','tenant_isolation_test')
      RETURNING id
    `,
    [secondaryTenantId, locationId, secondaryShootId, secondaryAdminId]
  );
  secondaryPostShootEvaluationId = evaluationInsert.rows[0].id;

  const reportInsert = await pool.query(
    `
      INSERT INTO operations_report_snapshot (
        tenant_id,
        report_type,
        period_start,
        period_end,
        generated_by,
        summary_metrics
      )
      VALUES ($1,'daily',date_trunc('day', now()),date_trunc('day', now()) + interval '1 day','tenant_isolation_test','{"source":"tenant_isolation"}'::jsonb)
      RETURNING id
    `,
    [secondaryTenantId]
  );
  secondaryReportSnapshotId = reportInsert.rows[0].id;

  const primaryLogin = await request(app).post("/auth/dev-login").send({ email: "admin@example.com" });
  primaryToken = primaryLogin.body.token;

  const secondaryLogin = await request(app).post("/auth/dev-login").send({ email: "isolation-admin@example.com" });
  secondaryToken = secondaryLogin.body.token;
});

describe("tenant isolation and RLS", () => {
  it("blocks a tenant-scoped query from seeing another tenant's shoot via direct DB access", async () => {
    const rows = await withClientTransaction(primaryTenantId, primaryAdminId, async (client) => {
      const result = await client.query("SELECT id, shoot_code FROM shoot WHERE id = $1", [secondaryShootId]);
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("blocks tenant-scoped closeout and report rows from crossing tenant context", async () => {
    const rows = await withClientTransaction(primaryTenantId, primaryAdminId, async (client) => {
      const evaluations = await client.query("SELECT id FROM post_shoot_evaluation WHERE id = $1", [secondaryPostShootEvaluationId]);
      const reports = await client.query("SELECT id FROM operations_report_snapshot WHERE id = $1", [secondaryReportSnapshotId]);
      return { evaluations: evaluations.rows, reports: reports.rows };
    });

    expect(rows.evaluations).toHaveLength(0);
    expect(rows.reports).toHaveLength(0);
  });

  it("allows same-tenant closeout and report rows through the tenant context", async () => {
    const rows = await withClientTransaction(secondaryTenantId, secondaryAdminId, async (client) => {
      const evaluations = await client.query("SELECT id FROM post_shoot_evaluation WHERE id = $1", [secondaryPostShootEvaluationId]);
      const reports = await client.query("SELECT id FROM operations_report_snapshot WHERE id = $1", [secondaryReportSnapshotId]);
      return { evaluations: evaluations.rows, reports: reports.rows };
    });

    expect(rows.evaluations).toHaveLength(1);
    expect(rows.reports).toHaveLength(1);
  });

  it("keeps the Demo Studio admin from seeing the isolation tenant shoot in the API list", async () => {
    const response = await request(app)
      .get(`/api/shoots?date=${secondaryShootDate}`)
      .set("Authorization", `Bearer ${primaryToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((shoot: { shoot_code: string }) => shoot.shoot_code === secondaryShootCode)).toBe(false);
  });

  it("shows the isolation tenant admin only their own shoot through the same API endpoint", async () => {
    const response = await request(app)
      .get(`/api/shoots?date=${secondaryShootDate}`)
      .set("Authorization", `Bearer ${secondaryToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((shoot: { shoot_code: string }) => shoot.shoot_code === secondaryShootCode)).toBe(true);
    expect(response.body.some((shoot: { shoot_code: string }) => shoot.shoot_code === "DEMO-001")).toBe(false);
  });
});
