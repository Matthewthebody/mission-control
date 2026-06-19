import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  acknowledgeStaffingPlanRecipient,
  declineStaffingPlanRecipient,
  recordStaffingPlanPublication
} from "../src/services/staffingPlanLifecycle.js";
import { listSchedulingUrgentWatchCandidates } from "../src/services/scheduleStaffing.js";
import {
  DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY,
  evaluateAcknowledgmentUrgency,
  isAcknowledgmentOverdue,
  isPastPublicationGrace,
  isPendingNotAcknowledged,
  isWithinEscalationWindow,
  publicationGraceBoundary
} from "../src/domain/staffing/staffing-acknowledgment-policy.js";

// Phase 2, Slice 2 — versioned staffing publish + per-recipient acknowledgment lifecycle.
// These exercise the schema/services layer directly: recordStaffingPlanPublication writes the
// version + recipient state (so we drive it with controlled work_shift fixtures), the
// acknowledge/decline service transitions, the centralized acknowledgment policy, and the
// decline -> canonical-readiness exclusion in the dashboard + urgent-watch candidate SQL.

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
let seniorId: string;
let officeId: string;
let adminId: string;
let photoId: string;

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
  const result = await pool.query(sql, params);
  return result.rows as T[];
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

// Create a published shoot record (record_state='published' so it surfaces in the
// readiness dashboard + urgent-watch candidate queries).
async function makeShoot(date: string, title = "Staffing Lifecycle") {
  const body = await createShoot(`SPL-${randomUUID().slice(0, 8)}`, title, date);
  await pool.query("UPDATE shoot SET record_state = 'published'::shoot_record_state WHERE id = $1 AND tenant_id = $2", [
    body.id,
    tenantId
  ]);
  return body;
}

async function createShift(options: {
  shootId: string;
  assignedUserId: string;
  title: string;
  date: string;
  staffingRole?: string;
  satisfiesLeadCoverage?: boolean;
  start?: string;
  end?: string;
}) {
  const startsAt = isoAt(options.date, options.start ?? "14:15");
  const endsAt = isoAt(options.date, options.end ?? "17:15");
  const response = await request(app)
    .post("/api/shifts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      shoot_id: options.shootId,
      assigned_user_id: options.assignedUserId,
      manager_user_id: leadershipId,
      shift_kind: "shoot",
      department: "schools",
      staffing_role: options.staffingRole ?? "photographer",
      satisfies_lead_coverage: Boolean(options.satisfiesLeadCoverage),
      title: options.title,
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
  return response.body;
}

async function seedShift(
  shootId: string,
  userId: string,
  options: { date: string; lead?: boolean; role?: string; start?: string; end?: string; published?: boolean }
) {
  const body = await createShift({
    shootId,
    assignedUserId: userId,
    title: `Coverage ${userId.slice(0, 4)}`,
    date: options.date,
    staffingRole: options.role,
    satisfiesLeadCoverage: options.lead,
    start: options.start,
    end: options.end
  });
  if (options.published !== false) {
    await pool.query("UPDATE work_shift SET status = 'published', published_at = now() WHERE id = $1 AND tenant_id = $2", [
      body.id,
      tenantId
    ]);
  }
  return body;
}

type RecipientRow = {
  id: string;
  employee_user_id: string;
  response_status: string;
  recipient_hash: string;
  carried_forward_from_recipient_id: string | null;
  superseded_at: string | null;
  acknowledgment_due_at: string | null;
  assignment_snapshot: { assignments: unknown[] };
  version: number;
};

async function recipients(shootId: string, opts: { currentOnly?: boolean } = {}): Promise<RecipientRow[]> {
  const onlyCurrent = opts.currentOnly !== false;
  return selectRows<RecipientRow>(
    `
      SELECT
        r.id,
        r.employee_user_id::text AS employee_user_id,
        r.response_status,
        r.recipient_hash,
        r.carried_forward_from_recipient_id::text AS carried_forward_from_recipient_id,
        r.superseded_at,
        r.acknowledgment_due_at,
        r.assignment_snapshot,
        v.version
      FROM staffing_plan_recipient r
      JOIN staffing_plan_version v ON v.id = r.staffing_plan_version_id
      WHERE r.tenant_id = $1 AND r.shoot_id = $2 ${onlyCurrent ? "AND r.superseded_at IS NULL" : ""}
      ORDER BY v.version, r.employee_user_id
    `,
    [tenantId, shootId]
  );
}

async function versions(shootId: string) {
  return selectRows<{ version: number; plan_hash: string }>(
    "SELECT version, plan_hash FROM staffing_plan_version WHERE tenant_id = $1 AND shoot_id = $2 ORDER BY version",
    [tenantId, shootId]
  );
}

async function publishEventCount(shootId: string, userId?: string) {
  const rows = await selectRows<{ n: string }>(
    `
      SELECT COUNT(*)::int AS n
      FROM app_event
      WHERE tenant_id = $1
        AND event_type = 'staffing.plan.recipient_published'
        AND payload->>'shoot_id' = $2
        ${userId ? "AND payload->>'employee_user_id' = $3" : ""}
    `,
    userId ? [tenantId, shootId, userId] : [tenantId, shootId]
  );
  return Number(rows[0].n);
}

async function recordPublish(shootId: string) {
  return withClientTransaction(tenantId, leadershipId, (client) =>
    recordStaffingPlanPublication(client, leadAuth(), { shootId })
  );
}

async function ackAs(userId: string, recipientId: string) {
  return withClientTransaction(tenantId, userId, (client) =>
    acknowledgeStaffingPlanRecipient(client, employeeAuth(userId), recipientId, {})
  );
}

async function declineAs(userId: string, recipientId: string, reason: string) {
  return withClientTransaction(tenantId, userId, (client) =>
    declineStaffingPlanRecipient(client, employeeAuth(userId), recipientId, { reason }, {})
  );
}

async function candidatesForShoot(shootId: string) {
  const all = await withClientTransaction(tenantId, leadershipId, (client) =>
    listSchedulingUrgentWatchCandidates(client, tenantId, localDateString(0))
  );
  return all.filter((candidate) => candidate.source_entity_id === shootId);
}

async function bumpShiftTime(shootId: string, userId: string) {
  await pool.query(
    `
      UPDATE work_shift
      SET starts_at = starts_at + interval '45 minutes',
          ends_at = ends_at + interval '45 minutes',
          updated_at = now()
      WHERE tenant_id = $1 AND shoot_id = $2 AND assigned_user_id = $3 AND cancelled_at IS NULL
    `,
    [tenantId, shootId, userId]
  );
}

function recipientFor(rows: RecipientRow[], userId: string) {
  const row = rows.find((r) => r.employee_user_id === userId);
  if (!row) {
    throw new Error(`No recipient row for ${userId}`);
  }
  return row;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;

  const studio = await pool.query("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1", [tenantId]);
  studioId = studio.rows[0].id;

  const people = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'admin@example.com', 'office@example.com', 'senior@example.com', 'photo@example.com')
    `,
    [tenantId]
  );
  adminId = people.rows.find((row) => row.email === "admin@example.com")?.id;
  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id;
  officeId = people.rows.find((row) => row.email === "office@example.com")?.id;
  seniorId = people.rows.find((row) => row.email === "senior@example.com")?.id;
  photoId = people.rows.find((row) => row.email === "photo@example.com")?.id;

  const schoolDirectory = await pool.query(
    `
      SELECT o.id AS organization_id, l.id AS location_id, c.id AS contact_id
      FROM organization o
      JOIN shoot_location l
        ON l.tenant_id = o.tenant_id
       AND l.organization_id = o.id
       AND l.active_status = 'active'
      JOIN organization_contact c
        ON c.tenant_id = o.tenant_id
       AND c.organization_id = o.id
       AND c.active_status = 'active'
      WHERE o.tenant_id = $1
        AND o.display_name = 'White Bear Lake High School'
      ORDER BY c.created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );
  schoolOrganizationId = schoolDirectory.rows[0].organization_id;
  schoolLocationId = schoolDirectory.rows[0].location_id;
  schoolPrimaryContactId = schoolDirectory.rows[0].contact_id;

  adminToken = (await request(app).post("/auth/login").send({ email: "admin@example.com", password: "LocalDemo123!" })).body.token;
  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
  photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;
});

describe("staffing plan versioning + recipient packages", () => {
  it("1. first publish through the real publish route creates version 1 with one recipient package per employee", async () => {
    const date = localDateString(15);
    const shoot = await makeShoot(date, "Versioned Publish Wiring");

    const snapshot = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(snapshot.status).toBe(200);
    const leadSlot = snapshot.body.slots.find((slot: any) => slot.satisfies_lead_coverage);
    const leadOption = leadSlot.option_groups.flatMap((group: any) => group.options).find((option: any) => !option.disabled);
    const leadAssign = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ slot_key: leadSlot.slot_key, assigned_user_id: leadOption.user_id, override_conflict: Boolean(leadOption.requires_override), approval_reason: "Test lead coverage" });
    expect(leadAssign.status).toBe(200);

    const snapshot2 = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const otherSlot = snapshot2.body.slots.find((slot: any) => !slot.satisfies_lead_coverage && !slot.assigned_user_id);
    if (otherSlot) {
      const otherOption = otherSlot.option_groups
        .flatMap((group: any) => group.options)
        .find((option: any) => !option.disabled && option.user_id !== leadOption.user_id);
      if (otherOption) {
        const otherAssign = await request(app)
          .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
          .set("Authorization", `Bearer ${leadershipToken}`)
          .send({ slot_key: otherSlot.slot_key, assigned_user_id: otherOption.user_id, override_conflict: Boolean(otherOption.requires_override), approval_reason: "Test coverage" });
        expect([200, 202]).toContain(otherAssign.status);
      }
    }

    const published = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ override_warnings: true, approval_reason: "Test publish" });
    expect(published.status).toBe(200);

    const planVersions = await versions(shoot.id);
    expect(planVersions.length).toBe(1);
    expect(planVersions[0].version).toBe(1);

    const distinctAssigned = await selectRows<{ assigned_user_id: string }>(
      `
        SELECT DISTINCT assigned_user_id::text AS assigned_user_id
        FROM work_shift
        WHERE tenant_id = $1 AND shoot_id = $2 AND assigned_user_id IS NOT NULL
          AND cancelled_at IS NULL AND status IN ('draft', 'published', 'completed')
      `,
      [tenantId, shoot.id]
    );
    const recs = await recipients(shoot.id);
    expect(recs.length).toBe(distinctAssigned.length);
    expect(recs.every((r) => r.response_status === "pending")).toBe(true);

    // The first publish also synchronizes canonical shift publication state.
    const publishedShifts = await selectRows<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM work_shift WHERE tenant_id = $1 AND shoot_id = $2 AND status = 'published'",
      [tenantId, shoot.id]
    );
    expect(Number(publishedShifts[0].n)).toBeGreaterThan(0);
  });

  it("2. an employee with multiple assignments receives one recipient package", async () => {
    const date = localDateString(21);
    const shoot = await makeShoot(date, "Multi Assignment");
    await seedShift(shoot.id, seniorId, { date, lead: true, start: "14:15", end: "17:15" });
    await seedShift(shoot.id, seniorId, { date, lead: false, role: "photographer", start: "18:00", end: "20:00" });

    await recordPublish(shoot.id);

    const recs = await recipients(shoot.id);
    const seniorRecs = recs.filter((r) => r.employee_user_id === seniorId);
    expect(seniorRecs.length).toBe(1);
    expect(seniorRecs[0].assignment_snapshot.assignments.length).toBe(2);
  });

  it("3. repeating an unchanged publish returns version 1 (no new version)", async () => {
    const date = localDateString(22);
    const shoot = await makeShoot(date, "Idempotent Republish");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });

    const first = await recordPublish(shoot.id);
    expect(first.status).toBe("created");
    expect(first.version).toBe(1);

    const second = await recordPublish(shoot.id);
    expect(second.status).toBe("unchanged");
    expect(second.version).toBe(1);

    expect((await versions(shoot.id)).length).toBe(1);
  });

  it("4. an unchanged publish creates no duplicate recipient rows or notifications", async () => {
    const date = localDateString(23);
    const shoot = await makeShoot(date, "Idempotent Notifications");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });

    await recordPublish(shoot.id);
    await recordPublish(shoot.id);

    expect((await recipients(shoot.id, { currentOnly: false })).length).toBe(2);
    expect(await publishEventCount(shoot.id)).toBe(2);
  });

  it("5. changing one employee's assignment creates version 2", async () => {
    const date = localDateString(24);
    const shoot = await makeShoot(date, "Material Change Version");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });

    await recordPublish(shoot.id);
    await bumpShiftTime(shoot.id, officeId);
    const second = await recordPublish(shoot.id);

    expect(second.status).toBe("created");
    expect(second.version).toBe(2);
    expect((await versions(shoot.id)).length).toBe(2);
  });

  it("6. the changed employee becomes pending again on the new version", async () => {
    const date = localDateString(25);
    const shoot = await makeShoot(date, "Changed Employee Pending");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const officeRec = recipientFor(await recipients(shoot.id), officeId);
    await ackAs(officeId, officeRec.id);
    expect(recipientFor(await recipients(shoot.id), officeId).response_status).toBe("acknowledged");

    await bumpShiftTime(shoot.id, officeId);
    await recordPublish(shoot.id);

    expect(recipientFor(await recipients(shoot.id), officeId).response_status).toBe("pending");
  });

  it("7. an unchanged acknowledged employee is carried forward explicitly", async () => {
    const date = localDateString(26);
    const shoot = await makeShoot(date, "Carry Forward Ack");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await ackAs(seniorId, seniorRec.id);

    await bumpShiftTime(shoot.id, officeId); // change only the OTHER employee
    await recordPublish(shoot.id);

    const carried = recipientFor(await recipients(shoot.id), seniorId);
    expect(carried.version).toBe(2);
    expect(carried.response_status).toBe("acknowledged");
    expect(carried.carried_forward_from_recipient_id).toBe(seniorRec.id);
  });

  it("8. the prior acknowledgment remains historical after carry-forward", async () => {
    const date = localDateString(32);
    const shoot = await makeShoot(date, "Historical Ack");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await ackAs(seniorId, seniorRec.id);
    await bumpShiftTime(shoot.id, officeId);
    await recordPublish(shoot.id);

    const allRows = await recipients(shoot.id, { currentOnly: false });
    const priorSenior = allRows.find((r) => r.id === seniorRec.id);
    expect(priorSenior).toBeTruthy();
    expect(priorSenior!.version).toBe(1);
    expect(priorSenior!.response_status).toBe("acknowledged");
    expect(priorSenior!.superseded_at).not.toBeNull();
  });

  it("9. an unchanged pending employee stays pending without a second initial notification", async () => {
    const date = localDateString(27);
    const shoot = await makeShoot(date, "Pending Carry Forward");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    await bumpShiftTime(shoot.id, officeId); // change only office; senior stays pending + unchanged
    await recordPublish(shoot.id);

    const seniorCurrent = recipientFor(await recipients(shoot.id), seniorId);
    expect(seniorCurrent.version).toBe(2);
    expect(seniorCurrent.response_status).toBe("pending");
    expect(seniorCurrent.carried_forward_from_recipient_id).not.toBeNull();
    // Only the v1 initial notification exists for senior — no second one at v2.
    expect(await publishEventCount(shoot.id, seniorId)).toBe(1);
  });

  it("10. an unrelated employee's change does not force everyone to re-acknowledge", async () => {
    const date = localDateString(28);
    const shoot = await makeShoot(date, "Unrelated Change");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const v1 = await recipients(shoot.id);
    await ackAs(seniorId, recipientFor(v1, seniorId).id);
    await ackAs(officeId, recipientFor(v1, officeId).id);

    await bumpShiftTime(shoot.id, officeId);
    await recordPublish(shoot.id);

    const current = await recipients(shoot.id);
    expect(recipientFor(current, seniorId).response_status).toBe("acknowledged"); // unaffected
    expect(recipientFor(current, officeId).response_status).toBe("pending"); // re-ack required
  });

  it("11. a material time change requires renewed acknowledgment for the affected employee", async () => {
    const date = localDateString(29);
    const shoot = await makeShoot(date, "Material Re-Ack");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await ackAs(seniorId, seniorRec.id);
    expect(recipientFor(await recipients(shoot.id), seniorId).response_status).toBe("acknowledged");

    await bumpShiftTime(shoot.id, seniorId);
    await recordPublish(shoot.id);

    expect(recipientFor(await recipients(shoot.id), seniorId).response_status).toBe("pending");
  });

  it("12. an internal-only / display-only change does not create a new version", async () => {
    const date = localDateString(30);
    const shoot = await makeShoot(date, "Non Material Change");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    // Title is a display label, excluded from the plan hash.
    await pool.query("UPDATE shoot SET title = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3", [
      "Renamed Internal Title",
      shoot.id,
      tenantId
    ]);
    const second = await recordPublish(shoot.id);

    expect(second.status).toBe("unchanged");
    expect((await versions(shoot.id)).length).toBe(1);
  });

  it("13. concurrent publishes: one version, one recipient + one notification per employee, no leaked unique violation", async () => {
    const date = localDateString(31);
    const shoot = await makeShoot(date, "Concurrent Publish");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });

    const settled = await Promise.allSettled([recordPublish(shoot.id), recordPublish(shoot.id)]);
    // Both callers get a coherent result; no unhandled unique-constraint failure leaks out.
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    const statuses = settled
      .map((r) => (r as PromiseFulfilledResult<{ status: string }>).value.status)
      .sort();
    expect(statuses).toEqual(["created", "unchanged"]);

    const planVersions = await versions(shoot.id);
    expect(planVersions.length).toBe(1);
    expect(planVersions[0].version).toBe(1);
    expect((await recipients(shoot.id)).length).toBe(2); // one recipient row per employee
    expect(await publishEventCount(shoot.id)).toBe(2); // one initial notification per pending employee
  });
});

describe("acknowledgment deadline policy", () => {
  it("14. a pending assignment is visible immediately but not urgent before policy thresholds", async () => {
    const date = localDateString(18);
    const shoot = await makeShoot(date, "Awaiting Acknowledgment");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    const rec = recipientFor(await recipients(shoot.id), seniorId);
    expect(rec.response_status).toBe("pending"); // visible immediately
    // Past grace, shoot ~18 days out (outside the 72h window), deadline in the future -> not urgent.
    const notUrgent = isPendingNotAcknowledged({
      responseStatus: rec.response_status,
      publishedAt: new Date(Date.now() - 24 * 3600 * 1000),
      dueAt: rec.acknowledgment_due_at,
      shootStartAt: new Date(Date.now() + 18 * 24 * 3600 * 1000),
      now: new Date()
    });
    expect(notUrgent).toBe(false);
  });

  it("15. passing the acknowledgment due time activates not_acknowledged", () => {
    const now = new Date();
    const pastDue = new Date(now.getTime() - 3600 * 1000);
    expect(isAcknowledgmentOverdue(pastDue, now)).toBe(true);
    expect(
      isPendingNotAcknowledged({
        responseStatus: "pending",
        publishedAt: new Date(now.getTime() - 3 * 24 * 3600 * 1000), // past grace
        dueAt: pastDue,
        shootStartAt: new Date(now.getTime() + 10 * 24 * 3600 * 1000),
        now
      })
    ).toBe(true);
  });

  it("16. entering the 72-hour escalation window activates it while still pending", () => {
    const now = new Date();
    const shootSoon = new Date(now.getTime() + 24 * 3600 * 1000);
    expect(isWithinEscalationWindow(shootSoon, now)).toBe(true);
    expect(
      isPendingNotAcknowledged({
        responseStatus: "pending",
        publishedAt: new Date(now.getTime() - 3600 * 1000), // past the 15-min grace
        dueAt: new Date(now.getTime() + 10 * 24 * 3600 * 1000), // deadline far off
        shootStartAt: shootSoon, // but the shoot is within 72h
        now
      })
    ).toBe(true);
  });

  it("17. acknowledgment resolves the current not_acknowledged issue", async () => {
    const date = localDateString(19);
    const shoot = await makeShoot(date, "Ack Resolves");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    const rec = recipientFor(await recipients(shoot.id), seniorId);
    await pool.query("UPDATE staffing_plan_recipient SET acknowledgment_due_at = now() - interval '1 hour' WHERE id = $1", [rec.id]);

    const overdue = recipientFor(await recipients(shoot.id), seniorId);
    expect(
      isPendingNotAcknowledged({
        responseStatus: overdue.response_status,
        publishedAt: new Date(Date.now() - 24 * 3600 * 1000),
        dueAt: overdue.acknowledgment_due_at,
        shootStartAt: new Date(Date.now() + 19 * 24 * 3600 * 1000),
        now: new Date()
      })
    ).toBe(true);

    await ackAs(seniorId, rec.id);

    const acked = recipientFor(await recipients(shoot.id), seniorId);
    expect(acked.response_status).toBe("acknowledged");
    expect(
      isPendingNotAcknowledged({
        responseStatus: acked.response_status,
        publishedAt: new Date(Date.now() - 24 * 3600 * 1000),
        dueAt: acked.acknowledgment_due_at,
        shootStartAt: new Date(Date.now() + 19 * 24 * 3600 * 1000),
        now: new Date()
      })
    ).toBe(false);
  });
});

describe("decline affects canonical readiness", () => {
  it("18. a decline immediately makes the plan operationally at risk (urgent-watch candidate)", async () => {
    const date = localDateString(10);
    const shoot = await makeShoot(date, "Decline At Risk");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const before = await candidatesForShoot(shoot.id);
    expect(before.some((c) => c.watch_type === "critical_role_gap")).toBe(false);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await declineAs(seniorId, seniorRec.id, "Double-booked that morning");

    const after = await candidatesForShoot(shoot.id);
    expect(after.some((c) => c.watch_type === "critical_role_gap" || c.watch_type === "staffing_gap")).toBe(true);
  });

  it("19. a declined published shift no longer satisfies accepted readiness (dashboard coverage)", async () => {
    const date = localDateString(1);
    const shoot = await makeShoot(date, "Decline Readiness");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const dashboardBefore = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDateString(0)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(dashboardBefore.status).toBe(200);
    const beforeRow = dashboardBefore.body.open_coverage.find((row: any) => row.shoot_id === shoot.id);
    expect(!beforeRow || beforeRow.missing_lead === false).toBe(true); // lead covered before decline

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await declineAs(seniorId, seniorRec.id, "Cannot make this shoot");

    const dashboardAfter = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDateString(0)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const afterRow = dashboardAfter.body.open_coverage.find((row: any) => row.shoot_id === shoot.id);
    expect(afterRow).toBeTruthy();
    expect(afterRow.missing_lead).toBe(true); // the declined lead no longer counts as covered
  });

  it("20. reassignment and a newer version supersede the old pending recipient", async () => {
    const date = localDateString(12);
    const shoot = await makeShoot(date, "Reassignment Supersede");
    const seniorShift = await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    expect(seniorRec.response_status).toBe("pending");

    // Reassign: cancel senior, assign office to the lead role, republish.
    await pool.query("UPDATE work_shift SET status = 'cancelled', cancelled_at = now() WHERE id = $1 AND tenant_id = $2", [
      seniorShift.id,
      tenantId
    ]);
    await seedShift(shoot.id, officeId, { date, lead: true });
    await recordPublish(shoot.id);

    const current = await recipients(shoot.id);
    expect(current.map((r) => r.employee_user_id)).toEqual([officeId]); // senior no longer current
    const all = await recipients(shoot.id, { currentOnly: false });
    const priorSenior = all.find((r) => r.id === seniorRec.id);
    expect(priorSenior!.superseded_at).not.toBeNull();
  });
});

describe("acknowledgment RBAC + ownership", () => {
  it("21. employee response actions are rejected against another employee's recipient record", async () => {
    const date = localDateString(13);
    const shoot = await makeShoot(date, "Ownership Guard");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);

    let declineError: any;
    try {
      await declineAs(officeId, seniorRec.id, "Not mine to decline");
    } catch (error) {
      declineError = error;
    }
    expect(declineError).toBeTruthy();
    expect(declineError.status ?? declineError.statusCode).toBe(403);

    let ackError: any;
    try {
      await ackAs(officeId, seniorRec.id);
    } catch (error) {
      ackError = error;
    }
    expect(ackError).toBeTruthy();
    expect(ackError.status ?? ackError.statusCode).toBe(403);
  });

  it("22. field employees cannot assign or publish staffing", async () => {
    const date = localDateString(14);
    const shoot = await makeShoot(date, "RBAC Guard");
    const snapshot = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadSlot = snapshot.body.slots.find((slot: any) => slot.satisfies_lead_coverage);

    const assignAsPhoto = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ slot_key: leadSlot.slot_key, assigned_user_id: photoId });
    expect(assignAsPhoto.status).toBe(403);

    const publishAsPhoto = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ override_warnings: false });
    expect(publishAsPhoto.status).toBe(403);
  });
});

describe("guardrails: raw-vs-accepted, version scoping, notes, publish sync, atomicity", () => {
  it("23. (G1) a decline keeps raw assignment truth + the employee name visible while flipping readiness at-risk", async () => {
    const date = localDateString(2);
    const shoot = await makeShoot(date, "Raw vs Accepted");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await declineAs(seniorId, seniorRec.id, "Conflict that morning");

    const dashboard = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDateString(0)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(dashboard.status).toBe(200);
    const row = dashboard.body.open_coverage.find((r: any) => r.shoot_id === shoot.id);
    expect(row).toBeTruthy();
    // Operational readiness becomes at risk...
    expect(row.missing_lead).toBe(true);
    expect(row.operational_readiness_status).toBe("at_risk");
    expect(row.replacement_required).toBe(true);
    // ...but raw assignment truth + the declined employee name stay visible (NOT "nobody assigned").
    expect(row.assigned_staff_count).toBe(2); // raw, unchanged by the decline
    expect(row.coverage_eligible_staff_count).toBe(1); // the declined lead drops out of position coverage
    expect(row.declined_staff_count).toBe(1);
    expect(row.lead_assigned).toBe(true); // still assigned (raw truth)
    expect(row.lead_name).toBeTruthy();
    expect(row.declined_lead_name).toBe(row.lead_name);
  });

  it("24. (G2) a historical decline is version-scoped: a v2 replacement is not excluded and follows its own state", async () => {
    const date = localDateString(3);
    const shoot = await makeShoot(date, "Version Scoped Decline");
    const seniorShift = await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id); // v1

    const seniorRec = recipientFor(await recipients(shoot.id), seniorId);
    await declineAs(seniorId, seniorRec.id, "Cannot attend"); // readiness at risk
    expect((await candidatesForShoot(shoot.id)).some((c) => c.watch_type === "critical_role_gap")).toBe(true);

    // Reassign: cancel senior, bring in admin as the replacement lead, republish (v2).
    await pool.query("UPDATE work_shift SET status = 'cancelled', cancelled_at = now() WHERE id = $1 AND tenant_id = $2", [
      seniorShift.id,
      tenantId
    ]);
    await seedShift(shoot.id, adminId, { date, lead: true });
    await recordPublish(shoot.id); // v2

    // The historical v1 decline remains visible...
    const all = await recipients(shoot.id, { currentOnly: false });
    const priorSenior = all.find((r) => r.id === seniorRec.id);
    expect(priorSenior!.response_status).toBe("declined");
    expect(priorSenior!.superseded_at).not.toBeNull();

    // ...but it does not mark v2 declined: the replacement lead follows its own pending state.
    const current = await recipients(shoot.id);
    const adminRec = current.find((r) => r.employee_user_id === adminId);
    expect(adminRec).toBeTruthy();
    expect(adminRec!.response_status).toBe("pending");
    expect(current.some((r) => r.employee_user_id === seniorId)).toBe(false);

    // Readiness recovers — the v1 decline does not permanently exclude the v2 replacement lead.
    expect((await candidatesForShoot(shoot.id)).some((c) => c.watch_type === "critical_role_gap")).toBe(false);
  });

  it("25. (G3) changing internal work_shift.notes does not create a new version", async () => {
    const date = localDateString(33);
    const shoot = await makeShoot(date, "Notes Excluded");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    await pool.query(
      "UPDATE work_shift SET notes = $1, updated_at = now() WHERE tenant_id = $2 AND shoot_id = $3 AND assigned_user_id = $4 AND cancelled_at IS NULL",
      ["Internal manager-only note change", tenantId, shoot.id, seniorId]
    );
    const second = await recordPublish(shoot.id);

    expect(second.status).toBe("unchanged");
    expect((await versions(shoot.id)).length).toBe(1);
  });

  it("26. (G5) an unchanged-plan republish still synchronizes canonical shift publication", async () => {
    const date = localDateString(16);
    const shoot = await makeShoot(date, "Publish Sync");

    const snap = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadSlot = snap.body.slots.find((s: any) => s.satisfies_lead_coverage);
    const leadOpt = leadSlot.option_groups.flatMap((g: any) => g.options).find((o: any) => !o.disabled);
    await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ slot_key: leadSlot.slot_key, assigned_user_id: leadOpt.user_id, override_conflict: Boolean(leadOpt.requires_override), approval_reason: "Test" });

    const pub1 = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ override_warnings: true, approval_reason: "Test" });
    expect(pub1.status).toBe(200);
    expect((await versions(shoot.id)).length).toBe(1);

    // Non-material edit: revert the published shift(s) to draft — the material plan hash is unchanged.
    await pool.query("UPDATE work_shift SET status = 'draft' WHERE tenant_id = $1 AND shoot_id = $2 AND status = 'published'", [
      tenantId,
      shoot.id
    ]);
    const draftBefore = await selectRows<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM work_shift WHERE tenant_id = $1 AND shoot_id = $2 AND status = 'draft' AND cancelled_at IS NULL",
      [tenantId, shoot.id]
    );
    expect(Number(draftBefore[0].n)).toBeGreaterThan(0);

    // Republish: no new version (unchanged plan) BUT the draft is re-published (not "nothing to publish").
    const pub2 = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ override_warnings: true, approval_reason: "Test" });
    expect(pub2.status).toBe(200);
    expect((await versions(shoot.id)).length).toBe(1);
    const draftAfter = await selectRows<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM work_shift WHERE tenant_id = $1 AND shoot_id = $2 AND status = 'draft' AND cancelled_at IS NULL",
      [tenantId, shoot.id]
    );
    expect(Number(draftAfter[0].n)).toBe(0);
  });

  it("27. (G6) a failure after recipient + outbox creation rolls back the whole transaction atomically", async () => {
    const date = localDateString(17);
    const shoot = await makeShoot(date, "Atomic Rollback");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });

    await expect(
      withClientTransaction(tenantId, leadershipId, async (client) => {
        await recordStaffingPlanPublication(client, leadAuth(), { shootId: shoot.id });
        throw new Error("forced failure after recipient/outbox creation");
      })
    ).rejects.toThrow("forced failure");

    // Nothing partial survives the rollback.
    expect((await versions(shoot.id)).length).toBe(0);
    expect((await recipients(shoot.id, { currentOnly: false })).length).toBe(0);
    expect(await publishEventCount(shoot.id)).toBe(0);
  });
});

describe("guardrails round 2: snapshot schema, multiset identity, grace, notifications, RLS", () => {
  it("28. (#2a) recreating the same material commitment with a new shift id produces no new recipient hash", async () => {
    const date = localDateString(34);
    const shoot = await makeShoot(date, "Stable Identity");
    const first = await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);
    const before = recipientFor(await recipients(shoot.id), seniorId);

    // Cancel the shift and re-create an identical-material one (new row id only).
    await pool.query("UPDATE work_shift SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [first.id]);
    await seedShift(shoot.id, seniorId, { date, lead: true });
    const result = await recordPublish(shoot.id);

    expect(result.status).toBe("unchanged"); // identical material -> no new version
    const after = recipientFor(await recipients(shoot.id), seniorId);
    expect(after.recipient_hash).toBe(before.recipient_hash);
  });

  it("29. (#2b) moving the employee to a different material assignment changes the recipient hash", async () => {
    const date = localDateString(36);
    const shoot = await makeShoot(date, "Material Identity");
    await seedShift(shoot.id, seniorId, { date, lead: true, role: "photographer" });
    await recordPublish(shoot.id);
    const before = recipientFor(await recipients(shoot.id), seniorId);

    await pool.query(
      "UPDATE work_shift SET staffing_role = 'senior_photographer', updated_at = now() WHERE tenant_id = $1 AND shoot_id = $2 AND assigned_user_id = $3 AND cancelled_at IS NULL",
      [tenantId, shoot.id, seniorId]
    );
    const result = await recordPublish(shoot.id);

    expect(result.status).toBe("created"); // material change -> new version
    const after = recipientFor(await recipients(shoot.id), seniorId);
    expect(after.recipient_hash).not.toBe(before.recipient_hash);
  });

  it("30. (#2c/#2d) identical material assignments are a sorted multiset, not deduplicated", async () => {
    const date = localDateString(35);
    const shoot = await makeShoot(date, "Multiset Identity");
    const first = await seedShift(shoot.id, seniorId, { date, lead: true });
    // Clone the shift -> a second IDENTICAL-material assignment (only the row id differs).
    await pool.query(
      `INSERT INTO work_shift
       SELECT (jsonb_populate_record(NULL::work_shift, (to_jsonb(ws) - 'id') || jsonb_build_object('id', gen_random_uuid()))).*
       FROM work_shift ws WHERE ws.id = $1`,
      [first.id]
    );
    await recordPublish(shoot.id);
    const recTwo = recipientFor(await recipients(shoot.id), seniorId);
    expect((recTwo.assignment_snapshot as any).assignments.length).toBe(2); // not deduplicated
    const hashWithTwo = recTwo.recipient_hash;

    // Remove one of the two identical assignments -> recipient + plan hash change -> new version.
    await pool.query("UPDATE work_shift SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [first.id]);
    const result = await recordPublish(shoot.id);
    expect(result.status).toBe("created");
    const recOne = recipientFor(await recipients(shoot.id), seniorId);
    expect((recOne.assignment_snapshot as any).assignments.length).toBe(1);
    expect(recOne.recipient_hash).not.toBe(hashWithTwo);
  });

  it("31. the recipient snapshot retains source_shift_id + snapshot_schema_version for traceability", async () => {
    const date = localDateString(37);
    const shoot = await makeShoot(date, "Snapshot Trace");
    const shift = await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    const rows = await selectRows<{ snapshot_schema_version: number; assignment_snapshot: any }>(
      "SELECT snapshot_schema_version, assignment_snapshot FROM staffing_plan_recipient WHERE tenant_id = $1 AND shoot_id = $2 AND superseded_at IS NULL",
      [tenantId, shoot.id]
    );
    expect(rows[0].snapshot_schema_version).toBe(1);
    expect(rows[0].assignment_snapshot.snapshot_schema_version).toBe(1);
    expect(rows[0].assignment_snapshot.assignments[0].source_shift_id).toBe(shift.id);
  });

  it("32. (#6) grace-period boundaries are deterministic and capped at shoot start", () => {
    const nowMs = new Date("2026-06-01T12:00:00.000Z").getTime();
    const graceMs = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY.gracePeriodMinutes * 60 * 1000;
    const publishedAt = new Date(nowMs);
    const within72h = new Date(nowMs + 24 * 3600 * 1000); // shoot inside the escalation window
    const farDue = new Date(nowMs + 10 * 24 * 3600 * 1000);
    const base = { responseStatus: "pending", publishedAt, dueAt: farDue, shootStartAt: within72h } as const;

    // 1ms before grace expiration -> not urgent (still awaiting).
    expect(isPendingNotAcknowledged({ ...base, now: new Date(nowMs + graceMs - 1) })).toBe(false);
    // exactly at grace expiration -> grace is over (inclusive) -> urgent inside 72h.
    expect(isPendingNotAcknowledged({ ...base, now: new Date(nowMs + graceMs) })).toBe(true);
    // 1ms after grace expiration -> urgent inside 72h.
    expect(isPendingNotAcknowledged({ ...base, now: new Date(nowMs + graceMs + 1) })).toBe(true);
    // newly published inside 72h -> visible pending but NOT urgent during grace.
    expect(isPendingNotAcknowledged({ ...base, now: new Date(nowMs) })).toBe(false);
    expect(isPastPublicationGrace(publishedAt, new Date(nowMs), within72h)).toBe(false);
    // publication < grace before shoot start -> grace boundary is capped at the shoot start.
    const shootSoon = new Date(nowMs + 5 * 60 * 1000); // 5 min out (< 15 min grace)
    expect(publicationGraceBoundary(publishedAt, shootSoon)!.getTime()).toBe(shootSoon.getTime());
    // explicit decline -> not a "pending not acknowledged" case (its risk is immediate via readiness).
    expect(
      isPendingNotAcknowledged({ responseStatus: "declined", publishedAt, dueAt: farDue, shootStartAt: within72h, now: new Date(nowMs + graceMs + 1) })
    ).toBe(false);
  });

  it("33. (#7) the recipient_published marker is a lifecycle/outbox event, never a second delivery", async () => {
    const date = localDateString(38);
    const shoot = await makeShoot(date, "Notification Marker");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id);

    const markers = await selectRows<{ event_type: string }>(
      "SELECT event_type FROM app_event WHERE tenant_id = $1 AND payload->>'shoot_id' = $2 AND event_type = 'staffing.plan.recipient_published'",
      [tenantId, shoot.id]
    );
    expect(markers.length).toBe(1);
    // The marker is NOT a notification.dispatch, so the worker projector never delivers a copy of it.
    const dispatched = await selectRows<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM app_event WHERE tenant_id = $1 AND event_type = 'notification.dispatch' AND payload->>'notification_type' = 'staffing.plan.recipient_published'",
      [tenantId]
    );
    expect(Number(dispatched[0].n)).toBe(0);
  });

  it("34. (#7) the legacy aggregate publish notification fires once and is idempotent on unchanged republish", async () => {
    const date = localDateString(16);
    const shoot = await makeShoot(date, "Legacy Notification");
    const snap = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadSlot = snap.body.slots.find((s: any) => s.satisfies_lead_coverage);
    // Assign someone OTHER than the publishing actor so the legacy aggregate has a real recipient.
    const leadOpt = leadSlot.option_groups
      .flatMap((g: any) => g.options)
      .find((o: any) => !o.disabled && o.user_id !== leadershipId);
    await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ slot_key: leadSlot.slot_key, assigned_user_id: leadOpt.user_id, override_conflict: Boolean(leadOpt.requires_override), approval_reason: "Test" });

    const aggregateCount = async () =>
      Number(
        (
          await selectRows<{ n: string }>(
            "SELECT COUNT(*)::int AS n FROM app_event WHERE tenant_id = $1 AND event_type = 'notification.dispatch' AND payload->>'notification_type' = 'schedule.staffing.published' AND payload->>'shoot_id' = $2",
            [tenantId, shoot.id]
          )
        )[0].n
      );

    await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ override_warnings: true, approval_reason: "Test" });
    const afterFirst = await aggregateCount();
    expect(afterFirst).toBeGreaterThan(0); // delivered to the assigned recipient(s)

    await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ override_warnings: true, approval_reason: "Test" });
    expect(await aggregateCount()).toBe(afterFirst); // unchanged republish -> no additional delivery
  });

  it("35. (#9) a rolled-back republish leaves the prior version's recipients un-superseded", async () => {
    const date = localDateString(39);
    const shoot = await makeShoot(date, "Rollback No Supersede");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await recordPublish(shoot.id); // v1 commits
    const v1Recipient = recipientFor(await recipients(shoot.id), seniorId);
    expect(v1Recipient.superseded_at).toBeNull();

    await bumpShiftTime(shoot.id, seniorId); // material change -> v2 would supersede v1
    await expect(
      withClientTransaction(tenantId, leadershipId, async (client) => {
        await recordStaffingPlanPublication(client, leadAuth(), { shootId: shoot.id });
        throw new Error("forced failure during v2");
      })
    ).rejects.toThrow("forced failure");

    // The rolled-back v2 left no trace: still one version, v1 recipient still current.
    expect((await versions(shoot.id)).length).toBe(1);
    const after = recipientFor(await recipients(shoot.id), seniorId);
    expect(after.id).toBe(v1Recipient.id);
    expect(after.superseded_at).toBeNull();
  });

  it("36. (#10) the new tables enforce app-role access, forced RLS, tenant isolation, and the composite FK", async () => {
    const date = localDateString(40);
    const shoot = await makeShoot(date, "RLS Exercise");
    await seedShift(shoot.id, seniorId, { date, lead: true });

    // (a) the application role (pmc_app) can INSERT via the service transaction.
    await recordPublish(shoot.id);
    // (b) pmc_app can SELECT within its own tenant.
    const inTenant = await withClientTransaction(tenantId, leadershipId, (c) =>
      c.query("SELECT COUNT(*)::int AS n FROM staffing_plan_version WHERE shoot_id = $1", [shoot.id])
    );
    expect(Number(inTenant.rows[0].n)).toBeGreaterThan(0);
    // (c) forced RLS + cross-tenant denial: a different tenant context sees nothing.
    const crossTenant = await withClientTransaction(randomUUID(), leadershipId, (c) =>
      c.query("SELECT COUNT(*)::int AS n FROM staffing_plan_version WHERE shoot_id = $1", [shoot.id])
    );
    expect(Number(crossTenant.rows[0].n)).toBe(0);
    // (d) pmc_app can UPDATE a recipient response within its tenant.
    const rec = recipientFor(await recipients(shoot.id), seniorId);
    await withClientTransaction(tenantId, leadershipId, (c) =>
      c.query("UPDATE staffing_plan_recipient SET updated_at = now() WHERE id = $1", [rec.id])
    );
    // (e) the composite tenant-safe FK rejects a recipient whose tenant != its version's tenant.
    const otherTenant = await selectRows<{ id: string }>("SELECT id FROM tenant WHERE id <> $1 LIMIT 1", [tenantId]);
    if (otherTenant.length) {
      const version = await selectRows<{ id: string }>(
        "SELECT id FROM staffing_plan_version WHERE shoot_id = $1 LIMIT 1",
        [shoot.id]
      );
      await expect(
        pool.query(
          "INSERT INTO staffing_plan_recipient (tenant_id, staffing_plan_version_id, shoot_id, employee_user_id, recipient_hash) VALUES ($1, $2, $3, $4, 'fk-test')",
          [otherTenant[0].id, version[0].id, shoot.id, seniorId]
        )
      ).rejects.toThrow();
    }
  });
});

describe("guardrails round 3: coverage-eligible naming + nullable publishedAt", () => {
  it("37. (#2) a nullable/unresolvable publishedAt carries no acknowledgment obligation (not urgent + data-integrity flag)", () => {
    const nowMs = new Date("2026-06-01T12:00:00.000Z").getTime();
    const grace = DEFAULT_STAFFING_ACKNOWLEDGMENT_POLICY.gracePeriodMinutes * 60 * 1000;
    const within72h = new Date(nowMs + 24 * 3600 * 1000);
    const farDue = new Date(nowMs + 10 * 24 * 3600 * 1000);
    const pastDue = new Date(nowMs - 3600 * 1000);
    const publishedLongAgo = new Date(nowMs - 24 * 3600 * 1000);

    // draft/unpublished recipient (null publishedAt) -> not urgent, flagged for the caller.
    const unpublished = evaluateAcknowledgmentUrgency({ responseStatus: "pending", publishedAt: null, dueAt: pastDue, shootStartAt: within72h, now: new Date(nowMs) });
    expect(unpublished.urgent).toBe(false);
    expect(unpublished.missingPublicationTime).toBe(true);
    expect(isPendingNotAcknowledged({ responseStatus: "pending", publishedAt: null, dueAt: pastDue, shootStartAt: within72h, now: new Date(nowMs) })).toBe(false);

    // published recipient during grace -> not urgent, no integrity issue.
    const duringGrace = evaluateAcknowledgmentUrgency({ responseStatus: "pending", publishedAt: new Date(nowMs), dueAt: farDue, shootStartAt: within72h, now: new Date(nowMs + grace - 1) });
    expect(duringGrace.urgent).toBe(false);
    expect(duringGrace.missingPublicationTime).toBe(false);

    // exactly at the grace boundary inside 72h -> urgent.
    expect(evaluateAcknowledgmentUrgency({ responseStatus: "pending", publishedAt: new Date(nowMs), dueAt: farDue, shootStartAt: within72h, now: new Date(nowMs + grace) }).urgent).toBe(true);
    // published recipient with a passed deadline -> urgent.
    expect(evaluateAcknowledgmentUrgency({ responseStatus: "pending", publishedAt: publishedLongAgo, dueAt: pastDue, shootStartAt: farDue, now: new Date(nowMs) }).urgent).toBe(true);
    // declined -> immediate risk via readiness, NOT a pending-not-ack case (never urgent here).
    expect(evaluateAcknowledgmentUrgency({ responseStatus: "declined", publishedAt: new Date(nowMs), dueAt: pastDue, shootStartAt: within72h, now: new Date(nowMs + grace + 1) }).urgent).toBe(false);
    // malformed CURRENT recipient missing publication metadata -> safely non-urgent + flagged.
    const malformed = evaluateAcknowledgmentUrgency({ responseStatus: "pending", publishedAt: "not-a-date", dueAt: pastDue, shootStartAt: within72h, now: new Date(nowMs) });
    expect(malformed.urgent).toBe(false);
    expect(malformed.missingPublicationTime).toBe(true);
  });

  it("38. (#1) the coverage row separates position coverage, acknowledgment state, and operational readiness", async () => {
    const date = localDateString(1);
    const shoot = await makeShoot(date, "Operational Readiness");
    await seedShift(shoot.id, seniorId, { date, lead: true });
    await seedShift(shoot.id, officeId, { date, lead: false });
    await recordPublish(shoot.id);

    // Acknowledge office; leave senior (the lead) pending and force its acknowledgment overdue.
    const recs = await recipients(shoot.id);
    await ackAs(officeId, recipientFor(recs, officeId).id);
    await pool.query("UPDATE staffing_plan_recipient SET acknowledgment_due_at = now() - interval '1 hour' WHERE id = $1", [
      recipientFor(recs, seniorId).id
    ]);

    const dashboard = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDateString(0)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const row = dashboard.body.open_coverage.find((r: any) => r.shoot_id === shoot.id);
    expect(row).toBeTruthy(); // surfaced because an acknowledgment is overdue
    // "Lead assigned, but confirmation overdue": position covered, yet operationally at risk.
    expect(row.operational_readiness_status).toBe("confirmation_overdue");
    expect(row.missing_lead).toBe(false); // a pending (non-declined) lead still COVERS the position
    expect(row.coverage_eligible_staff_count).toBe(2);
    expect(row.lead_assigned).toBe(true);
    expect(row.pending_acknowledgment_count).toBe(1);
    expect(row.acknowledged_staff_count).toBe(1);
    expect(row.overdue_acknowledgment_count).toBe(1);

    // Acknowledge the overdue lead -> no longer overdue -> operationally ready / off the at-risk list.
    await ackAs(seniorId, recipientFor(recs, seniorId).id);
    const dashboard2 = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDateString(0)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const row2 = dashboard2.body.open_coverage.find((r: any) => r.shoot_id === shoot.id);
    expect(!row2 || row2.operational_readiness_status === "ready").toBe(true);
  });
});
