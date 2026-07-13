import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { elevateSession } from "./helpers.js";

const app = createApp();
let token = "";
let openAlertId = "";
let resolveAlertId = "";

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "admin@example.com" });
  token = login.body.token;
  await elevateSession(app, token);

  const seedContext = await pool.query(
    `
      SELECT s.id AS shoot_id, s.tenant_id, u.id AS user_id
      FROM shoot s
      JOIN app_user u ON u.tenant_id = s.tenant_id AND u.email = 'admin@example.com'
      WHERE s.shoot_code = 'DEMO-001'
      LIMIT 1
    `
  );
  const context = seedContext.rows[0];

  await pool.query("DELETE FROM alert WHERE alert_type IN ('TEST_ALERT_OPEN', 'TEST_ALERT_RESOLVED', 'TEST_ALERT_TO_RESOLVE')");

  const openInsert = await pool.query(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message)
      VALUES ($1, $2, 'TEST_ALERT_OPEN', 'Open alert for filter coverage')
      RETURNING id
    `,
    [context.tenant_id, context.shoot_id]
  );
  openAlertId = openInsert.rows[0].id;

  await pool.query(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message, status, resolved_at, resolved_by)
      VALUES ($1, $2, 'TEST_ALERT_RESOLVED', 'Resolved alert for filter coverage', 'resolved', now(), $3)
    `,
    [context.tenant_id, context.shoot_id, context.user_id]
  );

  const resolveInsert = await pool.query(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message)
      VALUES ($1, $2, 'TEST_ALERT_TO_RESOLVE', 'Resolve me from the API')
      RETURNING id
    `,
    [context.tenant_id, context.shoot_id]
  );
  resolveAlertId = resolveInsert.rows[0].id;
});

describe("alerts API", () => {
  it("returns only open alerts by default", async () => {
    const response = await request(app).get("/api/alerts").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.some((alert: { id: string }) => alert.id === openAlertId)).toBe(true);
    expect(response.body.some((alert: { alert_type: string }) => alert.alert_type === "TEST_ALERT_RESOLVED")).toBe(false);
  });

  it("returns resolved alerts when explicitly requested", async () => {
    const response = await request(app).get("/api/alerts?status=all").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.some((alert: { alert_type: string }) => alert.alert_type === "TEST_ALERT_RESOLVED")).toBe(true);
  });

  it("is bounded: default page cap, explicit limit honored, over-cap rejected (audit §11)", async () => {
    const defaulted = await request(app).get("/api/alerts").set("Authorization", `Bearer ${token}`);
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.length).toBeLessThanOrEqual(200);

    const single = await request(app).get("/api/alerts?limit=1").set("Authorization", `Bearer ${token}`);
    expect(single.status).toBe(200);
    expect(single.body).toHaveLength(1);

    const overCap = await request(app).get("/api/alerts?limit=1000").set("Authorization", `Bearer ${token}`);
    expect(overCap.status).toBe(400);
  });

  it("resolves an alert and removes it from the default open list", async () => {
    const resolveResponse = await request(app)
      .post(`/api/alerts/${resolveAlertId}/resolve`)
      .set("Authorization", `Bearer ${token}`);

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.status).toBe("resolved");

    const openListResponse = await request(app).get("/api/alerts").set("Authorization", `Bearer ${token}`);

    expect(openListResponse.status).toBe(200);
    expect(openListResponse.body.some((alert: { id: string }) => alert.id === resolveAlertId)).toBe(false);
  });
});
