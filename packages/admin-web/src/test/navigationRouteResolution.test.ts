import { describe, expect, it } from "vitest";
import { resolveRouteId, type TabKey } from "../navigation";

// Regression guards for the "registered route with no working resolveRouteId case" class of bug
// (routes silently fall through to the Home/dashboard default). Each case here was found live:
// growth/* matched the wrong sectionKey, admin/review-tools lives in hr-admin behind an #admin/
// hash, and production/operations (the Home "Production Load" action target) had no case at all.
const FULL_SHELL = false;
// Tabs required for the routes under test to be VISIBLE (otherwise pickVisibleRoute falls back to
// a section sibling and the assertion would test visibility, not resolution).
const TABS: TabKey[] = ["sales", "payroll", "compliance"];

function resolve(hash: string) {
  return resolveRouteId(hash, TABS, FULL_SHELL);
}

describe("resolveRouteId regression guards", () => {
  it("resolves #growth/* deep-links to their leadership-section routes, not Home", () => {
    expect(resolve("#growth/pipeline")).toBe("growth-pipeline");
    expect(resolve("#growth/renewals")).toBe("growth-renewals");
    expect(resolve("#growth/proposals")).toBe("growth-proposals");
  });

  it("resolves #admin/review-tools to its hr-admin route despite the #admin/ prefix", () => {
    expect(resolve("#admin/review-tools")).toBe("admin-review-tools");
  });

  it("resolves #production/operations (the Production Load action target)", () => {
    expect(resolve("#production/operations")).toBe("production-operations");
  });

  it("keeps neighboring resolvers intact", () => {
    expect(resolve("#growth")).toBe("growth");
    expect(resolve("#production/workflow-queue")).toBe("production-workflow-queue");
    expect(resolve("#schools/leadership")).toBe("schools-leadership");
    expect(resolve("#employees/compliance")).toBe("people-ops-compliance");
  });

  it("sends an unknown non-empty hash to the explicit not-found route, never silently to the dashboard (MC-AUDIT-018)", () => {
    expect(resolve("#does/not/exist")).toBe("route-not-found");
    expect(resolve("#zzz-unknown?with=params")).toBe("route-not-found");
    expect(resolve("#not-found")).toBe("route-not-found");
  });

  it("still opens the default route for an empty hash", () => {
    expect(resolveRouteId("", ["dashboard"], false)).toBe("dashboard");
    expect(resolveRouteId("#", ["dashboard"], false)).toBe("dashboard");
  });
});
