import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { ShootStaffingCommand } from "../components/ShootStaffingCommand";
import { canAccessRoute } from "../permissions";
import { getStaffingDashboard } from "../services/scheduleStaffing";
import type {
  SessionUser,
  StaffingDashboardCoverageRow,
  StaffingDashboardMember,
  StaffingDashboardResponse
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket?: Socket | null;
};

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readInitialDateFromHash(): string {
  if (typeof window === "undefined") {
    return getLocalDateString();
  }
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) {
    return getLocalDateString();
  }
  const date = new URLSearchParams(hash.slice(queryIndex + 1)).get("date");
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getLocalDateString();
}

function shiftDate(dateString: string, deltaDays: number) {
  const base = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(base.getTime())) {
    return dateString;
  }
  base.setDate(base.getDate() + deltaDays);
  return getLocalDateString(base);
}

function formatLongDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function humanizeDepartment(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function departmentTone(department: string): "schools" | "sports" | "specialty" | "neutral" {
  const haystack = department.toLowerCase();
  if (haystack.includes("school")) return "schools";
  if (haystack.includes("sport")) return "sports";
  if (haystack.includes("studio") || haystack.includes("special") || haystack.includes("portrait")) return "specialty";
  return "neutral";
}

type CoverageCard = StaffingDashboardCoverageRow & { gap: number };

function buildCoverageCards(payload: StaffingDashboardResponse | null): CoverageCard[] {
  if (!payload) {
    return [];
  }
  const byId = new Map<string, StaffingDashboardCoverageRow>();
  for (const row of [...payload.open_coverage, ...payload.missing_lead]) {
    if (!byId.has(row.shoot_id)) {
      byId.set(row.shoot_id, row);
    }
  }
  return [...byId.values()]
    .map((row) => ({ ...row, gap: Math.max(0, row.planned_staff_count - row.assigned_staff_count) }))
    .sort((left, right) => {
      // Most under-pressure first: gap, then missing lead, then conflicts.
      const leftScore = left.gap * 10 + (left.missing_lead ? 5 : 0) + (left.conflict_warning_count > 0 ? 1 : 0);
      const rightScore = right.gap * 10 + (right.missing_lead ? 5 : 0) + (right.conflict_warning_count > 0 ? 1 : 0);
      return rightScore - leftScore;
    });
}

export function StaffAssignmentBoard({ token, currentUser, socket }: Props) {
  const [anchorDate, setAnchorDate] = useState(readInitialDateFromHash);
  const [payload, setPayload] = useState<StaffingDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedShootId, setSelectedShootId] = useState<string | null>(null);

  const canPublish = canAccessRoute(currentUser, "operations-staffing");
  const coverageCards = useMemo(() => buildCoverageCards(payload), [payload]);
  const selectedCard = useMemo(
    () => coverageCards.find((card) => card.shoot_id === selectedShootId) ?? null,
    [coverageCards, selectedShootId]
  );

  async function load(dateString: string) {
    setLoading(true);
    try {
      const response = await getStaffingDashboard(token, dateString);
      setPayload(response);
      setError("");
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the staffing board.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(anchorDate);
    setSelectedShootId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorDate, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const onRefresh = () => {
      void load(anchorDate);
    };
    socket.on("schedule_changed", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, anchorDate]);

  const summary = payload?.summary ?? null;
  const summaryTiles = summary
    ? [
        { key: "shoots", label: "Shoots", value: summary.shoots_today, tone: "neutral" as const },
        { key: "open_slots", label: "Open slots", value: summary.open_staffing_slots, tone: summary.open_staffing_slots > 0 ? "danger" : "good" as const },
        { key: "missing_lead", label: "Missing lead", value: summary.shoots_missing_lead, tone: summary.shoots_missing_lead > 0 ? "warning" : "good" as const },
        { key: "understaffed", label: "Understaffed", value: summary.understaffed_shoots, tone: summary.understaffed_shoots > 0 ? "warning" : "good" as const },
        { key: "conflicts", label: "Conflicts", value: summary.conflict_warnings, tone: summary.conflict_warnings > 0 ? "danger" : "good" as const },
        { key: "available", label: "Available", value: summary.available_staff_today, tone: "good" as const },
        { key: "unavailable", label: "Unavailable", value: summary.unavailable_staff_today, tone: "neutral" as const }
      ]
    : [];

  return (
    <section className="staff-board">
      <div className="staff-board__head">
        <div>
          <div className="eyebrow">Staffing</div>
          <h2>Staff Assignment Board</h2>
        </div>
        <div className="staff-board__date-nav" role="group" aria-label="Choose date">
          <button type="button" className="secondary-button" onClick={() => setAnchorDate((current) => shiftDate(current, -1))} aria-label="Previous day">
            ←
          </button>
          <label className="staff-board__date-field">
            <span className="visually-hidden">Date</span>
            <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value || getLocalDateString())} />
          </label>
          <button type="button" className="secondary-button" onClick={() => setAnchorDate((current) => shiftDate(current, 1))} aria-label="Next day">
            →
          </button>
          <button type="button" className="secondary-button" onClick={() => setAnchorDate(getLocalDateString())}>
            Today
          </button>
        </div>
      </div>

      <p className="staff-board__date-label">{formatLongDate(anchorDate)}</p>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      {summaryTiles.length ? (
        <div className="staff-board__summary" aria-label="Staffing summary">
          {summaryTiles.map((tile) => (
            <div key={tile.key} className={`staff-board__summary-tile staff-board__summary-tile--${tile.tone}`}>
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className="staff-board__layout">
        <main className="staff-board__main">
          <div className="staff-board__section-head">
            <h3>Shoots needing staff</h3>
            <span className="staff-board__count">{coverageCards.length}</span>
          </div>

          {loading ? <div className="empty-state empty-state--panel">Loading staffing for {formatLongDate(anchorDate)}…</div> : null}
          {!loading && !coverageCards.length ? (
            <div className="empty-state empty-state--panel">
              {summary && summary.shoots_today > 0
                ? "Every shoot on this date is fully staffed with lead coverage."
                : "No shoots are scheduled for this date."}
            </div>
          ) : null}

          <div className="staff-board__cards">
            {coverageCards.map((card) => {
              const active = card.shoot_id === selectedShootId;
              return (
                <button
                  key={card.shoot_id}
                  type="button"
                  className={`staff-board__job-card staff-board__job-card--${departmentTone(card.department)}${active ? " is-active" : ""}`}
                  onClick={() => setSelectedShootId(card.shoot_id)}
                  aria-pressed={active}
                >
                  <div className="staff-board__job-top">
                    <strong>{card.title}</strong>
                    <span className="staff-board__dept-chip">{humanizeDepartment(card.department)}</span>
                  </div>
                  <div className="staff-board__job-meta">
                    {card.time_label ? <span>{card.time_label}</span> : null}
                    {card.location_label ? <span>{card.location_label}</span> : null}
                  </div>
                  <div className="staff-board__job-staffing">
                    <span className="staff-board__staff-count">
                      {card.assigned_staff_count}/{card.planned_staff_count} staffed
                    </span>
                    {card.gap > 0 ? <span className="staff-board__badge staff-board__badge--danger">{card.gap} needed</span> : null}
                    {card.missing_lead ? <span className="staff-board__badge staff-board__badge--warning">No lead</span> : null}
                    {card.conflict_warning_count > 0 ? (
                      <span className="staff-board__badge staff-board__badge--danger">{card.conflict_warning_count} conflict{card.conflict_warning_count === 1 ? "" : "s"}</span>
                    ) : null}
                    {card.gap === 0 && !card.missing_lead && card.conflict_warning_count === 0 ? (
                      <span className="staff-board__badge staff-board__badge--good">Ready</span>
                    ) : null}
                  </div>
                  {card.next_action ? <p className="staff-board__next-action">{card.next_action}</p> : null}
                </button>
              );
            })}
          </div>
        </main>

        <aside className="staff-board__rail" aria-label="Staff availability">
          <div className="staff-board__section-head">
            <h3>Availability</h3>
          </div>
          {payload?.availability_groups.length ? (
            payload.availability_groups.map((group) => (
              <div key={group.key} className="staff-board__avail-group">
                <div className="staff-board__avail-head">
                  <span>{group.label}</span>
                  <strong>{group.count}</strong>
                </div>
                <ul className="staff-board__avail-list">
                  {group.staff.slice(0, 6).map((member: StaffingDashboardMember) => (
                    <li key={member.user_id}>
                      <span>{member.name}</span>
                      <small>{member.current_assignment || member.time_window || member.title}</small>
                    </li>
                  ))}
                  {group.staff.length > 6 ? <li className="staff-board__avail-more">+{group.staff.length - 6} more</li> : null}
                </ul>
              </div>
            ))
          ) : (
            <div className="empty-state empty-state--compact">Availability appears here once staff are scheduled.</div>
          )}
        </aside>
      </div>

      {selectedShootId ? (
        <>
          <div className="staff-board__scrim" onClick={() => setSelectedShootId(null)} aria-hidden="true" />
          <aside className="staff-board__drawer" aria-label="Assign staff">
            <div className="staff-board__drawer-head">
              <div>
                <div className="eyebrow">Assign staff</div>
                <strong>{selectedCard?.title ?? "Shoot staffing"}</strong>
              </div>
              <button type="button" className="secondary-button" onClick={() => setSelectedShootId(null)}>
                Close
              </button>
            </div>
            <ShootStaffingCommand
              token={token}
              shootId={selectedShootId}
              canPublish={canPublish}
              onNotice={(message) => {
                setNotice(message);
                void load(anchorDate);
              }}
              onError={setError}
              onUpdated={() => void load(anchorDate)}
              onClose={() => setSelectedShootId(null)}
              className="staff-board__staffing-command"
            />
          </aside>
        </>
      ) : null}
    </section>
  );
}
