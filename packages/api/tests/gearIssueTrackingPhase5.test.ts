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
let assistantManagerId = "";
let assistantManagerEmail = "";
let assistantManagerToken = "";
let shootId = "";
let shootLocationId = "";

type GearSeed = {
  homeLocationId: string;
  originalAssetId: string;
  originalAssetQrCodeId: string;
  substituteAssetId: string;
  substituteAssetQrCodeId: string;
};

const currentSeed: GearSeed = {
  homeLocationId: "",
  originalAssetId: "",
  originalAssetQrCodeId: "",
  substituteAssetId: "",
  substituteAssetQrCodeId: ""
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

  assistantManagerEmail = `assistant-manager-p5-${randomUUID().slice(0, 8)}@example.com`;
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
      VALUES ($1, $2, 'Phase 5 Assistant Manager', true, 'operations', 'active', now())
      RETURNING id
    `,
    [tenantId, assistantManagerEmail]
  );
  assistantManagerId = insertedAssistant.rows[0].id;

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
  assistantManagerToken = (await devLogin(app, assistantManagerEmail)).body.token;
});

afterAll(async () => {
  await cleanupGearPhase5Data();
  if (!assistantManagerId) {
    return;
  }
  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, assistantManagerId]);
});

beforeEach(async () => {
  await cleanupGearPhase5Data();

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  currentSeed.originalAssetQrCodeId = `ASSET-P5-ORIG-${suffix}`;
  currentSeed.substituteAssetQrCodeId = `ASSET-P5-SUB-${suffix}`;

  const homeLocation = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_home_location (tenant_id, name, description, active_status)
      VALUES ($1, $2, 'Phase 5 gear home location', true)
      RETURNING id
    `,
    [tenantId, `Phase 5 Gear Home ${suffix}`]
  );
  currentSeed.homeLocationId = homeLocation.rows[0].id;

  const originalAsset = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_asset (
        tenant_id,
        internal_asset_id,
        asset_name,
        category,
        qr_code_id,
        home_location_id,
        status,
        active_status
      )
      VALUES ($1, $2, 'Phase 5 Camera Body', 'camera', $3, $4, 'available', true)
      RETURNING id
    `,
    [tenantId, `GEAR-P5-CAM-${suffix}`, currentSeed.originalAssetQrCodeId, currentSeed.homeLocationId]
  );
  currentSeed.originalAssetId = originalAsset.rows[0].id;

  const substituteAsset = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_asset (
        tenant_id,
        internal_asset_id,
        asset_name,
        category,
        qr_code_id,
        home_location_id,
        status,
        active_status
      )
      VALUES ($1, $2, 'Phase 5 Backup Camera Body', 'camera', $3, $4, 'in_office', true)
      RETURNING id
    `,
    [tenantId, `GEAR-P5-BACKUP-${suffix}`, currentSeed.substituteAssetQrCodeId, currentSeed.homeLocationId]
  );
  currentSeed.substituteAssetId = substituteAsset.rows[0].id;
});

describe("gear issue tracking and substitutions", () => {
  it("creates a pickup issue report during QR checkout", async () => {
    const checkout = await request(app)
      .post("/api/gear/scan/check-out")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.originalAssetQrCodeId,
        checked_out_to_user_id: photographerId,
        linked_shoot_id: shootId,
        pickup_working_order_confirmed: false,
        pickup_issue_type: "broken",
        pickup_issue_note: "Viewfinder was cracked during pickup."
      });

    expect(checkout.status).toBe(201);
    expect(checkout.body.status).toBe("checked_out");

    const assetDetail = await request(app)
      .get(`/api/gear/assets/${currentSeed.originalAssetId}`)
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(assetDetail.status).toBe(200);
    expect(assetDetail.body.active_checkout.id).toBeTruthy();
    expect(assetDetail.body.service_records[0].issue_type).toBe("broken");
    expect(assetDetail.body.service_records[0].source_checkout_id).toBe(assetDetail.body.active_checkout.id);
    expect(assetDetail.body.service_records[0].linked_shoot_title).toBeTruthy();
  });

  it("tracks a Temporary Substitution without destroying original custody history", async () => {
    const checkout = await request(app)
      .post("/api/gear/checkouts")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        target_type: "asset",
        target_id: currentSeed.originalAssetId,
        checked_out_to_user_id: photographerId,
        initial_status: "checked_out",
        linked_shoot_id: shootId,
        linked_location_id: shootLocationId,
        note: "Original Asset issued for event coverage."
      });

    expect(checkout.status).toBe(201);

    const substitution = await request(app)
      .post("/api/gear/temporary-substitutions")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        original_asset_id: currentSeed.originalAssetId,
        substitute_asset_id: currentSeed.substituteAssetId,
        linked_shoot_id: shootId,
        linked_location_id: shootLocationId,
        note: "Backup body issued after the primary body started failing."
      });

    expect(substitution.status).toBe(201);
    expect(substitution.body.status).toBe("active");
    expect(substitution.body.original_asset_id).toBe(currentSeed.originalAssetId);
    expect(substitution.body.substitute_asset_id).toBe(currentSeed.substituteAssetId);

    const originalDetail = await request(app)
      .get(`/api/gear/assets/${currentSeed.originalAssetId}`)
      .set("Authorization", `Bearer ${assistantManagerToken}`);
    expect(originalDetail.status).toBe(200);
    expect(originalDetail.body.temporary_substitutions).toHaveLength(1);

    const substituteDetail = await request(app)
      .get(`/api/gear/assets/${currentSeed.substituteAssetId}`)
      .set("Authorization", `Bearer ${assistantManagerToken}`);
    expect(substituteDetail.status).toBe(200);
    expect(substituteDetail.body.active_checkout.checked_out_to_user_name).toBeTruthy();

    const endResponse = await request(app)
      .post(`/api/gear/temporary-substitutions/${substitution.body.id}/end`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        note: "Loaner returned after the original gear was swapped back."
      });

    expect(endResponse.status).toBe(200);
    expect(endResponse.body.status).toBe("ended");

    const substituteAfterEnd = await request(app)
      .get(`/api/gear/assets/${currentSeed.substituteAssetId}`)
      .set("Authorization", `Bearer ${assistantManagerToken}`);
    expect(substituteAfterEnd.status).toBe(200);
    expect(substituteAfterEnd.body.active_checkout).toBeNull();
  });

  it("marks returned gear missing when the return issue is reported as Missing", async () => {
    const checkout = await request(app)
      .post("/api/gear/scan/check-out")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.originalAssetQrCodeId,
        checked_out_to_user_id: photographerId,
        linked_shoot_id: shootId
      });

    expect(checkout.status).toBe(201);

    const returnResponse = await request(app)
      .post("/api/gear/scan/return")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.originalAssetQrCodeId,
        working_order_confirmed: false,
        issue_type: "missing",
        note: "Asset did not come back with the rest of the gear."
      });

    expect(returnResponse.status).toBe(200);
    expect(returnResponse.body.status).toBe("returned");
    expect(returnResponse.body.issue_created).toBe(true);

    const assetDetail = await request(app)
      .get(`/api/gear/assets/${currentSeed.originalAssetId}`)
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(assetDetail.status).toBe(200);
    expect(assetDetail.body.asset.status).toBe("missing");
    expect(assetDetail.body.service_records[0].issue_type).toBe("missing");
  });
});

async function cleanupGearPhase5Data() {
  await pool.query("DELETE FROM gear_scan_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_pre_shoot_verification_item WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_pre_shoot_verification WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_temporary_substitution WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_kit_asset_membership WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND internal_asset_id LIKE 'GEAR-P5-%'", [tenantId]);
  await pool.query("DELETE FROM gear_home_location WHERE tenant_id = $1 AND name LIKE 'Phase 5 Gear %'", [tenantId]);
}
