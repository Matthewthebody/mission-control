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

describe("profitability workspace", () => {
  it("serves a leadership-facing profitability workspace", async () => {
    const response = await request(app)
      .get("/api/profitability/workspace?date=2026-03-29&date_from=2026-03-01&date_to=2026-04-30")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.headline.title).toBe("Profitability");
    expect(Array.isArray(response.body.overview_cards)).toBe(true);
    expect(Array.isArray(response.body.watch_items)).toBe(true);
    expect(Array.isArray(response.body.operational_burden.rows)).toBe(true);
    expect(Array.isArray(response.body.breakdowns.by_department)).toBe(true);
    expect(response.body.data_health).toEqual(
      expect.objectContaining({
        summary_line: expect.any(String),
        cards: expect.any(Array)
      })
    );
    expect(
      response.body.overview_cards.some(
        (card: { label: string; action_hash: string }) =>
          card.label === "Overdue Production" && card.action_hash === "#production?queue=at_risk_queue&due_state=overdue"
      )
    ).toBe(true);
  });

  it("allows admin access but blocks field users", async () => {
    const adminResponse = await request(app)
      .get("/api/profitability/workspace")
      .set("Authorization", `Bearer ${adminToken}`);
    const photographerResponse = await request(app)
      .get("/api/profitability/workspace")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(adminResponse.status).toBe(200);
    expect(photographerResponse.status).toBe(403);
  });
});
