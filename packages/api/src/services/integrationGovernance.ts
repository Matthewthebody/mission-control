import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { OutlookAccount } from "../types/outlook.js";
import { loadOutlookTenantState, resolveOutlookAccount } from "./outlookStore.js";
import { buildDefaultZendeskConnection, loadZendeskConnection, mapConnectionToZendeskConnection } from "./zendeskStore.js";

type IntegrationProviderKey = "outlook" | "zendesk" | "monday";
type IntegrationHealthState = "healthy" | "warning" | "degraded" | "failing" | "disabled";
type IntegrationSyncMode =
  | "read_only_import"
  | "controlled_one_way_writeback"
  | "controlled_two_way_sync"
  | "manual_reconciliation";
type IntegrationLinkedRecordSyncState =
  | "never_synced"
  | "sync_pending"
  | "synced"
  | "partially_synced"
  | "conflict_detected"
  | "sync_failed"
  | "disabled"
  | "archived_link";

type IntegrationOperationRow = {
  id: string;
  provider: string;
  direction: string;
  entity_type: string;
  entity_id: string | null;
  external_object_type: string;
  external_id: string | null;
  operation_type: string;
  source_system: string;
  status: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  conflict_summary: string | null;
  payload: Record<string, unknown> | null;
  result_payload: Record<string, unknown> | null;
  conflict_payload: Record<string, unknown> | null;
};

type OutlookLinkedRow = {
  record_type: "shoot" | "schedule_event";
  local_record_id: string;
  local_label: string | null;
  external_record_id: string | null;
  external_calendar_id: string | null;
  last_sync_at: string | null;
  raw_sync_state: string;
  last_sync_error: string | null;
  review_reason: string | null;
};

type MondayLinkedRow = {
  local_record_id: string;
  local_label: string;
  external_record_id: string | null;
  last_sync_at: string | null;
};

type MondayAggregateRow = {
  linked_location_count: string | number;
  linked_eval_count: string | number;
  linked_photo_count: string | number;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  failure_count: string | number;
  unresolved_conflict_count: string | number;
  replayable_operation_id: string | null;
};

type OutlookAggregateRow = {
  linked_record_count: string | number;
  pending_sync_count: string | number;
  failure_count: string | number;
  unresolved_conflict_count: string | number;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  replayable_operation_id: string | null;
};

type ZendeskAggregateRow = {
  failure_count: string | number;
  unresolved_conflict_count: string | number;
  replayable_operation_id: string | null;
};

export type IntegrationGovernanceSummary = {
  provider_count: number;
  connected_count: number;
  warning_count: number;
  failing_count: number;
  unresolved_conflict_count: number;
  pending_sync_count: number;
  linked_record_count: number;
  last_updated_at: string;
  freshness: {
    state: "live" | "recently_updated" | "daily_computed";
    label: string;
  };
};

export type IntegrationGovernanceProviderSummary = {
  provider: IntegrationProviderKey;
  display_name: string;
  enabled: boolean;
  connection_status: "connected" | "disconnected" | "attention";
  health_state: IntegrationHealthState;
  health_label: string;
  sync_mode: IntegrationSyncMode;
  sync_mode_label: string;
  source_of_truth_summary: string;
  owner_contact: string;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  next_scheduled_sync_at: string | null;
  failure_count: number;
  unresolved_conflict_count: number;
  pending_sync_count: number;
  linked_record_count: number;
  mapping_status: string;
  external_label: string;
  owned_domains: string[];
  mirrored_domains: string[];
  overlay_domains: string[];
  writeback_domains: string[];
  replayable_operation_id: string | null;
};

export type IntegrationSourceOfTruthRule = {
  id: string;
  field_group: string;
  owner: string;
  ownership_type: "source_of_truth" | "mirror" | "derived" | "overlay" | "transitional";
  sync_direction: string;
  edit_policy: string;
  summary: string;
};

export type IntegrationConflictReview = {
  operation_id: string;
  provider: IntegrationProviderKey;
  title: string;
  summary: string;
  entity_type: string;
  entity_id: string | null;
  status: "failed" | "conflict";
  occurred_at: string;
  source_system: string;
  local_value: string | null;
  external_value: string | null;
  source_policy: string;
  recommended_action: string;
  resolution_paths: string[];
  can_replay: boolean;
};

export type IntegrationLinkedRecordSummary = {
  provider: IntegrationProviderKey;
  record_type: string;
  local_record_id: string;
  local_label: string;
  external_record_id: string | null;
  external_url: string | null;
  sync_state: IntegrationLinkedRecordSyncState;
  sync_state_label: string;
  last_sync_at: string | null;
  source_ownership_summary: string;
  conflict_banner: string | null;
  recommended_action: string | null;
};

export type IntegrationGovernanceOperation = {
  id: string;
  provider: IntegrationProviderKey;
  direction: "inbound" | "outbound";
  entity_type: string;
  entity_id: string | null;
  operation_type: string;
  external_object_type: string;
  external_id: string | null;
  source_system: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "conflict";
  attempt_count: number;
  created_at: string;
  updated_at: string;
  message: string | null;
};

export type IntegrationGovernancePayload = {
  summary: IntegrationGovernanceSummary;
  providers: IntegrationGovernanceProviderSummary[];
  source_of_truth_rules: IntegrationSourceOfTruthRule[];
  recent_conflicts: IntegrationConflictReview[];
  linked_records: IntegrationLinkedRecordSummary[];
  recent_operations: IntegrationGovernanceOperation[];
};

export async function getIntegrationGovernance(client: PoolClient, auth: AuthUser): Promise<IntegrationGovernancePayload> {
  assertIntegrationGovernanceAccess(auth);
  const includeOutlookOperationalSurface = false;

  const outlookTenantState = await loadOutlookTenantState(client, auth.tenantId);
  const zendeskConnectionRow = await loadZendeskConnection(client, auth.tenantId);
  const outlookAggregate = await loadOutlookAggregate(client, auth.tenantId);
  const mondayAggregate = await loadMondayAggregate(client, auth.tenantId);
  const zendeskAggregate = await loadZendeskAggregate(client, auth.tenantId);
  const recentOps = await loadRecentIntegrationOperations(client, auth.tenantId);
  const recentConflictRows = await loadRecentConflictRows(client, auth.tenantId);
  const outlookLinkedRows = await loadOutlookLinkedRecords(client, auth.tenantId);
  const mondayLinkedRows = await loadMondayLinkedRecords(client, auth.tenantId);

  const outlookAccount = resolveOutlookAccount(auth.tenantId, outlookTenantState);
  const zendeskConnection = zendeskConnectionRow
    ? mapConnectionToZendeskConnection(zendeskConnectionRow, auth.tenantId)
    : buildDefaultZendeskConnection(auth.tenantId);

  const providers: IntegrationGovernanceProviderSummary[] = [
    buildOutlookProviderSummary(outlookAccount, outlookAggregate),
    buildZendeskProviderSummary(zendeskConnection, zendeskAggregate),
    buildMondayProviderSummary(mondayAggregate)
  ];

  const linkedRecords = [
    ...(includeOutlookOperationalSurface ? outlookLinkedRows.map(mapOutlookLinkedRecord) : []),
    ...mondayLinkedRows.map(mapMondayLinkedRecord)
  ].slice(0, 10);

  const recentConflicts = recentConflictRows
    .filter((row) => includeOutlookOperationalSurface || normalizeProvider(row.provider) !== "outlook")
    .map(mapConflictRow);
  const recentOperations = recentOps
    .map(mapRecentOperationRow)
    .filter((operation) => includeOutlookOperationalSurface || operation.provider !== "outlook");

  return {
    summary: buildSummary(providers, linkedRecords),
    providers,
    source_of_truth_rules: buildSourceOfTruthRules(),
    recent_conflicts: recentConflicts,
    linked_records: linkedRecords,
    recent_operations: recentOperations
  };
}

function assertIntegrationGovernanceAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Only leadership or audit admins can review integration governance");
  }
}

async function loadOutlookAggregate(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<OutlookAggregateRow>(
    `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM schedule_event
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND (outlook_event_id IS NOT NULL OR sync_state <> 'not_linked')
        ) AS linked_record_count,
        (
          SELECT
            (
              SELECT COUNT(*)
              FROM shoot
              WHERE tenant_id = $1
                AND deleted_at IS NULL
                AND schedule_sync_required = true
            ) +
            (
              SELECT COUNT(*)
              FROM schedule_event
              WHERE tenant_id = $1
                AND deleted_at IS NULL
                AND sync_required = true
            )
        ) AS pending_sync_count,
        (
          SELECT COUNT(*)::int
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'outlook'
            AND status IN ('failed', 'conflict')
            AND created_at >= now() - interval '14 days'
        ) AS failure_count,
        (
          SELECT COUNT(*)::int
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'outlook'
            AND status = 'conflict'
        ) AS unresolved_conflict_count,
        (
          SELECT max(updated_at)::text
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'outlook'
            AND status = 'succeeded'
        ) AS last_successful_sync_at,
        (
          SELECT max(updated_at)::text
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'outlook'
            AND status IN ('failed', 'conflict')
        ) AS last_failed_sync_at,
        (
          SELECT id::text
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'outlook'
            AND status IN ('failed', 'conflict')
          ORDER BY updated_at DESC
          LIMIT 1
        ) AS replayable_operation_id
    `,
    [tenantId]
  );
  return rows[0];
}

async function loadMondayAggregate(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<MondayAggregateRow>(
    `
      WITH linked_locations AS (
        SELECT location_id
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND monday_item_id IS NOT NULL
        UNION
        SELECT location_id
        FROM setup_photo_upload
        WHERE tenant_id = $1
          AND (monday_item_id IS NOT NULL OR monday_asset_id IS NOT NULL)
      )
      SELECT
        (SELECT COUNT(*)::int FROM linked_locations) AS linked_location_count,
        (
          SELECT COUNT(*)::int
          FROM post_shoot_evaluation
          WHERE tenant_id = $1
            AND monday_item_id IS NOT NULL
        ) AS linked_eval_count,
        (
          SELECT COUNT(*)::int
          FROM setup_photo_upload
          WHERE tenant_id = $1
            AND (monday_item_id IS NOT NULL OR monday_asset_id IS NOT NULL)
        ) AS linked_photo_count,
        (
          SELECT max(updated_at)::text
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'monday'
            AND status = 'succeeded'
        ) AS last_successful_sync_at,
        (
          SELECT max(updated_at)::text
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'monday'
            AND status IN ('failed', 'conflict')
        ) AS last_failed_sync_at,
        (
          SELECT COUNT(*)::int
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'monday'
            AND status IN ('failed', 'conflict')
            AND created_at >= now() - interval '14 days'
        ) AS failure_count,
        (
          SELECT COUNT(*)::int
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'monday'
            AND status = 'conflict'
        ) AS unresolved_conflict_count,
        (
          SELECT id::text
          FROM integration_sync_operation
          WHERE tenant_id = $1
            AND provider = 'monday'
            AND status IN ('failed', 'conflict')
          ORDER BY updated_at DESC
          LIMIT 1
        ) AS replayable_operation_id
    `,
    [tenantId]
  );
  return rows[0];
}

async function loadZendeskAggregate(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ZendeskAggregateRow>(
    `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM zendesk_sync_run
          WHERE tenant_id = $1
            AND status = 'error'
            AND started_at >= now() - interval '14 days'
        ) AS failure_count,
        0::int AS unresolved_conflict_count,
        NULL::text AS replayable_operation_id
    `,
    [tenantId]
  );
  return rows[0];
}

async function loadRecentIntegrationOperations(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<IntegrationOperationRow>(
    `
      SELECT
        id::text,
        provider,
        direction,
        entity_type,
        entity_id::text,
        external_object_type,
        external_id,
        operation_type,
        source_system,
        status,
        attempt_count,
        created_at::text,
        updated_at::text,
        last_error,
        conflict_summary,
        payload,
        result_payload,
        conflict_payload
      FROM integration_sync_operation
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 16
    `,
    [tenantId]
  );
  return rows;
}

async function loadRecentConflictRows(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<IntegrationOperationRow>(
    `
      SELECT
        id::text,
        provider,
        direction,
        entity_type,
        entity_id::text,
        external_object_type,
        external_id,
        operation_type,
        source_system,
        status,
        attempt_count,
        created_at::text,
        updated_at::text,
        last_error,
        conflict_summary,
        payload,
        result_payload,
        conflict_payload
      FROM integration_sync_operation
      WHERE tenant_id = $1
        AND status IN ('failed', 'conflict')
      ORDER BY updated_at DESC
      LIMIT 10
    `,
    [tenantId]
  );
  return rows;
}

async function loadOutlookLinkedRecords(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<OutlookLinkedRow>(
    `
      SELECT
        CASE WHEN se.linked_shoot_id IS NOT NULL THEN 'shoot'::text ELSE 'schedule_event'::text END AS record_type,
        COALESCE(se.linked_shoot_id::text, se.id::text) AS local_record_id,
        COALESCE(s.title, s.shoot_code, se.title) AS local_label,
        se.outlook_event_id AS external_record_id,
        se.outlook_calendar_id AS external_calendar_id,
        se.last_synced_at::text AS last_sync_at,
        se.sync_state::text AS raw_sync_state,
        se.last_sync_error,
        se.sync_review_reason AS review_reason
      FROM schedule_event se
      LEFT JOIN shoot s
        ON s.id = se.linked_shoot_id
      WHERE se.tenant_id = $1
        AND se.deleted_at IS NULL
        AND (se.outlook_event_id IS NOT NULL OR se.sync_state <> 'not_linked')
      ORDER BY COALESCE(se.last_synced_at, se.updated_at) DESC
      LIMIT 6
    `,
    [tenantId]
  );
  return rows;
}

async function loadMondayLinkedRecords(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<MondayLinkedRow>(
    `
      WITH latest_eval AS (
        SELECT DISTINCT ON (location_id)
          location_id,
          monday_item_id,
          created_at AS last_sync_at
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND monday_item_id IS NOT NULL
        ORDER BY location_id, created_at DESC
      ),
      latest_photo AS (
        SELECT DISTINCT ON (location_id)
          location_id,
          monday_item_id,
          COALESCE(uploaded_at, created_at) AS last_sync_at
        FROM setup_photo_upload
        WHERE tenant_id = $1
          AND (monday_item_id IS NOT NULL OR monday_asset_id IS NOT NULL)
        ORDER BY location_id, COALESCE(uploaded_at, created_at) DESC
      )
      SELECT
        l.id::text AS local_record_id,
        l.name AS local_label,
        COALESCE(le.monday_item_id, lp.monday_item_id) AS external_record_id,
        COALESCE(
          CASE
            WHEN COALESCE(le.last_sync_at, 'epoch') >= COALESCE(lp.last_sync_at, 'epoch') THEN le.last_sync_at
            ELSE lp.last_sync_at
          END,
          le.last_sync_at,
          lp.last_sync_at
        )::text AS last_sync_at
      FROM shoot_location l
      LEFT JOIN latest_eval le
        ON le.location_id = l.id
      LEFT JOIN latest_photo lp
        ON lp.location_id = l.id
      WHERE l.tenant_id = $1
        AND l.active_status = 'active'
        AND (le.monday_item_id IS NOT NULL OR lp.monday_item_id IS NOT NULL)
      ORDER BY COALESCE(
        CASE
          WHEN COALESCE(le.last_sync_at, 'epoch') >= COALESCE(lp.last_sync_at, 'epoch') THEN le.last_sync_at
          ELSE lp.last_sync_at
        END,
        le.last_sync_at,
        lp.last_sync_at
      ) DESC NULLS LAST
      LIMIT 6
    `,
    [tenantId]
  );
  return rows;
}

function buildOutlookProviderSummary(
  account: OutlookAccount,
  aggregate: OutlookAggregateRow
): IntegrationGovernanceProviderSummary {
  const healthState = mapOutlookHealth(account.provider_mode, account.health_state, account.connection_status);
  const syncMode: IntegrationSyncMode = "read_only_import";
  const pendingSyncCount = 0;
  const linkedRecordCount = 0;

  return {
    provider: "outlook",
    display_name: "Microsoft Outlook",
    enabled: true,
    connection_status: account.connection_status,
    health_state: healthState,
    health_label: describeOutlookHealth(account, healthState),
    sync_mode: syncMode,
    sync_mode_label: "Read-Only Delegated Preview",
    source_of_truth_summary:
      "Mission Control owns scheduling, staffing, readiness, attendance, and internal operations. Phase 1 Outlook only provides a delegated read-only calendar preview and per-user visibility controls after a leader explicitly connects it.",
    owner_contact: "Scheduling and operations leadership",
    last_successful_sync_at: account.last_sync_at ?? aggregate.last_successful_sync_at ?? null,
    last_failed_sync_at: account.last_failed_sync_at ?? aggregate.last_failed_sync_at ?? null,
    next_scheduled_sync_at: null,
    failure_count: toNumber(aggregate.failure_count),
    unresolved_conflict_count: toNumber(aggregate.unresolved_conflict_count),
    pending_sync_count: pendingSyncCount,
    linked_record_count: linkedRecordCount,
    mapping_status: describeOutlookMappingStatus(account),
    external_label: describeOutlookExternalLabel(account),
    owned_domains: ["shoot_status", "staffing", "attendance", "readiness", "operational_notes"],
    mirrored_domains: ["calendar_holds", "external_event_timing", "attendee_context"],
    overlay_domains: ["staffing_health", "attendance_risk", "manager_review_flags"],
    writeback_domains: [],
    replayable_operation_id: aggregate.replayable_operation_id
  };
}

function buildZendeskProviderSummary(
  connection: ReturnType<typeof mapConnectionToZendeskConnection> | ReturnType<typeof buildDefaultZendeskConnection>,
  aggregate: ZendeskAggregateRow
): IntegrationGovernanceProviderSummary {
  const healthState = mapZendeskHealth(connection.health_state, connection.connection_status);
  return {
    provider: "zendesk",
    display_name: "Zendesk",
    enabled: connection.connection_status !== "disconnected" || connection.demo_mode || connection.live_enabled,
    connection_status: connection.connection_status,
    health_state: healthState,
    health_label: describeHealth(healthState),
    sync_mode: "read_only_import",
    sync_mode_label: "Read-Only Import",
    source_of_truth_summary:
      "Zendesk owns ticket status, ticket metadata, queue state, and support resolution. Mission Control mirrors summary health, aging, and customer-risk signals without recreating the ticket workflow here.",
    owner_contact: "Customer service systems owner",
    last_successful_sync_at: connection.last_successful_sync_at,
    last_failed_sync_at: connection.last_failed_sync_at,
    next_scheduled_sync_at: null,
    failure_count: toNumber(aggregate.failure_count),
    unresolved_conflict_count: toNumber(aggregate.unresolved_conflict_count),
    pending_sync_count: 0,
    linked_record_count: connection.records_synced,
    mapping_status: connection.demo_mode
      ? "Demo-mode summary ingestion is active locally. Live ticket ownership still stays in Zendesk."
      : "Summary ingestion maps Zendesk tickets into leadership metrics, backlog aging, and high-severity support signals.",
    external_label: connection.demo_mode
      ? "Demo reporting cache"
      : connection.connected_account_email
        ? `Connected as ${connection.connected_account_email}`
        : "Zendesk summary cache",
    owned_domains: ["ticket_status", "ticket_metadata", "resolution_state"],
    mirrored_domains: ["ticket_backlog", "aging", "category_breakdown", "severity_signals"],
    overlay_domains: ["home_alert_weighting", "leadership_summary_context"],
    writeback_domains: [],
    replayable_operation_id: aggregate.replayable_operation_id
  };
}

function buildMondayProviderSummary(aggregate: MondayAggregateRow): IntegrationGovernanceProviderSummary {
  const linkedRecordCount = toNumber(aggregate.linked_location_count);
  const failureCount = toNumber(aggregate.failure_count);
  const unresolvedConflictCount = toNumber(aggregate.unresolved_conflict_count);
  const configured = Boolean(config.MONDAY_API_TOKEN);
  const healthState = !configured && linkedRecordCount === 0 ? "disabled" : failureCount > 0 ? "degraded" : "warning";

  return {
    provider: "monday",
    display_name: "Monday.com",
    enabled: configured || linkedRecordCount > 0,
    connection_status: configured ? "connected" : linkedRecordCount > 0 ? "attention" : "disconnected",
    health_state: healthState,
    health_label: describeHealth(healthState),
    sync_mode: "manual_reconciliation",
    sync_mode_label: "Manual Reconciliation",
    source_of_truth_summary:
      "Monday remains a coexistence and migration system for selected legacy workflows. Mission Control overlays field context and should not auto-overwrite legacy board state until ownership is explicitly retired here.",
    owner_contact: "Operations migration owner",
    last_successful_sync_at: aggregate.last_successful_sync_at ?? null,
    last_failed_sync_at: aggregate.last_failed_sync_at ?? null,
    next_scheduled_sync_at: null,
    failure_count: failureCount,
    unresolved_conflict_count: unresolvedConflictCount,
    pending_sync_count: 0,
    linked_record_count: linkedRecordCount,
    mapping_status: linkedRecordCount
      ? `${linkedRecordCount} location-linked legacy records still depend on Monday history or assets. Use manual review when Mission Control overlays a new decision.`
      : "No active Monday-linked records were found in this tenant snapshot.",
    external_label: configured ? "Legacy coexistence connector configured" : "Legacy coexistence view only",
    owned_domains: ["legacy_board_item_state"],
    mirrored_domains: ["legacy_location_history", "legacy_setup_assets"],
    overlay_domains: ["location_memory", "post_shoot_eval_context", "operational_follow_ups"],
    writeback_domains: ["selected_eval_exports", "selected_setup_photo_exports"],
    replayable_operation_id: aggregate.replayable_operation_id
  };
}

function buildSourceOfTruthRules(): IntegrationSourceOfTruthRule[] {
  return [
    {
      id: "mission-control-core",
      field_group: "Shoots, staffing, attendance, readiness, production, follow-through",
      owner: "Mission Control",
      ownership_type: "source_of_truth",
      sync_direction: "Internal first",
      edit_policy: "Editable here",
      summary:
        "Mission Control is authoritative for shoot status, staffing requirements, assignments, attendance state, readiness, post-shoot evals, location memory, directory ownership, production stages, touchpoints, and follow-ups."
    },
    {
      id: "outlook-calendar",
      field_group: "Calendar event objects, external holds, meeting context",
      owner: "Outlook",
      ownership_type: "mirror",
      sync_direction: "Imported for visibility, writeback only when explicitly pushed",
      edit_policy: "Editable in Outlook for external event context only",
      summary:
        "Outlook provides mirrored calendar visibility and optional controlled writeback for linked event timing and location context. It does not own staffing, readiness, or operational control."
    },
    {
      id: "outlook-overlays",
      field_group: "Staffing health, attendance risk, readiness watch, issue flags",
      owner: "Mission Control",
      ownership_type: "overlay",
      sync_direction: "No automatic overwrite to Outlook",
      edit_policy: "Editable here",
      summary:
        "Operational overlays such as staffing risk and attendance issues are app-only context layered on top of mirrored calendar data."
    },
    {
      id: "zendesk-tickets",
      field_group: "Ticket status, metadata, queue ownership, support resolution state",
      owner: "Zendesk",
      ownership_type: "source_of_truth",
      sync_direction: "Read-only import",
      edit_policy: "Editable in Zendesk",
      summary:
        "Mission Control reads cached support metrics and high-severity queue signals from Zendesk, but ticket workflow remains owned by Zendesk."
    },
    {
      id: "monday-coexistence",
      field_group: "Legacy workflow/project records during migration",
      owner: "Monday.com",
      ownership_type: "transitional",
      sync_direction: "Manual reconciliation for high-risk changes",
      edit_policy: "Read-only or exported from specific flows",
      summary:
        "Monday stays transitional during coexistence. Mission Control can add operational overlays and selected exports, but broad bidirectional sync is intentionally avoided."
    },
    {
      id: "derived-values",
      field_group: "Staffing health, late/no-show escalation, reporting projections, alert weighting",
      owner: "Mission Control",
      ownership_type: "derived",
      sync_direction: "Calculated internally",
      edit_policy: "Not directly editable",
      summary:
        "Derived values are calculated from canonical records and should never be treated as an independent source of truth or silently overwritten by external systems."
    }
  ];
}

function buildSummary(
  providers: IntegrationGovernanceProviderSummary[],
  linkedRecords: IntegrationLinkedRecordSummary[]
): IntegrationGovernanceSummary {
  return {
    provider_count: providers.length,
    connected_count: providers.filter((provider) => provider.connection_status === "connected").length,
    warning_count: providers.filter((provider) => provider.health_state === "warning" || provider.health_state === "degraded").length,
    failing_count: providers.filter((provider) => provider.health_state === "failing").length,
    unresolved_conflict_count: providers.reduce((total, provider) => total + provider.unresolved_conflict_count, 0),
    pending_sync_count: providers.reduce((total, provider) => total + provider.pending_sync_count, 0),
    linked_record_count: providers.reduce((total, provider) => total + provider.linked_record_count, 0),
    last_updated_at: new Date().toISOString(),
    freshness: {
      state: "recently_updated",
      label: "Recently Updated"
    }
  };
}

function mapConflictRow(row: IntegrationOperationRow): IntegrationConflictReview {
  const provider = normalizeProvider(row.provider);
  const localValue = firstMeaningfulValue([
    formatValuePreview(row.conflict_payload?.mission_control_value),
    formatValuePreview(row.conflict_payload?.local_value),
    formatValuePreview(row.payload?.mission_control_snapshot),
    formatValuePreview(row.payload)
  ]);
  const externalValue = firstMeaningfulValue([
    formatValuePreview(row.conflict_payload?.external_value),
    formatValuePreview(row.conflict_payload?.provider_value),
    formatValuePreview(row.result_payload?.external_snapshot),
    row.external_id
  ]);

  return {
    operation_id: row.id,
    provider,
    title: `${humanize(row.entity_type)} ${humanize(row.operation_type)}`,
    summary: row.conflict_summary ?? row.last_error ?? "This sync needs manual review before Mission Control or the external system should win.",
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    status: row.status === "conflict" ? "conflict" : "failed",
    occurred_at: row.updated_at ?? row.created_at,
    source_system: row.source_system,
    local_value: localValue,
    external_value: externalValue,
    source_policy: getSourcePolicyForProvider(provider),
    recommended_action: getConflictRecommendedAction(provider, row),
    resolution_paths: getResolutionPaths(provider),
    can_replay: provider !== "zendesk"
  };
}

function mapRecentOperationRow(row: IntegrationOperationRow): IntegrationGovernanceOperation {
  const provider = normalizeProvider(row.provider);
  return {
    id: row.id,
    provider,
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    operation_type: row.operation_type,
    external_object_type: row.external_object_type,
    external_id: row.external_id,
    source_system: row.source_system,
    status: normalizeOperationStatus(row.status),
    attempt_count: Number(row.attempt_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    message: row.last_error ?? row.conflict_summary ?? row.external_id ?? null
  };
}

function mapOutlookLinkedRecord(row: OutlookLinkedRow): IntegrationLinkedRecordSummary {
  const syncState = mapOutlookSyncState(row.raw_sync_state, row.review_reason, row.last_sync_error);
  return {
    provider: "outlook",
    record_type: row.record_type,
    local_record_id: row.local_record_id,
    local_label: row.local_label?.trim() || "Linked Outlook record",
    external_record_id: row.external_record_id,
    external_url: null,
    sync_state: syncState,
    sync_state_label: humanize(syncState),
    last_sync_at: row.last_sync_at,
    source_ownership_summary:
      "Outlook mirrors calendar timing and attendee context. Mission Control still owns staffing, readiness, and the operational follow-through attached to this record.",
    conflict_banner: row.review_reason ?? row.last_sync_error,
    recommended_action:
      syncState === "sync_failed"
        ? "Review the failure, then replay or explicitly push the record."
        : syncState === "conflict_detected" || syncState === "partially_synced"
          ? "Compare the Outlook timing change against Mission Control before choosing which side should win."
          : syncState === "sync_pending"
            ? "Pending outbound sync."
            : null
  };
}

function mapMondayLinkedRecord(row: MondayLinkedRow): IntegrationLinkedRecordSummary {
  const syncState = config.MONDAY_API_TOKEN ? "partially_synced" : "archived_link";
  return {
    provider: "monday",
    record_type: "location",
    local_record_id: row.local_record_id,
    local_label: row.local_label,
    external_record_id: row.external_record_id,
    external_url: buildMondayItemUrl(row.external_record_id),
    sync_state: syncState,
    sync_state_label: humanize(syncState),
    last_sync_at: row.last_sync_at,
    source_ownership_summary:
      "This record still carries Monday-linked history or assets. Mission Control should treat that external board state as transitional until migration is explicitly closed here.",
    conflict_banner: null,
    recommended_action: "Use manual reconciliation for high-risk changes and keep new operational context in Mission Control."
  };
}

function mapOutlookHealth(
  providerMode: OutlookAccount["provider_mode"],
  healthState: OutlookAccount["health_state"],
  connectionStatus: OutlookAccount["connection_status"]
): IntegrationHealthState {
  if (connectionStatus === "attention" || healthState === "connected_error") {
    return "failing";
  }
  if (connectionStatus === "disconnected") {
    return providerMode === "graph_live" ? "warning" : "disabled";
  }
  if (healthState === "connected_warning" || healthState === "connected_pending_sync" || healthState === "mock") {
    return "warning";
  }
  return "healthy";
}

function describeOutlookHealth(
  account: OutlookAccount,
  healthState: IntegrationHealthState
) {
  if (account.connection_status === "disconnected") {
    return account.provider_mode === "graph_live" ? "Disconnected" : "Disabled";
  }
  if (account.health_state === "mock") {
    return "Mock Preview";
  }
  if (account.health_state === "connected_pending_sync") {
    return "Needs Sync";
  }
  if (account.health_state === "connected_error" || account.connection_status === "attention") {
    return "Needs Attention";
  }
  return describeHealth(healthState);
}

function describeOutlookMappingStatus(
  account: OutlookAccount
) {
  if (account.provider_mode === "mock") {
    return account.connection_status === "connected"
      ? "Mock preview is active. Mission Control is showing seeded Outlook calendar data, and staffing or readiness ownership still stays in Mission Control."
      : "Mock preview is available locally, but it is not connected right now. Mission Control continues to own operational scheduling."
  }
  if (account.connection_status === "connected") {
    return "Delegated read-only calendar preview and visibility preferences are active. Background writeback and worker-driven Outlook sync stay outside the Phase 1 pilot surface.";
  }
  if (account.connection_status === "attention") {
    return "Live Microsoft 365 was connected, but the delegated pilot now needs review before leadership should trust calendar visibility again.";
  }
  return "Microsoft 365 delegated preview is configured, but this tenant has not completed a live Outlook calendar connection yet. Background writeback remains out of scope for Phase 1.";
}

function describeOutlookExternalLabel(
  account: OutlookAccount
) {
  if (account.provider_mode === "mock") {
    return account.connection_status === "connected" ? "Mock calendar preview active" : "Mock calendar preview available";
  }
  if (account.connected_as) {
    return `Connected as ${account.connected_as}`;
  }
  return account.connection_status === "attention" ? "Microsoft 365 needs reconnect" : "Microsoft 365 ready to connect";
}

function mapZendeskHealth(
  healthState: ReturnType<typeof buildDefaultZendeskConnection>["health_state"],
  connectionStatus: ReturnType<typeof buildDefaultZendeskConnection>["connection_status"]
): IntegrationHealthState {
  if (connectionStatus === "disconnected" && healthState === "disabled") {
    return "disabled";
  }
  if (healthState === "connected_error") {
    return "failing";
  }
  if (healthState === "connected_warning" || healthState === "connected_pending_sync" || healthState === "mock") {
    return "warning";
  }
  if (connectionStatus === "disconnected") {
    return "disabled";
  }
  return "healthy";
}

function mapOutlookSyncState(
  rawState: string,
  reviewReason: string | null,
  lastError: string | null
): IntegrationLinkedRecordSyncState {
  if (rawState === "pending_sync") {
    return "sync_pending";
  }
  if (rawState === "in_sync") {
    return "synced";
  }
  if (rawState === "sync_warning") {
    return reviewReason ? "conflict_detected" : "partially_synced";
  }
  if (rawState === "sync_error" || lastError) {
    return "sync_failed";
  }
  return "never_synced";
}

function normalizeProvider(value: string): IntegrationProviderKey {
  if (value === "outlook" || value === "zendesk" || value === "monday") {
    return value;
  }
  return "outlook";
}

function normalizeOperationStatus(value: string): IntegrationGovernanceOperation["status"] {
  if (value === "pending" || value === "processing" || value === "succeeded" || value === "failed" || value === "conflict") {
    return value;
  }
  return "failed";
}

function getSourcePolicyForProvider(provider: IntegrationProviderKey) {
  switch (provider) {
    case "zendesk":
      return "Zendesk owns ticket status and resolution state. Mission Control mirrors support-risk visibility only.";
    case "monday":
      return "Monday is transitional during migration. Use manual reconciliation when legacy board state and Mission Control context disagree.";
    case "outlook":
    default:
      return "Outlook owns external calendar timing and attendee context only after an explicit link. Mission Control remains authoritative for operational work.";
  }
}

function getConflictRecommendedAction(provider: IntegrationProviderKey, row: IntegrationOperationRow) {
  if (provider === "zendesk") {
    return "Fix the cache or mapping issue, then rerun the summary sync without treating Zendesk as locally editable.";
  }
  if (provider === "monday") {
    return "Keep Mission Control as the operational overlay, verify the legacy board state, and only replay after the migration owner confirms the safe direction.";
  }
  if (row.status === "conflict") {
    return "Compare the external event timing against Mission Control, decide which system owns the disputed field, then replay only after that decision is explicit.";
  }
  return "Review the failed payload, correct the source issue, and replay the sync when the source-of-truth path is clear.";
}

function getResolutionPaths(provider: IntegrationProviderKey) {
  if (provider === "zendesk") {
    return ["Keep External", "Escalate"];
  }
  if (provider === "monday") {
    return ["Keep Local", "Keep External", "Escalate"];
  }
  return ["Keep Local", "Keep External", "Replay Sync", "Escalate"];
}

function buildMondayItemUrl(mondayItemId: string | null) {
  if (!mondayItemId || !config.MONDAY_ITEM_URL_TEMPLATE) {
    return null;
  }
  if (config.MONDAY_ITEM_URL_TEMPLATE.includes("{itemId}")) {
    return config.MONDAY_ITEM_URL_TEMPLATE.replace("{itemId}", encodeURIComponent(mondayItemId));
  }
  return `${config.MONDAY_ITEM_URL_TEMPLATE}${encodeURIComponent(mondayItemId)}`;
}

function describeHealth(healthState: IntegrationHealthState) {
  switch (healthState) {
    case "healthy":
      return "Healthy";
    case "warning":
      return "Warning";
    case "degraded":
      return "Degraded";
    case "failing":
      return "Failing";
    default:
      return "Disabled";
  }
}

function firstMeaningfulValue(values: Array<string | null>) {
  return values.find((value) => Boolean(value && value !== "{}" && value !== "[]")) ?? null;
}

function formatValuePreview(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
  } catch {
    return null;
  }
}

function toNumber(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
