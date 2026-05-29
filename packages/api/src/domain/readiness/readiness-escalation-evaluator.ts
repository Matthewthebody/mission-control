import {
  type ReadinessAlertCandidate,
  type ReadinessAlertSeverity,
  type ReadinessEscalationEvaluationResult
} from "./readiness-alert-candidate.js";
import type { ShootReadinessDetailDto } from "./shoot-readiness-dto.js";

export interface ReadinessEscalationEvaluationContext {
  shootId: string;
  shootCode?: string | null;
  shootStartsAt?: string | Date | null;
  evaluationTime?: string | Date | null;
  readinessDetail: ShootReadinessDetailDto;
}

export interface ReadinessEscalationPolicy {
  warningHoursBeforeShootStart: number;
  majorHoursBeforeShootStart: number;
}

export const DEFAULT_READINESS_ESCALATION_POLICY: ReadinessEscalationPolicy = {
  warningHoursBeforeShootStart: 72,
  majorHoursBeforeShootStart: 24
};

function normalizeDateInput(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getHoursUntilShootStart(context: ReadinessEscalationEvaluationContext) {
  const shootStart = normalizeDateInput(context.shootStartsAt);
  const evaluationTime = normalizeDateInput(context.evaluationTime) ?? new Date();

  if (!shootStart) {
    return null;
  }

  return (shootStart.getTime() - evaluationTime.getTime()) / (1000 * 60 * 60);
}

function buildMetadata(
  context: ReadinessEscalationEvaluationContext,
  hoursUntilShootStart: number | null
) {
  return {
    shootId: context.shootId,
    shootCode: context.shootCode ?? null,
    hoursUntilShootStart,
    blockerCount: context.readinessDetail.summary.blockerCount,
    missingItemCount: context.readinessDetail.summary.missingItemCount,
    readinessState: context.readinessDetail.summary.readinessState,
    goNoGoState: context.readinessDetail.summary.goNoGoState
  };
}

function compareSeverity(left: ReadinessAlertSeverity, right: ReadinessAlertSeverity) {
  const weights: Record<ReadinessAlertSeverity, number> = {
    warning: 1,
    major: 2,
    critical: 3
  };

  return weights[right] - weights[left];
}

export function evaluateReadinessEscalation(
  context: ReadinessEscalationEvaluationContext,
  policy: ReadinessEscalationPolicy = DEFAULT_READINESS_ESCALATION_POLICY
): ReadinessEscalationEvaluationResult {
  const summary = context.readinessDetail.summary;
  const hoursUntilShootStart = getHoursUntilShootStart(context);
  const metadata = buildMetadata(context, hoursUntilShootStart);
  const alertCandidates: ReadinessAlertCandidate[] = [];

  if (summary.goNoGoState === "no_go") {
    alertCandidates.push({
      ruleCode: "no_go_state",
      severity: "critical",
      readinessState: summary.readinessState,
      goNoGoState: summary.goNoGoState,
      title: "Readiness is in No-Go state",
      summary: `${summary.blockerCount} blocker${summary.blockerCount === 1 ? "" : "s"} are preventing this Shoot from proceeding.`,
      recommendedAction: "Open the readiness panel, clear the blocking items, or route the needed override workflow.",
      metadata
    });
  }

  if (
    summary.blockerCount > 0 &&
    hoursUntilShootStart != null &&
    hoursUntilShootStart <= policy.majorHoursBeforeShootStart
  ) {
    alertCandidates.push({
      ruleCode: "blocked_upcoming_shoot",
      severity: "major",
      readinessState: summary.readinessState,
      goNoGoState: summary.goNoGoState,
      title: "Upcoming shoot still has readiness blockers",
      summary: `This Shoot starts within ${policy.majorHoursBeforeShootStart} hours and still has ${summary.blockerCount} blocker${summary.blockerCount === 1 ? "" : "s"}.`,
      recommendedAction: "Escalate the blocking readiness items before the protected execution window closes.",
      metadata
    });
  }

  if (
    summary.readinessState === "needs_attention" &&
    summary.missingItemCount > 0 &&
    hoursUntilShootStart != null &&
    hoursUntilShootStart <= policy.warningHoursBeforeShootStart
  ) {
    alertCandidates.push({
      ruleCode: "needs_attention_protected_window",
      severity: hoursUntilShootStart <= policy.majorHoursBeforeShootStart ? "major" : "warning",
      readinessState: summary.readinessState,
      goNoGoState: summary.goNoGoState,
      title: "Readiness still needs attention inside the escalation window",
      summary: `${summary.missingItemCount} readiness item${summary.missingItemCount === 1 ? "" : "s"} still need attention before execution.`,
      recommendedAction: "Review the missing items and close them before the Shoot reaches the next review checkpoint.",
      metadata
    });
  }

  if (
    summary.readinessState === "not_evaluated" &&
    hoursUntilShootStart != null &&
    hoursUntilShootStart <= policy.warningHoursBeforeShootStart
  ) {
    alertCandidates.push({
      ruleCode: "upcoming_not_evaluated",
      severity: "warning",
      readinessState: summary.readinessState,
      goNoGoState: summary.goNoGoState,
      title: "Upcoming shoot has not been evaluated for readiness",
      summary: "Readiness evaluation has not been completed inside the escalation window.",
      recommendedAction: "Run readiness evaluation and surface any blockers before staffing and day-of execution tighten.",
      metadata
    });
  }

  const sortedCandidates = [...alertCandidates].sort((left, right) => compareSeverity(left.severity, right.severity));

  return {
    alertCandidates: sortedCandidates,
    highestSeverity: sortedCandidates[0]?.severity ?? null,
    escalationRequired: sortedCandidates.length > 0
  };
}
