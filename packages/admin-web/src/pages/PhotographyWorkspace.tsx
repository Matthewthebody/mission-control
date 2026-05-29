import { CompactActiveWorkPanel } from "../components/workspace/CompactActiveWorkPanel";
import { CreateWorkLauncherPanel } from "../components/workspace/CreateWorkLauncherPanel";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../components/workspace/WorkspacePageHeader";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  focus?: "overview" | "travel" | "pre_service" | "readiness" | "workload";
};

const FOCUS_COPY: Record<NonNullable<Props["focus"]>, { title: string; summary: string; meta: WorkspaceHeaderMeta[] }> = {
  overview: {
    title: "Studios Workspace",
    summary:
      "Studios owns shoot execution, pre-service, travel, readiness, and field workload. This workspace should help crews move fast without hiding schedule, staffing, or readiness pressure.",
    meta: [
      { label: "Shoot execution", tone: "info" },
      { label: "Shared schedule", tone: "neutral" },
      { label: "Field readiness", tone: "warning" }
    ]
  },
  travel: {
    title: "Travel & Logistics",
    summary:
      "Keep route planning, travel notes, and field logistics visible before the crew leaves instead of burying them inside Operations.",
    meta: [
      { label: "Travel visibility", tone: "info" },
      { label: "Location prep", tone: "neutral" }
    ]
  },
  pre_service: {
    title: "Pre-Service",
    summary:
      "Pre-service is where field execution gets won or lost. Surface the jobs that still need briefings, final confirmations, and crew alignment.",
    meta: [
      { label: "Crew briefings", tone: "warning" },
      { label: "Launch ready", tone: "success" }
    ]
  },
  readiness: {
    title: "Shoot Readiness",
    summary:
      "Readiness should stay unmistakable. This view keeps blocked, at-risk, and not-ready shoot work visible before crews arrive on site.",
    meta: [
      { label: "Blocked work", tone: "critical" },
      { label: "Ready checks", tone: "warning" }
    ]
  },
  workload: {
    title: "Studios Workload",
    summary:
      "Use the compact workload view to see who owns what, where staffing or readiness is slipping, and which jobs need a lead photographer next.",
    meta: [
      { label: "Owner balance", tone: "info" },
      { label: "Coverage pressure", tone: "warning" }
    ]
  }
};

const PRIMARY_LINKS = [
  { id: "shoots", label: "Shoots", hash: "#studios/shoots", detail: "Execution queue and live field detail." },
  { id: "staffing", label: "Staffing", hash: "#studios/staffing", detail: "Photographer placement inside the shared schedule." },
  { id: "travel", label: "Travel", hash: "#studios/travel", detail: "Travel packets, routing, and logistics context." },
  { id: "pre-service", label: "Pre-Service", hash: "#studios/pre-service", detail: "Crew briefings and last operational checks." },
  { id: "readiness", label: "Readiness", hash: "#studios/readiness", detail: "Readiness pressure before the day goes live." },
  { id: "calendar", label: "Calendar", hash: "#studios/calendar", detail: "Shared master schedule with linked jobs and assignments." },
  { id: "workload", label: "Workload", hash: "#studios/workload", detail: "Compact execution view for leads and managers." }
];

export function StudiosWorkspace({ token, currentUser, focus = "overview" }: Props) {
  const copy = FOCUS_COPY[focus];

  return (
    <div className="workspace-shell studios-workspace">
      <WorkspacePageHeader
        eyebrow="Studios"
        title={copy.title}
        summary={copy.summary}
        meta={copy.meta}
        actions={
          <WorkspaceActionBar compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#my-schedule")}>
              My Schedule
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#schedule")}>
              Master Schedule
            </button>
            <button type="button" onClick={() => (window.location.hash = "#my-work")}>
              My Work
            </button>
          </WorkspaceActionBar>
        }
      />

      <section className="studios-workspace__launch-grid" aria-label="Studios launch points">
        {PRIMARY_LINKS.map((link) => (
          <button key={link.id} type="button" className="panel studios-workspace__launch-card" onClick={() => (window.location.hash = link.hash)}>
            <div className="eyebrow">Studios</div>
            <strong>{link.label}</strong>
            <p>{link.detail}</p>
          </button>
        ))}
      </section>

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
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#operations/today")}>
            Open Today
          </button>
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#operations/exceptions")}>
            Open Exceptions
          </button>
        </div>
      </section>

      <CreateWorkLauncherPanel
        className="studios-workspace__create-panel"
        eyebrow="Studios Create"
        title="Create studios work the right way"
        summary="Use Jobs / Events for real shoot workload. Use task workspaces for internal follow-through, readiness actions, and field execution steps."
        jobAction={{
          label: "New Job / Event",
          summary: "Create a new shoot, event, or operational work trigger that should flow through scheduling, staffing, travel, and readiness.",
          hash: "#jobs/new"
        }}
        taskAction={{
          label: "New Studios Task",
          summary: "Create a studios-owned execution item for readiness, pre-service, travel, or field follow-through.",
          hash: "#tasks/new?department=studios"
        }}
      />

      <CompactActiveWorkPanel
        token={token}
        currentUser={currentUser}
        title={focus === "overview" ? "Compact Active Work" : copy.title}
        summary="Dense, scan-first work view for jobs that create field execution pressure. Keep owner, date, coverage, next action, and risk visible without a tall card stack."
        routeHash="#studios/shoots"
        focus={focus}
        showDepartmentFilter={focus === "overview" || focus === "workload"}
      />
    </div>
  );
}

/**
 * @deprecated Use StudiosWorkspace. Kept temporarily so existing imports and tests
 * can keep resolving while the last Photography-era imports are removed.
 */
export const PhotographyWorkspace = StudiosWorkspace;
