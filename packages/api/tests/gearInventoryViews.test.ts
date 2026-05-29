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
let assistantManagerId = "";
let assistantManagerEmail = "";
let assistantManagerToken = "";
let shootId = "";
let shootLocationId = "";

type GearInventorySeed = {
  homeLocationId: string;
  kitId: string;
  assignedAssetId: string;
  checkedOutAssetId: string;
  overdueAssetId: string;
  repairAssetId: string;
  missingAssetId: string;
};

const currentSeed: GearInventorySeed = {
  homeLocationId: "",
  kitId: "",
  assignedAssetId: "",
  checkedOutAssetId: "",
  overdueAssetId: "",
  repairAssetId: "",
  missingAssetId: ""
};

beforeAll(async () => {
  const tenantResult = await pool.query<{ id: string }>("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenantResult.rows[0]?.id ?? "";

  const leadershipResult = await pool.query<{ id: string }>(
    "SELECT id FROM app_user WHERE lower(email) = lower('leadership@example.com') LIMIT 1"
  );
  leadershipId = leadershipResult.rows[0]?.id ?? "";

  const photographerResult = await pool.query<{ id: string }>(
    "SELECT id FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1"
  );
  photographerId = photographerResult.rows[0]?.id ?? "";

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

  assistantManagerEmail = `gear-phase2-assistant-${randomUUID().slice(0, 8)}@example.com`;
  const insertedAssistant = await pool.query<{ id: string }>(
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
      VALUES ($1, $2, 'Gear Phase 2 Assistant Manager', true, 'operations', 'active', now())
      RETURNING id
    `,
    [tenantId, assistantManagerEmail]
  );
  assistantManagerId = insertedAssistant.rows[0]?.id ?? "";

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
      VALUES ($1, $2, 'supervisor', 'leadership_viewer', 'operations', '{}'::jsonb, $3)
    `,
    [tenantId, assistantManagerId, leadershipId]
  );

  await pool.query(
    `
      INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
      VALUES ($1, $2, 'leadership_viewer')
    `,
    [tenantId, assistantManagerId]
  );

  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  assistantManagerToken = (await devLogin(app, assistantManagerEmail)).body.token;

  expect(tenantId).toBeTruthy();
  expect(leadershipId).toBeTruthy();
  expect(photographerId).toBeTruthy();
  expect(shootId).toBeTruthy();
  expect(assistantManagerToken).toBeTruthy();
});

afterAll(async () => {
  await cleanupGearInventorySeed();

  if (!assistantManagerId) {
    return;
  }

  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, assistantManagerId]);
});

beforeEach(async () => {
  await cleanupGearInventorySeed();
  await seedGearInventoryRecords();
});

describe("gear inventory views", () => {
  it("returns the dashboard, Asset inventory, and Kit detail projections for leadership and assistant managers", async () => {
    const dashboardResponse = await request(app)
      .get("/api/gear/dashboard")
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.summary.total_assets).toBeGreaterThanOrEqual(8);
    expect(dashboardResponse.body.summary.total_kits).toBeGreaterThanOrEqual(1);
    expect(dashboardResponse.body.summary.assigned).toBeGreaterThanOrEqual(1);
    expect(dashboardResponse.body.summary.checked_out).toBeGreaterThanOrEqual(4);
    expect(dashboardResponse.body.summary.needs_repair).toBeGreaterThanOrEqual(1);
    expect(dashboardResponse.body.summary.missing).toBeGreaterThanOrEqual(1);
    expect(dashboardResponse.body.summary.overdue_returns).toBeGreaterThanOrEqual(1);
    expect(dashboardResponse.body.checked_out_now.map((item: { label: string }) => item.label)).toEqual(
      expect.arrayContaining(["Phase 2 Candid Media Kit", "Phase 2 Audio Mixer"])
    );
    expect(dashboardResponse.body.repair_queue.map((item: { label: string }) => item.label)).toEqual(
      expect.arrayContaining(["Phase 2 Lighting Stand", "Phase 2 Candid Media Kit"])
    );
    expect(dashboardResponse.body.missing_gear.map((item: { label: string }) => item.label)).toContain("Phase 2 70-200 Lens");
    expect(dashboardResponse.body.overdue_returns.map((item: { label: string }) => item.label)).toContain("Phase 2 Audio Mixer");
    expect(dashboardResponse.body.tile_attention.map((item: { label: string }) => item.label)).toEqual(
      expect.arrayContaining(["Phase 2 Candid Media Kit", "Phase 2 Lighting Stand"])
    );

    const assetsResponse = await request(app)
      .get("/api/gear/assets?status=checked_out&search=Phase%202")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(assetsResponse.status).toBe(200);
    expect(assetsResponse.body.assets.map((asset: { asset_name: string }) => asset.asset_name)).toEqual([
      "Phase 2 Audio Mixer",
      "Phase 2 Candid Camera",
      "Phase 2 Flash Kit"
    ]);
    expect(assetsResponse.body.filters.categories).toEqual(
      expect.arrayContaining(["audio", "camera", "lighting", "lens"])
    );
    expect(assetsResponse.body.filters.custodians.map((option: { full_name: string }) => option.full_name)).toEqual(
      expect.arrayContaining(["Demo Photographer"])
    );

    const assetDetailResponse = await request(app)
      .get(`/api/gear/assets/${currentSeed.repairAssetId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(assetDetailResponse.status).toBe(200);
    expect(assetDetailResponse.body.asset.asset_name).toBe("Phase 2 Lighting Stand");
    expect(assetDetailResponse.body.asset.status).toBe("needs_repair");
    expect(assetDetailResponse.body.asset.tile_tracker_id).toBeNull();
    expect(assetDetailResponse.body.active_checkout).toBeNull();
    expect(assetDetailResponse.body.service_records[0].issue_type).toBe("damage");
    expect(assetDetailResponse.body.custody_history[0].event_type).toBe("current_custodian_updated");

    const kitsResponse = await request(app)
      .get("/api/gear/kits?status=checked_out&search=Phase%202")
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(kitsResponse.status).toBe(200);
    expect(kitsResponse.body.kits).toHaveLength(1);
    expect(kitsResponse.body.kits[0].kit_name).toBe("Phase 2 Candid Media Kit");
    expect(kitsResponse.body.kits[0].assigned_user_name).toBe("Demo Photographer");
    expect(kitsResponse.body.filters.kit_types).toContain("candid_media");

    const kitDetailResponse = await request(app)
      .get(`/api/gear/kits/${currentSeed.kitId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(kitDetailResponse.status).toBe(200);
    expect(kitDetailResponse.body.kit.kit_name).toBe("Phase 2 Candid Media Kit");
    expect(kitDetailResponse.body.active_checkout.status).toBe("checked_out");
    expect(kitDetailResponse.body.contents.map((item: { asset_name: string }) => item.asset_name)).toEqual([
      "Phase 2 Candid Camera",
      "Phase 2 Flash Kit"
    ]);
    expect(kitDetailResponse.body.latest_pre_shoot_verification.status).toBe("verified_ready");
    expect(kitDetailResponse.body.latest_pre_shoot_verification.linked_shoot_title).toBeTruthy();
    expect(kitDetailResponse.body.service_records[0].issue_type).toBe("tracker_issue");
    expect(kitDetailResponse.body.custody_history[0].event_type).toBe("assigned");
  });

  it("blocks users who do not have Gear inventory access", async () => {
    const response = await request(app)
      .get("/api/gear/dashboard")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(403);
  });
});

async function seedGearInventoryRecords() {
  const suffix = randomUUID().slice(0, 8).toUpperCase();

  const homeLocationResult = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_home_location (tenant_id, name, description, active_status)
      VALUES ($1, $2, 'Gear inventory phase 2 home location', true)
      RETURNING id
    `,
    [tenantId, `Phase 2 Gear Home ${suffix}`]
  );
  currentSeed.homeLocationId = homeLocationResult.rows[0].id;

  const kitResult = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_kit (
        tenant_id,
        kit_name,
        kit_type,
        internal_kit_id,
        qr_code_id,
        tile_tracker_id,
        assigned_user_id,
        home_location_id,
        status,
        notes,
        active_status,
        assignment_started_at,
        assignment_note,
        current_custodian_id,
        last_seen_with_user_id
      )
      VALUES (
        $1,
        'Phase 2 Candid Media Kit',
        'candid_media',
        $2,
        $3,
        NULL,
        $4,
        $5,
        'checked_out',
        'Primary candid coverage Kit for leadership review.',
        true,
        now() - interval '30 days',
        'Standing Kit for candid coverage.',
        $4,
        $6
      )
      RETURNING id
    `,
    [tenantId, `KIT-P2-${suffix}`, `KIT-QR-P2-${suffix}`, photographerId, currentSeed.homeLocationId, assistantManagerId]
  );
  currentSeed.kitId = kitResult.rows[0].id;

  currentSeed.checkedOutAssetId = await insertAsset({
    internalAssetId: `GEAR-P2-CAM-${suffix}`,
    assetName: "Phase 2 Candid Camera",
    category: "camera",
    manufacturer: "Canon",
    model: "R6",
    serialNumber: `CAM-${suffix}`,
    qrCodeId: `ASSET-QR-CAM-${suffix}`,
    tileTrackerId: `TILE-CAM-${suffix}`,
    tileTrackerActive: true,
    status: "checked_out",
    currentKitId: currentSeed.kitId,
    currentCustodianId: photographerId,
    lastSeenWithUserId: assistantManagerId,
    notes: "Primary camera body assigned inside the candid Kit."
  });

  currentSeed.assignedAssetId = await insertAsset({
    internalAssetId: `GEAR-P2-ASSIGNED-${suffix}`,
    assetName: "Phase 2 Reserved Tripod",
    category: "support",
    manufacturer: "Manfrotto",
    model: "Befree",
    serialNumber: `ASSIGNED-${suffix}`,
    qrCodeId: `ASSET-QR-ASSIGNED-${suffix}`,
    tileTrackerId: `TILE-ASSIGNED-${suffix}`,
    tileTrackerActive: true,
    status: "assigned",
    lastSeenWithUserId: assistantManagerId,
    notes: "Reserved for the next field day but not physically checked out yet."
  });

  const flashKitAssetId = await insertAsset({
    internalAssetId: `GEAR-P2-FLASH-${suffix}`,
    assetName: "Phase 2 Flash Kit",
    category: "lighting",
    manufacturer: "Godox",
    model: "AD200",
    serialNumber: `FLASH-${suffix}`,
    qrCodeId: `ASSET-QR-FLASH-${suffix}`,
    tileTrackerId: `TILE-FLASH-${suffix}`,
    tileTrackerActive: true,
    status: "checked_out",
    currentKitId: currentSeed.kitId,
    currentCustodianId: photographerId,
    lastSeenWithUserId: assistantManagerId,
    notes: "Lighting pack that should travel with the candid Kit."
  });

  currentSeed.overdueAssetId = await insertAsset({
    internalAssetId: `GEAR-P2-AUDIO-${suffix}`,
    assetName: "Phase 2 Audio Mixer",
    category: "audio",
    manufacturer: "Zoom",
    model: "PodTrak P4",
    serialNumber: `AUDIO-${suffix}`,
    qrCodeId: `ASSET-QR-AUDIO-${suffix}`,
    tileTrackerId: `TILE-AUDIO-${suffix}`,
    tileTrackerActive: true,
    status: "checked_out",
    currentCustodianId: photographerId,
    lastSeenWithUserId: assistantManagerId,
    notes: "Standalone audio asset for event coverage."
  });

  currentSeed.repairAssetId = await insertAsset({
    internalAssetId: `GEAR-P2-REPAIR-${suffix}`,
    assetName: "Phase 2 Lighting Stand",
    category: "lighting",
    manufacturer: "Manfrotto",
    model: "Nano Stand",
    serialNumber: `REPAIR-${suffix}`,
    qrCodeId: `ASSET-QR-REPAIR-${suffix}`,
    tileTrackerId: null,
    tileTrackerActive: null,
    status: "needs_repair",
    lastSeenWithUserId: photographerId,
    notes: "Clamp is bent and needs service review."
  });

  currentSeed.missingAssetId = await insertAsset({
    internalAssetId: `GEAR-P2-MISSING-${suffix}`,
    assetName: "Phase 2 70-200 Lens",
    category: "lens",
    manufacturer: "Canon",
    model: "70-200",
    serialNumber: `MISSING-${suffix}`,
    qrCodeId: `ASSET-QR-MISSING-${suffix}`,
    tileTrackerId: null,
    tileTrackerActive: null,
    status: "missing",
    lastSeenWithUserId: photographerId,
    notes: "Missing after recent field use and needs immediate follow-up."
  });

  await insertAsset({
    internalAssetId: `GEAR-P2-OFFICE-${suffix}`,
    assetName: "Phase 2 Studio Laptop",
    category: "computer",
    manufacturer: "Dell",
    model: "Latitude",
    serialNumber: `OFFICE-${suffix}`,
    qrCodeId: `ASSET-QR-OFFICE-${suffix}`,
    tileTrackerId: `TILE-OFFICE-${suffix}`,
    tileTrackerActive: true,
    status: "in_office",
    notes: "Reserved for in-studio tether and data review."
  });

  await insertAsset({
    internalAssetId: `GEAR-P2-TRANSIT-${suffix}`,
    assetName: "Phase 2 Booth Printer",
    category: "printer",
    manufacturer: "DNP",
    model: "DS620A",
    serialNumber: `TRANSIT-${suffix}`,
    qrCodeId: `ASSET-QR-TRANSIT-${suffix}`,
    tileTrackerId: `TILE-TRANSIT-${suffix}`,
    tileTrackerActive: false,
    status: "in_transit",
    lastSeenWithUserId: assistantManagerId,
    notes: "Moving between Home Location and field event."
  });

  await insertAsset({
    internalAssetId: `GEAR-P2-AVAILABLE-${suffix}`,
    assetName: "Phase 2 Flash Trigger",
    category: "lighting",
    manufacturer: "PocketWizard",
    model: "Plus III",
    serialNumber: `AVAILABLE-${suffix}`,
    qrCodeId: `ASSET-QR-AVAILABLE-${suffix}`,
    tileTrackerId: `TILE-AVAILABLE-${suffix}`,
    tileTrackerActive: true,
    status: "available",
    notes: "Available shared trigger."
  });

  await pool.query(
    `
      INSERT INTO gear_kit_asset_membership (tenant_id, kit_id, asset_id, required_in_kit, display_order)
      VALUES
        ($1, $2, $3, true, 1),
        ($1, $2, $4, true, 2)
    `,
    [tenantId, currentSeed.kitId, currentSeed.checkedOutAssetId, flashKitAssetId]
  );

  await pool.query(
    `
      INSERT INTO gear_checkout_record (
        tenant_id,
        asset_id,
        checked_out_to_user_id,
        linked_shoot_id,
        linked_location_id,
        status,
        reserved_at,
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
        'assigned',
        now() - interval '1 hour',
        now() + interval '1 day',
        'Reserved for tomorrow''s field coverage.',
        $6
      )
    `,
    [tenantId, currentSeed.assignedAssetId, photographerId, shootId, shootLocationId, assistantManagerId]
  );

  await pool.query(
    `
      INSERT INTO gear_checkout_record (
        tenant_id,
        kit_id,
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
        now() - interval '4 hours',
        now() - interval '3 hours',
        now() + interval '6 hours',
        'Checked out for candid coverage.',
        $6
      )
    `,
    [tenantId, currentSeed.kitId, photographerId, shootId, shootLocationId, assistantManagerId]
  );

  await pool.query(
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
        now() - interval '2 days',
        now() - interval '2 days',
        now() - interval '1 day',
        'Still out from the prior event and now overdue.',
        $6
      )
    `,
    [tenantId, currentSeed.overdueAssetId, photographerId, shootId, shootLocationId, assistantManagerId]
  );

  await pool.query(
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
      SELECT
        tenant_id,
        'overdue_return',
        'open',
        asset_id,
        id,
        linked_shoot_id,
        linked_location_id,
        now() - interval '12 hours',
        now() - interval '30 minutes',
        expected_return_at,
        $2
      FROM gear_checkout_record
      WHERE tenant_id = $1
        AND asset_id = $3
        AND status = 'checked_out'
      LIMIT 1
    `,
    [tenantId, leadershipId, currentSeed.overdueAssetId]
  );

  await pool.query(
    `
      INSERT INTO gear_service_repair_record (
        tenant_id,
        asset_id,
        issue_type,
        status,
        reported_by,
        opened_at,
        note
      )
      VALUES ($1, $2, 'damage', 'open', $3, now() - interval '6 hours', 'Leg lock is cracked and needs replacement.')
    `,
    [tenantId, currentSeed.repairAssetId, leadershipId]
  );

  await pool.query(
    `
      INSERT INTO gear_service_repair_record (
        tenant_id,
        kit_id,
        issue_type,
        status,
        reported_by,
        opened_at,
        note
      )
      VALUES ($1, $2, 'tracker_issue', 'under_review', $3, now() - interval '1 day', 'Tile tracker link is missing for this Kit.')
    `,
    [tenantId, currentSeed.kitId, leadershipId]
  );

  await pool.query(
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
        now() - interval '8 hours',
        now() - interval '20 minutes',
        $5
      )
    `,
    [tenantId, currentSeed.missingAssetId, shootId, shootLocationId, leadershipId]
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
        'current_custodian_updated',
        NULL,
        $3,
        $4,
        $5,
        now() - interval '5 hours',
        'Moved into repair triage queue.',
        $6
      )
    `,
    [tenantId, currentSeed.repairAssetId, photographerId, shootId, shootLocationId, leadershipId]
  );

  await pool.query(
    `
      INSERT INTO gear_custody_event (
        tenant_id,
        kit_id,
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
        'assigned',
        NULL,
        $3,
        $4,
        $5,
        now() - interval '30 days',
        'Standing candid Kit assignment.',
        $6
      )
    `,
    [tenantId, currentSeed.kitId, photographerId, shootId, shootLocationId, leadershipId]
  );

  await pool.query(
    `
      INSERT INTO gear_pre_shoot_verification (
        tenant_id,
        kit_id,
        verified_by_user_id,
        linked_shoot_id,
        linked_location_id,
        status,
        all_required_items_present,
        verified_ready_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'verified_ready',
        true,
        now() - interval '2 hours'
      )
    `,
    [tenantId, currentSeed.kitId, assistantManagerId, shootId, shootLocationId]
  );
}

async function insertAsset(input: {
  internalAssetId: string;
  assetName: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  qrCodeId: string | null;
  tileTrackerId: string | null;
  tileTrackerActive: boolean | null;
  status: "available" | "assigned" | "checked_out" | "in_office" | "in_transit" | "needs_repair" | "missing";
  currentKitId?: string | null;
  currentCustodianId?: string | null;
  lastSeenWithUserId?: string | null;
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
        home_location_id,
        current_kit_id,
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
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        true
      )
      RETURNING id
    `,
    [
      tenantId,
      input.internalAssetId,
      input.assetName,
      input.category,
      input.manufacturer,
      input.model,
      input.serialNumber,
      input.qrCodeId,
      input.tileTrackerId,
      input.tileTrackerActive,
      input.status,
      currentSeed.homeLocationId,
      input.currentKitId ?? null,
      input.currentCustodianId ?? null,
      input.lastSeenWithUserId ?? null,
      input.notes
    ]
  );
  return result.rows[0].id;
}

async function cleanupGearInventorySeed() {
  if (!tenantId) {
    return;
  }

  await pool.query("DELETE FROM gear_alert WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_pre_shoot_verification_item WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_pre_shoot_verification WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_scan_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_kit_asset_membership WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND internal_asset_id LIKE 'GEAR-P2-%'", [tenantId]);
  await pool.query("DELETE FROM gear_kit WHERE tenant_id = $1 AND internal_kit_id LIKE 'KIT-P2-%'", [tenantId]);
  await pool.query("DELETE FROM gear_home_location WHERE tenant_id = $1 AND name LIKE 'Phase 2 Gear Home %'", [tenantId]);
}
