import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId } from "./helpers.js";

// G2 Slice D — canonical hours reconciliation on the operations dashboard. Legacy actual_hours
// (time_entry-derived) is untouched; actual_hours_canonical comes from the single-writer
// time_session_payroll_summary linked via time_session.source_shift_id; NULL = honestly
// unavailable, never zero. Fixtures live on a date with no other shifts so the payload-level
// reconciliation counts are exact; three distinct employees prevent legacy (shoot,user)
// cross-counting.

const app = createApp();
const SHIFT_MARKER = "G2D-TEST-SHIFT";

let adminToken = "";
let tenantId = "";
let fixtureDate = "";
let shootId = "";
const employees: Record<"divergent" | "matched" | "canonicalless", string> = {
  divergent: "",
  matched: "",
  canonicalless: ""
};
const shiftIds: Record<"divergent" | "matched" | "canonicalless", string> = {
  divergent: "",
  matched: "",
  canonicalless: ""
};

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  employees.divergent = (await getMembershipId("photo@example.com")) as string;
  employees.matched = (await getMembershipId("senior@example.com")) as string;
  employees.canonicalless = (await getMembershipId("graphic@example.com")) as string;
  const tenantRow = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM app_user WHERE id = $1 LIMIT 1",
    [employees.divergent]
  );
  tenantId = tenantRow.rows[0].tenant_id;

  // A past date with zero existing shifts, so the reconciliation block is exactly ours.
  const dateRow = await pool.query<{ d: string }>(
    `
      SELECT d::date::text AS d
      FROM generate_series(CURRENT_DATE - 90, CURRENT_DATE - 30, interval '1 day') AS g(d)
      WHERE NOT EXISTS (
        SELECT 1 FROM work_shift ws WHERE ws.tenant_id = $1 AND ws.starts_at::date = g.d::date
      )
      ORDER BY g.d DESC
      LIMIT 1
    `,
    [tenantId]
  );
  expect(dateRow.rows.length).toBe(1);
  fixtureDate = dateRow.rows[0].d;

  // A shoot with no existing time_entry rows for our three users (legacy hours key on shoot+user).
  const shootRow = await pool.query<{ id: string }>(
    `
      SELECT s.id
      FROM shoot s
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM time_entry te
          WHERE te.tenant_id = s.tenant_id AND te.shoot_id = s.id AND te.user_id = ANY($2::uuid[])
        )
      LIMIT 1
    `,
    [tenantId, [employees.divergent, employees.matched, employees.canonicalless]]
  );
  expect(shootRow.rows.length).toBe(1);
  shootId = shootRow.rows[0].id;

  await cleanupFixtures();

  async function seedCase(
    key: "divergent" | "matched" | "canonicalless",
    legacyMinutes: number,
    payableMinutes: number | null
  ) {
    const shift = await pool.query<{ id: string }>(
      `INSERT INTO work_shift (tenant_id, title, starts_at, ends_at, assigned_user_id, shift_kind, shoot_id, staffing_role, satisfies_lead_coverage, location_name)
       VALUES ($1, $2, $3, $4, $5, 'shoot', $6, 'photographer'::staffing_role_code, false, 'G2D Test Location')
       RETURNING id`,
      [tenantId, SHIFT_MARKER, `${fixtureDate}T09:00:00Z`, `${fixtureDate}T17:00:00Z`, employees[key], shootId]
    );
    shiftIds[key] = shift.rows[0].id;
    await pool.query(
      `INSERT INTO time_entry (tenant_id, shoot_id, user_id, clock_in_at, minutes_worked)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, shootId, employees[key], `${fixtureDate}T09:00:00Z`, legacyMinutes]
    );
    if (payableMinutes != null) {
      const session = await pool.query<{ id: string }>(
        `INSERT INTO time_session (tenant_id, employee_id, work_date, status, source_shift_id)
         VALUES ($1, $2, $3::date, 'closed', $4)
         RETURNING id`,
        [tenantId, employees[key], fixtureDate, shiftIds[key]]
      );
      await pool.query(
        `INSERT INTO time_session_payroll_summary (tenant_id, session_id, employee_id, work_date, payable_minutes)
         VALUES ($1, $2, $3, $4::date, $5)`,
        [tenantId, session.rows[0].id, employees[key], fixtureDate, payableMinutes]
      );
    }
  }

  await seedCase("divergent", 480, 450); // legacy 8h vs canonical 7.5h -> mismatch, delta 0.5
  await seedCase("matched", 360, 360); // legacy 6h == canonical 6h -> matched
  await seedCase("canonicalless", 240, null); // legacy only -> canonical honestly unavailable
});

async function cleanupFixtures() {
  await pool.query(
    `DELETE FROM time_session_payroll_summary WHERE tenant_id = $1 AND session_id IN (
       SELECT id FROM time_session WHERE tenant_id = $1 AND source_shift_id IN (
         SELECT id FROM work_shift WHERE tenant_id = $1 AND title = $2
       )
     )`,
    [tenantId, SHIFT_MARKER]
  );
  await pool.query(
    `DELETE FROM time_session WHERE tenant_id = $1 AND source_shift_id IN (
       SELECT id FROM work_shift WHERE tenant_id = $1 AND title = $2
     )`,
    [tenantId, SHIFT_MARKER]
  );
  await pool.query(
    `DELETE FROM time_entry WHERE tenant_id = $1 AND shoot_id = $2 AND user_id = ANY($3::uuid[])`,
    [tenantId, shootId, [employees.divergent, employees.matched, employees.canonicalless]]
  );
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = $2", [tenantId, SHIFT_MARKER]);
}

afterAll(async () => {
  await cleanupFixtures();
});

async function fetchDashboard() {
  const res = await request(app)
    .get(`/api/dashboard/operations?date=${fixtureDate}`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body as {
    hours_reconciliation: {
      legacy_hours_total: number;
      canonical_hours_total: number;
      comparable_shift_count: number;
      mismatch_shift_count: number;
      canonical_unavailable_shift_count: number;
      status: string;
      source: { legacy: string; canonical: string };
    } | null;
    shifts: Array<Record<string, unknown>>;
  };
}

describe("operations dashboard canonical hours (G2 slice D)", () => {
  it("keeps legacy actual_hours untouched while emitting canonical hours and per-shift deltas", async () => {
    const body = await fetchDashboard();
    const byId = new Map(body.shifts.map((row) => [row.id, row]));
    const divergent = byId.get(shiftIds.divergent) as Record<string, unknown>;
    const matched = byId.get(shiftIds.matched) as Record<string, unknown>;
    expect(Number(divergent.actual_hours)).toBeCloseTo(8, 2); // legacy untouched
    expect(Number(divergent.actual_hours_canonical)).toBeCloseTo(7.5, 2);
    expect(Number(divergent.hours_source_delta)).toBeCloseTo(0.5, 2);
    expect(Number(matched.actual_hours)).toBeCloseTo(6, 2);
    expect(Number(matched.actual_hours_canonical)).toBeCloseTo(6, 2);
    expect(Number(matched.hours_source_delta)).toBeCloseTo(0, 2);
  });

  it("returns honest NULL canonical state when no linked session/summary exists — never a fake zero", async () => {
    const body = await fetchDashboard();
    const row = body.shifts.find((shift) => shift.id === shiftIds.canonicalless) as Record<string, unknown>;
    expect(Number(row.actual_hours)).toBeCloseTo(4, 2);
    expect(row.actual_hours_canonical).toBeNull();
    expect(row.hours_source_delta).toBeNull();
  });

  it("emits a payload-level reconciliation whose counts equal the returned rows", async () => {
    const body = await fetchDashboard();
    const rec = body.hours_reconciliation;
    expect(rec).toBeTruthy();
    expect(rec!.comparable_shift_count).toBe(2);
    expect(rec!.mismatch_shift_count).toBe(1);
    expect(rec!.canonical_unavailable_shift_count).toBe(1);
    expect(rec!.status).toBe("mismatch");
    expect(rec!.legacy_hours_total).toBeCloseTo(18, 2); // 8 + 6 + 4
    expect(rec!.canonical_hours_total).toBeCloseTo(13.5, 2); // 7.5 + 6
    expect(rec!.source.legacy).toContain("time_entry");
    expect(rec!.source.canonical).toContain("time_session_payroll_summary");
  });
});
