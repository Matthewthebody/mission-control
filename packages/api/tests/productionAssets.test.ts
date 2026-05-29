import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();

let ownerToken = "";

beforeAll(async () => {
  ownerToken = (await passwordLogin(app, "matthew@example.com")).body.token;
  await elevateSession(app, ownerToken, "LocalDemo123!");
});

describe("production asset manager", () => {
  it("returns the production asset workspace", async () => {
    const response = await request(app)
      .get("/api/production-assets/workspace")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.generated_at).toBeTruthy();
    expect(Array.isArray(response.body.presets)).toBe(true);
    expect(Array.isArray(response.body.background_packs)).toBe(true);
    expect(Array.isArray(response.body.licenses)).toBe(true);
  });

  it("creates presets, background packs, and tool licenses with update coverage", async () => {
    const preset = await request(app)
      .post("/api/production-assets/presets")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "School Portrait Default",
        job_types: ["standard_school_production"],
        notes: "Default preset for school portraits."
      });

    expect(preset.status).toBe(201);
    expect(preset.body.name).toBe("School Portrait Default");

    const presetVersion = await request(app)
      .post(`/api/production-assets/presets/${preset.body.id}/versions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        version_label: "v2026.1",
        validation_status: "validated"
      });

    expect(presetVersion.status).toBe(201);
    expect(presetVersion.body.versions.length).toBeGreaterThan(0);

    const versionId = presetVersion.body.versions[0].id;
    const versionUpdate = await request(app)
      .patch(`/api/production-assets/preset-versions/${versionId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ active_status: false });

    expect(versionUpdate.status).toBe(200);
    expect(versionUpdate.body.active_status).toBe(false);

    const presetUpdate = await request(app)
      .patch(`/api/production-assets/presets/${preset.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ validation_status: "validated" });

    expect(presetUpdate.status).toBe(200);
    expect(presetUpdate.body.validation_status).toBe("validated");

    const pack = await request(app)
      .post("/api/production-assets/background-packs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Fall Sports Pack",
        job_types: ["sports_production"],
        notes: "Primary fall sports background pack."
      });

    expect(pack.status).toBe(201);
    expect(pack.body.name).toBe("Fall Sports Pack");

    const variant = await request(app)
      .post(`/api/production-assets/background-packs/${pack.body.id}/variants`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Blue Fade", notes: "Standard varsity layout." });

    expect(variant.status).toBe(201);
    expect(variant.body.variants.length).toBeGreaterThan(0);

    const variantId = variant.body.variants[0].id;
    const variantUpdate = await request(app)
      .patch(`/api/production-assets/background-variants/${variantId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ active_status: false });

    expect(variantUpdate.status).toBe(200);
    expect(variantUpdate.body.active_status).toBe(false);

    const license = await request(app)
      .post("/api/production-assets/licenses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        tool_name: "Evoto",
        license_type: "subscription",
        seat_count: 8,
        status: "active",
        notes: "Primary editing seats"
      });

    expect(license.status).toBe(201);
    expect(license.body.tool_name).toBe("Evoto");

    const licenseUpdate = await request(app)
      .patch(`/api/production-assets/licenses/${license.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "expiring" });

    expect(licenseUpdate.status).toBe(200);
    expect(licenseUpdate.body.status).toBe("expiring");
  });

  it("writes audit history for production asset edits", async () => {
    const license = await request(app)
      .post("/api/production-assets/licenses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        tool_name: "Background Magic",
        license_type: "seat",
        seat_count: 4,
        status: "active"
      });

    const licenseId = license.body.id;
    await request(app)
      .patch(`/api/production-assets/licenses/${licenseId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "inactive" });

    const tenantResult = await pool.query(
      "SELECT tenant_id FROM app_user WHERE lower(email) = lower($1) ORDER BY created_at ASC LIMIT 1",
      ["matthew@example.com"]
    );
    const tenantId = String(tenantResult.rows[0]?.tenant_id ?? "");

    const auditRows = await pool.query(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND entity_type = 'production_tool_license'
          AND entity_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, licenseId]
    );

    const actions = auditRows.rows.map((row) => row.action);
    expect(actions).toContain("production_asset.tool_license.created");
    expect(actions).toContain("production_asset.tool_license.updated");
  });
});
