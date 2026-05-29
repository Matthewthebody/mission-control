export type GearStatus =
  | "available"
  | "assigned"
  | "checked_out"
  | "in_transit"
  | "in_office"
  | "needs_repair"
  | "under_repair"
  | "missing"
  | "retired";

export type GearCustodyEventType =
  | "assigned"
  | "unassigned"
  | "checked_out"
  | "returned"
  | "scanned"
  | "moved"
  | "custody_transferred"
  | "home_location_updated"
  | "current_custodian_updated"
  | "last_seen_with_updated"
  | "pre_shoot_verification"
  | "temporary_substitution_started"
  | "temporary_substitution_ended"
  | "overdue_return_flagged"
  | "missing_gear_alerted"
  | "tile_tracker_linked"
  | "tile_tracker_unlinked";

export type GearServiceRepairIssueType =
  | "broken"
  | "damage"
  | "missing"
  | "missing_part"
  | "not_working"
  | "tile_inactive"
  | "needs_repair"
  | "tracker_issue"
  | "battery_issue"
  | "routine_service"
  | "cleaning"
  | "other";

export type GearServiceRepairStatus = "open" | "under_review" | "in_service" | "resolved" | "closed";
export type GearCheckoutStatus = "assigned" | "checked_out" | "returned" | "cancelled" | "overridden";
export type GearReturnConditionStatus = "working_order_confirmed" | "issues_reported";
export type GearTemporarySubstitutionStatus = "active" | "ended";
export type GearAlertType = "overdue_return" | "missing_gear";
export type GearAlertStatus = "open" | "resolved";
export type GearAlertResolutionType = "returned" | "manual_resolution" | "status_cleared";
export type GearScanAction =
  | "open_asset_detail"
  | "open_kit_detail"
  | "check_out"
  | "return"
  | "pre_shoot_verification"
  | "confirm_contents_presence"
  | "log_missing_item";
export type GearPreShootVerificationStatus = "in_progress" | "verified_ready" | "verified_with_missing_items";
export type GearVerificationItemPresenceStatus = "pending" | "present" | "missing" | "unexpected";

export type GearAsset = {
  id: string;
  tenant_id: string;
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
  current_kit_id: string | null;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
  notes: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

export type GearKit = {
  id: string;
  tenant_id: string;
  kit_name: string;
  kit_type: string;
  internal_kit_id: string;
  qr_code_id: string | null;
  tile_tracker_id: string | null;
  assigned_user_id: string | null;
  assignment_started_at: string | null;
  assignment_note: string | null;
  home_location_id: string | null;
  status: GearStatus;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
  notes: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

export type GearKitAssetMembership = {
  id: string;
  tenant_id: string;
  kit_id: string;
  asset_id: string;
  required_in_kit: boolean;
  display_order: number | null;
  created_at: string;
  updated_at: string;
};

export type GearHomeLocation = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
};

export type GearCustodyEvent = {
  id: string;
  tenant_id: string;
  asset_id: string | null;
  kit_id: string | null;
  event_type: GearCustodyEventType;
  from_user_id: string | null;
  to_user_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type GearServiceRepairRecord = {
  id: string;
  tenant_id: string;
  asset_id: string | null;
  kit_id: string | null;
  issue_type: GearServiceRepairIssueType;
  status: GearServiceRepairStatus;
  reported_by: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  source_checkout_id: string | null;
  source_surface: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
  updated_at: string;
};

export type GearTemporarySubstitution = {
  id: string;
  tenant_id: string;
  original_asset_id: string;
  substitute_asset_id: string;
  assigned_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  substitute_checkout_id: string | null;
  status: GearTemporarySubstitutionStatus;
  starts_at: string;
  ends_at: string | null;
  note: string | null;
  created_by: string;
  ended_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GearCheckoutRecord = {
  id: string;
  tenant_id: string;
  asset_id: string | null;
  kit_id: string | null;
  checked_out_to_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  status: GearCheckoutStatus;
  reserved_at: string;
  checked_out_at: string | null;
  expected_return_at: string | null;
  returned_at: string | null;
  checkout_note: string | null;
  return_condition_status: GearReturnConditionStatus | null;
  return_note: string | null;
  override_reason: string | null;
  override_by_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type GearScanEvent = {
  id: string;
  tenant_id: string;
  asset_id: string | null;
  kit_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  linked_pre_shoot_verification_id: string | null;
  qr_code_id: string | null;
  scan_action: GearScanAction;
  scanned_by_user_id: string;
  latitude: number | null;
  longitude: number | null;
  mismatch_detected: boolean;
  override_applied: boolean;
  note: string | null;
  scanned_at: string;
  created_at: string;
};

export type GearPreShootVerification = {
  id: string;
  tenant_id: string;
  kit_id: string;
  verified_by_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  status: GearPreShootVerificationStatus;
  all_required_items_present: boolean;
  override_reason: string | null;
  verified_ready_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GearPreShootVerificationItem = {
  id: string;
  tenant_id: string;
  verification_id: string;
  expected_asset_id: string | null;
  scanned_asset_id: string | null;
  required_in_kit: boolean;
  display_order: number | null;
  presence_status: GearVerificationItemPresenceStatus;
  note: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GearAlert = {
  id: string;
  tenant_id: string;
  alert_type: GearAlertType;
  status: GearAlertStatus;
  asset_id: string | null;
  kit_id: string | null;
  checkout_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  first_triggered_at: string;
  last_triggered_at: string;
  due_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_type: GearAlertResolutionType | null;
  resolution_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
