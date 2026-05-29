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

beforeAll(async () => {
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;

  const context = await pool.query(
    `
      SELECT tenant_id, id AS shoot_id
      FROM shoot
      WHERE shoot_code = 'DEMO-001'
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  shootId = context.rows[0].shoot_id;
});

afterEach(async () => {
  await pool.query(
    `
      DELETE FROM resource_library_item
      WHERE tenant_id = $1
        AND source_record_type = 'resource_library_upload'
        AND file_name LIKE 'review-test-%'
    `,
    [tenantId]
  );
});

describe("resource library approval workflow", () => {
  it("lets leadership approve a pending upload and curate it as Best Reference", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        content_type: "image/jpeg",
        resource_type: "resource-library-shoot",
        resource_id: shootId
      });

    const upload = await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "shoot",
        target_id: shootId,
        storage_key: presign.body.storage_key,
        file_name: "review-test-setup.jpg",
        content_type: "image/jpeg",
        file_size_bytes: 145000,
        category: "setup_photo",
        note: "Captured from the lobby entrance.",
        important_for_next_year: true,
        upload_source: "mobile_camera",
        url: presign.body.object_url
      });

    expect(upload.status).toBe(201);
    expect(upload.body.approval_status).toBe("pending_review");

    const itemId = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM resource_library_item
        WHERE tenant_id = $1
          AND source_record_type = 'resource_library_upload'
          AND file_name = 'review-test-setup.jpg'
        LIMIT 1
      `,
      [tenantId]
    );

    const response = await request(app)
      .patch(`/api/resource-library/items/${itemId.rows[0].id}/review`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        approval_status: "approved",
        category: "setup_photo",
        visibility_scope: "photographer_prep",
        best_reference_candidate: true,
        is_best_reference: true,
        best_reference_category: "best_setup_example",
        review_note: "Use this as the lead setup example next year."
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      approval_status: "approved",
      visibility_scope: "photographer_prep",
      is_best_reference: true,
      best_reference_category: "best_setup_example",
      review_note: "Use this as the lead setup example next year."
    });

    const persisted = await pool.query(
      `
        SELECT
          approval_status::text,
          visibility_scope::text,
          best_reference_candidate,
          is_best_reference,
          best_reference_category::text,
          review_note
        FROM resource_library_item
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, itemId.rows[0].id]
    );

    expect(persisted.rows[0]).toMatchObject({
      approval_status: "approved",
      visibility_scope: "photographer_prep",
      best_reference_candidate: true,
      is_best_reference: true,
      best_reference_category: "best_setup_example",
      review_note: "Use this as the lead setup example next year."
    });
  });

  it("blocks field users from running the leadership review workflow", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        content_type: "image/jpeg",
        resource_type: "resource-library-shoot",
        resource_id: shootId
      });

    await request(app)
      .post("/api/resource-library/items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        target_type: "shoot",
        target_id: shootId,
        storage_key: presign.body.storage_key,
        file_name: "review-test-blocked.jpg",
        content_type: "image/jpeg",
        category: "setup_photo",
        upload_source: "mobile_camera",
        url: presign.body.object_url
      });

    const itemId = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM resource_library_item
        WHERE tenant_id = $1
          AND source_record_type = 'resource_library_upload'
          AND file_name = 'review-test-blocked.jpg'
        LIMIT 1
      `,
      [tenantId]
    );

    const response = await request(app)
      .patch(`/api/resource-library/items/${itemId.rows[0].id}/review`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        approval_status: "approved"
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/leadership/i);
  });
});
