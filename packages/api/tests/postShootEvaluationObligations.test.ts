import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId } from "./helpers.js";

// SSA-2 — post-shoot evaluation obligations read model. Derived roster diff: non-cancelled
// shoot work_shifts minus that photographer's own submitted post_shoot_evaluation rows.
// Runs against the seeded demo DB with marker-titled fixtures cleaned in afterAll.

const app = createApp();
const SHIFT_MARKER = "PSEO-TEST-SHIFT";

let leadershipToken = "";
let employeeToken = "";
let tenantId = "";
let photographerId = "";
let seniorId = "";
let shootId = "";
let shootDate = "";
let standardShiftId = "";
let leadShiftId = "";
let cancelledShiftId = "";
let evaluationId: string | null = null;

function authed(path: string, token: string) {
  return request(app).get(path).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  employeeToken = (await devLogin(app, "photo@example.com")).body.token;
  photographerId = (await getMembershipId("photo@example.com")) as string;
  seniorId = (await getMembershipId("senior@example.com")) as string;
  const tenantRow = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM app_user WHERE id = $1 LIMIT 1",
    [photographerId]
  );
  tenantId = tenantRow.rows[0].tenant_id;

  // Reuse a real published shoot inside the window (past 14 days incl. today) that has a
  // location (post_shoot_evaluation.location_id is NOT NULL).
  const shootRow = await pool.query<{ id: string; shoot_date: string; location_id: string }>(
    `SELECT s.id, s.shoot_date::text AS shoot_date, s.location_id
       FROM shoot s
      WHERE s.tenant_id = $1
        AND s.record_state = 'published'
        AND s.deleted_at IS NULL
        AND s.location_id IS NOT NULL
        AND s.shoot_date <= CURRENT_DATE
        AND s.shoot_date >= CURRENT_DATE - INTERVAL '14 days'
      ORDER BY s.shoot_date DESC
      LIMIT 1`,
    [tenantId]
  );
  expect(shootRow.rows.length).toBe(1);
  shootId = shootRow.rows[0].id;
  shootDate = shootRow.rows[0].shoot_date;
  const locationId = shootRow.rows[0].location_id;

  // Re-runnable: clear any prior fixture rows.
  await pool.query(
    `DELETE FROM post_shoot_evaluation WHERE tenant_id = $1 AND shift_id IN (SELECT id FROM work_shift WHERE tenant_id = $1 AND title = $2)`,
    [tenantId, SHIFT_MARKER]
  );
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);

  const starts = `${shootDate}T09:00:00Z`;
  const ends = `${shootDate}T15:00:00Z`;
  async function insertShift(userId: string, role: string, leadCoverage: boolean, cancelled: boolean) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO work_shift (tenant_id, title, starts_at, ends_at, assigned_user_id, shift_kind, shoot_id, staffing_role, satisfies_lead_coverage, cancelled_at, location_name)
       VALUES ($1, $2, $3, $4, $5, 'shoot', $6, $7::staffing_role_code, $8, $9, 'PSEO Test Location')
       RETURNING id`,
      [tenantId, SHIFT_MARKER, starts, ends, userId, shootId, role, leadCoverage, cancelled ? new Date().toISOString() : null]
    );
    return rows[0].id;
  }
  // Standard photographer (owes a standard eval), a senior (owes the lead eval), and a
  // cancelled assignment (owes nothing).
  standardShiftId = await insertShift(photographerId, "photographer", false, false);
  leadShiftId = await insertShift(seniorId, "senior_photographer", true, false);
  cancelledShiftId = await insertShift(seniorId, "photographer", false, true);

  // The standard photographer submits their eval (minimal NOT NULL column set).
  const evalRow = await pool.query<{ id: string }>(
    `INSERT INTO post_shoot_evaluation
       (tenant_id, location_id, shoot_id, shift_id, photographer_user_id, shoot_name, shoot_date, photographer_name, shoot_type, on_time, easy_access, overall_rating, photos_uploaded)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [tenantId, locationId, shootId, standardShiftId, photographerId, SHIFT_MARKER, shootDate, "PSEO Test Photographer", "school", "yes", "yes", 5, "yes"]
  );
  evaluationId = evalRow.rows[0].id;
});

afterAll(async () => {
  if (evaluationId) {
    await pool.query("DELETE FROM post_shoot_evaluation WHERE id = $1", [evaluationId]);
  }
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);
});

describe("post-shoot evaluation obligations", () => {
  it("derives one obligation per assigned photographer and excludes cancelled shifts", async () => {
    const res = await authed(`/api/post-shoot/evaluation-obligations?shoot_id=${shootId}`, leadershipToken);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((item: { shift_id: string }) => item.shift_id);
    expect(ids).toContain(standardShiftId);
    expect(ids).toContain(leadShiftId);
    expect(ids).not.toContain(cancelledShiftId);
  });

  it("marks the submitted photographer submitted and the missing one required, with honest mileage blocking", async () => {
    const res = await authed(`/api/post-shoot/evaluation-obligations?shoot_id=${shootId}`, leadershipToken);
    const byShift = new Map(res.body.items.map((item: { shift_id: string }) => [item.shift_id, item]));
    const standard = byShift.get(standardShiftId) as Record<string, unknown>;
    const lead = byShift.get(leadShiftId) as Record<string, unknown>;
    expect(standard.status).toBe("submitted");
    expect(standard.blocks_mileage).toBe(false);
    expect(standard.submitted_at).toBeTruthy();
    expect(lead.status).toBe("required");
    expect(lead.blocks_mileage).toBe(true);
    // destination follows the verified staffing-drawer deep-link convention
    expect(lead.exact_destination_hash).toBe(`#operations/staffing?date=${shootDate}&shoot=${shootId}`);
  });

  it("assigns the lead template to lead coverage / senior roles and standard to everyone else", async () => {
    const res = await authed(`/api/post-shoot/evaluation-obligations?shoot_id=${shootId}`, leadershipToken);
    const byShift = new Map(res.body.items.map((item: { shift_id: string }) => [item.shift_id, item]));
    expect((byShift.get(standardShiftId) as Record<string, unknown>).template_type).toBe("standard");
    expect((byShift.get(leadShiftId) as Record<string, unknown>).template_type).toBe("lead_10_question");
  });

  it("keeps every summary count equal to its matching rows (count==rows invariant)", async () => {
    const res = await authed(`/api/post-shoot/evaluation-obligations?shoot_id=${shootId}`, leadershipToken);
    const items = res.body.items as Array<{ status: string; is_lead: boolean; employee_id: string; shoot_id: string }>;
    const summary = res.body.summary;
    expect(summary.total_obligations).toBe(items.length);
    expect(summary.submitted_count).toBe(items.filter((i) => i.status === "submitted").length);
    expect(summary.outstanding_count).toBe(items.filter((i) => i.status === "required").length);
    expect(summary.outstanding_lead_count).toBe(items.filter((i) => i.status === "required" && i.is_lead).length);
    expect(summary.mileage_blocked_photographer_count).toBe(
      new Set(items.filter((i) => i.status === "required").map((i) => i.employee_id)).size
    );
    expect(summary.shoots_covered).toBe(new Set(items.map((i) => i.shoot_id)).size);
    expect(res.body.items_total).toBe(items.length);
  });

  it("enforces access: no token 401; non-manager employee 403", async () => {
    const anon = await request(app).get("/api/post-shoot/evaluation-obligations");
    expect(anon.status).toBe(401);
    const employee = await authed("/api/post-shoot/evaluation-obligations", employeeToken);
    expect(employee.status).toBe(403);
  });

  it("rejects malformed queries honestly", async () => {
    const res = await authed("/api/post-shoot/evaluation-obligations?window_days=999", leadershipToken);
    expect(res.status).toBe(400);
  });
});
