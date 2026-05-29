import { mobileFetch } from "./api";

export type FieldWorkflowKind =
  | "briefing_acknowledgement"
  | "attendance_time_correction_request"
  | "pto_availability_request"
  | "field_issue_report"
  | "location_memory_suggestion"
  | "directory_update_suggestion"
  | "staffing_help_request";

export type FieldIssueSeverity = "minor" | "major" | "immediate_help_needed";

export type FieldWorkflowTemplate = {
  id: FieldWorkflowKind;
  title: string;
  subtitle: string;
  reviewLabel: string;
  offlineLabel: string;
  nextStepLabel: string;
};

export const FIELD_WORKFLOW_TEMPLATES: Record<FieldWorkflowKind, FieldWorkflowTemplate> = {
  briefing_acknowledgement: {
    id: "briefing_acknowledgement",
    title: "Pre-Service / Briefing Acknowledgment",
    subtitle: "Confirm the briefing, top watch-outs, and any question or issue before the shift gets moving.",
    reviewLabel: "Stored as a confirmation on this assignment.",
    offlineLabel: "Can be saved locally and submitted when signal returns.",
    nextStepLabel: "The shift stays linked and the assigned record reflects the acknowledgement."
  },
  attendance_time_correction_request: {
    id: "attendance_time_correction_request",
    title: "Attendance / Time Correction Request",
    subtitle: "Capture the exact issue, suggested timing, and short reason without silently rewriting time history.",
    reviewLabel: "Manager review is required before any protected time record changes.",
    offlineLabel: "JSON requests can queue locally until sync succeeds.",
    nextStepLabel: "The manager time review queue will show the correction path and related shift context."
  },
  pto_availability_request: {
    id: "pto_availability_request",
    title: "PTO / Availability Request",
    subtitle: "Submit time off or availability restrictions with date range, partial-day timing, and a clear reason.",
    reviewLabel: "Approval status stays tied to the real availability workflow.",
    offlineLabel: "Requests can be saved locally and queued for later sync.",
    nextStepLabel: "Managers will review coverage impact before approving or rejecting."
  },
  field_issue_report: {
    id: "field_issue_report",
    title: "Field Issue Report",
    subtitle: "Report the operational problem with category, severity, and a short summary so the right team can intervene.",
    reviewLabel: "Major and immediate-help issues notify the manager chain.",
    offlineLabel: "Structured submissions can queue locally when signal is weak.",
    nextStepLabel: "This creates a reviewable operational record tied to the assignment."
  },
  location_memory_suggestion: {
    id: "location_memory_suggestion",
    title: "Location Memory Suggestion",
    subtitle: "Suggest reusable parking, entrance, setup, staffing, or watch-out guidance for future crews.",
    reviewLabel: "Managers review this before promoting it into published location memory.",
    offlineLabel: "Suggestions can be saved locally and queued for later sync.",
    nextStepLabel: "Approved items can become future crew guidance."
  },
  directory_update_suggestion: {
    id: "directory_update_suggestion",
    title: "Contact / Directory Update Suggestion",
    subtitle: "Suggest a contact change, title change, new contact, wrong contact, or owner change without editing the directory directly.",
    reviewLabel: "Directory owners review and confirm the change before it becomes permanent.",
    offlineLabel: "Suggestions can be saved locally and queued for later sync.",
    nextStepLabel: "The suggestion lands as a reviewable operational record."
  },
  staffing_help_request: {
    id: "staffing_help_request",
    title: "Staffing Help / Coverage Request",
    subtitle: "Surface running-late, coverage risk, team-member-missing, or replacement needs as staffing actions instead of loose notes.",
    reviewLabel: "Manager-level staffing visibility is triggered from the request.",
    offlineLabel: "Structured requests can queue locally when needed.",
    nextStepLabel: "The coverage issue routes into staffing visibility and the manager chain."
  }
};

export type EmployeeShiftFormSubmissionResult = {
  form_type: "field_issue_report" | "location_memory_suggestion" | "directory_update_suggestion" | "staffing_help_request";
  submission_state: "submitted";
  review_state: "needs_review";
  next_step_message: string;
  related_shift: {
    id: string;
    title: string;
    shoot_id: string | null;
    shoot_code: string | null;
    location_name: string | null;
  };
  derived_record: {
    type: "operational_note";
    id: string;
    source_context: string;
  };
  notification_recipients_count: number;
};

export type EmployeeShiftDetailFormContext = {
  shift: {
    id: string;
    shoot_id: string | null;
    shoot_code: string | null;
    shoot_title: string | null;
    staffing_role: string | null;
    satisfies_lead_coverage: boolean;
    location_name: string | null;
    location_address: string | null;
    manager_name?: string | null;
    manager_user_id?: string | null;
  };
  linked_records: {
    shoot: {
      id: string;
      shoot_code: string | null;
      title: string;
    } | null;
    organization: {
      id: string;
      display_name: string;
    } | null;
    location: {
      id: string;
      name: string;
      address: string | null;
    } | null;
  };
  pre_service_notes?: {
    summary_line: string;
    highlights: Array<{ label: string; text: string }>;
    note_snapshot_hash: string | null;
    acknowledged: boolean;
  };
  location_context?: {
    location_memory_summary?: string | null;
  };
};

export function buildFieldWorkflowDraftKey(kind: FieldWorkflowKind, shiftId?: string | null) {
  return shiftId ? `${kind}:${shiftId}` : `${kind}:global`;
}

export function defaultPostSubmitMessage(kind: FieldWorkflowKind, queuedOffline: boolean) {
  if (queuedOffline) {
    return "Saved locally and queued for sync. Mission Control will submit it when signal returns.";
  }
  return kind === "briefing_acknowledgement"
    ? "Briefing acknowledgment submitted."
    : kind === "attendance_time_correction_request"
      ? "Correction request submitted for manager review."
      : kind === "pto_availability_request"
        ? "Availability request submitted for review."
        : "Submission saved.";
}

export async function fetchEmployeeShiftDetailFormContext(token: string, shiftId: string) {
  return mobileFetch<EmployeeShiftDetailFormContext>(`/api/employee/shifts/${shiftId}`, token);
}

export async function submitEmployeeShiftFieldWorkflow(
  token: string,
  shiftId: string,
  payload: Record<string, unknown>
) {
  return mobileFetch<EmployeeShiftFormSubmissionResult>(`/api/employee/shifts/${shiftId}/form-submissions`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function acknowledgeBriefing(token: string, shiftId: string) {
  return mobileFetch<{ acknowledged: boolean; note_snapshot_hash: string | null }>(`/api/employee/shifts/${shiftId}/acknowledge`, token, {
    method: "POST"
  });
}

export async function submitAvailabilityRequest(token: string, payload: Record<string, unknown>) {
  return mobileFetch("/api/shifts/pto-requests", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function submitMissedPunchRequest(token: string, payload: Record<string, unknown>) {
  return mobileFetch("/api/attendance/missed-punches", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function submitAttendanceException(token: string, payload: Record<string, unknown>) {
  return mobileFetch("/api/attendance/exceptions", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
