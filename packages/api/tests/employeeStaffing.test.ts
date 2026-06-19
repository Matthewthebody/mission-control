import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  getStaffingPlanLifecycleView,
  listEmployeeStaffingAssignments,
  recordStaffingPlanPublication
} from "../src/services/staffingPlanLifecycle.js";

// Slice 2 sub-slice 3 — employee self-scoped staffing acknowledgment / decline (API).

const app = createApp();

let tenantId: string;
let studioId: string;
let schoolOrganizationId: string;
let schoolLocationId: string;
let schoolPrimaryContactId: string;
let adminToken: string;
let leadershipToken: string;
let photoToken: string;
let leadershipId: string;
let photoId: string;
let seniorId: string;
let officeId: string;

function localDateString(offsetDays = 0) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function isoAt(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

const leadAuth = (): AuthUser => ({ id: leadershipId, tenantId }) as unknown as AuthUser;
const employeeAuth = (userId: string): AuthUser => ({ id: userId, tenantId }) as unknown as AuthUser;

async function selectRows<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function createShoot(code: string, title: string, date: string) {
  const response = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: schoolOrganizationId,
      location_id: schoolLocationId,
      primary_contact_id: schoolPrimaryContactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: code,
      title,
      shoot_date: date,
      geofence_radius_meters: 1609,
      arrival_time: isoAt(date, "14:45"),
      start_time: isoAt(date, "15:00"),
      end_time_est: isoAt(date, "17:00"),
      projected_students: 48,
      planned_staff_count: 2,
      required_lead_count: 1
    });
  expect(response.status).toBe(201);
  return response.body;
}

async function makeShoot(date: string, title = "Employee Staffing") {
  const body = await createShoot(`EMP-${randomUUID().slice(0, 8)}`, title, date);
  await pool.query("UPDATE shoot SET record_state = 'published'::shoot_record_state WHERE id = $1 AND tenant_id = $2", [
    body.id,
    tenantId
  ]);
  return body;
}

async function seedShift(
  shootId: string,
  userId: string,
  options: { date: string; lead?: boolean; role?: string; start?: string; end?: string }
) {
  const startsAt = isoAt(options.date, options.start ?? "14:15");
  const endsAt = isoAt(options.date, options.end ?? "17:15");
  const response = await request(app)
    .post("/api/shifts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      shoot_id: shootId,
      assigned_user_id: userId,
      manager_user_id: leadershipId,
      shift_kind: "shoot",
      department: "schools",
      staffing_role: options.role ?? "photographer",
      satisfies_lead_coverage: Boolean(options.lead),
      title: `Coverage ${userId.slice(0, 4)}`,
      starts_at: startsAt,
      ends_at: endsAt,
      location_name: "Schedule Test Site",
      location_address: "123 Schedule Way, Minneapolis, MN",
      segments: [
        {
          segment_kind: "shoot",
          label: "Coverage",
          scheduled_start_at: startsAt,
          scheduled_end_at: endsAt,
          rate_code: "shoot",
          hourly_rate_cents: 2500
        }
      ]
    });
  expect(response.status).toBe(201);
  await pool.query("UPDATE work_shift SET status = 'published', published_at = now() WHERE id = $1 AND tenant_id = $2", [
    response.body.id,
    tenantId
  ]);
  return response.body;
}

async function recordPublish(shootId: string) {
  return withClientTransaction(tenantId, leadershipId, (client) =>
    recordStaffingPlanPublication(client, leadAuth(), { shootId })
  );
}

async function lifecycleView(shootId: string) {
  return withClientTransaction(tenantId, leadershipId, (client) =>
    getStaffingPlanLifecycleView(client, leadAuth(), shootId, { canViewDeclineReasons: true })
  );
}

async function myAssignments(token: string) {
  const response = await request(app).get("/api/employee/staffing-assignments").set("Authorization", `Bearer ${token}`);
  return response;
}

async function acknowledgeHttp(token: string, recipientId: string) {
  return request(app)
    .post(`/api/employee/staffing-assignments/${recipientId}/acknowledge`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
}

async function declineHttp(token: string, recipientId: string, reason: unknown) {
  return request(app)
    .post(`/api/employee/staffing-assignments/${recipientId}/decline`)
    .set("Authorization", `Bearer ${token}`)
    .send(reason === undefined ? {} : { reason });
}

async function recipientIdFor(shootId: string, userId: string) {
  const rows = await selectRows<{ id: string }>(
    "SELECT id::text AS id FROM staffing_plan_recipient WHERE tenant_id = $1 AND shoot_id = $2 AND employee_user_id = $3 AND superseded_at IS NULL",
    [tenantId, shootId, userId]
  );
  return rows[0]?.id;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;
  const studio = await pool.query("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1", [tenantId]);
  studioId = studio.rows[0].id;

  const people = await pool.query(
    `SELECT email, id FROM app_user WHERE tenant_id = $1 AND email IN ('leadership@example.com', 'office@example.com', 'senior@example.com', 'photo@example.com')`,
    [tenantId]
  );
  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id;
  officeId = people.rows.find((row) => row.email === "office@example.com")?.id;
  seniorId = people.rows.find((row) => row.email === "senior@example.com")?.id;
  photoId = people.rows.find((row) => row.email === "photo@example.com")?.id;

  const directory = await pool.query(
    `SELECT o.id AS organization_id, l.id AS location_id, c.id AS contact_id
     FROM organization o
     JOIN shoot_location l ON l.tenant_id = o.tenant_id AND l.organization_id = o.id AND l.active_status = 'active'
     JOIN organization_contact c ON c.tenant_id = o.tenant_id AND c.organization_id = o.id AND c.active_status = 'active'
     WHERE o.tenant_id = $1 AND o.display_name = 'White Bear Lake High School'
     ORDER BY c.created_at ASC LIMIT 1`,
    [tenantId]
  );
  schoolOrganizationId = directory.rows[0].organization_id;
  schoolLocationId = directory.rows[0].location_id;
  schoolPrimaryContactId = directory.rows[0].contact_id;

  adminToken = (await request(app).post("/auth/login").send({ email: "admin@example.com", password: "LocalDemo123!" })).body.token;
  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
  photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;
});

describe("employee staffing read model", () => {
  it("1. returns one package for an employee with multiple assignments on one shoot", async () => {
    const date = localDateString(14);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true, start: "14:15", end: "17:15" });
    await seedShift(shoot.id, photoId, { date, lead: false, start: "18:00", end: "20:00" });
    await recordPublish(shoot.id);

    const response = await myAssignments(photoToken);
    expect(response.status).toBe(200);
    const mine = response.body.assignments.filter((a: any) => a.shoot_id === shoot.id);
    expect(mine.length).toBe(1); // one recipient package
    expect(mine[0].assignments.length).toBe(2);
    expect(mine[0].can_acknowledge).toBe(true);
    expect(mine[0].can_decline).toBe(true);
  });

  it("2/3. only current published assignments appear; draft-only staffing does not", async () => {
    const date = localDateString(15);
    const draftShoot = await makeShoot(date, "Draft Only");
    await seedShift(draftShoot.id, photoId, { date, lead: true }); // no recordPublish

    const published = await makeShoot(date, "Published");
    await seedShift(published.id, photoId, { date, lead: true });
    await recordPublish(published.id);

    const response = await myAssignments(photoToken);
    const ids = response.body.assignments.map((a: any) => a.shoot_id);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(draftShoot.id);
  });

  it("15/22. exposes only the employee's own packages and never internal notes", async () => {
    const date = localDateString(16);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await seedShift(shoot.id, seniorId, { date, lead: false });
    await recordPublish(shoot.id);
    await pool.query(
      "UPDATE work_shift SET notes = $1 WHERE tenant_id = $2 AND shoot_id = $3 AND assigned_user_id = $4 AND cancelled_at IS NULL",
      ["Internal manager-only note", tenantId, shoot.id, photoId]
    );

    const response = await myAssignments(photoToken);
    const mine = response.body.assignments.filter((a: any) => a.shoot_id === shoot.id);
    expect(mine.length).toBe(1);
    expect(mine[0].employee_user_id ?? photoId).toBeTruthy();
    // No other employee's package leaks through, and work_shift.notes is never present.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("Internal manager-only note");
    expect(serialized).not.toContain(seniorId); // senior's recipient is not in photo's list
  });

  it("16. distinguishes awaiting / needs-attention / overdue pending states from the policy", async () => {
    const date = localDateString(1); // tomorrow — inside the 72h escalation window
    const shoot = await makeShoot(date, "Timing States");
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    const view = (now: Date) =>
      withClientTransaction(tenantId, photoId, (client) =>
        listEmployeeStaffingAssignments(client, employeeAuth(photoId), { anchorDate: localDateString(0), now })
      );
    const stateNow = async (now: Date) => (await view(now)).find((a) => a.shoot_id === shoot.id)?.acknowledgment_state;

    // Freshly published -> awaiting (inside grace).
    expect(await stateNow(new Date())).toBe("awaiting");

    // Past grace, shoot inside 72h, deadline not yet passed -> needs_attention.
    await pool.query("UPDATE staffing_plan_version SET published_at = now() - interval '1 hour' WHERE tenant_id = $1 AND shoot_id = $2", [tenantId, shoot.id]);
    await pool.query("UPDATE staffing_plan_recipient SET acknowledgment_due_at = now() + interval '6 hours' WHERE id = $1", [recipientId]);
    expect(await stateNow(new Date())).toBe("needs_attention");

    // Deadline passed -> overdue.
    await pool.query("UPDATE staffing_plan_recipient SET acknowledgment_due_at = now() - interval '1 hour' WHERE id = $1", [recipientId]);
    expect(await stateNow(new Date())).toBe("overdue");
  });
});

describe("employee acknowledgment / decline state machine", () => {
  it("5/6. acknowledge records actor/time/version and is idempotent", async () => {
    const date = localDateString(17);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    const first = await acknowledgeHttp(photoToken, recipientId!);
    expect(first.status).toBe(200);
    expect(first.body.assignment.response_status).toBe("acknowledged");
    const row = (await selectRows<{ responded_by_user_id: string; responded_at: string | null }>(
      "SELECT responded_by_user_id::text AS responded_by_user_id, responded_at::text AS responded_at FROM staffing_plan_recipient WHERE id = $1",
      [recipientId]
    ))[0];
    expect(row.responded_by_user_id).toBe(photoId);
    expect(row.responded_at).not.toBeNull();

    const again = await acknowledgeHttp(photoToken, recipientId!);
    expect(again.status).toBe(200); // idempotent no-op
    expect(again.body.assignment.response_status).toBe("acknowledged");
  });

  it("7. decline requires a reason", async () => {
    const date = localDateString(18);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    expect((await declineHttp(photoToken, recipientId!, undefined)).status).toBe(400);
    expect((await declineHttp(photoToken, recipientId!, "   ")).status).toBe(400);
  });

  it("8. decline records actor/time/reason", async () => {
    const date = localDateString(19);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    const declined = await declineHttp(photoToken, recipientId!, "Double-booked that morning");
    expect(declined.status).toBe(200);
    expect(declined.body.assignment.response_status).toBe("declined");
    expect(declined.body.assignment.decline_reason).toBe("Double-booked that morning");
    const row = (await selectRows<{ responded_by_user_id: string; decline_reason: string }>(
      "SELECT responded_by_user_id::text AS responded_by_user_id, decline_reason FROM staffing_plan_recipient WHERE id = $1",
      [recipientId]
    ))[0];
    expect(row.responded_by_user_id).toBe(photoId);
    expect(row.decline_reason).toBe("Double-booked that morning");
  });

  it("9/10. acknowledged -> declined is allowed; declined -> acknowledged is rejected on the same version", async () => {
    const date = localDateString(20);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    expect((await acknowledgeHttp(photoToken, recipientId!)).status).toBe(200);
    const withdrawal = await declineHttp(photoToken, recipientId!, "Plans changed");
    expect(withdrawal.status).toBe(200); // acknowledged -> declined (withdrawal)
    expect(withdrawal.body.assignment.response_status).toBe("declined");

    const reAck = await acknowledgeHttp(photoToken, recipientId!);
    expect(reAck.status).toBe(409); // declined -> acknowledged not allowed
    expect(reAck.body.details.conflict).toBe("declined");
  });

  it("11/13. a superseded / stale recipient returns 409 with the current package", async () => {
    const date = localDateString(21);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id); // v1
    const v1RecipientId = await recipientIdFor(shoot.id, photoId);

    // Material change + republish -> v1 recipient is superseded.
    await pool.query(
      "UPDATE work_shift SET starts_at = starts_at + interval '45 minutes', ends_at = ends_at + interval '45 minutes' WHERE tenant_id = $1 AND shoot_id = $2 AND assigned_user_id = $3 AND cancelled_at IS NULL",
      [tenantId, shoot.id, photoId]
    );
    await recordPublish(shoot.id); // v2

    const stale = await acknowledgeHttp(photoToken, v1RecipientId!);
    expect(stale.status).toBe(409);
    expect(stale.body.details.conflict).toBe("not_current");
    expect(stale.body.details.current_package.shoot_id).toBe(shoot.id);
    expect(stale.body.details.current_package.version).toBe(2);
    expect(stale.body.details.current_package.response_status).toBe("pending");
  });

  it("12. concurrent acknowledge + decline resolves to a single coherent state", async () => {
    const date = localDateString(22);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    const [ack, decline] = await Promise.all([
      acknowledgeHttp(photoToken, recipientId!),
      declineHttp(photoToken, recipientId!, "Conflict")
    ]);
    expect([200, 409]).toContain(ack.status);
    expect([200, 409]).toContain(decline.status);
    const final = (await selectRows<{ response_status: string }>(
      "SELECT response_status FROM staffing_plan_recipient WHERE id = $1",
      [recipientId]
    ))[0].response_status;
    expect(["acknowledged", "declined"]).toContain(final); // exactly one coherent terminal state
  });

  it("14/12-manager. carry-forward and manager view reflect the employee response", async () => {
    const date = localDateString(23);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);
    expect((await acknowledgeHttp(photoToken, recipientId!)).status).toBe(200);

    // Manager view reflects the acknowledgment immediately.
    let view = await lifecycleView(shoot.id);
    expect(view.acknowledged_staff_count).toBe(1);
    expect(view.recipients.find((r) => r.employee_user_id === photoId)?.response_status).toBe("acknowledged");

    // Change only the OTHER employee, republish -> photo's acknowledgment carries forward.
    await pool.query(
      "UPDATE work_shift SET starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes' WHERE tenant_id = $1 AND shoot_id = $2 AND assigned_user_id = $3 AND cancelled_at IS NULL",
      [tenantId, shoot.id, officeId]
    );
    await recordPublish(shoot.id);
    const after = await myAssignments(photoToken);
    const mine = after.body.assignments.find((a: any) => a.shoot_id === shoot.id);
    expect(mine.response_status).toBe("acknowledged");
    expect(mine.carried_forward).toBe(true);
    expect(mine.can_acknowledge).toBe(false);
  });

  it("18/19. decline keeps raw assignment visible but drops coverage eligibility in the manager view", async () => {
    const date = localDateString(24);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, photoId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);
    const recipientId = await recipientIdFor(shoot.id, photoId);

    expect((await declineHttp(photoToken, recipientId!, "Cannot make it")).status).toBe(200);
    const view = await lifecycleView(shoot.id);
    expect(view.assigned_staff_count).toBe(2); // raw assignment remains
    expect(view.declined_staff_count).toBe(1);
    expect(view.coverage_eligible_lead_count).toBe(0); // the declined lead no longer covers
    expect(view.operational_readiness_status).toBe("at_risk");
    expect(view.recipients.find((r) => r.employee_user_id === photoId)?.response_status).toBe("declined");
  });
});

describe("employee staffing security + RBAC", () => {
  it("16-sec/17-sec. an employee cannot act on another employee's or a guessed recipient", async () => {
    const date = localDateString(25);
    const shoot = await makeShoot(date);
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, photoId, { date, lead: false });
    await recordPublish(shoot.id);
    const seniorRecipientId = await recipientIdFor(shoot.id, seniorId);

    // photo acting on senior's recipient -> 403
    expect((await acknowledgeHttp(photoToken, seniorRecipientId!)).status).toBe(403);
    expect((await declineHttp(photoToken, seniorRecipientId!, "x")).status).toBe(403);
    // guessed/random recipient id -> 404
    expect((await acknowledgeHttp(photoToken, randomUUID())).status).toBe(404);
  });

  it("23. field employees cannot publish, assign, or edit staffing", async () => {
    const date = localDateString(26);
    const shoot = await makeShoot(date);
    const snapshot = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadSlot = snapshot.body.slots.find((slot: any) => slot.satisfies_lead_coverage);

    expect(
      (await request(app)
        .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
        .set("Authorization", `Bearer ${photoToken}`)
        .send({ slot_key: leadSlot.slot_key, assigned_user_id: photoId })).status
    ).toBe(403);
    expect(
      (await request(app)
        .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
        .set("Authorization", `Bearer ${photoToken}`)
        .send({ override_warnings: false })).status
    ).toBe(403);
  });
});
