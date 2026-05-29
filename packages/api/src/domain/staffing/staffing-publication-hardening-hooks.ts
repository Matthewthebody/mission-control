import {
  type LastMinuteStaffingChangeEvaluationResult,
  evaluateLastMinuteStaffingChange
} from "./staffing-last-minute-change-evaluator.js";
import type { ProtectedStaffingWindowPolicy } from "./protected-staffing-window-policy.js";
import type {
  StaffingPublicationValidationHook,
  StaffingPublicationValidationHookContext,
  StaffingPublicationValidationHookResult
} from "./staffing-publication.js";

export interface ProtectedWindowPublicationHardeningHookOptions {
  protectedWindowPolicy?: ProtectedStaffingWindowPolicy;
  evaluationTime?: string | Date | null;
}

function buildHardeningMessage(evaluation: LastMinuteStaffingChangeEvaluationResult) {
  const relevantRules = evaluation.blocked
    ? evaluation.blockingRules
    : evaluation.overrideRequired
      ? evaluation.overrideRequiredRules
      : evaluation.warningRules;

  return relevantRules.map((rule) => rule.message).join(" ");
}

function buildHardeningMetadata(evaluation: LastMinuteStaffingChangeEvaluationResult) {
  return {
    actionKind: evaluation.actionKind,
    windowLevel: evaluation.windowEvaluation.windowLevel,
    hoursUntilShootStart: evaluation.windowEvaluation.hoursUntilShootStart,
    ruleCodes: evaluation.triggeredRules.map((rule) => rule.ruleCode),
    requiredCapabilities: evaluation.requiredCapabilities
  };
}

function mapPublicationActionToHardeningAction(
  context: StaffingPublicationValidationHookContext
) {
  return context.request.publicationAction === "publish" ? "publish_staffing" : "unpublish_staffing";
}

export function createProtectedWindowPublicationHardeningHook(
  options: ProtectedWindowPublicationHardeningHookOptions = {}
): StaffingPublicationValidationHook {
  return {
    hookKey: "protected_window_publication_hardening",
    evaluate(context): StaffingPublicationValidationHookResult {
      const evaluation = evaluateLastMinuteStaffingChange(
        {
          actionKind: mapPublicationActionToHardeningAction(context),
          currentPublicationState: context.request.currentPublicationState,
          shootStartsAt: context.request.shootStartsAt ?? null,
          evaluationTime: context.request.evaluationTime ?? options.evaluationTime ?? null,
          actionEvaluation: context.actionEvaluation ?? null,
          staffingValidation: context.request.staffingValidation ?? null
        },
        {
          protectedWindowPolicy: options.protectedWindowPolicy
        }
      );

      if (evaluation.blocked) {
        return {
          hookKey: "protected_window_publication_hardening",
          outcome: "block",
          message: buildHardeningMessage(evaluation),
          metadata: buildHardeningMetadata(evaluation)
        };
      }

      if (evaluation.overrideRequired && !context.request.overrideAcknowledged) {
        return {
          hookKey: "protected_window_publication_hardening",
          outcome: "block",
          message: buildHardeningMessage(evaluation),
          metadata: {
            ...buildHardeningMetadata(evaluation),
            overrideAcknowledged: false
          }
        };
      }

      if (evaluation.overrideRequired || evaluation.warningRules.length > 0) {
        return {
          hookKey: "protected_window_publication_hardening",
          outcome: "warning",
          message: buildHardeningMessage(evaluation),
          metadata: {
            ...buildHardeningMetadata(evaluation),
            overrideAcknowledged: Boolean(context.request.overrideAcknowledged)
          }
        };
      }

      return {
        hookKey: "protected_window_publication_hardening",
        outcome: "pass",
        message: null,
        metadata: buildHardeningMetadata(evaluation)
      };
    }
  };
}

export function evaluatePublicationHardening(
  context: StaffingPublicationValidationHookContext,
  options: ProtectedWindowPublicationHardeningHookOptions = {}
) {
  return evaluateLastMinuteStaffingChange(
    {
      actionKind: mapPublicationActionToHardeningAction(context),
      currentPublicationState: context.request.currentPublicationState,
      shootStartsAt: context.request.shootStartsAt ?? null,
      evaluationTime: context.request.evaluationTime ?? options.evaluationTime ?? null,
      actionEvaluation: context.actionEvaluation ?? null,
      staffingValidation: context.request.staffingValidation ?? null
    },
    {
      protectedWindowPolicy: options.protectedWindowPolicy
    }
  );
}
