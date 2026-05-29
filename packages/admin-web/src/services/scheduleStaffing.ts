import { apiFetch } from "../api";
import type {
  OperationalApprovalRequestSummary,
  ShootStaffingSnapshot,
  StaffingDashboardResponse
} from "../types";

export type StaffingApprovalRequiredResponse = {
  approval_required: true;
  approval_request: OperationalApprovalRequestSummary;
  snapshot: ShootStaffingSnapshot;
};

export type StaffingMutationResponse = ShootStaffingSnapshot | StaffingApprovalRequiredResponse;

export async function getStaffingDashboard(token: string, anchorDate: string) {
  return apiFetch<StaffingDashboardResponse>(`/api/schedule/staffing-dashboard?anchor_date=${anchorDate}`, token);
}

export async function getShootStaffingSnapshot(token: string, shootId: string) {
  return apiFetch<ShootStaffingSnapshot>(`/api/schedule/shoots/${shootId}/staffing`, token);
}

export async function assignShootStaffingSlot(
  token: string,
  shootId: string,
  input: { slot_key: string; assigned_user_id: string; override_conflict?: boolean; approval_reason?: string }
) {
  return apiFetch<StaffingMutationResponse>(`/api/schedule/shoots/${shootId}/staffing/assign`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function removeShootStaffingAssignment(
  token: string,
  shootId: string,
  input: { slot_key: string; approval_reason?: string }
) {
  return apiFetch<StaffingMutationResponse>(`/api/schedule/shoots/${shootId}/staffing/remove`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function publishShootStaffing(
  token: string,
  shootId: string,
  input: { override_warnings?: boolean; approval_reason?: string } = {}
) {
  return apiFetch<StaffingMutationResponse>(`/api/schedule/shoots/${shootId}/staffing/publish`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
