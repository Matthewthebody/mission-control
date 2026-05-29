import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import type {
  AuditEventListItem,
  DiagnosticFindingListItem,
  DiagnosticsWorkspaceResponse,
  RepairActionListItem
} from "../../types/diagnostics.js";
import { writeAuditEvent } from "./auditEventService.js";
import { listExportAuditRecords } from "./exportAuditService.js";
import { listImportAuditRecords } from "./importAuditService.js";
import { listPolicyDecisionTraces } from "./policyTraceService.js";
import { listSyncHealthRecords } from "./syncHealthService.js";
import { getDiagnosticsWorkspaceSummary, listSystemHealthChecks } from "./systemHealthQueryService.js";

type FindingFilters = {
  severity?: string | null;
  findingType?: string | null;
  ruleKey?: string | null;
  resourceType?: string | null;
  departmentType?: string | null;
  status?: string | null;
  ownerUserId?: string | null;
  repairable?: boolean | null;
  openOnly?: boolean;
  criticalOnly?: boolean;
  limit?: number;
};

type AuditFilters = {
  actorUserId?: string | null;
  eventType?: string | null;
  resourceType?: string | null;
  departmentType?: string | null;
  result?: string | null;
  targetUserId?: string | null;
  requestId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
};

export async function listDiagnosticFindings(
  client: PoolClient,
  tenantId: string,
  filters: FindingFilters = {}
): Promise<DiagnosticFindingListItem[]> {
  const values: Array<string | number | boolean> = [tenantId];
  const conditions = ["finding.tenant_id = $1"];

  if (filters.severity) {
    values.push(filters.severity);
    conditions.push(`finding.severity = $${values.length}::diagnostic_severity_type`);
  }
  if (filters.findingType) {
    values.push(filters.findingType);
    conditions.push(`finding.finding_type = $${values.length}`);
  }
  if (filters.ruleKey) {
    values.push(filters.ruleKey);
    conditions.push(`finding.rule_key = $${values.length}`);
  }
  if (filters.resourceType) {
    values.push(filters.resourceType);
    conditions.push(`finding.resource_type = $${values.length}`);
  }
  if (filters.departmentType) {
    values.push(filters.departmentType);
    conditions.push(`finding.department_type = $${values.length}::job_department_type`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`finding.status = $${values.length}::diagnostic_finding_status_type`);
  }
  if (filters.ownerUserId) {
    values.push(filters.ownerUserId);
    conditions.push(`finding.owner_user_id = $${values.length}::uuid`);
  }
  if (filters.repairable != null) {
    values.push(filters.repairable);
    conditions.push(`finding.repairable = $${values.length}`);
  }
  if (filters.openOnly) {
    conditions.push(`finding.status IN ('open', 'acknowledged', 'in_review')`);
  }
  if (filters.criticalOnly) {
    conditions.push(`finding.severity IN ('critical', 'high')`);
  }

  values.push(filters.limit ?? 200);

  const { rows } = await client.query<DiagnosticFindingListItem>(
    `
      SELECT
        finding.id::text,
        finding.tenant_id::text,
        finding.finding_type,
        finding.severity,
        finding.status,
        finding.resource_type,
        finding.resource_id,
        finding.related_resource_type,
        finding.related_resource_id,
        finding.department_type,
        finding.title,
        finding.description,
        finding.rule_key,
        finding.detected_at,
        finding.owner_user_id::text,
        finding.recommended_action,
        finding.repairable,
        finding.resolved_at,
        finding.resolved_by_user_id::text,
        finding.resolution_note,
        finding.created_at,
        finding.updated_at,
        owner.full_name AS owner_name,
        resolver.full_name AS resolved_by_name,
        CASE
          WHEN finding.department_type IS NULL THEN NULL
          ELSE initcap(replace(finding.department_type::text, '_', ' '))
        END AS department_label
      FROM diagnostic_findings finding
      LEFT JOIN app_user owner ON owner.id = finding.owner_user_id AND owner.tenant_id = finding.tenant_id
      LEFT JOIN app_user resolver ON resolver.id = finding.resolved_by_user_id AND resolver.tenant_id = finding.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE finding.severity
          WHEN 'critical' THEN 5
          WHEN 'high' THEN 4
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 2
          ELSE 1
        END DESC,
        finding.detected_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows;
}

export async function updateDiagnosticFinding(
  client: PoolClient,
  auth: AuthUser,
  findingId: string,
  input: {
    status?: "acknowledged" | "resolved" | "dismissed" | null;
    ownerUserId?: string | null;
    resolutionNote?: string | null;
  }
) {
  const existing = await client.query<DiagnosticFindingListItem>(
    `
      SELECT
        finding.id::text,
        finding.tenant_id::text,
        finding.finding_type,
        finding.severity,
        finding.status,
        finding.resource_type,
        finding.resource_id,
        finding.related_resource_type,
        finding.related_resource_id,
        finding.department_type,
        finding.title,
        finding.description,
        finding.rule_key,
        finding.detected_at,
        finding.owner_user_id::text,
        finding.recommended_action,
        finding.repairable,
        finding.resolved_at,
        finding.resolved_by_user_id::text,
        finding.resolution_note,
        finding.created_at,
        finding.updated_at,
        owner.full_name AS owner_name,
        resolver.full_name AS resolved_by_name,
        CASE
          WHEN finding.department_type IS NULL THEN NULL
          ELSE initcap(replace(finding.department_type::text, '_', ' '))
        END AS department_label
      FROM diagnostic_findings finding
      LEFT JOIN app_user owner ON owner.id = finding.owner_user_id AND owner.tenant_id = finding.tenant_id
      LEFT JOIN app_user resolver ON resolver.id = finding.resolved_by_user_id AND resolver.tenant_id = finding.tenant_id
      WHERE finding.tenant_id = $1
        AND finding.id = $2::uuid
      LIMIT 1
    `,
    [auth.tenantId, findingId]
  );

  if (!existing.rows[0]) {
    return null;
  }

  const { rows } = await client.query<DiagnosticFindingListItem>(
    `
      UPDATE diagnostic_findings
      SET
        status = COALESCE($3::diagnostic_finding_status_type, status),
        owner_user_id = COALESCE($4::uuid, owner_user_id),
        resolved_at = CASE
          WHEN $3::text = 'resolved' THEN now()
          ELSE resolved_at
        END,
        resolved_by_user_id = CASE
          WHEN $3::text = 'resolved' THEN $2::uuid
          ELSE resolved_by_user_id
        END,
        resolution_note = COALESCE($5, resolution_note),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $6::uuid
      RETURNING
        id::text,
        tenant_id::text,
        finding_type,
        severity,
        status,
        resource_type,
        resource_id,
        related_resource_type,
        related_resource_id,
        department_type,
        title,
        description,
        rule_key,
        detected_at,
        owner_user_id::text,
        recommended_action,
        repairable,
        resolved_at,
        resolved_by_user_id::text,
        resolution_note,
        created_at,
        updated_at,
        NULL::text AS owner_name,
        NULL::text AS resolved_by_name,
        NULL::text AS department_label
    `,
    [auth.tenantId, auth.id, input.status ?? null, input.ownerUserId ?? null, input.resolutionNote ?? null, findingId]
  );

  const updated = rows[0] ?? null;
  if (updated) {
    await writeAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventCategory: "diagnostics",
      eventType: "finding_updated",
      resourceType: "diagnostic_finding",
      resourceId: updated.id,
      departmentType: updated.department_type,
      oldValues: {
        status: existing.rows[0].status,
        owner_user_id: existing.rows[0].owner_user_id,
        resolution_note: existing.rows[0].resolution_note
      },
      newValues: {
        status: updated.status,
        owner_user_id: updated.owner_user_id,
        resolution_note: updated.resolution_note
      },
      context: {
        rule_key: updated.rule_key,
        finding_type: updated.finding_type
      },
      result: "allowed"
    });
  }

  return updated;
}

export async function listAuditEvents(
  client: PoolClient,
  tenantId: string,
  filters: AuditFilters = {}
): Promise<AuditEventListItem[]> {
  const values: Array<string | number> = [tenantId];
  const conditions = ["event.tenant_id = $1"];

  if (filters.actorUserId) {
    values.push(filters.actorUserId);
    conditions.push(`event.actor_user_id = $${values.length}::uuid`);
  }
  if (filters.eventType) {
    values.push(filters.eventType);
    conditions.push(`event.event_type = $${values.length}`);
  }
  if (filters.resourceType) {
    values.push(filters.resourceType);
    conditions.push(`event.resource_type = $${values.length}`);
  }
  if (filters.departmentType) {
    values.push(filters.departmentType);
    conditions.push(`event.department_type = $${values.length}::job_department_type`);
  }
  if (filters.result) {
    values.push(filters.result);
    conditions.push(`event.result = $${values.length}`);
  }
  if (filters.targetUserId) {
    values.push(filters.targetUserId);
    conditions.push(`event.target_user_id = $${values.length}::uuid`);
  }
  if (filters.requestId) {
    values.push(filters.requestId);
    conditions.push(`event.request_id = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    conditions.push(`event.created_at >= $${values.length}::timestamptz`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    conditions.push(`event.created_at <= $${values.length}::timestamptz`);
  }

  values.push(filters.limit ?? 200);

  const { rows } = await client.query<AuditEventListItem>(
    `
      SELECT
        event.id::text,
        event.tenant_id::text,
        event.actor_user_id::text,
        event.event_category,
        event.event_type,
        event.resource_type,
        event.resource_id,
        event.target_user_id::text,
        event.department_type,
        event.request_id,
        event.trace_id,
        event.old_values_json,
        event.new_values_json,
        event.context_json,
        event.result,
        event.created_at,
        actor.full_name AS actor_name,
        target_user.full_name AS target_name,
        concat(event.event_category, ' / ', event.event_type) AS message
      FROM audit_events event
      LEFT JOIN app_user actor ON actor.id = event.actor_user_id AND actor.tenant_id = event.tenant_id
      LEFT JOIN app_user target_user ON target_user.id = event.target_user_id AND target_user.tenant_id = event.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY event.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows;
}

export async function listRepairActions(client: PoolClient, tenantId: string, limit = 100): Promise<RepairActionListItem[]> {
  const { rows } = await client.query<RepairActionListItem>(
    `
      SELECT
        action.id::text,
        action.tenant_id::text,
        action.action_key,
        action.resource_type,
        action.resource_id,
        action.requested_by_user_id::text,
        action.approved_by_user_id::text,
        action.executed_by_user_id::text,
        action.status,
        action.dry_run,
        action.input_json,
        action.before_snapshot_json,
        action.after_snapshot_json,
        action.result_summary_json,
        action.created_at,
        action.executed_at,
        action.rolled_back_at,
        requester.full_name AS requested_by_name,
        approver.full_name AS approved_by_name,
        executor.full_name AS executed_by_name
      FROM repair_actions action
      LEFT JOIN app_user requester ON requester.id = action.requested_by_user_id AND requester.tenant_id = action.tenant_id
      LEFT JOIN app_user approver ON approver.id = action.approved_by_user_id AND approver.tenant_id = action.tenant_id
      LEFT JOIN app_user executor ON executor.id = action.executed_by_user_id AND executor.tenant_id = action.tenant_id
      WHERE action.tenant_id = $1
      ORDER BY action.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );

  return rows;
}

export async function getDiagnosticsWorkspace(client: PoolClient, tenantId: string): Promise<DiagnosticsWorkspaceResponse> {
  const summary = await getDiagnosticsWorkspaceSummary(client, tenantId);
  const healthChecks = await listSystemHealthChecks(client, tenantId);
  const syncHealth = await listSyncHealthRecords(client, tenantId);
  const recentFindings = await listDiagnosticFindings(client, tenantId, { openOnly: true, limit: 12 });
  const recentRepairs = await listRepairActions(client, tenantId, 12);
  const recentAuditEvents = await listAuditEvents(client, tenantId, { limit: 12 });
  const recentPolicyTraces = await listPolicyDecisionTraces(client, tenantId, { limit: 12 });
  const recentImports = await listImportAuditRecords(client, tenantId, 12);
  const recentExports = await listExportAuditRecords(client, tenantId, 12);
  const findingCounts = await client.query<{
    open_count: string;
    repairable_count: string;
    critical_count: string;
  }>(
    `
      SELECT
        count(*) FILTER (WHERE status IN ('open', 'acknowledged', 'in_review'))::text AS open_count,
        count(*) FILTER (WHERE repairable = true AND status IN ('open', 'acknowledged', 'in_review'))::text AS repairable_count,
        count(*) FILTER (WHERE severity = 'critical'::diagnostic_severity_type AND status IN ('open', 'acknowledged', 'in_review'))::text AS critical_count
      FROM diagnostic_findings
      WHERE tenant_id = $1
    `,
    [tenantId]
  );

  return {
    summary,
    finding_counts: {
      open_count: Number(findingCounts.rows[0]?.open_count ?? "0"),
      repairable_count: Number(findingCounts.rows[0]?.repairable_count ?? "0"),
      critical_count: Number(findingCounts.rows[0]?.critical_count ?? "0")
    },
    health_checks: healthChecks,
    sync_health: syncHealth,
    recent_findings: recentFindings,
    recent_repairs: recentRepairs,
    recent_audit_events: recentAuditEvents,
    recent_policy_traces: recentPolicyTraces,
    recent_imports: recentImports,
    recent_exports: recentExports
  };
}
