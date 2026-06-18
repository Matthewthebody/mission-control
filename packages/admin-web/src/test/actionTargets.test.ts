import { describe, expect, it } from "vitest";
import { resolveActionTarget, type ActionTarget } from "../home/actionTargets";

describe("resolveActionTarget (actionability contract)", () => {
  it("resolves each connected source type to its canonical route", () => {
    expect(resolveActionTarget({ sourceType: "job" })).toEqual({ available: true, hash: "#jobs" });
    expect(resolveActionTarget({ sourceType: "project_tracking" })).toEqual({
      available: true,
      hash: "#project-tracking"
    });
    expect(resolveActionTarget({ sourceType: "production" })).toEqual({ available: true, hash: "#production" });
    expect(resolveActionTarget({ sourceType: "attendance" })).toEqual({
      available: true,
      hash: "#employees/attendance"
    });
    expect(resolveActionTarget({ sourceType: "client_case" })).toEqual({
      available: true,
      hash: "#client-command-center"
    });
    expect(resolveActionTarget({ sourceType: "schedule" })).toEqual({ available: true, hash: "#schedule" });
  });

  it("preserves query params already baked into a base route", () => {
    expect(resolveActionTarget({ sourceType: "staffing" })).toEqual({
      available: true,
      hash: "#operations/staffing?area=staffing"
    });
  });

  it("reports a surface with no connected provider as unavailable", () => {
    const result = resolveActionTarget({ sourceType: "weather" });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/not connected/i);
    }
  });

  it("honors an explicit unavailableReason over the route map", () => {
    const target: ActionTarget = {
      sourceType: "weather",
      unavailableReason: "No live weather provider connected."
    };
    expect(resolveActionTarget(target)).toEqual({
      available: false,
      reason: "No live weather provider connected."
    });
  });

  it("deep-links to the exact record when a sourceId is present", () => {
    expect(resolveActionTarget({ sourceType: "job", sourceId: "abc123" })).toEqual({
      available: true,
      hash: "#jobs/abc123"
    });
    expect(resolveActionTarget({ sourceType: "client_case", sourceId: "acct-7" })).toEqual({
      available: true,
      hash: "#client-command-center/accounts/acct-7"
    });
  });

  it("merges focus filters into the destination as query params", () => {
    const result = resolveActionTarget({ sourceType: "attendance", focus: { status: "late", date: "today" } });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.hash.startsWith("#employees/attendance?")).toBe(true);
      const query = new URLSearchParams(result.hash.split("?")[1]);
      expect(query.get("status")).toBe("late");
      expect(query.get("date")).toBe("today");
    }
  });

  it("merges focus filters alongside a base route's existing query", () => {
    const result = resolveActionTarget({ sourceType: "staffing", focus: { status: "open" } });
    expect(result.available).toBe(true);
    if (result.available) {
      const query = new URLSearchParams(result.hash.split("?")[1]);
      expect(query.get("area")).toBe("staffing");
      expect(query.get("status")).toBe("open");
    }
  });
});
