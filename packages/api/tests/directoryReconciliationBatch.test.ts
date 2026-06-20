import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";
import { reconcileDirectoryBatch } from "../src/services/directoryReconciliationBatch.js";

// Phase 4 Slice E — combined Directory reconciliation batch. Districts apply surgically
// (exact normalized-name match, parentless only) and reversibly; contacts + brand/notes are
// reported only (never applied by the batch). Dry-run writes nothing. All writes are rolled
// back in a transaction so the shared demo DB is untouched.

const app = createApp();
const stamp = Date.now();
let manageToken = "";
let photographerToken = "";
let tenantId = "";
let adminUserId = "";

async function mkDistrict(client: any, name: string) {
  return (await client.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind) VALUES ($1,$2,$3,$2,'schools_underclass_portraits','active','parent_organization') RETURNING id::text`, [tenantId, name, name.trim().toLowerCase().replace(/\s+/g, " ")])).rows[0].id;
}
async function mkSchool(client: any, name: string, districtName: string) {
  const id = (await client.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind) VALUES ($1,$2,$2,$2,'schools_underclass_portraits','active','account') RETURNING id::text`, [tenantId, name])).rows[0].id;
  await client.query(`INSERT INTO school_profile (tenant_id, organization_id, district_name) VALUES ($1,$2,$3) ON CONFLICT (organization_id) DO UPDATE SET district_name = EXCLUDED.district_name`, [tenantId, id, districtName]);
  return id;
}
const auth = () => ({ authorityTier: "leadership", tenantId, id: adminUserId } as any);

beforeAll(async () => {
  manageToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${manageToken}`)).body.user.tenantId;
  adminUserId = (await pool.query(`SELECT id::text FROM app_user WHERE email='schools-office@example.com'`)).rows[0].id;
});
afterAll(async () => undefined);

describe("Phase 4 Slice E — directory reconciliation batch", () => {
  it("(1) dry-run via route writes nothing and reports all three domains", async () => {
    const before = (await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND parent_organization_id IS NOT NULL`, [tenantId])).rows[0].n;
    const res = await request(app).post("/api/organizations/reconcile/directory").set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.districts).toBeTruthy();
    expect(res.body.contacts).toBeTruthy();
    expect(res.body.brand_notes).toBeTruthy();
    expect(res.body.applied).toEqual({ districts: 0, contacts: 0, brand_notes: 0 });
    const after = (await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND parent_organization_id IS NOT NULL`, [tenantId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("(2) apply links an exact-match district surgically, leaves contacts report-only, and is reversible (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const district = await mkDistrict(client, `Batch District ${stamp}`);
      const school = await mkSchool(client, `Batch School ${stamp}`, `Batch District ${stamp}`);

      const beforeCount = (await client.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      const report = await reconcileDirectoryBatch(client, auth(), { dryRun: false });
      const afterCount = (await client.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      expect(afterCount).toBe(beforeCount); // additive links only — never creates/deletes organizations

      // our exact-match school was linked to its district
      expect((await client.query(`SELECT parent_organization_id::text p FROM organization WHERE id=$1`, [school])).rows[0].p).toBe(district);
      expect(report.applied.districts).toBeGreaterThanOrEqual(1);
      expect(report.rollback.districts_applied_links.some((l: any) => l.organization_id === school && l.district_id === district)).toBe(true);

      // contacts + brand/notes are reported only by the batch (never applied)
      expect(report.applied.contacts).toBe(0);
      expect(report.applied.brand_notes).toBe(0);
      expect(report.rollback.contacts_backfill_batch_id).toBeNull();
      expect(report.contacts).toHaveProperty("total_unlinked");
      expect(report.brand_notes).toHaveProperty("review_required");

      // reversal: undo the applied link with the report's rollback list
      for (const link of report.rollback.districts_applied_links) {
        await client.query(`UPDATE organization SET parent_organization_id = NULL WHERE tenant_id=$1 AND id=$2`, [tenantId, link.organization_id]);
      }
      expect((await client.query(`SELECT parent_organization_id FROM organization WHERE id=$1`, [school])).rows[0].parent_organization_id).toBeNull();
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("(3) requires management access to apply", async () => {
    const res = await request(app).post("/api/organizations/reconcile/directory?apply=true").set("Authorization", `Bearer ${photographerToken}`);
    expect(res.status).toBe(403);
  });
});
