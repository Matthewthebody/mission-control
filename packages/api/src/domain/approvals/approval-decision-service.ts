import type { ApprovalDecision, ApprovalDecisionOutcome } from "./approval-decision.js";
import type { ApprovalAuditWriter } from "./approval-audit.js";
import { getApprovalPolicyByKey } from "./approval-policy.registry.js";
import type { ApprovalDecisionRepository } from "./approval-decision.repository.js";
import type { ApprovalRequest } from "./approval-request.js";
import type { ApprovalStatus } from "./approval-status.js";
import {
  isApprovalOpenStatus,
  resolveApprovalStatusTransition,
  type ApprovalOpenStatus
} from "./approval-status-transition.js";

export const APPROVAL_DECISION_DENIAL_REASON_REGISTRY = [
  "approval_request_not_found",
  "approval_request_not_open",
  "self_approval_not_allowed",
  "duplicate_approver_decision",
  "unsupported_decision_outcome"
] as const;

export type ApprovalDecisionDenialReason =
  (typeof APPROVAL_DECISION_DENIAL_REASON_REGISTRY)[number];

export interface RecordApprovalDecisionInput {
  approvalRequestId: string;
  decisionOutcome: ApprovalDecisionOutcome;
  decidedByActorId: string;
  note?: string | null;
}

export interface RecordApprovalDecisionDependencies {
  approvalDecisionRepository: ApprovalDecisionRepository;
  approvalAuditWriter?: ApprovalAuditWriter;
  createApprovalDecisionId?: () => string;
  getCurrentTime?: () => string;
}

export interface ApprovalDecisionServiceResult {
  recorded: boolean;
  approvalRequest: ApprovalRequest | null;
  approvalDecision: ApprovalDecision | null;
  previousStatus: ApprovalOpenStatus | null;
  resultingStatus: ApprovalStatus | null;
  denialReason: ApprovalDecisionDenialReason | null;
}

const APPROVAL_DECISION_DENIAL_REASON_SET = new Set<string>(
  APPROVAL_DECISION_DENIAL_REASON_REGISTRY
);

function defaultCreateApprovalDecisionId() {
  return `approval-decision-${Date.now()}`;
}

function defaultGetCurrentTime() {
  return new Date().toISOString();
}

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim() ?? null;
  return normalized ? normalized : null;
}

export function isApprovalDecisionDenialReason(
  value: string
): value is ApprovalDecisionDenialReason {
  return APPROVAL_DECISION_DENIAL_REASON_SET.has(value);
}

export async function recordApprovalDecision(
  input: RecordApprovalDecisionInput,
  dependencies: RecordApprovalDecisionDependencies
): Promise<ApprovalDecisionServiceResult> {
  const approvalRequest =
    await dependencies.approvalDecisionRepository.getApprovalRequestById(input.approvalRequestId);

  if (!approvalRequest) {
    return {
      recorded: false,
      approvalRequest: null,
      approvalDecision: null,
      previousStatus: null,
      resultingStatus: null,
      denialReason: "approval_request_not_found"
    };
  }

  if (!isApprovalOpenStatus(approvalRequest.status)) {
    return {
      recorded: false,
      approvalRequest,
      approvalDecision: null,
      previousStatus: null,
      resultingStatus: approvalRequest.status,
      denialReason: "approval_request_not_open"
    };
  }

  if (input.decisionOutcome !== "approved" && input.decisionOutcome !== "denied") {
    return {
      recorded: false,
      approvalRequest,
      approvalDecision: null,
      previousStatus: approvalRequest.status,
      resultingStatus: approvalRequest.status,
      denialReason: "unsupported_decision_outcome"
    };
  }

  const policy =
    getApprovalPolicyByKey(approvalRequest.policyKey) ?? null;

  if (
    policy &&
    !policy.allowSelfApproval &&
    approvalRequest.requestedByActorId === input.decidedByActorId
  ) {
    return {
      recorded: false,
      approvalRequest,
      approvalDecision: null,
      previousStatus: approvalRequest.status,
      resultingStatus: approvalRequest.status,
      denialReason: "self_approval_not_allowed"
    };
  }

  const priorDecisions =
    await dependencies.approvalDecisionRepository.listApprovalDecisions(approvalRequest.approvalRequestId);

  if (priorDecisions.some((decision) => decision.decidedByActorId === input.decidedByActorId)) {
    return {
      recorded: false,
      approvalRequest,
      approvalDecision: null,
      previousStatus: approvalRequest.status,
      resultingStatus: approvalRequest.status,
      denialReason: "duplicate_approver_decision"
    };
  }

  const requiredApproverCount = policy?.minimumApproverCount ?? 1;
  const currentApprovedDecisionCount = priorDecisions.filter(
    (decision) => decision.decisionOutcome === "approved"
  ).length;

  const resultingStatus = resolveApprovalStatusTransition({
    currentStatus: approvalRequest.status,
    decisionOutcome: input.decisionOutcome,
    currentApprovedDecisionCount,
    requiredApproverCount
  });

  const approvalDecision: ApprovalDecision = {
    approvalDecisionId:
      dependencies.createApprovalDecisionId?.() ?? defaultCreateApprovalDecisionId(),
    approvalRequestId: approvalRequest.approvalRequestId,
    decisionOutcome: input.decisionOutcome,
    resultingStatus,
    decidedByActorId: input.decidedByActorId,
    decidedAt: dependencies.getCurrentTime?.() ?? defaultGetCurrentTime(),
    note: normalizeNullableString(input.note),
    executionMode: approvalRequest.executionMode
  };

  const persistedDecision =
    await dependencies.approvalDecisionRepository.createApprovalDecision(approvalDecision);
  const updatedApprovalRequest =
    await dependencies.approvalDecisionRepository.updateApprovalRequestStatus(
      approvalRequest.approvalRequestId,
      resultingStatus
    );

  if ((policy?.requiresAudit ?? true) && dependencies.approvalAuditWriter) {
    await dependencies.approvalAuditWriter.writeApprovalAuditEvent({
      eventType: "approval_decision_recorded",
      approvalRequestId: approvalRequest.approvalRequestId,
      tenantId: approvalRequest.tenantId,
      approvalType: approvalRequest.approvalType,
      policyKey: approvalRequest.policyKey,
      actorId: input.decidedByActorId,
      occurredAt: persistedDecision.decidedAt,
      fromStatus: approvalRequest.status,
      toStatus: resultingStatus,
      targetResource: approvalRequest.targetResource,
      targetResourceId: approvalRequest.targetResourceId,
      requestedAction: approvalRequest.requestedAction,
      decisionOutcome: persistedDecision.decisionOutcome,
      note: persistedDecision.note,
      metadata: {
        requiredApproverCount,
        currentApprovedDecisionCount
      }
    });
  }

  return {
    recorded: true,
    approvalRequest: updatedApprovalRequest,
    approvalDecision: persistedDecision,
    previousStatus: approvalRequest.status,
    resultingStatus,
    denialReason: null
  };
}
