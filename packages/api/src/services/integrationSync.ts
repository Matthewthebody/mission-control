import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { createAppEvent } from "./outbox.js";
import { createAuditLog } from "./audit.js";

export type IntegrationProvider =
  | "outlook"
  | "monday"
  | "microsoft365_workspace"
  | "microsoft365_mail_automation"
  | "microsoft365_sms_automation";
export type SyncDirection = "outbound" | "inbound";
export type SyncOperationStatus = "pending" | "processing" | "succeeded" | "failed" | "conflict";

export type IntegrationSyncReplayScope = "full_history" | "date_range";

export type IntegrationSyncOperationRow = {
  id: string;
  tenant_id: string;
  provider: IntegrationProvider;
  direction: SyncDirection;
  entity_type: string;
  entity_id: string | null;
  external_object_type: string;
  external_id: string | null;
  operation_type: string;
  source_system: string;
  source_change_key: string | null;
  status: SyncOperationStatus;
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  triggered_by_user_id: string | null;
  payload: Record<string, unknown>;
  result_payload: Record<string, unknown>;
  message?: string | null;
  last_error: string | null;
  last_error_at: string | null;
  conflict_summary: string | null;
  conflict_payload: Record<string, unknown>;
  replay_of_operation_id: string | null;
  created_at: string;
  updated_at: string;
};

type IntegrationSyncAuditMode = "manual" | "automatic" | "sync-driven";

export async function queueIntegrationSyncOperation(
  client: PoolClient,
  input: {
    tenantId: string;
    provider: IntegrationProvider;
    direction: SyncDirection;
    entityType: string;
    entityId?: string | null;
    externalObjectType: string;
    externalId?: string | null;
    operationType: string;
    sourceSystem: string;
    sourceChangeKey?: string | null;
    triggeredByUserId?: string | null;
    payload?: Record<string, unknown>;
    replayOfOperationId?: string | null;
  }
) {
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      INSERT INTO integration_sync_operation (
        tenant_id, provider, direction, entity_type, entity_id, external_object_type, external_id,
        operation_type, source_system, source_change_key, triggered_by_user_id, payload, replay_of_operation_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
      RETURNING *
    `,
    [
      input.tenantId,
      input.provider,
      input.direction,
      input.entityType,
      input.entityId ?? null,
      input.externalObjectType,
      input.externalId ?? null,
      input.operationType,
      input.sourceSystem,
      input.sourceChangeKey ?? null,
      input.triggeredByUserId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.replayOfOperationId ?? null
    ]
  );

  const operation = rows[0];
  await createAppEvent(client, {
    tenantId: input.tenantId,
    eventType: "integration.sync.process",
    aggregateType: "integration_sync_operation",
    aggregateId: operation.id,
    dedupeKey: `integration-sync:${operation.provider}:${operation.direction}:${operation.id}:${operation.source_change_key ?? operation.id}`,
    payload: {
      sync_operation_id: operation.id,
      provider: operation.provider,
      direction: operation.direction
    }
  });

  return operation;
}

export async function getIntegrationSyncOperation(client: PoolClient, tenantId: string, operationId: string) {
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      SELECT *
      FROM integration_sync_operation
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, operationId]
  );
  return rows[0] ?? null;
}

async function writeSyncAuditLog(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    operationId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    provider: IntegrationProvider;
    direction: SyncDirection;
    operationType: string;
    sourceSystem: string;
    executionMode: IntegrationSyncAuditMode;
    metadata?: Record<string, unknown>;
  }
) {
  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: {
      integration_sync_operation_id: input.operationId,
      provider: input.provider,
      direction: input.direction,
      operation_type: input.operationType,
      source_system: input.sourceSystem,
      execution_mode: input.executionMode,
      ...(input.metadata ?? {})
    }
  });
}

export async function markIntegrationSyncOperationProcessing(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const operation = await getIntegrationSyncOperation(client, input.tenantId, input.operationId);
  if (!operation) {
    throw new ApiError(404, "Sync operation not found");
  }
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      UPDATE integration_sync_operation
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          last_attempt_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [input.operationId]
  );

  await writeSyncAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? operation.triggered_by_user_id ?? null,
    operationId: input.operationId,
    action: "integration.sync.processing",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    provider: operation.provider,
    direction: operation.direction,
    operationType: operation.operation_type,
    sourceSystem: operation.source_system,
    executionMode: "sync-driven",
    metadata: input.metadata ?? {}
  });

  return rows[0];
}

export async function markIntegrationSyncOperationSucceeded(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    actorUserId?: string | null;
    externalId?: string | null;
    resultPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
) {
  const operation = await getIntegrationSyncOperation(client, input.tenantId, input.operationId);
  if (!operation) {
    throw new ApiError(404, "Sync operation not found");
  }
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      UPDATE integration_sync_operation
      SET status = 'succeeded',
          external_id = COALESCE($2, external_id),
          result_payload = COALESCE(result_payload, '{}'::jsonb) || $3::jsonb,
          last_error = NULL,
          last_error_at = NULL,
          conflict_summary = NULL,
          conflict_payload = '{}'::jsonb,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [input.operationId, input.externalId ?? null, JSON.stringify(input.resultPayload ?? {})]
  );

  await writeSyncAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? operation.triggered_by_user_id ?? null,
    operationId: input.operationId,
    action: "integration.sync.succeeded",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    provider: operation.provider,
    direction: operation.direction,
    operationType: operation.operation_type,
    sourceSystem: operation.source_system,
    executionMode: "sync-driven",
    metadata: {
      external_id: input.externalId ?? operation.external_id ?? null,
      ...(input.metadata ?? {}),
      result_payload: input.resultPayload ?? {}
    }
  });

  return rows[0];
}

export async function markIntegrationSyncOperationFailed(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    actorUserId?: string | null;
    errorMessage: string;
    resultPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
) {
  const operation = await getIntegrationSyncOperation(client, input.tenantId, input.operationId);
  if (!operation) {
    throw new ApiError(404, "Sync operation not found");
  }
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      UPDATE integration_sync_operation
      SET status = 'failed',
          last_error = $2,
          last_error_at = now(),
          result_payload = COALESCE(result_payload, '{}'::jsonb) || $3::jsonb,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [input.operationId, input.errorMessage, JSON.stringify(input.resultPayload ?? {})]
  );

  await writeSyncAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? operation.triggered_by_user_id ?? null,
    operationId: input.operationId,
    action: "integration.sync.failed",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    provider: operation.provider,
    direction: operation.direction,
    operationType: operation.operation_type,
    sourceSystem: operation.source_system,
    executionMode: "sync-driven",
    metadata: {
      error: input.errorMessage,
      ...(input.metadata ?? {}),
      result_payload: input.resultPayload ?? {}
    }
  });

  return rows[0];
}

export async function markIntegrationSyncOperationConflict(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    actorUserId?: string | null;
    conflictSummary: string;
    conflictPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
) {
  const operation = await getIntegrationSyncOperation(client, input.tenantId, input.operationId);
  if (!operation) {
    throw new ApiError(404, "Sync operation not found");
  }
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      UPDATE integration_sync_operation
      SET status = 'conflict',
          conflict_summary = $2,
          conflict_payload = $3::jsonb,
          updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [input.operationId, input.conflictSummary, JSON.stringify(input.conflictPayload ?? {})]
  );

  await writeSyncAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? operation.triggered_by_user_id ?? null,
    operationId: input.operationId,
    action: "integration.sync.conflict",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    provider: operation.provider,
    direction: operation.direction,
    operationType: operation.operation_type,
    sourceSystem: operation.source_system,
    executionMode: "sync-driven",
    metadata: {
      conflict_summary: input.conflictSummary,
      ...(input.metadata ?? {}),
      conflict_payload: input.conflictPayload ?? {}
    }
  });

  return rows[0];
}

export async function listIntegrationSyncOperations(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    provider?: string | null;
    status?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  } = {}
) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Leadership or directors can review sync operations");
  }

  const values: unknown[] = [auth.tenantId];
  const where: string[] = ["tenant_id = $1"];
  if (filters.provider) {
    values.push(filters.provider);
    where.push(`provider = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`status = $${values.length}`);
  }
  if (filters.entityType) {
    values.push(filters.entityType);
    where.push(`entity_type = $${values.length}`);
  }
  if (filters.entityId) {
    values.push(filters.entityId);
    where.push(`entity_id = $${values.length}`);
  }

  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      SELECT *
      FROM integration_sync_operation
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT 200
    `,
    values
  );
  return rows;
}

export async function replayIntegrationSyncOperation(client: PoolClient, auth: AuthUser, operationId: string) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Only leadership or directors can replay sync operations");
  }
  const { rows } = await client.query<IntegrationSyncOperationRow>(
    `
      SELECT *
      FROM integration_sync_operation
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, operationId]
  );
  const operation = rows[0];
  if (!operation) {
    throw new ApiError(404, "Sync operation not found");
  }
  if (!["outlook", "microsoft365_workspace", "microsoft365_mail_automation"].includes(operation.provider)) {
    throw new ApiError(409, "Replay is currently supported only for Outlook, Microsoft workspace, and Microsoft mail automation sync operations");
  }

  return queueIntegrationSyncOperation(client, {
    tenantId: auth.tenantId,
    provider: operation.provider,
    direction: operation.direction,
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    externalObjectType: operation.external_object_type,
    externalId: operation.external_id,
    operationType: operation.operation_type,
    sourceSystem: "mission_control",
    sourceChangeKey: `${operation.source_change_key ?? operation.id}:replay:${Date.now()}`,
    triggeredByUserId: auth.id,
    payload: operation.payload,
    replayOfOperationId: operation.id
  });
}

export async function replayIntegrationSyncOperationsByFilter(
  client: PoolClient,
  auth: AuthUser,
  input: {
    provider: IntegrationProvider;
    dateFrom?: string | null;
    dateTo?: string | null;
    statuses?: SyncOperationStatus[] | null;
    limit?: number;
  }
) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Only leadership or directors can replay sync operations");
  }

  const statuses =
    input.statuses && input.statuses.length
      ? Array.from(new Set(input.statuses))
      : (["failed", "conflict"] satisfies SyncOperationStatus[]);
  const values: unknown[] = [auth.tenantId, input.provider, statuses];
  let sql = `
      SELECT *
      FROM integration_sync_operation
      WHERE tenant_id = $1
        AND provider = $2
        AND status = ANY($3::text[])
        AND replay_of_operation_id IS NULL
    `;

  if (input.dateFrom) {
    values.push(`${input.dateFrom}T00:00:00.000Z`);
    sql += ` AND created_at >= $${values.length}::timestamptz`;
  }
  if (input.dateTo) {
    values.push(`${input.dateTo}T23:59:59.999Z`);
    sql += ` AND created_at <= $${values.length}::timestamptz`;
  }

  values.push(Math.max(1, Math.min(input.limit ?? 200, 500)));
  sql += ` ORDER BY created_at ASC LIMIT $${values.length}`;

  const { rows } = await client.query<IntegrationSyncOperationRow>(sql, values);
  const queued: IntegrationSyncOperationRow[] = [];
  for (const operation of rows) {
    queued.push(
      await queueIntegrationSyncOperation(client, {
        tenantId: auth.tenantId,
        provider: operation.provider,
        direction: operation.direction,
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        externalObjectType: operation.external_object_type,
        externalId: operation.external_id,
        operationType: operation.operation_type,
        sourceSystem: "mission_control",
        sourceChangeKey: `${operation.source_change_key ?? operation.id}:replay:${Date.now()}:${queued.length}`,
        triggeredByUserId: auth.id,
        payload: operation.payload,
        replayOfOperationId: operation.id
      })
    );
  }

  return {
    replayScope: input.dateFrom || input.dateTo ? ("date_range" as IntegrationSyncReplayScope) : ("full_history" as IntegrationSyncReplayScope),
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    statusFilter: statuses,
    operations: queued
  };
}
