import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();

let ownerToken = "";
let leadershipToken = "";
let officeToken = "";

beforeAll(async () => {
  ownerToken = (await passwordLogin(app, "matthew@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  officeToken = (await passwordLogin(app, "office@example.com")).body.token;

  await elevateSession(app, ownerToken, "LocalDemo123!");
  await elevateSession(app, leadershipToken, "LocalDemo123!");
});

describe("admin workspace route", () => {
  it("returns the composed admin control-room contract for privileged users and blocks standard office access", async () => {
    const ownerResponse = await request(app)
      .get("/api/dashboard/admin/workspace?date=2026-03-31")
      .set("Authorization", `Bearer ${ownerToken}`);
    const leadershipResponse = await request(app)
      .get("/api/dashboard/admin/workspace?date=2026-03-31")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const officeResponse = await request(app)
      .get("/api/dashboard/admin/workspace?date=2026-03-31")
      .set("Authorization", `Bearer ${officeToken}`);

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.anchor_date).toBe("2026-03-31");
    expect(ownerResponse.body.role_mode).toBe("manage");
    expect(Array.isArray(ownerResponse.body.summary_strip)).toBe(true);
    expect(ownerResponse.body.summary_strip.length).toBeGreaterThan(0);
    expect(ownerResponse.body.roles_access.visible).toBe(true);
    expect(ownerResponse.body.integrations.visible).toBe(true);
    expect(ownerResponse.body.audit_security.visible).toBe(true);
    expect(ownerResponse.body.review_tools.visible).toBe(true);

    expect(leadershipResponse.status).toBe(200);
    expect(leadershipResponse.body.role_mode).toBe("manage");
    expect(Array.isArray(leadershipResponse.body.summary_strip)).toBe(true);

    expect(officeResponse.status).toBe(403);
  });
});
