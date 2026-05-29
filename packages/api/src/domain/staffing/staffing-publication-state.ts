export const STAFFING_PUBLICATION_STATE_REGISTRY = [
  "draft",
  "ready_to_publish",
  "published"
] as const;

export type StaffingPublicationState = (typeof STAFFING_PUBLICATION_STATE_REGISTRY)[number];

const STAFFING_PUBLICATION_STATE_SET = new Set<string>(STAFFING_PUBLICATION_STATE_REGISTRY);

export function isStaffingPublicationState(value: string): value is StaffingPublicationState {
  return STAFFING_PUBLICATION_STATE_SET.has(value);
}
