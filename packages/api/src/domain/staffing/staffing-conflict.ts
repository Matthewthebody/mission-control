import type { StaffingConflictSeverity } from "./staffing-conflict-severity.js";
import type { StaffingConflictType } from "./staffing-conflict-type.js";

export interface StaffingConflict {
  conflictType: StaffingConflictType;
  severity: StaffingConflictSeverity;
  message: string;
  shootId?: string | null;
  employeeId?: string | null;
  assignmentId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StaffingConflictEvaluationResult {
  conflicts: StaffingConflict[];
  hardConflicts: StaffingConflict[];
  softConflicts: StaffingConflict[];
  warnings: StaffingConflict[];
  warningConflicts: StaffingConflict[];
  overrideRequiredConflicts: StaffingConflict[];
  blockingConflicts: StaffingConflict[];
  directActionAllowed: boolean;
  overrideRequired: boolean;
  hasWarnings: boolean;
  requiresOverride: boolean;
  hasBlockingConflicts: boolean;
}

export function createStaffingConflictEvaluationResult(
  conflicts: StaffingConflict[]
): StaffingConflictEvaluationResult {
  const warningConflicts = conflicts.filter((conflict) => conflict.severity === "warning");
  const overrideRequiredConflicts = conflicts.filter(
    (conflict) => conflict.severity === "override_required"
  );
  const blockingConflicts = conflicts.filter((conflict) => conflict.severity === "blocking");

  return {
    conflicts,
    hardConflicts: blockingConflicts,
    softConflicts: overrideRequiredConflicts,
    warnings: warningConflicts,
    warningConflicts,
    overrideRequiredConflicts,
    blockingConflicts,
    directActionAllowed: blockingConflicts.length === 0 && overrideRequiredConflicts.length === 0,
    overrideRequired: blockingConflicts.length === 0 && overrideRequiredConflicts.length > 0,
    hasWarnings: warningConflicts.length > 0,
    requiresOverride: overrideRequiredConflicts.length > 0,
    hasBlockingConflicts: blockingConflicts.length > 0
  };
}
