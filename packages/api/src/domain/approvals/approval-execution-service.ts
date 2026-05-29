import {
  getApprovalActionExecutor,
  type ApprovalExecutionResult,
  type ApprovalExecutionRouter
} from "./approval-execution.js";
import type { ApprovalAuditWriter } from "./approval-audit.js";
import type { ApprovalExecutionRepository } from "./approval-execution.repository.js";
import { getApprovalPolicyByKey } from "./approval-policy.registry.js";
import type { ApprovalRequest } from "./approval-request.js";

export const APPROVAL_EXECUTION_DENIAL_REASON_REGISTRY = [
  "approval_request_not_found",
  "approval_request_not_approved",
  "execution_handler_not_registered"
] as const;

export type ApprovalExecutionDenialReason =
  (typeof APPROVAL_EXECUTION_DENIAL_REASON_REGISTRY)[number];

export interface ExecuteApprovedActionInput {
  approvalRequestId: string;
  executedByActorId?: string | null;
}

export interface ExecuteApprovedActionDependencies {
  approvalExecutionRepository: ApprovalExecutionRepository;
  approvalExecutionRouter: ApprovalExecutionRouter;
  approvalAuditWriter?: ApprovalAuditWriter;
  getCurrentTime?: () => string;
}

export interface ApprovalExecutionServiceResult {
  executed: boolean;
  approvalRequest: ApprovalRequest | null;
  executionResult: ApprovalExecutionResult | null;
  denialReason: ApprovalExecutionDenialReason | null;
}

const APPROVAL_EXECUTION_DENIAL_REASON_SET = new Set<string>(
  APPROVAL_EXECUTION_DENIAL_REASON_REGISTRY
);

function defaultGetCurrentTime() {
  return new Date().toISOString();
}

function createRecordOnlyExecutionResult(
  approvalRequest: ApprovalRequest
): ApprovalExecutionResult {
  return {
    approvalType: approvalRequest.approvalType,
    executionMode: approvalRequest.executionMode,
    outcome: "no_action_required",
    executionCode: "record_only",
    message: "This approval records the decision without executing a downstream action."
  };
}

export function isApprovalExecutionDenialReason(
  value: string
): value is ApprovalExecutionDenialReason {
  return APPROVAL_EXECUTION_DENIAL_REASON_SET.has(value);
}

export async function executeApprovedAction(
  input: ExecuteApprovedActionInput,
  dependencies: ExecuteApprovedActionDependencies
): Promise<ApprovalExecutionServiceResult> {
  const approvalRequest =
    await dependencies.approvalExecutionRepository.getApprovalRequestById(input.approvalRequestId);

  if (!approvalRequest) {
    return {
      executed: false,
      approvalRequest: null,
      executionResult: null,
      denialReason: "approval_request_not_found"
    };
  }

  if (approvalRequest.status !== "approved") {
    return {
      executed: false,
      approvalRequest,
      executionResult: null,
      denialReason: "approval_request_not_approved"
    };
  }

  let executionResult: ApprovalExecutionResult;

  if (approvalRequest.executionMode === "record_only") {
    executionResult = createRecordOnlyExecutionResult(approvalRequest);
  } else {
    const executor = getApprovalActionExecutor(
      dependencies.approvalExecutionRouter,
      approvalRequest.approvalType
    );

    if (!executor) {
      return {
        executed: false,
        approvalRequest,
        executionResult: null,
        denialReason: "execution_handler_not_registered"
      };
    }

    executionResult = await executor.execute({
      approvalRequest
    });
  }

  const updatedApprovalRequest =
    await dependencies.approvalExecutionRepository.updateApprovalRequestStatus(
      approvalRequest.approvalRequestId,
      "executed"
    );

  const policy = getApprovalPolicyByKey(approvalRequest.policyKey);

  if ((policy?.requiresAudit ?? true) && dependencies.approvalAuditWriter) {
    await dependencies.approvalAuditWriter.writeApprovalAuditEvent({
      eventType: "approval_action_executed",
      approvalRequestId: approvalRequest.approvalRequestId,
      tenantId: approvalRequest.tenantId,
      approvalType: approvalRequest.approvalType,
      policyKey: approvalRequest.policyKey,
      actorId: input.executedByActorId ?? null,
      occurredAt: dependencies.getCurrentTime?.() ?? defaultGetCurrentTime(),
      fromStatus: approvalRequest.status,
      toStatus: "executed",
      targetResource: approvalRequest.targetResource,
      targetResourceId: approvalRequest.targetResourceId,
      requestedAction: approvalRequest.requestedAction,
      executionOutcome: executionResult.outcome,
      executionCode: executionResult.executionCode,
      metadata: executionResult.metadata
    });
  }

  return {
    executed: true,
    approvalRequest: updatedApprovalRequest,
    executionResult,
    denialReason: null
  };
}
