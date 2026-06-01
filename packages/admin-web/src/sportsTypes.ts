export const SPORTS_SHOOT_STATUSES = [
  "draft",
  "intake_blocked",
  "pending_confirmation",
  "confirmed",
  "ready_to_staff",
  "staffed",
  "ready_to_shoot",
  "in_progress",
  "shot_complete",
  "postponed",
  "weather_hold",
  "cancelled"
] as const;

export const SPORTS_PRODUCTION_STATUSES = [
  "not_created",
  "queued",
  "awaiting_ingest",
  "ingest_complete",
  "editing",
  "proof_build",
  "proof_sent",
  "awaiting_client_approval",
  "revisions_requested",
  "approved_for_production",
  "ordered_or_printed",
  "packaged",
  "delivered",
  "complete",
  "blocked"
] as const;

export const SPORTS_PROOF_STATUSES = [
  "not_required",
  "not_started",
  "building",
  "sent",
  "viewed",
  "revisions_requested",
  "approved",
  "overdue"
] as const;

export const SPORTS_STAFFING_STATUSES = ["unassigned", "partially_staffed", "staffed", "checked_in", "ready_confirmed", "gap_flagged"] as const;
export const SPORTS_READINESS_STATUSES = ["off_track", "at_risk", "on_track", "ready"] as const;
export const SPORTS_SYNC_STATUSES = ["clean", "pending", "warning", "error"] as const;
export const SPORTS_RISK_STATUSES = ["none", "low", "medium", "high", "critical"] as const;
export const SPORTS_WATCH_FLAG_STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;

export type SportsShootStatus = (typeof SPORTS_SHOOT_STATUSES)[number];
export type SportsProductionStatus = (typeof SPORTS_PRODUCTION_STATUSES)[number];
export type SportsProofStatus = (typeof SPORTS_PROOF_STATUSES)[number];
export type SportsStaffingStatus = (typeof SPORTS_STAFFING_STATUSES)[number];
export type SportsReadinessStatus = (typeof SPORTS_READINESS_STATUSES)[number];
export type SportsSyncStatus = (typeof SPORTS_SYNC_STATUSES)[number];
export type SportsRiskStatus = (typeof SPORTS_RISK_STATUSES)[number];
export type SportsWatchFlagStatus = (typeof SPORTS_WATCH_FLAG_STATUSES)[number];

export type SportsShootListFilters = {
  search?: string | null;
  view?: "list" | "calendar" | "kanban" | "timeline" | null;
  date_from?: string | null;
  date_to?: string | null;
  organization_id?: string | null;
  sport_type?: string | null;
  season?: string | null;
  shoot_status?: SportsShootStatus | null;
  production_status?: SportsProductionStatus | null;
  proof_status?: SportsProofStatus | null;
  staffing_status?: SportsStaffingStatus | null;
  readiness_status?: SportsReadinessStatus | null;
  risk_status?: SportsRiskStatus | null;
  lead_photographer_user_id?: string | null;
  account_owner_user_id?: string | null;
  location_id?: string | null;
  proof_required?: boolean | null;
  revenue_share_enabled?: boolean | null;
  banner_work_required?: boolean | null;
  saved_view?: string | null;
};

export type SportsPermissionSnapshot = {
  can_manage_department: boolean;
  can_edit_shoots: boolean;
  can_manage_staffing: boolean;
  can_manage_production: boolean;
  can_manage_finance: boolean;
  can_view_finance_detail: boolean;
  can_manage_settings: boolean;
  can_publish_imports: boolean;
  can_override_duplicates: boolean;
  can_confirm_ready: boolean;
};

export type SportsKpiCard = {
  key: string;
  label: string;
  value: number;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  action_hash: string;
  detail: string;
};

export type SportsOverviewListItem = {
  id: string;
  title: string;
  summary: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  action_hash: string;
  shoot_id?: string | null;
  organization_id?: string | null;
  due_at?: string | null;
  meta?: string | null;
};

export type SportsOverviewResponse = {
  generated_at: string;
  anchor_start: string;
  anchor_end: string;
  permissions: SportsPermissionSnapshot;
  saved_views: Array<{ key: string; label: string; hash: string }>;
  kpis: SportsKpiCard[];
  urgent_watch: SportsOverviewListItem[];
  upcoming_shoots: SportsOverviewListItem[];
  staffing_readiness: SportsOverviewListItem[];
  ready_pings: SportsOverviewListItem[];
  production_bottlenecks: SportsOverviewListItem[];
  proof_and_products: SportsOverviewListItem[];
  account_health: SportsOverviewListItem[];
  recent_activity: SportsOverviewListItem[];
};

export type SportsShootSummary = {
  id: string;
  job_number: string | null;
  shoot_code: string;
  title: string;
  event_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  account_owner_user_id: string | null;
  account_owner_name: string | null;
  lead_photographer_user_id: string | null;
  lead_photographer_name: string | null;
  shoot_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  sport_type: string | null;
  season: string | null;
  league_name: string | null;
  division: string | null;
  team_structure: string | null;
  estimated_team_count: number | null;
  estimated_subject_count: number | null;
  proof_required: boolean;
  proof_due_date: string | null;
  revenue_share_enabled: boolean;
  banner_work_required: boolean;
  specialty_products_enabled: boolean;
  shoot_status: SportsShootStatus;
  production_status: SportsProductionStatus;
  proof_status: SportsProofStatus;
  staffing_status: SportsStaffingStatus;
  readiness_status: SportsReadinessStatus;
  sync_status: SportsSyncStatus;
  risk_status: SportsRiskStatus;
  watch_flag_count: number;
  blocker_count: number;
  overdue_proof_count: number;
  production_item_count: number;
  specialty_due_count: number;
  staffing_counts: {
    scheduled: number;
    minimum: number;
    missing_staffing: number;
    waiting_on_approval: number;
    production_blocked: number;
    ready_to_shoot: number;
  };
  last_updated_at: string;
};

export type SportsShootListResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  filters: SportsShootListFilters;
  saved_views: Array<{ key: string; label: string; hash: string }>;
  summary: {
    total: number;
    at_risk: number;
    ready_to_shoot: number;
    missing_staffing: number;
    waiting_on_approval: number;
    production_blocked: number;
  };
  items: SportsShootSummary[];
};

export type SportsReadinessChecklistItemRecord = {
  id: string;
  shoot_id: string;
  section: string;
  code: string;
  label: string;
  is_required: boolean;
  is_blocker: boolean;
  is_complete: boolean;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_name: string | null;
  notes: string | null;
  sort_order: number;
};

export type SportsTeamUnitRecord = {
  id: string;
  shoot_id: string;
  team_name: string;
  display_order: number;
  age_group: string | null;
  division: string | null;
  coach_contact_id: string | null;
  coach_contact_name: string | null;
  proof_owner_contact_id: string | null;
  proof_owner_contact_name: string | null;
  scheduled_slot_start: string | null;
  scheduled_slot_end: string | null;
  estimated_subject_count: number | null;
  actual_subject_count: number | null;
  banner_required: boolean;
  specialty_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type SportsProductionItemSummary = {
  id: string;
  linked_shoot_id: string;
  title: string;
  production_type: string;
  status: SportsProductionStatus;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  due_date: string | null;
  delivery_deadline: string | null;
  proof_required: boolean;
  approval_required: boolean;
  file_count_expected: number | null;
  file_count_received: number | null;
  vendor_name: string | null;
  qa_status: string | null;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SportsProofCycleRecord = {
  id: string;
  shoot_id: string;
  production_item_id: string | null;
  production_item_title: string | null;
  team_unit_id: string | null;
  team_unit_name: string | null;
  approver_contact_id: string | null;
  approver_contact_name: string | null;
  status: SportsProofStatus;
  sent_at: string | null;
  viewed_at: string | null;
  approved_at: string | null;
  revision_count: number;
  due_date: string | null;
  last_follow_up_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SportsSpecialtyProductItemRecord = {
  id: string;
  shoot_id: string;
  production_item_id: string | null;
  production_item_title: string | null;
  team_unit_id: string | null;
  team_unit_name: string | null;
  product_type: string;
  title: string;
  quantity: number;
  status: string;
  approval_required: boolean;
  approved_at: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  vendor_name: string | null;
  due_date: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SportsFinancialSummaryRecord = {
  id: string;
  shoot_id: string;
  pricing_profile_name: string | null;
  invoice_number: string | null;
  invoice_status: string;
  invoice_due_date: string | null;
  revenue_share_enabled: boolean;
  revenue_share_terms_summary: string | null;
  estimated_revenue: number | null;
  actual_revenue: number | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  payout_amount: number | null;
  payment_status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SportsWatchFlagRecord = {
  id: string;
  shoot_id: string;
  shoot_title: string | null;
  organization_id: string | null;
  organization_name: string | null;
  severity: string;
  flag_type: string;
  title: string;
  description: string | null;
  status: SportsWatchFlagStatus;
  owner_user_id: string | null;
  owner_name: string | null;
  due_at: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type SportsStaffingPersonRecord = {
  shift_id: string;
  user_id: string | null;
  user_name: string | null;
  role_on_job: string | null;
  assignment_status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  ready_confirmed_at: string | null;
  notes: string | null;
};

export type SportsActivityEntry = {
  id: string;
  source: "shoot_activity_log" | "audit_log";
  event_type: string;
  summary: string;
  actor_user_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type SportsShootDetailResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  summary: SportsShootSummary;
  client_snapshot: {
    organization_name: string | null;
    primary_contact_name: string | null;
    approval_contact_name: string | null;
    billing_contact_name: string | null;
    location_name: string | null;
  };
  notes: {
    internal_notes: string | null;
    client_notes: string | null;
    special_instructions: string | null;
    event_notes: string | null;
    setup_notes: string | null;
    travel_notes: string | null;
    parking_notes: string | null;
    access_notes: string | null;
    client_expectations_notes: string | null;
  };
  readiness: {
    status: SportsReadinessStatus;
    percent_complete: number;
    blocker_count: number;
    warning_count: number;
    items: SportsReadinessChecklistItemRecord[];
  };
  job_days: Array<{
    id: string;
    day_index: number;
    shoot_date: string;
    start_time: string | null;
    end_time: string | null;
    timezone: string;
    location_id: string | null;
    location_name: string | null;
    status: string | null;
  }>;
  staffing: {
    status: SportsStaffingStatus;
    assigned_count: number;
    required_count: number;
    lead_photographer_user_id: string | null;
    lead_photographer_name: string | null;
    lead_ready: {
      confirmed: boolean;
      confirmed_at: string | null;
      confirmed_by_name: string | null;
      exception_flag: boolean;
      available: boolean;
    };
    people: SportsStaffingPersonRecord[];
  };
  teams: SportsTeamUnitRecord[];
  production_items: SportsProductionItemSummary[];
  proof_cycles: SportsProofCycleRecord[];
  specialty_products: SportsSpecialtyProductItemRecord[];
  watch_flags: SportsWatchFlagRecord[];
  financial_summary: SportsFinancialSummaryRecord | null;
  activity: SportsActivityEntry[];
  linked_context: {
    organization_history_hash: string | null;
    location_history_hash: string | null;
    contact_history_hash: string | null;
    production_hash: string | null;
  };
};

export type SportsAccountSummary = {
  id: string;
  organization_name: string;
  account_type: string;
  account_owner_name: string | null;
  health_status: SportsRiskStatus | "healthy" | "watch";
  active_seasons: string[];
  active_shoots_count: number;
  next_shoot_date: string | null;
  open_issues: number;
  revenue_share_enabled: boolean;
  contract_or_pricing_flag: boolean;
  last_touchpoint: string | null;
  last_production_turnaround_summary: string | null;
};

export type SportsAccountDetailResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  account: SportsAccountSummary & {
    notes: string | null;
    linked_organization_hash: string;
  };
  contacts: Array<{
    id: string;
    full_name: string;
    title: string | null;
    role_category: string | null;
    email: string | null;
    phone: string | null;
    approval_owner: boolean;
    billing_contact: boolean;
  }>;
  linked_locations: Array<{ id: string; name: string; address: string | null }>;
  past_shoots: SportsShootSummary[];
  upcoming_shoots: SportsShootSummary[];
  open_escalations: SportsWatchFlagRecord[];
};

export type SportsContactSummary = {
  id: string;
  full_name: string;
  organization_id: string;
  organization_name: string;
  role: string | null;
  preferred_contact_method: string | null;
  phone: string | null;
  email: string | null;
  contact_type: string | null;
  active_shoot_count: number;
  last_interaction: string | null;
  approval_owner: boolean;
  billing_contact: boolean;
};

export type SportsContactsResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  items: SportsContactSummary[];
};

export type SportsProductionResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  summary: {
    total: number;
    proof_queue: number;
    specialty_products: number;
    qa_review: number;
    blocked: number;
  };
  items: SportsProductionItemSummary[];
  proof_cycles: SportsProofCycleRecord[];
  specialty_products: SportsSpecialtyProductItemRecord[];
};

export const SPORTS_PEER_QA_STATUSES = [
  "ready_for_owner_qa",
  "owner_qa_in_progress",
  "ready_for_peer_qa",
  "peer_qa_in_progress",
  "corrections_needed",
  "corrections_complete",
  "ready_for_spencer_review",
  "blocked_waiting",
  "approved_for_release",
  "released_complete"
] as const;

export type SportsPeerQaStatus = (typeof SPORTS_PEER_QA_STATUSES)[number];

export type SportsPeerQaChecklistItem = {
  label: string;
  complete: boolean;
  applies?: boolean;
};

export type SportsPeerQaJob = {
  id: string;
  production_item_id: string;
  linked_shoot_id: string | null;
  job_id: string;
  job_name: string;
  organization_id: string | null;
  organization_name: string | null;
  shoot_date: string | null;
  qa_status: SportsPeerQaStatus;
  sports_job_type: string;
  owner_user_id: string | null;
  owner_name: string | null;
  peer_reviewer_user_id: string | null;
  peer_reviewer_name: string | null;
  final_reviewer_user_id: string | null;
  final_reviewer_name: string | null;
  blocker_reason: string | null;
  blocker_owner: string | null;
  blocker_notes: string | null;
  correction_category: string | null;
  correction_notes: string | null;
  known_exceptions: string | null;
  owner_checklist: SportsPeerQaChecklistItem[];
  peer_checklist: SportsPeerQaChecklistItem[];
  conditional_checklist: SportsPeerQaChecklistItem[];
  release_packet: {
    owner_qa_complete: boolean;
    peer_qa_complete: boolean;
    corrections_resolved: boolean;
    spencer_review_complete: boolean;
    price_sheet_confirmed: boolean;
    team_images_confirmed: boolean;
    individual_galleries_confirmed: boolean;
    buddy_photos_complete: boolean | null;
    virtual_teams_complete: boolean | null;
    known_exceptions_documented: boolean;
    approved_for_release: boolean;
  };
  approved_for_release_at: string | null;
  last_updated_at: string;
};

export type SportsPeerQaBoardResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  summary: Record<SportsPeerQaStatus, number> & {
    total: number;
    blocked: number;
  };
  items: SportsPeerQaJob[];
};

export type SportsPeerQaUpdateInput = {
  qa_status?: SportsPeerQaStatus;
  correction_category?: string | null;
  correction_notes?: string | null;
  blocker_reason?: string | null;
  blocker_owner?: string | null;
  blocker_notes?: string | null;
};

export type SportsPeerQaChecklistSection = "owner" | "peer" | "conditional";

export type SportsPeerQaChecklistUpdateInput = {
  section: SportsPeerQaChecklistSection;
  label: string;
  complete: boolean;
};

export type SportsPeerQaApprovalInput = {
  approved_by?: string | null;
};

export type SportsWatchlistResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  summary: {
    next_24_hours: number;
    missing_staffing: number;
    missing_critical_info: number;
    blocked_production: number;
    overdue_approvals: number;
    overdue_delivery: number;
    open_escalations: number;
    sync_errors: number;
  };
  items: SportsWatchFlagRecord[];
};

export type SportsReportsResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  starter_metrics: Array<{ key: string; label: string; value: number | null; detail: string }>;
};

export type SportsSettingsResponse = {
  generated_at: string;
  permissions: SportsPermissionSnapshot;
  checklist_templates: Array<{
    sports_job_type: string;
    section: string;
    items: Array<{
      code: string;
      label: string;
      is_required: boolean;
      is_blocker: boolean;
      sort_order: number;
    }>;
  }>;
  product_type_presets: string[];
  saved_view_keys: string[];
  watch_flag_thresholds: Array<{ key: string; label: string; hours: number }>;
  role_visibility_notes: string[];
};

export type SportsReadinessUpdateInput = {
  is_complete?: boolean;
  notes?: string | null;
};

export type SportsTeamUnitInput = {
  team_name: string;
  display_order?: number | null;
  age_group?: string | null;
  division?: string | null;
  coach_contact_id?: string | null;
  proof_owner_contact_id?: string | null;
  scheduled_slot_start?: string | null;
  scheduled_slot_end?: string | null;
  estimated_subject_count?: number | null;
  actual_subject_count?: number | null;
  banner_required?: boolean | null;
  specialty_notes?: string | null;
  status?: string | null;
};

export type SportsWatchFlagInput = {
  severity?: string | null;
  flag_type?: string | null;
  title?: string | null;
  description?: string | null;
  status?: SportsWatchFlagStatus | null;
  owner_user_id?: string | null;
  due_at?: string | null;
};

export type SportsProofCycleInput = {
  production_item_id?: string | null;
  team_unit_id?: string | null;
  approver_contact_id?: string | null;
  status?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  approved_at?: string | null;
  revision_count?: number | null;
  due_date?: string | null;
  last_follow_up_at?: string | null;
  notes?: string | null;
};

export type SportsProductItemInput = {
  production_item_id?: string | null;
  team_unit_id?: string | null;
  product_type: string;
  title: string;
  quantity?: number | null;
  status?: string | null;
  approval_required?: boolean | null;
  approved_at?: string | null;
  assigned_to_user_id?: string | null;
  vendor_name?: string | null;
  due_date?: string | null;
  delivered_at?: string | null;
  notes?: string | null;
};

export type SportsFinancialSummaryInput = {
  pricing_profile_name?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_due_date?: string | null;
  revenue_share_enabled?: boolean | null;
  revenue_share_terms_summary?: string | null;
  estimated_revenue?: number | null;
  actual_revenue?: number | null;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  payout_amount?: number | null;
  payment_status?: string | null;
  notes?: string | null;
};
