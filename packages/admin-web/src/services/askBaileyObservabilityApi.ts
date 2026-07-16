import { apiFetch } from "../api";

// Ask Bailey H7 — reviewer-gated observability + release-gate client.

export type ObservabilitySummary = {
  window_days: number;
  provider_usage: Array<{ provider: string; status: string; events: number; prompt_tokens: number; completion_tokens: number; est_cost_cents: number; avg_latency_ms: number }>;
  answer_states: Array<{ status: string; n: number }>;
  citations: { total: number; invalid: number };
  unresolved_open: number;
  training: { assignments: number; readiness_attempts: number; needs_review: number };
};

export type ReleaseGate = { id: string; title: string; status: "pass" | "fail" | "external"; detail: string };
export type ReleaseGateReport = { generated_for_tenant: string; overall: "pass" | "fail"; gates: ReleaseGate[] };

export function getObservability(token: string, windowDays = 30) {
  return apiFetch<ObservabilitySummary>(`/api/ask-bailey/observability?window_days=${windowDays}`, token);
}

export function getReleaseGate(token: string) {
  return apiFetch<ReleaseGateReport>(`/api/ask-bailey/release-gate`, token);
}
