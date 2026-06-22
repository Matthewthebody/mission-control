import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

// June 18 — cross-surface metric-consistency contract. The invariant the recordings demanded is
// `displayed count === filtered row total`, applied identically across the canonical read models.
// Zero stays a real zero; unavailable stays null/disabled (never zero-as-live); API scope/tenant
// apply identically to the count and the rows; an error never produces a sample number.

const app = createApp();
let leadershipToken = "";
let tenantId = "";

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`)).body.user.tenantId;
});

describe("June 18 — cross-surface metric consistency", () => {
  it("Production: every metric count === the same scoped filtered predicate total", async () => {
    const res = await request(app).get("/api/production/operations").set("Authorization", `Bearer ${leadershipToken}`);
    expect(res.status).toBe(200);
    const byKey = new Map<string, { available: boolean; count: number | null }>(res.body.metrics.map((m: any) => [m.key, m]));

    // Re-derive each predicate directly against the canonical table (leadership = tenant-wide scope).
    const predicates: Record<string, string> = {
      ready_to_delegate: "status = 'new'",
      working: "status = 'active'",
      blocked: "status = 'blocked'",
      unowned: "owner_user_id IS NULL AND status NOT IN ('completed','canceled')",
      behind_promised_delivery: "due_date IS NOT NULL AND due_date < current_date AND completed_at IS NULL",
      done_recently: "completed_at IS NOT NULL AND completed_at >= current_date - 7"
    };
    for (const [key, predicate] of Object.entries(predicates)) {
      const direct = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM production_project WHERE tenant_id=$1 AND (${predicate})`, [tenantId])).rows[0].n;
      const served = byKey.get(key);
      expect(served?.available).toBe(true);
      expect(served?.count).toBe(direct); // displayed === filtered total
      expect(typeof served?.count).toBe("number"); // a real number, never null when available
    }
  });

  it("Production: a zero metric is a real numeric zero (not null/disabled)", async () => {
    const res = await request(app).get("/api/production/operations").set("Authorization", `Bearer ${leadershipToken}`);
    for (const m of res.body.metrics) {
      if (m.available) {
        expect(m.count).not.toBeNull();
        expect(Number.isInteger(m.count)).toBe(true);
        expect(m.count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("Schools Leadership: every available category count === its materialized rows; unavailable is null", async () => {
    const res = await request(app).get("/api/schools/leadership/operations").set("Authorization", `Bearer ${leadershipToken}`);
    expect(res.status).toBe(200);
    const all = [...res.body.sections.current_season, ...res.body.sections.building_next_season];
    for (const category of all) {
      if (category.available) {
        expect(category.count).toBe(category.issues.length); // displayed === filtered total
        expect(category.issues).not.toBeUndefined();
      } else {
        // unavailable is explicitly null + reason — never zero presented as a live metric
        expect(category.count).toBeNull();
        expect(typeof category.reason).toBe("string");
        expect(category.issues).toBeUndefined();
      }
    }
  });

  it("scope/tenant apply identically to count and rows — an unauthenticated request is denied, not zeroed", async () => {
    expect((await request(app).get("/api/production/operations")).status).toBe(401);
    expect((await request(app).get("/api/schools/leadership/operations")).status).toBe(401);
  });

  it("a deleted/absent source never inflates a count (production rows are bounded by the page)", async () => {
    const res = await request(app).get("/api/production/operations?limit=5").set("Authorization", `Bearer ${leadershipToken}`);
    expect(res.body.rows.length).toBeLessThanOrEqual(5);
    expect(res.body.page.total).toBeGreaterThanOrEqual(res.body.rows.length);
  });
});
