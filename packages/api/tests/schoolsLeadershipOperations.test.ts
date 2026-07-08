import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { devLogin } from "./helpers.js";

// Phase 6A — Schools Leadership & CSR operating read model. One server-side aggregate; every enabled
// category's count IS its issues.length (displayed === filtered); unavailable categories are explicit.

const app = createApp();
let leadershipToken = "";
let photographerToken = "";

function operations(token: string) {
  return request(app).get("/api/schools/leadership/operations").set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
});

describe("Phase 6A — schools leadership operations read model", () => {
  it("returns Current Season + Building Next Season sections for leadership", async () => {
    const res = await operations(leadershipToken);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("all");
    expect(Array.isArray(res.body.sections.current_season)).toBe(true);
    expect(Array.isArray(res.body.sections.building_next_season)).toBe(true);
    expect(res.body.sections.current_season.length).toBeGreaterThan(0);
  });

  it("guarantees displayed count === filtered result count for every enabled category", async () => {
    const res = await operations(leadershipToken);
    const all = [...res.body.sections.current_season, ...res.body.sections.building_next_season];
    for (const category of all) {
      if (category.available) {
        expect(category.count).toBe(category.issues.length); // no decorative counts
      } else {
        expect(category.count).toBeNull();
        expect(typeof category.reason).toBe("string");
        expect(category.reason.length).toBeGreaterThan(0);
        expect(category.issues).toBeUndefined();
      }
    }
  });

  it("marks categories with no canonical source explicitly unavailable (no fake count, no dead action)", async () => {
    const res = await operations(leadershipToken);
    const all = [...res.body.sections.current_season, ...res.body.sections.building_next_season];
    const byCat = new Map(all.map((c: any) => [c.category, c]));
    for (const cat of ["schedule_change_requests", "declined_replacement_staffing", "unresolved_client_communication_cases", "rebooking_state"]) {
      const c = byCat.get(cat) as any;
      expect(c).toBeTruthy();
      expect(c.available).toBe(false);
      expect(c.count).toBeNull();
    }
  });

  it("every enabled issue carries the normalized contract (destination, provenance, ownership, action)", async () => {
    const res = await operations(leadershipToken);
    const all = [...res.body.sections.current_season, ...res.body.sections.building_next_season];
    const issues = all.filter((c: any) => c.available).flatMap((c: any) => c.issues);
    for (const issue of issues) {
      for (const key of [
        "issue_id", "section", "category", "source_type", "source_id",
        "reason", "severity", "status", "time_state", "exact_destination_hash",
        "focus_reason", "source_availability", "provenance"
      ]) {
        expect(issue).toHaveProperty(key);
      }
      expect(typeof issue.can_act).toBe("boolean");
      expect(issue.exact_destination_hash.startsWith("#")).toBe(true); // a real destination, never dead
      // a MUTATION action implies a known owner; navigation/assignment actions don't require one
      const navigationActions = ["open_shoot", "open_work_item", "assign_owner"];
      if (issue.can_act && issue.primary_action && !navigationActions.includes(issue.primary_action)) {
        expect(issue.owner_user_id).toBeTruthy();
      }
    }
  });

  it("enforces access server-side: unauthenticated denied; restricted users are scoped, not 'all'", async () => {
    // no token → 401
    expect((await request(app).get("/api/schools/leadership/operations")).status).toBe(401);
    // a restricted (non-leadership) user is either denied (403) or scoped to "own" — never "all"
    const res = await operations(photographerToken);
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) expect(res.body.scope).toBe("own");
  });
});
