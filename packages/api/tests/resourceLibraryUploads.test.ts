import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let photographerToken = "";
let leadershipToken = "";
let tenantId = "";
let shootId = "";
let organizationId = "";
let locationId = "";
let photographerUserId = "";

beforeAll(async () => {
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;

  const context = await pool.query(
    `
      SELECT
        s.id AS shoot_id,
        s.tenant_id,
        s.organization_id,
        s.location_id,
        photographer.id AS photographer_user_id
      FROM shoot s
      JOIN app_user photographer
        ON photographer.tenant_id = s.tenant_id
       AND lower(photographer.email) = lower('photo@example.com')
      WHERE s.shoot_code = 'DEMO-001'
      LIMIT 1
    `
  );

  shootId = context.rows[0].shoot_id;
  tenantId = context.rows[0].tenant_id;
  organizationId = context.rows[0].organization_id;
  locationId = context.rows[0].location_id;
  photographerUserId = context.rows[0].photographer_user_id;
});

afterEach(async () => {
  await pool.query(
    `
      DELETE FROM resource_library_item
      WHERE tenant_id = $1
        AND source_record_type = 'resource_library_upload'
        AND file_name LIKE 'mobile-upload-test-%'
    `,
    [tenantId]
  );
  await pool.query(
    `
      DELETE FROM time_clock_compliance_flag
      WHERE tenant_id = $1
        AND employee_id = $2
        AND item_type = 'upload_while_off_clock'
    `,
    [tenantId, photographerUserId]
  );
  await pool.query(
    `
      UPDATE time_session
      SET status = 'closed',
          updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status IN ('open', 'needs_end_of_day_confirmation')
    `,
    [tenantId, photographerUserId]
  );
});

describe("resource library mobile uploads", () => {
  it("lets a photographer upload directly to a Shoot and stores review metadata", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        content_type: "image/jpeg",
        resource_type: "resource-library-shoot",
        resource_id: shootId
      });

    expect(presign.status).toBe(200);

    const response = await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "shoot",
        target_id: shootId,
        storage_key: presign.body.storage_key,
        file_name: "mobile-upload-test-shoot.jpg",
        content_type: "image/jpeg",
        file_size_bytes: 120400,
        category: "setup_photo",
        note: "North wall setup from mobile coverage.",
        issue_type: null,
        important_for_next_year: true,
        upload_source: "mobile_library",
        gps_lat: 44.98,
        gps_lng: -93.26,
        url: presign.body.object_url
      });

    expect(response.status).toBe(201);
    expect(response.body.approval_status).toBe("pending_review");
    expect(response.body.is_best_reference).toBe(true);

    const persisted = await pool.query(
      `
        SELECT
          category::text,
          approval_status::text,
          visibility_scope::text,
          upload_source::text,
          gps_lat,
          gps_lng,
          shoot_id,
          organization_id,
          location_id
        FROM resource_library_item
        WHERE tenant_id = $1
          AND source_record_type = 'resource_library_upload'
          AND file_name = 'mobile-upload-test-shoot.jpg'
        LIMIT 1
      `,
      [tenantId]
    );

    expect(persisted.rows[0]).toMatchObject({
      category: "setup_photo",
      approval_status: "pending_review",
      visibility_scope: "photographer_prep",
      upload_source: "mobile_library",
      shoot_id: shootId,
      organization_id: organizationId,
      location_id: locationId
    });
    expect(Number(persisted.rows[0].gps_lat)).toBeCloseTo(44.98, 2);
    expect(Number(persisted.rows[0].gps_lng)).toBeCloseTo(-93.26, 2);
  });

  it("blocks a field upload to a Location when the request is not tied back to an accessible Shoot", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        content_type: "image/jpeg",
        resource_type: "resource-library-location",
        resource_id: locationId
      });

    const response = await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "location",
        target_id: locationId,
        storage_key: presign.body.storage_key,
        file_name: "mobile-upload-test-location.jpg",
        content_type: "image/jpeg",
        category: "location_reference",
        upload_source: "mobile_camera",
        url: presign.body.object_url
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/shoot context/i);
  });

  it("lets leadership upload directly to an Organization without a linked Shoot", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        content_type: "application/pdf",
        resource_type: "resource-library-organization",
        resource_id: organizationId
      });

    const response = await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        target_type: "organization",
        target_id: organizationId,
        storage_key: presign.body.storage_key,
        file_name: "mobile-upload-test-organization.pdf",
        content_type: "application/pdf",
        file_size_bytes: 48200,
        category: "qr_code_job_document",
        note: "Updated check-in sheet from the field team.",
        upload_source: "mobile_document",
        url: presign.body.object_url
      });

    expect(response.status).toBe(201);
    expect(response.body.approval_status).toBe("approved");

    const persisted = await pool.query(
      `
        SELECT category::text, approval_status::text, upload_source::text, organization_id, shoot_id
        FROM resource_library_item
        WHERE tenant_id = $1
          AND source_record_type = 'resource_library_upload'
          AND file_name = 'mobile-upload-test-organization.pdf'
        LIMIT 1
      `,
      [tenantId]
    );

    expect(persisted.rows[0]).toMatchObject({
      category: "qr_code_job_document",
      approval_status: "approved",
      upload_source: "mobile_document",
      organization_id: organizationId,
      shoot_id: null
    });
  });

  it("allows an upload while Off Clock, returns a warning, and flags the mismatch for review", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        content_type: "image/jpeg",
        resource_type: "resource-library-shoot",
        resource_id: shootId
      });

    expect(presign.status).toBe(200);

    const response = await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "shoot",
        target_id: shootId,
        storage_key: presign.body.storage_key,
        file_name: "mobile-upload-test-off-clock.jpg",
        content_type: "image/jpeg",
        file_size_bytes: 120400,
        category: "setup_photo",
        note: "Captured before a missed clock-in was fixed.",
        upload_source: "mobile_camera",
        url: presign.body.object_url
      });

    expect(response.status).toBe(201);
    expect(response.body.off_clock_upload_warning?.message).toMatch(/off clock/i);
    expect(response.body.off_clock_upload_warning?.suggested_action).toMatch(/missed clock-in|correction request/i);

    const flag = await pool.query(
      `
        SELECT item_type::text, status::text, metadata->>'message' AS message
        FROM time_clock_compliance_flag
        WHERE tenant_id = $1
          AND employee_id = $2
          AND item_type = 'upload_while_off_clock'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, photographerUserId]
    );

    expect(flag.rows[0]).toMatchObject({
      item_type: "upload_while_off_clock",
      status: "open"
    });
    expect(String(flag.rows[0]?.message ?? "")).toMatch(/off clock/i);
  });
});
