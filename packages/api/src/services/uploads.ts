import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import type {
  ResourceLibraryApprovalStatus,
  ResourceLibraryCategory,
  ResourceLibraryVisibilityScope
} from "../types/resourceLibrary.js";
import { createAuditLog } from "./audit.js";
import {
  buildLegacyMediaResourceDefaults,
  inferResourceTypeFromFile,
  loadShootDirectoryContext,
  upsertResourceLibraryItemFromSource
} from "./resourceLibrary.js";
import { assertManagedUploadStorageKey } from "./s3.js";
import { assertShootAccess } from "./shootAccess.js";

export async function attachMediaAsset(
  client: PoolClient,
  input: {
    auth: AuthUser;
    tenantId: string;
    userId: string;
    shootId: string;
    storageKey: string;
    kind: string;
    category?: ResourceLibraryCategory | null;
    note?: string | null;
    issueType?: string | null;
    fileName?: string | null;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    capturedAt?: string | null;
    approvalStatus?: ResourceLibraryApprovalStatus | null;
    visibilityScope?: ResourceLibraryVisibilityScope | null;
    isBestReference?: boolean | null;
    url?: string | null;
  }
) {
  await assertShootAccess(client, input.auth, input.shootId);
  assertManagedUploadStorageKey(input.tenantId, input.storageKey);
  const fileName = input.fileName?.trim() || input.storageKey.split("/").filter(Boolean).at(-1) || "resource-upload";
  const resourceType = inferResourceTypeFromFile({
    fileName,
    contentType: input.contentType ?? null,
    storageKey: input.storageKey,
    url: input.url ?? null
  });
  const defaults = buildLegacyMediaResourceDefaults(input.auth, {
    kind: input.kind,
    category: input.category ?? null,
    resourceType,
    approvalStatus: input.approvalStatus ?? null,
    visibilityScope: input.visibilityScope ?? null,
    isBestReference: input.isBestReference ?? null
  });
  const { rows } = await client.query(
    `
      INSERT INTO media_asset (tenant_id, shoot_id, user_id, kind, storage_key, url)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,
    [input.tenantId, input.shootId, input.userId, input.kind, input.storageKey, input.url ?? null]
  );
  const shootContext = await loadShootDirectoryContext(client, input.tenantId, input.shootId);
  await upsertResourceLibraryItemFromSource(client, {
    tenantId: input.tenantId,
    organizationId: shootContext?.organizationId ?? null,
    locationId: shootContext?.locationId ?? null,
    shootId: input.shootId,
    uploaderUserId: input.auth.id,
    uploaderName: input.auth.fullName,
    resourceType,
    category: defaults.category,
    note: input.note ?? null,
    issueType: input.issueType ?? null,
    approvalStatus: defaults.approvalStatus,
    visibilityScope: defaults.visibilityScope,
    isBestReference: defaults.isBestReference,
    fileName,
    contentType: input.contentType ?? null,
    fileSizeBytes: input.fileSizeBytes ?? null,
    storageKey: input.storageKey,
    fileUrl: input.url ?? null,
    uploadSource: "web_upload",
    capturedAt: input.capturedAt ?? null,
    sourceRecordType: "media_asset",
    sourceRecordId: rows[0].id
  });
  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.auth.id,
    targetUserId: input.auth.id,
    action: "upload.attached",
    entityType: "media_asset",
    entityId: rows[0].id,
    metadata: {
      shoot_id: input.shootId,
      storage_key: input.storageKey,
      kind: input.kind,
      category: defaults.category,
      approval_status: defaults.approvalStatus
    }
  });
  return {
    ...rows[0],
    file_name: fileName,
    resource_type: resourceType,
    category: defaults.category,
    approval_status: defaults.approvalStatus,
    visibility_scope: defaults.visibilityScope,
    is_best_reference: defaults.isBestReference
  };
}
