import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";
let shootId = "";
let userId = "";

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "photo@example.com" });
  token = login.body.token;

  const context = await pool.query(
    `
      SELECT s.id AS shoot_id, u.id AS user_id
      FROM shoot s
      JOIN app_user u ON u.tenant_id = s.tenant_id AND u.email = 'photo@example.com'
      WHERE s.shoot_code = 'DEMO-001'
      LIMIT 1
    `
  );
  shootId = context.rows[0].shoot_id;
  userId = context.rows[0].user_id;

  await pool.query("DELETE FROM mileage_claim WHERE shoot_id = $1 AND user_id = $2", [shootId, userId]);
});

describe("mileage preview and submit", () => {
  it("computes miles and returns a matching mileage zone", async () => {
    const response = await request(app)
      .post(`/api/shoots/${shootId}/mileage/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(Number(response.body.miles)).toBeGreaterThanOrEqual(0);
    expect(response.body.zone).toBeTruthy();
    expect(["Zone 1", "Zone 2", "Zone 3", "Zone 4"]).toContain(response.body.zone.zone_name);
    expect(response.body.source_of_truth).toBe("canonical_mileage_reimbursement");
  });

  it("creates a mileage claim from the previewed zone", async () => {
    const response = await request(app)
      .post(`/api/shoots/${shootId}/mileage/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.shoot_id).toBe(shootId);
    expect(response.body.user_id).toBe(userId);
    expect(Number(response.body.reimbursement_amount)).toBeGreaterThanOrEqual(0);
    expect(response.body.source_of_truth).toBe("canonical_mileage_reimbursement");
    expect(response.body.compatibility_mode).toBe("legacy_claim_bridge");
    expect(response.body.canonical_reimbursement).toBeTruthy();
  });
});
