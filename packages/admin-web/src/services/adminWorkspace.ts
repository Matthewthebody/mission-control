import { apiFetch } from "../api";

export type AdminWorkspaceTone = "neutral" | "info" | "success" | "warning" | "critical";

export type AdminWorkspaceSummaryCard = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: AdminWorkspaceTone;
  action_hash: string;
};

export type AdminWorkspaceItem = {
  id: string;
  title: string;
  summary: string;
  status_label: string;
  tone: AdminWorkspaceTone;
  action_hash: string;
};

export type AdminWorkspaceSection = {
  visible: boolean;
  headline: string;
  summary_line: string;
  action_hash: string;
  action_label: string;
  helper_text: string | null;
  cards: AdminWorkspaceSummaryCard[];
  items: AdminWorkspaceItem[];
};

export type AdminWorkspaceResponse = {
  generated_at: string;
  anchor_date: string;
  refresh_interval_seconds: number;
  role_mode: "manage" | "read_only";
  summary_strip: AdminWorkspaceSummaryCard[];
  roles_access: AdminWorkspaceSection;
  integrations: AdminWorkspaceSection;
  automations: AdminWorkspaceSection;
  settings_reference: AdminWorkspaceSection;
  audit_security: AdminWorkspaceSection;
  review_tools: AdminWorkspaceSection;
};

export async function getAdminWorkspace(token: string, input?: { date?: string | null }) {
  const params = new URLSearchParams();
  if (input?.date) {
    params.set("date", input.date);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return apiFetch<AdminWorkspaceResponse>(`/api/dashboard/admin/workspace${suffix}`, token);
}
