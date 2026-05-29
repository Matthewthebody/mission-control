import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { haversineMiles } from "../src/services/geo.js";
import { getStudioLocation } from "../src/services/maps.js";
import { syncMileageReviewForShiftCloseout } from "../src/services/timeClockMileage.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const studio = getStudioLocation();

const createdShootIds: string[] = [];
const createdShiftIds: string[] = [];
const createdLocationIds: string[] = [];
const createdWorkDates = new Set<string>();

let adminToken = "";
let seniorToken = "";
let leadershipToken = "";
let tenantId = "";
let studioId = "";
let adminUserId = "";
let seniorUserId = "";
let leadershipUserId = "";
let organizationId = "";
let primaryContactId = "";

type LocationFixture = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type ShootFixture = {
  shootId: string;
  shiftId: string;
  shootCode: string;
  workDate: string;
  location: LocationFixture;
};

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  seniorToken = (await devLogin(app, "senior@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;

  const seedContext = await pool.query(
    `
      SELECT
        admin.id AS admin_user_id,
        senior.id AS senior_user_id,
        leadership.id AS leadership_user_id,
        admin.tenant_id,
        studio.id AS studio_id,
        org.id AS organization_id,
        contact.id AS primary_contact_id
      FROM app_user admin
      JOIN app_user senior
        ON senior.tenant_id = admin.tenant_id
       AND lower(senior.email) = lower('senior@example.com')
      JOIN app_user leadership
        ON leadership.tenant_id = admin.tenant_id
       AND lower(leadership.email) = lower('leadership@example.com')
      JOIN studio
        ON studio.tenant_id = admin.tenant_id
      JOIN organization org
        ON org.tenant_id = admin.tenant_id
       AND org.display_name = 'White Bear Lake High School'
      JOIN organization_contact contact
        ON contact.tenant_id = org.tenant_id
       AND contact.organization_id = org.id
       AND contact.full_name = 'Jamie Carlson'
      WHERE lower(admin.email) = lower('admin@example.com')
      ORDER BY studio.created_at ASC
      LIMIT 1
    `
  );

  const context = seedContext.rows[0];
  tenantId = context.tenant_id;
  studioId = context.studio_id;
  adminUserId = context.admin_user_id;
  seniorUserId = context.senior_user_id;
  leadershipUserId = context.leadership_user_id;
  organizationId = context.organization_id;
  primaryContactId = context.primary_contact_id;
});

afterAll(async () => {
  const workDates = [...createdWorkDates];
  if (workDates.length) {
    await pool.query(
      `
        DELETE FROM mileage_reimbursement_source
        WHERE reimbursement_id IN (
          SELECT id
          FROM mileage_reimbursement
          WHERE tenant_id = $1
            AND employee_id = ANY($2::uuid[])
            AND work_date = ANY($3::date[])
        )
      `,
      [tenantId, [seniorUserId, leadershipUserId], workDates]
    );
    await pool.query(
      `
        DELETE FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = ANY($2::uuid[])
          AND work_date = ANY($3::date[])
      `,
      [tenantId, [seniorUserId, leadershipUserId], workDates]
    );
  }

  if (createdShiftIds.length) {
    await pool.query("DELETE FROM post_shoot_evaluation WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM time_entry WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_punch WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_segment WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query(
      "DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'shift_id' = ANY($2::text[])",
      [tenantId, createdShiftIds]
    );
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
  }

  if (createdShootIds.length) {
    await pool.query("DELETE FROM alert WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM status_event WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query(
      "DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'shoot_id' = ANY($2::text[])",
      [tenantId, createdShootIds]
    );
    await pool.query("DELETE FROM shoot_contact_link WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
  }

  if (createdLocationIds.length) {
    await pool.query("DELETE FROM shoot_location WHERE id = ANY($1::uuid[])", [createdLocationIds]);
  }
});

describe("time clock mileage reimbursement phase 5", () => {
  it("flags review when a worked day is missing a Post-Shoot Evaluation", async () => {
    const workDate = futureWorkDate(12);
    const location = await createLocationFixture("Review", 10);
    const fixture = await createShootFixture("MISSING-EVAL", workDate, location);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await syncMileageReviewForShiftCloseout(client, {
        tenantId,
        employeeId: seniorUserId,
        workDate,
        actorUserId: adminUserId
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const reimbursement = await pool.query(
      `
        SELECT status, review_reason_code, linked_shoot_id, source_evaluation_count
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = $2
          AND work_date = $3::date
      `,
      [tenantId, seniorUserId, workDate]
    );

    expect(reimbursement.rows[0]?.status).toBe("review_required");
    expect(reimbursement.rows[0]?.review_reason_code).toBe("missing_post_shoot_evaluation");
    expect(reimbursement.rows[0]?.linked_shoot_id).toBeNull();
    expect(reimbursement.rows[0]?.source_evaluation_count).toBe(0);

    expect(fixture.shootId).toBeTruthy();
  });

  it("creates a mileage candidate for an eligible personal-vehicle submission", async () => {
    const workDate = futureWorkDate(13);
    const location = await createLocationFixture("Zone One", 10);
    const fixture = await createShootFixture("ZONE-ONE", workDate, location);

    const submitResponse = await request(app)
      .post(`/api/employee/shifts/${fixture.shiftId}/post-shoot-evaluation`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        overall_shoot_status: "successful",
        went_well: "Setup went smoothly.",
        remember_next_time: "Keep the same staging order.",
        issue_flag: false,
        open_comment: "Mileage candidate check.",
        submit_for_mileage: true,
        vehicle_type: "personal_vehicle"
      });

    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.mileage_reimbursement.status).toBe("candidate");
    expect(submitResponse.body.mileage_reimbursement.zone_name).toBe("Zone 1");
    expect(submitResponse.body.mileage_reimbursement.reimbursement_amount).toBe("15.00");

    const reimbursement = await pool.query(
      `
        SELECT
          employee_id,
          linked_shoot_id,
          zone_name,
          reimbursement_amount,
          status,
          vehicle_type
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = $2
          AND work_date = $3::date
      `,
      [tenantId, seniorUserId, workDate]
    );

    expect(reimbursement.rows[0]?.employee_id).toBe(seniorUserId);
    expect(reimbursement.rows[0]?.linked_shoot_id).toBe(fixture.shootId);
    expect(reimbursement.rows[0]?.zone_name).toBe("Zone 1");
    expect(reimbursement.rows[0]?.reimbursement_amount).toBe("15.00");
    expect(reimbursement.rows[0]?.status).toBe("candidate");
    expect(reimbursement.rows[0]?.vehicle_type).toBe("personal_vehicle");

    const reviewList = await request(app)
      .get(`/api/attendance/mileage-reimbursements?date=${workDate}&user_id=${seniorUserId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(reviewList.status).toBe(200);
    expect(reviewList.body.source_of_truth.primary_model).toBe("canonical_mileage_reimbursement");
    expect(reviewList.body.transition.comparison.mismatch_day_count).toBeGreaterThanOrEqual(0);
    expect(reviewList.body.rows[0].legacy_comparison).toBeTruthy();
  });

  it("pays only once per day using the higher mileage zone across multiple shoots", async () => {
    const workDate = futureWorkDate(14);
    const nearLocation = await createLocationFixture("Near", 10);
    const farLocation = await createLocationFixture("Far", 40);
    const nearFixture = await createShootFixture("MULTI-NEAR", workDate, nearLocation, 8);
    const farFixture = await createShootFixture("MULTI-FAR", workDate, farLocation, 13);

    const nearDistance = haversineMiles(studio.latitude, studio.longitude, nearLocation.latitude, nearLocation.longitude);
    const farDistance = haversineMiles(studio.latitude, studio.longitude, farLocation.latitude, farLocation.longitude);
    expect(nearDistance).toBeLessThan(15);
    expect(farDistance).toBeGreaterThan(30);
    expect(farDistance).toBeLessThan(45);

    for (const fixture of [nearFixture, farFixture]) {
      const response = await request(app)
        .post(`/api/employee/shifts/${fixture.shiftId}/post-shoot-evaluation`)
        .set("Authorization", `Bearer ${seniorToken}`)
        .send({
          overall_shoot_status: "successful",
          went_well: "Stayed on schedule.",
          remember_next_time: "Keep the same staging order.",
          issue_flag: false,
          open_comment: "Multi-shoot mileage selection test.",
          submit_for_mileage: true,
          vehicle_type: "personal_vehicle"
        });

      expect(response.status).toBe(201);
    }

    const reimbursement = await pool.query(
      `
        SELECT
          linked_shoot_id,
          linked_shift_id,
          zone_name,
          reimbursement_amount,
          status,
          source_evaluation_count
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = $2
          AND work_date = $3::date
      `,
      [tenantId, seniorUserId, workDate]
    );

    expect(reimbursement.rows[0]?.linked_shoot_id).toBe(farFixture.shootId);
    expect(reimbursement.rows[0]?.linked_shift_id).toBe(farFixture.shiftId);
    expect(reimbursement.rows[0]?.zone_name).toBe("Zone 3");
    expect(reimbursement.rows[0]?.reimbursement_amount).toBe("42.00");
    expect(reimbursement.rows[0]?.status).toBe("candidate");
    expect(reimbursement.rows[0]?.source_evaluation_count).toBe(2);

    const sources = await pool.query(
      `
        SELECT shift_id, zone_name, reimbursement_amount, eligible_for_selection, review_reason_code
        FROM mileage_reimbursement_source
        WHERE tenant_id = $1
          AND reimbursement_id = (
            SELECT id
            FROM mileage_reimbursement
            WHERE tenant_id = $1
              AND employee_id = $2
              AND work_date = $3::date
          )
        ORDER BY reimbursement_amount ASC
      `,
      [tenantId, seniorUserId, workDate]
    );

    expect(sources.rows).toEqual([
      {
        shift_id: nearFixture.shiftId,
        zone_name: "Zone 1",
        reimbursement_amount: "15.00",
        eligible_for_selection: true,
        review_reason_code: null
      },
      {
        shift_id: farFixture.shiftId,
        zone_name: "Zone 3",
        reimbursement_amount: "42.00",
        eligible_for_selection: true,
        review_reason_code: null
      }
    ]);
  });

  it("attributes leadership-submitted evaluations and mileage to the assigned photographer", async () => {
    const workDate = futureWorkDate(15);
    const location = await createLocationFixture("Leadership", 12);
    const fixture = await createShootFixture("LEADERSHIP", workDate, location);

    const response = await request(app)
      .post(`/api/employee/shifts/${fixture.shiftId}/post-shoot-evaluation`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        overall_shoot_status: "successful",
        went_well: "Leadership captured the closeout on behalf of the team.",
        remember_next_time: "Assigned photographer still owns the history.",
        issue_flag: false,
        open_comment: "Leadership attribution safeguard.",
        submit_for_mileage: true,
        vehicle_type: "personal_vehicle"
      });

    expect(response.status).toBe(201);

    const evaluation = await pool.query(
      `
        SELECT photographer_user_id, submitted_by_user_id
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND shift_id = $2
        ORDER BY submitted_at DESC
        LIMIT 1
      `,
      [tenantId, fixture.shiftId]
    );

    expect(evaluation.rows[0]?.photographer_user_id).toBe(seniorUserId);
    expect(evaluation.rows[0]?.submitted_by_user_id).toBe(leadershipUserId);

    const photographerMileage = await pool.query(
      `
        SELECT employee_id, status
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = $2
          AND work_date = $3::date
      `,
      [tenantId, seniorUserId, workDate]
    );
    const leadershipMileage = await pool.query(
      `
        SELECT employee_id
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND employee_id = $2
          AND work_date = $3::date
      `,
      [tenantId, leadershipUserId, workDate]
    );

    expect(photographerMileage.rows[0]?.employee_id).toBe(seniorUserId);
    expect(photographerMileage.rows[0]?.status).toBe("candidate");
    expect(leadershipMileage.rows).toHaveLength(0);
  });
});

async function createLocationFixture(label: string, targetMilesFromStudio: number): Promise<LocationFixture> {
  const latitude = studio.latitude + targetMilesFromStudio / 69;
  const longitude = studio.longitude;
  const locationName = `Prompt 6 ${label} ${Date.now()}`;
  const address = `${Math.round(targetMilesFromStudio * 10)} Test Ave, Deephaven, MN 55391`;

  const inserted = await pool.query(
    `
      INSERT INTO shoot_location (
        tenant_id,
        organization_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        address_line_1,
        city,
        state,
        zip,
        maps_label,
        active_status,
        latitude,
        longitude,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,$2,'mission_control',$3,$4,lower($4),$5,lower($5),$6,'Deephaven','MN','55391',$4,'active',$7,$8,$9,$9
      )
      RETURNING id, name, address, latitude, longitude
    `,
    [
      tenantId,
      organizationId,
      `phase5-${crypto.randomUUID()}`,
      locationName,
      address,
      address.split(",")[0],
      latitude,
      longitude,
      adminUserId
    ]
  );

  const location = inserted.rows[0] as LocationFixture;
  createdLocationIds.push(location.id);
  return location;
}

async function createShootFixture(
  label: string,
  workDate: string,
  location: LocationFixture,
  startHour = 8
): Promise<ShootFixture> {
  createdWorkDates.add(workDate);

  const startsAt = buildUtcTimestamp(workDate, startHour);
  const endsAt = buildUtcTimestamp(workDate, startHour + 3);
  const shootCode = `P6-${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const createResponse = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: organizationId,
      location_id: location.id,
      primary_contact_id: primaryContactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: shootCode,
      title: `Phase 5 ${label} Shoot`,
      shoot_date: workDate,
      geofence_radius_meters: 180,
      showtime: startsAt,
      arrival_time: startsAt,
      start_time: startsAt,
      end_time_est: endsAt,
      planned_staff_count: 1,
      required_lead_count: 1,
      special_instructions: "Phase 5 mileage regression fixture."
    });

  expect(createResponse.status).toBe(201);
  const shootId = createResponse.body.id as string;
  createdShootIds.push(shootId);

  const shiftInsert = await pool.query(
    `
      INSERT INTO work_shift (
        tenant_id,
        shoot_id,
        studio_id,
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
        geofence_radius_meters,
        navigation_url,
        notes,
        published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$6,
        'shoot','published','schools','senior_photographer',true,$7,$8,$9,
        $10,$11,180,'https://maps.example/phase5-mileage','Phase 5 mileage fixture',now()
      )
      RETURNING id
    `,
    [
      tenantId,
      shootId,
      studioId,
      seniorUserId,
      leadershipUserId,
      adminUserId,
      `${shootCode} Senior Coverage`,
      startsAt,
      endsAt,
      location.name,
      location.address
    ]
  );

  const shiftId = shiftInsert.rows[0].id as string;
  createdShiftIds.push(shiftId);

  return {
    shootId,
    shiftId,
    shootCode,
    workDate,
    location
  };
}

function buildUtcTimestamp(workDate: string, hour: number) {
  return `${workDate}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function futureWorkDate(offsetDays: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}
