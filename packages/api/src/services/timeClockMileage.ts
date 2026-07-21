import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import type {
  MileageReimbursementReasonCode,
  MileageReimbursementStatus,
  MileageVehicleType
} from "../types/timeClock.js";
import { ApiError } from "../errors/apiError.js";
import { canFinalizePayroll, canManagePayrollPeriods } from "../authz/authority.js";
import { featureFlags } from "../featureFlags.js";
import { createAuditLog } from "./audit.js";
import { haversineMiles } from "./geo.js";
import { getStudioLocation } from "./maps.js";
import { getPayrollCalendarConfig, getPayrollPeriodBounds } from "./payrollPeriods.js";
import { shouldRestrictShiftList } from "./shiftAccess.js";

type MileageZoneRow = {
  id: string;
  zone_name: string;
  min_distance: string;
  max_distance: string;
  reimbursement_amount: string;
  effective_date: string;
};

type MileageCandidateEvaluation = {
  evaluation_id: string;
  shift_id: string;
  shoot_id: string;
  organization_id: string | null;
  location_id: string | null;
  shoot_title: string;
  shoot_code: string | null;
  shoot_date: string;
  submit_for_mileage: boolean;
  mileage_response: "pending" | "eligible" | "declined";
  vehicle_type: MileageVehicleType | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
};

type WorkedShootShift = {
  shift_id: string;
  shoot_id: string;
  organization_id: string | null;
  location_id: string | null;
  shoot_title: string | null;
  shoot_code: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
};

type MileageReimbursementRecord = {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  work_date: string;
  selected_evaluation_id: string | null;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title?: string | null;
  linked_shoot_code?: string | null;
  organization_id: string | null;
  organization_display_name?: string | null;
  location_id: string | null;
  location_name?: string | null;
  zone_id: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  vehicle_type: MileageVehicleType | null;
  status: MileageReimbursementStatus;
  review_reason_code: MileageReimbursementReasonCode | null;
  source_evaluation_count: number;
  reporting_flags: string[];
  created_at: string;
  updated_at: string;
};

type MileageReimbursementSourceRecord = {
  id: string;
  reimbursement_id: string;
  evaluation_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  shoot_title?: string | null;
  shoot_code?: string | null;
  organization_id: string | null;
  organization_display_name?: string | null;
  location_id: string | null;
  location_name?: string | null;
  zone_id: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  submit_for_mileage: boolean;
  vehicle_type: MileageVehicleType | null;
  eligible_for_selection: boolean;
  review_reason_code: MileageReimbursementReasonCode | null;
  created_at: string;
};

type LegacyMileageClaimComparisonRow = {
  employee_id: string;
  work_date: string;
  claim_count: number;
  total_amount: string;
};

type SourceComputation = {
  evaluationId: string;
  shiftId: string;
  shootId: string;
  organizationId: string | null;
  locationId: string | null;
  zoneId: string | null;
  zoneName: string | null;
  studioDistanceMiles: number | null;
  reimbursementAmount: number;
  submitForMileage: boolean;
  vehicleType: MileageVehicleType | null;
  eligibleForSelection: boolean;
  reviewReasonCode: MileageReimbursementReasonCode | null;
};

type ReimbursementComputation = {
  status: MileageReimbursementStatus;
  reasonCode: MileageReimbursementReasonCode | null;
  sources: SourceComputation[];
  selected: SourceComputation | null;
};

export type MileageReimbursementSummary = {
  work_date: string;
  mileage_eligible: boolean;
  status: MileageReimbursementStatus | "not_applicable";
  review_reason_code: MileageReimbursementReasonCode | null;
  reimbursement_amount: string | null;
  zone_name: string | null;
  vehicle_type: MileageVehicleType | null;
  studio_distance_miles: number | null;
  issue_label: string | null;
  selected_shoot: {
    id: string;
    shoot_code: string | null;
    title: string | null;
  } | null;
};

export type MileageReimbursementListSourceOfTruth = {
  primary_model: "canonical_mileage_reimbursement";
  canonical_records: ["mileage_reimbursement", "mileage_reimbursement_source", "post_shoot_evaluation"];
  legacy_compatibility_records: ["mileage_claim"];
};

export type MileageReimbursementListRow = MileageReimbursementRecord & {
  review_reason_label: string | null;
  sources: Array<MileageReimbursementSourceRecord & { review_reason_label: string | null }>;
  legacy_comparison: {
    claim_count: number;
    total_amount: number;
    reimbursement_amount_delta: number;
    amount_match: boolean;
  };
  transition_flags: string[];
};

export type MileageReimbursementListPayload = {
  source_of_truth: MileageReimbursementListSourceOfTruth;
  summary: {
    total_days: number;
    candidate_count: number;
    review_required_count: number;
    ineligible_count: number;
    total_candidate_amount: number;
  };
  transition: {
    legacy_mileage_claim_summary: {
      claim_count: number;
      total_amount: number;
    };
    comparison: {
      mismatch_day_count: number;
      canonical_only_day_count: number;
      legacy_only_day_count: number;
    };
  };
  rows: MileageReimbursementListRow[];
};

const REVIEW_REASON_LABELS: Record<MileageReimbursementReasonCode, string> = {
  missing_post_shoot_evaluation: "Post-Shoot Evaluation still missing",
  not_mileage_eligible: "Employee is not mileage eligible",
  answer_pending: "Waiting on the photographer's mileage answer",
  submit_declined: "Mileage was declined on the evaluation",
  company_vehicle: "Company Vehicle is not reimbursable",
  carpool_passenger: "Carpool passengers are not reimbursed",
  other_needs_review: "Vehicle type needs review before reimbursement",
  missing_location_coordinates: "Location coordinates are missing",
  missing_zone_match: "No reimbursement zone matched the Shoot distance",
  no_eligible_personal_vehicle_submission: "No personal-vehicle submission is eligible for reimbursement"
};

function reasonLabel(reason: MileageReimbursementReasonCode | null) {
  return reason ? REVIEW_REASON_LABELS[reason] : null;
}

function toNumericString(value: number | string | null | undefined) {
  if (value == null) {
    return "0.00";
  }
  return Number(value).toFixed(2);
}

function buildFlags(status: MileageReimbursementStatus, reasonCode: MileageReimbursementReasonCode | null) {
  const flags = new Set<string>(["phase5_mileage"]);
  if (status === "review_required") {
    flags.add("review_required");
  }
  if (status === "candidate") {
    flags.add("candidate_ready");
  }
  if (status === "ineligible") {
    flags.add("not_payable");
  }
  if (reasonCode === "missing_post_shoot_evaluation") {
    flags.add("missing_eval");
  }
  if (reasonCode === "other_needs_review") {
    flags.add("vehicle_review");
  }
  if (reasonCode === "missing_location_coordinates" || reasonCode === "missing_zone_match") {
    flags.add("distance_review");
  }
  return [...flags];
}

async function loadActivePayProfile(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  workDate: string
) {
  const { rows } = await client.query<{ id: string; mileage_eligible: boolean }>(
    `
      SELECT id, mileage_eligible
      FROM employee_pay_profile
      WHERE tenant_id = $1
        AND employee_id = $2
        AND effective_date <= $3::date
      ORDER BY effective_date DESC, created_at DESC
      LIMIT 1
    `,
    [tenantId, employeeId, workDate]
  );
  return rows[0] ?? null;
}

async function loadWorkedShootShifts(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  workDate: string
) {
  const { rows } = await client.query<WorkedShootShift>(
    `
      SELECT DISTINCT
        ws.id AS shift_id,
        ws.shoot_id,
        s.organization_id,
        s.location_id,
        s.title AS shoot_title,
        s.shoot_code,
        s.location_name,
        sl.latitude,
        sl.longitude
      FROM work_shift ws
      JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      LEFT JOIN shoot_location sl
        ON sl.id = s.location_id
       AND sl.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.assigned_user_id = $2
        AND ws.shift_kind = 'shoot'
        AND ws.cancelled_at IS NULL
        AND COALESCE(s.shoot_date, ws.starts_at::date) = $3::date
    `,
    [tenantId, employeeId, workDate]
  );
  return rows;
}

async function loadSubmittedEvaluations(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  workDate: string
) {
  const { rows } = await client.query<MileageCandidateEvaluation>(
    `
      SELECT
        pse.id AS evaluation_id,
        pse.shift_id,
        pse.shoot_id,
        pse.organization_id,
        pse.location_id,
        pse.shoot_name AS shoot_title,
        s.shoot_code,
        pse.shoot_date::text AS shoot_date,
        pse.submit_for_mileage,
        pse.mileage_response,
        pse.vehicle_type::text AS vehicle_type,
        sl.name AS location_name,
        sl.latitude,
        sl.longitude
      FROM post_shoot_evaluation pse
      LEFT JOIN shoot s
        ON s.id = pse.shoot_id
       AND s.tenant_id = pse.tenant_id
      LEFT JOIN shoot_location sl
        ON sl.id = pse.location_id
       AND sl.tenant_id = pse.tenant_id
      WHERE pse.tenant_id = $1
        AND pse.photographer_user_id = $2
        AND pse.shoot_date = $3::date
    `,
    [tenantId, employeeId, workDate]
  );
  return rows;
}

async function loadActiveZones(client: PoolClient, tenantId: string, workDate: string) {
  const { rows } = await client.query<MileageZoneRow>(
    `
      SELECT id, zone_name, min_distance::text, max_distance::text, reimbursement_amount::text, effective_date::text
      FROM mileage_zone
      WHERE tenant_id = $1
        AND active_status = true
        AND effective_date <= $2::date
      ORDER BY effective_date DESC, min_distance ASC
    `,
    [tenantId, workDate]
  );
  return rows;
}

async function loadExistingReimbursement(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  workDate: string
) {
  const { rows } = await client.query<MileageReimbursementRecord>(
    `
      SELECT
        mr.*,
        s.title AS linked_shoot_title,
        s.shoot_code AS linked_shoot_code
      FROM mileage_reimbursement mr
      LEFT JOIN shoot s
        ON s.id = mr.linked_shoot_id
      WHERE mr.tenant_id = $1
        AND mr.employee_id = $2
        AND mr.work_date = $3::date
      LIMIT 1
    `,
    [tenantId, employeeId, workDate]
  );
  return rows[0] ?? null;
}

async function loadLegacyMileageClaimComparison(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    userId?: string;
  } = {}
) {
  const values: unknown[] = [auth.tenantId];
  const where = ["mc.tenant_id = $1"];

  if (filters.date) {
    values.push(filters.date);
    where.push(`s.shoot_date = $${values.length}::date`);
  } else {
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      where.push(`s.shoot_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      where.push(`s.shoot_date <= $${values.length}::date`);
    }
  }

  if (filters.userId && !shouldRestrictShiftList(auth)) {
    values.push(filters.userId);
    where.push(`mc.user_id = $${values.length}::uuid`);
  } else if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`mc.user_id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<LegacyMileageClaimComparisonRow>(
    `
      SELECT
        mc.user_id AS employee_id,
        s.shoot_date::text AS work_date,
        COUNT(*)::int AS claim_count,
        COALESCE(SUM(mc.reimbursement_amount), 0)::text AS total_amount
      FROM mileage_claim mc
      JOIN shoot s
        ON s.id = mc.shoot_id
      WHERE ${where.join(" AND ")}
      GROUP BY mc.user_id, s.shoot_date
    `,
    values
  );

  return rows;
}

function findZoneForDistance(zones: MileageZoneRow[], distanceMiles: number) {
  return zones.find((zone) => distanceMiles >= Number(zone.min_distance) && distanceMiles <= Number(zone.max_distance)) ?? null;
}

function buildSourceRow(input: {
  evaluation: MileageCandidateEvaluation;
  zone: MileageZoneRow | null;
  distanceMiles: number | null;
  eligibleForSelection: boolean;
  reviewReasonCode: MileageReimbursementReasonCode | null;
}): SourceComputation {
  return {
    evaluationId: input.evaluation.evaluation_id,
    shiftId: input.evaluation.shift_id,
    shootId: input.evaluation.shoot_id,
    organizationId: input.evaluation.organization_id,
    locationId: input.evaluation.location_id,
    zoneId: input.zone?.id ?? null,
    zoneName: input.zone?.zone_name ?? null,
    studioDistanceMiles: input.distanceMiles,
    reimbursementAmount: input.zone ? Number(input.zone.reimbursement_amount) : 0,
    submitForMileage: Boolean(input.evaluation.submit_for_mileage),
    vehicleType: input.evaluation.vehicle_type,
    eligibleForSelection: input.eligibleForSelection,
    reviewReasonCode: input.reviewReasonCode
  };
}

function chooseHighestZoneSource(sources: SourceComputation[]) {
  return [...sources]
    .filter((source) => source.eligibleForSelection)
    .sort((left, right) => {
      const amountDelta = right.reimbursementAmount - left.reimbursementAmount;
      if (amountDelta !== 0) {
        return amountDelta;
      }
      return Number(right.studioDistanceMiles ?? 0) - Number(left.studioDistanceMiles ?? 0);
    })[0] ?? null;
}

function summarizeCandidateStatus(input: {
  payProfile: { mileage_eligible: boolean } | null;
  workedShifts: WorkedShootShift[];
  evaluations: MileageCandidateEvaluation[];
  zones: MileageZoneRow[];
}): ReimbursementComputation {
  if (!input.workedShifts.length) {
    return { status: "cancelled", reasonCode: "submit_declined", sources: [], selected: null };
  }

  if (!input.payProfile?.mileage_eligible) {
    return { status: "ineligible", reasonCode: "not_mileage_eligible", sources: [], selected: null };
  }

  const evaluationsByShift = new Map(input.evaluations.map((evaluation) => [evaluation.shift_id, evaluation]));
  const missingEval = input.workedShifts.find((shift) => !evaluationsByShift.has(shift.shift_id));
  if (missingEval) {
    return { status: "review_required", reasonCode: "missing_post_shoot_evaluation", sources: [], selected: null };
  }

  const studio = getStudioLocation();
  const sources = input.evaluations.map((evaluation) => {
    // C7 tri-state: an explicit yes (submit_for_mileage) is always eligible —
    // in-form answers need no writer change. On false, "pending" means the
    // question was never answered (honest review state), "declined" means the
    // photographer said no. Flag off = legacy boolean semantics.
    const response = evaluation.submit_for_mileage
      ? "eligible"
      : featureFlags.mileageAnswerPendingV1
        ? evaluation.mileage_response
        : "declined";
    if (response === "pending") {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles: null,
        eligibleForSelection: false,
        reviewReasonCode: "answer_pending"
      });
    }
    if (response === "declined") {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles: null,
        eligibleForSelection: false,
        reviewReasonCode: "submit_declined"
      });
    }

    if (evaluation.vehicle_type === "company_vehicle") {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles: null,
        eligibleForSelection: false,
        reviewReasonCode: "company_vehicle"
      });
    }

    if (evaluation.vehicle_type === "carpool_passenger") {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles: null,
        eligibleForSelection: false,
        reviewReasonCode: "carpool_passenger"
      });
    }

    if (evaluation.vehicle_type === "other_needs_review" || !evaluation.vehicle_type) {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles: null,
        eligibleForSelection: false,
        reviewReasonCode: "other_needs_review"
      });
    }

    if (evaluation.latitude == null || evaluation.longitude == null) {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles: null,
        eligibleForSelection: false,
        reviewReasonCode: "missing_location_coordinates"
      });
    }

    const distanceMiles = haversineMiles(
      studio.latitude,
      studio.longitude,
      evaluation.latitude,
      evaluation.longitude
    );
    const zone = findZoneForDistance(input.zones, distanceMiles);
    if (!zone) {
      return buildSourceRow({
        evaluation,
        zone: null,
        distanceMiles,
        eligibleForSelection: false,
        reviewReasonCode: "missing_zone_match"
      });
    }

    return buildSourceRow({
      evaluation,
      zone,
      distanceMiles,
      eligibleForSelection: true,
      reviewReasonCode: null
    });
  });

  const selected = chooseHighestZoneSource(sources);
  if (selected) {
    return { status: "candidate", reasonCode: null, sources, selected };
  }

  const reviewSource = sources.find((source) =>
    ["answer_pending", "other_needs_review", "missing_location_coordinates", "missing_zone_match"].includes(
      String(source.reviewReasonCode)
    )
  );
  if (reviewSource?.reviewReasonCode) {
    return { status: "review_required", reasonCode: reviewSource.reviewReasonCode, sources, selected: null };
  }

  const ineligibleReason =
    sources.find((source) => source.reviewReasonCode === "company_vehicle")?.reviewReasonCode ??
    sources.find((source) => source.reviewReasonCode === "carpool_passenger")?.reviewReasonCode ??
    sources.find((source) => source.reviewReasonCode === "submit_declined")?.reviewReasonCode ??
    "no_eligible_personal_vehicle_submission";

  return { status: "ineligible", reasonCode: ineligibleReason, sources, selected: null };
}

async function deleteExistingSources(client: PoolClient, reimbursementId: string) {
  await client.query("DELETE FROM mileage_reimbursement_source WHERE reimbursement_id = $1", [reimbursementId]);
}

async function insertSources(client: PoolClient, tenantId: string, reimbursementId: string, sources: SourceComputation[]) {
  for (const source of sources) {
    await client.query(
      `
        INSERT INTO mileage_reimbursement_source (
          tenant_id,
          reimbursement_id,
          evaluation_id,
          shift_id,
          shoot_id,
          organization_id,
          location_id,
          zone_id,
          zone_name,
          studio_distance_miles,
          reimbursement_amount,
          submit_for_mileage,
          vehicle_type,
          eligible_for_selection,
          review_reason_code
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `,
      [
        tenantId,
        reimbursementId,
        source.evaluationId,
        source.shiftId,
        source.shootId,
        source.organizationId,
        source.locationId,
        source.zoneId,
        source.zoneName,
        source.studioDistanceMiles == null ? null : toNumericString(source.studioDistanceMiles),
        toNumericString(source.reimbursementAmount),
        source.submitForMileage,
        source.vehicleType,
        source.eligibleForSelection,
        source.reviewReasonCode
      ]
    );
  }
}

async function upsertReimbursement(client: PoolClient, input: {
  tenantId: string;
  employeeId: string;
  workDate: string;
  summary: ReimbursementComputation;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const existing = await loadExistingReimbursement(client, input.tenantId, input.employeeId, input.workDate);
  const selected = input.summary.selected;
  const previousValues = existing
    ? {
        status: existing.status,
        review_reason_code: existing.review_reason_code,
        reimbursement_amount: existing.reimbursement_amount,
        zone_name: existing.zone_name,
        vehicle_type: existing.vehicle_type,
        linked_shoot_id: existing.linked_shoot_id
      }
    : {};

  const { rows } = await client.query<MileageReimbursementRecord>(
    `
      INSERT INTO mileage_reimbursement (
        tenant_id,
        employee_id,
        work_date,
        selected_evaluation_id,
        linked_shift_id,
        linked_shoot_id,
        organization_id,
        location_id,
        zone_id,
        zone_name,
        studio_distance_miles,
        reimbursement_amount,
        vehicle_type,
        status,
        review_reason_code,
        source_evaluation_count,
        reporting_flags
      )
      VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::mileage_reimbursement_status,$15,$16,$17)
      ON CONFLICT (tenant_id, employee_id, work_date)
      DO UPDATE SET
        selected_evaluation_id = EXCLUDED.selected_evaluation_id,
        linked_shift_id = EXCLUDED.linked_shift_id,
        linked_shoot_id = EXCLUDED.linked_shoot_id,
        organization_id = EXCLUDED.organization_id,
        location_id = EXCLUDED.location_id,
        zone_id = EXCLUDED.zone_id,
        zone_name = EXCLUDED.zone_name,
        studio_distance_miles = EXCLUDED.studio_distance_miles,
        reimbursement_amount = EXCLUDED.reimbursement_amount,
        vehicle_type = EXCLUDED.vehicle_type,
        status = EXCLUDED.status,
        review_reason_code = EXCLUDED.review_reason_code,
        source_evaluation_count = EXCLUDED.source_evaluation_count,
        reporting_flags = EXCLUDED.reporting_flags,
        updated_at = now()
      RETURNING *
    `,
    [
      input.tenantId,
      input.employeeId,
      input.workDate,
      selected?.evaluationId ?? null,
      selected?.shiftId ?? null,
      selected?.shootId ?? null,
      selected?.organizationId ?? null,
      selected?.locationId ?? null,
      selected?.zoneId ?? null,
      selected?.zoneName ?? null,
      selected?.studioDistanceMiles == null ? null : toNumericString(selected.studioDistanceMiles),
      toNumericString(selected?.reimbursementAmount ?? 0),
      selected?.vehicleType ?? null,
      input.summary.status,
      input.summary.reasonCode,
      input.summary.sources.length,
      buildFlags(input.summary.status, input.summary.reasonCode)
    ]
  );

  const reimbursement = rows[0];
  await deleteExistingSources(client, reimbursement.id);
  await insertSources(client, input.tenantId, reimbursement.id, input.summary.sources);

  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.employeeId,
    action: "time_clock.mileage.recalculated",
    entityType: "mileage_reimbursement",
    entityId: reimbursement.id,
    previousValues,
    newValues: {
      status: reimbursement.status,
      review_reason_code: reimbursement.review_reason_code,
      reimbursement_amount: reimbursement.reimbursement_amount,
      zone_name: reimbursement.zone_name,
      vehicle_type: reimbursement.vehicle_type,
      linked_shoot_id: reimbursement.linked_shoot_id
    },
    reasonComment: input.reason ?? null,
    metadata: {
      work_date: input.workDate,
      source_evaluation_count: input.summary.sources.length
    }
  });

  return reimbursement;
}

// G3 (ratified): approved/exported finally get their writer — a dedicated
// governance transition, deliberately NOT routed through upsertReimbursement so
// the recalc can never overwrite a payable decision (the SSA-3 guard's premise).
// Money is unchanged: exports already pay candidate rows; this adds the lock.
const MILEAGE_TRANSITIONS: Record<"approved" | "exported", MileageReimbursementStatus[]> = {
  approved: ["candidate", "review_required"],
  exported: ["approved"]
};

export async function transitionMileageReimbursement(
  client: PoolClient,
  auth: AuthUser,
  input: { reimbursementId: string; toStatus: "approved" | "exported"; reason?: string | null }
) {
  if (input.toStatus === "approved" && !canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "Approving mileage requires payroll management access");
  }
  if (input.toStatus === "exported" && !canFinalizePayroll(auth)) {
    throw new ApiError(403, "Marking mileage exported is an owner-only payroll action");
  }
  const { rows } = await client.query(
    `SELECT * FROM mileage_reimbursement WHERE tenant_id = $1 AND id = $2 LIMIT 1 FOR UPDATE`,
    [auth.tenantId, input.reimbursementId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Mileage reimbursement not found");
  }
  const allowedFrom = MILEAGE_TRANSITIONS[input.toStatus];
  if (!allowedFrom.includes(row.status)) {
    throw new ApiError(409, `Mileage cannot move from '${row.status}' to '${input.toStatus}'`, {
      code: "mileage_invalid_transition",
      status: row.status
    });
  }
  const updated = await client.query(
    `UPDATE mileage_reimbursement
     SET status = $3::mileage_reimbursement_status, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [auth.tenantId, input.reimbursementId, input.toStatus]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: row.employee_id,
    action: input.toStatus === "approved" ? "time_clock.mileage.approved" : "time_clock.mileage.exported",
    entityType: "mileage_reimbursement",
    entityId: input.reimbursementId,
    previousValues: { status: row.status },
    newValues: { status: input.toStatus },
    reasonComment: input.reason ?? null,
    metadata: { work_date: row.work_date }
  });
  return updated.rows[0];
}

// G3: per-employee mileage reconciliation for the payroll period containing the
// anchor date — canonical mileage_reimbursement vs legacy mileage_claim totals,
// the period-bound version of the list view's global transition block.
export async function getMileageReconciliationSummary(
  client: PoolClient,
  auth: AuthUser,
  input: { anchorDate: string }
) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "Mileage reconciliation requires payroll management access");
  }
  const calendar = await getPayrollCalendarConfig(client, auth.tenantId);
  const bounds = getPayrollPeriodBounds(calendar, input.anchorDate);
  const { rows } = await client.query(
    `
      WITH canonical AS (
        SELECT employee_id, COUNT(*)::int AS canonical_day_count,
               SUM(COALESCE(reimbursement_amount, 0)) AS canonical_total,
               COUNT(*) FILTER (WHERE status = 'review_required')::int AS review_required_count,
               COUNT(*) FILTER (WHERE status IN ('approved', 'exported'))::int AS approved_or_exported_count
        FROM mileage_reimbursement
        WHERE tenant_id = $1 AND work_date BETWEEN $2::date AND $3::date
        GROUP BY employee_id
      ),
      legacy AS (
        SELECT mc.user_id AS employee_id, COUNT(*)::int AS legacy_claim_count,
               SUM(COALESCE(mc.reimbursement_amount, 0)) AS legacy_total
        FROM mileage_claim mc
        JOIN shoot s ON s.id = mc.shoot_id
        WHERE mc.tenant_id = $1 AND s.shoot_date BETWEEN $2::date AND $3::date
        GROUP BY mc.user_id
      )
      SELECT
        COALESCE(c.employee_id, l.employee_id)::text AS employee_id,
        au.full_name AS employee_name,
        COALESCE(c.canonical_day_count, 0) AS canonical_day_count,
        COALESCE(c.canonical_total, 0)::numeric(10,2)::text AS canonical_total,
        COALESCE(c.review_required_count, 0) AS review_required_count,
        COALESCE(c.approved_or_exported_count, 0) AS approved_or_exported_count,
        COALESCE(l.legacy_claim_count, 0) AS legacy_claim_count,
        COALESCE(l.legacy_total, 0)::numeric(10,2)::text AS legacy_total,
        (COALESCE(c.canonical_total, 0) - COALESCE(l.legacy_total, 0))::numeric(10,2)::text AS amount_delta,
        (ABS(COALESCE(c.canonical_total, 0) - COALESCE(l.legacy_total, 0)) < 0.01) AS amount_match
      FROM canonical c
      FULL OUTER JOIN legacy l ON l.employee_id = c.employee_id
      JOIN app_user au ON au.id = COALESCE(c.employee_id, l.employee_id)
      ORDER BY ABS(COALESCE(c.canonical_total, 0) - COALESCE(l.legacy_total, 0)) DESC, au.full_name ASC
    `,
    [auth.tenantId, bounds.start, bounds.end]
  );
  return {
    period_start: bounds.start,
    period_end: bounds.end,
    source: {
      canonical: "mileage_reimbursement",
      legacy: "mileage_claim (retirement comparison)"
    },
    employee_count: rows.length,
    mismatch_count: rows.filter((row: { amount_match: boolean }) => !row.amount_match).length,
    rows
  };
}

export async function recalculateMileageForEmployeeDate(client: PoolClient, input: {
  tenantId: string;
  employeeId: string;
  workDate: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const payProfile = await loadActivePayProfile(client, input.tenantId, input.employeeId, input.workDate);
  const workedShifts = await loadWorkedShootShifts(client, input.tenantId, input.employeeId, input.workDate);
  const evaluations = await loadSubmittedEvaluations(client, input.tenantId, input.employeeId, input.workDate);
  const zones = await loadActiveZones(client, input.tenantId, input.workDate);

  const summary = summarizeCandidateStatus({ payProfile, workedShifts, evaluations, zones });
  return upsertReimbursement(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    workDate: input.workDate,
    summary,
    actorUserId: input.actorUserId ?? null,
    reason: input.reason ?? "Mileage reconciliation recalculated"
  });
}

export async function syncMileageReviewForShiftCloseout(client: PoolClient, input: {
  tenantId: string;
  employeeId: string;
  workDate: string;
  actorUserId?: string | null;
}) {
  return recalculateMileageForEmployeeDate(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    workDate: input.workDate,
    actorUserId: input.actorUserId ?? null,
    reason: "Clock-out compliance recalculated mileage review state"
  });
}

export async function getMileageReimbursementForEmployeeDate(client: PoolClient, input: {
  tenantId: string;
  employeeId: string;
  workDate: string;
}): Promise<MileageReimbursementSummary> {
  const [payProfile, reimbursement] = await Promise.all([
    loadActivePayProfile(client, input.tenantId, input.employeeId, input.workDate),
    loadExistingReimbursement(client, input.tenantId, input.employeeId, input.workDate)
  ]);

  if (!reimbursement) {
    return {
      work_date: input.workDate,
      mileage_eligible: Boolean(payProfile?.mileage_eligible),
      status: payProfile?.mileage_eligible ? "not_applicable" : "ineligible",
      review_reason_code: payProfile?.mileage_eligible ? null : "not_mileage_eligible",
      reimbursement_amount: null,
      zone_name: null,
      vehicle_type: null,
      studio_distance_miles: null,
      issue_label: payProfile?.mileage_eligible ? null : reasonLabel("not_mileage_eligible"),
      selected_shoot: null
    };
  }

  return {
    work_date: reimbursement.work_date,
    mileage_eligible: Boolean(payProfile?.mileage_eligible),
    status: reimbursement.status,
    review_reason_code: reimbursement.review_reason_code,
    reimbursement_amount: reimbursement.reimbursement_amount,
    zone_name: reimbursement.zone_name,
    vehicle_type: reimbursement.vehicle_type,
    studio_distance_miles: reimbursement.studio_distance_miles == null ? null : Number(reimbursement.studio_distance_miles),
    issue_label: reasonLabel(reimbursement.review_reason_code),
    selected_shoot: reimbursement.linked_shoot_id
      ? {
          id: reimbursement.linked_shoot_id,
          shoot_code: reimbursement.linked_shoot_code ?? null,
          title: reimbursement.linked_shoot_title ?? null
        }
      : null
  };
}

export async function listMileageReimbursements(client: PoolClient, auth: AuthUser, filters: {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: MileageReimbursementStatus | "all";
  userId?: string;
} = {}): Promise<MileageReimbursementListPayload> {
  const values: unknown[] = [auth.tenantId];
  const where = ["mr.tenant_id = $1"];

  if (filters.date) {
    values.push(filters.date);
    where.push(`mr.work_date = $${values.length}::date`);
  } else {
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      where.push(`mr.work_date >= $${values.length}::date`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      where.push(`mr.work_date <= $${values.length}::date`);
    }
  }

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    where.push(`mr.status = $${values.length}::mileage_reimbursement_status`);
  }

  if (filters.userId && !shouldRestrictShiftList(auth)) {
    values.push(filters.userId);
    where.push(`mr.employee_id = $${values.length}::uuid`);
  } else if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`mr.employee_id = $${values.length}::uuid`);
  }

  const { rows } = await client.query<MileageReimbursementRecord>(
    `
      SELECT
        mr.*,
        employee.full_name AS employee_name,
        s.title AS linked_shoot_title,
        s.shoot_code AS linked_shoot_code,
        org.display_name AS organization_display_name,
        sl.name AS location_name
      FROM mileage_reimbursement mr
      JOIN app_user employee
        ON employee.id = mr.employee_id
      LEFT JOIN shoot s
        ON s.id = mr.linked_shoot_id
      LEFT JOIN organization org
        ON org.id = mr.organization_id
      LEFT JOIN shoot_location sl
        ON sl.id = mr.location_id
      WHERE ${where.join(" AND ")}
      ORDER BY mr.work_date DESC, employee.full_name ASC
    `,
    values
  );

  const reimbursementIds = rows.map((row) => row.id);
  const sourceRows = reimbursementIds.length
    ? (
        await client.query<MileageReimbursementSourceRecord>(
          `
            SELECT
              mrs.*,
              s.title AS shoot_title,
              s.shoot_code,
              org.display_name AS organization_display_name,
              sl.name AS location_name
            FROM mileage_reimbursement_source mrs
            LEFT JOIN shoot s
              ON s.id = mrs.shoot_id
            LEFT JOIN organization org
              ON org.id = mrs.organization_id
            LEFT JOIN shoot_location sl
              ON sl.id = mrs.location_id
            WHERE mrs.tenant_id = $1
              AND mrs.reimbursement_id = ANY($2::uuid[])
            ORDER BY mrs.created_at ASC
          `,
          [auth.tenantId, reimbursementIds]
        )
      ).rows
    : [];

  const legacyComparisonRows = await loadLegacyMileageClaimComparison(client, auth, {
    date: filters.date,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    userId: filters.userId
  });

  const sourceMap = new Map<string, MileageReimbursementSourceRecord[]>();
  for (const source of sourceRows) {
    const group = sourceMap.get(source.reimbursement_id) ?? [];
    group.push(source);
    sourceMap.set(source.reimbursement_id, group);
  }

  const legacyComparisonByDay = new Map(
    legacyComparisonRows.map((row) => [`${row.employee_id}:${row.work_date}`, row] as const)
  );
  const rowPayloads: MileageReimbursementListRow[] = rows.map((row) => {
    const legacyComparison = legacyComparisonByDay.get(`${row.employee_id}:${row.work_date}`) ?? {
      employee_id: row.employee_id,
      work_date: row.work_date,
      claim_count: 0,
      total_amount: "0.00"
    };
    const reimbursementAmountDelta = Number(
      (Number(row.reimbursement_amount ?? 0) - Number(legacyComparison.total_amount ?? 0)).toFixed(2)
    );
    const transitionFlags = [
      ...(Number(legacyComparison.claim_count ?? 0) === 0 &&
      row.status !== "ineligible" &&
      row.status !== "cancelled"
        ? ["legacy_mileage_claim_missing"]
        : []),
      ...(Number(legacyComparison.claim_count ?? 0) > 0 && reimbursementAmountDelta !== 0
        ? ["legacy_mileage_amount_mismatch"]
        : [])
    ];

    return {
      ...row,
      review_reason_label: reasonLabel(row.review_reason_code),
      sources: (sourceMap.get(row.id) ?? []).map((source) => ({
        ...source,
        review_reason_label: reasonLabel(source.review_reason_code)
      })),
      legacy_comparison: {
        claim_count: Number(legacyComparison.claim_count ?? 0),
        total_amount: Number(Number(legacyComparison.total_amount ?? 0).toFixed(2)),
        reimbursement_amount_delta: reimbursementAmountDelta,
        amount_match: reimbursementAmountDelta === 0
      },
      transition_flags: transitionFlags
    };
  });

  const canonicalKeys = new Set(rowPayloads.map((row) => `${row.employee_id}:${row.work_date}`));

  return {
    source_of_truth: {
      primary_model: "canonical_mileage_reimbursement",
      canonical_records: ["mileage_reimbursement", "mileage_reimbursement_source", "post_shoot_evaluation"],
      legacy_compatibility_records: ["mileage_claim"]
    },
    summary: {
      total_days: rows.length,
      candidate_count: rows.filter((row) => row.status === "candidate").length,
      review_required_count: rows.filter((row) => row.status === "review_required").length,
      ineligible_count: rows.filter((row) => row.status === "ineligible").length,
      total_candidate_amount: Number(
        rows
          .filter((row) => row.status === "candidate")
          .reduce((sum, row) => sum + Number(row.reimbursement_amount ?? 0), 0)
          .toFixed(2)
      )
    },
    transition: {
      legacy_mileage_claim_summary: {
        claim_count: legacyComparisonRows.reduce((sum, row) => sum + Number(row.claim_count ?? 0), 0),
        total_amount: Number(
          legacyComparisonRows.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0).toFixed(2)
        )
      },
      comparison: {
        mismatch_day_count: rowPayloads.filter((row) => row.transition_flags.includes("legacy_mileage_amount_mismatch")).length,
        canonical_only_day_count: rowPayloads.filter((row) => row.transition_flags.includes("legacy_mileage_claim_missing")).length,
        legacy_only_day_count: legacyComparisonRows.filter((row) => !canonicalKeys.has(`${row.employee_id}:${row.work_date}`)).length
      }
    },
    rows: rowPayloads
  };
}

export async function getMileageZoneCatalog(client: PoolClient, tenantId: string, workDate: string) {
  const zones = await loadActiveZones(client, tenantId, workDate);
  return zones.map((zone) => ({
    id: zone.id,
    zone_name: zone.zone_name,
    min_distance: zone.min_distance,
    max_distance: zone.max_distance,
    reimbursement_amount: zone.reimbursement_amount,
    active_status: true,
    effective_date: zone.effective_date
  }));
}

export function assertMileageVehicleTypeForSubmission(
  submitForMileage: boolean,
  vehicleType: MileageVehicleType | null | undefined
) {
  if (submitForMileage && !vehicleType) {
    throw new ApiError(400, "Submitting for mileage requires a vehicle type.");
  }
}
