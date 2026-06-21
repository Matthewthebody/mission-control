import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";
import { validateOrganizationParent, parseLegacyOrganizationNotes } from "../src/services/organizationHierarchy.js";

// Phase 4 Slice 1 — canonical Organization hierarchy (District -> School) written
// through the production Directory using the migration-144 columns. Additive; no
// migration. Verifies hierarchy create/update/read, validation, canonical columns
// (not the notes blob), the legacy-notes read fallback, RBAC, cross-tenant denial,
// exact-only duplicate detection, and cross-surface (Directory == Client Command).

const app = createApp();
const stamp = Date.now();
const SCHOOL = "schools_underclass_portraits";
const createdOrgIds: string[] = [];
let crossTenantId = "";
let crossTenantOrgId = "";

let manageToken = "";
let photographerToken = "";
let tenantId = "";

async function me(token: string) {
  return (await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body;
}
function createOrg(token: string, body: Record<string, unknown>) {
  return request(app).post("/api/organizations").set("Authorization", `Bearer ${token}`).send(body);
}
function patchOrg(token: string, id: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/organizations/${id}`).set("Authorization", `Bearer ${token}`).send(body);
}
function getOrg(token: string, id: string) {
  return request(app).get(`/api/organizations/${id}`).set("Authorization", `Bearer ${token}`);
}
function track(res: { body?: { organization?: { id?: string } } }) {
  const id = res.body?.organization?.id;
  if (id) createdOrgIds.push(id);
  return id as string;
}

beforeAll(async () => {
  manageToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await me(manageToken)).user.tenantId;
  crossTenantId = (await pool.query(`SELECT id::text FROM tenant WHERE id <> $1 ORDER BY name LIMIT 1`, [tenantId])).rows[0].id;
  crossTenantOrgId = (
    await pool.query(
      `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind)
       VALUES ($1,$2,$2,$2,'studio','active','parent_organization') RETURNING id::text`,
      [crossTenantId, `xtenant district ${stamp}`]
    )
  ).rows[0].id;
});

afterAll(async () => {
  const ids = [...createdOrgIds, crossTenantOrgId].filter(Boolean);
  if (ids.length) {
    await pool.query(`DELETE FROM school_activity_log WHERE organization_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM school_profile WHERE organization_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM organization_alias WHERE organization_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [ids]);
  }
});

describe("Phase 4 Slice 1 — canonical organization hierarchy", () => {
  it("(1) creates a District as a top-level parent organization", async () => {
    const res = await createOrg(manageToken, { canonical_name: `District One ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization", client_organization_type: "school_district" });
    expect(res.status).toBe(201);
    const id = track(res);
    expect(res.body.organization.client_entity_kind).toBe("parent_organization");
    expect(res.body.organization.parent_organization_id).toBeNull();
  });

  it("(2) creates a School under a parent District", async () => {
    const district = track(await createOrg(manageToken, { canonical_name: `District Two ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization", client_organization_type: "school_district" }));
    const res = await createOrg(manageToken, { canonical_name: `School Two ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", client_organization_type: "high_school", parent_organization_id: district });
    expect(res.status).toBe(201);
    track(res);
    expect(res.body.organization.parent_organization_id).toBe(district);
    expect(res.body.organization.parent_organization_name).toContain("District Two");
  });

  it("(3) rejects a School created without a parent District", async () => {
    const res = await createOrg(manageToken, { canonical_name: `Orphan School ${stamp}`, account_type: SCHOOL, client_entity_kind: "account" });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/parent District/i);
  });

  it("(4) rejects a parent District from another tenant", async () => {
    const res = await createOrg(manageToken, { canonical_name: `XTenant School ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: crossTenantOrgId });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/not found/i);
  });

  it("(5) rejects using a School (account) as a parent District", async () => {
    const district = track(await createOrg(manageToken, { canonical_name: `District Five ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization" }));
    const school = track(await createOrg(manageToken, { canonical_name: `School Five ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const res = await createOrg(manageToken, { canonical_name: `Bad Child ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: school });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/not a District/i);
  });

  it("(6) rejects self-parent on update", async () => {
    const district = track(await createOrg(manageToken, { canonical_name: `District Six ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization" }));
    const school = track(await createOrg(manageToken, { canonical_name: `School Six ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const res = await patchOrg(manageToken, school, { parent_organization_id: school });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/own parent/i);
  });

  it("(7) validateOrganizationParent rejects a hierarchy cycle", async () => {
    // Construct a 2-node parent_organization cycle directly (the API can't build one),
    // then assert the helper's cycle guard catches it.
    const a = (await pool.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind) VALUES ($1,$2,$2,$2,'studio','active','parent_organization') RETURNING id::text`, [tenantId, `cycle a ${stamp}`])).rows[0].id;
    const b = (await pool.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind, parent_organization_id) VALUES ($1,$2,$2,$2,'studio','active','parent_organization',$3) RETURNING id::text`, [tenantId, `cycle b ${stamp}`, a])).rows[0].id;
    createdOrgIds.push(a, b);
    await pool.query(`UPDATE organization SET parent_organization_id = $2 WHERE id = $1`, [a, b]); // a->b->a
    const client = await pool.connect();
    try {
      await expect(validateOrganizationParent(client as any, tenantId, b, a)).rejects.toMatchObject({ status: 400 });
    } finally {
      await pool.query(`UPDATE organization SET parent_organization_id = NULL WHERE id = ANY($1::uuid[])`, [[a, b]]);
      client.release();
    }
  });

  it("(8) persists website and main phone in canonical columns", async () => {
    const id = track(await createOrg(manageToken, { canonical_name: `Brandful ${stamp}`, account_type: "studio", website: "https://brandful.example.com", main_phone: "555-0100" }));
    const row = (await pool.query(`SELECT website, main_phone FROM organization WHERE id=$1`, [id])).rows[0];
    expect(row.website).toBe("https://brandful.example.com");
    expect(row.main_phone).toBe("555-0100");
  });

  it("(9) does not append structured values to the notes blob", async () => {
    const id = track(await createOrg(manageToken, { canonical_name: `NotesClean ${stamp}`, account_type: "studio", website: "https://clean.example.com", main_phone: "555-0101", notes: "Plain operational note." }));
    const notes = (await pool.query(`SELECT notes FROM organization WHERE id=$1`, [id])).rows[0].notes;
    expect(notes).toBe("Plain operational note.");
    expect(notes ?? "").not.toMatch(/Website:|Main Phone:/i);
  });

  it("(10) reads legacy notes-packed website/phone as a fallback when columns are null", async () => {
    const id = (
      await pool.query(
        `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, notes)
         VALUES ($1,$2,$2,$2,'studio','active',$3) RETURNING id::text`,
        [tenantId, `legacy notes ${stamp}`, "Directory Details:\nWebsite: legacy.example.com\nMain Phone: 555-9999"]
      )
    ).rows[0].id;
    createdOrgIds.push(id);
    const res = await getOrg(manageToken, id);
    expect(res.status).toBe(200);
    expect(res.body.organization.website).toBe("legacy.example.com");
    expect(res.body.organization.main_phone).toBe("555-9999");
    // pure helper
    expect(parseLegacyOrganizationNotes("Website: a.com\nMain Phone: 1")).toEqual({ website: "a.com", main_phone: "1" });
  });

  it("(11) District detail lists its child Schools", async () => {
    const district = track(await createOrg(manageToken, { canonical_name: `District Eleven ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization" }));
    track(await createOrg(manageToken, { canonical_name: `School Eleven A ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const res = await getOrg(manageToken, district);
    expect(res.body.organization.child_organization_count).toBeGreaterThanOrEqual(1);
    expect(res.body.child_organizations.some((c: any) => c.display_name.includes("School Eleven A"))).toBe(true);
  });

  it("(12) School detail identifies its parent District", async () => {
    const district = track(await createOrg(manageToken, { canonical_name: `District Twelve ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization" }));
    const school = track(await createOrg(manageToken, { canonical_name: `School Twelve ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const res = await getOrg(manageToken, school);
    expect(res.body.organization.parent_organization_id).toBe(district);
    expect(res.body.organization.parent_organization_name).toContain("District Twelve");
    expect(res.body.child_organizations).toEqual([]);
  });

  it("(13) warns on an exact duplicate organization name", async () => {
    const name = `Dup Org ${stamp}`;
    track(await createOrg(manageToken, { canonical_name: name, account_type: "studio" }));
    const res = await createOrg(manageToken, { canonical_name: name, account_type: "studio" });
    expect(res.status).toBe(409);
  });

  it("(14) does not auto-merge a fuzzy (non-exact) name", async () => {
    track(await createOrg(manageToken, { canonical_name: `Fuzzy Academy North ${stamp}`, account_type: "studio" }));
    const res = await createOrg(manageToken, { canonical_name: `Fuzzy Academy South ${stamp}`, account_type: "studio" });
    expect(res.status).toBe(201); // distinct record, never merged on similarity
    track(res);
  });

  it("(15) denies a non-manager (RBAC)", async () => {
    const res = await createOrg(photographerToken, { canonical_name: `Denied Org ${stamp}`, account_type: "studio" });
    expect(res.status).toBe(403);
  });

  it("(17) Client Command and Directory see the same hierarchy", async () => {
    const district = track(await createOrg(manageToken, { canonical_name: `District CCC ${stamp}`, account_type: SCHOOL, client_entity_kind: "parent_organization", client_organization_type: "school_district" }));
    const school = track(await createOrg(manageToken, { canonical_name: `School CCC ${stamp}`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const ccc = await request(app).get(`/api/client-command-center/accounts/${school}`).set("Authorization", `Bearer ${manageToken}`);
    expect(ccc.status).toBe(200);
    expect(ccc.body.parent_organization?.id ?? ccc.body.account?.parent_organization_id).toBe(district);
  });

  it("(18) the districts endpoint returns only canonical Districts (with child counts), not School accounts", async () => {
    const token = `ZZDistList${stamp}`;
    const district = track(await createOrg(manageToken, { canonical_name: `${token} District`, account_type: SCHOOL, client_entity_kind: "parent_organization", client_organization_type: "school_district" }));
    const school = track(await createOrg(manageToken, { canonical_name: `${token} School`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const res = await request(app).get(`/api/organizations/districts?search=${token}`).set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.districts)).toBe(true);
    const found = res.body.districts.find((d: any) => d.id === district);
    expect(found).toBeTruthy();
    expect(found.child_organization_count).toBeGreaterThanOrEqual(1); // the linked School is counted
    // the School account is NOT a District and must not appear in the selector list
    expect(res.body.districts.some((d: any) => d.id === school)).toBe(false);
  });

  it("(19) the districts endpoint requires authentication", async () => {
    const res = await request(app).get("/api/organizations/districts");
    expect(res.status).toBe(401);
  });

  it("(20) the organization list scopes to a District's child schools via parent_organization_id", async () => {
    const token = `ZZScope${stamp}`;
    const district = track(await createOrg(manageToken, { canonical_name: `${token} District`, account_type: SCHOOL, client_entity_kind: "parent_organization" }));
    const childA = track(await createOrg(manageToken, { canonical_name: `${token} School A`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const childB = track(await createOrg(manageToken, { canonical_name: `${token} School B`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: district }));
    const otherDistrict = track(await createOrg(manageToken, { canonical_name: `${token} Other District`, account_type: SCHOOL, client_entity_kind: "parent_organization" }));
    const otherChild = track(await createOrg(manageToken, { canonical_name: `${token} Other School`, account_type: SCHOOL, client_entity_kind: "account", parent_organization_id: otherDistrict }));

    const res = await request(app).get(`/api/organizations?parent_organization_id=${district}`).set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.organizations.map((o: any) => o.id);
    expect(ids).toContain(childA);
    expect(ids).toContain(childB);
    expect(ids).not.toContain(otherChild); // a different District's school is excluded
    expect(ids).not.toContain(district); // the District itself is not its own child
  });
});
