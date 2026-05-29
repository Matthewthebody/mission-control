import { apiFetch } from "../api";
import type {
  ProductionAssetJobType,
  ProductionAssetLicenseStatus,
  ProductionAssetLicenseType,
  ProductionAssetValidationStatus,
  ProductionAssetWorkspace,
  ProductionBackgroundPack,
  ProductionBackgroundVariant,
  ProductionAssetPreset,
  ProductionAssetPresetVersion,
  ProductionToolLicense
} from "../types";

export type ProductionPresetInput = {
  name?: string;
  description?: string | null;
  active_status?: boolean;
  validation_status?: ProductionAssetValidationStatus;
  owner_user_id?: string | null;
  job_types?: ProductionAssetJobType[];
  glasses_handling?: string | null;
  known_issues?: string | null;
  notes?: string | null;
};

export type PresetVersionInput = {
  version_label?: string;
  active_status?: boolean;
  validation_status?: ProductionAssetValidationStatus;
  owner_user_id?: string | null;
  notes?: string | null;
};

export type BackgroundPackInput = {
  name?: string;
  description?: string | null;
  active_status?: boolean;
  validation_status?: ProductionAssetValidationStatus;
  owner_user_id?: string | null;
  job_types?: ProductionAssetJobType[];
  notes?: string | null;
};

export type BackgroundVariantInput = {
  name?: string;
  active_status?: boolean;
  notes?: string | null;
  storage_key?: string | null;
  file_url?: string | null;
};

export type ToolLicenseInput = {
  tool_name?: string;
  license_type?: ProductionAssetLicenseType;
  seat_count?: number | null;
  status?: ProductionAssetLicenseStatus;
  owner_user_id?: string | null;
  renewal_date?: string | null;
  notes?: string | null;
  restrictions?: string | null;
};

export async function getProductionAssetWorkspace(token: string) {
  return apiFetch<ProductionAssetWorkspace>("/api/production-assets/workspace", token);
}

export async function createProductionPreset(token: string, payload: ProductionPresetInput) {
  return apiFetch<ProductionAssetPreset>("/api/production-assets/presets", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateProductionPreset(token: string, id: string, payload: ProductionPresetInput) {
  return apiFetch<ProductionAssetPreset>(`/api/production-assets/presets/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function createPresetVersion(token: string, presetId: string, payload: PresetVersionInput) {
  return apiFetch<ProductionAssetPreset>(`/api/production-assets/presets/${encodeURIComponent(presetId)}/versions`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updatePresetVersion(token: string, id: string, payload: PresetVersionInput) {
  return apiFetch<ProductionAssetPresetVersion>(`/api/production-assets/preset-versions/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function createBackgroundPack(token: string, payload: BackgroundPackInput) {
  return apiFetch<ProductionBackgroundPack>("/api/production-assets/background-packs", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateBackgroundPack(token: string, id: string, payload: BackgroundPackInput) {
  return apiFetch<ProductionBackgroundPack>(`/api/production-assets/background-packs/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function createBackgroundVariant(token: string, packId: string, payload: BackgroundVariantInput) {
  return apiFetch<ProductionBackgroundPack>(`/api/production-assets/background-packs/${encodeURIComponent(packId)}/variants`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateBackgroundVariant(token: string, id: string, payload: BackgroundVariantInput) {
  return apiFetch<ProductionBackgroundVariant>(`/api/production-assets/background-variants/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function createToolLicense(token: string, payload: ToolLicenseInput) {
  return apiFetch<ProductionToolLicense>("/api/production-assets/licenses", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateToolLicense(token: string, id: string, payload: ToolLicenseInput) {
  return apiFetch<ProductionToolLicense>(`/api/production-assets/licenses/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}
