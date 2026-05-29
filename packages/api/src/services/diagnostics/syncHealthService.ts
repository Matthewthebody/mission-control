import type { PoolClient } from "pg";
import type { SyncHealthRecord } from "../../types/diagnostics.js";

type SyncAggregateRow = {
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: string;
};

function buildComputedSyncRecord(
  tenantId: string,
  syncKey: string,
  row: SyncAggregateRow,
  lastErrorMessage: string | null
): SyncHealthRecord {
  const failureCount = Number(row.failure_count ?? "0");
  const status: SyncHealthRecord["status"] =
    failureCount > 0 && !row.last_success_at
      ? "error"
      : failureCount > 0
        ? "warning"
        : "healthy";

  const now = new Date().toISOString();
  return {
    id: `computed:${syncKey}`,
    tenant_id: tenantId,
    sync_key: syncKey,
    resource_type: null,
    resource_id: null,
    status,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    failure_count: failureCount,
    last_error_code: null,
    last_error_message: lastErrorMessage,
    metadata_json: { computed: true },
    created_at: now,
    updated_at: now
  };
}

async function computeAlertDeliveryHealth(client: PoolClient, tenantId: string) {
  const [aggregate, errorRow] = await Promise.all([
    client.query<SyncAggregateRow>(
      `
        SELECT
          max(CASE WHEN delivery_status IN ('delivered', 'read', 'acted_on') THEN updated_at END)::text AS last_success_at,
          max(CASE WHEN delivery_status = 'failed' THEN updated_at END)::text AS last_failure_at,
          count(*) FILTER (WHERE delivery_status = 'failed')::text AS failure_count
        FROM alert_deliveries
        WHERE tenant_id = $1
      `,
      [tenantId]
    ),
    client.query<{ last_error_message: string | null }>(
      `
        SELECT alert.message AS last_error_message
        FROM alert_deliveries delivery
        JOIN alert_events alert ON alert.id = delivery.alert_event_id AND alert.tenant_id = delivery.tenant_id
        WHERE delivery.tenant_id = $1
          AND delivery.delivery_status = 'failed'
        ORDER BY delivery.updated_at DESC
        LIMIT 1
      `,
      [tenantId]
    )
  ]);

  return buildComputedSyncRecord(tenantId, "alerts_delivery", aggregate.rows[0] ?? { last_success_at: null, last_failure_at: null, failure_count: "0" }, errorRow.rows[0]?.last_error_message ?? null);
}

async function computeImportPipelineHealth(client: PoolClient, tenantId: string) {
  const result = await client.query<SyncAggregateRow & { last_error_message: string | null }>(
    `
      SELECT
        max(CASE WHEN status = 'completed' THEN completed_at END)::text AS last_success_at,
        max(CASE WHEN status = 'failed' THEN completed_at END)::text AS last_failure_at,
        count(*) FILTER (WHERE status = 'failed')::text AS failure_count,
        (
          array_remove(array_agg(CASE WHEN status = 'failed' THEN source_reference END ORDER BY created_at DESC), NULL)
        )[1] AS last_error_message
      FROM import_audit_records
      WHERE tenant_id = $1
    `,
    [tenantId]
  );

  return buildComputedSyncRecord(tenantId, "imports_pipeline", result.rows[0] ?? { last_success_at: null, last_failure_at: null, failure_count: "0", last_error_message: null }, result.rows[0]?.last_error_message ?? null);
}

async function computeExportPipelineHealth(client: PoolClient, tenantId: string) {
  const result = await client.query<SyncAggregateRow & { last_error_message: string | null }>(
    `
      SELECT
        max(CASE WHEN status = 'completed' THEN completed_at END)::text AS last_success_at,
        max(CASE WHEN status = 'failed' THEN completed_at END)::text AS last_failure_at,
        count(*) FILTER (WHERE status = 'failed')::text AS failure_count,
        (
          array_remove(array_agg(CASE WHEN status = 'failed' THEN export_type END ORDER BY created_at DESC), NULL)
        )[1] AS last_error_message
      FROM export_audit_records
      WHERE tenant_id = $1
    `,
    [tenantId]
  );

  return buildComputedSyncRecord(tenantId, "exports_pipeline", result.rows[0] ?? { last_success_at: null, last_failure_at: null, failure_count: "0", last_error_message: null }, result.rows[0]?.last_error_message ?? null);
}

export async function listSyncHealthRecords(client: PoolClient, tenantId: string): Promise<SyncHealthRecord[]> {
  const persisted = await client.query<SyncHealthRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        sync_key,
        resource_type,
        resource_id,
        status,
        last_success_at,
        last_failure_at,
        failure_count,
        last_error_code,
        last_error_message,
        metadata_json,
        created_at,
        updated_at
      FROM sync_health_records
      WHERE tenant_id = $1
      ORDER BY status DESC, updated_at DESC
    `,
    [tenantId]
  );

  if (persisted.rows.length > 0) {
    return persisted.rows;
  }

  return Promise.all([
    computeAlertDeliveryHealth(client, tenantId),
    computeImportPipelineHealth(client, tenantId),
    computeExportPipelineHealth(client, tenantId)
  ]);
}

export async function upsertSyncHealthRecord(
  client: PoolClient,
  tenantId: string,
  input: {
    syncKey: string;
    resourceType?: string | null;
    resourceId?: string | null;
    status: SyncHealthRecord["status"];
    lastSuccessAt?: string | null;
    lastFailureAt?: string | null;
    failureCount?: number;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const metadataJson = input.metadata == null ? null : JSON.stringify(input.metadata);
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM sync_health_records
      WHERE tenant_id = $1
        AND sync_key = $2
        AND COALESCE(resource_type, '') = COALESCE($3, '')
        AND COALESCE(resource_id, '') = COALESCE($4, '')
      LIMIT 1
    `,
    [tenantId, input.syncKey, input.resourceType ?? null, input.resourceId ?? null]
  );

  if (existing.rows[0]) {
    const { rows } = await client.query<SyncHealthRecord>(
      `
        UPDATE sync_health_records
        SET
          status = $3::sync_health_status_type,
          last_success_at = $4,
          last_failure_at = $5,
          failure_count = $6,
          last_error_code = $7,
          last_error_message = $8,
          metadata_json = $9::jsonb,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2::uuid
        RETURNING
          id::text,
          tenant_id::text,
          sync_key,
          resource_type,
          resource_id,
          status,
          last_success_at,
          last_failure_at,
          failure_count,
          last_error_code,
          last_error_message,
          metadata_json,
          created_at,
          updated_at
      `,
      [
        tenantId,
        existing.rows[0].id,
        input.status,
        input.lastSuccessAt ?? null,
        input.lastFailureAt ?? null,
        input.failureCount ?? 0,
        input.lastErrorCode ?? null,
        input.lastErrorMessage ?? null,
        metadataJson
      ]
    );
    return rows[0];
  }

  const { rows } = await client.query<SyncHealthRecord>(
    `
      INSERT INTO sync_health_records (
        tenant_id,
        sync_key,
        resource_type,
        resource_id,
        status,
        last_success_at,
        last_failure_at,
        failure_count,
        last_error_code,
        last_error_message,
        metadata_json
      )
      VALUES ($1,$2,$3,$4,$5::sync_health_status_type,$6,$7,$8,$9,$10,$11::jsonb)
      RETURNING
        id::text,
        tenant_id::text,
        sync_key,
        resource_type,
        resource_id,
        status,
        last_success_at,
        last_failure_at,
        failure_count,
        last_error_code,
        last_error_message,
        metadata_json,
        created_at,
        updated_at
    `,
    [
      tenantId,
      input.syncKey,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.status,
      input.lastSuccessAt ?? null,
      input.lastFailureAt ?? null,
      input.failureCount ?? 0,
      input.lastErrorCode ?? null,
      input.lastErrorMessage ?? null,
      metadataJson
    ]
  );

  return rows[0];
}
