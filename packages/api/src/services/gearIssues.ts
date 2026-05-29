import type { PoolClient } from "pg";
import { canManageGearCustody } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  GearCheckoutStatus,
  GearServiceRepairIssueType,
  GearServiceRepairStatus,
  GearStatus,
  GearTemporarySubstitutionStatus
} from "../types/gear.js";
import { createAuditLog } from "./audit.js";
import { createGearCheckout, returnGearCheckout } from "./gear.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type GearTargetType = "asset" | "kit";

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
  home_location_id: string | null;
  status: GearStatus;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
};

type GearCheckoutLinkRow = {
  id: string;
  checked_out_to_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  status: GearCheckoutStatus;
  expected_return_at: string | null;
};

type GearServiceRepairRecordRow = {
  id: string;
  tenant_id: string;
  asset_id: string | null;
  kit_id: string | null;
  issue_type: GearServiceRepairIssueType;
  status: GearServiceRepairStatus;
  reported_by: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  source_checkout_id: string | null;
  source_surface: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
  updated_at: string;
};

type GearTemporarySubstitutionRow = {
  id: string;
  tenant_id: string;
  original_asset_id: string;
  substitute_asset_id: string;
  assigned_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  substitute_checkout_id: string | null;
  status: GearTemporarySubstitutionStatus;
  starts_at: string;
  ends_at: string | null;
  note: string | null;
  created_by: string;
  ended_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateGearIssueReportInput = {
  targetType: GearTargetType;
  targetId: string;
  issueType: GearServiceRepairIssueType;
  status?: GearServiceRepairStatus;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  sourceCheckoutId?: string | null;
  note?: string | null;
};

export type UpdateGearIssueReportInput = {
  serviceRecordId: string;
  status?: GearServiceRepairStatus;
  note?: string | null;
};

export type CreateGearTemporarySubstitutionInput = {
  originalAssetId: string;
  substituteAssetId: string;
  assignedUserId?: string | null;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  note?: string | null;
  overrideConflict?: boolean;
  overrideReason?: string | null;
};

export type EndGearTemporarySubstitutionInput = {
  substitutionId: string;
  note?: string | null;
};

export async function createGearIssueReport(
  client: PoolClient,
  auth: AuthUser,
  input: CreateGearIssueReportInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearIssues(auth);

  const target = await lockGearTarget(client, auth.tenantId, input.targetType, input.targetId);
  const activeCheckout = input.sourceCheckoutId
    ? await getCheckoutLinkById(client, auth.tenantId, input.sourceCheckoutId)
    : await getActiveCheckoutForTarget(client, auth.tenantId, input.targetType, input.targetId);
  const linkedShootId = input.linkedShootId ?? activeCheckout?.linked_shoot_id ?? null;
  const linkedLocationId = await resolveLinkedLocationId(
    client,
    auth.tenantId,
    linkedShootId,
    input.linkedLocationId ?? activeCheckout?.linked_location_id ?? null
  );
  const note = input.note?.trim() || null;
  const status = input.status ?? "open";

  const { rows } = await client.query<GearServiceRepairRecordRow>(
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
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        now(),
        $11,
        now()
      )
      RETURNING *
    `,
    [
      auth.tenantId,
      input.targetType === "asset" ? input.targetId : null,
      input.targetType === "kit" ? input.targetId : null,
      input.issueType,
      status,
      auth.id,
      linkedShootId,
      linkedLocationId,
      activeCheckout?.id ?? input.sourceCheckoutId ?? null,
      requestMeta.sourceSurface ?? null,
      note
    ]
  );

  const serviceRecord = rows[0];

  await syncTargetStatusForIssueRecord(client, auth.tenantId, input.targetType, target, serviceRecord, activeCheckout);

  if (input.issueType === "missing") {
    await createGearCustodyEvent(client, {
      tenantId: auth.tenantId,
      assetId: input.targetType === "asset" ? input.targetId : null,
      kitId: input.targetType === "kit" ? input.targetId : null,
      eventType: "missing_gear_alerted",
      fromUserId: getTargetCurrentCustodian(target),
      toUserId: null,
      linkedShootId,
      linkedLocationId,
      note: note ?? "Missing Gear Alert reported.",
      createdBy: auth.id
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.service_record.created",
    entityType: "gear_service_repair_record",
    entityId: serviceRecord.id,
    previousValues: {},
    newValues: serializeServiceRecordState(serviceRecord),
    reasonComment: note ?? "Gear issue reported.",
    metadata: {
      target_type: input.targetType,
      target_id: input.targetId
    },
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return loadServiceRecordSummary(client, auth.tenantId, serviceRecord.id);
}

export async function updateGearIssueReport(
  client: PoolClient,
  auth: AuthUser,
  input: UpdateGearIssueReportInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearIssues(auth);

  const serviceRecord = await getServiceRepairRecordForUpdate(client, auth.tenantId, input.serviceRecordId);
  const targetType: GearTargetType = serviceRecord.asset_id ? "asset" : "kit";
  const targetId = serviceRecord.asset_id ?? serviceRecord.kit_id;
  if (!targetId) {
    throw new ApiError(500, "Service / Repair Record is missing its target reference.");
  }

  const target = await lockGearTarget(client, auth.tenantId, targetType, targetId);
  const previousValues = serializeServiceRecordState(serviceRecord);
  const nextStatus = input.status ?? serviceRecord.status;
  const nextNote = input.note === undefined ? serviceRecord.note : input.note?.trim() || null;
  const isResolved = nextStatus === "resolved" || nextStatus === "closed";

  const { rows } = await client.query<GearServiceRepairRecordRow>(
    `
      UPDATE gear_service_repair_record
      SET
        status = $3,
        note = $4,
        resolved_at = CASE
          WHEN $3 IN ('resolved', 'closed') THEN COALESCE(resolved_at, now())
          ELSE NULL
        END,
        resolved_by = CASE
          WHEN $3 IN ('resolved', 'closed') THEN $5
          ELSE NULL
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [auth.tenantId, input.serviceRecordId, nextStatus, nextNote, isResolved ? auth.id : null]
  );

  const updatedRecord = rows[0];
  const activeCheckout = await getActiveCheckoutForTarget(client, auth.tenantId, targetType, targetId);
  await syncTargetStatusForIssueRecord(client, auth.tenantId, targetType, target, updatedRecord, activeCheckout);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.service_record.updated",
    entityType: "gear_service_repair_record",
    entityId: updatedRecord.id,
    previousValues,
    newValues: serializeServiceRecordState(updatedRecord),
    reasonComment: nextNote ?? `Service / Repair Record moved to ${nextStatus}.`,
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return loadServiceRecordSummary(client, auth.tenantId, updatedRecord.id);
}

export async function createGearTemporarySubstitution(
  client: PoolClient,
  auth: AuthUser,
  input: CreateGearTemporarySubstitutionInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearIssues(auth);

  if (input.originalAssetId === input.substituteAssetId) {
    throw new ApiError(400, "Original Asset and substitute Asset must be different.");
  }

  const originalAsset = await getAssetForUpdate(client, auth.tenantId, input.originalAssetId);
  await getAssetForUpdate(client, auth.tenantId, input.substituteAssetId);

  const existingOriginal = await getActiveTemporarySubstitutionByColumn(client, auth.tenantId, "original_asset_id", input.originalAssetId);
  if (existingOriginal) {
    throw new ApiError(409, "This Asset already has an active Temporary Substitution.");
  }
  const existingSubstitute = await getActiveTemporarySubstitutionByColumn(client, auth.tenantId, "substitute_asset_id", input.substituteAssetId);
  if (existingSubstitute) {
    throw new ApiError(409, "This substitute Asset is already in an active Temporary Substitution.");
  }

  const originalCheckout = await getActiveCheckoutForTarget(client, auth.tenantId, "asset", input.originalAssetId);
  const assignedUserId = input.assignedUserId ?? originalCheckout?.checked_out_to_user_id ?? originalAsset.current_custodian_id;
  if (!assignedUserId) {
    throw new ApiError(400, "Assigned user is required for a Temporary Substitution.");
  }

  const linkedShootId = input.linkedShootId ?? originalCheckout?.linked_shoot_id ?? null;
  const linkedLocationId = await resolveLinkedLocationId(
    client,
    auth.tenantId,
    linkedShootId,
    input.linkedLocationId ?? originalCheckout?.linked_location_id ?? null
  );
  const note = input.note?.trim() || null;

  const substituteCheckoutResult = await createGearCheckout(
    client,
    auth,
    {
      targetType: "asset",
      targetId: input.substituteAssetId,
      checkedOutToUserId: assignedUserId,
      initialStatus: "checked_out",
      linkedShootId,
      linkedLocationId,
      expectedReturnAt: originalCheckout?.expected_return_at ?? null,
      note: note ? `Temporary Substitution: ${note}` : "Temporary Substitution issued.",
      overrideConflict: input.overrideConflict ?? false,
      overrideReason: input.overrideReason ?? null
    },
    requestMeta
  );

  const { rows } = await client.query<GearTemporarySubstitutionRow>(
    `
      INSERT INTO gear_temporary_substitution (
        tenant_id,
        original_asset_id,
        substitute_asset_id,
        assigned_user_id,
        linked_shoot_id,
        linked_location_id,
        substitute_checkout_id,
        status,
        starts_at,
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
        'active',
        now(),
        $8,
        $9
      )
      RETURNING *
    `,
    [
      auth.tenantId,
      input.originalAssetId,
      input.substituteAssetId,
      assignedUserId,
      linkedShootId,
      linkedLocationId,
      substituteCheckoutResult.checkout.id,
      note,
      auth.id
    ]
  );

  const substitution = rows[0];

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: input.originalAssetId,
    eventType: "temporary_substitution_started",
    fromUserId: originalAsset.current_custodian_id,
    toUserId: assignedUserId,
    linkedShootId,
    linkedLocationId,
    note: note ?? "Temporary Substitution started.",
    createdBy: auth.id
  });

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: input.substituteAssetId,
    eventType: "temporary_substitution_started",
    fromUserId: null,
    toUserId: assignedUserId,
    linkedShootId,
    linkedLocationId,
    note: note ?? "Temporary Substitution started.",
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.temporary_substitution.created",
    entityType: "gear_temporary_substitution",
    entityId: substitution.id,
    previousValues: {},
    newValues: serializeTemporarySubstitutionState(substitution),
    reasonComment: note ?? "Temporary Substitution created.",
    metadata: {
      conflict_override_applied: substituteCheckoutResult.conflict_override_applied
    },
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return loadTemporarySubstitutionSummary(client, auth.tenantId, substitution.id);
}

export async function endGearTemporarySubstitution(
  client: PoolClient,
  auth: AuthUser,
  input: EndGearTemporarySubstitutionInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearIssues(auth);

  const substitution = await getTemporarySubstitutionForUpdate(client, auth.tenantId, input.substitutionId);
  if (substitution.status !== "active") {
    throw new ApiError(409, "Only active Temporary Substitutions can be ended.");
  }

  const note = input.note?.trim() || null;
  const previousValues = serializeTemporarySubstitutionState(substitution);

  if (substitution.substitute_checkout_id) {
    const activeCheckout = await getCheckoutLinkById(client, auth.tenantId, substitution.substitute_checkout_id);
    if (activeCheckout && ["assigned", "checked_out"].includes(activeCheckout.status)) {
      await returnGearCheckout(
        client,
        auth,
        {
          checkoutId: substitution.substitute_checkout_id,
          returnedAt: null,
          workingOrderConfirmed: true,
          issueType: null,
          note: note ?? "Temporary Substitution ended and substitute Asset returned."
        },
        requestMeta
      );
    }
  }

  const { rows } = await client.query<GearTemporarySubstitutionRow>(
    `
      UPDATE gear_temporary_substitution
      SET
        status = 'ended',
        ends_at = now(),
        ended_by = $3,
        note = CASE
          WHEN $4::text IS NULL THEN note
          ELSE concat_ws(E'\n\n', note, 'Ended: ' || $4)
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [auth.tenantId, input.substitutionId, auth.id, note]
  );

  const updated = rows[0];

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: updated.original_asset_id,
    eventType: "temporary_substitution_ended",
    fromUserId: updated.assigned_user_id,
    toUserId: null,
    linkedShootId: updated.linked_shoot_id,
    linkedLocationId: updated.linked_location_id,
    note: note ?? "Temporary Substitution ended.",
    createdBy: auth.id
  });

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    assetId: updated.substitute_asset_id,
    eventType: "temporary_substitution_ended",
    fromUserId: updated.assigned_user_id,
    toUserId: null,
    linkedShootId: updated.linked_shoot_id,
    linkedLocationId: updated.linked_location_id,
    note: note ?? "Temporary Substitution ended.",
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.temporary_substitution.ended",
    entityType: "gear_temporary_substitution",
    entityId: updated.id,
    previousValues,
    newValues: serializeTemporarySubstitutionState(updated),
    reasonComment: note ?? "Temporary Substitution ended.",
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return loadTemporarySubstitutionSummary(client, auth.tenantId, updated.id);
}

function assertCanManageGearIssues(auth: Pick<AuthUser, "authorityTier" | "permissions">) {
  if (canManageGearCustody(auth) || auth.permissions.includes("gear_service_records.create")) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

async function loadServiceRecordSummary(client: PoolClient, tenantId: string, serviceRecordId: string) {
  const { rows } = await client.query(
    `
      SELECT
        gsr.id,
        gsr.asset_id,
        gsr.kit_id,
        gsr.issue_type,
        gsr.status,
        reporter.full_name AS reported_by_name,
        gsr.opened_at,
        gsr.resolved_at,
        resolver.full_name AS resolved_by_name,
        gsr.linked_shoot_id,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gsr.source_checkout_id,
        gsr.source_surface,
        gsr.note,
        gsr.updated_at
      FROM gear_service_repair_record gsr
      JOIN app_user reporter
        ON reporter.id = gsr.reported_by
      LEFT JOIN app_user resolver
        ON resolver.id = gsr.resolved_by
      LEFT JOIN shoot
        ON shoot.id = gsr.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gsr.linked_location_id
      WHERE gsr.tenant_id = $1
        AND gsr.id = $2
      LIMIT 1
    `,
    [tenantId, serviceRecordId]
  );
  return rows[0] ?? null;
}

async function loadTemporarySubstitutionSummary(client: PoolClient, tenantId: string, substitutionId: string) {
  const { rows } = await client.query(
    `
      SELECT
        gts.id,
        gts.original_asset_id,
        original_asset.asset_name AS original_asset_name,
        original_asset.internal_asset_id AS original_asset_internal_id,
        gts.substitute_asset_id,
        substitute_asset.asset_name AS substitute_asset_name,
        substitute_asset.internal_asset_id AS substitute_asset_internal_id,
        gts.assigned_user_id,
        assigned_user.full_name AS assigned_user_name,
        gts.linked_shoot_id,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gts.substitute_checkout_id,
        gts.status,
        gts.starts_at,
        gts.ends_at,
        gts.note,
        creator.full_name AS created_by_name,
        ended_by_user.full_name AS ended_by_name,
        gts.created_at,
        gts.updated_at
      FROM gear_temporary_substitution gts
      JOIN gear_asset original_asset
        ON original_asset.id = gts.original_asset_id
      JOIN gear_asset substitute_asset
        ON substitute_asset.id = gts.substitute_asset_id
      JOIN app_user assigned_user
        ON assigned_user.id = gts.assigned_user_id
      JOIN app_user creator
        ON creator.id = gts.created_by
      LEFT JOIN app_user ended_by_user
        ON ended_by_user.id = gts.ended_by
      LEFT JOIN shoot
        ON shoot.id = gts.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gts.linked_location_id
      WHERE gts.tenant_id = $1
        AND gts.id = $2
      LIMIT 1
    `,
    [tenantId, substitutionId]
  );
  return rows[0] ?? null;
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

async function lockGearTarget(client: PoolClient, tenantId: string, targetType: GearTargetType, targetId: string) {
  return targetType === "asset" ? getAssetForUpdate(client, tenantId, targetId) : getKitForUpdate(client, tenantId, targetId);
}

async function getCheckoutLinkById(client: PoolClient, tenantId: string, checkoutId: string) {
  const { rows } = await client.query<GearCheckoutLinkRow>(
    `
      SELECT
        id,
        checked_out_to_user_id,
        linked_shoot_id,
        linked_location_id,
        status,
        expected_return_at
      FROM gear_checkout_record
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, checkoutId]
  );
  return rows[0] ?? null;
}

async function getActiveCheckoutForTarget(
  client: PoolClient,
  tenantId: string,
  targetType: GearTargetType,
  targetId: string
) {
  const targetColumn = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<GearCheckoutLinkRow>(
    `
      SELECT
        id,
        checked_out_to_user_id,
        linked_shoot_id,
        linked_location_id,
        status,
        expected_return_at
      FROM gear_checkout_record
      WHERE tenant_id = $1
        AND ${targetColumn} = $2
        AND status IN ('assigned', 'checked_out')
      ORDER BY COALESCE(checked_out_at, reserved_at) DESC
      LIMIT 1
    `,
    [tenantId, targetId]
  );
  return rows[0] ?? null;
}

async function getServiceRepairRecordForUpdate(client: PoolClient, tenantId: string, serviceRecordId: string) {
  const { rows } = await client.query<GearServiceRepairRecordRow>(
    `
      SELECT *
      FROM gear_service_repair_record
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, serviceRecordId]
  );
  const record = rows[0];
  if (!record) {
    throw new ApiError(404, "Service / Repair Record not found.");
  }
  return record;
}

async function getTemporarySubstitutionForUpdate(client: PoolClient, tenantId: string, substitutionId: string) {
  const { rows } = await client.query<GearTemporarySubstitutionRow>(
    `
      SELECT *
      FROM gear_temporary_substitution
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, substitutionId]
  );
  const substitution = rows[0];
  if (!substitution) {
    throw new ApiError(404, "Temporary Substitution not found.");
  }
  return substitution;
}

async function getActiveTemporarySubstitutionByColumn(
  client: PoolClient,
  tenantId: string,
  column: "original_asset_id" | "substitute_asset_id",
  assetId: string
) {
  const { rows } = await client.query<GearTemporarySubstitutionRow>(
    `
      SELECT *
      FROM gear_temporary_substitution
      WHERE tenant_id = $1
        AND ${column} = $2
        AND status = 'active'
      LIMIT 1
      FOR UPDATE
    `,
    [tenantId, assetId]
  );
  return rows[0] ?? null;
}

async function listOpenServiceRecordsForTarget(
  client: PoolClient,
  tenantId: string,
  targetType: GearTargetType,
  targetId: string
) {
  const targetColumn = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<{ issue_type: GearServiceRepairIssueType; status: GearServiceRepairStatus }>(
    `
      SELECT issue_type, status
      FROM gear_service_repair_record
      WHERE tenant_id = $1
        AND ${targetColumn} = $2
        AND status IN ('open', 'under_review', 'in_service')
      ORDER BY opened_at DESC
    `,
    [tenantId, targetId]
  );
  return rows;
}

async function syncTargetStatusForIssueRecord(
  client: PoolClient,
  tenantId: string,
  targetType: GearTargetType,
  target: GearAssetRow | GearKitRow,
  serviceRecord: GearServiceRepairRecordRow,
  activeCheckout: GearCheckoutLinkRow | null
) {
  const openRecords = await listOpenServiceRecordsForTarget(client, tenantId, targetType, target.id);
  const nextStatus = deriveGearStatusForIssueState(targetType, target, openRecords, activeCheckout);

  if (targetType === "asset") {
    await client.query(
      `
        UPDATE gear_asset
        SET
          status = $3,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, target.id, nextStatus]
    );
    return;
  }

  await client.query(
    `
      UPDATE gear_kit
      SET
        status = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, target.id, nextStatus]
  );
}

function deriveGearStatusForIssueState(
  targetType: GearTargetType,
  target: GearAssetRow | GearKitRow,
  openRecords: Array<{ issue_type: GearServiceRepairIssueType; status: GearServiceRepairStatus }>,
  activeCheckout: GearCheckoutLinkRow | null
): GearStatus {
  if (openRecords.some((record) => record.issue_type === "missing")) {
    return "missing";
  }

  if (activeCheckout) {
    return activeCheckout.status === "assigned" ? "assigned" : "checked_out";
  }

  const hasUnderRepair = openRecords.some((record) => record.status === "in_service");
  if (hasUnderRepair) {
    return "under_repair";
  }

  const hasRepairAttention = openRecords.length > 0;
  if (hasRepairAttention) {
    return "needs_repair";
  }

  return targetType === "asset"
    ? deriveIdleAssetStatus(target as GearAssetRow)
    : deriveIdleKitStatus(target as GearKitRow);
}

function deriveIdleAssetStatus(asset: GearAssetRow): GearStatus {
  if (asset.current_custodian_id) {
    return "checked_out";
  }
  if (asset.current_kit_id) {
    return "assigned";
  }
  if (asset.home_location_id) {
    return "in_office";
  }
  return "available";
}

function deriveIdleKitStatus(kit: GearKitRow): GearStatus {
  if (kit.current_custodian_id) {
    return "checked_out";
  }
  if (kit.assigned_user_id) {
    return "assigned";
  }
  if (kit.home_location_id) {
    return "in_office";
  }
  return "available";
}

async function createGearCustodyEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    assetId?: string | null;
    kitId?: string | null;
    eventType:
      | "missing_gear_alerted"
      | "temporary_substitution_started"
      | "temporary_substitution_ended";
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

function getTargetCurrentCustodian(target: GearAssetRow | GearKitRow) {
  return "current_custodian_id" in target ? target.current_custodian_id : null;
}

function serializeServiceRecordState(record: GearServiceRepairRecordRow) {
  return {
    id: record.id,
    asset_id: record.asset_id,
    kit_id: record.kit_id,
    issue_type: record.issue_type,
    status: record.status,
    linked_shoot_id: record.linked_shoot_id,
    linked_location_id: record.linked_location_id,
    source_checkout_id: record.source_checkout_id,
    source_surface: record.source_surface,
    opened_at: record.opened_at,
    resolved_at: record.resolved_at,
    resolved_by: record.resolved_by,
    note: record.note,
    updated_at: record.updated_at
  };
}

function serializeTemporarySubstitutionState(substitution: GearTemporarySubstitutionRow) {
  return {
    id: substitution.id,
    original_asset_id: substitution.original_asset_id,
    substitute_asset_id: substitution.substitute_asset_id,
    assigned_user_id: substitution.assigned_user_id,
    linked_shoot_id: substitution.linked_shoot_id,
    linked_location_id: substitution.linked_location_id,
    substitute_checkout_id: substitution.substitute_checkout_id,
    status: substitution.status,
    starts_at: substitution.starts_at,
    ends_at: substitution.ends_at,
    note: substitution.note,
    created_by: substitution.created_by,
    ended_by: substitution.ended_by
  };
}
