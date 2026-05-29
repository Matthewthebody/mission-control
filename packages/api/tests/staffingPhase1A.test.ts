import { describe, expect, it } from "vitest";
import {
  LEAD_REQUIREMENT_TYPE_REGISTRY,
  STAFFING_ASSIGNMENT_ROLE_REGISTRY,
  STAFFING_ASSIGNMENT_STATUS_REGISTRY,
  STAFFING_PUBLICATION_STATE_REGISTRY,
  createStaffingLeadCoverageRequirement,
  isLeadRequirementType,
  isStaffingAssignmentRole,
  isStaffingAssignmentStatus,
  isStaffingPublicationState,
  resolveLeadRequirementType,
  type RequiredRoleRequirement,
  type StaffingAssignment,
  type StaffingLeadCoverageSummary,
  type StaffingRequirement,
  type StaffingRequirementSummary
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 1A foundations", () => {
  it("exposes deterministic staffing registries without duplicates", () => {
    expect(new Set(LEAD_REQUIREMENT_TYPE_REGISTRY).size).toBe(LEAD_REQUIREMENT_TYPE_REGISTRY.length);
    expect(new Set(STAFFING_ASSIGNMENT_ROLE_REGISTRY).size).toBe(STAFFING_ASSIGNMENT_ROLE_REGISTRY.length);
    expect(new Set(STAFFING_ASSIGNMENT_STATUS_REGISTRY).size).toBe(STAFFING_ASSIGNMENT_STATUS_REGISTRY.length);
    expect(new Set(STAFFING_PUBLICATION_STATE_REGISTRY).size).toBe(STAFFING_PUBLICATION_STATE_REGISTRY.length);
  });

  it("provides runtime guards for core staffing enums", () => {
    expect(isLeadRequirementType("at_least_one_lead")).toBe(true);
    expect(isLeadRequirementType("lead_required")).toBe(false);

    expect(isStaffingAssignmentRole("lead_photographer")).toBe(true);
    expect(isStaffingAssignmentRole("coordinator")).toBe(false);

    expect(isStaffingAssignmentStatus("assigned")).toBe(true);
    expect(isStaffingAssignmentStatus("removed")).toBe(false);

    expect(isStaffingPublicationState("ready_to_publish")).toBe(true);
    expect(isStaffingPublicationState("archived")).toBe(false);
  });

  it("resolves locked lead requirement values from required lead counts", () => {
    expect(resolveLeadRequirementType(0)).toBe("no_lead_required");
    expect(resolveLeadRequirementType(1)).toBe("at_least_one_lead");
    expect(resolveLeadRequirementType(2)).toBe("minimum_lead_count");

    expect(createStaffingLeadCoverageRequirement(0)).toEqual({
      leadRequirementType: "no_lead_required",
      requiredLeadCount: 0
    });
    expect(createStaffingLeadCoverageRequirement(3)).toEqual({
      leadRequirementType: "minimum_lead_count",
      requiredLeadCount: 3
    });
  });

  it("supports staffing requirement, assignment, and summary model composition", () => {
    const requiredRole: RequiredRoleRequirement = {
      assignmentRole: "lead_photographer",
      label: "Lead Photographer",
      requiredHeadcount: 1,
      countsTowardLeadCoverage: true,
      sortOrder: 0
    };

    const requirement: StaffingRequirement = {
      requirementId: "staffing-requirement-123",
      shootId: "shoot-123",
      publicationState: "ready_to_publish",
      plannedStaffCount: 3,
      requiredRoles: [
        requiredRole,
        {
          assignmentRole: "photographer",
          label: "Photographer",
          requiredHeadcount: 2,
          countsTowardLeadCoverage: false,
          sortOrder: 1
        }
      ],
      leadRequirementType: "at_least_one_lead",
      requiredLeadCount: 1
    };

    const assignment: StaffingAssignment = {
      assignmentId: "assignment-123",
      shootId: requirement.shootId,
      employeeId: "employee-123",
      assignmentRole: "lead_photographer",
      assignmentStatus: "assigned",
      countsTowardLeadCoverage: true,
      linkedShiftId: "shift-123"
    };

    const leadCoverage: StaffingLeadCoverageSummary = {
      leadRequirementType: requirement.leadRequirementType,
      requiredLeadCount: requirement.requiredLeadCount,
      assignedLeadCount: 1,
      missingLeadCount: 0,
      leadCoverageSatisfied: true
    };

    const summary: StaffingRequirementSummary = {
      requirementId: requirement.requirementId,
      shootId: requirement.shootId,
      publicationState: requirement.publicationState,
      plannedStaffCount: requirement.plannedStaffCount,
      requiredRoleCount: requirement.requiredRoles.length,
      assignedStaffCount: 1,
      openStaffCount: 2,
      leadCoverage
    };

    expect(requiredRole.countsTowardLeadCoverage).toBe(true);
    expect(assignment.assignmentStatus).toBe("assigned");
    expect(summary.publicationState).toBe("ready_to_publish");
    expect(summary.leadCoverage.leadCoverageSatisfied).toBe(true);
  });
});
