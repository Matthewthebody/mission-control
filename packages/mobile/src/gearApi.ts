import { mobileFetch } from "./api";

type GeoInput = {
  latitude?: number | null;
  longitude?: number | null;
};

export type GearResolvedTarget = {
  target_type: "asset" | "kit";
  id: string;
  label: string;
  internal_id: string;
  status: string;
  qr_code_id: string | null;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  current_kit_id: string | null;
  current_custodian_id: string | null;
  last_seen_with_user_id: string | null;
  assigned_user_id: string | null;
  home_location_id: string | null;
};

export type GearScanEventSummary = {
  id: string;
  scanned_at: string;
  scan_action: string;
  qr_code_id: string | null;
  mismatch_detected: boolean;
  override_applied: boolean;
  note: string | null;
};

export type GearKitMembershipItem = {
  membership_id: string;
  asset_id: string;
  asset_name: string;
  category: string;
  required_in_kit: boolean;
  display_order: number | null;
  qr_enabled: boolean;
  status: string;
};

export type GearCheckoutSummary = {
  id: string;
  asset_id: string | null;
  kit_id: string | null;
  checked_out_to_user_id: string;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  status: string;
  reserved_at: string;
  checked_out_at: string | null;
  expected_return_at: string | null;
  returned_at: string | null;
  checkout_note: string | null;
  checked_out_to_user_name?: string | null;
  linked_shoot_title?: string | null;
};

export type GearVerificationItem = {
  id: string;
  expected_asset_id: string | null;
  expected_asset_name: string | null;
  expected_asset_qr_enabled: boolean;
  scanned_asset_id: string | null;
  scanned_asset_name: string | null;
  required_in_kit: boolean;
  display_order: number | null;
  presence_status: "pending" | "present" | "missing" | "unexpected";
  note: string | null;
  confirmed_at: string | null;
};

export type GearVerificationBundle = {
  verification: {
    id: string;
    kit_id: string;
    linked_shoot_id: string | null;
    linked_location_id: string | null;
    status: "in_progress" | "verified_ready" | "verified_with_missing_items";
    all_required_items_present: boolean;
    override_reason: string | null;
    verified_ready_at: string | null;
  };
  items: GearVerificationItem[];
  kit_membership: GearKitMembershipItem[];
  counts: {
    total_items: number;
    required_items: number;
    present_items: number;
    missing_items: number;
    unexpected_items: number;
    pending_items: number;
  };
};

export type GearResolveResponse =
  | {
      status: "resolved";
      warning: null;
      scan_event: GearScanEventSummary;
      target: GearResolvedTarget;
      active_checkout: GearCheckoutSummary | null;
      kit_membership: GearKitMembershipItem[];
    }
  | {
      status: "not_found";
      warning: string;
      scan_event: GearScanEventSummary;
      target: null;
      active_checkout: null;
      kit_membership: never[];
    };

export type GearVerificationScanResponse = {
  status: "confirmed" | "mismatch" | "override_applied";
  warning: string | null;
  override_allowed: boolean;
  scan_event: GearScanEventSummary;
  verification: GearVerificationBundle;
};

export type GearScanCheckoutResponse = {
  status: "checked_out" | "conflict" | "verification_required" | "not_found";
  warning: string | null;
  scan_event: GearScanEventSummary;
  checkout?: GearCheckoutSummary;
  conflict?: GearCheckoutSummary;
  conflict_override_applied?: boolean;
  target?: GearResolvedTarget;
};

export type GearScanReturnResponse = {
  status: "returned" | "not_checked_out" | "not_found";
  warning: string | null;
  scan_event: GearScanEventSummary;
  checkout?: GearCheckoutSummary;
  issue_created?: boolean;
  target?: GearResolvedTarget;
};

export async function resolveGearQr(token: string, payload: { qrCodeId: string; linkedShootId?: string | null } & GeoInput) {
  return mobileFetch<GearResolveResponse>("/api/gear/scan/resolve", token, {
    method: "POST",
    body: JSON.stringify({
      qr_code_id: payload.qrCodeId,
      linked_shoot_id: payload.linkedShootId ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function startGearPreShootVerification(
  token: string,
  payload: { kitId: string; linkedShootId?: string | null } & GeoInput
) {
  return mobileFetch<GearVerificationBundle>(`/api/gear/kits/${payload.kitId}/pre-shoot-verifications`, token, {
    method: "POST",
    body: JSON.stringify({
      linked_shoot_id: payload.linkedShootId ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function confirmGearVerificationItem(
  token: string,
  payload: { verificationId: string; expectedAssetId: string; note?: string | null } & GeoInput
) {
  return mobileFetch<GearVerificationBundle>(`/api/gear/pre-shoot-verifications/${payload.verificationId}/confirm-item`, token, {
    method: "POST",
    body: JSON.stringify({
      expected_asset_id: payload.expectedAssetId,
      note: payload.note ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function scanGearVerificationItem(
  token: string,
  payload: { verificationId: string; qrCodeId: string; note?: string | null; overrideMismatch?: boolean; overrideReason?: string | null } & GeoInput
) {
  return mobileFetch<GearVerificationScanResponse>(`/api/gear/pre-shoot-verifications/${payload.verificationId}/scan-item`, token, {
    method: "POST",
    body: JSON.stringify({
      qr_code_id: payload.qrCodeId,
      note: payload.note ?? null,
      override_mismatch: payload.overrideMismatch ?? false,
      override_reason: payload.overrideReason ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function markGearVerificationItemMissing(
  token: string,
  payload: { verificationId: string; expectedAssetId: string; note?: string | null } & GeoInput
) {
  return mobileFetch<GearVerificationBundle>(`/api/gear/pre-shoot-verifications/${payload.verificationId}/missing-item`, token, {
    method: "POST",
    body: JSON.stringify({
      expected_asset_id: payload.expectedAssetId,
      note: payload.note ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function completeGearPreShootVerification(
  token: string,
  payload: { verificationId: string; note?: string | null; overrideReason?: string | null } & GeoInput
) {
  return mobileFetch<GearVerificationBundle>(`/api/gear/pre-shoot-verifications/${payload.verificationId}/complete`, token, {
    method: "POST",
    body: JSON.stringify({
      note: payload.note ?? null,
      override_reason: payload.overrideReason ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function checkOutGearByQr(
  token: string,
  payload: {
    qrCodeId: string;
    checkedOutToUserId: string;
    linkedShootId?: string | null;
    verificationId?: string | null;
    note?: string | null;
    overrideConflict?: boolean;
    overrideReason?: string | null;
    pickupWorkingOrderConfirmed?: boolean | null;
    pickupIssueType?: string | null;
    pickupIssueNote?: string | null;
  } & GeoInput
) {
  return mobileFetch<GearScanCheckoutResponse>("/api/gear/scan/check-out", token, {
    method: "POST",
    body: JSON.stringify({
      qr_code_id: payload.qrCodeId,
      checked_out_to_user_id: payload.checkedOutToUserId,
      linked_shoot_id: payload.linkedShootId ?? null,
      verification_id: payload.verificationId ?? null,
      note: payload.note ?? null,
      override_conflict: payload.overrideConflict ?? false,
      override_reason: payload.overrideReason ?? null,
      pickup_working_order_confirmed: payload.pickupWorkingOrderConfirmed ?? null,
      pickup_issue_type: payload.pickupIssueType ?? null,
      pickup_issue_note: payload.pickupIssueNote ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export async function returnGearViaQr(
  token: string,
  payload: { qrCodeId: string; workingOrderConfirmed: boolean; issueType?: string | null; note?: string | null } & GeoInput
) {
  return mobileFetch<GearScanReturnResponse>("/api/gear/scan/return", token, {
    method: "POST",
    body: JSON.stringify({
      qr_code_id: payload.qrCodeId,
      working_order_confirmed: payload.workingOrderConfirmed,
      issue_type: payload.issueType ?? null,
      note: payload.note ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null
    })
  });
}

export function humanizeGearError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (/status code 403/i.test(message) || /forbidden/i.test(message)) {
    return "Only leadership and assistant managers can complete official gear custody actions.";
  }
  if (/status code 404/i.test(message)) {
    return "Mission Control could not match that QR code to a tracked Asset or Kit.";
  }
  if (/status code 409/i.test(message)) {
    return "Mission Control found a custody or verification conflict that needs review before continuing.";
  }
  return message;
}
