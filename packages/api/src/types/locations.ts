import type { ResourceLibraryView } from "./resourceLibrary.js";

export type ShootLocationCategory = "school" | "sports" | "studio" | "venue" | "other";
export type MondayMigrationState = "not_yet_migrated" | "coexisting" | "partially_migrated" | "mission_control_owned";

export interface MondayLocationIntegrationState {
  provider: "monday";
  link_state: "linked" | "not_linked";
  migration_state: MondayMigrationState;
  last_synced_at: string | null;
  monday_item_id: string | null;
  monday_item_url: string | null;
  externally_controlled_fields: string[];
  source_label: string;
  warnings: string[];
}

export interface ShootLocationArea {
  id: string;
  name: string;
  location_details: string | null;
  commentary: string | null;
  photo_urls: string[];
}

export interface ShootLocationPhoto {
  id: string;
  image_url: string;
  source: "catalog" | "mission_control" | "monday";
  caption: string;
  photo_category?:
    | "arrival_entrance"
    | "parking_load_in"
    | "check_in_flow_area"
    | "room_wide_shot"
    | "final_camera_background_setup"
    | "power_staging_storage"
    | "special_constraint_watch_out"
    | null;
  memory_state?: "submitted" | "reviewed" | "added_to_memory" | null;
  promote_to_location_memory?: boolean;
  reviewed_at?: string | null;
  review_note?: string | null;
  uploaded_at: string | null;
  uploader_name?: string | null;
  monday_asset_id?: string | null;
}

export interface ShootLocationEvaluation {
  id: string;
  source: "mission_control" | "monday" | "mock_monday";
  monday_item_id?: string | null;
  organization_id?: string | null;
  job_id?: string | null;
  job_day_id?: string | null;
  shift_id?: string | null;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  eval_status?: "draft" | "submitted" | "reviewed" | "closed" | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: string;
  on_time: string;
  easy_access: string;
  overall_rating: number;
  photos_uploaded: string;
  overall_outcome?: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
  staffing_fit?: "understaffed" | "right_sized" | "overstaffed" | null;
  setup_difficulty?: "low" | "medium" | "high" | null;
  customer_school_readiness?: "ready" | "minor_friction" | "major_friction" | null;
  data_roster_readiness?: "ready" | "minor_friction" | "major_friction" | null;
  equipment_workflow_issue?: "none" | "minor" | "major" | null;
  started_on_time?: boolean | null;
  short_summary_note?: string | null;
  next_time_recommendation?: string | null;
  follow_up_required?: boolean;
  major_issue_flag?: boolean;
  location_memory_update_suggested?: boolean;
  leadership_review_needed?: boolean;
  issue_category?:
    | "staffing"
    | "attendance_no_show"
    | "setup_room_problem"
    | "parking_load_in"
    | "school_readiness"
    | "data_roster"
    | "equipment_technical"
    | "lighting_environment"
    | "line_flow_traffic"
    | "student_parent_flow"
    | "communication_contact_issue"
    | "special_product_deliverable_issue"
    | "other"
    | null;
  top_watch_out?: string | null;
  location_memory_promotion_text?: string | null;
  recommended_staffing_next_time?: number | null;
  recommended_arrival_buffer_minutes?: number | null;
  recommended_room_setup_change?: string | null;
  special_gear_needed_next_time?: string | null;
  customer_follow_up_needed?: boolean;
  reviewed_at?: string | null;
  closed_at?: string | null;
  overall_shoot_status?: "successful" | "completed_with_issues" | "significant_issue" | null;
  went_well?: string | null;
  remember_next_time?: string | null;
  issue_flag?: boolean;
  open_comment?: string | null;
  late_details?: string | null;
  access_details?: string | null;
  notes?: string | null;
  outreach_notes?: string | null;
  recommendations?: string | null;
  image_quality?: string | null;
  submitted_by_name?: string | null;
  created_at: string;
}

export interface LocationHistoricalContext {
  quick_context: {
    first_time_location: boolean;
    total_prior_visits: number;
    last_visit_date: string | null;
    last_confirmed_memory_date: string | null;
    top_watch_outs: string[];
    recommended_arrival_buffer_minutes: number | null;
    recommended_staffing_note: string | null;
    freshness_state: "fresh" | "aging" | "needs_refresh";
    memory_status: "active" | "needs_refresh" | "archived";
    open_issue_count: number;
    trust_source: "reviewed_memory" | "repeated_pattern" | "recent_eval" | "no_history";
  };
  last_time_here: {
    shoot_date: string | null;
    shoot_type: string | null;
    overall_outcome: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
    staffing_fit: "understaffed" | "right_sized" | "overstaffed" | null;
    setup_difficulty: "low" | "medium" | "high" | null;
    major_issue: boolean;
    next_time_recommendation: string | null;
    setup_photos_exist: boolean;
  } | null;
  repeat_pattern_signals: Array<{
    key: string;
    label: string;
    detail: string;
    evidence_count: number;
    severity: "info" | "warning" | "high";
    source: "repeated_structured_pattern";
  }>;
  open_follow_ups: Array<{
    id: string;
    type: "eval_follow_up" | "memory_review" | "photo_review";
    title: string;
    detail: string;
    related_shoot_name: string | null;
    related_shoot_date: string | null;
    created_at: string | null;
    source_label: string;
  }>;
  setup_visuals: {
    photos: ShootLocationPhoto[];
    top_setup_instruction: string | null;
    top_load_in_instruction: string | null;
  };
  recent_comparable_shoots: Array<{
    id: string;
    shoot_name: string;
    shoot_date: string;
    shoot_type: string;
    overall_outcome: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
    staffing_fit: "understaffed" | "right_sized" | "overstaffed" | null;
    setup_difficulty: "low" | "medium" | "high" | null;
    issue_category:
      | "staffing"
      | "attendance_no_show"
      | "setup_room_problem"
      | "parking_load_in"
      | "school_readiness"
      | "data_roster"
      | "equipment_technical"
      | "lighting_environment"
      | "line_flow_traffic"
      | "student_parent_flow"
      | "communication_contact_issue"
      | "special_product_deliverable_issue"
      | "other"
      | null;
    next_time_recommendation: string | null;
    major_issue: boolean;
  }>;
}

export interface ShootLocationStats {
  avg_rating: number | null;
  on_time_percent: number;
  easy_access_percent: number;
  evaluation_count: number;
  setup_photo_count: number;
}

export interface ShootLocationSummary {
  id: string;
  name: string;
  address: string | null;
  location_details: string | null;
  commentary: string | null;
  custodian_contact: string | null;
  category: ShootLocationCategory;
  navigation_url: string | null;
  latitude: number | null;
  longitude: number | null;
  estimated_drive_minutes: number | null;
  stats: ShootLocationStats;
  photo_count: number;
  area_count: number;
  latest_recommendation: string | null;
  integration: MondayLocationIntegrationState | null;
}

export interface ShootLocationDetail extends ShootLocationSummary {
  photo_gallery: ShootLocationPhoto[];
  areas: ShootLocationArea[];
  evaluations: ShootLocationEvaluation[];
  resource_library: ResourceLibraryView;
  location_memory: {
    status: "active" | "needs_refresh" | "archived";
    last_confirmed_at: string | null;
    last_updated_by: string | null;
    where_to_go: string | null;
    where_to_park: string | null;
    where_to_set_up: string | null;
    top_watch_out: string | null;
    notes: Array<{
      id: string;
      body: string;
      pinned: boolean;
      publication_state: "active" | "proposed";
      created_at: string;
      updated_at: string;
      author_name: string | null;
      can_publish_location_memory: boolean;
    }>;
    setup_photos: ShootLocationPhoto[];
  };
  historical_context?: LocationHistoricalContext | null;
}

export interface LocationMatchCandidate {
  location_id: string;
  name: string;
  address: string | null;
  confidence: number;
  reason: string;
}

export interface LocationComplianceAlert {
  id: string;
  alert_type: string;
  message: string;
  status: string;
  created_at: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
}

export interface ShootLocationIntelligence {
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  shoot_code?: string | null;
  matched_location_id: string | null;
  match_source: "manual" | "shoot" | "event_location" | "fuzzy" | "none";
  confidence: number;
  location: ShootLocationSummary | null;
  recent_evaluations: ShootLocationEvaluation[];
  recent_photos: ShootLocationPhoto[];
  suggestions: LocationMatchCandidate[];
  missing_setup_photo_alert: LocationComplianceAlert | null;
  historical_context?: LocationHistoricalContext | null;
}

export interface LocationPhotographerPerformanceRow {
  photographer_name: string;
  evaluation_count: number;
  avg_rating: number | null;
  on_time_percent: number;
  easy_access_percent: number;
  latest_location_name: string | null;
  latest_shoot_date: string | null;
}

export interface LocationTopRatedRow {
  location_id: string;
  location_name: string;
  address: string | null;
  avg_rating: number | null;
  evaluation_count: number;
  easy_access_percent: number;
  on_time_percent: number;
}

export interface LocationCatalogResponse {
  locations: ShootLocationSummary[];
  cache: {
    fetchedAt: string;
    stale: boolean;
    source: "live" | "stale_cache";
  };
}

export interface EvaluationSubmitInput {
  location_id: string;
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: "Sports" | "Schools";
  on_time: "Yes" | "No";
  easy_access: "Yes" | "No";
  overall_rating: number;
  photos_uploaded: "Yes" | "No";
  late_details?: string | null;
  access_details?: string | null;
  notes?: string | null;
  outreach_notes?: string | null;
  recommendations?: string | null;
  image_quality?: string | null;
}

export interface SetupPhotoUploadInput {
  location_id: string;
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  file_name: string;
  content_type: string;
  data_url: string;
  photo_category?:
    | "arrival_entrance"
    | "parking_load_in"
    | "check_in_flow_area"
    | "room_wide_shot"
    | "final_camera_background_setup"
    | "power_staging_storage"
    | "special_constraint_watch_out"
    | null;
  caption?: string | null;
  promote_to_location_memory?: boolean;
}

export interface ShootLocationLinkInput {
  location_id: string;
  shoot_id?: string | null;
  outlook_event_id?: string | null;
  outlook_calendar_id?: string | null;
  shoot_code?: string | null;
  event_subject?: string | null;
  event_location?: string | null;
}
