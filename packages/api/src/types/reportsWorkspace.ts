import type { OperationalModelReportingResponse, OperationalReportingPeriod, OperationalReportingTone } from "./operationalReporting.js";

export type ReportsWorkspaceHistoryFocus =
  | "all"
  | "watch"
  | "staffing"
  | "attendance"
  | "production"
  | "approvals"
  | "notifications"
  | "audit";

export type ReportsWorkspaceHistoryChipTone = "neutral" | "info" | "warning" | "critical";

export interface ReportsWorkspaceFreshnessSource {
  id: string;
  label: string;
  detail: string;
  updated_at: string | null;
  tone: OperationalReportingTone;
}

export interface ReportsWorkspaceDeliverySummary {
  saved_view_count: number;
  packet_template_count: number;
  active_schedule_count: number;
  failed_schedule_count: number;
  recent_run_count: number;
  failed_export_count: number;
}

export interface ReportsWorkspaceSavedViewRecord {
  id: string;
  label: string;
  summary: string;
  report_id: string | null;
  window: string;
  visibility: string;
  department: string | null;
  is_default: boolean;
  is_pinned: boolean;
  updated_at: string;
  share_hash: string;
}

export interface ReportsWorkspacePacketTemplateRecord {
  id: string;
  name: string;
  audience: string;
  description: string | null;
  visibility: string;
  default_window: string;
  is_pinned: boolean;
  updated_at: string;
}

export interface ReportsWorkspacePacketRunRecord {
  id: string;
  run_label: string;
  source_type: string;
  template_name: string | null;
  saved_view_name: string | null;
  status: string;
  anchor_date: string;
  created_at: string;
  completed_at: string;
  pdf_available: boolean;
}

export interface ReportsWorkspaceExportRecord {
  id: string;
  export_name: string;
  format: string;
  status: string;
  requested_by_name: string | null;
  requested_at: string;
  completed_at: string | null;
  record_count: number | null;
}

export interface ReportsWorkspaceDeliveryScheduleRecord {
  id: string;
  label: string;
  source_type: string;
  template_name: string | null;
  saved_view_name: string | null;
  cadence: string;
  delivery_channel: string;
  active_status: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface ReportsWorkspaceHistoryItem {
  id: string;
  focus: ReportsWorkspaceHistoryFocus;
  source: "workflow" | "notification" | "audit";
  module_label: string;
  title: string;
  summary: string;
  note: string | null;
  actor_label: string;
  created_at: string;
  action_hash: string;
  confidence_label: string;
  chips: Array<{
    label: string;
    tone?: ReportsWorkspaceHistoryChipTone;
  }>;
}

export interface ReportsWorkspaceHistorySection {
  generated_at: string;
  summary_line: string;
  focus: ReportsWorkspaceHistoryFocus;
  focus_options: Array<{
    id: ReportsWorkspaceHistoryFocus;
    label: string;
    count: number;
  }>;
  items: ReportsWorkspaceHistoryItem[];
}

export interface ReportsWorkspaceResponse {
  generated_at: string;
  anchor_date: string;
  period: OperationalReportingPeriod;
  period_options: OperationalReportingPeriod[];
  scope_department: string | null;
  refresh_interval_seconds: number;
  freshness: {
    summary_line: string;
    sources: ReportsWorkspaceFreshnessSource[];
  };
  operational_model: OperationalModelReportingResponse;
  delivery_summary: ReportsWorkspaceDeliverySummary;
  saved_views: ReportsWorkspaceSavedViewRecord[];
  packet_templates: ReportsWorkspacePacketTemplateRecord[];
  recent_packet_runs: ReportsWorkspacePacketRunRecord[];
  export_history: ReportsWorkspaceExportRecord[];
  delivery_schedules: ReportsWorkspaceDeliveryScheduleRecord[];
  history: ReportsWorkspaceHistorySection;
}
