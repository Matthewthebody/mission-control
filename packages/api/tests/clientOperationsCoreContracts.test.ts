import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();

let leadershipToken = "";
let adminToken = "";
let photographerToken = "";

beforeAll(async () => {
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  adminToken = (await passwordLogin(app, "admin@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
});

describe("client operations core contracts", () => {
  it("serves the protected client operations core contract to leadership-facing roles", async () => {
    const response = await request(app)
      .get("/api/client-operations-core/contracts")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.domain_name).toBe("Client Operations Core");
    expect(response.body.architecture_choice).toMatch(/Mission Control/i);
    expect(
      response.body.canonical_entities.some(
        (entity: { entity: string; canonical_owner: string }) =>
          entity.entity === "Organization" && entity.canonical_owner === "Client Operations Core"
      )
    ).toBe(true);
    expect(
      response.body.relationship_rules.some(
        (rule: { from_entity: string; to_entity: string; relationship_rule: string }) =>
          rule.from_entity === "Shoot" &&
          rule.to_entity === "Contact" &&
          /exactly one primary Contact/i.test(rule.relationship_rule)
      )
    ).toBe(true);
    expect(
      response.body.warning_strategy.some(
        (warning: { warning_code: string; primary_surfaces: string[] }) =>
          warning.warning_code === "missing_active_agreement" &&
          warning.primary_surfaces.includes("Shoot detail")
      )
    ).toBe(true);
    expect(response.body.information_architecture.top_level_navigation).toEqual(
      expect.arrayContaining(["Dashboard", "Operations", "Clients / Organizations", "Reports", "Training", "Account"])
    );
  });

  it("allows admin but blocks photographers from the protected contract route", async () => {
    const adminResponse = await request(app)
      .get("/api/client-operations-core/contracts")
      .set("Authorization", `Bearer ${adminToken}`);
    const photographerResponse = await request(app)
      .get("/api/client-operations-core/contracts")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(adminResponse.status).toBe(200);
    expect(photographerResponse.status).toBe(403);
  });
});
