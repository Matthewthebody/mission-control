import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId } from "./helpers.js";

// G6 slice 1 — repeated-incident patterns over time_clock_compliance_flag
// history. Fixtures use a marker dedupe prefix and are torn down; assertions
// target only the fixture employee+type groups so shared demo flags cannot
// destabilize them.

const app = createApp();
const MARKER = `g6-pattern-test:${randomUUID()}`;

let leadershipToken = "";
let employeeToken = "";
let employeeId = "";
let tenantId = "";

async function insertFlag(itemType: string, ageDays: number, status: "open" | "resolved") {
  await pool.query(
    `
      INSERT INTO time_clock_compliance_flag (
        tenant_id, employee_id, item_type, severity, status, dedupe_key, metadata,
        first_detected_at, last_detected_at, resolved_at
      )
      VALUES (
        $1, $2, $3::time_clock_compliance_item, 'warning', $4::time_clock_compliance_status, $5, '{}'::jsonb,
        now() - ($6 || ' days')::interval, now() - ($6 || ' days')::interval,
        CASE WHEN $4::text = 'resolved' THEN now() ELSE NULL END
      )
    `,
    [tenantId, employeeId, itemType, status, `${MARKER}:${randomUUID()}`, ageDays]
  );
}

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  employeeToken = (await devLogin(app, "photo@example.com")).body.token;
  employeeId = (await getMembershipId("photo@example.com")) as string;
  tenantId = (
    await pool.query<{ tenant_id: string }>("SELECT tenant_id FROM app_user WHERE id = $1 LIMIT 1", [employeeId])
  ).rows[0].tenant_id;

  // Three same-type incidents across three weeks (one resolved) + one single
  // other-type incident that must NOT form a pattern at min_incidents=3.
  await insertFlag("missing_setup_photo", 2, "open");
  await insertFlag("missing_setup_photo", 9, "open");
  await insertFlag("missing_setup_photo", 16, "resolved");
  await insertFlag("upload_while_off_clock", 3, "open");
});

afterAll(async () => {
  await pool.query("DELETE FROM time_clock_compliance_flag WHERE tenant_id = $1 AND dedupe_key LIKE $2", [
    tenantId,
    `${MARKER}%`
  ]);
});

describe("compliance incident patterns (G6 slice 1)", () => {
  it("groups recurrence per employee and item type with honest window disclosure", async () => {
    const res = await request(app)
      .get("/api/compliance/patterns?window_days=60&min_incidents=3")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(res.status).toBe(200);
    expect(res.body.window_days).toBe(60);
    expect(res.body.min_incidents).toBe(3);
    expect(res.body.source).toBe("time_clock_compliance_flag");
    expect(res.body.total_pattern_count).toBeGreaterThanOrEqual(res.body.patterns.length > 200 ? 200 : 0);

    const setupPattern = res.body.patterns.find(
      (row: { employee_id: string; item_type: string }) =>
        row.employee_id === employeeId && row.item_type === "missing_setup_photo"
    );
    expect(setupPattern).toBeTruthy();
    expect(setupPattern.incident_count).toBeGreaterThanOrEqual(3);
    expect(setupPattern.open_count).toBeGreaterThanOrEqual(2);
    expect(setupPattern.distinct_weeks).toBeGreaterThanOrEqual(3);

    // A single incident is not a pattern at this threshold.
    const uploadPattern = res.body.patterns.find(
      (row: { employee_id: string; item_type: string }) =>
        row.employee_id === employeeId && row.item_type === "upload_while_off_clock"
    );
    expect(uploadPattern).toBeUndefined();
  });

  it("shrinking the window honestly drops out-of-window incidents", async () => {
    const res = await request(app)
      .get("/api/compliance/patterns?window_days=7&min_incidents=3")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(res.status).toBe(200);
    const setupPattern = res.body.patterns.find(
      (row: { employee_id: string; item_type: string }) =>
        row.employee_id === employeeId && row.item_type === "missing_setup_photo"
    );
    expect(setupPattern).toBeUndefined(); // only 1 of the 3 falls inside 7 days
  });

  it("is leadership-gated", async () => {
    const res = await request(app).get("/api/compliance/patterns").set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });
});
