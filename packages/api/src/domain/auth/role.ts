export const ROLE_REGISTRY = [
  "super_admin",
  "leadership",
  "director_admin",
  "assistant_manager",
  "staffing_coordinator",
  "customer_service",
  "photographer",
  "graphic_artist",
  "read_only_viewer",
  "integration_service"
] as const;

export type Role = (typeof ROLE_REGISTRY)[number];

const ROLE_SET = new Set<string>(ROLE_REGISTRY);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}
