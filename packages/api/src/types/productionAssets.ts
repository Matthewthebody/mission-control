export type ProductionAssetValidationStatus = "unvalidated" | "validated" | "deprecated";
export type ProductionAssetLicenseStatus = "active" | "inactive" | "expiring" | "expired";
export type ProductionAssetLicenseType = "subscription" | "perpetual" | "floating" | "device" | "seat" | "other";

export type ProductionAssetJobType =
  | "standard_school_production"
  | "sports_production"
  | "specialty_graphics"
  | "banner_specialty_product"
  | "gallery_prep_upload"
  | "qa_final_review"
  | "correction_rework";

export interface ProductionAssetPresetVersion {
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
}

export interface ProductionAssetPreset {
  id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  job_types: ProductionAssetJobType[];
  glasses_handling: string | null;
  known_issues: string | null;
  notes: string | null;
  versions: ProductionAssetPresetVersion[];
  created_at: string;
  updated_at: string;
}

export interface ProductionBackgroundVariant {
  id: string;
  pack_id: string;
  name: string;
  active_status: boolean;
  notes: string | null;
  storage_key: string | null;
  file_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionBackgroundPack {
  id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  validation_status: ProductionAssetValidationStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  job_types: ProductionAssetJobType[];
  notes: string | null;
  variants: ProductionBackgroundVariant[];
  created_at: string;
  updated_at: string;
}

export interface ProductionToolLicense {
  id: string;
  tool_name: string;
  license_type: ProductionAssetLicenseType;
  seat_count: number | null;
  status: ProductionAssetLicenseStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  renewal_date: string | null;
  notes: string | null;
  restrictions: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionAssetWorkspace {
  generated_at: string;
  presets: ProductionAssetPreset[];
  background_packs: ProductionBackgroundPack[];
  licenses: ProductionToolLicense[];
}

