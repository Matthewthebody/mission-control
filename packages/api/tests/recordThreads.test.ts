import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// SSA-5 Record Threads V1 (migration 168): one conversation per record.
// Proves: get-or-create thread on first post; ordered listing with author
// names; mention fan-out rides the notification outbox; canViewRecords gating;
// honest validation; and that a failed Teams-meeting launch never leaves a
// stray system event (transactional).

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";
let fixtureJobId = "";
let organizationId = "";
let mentionUserId = "";

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
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
  mentionUserId = (
    await dbPool.query<{ id: string }>(`SELECT id::text FROM app_user WHERE tenant_id = $1 AND lower(email) = 'admin@example.com'`, [tenantId])
  ).rows[0].id;
  fixtureJobId = (
    await dbPool.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, department_type, title, job_status, scheduled_start_at, data_origin)
       VALUES ($1, 'schools', 'record-thread-fixture-job', 'confirmed', now() + interval '3 days', 'test_fixture')
       RETURNING id::text`,
      [tenantId]
    )
  ).rows[0].id;
  organizationId = (
    await dbPool.query<{ id: string }>(`SELECT id::text FROM organization WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId])
  ).rows[0].id;
});

afterAll(async () => {
  await dbPool.query(
    `DELETE FROM record_thread WHERE tenant_id = $1 AND ((entity_type = 'job' AND entity_id = $2) OR (entity_type = 'organization' AND entity_id = $3))`,
    [tenantId, fixtureJobId, organizationId]
  );
  await dbPool.query(`DELETE FROM jobs WHERE tenant_id = $1 AND id = $2`, [tenantId, fixtureJobId]);
});

describe("record threads", () => {
  it("an untouched record has an honest empty thread view", async () => {
    const view = await request(app)
      .get(`/api/record-threads/job/${fixtureJobId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(view.status).toBe(200);
    expect(view.body.thread_id).toBeNull();
    expect(view.body.messages).toEqual([]);
    expect(view.body.entity_label).toBe("record-thread-fixture-job");
  });

  it("posting creates the thread, lists in order with author names, and mentions ride the outbox", async () => {
    const first = await request(app)
      .post(`/api/record-threads/job/${fixtureJobId}/messages`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ body: "Roster confirmed with the school office.", mention_user_ids: [mentionUserId] });
    expect(first.status).toBe(201);
    expect(first.body.thread_id).toBeTruthy();
    expect(first.body.messages).toHaveLength(1);
    expect(first.body.messages[0].message_kind).toBe("user_message");
    expect(first.body.messages[0].author_name).toBeTruthy();
    expect(first.body.messages[0].mention_user_ids).toContain(mentionUserId);

    const second = await request(app)
      .post(`/api/record-threads/job/${fixtureJobId}/messages`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ body: "Second note — same thread." });
    expect(second.status).toBe(201);
    expect(second.body.thread_id).toBe(first.body.thread_id);
    expect(second.body.messages).toHaveLength(2);
    expect(second.body.messages[1].body).toBe("Second note — same thread.");

    // The mention rides the existing notification outbox with a dedupe key
    // (the dispatcher suffixes the recipient id per fan-out row).
    const outbox = await dbPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app_event WHERE tenant_id = $1 AND dedupe_key LIKE $2`,
      [tenantId, `record_thread.mention:${first.body.messages[0].id}:%`]
    );
    expect(outbox.rows[0].n).toBe(1);
  });

  it("organization records carry their own thread", async () => {
    const posted = await request(app)
      .post(`/api/record-threads/organization/${organizationId}/messages`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ body: "Org-level note for the account team." });
    expect(posted.status).toBe(201);
    expect(posted.body.entity_type).toBe("organization");
    expect(posted.body.messages.some((m: { body: string | null }) => m.body === "Org-level note for the account team.")).toBe(true);
  });

  it("gates on canViewRecords — a photographer without organization.read gets 403", async () => {
    const denied = await request(app)
      .get(`/api/record-threads/organization/${organizationId}`)
      .set("Authorization", `Bearer ${photographerToken}`);
    expect(denied.status).toBe(403);
    const deniedPost = await request(app)
      .post(`/api/record-threads/organization/${organizationId}/messages`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({ body: "should not land" });
    expect(deniedPost.status).toBe(403);
  });

  it("validates honestly: empty body 400, unknown record 404, bad type 400s", async () => {
    expect(
      (
        await request(app)
          .post(`/api/record-threads/job/${fixtureJobId}/messages`)
          .set("Authorization", `Bearer ${leadershipToken}`)
          .send({ body: "   " })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`/api/record-threads/job/00000000-0000-0000-0000-000000000000`)
          .set("Authorization", `Bearer ${leadershipToken}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/record-threads/shoot/${fixtureJobId}`)
          .set("Authorization", `Bearer ${leadershipToken}`)
      ).status
    ).toBeGreaterThanOrEqual(400);
  });

  it("a failed Teams-meeting launch leaves NO stray system event (transactional)", async () => {
    const before = await dbPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM record_thread_message m
       JOIN record_thread t ON t.id = m.thread_id
       WHERE m.tenant_id = $1 AND t.entity_id = $2 AND m.message_kind = 'system_event'`,
      [tenantId, fixtureJobId]
    );
    const launch = await request(app)
      .post(`/api/record-threads/job/${fixtureJobId}/meeting`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ title: "Thread meeting" });
    // In this environment the organizer has no linked Microsoft identity (or
    // meetings are disabled), so the launch must fail honestly...
    expect(launch.status).toBeGreaterThanOrEqual(400);
    // ...and the transaction must roll the system event back with it.
    const after = await dbPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM record_thread_message m
       JOIN record_thread t ON t.id = m.thread_id
       WHERE m.tenant_id = $1 AND t.entity_id = $2 AND m.message_kind = 'system_event'`,
      [tenantId, fixtureJobId]
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
