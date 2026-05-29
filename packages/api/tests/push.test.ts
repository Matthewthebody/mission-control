import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";
let adminToken = "";
let tenantId = "";
let photoUserId = "";
let adminUserId = "";
const pushTokenValue = "push-token-phase-one-test";

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "photo@example.com" });
  token = login.body.token;
  const adminLogin = await request(app).post("/auth/dev-login").send({ email: "admin@example.com" });
  adminToken = adminLogin.body.token;

  const context = await pool.query(
    `
      SELECT tenant_id, id AS user_id
      FROM app_user
      WHERE email = 'photo@example.com'
      LIMIT 1
    `
  );
  tenantId = context.rows[0].tenant_id;
  photoUserId = context.rows[0].user_id;

  const adminContext = await pool.query(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1
        AND email = 'admin@example.com'
      LIMIT 1
    `,
    [tenantId]
  );
  adminUserId = adminContext.rows[0].id;

  await pool.query("DELETE FROM push_token WHERE tenant_id = $1 AND token = $2", [tenantId, pushTokenValue]);
});

describe("push registration lifecycle", () => {
  it("registers a device and push token", async () => {
    const response = await request(app)
      .post("/api/push/register")
      .set("Authorization", `Bearer ${token}`)
      .send({
        platform: "ios",
        device_identifier: "device-phase-one-test",
        app_version: "1.0.0",
        token: pushTokenValue
      });

    expect(response.status).toBe(201);
    expect(response.body.device.platform).toBe("ios");
    expect(response.body.pushToken.token).toBe(pushTokenValue);
    expect(response.body.pushToken.enabled).toBe(true);
  });

  it("unregisters a push token by disabling it", async () => {
    const response = await request(app)
      .post("/api/push/unregister")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: pushTokenValue });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe(pushTokenValue);
    expect(response.body.enabled).toBe(false);
    expect(response.body.invalidated_at).toBeTruthy();
  });

  it("reassigns a shared token to the newest registering user and prevents other users from unregistering it", async () => {
    const sharedToken = `push-token-shared-${Date.now()}`;
    await pool.query("DELETE FROM push_token WHERE tenant_id = $1 AND token = $2", [tenantId, sharedToken]);

    const photoRegister = await request(app)
      .post("/api/push/register")
      .set("Authorization", `Bearer ${token}`)
      .send({
        platform: "ios",
        device_identifier: "device-phase-two-photo",
        app_version: "1.0.1",
        token: sharedToken
      });
    expect(photoRegister.status).toBe(201);

    const adminRegister = await request(app)
      .post("/api/push/register")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        platform: "ios",
        device_identifier: "device-phase-two-admin",
        app_version: "1.0.1",
        token: sharedToken
      });
    expect(adminRegister.status).toBe(201);

    const stored = await pool.query("SELECT user_id, enabled FROM push_token WHERE tenant_id = $1 AND token = $2", [tenantId, sharedToken]);
    expect(stored.rows[0].user_id).toBe(adminUserId);
    expect(stored.rows[0].enabled).toBe(true);

    const photoUnregister = await request(app)
      .post("/api/push/unregister")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: sharedToken });
    expect(photoUnregister.status).toBe(404);

    const adminUnregister = await request(app)
      .post("/api/push/unregister")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ token: sharedToken });
    expect(adminUnregister.status).toBe(200);
    expect(adminUnregister.body.token).toBe(sharedToken);

    const disabled = await pool.query("SELECT user_id, enabled FROM push_token WHERE tenant_id = $1 AND token = $2", [tenantId, sharedToken]);
    expect(disabled.rows[0].user_id).toBe(adminUserId);
    expect(disabled.rows[0].enabled).toBe(false);
    expect(disabled.rows[0].user_id).not.toBe(photoUserId);
  });
});
