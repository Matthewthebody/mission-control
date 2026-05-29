import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let leadershipId = "";
let leadershipToken = "";
let photographerId = "";
let photographerToken = "";
let shootId = "";
let shootLocationId = "";

type GearReportingSeed = {
  overdueAssetId: string;
  repairAssetId: string;
  missingAssetId: string;
  overdueAlertId: string;
  missingAlertId: string;
};

const currentSeed: GearReportingSeed = {
  overdueAssetId: "",
  repairAssetId: "",
  missingAssetId: "",
  overdueAlertId: "",
  missingAlertId: ""
};

function currentMonthActivityTimestamp(offsetHours: number) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const candidate = new Date(monthStart.getTime() + offsetHours * 60 * 60 * 1000);
  const now = new Date();
  return candidate.getTime() < now.getTime() ? candidate : new Date(Math.max(monthStart.getTime(), now.getTime() - 60_000));
}

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

  const shootResult = await pool.query<{ id: string; location_id: string | null }>(
    `
      SELECT id, location_id
      FROM shoot
      WHERE tenant_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );
  shootId = shootResult.rows[0]?.id ?? "";
  shootLocationId = shootResult.rows[0]?.location_id ?? "";

  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;

  expect(tenantId).toBeTruthy();
  expect(leadershipId).toBeTruthy();
  expect(photographerId).toBeTruthy();
  expect(shootId).toBeTruthy();
});

afterAll(async () => {
  await cleanupGearPhase6Seed();
});

beforeEach(async () => {
  await cleanupGearPhase6Seed();
  await seedGearPhase6Records();
});

describe("gear alerting and reporting phase 6", () => {
  it("returns the monthly report with overdue, missing, custody, scan, and Tile attention views", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const response = await request(app)
      .get(`/api/gear/reports/monthly?month=${month}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary.missing_items).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.overdue_returns).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.unresolved_repairs).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.missing_over_30_days).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.current_custody).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.recent_custody_activity).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.recent_scan_activity).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.tile_attention_items).toBeGreaterThanOrEqual(1);
    expect(response.body.overdue_returns.map((item: { label: string }) => item.label)).toContain("Phase 6 Audio Mixer");
    expect(response.body.missing_items.map((item: { label: string }) => item.label)).toContain("Phase 6 70-200 Lens");
    expect(response.body.missing_over_30_days.map((item: { label: string }) => item.label)).toContain("Phase 6 70-200 Lens");
    expect(response.body.current_custody.map((item: { label: string }) => item.label)).toContain("Phase 6 Audio Mixer");
    expect(response.body.recent_scan_activity.map((item: { label: string }) => item.label)).toContain("Phase 6 Audio Mixer");
    expect(response.body.tile_attention.map((item: { label: string }) => item.label)).toContain("Phase 6 70-200 Lens");
  });

  it("allows leadership to manually resolve a gear alert and blocks standard employees", async () => {
    const forbiddenResponse = await request(app)
      .post(`/api/gear/alerts/${currentSeed.missingAlertId}/resolve`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({ resolution_note: "Trying without access." });

    expect(forbiddenResponse.status).toBe(403);

    const response = await request(app)
      .post(`/api/gear/alerts/${currentSeed.overdueAlertId}/resolve`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ resolution_note: "Leadership confirmed the return offline." });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(currentSeed.overdueAlertId);
    expect(response.body.status).toBe("resolved");
    expect(response.body.resolution_type).toBe("manual_resolution");
    expect(response.body.resolution_note).toBe("Leadership confirmed the return offline.");

    const alertResult = await pool.query<{ status: string; resolution_type: string | null; resolved_by: string | null }>(
      `
        SELECT status, resolution_type, resolved_by
        FROM gear_alert
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, currentSeed.overdueAlertId]
    );

    expect(alertResult.rows[0]?.status).toBe("resolved");
    expect(alertResult.rows[0]?.resolution_type).toBe("manual_resolution");
    expect(alertResult.rows[0]?.resolved_by).toBe(leadershipId);

    const auditResult = await pool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'gear_alert'
          AND entity_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, currentSeed.overdueAlertId]
    );

    expect(auditResult.rows[0]?.action).toBe("gear.alert.manually_resolved");
  });
});

async function seedGearPhase6Records() {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const custodyActivityAt = currentMonthActivityTimestamp(2);
  const scanActivityAt = currentMonthActivityTimestamp(3);

  currentSeed.overdueAssetId = await insertAsset({
    internalAssetId: `GEAR-P6-REPORT-OVERDUE-${suffix}`,
    assetName: "Phase 6 Audio Mixer",
    category: "audio",
    tileTrackerId: `TILE-P6-OVERDUE-${suffix}`,
    tileTrackerActive: true,
    status: "checked_out",
    currentCustodianId: photographerId,
    lastSeenWithUserId: leadershipId,
    notes: "Still out from the prior event and now overdue."
  });

  currentSeed.repairAssetId = await insertAsset({
    internalAssetId: `GEAR-P6-REPORT-REPAIR-${suffix}`,
    assetName: "Phase 6 Lighting Stand",
    category: "lighting",
    tileTrackerId: `TILE-P6-REPAIR-${suffix}`,
    tileTrackerActive: true,
    status: "needs_repair",
    currentCustodianId: null,
    lastSeenWithUserId: photographerId,
    notes: "Clamp is bent and needs service review."
  });

  currentSeed.missingAssetId = await insertAsset({
    internalAssetId: `GEAR-P6-REPORT-MISSING-${suffix}`,
    assetName: "Phase 6 70-200 Lens",
    category: "lens",
    tileTrackerId: null,
    tileTrackerActive: null,
    status: "missing",
    currentCustodianId: photographerId,
    lastSeenWithUserId: photographerId,
    notes: "Missing after recent field use and needs immediate follow-up."
  });

  const overdueCheckoutResult = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_checkout_record (
        tenant_id,
        asset_id,
        checked_out_to_user_id,
        linked_shoot_id,
        linked_location_id,
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
        $5,
        'checked_out',
        now() - interval '3 days',
        now() - interval '3 days',
        now() - interval '2 days',
        'Still out from the prior event and now overdue.',
        $6
      )
      RETURNING id
    `,
    [tenantId, currentSeed.overdueAssetId, photographerId, shootId, shootLocationId, leadershipId]
  );

  const overdueCheckoutId = overdueCheckoutResult.rows[0]?.id ?? "";

  const overdueAlertResult = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_alert (
        tenant_id,
        alert_type,
        status,
        asset_id,
        checkout_id,
        linked_shoot_id,
        linked_location_id,
        first_triggered_at,
        last_triggered_at,
        due_at,
        created_by
      )
      VALUES (
        $1,
        'overdue_return',
        'open',
        $2,
        $3,
        $4,
        $5,
        now() - interval '2 days',
        now() - interval '1 hour',
        now() - interval '2 days',
        $6
      )
      RETURNING id
    `,
    [tenantId, currentSeed.overdueAssetId, overdueCheckoutId, shootId, shootLocationId, leadershipId]
  );
  currentSeed.overdueAlertId = overdueAlertResult.rows[0]?.id ?? "";

  const missingAlertResult = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_alert (
        tenant_id,
        alert_type,
        status,
        asset_id,
        linked_shoot_id,
        linked_location_id,
        first_triggered_at,
        last_triggered_at,
        created_by
      )
      VALUES (
        $1,
        'missing_gear',
        'open',
        $2,
        $3,
        $4,
        now() - interval '35 days',
        now() - interval '3 hours',
        $5
      )
      RETURNING id
    `,
    [tenantId, currentSeed.missingAssetId, shootId, shootLocationId, leadershipId]
  );
  currentSeed.missingAlertId = missingAlertResult.rows[0]?.id ?? "";

  await pool.query(
    `
      INSERT INTO gear_service_repair_record (
        tenant_id,
        asset_id,
        issue_type,
        status,
        reported_by,
        linked_shoot_id,
        linked_location_id,
        opened_at,
        note
      )
      VALUES ($1, $2, 'damage', 'open', $3, $4, $5, now() - interval '1 day', 'Leg lock is cracked and needs replacement.')
    `,
    [tenantId, currentSeed.repairAssetId, leadershipId, shootId, shootLocationId]
  );

  await pool.query(
    `
      INSERT INTO gear_custody_event (
        tenant_id,
        asset_id,
        event_type,
        from_user_id,
        to_user_id,
        linked_shoot_id,
        linked_location_id,
        timestamp,
        note,
        created_by
      )
      VALUES (
        $1,
        $2,
        'checked_out',
        NULL,
        $3,
        $4,
        $5,
        $6,
        'Checked out for field coverage.',
        $7
      )
    `,
    [tenantId, currentSeed.overdueAssetId, photographerId, shootId, shootLocationId, custodyActivityAt.toISOString(), leadershipId]
  );

  await pool.query(
    `
      INSERT INTO gear_scan_event (
        tenant_id,
        asset_id,
        linked_shoot_id,
        linked_location_id,
        qr_code_id,
        scan_action,
        scanned_by_user_id,
        mismatch_detected,
        override_applied,
        note,
        scanned_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'open_asset_detail',
        $6,
        false,
        false,
        'Reviewing last scan before follow-up.',
        $7
      )
    `,
    [tenantId, currentSeed.overdueAssetId, shootId, shootLocationId, `QR-P6-OVERDUE-${suffix}`, leadershipId, scanActivityAt.toISOString()]
  );
}

async function insertAsset(input: {
  internalAssetId: string;
  assetName: string;
  category: string;
  tileTrackerId: string | null;
  tileTrackerActive: boolean | null;
  status: "checked_out" | "needs_repair" | "missing";
  currentCustodianId: string | null;
  lastSeenWithUserId: string | null;
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
        $4,
        'Canon',
        'Phase 6 Model',
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        true
      )
      RETURNING id
    `,
    [
      tenantId,
      input.internalAssetId,
      input.assetName,
      input.category,
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

async function cleanupGearPhase6Seed() {
  if (!tenantId) {
    return;
  }

  const assetIds = (
    await pool.query<{ id: string }>(
      `
        SELECT id
        FROM gear_asset
        WHERE tenant_id = $1
          AND internal_asset_id LIKE 'GEAR-P6-REPORT-%'
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);

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
    await pool.query("DELETE FROM gear_scan_event WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])", [tenantId, assetIds]);
    await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])", [tenantId, assetIds]);
    await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])", [tenantId, assetIds]);
    await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])", [tenantId, assetIds]);
    await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, assetIds]);
  }
}
