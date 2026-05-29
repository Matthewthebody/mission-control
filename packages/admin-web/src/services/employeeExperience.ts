import { apiFetch } from "../api";
import { emitTimeClockStateChanged } from "./timeClockApi";
import type { ProjectWorkflowStepStatus } from "../projectTrackingTypes";
import type { ReadyToShootState, ResourceLibraryView } from "../types";

export type EmployeeNotificationRecord = {
  id: string;
  notification_type: string;
  channel: string;
  priority: string;
  status: string;
  title: string;
  body: string;
  deep_link?: string | null;
  created_at: string;
};

export type EmployeeEventProjection = {
  id: string;
  shoot_id?: string | null;
  shoot_code?: string | null;
  shoot_title?: string | null;
  shoot_date?: string | null;
  title: string;
  shift_kind: string;
  status: string;
  department: string;
  staffing_role?: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  location_name?: string | null;
  location_address?: string | null;
  navigation_url?: string | null;
  manager_name?: string | null;
  attendance_state?: string | null;
  attendance_state_note?: string | null;
  latest_punch_direction?: "in" | "out" | null;
  latest_punch_at?: string | null;
  latest_geofence_status?: "inside" | "outside" | "unknown" | null;
  latest_punch_approval_state?: string | null;
  has_pre_service_notes: boolean;
  notes_acknowledged: boolean;
  note_summary?: string | null;
  trade_request_count: number;
  open_exception_count: number;
  follow_through_label?: string | null;
  follow_through_tone?: "good" | "info" | "heads_up" | "action_needed";
  closeout_missing_count?: number;
  mileage_status?: string | null;
  mileage_issue_label?: string | null;
};

/** @deprecated Compatibility alias while downstream surfaces still read shift-era preview types. */
export type EmployeeShiftPreview = EmployeeEventProjection;

export type EmployeeMyWorkJobRecord = {
  id: string;
  job_number?: string | null;
  title: string;
  department: string;
  status: string;
  status_label: string;
  organization_display_name?: string | null;
  assigned_task_count: number;
  assigned_event_count: number;
  assigned_workflow_step_count?: number;
  open_exception_count: number;
  next_event_at?: string | null;
};

export type EmployeeMyWorkWorkflowStepRecord = {
  id: string;
  workflow_run_id: string;
  job_id: string;
  job_number?: string | null;
  job_title: string;
  organization_display_name?: string | null;
  step_name: string;
  department: string;
  assigned_user_id?: string | null;
  assigned_queue?: string | null;
  assignment_status?: string | null;
  status: ProjectWorkflowStepStatus;
  status_label: string;
  operational_status: string;
  next_action: string;
  clear_condition: string;
  due_at?: string | null;
  waiting_on_party?: string | null;
  waiting_detail?: string | null;
  notes?: string | null;
  blocked_reason?: string | null;
  updated_at?: string | null;
  deep_link: string;
};

export type EmployeeMyWorkEventRecord = {
  id: string;
  event_id: string;
  source: string;
  source_record_type: string;
  source_record_id: string;
  /** @deprecated Compatibility alias while event projections are still backed by work shifts. */
  shift_id: string;
  linked_job_id?: string | null;
  linked_job_number?: string | null;
  linked_job_title?: string | null;
  title: string;
  subtitle?: string | null;
  department: string;
  staffing_role?: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  location_name?: string | null;
  location_address?: string | null;
  action_label: string;
  follow_through_label?: string | null;
  note_summary?: string | null;
  open_exception_count: number;
  notes_acknowledged: boolean;
};

export type EmployeeMyWorkTaskRecord = {
  id: string;
  task_number: string;
  title: string;
  department: string;
  status: string;
  status_label: string;
  priority: string;
  due_at?: string | null;
  blocked_reason?: string | null;
  job_id?: string | null;
  event_id?: string | null;
  workflow_run_id?: string | null;
  linked_job_number?: string | null;
  linked_job_title?: string | null;
  organization_display_name?: string | null;
  proof_required: boolean;
};

export type EmployeeMyWorkAcknowledgementRecord = {
  id: string;
  acknowledgement_type: string;
  title: string;
  summary: string;
  department: string;
  due_at?: string | null;
  event_id: string;
  source_record_type: string;
  source_record_id: string;
  /** @deprecated Compatibility alias while acknowledgement actions still resolve through work shifts. */
  shift_id: string;
  linked_job_id?: string | null;
  linked_job_number?: string | null;
  linked_job_title?: string | null;
  action_label: string;
};

export type EmployeeMyWorkExceptionRecord = {
  id: string;
  exception_type: string;
  exception_type_label: string;
  status: string;
  severity: string;
  reason_code?: string | null;
  notes?: string | null;
  created_at: string;
  department?: string | null;
  event_id?: string | null;
  source_record_type?: string | null;
  source_record_id?: string | null;
  /** @deprecated Compatibility alias while exception sources still flow from shift-backed attendance records. */
  shift_id?: string | null;
  linked_job_id?: string | null;
  linked_job_number?: string | null;
  linked_job_title?: string | null;
  scope_label: string;
  tone: "good" | "info" | "heads_up" | "action_needed";
};

export type EmployeeMyWorkApprovalRecord = {
  id: string;
  request_type: string;
  request_type_label: string;
  request_title: string;
  request_summary?: string | null;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label?: string | null;
  blocking: boolean;
  severity: string;
  current_approver_role_group_label?: string | null;
  due_at?: string | null;
  overdue: boolean;
  escalated: boolean;
};

export type EmployeeMyWorkRecentChangeRecord = {
  id: string;
  change_type: string;
  title: string;
  summary: string;
  created_at: string;
  tone: "good" | "info" | "heads_up" | "action_needed";
  department?: string | null;
  related_record_type: string;
  related_record_id: string;
};

export type EmployeeMyWorkResponse = {
  anchor_date: string;
  window_end_date: string;
  summary: {
    events_today: number;
    upcoming_events: number;
    shifts_today: number;
    upcoming_shifts: number;
    pending_trade_requests: number;
    unread_notifications: number;
    clocked_in_shift_count: number;
    attention_needed_count: number;
    closeout_due_count: number;
    late_or_exception_count: number;
    mileage_review_count: number;
    assigned_job_count: number;
    assigned_event_count: number;
    assigned_task_count: number;
    live_workflow_step_count?: number;
    acknowledgement_count: number;
    owned_exception_count: number;
    approval_waiting_count: number;
    recent_change_count: number;
    next_event_label?: string | null;
    /** @deprecated Compatibility alias while downstream shells still read shift-era summary keys. */
    next_shift_label?: string | null;
  };
  /** @deprecated Compatibility alias while downstream shells still read shift-era schedule previews. */
  shifts: EmployeeEventProjection[];
  notifications: EmployeeNotificationRecord[];
  jobs: EmployeeMyWorkJobRecord[];
  live_workflow_steps?: EmployeeMyWorkWorkflowStepRecord[];
  events: EmployeeMyWorkEventRecord[];
  tasks: EmployeeMyWorkTaskRecord[];
  acknowledgements: EmployeeMyWorkAcknowledgementRecord[];
  exceptions: EmployeeMyWorkExceptionRecord[];
  approvals: EmployeeMyWorkApprovalRecord[];
  recent_changes: EmployeeMyWorkRecentChangeRecord[];
  schedule_context: {
    active_now_count: number;
    upcoming_today_count: number;
    current_event: EmployeeMyWorkEventRecord | null;
    next_event: EmployeeMyWorkEventRecord | null;
  };
};

export type EmployeeTradeCandidate = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  authority_tier?: string | null;
  primary_job_function_profile?: string | null;
  level_rank: number;
  roles: string[];
  has_conflict: boolean;
  conflict_summary?: string | null;
  conflict_code?: string | null;
};

export type EmployeeTradeRequestRecord = {
  id: string;
  status: string;
  reason: string;
  created_at: string;
  updated_at?: string | null;
  requested_with_user_id?: string | null;
  requested_with_name?: string | null;
  requester_user_id?: string | null;
  requester_name?: string | null;
  can_cancel: boolean;
};

export type EmployeeShiftExceptionRecord = {
  id: string;
  exception_type: string;
  status: string;
  reason_code?: string | null;
  notes?: string | null;
  created_at: string;
  approved_at?: string | null;
  approved_by_user_id?: string | null;
};

export type EmployeeShiftDetailResponse = {
  shift: {
    id: string;
    shoot_id?: string | null;
    shoot_code?: string | null;
    shoot_title?: string | null;
    shoot_date?: string | null;
    title: string;
    shift_kind: string;
    status: string;
    department: string;
    staffing_role?: string | null;
    satisfies_lead_coverage: boolean;
    starts_at: string;
    ends_at: string;
    arrival_time?: string | null;
    start_time?: string | null;
    end_time_est?: string | null;
    location_name?: string | null;
    location_address?: string | null;
    navigation_url?: string | null;
    estimated_drive_minutes?: number | null;
    manager_user_id?: string | null;
    manager_name?: string | null;
    manager_phone_number?: string | null;
    attendance_state?: string | null;
    attendance_state_note?: string | null;
    segments: Array<{
      id: string;
      segment_kind: string;
      label: string;
      scheduled_start_at: string;
      scheduled_end_at: string;
      actual_start_at?: string | null;
      actual_end_at?: string | null;
      rate_code: string;
      hourly_rate_cents: number;
      sort_order?: number;
    }>;
    punches: Array<{
      id: string;
      direction: "in" | "out";
      client_timestamp: string;
      geofence_status: string;
      gps_confidence: string;
      approval_state: string;
      timing_status?: string | null;
      late_minutes?: number | null;
      early_minutes?: number | null;
      missed_punch_required?: boolean | null;
    }>;
  };
  linked_records: {
    shoot: {
      id: string;
      shoot_code?: string | null;
      title: string;
    } | null;
    organization: {
      id: string;
      display_name: string;
    } | null;
    location: {
      id: string;
      name: string;
      address?: string | null;
    } | null;
  };
  primary_contact: {
    name: string;
    role_label: string;
    phone_number?: string | null;
    call_href?: string | null;
    text_href?: string | null;
  } | null;
  site_contact: {
    label: string;
    value: string;
  } | null;
  pre_service_notes: {
    summary_line: string;
    highlights: Array<{
      label: string;
      text: string;
    }>;
    note_snapshot_hash?: string | null;
    acknowledged: boolean;
  };
  location_context: {
    matched_location_id?: string | null;
    location_name?: string | null;
    location_address?: string | null;
    navigation_url?: string | null;
    estimated_drive_minutes?: number | null;
    location_memory_highlights?: Array<{
      id: string;
      body: string;
      pinned?: boolean | null;
    }>;
    recent_photos: Array<{
      id: string;
      image_url: string;
      source: string;
      caption: string;
      photo_category?:
        | "arrival_entrance"
        | "parking_load_in"
        | "check_in_flow_area"
        | "room_wide_shot"
        | "final_camera_background_setup"
        | "power_staging_storage"
        | "special_constraint_watch_out"
        | null;
      memory_state?: "submitted" | "reviewed" | "added_to_memory" | null;
      promote_to_location_memory?: boolean;
      reviewed_at?: string | null;
      review_note?: string | null;
      uploaded_at?: string | null;
    }>;
    recent_evaluations: Array<{
      id: string;
      shoot_name: string;
      shoot_date: string;
      photographer_name: string;
      eval_status?: "draft" | "submitted" | "reviewed" | "closed" | null;
      overall_outcome?: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
      top_watch_out?: string | null;
      recommendations?: string | null;
      access_details?: string | null;
      late_details?: string | null;
      overall_rating: number;
    }>;
    location_memory_summary?: {
      status: "active" | "needs_refresh" | "archived";
      last_confirmed_at: string | null;
      where_to_go: string | null;
      where_to_park: string | null;
      where_to_set_up: string | null;
      top_watch_out: string | null;
      setup_photos: Array<{
        id: string;
        image_url: string;
        caption: string;
      }>;
    } | null;
  };
  resource_library?: ResourceLibraryView | null;
  closeout_compliance: {
    shift_id: string;
    shoot_id: string | null;
    organization_id: string | null;
    location_id: string | null;
    reminder_threshold_minutes: number;
    setup_photo_required: boolean;
    setup_photo_uploaded: boolean;
    setup_photo_reminder_due: boolean;
    setup_photo_state: "not_required" | "required" | "submitted" | "reviewed" | "added_to_memory";
    post_shoot_evaluation_required: boolean;
    post_shoot_evaluation_submitted: boolean;
    post_shoot_evaluation_state: "not_started" | "draft" | "submitted" | "reviewed" | "closed";
    missing_required_items: Array<"setup_photo" | "post_shoot_evaluation">;
    last_post_shoot_evaluation: {
      id: string;
      eval_status: "draft" | "submitted" | "reviewed" | "closed";
      submitted_at: string | null;
      reviewed_at: string | null;
      closed_at: string | null;
      overall_outcome: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
      overall_shoot_status: "successful" | "completed_with_issues" | "significant_issue" | null;
      staffing_fit: "understaffed" | "right_sized" | "overstaffed" | null;
      setup_difficulty: "low" | "medium" | "high" | null;
      customer_school_readiness: "ready" | "minor_friction" | "major_friction" | null;
      data_roster_readiness: "ready" | "minor_friction" | "major_friction" | null;
      equipment_workflow_issue: "none" | "minor" | "major" | null;
      started_on_time: boolean | null;
      short_summary_note: string | null;
      next_time_recommendation: string | null;
      follow_up_required: boolean;
      major_issue_flag: boolean;
      location_memory_update_suggested: boolean;
      leadership_review_needed: boolean;
      issue_category:
        | "staffing"
        | "attendance_no_show"
        | "setup_room_problem"
        | "parking_load_in"
        | "school_readiness"
        | "data_roster"
        | "equipment_technical"
        | "lighting_environment"
        | "line_flow_traffic"
        | "student_parent_flow"
        | "communication_contact_issue"
        | "special_product_deliverable_issue"
        | "other"
        | null;
      understaffed_role: string | null;
      staffing_change_recommendation: string | null;
      customer_follow_up_needed: boolean;
      recommended_staffing_next_time: number | null;
      recommended_arrival_buffer_minutes: number | null;
      recommended_room_setup_change: string | null;
      special_gear_needed_next_time: string | null;
      top_watch_out: string | null;
      location_memory_promotion_text: string | null;
      went_well: string | null;
      remember_next_time: string | null;
      issue_flag: boolean;
      open_comment: string | null;
      submit_for_mileage: boolean;
      vehicle_type: "personal_vehicle" | "carpool_passenger" | "company_vehicle" | "other_needs_review" | null;
    } | null;
    mileage_reimbursement: {
      work_date: string;
      mileage_eligible: boolean;
      status: string;
      review_reason_code: string | null;
      reimbursement_amount: string | null;
      zone_name: string | null;
      vehicle_type: string | null;
      studio_distance_miles: number | null;
      issue_label: string | null;
      selected_shoot: {
        id: string;
        shoot_code: string | null;
        title: string | null;
      } | null;
    } | null;
    compliance_flags: Array<{
      id: string;
      item_type: string;
      item_label: string;
      severity: "warning" | "high";
      message: string;
      last_detected_at: string;
    }>;
  } | null;
  actions: {
    can_clock: boolean;
    can_upload_setup_photo: boolean;
    can_submit_post_shoot_eval: boolean;
    can_request_trade: boolean;
    can_submit_exception_note: boolean;
    can_submit_missed_punch: boolean;
  };
  ready_to_shoot?: ReadyToShootState | null;
  trade_candidates: EmployeeTradeCandidate[];
  trade_requests: EmployeeTradeRequestRecord[];
  exceptions: EmployeeShiftExceptionRecord[];
};

export type EmployeeEventDetailResponse = EmployeeShiftDetailResponse & {
  event: {
    id: string;
    source: string;
    source_record_type: string;
    source_record_id: string;
    linked_record_type: "work_shift";
    title: string;
    subtitle?: string | null;
    department: string;
    staffing_role?: string | null;
    status: string;
    starts_at: string;
    ends_at: string;
    location_name?: string | null;
    location_address?: string | null;
    navigation_url?: string | null;
    manager_name?: string | null;
    attendance_state?: string | null;
    attendance_state_note?: string | null;
    /** @deprecated Compatibility alias while detailed field actions still reference shift identifiers. */
    shift_id: string;
  };
};

export async function fetchEmployeeMyWork(token: string, anchorDate: string) {
  return apiFetch<EmployeeMyWorkResponse>(`/api/employee/my-work?anchor_date=${encodeURIComponent(anchorDate)}`, token);
}

export async function fetchEmployeeEventDetail(token: string, eventId: string) {
  return apiFetch<EmployeeEventDetailResponse>(`/api/employee/events/${encodeURIComponent(eventId)}`, token);
}

/** @deprecated Use fetchEmployeeEventDetail for My Work event-driven detail loading. */
export async function fetchEmployeeShiftDetail(token: string, shiftId: string) {
  return fetchEmployeeEventDetail(token, shiftId);
}

type EmployeePostShootEvaluationInput = {
  eval_status?: "draft" | "submitted";
  overall_outcome?: "smooth" | "minor_issues" | "major_issues" | "needs_leadership_review" | null;
  overall_shoot_status?: "successful" | "completed_with_issues" | "significant_issue" | null;
  staffing_fit?: "understaffed" | "right_sized" | "overstaffed" | null;
  setup_difficulty?: "low" | "medium" | "high" | null;
  customer_school_readiness?: "ready" | "minor_friction" | "major_friction" | null;
  data_roster_readiness?: "ready" | "minor_friction" | "major_friction" | null;
  equipment_workflow_issue?: "none" | "minor" | "major" | null;
  started_on_time?: boolean | null;
  short_summary_note?: string | null;
  next_time_recommendation?: string | null;
  follow_up_required?: boolean;
  major_issue_flag?: boolean;
  location_memory_update_suggested?: boolean;
  leadership_review_needed?: boolean;
  issue_category?:
    | "staffing"
    | "attendance_no_show"
    | "setup_room_problem"
    | "parking_load_in"
    | "school_readiness"
    | "data_roster"
    | "equipment_technical"
    | "lighting_environment"
    | "line_flow_traffic"
    | "student_parent_flow"
    | "communication_contact_issue"
    | "special_product_deliverable_issue"
    | "other"
    | null;
  understaffed_role?: string | null;
  staffing_change_recommendation?: string | null;
  customer_follow_up_needed?: boolean;
  follow_up_owner_user_id?: string | null;
  recommended_staffing_next_time?: number | null;
  recommended_arrival_buffer_minutes?: number | null;
  recommended_room_setup_change?: string | null;
  special_gear_needed_next_time?: string | null;
  top_watch_out?: string | null;
  location_memory_promotion_text?: string | null;
  went_well?: string | null;
  remember_next_time?: string | null;
  issue_flag?: boolean;
  open_comment?: string | null;
  submit_for_mileage?: boolean;
  vehicle_type?: "personal_vehicle" | "carpool_passenger" | "company_vehicle" | "other_needs_review" | null;
};

export async function submitEmployeeEventPostShootEvaluation(
  token: string,
  eventId: string,
  input: EmployeePostShootEvaluationInput
) {
  return apiFetch(`/api/employee/shifts/${encodeURIComponent(eventId)}/post-shoot-evaluation`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

/** @deprecated Use submitEmployeeEventPostShootEvaluation for My Work event-native closeout actions. */
export async function submitEmployeePostShootEvaluation(
  token: string,
  shiftId: string,
  input: EmployeePostShootEvaluationInput
) {
  return submitEmployeeEventPostShootEvaluation(token, shiftId, input);
}

export async function acknowledgeEmployeeEventNotes(token: string, eventId: string) {
  return apiFetch<{ acknowledged: boolean; event_id: string; shift_id: string; note_snapshot_hash: string }>(
    `/api/employee/events/${encodeURIComponent(eventId)}/acknowledge`,
    token,
    {
      method: "POST"
    }
  );
}

/** @deprecated Use acknowledgeEmployeeEventNotes for My Work event-native acknowledgement actions. */
export async function acknowledgeEmployeeShiftNotes(token: string, shiftId: string) {
  return acknowledgeEmployeeEventNotes(token, shiftId);
}

export async function submitEmployeePunch(
  token: string,
  input: {
    shift_id?: string | null;
    shoot_id?: string | null;
    direction: "in" | "out";
    client_timestamp: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracy_meters?: number | null;
    client_event_id: string;
    approver_user_id?: string | null;
    reason_code?: string | null;
    notes?: string | null;
    source: string;
    work_state?: "office_drive" | "photography" | null;
    confirmed_outside_context?: boolean;
    confirmed_permission?: boolean;
  }
) {
  const response = await apiFetch("/api/attendance/punches", token, {
    method: "POST",
    headers: {
      "Idempotency-Key": input.client_event_id
    },
    body: JSON.stringify(input)
  });
  emitTimeClockStateChanged();
  return response;
}

type EmployeeRunningLateNoticeInput = { notes?: string | null; requested_approver_user_id?: string | null };

export async function submitEmployeeEventRunningLateNotice(
  token: string,
  eventId: string,
  input: EmployeeRunningLateNoticeInput
) {
  return apiFetch(`/api/attendance/shifts/${encodeURIComponent(eventId)}/running-late`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

/** @deprecated Use submitEmployeeEventRunningLateNotice for My Work event-native attendance exception actions. */
export async function submitRunningLateNotice(
  token: string,
  shiftId: string,
  input: EmployeeRunningLateNoticeInput
) {
  return submitEmployeeEventRunningLateNotice(token, shiftId, input);
}

type EmployeeShiftExceptionNoteInput = {
  shift_id: string;
  exception_type: string;
  reason_code: string;
  notes?: string | null;
  requested_approver_user_id?: string | null;
};

type EmployeeEventExceptionNoteInput = Omit<EmployeeShiftExceptionNoteInput, "shift_id"> & {
  event_id: string;
};

export async function submitEmployeeEventExceptionNote(
  token: string,
  input: EmployeeEventExceptionNoteInput
) {
  return apiFetch("/api/attendance/exceptions", token, {
    method: "POST",
    body: JSON.stringify({
      shift_id: input.event_id,
      exception_type: input.exception_type,
      reason_code: input.reason_code,
      notes: input.notes ?? null,
      requested_approver_user_id: input.requested_approver_user_id ?? null
    })
  });
}

/** @deprecated Use submitEmployeeEventExceptionNote for My Work event-native exception actions. */
export async function submitEmployeeExceptionNote(
  token: string,
  input: EmployeeShiftExceptionNoteInput
) {
  return submitEmployeeEventExceptionNote(token, {
    event_id: input.shift_id,
    exception_type: input.exception_type,
    reason_code: input.reason_code,
    notes: input.notes,
    requested_approver_user_id: input.requested_approver_user_id
  });
}

type EmployeeShiftMissedPunchRequestInput = {
  shift_id: string;
  missing_direction: "in" | "out";
  employee_submitted_explanation: string;
  requested_approver_user_id?: string | null;
  corrected_time?: string | null;
  notes?: string | null;
};

type EmployeeEventMissedPunchRequestInput = Omit<EmployeeShiftMissedPunchRequestInput, "shift_id"> & {
  event_id: string;
};

export async function submitEmployeeEventMissedPunchRequest(
  token: string,
  input: EmployeeEventMissedPunchRequestInput
) {
  return apiFetch("/api/attendance/missed-punches", token, {
    method: "POST",
    body: JSON.stringify({
      shift_id: input.event_id,
      missing_direction: input.missing_direction,
      employee_submitted_explanation: input.employee_submitted_explanation,
      requested_approver_user_id: input.requested_approver_user_id ?? null,
      corrected_time: input.corrected_time ?? null,
      notes: input.notes ?? null
    })
  });
}

/** @deprecated Use submitEmployeeEventMissedPunchRequest for My Work event-native attendance correction flows. */
export async function submitEmployeeMissedPunchRequest(
  token: string,
  input: EmployeeShiftMissedPunchRequestInput
) {
  return submitEmployeeEventMissedPunchRequest(token, {
    event_id: input.shift_id,
    missing_direction: input.missing_direction,
    employee_submitted_explanation: input.employee_submitted_explanation,
    requested_approver_user_id: input.requested_approver_user_id,
    corrected_time: input.corrected_time,
    notes: input.notes
  });
}

type EmployeeTradeRequestInput = { requested_with_user_id: string; reason: string };

export async function requestEmployeeEventTrade(
  token: string,
  eventId: string,
  input: EmployeeTradeRequestInput
) {
  return apiFetch(`/api/shifts/${encodeURIComponent(eventId)}/trade-requests`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

/** @deprecated Use requestEmployeeEventTrade for My Work event-native trade flows. */
export async function requestEmployeeTrade(
  token: string,
  shiftId: string,
  input: EmployeeTradeRequestInput
) {
  return requestEmployeeEventTrade(token, shiftId, input);
}

export async function cancelEmployeeTrade(token: string, tradeRequestId: string) {
  return apiFetch(`/api/shifts/trade-requests/${encodeURIComponent(tradeRequestId)}/cancel`, token, {
    method: "POST"
  });
}
