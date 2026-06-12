import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Socket } from "socket.io-client";
import { buildShellRouteHash } from "../../navigation";
import { canAccessRoute } from "../../permissions";
import { getHomeDashboard } from "../../services/homeDashboard";
import { listSharedProductionQueue } from "../../services/jobsApi";
import type { JobDepartmentType, SharedProductionQueueItem } from "../../jobTruthTypes";
import { MissionControlAssistant } from "./MissionControlAssistant";
import type {
  HomeDepartmentTaskCounts,
  HomeDashboardResponse,
  HomeSurfaceStaffingBand,
  HomeSurfaceTimeBand,
  HomeUrgentWatchItem,
  HomeWidgetTone,
  SessionUser
} from "../../types";
import { resolveWorkSpineActionHref } from "../../workSpineRouting";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import {
  buildHomeUrgentItemsFromWorkflowChangeNotices,
  getWorkflowChangeNoticesForUser
} from "../../workflowChangeNotices";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  onOpenConcierge?: (initialQuery?: string) => void;
};

type OperationalSummaryCard = {
  key: string;
  title: string;
  count: number;
  summary: string;
  explanation: string;
  actionLabel: string;
  hash: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

type WeeklyCommandItem = {
  key: string;
  title: string;
  count: number;
  summary: string;
  actionLabel: string;
  hash: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

type CachedHomeDashboard = {
  loadedAt: number;
  payload: HomeDashboardResponse;
};

const HOME_CACHE_TTL_MS = 45_000;
const homeDashboardCache = new Map<string, CachedHomeDashboard>();
const EMPTY_TASK_COUNTS: HomeDepartmentTaskCounts = {
  schools: null,
  sports: null,
  production: null
};

function isCacheFresh(loadedAt: number, ttlMs: number) {
  return Date.now() - loadedAt <= ttlMs;
}

function navigateToHash(hash: string) {
  window.location.hash = hash;
}

function formatHomeTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function mapTone(tone: HomeWidgetTone | undefined): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (tone) {
    case "good":
      return "success";
    case "heads_up":
      return "warning";
    case "action_needed":
      return "danger";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

function resolveHomeActionHash(hash: string | null | undefined) {
  return resolveWorkSpineActionHref({ actionHash: hash, fallbackHash: hash });
}

function getPlainActionLabel(label: string, hash: string | null | undefined) {
  const normalizedHash = resolveHomeActionHash(hash);
  const lowerHash = normalizedHash.toLowerCase();
  const lowerLabel = label.toLowerCase();

  if (lowerHash.includes("needs-attention") || lowerHash.includes("compliance") || lowerLabel.includes("compliance")) {
    return "Review the alert";
  }
  if (lowerHash.includes("attendance")) {
    return "Open Attendance Review";
  }
  if (lowerHash.includes("project-tracking")) {
    return "View in Project Tracking";
  }
  if (lowerHash.includes("dashboard/my-day") || lowerHash.includes("my-work")) {
    return "Open My Work";
  }
  if (lowerHash.includes("staffing") || lowerHash.includes("scheduling")) {
    return "Open work";
  }
  if (lowerHash.startsWith("#studios")) {
    return "Open Photography";
  }
  if (lowerHash.startsWith("#schools")) {
    return "Open Schools";
  }
  if (lowerHash.startsWith("#sports")) {
    return "Open Sports";
  }
  if (lowerHash.startsWith("#production")) {
    return "Open Production hub";
  }
  if (lowerLabel === "view" || lowerLabel === "details" || lowerLabel === "review" || lowerLabel === "action") {
    return "Open work";
  }
  return label.replace(/^View\b/i, "Open").replace(/^Open attendance$/i, "Open Attendance Review");
}

function getUrgentDepartmentLabel(item: HomeUrgentWatchItem | null) {
  const hash = resolveHomeActionHash(item?.action_hash).toLowerCase();
  const text = `${item?.kind_label ?? ""} ${item?.title ?? ""} ${item?.summary ?? ""}`.toLowerCase();

  if (hash.includes("attendance") || item?.kind === "attendance" || item?.kind === "labor") {
    return "Staffing";
  }
  if (hash.startsWith("#schools") || text.includes("school")) {
    return "Schools";
  }
  if (hash.startsWith("#sports") || text.includes("sport") || text.includes("roster")) {
    return "Sports";
  }
  if (hash.startsWith("#studios") || text.includes("photo") || text.includes("shoot")) {
    return "Photography";
  }
  if (hash.startsWith("#graphics") || hash.startsWith("#production") || text.includes("production") || text.includes("gallery")) {
    return "Production";
  }
  if (hash.includes("project-tracking") || item?.kind === "project") {
    return "Projects";
  }
  return "Operations";
}

function buildUrgentBriefingCard(input: {
  urgentItems: HomeUrgentWatchItem[];
  canOpenNeedsAttention: boolean;
  canOpenAlerts: boolean;
}): OperationalSummaryCard {
  const topItem = input.urgentItems[0] ?? null;
  const count = input.urgentItems.length;
  const departmentLabel = getUrgentDepartmentLabel(topItem);
  const hash = topItem ? resolveHomeActionHash(topItem.action_hash) : input.canOpenNeedsAttention ? buildShellRouteHash("people-ops-compliance") : buildShellRouteHash("dashboard");

  return {
    key: "urgent_issues",
    title: "Urgent Issues",
    count,
    summary: count > 0 ? formatDepartmentAttentionLabel(departmentLabel) : "No urgent issues flagged",
    explanation: topItem?.summary ?? "No critical, blocked, overdue, or ownerless item is currently flagged for this Home view.",
    actionLabel: count > 0 ? getPlainActionLabel(topItem?.action_label ?? "Open work", topItem?.action_hash) : input.canOpenAlerts ? "Open Alerts" : "Open Home",
    hash,
    tone: count > 0 ? mapTone(topItem?.tone) : "success"
  };
}

function formatDepartmentAttentionLabel(departmentLabel: string) {
  if (departmentLabel === "Schools" || departmentLabel === "Sports" || departmentLabel === "Projects") {
    return `${departmentLabel} need attention`;
  }
  return `${departmentLabel} needs attention`;
}

function getBriefingCardLabel(card: OperationalSummaryCard) {
  if (card.key === "urgent_issues") {
    return `${card.title} · ${card.count}`;
  }
  return card.title;
}

function getTimeClockHeadline(timeBand: HomeSurfaceTimeBand) {
  switch (timeBand.state) {
    case "active":
      return "Clocked in now";
    case "off_shift":
      return "Ready to clock in";
    case "action_needed":
      return "Clock-in needed";
    case "needs_review":
      return "Time review needed";
    case "ended_today":
      return "Clocked out";
    default:
      return timeBand.label;
  }
}

function getTimeClockActionLabel(timeBand: HomeSurfaceTimeBand) {
  switch (timeBand.state) {
    case "active":
      return "Clock Out";
    case "off_shift":
    case "action_needed":
      return "Clock In";
    case "needs_review":
      return "Review Time";
    case "ended_today":
      return "View Schedule";
    default:
      return timeBand.action_label || "Open Time Clock";
  }
}

function getTimeClockTone(timeBand: HomeSurfaceTimeBand) {
  if (timeBand.state === "active") {
    return "success";
  }
  if (timeBand.state === "ended_today") {
    return "neutral";
  }
  if (timeBand.state === "off_shift") {
    return "info";
  }
  return "warning";
}

function getAttendanceMetrics(staffingBand: HomeSurfaceStaffingBand | null) {
  if (!staffingBand?.visible) {
    return [];
  }

  const order: Array<{
    id: "in_field" | "in_office" | "assigned_but_missing";
    label: string;
  }> = [
    { id: "in_field", label: "Clocked In - Field" },
    { id: "in_office", label: "Clocked In - Office" },
    { id: "assigned_but_missing", label: "Expected In, Not Clocked In" }
  ];

  return order
    .map((entry) => {
      const metric = staffingBand.metrics.find((item) => item.id === entry.id);
      if (!metric) {
        return null;
      }
      return {
        ...metric,
        label: entry.label,
        tone: mapTone(metric.tone)
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
}

function findCompactWidget(payload: HomeDashboardResponse | null, id: string) {
  return payload?.home_surface?.compact_widgets.find((widget) => widget.id === id) ?? null;
}

function buildSummaryCards(input: {
  payload: HomeDashboardResponse | null;
  taskCounts: HomeDepartmentTaskCounts;
  canOpenToday: boolean;
  canOpenStaffing: boolean;
  canOpenSchoolTasks: boolean;
  canOpenSportsTasks: boolean;
  canOpenProductionTasks: boolean;
  canOpenProductionQueue: boolean;
}) {
  const cards: OperationalSummaryCard[] = [];
  const todayShoots = input.payload?.widgets.today_shoots ?? null;
  const productionProjects = input.payload?.widgets.production_projects ?? null;
  const staffingWidget = findCompactWidget(input.payload, "staffing_health");
  const productionWidget = findCompactWidget(input.payload, "production_snapshot");

  if (input.canOpenToday && todayShoots) {
    cards.push({
      key: "shoots_today",
      title: "Today's Shoots",
      count: todayShoots.total,
      summary: "Photography field work scheduled for today",
      explanation:
        todayShoots.needs_attention_count > 0
          ? `${todayShoots.needs_attention_count} scheduled item${todayShoots.needs_attention_count === 1 ? "" : "s"} still need readiness follow-through before the day is safe.`
          : "Today's field work is visible here so the team can confirm timing, readiness, and staffing before jumping into details.",
      actionLabel: "Open Photography",
      hash: "#studios/shoots",
      tone: todayShoots.needs_attention_count > 0 ? "warning" : "info"
    });
  }

  if (input.canOpenStaffing) {
    const fallbackCount =
      input.payload?.widgets.today_shoots.shoots.filter(
        (shoot) => shoot.staffing_readiness_tone === "action_needed" || shoot.staffing_readiness_tone === "heads_up"
      ).length ?? 0;
    const staffingTone = staffingWidget ? mapTone(staffingWidget.tone) : fallbackCount > 0 ? "warning" : "success";

    cards.push({
      key: "staffing_gaps",
      title: "Staffing Gaps",
      count: staffingWidget?.count ?? fallbackCount,
      summary: "Coverage gaps that could slow down today's work",
      explanation:
        (staffingWidget?.count ?? fallbackCount) > 0
          ? "A staffing gap can delay arrivals, break lead coverage, or force a same-day replacement decision."
          : "No staffing gap is currently flagged, but this stays one click away for same-day coverage checks.",
      actionLabel: "Open work",
      hash: staffingWidget?.action_hash || "#operations/staffing?area=staffing",
      tone: staffingTone
    });
  }

  if (input.canOpenProductionQueue && productionProjects) {
    cards.push({
      key: "digital_production",
      title: "Production Work",
      count: productionWidget?.count ?? productionProjects.counts.active_jobs,
      summary: "Production work preview from the daily command center",
      explanation:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? `${productionProjects.counts.blocked} blocked and ${productionProjects.counts.overdue} overdue production item${productionProjects.counts.blocked + productionProjects.counts.overdue === 1 ? "" : "s"} need project review.`
          : "Production is active; open the department hub when you need the owner, due state, or release blocker.",
      actionLabel:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? "View in Project Tracking"
          : "Open Production hub",
      hash:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? buildShellRouteHash("project-tracking")
          : productionWidget?.action_hash || buildShellRouteHash("production-workload"),
      tone:
        productionProjects.counts.blocked > 0 || productionProjects.counts.overdue > 0
          ? "warning"
          : mapTone(productionWidget?.tone)
    });
  }

  if (input.canOpenSchoolTasks && input.taskCounts.schools != null) {
    cards.push({
      key: "school_tasks",
      title: "Schools Tasks",
      count: input.taskCounts.schools,
      summary: "School task preview",
      explanation:
        input.taskCounts.schools > 0
          ? "School tasks can affect photo-day readiness, client follow-up, or field handoff quality."
          : "No open school task count is currently flagged for this Home view.",
      actionLabel: "Open Schools",
      hash: "#schools/tasks",
      tone: input.taskCounts.schools > 0 ? "info" : "success"
    });
  }

  if (input.canOpenSportsTasks && input.taskCounts.sports != null) {
    cards.push({
      key: "sports_tasks",
      title: "Sports Tasks",
      count: input.taskCounts.sports,
      summary: "Sports task preview",
      explanation:
        input.taskCounts.sports > 0
          ? "Sports tasks can affect roster readiness, shoot prep, graphics, or customer follow-through."
          : "No open sports task count is currently flagged for this Home view.",
      actionLabel: "Open Sports",
      hash: "#sports/tasks",
      tone: input.taskCounts.sports > 0 ? "info" : "success"
    });
  }

  if (input.canOpenProductionTasks && input.taskCounts.production != null) {
    cards.push({
      key: "production_tasks",
      title: "Production Tasks",
      count: input.taskCounts.production,
      summary: "Production task preview",
      explanation:
        input.taskCounts.production > 0
          ? "Production tasks can turn into overdue delivery or release blockers if no one clears the next step."
          : "No open production task count is currently flagged for this Home view.",
      actionLabel: "Open Production hub",
      hash: "#production/tasks",
      tone: input.taskCounts.production > 0 ? "info" : "success"
    });
  }

  return cards.slice(0, 6);
}

function buildWeeklyOperationalPriorityItems(input: {
  payload: HomeDashboardResponse | null;
  taskCounts: HomeDepartmentTaskCounts;
  canOpenStaffing: boolean;
  canOpenSchoolTasks: boolean;
  canOpenSportsTasks: boolean;
  canOpenPhotography: boolean;
  canOpenProductionQueue: boolean;
  canOpenProjectTracking: boolean;
}) {
  const items: WeeklyCommandItem[] = [];
  const production = input.payload?.widgets.production_projects ?? null;
  const todayShoots = input.payload?.widgets.today_shoots ?? null;
  const staffingWidget = findCompactWidget(input.payload, "staffing_health");
  const weeklyShootCount = input.payload?.widgets.business_pulse.weekly_department_mix.reduce((total, row) => total + row.shoots, 0) ?? 0;
  const businessJobs = input.payload?.widgets.business_pulse.jobs ?? [];

  if (input.canOpenPhotography && todayShoots) {
    items.push({
      key: "weekly_shoots",
      title: "Shoots scheduled this week",
      count: weeklyShootCount || todayShoots.total,
      summary: "Field work the company needs to staff, prep, shoot, and hand off.",
      actionLabel: "Open Photography",
      hash: "#studios/shoots",
      tone: todayShoots.needs_attention_count > 0 ? "warning" : "info"
    });
  }

  if (input.canOpenStaffing) {
    const staffingCount = staffingWidget?.count ?? 0;
    items.push({
      key: "weekly_staffing",
      title: "Staffing gaps",
      count: staffingCount,
      summary: staffingCount > 0 ? "Coverage gaps that could affect this week's field work." : "No staffing gap is flagged in the current Home view.",
      actionLabel: "Open Staffing",
      hash: staffingWidget?.action_hash || "#operations/staffing?area=staffing",
      tone: staffingCount > 0 ? "warning" : "success"
    });
  }

  if (input.canOpenProductionQueue && production) {
    const waitingCount = production.counts.unassigned_jobs + production.counts.active_jobs + production.counts.jobs_in_qa;
    items.push({
      key: "weekly_awaiting_production",
      title: "Jobs awaiting production",
      count: waitingCount,
      summary: "Open production work waiting on ownership, processing, QA, or next action.",
      actionLabel: "Open Production Workload",
      hash: buildShellRouteHash("graphics-workload"),
      tone: production.counts.blocked || production.counts.overdue ? "warning" : waitingCount > 0 ? "info" : "success"
    });
  }

  if (input.canOpenProductionQueue && production) {
    items.push({
      key: "weekly_release",
      title: "Work ready to release",
      count: production.counts.ready_to_release,
      summary: "Jobs, uploads, galleries, or release checks ready for final follow-through.",
      actionLabel: "Open Release Queue",
      hash: buildShellRouteHash("graphics-release"),
      tone: production.counts.ready_to_release > 0 ? "warning" : "success"
    });
  }

  if (input.canOpenProjectTracking && production) {
    const blockedProjectCount = production.counts.blocked + production.counts.overdue + production.urgent_items.length;
    items.push({
      key: "weekly_project_risk",
      title: "Projects blocked or at risk",
      count: blockedProjectCount,
      summary: "Shared work that needs owner clarity, blocker removal, or leadership attention.",
      actionLabel: "Open Project Tracking",
      hash: buildShellRouteHash("project-tracking"),
      tone: blockedProjectCount > 0 ? "danger" : "success"
    });
  }

  if (input.canOpenSchoolTasks && input.taskCounts.schools != null) {
    items.push({
      key: "weekly_client_followups",
      title: "Client follow-ups",
      count: input.taskCounts.schools,
      summary: "School follow-ups, readiness questions, and client-facing work still in the weekly queue.",
      actionLabel: "Open Schools",
      hash: "#schools/tasks",
      tone: input.taskCounts.schools > 0 ? "info" : "success"
    });
  }

  if (input.canOpenSportsTasks && input.taskCounts.sports != null) {
    items.push({
      key: "weekly_sports_followthrough",
      title: "Sports follow-through",
      count: input.taskCounts.sports,
      summary: "Rosters, team questions, graphics, and release work that need sports follow-through.",
      actionLabel: "Open Sports",
      hash: "#sports/tasks",
      tone: input.taskCounts.sports > 0 ? "info" : "success"
    });
  }

  if (input.canOpenProjectTracking) {
    items.push({
      key: "release_projects",
      title: "Project milestones",
      count: businessJobs.length,
      summary: "Week-level jobs and milestones that still need owner follow-through.",
      actionLabel: "Open Project Tracking",
      hash: buildShellRouteHash("project-tracking"),
      tone: businessJobs.some((job) => job.tone === "action_needed") ? "danger" : businessJobs.length ? "warning" : "neutral"
    });
  }

  return items.slice(0, 8);
}

function buildDailyBriefing(input: {
  payload: HomeDashboardResponse | null;
  summaryCards: OperationalSummaryCard[];
  urgentItems: HomeUrgentWatchItem[];
  timeBand: HomeSurfaceTimeBand | null;
  attendanceAttentionMetric: ReturnType<typeof getAttendanceMetrics>[number] | null;
}) {
  const lines: string[] = [];
  const todayShoots = input.payload?.widgets.today_shoots ?? null;
  const urgentSummary = input.payload?.home_surface?.urgent_attention?.items.length
    ? input.payload.home_surface.urgent_attention.summary_line
    : null;
  const myDaySummary = input.payload?.home_surface?.my_day?.summary_line ?? null;
  const todayAndNextSummary = input.payload?.home_surface?.today_and_next_up?.summary_line ?? null;

  if (input.timeBand?.visible) {
    lines.push(`${getTimeClockHeadline(input.timeBand)}: ${input.timeBand.summary_line}`);
  }
  if (todayShoots) {
    lines.push(
      todayShoots.needs_attention_count > 0
        ? `${todayShoots.total} shoot${todayShoots.total === 1 ? "" : "s"} today, with ${todayShoots.needs_attention_count} needing readiness attention.`
        : `${todayShoots.total} shoot${todayShoots.total === 1 ? "" : "s"} today; no shoot readiness count is red right now.`
    );
  }
  if (input.attendanceAttentionMetric) {
    lines.push(`${input.attendanceAttentionMetric.count} expected team member${input.attendanceAttentionMetric.count === 1 ? "" : "s"} still need attendance follow-up.`);
  }
  if (input.urgentItems.length) {
    lines.push(urgentSummary || `${input.urgentItems.length} urgent item${input.urgentItems.length === 1 ? "" : "s"} need action now.`);
  }
  if (!input.urgentItems.length && todayAndNextSummary) {
    lines.push(todayAndNextSummary);
  }
  if (!input.urgentItems.length && !todayAndNextSummary && myDaySummary) {
    lines.push(myDaySummary);
  }
  if (!lines.length && input.summaryCards.length) {
    lines.push("Home is ready. Use the cards below to open the exact area that needs attention.");
  }
  return lines.slice(0, 4);
}

const DUE_THIS_WEEK_DEPARTMENT_LABELS: Record<JobDepartmentType, string> = {
  schools: "Schools",
  sports: "Sports",
  corporate: "Corporate",
  headshots: "Headshots",
  other: "Other"
};

const DUE_THIS_WEEK_COMPLETED_STATUSES = new Set<string>(["complete", "delivered", "cancelled"]);
const DUE_THIS_WEEK_RISK_SCORE: Record<string, number> = { critical: 40, high: 30, medium: 18, low: 8, none: 0 };
const DUE_THIS_WEEK_ROW_LIMIT = 12;

type DueThisWeekBadge = { label: string; tone: "neutral" | "info" | "warning" | "danger" };

type DueThisWeekRow = {
  id: string;
  title: string;
  departmentLabel: string;
  dueLabel: string;
  owner: string;
  stageLabel: string;
  tone: "neutral" | "warning" | "danger";
  badges: DueThisWeekBadge[];
  actionHash: string;
};

type DueThisWeekView = {
  rows: DueThisWeekRow[];
  total: number;
  departmentCounts: Array<{ key: string; label: string; count: number }>;
};

function endOfCurrentWeek(): number {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const end = new Date(now);
  end.setDate(now.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

function humanizeProductionLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function dueThisWeekHasOwner(item: SharedProductionQueueItem) {
  return Boolean(item.assigned_to_user_id || item.account_owner_user_id || item.department_owner_user_id);
}

function dueThisWeekRiskScore(item: SharedProductionQueueItem) {
  let score = 0;
  if (item.overdue_flag) {
    score += 100;
  }
  score += DUE_THIS_WEEK_RISK_SCORE[item.job_risk_status] ?? 0;
  if (item.job_readiness_status === "off_track") {
    score += 16;
  } else if (item.job_readiness_status === "at_risk") {
    score += 8;
  }
  if (item.blocker_count > 0 || item.status === "blocked" || item.health_state === "BLOCKED") {
    score += 24;
  }
  if (!dueThisWeekHasOwner(item)) {
    score += 18;
  }
  return score;
}

function dueThisWeekBadges(item: SharedProductionQueueItem): DueThisWeekBadge[] {
  const badges: DueThisWeekBadge[] = [];
  if (!dueThisWeekHasOwner(item)) {
    badges.push({ label: "No owner", tone: "danger" });
  }
  if (item.overdue_flag) {
    badges.push({ label: "Late", tone: "danger" });
  }
  const blocked = item.blocker_count > 0 || item.status === "blocked" || item.health_state === "BLOCKED";
  if (blocked) {
    badges.push({ label: "Blocked", tone: "danger" });
  } else if (
    item.job_risk_status === "high" ||
    item.job_risk_status === "critical" ||
    item.health_state === "AT_RISK" ||
    item.job_readiness_status === "off_track" ||
    item.job_readiness_status === "at_risk"
  ) {
    badges.push({ label: "At risk", tone: "warning" });
  }
  if (item.approval_status === "requested" || item.approval_status === "viewed" || item.approval_status === "overdue") {
    badges.push({ label: "Waiting on approval", tone: "warning" });
  }
  return badges.slice(0, 3);
}

function dueThisWeekRowTone(item: SharedProductionQueueItem): "neutral" | "warning" | "danger" {
  if (item.overdue_flag || item.blocker_count > 0 || item.status === "blocked" || item.health_state === "BLOCKED" || !dueThisWeekHasOwner(item)) {
    return "danger";
  }
  if (
    item.job_risk_status === "high" ||
    item.job_risk_status === "critical" ||
    item.health_state === "AT_RISK" ||
    item.job_readiness_status === "off_track" ||
    item.job_readiness_status === "at_risk"
  ) {
    return "warning";
  }
  return "neutral";
}

function dueThisWeekDueLabel(item: SharedProductionQueueItem) {
  if (!item.due_at) {
    return "No due date";
  }
  const due = new Date(item.due_at);
  if (Number.isNaN(due.getTime())) {
    return "No due date";
  }
  const label = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return item.overdue_flag ? `Late · ${label}` : `Due ${label}`;
}

function buildDueThisWeekView(items: SharedProductionQueueItem[]): DueThisWeekView {
  const cutoff = endOfCurrentWeek();
  const eligible = items.filter((item) => {
    if (item.completed_at || DUE_THIS_WEEK_COMPLETED_STATUSES.has(item.status)) {
      return false;
    }
    if (!item.due_at) {
      return false;
    }
    const due = new Date(item.due_at).getTime();
    return !Number.isNaN(due) && due <= cutoff;
  });

  const departmentMap = new Map<JobDepartmentType, number>();
  for (const item of eligible) {
    departmentMap.set(item.department_type, (departmentMap.get(item.department_type) ?? 0) + 1);
  }
  const departmentCounts = [...departmentMap.entries()]
    .map(([key, count]) => ({ key, label: DUE_THIS_WEEK_DEPARTMENT_LABELS[key] ?? humanizeProductionLabel(key), count }))
    .sort((left, right) => right.count - left.count);

  const rows = [...eligible]
    .sort((left, right) => {
      const score = dueThisWeekRiskScore(right) - dueThisWeekRiskScore(left);
      if (score !== 0) {
        return score;
      }
      const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue;
    })
    .slice(0, DUE_THIS_WEEK_ROW_LIMIT)
    .map((item) => ({
      id: item.id,
      title: item.job_title || item.title,
      departmentLabel: DUE_THIS_WEEK_DEPARTMENT_LABELS[item.department_type] ?? humanizeProductionLabel(item.department_type),
      dueLabel: dueThisWeekDueLabel(item),
      owner: item.assigned_to_name || item.account_owner_name || "Needs owner",
      stageLabel: humanizeProductionLabel(item.workflow_status || item.status),
      tone: dueThisWeekRowTone(item),
      badges: dueThisWeekBadges(item),
      actionHash: item.job_id ? `#jobs/detail?preview=${item.job_id}` : "#production-queue"
    }));

  return { rows, total: eligible.length, departmentCounts };
}

export function HomeCommandSurface({
  token,
  currentUser,
  socket,
  onOpenConcierge = () => undefined
}: Props) {
  const cacheKey = `${token}:${currentUser.id}`;
  const cachedDashboard = homeDashboardCache.get(cacheKey);
  const [dashboard, setDashboard] = useState<HomeDashboardResponse | null>(cachedDashboard?.payload ?? null);
  const [loading, setLoading] = useState(cachedDashboard == null);
  const [error, setError] = useState("");
  const [dueThisWeekItems, setDueThisWeekItems] = useState<SharedProductionQueueItem[]>([]);

  const canOpenSchedule = canAccessRoute(currentUser, "dashboard-my-schedule");
  const canOpenAlerts = canAccessRoute(currentUser, "dashboard-alerts");
  const canOpenAttendance = canAccessRoute(currentUser, "operations-attendance");
  const canOpenNeedsAttention = canAccessRoute(currentUser, "people-ops-compliance");
  const canOpenToday = canAccessRoute(currentUser, "operations-today");
  const canOpenStaffing = canAccessRoute(currentUser, "operations-staffing");
  const canOpenPhotography = canAccessRoute(currentUser, "studios");
  const canOpenProjectTracking = canAccessRoute(currentUser, "project-tracking");
  const canOpenProductionQueue = canAccessRoute(currentUser, "production") || canAccessRoute(currentUser, "production-workload");
  const canOpenSchoolTasks = canAccessRoute(currentUser, "operations-schools");
  const canOpenSportsTasks = canAccessRoute(currentUser, "sports");
  const canOpenProductionTasks = canAccessRoute(currentUser, "production-workload");
  const taskCounts = dashboard?.widgets.department_task_counts ?? EMPTY_TASK_COUNTS;

  async function loadHome(options: { quiet?: boolean; force?: boolean } = {}) {
    const quiet = options.quiet ?? false;
    const dashboardEntry = homeDashboardCache.get(cacheKey);
    const needsDashboard = options.force || !dashboardEntry || !isCacheFresh(dashboardEntry.loadedAt, HOME_CACHE_TTL_MS);

    if (!quiet && dashboard == null) {
      setLoading(true);
    }

    try {
      const dashboardPayload = needsDashboard ? await getHomeDashboard(token, "app") : dashboardEntry?.payload ?? dashboard;

      if (dashboardPayload) {
        setDashboard(dashboardPayload);
        homeDashboardCache.set(cacheKey, { payload: dashboardPayload, loadedAt: Date.now() });
      }
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load Home right now.");
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const dashboardEntry = homeDashboardCache.get(cacheKey);
    const dashboardFresh = dashboardEntry ? isCacheFresh(dashboardEntry.loadedAt, HOME_CACHE_TTL_MS) : false;

    setDashboard(dashboardEntry?.payload ?? null);

    if (dashboardFresh) {
      setDashboard(dashboardEntry?.payload ?? null);
      setLoading(false);
      return;
    }

    void loadHome({ quiet: dashboardFresh });
  }, [cacheKey, token]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadHome({ quiet: true, force: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [cacheKey, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onRefresh = () => {
      void loadHome({ quiet: true, force: true });
    };

    socket.on("schedule_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    socket.on("attendance_changed", onRefresh);

    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("notification_created", onRefresh);
      socket.off("attendance_changed", onRefresh);
    };
  }, [cacheKey, socket, token]);

  // Due This Week / Not Done reads the existing production queue. It is resilient by
  // design: any failure (permissions, empty data) simply hides the widget so the
  // dashboard never destabilizes.
  useEffect(() => {
    if (!canOpenProjectTracking && !canOpenProductionQueue) {
      setDueThisWeekItems([]);
      return;
    }
    let cancelled = false;
    void listSharedProductionQueue(token, {})
      .then((response) => {
        if (!cancelled) {
          setDueThisWeekItems(response.items ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDueThisWeekItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, canOpenProjectTracking, canOpenProductionQueue]);

  const timeBand = dashboard?.home_surface?.time_band ?? null;
  const attendanceMetrics = useMemo(() => getAttendanceMetrics(dashboard?.home_surface?.staffing_band ?? null), [dashboard]);
  const attendanceAttentionMetric = attendanceMetrics.find((metric) => metric.id === "assigned_but_missing" && metric.count > 0) ?? null;
  const myDay = dashboard?.home_surface?.my_day ?? null;
  const myDayItems = myDay?.visible ? myDay.items : [];
  const businessPulseTiles = dashboard?.widgets.business_pulse.tiles ?? [];
  const dueThisWeek = useMemo(() => buildDueThisWeekView(dueThisWeekItems), [dueThisWeekItems]);
  const summaryCards = useMemo(
    () =>
      buildSummaryCards({
        payload: dashboard,
        taskCounts,
        canOpenToday,
        canOpenStaffing,
        canOpenSchoolTasks,
        canOpenSportsTasks,
        canOpenProductionTasks,
        canOpenProductionQueue
      }),
    [canOpenProductionQueue, canOpenProductionTasks, canOpenSchoolTasks, canOpenSportsTasks, canOpenStaffing, canOpenToday, dashboard, taskCounts]
  );
  const dashboardUrgentItems = useMemo(
    () => dashboard?.home_surface?.urgent_attention?.visible
      ? dashboard.home_surface.urgent_attention.items
      : [],
    [dashboard]
  );
  const workflowUrgentItems = useMemo(
    () => buildHomeUrgentItemsFromWorkflowChangeNotices(getWorkflowChangeNoticesForUser(currentUser, { includeAcknowledged: false })),
    [currentUser]
  );
  const urgentItems = useMemo(() => [...workflowUrgentItems, ...dashboardUrgentItems].slice(0, 4), [dashboardUrgentItems, workflowUrgentItems]);
  const briefingCards = useMemo(
    () => [
      ...summaryCards.filter((card) => ["shoots_today", "staffing_gaps", "school_tasks", "sports_tasks"].includes(card.key)),
      buildUrgentBriefingCard({ urgentItems, canOpenNeedsAttention, canOpenAlerts })
    ],
    [canOpenAlerts, canOpenNeedsAttention, summaryCards, urgentItems]
  );
  const weeklyOperationalPriorityItems = useMemo(
    () =>
      buildWeeklyOperationalPriorityItems({
        payload: dashboard,
        taskCounts,
        canOpenStaffing,
        canOpenSchoolTasks,
        canOpenSportsTasks,
        canOpenPhotography,
        canOpenProductionQueue,
        canOpenProjectTracking
      }),
    [canOpenPhotography, canOpenProductionQueue, canOpenProjectTracking, canOpenSchoolTasks, canOpenSportsTasks, canOpenStaffing, dashboard, taskCounts]
  );
  const briefingLines = useMemo(
    () =>
      buildDailyBriefing({
        payload: dashboard,
        summaryCards,
        urgentItems,
        timeBand,
        attendanceAttentionMetric
      }),
    [attendanceAttentionMetric, dashboard, summaryCards, timeBand, urgentItems]
  );
  const [conciergeQuery, setConciergeQuery] = useState("");
  const updatedLabel = dashboard ? `Updated ${formatHomeTimestamp(dashboard.generated_at)}` : null;
  const primaryClockActionLabel = timeBand?.visible ? getTimeClockActionLabel(timeBand) : "Clock In";
  const primaryClockActionHash = timeBand?.visible ? timeBand.action_hash : buildShellRouteHash("dashboard-my-day");

  function submitConciergeSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onOpenConcierge(conciergeQuery.trim());
  }

  if (loading && dashboard == null) {
    return (
      <WorkspaceLoadingBlock
        title="Loading My Dashboard"
        summary="Pulling today's work, alerts, schedule, time clock status, and staffing visibility into one operational surface."
      />
    );
  }

  return (
    <section className="home-operational">
      <WorkspacePageHeader
        title="My Dashboard"
        summary="Daily operating view for today's schedule, staffing gaps, urgent issues, and department task counts."
        compact
        className="home-operational__header"
        actions={
          <div className="home-operational__header-actions">
            <form className="home-operational__search-launcher" onSubmit={submitConciergeSearch}>
              <span className="home-operational__search-label">Concierge</span>
              <div className="home-operational__search-input-row">
                <input
                  type="search"
                  value={conciergeQuery}
                  onChange={(event) => setConciergeQuery(event.currentTarget.value)}
                  placeholder="Ask Concierge Anything..."
                  aria-label="Ask Concierge Anything"
                />
                <button type="submit" className="secondary-button">
                  Ask
                </button>
              </div>
              <span>{updatedLabel ?? "Type a question or search, then press Ask."}</span>
            </form>
            <button
              type="button"
              className="primary-button home-operational__primary-clock-action"
              onClick={() => navigateToHash(primaryClockActionHash)}
              title={timeBand?.visible ? undefined : "Open My Work for the demo-safe clock-in path."}
            >
              {primaryClockActionLabel}
            </button>
          </div>
        }
      />

      {error ? <div className="error-banner">{error}</div> : null}

      {briefingLines.length ? (
        <section className="panel home-operational__briefing-panel">
          <WorkspaceSectionHeader title="Today's Briefing" compact />
          {briefingLines.length ? (
            <div className="home-operational__briefing-list">
              {briefingLines.slice(0, 2).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          <div className="home-operational__briefing-grid" aria-label="Today's briefing actions">
            {briefingCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={`home-operational__summary-card home-operational__summary-card--briefing home-operational__summary-card--metric home-operational__summary-card--${card.key === "urgent_issues" ? "urgent-briefing " : ""}home-operational__summary-card--${card.tone}`}
                onClick={() => navigateToHash(card.hash)}
                title={card.explanation}
              >
                <span>{getBriefingCardLabel(card)}</span>
                {card.key === "urgent_issues" ? null : <strong>{card.count}</strong>}
                <em>{card.actionLabel}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <MissionControlAssistant token={token} />

      {myDayItems.length ? (
        <section className="panel home-operational__myday-panel">
          <WorkspaceSectionHeader
            title="My Work Today"
            summary={myDay?.summary_line || "Your assignments for today, with where to go and what to do next."}
            compact
            actions={
              <div className="home-operational__myday-actions">
                {myDay?.next_shift_label ? <span className="home-operational__myday-next">{myDay.next_shift_label}</span> : null}
                <button type="button" className="secondary-button" onClick={() => navigateToHash("#my-work")}>
                  Open full My Work
                </button>
              </div>
            }
          />
          <div className="home-operational__myday-list">
            {myDayItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`home-operational__myday-card home-operational__myday-card--${mapTone(item.tone)}`}
                onClick={() => navigateToHash(item.action_hash)}
              >
                <div className="home-operational__myday-card__top">
                  <strong>{item.title}</strong>
                  {item.status_label ? <span>{item.status_label}</span> : null}
                </div>
                {[item.time_label, item.location_label, item.role_label].filter(Boolean).length ? (
                  <p className="home-operational__myday-card__meta">
                    {[item.time_label, item.location_label, item.role_label].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {item.summary ? <p>{item.summary}</p> : null}
                {item.next_action ? <em>{item.next_action}</em> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="home-operational__top-grid">
        {timeBand?.visible ? (
          <section className={`panel home-operational__clock-panel home-operational__clock-panel--${getTimeClockTone(timeBand)}`}>
            <WorkspaceSectionHeader title="Time Clock" summary={timeBand.summary_line} compact />
            <div className="home-operational__clock-grid">
              <div className="home-operational__clock-stat">
                <span>Status</span>
                <strong>{getTimeClockHeadline(timeBand)}</strong>
                <p>{timeBand.elapsed_label ?? timeBand.label}</p>
              </div>
              <div className="home-operational__clock-stat">
                <span>Current context</span>
                <strong>{timeBand.shift_label ?? "No scheduled shift in view"}</strong>
                <p>{timeBand.location_label ?? "Open your schedule for assignment details."}</p>
              </div>
            </div>
            <WorkspaceActionBar align="end" compact>
              <button type="button" onClick={() => navigateToHash(timeBand.action_hash)}>
                {getTimeClockActionLabel(timeBand)}
              </button>
              {timeBand.schedule_hash ? (
                <button type="button" className="secondary-button" onClick={() => navigateToHash(timeBand.schedule_hash!)}>
                  View Schedule
                </button>
              ) : canOpenSchedule ? (
                <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("dashboard-my-schedule"))}>
                  View Schedule
                </button>
              ) : null}
            </WorkspaceActionBar>
          </section>
        ) : null}

        {attendanceAttentionMetric ? (
          <section className="panel home-operational__attendance-panel home-operational__attendance-panel--compact" aria-label="Attendance health">
            <WorkspaceSectionHeader
              title="Attendance needs attention"
              summary="Someone expected for today's work has not checked in yet."
              compact
              actions={
                canOpenAttendance ? (
                  <button type="button" className="secondary-button" onClick={() => navigateToHash(buildShellRouteHash("operations-attendance"))}>
                    Open Attendance
                  </button>
                ) : null
              }
            />
            <button
              type="button"
              className={`home-operational__attendance-card home-operational__attendance-card--${attendanceAttentionMetric.tone}`}
              onClick={() => navigateToHash(attendanceAttentionMetric.action_hash)}
            >
              <span>{attendanceAttentionMetric.label}</span>
              <strong>{attendanceAttentionMetric.count}</strong>
              <p>{attendanceAttentionMetric.detail}</p>
            </button>
          </section>
        ) : null}
      </div>

      {businessPulseTiles.length ? (
        <section className="panel home-operational__pulse-panel">
          <WorkspaceSectionHeader
            title="Studio Pulse"
            summary="How busy the studio is this week — shooting, processing, and what is piling up."
            compact
          />
          <div className="home-operational__pulse-grid">
            {businessPulseTiles.map((tile) => (
              <article key={tile.id} className={`home-operational__pulse-tile home-operational__pulse-tile--${mapTone(tile.tone)}`}>
                <span>{tile.label}</span>
                <strong>{tile.value}</strong>
                {tile.context_label ? <p>{tile.context_label}</p> : null}
                {tile.trend_label ? <small>{tile.trend_label}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {weeklyOperationalPriorityItems.length ? (
        <section className="panel home-operational__weekly-panel home-operational__weekly-panel--priorities">
          <WorkspaceSectionHeader
            title="This Week's Operational Priorities"
            summary="What is due this week and still needs to get done, ordered by risk."
            compact
          />
          <div className="home-operational__weekly-list home-operational__weekly-list--priorities">
            {weeklyOperationalPriorityItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`home-operational__weekly-card home-operational__weekly-card--${item.tone}`}
                onClick={() => navigateToHash(item.hash)}
              >
                <span>{item.title}</span>
                <strong>{item.count}</strong>
                <p>{item.summary}</p>
                <em>{item.actionLabel}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {dueThisWeek.rows.length ? (
        <section className="panel home-operational__dueweek-panel">
          <WorkspaceSectionHeader
            title="Due This Week / Not Done"
            summary="Work due this week that isn't finished yet — grouped by department, most at-risk first."
            compact
            actions={
              canOpenProductionQueue ? (
                <button type="button" className="secondary-button" onClick={() => navigateToHash("#production-queue")}>
                  View all
                </button>
              ) : null
            }
          />
          <div className="home-operational__dueweek-chips" aria-label="Due this week by department">
            {dueThisWeek.departmentCounts.map((department) => (
              <span key={department.key} className="home-operational__dueweek-chip">
                {department.label} · {department.count}
              </span>
            ))}
          </div>
          <div className="home-operational__dueweek-list">
            {dueThisWeek.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`home-operational__dueweek-row home-operational__dueweek-row--${row.tone}`}
                onClick={() => navigateToHash(row.actionHash)}
              >
                <span className="home-operational__dueweek-row__main">
                  <strong>{row.title}</strong>
                  <small>{row.departmentLabel} · {row.dueLabel} · {row.owner}</small>
                  <small className="home-operational__dueweek-row__stage">Stage: {row.stageLabel}</small>
                </span>
                {row.badges.length ? (
                  <span className="home-operational__dueweek-row__badges">
                    {row.badges.map((badge) => (
                      <span key={badge.label} className={`home-operational__dueweek-badge home-operational__dueweek-badge--${badge.tone}`}>
                        {badge.label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {dueThisWeek.total > dueThisWeek.rows.length ? (
            <div className="home-operational__dueweek-more">
              {dueThisWeek.total - dueThisWeek.rows.length} more due this week — open Production Queue for the full list.
            </div>
          ) : null}
        </section>
      ) : null}

    </section>
  );
}
