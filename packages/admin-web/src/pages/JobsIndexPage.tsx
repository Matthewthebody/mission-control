import { useEffect, useMemo, useState } from "react";
import { useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { HelpTooltip } from "../components/HelpTooltip";
import { getJobsIndex, getJobQuickView, archiveSharedJob, restoreSharedJob, type JobsIndexResponse, type JobIndexRow } from "../services/jobsApi";
import type { SessionUser } from "../types";

const MANAGE_TIERS = ["super_admin", "leadership", "director_admin"];
const MANAGE_PERMISSIONS = ["job.update", "job.publish", "schedule.manage", "staffing.manage"];
function canManageJobs(user: SessionUser): boolean {
  return MANAGE_TIERS.includes(user.authorityTier) || user.permissions.some((p) => MANAGE_PERMISSIONS.includes(p));
}

// Honest, one-line provenance for each canonical Job-native attention reason.
const ATTENTION_REASON_COPY: Record<string, string> = {
  late: "A client commitment date has passed.",
  behind_promised_delivery: "Promised delivery is past due and production is not complete.",
  blocked_no_owner: "Work is blocked and the Job has no owner.",
  missing_required_details: "Required intake details are still incomplete."
};

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

const FILTER_KEYS = ["lifecycle_scope", "search", "department_type", "metric", "sort", "direction", "job_status", "owner_user_id", "shoot_link_status", "workflow_link_status", "demo_view", "offset", "selected", "focus"] as const;

// Explicit demo states (not one overloaded boolean): the curated active demo, the
// archived demo, or every demo record. A demo tenant defaults to the curated set.
const DEMO_VIEWS = [
  { value: "curated", label: "Curated Demo" },
  { value: "archived", label: "Show Archived Demo" },
  { value: "all", label: "Show All Demo" }
];

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

export function JobsIndexPage({ token, currentUser }: { token: string; currentUser: SessionUser }) {
  const { params } = useHashRouteSnapshot();
  const filters = useMemo(() => readFilters(params), [params]);
  const [data, setData] = useState<JobsIndexResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "denied">("loading");
  const [reloadNonce, setReloadNonce] = useState(0);
  const canManage = canManageJobs(currentUser);

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
  }, [token, filtersKey, reloadNonce]);

  const selectedRow = data?.rows.find((r) => r.id === filters.selected) ?? null;
  const activeMetric = filters.metric ?? null;
  const scope = filters.lifecycle_scope ?? "active";
  const offset = Number(filters.offset ?? 0);

  // Off-page deep link: a ?selected=<id> that is NOT on the current filtered page is
  // fetched by id (RBAC-scoped) so the drawer can still open, without inserting the Job
  // into the filtered table or disturbing the current filters/pagination.
  const [offPage, setOffPage] = useState<{ id: string; row: JobIndexRow | null; state: "loading" | "ready" | "denied" | "notfound" } | null>(null);
  useEffect(() => {
    const id = filters.selected;
    if (!id || selectedRow || state !== "ready") {
      setOffPage(null);
      return;
    }
    let cancelled = false;
    setOffPage({ id, row: null, state: "loading" });
    getJobQuickView(token, id)
      .then((r) => {
        if (!cancelled) setOffPage({ id, row: r.row, state: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const s = (error as { status?: number })?.status;
        setOffPage({ id, row: null, state: s === 403 ? "denied" : "notfound" });
      });
    return () => {
      cancelled = true;
    };
  }, [token, filters.selected, selectedRow, state, reloadNonce]);

  const drawerRow = selectedRow ?? (offPage?.state === "ready" ? offPage.row : null);
  const drawerOutside = !selectedRow && Boolean(offPage?.row);
  const closeSelection = () => writeHash({ selected: null, focus: null });

  // A demo tenant defaults to the Curated Demo set the first time the view opens without
  // an explicit choice — never to zero and never to all hundreds. The API default hides
  // demo data; this is a one-time URL-backed default the user can change.
  useEffect(() => {
    if (data?.tenant_is_demo && filters.demo_view == null && filters.lifecycle_scope == null) {
      writeHash({ demo_view: "curated" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tenant_is_demo, filters.demo_view, filters.lifecycle_scope]);
  const isDemoTenant = Boolean(data?.tenant_is_demo);

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
          {isDemoTenant ? (
            <label className="jobs-index__control">
              <span>Demo</span>
              <select
                aria-label="Demo data view"
                value={filters.demo_view ?? "curated"}
                onChange={(e) => writeHash({ demo_view: e.target.value, lifecycle_scope: null, offset: null })}
              >
                {DEMO_VIEWS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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

      {drawerRow ? (
        <JobQuickViewDrawer
          row={drawerRow}
          token={token}
          canManage={canManage}
          focusSection={filters.focus ?? null}
          outsideResult={drawerOutside}
          onClose={closeSelection}
          onMutated={() => setReloadNonce((n) => n + 1)}
        />
      ) : offPage && offPage.state !== "ready" ? (
        <div className="jobs-drawer__scrim" onClick={closeSelection}>
          <aside className="jobs-drawer jobs-drawer--status" role="dialog" aria-modal="true" aria-label="Job quick view" onClick={(e) => e.stopPropagation()}>
            <header className="jobs-drawer__head">
              <strong>Job quick view</strong>
              <button type="button" className="jobs-drawer__close" onClick={closeSelection} aria-label="Close quick view">✕</button>
            </header>
            <div className="jobs-drawer__status" role={offPage.state === "loading" ? undefined : "alert"}>
              {offPage.state === "loading" ? "Loading job…" : null}
              {offPage.state === "denied" ? "You don't have access to this job." : null}
              {offPage.state === "notfound" ? "This job couldn't be found. The link may point to a different record type or a job outside your access." : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function navigate(hash: string) {
  window.location.hash = hash;
}

// In-viewport quick-view drawer. Canonical Truth Snapshot first; never fabricates
// Shoot-derived state for an unlinked Job; workflow/production capabilities are
// independent of Shoot linkage. Purge is never offered here.
function JobQuickViewDrawer({
  row,
  token,
  canManage,
  focusSection,
  outsideResult = false,
  onClose,
  onMutated
}: {
  row: JobIndexRow;
  token: string;
  canManage: boolean;
  focusSection: string | null;
  outsideResult?: boolean;
  onClose: () => void;
  onMutated: () => void;
}) {
  const closeRef = useState<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isArchived = row.job_status === "archived";

  useEffect(() => {
    closeRef[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, closeRef[0]]);

  useEffect(() => {
    if (focusSection) document.getElementById(`jobs-drawer-section-${focusSection}`)?.scrollIntoView({ block: "nearest" });
  }, [focusSection]);

  async function runArchive() {
    setBusy(true);
    setActionError(null);
    try {
      await archiveSharedJob(token, row.id, "Archived from Jobs quick view");
      onMutated();
      onClose();
    } catch {
      setActionError("Couldn't archive this job.");
    } finally {
      setBusy(false);
    }
  }
  async function runRestore() {
    setBusy(true);
    setActionError(null);
    try {
      await restoreSharedJob(token, row.id);
      onMutated();
      onClose();
    } catch {
      setActionError("Couldn't restore this job.");
    } finally {
      setBusy(false);
    }
  }

  const dueDate = row.production_deadline_at ?? row.client_deadline_at;
  // Distinct lifecycle label (Step 9: remove the duplicate status — "Lifecycle" must not
  // simply restate "Status"). Derived from canonical fields, not a second copy of job_status.
  const lifecycleLabel = isArchived
    ? "Archived"
    : row.job_status === "cancelled"
      ? "Canceled"
      : row.job_status === "execution_complete" || row.production_status === "delivered" || row.production_status === "complete"
        ? "Completed"
        : "Active";
  return (
    <div className="jobs-drawer__scrim" onClick={onClose}>
      <aside className="jobs-drawer" role="dialog" aria-modal="true" aria-label={`Job quick view: ${row.title}`} onClick={(e) => e.stopPropagation()}>
        <header className="jobs-drawer__head">
          <div>
            <strong>{row.title}</strong>
            {row.job_number ? <span className="jobs-index__job-number">{row.job_number}</span> : null}
          </div>
          <button type="button" ref={(el) => closeRef[1](el)} className="jobs-drawer__close" onClick={onClose} aria-label="Close quick view">
            ✕
          </button>
        </header>
        {outsideResult ? (
          <p className="jobs-drawer__outside" role="note">
            This job is outside the current filtered result. Your filters and page are unchanged.
          </p>
        ) : null}

        <section className="jobs-drawer__section" id="jobs-drawer-section-snapshot" aria-label="Truth snapshot">
          <dl className="jobs-drawer__snapshot">
            <div><dt>Organization</dt><dd>{row.organization_name ?? "—"}</dd></div>
            <div><dt>Type</dt><dd>{humanize(row.job_category)}</dd></div>
            <div><dt>Date</dt><dd>{formatDate(row.job_date)}</dd></div>
            <div><dt>Department</dt><dd>{humanize(row.department_type)}</dd></div>
            <div><dt>Owner</dt><dd>{row.owner_name ?? <span className="jobs-index__muted">Unowned</span>}</dd></div>
            <div><dt>Status</dt><dd>{humanize(row.job_status)}</dd></div>
            <div><dt>Production</dt><dd>{humanize(row.production_status)}</dd></div>
            <div><dt>Readiness</dt><dd>{humanize(row.readiness_status)}</dd></div>
            <div><dt>Risk</dt><dd>{humanize(row.risk_status)}</dd></div>
            <div><dt>Blockers</dt><dd>{row.blocker_count}</dd></div>
            <div><dt>Missing required</dt><dd>{row.incomplete_required_count}</dd></div>
            <div><dt>Promised delivery</dt><dd>{formatDate(dueDate)}</dd></div>
            <div><dt>Lifecycle</dt><dd>{lifecycleLabel}</dd></div>
          </dl>
        </section>

        <section className="jobs-drawer__section" id="jobs-drawer-section-attention" aria-label="Attention reasons">
          <h3>Attention</h3>
          {row.attention_reasons.length ? (
            <ul className="jobs-drawer__reasons">
              {row.attention_reasons.map((reason) => (
                <li key={reason}>
                  <strong>{humanize(reason)}</strong>
                  <span> — {ATTENTION_REASON_COPY[reason] ?? "Canonical Job-native reason."}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="jobs-index__muted">No canonical attention reasons.</p>
          )}
          {row.shoot_link_status === "unlinked" ? (
            <p className="jobs-drawer__note">Shoot-impact, acknowledgment, and schedule-conflict reasons are not shown for an unlinked Job.</p>
          ) : null}
        </section>

        <section className="jobs-drawer__section" id="jobs-drawer-section-workflow" aria-label="Workflow">
          <h3>Workflow</h3>
          {row.workflow_data_available ? (
            <p>
              {row.workflow_run_count} workflow run{row.workflow_run_count === 1 ? "" : "s"}.{" "}
              <button type="button" className="jobs-drawer__link" onClick={() => navigate("#project-tracking")}>Open workflow</button>
            </p>
          ) : (
            <p className="jobs-index__muted">No workflow data.</p>
          )}
        </section>

        <section className="jobs-drawer__section" id="jobs-drawer-section-production" aria-label="Production">
          <h3>Production</h3>
          {row.production_data_available ? (
            <p>
              {humanize(row.production_status)} · {row.production_item_count} item{row.production_item_count === 1 ? "" : "s"}.{" "}
              <button type="button" className="jobs-drawer__link" onClick={() => navigate("#production")}>Open production</button>
            </p>
          ) : (
            <p className="jobs-index__muted">No production data.</p>
          )}
        </section>

        <section className="jobs-drawer__section" id="jobs-drawer-section-shoot" aria-label="Linked shoots">
          <h3>Operational Shoot</h3>
          {row.shoot_link_status === "linked" ? (
            <div>
              <p className="jobs-index__linked">{row.linked_shoot_count} confirmed linked Shoot{row.linked_shoot_count === 1 ? "" : "s"}.</p>
              <ul className="jobs-drawer__shoots">
                {row.linked_shoot_ids.map((sid) => (
                  <li key={sid}>
                    <code>{sid.slice(0, 8)}</code>{" "}
                    <button type="button" className="jobs-drawer__link" onClick={() => navigate(`#scheduling?shoot=${sid}`)}>Open Schedule</button>{" "}
                    <button type="button" className="jobs-drawer__link" onClick={() => navigate(`#operations/staffing?area=staffing&shoot=${sid}`)}>Open Staffing</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="jobs-index__muted">No Shoot linked — operational scheduling and staffing data are unavailable until a Shoot is linked.</p>
          )}
        </section>

        {actionError ? <p className="jobs-drawer__error" role="alert">{actionError}</p> : null}
        <footer className="jobs-drawer__actions">
          <button type="button" className="jobs-drawer__primary" onClick={() => navigate(`#jobs/${row.id}`)}>Open full detail</button>
          {canManage && !isArchived ? (
            <button type="button" disabled={busy} onClick={runArchive}>Archive</button>
          ) : null}
          {canManage && isArchived ? (
            <button type="button" disabled={busy} onClick={runRestore}>Restore</button>
          ) : null}
        </footer>
      </aside>
    </div>
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
