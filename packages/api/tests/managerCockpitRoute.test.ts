import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let adminToken = "";
let leadershipToken = "";
let officeToken = "";
let photographerToken = "";
let queueDate = "";

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  officeToken = (await devLogin(app, "office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  queueDate =
    (
      await pool.query(
        "SELECT shoot_date::text AS shoot_date FROM shoot WHERE deleted_at IS NULL ORDER BY shoot_date ASC LIMIT 1"
      )
    ).rows[0]?.shoot_date ?? new Date().toISOString().slice(0, 10);
});

describe("manager cockpit route", () => {
  it("requires auth", async () => {
    const response = await request(app).get(`/api/dashboard/manager-cockpit?date=${queueDate}`);
    expect(response.status).toBe(401);
  });

  it("returns the canonical manager cockpit projection contract", async () => {
    const response = await request(app)
      .get(`/api/dashboard/manager-cockpit?date=${queueDate}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.anchor_date).toBe(queueDate);
    expect(response.body.headline).toBe("Manager action queue");
    expect(response.body.summary).toEqual(
      expect.objectContaining({
        total_open: expect.any(Number),
        needs_staffing: expect.any(Number),
        needs_contact_cleanup: expect.any(Number),
        needs_approval: expect.any(Number),
        needs_follow_up: expect.any(Number),
        needs_project_setup: expect.any(Number),
        needs_project_follow_up: expect.any(Number),
        overdue_project_tasks: expect.any(Number),
        needs_payroll_compliance_review: expect.any(Number)
      })
    );
    expect(response.body.queues.map((queue: { id: string }) => queue.id)).toEqual([
      "needs_staffing",
      "needs_contact_cleanup",
      "needs_approval",
      "needs_follow_up",
      "needs_project_setup",
      "needs_project_follow_up",
      "overdue_project_tasks",
      "needs_payroll_compliance_review"
    ]);

    const firstItem = response.body.queues
      .flatMap((queue: { items: unknown[] }) => queue.items)
      .find((item: unknown) => Boolean(item));

    if (firstItem) {
      expect(firstItem).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          entity_kind: expect.any(String),
          title: expect.any(String),
          summary: expect.any(String),
          owner_label: expect.any(String),
          status_label: expect.any(String),
          status_tone: expect.any(String),
          next_action: expect.any(String),
          action_hash: expect.any(String),
          flags: expect.any(Array)
        })
      );
    }
  }, 15000);

  it("keeps the owner-command compatibility alias pointed at the canonical manager cockpit payload", async () => {
    const [managerCockpitResponse, ownerCommandResponse] = await Promise.all([
      request(app)
        .get(`/api/dashboard/manager-cockpit?date=${queueDate}`)
        .set("Authorization", `Bearer ${adminToken}`),
      request(app)
        .get(`/api/dashboard/owner-command?date=${queueDate}`)
        .set("Authorization", `Bearer ${adminToken}`)
    ]);

    expect(ownerCommandResponse.status).toBe(200);
    expect(ownerCommandResponse.body).toEqual(
      expect.objectContaining({
        ...managerCockpitResponse.body,
        generated_at: expect.any(String)
      })
    );
    expect(ownerCommandResponse.body.summary).toEqual(managerCockpitResponse.body.summary);
    expect(ownerCommandResponse.body.queues).toEqual(managerCockpitResponse.body.queues);
  }, 15000);
});

describe("manager cockpit authorization (MC-AUDIT-002 regression)", () => {
  it("allows leadership to load the cockpit and owner-command alias", async () => {
    const [cockpit, ownerCommand] = await Promise.all([
      request(app).get(`/api/dashboard/manager-cockpit?date=${queueDate}`).set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get(`/api/dashboard/owner-command?date=${queueDate}`).set("Authorization", `Bearer ${leadershipToken}`)
    ]);
    expect(cockpit.status).toBe(200);
    expect(ownerCommand.status).toBe(200);
  }, 15000);

  it("denies office/customer-service users the company-wide cockpit", async () => {
    const [cockpit, ownerCommand] = await Promise.all([
      request(app).get(`/api/dashboard/manager-cockpit?date=${queueDate}`).set("Authorization", `Bearer ${officeToken}`),
      request(app).get(`/api/dashboard/owner-command?date=${queueDate}`).set("Authorization", `Bearer ${officeToken}`)
    ]);
    expect(cockpit.status).toBe(403);
    expect(ownerCommand.status).toBe(403);
  }, 15000);

  it("denies photographers the company-wide cockpit", async () => {
    const [cockpit, ownerCommand] = await Promise.all([
      request(app).get(`/api/dashboard/manager-cockpit?date=${queueDate}`).set("Authorization", `Bearer ${photographerToken}`),
      request(app).get(`/api/dashboard/owner-command?date=${queueDate}`).set("Authorization", `Bearer ${photographerToken}`)
    ]);
    expect(cockpit.status).toBe(403);
    expect(ownerCommand.status).toBe(403);
  }, 15000);

  it("keeps the home dashboard working for office users without leaking payroll/compliance queues", async () => {
    const response = await request(app)
      .get(`/api/dashboard/home?date=${queueDate}`)
      .set("Authorization", `Bearer ${officeToken}`);
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("needs_payroll_compliance_review");
    expect(serialized).not.toContain("Payroll blocking");
    expect(serialized).not.toContain("Resolve payroll blockers");
  }, 20000);

  it("keeps the direct payroll-review route closed to office users", async () => {
    const response = await request(app)
      .get(`/api/attendance/payroll-review`)
      .set("Authorization", `Bearer ${officeToken}`);
    expect(response.status).toBe(403);
  }, 15000);
});
