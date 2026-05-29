import { useEffect, useMemo, useState } from "react";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import {
  buildProfitabilityHash,
  getProfitabilityWorkspace,
  type ProfitabilityWorkspaceFilters,
  type ProfitabilityWorkspaceFocus,
  type ProfitabilityWorkspaceResponse
} from "../services/profitability";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

const DEPARTMENT_OPTIONS = [
  { value: "", label: "All Departments" },
  { value: "executive", label: "Executive" },
  { value: "operations", label: "Operations" },
  { value: "schools", label: "Schools" },
  { value: "sports", label: "Sports" },
  { value: "office", label: "Office" },
  { value: "production", label: "Production" },
  { value: "customer_service", label: "Customer Service" },
  { value: "unassigned", label: "Unassigned" }
];

export function Profitability({ token, currentUser }: Props) {
  const [filters, setFilters] = useState<ProfitabilityWorkspaceFilters>(() => parseProfitabilityHash());
  const [workspace, setWorkspace] = useState<ProfitabilityWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setFilters(parseProfitabilityHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const nextHash = buildProfitabilityHash({
      date_from: filters.date_from,
      date_to: filters.date_to,
      department: filters.department ?? null,
      focus: filters.focus ?? "overview"
    });
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getProfitabilityWorkspace(token, filters)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setWorkspace(payload);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't load profitability right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, token]);

  const watchItems = workspace?.watch_items ?? [];
  const byDepartment = workspace?.breakdowns.by_department ?? [];
  const byShootType = workspace?.breakdowns.by_shoot_type ?? [];

  const primaryBurdenRows = useMemo(() => workspace?.operational_burden.rows.slice(0, 4) ?? [], [workspace?.operational_burden.rows]);

  return (
    <div className="workspace-shell">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">Reports</div>
          <h2>Profitability</h2>
          <p>Leadership view of profitability watch signals, production drag, labor burden, and import health grounded in live operational data.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className="metric-pill">Viewer: {currentUser.fullName}</div>
          <label className="filter-field">
            <span>Anchor</span>
            <input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
          </label>
          <button type="button" className="secondary-button" onClick={() => setFilters((current) => ({ ...current }))}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>From</span>
            <input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>To</span>
            <input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Department</span>
            <select value={filters.department ?? ""} onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value || null }))}>
              {DEPARTMENT_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading && !workspace ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading profitability</div>
          <p className="section-subtitle">Pulling leadership watch signals, production burden, and data health.</p>
        </section>
      ) : null}

      {workspace ? (
        <>
          <section className="panel dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">{workspace.headline.title}</div>
                <p className="section-subtitle">{workspace.headline.summary_line}</p>
              </div>
              <div className={`status-pill status-pill--${workspace.headline.tone === "action_needed" ? "error" : workspace.headline.tone === "heads_up" ? "warning" : "connected"}`}>
                {humanizeTone(workspace.headline.tone)}
              </div>
            </div>
            <div className="metrics-grid workspace-summary-strip">
              {workspace.overview_cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="stat-card panel workspace-summary-strip__button"
                  onClick={() => {
                    window.location.hash = card.action_hash;
                  }}
                >
                  <div className="eyebrow">{card.label}</div>
                  <strong>{card.value}</strong>
                  <span className="muted">{card.detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="dashboard-layout">
            <div className="dashboard-stack">
              <OperationalDetailSection
                title={`Watch List (${watchItems.length})`}
                summary="Flagged shoots, profitability recommendations, and operational pressure that deserve leadership review."
                defaultOpen={workspace.filters.focus === "watch" || watchItems.length > 0}
              >
                {watchItems.length ? (
                  <div className="ops-preview-list">
                    {watchItems.map((item) => (
                      <OperationalPreviewCard
                        key={item.id}
                        eyebrow={item.driver_label}
                        title={item.title}
                        summary={item.summary}
                        owner={item.context_label ?? "Leadership review"}
                        statusLabel={item.status_label}
                        statusTone={item.tone === "action_needed" ? "critical" : item.tone === "heads_up" ? "warning" : "info"}
                        nextAction={item.action_hash ? "Open the owning workspace" : "Stay in the profitability workspace"}
                        onClick={item.action_hash ? () => { window.location.hash = item.action_hash!; } : undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">No profitability watch items are open in this date window right now.</div>
                )}
              </OperationalDetailSection>

              <OperationalDetailSection
                title="Operational Burden"
                summary={workspace.operational_burden.summary_line}
                defaultOpen={workspace.filters.focus === "burden"}
              >
                <div className="metrics-grid workspace-summary-strip">
                  {primaryBurdenRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="stat-card panel workspace-summary-strip__button"
                      onClick={() => {
                        window.location.hash = row.action_hash;
                      }}
                    >
                      <div className="eyebrow">{row.label}</div>
                      <strong>{row.value}</strong>
                      <span className="muted">{row.detail}</span>
                    </button>
                  ))}
                </div>
              </OperationalDetailSection>
            </div>

            <aside className="panel dashboard-sidebar">
              <div className="dashboard-panel__header">
                <div>
                  <div className="section-title">Drivers</div>
                  <p className="section-subtitle">Break down the current watch window by department and shoot type.</p>
                </div>
              </div>

              <OperationalDetailSection title="By Department" summary="Where the current watch and production burden is concentrating." defaultOpen>
                <div className="ops-preview-list">
                  {byDepartment.map((row) => (
                    <OperationalPreviewCard
                      key={row.id}
                      eyebrow={`${row.watch_count} watch | ${row.production_count} production`}
                      title={row.label}
                      summary={row.detail}
                      statusLabel={humanizeTone(row.tone)}
                      statusTone={row.tone === "action_needed" ? "critical" : row.tone === "heads_up" ? "warning" : row.tone === "info" ? "info" : "success"}
                      nextAction="Filter this profitability view"
                      onClick={() => {
                        window.location.hash = row.action_hash;
                      }}
                    />
                  ))}
                  {!byDepartment.length ? <div className="empty-state empty-state--panel">No department signals are available in this window yet.</div> : null}
                </div>
              </OperationalDetailSection>

              <OperationalDetailSection title="By Shoot Type" summary="Shoot types carrying the most watch pressure or production drag.">
                <div className="ops-preview-list">
                  {byShootType.map((row) => (
                    <OperationalPreviewCard
                      key={row.id}
                      eyebrow={`${row.watch_count} watch | ${row.production_count} production`}
                      title={row.label}
                      summary={row.detail}
                      statusLabel={humanizeTone(row.tone)}
                      statusTone={row.tone === "action_needed" ? "critical" : row.tone === "heads_up" ? "warning" : row.tone === "info" ? "info" : "success"}
                      nextAction="Keep this trend in view"
                    />
                  ))}
                  {!byShootType.length ? <div className="empty-state empty-state--panel">No shoot-type mix is available in this window yet.</div> : null}
                </div>
              </OperationalDetailSection>

              <OperationalDetailSection
                title="Data Health"
                summary={workspace.data_health.summary_line}
                defaultOpen={workspace.filters.focus === "data_health"}
              >
                <div className="metrics-grid metrics-grid--compact">
                  {workspace.data_health.cards.map((card) => (
                    <article key={card.id} className="metric-card">
                      <div className="metric-card__label">{card.label}</div>
                      <strong className="metric-card__value">{card.value}</strong>
                      <div className="muted">{card.detail}</div>
                    </article>
                  ))}
                </div>
                {workspace.data_health.latest_import ? (
                  <div className="drawer-meta">
                    <span className="drawer-pill">{humanizeValue(workspace.data_health.latest_import.source_type)}</span>
                    <span className="drawer-pill">{humanizeValue(workspace.data_health.latest_import.status)}</span>
                    <span className="drawer-pill">{workspace.data_health.latest_import.file_name ?? "No file name"}</span>
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">Profitability imports and snapshots have not been populated yet.</div>
                )}
              </OperationalDetailSection>
            </aside>
          </section>
        </>
      ) : null}
    </div>
  );
}

function parseProfitabilityHash(): ProfitabilityWorkspaceFilters {
  const today = getLocalDateString();
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  return {
    date: today,
    date_from: params.get("date_from") ?? addDays(today, -14),
    date_to: params.get("date_to") ?? addDays(today, 30),
    department: params.get("department"),
    focus: parseFocus(params.get("focus"))
  };
}

function parseFocus(value: string | null): ProfitabilityWorkspaceFocus {
  return value === "watch" || value === "burden" || value === "data_health" ? value : "overview";
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeTone(value: ProfitabilityWorkspaceResponse["headline"]["tone"]) {
  if (value === "action_needed") {
    return "Action Needed";
  }
  if (value === "heads_up") {
    return "Heads Up";
  }
  if (value === "good") {
    return "Good";
  }
  if (value === "info") {
    return "Info";
  }
  return "Neutral";
}
