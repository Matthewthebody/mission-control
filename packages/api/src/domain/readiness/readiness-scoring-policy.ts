import type { ReadinessCheckCode } from "./readiness-check-code.js";

export interface ReadinessStateThresholds {
  readyMinimumScore: number;
  needsAttentionMinimumScore: number;
}

export const DEFAULT_READINESS_STATE_THRESHOLDS: ReadinessStateThresholds = {
  readyMinimumScore: 85,
  needsAttentionMinimumScore: 60
};

export const READINESS_HARD_BLOCKER_CHECK_CODE_REGISTRY = [
  "staffing_complete",
  "lead_assigned",
  "schedule_timing_confirmed",
  "equipment_ready",
  "approval_clearance"
] as const satisfies readonly ReadinessCheckCode[];

export type ReadinessHardBlockerCheckCode =
  (typeof READINESS_HARD_BLOCKER_CHECK_CODE_REGISTRY)[number];

const READINESS_HARD_BLOCKER_CHECK_CODE_SET = new Set<string>(READINESS_HARD_BLOCKER_CHECK_CODE_REGISTRY);

export function isReadinessHardBlockerCheckCode(
  value: string
): value is ReadinessHardBlockerCheckCode {
  return READINESS_HARD_BLOCKER_CHECK_CODE_SET.has(value);
}
