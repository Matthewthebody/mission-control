import { describe, expect, it } from "vitest";
import {
  STAFFING_PUBLICATION_ACTION_REGISTRY,
  STAFFING_PUBLICATION_DENIAL_REASON_REGISTRY,
  STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_REGISTRY,
  createStaffingConflictEvaluationResult,
  evaluateStaffingAction,
  isStaffingPublicationAction,
  isStaffingPublicationDenialReason,
  isStaffingPublicationValidationHookOutcome,
  runStaffingPublicationWorkflow,
  type StaffingPublicationRequest,
  type StaffingRequirement
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 3B publication workflow", () => {
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

  const assignments: StaffingPublicationRequest["assignments"] = [
    {
      assignmentId: "assignment-1",
      shootId: "shoot-123",
      employeeId: "employee-1",
      assignmentRole: "lead_photographer",
      assignmentStatus: "draft",
      countsTowardLeadCoverage: true,
      linkedShiftId: "shift-1"
    },
    {
      assignmentId: "assignment-2",
      shootId: "shoot-123",
      employeeId: "employee-2",
      assignmentRole: "photographer",
      assignmentStatus: "published",
      countsTowardLeadCoverage: false,
      linkedShiftId: "shift-2"
    },
    {
      assignmentId: "assignment-3",
      shootId: "shoot-123",
      employeeId: "employee-3",
      assignmentRole: "assistant",
      assignmentStatus: "cancelled",
      countsTowardLeadCoverage: false
    }
  ];

  it("exposes deterministic publication registries and guards", () => {
    expect(new Set(STAFFING_PUBLICATION_ACTION_REGISTRY).size).toBe(
      STAFFING_PUBLICATION_ACTION_REGISTRY.length
    );
    expect(new Set(STAFFING_PUBLICATION_DENIAL_REASON_REGISTRY).size).toBe(
      STAFFING_PUBLICATION_DENIAL_REASON_REGISTRY.length
    );
    expect(new Set(STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_REGISTRY).size).toBe(
      STAFFING_PUBLICATION_VALIDATION_HOOK_OUTCOME_REGISTRY.length
    );
    expect(isStaffingPublicationAction("publish")).toBe(true);
    expect(isStaffingPublicationAction("release")).toBe(false);
    expect(isStaffingPublicationDenialReason("override_required")).toBe(true);
    expect(isStaffingPublicationDenialReason("forbidden")).toBe(false);
    expect(isStaffingPublicationValidationHookOutcome("warning")).toBe(true);
    expect(isStaffingPublicationValidationHookOutcome("deny")).toBe(false);
  });

  it("publishes staffing and returns separate internal and employee-visible DTOs", () => {
    const request: StaffingPublicationRequest = {
      publicationAction: "publish",
      requirement,
      assignments,
      currentPublicationState: "draft"
    };

    const result = runStaffingPublicationWorkflow(request);

    expect(result.allowed).toBe(true);
    expect(result.publicationStateChanged).toBe(true);
    expect(result.targetPublicationState).toBe("published");
    expect(result.employeeVisibleScheduleReleased).toBe(true);
    expect(result.internalStaffing.publicationState).toBe("published");
    expect(result.internalStaffing.assignments).toHaveLength(3);
    expect(result.publishedStaffing?.publicationState).toBe("published");
    expect(result.publishedStaffing?.publishedAssignmentCount).toBe(2);
    expect(result.publishedStaffing?.assignments.map((assignment) => assignment.assignmentId)).toEqual([
      "assignment-1",
      "assignment-2"
    ]);
  });

  it("requires override acknowledgement before publishing dangerous staffing actions", () => {
    const conflictEvaluation = createStaffingConflictEvaluationResult([
      {
        conflictType: "assignment_overlap",
        severity: "override_required",
        message: "An overlapping assignment requires override."
      }
    ]);
    const actionEvaluation = evaluateStaffingAction({
      actionKind: "publish_staffing",
      conflictEvaluation
    });

    const result = runStaffingPublicationWorkflow({
      publicationAction: "publish",
      requirement,
      assignments,
      currentPublicationState: "draft",
      actionEvaluation
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("override_required");
    expect(result.overrideRequired).toBe(true);
    expect(result.overrideRequirement).not.toBeNull();
    expect(result.publishedStaffing).toBeNull();
  });

  it("blocks publication when validation hooks return block results", () => {
    const result = runStaffingPublicationWorkflow(
      {
        publicationAction: "publish",
        requirement,
        assignments,
        currentPublicationState: "draft",
        overrideAcknowledged: true
      },
      {
        validationHookRegistry: {
          lead_publish_guard: {
            hookKey: "lead_publish_guard",
            evaluate() {
              return {
                hookKey: "lead_publish_guard",
                outcome: "block",
                message: "Publishing is blocked until leadership approves the current staffing exception."
              };
            }
          }
        }
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("blocked_by_validation_hook");
    expect(result.blockingHookResults).toHaveLength(1);
    expect(result.internalStaffing.publicationState).toBe("draft");
    expect(result.publishedStaffing).toBeNull();
  });

  it("unpublishes staffing and clears the employee-visible DTO", () => {
    const result = runStaffingPublicationWorkflow({
      publicationAction: "unpublish",
      requirement: {
        ...requirement,
        publicationState: "published"
      },
      assignments,
      currentPublicationState: "published"
    });

    expect(result.allowed).toBe(true);
    expect(result.targetPublicationState).toBe("draft");
    expect(result.employeeVisibleScheduleReleased).toBe(false);
    expect(result.internalStaffing.publicationState).toBe("draft");
    expect(result.publishedStaffing).toBeNull();
  });
});
