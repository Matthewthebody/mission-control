import { apiFetch } from "../api";

export type EmployeeStaffingAssignmentState =
  | "awaiting"
  | "needs_attention"
  | "overdue"
  | "acknowledged"
  | "declined"
  | "canceled";

export type EmployeeStaffingAssignment = {
  recipient_id: string;
  shoot_id: string;
  shoot_code: string;
  shoot_title: string;
  organization_name: string | null;
  version: number;
  shoot_date: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  location_name: string | null;
  location_address: string | null;
  assignments: Array<{
    staffing_role?: string | null;
    satisfies_lead_coverage?: boolean;
    starts_at?: string | null;
    ends_at?: string | null;
    call_time?: string | null;
  }>;
  lead_coverage: boolean;
  response_status: string;
  acknowledgment_state: EmployeeStaffingAssignmentState;
  acknowledgment_due_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  carried_forward: boolean;
  requires_renewed_acknowledgment: boolean;
  can_acknowledge: boolean;
  can_decline: boolean;
  schedule_link: string;
};

export async function fetchEmployeeStaffingAssignments(token: string) {
  return apiFetch<{ assignments: EmployeeStaffingAssignment[] }>("/api/employee/staffing-assignments", token);
}

export async function acknowledgeEmployeeStaffingAssignment(token: string, recipientId: string) {
  return apiFetch<{ assignment: EmployeeStaffingAssignment }>(
    `/api/employee/staffing-assignments/${encodeURIComponent(recipientId)}/acknowledge`,
    token,
    { method: "POST" }
  );
}

export async function declineEmployeeStaffingAssignment(token: string, recipientId: string, reason: string) {
  return apiFetch<{ assignment: EmployeeStaffingAssignment }>(
    `/api/employee/staffing-assignments/${encodeURIComponent(recipientId)}/decline`,
    token,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}
