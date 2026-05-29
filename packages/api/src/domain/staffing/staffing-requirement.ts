import type { LeadRequirementType } from "./lead-requirement-type.js";
import type {
  StaffingLeadCoverageRequirement,
  StaffingLeadCoverageRoleSupport
} from "./staffing-lead-coverage.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";

export interface RequiredRoleRequirement extends StaffingLeadCoverageRoleSupport {
  label: string;
  requiredHeadcount: number;
  sortOrder: number;
}

export interface StaffingRequirement extends StaffingLeadCoverageRequirement {
  requirementId: string;
  shootId: string;
  publicationState: StaffingPublicationState;
  plannedStaffCount: number;
  requiredRoles: RequiredRoleRequirement[];
}

export function createStaffingLeadCoverageRequirement(requiredLeadCount: number): StaffingLeadCoverageRequirement {
  const leadRequirementType: LeadRequirementType =
    requiredLeadCount <= 0
      ? "no_lead_required"
      : requiredLeadCount === 1
        ? "at_least_one_lead"
        : "minimum_lead_count";

  return {
    leadRequirementType,
    requiredLeadCount: Math.max(0, requiredLeadCount)
  };
}
