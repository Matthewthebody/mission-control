import type { PoolClient } from "pg";
import { canManageGearCustody, canOverrideGearCustodyConflict } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  GearCheckoutRecord,
  GearCheckoutStatus,
  GearPreShootVerificationStatus,
  GearScanAction,
  GearServiceRepairIssueType,
  GearStatus,
  GearVerificationItemPresenceStatus
} from "../types/gear.js";
import { createAuditLog } from "./audit.js";
import { createGearCheckout, returnGearCheckout, type GearCheckoutInput, type GearReturnInput } from "./gear.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type GeoInput = {
  latitude?: number | null;
  longitude?: number | null;
};

type GearTargetType = "asset" | "kit";

type GearTargetRow = {
  target_type: GearTargetType;
  id: string;
  tenant_id: string;
  qr_code_id: string | null;
  status: GearStatus;
  label: string;
  internal_id: string;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  current_kit_id: string | null;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
  assigned_user_id: string | null;
  home_location_id: string | null;
};

type ActiveCheckoutRow = GearCheckoutRecord & {
  checked_out_to_user_name?: string | null;
  linked_shoot_title?: string | null;
};

type KitMembershipRow = {
  membership_id: string;
  asset_id: string;
  required_in_kit: boolean;
  display_order: number | null;
  asset_name: string;
  category: string;
  qr_code_id: string | null;
  status: GearStatus;
};

type VerificationRow = {
  id: string;
  tenant_id: string;
  kit_id: string;
  verified_by_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  status: GearPreShootVerificationStatus;
  all_required_items_present: boolean;
  override_reason: string | null;
  verified_ready_at: string | null;
  created_at: string;
  updated_at: string;
};

type VerificationItemRow = {
  id: string;
  tenant_id: string;
  verification_id: string;
  expected_asset_id: string | null;
  scanned_asset_id: string | null;
  required_in_kit: boolean;
  display_order: number | null;
  presence_status: GearVerificationItemPresenceStatus;
  note: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  expected_asset_name: string | null;
  expected_asset_qr_code_id: string | null;
  scanned_asset_name: string | null;
};

type ScanEventRow = {
  id: string;
  scanned_at: string;
  scan_action: GearScanAction;
  qr_code_id: string | null;
  mismatch_detected: boolean;
  override_applied: boolean;
  note: string | null;
};

type ScanHistoryRow = ScanEventRow & {
  asset_id: string | null;
  kit_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  linked_pre_shoot_verification_id: string | null;
  scanned_by_user_id: string;
  scanned_by_user_name: string | null;
  asset_name: string | null;
  kit_name: string | null;
  shoot_title: string | null;
};

export type GearResolveByQrInput = GeoInput & {
  qrCodeId: string;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  note?: string | null;
};

export type GearScanCheckoutInput = GeoInput & {
  qrCodeId: string;
  checkedOutToUserId: string;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  expectedReturnAt?: string | null;
  note?: string | null;
  overrideConflict?: boolean;
  overrideReason?: string | null;
  verificationId?: string | null;
  pickupWorkingOrderConfirmed?: boolean | null;
  pickupIssueType?: GearServiceRepairIssueType | null;
  pickupIssueNote?: string | null;
};

export type GearScanReturnInput = GeoInput & {
  qrCodeId: string;
  workingOrderConfirmed: boolean;
  issueType?: GearServiceRepairIssueType | null;
  note?: string | null;
};

export type StartPreShootVerificationInput = GeoInput & {
  kitId: string;
  linkedShootId?: string | null;
  linkedLocationId?: string | null;
  note?: string | null;
};

export type VerificationItemConfirmInput = GeoInput & {
  verificationId: string;
  expectedAssetId: string;
  note?: string | null;
};

export type VerificationItemScanInput = GeoInput & {
  verificationId: string;
  qrCodeId: string;
  note?: string | null;
  overrideMismatch?: boolean;
  overrideReason?: string | null;
};

export type VerificationItemMissingInput = GeoInput & {
  verificationId: string;
  expectedAssetId: string;
  note?: string | null;
};

export type CompletePreShootVerificationInput = GeoInput & {
  verificationId: string;
  note?: string | null;
  overrideReason?: string | null;
};

export type GearScanHistoryFilters = {
  linkedShootId?: string | null;
  targetType?: GearTargetType | null;
  targetId?: string | null;
  limit?: number;
};

export async function resolveGearByQrCode(
  client: PoolClient,
  auth: AuthUser,
  input: GearResolveByQrInput,
  _requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);

  const qrCodeId = input.qrCodeId.trim();
  if (!qrCodeId) {
    throw new ApiError(400, "QR code is required.");
  }

  const target = await findGearTargetByQrCode(client, auth.tenantId, qrCodeId);
  const action: GearScanAction = target?.target_type === "asset" ? "open_asset_detail" : "open_kit_detail";
  const linkedLocationId = target
    ? await resolveLinkedLocationId(client, auth.tenantId, input.linkedShootId ?? null, input.linkedLocationId ?? null)
    : null;
  const note = target ? input.note ?? null : "QR code did not resolve to a tracked Asset or Kit.";
  const scanEvent = await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    assetId: target?.target_type === "asset" ? target.id : null,
    kitId: target?.target_type === "kit" ? target.id : null,
    linkedShootId: input.linkedShootId ?? null,
    linkedLocationId,
    qrCodeId,
    scanAction: action,
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: !target,
    overrideApplied: false,
    note
  });

  if (!target) {
    return {
      status: "not_found" as const,
      warning: "This QR code is not linked to a tracked Asset or Kit.",
      scan_event: scanEvent,
      target: null,
      active_checkout: null,
      kit_membership: []
    };
  }

  return {
    status: "resolved" as const,
    warning: null,
    scan_event: scanEvent,
    target: serializeResolvedTarget(target),
    active_checkout: await getActiveCheckoutForTarget(client, auth.tenantId, target.target_type, target.id),
    kit_membership: target.target_type === "kit" ? (await listKitMembership(client, auth.tenantId, target.id)).map(serializeKitMembership) : []
  };
}

export async function listGearScanHistory(
  client: PoolClient,
  auth: AuthUser,
  filters: GearScanHistoryFilters = {}
) {
  assertCanManageGearCustody(auth);

  const clauses = ["gse.tenant_id = $1"];
  const params: Array<string | number> = [auth.tenantId];
  let next = params.length + 1;

  if (filters.linkedShootId) {
    clauses.push(`gse.linked_shoot_id = $${next}`);
    params.push(filters.linkedShootId);
    next += 1;
  }

  if (filters.targetType && filters.targetId) {
    clauses.push(`gse.${filters.targetType === "asset" ? "asset_id" : "kit_id"} = $${next}`);
    params.push(filters.targetId);
    next += 1;
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  params.push(limit);

  const { rows } = await client.query<ScanHistoryRow>(
    `
      SELECT
        gse.*,
        scanner.full_name AS scanned_by_user_name,
        ga.asset_name,
        gk.kit_name,
        s.title AS shoot_title
      FROM gear_scan_event gse
      JOIN app_user scanner
        ON scanner.id = gse.scanned_by_user_id
      LEFT JOIN gear_asset ga
        ON ga.id = gse.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gse.kit_id
      LEFT JOIN shoot s
        ON s.id = gse.linked_shoot_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY gse.scanned_at DESC
      LIMIT $${next}
    `,
    params
  );

  return rows.map(serializeScanHistoryRow);
}

export async function startPreShootVerification(
  client: PoolClient,
  auth: AuthUser,
  input: StartPreShootVerificationInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);

  const kit = await getKitForUpdate(client, auth.tenantId, input.kitId);
  const linkedLocationId = await resolveLinkedLocationId(client, auth.tenantId, input.linkedShootId ?? null, input.linkedLocationId ?? null);
  const existing = await getExistingInProgressVerification(client, auth.tenantId, input.kitId, input.linkedShootId ?? null);
  if (existing) {
    return loadVerificationBundle(client, auth.tenantId, existing.id);
  }

  const { rows } = await client.query<VerificationRow>(
    `
      INSERT INTO gear_pre_shoot_verification (
        tenant_id,
        kit_id,
        verified_by_user_id,
        linked_shoot_id,
        linked_location_id,
        status,
        all_required_items_present
      )
      VALUES ($1, $2, $3, $4, $5, 'in_progress', false)
      RETURNING *
    `,
    [auth.tenantId, input.kitId, auth.id, input.linkedShootId ?? null, linkedLocationId]
  );

  const verification = rows[0];
  const membership = await listKitMembership(client, auth.tenantId, input.kitId);
  for (const item of membership) {
    await client.query(
      `
        INSERT INTO gear_pre_shoot_verification_item (
          tenant_id,
          verification_id,
          expected_asset_id,
          required_in_kit,
          display_order,
          presence_status
        )
        VALUES ($1, $2, $3, $4, $5, 'pending')
      `,
      [auth.tenantId, verification.id, item.asset_id, item.required_in_kit, item.display_order]
    );
  }

  await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    kitId: input.kitId,
    linkedShootId: input.linkedShootId ?? null,
    linkedLocationId,
    linkedPreShootVerificationId: verification.id,
    qrCodeId: kit.qr_code_id,
    scanAction: "pre_shoot_verification",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: false,
    overrideApplied: false,
    note: input.note ?? "Pre-Shoot Verification started."
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.pre_shoot_verification.started",
    entityType: "gear_pre_shoot_verification",
    entityId: verification.id,
    previousValues: {},
    newValues: {
      kit_id: verification.kit_id,
      linked_shoot_id: verification.linked_shoot_id,
      status: verification.status
    },
    reasonComment: input.note ?? "Pre-Shoot Verification started.",
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return loadVerificationBundle(client, auth.tenantId, verification.id);
}

export async function confirmPreShootVerificationItem(
  client: PoolClient,
  auth: AuthUser,
  input: VerificationItemConfirmInput,
  _requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);
  const verification = await getVerificationForUpdate(client, auth.tenantId, input.verificationId);
  const item = await getVerificationItemForExpectedAsset(client, auth.tenantId, input.verificationId, input.expectedAssetId);

  await client.query(
    `
      UPDATE gear_pre_shoot_verification_item
      SET
        scanned_asset_id = COALESCE(scanned_asset_id, expected_asset_id),
        presence_status = 'present',
        note = $4,
        confirmed_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND verification_id = $2
        AND id = $3
    `,
    [auth.tenantId, input.verificationId, item.id, input.note ?? null]
  );

  await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    assetId: input.expectedAssetId,
    kitId: verification.kit_id,
    linkedShootId: verification.linked_shoot_id,
    linkedLocationId: verification.linked_location_id,
    linkedPreShootVerificationId: verification.id,
    qrCodeId: null,
    scanAction: "confirm_contents_presence",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: false,
    overrideApplied: false,
    note: input.note ?? "Contents manually confirmed present."
  });

  return loadVerificationBundle(client, auth.tenantId, verification.id);
}

export async function recordPreShootVerificationItemScan(
  client: PoolClient,
  auth: AuthUser,
  input: VerificationItemScanInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);
  const verification = await getVerificationForUpdate(client, auth.tenantId, input.verificationId);
  const qrCodeId = input.qrCodeId.trim();
  if (!qrCodeId) {
    throw new ApiError(400, "QR code is required.");
  }

  const target = await findGearTargetByQrCode(client, auth.tenantId, qrCodeId);
  if (!target || target.target_type !== "asset") {
    const scanEvent = await createGearScanEvent(client, {
      tenantId: auth.tenantId,
      kitId: verification.kit_id,
      linkedShootId: verification.linked_shoot_id,
      linkedLocationId: verification.linked_location_id,
      linkedPreShootVerificationId: verification.id,
      qrCodeId,
      scanAction: "confirm_contents_presence",
      scannedByUserId: auth.id,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      mismatchDetected: true,
      overrideApplied: false,
      note: "Scanned QR code did not resolve to a tracked Asset for this Pre-Shoot Verification."
    });

    return {
      status: "mismatch" as const,
      warning: "That QR code does not belong to a tracked Asset in this Kit.",
      override_allowed: canOverrideGearCustodyConflict(auth),
      scan_event: scanEvent,
      verification: await loadVerificationBundle(client, auth.tenantId, verification.id)
    };
  }

  const membership = await getKitMembershipByAsset(client, auth.tenantId, verification.kit_id, target.id);
  if (!membership) {
    if (input.overrideMismatch) {
      if (!canOverrideGearCustodyConflict(auth)) {
        throw new ApiError(403, "Only leadership can override a Kit contents mismatch.");
      }
      if (!input.overrideReason?.trim()) {
        throw new ApiError(400, "Override reason is required for a mismatch override.");
      }

      await client.query(
        `
          INSERT INTO gear_pre_shoot_verification_item (
            tenant_id,
            verification_id,
            expected_asset_id,
            scanned_asset_id,
            required_in_kit,
            display_order,
            presence_status,
            note,
            confirmed_at
          )
          VALUES ($1, $2, NULL, $3, false, NULL, 'unexpected', $4, now())
        `,
        [auth.tenantId, verification.id, target.id, input.overrideReason.trim()]
      );

      const scanEvent = await createGearScanEvent(client, {
        tenantId: auth.tenantId,
        assetId: target.id,
        kitId: verification.kit_id,
        linkedShootId: verification.linked_shoot_id,
        linkedLocationId: verification.linked_location_id,
        linkedPreShootVerificationId: verification.id,
        qrCodeId,
        scanAction: "confirm_contents_presence",
        scannedByUserId: auth.id,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        mismatchDetected: true,
        overrideApplied: true,
        note: input.overrideReason.trim()
      });

      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "gear.pre_shoot_verification.mismatch_override",
        entityType: "gear_pre_shoot_verification",
        entityId: verification.id,
        previousValues: {},
        newValues: {
          scanned_asset_id: target.id,
          override_reason: input.overrideReason.trim()
        },
        reasonComment: input.overrideReason.trim(),
        sourceSurface: requestMeta.sourceSurface ?? null,
        ipAddress: requestMeta.ipAddress ?? null,
        userAgent: requestMeta.userAgent ?? null
      });

      return {
        status: "override_applied" as const,
        warning: `${target.label} does not belong to this Kit. Leadership override logged as a Temporary Substitution.`,
        override_allowed: true,
        scan_event: scanEvent,
        verification: await loadVerificationBundle(client, auth.tenantId, verification.id)
      };
    }

    const scanEvent = await createGearScanEvent(client, {
      tenantId: auth.tenantId,
      assetId: target.id,
      kitId: verification.kit_id,
      linkedShootId: verification.linked_shoot_id,
      linkedLocationId: verification.linked_location_id,
      linkedPreShootVerificationId: verification.id,
      qrCodeId,
      scanAction: "confirm_contents_presence",
      scannedByUserId: auth.id,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      mismatchDetected: true,
      overrideApplied: false,
      note: `${target.label} does not belong to this Kit.`
    });

    return {
      status: "mismatch" as const,
      warning: `${target.label} does not belong to this Kit.`,
      override_allowed: canOverrideGearCustodyConflict(auth),
      scan_event: scanEvent,
      verification: await loadVerificationBundle(client, auth.tenantId, verification.id)
    };
  }

  await client.query(
    `
      UPDATE gear_pre_shoot_verification_item
      SET
        scanned_asset_id = $4,
        presence_status = 'present',
        note = $5,
        confirmed_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND verification_id = $2
        AND expected_asset_id = $3
    `,
    [auth.tenantId, verification.id, target.id, target.id, input.note ?? null]
  );

  const scanEvent = await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    assetId: target.id,
    kitId: verification.kit_id,
    linkedShootId: verification.linked_shoot_id,
    linkedLocationId: verification.linked_location_id,
    linkedPreShootVerificationId: verification.id,
    qrCodeId,
    scanAction: "confirm_contents_presence",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: false,
    overrideApplied: false,
    note: input.note ?? "Kit contents confirmed present by QR scan."
  });

  return {
    status: "confirmed" as const,
    warning: null,
    override_allowed: false,
    scan_event: scanEvent,
    verification: await loadVerificationBundle(client, auth.tenantId, verification.id)
  };
}

export async function markPreShootVerificationItemMissing(
  client: PoolClient,
  auth: AuthUser,
  input: VerificationItemMissingInput,
  _requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);
  const verification = await getVerificationForUpdate(client, auth.tenantId, input.verificationId);
  const item = await getVerificationItemForExpectedAsset(client, auth.tenantId, input.verificationId, input.expectedAssetId);

  await client.query(
    `
      UPDATE gear_pre_shoot_verification_item
      SET
        presence_status = 'missing',
        note = $4,
        confirmed_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND verification_id = $2
        AND id = $3
    `,
    [auth.tenantId, input.verificationId, item.id, input.note ?? null]
  );

  await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    assetId: input.expectedAssetId,
    kitId: verification.kit_id,
    linkedShootId: verification.linked_shoot_id,
    linkedLocationId: verification.linked_location_id,
    linkedPreShootVerificationId: verification.id,
    qrCodeId: null,
    scanAction: "log_missing_item",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: true,
    overrideApplied: false,
    note: input.note ?? "Kit item marked missing during Pre-Shoot Verification."
  });

  return loadVerificationBundle(client, auth.tenantId, verification.id);
}

export async function completePreShootVerification(
  client: PoolClient,
  auth: AuthUser,
  input: CompletePreShootVerificationInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);
  const verification = await getVerificationForUpdate(client, auth.tenantId, input.verificationId);
  const previousValues = {
    status: verification.status,
    all_required_items_present: verification.all_required_items_present,
    override_reason: verification.override_reason
  };

  await client.query(
    `
      UPDATE gear_pre_shoot_verification_item
      SET
        presence_status = CASE
          WHEN required_in_kit AND presence_status = 'pending' THEN 'missing'
          ELSE presence_status
        END,
        confirmed_at = CASE
          WHEN required_in_kit AND presence_status = 'pending' THEN now()
          ELSE confirmed_at
        END,
        note = CASE
          WHEN required_in_kit AND presence_status = 'pending' AND note IS NULL THEN 'Not confirmed before departure.'
          ELSE note
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND verification_id = $2
    `,
    [auth.tenantId, verification.id]
  );

  const statusSummary = await client.query<{ missing_required_count: string }>(
    `
      SELECT COUNT(*)::text AS missing_required_count
      FROM gear_pre_shoot_verification_item
      WHERE tenant_id = $1
        AND verification_id = $2
        AND required_in_kit = true
        AND presence_status = 'missing'
    `,
    [auth.tenantId, verification.id]
  );

  const missingRequiredCount = Number(statusSummary.rows[0]?.missing_required_count ?? 0);
  const allRequiredItemsPresent = missingRequiredCount === 0;
  const nextStatus: GearPreShootVerificationStatus = allRequiredItemsPresent ? "verified_ready" : "verified_with_missing_items";

  const { rows } = await client.query<VerificationRow>(
    `
      UPDATE gear_pre_shoot_verification
      SET
        status = $3,
        all_required_items_present = $4,
        override_reason = $5,
        verified_ready_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [auth.tenantId, verification.id, nextStatus, allRequiredItemsPresent, input.overrideReason ?? null]
  );

  const updated = rows[0];
  const completionNote = input.note?.trim()
    ? input.note.trim()
    : allRequiredItemsPresent
      ? "Pre-Shoot Verification completed and ready for departure."
      : "Pre-Shoot Verification completed with missing items recorded.";

  await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    kitId: updated.kit_id,
    linkedShootId: updated.linked_shoot_id,
    linkedLocationId: updated.linked_location_id,
    linkedPreShootVerificationId: updated.id,
    qrCodeId: null,
    scanAction: "pre_shoot_verification",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: !allRequiredItemsPresent,
    overrideApplied: Boolean(input.overrideReason?.trim()),
    note: completionNote
  });

  await createGearCustodyEvent(client, {
    tenantId: auth.tenantId,
    kitId: updated.kit_id,
    eventType: "pre_shoot_verification",
    linkedShootId: updated.linked_shoot_id,
    linkedLocationId: updated.linked_location_id,
    note: completionNote,
    createdBy: auth.id
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.pre_shoot_verification.completed",
    entityType: "gear_pre_shoot_verification",
    entityId: updated.id,
    previousValues,
    newValues: {
      status: updated.status,
      all_required_items_present: updated.all_required_items_present,
      override_reason: updated.override_reason
    },
    reasonComment: completionNote,
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return loadVerificationBundle(client, auth.tenantId, verification.id);
}

export async function checkOutGearByQr(
  client: PoolClient,
  auth: AuthUser,
  input: GearScanCheckoutInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);
  const qrCodeId = input.qrCodeId.trim();
  if (!qrCodeId) {
    throw new ApiError(400, "QR code is required.");
  }

  const target = await findGearTargetByQrCode(client, auth.tenantId, qrCodeId);
  if (!target) {
    const scanEvent = await createGearScanEvent(client, {
      tenantId: auth.tenantId,
      linkedShootId: input.linkedShootId ?? null,
      linkedLocationId: await resolveLinkedLocationId(client, auth.tenantId, input.linkedShootId ?? null, input.linkedLocationId ?? null),
      qrCodeId,
      scanAction: "check_out",
      scannedByUserId: auth.id,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      mismatchDetected: true,
      overrideApplied: false,
      note: "QR code did not resolve to a tracked Asset or Kit for checkout."
    });
    return {
      status: "not_found" as const,
      warning: "This QR code is not linked to a tracked Asset or Kit.",
      scan_event: scanEvent
    };
  }

  const linkedLocationId = await resolveLinkedLocationId(client, auth.tenantId, input.linkedShootId ?? null, input.linkedLocationId ?? null);
  const existingConflict = await getActiveCheckoutForTarget(client, auth.tenantId, target.target_type, target.id);
  if (existingConflict && !input.overrideConflict) {
    const scanEvent = await createGearScanEvent(client, {
      tenantId: auth.tenantId,
      assetId: target.target_type === "asset" ? target.id : null,
      kitId: target.target_type === "kit" ? target.id : null,
      linkedShootId: input.linkedShootId ?? null,
      linkedLocationId,
      qrCodeId,
      scanAction: "check_out",
      scannedByUserId: auth.id,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      mismatchDetected: true,
      overrideApplied: false,
      note: `${target.label} is already ${existingConflict.status === "assigned" ? "Assigned" : "Checked Out"}.`
    });

    return {
      status: "conflict" as const,
      warning: `${target.label} is already ${existingConflict.status === "assigned" ? "Assigned" : "Checked Out"}.`,
      conflict: existingConflict,
      scan_event: scanEvent
    };
  }

  if (target.target_type === "kit") {
    const verification = await getCompletedVerificationForCheckout(client, auth.tenantId, target.id, input.verificationId ?? null);
    if (!verification) {
      const scanEvent = await createGearScanEvent(client, {
        tenantId: auth.tenantId,
        kitId: target.id,
        linkedShootId: input.linkedShootId ?? null,
        linkedLocationId,
        qrCodeId,
        scanAction: "check_out",
        scannedByUserId: auth.id,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        mismatchDetected: true,
        overrideApplied: false,
        note: "Pre-Shoot Verification must be completed before this Kit can be checked out."
      });
      return {
        status: "verification_required" as const,
        warning: "Pre-Shoot Verification is required before this Kit can be checked out.",
        scan_event: scanEvent
      };
    }
  }

  const checkoutInput: GearCheckoutInput = {
    targetType: target.target_type,
    targetId: target.id,
    checkedOutToUserId: input.checkedOutToUserId,
    initialStatus: "checked_out",
    linkedShootId: input.linkedShootId ?? null,
    linkedLocationId,
    expectedReturnAt: input.expectedReturnAt ?? null,
    note: input.note ?? null,
    overrideConflict: input.overrideConflict ?? false,
    overrideReason: input.overrideReason ?? null,
    pickupWorkingOrderConfirmed: input.pickupWorkingOrderConfirmed ?? null,
    pickupIssueType: input.pickupIssueType ?? null,
    pickupIssueNote: input.pickupIssueNote ?? null
  };

  const checkoutResult = await createGearCheckout(client, auth, checkoutInput, requestMeta);
  const scanEvent = await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    assetId: target.target_type === "asset" ? target.id : null,
    kitId: target.target_type === "kit" ? target.id : null,
    linkedShootId: input.linkedShootId ?? null,
    linkedLocationId,
    linkedPreShootVerificationId: input.verificationId ?? null,
    qrCodeId,
    scanAction: "check_out",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: false,
    overrideApplied: Boolean(input.overrideConflict),
    note: input.note ?? "Checked Out by QR scan."
  });

  return {
    status: "checked_out" as const,
    warning: null,
    checkout: checkoutResult.checkout,
    conflict_override_applied: checkoutResult.conflict_override_applied,
    scan_event: scanEvent,
    target: serializeResolvedTarget(target)
  };
}

export async function returnGearByQr(
  client: PoolClient,
  auth: AuthUser,
  input: GearScanReturnInput,
  requestMeta: RequestMeta = {}
) {
  assertCanManageGearCustody(auth);
  const qrCodeId = input.qrCodeId.trim();
  if (!qrCodeId) {
    throw new ApiError(400, "QR code is required.");
  }

  const target = await findGearTargetByQrCode(client, auth.tenantId, qrCodeId);
  if (!target) {
    const scanEvent = await createGearScanEvent(client, {
      tenantId: auth.tenantId,
      qrCodeId,
      scanAction: "return",
      scannedByUserId: auth.id,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      mismatchDetected: true,
      overrideApplied: false,
      note: "QR code did not resolve to a tracked Asset or Kit for return."
    });
    return {
      status: "not_found" as const,
      warning: "This QR code is not linked to a tracked Asset or Kit.",
      scan_event: scanEvent
    };
  }

  const checkout = await getActiveCheckoutForTarget(client, auth.tenantId, target.target_type, target.id);
  if (!checkout) {
    const scanEvent = await createGearScanEvent(client, {
      tenantId: auth.tenantId,
      assetId: target.target_type === "asset" ? target.id : null,
      kitId: target.target_type === "kit" ? target.id : null,
      qrCodeId,
      scanAction: "return",
      scannedByUserId: auth.id,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      mismatchDetected: true,
      overrideApplied: false,
      note: `${target.label} does not have an active checkout to return.`
    });
    return {
      status: "not_checked_out" as const,
      warning: `${target.label} does not have an active checkout to return.`,
      scan_event: scanEvent,
      target: serializeResolvedTarget(target)
    };
  }

  const returnInput: GearReturnInput = {
    checkoutId: checkout.id,
    returnedAt: null,
    workingOrderConfirmed: input.workingOrderConfirmed,
    issueType: input.issueType ?? null,
    note: input.note ?? null
  };

  const result = await returnGearCheckout(client, auth, returnInput, requestMeta);
  const scanEvent = await createGearScanEvent(client, {
    tenantId: auth.tenantId,
    assetId: target.target_type === "asset" ? target.id : null,
    kitId: target.target_type === "kit" ? target.id : null,
    linkedShootId: checkout.linked_shoot_id,
    linkedLocationId: checkout.linked_location_id,
    qrCodeId,
    scanAction: "return",
    scannedByUserId: auth.id,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    mismatchDetected: false,
    overrideApplied: false,
    note: input.note ?? "Returned by QR scan."
  });

  return {
    status: "returned" as const,
    warning: null,
    checkout: result.checkout,
    issue_created: result.issue_created,
    scan_event: scanEvent,
    target: serializeResolvedTarget(target)
  };
}

async function findGearTargetByQrCode(client: PoolClient, tenantId: string, qrCodeId: string) {
  const { rows } = await client.query<GearTargetRow>(
    `
      SELECT
        'asset'::text AS target_type,
        ga.id,
        ga.tenant_id,
        ga.qr_code_id,
        ga.status,
        ga.asset_name AS label,
        ga.internal_asset_id AS internal_id,
        ga.category,
        ga.manufacturer,
        ga.model,
        ga.serial_number,
        ga.current_kit_id,
        ga.current_custodian_id,
        ga.last_seen_with_user_id,
        NULL::uuid AS assigned_user_id,
        ga.home_location_id
      FROM gear_asset ga
      WHERE ga.tenant_id = $1
        AND lower(ga.qr_code_id) = lower($2)
      UNION ALL
      SELECT
        'kit'::text AS target_type,
        gk.id,
        gk.tenant_id,
        gk.qr_code_id,
        gk.status,
        gk.kit_name AS label,
        gk.internal_kit_id AS internal_id,
        gk.kit_type AS category,
        NULL::text AS manufacturer,
        NULL::text AS model,
        NULL::text AS serial_number,
        NULL::uuid AS current_kit_id,
        gk.current_custodian_id,
        gk.last_seen_with_user_id,
        gk.assigned_user_id,
        gk.home_location_id
      FROM gear_kit gk
      WHERE gk.tenant_id = $1
        AND lower(gk.qr_code_id) = lower($2)
    `,
    [tenantId, qrCodeId]
  );

  if (rows.length > 1) {
    throw new ApiError(409, "QR code is linked to more than one tracked gear record.");
  }
  return rows[0] ?? null;
}

async function getActiveCheckoutForTarget(
  client: PoolClient,
  tenantId: string,
  targetType: GearTargetType,
  targetId: string
) {
  const column = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<ActiveCheckoutRow>(
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
        AND gcr.${column} = $2
        AND gcr.status IN ('assigned', 'checked_out')
      ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
      LIMIT 1
    `,
    [tenantId, targetId]
  );
  return rows[0] ?? null;
}

async function listKitMembership(client: PoolClient, tenantId: string, kitId: string) {
  const { rows } = await client.query<KitMembershipRow>(
    `
      SELECT
        gkam.id AS membership_id,
        gkam.asset_id,
        gkam.required_in_kit,
        gkam.display_order,
        ga.asset_name,
        ga.category,
        ga.qr_code_id,
        ga.status
      FROM gear_kit_asset_membership gkam
      JOIN gear_asset ga
        ON ga.id = gkam.asset_id
      WHERE gkam.tenant_id = $1
        AND gkam.kit_id = $2
      ORDER BY COALESCE(gkam.display_order, 9999), ga.asset_name ASC
    `,
    [tenantId, kitId]
  );
  return rows;
}

async function getKitMembershipByAsset(client: PoolClient, tenantId: string, kitId: string, assetId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM gear_kit_asset_membership
      WHERE tenant_id = $1
        AND kit_id = $2
        AND asset_id = $3
      LIMIT 1
    `,
    [tenantId, kitId, assetId]
  );
  return rows[0] ?? null;
}

async function getKitForUpdate(client: PoolClient, tenantId: string, kitId: string) {
  const { rows } = await client.query<{ id: string; qr_code_id: string | null }>(
    `
      SELECT id, qr_code_id
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

async function getExistingInProgressVerification(client: PoolClient, tenantId: string, kitId: string, linkedShootId: string | null) {
  const { rows } = await client.query<VerificationRow>(
    `
      SELECT *
      FROM gear_pre_shoot_verification
      WHERE tenant_id = $1
        AND kit_id = $2
        AND status = 'in_progress'
        AND (
          ($3::uuid IS NULL AND linked_shoot_id IS NULL)
          OR linked_shoot_id = $3::uuid
        )
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [tenantId, kitId, linkedShootId]
  );
  return rows[0] ?? null;
}

async function getVerificationForUpdate(client: PoolClient, tenantId: string, verificationId: string) {
  const { rows } = await client.query<VerificationRow>(
    `
      SELECT *
      FROM gear_pre_shoot_verification
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [tenantId, verificationId]
  );
  const verification = rows[0];
  if (!verification) {
    throw new ApiError(404, "Pre-Shoot Verification not found.");
  }
  return verification;
}

async function getVerificationItemForExpectedAsset(
  client: PoolClient,
  tenantId: string,
  verificationId: string,
  expectedAssetId: string
) {
  const { rows } = await client.query<VerificationItemRow>(
    `
      SELECT
        item.*,
        NULL::text AS expected_asset_name,
        NULL::text AS expected_asset_qr_code_id,
        NULL::text AS scanned_asset_name
      FROM gear_pre_shoot_verification_item item
      WHERE item.tenant_id = $1
        AND item.verification_id = $2
        AND item.expected_asset_id = $3
      LIMIT 1
      FOR UPDATE
    `,
    [tenantId, verificationId, expectedAssetId]
  );

  const item = rows[0];
  if (!item) {
    throw new ApiError(404, "Expected Kit item not found in this Pre-Shoot Verification.");
  }
  return item;
}

async function getCompletedVerificationForCheckout(
  client: PoolClient,
  tenantId: string,
  kitId: string,
  verificationId: string | null
) {
  if (!verificationId) {
    return null;
  }

  const { rows } = await client.query<VerificationRow>(
    `
      SELECT *
      FROM gear_pre_shoot_verification
      WHERE tenant_id = $1
        AND id = $2
        AND kit_id = $3
        AND status IN ('verified_ready', 'verified_with_missing_items')
      LIMIT 1
    `,
    [tenantId, verificationId, kitId]
  );

  return rows[0] ?? null;
}

async function loadVerificationBundle(client: PoolClient, tenantId: string, verificationId: string) {
  const verification = await getVerificationForUpdate(client, tenantId, verificationId);
  const { rows } = await client.query<VerificationItemRow>(
    `
      SELECT
        item.*,
        expected.asset_name AS expected_asset_name,
        expected.qr_code_id AS expected_asset_qr_code_id,
        scanned.asset_name AS scanned_asset_name
      FROM gear_pre_shoot_verification_item item
      LEFT JOIN gear_asset expected
        ON expected.id = item.expected_asset_id
      LEFT JOIN gear_asset scanned
        ON scanned.id = item.scanned_asset_id
      WHERE item.tenant_id = $1
        AND item.verification_id = $2
      ORDER BY COALESCE(item.display_order, 9999), COALESCE(expected.asset_name, scanned.asset_name, item.id::text)
    `,
    [tenantId, verificationId]
  );

  const kitMembership = await listKitMembership(client, tenantId, verification.kit_id);
  return {
    verification,
    items: rows.map(serializeVerificationItem),
    kit_membership: kitMembership.map(serializeKitMembership),
    counts: {
      total_items: rows.length,
      required_items: rows.filter((row) => row.required_in_kit).length,
      present_items: rows.filter((row) => row.presence_status === "present").length,
      missing_items: rows.filter((row) => row.presence_status === "missing").length,
      unexpected_items: rows.filter((row) => row.presence_status === "unexpected").length,
      pending_items: rows.filter((row) => row.presence_status === "pending").length
    }
  };
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

async function createGearScanEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    assetId?: string | null;
    kitId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    linkedPreShootVerificationId?: string | null;
    qrCodeId?: string | null;
    scanAction: GearScanAction;
    scannedByUserId: string;
    latitude?: number | null;
    longitude?: number | null;
    mismatchDetected?: boolean;
    overrideApplied?: boolean;
    note?: string | null;
  }
) {
  const { rows } = await client.query<ScanEventRow>(
    `
      INSERT INTO gear_scan_event (
        tenant_id,
        asset_id,
        kit_id,
        linked_shoot_id,
        linked_location_id,
        linked_pre_shoot_verification_id,
        qr_code_id,
        scan_action,
        scanned_by_user_id,
        latitude,
        longitude,
        mismatch_detected,
        override_applied,
        note
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
        $12,
        $13,
        $14
      )
      RETURNING id, scanned_at, scan_action, qr_code_id, mismatch_detected, override_applied, note
    `,
    [
      input.tenantId,
      input.assetId ?? null,
      input.kitId ?? null,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.linkedPreShootVerificationId ?? null,
      input.qrCodeId ?? null,
      input.scanAction,
      input.scannedByUserId,
      input.latitude ?? null,
      input.longitude ?? null,
      input.mismatchDetected ?? false,
      input.overrideApplied ?? false,
      input.note ?? null
    ]
  );
  return rows[0];
}

async function createGearCustodyEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    assetId?: string | null;
    kitId?: string | null;
    eventType: "pre_shoot_verification";
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
        now(),
        $7,
        $8
      )
    `,
    [
      input.tenantId,
      input.assetId ?? null,
      input.kitId ?? null,
      input.eventType,
      input.linkedShootId ?? null,
      input.linkedLocationId ?? null,
      input.note ?? null,
      input.createdBy
    ]
  );
}

function serializeResolvedTarget(target: GearTargetRow) {
  return {
    target_type: target.target_type,
    id: target.id,
    label: target.label,
    internal_id: target.internal_id,
    status: target.status,
    qr_code_id: target.qr_code_id,
    category: target.category,
    manufacturer: target.manufacturer,
    model: target.model,
    serial_number: target.serial_number,
    current_kit_id: target.current_kit_id,
    current_custodian_id: target.current_custodian_id,
    last_seen_with_user_id: target.last_seen_with_user_id,
    assigned_user_id: target.assigned_user_id,
    home_location_id: target.home_location_id
  };
}

function serializeKitMembership(row: KitMembershipRow) {
  return {
    membership_id: row.membership_id,
    asset_id: row.asset_id,
    asset_name: row.asset_name,
    category: row.category,
    required_in_kit: row.required_in_kit,
    display_order: row.display_order,
    qr_enabled: Boolean(row.qr_code_id),
    status: row.status
  };
}

function serializeVerificationItem(row: VerificationItemRow) {
  return {
    id: row.id,
    expected_asset_id: row.expected_asset_id,
    expected_asset_name: row.expected_asset_name,
    expected_asset_qr_enabled: Boolean(row.expected_asset_qr_code_id),
    scanned_asset_id: row.scanned_asset_id,
    scanned_asset_name: row.scanned_asset_name,
    required_in_kit: row.required_in_kit,
    display_order: row.display_order,
    presence_status: row.presence_status,
    note: row.note,
    confirmed_at: row.confirmed_at
  };
}

function serializeScanHistoryRow(row: ScanHistoryRow) {
  return {
    id: row.id,
    asset_id: row.asset_id,
    kit_id: row.kit_id,
    linked_shoot_id: row.linked_shoot_id,
    linked_location_id: row.linked_location_id,
    linked_pre_shoot_verification_id: row.linked_pre_shoot_verification_id,
    qr_code_id: row.qr_code_id,
    scan_action: row.scan_action,
    scanned_by_user_id: row.scanned_by_user_id,
    scanned_by_user_name: row.scanned_by_user_name,
    scanned_at: row.scanned_at,
    mismatch_detected: row.mismatch_detected,
    override_applied: row.override_applied,
    note: row.note,
    target_label: row.asset_name ?? row.kit_name,
    shoot_title: row.shoot_title
  };
}

function assertCanManageGearCustody(auth: AuthUser) {
  if (!canManageGearCustody(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}
