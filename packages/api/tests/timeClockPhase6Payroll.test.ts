import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let studioId = "";
let baseShootId = "";
let sourceEmployeeId = "";
let employeeId = "";
let employeeEmail = "";
let employeeToken = "";
let leadershipId = "";
let leadershipToken = "";

const createdShootIds: string[] = [];
const createdShiftIds: string[] = [];

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function localDateString(value: Date) {
  const noon = new Date(value.getTime());
  noon.setHours(12, 0, 0, 0);
  return noon.toISOString().slice(0, 10);
}

async function cloneEmployee() {
  employeeEmail = `timeclock-phase6-${randomUUID().slice(0, 8)}@example.com`;
  const cloned = await pool.query<{ id: string }>(
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
        'Time Clock Phase 6 Employee',
        true,
        department,
        'active',
        now()
      FROM app_user
      WHERE id = $1
      RETURNING id
    `,
    [sourceEmployeeId, employeeEmail]
  );
  employeeId = cloned.rows[0].id;

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

  await pool.query(
    `
      INSERT INTO employee_pay_profile (
        tenant_id,
        employee_id,
        office_rate,
        photography_rate,
        overtime_eligible,
        mileage_eligible,
        active_status,
        effective_date
      )
      VALUES ($1,$2,18.00,24.00,true,true,true,'2026-01-01'::date)
    `,
    [tenantId, employeeId]
  );
}

async function insertShoot(title: string, when: Date) {
  const code = `TC6-${randomUUID().slice(0, 8)}`;
  const start = addMinutes(when, 15);
  const end = addMinutes(start, 240);
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
        geofence_radius_meters,
        showtime,
        arrival_time,
        start_time,
        end_time_est,
        projected_students,
        created_by
      )
      SELECT
        tenant_id,
        studio_id,
        $2,
        $3,
        $4::date,
        'TC6 Test Venue',
        '123 Payroll Avenue',
        44.9778,
        -93.2649,
        804,
        $5,
        $5,
        $6,
        $7,
        projected_students,
        $8
      FROM shoot
      WHERE id = $1
      RETURNING id
    `,
    [baseShootId, code, title, localDateString(when), when.toISOString(), start.toISOString(), end.toISOString(), leadershipId]
  );
  createdShootIds.push(rows[0].id);
  return rows[0].id;
}

async function insertShift(shootId: string, title: string, startsAt: Date, endsAt: Date) {
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
        $1,$2,$3,$4,$5,$5,'shoot','published','schools',$6,$7,$8,'TC6 Test Venue','123 Payroll Avenue',44.9778,-93.2649,804,now()
      )
      RETURNING id
    `,
    [tenantId, shootId, employeeId, leadershipId, leadershipId, `${title}-${randomUUID().slice(0, 6)}`, startsAt.toISOString(), endsAt.toISOString()]
  );
  createdShiftIds.push(rows[0].id);
  return rows[0].id;
}

async function insertSessionWithSegments(input: {
  workDate: string;
  shiftId: string;
  segments: Array<{
    workState: "office_drive" | "photography";
    startTime: string;
    endTime: string;
    sourceType?: "manual" | "automatic_transition" | "manual_correction" | "admin_override";
  }>;
}) {
  const session = await pool.query<{ id: string }>(
    `
      INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status)
      VALUES ($1,$2,$3::date,$4,'closed')
      RETURNING id
    `,
    [tenantId, employeeId, input.workDate, input.shiftId]
  );

  for (const segment of input.segments) {
    await pool.query(
      `
        INSERT INTO time_segment (
          tenant_id,
          session_id,
          employee_id,
          linked_shift_id,
          work_state,
          start_time,
          end_time,
          source_type,
          geofence_supported,
          review_status,
          reporting_flags
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'approved','{}'::text[])
      `,
      [
        tenantId,
        session.rows[0].id,
        employeeId,
        input.shiftId,
        segment.workState,
        segment.startTime,
        segment.endTime,
        segment.sourceType ?? "manual"
      ]
    );
  }

  return session.rows[0].id;
}

beforeAll(async () => {
  const context = await pool.query(
    `
      SELECT
        t.id AS tenant_id,
        s.id AS studio_id,
        shoot.id AS base_shoot_id,
        leadership.id AS leadership_id,
        employee.id AS employee_id
      FROM tenant t
      JOIN studio s
        ON s.tenant_id = t.id
      JOIN shoot
        ON shoot.tenant_id = t.id
       AND shoot.shoot_code = 'DEMO-001'
      JOIN app_user leadership
        ON leadership.tenant_id = t.id
       AND lower(leadership.email) = lower('leadership@example.com')
      JOIN app_user employee
        ON employee.tenant_id = t.id
       AND lower(employee.email) = lower('newhire@example.com')
      WHERE t.name = 'Demo Studio'
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  studioId = context.rows[0].studio_id;
  baseShootId = context.rows[0].base_shoot_id;
  leadershipId = context.rows[0].leadership_id;
  sourceEmployeeId = context.rows[0].employee_id;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;

  await cloneEmployee();
  employeeToken = (await devLogin(app, employeeEmail)).body.token;
});

beforeEach(async () => {
  await pool.query("DELETE FROM payroll_export_aggregate_session WHERE tenant_id = $1 AND session_id IN (SELECT id FROM time_session WHERE tenant_id = $1 AND employee_id = $2)", [tenantId, employeeId]);
  await pool.query("DELETE FROM payroll_export_aggregate WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session_payroll_summary WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1 AND approver_id IN ($2, $3)", [tenantId, employeeId, leadershipId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM mileage_reimbursement_source WHERE tenant_id = $1 AND reimbursement_id IN (SELECT id FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2)", [tenantId, employeeId]);
  await pool.query("DELETE FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  if (createdShiftIds.length) {
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
    createdShiftIds.length = 0;
  }
  if (createdShootIds.length) {
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
    createdShootIds.length = 0;
  }
});

afterAll(async () => {
  await pool.query("DELETE FROM payroll_export_aggregate_session WHERE tenant_id = $1 AND session_id IN (SELECT id FROM time_session WHERE tenant_id = $1 AND employee_id = $2)", [tenantId, employeeId]);
  await pool.query("DELETE FROM payroll_export_aggregate WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session_payroll_summary WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM approval_record WHERE tenant_id = $1 AND approver_id IN ($2, $3)", [tenantId, employeeId, leadershipId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM mileage_reimbursement_source WHERE tenant_id = $1 AND reimbursement_id IN (SELECT id FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2)", [tenantId, employeeId]);
  await pool.query("DELETE FROM mileage_reimbursement WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  if (createdShiftIds.length) {
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
  }
  if (createdShootIds.length) {
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
  }
  await pool.query("DELETE FROM employee_pay_profile WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM auth_session WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, employeeId]);
});

describe("time clock phase 6 payroll structures", () => {
  it("creates a no-lunch challenge, keeps the deduction pending, and removes it when leadership approves", async () => {
    const workStart = new Date();
    const shootId = await insertShoot("TC6 No Lunch", workStart);
    const shiftId = await insertShift(shootId, "TC6-NoLunch", workStart, addMinutes(workStart, 390));
    const sessionId = await insertSessionWithSegments({
      workDate: localDateString(workStart),
      shiftId,
      segments: [
        {
          workState: "photography",
          startTime: workStart.toISOString(),
          endTime: addMinutes(workStart, 390).toISOString()
        }
      ]
    });

    const submitResponse = await request(app)
      .post("/api/attendance/no-lunch-challenges")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: shiftId,
        reason: "worked_through_lunch",
        note: "Setup ran straight through lunch."
      });

    expect(submitResponse.status).toBe(201);
    // Approve THIS session's own challenge by its returned id. The leadership exceptions
    // list is company-wide, so `.find(first NO_LUNCH_CHALLENGE)` would grab a different
    // employee's challenge whenever a DB-sharing suite runs concurrently (the historical
    // non-hermetic failure). Scope everything to this exception id instead.
    const challengeExceptionId = submitResponse.body.attendance_exception_id as string;
    expect(challengeExceptionId).toBeTruthy();

    const pendingSummary = await pool.query(
      `
        SELECT lunch_deduction_minutes, lunch_deduction_source
        FROM time_session_payroll_summary
        WHERE tenant_id = $1
          AND session_id = $2
      `,
      [tenantId, sessionId]
    );

    expect(pendingSummary.rows[0]?.lunch_deduction_minutes).toBe(30);
    expect(pendingSummary.rows[0]?.lunch_deduction_source).toBe("challenge_pending");

    const leadershipList = await request(app)
      .get(`/api/attendance/exceptions?date=${localDateString(workStart)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(leadershipList.status).toBe(200);
    const challenge = leadershipList.body.find((row: { id: string }) => row.id === challengeExceptionId);
    expect(challenge).toBeTruthy();
    expect(challenge.exception_type).toBe("NO_LUNCH_CHALLENGE");

    const approveResponse = await request(app)
      .post(`/api/attendance/exceptions/${challengeExceptionId}/review`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "approved",
        notes: "Approved by leadership for Phase 6 test."
      });

    expect(approveResponse.status).toBe(200);

    const approvedSummary = await pool.query(
      `
        SELECT lunch_deduction_minutes, lunch_deduction_source, payable_minutes
        FROM time_session_payroll_summary
        WHERE tenant_id = $1
          AND session_id = $2
      `,
      [tenantId, sessionId]
    );

    expect(approvedSummary.rows[0]?.lunch_deduction_minutes).toBe(0);
    expect(approvedSummary.rows[0]?.lunch_deduction_source).toBe("challenge_approved");
    expect(approvedSummary.rows[0]?.payable_minutes).toBe(390);

    const approvalRecords = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM approval_record ar
        JOIN exception_request er
          ON er.id = ar.request_id
        WHERE er.tenant_id = $1
          AND er.linked_session_id = $2
          AND er.request_type = 'lunch_deduction_challenge'
      `,
      [tenantId, sessionId]
    );
    expect(approvalRecords.rows[0]?.count).toBe(1);
  });

  it("builds weekly payroll rollups with explicit overtime, lunch, corrections, and separate mileage reimbursement", async () => {
    const monday = new Date("2026-04-06T13:00:00.000Z");
    const workDates = Array.from({ length: 6 }, (_, index) => addMinutes(monday, index * 24 * 60));

    const sessionIds: string[] = [];
    for (let index = 0; index < workDates.length; index += 1) {
      const workDate = workDates[index];
      const shootId = await insertShoot(`TC6 Payroll ${index + 1}`, workDate);
      const shiftId = await insertShift(shootId, `TC6-Payroll-${index + 1}`, workDate, addMinutes(workDate, 480));
      const sessionId = await insertSessionWithSegments({
        workDate: localDateString(workDate),
        shiftId,
        segments:
          index === 5
            ? [
                {
                  workState: "office_drive",
                  startTime: workDate.toISOString(),
                  endTime: addMinutes(workDate, 120).toISOString(),
                  sourceType: "admin_override"
                },
                {
                  workState: "photography",
                  startTime: addMinutes(workDate, 120).toISOString(),
                  endTime: addMinutes(workDate, 360).toISOString()
                }
              ]
            : [
                {
                  workState: "office_drive",
                  startTime: workDate.toISOString(),
                  endTime: addMinutes(workDate, 240).toISOString()
                },
                {
                  workState: "photography",
                  startTime: addMinutes(workDate, 240).toISOString(),
                  endTime: addMinutes(workDate, 480).toISOString()
                }
              ]
      });
      sessionIds.push(sessionId);
    }

    await pool.query(
      `
        INSERT INTO exception_request (
          tenant_id,
          employee_id,
          request_type,
          linked_session_id,
          note,
          status
        )
        VALUES ($1,$2,'missing_clock_in',$3,'Approved missed clock-in for payroll test.','approved')
      `,
      [tenantId, employeeId, sessionIds[0]]
    );

    const approvalRequest = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM exception_request
        WHERE tenant_id = $1
          AND employee_id = $2
          AND linked_session_id = $3
          AND request_type = 'missing_clock_in'
        LIMIT 1
      `,
      [tenantId, employeeId, sessionIds[0]]
    );

    await pool.query(
      `
        INSERT INTO approval_record (
          tenant_id,
          request_id,
          approver_id,
          approver_role,
          decision,
          comment
        )
        VALUES ($1,$2,$3,'leadership','approved','Approved for payroll test.')
      `,
      [tenantId, approvalRequest.rows[0].id, leadershipId]
    );

    await pool.query(
      `
        INSERT INTO mileage_reimbursement (
          tenant_id,
          employee_id,
          work_date,
          reimbursement_amount,
          status,
          source_evaluation_count,
          reporting_flags
        )
        VALUES ($1,$2,$3::date,42.00,'candidate',1,ARRAY['phase5_mileage'])
      `,
      [tenantId, employeeId, localDateString(workDates[4])]
    );

    const response = await request(app)
      .get(`/api/attendance/payroll-summary?date=${localDateString(workDates[0])}&user_id=${employeeId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.source_of_truth.primary_model).toBe("canonical_labor_state");
    expect(response.body.pay_period.start).toBe("2026-04-06");
    expect(response.body.pay_period.end).toBe("2026-04-12");
    expect(response.body.summary.overtime_hours).toBe(3);
    expect(response.body.transition.legacy_time_entry_summary.break_override_count).toBeGreaterThanOrEqual(0);
    expect(response.body.transition.comparison.mismatch_employee_count).toBeGreaterThanOrEqual(0);

    expect(response.body.rows).toHaveLength(1);
    const row = response.body.rows[0];
    expect(row.overtime_base_rate).toBe("21.00");
    expect(row.overtime_rate).toBe("31.50");
    expect(row.mileage_reimbursement_amount).toBe("42.00");
    expect(row.manual_correction_count).toBe(1);
    expect(row.missed_clock_in_approval_count).toBe(1);
    expect(row.regular_office_drive_minutes + row.regular_photography_minutes).toBe(2400);
    expect(row.overtime_minutes).toBe(180);
    expect(row.sessions).toHaveLength(6);
    expect(row.approval_flags).toEqual(expect.arrayContaining(["manual_adjustment", "missed_clock_in_approval"]));
    expect(row.legacy_comparison).toBeTruthy();
  });
});
