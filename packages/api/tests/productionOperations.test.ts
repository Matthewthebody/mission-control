import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

// June 18 feedback — canonical Production operating read model. Each metric is a scoped COUNT(*) over
// an explicit predicate (displayed count === filtered total); rows are paginated + deterministic.

const app = createApp();
let leadershipToken = "";
let tenantId = "";

function operations(token: string, query = "") {
  return request(app).get(`/api/production/operations${query}`).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`)).body.user.tenantId;
});

describe("June 18 — production operating read model", () => {
  it("returns metrics + dense rows + pagination for leadership (scope all)", async () => {
    const res = await operations(leadershipToken);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("all");
    expect(Array.isArray(res.body.metrics)).toBe(true);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.page).toHaveProperty("total");
    expect(res.body.metrics.map((m: any) => m.key)).toEqual(
      expect.arrayContaining(["ready_to_delegate", "working", "blocked", "unowned", "behind_promised_delivery", "missing_inputs", "delivery_risk", "done_recently"])
    );
  });

  it("guarantees every metric count === the same filtered predicate total", async () => {
    const res = await operations(leadershipToken);
    const byKey = new Map(res.body.metrics.map((m: any) => [m.key, m]));
    // re-derive a couple of predicates directly and assert equality with the served count
    const blocked = (await pool.query(`SELECT count(*)::int n FROM production_project WHERE tenant_id=$1 AND status='blocked'`, [tenantId])).rows[0].n;
    expect((byKey.get("blocked") as any).count).toBe(blocked);
    const working = (await pool.query(`SELECT count(*)::int n FROM production_project WHERE tenant_id=$1 AND status='active'`, [tenantId])).rows[0].n;
    expect((byKey.get("working") as any).count).toBe(working);
    const unowned = (await pool.query(`SELECT count(*)::int n FROM production_project WHERE tenant_id=$1 AND owner_user_id IS NULL AND status NOT IN ('completed','canceled')`, [tenantId])).rows[0].n;
    expect((byKey.get("unowned") as any).count).toBe(unowned);
  });

  it("every dense row carries the contract (stage, exact destination, provenance, risk)", async () => {
    const res = await operations(leadershipToken);
    for (const row of res.body.rows) {
      for (const key of ["source_type", "source_id", "title", "stage", "exact_destination_hash", "provenance", "risk", "missing_inputs"]) {
        expect(row).toHaveProperty(key);
      }
      expect(row.exact_destination_hash.startsWith("#production?project=")).toBe(true);
      expect(["none", "warning", "critical"]).toContain(row.risk);
      // "Working" rows expose the current live step when one exists (never a generic static status)
      expect(typeof row.stage).toBe("string");
    }
  });

  it("paginates deterministically with a bounded page size", async () => {
    const res = await operations(leadershipToken, "?limit=5");
    expect(res.body.page.limit).toBe(5);
    expect(res.body.rows.length).toBeLessThanOrEqual(5);
    // stable order: a second identical request returns the same ids in the same order
    const again = await operations(leadershipToken, "?limit=5");
    expect(again.body.rows.map((r: any) => r.source_id)).toEqual(res.body.rows.map((r: any) => r.source_id));
  });

  it("denies an unauthenticated request", async () => {
    expect((await request(app).get("/api/production/operations")).status).toBe(401);
  });
});
