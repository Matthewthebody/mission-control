import type { StaffingAssignment } from "./staffing-assignment.js";
import type { StaffingRequirement } from "./staffing-requirement.js";
import {
  STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY,
  type LeadCoverageResult,
  type RequiredRoleCoverageResult,
  type StaffingCoverageResult,
  type StaffingValidationBlockingArea,
  type StaffingValidationResult
} from "./staffing-validation.js";

function shouldCountAssignmentForCoverage(requirement: StaffingRequirement, assignment: StaffingAssignment) {
  return (
    assignment.shootId === requirement.shootId &&
    (STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY as readonly string[]).includes(assignment.assignmentStatus)
  );
}

function buildStaffingCoverageResult(
  requirement: StaffingRequirement,
  countedAssignments: StaffingAssignment[]
): StaffingCoverageResult {
  const assignedStaffCount = countedAssignments.length;
  const plannedStaffCount = Math.max(0, requirement.plannedStaffCount);
  const missingStaffCount = Math.max(plannedStaffCount - assignedStaffCount, 0);
  const excessStaffCount = Math.max(assignedStaffCount - plannedStaffCount, 0);

  return {
    plannedStaffCount,
    assignedStaffCount,
    missingStaffCount,
    excessStaffCount,
    coverageSatisfied: assignedStaffCount >= plannedStaffCount,
    countedAssignmentIds: countedAssignments.map((assignment) => assignment.assignmentId)
  };
}

function buildRequiredRoleCoverageResult(
  requirement: StaffingRequirement,
  countedAssignments: StaffingAssignment[]
): RequiredRoleCoverageResult[] {
  return requirement.requiredRoles.map((requiredRole) => {
    const matchingAssignments = countedAssignments.filter(
      (assignment) => assignment.assignmentRole === requiredRole.assignmentRole
    );
    const assignedHeadcount = matchingAssignments.length;
    const requiredHeadcount = Math.max(0, requiredRole.requiredHeadcount);
    const missingHeadcount = Math.max(requiredHeadcount - assignedHeadcount, 0);
    const excessHeadcount = Math.max(assignedHeadcount - requiredHeadcount, 0);

    return {
      assignmentRole: requiredRole.assignmentRole,
      label: requiredRole.label,
      requiredHeadcount,
      assignedHeadcount,
      missingHeadcount,
      excessHeadcount,
      countsTowardLeadCoverage: requiredRole.countsTowardLeadCoverage,
      coverageSatisfied: assignedHeadcount >= requiredHeadcount,
      countedAssignmentIds: matchingAssignments.map((assignment) => assignment.assignmentId)
    };
  });
}

function buildLeadCoverageResult(
  requirement: StaffingRequirement,
  countedAssignments: StaffingAssignment[]
): LeadCoverageResult {
  const countedLeadAssignments = countedAssignments.filter((assignment) => assignment.countsTowardLeadCoverage);
  const assignedLeadCount = countedLeadAssignments.length;
  const requiredLeadCount = Math.max(0, requirement.requiredLeadCount);
  const missingLeadCount = Math.max(requiredLeadCount - assignedLeadCount, 0);

  return {
    leadRequirementType: requirement.leadRequirementType,
    requiredLeadCount,
    assignedLeadCount,
    missingLeadCount,
    leadCoverageSatisfied: assignedLeadCount >= requiredLeadCount,
    countedAssignmentIds: countedLeadAssignments.map((assignment) => assignment.assignmentId)
  };
}

function buildBlockingAreas(
  staffingCoverage: StaffingCoverageResult,
  requiredRoleCoverage: RequiredRoleCoverageResult[],
  leadCoverage: LeadCoverageResult
): StaffingValidationBlockingArea[] {
  const blockingAreas: StaffingValidationBlockingArea[] = [];

  if (!staffingCoverage.coverageSatisfied) {
    blockingAreas.push("minimum_staffing_coverage");
  }

  if (requiredRoleCoverage.some((coverage) => !coverage.coverageSatisfied)) {
    blockingAreas.push("required_role_coverage");
  }

  if (!leadCoverage.leadCoverageSatisfied) {
    blockingAreas.push("lead_coverage");
  }

  return blockingAreas;
}

export function validateStaffingCoverage(
  requirement: StaffingRequirement,
  assignments: StaffingAssignment[]
): StaffingValidationResult {
  const countedAssignments = assignments.filter((assignment) =>
    shouldCountAssignmentForCoverage(requirement, assignment)
  );
  const staffingCoverage = buildStaffingCoverageResult(requirement, countedAssignments);
  const requiredRoleCoverage = buildRequiredRoleCoverageResult(requirement, countedAssignments);
  const leadCoverage = buildLeadCoverageResult(requirement, countedAssignments);
  const blockingAreas = buildBlockingAreas(staffingCoverage, requiredRoleCoverage, leadCoverage);

  return {
    staffingValidationPassed: blockingAreas.length === 0,
    requirementId: requirement.requirementId,
    shootId: requirement.shootId,
    staffingCoverage,
    requiredRoleCoverage,
    leadCoverage,
    blockingAreas
  };
}
