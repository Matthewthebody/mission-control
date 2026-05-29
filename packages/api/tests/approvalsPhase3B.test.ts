import { describe, expect, it } from "vitest";
import {
  createLifecycleApprovalActionExecutors,
  createLifecycleReopenApprovalSubmissionInput,
  createLifecycleRollbackApprovalSubmissionInput,
  createGoNoGoOverrideApprovalSubmissionInput,
  createReadinessApprovalActionExecutors,
  createReadinessOverrideApprovalSubmissionInput,
  createShootLifecycleApprovalContextFromApprovalRequest,
  type ApprovalRequest,
  type LifecycleApprovalExecutionHook,
  type ReadinessApprovalExecutionHook
} from "../src/domain/approvals/index.js";
import {
  createReadinessCheckResult,
  createShootReadinessDetailDto,
  evaluateReadiness
} from "../src/domain/readiness/index.js";

function createApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalRequestId: "approval-request-1",
    approvalType: "lifecycle_reopen_transition",
    status: "approved",
    executionMode: "automatic_on_approval",
    policyKey: "lifecycle-reopen-transition",
    tenantId: "tenant-1",
    requestedByActorId: "requester-1",
    requestedAt: "2026-03-28T19:00:00.000Z",
    targetResource: "shoot_lifecycle",
    targetResourceId: "shoot-1",
    requestedAction: "transition",
    reason: "Need to reopen the shoot.",
    summary: "Reopen the shoot lifecycle.",
    metadata: {},
    ...overrides
  };
}

describe("approval workflow domain phase 3B lifecycle/readiness integration", () => {
  it("builds lifecycle approval submission inputs and lifecycle approval context cleanly", () => {
    const rollbackInput = createLifecycleRollbackApprovalSubmissionInput({
      tenantId: "tenant-1",
      requestedByActorId: "actor-1",
      shootId: "shoot-1",
      transitionKey: "move_ready_back_to_confirmed",
      currentStatus: "READY",
      targetStatus: "CONFIRMED",
      reason: "Need to restaff before shoot day."
    });

    const reopenInput = createLifecycleReopenApprovalSubmissionInput({
      tenantId: "tenant-1",
      requestedByActorId: "actor-2",
      shootId: "shoot-2",
      transitionKey: "reopen_complete_to_post_production",
      currentStatus: "COMPLETE",
      targetStatus: "POST_PRODUCTION",
      reason: "Client requested a reopened delivery."
    });

    expect(rollbackInput.approvalType).toBe("lifecycle_rollback_transition");
    expect(rollbackInput.targetResourceId).toBe("shoot-1");
    expect(rollbackInput.metadata).toMatchObject({
      transitionKey: "move_ready_back_to_confirmed",
      currentStatus: "READY",
      targetStatus: "CONFIRMED"
    });

    expect(reopenInput.approvalType).toBe("lifecycle_reopen_transition");
    expect(reopenInput.summary).toContain("reopen");

    expect(
      createShootLifecycleApprovalContextFromApprovalRequest(
        createApprovalRequest({
          approvalRequestId: "approval-request-lifecycle",
          approvalType: "lifecycle_reopen_transition",
          status: "approved"
        })
      )
    ).toEqual({
      approvalSatisfied: true,
      approvalRequestId: "approval-request-lifecycle"
    });

    expect(
      createShootLifecycleApprovalContextFromApprovalRequest(
        createApprovalRequest({
          approvalType: "readiness_override",
          status: "approved"
        })
      )
    ).toEqual({
      approvalSatisfied: false,
      approvalRequestId: null
    });
  });

  it("creates lifecycle execution adapters that map approval requests into lifecycle hook calls", async () => {
    const lifecycleHookCalls: string[] = [];
    const lifecycleHook: LifecycleApprovalExecutionHook = {
      executeRollbackTransition(context) {
        lifecycleHookCalls.push(`rollback:${context.transitionKey}:${context.currentStatus}:${context.targetStatus}`);
        return {
          executionCode: "lifecycle_rollback_executed",
          message: "Lifecycle rollback executed."
        };
      },
      executeReopenTransition(context) {
        lifecycleHookCalls.push(`reopen:${context.transitionKey}:${context.currentStatus}:${context.targetStatus}`);
        return {
          executionCode: "lifecycle_reopen_executed",
          message: "Lifecycle reopen executed."
        };
      }
    };

    const executors = createLifecycleApprovalActionExecutors(lifecycleHook);
    const rollbackExecutor = executors.find(
      (executor) => executor.approvalType === "lifecycle_rollback_transition"
    );
    const reopenExecutor = executors.find(
      (executor) => executor.approvalType === "lifecycle_reopen_transition"
    );

    const rollbackResult = await rollbackExecutor?.execute({
      approvalRequest: createApprovalRequest({
        approvalType: "lifecycle_rollback_transition",
        metadata: {
          transitionKey: "move_ready_back_to_confirmed",
          currentStatus: "READY",
          targetStatus: "CONFIRMED"
        }
      })
    });

    const reopenResult = await reopenExecutor?.execute({
      approvalRequest: createApprovalRequest({
        approvalType: "lifecycle_reopen_transition",
        metadata: {
          transitionKey: "reopen_complete_to_post_production",
          currentStatus: "COMPLETE",
          targetStatus: "POST_PRODUCTION"
        }
      })
    });

    expect(lifecycleHookCalls).toEqual([
      "rollback:move_ready_back_to_confirmed:READY:CONFIRMED",
      "reopen:reopen_complete_to_post_production:COMPLETE:POST_PRODUCTION"
    ]);
    expect(rollbackResult?.executionCode).toBe("lifecycle_rollback_executed");
    expect(reopenResult?.executionCode).toBe("lifecycle_reopen_executed");
  });

  it("builds readiness approval submission inputs from readiness detail and escalation context", () => {
    const readinessDetail = createShootReadinessDetailDto(
      "shoot-3",
      evaluateReadiness([
        createReadinessCheckResult("staffing_complete", { passed: true }),
        createReadinessCheckResult("lead_assigned", { passed: false, message: "Lead is missing." })
      ])
    );

    const readinessOverrideInput = createReadinessOverrideApprovalSubmissionInput({
      tenantId: "tenant-1",
      requestedByActorId: "actor-1",
      shootId: "shoot-3",
      readinessDetail,
      reason: "Need to proceed while staffing lead is being finalized."
    });

    const goNoGoOverrideInput = createGoNoGoOverrideApprovalSubmissionInput({
      tenantId: "tenant-1",
      requestedByActorId: "actor-2",
      shootId: "shoot-3",
      readinessDetail,
      reason: "Leadership approved the go/no-go exception.",
      alertCandidate: {
        ruleCode: "no_go_state",
        severity: "critical",
        readinessState: readinessDetail.summary.readinessState,
        goNoGoState: readinessDetail.summary.goNoGoState,
        title: "No-Go",
        summary: "Readiness is currently no-go.",
        recommendedAction: "Escalate"
      }
    });

    expect(readinessOverrideInput.approvalType).toBe("readiness_override");
    expect(readinessOverrideInput.metadata).toMatchObject({
      shootId: "shoot-3",
      readinessState: readinessDetail.summary.readinessState,
      goNoGoState: readinessDetail.summary.goNoGoState,
      blockerCount: readinessDetail.summary.blockerCount
    });

    expect(goNoGoOverrideInput.approvalType).toBe("go_no_go_override");
    expect(goNoGoOverrideInput.metadata).toMatchObject({
      alertRuleCode: "no_go_state",
      alertSeverity: "critical"
    });
  });

  it("creates readiness execution adapters that map approval requests into readiness hook calls", async () => {
    const readinessHookCalls: string[] = [];
    const readinessHook: ReadinessApprovalExecutionHook = {
      executeReadinessOverride(context) {
        readinessHookCalls.push(
          `readiness:${context.readinessState}:${context.goNoGoState}:${context.blockerCount}`
        );
        return {
          executionCode: "readiness_override_executed",
          message: "Readiness override executed."
        };
      },
      executeGoNoGoOverride(context) {
        readinessHookCalls.push(
          `go-no-go:${context.readinessState}:${context.goNoGoState}:${context.alertRuleCode}`
        );
        return {
          executionCode: "go_no_go_override_executed",
          message: "Go/No-Go override executed."
        };
      }
    };

    const executors = createReadinessApprovalActionExecutors(readinessHook);
    const readinessExecutor = executors.find(
      (executor) => executor.approvalType === "readiness_override"
    );
    const goNoGoExecutor = executors.find(
      (executor) => executor.approvalType === "go_no_go_override"
    );

    const readinessResult = await readinessExecutor?.execute({
      approvalRequest: createApprovalRequest({
        approvalType: "readiness_override",
        executionMode: "manual_after_approval",
        policyKey: "readiness-override",
        targetResource: "readiness_summary",
        requestedAction: "override",
        metadata: {
          readinessState: "not_ready",
          goNoGoState: "hold",
          blockerCount: 1,
          missingItemCount: 2
        }
      })
    });

    const goNoGoResult = await goNoGoExecutor?.execute({
      approvalRequest: createApprovalRequest({
        approvalType: "go_no_go_override",
        executionMode: "manual_after_approval",
        policyKey: "go-no-go-override",
        targetResource: "readiness_summary",
        requestedAction: "override",
        metadata: {
          readinessState: "not_ready",
          goNoGoState: "no_go",
          blockerCount: 2,
          missingItemCount: 2,
          alertRuleCode: "no_go_state",
          alertSeverity: "critical"
        }
      })
    });

    expect(readinessHookCalls).toEqual([
      "readiness:not_ready:hold:1",
      "go-no-go:not_ready:no_go:no_go_state"
    ]);
    expect(readinessResult?.executionCode).toBe("readiness_override_executed");
    expect(goNoGoResult?.executionCode).toBe("go_no_go_override_executed");
  });
});
