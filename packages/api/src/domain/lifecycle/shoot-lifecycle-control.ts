export const SHOOT_LIFECYCLE_TRANSITION_CONTROL_CLASS_REGISTRY = [
  "manual",
  "automatic",
  "approval_gated",
  "override_only"
] as const;

export type ShootLifecycleTransitionControlClass =
  (typeof SHOOT_LIFECYCLE_TRANSITION_CONTROL_CLASS_REGISTRY)[number];
