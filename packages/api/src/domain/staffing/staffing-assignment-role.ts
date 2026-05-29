export const STAFFING_ASSIGNMENT_ROLE_REGISTRY = [
  "lead_photographer",
  "senior_photographer",
  "photographer",
  "support",
  "check_in",
  "assistant",
  "producer",
  "custom"
] as const;

export type StaffingAssignmentRole = (typeof STAFFING_ASSIGNMENT_ROLE_REGISTRY)[number];

const STAFFING_ASSIGNMENT_ROLE_SET = new Set<string>(STAFFING_ASSIGNMENT_ROLE_REGISTRY);

export function isStaffingAssignmentRole(value: string): value is StaffingAssignmentRole {
  return STAFFING_ASSIGNMENT_ROLE_SET.has(value);
}
