import { useEffect, useMemo, useState } from "react";
import type { JobDepartmentType, SharedJobListItem, SharedJobListQuery } from "../../jobTruthTypes";
import { buildJobCalendarReadiness } from "../../jobCalendarReadiness";
import {
  buildJobMissingInfoChecklist,
  getJobMissingInfoStatusLabel,
  getJobMissingInfoStatusTone
} from "../../jobMissingInfoChecklist";
import { listSharedJobs } from "../../services/jobsApi";
import { StatusPill, formatDate } from "../sports/SportsPrimitives";

type DepartmentJobSpinePanelProps = {
  token?: string;
  jobs?: SharedJobListItem[];
  query?: SharedJobListQuery;
  title: string;
  summary: string;
  departmentTypes?: JobDepartmentType[];
  routeBase: string;
  emptyLabel: string;
  maxItems?: number;
};

type SpineMetric = {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
};

function getJobDate(job: SharedJobListItem) {
  return job.primary_day_date ?? job.scheduled_start_at?.slice(0, 10) ?? job.client_deadline_at?.slice(0, 10) ?? job.production_deadline_at?.slice(0, 10) ?? null;
}

function getStartTime(job: SharedJobListItem) {
  return job.primary_day_start_time ?? job.scheduled_start_at?.slice(11, 16) ?? null;
}

function getEndTime(job: SharedJobListItem) {
  return job.primary_day_end_time ?? job.scheduled_end_at?.slice(11, 16) ?? null;
}

function isThisWeek(dateValue: string | null) {
  if (!dateValue) {
    return false;
  }
  const target = new Date(dateValue);
  if (Number.isNaN(target.getTime())) {
    return false;
  }
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 7;
}

function jobPriorityRank(job: SharedJobListItem) {
  const checklist = buildJobMissingInfoChecklist(job);
  const date = getJobDate(job);
  return (
    checklist.blockerCount * 100 +
    checklist.activeCount * 40 +
    (job.risk_status === "critical" ? 80 : job.risk_status === "high" ? 50 : job.risk_status === "medium" ? 20 : 0) +
    (job.open_watch_flag_count > 0 ? 30 : 0) +
    (job.staffing_status === "gap_flagged" || job.staffing_status === "unassigned" ? 20 : 0) +
    (isThisWeek(date) ? 10 : 0)
  );
}

function sortJobs(left: SharedJobListItem, right: SharedJobListItem) {
  const priorityDiff = jobPriorityRank(right) - jobPriorityRank(left);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const leftDate = getJobDate(left);
  const rightDate = getJobDate(right);
  if (!leftDate && !rightDate) {
    return left.title.localeCompare(right.title);
  }
  if (!leftDate) {
    return 1;
  }
  if (!rightDate) {
    return -1;
  }
  return new Date(leftDate).getTime() - new Date(rightDate).getTime();
}

function getRoute(routeBase: string, job: SharedJobListItem) {
  const separator = routeBase.includes("?") ? "&" : "?";
  if (routeBase.includes("jobId=")) {
    return routeBase.replace("jobId=", `jobId=${encodeURIComponent(job.id)}`);
  }
  if (routeBase.endsWith("/")) {
    return `${routeBase}${job.id}`;
  }
  if (routeBase.includes("?")) {
    return `${routeBase}${separator}jobId=${encodeURIComponent(job.id)}`;
  }
  return `${routeBase}/${job.id}`;
}

function getJobTitle(job: SharedJobListItem) {
  return job.title || job.event_name || job.job_number || "Untitled job";
}

function getOwner(job: SharedJobListItem) {
  return job.lead_owner_name ?? job.account_owner_name ?? "Owner needed";
}

function getCalendarReadiness(job: SharedJobListItem) {
  return buildJobCalendarReadiness({
    date: getJobDate(job),
    startTime: getStartTime(job),
    endTime: getEndTime(job),
    dateOnly: !getStartTime(job),
    locationId: job.primary_location_id,
    contactId: job.primary_contact_id,
    primaryLocationName: job.primary_location_name,
    primaryContactName: job.primary_contact_name,
    staffingStatus: job.staffing_status,
    readinessStatus: job.readiness_status,
    riskStatus: job.risk_status,
    jobStatus: job.job_status,
    blockerCount: job.blocker_count,
    openWatchFlagCount: job.open_watch_flag_count,
    leadOwnerName: job.lead_owner_name,
    accountOwnerName: job.account_owner_name,
    estimatedStaffCount: job.estimated_staff_count
  });
}

function getMetrics(jobs: SharedJobListItem[]): SpineMetric[] {
  const missingJobs = jobs.filter((job) => buildJobMissingInfoChecklist(job).activeCount > 0);
  const blockedJobs = jobs.filter((job) => buildJobMissingInfoChecklist(job).blockerCount > 0 || job.production_status === "blocked" || job.risk_status === "critical");
  const waitingClientJobs = jobs.filter((job) => buildJobMissingInfoChecklist(job).waitingOnClientCount > 0);
  const weekJobs = jobs.filter((job) => isThisWeek(getJobDate(job)));
  return [
    { label: "This week", value: weekJobs.length, detail: "Jobs with shoot or deadline pressure this week.", tone: weekJobs.length ? "info" : "success" },
    { label: "Missing info", value: missingJobs.length, detail: "Roster, team, contact, date, staffing, approval, or blocker gaps.", tone: missingJobs.length ? "warning" : "success" },
    { label: "Blocked", value: blockedJobs.length, detail: "Jobs with blocker or critical risk signals.", tone: blockedJobs.length ? "danger" : "success" },
    { label: "Waiting client", value: waitingClientJobs.length, detail: "Jobs waiting on client details or approval.", tone: waitingClientJobs.length ? "warning" : "success" }
  ];
}

export function DepartmentJobSpinePanel({
  token,
  jobs,
  query = {},
  title,
  summary,
  departmentTypes,
  routeBase,
  emptyLabel,
  maxItems = 4
}: DepartmentJobSpinePanelProps) {
  const [loadedJobs, setLoadedJobs] = useState<SharedJobListItem[]>([]);
  const [loading, setLoading] = useState(Boolean(!jobs && token));
  const [error, setError] = useState("");
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (jobs || !token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    listSharedJobs(token, query)
      .then((response) => {
        if (!cancelled) {
          setLoadedJobs(response.jobs);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.error("Department job spine failed to load", loadError);
          setLoadedJobs([]);
          setError("Job spine data is not available in this demo view.");
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
  }, [jobs, queryKey, token]);

  const visibleJobs = useMemo(() => {
    const source = jobs ?? loadedJobs;
    return source
      .filter((job) => !departmentTypes?.length || departmentTypes.includes(job.department_type))
      .filter((job) => !["archived", "cancelled"].includes(job.job_status))
      .sort(sortJobs);
  }, [departmentTypes, jobs, loadedJobs]);
  const metrics = useMemo(() => getMetrics(visibleJobs), [visibleJobs]);
  const priorityJobs = visibleJobs.slice(0, maxItems);

  return (
    <section className="panel department-job-spine" aria-label={title}>
      <div className="department-job-spine__header">
        <div>
          <div className="eyebrow">Job Priorities</div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
        <span className="metric-pill">{visibleJobs.length} visible</span>
      </div>
      <div className="department-job-spine__metrics" aria-label={`${title} summary`}>
        {metrics.map((metric) => (
          <article key={metric.label} className={`department-job-spine__metric department-job-spine__metric--${metric.tone}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </div>
      {loading ? <div className="empty-state">Loading work spine priorities...</div> : null}
      {error ? <div className="empty-state">{error}</div> : null}
      {!loading && !error ? (
        <div className="department-job-spine__list">
          {priorityJobs.length ? (
            priorityJobs.map((job) => {
              const checklist = buildJobMissingInfoChecklist(job);
              const activeItem = checklist.activeItems[0];
              const calendar = getCalendarReadiness(job);
              const date = getJobDate(job);
              return (
                <a key={job.id} className="department-job-spine__item" href={getRoute(routeBase, job)}>
                  <div className="department-job-spine__item-main">
                    <strong>{getJobTitle(job)}</strong>
                    <span>{job.organization_name ?? "Organization not set"} | {date ? formatDate(date) : "Date TBD"}</span>
                  </div>
                  <div className="department-job-spine__item-status">
                    <StatusPill label={calendar.label} tone={calendar.tone} />
                    {activeItem ? <StatusPill label={`${checklist.activeCount} missing`} tone={getJobMissingInfoStatusTone(activeItem)} /> : <StatusPill label="Info clear" tone="success" />}
                  </div>
                  <p>{activeItem ? activeItem.nextAction : calendar.nextAction}</p>
                  <small>
                    Owner: {getOwner(job)} | Waiting: {activeItem ? getJobMissingInfoStatusLabel(activeItem.status) : "No active blocker"}
                  </small>
                </a>
              );
            })
          ) : (
            <div className="empty-state">{emptyLabel}</div>
          )}
        </div>
      ) : null}
    </section>
  );
}
