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

type ProductionWorkAreaId = "initial" | "in_production" | "d_card" | "gallery_portal" | "review_exceptions";

type ProductionWorkArea = {
  id: ProductionWorkAreaId;
  label: string;
  summary: string;
  items: HubSectionItem[];
  empty: string;
};

export function ProductionHub({ token, currentUser }: Props) {
  const [payload, setPayload] = useState<SharedProductionQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWorkArea, setActiveWorkArea] = useState<ProductionWorkAreaId>("initial");

  async function load() {
    setLoading(true);
    try {
      const response = await listSharedProductionQueue(token);
      setPayload(response);
      setError("");
    } catch (loadError) {
      console.error("Production queue failed to load", loadError);
      setPayload(null);
      setError("Production data is not available in this demo view.");
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
  const workAreas = useMemo(() => buildProductionWorkAreas(items), [items]);
  const waitingCount = countWaitingForProcessing(items);
  const editingCount = countEditing(items);
  const readyForQaCount = qaNeeded.length;
  const blockedCount = summary?.blocked_count ?? atRisk.filter((item) => item.tone === "danger").length;
  const urgentCount = blockedCount + (summary?.overdue_count ?? 0);
  const dataUnavailable = Boolean(error && !payload);
  const statusTone: HubTone = dataUnavailable ? "watch" : urgentCount > 0 ? "danger" : readyForQaCount > 0 || dueThisWeek.length > 0 ? "watch" : "good";
  const statusLabel = dataUnavailable ? "Demo data unavailable" : statusTone === "danger" ? "Needs attention" : statusTone === "watch" ? "Watch" : "Healthy";
  const productionViewerName = currentUser.fullName.trim().toLowerCase() === "demo admin" ? "Mission Control User" : currentUser.fullName;
  const openFirstCards: DepartmentHubCard[] = [
    { label: "Ready", value: waitingCount, detail: "Needs ingest or owner.", href: "#production-queue", tone: waitingCount ? "warning" : "success" },
    { label: "QA", value: readyForQaCount, detail: "Review color, crop, roster, upload, or release readiness.", href: "#production/qa", tone: readyForQaCount ? "warning" : "success" },
    { label: "At Risk", value: blockedCount, detail: "Blocked, ownerless, overdue, or missing production inputs.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: blockedCount ? "danger" : "success" },
    { label: "Release", value: summary?.awaiting_approval_count ?? 0, detail: "Uploads, approvals, and final delivery checks.", href: "#production/release", tone: (summary?.awaiting_approval_count ?? 0) ? "warning" : "success" }
  ];
  const attentionCards: DepartmentHubCard[] = [
    { label: "Blocked", value: blockedCount, detail: blockedCount ? "Clear missing files, roster data, owner, or blocker." : "No blocked production work is visible.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: blockedCount ? "danger" : "success" },
    { label: "Overdue", value: summary?.overdue_count ?? 0, detail: (summary?.overdue_count ?? 0) ? "Past due work needs a release or escalation decision." : "No overdue production work in this queue.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: (summary?.overdue_count ?? 0) ? "danger" : "success" },
    { label: "QA Hold", value: readyForQaCount, detail: readyForQaCount ? "QA is the next action before release can move." : "QA queue is clear right now.", href: "#production/qa", tone: readyForQaCount ? "warning" : "success" }
  ];
  const weeklyCards: DepartmentHubCard[] = [
    { label: "Due This Week", value: dueThisWeek.length, detail: "Processing, QA, upload, or release deadlines inside the next seven days.", href: "#production/release", tone: dueThisWeek.length ? "warning" : "success" },
    { label: "In Editing", value: editingCount, detail: "Jobs actively moving through editing or production stages.", href: "#production/workload", tone: editingCount ? "info" : "success" },
    { label: "Complete", value: recentlyCompleted.length, detail: "Closed, delivered, uploaded, or released work in the recent queue.", href: "#production/release", tone: "info" }
  ];
  const queueCards: DepartmentHubCard[] = [
    { label: "Queue", detail: "Open production jobs that need processing.", href: "#production-queue", tone: "info" },
    { label: "QA", detail: "Review color, crop, roster, upload, and release readiness.", href: "#production/qa", tone: "warning" },
    { label: "Release", detail: "Final uploads, release, and delivery confirmation.", href: "#production/release", tone: "info" },
    { label: "At Risk", detail: "Blocked work that needs escalation.", href: "#production/qa?queue=blocked_queue&stage=blocked", tone: urgentCount ? "danger" : "success" }
  ];

  return (
    <div className="production-hub">
      <section className="panel production-hub__hero">
        <div className="production-hub__hero-copy">
          <div className="eyebrow">Department Hub</div>
          <h2>Production</h2>
          <p>See jobs, owners, blockers, QA, and release work.</p>
          <div className="production-hub__status-row">
            <span className={`production-hub__status production-hub__status--${statusTone}`}>{statusLabel}</span>
            <span className="metric-pill">{urgentCount} urgent</span>
            <span className="metric-pill">Viewing as {productionViewerName}</span>
          </div>
        </div>
        <div className="production-hub__hero-actions">
          <a className="button" href="#production-queue">
            Open Production Board
          </a>
        </div>
      </section>

      {error ? <div className="panel empty-state empty-state--panel">{error}</div> : null}

      <DepartmentHubPattern
        department="Production"
        openFirst={openFirstCards}
        attention={attentionCards}
        weekly={weeklyCards}
        queues={queueCards}
      />

      {loading ? <div className="panel empty-state empty-state--panel">Loading Production work...</div> : null}

      <ProductionWorkAreaTabs workAreas={workAreas} activeWorkArea={activeWorkArea} onChange={setActiveWorkArea} />

      <section className="production-hub__grid">
        <ProductionSection
          title="Due This Week"
          summary="Work that needs to be processed, uploaded, QA'd, or released in the next seven days."
          items={dueThisWeek}
          empty="No due-this-week production work is visible in the current queue."
        />
        <ProductionSection
          title="QA Needed"
          summary="Color, crop, roster, upload, and release checks."
          items={qaNeeded}
          empty="No QA work is waiting right now."
        />
        <ProductionSection
          title="At Risk"
          summary="Anything likely to stop Production from finishing on time."
          items={atRisk}
          empty="No blocked or at-risk production work is visible right now."
        />
        <ProductionSection
          title="Complete"
          summary="Recently processed, uploaded, released, or closed work."
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

function ProductionWorkAreaTabs({
  workAreas,
  activeWorkArea,
  onChange
}: {
  workAreas: ProductionWorkArea[];
  activeWorkArea: ProductionWorkAreaId;
  onChange: (workArea: ProductionWorkAreaId) => void;
}) {
  const selectedWorkArea = workAreas.find((area) => area.id === activeWorkArea) ?? workAreas[0];

  return (
    <section className="panel production-hub__work-areas" aria-label="Production work areas">
      <div className="production-hub__work-areas-heading">
        <div>
          <div className="section-title">Production Work Areas</div>
          <p className="section-subtitle">Job type stays with Schools, Sports, or Specialty. These tabs show where the same work sits in Production.</p>
        </div>
      </div>
      <div className="production-work-tabs" role="tablist" aria-label="Production work area tabs">
        {workAreas.map((area) => (
          <button
            key={area.id}
            type="button"
            role="tab"
            aria-selected={selectedWorkArea.id === area.id}
            aria-controls={`production-work-area-${area.id}`}
            id={`production-work-tab-${area.id}`}
            className={selectedWorkArea.id === area.id ? "is-active" : ""}
            onClick={() => onChange(area.id)}
          >
            <span>{area.label}</span>
            <strong>{area.items.length}</strong>
          </button>
        ))}
      </div>
      <article
        className="production-work-tab-panel"
        role="tabpanel"
        id={`production-work-area-${selectedWorkArea.id}`}
        aria-labelledby={`production-work-tab-${selectedWorkArea.id}`}
      >
        <div className="production-work-tab-panel__heading">
          <div>
            <strong>{selectedWorkArea.label}</strong>
            <p>{selectedWorkArea.summary}</p>
          </div>
          <span className="metric-pill">{selectedWorkArea.items.length} {selectedWorkArea.items.length === 1 ? "item" : "items"}</span>
        </div>
        <div className="production-hub__list">
          {selectedWorkArea.items.length ? (
            selectedWorkArea.items.slice(0, 5).map((item) => <ProductionListItem key={item.id} item={item} />)
          ) : (
            <div className="empty-state">{selectedWorkArea.empty}</div>
          )}
        </div>
      </article>
    </section>
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

function buildProductionWorkAreas(items: SharedProductionQueueItem[]): ProductionWorkArea[] {
  const initialItems = items
    .filter(isInitialProductionItem)
    .sort(compareDueDates)
    .map((item) => toHubItem(item, "Initial Process", `Job type: ${formatDepartment(item.department_type)}. Next: confirm files, owner, and intake readiness.`, "#production-queue", item.file_receipt_state === "missing_receipt" || !item.assigned_to_user_id ? "watch" : "info"));
  const inProductionItems = items
    .filter(isInProductionItem)
    .sort(compareDueDates)
    .map((item) => toHubItem(item, "In Production", `Job type: ${formatDepartment(item.department_type)}. Next: ${nextProductionAction(item)}.`, "#production/workload", "info"));
  const dCardItems = items
    .filter(isDCardItem)
    .sort(compareDueDates)
    .map((item) => toHubItem(item, "D-Card Process", `Job type: ${formatDepartment(item.department_type)}. Next: verify D-card or roster output before release.`, "#production-queue", "watch"));
  const galleryPortalItems = items
    .filter(isGalleryPortalItem)
    .sort(compareDueDates)
    .map((item) => toHubItem(item, "Gallery", `Job type: ${formatDepartment(item.department_type)}. Next: confirm upload, approval, or release readiness.`, "#production/release", item.approval_required && item.approval_status !== "approved" ? "watch" : "info"));
  const reviewExceptionItems = items
    .filter(isReviewExceptionItem)
    .sort((left, right) => riskRank(right) - riskRank(left))
    .map((item) => toHubItem(item, "Review", `Job type: ${formatDepartment(item.department_type)}. Next: clear QA, blocker, or exception before delivery.`, "#production/qa", item.blocker_count || item.blocking_issue_count || item.days_past_due ? "danger" : "watch"));

  return [
    {
      id: "initial",
      label: "Initial Process",
      summary: "Jobs being checked in, confirmed, assigned, or prepared for production.",
      items: initialItems,
      empty: "No intake or setup work is visible in the current queue."
    },
    {
      id: "in_production",
      label: "In Production",
      summary: "Work currently moving through editing, graphics, proofing, or finishing.",
      items: inProductionItems,
      empty: "No active editing or finishing work is visible right now."
    },
    {
      id: "d_card",
      label: "D-Card Process",
      summary: "Jobs waiting on or moving through D-card, ID-card, roster, or card-output work.",
      items: dCardItems,
      empty: "No D-card-specific work is visible in this queue."
    },
    {
      id: "gallery_portal",
      label: "Gallery",
      summary: "Jobs preparing for gallery upload, portal review, approval, release, or delivery.",
      items: galleryPortalItems,
      empty: "No gallery, portal, or release work is visible right now."
    },
    {
      id: "review_exceptions",
      label: "Review",
      summary: "Blocked, at-risk, QA-needed, ownerless, or review-needed production work.",
      items: reviewExceptionItems,
      empty: "No review or exception work is blocking Production right now."
    }
  ];
}

function isInitialProductionItem(item: SharedProductionQueueItem) {
  const workflowStatus = statusValue(item.workflow_status);
  const productionStatus = statusValue(item.status);
  return ["WAITING_ON_FILES", "INTAKE_REVIEW", "READY_FOR_PRODUCTION"].includes(workflowStatus) || ["queued", "awaiting_ingest", "approved_for_production"].includes(productionStatus) || item.file_receipt_state === "missing_receipt" || item.file_receipt_state === "partial_receipt" || !item.assigned_to_user_id;
}

function isInProductionItem(item: SharedProductionQueueItem) {
  const workflowStatus = statusValue(item.workflow_status);
  const productionStatus = statusValue(item.status);
  return ["IN_PRODUCTION", "IN_PEER_REVIEW", "REWORK_REQUIRED", "READY_FOR_UPLOAD", "UPLOADING"].includes(workflowStatus) || ["editing", "awaiting_internal_review", "proof_build", "revisions_requested", "in_final_production"].includes(productionStatus);
}

function isDCardItem(item: SharedProductionQueueItem) {
  const searchable = [
    item.job_type,
    item.production_template_key,
    item.completion_rule_key,
    item.job_title,
    item.title,
    item.client_visible_label,
    item.production_notes,
    item.internal_notes,
    item.gallery_or_output_reference
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(d[-\s]?card|id[-\s]?card|card output|roster card)\b/.test(searchable);
}

function isGalleryPortalItem(item: SharedProductionQueueItem) {
  const workflowStatus = statusValue(item.workflow_status);
  const releaseStatus = statusValue(item.release_status);
  const uploadStatus = statusValue(item.upload_status);
  const deliverableStatus = statusValue(item.deliverable_status);
  return ["READY_FOR_UPLOAD", "UPLOADING", "READY_FOR_RELEASE", "RELEASED"].includes(workflowStatus) || ["READY_FOR_RELEASE", "RELEASED", "IN_REVIEW"].includes(releaseStatus) || uploadStatus !== "NOT_STARTED" || ["ready", "delivered"].includes(deliverableStatus) || Boolean(item.release_due_at || item.gallery_or_output_reference || item.approval_required);
}

function isReviewExceptionItem(item: SharedProductionQueueItem) {
  const healthState = statusValue(item.health_state);
  const needsQa = item.qa_required && (!item.peer_review_complete || !item.final_release_review_complete || item.qa_summary_status !== "passed");
  return needsQa || item.blocker_count > 0 || item.blocking_issue_count > 0 || item.risk_flag || healthState === "BLOCKED" || healthState === "AT_RISK" || (item.days_past_due ?? 0) > 0 || !item.roster_received || (item.approval_required && item.approval_status !== "approved") || !item.assigned_to_user_id;
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
