import { beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.js";

vi.mock("../../worker/src/realtime/internalPublisher.js", () => ({
  publishRealtime: vi.fn()
}));

vi.mock("../../worker/src/push/fcmStub.js", () => ({
  sendPush: vi.fn(async () => ({
    ok: false,
    code: "invalid_token",
    response: { message: "registration-token-not-registered" }
  }))
}));

let handleAppEvent: typeof import("../../worker/src/handlers/appEventHandler.js").handleAppEvent;
let tenantId = "";
let userId = "";
let shootId = "";

beforeAll(async () => {
  ({ handleAppEvent } = await import("../../worker/src/handlers/appEventHandler.js"));

  const context = await pool.query(
    `
      SELECT s.tenant_id, s.id AS shoot_id, u.id AS user_id
      FROM shoot s
      JOIN app_user u ON u.tenant_id = s.tenant_id AND u.email = 'photo@example.com'
      WHERE s.shoot_code = 'DEMO-001'
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  shootId = context.rows[0].shoot_id;
  userId = context.rows[0].user_id;
});

describe("push token hygiene", () => {
  it("disables invalid tokens and logs the failed delivery attempt", async () => {
    const client = await pool.connect();
    try {
      const device = await client.query(
        `
          INSERT INTO device (tenant_id, user_id, platform, device_identifier, app_version)
          VALUES ($1, $2, 'ios', 'api-suite-hygiene-device', '1.0.0')
          ON CONFLICT (tenant_id, user_id, device_identifier)
          DO UPDATE SET app_version = EXCLUDED.app_version
          RETURNING id
        `,
        [tenantId, userId]
      );

      await client.query("DELETE FROM push_token WHERE tenant_id = $1 AND token = 'api-suite-invalid-token'", [tenantId]);

      const pushToken = await client.query(
        `
          INSERT INTO push_token (tenant_id, user_id, device_id, token, platform, enabled)
          VALUES ($1, $2, $3, 'api-suite-invalid-token', 'ios', true)
          RETURNING id
        `,
        [tenantId, userId, device.rows[0].id]
      );

      const appEvent = await client.query(
        `
          INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
          VALUES (
            $1,
            'alert.created',
            'alert',
            gen_random_uuid(),
            $2::jsonb,
            $3
          )
          RETURNING *
        `,
        [
          tenantId,
          JSON.stringify({
            shoot_id: shootId,
            shoot_code: "DEMO-001",
            alert_type: "OUTSIDE_GEOFENCE",
            message: "Outside geofence clock-in for shoot DEMO-001"
          }),
          `api-push-hygiene:${Date.now()}`
        ]
      );

      await handleAppEvent(client, appEvent.rows[0]);

      const tokenState = await client.query("SELECT enabled, invalidated_at FROM push_token WHERE id = $1", [pushToken.rows[0].id]);
      expect(tokenState.rows[0].enabled).toBe(false);
      expect(tokenState.rows[0].invalidated_at).toBeTruthy();

      const delivery = await client.query(
        `
          SELECT status
          FROM notification_delivery
          WHERE app_event_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [appEvent.rows[0].id]
      );
      expect(delivery.rows[0].status).toBe("invalid_token");
    } finally {
      client.release();
    }
  });
});
