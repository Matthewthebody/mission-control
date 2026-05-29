import type { PoolClient } from "pg";
import { createAuditLog } from "../audit.js";

type ActivityInput = {
  tenantId: string;
  jobId?: string | null;
  jobDayId?: string | null;
  productionItemId?: string | null;
  watchFlagId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
  departmentType?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  parentResourceType?: string | null;
  parentResourceId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  visibilityLevel?: string | null;
  sourceSurface?: string | null;
};

export async function writeJobActivity(client: PoolClient, input: ActivityInput) {
  const resourceType =
    input.resourceType ??
    (input.productionItemId ? "production_item" : input.watchFlagId ? "job_watch_flag" : input.jobDayId ? "job_day" : "job");
  const resourceId = input.resourceId ?? input.productionItemId ?? input.watchFlagId ?? input.jobDayId ?? input.jobId ?? null;
  const parentResourceType =
    input.parentResourceType ?? (input.jobId && resourceType !== "job" ? "job" : null);
  const parentResourceId = input.parentResourceId ?? (input.jobId && resourceType !== "job" ? input.jobId : null);
  const { rows } = await client.query(
    `
      INSERT INTO activity_log_entries (
        tenant_id,
        job_id,
        job_day_id,
        production_item_id,
        watch_flag_id,
        actor_user_id,
        event_type,
        summary,
        metadata,
        resource_type,
        resource_id,
        parent_resource_type,
        parent_resource_id,
        department_type,
        message,
        old_values_json,
        new_values_json,
        metadata_json,
        visibility_level
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::job_department_type,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19)
      RETURNING *
    `,
    [
      input.tenantId,
      input.jobId ?? null,
      input.jobDayId ?? null,
      input.productionItemId ?? null,
      input.watchFlagId ?? null,
      input.actorUserId ?? null,
      input.eventType,
      input.summary,
      JSON.stringify(input.metadata ?? {}),
      resourceType,
      resourceId,
      parentResourceType,
      parentResourceId,
      input.departmentType ?? null,
      input.summary,
      input.oldValues == null ? null : JSON.stringify(input.oldValues),
      input.newValues == null ? null : JSON.stringify(input.newValues),
      JSON.stringify(input.metadata ?? {}),
      input.visibilityLevel ?? "standard_internal"
    ]
  );

  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: `job_truth.${input.eventType}`,
    entityType: resourceType,
    entityId: resourceId,
    metadata: {
      job_id: input.jobId ?? null,
      job_day_id: input.jobDayId ?? null,
      production_item_id: input.productionItemId ?? null,
      watch_flag_id: input.watchFlagId ?? null,
      resource_type: resourceType,
      resource_id: resourceId,
      parent_resource_type: parentResourceType,
      parent_resource_id: parentResourceId,
      activity_summary: input.summary,
      ...(input.metadata ?? {})
    },
    previousValues: input.oldValues ?? undefined,
    newValues: input.newValues ?? undefined,
    sourceSurface: input.sourceSurface ?? "job_truth_layer"
  });

  return rows[0];
}
