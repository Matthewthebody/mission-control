import { useEffect, useMemo, useState } from "react";
import { OperationalPreviewCard } from "./OperationalPreviewCard";
import { canPublishScheduleWorkspace } from "../permissions";
import { ShootStaffingDrawer } from "./ShootStaffingDrawer";
import { getStaffingDashboard } from "../services/scheduleStaffing";
import type { SessionUser, StaffingDashboardCoverageRow, StaffingDashboardResponse } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  showHeader?: boolean;
};

export function DashboardStaffingSurface({ token, currentUser, showHeader = true }: Props) {
  const [anchorDate, setAnchorDate] = useState(getLocalDateString());
  const [dashboard, setDashboard] = useState<StaffingDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedShoot, setSelectedShoot] = useState<StaffingDashboardCoverageRow | null>(null);

  async function load(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const payload = await getStaffingDashboard(token, anchorDate);
      setDashboard(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load staffing posture.");
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

  const summaryCards = useMemo(
    () =>
      dashboard
        ? [
            { label: "Shoots Today", value: dashboard.summary.shoots_today, tone: "neutral" as const },
            { label: "Shoots Tomorrow", value: dashboard.summary.shoots_tomorrow, tone: "info" as const },
            { label: "Open Slots", value: dashboard.summary.open_staffing_slots, tone: dashboard.summary.open_staffing_slots ? "warning" as const : "success" as const },
            { label: "Missing Lead", value: dashboard.summary.shoots_missing_lead, tone: dashboard.summary.shoots_missing_lead ? "critical" as const : "success" as const },
            { label: "Understaffed", value: dashboard.summary.understaffed_shoots, tone: dashboard.summary.understaffed_shoots ? "warning" as const : "success" as const },
            { label: "Conflicts", value: dashboard.summary.conflict_warnings, tone: dashboard.summary.conflict_warnings ? "warning" as const : "success" as const },
            { label: "Available Staff", value: dashboard.summary.available_staff_today, tone: "success" as const },
            { label: "Unavailable Staff", value: dashboard.summary.unavailable_staff_today, tone: dashboard.summary.unavailable_staff_today ? "neutral" as const : "success" as const }
          ]
        : [],
    [dashboard]
  );

  return (
    <>
      <section className="panel dashboard-panel staffing-command-surface">
        {showHeader ? (
          <div className="dashboard-panel__header">
            <div>
              <div className="section-title">Staffing Command</div>
              <p className="section-subtitle">
                Fast assignment triage for leadership. See what needs coverage, what is missing a lead, and who is actually available before opening the full board.
              </p>
            </div>
            <div className="page-intro-actions">
              <div className="metric-pill">Staffing lead: {currentUser.fullName}</div>
              <label className="filter-field">
                <span>Anchor Date</span>
                <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
              </label>
              <button className="secondary-button" onClick={() => void load()}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        ) : null}

        {notice ? <div className="feedback-strip feedback-strip--success">{notice}</div> : null}
        {error ? <div className="feedback-strip feedback-strip--warning">{error}</div> : null}

        <div className="staffing-command-summary">
          {summaryCards.map((card) => (
            <article key={card.label} className={`staffing-summary-card staffing-summary-card--${card.tone}`}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </article>
          ))}
        </div>

        <div className="staffing-command-layout">
          <div className="staffing-command-queues">
            <section className="staffing-command-group">
              <div className="dashboard-panel__header">
                <div>
                  <div className="section-title">Open Coverage</div>
                  <p className="section-subtitle">Shoots over the next few days that still need staffing attention.</p>
                </div>
              </div>
              <div className="ops-preview-list">
                {loading ? <div className="empty-state">Loading staffing coverage.</div> : null}
                {!loading &&
                  (dashboard?.open_coverage ?? []).map((row) => (
                    <OperationalPreviewCard
                      key={row.shoot_id}
                      eyebrow={`${row.department} | ${formatCompactDate(row.shoot_date)}`}
                      title={row.title}
                      summary={`${row.time_label} | ${row.location_label}`}
                      owner={row.lead_name ?? "Lead still open"}
                      statusLabel={`${row.assigned_staff_count}/${row.planned_staff_count} assigned`}
                      statusTone={row.missing_lead ? "critical" : row.under_staffed ? "warning" : row.conflict_warning_count ? "warning" : "success"}
                      meta={[
                        ...(row.priority_label_display ? [{ label: row.priority_label_display, tone: toneForPriority(row.priority_label) }] : []),
                        { label: row.lead_present ? "Lead present" : "Missing lead", tone: row.lead_present ? "success" : "critical" },
                        ...(row.conflict_warning_count ? [{ label: `${row.conflict_warning_count} conflicts`, tone: "warning" as const }] : []),
                        { label: humanizeLabel(row.sync_state), tone: row.sync_state === "sync_failed" ? "critical" : "neutral" }
                      ]}
                      nextAction={row.next_action}
                      selected={selectedShoot?.shoot_id === row.shoot_id}
                      onClick={() => setSelectedShoot(row)}
                    />
                  ))}
                {!loading && !(dashboard?.open_coverage ?? []).length ? <div className="empty-state">Today looks dialed in. No open coverage is waiting right now.</div> : null}
              </div>
            </section>

            <section className="staffing-command-group">
              <div className="dashboard-panel__header">
                <div>
                  <div className="section-title">Missing Lead</div>
                  <p className="section-subtitle">Any shoot without lead-qualified coverage gets its own queue.</p>
                </div>
              </div>
              <div className="ops-preview-list">
                {!loading &&
                  (dashboard?.missing_lead ?? []).map((row) => (
                    <OperationalPreviewCard
                      key={`missing-${row.shoot_id}`}
                      eyebrow={`${row.department} | ${formatCompactDate(row.shoot_date)}`}
                      title={row.title}
                      summary={`${row.time_label} | ${row.location_label}`}
                      owner={row.lead_name ?? "No lead assigned"}
                      statusLabel="Missing Lead"
                      statusTone="critical"
                      meta={[
                        ...(row.priority_label_display ? [{ label: row.priority_label_display, tone: toneForPriority(row.priority_label) }] : []),
                        { label: `${row.assigned_staff_count}/${row.planned_staff_count} assigned`, tone: row.under_staffed ? "warning" : "neutral" },
                        ...(row.conflict_warning_count ? [{ label: `${row.conflict_warning_count} conflicts`, tone: "warning" as const }] : [])
                      ]}
                      nextAction="Assign a lead-qualified photographer"
                      selected={selectedShoot?.shoot_id === row.shoot_id}
                      onClick={() => setSelectedShoot(row)}
                    />
                  ))}
                {!loading && !(dashboard?.missing_lead ?? []).length ? <div className="empty-state">Nothing is missing lead coverage right now.</div> : null}
              </div>
            </section>
          </div>

          <aside className="staffing-availability-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Availability at a Glance</div>
                <p className="section-subtitle">Grouped by operational availability instead of a raw directory list.</p>
              </div>
            </div>
            <div className="staffing-availability-groups">
              {(dashboard?.availability_groups ?? []).map((group) => (
                <section key={group.key} className="staffing-availability-group">
                  <div className="staffing-availability-group__header">
                    <strong>{group.label}</strong>
                    <span className="metric-pill">{group.count}</span>
                  </div>
                  <div className="staffing-availability-group__list">
                    {group.staff.slice(0, 8).map((staff) => (
                      <div key={staff.user_id} className="staffing-person-row">
                        <div>
                          <strong>{staff.name}</strong>
                          <div className="muted">{staff.title}</div>
                        </div>
                        <div className="staffing-person-row__meta">
                          <span className={`ops-preview-chip ops-preview-chip--${toneForAvailability(group.key)}`}>{staff.status}</span>
                          {staff.lead_qualified ? <span className="ops-preview-chip ops-preview-chip--critical">Lead</span> : null}
                        </div>
                        <div className="muted">
                          {staff.current_assignment ? `${staff.current_assignment}${staff.time_window ? ` | ${staff.time_window}` : ""}` : staff.quick_note || "Open for assignment"}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <ShootStaffingDrawer
        token={token}
        shootId={selectedShoot?.shoot_id ?? null}
        open={Boolean(selectedShoot)}
        canPublish={canPublishScheduleWorkspace(currentUser)}
        onClose={() => setSelectedShoot(null)}
        onError={setError}
        onNotice={setNotice}
        onUpdated={() => {
          void load({ quiet: true });
        }}
      />
    </>
  );
}

function toneForAvailability(key: string) {
  if (key === "available") {
    return "success";
  }
  if (key === "conflict" || key === "pto" || key === "unavailable") {
    return "critical";
  }
  return "warning";
}

function toneForPriority(value?: StaffingDashboardCoverageRow["priority_label"] | null) {
  if (value === "critical_shoot") {
    return "critical" as const;
  }
  if (value === "big_shoot") {
    return "warning" as const;
  }
  if (value === "high_priority") {
    return "warning" as const;
  }
  if (value === "elevated") {
    return "neutral" as const;
  }
  return "neutral" as const;
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
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
