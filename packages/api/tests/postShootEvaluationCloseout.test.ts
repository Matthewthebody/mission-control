import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let adminToken = "";
let seniorToken = "";
let tenantId = "";
let studioId = "";
let adminUserId = "";
let seniorUserId = "";
let leadershipUserId = "";
let organizationId = "";
let locationId = "";
let primaryContactId = "";
let locationName = "";
let locationAddress = "";

const createdShootIds: string[] = [];
const createdShiftIds: string[] = [];

type CloseoutFixture = {
  shootId: string;
  shiftId: string;
  shootCode: string;
};

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  seniorToken = (await devLogin(app, "senior@example.com")).body.token;

  const seedContext = await pool.query(
    `
      SELECT
        admin.id AS admin_user_id,
        senior.id AS senior_user_id,
        leadership.id AS leadership_user_id,
        admin.tenant_id,
        studio.id AS studio_id,
        org.id AS organization_id,
        loc.id AS location_id,
        loc.name AS location_name,
        COALESCE(
          NULLIF(trim(concat_ws(', ', loc.address_line_1, loc.address_line_2, concat_ws(', ', loc.city, loc.state), loc.zip)), ''),
          loc.address
        ) AS location_address,
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
      JOIN shoot_location loc
        ON loc.tenant_id = org.tenant_id
       AND loc.organization_id = org.id
       AND loc.name = 'Downtown Demo Park'
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
  locationId = context.location_id;
  primaryContactId = context.primary_contact_id;
  locationName = context.location_name;
  locationAddress = context.location_address;

  await pool.query(
    `
      UPDATE employee_pay_profile
      SET
        office_rate = 26,
        photography_rate = 34,
        overtime_eligible = true,
        mileage_eligible = true,
        updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND active_status = true
    `,
    [tenantId, seniorUserId]
  );
});

afterAll(async () => {
  if (createdShiftIds.length) {
    await pool.query("DELETE FROM time_clock_compliance_flag WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
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
    await pool.query("DELETE FROM time_clock_compliance_flag WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM alert WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM status_event WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query(
      "DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'shoot_id' = ANY($2::text[])",
      [tenantId, createdShootIds]
    );
    await pool.query("DELETE FROM shoot_contact_link WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
  }
});

describe("post-shoot evaluation closeout workflow", () => {
  it("surfaces the setup-photo reminder during senior coverage once the threshold passes", async () => {
    const fixture = await createCloseoutFixture("REMINDER", {
      startsAt: minutesFromNow(-90),
      endsAt: minutesFromNow(90)
    });

    const clockInAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const clockIn = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${seniorToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        shift_id: fixture.shiftId,
        shoot_id: fixture.shootId,
        direction: "in",
        client_timestamp: clockInAt,
        source: "mobile_app"
      });

    expect(clockIn.status).toBe(201);

    const detail = await request(app)
      .get(`/api/employee/shifts/${fixture.shiftId}`)
      .set("Authorization", `Bearer ${seniorToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.closeout_compliance.setup_photo_required).toBe(true);
    expect(detail.body.closeout_compliance.setup_photo_uploaded).toBe(false);
    expect(detail.body.closeout_compliance.setup_photo_reminder_due).toBe(true);
    expect(detail.body.closeout_compliance.post_shoot_evaluation_required).toBe(true);
    expect(detail.body.closeout_compliance.post_shoot_evaluation_submitted).toBe(false);
    expect(detail.body.actions.can_submit_post_shoot_eval).toBe(true);
  });

  it("locks the Post-Shoot Evaluation after the first submission", async () => {
    const fixture = await createCloseoutFixture("LOCK", {
      startsAt: minutesFromNow(-15),
      endsAt: minutesFromNow(120)
    });

    const submitResponse = await request(app)
      .post(`/api/employee/shifts/${fixture.shiftId}/post-shoot-evaluation`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        overall_shoot_status: "completed_with_issues",
        went_well: "Crew adapted quickly once the gym doors were opened.",
        remember_next_time: "Bring one extra extension cord for the scorer's table run.",
        issue_flag: true,
        open_comment: "Leadership should ask the site to unlock the south entrance earlier next year."
      });

    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.evaluation.overall_shoot_status).toBe("completed_with_issues");
    expect(submitResponse.body.closeout_compliance.post_shoot_evaluation_submitted).toBe(true);

    const persisted = await pool.query(
      `
        SELECT
          shoot_id,
          organization_id,
          location_id,
          shift_id,
          photographer_user_id,
          evaluation_year,
          submitted_at,
          overall_shoot_status::text AS overall_shoot_status,
          went_well,
          remember_next_time,
          issue_flag,
          open_comment
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND shift_id = $2
          AND photographer_user_id = $3
        ORDER BY submitted_at DESC
        LIMIT 1
      `,
      [tenantId, fixture.shiftId, seniorUserId]
    );

    expect(persisted.rows[0]?.shoot_id).toBe(fixture.shootId);
    expect(persisted.rows[0]?.organization_id).toBe(organizationId);
    expect(persisted.rows[0]?.location_id).toBe(locationId);
    expect(persisted.rows[0]?.shift_id).toBe(fixture.shiftId);
    expect(persisted.rows[0]?.photographer_user_id).toBe(seniorUserId);
    expect(persisted.rows[0]?.evaluation_year).toBe(new Date().getFullYear());
    expect(persisted.rows[0]?.submitted_at).toBeTruthy();
    expect(persisted.rows[0]?.overall_shoot_status).toBe("completed_with_issues");
    expect(persisted.rows[0]?.issue_flag).toBe(true);
    expect(persisted.rows[0]?.went_well).toBe("Crew adapted quickly once the gym doors were opened.");
    expect(persisted.rows[0]?.remember_next_time).toBe("Bring one extra extension cord for the scorer's table run.");
    expect(persisted.rows[0]?.open_comment).toBe("Leadership should ask the site to unlock the south entrance earlier next year.");

    const detail = await request(app)
      .get(`/api/employee/shifts/${fixture.shiftId}`)
      .set("Authorization", `Bearer ${seniorToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.closeout_compliance.post_shoot_evaluation_submitted).toBe(true);
    expect(detail.body.closeout_compliance.last_post_shoot_evaluation).toMatchObject({
      overall_shoot_status: "completed_with_issues",
      issue_flag: true,
      went_well: "Crew adapted quickly once the gym doors were opened.",
      remember_next_time: "Bring one extra extension cord for the scorer's table run.",
      open_comment: "Leadership should ask the site to unlock the south entrance earlier next year."
    });

    const secondSubmit = await request(app)
      .post(`/api/employee/shifts/${fixture.shiftId}/post-shoot-evaluation`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        overall_shoot_status: "successful"
      });

    expect(secondSubmit.status).toBe(409);
    expect(String(secondSubmit.body.error ?? "")).toMatch(/already submitted/i);
  });

  it("warns but still allows clock-out when closeout items are missing, then alerts leadership", async () => {
    const fixture = await createCloseoutFixture("CLOCKOUT", {
      startsAt: minutesFromNow(-75),
      endsAt: minutesFromNow(60)
    });

    const clockIn = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${seniorToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        shift_id: fixture.shiftId,
        shoot_id: fixture.shootId,
        direction: "in",
        client_timestamp: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
        source: "mobile_app"
      });

    expect(clockIn.status).toBe(201);

    const clockOut = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${seniorToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        shift_id: fixture.shiftId,
        shoot_id: fixture.shootId,
        direction: "out",
        client_timestamp: new Date().toISOString(),
        source: "mobile_app"
      });

    expect(clockOut.status).toBe(201);
    expect(clockOut.body.punch.direction).toBe("out");
    expect(clockOut.body.closeout_compliance.missing_required_items).toEqual(
      expect.arrayContaining(["setup_photo", "post_shoot_evaluation"])
    );
    expect(clockOut.body.closeout_compliance.mileage_reimbursement.review_reason_code).toBe("missing_post_shoot_evaluation");
    expect(String(clockOut.body.closeout_compliance.warning_message ?? "")).toMatch(/clock-out is allowed/i);
    expect(String(clockOut.body.closeout_compliance.warning_message ?? "")).toMatch(/mileage reimbursement stays blocked/i);

    const alerts = await pool.query(
      `
        SELECT alert_type, status
        FROM alert
        WHERE shoot_id = $1
          AND alert_type IN ('MISSING_SETUP_PHOTO', 'MISSING_POST_SHOOT_EVALUATION')
        ORDER BY alert_type ASC
      `,
      [fixture.shootId]
    );

    expect(alerts.rows).toEqual([
      { alert_type: "MISSING_POST_SHOOT_EVALUATION", status: "open" },
      { alert_type: "MISSING_SETUP_PHOTO", status: "open" }
    ]);

    const notifications = await pool.query(
      `
        SELECT
          payload->>'notification_type' AS notification_type,
          payload->>'recipient_user_id' AS recipient_user_id
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'shift_id' = $2
        ORDER BY payload->>'notification_type' ASC
      `,
      [tenantId, fixture.shiftId]
    );

    expect(notifications.rows.some((row) => row.notification_type === "shoot.closeout_missing_setup_photo")).toBe(true);
    expect(notifications.rows.some((row) => row.notification_type === "shoot.closeout_missing_post_shoot_evaluation")).toBe(true);
    expect(notifications.rows.some((row) => row.recipient_user_id === leadershipUserId)).toBe(true);

    const complianceFlags = await pool.query(
      `
        SELECT item_type::text
        FROM time_clock_compliance_flag
        WHERE tenant_id = $1
          AND employee_id = $2
          AND shift_id = $3
          AND status = 'open'
        ORDER BY item_type ASC
      `,
      [tenantId, seniorUserId, fixture.shiftId]
    );

    expect(complianceFlags.rows.map((row) => row.item_type)).toEqual(
      expect.arrayContaining([
        "missing_setup_photo",
        "missing_post_shoot_evaluation"
      ])
    );
  });
});

async function createCloseoutFixture(
  label: string,
  timing: {
    startsAt: Date;
    endsAt: Date;
  }
): Promise<CloseoutFixture> {
  const localDate = toLocalDateString(timing.startsAt);
  const shootCode = `PSE-${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const createResponse = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: organizationId,
      location_id: locationId,
      primary_contact_id: primaryContactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: shootCode,
      title: `Prompt 5 ${label} Shoot`,
      shoot_date: localDate,
      geofence_radius_meters: 180,
      showtime: timing.startsAt.toISOString(),
      arrival_time: timing.startsAt.toISOString(),
      start_time: timing.startsAt.toISOString(),
      end_time_est: timing.endsAt.toISOString(),
      planned_staff_count: 1,
      required_lead_count: 1,
      special_instructions: "Prompt 5 closeout coverage fixture."
    });

  expect(createResponse.status).toBe(201);
  const shootId = createResponse.body.id as string;
  createdShootIds.push(shootId);

  const shiftInsert = await pool.query(
    `
      INSERT INTO work_shift (
        tenant_id, shoot_id, studio_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
        shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at,
        location_name, location_address, geofence_radius_meters, navigation_url, notes, published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$6,
        'shoot','published','schools','senior_photographer',true,$7,$8,$9,
        $10,$11,180,'https://maps.example/prompt5-closeout','Prompt 5 closeout test shift',now()
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
      timing.startsAt.toISOString(),
      timing.endsAt.toISOString(),
      locationName,
      locationAddress
    ]
  );

  const shiftId = shiftInsert.rows[0].id as string;
  createdShiftIds.push(shiftId);

  return { shootId, shiftId, shootCode };
}

function minutesFromNow(offsetMinutes: number) {
  return new Date(Date.now() + offsetMinutes * 60 * 1000);
}

function toLocalDateString(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
