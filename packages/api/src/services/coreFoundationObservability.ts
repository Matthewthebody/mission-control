import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { AuditEventListItem } from "../types/diagnostics.js";
import type {
  CoreFoundationArea,
  CoreFoundationDiagnosticsPayload,
  CoreFoundationFeatureFlags,
  CoreFoundationHealthCheck,
  CoreFoundationHealthStatus,
  CoreFoundationValidationIssue
} from "../types/coreFoundationDiagnostics.js";

type CountRow = {
  [key: string]: string | null;
};

type SearchCoverageRow = {
  entity_type: string;
  base_count: string;
  index_count: string;
};

type CoreFoundationTableSupport = {
  policyDecisionTrace: boolean;
};

const FOUNDATION_EVENT_CATEGORIES = [
  "global_search",
  "reporting_foundation",
  "admin_configuration",
  "operational_approval",
  "activity_timeline"
] as const;

function humanizeArea(area: CoreFoundationArea) {
  return area
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function countValue(row: CountRow | undefined, key: string) {
  return Number(row?.[key] ?? "0");
}

function buildHealthCheck(
  area: CoreFoundationArea,
  input: {
    enabled: boolean;
    status: CoreFoundationHealthStatus;
    summary: string;
    detailCount: number;
    lastEventAt?: string | null;
    details?: Record<string, unknown>;
  }
): CoreFoundationHealthCheck {
  if (!input.enabled && area !== "config") {
    return {
      area,
      status: "disabled",
      summary: `${humanizeArea(area)} is disabled by feature flag.`,
      detail_count: 0,
      last_event_at: input.lastEventAt ?? null,
      details: { enabled: false }
    };
  }
  return {
    area,
    status: input.status,
    summary: input.summary,
    detail_count: input.detailCount,
    last_event_at: input.lastEventAt ?? null,
    details: {
      enabled: input.enabled,
      ...(input.details ?? {})
    }
  };
}

function addIssue(
  issues: CoreFoundationValidationIssue[],
  issue: CoreFoundationValidationIssue
) {
  issues.push(issue);
}

function mapCategoryToArea(category: string): CoreFoundationArea {
  switch (category) {
    case "global_search":
      return "search";
    case "reporting_foundation":
      return "reporting_services";
    case "admin_configuration":
      return "admin_configuration";
    case "operational_approval":
      return "approvals";
    case "activity_timeline":
      return "activity_history";
    default:
      return "config";
  }
}

export function getCoreFoundationFeatureFlags(): CoreFoundationFeatureFlags {
  return {
    diagnostics_enabled: Boolean(config.CORE_FOUNDATION_DIAGNOSTICS_ENABLED),
    workflow_engine_enabled: Boolean(config.CORE_FOUNDATION_WORKFLOW_ENGINE_ENABLED),
    operational_events_enabled: Boolean(config.CORE_FOUNDATION_OPERATIONAL_EVENTS_ENABLED),
    global_search_enabled: Boolean(config.CORE_FOUNDATION_GLOBAL_SEARCH_ENABLED),
    activity_timeline_enabled: Boolean(config.CORE_FOUNDATION_ACTIVITY_TIMELINE_ENABLED),
    admin_configuration_enabled: Boolean(config.CORE_FOUNDATION_ADMIN_CONFIGURATION_ENABLED),
    approval_framework_enabled: Boolean(config.CORE_FOUNDATION_APPROVAL_FRAMEWORK_ENABLED),
    reporting_enabled: Boolean(config.CORE_FOUNDATION_REPORTING_ENABLED)
  };
}

export function getCoreFoundationValidationIssues(): CoreFoundationValidationIssue[] {
  const issues: CoreFoundationValidationIssue[] = [];
  const flags = getCoreFoundationFeatureFlags();

  if (config.NODE_ENV === "production" && config.ALLOW_DEV_LOGIN) {
    addIssue(issues, {
      area: "config",
      severity: "error",
      code: "config.allow_dev_login_enabled",
      summary: "Development login is still enabled in production."
    });
  }

  if (config.NODE_ENV === "production" && config.ALLOW_PASSWORD_LOGIN) {
    addIssue(issues, {
      area: "config",
      severity: "warning",
      code: "config.allow_password_login_enabled",
      summary: "Password login remains enabled in production. Keep this limited to approved break-glass use."
    });
  }

  if (!flags.diagnostics_enabled) {
    addIssue(issues, {
      area: "config",
      severity: "warning",
      code: "config.diagnostics_disabled",
      summary: "Core foundation diagnostics are disabled, so admin operators lose the main reliability workspace."
    });
  }

  if (flags.reporting_enabled && !flags.activity_timeline_enabled) {
    addIssue(issues, {
      area: "reporting_services",
      severity: "warning",
      code: "reporting_services.activity_timeline_disabled",
      summary: "Reporting is enabled while activity timeline APIs are disabled, which reduces cross-system traceability."
    });
  }

  if (flags.approval_framework_enabled && !flags.operational_events_enabled) {
    addIssue(issues, {
      area: "approvals",
      severity: "warning",
      code: "approvals.operational_events_disabled",
      summary: "Approvals are enabled while the operational event engine is disabled, so alerting and inbox fan-out will be reduced."
    });
  }

  if (flags.workflow_engine_enabled && !flags.admin_configuration_enabled) {
    addIssue(issues, {
      area: "workflow_engine",
      severity: "warning",
      code: "workflow_engine.admin_configuration_disabled",
      summary: "Workflow rules are enabled while admin configuration is disabled, so operators cannot adjust the supported runtime rule layer."
    });
  }

  return issues;
}

export function assertCoreFoundationStartupConfig(_target: "api") {
  if (!config.CORE_FOUNDATION_STRICT_STARTUP_VALIDATION) {
    return;
  }
  const issues = getCoreFoundationValidationIssues().filter((issue) => issue.severity === "error");
  if (config.NODE_ENV === "production" && issues.length > 0) {
    throw new Error(
      `Core foundation startup validation failed: ${issues.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicCoreFoundationHealthSummary() {
  const flags = getCoreFoundationFeatureFlags();
  const issues = getCoreFoundationValidationIssues();
  return {
    enabled_features: Object.entries(flags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length
  };
}

function assertCoreFoundationDiagnosticsAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Only leadership or audit admins can review core foundation diagnostics.");
  }
}

async function loadRecentFoundationEvents(client: PoolClient, auth: AuthUser, limit: number): Promise<AuditEventListItem[]> {
  const { rows } = await client.query<AuditEventListItem>(
    `
      SELECT
        audit.id::text,
        audit.tenant_id::text,
        audit.actor_user_id::text,
        actor.full_name AS actor_name,
        audit.event_category,
        audit.event_type,
        audit.resource_type,
        audit.resource_id,
        audit.target_user_id::text,
        target_user.full_name AS target_name,
        audit.department_type::text AS department_type,
        audit.request_id,
        audit.trace_id,
        audit.old_values_json,
        audit.new_values_json,
        audit.context_json,
        audit.result,
        audit.created_at::text,
        concat(audit.event_category, ' / ', audit.event_type) AS message
      FROM audit_events audit
      LEFT JOIN app_user actor
        ON actor.tenant_id = audit.tenant_id
       AND actor.id = audit.actor_user_id
      LEFT JOIN app_user target_user
        ON target_user.tenant_id = audit.tenant_id
       AND target_user.id = audit.target_user_id
      WHERE audit.tenant_id = $1
        AND audit.event_category = ANY($2::text[])
      ORDER BY audit.created_at DESC
      LIMIT $3
    `,
    [auth.tenantId, FOUNDATION_EVENT_CATEGORIES, Math.min(Math.max(limit, 1), 50)]
  );

  return rows;
}

async function loadLastEventAtByArea(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ event_category: string; last_event_at: string | null }>(
    `
      SELECT
        audit.event_category,
        max(audit.created_at)::text AS last_event_at
      FROM audit_events audit
      WHERE audit.tenant_id = $1
        AND audit.event_category = ANY($2::text[])
      GROUP BY audit.event_category
    `,
    [tenantId, FOUNDATION_EVENT_CATEGORIES]
  );

  const map = new Map<CoreFoundationArea, string | null>();
  for (const row of rows) {
    map.set(mapCategoryToArea(row.event_category), row.last_event_at ?? null);
  }
  return map;
}

async function loadSearchCoverage(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<SearchCoverageRow>(
    `
      WITH base(entity_type, base_count) AS (
        SELECT 'shoot', count(*)::bigint FROM jobs WHERE tenant_id = $1
        UNION ALL
        SELECT 'organization', count(*)::bigint FROM organization WHERE tenant_id = $1
        UNION ALL
        SELECT 'location', count(*)::bigint FROM shoot_location WHERE tenant_id = $1
        UNION ALL
        SELECT 'contact', count(*)::bigint FROM organization_contact WHERE tenant_id = $1
        UNION ALL
        SELECT 'staffing_assignment', count(*)::bigint FROM job_staff_assignments WHERE tenant_id = $1
        UNION ALL
        SELECT 'task', count(*)::bigint FROM work_task WHERE tenant_id = $1
        UNION ALL
        SELECT 'production_item', count(*)::bigint FROM production_items WHERE tenant_id = $1
        UNION ALL
        SELECT 'resource_library_item', count(*)::bigint FROM resource_library_item WHERE tenant_id = $1
      ),
      idx AS (
        SELECT entity_type::text AS entity_type, count(*)::bigint AS index_count
        FROM global_search_index
        WHERE tenant_id = $1
        GROUP BY entity_type
      )
      SELECT
        base.entity_type,
        base.base_count::text,
        COALESCE(idx.index_count, 0)::text AS index_count
      FROM base
      LEFT JOIN idx
        ON idx.entity_type = base.entity_type
    `,
    [tenantId]
  );
  return rows;
}

async function loadReportingColumnSupport(client: PoolClient) {
  const { rows } = await client.query<{ jobs_completed_at: boolean; work_task_completed_at: boolean }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'jobs'
            AND column_name = 'completed_at'
        ) AS jobs_completed_at,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'work_task'
            AND column_name = 'completed_at'
        ) AS work_task_completed_at
    `
  );
  return {
    jobsCompletedAt: Boolean(rows[0]?.jobs_completed_at),
    workTaskCompletedAt: Boolean(rows[0]?.work_task_completed_at)
  };
}

async function loadCoreFoundationTableSupport(client: PoolClient): Promise<CoreFoundationTableSupport> {
  const { rows } = await client.query<{ policy_decision_trace_exists: boolean }>(
    `
      SELECT
        to_regclass('public.policy_decision_trace') IS NOT NULL AS policy_decision_trace_exists
    `
  );

  return {
    policyDecisionTrace: Boolean(rows[0]?.policy_decision_trace_exists)
  };
}

export async function getCoreFoundationDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<CoreFoundationDiagnosticsPayload> {
  assertCoreFoundationDiagnosticsAccess(auth);
  const flags = getCoreFoundationFeatureFlags();
  const issues = getCoreFoundationValidationIssues();
  const lastEventByArea = await loadLastEventAtByArea(client, auth.tenantId);
  const reportingColumnSupport = await loadReportingColumnSupport(client);
  const tableSupport = await loadCoreFoundationTableSupport(client);

  const integrityFindingCounts = await client.query<CountRow>(
    `
      SELECT
        count(*) FILTER (WHERE severity = 'critical'::diagnostic_severity_type AND status IN ('open','acknowledged','in_review'))::text AS critical_count,
        count(*) FILTER (WHERE severity = 'high'::diagnostic_severity_type AND status IN ('open','acknowledged','in_review'))::text AS high_count,
        count(*) FILTER (WHERE status IN ('open','acknowledged','in_review'))::text AS open_count,
        max(detected_at)::text AS last_detected_at
      FROM diagnostic_findings
      WHERE tenant_id = $1
        AND (rule_key LIKE 'core_data.%' OR rule_key LIKE 'data_integrity.%')
    `,
    [auth.tenantId]
  );
  const workflowFindingCounts = await client.query<CountRow>(
    `
      SELECT
        count(*) FILTER (WHERE severity = 'critical'::diagnostic_severity_type AND status IN ('open','acknowledged','in_review'))::text AS critical_count,
        count(*) FILTER (WHERE severity = 'high'::diagnostic_severity_type AND status IN ('open','acknowledged','in_review'))::text AS high_count,
        count(*) FILTER (WHERE status IN ('open','acknowledged','in_review'))::text AS open_count,
        max(detected_at)::text AS last_detected_at
      FROM diagnostic_findings
      WHERE tenant_id = $1
        AND (rule_key LIKE 'workflow_gap.%' OR rule_key LIKE 'status_drift.%')
    `,
    [auth.tenantId]
  );
  const permissionCounts = tableSupport.policyDecisionTrace
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (
              WHERE app_member.status = 'active'
                AND NOT EXISTS (
                  SELECT 1
                  FROM user_role_assignment assignment
                  WHERE assignment.tenant_id = app_member.tenant_id
                    AND assignment.user_id = app_member.id
                    AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
                    AND (assignment.ends_at IS NULL OR assignment.ends_at > now())
                )
            )::text AS users_missing_roles,
            count(*) FILTER (WHERE app_member.status = 'active')::text AS active_users,
            (
              SELECT count(*)::text
              FROM policy_decision_trace trace
              WHERE trace.tenant_id = $1
                AND trace.decision = 'denied'
                AND trace.created_at >= now() - interval '7 days'
            ) AS denied_policy_decisions,
            (
              SELECT max(trace.created_at)::text
              FROM policy_decision_trace trace
              WHERE trace.tenant_id = $1
            ) AS last_trace_at
          FROM app_user app_member
          WHERE app_member.tenant_id = $1
        `,
        [auth.tenantId]
      )
    : await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (
              WHERE app_member.status = 'active'
                AND NOT EXISTS (
                  SELECT 1
                  FROM user_role_assignment assignment
                  WHERE assignment.tenant_id = app_member.tenant_id
                    AND assignment.user_id = app_member.id
                    AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
                    AND (assignment.ends_at IS NULL OR assignment.ends_at > now())
                )
            )::text AS users_missing_roles,
            count(*) FILTER (WHERE app_member.status = 'active')::text AS active_users,
            '0'::text AS denied_policy_decisions,
            NULL::text AS last_trace_at
          FROM app_user app_member
          WHERE app_member.tenant_id = $1
        `,
        [auth.tenantId]
      );
  const notificationCounts = await client.query<CountRow>(
    `
      SELECT
        count(*) FILTER (
          WHERE dispatch_status = 'queued'::operational_event_delivery_status
            AND created_at < now() - interval '15 minutes'
        )::text AS stuck_queued,
        count(*) FILTER (
          WHERE dispatch_status = 'throttled'::operational_event_delivery_status
            AND created_at >= now() - interval '7 days'
        )::text AS throttled_recent,
        count(*) FILTER (
          WHERE dispatch_status = 'dispatched'::operational_event_delivery_status
            AND created_at >= now() - interval '7 days'
        )::text AS dispatched_recent,
        max(updated_at)::text AS last_updated_at
      FROM operational_event_delivery
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );
  const searchCoverage = await loadSearchCoverage(client, auth.tenantId);
  const activityCounts = await client.query<CountRow>(
    `
      SELECT
        (
          SELECT count(*)::text
          FROM jobs job
          WHERE job.tenant_id = $1
            AND job.created_at >= now() - interval '30 days'
            AND NOT EXISTS (
              SELECT 1
              FROM activity_log_entries entry
              WHERE entry.tenant_id = job.tenant_id
                AND entry.job_id = job.id
            )
        ) AS recent_jobs_without_activity,
        (
          SELECT count(*)::text
          FROM operational_approval_request request
          WHERE request.tenant_id = $1
            AND request.created_at >= now() - interval '30 days'
            AND NOT EXISTS (
              SELECT 1
              FROM operational_approval_event event
              WHERE event.tenant_id = request.tenant_id
                AND event.approval_request_id = request.id
            )
        ) AS approvals_without_events,
        (
          SELECT max(entry.created_at)::text
          FROM activity_log_entries entry
          WHERE entry.tenant_id = $1
        ) AS last_activity_at
    `,
    [auth.tenantId]
  );
  const adminConfigCounts = await client.query<CountRow>(
    `
      SELECT
        count(*) FILTER (WHERE status = 'pending_approval'::admin_setting_status)::text AS pending_approval_count,
        count(*) FILTER (
          WHERE status = 'approved'::admin_setting_status
            AND is_override = true
            AND expires_at IS NOT NULL
            AND expires_at < now()
        )::text AS expired_override_count,
        count(*) FILTER (
          WHERE status = 'approved'::admin_setting_status
            AND effective_at > now()
        )::text AS scheduled_future_count,
        max(updated_at)::text AS last_change_at
      FROM admin_setting_value
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );
  const approvalCounts = await client.query<CountRow>(
    `
      SELECT
        count(*) FILTER (
          WHERE status IN ('pending','needs_clarification')
            AND (overdue_at IS NOT NULL OR (sla_due_at IS NOT NULL AND sla_due_at < now()))
        )::text AS overdue_count,
        count(*) FILTER (
          WHERE status IN ('pending','needs_clarification')
            AND escalation_level > 0
        )::text AS escalated_count,
        count(*) FILTER (
          WHERE status = 'pending'
            AND blocking = true
        )::text AS blocking_pending_count,
        max(updated_at)::text AS last_updated_at
      FROM operational_approval_request
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );
  const reportingCounts = await client.query<CountRow>(
    `
      SELECT
        (
          SELECT count(*)::text
          FROM jobs job
          WHERE job.tenant_id = $1
            AND job.job_status = 'execution_complete'::job_status_type
            AND ${reportingColumnSupport.jobsCompletedAt ? "job.completed_at IS NULL" : "true"}
        ) AS jobs_missing_completed_at,
        (
          SELECT count(*)::text
          FROM work_task task
          WHERE task.tenant_id = $1
            AND task.status = 'completed'::work_task_status_type
            AND ${reportingColumnSupport.workTaskCompletedAt ? "task.completed_at IS NULL" : "true"}
        ) AS tasks_missing_completed_at,
        (
          SELECT count(*)::text
          FROM audit_events audit
          WHERE audit.tenant_id = $1
            AND audit.event_category = 'reporting_foundation'
            AND audit.result = 'error'
            AND audit.created_at >= now() - interval '7 days'
        ) AS recent_reporting_failures,
        (
          SELECT max(audit.created_at)::text
          FROM audit_events audit
          WHERE audit.tenant_id = $1
            AND audit.event_category = 'reporting_foundation'
        ) AS last_reporting_event_at
    `,
    [auth.tenantId]
  );
  const recentEvents = await loadRecentFoundationEvents(client, auth, 20);

  const integrityOpenCount = countValue(integrityFindingCounts.rows[0], "open_count");
  const integrityCriticalCount = countValue(integrityFindingCounts.rows[0], "critical_count");
  const workflowOpenCount = countValue(workflowFindingCounts.rows[0], "open_count");
  const workflowCriticalCount = countValue(workflowFindingCounts.rows[0], "critical_count");
  const missingRoleCount = countValue(permissionCounts.rows[0], "users_missing_roles");
  const deniedPolicyCount = countValue(permissionCounts.rows[0], "denied_policy_decisions");
  const stuckQueuedCount = countValue(notificationCounts.rows[0], "stuck_queued");
  const throttledRecentCount = countValue(notificationCounts.rows[0], "throttled_recent");
  const dispatchedRecentCount = countValue(notificationCounts.rows[0], "dispatched_recent");
  const recentJobsWithoutActivity = countValue(activityCounts.rows[0], "recent_jobs_without_activity");
  const approvalsWithoutEvents = countValue(activityCounts.rows[0], "approvals_without_events");
  const pendingAdminChanges = countValue(adminConfigCounts.rows[0], "pending_approval_count");
  const expiredOverrides = countValue(adminConfigCounts.rows[0], "expired_override_count");
  const overdueApprovals = countValue(approvalCounts.rows[0], "overdue_count");
  const escalatedApprovals = countValue(approvalCounts.rows[0], "escalated_count");
  const blockingApprovals = countValue(approvalCounts.rows[0], "blocking_pending_count");
  const jobsMissingCompletedAt = countValue(reportingCounts.rows[0], "jobs_missing_completed_at");
  const tasksMissingCompletedAt = countValue(reportingCounts.rows[0], "tasks_missing_completed_at");
  const recentReportingFailures = countValue(reportingCounts.rows[0], "recent_reporting_failures");

  const criticalCoverageGaps = searchCoverage.filter((row) => Number(row.base_count) > 0 && Number(row.index_count) === 0);
  const partialCoverageGaps = searchCoverage.filter((row) => Number(row.base_count) > Number(row.index_count) && Number(row.index_count) > 0);

  const healthChecks: CoreFoundationHealthCheck[] = [
    buildHealthCheck("data_model_integrity", {
      enabled: true,
      status: integrityCriticalCount > 0 ? "failing" : integrityOpenCount > 0 ? "warning" : "healthy",
      summary:
        integrityOpenCount > 0
          ? `${integrityOpenCount} open data integrity finding${integrityOpenCount === 1 ? "" : "s"} need review.`
          : "No open data model integrity findings are active.",
      detailCount: integrityOpenCount,
      lastEventAt: integrityFindingCounts.rows[0]?.last_detected_at ?? null,
      details: {
        critical_count: integrityCriticalCount,
        high_count: countValue(integrityFindingCounts.rows[0], "high_count")
      }
    }),
    buildHealthCheck("permissions", {
      enabled: true,
      status: missingRoleCount > 0 ? "failing" : !tableSupport.policyDecisionTrace || deniedPolicyCount > 25 ? "warning" : "healthy",
      summary:
        missingRoleCount > 0
          ? `${missingRoleCount} active user${missingRoleCount === 1 ? "" : "s"} do not have an active shared role assignment.`
          : !tableSupport.policyDecisionTrace
            ? "Shared role assignments are healthy, but policy decision trace storage is not available in this environment."
          : deniedPolicyCount > 25
            ? `${deniedPolicyCount} access denials were traced in the last 7 days.`
            : "Shared roles and policy traces look healthy.",
      detailCount: missingRoleCount + deniedPolicyCount,
      lastEventAt: permissionCounts.rows[0]?.last_trace_at ?? null,
      details: {
        policy_trace_available: tableSupport.policyDecisionTrace,
        missing_role_assignments: missingRoleCount,
        active_users: countValue(permissionCounts.rows[0], "active_users"),
        denied_policy_decisions_7d: deniedPolicyCount
      }
    }),
    buildHealthCheck("workflow_engine", {
      enabled: flags.workflow_engine_enabled,
      status: workflowCriticalCount > 0 ? "failing" : workflowOpenCount > 0 ? "warning" : "healthy",
      summary:
        workflowOpenCount > 0
          ? `${workflowOpenCount} open workflow/status drift finding${workflowOpenCount === 1 ? "" : "s"} are active.`
          : "Workflow blockers and drift checks look stable.",
      detailCount: workflowOpenCount,
      lastEventAt: workflowFindingCounts.rows[0]?.last_detected_at ?? null,
      details: {
        critical_count: workflowCriticalCount,
        high_count: countValue(workflowFindingCounts.rows[0], "high_count")
      }
    }),
    buildHealthCheck("notification_event_engine", {
      enabled: flags.operational_events_enabled,
      status: stuckQueuedCount > 0 ? "failing" : throttledRecentCount > 30 ? "warning" : "healthy",
      summary:
        stuckQueuedCount > 0
          ? `${stuckQueuedCount} notification delivery${stuckQueuedCount === 1 ? " is" : "ies are"} queued past the safe threshold.`
          : throttledRecentCount > 30
            ? `${throttledRecentCount} operational event deliveries were throttled in the last 7 days.`
            : "Operational event delivery looks healthy.",
      detailCount: stuckQueuedCount + throttledRecentCount,
      lastEventAt: notificationCounts.rows[0]?.last_updated_at ?? null,
      details: {
        stuck_queued_deliveries: stuckQueuedCount,
        throttled_deliveries_7d: throttledRecentCount,
        dispatched_deliveries_7d: dispatchedRecentCount
      }
    }),
    buildHealthCheck("search", {
      enabled: flags.global_search_enabled,
      status: criticalCoverageGaps.length > 0 ? "failing" : partialCoverageGaps.length > 0 ? "warning" : "healthy",
      summary:
        criticalCoverageGaps.length > 0
          ? `${criticalCoverageGaps.length} core search domain${criticalCoverageGaps.length === 1 ? "" : "s"} have source records but no index coverage.`
          : partialCoverageGaps.length > 0
            ? `${partialCoverageGaps.length} search domain${partialCoverageGaps.length === 1 ? "" : "s"} have partial index coverage.`
            : "Search index coverage is present for all core domains.",
      detailCount: criticalCoverageGaps.length + partialCoverageGaps.length,
      lastEventAt: lastEventByArea.get("search") ?? null,
      details: {
        coverage: searchCoverage.map((row) => ({
          entity_type: row.entity_type,
          base_count: Number(row.base_count),
          index_count: Number(row.index_count)
        }))
      }
    }),
    buildHealthCheck("activity_history", {
      enabled: flags.activity_timeline_enabled,
      status: approvalsWithoutEvents > 0 ? "failing" : recentJobsWithoutActivity > 0 ? "warning" : "healthy",
      summary:
        approvalsWithoutEvents > 0
          ? `${approvalsWithoutEvents} recent approval${approvalsWithoutEvents === 1 ? "" : "s"} are missing approval-event history.`
          : recentJobsWithoutActivity > 0
            ? `${recentJobsWithoutActivity} recent job${recentJobsWithoutActivity === 1 ? "" : "s"} have no activity log entries yet.`
            : "Activity and timeline sources look healthy.",
      detailCount: approvalsWithoutEvents + recentJobsWithoutActivity,
      lastEventAt: activityCounts.rows[0]?.last_activity_at ?? null,
      details: {
        recent_jobs_without_activity: recentJobsWithoutActivity,
        recent_approvals_without_events: approvalsWithoutEvents
      }
    }),
    buildHealthCheck("admin_configuration", {
      enabled: flags.admin_configuration_enabled,
      status: expiredOverrides > 5 ? "failing" : pendingAdminChanges > 0 || expiredOverrides > 0 ? "warning" : "healthy",
      summary:
        expiredOverrides > 0
          ? `${expiredOverrides} expired admin override${expiredOverrides === 1 ? "" : "s"} still need cleanup.`
          : pendingAdminChanges > 0
            ? `${pendingAdminChanges} admin config change${pendingAdminChanges === 1 ? "" : "s"} are awaiting approval.`
            : "Admin configuration state is clean.",
      detailCount: pendingAdminChanges + expiredOverrides,
      lastEventAt: adminConfigCounts.rows[0]?.last_change_at ?? lastEventByArea.get("admin_configuration") ?? null,
      details: {
        pending_approval_count: pendingAdminChanges,
        expired_override_count: expiredOverrides,
        scheduled_future_count: countValue(adminConfigCounts.rows[0], "scheduled_future_count")
      }
    }),
    buildHealthCheck("approvals", {
      enabled: flags.approval_framework_enabled,
      status: overdueApprovals > 0 ? "failing" : escalatedApprovals > 0 || blockingApprovals > 0 ? "warning" : "healthy",
      summary:
        overdueApprovals > 0
          ? `${overdueApprovals} approval${overdueApprovals === 1 ? "" : "s"} are overdue.`
          : escalatedApprovals > 0
            ? `${escalatedApprovals} approval${escalatedApprovals === 1 ? "" : "s"} have escalated.`
            : "Approval routing and SLAs look healthy.",
      detailCount: overdueApprovals + escalatedApprovals + blockingApprovals,
      lastEventAt: approvalCounts.rows[0]?.last_updated_at ?? lastEventByArea.get("approvals") ?? null,
      details: {
        overdue_count: overdueApprovals,
        escalated_count: escalatedApprovals,
        blocking_pending_count: blockingApprovals
      }
    }),
    buildHealthCheck("reporting_services", {
      enabled: flags.reporting_enabled,
      status: recentReportingFailures > 0 ? "failing" : jobsMissingCompletedAt > 0 || tasksMissingCompletedAt > 0 ? "warning" : "healthy",
      summary:
        recentReportingFailures > 0
          ? `${recentReportingFailures} reporting request${recentReportingFailures === 1 ? "" : "s"} failed in the last 7 days.`
          : jobsMissingCompletedAt > 0 || tasksMissingCompletedAt > 0
            ? "Reporting still relies on some fallback completion timing for historical records."
            : "Reporting foundation metrics look healthy.",
      detailCount: recentReportingFailures + jobsMissingCompletedAt + tasksMissingCompletedAt,
      lastEventAt: reportingCounts.rows[0]?.last_reporting_event_at ?? lastEventByArea.get("reporting_services") ?? null,
      details: {
        recent_reporting_failures: recentReportingFailures,
        completed_jobs_missing_completed_at: jobsMissingCompletedAt,
        completed_tasks_missing_completed_at: tasksMissingCompletedAt
      }
    }),
    buildHealthCheck("config", {
      enabled: true,
      status: issues.some((issue) => issue.severity === "error") ? "failing" : issues.length > 0 ? "warning" : "healthy",
      summary:
        issues.length > 0
          ? `${issues.length} startup validation issue${issues.length === 1 ? "" : "s"} should be reviewed.`
          : "Core foundation startup validation passed.",
      detailCount: issues.length,
      details: {
        issues
      }
    })
  ];

  return {
    generated_at: new Date().toISOString(),
    feature_flags: flags,
    startup_validation: {
      valid: issues.every((issue) => issue.severity !== "error"),
      issues
    },
    health_checks: healthChecks,
    recent_events: recentEvents
  };
}
