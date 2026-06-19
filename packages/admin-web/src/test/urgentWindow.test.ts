import { describe, expect, it } from "vitest";
import type { OperationalExceptionListItem } from "../exceptionTypes";
import {
  buildUrgentWindowHash,
  buildUrgentWindowRows,
  deriveTimeState,
  deriveUrgentWindowCategory,
  filterUrgentWindowRows,
  mapExceptionToRow,
  readUrgentWindowFilters,
  URGENT_WINDOW_CATEGORY_AVAILABILITY
} from "../home/urgentWindow";

const NOW = new Date("2026-06-18T12:00:00.000Z").getTime();

function makeItem(overrides: Partial<OperationalExceptionListItem> = {}): OperationalExceptionListItem {
  return {
    id: "item-1",
    entity_type: "shoot",
    entity_id: "shoot-abc",
    workflow_run_id: null,
    category: "staffing",
    type: "critical_role_gap",
    severity: "blocking",
    severity_label: "Blocking",
    blocking: true,
    status: "open",
    owner_user_id: null,
    owner_label: null,
    assigned_team_id: null,
    source_module: "scheduling",
    source_module_label: "Scheduling",
    source_entity_label: null,
    scope_department: "schools",
    title: "Edina Soccer needs a lead",
    summary: "No lead assigned.",
    due_at: null,
    due_label: null,
    timing_state: "overdue",
    timing_label: "Overdue",
    next_action_label: "Open Scheduling",
    action_hash: "#scheduling?area=staffing&shoot=shoot-abc",
    operational_impact_score: 1,
    snoozed_until: null,
    status_detail: null,
    resolution_note: null,
    source_snapshot: {},
    created_at: "2026-06-18T00:00:00.000Z",
    updated_at: "2026-06-18T00:00:00.000Z",
    resolved_at: null,
    ...overrides
  };
}

describe("urgent window read model", () => {
  it("maps each source_module/category onto the six categories", () => {
    expect(deriveUrgentWindowCategory(makeItem({ source_module: "attendance", category: "staffing" }))).toBe("attendance");
    expect(deriveUrgentWindowCategory(makeItem({ source_module: "production", category: "production" }))).toBe("production");
    expect(deriveUrgentWindowCategory(makeItem({ source_module: "approvals", category: "approval" }))).toBe("jobs_workflow");
    expect(deriveUrgentWindowCategory(makeItem({ source_module: "workflow", category: "acknowledgement" }))).toBe("jobs_workflow");
    expect(deriveUrgentWindowCategory(makeItem({ source_module: "scheduling", category: "staffing" }))).toBe("staffing");
    expect(deriveUrgentWindowCategory(makeItem({ source_module: "scheduling", category: "schedule" }))).toBe("jobs_workflow");
  });

  it("marks client success and weather as unavailable (never live)", () => {
    expect(URGENT_WINDOW_CATEGORY_AVAILABILITY.client_success).toBe("unavailable");
    expect(URGENT_WINDOW_CATEGORY_AVAILABILITY.weather).toBe("unavailable");
    expect(URGENT_WINDOW_CATEGORY_AVAILABILITY.staffing).toBe("live");
    expect(URGENT_WINDOW_CATEGORY_AVAILABILITY.attendance).toBe("live");
  });

  it("derives the time state relative to now", () => {
    expect(deriveTimeState(null, NOW)).toBe("unscheduled");
    expect(deriveTimeState(new Date(NOW - 3600_000).toISOString(), NOW)).toBe("overdue");
    expect(deriveTimeState(new Date(NOW + 12 * 3600_000).toISOString(), NOW)).toBe("due_24h");
    expect(deriveTimeState(new Date(NOW + 48 * 3600_000).toISOString(), NOW)).toBe("due_72h");
    expect(deriveTimeState(new Date(NOW + 200 * 3600_000).toISOString(), NOW)).toBe("scheduled");
  });

  it("preserves the exact source record id and destination, and flags ownership gaps", () => {
    const row = mapExceptionToRow(makeItem({ entity_id: "shoot-xyz", action_hash: "#scheduling?shoot=shoot-xyz" }), NOW);
    expect(row.sourceId).toBe("shoot-xyz");
    expect(row.destinationHash).toBe("#scheduling?shoot=shoot-xyz");
    expect(row.provenance).toBe("urgent_watch");
    expect(row.ownerGap).toBe(true);

    const owned = mapExceptionToRow(makeItem({ owner_user_id: "user-9", owner_label: "Carisa" }), NOW);
    expect(owned.ownerGap).toBe(false);
    expect(owned.ownerLabel).toBe("Carisa");
  });

  it("dedupes overlapping rows by id so a shoot in two sources renders once", () => {
    const rows = buildUrgentWindowRows(
      [makeItem({ id: "dupe", entity_id: "shoot-1" }), makeItem({ id: "dupe", entity_id: "shoot-1" })],
      NOW
    );
    expect(rows).toHaveLength(1);
  });

  it("sorts open + blocking items first", () => {
    const rows = buildUrgentWindowRows(
      [
        makeItem({ id: "snoozed", status: "snoozed", severity: "blocking" }),
        makeItem({ id: "warn", status: "open", severity: "warning" }),
        makeItem({ id: "block", status: "open", severity: "blocking" })
      ],
      NOW
    );
    expect(rows.map((row) => row.id)).toEqual(["block", "warn", "snoozed"]);
  });

  it("filters by category, department, owner, severity, status, and time — including combined", () => {
    const rows = buildUrgentWindowRows(
      [
        makeItem({ id: "a", source_module: "attendance", scope_department: "schools", severity: "blocking", status: "open", due_at: new Date(NOW - 3600_000).toISOString() }),
        makeItem({ id: "b", source_module: "scheduling", category: "staffing", scope_department: "sports", severity: "warning", status: "open", owner_user_id: "u1", owner_label: "Josh", due_at: new Date(NOW + 12 * 3600_000).toISOString() }),
        makeItem({ id: "c", source_module: "production", category: "production", scope_department: "schools", severity: "at_risk", status: "snoozed", due_at: new Date(NOW + 48 * 3600_000).toISOString() })
      ],
      NOW
    );

    expect(filterUrgentWindowRows(rows, { ...base(), category: "attendance" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterUrgentWindowRows(rows, { ...base(), department: "sports" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterUrgentWindowRows(rows, { ...base(), owner: "unassigned" }).map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(filterUrgentWindowRows(rows, { ...base(), owner: "Josh" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterUrgentWindowRows(rows, { ...base(), severity: "blocking" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterUrgentWindowRows(rows, { ...base(), status: "snoozed" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterUrgentWindowRows(rows, { ...base(), time: "overdue" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterUrgentWindowRows(rows, { ...base(), time: "next_24h" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterUrgentWindowRows(rows, { ...base(), time: "next_72h" }).map((r) => r.id).sort()).toEqual(["b", "c"]);
    // combined: schools + open + overdue
    expect(filterUrgentWindowRows(rows, { ...base(), department: "schools", status: "open", time: "overdue" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("round-trips filters and focus through the URL contract, dropping defaults", () => {
    const built = buildUrgentWindowHash({ category: "staffing", department: "all", owner: "unassigned", severity: "all", status: "open", time: "overdue" }, "focus-7");
    expect(built).toContain("#urgent-window?");
    expect(built).toContain("category=staffing");
    expect(built).toContain("owner=unassigned");
    expect(built).toContain("status=open");
    expect(built).toContain("time=overdue");
    expect(built).toContain("focus=focus-7");
    expect(built).not.toContain("department=");
    expect(built).not.toContain("severity=");

    const params = new URLSearchParams(built.split("?")[1]);
    const read = readUrgentWindowFilters(params);
    expect(read).toEqual({ category: "staffing", department: "all", owner: "unassigned", severity: "all", status: "open", time: "overdue" });
    expect(params.get("focus")).toBe("focus-7");
  });

  it("produces a bare hash when no filters or focus are set", () => {
    expect(buildUrgentWindowHash(base(), null)).toBe("#urgent-window");
  });
});

function base() {
  return { category: "all", department: "all", owner: "all", severity: "all", status: "all", time: "all" } as const;
}
