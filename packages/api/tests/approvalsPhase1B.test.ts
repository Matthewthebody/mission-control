import { describe, expect, it } from "vitest";
import {
  APPROVAL_POLICIES,
  APPROVAL_TYPE_REGISTRY,
  approvalTypeRequiresAudit,
  approvalTypeRequiresSecondApproval,
  getAllowedApproverRoles,
  getApprovalExecutionMode,
  getApprovalPolicy,
  getApprovalPolicyByKey,
  getRequiredApproverCount,
  listApprovalPolicies
} from "../src/domain/approvals/index.js";

describe("approval workflow domain phase 1B", () => {
  it("registers one explicit policy for every canonical approval type", () => {
    expect(APPROVAL_POLICIES).toHaveLength(APPROVAL_TYPE_REGISTRY.length);
    expect(new Set(APPROVAL_POLICIES.map((policy) => policy.policyKey)).size).toBe(
      APPROVAL_POLICIES.length
    );
    expect(new Set(APPROVAL_POLICIES.map((policy) => policy.approvalType)).size).toBe(
      APPROVAL_POLICIES.length
    );

    expect(listApprovalPolicies().map((policy) => policy.approvalType).sort()).toEqual(
      [...APPROVAL_TYPE_REGISTRY].sort()
    );
  });

  it("exposes lookup helpers for approver roles, dual approval, audit, and execution mode", () => {
    expect(getAllowedApproverRoles("staffing_conflict_override")).toEqual([
      "super_admin",
      "leadership",
      "director_admin"
    ]);
    expect(approvalTypeRequiresSecondApproval("staffing_conflict_override")).toBe(false);
    expect(approvalTypeRequiresSecondApproval("go_no_go_override")).toBe(true);
    expect(approvalTypeRequiresAudit("lifecycle_reopen_transition")).toBe(true);
    expect(getApprovalExecutionMode("lifecycle_reopen_transition")).toBe("automatic_on_approval");
    expect(getRequiredApproverCount("lifecycle_reopen_transition")).toBe(2);
  });

  it("resolves policies by approval type and policy key", () => {
    const lifecycleRollbackPolicy = getApprovalPolicy("lifecycle_rollback_transition");

    expect(lifecycleRollbackPolicy.policyKey).toBe("lifecycle-rollback-transition");
    expect(lifecycleRollbackPolicy.requiresSecondApproval).toBe(true);
    expect(lifecycleRollbackPolicy.requiresAudit).toBe(true);
    expect(lifecycleRollbackPolicy.reasonRequired).toBe(true);

    expect(getApprovalPolicyByKey("go-no-go-override")?.approvalType).toBe("go_no_go_override");
    expect(getApprovalPolicyByKey("missing-policy")).toBeNull();
  });
});
