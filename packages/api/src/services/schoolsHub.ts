import type { PoolClient } from "pg";
import { canManageSchoolsHub, getSchoolsHubAccessScope } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  CreateSchoolDeliverableInput,
  SchoolDeliverableRecord,
  SchoolDeliverableStatus,
  SchoolDeliverableType,
  SchoolDeliveryMethod,
  SchoolExternalSyncRecord,
  SchoolJobRecord,
  SchoolJobStatus,
  SchoolJobType,
  SchoolWorkItemRecord,
  SchoolWorkItemDetailResponse,
  SchoolWorkPriority,
  SchoolWorkSourceSystem,
  SchoolWorkStage,
  SchoolWorkStatus,
  SchoolWorkTimelineEvent,
  SchoolWorkType,
  SchoolWorkWaitingOn,
  SchoolsHubReferenceData,
  SchoolsHubReferenceOption,
  SchoolsHubSection,
  SchoolsHubSummary,
  SchoolsHubTone,
  SchoolsHubWorkspaceResponse
} from "../types/schoolsHub.js";
import { createAuditLog } from "./audit.js";
import { queueNotificationDispatch } from "./opsNotifications.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sourceSurface?: string | null;
};

type SchoolsHubFilters = {
  anchor_date?: string | null;
  search?: string | null;
  owner_user_id?: string | null;
  school_id?: string | null;
  job_id?: string | null;
  work_type?: SchoolWorkType | null;
  priority?: SchoolWorkPriority | null;
  waiting_on?: SchoolWorkWaitingOn | null;
  page?: number | null;
  page_size?: number | null;
};

type SchoolsHubMutationOptions = {
  allowSourceMutation?: boolean;
};

type CreateSchoolJobInput = {
  organization_id: string;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  job_type: SchoolJobType;
  title: string;
  event_date?: string | null;
  due_date?: string | null;
  owner_user_id?: string | null;
  source_system?: SchoolWorkSourceSystem;
  source_reference?: string | null;
  status?: SchoolJobStatus;
  notes?: string | null;
};

export type UpdateSchoolJobInput = {
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  title?: string | null;
  event_date?: string | null;
  due_date?: string | null;
  owner_user_id?: string | null;
  source_system?: SchoolWorkSourceSystem | null;
  source_reference?: string | null;
  status?: SchoolJobStatus | null;
  notes?: string | null;
};

type CreateSchoolWorkItemInput = {
  organization_id: string;
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  linked_contact_id?: string | null;
  linked_follow_up_id?: string | null;
  linked_production_project_id?: string | null;
  work_type: SchoolWorkType;
  title: string;
  description?: string | null;
  owner_user_id?: string | null;
  status?: SchoolWorkStatus;
  stage?: SchoolWorkStage;
  priority?: SchoolWorkPriority;
  due_date?: string | null;
  sla_date?: string | null;
  blocker_reason?: string | null;
  waiting_on?: SchoolWorkWaitingOn;
  source_system?: SchoolWorkSourceSystem;
  source_reference?: string | null;
  generated_by_rule?: boolean;
  notes?: string | null;
};

export type UpdateSchoolWorkItemInput = {
  school_job_id?: string | null;
  linked_shoot_id?: string | null;
  linked_location_id?: string | null;
  linked_contact_id?: string | null;
  linked_follow_up_id?: string | null;
  linked_production_project_id?: string | null;
  title?: string | null;
  description?: string | null;
  owner_user_id?: string | null;
  status?: SchoolWorkStatus | null;
  stage?: SchoolWorkStage | null;
  priority?: SchoolWorkPriority | null;
  due_date?: string | null;
  sla_date?: string | null;
  blocker_reason?: string | null;
  waiting_on?: SchoolWorkWaitingOn | null;
  expected_updated_at?: string | null;
  source_system?: SchoolWorkSourceSystem | null;
  source_reference?: string | null;
  generated_by_rule?: boolean | null;
  notes?: string | null;
};

type BulkUpdateSchoolWorkItemsInput = {
  ids: string[];
  owner_user_id?: string | null;
  status?: SchoolWorkStatus | null;
  stage?: SchoolWorkStage | null;
  priority?: SchoolWorkPriority | null;
  due_date?: string | null;
  blocker_reason?: string | null;
  waiting_on?: SchoolWorkWaitingOn | null;
};

type SchoolJobRow = {
  id: string;
  organization_id: string;
  school_name: string;
  school_logo_url: string | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  job_type: SchoolJobType;
  status: SchoolJobStatus;
  title: string;
  event_date: string | null;
  due_date: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  monday_external_record_id: string | null;
  monday_external_payload: Record<string, unknown> | null;
  monday_sync_operation_id: string | null;
  monday_sync_operation_status: string | null;
  monday_sync_updated_at: string | null;
  monday_sync_error: string | null;
  monday_sync_conflict_summary: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolWorkItemRow = {
  id: string;
  organization_id: string;
  school_name: string;
  school_logo_url: string | null;
  school_job_id: string | null;
  school_job_title: string | null;
  school_job_type: SchoolJobType | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  linked_contact_id: string | null;
  linked_contact_name: string | null;
  linked_follow_up_id: string | null;
  linked_follow_up_title: string | null;
  linked_production_project_id: string | null;
  linked_production_project_title: string | null;
  work_type: SchoolWorkType;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  status: SchoolWorkStatus;
  stage: SchoolWorkStage;
  priority: SchoolWorkPriority;
  due_date: string | null;
  sla_date: string | null;
  blocker_reason: string | null;
  waiting_on: SchoolWorkWaitingOn;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  monday_external_record_id: string | null;
  monday_external_payload: Record<string, unknown> | null;
  monday_sync_operation_id: string | null;
  monday_sync_operation_status: string | null;
  monday_sync_updated_at: string | null;
  monday_sync_error: string | null;
  monday_sync_conflict_summary: string | null;
  generated_by_rule: boolean;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolOrganizationRow = {
  organization_id: string;
  account_type: string;
  display_name: string;
};

type UserRow = {
  id: string;
  full_name: string | null;
};

type ShootRow = {
  id: string;
  organization_id: string | null;
  location_id: string | null;
};

type SchoolJobLinkRow = {
  id: string;
  organization_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
};

type SchoolLocationRow = {
  id: string;
  organization_id: string | null;
};

type SchoolContactRow = {
  id: string;
  organization_id: string;
};

type FollowUpRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  contact_id: string | null;
  linked_shoot_id: string | null;
};

type ProductionProjectRow = {
  id: string;
  linked_organization_id: string | null;
  linked_location_id: string | null;
  linked_shoot_id: string | null;
};

type ExistingWorkItemRow = {
  id: string;
  organization_id: string;
  school_job_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  linked_contact_id: string | null;
  linked_follow_up_id: string | null;
  linked_production_project_id: string | null;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  status: SchoolWorkStatus;
  stage: SchoolWorkStage;
  priority: SchoolWorkPriority;
  due_date: string | null;
  sla_date: string | null;
  blocker_reason: string | null;
  waiting_on: SchoolWorkWaitingOn;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  generated_by_rule: boolean;
  notes: string | null;
  completed_at: string | null;
  updated_at: string;
};

type ExistingSchoolJobRow = {
  id: string;
  organization_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  title: string;
  event_date: string | null;
  due_date: string | null;
  owner_user_id: string | null;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  status: SchoolJobStatus;
  notes: string | null;
};

type SchoolDeliverableRow = {
  id: string;
  organization_id: string;
  school_name: string;
  school_job_id: string | null;
  school_job_title: string | null;
  school_work_item_id: string | null;
  school_work_item_title: string | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_production_project_id: string | null;
  linked_production_project_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  deliverable_type: SchoolDeliverableType;
  status: SchoolDeliverableStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  ready_date: string | null;
  delivered_date: string | null;
  delivery_method: SchoolDeliveryMethod | null;
  tracking_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SchoolWorkTimelineRow = {
  id: string;
  source: "audit_log" | "school_activity_log" | "deliverable";
  event_type: string;
  label: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type SchoolsHubAggregateCounts = {
  total_count: string | number;
  due_today: string | number;
  overdue: string | number;
  blocked: string | number;
  upcoming_shoots_needing_prep: string | number;
  waiting_on_school: string | number;
  waiting_on_internal_production: string | number;
  id_work_queue: string | number;
  gallery_due_soon: string | number;
  yearbook_deadlines_approaching: string | number;
  deliveries_ready: string | number;
  recently_completed: string | number;
  open_total: string | number;
};

export async function listSchoolsHubWorkspace(
  client: PoolClient,
  auth: AuthUser,
  filters: SchoolsHubFilters = {}
): Promise<SchoolsHubWorkspaceResponse> {
  const anchorDate = normalizeAnchorDate(filters.anchor_date);
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to view the Schools Hub.");
  }
  const page = normalizeQueuePage(filters.page);
  const pageSize = normalizeQueuePageSize(filters.page_size);
  const { rows, counts } = await listVisibleSchoolWorkItems(client, auth, scope, {
    ...filters,
    page,
    page_size: pageSize
  });
  const queueItems = rows.map((row) => mapSchoolWorkItem(row, anchorDate));
  const sections = buildSchoolsHubSections(queueItems, counts, anchorDate);
  const summary = buildSchoolsHubSummary(counts);
  const totalCount = Number(counts.total_count ?? 0);

  return {
    anchor_date: anchorDate,
    generated_at: new Date().toISOString(),
    scope,
    summary,
    sections,
    queue_total_count: totalCount,
    queue_page: page,
    queue_page_size: pageSize,
    queue_has_more: page * pageSize < totalCount,
    queue_items: queueItems
  };
}

export async function listSchoolsHubReferenceData(
  client: PoolClient,
  auth: AuthUser
): Promise<SchoolsHubReferenceData> {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to view Schools Hub references.");
  }

  const ownersPromise =
    scope === "all"
      ? client.query<SchoolsHubReferenceOption>(
          `
            SELECT
              user_account.id::text AS id,
              COALESCE(user_account.full_name, user_account.email, 'Unnamed user') AS label,
              CASE
                WHEN user_account.department IS NOT NULL AND user_account.status IS NOT NULL
                  THEN concat(user_account.department, ' | ', user_account.status)
                ELSE user_account.department
              END AS helper
            FROM app_user user_account
            WHERE user_account.tenant_id = $1
            ORDER BY lower(COALESCE(user_account.full_name, user_account.email))
            LIMIT 200
          `,
          [auth.tenantId]
        )
      : client.query<SchoolsHubReferenceOption>(
          `
            SELECT
              user_account.id::text AS id,
              COALESCE(user_account.full_name, user_account.email, 'Unnamed user') AS label,
              CASE
                WHEN user_account.department IS NOT NULL AND user_account.status IS NOT NULL
                  THEN concat(user_account.department, ' | ', user_account.status)
                ELSE user_account.department
              END AS helper
            FROM app_user user_account
            WHERE user_account.tenant_id = $1
              AND user_account.id = $2
          `,
          [auth.tenantId, auth.id]
        );

  const schoolsPromise = client.query<SchoolsHubReferenceOption>(
    `
      SELECT DISTINCT
        org.id::text AS id,
        COALESCE(org.display_name, org.canonical_name) AS label,
        school_profile.district_name AS helper
      FROM school_profile
      JOIN organization org
        ON org.tenant_id = school_profile.tenant_id
       AND org.id = school_profile.organization_id
      ${scope === "own" ? "JOIN school_work_item scope_item ON scope_item.tenant_id = school_profile.tenant_id AND scope_item.organization_id = school_profile.organization_id" : ""}
      WHERE school_profile.tenant_id = $1
      ${scope === "own" ? "AND scope_item.owner_user_id = $2" : ""}
      ORDER BY lower(COALESCE(org.display_name, org.canonical_name))
      LIMIT 200
    `,
    scope === "own" ? [auth.tenantId, auth.id] : [auth.tenantId]
  );

  const jobsPromise = client.query<SchoolsHubReferenceOption>(
    `
      SELECT DISTINCT
        job.id::text AS id,
        job.title AS label,
        COALESCE(org.display_name, org.canonical_name) AS helper
      FROM school_job job
      JOIN organization org
        ON org.tenant_id = job.tenant_id
       AND org.id = job.organization_id
      ${scope === "own" ? "JOIN school_work_item scope_item ON scope_item.tenant_id = job.tenant_id AND scope_item.school_job_id = job.id" : ""}
      WHERE job.tenant_id = $1
      ${scope === "own" ? "AND scope_item.owner_user_id = $2" : ""}
      ORDER BY lower(job.title), lower(COALESCE(org.display_name, org.canonical_name))
      LIMIT 200
    `,
    scope === "own" ? [auth.tenantId, auth.id] : [auth.tenantId]
  );

  const locationsPromise = client.query<SchoolsHubReferenceOption>(
    `
      SELECT DISTINCT
        location.id::text AS id,
        location.name AS label,
        COALESCE(org.display_name, org.canonical_name) AS helper
      FROM shoot_location location
      JOIN organization org
        ON org.tenant_id = location.tenant_id
       AND org.id = location.organization_id
      ${scope === "own" ? "JOIN school_work_item scope_item ON scope_item.tenant_id = location.tenant_id AND scope_item.linked_location_id = location.id" : ""}
      WHERE location.tenant_id = $1
      ${scope === "own" ? "AND scope_item.owner_user_id = $2" : ""}
      ORDER BY lower(location.name), lower(COALESCE(org.display_name, org.canonical_name))
      LIMIT 200
    `,
    scope === "own" ? [auth.tenantId, auth.id] : [auth.tenantId]
  );

  const contactsPromise = client.query<SchoolsHubReferenceOption>(
    `
      SELECT DISTINCT
        contact.id::text AS id,
        contact.full_name AS label,
        COALESCE(org.display_name, org.canonical_name) AS helper
      FROM organization_contact contact
      JOIN organization org
        ON org.tenant_id = contact.tenant_id
       AND org.id = contact.organization_id
      ${scope === "own" ? "JOIN school_work_item scope_item ON scope_item.tenant_id = contact.tenant_id AND scope_item.linked_contact_id = contact.id" : ""}
      WHERE contact.tenant_id = $1
      ${scope === "own" ? "AND scope_item.owner_user_id = $2" : ""}
      ORDER BY lower(contact.full_name)
      LIMIT 200
    `,
    scope === "own" ? [auth.tenantId, auth.id] : [auth.tenantId]
  );

  const [owners, schools, jobs, locations, contacts] = await Promise.all([
    ownersPromise,
    schoolsPromise,
    jobsPromise,
    locationsPromise,
    contactsPromise
  ]);

  return {
    owners: owners.rows,
    schools: schools.rows,
    jobs: jobs.rows,
    locations: locations.rows,
    contacts: contacts.rows
  };
}

export async function createSchoolJob(
  client: PoolClient,
  auth: AuthUser,
  input: CreateSchoolJobInput,
  meta: RequestMeta = {},
  options: SchoolsHubMutationOptions = {}
): Promise<SchoolJobRecord> {
  assertSchoolsHubManageAccess(auth);

  const school = await ensureSchoolOrganization(client, auth, input.organization_id);
  const ownerUserId = await validateOwnerUser(client, auth, input.owner_user_id ?? null);
  const linkedShoot = await validateLinkedShoot(client, auth, input.linked_shoot_id ?? null, input.organization_id);
  const linkedLocationId = await validateLinkedLocation(
    client,
    auth,
    input.linked_location_id ?? linkedShoot?.location_id ?? null,
    input.organization_id
  );

  const title = normalizeRequiredText(input.title, "School job title");
  const sourceReference = normalizeOptionalText(input.source_reference ?? null);
  const notes = normalizeOptionalText(input.notes ?? null);
  const eventDate = normalizeOptionalDate(input.event_date ?? null);
  const dueDate = normalizeOptionalDate(input.due_date ?? null);
  const nextSourceSystem = options.allowSourceMutation ? input.source_system ?? "mission_control" : "mission_control";
  const nextSourceReference = options.allowSourceMutation ? sourceReference : null;

  if (linkedShoot) {
    const existingLinkedJob = await client.query<{ id: string }>(
      `
        SELECT id
        FROM school_job
        WHERE tenant_id = $1
          AND linked_shoot_id = $2
          AND job_type = $3
        LIMIT 1
      `,
      [auth.tenantId, linkedShoot.id, input.job_type]
    );
    if (existingLinkedJob.rows[0]) {
      throw new ApiError(409, "That shoot already has a Schools Hub job for this workflow.");
    }
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO school_job (
        tenant_id,
        organization_id,
        linked_shoot_id,
        linked_location_id,
        job_type,
        event_date,
        due_date,
        owner_user_id,
        source_system,
        source_reference,
        status,
        title,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id
    `,
    [
      auth.tenantId,
      school.organization_id,
      linkedShoot?.id ?? null,
      linkedLocationId,
      input.job_type,
      eventDate,
      dueDate,
      ownerUserId,
      nextSourceSystem,
      nextSourceReference,
      input.status ?? "planned",
      title,
      notes,
      auth.id,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.job.create",
    entityType: "school_job",
    entityId: inserted.rows[0].id,
    metadata: {
      organization_id: school.organization_id,
      school_name: school.display_name,
      linked_shoot_id: linkedShoot?.id ?? null
    },
    newValues: {
      job_type: input.job_type,
      owner_user_id: ownerUserId,
      due_date: dueDate,
      status: input.status ?? "planned"
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return getSchoolJobRecord(client, auth, inserted.rows[0].id);
}

export async function updateSchoolJob(
  client: PoolClient,
  auth: AuthUser,
  schoolJobId: string,
  input: UpdateSchoolJobInput,
  meta: RequestMeta = {},
  options: SchoolsHubMutationOptions = {}
): Promise<SchoolJobRecord> {
  assertSchoolsHubManageAccess(auth);

  const existing = await getExistingSchoolJob(client, auth, schoolJobId);
  const organizationId = existing.organization_id;
  await ensureSchoolOrganization(client, auth, organizationId);

  const linkedShoot = await validateLinkedShoot(
    client,
    auth,
    input.linked_shoot_id === undefined ? existing.linked_shoot_id : input.linked_shoot_id,
    organizationId
  );
  const linkedLocationId = await validateLinkedLocation(
    client,
    auth,
    input.linked_location_id === undefined
      ? existing.linked_location_id ?? linkedShoot?.location_id ?? null
      : input.linked_location_id ?? linkedShoot?.location_id ?? null,
    organizationId
  );
  const ownerUserId = await validateOwnerUser(
    client,
    auth,
    input.owner_user_id === undefined ? existing.owner_user_id : input.owner_user_id
  );

  const nextTitle = input.title === undefined ? existing.title : normalizeRequiredText(input.title, "School job title");
  const nextEventDate = input.event_date === undefined ? existing.event_date : normalizeOptionalDate(input.event_date ?? null);
  const nextDueDate = input.due_date === undefined ? existing.due_date : normalizeOptionalDate(input.due_date ?? null);
  const nextSourceSystem = options.allowSourceMutation
    ? input.source_system ?? existing.source_system
    : existing.source_system;
  const nextSourceReference = options.allowSourceMutation
    ? input.source_reference === undefined
      ? existing.source_reference
      : normalizeOptionalText(input.source_reference ?? null)
    : existing.source_reference;
  const nextStatus = input.status ?? existing.status;
  const nextNotes = input.notes === undefined ? existing.notes : normalizeOptionalText(input.notes ?? null);

  if (linkedShoot) {
    const conflictingLinkedJob = await client.query<{ id: string }>(
      `
        SELECT id
        FROM school_job
        WHERE tenant_id = $1
          AND linked_shoot_id = $2
          AND job_type = (
            SELECT job_type
            FROM school_job
            WHERE tenant_id = $1
              AND id = $3
          )
          AND id <> $3
        LIMIT 1
      `,
      [auth.tenantId, linkedShoot.id, schoolJobId]
    );
    if (conflictingLinkedJob.rows[0]) {
      throw new ApiError(409, "That shoot already has a different Schools Hub job for this workflow.");
    }
  }

  await client.query(
    `
      UPDATE school_job
      SET
        linked_shoot_id = $3,
        linked_location_id = $4,
        title = $5,
        event_date = $6,
        due_date = $7,
        owner_user_id = $8,
        source_system = $9,
        source_reference = $10,
        status = $11,
        notes = $12,
        updated_by_user_id = $13,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      schoolJobId,
      linkedShoot?.id ?? null,
      linkedLocationId,
      nextTitle,
      nextEventDate,
      nextDueDate,
      ownerUserId,
      nextSourceSystem,
      nextSourceReference,
      nextStatus,
      nextNotes,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.job.update",
    entityType: "school_job",
    entityId: schoolJobId,
    metadata: {
      organization_id: organizationId,
      linked_shoot_id: linkedShoot?.id ?? null
    },
    previousValues: {
      linked_shoot_id: existing.linked_shoot_id,
      linked_location_id: existing.linked_location_id,
      owner_user_id: existing.owner_user_id,
      source_system: existing.source_system,
      source_reference: existing.source_reference,
      status: existing.status,
      title: existing.title,
      event_date: existing.event_date,
      due_date: existing.due_date
    },
    newValues: {
      linked_shoot_id: linkedShoot?.id ?? null,
      linked_location_id: linkedLocationId,
      owner_user_id: ownerUserId,
      source_system: nextSourceSystem,
      source_reference: nextSourceReference,
      status: nextStatus,
      title: nextTitle,
      event_date: nextEventDate,
      due_date: nextDueDate
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return getSchoolJobRecord(client, auth, schoolJobId);
}

export async function createSchoolWorkItem(
  client: PoolClient,
  auth: AuthUser,
  input: CreateSchoolWorkItemInput,
  meta: RequestMeta = {},
  options: SchoolsHubMutationOptions = {}
): Promise<SchoolWorkItemRecord> {
  assertSchoolsHubManageAccess(auth);

  await ensureSchoolOrganization(client, auth, input.organization_id);
  const ownerUserId = await validateOwnerUser(client, auth, input.owner_user_id ?? null);
  const schoolJob = await validateSchoolJob(client, auth, input.school_job_id ?? null, input.organization_id);
  const linkedShoot = await validateLinkedShoot(
    client,
    auth,
    input.linked_shoot_id ?? schoolJob?.linked_shoot_id ?? null,
    input.organization_id
  );
  const linkedLocationId = await validateLinkedLocation(
    client,
    auth,
    input.linked_location_id ?? schoolJob?.linked_location_id ?? linkedShoot?.location_id ?? null,
    input.organization_id
  );
  const linkedContactId = await validateLinkedContact(client, auth, input.linked_contact_id ?? null, input.organization_id);
  const linkedFollowUp = await validateLinkedFollowUp(client, auth, input.linked_follow_up_id ?? null, input.organization_id);
  const linkedProject = await validateLinkedProductionProject(
    client,
    auth,
    input.linked_production_project_id ?? null,
    input.organization_id
  );

  const title = normalizeRequiredText(input.title, "Work item title");
  const description = normalizeOptionalText(input.description ?? null);
  const dueDate = normalizeOptionalDate(input.due_date ?? null);
  const slaDate = normalizeOptionalDate(input.sla_date ?? null);
  const blockerReason = normalizeOptionalText(input.blocker_reason ?? null);
  const sourceReference = normalizeOptionalText(input.source_reference ?? null);
  const notes = normalizeOptionalText(input.notes ?? null);
  const nextSourceSystem = options.allowSourceMutation ? input.source_system ?? "mission_control" : "mission_control";
  const nextSourceReference = options.allowSourceMutation ? sourceReference : null;
  const nextGeneratedByRule = options.allowSourceMutation ? input.generated_by_rule ?? false : false;
  assertSchoolWorkItemLinkConsistency({
    schoolJob,
    linkedShootId: linkedShoot?.id ?? null,
    linkedLocationId,
    linkedContactId,
    linkedFollowUp,
    linkedProject
  });
  const normalizedLifecycle = normalizeSchoolWorkLifecycle({
    status: input.status ?? "open",
    stage: input.stage ?? null,
    waitingOn: input.waiting_on ?? "none",
    blockerReason,
    completedAt: null
  });

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO school_work_item (
        tenant_id,
        organization_id,
        school_job_id,
        linked_shoot_id,
        linked_location_id,
        linked_contact_id,
        linked_follow_up_id,
        linked_production_project_id,
        work_type,
        title,
        description,
        owner_user_id,
        status,
        stage,
        priority,
        due_date,
        sla_date,
        blocker_reason,
        waiting_on,
        source_system,
        source_reference,
        generated_by_rule,
        completed_at,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.organization_id,
      schoolJob?.id ?? null,
      linkedShoot?.id ?? null,
      linkedLocationId,
      linkedContactId,
      linkedFollowUp?.id ?? null,
      linkedProject?.id ?? null,
      input.work_type,
      title,
      description,
      ownerUserId,
      normalizedLifecycle.status,
      normalizedLifecycle.stage,
      input.priority ?? "normal",
      dueDate,
      slaDate,
      normalizedLifecycle.blockerReason,
      normalizedLifecycle.waitingOn,
      nextSourceSystem,
      nextSourceReference,
      nextGeneratedByRule,
      normalizedLifecycle.completedAt,
      notes,
      auth.id,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.work_item.create",
    entityType: "school_work_item",
    entityId: inserted.rows[0].id,
    metadata: {
      organization_id: input.organization_id,
      school_job_id: schoolJob?.id ?? null,
      linked_shoot_id: linkedShoot?.id ?? null
    },
    newValues: {
      work_type: input.work_type,
      status: normalizedLifecycle.status,
      stage: normalizedLifecycle.stage,
      priority: input.priority ?? "normal",
      owner_user_id: ownerUserId,
      waiting_on: normalizedLifecycle.waitingOn,
      blocker_reason: normalizedLifecycle.blockerReason
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  const record = await getSchoolWorkItemRecord(client, auth, inserted.rows[0].id);
  await queueSchoolRiskNotificationIfNeeded(client, auth, record);
  return record;
}

export async function updateSchoolWorkItem(
  client: PoolClient,
  auth: AuthUser,
  workItemId: string,
  input: UpdateSchoolWorkItemInput,
  meta: RequestMeta = {},
  options: SchoolsHubMutationOptions = {}
): Promise<SchoolWorkItemRecord> {
  assertSchoolsHubManageAccess(auth);

  const existing = await getExistingSchoolWorkItem(client, auth, workItemId);
  const organizationId = existing.organization_id;
  await ensureSchoolOrganization(client, auth, organizationId);

  const schoolJob = await validateSchoolJob(client, auth, input.school_job_id ?? existing.school_job_id, organizationId);
  const linkedShoot = await validateLinkedShoot(
    client,
    auth,
    input.linked_shoot_id ?? existing.linked_shoot_id ?? schoolJob?.linked_shoot_id ?? null,
    organizationId
  );
  const linkedLocationId = await validateLinkedLocation(
    client,
    auth,
    input.linked_location_id ?? existing.linked_location_id ?? schoolJob?.linked_location_id ?? linkedShoot?.location_id ?? null,
    organizationId
  );
  const linkedContactId = await validateLinkedContact(
    client,
    auth,
    input.linked_contact_id === undefined ? existing.linked_contact_id : input.linked_contact_id,
    organizationId
  );
  const linkedFollowUp = await validateLinkedFollowUp(
    client,
    auth,
    input.linked_follow_up_id === undefined ? existing.linked_follow_up_id : input.linked_follow_up_id,
    organizationId
  );
  const linkedProject = await validateLinkedProductionProject(
    client,
    auth,
    input.linked_production_project_id === undefined ? existing.linked_production_project_id : input.linked_production_project_id,
    organizationId
  );
  const ownerUserId = await validateOwnerUser(
    client,
    auth,
    input.owner_user_id === undefined ? existing.owner_user_id : input.owner_user_id
  );

  if (
    input.expected_updated_at &&
    normalizeIsoSecond(existing.updated_at) !== normalizeIsoSecond(input.expected_updated_at)
  ) {
    throw new ApiError(409, "This work item changed before your update was saved. Refresh and try again.");
  }

  const nextStatus = input.status ?? existing.status;
  const nextTitle = input.title === undefined ? existing.title : normalizeRequiredText(input.title, "Work item title");
  const nextDescription =
    input.description === undefined ? existing.description : normalizeOptionalText(input.description ?? null);
  const nextDueDate = input.due_date === undefined ? existing.due_date : normalizeOptionalDate(input.due_date ?? null);
  const nextSlaDate = input.sla_date === undefined ? existing.sla_date : normalizeOptionalDate(input.sla_date ?? null);
  const nextBlockerReason =
    input.blocker_reason === undefined ? existing.blocker_reason : normalizeOptionalText(input.blocker_reason ?? null);
  const nextWaitingOn = input.waiting_on ?? existing.waiting_on;
  const nextSourceSystem = options.allowSourceMutation ? input.source_system ?? existing.source_system : existing.source_system;
  const nextSourceReference = options.allowSourceMutation
    ? input.source_reference === undefined
      ? existing.source_reference
      : normalizeOptionalText(input.source_reference ?? null)
    : existing.source_reference;
  const nextGeneratedByRule = options.allowSourceMutation
    ? input.generated_by_rule === undefined || input.generated_by_rule === null
      ? existing.generated_by_rule
      : Boolean(input.generated_by_rule)
    : existing.generated_by_rule;
  const nextNotes = input.notes === undefined ? existing.notes : normalizeOptionalText(input.notes ?? null);
  const nextPriority = input.priority ?? existing.priority;
  assertSchoolWorkItemLinkConsistency({
    schoolJob,
    linkedShootId: linkedShoot?.id ?? null,
    linkedLocationId,
    linkedContactId,
    linkedFollowUp,
    linkedProject
  });
  const normalizedLifecycle = normalizeSchoolWorkLifecycle({
    status: nextStatus,
    stage: input.stage ?? existing.stage,
    waitingOn: nextWaitingOn,
    blockerReason: nextBlockerReason,
    completedAt: existing.completed_at
  });

  await client.query(
    `
      UPDATE school_work_item
      SET
        school_job_id = $3,
        linked_shoot_id = $4,
        linked_location_id = $5,
        linked_contact_id = $6,
        linked_follow_up_id = $7,
        linked_production_project_id = $8,
        title = $9,
        description = $10,
        owner_user_id = $11,
        status = $12,
        stage = $13,
        priority = $14,
        due_date = $15,
        sla_date = $16,
        blocker_reason = $17,
        waiting_on = $18,
        source_system = $19,
        source_reference = $20,
        generated_by_rule = $21,
        completed_at = $22,
        notes = $23,
        updated_by_user_id = $24,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      workItemId,
      schoolJob?.id ?? null,
      linkedShoot?.id ?? null,
      linkedLocationId,
      linkedContactId,
      linkedFollowUp?.id ?? null,
      linkedProject?.id ?? null,
      nextTitle,
      nextDescription,
      ownerUserId,
      normalizedLifecycle.status,
      normalizedLifecycle.stage,
      nextPriority,
      nextDueDate,
      nextSlaDate,
      normalizedLifecycle.blockerReason,
      normalizedLifecycle.waitingOn,
      nextSourceSystem,
      nextSourceReference,
      nextGeneratedByRule,
      normalizedLifecycle.completedAt,
      nextNotes,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.work_item.update",
    entityType: "school_work_item",
    entityId: workItemId,
    previousValues: {
      school_job_id: existing.school_job_id,
      linked_shoot_id: existing.linked_shoot_id,
      owner_user_id: existing.owner_user_id,
      status: existing.status,
      stage: existing.stage,
      priority: existing.priority,
      due_date: existing.due_date,
      blocker_reason: existing.blocker_reason,
      waiting_on: existing.waiting_on
    },
    newValues: {
      school_job_id: schoolJob?.id ?? null,
      linked_shoot_id: linkedShoot?.id ?? null,
      owner_user_id: ownerUserId,
      status: normalizedLifecycle.status,
      stage: normalizedLifecycle.stage,
      priority: nextPriority,
      due_date: nextDueDate,
      blocker_reason: normalizedLifecycle.blockerReason,
      waiting_on: normalizedLifecycle.waitingOn
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  const record = await getSchoolWorkItemRecord(client, auth, workItemId);
  await queueSchoolRiskNotificationIfNeeded(client, auth, record);
  return record;
}

export async function bulkUpdateSchoolWorkItems(
  client: PoolClient,
  auth: AuthUser,
  input: BulkUpdateSchoolWorkItemsInput,
  meta: RequestMeta = {}
): Promise<{ updated_count: number; updated_ids: string[] }> {
  assertSchoolsHubManageAccess(auth);

  const ids = uniqueIds(input.ids);
  if (!ids.length) {
    throw new ApiError(400, "Select at least one work item.");
  }

  const patch: UpdateSchoolWorkItemInput = {};
  if (input.owner_user_id !== undefined) {
    patch.owner_user_id = input.owner_user_id;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.stage !== undefined) {
    patch.stage = input.stage;
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority;
  }
  if (input.due_date !== undefined) {
    patch.due_date = input.due_date;
  }
  if (input.blocker_reason !== undefined) {
    patch.blocker_reason = input.blocker_reason;
  }
  if (input.waiting_on !== undefined) {
    patch.waiting_on = input.waiting_on;
  }

  if (!Object.keys(patch).length) {
    throw new ApiError(400, "Choose at least one bulk update value.");
  }
  const updatedIds: string[] = [];
  for (const id of ids) {
    await updateSchoolWorkItem(client, auth, id, patch, meta);
    updatedIds.push(id);
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.work_item.bulk_update",
    entityType: "school_work_item",
    metadata: {
      updated_ids: updatedIds,
      updated_count: updatedIds.length
    },
    newValues: patch as Record<string, unknown>,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return {
    updated_count: updatedIds.length,
    updated_ids: updatedIds
  };
}

async function listVisibleSchoolWorkItems(
  client: PoolClient,
  auth: AuthUser,
  scope: "all" | "own",
  filters: SchoolsHubFilters
) {
  const anchorDate = normalizeAnchorDate(filters.anchor_date);
  const dueSoonCutoff = addDays(anchorDate, 3);
  const yearbookCutoff = addDays(anchorDate, 14);
  const recentCompletedStart = addDays(anchorDate, -7);
  const page = normalizeQueuePage(filters.page);
  const pageSize = normalizeQueuePageSize(filters.page_size);
  const pageOffset = (page - 1) * pageSize;
  const search = normalizeOptionalText(filters.search ?? null);
  const searchPattern = search ? `%${search.toLowerCase()}%` : null;

  const values: Array<string | number | null> = [auth.tenantId];
  let param = 1;
  const where: string[] = ["swi.tenant_id = $1"];

  if (scope === "own") {
    param += 1;
    where.push(`swi.owner_user_id = $${param}`);
    values.push(auth.id);
  }
  if (filters.owner_user_id) {
    param += 1;
    where.push(`swi.owner_user_id = $${param}`);
    values.push(filters.owner_user_id);
  }
  if (filters.school_id) {
    param += 1;
    where.push(`swi.organization_id = $${param}`);
    values.push(filters.school_id);
  }
  if (filters.job_id) {
    param += 1;
    where.push(`swi.school_job_id = $${param}`);
    values.push(filters.job_id);
  }
  if (filters.work_type) {
    param += 1;
    where.push(`swi.work_type = $${param}`);
    values.push(filters.work_type);
  }
  if (filters.priority) {
    param += 1;
    where.push(`swi.priority = $${param}`);
    values.push(filters.priority);
  }
  if (filters.waiting_on) {
    param += 1;
    where.push(`swi.waiting_on = $${param}`);
    values.push(filters.waiting_on);
  }
  if (searchPattern) {
    param += 1;
    where.push(`
      (
        lower(swi.title) LIKE $${param}
        OR lower(COALESCE(swi.description, '')) LIKE $${param}
        OR lower(COALESCE(org.display_name, org.canonical_name)) LIKE $${param}
        OR lower(COALESCE(job.title, '')) LIKE $${param}
        OR lower(COALESCE(shoot.title, '')) LIKE $${param}
        OR lower(COALESCE(shoot.shoot_code, '')) LIKE $${param}
        OR lower(COALESCE(contact.full_name, '')) LIKE $${param}
      )
    `);
    values.push(searchPattern);
  }

  const baseFrom = `
      FROM school_work_item swi
      JOIN organization org
        ON org.tenant_id = swi.tenant_id
       AND org.id = swi.organization_id
      LEFT JOIN school_job job
        ON job.tenant_id = swi.tenant_id
       AND job.id = swi.school_job_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = swi.tenant_id
       AND shoot.id = swi.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = swi.tenant_id
       AND location.id = COALESCE(swi.linked_location_id, job.linked_location_id, shoot.location_id)
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = swi.tenant_id
       AND contact.id = swi.linked_contact_id
      LEFT JOIN directory_relationship_follow_up follow_up
        ON follow_up.tenant_id = swi.tenant_id
       AND follow_up.id = swi.linked_follow_up_id
      LEFT JOIN production_project project
        ON project.tenant_id = swi.tenant_id
       AND project.id = swi.linked_production_project_id
      LEFT JOIN app_user owner_user
        ON owner_user.id = swi.owner_user_id
  `;

  const countStart = values.length + 1;
  const countValues = [...values, anchorDate, dueSoonCutoff, yearbookCutoff, recentCompletedStart];
  const countParams = {
    anchorDate: `$${countStart}`,
    dueSoonCutoff: `$${countStart + 1}`,
    yearbookCutoff: `$${countStart + 2}`,
    recentCompletedStart: `$${countStart + 3}`
  };

  const aggregateQuery = await client.query<SchoolsHubAggregateCounts>(
    `
      SELECT
        COUNT(*)::text AS total_count,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND COALESCE(swi.due_date, swi.sla_date) = ${countParams.anchorDate}::date
        )::text AS due_today,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND COALESCE(swi.due_date, swi.sla_date) < ${countParams.anchorDate}::date
        )::text AS overdue,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND (swi.status = 'blocked' OR NULLIF(trim(COALESCE(swi.blocker_reason, '')), '') IS NOT NULL)
        )::text AS blocked,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND swi.work_type = 'pre_shoot_coordination'
            AND swi.sla_date IS NOT NULL
            AND swi.sla_date <= (${countParams.anchorDate}::date + INTERVAL '7 days')
        )::text AS upcoming_shoots_needing_prep,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND (swi.waiting_on = 'school' OR swi.stage = 'waiting_on_school')
        )::text AS waiting_on_school,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND (swi.waiting_on = 'internal_production' OR swi.stage = 'waiting_on_internal')
        )::text AS waiting_on_internal_production,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND swi.work_type = 'id_production'
        )::text AS id_work_queue,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND swi.work_type = 'gallery_release'
            AND swi.due_date IS NOT NULL
            AND swi.due_date <= ${countParams.dueSoonCutoff}::date
        )::text AS gallery_due_soon,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND swi.work_type = 'yearbook'
            AND swi.due_date IS NOT NULL
            AND swi.due_date <= ${countParams.yearbookCutoff}::date
        )::text AS yearbook_deadlines_approaching,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
            AND swi.stage = 'ready_for_delivery'
        )::text AS deliveries_ready,
        COUNT(*) FILTER (
          WHERE swi.status = 'completed'
            AND swi.completed_at IS NOT NULL
            AND swi.completed_at >= ${countParams.recentCompletedStart}::date
        )::text AS recently_completed,
        COUNT(*) FILTER (
          WHERE swi.status NOT IN ('completed', 'cancelled')
        )::text AS open_total
      ${baseFrom}
      WHERE ${where.join(" AND ")}
    `,
    countValues
  );

  const rowValues = [...values, pageSize, pageOffset];
  const rowParams = {
    limit: `$${rowValues.length - 1}`,
    offset: `$${rowValues.length}`
  };

  const { rows } = await client.query<SchoolWorkItemRow>(
    `
      SELECT
        swi.id,
        swi.organization_id,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        org.logo_url AS school_logo_url,
        swi.school_job_id,
        job.title AS school_job_title,
        job.job_type AS school_job_type,
        swi.linked_shoot_id,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        COALESCE(swi.linked_location_id, job.linked_location_id, shoot.location_id)::text AS linked_location_id,
        location.name AS linked_location_name,
        swi.linked_contact_id::text,
        contact.full_name AS linked_contact_name,
        swi.linked_follow_up_id::text,
        follow_up.title AS linked_follow_up_title,
        swi.linked_production_project_id::text,
        project.title AS linked_production_project_title,
        swi.work_type,
        swi.title,
        swi.description,
        swi.owner_user_id::text,
        owner_user.full_name AS owner_name,
        swi.status,
        swi.stage,
        swi.priority,
        swi.due_date::text,
        swi.sla_date::text,
        swi.blocker_reason,
        swi.waiting_on,
        swi.source_system,
        swi.source_reference,
        monday_map.external_id AS monday_external_record_id,
        monday_map.payload AS monday_external_payload,
        monday_op.id::text AS monday_sync_operation_id,
        monday_op.status AS monday_sync_operation_status,
        monday_op.updated_at::text AS monday_sync_updated_at,
        monday_op.last_error AS monday_sync_error,
        monday_op.conflict_summary AS monday_sync_conflict_summary,
        swi.generated_by_rule,
        swi.notes,
        swi.completed_at::text,
        swi.created_at::text,
        swi.updated_at::text
      ${baseFrom}
      LEFT JOIN LATERAL (
        SELECT map.external_id, map.payload
        FROM external_object_map map
        WHERE map.tenant_id = swi.tenant_id
          AND map.provider = 'monday'
          AND map.object_type = 'school_work_item'
          AND map.object_id = swi.id
        ORDER BY map.created_at DESC
        LIMIT 1
      ) monday_map ON true
      LEFT JOIN LATERAL (
        SELECT op.id, op.status, op.updated_at, op.last_error, op.conflict_summary
        FROM integration_sync_operation op
        WHERE op.tenant_id = swi.tenant_id
          AND op.provider = 'monday'
          AND op.entity_type = 'school_work_item'
          AND op.entity_id = swi.id
        ORDER BY op.created_at DESC
        LIMIT 1
      ) monday_op ON true
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE
          WHEN swi.status = 'blocked' THEN 0
          WHEN swi.status IN ('open', 'in_progress', 'waiting') THEN 1
          WHEN swi.status = 'completed' THEN 2
          ELSE 3
        END,
        CASE swi.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        COALESCE(swi.due_date, swi.sla_date, '9999-12-31'::date) ASC,
        swi.updated_at DESC
      LIMIT ${rowParams.limit}
      OFFSET ${rowParams.offset}
    `,
    rowValues
  );

  return {
    rows,
    counts: aggregateQuery.rows[0] ?? {
      total_count: 0,
      due_today: 0,
      overdue: 0,
      blocked: 0,
      upcoming_shoots_needing_prep: 0,
      waiting_on_school: 0,
      waiting_on_internal_production: 0,
      id_work_queue: 0,
      gallery_due_soon: 0,
      yearbook_deadlines_approaching: 0,
      deliveries_ready: 0,
      recently_completed: 0,
      open_total: 0
    }
  };
}

export async function getSchoolJobRecord(client: PoolClient, auth: AuthUser, schoolJobId: string): Promise<SchoolJobRecord> {
  const { rows } = await client.query<SchoolJobRow>(
    `
      SELECT
        job.id,
        job.organization_id,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        org.logo_url AS school_logo_url,
        job.linked_shoot_id,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        job.linked_location_id::text,
        location.name AS linked_location_name,
        job.job_type,
        job.status,
        job.title,
        job.event_date::text,
        job.due_date::text,
        job.owner_user_id::text,
        owner_user.full_name AS owner_name,
        job.source_system,
        job.source_reference,
        monday_map.external_id AS monday_external_record_id,
        monday_map.payload AS monday_external_payload,
        monday_op.id::text AS monday_sync_operation_id,
        monday_op.status AS monday_sync_operation_status,
        monday_op.updated_at::text AS monday_sync_updated_at,
        monday_op.last_error AS monday_sync_error,
        monday_op.conflict_summary AS monday_sync_conflict_summary,
        job.notes,
        job.created_at::text,
        job.updated_at::text
      FROM school_job job
      JOIN organization org
        ON org.tenant_id = job.tenant_id
       AND org.id = job.organization_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = job.tenant_id
       AND shoot.id = job.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = job.tenant_id
       AND location.id = job.linked_location_id
      LEFT JOIN app_user owner_user
        ON owner_user.id = job.owner_user_id
      LEFT JOIN LATERAL (
        SELECT map.external_id, map.payload
        FROM external_object_map map
        WHERE map.tenant_id = job.tenant_id
          AND map.provider = 'monday'
          AND map.object_type = 'school_job'
          AND map.object_id = job.id
        ORDER BY map.created_at DESC
        LIMIT 1
      ) monday_map ON true
      LEFT JOIN LATERAL (
        SELECT op.id, op.status, op.updated_at, op.last_error, op.conflict_summary
        FROM integration_sync_operation op
        WHERE op.tenant_id = job.tenant_id
          AND op.provider = 'monday'
          AND op.entity_type = 'school_job'
          AND op.entity_id = job.id
        ORDER BY op.created_at DESC
        LIMIT 1
      ) monday_op ON true
      WHERE job.tenant_id = $1
        AND job.id = $2
      LIMIT 1
    `,
    [auth.tenantId, schoolJobId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "School job not found.");
  }

  return {
    id: rows[0].id,
    organization_id: rows[0].organization_id,
    school_name: rows[0].school_name,
    school_logo_url: rows[0].school_logo_url,
    linked_shoot_id: rows[0].linked_shoot_id,
    linked_shoot_code: rows[0].linked_shoot_code,
    linked_shoot_title: rows[0].linked_shoot_title,
    linked_location_id: rows[0].linked_location_id,
    linked_location_name: rows[0].linked_location_name,
    job_type: rows[0].job_type,
    status: rows[0].status,
    title: rows[0].title,
    event_date: rows[0].event_date,
    due_date: rows[0].due_date,
    owner_user_id: rows[0].owner_user_id,
    owner_name: rows[0].owner_name,
    source_system: rows[0].source_system,
    source_reference: rows[0].source_reference,
    external_sync: mapMondayExternalSync(rows[0]),
    notes: rows[0].notes,
    created_at: rows[0].created_at,
    updated_at: rows[0].updated_at
  };
}

export async function getSchoolWorkItemRecord(client: PoolClient, auth: AuthUser, workItemId: string): Promise<SchoolWorkItemRecord> {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to view the Schools Hub.");
  }
  const { rows } = await client.query<SchoolWorkItemRow>(
    `
      SELECT
        swi.id,
        swi.organization_id,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        org.logo_url AS school_logo_url,
        swi.school_job_id,
        job.title AS school_job_title,
        job.job_type AS school_job_type,
        swi.linked_shoot_id,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        COALESCE(swi.linked_location_id, job.linked_location_id, shoot.location_id)::text AS linked_location_id,
        location.name AS linked_location_name,
        swi.linked_contact_id::text,
        contact.full_name AS linked_contact_name,
        swi.linked_follow_up_id::text,
        follow_up.title AS linked_follow_up_title,
        swi.linked_production_project_id::text,
        project.title AS linked_production_project_title,
        swi.work_type,
        swi.title,
        swi.description,
        swi.owner_user_id::text,
        owner_user.full_name AS owner_name,
        swi.status,
        swi.stage,
        swi.priority,
        swi.due_date::text,
        swi.sla_date::text,
        swi.blocker_reason,
        swi.waiting_on,
        swi.source_system,
        swi.source_reference,
        monday_map.external_id AS monday_external_record_id,
        monday_map.payload AS monday_external_payload,
        monday_op.id AS monday_sync_operation_id,
        monday_op.status AS monday_sync_operation_status,
        monday_op.updated_at::text AS monday_sync_updated_at,
        monday_op.last_error AS monday_sync_error,
        monday_op.conflict_summary AS monday_sync_conflict_summary,
        swi.generated_by_rule,
        swi.notes,
        swi.completed_at::text,
        swi.created_at::text,
        swi.updated_at::text
      FROM school_work_item swi
      JOIN organization org
        ON org.tenant_id = swi.tenant_id
       AND org.id = swi.organization_id
      LEFT JOIN school_job job
        ON job.tenant_id = swi.tenant_id
       AND job.id = swi.school_job_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = swi.tenant_id
       AND shoot.id = swi.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = swi.tenant_id
       AND location.id = COALESCE(swi.linked_location_id, job.linked_location_id, shoot.location_id)
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = swi.tenant_id
       AND contact.id = swi.linked_contact_id
      LEFT JOIN directory_relationship_follow_up follow_up
        ON follow_up.tenant_id = swi.tenant_id
       AND follow_up.id = swi.linked_follow_up_id
      LEFT JOIN production_project project
        ON project.tenant_id = swi.tenant_id
       AND project.id = swi.linked_production_project_id
      LEFT JOIN app_user owner_user
        ON owner_user.id = swi.owner_user_id
      LEFT JOIN LATERAL (
        SELECT map.external_id, map.payload
        FROM external_object_map map
        WHERE map.tenant_id = swi.tenant_id
          AND map.provider = 'monday'
          AND map.object_type = 'school_work_item'
          AND map.object_id = swi.id
        ORDER BY map.created_at DESC
        LIMIT 1
      ) monday_map ON true
      LEFT JOIN LATERAL (
        SELECT op.id, op.status, op.updated_at, op.last_error, op.conflict_summary
        FROM integration_sync_operation op
        WHERE op.tenant_id = swi.tenant_id
          AND op.provider = 'monday'
          AND op.entity_type = 'school_work_item'
          AND op.entity_id = swi.id
        ORDER BY op.created_at DESC
        LIMIT 1
      ) monday_op ON true
      WHERE swi.tenant_id = $1
        AND swi.id = $2
        ${scope === "own" ? "AND swi.owner_user_id = $3" : ""}
      LIMIT 1
    `,
    scope === "own" ? [auth.tenantId, workItemId, auth.id] : [auth.tenantId, workItemId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "School work item not found.");
  }
  return mapSchoolWorkItem(row, normalizeAnchorDate(null));
}

export async function getSchoolWorkItemDetail(
  client: PoolClient,
  auth: AuthUser,
  workItemId: string
): Promise<SchoolWorkItemDetailResponse> {
  const item = await getSchoolWorkItemRecord(client, auth, workItemId);
  const [timelineRows, deliverableRows] = await Promise.all([
    loadSchoolWorkItemTimeline(client, auth, item),
    loadSchoolDeliverablesForWorkItem(client, auth, workItemId)
  ]);

  return {
    item,
    timeline: timelineRows.map(mapSchoolWorkTimelineEvent),
    related_deliverables: deliverableRows.map(mapSchoolDeliverable),
    available_actions: {
      can_complete: item.status !== "completed" && item.status !== "cancelled",
      can_reassign: canManageSchoolsHub(auth),
      can_mark_waiting_on_school: canManageSchoolsHub(auth) && item.status !== "completed" && item.waiting_on !== "school",
      can_mark_waiting_on_internal:
        canManageSchoolsHub(auth) && item.status !== "completed" && item.waiting_on !== "internal_ops",
      can_add_blocker: canManageSchoolsHub(auth) && !item.blocker_reason,
      can_remove_blocker: canManageSchoolsHub(auth) && Boolean(item.blocker_reason),
      can_convert_to_deliverable: canManageSchoolsHub(auth) && item.status !== "cancelled"
    }
  };
}

export async function convertSchoolWorkItemToDeliverable(
  client: PoolClient,
  auth: AuthUser,
  input: CreateSchoolDeliverableInput,
  meta: RequestMeta = {}
): Promise<SchoolDeliverableRecord> {
  assertSchoolsHubManageAccess(auth);
  const existingWorkItem = await getExistingSchoolWorkItem(client, auth, input.school_work_item_id);
  const item = await getSchoolWorkItemRecord(client, auth, input.school_work_item_id);
  const deliverableType = input.deliverable_type ?? inferDeliverableTypeFromWorkItem(item.work_type);
  const dueDate = input.due_date === undefined ? item.due_date : normalizeOptionalDate(input.due_date ?? null);
  const notes = normalizeOptionalText(input.notes ?? item.notes ?? null);

  const existingDeliverable = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM school_deliverable
      WHERE tenant_id = $1
        AND school_work_item_id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.school_work_item_id]
  );

  if (existingDeliverable.rows[0]) {
    return getSchoolDeliverableRecord(client, auth, existingDeliverable.rows[0].id);
  }

  const status = item.stage === "ready_for_delivery" ? "ready" : item.blocker_reason ? "blocked" : "planned";
  const readyDate = status === "ready" ? new Date().toISOString().slice(0, 10) : null;

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO school_deliverable (
        tenant_id,
        organization_id,
        school_job_id,
        school_work_item_id,
        linked_shoot_id,
        linked_production_project_id,
        linked_location_id,
        deliverable_type,
        status,
        owner_user_id,
        due_date,
        ready_date,
        delivery_method,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      item.organization_id,
      item.school_job_id,
      item.id,
      item.linked_shoot_id,
      item.linked_production_project_id,
      item.linked_location_id,
      deliverableType,
      status,
      item.owner_user_id,
      dueDate,
      readyDate,
      input.delivery_method ?? inferDeliveryMethodFromDeliverableType(deliverableType),
      notes,
      auth.id,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.deliverable.create",
    entityType: "school_deliverable",
    entityId: inserted.rows[0].id,
    metadata: {
      organization_id: item.organization_id,
      school_work_item_id: item.id,
      linked_shoot_id: item.linked_shoot_id
    },
    newValues: {
      deliverable_type: deliverableType,
      status,
      due_date: dueDate,
      owner_user_id: item.owner_user_id
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "schools_hub.work_item.convert_to_deliverable",
    entityType: "school_work_item",
    entityId: item.id,
    metadata: {
      deliverable_type: deliverableType,
      school_deliverable_id: inserted.rows[0].id
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    sourceSurface: meta.sourceSurface ?? "schools_hub"
  });

  return getSchoolDeliverableRecord(client, auth, inserted.rows[0].id);
}

async function getExistingSchoolJob(client: PoolClient, auth: AuthUser, schoolJobId: string): Promise<ExistingSchoolJobRow> {
  const { rows } = await client.query<ExistingSchoolJobRow>(
    `
      SELECT
        id,
        organization_id,
        linked_shoot_id,
        linked_location_id,
        title,
        event_date::text,
        due_date::text,
        owner_user_id::text,
        source_system,
        source_reference,
        status,
        notes
      FROM school_job
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, schoolJobId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "School job not found.");
  }

  return rows[0];
}

async function getExistingSchoolWorkItem(client: PoolClient, auth: AuthUser, workItemId: string): Promise<ExistingWorkItemRow> {
  const { rows } = await client.query<ExistingWorkItemRow>(
    `
      SELECT
        id,
        organization_id,
        school_job_id,
        linked_shoot_id,
        linked_location_id,
        linked_contact_id,
        linked_follow_up_id,
        linked_production_project_id,
        title,
        description,
        owner_user_id,
        status,
        stage,
        priority,
        due_date::text,
        sla_date::text,
        blocker_reason,
        waiting_on,
        source_system,
        source_reference,
        generated_by_rule,
        notes,
        completed_at::text,
        updated_at::text
      FROM school_work_item
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, workItemId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "School work item not found.");
  }

  return rows[0];
}

function mapSchoolWorkItem(row: SchoolWorkItemRow, anchorDate: string): SchoolWorkItemRecord {
  const dueState = deriveDueState(row, anchorDate);
  const waitingOnLabel = labelForWaitingOn(row.waiting_on);
  const sourceLabel = labelForSourceSystem(row.source_system);
  const statusTone = toneForWorkItem(row, dueState);
  const flags = buildFlags(row, dueState, waitingOnLabel);
  const externalSync = mapMondayExternalSync(row);

  return {
    id: row.id,
    organization_id: row.organization_id,
    school_name: row.school_name,
    school_logo_url: row.school_logo_url,
    school_job_id: row.school_job_id,
    school_job_title: row.school_job_title,
    school_job_type: row.school_job_type,
    linked_shoot_id: row.linked_shoot_id,
    linked_shoot_code: row.linked_shoot_code,
    linked_shoot_title: row.linked_shoot_title,
    linked_location_id: row.linked_location_id,
    linked_location_name: row.linked_location_name,
    linked_contact_id: row.linked_contact_id,
    linked_contact_name: row.linked_contact_name,
    linked_follow_up_id: row.linked_follow_up_id,
    linked_follow_up_title: row.linked_follow_up_title,
    linked_production_project_id: row.linked_production_project_id,
    linked_production_project_title: row.linked_production_project_title,
    work_type: row.work_type,
    title: row.title,
    description: row.description,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    status: row.status,
    stage: row.stage,
    priority: row.priority,
    due_date: row.due_date,
    sla_date: row.sla_date,
    blocker_reason: row.blocker_reason,
    waiting_on: row.waiting_on,
    source_system: row.source_system,
    source_reference: row.source_reference,
    external_sync: externalSync,
    generated_by_rule: row.generated_by_rule,
    notes: row.notes,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status_label: labelForWorkItemStatus(row.status, dueState),
    status_tone: statusTone,
    due_state: dueState,
    due_label: buildDueLabel(row, dueState),
    waiting_on_label: waitingOnLabel,
    source_label: sourceLabel,
    flags
  };
}

function mapSchoolDeliverable(row: SchoolDeliverableRow): SchoolDeliverableRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    school_name: row.school_name,
    school_job_id: row.school_job_id,
    school_job_title: row.school_job_title,
    school_work_item_id: row.school_work_item_id,
    school_work_item_title: row.school_work_item_title,
    linked_shoot_id: row.linked_shoot_id,
    linked_shoot_code: row.linked_shoot_code,
    linked_shoot_title: row.linked_shoot_title,
    linked_production_project_id: row.linked_production_project_id,
    linked_production_project_title: row.linked_production_project_title,
    linked_location_id: row.linked_location_id,
    linked_location_name: row.linked_location_name,
    deliverable_type: row.deliverable_type,
    deliverable_type_label: humanizeEnum(row.deliverable_type),
    status: row.status,
    status_label: humanizeEnum(row.status),
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    due_date: row.due_date,
    ready_date: row.ready_date,
    delivered_date: row.delivered_date,
    delivery_method: row.delivery_method,
    delivery_method_label: row.delivery_method ? humanizeEnum(row.delivery_method) : null,
    tracking_reference: row.tracking_reference,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapSchoolWorkTimelineEvent(row: SchoolWorkTimelineRow): SchoolWorkTimelineEvent {
  return {
    id: row.id,
    source: row.source,
    event_type: row.event_type,
    label: row.label,
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    created_at: row.created_at,
    metadata: row.metadata ?? {}
  };
}

async function getSchoolDeliverableRecord(client: PoolClient, auth: AuthUser, deliverableId: string): Promise<SchoolDeliverableRecord> {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to view the Schools Hub.");
  }
  const { rows } = await client.query<SchoolDeliverableRow>(
    `
      SELECT
        deliverable.id::text,
        deliverable.organization_id::text,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        deliverable.school_job_id::text,
        job.title AS school_job_title,
        deliverable.school_work_item_id::text,
        work_item.title AS school_work_item_title,
        deliverable.linked_shoot_id::text,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        deliverable.linked_production_project_id::text,
        project.title AS linked_production_project_title,
        deliverable.linked_location_id::text,
        location.name AS linked_location_name,
        deliverable.deliverable_type,
        deliverable.status,
        deliverable.owner_user_id::text,
        owner_user.full_name AS owner_name,
        deliverable.due_date::text,
        deliverable.ready_date::text,
        deliverable.delivered_date::text,
        deliverable.delivery_method,
        deliverable.tracking_reference,
        deliverable.notes,
        deliverable.created_at::text,
        deliverable.updated_at::text
      FROM school_deliverable deliverable
      JOIN organization org
        ON org.tenant_id = deliverable.tenant_id
       AND org.id = deliverable.organization_id
      LEFT JOIN school_job job
        ON job.tenant_id = deliverable.tenant_id
       AND job.id = deliverable.school_job_id
      LEFT JOIN school_work_item work_item
        ON work_item.tenant_id = deliverable.tenant_id
       AND work_item.id = deliverable.school_work_item_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = deliverable.tenant_id
       AND shoot.id = deliverable.linked_shoot_id
      LEFT JOIN production_project project
        ON project.tenant_id = deliverable.tenant_id
       AND project.id = deliverable.linked_production_project_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = deliverable.tenant_id
       AND location.id = deliverable.linked_location_id
      LEFT JOIN app_user owner_user
        ON owner_user.id = deliverable.owner_user_id
      WHERE deliverable.tenant_id = $1
        AND deliverable.id = $2
        ${scope === "own" ? "AND work_item.owner_user_id = $3" : ""}
      LIMIT 1
    `,
    scope === "own" ? [auth.tenantId, deliverableId, auth.id] : [auth.tenantId, deliverableId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "School deliverable not found.");
  }
  return mapSchoolDeliverable(rows[0]);
}

async function loadSchoolDeliverablesForWorkItem(client: PoolClient, auth: AuthUser, workItemId: string) {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to view the Schools Hub.");
  }
  const { rows } = await client.query<SchoolDeliverableRow>(
    `
      SELECT
        deliverable.id::text,
        deliverable.organization_id::text,
        COALESCE(org.display_name, org.canonical_name) AS school_name,
        deliverable.school_job_id::text,
        job.title AS school_job_title,
        deliverable.school_work_item_id::text,
        work_item.title AS school_work_item_title,
        deliverable.linked_shoot_id::text,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        deliverable.linked_production_project_id::text,
        project.title AS linked_production_project_title,
        deliverable.linked_location_id::text,
        location.name AS linked_location_name,
        deliverable.deliverable_type,
        deliverable.status,
        deliverable.owner_user_id::text,
        owner_user.full_name AS owner_name,
        deliverable.due_date::text,
        deliverable.ready_date::text,
        deliverable.delivered_date::text,
        deliverable.delivery_method,
        deliverable.tracking_reference,
        deliverable.notes,
        deliverable.created_at::text,
        deliverable.updated_at::text
      FROM school_deliverable deliverable
      JOIN organization org
        ON org.tenant_id = deliverable.tenant_id
       AND org.id = deliverable.organization_id
      LEFT JOIN school_job job
        ON job.tenant_id = deliverable.tenant_id
       AND job.id = deliverable.school_job_id
      LEFT JOIN school_work_item work_item
        ON work_item.tenant_id = deliverable.tenant_id
       AND work_item.id = deliverable.school_work_item_id
      LEFT JOIN shoot shoot
        ON shoot.tenant_id = deliverable.tenant_id
       AND shoot.id = deliverable.linked_shoot_id
      LEFT JOIN production_project project
        ON project.tenant_id = deliverable.tenant_id
       AND project.id = deliverable.linked_production_project_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = deliverable.tenant_id
       AND location.id = deliverable.linked_location_id
      LEFT JOIN app_user owner_user
        ON owner_user.id = deliverable.owner_user_id
      WHERE deliverable.tenant_id = $1
        AND deliverable.school_work_item_id = $2
        ${scope === "own" ? "AND work_item.owner_user_id = $3" : ""}
      ORDER BY
        CASE deliverable.status
          WHEN 'blocked' THEN 0
          WHEN 'ready' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'planned' THEN 3
          WHEN 'delivered' THEN 4
          ELSE 5
        END,
        COALESCE(deliverable.due_date, deliverable.ready_date, deliverable.created_at::date) ASC,
        deliverable.updated_at DESC
    `,
    scope === "own" ? [auth.tenantId, workItemId, auth.id] : [auth.tenantId, workItemId]
  );
  return rows;
}

async function loadSchoolWorkItemTimeline(client: PoolClient, auth: AuthUser, item: SchoolWorkItemRecord) {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to view the Schools Hub.");
  }
  const deliverables = await loadSchoolDeliverablesForWorkItem(client, auth, item.id);
  const auditRows = await client.query<SchoolWorkTimelineRow>(
    `
      SELECT
        audit.id::text AS id,
        'audit_log'::text AS source,
        audit.action AS event_type,
        audit.action AS label,
        COALESCE(audit.metadata ->> 'summary', audit.action) AS summary,
        NULL::text AS note,
        audit.actor_user_id::text,
        COALESCE(actor.full_name, actor.email, 'System') AS actor_name,
        audit.created_at::text AS created_at,
        audit.metadata
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.entity_type = 'school_work_item'
        AND audit.entity_id = $2
      ORDER BY audit.created_at DESC
      LIMIT 25
    `,
    [auth.tenantId, item.id]
  );
  const activityRows = await client.query<SchoolWorkTimelineRow>(
    `
      SELECT
        activity.id::text AS id,
        'school_activity_log'::text AS source,
        activity.activity_type::text AS event_type,
        activity.activity_type::text AS label,
        activity.summary,
        activity.detail AS note,
        activity.actor_user_id::text,
        COALESCE(actor.full_name, actor.email, 'System') AS actor_name,
        activity.created_at::text AS created_at,
        activity.metadata
      FROM school_activity_log activity
      LEFT JOIN app_user actor
        ON actor.id = activity.actor_user_id
      WHERE activity.tenant_id = $1
        AND activity.organization_id = $2
        AND activity.metadata ->> 'work_item_id' = $3
      ORDER BY activity.created_at DESC
      LIMIT 25
    `,
    [auth.tenantId, item.organization_id, item.id]
  );

  const deliverableRows: SchoolWorkTimelineRow[] = deliverables.flatMap((deliverable) => {
    const baseId = deliverable.id;
    const created: SchoolWorkTimelineRow[] = [
      {
        id: `${baseId}:created`,
        source: "deliverable",
        event_type: "deliverable_created",
        label: "Deliverable Created",
        summary: `${humanizeEnum(deliverable.deliverable_type)} deliverable created.`,
        note: deliverable.notes,
        actor_user_id: null,
        actor_name: deliverable.owner_name,
        created_at: deliverable.created_at,
        metadata: { school_deliverable_id: deliverable.id, status: deliverable.status }
      }
    ];
    if (deliverable.ready_date) {
      created.push({
        id: `${baseId}:ready`,
        source: "deliverable",
        event_type: "deliverable_ready",
        label: "Ready For Delivery",
        summary: `${humanizeEnum(deliverable.deliverable_type)} deliverable marked ready.`,
        note: deliverable.notes,
        actor_user_id: null,
        actor_name: deliverable.owner_name,
        created_at: deliverable.ready_date,
        metadata: { school_deliverable_id: deliverable.id, status: deliverable.status }
      });
    }
    if (deliverable.delivered_date) {
      created.push({
        id: `${baseId}:delivered`,
        source: "deliverable",
        event_type: "deliverable_delivered",
        label: "Delivered",
        summary: `${humanizeEnum(deliverable.deliverable_type)} deliverable delivered.`,
        note: deliverable.tracking_reference ? `Tracking/reference: ${deliverable.tracking_reference}` : deliverable.notes,
        actor_user_id: null,
        actor_name: deliverable.owner_name,
        created_at: deliverable.delivered_date,
        metadata: { school_deliverable_id: deliverable.id, status: deliverable.status }
      });
    }
    return created;
  });

  return [...auditRows.rows, ...activityRows.rows, ...deliverableRows]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 30);
}

function buildSchoolsHubSections(items: SchoolWorkItemRecord[], counts: SchoolsHubAggregateCounts, anchorDate: string): SchoolsHubSection[] {
  const dueSoonCutoff = addDays(anchorDate, 3);
  const yearbookCutoff = addDays(anchorDate, 14);
  const recentCompletedStart = addDays(anchorDate, -7);
  const countBySection: Record<SchoolsHubSection["id"], number> = {
    due_today: Number(counts.due_today ?? 0),
    overdue: Number(counts.overdue ?? 0),
    upcoming_shoots_needing_prep: Number(counts.upcoming_shoots_needing_prep ?? 0),
    waiting_on_school: Number(counts.waiting_on_school ?? 0),
    waiting_on_internal_production: Number(counts.waiting_on_internal_production ?? 0),
    id_work_queue: Number(counts.id_work_queue ?? 0),
    gallery_due_soon: Number(counts.gallery_due_soon ?? 0),
    yearbook_deadlines_approaching: Number(counts.yearbook_deadlines_approaching ?? 0),
    deliveries_ready: Number(counts.deliveries_ready ?? 0),
    recently_completed: Number(counts.recently_completed ?? 0)
  };

  const sectionDefinitions: Array<{
    id: SchoolsHubSection["id"];
    title: string;
    summary: string;
    matcher: (item: SchoolWorkItemRecord) => boolean;
  }> = [
    {
      id: "due_today",
      title: "Due Today",
      summary: "Work that needs to move today so school promises and release timing stay on track.",
      matcher: (item) => item.status !== "completed" && item.status !== "cancelled" && item.due_state === "due_today"
    },
    {
      id: "overdue",
      title: "Overdue",
      summary: "School work already past due that needs intervention before it drifts further.",
      matcher: (item) => item.status !== "completed" && item.status !== "cancelled" && item.due_state === "overdue"
    },
    {
      id: "upcoming_shoots_needing_prep",
      title: "Upcoming Shoots Needing Prep",
      summary: "Pre-shoot coordination still open against near-term school events and linked shoots.",
      matcher: (item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        item.work_type === "pre_shoot_coordination" &&
        Boolean(item.sla_date) &&
        String(item.sla_date) <= addDays(anchorDate, 7)
    },
    {
      id: "waiting_on_school",
      title: "Waiting on School",
      summary: "Items blocked on school response, roster input, or customer-side confirmation.",
      matcher: (item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        (item.waiting_on === "school" || item.stage === "waiting_on_school")
    },
    {
      id: "waiting_on_internal_production",
      title: "Waiting on Internal Production",
      summary: "School operations work dependent on post-shoot production or downstream internal handoff.",
      matcher: (item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        (item.waiting_on === "internal_production" || item.stage === "waiting_on_internal")
    },
    {
      id: "id_work_queue",
      title: "ID Work Queue",
      summary: "ID pulling, printing, sorting, and admin fulfillment work that still needs ownership or completion.",
      matcher: (item) => item.status !== "completed" && item.status !== "cancelled" && item.work_type === "id_production"
    },
    {
      id: "gallery_due_soon",
      title: "Gallery Due Soon",
      summary: "Gallery and portal release work coming due in the next few days.",
      matcher: (item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        item.work_type === "gallery_release" &&
        Boolean(item.due_date) &&
        String(item.due_date) <= dueSoonCutoff
    },
    {
      id: "yearbook_deadlines_approaching",
      title: "Yearbook Deadlines Approaching",
      summary: "Yearbook-sensitive work that should stay visible before the deadline pressure spikes.",
      matcher: (item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        item.work_type === "yearbook" &&
        Boolean(item.due_date) &&
        String(item.due_date) <= yearbookCutoff
    },
    {
      id: "deliveries_ready",
      title: "Deliveries Ready",
      summary: "School outputs ready to send, release, or hand off without inventing another board.",
      matcher: (item) =>
        item.status !== "completed" &&
        item.status !== "cancelled" &&
        item.stage === "ready_for_delivery"
    },
    {
      id: "recently_completed",
      title: "Recently Completed",
      summary: "Freshly closed work that still matters for handoff, reporting, and weekly review.",
      matcher: (item) =>
        item.status === "completed" && Boolean(item.completed_at) && String(item.completed_at).slice(0, 10) >= recentCompletedStart
    }
  ];

  return sectionDefinitions.map((section) => {
    const sectionItems = items.filter(section.matcher);
    return {
      id: section.id,
      title: section.title,
      summary: section.summary,
      count: countBySection[section.id],
      items: sectionItems.slice(0, 4)
    };
  });
}

function buildSchoolsHubSummary(counts: SchoolsHubAggregateCounts): SchoolsHubSummary {
  return {
    due_today: Number(counts.due_today ?? 0),
    overdue: Number(counts.overdue ?? 0),
    upcoming_shoots_needing_prep: Number(counts.upcoming_shoots_needing_prep ?? 0),
    waiting_on_school: Number(counts.waiting_on_school ?? 0),
    waiting_on_internal_production: Number(counts.waiting_on_internal_production ?? 0),
    id_work_queue: Number(counts.id_work_queue ?? 0),
    gallery_due_soon: Number(counts.gallery_due_soon ?? 0),
    yearbook_deadlines_approaching: Number(counts.yearbook_deadlines_approaching ?? 0),
    deliveries_ready: Number(counts.deliveries_ready ?? 0),
    recently_completed: Number(counts.recently_completed ?? 0),
    open_total: Number(counts.open_total ?? 0)
  };
}

function deriveDueState(row: Pick<SchoolWorkItemRow, "status" | "due_date" | "completed_at" | "sla_date">, anchorDate: string) {
  if (row.status === "completed" || row.completed_at) {
    return "completed" as const;
  }
  const compareDate = row.due_date ?? row.sla_date;
  if (!compareDate) {
    return "none" as const;
  }
  if (compareDate < anchorDate) {
    return "overdue" as const;
  }
  if (compareDate === anchorDate) {
    return "due_today" as const;
  }
  if (compareDate <= addDays(anchorDate, 3)) {
    return "due_soon" as const;
  }
  return "scheduled" as const;
}

function toneForWorkItem(row: SchoolWorkItemRow, dueState: SchoolWorkItemRecord["due_state"]): SchoolsHubTone {
  if (row.status === "completed") {
    return "success";
  }
  if (row.status === "blocked" || dueState === "overdue" || row.priority === "critical") {
    return "critical";
  }
  if (row.status === "waiting" || dueState === "due_today" || dueState === "due_soon") {
    return "warning";
  }
  if (row.stage === "ready_for_delivery" || row.status === "in_progress") {
    return "info";
  }
  return "neutral";
}

function labelForWorkItemStatus(status: SchoolWorkStatus, dueState: SchoolWorkItemRecord["due_state"]) {
  if (status !== "completed" && dueState === "overdue") {
    return "Overdue";
  }
  if (status !== "completed" && dueState === "due_today") {
    return "Due Today";
  }
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In Progress";
    case "waiting":
      return "Waiting";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function labelForWaitingOn(waitingOn: SchoolWorkWaitingOn) {
  switch (waitingOn) {
    case "none":
      return "No external wait";
    case "school":
      return "Waiting on School";
    case "internal_production":
      return "Waiting on Internal Production";
    case "internal_ops":
      return "Waiting on Internal Ops";
    case "shipping_vendor":
      return "Waiting on Shipping Vendor";
    case "billing":
      return "Waiting on Billing";
    case "other":
    default:
      return "Waiting on Other";
  }
}

function labelForSourceSystem(sourceSystem: SchoolWorkSourceSystem) {
  switch (sourceSystem) {
    case "mission_control":
      return "Mission Control";
    case "monday":
      return "Monday";
    case "manual_import":
      return "Manual Import";
    case "zendesk":
      return "Zendesk";
    case "outlook":
      return "Outlook";
    case "other":
    default:
      return "Other";
  }
}

function mapMondayExternalSync(
  row: Pick<
    SchoolJobRow | SchoolWorkItemRow,
    | "source_system"
    | "monday_external_record_id"
    | "monday_external_payload"
    | "monday_sync_operation_id"
    | "monday_sync_operation_status"
    | "monday_sync_updated_at"
    | "monday_sync_error"
    | "monday_sync_conflict_summary"
  >
): SchoolExternalSyncRecord | null {
  if (
    row.source_system !== "monday" &&
    !row.monday_external_record_id &&
    !row.monday_sync_operation_id &&
    !row.monday_sync_operation_status
  ) {
    return null;
  }

  const payload = row.monday_external_payload ?? {};
  const lastError = row.monday_sync_conflict_summary ?? row.monday_sync_error ?? readPayloadText(payload, "last_error");
  const syncState = resolveMondaySyncState(
    row.monday_sync_operation_status,
    Boolean(row.monday_external_record_id),
    Boolean(lastError)
  );

  return {
    provider: "monday",
    external_record_id: row.monday_external_record_id ?? readPayloadText(payload, "external_record_id"),
    external_record_url: readPayloadText(payload, "external_record_url") ?? buildMondayItemUrl(row.monday_external_record_id),
    external_record_name: readPayloadText(payload, "external_record_name"),
    board_id: readPayloadText(payload, "board_id"),
    board_name: readPayloadText(payload, "board_name"),
    group_id: readPayloadText(payload, "group_id"),
    group_title: readPayloadText(payload, "group_title"),
    last_synced_at: row.monday_sync_updated_at ?? readPayloadText(payload, "last_synced_at"),
    sync_state: syncState,
    sync_state_label: humanizeSyncState(syncState),
    last_error: lastError,
    last_operation_id: row.monday_sync_operation_id,
    last_operation_status: normalizeOperationStatus(row.monday_sync_operation_status),
    can_reimport: row.source_system === "monday"
  };
}

function resolveMondaySyncState(
  operationStatus: string | null,
  hasExternalLink: boolean,
  hasError: boolean
): SchoolExternalSyncRecord["sync_state"] {
  const normalizedStatus = normalizeOperationStatus(operationStatus);
  if (normalizedStatus === "pending" || normalizedStatus === "processing") {
    return "sync_pending";
  }
  if (normalizedStatus === "conflict") {
    return "conflict_detected";
  }
  if (normalizedStatus === "failed") {
    return "sync_failed";
  }
  if (normalizedStatus === "succeeded") {
    return "synced";
  }
  if (hasExternalLink && hasError) {
    return "partially_synced";
  }
  if (hasExternalLink) {
    return "archived_link";
  }
  return "never_synced";
}

function normalizeOperationStatus(value: string | null): SchoolExternalSyncRecord["last_operation_status"] {
  if (value === "pending" || value === "processing" || value === "succeeded" || value === "failed" || value === "conflict") {
    return value;
  }
  return null;
}

function readPayloadText(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildMondayItemUrl(itemId: string | null) {
  if (!itemId) {
    return null;
  }
  if (config.MONDAY_ITEM_URL_TEMPLATE.includes("{itemId}")) {
    return config.MONDAY_ITEM_URL_TEMPLATE.replace("{itemId}", encodeURIComponent(itemId));
  }
  if (config.MONDAY_ITEM_URL_TEMPLATE) {
    return `${config.MONDAY_ITEM_URL_TEMPLATE}${encodeURIComponent(itemId)}`;
  }
  return `#integrations?provider=monday&item=${encodeURIComponent(itemId)}`;
}

function humanizeSyncState(value: SchoolExternalSyncRecord["sync_state"]) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildDueLabel(row: SchoolWorkItemRow, dueState: SchoolWorkItemRecord["due_state"]) {
  const compareDate = row.due_date ?? row.sla_date;
  if (!compareDate) {
    return "No due date";
  }
  switch (dueState) {
    case "completed":
      return row.completed_at ? `Completed ${formatShortDate(String(row.completed_at).slice(0, 10))}` : "Completed";
    case "overdue":
      return `Overdue since ${formatShortDate(compareDate)}`;
    case "due_today":
      return "Due today";
    case "due_soon":
      return `Due ${formatShortDate(compareDate)}`;
    default:
      return `Scheduled ${formatShortDate(compareDate)}`;
  }
}

function buildFlags(
  row: SchoolWorkItemRow,
  dueState: SchoolWorkItemRecord["due_state"],
  waitingOnLabel: string
) {
  const flags: SchoolWorkItemRecord["flags"] = [];
  const externalSync = mapMondayExternalSync(row);
  if (row.priority === "critical") {
    flags.push({ label: "Critical priority", tone: "critical" });
  } else if (row.priority === "high") {
    flags.push({ label: "High priority", tone: "warning" });
  }
  if (dueState === "overdue") {
    flags.push({ label: "Past due", tone: "critical" });
  } else if (dueState === "due_today") {
    flags.push({ label: "Due today", tone: "warning" });
  }
  if (row.blocker_reason || row.status === "blocked") {
    flags.push({ label: "Blocked", tone: "critical" });
  }
  if (row.waiting_on !== "none") {
    flags.push({
      label: waitingOnLabel,
      tone: row.waiting_on === "school" ? "warning" : "info"
    });
  }
  if (row.generated_by_rule) {
    flags.push({ label: "Generated by rule", tone: "info" });
  }
  if (row.linked_production_project_id) {
    flags.push({ label: "Linked to production", tone: "info" });
  }
  if (externalSync?.sync_state === "conflict_detected") {
    flags.push({ label: "Monday sync conflict", tone: "critical" });
  } else if (externalSync?.sync_state === "sync_failed") {
    flags.push({ label: "Monday sync failed", tone: "warning" });
  }
  return flags.slice(0, 4);
}

export async function getSchoolsRiskSnapshot(
  client: PoolClient,
  auth: AuthUser,
  anchorDate: string
) {
  const scope = getSchoolsHubAccessScope(auth);
  if (!scope || scope === "own") {
    return null;
  }
  const { counts } = await listVisibleSchoolWorkItems(client, auth, scope, {
    anchor_date: anchorDate,
    page: 1,
    page_size: 1
  });
  const overdueCount = Number(counts.overdue ?? 0);
  const blockedCount = Number(counts.blocked ?? 0);
  const waitingOnSchoolCount = Number(counts.waiting_on_school ?? 0);
  const waitingOnInternalCount = Number(counts.waiting_on_internal_production ?? 0);
  const highRiskCount = overdueCount + blockedCount;
  const waitingCount = waitingOnSchoolCount + waitingOnInternalCount;
  return {
    overdue_count: overdueCount,
    blocked_count: blockedCount,
    waiting_on_school_count: waitingOnSchoolCount,
    waiting_on_internal_count: waitingOnInternalCount,
    due_today_count: Number(counts.due_today ?? 0),
    open_total: Number(counts.open_total ?? 0),
    deliveries_ready_count: Number(counts.deliveries_ready ?? 0),
    gallery_due_count: Number(counts.gallery_due_soon ?? 0),
    yearbook_due_count: Number(counts.yearbook_deadlines_approaching ?? 0),
    high_risk_count: highRiskCount,
    waiting_count: waitingCount,
    action_hash: "#schools",
    summary_line:
      highRiskCount > 0
        ? `${highRiskCount} school work item${highRiskCount === 1 ? "" : "s"} are overdue or blocked right now.`
        : waitingCount > 0
          ? `${waitingCount} school work item${waitingCount === 1 ? "" : "s"} are waiting on a handoff or school response.`
          : "No overdue or blocked school work is pressuring the queue right now."
  };
}

async function queueSchoolRiskNotificationIfNeeded(
  client: PoolClient,
  auth: AuthUser,
  item: SchoolWorkItemRecord
) {
  if (!item.owner_user_id || !isSchoolRiskNotificationCandidate(item)) {
    return;
  }

  const severity =
    item.status === "blocked" && item.priority === "critical"
      ? "critical"
      : item.due_state === "overdue" || item.status === "blocked"
        ? "high"
        : "medium";

  const bodyParts = [
    item.school_name,
    item.due_label,
    item.blocker_reason ? `Blocker: ${item.blocker_reason}` : null,
    item.waiting_on !== "none" ? `Waiting on ${item.waiting_on_label.toLowerCase()}` : null
  ].filter((value): value is string => Boolean(value));

  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds: [item.owner_user_id],
    relatedUserId: item.owner_user_id,
    notificationType: "schools.work_item_risk",
    category: "urgent_operational_risk",
    severity,
    actionRequired: true,
    allowSnooze: true,
    title: `${item.title} needs school follow-through`,
    body: bodyParts.join(" | "),
    deepLink: `#schools?item=${item.id}`,
    metadata: {
      dedupe: item.id,
      school_name: item.school_name,
      work_type: item.work_type,
      due_state: item.due_state,
      status: item.status,
      waiting_on: item.waiting_on
    },
    sourceEvent: "schools_hub.work_item.risk",
    groupKey: `schools:risk:${item.id}`
  });
}

function isSchoolRiskNotificationCandidate(item: SchoolWorkItemRecord) {
  if (item.status === "completed" || item.status === "cancelled") {
    return false;
  }
  return item.due_state === "overdue" || item.status === "blocked" || item.priority === "critical";
}

function normalizeQueuePage(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeQueuePageSize(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  return Math.max(10, Math.min(100, Math.floor(value)));
}

function normalizeIsoSecond(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function inferDeliverableTypeFromWorkItem(workType: SchoolWorkType): SchoolDeliverableType {
  switch (workType) {
    case "gallery_release":
      return "gallery";
    case "id_production":
      return "ids";
    case "yearbook":
      return "yearbook";
    case "graduation":
      return "graduation";
    case "delivery":
      return "shipment";
    case "admin_item":
      return "admin_items";
    default:
      return "other";
  }
}

function inferDeliveryMethodFromDeliverableType(deliverableType: SchoolDeliverableType): SchoolDeliveryMethod {
  switch (deliverableType) {
    case "gallery":
      return "digital";
    case "shipment":
      return "mail";
    default:
      return "pickup";
  }
}

function humanizeEnum(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeAnchorDate(value?: string | null) {
  const normalized = normalizeOptionalDate(value ?? null);
  if (normalized) {
    return normalized;
  }
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDays(value: string, delta: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

function formatShortDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((value) => value.trim()).filter(Boolean))];
}

function normalizeRequiredText(value: string | null | undefined, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new ApiError(400, `${label} is required.`);
  }
  return trimmed;
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

function assertSchoolsHubManageAccess(auth: AuthUser) {
  if (!canManageSchoolsHub(auth)) {
    throw new ApiError(403, "You do not have access to manage the Schools Hub.");
  }
}

async function ensureSchoolOrganization(client: PoolClient, auth: AuthUser, organizationId: string) {
  const { rows } = await client.query<SchoolOrganizationRow>(
    `
      SELECT
        org.id::text AS organization_id,
        org.account_type::text,
        COALESCE(org.display_name, org.canonical_name) AS display_name
      FROM organization org
      JOIN school_profile school_profile
        ON school_profile.tenant_id = org.tenant_id
       AND school_profile.organization_id = org.id
      WHERE org.tenant_id = $1
        AND org.id = $2
      LIMIT 1
    `,
    [auth.tenantId, organizationId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "School not found.");
  }
  return rows[0];
}

async function validateOwnerUser(client: PoolClient, auth: AuthUser, ownerUserId: string | null) {
  if (!ownerUserId) {
    return null;
  }
  const { rows } = await client.query<UserRow>(
    `
      SELECT id::text, full_name
      FROM app_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, ownerUserId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Owner must be a valid user in this tenant.");
  }
  return rows[0].id;
}

async function validateLinkedShoot(
  client: PoolClient,
  auth: AuthUser,
  linkedShootId: string | null,
  organizationId: string
) {
  if (!linkedShootId) {
    return null;
  }
  const { rows } = await client.query<ShootRow>(
    `
      SELECT id::text, organization_id::text, location_id::text
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, linkedShootId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Linked shoot was not found.");
  }
  if (rows[0].organization_id && rows[0].organization_id !== organizationId) {
    throw new ApiError(400, "Linked shoot must belong to the same school.");
  }
  return rows[0];
}

async function validateSchoolJob(
  client: PoolClient,
  auth: AuthUser,
  schoolJobId: string | null,
  organizationId: string
) {
  if (!schoolJobId) {
    return null;
  }
  const { rows } = await client.query<SchoolJobLinkRow>(
    `
      SELECT
        id::text,
        organization_id::text,
        linked_shoot_id::text,
        linked_location_id::text
      FROM school_job
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, schoolJobId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Linked school job was not found.");
  }
  if (rows[0].organization_id !== organizationId) {
    throw new ApiError(400, "Linked school job must belong to the same school.");
  }
  return rows[0];
}

async function validateLinkedLocation(
  client: PoolClient,
  auth: AuthUser,
  linkedLocationId: string | null,
  organizationId: string
) {
  if (!linkedLocationId) {
    return null;
  }
  const { rows } = await client.query<SchoolLocationRow>(
    `
      SELECT id::text, organization_id::text
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, linkedLocationId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Linked location was not found.");
  }
  if (rows[0].organization_id && rows[0].organization_id !== organizationId) {
    throw new ApiError(400, "Linked location must belong to the same school.");
  }
  return rows[0].id;
}

async function validateLinkedContact(
  client: PoolClient,
  auth: AuthUser,
  linkedContactId: string | null,
  organizationId: string
) {
  if (!linkedContactId) {
    return null;
  }
  const { rows } = await client.query<SchoolContactRow>(
    `
      SELECT id::text, organization_id::text
      FROM organization_contact
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, linkedContactId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Linked contact was not found.");
  }
  if (rows[0].organization_id !== organizationId) {
    throw new ApiError(400, "Linked contact must belong to the same school.");
  }
  return rows[0].id;
}

async function validateLinkedFollowUp(
  client: PoolClient,
  auth: AuthUser,
  linkedFollowUpId: string | null,
  organizationId: string
) {
  if (!linkedFollowUpId) {
    return null;
  }
  const { rows } = await client.query<FollowUpRow>(
    `
      SELECT
        id::text,
        organization_id::text,
        location_id::text,
        contact_id::text,
        linked_shoot_id::text
      FROM directory_relationship_follow_up
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, linkedFollowUpId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Linked follow-up was not found.");
  }
  if (rows[0].organization_id !== organizationId) {
    throw new ApiError(400, "Linked follow-up must belong to the same school.");
  }
  return rows[0];
}

async function validateLinkedProductionProject(
  client: PoolClient,
  auth: AuthUser,
  linkedProjectId: string | null,
  organizationId: string
) {
  if (!linkedProjectId) {
    return null;
  }
  const { rows } = await client.query<ProductionProjectRow>(
    `
      SELECT
        id::text,
        linked_organization_id::text,
        linked_location_id::text,
        linked_shoot_id::text
      FROM production_project
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, linkedProjectId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "Linked production project was not found.");
  }
  if (rows[0].linked_organization_id && rows[0].linked_organization_id !== organizationId) {
    throw new ApiError(400, "Linked production project must belong to the same school.");
  }
  return rows[0];
}

function assertSchoolWorkItemLinkConsistency(input: {
  schoolJob: SchoolJobLinkRow | null;
  linkedShootId: string | null;
  linkedLocationId: string | null;
  linkedContactId: string | null;
  linkedFollowUp: FollowUpRow | null;
  linkedProject: ProductionProjectRow | null;
}) {
  if (input.schoolJob?.linked_shoot_id && input.linkedShootId && input.schoolJob.linked_shoot_id !== input.linkedShootId) {
    throw new ApiError(400, "Linked shoot must match the selected school job.");
  }
  if (input.schoolJob?.linked_location_id && input.linkedLocationId && input.schoolJob.linked_location_id !== input.linkedLocationId) {
    throw new ApiError(400, "Linked location must match the selected school job.");
  }
  if (input.linkedFollowUp?.linked_shoot_id && input.linkedShootId && input.linkedFollowUp.linked_shoot_id !== input.linkedShootId) {
    throw new ApiError(400, "Linked follow-up points to a different shoot.");
  }
  if (input.linkedFollowUp?.location_id && input.linkedLocationId && input.linkedFollowUp.location_id !== input.linkedLocationId) {
    throw new ApiError(400, "Linked follow-up points to a different location.");
  }
  if (input.linkedFollowUp?.contact_id && input.linkedContactId && input.linkedFollowUp.contact_id !== input.linkedContactId) {
    throw new ApiError(400, "Linked follow-up points to a different contact.");
  }
  if (input.linkedProject?.linked_shoot_id && input.linkedShootId && input.linkedProject.linked_shoot_id !== input.linkedShootId) {
    throw new ApiError(400, "Linked production project points to a different shoot.");
  }
  if (input.linkedProject?.linked_location_id && input.linkedLocationId && input.linkedProject.linked_location_id !== input.linkedLocationId) {
    throw new ApiError(400, "Linked production project points to a different location.");
  }
}

function normalizeSchoolWorkLifecycle(input: {
  status: SchoolWorkStatus;
  stage: SchoolWorkStage | null;
  waitingOn: SchoolWorkWaitingOn;
  blockerReason: string | null;
  completedAt: string | null;
}) {
  let waitingOn = input.waitingOn;
  if (waitingOn === "none") {
    const inferredWaitingOn = inferWaitingOnFromStage(input.stage);
    if (inferredWaitingOn) {
      waitingOn = inferredWaitingOn;
    }
  }

  if (input.status === "completed") {
    return {
      status: "completed" as const,
      stage: "done" as const,
      waitingOn: "none" as const,
      blockerReason: null,
      completedAt: input.completedAt ?? new Date().toISOString()
    };
  }

  if (input.status === "cancelled") {
    return {
      status: "cancelled" as const,
      stage: normalizeActiveStage("open", input.stage, "none"),
      waitingOn: "none" as const,
      blockerReason: null,
      completedAt: null
    };
  }

  if (input.status === "blocked") {
    const blockerReason = input.blockerReason ?? "Blocked pending review.";
    const normalizedWaitingOn = waitingOn === "none" ? "internal_ops" : waitingOn;
    return {
      status: "blocked" as const,
      stage: deriveWaitingStage(input.stage, normalizedWaitingOn),
      waitingOn: normalizedWaitingOn,
      blockerReason,
      completedAt: null
    };
  }

  if (input.status === "waiting") {
    const normalizedWaitingOn = waitingOn === "none" ? "internal_ops" : waitingOn;
    return {
      status: "waiting" as const,
      stage: deriveWaitingStage(input.stage, normalizedWaitingOn),
      waitingOn: normalizedWaitingOn,
      blockerReason: null,
      completedAt: null
    };
  }

  return {
    status: input.status,
    stage: normalizeActiveStage(input.status, input.stage, waitingOn),
    waitingOn,
    blockerReason: null,
    completedAt: null
  };
}

function inferWaitingOnFromStage(stage: SchoolWorkStage | null) {
  if (stage === "waiting_on_school") {
    return "school" as const;
  }
  if (stage === "waiting_on_internal") {
    return "internal_ops" as const;
  }
  return null;
}

function deriveWaitingStage(stage: SchoolWorkStage | null, waitingOn: SchoolWorkWaitingOn) {
  void stage;
  return waitingOn === "school" ? "waiting_on_school" : "waiting_on_internal";
}

function normalizeActiveStage(status: SchoolWorkStatus, stage: SchoolWorkStage | null, waitingOn: SchoolWorkWaitingOn) {
  if (stage && stage !== "done") {
    if (stage === "waiting_on_school" || stage === "waiting_on_internal") {
      if (waitingOn !== "none") {
        return deriveWaitingStage(stage, waitingOn);
      }
      return status === "open" ? "planning" : "active";
    }
    return stage;
  }
  if (waitingOn === "school") {
    return "waiting_on_school" as const;
  }
  if (waitingOn !== "none") {
    return "waiting_on_internal" as const;
  }
  return status === "open" ? "planning" : "active";
}
