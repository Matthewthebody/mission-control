export type ComplianceWorkspaceSourceKind = "compliance_flag" | "attendance_exception" | "presence_incident";
export type ComplianceWorkspaceUrgency = "urgent" | "important" | "watch";
export type ComplianceWorkspaceStatusBucket = "unresolved" | "resolved";
export type ComplianceWorkspaceWindow = "today" | "this_week" | "overdue" | "all";
export type ComplianceWorkspaceBlockerState =
  | "payroll_blocked"
  | "mileage_blocked"
  | "closeout_blocked"
  | "presence_review"
  | "review_required"
  | "resolved";
export type ComplianceWorkspaceIssueType =
  | "missing_setup_photo"
  | "missing_post_shoot_evaluation"
  | "mileage_blocked_missing_post_shoot_evaluation"
  | "upload_while_off_clock"
  | "unresolved_end_of_day_confirmation"
  | "no_lunch_challenge"
  | "missed_clock_in_request"
  | "likely_present_missing_clock_in"
  | "assigned_but_missing";

export type ComplianceWorkspaceItem = {
  id: string;
  source_kind: ComplianceWorkspaceSourceKind;
  source_id: string;
  issue_type: ComplianceWorkspaceIssueType;
  issue_label: string;
  urgency: ComplianceWorkspaceUrgency;
  source_status: string;
  status_bucket: ComplianceWorkspaceStatusBucket;
  message: string;
  employee_id: string | null;
  employee_name: string | null;
  shift_id: string | null;
  shift_title: string | null;
  session_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  linked_exception_request_id: string | null;
  linked_attendance_exception_id: string | null;
  payroll_blocking: boolean;
  mileage_blocking: boolean;
  missing_closeout: boolean;
  unresolved_end_of_day_confirmation: boolean;
  blocker: {
    state: ComplianceWorkspaceBlockerState;
    label: string;
    summary: string;
    owning_workspace_label: string;
    owning_workspace_hash: string;
  };
  occurred_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type ComplianceWorkspaceListPayload = {
  summary: {
    open_count: number;
    payroll_blocking_count: number;
    mileage_blocking_count: number;
    missing_closeout_count: number;
    unresolved_end_of_day_confirmation_count: number;
    missed_clock_in_review_count: number;
    no_lunch_review_count: number;
    off_clock_upload_review_count: number;
    presence_incident_review_count: number;
    counts_by_issue_type: Record<ComplianceWorkspaceIssueType, number>;
    counts_by_urgency?: Record<ComplianceWorkspaceUrgency, number>;
  };
  freshness?: {
    generated_at: string;
    latest_item_updated_at: string | null;
    latest_unresolved_item_updated_at: string | null;
  };
  filters: {
    employees: Array<{ id: string; name: string }>;
    organizations: Array<{ id: string; name: string }>;
    shoots: Array<{ id: string; title: string }>;
    issue_types: Array<{ id: ComplianceWorkspaceIssueType; label: string }>;
  };
  rows: ComplianceWorkspaceItem[];
};

export type ComplianceWorkspaceDetailPayload = {
  item: ComplianceWorkspaceItem;
  available_actions?: Array<{
    id: string;
    label: string;
    kind: "review" | "drill_out" | "escalate";
    hash: string | null;
  }>;
  deep_links?: Array<{
    id: string;
    label: string;
    hash: string;
  }>;
  history?: Array<{
    id: string;
    occurred_at: string;
    source_label: string;
    title: string;
    summary: string | null;
    actor_name: string | null;
    tone: "neutral" | "info" | "warning" | "critical" | "success";
  }>;
  payroll_impact?: {
    blocked: boolean;
    reason: string | null;
    session_id: string | null;
    work_date: string | null;
    session_status: string | null;
    payable_minutes: number | null;
    lunch_challenge_status: string | null;
    manual_correction_count: number | null;
    missed_clock_in_approval_count: number | null;
  };
  mileage_impact?: {
    blocked: boolean;
    reason: string | null;
    reimbursement_id: string | null;
    work_date: string | null;
    status: string | null;
    review_reason_code: string | null;
    review_reason_label: string | null;
    issue_label: string | null;
    reimbursement_amount: string | null;
    zone_name: string | null;
    vehicle_type: string | null;
    submit_for_mileage: boolean | null;
  };
  linked_records: {
    shift: {
      id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      attendance_state: string | null;
      manager_user_id: string | null;
      manager_name: string | null;
      location_name: string | null;
      location_address: string | null;
      navigation_url: string | null;
    } | null;
    shoot: {
      id: string;
      shoot_code: string | null;
      title: string;
      shoot_date: string | null;
      showtime: string | null;
      start_time: string | null;
      estimated_end_time: string | null;
      status: string | null;
    } | null;
    organization: {
      id: string;
      display_name: string;
    } | null;
    location: {
      id: string;
      name: string;
      address: string | null;
      maps_url: string | null;
    } | null;
    correction_request: {
      id: string;
      request_type: string;
      status: string;
      submitted_at: string;
      reviewed_at: string | null;
      requested_state: string | null;
      requested_start_time: string | null;
      requested_end_time: string | null;
      note: string | null;
      reporting_flags: string[];
      original_values: Record<string, unknown>;
      resolved_values: Record<string, unknown>;
      requested_approver_id: string | null;
      requested_approver_name: string | null;
      reviewed_by_id: string | null;
      reviewed_by_name: string | null;
      approval_records: Array<{
        id: string;
        approver_id: string;
        approver_name: string | null;
        approver_role: string;
        decision: string;
        comment: string | null;
        decided_at: string;
      }>;
    } | null;
    post_shoot_evaluation: {
      id: string;
      submitted_at: string;
      photographer_name: string | null;
      overall_shoot_status: string | null;
      issue_flag: boolean;
      went_well: string | null;
      remember_next_time: string | null;
      open_comment: string | null;
      submit_for_mileage: boolean;
      vehicle_type: string | null;
    } | null;
    resource_uploads: Array<{
      id: string;
      file_name: string;
      category: string;
      approval_status: string;
      visibility_scope: string;
      note: string | null;
      issue_type: string | null;
      upload_source: string | null;
      uploader_name: string | null;
      captured_at: string | null;
      created_at: string;
      file_url: string | null;
    }>;
    presence_incident: {
      id: string;
      alert_type: string;
      current_state: string;
      geofence_classification: string;
      repeat_count: number;
      last_observed_at: string;
      last_notified_at: string | null;
      resolution_status: string;
      resolved_at: string | null;
      resolution_reason: string | null;
    } | null;
  };
};
