import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import {
  computeAcknowledgmentDueAt
} from "../domain/staffing/staffing-acknowledgment-policy.js";
import {
  computePlanHash,
  computeRecipientHash,
  normalizePlan,
  normalizeRecipientPackage,
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
  shift_id: string;
  assigned_user_id: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  requirement_id: string | null;
  notes: string | null;
};

type ShootPlanRow = {
  shoot_date: string | null;
  location_name: string | null;
  location_address: string | null;
  arrival_time: string | null;
  start_time: string | null;
};

type ShootStaffingPlanInputs = {
  shootDate: string | null;
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
    location_name: null,
    location_address: null,
    arrival_time: null,
    start_time: null
  };

  const shiftResult = await client.query<ShiftPlanRow>(
    `
      SELECT
        ws.id::text AS shift_id,
        ws.assigned_user_id::text AS assigned_user_id,
        ws.staffing_role::text AS staffing_role,
        ws.satisfies_lead_coverage,
        ws.starts_at::text AS starts_at,
        ws.ends_at::text AS ends_at,
        ws.staffing_requirement_id::text AS requirement_id,
        ws.notes
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
      shiftId: row.shift_id,
      staffingRole: row.staffing_role,
      satisfiesLeadCoverage: row.satisfies_lead_coverage,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      callTime,
      instructions: row.notes
    };
    if (existing) {
      existing.assignments.push(assignment);
    } else {
      byEmployee.set(row.assigned_user_id, {
        employeeUserId: row.assigned_user_id,
        shootDate: shoot.shoot_date,
        locationName: shoot.location_name,
        locationAddress: shoot.location_address,
        assignments: [assignment]
      });
    }
  }

  return {
    shootDate: shoot.shoot_date,
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
): Promise<{ id: string; version: number; plan_hash: string } | null> {
  const { rows } = await client.query<{ id: string; version: number; plan_hash: string }>(
    `
      SELECT id, version, plan_hash
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

  // 5. Idempotent no-op when the plan hash is unchanged vs the latest version.
  const latest = await loadLatestStaffingPlanVersion(client, auth.tenantId, input.shootId);
  if (latest && latest.plan_hash === planHash) {
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
        tenant_id, shoot_id, version, plan_hash, published_by_user_id, plan_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, published_at::text AS published_at
    `,
    [
      auth.tenantId,
      input.shootId,
      nextVersion,
      planHash,
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
    const carriedForward = Boolean(prior && prior.recipient_hash === recipientHash);

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
          assignment_snapshot, response_status, acknowledgment_due_at, responded_at,
          responded_by_user_id, decline_reason, carried_forward_from_recipient_id
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `,
      [
        auth.tenantId,
        versionRow.id,
        input.shootId,
        pkg.employeeUserId,
        recipientHash,
        JSON.stringify(normalizeRecipientPackage(pkg)),
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

async function loadOwnCurrentRecipient(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string
): Promise<RecipientStateRow> {
  const { rows } = await client.query<RecipientStateRow>(
    `
      SELECT
        id,
        employee_user_id::text AS employee_user_id,
        response_status,
        superseded_at,
        recipient_hash,
        shoot_id::text AS shoot_id,
        staffing_plan_version_id::text AS staffing_plan_version_id
      FROM staffing_plan_recipient
      WHERE tenant_id = $1 AND id = $2
    `,
    [auth.tenantId, recipientId]
  );
  const recipient = rows[0];
  if (!recipient) {
    throw new ApiError(404, "Staffing assignment not found");
  }
  // Employee response routes may only mutate the employee's OWN current recipient record.
  if (recipient.employee_user_id !== auth.id) {
    throw new ApiError(403, "You can only respond to your own staffing assignment");
  }
  if (recipient.superseded_at) {
    throw new ApiError(409, "This staffing assignment version is no longer current");
  }
  return recipient;
}

export async function acknowledgeStaffingPlanRecipient(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string,
  meta: RequestMeta = {}
): Promise<{ recipient_id: string; response_status: "acknowledged" }> {
  const recipient = await loadOwnCurrentRecipient(client, auth, recipientId);
  await client.query(
    `
      UPDATE staffing_plan_recipient
      SET response_status = 'acknowledged',
          responded_at = now(),
          responded_by_user_id = $3,
          decline_reason = NULL,
          updated_at = now()
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
  return { recipient_id: recipientId, response_status: "acknowledged" };
}

export async function declineStaffingPlanRecipient(
  client: PoolClient,
  auth: AuthUser,
  recipientId: string,
  input: { reason: string },
  meta: RequestMeta = {}
): Promise<{ recipient_id: string; response_status: "declined"; decline_reason: string }> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new ApiError(400, "A decline reason is required");
  }
  const recipient = await loadOwnCurrentRecipient(client, auth, recipientId);
  await client.query(
    `
      UPDATE staffing_plan_recipient
      SET response_status = 'declined',
          responded_at = now(),
          responded_by_user_id = $3,
          decline_reason = $4,
          updated_at = now()
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
  return { recipient_id: recipientId, response_status: "declined", decline_reason: reason };
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
