export const RESOURCE_REGISTRY = [
  "shoot",
  "shoot_lifecycle",
  "staff_assignment",
  "staffing_board",
  "readiness_summary",
  "approval_request",
  "time_session",
  "time_segment",
  "attendance_incident",
  "operational_note",
  "organization",
  "contact",
  "location",
  "agreement",
  "resource_library_item",
  "post_shoot_evaluation",
  "gear_asset",
  "gear_kit",
  "gear_custody"
] as const;

export type Resource = (typeof RESOURCE_REGISTRY)[number];

const RESOURCE_SET = new Set<string>(RESOURCE_REGISTRY);

export function isResource(value: string): value is Resource {
  return RESOURCE_SET.has(value);
}
