import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
let token = "";

beforeAll(async () => {
  const migrationSql = await readFile(
    resolve(process.cwd(), "../../db/migrations/119_communication_identity_linking_phase1.sql"),
    "utf8"
  );
  try {
    await pool.query(migrationSql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists")) {
      throw error;
    }
  }
  const login = await request(app).post("/auth/dev-login").send({ email: "admin@example.com" });
  token = login.body.token;
});

describe("GET /auth/me", () => {
  it("returns the authenticated user payload", async () => {
    const response = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("admin@example.com");
    expect(response.body.user.tenantId).toBeTruthy();
    expect(response.body.user.permissions).toContain("shoot.read");
    expect(Array.isArray(response.body.user.internalRoleGroups)).toBe(true);
    expect(response.body.user.internalRoleGroups).toContain("senior_photographers");
    expect(response.body.user.communicationIdentity.provider).toBe("microsoft_teams");
    expect(["linked_ready", "disabled", "incomplete", "unlinked"]).toContain(response.body.user.communicationIdentity.status);
  });

  it("treats malformed bearer tokens as unauthorized instead of surfacing server errors", async () => {
    const response = await request(app).get("/auth/me").set("Authorization", "Bearer definitely-not-a-real-token");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  it("revokes a session on logout and rejects reuse of the old token", async () => {
    const login = await request(app).post("/auth/dev-login").send({ email: "leadership@example.com" });
    const freshToken = String(login.body.token);

    const logout = await request(app).post("/auth/logout").set("Authorization", `Bearer ${freshToken}`);
    expect(logout.status).toBe(200);

    const session = await request(app).get("/auth/session").set("Authorization", `Bearer ${freshToken}`);
    expect(session.status).toBe(401);
  });
});
