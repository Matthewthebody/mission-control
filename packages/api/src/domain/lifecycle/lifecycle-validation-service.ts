import type { ShootLifecycleApprovalContext, ShootLifecycleApprovalRequirement } from "./shoot-lifecycle-approval.js";
import type {
  ShootLifecycleBlockerEvaluation,
  ShootLifecycleBlockerEvaluatorRegistry,
  ShootLifecycleTransitionContext
} from "./shoot-lifecycle-blocker.js";
import {
  SHOOT_LIFECYCLE_DANGEROUS_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_TERMINAL_STATUS_REGISTRY
} from "./shoot-lifecycle-dangerous.registry.js";
import { SHOOT_LIFECYCLE_TRANSITION_REGISTRY } from "./shoot-lifecycle.registry.js";
import { TRANSITION_BLOCKER_POLICY } from "./transition-blocker-policy.js";
import type {
  ShootLifecycleTransitionRequest,
  ShootLifecycleTransitionResult
} from "./shoot-lifecycle-transition.js";

export interface ShootLifecycleValidationOptions {
  transitionContext?: Omit<
    Partial<ShootLifecycleTransitionContext>,
    "currentStatus" | "targetStatus" | "actorRoles" | "reason" | "transition"
  >;
  blockerEvaluatorRegistry?: ShootLifecycleBlockerEvaluatorRegistry;
  approvalContext?: ShootLifecycleApprovalContext;
}

function evaluateTransitionBlockers(
  transitionContext: ShootLifecycleTransitionContext,
  blockerEvaluatorRegistry: ShootLifecycleBlockerEvaluatorRegistry
): ShootLifecycleBlockerEvaluation[] {
  const transitionKey = transitionContext.transition.transitionKey as keyof typeof TRANSITION_BLOCKER_POLICY;
  const evaluatorKeys = TRANSITION_BLOCKER_POLICY[transitionKey] ?? [];

  return evaluatorKeys.flatMap((evaluatorKey) => {
    const evaluator = blockerEvaluatorRegistry[evaluatorKey];
    if (!evaluator) {
      return [];
    }
    return [evaluator.evaluate(transitionContext)];
  });
}

function splitBlockerEvaluations(blockerEvaluations: ShootLifecycleBlockerEvaluation[]) {
  return {
    hardBlockers: blockerEvaluations.filter((evaluation) => evaluation.outcome === "hard_blocker"),
    warnings: blockerEvaluations.filter((evaluation) => evaluation.outcome === "warning")
  };
}

function isTerminalStatus(status: ShootLifecycleTransitionRequest["currentStatus"]) {
  return (SHOOT_LIFECYCLE_TERMINAL_STATUS_REGISTRY as readonly string[]).includes(status);
}

function isDangerousTransition(transitionKey: string) {
  return (SHOOT_LIFECYCLE_DANGEROUS_TRANSITION_REGISTRY as readonly string[]).includes(transitionKey);
}

function buildApprovalRequirement(
  controlClass: ShootLifecycleTransitionResult["matchedTransition"] extends infer _ ? string : never,
  transitionKey: string | null,
  approvalContext?: ShootLifecycleApprovalContext
): ShootLifecycleApprovalRequirement | null {
  const required = controlClass === "approval_gated";
  if (!required) {
    return null;
  }

  return {
    required: true,
    satisfied: approvalContext?.approvalSatisfied ?? false,
    approvalRequestId: approvalContext?.approvalRequestId ?? null,
    transitionKey
  };
}

export function validateShootLifecycleTransition(
  request: ShootLifecycleTransitionRequest,
  options: ShootLifecycleValidationOptions = {}
): ShootLifecycleTransitionResult {
  const currentStatusIsTerminal = isTerminalStatus(request.currentStatus);
  const matchedTransition =
    SHOOT_LIFECYCLE_TRANSITION_REGISTRY.find(
      (transition) =>
        transition.fromStatus === request.currentStatus && transition.toStatus === request.targetStatus
    ) ?? null;

  if (!matchedTransition) {
    return {
      allowed: false,
      currentStatus: request.currentStatus,
      targetStatus: request.targetStatus,
      denialReason: currentStatusIsTerminal ? "terminal_status_locked" : "transition_not_found",
      matchedTransition: null,
      allowedRoles: [],
      reasonRequired: false,
      blockerEvaluations: [],
      hardBlockers: [],
      warnings: [],
      approvalRequirement: null,
      dangerousTransition: false
    };
  }

  const dangerousTransition = isDangerousTransition(matchedTransition.transitionKey);
  const approvalRequirement = buildApprovalRequirement(
    matchedTransition.controlClass,
    matchedTransition.transitionKey,
    options.approvalContext
  );

  if (currentStatusIsTerminal && matchedTransition.transitionDirection !== "reopen") {
    return {
      allowed: false,
      currentStatus: request.currentStatus,
      targetStatus: request.targetStatus,
      denialReason: "terminal_status_locked",
      matchedTransition,
      allowedRoles: matchedTransition.allowedRoles,
      reasonRequired: matchedTransition.reasonRequired || dangerousTransition,
      blockerEvaluations: [],
      hardBlockers: [],
      warnings: [],
      approvalRequirement,
      dangerousTransition
    };
  }

  const actorAllowed = request.actorRoles.some((role) => matchedTransition.allowedRoles.includes(role));

  if (!actorAllowed) {
    return {
      allowed: false,
      currentStatus: request.currentStatus,
      targetStatus: request.targetStatus,
      denialReason: "actor_not_allowed",
      matchedTransition,
      allowedRoles: matchedTransition.allowedRoles,
      reasonRequired: matchedTransition.reasonRequired || dangerousTransition,
      blockerEvaluations: [],
      hardBlockers: [],
      warnings: [],
      approvalRequirement,
      dangerousTransition
    };
  }

  const reasonRequired = matchedTransition.reasonRequired || dangerousTransition;

  if (reasonRequired && (!request.reason || request.reason.trim().length === 0)) {
    return {
      allowed: false,
      currentStatus: request.currentStatus,
      targetStatus: request.targetStatus,
      denialReason: "reason_required",
      matchedTransition,
      allowedRoles: matchedTransition.allowedRoles,
      reasonRequired: true,
      blockerEvaluations: [],
      hardBlockers: [],
      warnings: [],
      approvalRequirement,
      dangerousTransition
    };
  }

  if (approvalRequirement && !approvalRequirement.satisfied) {
    return {
      allowed: false,
      currentStatus: request.currentStatus,
      targetStatus: request.targetStatus,
      denialReason: "approval_required",
      matchedTransition,
      allowedRoles: matchedTransition.allowedRoles,
      reasonRequired,
      blockerEvaluations: [],
      hardBlockers: [],
      warnings: [],
      approvalRequirement,
      dangerousTransition
    };
  }

  const blockerEvaluations =
    options.blockerEvaluatorRegistry && Object.keys(options.blockerEvaluatorRegistry).length > 0
      ? evaluateTransitionBlockers(
          {
            currentStatus: request.currentStatus,
            targetStatus: request.targetStatus,
            actorRoles: request.actorRoles,
            reason: request.reason,
            transition: matchedTransition,
            ...options.transitionContext
          },
          options.blockerEvaluatorRegistry
        )
      : [];

  const { hardBlockers, warnings } = splitBlockerEvaluations(blockerEvaluations);

  if (hardBlockers.length > 0) {
    return {
      allowed: false,
      currentStatus: request.currentStatus,
      targetStatus: request.targetStatus,
      denialReason: "blocked_by_evaluator",
      matchedTransition,
      allowedRoles: matchedTransition.allowedRoles,
      reasonRequired,
      blockerEvaluations,
      hardBlockers,
      warnings,
      approvalRequirement,
      dangerousTransition
    };
  }

  return {
    allowed: true,
    currentStatus: request.currentStatus,
    targetStatus: request.targetStatus,
    denialReason: null,
    matchedTransition,
    allowedRoles: matchedTransition.allowedRoles,
    reasonRequired,
    blockerEvaluations,
    hardBlockers,
    warnings,
    approvalRequirement,
    dangerousTransition
  };
}
