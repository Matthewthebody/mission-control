import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { recalculateMileageForEmployeeDate } from "../src/services/timeClockMileage.js";
import { devLogin, getMembershipId } from "./helpers.js";

// SSA-3 — mileage eligibility response after post-shoot eval. The answer's canonical home is the
// photographer's own post_shoot_evaluation (submit_for_mileage/vehicle_type); the canonical recalc
// derives mileage_reimbursement.status. Fixtures use a shoot date where the photographer has no
// OTHER shoot shifts, so the recalc sees only test-controlled inputs; afterAll deletes fixtures and
// re-runs the recalc so the real demo mileage row for that (employee, date) is restored.

const app = createApp();
const SHIFT_MARKER = "PSME-TEST-SHIFT";

let photographerToken = "";
let seniorToken = "";
let tenantId = "";
let photographerId = "";
let seniorId = "";
let shootId = "";
let shootDate = "";
let photographerShiftId = "";

function post(token: string | null, body: Record<string, unknown>) {
  const req = request(app).post("/api/post-shoot/mileage-eligibility").send(body);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

async function restoreMileage(employeeId: string) {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    await recalculateMileageForEmployeeDate(client, {
      tenantId,
      employeeId,
      workDate: shootDate,
      actorUserId: null,
      reason: "Test fixture cleanup recalculation"
    });
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  seniorToken = (await devLogin(app, "senior@example.com")).body.token;
  photographerId = (await getMembershipId("photo@example.com")) as string;
  seniorId = (await getMembershipId("senior@example.com")) as string;
  const tenantRow = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM app_user WHERE id = $1 LIMIT 1",
    [photographerId]
  );
  tenantId = tenantRow.rows[0].tenant_id;

  // The most recent date where the photographer has NO other shoot shifts — the
  // recalc must see only our fixtures. The window reaches far back because the
  // shared dev DB accretes fixture shifts on every recent date.
  const dateRow = await pool.query<{ d: string }>(
    `SELECT d::date::text AS d
       FROM generate_series(CURRENT_DATE - 365, CURRENT_DATE, interval '1 day') AS g(d)
      WHERE NOT EXISTS (
        SELECT 1 FROM work_shift ws
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id = $2
          AND ws.shift_kind = 'shoot'
          AND ws.cancelled_at IS NULL
          AND COALESCE((SELECT sx.shoot_date FROM shoot sx WHERE sx.id = ws.shoot_id), ws.starts_at::date) = g.d::date
      )
      ORDER BY g.d DESC
      LIMIT 1`,
    [tenantId, photographerId]
  );
  expect(dateRow.rows.length).toBe(1);
  shootDate = dateRow.rows[0].d;

  // Re-runnable cleanup of prior fixture rows (shifts and eval reference the shoot).
  await pool.query(
    `DELETE FROM post_shoot_evaluation WHERE tenant_id = $1 AND shoot_name = $2`,
    [tenantId, SHIFT_MARKER]
  );
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);
  await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);

  // Our own published shoot (with the canonical location post_shoot_evaluation requires),
  // cloned from any real published shoot so NOT NULL columns carry over — the suite must
  // not depend on the demo seed still having a shoot inside the recent window.
  const shootRow = await pool.query<{ id: string; location_id: string }>(
    `INSERT INTO shoot (
        tenant_id, studio_id, shoot_code, title, shoot_date, location_id, location_name,
        location_address, location_lat, location_lng, geofence_radius_meters, showtime,
        arrival_time, start_time, end_time_est, projected_students, record_state, created_by
      )
      SELECT tenant_id, studio_id, $2, $3, $4::date, location_id, location_name,
        location_address, location_lat, location_lng, geofence_radius_meters, showtime,
        arrival_time, start_time, end_time_est, projected_students, 'published', created_by
      FROM shoot
      WHERE tenant_id = $1 AND record_state = 'published' AND deleted_at IS NULL AND location_id IS NOT NULL
      ORDER BY shoot_date DESC
      LIMIT 1
      RETURNING id, location_id`,
    [tenantId, "PSME-TEST", SHIFT_MARKER, shootDate]
  );
  expect(shootRow.rows.length).toBe(1);
  shootId = shootRow.rows[0].id;
  const locationId = shootRow.rows[0].location_id;

  const starts = `${shootDate}T09:00:00Z`;
  const ends = `${shootDate}T15:00:00Z`;
  async function insertShift(userId: string) {
    await pool.query(
      `INSERT INTO work_shift (tenant_id, title, starts_at, ends_at, assigned_user_id, shift_kind, shoot_id, staffing_role, satisfies_lead_coverage, location_name)
       VALUES ($1, $2, $3, $4, $5, 'shoot', $6, 'photographer'::staffing_role_code, false, 'PSME Test Location')`,
      [tenantId, SHIFT_MARKER, starts, ends, userId, shootId]
    );
  }
  // Photographer worked the shoot AND has an eval; senior worked it but has NO eval.
  await insertShift(photographerId);
  await insertShift(seniorId);
  const shiftRow = await pool.query<{ id: string }>(
    `SELECT id FROM work_shift WHERE tenant_id = $1 AND title = $2 AND assigned_user_id = $3 LIMIT 1`,
    [tenantId, SHIFT_MARKER, photographerId]
  );
  photographerShiftId = shiftRow.rows[0].id;
  await pool.query(
    `INSERT INTO post_shoot_evaluation
       (tenant_id, location_id, shoot_id, shift_id, photographer_user_id, shoot_name, shoot_date, photographer_name, shoot_type, on_time, easy_access, overall_rating, photos_uploaded)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13)`,
    [tenantId, locationId, shootId, shiftRow.rows[0].id, photographerId, SHIFT_MARKER, shootDate, "PSME Test Photographer", "school", "yes", "yes", 5, "yes"]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM post_shoot_evaluation WHERE tenant_id = $1 AND shoot_name = $2`, [tenantId, SHIFT_MARKER]);
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);
  await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);
  // Recompute canonical mileage from the remaining REAL data so the demo row is restored.
  await restoreMileage(photographerId);
  await restoreMileage(seniorId);
});

describe("mileage eligibility response", () => {
  it("rejects recording before a post-shoot evaluation exists (the core rule)", async () => {
    // The senior worked the shoot but has no eval — their own answer must be refused.
    const res = await post(seniorToken, { shoot_id: shootId, eligible: true, vehicle_type: "personal_vehicle" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/evaluation is required/i);
  });

  it("an unanswered evaluation is answer_pending, never silently declined (C7)", async () => {
    // Only one ACTIVE profile may exist per employee — temporarily backdate the
    // live one so it covers the historical fixture date, restored in finally.
    const original = await pool.query<{ id: string; effective_date: string }>(
      `SELECT id, effective_date::text AS effective_date FROM employee_pay_profile
       WHERE tenant_id = $1 AND employee_id = $2 AND active_status = true LIMIT 1`,
      [tenantId, photographerId]
    );
    expect(original.rows.length).toBe(1);
    await pool.query("UPDATE employee_pay_profile SET effective_date = '2000-01-01' WHERE id = $1", [
      original.rows[0].id
    ]);
    try {
      await restoreMileage(photographerId);
      const row = await pool.query<{ status: string; review_reason_code: string | null }>(
        `SELECT status::text, review_reason_code::text
         FROM mileage_reimbursement
         WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date`,
        [tenantId, photographerId, shootDate]
      );
      expect(row.rows[0]?.status).toBe("review_required");
      expect(row.rows[0]?.review_reason_code).toBe("answer_pending");
    } finally {
      await pool.query("UPDATE employee_pay_profile SET effective_date = $2::date WHERE id = $1", [
        original.rows[0].id,
        original.rows[0].effective_date
      ]);
    }
  });

  it("records declined honestly: canonical status is never payable", async () => {
    const res = await post(photographerToken, { shoot_id: shootId, eligible: false });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe("declined");
    expect(res.body.vehicle_type).toBeNull();
    // Canonical readiness after recalc: declined must never be a payable status.
    expect(res.body.mileage).toBeTruthy();
    expect(["candidate", "approved", "exported"]).not.toContain(res.body.mileage.status);
    // The answer's canonical home is the eval row itself.
    const evalRow = await pool.query<{ submit_for_mileage: boolean; vehicle_type: string | null }>(
      `SELECT submit_for_mileage, vehicle_type::text AS vehicle_type FROM post_shoot_evaluation WHERE tenant_id = $1 AND shoot_name = $2`,
      [tenantId, SHIFT_MARKER]
    );
    expect(evalRow.rows[0].submit_for_mileage).toBe(false);
    expect(evalRow.rows[0].vehicle_type).toBeNull();
  });

  it("is idempotent: repeating the same answer changes nothing", async () => {
    const first = await post(photographerToken, { shoot_id: shootId, eligible: false });
    const second = await post(photographerToken, { shoot_id: shootId, eligible: false });
    expect(second.status).toBe(200);
    expect(second.body.recorded).toBe(first.body.recorded);
    expect(second.body.mileage?.status).toBe(first.body.mileage?.status);
    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date`,
      [tenantId, photographerId, shootDate]
    );
    expect(Number(count.rows[0].n)).toBeLessThanOrEqual(1);
  });

  it("supports changing the answer: eligible=true updates the eval and recalculates", async () => {
    const res = await post(photographerToken, { shoot_id: shootId, eligible: true, vehicle_type: "personal_vehicle" });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe("eligible");
    expect(res.body.vehicle_type).toBe("personal_vehicle");
    const evalRow = await pool.query<{ submit_for_mileage: boolean; vehicle_type: string }>(
      `SELECT submit_for_mileage, vehicle_type::text AS vehicle_type FROM post_shoot_evaluation WHERE tenant_id = $1 AND shoot_name = $2`,
      [tenantId, SHIFT_MARKER]
    );
    expect(evalRow.rows[0].submit_for_mileage).toBe(true);
    expect(evalRow.rows[0].vehicle_type).toBe("personal_vehicle");
    // Still never payable from this endpoint: approved/exported are G3 review actions.
    expect(["approved", "exported"]).not.toContain(res.body.mileage?.status);
  });

  it("requires vehicle_type when eligible and rejects unknown fields", async () => {
    const missingVehicle = await post(photographerToken, { shoot_id: shootId, eligible: true });
    expect(missingVehicle.status).toBe(400);
    // No employee_id parameter exists — answering for someone else is structurally impossible.
    const foreign = await post(photographerToken, {
      shoot_id: shootId,
      eligible: false,
      employee_id: seniorId
    });
    expect(foreign.status).toBe(400);
  });

  it("accepts shift_id as the precise identifier (the mobile modal's key)", async () => {
    const res = await post(photographerToken, {
      shift_id: photographerShiftId,
      eligible: true,
      vehicle_type: "personal_vehicle"
    });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe("eligible");
    expect(res.body.shoot_id).toBe(shootId);
    // exactly one identifier is required
    const both = await post(photographerToken, {
      shoot_id: shootId,
      shift_id: photographerShiftId,
      eligible: false
    });
    expect(both.status).toBe(400);
    const neither = await post(photographerToken, { eligible: false });
    expect(neither.status).toBe(400);
  });

  it("refuses to touch approved/exported (payable) mileage — the G3 boundary is enforced", async () => {
    // Simulate payroll having approved this date's mileage (no product writer exists yet — G3).
    await pool.query(
      `UPDATE mileage_reimbursement SET status = 'approved' WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date`,
      [tenantId, photographerId, shootDate]
    );
    const res = await post(photographerToken, { shoot_id: shootId, eligible: false });
    expect(res.status).toBe(409);
    expect(res.body.details?.code ?? res.body.code).toBe("mileage_already_processed");
    // The payable status was NOT overwritten.
    const after = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date`,
      [tenantId, photographerId, shootDate]
    );
    expect(after.rows[0].status).toBe("approved");
    // afterAll's restoreMileage recalc returns the row to its derived state.
  });

  it("requires auth", async () => {
    const res = await post(null, { shoot_id: shootId, eligible: false });
    expect(res.status).toBe(401);
  });
});
