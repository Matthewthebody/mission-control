import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";
import { reconcileDistricts } from "../src/services/directoryReconciliation.js";

// Phase 4 Slice 7 — deterministic legacy district reconciliation. Links a School's legacy
// free-text school_profile.district_name to the canonical District (parent_organization_id)
// ONLY on an exact normalized-name match, never overwriting a parent, never merging.
// Dry-run writes nothing. All DB writes run in a rolled-back transaction.

const app = createApp();
const stamp = Date.now();
let manageToken = "";
let photographerToken = "";
let tenantId = "";
let adminUserId = "";

async function mkDistrict(client: any, name: string) {
  return (await client.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind) VALUES ($1,$2,$3,$2,'schools_underclass_portraits','active','parent_organization') RETURNING id::text`, [tenantId, name, name.trim().toLowerCase().replace(/\s+/g, " ")])).rows[0].id;
}
async function mkSchool(client: any, name: string, districtName: string, parentId: string | null = null) {
  const id = (await client.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind, parent_organization_id) VALUES ($1,$2,$2,$2,'schools_underclass_portraits','active','account',$3) RETURNING id::text`, [tenantId, name, parentId])).rows[0].id;
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

describe("Phase 4 Slice 7 — district reconciliation", () => {
  it("(1) dry-run via route writes nothing and classifies", async () => {
    const before = (await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND parent_organization_id IS NOT NULL`, [tenantId])).rows[0].n;
    const res = await request(app).post("/api/organizations/reconcile/districts").set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.by_class).toBeTruthy();
    const after = (await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND parent_organization_id IS NOT NULL`, [tenantId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("(3/9/13) deterministic exact match links; no-candidate + parented are not touched; nothing deleted; idempotent (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const district = await mkDistrict(client, `Maple District ${stamp}`);
      const exact = await mkSchool(client, `Maple High ${stamp}`, `Maple District ${stamp}`); // -> exact_match
      const noCand = await mkSchool(client, `Lonely High ${stamp}`, `Nonexistent District ${stamp}`); // -> no_candidate
      const otherDistrict = await mkDistrict(client, `Other District ${stamp}`);
      const parented = await mkSchool(client, `Parented High ${stamp}`, `Maple District ${stamp}`, otherDistrict); // already has a parent

      const beforeCount = (await client.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      const applied = await reconcileDistricts(client, auth(), { dryRun: false });
      const afterCount = (await client.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      expect(afterCount).toBe(beforeCount); // never deletes

      const find = (id: string) => applied.candidates.find((c: any) => c.organization_id === id);
      expect(find(exact)!.classification).toBe("exact_match");
      expect(find(noCand)!.classification).toBe("no_candidate");
      // the exact match got linked to its district
      expect((await client.query(`SELECT parent_organization_id::text p FROM organization WHERE id=$1`, [exact])).rows[0].p).toBe(district);
      // no-candidate stays parentless; parented keeps its original (never overwritten)
      expect((await client.query(`SELECT parent_organization_id FROM organization WHERE id=$1`, [noCand])).rows[0].parent_organization_id).toBeNull();
      expect((await client.query(`SELECT parent_organization_id::text p FROM organization WHERE id=$1`, [parented])).rows[0].p).toBe(otherDistrict);
      expect(applied.applied_links.some((l: any) => l.organization_id === exact && l.district_id === district)).toBe(true);

      // idempotent: a second apply links nothing new for our fixture (already linked)
      const again = await reconcileDistricts(client, auth(), { dryRun: false });
      expect(again.applied_links.some((l: any) => l.organization_id === exact)).toBe(false);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("(6) requires management access to apply", async () => {
    const res = await request(app).post("/api/organizations/reconcile/districts?apply=true").set("Authorization", `Bearer ${photographerToken}`);
    expect(res.status).toBe(403);
  });
});
