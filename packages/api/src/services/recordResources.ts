import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  CreateRecordResourceInput,
  RecordResourceItem,
  RecordResourceObjectType,
  RecordResourcesResponse
} from "../types/recordResources.js";
import type { ResourceLibraryCategory, ResourceLibraryType } from "../types/resourceLibrary.js";
import { createAuditLog } from "./audit.js";
import { assertManagedUploadStorageKey } from "./s3.js";
import { inferResourceTypeFromFile } from "./resourceLibrary.js";
import { canEditRecords, canViewRecords } from "./policy/operationalAuthorization.js";

type RecordAccessContext = {
  objectType: RecordResourceObjectType;
  objectId: string;
  label: string;
  canView: boolean;
  canManage: boolean;
  organizationId: string | null;
  locationId: string | null;
};

type ResourceRow = {
  id: string;
  file_name: string;
  resource_type: ResourceLibraryType;
  category: ResourceLibraryCategory;
  reference_kind: "uploaded_file" | "external_link";
  external_provider: "internal_upload" | "direct_url" | "sharepoint" | "onedrive" | null;
  note: string | null;
  content_type: string | null;
  file_size_bytes: number | string | null;
  storage_key: string | null;
  file_url: string | null;
  uploader_user_id: string | null;
  uploader_name: string | null;
  created_at: string;
  source_record_type: string | null;
};

type ResourceLinkRow = {
  resource_library_item_id: string;
  object_type: "organization" | "location" | "shoot" | "job" | "production_item";
  object_id: string;
};

export async function listRecordResources(
  client: PoolClient,
  auth: AuthUser,
  objectType: RecordResourceObjectType,
  objectId: string
): Promise<RecordResourcesResponse> {
  const access = await resolveRecordAccess(client, auth, objectType, objectId);
  if (!access.canView) {
    throw new ApiError(403, "Forbidden");
  }

  const resourceRows = await client.query<ResourceRow>(
    `
      SELECT
        r.id::text AS id,
        r.file_name,
        r.resource_type::text AS resource_type,
        r.category::text AS category,
        r.reference_kind::text AS reference_kind,
        r.external_provider::text AS external_provider,
        r.note,
        r.content_type,
        r.file_size_bytes,
        r.storage_key,
        r.file_url,
        r.uploader_user_id::text AS uploader_user_id,
        COALESCE(r.uploader_name, uploader.full_name) AS uploader_name,
        r.created_at::text AS created_at,
        r.source_record_type
      FROM resource_library_item_link link
      JOIN resource_library_item r
        ON r.tenant_id = link.tenant_id
       AND r.id = link.resource_library_item_id
      LEFT JOIN app_user uploader
        ON uploader.tenant_id = r.tenant_id
       AND uploader.id = r.uploader_user_id
      WHERE link.tenant_id = $1
        AND link.object_type = $2::resource_record_object_type
        AND link.object_id = $3::uuid
      ORDER BY r.created_at DESC, r.file_name ASC
    `,
    [auth.tenantId, objectType, objectId]
  );

  const itemIds = resourceRows.rows.map((row) => row.id);
  const linkedObjects = itemIds.length
    ? await client.query<ResourceLinkRow>(
        `
          SELECT
            resource_library_item_id::text AS resource_library_item_id,
            object_type::text AS object_type,
            object_id::text AS object_id
          FROM resource_library_item_link
          WHERE tenant_id = $1
            AND resource_library_item_id = ANY($2::uuid[])
          ORDER BY created_at ASC
        `,
        [auth.tenantId, itemIds]
      )
    : { rows: [] as ResourceLinkRow[] };

  const linksByItem = new Map<string, ResourceLinkRow[]>();
  for (const row of linkedObjects.rows) {
    const current = linksByItem.get(row.resource_library_item_id) ?? [];
    current.push(row);
    linksByItem.set(row.resource_library_item_id, current);
  }

  const items: RecordResourceItem[] = resourceRows.rows.map((row) => ({
    id: row.id,
    title: row.file_name,
    resource_type: row.resource_type,
    category: row.category,
    reference_kind: row.reference_kind,
    provider: row.external_provider,
    description: row.note,
    file_name: row.file_name,
    content_type: row.content_type,
    file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    url: row.file_url,
    uploaded_by_user_id: row.uploader_user_id,
    uploaded_by_name: row.uploader_name,
    created_at: row.created_at,
    can_remove: access.canManage && row.source_record_type === "record_resource_item",
    linked_objects: (linksByItem.get(row.id) ?? []).map((link) => ({
      object_type: link.object_type,
      object_id: link.object_id
    }))
  }));

  return {
    object: {
      object_type: access.objectType,
      object_id: access.objectId,
      label: access.label
    },
    access: {
      can_view: access.canView,
      can_manage: access.canManage
    },
    summary: {
      total_items: items.length,
      uploaded_file_count: items.filter((item) => item.reference_kind === "uploaded_file").length,
      external_link_count: items.filter((item) => item.reference_kind === "external_link").length
    },
    items
  };
}

export async function createRecordResource(
  client: PoolClient,
  auth: AuthUser,
  objectType: RecordResourceObjectType,
  objectId: string,
  input: CreateRecordResourceInput
): Promise<RecordResourceItem> {
  const access = await resolveRecordAccess(client, auth, objectType, objectId);
  if (!access.canManage) {
    throw new ApiError(403, "Forbidden");
  }

  const title = input.title.trim();
  if (!title) {
    throw new ApiError(400, "A title is required.");
  }

  const url = input.url.trim();
  if (!url) {
    throw new ApiError(400, "A file or link URL is required.");
  }

  const description = normalizeNullableText(input.description);
  const storageKey = normalizeNullableText(input.storage_key);
  const contentType = normalizeNullableText(input.content_type);
  const fileSizeBytes = typeof input.file_size_bytes === "number" ? input.file_size_bytes : null;

  let referenceKind: "uploaded_file" | "external_link" = "external_link";
  let provider: "internal_upload" | "direct_url" | "sharepoint" | "onedrive" | null = null;
  if (storageKey) {
    assertManagedUploadStorageKey(auth.tenantId, storageKey);
    referenceKind = "uploaded_file";
    provider = "internal_upload";
  } else {
    referenceKind = "external_link";
    provider = input.provider ?? inferExternalProvider(url);
  }

  const resourceType = inferResourceType({
    title,
    category: input.category,
    contentType,
    storageKey,
    url
  });
  const sourceRecordId = randomUUID();

  const insertResult = await client.query<{ id: string; created_at: string }>(
    `
      INSERT INTO resource_library_item (
        tenant_id,
        organization_id,
        location_id,
        uploader_user_id,
        uploader_name,
        resource_type,
        category,
        note,
        approval_status,
        visibility_scope,
        file_name,
        content_type,
        file_size_bytes,
        storage_key,
        file_url,
        source_record_type,
        source_record_id,
        reference_kind,
        external_provider,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6::resource_library_type,$7::resource_library_category,$8,
        'approved'::resource_library_approval_status,
        'photographer_prep'::resource_library_visibility_scope,
        $9,$10,$11,$12,$13,$14,$15::uuid,$16::resource_reference_kind,$17::resource_external_provider,
        now(),now()
      )
      RETURNING id::text AS id, created_at::text AS created_at
    `,
    [
      auth.tenantId,
      objectType === "organization" ? objectId : null,
      objectType === "location" ? objectId : null,
      auth.id,
      auth.fullName,
      resourceType,
      input.category,
      description,
      title,
      contentType,
      fileSizeBytes,
      storageKey,
      url,
      "record_resource_item",
      sourceRecordId,
      referenceKind,
      provider
    ]
  );

  const itemId = insertResult.rows[0]?.id;
  if (!itemId) {
    throw new ApiError(500, "We couldn't create that resource right now.");
  }

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
    `,
    [auth.tenantId, itemId, objectType, objectId, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "record_resource.created",
    entityType: "resource_library_item",
    entityId: itemId,
    metadata: {
      object_type: objectType,
      object_id: objectId,
      title,
      category: input.category,
      reference_kind: referenceKind,
      provider
    }
  });

  const response = await listRecordResources(client, auth, objectType, objectId);
  const created = response.items.find((item) => item.id === itemId);
  if (!created) {
    throw new ApiError(500, "We couldn't load the created resource.");
  }
  return created;
}

export async function unlinkRecordResource(
  client: PoolClient,
  auth: AuthUser,
  objectType: RecordResourceObjectType,
  objectId: string,
  resourceId: string
) {
  const access = await resolveRecordAccess(client, auth, objectType, objectId);
  if (!access.canManage) {
    throw new ApiError(403, "Forbidden");
  }

  const itemResult = await client.query<{
    id: string;
    file_name: string;
    source_record_type: string | null;
  }>(
    `
      SELECT r.id::text AS id, r.file_name, r.source_record_type
      FROM resource_library_item r
      JOIN resource_library_item_link link
        ON link.tenant_id = r.tenant_id
       AND link.resource_library_item_id = r.id
      WHERE r.tenant_id = $1
        AND r.id = $2::uuid
        AND link.object_type = $3::resource_record_object_type
        AND link.object_id = $4::uuid
      LIMIT 1
    `,
    [auth.tenantId, resourceId, objectType, objectId]
  );
  const item = itemResult.rows[0] ?? null;
  if (!item) {
    throw new ApiError(404, "Resource not found");
  }
  if (item.source_record_type !== "record_resource_item") {
    throw new ApiError(400, "Legacy resources must be managed from their original workflow.");
  }

  await client.query(
    `
      DELETE FROM resource_library_item_link
      WHERE tenant_id = $1
        AND resource_library_item_id = $2::uuid
        AND object_type = $3::resource_record_object_type
        AND object_id = $4::uuid
    `,
    [auth.tenantId, resourceId, objectType, objectId]
  );

  const remainingResult = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM resource_library_item_link
      WHERE tenant_id = $1
        AND resource_library_item_id = $2::uuid
    `,
    [auth.tenantId, resourceId]
  );
  if (Number(remainingResult.rows[0]?.count ?? 0) === 0) {
    await client.query(
      `
        DELETE FROM resource_library_item
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [auth.tenantId, resourceId]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "record_resource.removed",
    entityType: "resource_library_item",
    entityId: resourceId,
    metadata: {
      object_type: objectType,
      object_id: objectId,
      title: item.file_name
    }
  });
}

async function resolveRecordAccess(
  client: PoolClient,
  auth: AuthUser,
  objectType: RecordResourceObjectType,
  objectId: string
): Promise<RecordAccessContext> {
  if (objectType === "organization") {
    const result = await client.query<{ display_name: string }>(
      `
        SELECT display_name
        FROM organization
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const organization = result.rows[0] ?? null;
    if (!organization) {
      throw new ApiError(404, "Organization not found");
    }
    return {
      objectType,
      objectId,
      label: organization.display_name,
      canView: canViewRecords(auth, "organization", { organizationId: objectId }),
      canManage: canEditRecords(auth, "organization", { organizationId: objectId }),
      organizationId: objectId,
      locationId: null
    };
  }

  if (objectType === "location") {
    const result = await client.query<{ name: string; organization_id: string | null }>(
      `
        SELECT name, organization_id::text AS organization_id
        FROM shoot_location
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const location = result.rows[0] ?? null;
    if (!location) {
      throw new ApiError(404, "Location not found");
    }
    const context = { locationId: objectId, organizationId: location.organization_id };
    return {
      objectType,
      objectId,
      label: location.name,
      canView: canViewRecords(auth, "location", context),
      canManage: canEditRecords(auth, "location", context),
      organizationId: location.organization_id,
      locationId: objectId
    };
  }

  if (objectType === "job") {
    const result = await client.query<{
      title: string;
      job_number: string | null;
      department_type: string;
      organization_id: string | null;
      primary_location_id: string | null;
      account_owner_user_id: string | null;
      created_by_user_id: string | null;
    }>(
      `
        SELECT
          title,
          job_number,
          department_type::text AS department_type,
          organization_id::text AS organization_id,
          primary_location_id::text AS primary_location_id,
          account_owner_user_id::text AS account_owner_user_id,
          created_by_user_id::text AS created_by_user_id
        FROM jobs
        WHERE tenant_id = $1
          AND id = $2::uuid
        LIMIT 1
      `,
      [auth.tenantId, objectId]
    );
    const job = result.rows[0] ?? null;
    if (!job) {
      throw new ApiError(404, "Job not found");
    }
    const assignmentRows = await client.query<{ user_id: string | null }>(
      `
        SELECT user_id::text AS user_id
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = $2::uuid
      `,
      [auth.tenantId, objectId]
    );
    const context = {
      departmentType: job.department_type,
      organizationId: job.organization_id,
      locationId: job.primary_location_id,
      ownerUserIds: [job.account_owner_user_id, job.created_by_user_id],
      assignedUserIds: assignmentRows.rows.map((row) => row.user_id)
    };
    return {
      objectType,
      objectId,
      label: job.job_number ? `${job.job_number} | ${job.title}` : job.title,
      canView: canViewRecords(auth, "job", context),
      canManage: canEditRecords(auth, "job", context),
      organizationId: job.organization_id,
      locationId: job.primary_location_id
    };
  }

  const result = await client.query<{
    title: string;
    department_type: string;
    organization_id: string | null;
    location_id: string | null;
    account_owner_user_id: string | null;
    assigned_to_user_id: string | null;
    assigned_peer_reviewer_user_id: string | null;
    assigned_release_reviewer_user_id: string | null;
    department_owner_user_id: string | null;
  }>(
    `
      SELECT
        title,
        department_type::text AS department_type,
        organization_id::text AS organization_id,
        location_id::text AS location_id,
        account_owner_user_id::text AS account_owner_user_id,
        assigned_to_user_id::text AS assigned_to_user_id,
        assigned_peer_reviewer_user_id::text AS assigned_peer_reviewer_user_id,
        assigned_release_reviewer_user_id::text AS assigned_release_reviewer_user_id,
        department_owner_user_id::text AS department_owner_user_id
      FROM production_items
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [auth.tenantId, objectId]
  );
  const item = result.rows[0] ?? null;
  if (!item) {
    throw new ApiError(404, "Production item not found");
  }
  const context = {
    departmentType: item.department_type,
    organizationId: item.organization_id,
    locationId: item.location_id,
    ownerUserIds: [item.account_owner_user_id, item.department_owner_user_id],
    assignedUserIds: [item.assigned_to_user_id, item.assigned_peer_reviewer_user_id, item.assigned_release_reviewer_user_id]
  };
  return {
    objectType,
    objectId,
    label: item.title,
    canView: canViewRecords(auth, "production", context),
    canManage: canEditRecords(auth, "production", context),
    organizationId: item.organization_id,
    locationId: item.location_id
  };
}

function inferExternalProvider(url: string) {
  const normalized = url.trim().toLowerCase();
  if (normalized.includes("sharepoint.com")) {
    return "sharepoint" as const;
  }
  if (normalized.includes("onedrive") || normalized.includes("1drv.ms")) {
    return "onedrive" as const;
  }
  return "direct_url" as const;
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function inferResourceType(input: {
  title: string;
  category: ResourceLibraryCategory;
  contentType: string | null;
  storageKey: string | null;
  url: string;
}) {
  const inferred = inferResourceTypeFromFile({
    fileName: input.title,
    contentType: input.contentType,
    storageKey: input.storageKey,
    url: input.url
  });
  if (inferred !== "image") {
    return inferred;
  }
  if (isDocumentCategory(input.category)) {
    return "document";
  }
  return inferred;
}

function isDocumentCategory(category: ResourceLibraryCategory) {
  return [
    "qr_code_job_document",
    "sop_reference",
    "contract_document",
    "proof_document",
    "support_document"
  ].includes(category);
}
