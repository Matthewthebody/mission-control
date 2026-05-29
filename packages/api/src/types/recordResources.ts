import type { ResourceLibraryCategory, ResourceLibraryType } from "./resourceLibrary.js";

export type RecordResourceObjectType = "organization" | "location" | "job" | "production_item";
export type RecordResourceReferenceKind = "uploaded_file" | "external_link";
export type RecordResourceProvider = "internal_upload" | "direct_url" | "sharepoint" | "onedrive";

export interface RecordResourceLinkedObject {
  object_type: "organization" | "location" | "shoot" | "job" | "production_item";
  object_id: string;
}

export interface RecordResourceItem {
  id: string;
  title: string;
  resource_type: ResourceLibraryType;
  category: ResourceLibraryCategory;
  reference_kind: RecordResourceReferenceKind;
  provider: RecordResourceProvider | null;
  description: string | null;
  file_name: string;
  content_type: string | null;
  file_size_bytes: number | null;
  url: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  can_remove: boolean;
  linked_objects: RecordResourceLinkedObject[];
}

export interface RecordResourcesResponse {
  object: {
    object_type: RecordResourceObjectType;
    object_id: string;
    label: string;
  };
  access: {
    can_view: boolean;
    can_manage: boolean;
  };
  summary: {
    total_items: number;
    uploaded_file_count: number;
    external_link_count: number;
  };
  items: RecordResourceItem[];
}

export interface CreateRecordResourceInput {
  title: string;
  category: ResourceLibraryCategory;
  description?: string | null;
  storage_key?: string | null;
  url: string;
  content_type?: string | null;
  file_size_bytes?: number | null;
  provider?: Exclude<RecordResourceProvider, "internal_upload"> | null;
}
