import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "../types";
import type { OperationalExceptionWorkspace } from "../exceptionTypes";
import { getExceptionWorkspace, applyExceptionAction } from "../services/exceptionsApi";
import { useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { HelpTooltip } from "../components/HelpTooltip";
import { navigateToHash } from "../home/homeShared";
import { canManageOperatingSystemModule } from "../permissions";
import {
  buildUrgentWindowHash,
  buildUrgentWindowRows,
  filterUrgentWindowRows,
  readUrgentWindowFilters,
  URGENT_WINDOW_CATEGORIES,
  URGENT_WINDOW_CATEGORY_AVAILABILITY,
  URGENT_WINDOW_CATEGORY_LABELS,
  URGENT_WINDOW_PROVENANCE_LABELS,
  URGENT_WINDOW_UNAVAILABLE_REASON,
  type UrgentWindowCategory,
  type UrgentWindowFilters,
  type UrgentWindowRow
} from "../home/urgentWindow";

const TIME_OPTIONS: Array<{ value: UrgentWindowFilters["time"]; label: string }> = [
  { value: "all", label: "Any time" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "next_24h", label: "Next 24 hours" },
  { value: "next_72h", label: "Next 72 hours" }
];

function severityTone(severity: UrgentWindowRow["severity"]): string {
  if (severity === "blocking") return "critical";
  if (severity === "at_risk") return "warning";
  return "watch";
}

function timeTone(timeState: UrgentWindowRow["timeState"]): string {
  if (timeState === "overdue") return "critical";
  if (timeState === "due_24h") return "warning";
  if (timeState === "due_72h") return "watch";
  return "neutral";
}

function UrgentRow({ row, active, onSelect }: { row: UrgentWindowRow; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`urgent-window-row urgent-window-row--${severityTone(row.severity)}${active ? " is-active" : ""}`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <div className="urgent-window-row__main">
        <div className="urgent-window-row__head">
          <span className={`home-pill home-pill--${severityTone(row.severity)}`}>{row.severityLabel}</span>
          <span className="urgent-window-row__category">{URGENT_WINDOW_CATEGORY_LABELS[row.category]}</span>
          {row.status === "snoozed" ? <span className="home-pill home-pill--neutral">Snoozed</span> : null}
          <span className="urgent-window-row__prov" title="How this issue is sourced">
            {URGENT_WINDOW_PROVENANCE_LABELS[row.provenance]}
          </span>
        </div>
        <strong className="urgent-window-row__title">{row.title}</strong>
        <p className="urgent-window-row__summary">{row.summary}</p>
        <div className="urgent-window-row__meta">
          <span>Reason: {row.reason}</span>
          <span>{row.sourceType} · {row.sourceId.slice(0, 8)}</span>
          {row.department ? <span>{row.department}</span> : null}
        </div>
      </div>
      <div className="urgent-window-row__side">
        <span className={`urgent-window-row__time urgent-window-row__time--${timeTone(row.timeState)}`}>{row.timeLabel}</span>
        <span className={row.ownerGap ? "urgent-window-row__owner urgent-window-row__owner--gap" : "urgent-window-row__owner"}>
          {row.ownerGap ? "Needs owner" : row.ownerLabel}
        </span>
        <span className="urgent-window-row__open" aria-hidden="true">View →</span>
      </div>
    </button>
  );
}

function UrgentPreview({
  row,
  canManage,
  assigning,
  onAssignToMe,
  onOpenSource,
  onClose
}: {
  row: UrgentWindowRow;
  canManage: boolean;
  assigning: boolean;
  onAssignToMe: () => void;
  onOpenSource: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="urgent-window__preview panel" aria-label="Selected urgent item">
      <div className="urgent-window__preview-head">
        <div>
          <span className="urgent-window__preview-eyebrow">{URGENT_WINDOW_CATEGORY_LABELS[row.category]} · {row.severityLabel}</span>
          <h3>{row.title}</h3>
        </div>
        <button type="button" className="urgent-window__preview-close" aria-label="Close preview" onClick={onClose}>×</button>
      </div>
      <p className="urgent-window__preview-why">{row.summary}</p>
      <dl className="urgent-window__preview-grid">
        <div><dt>Exact reason</dt><dd>{row.reason}</dd></div>
        <div><dt>Underlying record</dt><dd>{row.sourceType} · <code>{row.sourceId}</code></dd></div>
        <div><dt>Owner</dt><dd>{row.ownerGap ? "Needs owner" : row.ownerLabel}</dd></div>
        <div><dt>Time / deadline</dt><dd>{row.timeLabel}{row.dueAt ? ` · ${new Date(row.dueAt).toLocaleString()}` : ""}</dd></div>
        <div><dt>Status</dt><dd>{row.status === "open" ? "Open (unresolved)" : row.status}</dd></div>
        <div><dt>Department</dt><dd>{row.department ?? "—"}</dd></div>
        <div><dt>Source</dt><dd>{URGENT_WINDOW_PROVENANCE_LABELS[row.provenance]}</dd></div>
        <div><dt>Next action</dt><dd>{row.nextActionLabel}</dd></div>
      </dl>
      <p className="urgent-window__preview-history">Full activity history is available on the source record and in the Exception Center.</p>
      <div className="urgent-window__preview-actions">
        <button type="button" className="urgent-window__preview-primary" onClick={onOpenSource}>
          Open full source record →
        </button>
        {canManage ? (
          <button type="button" className="urgent-window__preview-secondary" onClick={onAssignToMe} disabled={assigning || !row.ownerGap}>
            {row.ownerGap ? (assigning ? "Assigning…" : "Assign to me") : `Owned by ${row.ownerLabel}`}
          </button>
        ) : (
          <span className="urgent-window__preview-readonly">Read-only — you can view but not reassign.</span>
        )}
      </div>
    </aside>
  );
}

export function UrgentWindowPage({ token, currentUser }: { token: string; currentUser: SessionUser }) {
  const snapshot = useHashRouteSnapshot();
  const filters = useMemo(() => readUrgentWindowFilters(snapshot.params), [snapshot.params]);
  const focusId = snapshot.params.get("focus");
  const canManage = canManageOperatingSystemModule(currentUser, "exceptions");

  const [workspace, setWorkspace] = useState<OperationalExceptionWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getExceptionWorkspace(token);
      setWorkspace(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load urgent items.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getExceptionWorkspace(token)
      .then((data) => {
        if (!cancelled) {
          setWorkspace(data);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load urgent items.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const allRows = useMemo(() => (workspace ? buildUrgentWindowRows(workspace.items, Date.now()) : []), [workspace]);
  const rows = useMemo(() => filterUrgentWindowRows(allRows, filters), [allRows, filters]);

  const departments = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.department).filter((value): value is string => Boolean(value)))).sort(),
    [allRows]
  );
  const owners = useMemo(
    () => Array.from(new Set(allRows.filter((row) => !row.ownerGap).map((row) => row.ownerLabel))).sort(),
    [allRows]
  );
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<UrgentWindowCategory, number>> = {};
    for (const row of allRows) counts[row.category] = (counts[row.category] ?? 0) + 1;
    return counts;
  }, [allRows]);

  const applyFilter = (patch: Partial<UrgentWindowFilters>) => {
    window.location.hash = buildUrgentWindowHash({ ...filters, ...patch }, focusId);
  };
  const selectCategory = (category: UrgentWindowFilters["category"]) => {
    // Changing category clears any focused row that would no longer be visible.
    window.location.hash = buildUrgentWindowHash({ ...filters, category }, null);
  };
  const selectRow = (id: string | null) => {
    window.location.hash = buildUrgentWindowHash(filters, id);
  };

  const selected = rows.find((row) => row.id === focusId) ?? null;
  const selectedCategoryUnavailable =
    filters.category !== "all" && URGENT_WINDOW_CATEGORY_AVAILABILITY[filters.category] === "unavailable";
  const filtersActive =
    filters.category !== "all" ||
    filters.department !== "all" ||
    filters.owner !== "all" ||
    filters.severity !== "all" ||
    filters.status !== "all" ||
    filters.time !== "all";

  const assignToMe = async () => {
    if (!selected) return;
    setAssigning(true);
    try {
      await applyExceptionAction(token, selected.id, { action: "assign_owner", owner_user_id: currentUser.id });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign this issue.");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="urgent-window">
      <header className="urgent-window__head">
        <div>
          <span className="urgent-window__eyebrow">Company Command</span>
          <h2>
            Urgent Window
            <HelpTooltip
              text="Every unresolved urgent operational issue, composed from live tracked records (urgent-watch). Each row links to its exact source record. Client Success and Weather show as not-connected because no live source exists yet — they are never filled with sample data."
              label="About the Urgent Window"
            />
          </h2>
          <p className="urgent-window__sub">
            {loading ? "Loading live urgent items…" : `${rows.length} shown of ${allRows.length} live urgent items`}
          </p>
        </div>
        <button type="button" className="urgent-window__back" onClick={() => navigateToHash("#home")}>
          ← Company Command
        </button>
      </header>

      <div className="urgent-window__categories" role="group" aria-label="Categories">
        <button
          type="button"
          className={`urgent-window__chip${filters.category === "all" ? " is-active" : ""}`}
          onClick={() => selectCategory("all")}
        >
          All <span>{allRows.length}</span>
        </button>
        {URGENT_WINDOW_CATEGORIES.map((category) => {
          const unavailable = URGENT_WINDOW_CATEGORY_AVAILABILITY[category] === "unavailable";
          return (
            <button
              type="button"
              key={category}
              className={`urgent-window__chip${filters.category === category ? " is-active" : ""}${unavailable ? " is-unavailable" : ""}`}
              onClick={() => selectCategory(category)}
              title={unavailable ? URGENT_WINDOW_UNAVAILABLE_REASON[category] : undefined}
            >
              {URGENT_WINDOW_CATEGORY_LABELS[category]} <span>{unavailable ? "—" : categoryCounts[category] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="urgent-window__filters">
        <label>
          Department
          <select value={filters.department} onChange={(event) => applyFilter({ department: event.target.value })}>
            <option value="all">All</option>
            {departments.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select value={filters.owner} onChange={(event) => applyFilter({ owner: event.target.value })}>
            <option value="all">All</option>
            <option value="unassigned">Needs owner</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select value={filters.severity} onChange={(event) => applyFilter({ severity: event.target.value as UrgentWindowFilters["severity"] })}>
            <option value="all">All</option>
            <option value="blocking">Blocking</option>
            <option value="at_risk">At risk</option>
            <option value="warning">Warning</option>
          </select>
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(event) => applyFilter({ status: event.target.value as UrgentWindowFilters["status"] })}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="snoozed">Snoozed</option>
          </select>
        </label>
        <label>
          Time
          <select value={filters.time} onChange={(event) => applyFilter({ time: event.target.value as UrgentWindowFilters["time"] })}>
            {TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {filtersActive ? (
          <button type="button" className="urgent-window__clear" onClick={() => (window.location.hash = "#urgent-window")}>
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? <div className="urgent-window__error" role="alert">{error}</div> : null}

      <div className="urgent-window__body">
        <div className="urgent-window__list" role="list">
          {loading ? (
            <div className="urgent-window__empty">Loading live urgent items…</div>
          ) : selectedCategoryUnavailable ? (
            <div className="urgent-window__empty urgent-window__empty--unavailable">
              <strong>{URGENT_WINDOW_CATEGORY_LABELS[filters.category as UrgentWindowCategory]} is not connected</strong>
              <p>{URGENT_WINDOW_UNAVAILABLE_REASON[filters.category as UrgentWindowCategory]}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="urgent-window__empty">
              <strong>Nothing urgent in this view.</strong>
              <p>{allRows.length === 0 ? "No live urgent items are tracked right now." : "No unresolved urgent items match these filters."}</p>
            </div>
          ) : (
            rows.map((row) => <UrgentRow key={row.id} row={row} active={row.id === focusId} onSelect={() => selectRow(row.id)} />)
          )}
        </div>
        {selected ? (
          <UrgentPreview
            row={selected}
            canManage={canManage}
            assigning={assigning}
            onAssignToMe={assignToMe}
            onOpenSource={() => navigateToHash(selected.destinationHash)}
            onClose={() => selectRow(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
