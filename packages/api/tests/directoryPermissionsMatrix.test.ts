import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

// Phase 4 Slice G — the canonical directory permission matrix, enforced.
// The canonical directory adopts the authority-tier floor (not per-row permission codes):
//   • Read    — any authenticated user (401 only when unauthenticated).
//   • Manage  — super_admin / leadership / director_admin, or a *_client_success /
//               customer_service_rep job-function profile (canManageCanonicalDirectoryRecords).
//   • School  — the above, or schools-supervisor / director_of_school_photography
//     foundation  (canManageSchoolFoundation).
// This test locks that contract across every Phase 4 route. Authorization is decided by the
// guard before any write, so the denial assertions are deterministic (no DB mutation).

const app = createApp();
const stamp = Date.now();
let managerToken = ""; // schools-office@ → manage + school foundation
let photographerToken = ""; // photo@ → authenticated, but neither manage nor foundation
let orgId = "";
const createdOrgIds: string[] = [];

function authed(method: "get" | "post" | "patch", path: string, token?: string) {
  const base = request(app)[method](`/api/organizations${path}`);
  return token ? base.set("Authorization", `Bearer ${token}`) : base;
}

beforeAll(async () => {
  managerToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  const created = await authed("post", "", managerToken).send({ canonical_name: `Perm Matrix School ${stamp}`, account_type: "schools_underclass_portraits" });
  orgId = created.body.organization.id;
  createdOrgIds.push(orgId);
});

afterAll(async () => {
  if (createdOrgIds.length) {
    await pool.query(`DELETE FROM school_profile WHERE organization_id = ANY($1::uuid[])`, [createdOrgIds]);
    await pool.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [createdOrgIds]);
  }
});

describe("Phase 4 Slice G — canonical directory permission matrix", () => {
  // ── Read tier: any authenticated user; 401 only when unauthenticated. ──────
  const readRoutes: Array<[string, string]> = [
    ["GET /districts", "/districts"],
    ["GET /:id/service-terms", `/${"PLACEHOLDER"}/service-terms`],
    ["GET /:id/logo-history", `/${"PLACEHOLDER"}/logo-history`]
  ];
  for (const [label, template] of readRoutes) {
    it(`read tier — ${label}: 401 unauth, 200 photographer, 200 manager`, async () => {
      const path = template.replace("PLACEHOLDER", orgId);
      expect((await authed("get", path)).status).toBe(401);
      expect((await authed("get", path, photographerToken)).status).toBe(200);
      expect((await authed("get", path, managerToken)).status).toBe(200);
    });
  }

  // ── Manage tier: denial is deterministic; the dry-run reconcile is a safe positive. ──
  const manageDenied: Array<[string, "post" | "patch", string, Record<string, unknown>]> = [
    ["POST /contact-identities", "post", "/contact-identities", { first_name: "No", last_name: "Access" }],
    ["POST /contact-identities/backfill", "post", "/contact-identities/backfill", {}],
    ["PATCH /:id/brand", "patch", `/${"PLACEHOLDER"}/brand`, { mascot: "Denied" }],
    ["POST /reconcile/districts", "post", "/reconcile/districts", {}],
    ["POST /reconcile/directory", "post", "/reconcile/directory", {}]
  ];
  for (const [label, method, template, body] of manageDenied) {
    it(`manage tier — ${label}: 401 unauth, 403 photographer`, async () => {
      const path = template.replace("PLACEHOLDER", orgId);
      expect((await authed(method, path).send(body)).status).toBe(401);
      expect((await authed(method, path, photographerToken).send(body)).status).toBe(403);
    });
  }

  it("manage tier — POST /reconcile/directory (dry-run) is allowed for a manager and writes nothing", async () => {
    const res = await authed("post", "/reconcile/directory", managerToken).send({});
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.applied).toEqual({ districts: 0, contacts: 0, brand_notes: 0 });
  });

  // ── School-foundation tier: denial is deterministic (positive path covered by
  //    schoolServiceTerm.test.ts). ────────────────────────────────────────────
  const foundationDenied: Array<[string, "post" | "patch", string, Record<string, unknown>]> = [
    ["POST /:id/service-terms", "post", `/${"PLACEHOLDER"}/service-terms`, { period_label: "2026-2027" }],
    ["POST /service-terms/:termId/activate", "post", `/service-terms/${"00000000-0000-0000-0000-000000000000"}/activate`, {}],
    ["PATCH /service-terms/:termId", "patch", `/service-terms/${"00000000-0000-0000-0000-000000000000"}`, { confirm: true }]
  ];
  for (const [label, method, template, body] of foundationDenied) {
    it(`school-foundation tier — ${label}: 401 unauth, 403 photographer`, async () => {
      const path = template.replace("PLACEHOLDER", orgId);
      expect((await authed(method, path).send(body)).status).toBe(401);
      expect((await authed(method, path, photographerToken).send(body)).status).toBe(403);
    });
  }
});
