import { describe, expect, it } from "vitest";
import {
  APPROVAL_SUBMISSION_DENIAL_REASON_REGISTRY,
  isApprovalSubmissionDenialReason,
  submitApprovalRequest,
  type ApprovalRequest,
  type ApprovalRequestRepository
} from "../src/domain/approvals/index.js";

class InMemoryApprovalRequestRepository implements ApprovalRequestRepository {
  public readonly createdRequests: ApprovalRequest[] = [];

  async createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    this.createdRequests.push(request);
    return request;
  }
}

describe("approval workflow domain phase 1C", () => {
  it("exposes deterministic submission denial registries and guards", () => {
    expect(new Set(APPROVAL_SUBMISSION_DENIAL_REASON_REGISTRY).size).toBe(
      APPROVAL_SUBMISSION_DENIAL_REASON_REGISTRY.length
    );
    expect(isApprovalSubmissionDenialReason("reason_required")).toBe(true);
    expect(isApprovalSubmissionDenialReason("duplicate_open_request")).toBe(false);
  });

  it("submits an approval request using policy-derived behavior and persists through the repository", async () => {
    const repository = new InMemoryApprovalRequestRepository();

    const result = await submitApprovalRequest(
      {
        approvalType: "lifecycle_reopen_transition",
        tenantId: "tenant-1",
        requestedByActorId: "actor-1",
        targetResourceId: "shoot-1",
        summary: "  Reopen this closed shoot to delivered.  ",
        reason: "  Client requested a reopened delivery pass.  ",
        metadata: {
          fromStatus: "closed",
          toStatus: "delivered"
        }
      },
      {
        approvalRequestRepository: repository,
        createApprovalRequestId: () => "approval-request-1",
        getCurrentTime: () => "2026-03-28T16:15:00.000Z"
      }
    );

    expect(result.submitted).toBe(true);
    expect(result.denialReason).toBeNull();
    expect(result.policy.policyKey).toBe("lifecycle-reopen-transition");
    expect(result.policy.requiresSecondApproval).toBe(true);
    expect(result.approvalRequest).toEqual({
      approvalRequestId: "approval-request-1",
      approvalType: "lifecycle_reopen_transition",
      status: "submitted",
      executionMode: "automatic_on_approval",
      policyKey: "lifecycle-reopen-transition",
      tenantId: "tenant-1",
      requestedByActorId: "actor-1",
      requestedAt: "2026-03-28T16:15:00.000Z",
      targetResource: "shoot_lifecycle",
      targetResourceId: "shoot-1",
      requestedAction: "transition",
      reason: "Client requested a reopened delivery pass.",
      summary: "Reopen this closed shoot to delivered.",
      metadata: {
        fromStatus: "closed",
        toStatus: "delivered"
      }
    });
    expect(repository.createdRequests).toEqual([result.approvalRequest]);
  });

  it("denies submission when the approval policy requires a reason and none is provided", async () => {
    const repository = new InMemoryApprovalRequestRepository();

    const result = await submitApprovalRequest(
      {
        approvalType: "staffing_conflict_override",
        tenantId: "tenant-1",
        requestedByActorId: "actor-1",
        targetResourceId: "assignment-1",
        summary: "Force the staffing assignment despite the soft conflict.",
        reason: "   "
      },
      {
        approvalRequestRepository: repository,
        createApprovalRequestId: () => "approval-request-2",
        getCurrentTime: () => "2026-03-28T16:30:00.000Z"
      }
    );

    expect(result.submitted).toBe(false);
    expect(result.denialReason).toBe("reason_required");
    expect(result.approvalRequest).toBeNull();
    expect(repository.createdRequests).toEqual([]);
  });
});
