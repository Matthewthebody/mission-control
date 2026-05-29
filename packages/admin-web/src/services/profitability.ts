import { apiFetch } from "../api";

export type ProfitabilityWorkspaceTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";
export type ProfitabilityWorkspaceFocus = "overview" | "watch" | "burden" | "data_health";

export type ProfitabilityWorkspaceResponse = {
  generated_at: string;
  anchor_date: string;
  filters: {
    date_from: string;
    date_to: string;
    department: string | null;
    focus: ProfitabilityWorkspaceFocus;
  };
  headline: {
    title: string;
    summary_line: string;
    tone: ProfitabilityWorkspaceTone;
  };
  overview_cards: Array<{
    id:
      | "watch_items"
      | "production_burden"
      | "qa_rework_burden"
      | "labor_variance_today"
      | "data_health_issues";
    label: string;
    value: number | string;
    detail: string;
    tone: ProfitabilityWorkspaceTone;
    action_hash: string;
  }>;
  watch_items: Array<{
    id: string;
    kind: "shoot_watch" | "recommendation_flag";
    title: string;
    summary: string;
    tone: ProfitabilityWorkspaceTone;
    status_label: string;
    driver_label: string;
    context_label: string | null;
    workspace_hash: string;
    action_hash: string | null;
  }>;
  operational_burden: {
    summary_line: string;
    rows: Array<{
      id: string;
      label: string;
      value: string;
      detail: string;
      tone: ProfitabilityWorkspaceTone;
      action_hash: string;
    }>;
  };
  breakdowns: {
    by_department: Array<{
      id: string;
      label: string;
      watch_count: number;
      production_count: number;
      detail: string;
      tone: ProfitabilityWorkspaceTone;
      action_hash: string;
    }>;
    by_shoot_type: Array<{
      id: string;
      label: string;
      watch_count: number;
      production_count: number;
      detail: string;
      tone: ProfitabilityWorkspaceTone;
      action_hash: string;
    }>;
  };
  data_health: {
    summary_line: string;
    cards: Array<{
      id:
        | "latest_import_status"
        | "unresolved_import_issues"
        | "fresh_snapshots"
        | "stale_snapshots"
        | "recommendation_flags";
      label: string;
      value: number | string;
      detail: string;
      tone: ProfitabilityWorkspaceTone;
    }>;
    latest_import: {
      source_type: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      file_name: string | null;
      source_line_count: number;
      rejected_line_count: number;
    } | null;
  };
};

export type ProfitabilityWorkspaceFilters = {
  date: string;
  date_from: string;
  date_to: string;
  department?: string | null;
  focus?: ProfitabilityWorkspaceFocus;
};

export function buildProfitabilityHash(filters: {
  date_from?: string | null;
  date_to?: string | null;
  department?: string | null;
  focus?: ProfitabilityWorkspaceFocus | null;
} = {}) {
  const params = new URLSearchParams();
  if (filters.focus && filters.focus !== "overview") {
    params.set("focus", filters.focus);
  }
  if (filters.date_from) {
    params.set("date_from", filters.date_from);
  }
  if (filters.date_to) {
    params.set("date_to", filters.date_to);
  }
  if (filters.department) {
    params.set("department", filters.department);
  }
  const query = params.toString();
  return query ? `#reports/finance?${query}` : "#reports/finance";
}

export async function getProfitabilityWorkspace(token: string, filters: ProfitabilityWorkspaceFilters) {
  const params = new URLSearchParams();
  params.set("date", filters.date);
  params.set("date_from", filters.date_from);
  params.set("date_to", filters.date_to);
  if (filters.department) {
    params.set("department", filters.department);
  }
  if (filters.focus && filters.focus !== "overview") {
    params.set("focus", filters.focus);
  }
  return apiFetch<ProfitabilityWorkspaceResponse>(`/api/profitability/workspace?${params.toString()}`, token);
}
