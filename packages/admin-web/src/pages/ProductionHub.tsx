import { useEffect, useMemo, useState } from "react";
import { DepartmentHubPattern, type DepartmentHubCard } from "../components/department/DepartmentHubPattern";
import { listSharedProductionQueue } from "../services/jobsApi";
import type { SharedProductionQueueItem, SharedProductionQueueResponse } from "../jobTruthTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type HubTone = "good" | "info" | "watch" | "danger";

type HubSectionItem = {
  id: string;
  title: string;
  meta: string;
  detail: string;
  href?: string;
  tone?: HubTone;
};

export function ProductionHub({ token, currentUser }: Props) {
  const [payload, setPayload] = useState<SharedProductionQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await listSharedProductionQueue(token);
      setPayload(response);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load Production right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  const items = payload?.items ?? [];
  const summary = payload?.summary;
  const dueThisWeek = useMemo(() => buildDueThisWeek(items), [items]);
  const qaNeeded = useMemo(() => buildQaNeeded(items), [items]);
  const atRisk = useMemo(() => buildAtRisk(items), [items]);
  const recentlyCompleted = useMemo(() => buildRecentlyCompleted(items), [items]);
  const helpNeeded = useMemo(() => buildHelpNeeded(items), [items]);
  const waitingCount = countWaitingForProcessing(items);
  const editingCount = countEditing(items);
  const readyForQaCount = qaNeeded.length || summary?.qa_pending_count || 0;
  const blockedCount = summary?.blocked_count ?? atRisk.filter((item) => item.tone === "danger").length;
  const urgentCount = blockedCount + (summary?.overdue_count ?? 0);
  const statusTone: HubTone = urgentCount > 0 ? "danger" : readyForQaCount > 0 || dueThisWeek.length > 0 ? "watch" : "good";
  const statusLabel = statusTone === "danger" ? "Needs attention" : statusTone === "watch" ? "Watch" : "Healthy";
  const openFirstCards: DepartmentHubCard[] = [
    { label: "Jobs To Process", value: waitingCount, detail: "Needs ingest, ownership, or kickoff.", href: "#production/queue", tone: waitingCount ? "warning" : "success" },
    { label: "QA Needed", value: readyForQaCount, detail: "Color, crop, roster, upload, or release review.", href: "#production/qa", tone: readyForQaCount ? "warning" : "success" },
    { label: "Rush / At Risk", value: blockedCount, detail: "Blocked, ownerless, overdue, or missing production inputs.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: blockedCount ? "danger" : "success" },
    { label: "Ready To Release", value: summary?.awaiting_approval_count ?? 0, detail: "Approvals or release checks that need final movement.", href: "#production/release", tone: (summary?.awaiting_approval_count ?? 0) ? "warning" : "success" }
  ];
  const attentionCards: DepartmentHubCard[] = [
    { label: "Blocked Production", value: blockedCount, detail: blockedCount ? "Clear missing files, roster data, owner, or blocker before delivery slips." : "No blocked production work is visible.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: blockedCount ? "danger" : "success" },
    { label: "Overdue Work", value: summary?.overdue_count ?? 0, detail: (summary?.overdue_count ?? 0) ? "Past due work needs a release or escalation decision." : "No overdue production work in this queue.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: (summary?.overdue_count ?? 0) ? "danger" : "success" },
    { label: "QA Pressure", value: readyForQaCount, detail: readyForQaCount ? "QA is the next action before release can move." : "QA queue is clear right now.", href: "#production/qa", tone: readyForQaCount ? "warning" : "success" }
  ];
  const weeklyCards: DepartmentHubCard[] = [
    { label: "Due This Week", value: dueThisWeek.length, detail: "Production jobs with deadlines inside the next seven days.", href: "#production/release", tone: dueThisWeek.length ? "warning" : "success" },
    { label: "In Editing", value: editingCount, detail: "Jobs actively moving through editing or production stages.", href: "#production/workload", tone: editingCount ? "info" : "success" },
    { label: "Recently Completed", value: recentlyCompleted.length, detail: "Closed, delivered, uploaded, or released work in the recent queue.", href: "#production/release", tone: "info" }
  ];
  const queueCards: DepartmentHubCard[] = [
    { label: "Editing Queue", detail: "Open production work that needs processing.", href: "#production/queue", tone: "info" },
    { label: "QA Queue", detail: "Review color, crop, roster, upload, and release readiness.", href: "#production/qa", tone: "warning" },
    { label: "Ready To Release", detail: "Final release and delivery confirmation.", href: "#production/release", tone: "info" },
    { label: "Rush Jobs", detail: "Blocked or at-risk work that needs escalation.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: urgentCount ? "danger" : "success" }
  ];

  return (
    <div className="production-hub">
      <section className="panel production-hub__hero">
        <div className="production-hub__hero-copy">
          <div className="eyebrow">Department Hub</div>
          <h2>Production</h2>
          <p>Monitor editing, QA, packaging, release preparation, and jobs at risk.</p>
          <div className="production-hub__status-row">
            <span className={`production-hub__status production-hub__status--${statusTone}`}>{statusLabel}</span>
            <span className="metric-pill">{urgentCount} urgent</span>
            <span className="metric-pill">Viewing as {currentUser.fullName}</span>
          </div>
        </div>
        <div className="production-hub__hero-actions">
          <a className="button" href="#production/queue">
            Open Production Queue
          </a>
          <a className="secondary-button" href="#production/qa">
            Review QA
          </a>
          <a className="secondary-button" href="#production/release">
            Release Readiness
          </a>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <DepartmentHubPattern
        department="Production"
        openFirst={openFirstCards}
        attention={attentionCards}
        weekly={weeklyCards}
        queues={queueCards}
      />

      {loading ? <div className="panel empty-state empty-state--panel">Loading Production work...</div> : null}

      <section className="production-hub__grid">
        <ProductionSection
          title="Due This Week"
          summary="Work that needs to be completed, uploaded, QA'd, or released in the next seven days."
          items={dueThisWeek}
          empty="No due-this-week production work is visible in the current queue."
        />
        <ProductionSection
          title="QA Needed"
          summary="Color/density, crop, roster/data match, gallery/upload, and release verification."
          items={qaNeeded}
          empty="No QA work is waiting right now."
        />
        <ProductionSection
          title="At Risk / Blocked"
          summary="Anything likely to stop Production from finishing on time."
          items={atRisk}
          empty="No blocked or at-risk production work is visible right now."
        />
        <ProductionSection
          title="Recently Completed"
          summary="Short preview of recently processed, QA'd, uploaded, released, or closed work."
          items={recentlyCompleted}
          empty="Completed production movement will appear here after work closes."
        />
      </section>

      <section className="panel production-hub__section">
        <div className="section-title">Department Help Needed</div>
        <p className="section-subtitle">Where Production needs Photography, Schools, Sports, or Leadership help before work can move.</p>
        <div className="production-hub__help-list">
          {helpNeeded.length ? helpNeeded.map((item) => <ProductionListItem key={item.id} item={item} />) : <div className="empty-state">No department handoff is blocking Production right now.</div>}
        </div>
      </section>
    </div>
  );
}

function ProductionSection({ title, summary, items, empty }: { title: string; summary: string; items: HubSectionItem[]; empty: string }) {
  return (
    <section className="panel production-hub__section">
      <div className="section-title">{title}</div>
      <p className="section-subtitle">{summary}</p>
      <div className="production-hub__list">
        {items.length ? items.slice(0, 4).map((item) => <ProductionListItem key={item.id} item={item} />) : <div className="empty-state">{empty}</div>}
      </div>
    </section>
  );
}

function ProductionListItem({ item }: { item: HubSectionItem }) {
  const content = (
    <>
      <div className="production-hub__list-item-main">
        <strong>{item.title}</strong>
        <span>{item.meta}</span>
      </div>
      <p>{item.detail}</p>
    </>
  );
  if (item.href) {
    return (
      <a className={`production-hub__list-item production-hub__list-item--${item.tone ?? "info"}`} href={item.href}>
        {content}
      </a>
    );
  }
  return <article className={`production-hub__list-item production-hub__list-item--${item.tone ?? "info"}`}>{content}</article>;
}

function countWaitingForProcessing(items: SharedProductionQueueItem[]) {
  return items.filter((item) => {
    const workflowStatus = statusValue(item.workflow_status);
    const productionStatus = statusValue(item.status);
    return ["WAITING_ON_FILES", "INTAKE_REVIEW", "READY_FOR_PRODUCTION"].includes(workflowStatus) || ["queued", "awaiting_ingest", "approved_for_production"].includes(productionStatus) || !item.assigned_to_user_id;
  }).length;
}

function countEditing(items: SharedProductionQueueItem[]) {
  return items.filter((item) => {
    const workflowStatus = statusValue(item.workflow_status);
    const productionStatus = statusValue(item.status);
    return ["IN_PRODUCTION", "READY_FOR_QA", "IN_PEER_REVIEW", "REWORK_REQUIRED", "READY_FOR_UPLOAD", "UPLOADING"].includes(workflowStatus) || ["editing", "awaiting_internal_review", "proof_build", "revisions_requested", "in_final_production"].includes(productionStatus);
  }).length;
}

function buildDueThisWeek(items: SharedProductionQueueItem[]): HubSectionItem[] {
  return items
    .filter((item) => isDueWithinDays(item, 7))
    .sort(compareDueDates)
    .map((item) => toHubItem(item, "Due this week", buildDueDetail(item), "#production/release", item.days_past_due && item.days_past_due > 0 ? "danger" : "watch"));
}

function buildQaNeeded(items: SharedProductionQueueItem[]): HubSectionItem[] {
  return items
    .filter((item) => item.qa_required && (!item.peer_review_complete || !item.final_release_review_complete || item.qa_summary_status !== "passed"))
    .sort(compareDueDates)
    .map((item) => toHubItem(item, "Needs QA", buildQaDetail(item), "#production/qa", item.qa_summary_status === "failed" || item.qa_fail_count > 0 ? "danger" : "watch"));
}

function buildAtRisk(items: SharedProductionQueueItem[]): HubSectionItem[] {
  return items
    .filter((item) => {
      const healthState = statusValue(item.health_state);
      return item.blocker_count > 0 || item.blocking_issue_count > 0 || item.risk_flag || healthState === "BLOCKED" || healthState === "AT_RISK" || (item.days_past_due ?? 0) > 0 || item.file_receipt_state === "missing_receipt" || item.file_receipt_state === "partial_receipt" || !item.roster_received || !item.assigned_to_user_id;
    })
    .sort((left, right) => riskRank(right) - riskRank(left))
    .map((item) => toHubItem(item, "Blocked or at risk", buildRiskDetail(item), "#production/qa?queue=blocked_queue&stage=blocked", item.blocker_count || item.blocking_issue_count ? "danger" : "watch"));
}

function buildRecentlyCompleted(items: SharedProductionQueueItem[]): HubSectionItem[] {
  return items
    .filter((item) => Boolean(item.completed_at || item.closed_at || statusValue(item.release_status) === "RELEASED" || item.deliverable_status === "delivered"))
    .sort((left, right) => new Date(right.completed_at ?? right.closed_at ?? right.updated_at).getTime() - new Date(left.completed_at ?? left.closed_at ?? left.updated_at).getTime())
    .map((item) => toHubItem(item, "Recently completed", buildCompletedDetail(item), "#production/release", "good"));
}

function buildHelpNeeded(items: SharedProductionQueueItem[]): HubSectionItem[] {
  const help: HubSectionItem[] = [];
  for (const item of items) {
    if (item.file_receipt_state === "missing_receipt" || item.file_receipt_state === "partial_receipt") {
      help.push(toHubItem(item, "Photography help needed", "Waiting on uploaded files or a complete file handoff.", "#studios/workload", "danger"));
    }
    if (!item.roster_received) {
      help.push(toHubItem(item, `${formatDepartment(item.department_type)} help needed`, "Waiting on roster, data, team, or school details before Production can finish.", item.department_type === "sports" ? "#sports" : "#schools", "watch"));
    }
    if (!item.assigned_to_user_id) {
      help.push(toHubItem(item, "Leadership decision needed", "No Production owner is assigned yet.", "#production/workload", "watch"));
    }
    if (item.approval_required && item.approval_status !== "approved") {
      help.push(toHubItem(item, `${formatDepartment(item.department_type)} approval needed`, "Approval is still needed before release can move cleanly.", item.department_type === "sports" ? "#sports/graphics" : "#schools/production", "watch"));
    }
  }
  return help.slice(0, 5);
}

function toHubItem(item: SharedProductionQueueItem, metaPrefix: string, detail: string, href: string, tone: HubTone): HubSectionItem {
  return {
    id: `${metaPrefix}-${item.id}`,
    title: item.job_number ? `${item.job_number} - ${item.job_title}` : item.job_title || item.title,
    meta: `${metaPrefix} - ${formatDepartment(item.department_type)} - ${item.assigned_to_name ?? "Owner needed"}`,
    detail,
    href,
    tone
  };
}

function buildDueDetail(item: SharedProductionQueueItem) {
  const due = item.delivery_deadline_at ?? item.release_due_at ?? item.due_at;
  if (item.days_past_due && item.days_past_due > 0) {
    return `${item.days_past_due} day${item.days_past_due === 1 ? "" : "s"} overdue. Next: clear blocker or move release date.`;
  }
  return due ? `Due ${formatDate(due)}. Next: ${nextProductionAction(item)}.` : `Due this week. Next: ${nextProductionAction(item)}.`;
}

function buildQaDetail(item: SharedProductionQueueItem) {
  if (item.qa_summary_status === "failed" || item.qa_fail_count > 0) {
    return `QA found ${item.qa_fail_count || 1} issue${item.qa_fail_count === 1 ? "" : "s"}. Next: correct and recheck before release.`;
  }
  return `Check color/density, crop, data/roster match, and gallery/upload readiness.`;
}

function buildRiskDetail(item: SharedProductionQueueItem) {
  if (item.blocked_reason) {
    return `Blocked by ${item.blocked_reason}.`;
  }
  if (item.file_receipt_state === "missing_receipt" || item.file_receipt_state === "partial_receipt") {
    return "Blocked by missing files or partial upload handoff.";
  }
  if (!item.roster_received) {
    return "Blocked by missing roster/data.";
  }
  if (!item.assigned_to_user_id) {
    return "Ownerless Production work needs assignment.";
  }
  return `At risk in ${humanize(item.health_state)}. Next: ${nextProductionAction(item)}.`;
}

function buildCompletedDetail(item: SharedProductionQueueItem) {
  if (statusValue(item.release_status) === "RELEASED") {
    return "Released and ready for downstream confirmation.";
  }
  if (item.deliverable_status === "delivered") {
    return "Deliverable sent or confirmed.";
  }
  return `Completed ${formatDate(item.completed_at ?? item.closed_at ?? item.updated_at)}.`;
}

function nextProductionAction(item: SharedProductionQueueItem) {
  if (item.blocker_count || item.blocking_issue_count || item.blocked_reason) {
    return "clear the blocker";
  }
  if (item.qa_required && !item.peer_review_complete) {
    return "complete peer QA";
  }
  if (statusValue(item.release_status) === "READY_FOR_RELEASE") {
    return "release or confirm delivery";
  }
  if (!item.assigned_to_user_id) {
    return "assign an owner";
  }
  return "keep Production moving";
}

function isDueWithinDays(item: SharedProductionQueueItem, days: number) {
  const dateValue = item.delivery_deadline_at ?? item.release_due_at ?? item.due_at;
  if (!dateValue) {
    return false;
  }
  const dueTime = new Date(dateValue).getTime();
  if (Number.isNaN(dueTime)) {
    return false;
  }
  const now = Date.now();
  return dueTime <= now + days * 24 * 60 * 60 * 1000;
}

function compareDueDates(left: SharedProductionQueueItem, right: SharedProductionQueueItem) {
  const leftTime = new Date(left.delivery_deadline_at ?? left.release_due_at ?? left.due_at ?? left.updated_at).getTime();
  const rightTime = new Date(right.delivery_deadline_at ?? right.release_due_at ?? right.due_at ?? right.updated_at).getTime();
  return leftTime - rightTime;
}

function riskRank(item: SharedProductionQueueItem) {
  return (item.blocking_issue_count * 5) + (item.blocker_count * 4) + (item.days_past_due ?? 0) + (item.risk_flag ? 3 : 0);
}

function statusValue(value: unknown) {
  return String(value ?? "");
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDepartment(value: string | null | undefined) {
  if (!value) {
    return "Production";
  }
  return humanize(value);
}

function humanize(value: string | null | undefined) {
  if (!value) {
    return "Production";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
