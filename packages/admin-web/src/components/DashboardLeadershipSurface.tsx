import { useEffect, useMemo, useState } from "react";
import { OperationalPreviewCard } from "./OperationalPreviewCard";
import { getLeadershipReportsIndex } from "../services/leadershipReports";
import type { BigShootUpcomingCard, LeadershipReportsIndex } from "../types";

type Props = {
  token: string;
};

export function DashboardLeadershipSurface({ token }: Props) {
  const [anchorDate, setAnchorDate] = useState(getLocalDateString());
  const [index, setIndex] = useState<LeadershipReportsIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedShootId, setSelectedShootId] = useState("");

  async function load(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const payload = await getLeadershipReportsIndex(token, { date: anchorDate });
      setIndex(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load leadership reporting right now.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, [anchorDate, token]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load({ quiet: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [anchorDate, token]);

  useEffect(() => {
    const candidateIds = new Set(index?.big_shoots_coming_up.items.map((item) => item.shoot_id) ?? []);
    if (!selectedShootId || !candidateIds.has(selectedShootId)) {
      setSelectedShootId(index?.big_shoots_coming_up.items[0]?.shoot_id ?? "");
    }
  }, [index, selectedShootId]);

  const selectedShoot = useMemo(
    () => index?.big_shoots_coming_up.items.find((item) => item.shoot_id === selectedShootId) ?? null,
    [index, selectedShootId]
  );

  return (
    <section className="panel dashboard-panel leadership-priority-surface">
      <div className="dashboard-panel__header">
        <div>
          <div className="section-title">Leadership Readiness</div>
          <p className="section-subtitle">
            Big and critical shoot visibility stays close to the dashboard so high-value prep and business risk are visible before you open the full report hub.
          </p>
        </div>
        <div className="page-intro-actions">
          <label className="filter-field">
            <span>Anchor Date</span>
            <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
          </label>
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="secondary-button" onClick={() => { window.location.hash = "#reports"; }}>
            Open Reports
          </button>
        </div>
      </div>

      {error ? <div className="feedback-strip feedback-strip--warning">{error}</div> : null}

      <div className="dashboard-layout">
        <div className="dashboard-stack">
          <section className="panel dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Big and Critical Shoots Coming Up</div>
                <p className="section-subtitle">{index?.big_shoots_coming_up.summary_line ?? "Loading flagged shoots."}</p>
              </div>
            </div>
            <div className="ops-preview-list">
              {loading && !index ? <div className="empty-state">Loading flagged shoot readiness.</div> : null}
              {(index?.big_shoots_coming_up.items ?? []).map((item) => (
                <OperationalPreviewCard
                  key={item.shoot_id}
                  eyebrow={`${formatCompactDate(item.shoot_date)} | ${item.priority_display}`}
                  title={item.title}
                  summary={`${item.shoot_code} | ${item.location_label}`}
                  owner={item.prep_due_label ?? "Prep cadence active"}
                  statusLabel={item.readiness_label}
                  statusTone={toneForReadiness(item.readiness_label)}
                  meta={[
                    ...(item.profitability_display ? [{ label: item.profitability_display, tone: toneForProfitability(item.profitability_display) }] : []),
                    ...item.reason_chips.slice(0, 2).map((reason) => ({ label: reason.label, tone: "neutral" as const }))
                  ]}
                  nextAction={item.readiness_reason}
                  selected={selectedShootId === item.shoot_id}
                  onClick={() => setSelectedShootId(item.shoot_id)}
                />
              ))}
              {!loading && !(index?.big_shoots_coming_up.items ?? []).length ? (
                <div className="empty-state">No upcoming shoots are currently flagged above standard priority.</div>
              ) : null}
            </div>
          </section>

          <section className="panel dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Leadership Reports</div>
                <p className="section-subtitle">Shared report definitions power the on-screen hub, PDF summaries, and CSV exports.</p>
              </div>
            </div>
            <div className="ops-preview-list">
              {(index?.reports ?? []).slice(0, 6).map((report) => (
                <OperationalPreviewCard
                  key={report.id}
                  eyebrow={report.audience}
                  title={report.title}
                  summary={report.summary_line}
                  statusLabel={report.action_needed_count ? `${report.action_needed_count} watch item${report.action_needed_count === 1 ? "" : "s"}` : "Steady"}
                  statusTone={toneForReport(report.tone)}
                  meta={[
                    ...(report.export_pdf ? [{ label: "PDF", tone: "neutral" as const }] : []),
                    ...(report.export_csv ? [{ label: "CSV", tone: "neutral" as const }] : [])
                  ]}
                  nextAction="Open the full report"
                  onClick={() => {
                    window.location.hash = "#reports";
                  }}
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="panel dashboard-sidebar">
          <div className="section-title">Readiness Snapshot</div>
          <p className="section-subtitle">Use the sidebar for the most useful prep cues before opening the full readiness report.</p>
          {selectedShoot ? <BigShootSidebarCard item={selectedShoot} /> : <div className="empty-state">Select a flagged shoot to review why it was raised and what needs prep.</div>}

          <section className="sidebar-section">
            <div className="section-title">Scheduled Summary Rhythm</div>
            <div className="dashboard-summary-list">
              {(index?.scheduled_summaries ?? []).map((summary) => (
                <div key={summary.id} className="dashboard-summary-row">
                  <span className="muted">{summary.cadence}</span>
                  <strong>{summary.label}</strong>
                </div>
              ))}
              {!index?.scheduled_summaries.length ? <div className="empty-state">Scheduled summary cadence is still loading.</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function BigShootSidebarCard({ item }: { item: BigShootUpcomingCard }) {
  return (
    <>
      <div className="dashboard-summary-list">
        <div className="dashboard-summary-row">
          <span className="muted">Shoot</span>
          <strong>{item.shoot_code}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Priority</span>
          <strong>{item.priority_display}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Readiness</span>
          <strong>{item.readiness_label}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Profitability</span>
          <strong>{item.profitability_display ?? "Needs Review"}</strong>
        </div>
      </div>

      <section className="sidebar-section">
        <div className="section-title">Why It Was Flagged</div>
        <div className="ops-preview-card__flags">
          {item.reason_chips.map((reason) => (
            <span key={`${reason.label}-${reason.detail}`} className="ops-preview-flag ops-preview-flag--neutral" title={reason.detail}>
              {reason.label}
            </span>
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <div className="section-title">Next Prep Step</div>
        <div className="notification-card notification-card--warning">
          <strong>{item.readiness_reason}</strong>
          <div className="muted">{item.prep_due_label ?? "Prep cadence is running on the default schedule."}</div>
        </div>
      </section>

      <div className="schedule-sidebar-actions">
        <button className="secondary-button" onClick={() => { window.location.hash = "#operations/schedule"; }}>
          Open Schedule
        </button>
        <button className="secondary-button" onClick={() => { window.location.hash = "#reports"; }}>
          Open Readiness Report
        </button>
      </div>
    </>
  );
}

function toneForReadiness(value: BigShootUpcomingCard["readiness_label"]) {
  if (value === "At Risk") {
    return "critical" as const;
  }
  if (value === "Needs Attention") {
    return "warning" as const;
  }
  return "success" as const;
}

function toneForProfitability(value: string) {
  if (value === "Watch") {
    return "warning" as const;
  }
  if (value === "Favorable") {
    return "success" as const;
  }
  return "neutral" as const;
}

function toneForReport(value: LeadershipReportsIndex["reports"][number]["tone"]) {
  if (value === "action_needed") {
    return "critical" as const;
  }
  if (value === "heads_up") {
    return "warning" as const;
  }
  if (value === "good") {
    return "success" as const;
  }
  return "neutral" as const;
}

function formatCompactDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function getLocalDateString() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
