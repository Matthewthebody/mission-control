import { apiFetch } from "../api";

// Labor Command Center API service — pay-period lifecycle, payroll self-check,
// overtime warnings, and the QuickBooks export boundary (/api/labor/*).

export type PayrollPeriodStatus =
  | "open"
  | "self_check_open"
  | "manager_review"
  | "payroll_review"
  | "owner_review"
  | "locked"
  | "exported"
  | "synced"
  | "correction_needed";

export type PayrollPeriodPreview = {
  id: string;
  period_start: string;
  period_end: string;
  status: PayrollPeriodStatus;
  lock_scheduled_at: string | null;
};

export type PayrollPeriodSummary = PayrollPeriodPreview & {
  self_check_opened_at: string | null;
  locked_at: string | null;
  exported_at: string | null;
  synced_at: string | null;
  correction_reason: string | null;
  last_reminder_stage: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
  session_count: number;
  employee_count: number;
  self_check_total: number;
  self_check_confirmed: number;
  self_check_discrepancy: number;
  open_self_check_items: number;
  open_exception_requests: number;
  unresolved_geofence_punches: number;
  edited_after_review_count: number;
  export_batch_count: number;
};

export type SelfCheckResponseKind =
  | "looks_correct"
  | "something_wrong"
  | "missing_punch"
  | "no_break_taken"
  | "wrong_job_location"
  | "worked_extra_time";

export type SelfCheckDay = {
  work_date: string;
  session_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_worked_minutes: number;
  payable_minutes: number;
  lunch_deduction_minutes: number;
  lunch_deduction_source: string | null;
  shift_title: string | null;
  shoot_title: string | null;
  location_name: string | null;
  manager_edit_count: number;
  open_exception_count: number;
  geofence_exception: boolean;
  responses: Array<{
    id: string;
    response: SelfCheckResponseKind;
    note: string | null;
    resolution_status: "open" | "resolved" | "dismissed";
    linked_exception_request_id: string | null;
    created_at: string;
  }>;
};

export type MySelfCheckPayload = {
  window_state: "not_open" | "open" | "closed";
  period: PayrollPeriodPreview | null;
  self_check: { id: string; status: "pending" | "confirmed" | "discrepancy_reported"; confirmed_at: string | null } | null;
  days: SelfCheckDay[];
  open_discrepancy_count: number;
};

export type SelfCheckBoardRow = {
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  self_check_status: "pending" | "confirmed" | "discrepancy_reported" | "not_started";
  confirmed_at: string | null;
  open_discrepancy_count: number;
  missing_punch_claims: number;
  no_break_claims: number;
  open_exception_requests: number;
  unresolved_geofence_punches: number;
  total_worked_minutes: number;
  payable_minutes: number;
  pay_code_minutes: Record<string, number>;
  travel_review_minutes: number;
  is_part_time: boolean;
  edited_after_review: boolean;
  payroll_ready: boolean;
};

export type SelfCheckOpenItem = {
  item_id: string;
  employee_id: string;
  employee_name: string | null;
  work_date: string;
  response: SelfCheckResponseKind;
  note: string | null;
  manager_approved_claimed: boolean;
  linked_exception_request_id: string | null;
  created_at: string;
};

export type SelfCheckBoard = {
  period: PayrollPeriodPreview;
  open_items: SelfCheckOpenItem[];
  summary: {
    employee_count: number;
    confirmed_count: number;
    pending_count: number;
    discrepancy_count: number;
    open_discrepancy_items: number;
    no_break_claims: number;
    missing_punch_claims: number;
    unresolved_geofence_punches: number;
    payroll_ready_count: number;
    travel_review_minutes: number;
  };
  rows: SelfCheckBoardRow[];
};

export type OvertimeWarning = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  workweek_start: string;
  warning_type: string;
  severity: "info" | "warning" | "critical";
  status: "active" | "acknowledged" | "approved" | "resolved";
  actual_minutes: number;
  projected_minutes: number;
  threshold_minutes: number;
  details: { message?: string } & Record<string, unknown>;
  first_detected_at: string;
  last_evaluated_at: string;
};

export type MyOvertimeStatus = {
  workweek_start: string;
  workweek_end: string;
  actual_minutes: number;
  open_session_minutes: number;
  remaining_scheduled_minutes: number;
  projected_minutes: number;
  threshold_minutes: number;
  minutes_to_threshold: number;
  in_overtime: boolean;
  warnings: Array<{ warning_type: string; severity: "info" | "warning" | "critical"; message: string }>;
} | null;

export type LaborCommandCenterOverview = {
  generated_at: string;
  access: { can_manage_periods: boolean; can_finalize_payroll: boolean };
  period: PayrollPeriodPreview & {
    self_check_opened_at: string | null;
    locked_at: string | null;
    exported_at: string | null;
    synced_at: string | null;
    correction_reason: string | null;
  };
  self_check: SelfCheckBoard["summary"];
  overtime: {
    active_warning_count: number;
    critical_warning_count: number;
    warnings: OvertimeWarning[];
  };
  blockers: {
    open_exception_requests: number;
    unresolved_geofence_punches: number;
    open_self_check_items: number;
    missing_manager_approvals: number;
    edited_after_review_count: number;
  };
  export_readiness: {
    can_lock: boolean;
    can_export: boolean;
    quickbooks_ready: boolean;
    export_batch_count: number;
    last_export_at: string | null;
  };
  recent_events: Array<{
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    reason: string | null;
    actor_name: string | null;
    created_at: string;
  }>;
};

export type QuickBooksStatus = {
  connection: {
    environment: "sandbox" | "production";
    connection_status: "not_connected" | "connected" | "error" | "expired";
    realm_id: string | null;
    last_connected_at: string | null;
    last_error: string | null;
  };
  employee_mappings: {
    mapped_count: number;
    active_employee_count: number;
    unmapped_employees: Array<{ employee_id: string; employee_name: string | null; department: string | null }>;
  };
  pay_type_mappings: {
    mapped_categories: string[];
    missing_categories: string[];
  };
  quickbooks_ready: boolean;
};

export const PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  open: "Open",
  self_check_open: "Self-Check Open",
  manager_review: "Manager Review",
  payroll_review: "Payroll Review",
  owner_review: "Owner Review",
  locked: "Locked",
  exported: "Exported",
  synced: "Synced",
  correction_needed: "Correction Needed"
};

export const SELF_CHECK_RESPONSE_LABELS: Record<SelfCheckResponseKind, string> = {
  looks_correct: "Looks correct",
  something_wrong: "Something is wrong",
  missing_punch: "Missing punch",
  no_break_taken: "I did not take a break",
  wrong_job_location: "Wrong job/location",
  worked_extra_time: "I worked extra time"
};

export function getLaborCommandCenter(token: string, date?: string) {
  const search = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiFetch<LaborCommandCenterOverview>(`/api/labor/command-center${search}`, token);
}

export function getMySelfCheck(token: string) {
  return apiFetch<MySelfCheckPayload>("/api/labor/self-check/current", token);
}

export function submitSelfCheckResponse(
  token: string,
  input: {
    period_id: string;
    work_date: string;
    response: SelfCheckResponseKind;
    note?: string | null;
    manager_approved_claimed?: boolean;
  }
) {
  return apiFetch<{ item_id: string; linked_exception_request_id: string | null }>("/api/labor/self-check/responses", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function confirmSelfCheck(token: string, periodId: string) {
  return apiFetch<{ self_check_id: string; status: "confirmed"; confirmed_at: string }>("/api/labor/self-check/confirm", token, {
    method: "POST",
    body: JSON.stringify({ period_id: periodId })
  });
}

export function getSelfCheckBoard(token: string, periodId: string) {
  return apiFetch<SelfCheckBoard>(`/api/labor/periods/${periodId}/self-check-board`, token);
}

export function resolveSelfCheckItem(
  token: string,
  itemId: string,
  input: { resolution: "resolved" | "dismissed"; resolution_note?: string | null }
) {
  return apiFetch<{ item_id: string; resolution_status: string }>(`/api/labor/self-check/items/${itemId}/resolve`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getMyOvertime(token: string) {
  return apiFetch<{ status: MyOvertimeStatus }>("/api/labor/overtime/mine", token);
}

export function getOvertimeWarnings(token: string) {
  return apiFetch<{ warnings: OvertimeWarning[] }>("/api/labor/overtime/warnings", token);
}

export function acknowledgeOvertimeWarning(token: string, warningId: string) {
  return apiFetch<{ id: string; status: "acknowledged" }>(`/api/labor/overtime/warnings/${warningId}/acknowledge`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function approveOvertimeWarning(token: string, warningId: string) {
  return apiFetch<{ id: string; status: "approved" }>(`/api/labor/overtime/warnings/${warningId}/approve`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export type QuickBooksSyncResult = {
  period_id: string;
  line_count: number;
  success_count: number;
  duplicate_count: number;
  error_count: number;
  results: Array<{ employee_id: string; pay_code: string; minutes: number; sync_status: string; sync_error: string | null }>;
};

export function sendApprovedTimeToQuickBooks(token: string, periodId: string) {
  return apiFetch<QuickBooksSyncResult>(`/api/labor/periods/${periodId}/quickbooks-sync`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export type PayrollCalendarConfig = {
  period_length_days: number;
  reference_period_start: string;
  close_offset_hours: number;
  self_check_window_hours: number;
  travel_policy: Record<string, unknown>;
  is_default: boolean;
};

export function getPayrollCalendarConfig(token: string) {
  return apiFetch<{ config: PayrollCalendarConfig }>("/api/labor/calendar-config", token);
}

export function ensureCurrentPeriod(token: string) {
  return apiFetch<{ period: PayrollPeriodSummary }>("/api/labor/periods/ensure-current", token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function listPayrollPeriods(token: string) {
  return apiFetch<{ periods: PayrollPeriodSummary[] }>("/api/labor/periods", token);
}

export function transitionPayrollPeriod(
  token: string,
  periodId: string,
  input: { to_status: PayrollPeriodStatus; reason?: string | null }
) {
  return apiFetch<{ period: PayrollPeriodSummary }>(`/api/labor/periods/${periodId}/transition`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updatePayrollPeriodSchedule(token: string, periodId: string, lockScheduledAt: string | null) {
  return apiFetch<{ period: PayrollPeriodSummary }>(`/api/labor/periods/${periodId}/schedule`, token, {
    method: "POST",
    body: JSON.stringify({ lock_scheduled_at: lockScheduledAt })
  });
}

export function openSelfCheckWindow(token: string, periodId: string) {
  return apiFetch<{ period_id: string; seeded_employee_count: number }>(`/api/labor/periods/${periodId}/open-self-check`, token, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getQuickBooksStatus(token: string) {
  return apiFetch<QuickBooksStatus>("/api/labor/quickbooks/status", token);
}

export function createExportBatch(token: string, periodId: string) {
  return apiFetch<{ batch: { id: string; file_name: string; row_count: number; generated_at: string }; csv: string }>(
    `/api/labor/periods/${periodId}/export-batches`,
    token,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function formatMinutesAsHours(minutes: number) {
  const hours = minutes / 60;
  return `${hours.toFixed(hours >= 10 ? 1 : 2)}h`;
}
