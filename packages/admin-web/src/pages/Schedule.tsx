import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { UnifiedScheduleSurface } from "../components/UnifiedScheduleSurface";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import {
  canAccessRoute,
  canManageOperatingSystemModule,
  getOperatingSystemScope,
  shouldLimitToEmployeeWorksurface
} from "../permissions";
import {
  buildMasterScheduleHash,
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

// Future direction: My Work stays personal, department hubs get filtered schedule lenses,
// and leadership/operations owns the full editable schedule over this shared source.
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
  const canOpenShootWorkspace = canAccessRoute(currentUser, "operations-shoots");
  const canBroadenVisibility = scheduleScope === "all" || scheduleScope === "department";
  const routeContext = getScheduleRouteContext(window.location.hash, employeeOnlyMode);
  const photographySchedule = routeContext === "photography";
  const currentView: MasterScheduleView =
    routeContext === "operations" && canManageSchedule && routeState.view === "staffing" ? "staffing" : "jobs";
  const workspaceMode = routeContext === "operations" && canManageSchedule && currentView === "staffing" ? "scheduling" : "schedule";

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
    if (routeContext === "personal") {
      return "My Schedule";
    }
    if (photographySchedule) {
      return "Read-only calendar";
    }
    if (scheduleScope === "all") {
      return "Team Schedule";
    }
    if (scheduleScope === "department") {
      return `${humanizeLabel(currentUser.department)} schedule`;
    }
    return employeeOnlyMode ? "My Schedule" : "Personal Schedule";
  }, [currentUser.department, employeeOnlyMode, photographySchedule, routeContext, scheduleScope]);

  const headerCopy = getHeaderCopy(routeContext, currentView, employeeOnlyMode);

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
          {
            label: photographySchedule ? "Week / 30-day" : "Day / Week / Month",
            tone: "neutral"
          }
        ]}
        actions={
          routeContext === "photography" ? (
            <WorkspaceActionBar compact>
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#photography")}>
                Back to Photography
              </button>
            </WorkspaceActionBar>
          ) : undefined
        }
      />

      <WorkspaceFilterToolbar className="schedule-shell__toolbar">
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Jump to date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => {
                const nextDate = event.target.value;
                setDate(nextDate);
                navigateToView(currentView, { date: nextDate });
              }}
            />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Search schedule</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search who, where, job, or role"
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
        </div>
      </WorkspaceFilterToolbar>

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <UnifiedScheduleSurface
        workspaceMode={workspaceMode}
        initialView={currentView}
        initialRange={(photographySchedule || routeContext === "global") && currentView === "jobs" ? "30day" : undefined}
        defaultMyItemsOnly={routeContext === "personal" || employeeOnlyMode}
        presentationMode={photographySchedule ? "photography" : "default"}
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
  if (path.startsWith("photography/") || path === "studios" || path.startsWith("studios/")) {
    return "photography";
  }
  if (path.startsWith("operations/")) {
    return "operations";
  }
  return "global";
}

function getHeaderCopy(context: ScheduleRouteContext, view: MasterScheduleView, employeeOnlyMode: boolean) {
  if (employeeOnlyMode || context === "personal") {
    return {
      eyebrow: undefined,
      title: "My Schedule",
      summary: "Your shifts, events, linked jobs, times, and locations in one calendar view."
    };
  }

  if (context === "photography") {
    return {
      eyebrow: "Photography",
      title: view === "staffing" ? "Photography Staffing" : "Photography Calendar",
      summary:
        view === "staffing"
          ? "Field staffing, coverage gaps, and photographer placement stay inside the shared schedule."
          : "Photography opens here first: upcoming shoot timing, locations, readiness pressure, and linked assignment access."
    };
  }

  if (context === "operations") {
    return {
      eyebrow: undefined,
      title: "Team Schedule",
      summary: "A readable team calendar for shifts, events, shoots, locations, and weekly planning."
    };
  }

  return {
    eyebrow: undefined,
    title: "Team Schedule",
    summary: "A readable team calendar for shifts, events, shoots, locations, and weekly planning."
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
