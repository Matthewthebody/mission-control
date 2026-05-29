import type { BusinessRole } from "../../permissions";
import type { SessionUser } from "../../types";
import type { DashboardScopeId, DashboardWidgetId } from "./dashboardConfig";

export type DashboardScopeOption = {
  id: DashboardScopeId;
  label: string;
  description: string;
};

export type DashboardPreferences = {
  roleScopes: Partial<Record<BusinessRole, DashboardScopeId>>;
  widgetCollapsed: Partial<Record<DashboardWidgetId, boolean>>;
};

export type DashboardAnalyticsEvent =
  | "layout_shown"
  | "widget_impression"
  | "widget_cta_clicked"
  | "quick_action_clicked"
  | "widget_error"
  | "widget_empty"
  | "scope_changed"
  | "refresh_requested"
  | "widget_toggle";

export type DashboardAnalyticsPayload = {
  event: DashboardAnalyticsEvent;
  role: BusinessRole;
  widgetId?: DashboardWidgetId;
  analyticsId?: string;
  scope?: DashboardScopeId;
  actionId?: string;
  actionLabel?: string;
  source?: string;
  stale?: boolean;
  error?: string;
  timestamp: string;
};

const DASHBOARD_PREFERENCES_VERSION = "v1";
const DEFAULT_PREFERENCES: DashboardPreferences = {
  roleScopes: {},
  widgetCollapsed: {}
};

function getDashboardPreferencesKey(userId: string) {
  return `pmc_dashboard_preferences_${DASHBOARD_PREFERENCES_VERSION}_${userId}`;
}

export function loadDashboardPreferences(userId: string): DashboardPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(getDashboardPreferencesKey(userId));
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }
    const parsed = JSON.parse(raw) as Partial<DashboardPreferences>;
    return {
      roleScopes: parsed.roleScopes ?? {},
      widgetCollapsed: parsed.widgetCollapsed ?? {}
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveDashboardPreferences(userId: string, preferences: DashboardPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getDashboardPreferencesKey(userId), JSON.stringify(preferences));
  } catch {
    // Ignore storage failures so the dashboard still works in restricted browsers.
  }
}

export function setDashboardRoleScopePreference(
  preferences: DashboardPreferences,
  role: BusinessRole,
  scope: DashboardScopeId
): DashboardPreferences {
  return {
    ...preferences,
    roleScopes: {
      ...preferences.roleScopes,
      [role]: scope
    }
  };
}

export function setDashboardWidgetCollapsedPreference(
  preferences: DashboardPreferences,
  widgetId: DashboardWidgetId,
  collapsed: boolean
): DashboardPreferences {
  return {
    ...preferences,
    widgetCollapsed: {
      ...preferences.widgetCollapsed,
      [widgetId]: collapsed
    }
  };
}

export function isDashboardWidgetCollapsed(
  preferences: DashboardPreferences,
  widgetId: DashboardWidgetId,
  fallbackCollapsed: boolean
) {
  const persisted = preferences.widgetCollapsed[widgetId];
  return typeof persisted === "boolean" ? persisted : fallbackCollapsed;
}

export function getDashboardScopeOptions(
  role: BusinessRole,
  supportedScopes: DashboardScopeId[],
  currentUser: SessionUser
): DashboardScopeOption[] {
  if (!supportedScopes.length) {
    return [];
  }

  const options: DashboardScopeOption[] = [];

  for (const scope of supportedScopes) {
    if (scope === "department" && !currentUser.department?.trim()) {
      continue;
    }

    if (scope === "me") {
      options.push({
        id: "me",
        label: "Me",
        description:
          role === "sales_growth_staff"
            ? "Only opportunities assigned to you."
            : "Only the work directly tied to you."
      });
      continue;
    }

    if (scope === "department") {
      options.push({
        id: "department",
        label: "Department",
        description: `${formatDepartmentLabel(currentUser.department)} only.`
      });
      continue;
    }

    options.push({
      id: "company",
      label: "Company",
      description: "All visible work across the company."
    });
  }

  return options;
}

export function resolveDashboardScope(
  role: BusinessRole,
  supportedScopes: DashboardScopeId[],
  currentUser: SessionUser,
  preferences: DashboardPreferences
) {
  const available = getDashboardScopeOptions(role, supportedScopes, currentUser);
  if (!available.length) {
    return null;
  }

  const preferred = preferences.roleScopes[role];
  const resolved = available.find((scope) => scope.id === preferred) ?? available[0];
  return resolved;
}

export function getFreshnessStatus(
  loadedAt: number | null,
  staleAfterMinutes: number,
  now = Date.now()
): { label: string; stale: boolean; ageMinutes: number } | null {
  if (!loadedAt) {
    return null;
  }

  const ageMinutes = Math.max(0, Math.round((now - loadedAt) / 60_000));
  const stale = ageMinutes >= staleAfterMinutes;
  return {
    label: stale ? `Stale ${ageMinutes}m old` : `Updated ${ageMinutes}m ago`,
    stale,
    ageMinutes
  };
}

export function trackDashboardEvent(payload: Omit<DashboardAnalyticsPayload, "timestamp">) {
  if (typeof window === "undefined") {
    return;
  }

  const detail: DashboardAnalyticsPayload = {
    ...payload,
    timestamp: new Date().toISOString()
  };

  window.dispatchEvent(new CustomEvent("pmc:dashboard-analytics", { detail }));

  const dataLayer = (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
  if (Array.isArray(dataLayer)) {
    const { event, ...rest } = detail;
    dataLayer.push({
      event: "pmc.dashboard",
      dashboardEvent: event,
      ...rest
    });
  }
}

function formatDepartmentLabel(value: string | null | undefined) {
  if (!value?.trim()) {
    return "Your department";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
