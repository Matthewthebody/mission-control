import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";
let shootId = "";

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "photo@example.com" });
  token = login.body.token;

  const shoot = await pool.query("SELECT id FROM shoot WHERE shoot_code = 'DEMO-001' LIMIT 1");
  shootId = shoot.rows[0].id;
});

describe("upload presign and media attach", () => {
  it("returns a local stub presign response when AWS credentials are not configured", async () => {
    const response = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${token}`)
      .send({ content_type: "image/jpeg", resource_type: "shoot", resource_id: shootId });

    expect(response.status).toBe(200);
    expect(response.body.url).toBe("http://localhost:4566/mock-s3");
    expect(response.body.storage_key).toMatch(/^tenants\//);
    expect(response.body.fields["Content-Type"]).toBe("image/jpeg");
  });

  it("attaches uploaded media to a shoot", async () => {
    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${token}`)
      .send({ content_type: "image/jpeg", resource_type: "shoot", resource_id: shootId });
    const storageKey = String(presign.body.storage_key);
    const response = await request(app)
      .post(`/api/shoots/${shootId}/media`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        storage_key: storageKey,
        kind: "setup_photo",
        url: `https://example.test/${storageKey}`
      });

    expect(response.status).toBe(201);
    expect(response.body.shoot_id).toBe(shootId);
    expect(response.body.storage_key).toBe(storageKey);
    expect(response.body.kind).toBe("setup_photo");
    expect(response.body.category).toBe("setup_photo");
    expect(response.body.approval_status).toBe("pending_review");
    expect(response.body.visibility_scope).toBe("photographer_prep");

    const persisted = await pool.query("SELECT * FROM media_asset WHERE id = $1", [response.body.id]);
    expect(persisted.rows[0].storage_key).toBe(storageKey);

    const mirrored = await pool.query(
      `
        SELECT category::text, approval_status::text, visibility_scope::text, file_name, shoot_id
        FROM resource_library_item
        WHERE tenant_id = (
          SELECT tenant_id
          FROM shoot
          WHERE id = $1
        )
          AND source_record_type = 'media_asset'
          AND source_record_id = $2
        LIMIT 1
      `,
      [shootId, response.body.id]
    );
    expect(mirrored.rows[0]).toMatchObject({
      category: "setup_photo",
      approval_status: "pending_review",
      visibility_scope: "photographer_prep",
      file_name: storageKey.split("/").at(-1),
      shoot_id: shootId
    });
  });
});
