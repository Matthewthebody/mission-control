import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";
let tenantId = "";
let baseShootId = "";
let shootId = "";

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "photo@example.com" });
  token = login.body.token;
  const shoot = await pool.query(
    `
      SELECT id, tenant_id
      FROM shoot
      WHERE shoot_code = 'DEMO-001'
      LIMIT 1
    `
  );
  baseShootId = shoot.rows[0].id;
  tenantId = shoot.rows[0].tenant_id;
});

beforeEach(async () => {
  const shootCode = `GEOFENCE-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const start = new Date(now.getTime() - 15 * 60 * 1000);
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const inserted = await pool.query<{ id: string }>(
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
        created_by,
        organization_id,
        location_id,
        primary_contact_id,
        shoot_type
      )
      SELECT
        tenant_id,
        studio_id,
        $2,
        $3,
        $4::date,
        'Geofence Test Venue',
        '101 Demo Park Avenue, Minneapolis, MN 55415',
        44.9778,
        -93.2649,
        1609,
        $5,
        $5,
        $6,
        $7,
        projected_students,
        created_by,
        organization_id,
        location_id,
        primary_contact_id,
        shoot_type
      FROM shoot
      WHERE id = $1
      RETURNING id
    `,
    [baseShootId, shootCode, `Geofence ${shootCode}`, localDate, now.toISOString(), start.toISOString(), end.toISOString()]
  );
  shootId = inserted.rows[0].id;
});

afterEach(async () => {
  if (!shootId) {
    return;
  }

  await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND shoot_id = $2", [tenantId, shootId]);
  await pool.query("DELETE FROM shift_punch WHERE tenant_id = $1 AND shoot_id = $2", [tenantId, shootId]);
  await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND shoot_id = $2", [tenantId, shootId]);
  await pool.query(
    "DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'shoot_id' = $2",
    [tenantId, shootId]
  );
  await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND id = $2", [tenantId, shootId]);
  shootId = "";
});

describe("geofence status", () => {
  it("marks a nearby clock-in as inside", async () => {
    const response = await request(app)
      .post(`/api/shoots/${shootId}/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "22222222-2222-4222-8222-222222222222")
      .send({
        captured_at: new Date().toISOString(),
        location_lat: 44.97781,
        location_lng: -93.26492,
        client_event_id: "22222222-2222-4222-8222-222222222222"
      });
    expect(response.status).toBe(201);
    expect(response.body.event.geofence_status).toBe("inside");
  });

  it("marks a distant clock-in as outside", async () => {
    const response = await request(app)
      .post(`/api/shoots/${shootId}/clock-in`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "33333333-3333-4333-8333-333333333333")
      .send({
        captured_at: new Date().toISOString(),
        location_lat: 45.1,
        location_lng: -93.5,
        client_event_id: "33333333-3333-4333-8333-333333333333"
      });
    expect(response.status).toBe(201);
    expect(response.body.event.geofence_status).toBe("outside");
  });
});
