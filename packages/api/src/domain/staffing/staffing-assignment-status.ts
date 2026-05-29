export const STAFFING_ASSIGNMENT_STATUS_REGISTRY = [
  "draft",
  "open",
  "assigned",
  "active",
  "cancelled",
  "completed"
] as const;

export type StaffingAssignmentStatus = (typeof STAFFING_ASSIGNMENT_STATUS_REGISTRY)[number];

const STAFFING_ASSIGNMENT_STATUS_SET = new Set<string>(STAFFING_ASSIGNMENT_STATUS_REGISTRY);

export function isStaffingAssignmentStatus(value: string): value is StaffingAssignmentStatus {
  return STAFFING_ASSIGNMENT_STATUS_SET.has(value);
}
