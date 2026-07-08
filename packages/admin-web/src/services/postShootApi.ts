import { apiFetch } from "../api";

// SSA-2/SSA-3 — client for the post-shoot evaluation obligations read model. Scope is
// SERVER-derived: managers get "team", everyone else gets "own" (only their rows).

export type EvaluationObligation = {
  obligation_id: string;
  shift_id: string;
  shoot_id: string;
  shoot_title: string;
  shoot_code: string | null;
  shoot_date: string | null;
  employee_id: string;
  employee_name: string | null;
  role_on_shoot: string;
  is_lead: boolean;
  template_type: "standard" | "lead_10_question";
  status: "required" | "submitted";
  blocks_mileage: boolean;
  exact_destination_hash: string;
  focus_reason: string;
};

export type EvaluationObligationsPayload = {
  as_of: string;
  scope: "team" | "own";
  summary: {
    total_obligations: number;
    submitted_count: number;
    outstanding_count: number;
    outstanding_lead_count: number;
    mileage_blocked_photographer_count: number;
    shoots_covered: number;
  };
  items_total: number;
  items_shown: number;
  items: EvaluationObligation[];
};

export async function getEvaluationObligations(token: string, filters: { windowDays?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.windowDays != null) params.set("window_days", String(filters.windowDays));
  const query = params.toString();
  return apiFetch<EvaluationObligationsPayload>(
    `/api/post-shoot/evaluation-obligations${query ? `?${query}` : ""}`,
    token
  );
}
