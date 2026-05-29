import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId, getTenantId, passwordLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let studioId = "";
let seniorToken = "";
let leadershipToken = "";
let seniorUserId = "";
let leadershipUserId = "";
const createdShootIds: string[] = [];
const createdShiftIds: string[] = [];

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

async function insertReadyToShootTestShoot(input: {
  title: string;
  arrivalTime: Date;
  startTime: Date;
  endTime: Date;
}) {
  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const result = await pool.query(
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
        arrival_time,
        start_time,
        end_time_est,
        status,
        pre_service_notes_complete,
        special_deliverables_ready,
        gear_requirements_ready,
        roster_data_required,
        roster_data_ready,
        created_by
      )
      VALUES (
        $1,$2,$3,$4,$5,
        'Ready Test Venue','400 Readiness Way',44.9778,-93.2649,200,
        $6,$7,$8,'CONFIRMED',true,true,true,false,false,$9
      )
      RETURNING id
    `,
    [
      tenantId,
      studioId,
      `READY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      input.title,
      localDate,
      input.arrivalTime,
      input.startTime,
      input.endTime,
      leadershipUserId
    ]
  );
  const shootId = String(result.rows[0].id);
  createdShootIds.push(shootId);
  return shootId;
}

async function insertLeadShift(input: {
  shootId: string;
  assignedUserId: string;
  managerUserId: string;
  staffingRole: string;
  satisfiesLeadCoverage: boolean;
  startsAt: Date;
  endsAt: Date;
  title: string;
}) {
  const result = await pool.query(
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
        staffing_role,
        satisfies_lead_coverage,
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
        $1,$2,$3,$4,$5,$5,
        'shoot','published','schools',$6,$7,$8,$9,$10,
        'Ready Test Venue','400 Readiness Way',44.9778,-93.2649,200,now()
      )
      RETURNING id
    `,
    [
      tenantId,
      input.shootId,
      input.assignedUserId,
      input.managerUserId,
      leadershipUserId,
      input.staffingRole,
      input.satisfiesLeadCoverage,
      input.title,
      input.startsAt,
      input.endsAt
    ]
  );
  const shiftId = String(result.rows[0].id);
  createdShiftIds.push(shiftId);
  return shiftId;
}

async function insertClockIn(shiftId: string, shootId: string, userId: string, timestamp: Date) {
  await pool.query(
    `
      INSERT INTO shift_punch (
        tenant_id,
        shift_id,
        shoot_id,
        user_id,
        direction,
        source,
        client_timestamp,
        geofence_status,
        gps_confidence,
        approval_state
      )
      VALUES ($1,$2,$3,$4,'in','test',$5,'inside','normal','not_required')
    `,
    [tenantId, shiftId, shootId, userId, timestamp]
  );
}

beforeAll(async () => {
  tenantId = (await getTenantId("Demo Studio")) ?? "";
  seniorUserId = (await getMembershipId("senior@example.com")) ?? "";
  leadershipUserId = (await getMembershipId("leadership@example.com")) ?? "";
  seniorToken = (await devLogin(app, "senior@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  studioId = String(
    (
      await pool.query("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1", [tenantId])
    ).rows[0]?.id ?? ""
  );
});

afterEach(async () => {
  if (createdShiftIds.length) {
    await pool.query("DELETE FROM shift_punch WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'shoot_id' = ANY($2::text[])", [tenantId, createdShootIds]);
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
    createdShiftIds.length = 0;
  }
  if (createdShootIds.length) {
    await pool.query("DELETE FROM shoot_operational_confirmation WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM audit_log WHERE tenant_id = $1 AND entity_type = 'shoot' AND entity_id = ANY($2::text[])", [tenantId, createdShootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
    createdShootIds.length = 0;
  }
});

describe("Ready to Shoot workflow", () => {
  it("allows the assigned lead to confirm a clean Ready to Shoot submission once on site", async () => {
    const now = new Date();
    const shootId = await insertReadyToShootTestShoot({
      title: "Ready To Shoot Clean",
      arrivalTime: addMinutes(now, -10),
      startTime: addMinutes(now, 10),
      endTime: addMinutes(now, 120)
    });
    const leadShiftId = await insertLeadShift({
      shootId,
      assignedUserId: seniorUserId,
      managerUserId: leadershipUserId,
      staffingRole: "senior_photographer",
      satisfiesLeadCoverage: true,
      startsAt: addMinutes(now, -15),
      endsAt: addMinutes(now, 120),
      title: "Ready To Shoot Lead"
    });
    await insertClockIn(leadShiftId, shootId, seniorUserId, addMinutes(now, -5));

    const response = await request(app)
      .post(`/api/shoots/${shootId}/ready-to-shoot`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        note: "Crew is set and the room is ready.",
        latitude: 44.97781,
        longitude: -93.26491,
        accuracy_meters: 12
      });

    expect(response.status).toBe(200);
    expect(response.body.lead_confirmed_ready).toBe(true);
    expect(response.body.lead_confirmed_ready_exception_flag).toBe(false);
    expect(response.body.ready_to_shoot.already_confirmed).toBe(true);
    expect(response.body.ready_to_shoot.latest_confirmation.clean_confirmation).toBe(true);
    expect(response.body.ready_to_shoot.latest_confirmation.confirmed_by_user_id).toBe(seniorUserId);
  });

  it("allows an assigned leadership lead to confirm with exception when staffing is still short", async () => {
    const now = new Date();
    const shootId = await insertReadyToShootTestShoot({
      title: "Ready To Shoot Exception",
      arrivalTime: addMinutes(now, -15),
      startTime: addMinutes(now, 8),
      endTime: addMinutes(now, 120)
    });
    const leadShiftId = await insertLeadShift({
      shootId,
      assignedUserId: leadershipUserId,
      managerUserId: leadershipUserId,
      staffingRole: "lead_photographer",
      satisfiesLeadCoverage: true,
      startsAt: addMinutes(now, -20),
      endsAt: addMinutes(now, 120),
      title: "Ready To Shoot Leadership Lead"
    });
    await insertLeadShift({
      shootId,
      assignedUserId: seniorUserId,
      managerUserId: leadershipUserId,
      staffingRole: "photographer",
      satisfiesLeadCoverage: false,
      startsAt: addMinutes(now, -20),
      endsAt: addMinutes(now, 120),
      title: "Ready To Shoot Missing Photographer"
    });
    await insertClockIn(leadShiftId, shootId, leadershipUserId, addMinutes(now, -5));

    const response = await request(app)
      .post(`/api/shoots/${shootId}/ready-to-shoot`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        exception_reason: "Second photographer is still en route from a vehicle issue.",
        note: "Proceeding with check-in coverage while the final camera station arrives.",
        latitude: 44.97781,
        longitude: -93.26491,
        accuracy_meters: 12
      });

    expect(response.status).toBe(200);
    expect(response.body.lead_confirmed_ready).toBe(true);
    expect(response.body.lead_confirmed_ready_exception_flag).toBe(true);
    expect(response.body.ready_to_shoot.already_confirmed).toBe(true);
    expect(response.body.ready_to_shoot.latest_confirmation.clean_confirmation).toBe(false);
    expect(response.body.ready_to_shoot.latest_confirmation.exception_reason).toContain("en route");
  });
});
