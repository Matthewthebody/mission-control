import type { PoolClient } from "pg";
import type { EntityTraceResponse, TraceTimelineItem } from "../../types/diagnostics.js";

type ResourceDescriptor = {
  label: string;
  parentJobId?: string | null;
};

async function describeResource(client: PoolClient, tenantId: string, resourceType: string, resourceId: string): Promise<ResourceDescriptor> {
  switch (resourceType) {
    case "job": {
      const result = await client.query<{ label: string }>(
        `
          SELECT coalesce(job_number, title, event_name, 'Job') AS label
          FROM jobs
          WHERE tenant_id = $1
            AND id = $2::uuid
          LIMIT 1
        `,
        [tenantId, resourceId]
      );
      return { label: result.rows[0]?.label ?? `Job ${resourceId}` };
    }
    case "job_day": {
      const result = await client.query<{ label: string; job_id: string | null }>(
        `
          SELECT concat(coalesce(day_label, 'Job day'), ' - ', date::text) AS label, job_id::text
          FROM job_days
          WHERE tenant_id = $1
            AND id = $2::uuid
          LIMIT 1
        `,
        [tenantId, resourceId]
      );
      return { label: result.rows[0]?.label ?? `Job day ${resourceId}`, parentJobId: result.rows[0]?.job_id ?? null };
    }
    case "production_item": {
      const result = await client.query<{ label: string; job_id: string | null }>(
        `
          SELECT title AS label, job_id::text
          FROM production_items
          WHERE tenant_id = $1
            AND id = $2::uuid
          LIMIT 1
        `,
        [tenantId, resourceId]
      );
      return { label: result.rows[0]?.label ?? `Production item ${resourceId}`, parentJobId: result.rows[0]?.job_id ?? null };
    }
    default:
      return { label: `${resourceType.replace(/_/g, " ")} ${resourceId}` };
  }
}

export async function getEntityTrace(
  client: PoolClient,
  tenantId: string,
  resourceType: string,
  resourceId: string
): Promise<EntityTraceResponse> {
  const resource = await describeResource(client, tenantId, resourceType, resourceId);

  const activityRows = await client.query<TraceTimelineItem>(
    `
      SELECT
        entry.id::text,
        'activity' AS kind,
        entry.created_at,
        entry.event_type AS title,
        coalesce(entry.message, entry.summary) AS message,
        actor.full_name AS actor_name,
        NULL::text AS severity,
        NULL::text AS status,
        entry.resource_type,
        entry.resource_id,
        entry.old_values_json,
        entry.new_values_json,
        coalesce(entry.metadata_json, entry.metadata) AS metadata_json
      FROM activity_log_entries entry
      LEFT JOIN app_user actor ON actor.id = entry.actor_user_id AND actor.tenant_id = entry.tenant_id
      WHERE entry.tenant_id = $1
        AND (
          (entry.resource_type = $2 AND entry.resource_id = $3)
          OR (entry.parent_resource_type = $2 AND entry.parent_resource_id = $3)
        )
    `,
    [tenantId, resourceType, resourceId]
  );

  let auditRows = await client.query<TraceTimelineItem>(
    `
      SELECT
        event.id::text,
        'audit' AS kind,
        event.created_at,
        event.event_type AS title,
        concat(event.event_category, ': ', event.result) AS message,
        actor.full_name AS actor_name,
        NULL::text AS severity,
        event.result AS status,
        event.resource_type,
        event.resource_id,
        event.old_values_json,
        event.new_values_json,
        event.context_json AS metadata_json
      FROM audit_events event
      LEFT JOIN app_user actor ON actor.id = event.actor_user_id AND actor.tenant_id = event.tenant_id
      WHERE event.tenant_id = $1
        AND event.resource_type = $2
        AND event.resource_id = $3
    `,
    [tenantId, resourceType, resourceId]
  );

  if (auditRows.rows.length === 0) {
    auditRows = await client.query<TraceTimelineItem>(
      `
        SELECT
          legacy.id::text,
          'audit' AS kind,
          legacy.created_at,
          legacy.action AS title,
          concat('legacy audit: ', coalesce(legacy.result_status, 'succeeded')) AS message,
          actor.full_name AS actor_name,
          NULL::text AS severity,
          legacy.result_status AS status,
          legacy.entity_type AS resource_type,
          legacy.entity_id AS resource_id,
          legacy.previous_values AS old_values_json,
          legacy.new_values AS new_values_json,
          legacy.metadata AS metadata_json
        FROM audit_log legacy
        LEFT JOIN app_user actor ON actor.id = legacy.actor_user_id AND actor.tenant_id = legacy.tenant_id
        WHERE legacy.tenant_id = $1
          AND legacy.entity_type = $2
          AND legacy.entity_id = $3
      `,
      [tenantId, resourceType, resourceId]
    );
  }

  const findingRows = await client.query<TraceTimelineItem>(
    `
      SELECT
        finding.id::text,
        'finding' AS kind,
        finding.detected_at AS created_at,
        finding.title,
        finding.description AS message,
        owner.full_name AS actor_name,
        finding.severity::text AS severity,
        finding.status::text AS status,
        finding.resource_type,
        finding.resource_id,
        NULL::jsonb AS old_values_json,
        NULL::jsonb AS new_values_json,
        jsonb_build_object(
          'rule_key', finding.rule_key,
          'recommended_action', finding.recommended_action,
          'repairable', finding.repairable
        ) AS metadata_json
      FROM diagnostic_findings finding
      LEFT JOIN app_user owner ON owner.id = finding.owner_user_id AND owner.tenant_id = finding.tenant_id
      WHERE finding.tenant_id = $1
        AND (
          (finding.resource_type = $2 AND finding.resource_id = $3)
          OR (finding.related_resource_type = $2 AND finding.related_resource_id = $3)
        )
    `,
    [tenantId, resourceType, resourceId]
  );

  const repairRows = await client.query<TraceTimelineItem>(
    `
      SELECT
        repair.id::text,
        'repair' AS kind,
        repair.created_at,
        repair.action_key AS title,
        concat('Repair action ', replace(repair.status::text, '_', ' ')) AS message,
        actor.full_name AS actor_name,
        NULL::text AS severity,
        repair.status::text AS status,
        repair.resource_type,
        repair.resource_id,
        repair.before_snapshot_json AS old_values_json,
        repair.after_snapshot_json AS new_values_json,
        repair.result_summary_json AS metadata_json
      FROM repair_actions repair
      LEFT JOIN app_user actor ON actor.id = repair.executed_by_user_id AND actor.tenant_id = repair.tenant_id
      WHERE repair.tenant_id = $1
        AND repair.resource_type = $2
        AND repair.resource_id = $3
    `,
    [tenantId, resourceType, resourceId]
  );

  const alertRows =
    resourceType === "job"
      ? await client.query<TraceTimelineItem>(
          `
            SELECT
              alert.id::text,
              'alert' AS kind,
              alert.created_at,
              alert.title,
              alert.message,
              NULL::text AS actor_name,
              alert.severity::text AS severity,
              alert.status,
              alert.source_entity_type AS resource_type,
              alert.source_entity_id AS resource_id,
              NULL::jsonb AS old_values_json,
              NULL::jsonb AS new_values_json,
              alert.payload_json AS metadata_json
            FROM alert_events alert
            LEFT JOIN job_watch_flags flag ON flag.id = alert.watch_flag_id AND flag.tenant_id = alert.tenant_id
            WHERE alert.tenant_id = $1
              AND (
                (alert.source_entity_type = 'job' AND alert.source_entity_id = $2)
                OR flag.job_id = $2::uuid
              )
          `,
          [tenantId, resourceId]
        )
      : await client.query<TraceTimelineItem>(
          `
            SELECT
              alert.id::text,
              'alert' AS kind,
              alert.created_at,
              alert.title,
              alert.message,
              NULL::text AS actor_name,
              alert.severity::text AS severity,
              alert.status,
              alert.source_entity_type AS resource_type,
              alert.source_entity_id AS resource_id,
              NULL::jsonb AS old_values_json,
              NULL::jsonb AS new_values_json,
              alert.payload_json AS metadata_json
            FROM alert_events alert
            WHERE alert.tenant_id = $1
              AND alert.source_entity_type = $2
              AND alert.source_entity_id = $3
          `,
          [tenantId, resourceType, resourceId]
        );

  const policyRows = await client.query<TraceTimelineItem>(
    `
      SELECT
        trace.id::text,
        'policy' AS kind,
        trace.created_at,
        trace.permission_key AS title,
        trace.decision_reason AS message,
        actor.full_name AS actor_name,
        NULL::text AS severity,
        trace.decision AS status,
        trace.resource_type,
        trace.resource_id,
        NULL::jsonb AS old_values_json,
        NULL::jsonb AS new_values_json,
        jsonb_build_object(
          'scope_context', trace.scope_context_json,
          'matched_rules', trace.matched_rules_json
        ) AS metadata_json
      FROM policy_decision_traces trace
      LEFT JOIN app_user actor ON actor.id = trace.actor_user_id AND actor.tenant_id = trace.tenant_id
      WHERE trace.tenant_id = $1
        AND trace.resource_type = $2
        AND trace.resource_id = $3
    `,
    [tenantId, resourceType, resourceId]
  );

  const timeline = [
    ...activityRows.rows,
    ...auditRows.rows,
    ...findingRows.rows,
    ...repairRows.rows,
    ...alertRows.rows,
    ...policyRows.rows
  ].sort((left, right) => new Date(String(right.created_at)).getTime() - new Date(String(left.created_at)).getTime());

  return {
    resource_type: resourceType,
    resource_id: resourceId,
    resource_label: resource.label,
    timeline
  };
}
