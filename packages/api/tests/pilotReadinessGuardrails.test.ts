import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
let adminToken = "";

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
});

describe("pilot readiness guardrails", () => {
  it("keeps active published jobs backed by execution days", async () => {
    const result = await pool.query<{ missing_count: string }>(
      `
        SELECT count(*)::text AS missing_count
        FROM jobs job
        WHERE job.published_at IS NOT NULL
          AND job.archived_at IS NULL
          AND job.cancelled_at IS NULL
          AND job.completed_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM job_days day
            WHERE day.tenant_id = job.tenant_id
              AND day.job_id = job.id
          )
      `
    );

    expect(Number(result.rows[0]?.missing_count ?? 0)).toBe(0);
  });

  it("keeps dashboard aggregate modules free of direct write SQL", async () => {
    const dashboardReadModules = [
      "src/services/homeDashboard.ts",
      "src/application/dashboard/load-manager-cockpit.action.ts",
      "src/application/shoots/load-live-shoot-queue.action.ts"
    ];

    for (const modulePath of dashboardReadModules) {
      const source = await readFile(resolve(process.cwd(), modulePath), "utf8");
      expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    }
  });

  it("keeps profitability reads on the lean shoot signal projection", async () => {
    const source = await readFile(resolve(process.cwd(), "src/services/profitabilityWorkspace.ts"), "utf8");

    expect(source).toContain("listShootProfitabilitySignals");
    expect(source).not.toMatch(/\blistShoots\b/);
  });

  it("keeps job detail reads pure and available", async () => {
    const jobResult = await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE archived_at IS NULL
          AND cancelled_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `
    );
    const jobId = jobResult.rows[0]?.id;
    expect(jobId).toBeTruthy();

    const before = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM audit_events");
    const response = await request(app).get(`/api/jobs/${jobId}`).set("Authorization", `Bearer ${adminToken}`);
    const after = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM audit_events");

    expect(response.status).toBe(200);
    expect(Number(after.rows[0]?.count ?? 0)).toBe(Number(before.rows[0]?.count ?? 0));
  }, 10_000);
});
