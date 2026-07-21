import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";
let shootId = "";
let clockInAt = "";
let clockOutAt = "";
let tenantId = "";
let photographerId = "";
let adminUserId = "";
const isolatedShootCode = `TIME-${Date.now()}`;

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "photo@example.com" });
  token = login.body.token;
  const [{ rows: studioRows }, { rows: photographerRows }, { rows: adminRows }] = await Promise.all([
    pool.query(
      `
        SELECT st.id, st.tenant_id
        FROM studio st
        JOIN tenant t ON t.id = st.tenant_id
        WHERE t.name = 'Demo Studio' AND st.name = 'Main Studio'
        LIMIT 1
      `
    ),
    pool.query("SELECT id FROM app_user WHERE email = 'photo@example.com' LIMIT 1"),
    pool.query("SELECT id FROM app_user WHERE email = 'admin@example.com' LIMIT 1")
  ]);
  const studio = studioRows[0];
  const photographer = photographerRows[0];
  const admin = adminRows[0];
  tenantId = studio.tenant_id;
  photographerId = photographer.id;
  adminUserId = admin.id;
  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const arrivalAt = `${localDate}T14:00:00.000Z`;
  const startAt = `${localDate}T14:15:00.000Z`;
  const endAt = `${localDate}T15:15:00.000Z`;
  clockInAt = `${localDate}T14:05:00.000Z`;
  clockOutAt = `${localDate}T14:11:00.000Z`;

  const createdShoot = await pool.query(
    `
      INSERT INTO shoot (
        tenant_id, studio_id, department, shoot_code, title, shoot_date, location_name, location_address,
        location_lat, location_lng, geofence_radius_meters, navigation_url, arrival_time, start_time, end_time_est,
        projected_students, planned_staff_count, required_lead_count, created_by, schedule_sync_required, schedule_sync_state
      )
      VALUES (
        $1, $2, 'schools', $3, 'Time Entry Isolated Shoot', $4, 'Time Entry Test Location', '123 Test Ave, Minneapolis, MN',
        44.9778, -93.2649, 200, 'https://maps.example/time-entry-test', $5, $6, $7, 24, 1, 1, $8, false, 'not_linked'
      )
      ON CONFLICT (tenant_id, shoot_code) DO UPDATE
      SET shoot_date = EXCLUDED.shoot_date,
          arrival_time = EXCLUDED.arrival_time,
          start_time = EXCLUDED.start_time,
          end_time_est = EXCLUDED.end_time_est,
          deleted_at = NULL
      RETURNING id
    `,
    [studio.tenant_id, studio.id, isolatedShootCode, localDate, arrivalAt, startAt, endAt, admin.id]
  );
  shootId = createdShoot.rows[0].id;

  await pool.query(
    `
      INSERT INTO shoot_assignment (tenant_id, shoot_id, user_id, is_primary)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (tenant_id, shoot_id, user_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
    `,
    [studio.tenant_id, shootId, photographer.id]
  );

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
        $1,$2,$3,$4,$5,$5,'shoot','published','schools','Time Entry Test Shift',$6,$7,
        'Time Entry Test Location','123 Test Ave, Minneapolis, MN',44.9778,-93.2649,200,now()
      )
    `,
    [tenantId, shootId, photographerId, adminUserId, adminUserId, clockInAt, endAt]
  );
});

describe("clock-out and time entry retrieval", () => {
  it("creates a time entry and exposes it via GET /time-entries", async () => {
    const clockInEventId = crypto.randomUUID();
    const clockOutEventId = crypto.randomUUID();

    const clockIn = await request(app)
      .post(`/api/shoots/${shootId}/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", clockInEventId)
      .send({
        captured_at: clockInAt,
        location_lat: 44.97781,
        location_lng: -93.26492,
        client_event_id: clockInEventId
      });

    expect(clockIn.status).toBe(201);
    expect(clockIn.headers["x-pmc-canonical-source"]).toBe("canonical_labor_state");
    expect(clockIn.headers["x-pmc-compatibility-mode"]).toBe("legacy_shoot_punch_bridge");
    expect(clockIn.headers["x-pmc-deprecated-route"]).toBe("true");

    const clockOut = await request(app)
      .post(`/api/shoots/${shootId}/clock-out`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", clockOutEventId)
      .send({
        captured_at: clockOutAt,
        location_lat: 44.97781,
        location_lng: -93.26492,
        client_event_id: clockOutEventId
      });

    expect(clockOut.status).toBe(201);
    expect(clockOut.headers["x-pmc-canonical-source"]).toBe("canonical_labor_state");
    expect(clockOut.headers["x-pmc-compatibility-mode"]).toBe("legacy_shoot_punch_bridge");
    expect(clockOut.body.timeEntry.clock_out_at).toBeTruthy();
    expect(Number(clockOut.body.timeEntry.minutes_worked)).toBeGreaterThanOrEqual(0);

    // G2: the deprecated legacy time-entries projection is retired (it had zero
    // product consumers) — the route must be gone, not silently serving.
    const entries = await request(app)
      .get(`/api/shoots/${shootId}/time-entries`)
      .set("Authorization", `Bearer ${token}`);
    expect(entries.status).toBe(404);
  });
});
