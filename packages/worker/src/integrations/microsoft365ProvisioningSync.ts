import type { PoolClient } from "pg";

type IntegrationSyncOperation = {
  id: string;
  tenant_id: string;
  provider: string;
  direction: string;
  entity_type: string;
  entity_id: string | null;
  external_object_type: string;
  external_id: string | null;
  operation_type: string;
  source_system: string;
  source_change_key: string | null;
  status: string;
  triggered_by_user_id: string | null;
  payload: Record<string, unknown>;
};

type ResolvedObject = {
  microsoft_object_type: string;
  microsoft_object_id: string;
  microsoft_object_label?: string | null;
  microsoft_parent_object_id?: string | null;
  microsoft_url?: string | null;
  sync_status?: string | null;
  metadata?: Record<string, unknown>;
};

async function loadSyncOperation(client: PoolClient, operationId: string) {
  const { rows } = await client.query<IntegrationSyncOperation>(
    `
      SELECT *
      FROM integration_sync_operation
      WHERE id = $1
      LIMIT 1
    `,
    [operationId]
  );
  return rows[0] ?? null;
}

async function writeAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    operationId: string;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO audit_log (tenant_id, actor_user_id, target_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, NULL, $3, $4, $5, $6::jsonb)
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify({
        integration_sync_operation_id: input.operationId,
        provider: "microsoft365_workspace",
        execution_mode: "sync-driven",
        ...(input.metadata ?? {})
      })
    ]
  );
}

async function updateOperation(
  client: PoolClient,
  operationId: string,
  input: {
    status: "processing" | "succeeded" | "failed";
    externalId?: string | null;
    resultPayload?: Record<string, unknown>;
    error?: string | null;
  }
) {
  await client.query(
    `
      UPDATE integration_sync_operation
      SET
        status = $2,
        external_id = COALESCE($3, external_id),
        attempt_count = CASE WHEN $2 = 'processing' THEN attempt_count + 1 ELSE attempt_count END,
        last_attempt_at = CASE WHEN $2 = 'processing' THEN now() ELSE COALESCE(last_attempt_at, now()) END,
        result_payload = CASE WHEN $4::jsonb IS NULL THEN result_payload ELSE COALESCE(result_payload, '{}'::jsonb) || $4::jsonb END,
        last_error = CASE WHEN $5::text IS NULL THEN NULL ELSE $5 END,
        last_error_at = CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,
        updated_at = now()
      WHERE id = $1
    `,
    [operationId, input.status, input.externalId ?? null, input.resultPayload ? JSON.stringify(input.resultPayload) : null, input.error ?? null]
  );
}

function asResolvedObjects(value: unknown): ResolvedObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ResolvedObject => Boolean(item && typeof item === "object"));
}

function asDesiredObjects(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => Boolean(item && typeof item === "object"));
}

async function upsertMicrosoftLink(
  client: PoolClient,
  operation: IntegrationSyncOperation,
  payload: Record<string, unknown>,
  resolvedObject: ResolvedObject
) {
  const dashboardEntityType = String(payload.dashboard_entity_type ?? operation.entity_type);
  const dashboardEntityId = String(payload.dashboard_entity_id ?? operation.entity_id ?? "");
  const canonicalDashboardId = String(payload.canonical_dashboard_id ?? `${dashboardEntityType}:${dashboardEntityId}`);
  const dashboardUrl = typeof payload.dashboard_url === "string" ? payload.dashboard_url : null;
  const syncStatus = resolvedObject.sync_status ?? "linked";

  await client.query(
    `
      INSERT INTO microsoft_workspace_link (
        tenant_id,
        provider,
        dashboard_entity_type,
        dashboard_entity_id,
        canonical_dashboard_id,
        microsoft_object_type,
        microsoft_object_id,
        microsoft_object_label,
        microsoft_parent_object_id,
        microsoft_url,
        dashboard_url,
        mirror_scope,
        sync_status,
        last_sync_operation_id,
        last_sync_error,
        last_synced_at,
        metadata,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        'microsoft365_workspace',
        $2::microsoft_dashboard_entity_type,
        $3,
        $4,
        $5::microsoft_workspace_object_type,
        $6,
        $7,
        $8,
        $9,
        $10,
        'dashboard_read_only_mirror',
        $11::microsoft_workspace_link_status,
        $12::uuid,
        CASE WHEN $11 = 'failed'::microsoft_workspace_link_status THEN 'Worker marked Microsoft link as failed.' ELSE NULL END,
        CASE WHEN $11 = 'linked'::microsoft_workspace_link_status OR $11 = 'drifted'::microsoft_workspace_link_status THEN now() ELSE NULL END,
        $13::jsonb,
        $14::uuid,
        now(),
        now()
      )
      ON CONFLICT (tenant_id, canonical_dashboard_id, microsoft_object_type)
      DO UPDATE SET
        microsoft_object_id = EXCLUDED.microsoft_object_id,
        microsoft_object_label = EXCLUDED.microsoft_object_label,
        microsoft_parent_object_id = EXCLUDED.microsoft_parent_object_id,
        microsoft_url = EXCLUDED.microsoft_url,
        dashboard_url = EXCLUDED.dashboard_url,
        sync_status = EXCLUDED.sync_status,
        last_sync_operation_id = EXCLUDED.last_sync_operation_id,
        last_sync_error = EXCLUDED.last_sync_error,
        last_synced_at = EXCLUDED.last_synced_at,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      operation.tenant_id,
      dashboardEntityType,
      dashboardEntityId,
      canonicalDashboardId,
      resolvedObject.microsoft_object_type,
      resolvedObject.microsoft_object_id,
      resolvedObject.microsoft_object_label ?? null,
      resolvedObject.microsoft_parent_object_id ?? null,
      resolvedObject.microsoft_url ?? null,
      dashboardUrl,
      syncStatus,
      operation.id,
      JSON.stringify({
        operation_type: operation.operation_type,
        source_system: operation.source_system,
        ...(resolvedObject.metadata ?? {})
      }),
      operation.triggered_by_user_id ?? null
    ]
  );

  await client.query(
    `
      INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload)
      VALUES ($1, 'microsoft365_workspace', $2, $3, $4::uuid, $5::jsonb)
      ON CONFLICT (tenant_id, provider, external_id, object_type)
      DO UPDATE SET
        object_id = EXCLUDED.object_id,
        payload = EXCLUDED.payload
    `,
    [
      operation.tenant_id,
      resolvedObject.microsoft_object_id,
      dashboardEntityType,
      operation.entity_id,
      JSON.stringify({
        canonical_dashboard_id: canonicalDashboardId,
        microsoft_object_type: resolvedObject.microsoft_object_type,
        microsoft_url: resolvedObject.microsoft_url ?? null,
        dashboard_url: dashboardUrl
      })
    ]
  );
}

export async function dispatchMicrosoft365ProvisioningSync(client: PoolClient, operationId: string) {
  const operation = await loadSyncOperation(client, operationId);
  if (!operation) {
    return { code: "skipped", response: { reason: "missing_operation" } };
  }
  if (operation.provider !== "microsoft365_workspace") {
    return { code: "skipped", response: { reason: "unsupported_provider" } };
  }
  if (operation.status === "succeeded") {
    return { code: "skipped", response: { reason: "already_succeeded" } };
  }

  await updateOperation(client, operation.id, { status: "processing" });
  await writeAudit(client, {
    tenantId: operation.tenant_id,
    actorUserId: operation.triggered_by_user_id,
    action: "integration.sync.processing",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    operationId: operation.id
  });

  if (operation.direction !== "outbound") {
    const message = "Microsoft workspace provisioning is outbound-only in phase 3.";
    await updateOperation(client, operation.id, {
      status: "failed",
      error: message,
      resultPayload: { provider: operation.provider }
    });
    await writeAudit(client, {
      tenantId: operation.tenant_id,
      actorUserId: operation.triggered_by_user_id,
      action: "integration.sync.failed",
      entityType: operation.entity_type,
      entityId: operation.entity_id,
      operationId: operation.id,
      metadata: { error: message }
    });
    return { code: "failed", response: { reason: message } };
  }

  const resolvedObjects = asResolvedObjects(operation.payload.resolved_objects);
  const desiredObjects = asDesiredObjects(operation.payload.desired_objects);

  if (!resolvedObjects.length) {
    const response = {
      provisioning_state: "planned",
      desired_objects_count: desiredObjects.length,
      note: "Phase 3 scaffolding planned the Microsoft objects but did not mutate the tenant."
    };
    await updateOperation(client, operation.id, {
      status: "succeeded",
      resultPayload: response
    });
    await writeAudit(client, {
      tenantId: operation.tenant_id,
      actorUserId: operation.triggered_by_user_id,
      action: "integration.sync.succeeded",
      entityType: operation.entity_type,
      entityId: operation.entity_id,
      operationId: operation.id,
      metadata: response
    });
    return { code: "planned", response };
  }

  for (const resolvedObject of resolvedObjects) {
    if (!resolvedObject.microsoft_object_id) {
      const message = "Resolved Microsoft provisioning objects must include microsoft_object_id.";
      await updateOperation(client, operation.id, {
        status: "failed",
        error: message,
        resultPayload: { resolved_objects_count: resolvedObjects.length }
      });
      await writeAudit(client, {
        tenantId: operation.tenant_id,
        actorUserId: operation.triggered_by_user_id,
        action: "integration.sync.failed",
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        operationId: operation.id,
        metadata: { error: message }
      });
      return { code: "failed", response: { reason: message } };
    }
  }

  for (const resolvedObject of resolvedObjects) {
    await upsertMicrosoftLink(client, operation, operation.payload, resolvedObject);
  }

  const response = {
    provisioning_state: "links_recorded",
    desired_objects_count: desiredObjects.length,
    resolved_objects_count: resolvedObjects.length
  };
  await updateOperation(client, operation.id, {
    status: "succeeded",
    externalId: resolvedObjects[0]?.microsoft_object_id ?? null,
    resultPayload: response
  });
  await writeAudit(client, {
    tenantId: operation.tenant_id,
    actorUserId: operation.triggered_by_user_id,
    action: "integration.sync.succeeded",
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    operationId: operation.id,
    metadata: response
  });
  return { code: "linked", response };
}
