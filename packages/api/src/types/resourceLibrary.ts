export type ResourceLibraryType = "image" | "document" | "qr_code" | "video";

export type ResourceLibraryCategory =
  | "setup_photo"
  | "location_reference"
  | "prior_successful_example"
  | "product_example"
  | "issue_concern"
  | "equipment_setup_need"
  | "qr_code_job_document"
  | "sop_reference"
  | "contract_document"
  | "proof_document"
  | "support_document"
  | "misc_internal_reference";

export type ResourceLibraryApprovalStatus =
  | "pending_review"
  | "approved"
  | "leadership_only"
  | "rejected_not_useful";

export type ResourceLibraryBestReferenceCategory =
  | "best_setup_example"
  | "best_team_photo_example"
  | "best_entrance_location_example"
  | "best_product_poster_example"
  | "best_logistics_example";

export type ResourceLibraryVisibilityScope = "leadership_only" | "photographer_prep";

export type ResourceLibraryLinkedScope = "shoot" | "location" | "organization";

export type ResourceLibraryUploadSource = "mobile_camera" | "mobile_library" | "mobile_document" | "web_upload" | "system_migration";

export interface ResourceLibraryItem {
  id: string;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
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
  file_size_bytes: number | null;
  storage_key: string | null;
  preview_url: string | null;
  download_url: string | null;
  upload_source: ResourceLibraryUploadSource | null;
  gps_lat: number | null;
  gps_lng: number | null;
  shoot_date: string | null;
  captured_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  linked_scope: ResourceLibraryLinkedScope;
}

export interface ResourceLibraryLearning {
  id: string;
  organization_id?: string | null;
  organization_display_name?: string | null;
  location_id?: string | null;
  location_name?: string | null;
  shoot_id?: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  overall_rating: number;
  recommendations: string | null;
  notes: string | null;
  access_details: string | null;
  late_details: string | null;
}

export interface ResourceLibraryRecurringContact {
  id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
}

export interface ResourceLibraryRecurringReminder {
  id: string;
  source: "resource_library" | "post_shoot_evaluation";
  label: string;
  detail: string;
  created_at: string | null;
  shoot_name: string | null;
  shoot_date: string | null;
}

export interface ResourceLibraryRecurringLocationIntelligence {
  best_reference: ResourceLibraryItem[];
  setup_photos_last_two_years: ResourceLibraryItem[];
  prior_successful_examples: ResourceLibraryItem[];
  documents_and_qr: ResourceLibraryItem[];
  issue_watchouts: ResourceLibraryItem[];
  recent_post_shoot_evaluations: ResourceLibraryLearning[];
  recurring_contacts: ResourceLibraryRecurringContact[];
  reminders: ResourceLibraryRecurringReminder[];
}

export interface ResourceLibraryView {
  access: {
    can_manage: boolean;
    can_download: boolean;
    limited_view: boolean;
    historical_window_years: number | null;
  };
  summary: {
    total_items: number;
    media_count: number;
    document_count: number;
    best_reference_count: number;
    pending_review_count: number;
    leadership_only_count: number;
    rejected_count: number;
    prep_highlight_count: number;
  };
  review_queue: ResourceLibraryItem[];
  prep_highlights: ResourceLibraryItem[];
  media: ResourceLibraryItem[];
  documents: ResourceLibraryItem[];
  historical_references: ResourceLibraryItem[];
  post_shoot_learnings: ResourceLibraryLearning[];
  recurring_location_intelligence: ResourceLibraryRecurringLocationIntelligence | null;
}
