import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { ApiError } from "../errors/apiError.js";
import { recalculateMileageForEmployeeDate } from "./timeClockMileage.js";

// SSA-3 — record the "Are you eligible for mileage reimbursement for this shoot?" answer AFTER
// eval submission. The answer's canonical home already exists: post_shoot_evaluation's own
// submit_for_mileage + vehicle_type fields, which the canonical mileage recalc reads to derive
// mileage_reimbursement.status (declined ⇒ status 'ineligible', reason 'submit_declined'). This
// service therefore writes NO new store: it updates the caller's OWN evaluation and re-runs the
// idempotent canonical recalc. No eval ⇒ 409 — mileage eligibility cannot exist before the eval,
// which is exactly Matthew's rule. Payable transitions (approved/exported) are untouched (G3).

export type MileageVehicleTypeInput =
  | "personal_vehicle"
  | "carpool_passenger"
  | "company_vehicle"
  | "other_needs_review";

export type MileageEligibilityResponseResult = {
  recorded: "eligible" | "declined";
  evaluation_id: string;
  shoot_id: string;
  employee_id: string;
  work_date: string;
  vehicle_type: MileageVehicleTypeInput | null;
  // Honest canonical readiness echo, read back from mileage_reimbursement AFTER the recalc —
  // never a payable claim ('candidate' means eligible-for-review, not paid).
  mileage: { status: string; review_reason_code: string | null } | null;
};

export async function recordMileageEligibilityResponse(
  client: PoolClient,
  auth: AuthUser,
  input: { shootId?: string | null; shiftId?: string | null; eligible: boolean; vehicleType?: MileageVehicleTypeInput | null }
): Promise<MileageEligibilityResponseResult> {
  // Self-only by construction: the employee identity is ALWAYS the authenticated user. Answering
  // on behalf of another photographer is deliberately unsupported in this slice.
  if (input.eligible && !input.vehicleType) {
    throw new ApiError(400, "vehicle_type is required when you are eligible for mileage reimbursement.");
  }
  // shift_id is the PRECISE key (the eval is unique per shift+photographer); shoot_id remains
  // supported for shoot-context callers and resolves to the caller's latest eval on that shoot.
  if (!input.shootId && !input.shiftId) {
    throw new ApiError(400, "Provide shoot_id or shift_id.");
  }

  const params: unknown[] = [auth.tenantId, auth.id];
  let recordFilter: string;
  if (input.shiftId) {
    params.push(input.shiftId);
    recordFilter = `AND shift_id = $${params.length}`;
  } else {
    params.push(input.shootId);
    recordFilter = `AND shoot_id = $${params.length}`;
  }
  const { rows } = await client.query<{ id: string; shoot_date: string; shoot_id: string | null }>(
    `
      SELECT id, shoot_date::text AS shoot_date, shoot_id
      FROM post_shoot_evaluation
      WHERE tenant_id = $1
        AND photographer_user_id = $2
        ${recordFilter}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params
  );
  const evaluation = rows[0];
  if (!evaluation) {
    throw new ApiError(
      409,
      "Post-shoot evaluation is required before mileage eligibility can be recorded for this shoot.",
      { code: "post_shoot_evaluation_required" }
    );
  }

  // G3 boundary, ENFORCED (not just documented): once payroll has approved or exported the
  // mileage for this date, a photographer's answer must not silently recompute it back down —
  // the recalc's upsert would otherwise overwrite the payable status unconditionally.
  const existing = await client.query<{ status: string }>(
    `
      SELECT status::text AS status
      FROM mileage_reimbursement
      WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date
    `,
    [auth.tenantId, auth.id, evaluation.shoot_date]
  );
  const existingStatus = existing.rows[0]?.status ?? null;
  if (existingStatus === "approved" || existingStatus === "exported") {
    throw new ApiError(
      409,
      "Mileage for this date has already been approved or processed by payroll. Contact payroll to change it.",
      { code: "mileage_already_processed", status: existingStatus }
    );
  }

  // Idempotent by construction: the same answer rewrites the same fields; a changed answer is a
  // legitimate correction and simply recalculates.
  await client.query(
    `
      UPDATE post_shoot_evaluation
      SET submit_for_mileage = $2,
          vehicle_type = $3::mileage_vehicle_type
      WHERE id = $1
    `,
    [evaluation.id, input.eligible, input.eligible ? input.vehicleType : null]
  );

  await recalculateMileageForEmployeeDate(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    workDate: evaluation.shoot_date,
    actorUserId: auth.id,
    reason: `Mileage eligibility response: ${input.eligible ? "eligible" : "declined"}`
  });

  const readiness = await client.query<{ status: string; review_reason_code: string | null }>(
    `
      SELECT status::text AS status, review_reason_code::text AS review_reason_code
      FROM mileage_reimbursement
      WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date
    `,
    [auth.tenantId, auth.id, evaluation.shoot_date]
  );

  return {
    recorded: input.eligible ? "eligible" : "declined",
    evaluation_id: evaluation.id,
    shoot_id: input.shootId ?? evaluation.shoot_id ?? "",
    employee_id: auth.id,
    work_date: evaluation.shoot_date,
    vehicle_type: input.eligible ? (input.vehicleType ?? null) : null,
    mileage: readiness.rows[0] ?? null
  };
}
