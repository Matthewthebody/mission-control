import { describe, expect, it } from "vitest";
import {
  APPROVAL_DECISION_OUTCOME_REGISTRY,
  APPROVAL_EXECUTION_MODE_REGISTRY,
  APPROVAL_STATUS_REGISTRY,
  APPROVAL_TYPE_REGISTRY,
  isApprovalDecisionOutcome,
  isApprovalExecutionMode,
  isApprovalStatus,
  isApprovalType,
  type ApprovalDecision,
  type ApprovalPolicy,
  type ApprovalRequest
} from "../src/domain/approvals/index.js";
import { ACTION_REGISTRY } from "../src/domain/auth/action.js";
import { RESOURCE_REGISTRY } from "../src/domain/auth/resource.js";
import { ROLE_REGISTRY } from "../src/domain/auth/role.js";

describe("approval workflow domain phase 1A", () => {
  it("exposes deterministic approval registries and guards", () => {
    expect(new Set(APPROVAL_TYPE_REGISTRY).size).toBe(APPROVAL_TYPE_REGISTRY.length);
    expect(new Set(APPROVAL_STATUS_REGISTRY).size).toBe(APPROVAL_STATUS_REGISTRY.length);
    expect(new Set(APPROVAL_EXECUTION_MODE_REGISTRY).size).toBe(
      APPROVAL_EXECUTION_MODE_REGISTRY.length
    );
    expect(new Set(APPROVAL_DECISION_OUTCOME_REGISTRY).size).toBe(
      APPROVAL_DECISION_OUTCOME_REGISTRY.length
    );

    expect(isApprovalType("staffing_conflict_override")).toBe(true);
    expect(isApprovalType("manager_ok")).toBe(false);
    expect(isApprovalStatus("under_review")).toBe(true);
    expect(isApprovalStatus("pending")).toBe(false);
    expect(isApprovalExecutionMode("manual_after_approval")).toBe(true);
    expect(isApprovalExecutionMode("queued")).toBe(false);
    expect(isApprovalDecisionOutcome("returned")).toBe(true);
    expect(isApprovalDecisionOutcome("escalated")).toBe(false);
  });

  it("keeps approval policies anchored to canonical auth roles, actions, and resources", () => {
    const policy: ApprovalPolicy = {
      policyKey: "staffing-conflict-override",
      approvalType: "staffing_conflict_override",
      requestedAction: "override",
      targetResource: "staff_assignment",
      executionMode: "manual_after_approval",
      requiredApproverRoles: ["leadership", "director_admin"],
      minimumApproverCount: 1,
      requiresSecondApproval: false,
      requiresAudit: true,
      allowSelfApproval: false,
      reasonRequired: true,
      description: "Conflict overrides require leadership-level approval."
    };

    expect(ROLE_REGISTRY).toContain(policy.requiredApproverRoles[0]);
    expect(ROLE_REGISTRY).toContain(policy.requiredApproverRoles[1]);
    expect(ACTION_REGISTRY).toContain(policy.requestedAction);
    expect(RESOURCE_REGISTRY).toContain(policy.targetResource);
  });

  it("composes approval request and decision models for workflow-safe orchestration", () => {
    const request: ApprovalRequest = {
      approvalRequestId: "approval-1",
      approvalType: "lifecycle_reopen_transition",
      status: "submitted",
      executionMode: "automatic_on_approval",
      policyKey: "lifecycle-reopen-transition",
      tenantId: "tenant-1",
      requestedByActorId: "actor-1",
      requestedAt: "2026-03-28T14:00:00.000Z",
      targetResource: "shoot_lifecycle",
      targetResourceId: "shoot-1",
      requestedAction: "transition",
      reason: "The client reopened delivery changes.",
      summary: "Reopen a closed shoot back to delivered.",
      metadata: {
        fromStatus: "closed",
        toStatus: "delivered"
      }
    };

    const decision: ApprovalDecision = {
      approvalDecisionId: "decision-1",
      approvalRequestId: request.approvalRequestId,
      decisionOutcome: "approved",
      resultingStatus: "approved",
      decidedByActorId: "actor-2",
      decidedAt: "2026-03-28T15:00:00.000Z",
      note: "Approved after delivery change review.",
      executionMode: request.executionMode
    };

    expect(APPROVAL_TYPE_REGISTRY).toContain(request.approvalType);
    expect(APPROVAL_STATUS_REGISTRY).toContain(request.status);
    expect(APPROVAL_STATUS_REGISTRY).toContain(decision.resultingStatus);
    expect(APPROVAL_DECISION_OUTCOME_REGISTRY).toContain(decision.decisionOutcome);
    expect(decision.approvalRequestId).toBe(request.approvalRequestId);
  });
});
