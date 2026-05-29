import { describe, expect, it } from "vitest";
import {
  DANGEROUS_STAFFING_ACTION_TYPE_REGISTRY,
  STAFFING_ACTION_KIND_REGISTRY,
  createStaffingConflictEvaluationResult,
  evaluateStaffingAction,
  isDangerousStaffingActionType,
  isStaffingActionKind,
  type StaffingConflict,
  type StaffingConflictEvaluationResult,
  type StaffingValidationResult
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 2C dangerous action classification", () => {
  it("exposes deterministic dangerous action registries and runtime guards", () => {
    expect(new Set(DANGEROUS_STAFFING_ACTION_TYPE_REGISTRY).size).toBe(
      DANGEROUS_STAFFING_ACTION_TYPE_REGISTRY.length
    );
    expect(new Set(STAFFING_ACTION_KIND_REGISTRY).size).toBe(STAFFING_ACTION_KIND_REGISTRY.length);
    expect(isDangerousStaffingActionType("publish_understaffed")).toBe(true);
    expect(isDangerousStaffingActionType("publish_risky")).toBe(false);
    expect(isStaffingActionKind("publish_staffing")).toBe(true);
    expect(isStaffingActionKind("remove_staffing_assignment")).toBe(false);
  });

  it("allows clean staffing actions directly when no dangerous signals are present", () => {
    const conflictEvaluation: StaffingConflictEvaluationResult = createStaffingConflictEvaluationResult([]);

    const result = evaluateStaffingAction({
      actionKind: "assign_staffing_assignment",
      conflictEvaluation
    });

    expect(result.dangerousActionTypes).toEqual([]);
    expect(result.directActionAllowed).toBe(true);
    expect(result.actionAllowed).toBe(true);
    expect(result.overrideRequirement).toBeNull();
  });

  it("classifies assignment conflict overrides as dangerous staffing actions", () => {
    const conflictEvaluation: StaffingConflictEvaluationResult = createStaffingConflictEvaluationResult([
      {
        conflictType: "shift_overlap",
        severity: "override_required",
        message: "The selected employee already has an overlapping shift."
      } satisfies StaffingConflict
    ]);

    const result = evaluateStaffingAction({
      actionKind: "assign_staffing_assignment",
      conflictEvaluation
    });

    expect(result.dangerousActionTypes).toEqual(["assign_with_conflict_override"]);
    expect(result.directActionAllowed).toBe(false);
    expect(result.actionAllowed).toBe(true);
    expect(result.overrideRequirement).toMatchObject({
      required: true,
      requiredCapabilities: ["override_staffing_conflict"],
      dangerousActionTypes: ["assign_with_conflict_override"]
    });
  });

  it("classifies publish overrides from staffing validation and conflict warnings", () => {
    const conflictEvaluation: StaffingConflictEvaluationResult = createStaffingConflictEvaluationResult([
      {
        conflictType: "assignment_overlap",
        severity: "override_required",
        message: "An adjacent assignment overlaps with this publish window."
      } satisfies StaffingConflict
    ]);

    const staffingValidation: StaffingValidationResult = {
      staffingValidationPassed: false,
      requirementId: "requirement-123",
      shootId: "shoot-123",
      staffingCoverage: {
        plannedStaffCount: 3,
        assignedStaffCount: 2,
        missingStaffCount: 1,
        excessStaffCount: 0,
        coverageSatisfied: false,
        countedAssignmentIds: ["assignment-1", "assignment-2"]
      },
      requiredRoleCoverage: [],
      leadCoverage: {
        leadRequirementType: "at_least_one_lead",
        requiredLeadCount: 1,
        assignedLeadCount: 0,
        missingLeadCount: 1,
        leadCoverageSatisfied: false,
        countedAssignmentIds: []
      },
      blockingAreas: ["minimum_staffing_coverage", "lead_coverage"]
    };

    const result = evaluateStaffingAction({
      actionKind: "publish_staffing",
      conflictEvaluation,
      staffingValidation
    });

    expect(result.dangerousActionTypes).toEqual([
      "publish_with_conflict_warnings",
      "publish_without_lead_coverage",
      "publish_understaffed"
    ]);
    expect(result.directActionAllowed).toBe(false);
    expect(result.actionAllowed).toBe(true);
    expect(result.overrideRequirement).toMatchObject({
      required: true,
      requiredCapabilities: ["override_staffing_warnings"]
    });
  });

  it("blocks staffing actions on hard conflicts without emitting an override requirement", () => {
    const conflictEvaluation: StaffingConflictEvaluationResult = createStaffingConflictEvaluationResult([
      {
        conflictType: "pto_unavailable",
        severity: "blocking",
        message: "This employee has approved PTO during the staffing window."
      } satisfies StaffingConflict
    ]);

    const result = evaluateStaffingAction({
      actionKind: "assign_staffing_assignment",
      conflictEvaluation
    });

    expect(result.actionAllowed).toBe(false);
    expect(result.directActionAllowed).toBe(false);
    expect(result.overrideRequirement).toBeNull();
    expect(result.hardConflicts).toHaveLength(1);
  });
});
