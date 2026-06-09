import { useState } from "react";
import type { HomeUrgentWatchItem, HomeWidgetTone, SessionUser } from "./types";

export type WorkflowChangeNoticeLevel = "fyi" | "important" | "urgent";
export type WorkflowChangeNoticeChangeKind =
  | "blocker"
  | "calendar_readiness"
  | "contact"
  | "gallery_deadline"
  | "job_launched"
  | "location"
  | "priority"
  | "roster"
  | "schedule"
  | "staffing"
  | "call_time"
  | "parking"
  | "shoot_manager"
  | "status"
  | "job_note"
  | "project_risk";
export type WorkflowChangeNoticeSurface = "home" | "my-work" | "photography" | "jobs" | "schedule" | "schools" | "sports" | "production";

export type WorkflowChangeNotice = {
  id: string;
  level: WorkflowChangeNoticeLevel;
  changeKind: WorkflowChangeNoticeChangeKind;
  changeLabel: string;
  title: string;
  summary: string;
  jobTitle: string;
  jobNumber?: string;
  targetJobId?: string;
  department: "schools" | "sports" | "photography" | "production" | "projects" | "leadership";
  updatedBy: string;
  updatedAt: string;
  audienceLabel: string;
  audienceUserIds: string[];
  audienceDepartments: string[];
  affectedTeams: string[];
  actionNeeded: string;
  actionLabel: string;
  actionHash: string;
  requiresAcknowledgement: boolean;
  previousValue?: string;
  currentValue?: string;
  surfaces: WorkflowChangeNoticeSurface[];
};

const NOTICE_ACK_STORAGE_PREFIX = "mission-control.workflow-change-notice-ack.";

export const DEMO_WORKFLOW_CHANGE_NOTICES: WorkflowChangeNotice[] = [
  {
    id: "maple-grove-location-change",
    level: "urgent",
    changeKind: "location",
    changeLabel: "Location changed",
    title: "Location changed: Maple Grove Baseball Media Day",
    summary: "The shoot moved from the high school field to the Maple Grove Dome.",
    jobTitle: "Maple Grove Baseball Media Day",
    jobNumber: "SP-2042",
    targetJobId: "job-sports-1",
    department: "photography",
    updatedBy: "Carisa Lead",
    updatedAt: "2026-06-18T14:15:00.000Z",
    audienceLabel: "Assigned photographers and the shoot lead",
    audienceUserIds: ["user-photo"],
    audienceDepartments: ["photography"],
    affectedTeams: ["Photography", "Sports"],
    actionNeeded: "Review travel and parking notes before leaving for the shoot.",
    actionLabel: "Open Photography prep",
    actionHash: "#studios/travel?job=job-sports-1",
    requiresAcknowledgement: true,
    previousValue: "Maple Grove Senior High field",
    currentValue: "Maple Grove Dome",
    surfaces: ["home", "my-work", "photography", "jobs", "schedule"]
  },
  {
    id: "maple-grove-date-change",
    level: "important",
    changeKind: "schedule",
    changeLabel: "Shoot date changed",
    title: "Shoot date changed: Maple Grove Baseball Media Day",
    summary: "The sports media day moved one day later after the league updated field access.",
    jobTitle: "Maple Grove Baseball Media Day",
    jobNumber: "SP-2042",
    targetJobId: "job-sports-1",
    department: "sports",
    updatedBy: "Josh Sports",
    updatedAt: "2026-06-18T13:20:00.000Z",
    audienceLabel: "Sports lead, assigned photographers, and Production",
    audienceUserIds: ["user-photo"],
    audienceDepartments: ["sports", "photography", "production"],
    affectedTeams: ["Sports", "Photography", "Production"],
    actionNeeded: "Confirm the updated date still works for staffing and production timing.",
    actionLabel: "Open job detail",
    actionHash: "#sports/shoots/job-sports-1",
    requiresAcknowledgement: false,
    previousValue: "June 21, 2026",
    currentValue: "June 22, 2026",
    surfaces: ["my-work", "jobs", "sports", "photography", "production", "schedule"]
  },
  {
    id: "lakeview-call-time-update",
    level: "important",
    changeKind: "call_time",
    changeLabel: "Call time changed",
    title: "Call time changed: Lakeview Elementary Picture Day",
    summary: "Crew arrival moved earlier so setup can finish before first bell.",
    jobTitle: "Lakeview Elementary Picture Day",
    jobNumber: "SCH-1187",
    targetJobId: "job-school-ops",
    department: "schools",
    updatedBy: "Jessica Schools",
    updatedAt: "2026-06-17T20:30:00.000Z",
    audienceLabel: "Assigned photographers and school operations",
    audienceUserIds: ["user-photo"],
    audienceDepartments: ["schools"],
    affectedTeams: ["Schools", "Photography"],
    actionNeeded: "Check the updated arrival time before confirming your morning plan.",
    actionLabel: "Open My Schedule",
    actionHash: "#my-work",
    requiresAcknowledgement: false,
    previousValue: "7:45 AM call time",
    currentValue: "7:15 AM call time",
    surfaces: ["my-work", "jobs", "schedule"]
  },
  {
    id: "lakeview-roster-missing",
    level: "urgent",
    changeKind: "roster",
    changeLabel: "Roster still missing",
    title: "Roster still missing: Lakeview Elementary Picture Day",
    summary: "The school roster is still not attached, so the job cannot move cleanly into production prep.",
    jobTitle: "Lakeview Elementary Picture Day",
    jobNumber: "SCH-1187",
    targetJobId: "job-school-ops",
    department: "schools",
    updatedBy: "Jessica Schools",
    updatedAt: "2026-06-18T09:10:00.000Z",
    audienceLabel: "Schools and Client Success",
    audienceUserIds: [],
    audienceDepartments: ["schools", "client success"],
    affectedTeams: ["Schools", "Client Success", "Production"],
    actionNeeded: "Follow up with the school contact and attach the roster before the next handoff.",
    actionLabel: "Open school job",
    actionHash: "#schools/jobs/job-school-ops",
    requiresAcknowledgement: true,
    currentValue: "Roster not received",
    surfaces: ["home", "my-work", "jobs", "schools"]
  },
  {
    id: "lakeview-roster-received",
    level: "fyi",
    changeKind: "roster",
    changeLabel: "Roster received",
    title: "Roster received: Lakeview Elementary Picture Day",
    summary: "The roster file was added and is ready for review.",
    jobTitle: "Lakeview Elementary Picture Day",
    jobNumber: "SCH-1187",
    targetJobId: "job-school-ops",
    department: "schools",
    updatedBy: "Paige Client Success",
    updatedAt: "2026-06-18T15:35:00.000Z",
    audienceLabel: "Schools and Production",
    audienceUserIds: [],
    audienceDepartments: ["schools", "production"],
    affectedTeams: ["Schools", "Production"],
    actionNeeded: "Verify roster quality before production relies on it.",
    actionLabel: "Open school job",
    actionHash: "#schools/jobs/job-school-ops",
    requiresAcknowledgement: false,
    previousValue: "Roster not received",
    currentValue: "Roster attached for review",
    surfaces: ["jobs", "schools", "production"]
  },
  {
    id: "maple-grove-blocker-added",
    level: "urgent",
    changeKind: "blocker",
    changeLabel: "Blocker added",
    title: "Blocker added: assistant coverage missing",
    summary: "Assistant coverage is still missing for the sports shoot.",
    jobTitle: "Maple Grove Baseball Media Day",
    jobNumber: "SP-2042",
    targetJobId: "job-sports-1",
    department: "photography",
    updatedBy: "Carisa Lead",
    updatedAt: "2026-06-18T14:40:00.000Z",
    audienceLabel: "Photography lead and Sports",
    audienceUserIds: ["user-photo"],
    audienceDepartments: ["photography", "sports"],
    affectedTeams: ["Photography", "Sports"],
    actionNeeded: "Assign backup coverage or confirm the shoot can run without an assistant.",
    actionLabel: "Open job detail",
    actionHash: "#sports/shoots/job-sports-1",
    requiresAcknowledgement: true,
    currentValue: "Assistant coverage missing",
    surfaces: ["home", "my-work", "photography", "jobs", "sports"]
  },
  {
    id: "maple-grove-blocker-resolved",
    level: "important",
    changeKind: "blocker",
    changeLabel: "Blocker resolved",
    title: "Blocker resolved: parking plan confirmed",
    summary: "The venue confirmed the revised parking plan for the crew.",
    jobTitle: "Maple Grove Baseball Media Day",
    jobNumber: "SP-2042",
    targetJobId: "job-sports-1",
    department: "photography",
    updatedBy: "Carisa Lead",
    updatedAt: "2026-06-18T16:10:00.000Z",
    audienceLabel: "Assigned photographers",
    audienceUserIds: ["user-photo"],
    audienceDepartments: ["photography"],
    affectedTeams: ["Photography"],
    actionNeeded: "Use the updated parking note during travel prep.",
    actionLabel: "Open Photography prep",
    actionHash: "#studios/travel?job=job-sports-1",
    requiresAcknowledgement: false,
    previousValue: "Parking unresolved",
    currentValue: "Parking confirmed",
    surfaces: ["my-work", "photography", "jobs"]
  },
  {
    id: "maple-grove-shoot-manager-needed",
    level: "important",
    changeKind: "shoot_manager",
    changeLabel: "Shoot manager still needed",
    title: "Shoot manager still needed: Maple Grove Baseball Media Day",
    summary: "The job has a date and location, but the day-of manager is not confirmed.",
    jobTitle: "Maple Grove Baseball Media Day",
    jobNumber: "SP-2042",
    targetJobId: "job-sports-1",
    department: "photography",
    updatedBy: "Mission Control",
    updatedAt: "2026-06-18T12:00:00.000Z",
    audienceLabel: "Photography lead",
    audienceUserIds: [],
    audienceDepartments: ["photography"],
    affectedTeams: ["Photography"],
    actionNeeded: "Assign the shoot manager before calling this shoot ready.",
    actionLabel: "Open job detail",
    actionHash: "#sports/shoots/job-sports-1",
    requiresAcknowledgement: false,
    currentValue: "Manager not assigned",
    surfaces: ["photography", "jobs"]
  },
  {
    id: "maple-grove-shoot-manager-assigned",
    level: "fyi",
    changeKind: "shoot_manager",
    changeLabel: "Shoot manager assigned",
    title: "Shoot manager assigned: Maple Grove Baseball Media Day",
    summary: "Carisa is now listed as the day-of shoot manager.",
    jobTitle: "Maple Grove Baseball Media Day",
    jobNumber: "SP-2042",
    targetJobId: "job-sports-1",
    department: "photography",
    updatedBy: "Josh Sports",
    updatedAt: "2026-06-18T16:45:00.000Z",
    audienceLabel: "Sports and Photography",
    audienceUserIds: ["user-photo"],
    audienceDepartments: ["sports", "photography"],
    affectedTeams: ["Sports", "Photography"],
    actionNeeded: "Use Carisa as the day-of escalation point.",
    actionLabel: "Open job detail",
    actionHash: "#sports/shoots/job-sports-1",
    requiresAcknowledgement: false,
    previousValue: "Manager not assigned",
    currentValue: "Carisa Lead",
    surfaces: ["jobs", "sports", "photography"]
  },
  {
    id: "gallery-deadline-changed",
    level: "important",
    changeKind: "gallery_deadline",
    changeLabel: "Gallery deadline changed",
    title: "Gallery deadline changed: Senior Retouching Handoff",
    summary: "The client delivery deadline moved earlier for the senior gallery.",
    jobTitle: "Senior Retouching Handoff",
    department: "production",
    updatedBy: "Spencer Production",
    updatedAt: "2026-06-18T11:05:00.000Z",
    audienceLabel: "Production and Client Success",
    audienceUserIds: [],
    audienceDepartments: ["production", "client success"],
    affectedTeams: ["Production", "Client Success"],
    actionNeeded: "Recheck production capacity before the gallery release promise is confirmed.",
    actionLabel: "Open Production",
    actionHash: "#production",
    requiresAcknowledgement: false,
    previousValue: "June 28, 2026",
    currentValue: "June 25, 2026",
    surfaces: ["jobs", "production"]
  },
  {
    id: "priority-changed-urgent",
    level: "urgent",
    changeKind: "priority",
    changeLabel: "Priority changed",
    title: "Priority changed: district office event",
    summary: "Leadership marked the district office event urgent after client escalation.",
    jobTitle: "District Office Event",
    department: "leadership",
    updatedBy: "Brandon Leadership",
    updatedAt: "2026-06-18T10:20:00.000Z",
    audienceLabel: "Leadership and Client Success",
    audienceUserIds: [],
    audienceDepartments: ["leadership", "client success"],
    affectedTeams: ["Leadership", "Client Success"],
    actionNeeded: "Confirm owner, next action, and client response today.",
    actionLabel: "Open Jobs",
    actionHash: "#jobs",
    requiresAcknowledgement: true,
    previousValue: "Normal",
    currentValue: "Urgent",
    surfaces: ["home", "jobs"]
  },
  {
    id: "contact-changed-client-success",
    level: "important",
    changeKind: "contact",
    changeLabel: "Contact changed",
    title: "Primary contact changed: district office event",
    summary: "The client moved day-of questions to a new district contact.",
    jobTitle: "District Office Event",
    department: "leadership",
    updatedBy: "Paige Client Success",
    updatedAt: "2026-06-18T10:55:00.000Z",
    audienceLabel: "Client Success and the assigned job owner",
    audienceUserIds: [],
    audienceDepartments: ["client success"],
    affectedTeams: ["Client Success", "Leadership"],
    actionNeeded: "Use the new contact before sending confirmations.",
    actionLabel: "Open Jobs",
    actionHash: "#jobs",
    requiresAcknowledgement: false,
    previousValue: "District front office",
    currentValue: "Angela Morris",
    surfaces: ["jobs"]
  },
  {
    id: "job-launched-schools",
    level: "fyi",
    changeKind: "job_launched",
    changeLabel: "Job launched",
    title: "Job launched: Lakeview Elementary Picture Day",
    summary: "The intake package launched into the Schools route.",
    jobTitle: "Lakeview Elementary Picture Day",
    jobNumber: "SCH-1187",
    targetJobId: "job-school-ops",
    department: "schools",
    updatedBy: "Jessica Schools",
    updatedAt: "2026-06-18T08:15:00.000Z",
    audienceLabel: "Schools, Photography, and Production",
    audienceUserIds: [],
    audienceDepartments: ["schools", "photography", "production"],
    affectedTeams: ["Schools", "Photography", "Production"],
    actionNeeded: "Review the first department package and clear missing info.",
    actionLabel: "Open school job",
    actionHash: "#schools/jobs/job-school-ops",
    requiresAcknowledgement: false,
    currentValue: "Workflow route launched",
    surfaces: ["jobs", "schools", "photography", "production"]
  },
  {
    id: "production-handoff-note",
    level: "fyi",
    changeKind: "job_note",
    changeLabel: "Production note added",
    title: "Production note added: senior retouching handoff",
    summary: "A reference note was added for production QA before gallery release.",
    jobTitle: "Senior Retouching Handoff",
    department: "production",
    updatedBy: "Production Lead",
    updatedAt: "2026-06-16T18:05:00.000Z",
    audienceLabel: "Production queue owners",
    audienceUserIds: [],
    audienceDepartments: ["production"],
    affectedTeams: ["Production"],
    actionNeeded: "Keep the note with the production queue; no field action is needed.",
    actionLabel: "Open Production",
    actionHash: "#production",
    requiresAcknowledgement: false,
    surfaces: ["jobs"]
  }
];

type NoticeFilterOptions = {
  includeAcknowledged?: boolean;
  includeAllAudience?: boolean;
};

export function getWorkflowChangeNoticesForUser(currentUser: SessionUser, options: NoticeFilterOptions = {}) {
  return filterAcknowledged(
    DEMO_WORKFLOW_CHANGE_NOTICES.filter((notice) => noticeMatchesUser(notice, currentUser)),
    options
  );
}

export function getWorkflowChangeNoticesForSurface(input: {
  surface: WorkflowChangeNoticeSurface;
  currentUser?: SessionUser;
  includeAcknowledged?: boolean;
  includeAllAudience?: boolean;
}) {
  return filterAcknowledged(
    DEMO_WORKFLOW_CHANGE_NOTICES.filter((notice) => {
      if (!notice.surfaces.includes(input.surface)) {
        return false;
      }
      if (input.includeAllAudience || !input.currentUser) {
        return true;
      }
      return noticeMatchesUser(notice, input.currentUser);
    }),
    input
  );
}

export function getWorkflowChangeNoticesForJob(jobId: string, currentUser?: SessionUser, options: NoticeFilterOptions = {}) {
  return filterAcknowledged(
    DEMO_WORKFLOW_CHANGE_NOTICES.filter((notice) => {
      if (notice.targetJobId !== jobId) {
        return false;
      }
      if (options.includeAllAudience || !currentUser) {
        return true;
      }
      return noticeMatchesUser(notice, currentUser);
    }),
    options
  );
}

export function buildHomeUrgentItemsFromWorkflowChangeNotices(notices: WorkflowChangeNotice[]): HomeUrgentWatchItem[] {
  return notices
    .filter((notice) => notice.level === "urgent" && !isWorkflowChangeNoticeAcknowledged(notice.id))
    .map((notice) => ({
      id: `workflow-change-${notice.id}`,
      kind: mapNoticeKindToHomeKind(notice.changeKind),
      kind_label: notice.changeLabel,
      title: notice.title,
      summary: `${notice.jobTitle}: ${notice.actionNeeded}`,
      supporting_label: notice.audienceLabel,
      tone: mapNoticeLevelToHomeTone(notice.level),
      urgency_state: "action_needed_today",
      urgency_label: "Urgent",
      action_label: notice.actionLabel,
      action_hash: notice.actionHash,
      shoot_id: null,
      location_id: null,
      project_id: notice.department === "projects" ? notice.targetJobId ?? null : null
    }));
}

export function isWorkflowChangeNoticeAcknowledged(noticeId: string) {
  const storage = getNoticeStorage();
  return storage?.getItem(`${NOTICE_ACK_STORAGE_PREFIX}${noticeId}`) === "acknowledged";
}

export function acknowledgeWorkflowChangeNotice(noticeId: string) {
  const storage = getNoticeStorage();
  storage?.setItem(`${NOTICE_ACK_STORAGE_PREFIX}${noticeId}`, "acknowledged");
}

export function WorkflowChangeNoticePanel({
  notices,
  title = "Recent Change Notices",
  summary = "Important job, schedule, staffing, and location changes for the attached work.",
  compact = false,
  maxItems
}: {
  notices: WorkflowChangeNotice[];
  title?: string;
  summary?: string;
  compact?: boolean;
  maxItems?: number;
}) {
  const visibleNotices = typeof maxItems === "number" ? notices.slice(0, maxItems) : notices;
  const hiddenCount = Math.max(0, notices.length - visibleNotices.length);

  if (!visibleNotices.length) {
    return null;
  }

  return (
    <section className={`panel workflow-change-notice-panel${compact ? " workflow-change-notice-panel--compact" : ""}`} aria-label={title}>
      <div className="workflow-change-notice-panel__header">
        <div>
          <div className="eyebrow">Change Notices</div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
      </div>
      <div className="workflow-change-notice-list">
        {visibleNotices.map((notice) => (
          <WorkflowChangeNoticeCard key={notice.id} notice={notice} compact={compact} />
        ))}
      </div>
      {hiddenCount ? <p className="workflow-change-notice-panel__more">{hiddenCount} more notice{hiddenCount === 1 ? "" : "s"} available in related work.</p> : null}
    </section>
  );
}

export function WorkflowChangeNoticeCard({ notice, compact = false }: { notice: WorkflowChangeNotice; compact?: boolean }) {
  const [acknowledged, setAcknowledged] = useState(() => isWorkflowChangeNoticeAcknowledged(notice.id));

  function markAcknowledged() {
    acknowledgeWorkflowChangeNotice(notice.id);
    setAcknowledged(true);
  }

  return (
    <article className={`notification-card workflow-change-notice-card workflow-change-notice-card--${notice.level}${compact ? " workflow-change-notice-card--compact" : ""}`}>
      <div className="workflow-change-notice-card__top">
        <div>
          <strong>{notice.title}</strong>
          <p>{notice.summary}</p>
        </div>
        <span className={`workflow-change-notice-level workflow-change-notice-level--${notice.level}`}>{formatNoticeLevel(notice.level)}</span>
      </div>
      <div className="workflow-change-notice-card__meta" aria-label="Change notice details">
        <span>{notice.changeLabel}</span>
        <span>{notice.jobNumber ? `${notice.jobNumber} - ${notice.jobTitle}` : notice.jobTitle}</span>
        <span>Updated by {notice.updatedBy}</span>
        <span>{formatNoticeDate(notice.updatedAt)}</span>
      </div>
      {(notice.previousValue || notice.currentValue) ? (
        <div className="workflow-change-notice-card__change">
          {notice.previousValue ? <span>From: {notice.previousValue}</span> : null}
          {notice.currentValue ? <span>Now: {notice.currentValue}</span> : null}
        </div>
      ) : null}
      <div className="workflow-change-notice-card__body">
        <p><strong>Who needs to know:</strong> {notice.audienceLabel}</p>
        <p><strong>Next action:</strong> {notice.actionNeeded}</p>
      </div>
      <div className="workflow-change-notice-card__actions">
        <a className="secondary-button" href={notice.actionHash}>{notice.actionLabel}</a>
        {notice.requiresAcknowledgement ? (
          <button type="button" className="secondary-button workflow-change-notice-card__ack" onClick={markAcknowledged} disabled={acknowledged}>
            {acknowledged ? "Acknowledged" : "Acknowledge"}
          </button>
        ) : (
          <span className="meta-pill meta-pill--muted">No acknowledgement needed</span>
        )}
      </div>
    </article>
  );
}

function filterAcknowledged(notices: WorkflowChangeNotice[], options: NoticeFilterOptions) {
  if (options.includeAcknowledged ?? true) {
    return notices;
  }
  return notices.filter((notice) => !isWorkflowChangeNoticeAcknowledged(notice.id));
}

function noticeMatchesUser(notice: WorkflowChangeNotice, currentUser: SessionUser) {
  const userDepartment = (currentUser.department ?? "").toLowerCase();
  return (
    notice.audienceUserIds.includes(currentUser.id) ||
    notice.audienceDepartments.some((department) => department.toLowerCase() === userDepartment)
  );
}

function getNoticeStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function mapNoticeKindToHomeKind(changeKind: WorkflowChangeNoticeChangeKind): HomeUrgentWatchItem["kind"] {
  switch (changeKind) {
    case "blocker":
    case "priority":
    case "calendar_readiness":
      return "project";
    case "contact":
    case "roster":
      return "customer_service";
    case "gallery_deadline":
    case "job_launched":
      return "project";
    case "location":
    case "parking":
      return "location";
    case "schedule":
    case "call_time":
    case "staffing":
    case "shoot_manager":
      return "scheduling";
    case "project_risk":
      return "project";
    default:
      return "project";
  }
}

function mapNoticeLevelToHomeTone(level: WorkflowChangeNoticeLevel): HomeWidgetTone {
  switch (level) {
    case "urgent":
      return "action_needed";
    case "important":
      return "heads_up";
    default:
      return "info";
  }
}

function formatNoticeLevel(level: WorkflowChangeNoticeLevel) {
  switch (level) {
    case "urgent":
      return "Urgent";
    case "important":
      return "Important";
    default:
      return "FYI";
  }
}

function formatNoticeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
