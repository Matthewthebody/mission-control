export const OPERATIONAL_REPORTING_PERIODS = ["monthly", "quarterly", "annual"] as const;
export type OperationalReportingPeriod = (typeof OPERATIONAL_REPORTING_PERIODS)[number];

export type OperationalReportingTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";

export interface OperationalReportingSummaryCard {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OperationalReportingTone;
  action_hash: string;
}

export interface OperationalReportingBucketMetric {
  key: string;
  label: string;
  value: number;
}

export interface OperationalReportingBucket {
  key: string;
  label: string;
  starts_at: string;
  ends_before: string;
}

export interface OperationalReportingTrendPoint {
  bucket: OperationalReportingBucket;
  metrics: OperationalReportingBucketMetric[];
}

export interface OperationalWatchReportingSection {
  action_hash: string;
  summary_line: string;
  red_breaches: number;
  overdue_count_by_type: Array<{
    watch_type: string;
    label: string;
    count: number;
  }>;
  average_resolution_hours: number | null;
  average_resolution_label: string;
  reason_code_trends: Array<{
    reason_code: string;
    label: string;
    count: number;
  }>;
  trend: OperationalReportingTrendPoint[];
}

export interface OperationalAttendanceReportingSection {
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
  trend: OperationalReportingTrendPoint[];
}

export interface OperationalProductionReportingSection {
  action_hash: string;
  summary_line: string;
  jobs_completed: number;
  average_turnaround_hours: number | null;
  average_turnaround_label: string;
  overdue_tasks: number;
  blocked_reasons: Array<{
    blocker_type: string;
    label: string;
    count: number;
  }>;
  peer_review_backlog: number;
  qc_backlog: number;
  rework_rate: number;
  send_back_rate: number;
  trend: OperationalReportingTrendPoint[];
}

export interface OperationalApprovalsReportingSection {
  action_hash: string;
  summary_line: string;
  volume_by_type: Array<{
    request_type: string;
    label: string;
    count: number;
  }>;
  average_decision_hours: number | null;
  average_decision_label: string;
  overdue_count: number;
  escalation_count: number;
  rejection_rate: number;
  send_back_rate: number;
  trend: OperationalReportingTrendPoint[];
}

export interface OperationalSchoolsReportingSection {
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
  trend: OperationalReportingTrendPoint[];
}

export interface OperationalModelReportingResponse {
  generated_at: string;
  anchor_date: string;
  period: OperationalReportingPeriod;
  period_label: string;
  date_range: {
    starts_at: string;
    ends_before: string;
    bucket_count: number;
  };
  scope_department: string | null;
  summary_strip: OperationalReportingSummaryCard[];
  watch: OperationalWatchReportingSection;
  attendance: OperationalAttendanceReportingSection;
  production: OperationalProductionReportingSection;
  approvals: OperationalApprovalsReportingSection;
  schools: OperationalSchoolsReportingSection;
  technical_debt: string[];
  recommended_phase_2: string[];
}
