import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { createAuditLog } from "../src/services/audit.js";

type TestContext = {
  tenantId: string;
  leadershipUserId: string;
  photographerUserId: string;
  shootId: string | null;
  locationId: string | null;
};

const ctx: TestContext = {
  tenantId: "",
  leadershipUserId: "",
  photographerUserId: "",
  shootId: null,
  locationId: null
};

beforeAll(async () => {
  const tenantResult = await pool.query<{ id: string }>("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  ctx.tenantId = tenantResult.rows[0]?.id ?? "";

  const leadershipResult = await pool.query<{ id: string }>(
    "SELECT id FROM app_user WHERE lower(email) = lower('leadership@example.com') LIMIT 1"
  );
  ctx.leadershipUserId = leadershipResult.rows[0]?.id ?? "";

  const photographerResult = await pool.query<{ id: string }>(
    "SELECT id FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1"
  );
  ctx.photographerUserId = photographerResult.rows[0]?.id ?? "";

  const contextResult = await pool.query<{ shoot_id: string | null; location_id: string | null }>(
    `
      SELECT
        ws.shoot_id,
        COALESCE(s.location_id, fallback_location.id) AS location_id
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
      LEFT JOIN LATERAL (
        SELECT sl.id
        FROM shoot_location sl
        WHERE sl.tenant_id = ws.tenant_id
        ORDER BY sl.created_at ASC
        LIMIT 1
      ) fallback_location ON TRUE
      WHERE ws.tenant_id = $1
      ORDER BY ws.starts_at ASC
      LIMIT 1
    `,
    [ctx.tenantId]
  );

  ctx.shootId = contextResult.rows[0]?.shoot_id ?? null;
  ctx.locationId = contextResult.rows[0]?.location_id ?? null;

  expect(ctx.tenantId).toBeTruthy();
  expect(ctx.leadershipUserId).toBeTruthy();
  expect(ctx.photographerUserId).toBeTruthy();
});

beforeEach(async () => {
  await pool.query(
    `
      DELETE FROM audit_log
      WHERE tenant_id = $1
        AND action LIKE 'gear.%'
    `,
    [ctx.tenantId]
  );

  await pool.query(
    `
      DELETE FROM gear_service_repair_record
      WHERE tenant_id = $1
    `,
    [ctx.tenantId]
  );

  await pool.query(
    `
      DELETE FROM gear_custody_event
      WHERE tenant_id = $1
    `,
    [ctx.tenantId]
  );

  await pool.query(
    `
      DELETE FROM gear_kit_asset_membership
      WHERE tenant_id = $1
    `,
    [ctx.tenantId]
  );

  await pool.query(
    `
      DELETE FROM gear_asset
      WHERE tenant_id = $1
        AND internal_asset_id LIKE 'GEAR-PHASE1-%'
    `,
    [ctx.tenantId]
  );

  await pool.query(
    `
      DELETE FROM gear_kit
      WHERE tenant_id = $1
        AND internal_kit_id LIKE 'KIT-PHASE1-%'
    `,
    [ctx.tenantId]
  );

  await pool.query(
    `
      DELETE FROM gear_home_location
      WHERE tenant_id = $1
        AND name LIKE 'Phase 1 %'
    `,
    [ctx.tenantId]
  );
});

describe("gear and equipment phase 1 foundation", () => {
  it("stores Assets, Kits, Kit Asset Memberships, Home Locations, Custody Events, and Service / Repair Records", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();

    const homeLocation = await pool.query(
      `
        INSERT INTO gear_home_location (
          tenant_id, name, description, active_status
        )
        VALUES ($1, $2, $3, true)
        RETURNING *
      `,
      [ctx.tenantId, `Phase 1 Home ${suffix}`, "Primary studio gear room"]
    );

    const kit = await pool.query(
      `
        INSERT INTO gear_kit (
          tenant_id, kit_name, kit_type, internal_kit_id, qr_code_id, tile_tracker_id,
          assigned_user_id, home_location_id, status, notes, active_status
        )
        VALUES (
          $1, $2, 'seasonal_photo_kit', $3, $4, $5,
          $6, $7, 'assigned', 'Seasonal sideline kit', true
        )
        RETURNING *
      `,
      [
        ctx.tenantId,
        `Phase 1 Kit ${suffix}`,
        `KIT-PHASE1-${suffix}`,
        `KIT-QR-${suffix}`,
        `KIT-TILE-${suffix}`,
        ctx.photographerUserId,
        homeLocation.rows[0].id
      ]
    );

    const asset = await pool.query(
      `
        INSERT INTO gear_asset (
          tenant_id, internal_asset_id, asset_name, category, manufacturer, model, serial_number,
          qr_code_id, tile_tracker_id, tile_tracker_active, status, home_location_id, current_kit_id,
          current_custodian_id, last_seen_with_user_id, notes, active_status
        )
        VALUES (
          $1, $2, 'Canon R6 Body', 'camera_body', 'Canon', 'R6 Mark II', $3,
          $4, $5, true, 'assigned', $6, $7,
          $8, $9, 'Primary body for field coverage', true
        )
        RETURNING *
      `,
      [
        ctx.tenantId,
        `GEAR-PHASE1-${suffix}`,
        `SERIAL-${suffix}`,
        `ASSET-QR-${suffix}`,
        `ASSET-TILE-${suffix}`,
        homeLocation.rows[0].id,
        kit.rows[0].id,
        ctx.photographerUserId,
        ctx.leadershipUserId
      ]
    );

    const membership = await pool.query(
      `
        INSERT INTO gear_kit_asset_membership (
          tenant_id, kit_id, asset_id, required_in_kit, display_order
        )
        VALUES ($1, $2, $3, true, 1)
        RETURNING *
      `,
      [ctx.tenantId, kit.rows[0].id, asset.rows[0].id]
    );

    const checkoutEvent = await pool.query(
      `
        INSERT INTO gear_custody_event (
          tenant_id, asset_id, event_type, from_user_id, to_user_id, linked_shoot_id, linked_location_id,
          timestamp, latitude, longitude, note, created_by
        )
        VALUES (
          $1, $2, 'checked_out', $3, $4, $5, $6,
          now(), 44.977800, -93.265000, 'Checked out for assignment.', $7
        )
        RETURNING *
      `,
      [
        ctx.tenantId,
        asset.rows[0].id,
        ctx.leadershipUserId,
        ctx.photographerUserId,
        ctx.shootId,
        ctx.locationId,
        ctx.leadershipUserId
      ]
    );

    const verificationEvent = await pool.query(
      `
        INSERT INTO gear_custody_event (
          tenant_id, kit_id, event_type, to_user_id, linked_shoot_id, linked_location_id,
          timestamp, note, created_by
        )
        VALUES (
          $1, $2, 'pre_shoot_verification', $3, $4, $5,
          now(), 'Pre-Shoot Verification completed for kit.', $6
        )
        RETURNING *
      `,
      [
        ctx.tenantId,
        kit.rows[0].id,
        ctx.photographerUserId,
        ctx.shootId,
        ctx.locationId,
        ctx.photographerUserId
      ]
    );

    const repairRecord = await pool.query(
      `
        INSERT INTO gear_service_repair_record (
          tenant_id, asset_id, issue_type, status, reported_by, opened_at, note
        )
        VALUES (
          $1, $2, 'battery_issue', 'open', $3, now(),
          'Battery door latch needs inspection.'
        )
        RETURNING *
      `,
      [ctx.tenantId, asset.rows[0].id, ctx.photographerUserId]
    );

    const audit = await createAuditLog(pool, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.leadershipUserId,
      targetUserId: ctx.photographerUserId,
      action: "gear.asset.updated",
      entityType: "gear_asset",
      entityId: asset.rows[0].id,
      previousValues: {
        current_custodian_id: null,
        status: "available"
      },
      newValues: {
        current_custodian_id: ctx.photographerUserId,
        status: "assigned"
      },
      reasonComment: "Permanent kit assignment recorded."
    });

    expect(homeLocation.rows[0].name).toBe(`Phase 1 Home ${suffix}`);
    expect(kit.rows[0].status).toBe("assigned");
    expect(asset.rows[0].current_kit_id).toBe(kit.rows[0].id);
    expect(asset.rows[0].current_custodian_id).toBe(ctx.photographerUserId);
    expect(asset.rows[0].last_seen_with_user_id).toBe(ctx.leadershipUserId);
    expect(membership.rows[0].required_in_kit).toBe(true);
    expect(checkoutEvent.rows[0].event_type).toBe("checked_out");
    expect(verificationEvent.rows[0].event_type).toBe("pre_shoot_verification");
    expect(repairRecord.rows[0].issue_type).toBe("battery_issue");
    expect(audit.reason_comment).toBe("Permanent kit assignment recorded.");
    expect(audit.new_values.status).toBe("assigned");
  });

  it("prevents a single Asset from belonging to multiple active Kits and enforces unique internal ids", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();

    const homeLocation = await pool.query(
      `
        INSERT INTO gear_home_location (
          tenant_id, name, active_status
        )
        VALUES ($1, $2, true)
        RETURNING *
      `,
      [ctx.tenantId, `Phase 1 Duplicate Guard ${suffix}`]
    );

    const firstKit = await pool.query(
      `
        INSERT INTO gear_kit (
          tenant_id, kit_name, kit_type, internal_kit_id, home_location_id, status, active_status
        )
        VALUES ($1, $2, 'sports_kit', $3, $4, 'available', true)
        RETURNING *
      `,
      [ctx.tenantId, `Phase 1 First Kit ${suffix}`, `KIT-PHASE1-FIRST-${suffix}`, homeLocation.rows[0].id]
    );

    const secondKit = await pool.query(
      `
        INSERT INTO gear_kit (
          tenant_id, kit_name, kit_type, internal_kit_id, home_location_id, status, active_status
        )
        VALUES ($1, $2, 'backup_kit', $3, $4, 'available', true)
        RETURNING *
      `,
      [ctx.tenantId, `Phase 1 Second Kit ${suffix}`, `KIT-PHASE1-SECOND-${suffix}`, homeLocation.rows[0].id]
    );

    const asset = await pool.query(
      `
        INSERT INTO gear_asset (
          tenant_id, internal_asset_id, asset_name, category, status, active_status
        )
        VALUES ($1, $2, 'Sony A7 IV Body', 'camera_body', 'available', true)
        RETURNING *
      `,
      [ctx.tenantId, `GEAR-PHASE1-DUP-${suffix}`]
    );

    await pool.query(
      `
        INSERT INTO gear_kit_asset_membership (
          tenant_id, kit_id, asset_id, required_in_kit
        )
        VALUES ($1, $2, $3, true)
      `,
      [ctx.tenantId, firstKit.rows[0].id, asset.rows[0].id]
    );

    const duplicateMembership = pool.query(
      `
        INSERT INTO gear_kit_asset_membership (
          tenant_id, kit_id, asset_id, required_in_kit
        )
        VALUES ($1, $2, $3, true)
      `,
      [ctx.tenantId, secondKit.rows[0].id, asset.rows[0].id]
    );

    await expect(duplicateMembership).rejects.toThrow(/gear_kit_asset_membership_asset_active_uq|duplicate key/i);

    const duplicateInternalAssetId = pool.query(
      `
        INSERT INTO gear_asset (
          tenant_id, internal_asset_id, asset_name, category, status, active_status
        )
        VALUES ($1, $2, 'Sony Backup Body', 'camera_body', 'available', true)
      `,
      [ctx.tenantId, asset.rows[0].internal_asset_id]
    );

    await expect(duplicateInternalAssetId).rejects.toThrow(/gear_asset_internal_asset_id_uq|duplicate key/i);
  });
});
