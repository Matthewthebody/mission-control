export * from "../domain/profitability/index.js";

export type ProfitabilityWorkspaceTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";
export type ProfitabilityWorkspaceFocus = "overview" | "watch" | "burden" | "data_health";

export interface ProfitabilityWorkspaceWatchItem {
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
}

export interface ProfitabilityWorkspaceOverviewCard {
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
}

export interface ProfitabilityWorkspaceBurdenRow {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: ProfitabilityWorkspaceTone;
  action_hash: string;
}

export interface ProfitabilityWorkspaceBreakdownRow {
  id: string;
  label: string;
  watch_count: number;
  production_count: number;
  detail: string;
  tone: ProfitabilityWorkspaceTone;
  action_hash: string;
}

export interface ProfitabilityWorkspaceResponse {
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
  overview_cards: ProfitabilityWorkspaceOverviewCard[];
  watch_items: ProfitabilityWorkspaceWatchItem[];
  operational_burden: {
    summary_line: string;
    rows: ProfitabilityWorkspaceBurdenRow[];
  };
  breakdowns: {
    by_department: ProfitabilityWorkspaceBreakdownRow[];
    by_shoot_type: ProfitabilityWorkspaceBreakdownRow[];
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
}
