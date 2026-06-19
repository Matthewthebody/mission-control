import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

// Validates GET /api/jobs/status-counts (the canonical, uncapped job-status count
// read behind the Company Command "Jobs Behind" / "Production Load" cards) against
// a direct database query, plus auth and read-scope behavior. It asserts the
// endpoint mirrors the database rather than seeding fixtures, so it stays correct
// regardless of how the demo tenant is populated.

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";

type Counts = {
  total_active: number;
  behind: number;
  at_risk: number;
  blocked_production: number;
  high_risk: number;
  staffing_gap: number;
};

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function dbCounts(department: string | null): Promise<Counts> {
  const params: unknown[] = [tenantId];
  let where = "tenant_id = $1 AND archived_at IS NULL";
  if (department) {
    params.push(department);
    where += " AND department_type = $2::job_department_type";
  }
  const result = await dbPool.query<Counts>(
    `
      SELECT
        count(*)::int AS total_active,
        count(*) FILTER (WHERE readiness_status = 'off_track')::int AS behind,
        count(*) FILTER (WHERE readiness_status = 'at_risk')::int AS at_risk,
        count(*) FILTER (WHERE production_status = 'blocked')::int AS blocked_production,
        count(*) FILTER (WHERE risk_status IN ('high', 'critical'))::int AS high_risk,
        count(*) FILTER (WHERE staffing_status = 'gap_flagged')::int AS staffing_gap
      FROM jobs
      WHERE ${where}
    `,
    params
  );
  return result.rows[0];
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");

  const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`);
  tenantId = me.body.user.tenantId as string;
  expect(tenantId).toBeTruthy();
});

describe("GET /api/jobs/status-counts", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/jobs/status-counts");
    expect(response.status).toBe(401);
  });

  it("returns accurate, tenant-scoped canonical job-status counts that mirror the database", async () => {
    const response = await request(app)
      .get("/api/jobs/status-counts")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(response.status).toBe(200);
    const counts = response.body.counts as Counts;
    expect(counts).toEqual(await dbCounts(null));
    // The whole reason this endpoint exists: the canonical tenant carries more
    // active jobs than the legacy 200-row list cap, so a client-side count over the
    // list would undercount.
    expect(counts.total_active).toBeGreaterThan(0);
  });

  it("scopes counts to a requested department", async () => {
    const response = await request(app)
      .get("/api/jobs/status-counts?department_type=schools")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(response.status).toBe(200);
    expect(response.body.counts).toEqual(await dbCounts("schools"));
  });

  it("never reports more than full-access leadership sees for a more limited reader", async () => {
    const leadership = await request(app)
      .get("/api/jobs/status-counts")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const limited = await request(app)
      .get("/api/jobs/status-counts")
      .set("Authorization", `Bearer ${photographerToken}`);
    expect(limited.status).toBe(200);
    expect(limited.body.counts.total_active).toBeLessThanOrEqual(leadership.body.counts.total_active);
    expect(limited.body.counts.total_active).toBeGreaterThanOrEqual(0);
  });
});
