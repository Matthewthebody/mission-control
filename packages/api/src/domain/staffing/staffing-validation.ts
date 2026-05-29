import type { StaffingAssignmentStatus } from "./staffing-assignment-status.js";
import type { StaffingAssignmentRole } from "./staffing-assignment-role.js";
import type { StaffingLeadCoverageSummary } from "./staffing-lead-coverage.js";

export const STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY = [
  "draft",
  "assigned",
  "active",
  "completed"
] as const satisfies readonly StaffingAssignmentStatus[];

export type StaffingCountedAssignmentStatus = (typeof STAFFING_COUNTED_ASSIGNMENT_STATUS_REGISTRY)[number];

export const STAFFING_VALIDATION_BLOCKING_AREA_REGISTRY = [
  "minimum_staffing_coverage",
  "required_role_coverage",
  "lead_coverage"
] as const;

export type StaffingValidationBlockingArea =
  (typeof STAFFING_VALIDATION_BLOCKING_AREA_REGISTRY)[number];

export interface StaffingCoverageResult {
  plannedStaffCount: number;
  assignedStaffCount: number;
  missingStaffCount: number;
  excessStaffCount: number;
  coverageSatisfied: boolean;
  countedAssignmentIds: string[];
}

export interface RequiredRoleCoverageResult {
  assignmentRole: StaffingAssignmentRole;
  label: string;
  requiredHeadcount: number;
  assignedHeadcount: number;
  missingHeadcount: number;
  excessHeadcount: number;
  countsTowardLeadCoverage: boolean;
  coverageSatisfied: boolean;
  countedAssignmentIds: string[];
}

export interface LeadCoverageResult extends StaffingLeadCoverageSummary {
  countedAssignmentIds: string[];
}

export interface StaffingValidationResult {
  staffingValidationPassed: boolean;
  requirementId: string;
  shootId: string;
  staffingCoverage: StaffingCoverageResult;
  requiredRoleCoverage: RequiredRoleCoverageResult[];
  leadCoverage: LeadCoverageResult;
  blockingAreas: StaffingValidationBlockingArea[];
}
