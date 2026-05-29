import type { PoolClient } from "pg";
import { config } from "../config.js";
import type {
  ZendeskCategoryRule,
  ZendeskConnection,
  ZendeskConnectionStatus,
  ZendeskHealthState,
  ZendeskProviderMode,
  ZendeskProviderTicket,
  ZendeskSyncError,
  ZendeskSyncRun,
  ZendeskSyncStatus,
  ZendeskTicketCategory,
  ZendeskTicketSummary
} from "../types/zendesk.js";
import { createAuditLog } from "./audit.js";

type ZendeskConnectionRow = {
  id: string;
  tenant_id: string;
  provider_mode: ZendeskProviderMode;
  connection_status: ZendeskConnectionStatus;
  health_state: ZendeskHealthState;
  connected_account_email: string | null;
  sync_cursor: string | null;
  records_synced: number;
  warning_count: number;
  error_count: number;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  last_error_message: string | null;
};

type ZendeskSyncRunRow = {
  id: string;
  provider_mode: ZendeskProviderMode;
  started_at: string;
  finished_at: string | null;
  status: ZendeskSyncStatus;
  records_synced: number;
  warnings: unknown;
  errors: unknown;
};

type ZendeskTicketRow = {
  zendesk_ticket_id: string;
  subject: string;
  requester_name: string | null;
  requester_email: string | null;
  assignee_name: string | null;
  organization_name: string | null;
  group_name: string | null;
  status: string;
  priority: string | null;
  category: ZendeskTicketCategory;
  ticket_created_at: string;
  ticket_updated_at: string;
  ticket_solved_at: string | null;
  first_reply_minutes: number | null;
  resolution_minutes: number | null;
  is_unassigned: boolean;
  external_url: string | null;
  tags: unknown;
};

type ZendeskDailyMetricRow = {
  metric_date: string;
  category: ZendeskTicketCategory;
  new_ticket_count: number;
  resolved_ticket_count: number;
  open_backlog_count: number;
  oldest_open_ticket_count: number;
  median_first_reply_minutes: number | null;
  median_resolution_minutes: number | null;
};

type ZendeskCategoryRuleRow = {
  id: string;
  category: ZendeskTicketCategory;
  rule_type: ZendeskCategoryRule["rule_type"];
  field_key: string | null;
  match_value: string;
  priority: number;
  enabled: boolean;
};

export type ZendeskDailyMetricInput = {
  metric_date: string;
  category: ZendeskTicketCategory;
  new_ticket_count: number;
  resolved_ticket_count: number;
  open_backlog_count: number;
  oldest_open_ticket_count: number;
  median_first_reply_minutes: number | null;
  median_resolution_minutes: number | null;
};

export type ZendeskRequestAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function loadZendeskConnection(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ZendeskConnectionRow>(
    `
      SELECT
        id,
        tenant_id,
        provider_mode::text AS provider_mode,
        connection_status::text AS connection_status,
        health_state::text AS health_state,
        connected_account_email,
        sync_cursor,
        records_synced,
        warning_count,
        error_count,
        last_sync_at::text,
        last_successful_sync_at::text,
        last_failed_sync_at::text,
        last_error_message
      FROM zendesk_connection
      WHERE tenant_id = $1
      LIMIT 1
    `,
    [tenantId]
  );
  return rows[0] ?? null;
}

export async function upsertZendeskConnection(
  client: PoolClient,
  tenantId: string,
  patch: {
    provider_mode: ZendeskProviderMode;
    connection_status: ZendeskConnectionStatus;
    health_state: ZendeskHealthState;
    connected_account_email?: string | null;
    sync_cursor?: string | null;
    records_synced?: number;
    warning_count?: number;
    error_count?: number;
    last_sync_at?: string | null;
    last_successful_sync_at?: string | null;
    last_failed_sync_at?: string | null;
    last_error_message?: string | null;
  }
) {
  const { rows } = await client.query<ZendeskConnectionRow>(
    `
      INSERT INTO zendesk_connection (
        tenant_id,
        provider_mode,
        connection_status,
        health_state,
        connected_account_email,
        sync_cursor,
        records_synced,
        warning_count,
        error_count,
        last_sync_at,
        last_successful_sync_at,
        last_failed_sync_at,
        last_error_message,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        provider_mode = EXCLUDED.provider_mode,
        connection_status = EXCLUDED.connection_status,
        health_state = EXCLUDED.health_state,
        connected_account_email = EXCLUDED.connected_account_email,
        sync_cursor = EXCLUDED.sync_cursor,
        records_synced = EXCLUDED.records_synced,
        warning_count = EXCLUDED.warning_count,
        error_count = EXCLUDED.error_count,
        last_sync_at = EXCLUDED.last_sync_at,
        last_successful_sync_at = EXCLUDED.last_successful_sync_at,
        last_failed_sync_at = EXCLUDED.last_failed_sync_at,
        last_error_message = EXCLUDED.last_error_message,
        updated_at = now()
      RETURNING
        id,
        tenant_id,
        provider_mode::text AS provider_mode,
        connection_status::text AS connection_status,
        health_state::text AS health_state,
        connected_account_email,
        sync_cursor,
        records_synced,
        warning_count,
        error_count,
        last_sync_at::text,
        last_successful_sync_at::text,
        last_failed_sync_at::text,
        last_error_message
    `,
    [
      tenantId,
      patch.provider_mode,
      patch.connection_status,
      patch.health_state,
      patch.connected_account_email ?? null,
      patch.sync_cursor ?? null,
      patch.records_synced ?? 0,
      patch.warning_count ?? 0,
      patch.error_count ?? 0,
      patch.last_sync_at ?? null,
      patch.last_successful_sync_at ?? null,
      patch.last_failed_sync_at ?? null,
      patch.last_error_message ?? null
    ]
  );
  return rows[0];
}

export async function recordZendeskSyncRun(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    providerMode: ZendeskProviderMode;
    status: ZendeskSyncStatus;
    recordsSynced: number;
    warnings: string[];
    errors: ZendeskSyncError[];
  }
) {
  const { rows } = await client.query<ZendeskSyncRunRow>(
    `
      INSERT INTO zendesk_sync_run (
        tenant_id,
        actor_user_id,
        provider_mode,
        started_at,
        finished_at,
        status,
        records_synced,
        warnings,
        errors
      )
      VALUES ($1,$2,$3,now(),now(),$4,$5,$6::jsonb,$7::jsonb)
      RETURNING
        id,
        provider_mode::text AS provider_mode,
        started_at::text,
        finished_at::text,
        status::text,
        records_synced,
        warnings,
        errors
    `,
    [
      input.tenantId,
      input.actorUserId,
      input.providerMode,
      input.status,
      input.recordsSynced,
      JSON.stringify(input.warnings),
      JSON.stringify(input.errors)
    ]
  );
  return mapSyncRun(rows[0]);
}

export async function listZendeskSyncRuns(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ZendeskSyncRunRow>(
    `
      SELECT
        id,
        provider_mode::text AS provider_mode,
        started_at::text,
        finished_at::text,
        status::text,
        records_synced,
        warnings,
        errors
      FROM zendesk_sync_run
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 6
    `,
    [tenantId]
  );
  return rows.map(mapSyncRun);
}

export async function listZendeskCategoryRules(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ZendeskCategoryRuleRow>(
    `
      SELECT id, category::text AS category, rule_type, field_key, match_value, priority, enabled
      FROM zendesk_category_rule
      WHERE tenant_id = $1
        AND enabled = TRUE
      ORDER BY priority ASC, created_at ASC
    `,
    [tenantId]
  );
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    rule_type: row.rule_type,
    field_key: row.field_key,
    match_value: row.match_value,
    priority: Number(row.priority),
    enabled: Boolean(row.enabled)
  }));
}

export async function upsertZendeskTickets(
  client: PoolClient,
  tenantId: string,
  tickets: Array<ZendeskProviderTicket & { category: ZendeskTicketCategory }>
) {
  for (const ticket of tickets) {
    await client.query(
      `
        INSERT INTO zendesk_ticket_cache (
          tenant_id,
          zendesk_ticket_id,
          subject,
          requester_name,
          requester_email,
          assignee_name,
          assignee_id,
          organization_name,
          group_name,
          form_name,
          status,
          priority,
          category,
          ticket_created_at,
          ticket_updated_at,
          ticket_solved_at,
          first_reply_minutes,
          resolution_minutes,
          is_unassigned,
          tags,
          external_url,
          raw_payload,
          is_deleted,
          synced_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::zendesk_ticket_category,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22::jsonb,$23,now(),now()
        )
        ON CONFLICT (tenant_id, zendesk_ticket_id) DO UPDATE SET
          subject = EXCLUDED.subject,
          requester_name = EXCLUDED.requester_name,
          requester_email = EXCLUDED.requester_email,
          assignee_name = EXCLUDED.assignee_name,
          assignee_id = EXCLUDED.assignee_id,
          organization_name = EXCLUDED.organization_name,
          group_name = EXCLUDED.group_name,
          form_name = EXCLUDED.form_name,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          category = EXCLUDED.category,
          ticket_created_at = EXCLUDED.ticket_created_at,
          ticket_updated_at = EXCLUDED.ticket_updated_at,
          ticket_solved_at = EXCLUDED.ticket_solved_at,
          first_reply_minutes = EXCLUDED.first_reply_minutes,
          resolution_minutes = EXCLUDED.resolution_minutes,
          is_unassigned = EXCLUDED.is_unassigned,
          tags = EXCLUDED.tags,
          external_url = EXCLUDED.external_url,
          raw_payload = EXCLUDED.raw_payload,
          is_deleted = EXCLUDED.is_deleted,
          synced_at = now(),
          updated_at = now()
      `,
      [
        tenantId,
        ticket.zendesk_ticket_id,
        ticket.subject,
        ticket.requester_name,
        ticket.requester_email,
        ticket.assignee_name,
        ticket.assignee_id,
        ticket.organization_name,
        ticket.group_name,
        ticket.form_name,
        ticket.status,
        ticket.priority,
        ticket.category,
        ticket.ticket_created_at,
        ticket.ticket_updated_at,
        ticket.ticket_solved_at,
        ticket.first_reply_minutes,
        ticket.resolution_minutes,
        !ticket.assignee_id,
        JSON.stringify(ticket.tags ?? []),
        ticket.external_url,
        JSON.stringify(ticket.raw_payload ?? {}),
        ticket.is_deleted
      ]
    );
  }
}

export async function listCachedZendeskTickets(
  client: PoolClient,
  tenantId: string,
  options: {
    includeDeleted?: boolean;
    onlyOpen?: boolean;
    limit?: number;
  } = {}
) {
  const values: unknown[] = [tenantId];
  const where = ["tenant_id = $1"];
  if (!options.includeDeleted) {
    where.push("is_deleted = FALSE");
  }
  if (options.onlyOpen) {
    where.push("status NOT IN ('solved', 'closed')");
  }
  let limitClause = "";
  if (options.limit) {
    values.push(options.limit);
    limitClause = `LIMIT $${values.length}`;
  }

  const { rows } = await client.query<ZendeskTicketRow>(
    `
      SELECT
        zendesk_ticket_id,
        subject,
        requester_name,
        requester_email,
        assignee_name,
        organization_name,
        group_name,
        status,
        priority,
        category::text AS category,
        ticket_created_at::text,
        ticket_updated_at::text,
        ticket_solved_at::text,
        first_reply_minutes,
        resolution_minutes,
        is_unassigned,
        external_url,
        tags
      FROM zendesk_ticket_cache
      WHERE ${where.join(" AND ")}
      ORDER BY ticket_updated_at DESC
      ${limitClause}
    `,
    values
  );

  return rows.map((row) => ({
    zendesk_ticket_id: row.zendesk_ticket_id,
    subject: row.subject,
    requester_name: row.requester_name,
    requester_email: row.requester_email,
    assignee_name: row.assignee_name,
    organization_name: row.organization_name,
    group_name: row.group_name,
    status: row.status,
    priority: row.priority,
    category: row.category,
    ticket_created_at: row.ticket_created_at,
    ticket_updated_at: row.ticket_updated_at,
    ticket_solved_at: row.ticket_solved_at,
    first_reply_minutes: row.first_reply_minutes === null ? null : Number(row.first_reply_minutes),
    resolution_minutes: row.resolution_minutes === null ? null : Number(row.resolution_minutes),
    is_unassigned: Boolean(row.is_unassigned),
    external_url: row.external_url,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : []
  })) satisfies ZendeskTicketSummary[];
}

export async function replaceZendeskDailyMetrics(
  client: PoolClient,
  tenantId: string,
  metrics: ZendeskDailyMetricInput[]
) {
  await client.query("DELETE FROM zendesk_daily_metric WHERE tenant_id = $1", [tenantId]);
  for (const metric of metrics) {
    await client.query(
      `
        INSERT INTO zendesk_daily_metric (
          tenant_id,
          metric_date,
          category,
          new_ticket_count,
          resolved_ticket_count,
          open_backlog_count,
          oldest_open_ticket_count,
          median_first_reply_minutes,
          median_resolution_minutes
        )
        VALUES ($1,$2,$3::zendesk_ticket_category,$4,$5,$6,$7,$8,$9)
      `,
      [
        tenantId,
        metric.metric_date,
        metric.category,
        metric.new_ticket_count,
        metric.resolved_ticket_count,
        metric.open_backlog_count,
        metric.oldest_open_ticket_count,
        metric.median_first_reply_minutes,
        metric.median_resolution_minutes
      ]
    );
  }
}

export async function listZendeskDailyMetrics(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ZendeskDailyMetricRow>(
    `
      SELECT
        metric_date::text,
        category::text AS category,
        new_ticket_count,
        resolved_ticket_count,
        open_backlog_count,
        oldest_open_ticket_count,
        median_first_reply_minutes,
        median_resolution_minutes
      FROM zendesk_daily_metric
      WHERE tenant_id = $1
      ORDER BY metric_date ASC, category ASC
    `,
    [tenantId]
  );
  return rows.map((row) => ({
    metric_date: row.metric_date,
    category: row.category,
    new_ticket_count: Number(row.new_ticket_count),
    resolved_ticket_count: Number(row.resolved_ticket_count),
    open_backlog_count: Number(row.open_backlog_count),
    oldest_open_ticket_count: Number(row.oldest_open_ticket_count),
    median_first_reply_minutes: row.median_first_reply_minutes === null ? null : Number(row.median_first_reply_minutes),
    median_resolution_minutes: row.median_resolution_minutes === null ? null : Number(row.median_resolution_minutes)
  }));
}

export async function createZendeskAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
  meta: ZendeskRequestAuditContext = {}
) {
  return createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
}

export function isZendeskLiveConfigured() {
  if (!config.ZENDESK_ENABLED || !config.ZENDESK_SUBDOMAIN) {
    return false;
  }
  if (config.ZENDESK_AUTH_MODE === "oauth") {
    return Boolean(config.ZENDESK_ACCESS_TOKEN);
  }
  return Boolean(config.ZENDESK_EMAIL && config.ZENDESK_API_TOKEN);
}

export function mapConnectionToZendeskConnection(row: ZendeskConnectionRow | null, tenantId: string): ZendeskConnection {
  const liveEnabled = isZendeskLiveConfigured();
  if (!row) {
    return buildDefaultZendeskConnection(tenantId, liveEnabled);
  }
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    provider_mode: row.provider_mode,
    connection_status: row.connection_status,
    health_state: row.health_state,
    connected_account_email: row.connected_account_email,
    connection_label: buildZendeskConnectionLabel(row, liveEnabled),
    live_enabled: liveEnabled,
    demo_mode: row.provider_mode === "mock",
    last_sync_at: row.last_sync_at,
    last_successful_sync_at: row.last_successful_sync_at,
    last_failed_sync_at: row.last_failed_sync_at,
    records_synced: Number(row.records_synced ?? 0),
    warning_count: Number(row.warning_count ?? 0),
    error_count: Number(row.error_count ?? 0),
    stale_sync: isStaleSync(row.last_successful_sync_at ?? row.last_sync_at),
    last_error_message: row.last_error_message
  };
}

export function buildDefaultZendeskConnection(tenantId: string, liveEnabled = isZendeskLiveConfigured()): ZendeskConnection {
  if (liveEnabled) {
    return {
      id: `zendesk-live-${tenantId}`,
      tenant_id: tenantId,
      provider_mode: "zendesk_live",
      connection_status: "disconnected",
      health_state: "connected_pending_sync",
      connected_account_email: config.ZENDESK_EMAIL || null,
      connection_label: "Zendesk live reporting is configured. Run a sync to cache leadership metrics locally.",
      live_enabled: true,
      demo_mode: false,
      last_sync_at: null,
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      records_synced: 0,
      warning_count: 0,
      error_count: 0,
      stale_sync: false,
      last_error_message: null
    };
  }

  return {
    id: `zendesk-mock-${tenantId}`,
    tenant_id: tenantId,
    provider_mode: "mock",
    connection_status: "connected",
    health_state: "mock",
    connected_account_email: null,
    connection_label: "Zendesk live credentials are not configured. Mission Control is showing cached demo support health instead.",
    live_enabled: false,
    demo_mode: true,
    last_sync_at: null,
    last_successful_sync_at: null,
    last_failed_sync_at: null,
    records_synced: 0,
    warning_count: 1,
    error_count: 0,
    stale_sync: false,
    last_error_message: null
  };
}

function buildZendeskConnectionLabel(row: ZendeskConnectionRow, liveEnabled: boolean) {
  if (row.provider_mode === "mock") {
    return liveEnabled
      ? "Mission Control is currently using cached demo Zendesk data. Leadership can switch to live sync by running the Zendesk sync route with credentials configured."
      : "Zendesk live credentials are not configured. Mission Control is showing cached demo support health instead.";
  }
  if (row.health_state === "connected_pending_sync") {
    return "Zendesk live reporting is configured. Run a sync to cache leadership metrics locally.";
  }
  if (row.health_state === "connected_healthy") {
    return "Zendesk reporting is healthy. Leadership metrics are reading from the local cache.";
  }
  if (row.health_state === "connected_warning") {
    return row.last_error_message ?? "Zendesk reporting completed with warnings. Review sync health before trusting trend direction.";
  }
  if (row.health_state === "connected_error") {
    return row.last_error_message ?? "Zendesk reporting needs attention. Manual sync failed and the cache may be stale.";
  }
  return liveEnabled
    ? "Zendesk live reporting is configured but has not completed a clean sync yet."
    : "Zendesk live reporting is not configured for this environment.";
}

function isStaleSync(value: string | null) {
  if (!value) {
    return true;
  }
  const ageMs = Date.now() - new Date(value).getTime();
  return ageMs > 6 * 60 * 60 * 1000;
}

function mapSyncRun(row: ZendeskSyncRunRow): ZendeskSyncRun {
  return {
    id: row.id,
    provider_mode: row.provider_mode,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    records_synced: Number(row.records_synced ?? 0),
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    errors: Array.isArray(row.errors) ? (row.errors as ZendeskSyncError[]) : []
  };
}
