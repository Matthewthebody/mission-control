import { useEffect, useState } from "react";
import { ApiClientError } from "../api";
import { KpiStatCard } from "../components/sports/SportsPrimitives";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { getSportsReports } from "../services/sportsApi";
import type { SportsReportsResponse } from "../sportsTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function SportsReports({ token }: Props) {
  const [payload, setPayload] = useState<SportsReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void getSportsReports(token)
      .then((response) => {
        if (!cancelled) {
          setPayload(response);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load sports reports right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports reports" summary="Opening starter metrics for sports readiness, staffing, approvals, specialty products, and watch frequency." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Reports"
        summary="Starter reporting for published sports jobs, readiness rate, staffing gaps, proof delays, blocked production, and watch-flag frequency."
      />
      {error ? <div className="error-banner">{error}</div> : null}
      {payload?.starter_metrics.length ? (
        <div className="sports-kpi-grid">
          {payload.starter_metrics.map((metric) => (
            <KpiStatCard
              key={metric.key}
              card={{
                key: metric.key,
                label: metric.label,
                value: Number(metric.value ?? 0),
                tone: metric.key.includes("blocked") || metric.key.includes("delay") ? "warning" : "info",
                action_hash: "#sports/shoots",
                detail: metric.detail
              }}
            />
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="Sports reports are not populated yet" summary="This route is wired and ready for deeper reporting, but it currently exposes the starter metrics only." />
      )}
    </section>
  );
}
