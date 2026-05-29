import { useEffect, useMemo, useState } from "react";
import { buildShellRouteHash } from "../navigation";
import { canAccessRoute } from "../permissions";
import { listSharedTasks } from "../services/tasksApi";
import type { SessionUser } from "../types";
import type { SharedTaskListItem } from "../workModelTypes";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type TaskHubSnapshot = {
  myTasks: SharedTaskListItem[];
  myOpenCount: number | null;
  overdueCount: number | null;
  dueTodayCount: number | null;
  departmentCounts: {
    schools: number | null;
    sports: number | null;
    production: number | null;
  };
};

type QueueCard = {
  id: string;
  title: string;
  summary: string;
  hash: string;
  count: number | null;
  actionLabel: string;
};

const EMPTY_SNAPSHOT: TaskHubSnapshot = {
  myTasks: [],
  myOpenCount: null,
  overdueCount: null,
  dueTodayCount: null,
  departmentCounts: {
    schools: null,
    sports: null,
    production: null
  }
};

function countOpenTasks(items: Array<{ status: string }>) {
  return items.filter((task) => !["completed", "cancelled"].includes(task.status)).length;
}

function formatDueLabel(value: string | null) {
  if (!value) {
    return "No due date";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function navigateToHash(hash: string) {
  window.location.hash = hash;
}

export function DashboardMyTasksPage({ token, currentUser }: Props) {
  const [snapshot, setSnapshot] = useState<TaskHubSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canCreateTask = canAccessRoute(currentUser, "task-new");
  const canOpenMyWork = canAccessRoute(currentUser, "dashboard-my-day");
  const canOpenApprovals = canAccessRoute(currentUser, "approvals");
  const canOpenSchools = canAccessRoute(currentUser, "operations-schools");
  const canOpenSports = canAccessRoute(currentUser, "sports");
  const canOpenProduction = canAccessRoute(currentUser, "graphics-workload") || canAccessRoute(currentUser, "graphics");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const requests: Array<Promise<unknown>> = [
        listSharedTasks(token, { assigned_to_user_id: currentUser.id, limit: 25 }),
        listSharedTasks(token, { assigned_to_user_id: currentUser.id, due_bucket: "overdue", limit: 25 }),
        listSharedTasks(token, { assigned_to_user_id: currentUser.id, due_bucket: "today", limit: 25 }),
        canOpenSchools ? listSharedTasks(token, { department_type: "schools", limit: 25 }) : Promise.resolve(null),
        canOpenSports ? listSharedTasks(token, { department_type: "sports", limit: 25 }) : Promise.resolve(null),
        canOpenProduction ? listSharedTasks(token, { department_type: "production", limit: 25 }) : Promise.resolve(null)
      ];

      const [assignedResult, overdueResult, todayResult, schoolsResult, sportsResult, productionResult] =
        await Promise.allSettled(requests);

      if (cancelled) {
        return;
      }

      const assignedTasks = assignedResult.status === "fulfilled" && assignedResult.value
        ? (assignedResult.value as { items: SharedTaskListItem[] }).items
        : [];
      const overdueTasks = overdueResult.status === "fulfilled" && overdueResult.value
        ? (overdueResult.value as { items: SharedTaskListItem[] }).items
        : [];
      const todayTasks = todayResult.status === "fulfilled" && todayResult.value
        ? (todayResult.value as { items: SharedTaskListItem[] }).items
        : [];

      const nextSnapshot: TaskHubSnapshot = {
        myTasks: assignedTasks.slice(0, 6),
        myOpenCount: assignedResult.status === "fulfilled" ? countOpenTasks(assignedTasks) : null,
        overdueCount: overdueResult.status === "fulfilled" ? countOpenTasks(overdueTasks) : null,
        dueTodayCount: todayResult.status === "fulfilled" ? countOpenTasks(todayTasks) : null,
        departmentCounts: {
          schools:
            schoolsResult.status === "fulfilled" && schoolsResult.value
              ? countOpenTasks((schoolsResult.value as { items: SharedTaskListItem[] }).items)
              : null,
          sports:
            sportsResult.status === "fulfilled" && sportsResult.value
              ? countOpenTasks((sportsResult.value as { items: SharedTaskListItem[] }).items)
              : null,
          production:
            productionResult.status === "fulfilled" && productionResult.value
              ? countOpenTasks((productionResult.value as { items: SharedTaskListItem[] }).items)
              : null
        }
      };

      setSnapshot(nextSnapshot);

      const anyTaskRequestFailed = [assignedResult, overdueResult, todayResult].some((result) => result.status === "rejected");
      setError(anyTaskRequestFailed ? "Some task counts could not be refreshed right now." : "");
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [canOpenProduction, canOpenSchools, canOpenSports, currentUser.id, token]);

  const queueCards = useMemo(() => {
    const cards: QueueCard[] = [];
    if (canOpenMyWork) {
      cards.push({
        id: "my-work",
        title: "My Work",
        summary: "Open your personal assignments, shift detail, and follow-through.",
        hash: buildShellRouteHash("dashboard-my-day"),
        count: snapshot.myOpenCount,
        actionLabel: "Open My Work"
      });
    }
    if (canOpenApprovals) {
      cards.push({
        id: "approvals",
        title: "Approvals",
        summary: "Jump into approvals and review work that still needs a decision.",
        hash: buildShellRouteHash("approvals"),
        count: snapshot.overdueCount,
        actionLabel: "Open Approvals"
      });
    }
    if (canOpenSchools) {
      cards.push({
        id: "schools",
        title: "School Tasks",
        summary: "Open the school task lane for active operational follow-through.",
        hash: "#schools/tasks",
        count: snapshot.departmentCounts.schools,
        actionLabel: "View School Tasks"
      });
    }
    if (canOpenSports) {
      cards.push({
        id: "sports",
        title: "Sports Tasks",
        summary: "Open the sports workspace where sports-owned task work is moving.",
        hash: "#sports/tasks",
        count: snapshot.departmentCounts.sports,
        actionLabel: "View Sports Tasks"
      });
    }
    if (canOpenProduction) {
      cards.push({
        id: "production",
        title: "Production Tasks",
        summary: "Open the production workload queue for active downstream task work.",
        hash: "#production/tasks",
        count: snapshot.departmentCounts.production,
        actionLabel: "View Production Tasks"
      });
    }
    return cards;
  }, [canOpenApprovals, canOpenMyWork, canOpenProduction, canOpenSchools, canOpenSports, snapshot]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading My Tasks" summary="Pulling your task lanes and the next task-owned queues into one place." />;
  }

  return (
    <section className="home-task-hub">
      <WorkspacePageHeader
        title="My Tasks"
        summary="Open the queue that owns the next action instead of digging through the whole app."
        actions={
          canCreateTask ? (
            <WorkspaceActionBar align="end" compact>
              <button type="button" onClick={() => navigateToHash(buildShellRouteHash("task-new"))}>
                Create Task
              </button>
            </WorkspaceActionBar>
          ) : null
        }
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel home-task-hub__summary-panel">
        <WorkspaceSectionHeader
          title="Today at a glance"
          summary="Start with your assigned work, then jump directly into the queue that owns the next task."
          compact
        />
        <div className="home-task-hub__stats">
          <article className="home-task-hub__stat-card">
            <span>My Open Tasks</span>
            <strong>{snapshot.myOpenCount ?? "—"}</strong>
            <p>Assigned to you and still in motion.</p>
          </article>
          <article className="home-task-hub__stat-card">
            <span>Overdue</span>
            <strong>{snapshot.overdueCount ?? "—"}</strong>
            <p>Your tasks that are already past due.</p>
          </article>
          <article className="home-task-hub__stat-card">
            <span>Due Today</span>
            <strong>{snapshot.dueTodayCount ?? "—"}</strong>
            <p>Your tasks that should move today.</p>
          </article>
        </div>
      </section>

      <div className="home-task-hub__grid">
        <section className="panel">
          <WorkspaceSectionHeader
            title="Go to a task queue"
            summary="These links jump straight into the work surfaces that already own tasks."
            compact
          />
          {queueCards.length ? (
            <div className="home-task-hub__lanes">
              {queueCards.map((card) => (
                <button key={card.id} type="button" className="home-task-hub__lane-card" onClick={() => navigateToHash(card.hash)}>
                  <span>{card.title}</span>
                  <strong>{card.count ?? "—"}</strong>
                  <p>{card.summary}</p>
                  <em>{card.actionLabel}</em>
                </button>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState
              title="No task queues are available here"
              summary="Your current role does not expose any task queues on this route."
              compact
            />
          )}
        </section>

        <section className="panel">
          <WorkspaceSectionHeader
            title="Assigned to you"
            summary="Your next assigned tasks, with a direct link into task detail."
            compact
          />
          {snapshot.myTasks.length ? (
            <div className="home-task-hub__task-list">
              {snapshot.myTasks.map((task) => (
                <button key={task.id} type="button" className="home-task-hub__task-card" onClick={() => navigateToHash(`#tasks/${task.id}`)}>
                  <div className="home-task-hub__task-top">
                    <span>{task.department_label}</span>
                    <em>{task.priority}</em>
                  </div>
                  <strong>{task.title}</strong>
                  <p>{task.related_job_title ?? task.organization_name ?? "No related job linked yet."}</p>
                  <div className="home-task-hub__task-meta">
                    <span>{task.status.replace(/_/g, " ")}</span>
                    <span>{formatDueLabel(task.due_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState
              title="Nothing is assigned to you right now"
              summary="If new work comes in, it will show up here with a direct link into task detail."
              compact
            />
          )}
        </section>
      </div>
    </section>
  );
}
