import type { StaffingAssignmentRole } from "./staffing-assignment-role.js";
import type { StaffingAssignmentStatus } from "./staffing-assignment-status.js";

export interface StaffingAssignment {
  assignmentId: string;
  shootId: string;
  employeeId: string;
  assignmentRole: StaffingAssignmentRole;
  assignmentStatus: StaffingAssignmentStatus;
  countsTowardLeadCoverage: boolean;
  linkedShiftId?: string | null;
}
