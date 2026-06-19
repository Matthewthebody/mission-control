import { describe, expect, it } from "vitest";
import type { ShootStaffingSnapshot, StaffingDashboardResponse } from "../types";
import { coverageGap, leadCoverageLabel, mergeStaffingSnapshot, rowNeedsStaffing } from "../pages/staffingBoardState";

function snapshot(shoot: Partial<ShootStaffingSnapshot["shoot"]>): ShootStaffingSnapshot {
  return {
    shoot: {
      id: "shoot-1",
      shoot_code: "S1",
      title: "Wayzata Picture Day",
      shoot_date: "2026-05-01",
      department: "schools",
      location_name: "Wayzata HS",
      location_address: null,
      planned_staff_count: 3,
      minimum_staff_count: 2,
      assigned_staff_count: 1,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_name: null,
      conflict_warning_count: 0,
      draft_shift_count: 0,
      published_shift_count: 0,
      schedule_sync_state: "clean",
      ...shoot
    }
  } as unknown as ShootStaffingSnapshot;
}

const basePayload: StaffingDashboardResponse = {
  anchor_date: "2026-05-01",
  summary: {
    shoots_today: 3,
    shoots_tomorrow: 1,
    open_staffing_slots: 4,
    shoots_missing_lead: 1,
    understaffed_shoots: 2,
    conflict_warnings: 1,
    available_staff_today: 6,
    unavailable_staff_today: 2
  },
  open_coverage: [
    {
      shoot_id: "shoot-1",
      shoot_code: "S1",
      title: "Wayzata Picture Day",
      shoot_date: "2026-05-01",
      department: "schools",
      location_label: "Wayzata HS",
      time_label: "8-12",
      assigned_staff_count: 1,
      planned_staff_count: 3,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_present: false,
      lead_name: null,
      missing_lead: true,
      under_staffed: true,
      conflict_warning_count: 1,
      sync_state: "clean",
      next_action: "Assign 2 more"
    }
  ],
  missing_lead: [],
  availability_groups: []
};

describe("staffing board merge", () => {
  it("assigning a qualified lead clears missing_lead and updates counts from the snapshot", () => {
    const merged = mergeStaffingSnapshot(
      basePayload,
      snapshot({ assigned_staff_count: 2, lead_coverage_count: 1, lead_name: "Sarah" })
    );
    const row = merged.open_coverage.find((r) => r.shoot_id === "shoot-1");
    expect(row?.missing_lead).toBe(false);
    expect(row?.lead_name).toBe("Sarah");
    expect(row?.assigned_staff_count).toBe(2);
    expect(coverageGap(row!)).toBe(1);
    expect(merged.summary.shoots_missing_lead).toBe(0);
    expect(merged.summary.open_staffing_slots).toBe(1);
  });

  it("assigning a non-lead body updates total coverage but keeps the lead requirement", () => {
    const merged = mergeStaffingSnapshot(
      basePayload,
      snapshot({ assigned_staff_count: 2, lead_coverage_count: 0, lead_name: null })
    );
    const row = merged.open_coverage.find((r) => r.shoot_id === "shoot-1");
    expect(row?.assigned_staff_count).toBe(2);
    expect(row?.missing_lead).toBe(true);
    expect(merged.summary.shoots_missing_lead).toBe(1);
    expect(merged.summary.open_staffing_slots).toBe(1);
  });

  it("a fully-staffed, lead-covered, overlap-free shoot leaves the needs-staffing lists", () => {
    const cleanBase: StaffingDashboardResponse = {
      ...basePayload,
      open_coverage: [{ ...basePayload.open_coverage[0], conflict_warning_count: 0 }]
    };
    const merged = mergeStaffingSnapshot(
      cleanBase,
      snapshot({ assigned_staff_count: 3, lead_coverage_count: 1, lead_name: "Sarah", conflict_warning_count: 0 })
    );
    expect(merged.open_coverage.find((r) => r.shoot_id === "shoot-1")).toBeUndefined();
    expect(merged.missing_lead.find((r) => r.shoot_id === "shoot-1")).toBeUndefined();
    expect(merged.summary.shoots_missing_lead).toBe(0);
    expect(merged.summary.open_staffing_slots).toBe(0);
  });

  it("preserves the schedule-overlap count — the snapshot's override-required count never bleeds into it", () => {
    // snapshot.shoot.conflict_warning_count = OVERRIDE-required (5); the row's schedule-overlap count (1) must be preserved.
    const merged = mergeStaffingSnapshot(
      basePayload,
      snapshot({ assigned_staff_count: 2, lead_coverage_count: 1, conflict_warning_count: 5 })
    );
    const row = merged.open_coverage.find((r) => r.shoot_id === "shoot-1");
    expect(row?.conflict_warning_count).toBe(1);
  });

  it("labels lead coverage distinctly from total staffing", () => {
    expect(leadCoverageLabel({ missing_lead: true, lead_name: null, required_lead_count: 1 })).toBe("Lead still required");
    expect(leadCoverageLabel({ missing_lead: false, lead_name: "Sarah", required_lead_count: 1 })).toBe("Lead: Sarah");
    expect(leadCoverageLabel({ missing_lead: false, lead_name: null, required_lead_count: 0 })).toBe("No lead required");
  });

  it("rowNeedsStaffing reflects open slots, missing lead, or schedule overlap", () => {
    const row = basePayload.open_coverage[0];
    expect(rowNeedsStaffing(row)).toBe(true);
    expect(rowNeedsStaffing({ ...row, assigned_staff_count: 3, missing_lead: false, conflict_warning_count: 0 })).toBe(false);
    expect(rowNeedsStaffing({ ...row, assigned_staff_count: 3, missing_lead: false, conflict_warning_count: 2 })).toBe(true);
  });
});
