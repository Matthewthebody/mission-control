import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isFieldRole } from "../authz/policy.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  ResourceLibraryCategory,
  ResourceLibraryType,
  ResourceLibraryUploadSource
} from "../types/resourceLibrary.js";
import { createAuditLog } from "./audit.js";
import { triggerProductionProjectFromResourceIssue } from "./productionProjects.js";
import { assertManagedUploadStorageKey } from "./s3.js";
import { assertShiftAccess } from "./shiftAccess.js";
import { assertShootAccess } from "./shootAccess.js";
import { inferResourceTypeFromFile, upsertResourceLibraryItemFromSource } from "./resourceLibrary.js";
import { resolveSetupPhotoCloseoutArtifacts } from "./postShootEvaluations.js";
import { getTimeClockStateSummary } from "./timeClockRuntime.js";
import {
  flagUploadWhileOffClock,
  resolveTimeClockComplianceFlags
} from "./timeClockCompliance.js";

export type ResourceLibraryUploadTargetType = "shoot" | "location" | "organization";

type ResourceUploadContext = {
  organizationId: string | null;
  locationId: string | null;
  shootId: string | null;
  targetLabel: string;
};

export async function createResourceLibraryUpload(
  client: PoolClient,
  auth: AuthUser,
  input: {
    targetType: ResourceLibraryUploadTargetType;
    targetId: string;
    shiftId?: string | null;
    linkedShootId?: string | null;
    storageKey: string;
    fileName: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    capturedAt?: string | null;
    category: ResourceLibraryCategory;
    note?: string | null;
    issueType?: string | null;
    importantForNextYear?: boolean;
    uploadSource: ResourceLibraryUploadSource;
    gpsLat?: number | null;
    gpsLng?: number | null;
    url?: string | null;
  }
) {
  assertManagedUploadStorageKey(auth.tenantId, input.storageKey);

  const fileName = input.fileName.trim() || input.storageKey.split("/").filter(Boolean).at(-1) || "mobile-upload";
  const resourceType = inferResourceTypeFromFile({
    fileName,
    contentType: input.contentType ?? null,
    storageKey: input.storageKey,
    url: input.url ?? null
  });
  const context = await resolveUploadContext(client, auth, input.targetType, input.targetId, input.linkedShootId ?? null);
  const linkedShift = await resolveLinkedShiftContext(client, auth, input.shiftId ?? null, context.shootId);
  const approvalStatus = isFieldRole(auth) ? "pending_review" : "approved";
  const visibilityScope = "photographer_prep";
  const isBestReference = Boolean(input.importantForNextYear) && resourceType === "image";

  if (isBestReference) {
    await assertBestReferenceCapacity(client, auth.tenantId, input.targetType, input.targetId, input.category);
  }

  const sourceRecordId = randomUUID();
  const timeClockState = await getTimeClockStateSummary(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id
  });
  const uploadedWhileOffClock =
    timeClockState.session_status === "off_clock" ||
    timeClockState.current_state === "off_clock" ||
    timeClockState.needs_end_of_day_confirmation;
  await upsertResourceLibraryItemFromSource(client, {
    tenantId: auth.tenantId,
    organizationId: context.organizationId,
    locationId: context.locationId,
    shootId: context.shootId,
    uploaderUserId: auth.id,
    uploaderName: auth.fullName,
    resourceType,
    category: input.category,
    note: input.note ?? null,
    issueType: input.issueType ?? null,
    approvalStatus,
    visibilityScope,
    isBestReference,
    fileName,
    contentType: input.contentType ?? null,
    fileSizeBytes: input.fileSizeBytes ?? null,
    storageKey: input.storageKey,
    fileUrl: input.url ?? null,
    uploadSource: input.uploadSource,
    gpsLat: input.gpsLat ?? null,
    gpsLng: input.gpsLng ?? null,
    capturedAt: input.capturedAt ?? null,
    sourceRecordType: "resource_library_upload",
    sourceRecordId
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "resource_library.uploaded",
    entityType: "resource_library_item",
    entityId: sourceRecordId,
    metadata: {
      target_type: input.targetType,
      target_id: input.targetId,
      linked_shoot_id: input.linkedShootId ?? null,
      category: input.category,
      resource_type: resourceType,
      approval_status: approvalStatus,
      visibility_scope: visibilityScope,
      important_for_next_year: isBestReference,
      upload_source: input.uploadSource,
      gps_lat: input.gpsLat ?? null,
      gps_lng: input.gpsLng ?? null
    }
  });

  if (input.category === "setup_photo" && context.shootId) {
    await resolveSetupPhotoCloseoutArtifacts(client, {
      shootId: context.shootId,
      resolvedByUserId: auth.id,
      resolutionNote: "Setup photo uploaded through the Resource Library mobile flow."
    });
    await resolveTimeClockComplianceFlags(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      shiftId: linkedShift?.id ?? null,
      shootId: context.shootId,
      itemTypes: ["missing_setup_photo"],
      resolutionNote: "Setup Photo uploaded through the Resource Library mobile flow.",
      actorUserId: auth.id
    });
  }

  let offClockUploadWarning: { message: string; suggested_action: string } | null = null;
  if (uploadedWhileOffClock) {
    await flagUploadWhileOffClock(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      shiftId: linkedShift?.id ?? null,
      sessionId: timeClockState.session_id,
      shootId: context.shootId,
      organizationId: context.organizationId,
      locationId: context.locationId,
      category: input.category,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: context.targetLabel,
      actorUserId: auth.id
    });
    offClockUploadWarning = {
      message:
        `You uploaded ${input.category === "setup_photo" ? "a Setup Photo" : "operational media"} while Off Clock. The upload was still saved so the evidence is not lost.`,
      suggested_action: "Submit a missed clock-in or correction request if this happened during paid work."
    };
  }

  if (input.category === "issue_concern" || input.category === "equipment_setup_need") {
    await triggerProductionProjectFromResourceIssue(client, auth, {
      resourceUploadId: sourceRecordId,
      category: input.category,
      fileName,
      note: input.note ?? null,
      organizationId: context.organizationId,
      locationId: context.locationId,
      shootId: context.shootId,
      anchorDate: (input.capturedAt ?? new Date().toISOString()).slice(0, 10)
    });
  }

  return {
    id: sourceRecordId,
    target_type: input.targetType,
    target_id: input.targetId,
    target_label: context.targetLabel,
    category: input.category,
    resource_type: resourceType,
    approval_status: approvalStatus,
    visibility_scope: visibilityScope,
    is_best_reference: isBestReference,
    file_name: fileName,
    preview_url: input.url ?? null,
    upload_source: input.uploadSource,
    off_clock_upload_warning: offClockUploadWarning
  };
}

async function resolveUploadContext(
  client: PoolClient,
  auth: AuthUser,
  targetType: ResourceLibraryUploadTargetType,
  targetId: string,
  linkedShootId: string | null
): Promise<ResourceUploadContext> {
  if (targetType === "shoot") {
    await assertShootAccess(client, auth, targetId);
    const shootResult = await client.query<{
      organization_id: string | null;
      location_id: string | null;
      shoot_code: string | null;
      title: string;
    }>(
      `
        SELECT organization_id, location_id, shoot_code, title
        FROM shoot
        WHERE tenant_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [auth.tenantId, targetId]
    );
    const shoot = shootResult.rows[0];
    if (!shoot) {
      throw new ApiError(404, "Shoot not found");
    }
    return {
      organizationId: shoot.organization_id,
      locationId: shoot.location_id,
      shootId: targetId,
      targetLabel: shoot.shoot_code ? `${shoot.shoot_code} | ${shoot.title}` : shoot.title
    };
  }

  if (targetType === "location") {
    const locationResult = await client.query<{
      organization_id: string | null;
      name: string;
    }>(
      `
        SELECT organization_id, name
        FROM shoot_location
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [auth.tenantId, targetId]
    );
    const location = locationResult.rows[0];
    if (!location) {
      throw new ApiError(404, "Location not found");
    }

    const linked = await resolveFieldLinkedShoot(client, auth, linkedShootId, {
      expectedLocationId: targetId
    });

    return {
      organizationId: linked?.organizationId ?? location.organization_id ?? null,
      locationId: targetId,
      shootId: linked?.shootId ?? null,
      targetLabel: location.name
    };
  }

  const organizationResult = await client.query<{ display_name: string }>(
    `
      SELECT display_name
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, targetId]
  );
  const organization = organizationResult.rows[0];
  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }

  const linked = await resolveFieldLinkedShoot(client, auth, linkedShootId, {
    expectedOrganizationId: targetId
  });

  return {
    organizationId: targetId,
    locationId: linked?.locationId ?? null,
    shootId: linked?.shootId ?? null,
    targetLabel: organization.display_name
  };
}

async function resolveFieldLinkedShoot(
  client: PoolClient,
  auth: AuthUser,
  linkedShootId: string | null,
  expectation: {
    expectedLocationId?: string;
    expectedOrganizationId?: string;
  }
) {
  if (!isFieldRole(auth)) {
    if (!linkedShootId) {
      return null;
    }
    return loadLinkedShootContext(client, auth, linkedShootId, expectation);
  }

  if (!linkedShootId) {
    throw new ApiError(400, "Field uploads to linked records must stay attached to a Shoot context");
  }

  return loadLinkedShootContext(client, auth, linkedShootId, expectation);
}

async function loadLinkedShootContext(
  client: PoolClient,
  auth: AuthUser,
  shootId: string,
  expectation: {
    expectedLocationId?: string;
    expectedOrganizationId?: string;
  }
) {
  await assertShootAccess(client, auth, shootId);
  const shootResult = await client.query<{
    organization_id: string | null;
    location_id: string | null;
  }>(
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
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }
  if (expectation.expectedLocationId && shoot.location_id !== expectation.expectedLocationId) {
    throw new ApiError(403, "This Location is not linked to the selected Shoot");
  }
  if (expectation.expectedOrganizationId && shoot.organization_id !== expectation.expectedOrganizationId) {
    throw new ApiError(403, "This Organization is not linked to the selected Shoot");
  }
  return {
    shootId,
    organizationId: shoot.organization_id,
    locationId: shoot.location_id
  };
}

async function resolveLinkedShiftContext(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string | null,
  expectedShootId: string | null
) {
  if (!shiftId) {
    return null;
  }

  await assertShiftAccess(client, auth, shiftId);
  const { rows } = await client.query<{ id: string; shoot_id: string | null }>(
    `
      SELECT id, shoot_id
      FROM work_shift
      WHERE tenant_id = $1
        AND id = $2
        AND cancelled_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shiftId]
  );
  const shift = rows[0] ?? null;
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }
  if (expectedShootId && shift.shoot_id && String(shift.shoot_id) !== String(expectedShootId)) {
    throw new ApiError(403, "This upload Shift does not match the selected Shoot context");
  }
  return shift;
}

async function assertBestReferenceCapacity(
  client: PoolClient,
  tenantId: string,
  targetType: ResourceLibraryUploadTargetType,
  targetId: string,
  category: ResourceLibraryCategory
) {
  const column = targetType === "shoot" ? "shoot_id" : targetType === "location" ? "location_id" : "organization_id";
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM resource_library_item
      WHERE tenant_id = $1
        AND ${column} = $2
        AND category = $3::resource_library_category
        AND is_best_reference = true
        AND resource_type = 'image'
    `,
    [tenantId, targetId, category]
  );

  if (Number(result.rows[0]?.count ?? 0) >= 3) {
    throw new ApiError(409, "This category already has 3 Best Reference images for the selected record");
  }
}
