import type {
  ShootLifecycleAutomationHookContext,
  ShootLifecycleAutomationHookRegistry,
  ShootLifecycleAutomationHookResult
} from "./shoot-lifecycle-automation-hook.js";
import {
  SHOOT_LIFECYCLE_AUTOMATION_POLICY_REGISTRY,
  type ShootLifecycleAutomationPolicy
} from "./shoot-lifecycle-automation-policy.js";
import { SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY } from "./shoot-lifecycle-forward.registry.js";
import type { ShootLifecycleTransitionDefinition } from "./shoot-lifecycle-transition.js";
import type { ShootStatus } from "./shoot-status.js";

export interface EvaluateShootLifecycleAutomationCandidatesRequest {
  currentStatus: ShootStatus;
  metadata?: Record<string, unknown>;
}

export interface ShootLifecycleAutomationCandidateEvaluation {
  transition: ShootLifecycleTransitionDefinition;
  policy: ShootLifecycleAutomationPolicy;
  hookResults: ShootLifecycleAutomationHookResult[];
  eligibleForAutomation: boolean;
}

export interface EvaluateShootLifecycleAutomationCandidatesOptions {
  hookRegistry?: ShootLifecycleAutomationHookRegistry;
}

function buildMissingHookResult(hookKey: string): ShootLifecycleAutomationHookResult {
  return {
    hookKey,
    outcome: "hold",
    reasonCode: "hook_not_registered",
    message: `Automation hook '${hookKey}' is not registered.`
  };
}

function evaluateAutomationHooks(
  context: ShootLifecycleAutomationHookContext,
  hookRegistry: ShootLifecycleAutomationHookRegistry
): ShootLifecycleAutomationHookResult[] {
  return context.policy.requiredHookKeys.map((hookKey) => {
    const hook = hookRegistry[hookKey];
    if (!hook) {
      return buildMissingHookResult(hookKey);
    }
    return hook.evaluate(context);
  });
}

function hasAutomationPolicy(
  transition: ShootLifecycleTransitionDefinition
): transition is ShootLifecycleTransitionDefinition & { automationPolicyKey: keyof typeof SHOOT_LIFECYCLE_AUTOMATION_POLICY_REGISTRY } {
  return Boolean(transition.automationPolicyKey);
}

export function evaluateShootLifecycleAutomationCandidates(
  request: EvaluateShootLifecycleAutomationCandidatesRequest,
  options: EvaluateShootLifecycleAutomationCandidatesOptions = {}
): ShootLifecycleAutomationCandidateEvaluation[] {
  const automaticTransitions = SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY.filter(
    (transition) =>
      transition.controlClass === "automatic" &&
      transition.fromStatus === request.currentStatus &&
      hasAutomationPolicy(transition)
  );

  return automaticTransitions.flatMap((transition): ShootLifecycleAutomationCandidateEvaluation[] => {
    const automationPolicyKey = transition.automationPolicyKey;
    if (!automationPolicyKey) {
      return [];
    }

    const policy = SHOOT_LIFECYCLE_AUTOMATION_POLICY_REGISTRY[automationPolicyKey];
    const hookResults =
      options.hookRegistry && Object.keys(options.hookRegistry).length > 0
        ? evaluateAutomationHooks(
            {
              currentStatus: request.currentStatus,
              transition,
              policy,
              metadata: request.metadata
            },
            options.hookRegistry
          )
        : policy.requiredHookKeys.map((hookKey: string) => buildMissingHookResult(hookKey));

    return [
      {
        transition,
        policy,
        hookResults,
        eligibleForAutomation: hookResults.every(
          (result: ShootLifecycleAutomationHookResult) => result.outcome === "pass"
        )
      }
    ];
  });
}
