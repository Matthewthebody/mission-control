import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROTECTED_STAFFING_WINDOW_POLICY,
  PROTECTED_STAFFING_WINDOW_LEVEL_REGISTRY,
  STAFFING_HARDENING_ACTION_KIND_REGISTRY,
  STAFFING_HARDENING_POLICY_REGISTRY,
  STAFFING_HARDENING_RULE_CODE_REGISTRY,
  STAFFING_HARDENING_RULE_OUTCOME_REGISTRY,
  STAFFING_INTEGRATION_HOOK_OUTCOME_REGISTRY,
  createLifecyclePublicationIntegrationHook,
  createProtectedWindowPublicationHardeningHook,
  createReadinessPublicationIntegrationHook,
  createStaffingConflictEvaluationResult,
  evaluateLastMinuteStaffingChange,
  evaluateProtectedStaffingWindow,
  evaluateStaffingAction,
  isProtectedStaffingWindowLevel,
  isStaffingHardeningActionKind,
  isStaffingHardeningRuleCode,
  isStaffingHardeningRuleOutcome,
  isStaffingIntegrationHookOutcome,
  runStaffingPublicationWorkflow,
  type StaffingPublicationRequest,
  type StaffingRequirement,
  type StaffingValidationResult
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 4A hardening", () => {
  const requirement: StaffingRequirement = {
    requirementId: "requirement-123",
    shootId: "shoot-123",
    publicationState: "draft",
    plannedStaffCount: 2,
    leadRequirementType: "at_least_one_lead",
    requiredLeadCount: 1,
    requiredRoles: [
      {
        assignmentRole: "lead_photographer",
        label: "Lead Photographer",
        requiredHeadcount: 1,
        countsTowardLeadCoverage: true,
        sortOrder: 0
      },
      {
        assignmentRole: "photographer",
        label: "Photographer",
        requiredHeadcount: 1,
        countsTowardLeadCoverage: false,
        sortOrder: 1
      }
    ]
  };

  const staffingValidation: StaffingValidationResult = {
    staffingValidationPassed: false,
    requirementId: "requirement-123",
    shootId: "shoot-123",
    staffingCoverage: {
      plannedStaffCount: 2,
      assignedStaffCount: 1,
      missingStaffCount: 1,
      excessStaffCount: 0,
      coverageSatisfied: false,
      countedAssignmentIds: ["assignment-1"]
    },
    requiredRoleCoverage: [
      {
        assignmentRole: "lead_photographer",
        label: "Lead Photographer",
        requiredHeadcount: 1,
        assignedHeadcount: 1,
        missingHeadcount: 0,
        excessHeadcount: 0,
        countsTowardLeadCoverage: true,
        coverageSatisfied: true,
        countedAssignmentIds: ["assignment-1"]
      },
      {
        assignmentRole: "photographer",
        label: "Photographer",
        requiredHeadcount: 1,
        assignedHeadcount: 0,
        missingHeadcount: 1,
        excessHeadcount: 0,
        countsTowardLeadCoverage: false,
        coverageSatisfied: false,
        countedAssignmentIds: []
      }
    ],
    leadCoverage: {
      leadRequirementType: "at_least_one_lead",
      requiredLeadCount: 1,
      assignedLeadCount: 1,
      missingLeadCount: 0,
      leadCoverageSatisfied: true,
      countedAssignmentIds: ["assignment-1"]
    },
    blockingAreas: ["minimum_staffing_coverage", "required_role_coverage"]
  };

  const assignments: StaffingPublicationRequest["assignments"] = [
    {
      assignmentId: "assignment-1",
      shootId: "shoot-123",
      employeeId: "employee-1",
      assignmentRole: "lead_photographer",
      assignmentStatus: "published",
      countsTowardLeadCoverage: true,
      linkedShiftId: "shift-1"
    }
  ];

  it("exposes deterministic protected-window, hardening, and integration registries", () => {
    expect(new Set(PROTECTED_STAFFING_WINDOW_LEVEL_REGISTRY).size).toBe(
      PROTECTED_STAFFING_WINDOW_LEVEL_REGISTRY.length
    );
    expect(new Set(STAFFING_HARDENING_ACTION_KIND_REGISTRY).size).toBe(
      STAFFING_HARDENING_ACTION_KIND_REGISTRY.length
    );
    expect(new Set(STAFFING_HARDENING_RULE_CODE_REGISTRY).size).toBe(
      STAFFING_HARDENING_RULE_CODE_REGISTRY.length
    );
    expect(new Set(STAFFING_HARDENING_RULE_OUTCOME_REGISTRY).size).toBe(
      STAFFING_HARDENING_RULE_OUTCOME_REGISTRY.length
    );
    expect(new Set(STAFFING_INTEGRATION_HOOK_OUTCOME_REGISTRY).size).toBe(
      STAFFING_INTEGRATION_HOOK_OUTCOME_REGISTRY.length
    );
    expect(isProtectedStaffingWindowLevel("protected")).toBe(true);
    expect(isProtectedStaffingWindowLevel("critical")).toBe(false);
    expect(isStaffingHardeningActionKind("publish_staffing")).toBe(true);
    expect(isStaffingHardeningActionKind("reassign")).toBe(false);
    expect(isStaffingHardeningRuleCode("unpublish_inside_locked_window")).toBe(true);
    expect(isStaffingHardeningRuleCode("unknown")).toBe(false);
    expect(isStaffingHardeningRuleOutcome("block")).toBe(true);
    expect(isStaffingHardeningRuleOutcome("deny")).toBe(false);
    expect(isStaffingIntegrationHookOutcome("warning")).toBe(true);
    expect(isStaffingIntegrationHookOutcome("hold")).toBe(false);
    expect(Object.keys(STAFFING_HARDENING_POLICY_REGISTRY)).toHaveLength(
      STAFFING_HARDENING_RULE_CODE_REGISTRY.length
    );
  });

  it("evaluates protected staffing windows deterministically", () => {
    const result = evaluateProtectedStaffingWindow({
      evaluationTime: "2026-03-28T12:00:00.000Z",
      shootStartsAt: "2026-03-29T08:00:00.000Z"
    });

    expect(result.windowLevel).toBe("locked");
    expect(result.insideProtectedWindow).toBe(true);
    expect(result.insideLockedWindow).toBe(true);
    expect(result.hoursUntilShootStart).toBe(20);
    expect(result.policy).toEqual(DEFAULT_PROTECTED_STAFFING_WINDOW_POLICY);
  });

  it("requires override when publishing risky staffing inside the protected window", () => {
    const conflictEvaluation = createStaffingConflictEvaluationResult([
      {
        conflictType: "assignment_overlap",
        severity: "override_required",
        message: "An overlapping assignment requires override."
      }
    ]);
    const actionEvaluation = evaluateStaffingAction({
      actionKind: "publish_staffing",
      conflictEvaluation,
      staffingValidation
    });

    const result = evaluateLastMinuteStaffingChange({
      actionKind: "publish_staffing",
      currentPublicationState: "draft",
      shootStartsAt: "2026-03-30T12:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      actionEvaluation,
      staffingValidation
    });

    expect(result.blocked).toBe(false);
    expect(result.overrideRequired).toBe(true);
    expect(result.directActionAllowed).toBe(false);
    expect(result.overrideRequiredRules.map((rule) => rule.ruleCode)).toContain(
      "publish_with_risk_inside_protected_window"
    );
    expect(result.requiredCapabilities).toContain("override_staffing_warnings");
  });

  it("blocks locked-window staffing reductions and unpublish actions", () => {
    const changeResult = evaluateLastMinuteStaffingChange({
      actionKind: "remove_staffing_assignment",
      currentPublicationState: "published",
      shootStartsAt: "2026-03-29T06:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      staffingCountWillBeReduced: true,
      leadCoverageWillBeReduced: true
    });

    expect(changeResult.blocked).toBe(true);
    expect(changeResult.blockingRules.map((rule) => rule.ruleCode)).toEqual(
      expect.arrayContaining([
        "published_change_reduces_staffing_inside_locked_window",
        "published_change_reduces_lead_coverage_inside_locked_window"
      ])
    );

    const unpublishResult = evaluateLastMinuteStaffingChange({
      actionKind: "unpublish_staffing",
      currentPublicationState: "published",
      shootStartsAt: "2026-03-29T06:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z"
    });

    expect(unpublishResult.blocked).toBe(true);
    expect(unpublishResult.blockingRules.map((rule) => rule.ruleCode)).toContain(
      "unpublish_inside_locked_window"
    );
  });

  it("blocks publication when protected-window hardening requires override acknowledgement", () => {
    const result = runStaffingPublicationWorkflow(
      {
        publicationAction: "publish",
        requirement,
        assignments,
        currentPublicationState: "draft",
        staffingValidation,
        shootStartsAt: "2026-03-30T12:00:00.000Z",
        evaluationTime: "2026-03-28T12:00:00.000Z"
      },
      {
        validationHookRegistry: {
          protected_window_publication_hardening: createProtectedWindowPublicationHardeningHook()
        }
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("blocked_by_validation_hook");
    expect(result.blockingHookResults).toHaveLength(1);
    expect(result.blockingHookResults[0]?.hookKey).toBe("protected_window_publication_hardening");
  });

  it("downgrades protected-window hardening to a warning when override is acknowledged", () => {
    const result = runStaffingPublicationWorkflow(
      {
        publicationAction: "publish",
        requirement,
        assignments,
        currentPublicationState: "draft",
        staffingValidation,
        shootStartsAt: "2026-03-30T12:00:00.000Z",
        evaluationTime: "2026-03-28T12:00:00.000Z",
        overrideAcknowledged: true
      },
      {
        validationHookRegistry: {
          protected_window_publication_hardening: createProtectedWindowPublicationHardeningHook()
        }
      }
    );

    expect(result.allowed).toBe(true);
    expect(result.warningHookResults).toHaveLength(1);
    expect(result.warningHookResults[0]?.hookKey).toBe("protected_window_publication_hardening");
  });

  it("adapts lifecycle and readiness integration hooks into publication validation hooks", () => {
    const baseRequest: StaffingPublicationRequest = {
      publicationAction: "publish",
      requirement,
      assignments,
      currentPublicationState: "draft",
      staffingValidation,
      shootStartsAt: "2026-03-30T12:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      overrideAcknowledged: true
    };

    const lifecycleHook = createLifecyclePublicationIntegrationHook({
      hookKey: "staffing_lifecycle_bridge",
      evaluate(context) {
        return {
          hookKey: "staffing_lifecycle_bridge",
          outcome: context.hardeningEvaluation.windowEvaluation.insideProtectedWindow ? "warning" : "pass",
          reasonCode: "lifecycle_staffing_review",
          message: "Lifecycle should re-check staffing after protected-window publication.",
          metadata: {
            windowLevel: context.hardeningEvaluation.windowEvaluation.windowLevel
          }
        };
      }
    });

    const readinessHook = createReadinessPublicationIntegrationHook({
      hookKey: "staffing_readiness_bridge",
      evaluate(context) {
        return {
          hookKey: "staffing_readiness_bridge",
          outcome: context.hardeningEvaluation.windowEvaluation.insideProtectedWindow ? "block" : "pass",
          reasonCode: "readiness_recheck_required",
          message: "Readiness must be re-evaluated before this protected-window publish can proceed.",
          metadata: {
            targetPublicationState: context.targetPublicationState
          }
        };
      }
    });

    const lifecycleResult = runStaffingPublicationWorkflow(baseRequest, {
      validationHookRegistry: {
        staffing_lifecycle_bridge: lifecycleHook
      }
    });

    expect(lifecycleResult.allowed).toBe(true);
    expect(lifecycleResult.warningHookResults).toHaveLength(1);
    expect(lifecycleResult.warningHookResults[0]?.metadata).toMatchObject({
      reasonCode: "lifecycle_staffing_review"
    });

    const readinessResult = runStaffingPublicationWorkflow(baseRequest, {
      validationHookRegistry: {
        staffing_readiness_bridge: readinessHook
      }
    });

    expect(readinessResult.allowed).toBe(false);
    expect(readinessResult.denialReason).toBe("blocked_by_validation_hook");
    expect(readinessResult.blockingHookResults[0]?.metadata).toMatchObject({
      reasonCode: "readiness_recheck_required"
    });
  });
});
