import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getLocalDateString } from "../src/utils/localDate.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let leadershipId = "";
let seniorId = "";
let employeeId = "";
let leadershipToken = "";
let employeeToken = "";
let baseShootId = "";
let clonedEmployeeEmail = "";

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function toDateString(value: Date) {
  return getLocalDateString(value);
}

async function insertPhase2Shoot(input: {
  title: string;
  showtime: Date;
  startTime: Date;
  endTime: Date;
  latitude: number;
  longitude: number;
}) {
  const code = `TC2-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query(
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
        projected_students
      )
      SELECT
        tenant_id,
        studio_id,
        $2,
        $3,
        $4::date,
        'TC2 Test Location',
        '123 Test Street',
        $5,
        $6,
        navigation_url,
        804,
        $7,
        $7,
        $8,
        $9,
        projected_students
      FROM shoot
      WHERE id = $1
      RETURNING id
    `,
    [
      baseShootId,
      code,
      input.title,
      toDateString(input.showtime),
      input.latitude,
      input.longitude,
      input.showtime.toISOString(),
      input.startTime.toISOString(),
      input.endTime.toISOString()
    ]
  );

  return rows[0].id as string;
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
}) {
  const shift = (
    await pool.query(
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
          $1,$2,$3,$4,$5,$5,'shoot','published','schools',$6,$7,$8,'TC2 Test Location','123 Test Street',$9,$10,804,now()
        )
        RETURNING *
      `,
      [
        tenantId,
        input.shootId,
        input.assignedUserId,
        input.managerUserId,
        leadershipId,
        `${input.title}-${randomUUID().slice(0, 6)}`,
        input.startsAt,
        input.endsAt,
        input.latitude,
        input.longitude
      ]
    )
  ).rows[0];

  await pool.query(
    `
      INSERT INTO shift_segment (
        tenant_id,
        shift_id,
        segment_kind,
        label,
        scheduled_start_at,
        scheduled_end_at,
        rate_code,
        hourly_rate_cents,
        sort_order
      )
      VALUES ($1,$2,'shoot','Coverage',$3,$4,'shoot',2500,0)
    `,
    [tenantId, shift.id, input.startsAt.toISOString(), input.endsAt.toISOString()]
  );

  return shift.id as string;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;

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
  seniorId = people.rows.find((row) => row.email === "senior@example.com")?.id;
  const sourceEmployeeId = people.rows.find((row) => row.email === "newhire@example.com")?.id;
  clonedEmployeeEmail = `timeclock-phase2-${randomUUID().slice(0, 10)}@example.com`;

  const clonedEmployee = await pool.query<{ id: string }>(
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
        'Time Clock Phase 2 Employee',
        true,
        department,
        'active',
        now()
      FROM app_user
      WHERE id = $1
      RETURNING id
    `,
    [sourceEmployeeId, clonedEmployeeEmail]
  );
  employeeId = clonedEmployee.rows[0].id;

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

  const shoot = await pool.query("SELECT id FROM shoot WHERE tenant_id = $1 AND shoot_code = 'DEMO-001' LIMIT 1", [tenantId]);
  baseShootId = shoot.rows[0].id;

  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
  employeeToken = (await devLogin(app, clonedEmployeeEmail)).body.token;
});

beforeEach(async () => {
  await pool.query("DELETE FROM time_clock_compliance_flag WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM shift_segment WHERE shift_id IN (SELECT id FROM work_shift WHERE tenant_id = $1 AND title LIKE 'TC2-%')", [tenantId]);
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title LIKE 'TC2-%'", [tenantId]);
  await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND shoot_code LIKE 'TC2-%'", [tenantId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM time_clock_compliance_flag WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM auth_session WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, employeeId]);
});

describe("time clock phase 2", () => {
  it("creates an open Photography Time Session and Time Segment on clock-in", async () => {
    const now = new Date();
    const shootId = await insertPhase2Shoot({
      title: "TC2 Photography Start",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 120),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC2-PhotoStart",
      startsAt: now,
      endsAt: addMinutes(now, 120),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${employeeToken}`)
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
    expect(response.body.time_clock_state.current_state).toBe("photography");

    const sessions = await pool.query("SELECT * FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
    const segments = await pool.query("SELECT * FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
    const events = await pool.query("SELECT event_type::text FROM clock_event WHERE tenant_id = $1 AND employee_id = $2 ORDER BY event_timestamp ASC", [tenantId, employeeId]);

    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].status).toBe("open");
    expect(segments.rows).toHaveLength(1);
    expect(segments.rows[0].work_state).toBe("photography");
    expect(segments.rows[0].review_status).toBe("not_required");
    expect(events.rows.map((row) => row.event_type).sort()).toEqual(["clock_in", "session_opened", "work_state_started"].sort());
  });

  it("allows a confirmed outside-geofence Photography clock-in but flags it for review", async () => {
    const now = new Date();
    const shootId = await insertPhase2Shoot({
      title: "TC2 Outside Geofence",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 90),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC2-OutsideGeo",
      startsAt: now,
      endsAt: addMinutes(now, 90),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shiftId,
        direction: "in",
        work_state: "photography",
        client_timestamp: now.toISOString(),
        latitude: 45.1001,
        longitude: -93.5001,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        reason_code: "outside_geofence",
        confirmed_permission: true,
        notes: "Leadership approved an unusual start."
      });

    expect(response.status).toBe(201);
    expect(response.body.time_clock_warnings.join(" ")).toMatch(/flagged for review/i);

    const segment = await pool.query(
      "SELECT review_status FROM time_segment WHERE tenant_id = $1 AND employee_id = $2 ORDER BY start_time DESC LIMIT 1",
      [tenantId, employeeId]
    );
    const exceptionRequest = await pool.query(
      "SELECT request_type FROM exception_request WHERE tenant_id = $1 AND employee_id = $2 ORDER BY submitted_at DESC LIMIT 1",
      [tenantId, employeeId]
    );

    expect(segment.rows[0].review_status).toBe("pending_review");
    expect(exceptionRequest.rows[0].request_type).toBe("work_state_change");
  });

  it("automatically transitions Office/Drive into Photography when entering the Shoot geofence", async () => {
    const now = new Date();
    const showtime = addMinutes(now, 10);
    const shootId = await insertPhase2Shoot({
      title: "TC2 Auto Transition In",
      showtime,
      startTime: showtime,
      endTime: addMinutes(showtime, 90),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC2-AutoIn",
      startsAt: now,
      endsAt: addMinutes(showtime, 90),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const clockIn = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shiftId,
        direction: "in",
        work_state: "office_drive",
        client_timestamp: now.toISOString(),
        latitude: 44.9419,
        longitude: -93.5022,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(clockIn.status).toBe(201);
    expect(clockIn.body.time_clock_state.current_state).toBe("office_drive");

    const locationCheck = await request(app)
      .post("/api/attendance/time-clock/location-check")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        captured_at: addMinutes(now, 5).toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5
      });

    expect(locationCheck.status).toBe(200);
    expect(locationCheck.body.auto_transition.kind).toBe("office_drive_to_photography");
    expect(locationCheck.body.time_clock_state.current_state).toBe("photography");
  });

  it("moves the final Shoot exit into Needs End-of-Day Confirmation and supports correction-needed flow", async () => {
    const now = new Date();
    const shootId = await insertPhase2Shoot({
      title: "TC2 Final Exit",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 90),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC2-FinalExit",
      startsAt: now,
      endsAt: addMinutes(now, 90),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const clockIn = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${employeeToken}`)
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

    expect(clockIn.status).toBe(201);

    const locationCheck = await request(app)
      .post("/api/attendance/time-clock/location-check")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        captured_at: addMinutes(now, 15).toISOString(),
        latitude: 45.1001,
        longitude: -93.5001,
        accuracy_meters: 5
      });

    expect(locationCheck.status).toBe(200);
    expect(locationCheck.body.needs_end_of_day_confirmation.title).toBe("Needs End-of-Day Confirmation");
    expect(locationCheck.body.time_clock_state.needs_end_of_day_confirmation).toBe(true);

    const sessionId = locationCheck.body.time_clock_state.session_id as string;
    const unresolvedFlag = await pool.query(
      `
        SELECT item_type::text, status::text
        FROM time_clock_compliance_flag
        WHERE tenant_id = $1
          AND employee_id = $2
          AND session_id = $3
          AND item_type = 'unresolved_end_of_day_confirmation'
        LIMIT 1
      `,
      [tenantId, employeeId, sessionId]
    );
    expect(unresolvedFlag.rows[0]).toMatchObject({
      item_type: "unresolved_end_of_day_confirmation",
      status: "open"
    });

    const confirmation = await request(app)
      .post("/api/attendance/time-clock/end-of-day-confirmation")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        session_id: sessionId,
        decision: "correction_needed",
        captured_at: addMinutes(now, 20).toISOString(),
        note: "Need leadership to review whether the final segment should stay Photography longer."
      });

    expect(confirmation.status).toBe(200);
    expect(confirmation.body.exception_request_id).toBeTruthy();
    expect(confirmation.body.time_clock_state.current_state).toBe("off_clock");

    const resolvedFlag = await pool.query(
      `
        SELECT status::text, linked_exception_request_id
        FROM time_clock_compliance_flag
        WHERE tenant_id = $1
          AND employee_id = $2
          AND session_id = $3
          AND item_type = 'unresolved_end_of_day_confirmation'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, employeeId, sessionId]
    );
    expect(resolvedFlag.rows[0].status).toBe("resolved");
    expect(resolvedFlag.rows[0].linked_exception_request_id).toBeTruthy();

    const correction = await pool.query(
      "SELECT request_type FROM exception_request WHERE tenant_id = $1 AND employee_id = $2 ORDER BY submitted_at DESC LIMIT 1",
      [tenantId, employeeId]
    );
    expect(correction.rows[0].request_type).toBe("time_segment_correction");
  });

  it("classifies soft-radius presence as Likely Present, Missing Clock-In without starting paid time", async () => {
    const now = new Date();
    const shootId = await insertPhase2Shoot({
      title: "TC2 Soft Radius",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 60),
      latitude: 44.9778,
      longitude: -93.2649
    });
    await insertShift({
      shootId,
      title: "TC2-SoftRadius",
      startsAt: now,
      endsAt: addMinutes(now, 60),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const locationCheck = await request(app)
      .post("/api/attendance/time-clock/location-check")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        captured_at: addMinutes(now, 5).toISOString(),
        latitude: 44.9868,
        longitude: -93.2649,
        accuracy_meters: 5
      });

    expect(locationCheck.status).toBe(200);
    expect(locationCheck.body.likely_present_missing_clock_in.label).toBe("Likely Present, Missing Clock-In");

    const sessions = await pool.query("SELECT * FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
    expect(sessions.rows).toHaveLength(0);
  });

  it("fails hard when the first action of the day is a clock-out", async () => {
    const now = new Date();
    const shootId = await insertPhase2Shoot({
      title: "TC2 Clock Out Guard",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 60),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC2-ClockOutGuard",
      startsAt: now,
      endsAt: addMinutes(now, 60),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shiftId,
        direction: "out",
        client_timestamp: addMinutes(now, 5).toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("cannot clock out");
    const sessions = await pool.query("SELECT * FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
    expect(sessions.rows).toHaveLength(0);
  });

  it("serializes concurrent clock-ins so one active punch creates one canonical session and segment", async () => {
    const now = new Date();
    const shootId = await insertPhase2Shoot({
      title: "TC2 Double Punch Guard",
      showtime: now,
      startTime: now,
      endTime: addMinutes(now, 90),
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC2-DoublePunchGuard",
      startsAt: now,
      endsAt: addMinutes(now, 90),
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const capturedAt = addMinutes(now, 3).toISOString();

    const [first, second] = await Promise.all([
      request(app)
        .post("/api/attendance/punches")
        .set("Authorization", `Bearer ${employeeToken}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          shift_id: shiftId,
          direction: "in",
          work_state: "photography",
          client_timestamp: capturedAt,
          latitude: 44.9778,
          longitude: -93.2649,
          accuracy_meters: 5,
          client_event_id: randomUUID()
        }),
      request(app)
        .post("/api/attendance/punches")
        .set("Authorization", `Bearer ${employeeToken}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          shift_id: shiftId,
          direction: "in",
          work_state: "photography",
          client_timestamp: capturedAt,
          latitude: 44.9778,
          longitude: -93.2649,
          accuracy_meters: 5,
          client_event_id: randomUUID()
        })
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const punches = await pool.query(
      `
        SELECT *
        FROM shift_punch
        WHERE tenant_id = $1
          AND user_id = $2
          AND shift_id = $3
      `,
      [tenantId, employeeId, shiftId]
    );
    const sessions = await pool.query("SELECT * FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
    const segments = await pool.query("SELECT * FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
    const events = await pool.query(
      `
        SELECT event_type::text
        FROM clock_event
        WHERE tenant_id = $1
          AND employee_id = $2
        ORDER BY event_timestamp ASC
      `,
      [tenantId, employeeId]
    );

    expect(punches.rows).toHaveLength(1);
    expect(sessions.rows).toHaveLength(1);
    expect(segments.rows).toHaveLength(1);
    expect(events.rows.map((row) => row.event_type).sort()).toEqual(["clock_in", "session_opened", "work_state_started"].sort());
  });
});
