import type { PoolClient } from "pg";
import { canManageSchoolsHub } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  MondayImportSyncOperationSummary,
  MondaySchoolImportInput,
  MondaySchoolImportResult,
  SchoolJobRecord,
  SchoolWorkItemRecord
} from "../types/schoolsHub.js";
import { createAuditLog } from "./audit.js";
import {
  markIntegrationSyncOperationConflict,
  markIntegrationSyncOperationFailed,
  markIntegrationSyncOperationProcessing,
  markIntegrationSyncOperationSucceeded
} from "./integrationSync.js";
import {
  createSchoolJob,
  createSchoolWorkItem,
  getSchoolJobRecord,
  getSchoolWorkItemRecord,
  updateSchoolJob,
  updateSchoolWorkItem
} from "./schoolsHub.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sourceSurface?: string | null;
};

type ExistingMondaySchoolJobRow = {
  id: string;
  organization_id: string;
  source_system: string;
};

type ExistingMondaySchoolWorkItemRow = {
  id: string;
  organization_id: string;
  source_system: string;
};

type ExistingExternalMapRow = {
  external_id: string;
  object_id: string | null;
  payload: Record<string, unknown>;
};

type ExistingOperationRow = {
  id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type CreatedSyncOperation = {
  id: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "conflict";
};

export async function importMondaySchoolSnapshot(
  client: PoolClient,
  auth: AuthUser,
  input: MondaySchoolImportInput,
  meta: RequestMeta = {}
): Promise<MondaySchoolImportResult> {
  assertSchoolsHubManageAccess(auth);
  await ensureSchoolOrganization(client, auth.tenantId, input.organization_id);

  const result: MondaySchoolImportResult = {
    imported_job: null,
    imported_work_item: null,
    sync_operations: []
  };

  let linkedJobId = input.existing_school_job_id ?? null;

  if (input.import_mode !== "work_item") {
    const importedJob = await importMondaySchoolJob(client, auth, input, meta);
    result.imported_job = importedJob.record;
    result.sync_operations.push(importedJob.sync_operation);
    linkedJobId = importedJob.record?.id ?? linkedJobId;
  }

  if (input.import_mode !== "job") {
    const importedWorkItem = await importMondaySchoolWorkItem(client, auth, {
      ...input,
      existing_school_job_id: linkedJobId
    }, meta);
    result.imported_work_item = importedWorkItem.record;
    result.sync_operations.push(importedWorkItem.sync_operation);
  }

  return result;
}

export async function reimportMondaySchoolEntity(
  client: PoolClient,
  auth: AuthUser,
  entityType: "school_job" | "school_work_item",
  entityId: string,
  meta: RequestMeta = {}
): Promise<MondaySchoolImportResult> {
  assertSchoolsHubManageAccess(auth);

  const storedImport = await loadStoredMondayImportInput(client, auth.tenantId, entityType, entityId);
  if (!storedImport) {
    throw new ApiError(404, "No stored Monday import snapshot is available for that Schools Hub record.");
  }

  return importMondaySchoolSnapshot(client, auth, storedImport, {
    ...meta,
    sourceSurface: meta.sourceSurface ?? "schools_hub_monday_reimport"
  });
}

async function importMondaySchoolJob(
  client: PoolClient,
  auth: AuthUser,
  input: MondaySchoolImportInput,
  meta: RequestMeta
): Promise<{ record: SchoolJobRecord; sync_operation: MondayImportSyncOperationSummary }> {
  if (!input.mapped_job) {
    throw new ApiError(400, "Job import requires mapped job metadata.");
  }

  const externalMap = await loadExternalObjectMap(client, auth.tenantId, "school_job", input.external_record_id);
  const explicitJob = input.existing_school_job_id ? await loadSchoolJobOwnership(client, auth.tenantId, input.existing_school_job_id) : null;
  const sourceReference = buildMondaySourceReference(input.external_record_id);

  let candidateJobId = explicitJob?.id ?? externalMap?.object_id ?? null;
  let candidateJob = candidateJobId ? await loadSchoolJobOwnership(client, auth.tenantId, candidateJobId) : null;

  if (!candidateJob && !candidateJobId) {
    candidateJob = await loadSchoolJobBySourceReference(client, auth.tenantId, sourceReference);
    candidateJobId = candidateJob?.id ?? null;
  }

  const operation = await createManualSyncOperation(client, {
    tenantId: auth.tenantId,
    entityType: "school_job",
    entityId: candidateJobId,
    externalId: input.external_record_id,
    payload: buildStoredImportPayload(input)
  });

  await markIntegrationSyncOperationProcessing(client, {
    tenantId: auth.tenantId,
    operationId: operation.id,
    actorUserId: auth.id,
    metadata: {
      provider: "monday",
      mode: "manual_import"
    }
  });

  try {
    if (candidateJob && candidateJob.organization_id !== input.organization_id) {
      return {
        record: await markConflictAndThrow<SchoolJobRecord>(client, auth, operation.id, candidateJob.id, {
          summary: "The Monday item is already linked to a different school job in Mission Control.",
          externalRecordId: input.external_record_id,
          localRecordId: candidateJob.id
        }),
        sync_operation: {
          entity_type: "school_job",
          entity_id: candidateJob.id,
          operation_id: operation.id,
          status: "conflict"
        }
      };
    }

    if (candidateJob && candidateJob.source_system !== "monday") {
      return {
        record: await markConflictAndThrow<SchoolJobRecord>(client, auth, operation.id, candidateJob.id, {
          summary: "Mission Control owns this school job already. Monday imports may only update Monday-owned records.",
          externalRecordId: input.external_record_id,
          localRecordId: candidateJob.id
        }),
        sync_operation: {
          entity_type: "school_job",
          entity_id: candidateJob.id,
          operation_id: operation.id,
          status: "conflict"
        }
      };
    }

    const record = candidateJob
      ? await updateSchoolJob(
          client,
          auth,
          candidateJob.id,
          {
            linked_shoot_id: input.linked_shoot_id ?? null,
            linked_location_id: input.linked_location_id ?? null,
            title: input.mapped_job.title,
            event_date: input.mapped_job.event_date ?? null,
            due_date: input.mapped_job.due_date ?? null,
            owner_user_id: input.mapped_job.owner_user_id ?? null,
            source_system: "monday",
            source_reference: sourceReference,
            status: input.mapped_job.status ?? "planned",
            notes: mergeNotes(input.mapped_job.notes ?? null, input.external_board_name)
          },
          { ...meta, sourceSurface: meta.sourceSurface ?? "schools_hub_monday_import" },
          { allowSourceMutation: true }
        )
      : await createSchoolJob(
          client,
          auth,
          {
            organization_id: input.organization_id,
            linked_shoot_id: input.linked_shoot_id ?? null,
            linked_location_id: input.linked_location_id ?? null,
            job_type: input.mapped_job.job_type,
            title: input.mapped_job.title,
            event_date: input.mapped_job.event_date ?? null,
            due_date: input.mapped_job.due_date ?? null,
            owner_user_id: input.mapped_job.owner_user_id ?? null,
            source_system: "monday",
            source_reference: sourceReference,
            status: input.mapped_job.status ?? "planned",
            notes: mergeNotes(input.mapped_job.notes ?? null, input.external_board_name)
          },
          { ...meta, sourceSurface: meta.sourceSurface ?? "schools_hub_monday_import" },
          { allowSourceMutation: true }
        );

    await bindOperationEntityId(client, auth.tenantId, operation.id, record.id);
    await upsertExternalObjectMap(client, {
      tenantId: auth.tenantId,
      entityType: "school_job",
      entityId: record.id,
      externalId: input.external_record_id,
      payload: buildExternalMapPayload(input, operation.id, "succeeded")
    });
    await markIntegrationSyncOperationSucceeded(client, {
      tenantId: auth.tenantId,
      operationId: operation.id,
      actorUserId: auth.id,
      externalId: input.external_record_id,
      resultPayload: {
        entity_type: "school_job",
        entity_id: record.id,
        import_mode: input.import_mode
      },
      metadata: {
        provider: "monday"
      }
    });
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: candidateJob ? "schools_hub.monday.job.reimported" : "schools_hub.monday.job.imported",
      entityType: "school_job",
      entityId: record.id,
      metadata: {
        external_record_id: input.external_record_id,
        external_board_name: input.external_board_name ?? null,
        operation_id: operation.id
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      sourceSurface: meta.sourceSurface ?? "schools_hub_monday_import"
    });
    const hydratedRecord = await getSchoolJobRecord(client, auth, record.id);

    return {
      record: hydratedRecord,
      sync_operation: {
        entity_type: "school_job",
        entity_id: hydratedRecord.id,
        operation_id: operation.id,
        status: "succeeded"
      }
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw error;
    }
    await markIntegrationSyncOperationFailed(client, {
      tenantId: auth.tenantId,
      operationId: operation.id,
      actorUserId: auth.id,
      errorMessage: error instanceof Error ? error.message : "Monday job import failed",
      resultPayload: {
        provider: "monday",
        external_record_id: input.external_record_id
      }
    });
    throw error;
  }
}

async function importMondaySchoolWorkItem(
  client: PoolClient,
  auth: AuthUser,
  input: MondaySchoolImportInput,
  meta: RequestMeta
): Promise<{ record: SchoolWorkItemRecord; sync_operation: MondayImportSyncOperationSummary }> {
  if (!input.mapped_work_item) {
    throw new ApiError(400, "Work-item import requires mapped work metadata.");
  }

  const externalMap = await loadExternalObjectMap(client, auth.tenantId, "school_work_item", input.external_record_id);
  let candidateWorkItemId = externalMap?.object_id ?? null;
  let candidateWorkItem = candidateWorkItemId ? await loadSchoolWorkItemOwnership(client, auth.tenantId, candidateWorkItemId) : null;
  const sourceReference = buildMondaySourceReference(input.external_record_id);

  if (!candidateWorkItem) {
    candidateWorkItem = await loadSchoolWorkItemBySourceReference(client, auth.tenantId, sourceReference);
    candidateWorkItemId = candidateWorkItem?.id ?? null;
  }

  const operation = await createManualSyncOperation(client, {
    tenantId: auth.tenantId,
    entityType: "school_work_item",
    entityId: candidateWorkItemId,
    externalId: input.external_record_id,
    payload: buildStoredImportPayload(input)
  });

  await markIntegrationSyncOperationProcessing(client, {
    tenantId: auth.tenantId,
    operationId: operation.id,
    actorUserId: auth.id,
    metadata: {
      provider: "monday",
      mode: "manual_import"
    }
  });

  try {
    if (candidateWorkItem && candidateWorkItem.organization_id !== input.organization_id) {
      return {
        record: await markConflictAndThrow<SchoolWorkItemRecord>(client, auth, operation.id, candidateWorkItem.id, {
          summary: "The Monday item is already linked to a different school work item in Mission Control.",
          externalRecordId: input.external_record_id,
          localRecordId: candidateWorkItem.id
        }),
        sync_operation: {
          entity_type: "school_work_item",
          entity_id: candidateWorkItem.id,
          operation_id: operation.id,
          status: "conflict"
        }
      };
    }

    if (candidateWorkItem && candidateWorkItem.source_system !== "monday") {
      return {
        record: await markConflictAndThrow<SchoolWorkItemRecord>(client, auth, operation.id, candidateWorkItem.id, {
          summary: "Mission Control owns this school work item already. Monday imports may only update Monday-owned records.",
          externalRecordId: input.external_record_id,
          localRecordId: candidateWorkItem.id
        }),
        sync_operation: {
          entity_type: "school_work_item",
          entity_id: candidateWorkItem.id,
          operation_id: operation.id,
          status: "conflict"
        }
      };
    }

    const record = candidateWorkItem
      ? await updateSchoolWorkItem(
          client,
          auth,
          candidateWorkItem.id,
          {
            school_job_id: input.existing_school_job_id ?? null,
            linked_shoot_id: input.linked_shoot_id ?? null,
            linked_location_id: input.linked_location_id ?? null,
            linked_contact_id: input.linked_contact_id ?? null,
            linked_production_project_id: input.linked_production_project_id ?? null,
            title: input.mapped_work_item.title,
            description: input.mapped_work_item.description ?? null,
            owner_user_id: input.mapped_work_item.owner_user_id ?? null,
            status: input.mapped_work_item.status ?? "open",
            stage: input.mapped_work_item.stage ?? null,
            priority: input.mapped_work_item.priority ?? "normal",
            due_date: input.mapped_work_item.due_date ?? null,
            sla_date: input.mapped_work_item.sla_date ?? null,
            blocker_reason: input.mapped_work_item.blocker_reason ?? null,
            waiting_on: input.mapped_work_item.waiting_on ?? "none",
            source_system: "monday",
            source_reference: sourceReference,
            generated_by_rule: input.mapped_work_item.generated_by_rule ?? false,
            notes: mergeNotes(input.mapped_work_item.notes ?? null, input.external_board_name)
          },
          { ...meta, sourceSurface: meta.sourceSurface ?? "schools_hub_monday_import" },
          { allowSourceMutation: true }
        )
      : await createSchoolWorkItem(
          client,
          auth,
          {
            organization_id: input.organization_id,
            school_job_id: input.existing_school_job_id ?? null,
            linked_shoot_id: input.linked_shoot_id ?? null,
            linked_location_id: input.linked_location_id ?? null,
            linked_contact_id: input.linked_contact_id ?? null,
            linked_production_project_id: input.linked_production_project_id ?? null,
            work_type: input.mapped_work_item.work_type,
            title: input.mapped_work_item.title,
            description: input.mapped_work_item.description ?? null,
            owner_user_id: input.mapped_work_item.owner_user_id ?? null,
            status: input.mapped_work_item.status ?? "open",
            stage: input.mapped_work_item.stage ?? undefined,
            priority: input.mapped_work_item.priority ?? "normal",
            due_date: input.mapped_work_item.due_date ?? null,
            sla_date: input.mapped_work_item.sla_date ?? null,
            blocker_reason: input.mapped_work_item.blocker_reason ?? null,
            waiting_on: input.mapped_work_item.waiting_on ?? "none",
            source_system: "monday",
            source_reference: sourceReference,
            generated_by_rule: input.mapped_work_item.generated_by_rule ?? false,
            notes: mergeNotes(input.mapped_work_item.notes ?? null, input.external_board_name)
          },
          { ...meta, sourceSurface: meta.sourceSurface ?? "schools_hub_monday_import" },
          { allowSourceMutation: true }
        );

    await bindOperationEntityId(client, auth.tenantId, operation.id, record.id);
    await upsertExternalObjectMap(client, {
      tenantId: auth.tenantId,
      entityType: "school_work_item",
      entityId: record.id,
      externalId: input.external_record_id,
      payload: buildExternalMapPayload(input, operation.id, "succeeded")
    });
    await markIntegrationSyncOperationSucceeded(client, {
      tenantId: auth.tenantId,
      operationId: operation.id,
      actorUserId: auth.id,
      externalId: input.external_record_id,
      resultPayload: {
        entity_type: "school_work_item",
        entity_id: record.id,
        import_mode: input.import_mode
      },
      metadata: {
        provider: "monday"
      }
    });
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: candidateWorkItem ? "schools_hub.monday.work_item.reimported" : "schools_hub.monday.work_item.imported",
      entityType: "school_work_item",
      entityId: record.id,
      metadata: {
        external_record_id: input.external_record_id,
        external_board_name: input.external_board_name ?? null,
        operation_id: operation.id
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      sourceSurface: meta.sourceSurface ?? "schools_hub_monday_import"
    });
    const hydratedRecord = await getSchoolWorkItemRecord(client, auth, record.id);

    return {
      record: hydratedRecord,
      sync_operation: {
        entity_type: "school_work_item",
        entity_id: hydratedRecord.id,
        operation_id: operation.id,
        status: "succeeded"
      }
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw error;
    }
    await markIntegrationSyncOperationFailed(client, {
      tenantId: auth.tenantId,
      operationId: operation.id,
      actorUserId: auth.id,
      errorMessage: error instanceof Error ? error.message : "Monday work-item import failed",
      resultPayload: {
        provider: "monday",
        external_record_id: input.external_record_id
      }
    });
    throw error;
  }
}

async function ensureSchoolOrganization(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT org.id
      FROM organization org
      JOIN school_profile sp
        ON sp.tenant_id = org.tenant_id
       AND sp.organization_id = org.id
      WHERE org.tenant_id = $1
        AND org.id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "School not found.");
  }
}

async function loadSchoolJobOwnership(client: PoolClient, tenantId: string, schoolJobId: string) {
  const { rows } = await client.query<ExistingMondaySchoolJobRow>(
    `
      SELECT id, organization_id, source_system::text
      FROM school_job
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, schoolJobId]
  );
  return rows[0] ?? null;
}

async function loadSchoolWorkItemOwnership(client: PoolClient, tenantId: string, workItemId: string) {
  const { rows } = await client.query<ExistingMondaySchoolWorkItemRow>(
    `
      SELECT id, organization_id, source_system::text
      FROM school_work_item
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, workItemId]
  );
  return rows[0] ?? null;
}

async function loadSchoolJobBySourceReference(client: PoolClient, tenantId: string, sourceReference: string) {
  const { rows } = await client.query<ExistingMondaySchoolJobRow>(
    `
      SELECT id, organization_id, source_system::text
      FROM school_job
      WHERE tenant_id = $1
        AND source_system = 'monday'
        AND source_reference = $2
      LIMIT 1
    `,
    [tenantId, sourceReference]
  );
  return rows[0] ?? null;
}

async function loadSchoolWorkItemBySourceReference(client: PoolClient, tenantId: string, sourceReference: string) {
  const { rows } = await client.query<ExistingMondaySchoolWorkItemRow>(
    `
      SELECT id, organization_id, source_system::text
      FROM school_work_item
      WHERE tenant_id = $1
        AND source_system = 'monday'
        AND source_reference = $2
      LIMIT 1
    `,
    [tenantId, sourceReference]
  );
  return rows[0] ?? null;
}

async function loadExternalObjectMap(
  client: PoolClient,
  tenantId: string,
  entityType: "school_job" | "school_work_item",
  externalId: string
) {
  const { rows } = await client.query<ExistingExternalMapRow>(
    `
      SELECT external_id, object_id::text, payload
      FROM external_object_map
      WHERE tenant_id = $1
        AND provider = 'monday'
        AND object_type = $2
        AND external_id = $3
      LIMIT 1
    `,
    [tenantId, entityType, externalId]
  );
  return rows[0] ?? null;
}

async function loadStoredMondayImportInput(
  client: PoolClient,
  tenantId: string,
  entityType: "school_job" | "school_work_item",
  entityId: string
) {
  const externalMap = await client.query<ExistingExternalMapRow>(
    `
      SELECT external_id, object_id::text, payload
      FROM external_object_map
      WHERE tenant_id = $1
        AND provider = 'monday'
        AND object_type = $2
        AND object_id = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, entityType, entityId]
  );

  const mapPayload = externalMap.rows[0]?.payload;
  const mappedImport = normalizeStoredImport(mapPayload?.import_request);
  if (mappedImport) {
    return mappedImport;
  }

  const recentOperation = await client.query<ExistingOperationRow>(
    `
      SELECT id, payload, created_at::text
      FROM integration_sync_operation
      WHERE tenant_id = $1
        AND provider = 'monday'
        AND entity_type = $2
        AND entity_id = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, entityType, entityId]
  );
  return normalizeStoredImport(recentOperation.rows[0]?.payload?.import_request ?? recentOperation.rows[0]?.payload ?? null);
}

async function createManualSyncOperation(
  client: PoolClient,
  input: {
    tenantId: string;
    entityType: "school_job" | "school_work_item";
    entityId: string | null;
    externalId: string;
    payload: Record<string, unknown>;
  }
) {
  const { rows } = await client.query<CreatedSyncOperation>(
    `
      INSERT INTO integration_sync_operation (
        tenant_id,
        provider,
        direction,
        entity_type,
        entity_id,
        external_object_type,
        external_id,
        operation_type,
        source_system,
        source_change_key,
        payload
      )
      VALUES ($1,'monday','inbound',$2,$3,'monday_item',$4,'schools_hub_monday_import','monday',$5,$6::jsonb)
      RETURNING id, status
    `,
    [
      input.tenantId,
      input.entityType,
      input.entityId,
      input.externalId,
      `${input.entityType}:${input.externalId}`,
      JSON.stringify(input.payload)
    ]
  );
  return rows[0];
}

async function bindOperationEntityId(client: PoolClient, tenantId: string, operationId: string, entityId: string) {
  await client.query(
    `
      UPDATE integration_sync_operation
      SET entity_id = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, operationId, entityId]
  );
}

async function upsertExternalObjectMap(
  client: PoolClient,
  input: {
    tenantId: string;
    entityType: "school_job" | "school_work_item";
    entityId: string;
    externalId: string;
    payload: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload)
      VALUES ($1,'monday',$2,$3,$4,$5::jsonb)
      ON CONFLICT (tenant_id, provider, external_id, object_type)
      DO UPDATE SET object_id = EXCLUDED.object_id, payload = EXCLUDED.payload
    `,
    [input.tenantId, input.externalId, input.entityType, input.entityId, JSON.stringify(input.payload)]
  );
}

async function markConflictAndThrow<T>(
  client: PoolClient,
  auth: AuthUser,
  operationId: string,
  entityId: string | null,
  input: {
    summary: string;
    externalRecordId: string;
    localRecordId: string | null;
  }
): Promise<T> {
  if (entityId) {
    await bindOperationEntityId(client, auth.tenantId, operationId, entityId);
  }
  await markIntegrationSyncOperationConflict(client, {
    tenantId: auth.tenantId,
    operationId,
    actorUserId: auth.id,
    conflictSummary: input.summary,
    conflictPayload: {
      provider: "monday",
      external_record_id: input.externalRecordId,
      local_record_id: input.localRecordId
    }
  });
  throw new ApiError(409, input.summary);
}

function buildStoredImportPayload(input: MondaySchoolImportInput) {
  return {
    provider: "monday",
    import_request: input
  };
}

function buildExternalMapPayload(
  input: MondaySchoolImportInput,
  operationId: string,
  syncStatus: "succeeded" | "failed" | "conflict"
) {
  return {
    provider: "monday",
    external_record_id: input.external_record_id,
    external_record_name: input.external_record_name,
    external_record_url: input.external_record_url ?? null,
    board_id: input.external_board_id ?? null,
    board_name: input.external_board_name ?? null,
    group_id: input.external_group_id ?? null,
    group_title: input.external_group_title ?? null,
    last_synced_at: new Date().toISOString(),
    sync_status: syncStatus,
    last_operation_id: operationId,
    raw_snapshot: input.raw_snapshot ?? {},
    import_request: input
  };
}

function buildMondaySourceReference(externalRecordId: string) {
  return `monday:item:${externalRecordId.trim()}`;
}

function mergeNotes(notes: string | null, externalBoardName: string | null | undefined) {
  const normalized = notes?.trim() || "";
  const suffix = externalBoardName?.trim() ? `Imported from Monday board: ${externalBoardName.trim()}` : "";
  if (normalized && suffix) {
    return `${normalized}\n\n${suffix}`;
  }
  return normalized || suffix || null;
}

function normalizeStoredImport(value: unknown): MondaySchoolImportInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.organization_id !== "string" || typeof record.import_mode !== "string" || typeof record.external_record_id !== "string") {
    return null;
  }
  return record as unknown as MondaySchoolImportInput;
}

function assertSchoolsHubManageAccess(auth: AuthUser) {
  if (!canManageSchoolsHub(auth)) {
    throw new ApiError(403, "Only the schools team can manage Monday coexistence imports.");
  }
}
