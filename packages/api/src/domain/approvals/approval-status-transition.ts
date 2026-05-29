import type { ApprovalDecisionOutcome } from "./approval-decision.js";
import type { ApprovalStatus } from "./approval-status.js";

export const APPROVAL_OPEN_STATUS_REGISTRY = ["submitted", "under_review"] as const;

export type ApprovalOpenStatus = (typeof APPROVAL_OPEN_STATUS_REGISTRY)[number];

const APPROVAL_OPEN_STATUS_SET = new Set<string>(APPROVAL_OPEN_STATUS_REGISTRY);

export interface ApprovalStatusTransitionContext {
  currentStatus: ApprovalStatus;
  decisionOutcome: Extract<ApprovalDecisionOutcome, "approved" | "denied">;
  currentApprovedDecisionCount: number;
  requiredApproverCount: number;
}

export function isApprovalOpenStatus(value: string): value is ApprovalOpenStatus {
  return APPROVAL_OPEN_STATUS_SET.has(value);
}

export function resolveApprovalStatusTransition(
  context: ApprovalStatusTransitionContext
): ApprovalStatus {
  if (context.decisionOutcome === "denied") {
    return "denied";
  }

  const nextApprovedDecisionCount = context.currentApprovedDecisionCount + 1;

  if (nextApprovedDecisionCount >= context.requiredApproverCount) {
    return "approved";
  }

  return "under_review";
}
