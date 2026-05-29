import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { UnifiedScheduleSurface } from "../components/UnifiedScheduleSurface";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import {
  canAccessRoute,
  canAccessOperatingSystemModule,
  canManageOperatingSystemModule,
  getOperatingSystemScope,
  shouldLimitToEmployeeWorksurface
} from "../permissions";
import {
  buildMasterScheduleHash,
  buildSchedulingWorkspaceHash,
  parseScheduleWorkspaceRouteState,
  type MasterScheduleView
} from "../scheduleWorkspaceRouting";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type ScheduleMember = {
  id: string;
  email?: string;
  full_name: string;
  department: string;
  roles: string[];
};

type ScheduleRouteContext = "global" | "photography" | "operations" | "personal";

const VIEW_OPTIONS: Array<{ id: MasterScheduleView; label: string; summary: string }> = [
  {
    id: "jobs",
    label: "Job Schedule",
    summary: "See Jobs / Events on the shared calendar without burying timing and location context."
  },
  {
    id: "staffing",
    label: "Staffing Schedule",
    summary: "See assignments, availability pressure, and coverage in the same shared scheduling engine."
  },
  {
    id: "assignment_board",
    label: "Assignment Board",
    summary: "Scan open work, filled roles, conflicts, and staffing gaps together."
  }
];

export function Schedule({ token, currentUser }: Props) {
  const [routeState, setRouteState] = useState(() => parseScheduleWorkspaceRouteState(window.location.hash));
  const [date, setDate] = useState(routeState.date ?? getLocalDateString());
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<ScheduleMember[]>(() => [toScheduleMember(currentUser)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const employeeOnlyMode = shouldLimitToEmployeeWorksurface(currentUser);
  const scheduleScope = getOperatingSystemScope(currentUser, "schedule");
  const canManageSchedule = canManageOperatingSystemModule(currentUser, "schedule");
  const canOpenSchedulingTools = canAccessOperatingSystemModule(currentUser, "scheduling");
  const canOpenShootWorkspace = canAccessRoute(currentUser, "operations-shoots");
  const canOpenMyDay = canAccessRoute(currentUser, "dashboard-my-day");
  const canBroadenVisibility = scheduleScope === "all" || scheduleScope === "department";
  const currentView = employeeOnlyMode && routeState.view === "assignment_board" ? "staffing" : routeState.view;
  const routeContext = getScheduleRouteContext(window.location.hash, employeeOnlyMode);
  const workspaceMode = canManageSchedule ? "scheduling" : "schedule";

  useEffect(() => {
    const sync = () => {
      setRouteState(parseScheduleWorkspaceRouteState(window.location.hash));
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (routeState.date && routeState.date !== date) {
      setDate(routeState.date);
    }
  }, [date, routeState.date]);

  useEffect(() => {
    if (!canBroadenVisibility) {
      setMembers([toScheduleMember(currentUser)]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiFetch<ScheduleMember[]>(`/api/shifts/resources/members?anchor_date=${date}`, token)
      .then((rows) => {
        if (!cancelled) {
          setMembers(rows);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setMembers([toScheduleMember(currentUser)]);
          setError(loadError instanceof Error ? loadError.message : "We couldn't load the schedule roster.");
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
  }, [canBroadenVisibility, currentUser, date, token]);

  const scopeLabel = useMemo(() => {
    if (scheduleScope === "all") {
      return "Company scope";
    }
    if (scheduleScope === "department") {
      return `${humanizeLabel(currentUser.department)} scope`;
    }
    return employeeOnlyMode ? "Own assignments only" : "Personal scope";
  }, [currentUser.department, employeeOnlyMode, scheduleScope]);

  const viewOptions = useMemo(
    () => VIEW_OPTIONS.filter((option) => option.id !== "assignment_board" || canManageSchedule),
    [canManageSchedule]
  );
  const currentViewDefinition = viewOptions.find((option) => option.id === currentView) ?? viewOptions[0];
  const headerCopy = getHeaderCopy(routeContext, currentViewDefinition.id, employeeOnlyMode);

  function navigateToView(view: MasterScheduleView, options?: { date?: string | null; shootId?: string | null; shiftId?: string | null }) {
    window.location.hash = buildMasterScheduleHash(view, {
      date: options?.date ?? date,
      shootId: options?.shootId ?? routeState.shootId,
      shiftId: options?.shiftId ?? routeState.shiftId
    });
  }

  return (
    <div className="workspace-shell schedule-shell">
      <WorkspacePageHeader
        eyebrow={headerCopy.eyebrow}
        title={headerCopy.title}
        summary={headerCopy.summary}
        meta={[
          { label: scopeLabel, tone: employeeOnlyMode ? "warning" : "info" },
          { label: currentViewDefinition.label, tone: currentViewDefinition.id === "assignment_board" ? "critical" : "neutral" }
        ]}
        actions={
          <WorkspaceActionBar compact>
            {canOpenMyDay ? (
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#my-work")}>
                My Work
              </button>
            ) : null}
            {!employeeOnlyMode ? (
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#my-schedule")}>
                My Schedule
              </button>
            ) : null}
            {routeContext === "photography" ? (
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#photography")}>
                Back to Photography
              </button>
            ) : null}
          </WorkspaceActionBar>
        }
      />

      <section className="panel schedule-shell__view-strip" aria-label="Master schedule views">
        <div className="schedule-shell__view-tabs" role="tablist" aria-label="Schedule view selector">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={currentViewDefinition.id === option.id}
              className={currentViewDefinition.id === option.id ? "schedule-shell__view-tab is-active" : "schedule-shell__view-tab"}
              onClick={() => navigateToView(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.summary}</span>
            </button>
          ))}
        </div>
      </section>

      <WorkspaceFilterToolbar className="schedule-shell__toolbar">
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Anchor Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => {
                const nextDate = event.target.value;
                setDate(nextDate);
                navigateToView(currentViewDefinition.id, { date: nextDate });
              }}
            />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Search Schedule</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by shoot, location, employee, or role"
            />
          </label>
        </div>
        <div className="workspace-toolbar__actions schedule-shell__toolbar-actions">
          {loading ? <span className="meta-pill">Refreshing roster...</span> : null}
          {search ? (
            <button type="button" className="secondary-button" onClick={() => setSearch("")}>
              Clear Search
            </button>
          ) : null}
          {canOpenSchedulingTools ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => (window.location.hash = buildSchedulingWorkspaceHash("exceptions", { date }))}
            >
              Coverage Requests
            </button>
          ) : null}
        </div>
      </WorkspaceFilterToolbar>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <UnifiedScheduleSurface
        workspaceMode={workspaceMode}
        initialView={currentViewDefinition.id}
        token={token}
        anchorDate={date}
        search={search}
        members={members}
        currentUser={currentUser}
        onOpenShoot={(shootId) => {
          if (canOpenShootWorkspace) {
            window.location.hash = `#photography/shoots?shoot=${shootId}`;
            return;
          }
          navigateToView("jobs", { shootId });
        }}
        onOpenShift={(shift) => {
          if (employeeOnlyMode || !canManageSchedule) {
            window.location.hash = "#my-work";
            return;
          }
          navigateToView("staffing", {
            shootId: shift.shoot_id ?? null,
            shiftId: shift.id
          });
        }}
        onNotice={setNotice}
        onError={setError}
      />
    </div>
  );
}

function toScheduleMember(user: SessionUser): ScheduleMember {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    department: user.department,
    roles: user.roles
  };
}

function getScheduleRouteContext(hashValue: string, employeeOnlyMode: boolean): ScheduleRouteContext {
  if (employeeOnlyMode || hashValue.startsWith("#my-schedule")) {
    return "personal";
  }
  const [path = ""] = hashValue.replace(/^#/, "").split("?");
  if (path.startsWith("photography/")) {
    return "photography";
  }
  if (path.startsWith("operations/")) {
    return "operations";
  }
  return "global";
}

function getHeaderCopy(context: ScheduleRouteContext, view: MasterScheduleView, employeeOnlyMode: boolean) {
  if (employeeOnlyMode) {
    return {
      eyebrow: "My Schedule",
      title: "My Schedule",
      summary: "Your assignments, linked jobs, and time-based field work stay in one compact schedule surface."
    };
  }

  if (context === "photography") {
    return {
      eyebrow: "Photography",
      title: view === "staffing" ? "Photography Staffing" : "Photography Calendar",
      summary:
        view === "staffing"
          ? "Field staffing, coverage gaps, and photographer placement stay inside the shared master schedule."
          : "Photography uses the same master schedule engine for shoot timing, readiness pressure, and linked assignment access."
    };
  }

  if (context === "operations") {
    return {
      eyebrow: "Operations",
      title: "Master Schedule",
      summary: "One shared scheduling workspace for job timing, staffing pressure, assignment conflicts, and oversight."
    };
  }

  return {
    eyebrow: "Schedule",
    title: "Master Schedule",
    summary: "One shared scheduling engine for job timing, staffing visibility, and assignment control without splitting the calendar into separate tools."
  };
}

function getLocalDateString() {
  return new Date().toISOString().slice(0, 10);
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Personal scope";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
