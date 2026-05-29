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

type GearSeed = {
  homeLocationId: string;
  kitId: string;
  kitQrCodeId: string;
  primaryAssetId: string;
  primaryAssetQrCodeId: string;
  manualAssetId: string;
  unexpectedAssetId: string;
  unexpectedAssetQrCodeId: string;
};

const currentSeed: GearSeed = {
  homeLocationId: "",
  kitId: "",
  kitQrCodeId: "",
  primaryAssetId: "",
  primaryAssetQrCodeId: "",
  manualAssetId: "",
  unexpectedAssetId: "",
  unexpectedAssetQrCodeId: ""
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

  assistantManagerEmail = `assistant-manager-p4-${randomUUID().slice(0, 8)}@example.com`;
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
      VALUES ($1, $2, 'Phase 4 Assistant Manager', true, 'operations', 'active', now())
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
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  assistantManagerToken = (await devLogin(app, assistantManagerEmail)).body.token;
});

afterAll(async () => {
  await cleanupGearPhase4Data();
  if (!assistantManagerId) {
    return;
  }
  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, assistantManagerId]);
});

beforeEach(async () => {
  await cleanupGearPhase4Data();

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  currentSeed.kitQrCodeId = `KIT-P4-QR-${suffix}`;
  currentSeed.primaryAssetQrCodeId = `ASSET-P4-QR-${suffix}`;
  currentSeed.unexpectedAssetQrCodeId = `ASSET-P4-OTHER-QR-${suffix}`;

  const homeLocation = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_home_location (tenant_id, name, description, active_status)
      VALUES ($1, $2, 'Phase 4 gear home location', true)
      RETURNING id
    `,
    [tenantId, `Phase 4 Gear Home ${suffix}`]
  );
  currentSeed.homeLocationId = homeLocation.rows[0].id;

  const kit = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_kit (
        tenant_id,
        kit_name,
        kit_type,
        internal_kit_id,
        qr_code_id,
        home_location_id,
        status,
        active_status
      )
      VALUES ($1, $2, 'candid_media', $3, $4, $5, 'available', true)
      RETURNING id
    `,
    [tenantId, `Phase 4 Candid Media Kit ${suffix}`, `KIT-P4-${suffix}`, currentSeed.kitQrCodeId, currentSeed.homeLocationId]
  );
  currentSeed.kitId = kit.rows[0].id;

  const primaryAsset = await pool.query<{ id: string }>(
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
      VALUES ($1, $2, 'Mirrorless Camera', 'camera', $3, $4, 'available', true)
      RETURNING id
    `,
    [tenantId, `GEAR-P4-CAM-${suffix}`, currentSeed.primaryAssetQrCodeId, currentSeed.homeLocationId]
  );
  currentSeed.primaryAssetId = primaryAsset.rows[0].id;

  const manualAsset = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_asset (
        tenant_id,
        internal_asset_id,
        asset_name,
        category,
        home_location_id,
        status,
        active_status
      )
      VALUES ($1, $2, 'Backdrop Stand', 'support', $3, 'available', true)
      RETURNING id
    `,
    [tenantId, `GEAR-P4-STAND-${suffix}`, currentSeed.homeLocationId]
  );
  currentSeed.manualAssetId = manualAsset.rows[0].id;

  const unexpectedAsset = await pool.query<{ id: string }>(
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
      VALUES ($1, $2, 'Osmo Pocket', 'video', $3, $4, 'available', true)
      RETURNING id
    `,
    [tenantId, `GEAR-P4-OSMO-${suffix}`, currentSeed.unexpectedAssetQrCodeId, currentSeed.homeLocationId]
  );
  currentSeed.unexpectedAssetId = unexpectedAsset.rows[0].id;

  await pool.query(
    `
      INSERT INTO gear_kit_asset_membership (
        tenant_id,
        kit_id,
        asset_id,
        required_in_kit,
        display_order
      )
      VALUES
        ($1, $2, $3, true, 1),
        ($1, $2, $4, true, 2)
    `,
    [tenantId, currentSeed.kitId, currentSeed.primaryAssetId, currentSeed.manualAssetId]
  );
});

describe("gear QR scan workflows", () => {
  it("resolves a Kit QR code and stores scan history", async () => {
    const response = await request(app)
      .post("/api/gear/scan/resolve")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.kitQrCodeId,
        linked_shoot_id: shootId
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("resolved");
    expect(response.body.target.target_type).toBe("kit");
    expect(response.body.target.id).toBe(currentSeed.kitId);
    expect(response.body.kit_membership).toHaveLength(2);

    const history = await request(app)
      .get(`/api/gear/scan-history?target_type=kit&target_id=${currentSeed.kitId}`)
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(history.status).toBe(200);
    expect(history.body[0].scan_action).toBe("open_kit_detail");
    expect(history.body[0].qr_code_id).toBe(currentSeed.kitQrCodeId);
  });

  it("supports Pre-Shoot Verification with manual confirm, QR confirm, and verified-ready completion", async () => {
    const startResponse = await request(app)
      .post(`/api/gear/kits/${currentSeed.kitId}/pre-shoot-verifications`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        linked_shoot_id: shootId
      });

    expect(startResponse.status).toBe(201);
    expect(startResponse.body.verification.status).toBe("in_progress");
    expect(startResponse.body.items).toHaveLength(2);

    const verificationId = String(startResponse.body.verification.id);

    const manualConfirm = await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/confirm-item`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        expected_asset_id: currentSeed.manualAssetId,
        note: "Manual visual confirmation for non-QR item."
      });

    expect(manualConfirm.status).toBe(200);
    expect(manualConfirm.body.items.find((item: { expected_asset_id: string }) => item.expected_asset_id === currentSeed.manualAssetId)?.presence_status).toBe("present");

    const scanConfirm = await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/scan-item`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.primaryAssetQrCodeId
      });

    expect(scanConfirm.status).toBe(200);
    expect(scanConfirm.body.status).toBe("confirmed");

    const complete = await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/complete`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({});

    expect(complete.status).toBe(200);
    expect(complete.body.verification.status).toBe("verified_ready");
    expect(complete.body.verification.all_required_items_present).toBe(true);
  });

  it("logs mismatches and only allows leadership to override them", async () => {
    const startResponse = await request(app)
      .post(`/api/gear/kits/${currentSeed.kitId}/pre-shoot-verifications`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        linked_shoot_id: shootId
      });

    const verificationId = String(startResponse.body.verification.id);

    const mismatch = await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/scan-item`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.unexpectedAssetQrCodeId
      });

    expect(mismatch.status).toBe(409);
    expect(mismatch.body.status).toBe("mismatch");
    expect(mismatch.body.override_allowed).toBe(false);

    const leadershipOverride = await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/scan-item`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        qr_code_id: currentSeed.unexpectedAssetQrCodeId,
        override_mismatch: true,
        override_reason: "Temporary Substitution approved for departure."
      });

    expect(leadershipOverride.status).toBe(200);
    expect(leadershipOverride.body.status).toBe("override_applied");
    expect(leadershipOverride.body.verification.counts.unexpected_items).toBe(1);
  });

  it("requires completed Pre-Shoot Verification before a Kit QR checkout and then supports QR return", async () => {
    const blockedCheckout = await request(app)
      .post("/api/gear/scan/check-out")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.kitQrCodeId,
        checked_out_to_user_id: photographerId,
        linked_shoot_id: shootId
      });

    expect(blockedCheckout.status).toBe(409);
    expect(blockedCheckout.body.status).toBe("verification_required");

    const startResponse = await request(app)
      .post(`/api/gear/kits/${currentSeed.kitId}/pre-shoot-verifications`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        linked_shoot_id: shootId
      });

    const verificationId = String(startResponse.body.verification.id);

    await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/confirm-item`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        expected_asset_id: currentSeed.manualAssetId
      });

    await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/scan-item`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.primaryAssetQrCodeId
      });

    await request(app)
      .post(`/api/gear/pre-shoot-verifications/${verificationId}/complete`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({});

    const checkout = await request(app)
      .post("/api/gear/scan/check-out")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.kitQrCodeId,
        checked_out_to_user_id: photographerId,
        linked_shoot_id: shootId,
        verification_id: verificationId,
        note: "Checked Out for tonight's event."
      });

    expect(checkout.status).toBe(201);
    expect(checkout.body.status).toBe("checked_out");
    expect(checkout.body.checkout.linked_shoot_id).toBe(shootId);

    const returnResponse = await request(app)
      .post("/api/gear/scan/return")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        qr_code_id: currentSeed.kitQrCodeId,
        working_order_confirmed: true,
        note: "Returned complete and working."
      });

    expect(returnResponse.status).toBe(200);
    expect(returnResponse.body.status).toBe("returned");
    expect(returnResponse.body.issue_created).toBe(false);
  });

  it("blocks photographers from official QR custody actions", async () => {
    const response = await request(app)
      .post("/api/gear/scan/check-out")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        qr_code_id: currentSeed.kitQrCodeId,
        checked_out_to_user_id: photographerId,
        linked_shoot_id: shootId
      });

    expect(response.status).toBe(403);
  });
});

async function cleanupGearPhase4Data() {
  await pool.query("DELETE FROM gear_scan_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_pre_shoot_verification_item WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_pre_shoot_verification WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_kit_asset_membership WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND internal_asset_id LIKE 'GEAR-P4-%'", [tenantId]);
  await pool.query("DELETE FROM gear_kit WHERE tenant_id = $1 AND internal_kit_id LIKE 'KIT-P4-%'", [tenantId]);
  await pool.query("DELETE FROM gear_home_location WHERE tenant_id = $1 AND name LIKE 'Phase 4 Gear %'", [tenantId]);
}
