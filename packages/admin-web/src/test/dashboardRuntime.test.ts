import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDashboardScopeOptions,
  getFreshnessStatus,
  isDashboardWidgetCollapsed,
  loadDashboardPreferences,
  resolveDashboardScope,
  saveDashboardPreferences,
  setDashboardRoleScopePreference,
  setDashboardWidgetCollapsedPreference,
  trackDashboardEvent,
  type DashboardPreferences
} from "../components/dashboard/dashboardRuntime";
import type { SessionUser } from "../types";

const standardSessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
  elevatedUntil: null,
  privilegedModeUntil: null,
  breakGlassStartedAt: null,
  breakGlassUntil: null,
  breakGlassReason: null,
  breakGlassScopeType: null,
  breakGlassScopeId: null,
  elevatedSessionActive: false,
  privilegedModeActive: false,
  breakGlassModeActive: false
};

const baseUser: SessionUser = {
  id: "user-1",
  tenantId: "tenant-1",
  accountId: "account-1",
  sessionId: "session-1",
  email: "user@example.com",
  fullName: "User One",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["sales"],
  permissions: ["sales_pipeline.view"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "account_executive",
  jobFunctionProfiles: ["account_executive"],
  permissionGrants: [],
  effectiveScopes: ["department_only"],
  sessionTrust: standardSessionTrust
};

describe("dashboard runtime helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
  });

  it("persists scope and collapsed widget preferences by user", () => {
    const initial = loadDashboardPreferences(baseUser.id);
    const withScope = setDashboardRoleScopePreference(initial, "sales_growth_staff", "company");
    const nextPreferences = setDashboardWidgetCollapsedPreference(withScope, "recent-activity", false);

    saveDashboardPreferences(baseUser.id, nextPreferences);

    const restored = loadDashboardPreferences(baseUser.id);
    expect(restored.roleScopes.sales_growth_staff).toBe("company");
    expect(isDashboardWidgetCollapsed(restored, "recent-activity", true)).toBe(false);
  });

  it("resolves only supported scope options for the current role and user", () => {
    const preferences: DashboardPreferences = {
      roleScopes: { sales_growth_staff: "company" },
      widgetCollapsed: {}
    };

    const options = getDashboardScopeOptions("sales_growth_staff", ["me", "department", "company"], baseUser);
    expect(options.map((scope) => scope.id)).toEqual(["me", "department", "company"]);

    const resolved = resolveDashboardScope("sales_growth_staff", ["me", "department", "company"], baseUser, preferences);
    expect(resolved?.id).toBe("company");

    const noDepartmentUser = { ...baseUser, department: "" };
    const departmentFiltered = getDashboardScopeOptions("sales_growth_staff", ["department", "company"], noDepartmentUser);
    expect(departmentFiltered.map((scope) => scope.id)).toEqual(["company"]);
  });

  it("marks freshness as stale once the threshold passes", () => {
    const now = new Date("2026-03-30T12:15:00.000Z").getTime();
    const fresh = getFreshnessStatus(new Date("2026-03-30T12:10:00.000Z").getTime(), 10, now);
    const stale = getFreshnessStatus(new Date("2026-03-30T11:59:00.000Z").getTime(), 10, now);

    expect(fresh).toEqual({ label: "Updated 5m ago", stale: false, ageMinutes: 5 });
    expect(stale).toEqual({ label: "Stale 16m old", stale: true, ageMinutes: 16 });
  });

  it("emits centralized dashboard analytics to both a browser event and dataLayer", () => {
    const eventListener = vi.fn();
    const dataLayer: Array<Record<string, unknown>> = [];
    (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer = dataLayer;

    window.addEventListener("pmc:dashboard-analytics", eventListener as EventListener);

    trackDashboardEvent({
      event: "widget_impression",
      role: "manager",
      widgetId: "manager-workflow",
      analyticsId: "manager-workflow",
      scope: "company"
    });

    expect(eventListener).toHaveBeenCalledTimes(1);
    const customEvent = eventListener.mock.calls[0]?.[0] as CustomEvent;
    expect(customEvent.detail).toMatchObject({
      event: "widget_impression",
      role: "manager",
      widgetId: "manager-workflow",
      analyticsId: "manager-workflow",
      scope: "company"
    });
    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toMatchObject({
      event: "pmc.dashboard",
      dashboardEvent: "widget_impression",
      role: "manager",
      widgetId: "manager-workflow",
      analyticsId: "manager-workflow"
    });

    window.removeEventListener("pmc:dashboard-analytics", eventListener as EventListener);
  });
});
