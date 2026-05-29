import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let adminToken = "";
let queueDate = "";

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  queueDate = (
    await pool.query("SELECT shoot_date::text AS shoot_date FROM shoot WHERE shoot_code = 'DEMO-002' LIMIT 1")
  ).rows[0].shoot_date;
});

describe("live shoot queue route", () => {
  it("requires auth", async () => {
    const response = await request(app).get(`/api/shoots/live-queue?date=${queueDate}`);
    expect(response.status).toBe(401);
  });

  it("returns the canonical live queue projection contract", async () => {
    const response = await request(app)
      .get(`/api/shoots/live-queue?date=${queueDate}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.date).toBe(queueDate);
    expect(response.body.summary).toEqual(
      expect.objectContaining({
        in_view: expect.any(Number),
        needs_staffing: expect.any(Number),
        needs_review: expect.any(Number),
        unscheduled: expect.any(Number),
        scheduled: expect.any(Number),
        completed: expect.any(Number)
      })
    );
    expect(response.body.sections.map((section: { id: string }) => section.id)).toEqual([
      "needs_staffing",
      "needs_review",
      "unscheduled",
      "scheduled",
      "completed"
    ]);

    const firstEntry = response.body.sections
      .flatMap((section: { items: unknown[] }) => section.items)
      .find((entry: unknown) => Boolean(entry));

    expect(firstEntry).toEqual(
      expect.objectContaining({
        bucket: expect.any(String),
        bucket_label: expect.any(String),
        status_label: expect.any(String),
        status_tone: expect.any(String),
        next_action: expect.any(String),
        summary_string: expect.any(String),
        owner_label: expect.any(String),
        key_flags: expect.any(Array),
        staffing_summary: expect.objectContaining({
          label: expect.any(String),
          tone: expect.any(String)
        }),
        sync_summary: expect.objectContaining({
          label: expect.any(String),
          tone: expect.any(String)
        }),
        shoot: expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String)
        })
      })
    );
  });
});
