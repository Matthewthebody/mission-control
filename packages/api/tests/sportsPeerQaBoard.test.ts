import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Express;
let dbPool: Pool;
let token = "";
let tenantId = "";

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  const { seedSportsPeerQaDemoData } = await import("../scripts/seed-mission-control-demo.js");
  app = createApp();
  dbPool = pool;
  token = await login("leadership@example.com");
  const tenant = await dbPool.query<{ id: string }>("SELECT id::text FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0]?.id ?? "";
  expect(tenantId).toBeTruthy();
  await seedSportsPeerQaDemoData();
});

describe("Sports peer QA board", () => {
  it("loads Sports QA jobs with status summaries and filters out non-Sports jobs", async () => {
    const response = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.summary.ready_for_owner_qa).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.ready_for_peer_qa).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.corrections_needed).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.ready_for_spencer_review).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.blocked_waiting).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.approved_for_release).toBeGreaterThanOrEqual(1);
    expect(response.body.items.every((item: any) => item.job_name.includes("School"))).toBe(false);

    const productionIds = response.body.items.map((item: any) => item.production_item_id);
    const departmentRows = await dbPool.query<{ department_type: string }>(
      `
        SELECT DISTINCT job.department_type::text
        FROM production_items item
        JOIN jobs job ON job.id = item.job_id
        WHERE item.tenant_id = $1
          AND item.id = ANY($2::uuid[])
      `,
      [tenantId, productionIds]
    );
    expect(departmentRows.rows.map((row) => row.department_type)).toEqual(["sports"]);
  });

  it("returns detail-ready summary, corrections, blockers, and release packet metadata", async () => {
    const response = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const correction = response.body.items.find((item: any) => item.qa_status === "corrections_needed");
    expect(correction).toMatchObject({
      correction_category: "file_structure"
    });
    expect(correction.owner_checklist.length).toBeGreaterThan(0);
    expect(correction.peer_checklist.length).toBeGreaterThan(0);
    expect(correction.conditional_checklist.some((item: any) => /Buddy/i.test(item.label))).toBe(true);

    const blocked = response.body.items.find((item: any) => item.qa_status === "blocked_waiting");
    expect(blocked.blocker_reason).toBe("waiting_on_second_shoot_day");
    expect(blocked.blocker_owner).toBe("Photography");

    const approved = response.body.items.find((item: any) => item.qa_status === "approved_for_release");
    expect(approved.release_packet.approved_for_release).toBe(true);
    expect(approved.approved_for_release_at).toBeTruthy();
  });

  it("renders conditional sections for virtual teams and buddy photos in the API read model", async () => {
    const response = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const virtualTeams = response.body.items.find((item: any) => item.sports_job_type === "virtual_teams");
    const buddyPhotos = response.body.items.find((item: any) => item.sports_job_type === "buddy_photos");

    expect(virtualTeams.conditional_checklist.map((item: any) => item.label)).toEqual(expect.arrayContaining(["Virtual teams built"]));
    expect(buddyPhotos.conditional_checklist.map((item: any) => item.label)).toEqual(
      expect.arrayContaining(["Buddy images moved to correct individual galleries"])
    );
  });

  it("updates Sports peer QA status using the existing status model", async () => {
    const board = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const review = board.body.items.find((item: any) => item.qa_status === "ready_for_owner_qa");
    expect(review).toBeTruthy();

    const response = await request(app)
      .patch(`/api/sports/peer-qa/${review.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ qa_status: "owner_qa_in_progress" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.id).toBe(review.id);
    expect(response.body.qa_status).toBe("owner_qa_in_progress");
    expect(response.body.approved_for_release_at).toBeNull();
  });

  it("updates lightweight correction and blocker fields", async () => {
    const board = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const review = board.body.items.find((item: any) => item.qa_status === "corrections_needed");
    expect(review).toBeTruthy();

    const response = await request(app)
      .patch(`/api/sports/peer-qa/${review.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        correction_category: "gallery_setup",
        correction_notes: "Peer found two galleries that need title cleanup before release.",
        blocker_reason: "waiting_on_owner_fix",
        blocker_owner: "Production Owner",
        blocker_notes: "Owner has the ball for gallery title cleanup."
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.correction_category).toBe("gallery_setup");
    expect(response.body.blocker_reason).toBe("waiting_on_owner_fix");
    expect(response.body.blocker_owner).toBe("Production Owner");
  });

  it("mutates JSON checklist items without changing the checklist schema", async () => {
    const board = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const review = board.body.items.find((item: any) => item.owner_checklist.some((check: any) => !check.complete));
    expect(review).toBeTruthy();
    const check = review.owner_checklist.find((item: any) => !item.complete);

    const response = await request(app)
      .patch(`/api/sports/peer-qa/${review.id}/checklist`)
      .set("Authorization", `Bearer ${token}`)
      .send({ section: "owner", label: check.label, complete: true });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.owner_checklist.find((item: any) => item.label === check.label).complete).toBe(true);
  });

  it("stamps Spencer approval in a lightweight release packet update", async () => {
    const board = await request(app).get("/api/sports/peer-qa").set("Authorization", `Bearer ${token}`);
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const review = board.body.items.find((item: any) => item.qa_status === "ready_for_spencer_review");
    expect(review).toBeTruthy();

    const response = await request(app)
      .post(`/api/sports/peer-qa/${review.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ approved_by: "Spencer" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.qa_status).toBe("approved_for_release");
    expect(response.body.approved_for_release_at).toBeTruthy();
    expect(response.body.release_packet.spencer_review_complete).toBe(true);
    expect(response.body.release_packet.approved_for_release).toBe(true);
  });

  it("rejects invalid Sports peer QA updates", async () => {
    const invalidStatus = await request(app)
      .patch("/api/sports/peer-qa/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`)
      .send({ qa_status: "made_up_status" });
    expect(invalidStatus.status).toBe(400);

    const missingReview = await request(app)
      .patch("/api/sports/peer-qa/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`)
      .send({ qa_status: "ready_for_peer_qa" });
    expect(missingReview.status).toBe(404);
  });
});
