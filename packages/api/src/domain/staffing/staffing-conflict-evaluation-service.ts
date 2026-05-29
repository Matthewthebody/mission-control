import {
  createStaffingConflictEvaluationResult,
  type StaffingConflict,
  type StaffingConflictEvaluationResult
} from "./staffing-conflict.js";

export const STAFFING_CONFLICT_COMMITMENT_KIND_REGISTRY = ["shift", "event", "assignment"] as const;

export type StaffingConflictCommitmentKind = (typeof STAFFING_CONFLICT_COMMITMENT_KIND_REGISTRY)[number];

export interface StaffingConflictEvaluationContext {
  shootId: string;
  employeeId: string;
  assignmentId?: string | null;
  conflictingCommitmentKind?: StaffingConflictCommitmentKind | null;
  conflictingCommitmentId?: string | null;
  conflictingCommitmentTitle?: string | null;
  approvedPtoToday?: boolean;
  leadCoverageRequired?: boolean;
  leadQualified?: boolean;
  beforeGapMinutes?: number | null;
  afterGapMinutes?: number | null;
  assignmentHours?: number | null;
  scheduledHoursToday?: number | null;
  scheduledHoursWeek?: number | null;
  turnaroundWarningMinutes?: number;
  dailyHoursLimit?: number;
  weeklyHoursLimit?: number;
}

export const DEFAULT_STAFFING_TURNAROUND_WARNING_MINUTES = 45;
export const DEFAULT_STAFFING_DAILY_HOURS_LIMIT = 8;
export const DEFAULT_STAFFING_WEEKLY_HOURS_LIMIT = 40;

const STAFFING_CONFLICT_COMMITMENT_KIND_SET = new Set<string>(STAFFING_CONFLICT_COMMITMENT_KIND_REGISTRY);

function buildConflictBase(context: StaffingConflictEvaluationContext) {
  return {
    shootId: context.shootId,
    employeeId: context.employeeId,
    assignmentId: context.assignmentId ?? null
  };
}

function resolveOverlapConflictType(kind: StaffingConflictCommitmentKind) {
  switch (kind) {
    case "shift":
      return "shift_overlap" as const;
    case "event":
      return "calendar_overlap" as const;
    default:
      return "assignment_overlap" as const;
  }
}

function buildOverlapConflict(context: StaffingConflictEvaluationContext): StaffingConflict | null {
  if (!context.conflictingCommitmentKind) {
    return null;
  }

  return {
    ...buildConflictBase(context),
    conflictType: resolveOverlapConflictType(context.conflictingCommitmentKind),
    severity: "override_required",
    message: context.conflictingCommitmentTitle
      ? `This staffing change overlaps with ${context.conflictingCommitmentTitle}.`
      : "This staffing change overlaps with an existing commitment.",
    metadata: {
      conflictingCommitmentKind: context.conflictingCommitmentKind,
      conflictingCommitmentId: context.conflictingCommitmentId ?? null,
      conflictingCommitmentTitle: context.conflictingCommitmentTitle ?? null
    }
  };
}

function buildPtoConflict(context: StaffingConflictEvaluationContext): StaffingConflict | null {
  if (!context.approvedPtoToday) {
    return null;
  }

  return {
    ...buildConflictBase(context),
    conflictType: "pto_unavailable",
    severity: "blocking",
    message: "This employee has approved PTO during the staffing window.",
    metadata: {
      approvedPtoToday: true
    }
  };
}

function buildLeadQualificationConflict(context: StaffingConflictEvaluationContext): StaffingConflict | null {
  if (!context.leadCoverageRequired || context.leadQualified !== false) {
    return null;
  }

  return {
    ...buildConflictBase(context),
    conflictType: "lead_qualification_missing",
    severity: "blocking",
    message: "This staffing change does not satisfy the required lead coverage.",
    metadata: {
      leadCoverageRequired: true,
      leadQualified: false
    }
  };
}

function buildTurnaroundConflict(context: StaffingConflictEvaluationContext): StaffingConflict | null {
  const turnaroundWarningMinutes =
    context.turnaroundWarningMinutes ?? DEFAULT_STAFFING_TURNAROUND_WARNING_MINUTES;
  const beforeGapMinutes = context.beforeGapMinutes ?? null;
  const afterGapMinutes = context.afterGapMinutes ?? null;

  if (
    (beforeGapMinutes === null || beforeGapMinutes >= turnaroundWarningMinutes) &&
    (afterGapMinutes === null || afterGapMinutes >= turnaroundWarningMinutes)
  ) {
    return null;
  }

  return {
    ...buildConflictBase(context),
    conflictType: "turnaround_gap_risk",
    severity: "warning",
    message: "This staffing change leaves a tight turnaround around another commitment.",
    metadata: {
      turnaroundWarningMinutes,
      beforeGapMinutes,
      afterGapMinutes
    }
  };
}

function buildOvertimeConflict(context: StaffingConflictEvaluationContext): StaffingConflict | null {
  const assignmentHours = context.assignmentHours ?? 0;
  const scheduledHoursToday = context.scheduledHoursToday ?? 0;
  const scheduledHoursWeek = context.scheduledHoursWeek ?? 0;
  const dailyHoursLimit = context.dailyHoursLimit ?? DEFAULT_STAFFING_DAILY_HOURS_LIMIT;
  const weeklyHoursLimit = context.weeklyHoursLimit ?? DEFAULT_STAFFING_WEEKLY_HOURS_LIMIT;

  if (
    assignmentHours <= 0 ||
    (scheduledHoursToday + assignmentHours <= dailyHoursLimit &&
      scheduledHoursWeek + assignmentHours <= weeklyHoursLimit)
  ) {
    return null;
  }

  return {
    ...buildConflictBase(context),
    conflictType: "overtime_risk",
    severity: "warning",
    message: "This staffing change pushes the employee into an overtime watch window.",
    metadata: {
      assignmentHours,
      scheduledHoursToday,
      scheduledHoursWeek,
      dailyHoursLimit,
      weeklyHoursLimit
    }
  };
}

export function isStaffingConflictCommitmentKind(value: string): value is StaffingConflictCommitmentKind {
  return STAFFING_CONFLICT_COMMITMENT_KIND_SET.has(value);
}

export function evaluateStaffingConflicts(
  context: StaffingConflictEvaluationContext
): StaffingConflictEvaluationResult {
  const conflicts = [
    buildPtoConflict(context),
    buildLeadQualificationConflict(context),
    buildOverlapConflict(context),
    buildTurnaroundConflict(context),
    buildOvertimeConflict(context)
  ].filter((conflict): conflict is StaffingConflict => conflict !== null);

  return createStaffingConflictEvaluationResult(conflicts);
}
