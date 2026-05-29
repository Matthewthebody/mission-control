import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";
let shootId = "";

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "admin@example.com" });
  token = login.body.token;
  const shoot = await pool.query("SELECT id FROM shoot WHERE shoot_code = 'DEMO-001' LIMIT 1");
  shootId = shoot.rows[0].id;
});

describe("status event idempotency", () => {
  it("returns the same event for duplicate client_event_id", async () => {
    const clientEventId = "11111111-1111-4111-8111-111111111111";
    const payload = {
      type: "ARRIVED",
      captured_at: new Date().toISOString(),
      location_lat: 44.9778,
      location_lng: -93.2649,
      client_event_id: clientEventId
    };
    const first = await request(app)
      .post(`/api/shoots/${shootId}/status-events`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", clientEventId)
      .send(payload);
    const second = await request(app)
      .post(`/api/shoots/${shootId}/status-events`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", clientEventId)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).toBe(second.body.id);

    const count = await pool.query("SELECT count(*)::int AS count FROM status_event WHERE client_event_id = $1", [clientEventId]);
    expect(count.rows[0].count).toBe(1);
  });
});
