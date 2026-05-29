import type { OperationalReportingBucket, OperationalReportingPeriod, OperationalReportingTone } from "./operationalReporting.js";

export interface ReportingFoundationSummaryCard {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OperationalReportingTone;
}

export interface ReportingFoundationMetric {
  key: string;
  label: string;
  value: string;
  tone: OperationalReportingTone;
  definition: string;
  source_tables: string[];
}

export interface ReportingFoundationBucketMetric {
  key: string;
  label: string;
  value: number;
}

export interface ReportingFoundationTrendPoint {
  bucket: OperationalReportingBucket;
  metrics: ReportingFoundationBucketMetric[];
}

export interface ReportingFoundationSection {
  summary_line: string;
  metrics: ReportingFoundationMetric[];
  trend: ReportingFoundationTrendPoint[];
}

export interface ReportingFoundationReadinessArea {
  area: string;
  label: string;
  state: "ready" | "partial" | "improving";
  summary: string;
  source_tables: string[];
  gaps: string[];
}

export interface ReportingFoundationWorkloadPerson {
  user_id: string;
  full_name: string;
  department: string | null;
  upcoming_assignments: number;
  open_tasks: number;
  overdue_tasks: number;
  open_production_items: number;
  overdue_production_items: number;
  pending_approvals: number;
  load_score: number;
}

export interface ReportingFoundationResponse {
  generated_at: string;
  anchor_date: string;
  period: OperationalReportingPeriod;
  period_label: string;
  scope_department: string | null;
  data_readiness: {
    summary_line: string;
    areas: ReportingFoundationReadinessArea[];
  };
  summary_strip: ReportingFoundationSummaryCard[];
  staffing_efficiency: ReportingFoundationSection;
  job_completion_timing: ReportingFoundationSection;
  overdue_work: ReportingFoundationSection;
  production_throughput: ReportingFoundationSection;
  approvals_exceptions: ReportingFoundationSection;
  notification_event_trends: ReportingFoundationSection;
  employee_workload: ReportingFoundationSection & {
    people: ReportingFoundationWorkloadPerson[];
  };
  technical_debt: string[];
}
