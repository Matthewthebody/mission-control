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
  KpiStatCard,
  OverviewListCard,
  SavedViewBar,
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
  const sharedWorkflowCards = useMemo(() => {
    const workflowItems = [
      ...(dashboard?.blocked_production ?? []),
      ...(dashboard?.overdue_approvals ?? []),
      ...(dashboard?.delivery_risks ?? [])
    ];
    return Array.from(new Map(workflowItems.map((item) => [item.id, item])).values()).slice(0, 6).map(toWorkflowCard);
  }, [dashboard?.blocked_production, dashboard?.delivery_risks, dashboard?.overdue_approvals]);

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
          summary="Sports uses the same shared jobs, tasks, exceptions, and workflow contract as the rest of the operating system."
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
        summary="Sports now runs on the same shared jobs, tasks, exceptions, and workflow contract as Schools, with sports-specific pressure shown only as read-model projections."
        meta={[
          { label: overview ? `${overview.anchor_start} to ${overview.anchor_end}` : "Shared contract view", tone: "info" },
          { label: accessScope === "own" ? "Own-scope view" : "Department view", tone: accessScope === "own" ? "warning" : "success" }
        ]}
        actions={
          <WorkspaceActionBar align="end">
            <button type="button" onClick={() => setQuickCreateOpen(true)} disabled={!canCreate}>
              New Sports Job
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/jobs/import")} disabled={!canCreate}>
              Import Sports Jobs
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/exceptions")}>
              View Exceptions
            </button>
          </WorkspaceActionBar>
        }
      />

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
        summary="Dense sports workload strip for event pressure, owner clarity, next action, and risk before the full department contract view takes over."
        defaultDepartment="sports"
        routeHash="#sports/jobs"
        focus="overview"
        showDepartmentFilter={false}
      />

      <ProjectTrackingDepartmentQueue
        token={token}
        department="sports"
        title="Sports workflow queue"
        summary="Live Project Dashboard rows where the current workflow step belongs to Sports. Open the job workflow to update progress."
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
            summary="These signals stay sports-specific, but they are projections over the same shared jobs, tasks, exceptions, and workflow runtime."
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
