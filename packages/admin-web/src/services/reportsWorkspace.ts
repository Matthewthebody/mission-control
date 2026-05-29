import { apiFetch, apiUrl } from "../api";

export type ReportsWorkspacePeriod = "monthly" | "quarterly" | "annual";
export type ReportsWorkspaceHistoryFocus =
  | "all"
  | "watch"
  | "staffing"
  | "attendance"
  | "production"
  | "approvals"
  | "notifications"
  | "audit";

export type ReportsWorkspaceTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";

export type ReportsWorkspaceResponse = {
  generated_at: string;
  anchor_date: string;
  period: ReportsWorkspacePeriod;
  period_options: ReportsWorkspacePeriod[];
  scope_department: string | null;
  refresh_interval_seconds: number;
  freshness: {
    summary_line: string;
    sources: Array<{
      id: string;
      label: string;
      detail: string;
      updated_at: string | null;
      tone: ReportsWorkspaceTone;
    }>;
  };
  operational_model: {
    generated_at: string;
    anchor_date: string;
    period: ReportsWorkspacePeriod;
    period_label: string;
    date_range: {
      starts_at: string;
      ends_before: string;
      bucket_count: number;
    };
    scope_department: string | null;
    summary_strip: Array<{
      id: string;
      label: string;
      value: string;
      detail: string;
      tone: ReportsWorkspaceTone;
      action_hash: string;
    }>;
    watch: {
      action_hash: string;
      summary_line: string;
      red_breaches: number;
      overdue_count_by_type: Array<{ watch_type: string; label: string; count: number }>;
      average_resolution_hours: number | null;
      average_resolution_label: string;
      reason_code_trends: Array<{ reason_code: string; label: string; count: number }>;
      trend: ReportsWorkspaceTrendPoint[];
    };
    attendance: {
      action_hash: string;
      summary_line: string;
      tracked_assignments: number;
      on_time_rate: number;
      late_rate: number;
      no_show_rate: number;
      callout_rate: number;
      average_resolution_hours: number | null;
      average_resolution_label: string;
      staffing_incidents_driven_by_attendance: number;
      trend: ReportsWorkspaceTrendPoint[];
    };
    production: {
      action_hash: string;
      summary_line: string;
      jobs_completed: number;
      average_turnaround_hours: number | null;
      average_turnaround_label: string;
      overdue_tasks: number;
      blocked_reasons: Array<{ blocker_type: string; label: string; count: number }>;
      peer_review_backlog: number;
      qc_backlog: number;
      rework_rate: number;
      send_back_rate: number;
      trend: ReportsWorkspaceTrendPoint[];
    };
    approvals: {
      action_hash: string;
      summary_line: string;
      volume_by_type: Array<{ request_type: string; label: string; count: number }>;
      average_decision_hours: number | null;
      average_decision_label: string;
      overdue_count: number;
      escalation_count: number;
      rejection_rate: number;
      send_back_rate: number;
      trend: ReportsWorkspaceTrendPoint[];
    };
    schools: {
      action_hash: string;
      summary_line: string;
      open_work_count: number;
      overdue_count: number;
      due_today_count: number;
      blocked_count: number;
      waiting_on_school_count: number;
      waiting_on_internal_count: number;
      deliveries_ready_count: number;
      average_resolution_hours: number | null;
      average_resolution_label: string;
      trend: ReportsWorkspaceTrendPoint[];
    };
  };
  delivery_summary: {
    saved_view_count: number;
    packet_template_count: number;
    active_schedule_count: number;
    failed_schedule_count: number;
    recent_run_count: number;
    failed_export_count: number;
  };
  saved_views: Array<{
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
  }>;
  packet_templates: Array<{
    id: string;
    name: string;
    audience: string;
    description: string | null;
    visibility: string;
    default_window: string;
    is_pinned: boolean;
    updated_at: string;
  }>;
  recent_packet_runs: Array<{
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
  }>;
  export_history: Array<{
    id: string;
    export_name: string;
    format: string;
    status: string;
    requested_by_name: string | null;
    requested_at: string;
    completed_at: string | null;
    record_count: number | null;
  }>;
  delivery_schedules: Array<{
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
  }>;
  history: {
    generated_at: string;
    summary_line: string;
    focus: ReportsWorkspaceHistoryFocus;
    focus_options: Array<{
      id: ReportsWorkspaceHistoryFocus;
      label: string;
      count: number;
    }>;
    items: Array<{
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
      chips: Array<{ label: string; tone?: "neutral" | "info" | "warning" | "critical" }>;
    }>;
  };
};

export type ReportsWorkspaceTrendPoint = {
  bucket: {
    key: string;
    label: string;
    starts_at: string;
    ends_before: string;
  };
  metrics: Array<{
    key: string;
    label: string;
    value: number;
  }>;
};

export type ReportsWorkspaceFilters = {
  date: string;
  period: ReportsWorkspacePeriod;
  department?: string | null;
  focus?: ReportsWorkspaceHistoryFocus | null;
};

export async function getReportsWorkspace(token: string, filters: ReportsWorkspaceFilters) {
  const params = new URLSearchParams();
  params.set("date", filters.date);
  params.set("period", filters.period);
  if (filters.department) {
    params.set("department", filters.department);
  }
  if (filters.focus && filters.focus !== "all") {
    params.set("focus", filters.focus);
  }
  return apiFetch<ReportsWorkspaceResponse>(`/api/dashboard/reports/workspace?${params.toString()}`, token);
}

export async function downloadReportsWorkspaceCsv(token: string, filters: ReportsWorkspaceFilters) {
  const params = new URLSearchParams();
  params.set("date", filters.date);
  params.set("period", filters.period);
  if (filters.department) {
    params.set("department", filters.department);
  }
  const response = await fetch(`${apiUrl}/api/dashboard/reports/workspace/export.csv?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Reports export failed");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `reports-${filters.period}-${filters.date}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
