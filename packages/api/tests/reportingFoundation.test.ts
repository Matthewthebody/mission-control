import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Pool } from "pg";
import { devLogin, getTenantId } from "./helpers.js";

const app = createApp();
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

let leadershipToken = "";
let photographerToken = "";
let dbPool: Pool;
let demoTenantId = "";

beforeAll(async () => {
  const { pool } = await import("../src/db/pool.js");
  dbPool = pool;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  demoTenantId = String(await getTenantId("Demo Studio"));
});

describe("reporting foundation", () => {
  it("returns reusable operational analytics sections for reports users", async () => {
    const response = await request(app)
      .get(`/api/reporting/foundation?date=${localDate}&period=monthly`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        anchor_date: localDate,
        period: "monthly",
        summary_strip: expect.any(Array),
        data_readiness: expect.objectContaining({
          summary_line: expect.any(String),
          areas: expect.any(Array)
        }),
        staffing_efficiency: expect.objectContaining({
          summary_line: expect.any(String),
          metrics: expect.any(Array),
          trend: expect.any(Array)
        }),
        job_completion_timing: expect.objectContaining({
          metrics: expect.any(Array),
          trend: expect.any(Array)
        }),
        overdue_work: expect.objectContaining({
          metrics: expect.any(Array)
        }),
        production_throughput: expect.objectContaining({
          metrics: expect.any(Array)
        }),
        approvals_exceptions: expect.objectContaining({
          metrics: expect.any(Array)
        }),
        notification_event_trends: expect.objectContaining({
          metrics: expect.any(Array)
        }),
        employee_workload: expect.objectContaining({
          metrics: expect.any(Array),
          people: expect.any(Array)
        }),
        technical_debt: expect.any(Array)
      })
    );

    const auditRows = await dbPool.query<{ event_type: string; result: string }>(
      `
        SELECT event_type, result
        FROM audit_events
        WHERE tenant_id = $1
          AND event_category = 'reporting_foundation'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [demoTenantId]
    );

    expect(auditRows.rows[0]).toEqual(
      expect.objectContaining({
        event_type: "reporting_foundation.generated",
        result: expect.stringMatching(/^(results|empty)$/)
      })
    );
  });

  it("keeps the reporting foundation unavailable to standard employee shells", async () => {
    const response = await request(app)
      .get(`/api/reporting/foundation?date=${localDate}&period=monthly`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(403);
  });
});
