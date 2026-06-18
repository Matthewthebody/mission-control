// ── The actionability contract ────────────────────────────────────────────────
// Every count, alert, badge, and Needs Attention item resolves through this
// contract to an EXACT destination. A target is either AVAILABLE (a real route we
// can open — optionally deep-linked to a record and focused with filters) or
// UNAVAILABLE (a surface we KNOW is not connected, e.g. no weather provider) so
// the UI renders a disabled state with the reason instead of a dead enabled
// control or a fake number.
//
// This file intentionally holds NO issue truth — the six locked Needs Attention
// reasons live in needsAttention.ts. It only maps a known issue to where the user
// goes to act on it, so the same contract works for demo data today and real
// records later: when a target gains a real sourceId, the resolver upgrades a
// section link into an exact-record deep link with no caller changes.

export type ActionSourceType =
  | "job"
  | "project_tracking"
  | "production"
  | "staffing"
  | "attendance"
  | "client_case"
  | "schedule"
  | "weather";

export type ActionTarget = {
  sourceType: ActionSourceType;
  /** Canonical record id when one exists; absent on aggregate/demo targets. */
  sourceId?: string;
  /** Focus filters carried into the destination as hash query params. */
  focus?: Record<string, string>;
  /**
   * Set when we KNOW the destination is not connected (e.g. weather has no
   * provider). The UI disables the control and shows this reason — it never
   * fakes a link or a value.
   */
  unavailableReason?: string;
};

export type ResolvedTarget =
  | { available: true; hash: string }
  | { available: false; reason: string };

// Base route hash per source type. `null` means "no connected surface" — the
// resolver returns unavailable so callers disable rather than fake it. These are
// the canonical hashes from navigation.ts (resolveRouteId matches the path before
// any `?`, so focus params are always safe to append).
const SOURCE_ROUTE: Record<ActionSourceType, string | null> = {
  job: "#jobs",
  project_tracking: "#project-tracking",
  production: "#production",
  staffing: "#operations/staffing?area=staffing",
  attendance: "#employees/attendance",
  client_case: "#client-command-center",
  schedule: "#schedule",
  weather: null
};

// Record-level deep links: a known record id opens the EXACT record, not the list.
function recordHash(sourceType: ActionSourceType, sourceId: string): string | null {
  switch (sourceType) {
    case "job":
    case "project_tracking":
      return `#jobs/${sourceId}`;
    case "client_case":
      return `#client-command-center/accounts/${sourceId}`;
    default:
      return null;
  }
}

// Merge focus filters into the hash as query params, preserving any params already
// baked into the base (e.g. "#operations/staffing?area=staffing").
function withFocus(base: string, focus?: Record<string, string>): string {
  if (!focus || Object.keys(focus).length === 0) {
    return base;
  }
  const [path, existingQuery = ""] = base.split("?");
  const params = new URLSearchParams(existingQuery);
  for (const [key, value] of Object.entries(focus)) {
    params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}

export function resolveActionTarget(target: ActionTarget): ResolvedTarget {
  if (target.unavailableReason) {
    return { available: false, reason: target.unavailableReason };
  }
  const base = SOURCE_ROUTE[target.sourceType];
  if (base == null) {
    return { available: false, reason: "This surface is not connected yet." };
  }
  const deepLink = target.sourceId ? recordHash(target.sourceType, target.sourceId) : null;
  return { available: true, hash: withFocus(deepLink ?? base, target.focus) };
}
