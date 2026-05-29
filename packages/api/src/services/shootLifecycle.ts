import { hasAuthorityTier, hasJobFunctionProfile } from "../authz/authority.js";
import type { Role } from "../domain/auth/role.js";
import type { ShootStatus } from "../domain/lifecycle/index.js";
import type { AuthUser } from "../types/auth.js";

export const SHOOT_POST_PRODUCTION_SUBSTAGE_REGISTRY = [
  "INTAKE_PENDING",
  "ASSETS_RECEIVED",
  "EDITING_PROCESSING",
  "GRAPHICS_PACKAGING",
  "UPLOAD_DELIVERY_PREP",
  "QA_REVIEW",
  "CORRECTION_NEEDED",
  "READY_TO_RELEASE"
] as const;

export type ShootPostProductionSubstage = (typeof SHOOT_POST_PRODUCTION_SUBSTAGE_REGISTRY)[number];

export const SHOOT_POST_PRODUCTION_SUBSTAGE_LABELS: Record<ShootPostProductionSubstage, string> = {
  INTAKE_PENDING: "Intake Pending",
  ASSETS_RECEIVED: "Assets Received",
  EDITING_PROCESSING: "Editing / Processing",
  GRAPHICS_PACKAGING: "Graphics / Packaging",
  UPLOAD_DELIVERY_PREP: "Upload / Delivery Prep",
  QA_REVIEW: "QA Review",
  CORRECTION_NEEDED: "Correction Needed",
  READY_TO_RELEASE: "Ready to Release"
};

export type ShootOperationalFlagTone = "neutral" | "heads_up" | "action_needed" | "good";

export type ShootOperationalFlagCode =
  | "overdue"
  | "due_in_24_hours"
  | "missing_lead"
  | "understaffed"
  | "late_arrival"
  | "missing_clock_in"
  | "wrong_location_clock_in"
  | "roster_data_missing"
  | "media_missing"
  | "production_blocked"
  | "qa_failed"
  | "customer_follow_up_needed"
  | "big_shoot"
  | "critical_shoot";

export interface ShootOperationalFlag {
  code: ShootOperationalFlagCode;
  label: string;
  tone: ShootOperationalFlagTone;
}

export interface ShootReadinessRequirement {
  key:
    | "lead_assigned"
    | "minimum_staffing_met"
    | "location_schedule_confirmed"
    | "contact_present"
    | "pre_service_notes_complete"
    | "special_deliverables_documented"
    | "gear_requirements_assigned"
    | "roster_data_ready";
  label: string;
  passed: boolean;
  required: boolean;
}

export interface ShootReadinessEvaluation {
  readyEligible: boolean;
  summaryLabel: string;
  requirements: ShootReadinessRequirement[];
  blockingRequirementKeys: ShootReadinessRequirement["key"][];
}

type ShootLifecycleSnapshot = Record<string, unknown>;

function normalizeNullableText(value: unknown) {
  if (typeof value !== "string") {
    return value == null ? null : String(value).trim() || null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  return Boolean(value);
}

function hasText(value: unknown) {
  return Boolean(normalizeNullableText(value));
}

export function normalizeShootStatusValue(value: unknown): ShootStatus | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/canceled/g, "cancelled");

  switch (normalized) {
    case "draft":
    case "planning":
      return "DRAFT";
    case "tentative":
      return "TENTATIVE";
    case "confirmed":
    case "scheduled":
    case "staffing_in_progress":
    case "staffed":
      return "CONFIRMED";
    case "ready":
    case "ready_for_shoot":
      return "READY";
    case "live":
    case "in_progress":
      return "LIVE";
    case "shoot_complete":
    case "wrapped":
      return "SHOOT_COMPLETE";
    case "post_production":
    case "in_post_production":
      return "POST_PRODUCTION";
    case "complete":
    case "completed":
    case "delivered":
    case "closed":
    case "archived":
      return "COMPLETE";
    case "on_hold":
    case "hold":
      return "ON_HOLD";
    case "cancelled":
      return "CANCELLED";
    default:
      return null;
  }
}

export function humanizeShootStatus(status: ShootStatus | string | null | undefined) {
  const normalized = normalizeShootStatusValue(status);
  switch (normalized) {
    case "DRAFT":
      return "Draft";
    case "TENTATIVE":
      return "Tentative";
    case "CONFIRMED":
      return "Confirmed";
    case "READY":
      return "Ready";
    case "LIVE":
      return "Live";
    case "SHOOT_COMPLETE":
      return "Shot Complete";
    case "POST_PRODUCTION":
      return "Post-Production";
    case "COMPLETE":
      return "Complete";
    case "ON_HOLD":
      return "On Hold";
    case "CANCELLED":
      return "Cancelled";
    default:
      return typeof status === "string" && status.trim().length
        ? status
            .replace(/_/g, " ")
            .replace(/\b\w/g, (match) => match.toUpperCase())
        : "Unknown";
  }
}

export function normalizePostProductionSubstageValue(value: unknown): ShootPostProductionSubstage | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/\//g, "_")
    .replace(/&/g, "AND")
    .replace(/-+/g, "_");

  return (SHOOT_POST_PRODUCTION_SUBSTAGE_REGISTRY as readonly string[]).includes(normalized)
    ? (normalized as ShootPostProductionSubstage)
    : null;
}

export function humanizePostProductionSubstage(value: ShootPostProductionSubstage | string | null | undefined) {
  const normalized = normalizePostProductionSubstageValue(value);
  return normalized ? SHOOT_POST_PRODUCTION_SUBSTAGE_LABELS[normalized] : null;
}

export function isShootTerminalStatus(status: unknown) {
  const normalized = normalizeShootStatusValue(status);
  return normalized === "COMPLETE" || normalized === "CANCELLED";
}

export function isShootFinishedOnSite(status: unknown) {
  const normalized = normalizeShootStatusValue(status);
  return normalized === "SHOOT_COMPLETE" || normalized === "POST_PRODUCTION" || normalized === "COMPLETE";
}

export function isShootOperationallyComplete(status: unknown) {
  return isShootTerminalStatus(status);
}

export function deriveShootLifecycleRoles(auth: AuthUser): Role[] {
  const roles = new Set<Role>();

  if (auth.authorityTier === "super_admin") {
    roles.add("super_admin");
    roles.add("leadership");
    roles.add("director_admin");
  }
  if (auth.authorityTier === "leadership") {
    roles.add("leadership");
  }
  if (auth.authorityTier === "director_admin") {
    roles.add("director_admin");
  }
  if (auth.authorityTier === "supervisor") {
    roles.add("assistant_manager");
  }
  if (auth.authorityTier === "read_only_viewer") {
    roles.add("read_only_viewer");
  }

  if (
    auth.roles.includes("photographer") ||
    auth.roles.includes("associate_photographer") ||
    auth.roles.includes("senior_photographer") ||
    hasJobFunctionProfile(auth, [
      "associate_photographer",
      "seasonal_photographer",
      "part_time_photographer",
      "senior_photographer"
    ])
  ) {
    roles.add("photographer");
  }

  if (
    auth.roles.includes("office_employee") &&
    hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"])
  ) {
    roles.add("staffing_coordinator");
  }

  if (hasJobFunctionProfile(auth, "graphic_artist")) {
    roles.add("graphic_artist");
  }

  if (hasJobFunctionProfile(auth, "customer_service_rep")) {
    roles.add("customer_service");
  }

  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    roles.add("integration_service");
  }

  return [...roles];
}

export function evaluateShootReadiness(snapshot: ShootLifecycleSnapshot): ShootReadinessEvaluation {
  const requiredLeadCount = Math.max(numericValue(snapshot.required_lead_count), 1);
  const minimumStaffCount = Math.max(numericValue(snapshot.minimum_staff_count), numericValue(snapshot.planned_staff_count));
  const scheduledEmployeeCount = Math.max(
    numericValue(snapshot.scheduled_employee_count),
    numericValue(snapshot.assigned_staff_count)
  );
  const leadCoverageCount = numericValue(snapshot.lead_coverage_count);
  const minimumStaffThreshold = Math.max(minimumStaffCount, requiredLeadCount);
  const rosterRequired =
    booleanValue(snapshot.roster_data_required) ||
    ["schools_underclass_portraits", "schools_events"].includes(String(snapshot.shoot_type ?? ""));
  const specialDeliverablesRequired =
    booleanValue(snapshot.additional_products_flag) || hasText(snapshot.additional_products);
  const gearRequirementsRequired =
    booleanValue(snapshot.special_equipment_flag) || hasText(snapshot.special_equipment);

  const requirements: ShootReadinessRequirement[] = [
    {
      key: "lead_assigned",
      label: "Lead assigned",
      passed: leadCoverageCount >= requiredLeadCount,
      required: true
    },
    {
      key: "minimum_staffing_met",
      label: "Minimum staffing met",
      passed: minimumStaffThreshold === 0 ? true : scheduledEmployeeCount >= minimumStaffThreshold,
      required: true
    },
    {
      key: "location_schedule_confirmed",
      label: "Location and schedule confirmed",
      passed:
        (hasText(snapshot.location_name) || hasText(snapshot.location_address)) &&
        hasText(snapshot.arrival_time) &&
        hasText(snapshot.start_time) &&
        hasText(snapshot.end_time_est),
      required: true
    },
    {
      key: "contact_present",
      label: "Account or school contact present",
      passed: hasText(snapshot.primary_contact_id) || hasText(snapshot.primary_contact_name),
      required: true
    },
    {
      key: "pre_service_notes_complete",
      label: "Pre-service notes complete",
      passed: booleanValue(snapshot.pre_service_notes_complete),
      required: true
    },
    {
      key: "special_deliverables_documented",
      label: "Special deliverables documented",
      passed:
        !specialDeliverablesRequired ||
        booleanValue(snapshot.special_deliverables_ready) ||
        hasText(snapshot.additional_products),
      required: specialDeliverablesRequired
    },
    {
      key: "gear_requirements_assigned",
      label: "Gear requirements assigned",
      passed:
        !gearRequirementsRequired ||
        booleanValue(snapshot.gear_requirements_ready) ||
        hasText(snapshot.special_equipment),
      required: gearRequirementsRequired
    },
    {
      key: "roster_data_ready",
      label: "Roster or data ready",
      passed: !rosterRequired || booleanValue(snapshot.roster_data_ready),
      required: rosterRequired
    }
  ];

  const blockingRequirementKeys = requirements
    .filter((requirement) => requirement.required && !requirement.passed)
    .map((requirement) => requirement.key);

  return {
    readyEligible: blockingRequirementKeys.length === 0,
    summaryLabel:
      blockingRequirementKeys.length === 0
        ? "Ready Eligible"
        : blockingRequirementKeys.length === 1
          ? "1 readiness item still open"
          : `${blockingRequirementKeys.length} readiness items still open`,
    requirements,
    blockingRequirementKeys
  };
}

export function buildShootOperationalFlags(snapshot: ShootLifecycleSnapshot): ShootOperationalFlag[] {
  const flags: ShootOperationalFlag[] = [];
  const status = normalizeShootStatusValue(snapshot.status);
  const readiness = evaluateShootReadiness(snapshot);
  const priorityLabel = String(snapshot.priority_label ?? snapshot.importance_tier ?? "").trim().toLowerCase();
  const dueAtRaw = normalizeNullableText(snapshot.start_time) ?? normalizeNullableText(snapshot.arrival_time);
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
  const now = new Date();
  const within24Hours = dueAt ? dueAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000 : false;
  const overdue =
    dueAt &&
    dueAt.getTime() < now.getTime() &&
    !["LIVE", "SHOOT_COMPLETE", "POST_PRODUCTION", "COMPLETE", "CANCELLED"].includes(status ?? "");

  if (overdue) {
    flags.push({ code: "overdue", label: "Overdue", tone: "action_needed" });
  } else if (within24Hours && !["LIVE", "SHOOT_COMPLETE", "POST_PRODUCTION", "COMPLETE", "CANCELLED"].includes(status ?? "")) {
    flags.push({ code: "due_in_24_hours", label: "Due in 24 Hours", tone: "heads_up" });
  }

  if (readiness.blockingRequirementKeys.includes("lead_assigned")) {
    flags.push({ code: "missing_lead", label: "Missing Lead", tone: "action_needed" });
  }
  if (readiness.blockingRequirementKeys.includes("minimum_staffing_met")) {
    flags.push({ code: "understaffed", label: "Understaffed", tone: "action_needed" });
  }
  if (readiness.blockingRequirementKeys.includes("roster_data_ready")) {
    flags.push({ code: "roster_data_missing", label: "Roster / Data Missing", tone: "heads_up" });
  }

  if (numericValue(snapshot.late_arrival_count) > 0) {
    flags.push({ code: "late_arrival", label: "Late Arrival", tone: "action_needed" });
  }
  if (numericValue(snapshot.missing_clock_in_count) > 0) {
    flags.push({ code: "missing_clock_in", label: "Missing Clock-In", tone: "action_needed" });
  } else if (
    status === "LIVE" &&
    numericValue(snapshot.scheduled_employee_count) > 0 &&
    numericValue(snapshot.clocked_in_employee_count) < numericValue(snapshot.scheduled_employee_count)
  ) {
    flags.push({ code: "missing_clock_in", label: "Missing Clock-In", tone: "heads_up" });
  }
  if (numericValue(snapshot.wrong_location_count) > 0) {
    flags.push({ code: "wrong_location_clock_in", label: "Wrong Location Clock-In", tone: "action_needed" });
  }

  const substage = normalizePostProductionSubstageValue(snapshot.post_production_substage);
  if (status === "POST_PRODUCTION" && substage === "INTAKE_PENDING") {
    flags.push({ code: "media_missing", label: "Media Missing", tone: "heads_up" });
  }
  if (status === "POST_PRODUCTION" && substage === "CORRECTION_NEEDED") {
    flags.push({ code: "production_blocked", label: "Production Blocked", tone: "action_needed" });
    flags.push({ code: "qa_failed", label: "QA Failed", tone: "action_needed" });
  }

  if (numericValue(snapshot.post_shoot_follow_up_count) > 0) {
    flags.push({ code: "customer_follow_up_needed", label: "Customer Follow-Up Needed", tone: "heads_up" });
  }

  if (priorityLabel === "critical_shoot") {
    flags.push({ code: "critical_shoot", label: "Critical Shoot", tone: "action_needed" });
  } else if (priorityLabel === "big_shoot" || booleanValue(snapshot.big_shoot)) {
    flags.push({ code: "big_shoot", label: "Big Shoot", tone: "heads_up" });
  }

  return flags;
}
