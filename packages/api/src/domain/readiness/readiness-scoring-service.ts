import type { GoNoGoState } from "./go-no-go-state.js";
import {
  type ReadinessBlocker,
  type ReadinessCheckResult,
  type ReadinessEvaluationResult,
  type ReadinessMissingItem,
  getReadinessCheckDefinition,
  getReadinessWeightValue
} from "./readiness-check.js";
import {
  DEFAULT_READINESS_STATE_THRESHOLDS,
  type ReadinessStateThresholds,
  isReadinessHardBlockerCheckCode
} from "./readiness-scoring-policy.js";
import type { ReadinessState } from "./readiness-state.js";

export interface ReadinessScoringOptions {
  stateThresholds?: ReadinessStateThresholds;
}

export interface ReadinessScoreBreakdown {
  scoreEarned: number;
  scorePossible: number;
  scorePercentage: number;
}

function isFailedResult(checkResult: ReadinessCheckResult) {
  return !checkResult.passed;
}

function isHardBlockerResult(checkResult: ReadinessCheckResult) {
  return isFailedResult(checkResult) && isReadinessHardBlockerCheckCode(checkResult.checkCode);
}

function isBlockingResult(checkResult: ReadinessCheckResult) {
  return isFailedResult(checkResult) && (checkResult.blocking || isReadinessHardBlockerCheckCode(checkResult.checkCode));
}

export function calculateReadinessScore(checkResults: ReadonlyArray<ReadinessCheckResult>): ReadinessScoreBreakdown {
  const scorePossible = checkResults.reduce(
    (sum, checkResult) => sum + getReadinessWeightValue(checkResult.weightCategory),
    0
  );
  const scoreEarned = checkResults.reduce(
    (sum, checkResult) =>
      sum + (checkResult.passed ? getReadinessWeightValue(checkResult.weightCategory) : 0),
    0
  );
  const scorePercentage = scorePossible === 0 ? 0 : Math.round((scoreEarned / scorePossible) * 100);

  return {
    scoreEarned,
    scorePossible,
    scorePercentage
  };
}

export function createReadinessMissingItems(
  checkResults: ReadonlyArray<ReadinessCheckResult>
): ReadinessMissingItem[] {
  return checkResults
    .filter(isFailedResult)
    .map((checkResult) => {
      const definition = getReadinessCheckDefinition(checkResult.checkCode);
      return {
        checkCode: checkResult.checkCode,
        label: definition.label,
        severity: checkResult.severity,
        weightCategory: checkResult.weightCategory,
        blocking: isBlockingResult(checkResult),
        hardBlocker: isHardBlockerResult(checkResult),
        message: checkResult.message
      };
    });
}

export function createReadinessBlockers(
  checkResults: ReadonlyArray<ReadinessCheckResult>
): ReadinessBlocker[] {
  return checkResults
    .filter(isBlockingResult)
    .map((checkResult) => {
      const definition = getReadinessCheckDefinition(checkResult.checkCode);
      return {
        checkCode: checkResult.checkCode,
        label: definition.label,
        severity: checkResult.severity,
        hardBlocker: isHardBlockerResult(checkResult),
        message: checkResult.message
      };
    });
}

export function resolveReadinessState(
  checkResults: ReadonlyArray<ReadinessCheckResult>,
  options: ReadinessScoringOptions = {}
): ReadinessState {
  if (checkResults.length === 0) {
    return "not_evaluated";
  }

  const thresholds = options.stateThresholds ?? DEFAULT_READINESS_STATE_THRESHOLDS;
  const { scorePercentage } = calculateReadinessScore(checkResults);
  const blockers = createReadinessBlockers(checkResults);
  const hasFailures = checkResults.some(isFailedResult);

  if (blockers.some((blocker) => blocker.hardBlocker)) {
    return "not_ready";
  }

  if (!hasFailures && scorePercentage >= thresholds.readyMinimumScore) {
    return "ready";
  }

  if (scorePercentage >= thresholds.needsAttentionMinimumScore) {
    return "needs_attention";
  }

  return "not_ready";
}

export function resolveGoNoGoState(
  readinessState: ReadinessState,
  blockers: ReadonlyArray<ReadinessBlocker>
): GoNoGoState {
  if (blockers.some((blocker) => blocker.hardBlocker)) {
    return "no_go";
  }

  if (readinessState === "ready") {
    return "go";
  }

  return "hold";
}

export function evaluateReadiness(
  checkResults: ReadonlyArray<ReadinessCheckResult>,
  options: ReadinessScoringOptions = {}
): ReadinessEvaluationResult {
  const normalizedCheckResults = [...checkResults];
  const missingItems = createReadinessMissingItems(normalizedCheckResults);
  const blockers = createReadinessBlockers(normalizedCheckResults);
  const { scoreEarned, scorePossible, scorePercentage } = calculateReadinessScore(normalizedCheckResults);
  const readinessState = resolveReadinessState(normalizedCheckResults, options);
  const goNoGoState = resolveGoNoGoState(readinessState, blockers);

  return {
    readinessState,
    goNoGoState,
    checkResults: normalizedCheckResults,
    missingItems,
    blockers,
    passedCheckCount: normalizedCheckResults.filter((checkResult) => checkResult.passed).length,
    failedCheckCount: normalizedCheckResults.filter(isFailedResult).length,
    blockingCheckCount: blockers.length,
    warningCheckCount: normalizedCheckResults.filter(
      (checkResult) => !checkResult.passed && !isBlockingResult(checkResult)
    ).length,
    scoreEarned,
    scorePossible,
    scorePercentage
  };
}
