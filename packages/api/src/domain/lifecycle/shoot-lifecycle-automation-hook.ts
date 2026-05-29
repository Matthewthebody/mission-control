import type { ShootLifecycleTransitionDefinition } from "./shoot-lifecycle-transition.js";
import type { ShootLifecycleAutomationPolicy } from "./shoot-lifecycle-automation-policy.js";
import type { ShootStatus } from "./shoot-status.js";

export const SHOOT_LIFECYCLE_AUTOMATION_HOOK_OUTCOME_REGISTRY = ["pass", "hold"] as const;

export type ShootLifecycleAutomationHookOutcome =
  (typeof SHOOT_LIFECYCLE_AUTOMATION_HOOK_OUTCOME_REGISTRY)[number];

export interface ShootLifecycleAutomationHookContext {
  currentStatus: ShootStatus;
  transition: ShootLifecycleTransitionDefinition;
  policy: ShootLifecycleAutomationPolicy;
  metadata?: Record<string, unknown>;
}

export interface ShootLifecycleAutomationHookResult {
  hookKey: string;
  outcome: ShootLifecycleAutomationHookOutcome;
  reasonCode: string | null;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface ShootLifecycleAutomationHook {
  hookKey: string;
  evaluate(context: ShootLifecycleAutomationHookContext): ShootLifecycleAutomationHookResult;
}

export type ShootLifecycleAutomationHookRegistry = Readonly<Record<string, ShootLifecycleAutomationHook>>;
