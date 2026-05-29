export type JobCloseoutOverallStatus = "smooth" | "few_bumps" | "rough";
export type JobCloseoutIssueStatus = "none" | "minor" | "major";
export type JobCloseoutScheduleStatus = "on_schedule" | "slight_delays" | "major_delays";
export type JobCloseoutRetakeRisk = "none" | "possible" | "likely";
export type JobCloseoutClientSentiment = "very_happy" | "fine" | "frustrated";
export type JobCloseoutDataIssue =
  | "missing_subjects"
  | "qr_missing_or_would_not_scan"
  | "qr_sorting_issue"
  | "schedule_or_roster_issue"
  | "other";

export interface JobCloseoutRules {
  feature_flag: "JOB_CLOSEOUT_V1_ENABLED";
  enabled: boolean;
  timezone: string;
  check_in_offset_minutes: number;
  missed_check_in_grace_minutes: number;
  lateness_threshold_minutes: number;
  senior_evaluation_required: boolean;
  associate_evaluation_required: boolean;
  daily_report_time: string;
  weekly_report_time: string;
  photo_upload_soft_reminder_enabled: boolean;
}

export interface JobCloseoutJob {
  id: string;
  department_type: string;
  job_category: string;
  job_number: string | null;
  title: string;
  event_name: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  timezone: string;
  organization_id: string | null;
  organization_name: string | null;
  primary_location_id: string | null;
  location_name: string | null;
  is_assigned_to_user: boolean;
  is_lead_for_user: boolean;
}

export interface JobCloseoutEvaluation {
  id: string;
  job_id: string;
  submitted_at: string | null;
  created_at?: string;
  eval_status: string;
  evaluation_type: "post_shoot" | "post_production";
  evaluation_version: string;
  submitter_role: string | null;
  overall_status: JobCloseoutOverallStatus | null;
  overall_score?: number | null;
  image_confidence_score: number | null;
  schedule_status: JobCloseoutScheduleStatus | null;
  staffing_status: JobCloseoutIssueStatus | null;
  technical_issue_status: JobCloseoutIssueStatus | null;
  retake_risk: JobCloseoutRetakeRisk | null;
  client_sentiment: JobCloseoutClientSentiment | null;
  data_issue_types: JobCloseoutDataIssue[];
  positive_shoutout_note: string | null;
  support_needed_note?: string | null;
  next_year_improvement_note: string | null;
  mileage_qualified: boolean | null;
}

export interface JobCloseoutCheckIn {
  id: string;
  job_id: string;
  requested_for_user_id: string;
  requested_for_name: string | null;
  due_at: string;
  responded_at: string | null;
  status: "pending" | "good" | "issue" | "missed";
  issue_note: string | null;
}

export interface JobCloseoutFlag {
  id: string;
  job_id: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  severity: "low" | "medium" | "high" | "critical" | "info";
  flag_type: string;
  title: string;
  description: string;
  status: string;
  assigned_team: string | null;
  created_at: string;
}

export interface JobCloseoutMileageReview {
  id: string;
  job_id: string;
  account_id: string | null;
  account_name?: string | null;
  user_id: string;
  user_name?: string | null;
  evaluation_id: string | null;
  mileage_qualified: boolean;
  zone_id: string | null;
  zone_name: string | null;
  calculated_amount: string | null;
  status: "pending_review" | "approved" | "exported" | "voided" | "needs_zone_review";
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobCloseoutWorkspace {
  rules: JobCloseoutRules;
  permissions: {
    can_submit: boolean;
    can_manage: boolean;
    can_view_sensitive: boolean;
    can_manage_mileage: boolean;
  };
  job: JobCloseoutJob;
  check_ins: JobCloseoutCheckIn[];
  evaluations: JobCloseoutEvaluation[];
  latest_evaluation: JobCloseoutEvaluation | null;
  mileage_reviews: JobCloseoutMileageReview[];
  attachments: Array<{
    id: string;
    evaluation_id: string;
    job_id: string;
    attachment_type: string;
    file_url: string | null;
    storage_key: string | null;
    filename: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    created_at: string;
  }>;
  flags: JobCloseoutFlag[];
  pre_shoot_brief: {
    prior_post_shoot_evaluations: JobCloseoutEvaluation[];
    prior_next_year_notes: string[];
    prior_data_issues: JobCloseoutDataIssue[];
    customer_survey_summary: string | null;
    customer_survey_summary_status: string;
  };
}

export interface SubmitJobCloseoutPayload {
  submitter_role?: "senior_photographer" | "shoot_lead" | "associate" | "leadership" | "other";
  evaluation_type?: "post_shoot" | "post_production";
  status?: "draft" | "submitted";
  overall_status: JobCloseoutOverallStatus;
  overall_score?: number | null;
  schedule_status?: JobCloseoutScheduleStatus | null;
  schedule_note?: string | null;
  staffing_status?: JobCloseoutIssueStatus | null;
  staffing_note?: string | null;
  all_photographers_on_time?: boolean | null;
  late_note?: string | null;
  image_confidence_score: number;
  technical_issue_status?: JobCloseoutIssueStatus | null;
  technical_issue_note?: string | null;
  retake_risk?: JobCloseoutRetakeRisk | null;
  client_sentiment?: JobCloseoutClientSentiment | null;
  client_issue_flag?: boolean;
  client_issue_note?: string | null;
  data_issue_types?: JobCloseoutDataIssue[];
  data_issue_note?: string | null;
  positive_shoutout_note?: string | null;
  support_needed_note?: string | null;
  next_year_improvement_note?: string | null;
  mileage_qualified?: boolean | null;
  mileage_note?: string | null;
  mileage_disqualification_reason?: "company_vehicle" | "carpool" | "did_not_drive" | "other" | null;
  general_note?: string | null;
  late_staff?: Array<{
    user_id?: string | null;
    display_name: string;
    minutes_late?: number | null;
    reason?: string | null;
  }>;
  attachments?: Array<{
    attachment_type?: "setup" | "location" | "issue" | "other";
    storage_key?: string | null;
    file_url?: string | null;
    filename?: string | null;
    mime_type?: string | null;
    size_bytes?: number | null;
  }>;
}

export interface JobCloseoutReportSnapshot {
  id: string;
  report_type: "daily" | "weekly";
  period_start: string;
  period_end: string;
  timezone: string;
  generated_at?: string;
  generated_by?: string;
  summary_metrics: Record<string, unknown>;
  issue_summary: Record<string, unknown>;
  wins_summary: Record<string, unknown>;
  people_summary: Record<string, unknown>;
  account_summary: unknown[];
  next_year_summary: unknown[];
  source_evaluation_ids: string[];
  source_flag_ids: string[];
}
