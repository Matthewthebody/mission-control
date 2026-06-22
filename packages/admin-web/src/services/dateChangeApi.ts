import { apiFetch } from "../api";

// June 18 — client for the auditable Shoot date-change workflow (backend 43de7dd / migration 164).
// Creating a request never mutates the Shoot; approval is leadership-gated server-side.

const BASE = "/api/shoots/date-change-requests";

export type DateChangeStatus =
  | "requested" | "feasibility_review" | "alternatives_required" | "awaiting_client"
  | "approved" | "declined" | "canceled" | "completed";

export type DateChangeRequest = {
  id: string;
  shoot_id: string;
  original_shoot_date: string;
  requested_shoot_date: string;
  request_reason: string | null;
  request_source: string;
  current_status: DateChangeStatus;
  capacity_result: string;
  staffing_result: string;
  equipment_result: string;
  schedule_conflict_result: string;
  affected_bookings: unknown[];
  alternatives_offered: unknown[];
  selected_alternative: unknown | null;
  client_communication_reference: string | null;
  decision: string | null;
  final_shoot_date: string | null;
  original_shoot_date_iso?: string;
};
export type DateChangeEvent = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  communication_reference: string | null;
  created_at: string;
};

export async function createDateChangeRequest(
  token: string,
  input: { shoot_id: string; requested_shoot_date: string; request_reason?: string | null; request_source?: string; requested_by_contact_id?: string | null; client_communication_reference?: string | null; idempotency_key?: string | null }
) {
  return apiFetch<{ request: DateChangeRequest; created: boolean }>(BASE, token, { method: "POST", body: JSON.stringify(input) });
}

export async function listDateChangeRequestsForShoot(token: string, shootId: string) {
  return apiFetch<{ requests: DateChangeRequest[] }>(`${BASE}/shoot/${shootId}`, token);
}

export async function getDateChangeRequest(token: string, id: string) {
  return apiFetch<{ request: DateChangeRequest; events: DateChangeEvent[] }>(`${BASE}/${id}`, token);
}

export async function runDateChangeFeasibility(token: string, id: string) {
  return apiFetch<{ overall: string; capacity_result: string; staffing_result: string; equipment_result: string; schedule_conflict_result: string; affected_bookings: unknown[] }>(`${BASE}/${id}/feasibility`, token, { method: "POST", body: "{}" });
}

export async function recordDateChangeAlternative(token: string, id: string, alternative: Record<string, unknown>) {
  return apiFetch<{ recorded: boolean }>(`${BASE}/${id}/alternatives`, token, { method: "POST", body: JSON.stringify({ alternative }) });
}

export async function transitionDateChange(token: string, id: string, toStatus: DateChangeStatus, opts: { reason?: string | null; communication_reference?: string | null } = {}) {
  return apiFetch<{ from: string; to: string }>(`${BASE}/${id}/transition`, token, { method: "POST", body: JSON.stringify({ to_status: toStatus, ...opts }) });
}

export async function decideDateChange(token: string, id: string, decision: "approved" | "declined" | "canceled", opts: { final_shoot_date?: string | null; reason?: string | null } = {}) {
  return apiFetch<{ decision: string; final_shoot_date?: string; original_shoot_date: string }>(`${BASE}/${id}/decision`, token, { method: "POST", body: JSON.stringify({ decision, ...opts }) });
}
