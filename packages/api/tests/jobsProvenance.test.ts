import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Phase 3C.1 Commit 2 — Jobs provenance backfill + curated demo. Proves the dry-run
// writes nothing and proposes seed_demo only on provable signals (a [marker]
// description, a *-DEMO-* number, or a conclusively demo tenant), that apply marks
// those rows (reversible here), that the curated-demo set is deterministic and keeps
// the explicitly-marked scenarios, and that apply is admin-gated.

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";
const ids: Record<string, string> = {};

async function login(email: string) {
  return (await request(app).post("/auth/dev-login").send({ email })).body.token as string;
}
// NULL-origin fixtures so they participate in the unmarked population the backfill scans.
async function makeNullJob(jobNumber: string, description: string | null): Promise<string> {
  const r = await dbPool.query(
    `INSERT INTO jobs (tenant_id, department_type, title, job_number, description_internal, data_origin)
     VALUES ($1,'sports','3C.1 provenance fixture',$2,$3,NULL) RETURNING id::text`,
    [tenantId, jobNumber, description]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`)).body.user.tenantId;

  ids.marked = await makeNullJob("PROV-MARK-1", "[mission_control_demo_v1] provenance marked fixture");
  ids.demoNumber = await makeNullJob("ZZ-DEMO-PROV-1", "ordinary description, demo number");
  ids.plain = await makeNullJob("PROV-PLAIN-1", "ordinary description, no signal");
});

afterAll(async () => {
  await dbPool.query(`DELETE FROM jobs WHERE tenant_id=$1 AND job_number IN ('PROV-MARK-1','ZZ-DEMO-PROV-1','PROV-PLAIN-1')`, [tenantId]);
});

function backfill(token: string, apply = false) {
  return request(app)
    .post(`/api/jobs/provenance/backfill${apply ? "?apply=true" : ""}`)
    .set("Authorization", `Bearer ${token}`);
}

describe("POST /api/jobs/provenance/backfill", () => {
  it("dry-run writes nothing and is the default", async () => {
    const before = (await dbPool.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1 AND data_origin IS NULL`, [tenantId])).rows[0].n;
    const res = await backfill(leadershipToken);
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    const after = (await dbPool.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1 AND data_origin IS NULL`, [tenantId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("proposes seed_demo from provable signals; demo tenant covers the remainder, none left to review", async () => {
    const body = (await backfill(leadershipToken)).body;
    expect(body.tenant_is_demo).toBe(true);
    expect(body.by_signal.marker_or_demo_number).toBeGreaterThanOrEqual(2); // at least the marker + the -DEMO- fixture
    // In a conclusively demo tenant every unmarked Job is proposed seed_demo; nothing is left as Review Required.
    expect(body.proposed_seed_demo).toBe(body.total_unmarked);
    expect(body.proposed_review_required).toBe(0);
  });

  it("apply marks provably-demo jobs (reversible) and is admin-gated", async () => {
    expect((await backfill(photographerToken, true)).status).toBe(403);
    const nullBefore: string[] = (await dbPool.query(`SELECT COALESCE(array_agg(id),'{}') a FROM jobs WHERE tenant_id=$1 AND data_origin IS NULL`, [tenantId])).rows[0].a;
    try {
      const res = await backfill(leadershipToken, true);
      expect(res.status).toBe(200);
      expect(res.body.dry_run).toBe(false);
      expect(res.body.applied_seed_demo).toBe(nullBefore.length);
      const marked = (await dbPool.query(`SELECT data_origin FROM jobs WHERE id = ANY($1::uuid[]) AND data_origin <> 'seed_demo'`, [[ids.marked, ids.demoNumber, ids.plain]])).rowCount;
      expect(marked).toBe(0); // all three (incl. the plain one, via the demo tenant) are now seed_demo
    } finally {
      if (nullBefore.length) await dbPool.query(`UPDATE jobs SET data_origin=NULL WHERE id = ANY($1::uuid[])`, [nullBefore]);
    }
  });
});

describe("curated demo selection", () => {
  it("is deterministic, bounded to the target, and keeps the explicitly-marked scenarios", async () => {
    const { getCuratedDemoJobIds, JOB_CURATED_DEMO_TARGET } = await import("../src/services/jobTruth/jobsProvenance.js");
    const a = await getCuratedDemoJobIds(dbPool as any, tenantId);
    const b = await getCuratedDemoJobIds(dbPool as any, tenantId);
    expect(a.size).toBeLessThanOrEqual(JOB_CURATED_DEMO_TARGET);
    expect([...a].sort()).toEqual([...b].sort()); // same DB state -> same ids
    expect(a.has(ids.marked)).toBe(true); // a [marker] scenario Job is always curated
  });
});
