import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";
import { normalizeWebsite, parseLegacyBrandFromNotes, updateOrganizationBrand, getLogoHistory, restoreOrganizationLogo } from "../src/services/organizationBrand.js";

// Phase 4 Slice 3 — canonical brand, website normalization, and logo history (migration
// 162). Brand truth in real columns (not the notes blob); a single website normalizer;
// an append-only logo history with restore. Pure functions are unit-tested; DB behavior
// runs in a rolled-back transaction.

const app = createApp();
const stamp = Date.now();
let tenantId = "";
let adminUserId = "";
let orgId = "";

beforeAll(async () => {
  const token = (await devLogin(app, "schools-office@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.user.tenantId;
  adminUserId = (await pool.query(`SELECT id::text FROM app_user WHERE email='schools-office@example.com'`)).rows[0].id;
  orgId = (
    await pool.query(
      `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status)
       VALUES ($1,$2,$2,$2,'studio','active') RETURNING id::text`,
      [tenantId, `brand org ${stamp}`]
    )
  ).rows[0].id;
});
afterAll(async () => {
  await pool.query(`DELETE FROM organization_logo_history WHERE organization_id=$1`, [orgId]);
  await pool.query(`DELETE FROM organization WHERE id=$1`, [orgId]);
});

describe("Phase 4 Slice 3 — website normalization (pure)", () => {
  it("(1) a bare domain gets https://", () => expect(normalizeWebsite("example.org")).toBe("https://example.org"));
  it("(1) www is normalized + host lowercased + trailing slash dropped", () => expect(normalizeWebsite("WWW.Example.ORG/")).toBe("https://www.example.org"));
  it("(2) an existing scheme is preserved", () => expect(normalizeWebsite("http://example.org/path")).toBe("http://example.org/path"));
  it("(3) an unsafe protocol is rejected", () => expect(() => normalizeWebsite("javascript:alert(1)")).toThrowError(/protocol/i));
  it("(3) a data: URL is rejected", () => expect(() => normalizeWebsite("data:text/html,x")).toThrowError(/protocol/i));
  it("blank is null", () => expect(normalizeWebsite("  ")).toBeNull());
});

describe("Phase 4 Slice 3 — legacy notes brand parser (pure, dry-run)", () => {
  it("(13/14) deterministically extracts packed brand tokens", () => {
    const parsed = parseLegacyBrandFromNotes("Directory Details:\nWebsite: x.com\nPrimary Color: Navy\nMascot: Bears\nMain Phone: 555-1");
    expect(parsed.website).toBe("x.com");
    expect(parsed.primary_color).toBe("Navy");
    expect(parsed.mascot).toBe("Bears");
    expect(parsed.main_phone).toBe("555-1");
  });
  it("(15) returns nulls for absent tokens (nothing fabricated)", () => {
    expect(parseLegacyBrandFromNotes("just a plain note")).toEqual({ website: null, main_phone: null, primary_color: null, secondary_color: null, mascot: null, logo_status: null });
  });
});

describe("Phase 4 Slice 3 — brand + logo history (DB, rolled back)", () => {
  const auth = () => ({ authorityTier: "leadership", tenantId, id: adminUserId } as any);

  it("(4/10/11/12) persists brand colors, mascot, normalized website, and state in canonical columns", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await updateOrganizationBrand(client, auth(), orgId, { brand_primary_color: "Navy", brand_secondary_color: "Gold", mascot: "Bears", brand_status: "known", website: "bears.example.org" });
      const row = (await client.query(`SELECT brand_primary_color, brand_secondary_color, mascot, brand_status, website, normalized_website FROM organization WHERE id=$1`, [orgId])).rows[0];
      expect(row.brand_primary_color).toBe("Navy");
      expect(row.mascot).toBe("Bears");
      expect(row.brand_status).toBe("known");
      expect(row.website).toBe("https://bears.example.org"); // normalized
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(8/9) records logo history on change and restores a prior logo", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await updateOrganizationBrand(client, auth(), orgId, { logo_url: "https://cdn.example.com/v1.png", logo_status: "current" });
      await updateOrganizationBrand(client, auth(), orgId, { logo_url: "https://cdn.example.com/v2.png", logo_status: "current" });
      const hist = (await getLogoHistory(client, auth(), orgId)).logo_history;
      expect(hist.length).toBe(2); // two changes recorded
      expect(hist[0].logo_url).toBe("https://cdn.example.com/v2.png"); // newest first
      // restore v1
      const v1 = hist.find((h: any) => h.logo_url === "https://cdn.example.com/v1.png");
      await restoreOrganizationLogo(client, auth(), orgId, v1.id);
      const cur = (await client.query(`SELECT logo_url FROM organization WHERE id=$1`, [orgId])).rows[0];
      expect(cur.logo_url).toBe("https://cdn.example.com/v1.png"); // restored
      expect((await getLogoHistory(client, auth(), orgId)).logo_history.length).toBe(3); // restore also recorded
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(12) rejects an invalid brand status", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(updateOrganizationBrand(client, auth(), orgId, { brand_status: "bogus" as any })).rejects.toMatchObject({ status: 400 });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("(17) cross-tenant: a non-existent org in tenant is not found", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(updateOrganizationBrand(client, auth(), "00000000-0000-0000-0000-000000000000", { mascot: "X" })).rejects.toMatchObject({ status: 404 });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
