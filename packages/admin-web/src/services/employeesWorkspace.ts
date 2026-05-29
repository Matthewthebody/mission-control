import { apiFetch } from "../api";

export type EmployeesWorkspaceTone = "neutral" | "info" | "success" | "warning" | "critical";

export type EmployeesWorkspaceSummaryCard = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: EmployeesWorkspaceTone;
  action_hash: string;
};

export type EmployeesWorkspaceHighlight = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  status_label: string;
  tone: EmployeesWorkspaceTone;
  action_hash: string;
};

export type EmployeesWorkspaceModule = {
  visible: boolean;
  headline: string;
  summary_line: string;
  cards: EmployeesWorkspaceSummaryCard[];
  highlights: EmployeesWorkspaceHighlight[];
  primary_action_hash: string;
  primary_action_label: string;
  secondary_action_hash: string | null;
  secondary_action_label: string | null;
};

export type EmployeesWorkspaceTimeBand = {
  visible: boolean;
  headline: string;
  state: "action_needed" | "active" | "ended_today" | "needs_review" | "off_shift";
  emphasis: "red" | "green" | "amber" | "neutral";
  label: string;
  summary_line: string;
  helper_text: string;
  elapsed_label: string | null;
  shift_label: string | null;
  location_label: string | null;
  review_label: string | null;
  action_hash: string;
  action_label: string;
  schedule_hash: string | null;
  secondary_action_hash: string | null;
  secondary_action_label: string | null;
  metrics: EmployeesWorkspaceSummaryCard[];
};

export type EmployeesWorkspaceRecord = {
  visible: boolean;
  headline: string;
  summary_line: string;
  items: Array<{ label: string; value: string }>;
  links: Array<{ label: string; action_hash: string }>;
};

export type EmployeesWorkspaceResponse = {
  generated_at: string;
  anchor_date: string;
  refresh_interval_seconds: number;
  role_mode: "employee" | "manager" | "admin";
  summary_strip: EmployeesWorkspaceSummaryCard[];
  my_work: EmployeesWorkspaceModule | null;
  time_pay: EmployeesWorkspaceTimeBand | null;
  requests_approvals: EmployeesWorkspaceModule | null;
  training_readiness: EmployeesWorkspaceModule | null;
  record: EmployeesWorkspaceRecord | null;
};

export async function getEmployeesWorkspace(token: string, input?: { date?: string | null }) {
  const params = new URLSearchParams();
  if (input?.date) {
    params.set("date", input.date);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return apiFetch<EmployeesWorkspaceResponse>(`/api/dashboard/employees/workspace${suffix}`, token);
}
