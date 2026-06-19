import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import {
  computeAcknowledgmentDueAt,
  evaluateAcknowledgmentUrgency,
  isAcknowledgmentOverdue,
  isPastPublicationGrace,
  isWithinEscalationWindow
} from "../domain/staffing/staffing-acknowledgment-policy.js";
import {
  buildRecipientSnapshot,
  computePlanHash,
  computeRecipientHash,
  normalizePlan,
  STAFFING_PLAN_HASH_VERSION,
  STAFFING_PLAN_SNAPSHOT_SCHEMA_VERSION,
  type RecipientPackageInput
} from "../domain/staffing/staffing-plan-hash.js";
import { createAppEvent } from "./outbox.js";
import { createAuditLog } from "./audit.js";

// Versioned staffing publish + per-recipient acknowledgment lifecycle.
// Writes the immutable per-shoot version ledger (staffing_plan_version) and the per-recipient
// state table (staffing_plan_recipient), carries unchanged response states forward, and exposes
// the employee acknowledge/decline transitions. Runs entirely on the caller's transaction client
// (publish wraps this inside the same withClientTransaction as the rest of the publish flow).
// Design: docs/staffing-publish-ack-lifecycle-design.md.

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ShiftPlanRow = {
  source_shift_id: string;
  assigned_user_id: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  requirement_id: string | null;
};

type ShootPlanRow = {
  shoot_date: string | null;
  location_id: string | null;
  location_name: string | null;
  location_address: string | null;
  arrival_time: string | null;
  start_time: string | null;
};

type ShootStaffingPlanInputs = {
  shootDate: string | null;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  shootStartAt: string | null;
  recipients: RecipientPackageInput[];
};

export type StaffingPlanPublicationResult = {
  status: "unchanged" | "created";
  versionId: string;
  version: number;
  planHash: string;
  recipientsCreated: number;
  recipientsCarriedForward: number;
  recipientsNotified: number;
};

type PriorRecipientRow = {
  id: string;
  employee_user_id: string;
  recipient_hash: string;
  hash_version: number;
  response_status: string;
  acknowledgment_due_at: Date | null;
  responded_at: Date | null;
  responded_by_user_id: string | null;
  decline_reason: string | null;
};

type RecipientStateRow = {
  id: string;
  employee_user_id: string;
  response_status: string;
  superseded_at: Date | null;
  recipient_hash: string;
  shoot_id: string;
  staffing_plan_version_id: string;
};

async function loadShootStaffingPlanInputs(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<ShootStaffingPlanInputs> {
  const shootResult = await client.query<ShootPlanRow>(
    `
      SELECT
        shoot_date::text AS shoot_date,
        location_id::text AS location_id,
        location_name,
        location_address,
        arrival_time::text AS arrival_time,
        start_time::text AS start_time
      FROM shoot
      WHERE id = $1 AND tenant_id = $2
    `,
    [shootId, tenantId]
  );
  const shoot = shootResult.rows[0] ?? {
    shoot_date: null,
    location_id: null,
    location_name: null,
    location_address: null,
    arrival_time: null,
    start_time: null
  };

  // NOTE: work_shift.notes is intentionally NOT loaded into the recipient hash. It is surfaced to
  // employees as pre-service highlights that already carry their own content-hash acknowledgment
  // (shift_note_acknowledgement); hashing it here would create a second, overlapping re-ack trigger
  // and risk re-acknowledging internal note usage. A dedicated employee-facing assignment-instructions
  // field can be added and hashed in a later slice.
  const shiftResult = await client.query<ShiftPlanRow>(
    `
      SELECT
        ws.id::text AS source_shift_id,
        ws.assigned_user_id::text AS assigned_user_id,
        ws.staffing_role::text AS staffing_role,
        ws.satisfies_lead_coverage,
        ws.starts_at::text AS starts_at,
        ws.ends_at::text AS ends_at,
        ws.staffing_requirement_id::text AS requirement_id
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.assigned_user_id IS NOT NULL
        AND ws.cancelled_at IS NULL
        AND ws.status IN ('draft', 'published', 'completed')
      ORDER BY ws.assigned_user_id, ws.staffing_requirement_id, ws.starts_at
    `,
    [tenantId, shootId]
  );

  const callTime = shoot.arrival_time ?? shoot.start_time ?? null;
  const byEmployee = new Map<string, RecipientPackageInput>();
  for (const row of shiftResult.rows) {
    const existing = byEmployee.get(row.assigned_user_id);
    const assignment = {
      requirementId: row.requirement_id,
      staffingRole: row.staffing_role,
      satisfiesLeadCoverage: row.satisfies_lead_coverage,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      callTime,
      sourceShiftId: row.source_shift_id
    };
    if (existing) {
      existing.assignments.push(assignment);
    } else {
      byEmployee.set(row.assigned_user_id, {
        employeeUserId: row.assigned_user_id,
        shootDate: shoot.shoot_date,
        locationId: shoot.location_id,
        locationName: shoot.location_name,
        locationAddress: shoot.location_address,
        assignments: [assignment]
      });
    }
  }

  return {
    shootDate: shoot.shoot_date,
    locationId: shoot.location_id,
    locationName: shoot.location_name,
    locationAddress: shoot.location_address,
    shootStartAt: callTime,
    recipients: [...byEmployee.values()]
  };
}

async function loadLatestStaffingPlanVersion(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<{ id: string; version: number; plan_hash: string; hash_version: number } | null> {
  const { rows } = await client.query<{ id: string; version: number; plan_hash: string; hash_version: number }>(
    `
      SELECT id, version, plan_hash, hash_version
      FROM staffing_plan_version
      WHERE tenant_id = $1 AND shoot_id = $2
      ORDER BY version DESC
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  return rows[0] ?? null;
}

/**
 * Atomically record a published staffing-plan version for a shoot. Idempotent: when the
 * normalized plan hash is unchanged it returns the existing version without creating a new
 * one, inserting recipients, or queueing notifications. When changed it creates exactly one
 * next version, inserts every current recipient package (carrying unchanged response states
 * forward with explicit provenance), supersedes the prior version's recipients, and creates a
 * notification-outbox record only for recipients who require a new notification.
 *
 * Must run inside the publish transaction; it locks the shoot row FOR UPDATE so concurrent
 * publishes, double-clicks, and retries cannot create duplicate versions/recipients/notifications.
 */
export async function recordStaffingPlanPublication(
  client: PoolClient,
  auth: AuthUser,
  input: { shootId: string }
): Promise<StaffingPlanPublicationResult> {
  // 1. Lock the shoot / publication boundary.
  await client.query("SELECT id FROM shoot WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [
    input.shootId,
    auth.tenantId
  ]);

  // 2-4. Load current canonical staffing, normalize, compute deterministic hashes.
  const plan = await loadShootStaffingPlanInputs(client, auth.tenantId, input.shootId);
  const planHash = computePlanHash({
    shootId: input.shootId,
    shootDate: plan.shootDate,
    recipients: plan.recipients
  });

  // 5. Idempotent no-op when the plan hash AND the hash algorithm version are unchanged vs the
  // latest version. (A future hash_version bump intentionally falls through to a new version.)
  const latest = await loadLatestStaffingPlanVersion(client, auth.tenantId, input.shootId);
  if (latest && latest.plan_hash === planHash && latest.hash_version === STAFFING_PLAN_HASH_VERSION) {
    return {
      status: "unchanged",
      versionId: latest.id,
      version: latest.version,
      planHash,
      recipientsCreated: 0,
      recipientsCarriedForward: 0,
      recipientsNotified: 0
    };
  }

  // 6. Create exactly one next version.
  const nextVersion = (latest?.version ?? 0) + 1;
  const versionResult = await client.query<{ id: string; published_at: string }>(
    `
      INSERT INTO staffing_plan_version (
        tenant_id, shoot_id, version, plan_hash, hash_version, snapshot_schema_version,
        published_by_user_id, plan_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING id, published_at::text AS published_at
    `,
    [
      auth.tenantId,
      input.shootId,
      nextVersion,
      planHash,
      STAFFING_PLAN_HASH_VERSION,
      STAFFING_PLAN_SNAPSHOT_SCHEMA_VERSION,
      auth.id,
      JSON.stringify(
        normalizePlan({ shootId: input.shootId, shootDate: plan.shootDate, recipients: plan.recipients })
      )
    ]
  );
  const versionRow = versionResult.rows[0];
  const publishedAt = versionRow.published_at;

  // Prior current recipients (for explicit carry-forward).
  const priorRecipients = latest
    ? (
        await client.query<PriorRecipientRow>(
          `
            SELECT
              id,
              employee_user_id::text AS employee_user_id,
              recipient_hash,
              hash_version,
              response_status,
              acknowledgment_due_at,
              responded_at,
              responded_by_user_id::text AS responded_by_user_id,
              decline_reason
            FROM staffing_plan_recipient
            WHERE tenant_id = $1 AND staffing_plan_version_id = $2
          `,
          [auth.tenantId, latest.id]
        )
      ).rows
    : [];
  const priorByEmployee = new Map(priorRecipients.map((row) => [row.employee_user_id, row]));

  const defaultDueAt = computeAcknowledgmentDueAt(publishedAt, plan.shootStartAt);
  let recipientsCreated = 0;
  let recipientsCarriedForward = 0;
  let recipientsNotified = 0;

  // 7-10. Insert every current recipient package; carry unchanged states forward; mark
  // changed/new recipients pending; create an outbox record only for those needing a notification.
  for (const pkg of plan.recipients) {
    const recipientHash = computeRecipientHash(pkg);
    const prior = priorByEmployee.get(pkg.employeeUserId);
    // Carry forward only when the recipient package AND the hash algorithm version both match.
    const carriedForward = Boolean(
      prior && prior.recipient_hash === recipientHash && prior.hash_version === STAFFING_PLAN_HASH_VERSION
    );

    const responseStatus = carriedForward ? prior!.response_status : "pending";
    const dueAt = carriedForward ? prior!.acknowledgment_due_at : defaultDueAt;
    const respondedAt = carriedForward ? prior!.responded_at : null;
    const respondedBy = carriedForward ? prior!.responded_by_user_id : null;
    const declineReason = carriedForward ? prior!.decline_reason : null;
    const carriedFromId = carriedForward ? prior!.id : null;

    const insertResult = await client.query<{ id: string }>(
      `
        INSERT INTO staffing_plan_recipient (
          tenant_id, staffing_plan_version_id, shoot_id, employee_user_id, recipient_hash,
          hash_version, snapshot_schema_version, assignment_snapshot, response_status,
          acknowledgment_due_at, responded_at, responded_by_user_id, decline_reason,
          carried_forward_from_recipient_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)
        RETURNING id
      `,
      [
        auth.tenantId,
        versionRow.id,
        input.shootId,
        pkg.employeeUserId,
        recipientHash,
        STAFFING_PLAN_HASH_VERSION,
        STAFFING_PLAN_SNAPSHOT_SCHEMA_VERSION,
        JSON.stringify(buildRecipientSnapshot(pkg)),
        responseStatus,
        dueAt,
        respondedAt,
        respondedBy,
        declineReason,
        carriedFromId
      ]
    );
    recipientsCreated += 1;

    if (carriedForward) {
      recipientsCarriedForward += 1;
      continue;
    }

    // Notification-outbox record for a recipient who requires a new notification (new or changed).
    await createAppEvent(client, {
      tenantId: auth.tenantId,
      eventType: "staffing.plan.recipient_published",
      aggregateType: "staffing_plan_recipient",
      aggregateId: insertResult.rows[0].id,
      payload: {
        shoot_id: input.shootId,
        version: nextVersion,
        employee_user_id: pkg.employeeUserId,
        recipient_hash: recipientHash,
        response_status: "pending",
        acknowledgment_due_at: dueAt ? new Date(dueAt).toISOString() : null
      },
      dedupeKey: `staffing-publish:${input.shootId}:${nextVersion}:${pkg.employeeUserId}:${recipientHash}`
    });
    recipientsNotified += 1;
  }

  // Supersede the prior version's recipients — they are no longer the current commitment, but
  // remain immutable + queryable as history.
  if (latest) {
    await client.query(
      `
        UPDATE staffing_plan_recipient
        SET superseded_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND staffing_plan_version_id = $2 AND superseded_at IS NULL
      `,
      [auth.tenantId, latest.id]
    );
  }

  return {
    status: "created",
    versionId: versionRow.id,
    version: nextVersion,
    planHash,
    recipientsCreated,
    recipientsCarriedForward,
    recipientsNotified
  };
}

// ---------------------------------------------------------------------------
// Employee self-scoped acknowledgment / decline (Slice 2 sub-slice 3)
// ---------------------------------------------------------------------------
// Self-scoped read model + state machine for the authenticated employee. Exposes ONLY that
// employee's own current published recipient packages — never other employees, manager-only counts,
// plan/recipient hashes, internal audit, or work_shift.notes (that stays on the shift-note ack path).

export type EmployeeStaffingAssignmentState =
  | "awaiting"
  | "needs_attention"
  | "overdue"
  | "acknowledged"
  | "declined"
  | "canceled";

export type EmployeeStaffingAssignment = {
  recipient_id: string;
  shoot_id: string;
  shoot_code: string;
  shoot_title: string;
  organization_name: string | null;
  version: number;
  shoot_date: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  location_name: string | null;
  location_address: string | null;
  assignments: unknown[]; // normalized roles/slots/times (NO work_shift.notes)
  lead_coverage: boolean;
  response_status: string;
  acknowledgment_state: EmployeeStaffingAssignmentState;
  acknowledgment_due_at: string | null;
  responded_at: string | null;
  decline_reason: string | null; // the employee's OWN decline reason only
  carried_forward: boolean;
  can_acknowledge: boolean;
  can_decline: boolean;
  schedule_link: string;
};

type EmployeeAssignmentRow = {
  recipient_id: string;
  shoot_id: string;
  shoot_code: string;
  shoot_title: string;
  organization_name: string | null;
  version: number;
  published_at: string | null;
  shoot_date: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  location_name: string | null;
  location_address: string | null;
  assignment_snapshot: { assignments?: SnapshotAssignment[] };
  response_status: string;
  acknowledgment_due_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  carried_forward_from_recipient_id: string | null;
};

const EMPLOYEE_ASSIGNMENT_COLUMNS = `
  r.id::text AS recipient_id,
  r.shoot_id::text AS shoot_id,
  s.shoot_code,
  s.title AS shoot_title,
  org.display_name AS organization_name,
  v.version,
  v.published_at::text AS published_at,
  s.shoot_date::text AS shoot_date,
  s.arrival_time::text AS arrival_time,
  s.start_time::text AS start_time,
  s.end_time_est::text AS end_time_est,
  s.location_name,
  s.location_address,
  r.assignment_snapshot,
  r.response_status,
  r.acknowledgment_due_at::text AS acknowledgment_due_at,
  r.responded_at::text AS responded_at,
  r.decline_reason,
  r.carried_forward_from_recipient_id::text AS carried_forward_from_recipient_id
`;

function employeeAcknowledgmentState(row: EmployeeAssignmentRow, now: Date): EmployeeStaffingAssignmentState {
  if (row.response_status === "acknowledged") return "acknowledged";
  if (row.response_status === "declined") return "declined";
  if (row.response_status === "canceled") return "canceled";
  // pending — derive the timing state from the centralized policy (the sole timing source).
  const shootStartAt = row.arrival_time ?? row.start_time;
  if (!isPastPublicationGrace(row.published_at, now, shootStartAt)) return "awaiting";
  if (isAcknowledgmentOverdue(row.acknowledgment_due_at, now)) return "overdue";
  if (isWithinEscalationWindow(shootStartAt, now)) return "needs_attention";
  return "awaiting";
}

function buildEmployeeAssignment(row: EmployeeAssignmentRow, now: Date): EmployeeStaffingAssignment {
  const actionable = row.response_status !== "canceled";
  return {
    recipient_id: row.recipient_id,
    shoot_id: row.shoot_id,
    shoot_code: row.shoot_code,
    shoot_title: row.shoot_title,
    organization_name: row.organization_name,
    version: row.version,
    shoot_date: row.shoot_date,
    arrival_time: row.arrival_time,
    start_time: row.start_time,
    end_time_est: row.end_time_est,
    location_name: row.location_name,
    location_address: row.location_address,
    assignments: row.assignment_snapshot.assignments ?? [],
    lead_coverage: snapshotHasLead(row.assignment_snapshot),
    response_status: row.response_status,
    acknowledgment_state: employeeAcknowledgmentState(row, now),
    acknowledgment_due_at: row.acknowledgment_due_at,
    responded_at: row.responded_at,
    decline_reason: row.decline_reason,
    carried_forward: Boolean(row.carried_forward_from_recipient_id),
    can_acknowledge: actionable && row.response_status === "pending",
    can_decline: actionable && (row.response_status === "pending" || row.response_status === "acknowledged"),
    schedule_link: `#my-work?focus_shoot=${row.shoot_id}`
  };
}

/** Self-scoped: the authenticated employee's current published recipient packages for upcoming shoots. */
export async function listEmployeeStaffingAssignments(
  client: PoolClient,
  auth: AuthUser,
  opts: { anchorDate?: string; now?: Date } = {}
): Promise<EmployeeStaffingAssignment[]> {
  const now = opts.now ?? new Date();
  const anchorDate = opts.anchorDate ?? now.toISOString().slice(0, 10);
  const { rows } = await client.query<EmployeeAssignmentRow>(
    `
      SELECT ${EMPLOYEE_ASSIGNMENT_COLUMNS}
      FROM staffing_plan_recipient r
      JOIN staffing_plan_version v ON v.id = r.staffing_plan_version_id
      JOIN shoot s ON s.id = r.shoot_id
      LEFT JOIN organization org ON org.id = s.organization_id
      WHERE r.tenant_id = $1
        AND r.employee_user_id = $2
        AND r.superseded_at IS NULL
        AND r.response_status <> 'canceled'
        AND s.shoot_date >= $3::date
      ORDER BY s.shoot_date ASC, s.arrival_time ASC NULLS LAST
    `,
    [auth.tenantId, auth.id, anchorDate]
  );
  return rows.map((row) => buildEmployeeAssignment(row, now));
}

async function loadEmployeeAssignmentByRecipientId(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string,
  now: Date
): Promise<EmployeeStaffingAssignment | null> {
  const { rows } = await client.query<EmployeeAssignmentRow>(
    `
      SELECT ${EMPLOYEE_ASSIGNMENT_COLUMNS}
      FROM staffing_plan_recipient r
      JOIN staffing_plan_version v ON v.id = r.staffing_plan_version_id
      JOIN shoot s ON s.id = r.shoot_id
      LEFT JOIN organization org ON org.id = s.organization_id
      WHERE r.tenant_id = $1 AND r.id = $2 AND r.employee_user_id = $3
    `,
    [auth.tenantId, recipientId, auth.id]
  );
  return rows[0] ? buildEmployeeAssignment(rows[0], now) : null;
}

async function loadCurrentEmployeeAssignmentForShoot(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  now: Date
): Promise<EmployeeStaffingAssignment | null> {
  const { rows } = await client.query<EmployeeAssignmentRow>(
    `
      SELECT ${EMPLOYEE_ASSIGNMENT_COLUMNS}
      FROM staffing_plan_recipient r
      JOIN staffing_plan_version v ON v.id = r.staffing_plan_version_id
      JOIN shoot s ON s.id = r.shoot_id
      LEFT JOIN organization org ON org.id = s.organization_id
      WHERE r.tenant_id = $1 AND r.shoot_id = $2 AND r.employee_user_id = $3 AND r.superseded_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shootId, auth.id]
  );
  return rows[0] ? buildEmployeeAssignment(rows[0], now) : null;
}

// Load the employee's own recipient and enforce the response guard inside the transaction:
// 404 (missing), 403 (not the owner), or 409 with details.current_package (superseded / canceled —
// no longer the current published version). A stale link can never mutate historical data.
async function loadOwnRecipientForResponse(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string,
  now: Date
): Promise<RecipientStateRow> {
  // FOR UPDATE serializes concurrent acknowledge/decline on the same recipient — exactly one valid
  // transition wins and the other caller evaluates against the committed state (coherent result).
  const { rows } = await client.query<RecipientStateRow>(
    `
      SELECT id, employee_user_id::text AS employee_user_id, response_status, superseded_at,
             recipient_hash, shoot_id::text AS shoot_id, staffing_plan_version_id::text AS staffing_plan_version_id
      FROM staffing_plan_recipient
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `,
    [auth.tenantId, recipientId]
  );
  const recipient = rows[0];
  if (!recipient) {
    throw new ApiError(404, "Staffing assignment not found");
  }
  if (recipient.employee_user_id !== auth.id) {
    throw new ApiError(403, "You can only respond to your own staffing assignment");
  }
  if (recipient.superseded_at || recipient.response_status === "canceled") {
    const current = await loadCurrentEmployeeAssignmentForShoot(client, auth, recipient.shoot_id, now);
    throw new ApiError(409, "This assignment is no longer current. Review the current assignment and respond again.", {
      conflict: "not_current",
      current_package: current
    });
  }
  return recipient;
}

export async function acknowledgeStaffingPlanRecipient(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string,
  meta: RequestMeta = {}
): Promise<EmployeeStaffingAssignment> {
  const now = new Date();
  const recipient = await loadOwnRecipientForResponse(client, auth, recipientId, now);
  // declined -> acknowledged is NOT allowed on the same version; a manager must reassign/republish.
  if (recipient.response_status === "declined") {
    const current = await loadEmployeeAssignmentByRecipientId(client, auth, recipientId, now);
    throw new ApiError(
      409,
      "This assignment was declined. A manager must reassign or republish before it can be acknowledged.",
      { conflict: "declined", current_package: current }
    );
  }
  // pending -> acknowledged (acknowledged -> acknowledged is an idempotent no-op).
  if (recipient.response_status !== "acknowledged") {
    await client.query(
      `
        UPDATE staffing_plan_recipient
        SET response_status = 'acknowledged', responded_at = now(), responded_by_user_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [auth.tenantId, recipientId, auth.id]
    );
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: auth.id,
      action: "schedule.staffing.recipient_acknowledged",
      entityType: "staffing_plan_recipient",
      entityId: recipientId,
      metadata: { shoot_id: recipient.shoot_id, recipient_hash: recipient.recipient_hash },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    await createAppEvent(client, {
      tenantId: auth.tenantId,
      eventType: "staffing.plan.recipient_acknowledged",
      aggregateType: "staffing_plan_recipient",
      aggregateId: recipientId,
      payload: { shoot_id: recipient.shoot_id, employee_user_id: auth.id },
      dedupeKey: `staffing-response:${recipientId}:acknowledged`
    });
  }
  const view = await loadEmployeeAssignmentByRecipientId(client, auth, recipientId, now);
  return view as EmployeeStaffingAssignment;
}

export async function declineStaffingPlanRecipient(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string,
  input: { reason: string },
  meta: RequestMeta = {}
): Promise<EmployeeStaffingAssignment> {
  const now = new Date();
  const reason = input.reason?.trim();
  if (!reason) {
    throw new ApiError(400, "A decline reason is required");
  }
  if (reason.length > 1000) {
    throw new ApiError(400, "Decline reason is too long (max 1000 characters)");
  }
  const recipient = await loadOwnRecipientForResponse(client, auth, recipientId, now);
  // pending / acknowledged -> declined (a later withdrawal). declined -> declined is an idempotent
  // no-op: the original reason is NOT overwritten, so a repeated decline is never an untracked edit.
  if (recipient.response_status !== "declined") {
    await client.query(
      `
        UPDATE staffing_plan_recipient
        SET response_status = 'declined', responded_at = now(), responded_by_user_id = $3,
            decline_reason = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [auth.tenantId, recipientId, auth.id, reason]
    );
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: auth.id,
      action: "schedule.staffing.recipient_declined",
      entityType: "staffing_plan_recipient",
      entityId: recipientId,
      metadata: { shoot_id: recipient.shoot_id, recipient_hash: recipient.recipient_hash, decline_reason: reason },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });
    // Idempotent manager-facing lifecycle marker. The decline is ALSO immediately visible to managers
    // via the canonical readiness exclusion + urgent-watch reconcile; this is NOT a delivered employee
    // notification (no channel/receipt is claimed).
    await createAppEvent(client, {
      tenantId: auth.tenantId,
      eventType: "staffing.plan.recipient_declined",
      aggregateType: "staffing_plan_recipient",
      aggregateId: recipientId,
      payload: { shoot_id: recipient.shoot_id, employee_user_id: auth.id, decline_reason: reason },
      dedupeKey: `staffing-response:${recipientId}:declined`
    });
  }
  const view = await loadEmployeeAssignmentByRecipientId(client, auth, recipientId, now);
  return view as EmployeeStaffingAssignment;
}

export type StaffingPlanRecipientState = {
  id: string;
  staffing_plan_version_id: string;
  version: number;
  employee_user_id: string;
  recipient_hash: string;
  response_status: string;
  acknowledgment_due_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  carried_forward_from_recipient_id: string | null;
  superseded_at: string | null;
};

/** Current (non-superseded) recipient state for a shoot — the read model later UI layers consume. */
export async function listCurrentStaffingPlanRecipients(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<StaffingPlanRecipientState[]> {
  const { rows } = await client.query<StaffingPlanRecipientState>(
    `
      SELECT
        r.id,
        r.staffing_plan_version_id,
        v.version,
        r.employee_user_id::text AS employee_user_id,
        r.recipient_hash,
        r.response_status,
        r.acknowledgment_due_at::text AS acknowledgment_due_at,
        r.responded_at::text AS responded_at,
        r.decline_reason,
        r.carried_forward_from_recipient_id::text AS carried_forward_from_recipient_id,
        r.superseded_at::text AS superseded_at
      FROM staffing_plan_recipient r
      JOIN staffing_plan_version v ON v.id = r.staffing_plan_version_id
      WHERE r.tenant_id = $1 AND r.shoot_id = $2 AND r.superseded_at IS NULL
      ORDER BY r.employee_user_id
    `,
    [tenantId, shootId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Manager staffing-plan lifecycle read model (Slice 2 sub-slice 2)
// ---------------------------------------------------------------------------
// A canonical, derived view over staffing_plan_version + staffing_plan_recipient + the current
// canonical work_shift draft. The draft-vs-published comparison reuses the SAME normalization/hash
// functions as publish (computePlanHash / computeRecipientHash) — no second comparison algorithm.
// Historical (superseded) rows never contaminate current status; all current fields derive from the
// latest published version. work_shift.notes is never exposed here (governed by shift_note_ack).

export type StaffingPlanLifecycleRecipientView = {
  recipient_id: string | null; // null for a draft-only (newly added) employee not yet published
  employee_user_id: string;
  employee_name: string | null;
  version: number | null;
  response_status: string; // pending | acknowledged | declined | canceled | draft (newly added)
  acknowledgment_due_at: string | null;
  responded_at: string | null;
  decline_reason: string | null; // permission-gated; null when the viewer lacks permission
  carried_forward_from_recipient_id: string | null;
  recipient_hash: string | null;
  hash_version: number | null;
  lead_coverage: boolean;
  assignments: unknown[]; // normalized roles/slots/times from assignment_snapshot (NO work_shift.notes)
  coverage_eligible: boolean; // assigned and not declined/canceled
  overdue: boolean;
  draft_change: "unchanged" | "changed" | "newly_added" | "removed" | "declined";
  requires_renewed_acknowledgment: boolean;
  can_carry_forward: boolean;
};

export type StaffingPlanLifecycleView = {
  has_published_version: boolean;
  latest_version: number | null;
  published_at: string | null;
  published_by_user_id: string | null;
  hash_version: number | null;
  snapshot_schema_version: number | null;
  has_draft_changes: boolean;
  republish_required: boolean;
  draft_comparison: "no_published_plan" | "unchanged_since_publish" | "draft_changes_exist";
  planned_staff_count: number;
  required_lead_count: number;
  assigned_staff_count: number; // raw current canonical (draft) distinct employees
  published_recipient_count: number;
  coverage_eligible_staff_count: number;
  pending_acknowledgment_count: number;
  acknowledged_staff_count: number;
  declined_staff_count: number;
  superseded_recipient_count: number;
  lead_assignment_count: number;
  coverage_eligible_lead_count: number;
  acknowledged_lead_count: number;
  next_acknowledgment_due_at: string | null;
  overdue_acknowledgment_count: number;
  needs_acknowledgment_count: number;
  acknowledgment_risk_state: "none" | "awaiting" | "needs_attention" | "overdue";
  coverage_state: "complete" | "incomplete";
  operational_readiness_status: "ready" | "awaiting_acknowledgment" | "confirmation_overdue" | "at_risk";
  recipients: StaffingPlanLifecycleRecipientView[];
};

type SnapshotAssignment = { satisfies_lead_coverage?: boolean };

function snapshotHasLead(snapshot: { assignments?: SnapshotAssignment[] } | null | undefined): boolean {
  return (snapshot?.assignments ?? []).some((assignment) => Boolean(assignment.satisfies_lead_coverage));
}

export async function getStaffingPlanLifecycleView(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  opts: { canViewDeclineReasons?: boolean; now?: Date } = {}
): Promise<StaffingPlanLifecycleView> {
  const now = opts.now ?? new Date();
  const canViewDeclineReasons = opts.canViewDeclineReasons ?? false;

  const shootRow =
    (
      await client.query<{
        planned_staff_count: number | string | null;
        required_lead_count: number | string | null;
        arrival_time: string | null;
        start_time: string | null;
      }>(
        `SELECT planned_staff_count, required_lead_count, arrival_time::text AS arrival_time, start_time::text AS start_time
         FROM shoot WHERE id = $1 AND tenant_id = $2`,
        [shootId, auth.tenantId]
      )
    ).rows[0] ?? { planned_staff_count: 0, required_lead_count: 0, arrival_time: null, start_time: null };
  const plannedStaffCount = Math.max(Number(shootRow.planned_staff_count ?? 0), 0);
  const requiredLeadCount = Math.max(Number(shootRow.required_lead_count ?? 0), 1);
  const shootStartAt = shootRow.arrival_time ?? shootRow.start_time;

  // Latest published version (the current committed plan).
  const versionRow =
    (
      await client.query<{
        id: string;
        version: number;
        plan_hash: string;
        hash_version: number;
        snapshot_schema_version: number;
        published_at: string;
        published_by_user_id: string | null;
      }>(
        `SELECT id, version, plan_hash, hash_version, snapshot_schema_version,
                published_at::text AS published_at, published_by_user_id::text AS published_by_user_id
         FROM staffing_plan_version
         WHERE tenant_id = $1 AND shoot_id = $2
         ORDER BY version DESC LIMIT 1`,
        [auth.tenantId, shootId]
      )
    ).rows[0] ?? null;

  // Current canonical (draft) plan — same normalization/hash used at publish time.
  const draft = await loadShootStaffingPlanInputs(client, auth.tenantId, shootId);
  const draftPlanHash = computePlanHash({ shootId, shootDate: draft.shootDate, recipients: draft.recipients });
  const draftHashByEmployee = new Map(draft.recipients.map((pkg) => [pkg.employeeUserId, computeRecipientHash(pkg)]));

  // Published current recipients (with employee display names).
  const publishedRecipients = versionRow
    ? (
        await client.query<{
          id: string;
          employee_user_id: string;
          employee_name: string | null;
          recipient_hash: string;
          hash_version: number;
          response_status: string;
          acknowledgment_due_at: string | null;
          responded_at: string | null;
          decline_reason: string | null;
          carried_forward_from_recipient_id: string | null;
          assignment_snapshot: { assignments?: SnapshotAssignment[] };
        }>(
          `SELECT r.id, r.employee_user_id::text AS employee_user_id, u.full_name AS employee_name,
                  r.recipient_hash, r.hash_version, r.response_status,
                  r.acknowledgment_due_at::text AS acknowledgment_due_at, r.responded_at::text AS responded_at,
                  r.decline_reason, r.carried_forward_from_recipient_id::text AS carried_forward_from_recipient_id,
                  r.assignment_snapshot
           FROM staffing_plan_recipient r
           LEFT JOIN app_user u ON u.id = r.employee_user_id
           WHERE r.tenant_id = $1 AND r.staffing_plan_version_id = $2
           ORDER BY u.full_name NULLS LAST, r.employee_user_id`,
          [auth.tenantId, versionRow.id]
        )
      ).rows
    : [];

  const supersededCount = Number(
    (
      await client.query<{ n: string }>(
        `SELECT COUNT(*)::int AS n FROM staffing_plan_recipient
         WHERE tenant_id = $1 AND shoot_id = $2 AND superseded_at IS NOT NULL`,
        [auth.tenantId, shootId]
      )
    ).rows[0]?.n ?? 0
  );

  const publishedEmployeeIds = new Set(publishedRecipients.map((row) => row.employee_user_id));
  const newDraftEmployeeIds = draft.recipients
    .map((pkg) => pkg.employeeUserId)
    .filter((employeeId) => !publishedEmployeeIds.has(employeeId));
  const newNameById = new Map<string, string | null>();
  if (newDraftEmployeeIds.length) {
    const names = await client.query<{ id: string; full_name: string | null }>(
      "SELECT id::text AS id, full_name FROM app_user WHERE id = ANY($1::uuid[])",
      [newDraftEmployeeIds]
    );
    for (const row of names.rows) {
      newNameById.set(row.id, row.full_name);
    }
  }

  let needsAcknowledgmentCount = 0;
  const recipients: StaffingPlanLifecycleRecipientView[] = [];
  for (const row of publishedRecipients) {
    const draftHash = draftHashByEmployee.get(row.employee_user_id);
    const declined = row.response_status === "declined";
    const canceled = row.response_status === "canceled";
    // "needs acknowledgment attention" = pending, past grace, and overdue OR inside the escalation
    // window. "overdue" is the stricter deadline-passed subset.
    const urgency = evaluateAcknowledgmentUrgency({
      responseStatus: row.response_status,
      publishedAt: versionRow?.published_at ?? null,
      dueAt: row.acknowledgment_due_at,
      shootStartAt,
      now
    });
    if (urgency.urgent) {
      needsAcknowledgmentCount += 1;
    }
    const overdue = urgency.urgent && isAcknowledgmentOverdue(row.acknowledgment_due_at, now);
    let draftChange: StaffingPlanLifecycleRecipientView["draft_change"];
    if (declined) {
      draftChange = "declined";
    } else if (draftHash === undefined) {
      draftChange = "removed";
    } else if (draftHash === row.recipient_hash) {
      draftChange = "unchanged";
    } else {
      draftChange = "changed";
    }
    recipients.push({
      recipient_id: row.id,
      employee_user_id: row.employee_user_id,
      employee_name: row.employee_name,
      version: versionRow?.version ?? null,
      response_status: row.response_status,
      acknowledgment_due_at: row.acknowledgment_due_at,
      responded_at: row.responded_at,
      decline_reason: canViewDeclineReasons ? row.decline_reason : null,
      carried_forward_from_recipient_id: row.carried_forward_from_recipient_id,
      recipient_hash: row.recipient_hash,
      hash_version: row.hash_version,
      lead_coverage: snapshotHasLead(row.assignment_snapshot),
      assignments: row.assignment_snapshot.assignments ?? [],
      coverage_eligible: !declined && !canceled,
      overdue,
      draft_change: draftChange,
      requires_renewed_acknowledgment: draftChange === "changed" || draftChange === "removed",
      can_carry_forward: draftChange === "unchanged" || draftChange === "declined"
    });
  }
  // Draft-only (newly added) employees assigned in the canonical draft but not in the published version.
  for (const pkg of draft.recipients) {
    if (publishedEmployeeIds.has(pkg.employeeUserId)) {
      continue;
    }
    const snapshot = buildRecipientSnapshot(pkg);
    recipients.push({
      recipient_id: null,
      employee_user_id: pkg.employeeUserId,
      employee_name: newNameById.get(pkg.employeeUserId) ?? null,
      version: null,
      response_status: "draft",
      acknowledgment_due_at: null,
      responded_at: null,
      decline_reason: null,
      carried_forward_from_recipient_id: null,
      recipient_hash: draftHashByEmployee.get(pkg.employeeUserId) ?? null,
      hash_version: STAFFING_PLAN_HASH_VERSION,
      lead_coverage: pkg.assignments.some((assignment) => Boolean(assignment.satisfiesLeadCoverage)),
      assignments: snapshot.assignments,
      coverage_eligible: true,
      overdue: false,
      draft_change: "newly_added",
      requires_renewed_acknowledgment: true,
      can_carry_forward: false
    });
  }

  // Counts derive from the published current recipients (the committed plan); assigned is raw canonical.
  const pending = publishedRecipients.filter((row) => row.response_status === "pending");
  const acknowledged = publishedRecipients.filter((row) => row.response_status === "acknowledged");
  const declinedRecipients = publishedRecipients.filter((row) => row.response_status === "declined");
  const coverageEligible = publishedRecipients.filter(
    (row) => row.response_status !== "declined" && row.response_status !== "canceled"
  );
  const leadRecipients = publishedRecipients.filter((row) => snapshotHasLead(row.assignment_snapshot));
  const coverageEligibleLeads = leadRecipients.filter(
    (row) => row.response_status !== "declined" && row.response_status !== "canceled"
  );
  const acknowledgedLeads = leadRecipients.filter((row) => row.response_status === "acknowledged");
  const overdueCount = recipients.filter((recipient) => recipient.overdue).length;
  const nextDue =
    pending
      .map((row) => row.acknowledgment_due_at)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  const coverageEligibleStaffCount = coverageEligible.length;
  const coverageEligibleLeadCount = coverageEligibleLeads.length;
  const declinedStaffCount = declinedRecipients.length;
  const missingLead = coverageEligibleLeadCount < requiredLeadCount;
  const underStaffed = plannedStaffCount > coverageEligibleStaffCount;
  const replacementRequired = declinedStaffCount > 0;
  const coverageComplete = !missingLead && !underStaffed && !replacementRequired;
  const pendingCount = pending.length;

  const hasPublishedVersion = Boolean(versionRow);
  const hasDraftChanges = hasPublishedVersion
    ? draftPlanHash !== versionRow!.plan_hash || versionRow!.hash_version !== STAFFING_PLAN_HASH_VERSION
    : draft.recipients.length > 0;
  const draftComparison: StaffingPlanLifecycleView["draft_comparison"] = !hasPublishedVersion
    ? "no_published_plan"
    : hasDraftChanges
      ? "draft_changes_exist"
      : "unchanged_since_publish";

  const operationalReadinessStatus: StaffingPlanLifecycleView["operational_readiness_status"] = !coverageComplete
    ? "at_risk"
    : overdueCount > 0
      ? "confirmation_overdue"
      : pendingCount > 0
        ? "awaiting_acknowledgment"
        : "ready";

  return {
    has_published_version: hasPublishedVersion,
    latest_version: versionRow?.version ?? null,
    published_at: versionRow?.published_at ?? null,
    published_by_user_id: versionRow?.published_by_user_id ?? null,
    hash_version: versionRow?.hash_version ?? null,
    snapshot_schema_version: versionRow?.snapshot_schema_version ?? null,
    has_draft_changes: hasDraftChanges,
    republish_required: hasPublishedVersion && hasDraftChanges,
    draft_comparison: draftComparison,
    planned_staff_count: plannedStaffCount,
    required_lead_count: requiredLeadCount,
    assigned_staff_count: draft.recipients.length,
    published_recipient_count: publishedRecipients.length,
    coverage_eligible_staff_count: coverageEligibleStaffCount,
    pending_acknowledgment_count: pendingCount,
    acknowledged_staff_count: acknowledged.length,
    declined_staff_count: declinedStaffCount,
    superseded_recipient_count: supersededCount,
    lead_assignment_count: leadRecipients.length,
    coverage_eligible_lead_count: coverageEligibleLeadCount,
    acknowledged_lead_count: acknowledgedLeads.length,
    next_acknowledgment_due_at: nextDue,
    overdue_acknowledgment_count: overdueCount,
    needs_acknowledgment_count: needsAcknowledgmentCount,
    acknowledgment_risk_state:
      overdueCount > 0 ? "overdue" : needsAcknowledgmentCount > 0 ? "needs_attention" : pendingCount > 0 ? "awaiting" : "none",
    coverage_state: coverageComplete ? "complete" : "incomplete",
    operational_readiness_status: operationalReadinessStatus,
    recipients
  };
}
