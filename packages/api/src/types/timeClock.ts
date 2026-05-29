export type TimeWorkState = "office_drive" | "photography";

export type TimeSessionStatus =
  | "open"
  | "closed"
  | "needs_end_of_day_confirmation"
  | "approved"
  | "payroll_exported";

export type TimeSegmentSourceType =
  | "manual"
  | "automatic_transition"
  | "manual_correction"
  | "admin_override";

export type TimeSegmentReviewStatus = "not_required" | "pending_review" | "approved" | "rejected";

export type ClockEventType =
  | "clock_in"
  | "clock_out"
  | "session_opened"
  | "session_closed"
  | "work_state_started"
  | "work_state_ended"
  | "manual_correction"
  | "admin_override"
  | "exception_requested"
  | "approval_recorded"
  | "auto_lunch_deduction_applied"
  | "auto_lunch_deduction_removed";

export type ClockEventActorType = "employee" | "system" | "manager" | "leadership" | "integration" | "admin";

export type ExceptionRequestType =
  | "missing_clock_in"
  | "missing_clock_out"
  | "time_segment_correction"
  | "work_state_change"
  | "lunch_deduction_challenge"
  | "mileage_review"
  | "other";

export type ExceptionRequestStatus = "submitted" | "under_review" | "approved" | "rejected" | "cancelled";

export type ApprovalRecordDecision = "approved" | "rejected" | "returned";
export type TimePresenceState = "off_clock" | "office_drive" | "photography" | "needs_end_of_day_confirmation";
export type TimePresenceObservationSource = "location_check" | "clock_punch" | "end_of_day_confirmation" | "system_transition";
export type TimePresenceAlertType = "assigned_but_missing" | "likely_present_missing_clock_in";
export type TimePresenceIncidentStatus = "open" | "resolved";
export type TimePresenceGeofenceClassification =
  | "inside_shoot_radius"
  | "inside_soft_radius"
  | "outside_soft_radius"
  | "inside_studio_radius"
  | "outside_studio_radius"
  | "unknown";

export type MileageVehicleType =
  | "personal_vehicle"
  | "carpool_passenger"
  | "company_vehicle"
  | "other_needs_review";

export type MileageReimbursementStatus =
  | "candidate"
  | "review_required"
  | "ineligible"
  | "approved"
  | "exported"
  | "cancelled";

export type MileageReimbursementReasonCode =
  | "missing_post_shoot_evaluation"
  | "not_mileage_eligible"
  | "submit_declined"
  | "company_vehicle"
  | "carpool_passenger"
  | "other_needs_review"
  | "missing_location_coordinates"
  | "missing_zone_match"
  | "no_eligible_personal_vehicle_submission";

export type LunchDeductionSource =
  | "not_applicable"
  | "auto_deducted"
  | "challenge_pending"
  | "challenge_approved"
  | "challenge_rejected"
  | "manual_override";

export type PayrollExportAggregateStatus = "draft" | "ready" | "exported";
export type TimeClockComplianceItem =
  | "missing_setup_photo"
  | "missing_post_shoot_evaluation"
  | "mileage_blocked_missing_post_shoot_evaluation"
  | "upload_while_off_clock"
  | "unresolved_end_of_day_confirmation";
export type TimeClockComplianceStatus = "open" | "resolved";
export type TimeClockComplianceSeverity = "warning" | "high";

export type EmployeePayProfile = {
  id: string;
  tenant_id: string;
  employee_id: string;
  office_rate: string;
  photography_rate: string;
  overtime_eligible: boolean;
  mileage_eligible: boolean;
  active_status: boolean;
  effective_date: string;
  created_at: string;
  updated_at: string;
};

export type TimeSession = {
  id: string;
  tenant_id: string;
  employee_id: string;
  work_date: string;
  source_shift_id: string | null;
  status: TimeSessionStatus;
  created_at: string;
  updated_at: string;
};

export type TimeSegment = {
  id: string;
  tenant_id: string;
  session_id: string;
  employee_id: string;
  linked_shift_id: string | null;
  work_state: TimeWorkState;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  supersedes_segment_id: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  source_type: TimeSegmentSourceType;
  geofence_supported: boolean;
  review_status: TimeSegmentReviewStatus;
  reporting_flags: string[];
  created_at: string;
  updated_at: string;
};

export type ClockEvent = {
  id: string;
  tenant_id: string;
  employee_id: string;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  event_type: ClockEventType;
  event_timestamp: string;
  latitude: number | null;
  longitude: number | null;
  metadata: Record<string, unknown>;
  created_by_actor: ClockEventActorType;
  created_at: string;
};

export type ExceptionRequest = {
  id: string;
  tenant_id: string;
  employee_id: string;
  request_type: ExceptionRequestType;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  requested_approver_id: string | null;
  related_attendance_exception_id: string | null;
  requested_state: TimeWorkState | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  location_context: Record<string, unknown>;
  original_values: Record<string, unknown>;
  resolved_values: Record<string, unknown>;
  reporting_flags: string[];
  note: string;
  status: ExceptionRequestStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export type ApprovalRecord = {
  id: string;
  tenant_id: string;
  request_id: string;
  approver_id: string;
  approver_role: string;
  decision: ApprovalRecordDecision;
  comment: string | null;
  decided_at: string;
};

export type MileageZone = {
  id: string;
  tenant_id: string;
  zone_name: string;
  min_distance: string;
  max_distance: string;
  reimbursement_amount: string;
  active_status: boolean;
  effective_date: string;
  created_at: string;
  updated_at: string;
};

export type MileageReimbursement = {
  id: string;
  tenant_id: string;
  employee_id: string;
  work_date: string;
  selected_evaluation_id: string | null;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  zone_id: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  vehicle_type: MileageVehicleType | null;
  status: MileageReimbursementStatus;
  review_reason_code: MileageReimbursementReasonCode | null;
  source_evaluation_count: number;
  reporting_flags: string[];
  created_at: string;
  updated_at: string;
};

export type MileageReimbursementSource = {
  id: string;
  tenant_id: string;
  reimbursement_id: string;
  evaluation_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  zone_id: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  submit_for_mileage: boolean;
  vehicle_type: MileageVehicleType | null;
  eligible_for_selection: boolean;
  review_reason_code: MileageReimbursementReasonCode | null;
  created_at: string;
};

export type TimeClockPresenceObservation = {
  id: string;
  tenant_id: string;
  employee_id: string;
  session_id: string | null;
  segment_id: string | null;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  current_state: TimePresenceState;
  session_status: TimeSessionStatus | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  captured_at: string;
  source_type: TimePresenceObservationSource;
  created_at: string;
  updated_at: string;
};

export type TimeClockPresenceIncident = {
  id: string;
  tenant_id: string;
  employee_id: string;
  shift_id: string | null;
  shoot_id: string | null;
  alert_type: TimePresenceAlertType;
  geofence_classification: TimePresenceGeofenceClassification;
  current_state: TimePresenceState;
  resolution_status: TimePresenceIncidentStatus;
  linked_correction_request_id: string | null;
  repeat_count: number;
  created_at: string;
  updated_at: string;
  last_observed_at: string;
  last_notified_at: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
};

export type TimeSessionPayrollSummary = {
  id: string;
  tenant_id: string;
  session_id: string;
  employee_id: string;
  work_date: string;
  office_drive_minutes: number;
  photography_minutes: number;
  total_worked_minutes: number;
  lunch_deduction_minutes: number;
  lunch_deduction_source: LunchDeductionSource;
  lunch_challenge_request_id: string | null;
  lunch_challenge_status: ExceptionRequestStatus | null;
  payable_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  exception_request_count: number;
  approval_record_count: number;
  reporting_flags: string[];
  generated_at: string;
  updated_at: string;
};

export type PayrollExportAggregate = {
  id: string;
  tenant_id: string;
  employee_id: string;
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
  status: PayrollExportAggregateStatus;
  generated_at: string;
  updated_at: string;
};

export type PayrollExportAggregateSession = {
  id: string;
  tenant_id: string;
  aggregate_id: string;
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
  created_at: string;
};

export type TimeClockComplianceFlag = {
  id: string;
  tenant_id: string;
  employee_id: string;
  shift_id: string | null;
  session_id: string | null;
  shoot_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  linked_exception_request_id: string | null;
  item_type: TimeClockComplianceItem;
  severity: TimeClockComplianceSeverity;
  status: TimeClockComplianceStatus;
  dedupe_key: string;
  metadata: Record<string, unknown>;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};
