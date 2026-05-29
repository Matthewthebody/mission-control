import type { StaffingLeadCoverageSummary } from "./staffing-lead-coverage.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";

export interface StaffingRequirementSummary {
  requirementId: string;
  shootId: string;
  publicationState: StaffingPublicationState;
  plannedStaffCount: number;
  requiredRoleCount: number;
  assignedStaffCount: number;
  openStaffCount: number;
  leadCoverage: StaffingLeadCoverageSummary;
}
