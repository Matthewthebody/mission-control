import type { ShootLifecycleTransitionDefinition } from "./shoot-lifecycle-transition.js";

export const SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY: ShootLifecycleTransitionDefinition[] = [
  {
    transitionKey: "reopen_complete_to_post_production",
    transitionDirection: "reopen",
    controlClass: "override_only",
    fromStatus: "COMPLETE",
    toStatus: "POST_PRODUCTION",
    allowedRoles: ["leadership", "director_admin"],
    reasonRequired: true,
    automationPolicyKey: null
  }
] as const;
