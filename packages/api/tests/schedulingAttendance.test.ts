import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getLocalDateString } from "../src/utils/localDate.js";
import { devLogin, elevateSession } from "./helpers.js";

const app = createApp();

let leadershipToken = "";
let adminToken = "";
let seniorToken = "";
let photoToken = "";
let tenantId = "";
let demoShootId = "";
let sportsShootId = "";
let leadershipId = "";
let seniorId = "";
let photoId = "";
let associateId = "";
let newHireId = "";

function localTodayAt(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function todayString() {
  return getLocalDateString(new Date());
}

async function cloneShootForDate(sourceShootId: string, codePrefix: string, title: string, shootDate: string) {
  const { rows } = await pool.query(
    `
      INSERT INTO shoot (
        tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
        location_lat, location_lng, navigation_url, geofence_radius_meters,
        arrival_time, start_time, end_time_est, projected_students
      )
      SELECT
        tenant_id,
        studio_id,
        $2,
        $3,
        $4::date,
        location_name,
        location_address,
        location_lat,
        location_lng,
        navigation_url,
        geofence_radius_meters,
        arrival_time,
        start_time,
        end_time_est,
        projected_students
      FROM shoot
      WHERE id = $1
      RETURNING id, shoot_date
    `,
    [sourceShootId, `${codePrefix}-${randomUUID().slice(0, 8)}`, title, shootDate]
  );
  if (!rows[0]) {
    throw new Error("Unable to create test-owned shoot fixture.");
  }
  return rows[0];
}

async function cloneDemoShootForDate(codePrefix: string, title: string, shootDate: string) {
  return cloneShootForDate(demoShootId, codePrefix, title, shootDate);
}

async function isolateSeededShootForShift(shootId: string | null | undefined, title: string, startsAt: Date) {
  if (!shootId || (shootId !== demoShootId && shootId !== sportsShootId)) {
    return shootId ?? null;
  }

  const sourceLabel = shootId === sportsShootId ? "Sports" : "Demo";
  const clone = await cloneShootForDate(shootId, "SHIFT", `${sourceLabel} ${title}`, getLocalDateString(startsAt));
  return clone.id;
}

async function cloneTradeReplacementUser() {
  const email = `trade-replacement-${randomUUID().slice(0, 10)}@example.com`;
  const cloned = await pool.query<{ id: string; email: string }>(
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
        'Trade Replacement Photographer',
        true,
        department,
        'active',
        now()
      FROM app_user
      WHERE id = $1
      RETURNING id, email
    `,
    [newHireId, email]
  );
  const replacement = cloned.rows[0];
  if (!replacement) {
    throw new Error("Unable to create trade replacement fixture.");
  }

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
    [tenantId, replacement.id, newHireId]
  );

  await pool.query(
    `
      INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
      SELECT tenant_id, $2, job_function_profile
      FROM user_job_function_profile
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, replacement.id, newHireId]
  );

  await pool.query(
    `
      INSERT INTO user_role (tenant_id, user_id, role_id)
      SELECT tenant_id, $2, role_id
      FROM user_role
      WHERE tenant_id = $1
        AND user_id = $3
    `,
    [tenantId, replacement.id, newHireId]
  );

  return replacement;
}

async function insertShift(options: {
  shootId?: string | null;
  assignedUserId: string;
  managerUserId?: string | null;
  department: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  shiftKind?: "shoot" | "studio" | "office" | "training";
  status?: "draft" | "published";
  locationLat?: number;
  locationLng?: number;
  geofenceRadiusMeters?: number;
  segments?: Array<{ label: string; kind: string; startsAt: Date; endsAt: Date; rateCode: string }>;
}) {
  const shootId = await isolateSeededShootForShift(options.shootId, options.title, options.startsAt);
  const shift = (
    await pool.query(
      `
        INSERT INTO work_shift (
          tenant_id, shoot_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
          shift_kind, status, department, title, starts_at, ends_at, location_name, location_address,
          location_lat, location_lng, geofence_radius_meters, published_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7::work_shift_kind,$8::work_shift_status,$9,$10,$11,$12,'Test Location','123 Test Street',$13,$14,$15,
          CASE WHEN $8::work_shift_status = 'published' THEN now() ELSE NULL END
        )
        RETURNING *
      `,
      [
        tenantId,
        shootId,
        options.assignedUserId,
        options.managerUserId ?? null,
        leadershipId,
        leadershipId,
        options.shiftKind ?? "shoot",
        options.status ?? "published",
        options.department,
        `${options.title}-${randomUUID().slice(0, 8)}`,
        options.startsAt,
        options.endsAt,
        options.locationLat ?? 44.9778,
        options.locationLng ?? -93.2649,
        options.geofenceRadiusMeters ?? 200
      ]
    )
  ).rows[0];

  const segments = options.segments ?? [
    {
      label: "Primary segment",
      kind: "shoot",
      startsAt: options.startsAt,
      endsAt: options.endsAt,
      rateCode: "shoot"
    }
  ];

  for (const [index, segment] of segments.entries()) {
    await pool.query(
      `
        INSERT INTO shift_segment (
          tenant_id, shift_id, segment_kind, label, scheduled_start_at, scheduled_end_at, rate_code, hourly_rate_cents, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,2500,$8)
      `,
      [tenantId, shift.id, segment.kind, segment.label, segment.startsAt, segment.endsAt, segment.rateCode, index]
    );
  }

  return shift;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;

  const people = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN (
          'leadership@example.com',
          'admin@example.com',
          'senior@example.com',
          'photo@example.com',
          'associate@example.com',
          'newhire@example.com'
        )
    `,
    [tenantId]
  );

  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id;
  seniorId = people.rows.find((row) => row.email === "senior@example.com")?.id;
  photoId = people.rows.find((row) => row.email === "photo@example.com")?.id;
  associateId = people.rows.find((row) => row.email === "associate@example.com")?.id;
  newHireId = people.rows.find((row) => row.email === "newhire@example.com")?.id;

  const shoots = await pool.query("SELECT id, shoot_code FROM shoot WHERE tenant_id = $1 AND shoot_code IN ('DEMO-001','DEMO-002')", [tenantId]);
  demoShootId = shoots.rows.find((row) => row.shoot_code === "DEMO-001")?.id;
  sportsShootId = shoots.rows.find((row) => row.shoot_code === "DEMO-002")?.id;

  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
  adminToken = (await request(app).post("/auth/login").send({ email: "admin@example.com", password: "LocalDemo123!" })).body.token;
  seniorToken = (await request(app).post("/auth/login").send({ email: "senior@example.com", password: "LocalDemo123!" })).body.token;
  photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;
  await elevateSession(app, leadershipToken, "LocalDemo123!");
});

describe("scheduling and attendance operations", () => {
  it("allows director admins and leadership to create and publish shifts", async () => {
    const startsAt = localTodayAt(13, 0);
    const endsAt = addMinutes(startsAt, 120);
    const schedulingShoot = await cloneDemoShootForDate("SHIFT-CREATE", "Leadership Schedule Fixture", todayString());
    const payload = {
      shoot_id: schedulingShoot.id,
      assigned_user_id: photoId,
      manager_user_id: seniorId,
      shift_kind: "shoot",
      department: "schools",
      title: `Leadership Schedule ${randomUUID().slice(0, 8)}`,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      segments: [
        {
          segment_kind: "shoot",
          label: "Coverage",
          scheduled_start_at: startsAt.toISOString(),
          scheduled_end_at: endsAt.toISOString(),
          rate_code: "shoot",
          hourly_rate_cents: 2500
        }
      ]
    };

    const directorCreated = await request(app).post("/api/shifts").set("Authorization", `Bearer ${adminToken}`).send(payload);
    expect(directorCreated.status).toBe(201);
    expect(directorCreated.body.status).toBe("draft");

    const created = await request(app).post("/api/shifts").set("Authorization", `Bearer ${leadershipToken}`).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");

    const updated = await request(app)
      .patch(`/api/shifts/${created.body.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ title: "Leadership Schedule Updated" });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Leadership Schedule Updated");

    const published = await request(app)
      .post(`/api/shifts/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("published");

    const realtimeEvents = await pool.query(
      `
        SELECT payload->>'change_type' AS change_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'schedule.realtime.changed'
          AND aggregate_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, created.body.id]
    );
    expect(realtimeEvents.rows.map((row) => row.change_type)).toEqual(["created", "updated", "published"]);
  }, 30000);

  it("allows a clock-in within the normal early window without approval friction", async () => {
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "Under15Early",
      startsAt: addMinutes(new Date(), 10),
      endsAt: addMinutes(new Date(), 130)
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        attested_approved: true,
        approver_user_id: seniorId,
        reason_code: "approved_early"
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.approval_state).toBe("not_required");
    expect(response.body.punch.timing_status).toBe("early");
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).not.toContain("EARLY_CLOCK_IN_APPROVAL");
  }, 30000);

  it("allows a scheduled employee to punch into a shift-backed shoot even without a legacy shoot assignment row", async () => {
    const shift = await insertShift({
      shootId: sportsShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "sports",
      title: "ShiftBackedAssignmentOnly",
      startsAt: addMinutes(new Date(), 10),
      endsAt: addMinutes(new Date(), 130),
      locationLat: 45.0144,
      locationLng: -93.4557,
      geofenceRadiusMeters: 250
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 45.0144,
        longitude: -93.4557,
        accuracy_meters: 10,
        client_event_id: randomUUID(),
        attested_approved: true,
        approver_user_id: seniorId,
        reason_code: "approved_early"
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.shift_id).toBe(shift.id);
    expect(response.body.event.shoot_id).toBe(shift.shoot_id);
  });

  it("keeps a shift-backed shoot visible to the assigned employee without relying on legacy assignments", async () => {
    const adHocShoot = (
      await pool.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
            location_lat, location_lng, navigation_url, geofence_radius_meters,
            arrival_time, start_time, end_time_est, projected_students
          )
          SELECT
            tenant_id,
            studio_id,
            $2,
            'Shift-backed visibility check',
            shoot_date,
            location_name,
            location_address,
            location_lat,
            location_lng,
            navigation_url,
            geofence_radius_meters,
            arrival_time,
            start_time,
            end_time_est,
            projected_students
          FROM shoot
          WHERE id = $1
          RETURNING id, shoot_date
        `,
        [demoShootId, `VIS-${randomUUID().slice(0, 8)}`]
      )
    ).rows[0];

    await insertShift({
      shootId: adHocShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "ShiftBackedShootVisible",
      startsAt: addMinutes(new Date(), 20),
      endsAt: addMinutes(new Date(), 140)
    });
    const shootDate =
      adHocShoot.shoot_date instanceof Date
        ? adHocShoot.shoot_date.toISOString().slice(0, 10)
        : String(adHocShoot.shoot_date).slice(0, 10);

    const listResponse = await request(app)
      .get(`/api/shoots?date=${shootDate}`)
      .set("Authorization", `Bearer ${photoToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((row: { id: string }) => row.id === adHocShoot.id)).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/shoots/${adHocShoot.id}`)
      .set("Authorization", `Bearer ${photoToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(adHocShoot.id);
  });

  it("lets the assigned senior manager see open exceptions for the shift they manage", async () => {
    const shift = await insertShift({
      shootId: sportsShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "sports",
      title: "SeniorManagedExceptionVisibility",
      startsAt: addMinutes(new Date(), 40),
      endsAt: addMinutes(new Date(), 160),
      locationLat: 45.0144,
      locationLng: -93.4557,
      geofenceRadiusMeters: 250
    });

    const punch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 45.0144,
        longitude: -93.4557,
        accuracy_meters: 10,
        client_event_id: randomUUID(),
        attested_approved: true,
        approver_user_id: seniorId,
        reason_code: "approved_early"
      });

    expect(punch.status).toBe(201);
    expect(punch.body.punch.approval_state).toBe("pending");
    expect(punch.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("EARLY_CLOCK_IN_APPROVAL");

    const list = await request(app)
      .get("/api/attendance/exceptions?status=open")
      .set("Authorization", `Bearer ${seniorToken}`);

    expect(list.status).toBe(200);
    expect(list.body.some((item: { shift_id: string }) => item.shift_id === shift.id)).toBe(true);
  });

  it("returns only published coworkers from shift-backed shoot assignments", async () => {
    const coworkerShoot = (
      await pool.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
            location_lat, location_lng, navigation_url, geofence_radius_meters,
            arrival_time, start_time, end_time_est, projected_students
          )
          SELECT
            tenant_id,
            studio_id,
            $2,
            'Shift-backed coworker visibility',
            shoot_date,
            location_name,
            location_address,
            location_lat,
            location_lng,
            navigation_url,
            geofence_radius_meters,
            arrival_time,
            start_time,
            end_time_est,
            projected_students
          FROM shoot
          WHERE id = $1
          RETURNING id
        `,
        [sportsShootId, `COWORKER-${randomUUID().slice(0, 8)}`]
      )
    ).rows[0];

    const startsAt = addMinutes(new Date(), 45);
    const endsAt = addMinutes(startsAt, 120);
    const primaryShift = await insertShift({
      shootId: coworkerShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "sports",
      title: "CoworkerSourcePrimary",
      startsAt,
      endsAt
    });
    await insertShift({
      shootId: coworkerShoot.id,
      assignedUserId: associateId,
      managerUserId: seniorId,
      department: "sports",
      title: "CoworkerSourcePublished",
      startsAt,
      endsAt
    });
    await insertShift({
      shootId: coworkerShoot.id,
      assignedUserId: seniorId,
      managerUserId: leadershipId,
      department: "sports",
      title: "CoworkerSourceDraft",
      startsAt,
      endsAt,
      status: "draft"
    });

    const detail = await request(app)
      .get(`/api/shifts/${primaryShift.id}`)
      .set("Authorization", `Bearer ${photoToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.coworkers.map((coworker: { id: string }) => coworker.id)).toEqual([associateId]);
  });

  it("allows same-shoot coworker shift access without legacy assignments while keeping standalone shifts private", async () => {
    const coworkerShoot = (
      await pool.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
            location_lat, location_lng, navigation_url, geofence_radius_meters,
            arrival_time, start_time, end_time_est, projected_students
          )
          SELECT
            tenant_id,
            studio_id,
            $2,
            'Coworker access target',
            shoot_date,
            location_name,
            location_address,
            location_lat,
            location_lng,
            navigation_url,
            geofence_radius_meters,
            arrival_time,
            start_time,
            end_time_est,
            projected_students
          FROM shoot
          WHERE id = $1
          RETURNING id
        `,
        [demoShootId, `COWORKER-${randomUUID().slice(0, 8)}`]
      )
    ).rows[0];

    const startsAt = addMinutes(new Date(), 60);
    const endsAt = addMinutes(startsAt, 120);
    await insertShift({
      shootId: coworkerShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "CoworkerViewerAccess",
      startsAt,
      endsAt
    });
    const coworkerShift = await insertShift({
      shootId: coworkerShoot.id,
      assignedUserId: associateId,
      managerUserId: seniorId,
      department: "schools",
      title: "CoworkerViewerTarget",
      startsAt,
      endsAt
    });
    const standaloneShift = await insertShift({
      assignedUserId: associateId,
      managerUserId: seniorId,
      department: "operations",
      shiftKind: "studio",
      title: "StandaloneNoCoworkerAccess",
      startsAt,
      endsAt
    });

    const coworkerDetail = await request(app)
      .get(`/api/shifts/${coworkerShift.id}`)
      .set("Authorization", `Bearer ${photoToken}`);
    expect(coworkerDetail.status).toBe(200);
    expect(coworkerDetail.body.id).toBe(coworkerShift.id);

    const standaloneDetail = await request(app)
      .get(`/api/shifts/${standaloneShift.id}`)
      .set("Authorization", `Bearer ${photoToken}`);
    expect(standaloneDetail.status).toBe(403);
  });

  it("creates a critical exception for a clock-in far beyond the allowed early window", async () => {
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "Over15Early",
      startsAt: addMinutes(new Date(), 50),
      endsAt: addMinutes(new Date(), 170)
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        approver_user_id: seniorId,
        reason_code: "approved_early",
        notes: "Leadership approved loading gear early."
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.approval_state).toBe("pending");
    expect(response.body.punch.high_priority).toBe(true);
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("EARLY_CLOCK_IN_HIGH_PRIORITY");
  });

  it("allows an 8-minute late clock-in and classifies it as late", async () => {
    const startsAt = addMinutes(new Date(), -8);
    const endsAt = addMinutes(startsAt, 120);
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "LateWarningBand",
      startsAt,
      endsAt
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.timing_status).toBe("late");
    expect(response.body.punch.late_minutes).toBeGreaterThanOrEqual(8);
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("LATE_CLOCK_IN_WARNING");
  });

  it("allows a 16-minute late clock-in and marks it critically late", async () => {
    const startsAt = addMinutes(new Date(), -16);
    const endsAt = addMinutes(startsAt, 120);
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "LateOfficialBand",
      startsAt,
      endsAt
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.timing_status).toBe("critically_late");
    expect(response.body.punch.late_minutes).toBeGreaterThanOrEqual(16);
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("LATE_CLOCK_IN");
  });

  it("routes clock-ins past the missed punch threshold into the missed-punch workflow", async () => {
    const startsAt = addMinutes(new Date(), -61);
    const endsAt = addMinutes(startsAt, 180);
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "MissedPunchThreshold",
      startsAt,
      endsAt
    });

    const blockedPunch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(blockedPunch.status).toBe(409);
    expect(String(blockedPunch.body.error ?? blockedPunch.text)).toContain("missed-punch threshold");

    const missedPunch = await request(app)
      .post("/api/attendance/missed-punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        shift_id: shift.id,
        missing_direction: "in",
        employee_submitted_explanation: "Phone battery died during load-in.",
        requested_approver_user_id: seniorId,
        corrected_time: startsAt.toISOString()
      });

    expect(missedPunch.status).toBe(201);
    expect(missedPunch.body.workflow_kind).toBe("missed_punch");
    expect(missedPunch.body.missing_direction).toBe("in");

    const approved = await request(app)
      .post(`/api/attendance/missed-punches/${missedPunch.body.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "approved",
        corrected_time: startsAt.toISOString()
      });

    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");

    const correctedPunch = await pool.query(
      `
        SELECT direction, source, approval_state
        FROM shift_punch
        WHERE shift_id = $1
          AND user_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [shift.id, photoId]
    );
    expect(correctedPunch.rows[0].direction).toBe("in");
    expect(correctedPunch.rows[0].source).toBe("correction");
    expect(correctedPunch.rows[0].approval_state).toBe("approved");
  });

  it("prevents a senior photographer from approving a missed punch outside their scope", async () => {
    const startsAt = addMinutes(new Date(), -70);
    const endsAt = addMinutes(startsAt, 120);
    const shift = await insertShift({
      assignedUserId: photoId,
      managerUserId: leadershipId,
      department: "office",
      shiftKind: "office",
      title: "OutOfScopeMissedPunch",
      startsAt,
      endsAt
    });

    const missedPunch = await request(app)
      .post("/api/attendance/missed-punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        shift_id: shift.id,
        missing_direction: "in",
        employee_submitted_explanation: "Arrived but could not punch in.",
        requested_approver_user_id: leadershipId,
        corrected_time: startsAt.toISOString()
      });

    expect(missedPunch.status).toBe(201);

    const denied = await request(app)
      .post(`/api/attendance/missed-punches/${missedPunch.body.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "approved",
        corrected_time: startsAt.toISOString()
      });

    expect(denied.status).toBe(403);
  });

  it("applies an automatic 30-minute break deduction after 5 hours and supports leadership override", async () => {
    const startsAt = localTodayAt(8, 0);
    const endsAt = addMinutes(startsAt, 390);
    const payrollShoot = await cloneDemoShootForDate(
      "BRK",
      "Break deduction payroll coverage",
      getLocalDateString(startsAt)
    );
    const shift = await insertShift({
      shootId: payrollShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "BreakDeductionPolicy",
      startsAt,
      endsAt
    });

    const clockIn = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: startsAt.toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(clockIn.status).toBe(201);

    const clockOut = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "out",
        client_timestamp: addMinutes(startsAt, 330).toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(clockOut.status).toBe(201);
    // G2 write-freeze: punches no longer grow the legacy projection.
    expect(clockOut.body.timeEntry).toBeNull();
    // The break-override flow is retained for HISTORICAL pre-freeze rows — seed
    // one exactly as the legacy writer produced it (330 gross → auto 30 break).
    const historicalEntry = await pool.query<{ id: string }>(
      `INSERT INTO time_entry (tenant_id, shoot_id, shift_id, user_id, clock_in_at, clock_out_at, minutes_worked, gross_minutes, break_deduction_minutes, break_deduction_applied, break_deduction_source, payable_minutes, attendance_state, payroll_state)
       VALUES ($1, $2, $3, $4, $5, $6, 330, 330, 30, true, 'auto_30_after_5h', 300, 'clocked_out', 'ready')
       RETURNING id`,
      [tenantId, shift.shoot_id ?? null, shift.id, photoId, startsAt.toISOString(), addMinutes(startsAt, 330).toISOString()]
    );

    const override = await request(app)
      .post(`/api/attendance/time-entries/${historicalEntry.rows[0].id}/break-override`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        break_deduction_minutes: 0,
        reason: "Manager approved paid working lunch on travel day."
      });

    expect(override.status).toBe(200);
    expect(override.body.break_deduction_minutes).toBe(0);
    expect(override.body.break_deduction_overridden).toBe(true);
    expect(override.body.approved_payable_minutes).toBe(330);

    const linkedSession = await pool.query(
      `
        SELECT id
        FROM time_session
        WHERE tenant_id = $1
          AND source_shift_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [tenantId, shift.id]
    );
    const linkedSessionId = linkedSession.rows[0]?.id;
    expect(linkedSessionId).toBeTruthy();

    const payroll = await request(app)
      .get(`/api/attendance/payroll-summary?date=${getLocalDateString(startsAt)}&user_id=${photoId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(payroll.status).toBe(200);
    expect(payroll.body.summary.break_override_count).toBeGreaterThanOrEqual(1);
    expect(
      payroll.body.rows.some(
        (row: {
          approval_flags?: string[];
          sessions?: Array<{ session_id: string; payable_minutes: number }>;
        }) =>
          row.approval_flags?.includes("approved_no_lunch_challenge") &&
          row.sessions?.some((session) => session.session_id === linkedSessionId && session.payable_minutes === 330)
      )
    ).toBe(true);
  }, 10_000);

  it("treats a repeated consecutive clock-in on the same shift as a safe duplicate", async () => {
    const startsAt = addMinutes(new Date(), -5);
    const endsAt = addMinutes(startsAt, 120);
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "DuplicateClockIn",
      startsAt,
      endsAt
    });

    const firstClientEventId = randomUUID();
    const first = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", firstClientEventId)
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: firstClientEventId
      });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });

    expect(second.status).toBe(201);
    expect(second.body.punch.id).toBe(first.body.punch.id);

    const punchCount = await pool.query("SELECT COUNT(*)::int AS total FROM shift_punch WHERE shift_id = $1", [shift.id]);
    expect(punchCount.rows[0].total).toBe(1);
  });

  it("allows unscheduled punches but flags them for review", async () => {
    const adHocShoot = (
      await pool.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
            location_lat, location_lng, navigation_url, geofence_radius_meters,
            arrival_time, start_time, end_time_est, projected_students
          )
          SELECT
            tenant_id,
            studio_id,
            $2,
            'Unscheduled Support Coverage',
            shoot_date,
            location_name,
            location_address,
            location_lat,
            location_lng,
            navigation_url,
            geofence_radius_meters,
            arrival_time,
            start_time,
            end_time_est,
            projected_students
          FROM shoot
          WHERE id = $1
          RETURNING id
        `,
        [sportsShootId, `UNSCHED-${randomUUID().slice(0, 8)}`]
      )
    ).rows[0];

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shoot_id: adHocShoot.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 45.0144,
        longitude: -93.4557,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        approver_user_id: leadershipId,
        reason_code: "unscheduled_support",
        notes: "Asked to help cover a second location."
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.unscheduled).toBe(true);
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("UNSCHEDULED_PUNCH");
  });

  it("lets the assigned senior manager approve same-day exceptions for a managed standalone shift", async () => {
    const punchTime = localTodayAt(12, 0);
    const shift = await insertShift({
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "operations",
      shiftKind: "studio",
      title: "SeniorManagedStandalone",
      startsAt: addMinutes(punchTime, 40),
      endsAt: addMinutes(punchTime, 160)
    });

    const punch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: punchTime.toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        attested_approved: true,
        approver_user_id: seniorId,
        reason_code: "approved_early"
      });

    expect(punch.status).toBe(201);
    expect(punch.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("EARLY_CLOCK_IN_APPROVAL");
    const exceptionId = punch.body.exceptions[0]?.id;
    expect(exceptionId).toBeTruthy();

    const review = await request(app)
      .post(`/api/attendance/exceptions/${exceptionId}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "approved",
        classification: "manager-approved exception"
      });

    expect(review.status).toBe(200);
    expect(review.body.approved_by_user_id).toBe(seniorId);
    expect(review.body.status).toBe("approved");
  });

  it("distinguishes low-confidence GPS from true wrong-location punches", async () => {
    const lowConfidenceShift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "LowConfidence",
      startsAt: addMinutes(new Date(), -30),
      endsAt: addMinutes(new Date(), 90),
      geofenceRadiusMeters: 200
    });

    const lowConfidence = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: lowConfidenceShift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9798,
        longitude: -93.2649,
        accuracy_meters: 30,
        client_event_id: randomUUID(),
        approver_user_id: seniorId,
        reason_code: "gps_issue"
      });

    expect(lowConfidence.status).toBe(201);
    expect(lowConfidence.body.punch.gps_confidence).toBe("low_confidence");
    expect(Number(lowConfidence.body.punch.distance_from_expected_meters)).toBeGreaterThan(200);
    expect(Number(lowConfidence.body.punch.expected_geofence_radius_meters)).toBe(200);
    expect(lowConfidence.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("LOW_CONFIDENCE_GPS");

    const outsideShift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "OutsideFence",
      startsAt: addMinutes(new Date(), -30),
      endsAt: addMinutes(new Date(), 90),
      geofenceRadiusMeters: 200
    });

    const outside = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: outsideShift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9823,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        approver_user_id: seniorId,
        reason_code: "outside_geofence",
        notes: "Parking overflow put me across the road."
      });

    expect(outside.status).toBe(201);
    expect(outside.body.punch.gps_confidence).toBe("outside");
    expect(Number(outside.body.punch.distance_from_expected_meters)).toBeGreaterThan(200);
    expect(Number(outside.body.punch.expected_geofence_radius_meters)).toBe(200);
    expect(outside.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("OUTSIDE_GEOFENCE_PUNCH");

    const outsideGeofenceException = outside.body.exceptions.find(
      (item: { exception_type: string; id: string }) => item.exception_type === "OUTSIDE_GEOFENCE_PUNCH"
    );
    expect(outsideGeofenceException?.id).toBeTruthy();

    const outsideAudit = await pool.query(
      `
        SELECT action, metadata->>'exception_type' AS exception_type
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, outsideGeofenceException?.id]
    );
    expect(outsideAudit.rows.some((row) => row.action === "attendance.exception.auto_created" && row.exception_type === "OUTSIDE_GEOFENCE_PUNCH")).toBe(true);
  });

  it("flags punches without location separately from true outside-geofence punches", async () => {
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "LocationUnavailable",
      startsAt: addMinutes(new Date(), -20),
      endsAt: addMinutes(new Date(), 100),
      geofenceRadiusMeters: 200
    });

    const response = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        client_event_id: randomUUID()
      });

    expect(response.status).toBe(201);
    expect(response.body.punch.geofence_status).toBe("unknown");
    expect(response.body.punch.gps_confidence).toBe("outside");
    expect(response.body.punch.distance_from_expected_meters).toBeNull();
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).toContain("LOCATION_NOT_CAPTURED_PUNCH");
    expect(response.body.exceptions.map((item: { exception_type: string }) => item.exception_type)).not.toContain("OUTSIDE_GEOFENCE_PUNCH");
  });

  it("supports manual clock-out and segment transitions", async () => {
    const startsAt = addMinutes(new Date(), -60);
    const midpoint = addMinutes(startsAt, 30);
    const endsAt = addMinutes(new Date(), 60);
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "ClockOutSegment",
      startsAt,
      endsAt,
      segments: [
        {
          label: "Travel",
          kind: "travel",
          startsAt,
          endsAt: midpoint,
          rateCode: "travel"
        },
        {
          label: "Shoot",
          kind: "shoot",
          startsAt: midpoint,
          endsAt,
          rateCode: "shoot"
        }
      ]
    });

    const detail = await request(app).get(`/api/shifts/${shift.id}`).set("Authorization", `Bearer ${photoToken}`);
    const firstSegmentId = detail.body.segments[0].id;
    const secondSegmentId = detail.body.segments[1].id;

    const firstTransition = await request(app)
      .post(`/api/attendance/shifts/${shift.id}/segments/${firstSegmentId}/transition`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ captured_at: startsAt.toISOString() });
    expect(firstTransition.status).toBe(200);

    const secondTransition = await request(app)
      .post(`/api/attendance/shifts/${shift.id}/segments/${secondSegmentId}/transition`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ captured_at: midpoint.toISOString() });
    expect(secondTransition.status).toBe(200);
    expect(secondTransition.body.segments.find((segment: { id: string }) => segment.id === secondSegmentId).actual_start_at).toBeTruthy();

    const inPunch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: startsAt.toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(inPunch.status).toBe(201);

    const outPunch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "out",
        client_timestamp: addMinutes(startsAt, 90).toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(outPunch.status).toBe(201);
    expect(outPunch.body.punch.direction).toBe("out");
    // G2 write-freeze: worked time is asserted from the canonical record.
    expect(outPunch.body.timeEntry).toBeNull();
    expect(Number(outPunch.body.interpreted_time_record?.worked_minutes ?? 0)).toBeGreaterThan(0);
  });

  it("lets a senior photographer classify same-day attendance issues for the shoot they lead", async () => {
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: associateId,
      managerUserId: seniorId,
      department: "schools",
      title: "SeniorReviewScope",
      startsAt: addMinutes(new Date(), -15),
      endsAt: addMinutes(new Date(), 120)
    });

    const exception = (
      await pool.query(
        `
          INSERT INTO attendance_exception (tenant_id, shift_id, shoot_id, user_id, exception_type, severity, status, notes)
          VALUES ($1,$2,$3,$4,'RUNNING_LATE_NOTICE','high','open','Testing senior classification scope.')
          RETURNING id
        `,
        [tenantId, shift.id, shift.shoot_id, associateId]
      )
    ).rows[0];

    const response = await request(app)
      .post(`/api/attendance/exceptions/${exception.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "resolved",
        classification: "manager-approved exception"
      });

    expect(response.status).toBe(200);
    expect(response.body.classification).toBe("manager-approved exception");
  });

  it("keeps overnight shifts visible and coherent across punches, exceptions, and approvals", async () => {
    const overnightEnd = new Date();
    overnightEnd.setHours(0, 45, 0, 0);
    const overnightStart = new Date(overnightEnd);
    overnightStart.setDate(overnightStart.getDate() - 1);
    overnightStart.setHours(23, 15, 0, 0);
    const overnightClockIn = new Date(overnightStart);
    overnightClockIn.setMinutes(overnightClockIn.getMinutes() + 15);
    const overnightClockOut = new Date(overnightClockIn);
    overnightClockOut.setMinutes(overnightClockOut.getMinutes() + 90);

    const adHocShoot = (
      await pool.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
            location_lat, location_lng, navigation_url, geofence_radius_meters,
            arrival_time, start_time, end_time_est, projected_students
          )
          SELECT
            tenant_id,
            studio_id,
            $2,
            'Cross Midnight Coverage',
            shoot_date,
            location_name,
            location_address,
            location_lat,
            location_lng,
            navigation_url,
            geofence_radius_meters,
            arrival_time,
            start_time,
            end_time_est,
            projected_students
          FROM shoot
          WHERE id = $1
          RETURNING id
        `,
        [demoShootId, `OVERNIGHT-${randomUUID().slice(0, 8)}`]
      )
    ).rows[0];

    const shift = await insertShift({
      shootId: adHocShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "CrossMidnightCoverage",
      startsAt: overnightStart,
      endsAt: overnightEnd
    });

    const endDate = overnightEnd.toISOString().slice(0, 10);
    const visibleOnEndDate = await request(app)
      .get(`/api/shifts?date_from=${endDate}&date_to=${endDate}`)
      .set("Authorization", `Bearer ${photoToken}`);
    expect(visibleOnEndDate.status).toBe(200);
    expect(visibleOnEndDate.body.some((row: { id: string }) => row.id === shift.id)).toBe(true);

    const dashboard = await request(app)
      .get(`/api/dashboard/operations?date=${endDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.shifts.some((row: { id: string }) => row.id === shift.id)).toBe(true);

    const inPunch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: overnightClockIn.toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(inPunch.status).toBe(201);

    const outPunch = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shoot_id: adHocShoot.id,
        direction: "out",
        client_timestamp: overnightClockOut.toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(outPunch.status).toBe(201);
    expect(outPunch.body.punch.shift_id).toBe(shift.id);
    // G2 write-freeze: the overnight duration is asserted from the canonical record.
    expect(outPunch.body.timeEntry).toBeNull();
    expect(Number(outPunch.body.interpreted_time_record?.worked_minutes ?? 0)).toBe(90);

    const correction = await request(app)
      .post("/api/attendance/exceptions")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        shift_id: shift.id,
        exception_type: "FORGOT_TO_CLOCK_OUT",
        reason_code: "other",
        notes: "Testing overnight approval flow.",
        requested_approver_user_id: seniorId
      });
    expect(correction.status).toBe(201);

    const reviewed = await request(app)
      .post(`/api/attendance/exceptions/${correction.body.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        status: "approved",
        classification: "manager-approved exception"
      });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("approved");

    const realtimeEvents = await pool.query(
      `
        SELECT payload->>'change_type' AS change_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'attendance.realtime.changed'
          AND (
            aggregate_id = $2
            OR aggregate_id = $3
            OR payload->>'shift_id' = $4
          )
        ORDER BY created_at ASC
      `,
      [tenantId, outPunch.body.punch.id, correction.body.id, shift.id]
    );
    const changeTypes = realtimeEvents.rows.map((row) => row.change_type);
    expect(changeTypes).toContain("punch_created");
    expect(changeTypes).toContain("exception_created");
    expect(changeTypes).toContain("exception_reviewed");
  });

  it("allows same-day senior trade approval only within their attendance scope", async () => {
    const replacement = await cloneTradeReplacementUser();
    const replacementToken = (await devLogin(app, replacement.email)).body.token;
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "TradeApprovalScope",
      startsAt: addMinutes(new Date(), 20),
      endsAt: addMinutes(new Date(), 160)
    });

    const tradeRequest = await request(app)
      .post(`/api/shifts/${shift.id}/trade-requests`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        requested_with_user_id: replacement.id,
        reason: "Need a same-day swap."
      });

    expect(tradeRequest.status).toBe(201);

    const accepted = await request(app)
      .post(`/api/shifts/trade-requests/${tradeRequest.body.id}/respond`)
      .set("Authorization", `Bearer ${replacementToken}`)
      .send({
        status: "accepted",
        notes: "I can cover this same-day swap."
      });

    expect(accepted.status).toBe(200);

    const approved = await request(app)
      .post(`/api/shifts/trade-requests/${tradeRequest.body.id}/review`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({ status: "approved" });

    expect(approved.status).toBe(200);

    const updatedShift = await pool.query("SELECT assigned_user_id FROM work_shift WHERE id = $1", [shift.id]);
    expect(updatedShift.rows[0].assigned_user_id).toBe(replacement.id);
  });

  it("returns live clock status plus labor, punch, and exception reporting rows", async () => {
    const startsAt = addMinutes(new Date(), -30);
    const endsAt = addMinutes(new Date(), 90);
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "ReportingBoard",
      startsAt,
      endsAt
    });

    const punchResponse = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: shift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID()
      });
    expect(punchResponse.status).toBe(201);

    const correction = await request(app)
      .post("/api/attendance/exceptions")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        shift_id: shift.id,
        exception_type: "FORGOT_TO_CLOCK_IN",
        reason_code: "other",
        notes: "Reporting detail request",
        requested_approver_user_id: seniorId,
        original_value: { starts_at: startsAt.toISOString() },
        requested_value: { starts_at: addMinutes(startsAt, -10).toISOString() }
      });
    expect(correction.status).toBe(201);

    const dashboard = await request(app)
      .get(`/api/dashboard/operations?date=${todayString()}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(dashboard.status).toBe(200);

    const dashboardShift = dashboard.body.shifts.find((row: { id: string }) => row.id === shift.id);
    expect(dashboardShift.latest_punch_direction).toBe("in");
    expect(dashboardShift.latest_punch_at).toBeTruthy();

    const laborRow = dashboard.body.reporting.labor.find((row: { assigned_user_id: string }) => row.assigned_user_id === photoId);
    expect(laborRow).toBeTruthy();

    const punchRow = dashboard.body.reporting.punches.find((row: { shift_id: string }) => row.shift_id === shift.id);
    expect(punchRow.direction).toBe("in");
    expect(punchRow.assigned_user_name).toBe("Demo Photographer");

    const exceptionRow = dashboard.body.reporting.exceptions.find((row: { id: string }) => row.id === correction.body.id);
    expect(exceptionRow.requested_approver_name).toBe("Demo Senior Photographer");
    expect(exceptionRow.manager_name).toBe("Demo Senior Photographer");

    const exportResponse = await request(app)
      .get(`/api/dashboard/operations/export.csv?date=${todayString()}&report=punches`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.text).toContain("employee,manager,department,shift_title");
    expect(exportResponse.text).toContain(shift.title);
  });

  it("returns deeper attendance exception detail for approval review states", async () => {
    const shift = await insertShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "ApprovalDetail",
      startsAt: addMinutes(new Date(), -15),
      endsAt: addMinutes(new Date(), 120)
    });

    const requested = await request(app)
      .post("/api/attendance/exceptions")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        shift_id: shift.id,
        exception_type: "WRONG_LOCATION",
        reason_code: "gps_issue",
        notes: "GPS snapped to the road.",
        requested_approver_user_id: seniorId,
        original_value: { geofence_status: "outside" },
        requested_value: { geofence_status: "inside" }
      });
    expect(requested.status).toBe(201);

    const approved = await request(app)
      .post(`/api/attendance/exceptions/${requested.body.id}/review`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "approved",
        classification: "manager-approved exception",
        resolved_value: { geofence_status: "inside" }
      });
    expect(approved.status).toBe(200);

    const approvedList = await request(app)
      .get(`/api/attendance/exceptions?date=${todayString()}&status=approved`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(approvedList.status).toBe(200);

    const row = approvedList.body.find((item: { id: string }) => item.id === requested.body.id);
    expect(row).toBeTruthy();
    expect(row.requested_approver_name).toBe("Demo Senior Photographer");
    expect(row.approved_by_name).toBe("Demo Leadership");
    expect(row.original_value.geofence_status).toBe("outside");
    expect(row.requested_value.geofence_status).toBe("inside");
    expect(row.resolved_value.geofence_status).toBe("inside");
  });
});
