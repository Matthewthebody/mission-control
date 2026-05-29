import type { PoolClient } from "pg";
import { canOverrideGearCustodyConflict, canViewGearInventory } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import type {
  GearAlertSummary,
  GearCustodyActivityItem,
  GearCustodyReportItem,
  GearInventoryQueueItem,
  GearMonthlyReportItem,
  GearMonthlyReportSummary,
  GearMonthlyReportView,
  GearScanActivityItem,
  GearServiceRepairSummary
} from "../types/gearInventory.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type QueueLikeRow = GearInventoryQueueItem;
type AlertSummaryRow = GearAlertSummary;
type MonthlyReportItemRow = GearMonthlyReportItem;
type ServiceRepairRow = GearServiceRepairSummary;
type CustodyReportRow = GearCustodyReportItem;
type CustodyActivityRow = GearCustodyActivityItem;
type ScanActivityRow = GearScanActivityItem;

export async function getGearMonthlyReport(
  client: PoolClient,
  auth: AuthUser,
  month: string | null
): Promise<GearMonthlyReportView> {
  assertCanViewGearInventory(auth);

  const { monthKey, periodStart, periodEnd } = normalizeMonthWindow(month);

  const [missingItems, overdueReturns, unresolvedRepairs, missingOver30Days, currentCustody, recentCustodyActivity, recentScanActivity, tileAttention] =
    await Promise.all([
      listAlertReportItems(client, auth.tenantId, "missing_gear"),
      listAlertReportItems(client, auth.tenantId, "overdue_return"),
      listUnresolvedRepairs(client, auth.tenantId),
      listAlertReportItems(client, auth.tenantId, "missing_gear", true),
      listCurrentCustody(client, auth.tenantId),
      listRecentCustodyActivity(client, auth.tenantId, periodStart, periodEnd),
      listRecentScanActivity(client, auth.tenantId, periodStart, periodEnd),
      listTileAttention(client, auth.tenantId)
    ]);

  const summary: GearMonthlyReportSummary = {
    missing_items: missingItems.length,
    overdue_returns: overdueReturns.length,
    unresolved_repairs: unresolvedRepairs.length,
    missing_over_30_days: missingOver30Days.length,
    current_custody: currentCustody.length,
    recent_custody_activity: recentCustodyActivity.length,
    recent_scan_activity: recentScanActivity.length,
    tile_attention_items: tileAttention.length
  };

  return {
    month: monthKey,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    summary,
    missing_items: missingItems,
    overdue_returns: overdueReturns,
    unresolved_repairs: unresolvedRepairs,
    missing_over_30_days: missingOver30Days,
    current_custody: currentCustody,
    recent_custody_activity: recentCustodyActivity,
    recent_scan_activity: recentScanActivity,
    tile_attention: tileAttention
  };
}

export async function resolveGearAlert(
  client: PoolClient,
  auth: AuthUser,
  input: {
    alertId: string;
    resolutionNote?: string | null;
  },
  requestMeta: RequestMeta = {}
) {
  assertCanResolveGearAlerts(auth);

  const { rows } = await client.query<{
    id: string;
    alert_type: string;
    status: string;
    asset_id: string | null;
    kit_id: string | null;
    checkout_id: string | null;
    linked_shoot_id: string | null;
    linked_location_id: string | null;
    first_triggered_at: string;
    last_triggered_at: string;
    due_at: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_type: string | null;
    resolution_note: string | null;
  }>(
    `
      SELECT *
      FROM gear_alert
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [auth.tenantId, input.alertId]
  );

  const existing = rows[0];
  if (!existing) {
    throw new ApiError(404, "Gear alert not found.");
  }

  if (existing.status === "resolved") {
    return getGearAlertSummary(client, auth.tenantId, existing.id);
  }

  await client.query(
    `
      UPDATE gear_alert
      SET
        status = 'resolved',
        resolved_at = now(),
        resolved_by = $3,
        resolution_type = 'manual_resolution',
        resolution_note = $4,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, existing.id, auth.id, input.resolutionNote?.trim() || null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "gear.alert.manually_resolved",
    entityType: "gear_alert",
    entityId: existing.id,
    previousValues: existing,
    newValues: {
      ...existing,
      status: "resolved",
      resolved_by: auth.id,
      resolution_type: "manual_resolution",
      resolution_note: input.resolutionNote?.trim() || null
    },
    reasonComment: input.resolutionNote?.trim() || "Gear alert manually resolved.",
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return getGearAlertSummary(client, auth.tenantId, existing.id);
}

async function getGearAlertSummary(client: PoolClient, tenantId: string, alertId: string) {
  const { rows } = await client.query<AlertSummaryRow>(
    `
      SELECT
        gal.id,
        gal.alert_type,
        gal.status,
        gal.checkout_id,
        gal.linked_shoot_id,
        shoot.title AS linked_shoot_title,
        gal.linked_location_id,
        location.name AS linked_location_name,
        gal.first_triggered_at,
        gal.last_triggered_at,
        gal.due_at,
        gal.resolved_at,
        resolver.full_name AS resolved_by_name,
        gal.resolution_type,
        gal.resolution_note
      FROM gear_alert gal
      LEFT JOIN shoot shoot
        ON shoot.id = gal.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gal.linked_location_id
      LEFT JOIN app_user resolver
        ON resolver.id = gal.resolved_by
      WHERE gal.tenant_id = $1
        AND gal.id = $2
      LIMIT 1
    `,
    [tenantId, alertId]
  );

  const alert = rows[0];
  if (!alert) {
    throw new ApiError(404, "Gear alert not found.");
  }
  return alert;
}

async function listAlertReportItems(
  client: PoolClient,
  tenantId: string,
  alertType: "missing_gear" | "overdue_return",
  onlyMissingOver30Days = false
) {
  const { rows } = await client.query<MonthlyReportItemRow>(
    `
      SELECT
        CASE WHEN gal.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        COALESCE(ga.status, gk.status) AS status,
        current_custodian.full_name AS current_custodian_name,
        last_seen.full_name AS last_seen_with_name,
        COALESCE(gcr.linked_shoot_id, gal.linked_shoot_id) AS linked_shoot_id,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gal.due_at,
        gal.first_triggered_at AS event_at,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        COALESCE(gsr.note, gcr.checkout_note, ga.notes, gk.notes, 'Operational follow-up required.') AS note
      FROM gear_alert gal
      LEFT JOIN gear_checkout_record gcr
        ON gcr.id = gal.checkout_id
      LEFT JOIN gear_asset ga
        ON ga.id = gal.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gal.kit_id
      LEFT JOIN app_user current_custodian
        ON current_custodian.id = COALESCE(gcr.checked_out_to_user_id, ga.current_custodian_id, gk.current_custodian_id)
      LEFT JOIN app_user last_seen
        ON last_seen.id = COALESCE(ga.last_seen_with_user_id, gk.last_seen_with_user_id)
      LEFT JOIN shoot shoot
        ON shoot.id = COALESCE(gcr.linked_shoot_id, gal.linked_shoot_id)
      LEFT JOIN shoot_location location
        ON location.id = COALESCE(gcr.linked_location_id, gal.linked_location_id)
      LEFT JOIN LATERAL (
        SELECT gsr.note
        FROM gear_service_repair_record gsr
        WHERE gsr.tenant_id = gal.tenant_id
          AND (
            (gal.asset_id IS NOT NULL AND gsr.asset_id = gal.asset_id)
            OR (gal.kit_id IS NOT NULL AND gsr.kit_id = gal.kit_id)
          )
        ORDER BY gsr.opened_at DESC
        LIMIT 1
      ) gsr ON true
      LEFT JOIN LATERAL (
        SELECT
          gse.scanned_at,
          scanner.full_name AS scanned_by_name
        FROM gear_scan_event gse
        LEFT JOIN app_user scanner
          ON scanner.id = gse.scanned_by_user_id
        WHERE gse.tenant_id = gal.tenant_id
          AND (
            (gal.asset_id IS NOT NULL AND gse.asset_id = gal.asset_id)
            OR (gal.kit_id IS NOT NULL AND gse.kit_id = gal.kit_id)
          )
        ORDER BY gse.scanned_at DESC
        LIMIT 1
      ) latest_scan ON true
      WHERE gal.tenant_id = $1
        AND gal.alert_type = $2
        AND gal.status = 'open'
        AND ($3::boolean = false OR gal.first_triggered_at <= now() - interval '30 days')
      ORDER BY gal.first_triggered_at DESC, label ASC
      LIMIT 40
    `,
    [tenantId, alertType, onlyMissingOver30Days]
  );

  return rows;
}

async function listUnresolvedRepairs(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ServiceRepairRow>(
    `
      SELECT
        gsr.id,
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
      LEFT JOIN shoot shoot
        ON shoot.id = gsr.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gsr.linked_location_id
      WHERE gsr.tenant_id = $1
        AND gsr.status IN ('open', 'under_review', 'in_service')
      ORDER BY gsr.opened_at DESC
      LIMIT 40
    `,
    [tenantId]
  );

  return rows;
}

async function listCurrentCustody(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<CustodyReportRow>(
    `
      SELECT
        CASE WHEN gcr.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        COALESCE(ga.status, gk.status) AS status,
        gcr.status AS checkout_status,
        checked_out_to.full_name AS current_custodian_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gcr.reserved_at,
        gcr.checked_out_at,
        gcr.expected_return_at,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        gcr.checkout_note AS note
      FROM gear_checkout_record gcr
      LEFT JOIN gear_asset ga
        ON ga.id = gcr.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gcr.kit_id
      LEFT JOIN app_user checked_out_to
        ON checked_out_to.id = gcr.checked_out_to_user_id
      LEFT JOIN shoot shoot
        ON shoot.id = gcr.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gcr.linked_location_id
      LEFT JOIN LATERAL (
        SELECT
          gse.scanned_at,
          scanner.full_name AS scanned_by_name
        FROM gear_scan_event gse
        LEFT JOIN app_user scanner
          ON scanner.id = gse.scanned_by_user_id
        WHERE gse.tenant_id = gcr.tenant_id
          AND (
            (gcr.asset_id IS NOT NULL AND gse.asset_id = gcr.asset_id)
            OR (gcr.kit_id IS NOT NULL AND gse.kit_id = gcr.kit_id)
          )
        ORDER BY gse.scanned_at DESC
        LIMIT 1
      ) latest_scan ON true
      WHERE gcr.tenant_id = $1
        AND gcr.status IN ('assigned', 'checked_out')
      ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
      LIMIT 50
    `,
    [tenantId]
  );

  return rows;
}

async function listRecentCustodyActivity(client: PoolClient, tenantId: string, periodStart: Date, periodEnd: Date) {
  const { rows } = await client.query<CustodyActivityRow>(
    `
      SELECT
        CASE WHEN gce.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        gce.event_type,
        gce.timestamp AS occurred_at,
        to_user.full_name AS to_user_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gce.note
      FROM gear_custody_event gce
      LEFT JOIN gear_asset ga
        ON ga.id = gce.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gce.kit_id
      LEFT JOIN app_user to_user
        ON to_user.id = gce.to_user_id
      LEFT JOIN shoot shoot
        ON shoot.id = gce.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gce.linked_location_id
      WHERE gce.tenant_id = $1
        AND gce.timestamp >= $2
        AND gce.timestamp < $3
        AND gce.event_type IN ('assigned', 'checked_out', 'returned', 'custody_transferred', 'temporary_substitution_started', 'temporary_substitution_ended')
      ORDER BY gce.timestamp DESC
      LIMIT 60
    `,
    [tenantId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  return rows;
}

async function listRecentScanActivity(client: PoolClient, tenantId: string, periodStart: Date, periodEnd: Date) {
  const { rows } = await client.query<ScanActivityRow>(
    `
      SELECT
        gse.id,
        CASE WHEN gse.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        gse.scan_action,
        gse.scanned_at,
        scanner.full_name AS scanned_by_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gse.mismatch_detected,
        gse.override_applied,
        gse.note
      FROM gear_scan_event gse
      LEFT JOIN gear_asset ga
        ON ga.id = gse.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gse.kit_id
      JOIN app_user scanner
        ON scanner.id = gse.scanned_by_user_id
      LEFT JOIN shoot shoot
        ON shoot.id = gse.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gse.linked_location_id
      WHERE gse.tenant_id = $1
        AND gse.scanned_at >= $2
        AND gse.scanned_at < $3
      ORDER BY gse.scanned_at DESC
      LIMIT 60
    `,
    [tenantId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  return rows;
}

async function listTileAttention(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueLikeRow>(
    `
      SELECT *
      FROM (
        SELECT
          'asset'::text AS target_type,
          ga.id AS target_id,
          ga.asset_name AS label,
          ga.status,
          NULL::uuid AS alert_id,
          NULL::gear_alert_type AS alert_type,
          current_custodian.full_name AS current_custodian_name,
          last_seen.full_name AS last_seen_with_name,
          NULL::text AS linked_shoot_title,
          NULL::text AS linked_location_name,
          NULL::timestamptz AS expected_return_at,
          NULL::timestamptz AS event_at,
          latest_scan.scanned_at AS last_scanned_at,
          latest_scan.scanned_by_name AS last_scanned_by_name,
          CASE
            WHEN ga.tile_tracker_id IS NULL THEN 'Tile tracker not assigned.'
            WHEN COALESCE(ga.tile_tracker_active, false) = false THEN 'Tile tracker inactive.'
            ELSE ga.notes
          END AS note
        FROM gear_asset ga
        LEFT JOIN app_user current_custodian
          ON current_custodian.id = ga.current_custodian_id
        LEFT JOIN app_user last_seen
          ON last_seen.id = ga.last_seen_with_user_id
        LEFT JOIN LATERAL (
          SELECT
            gse.scanned_at,
            scanner.full_name AS scanned_by_name
          FROM gear_scan_event gse
          LEFT JOIN app_user scanner
            ON scanner.id = gse.scanned_by_user_id
          WHERE gse.tenant_id = ga.tenant_id
            AND gse.asset_id = ga.id
          ORDER BY gse.scanned_at DESC
          LIMIT 1
        ) latest_scan ON true
        WHERE ga.tenant_id = $1
          AND ga.active_status = true
          AND (ga.tile_tracker_id IS NULL OR COALESCE(ga.tile_tracker_active, false) = false)

        UNION ALL

        SELECT
          'kit'::text AS target_type,
          gk.id AS target_id,
          gk.kit_name AS label,
          gk.status,
          NULL::uuid AS alert_id,
          NULL::gear_alert_type AS alert_type,
          current_custodian.full_name AS current_custodian_name,
          last_seen.full_name AS last_seen_with_name,
          NULL::text AS linked_shoot_title,
          NULL::text AS linked_location_name,
          NULL::timestamptz AS expected_return_at,
          NULL::timestamptz AS event_at,
          latest_scan.scanned_at AS last_scanned_at,
          latest_scan.scanned_by_name AS last_scanned_by_name,
          CASE
            WHEN gk.tile_tracker_id IS NULL THEN 'Tile tracker not assigned.'
            ELSE gk.notes
          END AS note
        FROM gear_kit gk
        LEFT JOIN app_user current_custodian
          ON current_custodian.id = gk.current_custodian_id
        LEFT JOIN app_user last_seen
          ON last_seen.id = gk.last_seen_with_user_id
        LEFT JOIN LATERAL (
          SELECT
            gse.scanned_at,
            scanner.full_name AS scanned_by_name
          FROM gear_scan_event gse
          LEFT JOIN app_user scanner
            ON scanner.id = gse.scanned_by_user_id
          WHERE gse.tenant_id = gk.tenant_id
            AND gse.kit_id = gk.id
          ORDER BY gse.scanned_at DESC
          LIMIT 1
        ) latest_scan ON true
        WHERE gk.tenant_id = $1
          AND gk.active_status = true
          AND gk.tile_tracker_id IS NULL
      ) tile_attention
      ORDER BY label ASC
      LIMIT 40
    `,
    [tenantId]
  );

  return rows;
}

function assertCanViewGearInventory(auth: AuthUser) {
  if (!canViewGearInventory(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}

function assertCanResolveGearAlerts(auth: AuthUser) {
  if (!canOverrideGearCustodyConflict(auth)) {
    throw new ApiError(403, "Only leadership can manually resolve gear alerts.");
  }
}

function normalizeMonthWindow(month: string | null) {
  const fallback = new Date();
  const fallbackMonth = `${fallback.getUTCFullYear()}-${String(fallback.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthKey = /^\d{4}-\d{2}$/.test(month ?? "") ? (month as string) : fallbackMonth;
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const periodStart = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { monthKey, periodStart, periodEnd };
}
