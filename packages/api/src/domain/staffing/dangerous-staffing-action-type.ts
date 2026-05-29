export const DANGEROUS_STAFFING_ACTION_TYPE_REGISTRY = [
  "assign_with_conflict_override",
  "publish_with_conflict_warnings",
  "publish_without_lead_coverage",
  "publish_understaffed",
  "publish_overstaffed"
] as const;

export type DangerousStaffingActionType = (typeof DANGEROUS_STAFFING_ACTION_TYPE_REGISTRY)[number];

const DANGEROUS_STAFFING_ACTION_TYPE_SET = new Set<string>(DANGEROUS_STAFFING_ACTION_TYPE_REGISTRY);

export function isDangerousStaffingActionType(value: string): value is DangerousStaffingActionType {
  return DANGEROUS_STAFFING_ACTION_TYPE_SET.has(value);
}
