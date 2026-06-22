import { apiFetch } from "../api";

// June 18 — client for the canonical Production operating read model. React never re-totals:
// metrics come straight from the server (displayed count === filtered total).

export type ProductionMetric = { key: string; available: boolean; count: number | null; reason?: string };
export type ProductionRow = {
  source_type: "production_project";
  source_id: string;
  job_id: string | null;
  organization_id: string | null;
  title: string;
  stage: string;
  current_step: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  next_action: string | null;
  waiting_on: string | null;
  missing_inputs: number;
  blocker_count: number;
  approval_state: string;
  risk: "none" | "warning" | "critical";
  age_in_stage_days: number | null;
  exact_destination_hash: string;
  provenance: string;
};
export type ProductionOperations = {
  generated_at: string;
  scope: "all" | "own";
  metrics: ProductionMetric[];
  rows: ProductionRow[];
  page: { limit: number; offset: number; total: number };
};

export async function getProductionOperations(
  token: string,
  filters: { stage?: string | null; risk?: string | null; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams();
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.risk) params.set("risk", filters.risk);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const query = params.toString();
  return apiFetch<ProductionOperations>(`/api/production/operations${query ? `?${query}` : ""}`, token);
}

// Map the read-model metric keys to human labels + the canonical status filter they open.
export const PRODUCTION_METRIC_LABELS: Record<string, string> = {
  ready_to_delegate: "Ready to Delegate",
  working: "Working",
  blocked: "Blocked",
  unowned: "Unowned",
  behind_promised_delivery: "Behind Promised Delivery",
  missing_inputs: "Missing Inputs",
  delivery_risk: "Delivery Risk",
  done_recently: "Done Recently"
};
// metric → the canonical `status` stage filter it should open (null = no direct stage filter).
export const PRODUCTION_METRIC_STAGE: Record<string, string | null> = {
  ready_to_delegate: "new",
  working: "active",
  blocked: "blocked",
  unowned: null,
  behind_promised_delivery: null,
  missing_inputs: null,
  delivery_risk: null,
  done_recently: null
};
