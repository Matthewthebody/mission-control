import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

// June 18 feedback — auditable Shoot date-change workflow. Creating a request never mutates the
// Shoot; the booked date is immutable history; approval applies the change and preserves the
// original; idempotent retry; leadership-gated decisions; tenant isolation; full audit trail.

const app = createApp();
const STUDIO_ID = "934153b5-49f9-451f-b8de-03a9a80bd06b";
const CROSS_TENANT = "86fd9cf6-f6cc-4405-89ac-71c712223126";
const stamp = Date.now();
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";
let shootId = "";
const ORIGINAL_DATE = "2026-09-01";
const REQUESTED_DATE = "2026-09-15";

function req(token: string) {
  return (m: "get" | "post", path: string, body?: unknown) => {
    const r = request(app)[m](`/api/shoots/date-change-requests${path}`).set("Authorization", `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
}

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`)).body.user.tenantId;
  shootId = (
    await pool.query<{ id: string }>(
      `INSERT INTO shoot (tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_lat, location_lng, arrival_time, start_time, end_time_est, record_state, department)
       VALUES ($1,$2,$3,$4,$5::date,'Fixture Gym',45.0,-93.4, ($5::date + time '07:30') AT TIME ZONE 'America/Chicago', ($5::date + time '08:00') AT TIME ZONE 'America/Chicago', ($5::date + time '12:00') AT TIME ZONE 'America/Chicago', 'published','schools')
       RETURNING id::text`,
      [tenantId, STUDIO_ID, `DCR-${stamp}`, `Date Change Fixture ${stamp}`, ORIGINAL_DATE]
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM shoot_date_change_event WHERE request_id IN (SELECT id FROM shoot_date_change_request WHERE shoot_id=$1)`, [shootId]);
  await pool.query(`DELETE FROM shoot_date_change_request WHERE shoot_id=$1`, [shootId]);
  await pool.query(`DELETE FROM shoot WHERE id=$1`, [shootId]);
});

describe("June 18 — auditable shoot date-change workflow", () => {
  it("(1/2/3) creates a request and does NOT mutate the shoot date; original is captured immutably", async () => {
    const res = await req(leadershipToken)("post", "/", { shoot_id: shootId, requested_shoot_date: REQUESTED_DATE, request_reason: "Gym double-booked", idempotency_key: `dcr-${stamp}` });
    expect(res.status).toBe(201);
    expect(res.body.request.original_shoot_date.slice(0, 10)).toBe(ORIGINAL_DATE);
    expect(res.body.request.requested_shoot_date.slice(0, 10)).toBe(REQUESTED_DATE);
    expect(res.body.request.current_status).toBe("requested");
    // the shoot date is UNCHANGED — a request is not a mutation
    const shoot = (await pool.query(`SELECT shoot_date::text FROM shoot WHERE id=$1`, [shootId])).rows[0];
    expect(shoot.shoot_date).toBe(ORIGINAL_DATE);
  });

  it("(4) idempotent retry returns the same request, never a duplicate", async () => {
    const res = await req(leadershipToken)("post", "/", { shoot_id: shootId, requested_shoot_date: REQUESTED_DATE, idempotency_key: `dcr-${stamp}` });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_date_change_request WHERE idempotency_key=$1`, [`dcr-${stamp}`])).rows[0].n).toBe(1);
  });

  it("(5/8) feasibility reuses canonical data and reports equipment honestly unavailable", async () => {
    const requestId = (await pool.query(`SELECT id::text FROM shoot_date_change_request WHERE shoot_id=$1 ORDER BY created_at LIMIT 1`, [shootId])).rows[0].id;
    const res = await req(leadershipToken)("post", `/${requestId}/feasibility`);
    expect(res.status).toBe(200);
    expect(res.body.equipment_result).toBe("unavailable"); // no canonical equipment source — never fabricated
    expect(["ok", "conflict"]).toContain(res.body.schedule_conflict_result);
    expect(res.body.staffing_result).toBe("review_required");
    const reqRow = (await pool.query(`SELECT current_status FROM shoot_date_change_request WHERE id=$1`, [requestId])).rows[0];
    expect(reqRow.current_status).toBe("feasibility_review");
  });

  it("(9) records documented alternatives", async () => {
    const requestId = (await pool.query(`SELECT id::text FROM shoot_date_change_request WHERE shoot_id=$1 ORDER BY created_at LIMIT 1`, [shootId])).rows[0].id;
    const res = await req(leadershipToken)("post", `/${requestId}/alternatives`, { alternative: { type: "later_picture_day", date: "2026-10-01" } });
    expect(res.status).toBe(200);
    const row = (await pool.query(`SELECT alternatives_offered FROM shoot_date_change_request WHERE id=$1`, [requestId])).rows[0];
    expect(row.alternatives_offered.length).toBe(1);
    expect(row.alternatives_offered[0].type).toBe("later_picture_day");
  });

  it("(17/18) decision is leadership-gated — a read-only user is denied", async () => {
    const requestId = (await pool.query(`SELECT id::text FROM shoot_date_change_request WHERE shoot_id=$1 ORDER BY created_at LIMIT 1`, [shootId])).rows[0].id;
    const res = await req(photographerToken)("post", `/${requestId}/decision`, { decision: "approved" });
    expect(res.status).toBe(403);
  });

  it("(11/12/22) approval applies the change to the shoot AND preserves the original date in history", async () => {
    const requestId = (await pool.query(`SELECT id::text FROM shoot_date_change_request WHERE shoot_id=$1 ORDER BY created_at LIMIT 1`, [shootId])).rows[0].id;
    const res = await req(leadershipToken)("post", `/${requestId}/decision`, { decision: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("approved");
    expect(res.body.final_shoot_date.slice(0, 10)).toBe(REQUESTED_DATE);
    // the shoot is now on the requested date (canonical mutation applied)
    expect((await pool.query(`SELECT shoot_date::text FROM shoot WHERE id=$1`, [shootId])).rows[0].shoot_date).toBe(REQUESTED_DATE);
    // the ORIGINAL date remains in the request row + the audit log (immutable history)
    const row = (await pool.query(`SELECT original_shoot_date::text, current_status FROM shoot_date_change_request WHERE id=$1`, [requestId])).rows[0];
    expect(row.original_shoot_date).toBe(ORIGINAL_DATE);
    expect(row.current_status).toBe("completed");
    const events = (await pool.query(`SELECT event_type FROM shoot_date_change_event WHERE request_id=$1 ORDER BY created_at`, [requestId])).rows.map((e: any) => e.event_type);
    expect(events).toEqual(expect.arrayContaining(["created", "feasibility", "alternative", "decision"]));
  });

  it("(16) transition audit + (13) decline retains the request", async () => {
    // a second request, declined, is retained with its history
    const created = await req(leadershipToken)("post", "/", { shoot_id: shootId, requested_shoot_date: "2026-09-20" });
    const id = created.body.request.id;
    await req(leadershipToken)("post", `/${id}/transition`, { to_status: "feasibility_review", reason: "review" });
    const declined = await req(leadershipToken)("post", `/${id}/decision`, { decision: "declined", reason: "client withdrew" });
    expect(declined.status).toBe(200);
    const detail = await req(leadershipToken)("get", `/${id}`);
    expect(detail.body.request.current_status).toBe("declined");
    expect(detail.body.events.length).toBeGreaterThanOrEqual(3);
  });

  it("(19) tenant isolation — a cross-tenant shoot id cannot create a request", async () => {
    const xShoot = (
      await pool.query<{ id: string }>(
        `INSERT INTO shoot (tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_lat, location_lng, arrival_time, start_time, end_time_est, record_state, department)
         VALUES ($1, $3, $2, 'X', '2026-09-01', 'X', 1, 1, now(), now(), now() + interval '4 hours', 'published','schools') RETURNING id::text`,
        [CROSS_TENANT, `XDCR-${stamp}`, STUDIO_ID]
      )
    ).rows[0].id;
    const res = await req(leadershipToken)("post", "/", { shoot_id: xShoot, requested_shoot_date: REQUESTED_DATE });
    expect(res.status).toBe(404); // not visible in this tenant
    await pool.query(`DELETE FROM shoot WHERE id=$1`, [xShoot]);
  });
});
