import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
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
  employeeEmail = `payroll-review-${randomUUID().slice(0, 8)}@example.com`;
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
        'Payroll Review Employee',
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
      VALUES ($1,$2,19.00,26.00,true,true,true,current_date)
    `,
    [tenantId, employeeId]
  );
}

async function insertShoot(title: string, when: Date) {
  const code = `PR-${randomUUID().slice(0, 8)}`;
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
        'PR Test Venue',
        '456 Payroll Plaza',
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
        $1,$2,$3,$4,$5,$5,'shoot','published','schools',$6,$7,$8,'PR Test Venue','456 Payroll Plaza',44.9778,-93.2649,804,now()
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
        shoot.id AS base_shoot_id,
        leadership.id AS leadership_id,
        employee.id AS employee_id
      FROM tenant t
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

describe("payroll review phase G3", () => {
  it("builds a review desk row, employee drill-in, and export payload from canonical payroll aggregates", async () => {
    const monday = new Date("2026-04-06T13:00:00.000Z");
    const secondDay = addMinutes(monday, 24 * 60);

    const firstShootId = await insertShoot("Payroll Review Lunch", monday);
    const firstShiftId = await insertShift(firstShootId, "PR-Lunch", monday, addMinutes(monday, 390));
    const firstSessionId = await insertSessionWithSegments({
      workDate: localDateString(monday),
      shiftId: firstShiftId,
      segments: [
        {
          workState: "photography",
          startTime: monday.toISOString(),
          endTime: addMinutes(monday, 390).toISOString()
        }
      ]
    });

    const secondShootId = await insertShoot("Payroll Review Manual", secondDay);
    const secondShiftId = await insertShift(secondShootId, "PR-Manual", secondDay, addMinutes(secondDay, 480));
    const secondSessionId = await insertSessionWithSegments({
      workDate: localDateString(secondDay),
      shiftId: secondShiftId,
      segments: [
        {
          workState: "office_drive",
          startTime: secondDay.toISOString(),
          endTime: addMinutes(secondDay, 120).toISOString(),
          sourceType: "admin_override"
        },
        {
          workState: "photography",
          startTime: addMinutes(secondDay, 120).toISOString(),
          endTime: addMinutes(secondDay, 420).toISOString()
        }
      ]
    });

    const noLunchResponse = await request(app)
      .post("/api/attendance/no-lunch-challenges")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: firstShiftId,
        reason: "worked_through_lunch",
        note: "Still running the gym line."
      });

    expect(noLunchResponse.status).toBe(201);

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
        VALUES ($1,$2,'missing_clock_in',$3,'Approved missed clock-in for payroll review.','approved')
      `,
      [tenantId, employeeId, secondSessionId]
    );

    const missedClockInRequest = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM exception_request
        WHERE tenant_id = $1
          AND employee_id = $2
          AND linked_session_id = $3
          AND request_type = 'missing_clock_in'
        LIMIT 1
      `,
      [tenantId, employeeId, secondSessionId]
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
        VALUES ($1,$2,$3,'leadership','approved','Approved for payroll review test.')
      `,
      [tenantId, missedClockInRequest.rows[0].id, leadershipId]
    );

    await pool.query(
      `
        INSERT INTO mileage_reimbursement (
          tenant_id,
          employee_id,
          work_date,
          selected_evaluation_id,
          linked_shift_id,
          linked_shoot_id,
          reimbursement_amount,
          status,
          review_reason_code,
          source_evaluation_count,
          reporting_flags
        )
        VALUES ($1,$2,$3::date,null,$4,$5,38.00,'review_required','other_needs_review',1,ARRAY['phase5_mileage','review_required'])
      `,
      [tenantId, employeeId, localDateString(secondDay), secondShiftId, secondShootId]
    );

    const reimbursementId = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = $2
          AND work_date = $3::date
        LIMIT 1
      `,
      [tenantId, employeeId, localDateString(secondDay)]
    );

    await pool.query(
      `
        INSERT INTO mileage_reimbursement_source (
          tenant_id,
          reimbursement_id,
          evaluation_id,
          shift_id,
          shoot_id,
          reimbursement_amount,
          submit_for_mileage,
          vehicle_type,
          eligible_for_selection,
          review_reason_code
        )
        VALUES ($1,$2,null,$3,$4,38.00,true,'other_needs_review',true,'other_needs_review')
      `,
      [tenantId, reimbursementId.rows[0].id, secondShiftId, secondShootId]
    );

    const reviewResponse = await request(app)
      .get(`/api/attendance/payroll-review?date=${localDateString(monday)}&user_id=${employeeId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(reviewResponse.status).toBe(200);
    expect(reviewResponse.body.summary.blocked_count).toBe(1);
    expect(reviewResponse.body.rows).toHaveLength(1);
    expect(reviewResponse.body.rows[0].export_readiness).toBe("blocked");
    expect(reviewResponse.body.rows[0].manual_correction_count).toBe(1);
    expect(reviewResponse.body.rows[0].missed_clock_in_approval_count).toBe(1);
    expect(reviewResponse.body.rows[0].review_issues.map((issue: { code: string }) => issue.code)).toEqual(
      expect.arrayContaining(["pending_no_lunch_challenge", "review_required_mileage"])
    );

    const detailResponse = await request(app)
      .get(`/api/attendance/payroll-review/${employeeId}?date=${localDateString(monday)}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.row.employee_id).toBe(employeeId);
    expect(detailResponse.body.linked_records.sessions).toHaveLength(2);
    expect(detailResponse.body.linked_records.sessions[0].segments.length).toBeGreaterThan(0);
    expect(detailResponse.body.linked_records.exception_requests.map((row: { request_type: string }) => row.request_type)).toEqual(
      expect.arrayContaining(["lunch_deduction_challenge", "missing_clock_in"])
    );
    expect(detailResponse.body.linked_records.mileage_reimbursements).toHaveLength(1);
    expect(detailResponse.body.linked_records.mileage_reimbursements[0].sources).toHaveLength(1);
    expect(detailResponse.body.export_payload_row.export_readiness).toBe("blocked");

    const exportPayloadResponse = await request(app)
      .get(`/api/attendance/payroll-review/export-payload?date=${localDateString(monday)}&user_id=${employeeId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(exportPayloadResponse.status).toBe(200);
    expect(exportPayloadResponse.body.summary.blocked_count).toBe(1);
    expect(exportPayloadResponse.body.rows[0].employee_id).toBe(employeeId);
    expect(exportPayloadResponse.body.rows[0].mileage_reimbursement_amount).toBe(0);

    const csvResponse = await request(app)
      .get(`/api/attendance/payroll-review/export.csv?date=${localDateString(monday)}&user_id=${employeeId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers["content-type"]).toContain("text/csv");
    expect(csvResponse.text).toContain("employee_id");
    expect(csvResponse.text).toContain(employeeId);
    expect(csvResponse.text).toContain("blocked");

    expect(firstSessionId).toBeTruthy();
  });
});
