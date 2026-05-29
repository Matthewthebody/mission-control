import type { StaffingActionEvaluationResult } from "./staffing-action-evaluation.js";
import type { StaffingCapability } from "./staffing-capability.js";
import {
  type ProtectedStaffingWindowEvaluationResult,
  type ProtectedStaffingWindowPolicy,
  evaluateProtectedStaffingWindow
} from "./protected-staffing-window-policy.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";
import {
  STAFFING_HARDENING_POLICY_REGISTRY,
  type StaffingHardeningActionKind,
  type StaffingHardeningPolicyRule,
  type StaffingHardeningRuleCode
} from "./staffing-hardening-policy.js";
import type { StaffingValidationResult } from "./staffing-validation.js";

export interface LastMinuteStaffingChangeEvaluationContext {
  actionKind: StaffingHardeningActionKind;
  currentPublicationState: StaffingPublicationState;
  shootStartsAt?: string | Date | null;
  evaluationTime?: string | Date | null;
  actionEvaluation?: StaffingActionEvaluationResult | null;
  staffingValidation?: StaffingValidationResult | null;
  leadCoverageWillBeReduced?: boolean;
  staffingCountWillBeReduced?: boolean;
}

export interface StaffingHardeningTriggeredRule {
  ruleCode: StaffingHardeningRuleCode;
  outcome: StaffingHardeningPolicyRule["outcome"];
  message: string;
  requiredCapabilities: StaffingCapability[];
}

export interface LastMinuteStaffingChangeEvaluationResult {
  actionKind: StaffingHardeningActionKind;
  currentPublicationState: StaffingPublicationState;
  windowEvaluation: ProtectedStaffingWindowEvaluationResult;
  triggeredRules: StaffingHardeningTriggeredRule[];
  warningRules: StaffingHardeningTriggeredRule[];
  overrideRequiredRules: StaffingHardeningTriggeredRule[];
  blockingRules: StaffingHardeningTriggeredRule[];
  blocked: boolean;
  overrideRequired: boolean;
  directActionAllowed: boolean;
  requiredCapabilities: StaffingCapability[];
}

export interface LastMinuteStaffingChangeEvaluatorOptions {
  protectedWindowPolicy?: ProtectedStaffingWindowPolicy;
}

function applyRule(
  triggeredRules: StaffingHardeningTriggeredRule[],
  ruleCode: StaffingHardeningRuleCode
) {
  const rule = STAFFING_HARDENING_POLICY_REGISTRY[ruleCode];
  triggeredRules.push({
    ruleCode: rule.ruleCode,
    outcome: rule.outcome,
    message: rule.message,
    requiredCapabilities: [...rule.requiredCapabilities]
  });
}

function isPublishedState(state: StaffingPublicationState) {
  return state === "published";
}

function hasPublishRisk(context: LastMinuteStaffingChangeEvaluationContext) {
  if (context.actionEvaluation?.overrideRequirement) {
    return true;
  }

  if (context.actionEvaluation && context.actionEvaluation.dangerousActionTypes.length > 0) {
    return true;
  }

  if (context.staffingValidation && !context.staffingValidation.staffingValidationPassed) {
    return true;
  }

  return false;
}

function collectRequiredCapabilities(
  triggeredRules: StaffingHardeningTriggeredRule[]
): StaffingCapability[] {
  return [...new Set(triggeredRules.flatMap((rule) => rule.requiredCapabilities))];
}

export function evaluateLastMinuteStaffingChange(
  context: LastMinuteStaffingChangeEvaluationContext,
  options: LastMinuteStaffingChangeEvaluatorOptions = {}
): LastMinuteStaffingChangeEvaluationResult {
  const windowEvaluation = evaluateProtectedStaffingWindow({
    shootStartsAt: context.shootStartsAt,
    evaluationTime: context.evaluationTime,
    policy: options.protectedWindowPolicy
  });

  const triggeredRules: StaffingHardeningTriggeredRule[] = [];

  if (windowEvaluation.insideProtectedWindow) {
    if (
      (context.actionKind === "change_staffing_assignment" ||
        context.actionKind === "remove_staffing_assignment") &&
      isPublishedState(context.currentPublicationState)
    ) {
      applyRule(triggeredRules, "published_change_inside_protected_window");
    }

    if (context.actionKind === "publish_staffing" && hasPublishRisk(context)) {
      applyRule(triggeredRules, "publish_with_risk_inside_protected_window");
    }

    if (context.actionKind === "unpublish_staffing" && isPublishedState(context.currentPublicationState)) {
      applyRule(triggeredRules, "unpublish_inside_protected_window");
    }
  }

  if (windowEvaluation.insideLockedWindow) {
    if (
      (context.actionKind === "change_staffing_assignment" ||
        context.actionKind === "remove_staffing_assignment") &&
      isPublishedState(context.currentPublicationState) &&
      context.staffingCountWillBeReduced
    ) {
      applyRule(triggeredRules, "published_change_reduces_staffing_inside_locked_window");
    }

    if (
      (context.actionKind === "change_staffing_assignment" ||
        context.actionKind === "remove_staffing_assignment") &&
      isPublishedState(context.currentPublicationState) &&
      context.leadCoverageWillBeReduced
    ) {
      applyRule(triggeredRules, "published_change_reduces_lead_coverage_inside_locked_window");
    }

    if (context.actionKind === "unpublish_staffing" && isPublishedState(context.currentPublicationState)) {
      applyRule(triggeredRules, "unpublish_inside_locked_window");
    }
  }

  const warningRules = triggeredRules.filter((rule) => rule.outcome === "warning");
  const overrideRequiredRules = triggeredRules.filter((rule) => rule.outcome === "override_required");
  const blockingRules = triggeredRules.filter((rule) => rule.outcome === "block");
  const blocked = blockingRules.length > 0;
  const overrideRequired = !blocked && overrideRequiredRules.length > 0;
  const directActionAllowed = !blocked && !overrideRequired;

  return {
    actionKind: context.actionKind,
    currentPublicationState: context.currentPublicationState,
    windowEvaluation,
    triggeredRules,
    warningRules,
    overrideRequiredRules,
    blockingRules,
    blocked,
    overrideRequired,
    directActionAllowed,
    requiredCapabilities: collectRequiredCapabilities(triggeredRules)
  };
}
