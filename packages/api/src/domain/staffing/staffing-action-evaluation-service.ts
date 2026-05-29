import type { DangerousStaffingActionType } from "./dangerous-staffing-action-type.js";
import type {
  StaffingActionEvaluationResult,
  StaffingActionKind,
  StaffingOverrideRequirement
} from "./staffing-action-evaluation.js";
import type { StaffingConflictEvaluationResult } from "./staffing-conflict.js";
import type { StaffingValidationResult } from "./staffing-validation.js";

export interface StaffingActionEvaluationContext {
  actionKind: StaffingActionKind;
  conflictEvaluation: StaffingConflictEvaluationResult;
  staffingValidation?: StaffingValidationResult | null;
}

const DANGEROUS_STAFFING_ACTION_LABELS: Record<DangerousStaffingActionType, string> = {
  assign_with_conflict_override: "assignment conflict override",
  publish_with_conflict_warnings: "publish with conflict warnings",
  publish_without_lead_coverage: "publish without lead coverage",
  publish_understaffed: "publish understaffed plan",
  publish_overstaffed: "publish overstaffed plan"
};

const STAFFING_ACTION_KIND_SET = new Set<string>(["assign_staffing_assignment", "publish_staffing"]);

function collectDangerousActionTypes(
  actionKind: StaffingActionKind,
  conflictEvaluation: StaffingConflictEvaluationResult,
  staffingValidation: StaffingValidationResult | null
): DangerousStaffingActionType[] {
  const dangerousActionTypes = new Set<DangerousStaffingActionType>();

  if (actionKind === "assign_staffing_assignment") {
    if (conflictEvaluation.softConflicts.length > 0) {
      dangerousActionTypes.add("assign_with_conflict_override");
    }
  }

  if (actionKind === "publish_staffing") {
    if (conflictEvaluation.softConflicts.length > 0) {
      dangerousActionTypes.add("publish_with_conflict_warnings");
    }
    if (staffingValidation && !staffingValidation.leadCoverage.leadCoverageSatisfied) {
      dangerousActionTypes.add("publish_without_lead_coverage");
    }
    if (staffingValidation && staffingValidation.staffingCoverage.missingStaffCount > 0) {
      dangerousActionTypes.add("publish_understaffed");
    }
    if (staffingValidation && staffingValidation.staffingCoverage.excessStaffCount > 0) {
      dangerousActionTypes.add("publish_overstaffed");
    }
  }

  return [...dangerousActionTypes];
}

function buildOverrideRequirement(
  actionKind: StaffingActionKind,
  dangerousActionTypes: DangerousStaffingActionType[],
  actionAllowed: boolean
): StaffingOverrideRequirement | null {
  if (!actionAllowed || dangerousActionTypes.length === 0) {
    return null;
  }

  const requiredCapabilities =
    actionKind === "assign_staffing_assignment"
      ? (["override_staffing_conflict"] as const)
      : (["override_staffing_warnings"] as const);

  return {
    required: true,
    requiredCapabilities: [...requiredCapabilities],
    dangerousActionTypes,
    reason: `This staffing action requires override authority because it is classified as ${dangerousActionTypes
      .map((actionType) => DANGEROUS_STAFFING_ACTION_LABELS[actionType])
      .join(", ")}.`
  };
}

export function isStaffingActionKind(value: string): value is StaffingActionKind {
  return STAFFING_ACTION_KIND_SET.has(value);
}

export function evaluateStaffingAction(
  context: StaffingActionEvaluationContext
): StaffingActionEvaluationResult {
  const staffingValidation = context.staffingValidation ?? null;
  const dangerousActionTypes = collectDangerousActionTypes(
    context.actionKind,
    context.conflictEvaluation,
    staffingValidation
  );
  const actionAllowed = context.conflictEvaluation.hardConflicts.length === 0;
  const directActionAllowed = actionAllowed && dangerousActionTypes.length === 0;
  const overrideRequirement = buildOverrideRequirement(
    context.actionKind,
    dangerousActionTypes,
    actionAllowed
  );

  return {
    actionKind: context.actionKind,
    dangerousActionTypes,
    overrideRequirement,
    directActionAllowed,
    actionAllowed,
    hardConflicts: context.conflictEvaluation.hardConflicts,
    softConflicts: context.conflictEvaluation.softConflicts,
    warnings: context.conflictEvaluation.warnings,
    conflictEvaluation: context.conflictEvaluation,
    staffingValidation
  };
}
