import type { PoolClient } from "pg";
import { canManageCanonicalDirectoryRecords } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  DirectoryCommunicationOutcome,
  DirectoryInternalOwnerRecord,
  DirectoryRelationshipContinuityBundle,
  DirectoryRelationshipFollowUpRecord,
  DirectoryRelationshipHealthState,
  DirectoryRelationshipMemoryRecord,
  DirectoryTouchpointPlanRecord,
  DirectoryTouchpointPlanTemplateRecord,
  DirectoryTouchpointRecord,
  DirectoryTouchpointCategory,
  DirectoryTouchpointPlanStatus,
  DirectoryRelationshipMemoryType,
  DirectoryRelationshipMemoryVisibility
} from "../types/organizations.js";
import { createAuditLog } from "./audit.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type TouchpointTemplateRow = {
  id: string;
  template_key: string;
  template_name: string;
  category: DirectoryTouchpointCategory;
  scope_hint: "organization" | "location" | "contact";
  summary: string;
  default_offset_days: number | null;
  default_due_time: string | null;
  active_status: boolean;
};

type TouchpointPlanRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
  template_id: string | null;
  category: DirectoryTouchpointCategory;
  status: "planned" | "completed" | "skipped" | "cancelled";
  title: string;
  summary: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  backup_owner_user_id: string | null;
  backup_owner_name: string | null;
  backup_owner_email: string | null;
  backup_owner_department: string | null;
  backup_owner_status: string | null;
  due_at: string;
  completed_at: string | null;
  skipped_reason: string | null;
  cancelled_reason: string | null;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
};

type CommunicationLogRow = {
  id: string;
  organization_id: string | null;
  location_id: string | null;
  shoot_id: string | null;
  contact_id: string | null;
  channel: DirectoryTouchpointRecord["channel"];
  category: DirectoryTouchpointCategory | null;
  subject: string | null;
  summary: string;
  outcome: string | null;
  outcome_state: DirectoryCommunicationOutcome | null;
  owner_user_id: string | null;
  owner_name: string | null;
  follow_up_date: string | null;
  follow_up_needed: boolean;
  follow_up_owner_user_id: string | null;
  follow_up_owner_name: string | null;
  follow_up_owner_email: string | null;
  follow_up_owner_department: string | null;
  follow_up_owner_status: string | null;
  relationship_memory_suggested: boolean;
  attachment_reference: string | null;
  touchpoint_plan_id: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

type RelationshipMemoryRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  source_touchpoint_id: string | null;
  memory_type: DirectoryRelationshipMemoryType;
  summary: string;
  why_it_matters: string;
  source_label: string | null;
  visibility: DirectoryRelationshipMemoryVisibility;
  status: "active" | "needs_review" | "archived";
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  created_by_department: string | null;
  created_by_status: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_by_email: string | null;
  reviewed_by_department: string | null;
  reviewed_by_status: string | null;
  reviewed_at: string | null;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RelationshipFollowUpRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
  source_touchpoint_id: string | null;
  source_touchpoint_plan_id: string | null;
  title: string;
  summary: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_department: string | null;
  owner_status: string | null;
  backup_owner_user_id: string | null;
  backup_owner_name: string | null;
  backup_owner_email: string | null;
  backup_owner_department: string | null;
  backup_owner_status: string | null;
  due_at: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  completed_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

type ContactRiskRow = {
  stale_key_contact_count: string | number;
};

type CreateTouchpointPlanInput = {
  template_id?: string | null;
  contact_id?: string | null;
  location_id?: string | null;
  linked_shoot_id?: string | null;
  category: DirectoryTouchpointCategory;
  title: string;
  summary?: string | null;
  owner_user_id?: string | null;
  backup_owner_user_id?: string | null;
  due_at: string;
};

type UpdateTouchpointPlanInput = {
  status?: "planned" | "completed" | "skipped" | "cancelled";
  completion_note?: string | null;
  skipped_reason?: string | null;
  cancelled_reason?: string | null;
};

type CreateCommunicationLogInput = {
  contact_id?: string | null;
  location_id?: string | null;
  shoot_id?: string | null;
  channel: DirectoryTouchpointRecord["channel"];
  category?: DirectoryTouchpointCategory | null;
  subject?: string | null;
  summary: string;
  outcome?: string | null;
  outcome_state?: DirectoryCommunicationOutcome | null;
  owner_user_id?: string | null;
  occurred_at?: string | null;
  follow_up_date?: string | null;
  follow_up_needed?: boolean;
  follow_up_owner_user_id?: string | null;
  relationship_memory_suggested?: boolean;
  attachment_reference?: string | null;
  touchpoint_plan_id?: string | null;
  memory_type?: DirectoryRelationshipMemoryType | null;
  memory_summary?: string | null;
  memory_why_it_matters?: string | null;
  memory_visibility?: DirectoryRelationshipMemoryVisibility | null;
};

type CreateRelationshipMemoryInput = {
  contact_id?: string | null;
  location_id?: string | null;
  source_touchpoint_id?: string | null;
  memory_type: DirectoryRelationshipMemoryType;
  summary: string;
  why_it_matters: string;
  source_label?: string | null;
  visibility?: DirectoryRelationshipMemoryVisibility;
  last_confirmed_at?: string | null;
};

type UpdateRelationshipMemoryInput = {
  status?: "active" | "needs_review" | "archived";
  last_confirmed_at?: string | null;
};

type CreateRelationshipFollowUpInput = {
  contact_id?: string | null;
  location_id?: string | null;
  linked_shoot_id?: string | null;
  source_touchpoint_id?: string | null;
  source_touchpoint_plan_id?: string | null;
  title: string;
  summary?: string | null;
  owner_user_id?: string | null;
  backup_owner_user_id?: string | null;
  due_at: string;
};

type UpdateRelationshipFollowUpInput = {
  status?: "open" | "in_progress" | "completed" | "cancelled";
  resolution_note?: string | null;
};

export async function getOrganizationRelationshipContinuity(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<DirectoryRelationshipContinuityBundle> {
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  return loadRelationshipContinuityBundle(client, auth.tenantId, organizationId, null);
}

export async function getContactRelationshipContinuity(
  client: PoolClient,
  auth: AuthUser,
  contactId: string
): Promise<DirectoryRelationshipContinuityBundle> {
  const contact = await loadOrganizationContactScope(client, auth.tenantId, contactId);
  if (!contact) {
    throw new ApiError(404, "Contact not found");
  }
  return loadRelationshipContinuityBundle(client, auth.tenantId, contact.organization_id, contact.id);
}

export async function createDirectoryTouchpointPlan(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateTouchpointPlanInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  await assertScopeReferences(client, auth.tenantId, organizationId, {
    contactId: input.contact_id ?? null,
    locationId: input.location_id ?? null,
    shootId: input.linked_shoot_id ?? null,
    touchpointPlanId: null
  });
  const dueAt = normalizeIsoDateTime(input.due_at, "Touchpoint due date must be a valid ISO timestamp.");
  const ownerUserId = normalizeOptionalUuid(input.owner_user_id ?? auth.id);
  const backupOwnerUserId = normalizeOptionalUuid(input.backup_owner_user_id);
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO directory_touchpoint_plan (
        tenant_id,
        organization_id,
        location_id,
        contact_id,
        linked_shoot_id,
        template_id,
        category,
        title,
        summary,
        owner_user_id,
        backup_owner_user_id,
        due_at,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      normalizeOptionalUuid(input.location_id),
      normalizeOptionalUuid(input.contact_id),
      normalizeOptionalUuid(input.linked_shoot_id),
      normalizeOptionalUuid(input.template_id),
      input.category,
      input.title.trim(),
      normalizeOptionalText(input.summary),
      ownerUserId,
      backupOwnerUserId,
      dueAt,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.touchpoint_plan_created",
    entityType: "directory_touchpoint_plan",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      contact_id: input.contact_id ?? null,
      location_id: input.location_id ?? null,
      category: input.category,
      due_at: dueAt
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadTouchpointPlanById(client, auth.tenantId, rows[0].id);
}

export async function updateDirectoryTouchpointPlan(
  client: PoolClient,
  auth: AuthUser,
  touchpointPlanId: string,
  input: UpdateTouchpointPlanInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  const existing = await loadTouchpointPlanRowById(client, auth.tenantId, touchpointPlanId);
  if (!existing) {
    throw new ApiError(404, "Touchpoint plan not found");
  }
  if (input.status === "skipped" && !normalizeOptionalText(input.skipped_reason)) {
    throw new ApiError(400, "Skipped touchpoints require a reason.");
  }
  if (input.status === "cancelled" && !normalizeOptionalText(input.cancelled_reason)) {
    throw new ApiError(400, "Cancelled touchpoints require a reason.");
  }
  const nextStatus = input.status ?? existing.status;
  const completedAt = nextStatus === "completed" ? new Date().toISOString() : null;
  await client.query(
    `
      UPDATE directory_touchpoint_plan
      SET
        status = $3,
        completion_note = $4,
        skipped_reason = $5,
        cancelled_reason = $6,
        completed_at = $7,
        updated_by_user_id = $8,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      touchpointPlanId,
      nextStatus,
      normalizeOptionalText(input.completion_note),
      normalizeOptionalText(input.skipped_reason),
      normalizeOptionalText(input.cancelled_reason),
      completedAt,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.touchpoint_plan_updated",
    entityType: "directory_touchpoint_plan",
    entityId: touchpointPlanId,
    previousValues: {
      status: existing.status
    },
    newValues: {
      status: nextStatus
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadTouchpointPlanById(client, auth.tenantId, touchpointPlanId);
}

export async function createDirectoryCommunicationLog(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateCommunicationLogInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  await assertScopeReferences(client, auth.tenantId, organizationId, {
    contactId: input.contact_id ?? null,
    locationId: input.location_id ?? null,
    shootId: input.shoot_id ?? null,
    touchpointPlanId: input.touchpoint_plan_id ?? null
  });
  const occurredAt = input.occurred_at ? normalizeIsoDateTime(input.occurred_at, "Communication time must be a valid ISO timestamp.") : new Date().toISOString();
  const ownerUserId = normalizeOptionalUuid(input.owner_user_id ?? auth.id);
  const followUpOwnerUserId = normalizeOptionalUuid(input.follow_up_owner_user_id ?? ownerUserId);
  const followUpDate = normalizeOptionalDate(input.follow_up_date);

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO directory_touchpoint (
        tenant_id,
        organization_id,
        location_id,
        shoot_id,
        contact_id,
        channel,
        category,
        subject,
        summary,
        outcome,
        outcome_state,
        owner_user_id,
        occurred_at,
        follow_up_date,
        follow_up_needed,
        follow_up_owner_user_id,
        relationship_memory_suggested,
        attachment_reference,
        touchpoint_plan_id,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      normalizeOptionalUuid(input.location_id),
      normalizeOptionalUuid(input.shoot_id),
      normalizeOptionalUuid(input.contact_id),
      input.channel,
      input.category ?? null,
      normalizeOptionalText(input.subject),
      input.summary.trim(),
      normalizeOptionalText(input.outcome),
      input.outcome_state ?? null,
      ownerUserId,
      occurredAt,
      followUpDate,
      Boolean(input.follow_up_needed && followUpDate),
      input.follow_up_needed && followUpDate ? followUpOwnerUserId : null,
      Boolean(input.relationship_memory_suggested && normalizeOptionalText(input.memory_summary)),
      normalizeOptionalText(input.attachment_reference),
      normalizeOptionalUuid(input.touchpoint_plan_id),
      auth.id
    ]
  );

  if (input.touchpoint_plan_id) {
    await client.query(
      `
        UPDATE directory_touchpoint_plan
        SET
          status = 'completed',
          completed_at = COALESCE(completed_at, $3::timestamptz),
          completion_note = COALESCE(completion_note, $4),
          updated_by_user_id = $5,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, input.touchpoint_plan_id, occurredAt, normalizeOptionalText(input.outcome) ?? input.summary.trim(), auth.id]
    );
  }

  if (input.follow_up_needed && followUpDate) {
    await client.query(
      `
        INSERT INTO directory_relationship_follow_up (
          tenant_id,
          organization_id,
          location_id,
          contact_id,
          linked_shoot_id,
          source_touchpoint_id,
          source_touchpoint_plan_id,
          title,
          summary,
          owner_user_id,
          due_at,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$12)
      `,
      [
        auth.tenantId,
        organizationId,
        normalizeOptionalUuid(input.location_id),
        normalizeOptionalUuid(input.contact_id),
        normalizeOptionalUuid(input.shoot_id),
        rows[0].id,
        normalizeOptionalUuid(input.touchpoint_plan_id),
        normalizeOptionalText(input.subject) ?? deriveFollowUpTitle(input.summary),
        normalizeOptionalText(input.outcome) ?? input.summary.trim(),
        followUpOwnerUserId,
        `${followUpDate}T17:00:00.000Z`,
        auth.id
      ]
    );
  }

  if (
    input.relationship_memory_suggested &&
    normalizeOptionalText(input.memory_summary) &&
    normalizeOptionalText(input.memory_why_it_matters)
  ) {
    await client.query(
      `
        INSERT INTO directory_relationship_memory (
          tenant_id,
          organization_id,
          location_id,
          contact_id,
          source_touchpoint_id,
          memory_type,
          summary,
          why_it_matters,
          source_label,
          visibility,
          status,
          created_by_user_id,
          last_confirmed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_review',$11,$12)
      `,
      [
        auth.tenantId,
        organizationId,
        normalizeOptionalUuid(input.location_id),
        normalizeOptionalUuid(input.contact_id),
        rows[0].id,
        input.memory_type ?? "other",
        normalizeOptionalText(input.memory_summary),
        normalizeOptionalText(input.memory_why_it_matters),
        `Communication ${new Date(occurredAt).toISOString()}`,
        input.memory_visibility ?? "assignment_relevant",
        auth.id,
        new Date(occurredAt).toISOString().slice(0, 10)
      ]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.communication_logged",
    entityType: "directory_touchpoint",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      contact_id: input.contact_id ?? null,
      channel: input.channel,
      category: input.category ?? null,
      follow_up_needed: Boolean(input.follow_up_needed && followUpDate),
      relationship_memory_suggested: Boolean(input.relationship_memory_suggested)
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadCommunicationLogById(client, auth.tenantId, rows[0].id);
}

export async function createDirectoryRelationshipMemory(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateRelationshipMemoryInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  await assertScopeReferences(client, auth.tenantId, organizationId, {
    contactId: input.contact_id ?? null,
    locationId: input.location_id ?? null,
    shootId: null,
    touchpointPlanId: null
  });
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO directory_relationship_memory (
        tenant_id,
        organization_id,
        location_id,
        contact_id,
        source_touchpoint_id,
        memory_type,
        summary,
        why_it_matters,
        source_label,
        visibility,
        status,
        created_by_user_id,
        last_confirmed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_review',$11,$12)
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      normalizeOptionalUuid(input.location_id),
      normalizeOptionalUuid(input.contact_id),
      normalizeOptionalUuid(input.source_touchpoint_id),
      input.memory_type,
      input.summary.trim(),
      input.why_it_matters.trim(),
      normalizeOptionalText(input.source_label),
      input.visibility ?? "assignment_relevant",
      auth.id,
      normalizeOptionalDate(input.last_confirmed_at)
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.relationship_memory_created",
    entityType: "directory_relationship_memory",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      contact_id: input.contact_id ?? null,
      memory_type: input.memory_type
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadRelationshipMemoryById(client, auth.tenantId, rows[0].id);
}

export async function updateDirectoryRelationshipMemory(
  client: PoolClient,
  auth: AuthUser,
  memoryId: string,
  input: UpdateRelationshipMemoryInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  const existing = await loadRelationshipMemoryRowById(client, auth.tenantId, memoryId);
  if (!existing) {
    throw new ApiError(404, "Relationship memory entry not found");
  }
  await client.query(
    `
      UPDATE directory_relationship_memory
      SET
        status = COALESCE($3, status),
        reviewed_by_user_id = CASE WHEN $3 IS NULL THEN reviewed_by_user_id ELSE $4 END,
        reviewed_at = CASE WHEN $3 IS NULL THEN reviewed_at ELSE now() END,
        last_confirmed_at = COALESCE($5, last_confirmed_at),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, memoryId, input.status ?? null, auth.id, normalizeOptionalDate(input.last_confirmed_at)]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.relationship_memory_updated",
    entityType: "directory_relationship_memory",
    entityId: memoryId,
    previousValues: {
      status: existing.status,
      last_confirmed_at: existing.last_confirmed_at
    },
    newValues: {
      status: input.status ?? existing.status,
      last_confirmed_at: normalizeOptionalDate(input.last_confirmed_at) ?? existing.last_confirmed_at
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadRelationshipMemoryById(client, auth.tenantId, memoryId);
}

export async function createDirectoryRelationshipFollowUp(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateRelationshipFollowUpInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);
  await assertScopeReferences(client, auth.tenantId, organizationId, {
    contactId: input.contact_id ?? null,
    locationId: input.location_id ?? null,
    shootId: input.linked_shoot_id ?? null,
    touchpointPlanId: input.source_touchpoint_plan_id ?? null
  });
  const dueAt = normalizeIsoDateTime(input.due_at, "Follow-up due date must be a valid ISO timestamp.");
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO directory_relationship_follow_up (
        tenant_id,
        organization_id,
        location_id,
        contact_id,
        linked_shoot_id,
        source_touchpoint_id,
        source_touchpoint_plan_id,
        title,
        summary,
        owner_user_id,
        backup_owner_user_id,
        due_at,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      RETURNING id
    `,
    [
      auth.tenantId,
      organizationId,
      normalizeOptionalUuid(input.location_id),
      normalizeOptionalUuid(input.contact_id),
      normalizeOptionalUuid(input.linked_shoot_id),
      normalizeOptionalUuid(input.source_touchpoint_id),
      normalizeOptionalUuid(input.source_touchpoint_plan_id),
      input.title.trim(),
      normalizeOptionalText(input.summary),
      normalizeOptionalUuid(input.owner_user_id ?? auth.id),
      normalizeOptionalUuid(input.backup_owner_user_id),
      dueAt,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.relationship_follow_up_created",
    entityType: "directory_relationship_follow_up",
    entityId: rows[0].id,
    metadata: {
      organization_id: organizationId,
      contact_id: input.contact_id ?? null,
      due_at: dueAt
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadRelationshipFollowUpById(client, auth.tenantId, rows[0].id);
}

export async function updateDirectoryRelationshipFollowUp(
  client: PoolClient,
  auth: AuthUser,
  followUpId: string,
  input: UpdateRelationshipFollowUpInput,
  meta: RequestMeta = {}
) {
  assertManageAccess(auth);
  const existing = await loadRelationshipFollowUpRowById(client, auth.tenantId, followUpId);
  if (!existing) {
    throw new ApiError(404, "Relationship follow-up not found");
  }
  const nextStatus = input.status ?? existing.status;
  const completedAt = nextStatus === "completed" ? new Date().toISOString() : null;
  await client.query(
    `
      UPDATE directory_relationship_follow_up
      SET
        status = $3,
        completed_at = $4,
        resolution_note = $5,
        updated_by_user_id = $6,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, followUpId, stripOverdueStatus(nextStatus), completedAt, normalizeOptionalText(input.resolution_note), auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.relationship_follow_up_updated",
    entityType: "directory_relationship_follow_up",
    entityId: followUpId,
    previousValues: {
      status: existing.status,
      resolution_note: existing.resolution_note
    },
    newValues: {
      status: nextStatus,
      resolution_note: normalizeOptionalText(input.resolution_note)
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadRelationshipFollowUpById(client, auth.tenantId, followUpId);
}

async function loadRelationshipContinuityBundle(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string | null
): Promise<DirectoryRelationshipContinuityBundle> {
  const [templates, touchpointPlans, communicationLogs, relationshipMemory, followUps, staleKeyContactCount] = await Promise.all([
    listTouchpointTemplates(client, tenantId),
    listTouchpointPlans(client, tenantId, organizationId, contactId),
    listCommunicationLogs(client, tenantId, organizationId, contactId),
    listRelationshipMemory(client, tenantId, organizationId, contactId),
    listRelationshipFollowUps(client, tenantId, organizationId, contactId),
    loadStaleKeyContactCount(client, tenantId, organizationId, contactId)
  ]);

  return {
    scope: contactId ? "contact" : "organization",
    organization_id: organizationId,
    contact_id: contactId,
    generated_at: new Date().toISOString(),
    summary: buildRelationshipContinuitySummary({
      communicationLogs,
      touchpointPlans,
      relationshipMemory,
      followUps,
      staleKeyContactCount
    }),
    touchpoint_templates: templates,
    touchpoint_plans: touchpointPlans,
    communication_logs: communicationLogs,
    relationship_memory: relationshipMemory,
    follow_ups: followUps
  };
}

async function listTouchpointTemplates(client: PoolClient, tenantId: string): Promise<DirectoryTouchpointPlanTemplateRecord[]> {
  const { rows } = await client.query<TouchpointTemplateRow>(
    `
      SELECT
        id,
        template_key,
        template_name,
        category,
        scope_hint,
        summary,
        default_offset_days,
        default_due_time::text,
        active_status
      FROM directory_touchpoint_plan_template
      WHERE tenant_id = $1
        AND active_status = true
      ORDER BY template_name
    `,
    [tenantId]
  );
  return rows.map((row) => ({ ...row }));
}

async function listTouchpointPlans(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string | null
): Promise<DirectoryTouchpointPlanRecord[]> {
  const { rows } = await client.query<TouchpointPlanRow>(
    `
      SELECT
        plan.id,
        plan.organization_id,
        plan.location_id,
        plan.contact_id,
        plan.linked_shoot_id,
        plan.template_id,
        plan.category,
        plan.status,
        plan.title,
        plan.summary,
        plan.owner_user_id,
        owner.full_name AS owner_name,
        plan.backup_owner_user_id,
        backup.full_name AS backup_owner_name,
        backup.email AS backup_owner_email,
        backup.department::text AS backup_owner_department,
        backup.status::text AS backup_owner_status,
        plan.due_at::text,
        plan.completed_at::text,
        plan.skipped_reason,
        plan.cancelled_reason,
        plan.completion_note,
        plan.created_at::text,
        plan.updated_at::text
      FROM directory_touchpoint_plan plan
      LEFT JOIN app_user owner
        ON owner.id = plan.owner_user_id
      LEFT JOIN app_user backup
        ON backup.id = plan.backup_owner_user_id
      WHERE plan.tenant_id = $1
        AND plan.organization_id = $2
        AND ($3::uuid IS NULL OR plan.contact_id = $3)
      ORDER BY
        CASE
          WHEN plan.status = 'completed' THEN 4
          WHEN plan.status = 'cancelled' THEN 5
          WHEN plan.status = 'skipped' THEN 6
          ELSE 1
        END,
        plan.due_at ASC,
        plan.created_at DESC
    `,
    [tenantId, organizationId, contactId]
  );
  return rows.map(mapTouchpointPlan);
}

async function listCommunicationLogs(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string | null
): Promise<DirectoryTouchpointRecord[]> {
  const { rows } = await client.query<CommunicationLogRow>(
    `
      SELECT
        dt.id,
        dt.organization_id,
        dt.location_id,
        dt.shoot_id,
        dt.contact_id,
        dt.channel,
        dt.category,
        dt.subject,
        dt.summary,
        dt.outcome,
        dt.outcome_state,
        dt.owner_user_id,
        owner.full_name AS owner_name,
        dt.follow_up_date::text,
        dt.follow_up_needed,
        dt.follow_up_owner_user_id,
        follow_up_owner.full_name AS follow_up_owner_name,
        follow_up_owner.email AS follow_up_owner_email,
        follow_up_owner.department::text AS follow_up_owner_department,
        follow_up_owner.status::text AS follow_up_owner_status,
        dt.relationship_memory_suggested,
        dt.attachment_reference,
        dt.touchpoint_plan_id,
        dt.occurred_at::text,
        dt.created_at::text,
        dt.updated_at::text
      FROM directory_touchpoint dt
      LEFT JOIN app_user owner
        ON owner.id = dt.owner_user_id
      LEFT JOIN app_user follow_up_owner
        ON follow_up_owner.id = dt.follow_up_owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.organization_id = $2
        AND ($3::uuid IS NULL OR dt.contact_id = $3)
      ORDER BY dt.occurred_at DESC, dt.created_at DESC
      LIMIT 24
    `,
    [tenantId, organizationId, contactId]
  );
  return rows.map(mapCommunicationLog);
}

async function listRelationshipMemory(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string | null
): Promise<DirectoryRelationshipMemoryRecord[]> {
  const { rows } = await client.query<RelationshipMemoryRow>(
    `
      SELECT
        memory.id,
        memory.organization_id,
        memory.location_id,
        memory.contact_id,
        memory.source_touchpoint_id,
        memory.memory_type,
        memory.summary,
        memory.why_it_matters,
        memory.source_label,
        memory.visibility,
        memory.status,
        memory.created_by_user_id,
        creator.full_name AS created_by_name,
        creator.email AS created_by_email,
        creator.department::text AS created_by_department,
        creator.status::text AS created_by_status,
        memory.reviewed_by_user_id,
        reviewer.full_name AS reviewed_by_name,
        reviewer.email AS reviewed_by_email,
        reviewer.department::text AS reviewed_by_department,
        reviewer.status::text AS reviewed_by_status,
        memory.reviewed_at::text,
        memory.last_confirmed_at::text,
        memory.created_at::text,
        memory.updated_at::text
      FROM directory_relationship_memory memory
      LEFT JOIN app_user creator
        ON creator.id = memory.created_by_user_id
      LEFT JOIN app_user reviewer
        ON reviewer.id = memory.reviewed_by_user_id
      WHERE memory.tenant_id = $1
        AND memory.organization_id = $2
        AND ($3::uuid IS NULL OR memory.contact_id = $3 OR memory.contact_id IS NULL)
      ORDER BY
        CASE memory.status
          WHEN 'active' THEN 1
          WHEN 'needs_review' THEN 2
          ELSE 3
        END,
        memory.updated_at DESC
      LIMIT 24
    `,
    [tenantId, organizationId, contactId]
  );
  return rows.map(mapRelationshipMemory);
}

async function listRelationshipFollowUps(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string | null
): Promise<DirectoryRelationshipFollowUpRecord[]> {
  const { rows } = await client.query<RelationshipFollowUpRow>(
    `
      SELECT
        follow_up.id,
        follow_up.organization_id,
        follow_up.location_id,
        follow_up.contact_id,
        follow_up.linked_shoot_id,
        follow_up.source_touchpoint_id,
        follow_up.source_touchpoint_plan_id,
        follow_up.title,
        follow_up.summary,
        follow_up.owner_user_id,
        owner.full_name AS owner_name,
        owner.email AS owner_email,
        owner.department::text AS owner_department,
        owner.status::text AS owner_status,
        follow_up.backup_owner_user_id,
        backup.full_name AS backup_owner_name,
        backup.email AS backup_owner_email,
        backup.department::text AS backup_owner_department,
        backup.status::text AS backup_owner_status,
        follow_up.due_at::text,
        follow_up.status,
        follow_up.completed_at::text,
        follow_up.resolution_note,
        follow_up.created_at::text,
        follow_up.updated_at::text
      FROM directory_relationship_follow_up follow_up
      LEFT JOIN app_user owner
        ON owner.id = follow_up.owner_user_id
      LEFT JOIN app_user backup
        ON backup.id = follow_up.backup_owner_user_id
      WHERE follow_up.tenant_id = $1
        AND follow_up.organization_id = $2
        AND ($3::uuid IS NULL OR follow_up.contact_id = $3 OR follow_up.contact_id IS NULL)
      ORDER BY
        CASE
          WHEN follow_up.status IN ('open', 'in_progress') THEN 1
          ELSE 2
        END,
        follow_up.due_at ASC,
        follow_up.created_at DESC
      LIMIT 24
    `,
    [tenantId, organizationId, contactId]
  );
  return rows.map(mapRelationshipFollowUp);
}

async function loadStaleKeyContactCount(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string | null
): Promise<number> {
  const { rows } = await client.query<ContactRiskRow>(
    `
      SELECT count(*)::text AS stale_key_contact_count
      FROM organization_contact contact
      WHERE contact.tenant_id = $1
        AND contact.organization_id = $2
        AND ($3::uuid IS NULL OR contact.id = $3)
        AND contact.operational_importance IN ('critical', 'high')
        AND (
          contact.contact_status = 'needs_review'
          OR contact.last_confirmed_at IS NULL
          OR contact.last_confirmed_at < (current_date - interval '180 days')
          OR contact.primary_internal_owner_user_id IS NULL
          OR contact.backup_internal_owner_user_id IS NULL
        )
    `,
    [tenantId, organizationId, contactId]
  );
  return Number(rows[0]?.stale_key_contact_count ?? 0);
}

async function loadTouchpointPlanById(client: PoolClient, tenantId: string, touchpointPlanId: string) {
  const row = await loadTouchpointPlanRowById(client, tenantId, touchpointPlanId);
  return row ? mapTouchpointPlan(row) : null;
}

async function loadTouchpointPlanRowById(
  client: PoolClient,
  tenantId: string,
  touchpointPlanId: string
): Promise<TouchpointPlanRow | null> {
  const { rows } = await client.query<TouchpointPlanRow>(
    `
      SELECT
        plan.id,
        plan.organization_id,
        plan.location_id,
        plan.contact_id,
        plan.linked_shoot_id,
        plan.template_id,
        plan.category,
        plan.status,
        plan.title,
        plan.summary,
        plan.owner_user_id,
        owner.full_name AS owner_name,
        plan.backup_owner_user_id,
        backup.full_name AS backup_owner_name,
        backup.email AS backup_owner_email,
        backup.department::text AS backup_owner_department,
        backup.status::text AS backup_owner_status,
        plan.due_at::text,
        plan.completed_at::text,
        plan.skipped_reason,
        plan.cancelled_reason,
        plan.completion_note,
        plan.created_at::text,
        plan.updated_at::text
      FROM directory_touchpoint_plan plan
      LEFT JOIN app_user owner
        ON owner.id = plan.owner_user_id
      LEFT JOIN app_user backup
        ON backup.id = plan.backup_owner_user_id
      WHERE plan.tenant_id = $1
        AND plan.id = $2
      LIMIT 1
    `,
    [tenantId, touchpointPlanId]
  );
  return rows[0] ?? null;
}

async function loadCommunicationLogById(client: PoolClient, tenantId: string, touchpointId: string) {
  const row = await loadCommunicationLogRowById(client, tenantId, touchpointId);
  return row ? mapCommunicationLog(row) : null;
}

async function loadCommunicationLogRowById(
  client: PoolClient,
  tenantId: string,
  touchpointId: string
): Promise<CommunicationLogRow | null> {
  const { rows } = await client.query<CommunicationLogRow>(
    `
      SELECT
        dt.id,
        dt.organization_id,
        dt.location_id,
        dt.shoot_id,
        dt.contact_id,
        dt.channel,
        dt.category,
        dt.subject,
        dt.summary,
        dt.outcome,
        dt.outcome_state,
        dt.owner_user_id,
        owner.full_name AS owner_name,
        dt.follow_up_date::text,
        dt.follow_up_needed,
        dt.follow_up_owner_user_id,
        follow_up_owner.full_name AS follow_up_owner_name,
        follow_up_owner.email AS follow_up_owner_email,
        follow_up_owner.department::text AS follow_up_owner_department,
        follow_up_owner.status::text AS follow_up_owner_status,
        dt.relationship_memory_suggested,
        dt.attachment_reference,
        dt.touchpoint_plan_id,
        dt.occurred_at::text,
        dt.created_at::text,
        dt.updated_at::text
      FROM directory_touchpoint dt
      LEFT JOIN app_user owner
        ON owner.id = dt.owner_user_id
      LEFT JOIN app_user follow_up_owner
        ON follow_up_owner.id = dt.follow_up_owner_user_id
      WHERE dt.tenant_id = $1
        AND dt.id = $2
      LIMIT 1
    `,
    [tenantId, touchpointId]
  );
  return rows[0] ?? null;
}

async function loadRelationshipMemoryById(client: PoolClient, tenantId: string, memoryId: string) {
  const row = await loadRelationshipMemoryRowById(client, tenantId, memoryId);
  return row ? mapRelationshipMemory(row) : null;
}

async function loadRelationshipMemoryRowById(
  client: PoolClient,
  tenantId: string,
  memoryId: string
): Promise<RelationshipMemoryRow | null> {
  const { rows } = await client.query<RelationshipMemoryRow>(
    `
      SELECT
        memory.id,
        memory.organization_id,
        memory.location_id,
        memory.contact_id,
        memory.source_touchpoint_id,
        memory.memory_type,
        memory.summary,
        memory.why_it_matters,
        memory.source_label,
        memory.visibility,
        memory.status,
        memory.created_by_user_id,
        creator.full_name AS created_by_name,
        creator.email AS created_by_email,
        creator.department::text AS created_by_department,
        creator.status::text AS created_by_status,
        memory.reviewed_by_user_id,
        reviewer.full_name AS reviewed_by_name,
        reviewer.email AS reviewed_by_email,
        reviewer.department::text AS reviewed_by_department,
        reviewer.status::text AS reviewed_by_status,
        memory.reviewed_at::text,
        memory.last_confirmed_at::text,
        memory.created_at::text,
        memory.updated_at::text
      FROM directory_relationship_memory memory
      LEFT JOIN app_user creator
        ON creator.id = memory.created_by_user_id
      LEFT JOIN app_user reviewer
        ON reviewer.id = memory.reviewed_by_user_id
      WHERE memory.tenant_id = $1
        AND memory.id = $2
      LIMIT 1
    `,
    [tenantId, memoryId]
  );
  return rows[0] ?? null;
}

async function loadRelationshipFollowUpById(client: PoolClient, tenantId: string, followUpId: string) {
  const row = await loadRelationshipFollowUpRowById(client, tenantId, followUpId);
  return row ? mapRelationshipFollowUp(row) : null;
}

async function loadRelationshipFollowUpRowById(
  client: PoolClient,
  tenantId: string,
  followUpId: string
): Promise<RelationshipFollowUpRow | null> {
  const { rows } = await client.query<RelationshipFollowUpRow>(
    `
      SELECT
        follow_up.id,
        follow_up.organization_id,
        follow_up.location_id,
        follow_up.contact_id,
        follow_up.linked_shoot_id,
        follow_up.source_touchpoint_id,
        follow_up.source_touchpoint_plan_id,
        follow_up.title,
        follow_up.summary,
        follow_up.owner_user_id,
        owner.full_name AS owner_name,
        owner.email AS owner_email,
        owner.department::text AS owner_department,
        owner.status::text AS owner_status,
        follow_up.backup_owner_user_id,
        backup.full_name AS backup_owner_name,
        backup.email AS backup_owner_email,
        backup.department::text AS backup_owner_department,
        backup.status::text AS backup_owner_status,
        follow_up.due_at::text,
        follow_up.status,
        follow_up.completed_at::text,
        follow_up.resolution_note,
        follow_up.created_at::text,
        follow_up.updated_at::text
      FROM directory_relationship_follow_up follow_up
      LEFT JOIN app_user owner
        ON owner.id = follow_up.owner_user_id
      LEFT JOIN app_user backup
        ON backup.id = follow_up.backup_owner_user_id
      WHERE follow_up.tenant_id = $1
        AND follow_up.id = $2
      LIMIT 1
    `,
    [tenantId, followUpId]
  );
  return rows[0] ?? null;
}

async function loadOrganizationContactScope(
  client: PoolClient,
  tenantId: string,
  contactId: string
): Promise<{ id: string; organization_id: string } | null> {
  const { rows } = await client.query<{ id: string; organization_id: string }>(
    `
      SELECT id, organization_id
      FROM organization_contact
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, contactId]
  );
  return rows[0] ?? null;
}

async function assertOrganizationExists(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Organization not found");
  }
}

async function assertScopeReferences(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  input: {
    contactId: string | null;
    locationId: string | null;
    shootId: string | null;
    touchpointPlanId: string | null;
  }
) {
  if (input.contactId) {
    const contact = await loadOrganizationContactScope(client, tenantId, input.contactId);
    if (!contact || contact.organization_id !== organizationId) {
      throw new ApiError(400, "The selected contact does not belong to this organization.");
    }
  }

  if (input.locationId) {
    const { rows } = await client.query<{ id: string }>(
      `
        SELECT id
        FROM shoot_location
        WHERE tenant_id = $1
          AND organization_id = $2
          AND id = $3
        LIMIT 1
      `,
      [tenantId, organizationId, input.locationId]
    );
    if (!rows[0]) {
      throw new ApiError(400, "The selected location does not belong to this organization.");
    }
  }

  if (input.shootId) {
    const { rows } = await client.query<{ id: string }>(
      `
        SELECT id
        FROM shoot
        WHERE tenant_id = $1
          AND organization_id = $2
          AND id = $3
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [tenantId, organizationId, input.shootId]
    );
    if (!rows[0]) {
      throw new ApiError(400, "The selected shoot does not belong to this organization.");
    }
  }

  if (input.touchpointPlanId) {
    const { rows } = await client.query<{ id: string }>(
      `
        SELECT id
        FROM directory_touchpoint_plan
        WHERE tenant_id = $1
          AND organization_id = $2
          AND id = $3
        LIMIT 1
      `,
      [tenantId, organizationId, input.touchpointPlanId]
    );
    if (!rows[0]) {
      throw new ApiError(400, "The selected touchpoint plan does not belong to this organization.");
    }
  }
}

function buildRelationshipContinuitySummary(input: {
  communicationLogs: DirectoryTouchpointRecord[];
  touchpointPlans: DirectoryTouchpointPlanRecord[];
  relationshipMemory: DirectoryRelationshipMemoryRecord[];
  followUps: DirectoryRelationshipFollowUpRecord[];
  staleKeyContactCount: number;
}) {
  const activeMemoryCount = input.relationshipMemory.filter((entry) => entry.status === "active").length;
  const needsReviewMemoryCount = input.relationshipMemory.filter((entry) => entry.status === "needs_review").length;
  const openFollowUps = input.followUps.filter((entry) => {
    const status = deriveFollowUpStatus(entry.status, entry.due_at);
    return status === "open" || status === "in_progress" || status === "overdue";
  });
  const overdueFollowUpCount = input.followUps.filter((entry) => deriveFollowUpStatus(entry.status, entry.due_at) === "overdue").length;
  const dueSoonTouchpointCount = input.touchpointPlans.filter((entry) => deriveTouchpointPlanStatus(entry.status, entry.due_at) === "due_soon").length;
  const overdueTouchpointCount = input.touchpointPlans.filter((entry) => deriveTouchpointPlanStatus(entry.status, entry.due_at) === "overdue").length;
  const nextTouchpoint =
    [...input.touchpointPlans]
      .map((plan) => ({ plan, status: deriveTouchpointPlanStatus(plan.status, plan.due_at) }))
      .filter(({ status }) => status === "planned" || status === "due_soon" || status === "overdue")
      .sort((left, right) => Date.parse(left.plan.due_at) - Date.parse(right.plan.due_at))[0] ?? null;
  const lastCommunication = input.communicationLogs[0] ?? null;
  const relationshipHealthState = deriveRelationshipHealthState({
    lastCommunicationAt: lastCommunication?.occurred_at ?? null,
    staleKeyContactCount: input.staleKeyContactCount,
    dueSoonTouchpointCount,
    overdueTouchpointCount,
    openFollowUpCount: openFollowUps.length,
    overdueFollowUpCount,
    needsReviewMemoryCount,
    communicationCount: input.communicationLogs.length,
    activeMemoryCount
  });

  return {
    relationship_health_state: relationshipHealthState,
    relationship_health_summary: summarizeRelationshipHealth({
      relationshipHealthState,
      staleKeyContactCount: input.staleKeyContactCount,
      dueSoonTouchpointCount,
      overdueTouchpointCount,
      openFollowUpCount: openFollowUps.length,
      overdueFollowUpCount,
      needsReviewMemoryCount,
      lastCommunicationAt: lastCommunication?.occurred_at ?? null
    }),
    last_communication_at: lastCommunication?.occurred_at ?? null,
    last_communication_label: lastCommunication
      ? `${labelForChannel(lastCommunication.channel)} logged ${formatDateLabel(lastCommunication.occurred_at)}`
      : "No communication history logged yet",
    next_touchpoint_due_at: nextTouchpoint?.plan.due_at ?? null,
    next_touchpoint_label: nextTouchpoint
      ? `${nextTouchpoint.plan.title} ${formatDueLabel(nextTouchpoint.plan.due_at)}`
      : "No planned touchpoints yet",
    open_follow_up_count: openFollowUps.length,
    overdue_follow_up_count: overdueFollowUpCount,
    due_soon_touchpoint_count: dueSoonTouchpointCount,
    overdue_touchpoint_count: overdueTouchpointCount,
    active_memory_count: activeMemoryCount,
    needs_review_memory_count: needsReviewMemoryCount,
    stale_key_contact_count: input.staleKeyContactCount
  };
}

function deriveRelationshipHealthState(input: {
  lastCommunicationAt: string | null;
  staleKeyContactCount: number;
  dueSoonTouchpointCount: number;
  overdueTouchpointCount: number;
  openFollowUpCount: number;
  overdueFollowUpCount: number;
  needsReviewMemoryCount: number;
  communicationCount: number;
  activeMemoryCount: number;
}): DirectoryRelationshipHealthState {
  if (input.overdueFollowUpCount > 0 || input.overdueTouchpointCount > 0) {
    return "at_risk";
  }
  if (input.staleKeyContactCount > 0 || input.needsReviewMemoryCount > 0) {
    return "fragile";
  }
  if (input.openFollowUpCount > 0 || input.dueSoonTouchpointCount > 0) {
    return "needs_attention";
  }
  if (input.communicationCount > 0 || input.activeMemoryCount > 0 || input.lastCommunicationAt) {
    return "healthy";
  }
  return "unknown";
}

function summarizeRelationshipHealth(input: {
  relationshipHealthState: DirectoryRelationshipHealthState;
  staleKeyContactCount: number;
  dueSoonTouchpointCount: number;
  overdueTouchpointCount: number;
  openFollowUpCount: number;
  overdueFollowUpCount: number;
  needsReviewMemoryCount: number;
  lastCommunicationAt: string | null;
}) {
  const reasons: string[] = [];
  if (input.overdueFollowUpCount > 0) {
    reasons.push(`${input.overdueFollowUpCount} overdue follow-up${input.overdueFollowUpCount === 1 ? "" : "s"}`);
  }
  if (input.overdueTouchpointCount > 0) {
    reasons.push(`${input.overdueTouchpointCount} overdue touchpoint${input.overdueTouchpointCount === 1 ? "" : "s"}`);
  }
  if (input.staleKeyContactCount > 0) {
    reasons.push(`${input.staleKeyContactCount} key contact${input.staleKeyContactCount === 1 ? "" : "s"} need review`);
  }
  if (input.needsReviewMemoryCount > 0) {
    reasons.push(`${input.needsReviewMemoryCount} memory update${input.needsReviewMemoryCount === 1 ? "" : "s"} pending review`);
  }
  if (!reasons.length && input.openFollowUpCount > 0) {
    reasons.push(`${input.openFollowUpCount} active follow-up${input.openFollowUpCount === 1 ? "" : "s"}`);
  }
  if (!reasons.length && input.dueSoonTouchpointCount > 0) {
    reasons.push(`${input.dueSoonTouchpointCount} touchpoint${input.dueSoonTouchpointCount === 1 ? "" : "s"} due soon`);
  }
  if (!reasons.length && input.lastCommunicationAt) {
    reasons.push(`last contact ${formatDateLabel(input.lastCommunicationAt)}`);
  }
  if (!reasons.length) {
    return "No relationship continuity signals captured yet";
  }
  return reasons.join(" | ");
}

function deriveTouchpointPlanStatus(status: DirectoryTouchpointPlanStatus, dueAt: string): DirectoryTouchpointPlanStatus {
  if (status !== "planned" && status !== "due_soon" && status !== "overdue") {
    return status;
  }
  const dueTime = Date.parse(dueAt);
  if (Number.isNaN(dueTime)) {
    return "planned";
  }
  const now = Date.now();
  if (dueTime < now) {
    return "overdue";
  }
  if (dueTime <= now + 7 * 24 * 60 * 60 * 1000) {
    return "due_soon";
  }
  return "planned";
}

function deriveFollowUpStatus(status: DirectoryRelationshipFollowUpRecord["status"], dueAt: string) {
  if (status === "completed" || status === "cancelled") {
    return status;
  }
  const dueTime = Date.parse(dueAt);
  if (!Number.isNaN(dueTime) && dueTime < Date.now()) {
    return "overdue";
  }
  return status;
}

function stripOverdueStatus(status: "open" | "in_progress" | "completed" | "cancelled" | "overdue") {
  return status === "overdue" ? "open" : status;
}

function mapTouchpointPlan(row: TouchpointPlanRow): DirectoryTouchpointPlanRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    location_id: row.location_id,
    contact_id: row.contact_id,
    linked_shoot_id: row.linked_shoot_id,
    template_id: row.template_id,
    category: row.category,
    title: row.title,
    summary: row.summary,
    status: deriveTouchpointPlanStatus(row.status, row.due_at),
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    backup_owner: mapInternalOwner(
      row.backup_owner_user_id,
      row.backup_owner_name,
      row.backup_owner_email,
      row.backup_owner_department,
      row.backup_owner_status
    ),
    due_at: row.due_at,
    completed_at: row.completed_at,
    skipped_reason: row.skipped_reason,
    cancelled_reason: row.cancelled_reason,
    completion_note: row.completion_note,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapCommunicationLog(row: CommunicationLogRow): DirectoryTouchpointRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    location_id: row.location_id,
    shoot_id: row.shoot_id,
    contact_id: row.contact_id,
    channel: row.channel,
    category: row.category,
    subject: row.subject,
    summary: row.summary,
    outcome: row.outcome,
    outcome_state: row.outcome_state,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    occurred_at: row.occurred_at,
    follow_up_date: row.follow_up_date,
    follow_up_needed: row.follow_up_needed,
    follow_up_owner: mapInternalOwner(
      row.follow_up_owner_user_id,
      row.follow_up_owner_name,
      row.follow_up_owner_email,
      row.follow_up_owner_department,
      row.follow_up_owner_status
    ),
    relationship_memory_suggested: row.relationship_memory_suggested,
    attachment_reference: row.attachment_reference,
    touchpoint_plan_id: row.touchpoint_plan_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapRelationshipMemory(row: RelationshipMemoryRow): DirectoryRelationshipMemoryRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    location_id: row.location_id,
    contact_id: row.contact_id,
    source_touchpoint_id: row.source_touchpoint_id,
    memory_type: row.memory_type,
    summary: row.summary,
    why_it_matters: row.why_it_matters,
    source_label: row.source_label,
    visibility: row.visibility,
    status: row.status,
    created_by: mapInternalOwner(
      row.created_by_user_id,
      row.created_by_name,
      row.created_by_email,
      row.created_by_department,
      row.created_by_status
    ),
    reviewed_by: mapInternalOwner(
      row.reviewed_by_user_id,
      row.reviewed_by_name,
      row.reviewed_by_email,
      row.reviewed_by_department,
      row.reviewed_by_status
    ),
    reviewed_at: row.reviewed_at,
    last_confirmed_at: row.last_confirmed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapRelationshipFollowUp(row: RelationshipFollowUpRow): DirectoryRelationshipFollowUpRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    location_id: row.location_id,
    contact_id: row.contact_id,
    linked_shoot_id: row.linked_shoot_id,
    source_touchpoint_id: row.source_touchpoint_id,
    source_touchpoint_plan_id: row.source_touchpoint_plan_id,
    title: row.title,
    summary: row.summary,
    owner: mapInternalOwner(row.owner_user_id, row.owner_name, row.owner_email, row.owner_department, row.owner_status),
    backup_owner: mapInternalOwner(
      row.backup_owner_user_id,
      row.backup_owner_name,
      row.backup_owner_email,
      row.backup_owner_department,
      row.backup_owner_status
    ),
    due_at: row.due_at,
    status: deriveFollowUpStatus(row.status, row.due_at),
    completed_at: row.completed_at,
    resolution_note: row.resolution_note,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapInternalOwner(
  userId: string | null,
  fullName: string | null,
  email: string | null,
  department: string | null,
  status: string | null
): DirectoryInternalOwnerRecord | null {
  if (!userId) {
    return null;
  }
  return {
    user_id: userId,
    full_name: fullName ?? email ?? "Unknown user",
    email,
    department,
    status
  };
}

function assertManageAccess(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "You do not have permission to manage relationship continuity.");
  }
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalUuid(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalDate(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApiError(400, "Dates must use YYYY-MM-DD.");
  }
  return normalized;
}

function normalizeIsoDateTime(value: string, message: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ApiError(400, message);
  }
  return new Date(parsed).toISOString();
}

function deriveFollowUpTitle(summary: string) {
  const normalized = summary.trim();
  if (!normalized) {
    return "Customer follow-up";
  }
  const firstSentence = normalized.split(/[.!?]/)[0]?.trim() ?? normalized;
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trimEnd()}...` : firstSentence;
}

function formatDueLabel(value: string) {
  const dueTime = Date.parse(value);
  if (Number.isNaN(dueTime)) {
    return "due soon";
  }
  if (dueTime < Date.now()) {
    return `was due ${formatDateLabel(value)}`;
  }
  return `due ${formatDateLabel(value)}`;
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function labelForChannel(channel: DirectoryTouchpointRecord["channel"]) {
  switch (channel) {
    case "call":
      return "Call";
    case "email":
      return "Email";
    case "text":
      return "Text";
    case "meeting":
      return "Meeting";
    case "onsite":
      return "On-site visit";
    case "note":
      return "Internal note";
    case "picture_day_conversation":
      return "Picture day conversation";
    case "internal_debrief":
      return "Internal debrief";
    case "portal_message":
      return "Portal message";
    default:
      return "Communication";
  }
}
