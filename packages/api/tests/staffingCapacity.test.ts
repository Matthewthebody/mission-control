import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import { recordStaffingPlanPublication } from "../src/services/staffingPlanLifecycle.js";
import {
  getStaffingCapacityPlan,
  type CapacityRequest,
  type StaffingCapacityPlan
} from "../src/services/staffingCapacity.js";

// Staffing Capacity Planning — canonical read model (real Postgres). Slice 3, commit 1.
// All instants are explicit UTC (Z). Test dates are summer 2027 (America/Chicago = CDT, UTC-5) so a
// Chicago wall-clock hour H maps to UTC hour H+5 on the same operating date, independent of the host TZ.

const app = createApp();

let tenantId: string;
let studioId: string;
let schoolOrganizationId: string;
let schoolLocationId: string;
let schoolPrimaryContactId: string;
let adminToken: string;
let photoToken: string;
let leadershipId: string;
let photoId: string;
let seniorId: string;
let officeId: string;
let otherTenantId: string;
let otherTenantUserId: string;

/** UTC ISO for a Chicago wall-clock hour on a summer (CDT) operating date. Keep chicagoHour <= 18. */
function Z(date: string, chicagoHour: number, minute = 0) {
  const utcHour = chicagoHour + 5;
  return `${date}T${String(utcHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function isoAtLocal(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

const capAuth = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "leadership",
    department: "executive",
    jobFunctionProfiles: [],
    permissions: ["schedule.manage", "schedule.read"],
    roles: [],
    ...over
  }) as unknown as AuthUser;

function planFor(auth: AuthUser, requestInput: CapacityRequest): Promise<StaffingCapacityPlan> {
  return withClientTransaction(auth.tenantId, auth.id, (client) => getStaffingCapacityPlan(client, auth, requestInput));
}

const week = (auth: AuthUser, anchorDate: string, filters?: CapacityRequest["filters"]) =>
  planFor(auth, { window: "week", anchorDate, filters });

const empOf = (plan: StaffingCapacityPlan, userId: string) =>
  plan.employees.find((employee) => employee.employee_user_id === userId);

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
      arrival_time: isoAtLocal(date, "08:45"),
      start_time: isoAtLocal(date, "09:00"),
      end_time_est: isoAtLocal(date, "12:00"),
      projected_students: 48,
      planned_staff_count: 2,
      required_lead_count: 1
    });
  expect(response.status).toBe(201);
  await pool.query("UPDATE shoot SET record_state = 'published'::shoot_record_state WHERE id = $1 AND tenant_id = $2", [
    response.body.id,
    tenantId
  ]);
  return response.body.id as string;
}

async function seedShift(
  shootId: string,
  userId: string,
  options: {
    date: string;
    startHour: number;
    endHour: number;
    department?: string;
    role?: string;
    lead?: boolean;
    publish?: boolean;
    location?: string;
  }
) {
  const startsAt = Z(options.date, options.startHour);
  const endsAt = Z(options.date, options.endHour);
  const response = await request(app)
    .post("/api/shifts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      shoot_id: shootId,
      assigned_user_id: userId,
      manager_user_id: leadershipId,
      shift_kind: "shoot",
      department: options.department ?? "schools",
      staffing_role: options.role ?? "photographer",
      satisfies_lead_coverage: Boolean(options.lead),
      title: `Coverage ${userId.slice(0, 4)}`,
      starts_at: startsAt,
      ends_at: endsAt,
      location_name: options.location ?? "Capacity Test Site",
      location_address: "123 Capacity Way, Minneapolis, MN",
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
  const shiftId = response.body.id as string;
  if (options.publish !== false) {
    await pool.query("UPDATE work_shift SET status = 'published', published_at = now() WHERE id = $1 AND tenant_id = $2", [
      shiftId,
      tenantId
    ]);
  }
  return shiftId;
}

/** Seed a shift at explicit UTC instants (for DST / cross-midnight assertions). */
async function seedShiftAt(
  shootId: string,
  userId: string,
  startIso: string,
  endIso: string,
  options: { department?: string; role?: string; lead?: boolean; publish?: boolean } = {}
) {
  const response = await request(app)
    .post("/api/shifts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      shoot_id: shootId,
      assigned_user_id: userId,
      manager_user_id: leadershipId,
      shift_kind: "shoot",
      department: options.department ?? "schools",
      staffing_role: options.role ?? "photographer",
      satisfies_lead_coverage: Boolean(options.lead),
      title: `Coverage ${userId.slice(0, 4)}`,
      starts_at: startIso,
      ends_at: endIso,
      location_name: "Capacity Test Site",
      location_address: "123 Capacity Way, Minneapolis, MN",
      segments: [
        {
          segment_kind: "shoot",
          label: "Coverage",
          scheduled_start_at: startIso,
          scheduled_end_at: endIso,
          rate_code: "shoot",
          hourly_rate_cents: 2500
        }
      ]
    });
  expect(response.status).toBe(201);
  const shiftId = response.body.id as string;
  if (options.publish !== false) {
    await pool.query("UPDATE work_shift SET status = 'published', published_at = now() WHERE id = $1 AND tenant_id = $2", [
      shiftId,
      tenantId
    ]);
  }
  return shiftId;
}

// All capacity fixtures live in the far-future 2027 window (no real or other-suite data there), so the
// suite is idempotent across re-runs: remove the accumulated work_shifts (and their segments) and the
// availability fixtures before seeding. Per-run shoots/recipients are unique, so stale ones are harmless.
async function cleanupFixtureWindow() {
  await pool.query(
    `DELETE FROM shift_segment WHERE shift_id IN (
       SELECT id FROM work_shift WHERE tenant_id = $1 AND starts_at >= '2027-01-01' AND starts_at < '2028-01-01')`,
    [tenantId]
  );
  await pool.query(
    "DELETE FROM work_shift WHERE tenant_id = $1 AND starts_at >= '2027-01-01' AND starts_at < '2028-01-01'",
    [tenantId]
  );
  await pool.query(
    "DELETE FROM staffing_blocked_date WHERE tenant_id = $1 AND starts_at >= '2027-01-01' AND starts_at < '2028-01-01'",
    [tenantId]
  );
  await pool.query(
    "DELETE FROM pto_request WHERE tenant_id = $1 AND starts_on >= '2027-01-01' AND starts_on < '2028-01-01'",
    [tenantId]
  );
}

async function publishPlan(shootId: string) {
  return withClientTransaction(tenantId, leadershipId, (client) =>
    recordStaffingPlanPublication(client, capAuth({}), { shootId })
  );
}

async function setResponse(shootId: string, userId: string, status: "pending" | "acknowledged" | "declined" | "canceled") {
  await pool.query(
    `UPDATE staffing_plan_recipient SET response_status = $1
     WHERE tenant_id = $2 AND shoot_id = $3 AND employee_user_id = $4 AND superseded_at IS NULL`,
    [status, tenantId, shootId, userId]
  );
}

async function cancelShift(shiftId: string) {
  await pool.query(
    "UPDATE work_shift SET status = 'cancelled', cancelled_at = now() WHERE id = $1 AND tenant_id = $2",
    [shiftId, tenantId]
  );
}

async function seedHardBlock(userId: string, date: string) {
  await pool.query(
    `INSERT INTO staffing_blocked_date (tenant_id, target_scope, target_user_id, block_type, block_severity, label, starts_at, ends_at)
     VALUES ($1, 'user', $2, 'manager_blocked_day', 'hard', 'Manager block', $3::timestamptz, $4::timestamptz)`,
    [tenantId, userId, `${date}T00:00:00Z`, `${date}T23:59:00Z`]
  );
}

async function seedSoftPto(userId: string, date: string) {
  await pool.query(
    `INSERT INTO pto_request (tenant_id, user_id, department, starts_on, ends_on, status, all_day, request_type, warning_level)
     VALUES ($1, $2, 'schools', $3::date, $3::date, 'submitted', true, 'full_day_off', 'low')`,
    [tenantId, userId, date]
  );
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

  const other = await pool.query(
    `SELECT u.id AS user_id, u.tenant_id AS tenant_id
     FROM app_user u
     WHERE u.email = 'attendance-monitor-leadership@example.com'
     LIMIT 1`
  );
  otherTenantUserId = other.rows[0].user_id;
  otherTenantId = other.rows[0].tenant_id;

  adminToken = (await request(app).post("/auth/login").send({ email: "admin@example.com", password: "LocalDemo123!" })).body.token;
  photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;

  await cleanupFixtureWindow();
});

afterAll(async () => {
  await cleanupFixtureWindow();
});

describe("staffing capacity read model — lifecycle to capacity mapping", () => {
  it("1. an acknowledged published shift is scheduled, published, coverage-eligible, and confirmed", async () => {
    const date = "2027-06-07";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Ack", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);
    await setResponse(shootId, photoId, "acknowledged");

    const plan = await week(capAuth({}), date);
    const photo = empOf(plan, photoId);
    expect(photo).toBeTruthy();
    expect(photo!.raw_assigned_minutes).toBe(180);
    expect(photo!.unique_scheduled_minutes).toBe(180);
    expect(photo!.published_minutes).toBe(180);
    expect(photo!.coverage_eligible_minutes).toBe(180);
    expect(photo!.confirmed_minutes).toBe(180);
    expect(photo!.pending_confirmation_minutes).toBe(0);
    expect(photo!.declined_minutes).toBe(0);
    const assignment = photo!.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.lifecycle_state).toBe("acknowledged");
    expect(assignment.coverage_eligible).toBe(true);
  });

  it("2. a draft shift contributes raw assigned minutes only — not published or coverage-eligible", async () => {
    const date = "2027-06-14";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Draft", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12, publish: false });

    const plan = await week(capAuth({}), date);
    const photo = empOf(plan, photoId)!;
    expect(photo.raw_assigned_minutes).toBe(180);
    expect(photo.published_minutes).toBe(0);
    expect(photo.coverage_eligible_minutes).toBe(0);
    expect(photo.confirmed_minutes).toBe(0);
    expect(photo.assignments.find((a) => a.shoot_id === shootId)!.lifecycle_state).toBe("draft");
  });

  it("3. a published but unacknowledged shift is coverage-eligible and pending, never confirmed", async () => {
    const date = "2027-06-21";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Pending", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    expect(photo.coverage_eligible_minutes).toBe(180);
    expect(photo.pending_confirmation_minutes).toBe(180);
    expect(photo.confirmed_minutes).toBe(0);
    expect(photo.pending_assignment_count).toBe(1);
    expect(photo.assignments.find((a) => a.shoot_id === shootId)!.lifecycle_state).toBe("pending");
  });

  it("4. acknowledging moves minutes pending -> confirmed without changing the scheduled total", async () => {
    const date = "2027-06-28";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "AckMove", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);

    const before = empOf(await week(capAuth({}), date), photoId)!;
    expect(before.pending_confirmation_minutes).toBe(180);
    expect(before.confirmed_minutes).toBe(0);
    const scheduledBefore = before.unique_scheduled_minutes;

    await setResponse(shootId, photoId, "acknowledged");
    const after = empOf(await week(capAuth({}), date), photoId)!;
    expect(after.pending_confirmation_minutes).toBe(0);
    expect(after.confirmed_minutes).toBe(180);
    expect(after.unique_scheduled_minutes).toBe(scheduledBefore);
  });

  it("5. a declined shift stays visible and raw-counted but is removed from coverage-eligible", async () => {
    const date = "2027-07-05";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Declined", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);
    await setResponse(shootId, photoId, "declined");

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    expect(photo.raw_assigned_minutes).toBe(180);
    expect(photo.declined_minutes).toBe(180);
    expect(photo.coverage_eligible_minutes).toBe(0);
    expect(photo.confirmed_minutes).toBe(0);
    expect(photo.declined_assignment_count).toBe(1);
    const assignment = photo.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.lifecycle_state).toBe("declined");
    expect(assignment.coverage_eligible).toBe(false);
  });

  it("6. a cancelled shift is excluded from capacity entirely", async () => {
    const date = "2027-07-12";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Cancelled", date);
    const shiftId = await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await cancelShift(shiftId);

    // Photo is a scoped employee so still appears (zero-filled), but the cancelled shift contributes nothing.
    const photo = empOf(await week(capAuth({}), date), photoId)!;
    expect(photo.raw_assigned_minutes).toBe(0);
    expect(photo.assignment_count).toBe(0);
    expect(photo.assignments.some((a) => a.shoot_id === shootId)).toBe(false);
  });

  it("7. reassignment moves capacity from the cancelled original to the replacement", async () => {
    const date = "2027-07-19";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Reassign", date);
    const original = await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);
    await cancelShift(original);
    await seedShift(shootId, seniorId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);

    const plan = await week(capAuth({}), date);
    const photo = empOf(plan, photoId)!; // present as zero-hour after reassignment, capacity moved away
    expect(photo.coverage_eligible_minutes).toBe(0);
    expect(photo.assignment_count).toBe(0);
    const senior = empOf(plan, seniorId)!;
    expect(senior.coverage_eligible_minutes).toBe(180);
  });

  it("8. a superseded recipient version is never counted (current version only)", async () => {
    const date = "2027-07-26";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Superseded", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);
    // Simulate an old acknowledged version superseded by a newer plan: it must not surface as confirmed.
    await pool.query(
      `UPDATE staffing_plan_recipient SET superseded_at = now(), response_status = 'acknowledged'
       WHERE tenant_id = $1 AND shoot_id = $2 AND employee_user_id = $3 AND superseded_at IS NULL`,
      [tenantId, shootId, photoId]
    );

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    expect(photo.confirmed_minutes).toBe(0);
    expect(photo.pending_confirmation_minutes).toBe(0);
    expect(photo.coverage_eligible_minutes).toBe(180); // published shift with no current recipient
    expect(photo.assignments.find((a) => a.shoot_id === shootId)!.lifecycle_state).toBe("published");
  });
});

describe("staffing capacity read model — overlap, counts, availability", () => {
  it("9/10. overlapping assignments on one shoot: unique < raw, conflict flagged, assignment vs shoot count distinct", async () => {
    const date = "2027-08-02";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Overlap", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 }); // 09-12
    await seedShift(shootId, photoId, { date, startHour: 11, endHour: 14 }); // 11-14 (overlaps 1h)

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    expect(photo.raw_assigned_minutes).toBe(360);
    expect(photo.unique_scheduled_minutes).toBe(300);
    expect(photo.overlap_minutes).toBe(60);
    expect(photo.schedule_conflict_count).toBe(2);
    expect(photo.assignment_count).toBe(2);
    expect(photo.shoot_count).toBe(1);
    const day = photo.days.find((d) => d.operating_date === date)!;
    expect(day.scheduled_minutes).toBe(300);
    expect(day.raw_assigned_minutes).toBe(360);
    expect(day.overlap_minutes).toBe(60);
  });

  it("11. lead and non-lead assignments are surfaced distinctly", async () => {
    const date = "2027-08-09";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Lead", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 11, lead: true });
    await seedShift(shootId, photoId, { date, startHour: 12, endHour: 14, lead: false });

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    const lead = photo.assignments.filter((a) => a.satisfies_lead_coverage);
    const nonLead = photo.assignments.filter((a) => !a.satisfies_lead_coverage);
    expect(lead.length).toBe(1);
    expect(nonLead.length).toBe(1);
  });

  it("12. a hard availability block makes the assignment unavailable and the employee critical", async () => {
    const date = "2027-08-16";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "HardBlock", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);
    await seedHardBlock(photoId, date);

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    const assignment = photo.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.availability_state).toBe("unavailable");
    expect(photo.availability_warning_count).toBeGreaterThanOrEqual(1);
    expect(photo.warning_severity).toBe("critical");
    // Schedule-overlap and availability are kept as distinct signals (Outlook is a separate, empty source).
    expect(photo.schedule_conflict_count).toBe(0);
  });

  it("13. a soft pending PTO request warns without marking unavailable", async () => {
    const date = "2027-08-23";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "SoftBlock", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);
    await seedSoftPto(photoId, date);

    const photo = empOf(await week(capAuth({}), date), photoId)!;
    const assignment = photo.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.availability_state).toBe("available_with_warning");
    expect(photo.warning_severity).toBe("warning");
  });

  it("14. missing availability is reported honestly, never as confirmed-available", async () => {
    const date = "2027-08-30";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "NoAvail", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await publishPlan(shootId);

    const plan = await week(capAuth({}), date);
    const photo = empOf(plan, photoId)!;
    const assignment = photo.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.availability_state).toBe("availability_not_recorded"); // never "available"
    expect(photo.availability_warning_count).toBe(0);
    expect(plan.availability_source).toBe("block_list_only"); // absence of a block is not a positive "available"
    expect(plan.calendar_source).toBe("calendar_not_connected"); // Outlook stub: missing != "no conflict"
    expect(plan.capacity_target).toBeNull(); // no fabricated denominator
  });
});

describe("staffing capacity read model — windows, filters, RBAC", () => {
  it("15. day, week, and month windows reconcile to the same canonical intervals", async () => {
    const monday = "2027-09-06";
    const wednesday = "2027-09-08";
    const shootMon = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "ReconMon", monday);
    const shootWed = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "ReconWed", wednesday);
    await seedShift(shootMon, photoId, { date: monday, startHour: 9, endHour: 12 }); // 180
    await seedShift(shootWed, photoId, { date: wednesday, startHour: 9, endHour: 13 }); // 240

    const weekPlan = empOf(await week(capAuth({}), monday), photoId)!;
    const weekDayTotal = weekPlan.days.reduce((sum, d) => sum + d.scheduled_minutes, 0);
    const weekBucket = weekPlan.weeks.find((w) => w.week_start === "2027-09-06")!;
    expect(weekDayTotal).toBe(420);
    expect(weekBucket.scheduled_minutes).toBe(420);

    const dayPlan = empOf(await planFor(capAuth({}), { window: "day", anchorDate: wednesday }), photoId)!;
    expect(dayPlan.days.reduce((sum, d) => sum + d.scheduled_minutes, 0)).toBe(240);

    const monthPlan = empOf(await planFor(capAuth({}), { window: "month", anchorDate: monday }), photoId)!;
    const monthBucket = monthPlan.weeks.find((w) => w.week_start === "2027-09-06")!;
    expect(monthBucket.scheduled_minutes).toBe(420); // month rollup equals the week total
  });

  it("16. filters narrow by employee, role, status, and acknowledgment state", async () => {
    const date = "2027-09-13";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Filters", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12, role: "photographer" });
    await seedShift(shootId, seniorId, { date, startHour: 9, endHour: 12, role: "producer" });
    await publishPlan(shootId);
    await setResponse(shootId, photoId, "acknowledged");

    const byEmployee = await week(capAuth({}), date, { employeeUserId: photoId });
    expect(byEmployee.employees.every((e) => e.employee_user_id === photoId)).toBe(true);

    const byRole = await week(capAuth({}), date, { staffingRole: "producer" });
    expect(empOf(byRole, seniorId)).toBeTruthy();
    expect(empOf(byRole, photoId)).toBeUndefined();

    const byAck = await week(capAuth({}), date, { acknowledgmentState: "acknowledged" });
    expect(empOf(byAck, photoId)).toBeTruthy();
    expect(empOf(byAck, seniorId)).toBeUndefined();
  });

  it("17. the warning filter keeps only employees with the requested signal", async () => {
    const date = "2027-09-20";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "WarnFilter", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12 });
    await seedShift(shootId, photoId, { date, startHour: 11, endHour: 14 }); // overlap -> conflict
    await seedShift(shootId, seniorId, { date, startHour: 9, endHour: 12 }); // clean

    const overlapOnly = await week(capAuth({}), date, { warningState: "overlap" });
    expect(empOf(overlapOnly, photoId)).toBeTruthy();
    expect(empOf(overlapOnly, seniorId)).toBeUndefined();
  });

  it("18. a department-scoped manager only sees their department and cannot deep-link into another", async () => {
    const date = "2027-09-27";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Scope", date);
    await seedShift(shootId, photoId, { date, startHour: 9, endHour: 12, department: "schools" });
    await seedShift(shootId, seniorId, { date, startHour: 9, endHour: 12, department: "sports" });

    const schoolsAuth = capAuth({ authorityTier: "supervisor", department: "schools", permissions: ["schedule.manage"] });
    const scoped = await week(schoolsAuth, date);
    expect(scoped.scope).toBe("department");

    // Photo's schools shift contributes; senior (also a schools employee) appears but the out-of-department
    // sports shift does NOT contribute; an office employee (unauthorized department) is excluded entirely.
    expect(empOf(scoped, photoId)!.coverage_eligible_minutes).toBe(180);
    expect(empOf(scoped, seniorId)!.assignment_count).toBe(0);
    expect(empOf(scoped, officeId)).toBeUndefined();

    // A crafted deep link to a department the manager does not own yields nothing, not a bypass.
    const crossDept = await week(schoolsAuth, date, { department: "sports" });
    expect(crossDept.employees).toHaveLength(0);

    // Leadership ("all") sees both departments' assignments.
    const all = await week(capAuth({}), date);
    expect(empOf(all, photoId)!.coverage_eligible_minutes).toBe(180);
    expect(empOf(all, seniorId)!.coverage_eligible_minutes).toBe(180);
  });

  it("19. a user without manager schedule access is denied (service guard) and at the route (requireAction)", async () => {
    const noneAuth = capAuth({ authorityTier: "supervisor", department: "schools", permissions: [], jobFunctionProfiles: [], roles: [] });
    await expect(week(noneAuth, "2027-06-07")).rejects.toMatchObject({ status: 403 });

    const denied = await request(app)
      .get("/api/schedule/capacity?window=week")
      .set("Authorization", `Bearer ${photoToken}`);
    expect(denied.status).toBe(403);
  });

  it("20. capacity is tenant-isolated — another tenant's leadership never sees these shifts", async () => {
    const date = "2027-06-07";
    const otherAuth = capAuth({ id: otherTenantUserId, tenantId: otherTenantId });
    const plan = await planFor(otherAuth, { window: "week", anchorDate: date });
    expect(plan.employees.every((e) => e.employee_user_id !== photoId)).toBe(true);
  });

  it("21. the HTTP route returns a normalized plan for an authorized manager", async () => {
    const response = await request(app)
      .get("/api/schedule/capacity?window=week&anchor_date=2027-06-07")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.window).toBe("week");
    expect(response.body.timezone).toBe("America/Chicago");
    expect(response.body.week_definition).toBe("monday_sunday");
    expect(response.body.calendar_source).toBe("calendar_not_connected");
    expect(Array.isArray(response.body.employees)).toBe(true);
  });
});

describe("staffing capacity read model — zero-assignment roster inclusion", () => {
  it("22. a scoped employee with zero assignments appears (zero-filled) in week results", async () => {
    const plan = await week(capAuth({}), "2027-10-04"); // a clean week; office is never assigned
    const office = empOf(plan, officeId)!;
    expect(office).toBeTruthy();
    expect(office.raw_assigned_minutes).toBe(0);
    expect(office.unique_scheduled_minutes).toBe(0);
    expect(office.assignment_count).toBe(0);
    expect(office.shoot_count).toBe(0);
    expect(office.warning_severity).toBe("none"); // not "underutilized" — no canonical target exists
    expect(office.department).toBeTruthy(); // department preserved
    expect(plan.includes_zero_assignment_employees).toBe(true);
  });

  it("23. a zero-assignment employee appears in month results with zero-filled weekly rollups", async () => {
    const plan = await planFor(capAuth({}), { window: "month", anchorDate: "2027-10-04" });
    const office = empOf(plan, officeId)!;
    expect(office.assignment_count).toBe(0);
    expect(office.weeks.length).toBeGreaterThan(0);
    expect(office.weeks.every((w) => w.scheduled_minutes === 0)).toBe(true);
  });

  it("24. the employee filter can select a zero-assignment person", async () => {
    const plan = await week(capAuth({}), "2027-10-04", { employeeUserId: officeId });
    expect(plan.employees).toHaveLength(1);
    expect(plan.employees[0].employee_user_id).toBe(officeId);
    expect(plan.employees[0].assignment_count).toBe(0);
  });

  it("25. the day view is assignment-only and does not zero-fill the workforce", async () => {
    const date = "2027-10-05";
    const dayPlan = await planFor(capAuth({}), { window: "day", anchorDate: date });
    expect(dayPlan.includes_zero_assignment_employees).toBe(false);
    expect(empOf(dayPlan, officeId)).toBeUndefined(); // zero-hour office not listed on day view
    expect(empOf(await week(capAuth({}), date), officeId)).toBeTruthy(); // ...but the week view includes them
  });
});

describe("staffing capacity read model — window bounds + validation", () => {
  it("26. an unsupported view is rejected (400) at the route and the service", async () => {
    const res = await request(app).get("/api/schedule/capacity?window=year").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    await expect(
      planFor(capAuth({}), { window: "year" as unknown as CapacityRequest["window"], anchorDate: "2027-06-07" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("27. a malformed or non-real anchor date is rejected (400)", async () => {
    const badFormat = await request(app)
      .get("/api/schedule/capacity?window=week&anchor_date=June")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badFormat.status).toBe(400);
    // Regex-valid but not a real calendar date -> service rejects.
    await expect(planFor(capAuth({}), { window: "week", anchorDate: "2027-13-99" })).rejects.toMatchObject({ status: 400 });
  });

  it("28. day/week/month boundaries are exact and the month window stays bounded (no full-history pull)", async () => {
    const dayPlan = await planFor(capAuth({}), { window: "day", anchorDate: "2027-06-10" });
    expect(dayPlan.range_start).toBe("2027-06-10");
    expect(dayPlan.range_end).toBe("2027-06-10");

    const weekPlan = await planFor(capAuth({}), { window: "week", anchorDate: "2027-06-10" }); // Thursday
    expect(weekPlan.range_start).toBe("2027-06-07"); // Monday
    expect(weekPlan.range_end).toBe("2027-06-13"); // Sunday

    const monthPlan = await planFor(capAuth({}), { window: "month", anchorDate: "2027-06-10" });
    expect(monthPlan.month_start).toBe("2027-06-01");
    expect(monthPlan.month_end).toBe("2027-06-30");
    const spanDays =
      (new Date(`${monthPlan.range_end}T00:00:00Z`).getTime() - new Date(`${monthPlan.range_start}T00:00:00Z`).getTime()) /
        86400000 +
      1;
    expect(spanDays).toBeLessThanOrEqual(42); // complete weeks of one month, never all history
    expect(monthPlan.week_buckets.length).toBeLessThanOrEqual(6);
  });
});

describe("staffing capacity read model — timezone safety (service-level)", () => {
  it("29. spring-forward day: the skipped hour is never invented and bucketing is America/Chicago", async () => {
    const date = "2027-03-14";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Spring", date);
    // 01:00 CST (07:00Z) to 05:00 CDT (10:00Z): wall clock looks like 4h, only 3h elapsed.
    await seedShiftAt(shootId, photoId, "2027-03-14T07:00:00.000Z", "2027-03-14T10:00:00.000Z");
    const photo = empOf(await week(capAuth({}), date), photoId)!;
    const assignment = photo.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.duration_minutes).toBe(180);
    expect(assignment.operating_date).toBe("2027-03-14");
    expect(photo.days.find((d) => d.operating_date === "2027-03-14")!.scheduled_minutes).toBe(180);
  });

  it("30. fall-back day: the repeated hour counts once of real elapsed time", async () => {
    const date = "2027-11-07";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Fall", date);
    // 00:30 CDT (05:30Z) to 02:30 CST (08:30Z): wall clock looks like 2h, 3h elapsed.
    await seedShiftAt(shootId, photoId, "2027-11-07T05:30:00.000Z", "2027-11-07T08:30:00.000Z");
    const photo = empOf(await week(capAuth({}), date), photoId)!;
    const assignment = photo.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.duration_minutes).toBe(180);
    expect(assignment.operating_date).toBe("2027-11-07");
  });

  it("31. a late-evening shift buckets to its Chicago operating date, not the UTC date", async () => {
    const date = "2027-11-07";
    const shootId = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "LateNight", date);
    // 18:00-19:00 CST on Nov 7 = 00:00Z-01:00Z on Nov 8. Chicago date is Nov 7; a server-local ::date would say Nov 8.
    await seedShiftAt(shootId, seniorId, "2027-11-08T00:00:00.000Z", "2027-11-08T01:00:00.000Z");
    const senior = empOf(await week(capAuth({}), date), seniorId)!;
    const assignment = senior.assignments.find((a) => a.shoot_id === shootId)!;
    expect(assignment.operating_date).toBe("2027-11-07");
    expect(senior.days.some((d) => d.operating_date === "2027-11-07")).toBe(true);
    expect(senior.days.some((d) => d.operating_date === "2027-11-08")).toBe(false);
  });

  it("32. Monday/Sunday week edges resolve to the correct Monday-anchored week", async () => {
    // 2027-06-13 is a Sunday; it belongs to the week starting Monday 2027-06-07.
    const sunday = "2027-06-13";
    const sundayShoot = await createShoot(`CAP-${randomUUID().slice(0, 8)}`, "Sunday", sunday);
    await seedShift(sundayShoot, photoId, { date: sunday, startHour: 9, endHour: 12 });
    const sundayWeek = await week(capAuth({}), sunday);
    expect(sundayWeek.range_start).toBe("2027-06-07");
    expect(sundayWeek.range_end).toBe("2027-06-13");
    expect(empOf(sundayWeek, photoId)!.days.some((d) => d.operating_date === "2027-06-13")).toBe(true);

    // The next day (Monday 2027-06-14) rolls into a new week.
    const mondayWeek = await week(capAuth({}), "2027-06-14");
    expect(mondayWeek.range_start).toBe("2027-06-14");
  });
});

describe("staffing capacity read model — query behavior on a realistic fixture", () => {
  it("33. one bounded query set serves the whole week — no per-employee or per-day N+1", async () => {
    const perfMonday = "2027-10-11"; // a Monday
    const perfDates = ["2027-10-11", "2027-10-12", "2027-10-13", "2027-10-14", "2027-10-15"]; // Mon–Fri (5)
    const userIds = (
      await pool.query<{ id: string }>(
        "SELECT id::text AS id FROM app_user WHERE tenant_id = $1 AND is_active = true ORDER BY id LIMIT 40",
        [tenantId]
      )
    ).rows.map((r) => r.id);

    // Baseline assignment count for this week before our fixture, so the delta isolates exactly what we add.
    const baselineAssignments = (await week(capAuth({}), perfMonday)).summary.assignment_count;

    const shootIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      shootIds.push(await createShoot(`CAPPERF-${randomUUID().slice(0, 8)}`, `Perf ${i}`, perfDates[i % perfDates.length]));
    }

    // ~120 published shifts: 40 employees × 3 shifts spread across all five weekdays and six shoots.
    let shiftCount = 0;
    for (const userId of userIds) {
      for (let n = 0; n < 3; n++) {
        const date = perfDates[shiftCount % perfDates.length];
        await pool.query(
          `INSERT INTO work_shift
             (tenant_id, assigned_user_id, shoot_id, shift_kind, status, department, title, starts_at, ends_at, location_name, staffing_role)
           VALUES ($1, $2, $3, 'shoot', 'published', 'schools', $4, $5::timestamptz, $6::timestamptz, 'Perf Site', 'photographer')`,
          [tenantId, userId, shootIds[shiftCount % shootIds.length], `Perf ${shiftCount}`, Z(date, 9), Z(date, 13)]
        );
        shiftCount += 1;
      }
    }

    let queryCount = 0;
    let durationMs = 0;
    const plan = await withClientTransaction(tenantId, leadershipId, async (client) => {
      const counting = new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (...args: unknown[]) => {
              queryCount += 1;
              return (target.query as (...a: unknown[]) => unknown)(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      const startedAt = Date.now();
      const result = await getStaffingCapacityPlan(counting, capAuth({}), { window: "week", anchorDate: perfMonday });
      durationMs = Date.now() - startedAt;
      return result;
    });

    const distinctDates = new Set<string>();
    for (const employee of plan.employees) {
      for (const assignment of employee.assignments) {
        if (assignment.operating_date) distinctDates.add(assignment.operating_date);
      }
    }
    const shootCount = plan.employees.reduce((max, e) => Math.max(max, e.shoot_count), 0);
    // eslint-disable-next-line no-console
    console.log(
      `[capacity perf] week plan: queries=${queryCount} durationMs=${durationMs} employees=${plan.summary.employee_count} assignments=${plan.summary.assignment_count} (+${plan.summary.assignment_count - baselineAssignments} seeded) distinctDates=${distinctDates.size} busiestEmployeeShoots=${shootCount}`
    );

    // Query budget is bounded by the 7-day week (1 shifts + 1 roster + 3 sub-queries × distinct assignment
    // dates ≤ 7), NEVER by the shifts or the 112-employee roster. The decisive no-N+1 check: far fewer
    // queries than employees — a per-employee path would be in the hundreds.
    expect(queryCount).toBeLessThanOrEqual(2 + 3 * 7);
    expect(queryCount).toBeLessThan(plan.summary.employee_count);
    expect(plan.summary.assignment_count - baselineAssignments).toBe(120); // our 120 shifts, isolated from any baseline
    expect(plan.summary.employee_count).toBeGreaterThanOrEqual(100); // 40 assigned + zero-hour roster fill
    expect(plan.includes_zero_assignment_employees).toBe(true);
  });
});

describe("staffing capacity read model — interval clipping + data quality", () => {
  const WEEK_MINUTES = 7 * 24 * 60;

  async function spareSchoolsUser(): Promise<{ id: string; name: string | null }> {
    const row = (
      await pool.query<{ id: string; full_name: string | null }>(
        `SELECT id::text AS id, full_name FROM app_user
         WHERE tenant_id = $1 AND is_active = true AND department = 'schools'
           AND id NOT IN ($2::uuid, $3::uuid)
         ORDER BY id DESC LIMIT 1`,
        [tenantId, photoId, seniorId]
      )
    ).rows[0];
    return { id: row.id, name: row.full_name };
  }

  async function insertRawShift(userId: string, startsAt: string, endsAt: string): Promise<string> {
    const row = (
      await pool.query<{ id: string }>(
        `INSERT INTO work_shift
           (tenant_id, assigned_user_id, shift_kind, status, department, title, starts_at, ends_at, location_name, staffing_role)
         VALUES ($1, $2, 'shoot', 'published', 'schools', 'Raw', $3::timestamptz, $4::timestamptz, 'Raw Site', 'photographer')
         RETURNING id::text AS id`,
        [tenantId, userId, startsAt, endsAt]
      )
    ).rows[0];
    return row.id;
  }

  it("34. a corrupt multi-year shift is clipped to the window and flagged suspicious, not multi-year", async () => {
    const date = "2027-06-07";
    const user = await spareSchoolsUser();
    // A 6-year interval — the exact class of corrupt/legacy row that polluted totals during the browser smoke.
    const shiftId = await insertRawShift(user.id, "2025-01-01T00:00:00Z", "2031-01-01T00:00:00Z");
    try {
      const employee = empOf(await week(capAuth({}), date), user.id)!;
      // Totals are bounded to the week — never the multi-year source duration.
      expect(employee.unique_scheduled_minutes).toBe(WEEK_MINUTES);
      expect(employee.raw_assigned_minutes).toBe(WEEK_MINUTES);
      expect(employee.suspicious_timing_count).toBe(1);

      const assignment = employee.assignments.find((a) => a.shift_id === shiftId)!;
      expect(assignment.timing_quality).toBe("suspicious");
      expect(assignment.source_duration_minutes!).toBeGreaterThan(2_000_000); // the real (corrupt) length
      expect(assignment.clipped_duration_minutes).toBe(WEEK_MINUTES); // what actually counts
      expect(assignment.timing_warning_reason).toMatch(/plausibility limit/);
      // Canonical start/end are preserved for display + drilldown (not mutated/truncated).
      expect(assignment.starts_at).toMatch(/^2025-01-01/);
      expect(assignment.ends_at).toMatch(/^2031-01-01/);

      // Day/week rollups reconcile to the same clipped total and never exceed the week's minutes.
      const dayTotal = employee.days.reduce((sum, d) => sum + d.scheduled_minutes, 0);
      expect(dayTotal).toBe(WEEK_MINUTES);
      expect(employee.weeks[0].scheduled_minutes).toBe(WEEK_MINUTES);
    } finally {
      await pool.query("DELETE FROM work_shift WHERE id = $1", [shiftId]);
    }
  });

  it("35. a shift straddling the Monday boundary contributes only its in-window portion", async () => {
    const date = "2027-06-07"; // week Mon 2027-06-07 .. Sun 2027-06-13 (Chicago)
    const user = await spareSchoolsUser();
    // 22:00 CDT Sun 2027-06-06 (03:00Z Mon) → 13:00 CDT Mon 2027-06-07 (18:00Z Mon). Only the Monday portion
    // (00:00–13:00 CDT = 13h) is inside the week; the Sunday-before tail is outside and must not count.
    const shiftId = await insertRawShift(user.id, "2027-06-07T03:00:00Z", "2027-06-07T18:00:00Z");
    try {
      const employee = empOf(await week(capAuth({}), date), user.id)!;
      // Window starts Mon 00:00 CDT = 05:00Z; clipped = 05:00Z..18:00Z = 13h.
      expect(employee.unique_scheduled_minutes).toBe(13 * 60);
      const assignment = employee.assignments.find((a) => a.shift_id === shiftId)!;
      expect(assignment.timing_quality).toBe("valid");
      expect(assignment.source_duration_minutes).toBe(15 * 60); // full 03:00Z..18:00Z = 15h
      expect(assignment.clipped_duration_minutes).toBe(13 * 60); // only the in-window 13h counts
      expect(assignment.starts_at).toMatch(/^2027-06-07[ T]03:00/); // canonical retained (pg ::text uses a space)
    } finally {
      await pool.query("DELETE FROM work_shift WHERE id = $1", [shiftId]);
    }
  });
});
