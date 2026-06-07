import { useEffect, useMemo, useState } from "react";
import { DepartmentHubPattern, type DepartmentHubCard } from "../components/department/DepartmentHubPattern";
import { ProjectTrackingDepartmentQueue } from "../components/projectTracking/ProjectTrackingDepartmentQueue";
import { CompactActiveWorkPanel } from "../components/workspace/CompactActiveWorkPanel";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../components/workspace/WorkspacePageHeader";
import { buildSharedJobHash } from "../components/jobs/sharedJobRouting";
import type { SharedJobListItem } from "../jobTruthTypes";
import type {
  SharedJobDay,
  SharedJobDetailResponse,
  SharedJobPrepLocationAttachmentPreview,
  SharedJobReadinessItem,
  SharedJobStaffAssignment
} from "../jobTruthTypes";
import { getSharedJobDetail, listSharedJobs } from "../services/jobsApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  focus?: "overview" | "today" | "travel" | "pre_service" | "readiness" | "workload";
};

const FOCUS_COPY: Record<NonNullable<Props["focus"]>, { title: string; summary: string; meta: WorkspaceHeaderMeta[] }> = {
  overview: {
    title: "Photography Command Hub",
    summary: "Run today's shoots, job prep, travel, senior photographer coverage, and post-shoot handoffs.",
    meta: [
      { label: "Field readiness", tone: "info" },
      { label: "Job prep connected", tone: "success" },
      { label: "Work spine linked", tone: "neutral" }
    ]
  },
  today: {
    title: "Day at a Glance",
    summary:
      "Same-day Photography view for what is happening today, what needs attention, and whether the next click should be Travel or Job Prep.",
    meta: [
      { label: "Today", tone: "info" },
      { label: "Read-only field view", tone: "neutral" },
      { label: "Prep and travel links", tone: "success" }
    ]
  },
  travel: {
    title: "Travel & Logistics",
    summary:
      "Field-ready arrival, location, contact, parking, crew, and note context for photographers checking the next shoot before they leave.",
    meta: [
      { label: "Field logistics", tone: "info" },
      { label: "Read-only pilot view", tone: "neutral" }
    ]
  },
  pre_service: {
    title: "Job Prep / Pre-Service",
    summary:
      "Job Prep is the pre-shoot packet for schedule, location, crew, briefing notes, readiness items, prior context, and reference material before crews launch.",
    meta: [
      { label: "Crew briefings", tone: "warning" },
      { label: "Readiness inside Job Prep", tone: "info" },
      { label: "Prep packet", tone: "success" }
    ]
  },
  readiness: {
    title: "Job Prep / Pre-Service",
    summary:
      "Readiness is part of Job Prep / Pre-Service so crews have one place to check briefing status, prep gaps, references, and customer context before the shoot.",
    meta: [
      { label: "Compatibility route", tone: "neutral" },
      { label: "Prep packet", tone: "warning" }
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
  { id: "shoots", label: "Today's Shoots", hash: "#studios/shoots", detail: "Same-day schedule, locations, leads, crew counts, readiness, and clear next links to Travel or Job Prep." },
  { id: "pre-service", label: "Job Prep / Pre-Service", hash: "#studios/pre-service", detail: "Briefings, prep gaps, references, and readiness context in one place." },
  { id: "travel", label: "Travel & Logistics", hash: "#studios/travel", detail: "Field location, parking, contact, crew, and arrival guidance." },
  { id: "workload", label: "Senior Photographer View", hash: "#studios/workload", detail: "Field leadership view for shoot readiness, handoffs, and photographer support." },
  { id: "calendar", label: "30-Day Planning Calendar", hash: "#studios/calendar", detail: "Planning view for upcoming shoot load, linked assignments, and dates that need attention." },
  { id: "closeout", label: "Post-Shoot Evaluation", hash: "#job-closeout", detail: "Closeout, shoot check-ins, mileage review, and post-shoot learning flow." }
];

const HOMEPAGE_LINK_IDS = new Set(["pre-service", "travel", "workload", "calendar", "closeout"]);

const PHOTOGRAPHY_OPEN_FIRST: DepartmentHubCard[] = [
  { label: "Today's Shoots", value: "Today", detail: "Same-day schedule, leads, locations, and field readiness.", href: "#studios/shoots", tone: "info" },
  { label: "Job Prep", value: "Prep", detail: "Briefings, readiness gaps, references, and client context.", href: "#studios/pre-service", tone: "warning" },
  { label: "Travel / Load-In", value: "Route", detail: "Arrival, parking, contacts, crew, and location guidance.", href: "#studios/travel", tone: "info" },
  { label: "Post-Shoot Handoffs", value: "Closeout", detail: "Evaluations, mileage review, and next production handoff.", href: "#job-closeout", tone: "info" }
];

const PHOTOGRAPHY_ATTENTION: DepartmentHubCard[] = [
  { label: "Shoot Readiness", value: "Check", detail: "Confirm prep and travel before the field team leaves.", href: "#studios/pre-service", tone: "warning" },
  { label: "Travel Risk", value: "Review", detail: "Location, parking, and contact context belong in Travel / Logistics.", href: "#studios/travel", tone: "info" },
  { label: "Field Handoffs", value: "Next", detail: "Post-shoot notes should move through closeout and Project Tracking.", href: "#studios/workload", tone: "info" }
];

const PHOTOGRAPHY_WEEKLY: DepartmentHubCard[] = [
  { label: "Upcoming Shoots", value: "30-Day", detail: "Use the calendar for weekly shoot load and date pressure.", href: "#studios/calendar", tone: "info" },
  { label: "Senior Coverage", value: "Owners", detail: "Senior photographer view keeps owner clarity and support visible.", href: "#studios/workload", tone: "info" },
  { label: "Prep Packets", value: "Ready", detail: "Readiness, references, and pre-service context stay together.", href: "#studios/pre-service", tone: "warning" }
];

const PHOTOGRAPHY_QUEUES: DepartmentHubCard[] = [
  { label: "Today's Shoots", detail: "Open the field-ready day view.", href: "#studios/shoots", tone: "info" },
  { label: "Job Prep", detail: "Open prep packets and readiness checks.", href: "#studios/pre-service", tone: "warning" },
  { label: "Travel", detail: "Open location, route, and load-in context.", href: "#studios/travel", tone: "info" },
  { label: "Senior Photographer View", detail: "Open workload, handoffs, and field support.", href: "#studios/workload", tone: "info" },
  { label: "Post-Shoot Reviews", detail: "Open closeout and evaluation work.", href: "#job-closeout", tone: "info" }
];

export function StudiosWorkspace({ token, currentUser, focus = "overview" }: Props) {
  const copy = FOCUS_COPY[focus];
  const isOverview = focus === "overview";
  const isTodayFocus = focus === "today";
  const isTravelFocus = focus === "travel";
  const isPrepFocus = focus === "pre_service" || focus === "readiness";

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
                Day at a Glance
              </button>
              {!isTravelFocus && !isPrepFocus && !isTodayFocus ? (
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
          <DepartmentHubPattern
            department="Photography"
            openFirst={PHOTOGRAPHY_OPEN_FIRST}
            attention={PHOTOGRAPHY_ATTENTION}
            weekly={PHOTOGRAPHY_WEEKLY}
            queues={PHOTOGRAPHY_QUEUES}
            notes={<span>Field work stays here; staffing and attendance review stay with Leadership and Schedule.</span>}
          />

          <PhotographyTodayShootsPanel token={token} />

          <section className="studios-workspace__launch-grid" aria-label="Photography launch points">
            {PRIMARY_LINKS.filter((link) => HOMEPAGE_LINK_IDS.has(link.id)).map((link) => (
              <button
                key={link.id}
                type="button"
                className="panel studios-workspace__launch-card"
                aria-label={link.label}
                onClick={() => (window.location.hash = link.hash)}
              >
                <div className="eyebrow">Photography</div>
                <strong>{link.label}</strong>
                <p>{link.detail}</p>
              </button>
            ))}
          </section>
        </>
      ) : !isTravelFocus && !isPrepFocus && !isTodayFocus ? (
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

      {isOverview || isTravelFocus || isPrepFocus || isTodayFocus ? null : (
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
              Day at a Glance
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
              Job Prep / Pre-Service
            </button>
          </div>
        </section>
      )}

      {isTodayFocus ? <PhotographyTodayShootsPanel token={token} /> : null}

      {isPrepFocus ? <PhotographyJobPrepPanel token={token} compatibilityNotice={focus === "readiness"} /> : null}

      {isTravelFocus ? <PhotographyTravelPanel token={token} /> : null}

      {isOverview || focus === "workload" ? (
        <ProjectTrackingDepartmentQueue
          token={token}
          department="photography"
          title="Photography Active Work"
          summary="Live Project Tracking work for shoot readiness, staffing, post-shoot evaluations, setup-photo issues, and senior photographer follow-ups."
          limit={6}
          variant="compact"
          maxItems={6}
          emptyStateLabel="No active Photography workflow steps"
        />
      ) : null}

      {isTodayFocus || isOverview || isTravelFocus || isPrepFocus ? null : (
        <CompactActiveWorkPanel
          token={token}
          currentUser={currentUser}
          title={copy.title}
          summary="Field leadership view for shoot readiness, handoffs, photographer support, owner clarity, and the next safe action."
          routeHash="#studios/shoots"
          focus={focus}
          showDepartmentFilter={focus === "workload"}
        />
      )}
    </div>
  );
}

function PhotographyJobPrepPanel({ token, compatibilityNotice }: { token: string; compatibilityNotice: boolean }) {
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
        const prepJobs = response.jobs
          .filter((job) => job.primary_day_date && !["archived", "cancelled"].includes(job.job_status))
          .sort(compareJobsByPrimaryDate);
        setJobs(prepJobs);
        setSelectedJobId((current) => current ?? prepJobs[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Job prep details could not be loaded.");
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
  const prepContext = useMemo(() => buildJobPrepContext(selectedJob, detail), [detail, selectedJob]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading Job Prep" summary="Pulling upcoming shoots, briefing notes, readiness items, and reference context." />;
  }

  if (error) {
    return <WorkspaceEmptyState title="Job Prep is unavailable" summary={error} />;
  }

  if (!selectedJob || !prepContext) {
    return (
      <WorkspaceEmptyState
        title="No upcoming jobs are ready for Job Prep"
        summary="When a Photography job has schedule context, the prep packet will show the field details, readiness items, and briefing notes here."
        actions={
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/calendar")}>
            Open 30-Day Calendar
          </button>
        }
      />
    );
  }

  return (
    <section className="panel studios-workspace__job-prep-panel" aria-label="Job Prep / Pre-Service packet">
      {compatibilityNotice ? (
        <div className="studios-workspace__job-prep-notice">
          Readiness is part of Job Prep / Pre-Service. Use this packet for readiness, notes, resources, and crew context.
        </div>
      ) : null}

      <div className="studios-workspace__job-prep-header">
        <div>
          <div className="eyebrow">Job Prep Packet</div>
          <h3>{prepContext.jobName}</h3>
          <p>{prepContext.organizationName}</p>
        </div>
        {jobs.length > 1 ? (
          <label className="filter-field">
            <span>Choose job</span>
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

      <div className="studios-workspace__prep-summary-grid">
        <PrepInfoGroup title="Schedule" items={prepContext.scheduleItems} />
        <PrepInfoGroup title="Location" items={prepContext.locationItems} />
        <PrepInfoGroup title="Contact" items={prepContext.contactItems} />
        <PrepInfoGroup title="Crew" items={prepContext.crewItems} />
      </div>

      <div className="studios-workspace__prep-detail-grid">
        <PrepInfoGroup title="Briefing Notes" items={prepContext.briefingItems} wide />
        <PrepReadinessGroup items={prepContext.readinessItems} />
        <PrepInfoGroup title="Prior Evaluation" items={prepContext.priorEvaluationItems} placeholder="No prior post-shoot evaluation is in this seeded packet yet." />
        <PrepInfoGroup title="Customer Survey Notes" items={[]} placeholder="No customer survey notes are in this seeded packet yet." />
        <PrepAttachmentGroup title="Shoot References" attachments={prepContext.documentAttachments} placeholder="No shoot references are attached to this prep packet yet." />
        <PrepAttachmentGroup title="Setup References" attachments={prepContext.photoAttachments} placeholder="No setup references are attached to this prep packet yet." />
      </div>

      <WorkspaceActionBar align="end" compact>
        <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/travel")}>
          Travel Details
        </button>
        <button type="button" className="secondary-button" onClick={() => (window.location.hash = buildSharedJobHash("#jobs", selectedJob.id))}>
          Open work
        </button>
        <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#project-tracking")}>
          Open Project Tracking
        </button>
        {hasJobPrepAttention(prepContext) ? (
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
            Review Job Prep
          </button>
        ) : null}
      </WorkspaceActionBar>

      {detailLoading ? <p className="muted">Refreshing prep packet...</p> : null}
    </section>
  );
}

function PrepInfoGroup({ title, items, placeholder = "Not available yet.", wide = false }: { title: string; items: string[]; placeholder?: string; wide?: boolean }) {
  return (
    <article className={`studios-workspace__prep-info-card${wide ? " studios-workspace__prep-info-card--wide" : ""}`}>
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{placeholder}</p>
      )}
    </article>
  );
}

function PrepReadinessGroup({ items }: { items: SharedJobReadinessItem[] }) {
  return (
    <article className="studios-workspace__prep-info-card">
      <h4>Readiness Inside Job Prep</h4>
      {items.length ? (
        <ul>
          {items.slice(0, 6).map((item) => (
            <li key={item.id}>
              {item.label}
              {item.is_complete ? " - complete" : item.is_blocker ? " - blocker" : item.is_required ? " - required" : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>No readiness checklist items are open yet.</p>
      )}
    </article>
  );
}

function PrepAttachmentGroup({
  title,
  attachments,
  placeholder
}: {
  title: string;
  attachments: SharedJobPrepLocationAttachmentPreview[];
  placeholder: string;
}) {
  return (
    <article className="studios-workspace__prep-info-card">
      <h4>{title}</h4>
      {attachments.length ? (
        <ul>
          {attachments.map((attachment) => (
            <li key={attachment.id}>{attachment.title}</li>
          ))}
        </ul>
      ) : (
        <p>{placeholder}</p>
      )}
    </article>
  );
}

function buildJobPrepContext(job: SharedJobListItem | null, detail: SharedJobDetailResponse | null) {
  if (!job) {
    return null;
  }

  const primaryDay = findPrimaryJobDay(job, detail?.days ?? []);
  const employeeLocation = detail?.prep_readiness.employee_briefing.primary_location ?? null;
  const primaryContact = findPrimaryContact(job, detail);
  const locationName = firstString(
    detail?.summary.primary_location_name,
    primaryDay?.location_name,
    employeeLocation?.location_name,
    job.primary_location_name
  );
  const address = firstString(employeeLocation?.address_display, detail?.summary.primary_location_address, job.primary_location_address);
  const briefingLines = detail?.prep_readiness.message_previews.employee_briefing?.body_lines ?? [];
  const attachments = collectPrepAttachments(detail);
  const documentAttachments = attachments.filter(isDocumentAttachment);
  const photoAttachments = attachments.filter(isPhotoAttachment);
  const priorEvaluationItems = (detail?.production_items ?? [])
    .map((item) => firstString(item.post_shoot_eval_summary, item.internal_notes))
    .filter((value): value is string => Boolean(value));

  const briefingItems = [
    ...briefingLines,
    firstString(primaryDay?.setup_notes, employeeLocation?.setup_area),
    firstString(primaryDay?.access_notes, employeeLocation?.entrance_instructions),
    firstString(employeeLocation?.employee_facing_notes, employeeLocation?.navigation_notes),
    firstString(job.school_profile?.special_instructions, job.sports_profile?.client_expectations_notes, job.description_internal)
  ].filter((value): value is string => Boolean(value));

  return {
    organizationName: detail?.summary.organization_name ?? job.organization_name ?? "Client pending",
    jobName: detail?.job.title ?? job.title,
    scheduleItems: [
      formatDateLine(primaryDay?.date ?? job.primary_day_date),
      formatTimeLine(primaryDay?.start_time ?? job.primary_day_start_time, primaryDay?.end_time ?? job.primary_day_end_time),
      job.estimated_subject_count ? `Estimated volume: ${job.estimated_subject_count}` : null
    ].filter((value): value is string => Boolean(value)),
    locationItems: [locationName ?? "Location pending", address, firstString(primaryDay?.parking_notes, employeeLocation?.parking_instructions)].filter(
      (value): value is string => Boolean(value)
    ),
    contactItems: [
      primaryContact?.name ? `Primary: ${primaryContact.name}` : null,
      primaryContact?.phone ? `Phone: ${primaryContact.phone}` : null,
      primaryContact?.email ? `Email: ${primaryContact.email}` : null
    ].filter((value): value is string => Boolean(value)),
    crewItems: buildCrewItems(job, detail?.staff_assignments ?? []),
    briefingItems,
    readinessItems: (detail?.readiness_items ?? []).sort(compareReadinessItems),
    priorEvaluationItems,
    documentAttachments,
    photoAttachments
  };
}

function hasJobPrepAttention(prepContext: NonNullable<ReturnType<typeof buildJobPrepContext>>) {
  return prepContext.readinessItems.some((item) => item.is_blocker || (item.is_required && !item.is_complete));
}

function collectPrepAttachments(detail: SharedJobDetailResponse | null) {
  const candidates = [
    ...(detail?.prep_readiness.client_prep.primary_location?.reference_attachments ?? []),
    ...(detail?.prep_readiness.employee_briefing.primary_location?.reference_attachments ?? []),
    ...(detail?.prep_readiness.message_previews.client_prep_email?.reference_attachments ?? []),
    ...(detail?.prep_readiness.message_previews.employee_briefing?.reference_attachments ?? [])
  ];
  const byKey = new Map<string, SharedJobPrepLocationAttachmentPreview>();
  candidates.forEach((attachment) => {
    byKey.set(attachment.id || attachment.title, attachment);
  });
  return Array.from(byKey.values());
}

function isDocumentAttachment(attachment: SharedJobPrepLocationAttachmentPreview) {
  const haystack = `${attachment.title} ${attachment.attachment_type} ${attachment.file_url ?? ""} ${attachment.storage_key ?? ""}`.toLowerCase();
  return haystack.includes("pdf") || haystack.includes("document") || haystack.includes("packet") || haystack.includes("qr");
}

function isPhotoAttachment(attachment: SharedJobPrepLocationAttachmentPreview) {
  const haystack = `${attachment.title} ${attachment.attachment_type} ${attachment.file_url ?? ""} ${attachment.storage_key ?? ""}`.toLowerCase();
  return haystack.includes("photo") || haystack.includes("image") || haystack.includes("reference") || haystack.includes(".jpg") || haystack.includes(".png");
}

function compareReadinessItems(left: SharedJobReadinessItem, right: SharedJobReadinessItem) {
  return (
    Number(right.is_blocker) - Number(left.is_blocker) ||
    Number(right.is_required) - Number(left.is_required) ||
    Number(left.is_complete) - Number(right.is_complete) ||
    left.sort_order - right.sort_order ||
    left.label.localeCompare(right.label)
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
          .sort(compareJobsByPrimaryDate);
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
        title="No upcoming Travel & Logistics details are ready"
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
        <div className="studios-workspace__travel-header-actions">
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
          <WorkspaceActionBar align="end" compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
              Job Prep
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = buildSharedJobHash("#jobs", selectedJob.id))}>
              Open work
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#project-tracking")}>
              Open Project Tracking
            </button>
          </WorkspaceActionBar>
        </div>
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
        <TravelInfoGroup title="Parking / Load-In" items={travelContext.logisticsItems} />
        <TravelInfoGroup title="Contact" items={travelContext.contactItems} />
        <TravelInfoGroup title="Crew" items={travelContext.crewItems} />
        <TravelInfoGroup title="Field Notes" items={travelContext.noteItems} />
        <article className="studios-workspace__travel-info-card studios-workspace__travel-info-card--placeholder">
          <h4>Leadership Staffing Context</h4>
          <p>Leadership handles staffing and attendance review so this page stays focused on field travel.</p>
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

  const primaryDay = findPrimaryJobDay(job, detail?.days ?? []);
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

function findPrimaryJobDay(job: SharedJobListItem, days: SharedJobDay[]) {
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
    job.staffing_status !== "ready_confirmed" ? `Crew confirmation: ${humanizeTravelValue(job.staffing_status)}` : null
  ];
  return items.filter((value): value is string => Boolean(value));
}

function compareJobsByPrimaryDate(left: SharedJobListItem, right: SharedJobListItem) {
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
  const today = useMemo(() => getLocalDateKey(), []);
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
          setJobs(response.jobs.filter((job) => !["archived", "cancelled"].includes(job.job_status)).sort(compareJobsForDayAtGlance));
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
        title="Loading Day at a Glance"
        summary="Pulling same-day jobs, timing, location, lead ownership, and readiness flags."
      />
    );
  }

  if (error) {
    return <WorkspaceEmptyState title="Day at a Glance is unavailable" summary={error} />;
  }

  const summary = buildDayAtGlanceSummary(jobs);
  const commandCards = buildPhotographyCommandCards(jobs);

  return (
    <section className="panel studios-workspace__day-panel" aria-label="Photography Day at a Glance">
      <div className="studios-workspace__day-header">
        <div>
          <div className="eyebrow">Today</div>
          <h3>Today's Photography Shoots</h3>
          <p>{formatDayAtGlanceDate(today)}</p>
        </div>
        <div className="studios-workspace__day-summary" aria-label="Day at a Glance summary">
          <span>
            <strong>{jobs.length}</strong>
            shoot{jobs.length === 1 ? "" : "s"} today
          </span>
          <span className={summary.redFlags ? "is-warning" : ""}>
            <strong>{summary.redFlags}</strong>
            red flag{summary.redFlags === 1 ? "" : "s"}
          </span>
          <span>
            <strong>{summary.watchFlags}</strong>
            watch flag{summary.watchFlags === 1 ? "" : "s"}
          </span>
          <span>
            <strong>{summary.assignedCrew}</strong>
            assigned crew
          </span>
        </div>
      </div>
      <div className="studios-workspace__command-summary" aria-label="Photography operating summary cards">
        {commandCards.map((card) => (
          <button key={card.label} type="button" className={`studios-workspace__command-card studios-workspace__command-card--${card.tone}`} onClick={() => (window.location.hash = card.hash)}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </button>
        ))}
      </div>
      {jobs.length ? (
        <div className="studios-workspace__day-list">
          {jobs.map((job) => (
            <article key={job.id} className="studios-workspace__day-card">
              <div className="studios-workspace__day-time">
                <strong>{formatShootTime(job)}</strong>
                <span>{job.primary_day_label ?? "Shoot"}</span>
              </div>
              <div className="studios-workspace__day-main">
                <div>
                  <h4>{job.title}</h4>
                  <p>{job.organization_name ?? "Client pending"}</p>
                </div>
                <dl className="studios-workspace__day-details">
                  <div>
                    <dt>Location</dt>
                    <dd>{job.primary_location_name ?? job.primary_location_address ?? "Location pending"}</dd>
                  </div>
                  <div>
                    <dt>Lead</dt>
                    <dd>{job.lead_owner_name ?? "Lead photographer pending"}</dd>
                  </div>
                  <div>
                    <dt>Crew</dt>
                    <dd>{describeTodayCrew(job)}</dd>
                  </div>
                  <div>
                    <dt>Readiness</dt>
                    <dd>{describeTodayReadiness(job)}</dd>
                  </div>
                </dl>
              </div>
              <div className="studios-workspace__day-status">
                <span className={`status-pill ${getTodayRiskClass(job)}`}>{describeTodayAttention(job)}</span>
                <div className="studios-workspace__focus-actions">
                  <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/travel")}>
                    Travel details
                  </button>
                  <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
                    Job Prep
                  </button>
                  <button type="button" className="secondary-button" onClick={() => (window.location.hash = buildSharedJobHash("#jobs", job.id))}>
                    Open work
                  </button>
                  <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#project-tracking")}>
                    Open Project Tracking
                  </button>
                  {needsPhotographyAttention(job) ? (
                    <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#studios/pre-service")}>
                      Review Job Prep
                    </button>
                  ) : null}
                </div>
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

function buildPhotographyCommandCards(jobs: SharedJobListItem[]) {
  return [
    {
      label: "Today's Shoots",
      value: jobs.length,
      detail: "Shoots and field work scheduled for today.",
      hash: "#studios/shoots",
      tone: "info"
    },
    {
      label: "Ready to Go",
      value: jobs.filter(isPhotographyReadyToGo).length,
      detail: "No blockers, watch flags, or prep gaps are visible.",
      hash: "#studios/shoots",
      tone: "success"
    },
    {
      label: "Needs Prep",
      value: jobs.filter(needsPhotographyPrep).length,
      detail: "Readiness, crew confirmation, or job prep needs review.",
      hash: "#studios/pre-service",
      tone: "warning"
    },
    {
      label: "Travel Notes",
      value: jobs.filter(hasPhotographyTravelDetails).length,
      detail: "Rows with location, address, or field travel context.",
      hash: "#studios/travel",
      tone: "info"
    },
    {
      label: "Post-Shoot Evals",
      value: jobs.filter((job) => job.job_status === "execution_complete").length,
      detail: "Completed jobs in this view that may need closeout.",
      hash: "#job-closeout",
      tone: "neutral"
    },
    {
      label: "Recently Changed",
      value: jobs.filter((job) => Boolean(job.updated_at)).length,
      detail: "Rows with current update timestamps.",
      hash: "#project-tracking",
      tone: "neutral"
    }
  ];
}

function getLocalDateKey(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function buildDayAtGlanceSummary(jobs: SharedJobListItem[]) {
  return jobs.reduce(
    (summary, job) => ({
      redFlags: summary.redFlags + job.blocker_count,
      watchFlags: summary.watchFlags + job.open_watch_flag_count,
      assignedCrew: summary.assignedCrew + job.assigned_staff_count
    }),
    { redFlags: 0, watchFlags: 0, assignedCrew: 0 }
  );
}

function compareJobsForDayAtGlance(left: SharedJobListItem, right: SharedJobListItem) {
  return String(left.primary_day_start_time ?? "").localeCompare(String(right.primary_day_start_time ?? "")) || left.title.localeCompare(right.title);
}

function formatDayAtGlanceDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
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

function describeTodayCrew(job: SharedJobListItem) {
  const activeCount = job.ready_present_count || job.checked_in_staff_count;
  return activeCount ? `${job.assigned_staff_count} assigned / ${activeCount} active` : `${job.assigned_staff_count} assigned`;
}

function describeTodayAttention(job: SharedJobListItem) {
  if (job.blocker_count > 0) {
    return `${job.blocker_count} blocker${job.blocker_count === 1 ? "" : "s"}`;
  }
  if (job.open_watch_flag_count > 0) {
    return `${job.open_watch_flag_count} watch flag${job.open_watch_flag_count === 1 ? "" : "s"}`;
  }
  if (job.readiness_percent < 100) {
    return `${job.readiness_percent}% ready`;
  }
  if (job.staffing_status !== "ready_confirmed") {
    return `Crew confirmation: ${humanizeTravelValue(job.staffing_status)}`;
  }
  return "No immediate flags";
}

function isPhotographyReadyToGo(job: SharedJobListItem) {
  return job.blocker_count === 0 && job.open_watch_flag_count === 0 && job.readiness_percent >= 100 && job.staffing_status === "ready_confirmed";
}

function needsPhotographyPrep(job: SharedJobListItem) {
  return job.readiness_percent < 100 || job.staffing_status !== "ready_confirmed" || job.readiness_status === "at_risk" || job.readiness_status === "off_track";
}

function needsPhotographyAttention(job: SharedJobListItem) {
  return job.blocker_count > 0 || job.open_watch_flag_count > 0 || job.risk_status === "critical" || job.risk_status === "high" || needsPhotographyPrep(job);
}

function hasPhotographyTravelDetails(job: SharedJobListItem) {
  return Boolean(job.primary_location_name || job.primary_location_address || job.location_override_note || job.description_internal);
}

function getTodayRiskClass(job: SharedJobListItem) {
  if (job.blocker_count > 0 || job.risk_status === "critical" || job.risk_status === "high") {
    return "status-pill--danger";
  }
  if (job.open_watch_flag_count > 0 || job.readiness_percent < 100 || job.staffing_status !== "ready_confirmed") {
    return "status-pill--warning";
  }
  return "status-pill--success";
}

/**
 * @deprecated Use StudiosWorkspace. Kept temporarily so existing imports and tests
 * can keep resolving while the last Photography-era imports are removed.
 */
export const PhotographyWorkspace = StudiosWorkspace;
