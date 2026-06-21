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
const createdOrgIds: string[] = [];

function atomic(body: Record<string, unknown>, token = manageToken) {
  return request(app).post("/api/organizations/atomic").set("Authorization", `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  manageToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${manageToken}`)).body.user.tenantId;
});

afterAll(async () => {
  if (createdOrgIds.length) {
    await pool.query(`DELETE FROM organization_contact_relationship WHERE organization_id = ANY($1::uuid[])`, [createdOrgIds]);
    await pool.query(`DELETE FROM organization_contact WHERE organization_id = ANY($1::uuid[])`, [createdOrgIds]);
    await pool.query(`DELETE FROM school_service_term WHERE organization_id = ANY($1::uuid[])`, [createdOrgIds]);
    await pool.query(`DELETE FROM shoot_location WHERE organization_id = ANY($1::uuid[])`, [createdOrgIds]);
    await pool.query(`DELETE FROM organization_logo_history WHERE organization_id = ANY($1::uuid[])`, [createdOrgIds]);
    await pool.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [createdOrgIds]);
  }
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
