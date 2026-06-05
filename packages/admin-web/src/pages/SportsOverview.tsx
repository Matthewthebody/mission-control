import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import { buildSharedJobHash } from "../components/jobs/sharedJobRouting";
import { JobIntakeLauncherCard } from "../components/jobIntake/JobIntakeLauncherCard";
import { QuickCreateJobDrawer } from "../components/jobIntake/QuickCreateJobDrawer";
import { ResumeDraftsDrawer } from "../components/jobIntake/ResumeDraftsDrawer";
import { SmartPasteJobDrawer } from "../components/jobIntake/SmartPasteJobDrawer";
import { DepartmentDashboardPanel } from "../components/jobs/SharedJobCommandCenter";
import { TodayOperationsBoard } from "../components/jobs/SharedJobOperations";
import { DepartmentProductionOverviewPanel } from "../components/jobs/SharedJobProduction";
import { ProjectTrackingDepartmentQueue } from "../components/projectTracking/ProjectTrackingDepartmentQueue";
import {
  formatDate,
  KpiStatCard,
  OverviewListCard,
  SavedViewBar,
  StatusPill,
  humanizeToken,
  useHashRouteSnapshot
} from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { CreateWorkLauncherPanel } from "../components/workspace/CreateWorkLauncherPanel";
import { CompactActiveWorkPanel } from "../components/workspace/CompactActiveWorkPanel";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import { featureFlags } from "../featureFlags";
import type {
  SharedDashboardResponse,
  SharedExceptionListItem,
  SharedJobListItem,
  SharedProductionQueueItem
} from "../jobTruthTypes";
import { canCreateShootRecords, getSportsWorkspaceAccessScope } from "../permissions";
import { getSharedDashboard, listSharedExceptions, listSharedJobs } from "../services/jobsApi";
import { getSportsOverview, listSportsPeerQaBoard } from "../services/sportsApi";
import { listSharedTasks } from "../services/tasksApi";
import type { SportsOverviewListItem, SportsOverviewResponse, SportsPeerQaBoardResponse } from "../sportsTypes";
import type { SessionUser } from "../types";
import type { SharedTaskListItem } from "../workModelTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type SourceErrors = {
  overview: string;
  jobs: string;
  tasks: string;
  exceptions: string;
  dashboard: string;
  peerQa: string;
};

const EMPTY_ERRORS: SourceErrors = {
  overview: "",
  jobs: "",
  tasks: "",
  exceptions: "",
  dashboard: "",
  peerQa: ""
};

type SportsOperatingBoardRow = {
  id: string;
  jobId: string;
  accountLabel: string;
  contactLabel: string;
  jobTypeLabel: string;
  dateLabel: string;
  statusLabel: string;
  statusDetail: string;
  nextAction: string;
  ownerLabel: string;
  riskLabel: string;
  riskTone: "success" | "info" | "warning" | "danger";
  taskCount: number;
  exceptionCount: number;
  proofApproval: boolean;
  clientInfoIssue: boolean;
  staffingIssue: boolean;
  productionIssue: boolean;
  productionAttention: boolean;
  jobHash: string;
  accountHash: string | null;
  productionHash: string | null;
  exceptionsHash: string | null;
};

const SPORTS_OPERATING_BOARD_ROW_LIMIT = 14;

function groupByJobId<T>(items: T[], getJobId: (item: T) => string | null | undefined) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const jobId = getJobId(item);
    if (!jobId) {
      continue;
    }
    grouped.set(jobId, [...(grouped.get(jobId) ?? []), item]);
  }
  return grouped;
}

function filterItems(items: SportsOverviewListItem[], query: string) {
  if (!query.trim()) {
    return items;
  }
  const normalized = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(normalized) ||
      item.summary.toLowerCase().includes(normalized) ||
      (item.meta ?? "").toLowerCase().includes(normalized)
  );
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : error instanceof Error && error.message ? error.message : fallback;
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isBeforeToday(value: string | null | undefined) {
  const parsed = parseDate(value);
  return parsed ? parsed.getTime() < startOfToday().getTime() : false;
}

function isWithinNextSevenDays(value: string | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) {
    return false;
  }
  const diffDays = (parsed.getTime() - startOfToday().getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

function dueDateForSportsJob(job: SharedJobListItem) {
  return job.production_deadline_at ?? job.client_deadline_at ?? job.primary_day_date ?? job.scheduled_start_at;
}

function boardDateLabel(job: SharedJobListItem) {
  return formatDate(job.primary_day_date ?? job.scheduled_start_at ?? job.client_deadline_at ?? job.production_deadline_at);
}

function hasSportsProofApproval(job: SharedJobListItem, workflowItems: SharedProductionQueueItem[]) {
  const proofStatus = (job.proof_status ?? "").toLowerCase();
  return (
    proofStatus === "requested" ||
    proofStatus === "overdue" ||
    proofStatus === "revisions_requested" ||
    job.production_status === "awaiting_approval" ||
    job.production_status === "proof_sent" ||
    workflowItems.some((item) => item.proof_required || item.approval_required || item.overdue_approval_count > 0 || item.approval_status === "overdue")
  );
}

function hasSportsClientInfoIssue(job: SharedJobListItem, exceptions: SharedExceptionListItem[]) {
  return (
    !job.primary_contact_id ||
    !job.primary_contact_name ||
    exceptions.some((item) => {
      const haystack = `${item.flag_type} ${item.title} ${item.description ?? ""}`.toLowerCase();
      return haystack.includes("client") || haystack.includes("contact") || haystack.includes("team") || haystack.includes("missing");
    })
  );
}

function hasSportsStaffingIssue(job: SharedJobListItem, exceptions: SharedExceptionListItem[]) {
  return (
    job.staffing_status === "unassigned" ||
    job.staffing_status === "partially_staffed" ||
    job.staffing_status === "gap_flagged" ||
    exceptions.some((item) => item.flag_type.toLowerCase().includes("staff"))
  );
}

function hasSportsProductionIssue(job: SharedJobListItem, workflowItems: SharedProductionQueueItem[]) {
  return (
    job.production_status === "blocked" ||
    workflowItems.some((item) => item.blocking_issue_count > 0 || Boolean(item.blocked_reason) || item.health_state === "BLOCKED" || item.health_state === "OVERDUE")
  );
}

function sportsRiskForRow(job: SharedJobListItem, exceptions: SharedExceptionListItem[], workflowItems: SharedProductionQueueItem[]) {
  if (
    job.risk_status === "critical" ||
    job.blocker_count > 0 ||
    job.open_watch_flag_count > 0 ||
    hasSportsProductionIssue(job, workflowItems) ||
    exceptions.some((item) => item.severity === "critical")
  ) {
    return { label: "Critical", tone: "danger" as const };
  }
  if (
    job.risk_status === "high" ||
    isBeforeToday(job.client_deadline_at) ||
    isBeforeToday(job.production_deadline_at) ||
    exceptions.some((item) => item.severity === "high")
  ) {
    return { label: "High / overdue", tone: "danger" as const };
  }
  if (job.readiness_status === "at_risk" || job.readiness_status === "off_track" || job.risk_status === "medium") {
    return { label: "Needs attention", tone: "warning" as const };
  }
  if (job.job_status === "ready_to_execute" || job.readiness_status === "ready") {
    return { label: "Ready", tone: "success" as const };
  }
  return { label: "On watch", tone: "info" as const };
}

function nextActionForSportsRow(
  job: SharedJobListItem,
  tasksForJob: SharedTaskListItem[],
  exceptionsForJob: SharedExceptionListItem[],
  workflowItems: SharedProductionQueueItem[]
) {
  const urgentException = exceptionsForJob.find((item) => item.status === "open");
  if (urgentException?.next_action_label) {
    return urgentException.next_action_label;
  }
  if (hasSportsClientInfoIssue(job, exceptionsForJob)) {
    return "Confirm account, contact, or team info before the next milestone.";
  }
  if (hasSportsStaffingIssue(job, exceptionsForJob)) {
    return "Resolve staffing or lead coverage before game-day work.";
  }
  if (hasSportsProofApproval(job, workflowItems)) {
    return "Follow up on proof approval without mixing it into staffing.";
  }
  if (hasSportsProductionIssue(job, workflowItems)) {
    return "Unblock production or graphics before delivery slips.";
  }
  const openTask = tasksForJob.find((task) => task.status !== "completed");
  if (openTask) {
    return openTask.title;
  }
  return "Open the job and confirm the next operational milestone.";
}

function buildSportsOperatingBoardRows(
  jobs: SharedJobListItem[],
  tasks: SharedTaskListItem[],
  exceptions: SharedExceptionListItem[],
  workflowItems: SharedProductionQueueItem[]
) {
  const tasksByJob = groupByJobId(tasks, (task) => task.related_job_id);
  const exceptionsByJob = groupByJobId(exceptions, (item) => item.job_id);
  const workflowByJob = groupByJobId(workflowItems, (item) => item.job_id);

  return jobs
    .map((job) => {
      const tasksForJob = tasksByJob.get(job.id) ?? [];
      const exceptionsForJob = exceptionsByJob.get(job.id) ?? [];
      const workflowForJob = workflowByJob.get(job.id) ?? [];
      const risk = sportsRiskForRow(job, exceptionsForJob, workflowForJob);
      const proofApproval = hasSportsProofApproval(job, workflowForJob);
      const clientInfoIssue = hasSportsClientInfoIssue(job, exceptionsForJob);
      const staffingIssue = hasSportsStaffingIssue(job, exceptionsForJob);
      const productionIssue = hasSportsProductionIssue(job, workflowForJob);
      const productionAttention = productionIssue || job.production_required || workflowForJob.length > 0 || job.production_status !== "not_created";
      const workflowItemId = workflowForJob[0]?.id;

      return {
        id: job.id,
        jobId: job.id,
        accountLabel: job.organization_name ?? "Sports account pending",
        contactLabel: job.primary_contact_name ?? "Contact pending",
        jobTypeLabel: humanizeToken(job.job_category),
        dateLabel: boardDateLabel(job),
        statusLabel: humanizeToken(job.job_status),
        statusDetail: `${humanizeToken(job.readiness_status)} | ${humanizeToken(job.production_status)}`,
        nextAction: nextActionForSportsRow(job, tasksForJob, exceptionsForJob, workflowForJob),
        ownerLabel: job.lead_owner_name ?? job.account_owner_name ?? tasksForJob[0]?.assigned_to_name ?? exceptionsForJob[0]?.owner_name ?? "Unassigned",
        riskLabel: risk.label,
        riskTone: risk.tone,
        taskCount: tasksForJob.length,
        exceptionCount: exceptionsForJob.length,
        proofApproval,
        clientInfoIssue,
        staffingIssue,
        productionIssue,
        productionAttention,
        jobHash: buildSharedJobHash("#sports/jobs", job.id),
        accountHash: job.organization_id ? `#sports/accounts?organization=${encodeURIComponent(job.organization_id)}` : null,
        productionHash: productionAttention
          ? workflowItemId
            ? `#sports/graphics?item=${encodeURIComponent(workflowItemId)}`
            : "#sports/graphics"
          : null,
        exceptionsHash: exceptionsForJob.length ? "#sports/exceptions" : null
      } satisfies SportsOperatingBoardRow;
    })
    .sort((a, b) => {
      const toneRank = { danger: 0, warning: 1, info: 2, success: 3 };
      const toneDelta = toneRank[a.riskTone] - toneRank[b.riskTone];
      if (toneDelta !== 0) {
        return toneDelta;
      }
      return a.dateLabel.localeCompare(b.dateLabel);
    });
}

function toneForJob(job: SharedJobListItem): SportsOverviewListItem["tone"] {
  if (job.blocker_count > 0 || job.open_watch_flag_count > 0 || isBeforeToday(job.client_deadline_at) || isBeforeToday(job.production_deadline_at)) {
    return "danger";
  }
  if (job.risk_status === "high" || job.risk_status === "critical" || job.readiness_status === "at_risk" || job.readiness_status === "off_track") {
    return "warning";
  }
  if (job.job_status === "in_progress" || job.job_status === "ready_to_execute") {
    return "info";
  }
  return "success";
}

function toneForTask(task: SharedTaskListItem): SportsOverviewListItem["tone"] {
  if (task.status !== "completed" && isBeforeToday(task.due_at)) {
    return "danger";
  }
  if (task.priority === "urgent" || task.priority === "high") {
    return "warning";
  }
  if (task.status === "completed") {
    return "success";
  }
  return "info";
}

function toneForException(item: SharedExceptionListItem): SportsOverviewListItem["tone"] {
  if (item.severity === "critical" || item.severity === "high") {
    return "danger";
  }
  if (item.status === "open") {
    return "warning";
  }
  return "info";
}

function toneForWorkflowItem(item: SharedProductionQueueItem): SportsOverviewListItem["tone"] {
  if (item.blocking_issue_count > 0 || item.blocked_reason || item.health_state === "BLOCKED" || item.health_state === "OVERDUE") {
    return "danger";
  }
  if (item.overdue_approval_count > 0 || item.health_state === "AT_RISK" || item.approval_status === "overdue") {
    return "warning";
  }
  return "info";
}

function toJobCard(job: SharedJobListItem): SportsOverviewListItem {
  return {
    id: job.id,
    title: job.title,
    summary: `${job.organization_name ?? "Sports account"} | ${humanizeToken(job.job_status)} | owner ${job.lead_owner_name ?? job.account_owner_name ?? "unassigned"}`,
    tone: toneForJob(job),
    action_hash: buildSharedJobHash("#sports/jobs", job.id),
    organization_id: job.organization_id,
    due_at: job.production_deadline_at ?? job.client_deadline_at ?? job.scheduled_start_at,
    meta: [job.job_number ?? "Draft", humanizeToken(job.readiness_status)].join(" | ")
  };
}

function toTaskCard(task: SharedTaskListItem): SportsOverviewListItem {
  return {
    id: task.id,
    title: task.title,
    summary: `${task.related_job_title ?? "No linked job"} | ${task.assigned_to_name ?? "Unassigned"} | ${humanizeToken(task.status)}`,
    tone: toneForTask(task),
    action_hash: `#tasks/${task.id}`,
    due_at: task.due_at,
    meta: [task.task_number, task.organization_name ?? "Sports"].filter(Boolean).join(" | ")
  };
}

function toExceptionCard(item: SharedExceptionListItem): SportsOverviewListItem {
  return {
    id: item.id,
    title: item.title,
    summary: item.next_action_label ?? item.description ?? "Sports exception needs follow-through.",
    tone: toneForException(item),
    action_hash: item.job_id ? buildSharedJobHash("#sports/jobs", item.job_id) : "#sports/exceptions",
    organization_id: item.organization_id,
    due_at: item.due_at,
    meta: [item.organization_name ?? "Sports", item.owner_name ?? "Unassigned"].join(" | ")
  };
}

function toWorkflowCard(item: SharedProductionQueueItem): SportsOverviewListItem {
  return {
    id: item.id,
    title: item.title,
    summary: `${item.organization_name ?? "Sports account"} | ${humanizeToken(item.workflow_status)} | ${item.assigned_to_name ?? "Unassigned"}`,
    tone: toneForWorkflowItem(item),
    action_hash: `#sports/graphics?item=${encodeURIComponent(item.id)}`,
    organization_id: item.organization_id,
    due_at: item.due_at,
    meta: [humanizeToken(item.production_type), item.blocked_reason ?? humanizeToken(item.health_state)].join(" | ")
  };
}

export function SportsOverview({ token, currentUser }: Props) {
  const { params } = useHashRouteSnapshot();
  const [overview, setOverview] = useState<SportsOverviewResponse | null>(null);
  const [jobs, setJobs] = useState<SharedJobListItem[]>([]);
  const [tasks, setTasks] = useState<SharedTaskListItem[]>([]);
  const [exceptions, setExceptions] = useState<SharedExceptionListItem[]>([]);
  const [dashboard, setDashboard] = useState<SharedDashboardResponse | null>(null);
  const [peerQaBoard, setPeerQaBoard] = useState<SportsPeerQaBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<SourceErrors>(EMPTY_ERRORS);
  const [search, setSearch] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [smartPasteOpen, setSmartPasteOpen] = useState(false);
  const [resumeDraftsOpen, setResumeDraftsOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);

  const savedView = params.get("saved_view");
  const canCreate = canCreateShootRecords(currentUser);
  const accessScope = getSportsWorkspaceAccessScope(currentUser);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrors(EMPTY_ERRORS);

    void Promise.allSettled([
      getSportsOverview(token, savedView),
      listSharedJobs(token, { department_type: "sports" }),
      listSharedTasks(token, { department_type: "sports", limit: 200 }),
      listSharedExceptions(token, { department_type: "sports", limit: 100, only_mine: accessScope === "own" }),
      getSharedDashboard(token, "home", "sports"),
      listSportsPeerQaBoard(token)
    ]).then((results) => {
      if (cancelled) {
        return;
      }

      const nextErrors: SourceErrors = { ...EMPTY_ERRORS };

      if (results[0].status === "fulfilled") {
        setOverview(results[0].value);
      } else {
        setOverview(null);
        nextErrors.overview = messageFor(results[0].reason, "We couldn't load Sports right now.");
      }

      if (results[1].status === "fulfilled") {
        setJobs(results[1].value.jobs);
      } else {
        setJobs([]);
        nextErrors.jobs = messageFor(results[1].reason, "We couldn't load sports jobs.");
      }

      if (results[2].status === "fulfilled") {
        setTasks(results[2].value.items);
      } else {
        setTasks([]);
        nextErrors.tasks = messageFor(results[2].reason, "We couldn't load sports tasks.");
      }

      if (results[3].status === "fulfilled") {
        setExceptions(results[3].value.items);
      } else {
        setExceptions([]);
        nextErrors.exceptions = messageFor(results[3].reason, "We couldn't load the sports exceptions queue.");
      }

      if (results[4].status === "fulfilled") {
        setDashboard(results[4].value);
      } else {
        setDashboard(null);
        nextErrors.dashboard = messageFor(results[4].reason, "We couldn't load the sports workflow summary.");
      }

      if (results[5].status === "fulfilled") {
        setPeerQaBoard(results[5].value);
      } else {
        setPeerQaBoard(null);
        nextErrors.peerQa = messageFor(results[5].reason, "We couldn't load the sports peer QA board.");
      }

      setErrors(nextErrors);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [accessScope, savedView, token]);

  const filteredSportsReadModels = useMemo(() => {
    if (!overview) {
      return null;
    }
    return {
      upcoming_shoots: filterItems(overview.upcoming_shoots, search),
      staffing_readiness: filterItems(overview.staffing_readiness, search),
      ready_pings: filterItems(overview.ready_pings, search),
      proof_and_products: filterItems(overview.proof_and_products, search),
      account_health: filterItems(overview.account_health, search),
      recent_activity: filterItems(overview.recent_activity, search)
    };
  }, [overview, search]);

  const sharedJobs = useMemo(() => jobs.filter((job) => job.department_type === "sports"), [jobs]);
  const sharedJobCards = useMemo(() => sharedJobs.slice(0, 6).map(toJobCard), [sharedJobs]);
  const sharedTaskCards = useMemo(() => tasks.slice(0, 6).map(toTaskCard), [tasks]);
  const sharedExceptionCards = useMemo(() => exceptions.slice(0, 6).map(toExceptionCard), [exceptions]);
  const sharedWorkflowItems = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...(dashboard?.blocked_production ?? []),
            ...(dashboard?.overdue_approvals ?? []),
            ...(dashboard?.delivery_risks ?? [])
          ].map((item) => [item.id, item])
        ).values()
      ),
    [dashboard?.blocked_production, dashboard?.delivery_risks, dashboard?.overdue_approvals]
  );
  const sharedWorkflowCards = useMemo(() => {
    return sharedWorkflowItems.slice(0, 6).map(toWorkflowCard);
  }, [sharedWorkflowItems]);
  const sportsOperatingRows = useMemo(
    () => buildSportsOperatingBoardRows(sharedJobs, tasks, exceptions, sharedWorkflowItems).slice(0, SPORTS_OPERATING_BOARD_ROW_LIMIT),
    [exceptions, sharedJobs, sharedWorkflowItems, tasks]
  );
  const sportsBoardIssueCounts = useMemo(
    () => ({
      proofApprovals: sportsOperatingRows.filter((row) => row.proofApproval).length,
      clientInfo: sportsOperatingRows.filter((row) => row.clientInfoIssue).length,
      staffing: sportsOperatingRows.filter((row) => row.staffingIssue).length,
      production: sportsOperatingRows.filter((row) => row.productionIssue).length,
      exceptions: sportsOperatingRows.reduce((sum, row) => sum + row.exceptionCount, 0),
      tasks: sportsOperatingRows.reduce((sum, row) => sum + row.taskCount, 0)
    }),
    [sportsOperatingRows]
  );
  const sportsCommandSummaryCards = useMemo(
    () => [
      {
        label: "Active Sports Work",
        value: sportsOperatingRows.length,
        detail: "Open sports jobs in the current command view.",
        hash: "#sports/jobs"
      },
      {
        label: "Photo Days / Events",
        value: overview?.upcoming_shoots.length ?? sharedJobs.filter((job) => Boolean(job.primary_day_date || job.scheduled_start_at)).length,
        detail: "Upcoming shoots and sports events already visible from existing data.",
        hash: "#sports/jobs"
      },
      {
        label: "Due Soon",
        value: sharedJobs.filter((job) => isWithinNextSevenDays(dueDateForSportsJob(job))).length,
        detail: "Sports work with a date or deadline inside the next seven days.",
        hash: "#sports/jobs"
      },
      {
        label: "Blocked / Needs Review",
        value: sportsOperatingRows.filter((row) => row.riskTone === "danger" || row.riskTone === "warning").length,
        detail: "Blocked, high-risk, staffing, proof, production, or review-needed work.",
        hash: "#needs-attention"
      },
      {
        label: "Recently Changed",
        value: sharedJobs.filter((job) => Boolean(job.updated_at)).length,
        detail: "Current sports jobs with update timestamps.",
        hash: "#project-tracking"
      }
    ],
    [overview?.upcoming_shoots.length, sharedJobs, sportsOperatingRows]
  );

  const allErrors = Object.values(errors).filter(Boolean);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading Sports" summary="Opening the shared sports contract and the department read models tied to it." />;
  }

  if (!overview && !sharedJobs.length && !tasks.length && !exceptions.length && !dashboard && !peerQaBoard) {
    return (
      <section className="sports-workspace">
        <WorkspacePageHeader
          eyebrow="Sports"
          title="Sports"
          summary="Photo days, team and individual workflows, QR/data issues, galleries, products, and work that needs a next owner."
          meta={[{ label: accessScope === "own" ? "Own-scope view" : "Department view", tone: accessScope === "own" ? "warning" : "info" }]}
        />
        <section className="panel">
          <WorkspaceEmptyState
            title="Sports overview unavailable"
            summary={allErrors.join(" ") || "We couldn't open the sports contract view right now."}
            actions={
              <button type="button" onClick={() => window.location.reload()}>
                Retry
              </button>
            }
          />
        </section>
      </section>
    );
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports"
        summary="Photo days, team and individual workflows, QR/data issues, galleries, products, and work that needs a next owner."
        meta={[
          { label: overview ? `${overview.anchor_start} to ${overview.anchor_end}` : "Shared contract view", tone: "info" },
          { label: accessScope === "own" ? "Own-scope view" : "Department view", tone: accessScope === "own" ? "warning" : "success" }
        ]}
        actions={
          <WorkspaceActionBar align="end">
            <button type="button" onClick={() => (window.location.hash = "#sports/jobs/new")} disabled={!canCreate}>
              New Sports Job
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/jobs/import")} disabled={!canCreate}>
              Import Sports Jobs
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/exceptions")}>
              Review blockers
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#project-tracking")}>
              View full work spine
            </button>
          </WorkspaceActionBar>
        }
      />

      <section className="panel sports-operating-board">
        <div className="sports-operating-board__top">
          <WorkspaceSectionHeader
            title="Sports Command Hub"
            summary="Summary-first view of sports work, photo days, due dates, blockers, next owners, and where to inspect the full work record."
          />
          <WorkspaceActionBar align="end">
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/jobs")}>
              All Jobs
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/accounts")}>
              Accounts
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/contacts")}>
              Contacts
            </button>
          </WorkspaceActionBar>
        </div>

        <div className="sports-operating-board__kpis" aria-label="Sports operating summary cards">
          {sportsCommandSummaryCards.map((card) => (
            <button key={card.label} type="button" className="sports-operating-board__summary-card" onClick={() => (window.location.hash = card.hash)}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </button>
          ))}
        </div>

        <div className="sports-operating-board__signals" aria-label="Sports attention preview">
          <div className="sports-operating-board__signal-label">
            <strong>What needs attention</strong>
            <span>Preview only. Use Needs Attention for cross-operational blockers.</span>
          </div>
          <button type="button" onClick={() => (window.location.hash = "#sports/graphics")}>
            <span>Proof approvals</span>
            <strong>{sportsBoardIssueCounts.proofApprovals}</strong>
          </button>
          <button type="button" onClick={() => (window.location.hash = "#sports/contacts")}>
            <span>Missing client/team info</span>
            <strong>{sportsBoardIssueCounts.clientInfo}</strong>
          </button>
          <button type="button" onClick={() => (window.location.hash = "#sports/exceptions")}>
            <span>Staffing / coverage</span>
            <strong>{sportsBoardIssueCounts.staffing}</strong>
          </button>
          <button type="button" onClick={() => (window.location.hash = "#sports/graphics")}>
            <span>Production blockers</span>
            <strong>{sportsBoardIssueCounts.production}</strong>
          </button>
          <button type="button" onClick={() => (window.location.hash = "#tasks?department=sports")}>
            <span>Open tasks</span>
            <strong>{sportsBoardIssueCounts.tasks}</strong>
          </button>
          <button type="button" onClick={() => (window.location.hash = "#sports/exceptions")}>
            <span>Exceptions</span>
            <strong>{sportsBoardIssueCounts.exceptions}</strong>
          </button>
        </div>

        {sportsOperatingRows.length ? (
          <div className="sports-operating-board__table" role="table" aria-label="Sports department command list">
            <div className="sports-operating-board__row sports-operating-board__row--head" role="row">
              <span role="columnheader">Team / account</span>
              <span role="columnheader">Department work</span>
              <span role="columnheader">Due / event</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Next action</span>
              <span role="columnheader">Next owner</span>
              <span role="columnheader">Blocker / review</span>
              <span role="columnheader">Open next</span>
            </div>
            {sportsOperatingRows.map((row) => (
              <div key={row.id} className="sports-operating-board__row" role="row">
                <div>
                  <strong title={row.accountLabel}>{row.accountLabel}</strong>
                  <span title={row.contactLabel}>Contact: {row.contactLabel}</span>
                </div>
                <div>
                  <strong>{row.jobTypeLabel}</strong>
                  <span>{row.taskCount} tasks | {row.exceptionCount} exceptions</span>
                </div>
                <div>
                  <strong>{row.dateLabel}</strong>
                  <span>Event date or deadline</span>
                </div>
                <div>
                  <strong>{row.statusLabel}</strong>
                  <span>{row.statusDetail}</span>
                </div>
                <div>
                  <strong title={row.nextAction}>{row.nextAction}</strong>
                  <div className="sports-operating-board__flags" aria-label={`Issue types for ${row.accountLabel}`}>
                    {row.proofApproval ? <span>Proof</span> : null}
                    {row.clientInfoIssue ? <span>Client/info</span> : null}
                    {row.staffingIssue ? <span>Staffing</span> : null}
                    {row.productionIssue ? <span>Production</span> : null}
                  </div>
                </div>
                <div>
                  <strong>{row.ownerLabel}</strong>
                  <span>Next owner</span>
                </div>
                <div>
                  <StatusPill label={row.riskLabel} tone={row.riskTone} />
                </div>
                <div className="sports-operating-board__actions">
                  <button type="button" onClick={() => (window.location.hash = row.jobHash)}>
                    Open work
                  </button>
                  <button type="button" onClick={() => (window.location.hash = "#project-tracking")}>
                    View in Project Tracking
                  </button>
                  {(row.riskTone === "danger" || row.riskTone === "warning" || row.exceptionCount > 0) ? (
                    <button type="button" onClick={() => (window.location.hash = "#needs-attention")}>
                      Open Needs Attention
                    </button>
                  ) : null}
                  {row.accountHash ? (
                    <button type="button" onClick={() => (window.location.hash = row.accountHash ?? "#sports/accounts")}>
                      Account
                    </button>
                  ) : null}
                  {row.productionHash ? (
                    <button type="button" onClick={() => (window.location.hash = row.productionHash ?? "#sports/graphics")}>
                      Production
                    </button>
                  ) : null}
                  {row.exceptionsHash ? (
                    <button type="button" onClick={() => (window.location.hash = row.exceptionsHash ?? "#sports/exceptions")}>
                      Exceptions
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <WorkspaceEmptyState
            title="No active sports work is showing here yet"
            summary="Published sports jobs appear here when the shared job queue has team, owner, event, and risk context."
            actions={
              <button type="button" onClick={() => (window.location.hash = "#sports/jobs/new")} disabled={!canCreate}>
                Start Sports Job
              </button>
            }
          />
        )}
      </section>

      <DepartmentDashboardPanel
        token={token}
        currentUser={currentUser}
        departmentType="sports"
        title="Sports Command Layer"
        summary="Shared operational health for sports readiness, staffing volatility, missing ready confirmations, blocked workflow, overdue approvals, and delivery risk."
        routeHash="#sports/exceptions"
      />

      <section className="panel sports-peer-qa-entry">
        <WorkspaceSectionHeader
          title="Sports Peer-to-Peer QA Board"
          summary="Track Sports jobs through owner QA, peer review, corrections, blockers, and final release readiness."
        />
        <div className="sports-preview-field-grid">
          <div><span>Ready for Owner QA</span><strong>{peerQaBoard?.summary.ready_for_owner_qa ?? 0}</strong></div>
          <div><span>Ready for Peer QA</span><strong>{peerQaBoard?.summary.ready_for_peer_qa ?? 0}</strong></div>
          <div><span>Corrections Needed</span><strong>{peerQaBoard?.summary.corrections_needed ?? 0}</strong></div>
          <div><span>Ready for Spencer Review</span><strong>{peerQaBoard?.summary.ready_for_spencer_review ?? 0}</strong></div>
          <div><span>Blocked</span><strong>{peerQaBoard?.summary.blocked_waiting ?? 0}</strong></div>
          <div><span>Approved for Release</span><strong>{peerQaBoard?.summary.approved_for_release ?? 0}</strong></div>
        </div>
        <WorkspaceActionBar align="end">
          <button type="button" onClick={() => (window.location.hash = "#sports/peer-qa")}>
            Open Peer QA Board
          </button>
        </WorkspaceActionBar>
      </section>

      <CompactActiveWorkPanel
        token={token}
        currentUser={currentUser}
        title="Sports Active Work"
        summary="Compact sports workload strip for event pressure, owner clarity, next action, and risk before opening the full work spine."
        defaultDepartment="sports"
        routeHash="#sports/jobs"
        focus="overview"
        showDepartmentFilter={false}
      />

      <ProjectTrackingDepartmentQueue
        token={token}
        department="sports"
        title="Sports workflow queue"
        summary="Live Project Tracking rows where the next step belongs to Sports. Open Project Tracking for the full work spine."
      />

      {featureFlags.centralJobIntakeV1 ? (
        <>
          <CreateWorkLauncherPanel
            className="sports-workspace__create-panel"
            eyebrow="Sports Create"
            title="Start sports work in the shared lanes"
            summary="Sports jobs and events create the real workload. Sports tasks and graphics work stay attached to the same shared operating contract."
            jobAction={{
              label: "New Sports Job / Event",
              summary: "Create the sports job that should flow into scheduling, staffing, proofs, specialty products, and shared graphics workflow.",
              hash: "#sports/jobs/new"
            }}
            taskAction={{
              label: "New Sports Task",
              summary: "Create a sports-owned internal execution item for follow-through, proofs, specialty product steps, or client action items.",
              hash: "#tasks/new?department=sports"
            }}
          />
          <JobIntakeLauncherCard
            department="sports"
            contextLabel="Sports"
            canCreate={canCreate}
            onQuickCreate={() => setQuickCreateOpen(true)}
            onSmartPaste={() => setSmartPasteOpen(true)}
            onImportFile={() => {
              window.location.hash = "#sports/jobs/import";
            }}
            onResumeDrafts={() => setResumeDraftsOpen(true)}
          />
          <ResumeDraftsDrawer
            open={resumeDraftsOpen}
            token={token}
            department="sports"
            launchLabel="Sports mission control"
            onClose={() => setResumeDraftsOpen(false)}
            onResumeDraft={(draftId) => {
              setResumeDraftsOpen(false);
              setResumeDraftId(draftId);
              setQuickCreateOpen(true);
            }}
          />
          <QuickCreateJobDrawer
            open={quickCreateOpen}
            token={token}
            currentUser={currentUser}
            defaultDepartment="sports"
            launchLabel="Sports mission control"
            resumeDraftId={resumeDraftId}
            onClose={() => {
              setQuickCreateOpen(false);
              setResumeDraftId(null);
            }}
            onPublished={(jobId) => {
              setQuickCreateOpen(false);
              setResumeDraftId(null);
              window.location.hash = `#sports/jobs/${jobId}`;
            }}
          />
          <SmartPasteJobDrawer
            open={smartPasteOpen}
            token={token}
            currentUser={currentUser}
            defaultDepartment="sports"
            launchLabel="Sports mission control"
            onClose={() => setSmartPasteOpen(false)}
            onPublished={(jobId) => {
              setSmartPasteOpen(false);
              window.location.hash = `#sports/jobs/${jobId}`;
            }}
          />
          <TodayOperationsBoard
            token={token}
            currentUser={currentUser}
            departmentType="sports"
            routeBase="#sports/jobs"
            title="Today Sports Operations"
            summary="Live sports execution board for readiness drift, staffing volatility, lead-ready confirmations, and active day-of exceptions."
          />
          <DepartmentProductionOverviewPanel
            token={token}
            departmentType="sports"
            title="Sports Graphics Workflow"
            summary="Live graphics and downstream workflow pressure across proofs, approvals, QA, specialty products, blocked work, and delivery."
            routeHash="#sports/graphics"
          />
        </>
      ) : null}

      {allErrors.length ? <div className="error-banner">{allErrors.join(" ")}</div> : null}

      <section className="panel workspace-filter-toolbar sports-overview-toolbar">
        <label className="filter-field">
          <span>Search Sports</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search job, task, exception, workflow, or sports signal" />
        </label>
        <SavedViewBar
          views={overview?.saved_views ?? []}
          activeKey={savedView}
          onSelect={(key) => {
            window.location.hash = key ? `#sports?saved_view=${key}` : "#sports";
          }}
        />
      </section>

      {overview?.kpis?.length ? (
        <div className="sports-kpi-grid">
          {overview.kpis.map((card) => (
            <KpiStatCard key={card.key} card={card} />
          ))}
        </div>
      ) : null}

      <section className="sports-contract-block">
        <WorkspaceSectionHeader
          title="Shared operational contract"
          summary="Jobs, tasks, exceptions, and workflow are first-class here. Sports-specific metrics stay as projections over that same shared work."
        />
        <div className="sports-grid sports-grid--two">
          <OverviewListCard
            title="Jobs"
            items={sharedJobCards}
            emptyTitle="No sports jobs in motion"
            emptyDescription="Published sports jobs tied to the shared contract will surface here."
          />
          <OverviewListCard
            title="Tasks"
            items={sharedTaskCards}
            emptyTitle="No sports tasks needing action"
            emptyDescription="Shared sports tasks and owner follow-through will surface here."
          />
        </div>
        <div className="sports-grid sports-grid--two">
          <OverviewListCard
            title="Exceptions"
            items={sharedExceptionCards}
            emptyTitle="No sports exceptions"
            emptyDescription="Assigned and open sports exceptions will surface here."
          />
          <OverviewListCard
            title="Workflow"
            items={sharedWorkflowCards}
            emptyTitle="No graphics workflow pressure"
            emptyDescription="Shared graphics and downstream workflow pressure tied to sports jobs will surface here."
          />
        </div>
      </section>

      {filteredSportsReadModels ? (
        <section className="sports-read-model-block">
          <WorkspaceSectionHeader
            title="Sports read-model projections"
            summary="These signals stay sports-specific while Project Tracking remains the shared work spine for full inspection."
          />
          <div className="sports-grid sports-grid--two">
            <OverviewListCard
              title="Upcoming Shoots"
              items={filteredSportsReadModels.upcoming_shoots}
              emptyTitle="No upcoming sports shoots"
              emptyDescription="Published sports shoots for the current window will appear here."
            />
            <OverviewListCard
              title="Staffing Readiness"
              items={filteredSportsReadModels.staffing_readiness}
              emptyTitle="Staffing looks clear"
              emptyDescription="Coverage risk, lead gaps, and readiness drift will show up here."
            />
          </div>

          <div className="sports-grid sports-grid--two">
            <OverviewListCard
              title="Lead Ready Pings / Check-In Monitor"
              items={filteredSportsReadModels.ready_pings}
              emptyTitle="No active ready-to-work signals"
              emptyDescription="Today's lead check-ins and ready confirmations will surface here."
            />
            <OverviewListCard
              title="Proof and Specialty Product Signals"
              items={filteredSportsReadModels.proof_and_products}
              emptyTitle="No proof or specialty backlog"
              emptyDescription="Proof approvals and sports specialty product pressure will surface here."
            />
          </div>

          <div className="sports-grid sports-grid--two">
            <OverviewListCard
              title="Account Health / Open Escalations"
              items={filteredSportsReadModels.account_health}
              emptyTitle="Accounts are stable"
              emptyDescription="Open escalations, account pressure, and relationship risk will surface here."
            />
            <OverviewListCard
              title="Recent Changes / Activity Feed"
              items={filteredSportsReadModels.recent_activity}
              emptyTitle="No recent changes"
              emptyDescription="Important sports activity and audit movement will appear here."
            />
          </div>
        </section>
      ) : null}
    </section>
  );
}
