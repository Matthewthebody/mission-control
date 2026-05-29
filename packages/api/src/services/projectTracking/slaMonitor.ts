import type { PoolClient } from "pg";
import { calculateStepTiming } from "./slaEngine.js";

type SlaScanRow = {
  tenant_id: string;
  step_id: string;
  workflow_run_id: string;
  job_id: string;
  step_key: string;
  step_name: string;
  department: string;
  assigned_user_id: string | null;
  status: string;
  expected_duration_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  last_transition_at: string | null;
  job_title: string;
  organization_name: string | null;
};

export type ProjectTrackingSlaSweepResult = {
  tenant_count: number;
  scanned_step_count: number;
  event_count: number;
  levels: Record<"early_warning" | "risk" | "urgent" | "overdue", number>;
};

function escalationTargets(level: string) {
  if (level === "overdue" || level === "urgent") {
    return ["assigned_user", "department_lead", "leadership"];
  }
  if (level === "risk") {
    return ["assigned_user", "department_lead"];
  }
  return ["assigned_user"];
}

export async function scanProjectTrackingSlaAlerts(
  client: PoolClient,
  input: { tenantId?: string | null; limit?: number; now?: Date } = {}
): Promise<ProjectTrackingSlaSweepResult> {
  const limit = Math.min(Math.max(input.limit ?? 250, 1), 1000);
  const now = input.now ?? new Date();
  const tenantIds =
    input.tenantId != null
      ? [{ id: input.tenantId }]
      : (
          await client.query<{ id: string }>(
            `
              SELECT id::text AS id
              FROM tenant
              ORDER BY created_at ASC
            `
          )
        ).rows;
  const result: ProjectTrackingSlaSweepResult = {
    tenant_count: tenantIds.length,
    scanned_step_count: 0,
    event_count: 0,
    levels: {
      early_warning: 0,
      risk: 0,
      urgent: 0,
      overdue: 0
    }
  };

  for (const tenant of tenantIds) {
    const { rows } = await client.query<SlaScanRow>(
      `
        SELECT
          step.tenant_id::text,
          step.id::text AS step_id,
          step.workflow_run_id::text,
          step.job_id::text,
          step.step_key,
          step.name AS step_name,
          step.department::text,
          step.assigned_user_id::text,
          step.status::text,
          step.expected_duration_minutes,
          step.started_at::text,
          step.completed_at::text,
          step.last_transition_at::text,
          job.title AS job_title,
          organization.display_name AS organization_name
        FROM workflow_step step
        JOIN jobs job ON job.id = step.job_id
        LEFT JOIN organization ON organization.id = job.organization_id
        WHERE step.tenant_id = $1
          AND step.started_at IS NOT NULL
          AND step.status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type)
        ORDER BY step.started_at ASC
        LIMIT $2
      `,
      [tenant.id, limit]
    );
    result.scanned_step_count += rows.length;

    for (const row of rows) {
      const timing = calculateStepTiming({
        status: row.status as Parameters<typeof calculateStepTiming>[0]["status"],
        expectedDurationMinutes: row.expected_duration_minutes,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        lastTransitionAt: row.last_transition_at,
        now
      });
      if (timing.alert_level === "none") {
        continue;
      }
      result.levels[timing.alert_level] += 1;
      const inserted = await client.query(
        `
          INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
          VALUES ($1, 'workflow.sla_alert_queued', 'workflow_step', $2, $3::jsonb, $4)
          ON CONFLICT (tenant_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL
          DO NOTHING
          RETURNING id
        `,
        [
          row.tenant_id,
          row.step_id,
          JSON.stringify({
          workflow_run_id: row.workflow_run_id,
          job_id: row.job_id,
          step_id: row.step_id,
          step_key: row.step_key,
          step_name: row.step_name,
          department: row.department,
          assigned_user_id: row.assigned_user_id,
          job_title: row.job_title,
          organization_name: row.organization_name,
          level: timing.alert_level,
          sla_percent: timing.sla_percent,
          elapsed_minutes: timing.elapsed_minutes,
          overdue_minutes: timing.overdue_minutes,
          escalation_targets: escalationTargets(timing.alert_level),
          dispatch_status: "queued_for_future_notification",
          source: "project_tracking_sla_monitor"
          }),
          `workflow:sla_alert:${row.step_id}:${timing.alert_level}`
        ]
      );
      if (inserted.rowCount && inserted.rowCount > 0) {
        result.event_count += 1;
      }
    }
  }

  return result;
}
