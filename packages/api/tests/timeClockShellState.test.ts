import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let sourceUserId = "";
let managerUserId = "";
let employeeId = "";
let employeeEmail = "";
let employeeToken = "";
let demoShootId = "";
let demoLocationLat = 0;
let demoLocationLng = 0;

async function cleanupEmployeeTimeClockArtifacts() {
  await pool.query("DELETE FROM time_clock_compliance_flag WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_clock_presence_observation WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM attendance_exception WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2", [tenantId, employeeId]);
  await pool.query(
    "DELETE FROM shift_segment WHERE tenant_id = $1 AND shift_id IN (SELECT id FROM work_shift WHERE tenant_id = $1 AND assigned_user_id = $2 AND title LIKE 'Shell Time Clock Test%')",
    [tenantId, employeeId]
  );
  await pool.query(
    "DELETE FROM work_shift WHERE tenant_id = $1 AND assigned_user_id = $2 AND title LIKE 'Shell Time Clock Test%'",
    [tenantId, employeeId]
  );
}

async function insertShootShift() {
  const startsAt = new Date(Date.now() - 10 * 60_000);
  const endsAt = new Date(Date.now() + 3 * 60 * 60_000);
  const title = `Shell Time Clock Test ${randomUUID().slice(0, 8)}`;

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
          staffing_role,
          satisfies_lead_coverage,
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
          $1,$2,$3,$4,$4,$4,
          'shoot',
          'published',
          'schools',
          $5,
          'photographer',
          false,
          $6,
          $7,
          'Demo Test Site',
          '123 Demo Way',
          $8,
          $9,
          804,
          now()
        )
        RETURNING id
      `,
      [
        tenantId,
        demoShootId,
        employeeId,
        managerUserId,
        title,
        startsAt.toISOString(),
        endsAt.toISOString(),
        demoLocationLat,
        demoLocationLng
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
      VALUES ($1,$2,'shoot','Coverage',$3,$4,'shoot',2200,0)
    `,
    [tenantId, shift.id, startsAt.toISOString(), endsAt.toISOString()]
  );

  return shift.id as string;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id as string;

  const people = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('photo@example.com', 'senior@example.com')
    `,
    [tenantId]
  );

  sourceUserId = people.rows.find((row) => row.email === "photo@example.com")?.id as string;
  managerUserId = people.rows.find((row) => row.email === "senior@example.com")?.id as string;
  const shoot = await pool.query(
    `
      SELECT id, location_lat, location_lng
      FROM shoot
      WHERE tenant_id = $1
        AND shoot_code = 'DEMO-001'
      LIMIT 1
    `,
    [tenantId]
  );
  demoShootId = shoot.rows[0].id as string;
  demoLocationLat = Number(shoot.rows[0].location_lat ?? 44.973);
  demoLocationLng = Number(shoot.rows[0].location_lng ?? -93.227);
  employeeEmail = `timeclock-shell-${randomUUID().slice(0, 10)}@example.com`;

  employeeId = (
    await pool.query<{ id: string }>(
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
          'Time Clock Shell Employee',
          true,
          department,
          'active',
          now()
        FROM app_user
        WHERE id = $1
        RETURNING id
      `,
      [sourceUserId, employeeEmail]
    )
  ).rows[0].id;

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
    [tenantId, employeeId, sourceUserId]
  );

  await pool.query(
    `
      INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
      SELECT tenant_id, $2, job_function_profile
      FROM user_job_function_profile
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, employeeId, sourceUserId]
  );

  await pool.query(
    `
      INSERT INTO user_role (tenant_id, user_id, role_id)
      SELECT tenant_id, $2, role_id
      FROM user_role
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, employeeId, sourceUserId]
  );

  employeeToken = (await devLogin(app, employeeEmail)).body.token as string;
});

afterAll(async () => {
  await cleanupEmployeeTimeClockArtifacts();
  if (employeeId) {
    await pool.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
    await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
    await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, employeeId]);
    await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, employeeId]);
  }
});

beforeEach(async () => {
  await cleanupEmployeeTimeClockArtifacts();
});

describe("time clock shell control state route", () => {
  it("returns a red action-needed state when the employee has an active shift and is not punched in", async () => {
    const shiftId = await insertShootShift();

    const response = await request(app)
      .get("/api/attendance/time-clock/state")
      .set("Authorization", `Bearer ${employeeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.state).toBe("action_needed");
    expect(response.body.emphasis).toBe("red");
    expect(response.body.label).toBe("Punch In Needed");
    expect(response.body.action.direction).toBe("in");
    expect(response.body.action.shift_id).toBe(shiftId);
    expect(response.body.time_clock_state.current_state).toBe("off_clock");
  });

  it("returns a green active state after punching in through the canonical attendance route", async () => {
    const shiftId = await insertShootShift();

    const punchIn = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({
        shift_id: shiftId,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        client_event_id: randomUUID(),
        latitude: demoLocationLat,
        longitude: demoLocationLng,
        source: "timeclock-shell-test"
      });

    expect(punchIn.status).toBe(201);
    expect(punchIn.body.time_clock_state.current_state).toBe("photography");

    const response = await request(app)
      .get("/api/attendance/time-clock/state")
      .set("Authorization", `Bearer ${employeeToken}`);

    expect(response.status).toBe(200);
    expect(response.body.state).toBe("active");
    expect(response.body.emphasis).toBe("green");
    expect(response.body.label).toBe("Punched In");
    expect(response.body.action.direction).toBe("out");
    expect(response.body.time_clock_state.current_state).toBe("photography");
    expect(response.body.active_shift?.id).toBe(shiftId);
  });
});
