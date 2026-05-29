import { describe, expect, it } from "vitest";
import {
  buildOperationalExceptionHomeReadySummary,
  buildOperationalExceptionWorkspaceSummary,
  buildUrgentWatchHomeReadySummary,
  buildUrgentWatchWorkspaceSummary
} from "../src/services/urgentWatch.js";
import type { UrgentWatchListItem } from "../src/types/urgentWatch.js";

function makeWatchItem(
  id: string,
  input: Partial<UrgentWatchListItem> = {}
): UrgentWatchListItem {
  return {
    id,
    source_module: "scheduling",
    source_module_label: "Scheduling",
    source_entity_type: "shoot",
    source_entity_id: `shoot-${id}`,
    source_entity_label: `DEMO-${id}`,
    scope_department: "schools",
    watch_type: "critical_role_gap",
    watch_type_label: "Critical Role Gap",
    status: "active",
    severity: "red",
    severity_label: "Red",
    title: `Watch ${id}`,
    summary: `Summary ${id}`,
    owner_user_id: null,
    owner_label: "Needs owner",
    due_at: "2026-03-31T12:00:00.000Z",
    due_label: "3/31/2026, 7:00:00 AM",
    timing_state: "overdue",
    timing_label: "Overdue by 1h",
    next_action_label: "Open Scheduling",
    action_hash: `#scheduling?shoot=shoot-${id}`,
    operational_impact_score: 100,
    snoozed_until: null,
    status_detail: null,
    source_snapshot: {},
    created_at: "2026-03-31T10:00:00.000Z",
    updated_at: "2026-03-31T10:00:00.000Z",
    ...input
  };
}

describe("urgent watch summary helpers", () => {
  it("counts only active red and yellow items in the workspace summary", () => {
    const items = [
      makeWatchItem("active-red"),
      makeWatchItem("snoozed-red", {
        status: "snoozed",
        snoozed_until: "2026-03-31T14:00:00.000Z",
        status_detail: "Snoozed until 3/31/2026, 9:00:00 AM"
      }),
      makeWatchItem("active-yellow", {
        severity: "yellow",
        severity_label: "Yellow",
        timing_state: "at_risk",
        timing_label: "At risk in 2d",
        due_at: "2026-04-02T12:00:00.000Z",
        due_label: "4/2/2026, 7:00:00 AM"
      })
    ];

    expect(buildUrgentWatchWorkspaceSummary(items)).toEqual({
      active_count: 2,
      red_count: 1,
      yellow_count: 1,
      overdue_count: 1,
      snoozed_count: 1
    });
  });

  it("uses all active red items in the home summary line even when only five cards are shown", () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      makeWatchItem(`red-${index + 1}`, {
        title: `Red ${index + 1}`,
        operational_impact_score: 120 - index
      })
    );

    const summary = buildUrgentWatchHomeReadySummary(items);
    expect(summary.visible).toBe(true);
    expect(summary.tone).toBe("action_needed");
    expect(summary.urgent_count).toBe(6);
    expect(summary.items).toHaveLength(5);
    expect(summary.summary_line).toBe("6 red watch items need action now.");
  });

  it("maps the canonical exception summary from the same ranked queue", () => {
    const workspaceSummary = buildOperationalExceptionWorkspaceSummary([
      {
        id: "blocking",
        entity_type: "shoot",
        entity_id: "shoot-blocking",
        workflow_run_id: null,
        category: "staffing",
        type: "critical_role_gap",
        severity: "blocking",
        severity_label: "Blocking",
        blocking: true,
        status: "open",
        owner_user_id: null,
        owner_label: "Needs owner",
        assigned_team_id: null,
        source_module: "scheduling",
        source_module_label: "Scheduling",
        scope_department: "schools",
        title: "Blocking exception",
        summary: "Blocking staffing gap.",
        due_at: "2026-03-31T12:00:00.000Z",
        due_label: "3/31/2026, 7:00:00 AM",
        timing_state: "overdue",
        timing_label: "Overdue by 1h",
        next_action_label: "Open Scheduling",
        action_hash: "#scheduling?shoot=shoot-blocking",
        operational_impact_score: 100,
        snoozed_until: null,
        status_detail: null,
        resolution_note: null,
        source_snapshot: {},
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:00:00.000Z",
        resolved_at: null
      },
      {
        id: "warning",
        entity_type: "shoot",
        entity_id: "shoot-warning",
        workflow_run_id: null,
        category: "data",
        type: "missing_contact_info",
        severity: "warning",
        severity_label: "Warning",
        blocking: false,
        status: "open",
        owner_user_id: null,
        owner_label: "Needs owner",
        assigned_team_id: null,
        source_module: "scheduling",
        source_module_label: "Scheduling",
        scope_department: "schools",
        title: "Warning exception",
        summary: "Missing contact info.",
        due_at: "2026-04-02T12:00:00.000Z",
        due_label: "4/2/2026, 7:00:00 AM",
        timing_state: "at_risk",
        timing_label: "At risk in 2d",
        next_action_label: "Open Scheduling",
        action_hash: "#scheduling?shoot=shoot-warning",
        operational_impact_score: 80,
        snoozed_until: null,
        status_detail: null,
        resolution_note: null,
        source_snapshot: {},
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:00:00.000Z",
        resolved_at: null
      },
      {
        id: "snoozed",
        entity_type: "shoot",
        entity_id: "shoot-snoozed",
        workflow_run_id: null,
        category: "schedule",
        type: "unconfirmed_shoot",
        severity: "warning",
        severity_label: "Warning",
        blocking: false,
        status: "snoozed",
        owner_user_id: null,
        owner_label: "Needs owner",
        assigned_team_id: null,
        source_module: "scheduling",
        source_module_label: "Scheduling",
        scope_department: "schools",
        title: "Snoozed exception",
        summary: "Temporarily snoozed.",
        due_at: "2026-04-02T12:00:00.000Z",
        due_label: "4/2/2026, 7:00:00 AM",
        timing_state: "at_risk",
        timing_label: "At risk in 2d",
        next_action_label: "Open Scheduling",
        action_hash: "#scheduling?shoot=shoot-snoozed",
        operational_impact_score: 60,
        snoozed_until: "2026-04-01T12:00:00.000Z",
        status_detail: "Snoozed until tomorrow",
        resolution_note: null,
        source_snapshot: {},
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:00:00.000Z",
        resolved_at: null
      }
    ]);

    expect(workspaceSummary).toEqual({
      open_count: 2,
      blocking_count: 1,
      at_risk_count: 0,
      warning_count: 1,
      overdue_count: 1,
      snoozed_count: 1
    });

    const homeSummary = buildOperationalExceptionHomeReadySummary([
      {
        id: "blocking",
        entity_type: "shoot",
        entity_id: "shoot-blocking",
        workflow_run_id: null,
        category: "staffing",
        type: "critical_role_gap",
        severity: "blocking",
        severity_label: "Blocking",
        blocking: true,
        status: "open",
        owner_user_id: null,
        owner_label: "Needs owner",
        assigned_team_id: null,
        source_module: "scheduling",
        source_module_label: "Scheduling",
        scope_department: "schools",
        title: "Blocking exception",
        summary: "Blocking staffing gap.",
        due_at: "2026-03-31T12:00:00.000Z",
        due_label: "3/31/2026, 7:00:00 AM",
        timing_state: "overdue",
        timing_label: "Overdue by 1h",
        next_action_label: "Open Scheduling",
        action_hash: "#scheduling?shoot=shoot-blocking",
        operational_impact_score: 100,
        snoozed_until: null,
        status_detail: null,
        resolution_note: null,
        source_snapshot: {},
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:00:00.000Z",
        resolved_at: null
      }
    ]);

    expect(homeSummary.tone).toBe("action_needed");
    expect(homeSummary.summary_line).toBe("1 blocking exception needs action now.");
    expect(homeSummary.items).toHaveLength(1);
  });
});
