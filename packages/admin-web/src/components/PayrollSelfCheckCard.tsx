import { useEffect, useState } from "react";
import { getMySelfCheck, type MySelfCheckPayload } from "../services/laborCommandCenterApi";

type Props = {
  token: string;
};

// Compact heads-up card for the My Work surface. Renders ONLY while the payroll
// self-check window is open and the employee has not confirmed yet — no dead card,
// no fabricated state. The full flow lives at #my-work/payroll-self-check.
export function PayrollSelfCheckCard({ token }: Props) {
  const [payload, setPayload] = useState<MySelfCheckPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMySelfCheck(token)
      .then((next) => {
        if (!cancelled) {
          setPayload(next);
        }
      })
      .catch(() => {
        // Heads-up card only: stay silent on failure; the dedicated page reports errors.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!payload || payload.window_state !== "open" || payload.self_check?.status === "confirmed") {
    return null;
  }

  const lockLabel = payload.period?.lock_scheduled_at
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }).format(
        new Date(payload.period.lock_scheduled_at)
      )
    : null;

  return (
    <section className="panel my-work-self-check-card">
      <div className="section-title">Payroll self-check is open</div>
      <p className="section-subtitle">
        Review your time for {payload.period?.period_start} – {payload.period?.period_end}
        {lockLabel ? ` before payroll locks ${lockLabel}` : ""}.{" "}
        {payload.open_discrepancy_count > 0
          ? `${payload.open_discrepancy_count} of your problem report(s) are still being reviewed.`
          : ""}
      </p>
      <button type="button" onClick={() => (window.location.hash = "#my-work/payroll-self-check")}>
        Review my time
      </button>
    </section>
  );
}
