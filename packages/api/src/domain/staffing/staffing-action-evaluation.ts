import type { StaffingCapability } from "./staffing-capability.js";
import type { StaffingConflict, StaffingConflictEvaluationResult } from "./staffing-conflict.js";
import type { StaffingValidationResult } from "./staffing-validation.js";
import type { DangerousStaffingActionType } from "./dangerous-staffing-action-type.js";

export const STAFFING_ACTION_KIND_REGISTRY = ["assign_staffing_assignment", "publish_staffing"] as const;

export type StaffingActionKind = (typeof STAFFING_ACTION_KIND_REGISTRY)[number];

export interface StaffingOverrideRequirement {
  required: boolean;
  requiredCapabilities: StaffingCapability[];
  dangerousActionTypes: DangerousStaffingActionType[];
  reason: string;
}

export interface StaffingActionEvaluationResult {
  actionKind: StaffingActionKind;
  dangerousActionTypes: DangerousStaffingActionType[];
  overrideRequirement: StaffingOverrideRequirement | null;
  directActionAllowed: boolean;
  actionAllowed: boolean;
  hardConflicts: StaffingConflict[];
  softConflicts: StaffingConflict[];
  warnings: StaffingConflict[];
  conflictEvaluation: StaffingConflictEvaluationResult;
  staffingValidation: StaffingValidationResult | null;
}
