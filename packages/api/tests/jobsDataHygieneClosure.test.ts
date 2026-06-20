import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Phase 3C.1 Commit 6 — closing verification across the data-hygiene + deep-link work.
// End-to-end checks that tie the pieces together: the Show Demo Data invariant, the
// quick-view ↔ index row parity, the provenance partition (NULL-safe), the cleanup
// projection coherence, and the off-page deep-link behavior. Read-only; no hard delete.

let app: Express;
let dbPool: Pool;
let token = "";
let tenantId = "";

async function login(email: string) {
  return (await request(app).post("/auth/dev-login").send({ email })).body.token as string;
}
const get = (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`);
const post = (path: string) => request(app).post(path).set("Authorization", `Bearer ${token}`);

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  token = await login("leadership@example.com");
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.user.tenantId;
});

describe("Jobs data hygiene + deep-link closure", () => {
  it("(C1) the summary===page invariant survives the demo_view=all state for every available metric", async () => {
    const base = (await get("/api/jobs/index?limit=1&demo_view=all")).body;
    const available = base.summary.metrics.filter((m: any) => m.available);
    expect(available.length).toBeGreaterThan(0);
    for (const metric of available) {
      const filtered = (await get(`/api/jobs/index?limit=1&demo_view=all&metric=${metric.key}`)).body;
      expect(filtered.page.total).toBe(metric.count); // rows and counts move together under the demo state
    }
  });

  it("(C2) the quick view returns the same canonical shape as an index row (shared projection)", async () => {
    const row = (await get("/api/jobs/index?limit=1")).body.rows[0];
    const qv = (await get(`/api/jobs/quick-view/${row.id}`)).body.row;
    expect(qv.id).toBe(row.id);
    for (const key of ["job_status", "shoot_link_status", "workflow_run_count", "production_item_count", "attention_reasons", "operational_link_explanation"]) {
      expect(qv).toHaveProperty(key);
    }
  });

  it("(C3) provenance dry-run partitions every unmarked Job (no rows lost to NULL semantics)", async () => {
    const r = (await post("/api/jobs/provenance/backfill")).body;
    expect(r.dry_run).toBe(true);
    expect(r.by_signal.marker_or_demo_number + r.by_signal.demo_tenant_only).toBe(r.proposed_seed_demo);
    expect(r.proposed_seed_demo + r.proposed_review_required).toBe(r.total_unmarked);
  });

  it("(C4) cleanup dry-run projections are internally coherent and never propose a blocked purge", async () => {
    const r = (await get("/api/jobs/cleanup/dry-run")).body;
    expect(r.curated_demo_count).toBe(r.totals_by_action.keep_curated_demo);
    expect(r.hard_purge_candidates.length).toBe(r.totals_by_action.purge);
    expect(r.projected_demo_view_total).toBeGreaterThanOrEqual(r.projected_default_view_total);
    for (const c of r.hard_purge_candidates) expect(c.blocking_dependencies).toEqual([]); // purge is only ever dependency-free
  });

  it("(C5) an off-page archived Job opens via quick-view but is absent from the default active index", async () => {
    const id = (
      await dbPool.query(
        `INSERT INTO jobs (tenant_id, department_type, title, job_status, archived_at, data_origin)
         VALUES ($1,'sports','closure-offpage-archived','archived', now(), 'test_fixture') RETURNING id::text`,
        [tenantId]
      )
    ).rows[0].id;
    try {
      expect((await get(`/api/jobs/quick-view/${id}`)).status).toBe(200); // reachable by direct id
      const active = (await get("/api/jobs/index?limit=100&search=closure-offpage-archived")).body;
      expect(active.rows.some((r: any) => r.id === id)).toBe(false); // not in the default active view
    } finally {
      await dbPool.query(`DELETE FROM jobs WHERE id=$1`, [id]);
    }
  });
});
