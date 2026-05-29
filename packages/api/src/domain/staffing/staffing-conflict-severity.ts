export const STAFFING_CONFLICT_SEVERITY_REGISTRY = [
  "warning",
  "override_required",
  "blocking"
] as const;

export type StaffingConflictSeverity = (typeof STAFFING_CONFLICT_SEVERITY_REGISTRY)[number];

const STAFFING_CONFLICT_SEVERITY_SET = new Set<string>(STAFFING_CONFLICT_SEVERITY_REGISTRY);

export function isStaffingConflictSeverity(value: string): value is StaffingConflictSeverity {
  return STAFFING_CONFLICT_SEVERITY_SET.has(value);
}
