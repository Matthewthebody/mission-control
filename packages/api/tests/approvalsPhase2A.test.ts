import { describe, expect, it } from "vitest";
import {
  APPROVAL_DECISION_DENIAL_REASON_REGISTRY,
  isApprovalDecisionDenialReason,
  isApprovalOpenStatus,
  recordApprovalDecision,
  resolveApprovalStatusTransition,
  type ApprovalDecision,
  type ApprovalDecisionRepository,
  type ApprovalRequest
} from "../src/domain/approvals/index.js";

class InMemoryApprovalDecisionRepository implements ApprovalDecisionRepository {
  public readonly requests = new Map<string, ApprovalRequest>();
  public readonly decisions: ApprovalDecision[] = [];

  constructor(seedRequests: ApprovalRequest[], seedDecisions: ApprovalDecision[] = []) {
    for (const request of seedRequests) {
      this.requests.set(request.approvalRequestId, { ...request });
    }

    this.decisions.push(...seedDecisions.map((decision) => ({ ...decision })));
  }

  async getApprovalRequestById(approvalRequestId: string): Promise<ApprovalRequest | null> {
    return this.requests.get(approvalRequestId) ?? null;
  }

  async listApprovalDecisions(approvalRequestId: string): Promise<ApprovalDecision[]> {
    return this.decisions.filter((decision) => decision.approvalRequestId === approvalRequestId);
  }

  async createApprovalDecision(decision: ApprovalDecision): Promise<ApprovalDecision> {
    this.decisions.push(decision);
    return decision;
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

function createApprovalRequest(
  overrides: Partial<ApprovalRequest> = {}
): ApprovalRequest {
  return {
    approvalRequestId: "approval-request-1",
    approvalType: "staffing_conflict_override",
    status: "submitted",
    executionMode: "manual_after_approval",
    policyKey: "staffing-conflict-override",
    tenantId: "tenant-1",
    requestedByActorId: "requester-1",
    requestedAt: "2026-03-28T17:00:00.000Z",
    targetResource: "staff_assignment",
    targetResourceId: "assignment-1",
    requestedAction: "override",
    reason: "Need to override the staffing soft conflict.",
    summary: "Override the staffing conflict for this assignment.",
    metadata: {
      assignmentId: "assignment-1"
    },
    ...overrides
  };
}

describe("approval workflow domain phase 2A", () => {
  it("exposes deterministic decision denial registries and open-status helpers", () => {
    expect(new Set(APPROVAL_DECISION_DENIAL_REASON_REGISTRY).size).toBe(
      APPROVAL_DECISION_DENIAL_REASON_REGISTRY.length
    );
    expect(isApprovalDecisionDenialReason("approval_request_not_open")).toBe(true);
    expect(isApprovalDecisionDenialReason("approval_missing_note")).toBe(false);
    expect(isApprovalOpenStatus("submitted")).toBe(true);
    expect(isApprovalOpenStatus("under_review")).toBe(true);
    expect(isApprovalOpenStatus("approved")).toBe(false);
  });

  it("approves a single-approval request and transitions it to approved", async () => {
    const repository = new InMemoryApprovalDecisionRepository([createApprovalRequest()]);

    const result = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-1",
        decisionOutcome: "approved",
        decidedByActorId: "approver-1",
        note: "Approved after reviewing the staffing override."
      },
      {
        approvalDecisionRepository: repository,
        createApprovalDecisionId: () => "decision-1",
        getCurrentTime: () => "2026-03-28T17:15:00.000Z"
      }
    );

    expect(result.recorded).toBe(true);
    expect(result.previousStatus).toBe("submitted");
    expect(result.resultingStatus).toBe("approved");
    expect(result.approvalDecision?.decisionOutcome).toBe("approved");
    expect(result.approvalDecision?.resultingStatus).toBe("approved");
    expect(repository.requests.get("approval-request-1")?.status).toBe("approved");
  });

  it("moves a dual-approval request through under_review before final approval", async () => {
    const dualApprovalRequest = createApprovalRequest({
      approvalRequestId: "approval-request-2",
      approvalType: "lifecycle_reopen_transition",
      policyKey: "lifecycle-reopen-transition",
      executionMode: "automatic_on_approval",
      targetResource: "shoot_lifecycle",
      targetResourceId: "shoot-1",
      requestedAction: "transition",
      summary: "Reopen the shoot lifecycle."
    });

    const repository = new InMemoryApprovalDecisionRepository([dualApprovalRequest]);

    const firstDecision = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-2",
        decisionOutcome: "approved",
        decidedByActorId: "approver-1",
        note: "First approver cleared the reopen."
      },
      {
        approvalDecisionRepository: repository,
        createApprovalDecisionId: () => "decision-2a",
        getCurrentTime: () => "2026-03-28T17:20:00.000Z"
      }
    );

    expect(firstDecision.recorded).toBe(true);
    expect(firstDecision.resultingStatus).toBe("under_review");
    expect(repository.requests.get("approval-request-2")?.status).toBe("under_review");

    const secondDecision = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-2",
        decisionOutcome: "approved",
        decidedByActorId: "approver-2",
        note: "Second approver finalized the reopen."
      },
      {
        approvalDecisionRepository: repository,
        createApprovalDecisionId: () => "decision-2b",
        getCurrentTime: () => "2026-03-28T17:25:00.000Z"
      }
    );

    expect(secondDecision.recorded).toBe(true);
    expect(secondDecision.previousStatus).toBe("under_review");
    expect(secondDecision.resultingStatus).toBe("approved");
    expect(repository.requests.get("approval-request-2")?.status).toBe("approved");
  });

  it("denies an open request and transitions it to denied", async () => {
    const repository = new InMemoryApprovalDecisionRepository([createApprovalRequest()]);

    const result = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-1",
        decisionOutcome: "denied",
        decidedByActorId: "approver-1",
        note: "Conflict override denied."
      },
      {
        approvalDecisionRepository: repository,
        createApprovalDecisionId: () => "decision-3",
        getCurrentTime: () => "2026-03-28T17:30:00.000Z"
      }
    );

    expect(result.recorded).toBe(true);
    expect(result.resultingStatus).toBe("denied");
    expect(result.approvalDecision?.resultingStatus).toBe("denied");
    expect(repository.requests.get("approval-request-1")?.status).toBe("denied");
  });

  it("blocks self-approval and duplicate approver decisions under policy control", async () => {
    const repository = new InMemoryApprovalDecisionRepository(
      [
        createApprovalRequest({
          approvalType: "lifecycle_reopen_transition",
          status: "under_review",
          executionMode: "automatic_on_approval",
          policyKey: "lifecycle-reopen-transition",
          targetResource: "shoot_lifecycle",
          targetResourceId: "shoot-1",
          requestedAction: "transition",
          summary: "Reopen the shoot lifecycle."
        })
      ],
      [
        {
          approvalDecisionId: "seed-decision",
          approvalRequestId: "approval-request-1",
          decisionOutcome: "approved",
          resultingStatus: "under_review",
          decidedByActorId: "approver-1",
          decidedAt: "2026-03-28T17:05:00.000Z",
          note: "Already approved once.",
          executionMode: "manual_after_approval"
        }
      ]
    );

    const selfApprovalResult = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-1",
        decisionOutcome: "approved",
        decidedByActorId: "requester-1",
        note: "Trying to approve my own request."
      },
      {
        approvalDecisionRepository: repository,
        createApprovalDecisionId: () => "decision-4a",
        getCurrentTime: () => "2026-03-28T17:35:00.000Z"
      }
    );

    expect(selfApprovalResult.recorded).toBe(false);
    expect(selfApprovalResult.denialReason).toBe("self_approval_not_allowed");

    const duplicateApproverResult = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-1",
        decisionOutcome: "approved",
        decidedByActorId: "approver-1",
        note: "Trying to approve twice."
      },
      {
        approvalDecisionRepository: repository,
        createApprovalDecisionId: () => "decision-4b",
        getCurrentTime: () => "2026-03-28T17:40:00.000Z"
      }
    );

    expect(duplicateApproverResult.recorded).toBe(false);
    expect(duplicateApproverResult.denialReason).toBe("duplicate_approver_decision");
  });

  it("resolves approve/deny status transitions deterministically", () => {
    expect(
      resolveApprovalStatusTransition({
        currentStatus: "submitted",
        decisionOutcome: "approved",
        currentApprovedDecisionCount: 0,
        requiredApproverCount: 1
      })
    ).toBe("approved");

    expect(
      resolveApprovalStatusTransition({
        currentStatus: "submitted",
        decisionOutcome: "approved",
        currentApprovedDecisionCount: 0,
        requiredApproverCount: 2
      })
    ).toBe("under_review");

    expect(
      resolveApprovalStatusTransition({
        currentStatus: "under_review",
        decisionOutcome: "denied",
        currentApprovedDecisionCount: 1,
        requiredApproverCount: 2
      })
    ).toBe("denied");
  });
});
