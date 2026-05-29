import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { ShootBriefingBody, ShootBriefingPanel } from "./ShootBriefing";
import { ShootHotSheetCard } from "./ShootHotSheetCard";
import {
  buildMonthGrid,
  buildShootBriefing,
  getShootWindowRange,
  groupShootsByDay,
  type ShootBoardWindow
} from "../services/shootHotSheet";
import type { ShootDetail, ShootSummary } from "../types";

type Props = {
  token: string;
  anchorDate: string;
  outlookSummary?: {
    connected: boolean;
    activeCalendars: number;
    totalCalendars: number;
  } | null;
};

export function ShootHotSheetBoard({ token, anchorDate, outlookSummary }: Props) {
  const [windowMode, setWindowMode] = useState<ShootBoardWindow>("today");
  const [shoots, setShoots] = useState<ShootSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expandedShootId, setExpandedShootId] = useState("");
  const [selectedShootId, setSelectedShootId] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState<Record<string, ShootDetail>>({});

  const windowRange = useMemo(() => getShootWindowRange(anchorDate, windowMode), [anchorDate, windowMode]);
  const groupedDays = useMemo(() => groupShootsByDay(shoots), [shoots]);
  const shootMap = useMemo(() => new Map(shoots.map((shoot) => [shoot.id, shoot])), [shoots]);
  const dayMap = useMemo(() => new Map(groupedDays.map((day) => [day.dateKey, day.shoots])), [groupedDays]);
  const briefings = useMemo(
    () =>
      shoots.map((shoot) => ({
        shoot,
        briefing: buildShootBriefing(shoot, detailCache[shoot.id] ?? null)
      })),
    [detailCache, shoots]
  );
  const briefingById = useMemo(() => new Map(briefings.map((entry) => [entry.shoot.id, entry.briefing])), [briefings]);
  const selectedBriefing = selectedShootId ? briefingById.get(selectedShootId) ?? null : null;
  const selectedDayShoots = selectedDayKey ? dayMap.get(selectedDayKey) ?? [] : [];
  const selectedDayLabel = selectedDayKey
    ? new Date(`${selectedDayKey}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric"
      })
    : "";
  const monthGrid = useMemo(() => buildMonthGrid(anchorDate), [anchorDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void apiFetch<ShootSummary[]>(
      windowRange.start === windowRange.end
        ? `/api/shoots?date=${windowRange.start}`
        : `/api/shoots?date_from=${windowRange.start}&date_to=${windowRange.end}`,
      token
    )
      .then((response) => {
        if (!cancelled) {
          setShoots(response);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setShoots([]);
          setError(loadError instanceof Error ? loadError.message : "We couldn't load the shoot hot sheet right now.");
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
  }, [refreshNonce, token, windowRange.end, windowRange.start]);

  useEffect(() => {
    const visibleShootIds = new Set(shoots.map((shoot) => shoot.id));
    if (windowMode === "today") {
      setSelectedShootId("");
      if (expandedShootId && !visibleShootIds.has(expandedShootId)) {
        setExpandedShootId("");
      }
      return;
    }

    setExpandedShootId("");
    if (selectedShootId && !visibleShootIds.has(selectedShootId)) {
      setSelectedShootId("");
    }

    if (windowMode === "30day") {
      setSelectedDayKey((current) => {
        if (current && dayMap.has(current)) {
          return current;
        }
        return groupedDays[0]?.dateKey ?? "";
      });
      return;
    }

    setSelectedDayKey("");
  }, [dayMap, expandedShootId, groupedDays, selectedShootId, shoots, windowMode]);

  async function ensureDetail(shootId: string) {
    if (detailCache[shootId] || detailLoadingId === shootId) {
      return;
    }
    setDetailLoadingId(shootId);
    try {
      const detail = await apiFetch<ShootDetail>(`/api/shoots/${shootId}`, token);
      setDetailCache((current) => ({ ...current, [shootId]: detail }));
    } finally {
      setDetailLoadingId("");
    }
  }

  function handleCardToggle(shootId: string) {
    if (windowMode === "today") {
      setExpandedShootId((current) => {
        const next = current === shootId ? "" : shootId;
        if (next) {
          void ensureDetail(next);
        }
        return next;
      });
      return;
    }

    setSelectedShootId(shootId);
    const shoot = shootMap.get(shootId);
    if (windowMode === "30day" && shoot) {
      setSelectedDayKey(shoot.shoot_date ?? "");
    }
    void ensureDetail(shootId);
  }

  function handleDaySelect(dayKey: string) {
    setSelectedDayKey(dayKey);
    const shootsForDay = dayMap.get(dayKey) ?? [];
    if (!shootsForDay.length) {
      setSelectedShootId("");
      return;
    }
    if (shootsForDay.length === 1) {
      const onlyShoot = shootsForDay[0];
      setSelectedShootId(onlyShoot.id);
      void ensureDetail(onlyShoot.id);
    } else if (shootsForDay.length > 1 && !shootsForDay.some((shoot) => shoot.id === selectedShootId)) {
      setSelectedShootId(shootsForDay[0].id);
      void ensureDetail(shootsForDay[0].id);
    }
  }

  return (
    <section className="panel dashboard-panel shoot-hot-sheet">
      <div className="dashboard-panel__header">
        <div>
          <div className="section-title">Shoot Hot Sheet</div>
          <p className="section-subtitle">
            Executive card summaries for leadership and photographers, with a deeper operational briefing available only when you need it.
          </p>
        </div>
        <div className="dashboard-calendar-toolbar">
          <div className="report-tab-row">
            <button className={windowMode === "today" ? "is-active" : ""} onClick={() => setWindowMode("today")}>
              Today
            </button>
            <button className={windowMode === "3day" ? "is-active" : ""} onClick={() => setWindowMode("3day")}>
              3 Day
            </button>
            <button className={windowMode === "week" ? "is-active" : ""} onClick={() => setWindowMode("week")}>
              Week
            </button>
            <button className={windowMode === "30day" ? "is-active" : ""} onClick={() => setWindowMode("30day")}>
              30 Day
            </button>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              window.location.hash = "#outlook";
            }}
          >
            Open Outlook
          </button>
        </div>
      </div>

      <div className="outlook-connection-card__meta">
        <span className="metric-pill">{shoots.length} shoots in view</span>
        {outlookSummary ? (
          <span className="metric-pill">
            {outlookSummary.connected ? `${outlookSummary.activeCalendars} of ${outlookSummary.totalCalendars} Outlook calendars linked` : "Outlook not connected"}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="inline-banner-actions">
          <div className="error-banner">{error}</div>
          <button className="secondary-button" onClick={() => setRefreshNonce((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {loading && !shoots.length ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading hot sheet</div>
          <p className="section-subtitle">Collecting the shoot board for the selected window.</p>
        </section>
      ) : null}

      {!loading && !shoots.length ? <div className="empty-state empty-state--panel">No shoots are scheduled inside this window yet.</div> : null}

      {!loading && shoots.length ? (
        <>
          {windowMode === "today" ? (
            <div className="shoot-hot-sheet__stack">
              {groupedDays.map((group) => (
                <section key={group.dateKey} className="shoot-hot-sheet__day">
                  <div className="eyebrow">{group.label}</div>
                  <div className="shoot-hot-sheet__card-list">
                    {group.shoots.map((shoot) => {
                      const briefing = briefingById.get(shoot.id);
                      if (!briefing) {
                        return null;
                      }
                      return (
                        <ShootHotSheetCard
                          key={shoot.id}
                          briefing={briefing}
                          expanded={expandedShootId === shoot.id}
                          expansionMode="inline"
                          onToggle={() => handleCardToggle(shoot.id)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : null}

          {windowMode === "3day" ? (
            <div className="shoot-hot-sheet__board-layout shoot-hot-sheet__board-layout--3day">
              <div className="shoot-hot-sheet__day-columns">
                {groupedDays.map((group) => (
                  <section key={group.dateKey} className="shoot-hot-sheet__day-column">
                    <div className="eyebrow">{group.label}</div>
                    <div className="shoot-hot-sheet__card-list">
                      {group.shoots.map((shoot) => {
                        const briefing = briefingById.get(shoot.id);
                        if (!briefing) {
                          return null;
                        }
                        return (
                          <ShootHotSheetCard
                            key={shoot.id}
                            briefing={briefing}
                            expanded={selectedShootId === shoot.id}
                            expansionMode="panel"
                            onToggle={() => handleCardToggle(shoot.id)}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <ShootBriefingPanel
                briefing={selectedBriefing}
                loading={Boolean(detailLoadingId && selectedShootId === detailLoadingId)}
                title={detailLoadingId && selectedShootId === detailLoadingId ? "Loading Briefing..." : "Operational Briefing"}
                onClose={selectedShootId ? () => setSelectedShootId("") : undefined}
              />
            </div>
          ) : null}

          {windowMode === "week" ? (
            <div className="shoot-hot-sheet__board-layout">
              <div className="shoot-hot-sheet__week-stack">
                {groupedDays.map((group) => (
                  <section key={group.dateKey} className="shoot-hot-sheet__day">
                    <div className="eyebrow">{group.label}</div>
                    <div className="shoot-hot-sheet__card-list">
                      {group.shoots.map((shoot) => {
                        const briefing = briefingById.get(shoot.id);
                        if (!briefing) {
                          return null;
                        }
                        return (
                          <ShootHotSheetCard
                            key={shoot.id}
                            briefing={briefing}
                            expanded={selectedShootId === shoot.id}
                            expansionMode="panel"
                            onToggle={() => handleCardToggle(shoot.id)}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <ShootBriefingPanel
                briefing={selectedBriefing}
                loading={Boolean(detailLoadingId && selectedShootId === detailLoadingId)}
                title={detailLoadingId && selectedShootId === detailLoadingId ? "Loading Briefing..." : "Operational Briefing"}
                onClose={selectedShootId ? () => setSelectedShootId("") : undefined}
              />
            </div>
          ) : null}

          {windowMode === "30day" ? (
            <div className="shoot-hot-sheet__board-layout">
              <div className="shoot-hot-sheet__month">
                <div className="shoot-hot-sheet__month-weekdays">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="shoot-hot-sheet__month-grid">
                  {monthGrid.map((day) => {
                    const shootsForDay = dayMap.get(day.dateKey) ?? [];
                    const isSelected = selectedDayKey === day.dateKey;
                    const isToday = day.dateKey === anchorDate;
                    return (
                      <button
                        key={day.dateKey}
                        type="button"
                        className={`shoot-hot-sheet__month-day${day.inCurrentMonth ? "" : " shoot-hot-sheet__month-day--outside"}${isSelected ? " shoot-hot-sheet__month-day--selected" : ""}${isToday ? " shoot-hot-sheet__month-day--today" : ""}`}
                        onClick={() => handleDaySelect(day.dateKey)}
                      >
                        <span>{day.dayOfMonth}</span>
                        {shootsForDay.length ? <strong>{shootsForDay.length} shoot{shootsForDay.length === 1 ? "" : "s"}</strong> : <em>No shoots</em>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className="panel shoot-briefing-panel">
                <div className="shoot-briefing-panel__header">
                  <div>
                    <div className="eyebrow">Day Briefing</div>
                    <h3>{selectedDayLabel || "Pick a Day"}</h3>
                    <p className="section-subtitle">
                      {selectedDayKey ? `${selectedDayShoots.length} shoot${selectedDayShoots.length === 1 ? "" : "s"} scheduled` : "Choose a day in the month to see the shoot stack."}
                    </p>
                  </div>
                </div>
                {!selectedDayKey ? <div className="empty-state empty-state--panel">Select a day in the month grid to open its shoot stack.</div> : null}
                {selectedDayKey && !selectedDayShoots.length ? <div className="empty-state empty-state--panel">No shoots land on this day.</div> : null}
                {selectedDayShoots.length > 1 ? (
                  <div className="shoot-mini-list">
                    {selectedDayShoots.map((shoot) => {
                      const briefing = briefingById.get(shoot.id);
                      if (!briefing) {
                        return null;
                      }
                      return (
                        <button
                          key={shoot.id}
                          type="button"
                          className={`shoot-mini-card${selectedShootId === shoot.id ? " shoot-mini-card--selected" : ""}`}
                          onClick={() => handleCardToggle(shoot.id)}
                        >
                          <strong>{briefing.title}</strong>
                          <span>{briefing.timeRange}</span>
                          <span>{briefing.locationLine || "Location pending"}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {detailLoadingId && selectedShootId === detailLoadingId ? (
                  <div className="empty-state empty-state--panel">Loading the operational briefing...</div>
                ) : selectedBriefing ? (
                  <div className="shoot-briefing-panel__body">
                    <ShootBriefingBody briefing={selectedBriefing} />
                  </div>
                ) : null}
              </aside>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
