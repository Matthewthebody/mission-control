import type { PoolClient } from "pg";
import { isFieldRole } from "../authz/policy.js";
import {
  canAssignStaffOnLiveShoot,
  canCreateOrEditShootDepartment,
  canViewStrategicShootSignals,
  hasAuthorityTier
} from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import type { OrganizationAccountType } from "../types/organizations.js";
import { buildShootAgreementWarning, getAgreementCoverageByOrganizationIds } from "./agreements.js";
import { assertShootAccess } from "./shootAccess.js";
import {
  beginDangerousAction,
  completeDangerousAction,
  failDangerousAction,
  type DangerousActionCode
} from "./dangerousActions.js";
import { getShootLocationIntelligence } from "./locations.js";
import { buildGoogleMapsLink, estimateDriveMinutesFromStudio } from "./maps.js";
import { getScheduleSyncWriteState } from "./scheduleSync.js";
import { queueWorkShiftOutlookSync } from "./outlookCalendarSync.js";
import {
  buildReadyToShootSummaryFields,
  getShootReadyToShootState,
  type ReadyToShootSummaryFields
} from "./readyToShoot.js";
import {
  evaluateShootPriority,
  humanizePriorityLabel,
  humanizeProfitabilityFlag,
  isBigShootLabel,
  type ShootImportanceTier,
  type ShootProfitabilityFlag
} from "./shootPriority.js";
import { createAuditLog } from "./audit.js";
import { getPublicObjectNoteSignals } from "./operationalNotes.js";
import { triggerProductionProjectFromShootCompletion } from "./productionProjects.js";
import { getShootResourceLibrary } from "./resourceLibrary.js";
import { buildChecklistBlockError, ensureTriggeredChecklistInstances, validateChecklistTargetTransition } from "./jobTruth/checklistService.js";
import { validateShootLifecycleTransition, type ShootLifecycleBlockerEvaluatorRegistry, type ShootStatus } from "../domain/lifecycle/index.js";
import { assertShootStatusApprovalRights, getApprovalLevelLabel } from "./approvalRights.js";
import {
  buildShootOperationalFlags,
  deriveShootLifecycleRoles,
  evaluateShootReadiness,
  humanizePostProductionSubstage,
  humanizeShootStatus,
  isShootFinishedOnSite,
  isShootTerminalStatus,
  normalizePostProductionSubstageValue,
  normalizeShootStatusValue,
  type ShootPostProductionSubstage
} from "./shootLifecycle.js";

type DecoratedPriorityReason = {
  key: string;
  label: string;
  detail: string;
};

type DecoratedShootPriorityFields = {
  importance_score: number;
  importance_tier: ShootImportanceTier;
  importance_tier_display: string;
  importance_calculated_tier: ShootImportanceTier;
  importance_calculated_tier_display: string;
  importance_reasons: DecoratedPriorityReason[];
  importance_override_applied: boolean;
  importance_override_tier: ShootImportanceTier | null;
  importance_override_reason: string | null;
  importance_override_source: "manual_override" | "legacy_big_shoot" | null;
  priority_label: ShootImportanceTier;
  priority_label_display: string;
  priority_weighted_score: number;
  priority_reasons: DecoratedPriorityReason[];
  hard_trigger_count: number;
  big_shoot: boolean;
  future_profitability_flag: ShootProfitabilityFlag | null;
  future_profitability_display: string | null;
  future_profitability_system_flag: ShootProfitabilityFlag | null;
  future_profitability_manual: ShootProfitabilityFlag | null;
  future_profitability_explanation: string | null;
};

type DecoratedShootLifecycleFields = {
  status_display: string;
  normalized_status: ShootStatus | null;
  post_production_substage_display: string | null;
  ready_eligible: boolean;
  readiness_summary: string;
  readiness_requirements: Array<{
    key: string;
    label: string;
    passed: boolean;
    required: boolean;
  }>;
  readiness_blocking_keys: string[];
  operational_flags: Array<{
    code: string;
    label: string;
    tone: "neutral" | "heads_up" | "action_needed" | "good";
  }>;
};

export interface ShootInput {
  studio_id: string;
  organization_id: string;
  location_id: string;
  primary_contact_id: string;
  additional_contact_ids?: string[];
  shoot_type: OrganizationAccountType;
  shoot_subtype?: string | null;
  shoot_code: string;
  title: string;
  shoot_date: string;
  geofence_radius_meters: number;
  showtime?: string | null;
  arrival_time: string;
  start_time: string;
  end_time_est: string;
  projected_students?: number;
  planned_staff_count?: number;
  required_lead_count?: number;
  staffing_template_id?: string | null;
  status?: ShootStatus;
  status_reason?: string | null;
  post_production_substage?: ShootPostProductionSubstage | null;
  operations_priority?: "standard" | "elevated" | "high_priority";
  big_shoot_manual_override?: boolean;
  camera_station_count?: number;
  shoot_structure?: "standard" | "open_house";
  first_year_customer_flag?: boolean;
  flagship_priority_account_flag?: boolean;
  weather_travel_risk_flag?: boolean;
  manual_leadership_boost?: number;
  importance_override_tier?: ShootImportanceTier | null;
  importance_override_reason?: string | null;
  primary_contact_name?: string | null;
  primary_contact_phone?: string | null;
  primary_contact_email?: string | null;
  secondary_contact_name?: string | null;
  secondary_contact_phone?: string | null;
  secondary_contact_email?: string | null;
  special_instructions?: string | null;
  access_notes?: string | null;
  additional_products?: string | null;
  additional_products_flag?: boolean;
  special_equipment?: string | null;
  special_equipment_flag?: boolean;
  setup_notes?: string | null;
  day_of_notes?: string | null;
  internal_notes?: string | null;
  pre_service_notes_complete?: boolean;
  special_deliverables_ready?: boolean;
  gear_requirements_ready?: boolean;
  roster_data_required?: boolean;
  roster_data_ready?: boolean;
  revenue_potential_score?: number | null;
  strategic_district_importance?: boolean;
  account_growth_importance_score?: number | null;
  complexity_score?: number | null;
  customer_history_risk_score?: number | null;
  multi_team_coordination?: boolean;
  readiness_owner_user_id?: string | null;
  future_profitability_manual?: ShootProfitabilityFlag | null;
  future_profitability_reason?: string | null;
  allow_checklist_override?: boolean | null;
  checklist_override_reason?: string | null;
}

export interface ShootListWindow {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
}

type DirectorySelectionRecord = {
  organization: {
    id: string;
    display_name: string;
    account_type: OrganizationAccountType;
  };
  location: {
    id: string;
    organization_id: string | null;
    name: string;
    address: string | null;
    address_line_1: string | null;
    address_line_2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    latitude: number | null;
    longitude: number | null;
    navigation_url: string | null;
    maps_label: string | null;
  };
  primaryContact: {
    id: string;
    organization_id: string;
    full_name: string;
    title: string | null;
    phone: string | null;
    email: string | null;
  };
  additionalContacts: Array<{
    id: string;
    organization_id: string;
    full_name: string;
    title: string | null;
    phone: string | null;
    email: string | null;
  }>;
};

type ShootContactLinkRow = {
  id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
};

function isLiveShoot(shoot: { start_time?: string | null; deleted_at?: string | null }) {
  if (shoot.deleted_at) {
    return false;
  }
  if (!shoot.start_time) {
    return false;
  }
  return new Date(shoot.start_time).getTime() <= Date.now();
}

function mapShootTypeToDepartment(shootType: OrganizationAccountType): DepartmentCode {
  switch (shootType) {
    case "sports":
      return "sports";
    case "schools_underclass_portraits":
    case "schools_events":
      return "schools";
    case "studio":
    case "headshots":
    case "commercial":
      return "production";
    case "internal":
      return "operations";
    case "events":
    default:
      return "operations";
  }
}

function mapShootTypeToCategory(shootType: OrganizationAccountType) {
  switch (shootType) {
    case "sports":
      return "sports" as const;
    case "schools_underclass_portraits":
    case "schools_events":
      return "schools" as const;
    case "studio":
    case "headshots":
      return "studio" as const;
    case "commercial":
    case "internal":
    case "events":
    default:
      return "events" as const;
  }
}

function getChecklistTemplateCodesForShootLifecycle(status: ShootStatus) {
  switch (status) {
    case "LIVE":
      return ["on_site_setup_verification", "end_of_shoot_wrap"];
    default:
      return ["shoot_readiness", "pre_service_meeting"];
  }
}

function buildCanonicalLocationAddress(location: DirectorySelectionRecord["location"]) {
  const parts = [
    location.address_line_1,
    location.address_line_2,
    [location.city, location.state].filter(Boolean).join(", "),
    location.zip
  ]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : (location.address?.trim() ?? null);
}

function normalizeAdditionalContactIds(ids: string[] | undefined) {
  return [...new Set((ids ?? []).filter(Boolean))];
}

function assertShootMutationAllowed(auth: AuthUser, department: DepartmentCode, isLive = false) {
  if (!canCreateOrEditShootDepartment(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
  if (isLive && !canAssignStaffOnLiveShoot(auth)) {
    throw new ApiError(403, "Only directors and leadership can edit a live shoot");
  }
}

const STRATEGIC_EDIT_FIELDS = [
  "operations_priority",
  "big_shoot_manual_override",
  "camera_station_count",
  "shoot_structure",
  "first_year_customer_flag",
  "flagship_priority_account_flag",
  "weather_travel_risk_flag",
  "manual_leadership_boost",
  "importance_override_tier",
  "importance_override_reason",
  "revenue_potential_score",
  "strategic_district_importance",
  "account_growth_importance_score",
  "complexity_score",
  "customer_history_risk_score",
  "multi_team_coordination",
  "readiness_owner_user_id",
  "future_profitability_manual",
  "future_profitability_reason"
] as const;

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

function toNormalizedShootStatus(value: unknown, fallback: ShootStatus = "DRAFT"): ShootStatus {
  return normalizeShootStatusValue(value) ?? fallback;
}

function toNormalizedPostProductionSubstage(value: unknown): ShootPostProductionSubstage | null {
  return normalizePostProductionSubstageValue(value);
}

function defaultPostProductionSubstage(status: ShootStatus, current: ShootPostProductionSubstage | null) {
  if (status !== "POST_PRODUCTION") {
    return status === "COMPLETE" ? current : null;
  }
  return current ?? "INTAKE_PENDING";
}

function buildShootLifecycleSnapshot(
  current: Record<string, unknown> | null,
  patch: Partial<ShootInput> = {}
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    ...patch,
    status:
      Object.prototype.hasOwnProperty.call(patch, "status") && patch.status != null
        ? patch.status
        : current?.status ?? "DRAFT",
    post_production_substage: Object.prototype.hasOwnProperty.call(patch, "post_production_substage")
      ? patch.post_production_substage
      : current?.post_production_substage ?? null,
    status_reason: Object.prototype.hasOwnProperty.call(patch, "status_reason")
      ? patch.status_reason
      : current?.status_reason ?? null
  };
}

function buildShootTransitionBlockerRegistry(
  snapshot: Record<string, unknown>,
  options: {
    allowReadinessOverride?: boolean;
  } = {}
): ShootLifecycleBlockerEvaluatorRegistry {
  return {
    ready_eligibility_guard: {
      evaluatorKey: "ready_eligibility_guard",
      evaluate: () => {
        const readiness = evaluateShootReadiness(snapshot);
        return readiness.readyEligible
          ? {
              evaluatorKey: "ready_eligibility_guard",
              outcome: "clear",
              blockerCode: null,
              message: null
            }
          : {
              evaluatorKey: "ready_eligibility_guard",
              outcome: options.allowReadinessOverride ? "warning" : "hard_blocker",
              blockerCode: options.allowReadinessOverride ? "ready_override_required" : "not_ready_eligible",
              message: options.allowReadinessOverride
                ? `Manager approval override: ${readiness.summaryLabel}`
                : readiness.summaryLabel,
              metadata: {
                blockingRequirementKeys: readiness.blockingRequirementKeys,
                overrideApplied: Boolean(options.allowReadinessOverride)
              }
            };
      }
    },
    completion_readiness_guard: {
      evaluatorKey: "completion_readiness_guard",
      evaluate: () => {
        const substage = toNormalizedPostProductionSubstage(snapshot.post_production_substage);
        return substage === "READY_TO_RELEASE"
          ? {
              evaluatorKey: "completion_readiness_guard",
              outcome: "clear",
              blockerCode: null,
              message: null
            }
          : {
              evaluatorKey: "completion_readiness_guard",
              outcome: "hard_blocker",
              blockerCode: "post_production_not_ready_to_release",
              message: "Move post-production to Ready to Release before marking the shoot complete.",
              metadata: {
                postProductionSubstage: substage
              }
            };
      }
    }
  };
}

function mapShootTransitionError(result: ReturnType<typeof validateShootLifecycleTransition>) {
  switch (result.denialReason) {
    case "actor_not_allowed":
      return new ApiError(403, "You do not have permission to make that shoot status change.");
    case "reason_required":
      return new ApiError(400, "A reason is required for that shoot status change.");
    case "terminal_status_locked":
      return new ApiError(409, "This shoot is in a terminal state and cannot move that way.");
    case "blocked_by_evaluator":
      return new ApiError(
        409,
        result.hardBlockers[0]?.message ?? "That shoot cannot move to the requested status yet."
      );
    case "approval_required":
      return new ApiError(428, "That shoot transition still requires approval.");
    case "transition_not_found":
    default:
      return new ApiError(400, "That shoot status change is not allowed.");
  }
}

function hasSpecialtyRequirements(row: Record<string, unknown>) {
  return (
    Boolean(row.additional_products_flag) ||
    Boolean(row.special_equipment_flag) ||
    Boolean(normalizeNullableText(row.additional_products)) ||
    Boolean(normalizeNullableText(row.special_equipment)) ||
    Boolean(row.multi_team_coordination)
  );
}

function countMissingRequiredPrepItems(row: Record<string, unknown>) {
  let missingCount = 0;

  if (!normalizeNullableText(row.arrival_time)) {
    missingCount += 1;
  }
  if (!normalizeNullableText(row.start_time)) {
    missingCount += 1;
  }
  if (!normalizeNullableText(row.end_time_est)) {
    missingCount += 1;
  }
  if (!normalizeNullableText(row.location_name) && !normalizeNullableText(row.location_address)) {
    missingCount += 1;
  }
  if (!normalizeNullableText(row.primary_contact_name) && !row.primary_contact_id) {
    missingCount += 1;
  }
  if (hasSpecialtyRequirements(row) && !normalizeNullableText(row.setup_notes) && !normalizeNullableText(row.day_of_notes)) {
    missingCount += 1;
  }

  return missingCount;
}

function resolveAssignedStaffCount(row: Record<string, unknown>) {
  return Math.max(
    numericValue(row.assigned_staff_count),
    numericValue(row.scheduled_employee_count),
    numericValue(row.scheduled_staff_count)
  );
}

function resolveImportanceOverrideFields(
  current: Record<string, unknown> | null,
  patch: Partial<ShootInput>,
  auth: AuthUser
) {
  const hasTier = Object.prototype.hasOwnProperty.call(patch, "importance_override_tier");
  const hasLegacyOverride = Object.prototype.hasOwnProperty.call(patch, "big_shoot_manual_override");
  const hasReason = Object.prototype.hasOwnProperty.call(patch, "importance_override_reason");

  const currentTier = (current?.importance_override_tier as ShootImportanceTier | null | undefined) ?? null;
  const currentReason = normalizeNullableText(current?.importance_override_reason);
  const currentAt = (current?.importance_override_at as string | null | undefined) ?? null;
  const currentBy = (current?.importance_override_by_user_id as string | null | undefined) ?? null;

  let nextTier = currentTier;
  if (hasTier) {
    nextTier = patch.importance_override_tier ?? null;
  } else if (hasLegacyOverride) {
    nextTier = patch.big_shoot_manual_override ? "big_shoot" : null;
  }

  if (hasReason && nextTier == null && normalizeNullableText(patch.importance_override_reason)) {
    throw new ApiError(400, "An override reason only applies when a manual shoot importance designation is set.");
  }

  let nextReason = currentReason;
  if (nextTier == null) {
    nextReason = null;
  } else if (hasReason) {
    nextReason = normalizeNullableText(patch.importance_override_reason);
  } else if ((hasTier || hasLegacyOverride) && nextTier !== currentTier) {
    nextReason = null;
  }

  if (nextTier != null && !nextReason) {
    throw new ApiError(400, "Manual shoot importance overrides require a reason.");
  }

  const changed = nextTier !== currentTier || nextReason !== currentReason;

  return {
    importance_override_tier: nextTier,
    importance_override_reason: nextReason,
    importance_override_at: nextTier == null ? null : changed ? new Date().toISOString() : currentAt,
    importance_override_by_user_id: nextTier == null ? null : changed ? auth.id : currentBy,
    big_shoot_manual_override: nextTier != null,
    changed,
    before: {
      importance_override_tier: currentTier,
      importance_override_reason: currentReason
    },
    after: {
      importance_override_tier: nextTier,
      importance_override_reason: nextReason
    }
  };
}

function assertStrategicFieldsEditable(auth: AuthUser, patch: Partial<ShootInput>) {
  const touchesStrategicFields = STRATEGIC_EDIT_FIELDS.some((field) => field in patch);
  if (!touchesStrategicFields) {
    return;
  }
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Only leadership and directors can edit shoot business-value signals.");
  }
}

function toPriorityInput(row: Record<string, unknown>) {
  const assignedStaffCount = resolveAssignedStaffCount(row);
  const plannedStaffCount = numericValue(row.planned_staff_count);

  return {
    projectedHeadcount: numericValue(row.projected_students),
    photographerHeadcount: numericValue(row.template_photographer_count),
    assignedStaffCount,
    plannedStaffCount,
    estimatedDriveMinutes: row.estimated_drive_minutes == null ? null : numericValue(row.estimated_drive_minutes),
    cameraStationCount:
      row.camera_station_count == null ? Math.max(numericValue(row.template_photographer_count), 1) : numericValue(row.camera_station_count),
    shootStructure: (row.shoot_structure as "standard" | "open_house" | null | undefined) ?? "standard",
    hasSpecialtyRequirements: hasSpecialtyRequirements(row),
    firstYearCustomerFlag: Boolean(row.first_year_customer_flag),
    flagshipPriorityAccountFlag: Boolean(row.flagship_priority_account_flag),
    strategicDistrictImportance: Boolean(row.strategic_district_importance),
    revenuePotentialScore: row.revenue_potential_score == null ? null : numericValue(row.revenue_potential_score),
    accountGrowthImportanceScore:
      row.account_growth_importance_score == null ? null : numericValue(row.account_growth_importance_score),
    complexityScore: row.complexity_score == null ? null : numericValue(row.complexity_score),
    customerHistoryRiskScore:
      row.customer_history_risk_score == null ? null : numericValue(row.customer_history_risk_score),
    priorMajorIssueExists: Boolean(row.prior_major_issue_exists),
    multiTeamCoordination: Boolean(row.multi_team_coordination),
    missingStaffingCoverageCount: Math.max(plannedStaffCount - assignedStaffCount, 0),
    missingRequiredPrepCount: countMissingRequiredPrepItems(row),
    weatherTravelRiskFlag: Boolean(row.weather_travel_risk_flag),
    manualLeadershipBoost: row.manual_leadership_boost == null ? null : numericValue(row.manual_leadership_boost),
    futureProfitabilityManual: (row.future_profitability_manual as ShootProfitabilityFlag | null | undefined) ?? null,
    operationsPriority: (row.operations_priority as "standard" | "elevated" | "high_priority" | null | undefined) ?? null,
    manualBigShootOverride: Boolean(row.big_shoot_manual_override),
    importanceOverrideTier: (row.importance_override_tier as ShootImportanceTier | null | undefined) ?? null,
    importanceOverrideReason: normalizeNullableText(row.importance_override_reason)
  };
}

function decorateShootRow<T extends Record<string, unknown>>(
  row: T,
  auth: AuthUser
): T & DecoratedShootPriorityFields & DecoratedShootLifecycleFields & ReadyToShootSummaryFields {
  const priority = evaluateShootPriority(toPriorityInput(row));
  const readiness = evaluateShootReadiness(row);
  const normalizedStatus = normalizeShootStatusValue(row.status);
  const postProductionSubstage = normalizePostProductionSubstageValue(row.post_production_substage);
  const operationalFlags = buildShootOperationalFlags({
    ...row,
    priority_label: priority.priorityLabel
  });
  const readyToShoot = buildReadyToShootSummaryFields(row);
  return {
    ...row,
    ...readyToShoot,
    importance_score: priority.weightedScore,
    importance_tier: priority.priorityLabel,
    importance_tier_display: humanizePriorityLabel(priority.priorityLabel),
    importance_calculated_tier: priority.calculatedLabel,
    importance_calculated_tier_display: humanizePriorityLabel(priority.calculatedLabel),
    importance_reasons: priority.reasons.map((reason) => ({
      key: reason.key,
      label: reason.label,
      detail: reason.detail
    })),
    importance_override_applied: priority.override.applied,
    importance_override_tier: priority.override.label,
    importance_override_reason: priority.override.reason,
    importance_override_source: priority.override.source,
    priority_label: priority.priorityLabel,
    priority_label_display: humanizePriorityLabel(priority.priorityLabel),
    priority_weighted_score: priority.weightedScore,
    priority_reasons: priority.reasons.map((reason) => ({
      key: reason.key,
      label: reason.label,
      detail: reason.detail
    })),
    hard_trigger_count: priority.hardTriggerCount,
    big_shoot: isBigShootLabel(priority.priorityLabel),
    status_display: humanizeShootStatus(normalizedStatus),
    normalized_status: normalizedStatus,
    post_production_substage_display: humanizePostProductionSubstage(postProductionSubstage),
    ready_eligible: readiness.readyEligible,
    readiness_summary: readiness.summaryLabel,
    readiness_requirements: readiness.requirements,
    readiness_blocking_keys: readiness.blockingRequirementKeys,
    operational_flags: operationalFlags,
    ...(canViewStrategicShootSignals(auth)
      ? {
          future_profitability_flag: priority.profitability.finalFlag,
          future_profitability_display: humanizeProfitabilityFlag(priority.profitability.finalFlag),
          future_profitability_system_flag: priority.profitability.systemFlag,
          future_profitability_manual: priority.profitability.manualOverride,
          future_profitability_explanation: priority.profitability.explanation
        }
      : {
          future_profitability_flag: null,
          future_profitability_display: null,
          future_profitability_system_flag: null,
          future_profitability_manual: null,
          future_profitability_explanation: null
        })
  };
}

async function getShootPriorityContextRow(client: PoolClient, shootId: string) {
  const { rows } = await client.query(
    `
      SELECT
        s.*,
        COALESCE(
          (
            SELECT SUM(str.headcount)
            FROM staffing_template_role str
            WHERE str.staffing_template_id = s.staffing_template_id
              AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
          ),
          0
        ) AS template_photographer_count,
        EXISTS (
          SELECT 1
          FROM shoot_location_link sl
          JOIN post_shoot_evaluation pse
            ON pse.location_id = sl.location_id
           AND pse.tenant_id = sl.tenant_id
          WHERE sl.tenant_id = s.tenant_id
            AND sl.shoot_id = s.id
            AND (
              pse.overall_rating <= 2
              OR pse.on_time = 'No'
              OR pse.easy_access = 'No'
              OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
            )
        ) AS prior_major_issue_exists
      FROM shoot s
      WHERE s.id = $1
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [shootId]
  );
  return rows[0] ?? null;
}

type ShootLifecyclePatchResolution = {
  status: ShootStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by_user_id: string | null;
  on_hold_return_status: ShootStatus | null;
  post_production_substage: ShootPostProductionSubstage | null;
  transitionChanged: boolean;
  transitionKey: string | null;
  transitionDirection: "forward" | "rollback" | "reopen" | null;
  approvalLevel: 1 | 2 | 3;
  approvalRoleGroup: string;
  readinessOverrideApplied: boolean;
  dangerousActionExecutionId: string | null;
  dangerousActionCode: DangerousActionCode | null;
  readyEligible: boolean;
};

async function resolveShootLifecyclePatch(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  currentRow: Record<string, unknown>,
  patch: Partial<ShootInput>
): Promise<ShootLifecyclePatchResolution> {
  const currentStatus = toNormalizedShootStatus(currentRow.status, "DRAFT");
  const nextStatus = Object.prototype.hasOwnProperty.call(patch, "status")
    ? toNormalizedShootStatus(patch.status, currentStatus)
    : currentStatus;
  const currentPostProductionSubstage = toNormalizedPostProductionSubstage(currentRow.post_production_substage);
  const requestedPostProductionSubstage = Object.prototype.hasOwnProperty.call(patch, "post_production_substage")
    ? toNormalizedPostProductionSubstage(patch.post_production_substage)
    : currentPostProductionSubstage;
  const nextPostProductionSubstage = defaultPostProductionSubstage(nextStatus, requestedPostProductionSubstage);
  const nextStatusReason = Object.prototype.hasOwnProperty.call(patch, "status_reason")
    ? normalizeNullableText(patch.status_reason)
    : normalizeNullableText(currentRow.status_reason);
  const priorHoldReturnStatus = normalizeShootStatusValue(currentRow.on_hold_return_status);
  let dangerousActionExecutionId: string | null = null;
  let dangerousActionCode: DangerousActionCode | null = null;

  const lifecycleSnapshot = buildShootLifecycleSnapshot(currentRow, {
    ...patch,
    status: nextStatus,
    status_reason: nextStatusReason,
    post_production_substage: nextPostProductionSubstage
  });
  const readiness = evaluateShootReadiness(lifecycleSnapshot);
  const allowReadinessOverride = currentStatus === "CONFIRMED" && nextStatus === "READY" && !readiness.readyEligible;

  if (currentStatus === "ON_HOLD" && nextStatus !== currentStatus && nextStatus !== priorHoldReturnStatus) {
    throw new ApiError(400, "On Hold shoots can only return to their prior active status.");
  }

  let transitionKey: string | null = null;
  let transitionDirection: "forward" | "rollback" | "reopen" | null = null;
  if (nextStatus !== currentStatus) {
    const validation = validateShootLifecycleTransition(
      {
        currentStatus,
        targetStatus: nextStatus,
        actorRoles: deriveShootLifecycleRoles(auth),
        reason: nextStatusReason
      },
      {
        transitionContext: {
          shootId,
          tenantId: auth.tenantId,
          metadata: {
            onHoldReturnStatus: priorHoldReturnStatus,
            postProductionSubstage: nextPostProductionSubstage
          }
        },
        blockerEvaluatorRegistry: buildShootTransitionBlockerRegistry(lifecycleSnapshot, {
          allowReadinessOverride
        })
      }
    );

    if (!validation.allowed) {
      throw mapShootTransitionError(validation);
    }

    transitionKey = validation.matchedTransition?.transitionKey ?? null;
    transitionDirection = validation.matchedTransition?.transitionDirection ?? null;

    const approvalDecision = await assertShootStatusApprovalRights(client, auth, {
      shootId,
      currentStatus,
      nextStatus,
      readyEligible: readiness.readyEligible,
      reason: nextStatusReason
    });

    const checklistDepartmentType =
      currentRow.department === "schools"
        ? "schools"
        : currentRow.department === "sports"
          ? "sports"
          : "other";
    const checklistValidation = await validateChecklistTargetTransition(client, auth, {
      resource_type: "shoot",
      from_stage: currentStatus,
      to_stage: nextStatus,
      department_type: checklistDepartmentType,
      shoot_id: shootId,
      allow_soft_override: patch.allow_checklist_override ?? false,
      override_reason: normalizeNullableText(patch.checklist_override_reason)
    });
    if (!checklistValidation.allowed) {
      throw buildChecklistBlockError(checklistValidation);
    }

    dangerousActionCode =
      approvalDecision.dangerousActionCode ??
      (transitionDirection === "reopen" && currentStatus === "COMPLETE" ? "change_shoot_status_complete" : null);

    if (dangerousActionCode) {
      const dangerousAction = await beginDangerousAction(client, auth, {
        actionCode: dangerousActionCode,
        entityType: "shoot",
        entityId: shootId,
        sourceModule: "shoots",
        reason: nextStatusReason,
        beforeValue: {
          status: currentStatus,
          post_production_substage: currentPostProductionSubstage
        },
        metadata: {
          target_status: nextStatus,
          target_post_production_substage: nextPostProductionSubstage
        }
      });
      dangerousActionExecutionId = dangerousAction.executionId;
    }

    return {
      status: nextStatus,
      status_reason: nextStatusReason,
      status_changed_at: new Date().toISOString(),
      status_changed_by_user_id: auth.id,
      on_hold_return_status:
        String(nextStatus) === "ON_HOLD"
          ? currentStatus
          : currentStatus === "ON_HOLD" && nextStatus !== currentStatus
            ? null
            : normalizeShootStatusValue(currentRow.on_hold_return_status) ?? null,
      post_production_substage: nextPostProductionSubstage,
      transitionChanged: true,
      transitionKey,
      transitionDirection,
      approvalLevel: approvalDecision.approvalLevel,
      approvalRoleGroup: approvalDecision.roleGroup,
      readinessOverrideApplied: approvalDecision.readinessOverrideApplied,
      dangerousActionExecutionId,
      dangerousActionCode,
      readyEligible: readiness.readyEligible
    };
  }

  const currentWasOnHold = currentStatus === "ON_HOLD";
  const nextStatusIsOnHold = String(nextStatus) === "ON_HOLD";

  return {
    status: nextStatus,
    status_reason: nextStatusReason,
    status_changed_at: nextStatus !== currentStatus ? new Date().toISOString() : (currentRow.status_changed_at as string | null) ?? null,
    status_changed_by_user_id: nextStatus !== currentStatus ? auth.id : (currentRow.status_changed_by_user_id as string | null) ?? null,
    on_hold_return_status:
      nextStatusIsOnHold
        ? currentStatus
        : currentWasOnHold && nextStatus !== currentStatus
          ? null
          : (normalizeShootStatusValue(currentRow.on_hold_return_status) ?? null),
    post_production_substage: nextPostProductionSubstage,
    transitionChanged: nextStatus !== currentStatus,
    transitionKey,
    transitionDirection,
    approvalLevel: 1,
    approvalRoleGroup: "standard_employee_staff",
    readinessOverrideApplied: false,
    dangerousActionExecutionId,
    dangerousActionCode,
    readyEligible: readiness.readyEligible
  };
}

async function loadCanonicalDirectorySelection(
  client: PoolClient,
  auth: AuthUser,
  input: Pick<ShootInput, "organization_id" | "location_id" | "primary_contact_id" | "additional_contact_ids">
) {
  const additionalContactIds = normalizeAdditionalContactIds(input.additional_contact_ids);
  const organizationResult = await client.query<DirectorySelectionRecord["organization"]>(
    `
      SELECT id, display_name, account_type
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.organization_id]
  );
  const organization = organizationResult.rows[0];
  if (!organization) {
    throw new ApiError(400, "Select a valid Organization before saving the Shoot.");
  }

  const locationResult = await client.query<DirectorySelectionRecord["location"]>(
    `
      SELECT
        id,
        organization_id,
        name,
        address,
        address_line_1,
        address_line_2,
        city,
        state,
        zip,
        latitude,
        longitude,
        navigation_url,
        maps_label
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.location_id]
  );
  const location = locationResult.rows[0];
  if (!location) {
    throw new ApiError(400, "Select a valid Location before saving the Shoot.");
  }
  if (!location.organization_id || location.organization_id !== organization.id) {
    throw new ApiError(400, "The selected Location does not belong to the selected Organization.");
  }

  const primaryContactResult = await client.query<DirectorySelectionRecord["primaryContact"]>(
    `
      SELECT id, organization_id, full_name, title, phone, email
      FROM organization_contact
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.primary_contact_id]
  );
  const primaryContact = primaryContactResult.rows[0];
  if (!primaryContact) {
    throw new ApiError(400, "Select a valid primary Contact before saving the Shoot.");
  }
  const primaryContactLink = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact_relationship
      WHERE tenant_id = $1
        AND organization_id = $2
        AND contact_id = $3
        AND is_current = true
      LIMIT 1
    `,
    [auth.tenantId, organization.id, primaryContact.id]
  );
  if (primaryContact.organization_id !== organization.id && !primaryContactLink.rows[0]) {
    throw new ApiError(400, "The primary Contact must belong to the selected Organization.");
  }

  if (additionalContactIds.includes(primaryContact.id)) {
    throw new ApiError(400, "The primary Contact cannot also be listed as an additional Contact.");
  }

  let additionalContacts: DirectorySelectionRecord["additionalContacts"] = [];
  if (additionalContactIds.length) {
    const additionalContactsResult = await client.query<DirectorySelectionRecord["additionalContacts"][number]>(
      `
        SELECT id, organization_id, full_name, title, phone, email
        FROM organization_contact
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
        ORDER BY full_name ASC
      `,
      [auth.tenantId, additionalContactIds]
    );
    additionalContacts = additionalContactsResult.rows;
    if (additionalContacts.length !== additionalContactIds.length) {
      throw new ApiError(400, "One or more selected additional Contacts could not be found.");
    }
    const linkedAdditionalContacts = await client.query<{ contact_id: string }>(
      `
        SELECT contact_id
        FROM organization_contact_relationship
        WHERE tenant_id = $1
          AND organization_id = $2
          AND contact_id = ANY($3::uuid[])
          AND is_current = true
      `,
      [auth.tenantId, organization.id, additionalContactIds]
    );
    const linkedAdditionalContactIds = new Set(linkedAdditionalContacts.rows.map((row) => row.contact_id));
    const mismatchedContact = additionalContacts.find(
      (contact) => contact.organization_id !== organization.id && !linkedAdditionalContactIds.has(contact.id)
    );
    if (mismatchedContact) {
      throw new ApiError(400, "Additional Contacts must belong to the selected Organization.");
    }
  }

  return {
    organization,
    location,
    primaryContact,
    additionalContacts
  } satisfies DirectorySelectionRecord;
}

async function syncShootContactLinks(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  primaryContactId: string,
  additionalContactIds: string[]
) {
  await client.query("DELETE FROM shoot_contact_link WHERE tenant_id = $1 AND shoot_id = $2", [auth.tenantId, shootId]);

  await client.query(
    `
      INSERT INTO shoot_contact_link (
        tenant_id,
        shoot_id,
        contact_id,
        contact_role,
        relationship_role,
        is_primary,
        sort_order,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,'primary','day_of',true,0,$4,$4)
    `,
    [auth.tenantId, shootId, primaryContactId, auth.id]
  );

  for (const [index, contactId] of additionalContactIds.entries()) {
    await client.query(
      `
        INSERT INTO shoot_contact_link (
          tenant_id,
          shoot_id,
          contact_id,
          contact_role,
          relationship_role,
          is_primary,
          sort_order,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,$3,'additional','general',false,$4,$5,$5)
      `,
      [auth.tenantId, shootId, contactId, index + 1, auth.id]
    );
  }
}

async function syncShootLocationLink(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId: string;
    shootCode: string;
    title: string;
    locationId: string;
    locationName: string;
  }
) {
  await client.query(
    `
      INSERT INTO shoot_location_link (
        tenant_id,
        shoot_id,
        shoot_code,
        event_subject,
        event_location,
        location_id,
        match_status,
        match_source,
        confidence,
        linked_by_user_id,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,'matched','manual',1,$7,now())
      ON CONFLICT (tenant_id, shoot_id)
      WHERE shoot_id IS NOT NULL
      DO UPDATE SET
        shoot_code = EXCLUDED.shoot_code,
        event_subject = EXCLUDED.event_subject,
        event_location = EXCLUDED.event_location,
        location_id = EXCLUDED.location_id,
        match_status = 'matched',
        match_source = 'manual',
        confidence = EXCLUDED.confidence,
        linked_by_user_id = EXCLUDED.linked_by_user_id,
        updated_at = now()
    `,
    [auth.tenantId, input.shootId, input.shootCode, input.title, input.locationName, input.locationId, auth.id]
  );
}

async function getShootAdditionalContacts(client: PoolClient, tenantId: string, shootId: string) {
  const { rows } = await client.query<ShootContactLinkRow>(
    `
      SELECT oc.id, oc.full_name, oc.title, oc.phone, oc.email
      FROM shoot_contact_link scl
      JOIN organization_contact oc
        ON oc.tenant_id = scl.tenant_id
       AND oc.id = scl.contact_id
      WHERE scl.tenant_id = $1
        AND scl.shoot_id = $2
        AND scl.contact_role = 'additional'
      ORDER BY scl.sort_order ASC, oc.full_name ASC
    `,
    [tenantId, shootId]
  );
  return rows;
}

export async function createShoot(client: PoolClient, auth: AuthUser, input: ShootInput) {
  const directorySelection = await loadCanonicalDirectorySelection(client, auth, input);
  const department = mapShootTypeToDepartment(input.shoot_type);
  const shootCategory = mapShootTypeToCategory(input.shoot_type);
  assertShootMutationAllowed(auth, department, false);
  assertStrategicFieldsEditable(auth, input);
  const importanceOverride = resolveImportanceOverrideFields(null, input, auth);
  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);
  const locationAddress = buildCanonicalLocationAddress(directorySelection.location);
  const navigationUrl = buildGoogleMapsLink({
    latitude: directorySelection.location.latitude,
    longitude: directorySelection.location.longitude,
    address: locationAddress,
    label: directorySelection.location.maps_label ?? directorySelection.location.name
  });
  const estimatedDriveMinutes = estimateDriveMinutesFromStudio(
    directorySelection.location.latitude ?? null,
    directorySelection.location.longitude ?? null
  );
  const primaryContact = directorySelection.primaryContact;
  const firstAdditionalContact = directorySelection.additionalContacts[0] ?? null;
  const initialStatus = toNormalizedShootStatus(input.status, "DRAFT");
  const initialPostProductionSubstage = defaultPostProductionSubstage(
    initialStatus,
    toNormalizedPostProductionSubstage(input.post_production_substage)
  );
  const insertValues = [
    auth.tenantId,
    input.studio_id,
    department,
    input.organization_id,
    input.location_id,
    input.primary_contact_id,
    input.shoot_type,
    input.shoot_subtype ?? null,
    input.shoot_code,
    input.title,
    input.shoot_date,
    directorySelection.location.name,
    locationAddress ?? "",
    directorySelection.location.latitude ?? 44.9778,
    directorySelection.location.longitude ?? -93.2649,
    input.geofence_radius_meters,
    navigationUrl,
    estimatedDriveMinutes,
    shootCategory,
    input.showtime ?? input.arrival_time ?? input.start_time,
    input.arrival_time,
    input.start_time,
    input.end_time_est,
    input.projected_students ?? 0,
    input.planned_staff_count ?? 0,
    input.required_lead_count ?? 1,
    input.staffing_template_id ?? null,
    initialStatus,
    input.status_reason ?? null,
    new Date().toISOString(),
    auth.id,
    null,
    initialPostProductionSubstage,
    input.operations_priority ?? "standard",
    importanceOverride.big_shoot_manual_override,
    input.camera_station_count ?? 1,
    input.shoot_structure ?? "standard",
    input.first_year_customer_flag ?? false,
    input.flagship_priority_account_flag ?? false,
    input.weather_travel_risk_flag ?? false,
    input.manual_leadership_boost ?? 0,
    importanceOverride.importance_override_tier,
    importanceOverride.importance_override_reason,
    importanceOverride.importance_override_at,
    importanceOverride.importance_override_by_user_id,
    primaryContact.full_name,
    primaryContact.phone ?? null,
    primaryContact.email ?? null,
    firstAdditionalContact?.full_name ?? null,
    firstAdditionalContact?.phone ?? null,
    firstAdditionalContact?.email ?? null,
    input.special_instructions ?? null,
    input.access_notes ?? null,
    input.additional_products ?? null,
    input.additional_products_flag ?? Boolean(input.additional_products?.trim()),
    input.special_equipment ?? null,
    input.special_equipment_flag ?? Boolean(input.special_equipment?.trim()),
    input.setup_notes ?? null,
    input.day_of_notes ?? null,
    input.internal_notes ?? null,
    input.pre_service_notes_complete ?? false,
    input.special_deliverables_ready ?? false,
    input.gear_requirements_ready ?? false,
    input.roster_data_required ?? false,
    input.roster_data_ready ?? !(input.roster_data_required ?? false),
    input.revenue_potential_score ?? null,
    input.strategic_district_importance ?? false,
    input.account_growth_importance_score ?? null,
    input.complexity_score ?? null,
    input.customer_history_risk_score ?? null,
    input.multi_team_coordination ?? false,
    input.readiness_owner_user_id ?? null,
    input.future_profitability_manual ?? null,
    input.future_profitability_reason ?? null,
    input.future_profitability_manual ? new Date().toISOString() : null,
    input.future_profitability_manual ? auth.id : null,
    syncState.syncRequired,
    syncState.syncState,
    auth.id
  ];
  const insertPlaceholders = insertValues.map((_, index) => `$${index + 1}`).join(",");
  const { rows } = await client.query(
    `
      INSERT INTO shoot (
        tenant_id, studio_id, department, organization_id, location_id, primary_contact_id, shoot_type, shoot_subtype,
        shoot_code, title, shoot_date, location_name,
        location_address, location_lat, location_lng, geofence_radius_meters, navigation_url, estimated_drive_minutes,
        shoot_category, showtime, arrival_time, start_time, end_time_est, projected_students, planned_staff_count, required_lead_count,
        staffing_template_id, status, status_reason, status_changed_at, status_changed_by_user_id, on_hold_return_status, post_production_substage,
        operations_priority, big_shoot_manual_override, camera_station_count, shoot_structure,
        first_year_customer_flag, flagship_priority_account_flag, weather_travel_risk_flag, manual_leadership_boost,
        importance_override_tier, importance_override_reason, importance_override_at, importance_override_by_user_id,
        primary_contact_name, primary_contact_phone, primary_contact_email,
        secondary_contact_name, secondary_contact_phone, secondary_contact_email,
        special_instructions, access_notes, additional_products, additional_products_flag, special_equipment, special_equipment_flag,
        setup_notes, day_of_notes, internal_notes, pre_service_notes_complete, special_deliverables_ready, gear_requirements_ready, roster_data_required, roster_data_ready,
        revenue_potential_score, strategic_district_importance, account_growth_importance_score,
        complexity_score, customer_history_risk_score, multi_team_coordination, readiness_owner_user_id,
        future_profitability_manual, future_profitability_reason, future_profitability_reviewed_at, future_profitability_reviewed_by,
        schedule_sync_required, schedule_sync_state, created_by
      )
      VALUES (${insertPlaceholders})
      RETURNING *
    `,
    insertValues
  );
  const created = rows[0];
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "shoot.status.created",
    entityType: "shoot",
    entityId: created.id,
    metadata: {
      status: initialStatus,
      status_display: humanizeShootStatus(initialStatus),
      status_reason: input.status_reason ?? null,
      post_production_substage: initialPostProductionSubstage,
      ready_eligible: evaluateShootReadiness(created).readyEligible
    }
  });
  if (importanceOverride.changed && importanceOverride.after.importance_override_tier) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "shoot.importance_override.created",
      entityType: "shoot",
      entityId: created.id,
      metadata: {
        importance_override_tier: importanceOverride.after.importance_override_tier,
        importance_override_reason: importanceOverride.after.importance_override_reason
      }
    });
  }
  await syncShootContactLinks(client, auth, created.id, input.primary_contact_id, normalizeAdditionalContactIds(input.additional_contact_ids));
  await syncShootLocationLink(client, auth, {
    shootId: created.id,
    shootCode: input.shoot_code,
    title: input.title,
    locationId: input.location_id,
    locationName: directorySelection.location.name
  });
  await ensureTriggeredChecklistInstances(client, auth, {
    scope_type: "shoot",
    scope_id: created.id,
    trigger_types: ["shoot_status_transition"],
    template_codes: getChecklistTemplateCodesForShootLifecycle(initialStatus),
    created_from_trigger_key: `shoot:create:${initialStatus}`,
    source_metadata_json: {
      shoot_id: created.id,
      status: initialStatus
    }
  });
  if (initialStatus === "LIVE") {
    await ensureTriggeredChecklistInstances(client, auth, {
      scope_type: "shoot",
      scope_id: created.id,
      trigger_types: ["shoot_complete"],
      template_codes: ["end_of_shoot_wrap"],
      created_from_trigger_key: "shoot:create:live",
      source_metadata_json: {
        shoot_id: created.id,
        status: initialStatus
      }
    });
  }
  return (await getShootSummaryById(client, created.id, auth)) ?? created;
}

export async function listShoots(client: PoolClient, window: ShootListWindow, auth: AuthUser) {
  const { startDate, endDate } = resolveShootWindow(window);
  const fieldFilter = isFieldRole(auth)
    ? `
      AND (
        EXISTS (
          SELECT 1
          FROM shoot_assignment scoped_sa
          WHERE scoped_sa.tenant_id = s.tenant_id
            AND scoped_sa.shoot_id = s.id
            AND scoped_sa.user_id = $4
        )
        OR EXISTS (
          SELECT 1
          FROM work_shift scoped_ws
          WHERE scoped_ws.tenant_id = s.tenant_id
            AND scoped_ws.shoot_id = s.id
            AND scoped_ws.assigned_user_id = $4
            AND scoped_ws.status = 'published'
            AND scoped_ws.cancelled_at IS NULL
        )
      )
    `
    : "";
  const { rows } = await client.query(
    `
      WITH target_shoots AS (
        SELECT s.*
        FROM shoot s
        WHERE s.shoot_date BETWEEN $1 AND $2
          AND s.tenant_id = $3
          AND s.deleted_at IS NULL
          AND s.record_state = 'published'::shoot_record_state
          ${fieldFilter}
      ),
      target_templates AS (
        SELECT DISTINCT staffing_template_id
        FROM target_shoots
        WHERE staffing_template_id IS NOT NULL
      ),
      template_staffing AS (
        SELECT
          str.staffing_template_id,
          SUM(str.headcount)::int AS template_photographer_count
        FROM staffing_template_role str
        JOIN target_templates template
          ON template.staffing_template_id = str.staffing_template_id
        WHERE str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
        GROUP BY str.staffing_template_id
      ),
      additional_contacts AS (
        SELECT
          scl.shoot_id,
          COALESCE(
            json_agg(
              json_build_object(
                'id', oc.id,
                'full_name', oc.full_name,
                'title', oc.title,
                'phone', oc.phone,
                'email', oc.email
              )
              ORDER BY scl.sort_order ASC, oc.full_name ASC
            ),
            '[]'::json
          ) AS additional_contacts,
          COALESCE(array_agg(scl.contact_id ORDER BY scl.sort_order ASC), ARRAY[]::uuid[]) AS additional_contact_ids
        FROM shoot_contact_link scl
        JOIN target_shoots shoot
          ON shoot.id = scl.shoot_id
         AND shoot.tenant_id = scl.tenant_id
        JOIN organization_contact oc
          ON oc.tenant_id = scl.tenant_id
         AND oc.id = scl.contact_id
        WHERE scl.contact_role = 'additional'
        GROUP BY scl.shoot_id
      ),
      prior_major_issues AS (
        SELECT sl.shoot_id, true AS prior_major_issue_exists
        FROM target_shoots shoot
        JOIN shoot_location_link sl
          ON sl.tenant_id = shoot.tenant_id
         AND sl.shoot_id = shoot.id
        JOIN post_shoot_evaluation pse
          ON pse.location_id = sl.location_id
         AND pse.tenant_id = sl.tenant_id
        WHERE
          pse.overall_rating <= 2
          OR pse.on_time = 'No'
          OR pse.easy_access = 'No'
          OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
        GROUP BY sl.shoot_id
      ),
      assignments AS (
        SELECT
          sa.shoot_id,
          COALESCE(
            json_agg(
              json_build_object(
                'user_id', sa.user_id,
                'is_primary', sa.is_primary,
                'email', u.email,
                'full_name', u.full_name
              )
            ),
            '[]'::json
          ) AS assignments
        FROM shoot_assignment sa
        JOIN target_shoots shoot
          ON shoot.id = sa.shoot_id
         AND shoot.tenant_id = sa.tenant_id
        LEFT JOIN app_user u
          ON u.id = sa.user_id
        GROUP BY sa.shoot_id
      ),
      shift_metrics AS (
        SELECT
          ws.shoot_id,
          COUNT(DISTINCT ws.assigned_user_id)::int AS scheduled_employee_count,
          COUNT(*) FILTER (WHERE ws.satisfies_lead_coverage = true)::int AS lead_coverage_count,
          COALESCE(
            string_agg(au.full_name, ', ' ORDER BY au.full_name ASC) FILTER (WHERE ws.satisfies_lead_coverage = true),
            ''
          ) AS lead_names
        FROM work_shift ws
        JOIN target_shoots shoot
          ON shoot.id = ws.shoot_id
        LEFT JOIN app_user au
          ON au.id = ws.assigned_user_id
        WHERE ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
        GROUP BY ws.shoot_id
      ),
      clocked_in_counts AS (
        SELECT
          ws.shoot_id,
          COUNT(DISTINCT sp.user_id)::int AS clocked_in_employee_count
        FROM work_shift ws
        JOIN target_shoots shoot
          ON shoot.id = ws.shoot_id
        JOIN shift_punch sp
          ON sp.shift_id = ws.id
        WHERE sp.direction = 'in'
        GROUP BY ws.shoot_id
      ),
      attendance_open_counts AS (
        SELECT
          ae.shoot_id,
          COUNT(*)::int AS open_attendance_exception_count
        FROM attendance_exception ae
        JOIN target_shoots shoot
          ON shoot.id = ae.shoot_id
        WHERE ae.status = 'open'
        GROUP BY ae.shoot_id
      ),
      alert_open_counts AS (
        SELECT
          a.shoot_id,
          COUNT(*)::int AS open_alert_count
        FROM alert a
        JOIN target_shoots shoot
          ON shoot.id = a.shoot_id
        WHERE a.status = 'open'
        GROUP BY a.shoot_id
      ),
      latest_events AS (
        SELECT DISTINCT ON (se.shoot_id)
          se.shoot_id,
          se.type AS latest_event_type,
          se.captured_at AS latest_event_at,
          se.geofence_status AS latest_event_geofence_status
        FROM status_event se
        JOIN target_shoots shoot
          ON shoot.id = se.shoot_id
        ORDER BY se.shoot_id, se.captured_at DESC, se.created_at DESC
      )
      SELECT
             s.*,
             o.display_name AS organization_display_name,
             o.account_type AS organization_account_type,
             s.location_id,
             COALESCE(sl.name, s.location_name) AS location_name,
             COALESCE(
               NULLIF(sl.address, ''),
               NULLIF(
                 concat_ws(', ', NULLIF(sl.address_line_1, ''), NULLIF(sl.address_line_2, ''), NULLIF(concat_ws(', ', NULLIF(sl.city, ''), NULLIF(sl.state, '')), ''), NULLIF(sl.zip, '')),
                 ''
               ),
               s.location_address
             ) AS location_address,
             COALESCE(sl.latitude, s.location_lat) AS location_lat,
             COALESCE(sl.longitude, s.location_lng) AS location_lng,
             COALESCE(sl.navigation_url, s.navigation_url) AS navigation_url,
             pc.id AS primary_contact_id,
             COALESCE(pc.full_name, s.primary_contact_name) AS primary_contact_name,
             pc.title AS primary_contact_title,
             COALESCE(pc.phone, s.primary_contact_phone) AS primary_contact_phone,
             COALESCE(pc.email, s.primary_contact_email) AS primary_contact_email,
             COALESCE(additional_contacts.additional_contacts, '[]'::json) AS additional_contacts,
             COALESCE(additional_contacts.additional_contact_ids, ARRAY[]::uuid[]) AS additional_contact_ids,
             COALESCE(template_staffing.template_photographer_count, 0) AS template_photographer_count,
             COALESCE(prior_major_issues.prior_major_issue_exists, false) AS prior_major_issue_exists,
             COALESCE(assignments.assignments, '[]'::json) AS assignments,
             COALESCE(shift_metrics.scheduled_employee_count, 0) AS scheduled_employee_count,
             COALESCE(shift_metrics.lead_coverage_count, 0) AS lead_coverage_count,
             COALESCE(shift_metrics.lead_names, '') AS lead_names,
             COALESCE(clocked_in_counts.clocked_in_employee_count, 0) AS clocked_in_employee_count,
             COALESCE(attendance_open_counts.open_attendance_exception_count, 0) AS open_attendance_exception_count,
             COALESCE(alert_open_counts.open_alert_count, 0) AS open_alert_count,
             latest_events.latest_event_type,
             latest_events.latest_event_at,
             latest_events.latest_event_geofence_status,
             ready_confirmer.full_name AS lead_confirmed_ready_by_name
      FROM target_shoots s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact pc
        ON pc.tenant_id = s.tenant_id
       AND pc.id = s.primary_contact_id
      LEFT JOIN app_user ready_confirmer
        ON ready_confirmer.id = s.lead_confirmed_ready_by_user_id
      LEFT JOIN additional_contacts
        ON additional_contacts.shoot_id = s.id
      LEFT JOIN template_staffing
        ON template_staffing.staffing_template_id = s.staffing_template_id
      LEFT JOIN prior_major_issues
        ON prior_major_issues.shoot_id = s.id
      LEFT JOIN assignments
        ON assignments.shoot_id = s.id
      LEFT JOIN shift_metrics
        ON shift_metrics.shoot_id = s.id
      LEFT JOIN clocked_in_counts
        ON clocked_in_counts.shoot_id = s.id
      LEFT JOIN attendance_open_counts
        ON attendance_open_counts.shoot_id = s.id
      LEFT JOIN alert_open_counts
        ON alert_open_counts.shoot_id = s.id
      LEFT JOIN latest_events
        ON latest_events.shoot_id = s.id
      ORDER BY s.shoot_date ASC, s.arrival_time ASC, s.start_time ASC, s.created_at ASC, s.id ASC
    `,
    isFieldRole(auth) ? [startDate, endDate, auth.tenantId, auth.id] : [startDate, endDate, auth.tenantId]
  );
  const noteSignals = await getPublicObjectNoteSignals(
    client,
    auth.tenantId,
    "shoot",
    rows.map((row) => String(row.id))
  );
  const agreementCoverage = await getAgreementCoverageByOrganizationIds(
    client,
    auth.tenantId,
    rows.map((row) => String(row.organization_id ?? "")).filter(Boolean)
  );
  return rows.map((row) => ({
    ...decorateShootRow(row, auth),
    ...buildShootAgreementWarning(
      agreementCoverage.get(String(row.organization_id ?? "")),
      typeof row.shoot_date === "string" ? row.shoot_date : null
    ),
    note_count: noteSignals.get(String(row.id))?.note_count ?? 0,
    pinned_note_count: noteSignals.get(String(row.id))?.pinned_note_count ?? 0,
    post_shoot_follow_up_count: noteSignals.get(String(row.id))?.post_shoot_follow_up_count ?? 0,
    latest_note_preview: noteSignals.get(String(row.id))?.latest_note_preview ?? null
  }));
}

export type ShootProfitabilitySignalRow = {
  id: string;
  title: string;
  shoot_code: string;
  shoot_date: string;
  department: string | null;
  shoot_type: OrganizationAccountType | null;
  future_profitability_flag: ShootProfitabilityFlag | null;
  future_profitability_display: string | null;
  future_profitability_explanation: string | null;
};

export async function listShootProfitabilitySignals(client: PoolClient, window: ShootListWindow, auth: AuthUser) {
  const { startDate, endDate } = resolveShootWindow(window);
  const fieldFilter = isFieldRole(auth)
    ? `
      AND (
        EXISTS (
          SELECT 1
          FROM shoot_assignment scoped_sa
          WHERE scoped_sa.tenant_id = s.tenant_id
            AND scoped_sa.shoot_id = s.id
            AND scoped_sa.user_id = $4
        )
        OR EXISTS (
          SELECT 1
          FROM work_shift scoped_ws
          WHERE scoped_ws.tenant_id = s.tenant_id
            AND scoped_ws.shoot_id = s.id
            AND scoped_ws.assigned_user_id = $4
            AND scoped_ws.status = 'published'
            AND scoped_ws.cancelled_at IS NULL
        )
      )
    `
    : "";
  const { rows } = await client.query(
    `
      WITH target_shoots AS (
        SELECT s.*
        FROM shoot s
        WHERE s.shoot_date BETWEEN $1 AND $2
          AND s.tenant_id = $3
          AND s.deleted_at IS NULL
          AND s.record_state = 'published'::shoot_record_state
          ${fieldFilter}
      ),
      target_templates AS (
        SELECT DISTINCT staffing_template_id
        FROM target_shoots
        WHERE staffing_template_id IS NOT NULL
      ),
      template_staffing AS (
        SELECT
          str.staffing_template_id,
          SUM(str.headcount)::int AS template_photographer_count
        FROM staffing_template_role str
        JOIN target_templates template
          ON template.staffing_template_id = str.staffing_template_id
        WHERE str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
        GROUP BY str.staffing_template_id
      ),
      prior_major_issues AS (
        SELECT sl.shoot_id, true AS prior_major_issue_exists
        FROM target_shoots shoot
        JOIN shoot_location_link sl
          ON sl.tenant_id = shoot.tenant_id
         AND sl.shoot_id = shoot.id
        JOIN post_shoot_evaluation pse
          ON pse.location_id = sl.location_id
         AND pse.tenant_id = sl.tenant_id
        WHERE
          pse.overall_rating <= 2
          OR pse.on_time = 'No'
          OR pse.easy_access = 'No'
          OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
        GROUP BY sl.shoot_id
      ),
      shift_metrics AS (
        SELECT
          ws.shoot_id,
          COUNT(DISTINCT ws.assigned_user_id)::int AS scheduled_employee_count
        FROM work_shift ws
        JOIN target_shoots shoot
          ON shoot.id = ws.shoot_id
        WHERE ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
        GROUP BY ws.shoot_id
      )
      SELECT
        s.*,
        COALESCE(template_staffing.template_photographer_count, 0) AS template_photographer_count,
        COALESCE(prior_major_issues.prior_major_issue_exists, false) AS prior_major_issue_exists,
        COALESCE(shift_metrics.scheduled_employee_count, 0) AS scheduled_employee_count
      FROM target_shoots s
      LEFT JOIN template_staffing
        ON template_staffing.staffing_template_id = s.staffing_template_id
      LEFT JOIN prior_major_issues
        ON prior_major_issues.shoot_id = s.id
      LEFT JOIN shift_metrics
        ON shift_metrics.shoot_id = s.id
      ORDER BY s.shoot_date ASC, s.arrival_time ASC, s.start_time ASC, s.created_at ASC, s.id ASC
    `,
    isFieldRole(auth) ? [startDate, endDate, auth.tenantId, auth.id] : [startDate, endDate, auth.tenantId]
  );

  const canViewProfitabilitySignals = canViewStrategicShootSignals(auth);
  return rows.map((row): ShootProfitabilitySignalRow => {
    const priority = evaluateShootPriority(toPriorityInput(row));
    const finalFlag = canViewProfitabilitySignals ? priority.profitability.finalFlag : null;
    return {
      id: String(row.id),
      title: String(row.title ?? ""),
      shoot_code: String(row.shoot_code ?? ""),
      shoot_date: row.shoot_date instanceof Date ? row.shoot_date.toISOString().slice(0, 10) : String(row.shoot_date ?? ""),
      department: row.department == null ? null : String(row.department),
      shoot_type: (row.shoot_type as OrganizationAccountType | null | undefined) ?? null,
      future_profitability_flag: finalFlag,
      future_profitability_display: finalFlag ? humanizeProfitabilityFlag(finalFlag) : null,
      future_profitability_explanation: canViewProfitabilitySignals ? priority.profitability.explanation : null
    };
  });
}

async function getShootSummaryById(client: PoolClient, shootId: string, auth: AuthUser) {
  const { rows } = await client.query(
    `
      SELECT
             s.*,
             o.display_name AS organization_display_name,
             o.account_type AS organization_account_type,
             COALESCE(sl.name, s.location_name) AS location_name,
             COALESCE(
               NULLIF(sl.address, ''),
               NULLIF(
                 concat_ws(', ', NULLIF(sl.address_line_1, ''), NULLIF(sl.address_line_2, ''), NULLIF(concat_ws(', ', NULLIF(sl.city, ''), NULLIF(sl.state, '')), ''), NULLIF(sl.zip, '')),
                 ''
               ),
               s.location_address
             ) AS location_address,
             COALESCE(sl.latitude, s.location_lat) AS location_lat,
             COALESCE(sl.longitude, s.location_lng) AS location_lng,
             COALESCE(sl.navigation_url, s.navigation_url) AS navigation_url,
             pc.id AS primary_contact_id,
             COALESCE(pc.full_name, s.primary_contact_name) AS primary_contact_name,
             pc.title AS primary_contact_title,
             COALESCE(pc.phone, s.primary_contact_phone) AS primary_contact_phone,
             COALESCE(pc.email, s.primary_contact_email) AS primary_contact_email,
             COALESCE(
               (
                 SELECT json_agg(
                   json_build_object(
                     'id', oc.id,
                     'full_name', oc.full_name,
                     'title', oc.title,
                     'phone', oc.phone,
                     'email', oc.email
                   )
                   ORDER BY scl.sort_order ASC, oc.full_name ASC
                 )
                 FROM shoot_contact_link scl
                 JOIN organization_contact oc
                   ON oc.tenant_id = scl.tenant_id
                  AND oc.id = scl.contact_id
                 WHERE scl.shoot_id = s.id
                   AND scl.tenant_id = s.tenant_id
                   AND scl.contact_role = 'additional'
               ),
               '[]'::json
             ) AS additional_contacts,
             COALESCE(
               (
                 SELECT array_agg(scl.contact_id ORDER BY scl.sort_order ASC)
                 FROM shoot_contact_link scl
                 WHERE scl.shoot_id = s.id
                   AND scl.tenant_id = s.tenant_id
                   AND scl.contact_role = 'additional'
               ),
               ARRAY[]::uuid[]
             ) AS additional_contact_ids,
             COALESCE(
               (
                 SELECT SUM(str.headcount)
                 FROM staffing_template_role str
                 WHERE str.staffing_template_id = s.staffing_template_id
                   AND str.staffing_role IN ('lead_photographer', 'senior_photographer', 'photographer')
               ),
               0
             ) AS template_photographer_count,
             EXISTS (
               SELECT 1
               FROM shoot_location_link slink
               JOIN post_shoot_evaluation pse
                 ON pse.location_id = slink.location_id
                AND pse.tenant_id = slink.tenant_id
               WHERE slink.tenant_id = s.tenant_id
                 AND slink.shoot_id = s.id
                 AND (
                   pse.overall_rating <= 2
                   OR pse.on_time = 'No'
                   OR pse.easy_access = 'No'
                   OR COALESCE(NULLIF(trim(pse.late_details), ''), NULLIF(trim(pse.access_details), ''), NULLIF(trim(pse.notes), '')) IS NOT NULL
                 )
             ) AS prior_major_issue_exists,
             (
               SELECT COUNT(DISTINCT ws.assigned_user_id)
               FROM work_shift ws
               WHERE ws.shoot_id = s.id
                 AND ws.cancelled_at IS NULL
                 AND ws.status IN ('draft', 'published', 'completed')
             ) AS scheduled_employee_count,
             (
               SELECT COUNT(*)
               FROM work_shift ws
               WHERE ws.shoot_id = s.id
                 AND ws.cancelled_at IS NULL
                 AND ws.status IN ('draft', 'published', 'completed')
                 AND ws.satisfies_lead_coverage = true
             ) AS lead_coverage_count,
             (
               SELECT string_agg(au.full_name, ', ' ORDER BY au.full_name ASC)
               FROM work_shift ws
               JOIN app_user au ON au.id = ws.assigned_user_id
               WHERE ws.shoot_id = s.id
                 AND ws.cancelled_at IS NULL
                 AND ws.status IN ('draft', 'published', 'completed')
                 AND ws.satisfies_lead_coverage = true
             ) AS lead_names,
             (
               SELECT COUNT(DISTINCT sp.user_id)
               FROM shift_punch sp
               JOIN work_shift ws ON ws.id = sp.shift_id
               WHERE ws.shoot_id = s.id
                 AND sp.direction = 'in'
             ) AS clocked_in_employee_count,
             (
               SELECT COUNT(*)
               FROM attendance_exception ae
               WHERE ae.shoot_id = s.id
                 AND ae.status = 'open'
             ) AS open_attendance_exception_count,
             (
               SELECT COUNT(*)
               FROM alert a
               WHERE a.shoot_id = s.id
                 AND a.status = 'open'
             ) AS open_alert_count,
             latest_event.type AS latest_event_type,
             latest_event.captured_at AS latest_event_at,
             latest_event.geofence_status AS latest_event_geofence_status,
             ready_confirmer.full_name AS lead_confirmed_ready_by_name
      FROM shoot s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact pc
        ON pc.tenant_id = s.tenant_id
       AND pc.id = s.primary_contact_id
      LEFT JOIN app_user ready_confirmer
        ON ready_confirmer.id = s.lead_confirmed_ready_by_user_id
      LEFT JOIN LATERAL (
        SELECT se.type, se.captured_at, se.geofence_status
        FROM status_event se
        WHERE se.shoot_id = s.id
        ORDER BY se.captured_at DESC, se.created_at DESC
        LIMIT 1
      ) latest_event ON TRUE
      WHERE s.id = $1
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [shootId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const noteSignals = await getPublicObjectNoteSignals(client, auth.tenantId, "shoot", [shootId]);
  const shootNoteSignal = noteSignals.get(shootId);
  const agreementCoverage = await getAgreementCoverageByOrganizationIds(
    client,
    auth.tenantId,
    row.organization_id ? [String(row.organization_id)] : []
  );
  return {
    ...decorateShootRow(row, auth),
    ...buildShootAgreementWarning(
      agreementCoverage.get(String(row.organization_id ?? "")),
      typeof row.shoot_date === "string" ? row.shoot_date : null
    ),
    note_count: shootNoteSignal?.note_count ?? 0,
    pinned_note_count: shootNoteSignal?.pinned_note_count ?? 0,
    post_shoot_follow_up_count: shootNoteSignal?.post_shoot_follow_up_count ?? 0,
    latest_note_preview: shootNoteSignal?.latest_note_preview ?? null
  };
}

export async function getShootById(client: PoolClient, shootId: string, auth: AuthUser) {
  await assertShootAccess(client, auth, shootId);
  const shoot = await getShootSummaryById(client, shootId, auth);
  if (!shoot) {
    return null;
  }
  const alerts = await client.query("SELECT * FROM alert WHERE shoot_id = $1 ORDER BY created_at DESC", [shootId]);
  const statusEvents = await client.query(
    "SELECT * FROM status_event WHERE shoot_id = $1 ORDER BY captured_at ASC, created_at ASC",
    [shootId]
  );
  const media = await client.query("SELECT * FROM media_asset WHERE shoot_id = $1 ORDER BY created_at DESC", [shootId]);
  const shifts = await client.query(
    `
      SELECT
        ws.*,
        au.full_name AS assigned_user_name,
        au.email AS assigned_user_email,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', seg.id,
                'segment_kind', seg.segment_kind,
                'label', seg.label,
                'scheduled_start_at', seg.scheduled_start_at,
                'scheduled_end_at', seg.scheduled_end_at,
                'actual_start_at', seg.actual_start_at,
                'actual_end_at', seg.actual_end_at,
                'rate_code', seg.rate_code,
                'hourly_rate_cents', seg.hourly_rate_cents,
                'sort_order', seg.sort_order
              )
              ORDER BY seg.sort_order ASC
            )
            FROM shift_segment seg
            WHERE seg.shift_id = ws.id
          ),
          '[]'::json
        ) AS segments,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', sp.id,
                'direction', sp.direction,
                'client_timestamp', sp.client_timestamp,
                'geofence_status', sp.geofence_status,
                'gps_confidence', sp.gps_confidence,
                'approval_state', sp.approval_state,
                'unscheduled', sp.unscheduled
              )
              ORDER BY sp.client_timestamp ASC
            )
            FROM shift_punch sp
            WHERE sp.shift_id = ws.id
          ),
          '[]'::json
        ) AS punches
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      WHERE ws.shoot_id = $1
        AND ws.cancelled_at IS NULL
      ORDER BY ws.starts_at ASC
    `,
    [shootId]
  );
  const staffingTemplate = shoot.staffing_template_id
    ? (
        await client.query(
          `
            SELECT
              st.*,
              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object(
                      'id', str.id,
                      'staffing_role', str.staffing_role,
                      'label', str.label,
                      'headcount', str.headcount,
                      'satisfies_lead_coverage', str.satisfies_lead_coverage,
                      'sort_order', str.sort_order
                    )
                    ORDER BY str.sort_order ASC
                  )
                  FROM staffing_template_role str
                  WHERE str.staffing_template_id = st.id
                ),
                '[]'::json
              ) AS roles
            FROM staffing_template st
            WHERE st.id = $1
            LIMIT 1
          `,
          [shoot.staffing_template_id]
        )
      ).rows[0]
    : null;
  const linkedEvents = await client.query(
    `
      SELECT *
      FROM schedule_event
      WHERE linked_shoot_id = $1
        AND deleted_at IS NULL
      ORDER BY starts_at ASC
    `,
    [shootId]
  );
  const attendanceExceptions = await client.query(
    `
      SELECT *
      FROM attendance_exception
      WHERE shoot_id = $1
      ORDER BY created_at DESC
    `,
    [shootId]
  );
  const locationIntelligence = await getShootLocationIntelligence(client, auth, {
    shootId,
    shootCode: shoot.shoot_code,
    shootLocationName: shoot.location_name,
    shootLocationAddress: shoot.location_address
  });
  const resourceLibrary = await getShootResourceLibrary(client, auth, shootId);
  const readyToShoot = await getShootReadyToShootState(client, auth, shootId);
  return {
    ...shoot,
    alerts: alerts.rows,
    status_events: statusEvents.rows,
    media: media.rows,
    resource_library: resourceLibrary,
    shifts: shifts.rows,
    staffing_template: staffingTemplate,
    linked_schedule_events: linkedEvents.rows,
    attendance_exceptions: attendanceExceptions.rows,
    location_intelligence: locationIntelligence,
    ready_to_shoot: readyToShoot
  };
}

export async function updateShoot(client: PoolClient, auth: AuthUser, shootId: string, patch: Partial<ShootInput>) {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return getShootSummaryById(client, shootId, auth);
  }
  const current = await client.query("SELECT * FROM shoot WHERE id = $1 AND deleted_at IS NULL", [shootId]);
  if (!current.rows[0]) {
    return null;
  }
  const currentAdditionalContacts = await getShootAdditionalContacts(client, auth.tenantId, shootId);
  const nextShootType = (patch.shoot_type ?? current.rows[0].shoot_type) as OrganizationAccountType | null;
  const nextOrganizationId = (patch.organization_id ?? current.rows[0].organization_id) as string | null;
  const nextLocationId = (patch.location_id ?? current.rows[0].location_id) as string | null;
  const nextPrimaryContactId = (patch.primary_contact_id ?? current.rows[0].primary_contact_id) as string | null;
  const nextAdditionalContactIds =
    patch.additional_contact_ids ?? currentAdditionalContacts.map((contact) => contact.id);

  if (!nextShootType || !nextOrganizationId || !nextLocationId || !nextPrimaryContactId) {
    throw new ApiError(400, "Shoot edits now require canonical Organization, Location, and primary Contact links.");
  }

  const directorySelection = await loadCanonicalDirectorySelection(client, auth, {
    organization_id: nextOrganizationId,
    location_id: nextLocationId,
    primary_contact_id: nextPrimaryContactId,
    additional_contact_ids: nextAdditionalContactIds
  });
  const department = mapShootTypeToDepartment(nextShootType);
  const shootCategory = mapShootTypeToCategory(nextShootType);
  assertShootMutationAllowed(auth, department, isLiveShoot(current.rows[0]));
  assertStrategicFieldsEditable(auth, patch);
  const importanceOverride = resolveImportanceOverrideFields(current.rows[0], patch, auth);
  const syncState = await getScheduleSyncWriteState(client, auth.tenantId);
  const lifecycleResolution = await resolveShootLifecyclePatch(client, auth, shootId, current.rows[0], patch);
  const locationAddress = buildCanonicalLocationAddress(directorySelection.location);
  const primaryContact = directorySelection.primaryContact;
  const firstAdditionalContact = directorySelection.additionalContacts[0] ?? null;
  const nextArrivalTime = (patch.arrival_time ?? current.rows[0].arrival_time) as string | null;
  const nextStartTime = (patch.start_time ?? current.rows[0].start_time) as string | null;
  const { additional_contact_ids: _ignoredAdditionalContactIds, ...shootPatch } = patch;
  const hydratedPatch = {
    ...shootPatch,
    department,
    shoot_category: shootCategory,
    organization_id: nextOrganizationId,
    location_id: nextLocationId,
    primary_contact_id: nextPrimaryContactId,
    shoot_type: nextShootType,
    shoot_subtype: Object.prototype.hasOwnProperty.call(patch, "shoot_subtype") ? patch.shoot_subtype ?? null : current.rows[0].shoot_subtype ?? null,
    location_name: directorySelection.location.name,
    location_address: locationAddress ?? "",
    location_lat: directorySelection.location.latitude ?? current.rows[0].location_lat ?? 44.9778,
    location_lng: directorySelection.location.longitude ?? current.rows[0].location_lng ?? -93.2649,
    primary_contact_name: primaryContact.full_name,
    primary_contact_phone: primaryContact.phone ?? null,
    primary_contact_email: primaryContact.email ?? null,
    secondary_contact_name: firstAdditionalContact?.full_name ?? null,
    secondary_contact_phone: firstAdditionalContact?.phone ?? null,
    secondary_contact_email: firstAdditionalContact?.email ?? null,
    additional_products_flag:
      patch.additional_products_flag ??
      (Object.prototype.hasOwnProperty.call(patch, "additional_products")
        ? Boolean(patch.additional_products?.trim())
        : current.rows[0].additional_products_flag),
    special_equipment_flag:
      patch.special_equipment_flag ??
      (Object.prototype.hasOwnProperty.call(patch, "special_equipment")
        ? Boolean(patch.special_equipment?.trim())
        : current.rows[0].special_equipment_flag),
    ...(Object.prototype.hasOwnProperty.call(patch, "showtime")
      ? {
          showtime: patch.showtime ?? nextArrivalTime ?? nextStartTime ?? null
        }
      : {}),
    navigation_url: buildGoogleMapsLink({
      latitude: directorySelection.location.latitude ?? current.rows[0].location_lat ?? null,
      longitude: directorySelection.location.longitude ?? current.rows[0].location_lng ?? null,
      address: locationAddress,
      label: directorySelection.location.maps_label ?? directorySelection.location.name
    }),
    estimated_drive_minutes: estimateDriveMinutesFromStudio(
      directorySelection.location.latitude ?? current.rows[0].location_lat ?? null,
      directorySelection.location.longitude ?? current.rows[0].location_lng ?? null
    ),
    importance_override_tier: importanceOverride.importance_override_tier,
    importance_override_reason: importanceOverride.importance_override_reason,
    importance_override_at: importanceOverride.importance_override_at,
    importance_override_by_user_id: importanceOverride.importance_override_by_user_id,
    big_shoot_manual_override: importanceOverride.big_shoot_manual_override,
    status: lifecycleResolution.status,
    status_reason: lifecycleResolution.status_reason,
    status_changed_at: lifecycleResolution.status_changed_at,
    status_changed_by_user_id: lifecycleResolution.status_changed_by_user_id,
    on_hold_return_status: lifecycleResolution.on_hold_return_status,
    post_production_substage: lifecycleResolution.post_production_substage,
    schedule_sync_required: syncState.syncRequired,
    schedule_sync_state: syncState.syncState,
    ...(Object.prototype.hasOwnProperty.call(patch, "pre_service_notes_complete")
      ? {
          pre_service_notes_complete: patch.pre_service_notes_complete ?? false
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "special_deliverables_ready")
      ? {
          special_deliverables_ready: patch.special_deliverables_ready ?? false
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "gear_requirements_ready")
      ? {
          gear_requirements_ready: patch.gear_requirements_ready ?? false
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "roster_data_required")
      ? {
          roster_data_required: patch.roster_data_required ?? false
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "roster_data_ready")
      ? {
          roster_data_ready: patch.roster_data_ready ?? false
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "future_profitability_manual")
      ? {
          future_profitability_reviewed_at: patch.future_profitability_manual ? new Date().toISOString() : null,
          future_profitability_reviewed_by: patch.future_profitability_manual ? auth.id : null
        }
      : {})
  };
  const updateKeys = Object.keys(hydratedPatch);
  const values = updateKeys.map((key) => (hydratedPatch as Record<string, unknown>)[key]);
  const setClause = updateKeys.map((key, index) => `${key} = $${index + 2}`).join(", ");
  try {
    const { rows } = await client.query(
      `UPDATE shoot SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
      [shootId, ...values]
    );
    const updated = rows[0];
    const profitabilityChanged =
      current.rows[0].future_profitability_manual !== updated.future_profitability_manual ||
      current.rows[0].future_profitability_reason !== updated.future_profitability_reason;
    const importanceOverrideChanged =
      current.rows[0].importance_override_tier !== updated.importance_override_tier ||
      normalizeNullableText(current.rows[0].importance_override_reason) !== normalizeNullableText(updated.importance_override_reason);
    if (profitabilityChanged) {
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "shoot.future_profitability.updated",
        entityType: "shoot",
        entityId: shootId,
        metadata: {
          before: {
            future_profitability_manual: current.rows[0].future_profitability_manual ?? null,
            future_profitability_reason: current.rows[0].future_profitability_reason ?? null
          },
          after: {
            future_profitability_manual: updated.future_profitability_manual ?? null,
            future_profitability_reason: updated.future_profitability_reason ?? null
          }
        }
      });
    }
    if (importanceOverrideChanged) {
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "shoot.importance_override.updated",
        entityType: "shoot",
        entityId: shootId,
        metadata: {
          before: importanceOverride.before,
          after: importanceOverride.after
        }
      });
    }
    if (lifecycleResolution.transitionChanged) {
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "shoot.status.updated",
        entityType: "shoot",
        entityId: shootId,
        metadata: {
          before: {
            status: toNormalizedShootStatus(current.rows[0].status, "DRAFT"),
            status_reason: normalizeNullableText(current.rows[0].status_reason),
            post_production_substage: toNormalizedPostProductionSubstage(current.rows[0].post_production_substage),
            on_hold_return_status: normalizeShootStatusValue(current.rows[0].on_hold_return_status)
          },
          after: {
            status: lifecycleResolution.status,
            status_display: humanizeShootStatus(lifecycleResolution.status),
            status_reason: lifecycleResolution.status_reason,
            post_production_substage: lifecycleResolution.post_production_substage,
            post_production_substage_display: humanizePostProductionSubstage(lifecycleResolution.post_production_substage),
            on_hold_return_status: lifecycleResolution.on_hold_return_status
          },
          transition_key: lifecycleResolution.transitionKey,
          transition_direction: lifecycleResolution.transitionDirection,
          ready_eligible: lifecycleResolution.readyEligible,
          approval_level: getApprovalLevelLabel(lifecycleResolution.approvalLevel),
          approval_role_group: lifecycleResolution.approvalRoleGroup,
          readiness_override_applied: lifecycleResolution.readinessOverrideApplied
        }
      });
    }
    if (lifecycleResolution.readinessOverrideApplied) {
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "shoot.readiness.override",
        entityType: "shoot",
        entityId: shootId,
        metadata: {
          status: lifecycleResolution.status,
          status_reason: lifecycleResolution.status_reason,
          blocking_requirement_keys: evaluateShootReadiness(current.rows[0]).blockingRequirementKeys,
          override_level: getApprovalLevelLabel(lifecycleResolution.approvalLevel),
          approval_role_group: lifecycleResolution.approvalRoleGroup
        }
      });
    }
    const protectedOperationalEdit =
      ["CONFIRMED", "READY"].includes(toNormalizedShootStatus(current.rows[0].status, "DRAFT")) &&
      (current.rows[0].arrival_time !== updated.arrival_time ||
        current.rows[0].start_time !== updated.start_time ||
        current.rows[0].end_time_est !== updated.end_time_est ||
        String(current.rows[0].location_id ?? "") !== String(updated.location_id ?? ""));
    if (protectedOperationalEdit) {
      const startDeltaMs =
        current.rows[0].start_time && updated.start_time
          ? new Date(updated.start_time).getTime() - new Date(current.rows[0].start_time).getTime()
          : 0;
      const endDeltaMs =
        current.rows[0].end_time_est && updated.end_time_est
          ? new Date(updated.end_time_est).getTime() - new Date(current.rows[0].end_time_est).getTime()
          : 0;
      const shiftedWorkShifts = await client.query<{ id: string }>(
        `
          UPDATE work_shift
          SET starts_at = starts_at + ($2 || ' milliseconds')::interval,
              ends_at = ends_at + ($3 || ' milliseconds')::interval,
              location_name = $4,
              location_address = $5,
              calendar_sync_required = CASE WHEN status = 'published' THEN true ELSE calendar_sync_required END,
              updated_at = now()
          WHERE shoot_id = $1
            AND cancelled_at IS NULL
          RETURNING id
        `,
        [
          shootId,
          String(startDeltaMs),
          String(endDeltaMs),
          updated.location_name ?? null,
          updated.location_address ?? null
        ]
      );
      for (const row of shiftedWorkShifts.rows) {
        await queueWorkShiftOutlookSync(client, {
          tenantId: auth.tenantId,
          shiftId: row.id,
          triggeredByUserId: auth.id,
          dedupeSuffix: `shoot-update:${updated.updated_at ?? new Date().toISOString()}`
        });
      }
    }
    if (protectedOperationalEdit) {
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "shoot.schedule_location.updated",
        entityType: "shoot",
        entityId: shootId,
        previousValues: {
          location_id: current.rows[0].location_id ?? null,
          arrival_time: current.rows[0].arrival_time ?? null,
          start_time: current.rows[0].start_time ?? null,
          end_time_est: current.rows[0].end_time_est ?? null
        },
        newValues: {
          location_id: updated.location_id ?? null,
          arrival_time: updated.arrival_time ?? null,
          start_time: updated.start_time ?? null,
          end_time_est: updated.end_time_est ?? null
        }
      });
    }
    await syncShootContactLinks(client, auth, shootId, nextPrimaryContactId, normalizeAdditionalContactIds(nextAdditionalContactIds));
    await syncShootLocationLink(client, auth, {
      shootId,
      shootCode: String(updated.shoot_code),
      title: String(updated.title),
      locationId: nextLocationId,
      locationName: directorySelection.location.name
    });
    if (lifecycleResolution.transitionChanged) {
      const priorStatus = toNormalizedShootStatus(current.rows[0].status, "DRAFT");
      await ensureTriggeredChecklistInstances(client, auth, {
        scope_type: "shoot",
        scope_id: shootId,
        trigger_types: ["shoot_status_transition"],
        template_codes: getChecklistTemplateCodesForShootLifecycle(lifecycleResolution.status),
        created_from_trigger_key: `shoot:${priorStatus}:${lifecycleResolution.status}`,
        source_metadata_json: {
          shoot_id: shootId,
          from_status: priorStatus,
          to_status: lifecycleResolution.status
        }
      });
      if (["LIVE", "SHOOT_COMPLETE", "POST_PRODUCTION", "COMPLETE"].includes(lifecycleResolution.status)) {
        await ensureTriggeredChecklistInstances(client, auth, {
          scope_type: "shoot",
          scope_id: shootId,
          trigger_types: ["shoot_complete"],
          template_codes: ["end_of_shoot_wrap"],
          created_from_trigger_key: `shoot_complete:${lifecycleResolution.status}`,
          source_metadata_json: {
            shoot_id: shootId,
            status: lifecycleResolution.status
          }
        });
      }
    }
    if (
      toNormalizedShootStatus(current.rows[0].status, "DRAFT") !== "POST_PRODUCTION" &&
      lifecycleResolution.status === "POST_PRODUCTION"
    ) {
      await triggerProductionProjectFromShootCompletion(client, auth, {
        shootId,
        shootCode: updated.shoot_code ?? null,
        shootTitle: updated.title,
        shootDate: String(updated.shoot_date),
        organizationId: updated.organization_id ?? null,
        locationId: updated.location_id ?? null,
        shootType: updated.shoot_type ?? null,
        ownerUserId: updated.readiness_owner_user_id ?? null
      });
    }
    if (lifecycleResolution.dangerousActionExecutionId) {
      await completeDangerousAction(client, auth, {
        executionId: lifecycleResolution.dangerousActionExecutionId,
        actionCode: lifecycleResolution.dangerousActionCode ?? "change_shoot_status_complete",
        entityType: "shoot",
        entityId: shootId,
        afterValue: {
          status: lifecycleResolution.status,
          post_production_substage: lifecycleResolution.post_production_substage
        },
        reason: lifecycleResolution.status_reason
      });
    }
    return (await getShootSummaryById(client, shootId, auth)) ?? updated;
  } catch (error) {
    if (lifecycleResolution.dangerousActionExecutionId) {
      await failDangerousAction(client, auth, {
        executionId: lifecycleResolution.dangerousActionExecutionId,
        actionCode: lifecycleResolution.dangerousActionCode ?? "change_shoot_status_complete",
        entityType: "shoot",
        entityId: shootId,
        errorMessage: error instanceof Error ? error.message : "Unknown error"
      });
    }
    throw error;
  }
}

export async function listShootReferenceData(client: PoolClient, auth: AuthUser) {
  const canonicalContactsResult = await client.query<{
    name: string;
    phone: string | null;
    email: string | null;
    source_label: string;
    source_kind: string;
    sort_at: string;
  }>(
    `
      SELECT
        oc.full_name AS name,
        NULLIF(trim(oc.phone), '') AS phone,
        NULLIF(trim(oc.email), '') AS email,
        o.display_name AS source_label,
        'organization_contact'::text AS source_kind,
        MAX(COALESCE(oc.updated_at, oc.created_at, now()))::text AS sort_at
      FROM organization_contact oc
      JOIN organization o
        ON o.tenant_id = oc.tenant_id
       AND o.id = oc.organization_id
      WHERE oc.tenant_id = $1
        AND oc.active_status = 'active'
        AND o.active_status = 'active'
      GROUP BY oc.full_name, oc.phone, oc.email, o.display_name
      ORDER BY MAX(COALESCE(oc.updated_at, oc.created_at, now())) DESC, o.display_name ASC
    `,
    [auth.tenantId]
  );
  const shootContactsResult = await client.query<{
    name: string | null;
    phone: string | null;
    email: string | null;
    source_label: string;
    source_kind: string;
    sort_at: string;
  }>(
    `
      SELECT
        contact_name AS name,
        contact_phone AS phone,
        contact_email AS email,
        source_label,
        source_kind,
        MAX(sort_at)::text AS sort_at
      FROM (
        SELECT
          NULLIF(trim(primary_contact_name), '') AS contact_name,
          NULLIF(trim(primary_contact_phone), '') AS contact_phone,
          NULLIF(trim(primary_contact_email), '') AS contact_email,
          COALESCE(NULLIF(trim(location_name), ''), NULLIF(trim(title), ''), NULLIF(trim(shoot_code), ''), 'Saved shoot') AS source_label,
          'shoot_primary'::text AS source_kind,
          COALESCE(updated_at, created_at, now()) AS sort_at
        FROM shoot
        WHERE tenant_id = $1
          AND deleted_at IS NULL
        UNION ALL
        SELECT
          NULLIF(trim(secondary_contact_name), '') AS contact_name,
          NULLIF(trim(secondary_contact_phone), '') AS contact_phone,
          NULLIF(trim(secondary_contact_email), '') AS contact_email,
          COALESCE(NULLIF(trim(location_name), ''), NULLIF(trim(title), ''), NULLIF(trim(shoot_code), ''), 'Saved shoot') AS source_label,
          'shoot_secondary'::text AS source_kind,
          COALESCE(updated_at, created_at, now()) AS sort_at
        FROM shoot
        WHERE tenant_id = $1
          AND deleted_at IS NULL
      ) contacts
      WHERE contact_name IS NOT NULL
      GROUP BY contact_name, contact_phone, contact_email, source_label, source_kind
      ORDER BY MAX(sort_at) DESC
    `,
    [auth.tenantId]
  );
  const locationContactsResult = await client.query<{
    id: string;
    location_name: string;
    custodian_contact: string | null;
    updated_at: string;
  }>(
    `
      SELECT id, name AS location_name, custodian_contact, updated_at::text
      FROM shoot_location
      WHERE tenant_id = $1
        AND custodian_contact IS NOT NULL
        AND trim(custodian_contact) <> ''
      ORDER BY updated_at DESC, name ASC
    `,
    [auth.tenantId]
  );

  const contacts = new Map<
    string,
    {
      label: string;
      name: string;
      phone: string | null;
      email: string | null;
      source_kind: string;
      source_label: string;
      location_id: string | null;
      last_used_at: string | null;
    }
  >();

  for (const row of canonicalContactsResult.rows) {
    const name = row.name?.trim();
    if (!name) {
      continue;
    }
    const key = `${name.toLowerCase()}|${row.phone ?? ""}|${row.email ?? ""}`;
    if (contacts.has(key)) {
      continue;
    }
    contacts.set(key, {
      label: row.phone || row.email ? `${name}${row.phone ? ` | ${row.phone}` : ""}${row.email ? ` | ${row.email}` : ""}` : name,
      name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      source_kind: row.source_kind,
      source_label: row.source_label,
      location_id: null,
      last_used_at: row.sort_at ?? null
    });
  }

  for (const row of shootContactsResult.rows) {
    const name = row.name?.trim();
    if (!name) {
      continue;
    }
    const key = `${name.toLowerCase()}|${row.phone ?? ""}|${row.email ?? ""}`;
    if (contacts.has(key)) {
      continue;
    }
    contacts.set(key, {
      label: row.phone || row.email ? `${name}${row.phone ? ` | ${row.phone}` : ""}${row.email ? ` | ${row.email}` : ""}` : name,
      name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      source_kind: row.source_kind,
      source_label: row.source_label,
      location_id: null,
      last_used_at: row.sort_at ?? null
    });
  }

  for (const row of locationContactsResult.rows) {
    const name = row.custodian_contact?.trim();
    if (!name) {
      continue;
    }
    const key = `${name.toLowerCase()}||`;
    if (contacts.has(key)) {
      continue;
    }
    contacts.set(key, {
      label: `${name} | ${row.location_name}`,
      name,
      phone: null,
      email: null,
      source_kind: "location_profile",
      source_label: row.location_name,
      location_id: row.id,
      last_used_at: row.updated_at ?? null
    });
  }

  return {
    contacts: [...contacts.values()].sort((left, right) => {
      const leftSort = left.last_used_at ?? "";
      const rightSort = right.last_used_at ?? "";
      if (leftSort === rightSort) {
        return left.name.localeCompare(right.name);
      }
      return rightSort.localeCompare(leftSort);
    })
  };
}

export async function deleteShoot(client: PoolClient, auth: AuthUser, shootId: string, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  const shootResult = await client.query("SELECT * FROM shoot WHERE id = $1 AND deleted_at IS NULL LIMIT 1", [shootId]);
  const shoot = shootResult.rows[0];
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }

  const dangerousAction = await beginDangerousAction(client, auth, {
    actionCode: "delete_shoot",
    entityType: "shoot",
    entityId: shootId,
    sourceModule: "shoots",
    reason: "Leadership requested shoot deletion",
    beforeValue: {
      shoot_code: shoot.shoot_code,
      title: shoot.title,
      shoot_date: shoot.shoot_date
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  try {
    const { rowCount } = await client.query("UPDATE shoot SET deleted_at = now(), updated_at = now() WHERE id = $1", [shootId]);
    if (!rowCount) {
      throw new ApiError(404, "Shoot not found");
    }

    await completeDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "delete_shoot",
      entityType: "shoot",
      entityId: shootId,
      afterValue: {
        deleted_at: new Date().toISOString()
      },
      reason: "Leadership requested shoot deletion",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return true;
  } catch (error) {
    await failDangerousAction(client, auth, {
      executionId: dangerousAction.executionId,
      actionCode: "delete_shoot",
      entityType: "shoot",
      entityId: shootId,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    throw error;
  }
}

function resolveShootWindow(window: ShootListWindow) {
  if (window.date) {
    return {
      startDate: window.date,
      endDate: window.date
    };
  }

  const left = window.dateFrom ?? window.dateTo;
  const right = window.dateTo ?? window.dateFrom;
  if (!left || !right) {
    throw new ApiError(400, "A shoot date or complete date range is required");
  }

  if (left <= right) {
    return {
      startDate: left,
      endDate: right
    };
  }

  return {
    startDate: right,
    endDate: left
  };
}
