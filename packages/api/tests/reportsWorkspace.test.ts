import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

let leadershipToken = "";
let photographerToken = "";

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
});

describe("reports workspace", () => {
  it("returns a server-backed reports workspace for leadership users", async () => {
    const response = await request(app)
      .get(`/api/dashboard/reports/workspace?date=${localDate}&period=monthly`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        anchor_date: localDate,
        period: "monthly",
        refresh_interval_seconds: expect.any(Number),
        operational_model: expect.objectContaining({
          summary_strip: expect.any(Array),
          watch: expect.objectContaining({
            trend: expect.any(Array)
          }),
          attendance: expect.objectContaining({
            trend: expect.any(Array)
          }),
          production: expect.objectContaining({
            trend: expect.any(Array)
          }),
          approvals: expect.objectContaining({
            trend: expect.any(Array)
          })
        }),
        delivery_summary: expect.objectContaining({
          saved_view_count: expect.any(Number),
          packet_template_count: expect.any(Number)
        }),
        history: expect.objectContaining({
          focus: "all",
          focus_options: expect.any(Array),
          items: expect.any(Array)
        })
      })
    );
  });

  it("filters the history slice without creating a second reporting truth", async () => {
    const response = await request(app)
      .get(`/api/dashboard/reports/workspace?date=${localDate}&period=monthly&focus=production`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.history.focus).toBe("production");
    expect(
      response.body.history.items.every((item: { focus: string }) => item.focus === "production")
    ).toBe(true);
  });

  it("keeps reports unavailable to standard employee shells", async () => {
    const response = await request(app)
      .get(`/api/dashboard/reports/workspace?date=${localDate}&period=monthly`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(403);
  });
});
