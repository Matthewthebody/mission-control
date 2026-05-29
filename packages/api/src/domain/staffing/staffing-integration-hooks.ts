import type { LastMinuteStaffingChangeEvaluationResult } from "./staffing-last-minute-change-evaluator.js";
import {
  type ProtectedWindowPublicationHardeningHookOptions,
  evaluatePublicationHardening
} from "./staffing-publication-hardening-hooks.js";
import type {
  StaffingPublicationRequest,
  StaffingPublicationValidationHook,
  StaffingPublicationValidationHookResult
} from "./staffing-publication.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";

export const STAFFING_INTEGRATION_HOOK_OUTCOME_REGISTRY = ["pass", "warning", "block"] as const;

export type StaffingIntegrationHookOutcome =
  (typeof STAFFING_INTEGRATION_HOOK_OUTCOME_REGISTRY)[number];

interface StaffingPublicationIntegrationHookResult {
  hookKey: string;
  outcome: StaffingIntegrationHookOutcome;
  reasonCode: string | null;
  message: string | null;
  metadata?: Record<string, unknown>;
}

interface StaffingPublicationIntegrationHookContext {
  request: StaffingPublicationRequest;
  targetPublicationState: StaffingPublicationState;
  hardeningEvaluation: LastMinuteStaffingChangeEvaluationResult;
}

export interface StaffingLifecycleIntegrationHookContext
  extends StaffingPublicationIntegrationHookContext {}

export interface StaffingLifecycleIntegrationHookResult
  extends StaffingPublicationIntegrationHookResult {}

export interface StaffingLifecycleIntegrationHook {
  hookKey: string;
  evaluate(context: StaffingLifecycleIntegrationHookContext): StaffingLifecycleIntegrationHookResult;
}

export type StaffingLifecycleIntegrationHookRegistry = Readonly<
  Record<string, StaffingLifecycleIntegrationHook>
>;

export interface StaffingReadinessIntegrationHookContext
  extends StaffingPublicationIntegrationHookContext {}

export interface StaffingReadinessIntegrationHookResult
  extends StaffingPublicationIntegrationHookResult {}

export interface StaffingReadinessIntegrationHook {
  hookKey: string;
  evaluate(context: StaffingReadinessIntegrationHookContext): StaffingReadinessIntegrationHookResult;
}

export type StaffingReadinessIntegrationHookRegistry = Readonly<
  Record<string, StaffingReadinessIntegrationHook>
>;

const STAFFING_INTEGRATION_HOOK_OUTCOME_SET = new Set<string>(STAFFING_INTEGRATION_HOOK_OUTCOME_REGISTRY);

function mapIntegrationResult(
  result: StaffingPublicationIntegrationHookResult
): StaffingPublicationValidationHookResult {
  return {
    hookKey: result.hookKey,
    outcome: result.outcome,
    message: result.message,
    metadata: {
      reasonCode: result.reasonCode,
      ...(result.metadata ?? {})
    }
  };
}

export function isStaffingIntegrationHookOutcome(
  value: string
): value is StaffingIntegrationHookOutcome {
  return STAFFING_INTEGRATION_HOOK_OUTCOME_SET.has(value);
}

export function createLifecyclePublicationIntegrationHook(
  hook: StaffingLifecycleIntegrationHook,
  options: ProtectedWindowPublicationHardeningHookOptions = {}
): StaffingPublicationValidationHook {
  return {
    hookKey: hook.hookKey,
    evaluate(context) {
      const hardeningEvaluation = evaluatePublicationHardening(context, options);
      return mapIntegrationResult(
        hook.evaluate({
          request: context.request,
          targetPublicationState: context.targetPublicationState,
          hardeningEvaluation
        })
      );
    }
  };
}

export function createReadinessPublicationIntegrationHook(
  hook: StaffingReadinessIntegrationHook,
  options: ProtectedWindowPublicationHardeningHookOptions = {}
): StaffingPublicationValidationHook {
  return {
    hookKey: hook.hookKey,
    evaluate(context) {
      const hardeningEvaluation = evaluatePublicationHardening(context, options);
      return mapIntegrationResult(
        hook.evaluate({
          request: context.request,
          targetPublicationState: context.targetPublicationState,
          hardeningEvaluation
        })
      );
    }
  };
}
