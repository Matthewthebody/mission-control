import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { isFieldRole } from "../authz/policy.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  ResourceLibraryApprovalStatus,
  ResourceLibraryBestReferenceCategory,
  ResourceLibraryCategory,
  ResourceLibraryItem,
  ResourceLibraryLearning,
  ResourceLibraryLinkedScope,
  ResourceLibraryRecurringContact,
  ResourceLibraryRecurringLocationIntelligence,
  ResourceLibraryRecurringReminder,
  ResourceLibraryType,
  ResourceLibraryUploadSource,
  ResourceLibraryView,
  ResourceLibraryVisibilityScope
} from "../types/resourceLibrary.js";
import { createAuditLog } from "./audit.js";
import { assertShootAccess } from "./shootAccess.js";

type RawResourceLibraryRow = {
  id: string;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
  uploader_user_id: string | null;
  uploader_name: string | null;
  resource_type: ResourceLibraryType;
  category: ResourceLibraryCategory;
  note: string | null;
  issue_type: string | null;
  approval_status: ResourceLibraryApprovalStatus;
  visibility_scope: ResourceLibraryVisibilityScope;
  best_reference_candidate: boolean;
  is_best_reference: boolean;
  best_reference_category: ResourceLibraryBestReferenceCategory | null;
  file_name: string;
  content_type: string | null;
  file_size_bytes: string | number | null;
  storage_key: string | null;
  file_url: string | null;
  upload_source: ResourceLibraryUploadSource | null;
  gps_lat: number | string | null;
  gps_lng: number | string | null;
  captured_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
};

type ResourceLibraryContext =
  | { kind: "shoot"; shootId: string; organizationId: string | null; locationId: string | null }
  | { kind: "organization"; organizationId: string }
  | { kind: "location"; locationId: string; organizationId: string | null };

type LegacySourceInput = {
  tenantId: string;
  organizationId: string | null;
  locationId: string | null;
  shootId: string | null;
  uploaderUserId: string | null;
  uploaderName: string | null;
  resourceType: ResourceLibraryType;
  category: ResourceLibraryCategory;
  note?: string | null;
  issueType?: string | null;
  approvalStatus: ResourceLibraryApprovalStatus;
  visibilityScope: ResourceLibraryVisibilityScope;
  bestReferenceCandidate?: boolean;
  isBestReference?: boolean;
  bestReferenceCategory?: ResourceLibraryBestReferenceCategory | null;
  fileName: string;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  storageKey?: string | null;
  fileUrl?: string | null;
  uploadSource?: ResourceLibraryUploadSource | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  capturedAt?: string | null;
  sourceRecordType: string;
  sourceRecordId: string;
};

export type ReviewResourceLibraryItemInput = {
  approvalStatus?: ResourceLibraryApprovalStatus;
  visibilityScope?: ResourceLibraryVisibilityScope;
  category?: ResourceLibraryCategory;
  issueType?: string | null;
  note?: string | null;
  bestReferenceCandidate?: boolean;
  isBestReference?: boolean;
  bestReferenceCategory?: ResourceLibraryBestReferenceCategory | null;
  reviewNote?: string | null;
};

type PostShootLearningRow = {
  id: string;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  shoot_id: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  overall_rating: number | string;
  recommendations: string | null;
  notes: string | null;
  access_details: string | null;
  late_details: string | null;
};

export async function getShootResourceLibrary(
  client: PoolClient,
  auth: AuthUser,
  shootId: string
): Promise<ResourceLibraryView> {
  await assertShootAccess(client, auth, shootId);
  const shootResult = await client.query<{ organization_id: string | null; location_id: string | null }>(
    `
      SELECT organization_id, location_id
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shootId]
  );
  const shoot = shootResult.rows[0];
  return listResourceLibraryView(client, auth, {
    kind: "shoot",
    shootId,
    organizationId: shoot?.organization_id ?? null,
    locationId: shoot?.location_id ?? null
  });
}

export async function getOrganizationResourceLibrary(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<ResourceLibraryView> {
  return listResourceLibraryView(client, auth, {
    kind: "organization",
    organizationId
  });
}

export async function getLocationResourceLibrary(
  client: PoolClient,
  auth: AuthUser,
  locationId: string
): Promise<ResourceLibraryView> {
  const locationResult = await client.query<{ organization_id: string | null }>(
    `
      SELECT organization_id
      FROM shoot_location
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, locationId]
  );
  return listResourceLibraryView(client, auth, {
    kind: "location",
    locationId,
    organizationId: locationResult.rows[0]?.organization_id ?? null
  });
}

export async function upsertResourceLibraryItemFromSource(client: PoolClient, input: LegacySourceInput) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO resource_library_item (
        tenant_id,
        organization_id,
        location_id,
        shoot_id,
        uploader_user_id,
        uploader_name,
        resource_type,
        category,
        note,
        issue_type,
        approval_status,
        visibility_scope,
        best_reference_candidate,
        is_best_reference,
        best_reference_category,
        file_name,
        content_type,
        file_size_bytes,
        storage_key,
        file_url,
        upload_source,
        gps_lat,
        gps_lng,
        captured_at,
        source_record_type,
        source_record_id,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7::resource_library_type,$8::resource_library_category,$9,$10,
        $11::resource_library_approval_status,$12::resource_library_visibility_scope,$13,$14,
        $15::resource_library_best_reference_category,$16,$17,$18,$19,$20,
        $21::resource_library_upload_source,$22,$23,$24,$25,$26,now(),now()
      )
      ON CONFLICT (tenant_id, source_record_type, source_record_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        location_id = EXCLUDED.location_id,
        shoot_id = EXCLUDED.shoot_id,
        uploader_user_id = EXCLUDED.uploader_user_id,
        uploader_name = EXCLUDED.uploader_name,
        resource_type = EXCLUDED.resource_type,
        category = EXCLUDED.category,
        note = EXCLUDED.note,
        issue_type = EXCLUDED.issue_type,
        approval_status = EXCLUDED.approval_status,
        visibility_scope = EXCLUDED.visibility_scope,
        best_reference_candidate = EXCLUDED.best_reference_candidate,
        is_best_reference = EXCLUDED.is_best_reference,
        best_reference_category = EXCLUDED.best_reference_category,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        file_size_bytes = EXCLUDED.file_size_bytes,
        storage_key = EXCLUDED.storage_key,
        file_url = EXCLUDED.file_url,
        upload_source = EXCLUDED.upload_source,
        gps_lat = EXCLUDED.gps_lat,
        gps_lng = EXCLUDED.gps_lng,
        captured_at = EXCLUDED.captured_at,
        updated_at = now()
      RETURNING id
    `,
    [
      input.tenantId,
      input.organizationId,
      input.locationId,
      input.shootId,
      input.uploaderUserId,
      input.uploaderName ?? "Mission Control",
      input.resourceType,
      input.category,
      input.note ?? null,
      input.issueType ?? null,
      input.approvalStatus,
      input.visibilityScope,
      Boolean(input.bestReferenceCandidate),
      Boolean(input.isBestReference),
      input.bestReferenceCategory ?? null,
      input.fileName,
      input.contentType ?? null,
      input.fileSizeBytes ?? null,
      input.storageKey ?? null,
      input.fileUrl ?? null,
      input.uploadSource ?? null,
      input.gpsLat ?? null,
      input.gpsLng ?? null,
      input.capturedAt ?? null,
      input.sourceRecordType,
      input.sourceRecordId
    ]
  );
  const itemId = result.rows[0]?.id;
  if (itemId) {
    await syncLegacyResourceLibraryItemLinks(client, {
      tenantId: input.tenantId,
      itemId,
      organizationId: input.organizationId,
      locationId: input.locationId,
      shootId: input.shootId,
      createdByUserId: input.uploaderUserId ?? null
    });
  }
  return itemId ?? null;
}

export async function syncLegacyResourceLibraryItemLinks(
  client: PoolClient,
  input: {
    tenantId: string;
    itemId: string;
    organizationId: string | null;
    locationId: string | null;
    shootId: string | null;
    createdByUserId?: string | null;
  }
) {
  await client.query(
    `
      DELETE FROM resource_library_item_link
      WHERE tenant_id = $1
        AND resource_library_item_id = $2
        AND object_type IN (
          'organization'::resource_record_object_type,
          'location'::resource_record_object_type,
          'shoot'::resource_record_object_type
        )
    `,
    [input.tenantId, input.itemId]
  );

  const links = [
    input.organizationId ? { objectType: "organization", objectId: input.organizationId } : null,
    input.locationId ? { objectType: "location", objectId: input.locationId } : null,
    input.shootId ? { objectType: "shoot", objectId: input.shootId } : null
  ].filter((value): value is { objectType: "organization" | "location" | "shoot"; objectId: string } => Boolean(value));

  for (const link of links) {
    await client.query(
      `
        INSERT INTO resource_library_item_link (
          tenant_id,
          resource_library_item_id,
          object_type,
          object_id,
          created_by_user_id
        )
        VALUES ($1,$2,$3::resource_record_object_type,$4,$5)
        ON CONFLICT (tenant_id, resource_library_item_id, object_type, object_id)
        DO NOTHING
      `,
      [input.tenantId, input.itemId, link.objectType, link.objectId, input.createdByUserId ?? null]
    );
  }
}

export async function loadShootDirectoryContext(
  client: PoolClient,
  tenantId: string,
  shootId: string
): Promise<{ organizationId: string | null; locationId: string | null } | null> {
  const result = await client.query<{ organization_id: string | null; location_id: string | null }>(
    `
      SELECT organization_id, location_id
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId]
  );
  if (!result.rows[0]) {
    return null;
  }
  return {
    organizationId: result.rows[0].organization_id,
    locationId: result.rows[0].location_id
  };
}

export function inferResourceTypeFromFile(input: {
  fileName?: string | null;
  contentType?: string | null;
  storageKey?: string | null;
  url?: string | null;
}): ResourceLibraryType {
  const normalizedContentType = input.contentType?.trim().toLowerCase() ?? "";
  const candidate = `${input.fileName ?? ""} ${input.storageKey ?? ""} ${input.url ?? ""}`.toLowerCase();
  if (normalizedContentType.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(candidate)) {
    return "video";
  }
  if (normalizedContentType === "application/pdf" || /\.pdf$/.test(candidate)) {
    return candidate.includes("qr") ? "qr_code" : "document";
  }
  return "image";
}

export function canManageResourceLibrary(auth: AuthUser) {
  return !isFieldRole(auth) && hasAuthorityTier(auth, ["director_admin", "leadership", "super_admin"]) && auth.permissions.includes("shoot.update");
}

export function canDownloadResourceLibrary(auth: AuthUser) {
  return !isFieldRole(auth);
}

function getDefaultUploadApprovalStatus(auth: AuthUser): ResourceLibraryApprovalStatus {
  return isFieldRole(auth) ? "pending_review" : "approved";
}

function getDefaultUploadVisibility(_auth: AuthUser): ResourceLibraryVisibilityScope {
  return "photographer_prep";
}

export function buildLegacyMediaResourceDefaults(auth: AuthUser, input: {
  kind?: string | null;
  category?: ResourceLibraryCategory | null;
  resourceType: ResourceLibraryType;
  approvalStatus?: ResourceLibraryApprovalStatus | null;
  visibilityScope?: ResourceLibraryVisibilityScope | null;
  isBestReference?: boolean | null;
}) {
  if (isFieldRole(auth)) {
    return {
      category: "setup_photo" as ResourceLibraryCategory,
      approvalStatus: getDefaultUploadApprovalStatus(auth),
      visibilityScope: getDefaultUploadVisibility(auth),
      isBestReference: false
    };
  }

  const defaultCategory = mapLegacyKindToCategory(input.kind, input.resourceType);
  return {
    category: input.category ?? defaultCategory,
    approvalStatus: input.approvalStatus ?? getDefaultUploadApprovalStatus(auth),
    visibilityScope: input.visibilityScope ?? getDefaultUploadVisibility(auth),
    isBestReference: Boolean(input.isBestReference)
  };
}

export async function reviewResourceLibraryItem(
  client: PoolClient,
  auth: AuthUser,
  itemId: string,
  input: ReviewResourceLibraryItemInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  if (!canManageResourceLibrary(auth)) {
    throw new ApiError(403, "Only leadership can manage the Resource Library review workflow");
  }

  const current = await loadResourceLibraryItemById(client, auth.tenantId, itemId);
  if (!current) {
    throw new ApiError(404, "Resource Library item not found");
  }

  let approvalStatus = input.approvalStatus ?? current.approval_status;
  let visibilityScope = input.visibilityScope ?? current.visibility_scope;
  let isBestReference = input.isBestReference ?? current.is_best_reference;
  let bestReferenceCategory = input.bestReferenceCategory ?? current.best_reference_category;
  const bestReferenceCandidate = input.bestReferenceCandidate ?? current.best_reference_candidate;

  if (approvalStatus === "rejected_not_useful") {
    visibilityScope = "leadership_only";
    isBestReference = false;
    bestReferenceCategory = null;
  }

  if (isBestReference) {
    if (current.resource_type !== "image") {
      throw new ApiError(400, "Only image resources can be promoted to Best Reference");
    }
    if (!bestReferenceCategory) {
      throw new ApiError(400, "Choose a Best Reference category before promoting this item");
    }
    approvalStatus = "approved";
    visibilityScope = "photographer_prep";
    await assertBestReferenceCapacity(client, auth.tenantId, current, bestReferenceCategory, current.id);
  } else {
    bestReferenceCategory = null;
  }

  const category = input.category ?? current.category;
  const note = input.note !== undefined ? input.note : current.note;
  const issueType = input.issueType !== undefined ? input.issueType : current.issue_type;
  const reviewNote = input.reviewNote !== undefined ? input.reviewNote : current.review_note;

  await client.query(
    `
      UPDATE resource_library_item
      SET
        category = $3::resource_library_category,
        note = $4,
        issue_type = $5,
        approval_status = $6::resource_library_approval_status,
        visibility_scope = $7::resource_library_visibility_scope,
        best_reference_candidate = $8,
        is_best_reference = $9,
        best_reference_category = $10::resource_library_best_reference_category,
        review_note = $11,
        reviewed_by_user_id = $12,
        reviewed_at = now(),
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      itemId,
      category,
      note ?? null,
      issueType ?? null,
      approvalStatus,
      visibilityScope,
      Boolean(bestReferenceCandidate),
      Boolean(isBestReference),
      bestReferenceCategory ?? null,
      reviewNote ?? null,
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "resource_library.item.reviewed",
    entityType: "resource_library_item",
    entityId: itemId,
    metadata: {
      approval_status: approvalStatus,
      visibility_scope: visibilityScope,
      best_reference_candidate: bestReferenceCandidate,
      is_best_reference: isBestReference,
      best_reference_category: bestReferenceCategory,
      category,
      issue_type: issueType ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return loadResourceLibraryItemById(client, auth.tenantId, itemId);
}

async function listResourceLibraryView(
  client: PoolClient,
  auth: AuthUser,
  context: ResourceLibraryContext
): Promise<ResourceLibraryView> {
  const access = {
    can_manage: canManageResourceLibrary(auth),
    can_download: canDownloadResourceLibrary(auth),
    limited_view: isFieldRole(auth),
    historical_window_years: isFieldRole(auth) ? 2 : null
  };

  const rawItems = await loadResourceLibraryItems(client, auth.tenantId, context);
  const items = applyResourceVisibilityRules(rawItems, access, context);
  const learnings = applyLearningVisibilityRules(await loadPostShootLearnings(client, auth.tenantId, context), access);
  const contacts = await loadRecurringContacts(client, auth.tenantId, getContextOrganizationId(context));

  const documents = items.filter((item) => isDocumentResource(item));
  const historicalReferences = items.filter((item) => isHistoricalReference(item));
  const media = items.filter((item) => !documents.includes(item) && !historicalReferences.includes(item));
  const prepHighlights = buildPrepHighlights(items);
  const reviewQueue = access.can_manage ? buildReviewQueue(rawItems) : [];

  return {
    access,
    summary: {
      total_items: items.length,
      media_count: media.length,
      document_count: documents.length,
      best_reference_count: items.filter((item) => item.is_best_reference).length,
      pending_review_count: items.filter((item) => item.approval_status === "pending_review").length,
      leadership_only_count: items.filter((item) => item.approval_status === "leadership_only").length,
      rejected_count: items.filter((item) => item.approval_status === "rejected_not_useful").length,
      prep_highlight_count: prepHighlights.length
    },
    review_queue: reviewQueue,
    prep_highlights: prepHighlights,
    media,
    documents,
    historical_references: historicalReferences,
    post_shoot_learnings: learnings,
    recurring_location_intelligence: buildRecurringLocationIntelligence(items, learnings, contacts, access)
  };
}

async function loadResourceLibraryItems(client: PoolClient, tenantId: string, context: ResourceLibraryContext) {
  const params: Array<string | null> = [tenantId];
  let whereClause = "FALSE";
  if (context.kind === "shoot") {
    params.push(context.shootId, context.locationId ?? null, context.organizationId ?? null);
    whereClause = "(r.shoot_id = $2 OR ($3::uuid IS NOT NULL AND r.location_id = $3) OR ($4::uuid IS NOT NULL AND r.organization_id = $4))";
  } else if (context.kind === "organization") {
    params.push(context.organizationId);
    whereClause = "r.organization_id = $2";
  } else {
    params.push(context.locationId);
    whereClause = "r.location_id = $2";
  }

  const result = await client.query<RawResourceLibraryRow>(
    `
      SELECT
        r.id,
        r.organization_id,
        o.display_name AS organization_display_name,
        r.location_id,
        sl.name AS location_name,
        r.shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        s.shoot_date::text AS shoot_date,
        r.uploader_user_id,
        COALESCE(r.uploader_name, au.full_name) AS uploader_name,
        r.resource_type::text AS resource_type,
        r.category::text AS category,
        r.note,
        r.issue_type,
        r.approval_status::text AS approval_status,
        r.visibility_scope::text AS visibility_scope,
        r.best_reference_candidate,
        r.is_best_reference,
        r.best_reference_category::text AS best_reference_category,
        r.file_name,
        r.content_type,
        r.file_size_bytes,
        r.storage_key,
        r.file_url,
        r.upload_source::text AS upload_source,
        r.gps_lat,
        r.gps_lng,
        r.captured_at::text,
        r.created_at::text,
        r.reviewed_at::text,
        r.reviewed_by_user_id,
        reviewer.full_name AS reviewed_by_name,
        r.review_note
      FROM resource_library_item r
      LEFT JOIN organization o
        ON o.tenant_id = r.tenant_id
       AND o.id = r.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = r.tenant_id
       AND sl.id = r.location_id
      LEFT JOIN shoot s
        ON s.tenant_id = r.tenant_id
       AND s.id = r.shoot_id
      LEFT JOIN app_user au
        ON au.tenant_id = r.tenant_id
       AND au.id = r.uploader_user_id
      LEFT JOIN app_user reviewer
        ON reviewer.tenant_id = r.tenant_id
       AND reviewer.id = r.reviewed_by_user_id
      WHERE r.tenant_id = $1
        AND ${whereClause}
      ORDER BY
        CASE WHEN r.approval_status = 'pending_review' THEN 0 ELSE 1 END,
        CASE WHEN r.is_best_reference THEN 0 ELSE 1 END,
        COALESCE(r.captured_at, r.created_at) DESC,
        r.file_name ASC
    `,
    params
  );

  return result.rows.map((row) => mapRawResourceLibraryRow(context, row));
}

async function loadResourceLibraryItemById(client: PoolClient, tenantId: string, itemId: string) {
  const result = await client.query<RawResourceLibraryRow>(
    `
      SELECT
        r.id,
        r.organization_id,
        o.display_name AS organization_display_name,
        r.location_id,
        sl.name AS location_name,
        r.shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        s.shoot_date::text AS shoot_date,
        r.uploader_user_id,
        COALESCE(r.uploader_name, au.full_name) AS uploader_name,
        r.resource_type::text AS resource_type,
        r.category::text AS category,
        r.note,
        r.issue_type,
        r.approval_status::text AS approval_status,
        r.visibility_scope::text AS visibility_scope,
        r.best_reference_candidate,
        r.is_best_reference,
        r.best_reference_category::text AS best_reference_category,
        r.file_name,
        r.content_type,
        r.file_size_bytes,
        r.storage_key,
        r.file_url,
        r.upload_source::text AS upload_source,
        r.gps_lat,
        r.gps_lng,
        r.captured_at::text,
        r.created_at::text,
        r.reviewed_at::text,
        r.reviewed_by_user_id,
        reviewer.full_name AS reviewed_by_name,
        r.review_note
      FROM resource_library_item r
      LEFT JOIN organization o
        ON o.tenant_id = r.tenant_id
       AND o.id = r.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = r.tenant_id
       AND sl.id = r.location_id
      LEFT JOIN shoot s
        ON s.tenant_id = r.tenant_id
       AND s.id = r.shoot_id
      LEFT JOIN app_user au
        ON au.tenant_id = r.tenant_id
       AND au.id = r.uploader_user_id
      LEFT JOIN app_user reviewer
        ON reviewer.tenant_id = r.tenant_id
       AND reviewer.id = r.reviewed_by_user_id
      WHERE r.tenant_id = $1
        AND r.id = $2
      LIMIT 1
    `,
    [tenantId, itemId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapRawResourceLibraryRow(inferContextFromRow(row), row);
}

async function loadPostShootLearnings(client: PoolClient, tenantId: string, context: ResourceLibraryContext) {
  const params: Array<string | null> = [tenantId];
  let whereClause = "FALSE";
  if (context.kind === "shoot") {
    params.push(context.shootId, context.locationId ?? null, context.organizationId ?? null);
    whereClause =
      "(p.shoot_id = $2 OR ($3::uuid IS NOT NULL AND p.location_id = $3) OR ($4::uuid IS NOT NULL AND p.organization_id = $4))";
  } else if (context.kind === "organization") {
    params.push(context.organizationId);
    whereClause = "p.organization_id = $2";
  } else {
    params.push(context.locationId);
    whereClause = "p.location_id = $2";
  }

  const result = await client.query<PostShootLearningRow>(
    `
      SELECT
        p.id,
        p.organization_id,
        o.display_name AS organization_display_name,
        p.location_id,
        sl.name AS location_name,
        p.shoot_id,
        p.shoot_name,
        p.shoot_date::text AS shoot_date,
        p.photographer_name,
        p.overall_rating,
        COALESCE(p.remember_next_time, p.recommendations) AS recommendations,
        COALESCE(p.open_comment, p.notes) AS notes,
        p.access_details,
        p.late_details
      FROM post_shoot_evaluation p
      LEFT JOIN organization o
        ON o.tenant_id = p.tenant_id
       AND o.id = p.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = p.tenant_id
       AND sl.id = p.location_id
      WHERE p.tenant_id = $1
        AND ${whereClause}
      ORDER BY p.shoot_date DESC, p.created_at DESC
      LIMIT 18
    `,
    params
  );

  return result.rows.map((row): ResourceLibraryLearning => ({
    id: row.id,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    location_id: row.location_id,
    location_name: row.location_name,
    shoot_id: row.shoot_id,
    shoot_name: row.shoot_name,
    shoot_date: row.shoot_date,
    photographer_name: row.photographer_name,
    overall_rating: Number(row.overall_rating ?? 0),
    recommendations: row.recommendations ?? null,
    notes: row.notes ?? null,
    access_details: row.access_details ?? null,
    late_details: row.late_details ?? null
  }));
}

async function loadRecurringContacts(client: PoolClient, tenantId: string, organizationId: string | null) {
  if (!organizationId) {
    return [] as ResourceLibraryRecurringContact[];
  }

  const result = await client.query<{
    id: string;
    full_name: string;
    title: string | null;
    phone: string | null;
    email: string | null;
  }>(
    `
      SELECT id, full_name, title, phone, email
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND active_status = 'active'
      ORDER BY lower(last_name), lower(first_name)
      LIMIT 8
    `,
    [tenantId, organizationId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    full_name: row.full_name,
    title: row.title,
    phone: row.phone,
    email: row.email
  }));
}

function applyResourceVisibilityRules(
  items: ResourceLibraryItem[],
  access: ResourceLibraryView["access"],
  _context: ResourceLibraryContext
) {
  if (!access.limited_view) {
    return items;
  }

  return items
    .filter((item) => {
      if (item.approval_status !== "approved") {
        return false;
      }
      if (item.visibility_scope !== "photographer_prep") {
        return false;
      }
      if (item.is_best_reference) {
        return true;
      }
      return isWithinHistoricalWindow(item.captured_at ?? item.shoot_date ?? item.created_at, access.historical_window_years ?? 2);
    })
    .map((item) => ({
      ...item,
      download_url: null
    }));
}

function applyLearningVisibilityRules(learnings: ResourceLibraryLearning[], access: ResourceLibraryView["access"]) {
  if (!access.limited_view) {
    return learnings;
  }
  return learnings.filter((learning) => isWithinHistoricalWindow(learning.shoot_date, access.historical_window_years ?? 2));
}

function buildReviewQueue(items: ResourceLibraryItem[]) {
  return items
    .filter((item) => item.approval_status === "pending_review" || item.best_reference_candidate)
    .sort((left, right) => {
      const leftRank = left.approval_status === "pending_review" ? 0 : 1;
      const rightRank = right.approval_status === "pending_review" ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
}

function buildPrepHighlights(items: ResourceLibraryItem[]) {
  return items
    .filter((item) => item.approval_status !== "rejected_not_useful")
    .sort((left, right) => {
      const leftScore = getPrepHighlightScore(left);
      const rightScore = getPrepHighlightScore(right);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return new Date(right.captured_at ?? right.created_at).getTime() - new Date(left.captured_at ?? left.created_at).getTime();
    })
    .slice(0, 8);
}

function buildRecurringLocationIntelligence(
  items: ResourceLibraryItem[],
  learnings: ResourceLibraryLearning[],
  contacts: ResourceLibraryRecurringContact[],
  access: ResourceLibraryView["access"]
): ResourceLibraryRecurringLocationIntelligence {
  const curatedItems = items.filter((item) => item.approval_status !== "rejected_not_useful");
  const twoYears = access.historical_window_years ?? 2;
  const setupPhotos = curatedItems.filter(
    (item) =>
      item.category === "setup_photo" && isWithinHistoricalWindow(item.captured_at ?? item.shoot_date ?? item.created_at, twoYears)
  );
  const priorSuccessfulExamples = curatedItems.filter((item) =>
    ["prior_successful_example", "product_example", "location_reference"].includes(item.category)
  );
  const documents = curatedItems.filter((item) => isDocumentResource(item));
  const watchouts = curatedItems.filter((item) => ["issue_concern", "equipment_setup_need"].includes(item.category));
  const reminders = buildRecurringReminders(curatedItems, learnings);

  return {
    best_reference: curatedItems.filter((item) => item.is_best_reference).slice(0, 6),
    setup_photos_last_two_years: setupPhotos.slice(0, 8),
    prior_successful_examples: priorSuccessfulExamples.slice(0, 8),
    documents_and_qr: documents.slice(0, 6),
    issue_watchouts: watchouts.slice(0, 6),
    recent_post_shoot_evaluations: learnings.slice(0, 6),
    recurring_contacts: contacts.slice(0, 6),
    reminders
  };
}

function buildRecurringReminders(items: ResourceLibraryItem[], learnings: ResourceLibraryLearning[]) {
  const reminders: ResourceLibraryRecurringReminder[] = [];
  for (const item of items) {
    if (!["issue_concern", "equipment_setup_need"].includes(item.category)) {
      continue;
    }
    reminders.push({
      id: `resource:${item.id}`,
      source: "resource_library",
      label: item.category === "issue_concern" ? "Issue to remember" : "Equipment / setup reminder",
      detail: item.note ?? item.file_name,
      created_at: item.captured_at ?? item.created_at,
      shoot_name: item.shoot_title,
      shoot_date: item.shoot_date
    });
  }
  for (const learning of learnings) {
    const detail = learning.recommendations ?? learning.notes ?? learning.access_details ?? learning.late_details;
    if (!detail) {
      continue;
    }
    reminders.push({
      id: `evaluation:${learning.id}`,
      source: "post_shoot_evaluation",
      label: "Remember next time",
      detail,
      created_at: learning.shoot_date,
      shoot_name: learning.shoot_name,
      shoot_date: learning.shoot_date
    });
  }

  const deduped = new Map<string, ResourceLibraryRecurringReminder>();
  for (const reminder of reminders) {
    const key = `${reminder.label}:${reminder.detail.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, reminder);
    }
  }
  return [...deduped.values()]
    .sort((left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime())
    .slice(0, 8);
}

function isDocumentResource(item: ResourceLibraryItem) {
  return item.resource_type === "document" || item.resource_type === "qr_code";
}

function isHistoricalReference(item: ResourceLibraryItem) {
  return item.is_best_reference || ["location_reference", "prior_successful_example", "product_example"].includes(item.category);
}

function mapRawResourceLibraryRow(context: ResourceLibraryContext, row: RawResourceLibraryRow): ResourceLibraryItem {
  return {
    id: row.id,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    location_id: row.location_id,
    location_name: row.location_name,
    shoot_id: row.shoot_id,
    shoot_code: row.shoot_code,
    shoot_title: row.shoot_title,
    shoot_date: row.shoot_date,
    uploader_user_id: row.uploader_user_id,
    uploader_name: row.uploader_name,
    resource_type: row.resource_type,
    category: row.category,
    note: row.note,
    issue_type: row.issue_type,
    approval_status: row.approval_status,
    visibility_scope: row.visibility_scope,
    best_reference_candidate: Boolean(row.best_reference_candidate),
    is_best_reference: Boolean(row.is_best_reference),
    best_reference_category: row.best_reference_category,
    file_name: row.file_name,
    content_type: row.content_type,
    file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    storage_key: row.storage_key,
    preview_url: row.file_url,
    download_url: row.file_url,
    upload_source: row.upload_source,
    gps_lat: row.gps_lat === null ? null : Number(row.gps_lat),
    gps_lng: row.gps_lng === null ? null : Number(row.gps_lng),
    captured_at: row.captured_at,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    reviewed_by_user_id: row.reviewed_by_user_id,
    reviewed_by_name: row.reviewed_by_name,
    review_note: row.review_note,
    linked_scope: inferLinkedScope(context, row)
  };
}

function inferLinkedScope(context: ResourceLibraryContext, row: RawResourceLibraryRow): ResourceLibraryLinkedScope {
  if (context.kind === "shoot") {
    if (row.shoot_id && row.shoot_id === context.shootId) {
      return "shoot";
    }
    if (row.location_id && row.location_id === context.locationId) {
      return "location";
    }
    return "organization";
  }
  if (context.kind === "location") {
    return row.location_id ? "location" : "organization";
  }
  if (row.location_id) {
    return "location";
  }
  if (row.shoot_id) {
    return "shoot";
  }
  return "organization";
}

function inferContextFromRow(row: RawResourceLibraryRow): ResourceLibraryContext {
  if (row.shoot_id) {
    return {
      kind: "shoot",
      shootId: row.shoot_id,
      organizationId: row.organization_id,
      locationId: row.location_id
    };
  }
  if (row.location_id) {
    return {
      kind: "location",
      locationId: row.location_id,
      organizationId: row.organization_id
    };
  }
  return {
    kind: "organization",
    organizationId: String(row.organization_id)
  };
}

function mapLegacyKindToCategory(kind: string | null | undefined, resourceType: ResourceLibraryType): ResourceLibraryCategory {
  const normalized = (kind ?? "").trim().toLowerCase();
  if (normalized === "setup_photo") {
    return "setup_photo";
  }
  if (normalized.includes("location")) {
    return "location_reference";
  }
  if (normalized.includes("product") || normalized.includes("poster")) {
    return "product_example";
  }
  if (normalized.includes("issue") || normalized.includes("concern")) {
    return "issue_concern";
  }
  if (normalized.includes("equipment") || normalized.includes("setup_need")) {
    return "equipment_setup_need";
  }
  if (normalized.includes("qr") || normalized.includes("document")) {
    return "qr_code_job_document";
  }
  if (normalized.includes("successful") || normalized.includes("reference")) {
    return "prior_successful_example";
  }
  return resourceType === "document" || resourceType === "qr_code" ? "qr_code_job_document" : "misc_internal_reference";
}

function getContextOrganizationId(context: ResourceLibraryContext) {
  if (context.kind === "organization") {
    return context.organizationId;
  }
  return context.organizationId ?? null;
}

async function assertBestReferenceCapacity(
  client: PoolClient,
  tenantId: string,
  item: Pick<ResourceLibraryItem, "organization_id" | "location_id" | "shoot_id">,
  category: ResourceLibraryBestReferenceCategory,
  excludingItemId?: string | null
) {
  const column = item.location_id ? "location_id" : item.organization_id ? "organization_id" : item.shoot_id ? "shoot_id" : null;
  const scopeId = item.location_id ?? item.organization_id ?? item.shoot_id ?? null;
  if (!column || !scopeId) {
    return;
  }

  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM resource_library_item
      WHERE tenant_id = $1
        AND ${column} = $2
        AND is_best_reference = true
        AND best_reference_category = $3::resource_library_best_reference_category
        AND ($4::uuid IS NULL OR id <> $4)
    `,
    [tenantId, scopeId, category, excludingItemId ?? null]
  );

  if (Number(result.rows[0]?.count ?? 0) >= 3) {
    throw new ApiError(409, "This Best Reference category already has 3 curated items for the current prep scope");
  }
}

function getPrepHighlightScore(item: ResourceLibraryItem) {
  if (item.is_best_reference) {
    return 100;
  }
  if (item.category === "setup_photo") {
    return 80;
  }
  if (item.category === "prior_successful_example") {
    return 70;
  }
  if (item.category === "location_reference") {
    return 60;
  }
  if (item.category === "product_example") {
    return 55;
  }
  if (item.category === "qr_code_job_document") {
    return 50;
  }
  if (item.category === "equipment_setup_need") {
    return 40;
  }
  if (item.category === "issue_concern") {
    return 35;
  }
  return 20;
}

function isWithinHistoricalWindow(value: string | null, years: number) {
  if (!value) {
    return false;
  }
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  const windowMs = years * 365 * 24 * 60 * 60 * 1000;
  return Date.now() - timestamp <= windowMs;
}
