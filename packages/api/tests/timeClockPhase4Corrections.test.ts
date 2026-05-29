import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, elevateSession } from "./helpers.js";

const app = createApp();

let tenantId = "";
let leadershipId = "";
let seniorId = "";
let employeeId = "";
let leadershipToken = "";
let seniorToken = "";
let employeeToken = "";
let baseShootId = "";
let clonedEmployeeEmail = "";

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function toDateString(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function insertShoot(input: {
  title: string;
  showtime: Date;
  startTime: Date;
  endTime: Date;
  latitude: number;
  longitude: number;
}) {
  const code = `TC4-${randomUUID().slice(0, 8)}`;
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
        'TC4 Test Location',
        '456 Test Avenue',
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
          $1,$2,$3,$4,$5,$5,'shoot','published','schools',$6,$7,$8,'TC4 Test Location','456 Test Avenue',$9,$10,804,now()
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

  return shift.id as string;
}

async function insertFinalizedSessionForShift(input: {
  shiftId: string;
  employeeId: string;
  workDate: string;
  status: "approved" | "payroll_exported";
}) {
  const session = await pool.query<{ id: string }>(
    `
      INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status)
      VALUES ($1,$2,$3::date,$4,$5::time_session_status)
      RETURNING id
    `,
    [tenantId, input.employeeId, input.workDate, input.shiftId, input.status]
  );

  return session.rows[0].id;
}

async function insertTimeEntryForShift(input: {
  shootId: string;
  shiftId: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
}) {
  const entry = await pool.query<{ id: string }>(
    `
      INSERT INTO time_entry (
        tenant_id,
        shoot_id,
        user_id,
        shift_id,
        clock_in_at,
        clock_out_at,
        minutes_worked,
        scheduled_minutes,
        gross_minutes,
        break_deduction_minutes,
        break_deduction_applied,
        break_deduction_source,
        payable_minutes,
        payroll_state,
        attendance_state
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$7,$7,30,true,'automatic',$8,'pending','clocked_out'
      )
      RETURNING id
    `,
    [
      tenantId,
      input.shootId,
      input.employeeId,
      input.shiftId,
      input.startsAt.toISOString(),
      input.endsAt.toISOString(),
      Math.max(1, Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60000)),
      Math.max(1, Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60000) - 30)
    ]
  );

  return entry.rows[0].id;
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
  clonedEmployeeEmail = `timeclock-phase4-${randomUUID().slice(0, 10)}@example.com`;

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
        'Time Clock Phase 4 Employee',
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
  seniorToken = (await request(app).post("/auth/login").send({ email: "senior@example.com", password: "LocalDemo123!" })).body.token;
  employeeToken = (await devLogin(app, clonedEmployeeEmail)).body.token;
  await elevateSession(app, leadershipToken, "LocalDemo123!");
});

beforeEach(async () => {
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM shift_segment WHERE shift_id IN (SELECT id FROM work_shift WHERE tenant_id = $1 AND title LIKE 'TC4-%')", [tenantId]);
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title LIKE 'TC4-%'", [tenantId]);
  await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND shoot_code LIKE 'TC4-%'", [tenantId]);
});

afterAll(async () => {
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

describe("time clock phase 4 corrections", () => {
  it("stores canonical missed clock-in request details alongside the legacy exception workflow", async () => {
    const startsAt = addMinutes(new Date(), -30);
    const endsAt = addMinutes(startsAt, 180);
    const shootId = await insertShoot({
      title: "TC4 Missed Punch",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-MissedPunch",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const response = await request(app)
      .post("/api/attendance/missed-punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: shiftId,
        missing_direction: "in",
        employee_submitted_explanation: "Phone battery died during load-in.",
        requested_approver_user_id: seniorId,
        requested_work_state: "photography",
        requested_start_time: startsAt.toISOString(),
        requested_end_time: endsAt.toISOString(),
        location_context: {
          latitude: 44.9778,
          longitude: -93.2649,
          source: "mobile_capture"
        }
      });

    expect(response.status).toBe(201);

    const canonical = await pool.query(
      `
        SELECT *
        FROM exception_request
        WHERE tenant_id = $1
          AND related_attendance_exception_id = $2
        LIMIT 1
      `,
      [tenantId, response.body.id]
    );

    expect(canonical.rows[0].request_type).toBe("missing_clock_in");
    expect(canonical.rows[0].linked_shift_id).toBe(shiftId);
    expect(canonical.rows[0].requested_state).toBe("photography");
    expect(canonical.rows[0].requested_start_time.toISOString()).toBe(startsAt.toISOString());
    expect(canonical.rows[0].requested_end_time.toISOString()).toBe(endsAt.toISOString());
    expect(canonical.rows[0].location_context.source).toBe("mobile_capture");
    expect(canonical.rows[0].reporting_flags).toEqual(
      expect.arrayContaining(["manual_adjustment", "missed_clock_in_approval"])
    );
  });

  it("writes approval records and canonical time-segment corrections when a missed clock-in is approved", async () => {
    const startsAt = addMinutes(new Date(), -90);
    const endsAt = addMinutes(startsAt, 120);
    const shootId = await insertShoot({
      title: "TC4 Approved Missed Punch",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-ApproveMissedPunch",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const requested = await request(app)
      .post("/api/attendance/missed-punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: shiftId,
        missing_direction: "in",
        employee_submitted_explanation: "Forgot to clock in during setup.",
        requested_approver_user_id: seniorId,
        requested_work_state: "photography",
        requested_start_time: startsAt.toISOString()
      });

    expect(requested.status).toBe(201);

    const approved = await request(app)
      .post(`/api/attendance/missed-punches/${requested.body.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "approved",
        corrected_time: startsAt.toISOString(),
        notes: "Approved after checking the shoot lead context."
      });

    expect(approved.status).toBe(200);

    const canonical = await pool.query(
      `
        SELECT *
        FROM exception_request
        WHERE tenant_id = $1
          AND related_attendance_exception_id = $2
        LIMIT 1
      `,
      [tenantId, requested.body.id]
    );
    const approvalRecords = await pool.query(
      `
        SELECT *
        FROM approval_record
        WHERE tenant_id = $1
          AND request_id = $2
      `,
      [tenantId, canonical.rows[0].id]
    );
    const segments = await pool.query(
      `
        SELECT *
        FROM time_segment
        WHERE tenant_id = $1
          AND employee_id = $2
        ORDER BY start_time DESC
      `,
      [tenantId, employeeId]
    );
    const auditRows = await pool.query(
      `
        SELECT *
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'time_segment'
          AND action = 'time_clock.time_segment.manual_correction'
        ORDER BY created_at DESC
      `,
      [tenantId]
    );

    expect(canonical.rows[0].status).toBe("approved");
    expect(approvalRecords.rows[0].approver_id).toBe(seniorId);
    expect(approvalRecords.rows[0].decision).toBe("approved");
    expect(segments.rows[0].source_type).toBe("manual_correction");
    expect(segments.rows[0].review_status).toBe("approved");
    expect(segments.rows[0].linked_shift_id).toBe(shiftId);
    expect(segments.rows[0].reporting_flags).toEqual(
      expect.arrayContaining(["manual_adjustment", "missed_clock_in_approval"])
    );
    expect(auditRows.rows[0].reason_comment).toContain("Approved missed clock-in correction");
  });

  it("creates a leadership override with approved canonical records and auditable admin-adjustment segments", async () => {
    const startsAt = addMinutes(new Date(), -240);
    const endsAt = addMinutes(startsAt, 90);
    const shootId = await insertShoot({
      title: "TC4 Leadership Override",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-LeadershipOverride",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const response = await request(app)
      .post("/api/attendance/time-clock/manual-adjustments")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        employee_id: employeeId,
        shift_id: shiftId,
        requested_work_state: "office_drive",
        requested_start_time: startsAt.toISOString(),
        requested_end_time: endsAt.toISOString(),
        note: "Leadership added paid Office/Drive time after confirming the studio return."
      });

    expect(response.status).toBe(201);

    const exception = await pool.query(
      `
        SELECT *
        FROM attendance_exception
        WHERE tenant_id = $1
          AND user_id = $2
          AND exception_type = 'LEADERSHIP_TIME_EDIT'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, employeeId]
    );
    const canonical = await pool.query(
      `
        SELECT *
        FROM exception_request
        WHERE tenant_id = $1
          AND related_attendance_exception_id = $2
        LIMIT 1
      `,
      [tenantId, exception.rows[0].id]
    );
    const approvalRecords = await pool.query(
      `
        SELECT *
        FROM approval_record
        WHERE tenant_id = $1
          AND request_id = $2
      `,
      [tenantId, canonical.rows[0].id]
    );
    const segments = await pool.query(
      `
        SELECT *
        FROM time_segment
        WHERE tenant_id = $1
          AND employee_id = $2
        ORDER BY start_time DESC
      `,
      [tenantId, employeeId]
    );
    const auditRows = await pool.query(
      `
        SELECT *
        FROM audit_log
        WHERE tenant_id = $1
          AND action IN ('time_clock.time_segment.admin_override', 'time_clock.exception_request.approved')
        ORDER BY created_at DESC
      `,
      [tenantId]
    );

    expect(exception.rows[0].status).toBe("approved");
    expect(canonical.rows[0].status).toBe("approved");
    expect(canonical.rows[0].reporting_flags).toEqual(
      expect.arrayContaining(["manual_adjustment", "admin_override", "edited_by_leadership"])
    );
    expect(approvalRecords.rows[0].approver_id).toBe(leadershipId);
    expect(segments.rows[0].source_type).toBe("admin_override");
    expect(segments.rows[0].reporting_flags).toEqual(
      expect.arrayContaining(["manual_adjustment", "admin_override", "edited_by_leadership"])
    );
    expect(auditRows.rows.some((row) => String(row.reason_comment).includes("Leadership added paid Office/Drive time"))).toBe(true);
  });

  it("rejects missed-punch submission when the linked Time Session is already approved", async () => {
    const startsAt = addMinutes(new Date(), -45);
    const endsAt = addMinutes(startsAt, 120);
    const shootId = await insertShoot({
      title: "TC4 Finalized Submit Guard",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-FinalizedSubmitGuard",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });
    await insertFinalizedSessionForShift({
      shiftId,
      employeeId,
      workDate: toDateString(startsAt),
      status: "approved"
    });

    const response = await request(app)
      .post("/api/attendance/missed-punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: shiftId,
        missing_direction: "in",
        employee_submitted_explanation: "Trying to reopen a finalized day.",
        requested_approver_user_id: seniorId,
        requested_work_state: "photography",
        requested_start_time: startsAt.toISOString()
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("already been approved or exported to payroll");
  });

  it("rejects missed-punch review when the linked Time Session is already payroll exported", async () => {
    const startsAt = addMinutes(new Date(), -90);
    const endsAt = addMinutes(startsAt, 90);
    const shootId = await insertShoot({
      title: "TC4 Finalized Review Guard",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-FinalizedReviewGuard",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });

    const requested = await request(app)
      .post("/api/attendance/missed-punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: shiftId,
        missing_direction: "in",
        employee_submitted_explanation: "Forgot the first punch.",
        requested_approver_user_id: seniorId,
        requested_work_state: "photography",
        requested_start_time: startsAt.toISOString()
      });

    expect(requested.status).toBe(201);

    await insertFinalizedSessionForShift({
      shiftId,
      employeeId,
      workDate: toDateString(startsAt),
      status: "payroll_exported"
    });

    const review = await request(app)
      .post(`/api/attendance/missed-punches/${requested.body.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "approved",
        corrected_time: startsAt.toISOString(),
        notes: "Trying to change a payroll-exported session."
      });

    expect(review.status).toBe(409);
    expect(review.body.error).toContain("already been approved or exported to payroll");
  });

  it("rejects leadership overrides when the linked Time Session is already approved", async () => {
    const startsAt = addMinutes(new Date(), -180);
    const endsAt = addMinutes(startsAt, 90);
    const shootId = await insertShoot({
      title: "TC4 Finalized Leadership Guard",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-FinalizedLeadershipGuard",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });
    await insertFinalizedSessionForShift({
      shiftId,
      employeeId,
      workDate: toDateString(startsAt),
      status: "approved"
    });

    const response = await request(app)
      .post("/api/attendance/time-clock/manual-adjustments")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        employee_id: employeeId,
        shift_id: shiftId,
        requested_work_state: "office_drive",
        requested_start_time: startsAt.toISOString(),
        requested_end_time: endsAt.toISOString(),
        note: "Trying to reopen an approved session."
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("already been approved or exported to payroll");
  });

  it("rejects break-deduction overrides when the linked Time Session is already payroll exported", async () => {
    const startsAt = addMinutes(new Date(), -300);
    const endsAt = addMinutes(startsAt, 120);
    const shootId = await insertShoot({
      title: "TC4 Finalized Break Guard",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt,
      latitude: 44.9778,
      longitude: -93.2649
    });
    const shiftId = await insertShift({
      shootId,
      title: "TC4-FinalizedBreakGuard",
      startsAt,
      endsAt,
      assignedUserId: employeeId,
      managerUserId: seniorId,
      latitude: 44.9778,
      longitude: -93.2649
    });
    await insertFinalizedSessionForShift({
      shiftId,
      employeeId,
      workDate: toDateString(startsAt),
      status: "payroll_exported"
    });
    const timeEntryId = await insertTimeEntryForShift({
      shootId,
      shiftId,
      employeeId,
      startsAt,
      endsAt
    });

    const response = await request(app)
      .post(`/api/attendance/time-entries/${timeEntryId}/break-override`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        break_deduction_minutes: 0,
        reason: "Trying to override a payroll-exported record."
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("already been approved or exported to payroll");
  });
});
