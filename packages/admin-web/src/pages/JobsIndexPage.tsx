import { useEffect, useMemo, useState } from "react";
import { useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { HelpTooltip } from "../components/HelpTooltip";
import { getJobsIndex, type JobsIndexResponse, type JobIndexRow } from "../services/jobsApi";
import type { SessionUser } from "../types";

// Phase 3C Commit 4 — the compact, canonical Jobs operating index. Consumes the
// Phase 3B read model GET /api/jobs/index, so every enabled summary count equals the
// rows its filter returns. URL-backed state; honest loading/error/empty/denied
// states; unlinked Jobs never show fabricated Shoot-derived staffing/schedule data.

const LIFECYCLE_SCOPES: Array<{ value: string; label: string }> = [
  { value: "active", label: "Active" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "upcoming", label: "Upcoming" },
  { value: "waiting", label: "Waiting" },
  { value: "recently_completed", label: "Recently Completed" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "canceled", label: "Canceled" },
  { value: "all", label: "All" }
];
const SORTS: Array<{ value: string; label: string }> = [
  { value: "date", label: "Job date" },
  { value: "created", label: "Newest" },
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" }
];
const DEPARTMENTS = ["", "schools", "sports", "corporate", "headshots", "other"];
const PAGE_SIZE = 25;

const FILTER_KEYS = ["lifecycle_scope", "search", "department_type", "metric", "sort", "direction", "job_status", "owner_user_id", "shoot_link_status", "workflow_link_status", "offset", "selected"] as const;

function readFilters(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) out[k] = v;
  }
  return out;
}
function humanize(token: string | null | undefined): string {
  if (!token) return "—";
  return token.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function JobsIndexPage({ token, currentUser: _currentUser }: { token: string; currentUser: SessionUser }) {
  const { params } = useHashRouteSnapshot();
  const filters = useMemo(() => readFilters(params), [params]);
  const [data, setData] = useState<JobsIndexResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "denied">("loading");

  function writeHash(updates: Record<string, string | null>) {
    const next = { ...filters, ...updates };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v != null && v !== "") sp.set(k, v);
    }
    const q = sp.toString();
    window.location.hash = `#jobs${q ? `?${q}` : ""}`;
  }

  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getJobsIndex(token, { lifecycle_scope: "active", limit: PAGE_SIZE, ...filters })
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((error as { status?: number })?.status === 403 ? "denied" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [token, filtersKey]);

  const activeMetric = filters.metric ?? null;
  const scope = filters.lifecycle_scope ?? "active";
  const offset = Number(filters.offset ?? 0);

  return (
    <section className="panel jobs-index" aria-label="Jobs">
      <header className="jobs-index__header">
        <div className="jobs-index__title">
          <h2>Jobs</h2>
          <HelpTooltip
            label="About the Jobs index"
            text="The canonical Jobs operating view. Every metric count equals the rows its filter returns. Archived, canceled, demo, and older completed work are hidden by default — change the lifecycle scope to see them. Unlinked Jobs do not show Shoot staffing or schedule data until a Shoot is linked."
          />
        </div>
        <div className="jobs-index__controls">
          <input
            className="jobs-index__search"
            type="search"
            aria-label="Search jobs"
            placeholder="Search job, organization, or number…"
            defaultValue={filters.search ?? ""}
            onChange={(e) => writeHash({ search: e.target.value, offset: null })}
          />
          <label className="jobs-index__control">
            <span>Scope</span>
            <select aria-label="Lifecycle scope" value={scope} onChange={(e) => writeHash({ lifecycle_scope: e.target.value, offset: null })}>
              {LIFECYCLE_SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-index__control">
            <span>Department</span>
            <select aria-label="Department" value={filters.department_type ?? ""} onChange={(e) => writeHash({ department_type: e.target.value, offset: null })}>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d ? humanize(d) : "All departments"}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-index__control">
            <span>Sort</span>
            <select aria-label="Sort" value={filters.sort ?? "date"} onChange={(e) => writeHash({ sort: e.target.value, offset: null })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {data ? (
        <div className="jobs-index__metrics" role="group" aria-label="Job summary metrics">
          {data.summary.metrics.map((m) =>
            m.available ? (
              <button
                key={m.key}
                type="button"
                className={`jobs-index__metric${activeMetric === m.key ? " jobs-index__metric--active" : ""}`}
                aria-pressed={activeMetric === m.key}
                onClick={() => writeHash({ metric: activeMetric === m.key ? null : m.key, offset: null })}
              >
                <span className="jobs-index__metric-count">{m.count}</span>
                <span className="jobs-index__metric-label">{m.label}</span>
              </button>
            ) : (
              <span key={m.key} className="jobs-index__metric jobs-index__metric--disabled" aria-disabled="true" title={m.reason}>
                <span className="jobs-index__metric-count">—</span>
                <span className="jobs-index__metric-label">{m.label}</span>
              </span>
            )
          )}
        </div>
      ) : null}

      {state === "loading" ? <div className="jobs-index__status">Loading jobs…</div> : null}
      {state === "denied" ? <div className="jobs-index__status" role="alert">You don't have access to these jobs.</div> : null}
      {state === "error" ? (
        <div className="jobs-index__status" role="alert">
          We couldn't load jobs right now. <button type="button" onClick={() => writeHash({})}>Retry</button>
        </div>
      ) : null}

      {state === "ready" && data ? (
        data.rows.length === 0 ? (
          <div className="jobs-index__status">No jobs match this view.</div>
        ) : (
          <>
            <table className="jobs-index__table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Date</th>
                  <th scope="col">Dept</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                  <th scope="col">Readiness</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Attention</th>
                  <th scope="col">Workflow</th>
                  <th scope="col">Shoot link</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <JobRow key={row.id} row={row} selected={filters.selected === row.id} onSelect={() => writeHash({ selected: row.id })} />
                ))}
              </tbody>
            </table>
            <div className="jobs-index__pager">
              <span>
                Showing {data.rows.length ? offset + 1 : 0}–{offset + data.rows.length} of {data.page.total}
              </span>
              <button type="button" disabled={offset <= 0} onClick={() => writeHash({ offset: String(Math.max(offset - PAGE_SIZE, 0)) })}>
                Previous
              </button>
              <button type="button" disabled={!data.page.has_more} onClick={() => writeHash({ offset: String(offset + PAGE_SIZE) })}>
                Next
              </button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

function JobRow({ row, selected, onSelect }: { row: JobIndexRow; selected: boolean; onSelect: () => void }) {
  return (
    <tr className={`jobs-index__row${selected ? " jobs-index__row--selected" : ""}`} aria-selected={selected}>
      <td>
        <button type="button" className="jobs-index__job-link" onClick={onSelect}>
          <strong>{row.title}</strong>
          {row.job_number ? <span className="jobs-index__job-number">{row.job_number}</span> : null}
        </button>
      </td>
      <td>{row.organization_name ?? "—"}</td>
      <td>{formatDate(row.job_date)}</td>
      <td>{humanize(row.department_type)}</td>
      <td>{row.owner_name ?? <span className="jobs-index__muted">Unowned</span>}</td>
      <td>
        <span className={`jobs-index__pill jobs-index__pill--${row.job_status}`}>{humanize(row.job_status)}</span>
      </td>
      <td>{humanize(row.readiness_status)}</td>
      <td>{humanize(row.risk_status)}</td>
      <td>
        {row.attention_reasons.length ? (
          <span className="jobs-index__reasons">{row.attention_reasons.map((r) => humanize(r)).join(", ")}</span>
        ) : (
          <span className="jobs-index__muted">—</span>
        )}
      </td>
      <td>{row.workflow_data_available ? `${row.workflow_run_count} run${row.workflow_run_count === 1 ? "" : "s"}` : <span className="jobs-index__muted">None</span>}</td>
      <td>
        {row.shoot_link_status === "linked" ? (
          <span className="jobs-index__linked">Linked · {row.linked_shoot_count}</span>
        ) : (
          <span className="jobs-index__muted" title="Operational scheduling data unavailable until a Shoot is linked">
            No Shoot linked
          </span>
        )}
      </td>
    </tr>
  );
}
