import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";
import { backfillContactIdentities, createCanonicalContact, updateCanonicalContact, linkContactToOrganization, unlinkContactFromOrganization, updateContactRelationship, getContactRelationships, setCanonicalContactArchived, listCanonicalContacts, rollbackContactIdentityBackfill } from "../src/services/canonicalContacts.js";

// Phase 4 Slice 2 — reusable canonical Contact identity. A `contact` identity (migration
// 161) is the reusable person; org-bound `organization_contact` rows reference it via
// contact_id with per-org roles. Verifies cross-org reuse with distinct roles, the
// one-to-one backfill (dry-run + idempotent apply, never merging on name/email), RBAC,
// and tenant isolation. organization_contact.organization_id stays NOT NULL throughout.

const app = createApp();
const stamp = Date.now();
let manageToken = "";
let photographerToken = "";
let tenantId = "";
let adminUserId = "";
let districtId = "";
let schoolId = "";
let crossOrgId = "";
const createdContactIds: string[] = [];

function post(path: string, body: Record<string, unknown>, token = manageToken) {
  return request(app).post(`/api/organizations${path}`).set("Authorization", `Bearer ${token}`).send(body);
}
// The shared dev DB intermittently returns a transient 500 on the first guarded write of
// a run (observed across phases); retry idempotent creates a couple times.
async function postRetry(path: string, body: Record<string, unknown>, token = manageToken) {
  let res = await post(path, body, token);
  for (let i = 0; i < 3 && res.status >= 500; i += 1) res = await post(path, body, token);
  return res;
}
function get(path: string, token = manageToken) {
  return request(app).get(`/api/organizations${path}`).set("Authorization", `Bearer ${token}`);
}
async function makeOrg(tenant: string, label: string) {
  return (
    await pool.query(
      `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status)
       VALUES ($1,$2,$2,$2,'schools_underclass_portraits','active') RETURNING id::text`,
      [tenant, label]
    )
  ).rows[0].id;
}

beforeAll(async () => {
  manageToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${manageToken}`)).body.user.tenantId;
  adminUserId = (await pool.query(`SELECT id::text FROM app_user WHERE email='schools-office@example.com'`)).rows[0].id;
  districtId = await makeOrg(tenantId, `cc district ${stamp}`);
  schoolId = await makeOrg(tenantId, `cc school ${stamp}`);
  const otherTenant = (await pool.query(`SELECT id::text FROM tenant WHERE id <> $1 ORDER BY name LIMIT 1`, [tenantId])).rows[0].id;
  crossOrgId = await makeOrg(otherTenant, `cc xtenant ${stamp}`);
});

afterAll(async () => {
  const orgs = [districtId, schoolId, crossOrgId].filter(Boolean);
  await pool.query(`DELETE FROM organization_contact_relationship WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await pool.query(`DELETE FROM organization_contact WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  if (createdContactIds.length) await pool.query(`DELETE FROM contact WHERE id = ANY($1::uuid[])`, [createdContactIds]);
  await pool.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [orgs]);
});

describe("Phase 4 Slice 2 — reusable canonical contacts", () => {
  it("(1/4/5) one canonical Contact links to a District and a School with different roles", async () => {
    // Exercise the service directly in a rolled-back tx (the route path is covered by the
    // dry-run / RBAC / cross-tenant tests; this isolates the cross-org reuse logic).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const contact = await createCanonicalContact(client, auth, { first_name: "Sam", last_name: "Rivera", email: "sam@shared.example.com" });
      await linkContactToOrganization(client, auth, contact.id, districtId, { client_roles: ["district_contact"], is_primary: true });
      await linkContactToOrganization(client, auth, contact.id, schoolId, { client_roles: ["picture_day_contact"] });
      const rel = (await getContactRelationships(client, auth, contact.id))!;
      const roleStr = (r: any) => (Array.isArray(r.client_roles) ? r.client_roles.join(",") : String(r.client_roles ?? ""));
      const byOrg = new Map(rel.relationships.map((r: any) => [r.organization_id, roleStr(r)]));
      expect(byOrg.get(districtId)).toContain("district_contact");
      expect(byOrg.get(schoolId)).toContain("picture_day_contact"); // same person, distinct roles per org
      expect(rel.relationships.length).toBe(2);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(EDIT) editing the person propagates the new phone to every linked organization view (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const contact = await createCanonicalContact(client, auth, { first_name: "Edit", last_name: "Me", email: "edit@prop.example.com", phone: "555-0001" });
      const d = await linkContactToOrganization(client, auth, contact.id, districtId, { client_roles: ["district_contact"] });
      const s = await linkContactToOrganization(client, auth, contact.id, schoolId, { client_roles: ["picture_day_contact"] });

      const updated = await updateCanonicalContact(client, auth, contact.id, { phone: "555-9999", email: "edited@prop.example.com" });
      expect(updated.phone).toBe("555-9999");
      // the new phone + email propagate to BOTH org-bound rows (both organization views)
      const dRow = (await client.query(`SELECT phone, email FROM organization_contact WHERE id=$1`, [d.organization_contact_id])).rows[0];
      const sRow = (await client.query(`SELECT phone, email FROM organization_contact WHERE id=$1`, [s.organization_contact_id])).rows[0];
      expect(dRow.phone).toBe("555-9999");
      expect(sRow.phone).toBe("555-9999");
      expect(dRow.email).toBe("edited@prop.example.com");
      expect(sRow.email).toBe("edited@prop.example.com");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(REL-EDIT) editing one relationship's role is isolated — the other relationship and the identity are unchanged (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const contact = await createCanonicalContact(client, auth, { first_name: "Rel", last_name: "Edit", email: "rel@edit.example.com" });
      const d = await linkContactToOrganization(client, auth, contact.id, districtId, { client_roles: ["district_contact"], is_primary: true });
      const s = await linkContactToOrganization(client, auth, contact.id, schoolId, { client_roles: ["picture_day_contact"] });

      // change ONLY the School relationship role: picture_day_contact -> yearbook_contact
      const res = await updateContactRelationship(client, auth, contact.id, s.organization_contact_id, { client_roles: ["yearbook_contact"] });
      expect(res.updated).toBe(true);

      const rel = (await getContactRelationships(client, auth, contact.id))!;
      const byOrg = new Map(rel.relationships.map((r: any) => [r.organization_id, r.client_roles]));
      expect(byOrg.get(schoolId)).toContain("yearbook_contact"); // School changed
      expect(byOrg.get(schoolId)).not.toContain("picture_day_contact");
      expect(byOrg.get(districtId)).toContain("district_contact"); // District UNCHANGED
      // person identity unchanged
      expect(rel.identity.email).toBe("rel@edit.example.com");
      expect(d.organization_contact_id).toBeTruthy();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(REL-EDIT) the relationship-edit route requires management access", async () => {
    expect((await request(app).patch(`/api/organizations/contact-identities/${"00000000-0000-0000-0000-000000000000"}/links/${"00000000-0000-0000-0000-000000000000"}`).set("Authorization", `Bearer ${photographerToken}`).send({ client_roles: ["yearbook_contact"] })).status).toBe(403);
  });

  it("(EDIT) the person-edit route requires management access", async () => {
    expect((await request(app).patch(`/api/organizations/contact-identities/${"00000000-0000-0000-0000-000000000000"}`).set("Authorization", `Bearer ${photographerToken}`).send({ phone: "x" })).status).toBe(403);
  });

  it("(ARCHIVE) archiving a contact identity is soft — identity + relationships stay readable; restore reactivates (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const contact = await createCanonicalContact(client, auth, { first_name: "Arch", last_name: "Ive", email: "arch@ive.example.com" });
      await linkContactToOrganization(client, auth, contact.id, districtId, { client_roles: ["district_contact"] });

      const archived = await setCanonicalContactArchived(client, auth, contact.id, true);
      expect(archived.active_status).toBe("inactive"); // soft-archive via active_status, no hard delete

      // identity row still exists and is fully readable, relationships preserved
      const rel = (await getContactRelationships(client, auth, contact.id))!;
      expect(rel.identity.id).toBe(contact.id);
      expect(rel.relationships.map((r: any) => r.organization_id)).toContain(districtId);

      // restore returns it to active
      const restored = await setCanonicalContactArchived(client, auth, contact.id, false);
      expect(restored.active_status).toBe("active");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(ARCHIVE) the archive route requires management access", async () => {
    expect((await request(app).post(`/api/organizations/contact-identities/${"00000000-0000-0000-0000-000000000000"}/archive`).set("Authorization", `Bearer ${photographerToken}`).send({ archived: true })).status).toBe(403);
  });

  it("(LIST-ROLE) the role filter narrows the canonical list to identities holding that current role (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const yb = await createCanonicalContact(client, auth, { first_name: "Yearbook", last_name: "Person", email: `yb-${Date.now()}@role.example.com` });
      await linkContactToOrganization(client, auth, yb.id, schoolId, { client_roles: ["yearbook_contact"] });
      const billing = await createCanonicalContact(client, auth, { first_name: "Billing", last_name: "Person", email: `bill-${Date.now()}@role.example.com` });
      await linkContactToOrganization(client, auth, billing.id, schoolId, { client_roles: ["billing_contact"] });

      const filtered = await listCanonicalContacts(client, auth, { role: "yearbook_contact", limit: 100 });
      const ids = filtered.contacts.map((c) => c.id);
      expect(ids).toContain(yb.id);
      expect(ids).not.toContain(billing.id);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(UNLINK) unlinking one relationship preserves the identity and every other relationship (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const contact = await createCanonicalContact(client, auth, { first_name: "Dual", last_name: "Linked", email: "dual@unlink.example.com" });
      const districtLink = await linkContactToOrganization(client, auth, contact.id, districtId, { client_roles: ["district_contact"], is_primary: true });
      const schoolLink = await linkContactToOrganization(client, auth, contact.id, schoolId, { client_roles: ["picture_day_contact"] });

      // unlink ONLY the school relationship
      const result = await unlinkContactFromOrganization(client, auth, contact.id, schoolLink.organization_contact_id);
      expect(result.unlinked).toBe(true);

      // the identity still exists, the District relationship remains current, the School is gone from current
      const rel = (await getContactRelationships(client, auth, contact.id))!;
      expect(rel.identity.id).toBe(contact.id); // identity preserved
      const orgIds = rel.relationships.map((r: any) => r.organization_id);
      expect(orgIds).toContain(districtId); // District relationship preserved
      // the School org-bound row is archived (inactive); its current relationship ended
      expect((await client.query(`SELECT active_status FROM organization_contact WHERE id=$1`, [schoolLink.organization_contact_id])).rows[0].active_status).toBe("inactive");
      expect((await client.query(`SELECT count(*)::int n FROM organization_contact_relationship WHERE contact_id=$1 AND is_current=true`, [schoolLink.organization_contact_id])).rows[0].n).toBe(0);
      // the District org-bound row is still active
      expect((await client.query(`SELECT active_status FROM organization_contact WHERE id=$1`, [districtLink.organization_contact_id])).rows[0].active_status).toBe("active");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(UNLINK) the unlink route requires management access and 404s for a mismatched contact", async () => {
    // RBAC: a photographer cannot unlink
    expect((await request(app).delete(`/api/organizations/contact-identities/${"00000000-0000-0000-0000-000000000000"}/links/${"00000000-0000-0000-0000-000000000000"}`).set("Authorization", `Bearer ${photographerToken}`)).status).toBe(403);
    // manager unlinking a non-existent relationship → 404
    expect((await request(app).delete(`/api/organizations/contact-identities/${"00000000-0000-0000-0000-000000000000"}/links/${"00000000-0000-0000-0000-000000000000"}`).set("Authorization", `Bearer ${manageToken}`)).status).toBe(404);
  });

  it("(HTTP) the relationships route returns client_roles as a real JSON array (not a pg array string)", async () => {
    const cid = (await pool.query(`INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name) VALUES ($1,'Http','Contact','Http Contact','http contact') RETURNING id::text`, [tenantId])).rows[0].id;
    createdContactIds.push(cid);
    const oc = (await pool.query(`INSERT INTO organization_contact (tenant_id, organization_id, contact_id, first_name, last_name, full_name, normalized_full_name, active_status) VALUES ($1,$2,$3,'Http','Contact','Http Contact','http contact','active') RETURNING id::text`, [tenantId, districtId, cid])).rows[0].id;
    await pool.query(`INSERT INTO organization_contact_relationship (tenant_id, organization_id, contact_id, relationship_role, client_roles, is_current) VALUES ($1,$2,$3,'general',ARRAY['district_contact']::client_contact_role[],true)`, [tenantId, districtId, oc]);
    const res = await get(`/contact-identities/${cid}/relationships`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.relationships[0].client_roles)).toBe(true);
    expect(res.body.relationships[0].client_roles).toContain("district_contact");
    expect(res.body.relationships[0].organization_contact_id).toBeTruthy(); // stable id for unlink
  });

  it("(LIST) the contact-identity list is searchable and reports linked organization count", async () => {
    const stampName = `Zxq List ${stamp}`;
    const cid = (await pool.query(`INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, email, normalized_email) VALUES ($1,'Zxq','List',$2,$3,$4,$4) RETURNING id::text`, [tenantId, stampName, stampName.toLowerCase(), `zxq${stamp}@list.example.com`])).rows[0].id;
    createdContactIds.push(cid);
    const oc = (await pool.query(`INSERT INTO organization_contact (tenant_id, organization_id, contact_id, first_name, last_name, full_name, normalized_full_name, active_status) VALUES ($1,$2,$3,'Zxq','List',$4,$5,'active') RETURNING id::text`, [tenantId, districtId, cid, stampName, stampName.toLowerCase()])).rows[0].id;
    await pool.query(`INSERT INTO organization_contact_relationship (tenant_id, organization_id, contact_id, relationship_role, client_roles, is_current) VALUES ($1,$2,$3,'general',ARRAY['district_contact']::client_contact_role[],true)`, [tenantId, districtId, oc]);

    const res = await get(`/contact-identities?search=${encodeURIComponent("Zxq List")}`);
    expect(res.status).toBe(200);
    const found = res.body.contacts.find((c: any) => c.id === cid);
    expect(found).toBeTruthy();
    expect(found.linked_organization_count).toBe(1);
    expect(found.role_summary).toContain("district_contact");
    expect(typeof res.body.total).toBe("number");
  });

  it("(LIST) read access only: an authenticated photographer can list, unauthenticated is 401", async () => {
    expect((await get("/contact-identities", photographerToken)).status).toBe(200);
    expect((await request(app).get("/api/organizations/contact-identities")).status).toBe(401);
  });

  it("(LIST-SEARCH) the canonical list is searchable by email and by phone (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const c = await createCanonicalContact(client, auth, { first_name: "Findable", last_name: "Bymeta", email: `unique-${stamp}@findme.example.com`, phone: "555-7" + String(stamp).slice(-6) });
      const byEmail = await listCanonicalContacts(client, auth, { search: `unique-${stamp}@findme`, limit: 100 });
      expect(byEmail.contacts.map((x) => x.id)).toContain(c.id);
      const byPhone = await listCanonicalContacts(client, auth, { search: String(stamp).slice(-6), limit: 100 });
      expect(byPhone.contacts.map((x) => x.id)).toContain(c.id);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(SAME-NAME) two identities with the SAME name stay distinct — never merged (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const sharedName = `Jordan Samename ${stamp}`;
      const a = await createCanonicalContact(client, auth, { full_name: sharedName, email: `a-${stamp}@same.example.com` });
      const b = await createCanonicalContact(client, auth, { full_name: sharedName, email: `b-${stamp}@same.example.com` });
      expect(a.id).not.toBe(b.id); // two people, two identities
      const list = await listCanonicalContacts(client, auth, { search: sharedName, limit: 100 });
      const ids = list.contacts.map((x) => x.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id); // both returned — no silent merge on identical names
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(20) backfill dry-run writes nothing", async () => {
    const before = (await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    const res = await post("/contact-identities/backfill", {});
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body).toHaveProperty("one_to_one");
    const after = (await pool.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1`, [tenantId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("(2/3/8/9/21) backfill apply is one-to-one, idempotent, never merges shared email, skips identity-less rows (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // two distinct people that happen to SHARE a school inbox + one row with no identity
      const a = (await client.query(`INSERT INTO organization_contact (tenant_id, organization_id, first_name, last_name, full_name, normalized_full_name, email, active_status) VALUES ($1,$2,'Alex','Stone','Alex Stone','alex stone','office@shared.example.com','active') RETURNING id::text`, [tenantId, districtId])).rows[0].id;
      const b = (await client.query(`INSERT INTO organization_contact (tenant_id, organization_id, first_name, last_name, full_name, normalized_full_name, email, active_status) VALUES ($1,$2,'Blair','Stone','Blair Stone','blair stone','office@shared.example.com','active') RETURNING id::text`, [tenantId, schoolId])).rows[0].id;
      const invalid = (await client.query(`INSERT INTO organization_contact (tenant_id, organization_id, first_name, last_name, full_name, normalized_full_name, email, active_status) VALUES ($1,$2,'','','','',NULL,'active') RETURNING id::text`, [tenantId, districtId])).rows[0].id;
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      const dry = await backfillContactIdentities(client, auth, { dryRun: true });
      expect(dry.applied).toBe(0);
      expect(dry.possible_duplicate).toBeGreaterThanOrEqual(0);
      const applied = await backfillContactIdentities(client, auth, { dryRun: false });
      expect(applied.applied).toBe(dry.one_to_one);
      // a and b each get their OWN identity (shared email NOT merged)
      const aId = (await client.query(`SELECT contact_id::text FROM organization_contact WHERE id=$1`, [a])).rows[0].contact_id;
      const bId = (await client.query(`SELECT contact_id::text FROM organization_contact WHERE id=$1`, [b])).rows[0].contact_id;
      expect(aId).not.toBeNull();
      expect(bId).not.toBeNull();
      expect(aId).not.toBe(bId);
      // the identity-less row stays unlinked (Review Required)
      expect((await client.query(`SELECT contact_id FROM organization_contact WHERE id=$1`, [invalid])).rows[0].contact_id).toBeNull();
      // idempotent: a second apply links nothing new
      const again = await backfillContactIdentities(client, auth, { dryRun: false });
      expect(again.applied).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(C) safe-only apply creates identities for unique rows, leaves possible duplicates Review Required, and is reversible (rolled back)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auth = { authorityTier: "leadership", tenantId, id: adminUserId } as any;
      // two same-name+email rows (possible duplicate) + one unique row
      const dupA = (await client.query(`INSERT INTO organization_contact (tenant_id, organization_id, first_name, last_name, full_name, normalized_full_name, email, active_status) VALUES ($1,$2,'Robin','Vale','Robin Vale','robin vale','robin@dup.example.com','active') RETURNING id::text`, [tenantId, districtId])).rows[0].id;
      const dupB = (await client.query(`INSERT INTO organization_contact (tenant_id, organization_id, first_name, last_name, full_name, normalized_full_name, email, active_status) VALUES ($1,$2,'Robin','Vale','Robin Vale','robin vale','robin@dup.example.com','active') RETURNING id::text`, [tenantId, schoolId])).rows[0].id;
      const unique = (await client.query(`INSERT INTO organization_contact (tenant_id, organization_id, first_name, last_name, full_name, normalized_full_name, email, active_status) VALUES ($1,$2,'Casey','Unique','Casey Unique','casey unique','casey@uniq.example.com','active') RETURNING id::text`, [tenantId, districtId])).rows[0].id;

      const dry = await backfillContactIdentities(client, auth, { dryRun: true, safeOnly: true });
      const dryUnique = dry.details.find((d: any) => d.organization_contact_id === unique)!;
      const dryDup = dry.details.find((d: any) => d.organization_contact_id === dupA)!;
      expect(dryUnique.classification).toBe("safe_one_to_one");
      expect(dryUnique.proposed_action).toBe("create_identity");
      expect(dryDup.classification).toBe("possible_duplicate");
      expect(dryDup.proposed_action).toBe("review_required"); // safeOnly leaves dups for review

      const applied = await backfillContactIdentities(client, auth, { dryRun: false, safeOnly: true });
      // the unique row got an identity; the duplicates did NOT
      expect((await client.query(`SELECT contact_id FROM organization_contact WHERE id=$1`, [unique])).rows[0].contact_id).not.toBeNull();
      expect((await client.query(`SELECT contact_id FROM organization_contact WHERE id=$1`, [dupA])).rows[0].contact_id).toBeNull();
      expect((await client.query(`SELECT contact_id FROM organization_contact WHERE id=$1`, [dupB])).rows[0].contact_id).toBeNull();
      expect(applied.batch_id).toBeTruthy();

      // rollback the batch: the unique row is unlinked again and the created identity deleted
      const reversal = await rollbackContactIdentityBackfill(client, auth, applied.batch_id!);
      expect(reversal.unlinked).toBe(applied.applied);
      expect(reversal.deleted).toBe(applied.applied);
      expect((await client.query(`SELECT contact_id FROM organization_contact WHERE id=$1`, [unique])).rows[0].contact_id).toBeNull();
      expect((await client.query(`SELECT count(*)::int n FROM contact WHERE tenant_id=$1 AND source=$2`, [tenantId, `backfill:${applied.batch_id}`])).rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(17) RBAC: a non-manager cannot create a canonical contact", async () => {
    expect((await post("/contact-identities", { first_name: "No", last_name: "Access" }, photographerToken)).status).toBe(403);
  });

  it("(17) cross-tenant: cannot link a contact to another tenant's organization", async () => {
    const created = await post("/contact-identities", { first_name: "Cross", last_name: "Tenant" });
    const contactId = created.body.contact.id;
    createdContactIds.push(contactId);
    expect((await post(`/contact-identities/${contactId}/links`, { organization_id: crossOrgId, relationship_role: "general" })).status).toBe(404);
  });
});

// ── Deterministic end-to-end fixture: the exact HTTP sequence the browser drives, with REAL
//    (committed) mutations against a controlled fixture identity, then full cleanup. Mirrors the
//    18-step acceptance workflow: create → link District + School → confirm distinct roles → edit
//    person (propagates to both org records) → edit ONLY the School role (District unchanged) →
//    refresh persists → unlink School (identity + District remain) → read-only blocked →
//    cross-tenant denied → archive/restore → delete every fixture row. No demo record is touched.
describe("(E2E) full canonical contact identity workflow with real mutations + cleanup", () => {
  it("drives create → link → propagate → isolate → unlink → archive → restore through the HTTP routes and cleans up", async () => {
    let contactId = "";
    let schoolOcId = "";
    let districtOcId = "";
    try {
      // 1. create a brand-new reusable identity (real INSERT)
      const created = await postRetry("/contact-identities", { first_name: "E2E", last_name: "Persona", email: `e2e-${stamp}@persona.example.com`, phone: "555-0000" });
      expect(created.status).toBe(201);
      contactId = created.body.contact.id;
      createdContactIds.push(contactId);

      // 2. link to the District as district_contact
      const linkDistrict = await postRetry(`/contact-identities/${contactId}/links`, { organization_id: districtId, client_roles: ["district_contact"], is_primary: true });
      expect(linkDistrict.status).toBe(201);
      districtOcId = linkDistrict.body.organization_contact_id;

      // 3. link the SAME identity to the School as picture_day_contact
      const linkSchool = await postRetry(`/contact-identities/${contactId}/links`, { organization_id: schoolId, client_roles: ["picture_day_contact"] });
      expect(linkSchool.status).toBe(201);
      schoolOcId = linkSchool.body.organization_contact_id;

      // 4. relationships show ONE identity in two orgs with DISTINCT roles
      const rel1 = await get(`/contact-identities/${contactId}/relationships`);
      expect(rel1.status).toBe(200);
      const byOrg1 = new Map(rel1.body.relationships.map((r: any) => [r.organization_id, r.client_roles]));
      expect(byOrg1.get(districtId)).toContain("district_contact");
      expect(byOrg1.get(schoolId)).toContain("picture_day_contact");

      // 5. the list role filter finds this identity under district_contact
      const listByRole = await get(`/contact-identities?role=district_contact&limit=100`);
      expect(listByRole.body.contacts.some((c: any) => c.id === contactId)).toBe(true);

      // 6. edit the PERSON (new phone) — one mutation
      const patchPerson = await request(app).patch(`/api/organizations/contact-identities/${contactId}`).set("Authorization", `Bearer ${manageToken}`).send({ phone: "555-9999" });
      expect(patchPerson.status).toBe(200);

      // 7. the new phone propagated to BOTH org-bound records (District + School views)
      const orgRows = await pool.query(`SELECT organization_id::text, phone FROM organization_contact WHERE contact_id=$1`, [contactId]);
      const phones = new Map(orgRows.rows.map((r: any) => [r.organization_id, r.phone]));
      expect(phones.get(districtId)).toBe("555-9999");
      expect(phones.get(schoolId)).toBe("555-9999");

      // 8. edit ONLY the School relationship role → yearbook_contact
      const patchSchoolRole = await request(app).patch(`/api/organizations/contact-identities/${contactId}/links/${schoolOcId}`).set("Authorization", `Bearer ${manageToken}`).send({ client_roles: ["yearbook_contact"] });
      expect(patchSchoolRole.status).toBe(200);

      // 9. School changed, District UNCHANGED, identity UNCHANGED (isolation)
      const rel2 = await get(`/contact-identities/${contactId}/relationships`);
      const byOrg2 = new Map(rel2.body.relationships.map((r: any) => [r.organization_id, r.client_roles]));
      expect(byOrg2.get(schoolId)).toContain("yearbook_contact");
      expect(byOrg2.get(schoolId)).not.toContain("picture_day_contact");
      expect(byOrg2.get(districtId)).toContain("district_contact");
      expect(rel2.body.identity.email).toBe(`e2e-${stamp}@persona.example.com`);

      // 10. "refresh persists" — a fresh request returns the same committed state
      const rel2Refresh = await get(`/contact-identities/${contactId}/relationships`);
      const byOrg2Refresh = new Map(rel2Refresh.body.relationships.map((r: any) => [r.organization_id, r.client_roles]));
      expect(byOrg2Refresh.get(schoolId)).toContain("yearbook_contact");
      expect(byOrg2Refresh.get(districtId)).toContain("district_contact");

      // 11. unlink the School relationship only
      const unlink = await request(app).delete(`/api/organizations/contact-identities/${contactId}/links/${schoolOcId}`).set("Authorization", `Bearer ${manageToken}`);
      expect(unlink.status).toBe(200);

      // 12. identity + District remain; the School org-bound row is soft-archived (inactive), its
      //     current relationship ended
      const rel3 = await get(`/contact-identities/${contactId}/relationships`);
      expect(rel3.body.identity.id).toBe(contactId);
      expect(rel3.body.relationships.map((r: any) => r.organization_id)).toContain(districtId);
      expect((await pool.query(`SELECT active_status FROM organization_contact WHERE id=$1`, [schoolOcId])).rows[0].active_status).toBe("inactive");
      expect((await pool.query(`SELECT count(*)::int n FROM organization_contact_relationship WHERE contact_id=$1 AND is_current=true`, [schoolOcId])).rows[0].n).toBe(0);

      // 13. a read-only user is blocked from every mutation (server-enforced)
      expect((await request(app).patch(`/api/organizations/contact-identities/${contactId}`).set("Authorization", `Bearer ${photographerToken}`).send({ phone: "x" })).status).toBe(403);
      expect((await post(`/contact-identities/${contactId}/links`, { organization_id: districtId }, photographerToken)).status).toBe(403);
      expect((await request(app).delete(`/api/organizations/contact-identities/${contactId}/links/${districtOcId}`).set("Authorization", `Bearer ${photographerToken}`)).status).toBe(403);
      expect((await post(`/contact-identities/${contactId}/archive`, { archived: true }, photographerToken)).status).toBe(403);

      // 14. cross-tenant denied — cannot link this identity to another tenant's org
      expect((await post(`/contact-identities/${contactId}/links`, { organization_id: crossOrgId, client_roles: ["district_contact"] })).status).toBe(404);

      // 15. archive the identity (soft) — readable, not deleted
      const archive = await post(`/contact-identities/${contactId}/archive`, { archived: true });
      expect(archive.status).toBe(200);
      expect((await pool.query(`SELECT active_status FROM contact WHERE id=$1`, [contactId])).rows[0].active_status).toBe("inactive");

      // 16. archived identity + its relationships are still fully readable
      const relArchived = await get(`/contact-identities/${contactId}/relationships`);
      expect(relArchived.status).toBe(200);
      expect(relArchived.body.relationships.map((r: any) => r.organization_id)).toContain(districtId);

      // 17. restore returns it to active
      const restore = await post(`/contact-identities/${contactId}/archive`, { archived: false });
      expect(restore.status).toBe(200);
      expect((await pool.query(`SELECT active_status FROM contact WHERE id=$1`, [contactId])).rows[0].active_status).toBe("active");
    } finally {
      // 18. clean up EVERY fixture row this workflow created (no demo record touched)
      if (contactId) {
        await pool.query(`DELETE FROM organization_contact_relationship WHERE contact_id IN (SELECT id FROM organization_contact WHERE contact_id=$1)`, [contactId]);
        await pool.query(`DELETE FROM organization_contact WHERE contact_id=$1`, [contactId]);
        await pool.query(`DELETE FROM contact WHERE id=$1`, [contactId]);
      }
    }
  });
});
