import { describe, expect, it } from "vitest";
import {
  APPROVAL_AUDIT_EVENT_TYPE_REGISTRY,
  createApprovalExecutionRouter,
  executeApprovedAction,
  isApprovalAuditEventType,
  recordApprovalDecision,
  submitApprovalRequest,
  type ApprovalActionExecutor,
  type ApprovalAuditEvent,
  type ApprovalAuditWriter,
  type ApprovalDecision,
  type ApprovalDecisionRepository,
  type ApprovalExecutionRepository,
  type ApprovalRequest,
  type ApprovalRequestRepository
} from "../src/domain/approvals/index.js";

class InMemoryApprovalAuditWriter implements ApprovalAuditWriter {
  public readonly events: ApprovalAuditEvent[] = [];

  async writeApprovalAuditEvent(event: ApprovalAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

class InMemoryApprovalRequestRepository implements ApprovalRequestRepository {
  public readonly createdRequests: ApprovalRequest[] = [];

  async createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    this.createdRequests.push(request);
    return request;
  }
}

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

function createApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalRequestId: "approval-request-1",
    approvalType: "lifecycle_reopen_transition",
    status: "approved",
    executionMode: "automatic_on_approval",
    policyKey: "lifecycle-reopen-transition",
    tenantId: "tenant-1",
    requestedByActorId: "requester-1",
    requestedAt: "2026-03-28T18:30:00.000Z",
    targetResource: "shoot_lifecycle",
    targetResourceId: "shoot-1",
    requestedAction: "transition",
    reason: "Need to reopen the lifecycle.",
    summary: "Reopen the shoot lifecycle.",
    metadata: {
      fromStatus: "closed",
      toStatus: "delivered"
    },
    ...overrides
  };
}

describe("approval workflow domain phase 3A audit integration", () => {
  it("exposes deterministic approval audit event registries and guards", () => {
    expect(new Set(APPROVAL_AUDIT_EVENT_TYPE_REGISTRY).size).toBe(
      APPROVAL_AUDIT_EVENT_TYPE_REGISTRY.length
    );
    expect(isApprovalAuditEventType("approval_request_submitted")).toBe(true);
    expect(isApprovalAuditEventType("approval_execution_failed")).toBe(false);
  });

  it("writes an audit event when an approval request is submitted", async () => {
    const repository = new InMemoryApprovalRequestRepository();
    const auditWriter = new InMemoryApprovalAuditWriter();

    const result = await submitApprovalRequest(
      {
        approvalType: "staffing_conflict_override",
        tenantId: "tenant-1",
        requestedByActorId: "requester-1",
        targetResourceId: "assignment-1",
        summary: "Override the staffing conflict.",
        reason: "Leadership requested the override.",
        metadata: {
          assignmentId: "assignment-1"
        }
      },
      {
        approvalRequestRepository: repository,
        approvalAuditWriter: auditWriter,
        createApprovalRequestId: () => "approval-request-submission",
        getCurrentTime: () => "2026-03-28T18:35:00.000Z"
      }
    );

    expect(result.submitted).toBe(true);
    expect(auditWriter.events).toHaveLength(1);
    expect(auditWriter.events[0]).toMatchObject({
      eventType: "approval_request_submitted",
      approvalRequestId: "approval-request-submission",
      tenantId: "tenant-1",
      approvalType: "staffing_conflict_override",
      actorId: "requester-1",
      fromStatus: null,
      toStatus: "submitted"
    });
  });

  it("writes an audit event when an approval decision is recorded", async () => {
    const auditWriter = new InMemoryApprovalAuditWriter();
    const repository = new InMemoryApprovalDecisionRepository([
      createApprovalRequest({
        approvalRequestId: "approval-request-decision",
        approvalType: "staffing_conflict_override",
        status: "submitted",
        executionMode: "manual_after_approval",
        policyKey: "staffing-conflict-override",
        targetResource: "staff_assignment",
        targetResourceId: "assignment-1",
        requestedAction: "override",
        summary: "Override the staffing conflict."
      })
    ]);

    const result = await recordApprovalDecision(
      {
        approvalRequestId: "approval-request-decision",
        decisionOutcome: "approved",
        decidedByActorId: "approver-1",
        note: "Approved after review."
      },
      {
        approvalDecisionRepository: repository,
        approvalAuditWriter: auditWriter,
        createApprovalDecisionId: () => "approval-decision-1",
        getCurrentTime: () => "2026-03-28T18:40:00.000Z"
      }
    );

    expect(result.recorded).toBe(true);
    expect(auditWriter.events).toHaveLength(1);
    expect(auditWriter.events[0]).toMatchObject({
      eventType: "approval_decision_recorded",
      approvalRequestId: "approval-request-decision",
      approvalType: "staffing_conflict_override",
      actorId: "approver-1",
      fromStatus: "submitted",
      toStatus: "approved",
      decisionOutcome: "approved",
      note: "Approved after review."
    });
  });

  it("writes an audit event when an approved action is executed", async () => {
    const auditWriter = new InMemoryApprovalAuditWriter();
    const repository = new InMemoryApprovalExecutionRepository([
      createApprovalRequest({
        approvalRequestId: "approval-request-execution"
      })
    ]);
    const executors: ApprovalActionExecutor[] = [
      {
        approvalType: "lifecycle_reopen_transition",
        execute: ({ approvalRequest }) => ({
          approvalType: approvalRequest.approvalType,
          executionMode: approvalRequest.executionMode,
          outcome: "executed",
          executionCode: "lifecycle_reopen_executed",
          message: "Lifecycle reopen transition executed.",
          metadata: {
            toStatus: "delivered"
          }
        })
      }
    ];

    const result = await executeApprovedAction(
      {
        approvalRequestId: "approval-request-execution",
        executedByActorId: "system-executor"
      },
      {
        approvalExecutionRepository: repository,
        approvalExecutionRouter: createApprovalExecutionRouter(executors),
        approvalAuditWriter: auditWriter,
        getCurrentTime: () => "2026-03-28T18:45:00.000Z"
      }
    );

    expect(result.executed).toBe(true);
    expect(auditWriter.events).toHaveLength(1);
    expect(auditWriter.events[0]).toMatchObject({
      eventType: "approval_action_executed",
      approvalRequestId: "approval-request-execution",
      approvalType: "lifecycle_reopen_transition",
      actorId: "system-executor",
      fromStatus: "approved",
      toStatus: "executed",
      executionOutcome: "executed",
      executionCode: "lifecycle_reopen_executed"
    });
  });
});
