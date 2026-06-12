import { useEffect, useState } from "react";
import { ProjectTrackingLeadershipVisibility } from "../../pages/ProjectTrackingFoundation";
import { getProjectWorkflowCommandCenter } from "../../services/projectTracking";
import type { ProjectWorkflowJobRow } from "../../projectTrackingTypes";

type Props = {
  token: string;
};

/**
 * Leadership home for the operating report. Fetches the same project command-center
 * rows Project Tracking uses and renders the shared ProjectTrackingLeadershipVisibility
 * report (active by stage, blocked, missing info, upcoming load, department workload,
 * overdue, unassigned, waiting split, production bottlenecks, calendar readiness,
 * client-risk, urgent changes, prior-risk). This is the single home for the report;
 * Project Tracking no longer renders it.
 */
export function LeadershipOperatingReport({ token }: Props) {
  const [rows, setRows] = useState<ProjectWorkflowJobRow[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getProjectWorkflowCommandCenter(token, { view: "global", limit: 100 })
      .then((payload) => {
        if (!cancelled) {
          setRows(payload.job_rows);
          setGeneratedAt(payload.generated_at ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Resilient: a calm loading line and an honest error line — never fake fallback metrics.
  if (failed) {
    return (
      <section className="project-tracking-leadership-strip" aria-label="Leadership operating report">
        <div className="project-tracking-leadership-strip__label">
          <strong>Operating Report</strong>
          <span>The operating report is unavailable right now. Refresh to try again.</span>
        </div>
      </section>
    );
  }

  if (!rows) {
    return (
      <section className="project-tracking-leadership-strip" aria-label="Leadership operating report">
        <div className="project-tracking-leadership-strip__label">
          <strong>Operating Report</strong>
          <span>Loading operating report…</span>
        </div>
      </section>
    );
  }

  return <ProjectTrackingLeadershipVisibility rows={rows} generatedAt={generatedAt} />;
}
