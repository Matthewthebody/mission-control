import {
  isGoNoGoState,
  type GoNoGoState
} from "../readiness/go-no-go-state.js";
import {
  isReadinessAlertSeverity,
  isReadinessEscalationRuleCode,
  type ReadinessAlertCandidate,
  type ReadinessAlertSeverity,
  type ReadinessEscalationRuleCode
} from "../readiness/readiness-alert-candidate.js";
import {
  isReadinessState,
  type ReadinessState
} from "../readiness/readiness-state.js";
import type { ShootReadinessDetailDto } from "../readiness/shoot-readiness-dto.js";
import type { ApprovalActionExecutor, ApprovalExecutionResult } from "./approval-execution.js";
import type { ApprovalRequest } from "./approval-request.js";
import type { SubmitApprovalRequestInput } from "./approval-submission-service.js";

export interface ReadinessApprovalSubmissionContext {
  tenantId: string;
  requestedByActorId: string;
  shootId: string;
  readinessDetail: ShootReadinessDetailDto;
  reason?: string | null;
  summary?: string;
  alertCandidate?: ReadinessAlertCandidate | null;
  metadata?: Record<string, unknown>;
}

export interface ReadinessApprovalExecutionContext {
  approvalRequest: ApprovalRequest;
  shootId: string;
  readinessState: ReadinessState | null;
  goNoGoState: GoNoGoState | null;
  blockerCount: number | null;
  missingItemCount: number | null;
  alertRuleCode: ReadinessEscalationRuleCode | null;
  alertSeverity: ReadinessAlertSeverity | null;
}

export interface ReadinessApprovalExecutionHookResult {
  executionCode: string;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReadinessApprovalExecutionHook {
  executeReadinessOverride(
    context: ReadinessApprovalExecutionContext
  ): Promise<ReadinessApprovalExecutionHookResult> | ReadinessApprovalExecutionHookResult;
  executeGoNoGoOverride(
    context: ReadinessApprovalExecutionContext
  ): Promise<ReadinessApprovalExecutionHookResult> | ReadinessApprovalExecutionHookResult;
}

function buildReadinessSummary(
  overrideLabel: "readiness override" | "go/no-go override",
  context: ReadinessApprovalSubmissionContext
) {
  return `Approve ${overrideLabel} for Shoot ${context.shootId}.`;
}

function createReadinessApprovalMetadata(context: ReadinessApprovalSubmissionContext) {
  return {
    shootId: context.shootId,
    readinessState: context.readinessDetail.summary.readinessState,
    goNoGoState: context.readinessDetail.summary.goNoGoState,
    blockerCount: context.readinessDetail.summary.blockerCount,
    missingItemCount: context.readinessDetail.summary.missingItemCount,
    alertRuleCode: context.alertCandidate?.ruleCode ?? null,
    alertSeverity: context.alertCandidate?.severity ?? null,
    ...(context.metadata ?? {})
  };
}

function extractReadinessExecutionContext(
  approvalRequest: ApprovalRequest
): ReadinessApprovalExecutionContext {
  const metadata = approvalRequest.metadata ?? {};
  const readinessState =
    typeof metadata.readinessState === "string" && isReadinessState(metadata.readinessState)
      ? metadata.readinessState
      : null;
  const goNoGoState =
    typeof metadata.goNoGoState === "string" && isGoNoGoState(metadata.goNoGoState)
      ? metadata.goNoGoState
      : null;
  const alertRuleCode =
    typeof metadata.alertRuleCode === "string" &&
    isReadinessEscalationRuleCode(metadata.alertRuleCode)
      ? metadata.alertRuleCode
      : null;
  const alertSeverity =
    typeof metadata.alertSeverity === "string" && isReadinessAlertSeverity(metadata.alertSeverity)
      ? metadata.alertSeverity
      : null;

  return {
    approvalRequest,
    shootId: approvalRequest.targetResourceId,
    readinessState,
    goNoGoState,
    blockerCount: typeof metadata.blockerCount === "number" ? metadata.blockerCount : null,
    missingItemCount:
      typeof metadata.missingItemCount === "number" ? metadata.missingItemCount : null,
    alertRuleCode,
    alertSeverity
  };
}

export function createReadinessOverrideApprovalSubmissionInput(
  context: ReadinessApprovalSubmissionContext
): SubmitApprovalRequestInput {
  return {
    approvalType: "readiness_override",
    tenantId: context.tenantId,
    requestedByActorId: context.requestedByActorId,
    targetResourceId: context.shootId,
    summary: context.summary ?? buildReadinessSummary("readiness override", context),
    reason: context.reason,
    metadata: createReadinessApprovalMetadata(context)
  };
}

export function createGoNoGoOverrideApprovalSubmissionInput(
  context: ReadinessApprovalSubmissionContext
): SubmitApprovalRequestInput {
  return {
    approvalType: "go_no_go_override",
    tenantId: context.tenantId,
    requestedByActorId: context.requestedByActorId,
    targetResourceId: context.shootId,
    summary: context.summary ?? buildReadinessSummary("go/no-go override", context),
    reason: context.reason,
    metadata: createReadinessApprovalMetadata(context)
  };
}

export function createReadinessApprovalActionExecutors(
  hook: ReadinessApprovalExecutionHook
): ApprovalActionExecutor[] {
  return [
    {
      approvalType: "readiness_override",
      async execute({ approvalRequest }): Promise<ApprovalExecutionResult> {
        const context = extractReadinessExecutionContext(approvalRequest);
        const result = await hook.executeReadinessOverride(context);

        return {
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: result.executionCode,
          message: result.message,
          metadata: {
            shootId: context.shootId,
            readinessState: context.readinessState,
            goNoGoState: context.goNoGoState,
            blockerCount: context.blockerCount,
            missingItemCount: context.missingItemCount,
            alertRuleCode: context.alertRuleCode,
            alertSeverity: context.alertSeverity,
            ...(result.metadata ?? {})
          }
        };
      }
    },
    {
      approvalType: "go_no_go_override",
      async execute({ approvalRequest }): Promise<ApprovalExecutionResult> {
        const context = extractReadinessExecutionContext(approvalRequest);
        const result = await hook.executeGoNoGoOverride(context);

        return {
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: result.executionCode,
          message: result.message,
          metadata: {
            shootId: context.shootId,
            readinessState: context.readinessState,
            goNoGoState: context.goNoGoState,
            blockerCount: context.blockerCount,
            missingItemCount: context.missingItemCount,
            alertRuleCode: context.alertRuleCode,
            alertSeverity: context.alertSeverity,
            ...(result.metadata ?? {})
          }
        };
      }
    }
  ];
}
