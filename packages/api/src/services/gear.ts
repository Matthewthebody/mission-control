import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { canManageGearCustody, canOverrideGearCustodyConflict } from "../authz/authority.js";
import { createAuditLog } from "./audit.js";
import type { AuthUser } from "../types/auth.js";
import type {
  GearCheckoutRecord,
  GearCheckoutStatus,
  GearCustodyEventType,
  GearReturnConditionStatus,
  GearServiceRepairIssueType,
  GearStatus
} from "../types/gear.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type GearAssetRow = {
  id: string;
  tenant_id: string;
  internal_asset_id: string;
  asset_name: string;
  status: GearStatus;
  home_location_id: string | null;
  current_kit_id: string | null;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
};

type GearKitRow = {
  id: string;
  tenant_id: string;
  kit_name: string;
  internal_kit_id: string;
  assigned_user_id: string | null;
  assignment_started_at: string | null;
  assignment_note: string | null;
  home_location_id: string | null;
  status: GearStatus;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
};

type GearCheckoutRow = GearCheckoutRecord & {
  checked_out_to_user_name?: string | null;
  linked_shoot_title?: string | null;
};

type GearTargetType = "asset" | "kit";

export type PermanentKitAssignmentInput = {
  kitId: string;
  assignedUserId: string | null;
  assignmentStartedAt?: string | null;
  assignmentNote?: string | null;
  currentCustodianUserId?: string | null | undefined;
};

export type GearCheckoutInput = {
  targetType: GearTargetType;
  targetId: string;
  checkedOutToUserId: string;
  initialStatus: Extract<GearCheckoutStatus, "assigned" | "checked_out">;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  expectedReturnAt?: string | null;
  note?: string | null;
  overrideConflict?: boolean;
  overrideReason?: string | null;
  pickupWorkingOrderConfirmed?: boolean | null;
  pickupIssueType?: GearServiceRepairIssueType | null;
  pickupIssueNote?: string | null;
};

export type GearCheckoutActivationInput = {
  checkoutId: string;
  checkedOutAt?: string | null;
  note?: string | null;
};

export type GearReturnInput = {
  checkoutId: string;
  returnedAt?: string | null;
  workingOrderConfirmed: boolean;
  issueType?: GearServiceRepairIssueType | null;
  note?: string | null;
};

export async function assignPermanentKit(
  client: PoolClient,
  auth: AuthUser,
  input: PermanentKitAssignmentInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);

  const kit = await getKitForUpdate(client, auth.tenantId, input.kitId);
  const previousValues = serializeKitState(kit);
  const assignmentStartedAt = input.assignmentStartedAt ?? new Date().toISOString();
  const currentCustodianUserId =
    input.currentCustodianUserId === undefined ? kit.current_custodian_id : input.currentCustodianUserId;
  const nextStatus: GearStatus = currentCustodianUserId ? "checked_out" : input.assignedUserId ? "assigned" : "in_office";

  const { rows } = await client.query<GearKitRow>(
    `
      UPDATE gear_kit
      SET
        assigned_user_id = $3,
        assignment_started_at = $4,
        assignment_note = $5,
        current_custodian_id = $6,
        last_seen_with_user_id = CASE WHEN $6::uuid IS NOT NULL THEN $6 ELSE last_seen_with_user_id END,
        status = $7,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [
      auth.tenantId,
      input.kitId,
      input.assignedUserId,
      assignmentStartedAt,
      input.assignmentNote ?? null,
      currentCustodianUserId ?? null,
      nextStatus
    ]
  );

  const updatedKit = rows[0];

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    kitId: updatedKit.id,
    eventType: "assigned",
    fromUserId: kit.assigned_user_id,
    toUserId: input.assignedUserId,
    note: input.assignmentNote ?? "Permanent Assignment updated.",
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.kit.permanent_assignment.updated",
    entityType: "gear_kit",
    entityId: updatedKit.id,
    previousValues,
    newValues: serializeKitState(updatedKit),
    reasonComment: input.assignmentNote ?? "Permanent Assignment updated.",
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return updatedKit;
}

export async function createGearCheckout(
  client: PoolClient,
  auth: AuthUser,
  input: GearCheckoutInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);

  const target = await lockGearTarget(client, auth.tenantId, input.targetType, input.targetId);
  const linkedLocationId = await resolveLinkedLocationId(client, auth.tenantId, input.linkedShootId ?? null, input.linkedLocationId ?? null);
  const existingConflict = await getActiveCheckoutConflict(client, auth.tenantId, input.targetType, input.targetId);

  let conflictOverrideApplied = false;
  if (existingConflict) {
    if (!input.overrideConflict) {
      throw new ApiError(409, `${capitalizeTarget(input.targetType)} already has an active checkout or reservation and requires leadership override.`);
    }
    if (!canOverrideGearCustodyConflict(auth)) {
      throw new ApiError(403, "Only leadership can override an existing gear custody conflict.");
    }
    if (!input.overrideReason?.trim()) {
      throw new ApiError(400, "Override reason is required when overriding an active gear custody conflict.");
    }

    await client.query(
      `
        UPDATE gear_checkout_record
        SET
          status = 'overridden',
          override_reason = $3,
          override_by_user_id = $4,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, existingConflict.id, input.overrideReason.trim(), auth.id]
    );

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "gear.checkout.overridden",
      entityType: "gear_checkout_record",
      entityId: existingConflict.id,
      previousValues: serializeCheckoutState(existingConflict),
      newValues: {
        ...serializeCheckoutState(existingConflict),
        status: "overridden",
        override_reason: input.overrideReason.trim(),
        override_by_user_id: auth.id
      },
      reasonComment: input.overrideReason.trim(),
      sourceSurface: requestMeta.sourceSurface ?? null,
      ipAddress: requestMeta.ipAddress ?? null,
      userAgent: requestMeta.userAgent ?? null
    });

    conflictOverrideApplied = true;
  }

  const eventType: GearCustodyEventType = input.initialStatus === "checked_out" ? "checked_out" : "assigned";
  const nowIso = new Date().toISOString();
  const { rows } = await client.query<GearCheckoutRow>(
    `
      INSERT INTO gear_checkout_record (
        tenant_id,
        asset_id,
        kit_id,
        checked_out_to_user_id,
        linked_shoot_id,
        linked_location_id,
        status,
        reserved_at,
        checked_out_at,
        expected_return_at,
        checkout_note,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12
      )
      RETURNING *
    `,
    [
      auth.tenantId,
      input.targetType === "asset" ? input.targetId : null,
      input.targetType === "kit" ? input.targetId : null,
      input.checkedOutToUserId,
      input.linkedShootId ?? null,
      linkedLocationId,
      input.initialStatus,
      nowIso,
      input.initialStatus === "checked_out" ? nowIso : null,
      input.expectedReturnAt ?? null,
      input.note ?? null,
      auth.id
    ]
  );

  const checkout = rows[0];
  await updateTargetAfterCheckout(client, auth.tenantId, input.targetType, target, input.checkedOutToUserId, input.initialStatus);

  const pickupIssueCreated = input.pickupWorkingOrderConfirmed === false || Boolean(input.pickupIssueType);
  if (pickupIssueCreated) {
    await client.query(
      `
        INSERT INTO gear_service_repair_record (
          tenant_id,
          asset_id,
          kit_id,
          issue_type,
          status,
          reported_by,
          linked_shoot_id,
          linked_location_id,
          source_checkout_id,
          source_surface,
          opened_at,
          note,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'open',
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          now()
        )
      `,
      [
        auth.tenantId,
        input.targetType === "asset" ? input.targetId : null,
        input.targetType === "kit" ? input.targetId : null,
        input.pickupIssueType ?? "other",
        auth.id,
        input.linkedShootId ?? null,
        linkedLocationId,
        checkout.id,
        requestMeta.sourceSurface ?? null,
        nowIso,
        input.pickupIssueNote ?? input.note ?? "Issue reported during gear pickup."
      ]
    );
  }

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: input.targetType === "asset" ? input.targetId : null,
    kitId: input.targetType === "kit" ? input.targetId : null,
    eventType,
    fromUserId: getTargetCurrentCustodian(target),
    toUserId: input.checkedOutToUserId,
    linkedShootId: input.linkedShootId ?? null,
    linkedLocationId,
    note: input.note ?? null,
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.checkout.created",
    entityType: "gear_checkout_record",
    entityId: checkout.id,
    previousValues: {},
    newValues: serializeCheckoutState(checkout),
    reasonComment: input.note ?? null,
    metadata: {
      target_type: input.targetType,
      conflict_override_applied: conflictOverrideApplied,
      pickup_issue_created: pickupIssueCreated,
      pickup_issue_type: pickupIssueCreated ? input.pickupIssueType ?? "other" : null
    },
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return {
    checkout,
    conflict_override_applied: conflictOverrideApplied
  };
}

export async function activateGearCheckout(
  client: PoolClient,
  auth: AuthUser,
  input: GearCheckoutActivationInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);

  const checkout = await getCheckoutForUpdate(client, auth.tenantId, input.checkoutId);
  if (checkout.status !== "assigned") {
    throw new ApiError(409, "Only reserved gear can be transitioned into Checked Out state.");
  }

  const targetType: GearTargetType = checkout.asset_id ? "asset" : "kit";
  const targetId = checkout.asset_id ?? checkout.kit_id;
  if (!targetId) {
    throw new ApiError(500, "Checkout record is missing its target reference.");
  }

  const target = await lockGearTarget(client, auth.tenantId, targetType, targetId);
  const previousValues = serializeCheckoutState(checkout);
  const checkedOutAt = input.checkedOutAt ?? new Date().toISOString();

  const { rows } = await client.query<GearCheckoutRow>(
    `
      UPDATE gear_checkout_record
      SET
        status = 'checked_out',
        checked_out_at = $3,
        checkout_note = COALESCE($4, checkout_note),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [auth.tenantId, input.checkoutId, checkedOutAt, input.note ?? null]
  );

  const updatedCheckout = rows[0];
  await updateTargetAfterCheckout(client, auth.tenantId, targetType, target, checkout.checked_out_to_user_id, "checked_out");

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: checkout.asset_id,
    kitId: checkout.kit_id,
    eventType: "checked_out",
    fromUserId: getTargetCurrentCustodian(target),
    toUserId: checkout.checked_out_to_user_id,
    linkedShootId: checkout.linked_shoot_id,
    linkedLocationId: checkout.linked_location_id,
    note: input.note ?? checkout.checkout_note ?? "Checked Out confirmed.",
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.checkout.activated",
    entityType: "gear_checkout_record",
    entityId: updatedCheckout.id,
    previousValues,
    newValues: serializeCheckoutState(updatedCheckout),
    reasonComment: input.note ?? checkout.checkout_note ?? "Checked Out confirmed.",
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return updatedCheckout;
}

export async function returnGearCheckout(
  client: PoolClient,
  auth: AuthUser,
  input: GearReturnInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);

  const checkout = await getCheckoutForUpdate(client, auth.tenantId, input.checkoutId);
  if (!["assigned", "checked_out"].includes(checkout.status)) {
    throw new ApiError(409, "Only active gear checkouts can be returned.");
  }

  const targetType: GearTargetType = checkout.asset_id ? "asset" : "kit";
  const targetId = checkout.asset_id ?? checkout.kit_id;
  if (!targetId) {
    throw new ApiError(500, "Checkout record is missing its target reference.");
  }

  const target = await lockGearTarget(client, auth.tenantId, targetType, targetId);
  const returnedAt = input.returnedAt ?? new Date().toISOString();
  const returnConditionStatus: GearReturnConditionStatus = input.workingOrderConfirmed ? "working_order_confirmed" : "issues_reported";
  const previousValues = serializeCheckoutState(checkout);

  const { rows } = await client.query<GearCheckoutRow>(
    `
      UPDATE gear_checkout_record
      SET
        status = 'returned',
        returned_at = $3,
        return_condition_status = $4,
        return_note = $5,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [auth.tenantId, input.checkoutId, returnedAt, returnConditionStatus, input.note ?? null]
  );

  const updatedCheckout = rows[0];
  const issueCreated = !input.workingOrderConfirmed;
  if (issueCreated) {
    await client.query(
      `
        INSERT INTO gear_service_repair_record (
          tenant_id,
          asset_id,
          kit_id,
          issue_type,
          status,
          reported_by,
          linked_shoot_id,
          linked_location_id,
          source_checkout_id,
          source_surface,
          opened_at,
          note,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'open',
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          now()
        )
      `,
      [
        auth.tenantId,
        checkout.asset_id,
        checkout.kit_id,
        input.issueType ?? "other",
        auth.id,
        checkout.linked_shoot_id,
        checkout.linked_location_id,
        checkout.id,
        requestMeta.sourceSurface ?? null,
        returnedAt,
        input.note ?? "Returned with reported issue."
      ]
    );
  }

  await updateTargetAfterReturn(client, auth.tenantId, targetType, target, checkout, issueCreated, input.issueType ?? null);

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: checkout.asset_id,
    kitId: checkout.kit_id,
    eventType: "returned",
    fromUserId: checkout.checked_out_to_user_id,
    toUserId: null,
    linkedShootId: checkout.linked_shoot_id,
    linkedLocationId: checkout.linked_location_id,
    note: input.note ?? "Return confirmed.",
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.checkout.returned",
    entityType: "gear_checkout_record",
    entityId: updatedCheckout.id,
    previousValues,
    newValues: serializeCheckoutState(updatedCheckout),
    reasonComment: input.note ?? "Return confirmed.",
    metadata: {
      issue_created: issueCreated,
      issue_type: issueCreated ? input.issueType ?? "other" : null
    },
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return {
    checkout: updatedCheckout,
    issue_created: issueCreated
  };
}

export async function listActiveGearCheckouts(client: PoolClient, auth: AuthUser) {
  assertCanManageGearCustody(auth);

  const { rows } = await client.query<GearCheckoutRow>(
    `
      SELECT
        gcr.*,
        au.full_name AS checked_out_to_user_name,
        s.title AS linked_shoot_title
      FROM gear_checkout_record gcr
      JOIN app_user au
        ON au.id = gcr.checked_out_to_user_id
      LEFT JOIN shoot s
        ON s.id = gcr.linked_shoot_id
      WHERE gcr.tenant_id = $1
        AND gcr.status IN ('assigned', 'checked_out')
      ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
    `,
    [auth.tenantId]
  );

  return rows;
}

function assertCanManageGearCustody(auth: AuthUser) {
  if (!canManageGearCustody(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}

async function resolveLinkedLocationId(
  client: PoolClient,
  tenantId: string,
  linkedShootId: string | null,
  linkedLocationId: string | null
) {
  if (linkedLocationId) {
    return linkedLocationId;
  }
  if (!linkedShootId) {
    return null;
  }
  const { rows } = await client.query<{ location_id: string | null }>(
    `
      SELECT location_id
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, linkedShootId]
  );
  return rows[0]?.location_id ?? null;
}

async function getAssetForUpdate(client: PoolClient, tenantId: string, assetId: string) {
  const { rows } = await client.query<GearAssetRow>(
    `
      SELECT *
      FROM gear_asset
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, assetId]
  );
  const asset = rows[0];
  if (!asset) {
    throw new ApiError(404, "Asset not found.");
  }
  return asset;
}

async function getKitForUpdate(client: PoolClient, tenantId: string, kitId: string) {
  const { rows } = await client.query<GearKitRow>(
    `
      SELECT *
      FROM gear_kit
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, kitId]
  );
  const kit = rows[0];
  if (!kit) {
    throw new ApiError(404, "Kit not found.");
  }
  return kit;
}

async function getCheckoutForUpdate(client: PoolClient, tenantId: string, checkoutId: string) {
  const { rows } = await client.query<GearCheckoutRow>(
    `
      SELECT *
      FROM gear_checkout_record
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, checkoutId]
  );
  const checkout = rows[0];
  if (!checkout) {
    throw new ApiError(404, "Checkout record not found.");
  }
  return checkout;
}

async function lockGearTarget(client: PoolClient, tenantId: string, targetType: GearTargetType, targetId: string) {
  return targetType === "asset"
    ? getAssetForUpdate(client, tenantId, targetId)
    : getKitForUpdate(client, tenantId, targetId);
}

async function getActiveCheckoutConflict(client: PoolClient, tenantId: string, targetType: GearTargetType, targetId: string) {
  const column = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<GearCheckoutRow>(
    `
      SELECT *
      FROM gear_checkout_record
      WHERE tenant_id = $1
        AND ${column} = $2
        AND status IN ('assigned', 'checked_out')
      ORDER BY reserved_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [tenantId, targetId]
  );
  return rows[0] ?? null;
}

async function updateTargetAfterCheckout(
  client: PoolClient,
  tenantId: string,
  targetType: GearTargetType,
  target: GearAssetRow | GearKitRow,
  checkedOutToUserId: string,
  status: Extract<GearCheckoutStatus, "assigned" | "checked_out">
) {
  const nextCustodian = status === "checked_out" ? checkedOutToUserId : null;
  if (targetType === "asset") {
    await client.query(
      `
        UPDATE gear_asset
        SET
          status = $3,
          current_custodian_id = $4,
          last_seen_with_user_id = CASE WHEN $4::uuid IS NOT NULL THEN $4 ELSE last_seen_with_user_id END,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, target.id, status, nextCustodian]
    );
    return;
  }

  await client.query(
    `
      UPDATE gear_kit
      SET
        status = $3,
        current_custodian_id = $4,
        last_seen_with_user_id = CASE WHEN $4::uuid IS NOT NULL THEN $4 ELSE last_seen_with_user_id END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, target.id, status, nextCustodian]
  );
}

async function updateTargetAfterReturn(
  client: PoolClient,
  tenantId: string,
  targetType: GearTargetType,
  target: GearAssetRow | GearKitRow,
  checkout: GearCheckoutRow,
  issueCreated: boolean,
  issueType: GearServiceRepairIssueType | null
) {
  if (targetType === "kit") {
    const kit = target as GearKitRow;
    const nextStatus: GearStatus = issueCreated
      ? issueType === "missing"
        ? "missing"
        : "needs_repair"
      : kit.assigned_user_id
        ? "assigned"
        : kit.home_location_id
          ? "in_office"
          : "available";

    await client.query(
      `
        UPDATE gear_kit
        SET
          status = $3,
          current_custodian_id = NULL,
          last_seen_with_user_id = COALESCE($4, last_seen_with_user_id),
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, kit.id, nextStatus, checkout.checked_out_to_user_id]
    );
    return;
  }

  const asset = target as GearAssetRow;
  const kitAssignment = asset.current_kit_id
    ? await client.query<{ assigned_user_id: string | null }>(
        `
          SELECT assigned_user_id
          FROM gear_kit
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [tenantId, asset.current_kit_id]
      )
    : null;

  const nextStatus: GearStatus = issueCreated
    ? issueType === "missing"
      ? "missing"
      : "needs_repair"
    : asset.current_kit_id
      ? kitAssignment?.rows[0]?.assigned_user_id
        ? "assigned"
        : "in_office"
      : asset.home_location_id
        ? "in_office"
        : "available";

  await client.query(
    `
      UPDATE gear_asset
      SET
        status = $3,
        current_custodian_id = NULL,
        last_seen_with_user_id = COALESCE($4, last_seen_with_user_id),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, asset.id, nextStatus, checkout.checked_out_to_user_id]
  );
}

async function createGearCustodyEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    assetId?: string | null;
    kitId?: string | null;
    eventType: GearCustodyEventType;
    fromUserId?: string | null;
    toUserId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    note?: string | null;
    createdBy: string;
  }
) {
  await client.query(
    `
      INSERT INTO gear_custody_event (
        tenant_id,
        asset_id,
        kit_id,
        event_type,
        from_user_id,
        to_user_id,
        linked_shoot_id,
        linked_location_id,
        timestamp,
        note,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        now(),
        $9,
        $10
      )
    `,
    [
      input.tenantId,
      input.assetId ?? null,
      input.kitId ?? null,
      input.eventType,
      input.fromUserId ?? null,
      input.toUserId ?? null,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.note ?? null,
      input.createdBy
    ]
  );
}

function serializeKitState(kit: GearKitRow) {
  return {
    id: kit.id,
    assigned_user_id: kit.assigned_user_id,
    assignment_started_at: kit.assignment_started_at,
    assignment_note: kit.assignment_note,
    status: kit.status,
    current_custodian_id: kit.current_custodian_id,
    last_seen_with_user_id: kit.last_seen_with_user_id
  };
}

function serializeCheckoutState(checkout: GearCheckoutRow) {
  return {
    id: checkout.id,
    asset_id: checkout.asset_id,
    kit_id: checkout.kit_id,
    checked_out_to_user_id: checkout.checked_out_to_user_id,
    linked_shoot_id: checkout.linked_shoot_id,
    linked_location_id: checkout.linked_location_id,
    status: checkout.status,
    reserved_at: checkout.reserved_at,
    checked_out_at: checkout.checked_out_at,
    expected_return_at: checkout.expected_return_at,
    returned_at: checkout.returned_at,
    checkout_note: checkout.checkout_note,
    return_condition_status: checkout.return_condition_status,
    return_note: checkout.return_note,
    override_reason: checkout.override_reason,
    override_by_user_id: checkout.override_by_user_id
  };
}

function getTargetCurrentCustodian(target: GearAssetRow | GearKitRow) {
  return "current_custodian_id" in target ? target.current_custodian_id : null;
}

function capitalizeTarget(targetType: GearTargetType) {
  return targetType === "asset" ? "Asset" : "Kit";
}
