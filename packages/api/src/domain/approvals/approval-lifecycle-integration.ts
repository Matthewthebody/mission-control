import type { ShootLifecycleApprovalContext } from "../lifecycle/shoot-lifecycle-approval.js";
import { isShootStatus, type ShootStatus } from "../lifecycle/shoot-status.js";
import type { ApprovalActionExecutor, ApprovalExecutionResult } from "./approval-execution.js";
import type { ApprovalRequest } from "./approval-request.js";
import type { SubmitApprovalRequestInput } from "./approval-submission-service.js";

export interface LifecycleApprovalSubmissionContext {
  tenantId: string;
  requestedByActorId: string;
  shootId: string;
  transitionKey: string;
  currentStatus: ShootStatus;
  targetStatus: ShootStatus;
  reason?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface LifecycleApprovalExecutionContext {
  approvalRequest: ApprovalRequest;
  shootId: string;
  transitionKey: string | null;
  currentStatus: ShootStatus | null;
  targetStatus: ShootStatus | null;
}

export interface LifecycleApprovalExecutionHookResult {
  executionCode: string;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface LifecycleApprovalExecutionHook {
  executeRollbackTransition(
    context: LifecycleApprovalExecutionContext
  ): Promise<LifecycleApprovalExecutionHookResult> | LifecycleApprovalExecutionHookResult;
  executeReopenTransition(
    context: LifecycleApprovalExecutionContext
  ): Promise<LifecycleApprovalExecutionHookResult> | LifecycleApprovalExecutionHookResult;
}

function buildLifecycleSummary(
  transitionLabel: "rollback" | "reopen",
  context: LifecycleApprovalSubmissionContext
) {
  return `Approve lifecycle ${transitionLabel} from ${context.currentStatus} to ${context.targetStatus}.`;
}

function extractLifecycleExecutionContext(
  approvalRequest: ApprovalRequest
): LifecycleApprovalExecutionContext {
  const metadata = approvalRequest.metadata ?? {};
  const currentStatus =
    typeof metadata.currentStatus === "string" && isShootStatus(metadata.currentStatus)
      ? metadata.currentStatus
      : null;
  const targetStatus =
    typeof metadata.targetStatus === "string" && isShootStatus(metadata.targetStatus)
      ? metadata.targetStatus
      : null;
  const transitionKey =
    typeof metadata.transitionKey === "string" ? metadata.transitionKey : null;

  return {
    approvalRequest,
    shootId: approvalRequest.targetResourceId,
    transitionKey,
    currentStatus,
    targetStatus
  };
}

export function createLifecycleRollbackApprovalSubmissionInput(
  context: LifecycleApprovalSubmissionContext
): SubmitApprovalRequestInput {
  return {
    approvalType: "lifecycle_rollback_transition",
    tenantId: context.tenantId,
    requestedByActorId: context.requestedByActorId,
    targetResourceId: context.shootId,
    summary: context.summary ?? buildLifecycleSummary("rollback", context),
    reason: context.reason,
    metadata: {
      transitionKey: context.transitionKey,
      currentStatus: context.currentStatus,
      targetStatus: context.targetStatus,
      ...(context.metadata ?? {})
    }
  };
}

export function createLifecycleReopenApprovalSubmissionInput(
  context: LifecycleApprovalSubmissionContext
): SubmitApprovalRequestInput {
  return {
    approvalType: "lifecycle_reopen_transition",
    tenantId: context.tenantId,
    requestedByActorId: context.requestedByActorId,
    targetResourceId: context.shootId,
    summary: context.summary ?? buildLifecycleSummary("reopen", context),
    reason: context.reason,
    metadata: {
      transitionKey: context.transitionKey,
      currentStatus: context.currentStatus,
      targetStatus: context.targetStatus,
      ...(context.metadata ?? {})
    }
  };
}

export function createShootLifecycleApprovalContextFromApprovalRequest(
  approvalRequest: ApprovalRequest | null
): ShootLifecycleApprovalContext {
  const lifecycleApproval =
    approvalRequest?.approvalType === "lifecycle_rollback_transition" ||
    approvalRequest?.approvalType === "lifecycle_reopen_transition";
  const approvalSatisfied =
    lifecycleApproval &&
    (approvalRequest.status === "approved" || approvalRequest.status === "executed");

  return {
    approvalSatisfied,
    approvalRequestId: lifecycleApproval ? approvalRequest?.approvalRequestId ?? null : null
  };
}

export function createLifecycleApprovalActionExecutors(
  hook: LifecycleApprovalExecutionHook
): ApprovalActionExecutor[] {
  return [
    {
      approvalType: "lifecycle_rollback_transition",
      async execute({ approvalRequest }): Promise<ApprovalExecutionResult> {
        const context = extractLifecycleExecutionContext(approvalRequest);
        const result = await hook.executeRollbackTransition(context);

        return {
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: result.executionCode,
          message: result.message,
          metadata: {
            shootId: context.shootId,
            transitionKey: context.transitionKey,
            currentStatus: context.currentStatus,
            targetStatus: context.targetStatus,
            ...(result.metadata ?? {})
          }
        };
      }
    },
    {
      approvalType: "lifecycle_reopen_transition",
      async execute({ approvalRequest }): Promise<ApprovalExecutionResult> {
        const context = extractLifecycleExecutionContext(approvalRequest);
        const result = await hook.executeReopenTransition(context);

        return {
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: result.executionCode,
          message: result.message,
          metadata: {
            shootId: context.shootId,
            transitionKey: context.transitionKey,
            currentStatus: context.currentStatus,
            targetStatus: context.targetStatus,
            ...(result.metadata ?? {})
          }
        };
      }
    }
  ];
}
