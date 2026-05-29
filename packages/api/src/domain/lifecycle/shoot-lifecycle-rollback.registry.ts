import type { ShootLifecycleTransitionDefinition } from "./shoot-lifecycle-transition.js";

export const SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY: ShootLifecycleTransitionDefinition[] = [
  {
    transitionKey: "move_tentative_back_to_draft",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "TENTATIVE",
    toStatus: "DRAFT",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "move_ready_back_to_confirmed",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "READY",
    toStatus: "CONFIRMED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "resume_confirmed_from_hold",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "ON_HOLD",
    toStatus: "CONFIRMED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "resume_ready_from_hold",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "ON_HOLD",
    toStatus: "READY",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "resume_live_from_hold",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "ON_HOLD",
    toStatus: "LIVE",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "photographer"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "resume_shot_complete_from_hold",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "ON_HOLD",
    toStatus: "SHOOT_COMPLETE",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "graphic_artist"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "resume_post_production_from_hold",
    transitionDirection: "rollback",
    controlClass: "override_only",
    fromStatus: "ON_HOLD",
    toStatus: "POST_PRODUCTION",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "graphic_artist"],
    reasonRequired: false,
    automationPolicyKey: null
  }
] as const;
