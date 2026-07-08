import { useEffect, useState } from "react";
import { getEvaluationObligations, type EvaluationObligationsPayload } from "../services/postShootApi";

type Props = {
  token: string;
};

// Compact heads-up card for the My Work surface (PayrollSelfCheckCard pattern): renders ONLY
// when the signed-in employee has outstanding post-shoot evaluations — no dead card, no
// fabricated state. Scope is server-derived ("own" for employees), so this can never leak
// another photographer's obligations. HONESTY NOTE: admin-web has no evaluation form — the
// eval is completed from the shift closeout flow on mobile — so this card informs and lists
// but deliberately offers no fake "complete it here" action.
export function PostShootEvaluationsDueCard({ token }: Props) {
  const [payload, setPayload] = useState<EvaluationObligationsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvaluationObligations(token, { windowDays: 14 })
      .then((next) => {
        if (!cancelled) {
          setPayload(next);
        }
      })
      .catch(() => {
        // Heads-up card only: stay silent on failure; nothing here fabricates state.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!payload || payload.scope !== "own" || payload.summary.outstanding_count === 0) {
    return null;
  }

  const outstanding = payload.items.filter((item) => item.status === "required");
  const shown = outstanding.slice(0, 3);

  return (
    <section className="panel my-work-self-check-card">
      <div className="section-title">Post-shoot evaluations due</div>
      <p className="section-subtitle">
        {payload.summary.outstanding_count === 1
          ? "1 shoot still needs your post-shoot evaluation."
          : `${payload.summary.outstanding_count} shoots still need your post-shoot evaluation.`}{" "}
        Mileage reimbursement stays blocked for each shoot until its evaluation is submitted.
      </p>
      <ul className="section-subtitle">
        {shown.map((item) => (
          <li key={item.obligation_id}>
            {item.shoot_title}
            {item.shoot_date ? ` — ${item.shoot_date}` : ""}
            {item.template_type === "lead_10_question" ? " (lead evaluation)" : ""}
          </li>
        ))}
      </ul>
      {outstanding.length > shown.length ? (
        <p className="section-subtitle">Showing the first {shown.length} of {payload.summary.outstanding_count}.</p>
      ) : null}
      <p className="section-subtitle">Complete each evaluation from your shift closeout on mobile.</p>
    </section>
  );
}
