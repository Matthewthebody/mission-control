import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

// Phase 4.2 Part 3 — atomic Create Organization. One transaction creates the organization +
// brand + first term + contacts (existing identity or inline new) + locations; ANY failure
// rolls the whole thing back (no orphan org / contact / identity / location / term).

const app = createApp();
const stamp = Date.now();
let manageToken = "";
let photographerToken = "";
let tenantId = "";
let districtId = "";
let accountOrgId = "";
let crossTenantId = "";
let crossDistrictId = "";
let crossContactId = "";
let crossLocationId = "";
const createdOrgIds: string[] = [];
const createdContactIds: string[] = [];

function atomic(body: Record<string, unknown>, token = manageToken) {
  return request(app).post("/api/organizations/atomic").set("Authorization", `Bearer ${token}`).send(body);
}
async function makeOrg(tenant: string, label: string, kind: "account" | "parent_organization" = "account") {
  return (
    await pool.query(
      `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status, client_entity_kind)
       VALUES ($1,$2,$2,$2,'schools_underclass_portraits','active',$3) RETURNING id::text`,
      [tenant, label, kind]
    )
  ).rows[0].id;
}
async function makeContact(tenant: string, email: string) {
  const id = (await pool.query(`INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, email, normalized_email) VALUES ($1,'Fix','Ture',$2,$3,$4,$4) RETURNING id::text`, [tenant, `Fix Ture ${email}`, `fix ture ${email}`, email])).rows[0].id;
  return id;
}
async function makeLocation(tenant: string, orgId: string, name: string) {
  return (await pool.query(`INSERT INTO shoot_location (tenant_id, organization_id, external_source, external_key, name, normalized_name, address, normalized_address, address_line_1, city, state, zip, active_status) VALUES ($1,$2,'test',$3,$4,$5,'1 Fixture Rd','1 fixture rd','1 Fixture Rd','Plymouth','MN','55446','active') RETURNING id::text`, [tenant, orgId, `k:${name}`, name, name.toLowerCase()])).rows[0].id;
}

beforeAll(async () => {
  manageToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${manageToken}`)).body.user.tenantId;
  districtId = await makeOrg(tenantId, `Atomic Fixture District ${stamp}`, "parent_organization");
  accountOrgId = await makeOrg(tenantId, `Atomic Fixture Account ${stamp}`, "account");
  createdOrgIds.push(districtId, accountOrgId);
  crossTenantId = (await pool.query(`SELECT id::text FROM tenant WHERE id <> $1 ORDER BY name LIMIT 1`, [tenantId])).rows[0].id;
  crossDistrictId = await makeOrg(crossTenantId, `Atomic XTenant District ${stamp}`, "parent_organization");
  crossContactId = await makeContact(crossTenantId, `xtenant-${stamp}@atomic.example.com`);
  crossLocationId = await makeLocation(crossTenantId, crossDistrictId, `XTenant Loc ${stamp}`);
});

afterAll(async () => {
  const allOrgs = [...createdOrgIds, crossDistrictId].filter(Boolean);
  if (allOrgs.length) {
    // delete every canonical identity created inline under the test orgs (before unlinking)
    await pool.query(`DELETE FROM contact WHERE id IN (SELECT contact_id FROM organization_contact WHERE organization_id = ANY($1::uuid[]) AND contact_id IS NOT NULL)`, [allOrgs]);
    await pool.query(`DELETE FROM organization_contact_relationship WHERE organization_id = ANY($1::uuid[])`, [allOrgs]);
    await pool.query(`DELETE FROM organization_contact WHERE organization_id = ANY($1::uuid[])`, [allOrgs]);
    await pool.query(`DELETE FROM school_service_term WHERE organization_id = ANY($1::uuid[])`, [allOrgs]);
    await pool.query(`UPDATE organization SET primary_location_id = NULL WHERE id = ANY($1::uuid[])`, [allOrgs]);
    await pool.query(`DELETE FROM shoot_location WHERE organization_id = ANY($1::uuid[])`, [allOrgs]);
    await pool.query(`DELETE FROM organization_logo_history WHERE organization_id = ANY($1::uuid[])`, [allOrgs]);
    await pool.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [allOrgs]);
  }
  const allContacts = [...createdContactIds, crossContactId].filter(Boolean);
  if (allContacts.length) await pool.query(`DELETE FROM contact WHERE id = ANY($1::uuid[])`, [allContacts]);
  // sweep any remaining stamped inline identities created by these tests
  await pool.query(`DELETE FROM contact WHERE tenant_id=$1 AND (email LIKE $2 OR email='atomic@example.com')`, [tenantId, `%${stamp}%`]);
});

describe("Phase 4.2 Part 3 — atomic create organization", () => {
  it("creates the organization, a new contact identity + relationship, a location, brand, and first term in one transaction", async () => {
    const name = `Atomic District ${stamp}`;
    const res = await atomic({
      organization: { canonical_name: name, account_type: "schools_underclass_portraits", client_entity_kind: "parent_organization", website: "atomicdistrict.example.org", main_phone: "555-0001" },
      contacts: [{ first_name: "Atomic", last_name: "Person", email: "atomic@example.com", client_roles: ["district_contact"], is_primary: true }],
      locations: [{ location_name: "Atomic Gym", address_line_1: "1 Main St", city: "Plymouth", state: "MN", zip: "55446" }],
      brand: { brand_primary_color: "Navy", mascot: "Bears", brand_status: "known" },
      initial_service_term: { period_type: "school_year", period_label: `2026-2027 ${stamp}` }
    });
    expect(res.status).toBe(201);
    const orgId = res.body.organization_id;
    createdOrgIds.push(orgId);
    expect(res.body.created_contact_ids.length).toBe(1);
    expect(res.body.created_location_count).toBe(1);

    // everything is present in one shot
    expect((await pool.query(`SELECT brand_primary_color, mascot FROM organization WHERE id=$1`, [orgId])).rows[0].mascot).toBe("Bears");
    expect((await pool.query(`SELECT count(*)::int n FROM organization_contact WHERE organization_id=$1 AND contact_id IS NOT NULL`, [orgId])).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE organization_id=$1`, [orgId])).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int n FROM school_service_term WHERE organization_id=$1`, [orgId])).rows[0].n).toBe(1);
  });

  it("ATOMICITY: a failure after the organization insert (invalid contact) leaves NO organization, contact, location, or term", async () => {
    const name = `Atomic Fail ${stamp}`;
    const beforeOrgs = (await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const beforeContacts = (await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const beforeLocations = (await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1`, [tenantId])).rows[0].n;

    // A location is valid, a brand is valid, but the second contact has no name AND no email →
    // the service throws AFTER the org + first contact + location were inserted in the tx.
    const res = await atomic({
      organization: { canonical_name: name, account_type: "schools_underclass_portraits", client_entity_kind: "parent_organization" },
      contacts: [
        { first_name: "Good", last_name: "Contact", email: "good@example.com" },
        { first_name: "", last_name: "", email: "" } // invalid → throws → whole tx rolls back
      ],
      locations: [{ location_name: "Doomed Gym", address_line_1: "9 Main St", city: "Plymouth", state: "MN", zip: "55446" }]
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    // nothing persisted — counts unchanged and no org/contact/location with our names
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(beforeOrgs);
    expect((await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(beforeContacts);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(beforeLocations);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, name])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1 AND email='good@example.com'`, [tenantId])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1 AND name='Doomed Gym'`, [tenantId])).rows[0].n).toBe(0);
  });

  it("ATOMICITY: a duplicate organization name fails the whole create (no partial)", async () => {
    const name = `Atomic Dup ${stamp}`;
    const first = await atomic({ organization: { canonical_name: name, account_type: "studio" } });
    expect(first.status).toBe(201);
    createdOrgIds.push(first.body.organization_id);
    const dup = await atomic({
      organization: { canonical_name: name, account_type: "studio" },
      locations: [{ location_name: "Should Not Exist", address_line_1: "1 X", city: "Y", state: "MN", zip: "00000" }]
    });
    expect(dup.status).toBe(409);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1 AND name='Should Not Exist'`, [tenantId])).rows[0].n).toBe(0);
  });

  it("links an EXISTING canonical contact by id (no duplicate identity, no fuzzy match)", async () => {
    const cid = (await pool.query(`INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, email) VALUES ($1,'Reuse','Me','Reuse Me','reuse me',$2) RETURNING id::text`, [tenantId, `reuse${stamp}@example.com`])).rows[0].id;
    const res = await atomic({
      organization: { canonical_name: `Atomic Reuse ${stamp}`, account_type: "studio" },
      contacts: [{ existing_contact_id: cid, client_roles: ["billing_contact"] }]
    });
    expect(res.status).toBe(201);
    createdOrgIds.push(res.body.organization_id);
    expect(res.body.linked_contact_ids).toContain(cid);
    expect(res.body.created_contact_ids.length).toBe(0); // reused, not created
    // exactly one identity with that email (no duplicate created)
    expect((await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1 AND email=$2`, [tenantId, `reuse${stamp}@example.com`])).rows[0].n).toBe(1);
    await pool.query(`DELETE FROM organization_contact_relationship WHERE organization_id=$1`, [res.body.organization_id]);
    await pool.query(`DELETE FROM organization_contact WHERE organization_id=$1`, [res.body.organization_id]);
    await pool.query(`DELETE FROM contact WHERE id=$1`, [cid]);
  });

  it("requires management access (RBAC)", async () => {
    const res = await atomic({ organization: { canonical_name: `Atomic RBAC ${stamp}`, account_type: "studio" } }, photographerToken);
    expect(res.status).toBe(403);
  });
});

describe("Phase 4.2 Part 3 — atomic create organization (extended acceptance)", () => {
  // ── Hierarchy ──────────────────────────────────────────────────────────────
  it("(2) creates a School under a canonical parent District in one transaction", async () => {
    const res = await atomic({
      organization: { canonical_name: `Atomic School ${stamp}`, account_type: "schools_underclass_portraits", client_entity_kind: "account", parent_organization_id: districtId }
    });
    expect(res.status).toBe(201);
    createdOrgIds.push(res.body.organization_id);
    expect((await pool.query(`SELECT parent_organization_id::text p FROM organization WHERE id=$1`, [res.body.organization_id])).rows[0].p).toBe(districtId);
  });

  it("(3) rejects a School with no parent District", async () => {
    const res = await atomic({ organization: { canonical_name: `Atomic NoDistrict ${stamp}`, account_type: "schools_underclass_portraits", client_entity_kind: "account" } });
    expect(res.status).toBe(400);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, `Atomic NoDistrict ${stamp}`])).rows[0].n).toBe(0);
  });

  it("(4) rejects a cross-tenant parent District", async () => {
    const res = await atomic({ organization: { canonical_name: `Atomic XParent ${stamp}`, account_type: "schools_underclass_portraits", client_entity_kind: "account", parent_organization_id: crossDistrictId } });
    expect(res.status).toBe(400); // "Parent District not found in this tenant"
  });

  it("(5) rejects an invalid parent type (an account is not a District)", async () => {
    const res = await atomic({ organization: { canonical_name: `Atomic BadParent ${stamp}`, account_type: "schools_underclass_portraits", client_entity_kind: "account", parent_organization_id: accountOrgId } });
    expect(res.status).toBe(400);
  });

  // ── Contacts ───────────────────────────────────────────────────────────────
  it("(7/9/10/11) links multiple existing + inline contacts with distinct contextual roles, title/notes, and a primary", async () => {
    const a = await makeContact(tenantId, `multi-a-${stamp}@atomic.example.com`);
    const b = await makeContact(tenantId, `multi-b-${stamp}@atomic.example.com`);
    createdContactIds.push(a, b);
    const res = await atomic({
      organization: { canonical_name: `Atomic MultiContact ${stamp}`, account_type: "studio" },
      contacts: [
        { existing_contact_id: a, client_roles: ["district_contact"], is_primary: true, title: "Superintendent", notes: "Decision maker" },
        { existing_contact_id: b, client_roles: ["billing_contact"], title: "Bursar" },
        { first_name: "Inline", last_name: "Person", email: `inline-${stamp}@atomic.example.com`, client_roles: ["picture_day_contact"] }
      ]
    });
    expect(res.status).toBe(201);
    const orgId = res.body.organization_id;
    createdOrgIds.push(orgId);
    expect(res.body.linked_contact_ids.sort()).toEqual([a, b].sort());
    expect(res.body.created_contact_ids.length).toBe(1);
    // three relationships, distinct roles, title + notes persisted, one primary
    const rels = await pool.query(`SELECT oc.title, oc.notes, ocr.client_roles::text[] AS roles, ocr.is_primary FROM organization_contact oc JOIN organization_contact_relationship ocr ON ocr.contact_id=oc.id AND ocr.is_current=true WHERE oc.organization_id=$1`, [orgId]);
    expect(rels.rows.length).toBe(3);
    expect(rels.rows.filter((r: any) => r.is_primary).length).toBe(1);
    expect(rels.rows.find((r: any) => r.title === "Superintendent")?.notes).toBe("Decision maker");
    const allRoles = rels.rows.flatMap((r: any) => r.roles);
    expect(allRoles).toEqual(expect.arrayContaining(["district_contact", "billing_contact", "picture_day_contact"]));
  });

  // ── Locations ──────────────────────────────────────────────────────────────
  it("(13/15/16) links an existing Location + an inline Location, with a primary designation", async () => {
    const existingLoc = await makeLocation(tenantId, accountOrgId, `Reusable Venue ${stamp}`);
    const res = await atomic({
      organization: { canonical_name: `Atomic MultiLoc ${stamp}`, account_type: "studio" },
      locations: [
        { existing_location_id: existingLoc },
        { location_name: `Inline Gym ${stamp}`, address_line_1: "2 Court St", city: "Plymouth", state: "MN", zip: "55446", notes: "Use the east gym; load-in at door 3", is_primary: true }
      ]
    });
    expect(res.status).toBe(201);
    const orgId = res.body.organization_id;
    createdOrgIds.push(orgId);
    expect(res.body.created_location_count).toBe(2);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE organization_id=$1`, [orgId])).rows[0].n).toBe(2);
    // the inline location was designated primary at the organization level
    const primaryId = res.body.primary_location_id;
    expect(primaryId).toBeTruthy();
    expect((await pool.query(`SELECT primary_location_id::text p FROM organization WHERE id=$1`, [orgId])).rows[0].p).toBe(primaryId);
    expect((await pool.query(`SELECT location_details FROM shoot_location WHERE id=$1`, [primaryId])).rows[0].location_details).toContain("east gym");
  });

  it("(17) an exact normalized-address duplicate within the org fails the whole create (rollback)", async () => {
    const name = `Atomic DupAddr ${stamp}`;
    const res = await atomic({
      organization: { canonical_name: name, account_type: "studio" },
      locations: [
        { location_name: "Twin", address_line_1: "5 Same St", city: "Plymouth", state: "MN", zip: "55446" },
        { location_name: "Twin", address_line_1: "5 Same St", city: "Plymouth", state: "MN", zip: "55446" }
      ]
    });
    expect(res.status).toBe(409);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, name])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1 AND name='Twin'`, [tenantId])).rows[0].n).toBe(0);
  });

  // ── Website / brand / logo ───────────────────────────────────────────────────
  it("(19) normalizes a Website entered without a scheme", async () => {
    const res = await atomic({ organization: { canonical_name: `Atomic Web ${stamp}`, account_type: "studio", website: "atomicweb.example.org" } });
    expect(res.status).toBe(201);
    createdOrgIds.push(res.body.organization_id);
    expect((await pool.query(`SELECT website FROM organization WHERE id=$1`, [res.body.organization_id])).rows[0].website).toBe("https://atomicweb.example.org");
  });

  it("(20) rejects an unsafe Website protocol (whole create rolls back)", async () => {
    const name = `Atomic BadProto ${stamp}`;
    const res = await atomic({ organization: { canonical_name: name, account_type: "studio", website: "javascript:alert(1)" } });
    expect(res.status).toBe(400);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, name])).rows[0].n).toBe(0);
  });

  it("(21/22) persists brand states and writes a logo-history row in the same transaction", async () => {
    const res = await atomic({
      organization: { canonical_name: `Atomic Brand ${stamp}`, account_type: "schools_underclass_portraits", client_entity_kind: "parent_organization" },
      brand: { brand_primary_color: "Maroon", brand_secondary_color: "Gold", mascot: "Hawks", brand_status: "known", logo_url: "https://img.example/hawks.png", logo_status: "current", logo_source: "manual" }
    });
    expect(res.status).toBe(201);
    const orgId = res.body.organization_id;
    createdOrgIds.push(orgId);
    const org = (await pool.query(`SELECT brand_primary_color, brand_secondary_color, mascot, brand_status, logo_url FROM organization WHERE id=$1`, [orgId])).rows[0];
    expect(org.mascot).toBe("Hawks");
    expect(org.brand_status).toBe("known");
    expect(org.logo_url).toBe("https://img.example/hawks.png");
    expect((await pool.query(`SELECT count(*)::int n FROM organization_logo_history WHERE organization_id=$1`, [orgId])).rows[0].n).toBeGreaterThanOrEqual(1);
  });

  // ── Service term + overlap ───────────────────────────────────────────────────
  it("(23/24) creates the optional initial term, and the per-organization overlap guard rejects a duplicate label", async () => {
    const label = `2027-2028 ${stamp}`;
    const res = await atomic({
      organization: { canonical_name: `Atomic Term ${stamp}`, account_type: "schools_underclass_portraits", client_entity_kind: "parent_organization" },
      initial_service_term: { period_type: "school_year", period_label: label }
    });
    expect(res.status).toBe(201);
    const orgId = res.body.organization_id;
    createdOrgIds.push(orgId);
    expect((await pool.query(`SELECT count(*)::int n FROM school_service_term WHERE organization_id=$1 AND period_label=$2`, [orgId, label])).rows[0].n).toBe(1);
    // the per-org overlap guard rejects a second identical term (409) — proves term creation is guarded
    const dupTerm = await request(app).post(`/api/organizations/${orgId}/service-terms`).set("Authorization", `Bearer ${manageToken}`).send({ period_type: "school_year", period_label: label });
    expect(dupTerm.status).toBe(409);
  });

  // ── Rollback proofs (forced failures at successive stages) ───────────────────
  it("(25) ROLLBACK after organization insert: a later-stage failure leaves no organization", async () => {
    const name = `Rollback Org ${stamp}`;
    const before = (await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    // valid org + valid brand + valid term, then an INVALID inline contact → throws after org/brand/term
    const res = await atomic({
      organization: { canonical_name: name, account_type: "schools_underclass_portraits", client_entity_kind: "parent_organization" },
      brand: { mascot: "Doomed", brand_status: "known" },
      initial_service_term: { period_type: "school_year", period_label: `Doomed ${stamp}` },
      contacts: [{ first_name: "", last_name: "", email: "" }]
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(before);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, name])).rows[0].n).toBe(0);
  });

  it("(26/27/28/29/30/31) ROLLBACK after contact/brand/term/location: NO orphan org, contact, relationship, location, term, or logo", async () => {
    const name = `Rollback Full ${stamp}`;
    const beforeContacts = (await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const beforeLocations = (await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const beforeLogos = (await pool.query(`SELECT count(*)::int n FROM organization_logo_history`)).rows[0].n;
    // org + brand(logo) + term + one good contact + one good location, then a DUPLICATE-address
    // location forces a 409 at the very last stage → the WHOLE tx rolls back.
    const res = await atomic({
      organization: { canonical_name: name, account_type: "schools_underclass_portraits", client_entity_kind: "parent_organization" },
      brand: { mascot: "Ghosts", brand_status: "known", logo_url: "https://img.example/ghost.png", logo_status: "current" },
      initial_service_term: { period_type: "school_year", period_label: `Ghost ${stamp}` },
      contacts: [{ first_name: "Ghost", last_name: "Contact", email: `ghost-${stamp}@atomic.example.com` }],
      locations: [
        { location_name: "GhostGym", address_line_1: "7 Phantom Rd", city: "Plymouth", state: "MN", zip: "55446" },
        { location_name: "GhostGym", address_line_1: "7 Phantom Rd", city: "Plymouth", state: "MN", zip: "55446" }
      ]
    });
    expect(res.status).toBe(409);
    // nothing persisted at ANY stage
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, name])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(beforeContacts);
    expect((await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1 AND email=$2`, [tenantId, `ghost-${stamp}@atomic.example.com`])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(beforeLocations);
    expect((await pool.query(`SELECT count(*)::int n FROM shoot_location WHERE tenant_id=$1 AND name='GhostGym'`, [tenantId])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM school_service_term WHERE tenant_id=$1 AND period_label=$2`, [tenantId, `Ghost ${stamp}`])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM organization_logo_history`)).rows[0].n).toBe(beforeLogos);
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────────
  it("(35) rejects a cross-tenant existing contact id", async () => {
    const res = await atomic({
      organization: { canonical_name: `Atomic XContact ${stamp}`, account_type: "studio" },
      contacts: [{ existing_contact_id: crossContactId, client_roles: ["billing_contact"] }]
    });
    expect(res.status).toBeGreaterThanOrEqual(400); // identity not visible in this tenant
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, `Atomic XContact ${stamp}`])).rows[0].n).toBe(0);
  });

  it("(35b) rejects a cross-tenant existing location id", async () => {
    const res = await atomic({
      organization: { canonical_name: `Atomic XLoc ${stamp}`, account_type: "studio" },
      locations: [{ existing_location_id: crossLocationId }]
    });
    expect(res.status).toBe(400);
    expect((await pool.query(`SELECT count(*)::int n FROM organization WHERE tenant_id=$1 AND canonical_name=$2`, [tenantId, `Atomic XLoc ${stamp}`])).rows[0].n).toBe(0);
  });

  // ── Single atomic endpoint shape ─────────────────────────────────────────────
  it("(38) one POST /atomic returns the full result (org id + created/linked contacts + locations + primary)", async () => {
    const res = await atomic({
      organization: { canonical_name: `Atomic Shape ${stamp}`, account_type: "studio" },
      contacts: [{ first_name: "Shape", last_name: "One", email: `shape-${stamp}@atomic.example.com` }],
      locations: [{ location_name: `Shape Loc ${stamp}`, address_line_1: "3 Shape Rd", city: "Plymouth", state: "MN", zip: "55446", is_primary: true }]
    });
    expect(res.status).toBe(201);
    createdOrgIds.push(res.body.organization_id);
    expect(res.body).toMatchObject({
      organization_id: expect.any(String),
      created_contact_ids: expect.any(Array),
      linked_contact_ids: expect.any(Array),
      created_location_count: 1,
      primary_location_id: expect.any(String)
    });
  });
});
