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
  assetId: string;
};

const currentSeed: GearSeed = {
  homeLocationId: "",
  kitId: "",
  assetId: ""
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

  assistantManagerEmail = `assistant-manager-${randomUUID().slice(0, 8)}@example.com`;
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
      VALUES ($1, $2, 'Phase 3 Assistant Manager', true, 'operations', 'active', now())
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

  expect(tenantId).toBeTruthy();
  expect(leadershipId).toBeTruthy();
  expect(photographerId).toBeTruthy();
  expect(shootId).toBeTruthy();
  expect(assistantManagerToken).toBeTruthy();
});

afterAll(async () => {
  if (!assistantManagerId) {
    return;
  }

  await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_kit_asset_membership WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND internal_asset_id LIKE 'GEAR-P3-%'", [tenantId]);
  await pool.query("DELETE FROM gear_kit WHERE tenant_id = $1 AND internal_kit_id LIKE 'KIT-P3-%'", [tenantId]);
  await pool.query("DELETE FROM gear_home_location WHERE tenant_id = $1 AND name LIKE 'Phase 3 Gear %'", [tenantId]);
  await pool.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM user_authority_assignment WHERE tenant_id = $1 AND user_id = $2", [tenantId, assistantManagerId]);
  await pool.query("DELETE FROM app_user WHERE tenant_id = $1 AND id = $2", [tenantId, assistantManagerId]);
});

beforeEach(async () => {
  await pool.query("DELETE FROM gear_checkout_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_custody_event WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_kit_asset_membership WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM gear_asset WHERE tenant_id = $1 AND internal_asset_id LIKE 'GEAR-P3-%'", [tenantId]);
  await pool.query("DELETE FROM gear_kit WHERE tenant_id = $1 AND internal_kit_id LIKE 'KIT-P3-%'", [tenantId]);
  await pool.query("DELETE FROM gear_home_location WHERE tenant_id = $1 AND name LIKE 'Phase 3 Gear %'", [tenantId]);
  await pool.query("DELETE FROM gear_service_repair_record WHERE tenant_id = $1", [tenantId]);

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const homeLocation = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_home_location (tenant_id, name, description, active_status)
      VALUES ($1, $2, 'Phase 3 gear home location', true)
      RETURNING id
    `,
    [tenantId, `Phase 3 Gear Home ${suffix}`]
  );
  currentSeed.homeLocationId = homeLocation.rows[0].id;

  const kit = await pool.query<{ id: string }>(
    `
      INSERT INTO gear_kit (
        tenant_id,
        kit_name,
        kit_type,
        internal_kit_id,
        home_location_id,
        status,
        active_status
      )
      VALUES ($1, $2, 'candid_media', $3, $4, 'available', true)
      RETURNING id
    `,
    [tenantId, `Phase 3 Candid Media Kit ${suffix}`, `KIT-P3-${suffix}`, currentSeed.homeLocationId]
  );
  currentSeed.kitId = kit.rows[0].id;

  const asset = await pool.query<{ id: string }>(
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
      VALUES ($1, $2, 'Osmo Pocket', 'video', $3, 'available', true)
      RETURNING id
    `,
    [tenantId, `GEAR-P3-${suffix}`, currentSeed.homeLocationId]
  );
  currentSeed.assetId = asset.rows[0].id;
});

describe("gear custody workflows", () => {
  it("stores Permanent Assignment separately from current custody", async () => {
    const response = await request(app)
      .post(`/api/gear/kits/${currentSeed.kitId}/permanent-assignment`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_user_id: photographerId,
        assignment_note: "Standing seasonal kit"
      });

    expect(response.status).toBe(201);
    expect(response.body.assigned_user_id).toBe(photographerId);
    expect(response.body.current_custodian_id).toBeNull();
    expect(response.body.status).toBe("assigned");
    expect(response.body.assignment_note).toBe("Standing seasonal kit");
  });

  it("allows assistant managers to reserve, check out, and return gear while keeping active custody current", async () => {
    const reserveResponse = await request(app)
      .post("/api/gear/checkouts")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        target_type: "kit",
        target_id: currentSeed.kitId,
        checked_out_to_user_id: photographerId,
        initial_status: "assigned",
        linked_shoot_id: shootId,
        note: "Reserved for candid coverage."
      });

    expect(reserveResponse.status).toBe(201);
    expect(reserveResponse.body.checkout.status).toBe("assigned");
    expect(reserveResponse.body.checkout.linked_shoot_id).toBe(shootId);
    expect(reserveResponse.body.conflict_override_applied).toBe(false);

    const activeAfterReserve = await request(app)
      .get("/api/gear/checkouts/active")
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(activeAfterReserve.status).toBe(200);
    expect(activeAfterReserve.body).toHaveLength(1);
    expect(activeAfterReserve.body[0].status).toBe("assigned");

    const activateResponse = await request(app)
      .post(`/api/gear/checkouts/${reserveResponse.body.checkout.id}/check-out`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        note: "Checked Out to photographer at call time."
      });

    expect(activateResponse.status).toBe(200);
    expect(activateResponse.body.status).toBe("checked_out");
    expect(activateResponse.body.checked_out_to_user_id).toBe(photographerId);

    const returnResponse = await request(app)
      .post(`/api/gear/checkouts/${reserveResponse.body.checkout.id}/return`)
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        working_order_confirmed: true,
        note: "Returned complete and working."
      });

    expect(returnResponse.status).toBe(200);
    expect(returnResponse.body.checkout.status).toBe("returned");
    expect(returnResponse.body.issue_created).toBe(false);

    const activeAfterReturn = await request(app)
      .get("/api/gear/checkouts/active")
      .set("Authorization", `Bearer ${assistantManagerToken}`);

    expect(activeAfterReturn.status).toBe(200);
    expect(activeAfterReturn.body).toHaveLength(0);

    const kitState = await pool.query<{ status: string; current_custodian_id: string | null }>(
      "SELECT status, current_custodian_id FROM gear_kit WHERE tenant_id = $1 AND id = $2",
      [tenantId, currentSeed.kitId]
    );

    expect(kitState.rows[0]?.status).toBe("in_office");
    expect(kitState.rows[0]?.current_custodian_id).toBeNull();
  });

  it("blocks photographers, raises conflict alerts immediately, and only allows leadership override", async () => {
    const firstCheckout = await request(app)
      .post("/api/gear/checkouts")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        target_type: "asset",
        target_id: currentSeed.assetId,
        checked_out_to_user_id: photographerId,
        initial_status: "checked_out",
        linked_shoot_id: shootId,
        note: "Checked Out for event video coverage."
      });

    expect(firstCheckout.status).toBe(201);
    expect(firstCheckout.body.checkout.status).toBe("checked_out");

    const photographerAttempt = await request(app)
      .post("/api/gear/checkouts")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "asset",
        target_id: currentSeed.assetId,
        checked_out_to_user_id: photographerId,
        initial_status: "checked_out"
      });

    expect(photographerAttempt.status).toBe(403);

    const conflictAttempt = await request(app)
      .post("/api/gear/checkouts")
      .set("Authorization", `Bearer ${assistantManagerToken}`)
      .send({
        target_type: "asset",
        target_id: currentSeed.assetId,
        checked_out_to_user_id: assistantManagerId,
        initial_status: "checked_out",
        linked_shoot_id: shootId,
        note: "Second checkout should conflict."
      });

    expect(conflictAttempt.status).toBe(409);

    const overrideAttempt = await request(app)
      .post("/api/gear/checkouts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        target_type: "asset",
        target_id: currentSeed.assetId,
        checked_out_to_user_id: assistantManagerId,
        initial_status: "checked_out",
        linked_shoot_id: shootId,
        override_conflict: true,
        override_reason: "Leadership override for replacement coverage.",
        note: "Temporary Substitution approved."
      });

    expect(overrideAttempt.status).toBe(201);
    expect(overrideAttempt.body.conflict_override_applied).toBe(true);
    expect(overrideAttempt.body.checkout.checked_out_to_user_id).toBe(assistantManagerId);

    const checkoutRows = await pool.query<{ status: string; override_reason: string | null }>(
      `
        SELECT status, override_reason
        FROM gear_checkout_record
        WHERE tenant_id = $1
          AND asset_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, currentSeed.assetId]
    );

    expect(checkoutRows.rows).toHaveLength(2);
    expect(checkoutRows.rows[0]?.status).toBe("overridden");
    expect(checkoutRows.rows[0]?.override_reason).toBe("Leadership override for replacement coverage.");
    expect(checkoutRows.rows[1]?.status).toBe("checked_out");
  });
});
