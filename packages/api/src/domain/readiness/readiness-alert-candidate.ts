import type { GoNoGoState } from "./go-no-go-state.js";
import type { ReadinessState } from "./readiness-state.js";

export const READINESS_ALERT_SEVERITY_REGISTRY = ["warning", "major", "critical"] as const;

export type ReadinessAlertSeverity = (typeof READINESS_ALERT_SEVERITY_REGISTRY)[number];

export const READINESS_ESCALATION_RULE_CODE_REGISTRY = [
  "no_go_state",
  "blocked_upcoming_shoot",
  "needs_attention_protected_window",
  "upcoming_not_evaluated"
] as const;

export type ReadinessEscalationRuleCode =
  (typeof READINESS_ESCALATION_RULE_CODE_REGISTRY)[number];

export interface ReadinessAlertCandidate {
  ruleCode: ReadinessEscalationRuleCode;
  severity: ReadinessAlertSeverity;
  readinessState: ReadinessState;
  goNoGoState: GoNoGoState;
  title: string;
  summary: string;
  recommendedAction: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReadinessEscalationEvaluationResult {
  alertCandidates: ReadinessAlertCandidate[];
  highestSeverity: ReadinessAlertSeverity | null;
  escalationRequired: boolean;
}

const READINESS_ALERT_SEVERITY_SET = new Set<string>(READINESS_ALERT_SEVERITY_REGISTRY);
const READINESS_ESCALATION_RULE_CODE_SET = new Set<string>(READINESS_ESCALATION_RULE_CODE_REGISTRY);

export function isReadinessAlertSeverity(value: string): value is ReadinessAlertSeverity {
  return READINESS_ALERT_SEVERITY_SET.has(value);
}

export function isReadinessEscalationRuleCode(value: string): value is ReadinessEscalationRuleCode {
  return READINESS_ESCALATION_RULE_CODE_SET.has(value);
}
