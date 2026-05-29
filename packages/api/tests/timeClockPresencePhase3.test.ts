import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getLocalDateString } from "../src/utils/localDate.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let studioId = "";
let baseShootId = "";
let leadershipId = "";
let leadershipToken = "";
let sourceEmployeeId = "";
let officeEmployeeId = "";
let fieldEmployeeId = "";
let missingEmployeeId = "";
let fieldEmployeeToken = "";
let officeEmployeeEmail = "";
let fieldEmployeeEmail = "";
let missingEmployeeEmail = "";

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function toDateString(value: Date) {
  return getLocalDateString(value);
}

async function cloneEmployee(label: string) {
  const email = `timeclock-phase3-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const inserted = await pool.query<{ id: string }>(
    `
      INSERT INTO app_user (
        tenant_id,
        email,
        full_name,
        is_active,
        department,
        status,
        approved_at
      )
      SELECT
        tenant_id,
        $2,
        $3,
        true,
        department,
        'active',
        now()
      FROM app_user
      WHERE id = $1
      RETURNING id
    `,
    [sourceEmployeeId, email, `Phase 3 ${label}`]
  );
  const employeeId = inserted.rows[0].id;

  await pool.query(
    `
      INSERT INTO user_authority_assignment (
        tenant_id,
        user_id,
        authority_tier,
        primary_job_function_profile,
        scope_department,
        scope_overrides,
        assigned_by_user_id
      )
      SELECT
        tenant_id,
        $2,
        authority_tier,
        primary_job_function_profile,
        scope_department,
        scope_overrides,
        assigned_by_user_id
      FROM user_authority_assignment
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, employeeId, sourceEmployeeId]
  );

  await pool.query(
    `
      INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
      SELECT tenant_id, $2, job_function_profile
      FROM user_job_function_profile
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, employeeId, sourceEmployeeId]
  );

  await pool.query(
    `
      INSERT INTO user_role (tenant_id, user_id, role_id)
      SELECT tenant_id, $2, role_id
      FROM user_role
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, employeeId, sourceEmployeeId]
  );

  return { employeeId, email };
}

async function insertShoot(input: {
  title: string;
  showtime: Date;
  startTime: Date;
  endTime: Date;
  latitude: number;
  longitude: number;
}) {
  const code = `TC3-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO shoot (
        tenant_id,
        studio_id,
        shoot_code,
        title,
        shoot_date,
        location_name,
        location_address,
        location_lat,
        location_lng,
        navigation_url,
        geofence_radius_meters,
        showtime,
        arrival_time,
        start_time,
        end_time_est,
        projected_students,
        created_by
      )
      VALUES (
        $1,$2,$3,$4,$5::date,'TC3 Test Venue','123 Test Street',$6,$7,NULL,804,$8,$8,$9,$10,32,$11
      )
      RETURNING id
    `,
    [
      tenantId,
      studioId,
      code,
      input.title,
      toDateString(input.showtime),
      input.latitude,
      input.longitude,
      input.showtime.toISOString(),
      input.startTime.toISOString(),
      input.endTime.toISOString(),
      leadershipId
    ]
  );
  return rows[0].id;
}

async function insertShift(input: {
  shootId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  assignedUserId: string;
  managerUserId: string;
  latitude: number;
  longitude: number;
  department?: "schools" | "sports";
}) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO work_shift (
        tenant_id,
        shoot_id,
        assigned_user_id,
        manager_user_id,
        created_by_user_id,
        published_by_user_id,
        shift_kind,
        status,
        department,
        title,
        starts_at,
        ends_at,
        location_name,
        location_address,
        location_lat,
        location_lng,
        geofence_radius_meters,
        published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$5,'shoot','published',$6,$7,$8,$9,'TC3 Test Venue','123 Test Street',$10,$11,804,now()
      )
      RETURNING id
    `,
    [
      tenantId,
      input.shootId,
      input.assignedUserId,
      input.managerUserId,
      leadershipId,
      input.department ?? "schools",
      `${input.title}-${randomUUID().slice(0, 6)}`,
      input.startsAt.toISOString(),
      input.endsAt.toISOString(),
      input.latitude,
      input.longitude
    ]
  );
  return rows[0].id;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;
  const studio = await pool.query("SELECT id FROM studio WHERE tenant_id = $1 LIMIT 1", [tenantId]);
  studioId = studio.rows[0].id;
  const baseShoot = await pool.query("SELECT id FROM shoot WHERE tenant_id = $1 AND shoot_code = 'DEMO-001' LIMIT 1", [tenantId]);
  baseShootId = baseShoot.rows[0].id;

  const people = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'senior@example.com', 'newhire@example.com')
    `,
    [tenantId]
  );
  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id;
  sourceEmployeeId = people.rows.find((row) => row.email === "newhire@example.com")?.id;

  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;

  const officeEmployee = await cloneEmployee("office");
  officeEmployeeId = officeEmployee.employeeId;
  officeEmployeeEmail = officeEmployee.email;

  const fieldEmployee = await cloneEmployee("field");
  fieldEmployeeId = fieldEmployee.employeeId;
  fieldEmployeeEmail = fieldEmployee.email;

  const missingEmployee = await cloneEmployee("missing");
  missingEmployeeId = missingEmployee.employeeId;
  missingEmployeeEmail = missingEmployee.email;

  fieldEmployeeToken = (await devLogin(app, fieldEmployeeEmail)).body.token;
});

beforeEach(async () => {
  await pool.query("DELETE FROM time_clock_presence_incident WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM time_clock_presence_observation WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title LIKE 'TC3-%'", [tenantId]);
  await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND shoot_code LIKE 'TC3-%'", [tenantId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM time_clock_presence_incident WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM time_clock_presence_observation WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM auth_session WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id IN ($2,$3,$4)", [tenantId, officeEmployeeId, fieldEmployeeId, missingEmployeeId]);
});

describe("time clock phase 3 presence", () => {
  it(
    "renders the attendance awareness widget with leadership-friendly attendance buckets and legacy compatibility",
    async () => {
    const now = new Date();
    const shootId = await insertShoot({
      title: "TC3 Home Widget Shoot",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 120),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC3-HomeWidgetField",
      startsAt: now,
      endsAt: addMinutes(now, 120),
      assignedUserId: fieldEmployeeId,
      managerUserId: leadershipId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const workDate = toDateString(now);

    const officeSession = (
      await pool.query<{ id: string }>(
        `INSERT INTO time_session (tenant_id, employee_id, work_date, status) VALUES ($1,$2,$3,'open') RETURNING id`,
        [tenantId, officeEmployeeId, workDate]
      )
    ).rows[0];
    const officeSegment = (
      await pool.query<{ id: string }>(
        `
          INSERT INTO time_segment (
            tenant_id, session_id, employee_id, work_state, start_time, source_type, geofence_supported, review_status
          )
          VALUES ($1,$2,$3,'office_drive',$4,'manual',true,'not_required')
          RETURNING id
        `,
        [tenantId, officeSession.id, officeEmployeeId, addMinutes(now, -30).toISOString()]
      )
    ).rows[0];

    const fieldSession = (
      await pool.query<{ id: string }>(
        `INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status) VALUES ($1,$2,$3,$4,'open') RETURNING id`,
        [tenantId, fieldEmployeeId, workDate, shiftId]
      )
    ).rows[0];
    const fieldSegment = (
      await pool.query<{ id: string }>(
        `
          INSERT INTO time_segment (
            tenant_id, session_id, employee_id, work_state, linked_shoot_id, start_time, source_type, geofence_supported, review_status
          )
          VALUES ($1,$2,$3,'photography',$4,$5,'manual',true,'not_required')
          RETURNING id
        `,
        [tenantId, fieldSession.id, fieldEmployeeId, shootId, addMinutes(now, -20).toISOString()]
      )
    ).rows[0];

    await pool.query(
      `
        INSERT INTO time_clock_presence_observation (
          tenant_id, employee_id, session_id, segment_id, current_state, session_status, latitude, longitude, captured_at, source_type
        )
        VALUES
          ($1,$2,$3,$4,'office_drive','open',44.9419,-93.5022,$5,'location_check'),
          ($1,$6,$7,$8,'photography','open',44.9778,-93.2649,$5,'location_check')
      `,
      [tenantId, officeEmployeeId, officeSession.id, officeSegment.id, now.toISOString(), fieldEmployeeId, fieldSession.id, fieldSegment.id]
    );

    await pool.query(
      `
        INSERT INTO time_clock_presence_incident (
          tenant_id, employee_id, shift_id, shoot_id, alert_type, geofence_classification, current_state, resolution_status, last_observed_at
        )
        VALUES ($1,$2,$3,$4,'assigned_but_missing','outside_soft_radius','off_clock','open',$5)
      `,
      [tenantId, missingEmployeeId, shiftId, shootId, now.toISOString()]
    );

    const response = await request(app)
      .get("/api/dashboard/home?mode=app")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    const attendance = response.body.widgets.attendance_awareness;

    expect(attendance.summary.clocked_in_count).toBeGreaterThanOrEqual(2);
    expect(attendance.summary.not_clocked_in_count).toBeGreaterThanOrEqual(1);
    expect(attendance.summary.missing_clock_in_count).toBeGreaterThanOrEqual(1);
    expect(attendance.summary.wrong_location_count).toBeGreaterThanOrEqual(1);
    expect(attendance.clocked_in.items.some((item: { employee_id: string }) => item.employee_id === officeEmployeeId)).toBe(true);
    expect(attendance.clocked_in.items.some((item: { employee_id: string }) => item.employee_id === fieldEmployeeId)).toBe(true);
    expect(attendance.in_office.items.some((item: { employee_id: string }) => item.employee_id === officeEmployeeId)).toBe(true);
    expect(attendance.in_field.items.some((item: { employee_id: string }) => item.employee_id === fieldEmployeeId)).toBe(true);
    expect(attendance.assigned_but_missing.items.some((item: { employee_id: string }) => item.employee_id === missingEmployeeId)).toBe(true);
    expect(attendance.missing_clock_in.items.some((item: { employee_id: string }) => item.employee_id === missingEmployeeId)).toBe(true);
      expect(attendance.wrong_location.items.some((item: { employee_id: string }) => item.employee_id === missingEmployeeId)).toBe(true);
    },
    20_000
  );

  it("resolves assigned-but-missing incidents when the employee clocks in", async () => {
    const now = new Date();
    const shootId = await insertShoot({
      title: "TC3 Resolution Shoot",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 120),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC3-Resolution",
      startsAt: now,
      endsAt: addMinutes(now, 120),
      assignedUserId: fieldEmployeeId,
      managerUserId: leadershipId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    await pool.query(
      `
        INSERT INTO time_clock_presence_incident (
          tenant_id, employee_id, shift_id, shoot_id, alert_type, geofence_classification, current_state, resolution_status, last_observed_at
        )
        VALUES ($1,$2,$3,$4,'assigned_but_missing','outside_soft_radius','off_clock','open',$5)
      `,
      [tenantId, fieldEmployeeId, shiftId, shootId, now.toISOString()]
    );

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${fieldEmployeeToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shiftId,
        direction: "in",
        work_state: "photography",
        client_timestamp: now.toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(response.status).toBe(201);

    const incidents = await pool.query(
      `
        SELECT resolution_status, resolution_reason
        FROM time_clock_presence_incident
        WHERE tenant_id = $1
          AND employee_id = $2
          AND shift_id = $3
      `,
      [tenantId, fieldEmployeeId, shiftId]
    );

    expect(incidents.rows[0].resolution_status).toBe("resolved");
    expect(incidents.rows[0].resolution_reason).toBe("clock_in_recorded");
  });
});
