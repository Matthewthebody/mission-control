import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRestoreTarget } from "../src/services/jobTruth/jobsLifecycle.js";

// Phase 3C.1 Commit 3 — preserve a Job's lifecycle state across archive/restore.
// Archive snapshots the prior status; restore returns to it when valid, reconciles
// against current child data, and returns a labeled Review Required only when the
// prior state is missing or contradicted — never blindly forcing pending_confirmation.

let app: Express;
let dbPool: Pool;
let token = "";
let tenantId = "";

async function login(email: string) {
  return (await request(app).post("/auth/dev-login").send({ email })).body.token as string;
}
async function makeJob(fields: Record<string, unknown>): Promise<string> {
  const cols = ["tenant_id", "department_type", "title", "data_origin", ...Object.keys(fields)];
  const vals = [tenantId, "sports", "3C.1 archive/restore fixture", "test_fixture", ...Object.values(fields)];
  const r = await dbPool.query(`INSERT INTO jobs (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id::text`, vals);
  return r.rows[0].id;
}
const archive = (id: string) => request(app).post(`/api/jobs/${id}/archive`).set("Authorization", `Bearer ${token}`).send({ reason: "test" });
const restore = (id: string) => request(app).post(`/api/jobs/${id}/restore`).set("Authorization", `Bearer ${token}`).send({});
async function jobRow(id: string) {
  return (await dbPool.query(`SELECT job_status::text AS job_status, archived_at::text AS archived_at, pre_archive_state FROM jobs WHERE id=$1`, [id])).rows[0];
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  token = await login("leadership@example.com");
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.user.tenantId;
});
afterAll(async () => {
  await dbPool.query(`DELETE FROM jobs WHERE tenant_id=$1 AND data_origin='test_fixture'`, [tenantId]);
});

describe("archive/restore lifecycle preservation", () => {
  it("(1) archive snapshots the prior status into pre_archive_state and sets archived", async () => {
    const id = await makeJob({ job_status: "confirmed" });
    expect((await archive(id)).status).toBe(200);
    const row = await jobRow(id);
    expect(row.archived_at).not.toBeNull();
    expect(row.job_status).toBe("archived");
    expect(row.pre_archive_state?.job_status).toBe("confirmed");
  });

  it("(2) archive→restore returns the EXACT prior status — not pending_confirmation (the bug fix)", async () => {
    const id = await makeJob({ job_status: "confirmed" });
    await archive(id);
    expect((await restore(id)).status).toBe(200);
    const row = await jobRow(id);
    expect(row.archived_at).toBeNull();
    expect(row.job_status).toBe("confirmed"); // restored to prior, NOT pending_confirmation
    expect(row.pre_archive_state).toBeNull(); // snapshot consumed
  });

  it("(3) restore is Review Required when the prior active status now contradicts complete child data", async () => {
    const id = await makeJob({ job_status: "confirmed" });
    await archive(id);
    // Child data now reads complete (delivered production) with no open work.
    await dbPool.query(`UPDATE jobs SET production_status='delivered' WHERE id=$1`, [id]);
    await restore(id);
    expect((await jobRow(id)).job_status).toBe("pending_confirmation"); // reconciled to Review Required
  });

  it("(4) restore is Review Required when a terminal prior status now has open work", async () => {
    const id = await makeJob({ job_status: "execution_complete" });
    await archive(id);
    await dbPool.query(`INSERT INTO job_readiness_items (tenant_id, job_id, section_key, label, is_blocker, is_complete) VALUES ($1,$2,'general','reopened blocker',true,false)`, [tenantId, id]);
    await restore(id);
    expect((await jobRow(id)).job_status).toBe("pending_confirmation");
  });

  it("(5) restore is Review Required when there is no recorded pre-archive state", async () => {
    const id = await makeJob({ job_status: "confirmed" });
    await archive(id);
    await dbPool.query(`UPDATE jobs SET pre_archive_state = NULL WHERE id=$1`, [id]); // e.g. archived before this feature
    await restore(id);
    expect((await jobRow(id)).job_status).toBe("pending_confirmation");
  });

  it("(6) restore of a non-archived Job is a safe no-op", async () => {
    const id = await makeJob({ job_status: "confirmed" });
    expect((await restore(id)).status).toBe(200);
    const row = await jobRow(id);
    expect(row.archived_at).toBeNull();
    expect(row.job_status).toBe("confirmed"); // unchanged
  });

  it("(7) resolveRestoreTarget: restores a consistent prior, flags every contradiction", () => {
    // Consistent active prior, no contradictory child data -> restored as-is.
    expect(resolveRestoreTarget({ priorJobStatus: "confirmed", currentlyComplete: false, currentlyCanceled: false, hasOpenWork: true }))
      .toMatchObject({ targetStatus: "confirmed", outcome: "restored_prior" });
    // Active prior but now complete with no open work -> Review Required (with a reason).
    const a = resolveRestoreTarget({ priorJobStatus: "confirmed", currentlyComplete: true, currentlyCanceled: false, hasOpenWork: false });
    expect(a).toMatchObject({ targetStatus: "pending_confirmation", outcome: "review_required" });
    expect(a.reason).toMatch(/complete/);
    // Terminal prior but open work now -> Review Required.
    expect(resolveRestoreTarget({ priorJobStatus: "execution_complete", currentlyComplete: true, currentlyCanceled: false, hasOpenWork: true }))
      .toMatchObject({ targetStatus: "pending_confirmation", outcome: "review_required" });
    // Missing prior -> Review Required.
    expect(resolveRestoreTarget({ priorJobStatus: null, currentlyComplete: false, currentlyCanceled: false, hasOpenWork: false }))
      .toMatchObject({ targetStatus: "pending_confirmation", outcome: "review_required" });
    // A terminal prior with NO open work is still a faithful restore (not a contradiction).
    expect(resolveRestoreTarget({ priorJobStatus: "execution_complete", currentlyComplete: true, currentlyCanceled: false, hasOpenWork: false }))
      .toMatchObject({ targetStatus: "execution_complete", outcome: "restored_prior" });
  });
});
