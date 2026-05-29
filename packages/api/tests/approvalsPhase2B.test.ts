import { describe, expect, it } from "vitest";
import {
  APPROVAL_EXECUTION_DENIAL_REASON_REGISTRY,
  APPROVAL_EXECUTION_OUTCOME_REGISTRY,
  createApprovalExecutionRouter,
  executeApprovedAction,
  getApprovalActionExecutor,
  isApprovalExecutionDenialReason,
  isApprovalExecutionOutcome,
  type ApprovalActionExecutor,
  type ApprovalExecutionRepository,
  type ApprovalRequest
} from "../src/domain/approvals/index.js";

class InMemoryApprovalExecutionRepository implements ApprovalExecutionRepository {
  public readonly requests = new Map<string, ApprovalRequest>();

  constructor(seedRequests: ApprovalRequest[]) {
    for (const request of seedRequests) {
      this.requests.set(request.approvalRequestId, { ...request });
    }
  }

  async getApprovalRequestById(approvalRequestId: string): Promise<ApprovalRequest | null> {
    return this.requests.get(approvalRequestId) ?? null;
  }

  async updateApprovalRequestStatus(
    approvalRequestId: string,
    status: ApprovalRequest["status"]
  ): Promise<ApprovalRequest> {
    const request = this.requests.get(approvalRequestId);

    if (!request) {
      throw new Error("Approval request not found.");
    }

    const updatedRequest = {
      ...request,
      status
    };

    this.requests.set(approvalRequestId, updatedRequest);
    return updatedRequest;
  }
}

function createApprovedRequest(
  overrides: Partial<ApprovalRequest> = {}
): ApprovalRequest {
  return {
    approvalRequestId: "approval-request-1",
    approvalType: "lifecycle_reopen_transition",
    status: "approved",
    executionMode: "automatic_on_approval",
    policyKey: "lifecycle-reopen-transition",
    tenantId: "tenant-1",
    requestedByActorId: "requester-1",
    requestedAt: "2026-03-28T18:00:00.000Z",
    targetResource: "shoot_lifecycle",
    targetResourceId: "shoot-1",
    requestedAction: "transition",
    reason: "Need to reopen after delivery changes.",
    summary: "Reopen the shoot lifecycle.",
    metadata: {
      fromStatus: "closed",
      toStatus: "delivered"
    },
    ...overrides
  };
}

describe("approval workflow domain phase 2B", () => {
  it("exposes deterministic execution registries, guards, and routing helpers", () => {
    expect(new Set(APPROVAL_EXECUTION_DENIAL_REASON_REGISTRY).size).toBe(
      APPROVAL_EXECUTION_DENIAL_REASON_REGISTRY.length
    );
    expect(new Set(APPROVAL_EXECUTION_OUTCOME_REGISTRY).size).toBe(
      APPROVAL_EXECUTION_OUTCOME_REGISTRY.length
    );
    expect(isApprovalExecutionDenialReason("approval_request_not_approved")).toBe(true);
    expect(isApprovalExecutionDenialReason("execution_failed")).toBe(false);
    expect(isApprovalExecutionOutcome("executed")).toBe(true);
    expect(isApprovalExecutionOutcome("skipped")).toBe(false);

    const executors: ApprovalActionExecutor[] = [
      {
        approvalType: "lifecycle_reopen_transition",
        execute: () => ({
          approvalType: "lifecycle_reopen_transition",
          executionMode: "automatic_on_approval",
          outcome: "executed",
          executionCode: "lifecycle_reopen_executed",
          message: "Lifecycle reopen executed."
        })
      }
    ];

    const router = createApprovalExecutionRouter(executors);

    expect(getApprovalActionExecutor(router, "lifecycle_reopen_transition")?.approvalType).toBe(
      "lifecycle_reopen_transition"
    );
    expect(getApprovalActionExecutor(router, "readiness_override")).toBeNull();
  });

  it("routes an approved automatic action to the correct executor and marks it executed", async () => {
    const repository = new InMemoryApprovalExecutionRepository([createApprovedRequest()]);
    const router = createApprovalExecutionRouter([
      {
        approvalType: "lifecycle_reopen_transition",
        execute: ({ approvalRequest }) => ({
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: "lifecycle_reopen_executed",
          message: "Lifecycle reopen transition executed."
        })
      }
    ]);

    const result = await executeApprovedAction(
      {
        approvalRequestId: "approval-request-1"
      },
      {
        approvalExecutionRepository: repository,
        approvalExecutionRouter: router
      }
    );

    expect(result.executed).toBe(true);
    expect(result.denialReason).toBeNull();
    expect(result.executionResult?.executionCode).toBe("lifecycle_reopen_executed");
    expect(result.executionResult?.outcome).toBe("executed");
    expect(repository.requests.get("approval-request-1")?.status).toBe("executed");
  });

  it("executes manual-after-approval requests when explicitly invoked", async () => {
    const repository = new InMemoryApprovalExecutionRepository([
      createApprovedRequest({
        approvalRequestId: "approval-request-2",
        approvalType: "staffing_publication_override",
        executionMode: "manual_after_approval",
        policyKey: "staffing-publication-override",
        targetResource: "staffing_board",
        targetResourceId: "staffing-board-1",
        requestedAction: "publish",
        summary: "Publish staffing with override conditions."
      })
    ]);
    const router = createApprovalExecutionRouter([
      {
        approvalType: "staffing_publication_override",
        execute: ({ approvalRequest }) => ({
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: "staffing_publication_override_executed",
          message: "Staffing publication override executed."
        })
      }
    ]);

    const result = await executeApprovedAction(
      {
        approvalRequestId: "approval-request-2"
      },
      {
        approvalExecutionRepository: repository,
        approvalExecutionRouter: router
      }
    );

    expect(result.executed).toBe(true);
    expect(result.executionResult?.executionCode).toBe(
      "staffing_publication_override_executed"
    );
    expect(repository.requests.get("approval-request-2")?.status).toBe("executed");
  });

  it("marks record-only approvals executed without requiring a routed handler", async () => {
    const repository = new InMemoryApprovalExecutionRepository([
      createApprovedRequest({
        approvalRequestId: "approval-request-3",
        approvalType: "readiness_override",
        executionMode: "record_only",
        policyKey: "readiness-override",
        targetResource: "readiness_summary",
        targetResourceId: "shoot-1",
        requestedAction: "override",
        summary: "Record a readiness override decision."
      })
    ]);

    const result = await executeApprovedAction(
      {
        approvalRequestId: "approval-request-3"
      },
      {
        approvalExecutionRepository: repository,
        approvalExecutionRouter: {}
      }
    );

    expect(result.executed).toBe(true);
    expect(result.executionResult?.outcome).toBe("no_action_required");
    expect(result.executionResult?.executionCode).toBe("record_only");
    expect(repository.requests.get("approval-request-3")?.status).toBe("executed");
  });

  it("denies execution when the request is not approved or no handler is registered", async () => {
    const notApprovedRepository = new InMemoryApprovalExecutionRepository([
      createApprovedRequest({
        approvalRequestId: "approval-request-4",
        status: "under_review"
      })
    ]);

    const notApprovedResult = await executeApprovedAction(
      {
        approvalRequestId: "approval-request-4"
      },
      {
        approvalExecutionRepository: notApprovedRepository,
        approvalExecutionRouter: {}
      }
    );

    expect(notApprovedResult.executed).toBe(false);
    expect(notApprovedResult.denialReason).toBe("approval_request_not_approved");

    const missingHandlerRepository = new InMemoryApprovalExecutionRepository([
      createApprovedRequest({
        approvalRequestId: "approval-request-5",
        approvalType: "go_no_go_override",
        executionMode: "manual_after_approval",
        policyKey: "go-no-go-override",
        targetResource: "readiness_summary",
        targetResourceId: "shoot-2",
        requestedAction: "override",
        summary: "Execute a go/no-go override."
      })
    ]);

    const missingHandlerResult = await executeApprovedAction(
      {
        approvalRequestId: "approval-request-5"
      },
      {
        approvalExecutionRepository: missingHandlerRepository,
        approvalExecutionRouter: {}
      }
    );

    expect(missingHandlerResult.executed).toBe(false);
    expect(missingHandlerResult.denialReason).toBe("execution_handler_not_registered");
    expect(missingHandlerRepository.requests.get("approval-request-5")?.status).toBe("approved");
  });
});
