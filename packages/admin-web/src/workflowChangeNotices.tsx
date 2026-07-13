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

// The fabricated demo notices are gone (MC-AUDIT-003/015): they interleaved fake
// change notices with real work on MyWork "Heads Up", Photography, and Job Detail,
// and their acknowledgements persisted only to localStorage. This array stays as
// the (empty) source until a server-backed notice/record-thread model exists —
// every consumer then renders its honest empty state instead of fiction.
export const DEMO_WORKFLOW_CHANGE_NOTICES: WorkflowChangeNotice[] = [];

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
