import { describe, expect, it } from "vitest";
import {
  STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY,
  STAFFING_VALIDATION_BLOCKING_AREA_REGISTRY,
  validateStaffingCoverage,
  type StaffingAssignment,
  type StaffingRequirement
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 1C validation", () => {
  it("exposes deterministic staffing validation registries without duplicates", () => {
    expect(new Set(STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY).size).toBe(
      STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY.length
    );
    expect(new Set(STAFFING_VALIDATION_BLOCKING_AREA_REGISTRY).size).toBe(
      STAFFING_VALIDATION_BLOCKING_AREA_REGISTRY.length
    );
  });

  it("passes when minimum staffing, required role coverage, and lead coverage are satisfied", () => {
    const requirement: StaffingRequirement = {
      requirementId: "requirement-123",
      shootId: "shoot-123",
      publicationState: "draft",
      plannedStaffCount: 3,
      leadRequirementType: "at_least_one_lead",
      requiredLeadCount: 1,
      requiredRoles: [
        {
          assignmentRole: "lead_photographer",
          label: "Lead Photographer",
          requiredHeadcount: 1,
          countsTowardLeadCoverage: true,
          sortOrder: 0
        },
        {
          assignmentRole: "photographer",
          label: "Photographer",
          requiredHeadcount: 2,
          countsTowardLeadCoverage: false,
          sortOrder: 1
        }
      ]
    };

    const assignments: StaffingAssignment[] = [
      {
        assignmentId: "assignment-1",
        shootId: "shoot-123",
        employeeId: "employee-1",
        assignmentRole: "lead_photographer",
        assignmentStatus: "assigned",
        countsTowardLeadCoverage: true
      },
      {
        assignmentId: "assignment-2",
        shootId: "shoot-123",
        employeeId: "employee-2",
        assignmentRole: "photographer",
        assignmentStatus: "draft",
        countsTowardLeadCoverage: false
      },
      {
        assignmentId: "assignment-3",
        shootId: "shoot-123",
        employeeId: "employee-3",
        assignmentRole: "photographer",
        assignmentStatus: "completed",
        countsTowardLeadCoverage: false
      }
    ];

    const result = validateStaffingCoverage(requirement, assignments);

    expect(result.staffingValidationPassed).toBe(true);
    expect(result.blockingAreas).toEqual([]);
    expect(result.staffingCoverage).toMatchObject({
      plannedStaffCount: 3,
      assignedStaffCount: 3,
      missingStaffCount: 0,
      excessStaffCount: 0,
      coverageSatisfied: true
    });
    expect(result.requiredRoleCoverage.map((coverage) => coverage.coverageSatisfied)).toEqual([true, true]);
    expect(result.leadCoverage).toMatchObject({
      requiredLeadCount: 1,
      assignedLeadCount: 1,
      missingLeadCount: 0,
      leadCoverageSatisfied: true
    });
  });

  it("ignores cancelled and unrelated-shoot assignments when evaluating coverage", () => {
    const requirement: StaffingRequirement = {
      requirementId: "requirement-456",
      shootId: "shoot-456",
      publicationState: "ready_to_publish",
      plannedStaffCount: 2,
      leadRequirementType: "at_least_one_lead",
      requiredLeadCount: 1,
      requiredRoles: [
        {
          assignmentRole: "lead_photographer",
          label: "Lead Photographer",
          requiredHeadcount: 1,
          countsTowardLeadCoverage: true,
          sortOrder: 0
        },
        {
          assignmentRole: "photographer",
          label: "Photographer",
          requiredHeadcount: 1,
          countsTowardLeadCoverage: false,
          sortOrder: 1
        }
      ]
    };

    const assignments: StaffingAssignment[] = [
      {
        assignmentId: "assignment-a",
        shootId: "shoot-456",
        employeeId: "employee-a",
        assignmentRole: "lead_photographer",
        assignmentStatus: "cancelled",
        countsTowardLeadCoverage: true
      },
      {
        assignmentId: "assignment-b",
        shootId: "shoot-other",
        employeeId: "employee-b",
        assignmentRole: "photographer",
        assignmentStatus: "assigned",
        countsTowardLeadCoverage: false
      },
      {
        assignmentId: "assignment-c",
        shootId: "shoot-456",
        employeeId: "employee-c",
        assignmentRole: "photographer",
        assignmentStatus: "assigned",
        countsTowardLeadCoverage: false
      }
    ];

    const result = validateStaffingCoverage(requirement, assignments);

    expect(result.staffingValidationPassed).toBe(false);
    expect(result.staffingCoverage.assignedStaffCount).toBe(1);
    expect(result.staffingCoverage.missingStaffCount).toBe(1);
    expect(result.blockingAreas).toEqual([
      "minimum_staffing_coverage",
      "required_role_coverage",
      "lead_coverage"
    ]);
    expect(result.requiredRoleCoverage.find((coverage) => coverage.assignmentRole === "lead_photographer")).toMatchObject({
      assignedHeadcount: 0,
      missingHeadcount: 1,
      coverageSatisfied: false
    });
    expect(result.leadCoverage).toMatchObject({
      assignedLeadCount: 0,
      missingLeadCount: 1,
      leadCoverageSatisfied: false
    });
  });

  it("tracks overstaffing without failing minimum coverage when headcount exceeds plan", () => {
    const requirement: StaffingRequirement = {
      requirementId: "requirement-789",
      shootId: "shoot-789",
      publicationState: "published",
      plannedStaffCount: 1,
      leadRequirementType: "no_lead_required",
      requiredLeadCount: 0,
      requiredRoles: [
        {
          assignmentRole: "photographer",
          label: "Photographer",
          requiredHeadcount: 1,
          countsTowardLeadCoverage: false,
          sortOrder: 0
        }
      ]
    };

    const assignments: StaffingAssignment[] = [
      {
        assignmentId: "assignment-x",
        shootId: "shoot-789",
        employeeId: "employee-x",
        assignmentRole: "photographer",
        assignmentStatus: "assigned",
        countsTowardLeadCoverage: false
      },
      {
        assignmentId: "assignment-y",
        shootId: "shoot-789",
        employeeId: "employee-y",
        assignmentRole: "photographer",
        assignmentStatus: "assigned",
        countsTowardLeadCoverage: false
      }
    ];

    const result = validateStaffingCoverage(requirement, assignments);

    expect(result.staffingValidationPassed).toBe(true);
    expect(result.blockingAreas).toEqual([]);
    expect(result.staffingCoverage.excessStaffCount).toBe(1);
    expect(result.requiredRoleCoverage[0]).toMatchObject({
      assignedHeadcount: 2,
      excessHeadcount: 1,
      coverageSatisfied: true
    });
  });
});
