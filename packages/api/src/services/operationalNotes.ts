import type { PoolClient } from "pg";
import { canCreateOrEditShootDepartment, hasAuthorityTier, hasJobFunctionProfile, hasPermissionCode } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, DepartmentCode } from "../types/auth.js";
import type {
  OperationalNoteFilter,
  OperationalNoteObjectType,
  OperationalNotePermanence,
  OperationalNotePublicationState,
  OperationalNoteType,
  OperationalNoteVisibilityScope
} from "../types/operationalNotes.js";
import { createAuditLog } from "./audit.js";
import {
  canArchiveOperationalNotes,
  canCreateOperationalNotes,
  canPublishOperationalNotes,
  canUpdateOperationalNotes,
  canViewOperationalNotes,
  canViewSensitiveOperationalNotes,
  withDepartmentContext
} from "./policy/index.js";
import { assertShootAccess } from "./shootAccess.js";
import { assertShiftAccess } from "./shiftAccess.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type NotesSummary = {
  total_count: number;
  pinned_count: number;
  important_count: number;
  post_shoot_follow_up_count: number;
  proposed_location_memory_count: number;
  latest_preview: string | null;
  latest_note_at: string | null;
};

type NoteListInput = {
  objectType: OperationalNoteObjectType;
  objectId: string;
  filter?: OperationalNoteFilter | null;
  search?: string | null;
  includeArchived?: boolean;
};

type CreateNoteInput = {
  objectType: OperationalNoteObjectType;
  objectId: string;
  noteType: OperationalNoteType;
  body: string;
  pinned?: boolean;
  visibilityScope?: OperationalNoteVisibilityScope | null;
  sourceContext?: string | null;
  mentionMetadata?: unknown;
  attachmentRefs?: unknown;
};

type UpdateNoteInput = {
  body?: string;
  pinned?: boolean;
  visibilityScope?: OperationalNoteVisibilityScope | null;
  sourceContext?: string | null;
  reason?: string | null;
};

type ArchiveNoteInput = {
  reason?: string | null;
};

type PromoteNoteInput = {
  targetLocationId?: string | null;
  body?: string | null;
  pinned?: boolean;
  sourceContext?: string | null;
};

type PublishLocationMemoryInput = {
  pinned?: boolean;
  visibilityScope?: OperationalNoteVisibilityScope | null;
  reason?: string | null;
};

type NoteObjectContext = {
  objectType: OperationalNoteObjectType;
  objectId: string;
  objectLabel: string;
  department: DepartmentCode | null;
  shootId: string | null;
  shiftId: string | null;
  locationId: string | null;
  alertId: string | null;
  assignedUserId: string | null;
  managerUserId: string | null;
  assignedUserIds: string[];
  leadUserIds: string[];
};

type NoteRow = {
  id: string;
  object_type: OperationalNoteObjectType;
  object_id: string;
  note_type: OperationalNoteType;
  body: string;
  author_user_id: string | null;
  author_name: string | null;
  edited_by_user_id: string | null;
  edited_by_name: string | null;
  archived_by_user_id: string | null;
  archived_by_name: string | null;
  promoted_from_note_id: string | null;
  promoted_to_location_id: string | null;
  promotion_reviewed_by_user_id: string | null;
  promotion_reviewed_by_name: string | null;
  permanence_classification: OperationalNotePermanence;
  visibility_scope: OperationalNoteVisibilityScope;
  publication_state: OperationalNotePublicationState;
  source_context: string;
  mention_metadata: unknown;
  attachment_refs: unknown;
  pinned: boolean;
  edited_at: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  promotion_requested_at: string | null;
  promotion_published_at: string | null;
  created_at: string;
  updated_at: string;
  revision_count: string | number;
};

type VisibleNoteRecord = {
  id: string;
  object_type: OperationalNoteObjectType;
  object_id: string;
  note_type: OperationalNoteType;
  note_type_label: string;
  body: string;
  author_user_id: string | null;
  author_name: string | null;
  edited_by_user_id: string | null;
  edited_by_name: string | null;
  archived_by_user_id: string | null;
  archived_by_name: string | null;
  promoted_from_note_id: string | null;
  promoted_to_location_id: string | null;
  promotion_reviewed_by_user_id: string | null;
  promotion_reviewed_by_name: string | null;
  permanence_classification: OperationalNotePermanence;
  permanence_label: string;
  visibility_scope: OperationalNoteVisibilityScope;
  visibility_label: string;
  publication_state: OperationalNotePublicationState;
  publication_label: string;
  source_context: string;
  mention_metadata: unknown;
  attachment_refs: unknown;
  pinned: boolean;
  edited_at: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  promotion_requested_at: string | null;
  promotion_published_at: string | null;
  created_at: string;
  updated_at: string;
  revision_count: number;
  edited: boolean;
  historical: boolean;
  can_edit: boolean;
  can_archive: boolean;
  can_promote_to_location_memory: boolean;
  can_publish_location_memory: boolean;
};

function normalizeBody(value: string) {
  return value.trim().replace(/\r\n/g, "\n");
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeNoteType(noteType: OperationalNoteType) {
  if (noteType === "location_memory") {
    return "Location Memory";
  }
  if (noteType === "post_shoot_follow_up") {
    return "Post-Shoot Follow-Up";
  }
  if (noteType === "temporary_note") {
    return "Temporary Note";
  }
  if (noteType === "permanent_note") {
    return "Permanent Note";
  }
  return "Operational Update";
}

function humanizeVisibilityScope(scope: OperationalNoteVisibilityScope) {
  switch (scope) {
    case "object_viewers":
      return "Object Viewers";
    case "assigned_staff_and_managers":
      return "Assigned Staff + Managers";
    case "managers_and_leadership":
      return "Managers + Leadership";
    case "leadership_only":
      return "Leadership Only";
    default:
      return humanizeValue(scope);
  }
}

function humanizePermanence(permanence: OperationalNotePermanence) {
  switch (permanence) {
    case "persistent_memory":
      return "Persistent Memory";
    case "follow_up":
      return "Follow-Up";
    default:
      return humanizeValue(permanence);
  }
}

function humanizePublicationState(state: OperationalNotePublicationState) {
  return state === "proposed" ? "Proposed" : "Active";
}

function derivePermanence(noteType: OperationalNoteType): OperationalNotePermanence {
  switch (noteType) {
    case "permanent_note":
      return "permanent";
    case "location_memory":
      return "persistent_memory";
    case "post_shoot_follow_up":
      return "follow_up";
    default:
      return "temporary";
  }
}

function sanitizeJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isLeadershipOrDirector(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

function isDepartmentManager(auth: AuthUser, department: DepartmentCode | null) {
  if (!department) {
    return false;
  }
  if (isLeadershipOrDirector(auth)) {
    return true;
  }
  return canCreateOrEditShootDepartment(auth, department) && !hasJobFunctionProfile(auth, ["associate_photographer", "seasonal_photographer", "part_time_photographer"]);
}

function canViewLocationRecords(auth: AuthUser) {
  return hasPermissionCode(auth, "shoot.read") || hasPermissionCode(auth, "schedule.read") || hasPermissionCode(auth, "shoot_locations.view");
}

function canManageLocationNotes(auth: AuthUser) {
  return isLeadershipOrDirector(auth) || hasJobFunctionProfile(auth, ["schools_client_success", "sports_client_success"]);
}

function buildNotePermissionContext(context: NoteObjectContext) {
  return withDepartmentContext(context.department, {
    locationId: context.locationId,
    ownerUserIds: [context.managerUserId],
    assignedUserIds: context.assignedUserIds,
    targetUserId: context.assignedUserId,
    customScopeValues: context.leadUserIds
  });
}

function matchesSearch(row: VisibleNoteRecord, search: string | null | undefined) {
  if (!search?.trim()) {
    return true;
  }
  const lowered = search.trim().toLowerCase();
  return `${row.body} ${row.author_name ?? ""} ${row.note_type_label}`.toLowerCase().includes(lowered);
}

function matchesFilter(row: VisibleNoteRecord, filter: OperationalNoteFilter | null | undefined) {
  switch (filter) {
    case "important":
      return row.pinned || ["permanent_note", "location_memory", "post_shoot_follow_up"].includes(row.note_type);
    case "temporary":
      return ["operational_update", "temporary_note"].includes(row.note_type);
    case "permanent":
      return row.note_type === "permanent_note";
    case "location_memory":
      return row.note_type === "location_memory";
    case "post_shoot_follow_up":
      return row.note_type === "post_shoot_follow_up";
    default:
      return true;
  }
}

function isTemporaryAging(row: Pick<NoteRow, "note_type" | "created_at">) {
  if (!["operational_update", "temporary_note"].includes(row.note_type)) {
    return false;
  }
  return Date.now() - new Date(row.created_at).getTime() > 30 * 24 * 60 * 60 * 1000;
}

async function loadShootContext(client: PoolClient, auth: AuthUser, shootId: string): Promise<NoteObjectContext> {
  await assertShootAccess(client, auth, shootId);
  const { rows } = await client.query<{
    id: string;
    title: string;
    department: DepartmentCode | null;
    location_id: string | null;
    assigned_user_ids: string[] | null;
    lead_user_ids: string[] | null;
  }>(
    `
      SELECT
        s.id,
        s.title,
        s.department::text AS department,
        sl.location_id::text AS location_id,
        COALESCE(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
          ),
          ARRAY[]::text[]
        ) AS assigned_user_ids,
        COALESCE(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = s.tenant_id
              AND ws.shoot_id = s.id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          ARRAY[]::text[]
        ) AS lead_user_ids
      FROM shoot s
      LEFT JOIN shoot_location_link sl ON sl.tenant_id = s.tenant_id AND sl.shoot_id = s.id
      WHERE s.tenant_id = $1
        AND s.id = $2
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shootId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Shoot not found");
  }
  return {
    objectType: "shoot",
    objectId: row.id,
    objectLabel: row.title,
    department: row.department,
    shootId: row.id,
    shiftId: null,
    locationId: row.location_id ?? null,
    alertId: null,
    assignedUserId: null,
    managerUserId: null,
    assignedUserIds: row.assigned_user_ids ?? [],
    leadUserIds: row.lead_user_ids ?? []
  };
}

async function loadShiftContext(client: PoolClient, auth: AuthUser, shiftId: string): Promise<NoteObjectContext> {
  await assertShiftAccess(client, auth, shiftId);
  const { rows } = await client.query<{
    id: string;
    title: string;
    department: DepartmentCode | null;
    assigned_user_id: string | null;
    manager_user_id: string | null;
    shoot_id: string | null;
    location_id: string | null;
    lead_user_ids: string[] | null;
  }>(
    `
      SELECT
        ws.id,
        ws.title,
        ws.department::text AS department,
        ws.assigned_user_id::text,
        ws.manager_user_id::text,
        ws.shoot_id::text,
        sl.location_id::text AS location_id,
        COALESCE(
          (
            SELECT array_agg(DISTINCT other.assigned_user_id::text)
            FROM work_shift other
            WHERE other.tenant_id = ws.tenant_id
              AND other.shoot_id = ws.shoot_id
              AND other.cancelled_at IS NULL
              AND other.status IN ('draft', 'published', 'completed')
              AND other.satisfies_lead_coverage = true
          ),
          ARRAY[]::text[]
        ) AS lead_user_ids
      FROM work_shift ws
      LEFT JOIN shoot_location_link sl ON sl.tenant_id = ws.tenant_id AND sl.shoot_id = ws.shoot_id
      WHERE ws.tenant_id = $1
        AND ws.id = $2
        AND ws.cancelled_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shiftId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Shift not found");
  }
  return {
    objectType: "shift",
    objectId: row.id,
    objectLabel: row.title,
    department: row.department,
    shootId: row.shoot_id ?? null,
    shiftId: row.id,
    locationId: row.location_id ?? null,
    alertId: null,
    assignedUserId: row.assigned_user_id ?? null,
    managerUserId: row.manager_user_id ?? null,
    assignedUserIds: row.assigned_user_id ? [row.assigned_user_id] : [],
    leadUserIds: row.lead_user_ids ?? []
  };
}

async function loadLocationContext(client: PoolClient, auth: AuthUser, locationId: string): Promise<NoteObjectContext> {
  if (!canViewLocationRecords(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const { rows } = await client.query<{ id: string; name: string }>(
    `
      SELECT id, name
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, locationId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Location not found");
  }
  return {
    objectType: "location",
    objectId: row.id,
    objectLabel: row.name,
    department: null,
    shootId: null,
    shiftId: null,
    locationId: row.id,
    alertId: null,
    assignedUserId: null,
    managerUserId: null,
    assignedUserIds: [],
    leadUserIds: []
  };
}

async function loadAlertContext(client: PoolClient, auth: AuthUser, alertId: string): Promise<NoteObjectContext> {
  if (!hasPermissionCode(auth, "alerts.read")) {
    throw new ApiError(403, "Forbidden");
  }
  const { rows } = await client.query<{
    id: string;
    alert_type: string;
    shoot_id: string | null;
    department: DepartmentCode | null;
    location_id: string | null;
    assigned_user_ids: string[] | null;
    lead_user_ids: string[] | null;
  }>(
    `
      SELECT
        a.id,
        a.alert_type,
        a.shoot_id::text,
        s.department::text AS department,
        sl.location_id::text AS location_id,
        COALESCE(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = a.tenant_id
              AND ws.shoot_id = a.shoot_id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
          ),
          ARRAY[]::text[]
        ) AS assigned_user_ids,
        COALESCE(
          (
            SELECT array_agg(DISTINCT ws.assigned_user_id::text)
            FROM work_shift ws
            WHERE ws.tenant_id = a.tenant_id
              AND ws.shoot_id = a.shoot_id
              AND ws.cancelled_at IS NULL
              AND ws.status IN ('draft', 'published', 'completed')
              AND ws.satisfies_lead_coverage = true
          ),
          ARRAY[]::text[]
        ) AS lead_user_ids
      FROM alert a
      LEFT JOIN shoot s ON s.id = a.shoot_id AND s.tenant_id = a.tenant_id
      LEFT JOIN shoot_location_link sl ON sl.tenant_id = a.tenant_id AND sl.shoot_id = a.shoot_id
      WHERE a.tenant_id = $1
        AND a.id = $2
      LIMIT 1
    `,
    [auth.tenantId, alertId]
  );
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "Alert not found");
  }
  return {
    objectType: "alert",
    objectId: row.id,
    objectLabel: humanizeValue(row.alert_type),
    department: row.department,
    shootId: row.shoot_id ?? null,
    shiftId: null,
    locationId: row.location_id ?? null,
    alertId: row.id,
    assignedUserId: null,
    managerUserId: null,
    assignedUserIds: row.assigned_user_ids ?? [],
    leadUserIds: row.lead_user_ids ?? []
  };
}

async function loadObjectContext(client: PoolClient, auth: AuthUser, objectType: OperationalNoteObjectType, objectId: string) {
  switch (objectType) {
    case "shoot":
      return loadShootContext(client, auth, objectId);
    case "shift":
      return loadShiftContext(client, auth, objectId);
    case "location":
      return loadLocationContext(client, auth, objectId);
    case "alert":
      return loadAlertContext(client, auth, objectId);
    default:
      throw new ApiError(400, "Unsupported note object");
  }
}

function isAssignedParticipant(auth: AuthUser, context: NoteObjectContext) {
  if (context.objectType === "shift") {
    return context.assignedUserId === auth.id;
  }
  return context.assignedUserIds.includes(auth.id);
}

function isLeadScopedContributor(auth: AuthUser, context: NoteObjectContext) {
  return context.leadUserIds.includes(auth.id) || context.managerUserId === auth.id;
}

function canViewManagerScope(auth: AuthUser, context: NoteObjectContext) {
  return isLeadershipOrDirector(auth) || isDepartmentManager(auth, context.department) || isLeadScopedContributor(auth, context);
}

function canManageObject(auth: AuthUser, context: NoteObjectContext) {
  const permissionContext = buildNotePermissionContext(context);
  if (!canUpdateOperationalNotes(auth, permissionContext)) {
    return false;
  }
  if (isLeadershipOrDirector(auth)) {
    return true;
  }
  if (context.objectType === "location") {
    return canManageLocationNotes(auth) || canPublishOperationalNotes(auth, permissionContext);
  }
  return isDepartmentManager(auth, context.department) || context.managerUserId === auth.id;
}

function allowedCreateTypes(auth: AuthUser, context: NoteObjectContext): OperationalNoteType[] {
  const permissionContext = buildNotePermissionContext(context);
  if (!canCreateOperationalNotes(auth, permissionContext)) {
    // Assigned field staff can still submit tightly-scoped operational notes
    // on their own active work records without broad note authoring access.
    if (context.objectType !== "location" && context.objectType !== "alert" && isAssignedParticipant(auth, context)) {
      return ["operational_update", "temporary_note", "post_shoot_follow_up"];
    }
    return [];
  }
  if (context.objectType === "location") {
    if (canManageObject(auth, context)) {
      return ["operational_update", "temporary_note", "permanent_note", "location_memory"];
    }
    return [];
  }
  if (context.objectType === "alert") {
    return canManageObject(auth, context) ? ["operational_update", "temporary_note", "permanent_note"] : [];
  }
  if (canManageObject(auth, context) || isLeadScopedContributor(auth, context)) {
    return ["operational_update", "temporary_note", "permanent_note", "post_shoot_follow_up"];
  }
  if (isAssignedParticipant(auth, context)) {
    return ["operational_update", "temporary_note", "post_shoot_follow_up"];
  }
  return [];
}

function defaultVisibilityScope(auth: AuthUser, context: NoteObjectContext, noteType: OperationalNoteType): OperationalNoteVisibilityScope {
  if (context.objectType === "alert") {
    return "managers_and_leadership";
  }
  if (noteType === "location_memory") {
    return "object_viewers";
  }
  if (context.objectType === "location") {
    return canManageObject(auth, context) ? "object_viewers" : "managers_and_leadership";
  }
  if (canManageObject(auth, context) && noteType === "permanent_note") {
    return "object_viewers";
  }
  return "assigned_staff_and_managers";
}

function allowedVisibilityScopes(auth: AuthUser, context: NoteObjectContext): OperationalNoteVisibilityScope[] {
  if (isLeadershipOrDirector(auth)) {
    return ["object_viewers", "assigned_staff_and_managers", "managers_and_leadership", "leadership_only"];
  }
  if (canManageObject(auth, context)) {
    return ["object_viewers", "assigned_staff_and_managers", "managers_and_leadership"];
  }
  return ["assigned_staff_and_managers"];
}

function canPinNotes(auth: AuthUser, context: NoteObjectContext) {
  return canManageObject(auth, context);
}

function canPromoteToLocationMemory(auth: AuthUser, context: NoteObjectContext) {
  if (!context.locationId) {
    return false;
  }
  return canManageObject(auth, context) || isLeadScopedContributor(auth, context);
}

function canPublishLocationMemory(auth: AuthUser, context: NoteObjectContext) {
  const permissionContext = buildNotePermissionContext(context);
  if (!canPublishOperationalNotes(auth, permissionContext)) {
    return false;
  }
  if (!context.locationId) {
    return false;
  }
  if (context.objectType === "location") {
    return canManageObject(auth, context);
  }
  return canManageLocationNotes(auth) || canManageObject(auth, context);
}

function canViewNoteWithVisibility(auth: AuthUser, context: NoteObjectContext, row: NoteRow) {
  const permissionContext = buildNotePermissionContext(context);
  if (!canViewOperationalNotes(auth, permissionContext)) {
    return false;
  }
  if (row.note_type === "location_memory" && row.publication_state === "proposed" && !canPublishLocationMemory(auth, context)) {
    return false;
  }
  switch (row.visibility_scope) {
    case "object_viewers":
      return true;
    case "assigned_staff_and_managers":
      return isAssignedParticipant(auth, context) || canViewManagerScope(auth, context);
    case "managers_and_leadership":
      return canViewManagerScope(auth, context) && canViewSensitiveOperationalNotes(auth, permissionContext);
    case "leadership_only":
      return isLeadershipOrDirector(auth) && canViewSensitiveOperationalNotes(auth, permissionContext);
    default:
      return false;
  }
}

function canEditOwnWithinGrace(auth: AuthUser, row: NoteRow) {
  if (!row.author_user_id || row.author_user_id !== auth.id || row.archived_at || row.note_type === "location_memory") {
    return false;
  }
  const graceMinutes = row.note_type === "permanent_note" ? 10 : 15;
  const ageMinutes = (Date.now() - new Date(row.created_at).getTime()) / 60000;
  return ageMinutes <= graceMinutes;
}

function canEditNote(auth: AuthUser, context: NoteObjectContext, row: NoteRow) {
  if (!canUpdateOperationalNotes(auth, buildNotePermissionContext(context))) {
    return false;
  }
  if (canManageObject(auth, context)) {
    return !row.archived_at;
  }
  return canEditOwnWithinGrace(auth, row);
}

function canArchiveNote(auth: AuthUser, context: NoteObjectContext) {
  return canManageObject(auth, context) && canArchiveOperationalNotes(auth, buildNotePermissionContext(context));
}

async function loadRawObjectNotes(client: PoolClient, tenantId: string, objectType: OperationalNoteObjectType, objectId: string) {
  const { rows } = await client.query<NoteRow>(
    `
      SELECT
        note.*,
        author.full_name AS author_name,
        editor.full_name AS edited_by_name,
        archiver.full_name AS archived_by_name,
        reviewer.full_name AS promotion_reviewed_by_name,
        COALESCE(
          (
            SELECT COUNT(*)
            FROM operational_note_revision rev
            WHERE rev.note_id = note.id
          ),
          0
        ) AS revision_count
      FROM operational_note note
      LEFT JOIN app_user author ON author.id = note.author_user_id
      LEFT JOIN app_user editor ON editor.id = note.edited_by_user_id
      LEFT JOIN app_user archiver ON archiver.id = note.archived_by_user_id
      LEFT JOIN app_user reviewer ON reviewer.id = note.promotion_reviewed_by_user_id
      WHERE note.tenant_id = $1
        AND note.object_type = $2::operational_note_object_type
        AND note.object_id = $3::uuid
      ORDER BY note.pinned DESC, note.created_at DESC
    `,
    [tenantId, objectType, objectId]
  );
  return rows;
}

function decorateVisibleNote(auth: AuthUser, context: NoteObjectContext, row: NoteRow): VisibleNoteRecord {
  return {
    id: row.id,
    object_type: row.object_type,
    object_id: row.object_id,
    note_type: row.note_type,
    note_type_label: humanizeNoteType(row.note_type),
    body: row.body,
    author_user_id: row.author_user_id,
    author_name: row.author_name,
    edited_by_user_id: row.edited_by_user_id,
    edited_by_name: row.edited_by_name,
    archived_by_user_id: row.archived_by_user_id,
    archived_by_name: row.archived_by_name,
    promoted_from_note_id: row.promoted_from_note_id,
    promoted_to_location_id: row.promoted_to_location_id,
    promotion_reviewed_by_user_id: row.promotion_reviewed_by_user_id,
    promotion_reviewed_by_name: row.promotion_reviewed_by_name,
    permanence_classification: row.permanence_classification,
    permanence_label: humanizePermanence(row.permanence_classification),
    visibility_scope: row.visibility_scope,
    visibility_label: humanizeVisibilityScope(row.visibility_scope),
    publication_state: row.publication_state,
    publication_label: humanizePublicationState(row.publication_state),
    source_context: row.source_context,
    mention_metadata: sanitizeJsonArray(row.mention_metadata),
    attachment_refs: sanitizeJsonArray(row.attachment_refs),
    pinned: Boolean(row.pinned),
    edited_at: row.edited_at,
    archived_at: row.archived_at,
    archived_reason: row.archived_reason,
    promotion_requested_at: row.promotion_requested_at,
    promotion_published_at: row.promotion_published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revision_count: Number(row.revision_count ?? 0),
    edited: Boolean(row.edited_at) || Number(row.revision_count ?? 0) > 0,
    historical: isTemporaryAging(row),
    can_edit: canEditNote(auth, context, row),
    can_archive: canArchiveNote(auth, context),
    can_promote_to_location_memory:
      row.note_type !== "location_memory" && !row.archived_at && Boolean(context.locationId) && canPromoteToLocationMemory(auth, context),
    can_publish_location_memory:
      row.note_type === "location_memory" &&
      row.publication_state === "proposed" &&
      !row.archived_at &&
      canPublishLocationMemory(auth, context)
  };
}

function buildNotesSummary(notes: VisibleNoteRecord[]) {
  const active = notes.filter((note) => !note.archived_at);
  const latest = active[0] ?? null;
  return {
    total_count: active.length,
    pinned_count: active.filter((note) => note.pinned).length,
    important_count: active.filter((note) => note.pinned || ["permanent_note", "location_memory", "post_shoot_follow_up"].includes(note.note_type)).length,
    post_shoot_follow_up_count: active.filter((note) => note.note_type === "post_shoot_follow_up").length,
    proposed_location_memory_count: active.filter((note) => note.note_type === "location_memory" && note.publication_state === "proposed").length,
    latest_preview: latest ? latest.body.slice(0, 140) : null,
    latest_note_at: latest?.created_at ?? null
  };
}

async function listLocationMemoryRows(
  client: PoolClient,
  auth: AuthUser,
  locationId: string,
  options?: {
    includeArchived?: boolean;
    limit?: number;
  }
) {
  const locationContext = await loadLocationContext(client, auth, locationId);
  const rawRows = await loadRawObjectNotes(client, auth.tenantId, "location", locationId);
  const visibleRows = rawRows
    .filter((row) => row.note_type === "location_memory")
    .filter((row) => (options?.includeArchived ? true : !row.archived_at))
    .filter((row) => canViewNoteWithVisibility(auth, locationContext, row))
    .map((row) => decorateVisibleNote(auth, locationContext, row));

  return {
    context: locationContext,
    notes: typeof options?.limit === "number" ? visibleRows.slice(0, options.limit) : visibleRows
  };
}

function buildCapabilities(auth: AuthUser, context: NoteObjectContext) {
  return {
    can_create: allowedCreateTypes(auth, context).length > 0,
    can_manage: canManageObject(auth, context),
    can_view_archived: canManageObject(auth, context),
    can_pin_notes: canPinNotes(auth, context),
    can_promote_to_location_memory: canPromoteToLocationMemory(auth, context),
    can_publish_location_memory: canPublishLocationMemory(auth, context),
    allowed_create_types: allowedCreateTypes(auth, context),
    allowed_visibility_scopes: allowedVisibilityScopes(auth, context)
  };
}

async function insertRevision(
  client: PoolClient,
  auth: AuthUser,
  noteId: string,
  beforeValue: Record<string, unknown>,
  afterValue: Record<string, unknown>,
  sourceContext: string,
  reason?: string | null
) {
  await client.query(
    `
      INSERT INTO operational_note_revision (
        tenant_id, note_id, edited_by_user_id, source_context, reason, before_value, after_value
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
    `,
    [auth.tenantId, noteId, auth.id, sourceContext, reason ?? null, JSON.stringify(beforeValue), JSON.stringify(afterValue)]
  );
}

function assertCreateAllowed(auth: AuthUser, context: NoteObjectContext, input: CreateNoteInput) {
  const allowed = allowedCreateTypes(auth, context);
  if (!allowed.includes(input.noteType)) {
    throw new ApiError(403, "You can't add that kind of note on this record.");
  }
  if (input.noteType === "location_memory" && context.objectType !== "location") {
    throw new ApiError(400, "Location memory can only be created directly on location records.");
  }
}

function assertVisibilityAllowed(auth: AuthUser, context: NoteObjectContext, visibilityScope: OperationalNoteVisibilityScope) {
  if (!allowedVisibilityScopes(auth, context).includes(visibilityScope)) {
    throw new ApiError(403, "That visibility scope isn't available on this note.");
  }
}

export async function listOperationalNotes(client: PoolClient, auth: AuthUser, input: NoteListInput) {
  const context = await loadObjectContext(client, auth, input.objectType, input.objectId);
  if (!canViewOperationalNotes(auth, buildNotePermissionContext(context))) {
    throw new ApiError(403, "Forbidden");
  }
  const rawRows = await loadRawObjectNotes(client, auth.tenantId, input.objectType, input.objectId);
  const visibleRows = rawRows
    .filter((row) => canViewNoteWithVisibility(auth, context, row))
    .map((row) => decorateVisibleNote(auth, context, row));
  const relatedLocationMemory =
    context.locationId && context.objectType !== "location"
      ? await listLocationMemoryRows(client, auth, context.locationId, { limit: 5 })
      : null;

  return {
    object_type: context.objectType,
    object_id: context.objectId,
    object_label: context.objectLabel,
    summary: buildNotesSummary(visibleRows) as NotesSummary,
    capabilities: buildCapabilities(auth, context),
    related_location_memory:
      relatedLocationMemory && relatedLocationMemory.notes.length
        ? {
            location_id: relatedLocationMemory.context.locationId ?? relatedLocationMemory.context.objectId,
            location_label: relatedLocationMemory.context.objectLabel,
            notes: relatedLocationMemory.notes
          }
        : null,
    notes: visibleRows
      .filter((row) => (input.includeArchived ? true : !row.archived_at))
      .filter((row) => matchesSearch(row, input.search))
      .filter((row) => matchesFilter(row, input.filter))
  };
}

export async function createOperationalNote(client: PoolClient, auth: AuthUser, input: CreateNoteInput, meta: RequestMeta) {
  const context = await loadObjectContext(client, auth, input.objectType, input.objectId);
  assertCreateAllowed(auth, context, input);

  const body = normalizeBody(input.body);
  if (!body) {
    throw new ApiError(400, "Note body is required.");
  }

  const visibilityScope = input.visibilityScope ?? defaultVisibilityScope(auth, context, input.noteType);
  assertVisibilityAllowed(auth, context, visibilityScope);
  if (input.pinned && !canPinNotes(auth, context)) {
    throw new ApiError(403, "Only managers and leadership can pin notes.");
  }

  const permanence = derivePermanence(input.noteType);
  const promotedToLocationId = input.noteType === "location_memory" ? context.locationId ?? context.objectId : null;
  const { rows } = await client.query<NoteRow>(
    `
      INSERT INTO operational_note (
        tenant_id, object_type, object_id, note_type, body, author_user_id, permanence_classification,
        visibility_scope, publication_state, source_context, mention_metadata, attachment_refs, pinned, promoted_to_location_id
      )
      VALUES ($1,$2::operational_note_object_type,$3::uuid,$4::operational_note_type,$5,$6,$7::operational_note_permanence,
        $8::operational_note_visibility_scope,'active',$9,$10::jsonb,$11::jsonb,$12,$13)
      RETURNING *
    `,
    [
      auth.tenantId,
      input.objectType,
      input.objectId,
      input.noteType,
      body,
      auth.id,
      permanence,
      visibilityScope,
      input.sourceContext ?? "mission_control",
      JSON.stringify(sanitizeJsonArray(input.mentionMetadata)),
      JSON.stringify(sanitizeJsonArray(input.attachmentRefs)),
      Boolean(input.pinned && canPinNotes(auth, context)),
      promotedToLocationId
    ]
  );
  const created = rows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "note.created",
    entityType: "operational_note",
    entityId: created.id,
    metadata: {
      object_type: input.objectType,
      object_id: input.objectId,
      note_type: input.noteType,
      visibility_scope: visibilityScope,
      source_context: input.sourceContext ?? "mission_control"
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshedRows = await loadRawObjectNotes(client, auth.tenantId, context.objectType, context.objectId);
  const refreshed = refreshedRows.find((row) => row.id === created.id);
  return refreshed ? decorateVisibleNote(auth, context, refreshed) : created;
}

export async function updateOperationalNote(client: PoolClient, auth: AuthUser, noteId: string, input: UpdateNoteInput, meta: RequestMeta) {
  const noteResult = await client.query<{ object_type: OperationalNoteObjectType; object_id: string }>(
    `
      SELECT object_type::text AS object_type, object_id::text AS object_id
      FROM operational_note
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, noteId]
  );
  const noteRef = noteResult.rows[0];
  if (!noteRef) {
    throw new ApiError(404, "Note not found");
  }

  const context = await loadObjectContext(client, auth, noteRef.object_type, noteRef.object_id);
  const rawRows = await loadRawObjectNotes(client, auth.tenantId, context.objectType, context.objectId);
  const existing = rawRows.find((row) => row.id === noteId);
  if (!existing) {
    throw new ApiError(404, "Note not found");
  }
  if (!canEditNote(auth, context, existing)) {
    throw new ApiError(403, "This note can no longer be edited from your role.");
  }

  const nextBody = typeof input.body === "string" ? normalizeBody(input.body) : existing.body;
  const nextPinned = typeof input.pinned === "boolean" ? Boolean(input.pinned) : Boolean(existing.pinned);
  const nextVisibility = input.visibilityScope ?? existing.visibility_scope;

  if (!nextBody) {
    throw new ApiError(400, "Note body is required.");
  }
  if (typeof input.pinned === "boolean" && !canPinNotes(auth, context)) {
    throw new ApiError(403, "Only managers and leadership can change pinned state.");
  }
  if (input.visibilityScope) {
    if (!canManageObject(auth, context)) {
      throw new ApiError(403, "Only managers and leadership can change note visibility.");
    }
    assertVisibilityAllowed(auth, context, input.visibilityScope);
  }

  const beforeValue = {
    body: existing.body,
    pinned: Boolean(existing.pinned),
    visibility_scope: existing.visibility_scope
  };
  const afterValue = {
    body: nextBody,
    pinned: nextPinned,
    visibility_scope: nextVisibility
  };

  await client.query(
    `
      UPDATE operational_note
      SET body = $3,
          pinned = $4,
          visibility_scope = $5::operational_note_visibility_scope,
          edited_at = now(),
          edited_by_user_id = $2,
          updated_at = now(),
          source_context = $6
      WHERE tenant_id = $1
        AND id = $7
    `,
    [auth.tenantId, auth.id, nextBody, nextPinned, nextVisibility, input.sourceContext ?? existing.source_context, noteId]
  );

  await insertRevision(client, auth, noteId, beforeValue, afterValue, input.sourceContext ?? existing.source_context, input.reason ?? null);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "note.updated",
    entityType: "operational_note",
    entityId: noteId,
    metadata: {
      before: beforeValue,
      after: afterValue,
      source_context: input.sourceContext ?? existing.source_context
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshedRows = await loadRawObjectNotes(client, auth.tenantId, context.objectType, context.objectId);
  const refreshed = refreshedRows.find((row) => row.id === noteId);
  return refreshed ? decorateVisibleNote(auth, context, refreshed) : null;
}

export async function archiveOperationalNote(client: PoolClient, auth: AuthUser, noteId: string, input: ArchiveNoteInput, meta: RequestMeta) {
  const noteResult = await client.query<{ object_type: OperationalNoteObjectType; object_id: string }>(
    `
      SELECT object_type::text AS object_type, object_id::text AS object_id
      FROM operational_note
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, noteId]
  );
  const noteRef = noteResult.rows[0];
  if (!noteRef) {
    throw new ApiError(404, "Note not found");
  }
  const context = await loadObjectContext(client, auth, noteRef.object_type, noteRef.object_id);
  if (!canArchiveNote(auth, context)) {
    throw new ApiError(403, "Only managers and leadership can archive notes.");
  }

  const { rowCount } = await client.query(
    `
      UPDATE operational_note
      SET archived_at = now(),
          archived_by_user_id = $2,
          archived_reason = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $4
        AND archived_at IS NULL
    `,
    [auth.tenantId, auth.id, input.reason?.trim() || null, noteId]
  );
  if (!rowCount) {
    throw new ApiError(400, "This note is already archived.");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "note.archived",
    entityType: "operational_note",
    entityId: noteId,
    metadata: {
      object_type: context.objectType,
      object_id: context.objectId,
      reason: input.reason?.trim() || null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return {
    archived: true,
    note_id: noteId
  };
}

export async function promoteOperationalNoteToLocationMemory(
  client: PoolClient,
  auth: AuthUser,
  noteId: string,
  input: PromoteNoteInput,
  meta: RequestMeta
) {
  const noteResult = await client.query<{ object_type: OperationalNoteObjectType; object_id: string }>(
    `
      SELECT object_type::text AS object_type, object_id::text AS object_id
      FROM operational_note
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, noteId]
  );
  const noteRef = noteResult.rows[0];
  if (!noteRef) {
    throw new ApiError(404, "Note not found");
  }

  const sourceContext = await loadObjectContext(client, auth, noteRef.object_type, noteRef.object_id);
  const sourceRows = await loadRawObjectNotes(client, auth.tenantId, sourceContext.objectType, sourceContext.objectId);
  const source = sourceRows.find((row) => row.id === noteId);
  if (!source || source.archived_at) {
    throw new ApiError(404, "Note not found");
  }
  if (!canPromoteToLocationMemory(auth, sourceContext)) {
    throw new ApiError(403, "You can't promote this note into location memory.");
  }

  const targetLocationId = input.targetLocationId ?? sourceContext.locationId;
  if (!targetLocationId) {
    throw new ApiError(400, "Mission Control couldn't find a linked location for this note.");
  }

  const locationContext = await loadLocationContext(client, auth, targetLocationId);
  const canPublishDirectly = canPublishLocationMemory(auth, locationContext);
  const publicationState: OperationalNotePublicationState = canPublishDirectly ? "active" : "proposed";
  const promotedBody = normalizeBody(input.body ?? source.body);
  if (!promotedBody) {
    throw new ApiError(400, "Note body is required.");
  }

  const { rows } = await client.query<NoteRow>(
    `
      INSERT INTO operational_note (
        tenant_id, object_type, object_id, note_type, body, author_user_id, permanence_classification,
        visibility_scope, publication_state, source_context, mention_metadata, attachment_refs, pinned,
        promoted_from_note_id, promoted_to_location_id, promotion_requested_at, promotion_published_at, promotion_reviewed_by_user_id
      )
      VALUES (
        $1,'location',$2::uuid,'location_memory',$3,$4,'persistent_memory',
        'object_viewers',$5::operational_note_publication_state,$6,$7::jsonb,$8::jsonb,$9,
        $10,$11,now(),CASE WHEN $5::operational_note_publication_state = 'active' THEN now() ELSE NULL END,
        CASE WHEN $5::operational_note_publication_state = 'active' THEN $4 ELSE NULL END
      )
      RETURNING *
    `,
    [
      auth.tenantId,
      targetLocationId,
      promotedBody,
      auth.id,
      publicationState,
      input.sourceContext ?? `promoted_from_${source.object_type}`,
      JSON.stringify(sanitizeJsonArray(source.mention_metadata)),
      JSON.stringify(sanitizeJsonArray(source.attachment_refs)),
      Boolean(input.pinned && canPublishDirectly),
      source.id,
      targetLocationId
    ]
  );
  const promoted = rows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: publicationState === "active" ? "note.location_memory.promoted" : "note.location_memory.proposed",
    entityType: "operational_note",
    entityId: promoted.id,
    metadata: {
      source_note_id: source.id,
      source_object_type: source.object_type,
      source_object_id: source.object_id,
      target_location_id: targetLocationId,
      publication_state: publicationState
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshedRows = await loadRawObjectNotes(client, auth.tenantId, "location", targetLocationId);
  const refreshed = refreshedRows.find((row) => row.id === promoted.id);
  return refreshed ? decorateVisibleNote(auth, locationContext, refreshed) : promoted;
}

export async function publishLocationMemoryNote(
  client: PoolClient,
  auth: AuthUser,
  noteId: string,
  input: PublishLocationMemoryInput,
  meta: RequestMeta
) {
  const noteResult = await client.query<{ object_type: OperationalNoteObjectType; object_id: string }>(
    `
      SELECT object_type::text AS object_type, object_id::text AS object_id
      FROM operational_note
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, noteId]
  );
  const noteRef = noteResult.rows[0];
  if (!noteRef) {
    throw new ApiError(404, "Note not found");
  }

  const context = await loadObjectContext(client, auth, noteRef.object_type, noteRef.object_id);
  const rawRows = await loadRawObjectNotes(client, auth.tenantId, context.objectType, context.objectId);
  const existing = rawRows.find((row) => row.id === noteId);
  if (!existing || existing.note_type !== "location_memory") {
    throw new ApiError(400, "Only location memory notes can be published.");
  }
  if (existing.archived_at) {
    throw new ApiError(400, "Archived notes can't be published.");
  }
  if (existing.publication_state === "active") {
    throw new ApiError(400, "This location memory is already active.");
  }
  if (!canPublishLocationMemory(auth, context)) {
    throw new ApiError(403, "Only approved roles can publish location memory.");
  }
  if (typeof input.pinned === "boolean" && !canPinNotes(auth, context)) {
    throw new ApiError(403, "Only managers and leadership can pin location memory.");
  }
  const visibilityScope = input.visibilityScope ?? existing.visibility_scope;
  assertVisibilityAllowed(auth, context, visibilityScope);

  await client.query(
    `
      UPDATE operational_note
      SET publication_state = 'active',
          promotion_published_at = now(),
          promotion_reviewed_by_user_id = $2,
          pinned = $3,
          visibility_scope = $4::operational_note_visibility_scope,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $5
    `,
    [auth.tenantId, auth.id, typeof input.pinned === "boolean" ? input.pinned : existing.pinned, visibilityScope, noteId]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "note.location_memory.published",
    entityType: "operational_note",
    entityId: noteId,
    metadata: {
      reason: input.reason?.trim() || null,
      visibility_scope: visibilityScope
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  const refreshedRows = await loadRawObjectNotes(client, auth.tenantId, context.objectType, context.objectId);
  const refreshed = refreshedRows.find((row) => row.id === noteId);
  return refreshed ? decorateVisibleNote(auth, context, refreshed) : null;
}

export async function getPublicObjectNoteSignals(
  client: PoolClient,
  tenantId: string,
  objectType: OperationalNoteObjectType,
  objectIds: string[]
) {
  if (!objectIds.length) {
    return new Map<string, { note_count: number; pinned_note_count: number; post_shoot_follow_up_count: number; latest_note_preview: string | null }>();
  }

  const { rows } = await client.query<{
    object_id: string;
    note_count: string;
    pinned_note_count: string;
    post_shoot_follow_up_count: string;
    latest_note_preview: string | null;
  }>(
    `
      SELECT
        note.object_id::text,
        COUNT(*)::text AS note_count,
        COUNT(*) FILTER (WHERE note.pinned)::text AS pinned_note_count,
        COUNT(*) FILTER (WHERE note.note_type = 'post_shoot_follow_up')::text AS post_shoot_follow_up_count,
        (
          array_agg(left(note.body, 140) ORDER BY note.pinned DESC, note.created_at DESC)
        )[1] AS latest_note_preview
      FROM operational_note note
      WHERE note.tenant_id = $1
        AND note.object_type = $2::operational_note_object_type
        AND note.object_id = ANY($3::uuid[])
        AND note.archived_at IS NULL
        AND note.publication_state = 'active'
        AND note.visibility_scope IN ('object_viewers', 'assigned_staff_and_managers')
      GROUP BY note.object_id
    `,
    [tenantId, objectType, objectIds]
  );

  return new Map(
    rows.map((row) => [
      row.object_id,
      {
        note_count: Number(row.note_count ?? 0),
        pinned_note_count: Number(row.pinned_note_count ?? 0),
        post_shoot_follow_up_count: Number(row.post_shoot_follow_up_count ?? 0),
        latest_note_preview: row.latest_note_preview ?? null
      }
    ])
  );
}

export async function listLocationMemoryNotesForLocation(
  client: PoolClient,
  auth: AuthUser,
  locationId: string,
  options?: {
    includeArchived?: boolean;
    limit?: number;
  }
) {
  const result = await listLocationMemoryRows(client, auth, locationId, options);
  return {
    location_id: result.context.locationId ?? result.context.objectId,
    location_label: result.context.objectLabel,
    notes: result.notes
  };
}
