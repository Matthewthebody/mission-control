import type { PoolClient } from "pg";
import type { ImportAuditListItem, ImportAuditRecord } from "../../types/diagnostics.js";

export async function listImportAuditRecords(
  client: PoolClient,
  tenantId: string,
  limit = 100
): Promise<ImportAuditListItem[]> {
  const { rows } = await client.query<ImportAuditListItem>(
    `
      SELECT
        record.id::text,
        record.tenant_id::text,
        record.import_type,
        record.started_by_user_id::text,
        record.status,
        record.source_reference,
        record.row_count_total,
        record.row_count_created,
        record.row_count_updated,
        record.row_count_rejected,
        record.errors_json,
        record.created_at,
        record.completed_at,
        actor.full_name AS started_by_name
      FROM import_audit_records record
      LEFT JOIN app_user actor ON actor.id = record.started_by_user_id AND actor.tenant_id = record.tenant_id
      WHERE record.tenant_id = $1
      ORDER BY record.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );

  return rows;
}

export async function createImportAuditRecord(
  client: PoolClient,
  tenantId: string,
  input: {
    importType: string;
    startedByUserId: string;
    status: string;
    sourceReference?: string | null;
    rowCountTotal?: number | null;
    rowCountCreated?: number | null;
    rowCountUpdated?: number | null;
    rowCountRejected?: number | null;
    errors?: Record<string, unknown> | null;
    completedAt?: string | null;
  }
): Promise<ImportAuditRecord> {
  const { rows } = await client.query<ImportAuditRecord>(
    `
      INSERT INTO import_audit_records (
        tenant_id,
        import_type,
        started_by_user_id,
        status,
        source_reference,
        row_count_total,
        row_count_created,
        row_count_updated,
        row_count_rejected,
        errors_json,
        completed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
      RETURNING
        id::text,
        tenant_id::text,
        import_type,
        started_by_user_id::text,
        status,
        source_reference,
        row_count_total,
        row_count_created,
        row_count_updated,
        row_count_rejected,
        errors_json,
        created_at,
        completed_at
    `,
    [
      tenantId,
      input.importType,
      input.startedByUserId,
      input.status,
      input.sourceReference ?? null,
      input.rowCountTotal ?? null,
      input.rowCountCreated ?? null,
      input.rowCountUpdated ?? null,
      input.rowCountRejected ?? null,
      input.errors == null ? null : JSON.stringify(input.errors),
      input.completedAt ?? null
    ]
  );

  return rows[0];
}
