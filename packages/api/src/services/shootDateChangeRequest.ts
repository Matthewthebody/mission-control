import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { ApiError } from "../errors/apiError.js";
import { hasAuthorityTier } from "../authz/authority.js";

// June 18 feedback — auditable Shoot date-change workflow. Creating a request NEVER mutates the
// Shoot; the booked date is immutable history (captured on the request + the append-only event log).
// The requested date becomes final only when an authorized approver applies it through the canonical
// scheduling mutation, which still preserves the original date in history. Feasibility reuses
// canonical Shoot/staffing data and reports honestly (equipment has no canonical source → unavailable).

const STATUS = {
  requested: "requested",
  feasibility_review: "feasibility_review",
  alternatives_required: "alternatives_required",
  awaiting_client: "awaiting_client",
  approved: "approved",
  declined: "declined",
  canceled: "canceled",
  completed: "completed"
} as const;
export type DateChangeStatus = (typeof STATUS)[keyof typeof STATUS];

// allowed forward transitions (canceled is reachable from any open state).
const ALLOWED: Record<string, DateChangeStatus[]> = {
  requested: ["feasibility_review", "canceled"],
  feasibility_review: ["alternatives_required", "awaiting_client", "approved", "declined", "canceled"],
  alternatives_required: ["awaiting_client", "feasibility_review", "declined", "canceled"],
  awaiting_client: ["approved", "declined", "alternatives_required", "canceled"],
  approved: ["completed", "canceled"],
  declined: [],
  canceled: [],
  completed: []
};

function canApprove(auth: AuthUser): boolean {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

async function logEvent(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  event: { event_type: string; from_status?: string | null; to_status?: string | null; reason?: string | null; communication_reference?: string | null; metadata?: Record<string, unknown> }
) {
  await client.query(
    `INSERT INTO shoot_date_change_event (tenant_id, request_id, event_type, from_status, to_status, reason, communication_reference, metadata, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [auth.tenantId, requestId, event.event_type, event.from_status ?? null, event.to_status ?? null, event.reason ?? null, event.communication_reference ?? null, JSON.stringify(event.metadata ?? {}), auth.id]
  );
}

export type CreateDateChangeInput = {
  shoot_id: string;
  requested_shoot_date: string;
  request_reason?: string | null;
  request_source?: string | null;
  requested_by_contact_id?: string | null;
  requested_by_user_id?: string | null;
  client_communication_reference?: string | null;
  idempotency_key?: string | null;
};

export async function createDateChangeRequest(client: PoolClient, auth: AuthUser, input: CreateDateChangeInput) {
  // retry-safe: an identical idempotency key returns the existing request, never a duplicate.
  if (input.idempotency_key) {
    const existing = await client.query(`SELECT * FROM shoot_date_change_request WHERE tenant_id=$1 AND idempotency_key=$2`, [auth.tenantId, input.idempotency_key]);
    if (existing.rows[0]) return { request: existing.rows[0], created: false };
  }
  // capture the IMMUTABLE booked date from the canonical shoot (tenant-scoped).
  const shoot = (await client.query<{ id: string; shoot_date: string; record_state: string }>(`SELECT id::text, shoot_date::text, record_state::text FROM shoot WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`, [auth.tenantId, input.shoot_id])).rows[0];
  if (!shoot) throw new ApiError(404, "Shoot not found in this tenant.");

  const inserted = (
    await client.query(
      `INSERT INTO shoot_date_change_request
         (tenant_id, shoot_id, job_id, original_shoot_date, requested_shoot_date, requested_by_contact_id, requested_by_user_id,
          request_source, request_reason, client_communication_reference, current_status, idempotency_key, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,'requested',$10,$11,$11)
       RETURNING *`,
      [auth.tenantId, input.shoot_id, shoot.shoot_date, input.requested_shoot_date, input.requested_by_contact_id ?? null, input.requested_by_user_id ?? null, input.request_source ?? "manual", input.request_reason ?? null, input.client_communication_reference ?? null, input.idempotency_key ?? null, auth.id]
    )
  ).rows[0];
  await logEvent(client, auth, inserted.id, { event_type: "created", to_status: "requested", reason: input.request_reason, communication_reference: input.client_communication_reference, metadata: { requested_shoot_date: input.requested_shoot_date, original_shoot_date: shoot.shoot_date } });
  // creating a request does NOT change the shoot date — verified by callers/tests.
  return { request: inserted, created: true };
}

export async function runDateChangeFeasibility(client: PoolClient, auth: AuthUser, requestId: string) {
  const req = (await client.query(`SELECT * FROM shoot_date_change_request WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId])).rows[0];
  if (!req) throw new ApiError(404, "Date-change request not found.");

  // Schedule conflict: the same organization already has a published shoot on the requested date.
  const conflict = (
    await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM shoot s
        WHERE s.tenant_id=$1 AND s.deleted_at IS NULL AND s.record_state='published' AND s.id<>$2
          AND s.shoot_date=$3::date
          AND s.organization_id = (SELECT organization_id FROM shoot WHERE tenant_id=$1 AND id=$2)`,
      [auth.tenantId, req.shoot_id, req.requested_shoot_date]
    )
  ).rows[0];
  const scheduleConflict = Number(conflict.n) > 0 ? "conflict" : "ok";

  // Capacity: tenant-wide published shoot load on the requested date (heuristic over canonical shoots).
  const load = (await client.query<{ n: string }>(`SELECT count(*)::text n FROM shoot WHERE tenant_id=$1 AND deleted_at IS NULL AND record_state='published' AND shoot_date=$2::date`, [auth.tenantId, req.requested_shoot_date])).rows[0];
  const capacity = Number(load.n) >= 8 ? "warning" : "ok";

  // Staffing must be re-verified on a moved date; we surface that honestly rather than assume.
  const staffing = "review_required";
  // No canonical equipment/camera-capacity source exists — report unavailable, never fabricate.
  const equipment = "unavailable";

  const affected = (
    await client.query(
      `SELECT id::text AS shoot_id, shoot_code, title, shoot_date::text FROM shoot
        WHERE tenant_id=$1 AND deleted_at IS NULL AND record_state='published' AND shoot_date=$2::date AND id<>$3`,
      [auth.tenantId, req.requested_shoot_date, req.shoot_id]
    )
  ).rows;

  await client.query(
    `UPDATE shoot_date_change_request
        SET capacity_result=$3, staffing_result=$4, equipment_result=$5, schedule_conflict_result=$6,
            affected_bookings=$7::jsonb,
            current_status = CASE WHEN current_status='requested' THEN 'feasibility_review' ELSE current_status END,
            updated_by_user_id=$8, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [auth.tenantId, requestId, capacity, staffing, equipment, scheduleConflict, JSON.stringify(affected), auth.id]
  );
  await logEvent(client, auth, requestId, { event_type: "feasibility", from_status: req.current_status, to_status: "feasibility_review", metadata: { capacity, staffing, equipment, schedule_conflict: scheduleConflict, affected_count: affected.length } });

  const overall = scheduleConflict === "conflict" ? "unavailable" : capacity === "warning" || staffing === "review_required" || equipment === "unavailable" ? "feasible_with_warnings" : "feasible";
  return { overall, capacity_result: capacity, staffing_result: staffing, equipment_result: equipment, schedule_conflict_result: scheduleConflict, affected_bookings: affected };
}

export async function recordDateChangeAlternative(client: PoolClient, auth: AuthUser, requestId: string, alternative: Record<string, unknown>) {
  const req = (await client.query(`SELECT current_status FROM shoot_date_change_request WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId])).rows[0];
  if (!req) throw new ApiError(404, "Date-change request not found.");
  await client.query(
    `UPDATE shoot_date_change_request SET alternatives_offered = alternatives_offered || $3::jsonb, updated_by_user_id=$4, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
    [auth.tenantId, requestId, JSON.stringify([alternative]), auth.id]
  );
  await logEvent(client, auth, requestId, { event_type: "alternative", from_status: req.current_status, to_status: req.current_status, metadata: alternative });
  return { recorded: true };
}

export async function transitionDateChange(client: PoolClient, auth: AuthUser, requestId: string, toStatus: DateChangeStatus, opts: { reason?: string | null; communication_reference?: string | null } = {}) {
  const req = (await client.query(`SELECT current_status FROM shoot_date_change_request WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId])).rows[0];
  if (!req) throw new ApiError(404, "Date-change request not found.");
  const allowed = ALLOWED[req.current_status] ?? [];
  if (!allowed.includes(toStatus)) throw new ApiError(409, `Cannot move a ${req.current_status} request to ${toStatus}.`);
  await client.query(`UPDATE shoot_date_change_request SET current_status=$3, client_communication_reference = COALESCE($4, client_communication_reference), updated_by_user_id=$5, updated_at=now() WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId, toStatus, opts.communication_reference ?? null, auth.id]);
  await logEvent(client, auth, requestId, { event_type: "transition", from_status: req.current_status, to_status: toStatus, reason: opts.reason, communication_reference: opts.communication_reference });
  return { from: req.current_status, to: toStatus };
}

export async function decideDateChange(client: PoolClient, auth: AuthUser, requestId: string, decision: "approved" | "declined" | "canceled", opts: { final_shoot_date?: string | null; reason?: string | null } = {}) {
  if (!canApprove(auth)) throw new ApiError(403, "Only leadership can approve or decline a date change.");
  const req = (await client.query(`SELECT * FROM shoot_date_change_request WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId])).rows[0];
  if (!req) throw new ApiError(404, "Date-change request not found.");
  if (["completed", "declined", "canceled"].includes(req.current_status)) throw new ApiError(409, "This request is already finalized.");

  if (decision === "approved") {
    const finalDate = opts.final_shoot_date ?? req.requested_shoot_date;
    await client.query(
      `UPDATE shoot_date_change_request SET decision='approved', approved_by_user_id=$3, decided_at=now(), final_shoot_date=$4::date, current_status='completed', updated_by_user_id=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [auth.tenantId, requestId, auth.id, finalDate]
    );
    // Apply the approved change to the canonical shoot. The ORIGINAL date stays in the request row +
    // the event log; the shoot's publish-time dated_commitment is write-once and untouched.
    await client.query(`UPDATE shoot SET shoot_date=$3::date, updated_by_user_id=$4, updated_at=now() WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, req.shoot_id, finalDate, auth.id]);
    await logEvent(client, auth, requestId, { event_type: "decision", from_status: req.current_status, to_status: "completed", reason: opts.reason, metadata: { decision: "approved", original_shoot_date: req.original_shoot_date, final_shoot_date: finalDate } });
    return { decision: "approved", final_shoot_date: finalDate, original_shoot_date: req.original_shoot_date };
  }
  const toStatus = decision === "declined" ? "declined" : "canceled";
  await client.query(`UPDATE shoot_date_change_request SET decision=$3, approved_by_user_id=$4, decided_at=now(), current_status=$5, updated_by_user_id=$4, updated_at=now() WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId, decision, auth.id, toStatus]);
  await logEvent(client, auth, requestId, { event_type: "decision", from_status: req.current_status, to_status: toStatus, reason: opts.reason, metadata: { decision } });
  return { decision, original_shoot_date: req.original_shoot_date };
}

export async function getDateChangeRequest(client: PoolClient, auth: AuthUser, requestId: string) {
  const request = (await client.query(`SELECT * FROM shoot_date_change_request WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, requestId])).rows[0];
  if (!request) return null;
  const events = (await client.query(`SELECT * FROM shoot_date_change_event WHERE tenant_id=$1 AND request_id=$2 ORDER BY created_at ASC`, [auth.tenantId, requestId])).rows;
  return { request, events };
}

export async function listDateChangeRequestsForShoot(client: PoolClient, auth: AuthUser, shootId: string) {
  const rows = (await client.query(`SELECT * FROM shoot_date_change_request WHERE tenant_id=$1 AND shoot_id=$2 ORDER BY created_at DESC`, [auth.tenantId, shootId])).rows;
  return { requests: rows };
}
