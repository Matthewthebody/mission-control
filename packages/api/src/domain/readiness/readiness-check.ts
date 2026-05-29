import type { GoNoGoState } from "./go-no-go-state.js";
import type { ReadinessCheckCode } from "./readiness-check-code.js";
import type { ReadinessCheckSeverity } from "./readiness-check-severity.js";
import type { ReadinessState } from "./readiness-state.js";
import type { ReadinessWeightCategory } from "./readiness-weight-category.js";

export interface ReadinessCheckDefinition {
  checkCode: ReadinessCheckCode;
  label: string;
  description: string;
  severity: ReadinessCheckSeverity;
  weightCategory: ReadinessWeightCategory;
  blockingByDefault: boolean;
  sortOrder: number;
}

export interface ReadinessCheckResult {
  checkCode: ReadinessCheckCode;
  passed: boolean;
  severity: ReadinessCheckSeverity;
  weightCategory: ReadinessWeightCategory;
  blocking: boolean;
  message: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReadinessMissingItem {
  checkCode: ReadinessCheckCode;
  label: string;
  severity: ReadinessCheckSeverity;
  weightCategory: ReadinessWeightCategory;
  blocking: boolean;
  hardBlocker: boolean;
  message: string | null;
}

export interface ReadinessBlocker {
  checkCode: ReadinessCheckCode;
  label: string;
  severity: ReadinessCheckSeverity;
  hardBlocker: boolean;
  message: string | null;
}

export interface ReadinessEvaluationResult {
  readinessState: ReadinessState;
  goNoGoState: GoNoGoState;
  checkResults: ReadinessCheckResult[];
  missingItems: ReadinessMissingItem[];
  blockers: ReadinessBlocker[];
  passedCheckCount: number;
  failedCheckCount: number;
  blockingCheckCount: number;
  warningCheckCount: number;
  scoreEarned: number;
  scorePossible: number;
  scorePercentage: number;
}

export const READINESS_WEIGHT_VALUE_REGISTRY: Readonly<Record<ReadinessWeightCategory, number>> = {
  critical: 40,
  high: 25,
  standard: 15,
  low: 5
} as const;

export const READINESS_CHECK_DEFINITIONS: Readonly<Record<ReadinessCheckCode, ReadinessCheckDefinition>> = {
  staffing_complete: {
    checkCode: "staffing_complete",
    label: "Staffing Complete",
    description: "The required staffing plan is fully covered for the Shoot.",
    severity: "blocking",
    weightCategory: "critical",
    blockingByDefault: true,
    sortOrder: 10
  },
  lead_assigned: {
    checkCode: "lead_assigned",
    label: "Lead Assigned",
    description: "A lead-qualified employee is assigned where lead coverage is required.",
    severity: "blocking",
    weightCategory: "critical",
    blockingByDefault: true,
    sortOrder: 20
  },
  schedule_timing_confirmed: {
    checkCode: "schedule_timing_confirmed",
    label: "Schedule Timing Confirmed",
    description: "Arrival, execution, and closeout timing are confirmed enough to operate safely.",
    severity: "blocking",
    weightCategory: "high",
    blockingByDefault: true,
    sortOrder: 30
  },
  location_ready: {
    checkCode: "location_ready",
    label: "Location Ready",
    description: "Location-specific prep, access, and operational expectations are confirmed.",
    severity: "warning",
    weightCategory: "high",
    blockingByDefault: false,
    sortOrder: 40
  },
  equipment_ready: {
    checkCode: "equipment_ready",
    label: "Equipment Ready",
    description: "Required equipment, kits, and serviceability signals are ready for execution.",
    severity: "blocking",
    weightCategory: "high",
    blockingByDefault: true,
    sortOrder: 50
  },
  setup_photo_received: {
    checkCode: "setup_photo_received",
    label: "Setup Photo Received",
    description: "A current Setup Photo is available when the shoot workflow requires one.",
    severity: "advisory",
    weightCategory: "standard",
    blockingByDefault: false,
    sortOrder: 60
  },
  pre_service_note_present: {
    checkCode: "pre_service_note_present",
    label: "Pre-Service Note Present",
    description: "The operational prep note needed for the Shoot is present and visible to the team.",
    severity: "warning",
    weightCategory: "standard",
    blockingByDefault: false,
    sortOrder: 70
  },
  approval_clearance: {
    checkCode: "approval_clearance",
    label: "Approval Clearance",
    description: "No unresolved approval gate is preventing the Shoot from proceeding.",
    severity: "blocking",
    weightCategory: "critical",
    blockingByDefault: true,
    sortOrder: 80
  },
  open_issue_reviewed: {
    checkCode: "open_issue_reviewed",
    label: "Open Issue Reviewed",
    description: "Open Issues that affect execution have been reviewed and acknowledged.",
    severity: "warning",
    weightCategory: "standard",
    blockingByDefault: false,
    sortOrder: 90
  }
} as const;

export function getReadinessCheckDefinition(checkCode: ReadinessCheckCode): ReadinessCheckDefinition {
  return READINESS_CHECK_DEFINITIONS[checkCode];
}

export function listReadinessCheckDefinitions(): ReadinessCheckDefinition[] {
  return Object.values(READINESS_CHECK_DEFINITIONS).sort((left, right) => left.sortOrder - right.sortOrder);
}

export function listBlockingReadinessCheckDefinitions(): ReadinessCheckDefinition[] {
  return listReadinessCheckDefinitions().filter((definition) => definition.blockingByDefault);
}

export function getReadinessWeightValue(weightCategory: ReadinessWeightCategory): number {
  return READINESS_WEIGHT_VALUE_REGISTRY[weightCategory];
}

export function createReadinessCheckResult(
  checkCode: ReadinessCheckCode,
  input: {
    passed: boolean;
    message?: string | null;
    metadata?: Record<string, unknown>;
    blocking?: boolean;
  }
): ReadinessCheckResult {
  const definition = getReadinessCheckDefinition(checkCode);

  return {
    checkCode,
    passed: input.passed,
    severity: definition.severity,
    weightCategory: definition.weightCategory,
    blocking: input.blocking ?? (!input.passed && definition.blockingByDefault),
    message: input.message ?? null,
    metadata: input.metadata
  };
}
