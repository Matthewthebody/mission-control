import type { ApprovalExecutionMode } from "./approval-execution-mode.js";
import type { ApprovalRequest } from "./approval-request.js";
import type { ApprovalType } from "./approval-type.js";

export const APPROVAL_EXECUTION_OUTCOME_REGISTRY = ["executed", "no_action_required"] as const;

export type ApprovalExecutionOutcome = (typeof APPROVAL_EXECUTION_OUTCOME_REGISTRY)[number];

export interface ApprovalExecutionContext {
  approvalRequest: ApprovalRequest;
}

export interface ApprovalExecutionResult {
  approvalType: ApprovalType;
  executionMode: ApprovalExecutionMode;
  outcome: ApprovalExecutionOutcome;
  executionCode: string;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface ApprovalActionExecutor {
  approvalType: ApprovalType;
  execute(
    context: ApprovalExecutionContext
  ): Promise<ApprovalExecutionResult> | ApprovalExecutionResult;
}

export type ApprovalExecutionRouter = Readonly<Partial<Record<ApprovalType, ApprovalActionExecutor>>>;

const APPROVAL_EXECUTION_OUTCOME_SET = new Set<string>(APPROVAL_EXECUTION_OUTCOME_REGISTRY);

export function isApprovalExecutionOutcome(value: string): value is ApprovalExecutionOutcome {
  return APPROVAL_EXECUTION_OUTCOME_SET.has(value);
}

export function createApprovalExecutionRouter(
  executors: ReadonlyArray<ApprovalActionExecutor>
): ApprovalExecutionRouter {
  return executors.reduce<Partial<Record<ApprovalType, ApprovalActionExecutor>>>(
    (router, executor) => {
      router[executor.approvalType] = executor;
      return router;
    },
    {}
  );
}

export function getApprovalActionExecutor(
  router: ApprovalExecutionRouter,
  approvalType: ApprovalType
): ApprovalActionExecutor | null {
  return router[approvalType] ?? null;
}
