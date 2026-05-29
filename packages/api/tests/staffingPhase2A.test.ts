import { describe, expect, it } from "vitest";
import {
  STAFFING_CONFLICT_SEVERITY_REGISTRY,
  STAFFING_CONFLICT_TYPE_REGISTRY,
  createStaffingConflictEvaluationResult,
  isStaffingConflictSeverity,
  isStaffingConflictType,
  type StaffingConflict,
  type StaffingConflictEvaluationResult
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 2A conflicts", () => {
  it("exposes deterministic staffing conflict registries without duplicates", () => {
    expect(new Set(STAFFING_CONFLICT_TYPE_REGISTRY).size).toBe(STAFFING_CONFLICT_TYPE_REGISTRY.length);
    expect(new Set(STAFFING_CONFLICT_SEVERITY_REGISTRY).size).toBe(
      STAFFING_CONFLICT_SEVERITY_REGISTRY.length
    );
  });

  it("provides runtime guards for staffing conflict enums", () => {
    expect(isStaffingConflictType("shift_overlap")).toBe(true);
    expect(isStaffingConflictType("availability_conflict")).toBe(false);

    expect(isStaffingConflictSeverity("override_required")).toBe(true);
    expect(isStaffingConflictSeverity("critical")).toBe(false);
  });

  it("supports explicit staffing conflict model composition", () => {
    const conflict: StaffingConflict = {
      conflictType: "calendar_overlap",
      severity: "override_required",
      message: "The selected employee already has a calendar commitment during this shoot window.",
      shootId: "shoot-123",
      employeeId: "employee-123",
      assignmentId: "assignment-123",
      metadata: {
        conflictingRecordKind: "event",
        conflictingRecordId: "event-123"
      }
    };

    expect(conflict.conflictType).toBe("calendar_overlap");
    expect(conflict.severity).toBe("override_required");
    expect(conflict.metadata?.conflictingRecordKind).toBe("event");
  });

  it("builds a split staffing conflict evaluation result for warnings, overrides, and blockers", () => {
    const conflicts: StaffingConflict[] = [
      {
        conflictType: "turnaround_gap_risk",
        severity: "warning",
        message: "The gap before the shoot is below the preferred turnaround window."
      },
      {
        conflictType: "shift_overlap",
        severity: "override_required",
        message: "The selected employee already has an overlapping shift."
      },
      {
        conflictType: "lead_qualification_missing",
        severity: "blocking",
        message: "The selected employee does not satisfy lead coverage requirements."
      }
    ];

    const result: StaffingConflictEvaluationResult = createStaffingConflictEvaluationResult(conflicts);

    expect(result.warningConflicts).toHaveLength(1);
    expect(result.overrideRequiredConflicts).toHaveLength(1);
    expect(result.blockingConflicts).toHaveLength(1);
    expect(result.hasWarnings).toBe(true);
    expect(result.requiresOverride).toBe(true);
    expect(result.hasBlockingConflicts).toBe(true);
  });
});
