import type { LeadRequirementType } from "./lead-requirement-type.js";
import type { StaffingAssignmentRole } from "./staffing-assignment-role.js";

export interface StaffingLeadCoverageRoleSupport {
  assignmentRole: StaffingAssignmentRole;
  countsTowardLeadCoverage: boolean;
}

export interface StaffingLeadCoverageRequirement {
  leadRequirementType: LeadRequirementType;
  requiredLeadCount: number;
}

export interface StaffingLeadCoverageTotals {
  assignedLeadCount: number;
  missingLeadCount: number;
}

export interface StaffingLeadCoverageSummary
  extends StaffingLeadCoverageRequirement,
    StaffingLeadCoverageTotals {
  leadCoverageSatisfied: boolean;
}
