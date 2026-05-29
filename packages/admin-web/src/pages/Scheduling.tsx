import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LeadershipShootWorkspace } from "../components/LeadershipShootWorkspace";
import { OperationsLaneStrip } from "../components/OperationsLaneStrip";
import { OverlayPanel } from "../components/OverlayPanel";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { TrainingReadinessBadge } from "../components/TrainingReadinessBadge";
import { UnifiedScheduleSurface } from "../components/UnifiedScheduleSurface";
import {
  canAccessApprovalsHub,
  canAccessAlertsHub,
  canAccessOutlook,
  canAccessGraphicsWorkspace,
  canCreateShootRecords,
  canManageScheduleWorkspace,
  canPublishScheduleWorkspace,
  canReviewPtoRecord,
  canReviewTradeRecord,
  shouldLimitToEmployeeWorksurface
} from "../permissions";
import {
  buildSchedulingWorkspaceHash,
  parseScheduleWorkspaceRouteState,
  type ScheduleWorkspaceArea
} from "../scheduleWorkspaceRouting";
import { getTrainingAssignmentWarning, getTrainingSummaryForUser, listTrainingSummaries } from "../services/trainingApi";
import type {
  IntegrationSyncOperationRecord,
  OperationsDashboard,
  OutlookCalendar,
  OutlookCalendarStatusPayload,
  SessionUser,
  ShootSummary,
  TrainingEmployeeSummary
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  initialArea?: ScheduleWorkspaceArea;
};

type ScheduleMember = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[];
};

type TradeRequest = {
  id: string;
  requester_user_id?: string;
  shift_id: string;
  shift_title?: string | null;
  shoot_code?: string | null;
  shoot_title?: string | null;
  department?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  staffing_role?: string | null;
  satisfies_lead_coverage?: boolean;
  requester_name: string;
  approver_user_id?: string | null;
  approver_name?: string | null;
  requested_with_user_id?: string | null;
  requested_with_name?: string | null;
  status: string;
  reason: string;
  same_day_exception_eligible: boolean;
  requested_with_conflict?: boolean;
  conflict_summary?: string | null;
  created_at: string;
};

type PTORequest = {
  id: string;
  user_id?: string;
  user_name: string;
  requested_on: string;
  request_unit: "half_day" | "full_day";
  requested_hours: number;
  status: string;
  reason?: string | null;
  approver_user_id?: string | null;
  approver_name?: string | null;
};

type ShiftFormState = {
  id?: string;
  shoot_id: string;
  assigned_user_id: string;
  manager_user_id: string;
  shift_kind: "shoot" | "studio" | "office" | "training";
  department: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  notes: string;
  rate_code: string;
  hourly_rate_cents: string;
};

type EventFormState = {
  studio_id: string;
  department: string;
  event_kind: "meeting" | "operations" | "travel" | "other";
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  lead_user_id: string;
  notes: string;
};

type OutlookIntegritySnapshot = {
  status: OutlookCalendarStatusPayload | null;
  calendars: OutlookCalendar[];
  syncOperations: IntegrationSyncOperationRecord[];
  error: string;
};

const emptyForm: ShiftFormState = {
  shoot_id: "",
  assigned_user_id: "",
  manager_user_id: "",
  shift_kind: "shoot",
  department: "operations",
  title: "",
  starts_at: "",
  ends_at: "",
  location_name: "",
  location_address: "",
  notes: "",
  rate_code: "shoot",
  hourly_rate_cents: "2500"
};

function emptyEventForm(studioId: string, date: string): EventFormState {
  return {
    studio_id: studioId,
    department: "operations",
    event_kind: "meeting",
    title: "",
    starts_at: `${date}T08:30`,
    ends_at: `${date}T09:00`,
    location_name: "Main Studio",
    location_address: "",
    lead_user_id: "",
    notes: ""
  };
}

export function Scheduling({ token, currentUser, socket, initialArea }: Props) {
  const initialRouteState = parseScheduleWorkspaceRouteState(window.location.hash);
  const [date, setDate] = useState(initialRouteState.date ?? getLocalDateString());
  const [search, setSearch] = useState("");
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [members, setMembers] = useState<ScheduleMember[]>([]);
  const [shoots, setShoots] = useState<ShootSummary[]>([]);
  const [tradeRequests, setTradeRequests] = useState<TradeRequest[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PTORequest[]>([]);
  const [trainingSummaries, setTrainingSummaries] = useState<TrainingEmployeeSummary[]>([]);
  const [outlookStatus, setOutlookStatus] = useState<OutlookCalendarStatusPayload | null>(null);
  const [outlookCalendars, setOutlookCalendars] = useState<OutlookCalendar[]>([]);
  const [outlookSyncOperations, setOutlookSyncOperations] = useState<IntegrationSyncOperationRecord[]>([]);
  const [form, setForm] = useState<ShiftFormState>(emptyForm);
  const [eventForm, setEventForm] = useState<EventFormState>(emptyEventForm("", getLocalDateString()));
  const [selectedShootId, setSelectedShootId] = useState<string | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [selectedTradeId, setSelectedTradeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [outlookSyncLoading, setOutlookSyncLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [outlookSyncError, setOutlookSyncError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [publishCandidate, setPublishCandidate] = useState<{ id: string; title: string } | null>(null);
  const [createShootDrawerOpen, setCreateShootDrawerOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<ScheduleWorkspaceArea>(() => initialRouteState.area ?? initialArea ?? "calendar");

  const canManage = canManageScheduleWorkspace(currentUser);
  const canPublish = canPublishScheduleWorkspace(currentUser);
  const canCreateShoot = canCreateShootRecords(currentUser);
  const canViewOutlookIntegrity = canAccessOutlook(currentUser);
  const canOpenProjects = canAccessGraphicsWorkspace(currentUser);
  const canOpenApprovals = canAccessApprovalsHub(currentUser);
  const canOpenAlerts = canAccessAlertsHub(currentUser);
  const employeeOnlyMode = shouldLimitToEmployeeWorksurface(currentUser);
  const canActOnTrade = (trade: TradeRequest) =>
    canReviewTradeRecord(currentUser, trade.approver_user_id, trade.requester_user_id ?? null, trade.requested_with_user_id ?? null);
  const canActOnPto = (request: PTORequest) => canReviewPtoRecord(currentUser, request.approver_user_id, request.user_id ?? null);
  const defaultStudioId = shoots.find((shoot) => shoot.studio_id)?.studio_id ?? "";
  const visibleTradeRequests = tradeRequests.filter((trade) => trade.status === "pending_manager" && canActOnTrade(trade));
  const visiblePtoRequests = ptoRequests.filter((request) => request.status === "submitted" && canActOnPto(request));
  const workspaceAreas: Array<{ id: ScheduleWorkspaceArea; label: string; summary: string }> = [
    {
      id: "calendar",
      label: employeeOnlyMode ? "My Schedule" : "Calendar",
      summary: employeeOnlyMode
        ? "Keep your day, linked shoots, and live timing in one lighter schedule view."
        : "The live calendar stays primary for timing, linked shoots, and same-day command."
    },
    ...(!employeeOnlyMode
      ? [
          {
            id: "staffing" as const,
            label: "Staffing",
            summary: "Shift drafting, staffing control, and leadership shoot editing stay together here."
          },
          {
            id: "exceptions" as const,
            label: "Exceptions",
            summary: "Trade, PTO, and exception review stay separate from the main planning board."
          }
        ]
      : []),
    ...(canViewOutlookIntegrity
      ? [
          {
            id: "outlook" as const,
            label: "Outlook Integrity",
            summary: "Calendar link health and recovery work stay available without crowding the daily board."
          }
        ]
      : [])
  ];
  const activeAreaDefinition = workspaceAreas.find((area) => area.id === activeArea) ?? workspaceAreas[0];
  const showLeadershipWorkspace = (activeArea === "calendar" || activeArea === "staffing" || activeArea === "exceptions") && (canCreateShoot || canManage);
  const showInlineLeadershipWorkspace = showLeadershipWorkspace && !createShootDrawerOpen;
  const showSecondarySchedulingTools = activeArea === "staffing";
  const showCoverageRequests = activeArea === "exceptions";
  const showSidebar = showLeadershipWorkspace || showSecondarySchedulingTools || showCoverageRequests;

  async function load() {
    setLoading(true);
    try {
      const [dashboardResponse, memberRows, shootRows, tradeRows, ptoRows, summaryRows, outlookIntegrity] = await Promise.all([
        apiFetch<OperationsDashboard>(`/api/dashboard/operations?date=${date}`, token),
        apiFetch<ScheduleMember[]>(`/api/shifts/resources/members?anchor_date=${date}`, token),
        apiFetch<ShootSummary[]>(`/api/shoots?date=${date}`, token).catch(() => []),
        apiFetch<TradeRequest[]>("/api/shifts/trade-requests/list?status=pending_manager", token).catch(() => []),
        apiFetch<PTORequest[]>("/api/shifts/pto-requests/list?status=submitted", token).catch(() => []),
        listTrainingSummaries(token).catch(() => []),
        canViewOutlookIntegrity ? loadOutlookIntegritySnapshot(token, date) : Promise.resolve<OutlookIntegritySnapshot>(emptyOutlookIntegritySnapshot())
      ]);
      setDashboard(dashboardResponse);
      setMembers(memberRows);
      setShoots(shootRows);
      setTradeRequests(tradeRows);
      setPtoRequests(ptoRows);
      setTrainingSummaries(summaryRows);
      setOutlookStatus(outlookIntegrity.status);
      setOutlookCalendars(outlookIntegrity.calendars);
      setOutlookSyncOperations(outlookIntegrity.syncOperations);
      setOutlookSyncError(outlookIntegrity.error);
      setEventForm((current) => ({
        ...current,
        studio_id: current.studio_id || shootRows.find((shoot) => shoot.studio_id)?.studio_id || "",
        starts_at: current.starts_at ? current.starts_at.slice(0, 10) === date ? current.starts_at : `${date}T08:30` : `${date}T08:30`,
        ends_at: current.ends_at ? current.ends_at.slice(0, 10) === date ? current.ends_at : `${date}T09:00` : `${date}T09:00`
      }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load the schedule for this date.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [date, token]);

  useEffect(() => {
    setSelectedTradeId((current) => {
      if (visibleTradeRequests.some((trade) => trade.id === current)) {
        return current;
      }
      return visibleTradeRequests[0]?.id ?? "";
    });
  }, [visibleTradeRequests]);

  useEffect(() => {
    if (!workspaceAreas.some((area) => area.id === activeArea)) {
      setActiveArea(workspaceAreas[0]?.id ?? "calendar");
    }
  }, [activeArea, workspaceAreas]);

  useEffect(() => {
    const routeState = parseScheduleWorkspaceRouteState(window.location.hash);
    const nextArea = routeState.area ?? initialArea ?? "calendar";
    if (nextArea !== activeArea && workspaceAreas.some((area) => area.id === nextArea)) {
      setActiveArea(nextArea);
    }
    if (routeState.date && routeState.date !== date) {
      setDate(routeState.date);
    }
    if (routeState.shootId && routeState.shootId !== selectedShootId) {
      setSelectedShootId(routeState.shootId);
    }
    if (routeState.shiftId && routeState.shiftId !== selectedShiftId) {
      setSelectedShiftId(routeState.shiftId);
    }
  }, [activeArea, date, initialArea, selectedShiftId, selectedShootId, workspaceAreas]);

  function openScheduleArea(area: ScheduleWorkspaceArea) {
    setActiveArea(area);
    window.location.hash = buildSchedulingWorkspaceHash(area, {
      date,
      shootId: selectedShootId,
      shiftId: selectedShiftId
    });
  }

  useEffect(() => {
    setEventForm((current) => ({
      ...current,
      studio_id: current.studio_id || defaultStudioId,
      starts_at: `${date}T${current.starts_at.slice(11, 16) || "08:30"}`,
      ends_at: `${date}T${current.ends_at.slice(11, 16) || "09:00"}`
    }));
  }, [date, defaultStudioId]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onScheduleChanged = (payload: { change_type?: string; title?: string }) => {
      const action = payload.change_type ? payload.change_type.replace(/_/g, " ") : "updated";
      setLiveMessage(`Live update: shift ${action}${payload.title ? ` for ${payload.title}` : ""}`);
      void load();
      clearLiveMessage();
    };
    const onAttendanceChanged = () => {
      setLiveMessage("Live update: labor and attendance totals refreshed.");
      void load();
      clearLiveMessage();
    };

    socket.on("schedule_changed", onScheduleChanged);
    socket.on("attendance_changed", onAttendanceChanged);
    return () => {
      socket.off("schedule_changed", onScheduleChanged);
      socket.off("attendance_changed", onAttendanceChanged);
    };
  }, [date, socket, token]);

  function startCreate() {
    openScheduleArea("staffing");
    setForm({
      ...emptyForm,
      starts_at: `${date}T08:00`,
      ends_at: `${date}T12:00`
    });
    setNotice("");
    setError("");
  }

  function startEdit(shift: OperationsDashboard["shifts"][number]) {
    openScheduleArea("staffing");
    setForm({
      id: shift.id,
      shoot_id: shift.shoot_id ?? "",
      assigned_user_id: shift.assigned_user_id,
      manager_user_id: shift.manager_user_id ?? "",
      shift_kind: shift.shift_kind as ShiftFormState["shift_kind"],
      department: shift.department,
      title: shift.title,
      starts_at: toLocalInput(shift.starts_at),
      ends_at: toLocalInput(shift.ends_at),
      location_name: shift.location_name,
      location_address: shift.location_address,
      notes: "",
      rate_code: shift.segments?.[0]?.rate_code ?? shift.shift_kind,
      hourly_rate_cents: String(shift.segments?.[0]?.hourly_rate_cents ?? 2500)
    });
    setNotice("");
      setError("");
  }

  function openShoot(shootId: string) {
    openScheduleArea("calendar");
    setCreateShootDrawerOpen(false);
    setSelectedShootId(shootId);
    setNotice("");
    setError("");
  }

  async function runOutlookSync() {
    setOutlookSyncLoading(true);
    setOutlookSyncError("");
    setNotice("");
    try {
      await apiFetch(`/api/integrations/outlook/sync?date=${date}`, token, { method: "POST" });
      setNotice("Calendar preview refreshed.");
      await load();
    } catch (err) {
      setOutlookSyncError(err instanceof Error ? err.message : "We couldn't refresh Outlook calendar sync right now.");
    } finally {
      setOutlookSyncLoading(false);
    }
  }

  async function saveShift() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        shoot_id: form.shoot_id || null,
        assigned_user_id: form.assigned_user_id,
        manager_user_id: form.manager_user_id || null,
        shift_kind: form.shift_kind,
        department: form.department,
        title: form.title,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        location_name: form.location_name || undefined,
        location_address: form.location_address || undefined,
        notes: form.notes || null,
        segments: [
          {
            segment_kind: form.shift_kind === "shoot" ? "shoot" : form.shift_kind === "studio" ? "studio_prep" : form.shift_kind,
            label: form.shift_kind === "shoot" ? "Primary segment" : "Scheduled work",
            scheduled_start_at: new Date(form.starts_at).toISOString(),
            scheduled_end_at: new Date(form.ends_at).toISOString(),
            rate_code: form.rate_code,
            hourly_rate_cents: Number(form.hourly_rate_cents),
            sort_order: 0
          }
        ]
      };

      if (form.id) {
        await apiFetch(`/api/shifts/${form.id}`, token, { method: "PATCH", body: JSON.stringify(payload) });
        setNotice("Shift changes saved.");
      } else {
        await apiFetch("/api/shifts", token, { method: "POST", body: JSON.stringify(payload) });
        setNotice("Shift saved as a draft.");
      }

      await load();
      startCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that shift.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEvent() {
    setSavingEvent(true);
    setError("");
    setNotice("");
    try {
      const studioId = eventForm.studio_id || defaultStudioId;
      if (!studioId) {
        throw new Error("No studio is available for new operational events yet.");
      }
      await apiFetch("/api/schedule/events", token, {
        method: "POST",
        body: JSON.stringify({
          studio_id: studioId,
          department: eventForm.department,
          event_kind: eventForm.event_kind,
          title: eventForm.title,
          starts_at: new Date(eventForm.starts_at).toISOString(),
          ends_at: new Date(eventForm.ends_at).toISOString(),
          location_name: eventForm.location_name || null,
          location_address: eventForm.location_address || null,
          lead_user_id: eventForm.lead_user_id || null,
          notes: eventForm.notes || null
        })
      });
      setNotice("Operational event created and added to the unified schedule.");
      setEventForm(emptyEventForm(studioId, date));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't create that operational event.");
    } finally {
      setSavingEvent(false);
    }
  }

  async function publish(shiftId: string) {
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/shifts/${shiftId}/publish`, token, { method: "POST" });
      setNotice("Shift published and ready for the field.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't publish that shift.");
    }
  }

  async function reviewTrade(tradeId: string, status: "approved" | "denied") {
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/shifts/trade-requests/${tradeId}/review`, token, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      setNotice(status === "approved" ? "Trade request approved." : "Trade request denied.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't review that trade request.");
    }
  }

  const summary = dashboard?.summary;
  const filteredShifts = (dashboard?.shifts ?? []).filter((shift) => {
    const haystack = `${shift.title} ${shift.assigned_user_name} ${shift.location_name} ${shift.shoot_title ?? ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const filteredShiftIds = new Set(filteredShifts.map((shift) => shift.id));
  useEffect(() => {
    setSelectedShiftId((current) => {
      if (filteredShiftIds.has(current)) {
        return current;
      }
      return filteredShifts[0]?.id ?? "";
    });
  }, [filteredShifts]);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const trainingSummaryByEmail = new Map(trainingSummaries.map((summary) => [summary.identity.email.toLowerCase(), summary]));
  const selectedAssignedMember = members.find((member) => member.id === form.assigned_user_id) ?? null;
  const outlookAccount = outlookStatus?.account ?? null;
  const activeOutlookCalendars = outlookCalendars.filter((calendar) => calendar.visible_in_app);
  const primaryOutlookCalendar =
    activeOutlookCalendars.find((calendar) => calendar.is_primary) ??
    activeOutlookCalendars[0] ??
    outlookCalendars.find((calendar) => calendar.is_primary) ??
    outlookCalendars[0] ??
    null;
  const outlookProviderLabel =
    outlookAccount?.provider_mode === "graph_live"
      ? "Microsoft 365 delegated preview"
      : outlookAccount?.provider_mode === "mock"
        ? "Mock preview"
        : "Outlook preview";
  const outlookRefreshLabel = outlookAccount?.provider_mode === "graph_live" ? "Refresh Live Preview" : "Refresh Mock Preview";
  const degradedOutlookOperations = outlookSyncOperations.filter((operation) => operation.status === "failed" || operation.status === "conflict");
  const pendingOutlookOperations = outlookSyncOperations.filter((operation) => operation.status === "pending" || operation.status === "processing");
  const exceptionCount = visibleTradeRequests.length + visiblePtoRequests.length;
  const operationsLaneLinks = employeeOnlyMode
    ? []
    : [
        { id: "shoots", label: "Shoots Queue", onClick: () => { window.location.hash = "#operations/shoots"; } },
    ...(canOpenProjects ? [{ id: "projects", label: "Production", onClick: () => { window.location.hash = "#production"; } }] : []),
        ...(canOpenAlerts ? [{ id: "alerts", label: "Alerts", onClick: () => { window.location.hash = "#dashboard/alerts"; } }] : []),
        ...(canOpenApprovals ? [{ id: "approvals", label: "Approvals", onClick: () => { window.location.hash = "#approvals"; } }] : [])
      ];
  const selectedTrainingWarning =
    form.shift_kind === "shoot" && selectedAssignedMember
      ? getTrainingAssignmentWarning(getTrainingSummaryForUser(trainingSummaries, {
          email: selectedAssignedMember.email,
          full_name: selectedAssignedMember.full_name,
          department: selectedAssignedMember.department,
          roles: selectedAssignedMember.roles
        }))
      : null;

  return (
    <div className="workspace-shell">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">{employeeOnlyMode ? "My Schedule" : "Scheduling"}</div>
          <h2>{employeeOnlyMode ? "Personal Schedule Workspace" : "Scheduling Workspace"}</h2>
          <p>
            {employeeOnlyMode
              ? "Keep your assigned work, linked shoots, and same-day schedule context in one lighter workspace."
              : "Scheduling is the labor-planning control layer. Keep staffing pressure, lead coverage, publishing, and exception review connected to the same assignment source of truth."}
          </p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className="metric-pill metric-pill--identity">Scheduler {currentUser.fullName}</div>
          <div className="meta-pill">{activeAreaDefinition?.label ?? "Calendar"}</div>
        </div>
      </section>

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Find Shoot Or Shift</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by code, title, location, or teammate" />
          </label>
        </div>
        <div className="workspace-toolbar__actions">
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {canCreateShoot ? (
            <button
              className="primary-button"
              onClick={() => {
                openScheduleArea("calendar");
                setCreateShootDrawerOpen(true);
                setSelectedShootId(null);
                setNotice("");
                setError("");
              }}
            >
              New Shoot
            </button>
          ) : null}
          {search ? (
            <button className="secondary-button" onClick={() => setSearch("")}>
              Clear Search
            </button>
          ) : null}
        </div>
      </section>

      <section className="metrics-grid workspace-summary-strip">
        <article className="stat-card panel">
          <div className="eyebrow">Shoots In View</div>
          <strong>{shoots.length}</strong>
          <span className="muted">Scheduling keeps shoot timing, staffing coverage, and linked assignment work in one planning surface.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Scheduled Labor</div>
          <strong>{formatHours(summary?.scheduled_labor_hours)}h</strong>
          <span className="muted">Planned labor across published and draft staffing assignments.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Actual Labor</div>
          <strong>{formatHours(summary?.actual_labor_hours)}h</strong>
          <span className="muted">Clocked labor captured through the punch engine.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Flagged Activity</div>
          <strong>{(summary?.unscheduled_punches ?? 0) + (summary?.out_of_bounds_punches ?? 0)}</strong>
          <span className="muted">Soft-control exceptions stay visible without blocking the field.</span>
        </article>
      </section>

      <OperationsLaneStrip
        eyebrow={employeeOnlyMode ? "My Schedule Lanes" : "Scheduling Lanes"}
        title={employeeOnlyMode ? "Choose your schedule focus" : "Work staffing, planning, and exception control by lane"}
        summary={
          activeAreaDefinition?.summary ??
          "Choose the operational slice you want to focus on."
        }
        lanes={workspaceAreas.map((area) => ({
          id: area.id,
          label: area.id === "staffing" ? "Needs Staffing" : area.label,
          summary:
            area.id === "calendar"
              ? "Keep the manager scheduling grid visual first for timing, staffing, and coverage pressure."
              : area.id === "staffing"
                ? "Handle staffing pressure, leadership editing, and shift setup."
                : area.id === "exceptions"
                  ? "Review PTO, trade, and other exception work without crowding the board."
                  : "Keep sync health and recovery work separate from planning.",
          active: activeArea === area.id,
          badge:
            area.id === "exceptions"
              ? exceptionCount
                ? `${exceptionCount} open`
                : null
              : area.id === "outlook"
                ? degradedOutlookOperations.length
                  ? `${degradedOutlookOperations.length} flagged`
                  : pendingOutlookOperations.length
                    ? `${pendingOutlookOperations.length} syncing`
                    : primaryOutlookCalendar
                      ? "Linked"
                      : null
                : null,
          tone:
            area.id === "staffing"
              ? "warning"
              : area.id === "exceptions" && exceptionCount
                ? "warning"
                : area.id === "calendar"
                  ? "info"
                  : "neutral",
          onClick: () => openScheduleArea(area.id)
        }))}
        links={operationsLaneLinks}
      />

      {activeArea === "outlook" && canViewOutlookIntegrity ? (
        <section className="panel schedule-sync-integrity">
          <div className="dashboard-panel__header">
            <div>
              <div className="section-title">Calendar Preview Integrity</div>
              <p className="section-subtitle">
                Mission Control stays primary for scheduling. Outlook only contributes read-only calendar visibility, preview health, and recovery context.
              </p>
            </div>
            <div className="schedule-sync-integrity__actions">
              <button
                className="secondary-button"
                disabled={outlookSyncLoading || outlookAccount?.connection_status !== "connected"}
                onClick={() => void runOutlookSync()}
              >
                {outlookSyncLoading ? "Refreshing..." : outlookRefreshLabel}
              </button>
              <button className="secondary-button" onClick={() => { window.location.hash = "#admin/integrations"; }}>
                Open Outlook Pilot
              </button>
            </div>
          </div>
          {outlookSyncError ? <div className="feedback-strip feedback-strip--warning">{outlookSyncError}</div> : null}
          <div className="schedule-sync-integrity__grid">
            <article className="request-card schedule-sync-integrity__card">
              <div className="eyebrow">Connection</div>
              <strong>{humanizeLabel(outlookAccount?.connection_status ?? "disconnected")}</strong>
              <div className="muted">
                {outlookAccount?.connection_label ?? "Outlook is not connected for this tenant right now."}
              </div>
              <div className="schedule-sync-summary">
                <span className={`status-pill status-pill--${mapOutlookStatusTone(outlookAccount?.connection_status)}`}>
                  Health {humanizeLabel(outlookAccount?.health_state ?? "disconnected")}
                </span>
                <span className="metric-pill">{outlookProviderLabel}</span>
                {outlookAccount?.provider_mode === "graph_live" && outlookAccount.connected_as ? (
                  <span className="metric-pill">Connected as {outlookAccount.connected_as}</span>
                ) : null}
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Provider mode</span>
                  <strong>{outlookAccount?.provider_mode ?? "unconfigured"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Last successful sync</span>
                  <strong>{outlookAccount?.last_sync_at ? new Date(outlookAccount.last_sync_at).toLocaleString() : "Not synced yet"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Last failed sync</span>
                  <strong>{outlookAccount?.last_failed_sync_at ? new Date(outlookAccount.last_failed_sync_at).toLocaleString() : "No failures recorded"}</strong>
                </div>
              </div>
            </article>

            <article className="request-card schedule-sync-integrity__card">
              <div className="eyebrow">Linked Source Calendars</div>
              <strong>{activeOutlookCalendars.length ? `${activeOutlookCalendars.length} visible in Mission Control` : "No calendars in view"}</strong>
              <div className="muted">
                {primaryOutlookCalendar
                  ? `${primaryOutlookCalendar.name}${primaryOutlookCalendar.is_primary ? " is the primary linked calendar." : " is currently the lead linked source."}`
                  : "Mission Control is not drawing from any Outlook calendar yet."}
              </div>
              <div className="schedule-sync-summary">
                {activeOutlookCalendars.slice(0, 3).map((calendar) => (
                  <span key={calendar.id} className="meta-pill">
                    {calendar.name}
                  </span>
                ))}
                {activeOutlookCalendars.length > 3 ? <span className="meta-pill">+{activeOutlookCalendars.length - 3} more</span> : null}
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Primary source</span>
                  <strong>{primaryOutlookCalendar?.name ?? "Not linked"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Hidden calendars</span>
                  <strong>{Math.max(outlookCalendars.length - activeOutlookCalendars.length, 0)}</strong>
                </div>
              </div>
            </article>

            <article className="request-card schedule-sync-integrity__card">
              <div className="eyebrow">Recovery Watch</div>
              <strong>{degradedOutlookOperations.length} issue{degradedOutlookOperations.length === 1 ? "" : "s"} need review</strong>
              <div className="muted">
                {degradedOutlookOperations[0]?.last_error ??
                  degradedOutlookOperations[0]?.conflict_summary ??
                  "No failed or conflicted sync operations are waiting right now."}
              </div>
              <div className="schedule-sync-summary">
                <span className="metric-pill">Pending {pendingOutlookOperations.length}</span>
                <span className="metric-pill">Warnings {outlookAccount?.warning_count ?? 0}</span>
                <span className="metric-pill">Errors {outlookAccount?.error_count ?? 0}</span>
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Recent failures or conflicts</span>
                  <strong>{degradedOutlookOperations.length}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Pending sync work</span>
                  <strong>{pendingOutlookOperations.length}</strong>
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {notice ? <div className="success-banner">{notice}</div> : null}
      {error ? (
        <div className="inline-banner-actions">
          <div className="error-banner">{error}</div>
          <button className="secondary-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}
      {liveMessage ? <div className="live-banner">{liveMessage}</div> : null}
      {loading && dashboard ? <div className="live-banner">Refreshing schedule details...</div> : null}
      {loading && !dashboard ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading schedule</div>
          <p className="section-subtitle">Pulling the unified schedule, roster, staffing context, and the secondary review queues for this date.</p>
        </section>
      ) : null}

      {activeArea !== "outlook" ? (
      <section className="schedule-layout workspace-main">
        <div className="schedule-primary-stack">
          {activeArea === "calendar" ? (
            <UnifiedScheduleSurface
              workspaceMode="scheduling"
              token={token}
              anchorDate={date}
              search={search}
              members={members}
              currentUser={currentUser}
              onOpenShoot={openShoot}
              onOpenStaffing={(shoot) => {
                setSelectedShootId(shoot.id);
                setActiveArea(employeeOnlyMode ? "calendar" : "staffing");
                window.location.hash = buildSchedulingWorkspaceHash(employeeOnlyMode ? "calendar" : "staffing", {
                  date,
                  shootId: shoot.id
                });
                setError("");
                setNotice("");
              }}
              onOpenShift={(shift) => {
                setSelectedShiftId(shift.id);
                setSelectedShootId(shift.shoot_id ?? null);
                setActiveArea(employeeOnlyMode ? "calendar" : "staffing");
                window.location.hash = buildSchedulingWorkspaceHash(employeeOnlyMode ? "calendar" : "staffing", {
                  date,
                  shootId: shift.shoot_id ?? null,
                  shiftId: shift.id
                });
                setError("");
                setNotice("");
              }}
              onNotice={setNotice}
              onError={setError}
            />
          ) : null}

          {activeArea === "staffing" ? (
          <section className="panel schedule-calendar">
            <div className="section-title">Shift Roster</div>
            <p className="section-subtitle">
              Draft and published shifts stay editable below the unified calendar so staffing, attendance, and payroll-ready time remain anchored to the same shoot records.
            </p>
            <div className="ops-preview-list">
              {filteredShifts.map((shift) => (
                <div key={shift.id}>
                  <OperationalPreviewCard
                    eyebrow={humanizeLabel(shift.shift_kind)}
                    title={shift.title}
                    summary={`${shift.assigned_user_name} | ${formatShiftWindow(shift.starts_at, shift.ends_at)}`}
                    owner={shift.manager_name ?? "Auto route"}
                    statusLabel={humanizeLabel(shift.status)}
                    statusTone={shift.status === "published" ? "success" : "warning"}
                    meta={[
                      { label: humanizeLabel(shift.department) },
                      { label: `Role ${humanizeLabel(shift.staffing_role)}` },
                      { label: shift.location_name || shift.shoot_title || "Location pending" }
                    ]}
                    flags={[
                      ...(shift.satisfies_lead_coverage ? [{ label: "Lead coverage", tone: "success" as const }] : []),
                      ...(Number(shift.open_exception_count ?? 0) > 0 ? [{ label: `${Number(shift.open_exception_count ?? 0)} open exception${Number(shift.open_exception_count ?? 0) === 1 ? "" : "s"}`, tone: "critical" as const }] : []),
                      ...(shift.latest_punch_direction ? [{ label: `Clock ${humanizeLabel(shift.latest_punch_direction)}`, tone: "neutral" as const }] : [])
                    ]}
                    nextAction={
                      canPublish && shift.status !== "published"
                        ? "Publish shift"
                        : canManage
                          ? "Review detail"
                          : "Open linked shoot"
                    }
                    selected={selectedShiftId === shift.id}
                    onClick={() => setSelectedShiftId((current) => (current === shift.id ? "" : shift.id))}
                  />
                  {selectedShiftId === shift.id ? (() => {
                    const assignedMember = memberById.get(shift.assigned_user_id);
                    const trainingSummary =
                      shift.shift_kind === "shoot"
                        ? trainingSummaryByEmail.get((shift.assigned_user_email ?? assignedMember?.email ?? "").toLowerCase()) ??
                          getTrainingSummaryForUser(trainingSummaries, {
                            email: shift.assigned_user_email ?? assignedMember?.email,
                            full_name: shift.assigned_user_name,
                            department: assignedMember?.department ?? shift.department,
                            roles: assignedMember?.roles ?? []
                          })
                        : null;
                    return (
                      <div className="preview-detail-panel preview-detail-panel--inline">
                        <div className="preview-detail-panel__header">
                          <div>
                            <div className="eyebrow">Shift Detail</div>
                            <strong>{shift.title}</strong>
                          </div>
                          <span className="meta-pill">{formatHours(shift.scheduled_hours)}h planned</span>
                        </div>
                        <div className="dashboard-summary-list">
                          <div className="dashboard-summary-row">
                            <span className="muted">Assigned</span>
                            <strong>{shift.assigned_user_name}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Location</span>
                            <strong>{shift.location_name || shift.location_address || "Location pending"}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Attendance</span>
                            <strong>{shift.attendance_state ? humanizeLabel(shift.attendance_state) : "Pending"}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Segments</span>
                            <strong>{shift.segments?.length ? shift.segments.map((segment) => segment.label).join(", ") : "No segments saved"}</strong>
                          </div>
                        </div>
                        {trainingSummary ? (
                          <div className="training-shift-callout">
                            <TrainingReadinessBadge state={trainingSummary.readiness_state} compact />
                            <span className="muted">{trainingSummary.readiness_note}</span>
                          </div>
                        ) : null}
                        <div className="preview-detail-panel__actions">
                          {shift.shoot_id ? (
                            <button className="secondary-button" onClick={() => openShoot(shift.shoot_id!)}>
                              Open Shoot
                            </button>
                          ) : null}
                          {canManage ? (
                            <button className="secondary-button" onClick={() => startEdit(shift)}>
                              Edit Shift
                            </button>
                          ) : null}
                          {canPublish && shift.status !== "published" ? (
                            <button className="primary-button" onClick={() => setPublishCandidate({ id: shift.id, title: shift.title })}>
                              Publish
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })() : null}
                </div>
              ))}
              {!loading && !filteredShifts.length ? <div className="empty-state">No shifts match this search yet.</div> : null}
            </div>
          </section>
          ) : null}

          {activeArea === "exceptions" ? (
            <section className="panel schedule-calendar">
              <div className="section-title">Exception Triage</div>
              <p className="section-subtitle">
                Keep manager review work focused here so the calendar and staffing boards stay quieter during active planning.
              </p>
              <div className="detail-two-column">
                <article className="request-card">
                  <div className="eyebrow">Trade Review Queue</div>
                  <strong>{visibleTradeRequests.length}</strong>
                  <div className="muted">Trade requests that still need manager review or same-day coverage attention.</div>
                </article>
                <article className="request-card">
                  <div className="eyebrow">PTO Review Queue</div>
                  <strong>{visiblePtoRequests.length}</strong>
                  <div className="muted">Time-off requests waiting on leadership action before staffing plans can settle.</div>
                </article>
              </div>
            </section>
          ) : null}
        </div>

        {showSidebar ? (
        <aside className="panel schedule-sidebar workspace-rail">
          {showInlineLeadershipWorkspace ? (
            <section>
              <LeadershipShootWorkspace
                token={token}
                currentUser={currentUser}
                members={members}
                selectedShootId={selectedShootId}
                defaultDate={date}
                defaultStudioId={defaultStudioId}
                canCreateShoot={canCreateShoot}
                canManage={canManage}
                canPublish={canPublish}
                onSelectShoot={setSelectedShootId}
                onSaved={() => {
                  void load();
                }}
                onNotice={setNotice}
                onError={setError}
              />
            </section>
          ) : null}
          {showLeadershipWorkspace && !showInlineLeadershipWorkspace ? (
            <section>
              <article className="request-card">
                <div className="eyebrow">Shoot Workspace</div>
                <strong>Creating a new shoot</strong>
                <div className="muted">The focused shoot composer is open in a drawer so the calendar stays visible while you work.</div>
                <div className="page-intro-actions page-intro-actions--compact">
                  <button className="secondary-button" type="button" onClick={() => setCreateShootDrawerOpen(true)}>
                    Return To New Shoot
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {showSecondarySchedulingTools ? (
          <div className={canCreateShoot || canManage ? "sidebar-section with-divider" : ""}>
            <OperationalDetailSection
              title="Secondary Scheduling Tools"
              summary="Non-shoot events and manual shift drafting stay available here without crowding the main leadership scheduling workflow."
            >
              {canManage ? (
                <section>
                  <OperationalDetailSection title="Operational Event Composer" summary="Add meetings, travel blocks, and other non-shoot events to the same operational calendar.">
                    <div className="field-grid">
                      <label className="filter-field">
                        <span>Department</span>
                        <select value={eventForm.department} onChange={(event) => setEventForm((current) => ({ ...current, department: event.target.value }))}>
                          <option value="executive">Executive</option>
                          <option value="operations">Operations</option>
                          <option value="schools">Schools</option>
                          <option value="sports">Sports</option>
                          <option value="office">Office</option>
                          <option value="production">Production</option>
                          <option value="customer_service">Customer Service</option>
                        </select>
                      </label>
                      <label className="filter-field">
                        <span>Kind</span>
                        <select value={eventForm.event_kind} onChange={(event) => setEventForm((current) => ({ ...current, event_kind: event.target.value as EventFormState["event_kind"] }))}>
                          <option value="meeting">Meeting</option>
                          <option value="operations">Operations</option>
                          <option value="travel">Travel</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className="filter-field">
                        <span>Title</span>
                        <input value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} />
                      </label>
                      <label className="filter-field">
                        <span>Lead</span>
                        <select value={eventForm.lead_user_id} onChange={(event) => setEventForm((current) => ({ ...current, lead_user_id: event.target.value }))}>
                          <option value="">No lead assigned</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.full_name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="filter-field">
                        <span>Starts</span>
                        <input type="datetime-local" value={eventForm.starts_at} onChange={(event) => setEventForm((current) => ({ ...current, starts_at: event.target.value }))} />
                      </label>
                      <label className="filter-field">
                        <span>Ends</span>
                        <input type="datetime-local" value={eventForm.ends_at} onChange={(event) => setEventForm((current) => ({ ...current, ends_at: event.target.value }))} />
                      </label>
                      <label className="filter-field">
                        <span>Location Name</span>
                        <input value={eventForm.location_name} onChange={(event) => setEventForm((current) => ({ ...current, location_name: event.target.value }))} />
                      </label>
                      <label className="filter-field">
                        <span>Address</span>
                        <input value={eventForm.location_address} onChange={(event) => setEventForm((current) => ({ ...current, location_address: event.target.value }))} />
                      </label>
                      <label className="filter-field filter-field--wide">
                        <span>Notes</span>
                        <textarea value={eventForm.notes} onChange={(event) => setEventForm((current) => ({ ...current, notes: event.target.value }))} rows={3} />
                      </label>
                    </div>

                    <div className="schedule-sidebar-actions">
                      <button className="secondary-button" onClick={() => setEventForm(emptyEventForm(defaultStudioId, date))}>
                        Reset Event
                      </button>
                      <button className="primary-button" disabled={savingEvent || !eventForm.title} onClick={() => void saveEvent()}>
                        {savingEvent ? "Saving..." : "Create Event"}
                      </button>
                    </div>
                  </OperationalDetailSection>
                </section>
              ) : null}

              <section className={canManage ? "sidebar-section" : ""}>
                <OperationalDetailSection
                  key={form.id ?? "shift-builder"}
                  title={form.id ? "Edit Initial Schedule" : "Initial Schedule Builder"}
                  summary={form.id ? `Editing ${form.title || "selected shift"}` : "Draft and publish shifts from the same page."}
                  defaultOpen={Boolean(form.id)}
                >
                  <div className="field-grid">
                    <label className="filter-field">
                      <span>Assigned Employee</span>
                      <select value={form.assigned_user_id} onChange={(event) => setForm((current) => ({ ...current, assigned_user_id: event.target.value }))}>
                        <option value="">Select employee</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.full_name} ({member.roles.join(", ")})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="filter-field">
                      <span>Manager</span>
                      <select value={form.manager_user_id} onChange={(event) => setForm((current) => ({ ...current, manager_user_id: event.target.value }))}>
                        <option value="">Auto route by role</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.full_name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="filter-field">
                      <span>Kind</span>
                      <select value={form.shift_kind} onChange={(event) => setForm((current) => ({ ...current, shift_kind: event.target.value as ShiftFormState["shift_kind"] }))}>
                        <option value="shoot">Shoot</option>
                        <option value="studio">Studio</option>
                        <option value="office">Office</option>
                        <option value="training">Training</option>
                      </select>
                    </label>

                    <label className="filter-field">
                      <span>Department</span>
                      <select value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))}>
                        <option value="executive">Executive</option>
                        <option value="operations">Operations</option>
                        <option value="schools">Schools</option>
                        <option value="sports">Sports</option>
                        <option value="office">Office</option>
                        <option value="production">Production</option>
                        <option value="customer_service">Customer Service</option>
                        <option value="unassigned">Unassigned</option>
                      </select>
                    </label>

                    <label className="filter-field">
                      <span>Linked Shoot</span>
                      <select value={form.shoot_id} onChange={(event) => setForm((current) => ({ ...current, shoot_id: event.target.value }))}>
                        <option value="">Standalone shift</option>
                        {shoots.map((shoot) => (
                          <option key={shoot.id} value={shoot.id}>
                            {shoot.shoot_code} | {shoot.title}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="filter-field">
                      <span>Title</span>
                      <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                    </label>

                    <label className="filter-field">
                      <span>Starts</span>
                      <input type="datetime-local" value={form.starts_at} onChange={(event) => setForm((current) => ({ ...current, starts_at: event.target.value }))} />
                    </label>

                    <label className="filter-field">
                      <span>Ends</span>
                      <input type="datetime-local" value={form.ends_at} onChange={(event) => setForm((current) => ({ ...current, ends_at: event.target.value }))} />
                    </label>

                    <label className="filter-field">
                      <span>Location Name</span>
                      <input value={form.location_name} onChange={(event) => setForm((current) => ({ ...current, location_name: event.target.value }))} />
                    </label>

                    <label className="filter-field">
                      <span>Location Address</span>
                      <input value={form.location_address} onChange={(event) => setForm((current) => ({ ...current, location_address: event.target.value }))} />
                    </label>

                    <label className="filter-field">
                      <span>Rate Code</span>
                      <input value={form.rate_code} onChange={(event) => setForm((current) => ({ ...current, rate_code: event.target.value }))} />
                    </label>

                    <label className="filter-field">
                      <span>Hourly Rate (cents)</span>
                      <input value={form.hourly_rate_cents} onChange={(event) => setForm((current) => ({ ...current, hourly_rate_cents: event.target.value }))} />
                    </label>

                    <label className="filter-field filter-field--wide">
                      <span>Notes</span>
                      <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={4} />
                    </label>
                  </div>

                  {selectedTrainingWarning ? (
                    <div className={`request-card training-assignment-warning training-assignment-warning--${selectedTrainingWarning.tone}`}>
                      <div className="training-assignment-warning__header">
                        <TrainingReadinessBadge state={selectedTrainingWarning.state} compact />
                        <strong>{selectedTrainingWarning.label}</strong>
                      </div>
                      <div className="muted">{selectedTrainingWarning.note}</div>
                      {selectedAssignedMember ? (
                        <button
                          className="secondary-button"
                          onClick={() => {
                            window.location.hash = `#employees/training?employee=${encodeURIComponent(selectedAssignedMember.email)}`;
                          }}
                        >
                          Open Training Profile
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="schedule-sidebar-actions">
                    <button className="secondary-button" onClick={startCreate}>
                      Reset
                    </button>
                    {canManage ? (
                      <button className="primary-button" disabled={saving || !form.assigned_user_id || !form.title} onClick={() => void saveShift()}>
                        {saving ? "Saving..." : form.id ? "Save Shift" : "Create Shift"}
                      </button>
                    ) : null}
                  </div>
                </OperationalDetailSection>
              </section>
            </OperationalDetailSection>
          </div>
          ) : null}

          {showCoverageRequests ? (
          <section className="sidebar-section">
            <OperationalDetailSection
              title="Coverage Requests"
              summary="Trade and PTO review stay available here without taking over the schedule board."
              defaultOpen={Boolean(visibleTradeRequests.length || visiblePtoRequests.length)}
            >
              <div className="dashboard-stack">
                <section>
                  <div className="section-title">Trade Review Queue</div>
                  {visibleTradeRequests.length ? (
                    <div className="preview-detail-layout">
                      <div className="ops-preview-list">
                        {visibleTradeRequests.map((trade) => (
                          <OperationalPreviewCard
                            key={trade.id}
                            eyebrow={trade.shoot_code ?? humanizeLabel(trade.department ?? "schedule")}
                            title={trade.requester_name}
                            summary={trade.shift_title ?? trade.shoot_title ?? "Shift trade request"}
                            owner={trade.approver_name ?? trade.requested_with_name ?? "Manager review"}
                            statusLabel={humanizeLabel(trade.status)}
                            statusTone={trade.status === "pending_manager" ? "warning" : trade.status === "approved" ? "success" : "critical"}
                            meta={[
                              { label: trade.starts_at && trade.ends_at ? formatShiftWindow(trade.starts_at, trade.ends_at) : "Time pending" },
                              { label: trade.staffing_role ? humanizeLabel(trade.staffing_role) : "Role pending" }
                            ]}
                            flags={[
                              ...(trade.same_day_exception_eligible ? [{ label: "Same day", tone: "warning" as const }] : []),
                              ...(trade.satisfies_lead_coverage || trade.staffing_role === "lead_photographer" || trade.staffing_role === "senior_photographer"
                                ? [{ label: "Lead coverage risk", tone: "critical" as const }]
                                : []),
                              ...(trade.requested_with_conflict ? [{ label: "Conflict warning", tone: "critical" as const }] : [])
                            ]}
                            nextAction={canActOnTrade(trade) ? "Approve or deny" : "Await manager review"}
                            selected={selectedTradeId === trade.id}
                            onClick={() => setSelectedTradeId((current) => (current === trade.id ? "" : trade.id))}
                          />
                        ))}
                      </div>
                      <aside className="preview-detail-panel">
                        {(() => {
                          const selectedTrade = visibleTradeRequests.find((trade) => trade.id === selectedTradeId) ?? visibleTradeRequests[0];
                          if (!selectedTrade) {
                            return <div className="empty-state">No trade requests are waiting for review.</div>;
                          }
                          return (
                            <>
                              <div className="preview-detail-panel__header">
                                <div>
                                  <div className="eyebrow">Manager Trade Review</div>
                                  <strong>{selectedTrade.requester_name}</strong>
                                </div>
                                <span className="meta-pill">{humanizeLabel(selectedTrade.status)}</span>
                              </div>
                              <div className="dashboard-summary-list">
                                <div className="dashboard-summary-row">
                                  <span className="muted">Shift</span>
                                  <strong>{selectedTrade.shift_title ?? selectedTrade.shoot_title ?? "Trade request"}</strong>
                                </div>
                                <div className="dashboard-summary-row">
                                  <span className="muted">Requested with</span>
                                  <strong>{selectedTrade.requested_with_name ?? "Open release request"}</strong>
                                </div>
                                <div className="dashboard-summary-row">
                                  <span className="muted">Approver</span>
                                  <strong>{selectedTrade.approver_name ?? "Auto-routed"}</strong>
                                </div>
                                <div className="dashboard-summary-row">
                                  <span className="muted">Role impact</span>
                                  <strong>
                                    {selectedTrade.satisfies_lead_coverage || selectedTrade.staffing_role === "lead_photographer" || selectedTrade.staffing_role === "senior_photographer"
                                      ? "Touches lead or senior coverage"
                                      : "Standard staffing coverage"}
                                  </strong>
                                </div>
                                <div className="dashboard-summary-row">
                                  <span className="muted">Conflict check</span>
                                  <strong>{selectedTrade.requested_with_conflict ? "Potential overlap found" : "No known overlap in preview"}</strong>
                                </div>
                              </div>
                              {selectedTrade.conflict_summary ? <div className="feedback-strip feedback-strip--warning">{selectedTrade.conflict_summary}</div> : null}
                              <div className="muted">{selectedTrade.reason}</div>
                              {canActOnTrade(selectedTrade) ? (
                                <div className="preview-detail-panel__actions">
                                  <button className="secondary-button" onClick={() => void reviewTrade(selectedTrade.id, "denied")}>
                                    Deny
                                  </button>
                                  <button className="primary-button" onClick={() => void reviewTrade(selectedTrade.id, "approved")}>
                                    Approve
                                  </button>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </aside>
                    </div>
                  ) : (
                    <div className="empty-state">No manager trade reviews are waiting right now.</div>
                  )}
                </section>

                <section>
                  <div className="section-title">PTO Review Queue</div>
                  <div className="ops-preview-list">
                    {visiblePtoRequests.map((pto) => (
                      <OperationalPreviewCard
                        key={pto.id}
                        eyebrow="PTO"
                        title={pto.user_name}
                        summary={`${pto.requested_on} | ${pto.request_unit === "half_day" ? "Half day" : "Full day"} | ${pto.requested_hours}h`}
                        owner={pto.approver_name ?? "Manager review"}
                        statusLabel={humanizeLabel(pto.status)}
                        statusTone={pto.status === "submitted" ? "warning" : pto.status === "approved" ? "success" : "critical"}
                        nextAction={canActOnPto(pto) ? "Review request" : "Await decision"}
                      />
                    ))}
                  </div>
                  {!visiblePtoRequests.length ? <div className="empty-state">No PTO requests are waiting for review.</div> : null}
                </section>
              </div>
            </OperationalDetailSection>
          </section>
          ) : null}
        </aside>
        ) : null}
      </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(publishCandidate)}
        title={publishCandidate ? `Publish ${publishCandidate.title}?` : ""}
        body="Publishing sends the shift to the employee-facing schedule and downstream operational views. Draft edits will no longer stay private."
        confirmLabel="Publish Shift"
        onCancel={() => setPublishCandidate(null)}
        onConfirm={() => {
          if (!publishCandidate) {
            return;
          }
          const { id } = publishCandidate;
          setPublishCandidate(null);
          void publish(id);
        }}
      />
      <OverlayPanel open={createShootDrawerOpen} ariaLabel="New Shoot" onClose={() => setCreateShootDrawerOpen(false)} contentClassName="workflow-overlay__content--wide">
        <div className="panel workflow-dialog-panel">
          <LeadershipShootWorkspace
            token={token}
            currentUser={currentUser}
            members={members}
            selectedShootId={null}
            defaultDate={date}
            defaultStudioId={defaultStudioId}
            canCreateShoot={canCreateShoot}
            canManage={canManage}
            canPublish={canPublish}
            onSelectShoot={setSelectedShootId}
            onSaved={() => {
              setCreateShootDrawerOpen(false);
              void load();
            }}
            onNotice={setNotice}
            onError={setError}
          />
        </div>
      </OverlayPanel>
    </div>
  );
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatShiftWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleString()} - ${end.toLocaleTimeString()}`;
  }
  return `${start.toLocaleString()} - ${end.toLocaleString()}`;
}

function formatHours(value: number | string | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }
  return numeric.toFixed(2);
}

function emptyOutlookIntegritySnapshot(): OutlookIntegritySnapshot {
  return {
    status: null,
    calendars: [],
    syncOperations: [],
    error: ""
  };
}

async function loadOutlookIntegritySnapshot(token: string, date: string): Promise<OutlookIntegritySnapshot> {
  const [statusResult, calendarsResult, operationsResult] = await Promise.allSettled([
    apiFetch<OutlookCalendarStatusPayload>(`/api/integrations/outlook/status?date=${date}`, token),
    apiFetch<OutlookCalendar[]>(`/api/integrations/outlook/calendars?date=${date}`, token),
    apiFetch<IntegrationSyncOperationRecord[]>("/api/integrations/sync-operations?provider=outlook", token)
  ]);

  const status = statusResult.status === "fulfilled" ? statusResult.value : null;
  const calendars = calendarsResult.status === "fulfilled" ? calendarsResult.value : [];
  const syncOperations = operationsResult.status === "fulfilled" ? operationsResult.value : [];
  const failedResults = [statusResult, calendarsResult, operationsResult].filter((result) => result.status === "rejected");
  const error =
    failedResults.length > 0
      ? failedResults
          .map((result) => (result.status === "rejected" && result.reason instanceof Error ? result.reason.message : "Calendar sync details are unavailable right now."))
          .join(" ")
      : "";

  return {
    status,
    calendars,
    syncOperations,
    error
  };
}

function mapOutlookStatusTone(status?: string | null) {
  if (status === "connected") {
    return "connected";
  }
  if (status === "attention") {
    return "error";
  }
  return "connecting";
}
