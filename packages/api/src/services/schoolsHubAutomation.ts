import type { PoolClient } from "pg";
import { canManageSchoolsHub } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { SchoolWorkSourceSystem } from "../types/schoolsHub.js";
import { createAuditLog } from "./audit.js";
import { createAppEvent } from "./outbox.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sourceSurface?: string | null;
};

export type QueueSchoolsHubUploadTriggerInput = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  linked_production_project_id?: string | null;
  trigger_type: "id_upload_received" | "gallery_deadline_set" | "final_retake_upload_completed";
  deadline_date?: string | null;
  source_system?: SchoolWorkSourceSystem;
  source_reference?: string | null;
  note?: string | null;
};

export type QueueSchoolsHubYearbookTriggerInput = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  request_type: "yearbook_request_received" | "yearbook_review_requested";
  deadline_date?: string | null;
  source_system?: SchoolWorkSourceSystem;
  source_reference?: string | null;
  note?: string | null;
};

export type QueueSchoolsHubDeliverableTriggerInput = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  deliverable_type: "yearbooks_arrived" | "admin_items_arrived" | "other_deliverable_arrived";
  arrived_on?: string | null;
  ready_date?: string | null;
  source_system?: SchoolWorkSourceSystem;
  source_reference?: string | null;
  note?: string | null;
};

export async function queueSchoolsHubAutomationRun(
  client: PoolClient,
  auth: AuthUser,
  meta: RequestMeta = {}
) {
  assertSchoolsHubManageAccess(auth);

  const event = await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "schools_hub.automation.requested",
    aggregateType: "schools_hub_automation",
    aggregateId: auth.tenantId,
    dedupeKey: meta.requestId ? `schools-hub:automation-run:${auth.tenantId}:${meta.requestId}` : null,
    payload: {
      tenant_id: auth.tenantId,
      requested_by_user_id: auth.id,
      source_surface: meta.sourceSurface ?? "schools_hub"
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.automation.run_requested",
    entityType: "schools_hub_automation",
    entityId: String(event.id ?? auth.tenantId),
    metadata: {
      source_surface: meta.sourceSurface ?? "schools_hub"
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return {
    queued: true,
    event_id: String(event.id ?? ""),
    event_type: "schools_hub.automation.requested"
  };
}

export async function queueSchoolsHubUploadTrigger(
  client: PoolClient,
  auth: AuthUser,
  input: QueueSchoolsHubUploadTriggerInput,
  meta: RequestMeta = {}
) {
  assertSchoolsHubManageAccess(auth);
  await validateSchoolsHubTriggerContext(client, auth, {
    organizationId: input.organization_id,
    schoolJobId: input.school_job_id ?? null,
    linkedShootId: input.linked_shoot_id ?? null,
    linkedLocationId: input.linked_location_id ?? null,
    linkedProductionProjectId: input.linked_production_project_id ?? null
  });

  const sourceReference = normalizeOptionalText(input.source_reference);
  const event = await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "schools_hub.trigger.upload_state_changed",
    aggregateType: "schools_hub_trigger",
    aggregateId: input.organization_id,
    dedupeKey:
      sourceReference && input.trigger_type
        ? `schools-hub:upload-trigger:${auth.tenantId}:${input.trigger_type}:${sourceReference}`
        : meta.requestId
          ? `schools-hub:upload-trigger:${auth.tenantId}:${meta.requestId}`
          : null,
    payload: {
      tenant_id: auth.tenantId,
      initiated_by_user_id: auth.id,
      organization_id: input.organization_id,
      school_job_id: input.school_job_id ?? null,
      linked_shoot_id: input.linked_shoot_id ?? null,
      linked_location_id: input.linked_location_id ?? null,
      linked_production_project_id: input.linked_production_project_id ?? null,
      trigger_type: input.trigger_type,
      deadline_date: normalizeOptionalDate(input.deadline_date ?? null),
      source_system: input.source_system ?? "other",
      source_reference: sourceReference,
      note: normalizeOptionalText(input.note ?? null),
      source_surface: meta.sourceSurface ?? "schools_hub"
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.automation.upload_trigger_queued",
    entityType: "schools_hub_trigger",
    entityId: String(event.id ?? ""),
    metadata: {
      organization_id: input.organization_id,
      trigger_type: input.trigger_type,
      source_reference: sourceReference
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return {
    queued: true,
    event_id: String(event.id ?? ""),
    event_type: "schools_hub.trigger.upload_state_changed"
  };
}

export async function queueSchoolsHubYearbookTrigger(
  client: PoolClient,
  auth: AuthUser,
  input: QueueSchoolsHubYearbookTriggerInput,
  meta: RequestMeta = {}
) {
  assertSchoolsHubManageAccess(auth);
  await validateSchoolsHubTriggerContext(client, auth, {
    organizationId: input.organization_id,
    schoolJobId: input.school_job_id ?? null,
    linkedShootId: input.linked_shoot_id ?? null,
    linkedLocationId: input.linked_location_id ?? null
  });

  const sourceReference = normalizeOptionalText(input.source_reference);
  const event = await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "schools_hub.trigger.yearbook_request_received",
    aggregateType: "schools_hub_trigger",
    aggregateId: input.organization_id,
    dedupeKey:
      sourceReference && input.request_type
        ? `schools-hub:yearbook-trigger:${auth.tenantId}:${input.request_type}:${sourceReference}`
        : meta.requestId
          ? `schools-hub:yearbook-trigger:${auth.tenantId}:${meta.requestId}`
          : null,
    payload: {
      tenant_id: auth.tenantId,
      initiated_by_user_id: auth.id,
      organization_id: input.organization_id,
      school_job_id: input.school_job_id ?? null,
      linked_shoot_id: input.linked_shoot_id ?? null,
      linked_location_id: input.linked_location_id ?? null,
      request_type: input.request_type,
      deadline_date: normalizeOptionalDate(input.deadline_date ?? null),
      source_system: input.source_system ?? "other",
      source_reference: sourceReference,
      note: normalizeOptionalText(input.note ?? null),
      source_surface: meta.sourceSurface ?? "schools_hub"
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.automation.yearbook_trigger_queued",
    entityType: "schools_hub_trigger",
    entityId: String(event.id ?? ""),
    metadata: {
      organization_id: input.organization_id,
      request_type: input.request_type,
      source_reference: sourceReference
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return {
    queued: true,
    event_id: String(event.id ?? ""),
    event_type: "schools_hub.trigger.yearbook_request_received"
  };
}

export async function queueSchoolsHubDeliverableTrigger(
  client: PoolClient,
  auth: AuthUser,
  input: QueueSchoolsHubDeliverableTriggerInput,
  meta: RequestMeta = {}
) {
  assertSchoolsHubManageAccess(auth);
  await validateSchoolsHubTriggerContext(client, auth, {
    organizationId: input.organization_id,
    schoolJobId: input.school_job_id ?? null,
    linkedShootId: input.linked_shoot_id ?? null,
    linkedLocationId: input.linked_location_id ?? null
  });

  const sourceReference = normalizeOptionalText(input.source_reference);
  const event = await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "schools_hub.trigger.deliverable_arrived",
    aggregateType: "schools_hub_trigger",
    aggregateId: input.organization_id,
    dedupeKey:
      sourceReference && input.deliverable_type
        ? `schools-hub:deliverable-trigger:${auth.tenantId}:${input.deliverable_type}:${sourceReference}`
        : meta.requestId
          ? `schools-hub:deliverable-trigger:${auth.tenantId}:${meta.requestId}`
          : null,
    payload: {
      tenant_id: auth.tenantId,
      initiated_by_user_id: auth.id,
      organization_id: input.organization_id,
      school_job_id: input.school_job_id ?? null,
      linked_shoot_id: input.linked_shoot_id ?? null,
      linked_location_id: input.linked_location_id ?? null,
      deliverable_type: input.deliverable_type,
      arrived_on: normalizeOptionalDate(input.arrived_on ?? null),
      ready_date: normalizeOptionalDate(input.ready_date ?? null),
      source_system: input.source_system ?? "other",
      source_reference: sourceReference,
      note: normalizeOptionalText(input.note ?? null),
      source_surface: meta.sourceSurface ?? "schools_hub"
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.automation.deliverable_trigger_queued",
    entityType: "schools_hub_trigger",
    entityId: String(event.id ?? ""),
    metadata: {
      organization_id: input.organization_id,
      deliverable_type: input.deliverable_type,
      source_reference: sourceReference
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return {
    queued: true,
    event_id: String(event.id ?? ""),
    event_type: "schools_hub.trigger.deliverable_arrived"
  };
}

async function validateSchoolsHubTriggerContext(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId: string;
    schoolJobId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    linkedProductionProjectId?: string | null;
  }
) {
  await ensureSchoolOrganization(client, auth.tenantId, input.organizationId);

  if (input.schoolJobId) {
    const schoolJob = await client.query<{ organization_id: string }>(
      `
        SELECT organization_id::text
        FROM school_job
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.schoolJobId]
    );
    if (!schoolJob.rows[0] || schoolJob.rows[0].organization_id !== input.organizationId) {
      throw new ApiError(400, "Linked school job must belong to the same school.");
    }
  }

  if (input.linkedShootId) {
    const linkedShoot = await client.query<{ organization_id: string | null }>(
      `
        SELECT organization_id::text
        FROM shoot
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.linkedShootId]
    );
    if (!linkedShoot.rows[0]) {
      throw new ApiError(400, "Linked shoot was not found.");
    }
    if (linkedShoot.rows[0].organization_id && linkedShoot.rows[0].organization_id !== input.organizationId) {
      throw new ApiError(400, "Linked shoot must belong to the same school.");
    }
  }

  if (input.linkedLocationId) {
    const linkedLocation = await client.query<{ organization_id: string | null }>(
      `
        SELECT organization_id::text
        FROM shoot_location
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.linkedLocationId]
    );
    if (!linkedLocation.rows[0]) {
      throw new ApiError(400, "Linked location was not found.");
    }
    if (linkedLocation.rows[0].organization_id && linkedLocation.rows[0].organization_id !== input.organizationId) {
      throw new ApiError(400, "Linked location must belong to the same school.");
    }
  }

  if (input.linkedProductionProjectId) {
    const linkedProject = await client.query<{ organization_id: string | null }>(
      `
        SELECT COALESCE(project.linked_organization_id::text, shoot.organization_id::text) AS organization_id
        FROM production_project project
        LEFT JOIN shoot
          ON shoot.tenant_id = project.tenant_id
         AND shoot.id = project.linked_shoot_id
        WHERE project.tenant_id = $1
          AND project.id = $2
        LIMIT 1
      `,
      [auth.tenantId, input.linkedProductionProjectId]
    );
    if (!linkedProject.rows[0]) {
      throw new ApiError(400, "Linked production project was not found.");
    }
    if (linkedProject.rows[0].organization_id && linkedProject.rows[0].organization_id !== input.organizationId) {
      throw new ApiError(400, "Linked production project must belong to the same school.");
    }
  }
}

async function ensureSchoolOrganization(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT school_profile.organization_id::text AS id
      FROM school_profile
      WHERE school_profile.tenant_id = $1
        AND school_profile.organization_id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "School not found.");
  }
}

function assertSchoolsHubManageAccess(auth: AuthUser) {
  if (!canManageSchoolsHub(auth)) {
    throw new ApiError(403, "You do not have access to manage the Schools Hub.");
  }
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(400, "Dates must use YYYY-MM-DD.");
  }
  return trimmed;
}
