import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";

let evaluateAlerts: typeof import("../../worker/src/jobs/alertEvaluator.js").evaluateAlerts;
let tenantId = "";
let studioId = "";
let adminUserId = "";

beforeAll(async () => {
  ({ evaluateAlerts } = await import("../../worker/src/jobs/alertEvaluator.js"));

  const context = await pool.query(
    `
      SELECT t.id AS tenant_id, st.id AS studio_id, u.id AS user_id
      FROM tenant t
      JOIN studio st ON st.tenant_id = t.id
      JOIN app_user u ON u.tenant_id = t.id
      WHERE t.name = 'Demo Studio'
        AND st.name = 'Main Studio'
        AND u.email = 'admin@example.com'
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  studioId = context.rows[0].studio_id;
  adminUserId = context.rows[0].user_id;
});

describe("worker alert evaluator", () => {
  it("creates late clock-in and missing setup photo alerts and emits alert outbox rows", async () => {
    const shootCode = `ALERT-${Date.now()}`;
    const arrivalTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const startTime = new Date(Date.now() - 170 * 60 * 1000);
    const endTime = new Date(Date.now() - 130 * 60 * 1000);

    const shootInsert = await pool.query(
      `
        INSERT INTO shoot (
          tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_lat, location_lng,
          geofence_radius_meters, arrival_time, start_time, end_time_est, created_by
        )
        VALUES (
          $1, $2, $3, 'Alert Evaluator Coverage', CURRENT_DATE, 'South Lot', 44.9778, -93.2649,
          200, $4, $5, $6, $7
        )
        RETURNING id
      `,
      [tenantId, studioId, shootCode, arrivalTime.toISOString(), startTime.toISOString(), endTime.toISOString(), adminUserId]
    );

    const shootId = shootInsert.rows[0].id;

    await pool.query(
      `
        INSERT INTO status_event (
          tenant_id, shoot_id, user_id, type, captured_at, geofence_status, metadata
        )
        VALUES
          ($1, $2, $3, 'SETUP_COMPLETE', $4, 'inside', '{}'::jsonb),
          ($1, $2, $3, 'SHOOTING_STARTED', $5, 'inside', '{}'::jsonb)
      `,
      [tenantId, shootId, adminUserId, new Date(Date.now() - 165 * 60 * 1000).toISOString(), new Date(Date.now() - 160 * 60 * 1000).toISOString()]
    );

    await evaluateAlerts();

    const alerts = await pool.query(
      `
        SELECT alert_type, status
        FROM alert
        WHERE shoot_id = $1
          AND alert_type IN ('LATE_CLOCK_IN', 'MISSING_SETUP_PHOTO')
        ORDER BY alert_type
      `,
      [shootId]
    );

    expect(alerts.rows).toEqual([
      { alert_type: "LATE_CLOCK_IN", status: "open" },
      { alert_type: "MISSING_SETUP_PHOTO", status: "open" }
    ]);

    const appEvents = await pool.query(
      `
        SELECT payload->>'alert_type' AS alert_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'alert.created'
          AND payload->>'shoot_id' = $2
        ORDER BY payload->>'alert_type'
      `,
      [tenantId, shootId]
    );

    expect(appEvents.rows).toEqual([
      { alert_type: "LATE_CLOCK_IN" },
      { alert_type: "MISSING_SETUP_PHOTO" }
    ]);
  }, 15000);

  it("treats a local setup photo upload as satisfying the missing-photo alert rule", async () => {
    const shootCode = `ALERT-PHOTO-${Date.now()}`;
    const arrivalTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const startTime = new Date(Date.now() - 170 * 60 * 1000);
    const endTime = new Date(Date.now() - 130 * 60 * 1000);

    const shootInsert = await pool.query(
      `
        INSERT INTO shoot (
          tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_lat, location_lng,
          geofence_radius_meters, arrival_time, start_time, end_time_est, created_by
        )
        VALUES (
          $1, $2, $3, 'Alert Evaluator Local Photo Coverage', CURRENT_DATE, 'West Gym', 44.9778, -93.2649,
          200, $4, $5, $6, $7
        )
        RETURNING id
      `,
      [tenantId, studioId, shootCode, arrivalTime.toISOString(), startTime.toISOString(), endTime.toISOString(), adminUserId]
    );

    const shootId = shootInsert.rows[0].id as string;

    const locationInsert = await pool.query(
      `
        INSERT INTO shoot_location (
          tenant_id,
          external_source,
          external_key,
          name,
          normalized_name,
          address,
          normalized_address,
          photo_urls,
          last_catalog_sync_at
        )
        VALUES (
          $1,
          'test',
          $2,
          'West Gym',
          'west gym',
          '1 Alert Way',
          '1 alert way',
          '[]'::jsonb,
          now()
        )
        RETURNING id
      `,
      [tenantId, `worker-alert:${shootCode}`]
    );

    await pool.query(
      `
        INSERT INTO setup_photo_upload (
          tenant_id,
          location_id,
          shoot_id,
          uploader_user_id,
          uploader_name,
          file_name,
          content_type,
          image_url,
          source,
          uploaded_at,
          raw_payload
        )
        VALUES ($1,$2,$3,$4,'Demo Admin','setup.jpg','image/jpeg','https://example.com/setup.jpg','mission_control',now(),'{}'::jsonb)
      `,
      [tenantId, locationInsert.rows[0].id, shootId, adminUserId]
    );

    await evaluateAlerts();

    const alerts = await pool.query(
      `
        SELECT alert_type
        FROM alert
        WHERE shoot_id = $1
          AND alert_type = 'MISSING_SETUP_PHOTO'
      `,
      [shootId]
    );

    expect(alerts.rows).toEqual([]);
  }, 15000);
});
