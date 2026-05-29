import type { PoolClient } from "pg";
import type {
  DiagnosticsWorkspaceSummary,
  SystemHealthCheckRecord,
  SystemHealthStatus
} from "../../types/diagnostics.js";
import { listSyncHealthRecords } from "./syncHealthService.js";

type FindingBucketRow = {
  bucket: string;
  critical_count: string;
  high_count: string;
  open_count: string;
};

function deriveHealthStatus(counts: { critical: number; high: number; open: number }): SystemHealthStatus {
  if (counts.critical > 0) {
    return "critical";
  }
  if (counts.high > 0) {
    return "at_risk";
  }
  if (counts.open > 0) {
    return "watch";
  }
  return "healthy";
}

function buildHealthCheck(
  tenantId: string,
  checkKey: string,
  summary: string,
  counts: { critical: number; high: number; open: number },
  details: Record<string, unknown>
): SystemHealthCheckRecord {
  const now = new Date().toISOString();
  return {
    id: `computed:${checkKey}`,
    tenant_id: tenantId,
    check_key: checkKey,
    scope_type: "tenant",
    scope_value: null,
    status: deriveHealthStatus(counts),
    summary,
    details_json: details,
    checked_at: now,
    created_at: now
  };
}

export async function listSystemHealthChecks(client: PoolClient, tenantId: string): Promise<SystemHealthCheckRecord[]> {
  const persisted = await client.query<SystemHealthCheckRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        check_key,
        scope_type,
        scope_value,
        status,
        summary,
        details_json,
        checked_at,
        created_at
      FROM system_health_checks
      WHERE tenant_id = $1
      ORDER BY checked_at DESC, check_key ASC
      LIMIT 40
    `,
    [tenantId]
  );

  if (persisted.rows.length > 0) {
    return persisted.rows;
  }

  const findingBuckets = await client.query<FindingBucketRow>(
    `
      SELECT
        CASE
          WHEN rule_key LIKE 'core_data.%' THEN 'job_integrity'
          WHEN rule_key LIKE 'status_drift.%' OR rule_key LIKE 'workflow_gap.%' THEN 'workflow_drift'
          WHEN rule_key LIKE 'data_integrity.watch_flag_%' THEN 'watchlist_integrity'
          ELSE 'permission_integrity'
        END AS bucket,
        count(*) FILTER (WHERE severity = 'critical'::diagnostic_severity_type AND status IN ('open', 'acknowledged', 'in_review'))::text AS critical_count,
        count(*) FILTER (WHERE severity = 'high'::diagnostic_severity_type AND status IN ('open', 'acknowledged', 'in_review'))::text AS high_count,
        count(*) FILTER (WHERE status IN ('open', 'acknowledged', 'in_review'))::text AS open_count
      FROM diagnostic_findings
      WHERE tenant_id = $1
      GROUP BY 1
    `,
    [tenantId]
  );
  const syncRecords = await listSyncHealthRecords(client, tenantId);

  const bucketMap = new Map(
    findingBuckets.rows.map((row) => [
      row.bucket,
      {
        critical: Number(row.critical_count ?? "0"),
        high: Number(row.high_count ?? "0"),
        open: Number(row.open_count ?? "0")
      }
    ])
  );

  const syncFailureCount = syncRecords.filter((record) => record.status === "error" || record.status === "warning").length;

  return [
    buildHealthCheck(
      tenantId,
      "job_integrity",
      "Shared job, day, and parent-link integrity across the truth layer.",
      bucketMap.get("job_integrity") ?? { critical: 0, high: 0, open: 0 },
      { module: "jobs" }
    ),
    buildHealthCheck(
      tenantId,
      "workflow_drift",
      "Readiness, staffing, and downstream workflow state staying aligned with the underlying records.",
      bucketMap.get("workflow_drift") ?? { critical: 0, high: 0, open: 0 },
      { module: "workflow" }
    ),
    buildHealthCheck(
      tenantId,
      "watchlist_integrity",
      "Watch flags and urgent attention surfaces staying linked to real source records.",
      bucketMap.get("watchlist_integrity") ?? { critical: 0, high: 0, open: 0 },
      { module: "watchlist" }
    ),
    buildHealthCheck(
      tenantId,
      "permission_integrity",
      "Policy, visibility, and admin access surfaces staying consistent and debuggable.",
      bucketMap.get("permission_integrity") ?? { critical: 0, high: 0, open: 0 },
      { module: "permissions" }
    ),
    buildHealthCheck(
      tenantId,
      "sync_integrity",
      syncFailureCount > 0 ? `${syncFailureCount} sync pipeline(s) have warnings or failures.` : "No sync pipeline warnings are active right now.",
      syncFailureCount > 0 ? { critical: 0, high: syncFailureCount, open: syncFailureCount } : { critical: 0, high: 0, open: 0 },
      { module: "sync", records: syncRecords.map((record) => ({ sync_key: record.sync_key, status: record.status })) }
    )
  ];
}

export async function getDiagnosticsWorkspaceSummary(client: PoolClient, tenantId: string): Promise<DiagnosticsWorkspaceSummary> {
  const findingSummary = await client.query<{ active_critical_findings: string }>(
    `
      SELECT count(*)::text AS active_critical_findings
      FROM diagnostic_findings
      WHERE tenant_id = $1
        AND severity = 'critical'::diagnostic_severity_type
        AND status IN ('open', 'acknowledged', 'in_review')
    `,
    [tenantId]
  );
  const repairSummary = await client.query<{ open_repairs: string }>(
    `
      SELECT count(*)::text AS open_repairs
      FROM repair_actions
      WHERE tenant_id = $1
        AND status IN ('queued', 'awaiting_approval', 'dry_run_complete', 'executing')
    `,
    [tenantId]
  );
  const syncRecords = await listSyncHealthRecords(client, tenantId);
  const importSummary = await client.query<{ recent_import_failures: string }>(
    `
      SELECT count(*)::text AS recent_import_failures
      FROM import_audit_records
      WHERE tenant_id = $1
        AND status = 'failed'
        AND created_at >= now() - interval '7 days'
    `,
    [tenantId]
  );
  const exportSummary = await client.query<{ recent_export_count: string }>(
    `
      SELECT count(*)::text AS recent_export_count
      FROM export_audit_records
      WHERE tenant_id = $1
        AND created_at >= now() - interval '7 days'
    `,
    [tenantId]
  );
  const lastRun = await client.query<{ last_scan_at: string | null }>(
    `
      SELECT max(completed_at)::text AS last_scan_at
      FROM diagnostic_rule_runs
      WHERE tenant_id = $1
    `,
    [tenantId]
  );

  return {
    active_critical_findings: Number(findingSummary.rows[0]?.active_critical_findings ?? "0"),
    open_repairs: Number(repairSummary.rows[0]?.open_repairs ?? "0"),
    sync_failures: syncRecords.filter((record) => record.status === "error" || record.status === "warning").length,
    recent_import_failures: Number(importSummary.rows[0]?.recent_import_failures ?? "0"),
    recent_export_count: Number(exportSummary.rows[0]?.recent_export_count ?? "0"),
    last_scan_at: lastRun.rows[0]?.last_scan_at ?? null
  };
}
