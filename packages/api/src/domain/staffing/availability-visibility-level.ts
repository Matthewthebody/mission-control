export const AVAILABILITY_VISIBILITY_LEVEL_REGISTRY = [
  "none",
  "self",
  "assigned_shoot",
  "department",
  "organization"
] as const;

export type AvailabilityVisibilityLevel = (typeof AVAILABILITY_VISIBILITY_LEVEL_REGISTRY)[number];

const AVAILABILITY_VISIBILITY_LEVEL_SET = new Set<string>(AVAILABILITY_VISIBILITY_LEVEL_REGISTRY);

export function isAvailabilityVisibilityLevel(value: string): value is AvailabilityVisibilityLevel {
  return AVAILABILITY_VISIBILITY_LEVEL_SET.has(value);
}
