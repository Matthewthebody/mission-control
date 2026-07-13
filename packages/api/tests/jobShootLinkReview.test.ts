import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Convergence slice 1 (MC-AUDIT-001 / audit prompt 6, owner-ratified 2026-07-13):
// the reviewed Job↔Shoot bridge. Proves (1) creating a Job against a known Shoot
// records a CONFIRMED link transactionally; (2) proposals are invisible to the
// canonical index until confirmed; (3) confirm/reject are leadership-gated with
// full audit events; (4) a Shoot can never gain two confirmed Jobs.

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";
let shootA = "";
let shootB = "";
let jobWithShoot = "";
let proposalJob = "";
let rivalJob = "";
const cleanupJobIds: string[] = [];

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function pickUnlinkedShoot(exclude: string[]): Promise<string> {
  const { rows } = await dbPool.query(
    `SELECT s.id::text FROM shoot s
     WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
       AND NOT (s.id::text = ANY($2::text[]))
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.legacy_shoot_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM job_shoot_links l WHERE l.tenant_id = s.tenant_id AND l.shoot_id = s.id AND l.status = 'confirmed')
     LIMIT 1`,
    [tenantId, exclude]
  );
  return rows[0].id;
}

async function insertFixtureJob(title: string): Promise<string> {
  const { rows } = await dbPool.query(
    `INSERT INTO jobs (tenant_id, department_type, title, job_status, scheduled_start_at)
     VALUES ($1, 'sports', $2, 'ready_to_staff', now() + interval '5 days') RETURNING id::text`,
    [tenantId, title]
  );
  cleanupJobIds.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");
  const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`);
  tenantId = me.body.user.tenantId as string;
  shootA = await pickUnlinkedShoot([]);
  shootB = await pickUnlinkedShoot([shootA]);
});

afterAll(async () => {
  if (cleanupJobIds.length > 0) {
    await dbPool.query(`DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, cleanupJobIds]);
  }
});

describe("Job↔Shoot reviewed links", () => {
  it("creating a Job with legacy_shoot_id records a CONFIRMED link + audit event transactionally", async () => {
    const created = await request(app)
      .post("/api/jobs/drafts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        department_type: "sports",
        title: "link-review-fixture-create",
        legacy_shoot_id: shootA
      });
    expect(created.status).toBe(201);
    jobWithShoot = created.body.job.id as string;
    cleanupJobIds.push(jobWithShoot);

    const link = await dbPool.query(
      `SELECT status, source, relationship_type FROM job_shoot_links WHERE tenant_id = $1 AND job_id = $2 AND shoot_id = $3`,
      [tenantId, jobWithShoot, shootA]
    );
    expect(link.rows[0]).toMatchObject({ status: "confirmed", source: "manual", relationship_type: "primary" });
    const events = await dbPool.query(
      `SELECT e.event_type FROM job_shoot_link_event e
       JOIN job_shoot_links l ON l.id = e.link_id
       WHERE e.tenant_id = $1 AND l.job_id = $2`,
      [tenantId, jobWithShoot]
    );
    expect(events.rows.map((r) => r.event_type)).toContain("confirmed");

    // Canonical index sees it as linked with labeled sources.
    const index = await request(app)
      .get(`/api/jobs/index?search=link-review-fixture-create&shoot_link_status=linked&limit=50`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const row = index.body.rows.find((r: { id: string }) => r.id === jobWithShoot);
    expect(row.shoot_link_status).toBe("linked");
    expect(row.linked_shoot_ids).toContain(shootA);
    expect(row.link_sources).toContain("job_shoot_links");
  });

  it("a PROPOSED link is invisible to the canonical index until a human confirms it", async () => {
    proposalJob = await insertFixtureJob("link-review-fixture-proposal");
    await dbPool.query(
      `INSERT INTO job_shoot_links (tenant_id, job_id, shoot_id, link_reason, relationship_type, source, status, confidence, reason)
       VALUES ($1, $2, $3, 'org_date_match', 'primary', 'suggested', 'proposed', 0.700, 'test proposal')`,
      [tenantId, proposalJob, shootB]
    );

    const before = await request(app)
      .get(`/api/jobs/index?search=link-review-fixture-proposal&limit=50`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const rowBefore = before.body.rows.find((r: { id: string }) => r.id === proposalJob);
    expect(rowBefore.shoot_link_status).toBe("unlinked");
    expect(rowBefore.linked_shoot_count).toBe(0);

    // The review queue shows it to leadership…
    const review = await request(app).get("/api/jobs/link-review").set("Authorization", `Bearer ${leadershipToken}`);
    expect(review.status).toBe(200);
    const proposal = review.body.proposals.find((p: { job_id: string }) => p.job_id === proposalJob);
    expect(proposal).toBeTruthy();
    expect(review.body.summary.proposed_count).toBeGreaterThanOrEqual(1);

    // …and is leadership-only.
    expect((await request(app).get("/api/jobs/link-review").set("Authorization", `Bearer ${photographerToken}`)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/jobs/link-review/${proposal.id}/confirm`)
          .set("Authorization", `Bearer ${photographerToken}`)
          .send({})
      ).status
    ).toBe(403);

    // Human confirm → the link becomes operational truth.
    const confirmed = await request(app)
      .post(`/api/jobs/link-review/${proposal.id}/confirm`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ note: "verified against the schedule" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.link.status).toBe("confirmed");
    expect(confirmed.body.link.reviewed_by_user_id).toBeTruthy();

    const after = await request(app)
      .get(`/api/jobs/index?search=link-review-fixture-proposal&shoot_link_status=linked&limit=50`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const rowAfter = after.body.rows.find((r: { id: string }) => r.id === proposalJob);
    expect(rowAfter.shoot_link_status).toBe("linked");
    expect(rowAfter.linked_shoot_ids).toContain(shootB);
  });

  it("a Shoot can never gain a second confirmed Job — the rival proposal 409s on confirm", async () => {
    rivalJob = await insertFixtureJob("link-review-fixture-rival");
    const rivalLink = await dbPool.query<{ id: string }>(
      `INSERT INTO job_shoot_links (tenant_id, job_id, shoot_id, link_reason, relationship_type, source, status, reason)
       VALUES ($1, $2, $3, 'org_date_match', 'primary', 'suggested', 'proposed', 'rival test proposal')
       RETURNING id::text`,
      [tenantId, rivalJob, shootB]
    );
    const response = await request(app)
      .post(`/api/jobs/link-review/${rivalLink.rows[0].id}/confirm`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(response.status).toBe(409);

    // Reject it instead — rejection is recorded, and the pair can never be
    // silently re-proposed (ON CONFLICT DO NOTHING in the proposal script).
    const rejected = await request(app)
      .post(`/api/jobs/link-review/${rivalLink.rows[0].id}/reject`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ note: "wrong shoot" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.link.status).toBe("rejected");

    const index = await request(app)
      .get(`/api/jobs/index?search=link-review-fixture-rival&limit=50`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const row = index.body.rows.find((r: { id: string }) => r.id === rivalJob);
    expect(row.shoot_link_status).toBe("unlinked");
  });

  it("confirm/reject refuse non-proposed links honestly", async () => {
    const confirmedLink = await dbPool.query<{ id: string }>(
      `SELECT id::text FROM job_shoot_links WHERE tenant_id = $1 AND job_id = $2 AND status = 'confirmed' LIMIT 1`,
      [tenantId, jobWithShoot]
    );
    const again = await request(app)
      .post(`/api/jobs/link-review/${confirmedLink.rows[0].id}/confirm`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(again.status).toBe(409);
    const unknown = await request(app)
      .post(`/api/jobs/link-review/00000000-0000-0000-0000-000000000000/reject`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(unknown.status).toBe(404);
  });
});
