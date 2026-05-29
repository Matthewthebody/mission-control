import type { ShootLifecycleTransitionDefinition } from "./shoot-lifecycle-transition.js";

export const SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY: ShootLifecycleTransitionDefinition[] = [
  {
    transitionKey: "move_draft_to_tentative",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "DRAFT",
    toStatus: "TENTATIVE",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator", "integration_service"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "move_draft_to_confirmed",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "DRAFT",
    toStatus: "CONFIRMED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator", "integration_service"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "cancel_draft_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "DRAFT",
    toStatus: "CANCELLED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "move_tentative_to_confirmed",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "TENTATIVE",
    toStatus: "CONFIRMED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "cancel_tentative_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "TENTATIVE",
    toStatus: "CANCELLED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "mark_confirmed_shoot_ready",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "CONFIRMED",
    toStatus: "READY",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "hold_confirmed_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "CONFIRMED",
    toStatus: "ON_HOLD",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "cancel_confirmed_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "CONFIRMED",
    toStatus: "CANCELLED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "start_live_shoot",
    transitionDirection: "forward",
    controlClass: "automatic",
    fromStatus: "READY",
    toStatus: "LIVE",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "photographer", "integration_service"],
    reasonRequired: false,
    automationPolicyKey: "ready_to_live_window"
  },
  {
    transitionKey: "hold_ready_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "READY",
    toStatus: "ON_HOLD",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "cancel_ready_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "READY",
    toStatus: "CANCELLED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "staffing_coordinator"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "complete_live_capture",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "LIVE",
    toStatus: "SHOOT_COMPLETE",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "photographer"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "hold_live_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "LIVE",
    toStatus: "ON_HOLD",
    allowedRoles: ["leadership", "director_admin", "assistant_manager"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "cancel_live_shoot",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "LIVE",
    toStatus: "CANCELLED",
    allowedRoles: ["leadership", "director_admin", "assistant_manager"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "move_shot_complete_to_post_production",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "SHOOT_COMPLETE",
    toStatus: "POST_PRODUCTION",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "graphic_artist", "integration_service"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "hold_shot_complete",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "SHOOT_COMPLETE",
    toStatus: "ON_HOLD",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "graphic_artist"],
    reasonRequired: true,
    automationPolicyKey: null
  },
  {
    transitionKey: "finish_post_production",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "POST_PRODUCTION",
    toStatus: "COMPLETE",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "graphic_artist"],
    reasonRequired: false,
    automationPolicyKey: null
  },
  {
    transitionKey: "hold_post_production",
    transitionDirection: "forward",
    controlClass: "manual",
    fromStatus: "POST_PRODUCTION",
    toStatus: "ON_HOLD",
    allowedRoles: ["leadership", "director_admin", "assistant_manager", "graphic_artist"],
    reasonRequired: true,
    automationPolicyKey: null
  }
] as const;
