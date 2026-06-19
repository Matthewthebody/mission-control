import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

// Phase 2 closure — the complete two-sided staffing workflow exercised end to end against the real DB:
// assign -> publish v1 (per-recipient markers, NO aggregate) -> employee acknowledges -> capacity moves
// pending->confirmed with the scheduled total unchanged -> material change -> publish v2 (unchanged carried
// forward, only the changed employee re-marked) -> resend reminder (one queued, then cooldown no-op) ->
// decline (visible, replacement-required, coverage reduced) -> reassign + republish (historical decline does
// not contaminate the current version) -> RBAC. Per-feature suites cover the rest; this is the integration.

const app = createApp();

let tenantId: string;
let studioId: string;
let orgId: string;
let locationId: string;
let contactId: string;
let adminToken: string;
let leadershipToken: string;
let leadershipId: string;
let seniorId: string;
let photoId: string;
let officeId: string;

function tomorrow(offset = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function isoAt(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function makeShoot(date: string, title: string): Promise<string> {
  const res = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: orgId,
      location_id: locationId,
      primary_contact_id: contactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: `E2E-${randomUUID().slice(0, 8)}`,
      title,
      shoot_date: date,
      geofence_radius_meters: 1609,
      arrival_time: isoAt(date, "08:45"),
      start_time: isoAt(date, "09:00"),
      end_time_est: isoAt(date, "12:00"),
      projected_students: 48,
      planned_staff_count: 2,
      required_lead_count: 1
    });
  expect(res.status).toBe(201);
  await pool.query("UPDATE shoot SET record_state = 'published'::shoot_record_state WHERE id = $1", [res.body.id]);
  return res.body.id as string;
}

async function seedShift(shootId: string, userId: string, opts: { lead?: boolean; startHourUtc?: number }): Promise<string> {
  const date = (await rows<{ shoot_date: string }>("SELECT shoot_date::text AS shoot_date FROM shoot WHERE id = $1", [shootId]))[0].shoot_date;
  const start = `${date}T${String(opts.startHourUtc ?? 14).padStart(2, "0")}:00:00.000Z`;
  const end = `${date}T${String((opts.startHourUtc ?? 14) + 3).padStart(2, "0")}:00:00.000Z`;
  const res = await request(app)
    .post("/api/shifts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      shoot_id: shootId,
      assigned_user_id: userId,
      manager_user_id: leadershipId,
      shift_kind: "shoot",
      department: "schools",
      staffing_role: opts.lead ? "lead_photographer" : "photographer",
      satisfies_lead_coverage: Boolean(opts.lead),
      title: "Coverage",
      starts_at: start,
      ends_at: end,
      location_name: "E2E Site",
      location_address: "1 E2E Way",
      segments: [{ segment_kind: "shoot", label: "Coverage", scheduled_start_at: start, scheduled_end_at: end, rate_code: "shoot", hourly_rate_cents: 2500 }]
    });
  expect(res.status).toBe(201);
  await pool.query("UPDATE work_shift SET status = 'published', published_at = now() WHERE id = $1", [res.body.id]);
  return res.body.id as string;
}

const publish = (shootId: string) =>
  request(app)
    .post(`/api/schedule/shoots/${shootId}/staffing/publish`)
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({ override_warnings: true, approval_reason: "E2E" });

const markerCount = async (shootId: string, employeeId?: string) =>
  Number(
    (
      await rows<{ n: string }>(
        `SELECT COUNT(*)::int AS n FROM app_event WHERE tenant_id = $1 AND event_type = 'staffing.plan.recipient_published'
         AND payload->>'shoot_id' = $2 ${employeeId ? "AND payload->>'employee_user_id' = $3" : ""}`,
        employeeId ? [tenantId, shootId, employeeId] : [tenantId, shootId]
      )
    )[0].n
  );

const currentRecipientId = async (shootId: string, employeeId: string) =>
  (
    await rows<{ id: string }>(
      "SELECT id::text AS id FROM staffing_plan_recipient WHERE tenant_id = $1 AND shoot_id = $2 AND employee_user_id = $3 AND superseded_at IS NULL",
      [tenantId, shootId, employeeId]
    )
  )[0]?.id;

const capacityEmployee = async (token: string, anchorDate: string, employeeId: string) => {
  const res = await request(app)
    .get(`/api/schedule/capacity?window=week&anchor_date=${anchorDate}&employee_id=${employeeId}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.employees.find((e: any) => e.employee_user_id === employeeId);
};

beforeAll(async () => {
  tenantId = (await rows<{ id: string }>("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1", []))[0].id;
  studioId = (await rows<{ id: string }>("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [tenantId]))[0].id;
  const people = await rows<{ email: string; id: string }>(
    "SELECT email, id FROM app_user WHERE tenant_id = $1 AND email IN ('leadership@example.com','senior@example.com','photo@example.com','office@example.com')",
    [tenantId]
  );
  leadershipId = people.find((p) => p.email === "leadership@example.com")!.id;
  seniorId = people.find((p) => p.email === "senior@example.com")!.id;
  photoId = people.find((p) => p.email === "photo@example.com")!.id;
  officeId = people.find((p) => p.email === "office@example.com")!.id;
  const dir = (
    await rows<{ org: string; loc: string; contact: string }>(
      `SELECT o.id org, l.id loc, c.id contact FROM organization o
       JOIN shoot_location l ON l.tenant_id=o.tenant_id AND l.organization_id=o.id AND l.active_status='active'
       JOIN organization_contact c ON c.tenant_id=o.tenant_id AND c.organization_id=o.id AND c.active_status='active'
       WHERE o.tenant_id=$1 AND o.display_name='White Bear Lake High School' ORDER BY c.created_at LIMIT 1`,
      [tenantId]
    )
  )[0];
  orgId = dir.org;
  locationId = dir.loc;
  contactId = dir.contact;
  adminToken = (await request(app).post("/auth/login").send({ email: "admin@example.com", password: "LocalDemo123!" })).body.token;
  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
});

describe("Phase 2 staffing closure — two-sided workflow", () => {
  it("runs assign -> publish -> acknowledge -> change -> republish -> remind -> decline -> reassign end to end", async () => {
    const anchor = tomorrow(1);
    const shoot = await makeShoot(anchor, "Phase 2 Closure");

    // 1-6. Assign a qualified lead (senior) + another role (photo), publish v1.
    await seedShift(shoot, seniorId, { lead: true, startHourUtc: 14 });
    await seedShift(shoot, photoId, { lead: false, startHourUtc: 14 });
    const v1 = await publish(shoot);
    expect(v1.status).toBe(200);

    // 7-8. Per-recipient markers for BOTH new recipients; the legacy aggregate never fires.
    expect(await markerCount(shoot)).toBe(2);
    const aggregate = await rows<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM app_event WHERE tenant_id=$1 AND event_type='notification.dispatch' AND payload->>'notification_type'='schedule.staffing.published' AND payload->>'shoot_id'=$2",
      [tenantId, shoot]
    );
    expect(Number(aggregate[0].n)).toBe(0);

    // Capacity: senior is published + pending. (Absolute totals may include other fixtures in the shared DB,
    // so the workflow asserts DELTAS for the E2E shift — robust + deterministic.)
    const seniorBefore = await capacityEmployee(leadershipToken, anchor, seniorId);
    expect(seniorBefore.coverage_eligible_minutes).toBeGreaterThan(0);
    expect(seniorBefore.pending_confirmation_minutes).toBeGreaterThan(0);

    // 9-12. Employee acknowledges -> the E2E shift (180 min) moves pending->confirmed; scheduled total UNCHANGED.
    const seniorRec = await currentRecipientId(shoot, seniorId);
    await pool.query("UPDATE staffing_plan_recipient SET response_status='acknowledged', responded_at=now(), responded_by_user_id=employee_user_id WHERE id=$1", [seniorRec]);
    const seniorAfter = await capacityEmployee(leadershipToken, anchor, seniorId);
    expect(seniorAfter.confirmed_minutes - seniorBefore.confirmed_minutes).toBe(180);
    expect(seniorBefore.pending_confirmation_minutes - seniorAfter.pending_confirmation_minutes).toBe(180);
    expect(seniorAfter.unique_scheduled_minutes).toBe(seniorBefore.unique_scheduled_minutes); // total scheduled unchanged

    // 13-16. Material change to ONLY photo's shift, publish v2.
    await pool.query("UPDATE work_shift SET ends_at = ends_at + interval '1 hour', updated_at = now() WHERE tenant_id=$1 AND shoot_id=$2 AND assigned_user_id=$3 AND cancelled_at IS NULL", [tenantId, shoot, photoId]);
    const v2 = await publish(shoot);
    expect(v2.status).toBe(200);
    // Senior unchanged -> still ONE marker (carried forward); photo changed -> a NEW marker (two total for photo).
    expect(await markerCount(shoot, seniorId)).toBe(1);
    expect(await markerCount(shoot, photoId)).toBe(2);
    // Senior's acknowledgment carried forward.
    const seniorAfterV2 = await rows<{ response_status: string }>("SELECT response_status FROM staffing_plan_recipient WHERE tenant_id=$1 AND shoot_id=$2 AND employee_user_id=$3 AND superseded_at IS NULL", [tenantId, shoot, seniorId]);
    expect(seniorAfterV2[0].response_status).toBe("acknowledged");

    // 17-19. Resend reminder for the changed (pending) photo recipient: one queued, then cooldown no-op.
    const photoRec = await currentRecipientId(shoot, photoId);
    const remind = () => request(app).post(`/api/schedule/shoots/${shoot}/staffing/recipients/${photoRec}/remind`).set("Authorization", `Bearer ${leadershipToken}`).send({});
    const r1 = await remind();
    expect(r1.body.status).toBe("queued");
    const r2 = await remind();
    expect(r2.body.status).toBe("cooldown");

    // 20-24. Photo declines v2 -> raw kept, coverage reduced (delta), declined event emitted, still visible.
    const photoBefore = await capacityEmployee(leadershipToken, anchor, photoId);
    await pool.query("UPDATE staffing_plan_recipient SET response_status='declined', responded_at=now(), responded_by_user_id=employee_user_id, decline_reason='Family conflict' WHERE id=$1", [photoRec]);
    await pool.query("INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key) VALUES ($1,'staffing.plan.recipient_declined','staffing_plan_recipient',$2,$3::jsonb,$4) ON CONFLICT DO NOTHING", [tenantId, photoRec, JSON.stringify({ shoot_id: shoot, employee_user_id: photoId, decline_reason: "Family conflict" }), `staffing-response:${photoRec}:declined`]);
    const photoAfter = await capacityEmployee(leadershipToken, anchor, photoId);
    expect(photoAfter.raw_assigned_minutes).toBe(photoBefore.raw_assigned_minutes); // raw assignment preserved (not removed)
    expect(photoAfter.coverage_eligible_minutes).toBeLessThan(photoBefore.coverage_eligible_minutes); // removed from coverage
    expect(photoAfter.declined_assignment_count - photoBefore.declined_assignment_count).toBe(1);

    // 26-27. Reassign: remove the declined employee's shift + assign the replacement (office), republish v3.
    await pool.query("UPDATE work_shift SET status='cancelled', cancelled_at=now(), updated_at=now() WHERE tenant_id=$1 AND shoot_id=$2 AND assigned_user_id=$3", [tenantId, shoot, photoId]);
    await seedShift(shoot, officeId, { lead: false, startHourUtc: 14 });
    const v3 = await publish(shoot);
    expect(v3.status).toBe(200);
    const officeRec = await rows<{ response_status: string }>("SELECT response_status FROM staffing_plan_recipient WHERE tenant_id=$1 AND shoot_id=$2 AND employee_user_id=$3 AND superseded_at IS NULL", [tenantId, shoot, officeId]);
    expect(officeRec[0].response_status).toBe("pending"); // replacement is freshly pending, uncontaminated
    expect(await markerCount(shoot, officeId)).toBe(1);
    // Photo's decline remains as immutable history (a superseded recipient), not the current commitment.
    const photoHistory = await rows<{ response_status: string; superseded_at: string | null }>("SELECT response_status, superseded_at::text AS superseded_at FROM staffing_plan_recipient WHERE tenant_id=$1 AND shoot_id=$2 AND employee_user_id=$3 AND response_status='declined'", [tenantId, shoot, photoId]);
    expect(photoHistory.length).toBeGreaterThan(0);
    expect(photoHistory.every((r) => r.superseded_at !== null)).toBe(true);

    // 30. RBAC: the capacity + remind manager endpoints reject an employee token.
    const photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;
    expect((await request(app).get(`/api/schedule/capacity?window=week&anchor_date=${anchor}`).set("Authorization", `Bearer ${photoToken}`)).status).toBe(403);
    expect((await request(app).post(`/api/schedule/shoots/${shoot}/staffing/recipients/${officeRec[0] ? await currentRecipientId(shoot, officeId) : ""}/remind`).set("Authorization", `Bearer ${photoToken}`).send({})).status).toBe(403);

    // Cleanup the closure fixture (idempotent across reruns).
    await pool.query("DELETE FROM staffing_plan_recipient WHERE tenant_id=$1 AND shoot_id=$2", [tenantId, shoot]);
    await pool.query("DELETE FROM staffing_plan_version WHERE tenant_id=$1 AND shoot_id=$2", [tenantId, shoot]);
    await pool.query("DELETE FROM shift_segment WHERE shift_id IN (SELECT id FROM work_shift WHERE tenant_id=$1 AND shoot_id=$2)", [tenantId, shoot]);
    await pool.query("DELETE FROM work_shift WHERE tenant_id=$1 AND shoot_id=$2", [tenantId, shoot]);
    await pool.query("UPDATE shoot SET deleted_at = now() WHERE id=$1", [shoot]);
  });
});
