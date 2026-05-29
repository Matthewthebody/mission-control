export const PROTECTED_STAFFING_WINDOW_LEVEL_REGISTRY = ["open", "protected", "locked"] as const;

export type ProtectedStaffingWindowLevel =
  (typeof PROTECTED_STAFFING_WINDOW_LEVEL_REGISTRY)[number];

export interface ProtectedStaffingWindowPolicy {
  protectedHoursBeforeShootStart: number;
  lockedHoursBeforeShootStart: number;
}

export interface ProtectedStaffingWindowEvaluationResult {
  policy: ProtectedStaffingWindowPolicy;
  shootStartKnown: boolean;
  shootStartsAt: string | null;
  evaluationTime: string;
  hoursUntilShootStart: number | null;
  windowLevel: ProtectedStaffingWindowLevel;
  insideProtectedWindow: boolean;
  insideLockedWindow: boolean;
}

export interface ProtectedStaffingWindowEvaluationInput {
  shootStartsAt?: string | Date | null;
  evaluationTime?: string | Date | null;
  policy?: ProtectedStaffingWindowPolicy;
}

export const DEFAULT_PROTECTED_STAFFING_WINDOW_POLICY: ProtectedStaffingWindowPolicy = {
  protectedHoursBeforeShootStart: 72,
  lockedHoursBeforeShootStart: 24
};

const PROTECTED_STAFFING_WINDOW_LEVEL_SET = new Set<string>(
  PROTECTED_STAFFING_WINDOW_LEVEL_REGISTRY
);

function normalizeDateInput(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isProtectedStaffingWindowLevel(value: string): value is ProtectedStaffingWindowLevel {
  return PROTECTED_STAFFING_WINDOW_LEVEL_SET.has(value);
}

export function evaluateProtectedStaffingWindow(
  input: ProtectedStaffingWindowEvaluationInput = {}
): ProtectedStaffingWindowEvaluationResult {
  const policy = input.policy ?? DEFAULT_PROTECTED_STAFFING_WINDOW_POLICY;
  const evaluationDate = normalizeDateInput(input.evaluationTime) ?? new Date();
  const shootStartDate = normalizeDateInput(input.shootStartsAt);
  const evaluationTime = evaluationDate.toISOString();
  const shootStartsAt = shootStartDate?.toISOString() ?? null;

  if (!shootStartDate) {
    return {
      policy,
      shootStartKnown: false,
      shootStartsAt,
      evaluationTime,
      hoursUntilShootStart: null,
      windowLevel: "open",
      insideProtectedWindow: false,
      insideLockedWindow: false
    };
  }

  const hoursUntilShootStart = (shootStartDate.getTime() - evaluationDate.getTime()) / (1000 * 60 * 60);
  const insideLockedWindow = hoursUntilShootStart <= policy.lockedHoursBeforeShootStart;
  const insideProtectedWindow = hoursUntilShootStart <= policy.protectedHoursBeforeShootStart;
  const windowLevel: ProtectedStaffingWindowLevel = insideLockedWindow
    ? "locked"
    : insideProtectedWindow
      ? "protected"
      : "open";

  return {
    policy,
    shootStartKnown: true,
    shootStartsAt,
    evaluationTime,
    hoursUntilShootStart,
    windowLevel,
    insideProtectedWindow,
    insideLockedWindow
  };
}
