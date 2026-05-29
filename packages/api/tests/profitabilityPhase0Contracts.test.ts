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

describe("profitability phase 0 contracts", () => {
  it("serves the protected profitability contract to leadership-facing roles", async () => {
    const response = await request(app)
      .get("/api/profitability/contracts")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.domain_name).toBe("Profitability");
    expect(response.body.architecture_choice).toMatch(/Mission Control/i);
    expect(response.body.identity_rules.some((rule: { identity: string; canonical_source: string }) => rule.identity === "account_id" && rule.canonical_source === "Organization.id")).toBe(true);
    expect(response.body.api_surface_proposal.some((route: { route_group: string }) => route.route_group === "/api/profitability/employee")).toBe(true);

    const employeeSafeKeys = response.body.dictionary
      .filter((entry: { visibility: string }) => entry.visibility === "employee_safe")
      .map((entry: { key: string }) => entry.key);

    expect(employeeSafeKeys).toEqual(
      expect.arrayContaining([
        "on_time_rate",
        "clock_exception_rate",
        "setup_photo_completion_rate",
        "post_shoot_evaluation_completion_rate",
        "shoot_readiness_signal"
      ])
    );
    expect(employeeSafeKeys).not.toEqual(
      expect.arrayContaining([
        "gross_revenue",
        "contribution_margin",
        "fully_loaded_margin",
        "profit_per_subject",
        "profit_per_labor_hour"
      ])
    );
  });

  it("allows admin but blocks field users from the leadership profitability contract", async () => {
    const adminResponse = await request(app)
      .get("/api/profitability/contracts")
      .set("Authorization", `Bearer ${adminToken}`);
    const photographerResponse = await request(app)
      .get("/api/profitability/contracts")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(adminResponse.status).toBe(200);
    expect(photographerResponse.status).toBe(403);
  });
});
