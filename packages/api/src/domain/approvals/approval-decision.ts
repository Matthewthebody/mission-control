import type { ApprovalExecutionMode } from "./approval-execution-mode.js";
import type { ApprovalStatus } from "./approval-status.js";

export const APPROVAL_DECISION_OUTCOME_REGISTRY = ["approved", "denied", "returned"] as const;

export type ApprovalDecisionOutcome = (typeof APPROVAL_DECISION_OUTCOME_REGISTRY)[number];

export interface ApprovalDecision {
  approvalDecisionId: string;
  approvalRequestId: string;
  decisionOutcome: ApprovalDecisionOutcome;
  resultingStatus: ApprovalStatus;
  decidedByActorId: string;
  decidedAt: string;
  note: string | null;
  executionMode: ApprovalExecutionMode;
}

const APPROVAL_DECISION_OUTCOME_SET = new Set<string>(APPROVAL_DECISION_OUTCOME_REGISTRY);

export function isApprovalDecisionOutcome(value: string): value is ApprovalDecisionOutcome {
  return APPROVAL_DECISION_OUTCOME_SET.has(value);
}
