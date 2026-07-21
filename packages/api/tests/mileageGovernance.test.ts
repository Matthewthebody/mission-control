import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId } from "./helpers.js";

// G3 — the approved/exported writer + per-period reconciliation. The fixture is
// a directly-inserted canonical row on an ancient date no demo/live flow
// touches, deleted in afterAll (no recalc restore needed: the date has no real
// shifts or evaluations).

const app = createApp();
const WORK_DATE = "2024-02-13";

let leadershipToken = "";
let ownerToken = "";
let photographerToken = "";
let employeeId = "";
let tenantId = "";
let reimbursementId = "";

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  ownerToken = (await devLogin(app, "matthew@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  employeeId = (await getMembershipId("photo@example.com")) as string;
  tenantId = (
    await pool.query<{ tenant_id: string }>("SELECT tenant_id FROM app_user WHERE id = $1 LIMIT 1", [employeeId])
  ).rows[0].tenant_id;

  await pool.query("DELETE FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date", [
    tenantId,
    employeeId,
    WORK_DATE
  ]);
  reimbursementId = (
    await pool.query<{ id: string }>(
      `INSERT INTO mileage_reimbursement (tenant_id, employee_id, work_date, status, reimbursement_amount)
       VALUES ($1, $2, $3::date, 'candidate', 25.50) RETURNING id`,
      [tenantId, employeeId, WORK_DATE]
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date", [
    tenantId,
    employeeId,
    WORK_DATE
  ]);
});

describe("mileage governance (G3 approved/exported writer)", () => {
  it("field roles cannot approve", async () => {
    const res = await request(app)
      .post(`/api/attendance/mileage-reimbursements/${reimbursementId}/approve`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({});
    expect([401, 403]).toContain(res.status);
  });

  it("payroll managers approve a candidate; re-approval 409s; export is owner-only", async () => {
    const approved = await request(app)
      .post(`/api/attendance/mileage-reimbursements/${reimbursementId}/approve`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ reason: "Reviewed in G3 governance test" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");

    const reApproved = await request(app)
      .post(`/api/attendance/mileage-reimbursements/${reimbursementId}/approve`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(reApproved.status).toBe(409);
    expect(reApproved.body.details?.code ?? reApproved.body.code).toBe("mileage_invalid_transition");

    const leadershipExport = await request(app)
      .post(`/api/attendance/mileage-reimbursements/${reimbursementId}/mark-exported`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(leadershipExport.status).toBe(403);

    const ownerExport = await request(app)
      .post(`/api/attendance/mileage-reimbursements/${reimbursementId}/mark-exported`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(ownerExport.status).toBe(200);
    expect(ownerExport.body.status).toBe("exported");

    const reExport = await request(app)
      .post(`/api/attendance/mileage-reimbursements/${reimbursementId}/mark-exported`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(reExport.status).toBe(409);
  });

  it("per-period reconciliation reports the canonical row with honest legacy comparison", async () => {
    const res = await request(app)
      .get(`/api/attendance/mileage-reconciliation?date=${WORK_DATE}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(res.status).toBe(200);
    expect(res.body.period_start <= WORK_DATE && WORK_DATE <= res.body.period_end).toBe(true);
    expect(res.body.source.canonical).toBe("mileage_reimbursement");
    const row = res.body.rows.find((entry: { employee_id: string }) => entry.employee_id === employeeId);
    expect(row).toBeTruthy();
    expect(Number(row.canonical_total)).toBeCloseTo(25.5, 2);
    expect(Number(row.legacy_total)).toBe(0);
    expect(row.amount_match).toBe(false); // canonical-only period — honestly a mismatch
    expect(res.body.employee_count).toBe(res.body.rows.length); // count == rows invariant
  });

  it("reconciliation is payroll-manager gated", async () => {
    const res = await request(app)
      .get(`/api/attendance/mileage-reconciliation?date=${WORK_DATE}`)
      .set("Authorization", `Bearer ${photographerToken}`);
    expect([401, 403]).toContain(res.status);
  });
});
