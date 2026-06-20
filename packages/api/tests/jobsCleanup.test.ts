import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyJobsCleanupArchival } from "../src/services/jobTruth/jobsCleanup.js";

// Phase 3C Commit 3 — safe Jobs cleanup dry-run. Proves it writes NO data, is stable
// on re-run, marks a synthetic dependency-free record purge-eligible, BLOCKS any
// record carrying a protected dependency, never merges on title alone, is tenant-
// scoped, and is admin-gated. There is no executor here — nothing is ever deleted.

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
  const vals = [tenantId, "sports", "3C cleanup fixture", "test_fixture", ...Object.values(fields)];
  const r = await dbPool.query(`INSERT INTO jobs (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id::text`, vals);
  return r.rows[0].id;
}
function dryRun(token: string) {
  return request(app).get("/api/jobs/cleanup/dry-run").set("Authorization", `Bearer ${token}`);
}
function find(report: any, id: string) {
  return report.candidates.find((c: any) => c.job_id === id);
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`)).body.user.tenantId;
  ids.adminUser = (await dbPool.query(`SELECT id::text FROM app_user WHERE email='leadership@example.com'`)).rows[0].id;

  // Purge-eligible: synthetic, no organization, no child records.
  ids.purge = await makeJob({ job_status: "draft", organization_id: null });
  // Synthetic but BLOCKED: carries a protected dependency (a readiness item).
  ids.blocked = await makeJob({ job_status: "draft", organization_id: null });
  await dbPool.query(`INSERT INTO job_readiness_items (tenant_id, job_id, section_key, label) VALUES ($1,$2,'general','dep')`, [tenantId, ids.blocked]);
  // Old + a dependency: age must not override the dependency block.
  ids.oldDeps = await makeJob({ job_status: "draft", organization_id: null, created_at: new Date(Date.now() - 400 * 86400000), updated_at: new Date(Date.now() - 400 * 86400000) });
  await dbPool.query(`INSERT INTO job_readiness_items (tenant_id, job_id, section_key, label) VALUES ($1,$2,'general','dep')`, [tenantId, ids.oldDeps]);
  // Curated demo: a synthetic record carrying a [marker] description is kept by the curated policy.
  ids.curated = await makeJob({ job_status: "draft", organization_id: null, description_internal: "[mission_control_demo_v1] curated scenario fixture" });
});

afterAll(async () => {
  await dbPool.query(`DELETE FROM jobs WHERE tenant_id=$1 AND data_origin='test_fixture'`, [tenantId]);
});

describe("GET /api/jobs/cleanup/dry-run", () => {
  it("(14) writes no data", async () => {
    const before = (await dbPool.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const res = await dryRun(leadershipToken);
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    const after = (await dbPool.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("(15) is stable on re-run", async () => {
    const a = (await dryRun(leadershipToken)).body;
    const b = (await dryRun(leadershipToken)).body;
    expect(b.total_jobs).toBe(a.total_jobs);
    expect(b.totals_by_action).toEqual(a.totals_by_action);
  });

  it("(16) marks a synthetic, dependency-free record purge-eligible", async () => {
    const report = (await dryRun(leadershipToken)).body;
    const c = find(report, ids.purge);
    expect(c.proposed_action).toBe("purge");
    expect(c.blocking_dependencies).toEqual([]);
    expect(report.hard_purge_candidates.some((x: any) => x.job_id === ids.purge)).toBe(true);
  });

  it("(3/17) blocks any record with a protected dependency from purge — age does not override", async () => {
    const report = (await dryRun(leadershipToken)).body;
    const blocked = find(report, ids.blocked);
    expect(blocked.proposed_action).not.toBe("purge");
    expect(blocked.blocking_dependencies).toContain("readiness_items");
    expect(blocked.warnings.length).toBeGreaterThan(0);
    const old = find(report, ids.oldDeps);
    expect(old.proposed_action).not.toBe("purge"); // 400 days old, but a dependency blocks it
  });

  it("(18) never merges on title — duplicate groups are exact job_number only, and no merge action exists", async () => {
    const report = (await dryRun(leadershipToken)).body;
    // All three fixtures share the same title but must NOT be grouped as duplicates.
    const titleGroup = report.duplicate_groups.find((g: any) => [ids.purge, ids.blocked, ids.oldDeps].every((id) => g.job_ids.includes(id)));
    expect(titleGroup).toBeUndefined();
    expect(report.candidates.every((c: any) => c.proposed_action !== "merge")).toBe(true);
  });

  it("(19) is tenant-scoped", async () => {
    const report = (await dryRun(leadershipToken)).body;
    expect(report.generated_for_tenant).toBe(tenantId);
    const dbCount = (await dbPool.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    expect(report.total_jobs).toBe(dbCount); // exactly this tenant's jobs, no more
  });

  it("(11) requires an administrative role", async () => {
    expect((await dryRun(photographerToken)).status).toBe(403);
  });
});

describe("GET /api/jobs/cleanup/dry-run — Phase 3C.1 provenance + curated actions", () => {
  it("keeps a marked synthetic record as curated demo, not purge", async () => {
    const report = (await dryRun(leadershipToken)).body;
    const c = find(report, ids.curated);
    expect(c.proposed_action).toBe("keep_curated_demo");
    expect(c.is_curated_demo).toBe(true);
    expect(report.hard_purge_candidates.some((x: any) => x.job_id === ids.curated)).toBe(false);
  });

  it("archives (not purges) a synthetic record with protected dependencies", async () => {
    const report = (await dryRun(leadershipToken)).body;
    const blocked = find(report, ids.blocked);
    expect(blocked.proposed_action).toBe("archive_excess_demo");
    expect(blocked.is_curated_demo).toBe(false);
  });

  it("reports proposed provenance and projected operating-view sizes", async () => {
    const report = (await dryRun(leadershipToken)).body;
    expect(report).toHaveProperty("tenant_is_demo");
    expect(report).toHaveProperty("curated_demo_count");
    expect(report).toHaveProperty("projected_default_view_total");
    expect(report).toHaveProperty("projected_demo_view_total");
    // The curated demo is hidden from the default view but visible with Show Demo Data.
    expect(report.projected_demo_view_total).toBeGreaterThanOrEqual(report.projected_default_view_total);
    expect(find(report, ids.purge).proposed_data_origin).toBe("test_fixture");
  });
});

describe("applyJobsCleanupArchival — archival-only executor", () => {
  it("archives non-curated demo, keeps curated, and NEVER deletes (rolled back)", async () => {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      // A plain seed_demo Job (no capability → not curated) and a marked scenario (curated).
      const plain = (await client.query(`INSERT INTO jobs (tenant_id,department_type,title,data_origin) VALUES ($1,'sports','apply-plain','seed_demo') RETURNING id::text`, [tenantId])).rows[0].id;
      const marked = (await client.query(`INSERT INTO jobs (tenant_id,department_type,title,description_internal,data_origin) VALUES ($1,'sports','apply-marked','[mission_control_demo_v1] scenario','seed_demo') RETURNING id::text`, [tenantId])).rows[0].id;
      const before = (await client.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      const auth = { authorityTier: "leadership", tenantId, id: ids.adminUser } as any;
      const report = await applyJobsCleanupArchival(client, auth);
      const after = (await client.query(`SELECT count(*)::int n FROM jobs WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      expect(after).toBe(before); // never deletes a row
      expect(report.hard_purged).toBe(0);
      expect(report.archived_excess_demo).toBeGreaterThan(0);
      expect(report.archive_reason).toBe("demo_curation_excess"); // the specified reason
      expect(report.batch_id).toMatch(/[0-9a-f-]{36}/); // one batch id
      expect(report.exported_candidates.length).toBe(report.archived_excess_demo); // IDs + snapshots exported
      // marked scenario is curated → kept visible; plain demo → archived with a reversible snapshot + batch trace
      expect((await client.query(`SELECT archived_at FROM jobs WHERE id=$1`, [marked])).rows[0].archived_at).toBeNull();
      const pl = (await client.query(`SELECT archived_at, job_status::text AS s, archive_reason, pre_archive_state->>'job_status' AS pj, pre_archive_state->>'demo_curation_batch_id' AS batch FROM jobs WHERE id=$1`, [plain])).rows[0];
      expect(pl.archived_at).not.toBeNull();
      expect(pl.s).toBe("archived");
      expect(pl.archive_reason).toBe("demo_curation_excess");
      expect(pl.pj).not.toBeNull(); // prior status snapshotted → restore can reverse it
      expect(pl.batch).toBe(report.batch_id); // traceable to the batch
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("requires an administrative role", async () => {
    const client = await dbPool.connect();
    try {
      const auth = { authorityTier: "standard_employee", tenantId, id: ids.adminUser } as any;
      await expect(applyJobsCleanupArchival(client, auth)).rejects.toMatchObject({ status: 403 });
    } finally {
      client.release();
    }
  });
});
