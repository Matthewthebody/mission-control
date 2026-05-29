import type { GoNoGoState } from "./go-no-go-state.js";
import {
  type ReadinessBlocker,
  type ReadinessCheckResult,
  type ReadinessEvaluationResult,
  type ReadinessMissingItem,
  getReadinessCheckDefinition
} from "./readiness-check.js";
import type { ReadinessCheckCode } from "./readiness-check-code.js";
import type { ReadinessCheckSeverity } from "./readiness-check-severity.js";
import { isReadinessHardBlockerCheckCode } from "./readiness-scoring-policy.js";
import type { ReadinessState } from "./readiness-state.js";
import type { ReadinessWeightCategory } from "./readiness-weight-category.js";

export interface ShootReadinessCheckSummary {
  checkCode: ReadinessCheckCode;
  label: string;
  description: string;
  passed: boolean;
  severity: ReadinessCheckSeverity;
  weightCategory: ReadinessWeightCategory;
  blocking: boolean;
  hardBlocker: boolean;
  message: string | null;
}

export interface ShootReadinessMissingItemDto {
  checkCode: ReadinessCheckCode;
  label: string;
  severity: ReadinessCheckSeverity;
  weightCategory: ReadinessWeightCategory;
  blocking: boolean;
  hardBlocker: boolean;
  message: string | null;
}

export interface ShootReadinessBlockerDto {
  checkCode: ReadinessCheckCode;
  label: string;
  severity: ReadinessCheckSeverity;
  hardBlocker: boolean;
  message: string | null;
}

export interface ReadinessCompactBadgePayload {
  readinessState: ReadinessState;
  readinessLabel: string;
  goNoGoState: GoNoGoState;
  goNoGoLabel: string;
  blocked: boolean;
  scorePercentage: number;
}

export interface ReadinessDetailedPanelPayload {
  readinessState: ReadinessState;
  readinessLabel: string;
  goNoGoState: GoNoGoState;
  goNoGoLabel: string;
  scorePercentage: number;
  summaryLine: string;
  missingItemCount: number;
  blockerCount: number;
  checks: ShootReadinessCheckSummary[];
  missingItems: ShootReadinessMissingItemDto[];
  blockers: ShootReadinessBlockerDto[];
}

export interface ShootReadinessSummary {
  shootId: string;
  readinessState: ReadinessState;
  goNoGoState: GoNoGoState;
  scoreEarned: number;
  scorePossible: number;
  scorePercentage: number;
  passedCheckCount: number;
  failedCheckCount: number;
  blockingCheckCount: number;
  warningCheckCount: number;
  missingItemCount: number;
  blockerCount: number;
  compactBadge: ReadinessCompactBadgePayload;
}

export interface ShootReadinessDetailDto {
  summary: ShootReadinessSummary;
  panel: ReadinessDetailedPanelPayload;
}

function sortCheckResults(checkResults: ReadonlyArray<ReadinessCheckResult>) {
  return [...checkResults].sort(
    (left, right) =>
      getReadinessCheckDefinition(left.checkCode).sortOrder -
      getReadinessCheckDefinition(right.checkCode).sortOrder
  );
}

function sortMissingItems(missingItems: ReadonlyArray<ReadinessMissingItem>) {
  return [...missingItems].sort(
    (left, right) =>
      getReadinessCheckDefinition(left.checkCode).sortOrder -
      getReadinessCheckDefinition(right.checkCode).sortOrder
  );
}

function sortBlockers(blockers: ReadonlyArray<ReadinessBlocker>) {
  return [...blockers].sort(
    (left, right) =>
      getReadinessCheckDefinition(left.checkCode).sortOrder -
      getReadinessCheckDefinition(right.checkCode).sortOrder
  );
}

function buildReadinessStateLabel(readinessState: ReadinessState) {
  switch (readinessState) {
    case "not_evaluated":
      return "Not Evaluated";
    case "not_ready":
      return "Not Ready";
    case "needs_attention":
      return "Needs Attention";
    case "ready":
      return "Ready";
  }
}

function buildGoNoGoStateLabel(goNoGoState: GoNoGoState) {
  switch (goNoGoState) {
    case "go":
      return "Go";
    case "hold":
      return "Hold";
    case "no_go":
      return "No-Go";
  }
}

function buildSummaryLine(result: ReadinessEvaluationResult) {
  if (result.checkResults.length === 0) {
    return "Readiness has not been evaluated yet.";
  }

  if (result.blockers.length > 0) {
    return `${result.blockers.length} readiness blocker${result.blockers.length === 1 ? "" : "s"} must be cleared before the Shoot is ready.`;
  }

  if (result.missingItems.length > 0) {
    return `${result.missingItems.length} readiness item${result.missingItems.length === 1 ? "" : "s"} still need attention.`;
  }

  return "Readiness checks are currently satisfied.";
}

export function createShootReadinessCheckSummary(
  checkResult: ReadinessCheckResult
): ShootReadinessCheckSummary {
  const definition = getReadinessCheckDefinition(checkResult.checkCode);

  return {
    checkCode: checkResult.checkCode,
    label: definition.label,
    description: definition.description,
    passed: checkResult.passed,
    severity: checkResult.severity,
    weightCategory: checkResult.weightCategory,
    blocking: checkResult.blocking,
    hardBlocker: !checkResult.passed && isReadinessHardBlockerCheckCode(checkResult.checkCode),
    message: checkResult.message
  };
}

export function createShootReadinessMissingItemDto(
  missingItem: ReadinessMissingItem
): ShootReadinessMissingItemDto {
  return {
    checkCode: missingItem.checkCode,
    label: missingItem.label,
    severity: missingItem.severity,
    weightCategory: missingItem.weightCategory,
    blocking: missingItem.blocking,
    hardBlocker: missingItem.hardBlocker,
    message: missingItem.message
  };
}

export function createShootReadinessBlockerDto(
  blocker: ReadinessBlocker
): ShootReadinessBlockerDto {
  return {
    checkCode: blocker.checkCode,
    label: blocker.label,
    severity: blocker.severity,
    hardBlocker: blocker.hardBlocker,
    message: blocker.message
  };
}

export function createReadinessCompactBadgePayload(
  result: ReadinessEvaluationResult
): ReadinessCompactBadgePayload {
  return {
    readinessState: result.readinessState,
    readinessLabel: buildReadinessStateLabel(result.readinessState),
    goNoGoState: result.goNoGoState,
    goNoGoLabel: buildGoNoGoStateLabel(result.goNoGoState),
    blocked: result.blockers.length > 0,
    scorePercentage: result.scorePercentage
  };
}

export function createReadinessDetailedPanelPayload(
  result: ReadinessEvaluationResult
): ReadinessDetailedPanelPayload {
  return {
    readinessState: result.readinessState,
    readinessLabel: buildReadinessStateLabel(result.readinessState),
    goNoGoState: result.goNoGoState,
    goNoGoLabel: buildGoNoGoStateLabel(result.goNoGoState),
    scorePercentage: result.scorePercentage,
    summaryLine: buildSummaryLine(result),
    missingItemCount: result.missingItems.length,
    blockerCount: result.blockers.length,
    checks: sortCheckResults(result.checkResults).map(createShootReadinessCheckSummary),
    missingItems: sortMissingItems(result.missingItems).map(createShootReadinessMissingItemDto),
    blockers: sortBlockers(result.blockers).map(createShootReadinessBlockerDto)
  };
}

export function createShootReadinessSummary(
  shootId: string,
  result: ReadinessEvaluationResult
): ShootReadinessSummary {
  return {
    shootId,
    readinessState: result.readinessState,
    goNoGoState: result.goNoGoState,
    scoreEarned: result.scoreEarned,
    scorePossible: result.scorePossible,
    scorePercentage: result.scorePercentage,
    passedCheckCount: result.passedCheckCount,
    failedCheckCount: result.failedCheckCount,
    blockingCheckCount: result.blockingCheckCount,
    warningCheckCount: result.warningCheckCount,
    missingItemCount: result.missingItems.length,
    blockerCount: result.blockers.length,
    compactBadge: createReadinessCompactBadgePayload(result)
  };
}

export function createShootReadinessDetailDto(
  shootId: string,
  result: ReadinessEvaluationResult
): ShootReadinessDetailDto {
  return {
    summary: createShootReadinessSummary(shootId, result),
    panel: createReadinessDetailedPanelPayload(result)
  };
}
