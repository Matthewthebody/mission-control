import type { StaffingValidationResult } from "../domain/staffing/index.js";

export const STAFFING_CREATION_SOURCE_REGISTRY = [
  "manual_from_shoot",
  "template_from_shoot_type",
  "copied_from_prior_shoot",
  "bulk_created",
  "legacy_fallback"
] as const;

export type StaffingCreationSource = (typeof STAFFING_CREATION_SOURCE_REGISTRY)[number];

export const STAFFING_OPERATIONAL_HEALTH_REGISTRY = [
  "unplanned",
  "open",
  "under_minimum",
  "minimum_met",
  "fully_staffed",
  "fragile",
  "overstaffed"
] as const;

export type StaffingOperationalHealth = (typeof STAFFING_OPERATIONAL_HEALTH_REGISTRY)[number];

export const STAFFING_ASSIGNMENT_LIFECYCLE_REGISTRY = [
  "draft",
  "open",
  "assigned",
  "active",
  "completed",
  "cancelled"
] as const;

export type StaffingAssignmentLifecycle = (typeof STAFFING_ASSIGNMENT_LIFECYCLE_REGISTRY)[number];

export type StaffingHealthEvaluation = {
  state: StaffingOperationalHealth;
  cleanForReady: boolean;
  displayLabel: string;
  hardBlockers: string[];
  warnings: string[];
};

export function humanizeStaffingCreationSource(source: StaffingCreationSource | string | null | undefined) {
  const normalized = String(source ?? "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "manual_from_shoot":
      return "Manual From Shoot";
    case "template_from_shoot_type":
      return "Template From Shoot Type";
    case "copied_from_prior_shoot":
      return "Copied From Prior Shoot";
    case "bulk_created":
      return "Bulk Created";
    case "legacy_fallback":
      return "Legacy Fallback";
    default:
      return normalized
        ? normalized.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase())
        : "Unknown";
  }
}

export function humanizeStaffingOperationalHealth(state: StaffingOperationalHealth | string | null | undefined) {
  const normalized = String(state ?? "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "unplanned":
      return "Unplanned";
    case "open":
      return "Open";
    case "under_minimum":
      return "Under Minimum";
    case "minimum_met":
      return "Minimum Met";
    case "fully_staffed":
      return "Fully Staffed";
    case "fragile":
      return "Fragile";
    case "overstaffed":
      return "Overstaffed";
    default:
      return normalized
        ? normalized.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase())
        : "Unknown";
  }
}

export function mapShiftStatusToStaffingAssignmentLifecycle(input: {
  rawStatus: string | null | undefined;
  startsAt?: string | null;
  endsAt?: string | null;
  now?: Date;
}): StaffingAssignmentLifecycle {
  const normalized = String(input.rawStatus ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "cancelled") {
    return "cancelled";
  }
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "draft") {
    return "draft";
  }

  const now = input.now ?? new Date();
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;

  if (startsAt && endsAt && now.getTime() >= startsAt.getTime() && now.getTime() < endsAt.getTime()) {
    return "active";
  }

  return "assigned";
}

export function evaluateOperationalStaffingHealth(input: {
  requirementCount: number;
  assignedStaffCount: number;
  idealStaffCount: number;
  minimumStaffCount: number;
  openSlotCount: number;
  conflictWarningCount: number;
  unpublishedAssignedCount: number;
  fragileCoverage: boolean;
  validation: StaffingValidationResult | null;
  hardBlockers?: string[];
  warnings?: string[];
}): StaffingHealthEvaluation {
  const hardBlockers = [...(input.hardBlockers ?? [])];
  const warnings = [...(input.warnings ?? [])];
  const validationFailed = input.validation ? !input.validation.staffingValidationPassed : false;

  if (input.requirementCount === 0 && input.idealStaffCount === 0 && input.minimumStaffCount === 0) {
    return {
      state: "unplanned",
      cleanForReady: false,
      displayLabel: "Unplanned",
      hardBlockers: [...new Set(hardBlockers)],
      warnings: [...new Set(warnings)]
    };
  }

  if (input.assignedStaffCount === 0) {
    return {
      state: "open",
      cleanForReady: false,
      displayLabel: "Open",
      hardBlockers: [...new Set(hardBlockers)],
      warnings: [...new Set(warnings)]
    };
  }

  if (validationFailed) {
    return {
      state: "under_minimum",
      cleanForReady: false,
      displayLabel: "Under Minimum",
      hardBlockers: [...new Set(hardBlockers)],
      warnings: [...new Set(warnings)]
    };
  }

  if (input.idealStaffCount > 0 && input.assignedStaffCount > input.idealStaffCount) {
    return {
      state: "overstaffed",
      cleanForReady: hardBlockers.length === 0,
      displayLabel: "Overstaffed",
      hardBlockers: [...new Set(hardBlockers)],
      warnings: [...new Set(warnings)]
    };
  }

  if (input.assignedStaffCount < input.idealStaffCount || input.openSlotCount > 0) {
    return {
      state: "minimum_met",
      cleanForReady: hardBlockers.length === 0,
      displayLabel: "Minimum Met",
      hardBlockers: [...new Set(hardBlockers)],
      warnings: [...new Set(warnings)]
    };
  }

  if (input.fragileCoverage || input.conflictWarningCount > 0 || input.unpublishedAssignedCount > 0) {
    return {
      state: "fragile",
      cleanForReady: hardBlockers.length === 0,
      displayLabel: "Fragile",
      hardBlockers: [...new Set(hardBlockers)],
      warnings: [...new Set(warnings)]
    };
  }

  return {
    state: "fully_staffed",
    cleanForReady: hardBlockers.length === 0,
    displayLabel: "Fully Staffed",
    hardBlockers: [...new Set(hardBlockers)],
    warnings: [...new Set(warnings)]
  };
}
