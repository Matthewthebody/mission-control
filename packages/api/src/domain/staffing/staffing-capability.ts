export const STAFFING_CAPABILITY_REGISTRY = [
  "view_staffing_dashboard",
  "view_staffing_board",
  "view_staffing_availability",
  "view_staffing_templates",
  "manage_staffing_templates",
  "assign_staffing_assignment",
  "publish_staffing",
  "override_staffing_conflict",
  "override_staffing_warnings"
] as const;

export type StaffingCapability = (typeof STAFFING_CAPABILITY_REGISTRY)[number];

const STAFFING_CAPABILITY_SET = new Set<string>(STAFFING_CAPABILITY_REGISTRY);

export function isStaffingCapability(value: string): value is StaffingCapability {
  return STAFFING_CAPABILITY_SET.has(value);
}
