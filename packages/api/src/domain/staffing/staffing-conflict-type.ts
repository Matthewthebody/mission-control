export const STAFFING_CONFLICT_TYPE_REGISTRY = [
  "shift_overlap",
  "calendar_overlap",
  "assignment_overlap",
  "pto_unavailable",
  "lead_qualification_missing",
  "turnaround_gap_risk",
  "overtime_risk"
] as const;

export type StaffingConflictType = (typeof STAFFING_CONFLICT_TYPE_REGISTRY)[number];

const STAFFING_CONFLICT_TYPE_SET = new Set<string>(STAFFING_CONFLICT_TYPE_REGISTRY);

export function isStaffingConflictType(value: string): value is StaffingConflictType {
  return STAFFING_CONFLICT_TYPE_SET.has(value);
}
