import { useCallback, useEffect, useState } from "react";
import {
  getObservability,
  getReleaseGate,
  type ObservabilitySummary,
  type ReleaseGateReport
} from "../services/askBaileyObservabilityApi";

// Ask Bailey H7 — reviewer-only production health. Aggregate provider usage,
// answer-state mix, citation integrity, and the machine-computed release gate.
// No prompts or protected excerpts are shown here — only counts and states.

type Props = { token: string };

function GateBadge({ status }: { status: "pass" | "fail" | "external" }) {
  const label = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "external";
  const color = status === "fail" ? "var(--danger-color, #c53030)" : status === "pass" ? "var(--success-color, #2f855a)" : "inherit";
  return <span className="badge-pill" style={{ color }}>{label}</span>;
}

export default function AskBaileyObservability({ token }: Props) {
  const [summary, setSummary] = useState<ObservabilitySummary | null>(null);
  const [gate, setGate] = useState<ReleaseGateReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([getObservability(token), getReleaseGate(token)]);
      setSummary(s);
      setGate(g);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Ask Bailey health.");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="workspace-shell ask-bailey-observability" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div className="section-title">Ask Bailey — production health</div>
        <p className="section-subtitle">Reviewer-only. Aggregate telemetry and the release-readiness gate; no prompt content is stored or shown here.</p>
        {error ? <p role="alert">{error}</p> : null}
      </section>

      {gate ? (
        <section className="panel">
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              Release gate
            </div>
            <GateBadge status={gate.overall === "pass" ? "pass" : "fail"} />
          </div>
          <ul style={{ marginTop: "0.5rem" }}>
            {gate.gates.map((g) => (
              <li key={g.id} style={{ marginBottom: "0.25rem" }}>
                <GateBadge status={g.status} /> <strong>{g.title}</strong>
                <div style={{ fontSize: "0.82rem", opacity: 0.8 }}>{g.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary ? (
        <section className="panel">
          <div className="section-title">Last {summary.window_days} days</div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <span className="badge-pill">Citations: {summary.citations.total}</span>
            <span className="badge-pill" style={{ color: summary.citations.invalid > 0 ? "var(--danger-color, #c53030)" : undefined }}>
              Invalid citations: {summary.citations.invalid}
            </span>
            <span className="badge-pill">Open questions: {summary.unresolved_open}</span>
            <span className="badge-pill">Training assignments: {summary.training.assignments}</span>
            <span className="badge-pill">Readiness attempts: {summary.training.readiness_attempts}</span>
            <span className="badge-pill">Needs trainer review: {summary.training.needs_review}</span>
          </div>
          <strong>Answer states</strong>
          <ul style={{ fontSize: "0.85rem" }}>
            {summary.answer_states.length === 0 ? <li>No answers in window.</li> : summary.answer_states.map((s) => <li key={s.status}>{s.status.replace(/_/g, " ")}: {s.n}</li>)}
          </ul>
          <strong>Provider usage</strong>
          <ul style={{ fontSize: "0.85rem" }}>
            {summary.provider_usage.length === 0 ? (
              <li>No provider events in window.</li>
            ) : (
              summary.provider_usage.map((u, i) => (
                <li key={`${u.provider}-${u.status}-${i}`}>
                  {u.provider} · {u.status}: {u.events} events, {u.prompt_tokens + u.completion_tokens} tokens, {u.est_cost_cents}¢ est, {u.avg_latency_ms}ms avg
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
