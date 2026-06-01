import { useEffect, useMemo, useState } from "react";
import { CompactActiveWorkPanel } from "../components/workspace/CompactActiveWorkPanel";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../components/workspace/WorkspacePageHeader";
import type { SharedJobListItem } from "../jobTruthTypes";
import { listSharedJobs } from "../services/jobsApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  focus?: "overview" | "today" | "travel" | "pre_service" | "readiness" | "workload";
};

const FOCUS_COPY: Record<NonNullable<Props["focus"]>, { title: string; summary: string; meta: WorkspaceHeaderMeta[] }> = {
  overview: {
    title: "Photography Workspace",
    summary:
      "Photography starts with the 30-day shoot calendar, then moves into today's shoots, pre-service readiness, travel context, and field workload without turning staffing into a Photography-owned queue.",
    meta: [
      { label: "Calendar first", tone: "info" },
      { label: "Field readiness", tone: "warning" },
      { label: "Staffing stays leadership-owned", tone: "neutral" }
    ]
  },
  today: {
    title: "Today's Shoots / Day at a Glance",
    summary:
      "Same-day Photography view for shoot timing, client context, location, lead ownership, and any readiness concerns that need attention before crews move.",
    meta: [
      { label: "Same-day shoots", tone: "info" },
      { label: "Read-only field view", tone: "neutral" },
      { label: "Prep and travel links", tone: "success" }
    ]
  },
  travel: {
    title: "Travel & Logistics",
    summary:
      "Keep route planning, parking notes, arrival timing, and field logistics visible before the crew leaves without pretending this is a live mapping integration yet.",
    meta: [
      { label: "Travel visibility", tone: "info" },
      { label: "Location prep", tone: "neutral" }
    ]
  },
  pre_service: {
    title: "Pre-Service / Readiness",
    summary:
      "Pre-service is the job prep desk for briefings, last-year context, reference material, crew notes, and the final readiness items senior photographers need before launch.",
    meta: [
      { label: "Crew briefings", tone: "warning" },
      { label: "Reference context", tone: "info" },
      { label: "Launch ready", tone: "success" }
    ]
  },
  readiness: {
    title: "Pre-Service / Readiness",
    summary:
      "Readiness now lives inside Pre-Service so crews have one place to check briefing status, prep gaps, references, and customer context before the shoot.",
    meta: [
      { label: "Blocked work", tone: "critical" },
      { label: "Pre-service desk", tone: "warning" }
    ]
  },
  workload: {
    title: "Senior Photographer View",
    summary:
      "Use the compact workload view to see who owns what, which jobs need field attention, and where senior photographers should look next.",
    meta: [
      { label: "Owner balance", tone: "info" },
      { label: "Next action clarity", tone: "warning" }
    ]
  }
};

const PRIMARY_LINKS = [
  { id: "calendar", label: "30-Day Calendar", hash: "#studios/calendar", detail: "Start here for upcoming shoot load, linked assignments, and dates that need attention." },
  { id: "shoots", label: "Today's Shoots", hash: "#studios/shoots", detail: "Execution queue and live field detail for the current shoot day." },
  { id: "pre-service", label: "Pre-Service / Readiness", hash: "#studios/pre-service", detail: "Briefings, prep gaps, references, and final readiness context in one place." },
  { id: "travel", label: "Travel & Logistics", hash: "#studios/travel", detail: "Routing notes, parking context, location reminders, and arrival guidance." },
  { id: "workload", label: "Senior Photographer View", hash: "#studios/workload", detail: "Compact next-action view for leads and senior photographers." }
];

const PRE_SERVICE_CARDS = [
  {
    title: "Job Details",
    detail: "Event timing, location, primary contact, account owner, estimated volume, and current readiness status should be checked here first."
  },
  {
    title: "Crew & Staffing Summary",
    detail: "Shows the planned crew, lead photographer, open coverage, and confirmation posture. Staffing edits remain in the leadership assignment board."
  },
  {
    title: "Pre-Service Briefing Notes",
    detail: "A single place for day-specific notes, setup reminders, customer expectations, and known site constraints."
  },
  {
    title: "Reference Packet",
    detail: "PDFs, prior-year notes, reference photos, customer survey context, and last post-shoot evaluation should land here as the next data-backed slice."
  }
];

const TRAVEL_CARDS = [
  {
    title: "Route Preview",
    detail: "Open the location in Google Maps when a demo job includes a usable address. This is a safe placeholder, not a live routing sync."
  },
  {
    title: "Arrival Context",
    detail: "Parking, entrance, check-in contact, unload constraints, and arrival buffer belong here before crews leave."
  },
  {
    title: "Field Notes",
    detail: "Weather, site reminders, and client-specific movement notes should stay close to the shoot instead of scattered through chat."
  }
];

export function StudiosWorkspace({ token, currentUser, focus = "overview" }: Props) {
  const copy = FOCUS_COPY[focus];
  const isOverview = focus === "overview";
  const isTodayFocus = focus === "today";
  const isPreServiceFocus = focus === "pre_service" || focus === "readiness";

  return (
    <div className="workspace-shell studios-workspace">
      <WorkspacePageHeader
        eyebrow="Photography"
        title={copy.title}
        summary={copy.summary}
        meta={copy.meta}
        actions={
          <WorkspaceActionBar compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#my-schedule")}>
              My Schedule
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/calendar")}>
              30-Day Calendar
            </button>
            <button type="button" onClick={() => (window.location.hash = "#my-work")}>
              My Work
            </button>
          </WorkspaceActionBar>
        }
      />

      {isOverview ? (
        <>
          <section className="panel studios-workspace__calendar-card">
            <div>
              <div className="eyebrow">Open First</div>
              <h3>30-Day Photography Calendar</h3>
              <p>
                Use the calendar as the first stop for the review. It should answer what is coming up, which shoot days look heavy,
                and where a senior photographer needs to click next.
              </p>
            </div>
            <div className="studios-workspace__focus-actions">
              <button type="button" className="primary-button" onClick={() => (window.location.hash = "#studios/calendar")}>
                Open 30-Day Calendar
              </button>
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/shoots")}>
                Today's Shoots
              </button>
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
                Pre-Service / Readiness
              </button>
            </div>
          </section>

          <section className="studios-workspace__launch-grid" aria-label="Photography launch points">
            {PRIMARY_LINKS.map((link) => (
              <button key={link.id} type="button" className="panel studios-workspace__launch-card" onClick={() => (window.location.hash = link.hash)}>
                <div className="eyebrow">Photography</div>
                <strong>{link.label}</strong>
                <p>{link.detail}</p>
              </button>
            ))}
          </section>
        </>
      ) : (
        <section className="panel studios-workspace__focus-card" aria-label="Photography route shortcuts">
          <div className="studios-workspace__focus-actions">
            {PRIMARY_LINKS.map((link) => (
              <button key={link.id} type="button" className="secondary-button" onClick={() => (window.location.hash = link.hash)}>
                {link.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel studios-workspace__focus-card">
        <div className="workspace-section-header">
          <div className="workspace-section-header__copy">
            <div className="eyebrow">Department Focus</div>
            <div className="workspace-section-header__title-row">
              <h3>{copy.title}</h3>
            </div>
            <p>{copy.summary}</p>
          </div>
        </div>
        <div className="studios-workspace__focus-actions">
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#operations/today")}>
            Open Today
          </button>
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
            Open Pre-Service
          </button>
        </div>
      </section>

      {isTodayFocus ? <PhotographyTodayShootsPanel token={token} /> : null}

      {isPreServiceFocus ? (
        <section className="panel studios-workspace__prep-panel">
          <div className="workspace-section-header">
            <div className="workspace-section-header__copy">
              <div className="eyebrow">Job Prep Desk</div>
              <h3>What senior photographers should check before launch</h3>
              <p>These cards keep the review honest: some context is present today, and some reference packet pieces are the next slice.</p>
            </div>
          </div>
          <div className="studios-workspace__prep-grid">
            {PRE_SERVICE_CARDS.map((card) => (
              <article key={card.title} className="studios-workspace__info-card">
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {focus === "travel" ? (
        <section className="panel studios-workspace__prep-panel">
          <div className="workspace-section-header">
            <div className="workspace-section-header__copy">
              <div className="eyebrow">Travel Cleanup</div>
              <h3>Route and arrival context</h3>
              <p>Travel is intentionally simple for the pilot: make the location story obvious, then decide what should be real data.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => window.open("https://www.google.com/maps/search/?api=1&query=North+Metro+Stadium", "_blank", "noopener,noreferrer")}
            >
              Open Sample Map
            </button>
          </div>
          <div className="studios-workspace__prep-grid">
            {TRAVEL_CARDS.map((card) => (
              <article key={card.title} className="studios-workspace__info-card">
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isTodayFocus ? null : (
        <CompactActiveWorkPanel
          token={token}
          currentUser={currentUser}
          title={focus === "overview" ? "Compact Active Work" : copy.title}
          summary="Dense, scan-first work view for jobs that create field execution pressure. Keep owner, date, next action, and risk visible without a tall card stack."
          routeHash="#studios/shoots"
          focus={focus}
          showDepartmentFilter={focus === "overview" || focus === "workload"}
        />
      )}
    </div>
  );
}

function PhotographyTodayShootsPanel({ token }: { token: string }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [jobs, setJobs] = useState<SharedJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listSharedJobs(token, { day_date: today })
      .then((response) => {
        if (!cancelled) {
          setJobs(response.jobs.filter((job) => !["archived", "cancelled"].includes(job.job_status)));
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Today's Photography shoots could not be loaded.");
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
  }, [today, token]);

  if (loading) {
    return (
      <WorkspaceLoadingBlock
        title="Loading today's Photography shoots"
        summary="Pulling same-day jobs, timing, location, lead ownership, and readiness flags."
      />
    );
  }

  if (error) {
    return <WorkspaceEmptyState title="Today's shoots are unavailable" summary={error} />;
  }

  return (
    <section className="panel studios-workspace__prep-panel" aria-label="Today's Photography shoots">
      <div className="workspace-section-header">
        <div className="workspace-section-header__copy">
          <div className="eyebrow">Day at a Glance</div>
          <h3>Photography shoots happening today</h3>
          <p>Read-only field context for time, client, location, lead ownership, and readiness concerns.</p>
        </div>
        <span className="metric-pill">{jobs.length} today</span>
      </div>
      {jobs.length ? (
        <div className="studios-workspace__prep-grid">
          {jobs.map((job) => (
            <article key={job.id} className="studios-workspace__info-card">
              <strong>{job.title}</strong>
              <p>{job.organization_name ?? "Client pending"}</p>
              <dl className="studios-workspace__detail-list">
                <div>
                  <dt>Time</dt>
                  <dd>{formatShootTime(job)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{job.primary_location_name ?? job.primary_location_address ?? "Location pending"}</dd>
                </div>
                <div>
                  <dt>Lead</dt>
                  <dd>{job.lead_owner_name ?? "Lead photographer pending"}</dd>
                </div>
                <div>
                  <dt>Readiness</dt>
                  <dd>{describeTodayReadiness(job)}</dd>
                </div>
              </dl>
              <div className="studios-workspace__focus-actions">
                <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
                  Pre-Service
                </button>
                <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/travel")}>
                  Travel
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState
          title="No Photography shoots are scheduled for today"
          summary="Use the 30-day calendar to scan the next active shoot window."
          actions={
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/calendar")}>
              Open 30-Day Calendar
            </button>
          }
        />
      )}
    </section>
  );
}

function formatShootTime(job: SharedJobListItem) {
  if (job.primary_day_start_time && job.primary_day_end_time) {
    return `${formatClock(job.primary_day_start_time)}-${formatClock(job.primary_day_end_time)}`;
  }
  if (job.primary_day_start_time) {
    return `${formatClock(job.primary_day_start_time)} start`;
  }
  return "Time pending";
}

function formatClock(value: string) {
  const [hourValue = "0", minuteValue = "00"] = value.split(":");
  const hour = Number(hourValue);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minuteValue.padStart(2, "0")} ${suffix}`;
}

function describeTodayReadiness(job: SharedJobListItem) {
  const flags = [
    job.blocker_count > 0 ? `${job.blocker_count} blocker${job.blocker_count === 1 ? "" : "s"}` : null,
    job.open_watch_flag_count > 0 ? `${job.open_watch_flag_count} watch flag${job.open_watch_flag_count === 1 ? "" : "s"}` : null,
    job.readiness_percent < 100 ? `${job.readiness_percent}% ready` : null,
    job.staffing_status !== "ready_confirmed" ? "crew confirmation needs review" : null
  ].filter(Boolean);

  return flags.length ? flags.join(" | ") : "Ready for field review";
}

/**
 * @deprecated Use StudiosWorkspace. Kept temporarily so existing imports and tests
 * can keep resolving while the last Photography-era imports are removed.
 */
export const PhotographyWorkspace = StudiosWorkspace;
