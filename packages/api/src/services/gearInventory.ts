import type { PoolClient } from "pg";
import { canViewGearInventory } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { GearStatus } from "../types/gear.js";
import type {
  GearAlertSummary,
  GearActiveCheckoutSummary,
  GearAssetDetailView,
  GearAssetListItem,
  GearAssetListResponse,
  GearCustodyHistoryEntry,
  GearDashboardView,
  GearInventoryListFilters,
  GearInventoryQueueItem,
  GearKitContentsItem,
  GearKitDetailView,
  GearKitListItem,
  GearKitListResponse,
  GearLatestVerificationSummary,
  GearServiceRepairSummary,
  GearTemporarySubstitutionSummary
} from "../types/gearInventory.js";

type AssetFilterInput = {
  search?: string | null;
  category?: string | null;
  status?: GearStatus | null;
  currentCustodianId?: string | null;
  homeLocationId?: string | null;
  kitId?: string | null;
};

type KitFilterInput = {
  search?: string | null;
  kitType?: string | null;
  assignedUserId?: string | null;
  status?: GearStatus | null;
};

type GearSummaryRow = {
  total_assets: number;
  total_kits: number;
  available: number;
  assigned: number;
  checked_out: number;
  in_office: number;
  in_transit: number;
  needs_repair: number;
  under_repair: number;
  missing: number;
  overdue_returns: number;
  recently_returned: number;
  tile_tracker_attention: number;
};

type AssetRow = GearAssetListItem;
type KitRow = GearKitListItem;
type QueueRow = GearInventoryQueueItem;
type ServiceRepairRow = GearServiceRepairSummary;
type TemporarySubstitutionRow = GearTemporarySubstitutionSummary;
type CustodyHistoryRow = GearCustodyHistoryEntry;
type ActiveCheckoutRow = GearActiveCheckoutSummary;
type KitContentsRow = GearKitContentsItem;
type VerificationRow = GearLatestVerificationSummary;
type AlertRow = GearAlertSummary;

export async function getGearDashboard(client: PoolClient, auth: AuthUser): Promise<GearDashboardView> {
  assertCanViewGearInventory(auth);

  const summaryResult = await client.query<GearSummaryRow>(
    `
      WITH combined_status_counts AS (
        SELECT status, count(*)::int AS count
        FROM gear_asset
        WHERE tenant_id = $1
          AND active_status = true
        GROUP BY status

        UNION ALL

        SELECT status, count(*)::int AS count
        FROM gear_kit
        WHERE tenant_id = $1
          AND active_status = true
        GROUP BY status
      )
      SELECT
        (SELECT count(*)::int FROM gear_asset WHERE tenant_id = $1 AND active_status = true) AS total_assets,
        (SELECT count(*)::int FROM gear_kit WHERE tenant_id = $1 AND active_status = true) AS total_kits,
        COALESCE(sum(count) FILTER (WHERE status = 'available'), 0)::int AS available,
        COALESCE(sum(count) FILTER (WHERE status = 'assigned'), 0)::int AS assigned,
        COALESCE(sum(count) FILTER (WHERE status = 'checked_out'), 0)::int AS checked_out,
        COALESCE(sum(count) FILTER (WHERE status = 'in_office'), 0)::int AS in_office,
        COALESCE(sum(count) FILTER (WHERE status = 'in_transit'), 0)::int AS in_transit,
        COALESCE(sum(count) FILTER (WHERE status = 'needs_repair'), 0)::int AS needs_repair,
        COALESCE(sum(count) FILTER (WHERE status = 'under_repair'), 0)::int AS under_repair,
        COALESCE(sum(count) FILTER (WHERE status = 'missing'), 0)::int AS missing,
        (
          SELECT count(*)::int
          FROM gear_alert
          WHERE tenant_id = $1
            AND alert_type = 'overdue_return'
            AND status = 'open'
        ) AS overdue_returns,
        (
          SELECT count(*)::int
          FROM gear_checkout_record
          WHERE tenant_id = $1
            AND returned_at >= now() - interval '7 days'
        ) AS recently_returned,
        (
          SELECT count(*)::int
          FROM (
            SELECT id
            FROM gear_asset
            WHERE tenant_id = $1
              AND active_status = true
              AND (tile_tracker_id IS NULL OR COALESCE(tile_tracker_active, false) = false)
            UNION ALL
            SELECT id
            FROM gear_kit
            WHERE tenant_id = $1
              AND active_status = true
              AND tile_tracker_id IS NULL
          ) tile_attention
        ) AS tile_tracker_attention
      FROM combined_status_counts
    `,
    [auth.tenantId]
  );

  return {
    summary: summaryResult.rows[0] ?? {
      total_assets: 0,
      total_kits: 0,
      available: 0,
      assigned: 0,
      checked_out: 0,
      in_office: 0,
      in_transit: 0,
      needs_repair: 0,
      under_repair: 0,
      missing: 0,
      overdue_returns: 0,
      recently_returned: 0,
      tile_tracker_attention: 0
    },
    checked_out_now: await listDashboardQueue(client, auth.tenantId, "checked_out_now"),
    repair_queue: await listDashboardQueue(client, auth.tenantId, "repair_queue"),
    missing_gear: await listDashboardQueue(client, auth.tenantId, "missing_gear"),
    overdue_returns: await listDashboardQueue(client, auth.tenantId, "overdue_returns"),
    recently_returned: await listDashboardQueue(client, auth.tenantId, "recently_returned"),
    tile_attention: await listDashboardQueue(client, auth.tenantId, "tile_attention")
  };
}

export async function listGearAssets(
  client: PoolClient,
  auth: AuthUser,
  filters: AssetFilterInput = {}
): Promise<GearAssetListResponse> {
  assertCanViewGearInventory(auth);

  const { text, values } = buildAssetListQuery(auth.tenantId, filters);
  const assetRows = await client.query<AssetRow>(text, values);

  return {
    assets: assetRows.rows,
    filters: await listAssetFilters(client, auth.tenantId)
  };
}

export async function getGearAssetDetail(
  client: PoolClient,
  auth: AuthUser,
  assetId: string
): Promise<GearAssetDetailView | null> {
  assertCanViewGearInventory(auth);

  const assetRows = await client.query<AssetRow>(
    `
      ${baseAssetSelect()}
      WHERE ga.tenant_id = $1
        AND ga.active_status = true
        AND ga.id = $2
      ORDER BY ga.asset_name ASC
    `,
    [auth.tenantId, assetId]
  );

  const asset = assetRows.rows[0] ?? null;
  if (!asset) {
    return null;
  }

  return {
    asset,
    active_checkout: await getActiveCheckoutSummary(client, auth.tenantId, "asset", assetId),
    open_alerts: await listOpenAlerts(client, auth.tenantId, "asset", assetId),
    service_records: await listServiceRepairRecords(client, auth.tenantId, "asset", assetId),
    temporary_substitutions: await listTemporarySubstitutionsForAsset(client, auth.tenantId, assetId),
    custody_history: await listCustodyHistory(client, auth.tenantId, "asset", assetId)
  };
}

export async function listGearKits(
  client: PoolClient,
  auth: AuthUser,
  filters: KitFilterInput = {}
): Promise<GearKitListResponse> {
  assertCanViewGearInventory(auth);

  const { text, values } = buildKitListQuery(auth.tenantId, filters);
  const kitRows = await client.query<KitRow>(text, values);

  return {
    kits: kitRows.rows,
    filters: await listKitFilters(client, auth.tenantId)
  };
}

export async function getGearKitDetail(
  client: PoolClient,
  auth: AuthUser,
  kitId: string
): Promise<GearKitDetailView | null> {
  assertCanViewGearInventory(auth);

  const kitRows = await client.query<KitRow>(
    `
      ${baseKitSelect()}
      WHERE gk.tenant_id = $1
        AND gk.active_status = true
        AND gk.id = $2
      ORDER BY gk.kit_name ASC
    `,
    [auth.tenantId, kitId]
  );

  const kit = kitRows.rows[0] ?? null;
  if (!kit) {
    return null;
  }

  return {
    kit,
    active_checkout: await getActiveCheckoutSummary(client, auth.tenantId, "kit", kitId),
    contents: await listKitContents(client, auth.tenantId, kitId),
    latest_pre_shoot_verification: await getLatestVerification(client, auth.tenantId, kitId),
    open_alerts: await listOpenAlerts(client, auth.tenantId, "kit", kitId),
    service_records: await listServiceRepairRecords(client, auth.tenantId, "kit", kitId),
    temporary_substitutions: await listTemporarySubstitutionsForKit(client, auth.tenantId, kitId),
    custody_history: await listCustodyHistory(client, auth.tenantId, "kit", kitId)
  };
}

function assertCanViewGearInventory(auth: AuthUser) {
  if (!canViewGearInventory(auth)) {
    throw new ApiError(403, "Forbidden");
  }
}

function baseAssetSelect() {
  return `
      SELECT
        ga.id,
        ga.internal_asset_id,
        ga.asset_name,
        ga.category,
        ga.manufacturer,
        ga.model,
        ga.serial_number,
        ga.qr_code_id,
        ga.tile_tracker_id,
        ga.tile_tracker_active,
        ga.status,
        ga.home_location_id,
        ghl.name AS home_location_name,
        ga.current_kit_id,
        gk.kit_name AS current_kit_name,
        ga.current_custodian_id,
        current_custodian.full_name AS current_custodian_name,
        ga.last_seen_with_user_id,
        last_seen.full_name AS last_seen_with_name,
        active_checkout.id AS active_checkout_id,
        active_checkout.status AS active_checkout_status,
        active_checkout.linked_shoot_id,
        active_checkout.expected_return_at,
        COALESCE(active_checkout.expected_return_at IS NOT NULL AND active_checkout.expected_return_at < now(), false) AS overdue_return,
        linked_shoot.title AS linked_shoot_title,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        COALESCE(open_repairs.open_service_count, 0)::int AS open_service_count,
        ga.notes,
        ga.active_status,
        ga.created_at,
        ga.updated_at
      FROM gear_asset ga
      LEFT JOIN gear_home_location ghl
        ON ghl.id = ga.home_location_id
      LEFT JOIN gear_kit gk
        ON gk.id = ga.current_kit_id
      LEFT JOIN app_user current_custodian
        ON current_custodian.id = ga.current_custodian_id
      LEFT JOIN app_user last_seen
        ON last_seen.id = ga.last_seen_with_user_id
      LEFT JOIN LATERAL (
        SELECT gcr.id, gcr.status, gcr.linked_shoot_id, gcr.expected_return_at
        FROM gear_checkout_record gcr
        WHERE gcr.tenant_id = ga.tenant_id
          AND gcr.asset_id = ga.id
          AND gcr.status IN ('assigned', 'checked_out')
        ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
        LIMIT 1
      ) active_checkout ON true
      LEFT JOIN shoot linked_shoot
        ON linked_shoot.id = active_checkout.linked_shoot_id
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
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_service_count
        FROM gear_service_repair_record gsr
        WHERE gsr.tenant_id = ga.tenant_id
          AND gsr.asset_id = ga.id
          AND gsr.status IN ('open', 'under_review', 'in_service')
      ) open_repairs ON true
  `;
}

function buildAssetListQuery(tenantId: string, filters: AssetFilterInput) {
  const conditions = ["ga.tenant_id = $1", "ga.active_status = true"];
  const values: unknown[] = [tenantId];

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    conditions.push(`
      (
        lower(ga.asset_name) LIKE $${index}
        OR lower(ga.internal_asset_id) LIKE $${index}
        OR lower(COALESCE(ga.serial_number, '')) LIKE $${index}
        OR lower(COALESCE(ga.manufacturer, '')) LIKE $${index}
        OR lower(COALESCE(ga.model, '')) LIKE $${index}
        OR lower(ga.category) LIKE $${index}
      )
    `);
  }

  if (filters.category) {
    values.push(filters.category);
    conditions.push(`ga.category = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`ga.status = $${values.length}`);
  }
  if (filters.currentCustodianId) {
    values.push(filters.currentCustodianId);
    conditions.push(`ga.current_custodian_id = $${values.length}`);
  }
  if (filters.homeLocationId) {
    values.push(filters.homeLocationId);
    conditions.push(`ga.home_location_id = $${values.length}`);
  }
  if (filters.kitId) {
    values.push(filters.kitId);
    conditions.push(`ga.current_kit_id = $${values.length}`);
  }

  return {
    text: `
      ${baseAssetSelect()}
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY ga.asset_name ASC, ga.internal_asset_id ASC
    `,
    values
  };
}

function baseKitSelect() {
  return `
      SELECT
        gk.id,
        gk.kit_name,
        gk.kit_type,
        gk.internal_kit_id,
        gk.qr_code_id,
        gk.tile_tracker_id,
        gk.status,
        gk.assigned_user_id,
        assigned_user.full_name AS assigned_user_name,
        gk.assignment_started_at,
        gk.assignment_note,
        gk.current_custodian_id,
        current_custodian.full_name AS current_custodian_name,
        gk.last_seen_with_user_id,
        last_seen.full_name AS last_seen_with_name,
        gk.home_location_id,
        ghl.name AS home_location_name,
        active_checkout.id AS active_checkout_id,
        active_checkout.status AS active_checkout_status,
        active_checkout.linked_shoot_id,
        linked_shoot.title AS linked_shoot_title,
        active_checkout.expected_return_at,
        COALESCE(active_checkout.expected_return_at IS NOT NULL AND active_checkout.expected_return_at < now(), false) AS overdue_return,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        COALESCE(open_repairs.open_service_count, 0)::int AS open_service_count,
        COALESCE(contents.asset_count, 0)::int AS asset_count,
        COALESCE(contents.required_asset_count, 0)::int AS required_asset_count,
        gk.notes,
        gk.active_status,
        gk.created_at,
        gk.updated_at
      FROM gear_kit gk
      LEFT JOIN app_user assigned_user
        ON assigned_user.id = gk.assigned_user_id
      LEFT JOIN app_user current_custodian
        ON current_custodian.id = gk.current_custodian_id
      LEFT JOIN app_user last_seen
        ON last_seen.id = gk.last_seen_with_user_id
      LEFT JOIN gear_home_location ghl
        ON ghl.id = gk.home_location_id
      LEFT JOIN LATERAL (
        SELECT gcr.id, gcr.status, gcr.linked_shoot_id, gcr.expected_return_at
        FROM gear_checkout_record gcr
        WHERE gcr.tenant_id = gk.tenant_id
          AND gcr.kit_id = gk.id
          AND gcr.status IN ('assigned', 'checked_out')
        ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
        LIMIT 1
      ) active_checkout ON true
      LEFT JOIN shoot linked_shoot
        ON linked_shoot.id = active_checkout.linked_shoot_id
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
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_service_count
        FROM gear_service_repair_record gsr
        WHERE gsr.tenant_id = gk.tenant_id
          AND gsr.kit_id = gk.id
          AND gsr.status IN ('open', 'under_review', 'in_service')
      ) open_repairs ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS asset_count,
          count(*) FILTER (WHERE gkam.required_in_kit)::int AS required_asset_count
        FROM gear_kit_asset_membership gkam
        WHERE gkam.tenant_id = gk.tenant_id
          AND gkam.kit_id = gk.id
      ) contents ON true
  `;
}

function buildKitListQuery(tenantId: string, filters: KitFilterInput) {
  const conditions = ["gk.tenant_id = $1", "gk.active_status = true"];
  const values: unknown[] = [tenantId];

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    conditions.push(`
      (
        lower(gk.kit_name) LIKE $${index}
        OR lower(gk.internal_kit_id) LIKE $${index}
        OR lower(gk.kit_type) LIKE $${index}
        OR lower(COALESCE(gk.qr_code_id, '')) LIKE $${index}
        OR lower(COALESCE(gk.tile_tracker_id, '')) LIKE $${index}
      )
    `);
  }

  if (filters.kitType) {
    values.push(filters.kitType);
    conditions.push(`gk.kit_type = $${values.length}`);
  }
  if (filters.assignedUserId) {
    values.push(filters.assignedUserId);
    conditions.push(`gk.assigned_user_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`gk.status = $${values.length}`);
  }

  return {
    text: `
      ${baseKitSelect()}
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY gk.kit_name ASC, gk.internal_kit_id ASC
    `,
    values
  };
}

async function listDashboardQueue(
  client: PoolClient,
  tenantId: string,
  queueName: "checked_out_now" | "repair_queue" | "missing_gear" | "overdue_returns" | "recently_returned" | "tile_attention"
) {
  switch (queueName) {
    case "checked_out_now":
      return listCheckedOutQueue(client, tenantId);
    case "repair_queue":
      return listRepairQueue(client, tenantId);
    case "missing_gear":
      return listMissingQueue(client, tenantId);
    case "overdue_returns":
      return listOverdueReturnsQueue(client, tenantId);
    case "recently_returned":
      return listRecentlyReturnedQueue(client, tenantId);
    case "tile_attention":
      return listTileAttentionQueue(client, tenantId);
    default:
      return [];
  }
}

async function listCheckedOutQueue(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueRow>(
    `
      SELECT
        CASE WHEN gcr.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        COALESCE(ga.status, gk.status) AS status,
        NULL::uuid AS alert_id,
        NULL::gear_alert_type AS alert_type,
        checked_out_to.full_name AS current_custodian_name,
        last_seen.full_name AS last_seen_with_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gcr.expected_return_at,
        COALESCE(gcr.checked_out_at, gcr.reserved_at) AS event_at,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        gcr.checkout_note AS note
      FROM gear_checkout_record gcr
      LEFT JOIN gear_asset ga
        ON ga.id = gcr.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gcr.kit_id
      JOIN app_user checked_out_to
        ON checked_out_to.id = gcr.checked_out_to_user_id
      LEFT JOIN app_user last_seen
        ON last_seen.id = COALESCE(ga.last_seen_with_user_id, gk.last_seen_with_user_id)
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
        AND gcr.status = 'checked_out'
      ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
      LIMIT 8
    `,
    [tenantId]
  );
  return rows;
}

async function listRepairQueue(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueRow>(
    `
      WITH ranked_repairs AS (
        SELECT
          'asset'::text AS target_type,
          ga.id AS target_id,
          ga.asset_name AS label,
          ga.status,
          ga.current_custodian_id,
          ga.last_seen_with_user_id,
          gsr.note,
          row_number() OVER (PARTITION BY ga.id ORDER BY gsr.opened_at DESC) AS repair_rank
        FROM gear_asset ga
        JOIN gear_service_repair_record gsr
          ON gsr.tenant_id = ga.tenant_id
         AND gsr.asset_id = ga.id
         AND gsr.status IN ('open', 'under_review', 'in_service')
        WHERE ga.tenant_id = $1
          AND ga.active_status = true

        UNION ALL

        SELECT
          'kit'::text AS target_type,
          gk.id AS target_id,
          gk.kit_name AS label,
          gk.status,
          gk.current_custodian_id,
          gk.last_seen_with_user_id,
          gsr.note,
          row_number() OVER (PARTITION BY gk.id ORDER BY gsr.opened_at DESC) AS repair_rank
        FROM gear_kit gk
        JOIN gear_service_repair_record gsr
          ON gsr.tenant_id = gk.tenant_id
         AND gsr.kit_id = gk.id
         AND gsr.status IN ('open', 'under_review', 'in_service')
        WHERE gk.tenant_id = $1
          AND gk.active_status = true
      )
      SELECT
        rr.target_type::text,
        rr.target_id,
        rr.label,
        rr.status,
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
        rr.note
      FROM ranked_repairs rr
      LEFT JOIN app_user current_custodian
        ON current_custodian.id = rr.current_custodian_id
      LEFT JOIN app_user last_seen
        ON last_seen.id = rr.last_seen_with_user_id
      LEFT JOIN LATERAL (
        SELECT
          gse.scanned_at,
          scanner.full_name AS scanned_by_name
        FROM gear_scan_event gse
        LEFT JOIN app_user scanner
          ON scanner.id = gse.scanned_by_user_id
        WHERE gse.tenant_id = $1
          AND (
            (rr.target_type = 'asset' AND gse.asset_id = rr.target_id)
            OR (rr.target_type = 'kit' AND gse.kit_id = rr.target_id)
          )
        ORDER BY gse.scanned_at DESC
        LIMIT 1
      ) latest_scan ON true
      WHERE rr.repair_rank = 1
      ORDER BY rr.status ASC, rr.label ASC
      LIMIT 8
    `,
    [tenantId]
  );
  return rows;
}

async function listMissingQueue(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueRow>(
    `
      SELECT
        CASE WHEN gal.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        COALESCE(ga.status, gk.status) AS status,
        gal.id AS alert_id,
        gal.alert_type,
        current_custodian.full_name AS current_custodian_name,
        last_seen.full_name AS last_seen_with_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        NULL::timestamptz AS expected_return_at,
        gal.first_triggered_at AS event_at,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        COALESCE(gsr.note, ga.notes, gk.notes, 'Marked missing and waiting for follow-through.') AS note
      FROM gear_alert gal
      LEFT JOIN gear_asset ga
        ON ga.id = gal.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gal.kit_id
      LEFT JOIN app_user current_custodian
        ON current_custodian.id = COALESCE(ga.current_custodian_id, gk.current_custodian_id)
      LEFT JOIN app_user last_seen
        ON last_seen.id = COALESCE(ga.last_seen_with_user_id, gk.last_seen_with_user_id)
      LEFT JOIN shoot shoot
        ON shoot.id = gal.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gal.linked_location_id
      LEFT JOIN LATERAL (
        SELECT gsr.note
        FROM gear_service_repair_record gsr
        WHERE gsr.tenant_id = gal.tenant_id
          AND (
            (gal.asset_id IS NOT NULL AND gsr.asset_id = gal.asset_id)
            OR (gal.kit_id IS NOT NULL AND gsr.kit_id = gal.kit_id)
          )
          AND gsr.issue_type = 'missing'
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
        AND gal.alert_type = 'missing_gear'
        AND gal.status = 'open'
      ORDER BY gal.first_triggered_at DESC, label ASC
      LIMIT 8
    `,
    [tenantId]
  );
  return rows;
}

async function listOverdueReturnsQueue(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueRow>(
    `
      SELECT
        CASE WHEN gal.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        COALESCE(ga.status, gk.status) AS status,
        gal.id AS alert_id,
        gal.alert_type,
        checked_out_to.full_name AS current_custodian_name,
        last_seen.full_name AS last_seen_with_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        COALESCE(gcr.expected_return_at, gal.due_at) AS expected_return_at,
        gal.first_triggered_at AS event_at,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        COALESCE(gcr.checkout_note, 'Still checked out past the allowed post-shoot window.') AS note
      FROM gear_alert gal
      LEFT JOIN gear_checkout_record gcr
        ON gcr.id = gal.checkout_id
      LEFT JOIN gear_asset ga
        ON ga.id = gal.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gal.kit_id
      LEFT JOIN app_user checked_out_to
        ON checked_out_to.id = COALESCE(gcr.checked_out_to_user_id, ga.current_custodian_id, gk.current_custodian_id)
      LEFT JOIN app_user last_seen
        ON last_seen.id = COALESCE(ga.last_seen_with_user_id, gk.last_seen_with_user_id)
      LEFT JOIN shoot shoot
        ON shoot.id = COALESCE(gcr.linked_shoot_id, gal.linked_shoot_id)
      LEFT JOIN shoot_location location
        ON location.id = COALESCE(gcr.linked_location_id, gal.linked_location_id)
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
        AND gal.alert_type = 'overdue_return'
        AND gal.status = 'open'
      ORDER BY COALESCE(gal.due_at, gcr.expected_return_at, gal.first_triggered_at) ASC
      LIMIT 8
    `,
    [tenantId]
  );
  return rows;
}

async function listTileAttentionQueue(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueRow>(
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
      ) tile_rows
      ORDER BY label ASC
      LIMIT 8
    `,
    [tenantId]
  );
  return rows;
}

async function listRecentlyReturnedQueue(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<QueueRow>(
    `
      SELECT
        CASE WHEN gcr.asset_id IS NOT NULL THEN 'asset' ELSE 'kit' END AS target_type,
        COALESCE(ga.id, gk.id) AS target_id,
        COALESCE(ga.asset_name, gk.kit_name) AS label,
        COALESCE(ga.status, gk.status) AS status,
        NULL::uuid AS alert_id,
        NULL::gear_alert_type AS alert_type,
        checked_out_to.full_name AS current_custodian_name,
        last_seen.full_name AS last_seen_with_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        NULL::timestamptz AS expected_return_at,
        gcr.returned_at AS event_at,
        latest_scan.scanned_at AS last_scanned_at,
        latest_scan.scanned_by_name AS last_scanned_by_name,
        COALESCE(gcr.return_note, 'Returned and logged back into inventory.') AS note
      FROM gear_checkout_record gcr
      LEFT JOIN gear_asset ga
        ON ga.id = gcr.asset_id
      LEFT JOIN gear_kit gk
        ON gk.id = gcr.kit_id
      LEFT JOIN app_user checked_out_to
        ON checked_out_to.id = gcr.checked_out_to_user_id
      LEFT JOIN app_user last_seen
        ON last_seen.id = COALESCE(ga.last_seen_with_user_id, gk.last_seen_with_user_id)
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
        AND gcr.status = 'returned'
        AND gcr.returned_at >= now() - interval '7 days'
      ORDER BY gcr.returned_at DESC
      LIMIT 8
    `,
    [tenantId]
  );
  return rows;
}

async function listAssetFilters(
  client: PoolClient,
  tenantId: string
): Promise<Pick<GearInventoryListFilters, "categories" | "custodians" | "home_locations" | "kits">> {
  const categoriesResult = await client.query<{ category: string }>(
    `
      SELECT DISTINCT category
      FROM gear_asset
      WHERE tenant_id = $1
        AND active_status = true
      ORDER BY category ASC
    `,
    [tenantId]
  );

  const custodiansResult = await client.query<{ id: string; full_name: string }>(
    `
      SELECT DISTINCT au.id, au.full_name
      FROM gear_asset ga
      JOIN app_user au
        ON au.id = ga.current_custodian_id
      WHERE ga.tenant_id = $1
        AND ga.active_status = true
      ORDER BY au.full_name ASC
    `,
    [tenantId]
  );

  const homeLocationsResult = await client.query<{ id: string; name: string }>(
    `
      SELECT DISTINCT ghl.id, ghl.name
      FROM gear_asset ga
      JOIN gear_home_location ghl
        ON ghl.id = ga.home_location_id
      WHERE ga.tenant_id = $1
        AND ga.active_status = true
      ORDER BY ghl.name ASC
    `,
    [tenantId]
  );

  const kitsResult = await client.query<{ id: string; kit_name: string; internal_kit_id: string }>(
    `
      SELECT DISTINCT gk.id, gk.kit_name, gk.internal_kit_id
      FROM gear_asset ga
      JOIN gear_kit gk
        ON gk.id = ga.current_kit_id
      WHERE ga.tenant_id = $1
        AND ga.active_status = true
      ORDER BY gk.kit_name ASC
    `,
    [tenantId]
  );

  return {
    categories: categoriesResult.rows.map((row) => row.category),
    custodians: custodiansResult.rows,
    home_locations: homeLocationsResult.rows,
    kits: kitsResult.rows.map((row) => ({
      id: row.id,
      label: `${row.kit_name} (${row.internal_kit_id})`
    }))
  };
}

async function listKitFilters(
  client: PoolClient,
  tenantId: string
): Promise<Pick<GearInventoryListFilters, "kit_types" | "assigned_users">> {
  const kitTypesResult = await client.query<{ kit_type: string }>(
    `
      SELECT DISTINCT kit_type
      FROM gear_kit
      WHERE tenant_id = $1
        AND active_status = true
      ORDER BY kit_type ASC
    `,
    [tenantId]
  );

  const assignedUsersResult = await client.query<{ id: string; full_name: string }>(
    `
      SELECT DISTINCT au.id, au.full_name
      FROM gear_kit gk
      JOIN app_user au
        ON au.id = gk.assigned_user_id
      WHERE gk.tenant_id = $1
        AND gk.active_status = true
      ORDER BY au.full_name ASC
    `,
    [tenantId]
  );

  return {
    kit_types: kitTypesResult.rows.map((row) => row.kit_type),
    assigned_users: assignedUsersResult.rows
  };
}

async function getActiveCheckoutSummary(
  client: PoolClient,
  tenantId: string,
  targetType: "asset" | "kit",
  targetId: string
) {
  const targetColumn = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<ActiveCheckoutRow>(
    `
      SELECT
        gcr.id,
        gcr.status,
        gcr.checked_out_to_user_id,
        checked_out_to.full_name AS checked_out_to_user_name,
        gcr.linked_shoot_id,
        shoot.title AS linked_shoot_title,
        gcr.linked_location_id,
        location.name AS linked_location_name,
        gcr.reserved_at,
        gcr.checked_out_at,
        gcr.expected_return_at,
        gcr.checkout_note
      FROM gear_checkout_record gcr
      LEFT JOIN app_user checked_out_to
        ON checked_out_to.id = gcr.checked_out_to_user_id
      LEFT JOIN shoot shoot
        ON shoot.id = gcr.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gcr.linked_location_id
      WHERE gcr.tenant_id = $1
        AND gcr.${targetColumn} = $2
        AND gcr.status IN ('assigned', 'checked_out')
      ORDER BY COALESCE(gcr.checked_out_at, gcr.reserved_at) DESC
      LIMIT 1
    `,
    [tenantId, targetId]
  );
  return rows[0] ?? null;
}

async function listOpenAlerts(
  client: PoolClient,
  tenantId: string,
  targetType: "asset" | "kit",
  targetId: string
) {
  const targetColumn = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<AlertRow>(
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
        AND gal.${targetColumn} = $2
        AND gal.status = 'open'
      ORDER BY gal.first_triggered_at DESC
      LIMIT 12
    `,
    [tenantId, targetId]
  );
  return rows;
}

async function listServiceRepairRecords(
  client: PoolClient,
  tenantId: string,
  targetType: "asset" | "kit",
  targetId: string
) {
  const targetColumn = targetType === "asset" ? "asset_id" : "kit_id";
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
        AND gsr.${targetColumn} = $2
      ORDER BY gsr.opened_at DESC
      LIMIT 25
    `,
    [tenantId, targetId]
  );
  return rows;
}

async function listTemporarySubstitutionsForAsset(client: PoolClient, tenantId: string, assetId: string) {
  const { rows } = await client.query<TemporarySubstitutionRow>(
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
      LEFT JOIN shoot shoot
        ON shoot.id = gts.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gts.linked_location_id
      WHERE gts.tenant_id = $1
        AND (gts.original_asset_id = $2 OR gts.substitute_asset_id = $2)
      ORDER BY gts.starts_at DESC
      LIMIT 20
    `,
    [tenantId, assetId]
  );
  return rows;
}

async function listTemporarySubstitutionsForKit(client: PoolClient, tenantId: string, kitId: string) {
  const { rows } = await client.query<TemporarySubstitutionRow>(
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
      LEFT JOIN shoot shoot
        ON shoot.id = gts.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gts.linked_location_id
      WHERE gts.tenant_id = $1
        AND (
          gts.original_asset_id IN (
            SELECT asset_id
            FROM gear_kit_asset_membership
            WHERE tenant_id = $1
              AND kit_id = $2
          )
          OR gts.substitute_asset_id IN (
            SELECT asset_id
            FROM gear_kit_asset_membership
            WHERE tenant_id = $1
              AND kit_id = $2
          )
        )
      ORDER BY gts.starts_at DESC
      LIMIT 20
    `,
    [tenantId, kitId]
  );
  return rows;
}

async function listCustodyHistory(
  client: PoolClient,
  tenantId: string,
  targetType: "asset" | "kit",
  targetId: string
) {
  const targetColumn = targetType === "asset" ? "asset_id" : "kit_id";
  const { rows } = await client.query<CustodyHistoryRow>(
    `
      SELECT
        gce.id,
        gce.event_type,
        gce.timestamp,
        from_user.full_name AS from_user_name,
        to_user.full_name AS to_user_name,
        shoot.title AS linked_shoot_title,
        location.name AS linked_location_name,
        gce.note,
        created_by.full_name AS created_by_name
      FROM gear_custody_event gce
      LEFT JOIN app_user from_user
        ON from_user.id = gce.from_user_id
      LEFT JOIN app_user to_user
        ON to_user.id = gce.to_user_id
      LEFT JOIN shoot shoot
        ON shoot.id = gce.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.id = gce.linked_location_id
      JOIN app_user created_by
        ON created_by.id = gce.created_by
      WHERE gce.tenant_id = $1
        AND gce.${targetColumn} = $2
      ORDER BY gce.timestamp DESC, gce.created_at DESC
      LIMIT 30
    `,
    [tenantId, targetId]
  );
  return rows;
}

async function listKitContents(client: PoolClient, tenantId: string, kitId: string) {
  const { rows } = await client.query<KitContentsRow>(
    `
      SELECT
        gkam.id AS membership_id,
        ga.id AS asset_id,
        ga.internal_asset_id,
        ga.asset_name,
        ga.category,
        ga.serial_number,
        ga.qr_code_id,
        ga.tile_tracker_id,
        ga.tile_tracker_active,
        ga.status,
        gkam.required_in_kit,
        gkam.display_order,
        current_custodian.full_name AS current_custodian_name,
        last_seen.full_name AS last_seen_with_name,
        COALESCE(open_repairs.open_service_count, 0)::int AS open_service_count
      FROM gear_kit_asset_membership gkam
      JOIN gear_asset ga
        ON ga.id = gkam.asset_id
      LEFT JOIN app_user current_custodian
        ON current_custodian.id = ga.current_custodian_id
      LEFT JOIN app_user last_seen
        ON last_seen.id = ga.last_seen_with_user_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS open_service_count
        FROM gear_service_repair_record gsr
        WHERE gsr.tenant_id = ga.tenant_id
          AND gsr.asset_id = ga.id
          AND gsr.status IN ('open', 'under_review', 'in_service')
      ) open_repairs ON true
      WHERE gkam.tenant_id = $1
        AND gkam.kit_id = $2
      ORDER BY COALESCE(gkam.display_order, 9999), ga.asset_name ASC
    `,
    [tenantId, kitId]
  );
  return rows;
}

async function getLatestVerification(client: PoolClient, tenantId: string, kitId: string) {
  const { rows } = await client.query<VerificationRow>(
    `
      SELECT
        gpv.id,
        gpv.status,
        verifier.full_name AS verified_by_name,
        shoot.title AS linked_shoot_title,
        gpv.verified_ready_at,
        gpv.created_at
      FROM gear_pre_shoot_verification gpv
      JOIN app_user verifier
        ON verifier.id = gpv.verified_by_user_id
      LEFT JOIN shoot shoot
        ON shoot.id = gpv.linked_shoot_id
      WHERE gpv.tenant_id = $1
        AND gpv.kit_id = $2
      ORDER BY COALESCE(gpv.verified_ready_at, gpv.created_at) DESC
      LIMIT 1
    `,
    [tenantId, kitId]
  );
  return rows[0] ?? null;
}
