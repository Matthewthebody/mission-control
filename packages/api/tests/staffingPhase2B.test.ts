import { describe, expect, it } from "vitest";
import {
  STAFFING_CONFLICT_COMMITMENT_KIND_REGISTRY,
  DEFAULT_STAFFING_DAILY_HOURS_LIMIT,
  DEFAULT_STAFFING_TURNAROUND_WARNING_MINUTES,
  DEFAULT_STAFFING_WEEKLY_HOURS_LIMIT,
  evaluateStaffingConflicts,
  isStaffingConflictCommitmentKind
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 2B conflict evaluation", () => {
  it("exposes deterministic commitment-kind registry and runtime guard", () => {
    expect(new Set(STAFFING_CONFLICT_COMMITMENT_KIND_REGISTRY).size).toBe(
      STAFFING_CONFLICT_COMMITMENT_KIND_REGISTRY.length
    );
    expect(isStaffingConflictCommitmentKind("shift")).toBe(true);
    expect(isStaffingConflictCommitmentKind("pto")).toBe(false);
  });

  it("returns direct action allowed when no hard or soft conflicts exist", () => {
    const result = evaluateStaffingConflicts({
      shootId: "shoot-123",
      employeeId: "employee-123",
      assignmentHours: 4,
      scheduledHoursToday: 2,
      scheduledHoursWeek: 20,
      beforeGapMinutes: 60,
      afterGapMinutes: 90
    });

    expect(result.conflicts).toEqual([]);
    expect(result.hardConflicts).toEqual([]);
    expect(result.softConflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.directActionAllowed).toBe(true);
    expect(result.overrideRequired).toBe(false);
  });

  it("returns a soft conflict and requires override for overlapping commitments", () => {
    const result = evaluateStaffingConflicts({
      shootId: "shoot-456",
      employeeId: "employee-456",
      assignmentId: "assignment-456",
      conflictingCommitmentKind: "event",
      conflictingCommitmentId: "event-456",
      conflictingCommitmentTitle: "District calendar hold"
    });

    expect(result.hardConflicts).toHaveLength(0);
    expect(result.softConflicts).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.softConflicts[0]).toMatchObject({
      conflictType: "calendar_overlap",
      severity: "override_required"
    });
    expect(result.directActionAllowed).toBe(false);
    expect(result.overrideRequired).toBe(true);
  });

  it("returns hard conflicts for PTO and missing lead qualification", () => {
    const result = evaluateStaffingConflicts({
      shootId: "shoot-789",
      employeeId: "employee-789",
      approvedPtoToday: true,
      leadCoverageRequired: true,
      leadQualified: false
    });

    expect(result.hardConflicts).toHaveLength(2);
    expect(result.softConflicts).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.directActionAllowed).toBe(false);
    expect(result.overrideRequired).toBe(false);
    expect(result.hardConflicts.map((conflict) => conflict.conflictType)).toEqual([
      "pto_unavailable",
      "lead_qualification_missing"
    ]);
  });

  it("returns warnings without blocking direct action for turnaround and overtime watch", () => {
    const result = evaluateStaffingConflicts({
      shootId: "shoot-321",
      employeeId: "employee-321",
      assignmentHours: 5,
      scheduledHoursToday: DEFAULT_STAFFING_DAILY_HOURS_LIMIT - 1,
      scheduledHoursWeek: DEFAULT_STAFFING_WEEKLY_HOURS_LIMIT - 2,
      beforeGapMinutes: DEFAULT_STAFFING_TURNAROUND_WARNING_MINUTES - 5,
      afterGapMinutes: 120
    });

    expect(result.hardConflicts).toHaveLength(0);
    expect(result.softConflicts).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((conflict) => conflict.conflictType)).toEqual([
      "turnaround_gap_risk",
      "overtime_risk"
    ]);
    expect(result.directActionAllowed).toBe(true);
    expect(result.overrideRequired).toBe(false);
  });
});
