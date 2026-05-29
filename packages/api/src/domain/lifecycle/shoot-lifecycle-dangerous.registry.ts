import { SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY } from "./shoot-lifecycle-reopen.registry.js";
import { SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY } from "./shoot-lifecycle-rollback.registry.js";

export const SHOOT_LIFECYCLE_TERMINAL_STATUS_REGISTRY = ["COMPLETE", "CANCELLED"] as const;

export type ShootLifecycleTerminalStatus = (typeof SHOOT_LIFECYCLE_TERMINAL_STATUS_REGISTRY)[number];

export const SHOOT_LIFECYCLE_DANGEROUS_TRANSITION_REGISTRY = [
  "cancel_draft_shoot",
  "cancel_tentative_shoot",
  "cancel_confirmed_shoot",
  "cancel_ready_shoot",
  "cancel_live_shoot",
  ...SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY.map((transition) => transition.transitionKey),
  ...SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY.map((transition) => transition.transitionKey)
] as const;
