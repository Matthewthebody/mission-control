import { apiFetch } from "../api";
import type {
  GearAlertSummary,
  GearAssetDetailView,
  GearAssetListResponse,
  GearDashboardView,
  GearKitDetailView,
  GearKitListResponse,
  GearMonthlyReportView,
  GearServiceRepairSummary,
  GearStatus,
  GearTemporarySubstitutionSummary
} from "../gearTypes";

export async function getGearDashboard(token: string) {
  return apiFetch<GearDashboardView>("/api/gear/dashboard", token);
}

export async function getGearMonthlyReport(token: string, month?: string) {
  const params = new URLSearchParams();
  if (month?.trim()) {
    params.set("month", month.trim());
  }
  const query = params.toString();
  return apiFetch<GearMonthlyReportView>(`/api/gear/reports/monthly${query ? `?${query}` : ""}`, token);
}

export async function listGearAssets(
  token: string,
  filters: {
    search?: string;
    category?: string;
    status?: GearStatus | "all";
    currentCustodianId?: string;
    homeLocationId?: string;
    kitId?: string;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.category && filters.category !== "all") {
    params.set("category", filters.category);
  }
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.currentCustodianId) {
    params.set("current_custodian_id", filters.currentCustodianId);
  }
  if (filters.homeLocationId) {
    params.set("home_location_id", filters.homeLocationId);
  }
  if (filters.kitId) {
    params.set("kit_id", filters.kitId);
  }
  const query = params.toString();
  return apiFetch<GearAssetListResponse>(`/api/gear/assets${query ? `?${query}` : ""}`, token);
}

export async function getGearAssetDetail(token: string, assetId: string) {
  return apiFetch<GearAssetDetailView>(`/api/gear/assets/${assetId}`, token);
}

export async function listGearKits(
  token: string,
  filters: {
    search?: string;
    kitType?: string;
    status?: GearStatus | "all";
    assignedUserId?: string;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.kitType && filters.kitType !== "all") {
    params.set("kit_type", filters.kitType);
  }
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.assignedUserId) {
    params.set("assigned_user_id", filters.assignedUserId);
  }
  const query = params.toString();
  return apiFetch<GearKitListResponse>(`/api/gear/kits${query ? `?${query}` : ""}`, token);
}

export async function getGearKitDetail(token: string, kitId: string) {
  return apiFetch<GearKitDetailView>(`/api/gear/kits/${kitId}`, token);
}

export async function createGearIssueReport(
  token: string,
  payload: {
    targetType: "asset" | "kit";
    targetId: string;
    issueType: string;
    status?: string;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    sourceCheckoutId?: string | null;
    note?: string | null;
  }
) {
  return apiFetch<GearServiceRepairSummary>("/api/gear/service-records", token, {
    method: "POST",
    body: JSON.stringify({
      target_type: payload.targetType,
      target_id: payload.targetId,
      issue_type: payload.issueType,
      status: payload.status,
      linked_shoot_id: payload.linkedShootId ?? null,
      linked_location_id: payload.linkedLocationId ?? null,
      source_checkout_id: payload.sourceCheckoutId ?? null,
      note: payload.note ?? null
    })
  });
}

export async function updateGearIssueReport(
  token: string,
  payload: {
    serviceRecordId: string;
    status?: string;
    note?: string | null;
  }
) {
  return apiFetch<GearServiceRepairSummary>(`/api/gear/service-records/${payload.serviceRecordId}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      status: payload.status,
      note: payload.note ?? null
    })
  });
}

export async function createGearTemporarySubstitution(
  token: string,
  payload: {
    originalAssetId: string;
    substituteAssetId: string;
    assignedUserId?: string | null;
    linkedShootId?: string | null;
    linkedLocationId?: string | null;
    note?: string | null;
    overrideConflict?: boolean;
    overrideReason?: string | null;
  }
) {
  return apiFetch<GearTemporarySubstitutionSummary>("/api/gear/temporary-substitutions", token, {
    method: "POST",
    body: JSON.stringify({
      original_asset_id: payload.originalAssetId,
      substitute_asset_id: payload.substituteAssetId,
      assigned_user_id: payload.assignedUserId ?? null,
      linked_shoot_id: payload.linkedShootId ?? null,
      linked_location_id: payload.linkedLocationId ?? null,
      note: payload.note ?? null,
      override_conflict: payload.overrideConflict ?? false,
      override_reason: payload.overrideReason ?? null
    })
  });
}

export async function endGearTemporarySubstitution(
  token: string,
  payload: {
    substitutionId: string;
    note?: string | null;
  }
) {
  return apiFetch<GearTemporarySubstitutionSummary>(`/api/gear/temporary-substitutions/${payload.substitutionId}/end`, token, {
    method: "POST",
    body: JSON.stringify({
      note: payload.note ?? null
    })
  });
}

export async function resolveGearAlert(
  token: string,
  payload: {
    alertId: string;
    resolutionNote?: string | null;
  }
) {
  return apiFetch<GearAlertSummary>(`/api/gear/alerts/${payload.alertId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify({
      resolution_note: payload.resolutionNote ?? null
    })
  });
}
