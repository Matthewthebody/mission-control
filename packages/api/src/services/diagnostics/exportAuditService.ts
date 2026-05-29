import type { PoolClient } from "pg";
import type { ExportAuditListItem, ExportAuditRecord } from "../../types/diagnostics.js";

export async function listExportAuditRecords(
  client: PoolClient,
  tenantId: string,
  limit = 100
): Promise<ExportAuditListItem[]> {
  const { rows } = await client.query<ExportAuditListItem>(
    `
      SELECT
        record.id::text,
        record.tenant_id::text,
        record.export_type,
        record.requested_by_user_id::text,
        record.status,
        record.scope_summary_json,
        record.row_count,
        record.column_keys_json,
        record.file_reference,
        record.created_at,
        record.completed_at,
        actor.full_name AS requested_by_name
      FROM export_audit_records record
      LEFT JOIN app_user actor ON actor.id = record.requested_by_user_id AND actor.tenant_id = record.tenant_id
      WHERE record.tenant_id = $1
      ORDER BY record.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );

  return rows;
}

export async function createExportAuditRecord(
  client: PoolClient,
  tenantId: string,
  input: {
    exportType: string;
    requestedByUserId: string;
    status: string;
    scopeSummary: Record<string, unknown>;
    rowCount?: number | null;
    columnKeys?: string[] | null;
    fileReference?: string | null;
    completedAt?: string | null;
  }
): Promise<ExportAuditRecord> {
  const { rows } = await client.query<ExportAuditRecord>(
    `
      INSERT INTO export_audit_records (
        tenant_id,
        export_type,
        requested_by_user_id,
        status,
        scope_summary_json,
        row_count,
        column_keys_json,
        file_reference,
        completed_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9)
      RETURNING
        id::text,
        tenant_id::text,
        export_type,
        requested_by_user_id::text,
        status,
        scope_summary_json,
        row_count,
        column_keys_json,
        file_reference,
        created_at,
        completed_at
    `,
    [
      tenantId,
      input.exportType,
      input.requestedByUserId,
      input.status,
      JSON.stringify(input.scopeSummary),
      input.rowCount ?? null,
      input.columnKeys == null ? null : JSON.stringify(input.columnKeys),
      input.fileReference ?? null,
      input.completedAt ?? null
    ]
  );

  return rows[0];
}
