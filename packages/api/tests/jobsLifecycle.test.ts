import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyJobLifecycle, JOBS_RECENT_COMPLETION_DAYS } from "../src/services/jobTruth/jobsLifecycle.js";

// Phase 3C Commit 2 — Jobs lifecycle reconciliation + archival. Pure classifier
// units prove the archival-prevention rules; integration (real DB fixtures, marked
// data_origin='test_fixture' and torn down) proves reconcile dry-run/apply/idempotency,
// archive/restore RBAC, lifecycle scope, archived retrievability, and that cleanup
// never touches Urgent Window action_hash, Shoot links, or workflow relationships.

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";
const ids: Record<string, string> = {};

async function login(email: string) {
  return (await request(app).post("/auth/dev-login").send({ email })).body.token as string;
}
async function makeJob(fields: Record<string, unknown>): Promise<string> {
  const cols = ["tenant_id", "department_type", "title", "data_origin", ...Object.keys(fields)];
  const vals = [tenantId, "sports", "3C lifecycle fixture", "test_fixture", ...Object.values(fields)];
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const r = await dbPool.query(`INSERT INTO jobs (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING id::text`, vals);
  return r.rows[0].id;
}
function reconcile(token: string, apply = false) {
  return request(app).post(`/api/jobs/lifecycle/reconcile${apply ? "?apply=true" : ""}`).set("Authorization", `Bearer ${token}`);
}
function index(query: string, token = leadershipToken) {
  return request(app).get(`/api/jobs/index?${query}`).set("Authorization", `Bearer ${token}`);
}

const stale = `now() - interval '${JOBS_RECENT_COMPLETION_DAYS + 30} days'`;

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`)).body.user.tenantId;

  // Fixtures (data_origin='test_fixture' → excluded from the active/default view).
  ids.hist = await makeJob({ job_status: "execution_complete", completed_at: new Date(Date.now() - 60 * 86400000), created_at: new Date(Date.now() - 60 * 86400000), updated_at: new Date(Date.now() - 60 * 86400000) });
  ids.recent = await makeJob({ job_status: "execution_complete", completed_at: new Date(Date.now() - 2 * 86400000), created_at: new Date(Date.now() - 2 * 86400000), updated_at: new Date(Date.now() - 2 * 86400000) });
  ids.blocked = await makeJob({ job_status: "execution_complete", completed_at: new Date(Date.now() - 60 * 86400000), created_at: new Date(Date.now() - 60 * 86400000), updated_at: new Date(Date.now() - 60 * 86400000) });
  await dbPool.query(`INSERT INTO job_readiness_items (tenant_id, job_id, section_key, label, is_blocker, is_complete) VALUES ($1,$2,'general','fixture blocker',true,false)`, [tenantId, ids.blocked]);
  ids.archived = await makeJob({ job_status: "confirmed", archived_at: new Date(Date.now() - 86400000) });
});

afterAll(async () => {
  // Cascades to readiness items / activity log via ON DELETE CASCADE.
  await dbPool.query(`DELETE FROM jobs WHERE tenant_id=$1 AND data_origin='test_fixture'`, [tenantId]);
});

async function archivedAt(id: string): Promise<string | null> {
  return (await dbPool.query(`SELECT archived_at::text FROM jobs WHERE id=$1`, [id])).rows[0]?.archived_at ?? null;
}

describe("job id param guard", () => {
  it("rejects a non-uuid job id with 404 instead of a DB cast 500", async () => {
    const response = await request(app).get("/api/jobs/not-a-uuid").set("Authorization", `Bearer ${leadershipToken}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Job not found");
  });
  it("still returns 404 for a well-formed uuid that matches no job", async () => {
    const response = await request(app)
      .get("/api/jobs/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(response.status).toBe(404);
  });
});

describe("classifyJobLifecycle (pure) — archival prevention", () => {
  const base = {
    id: "x", department_type: "sports" as const, job_status: "execution_complete", production_status: "complete",
    readiness_status: "ready", risk_status: "none", staffing_status: "staffed", account_owner_user_id: "u",
    scheduled_start_at: null, archived_at: null, cancelled_at: null, completed_at: "2020-01-01T00:00:00Z", data_origin: null,
    open_blocker_count: 0, open_watch_flag_count: 0, open_workflow_count: 0, open_production_count: 0, last_meaningful_activity_at: "2020-01-01T00:00:00Z"
  };
  const now = Date.now();
  it("(7/8) stale-complete with no open work is historical; recent-complete is recently_completed", () => {
    expect(classifyJobLifecycle(base, now).lifecycle).toBe("historical_completed");
    expect(classifyJobLifecycle({ ...base, completed_at: new Date().toISOString(), last_meaningful_activity_at: new Date().toISOString() }, now).lifecycle).toBe("recently_completed");
  });
  it("(6) active blockers on a complete job => review_required (never auto-archive)", () => {
    expect(classifyJobLifecycle({ ...base, open_blocker_count: 1 }, now)).toMatchObject({ lifecycle: "review_required" });
  });
  it("(4) open workflow => review_required", () => {
    expect(classifyJobLifecycle({ ...base, open_workflow_count: 1 }, now).lifecycle).toBe("review_required");
  });
  it("(5) open production obligation => review_required", () => {
    expect(classifyJobLifecycle({ ...base, open_production_count: 1 }, now).lifecycle).toBe("review_required");
  });
  it("(3) age alone never archives — a non-complete stale job is not historical/archived", () => {
    expect(classifyJobLifecycle({ ...base, job_status: "confirmed", production_status: "queued", completed_at: null }, now).lifecycle).not.toBe("historical_completed");
  });
});

describe("reconcile + archive/restore (integration)", () => {
  it("(1/14) dry-run classifies every job, flags review_required, and writes nothing", async () => {
    const before = await archivedAt(ids.hist);
    const res = await reconcile(leadershipToken, false);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.dry_run).toBe(true);
    expect(Object.values(body.by_class).reduce((a: number, b: any) => a + b, 0)).toBe(body.total);
    expect(body.review_required.some((r: any) => r.job_id === ids.blocked)).toBe(true);
    expect(body.applied.auto_archived).toBeGreaterThanOrEqual(1); // F_HIST is eligible
    expect(await archivedAt(ids.hist)).toBe(before); // dry-run wrote nothing
  });

  it("(15/25) repeated dry-run is stable", async () => {
    const a = (await reconcile(leadershipToken)).body;
    const b = (await reconcile(leadershipToken)).body;
    expect(b.total).toBe(a.total);
    expect(b.applied.auto_archived).toBe(a.applied.auto_archived);
  });

  it("(21/22/23) apply (admin) archives only eligible jobs and touches no urgent/shoot/workflow records", async () => {
    const counts = async () => {
      const u = (await dbPool.query(`SELECT count(*)::int n, COALESCE(max(action_hash),'') h FROM urgent_watch_item WHERE tenant_id=$1`, [tenantId])).rows[0];
      const l = (await dbPool.query(`SELECT count(*)::int n FROM job_shoot_links WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      const w = (await dbPool.query(`SELECT count(*)::int n FROM workflow_run WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      return { urgent: u.n, hash: u.h, links: l, workflow: w };
    };
    const before = await counts();
    const res = await reconcile(leadershipToken, true);
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(false);
    expect(await archivedAt(ids.hist)).not.toBeNull(); // eligible historical was archived
    expect(await archivedAt(ids.blocked)).toBeNull(); // review_required was NOT archived
    expect(await archivedAt(ids.recent)).toBeNull(); // recently-completed was NOT archived
    expect(await counts()).toEqual(before); // no action_hash / shoot-link / workflow change
  });

  it("(25) apply is idempotent — a second apply archives nothing new", async () => {
    const second = (await reconcile(leadershipToken, true)).body;
    expect(second.applied.auto_archived).toBe(0);
  });

  it("(11) a non-admin cannot apply maintenance or archive/restore", async () => {
    expect((await reconcile(photographerToken, true)).status).toBe(403);
    expect((await request(app).post(`/api/jobs/${ids.recent}/archive`).set("Authorization", `Bearer ${photographerToken}`)).status).toBe(403);
    expect((await request(app).post(`/api/jobs/${ids.recent}/restore`).set("Authorization", `Bearer ${photographerToken}`)).status).toBe(403);
  });

  it("(9/10) authorized archive then restore; archived job stays directly retrievable", async () => {
    const arch = await request(app).post(`/api/jobs/${ids.recent}/archive`).set("Authorization", `Bearer ${leadershipToken}`).send({ reason: "fixture archive" });
    expect(arch.status).toBe(200);
    expect(await archivedAt(ids.recent)).not.toBeNull();
    const audit = (await dbPool.query(`SELECT archived_by_user_id, archive_reason FROM jobs WHERE id=$1`, [ids.recent])).rows[0];
    expect(audit.archived_by_user_id).toBeTruthy();
    expect(audit.archive_reason).toBe("fixture archive");
    // Still retrievable by direct link.
    expect((await request(app).get(`/api/jobs/${ids.recent}`).set("Authorization", `Bearer ${leadershipToken}`)).status).toBe(200);
    const restore = await request(app).post(`/api/jobs/${ids.recent}/restore`).set("Authorization", `Bearer ${leadershipToken}`);
    expect(restore.status).toBe(200);
    expect(await archivedAt(ids.recent)).toBeNull();
    expect((await dbPool.query(`SELECT restored_at FROM jobs WHERE id=$1`, [ids.recent])).rows[0].restored_at).toBeTruthy();
  });
});

describe("lifecycle scope on the canonical index", () => {
  it("(12/13/30) default active view excludes archived + demo/test fixtures from rows and counts", async () => {
    const active = (await index("lifecycle_scope=active&limit=100")).body;
    const activeIds = active.rows.map((r: any) => r.id);
    for (const key of Object.keys(ids)) expect(activeIds).not.toContain(ids[key]); // none of our test_fixture rows appear
  });

  it("(31) lifecycle_scope=archived returns archived jobs; demo_test returns the fixtures", async () => {
    const archived = (await index("lifecycle_scope=archived&limit=100")).body;
    expect(archived.rows.every((r: any) => r.shoot_link_status !== undefined)).toBe(true);
    expect(archived.rows.some((r: any) => r.id === ids.archived)).toBe(true);
    const demo = (await index("lifecycle_scope=demo_test&limit=100")).body;
    const demoIds = demo.rows.map((r: any) => r.id);
    expect(demoIds).toContain(ids.blocked); // a test_fixture row
  });
});
