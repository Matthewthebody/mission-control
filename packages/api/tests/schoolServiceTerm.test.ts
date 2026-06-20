import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

// Phase 4 Slice 4 — school-year / season service terms. The canonical time-bound layer
// (migration 160). Additive; separate from static account truth and dated Job/Shoot
// truth. Verifies create, historical preservation, explicit current-term selection,
// rollover (inherited-not-confirmed), confirm/change, duplicate prevention, RBAC, RLS.

const app = createApp();
const stamp = Date.now();
let manageToken = "";
let photographerToken = "";
let tenantId = "";
let orgId = "";
let crossOrgId = "";

function svc(path: string, token = manageToken) {
  return request(app).get(`/api/organizations${path}`).set("Authorization", `Bearer ${token}`);
}
function post(path: string, body: Record<string, unknown>, token = manageToken) {
  return request(app).post(`/api/organizations${path}`).set("Authorization", `Bearer ${token}`).send(body);
}
function patch(path: string, body: Record<string, unknown>, token = manageToken) {
  return request(app).patch(`/api/organizations${path}`).set("Authorization", `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  manageToken = (await devLogin(app, "schools-office@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${manageToken}`)).body.user.tenantId;
  orgId = (
    await pool.query(
      `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status)
       VALUES ($1,$2,$2,$2,'schools_underclass_portraits','active') RETURNING id::text`,
      [tenantId, `term org ${stamp}`]
    )
  ).rows[0].id;
  const otherTenant = (await pool.query(`SELECT id::text FROM tenant WHERE id <> $1 ORDER BY name LIMIT 1`, [tenantId])).rows[0].id;
  crossOrgId = (
    await pool.query(
      `INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status)
       VALUES ($1,$2,$2,$2,'schools_underclass_portraits','active') RETURNING id::text`,
      [otherTenant, `xterm org ${stamp}`]
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM school_service_term WHERE organization_id = ANY($1::uuid[])`, [[orgId, crossOrgId]]);
  await pool.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [[orgId, crossOrgId]]);
});

describe("Phase 4 Slice 4 — school service terms", () => {
  it("(1) creates a school-year term", async () => {
    const res = await post(`/${orgId}/service-terms`, { period_label: "2025-2026", service_config: { yearbook: true, id_cards: false } });
    expect(res.status).toBe(201);
    expect(res.body.service_term.period_type).toBe("school_year");
    expect(res.body.service_term.status).toBe("draft");
    expect(res.body.service_term.service_config.yearbook).toBe(true);
  });

  it("(2) creates a season term", async () => {
    const res = await post(`/${orgId}/service-terms`, { period_type: "season", period_label: "Spring 2026", service_config: { proofs: true } });
    expect(res.status).toBe(201);
    expect(res.body.service_term.period_type).toBe("season");
  });

  it("(3/4/10) explicit current selection: activating a newer term closes the prior current (one current, history preserved)", async () => {
    const a = (await post(`/${orgId}/service-terms`, { period_label: "2026-2027" })).body.service_term;
    await post(`/service-terms/${a.id}/activate`, {});
    const b = (await post(`/${orgId}/service-terms`, { period_label: "2027-2028" })).body.service_term;
    await post(`/service-terms/${b.id}/activate`, {});
    const list = (await svc(`/${orgId}/service-terms`)).body.service_terms;
    const aNow = list.find((t: any) => t.id === a.id);
    const bNow = list.find((t: any) => t.id === b.id);
    expect(bNow.status).toBe("current");
    expect(aNow.status).toBe("closed"); // prior current preserved as historical, not deleted
    const currents = list.filter((t: any) => t.period_type === "school_year" && t.status === "current");
    expect(currents.length).toBe(1);
  });

  it("(5/6/7) rollover copies prior config into an unconfirmed draft with inherited markers", async () => {
    const src = (await post(`/${orgId}/service-terms`, { period_label: "2030-2031", service_config: { yearbook: true, composites: "fall" } })).body.service_term;
    const res = await post(`/service-terms/${src.id}/rollover`, { new_period_label: "2031-2032" });
    expect(res.status).toBe(201);
    const draft = res.body.service_term;
    expect(draft.status).toBe("draft");
    expect(draft.confirmation_state).toBe("unconfirmed"); // never silently confirmed
    expect(draft.copied_from_term_id).toBe(src.id);
    expect(draft.inherited_field_keys.sort()).toEqual(["composites", "yearbook"]);
    expect(draft.service_config).toEqual({ yearbook: true, composites: "fall" });
  });

  it("(8/9) confirming and changing a copied value does not touch the source term", async () => {
    const src = (await post(`/${orgId}/service-terms`, { period_label: "2040-2041", service_config: { yearbook: true } })).body.service_term;
    const draft = (await post(`/service-terms/${src.id}/rollover`, { new_period_label: "2041-2042" })).body.service_term;
    const confirmed = (await patch(`/service-terms/${draft.id}`, { service_config: { yearbook: false }, confirm: true })).body.service_term;
    expect(confirmed.confirmation_state).toBe("confirmed");
    expect(confirmed.service_config.yearbook).toBe(false);
    const srcAfter = (await svc(`/${orgId}/service-terms`)).body.service_terms.find((t: any) => t.id === src.id);
    expect(srcAfter.service_config.yearbook).toBe(true); // prior year unchanged
    expect(srcAfter.confirmation_state).toBe("unconfirmed");
  });

  it("(10) rejects a duplicate (org, period_type, label)", async () => {
    await post(`/${orgId}/service-terms`, { period_label: "2050-2051" });
    const dup = await post(`/${orgId}/service-terms`, { period_label: "2050-2051" });
    expect(dup.status).toBe(409);
  });

  it("(11) creating a term does not modify static organization data", async () => {
    const before = (await pool.query(`SELECT canonical_name, account_type FROM organization WHERE id=$1`, [orgId])).rows[0];
    await post(`/${orgId}/service-terms`, { period_label: "2060-2061" });
    const after = (await pool.query(`SELECT canonical_name, account_type FROM organization WHERE id=$1`, [orgId])).rows[0];
    expect(after).toEqual(before);
  });

  it("(12) denies a non-manager (RBAC)", async () => {
    const res = await post(`/${orgId}/service-terms`, { period_label: "2070-2071" }, photographerToken);
    expect(res.status).toBe(403);
  });

  it("(13) is tenant-isolated — another tenant's org is not found", async () => {
    const res = await post(`/${crossOrgId}/service-terms`, { period_label: "2080-2081" });
    expect(res.status).toBe(404);
  });
});
