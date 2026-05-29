import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { monitorGear } from "../src/jobs/gearMonitor.js";

let tenantId = "";
let leadershipId = "";
let photographerId = "";
let studioId = "";

type GearWorkerSeed = {
  overdueAssetId: string;
  missingAssetId: string;
  shootId: string;
};

const currentSeed: GearWorkerSeed = {
  overdueAssetId: "",
  missingAssetId: "",
  shootId: ""
};

beforeAll(async () => {
  const tenantResult = await pool.query<{ id: string }>("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenantResult.rows[0]?.id ?? "";

  const people = await pool.query<{ email: string; id: string }>(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'photo@example.com')
    `,
    [tenantId]
  );

  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id ?? "";
  photographerId = people.rows.find((row) => row.email === "photo@example.com")?.id ?? "";

  const studioResult = await pool.query<{ id: string }>("SELECT id FROM studio WHERE tenant_id = $1 LIMIT 1", [tenantId]);
  studioId = studioResult.rows[0]?.id ?? "";

  expect(tenantId).toBeTruthy();
  expect(leadershipId).toBeTruthy();
  expect(photographerId).toBeTruthy();
  expect(studioId).toBeTruthy();
});

afterAll(async () => {
  await cleanupGearMonitorSeed();
});

beforeEach(async () => {
  await cleanupGearMonitorSeed();
  await seedGearMonitorRecords();
});

describe("gear monitor worker", () => {
  it("creates deduped Overdue Return and Missing Gear Alert records, then auto-resolves them when conditions clear", async () => {
    await monitorGear();

    const createdAlerts = await pool.query<{ alert_type: string; status: string }>(
      `
        SELECT alert_type, status
        FROM gear_alert
        WHERE tenant_id = $1
          AND (
            asset_id = $2
            OR asset_id = $3
          )
        ORDER BY alert_type ASC
      `,
      [tenantId, currentSeed.overdueAssetId, currentSeed.missingAssetId]
    );

    expect(createdAlerts.rows).toHaveLength(2);
    expect(createdAlerts.rows.map((row) => row.alert_type)).toEqual(expect.arrayContaining(["missing_gear", "overdue_return"]));
    expect(createdAlerts.rows.every((row) => row.status === "open")).toBe(true);

    const notificationCountsAfterFirstRun = await pool.query<{ notification_type: string; count: string }>(
      `
        SELECT payload->>'notification_type' AS notification_type, count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND aggregate_type = 'gear_alert'
          AND payload->>'notification_type' IN ('gear.overdue_return', 'gear.missing_gear')
        GROUP BY payload->>'notification_type'
      `,
      [tenantId]
    );

    expect(notificationCountsAfterFirstRun.rows.some((row) => row.notification_type === "gear.overdue_return")).toBe(true);
    expect(notificationCountsAfterFirstRun.rows.some((row) => row.notification_type === "gear.missing_gear")).toBe(true);

    await monitorGear();

    const alertsAfterSecondRun = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM gear_alert
        WHERE tenant_id = $1
          AND status = 'open'
          AND (
            asset_id = $2
            OR asset_id = $3
          )
      `,
      [tenantId, currentSeed.overdueAssetId, currentSeed.missingAssetId]
    );

    expect(Number(alertsAfterSecondRun.rows[0]?.count ?? "0")).toBe(2);

    const notificationCountsAfterSecondRun = await pool.query<{ notification_type: string; count: string }>(
      `
        SELECT payload->>'notification_type' AS notification_type, count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND aggregate_type = 'gear_alert'
          AND payload->>'notification_type' IN ('gear.overdue_return', 'gear.missing_gear')
        GROUP BY payload->>'notification_type'
      `,
      [tenantId]
    );

    expect(notificationCountsAfterSecondRun.rows).toEqual(notificationCountsAfterFirstRun.rows);

    await pool.query(
      `
        UPDATE gear_checkout_record
        SET
          status = 'returned',
          returned_at = now(),
          return_condition_status = 'working_order_confirmed',
          return_note = 'Returned after follow-up.',
          updated_at = now()
        WHERE tenant_id = $1
          AND asset_id = $2
          AND status = 'checked_out'
      `,
      [tenantId, currentSeed.overdueAssetId]
    );

    await pool.query(
      `
        UPDATE gear_asset
        SET
          status = 'available',
          current_custodian_id = NULL,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, currentSeed.missingAssetId]
    );

    await monitorGear();

    const resolvedAlerts = await pool.query<{ alert_type: string; status: string; resolution_type: string | null }>(
      `
        SELECT alert_type, status, resolution_type
        FROM gear_alert
        WHERE tenant_id = $1
          AND (
            asset_id = $2
            OR asset_id = $3
          )
        ORDER BY alert_type ASC
      `,
      [tenantId, currentSeed.overdueAssetId, currentSeed.missingAssetId]
    );

    expect(resolvedAlerts.rows).toEqual(
      expect.arrayContaining([
        { alert_type: "missing_gear", status: "resolved", resolution_type: "status_cleared" },
        { alert_type: "overdue_return", status: "resolved", resolution_type: "returned" }
      ])
    );
  }, 20000);
});

async function seedGearMonitorRecords() {
  const suffix = randomUUID().slice(0, 8).toUpperCase();

  const shootResult = await pool.query<{ id: string }>(
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
        arrival_time,
        showtime,
        start_time,
        end_time_est,
        projected_students,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3,
        'Gear Phase 6 Worker Shoot',
        CURRENT_DATE - 3,
        'Worker Test Venue',
        '123 Worker Street',
        44.9778,
        -93.2649,
        200,
        now() - interval '3 days 4 hours',
        now() - interval '3 days 4 hours',
        now() - interval '3 days 4 hours',
        now() - interval '3 days 3 hours',
        18,
        $4
      )
      RETURNING id
    `,
    [tenantId, studioId, `GEAR-P6-WORKER-${suffix}`, leadershipId]
  );
  currentSeed.shootId = shootResult.rows[0]?.id ?? "";

  currentSeed.overdueAssetId = await insertAsset({
    internalAssetId: `GEAR-P6-WORKER-OVERDUE-${suffix}`,
    assetName: "Phase 6 Worker Audio Mixer",
    status: "checked_out",
    currentCustodianId: photographerId,
    lastSeenWithUserId: leadershipId,
    tileTrackerId: `TILE-WORKER-${suffix}`,
    tileTrackerActive: true,
    notes: "Worker overdue coverage asset."
  });

  currentSeed.missingAssetId = await insertAsset({
    internalAssetId: `GEAR-P6-WORKER-MISSING-${suffix}`,
    assetName: "Phase 6 Worker 70-200 Lens",
    status: "missing",
    currentCustodianId: photographerId,
    lastSeenWithUserId: photographerId,
    tileTrackerId: null,
    tileTrackerActive: null,
    notes: "Worker missing coverage asset."
  });

  await pool.query(
    `
      INSERT INTO gear_checkout_record (
        tenant_id,
        asset_id,
        checked_out_to_user_id,
        linked_shoot_id,
        status,
        reserved_at,
        checked_out_at,
        expected_return_at,
        checkout_note,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'checked_out',
        now() - interval '3 days 4 hours',
        now() - interval '3 days 4 hours',
        now() - interval '3 days',
        'Still out from the prior event and now overdue.',
        $5
      )
    `,
    [tenantId, currentSeed.overdueAssetId, photographerId, currentSeed.shootId, leadershipId]
  );
}

async function insertAsset(input: {
  internalAssetId: string;
  assetName: string;
  status: "checked_out" | "missing";
  currentCustodianId: string | null;
  lastSeenWithUserId: string | null;
  tileTrackerId: string | null;
  tileTrackerActive: boolean | null;
  notes: string;
}) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_asset (
        tenant_id,
        internal_asset_id,
        asset_name,
        category,
        manufacturer,
        model,
        serial_number,
        qr_code_id,
        tile_tracker_id,
        tile_tracker_active,
        status,
        current_custodian_id,
        last_seen_with_user_id,
        notes,
        active_status
      )
      VALUES (
        $1,
        $2,
        $3,
        'camera',
        'Canon',
        'Worker Test Model',
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        true
      )
      RETURNING id
    `,
    [
      tenantId,
      input.internalAssetId,
      input.assetName,
      `${input.internalAssetId}-SERIAL`,
      `${input.internalAssetId}-QR`,
      input.tileTrackerId,
      input.tileTrackerActive,
      input.status,
      input.currentCustodianId,
      input.lastSeenWithUserId,
      input.notes
    ]
  );
  return result.rows[0]?.id ?? "";
}

async function cleanupGearMonitorSeed() {
  if (!tenantId) {
    return;
  }

  const assetIds = (
    await pool.query<{ id: string }>(
      `
        SELECT id
        FROM gear_asset
        WHERE tenant_id = $1
          AND internal_asset_id LIKE 'GEAR-P6-WORKER-%'
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);

  const shootIds = (
    await pool.query<{ id: string }>(
      `
        SELECT id
        FROM shoot
        WHERE tenant_id = $1
          AND shoot_code LIKE 'GEAR-P6-WORKER-%'
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);

  await pool.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND (
          aggregate_type = 'gear_alert'
          OR payload->>'notification_type' IN ('gear.overdue_return', 'gear.missing_gear')
        )
    `,
    [tenantId]
  );

  if (assetIds.length) {
    await pool.query(
      `
        DELETE FROM gear_alert
        WHERE tenant_id = $1
          AND (
            asset_id = ANY($2::uuid[])
            OR checkout_id IN (
              SELECT id
              FROM gear_checkout_record
              WHERE tenant_id = $1
                AND asset_id = ANY($2::uuid[])
            )
          )
      `,
      [tenantId, assetIds]
    );
    await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])", [tenantId, assetIds]);
    await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])", [tenantId, assetIds]);
    await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, assetIds]);
  }

  if (shootIds.length) {
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [shootIds]);
  }
}
