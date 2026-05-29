import type { StaffingAssignmentRole } from "./staffing-assignment-role.js";
import type { StaffingAssignmentStatus } from "./staffing-assignment-status.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";

export interface PublishedStaffingAssignmentDto {
  assignmentId: string;
  shootId: string;
  employeeId: string;
  assignmentRole: StaffingAssignmentRole;
  employeeVisible: true;
}

export interface PublishedStaffingDto {
  shootId: string;
  publicationState: "published";
  publishedAssignmentCount: number;
  assignments: PublishedStaffingAssignmentDto[];
}

export interface InternalStaffingAssignmentDto {
  assignmentId: string;
  shootId: string;
  employeeId: string;
  assignmentRole: StaffingAssignmentRole;
  assignmentStatus: StaffingAssignmentStatus;
  countsTowardLeadCoverage: boolean;
  linkedShiftId?: string | null;
}

export interface InternalStaffingDto {
  requirementId: string;
  shootId: string;
  publicationState: StaffingPublicationState;
  plannedStaffCount: number;
  requiredLeadCount: number;
  employeeVisibleScheduleReleased: boolean;
  assignments: InternalStaffingAssignmentDto[];
}
