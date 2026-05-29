import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  ProductionAssetJobType,
  ProductionAssetLicenseStatus,
  ProductionAssetLicenseType,
  ProductionAssetPreset,
  ProductionAssetPresetVersion,
  ProductionAssetValidationStatus,
  ProductionAssetWorkspace,
  ProductionBackgroundPack,
  ProductionBackgroundVariant,
  ProductionToolLicense
} from "../types/productionAssets.js";
import { createAuditLog } from "./audit.js";

function toAuditValues(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

type PresetRow = {
  id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  job_types: ProductionAssetJobType[] | null;
  glasses_handling: string | null;
  known_issues: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PresetVersionRow = {
  id: string;
  preset_id: string;
  version_label: string;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type BackgroundPackRow = {
  id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  job_types: ProductionAssetJobType[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type BackgroundVariantRow = {
  id: string;
  pack_id: string;
  name: string;
  active_status: boolean;
  notes: string | null;
  storage_key: string | null;
  file_url: string | null;
  created_at: string;
  updated_at: string;
};

type ToolLicenseRow = {
  id: string;
  tool_name: string;
  license_type: ProductionAssetLicenseType;
  seat_count: number | string | null;
  status: ProductionAssetLicenseStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  renewal_date: string | null;
  notes: string | null;
  restrictions: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateProductionPresetInput = {
  name: string;
  description?: string | null;
  activeStatus?: boolean;
  validationStatus?: ProductionAssetValidationStatus;
  ownerUserId?: string | null;
  jobTypes?: ProductionAssetJobType[];
  glassesHandling?: string | null;
  knownIssues?: string | null;
  notes?: string | null;
};

export type UpdateProductionPresetInput = {
  name?: string;
  description?: string | null;
  activeStatus?: boolean;
  validationStatus?: ProductionAssetValidationStatus;
  ownerUserId?: string | null;
  jobTypes?: ProductionAssetJobType[];
  glassesHandling?: string | null;
  knownIssues?: string | null;
  notes?: string | null;
};

export type CreatePresetVersionInput = {
  versionLabel: string;
  activeStatus?: boolean;
  validationStatus?: ProductionAssetValidationStatus;
  ownerUserId?: string | null;
  notes?: string | null;
};

export type UpdatePresetVersionInput = {
  versionLabel?: string;
  activeStatus?: boolean;
  validationStatus?: ProductionAssetValidationStatus;
  ownerUserId?: string | null;
  notes?: string | null;
};

export type CreateBackgroundPackInput = {
  name: string;
  description?: string | null;
  activeStatus?: boolean;
  validationStatus?: ProductionAssetValidationStatus;
  ownerUserId?: string | null;
  jobTypes?: ProductionAssetJobType[];
  notes?: string | null;
};

export type UpdateBackgroundPackInput = {
  name?: string;
  description?: string | null;
  activeStatus?: boolean;
  validationStatus?: ProductionAssetValidationStatus;
  ownerUserId?: string | null;
  jobTypes?: ProductionAssetJobType[];
  notes?: string | null;
};

export type CreateBackgroundVariantInput = {
  name: string;
  activeStatus?: boolean;
  notes?: string | null;
  storageKey?: string | null;
  fileUrl?: string | null;
};

export type UpdateBackgroundVariantInput = {
  name?: string;
  activeStatus?: boolean;
  notes?: string | null;
  storageKey?: string | null;
  fileUrl?: string | null;
};

export type CreateToolLicenseInput = {
  toolName: string;
  licenseType: ProductionAssetLicenseType;
  seatCount?: number | null;
  status?: ProductionAssetLicenseStatus;
  ownerUserId?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
  restrictions?: string | null;
};

export type UpdateToolLicenseInput = {
  toolName?: string;
  licenseType?: ProductionAssetLicenseType;
  seatCount?: number | null;
  status?: ProductionAssetLicenseStatus;
  ownerUserId?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
  restrictions?: string | null;
};

export async function loadProductionAssetWorkspace(client: PoolClient, auth: AuthUser): Promise<ProductionAssetWorkspace> {
  const [presetRows, versionRows, packRows, variantRows, licenseRows] = await Promise.all([
    client.query<PresetRow>(
      `
        SELECT
          preset.id,
          preset.name,
          preset.description,
          preset.active_status,
          preset.validation_status::text AS validation_status,
          preset.owner_user_id,
          owner.full_name AS owner_name,
          preset.job_types::text[] AS job_types,
          preset.glasses_handling,
          preset.known_issues,
          preset.notes,
          preset.created_at::text,
          preset.updated_at::text
        FROM production_asset_preset preset
        LEFT JOIN app_user owner
          ON owner.tenant_id = preset.tenant_id
         AND owner.id = preset.owner_user_id
        WHERE preset.tenant_id = $1
        ORDER BY lower(preset.name)
      `,
      [auth.tenantId]
    ),
    client.query<PresetVersionRow>(
      `
        SELECT
          version.id,
          version.preset_id,
          version.version_label,
          version.active_status,
          version.validation_status::text AS validation_status,
          version.owner_user_id,
          owner.full_name AS owner_name,
          version.notes,
          version.created_at::text,
          version.updated_at::text
        FROM production_asset_preset_version version
        LEFT JOIN app_user owner
          ON owner.tenant_id = version.tenant_id
         AND owner.id = version.owner_user_id
        WHERE version.tenant_id = $1
        ORDER BY version.created_at DESC, version.version_label ASC
      `,
      [auth.tenantId]
    ),
    client.query<BackgroundPackRow>(
      `
        SELECT
          pack.id,
          pack.name,
          pack.description,
          pack.active_status,
          pack.validation_status::text AS validation_status,
          pack.owner_user_id,
          owner.full_name AS owner_name,
          pack.job_types::text[] AS job_types,
          pack.notes,
          pack.created_at::text,
          pack.updated_at::text
        FROM production_background_pack pack
        LEFT JOIN app_user owner
          ON owner.tenant_id = pack.tenant_id
         AND owner.id = pack.owner_user_id
        WHERE pack.tenant_id = $1
        ORDER BY lower(pack.name)
      `,
      [auth.tenantId]
    ),
    client.query<BackgroundVariantRow>(
      `
        SELECT
          variant.id,
          variant.pack_id,
          variant.name,
          variant.active_status,
          variant.notes,
          variant.storage_key,
          variant.file_url,
          variant.created_at::text,
          variant.updated_at::text
        FROM production_background_variant variant
        WHERE variant.tenant_id = $1
        ORDER BY variant.created_at DESC, variant.name ASC
      `,
      [auth.tenantId]
    ),
    client.query<ToolLicenseRow>(
      `
        SELECT
          license.id,
          license.tool_name,
          license.license_type::text AS license_type,
          license.seat_count,
          license.status::text AS status,
          license.owner_user_id,
          owner.full_name AS owner_name,
          license.renewal_date::text,
          license.notes,
          license.restrictions,
          license.created_at::text,
          license.updated_at::text
        FROM production_tool_license license
        LEFT JOIN app_user owner
          ON owner.tenant_id = license.tenant_id
         AND owner.id = license.owner_user_id
        WHERE license.tenant_id = $1
        ORDER BY lower(license.tool_name)
      `,
      [auth.tenantId]
    )
  ]);

  const versionsByPreset = groupPresetVersions(versionRows.rows);
  const variantsByPack = groupBackgroundVariants(variantRows.rows);

  return {
    generated_at: new Date().toISOString(),
    presets: presetRows.rows.map((row) => mapPresetRow(row, versionsByPreset.get(row.id) ?? [])),
    background_packs: packRows.rows.map((row) => mapBackgroundPackRow(row, variantsByPack.get(row.id) ?? [])),
    licenses: licenseRows.rows.map((row) => mapToolLicenseRow(row))
  };
}

export async function createProductionPreset(
  client: PoolClient,
  auth: AuthUser,
  input: CreateProductionPresetInput
): Promise<ProductionAssetPreset> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO production_asset_preset (
        tenant_id,
        name,
        description,
        active_status,
        validation_status,
        owner_user_id,
        job_types,
        glasses_handling,
        known_issues,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5::production_asset_validation_status,$6,$7::production_project_job_type[],$8,$9,$10,$11,$11)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.name.trim(),
      normalizeNullable(input.description),
      input.activeStatus ?? true,
      input.validationStatus ?? "unvalidated",
      input.ownerUserId ?? null,
      input.jobTypes ?? [],
      normalizeNullable(input.glassesHandling),
      normalizeNullable(input.knownIssues),
      normalizeNullable(input.notes),
      auth.id
    ]
  );
  const presetId = result.rows[0]?.id;
  const preset = await loadPresetById(client, auth.tenantId, presetId);
  if (!preset) {
    throw new ApiError(500, "Preset creation failed.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.preset.created",
    entityType: "production_asset_preset",
    entityId: presetId,
    newValues: toAuditValues(preset)
  });
  return preset;
}

export async function updateProductionPreset(
  client: PoolClient,
  auth: AuthUser,
  presetId: string,
  patch: UpdateProductionPresetInput
): Promise<ProductionAssetPreset> {
  const current = await loadPresetById(client, auth.tenantId, presetId);
  if (!current) {
    throw new ApiError(404, "Preset not found.");
  }

  const next = applyPresetPatch(current, patch);
  await client.query(
    `
      UPDATE production_asset_preset
      SET
        name = $3,
        description = $4,
        active_status = $5,
        validation_status = $6::production_asset_validation_status,
        owner_user_id = $7,
        job_types = $8::production_project_job_type[],
        glasses_handling = $9,
        known_issues = $10,
        notes = $11,
        updated_by_user_id = $12,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      presetId,
      next.name,
      next.description,
      next.active_status,
      next.validation_status,
      next.owner_user_id,
      next.job_types,
      next.glasses_handling,
      next.known_issues,
      next.notes,
      auth.id
    ]
  );

  const updated = await loadPresetById(client, auth.tenantId, presetId);
  if (!updated) {
    throw new ApiError(500, "Preset update failed.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.preset.updated",
    entityType: "production_asset_preset",
    entityId: presetId,
    previousValues: toAuditValues(current),
    newValues: toAuditValues(updated)
  });
  return updated;
}

export async function createPresetVersion(
  client: PoolClient,
  auth: AuthUser,
  presetId: string,
  input: CreatePresetVersionInput
): Promise<ProductionAssetPreset> {
  await ensurePresetExists(client, auth.tenantId, presetId);
  await client.query(
    `
      INSERT INTO production_asset_preset_version (
        tenant_id,
        preset_id,
        version_label,
        active_status,
        validation_status,
        owner_user_id,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5::production_asset_validation_status,$6,$7,$8,$8)
    `,
    [
      auth.tenantId,
      presetId,
      input.versionLabel.trim(),
      input.activeStatus ?? true,
      input.validationStatus ?? "unvalidated",
      input.ownerUserId ?? null,
      normalizeNullable(input.notes),
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.preset_version.created",
    entityType: "production_asset_preset",
    entityId: presetId,
    metadata: { version_label: input.versionLabel }
  });

  const preset = await loadPresetById(client, auth.tenantId, presetId);
  if (!preset) {
    throw new ApiError(500, "Preset version creation failed.");
  }
  return preset;
}

export async function updatePresetVersion(
  client: PoolClient,
  auth: AuthUser,
  versionId: string,
  patch: UpdatePresetVersionInput
): Promise<ProductionAssetPresetVersion> {
  const current = await loadPresetVersionById(client, auth.tenantId, versionId);
  if (!current) {
    throw new ApiError(404, "Preset version not found.");
  }

  const next = applyPresetVersionPatch(current, patch);
  await client.query(
    `
      UPDATE production_asset_preset_version
      SET
        version_label = $3,
        active_status = $4,
        validation_status = $5::production_asset_validation_status,
        owner_user_id = $6,
        notes = $7,
        updated_by_user_id = $8,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      versionId,
      next.version_label,
      next.active_status,
      next.validation_status,
      next.owner_user_id,
      next.notes,
      auth.id
    ]
  );

  const updated = await loadPresetVersionById(client, auth.tenantId, versionId);
  if (!updated) {
    throw new ApiError(500, "Preset version update failed.");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.preset_version.updated",
    entityType: "production_asset_preset_version",
    entityId: versionId,
    previousValues: toAuditValues(current),
    newValues: toAuditValues(updated)
  });
  return updated;
}

export async function createBackgroundPack(
  client: PoolClient,
  auth: AuthUser,
  input: CreateBackgroundPackInput
): Promise<ProductionBackgroundPack> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO production_background_pack (
        tenant_id,
        name,
        description,
        active_status,
        validation_status,
        owner_user_id,
        job_types,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5::production_asset_validation_status,$6,$7::production_project_job_type[],$8,$9,$9)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.name.trim(),
      normalizeNullable(input.description),
      input.activeStatus ?? true,
      input.validationStatus ?? "unvalidated",
      input.ownerUserId ?? null,
      input.jobTypes ?? [],
      normalizeNullable(input.notes),
      auth.id
    ]
  );
  const packId = result.rows[0]?.id;
  const pack = await loadBackgroundPackById(client, auth.tenantId, packId);
  if (!pack) {
    throw new ApiError(500, "Background pack creation failed.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.background_pack.created",
    entityType: "production_background_pack",
    entityId: packId,
    newValues: toAuditValues(pack)
  });
  return pack;
}

export async function updateBackgroundPack(
  client: PoolClient,
  auth: AuthUser,
  packId: string,
  patch: UpdateBackgroundPackInput
): Promise<ProductionBackgroundPack> {
  const current = await loadBackgroundPackById(client, auth.tenantId, packId);
  if (!current) {
    throw new ApiError(404, "Background pack not found.");
  }

  const next = applyBackgroundPackPatch(current, patch);
  await client.query(
    `
      UPDATE production_background_pack
      SET
        name = $3,
        description = $4,
        active_status = $5,
        validation_status = $6::production_asset_validation_status,
        owner_user_id = $7,
        job_types = $8::production_project_job_type[],
        notes = $9,
        updated_by_user_id = $10,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      packId,
      next.name,
      next.description,
      next.active_status,
      next.validation_status,
      next.owner_user_id,
      next.job_types,
      next.notes,
      auth.id
    ]
  );

  const updated = await loadBackgroundPackById(client, auth.tenantId, packId);
  if (!updated) {
    throw new ApiError(500, "Background pack update failed.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.background_pack.updated",
    entityType: "production_background_pack",
    entityId: packId,
    previousValues: toAuditValues(current),
    newValues: toAuditValues(updated)
  });
  return updated;
}

export async function createBackgroundVariant(
  client: PoolClient,
  auth: AuthUser,
  packId: string,
  input: CreateBackgroundVariantInput
): Promise<ProductionBackgroundPack> {
  await ensureBackgroundPackExists(client, auth.tenantId, packId);
  await client.query(
    `
      INSERT INTO production_background_variant (
        tenant_id,
        pack_id,
        name,
        active_status,
        notes,
        storage_key,
        file_url,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
    `,
    [
      auth.tenantId,
      packId,
      input.name.trim(),
      input.activeStatus ?? true,
      normalizeNullable(input.notes),
      normalizeNullable(input.storageKey),
      normalizeNullable(input.fileUrl),
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.background_variant.created",
    entityType: "production_background_pack",
    entityId: packId,
    metadata: { variant_name: input.name }
  });

  const pack = await loadBackgroundPackById(client, auth.tenantId, packId);
  if (!pack) {
    throw new ApiError(500, "Background variant creation failed.");
  }
  return pack;
}

export async function updateBackgroundVariant(
  client: PoolClient,
  auth: AuthUser,
  variantId: string,
  patch: UpdateBackgroundVariantInput
): Promise<ProductionBackgroundVariant> {
  const current = await loadBackgroundVariantById(client, auth.tenantId, variantId);
  if (!current) {
    throw new ApiError(404, "Background variant not found.");
  }

  const next = applyBackgroundVariantPatch(current, patch);
  await client.query(
    `
      UPDATE production_background_variant
      SET
        name = $3,
        active_status = $4,
        notes = $5,
        storage_key = $6,
        file_url = $7,
        updated_by_user_id = $8,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      variantId,
      next.name,
      next.active_status,
      next.notes,
      next.storage_key,
      next.file_url,
      auth.id
    ]
  );

  const updated = await loadBackgroundVariantById(client, auth.tenantId, variantId);
  if (!updated) {
    throw new ApiError(500, "Background variant update failed.");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.background_variant.updated",
    entityType: "production_background_variant",
    entityId: variantId,
    previousValues: toAuditValues(current),
    newValues: toAuditValues(updated)
  });
  return updated;
}

export async function createToolLicense(
  client: PoolClient,
  auth: AuthUser,
  input: CreateToolLicenseInput
): Promise<ProductionToolLicense> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO production_tool_license (
        tenant_id,
        tool_name,
        license_type,
        seat_count,
        status,
        owner_user_id,
        renewal_date,
        notes,
        restrictions,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3::production_asset_license_type,$4,$5::production_asset_license_status,$6,$7::date,$8,$9,$10,$10)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.toolName.trim(),
      input.licenseType,
      input.seatCount ?? null,
      input.status ?? "active",
      input.ownerUserId ?? null,
      input.renewalDate ?? null,
      normalizeNullable(input.notes),
      normalizeNullable(input.restrictions),
      auth.id
    ]
  );
  const licenseId = result.rows[0]?.id;
  const license = await loadToolLicenseById(client, auth.tenantId, licenseId);
  if (!license) {
    throw new ApiError(500, "Tool license creation failed.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.tool_license.created",
    entityType: "production_tool_license",
    entityId: licenseId,
    newValues: toAuditValues(license)
  });
  return license;
}

export async function updateToolLicense(
  client: PoolClient,
  auth: AuthUser,
  licenseId: string,
  patch: UpdateToolLicenseInput
): Promise<ProductionToolLicense> {
  const current = await loadToolLicenseById(client, auth.tenantId, licenseId);
  if (!current) {
    throw new ApiError(404, "Tool license not found.");
  }

  const next = applyToolLicensePatch(current, patch);
  await client.query(
    `
      UPDATE production_tool_license
      SET
        tool_name = $3,
        license_type = $4::production_asset_license_type,
        seat_count = $5,
        status = $6::production_asset_license_status,
        owner_user_id = $7,
        renewal_date = $8::date,
        notes = $9,
        restrictions = $10,
        updated_by_user_id = $11,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      licenseId,
      next.tool_name,
      next.license_type,
      next.seat_count,
      next.status,
      next.owner_user_id,
      next.renewal_date,
      next.notes,
      next.restrictions,
      auth.id
    ]
  );

  const updated = await loadToolLicenseById(client, auth.tenantId, licenseId);
  if (!updated) {
    throw new ApiError(500, "Tool license update failed.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "production_asset.tool_license.updated",
    entityType: "production_tool_license",
    entityId: licenseId,
    previousValues: toAuditValues(current),
    newValues: toAuditValues(updated)
  });
  return updated;
}

async function loadPresetById(client: PoolClient, tenantId: string, presetId: string) {
  const result = await client.query<PresetRow>(
    `
      SELECT
        preset.id,
        preset.name,
        preset.description,
        preset.active_status,
        preset.validation_status::text AS validation_status,
        preset.owner_user_id,
        owner.full_name AS owner_name,
        preset.job_types::text[] AS job_types,
        preset.glasses_handling,
        preset.known_issues,
        preset.notes,
        preset.created_at::text,
        preset.updated_at::text
      FROM production_asset_preset preset
      LEFT JOIN app_user owner
        ON owner.tenant_id = preset.tenant_id
       AND owner.id = preset.owner_user_id
      WHERE preset.tenant_id = $1
        AND preset.id = $2
      LIMIT 1
    `,
    [tenantId, presetId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const versions = await loadPresetVersionsForPreset(client, tenantId, presetId);
  return mapPresetRow(row, versions);
}

async function loadPresetVersionsForPreset(client: PoolClient, tenantId: string, presetId: string) {
  const result = await client.query<PresetVersionRow>(
    `
      SELECT
        version.id,
        version.preset_id,
        version.version_label,
        version.active_status,
        version.validation_status::text AS validation_status,
        version.owner_user_id,
        owner.full_name AS owner_name,
        version.notes,
        version.created_at::text,
        version.updated_at::text
      FROM production_asset_preset_version version
      LEFT JOIN app_user owner
        ON owner.tenant_id = version.tenant_id
       AND owner.id = version.owner_user_id
      WHERE version.tenant_id = $1
        AND version.preset_id = $2
      ORDER BY version.created_at DESC, version.version_label ASC
    `,
    [tenantId, presetId]
  );
  return result.rows.map(mapPresetVersionRow);
}

async function loadPresetVersionById(client: PoolClient, tenantId: string, versionId: string) {
  const result = await client.query<PresetVersionRow>(
    `
      SELECT
        version.id,
        version.preset_id,
        version.version_label,
        version.active_status,
        version.validation_status::text AS validation_status,
        version.owner_user_id,
        owner.full_name AS owner_name,
        version.notes,
        version.created_at::text,
        version.updated_at::text
      FROM production_asset_preset_version version
      LEFT JOIN app_user owner
        ON owner.tenant_id = version.tenant_id
       AND owner.id = version.owner_user_id
      WHERE version.tenant_id = $1
        AND version.id = $2
      LIMIT 1
    `,
    [tenantId, versionId]
  );
  const row = result.rows[0];
  return row ? mapPresetVersionRow(row) : null;
}

async function loadBackgroundPackById(client: PoolClient, tenantId: string, packId: string) {
  const result = await client.query<BackgroundPackRow>(
    `
      SELECT
        pack.id,
        pack.name,
        pack.description,
        pack.active_status,
        pack.validation_status::text AS validation_status,
        pack.owner_user_id,
        owner.full_name AS owner_name,
        pack.job_types::text[] AS job_types,
        pack.notes,
        pack.created_at::text,
        pack.updated_at::text
      FROM production_background_pack pack
      LEFT JOIN app_user owner
        ON owner.tenant_id = pack.tenant_id
       AND owner.id = pack.owner_user_id
      WHERE pack.tenant_id = $1
        AND pack.id = $2
      LIMIT 1
    `,
    [tenantId, packId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const variants = await loadBackgroundVariantsForPack(client, tenantId, packId);
  return mapBackgroundPackRow(row, variants);
}

async function loadBackgroundVariantsForPack(client: PoolClient, tenantId: string, packId: string) {
  const result = await client.query<BackgroundVariantRow>(
    `
      SELECT
        variant.id,
        variant.pack_id,
        variant.name,
        variant.active_status,
        variant.notes,
        variant.storage_key,
        variant.file_url,
        variant.created_at::text,
        variant.updated_at::text
      FROM production_background_variant variant
      WHERE variant.tenant_id = $1
        AND variant.pack_id = $2
      ORDER BY variant.created_at DESC, variant.name ASC
    `,
    [tenantId, packId]
  );
  return result.rows.map(mapBackgroundVariantRow);
}

async function loadBackgroundVariantById(client: PoolClient, tenantId: string, variantId: string) {
  const result = await client.query<BackgroundVariantRow>(
    `
      SELECT
        variant.id,
        variant.pack_id,
        variant.name,
        variant.active_status,
        variant.notes,
        variant.storage_key,
        variant.file_url,
        variant.created_at::text,
        variant.updated_at::text
      FROM production_background_variant variant
      WHERE variant.tenant_id = $1
        AND variant.id = $2
      LIMIT 1
    `,
    [tenantId, variantId]
  );
  const row = result.rows[0];
  return row ? mapBackgroundVariantRow(row) : null;
}

async function loadToolLicenseById(client: PoolClient, tenantId: string, licenseId: string) {
  const result = await client.query<ToolLicenseRow>(
    `
      SELECT
        license.id,
        license.tool_name,
        license.license_type::text AS license_type,
        license.seat_count,
        license.status::text AS status,
        license.owner_user_id,
        owner.full_name AS owner_name,
        license.renewal_date::text,
        license.notes,
        license.restrictions,
        license.created_at::text,
        license.updated_at::text
      FROM production_tool_license license
      LEFT JOIN app_user owner
        ON owner.tenant_id = license.tenant_id
       AND owner.id = license.owner_user_id
      WHERE license.tenant_id = $1
        AND license.id = $2
      LIMIT 1
    `,
    [tenantId, licenseId]
  );
  const row = result.rows[0];
  return row ? mapToolLicenseRow(row) : null;
}

async function ensurePresetExists(client: PoolClient, tenantId: string, presetId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM production_asset_preset
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, presetId]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Preset not found.");
  }
}

async function ensureBackgroundPackExists(client: PoolClient, tenantId: string, packId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM production_background_pack
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, packId]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Background pack not found.");
  }
}

function groupPresetVersions(rows: PresetVersionRow[]) {
  const map = new Map<string, ProductionAssetPresetVersion[]>();
  for (const row of rows) {
    const bucket = map.get(row.preset_id) ?? [];
    bucket.push(mapPresetVersionRow(row));
    map.set(row.preset_id, bucket);
  }
  return map;
}

function groupBackgroundVariants(rows: BackgroundVariantRow[]) {
  const map = new Map<string, ProductionBackgroundVariant[]>();
  for (const row of rows) {
    const bucket = map.get(row.pack_id) ?? [];
    bucket.push(mapBackgroundVariantRow(row));
    map.set(row.pack_id, bucket);
  }
  return map;
}

function mapPresetRow(row: PresetRow, versions: ProductionAssetPresetVersion[]): ProductionAssetPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active_status: Boolean(row.active_status),
    validation_status: row.validation_status,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    job_types: row.job_types ?? [],
    glasses_handling: row.glasses_handling,
    known_issues: row.known_issues,
    notes: row.notes,
    versions,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapPresetVersionRow(row: PresetVersionRow): ProductionAssetPresetVersion {
  return {
    id: row.id,
    preset_id: row.preset_id,
    version_label: row.version_label,
    active_status: Boolean(row.active_status),
    validation_status: row.validation_status,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapBackgroundPackRow(row: BackgroundPackRow, variants: ProductionBackgroundVariant[]): ProductionBackgroundPack {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active_status: Boolean(row.active_status),
    validation_status: row.validation_status,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    job_types: row.job_types ?? [],
    notes: row.notes,
    variants,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapBackgroundVariantRow(row: BackgroundVariantRow): ProductionBackgroundVariant {
  return {
    id: row.id,
    pack_id: row.pack_id,
    name: row.name,
    active_status: Boolean(row.active_status),
    notes: row.notes,
    storage_key: row.storage_key,
    file_url: row.file_url,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapToolLicenseRow(row: ToolLicenseRow): ProductionToolLicense {
  return {
    id: row.id,
    tool_name: row.tool_name,
    license_type: row.license_type,
    seat_count: row.seat_count === null ? null : Number(row.seat_count),
    status: row.status,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    renewal_date: row.renewal_date,
    notes: row.notes,
    restrictions: row.restrictions,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function applyPresetPatch(current: ProductionAssetPreset, patch: UpdateProductionPresetInput) {
  return {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    description: patch.description !== undefined ? normalizeNullable(patch.description) : current.description,
    active_status: patch.activeStatus !== undefined ? patch.activeStatus : current.active_status,
    validation_status: patch.validationStatus ?? current.validation_status,
    owner_user_id: patch.ownerUserId !== undefined ? patch.ownerUserId : current.owner_user_id,
    job_types: patch.jobTypes !== undefined ? patch.jobTypes : current.job_types,
    glasses_handling: patch.glassesHandling !== undefined ? normalizeNullable(patch.glassesHandling) : current.glasses_handling,
    known_issues: patch.knownIssues !== undefined ? normalizeNullable(patch.knownIssues) : current.known_issues,
    notes: patch.notes !== undefined ? normalizeNullable(patch.notes) : current.notes
  };
}

function applyPresetVersionPatch(current: ProductionAssetPresetVersion, patch: UpdatePresetVersionInput) {
  return {
    ...current,
    version_label: patch.versionLabel !== undefined ? patch.versionLabel.trim() : current.version_label,
    active_status: patch.activeStatus !== undefined ? patch.activeStatus : current.active_status,
    validation_status: patch.validationStatus ?? current.validation_status,
    owner_user_id: patch.ownerUserId !== undefined ? patch.ownerUserId : current.owner_user_id,
    notes: patch.notes !== undefined ? normalizeNullable(patch.notes) : current.notes
  };
}

function applyBackgroundPackPatch(current: ProductionBackgroundPack, patch: UpdateBackgroundPackInput) {
  return {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    description: patch.description !== undefined ? normalizeNullable(patch.description) : current.description,
    active_status: patch.activeStatus !== undefined ? patch.activeStatus : current.active_status,
    validation_status: patch.validationStatus ?? current.validation_status,
    owner_user_id: patch.ownerUserId !== undefined ? patch.ownerUserId : current.owner_user_id,
    job_types: patch.jobTypes !== undefined ? patch.jobTypes : current.job_types,
    notes: patch.notes !== undefined ? normalizeNullable(patch.notes) : current.notes
  };
}

function applyBackgroundVariantPatch(current: ProductionBackgroundVariant, patch: UpdateBackgroundVariantInput) {
  return {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    active_status: patch.activeStatus !== undefined ? patch.activeStatus : current.active_status,
    notes: patch.notes !== undefined ? normalizeNullable(patch.notes) : current.notes,
    storage_key: patch.storageKey !== undefined ? normalizeNullable(patch.storageKey) : current.storage_key,
    file_url: patch.fileUrl !== undefined ? normalizeNullable(patch.fileUrl) : current.file_url
  };
}

function applyToolLicensePatch(current: ProductionToolLicense, patch: UpdateToolLicenseInput) {
  return {
    ...current,
    tool_name: patch.toolName !== undefined ? patch.toolName.trim() : current.tool_name,
    license_type: patch.licenseType ?? current.license_type,
    seat_count: patch.seatCount !== undefined ? patch.seatCount : current.seat_count,
    status: patch.status ?? current.status,
    owner_user_id: patch.ownerUserId !== undefined ? patch.ownerUserId : current.owner_user_id,
    renewal_date: patch.renewalDate !== undefined ? patch.renewalDate : current.renewal_date,
    notes: patch.notes !== undefined ? normalizeNullable(patch.notes) : current.notes,
    restrictions: patch.restrictions !== undefined ? normalizeNullable(patch.restrictions) : current.restrictions
  };
}

function normalizeNullable(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
