export type PayrollReviewIssue = {
  code: string;
  label: string;
  severity: "important" | "watch";
  blocks_export: boolean;
  message: string;
  resolution_state: "unresolved" | "resolved";
};

export type PayrollReviewSessionSegment = {
  id: string;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  work_state: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  source_type: string;
  review_status: string;
  reporting_flags: string[];
};

export type PayrollReviewSessionDetail = {
  id: string;
  session_id: string;
  work_date: string;
  session_status: string;
  source_shift_id: string | null;
  shift_title: string | null;
  shift_starts_at: string | null;
  shift_ends_at: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  location_name: string | null;
  office_drive_minutes: number;
  photography_minutes: number;
  total_worked_minutes: number;
  lunch_deduction_minutes: number;
  payable_minutes: number;
  regular_office_drive_minutes: number;
  regular_photography_minutes: number;
  overtime_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  reporting_flags: string[];
  segments: PayrollReviewSessionSegment[];
};

export type PayrollReviewApprovalRecord = {
  id: string;
  approver_id: string;
  approver_name: string | null;
  approver_role: string;
  decision: string;
  comment: string | null;
  decided_at: string;
};

export type PayrollReviewExceptionRequest = {
  id: string;
  request_type: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  requested_state: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  note: string;
  reporting_flags: string[];
  work_date: string | null;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  shift_id: string | null;
  shift_title: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  requested_approver_id: string | null;
  requested_approver_name: string | null;
  reviewed_by_id: string | null;
  reviewed_by_name: string | null;
  approval_records: PayrollReviewApprovalRecord[];
};

export type PayrollReviewMileageSource = {
  id: string;
  evaluation_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_display_name: string | null;
  location_name: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  submit_for_mileage: boolean;
  vehicle_type: string | null;
  eligible_for_selection: boolean;
  review_reason_code: string | null;
  created_at: string;
};

export type PayrollReviewMileageReimbursement = {
  id: string;
  work_date: string;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  organization_display_name: string | null;
  location_name: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  vehicle_type: string | null;
  status: string;
  review_reason_code: string | null;
  reporting_flags: string[];
  source_evaluation_count: number;
  created_at: string;
  updated_at: string;
  sources: PayrollReviewMileageSource[];
};

export type PayrollReviewRow = {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  department?: string | null;
  pay_period_start: string;
  pay_period_end: string;
  regular_office_drive_minutes: number;
  regular_photography_minutes: number;
  overtime_minutes: number;
  overtime_base_rate: string | null;
  overtime_rate: string | null;
  lunch_deduction_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  mileage_reimbursement_amount: string;
  exception_request_count: number;
  approval_record_count: number;
  exception_flags: string[];
  approval_flags: string[];
  notes: Record<string, unknown>;
  status: string;
  sessions: Array<{
    id: string;
    session_id: string;
    work_date: string;
    office_drive_minutes: number;
    photography_minutes: number;
    total_worked_minutes: number;
    lunch_deduction_minutes: number;
    payable_minutes: number;
    regular_office_drive_minutes: number;
    regular_photography_minutes: number;
    overtime_minutes: number;
    manual_correction_count: number;
    missed_clock_in_approval_count: number;
    reporting_flags: string[];
  }>;
  legacy_comparison: {
    entry_count: number;
    payable_minutes: number;
    payable_minutes_delta: number;
    break_override_count: number;
    amounts_match: boolean;
  };
  transition_flags: string[];
  review_state: "attention_required" | "ready" | "exported";
  export_readiness: "blocked" | "ready" | "exported";
  unresolved_issue_count: number;
  review_issues: PayrollReviewIssue[];
};

export type PayrollReviewPayload = {
  source_of_truth: {
    primary_model: string;
    canonical_records: string[];
    legacy_compatibility_records: string[];
  };
  pay_period: {
    start: string;
    end: string;
    overtime_basis: string;
  };
  transition: {
    canonical_break_override_count: number;
    legacy_time_entry_summary: {
      entry_count: number;
      gross_hours: number;
      break_deduction_hours: number;
      payable_hours: number;
      break_override_count: number;
    };
    comparison: {
      mismatch_employee_count: number;
      canonical_only_employee_count: number;
      legacy_only_employee_count: number;
    };
  };
  summary: {
    employee_count: number;
    ready_count: number;
    blocked_count: number;
    exported_count: number;
    regular_office_drive_hours: number;
    regular_photography_hours: number;
    overtime_hours: number;
    lunch_deduction_hours: number;
    mileage_reimbursement_amount: number;
    manual_correction_count: number;
    missed_clock_in_approval_count: number;
    exception_count: number;
    approval_count: number;
  };
  rows: PayrollReviewRow[];
};

export type PayrollReviewDetailPayload = {
  row: PayrollReviewRow;
  linked_records: {
    sessions: PayrollReviewSessionDetail[];
    exception_requests: PayrollReviewExceptionRequest[];
    mileage_reimbursements: PayrollReviewMileageReimbursement[];
  };
  export_payload_row: PayrollExportRow;
};

export type PayrollExportRow = {
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  pay_period_start: string;
  pay_period_end: string;
  review_state: "attention_required" | "ready" | "exported";
  export_readiness: "blocked" | "ready" | "exported";
  regular_office_drive_hours: number;
  regular_photography_hours: number;
  overtime_hours: number;
  lunch_deduction_hours: number;
  mileage_reimbursement_amount: number;
  exception_count: number;
  approval_count: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  exception_flags: string[];
  approval_flags: string[];
  notes: string;
};

export type PayrollExportPayload = {
  source_of_truth: {
    primary_model: string;
    canonical_records: string[];
    legacy_compatibility_records: string[];
  };
  generated_at: string;
  pay_period: {
    start: string;
    end: string;
    overtime_basis: string;
  };
  summary: {
    employee_count: number;
    ready_count: number;
    blocked_count: number;
    exported_count: number;
    total_labor_hours: number;
    total_mileage_reimbursement_amount: number;
  };
  rows: PayrollExportRow[];
};
