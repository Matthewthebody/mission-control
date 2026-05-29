import { apiFetch } from "../api";
import type {
  AdminSettingChangeInput,
  AdminSettingPreview,
  AdminSettingPreviewInput,
  AdminSettingsWorkspace,
  AdminSettingValueRecord
} from "../adminSettingsTypes";

export function getAdminSettingsWorkspace(token: string) {
  return apiFetch<AdminSettingsWorkspace>("/api/admin/settings/overview", token);
}

export function previewAdminSettingChange(token: string, input: AdminSettingPreviewInput) {
  return apiFetch<AdminSettingPreview>("/api/admin/settings/preview", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createAdminSettingChange(token: string, input: AdminSettingChangeInput) {
  return apiFetch<{ change: AdminSettingValueRecord; preview: AdminSettingPreview }>("/api/admin/settings/values", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function approveAdminSettingChange(token: string, id: string, note?: string) {
  return apiFetch<AdminSettingValueRecord>(`/api/admin/settings/${id}/approve`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function rejectAdminSettingChange(token: string, id: string, note?: string) {
  return apiFetch<AdminSettingValueRecord>(`/api/admin/settings/${id}/reject`, token, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}
