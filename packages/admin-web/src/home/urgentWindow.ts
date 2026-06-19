import type { OperationalExceptionListItem } from "../exceptionTypes";

// ── Urgent Window read model ──────────────────────────────────────────────────
// ONE normalized view of urgent operational issues, composed from the canonical
// exception read model (GET /api/exceptions → urgent_watch_item). It deliberately
// does NOT own an issue store — it maps the canonical, already-deduped items into a
// filterable, honestly-labeled shape. Categories with no live source today (client
// success, weather) are surfaced as "unavailable" rather than faked.

export type UrgentWindowCategory =
  | "staffing"
  | "attendance"
  | "jobs_workflow"
  | "production"
  | "client_success"
  | "weather";

export const URGENT_WINDOW_CATEGORIES: UrgentWindowCategory[] = [
  "staffing",
  "attendance",
  "jobs_workflow",
  "production",
  "client_success",
  "weather"
];

export const URGENT_WINDOW_CATEGORY_LABELS: Record<UrgentWindowCategory, string> = {
  staffing: "Staffing",
  attendance: "Attendance",
  // Honest label: this category is fed by scheduling/shoot, workflow-task, and
  // approval records — not canonical jobs (0 of its rows point at #jobs). The
  // internal key stays `jobs_workflow` so destinations/filters are unchanged.
  jobs_workflow: "Operational Work / Workflow",
  production: "Production / Delivery",
  client_success: "Client Success",
  weather: "Weather"
};

// Which categories have a connected live source today. Client Success and Weather
// have no urgent-watch source and no integration, so they are honestly unavailable
// (never demo-filled into the live list).
export const URGENT_WINDOW_CATEGORY_AVAILABILITY: Record<UrgentWindowCategory, "live" | "unavailable"> = {
  staffing: "live",
  attendance: "live",
  jobs_workflow: "live",
  production: "live",
  client_success: "unavailable",
  weather: "unavailable"
};

export const URGENT_WINDOW_UNAVAILABLE_REASON: Partial<Record<UrgentWindowCategory, string>> = {
  client_success: "No live client-case feed is connected yet — client issues are not tracked here.",
  weather: "No live weather provider is connected yet."
};

// Provenance: how do we know about this row? Every live row is backed by a real,
// persisted urgent-watch record. "demo" is reserved for clearly-labeled sample data
// (none today). "unavailable" marks a category with no connected source.
export type UrgentWindowProvenance = "urgent_watch" | "canonical" | "demo" | "unavailable";

export const URGENT_WINDOW_PROVENANCE_LABELS: Record<UrgentWindowProvenance, string> = {
  urgent_watch: "Live · tracked",
  canonical: "Live · canonical",
  demo: "Sample",
  unavailable: "Not connected"
};

export type UrgentTimeState = "overdue" | "due_24h" | "due_72h" | "scheduled" | "unscheduled";

export type UrgentWindowSeverity = "blocking" | "at_risk" | "warning";

const SEVERITY_LABELS: Record<UrgentWindowSeverity, string> = {
  blocking: "Blocking",
  at_risk: "At risk",
  warning: "Warning"
};

const SEVERITY_RANK: Record<UrgentWindowSeverity, number> = { blocking: 0, at_risk: 1, warning: 2 };
const TIME_RANK: Record<UrgentTimeState, number> = {
  overdue: 0,
  due_24h: 1,
  due_72h: 2,
  scheduled: 3,
  unscheduled: 4
};

export type UrgentWindowRow = {
  id: string;
  category: UrgentWindowCategory;
  provenance: UrgentWindowProvenance;
  title: string;
  reason: string;
  sourceType: string;
  sourceId: string;
  severity: UrgentWindowSeverity;
  severityLabel: string;
  department: string | null;
  ownerLabel: string;
  ownerGap: boolean;
  timeState: UrgentTimeState;
  timeLabel: string;
  dueAt: string | null;
  isDueToday: boolean;
  status: "open" | "snoozed" | "handled" | "resolved";
  destinationHash: string;
  nextActionLabel: string;
  summary: string;
};

// Map an exception's source_module + category onto the six Urgent Window categories.
export function deriveUrgentWindowCategory(item: OperationalExceptionListItem): UrgentWindowCategory {
  switch (item.source_module) {
    case "attendance":
      return "attendance";
    case "production":
      return "production";
    case "approvals":
    case "workflow":
      return "jobs_workflow";
    case "scheduling":
    default:
      if (item.category === "staffing") return "staffing";
      if (item.category === "production" || item.category === "delivery") return "production";
      // unconfirmed shoot, missing contact data, calendar sync → jobs / workflow
      return "jobs_workflow";
  }
}

export function deriveTimeState(dueAtIso: string | null, nowMs: number): UrgentTimeState {
  if (!dueAtIso) return "unscheduled";
  const due = new Date(dueAtIso).getTime();
  if (Number.isNaN(due)) return "unscheduled";
  if (due < nowMs) return "overdue";
  if (due <= nowMs + 24 * 3600 * 1000) return "due_24h";
  if (due <= nowMs + 72 * 3600 * 1000) return "due_72h";
  return "scheduled";
}

function isSameLocalDate(iso: string | null, nowMs: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date(nowMs);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// Map a canonical exception item to a normalized urgent-window row. All such rows
// are provenance "urgent_watch": real, persisted, tracked issues carrying an exact
// source record id and an exact destination (action_hash).
export function mapExceptionToRow(item: OperationalExceptionListItem, nowMs: number): UrgentWindowRow {
  return {
    id: item.id,
    category: deriveUrgentWindowCategory(item),
    provenance: "urgent_watch",
    title: item.title,
    reason: item.type,
    sourceType: item.entity_type,
    sourceId: item.entity_id,
    severity: item.severity,
    severityLabel: item.severity_label || SEVERITY_LABELS[item.severity],
    department: item.scope_department,
    ownerLabel: item.owner_label ?? "Needs owner",
    ownerGap: item.owner_user_id == null,
    timeState: deriveTimeState(item.due_at, nowMs),
    timeLabel: item.timing_label,
    dueAt: item.due_at,
    isDueToday: isSameLocalDate(item.due_at, nowMs),
    status: item.status,
    destinationHash: item.action_hash,
    nextActionLabel: item.next_action_label,
    summary: item.summary
  };
}

// Dedupe defensively by id (the canonical store already dedups by source key, so
// overlapping sources never produce duplicate rows; this is belt-and-suspenders).
export function dedupeUrgentWindowRows(rows: UrgentWindowRow[]): UrgentWindowRow[] {
  const seen = new Set<string>();
  const out: UrgentWindowRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

// Build the normalized, sorted row list from a raw exception item list.
export function buildUrgentWindowRows(items: OperationalExceptionListItem[], nowMs: number): UrgentWindowRow[] {
  const rows = dedupeUrgentWindowRows(items.map((item) => mapExceptionToRow(item, nowMs)));
  return rows.sort((a, b) => {
    const status = (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
    if (status !== 0) return status;
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    const time = TIME_RANK[a.timeState] - TIME_RANK[b.timeState];
    if (time !== 0) return time;
    return a.id.localeCompare(b.id);
  });
}

// The live unresolved count behind the Company Command "On Fire" card. It is the
// EXACT number of records the card's destination (#urgent-window?status=open)
// renders, derived from the same canonical items — so card and destination can
// never disagree.
export function countUnresolvedUrgentRows(items: OperationalExceptionListItem[], nowMs: number): number {
  return buildUrgentWindowRows(items, nowMs).filter((row) => row.status === "open").length;
}

export type UrgentWindowFilters = {
  category: UrgentWindowCategory | "all";
  department: string | "all";
  owner: string | "all"; // an owner label, "unassigned", or "all"
  severity: UrgentWindowSeverity | "all";
  status: "all" | "open" | "snoozed";
  time: "all" | "overdue" | "today" | "next_24h" | "next_72h";
};

export const URGENT_WINDOW_DEFAULT_FILTERS: UrgentWindowFilters = {
  category: "all",
  department: "all",
  owner: "all",
  severity: "all",
  status: "all",
  time: "all"
};

function matchesTime(row: UrgentWindowRow, time: UrgentWindowFilters["time"]): boolean {
  switch (time) {
    case "all":
      return true;
    case "overdue":
      return row.timeState === "overdue";
    case "today":
      return row.isDueToday;
    case "next_24h":
      return row.timeState === "due_24h";
    case "next_72h":
      return row.timeState === "due_24h" || row.timeState === "due_72h";
    default:
      return true;
  }
}

export function filterUrgentWindowRows(rows: UrgentWindowRow[], filters: UrgentWindowFilters): UrgentWindowRow[] {
  return rows.filter((row) => {
    if (filters.category !== "all" && row.category !== filters.category) return false;
    if (filters.department !== "all" && (row.department ?? "") !== filters.department) return false;
    if (filters.owner === "unassigned" && !row.ownerGap) return false;
    if (filters.owner !== "all" && filters.owner !== "unassigned" && row.ownerLabel !== filters.owner) return false;
    if (filters.severity !== "all" && row.severity !== filters.severity) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (!matchesTime(row, filters.time)) return false;
    return true;
  });
}

// ── URL contract ──────────────────────────────────────────────────────────────
// Filters + focused issue serialize to hash query params so refresh, share, and
// browser back/forward all restore the exact view.

export function readUrgentWindowFilters(params: URLSearchParams): UrgentWindowFilters {
  const get = <T extends string>(key: string, fallback: T): T => (params.get(key) as T | null) ?? fallback;
  return {
    category: get<UrgentWindowFilters["category"]>("category", "all"),
    department: get<string>("department", "all"),
    owner: get<string>("owner", "all"),
    severity: get<UrgentWindowFilters["severity"]>("severity", "all"),
    status: get<UrgentWindowFilters["status"]>("status", "all"),
    time: get<UrgentWindowFilters["time"]>("time", "all")
  };
}

export function buildUrgentWindowHash(filters: UrgentWindowFilters, focusId: string | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all") params.set(key, value);
  }
  if (focusId) params.set("focus", focusId);
  const query = params.toString();
  return query ? `#urgent-window?${query}` : "#urgent-window";
}
