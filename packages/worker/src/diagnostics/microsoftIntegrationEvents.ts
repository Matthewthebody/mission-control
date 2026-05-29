import type { PoolClient } from "pg";

type MicrosoftIntegrationArea =
  | "auth"
  | "account_linking"
  | "outlook_calendar_sync"
  | "mail_automation"
  | "sms_automation"
  | "teams_alerts"
  | "teams_search"
  | "teams_personal_app"
  | "config";

type MicrosoftIntegrationEventLevel = "info" | "warning" | "error";
type SyncHealthStatus = "healthy" | "warning" | "error";

export async function recordWorkerMicrosoftIntegrationEvent(
  client: PoolClient,
  input: {
    tenantId?: string | null;
    area: MicrosoftIntegrationArea;
    level: MicrosoftIntegrationEventLevel;
    eventType: string;
    eventStatus?: string;
    summary: string;
    detail?: Record<string, unknown>;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    externalTarget?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO microsoft_integration_event (
        tenant_id,
        integration_area,
        event_level,
        event_type,
        event_status,
        summary,
        detail,
        trace_id,
        related_entity_type,
        related_entity_id,
        external_target
      )
      VALUES ($1,$2::microsoft_integration_area,$3::microsoft_integration_event_level,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
    `,
    [
      input.tenantId ?? null,
      input.area,
      input.level,
      input.eventType,
      input.eventStatus ?? "observed",
      input.summary,
      JSON.stringify(input.detail ?? {}),
      [input.area, input.eventType, input.relatedEntityType ?? "resource", input.relatedEntityId ?? "record"].join(":"),
      input.relatedEntityType ?? null,
      input.relatedEntityId ?? null,
      input.externalTarget ?? null
    ]
  );
}

export async function writeWorkerMicrosoftExternalAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    eventCategory: string;
    eventType: string;
    resourceType: string;
    resourceId?: string | null;
    result: string;
    context?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO audit_events (
        tenant_id,
        actor_user_id,
        event_category,
        event_type,
        resource_type,
        resource_id,
        target_user_id,
        department_type,
        request_id,
        trace_id,
        old_values_json,
        new_values_json,
        context_json,
        result
      )
      VALUES ($1,NULL,$2,$3,$4,$5,NULL,NULL,NULL,$6,NULL,NULL,$7::jsonb,$8)
    `,
    [
      input.tenantId,
      input.eventCategory,
      input.eventType,
      input.resourceType,
      input.resourceId ?? null,
      [input.eventCategory, input.eventType, input.resourceType, input.resourceId ?? "record"].join(":"),
      JSON.stringify(input.context ?? {}),
      input.result
    ]
  );
}

export async function upsertWorkerSyncHealthRecord(
  client: PoolClient,
  input: {
    tenantId: string;
    syncKey: string;
    resourceType?: string | null;
    resourceId?: string | null;
    status: SyncHealthStatus;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const existing = await client.query<{
    id: string;
    failure_count: number;
    last_success_at: string | null;
    last_failure_at: string | null;
  }>(
    `
      SELECT
        id::text,
        failure_count,
        last_success_at::text,
        last_failure_at::text
      FROM sync_health_records
      WHERE tenant_id = $1
        AND sync_key = $2
        AND COALESCE(resource_type, '') = COALESCE($3, '')
        AND COALESCE(resource_id, '') = COALESCE($4, '')
      LIMIT 1
    `,
    [input.tenantId, input.syncKey, input.resourceType ?? null, input.resourceId ?? null]
  );

  const now = new Date().toISOString();
  const nextFailureCount = input.status === "healthy" ? 0 : (existing.rows[0]?.failure_count ?? 0) + 1;
  const nextLastSuccessAt = input.status === "healthy" ? now : existing.rows[0]?.last_success_at ?? null;
  const nextLastFailureAt = input.status === "healthy" ? existing.rows[0]?.last_failure_at ?? null : now;
  const metadataJson = JSON.stringify(input.metadata ?? {});

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE sync_health_records
        SET
          status = $3::sync_health_status_type,
          last_success_at = $4::timestamptz,
          last_failure_at = $5::timestamptz,
          failure_count = $6,
          last_error_code = $7,
          last_error_message = $8,
          metadata_json = $9::jsonb,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [
        input.tenantId,
        existing.rows[0].id,
        input.status,
        nextLastSuccessAt,
        nextLastFailureAt,
        nextFailureCount,
        input.lastErrorCode ?? null,
        input.lastErrorMessage ?? null,
        metadataJson
      ]
    );
    return;
  }

  await client.query(
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
      VALUES ($1,$2,$3,$4,$5::sync_health_status_type,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11::jsonb)
    `,
    [
      input.tenantId,
      input.syncKey,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.status,
      nextLastSuccessAt,
      nextLastFailureAt,
      nextFailureCount,
      input.lastErrorCode ?? null,
      input.lastErrorMessage ?? null,
      metadataJson
    ]
  );
}
