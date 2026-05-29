import { describe, expect, it } from "vitest";
import { buildDashboardWidgetLayout, buildDashboardWidgets, normalizeDashboardWidgetPreferences, resolveDashboardWidgetRole } from "../src/services/jobTruth/dashboardWidgetLayout.js";

function buildAuth(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    department: "sports",
    authorityTier: "standard_employee",
    primaryJobFunctionProfile: "sports_coordinator",
    jobFunctionProfiles: ["sports_coordinator"],
    policyGrants: [],
    permissions: [],
    roles: ["employee"],
    ...overrides
  } as any;
}

function buildSummary(overrides: Record<string, number> = {}) {
  return {
    jobs_today: 4,
    jobs_next_7_days: 9,
    urgent_count: 3,
    critical_watch_count: 1,
    high_watch_count: 2,
    blocked_production_count: 2,
    overdue_approval_count: 1,
    delivery_risk_count: 1,
    staffing_gap_count: 2,
    missing_ready_confirmation_count: 1,
    overdue_checklist_count: 2,
    awaiting_checklist_approval_count: 1,
    rejected_checklist_count: 1,
    blocked_job_count: 1,
    ...overrides
  };
}

describe("dashboard widget layout", () => {
  it("resolves role-specific defaults for production users", () => {
    const auth = buildAuth({
      department: "production",
      primaryJobFunctionProfile: "production_artist",
      jobFunctionProfiles: ["production_artist"]
    });

    const widgets = buildDashboardWidgets(auth, buildSummary(), null, "home");
    const layout = buildDashboardWidgetLayout(auth, widgets, "home", null);

    expect(resolveDashboardWidgetRole(auth, "home", null)).toBe("production");
    expect(layout.supports_personalization).toBe(true);
    expect(layout.items.find((item) => item.widget_key === "blocked_production")?.required).toBe(true);
    expect(layout.items.find((item) => item.widget_key === "qa_rework_queue")?.default_visible).toBe(false);
  });

  it("normalizes saved preferences to keep required widgets visible and drop unknown keys", () => {
    const auth = buildAuth({
      authorityTier: "leadership",
      primaryJobFunctionProfile: "director_of_operations",
      jobFunctionProfiles: ["director_of_operations"]
    });

    const normalized = normalizeDashboardWidgetPreferences(auth, "home", [
      { widget_key: "blocked_production", position_index: 1, is_visible: false },
      { widget_key: "unknown_widget", position_index: 0, is_visible: true },
      { widget_key: "delivery_risks", position_index: 2, is_visible: true }
    ]);

    expect(normalized.some((item) => item.widget_key === "unknown_widget")).toBe(false);
    expect(normalized[0]).toEqual(expect.objectContaining({ widget_key: "blocked_production", is_visible: true }));
    expect(normalized.map((item) => item.widget_key)).toContain("urgent_watch_next_24h");
  });
});
