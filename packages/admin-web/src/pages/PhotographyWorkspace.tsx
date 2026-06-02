import { useEffect, useMemo, useState } from "react";
import { CompactActiveWorkPanel } from "../components/workspace/CompactActiveWorkPanel";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../components/workspace/WorkspacePageHeader";
import type { SharedJobListItem } from "../jobTruthTypes";
import type { SharedJobDay, SharedJobDetailResponse, SharedJobStaffAssignment } from "../jobTruthTypes";
import { getSharedJobDetail, listSharedJobs } from "../services/jobsApi";
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
      "Field-ready arrival, location, contact, parking, crew, and note context for photographers checking the next shoot before they leave.",
    meta: [
      { label: "Field directions", tone: "info" },
      { label: "Read-only pilot view", tone: "neutral" }
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
  { id: "closeout", label: "Post-Shoot / Evaluations", hash: "#job-closeout", detail: "Closeout, shoot check-ins, mileage review, and post-shoot learning flow." },
  { id: "workload", label: "Senior Photographer View", hash: "#studios/workload", detail: "Compact next-action view for leads and senior photographers." }
];

const HOMEPAGE_LINK_IDS = new Set(["shoots", "pre-service", "travel", "closeout"]);

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

export function StudiosWorkspace({ token, currentUser, focus = "overview" }: Props) {
  const copy = FOCUS_COPY[focus];
  const isOverview = focus === "overview";
  const isTodayFocus = focus === "today";
  const isTravelFocus = focus === "travel";
  const isPreServiceFocus = focus === "pre_service" || focus === "readiness";

  return (
    <div className="workspace-shell studios-workspace">
      <WorkspacePageHeader
        eyebrow="Photography"
        title={copy.title}
        summary={copy.summary}
        meta={copy.meta}
        actions={
          isOverview ? undefined : (
            <WorkspaceActionBar compact>
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/calendar")}>
                30-Day Calendar
              </button>
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/shoots")}>
                Today's Shoots
              </button>
              {!isTravelFocus ? (
                <button type="button" onClick={() => (window.location.hash = "#my-work")}>
                  My Work
                </button>
              ) : null}
            </WorkspaceActionBar>
          )
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
            </div>
          </section>

          <section className="studios-workspace__launch-grid" aria-label="Photography launch points">
            {PRIMARY_LINKS.filter((link) => HOMEPAGE_LINK_IDS.has(link.id)).map((link) => (
              <button key={link.id} type="button" className="panel studios-workspace__launch-card" onClick={() => (window.location.hash = link.hash)}>
                <div className="eyebrow">Photography</div>
                <strong>{link.label}</strong>
                <p>{link.detail}</p>
              </button>
            ))}
          </section>
        </>
      ) : !isTravelFocus ? (
        <section className="panel studios-workspace__focus-card" aria-label="Photography route shortcuts">
          <div className="studios-workspace__focus-actions">
            {PRIMARY_LINKS.map((link) => (
              <button key={link.id} type="button" className="secondary-button" onClick={() => (window.location.hash = link.hash)}>
                {link.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {isOverview || isTravelFocus ? null : (
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
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/shoots")}>
              Today's Shoots
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
              Pre-Service
            </button>
          </div>
        </section>
      )}

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

      {isTravelFocus ? <PhotographyTravelPanel token={token} /> : null}

      {isTodayFocus || isOverview || isTravelFocus ? null : (
        <CompactActiveWorkPanel
          token={token}
          currentUser={currentUser}
          title={copy.title}
          summary="Dense, scan-first work view for jobs that create field execution pressure. Keep owner, date, next action, and risk visible without a tall card stack."
          routeHash="#studios/shoots"
          focus={focus}
          showDepartmentFilter={focus === "workload"}
        />
      )}
    </div>
  );
}

function PhotographyTravelPanel({ token }: { token: string }) {
  const [jobs, setJobs] = useState<SharedJobListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SharedJobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listSharedJobs(token)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const travelJobs = response.jobs
          .filter((job) => job.primary_day_date && !["archived", "cancelled"].includes(job.job_status))
          .sort(compareJobsForTravel);
        setJobs(travelJobs);
        setSelectedJobId((current) => current ?? travelJobs[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Travel details could not be loaded.");
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
  }, [token]);

  useEffect(() => {
    if (!selectedJobId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    getSharedJobDetail(token, selectedJobId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedJobId, token]);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null, [jobs, selectedJobId]);
  const travelContext = useMemo(() => buildTravelContext(selectedJob, detail), [detail, selectedJob]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading travel details" summary="Pulling the next shoot location, time, contact, and crew context." />;
  }

  if (error) {
    return <WorkspaceEmptyState title="Travel details are unavailable" summary={error} />;
  }

  if (!selectedJob || !travelContext) {
    return (
      <WorkspaceEmptyState
        title="No upcoming Travel jobs are ready"
        summary="When a Photography job has a date and location, the field travel overview will show where to go and what to know before leaving."
        actions={
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/calendar")}>
            Open 30-Day Calendar
          </button>
        }
      />
    );
  }

  return (
    <section className="panel studios-workspace__travel-panel" aria-label="Travel field overview">
      <div className="studios-workspace__travel-header">
        <div>
          <div className="eyebrow">Next Field Stop</div>
          <h3>{travelContext.jobName}</h3>
          <p>{travelContext.organizationName}</p>
        </div>
        {jobs.length > 1 ? (
          <label className="filter-field">
            <span>Choose shoot</span>
            <select value={selectedJob.id} onChange={(event) => setSelectedJobId(event.target.value)}>
              {jobs.slice(0, 8).map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="studios-workspace__travel-location-card">
        <div>
          <div className="eyebrow">Where Am I Going?</div>
          <strong>{travelContext.locationName}</strong>
          {travelContext.address ? <p>{travelContext.address}</p> : <p>Address pending</p>}
        </div>
        {travelContext.mapsUrl ? (
          <a className="secondary-button" href={travelContext.mapsUrl} target="_blank" rel="noreferrer">
            Open in Google Maps
          </a>
        ) : null}
      </div>

      <div className="studios-workspace__travel-grid">
        <TravelInfoGroup title="Schedule" items={travelContext.scheduleItems} />
        <TravelInfoGroup title="Contact" items={travelContext.contactItems} />
        <TravelInfoGroup title="Crew" items={travelContext.crewItems} />
        <TravelInfoGroup title="Parking / Load-In" items={travelContext.logisticsItems} />
        <TravelInfoGroup title="Field Notes" items={travelContext.noteItems} />
        <article className="studios-workspace__travel-info-card studios-workspace__travel-info-card--placeholder">
          <h4>Monday</h4>
          <p>Monday schedule/staffing integration not connected yet.</p>
        </article>
      </div>

      {detailLoading ? <p className="muted">Refreshing detail notes...</p> : null}
    </section>
  );
}

function TravelInfoGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="studios-workspace__travel-info-card">
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>Not available yet.</p>
      )}
    </article>
  );
}

function buildTravelContext(job: SharedJobListItem | null, detail: SharedJobDetailResponse | null) {
  if (!job) {
    return null;
  }

  const primaryDay = findPrimaryTravelDay(job, detail?.days ?? []);
  const employeeLocation = detail?.prep_readiness.employee_briefing.primary_location ?? null;
  const primaryContact = findPrimaryContact(job, detail);
  const locationName = firstString(
    detail?.summary.primary_location_name,
    primaryDay?.location_name,
    employeeLocation?.location_name,
    job.primary_location_name
  );
  const address = firstString(employeeLocation?.address_display, detail?.summary.primary_location_address, job.primary_location_address);
  const mapsUrl = firstString(employeeLocation?.google_maps_url, buildGoogleMapsSearchLink(address ?? locationName));
  const scheduleItems = [
    formatDateLine(primaryDay?.date ?? job.primary_day_date),
    formatTimeLine(primaryDay?.start_time ?? job.primary_day_start_time, primaryDay?.end_time ?? job.primary_day_end_time),
    primaryDay?.check_in_window_start || primaryDay?.check_in_window_end
      ? `Check-in window: ${formatClockLabel(primaryDay.check_in_window_start)}-${formatClockLabel(primaryDay.check_in_window_end)}`
      : null
  ].filter((value): value is string => Boolean(value));
  const crewItems = buildCrewItems(job, detail?.staff_assignments ?? []);
  const logisticsItems = [
    firstString(primaryDay?.parking_notes, employeeLocation?.parking_instructions),
    firstString(employeeLocation?.unloading_instructions, primaryDay?.access_notes),
    firstString(employeeLocation?.entrance_instructions, employeeLocation?.security_checkin_requirements),
    firstString(primaryDay?.setup_notes, employeeLocation?.setup_area)
  ].filter((value): value is string => Boolean(value));
  const noteItems = [
    firstString(primaryDay?.travel_notes, employeeLocation?.navigation_notes),
    firstString(employeeLocation?.employee_facing_notes, employeeLocation?.weather_contingency_notes),
    firstString(job.location_override_note, job.description_internal),
    firstString(job.school_profile?.special_instructions, job.sports_profile?.client_expectations_notes)
  ].filter((value): value is string => Boolean(value));
  const contactItems = [
    primaryContact?.name ? `Primary: ${primaryContact.name}` : null,
    primaryContact?.phone ? `Phone: ${primaryContact.phone}` : null,
    primaryContact?.email ? `Email: ${primaryContact.email}` : null
  ].filter((value): value is string => Boolean(value));

  return {
    organizationName: detail?.summary.organization_name ?? job.organization_name ?? "Client pending",
    jobName: detail?.job.title ?? job.title,
    locationName: locationName ?? "Location pending",
    address,
    mapsUrl,
    scheduleItems,
    contactItems,
    crewItems,
    logisticsItems,
    noteItems
  };
}

function findPrimaryTravelDay(job: SharedJobListItem, days: SharedJobDay[]) {
  if (!days.length) {
    return null;
  }
  return days.find((day) => day.date === job.primary_day_date) ?? days[0];
}

function findPrimaryContact(job: SharedJobListItem, detail: SharedJobDetailResponse | null) {
  const candidates = [
    ...(detail?.prep_readiness.client_prep.eligible_email_recipients ?? []),
    ...(detail?.prep_readiness.client_prep.eligible_sms_recipients ?? [])
  ];
  const matchingContact = candidates.find((contact) => contact.display_name === (detail?.summary.primary_contact_name ?? job.primary_contact_name));
  const contact = matchingContact ?? candidates[0] ?? null;
  const name = detail?.summary.primary_contact_name ?? job.primary_contact_name ?? contact?.display_name ?? null;
  return name || contact?.mobile_phone || contact?.email
    ? {
        name,
        phone: contact?.mobile_phone ?? null,
        email: contact?.email ?? null
      }
    : null;
}

function buildCrewItems(job: SharedJobListItem, assignments: SharedJobStaffAssignment[]) {
  const confirmed = assignments.filter((assignment) => assignment.assignment_status !== "cancelled");
  const lead = confirmed.find((assignment) => assignment.is_lead) ?? confirmed.find((assignment) => assignment.user_name === job.lead_owner_name);
  const crewNames = confirmed.map((assignment) => assignment.user_name).filter((value): value is string => Boolean(value));
  const items = [
    lead?.user_name || job.lead_owner_name ? `Lead photographer: ${lead?.user_name ?? job.lead_owner_name}` : null,
    confirmed.length
      ? `${confirmed.length} assigned: ${crewNames.slice(0, 4).join(", ")}${crewNames.length > 4 ? ` +${crewNames.length - 4} more` : ""}`
      : `${job.assigned_staff_count} assigned / ${job.ready_present_count || job.checked_in_staff_count} active`,
    job.staffing_status !== "ready_confirmed" ? `Staffing status: ${humanizeTravelValue(job.staffing_status)}` : null
  ];
  return items.filter((value): value is string => Boolean(value));
}

function compareJobsForTravel(left: SharedJobListItem, right: SharedJobListItem) {
  return String(left.primary_day_date ?? "").localeCompare(String(right.primary_day_date ?? "")) || left.title.localeCompare(right.title);
}

function buildGoogleMapsSearchLink(query: string | null | undefined) {
  const cleaned = query?.trim();
  return cleaned ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleaned)}` : null;
}

function formatDateLine(value: string | null | undefined) {
  if (!value) {
    return "Date pending";
  }
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return `Date: ${value}`;
  }
  return `Date: ${parsed.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;
}

function formatTimeLine(start: string | null | undefined, end: string | null | undefined) {
  if (start && end) {
    return `Time: ${formatClockLabel(start)}-${formatClockLabel(end)}`;
  }
  if (start) {
    return `Arrival/start: ${formatClockLabel(start)}`;
  }
  return "Time pending";
}

function formatClockLabel(value: string | null | undefined) {
  if (!value) {
    return "pending";
  }
  const timeOnly = value.includes("T") ? value.slice(11, 16) : value.slice(0, 5);
  const [hourValue = "0", minuteValue = "00"] = timeOnly.split(":");
  const hour = Number(hourValue);
  if (Number.isNaN(hour)) {
    return value;
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minuteValue.padStart(2, "0")} ${suffix}`;
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? null;
}

function humanizeTravelValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
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
