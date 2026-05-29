import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import type {
  JobDepartmentType,
  SharedJobPrepReadinessQueueIssue,
  SharedJobPrepReadinessQueueItem,
  SharedJobPrepReadinessQueueResponse,
  SharedJobPrepReadinessStatus
} from "../jobTruthTypes";
import { listSharedPrepReadinessQueue } from "../services/jobsApi";
import type { SessionUser } from "../types";

type PrepReadinessQueueProps = {
  token: string;
  currentUser: SessionUser;
};

type StatusFilter = SharedJobPrepReadinessStatus | "all";
type IssueFilter = SharedJobPrepReadinessQueueIssue | "all";
type DepartmentFilter = JobDepartmentType | "all";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  blocked: "Blocked",
  needs_attention: "Needs Review",
  ready: "Ready"
};

const ISSUE_LABELS: Record<IssueFilter, string> = {
  all: "All readiness gaps",
  missing_location: "Missing location",
  missing_prep_recipient: "Missing prep recipient",
  missing_sms_eligibility: "Missing SMS eligibility",
  missing_location_details: "Missing parking / entrance / setup",
  message_preview_blocked: "Message preview blocked"
};

const DEPARTMENT_LABELS: Record<DepartmentFilter, string> = {
  all: "All departments",
  schools: "Schools",
  sports: "Sports",
  corporate: "Corporate",
  headshots: "Headshots",
  other: "Other"
};

function friendly(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusTone(status: SharedJobPrepReadinessStatus) {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "needs_attention") {
    return "warning";
  }
  return "success";
}

function healthLabel(value: "ready" | "missing" | "needs_details" | "not_ready" | "needs_review" | "blocked") {
  switch (value) {
    case "needs_details":
      return "Needs details";
    case "not_ready":
      return "Not ready";
    case "needs_review":
      return "Needs review";
    default:
      return friendly(value);
  }
}

function topWarnings(item: SharedJobPrepReadinessQueueItem) {
  if (item.warnings.length) {
    return item.warnings.slice(0, 3);
  }
  if (item.readiness_status === "ready") {
    return [{ code: "ready", severity: "info" as const, label: "Prep data ready", detail: "Client prep preview has the required data." }];
  }
  return [{ code: "needs_review", severity: "warning" as const, label: "Needs review", detail: "Open the job to review prep readiness details." }];
}

function PrepReadinessQueueRow({ item }: { item: SharedJobPrepReadinessQueueItem }) {
  return (
    <article className={`prep-readiness-queue__row prep-readiness-queue__row--${item.readiness_status}`}>
      <div className="prep-readiness-queue__cell prep-readiness-queue__main" data-label="Job">
        <strong>{item.organization_name ?? "Account not connected"}</strong>
        <span>{item.job_name}</span>
        <small>{item.job_number ?? friendly(item.job_category)}</small>
      </div>
      <div className="prep-readiness-queue__cell" data-label="Job date">
        <strong>{formatDate(item.job_date)}</strong>
        <small>{DEPARTMENT_LABELS[item.department_type]} / {friendly(item.job_category)}</small>
      </div>
      <div className="prep-readiness-queue__cell" data-label="Readiness">
        <span className={`prep-readiness-queue__pill prep-readiness-queue__pill--${statusTone(item.readiness_status)}`}>
          {STATUS_LABELS[item.readiness_status]}
        </span>
        <small>Message preview: {healthLabel(item.message_preview_status)}</small>
      </div>
      <div className="prep-readiness-queue__cell prep-readiness-queue__warnings" data-label="Missing data">
        {topWarnings(item).map((warning) => (
          <span key={warning.code} className={`prep-readiness-queue__warning prep-readiness-queue__warning--${warning.severity}`}>
            {warning.label}
          </span>
        ))}
      </div>
      <div className="prep-readiness-queue__cell prep-readiness-queue__status-stack" data-label="Status checks">
        <span>Location: {healthLabel(item.primary_location_status)}</span>
        <span>Email: {healthLabel(item.prep_email_recipient_status)}</span>
        <span>SMS: {healthLabel(item.sms_readiness_status)}</span>
      </div>
      <div className="prep-readiness-queue__cell prep-readiness-queue__actions" data-label="Fix links">
        <a className="button button-secondary" href={item.job_command_center_href}>Open Job</a>
        {item.client_command_center_href ? (
          <a className="button button-secondary" href={item.client_command_center_href}>Fix Client Data</a>
        ) : (
          <span className="prep-readiness-queue__muted">No account link</span>
        )}
      </div>
    </article>
  );
}

export function PrepReadinessQueuePage({ token }: PrepReadinessQueueProps) {
  const [queue, setQueue] = useState<SharedJobPrepReadinessQueueResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSharedPrepReadinessQueue(token, {
      status: statusFilter,
      issue: issueFilter,
      department_type: departmentFilter,
      limit: 150
    })
      .then((response) => {
        if (!cancelled) {
          setQueue(response);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "Prep Readiness Queue failed to load.");
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
  }, [departmentFilter, issueFilter, statusFilter, token]);

  const items = useMemo(() => queue?.items ?? [], [queue]);

  return (
    <main className="workspace-page prep-readiness-queue-page">
      <section className="project-tracking-board-header" aria-label="Prep Readiness Queue">
        <div>
          <span className="section-kicker">Prep Data Completion</span>
          <h1>Prep Readiness Queue</h1>
          <p>
            Find upcoming jobs that are missing client prep data before anyone sends a message. Preview only - no email,
            SMS, automation, or outbound records are created here.
          </p>
        </div>
        <div className="project-tracking-board-header__actions">
          <a className="button button-secondary" href="#project-tracking">Project Dashboard</a>
          <a className="button button-secondary" href="#client-command-center">Client Command Center</a>
        </div>
      </section>

      <section className="project-tracking-summary-strip" aria-label="Prep readiness summary">
        <div className="project-tracking-summary-strip__label">
          <strong>{queue?.summary.total_count ?? 0}</strong>
          <span>jobs in prep queue</span>
        </div>
        <div className="project-tracking-metric-grid">
          <button type="button" className={statusFilter === "blocked" ? "is-active" : ""} onClick={() => setStatusFilter("blocked")}>
            <span className="metric-label">Blocked</span>
            <strong>{queue?.summary.blocked_count ?? 0}</strong>
          </button>
          <button type="button" className={statusFilter === "needs_attention" ? "is-active" : ""} onClick={() => setStatusFilter("needs_attention")}>
            <span className="metric-label">Needs Review</span>
            <strong>{queue?.summary.needs_review_count ?? 0}</strong>
          </button>
          <button type="button" className={statusFilter === "ready" ? "is-active" : ""} onClick={() => setStatusFilter("ready")}>
            <span className="metric-label">Ready</span>
            <strong>{queue?.summary.ready_count ?? 0}</strong>
          </button>
          <button type="button" className={issueFilter === "missing_location" ? "is-active" : ""} onClick={() => setIssueFilter("missing_location")}>
            <span className="metric-label">Missing Location</span>
            <strong>{queue?.summary.missing_location_count ?? 0}</strong>
          </button>
        </div>
      </section>

      <section className="project-tracking-panel prep-readiness-queue__panel">
        <div className="project-tracking-panel__heading">
          <div>
            <div className="section-title">Prep Data Gaps</div>
            <p className="section-subtitle">Sorted by readiness severity, then soonest job date. Open the job or client record to fix the source data.</p>
          </div>
          <button className="project-tracking-control-button" type="button" onClick={() => { setStatusFilter("all"); setIssueFilter("all"); setDepartmentFilter("all"); }}>
            Clear filters
          </button>
        </div>

        <div className="project-tracking-controls" aria-label="Prep readiness filters">
          <label className="project-tracking-sort">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((filter) => (
                <option key={filter} value={filter}>{STATUS_LABELS[filter]}</option>
              ))}
            </select>
          </label>
          <label className="project-tracking-sort">
            <span>Missing data</span>
            <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value as IssueFilter)}>
              {(Object.keys(ISSUE_LABELS) as IssueFilter[]).map((filter) => (
                <option key={filter} value={filter}>{ISSUE_LABELS[filter]}</option>
              ))}
            </select>
          </label>
          <label className="project-tracking-sort">
            <span>Department</span>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value as DepartmentFilter)}>
              {(Object.keys(DEPARTMENT_LABELS) as DepartmentFilter[]).map((filter) => (
                <option key={filter} value={filter}>{DEPARTMENT_LABELS[filter]}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? <div className="empty-state empty-state--panel">{error}</div> : null}
        {loading ? <div className="empty-state empty-state--panel">Loading prep readiness queue...</div> : null}
        {!loading && !error ? (
          <div className="prep-readiness-queue" role="table" aria-label="Prep readiness queue">
            <div className="prep-readiness-queue__row prep-readiness-queue__row--head" aria-hidden="true">
              <span>Job</span>
              <span>Date / Department</span>
              <span>Readiness</span>
              <span>Missing Data</span>
              <span>Status Checks</span>
              <span>Fix Links</span>
            </div>
            {items.map((item) => (
              <PrepReadinessQueueRow key={item.job_id} item={item} />
            ))}
            {!items.length ? <div className="empty-state empty-state--panel">No jobs match the current prep readiness filters.</div> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
