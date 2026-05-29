import type {
  GearAlertResolutionType,
  GearAlertStatus,
  GearAlertType,
  GearCustodyEventType,
  GearPreShootVerificationStatus,
  GearServiceRepairIssueType,
  GearServiceRepairStatus,
  GearStatus
} from "./gear.js";

export type GearInventoryTargetType = "asset" | "kit";

export type GearInventoryPersonOption = {
  id: string;
  full_name: string;
};

export type GearInventoryLocationOption = {
  id: string;
  name: string;
};

export type GearInventoryKitOption = {
  id: string;
  label: string;
};

export type GearInventoryQueueItem = {
  target_type: GearInventoryTargetType;
  target_id: string;
  label: string;
  status: GearStatus;
  alert_id?: string | null;
  alert_type?: GearAlertType | null;
  current_custodian_name: string | null;
  last_seen_with_name: string | null;
  linked_shoot_title: string | null;
  linked_location_name?: string | null;
  expected_return_at: string | null;
  event_at?: string | null;
  last_scanned_at?: string | null;
  last_scanned_by_name?: string | null;
  note: string | null;
};

export type GearDashboardSummary = {
  total_assets: number;
  total_kits: number;
  available: number;
  assigned: number;
  checked_out: number;
  in_office: number;
  in_transit: number;
  needs_repair: number;
  under_repair: number;
  missing: number;
  overdue_returns: number;
  recently_returned: number;
  tile_tracker_attention: number;
};

export type GearDashboardView = {
  summary: GearDashboardSummary;
  checked_out_now: GearInventoryQueueItem[];
  repair_queue: GearInventoryQueueItem[];
  missing_gear: GearInventoryQueueItem[];
  overdue_returns: GearInventoryQueueItem[];
  recently_returned: GearInventoryQueueItem[];
  tile_attention: GearInventoryQueueItem[];
};

export type GearInventoryListFilters = {
  categories: string[];
  kit_types: string[];
  custodians: GearInventoryPersonOption[];
  assigned_users: GearInventoryPersonOption[];
  home_locations: GearInventoryLocationOption[];
  kits: GearInventoryKitOption[];
};

export type GearAssetListItem = {
  id: string;
  internal_asset_id: string;
  asset_name: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  qr_code_id: string | null;
  tile_tracker_id: string | null;
  tile_tracker_active: boolean | null;
  status: GearStatus;
  home_location_id: string | null;
  home_location_name: string | null;
  current_kit_id: string | null;
  current_kit_name: string | null;
  current_custodian_id: string | null;
  current_custodian_name: string | null;
  last_seen_with_user_id: string | null;
  last_seen_with_name: string | null;
  active_checkout_id: string | null;
  active_checkout_status: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  expected_return_at: string | null;
  overdue_return: boolean;
  last_scanned_at?: string | null;
  last_scanned_by_name?: string | null;
  open_service_count: number;
  notes: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

export type GearAssetListResponse = {
  assets: GearAssetListItem[];
  filters: Pick<GearInventoryListFilters, "categories" | "custodians" | "home_locations" | "kits">;
};

export type GearKitListItem = {
  id: string;
  kit_name: string;
  kit_type: string;
  internal_kit_id: string;
  qr_code_id: string | null;
  tile_tracker_id: string | null;
  status: GearStatus;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assignment_started_at: string | null;
  assignment_note: string | null;
  current_custodian_id: string | null;
  current_custodian_name: string | null;
  last_seen_with_user_id: string | null;
  last_seen_with_name: string | null;
  home_location_id: string | null;
  home_location_name: string | null;
  active_checkout_id: string | null;
  active_checkout_status: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  expected_return_at: string | null;
  overdue_return: boolean;
  last_scanned_at?: string | null;
  last_scanned_by_name?: string | null;
  open_service_count: number;
  asset_count: number;
  required_asset_count: number;
  notes: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

export type GearKitListResponse = {
  kits: GearKitListItem[];
  filters: Pick<GearInventoryListFilters, "kit_types" | "assigned_users">;
};

export type GearServiceRepairSummary = {
  id: string;
  issue_type: GearServiceRepairIssueType;
  status: GearServiceRepairStatus;
  reported_by_name: string;
  opened_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  source_checkout_id: string | null;
  source_surface: string | null;
  note: string | null;
  updated_at: string;
};

export type GearTemporarySubstitutionSummary = {
  id: string;
  original_asset_id: string;
  original_asset_name: string;
  original_asset_internal_id: string;
  substitute_asset_id: string;
  substitute_asset_name: string;
  substitute_asset_internal_id: string;
  assigned_user_id: string;
  assigned_user_name: string;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  substitute_checkout_id: string | null;
  status: "active" | "ended";
  starts_at: string;
  ends_at: string | null;
  note: string | null;
  created_by_name: string;
  ended_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type GearCustodyHistoryEntry = {
  id: string;
  event_type: GearCustodyEventType;
  timestamp: string;
  from_user_name: string | null;
  to_user_name: string | null;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  note: string | null;
  created_by_name: string;
};

export type GearActiveCheckoutSummary = {
  id: string;
  status: string;
  checked_out_to_user_id: string;
  checked_out_to_user_name: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  reserved_at: string;
  checked_out_at: string | null;
  expected_return_at: string | null;
  checkout_note: string | null;
};

export type GearAssetDetailView = {
  asset: GearAssetListItem;
  active_checkout: GearActiveCheckoutSummary | null;
  open_alerts?: GearAlertSummary[];
  service_records: GearServiceRepairSummary[];
  temporary_substitutions: GearTemporarySubstitutionSummary[];
  custody_history: GearCustodyHistoryEntry[];
};

export type GearKitContentsItem = {
  membership_id: string;
  asset_id: string;
  internal_asset_id: string;
  asset_name: string;
  category: string;
  serial_number: string | null;
  qr_code_id: string | null;
  tile_tracker_id: string | null;
  tile_tracker_active: boolean | null;
  status: GearStatus;
  required_in_kit: boolean;
  display_order: number | null;
  current_custodian_name: string | null;
  last_seen_with_name: string | null;
  open_service_count: number;
};

export type GearLatestVerificationSummary = {
  id: string;
  status: GearPreShootVerificationStatus;
  verified_by_name: string;
  linked_shoot_title: string | null;
  verified_ready_at: string | null;
  created_at: string;
};

export type GearKitDetailView = {
  kit: GearKitListItem;
  active_checkout: GearActiveCheckoutSummary | null;
  contents: GearKitContentsItem[];
  latest_pre_shoot_verification: GearLatestVerificationSummary | null;
  open_alerts?: GearAlertSummary[];
  service_records: GearServiceRepairSummary[];
  temporary_substitutions: GearTemporarySubstitutionSummary[];
  custody_history: GearCustodyHistoryEntry[];
};

export type GearAlertSummary = {
  id: string;
  alert_type: GearAlertType;
  status: GearAlertStatus;
  checkout_id: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  first_triggered_at: string;
  last_triggered_at: string;
  due_at: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_type: GearAlertResolutionType | null;
  resolution_note: string | null;
};

export type GearMonthlyReportSummary = {
  missing_items: number;
  overdue_returns: number;
  unresolved_repairs: number;
  missing_over_30_days: number;
  current_custody: number;
  recent_custody_activity: number;
  recent_scan_activity: number;
  tile_attention_items: number;
};

export type GearMonthlyReportItem = {
  target_type: GearInventoryTargetType;
  target_id: string;
  label: string;
  status: GearStatus;
  current_custodian_name: string | null;
  last_seen_with_name: string | null;
  linked_shoot_id: string | null;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  due_at: string | null;
  event_at: string | null;
  last_scanned_at: string | null;
  last_scanned_by_name: string | null;
  note: string | null;
};

export type GearCustodyReportItem = {
  target_type: GearInventoryTargetType;
  target_id: string;
  label: string;
  status: GearStatus;
  checkout_status: string;
  current_custodian_name: string | null;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  reserved_at: string;
  checked_out_at: string | null;
  expected_return_at: string | null;
  last_scanned_at: string | null;
  last_scanned_by_name: string | null;
  note: string | null;
};

export type GearCustodyActivityItem = {
  target_type: GearInventoryTargetType;
  target_id: string;
  label: string;
  event_type: GearCustodyEventType;
  occurred_at: string;
  to_user_name: string | null;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  note: string | null;
};

export type GearScanActivityItem = {
  id: string;
  target_type: GearInventoryTargetType;
  target_id: string;
  label: string;
  scan_action: string;
  scanned_at: string;
  scanned_by_name: string;
  linked_shoot_title: string | null;
  linked_location_name: string | null;
  mismatch_detected: boolean;
  override_applied: boolean;
  note: string | null;
};

export type GearMonthlyReportView = {
  month: string;
  period_start: string;
  period_end: string;
  summary: GearMonthlyReportSummary;
  missing_items: GearMonthlyReportItem[];
  overdue_returns: GearMonthlyReportItem[];
  unresolved_repairs: GearServiceRepairSummary[];
  missing_over_30_days: GearMonthlyReportItem[];
  current_custody: GearCustodyReportItem[];
  recent_custody_activity: GearCustodyActivityItem[];
  recent_scan_activity: GearScanActivityItem[];
  tile_attention: GearInventoryQueueItem[];
};
