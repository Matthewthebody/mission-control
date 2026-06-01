import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { ShootBriefingBody } from "./ShootBriefing";
import { ShootHotSheetCard } from "./ShootHotSheetCard";
import { buildMonthGrid, buildShootBriefing } from "../services/shootHotSheet";
import { getPrimaryBusinessRole, shouldLimitToEmployeeWorksurface } from "../permissions";
import type {
  ShiftRecord,
  ScheduleRecordIntegrationState,
  SessionUser,
  ShootDetail,
  ShootSummary,
  StaffingTemplateRecord,
  UnifiedScheduleAvailabilityItem,
  UnifiedScheduleBoardResponse,
  UnifiedScheduleCalendarResponse,
  UnifiedScheduleEventItem,
  UnifiedScheduleItem,
  UnifiedScheduleShootItem
} from "../types";

type ScheduleMemberOption = {
  id: string;
  full_name: string;
  department: string;
  roles: string[];
};

type Props = {
  workspaceMode?: "scheduling" | "schedule";
  initialView?: "jobs" | "staffing" | "assignment_board";
  initialRange?: ScheduleRangeMode;
  token: string;
  anchorDate: string;
  search: string;
  members: ScheduleMemberOption[];
  currentUser: SessionUser;
  onOpenShoot: (shootId: string) => void;
  onOpenStaffing?: (shoot: UnifiedScheduleShootItem) => void;
  onOpenShift?: (shift: ShiftRecord) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type WindowMode = "today" | "3day" | "week" | "30day";
type ScheduleGridMode = "day" | "week" | "month";
type ScheduleRangeMode = "day" | "3day" | "week" | "30day";
type ScheduleLayoutMode = "grid" | "list";
type SurfaceMode = "schedule" | "board";
type BoardGroup = "status" | "department" | "lead_photographer" | "day_part";
type StaffingDisplayMode = "shoots_only" | "show_assignments";

type BulkEditState = {
  department: string;
  status: string;
  targetDate: string;
  templateId: string;
};

const emptyBulkEdit: BulkEditState = {
  department: "",
  status: "",
  targetDate: "",
  templateId: ""
};

export function UnifiedScheduleSurface({
  workspaceMode = "scheduling",
  initialView = "jobs",
  initialRange = "week",
  token,
  anchorDate,
  search,
  members,
  currentUser,
  onOpenShoot,
  onOpenStaffing,
  onOpenShift,
  onNotice,
  onError
}: Props) {
  const businessRole = getPrimaryBusinessRole(currentUser);
  const employeeOnlyMode = shouldLimitToEmployeeWorksurface(currentUser);
  const schedulingWorkspace = workspaceMode === "scheduling";
  const scheduleWorkspace = workspaceMode === "schedule";
  const canManage = schedulingWorkspace && currentUser.permissions.includes("schedule.manage");
  const canViewBroaderAssignments = !employeeOnlyMode;
  const [isNarrowLayout, setIsNarrowLayout] = useState(() => matchesNarrowScheduleLayout());
  const [rangeMode, setRangeMode] = useState<ScheduleRangeMode>(initialRange);
  const [layoutMode, setLayoutMode] = useState<ScheduleLayoutMode>("grid");
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("schedule");
  const [groupBy, setGroupBy] = useState<BoardGroup>("status");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [leadUserId, setLeadUserId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [staffingRoleFilter, setStaffingRoleFilter] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [shootTypeFilter, setShootTypeFilter] = useState("");
  const [staffingHealthFilter, setStaffingHealthFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [myItemsOnly, setMyItemsOnly] = useState(scheduleWorkspace || employeeOnlyMode);
  const [staffingDisplayMode, setStaffingDisplayMode] = useState<StaffingDisplayMode>(
    scheduleWorkspace || employeeOnlyMode || businessRole === "shoot_lead" ? "show_assignments" : "shoots_only"
  );
  const [calendarResponse, setCalendarResponse] = useState<UnifiedScheduleCalendarResponse | null>(null);
  const [boardResponse, setBoardResponse] = useState<UnifiedScheduleBoardResponse | null>(null);
  const [shiftRows, setShiftRows] = useState<ShiftRecord[]>([]);
  const [templates, setTemplates] = useState<StaffingTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [movingItemId, setMovingItemId] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState<Record<string, ShootDetail>>({});
  const [selectedShootIds, setSelectedShootIds] = useState<string[]>([]);
  const [bulkEdit, setBulkEdit] = useState<BulkEditState>(emptyBulkEdit);
  const [applyingBulkEdit, setApplyingBulkEdit] = useState(false);
  const [integrationActionKey, setIntegrationActionKey] = useState("");
  const windowMode = mapScheduleRangeToWindow(rangeMode);
  const gridMode: ScheduleGridMode = rangeMode === "30day" ? "month" : rangeMode === "day" ? "day" : "week";
  const range = useMemo(() => getClientWindowRange(anchorDate, windowMode), [anchorDate, windowMode]);
  const shouldLoadBoard = canManage && schedulingWorkspace && surfaceMode === "board";
  const shouldLoadShiftRows =
    schedulingWorkspace ||
    layoutMode === "list" ||
    gridMode !== "month" ||
    employeeOnlyMode ||
    staffingDisplayMode === "show_assignments";

  const query = useMemo(() => {
    const params = new URLSearchParams({
      anchor_date: anchorDate,
      window: windowMode
    });
    if (departmentFilter) {
      params.set("department", departmentFilter);
    }
    if (statusFilter) {
      params.set("status", statusFilter);
    }
    if (leadUserId) {
      params.set("lead_user_id", leadUserId);
    }
    const effectiveEmployeeId = myItemsOnly ? currentUser.id : employeeId;
    if (effectiveEmployeeId) {
      params.set("employee_id", effectiveEmployeeId);
    }
    if (locationQuery.trim()) {
      params.set("location_query", locationQuery.trim());
    }
    return params.toString();
  }, [anchorDate, currentUser.id, departmentFilter, employeeId, leadUserId, locationQuery, myItemsOnly, statusFilter, windowMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent | MediaQueryList) => void) => void;
    };
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsNarrowLayout(event.matches);
    };

    handleChange(mediaQuery);

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    legacyMediaQuery.addListener?.(handleChange);
    return () => legacyMediaQuery.removeListener?.(handleChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const shiftQuery = new URLSearchParams({
      date_from: range.startDate,
      date_to: range.endDate
    });
    const effectiveEmployeeId = myItemsOnly ? currentUser.id : employeeId;
    if (effectiveEmployeeId) {
      shiftQuery.set("assigned_user_id", effectiveEmployeeId);
    }
    if (statusFilter) {
      shiftQuery.set("status", statusFilter);
    }
    void Promise.all([
      apiFetch<UnifiedScheduleCalendarResponse>(`/api/schedule/calendar?${query}`, token),
      shouldLoadBoard
        ? apiFetch<UnifiedScheduleBoardResponse>(`/api/schedule/board?${query}&group_by=${groupBy}`, token)
        : Promise.resolve<UnifiedScheduleBoardResponse | null>(null),
      shouldLoadShiftRows ? apiFetch<ShiftRecord[]>(`/api/shifts?${shiftQuery.toString()}`, token).catch(() => []) : Promise.resolve<ShiftRecord[]>([]),
      canManage ? apiFetch<StaffingTemplateRecord[]>(`/api/schedule/staffing-templates${departmentFilter ? `?department=${departmentFilter}` : ""}`, token) : Promise.resolve([])
    ])
      .then(([calendar, board, shiftList, templateRows]) => {
        if (cancelled) {
          return;
        }
        setCalendarResponse(calendar);
        setBoardResponse(board);
        setShiftRows(shiftList);
        setTemplates(templateRows);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        onError(error instanceof Error ? error.message : "We couldn't load the unified schedule.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, currentUser.id, departmentFilter, employeeId, groupBy, myItemsOnly, onError, query, range.endDate, range.startDate, shouldLoadBoard, shouldLoadShiftRows, statusFilter, token]);

  useEffect(() => {
    if (employeeOnlyMode) {
      setMyItemsOnly(true);
    }
  }, [employeeOnlyMode]);

  useEffect(() => {
    if (scheduleWorkspace) {
      setSurfaceMode("schedule");
      setStaffingDisplayMode("show_assignments");
      setMyItemsOnly(true);
    }
  }, [scheduleWorkspace]);

  useEffect(() => {
    if (initialView === "assignment_board") {
      if (canManage) {
        setSurfaceMode("board");
        setMyItemsOnly(false);
      } else {
        setSurfaceMode("schedule");
        setLayoutMode("list");
        setStaffingDisplayMode("show_assignments");
      }
      return;
    }

    setSurfaceMode("schedule");

    if (initialView === "staffing") {
      setLayoutMode("list");
      setStaffingDisplayMode("show_assignments");
      if (!employeeOnlyMode && schedulingWorkspace) {
        setMyItemsOnly(false);
      }
      return;
    }

    setLayoutMode("grid");
    setStaffingDisplayMode(employeeOnlyMode ? "show_assignments" : "shoots_only");
    if (!employeeOnlyMode && schedulingWorkspace) {
      setMyItemsOnly(false);
    }
  }, [canManage, employeeOnlyMode, initialView, schedulingWorkspace]);

  useEffect(() => {
    const visibleShootIds = new Set((calendarResponse?.items ?? []).filter(isShootItem).map((item) => item.id));
    setSelectedShootIds((current) => current.filter((id) => visibleShootIds.has(id)));
  }, [calendarResponse]);

  const shootIndexById = useMemo(
    () =>
      new Map(
        (calendarResponse?.items ?? [])
          .filter(isShootItem)
          .map((item) => [item.id, item] as const)
      ),
    [calendarResponse?.items]
  );
  const allShiftRowsByShootId = useMemo(() => {
    const grouped = new Map<string, ShiftRecord[]>();
    for (const shift of shiftRows) {
      if (!shift.shoot_id) {
        continue;
      }
      const existing = grouped.get(shift.shoot_id);
      if (existing) {
        existing.push(shift);
      } else {
        grouped.set(shift.shoot_id, [shift]);
      }
    }
    return grouped;
  }, [shiftRows]);
  const filteredCalendarItems = useMemo(
    () =>
      filterScheduleItems(calendarResponse?.items ?? [], {
        search,
        shootTypeFilter,
        staffingHealthFilter,
        priorityFilter,
        staffingRoleFilter,
        myItemsOnly,
        shiftsByShootId: allShiftRowsByShootId
      }),
    [allShiftRowsByShootId, calendarResponse?.items, myItemsOnly, priorityFilter, search, shootTypeFilter, staffingHealthFilter, staffingRoleFilter]
  );
  const filteredShiftRows = useMemo(
    () =>
      filterShiftRows(shiftRows, {
        search,
        departmentFilter,
        statusFilter,
        leadUserId,
        employeeId,
        staffingRoleFilter,
        locationQuery,
        shootTypeFilter,
        staffingHealthFilter,
        myItemsOnly,
        currentUserId: currentUser.id,
        shootIndexById
      }),
    [
      currentUser.id,
      departmentFilter,
      employeeId,
      leadUserId,
      locationQuery,
      staffingRoleFilter,
      myItemsOnly,
      search,
      shiftRows,
      shootIndexById,
      shootTypeFilter,
      staffingHealthFilter,
      statusFilter
    ]
  );
  const shiftsByShootId = useMemo(() => {
    const grouped = new Map<string, ShiftRecord[]>();
    for (const shift of filteredShiftRows) {
      if (!shift.shoot_id) {
        continue;
      }
      const existing = grouped.get(shift.shoot_id);
      if (existing) {
        existing.push(shift);
      } else {
        grouped.set(shift.shoot_id, [shift]);
      }
    }
    grouped.forEach((rows) => rows.sort(compareShiftRows));
    return grouped;
  }, [filteredShiftRows]);
  const filteredBoardGroups = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return (boardResponse?.groups ?? [])
      .map((group) => ({
        ...group,
        shoots: group.shoots.filter(
          (shoot) =>
            matchesShootSearch(shoot, lowered) &&
            matchesShootFilters(shoot, {
              shootTypeFilter,
              staffingHealthFilter,
              priorityFilter,
              staffingRoleFilter,
              shiftsByShootId
            })
        )
      }))
      .filter((group) => group.shoots.length > 0);
  }, [boardResponse?.groups, priorityFilter, search, shootTypeFilter, shiftsByShootId, staffingHealthFilter, staffingRoleFilter]);
  const standaloneShiftRowsByDay = useMemo(() => {
    const grouped = new Map<string, ShiftRecord[]>();
    for (const shift of filteredShiftRows) {
      if (shift.shoot_id) {
        continue;
      }
      const dateKey = shift.starts_at.slice(0, 10);
      const existing = grouped.get(dateKey);
      if (existing) {
        existing.push(shift);
      } else {
        grouped.set(dateKey, [shift]);
      }
    }
    grouped.forEach((rows) => rows.sort(compareShiftRows));
    return grouped;
  }, [filteredShiftRows]);

  const dayGroups = useMemo(() => {
    const days = enumerateDateKeys(calendarResponse?.range.start_date, calendarResponse?.range.end_date);
    const itemsByDay = new Map<string, UnifiedScheduleItem[]>();
    for (const item of filteredCalendarItems) {
      const list = itemsByDay.get(item.date_key);
      if (list) {
        list.push(item);
      } else {
        itemsByDay.set(item.date_key, [item]);
      }
    }
    return days.map((dateKey) => ({
      dateKey,
      label: formatDayLabel(dateKey, windowMode),
      items: (itemsByDay.get(dateKey) ?? []).sort(compareScheduleItems)
    }));
  }, [calendarResponse?.range.end_date, calendarResponse?.range.start_date, filteredCalendarItems, windowMode]);

  useEffect(() => {
    if (selectedDayKey && dayGroups.some((group) => group.dateKey === selectedDayKey)) {
      return;
    }
    setSelectedDayKey(
      dayGroups.find((group) => group.dateKey === anchorDate)?.dateKey ??
        dayGroups.find((group) => group.items.length > 0)?.dateKey ??
        dayGroups[0]?.dateKey ??
        ""
    );
  }, [anchorDate, dayGroups, selectedDayKey]);

  const selectedItem = useMemo(() => {
    if (!selectedItemKey) {
      return null;
    }
    for (const item of filteredCalendarItems) {
      if (`${item.item_kind}:${item.id}` === selectedItemKey) {
        return item;
      }
    }
    for (const group of filteredBoardGroups) {
      for (const shoot of group.shoots) {
        if (`shoot:${shoot.id}` === selectedItemKey) {
          return shoot;
        }
      }
    }
    return null;
  }, [filteredBoardGroups, filteredCalendarItems, selectedItemKey]);

  async function ensureShootDetail(shootId: string) {
    if (detailCache[shootId] || detailLoadingId === shootId) {
      return;
    }
    setDetailLoadingId(shootId);
    try {
      const detail = await apiFetch<ShootDetail>(`/api/shoots/${shootId}`, token);
      setDetailCache((current) => ({
        ...current,
        [shootId]: detail
      }));
    } finally {
      setDetailLoadingId("");
    }
  }

  function handleShootToggle(shoot: UnifiedScheduleShootItem) {
    setSelectedDayKey(shoot.date_key);
    setSelectedItemKey((current) => (current === `shoot:${shoot.id}` ? "" : `shoot:${shoot.id}`));
    void ensureShootDetail(shoot.id);
  }

  function handleEventSelect(event: UnifiedScheduleEventItem) {
    setSelectedDayKey(event.date_key);
    setSelectedItemKey((current) => (current === `event:${event.id}` ? "" : `event:${event.id}`));
  }

  function handleAvailabilitySelect(item: UnifiedScheduleAvailabilityItem) {
    setSelectedDayKey(item.date_key);
    setSelectedItemKey((current) => (current === `availability:${item.id}` ? "" : `availability:${item.id}`));
  }

  async function moveItem(item: UnifiedScheduleItem, targetDate: string) {
    if (!canManage || movingItemId === item.id || item.date_key === targetDate) {
      return;
    }
    setMovingItemId(item.id);
    try {
      const response = await apiFetch<{ item_kind: string; id: string; warnings?: string[] }>(
        `/api/schedule/items/${item.item_kind}/${item.id}/move`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ target_date: targetDate })
        }
      );
      const warnings = response.warnings ?? [];
      onNotice(
        warnings.length
          ? `Moved ${item.title}. Review warnings: ${warnings.join(" ")}`
          : `Moved ${item.title} to ${formatCompactDate(targetDate)}.`
      );
      setSelectedItemKey("");
      setSelectedShootIds([]);
      setBulkEdit(emptyBulkEdit);
      setLoading(true);
      const [calendar, board] = await Promise.all([
        apiFetch<UnifiedScheduleCalendarResponse>(`/api/schedule/calendar?${query}`, token),
        apiFetch<UnifiedScheduleBoardResponse>(`/api/schedule/board?${query}&group_by=${groupBy}`, token)
      ]);
      setCalendarResponse(calendar);
      setBoardResponse(board);
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't move that schedule item.");
    } finally {
      setMovingItemId("");
      setLoading(false);
    }
  }

  function toggleShootSelection(shootId: string) {
    setSelectedShootIds((current) => (current.includes(shootId) ? current.filter((id) => id !== shootId) : [...current, shootId]));
  }

  async function applyBulkChanges() {
    if (!canManage || !selectedShootIds.length) {
      return;
    }
    if (!bulkEdit.department && !bulkEdit.status && !bulkEdit.targetDate && !bulkEdit.templateId) {
      onError("Choose at least one bulk update before applying changes.");
      return;
    }
    setApplyingBulkEdit(true);
    try {
      for (const shootId of selectedShootIds) {
        if (bulkEdit.department || bulkEdit.status) {
          await apiFetch(`/api/shoots/${shootId}`, token, {
            method: "PATCH",
            body: JSON.stringify({
              ...(bulkEdit.department ? { department: bulkEdit.department } : {}),
              ...(bulkEdit.status ? { status: bulkEdit.status } : {})
            })
          });
        }
        if (bulkEdit.targetDate) {
          await apiFetch(`/api/schedule/items/shoot/${shootId}/move`, token, {
            method: "POST",
            body: JSON.stringify({ target_date: bulkEdit.targetDate })
          });
        }
        if (bulkEdit.templateId) {
          await apiFetch(`/api/schedule/shoots/${shootId}/apply-template`, token, {
            method: "POST",
            body: JSON.stringify({ template_id: bulkEdit.templateId })
          });
        }
      }
      onNotice(`Applied bulk updates to ${selectedShootIds.length} shoot${selectedShootIds.length === 1 ? "" : "s"}.`);
      setSelectedShootIds([]);
      setBulkEdit(emptyBulkEdit);
      const [calendar, board] = await Promise.all([
        apiFetch<UnifiedScheduleCalendarResponse>(`/api/schedule/calendar?${query}`, token),
        apiFetch<UnifiedScheduleBoardResponse>(`/api/schedule/board?${query}&group_by=${groupBy}`, token)
      ]);
      setCalendarResponse(calendar);
      setBoardResponse(board);
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't apply those bulk updates.");
    } finally {
      setApplyingBulkEdit(false);
    }
  }

  async function runIntegrationAction(item: UnifiedScheduleItem, action: "push" | "resync" | "acknowledge") {
    if (!canManage) {
      return;
    }
    const actionKey = `${action}:${item.item_kind}:${item.id}`;
    setIntegrationActionKey(actionKey);
    try {
      await apiFetch(
        action === "push"
          ? `/api/schedule/items/${item.item_kind}/${item.id}/outlook-push`
          : action === "resync"
            ? `/api/schedule/items/${item.item_kind}/${item.id}/outlook-resync`
            : `/api/schedule/items/${item.item_kind}/${item.id}/outlook-review/acknowledge`,
        token,
        {
          method: "POST"
        }
      );
      onNotice(
        action === "push"
          ? `Queued an explicit Outlook push for ${item.title}.`
          : action === "resync"
            ? `Requested a manual Outlook resync for ${item.title}.`
            : `Marked the Outlook review as acknowledged for ${item.title}.`
      );
      const [calendar, board] = await Promise.all([
        apiFetch<UnifiedScheduleCalendarResponse>(`/api/schedule/calendar?${query}`, token),
        apiFetch<UnifiedScheduleBoardResponse>(`/api/schedule/board?${query}&group_by=${groupBy}`, token)
      ]);
      setCalendarResponse(calendar);
      setBoardResponse(board);
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't complete that Outlook sync action.");
    } finally {
      setIntegrationActionKey("");
    }
  }

  const selectedShoot = selectedItem && isShootItem(selectedItem) ? selectedItem : null;
  const selectedEvent = selectedItem && isEventItem(selectedItem) ? selectedItem : null;
  const selectedAvailability = selectedItem && isAvailabilityItem(selectedItem) ? selectedItem : null;
  const selectedShootBriefing = selectedShoot
    ? buildShootBriefing(toShootSummary(selectedShoot), detailCache[selectedShoot.id] ?? null)
    : null;
  const selectedDayItems = dayGroups.find((group) => group.dateKey === selectedDayKey)?.items ?? [];
  const visibleShoots = filteredCalendarItems.filter(isShootItem);
  const visibleAssignments = filteredShiftRows.length;
  const scheduleSummary = visibleShoots.reduce(
    (summary, shoot) => ({
      coverageGapCount: summary.coverageGapCount + (shoot.staffing_health_state === "coverage_gap" ? 1 : 0),
      criticalRoleGapCount: summary.criticalRoleGapCount + (shoot.missing_lead ? 1 : 0),
      conflictCount: summary.conflictCount + ((shoot.conflict_warning_count ?? 0) > 0 ? 1 : 0),
      overstaffedCount: summary.overstaffedCount + (shoot.over_staffed ? 1 : 0),
      unconfirmedLaborCount: summary.unconfirmedLaborCount + ((shoot.unconfirmed_staff_count ?? 0) > 0 ? 1 : 0)
    }),
    {
      coverageGapCount: 0,
      criticalRoleGapCount: 0,
      conflictCount: 0,
      overstaffedCount: 0,
      unconfirmedLaborCount: 0
    }
  );
  const scheduleHeaderTitle = scheduleWorkspace ? (employeeOnlyMode ? "My Schedule" : "Schedule") : "Scheduling";
  const scheduleHeaderSubtitle = scheduleWorkspace
    ? "Schedule is the clean assignment layer. It keeps your own work, timing, location, and update status readable without exposing manager staffing control."
    : "Scheduling is the staffing control layer. Plan coverage, compare required vs assigned labor, and catch gaps before the day goes live.";

  return (
    <section className="panel dashboard-panel unified-schedule-surface">
      <div className="dashboard-panel__header">
        <div>
          <div className="section-title">{scheduleHeaderTitle}</div>
          <p className="section-subtitle">{scheduleHeaderSubtitle}</p>
        </div>
        <div className="dashboard-calendar-toolbar">
          <div className="report-tab-row">
            <button
              className={surfaceMode === "schedule" && layoutMode === "grid" && rangeMode === "day" ? "is-active" : ""}
              onClick={() => {
                setSurfaceMode("schedule");
                setLayoutMode("grid");
                setRangeMode("day");
              }}
            >
              Day
            </button>
            <button
              className={surfaceMode === "schedule" && layoutMode === "grid" && rangeMode === "3day" ? "is-active" : ""}
              onClick={() => {
                setSurfaceMode("schedule");
                setLayoutMode("grid");
                setRangeMode("3day");
              }}
            >
              3-Day
            </button>
            <button
              className={surfaceMode === "schedule" && layoutMode === "grid" && rangeMode === "week" ? "is-active" : ""}
              onClick={() => {
                setSurfaceMode("schedule");
                setLayoutMode("grid");
                setRangeMode("week");
              }}
            >
              Week
            </button>
            <button
              className={surfaceMode === "schedule" && layoutMode === "grid" && rangeMode === "30day" ? "is-active" : ""}
              onClick={() => {
                setSurfaceMode("schedule");
                setLayoutMode("grid");
                setRangeMode("30day");
              }}
            >
              30-Day
            </button>
            <button
              className={surfaceMode === "schedule" && layoutMode === "list" ? "is-active" : ""}
              onClick={() => {
                setSurfaceMode("schedule");
                setLayoutMode("list");
              }}
            >
              List
            </button>
          </div>
          {canManage ? (
            <div className="report-tab-row">
              <button className={surfaceMode === "schedule" ? "is-active" : ""} onClick={() => setSurfaceMode("schedule")}>
                Grid
              </button>
              <button className={surfaceMode === "board" ? "is-active" : ""} onClick={() => setSurfaceMode("board")}>
                Lane Board
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {schedulingWorkspace ? (
        <div className="schedule-workspace-summary">
          <article className="schedule-workspace-summary__card">
            <span>Coverage gaps</span>
            <strong>{scheduleSummary.coverageGapCount}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Critical role gaps</span>
            <strong>{scheduleSummary.criticalRoleGapCount}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Conflicts</span>
            <strong>{scheduleSummary.conflictCount}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Overstaffed</span>
            <strong>{scheduleSummary.overstaffedCount}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Unconfirmed labor</span>
            <strong>{scheduleSummary.unconfirmedLaborCount}</strong>
          </article>
        </div>
      ) : (
        <div className="schedule-workspace-summary">
          <article className="schedule-workspace-summary__card">
            <span>Assignments in view</span>
            <strong>{visibleAssignments}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Linked shoots</span>
            <strong>{visibleShoots.length}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Pending updates</span>
            <strong>{filteredShiftRows.filter((shift) => isAttendanceExceptionState(shift.attendance_state) || isLocationExceptionState(shift.latest_geofence_status)).length}</strong>
          </article>
          <article className="schedule-workspace-summary__card">
            <span>Source</span>
            <strong>{calendarResponse?.sync.source_of_truth === "mission_control" ? "Mission Control" : humanizeLabel(calendarResponse?.sync.source_of_truth ?? "mission_control")}</strong>
          </article>
        </div>
      )}

      <div className="schedule-sync-summary">
        <span className="metric-pill">{visibleShoots.length} shoots in view</span>
        <span className="metric-pill">{visibleAssignments} assignments in scope</span>
        <span className="metric-pill">
          Outlook {calendarResponse?.sync.outlook_connected ? calendarResponse?.sync.outlook_health_state.replace(/_/g, " ") : "disconnected"}
        </span>
        <span className="metric-pill">{calendarResponse?.sync.pending_sync_count ?? 0} pending sync</span>
      </div>

      <div className="schedule-filter-grid">
        {schedulingWorkspace ? (
          <label className="filter-field">
            <span>Shoot Type</span>
            <select value={shootTypeFilter} onChange={(event) => setShootTypeFilter(event.target.value)}>
              <option value="">All Shoot Types</option>
              <option value="schools">Schools</option>
              <option value="sports">Sports</option>
              <option value="events">Events</option>
              <option value="studio">Studio</option>
            </select>
          </label>
        ) : null}
        {(schedulingWorkspace || canViewBroaderAssignments) ? (
          <label className="filter-field">
            <span>Department</span>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="">All Departments</option>
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
        ) : null}
        {(schedulingWorkspace || canViewBroaderAssignments) ? (
          <label className="filter-field">
            <span>Status</span>
            <input value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} placeholder="scheduled, live, completed..." />
          </label>
        ) : null}
        {schedulingWorkspace ? (
          <label className="filter-field">
            <span>Staffing Health</span>
            <select value={staffingHealthFilter} onChange={(event) => setStaffingHealthFilter(event.target.value)}>
              <option value="">All Staffing Health</option>
              <option value="ready">Ready</option>
              <option value="understaffed">Understaffed</option>
              <option value="missing_lead">Missing Lead</option>
              <option value="attendance_issue">Attendance Issue</option>
              <option value="conflict">Conflict / Travel Risk</option>
              <option value="overstaffed">Overstaffed</option>
              <option value="unconfirmed">Unconfirmed Labor</option>
            </select>
          </label>
        ) : null}
        {schedulingWorkspace ? (
          <label className="filter-field">
            <span>Priority</span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="">All Priority</option>
              <option value="big_critical">Big / Critical Only</option>
            </select>
          </label>
        ) : null}
        {schedulingWorkspace ? (
          <label className="filter-field">
            <span>Lead</span>
            <select value={leadUserId} onChange={(event) => setLeadUserId(event.target.value)}>
              <option value="">All Leads</option>
              {members.map((member) => (
                <option key={`lead-${member.id}`} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {(schedulingWorkspace || canViewBroaderAssignments) ? (
          <label className="filter-field">
            <span>Employee</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">All Employees</option>
              {members.map((member) => (
                <option key={`employee-${member.id}`} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {schedulingWorkspace ? (
          <label className="filter-field">
            <span>Role</span>
            <select value={staffingRoleFilter} onChange={(event) => setStaffingRoleFilter(event.target.value)}>
              <option value="">All Roles</option>
              <option value="lead_photographer">Lead Photographer</option>
              <option value="senior_photographer">Senior Photographer</option>
              <option value="photographer">Photographer</option>
              <option value="support">Support</option>
              <option value="check_in">Check-In</option>
              <option value="assistant">Assistant</option>
              <option value="producer">Producer</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        ) : null}
        <label className="filter-field">
          <span>Location</span>
          <input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Gym, stadium, studio..." />
        </label>
        {!employeeOnlyMode ? (
          <label className="filter-field filter-field--checkbox">
            <span>{scheduleWorkspace ? "My Assignments Only" : "My Items Only"}</span>
            <input type="checkbox" checked={myItemsOnly} onChange={(event) => setMyItemsOnly(event.target.checked)} />
          </label>
        ) : null}
        {surfaceMode === "schedule" && layoutMode !== "list" && gridMode !== "month" ? (
          <label className="filter-field">
            <span>Assignments</span>
            <select value={staffingDisplayMode} onChange={(event) => setStaffingDisplayMode(event.target.value as StaffingDisplayMode)}>
              {schedulingWorkspace ? <option value="shoots_only">Shoots Only</option> : null}
              <option value="show_assignments">Show Assignments</option>
            </select>
          </label>
        ) : null}
        {surfaceMode === "board" && schedulingWorkspace ? (
          <label className="filter-field">
            <span>Group Board By</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as BoardGroup)}>
              <option value="status">Status</option>
              <option value="department">Department</option>
              <option value="lead_photographer">Lead Photographer</option>
              <option value="day_part">Day Part</option>
            </select>
          </label>
        ) : null}
      </div>

      {canManage && surfaceMode === "board" && selectedShootIds.length ? (
        <section className="schedule-bulk-bar">
          <div>
            <div className="eyebrow">Bulk Actions</div>
            <strong>{selectedShootIds.length} shoots selected</strong>
          </div>
          <label className="filter-field">
            <span>Department</span>
            <select value={bulkEdit.department} onChange={(event) => setBulkEdit((current) => ({ ...current, department: event.target.value }))}>
              <option value="">Leave As-Is</option>
              <option value="operations">Operations</option>
              <option value="schools">Schools</option>
              <option value="sports">Sports</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Status</span>
            <input value={bulkEdit.status} onChange={(event) => setBulkEdit((current) => ({ ...current, status: event.target.value }))} placeholder="live, ready, hold" />
          </label>
          <label className="filter-field">
            <span>Move To</span>
            <input
              type="date"
              value={bulkEdit.targetDate}
              onChange={(event) => setBulkEdit((current) => ({ ...current, targetDate: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Staffing Template</span>
            <select value={bulkEdit.templateId} onChange={(event) => setBulkEdit((current) => ({ ...current, templateId: event.target.value }))}>
              <option value="">Keep Current Plan</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <div className="schedule-bulk-bar__actions">
            <button className="secondary-button" onClick={() => setSelectedShootIds([])}>
              Clear Selection
            </button>
            <button className="primary-button" disabled={applyingBulkEdit} onClick={() => void applyBulkChanges()}>
              {applyingBulkEdit ? "Applying..." : "Apply Bulk Changes"}
            </button>
          </div>
        </section>
      ) : null}

      {loading && !calendarResponse ? (
        <section className="panel loading-panel">
          <div className="section-title">{scheduleWorkspace ? "Loading schedule" : "Loading scheduling"}</div>
          <p className="section-subtitle">
            {scheduleWorkspace
              ? "Pulling your assignment calendar, linked shoots, timing, and location context."
              : "Pulling shoots, staffing coverage, labor pressure, and linked schedule metadata."}
          </p>
        </section>
      ) : null}

      {!loading && surfaceMode === "schedule" && layoutMode === "list" ? renderAgendaSurface({
        dayGroups,
        employeeOnlyMode,
        scheduleWorkspace,
        filteredShiftRows,
        onOpenShift,
        onOpenShoot,
        staffingDisplayMode,
        selectedDayKey,
        setSelectedDayKey
      }) : null}

      {!loading && surfaceMode === "schedule" && layoutMode !== "list" ? renderCalendarSurface({
        anchorDate,
        canManage,
        dayGroups,
        detailCache,
        employeeOnlyMode,
        integrationActionKey,
        onError,
        onIntegrationAction: runIntegrationAction,
        onOpenShift,
        onOpenShoot,
        onOpenStaffing,
        handleAvailabilitySelect,
        shiftsByShootId,
        handleEventSelect,
        handleShootToggle,
        isNarrowLayout,
        movingItemId,
        moveItem,
        selectedDayItems,
        selectedDayKey,
        selectedAvailability,
        selectedEvent,
        selectedItemKey,
        selectedShootBriefing,
        showStaffingDetails: schedulingWorkspace,
        setSelectedDayKey,
        setSelectedItemKey,
        standaloneShiftRowsByDay,
        staffingDisplayMode,
        viewMode: gridMode,
        ensureShootDetail
      }) : null}

      {!loading && surfaceMode === "board" ? renderBoardSurface({
        canManage,
        detailCache,
        filteredBoardGroups,
        handleShootToggle,
        integrationActionKey,
        onIntegrationAction: runIntegrationAction,
        onOpenShoot,
        onOpenStaffing,
        selectedItemKey,
        selectedShootBriefing,
        selectedShootIds,
        toggleShootSelection
      }) : null}

      {movingItemId ? <div className="live-banner">Moving schedule item and re-checking staffing conflicts...</div> : null}
    </section>
  );
}

function ScheduleIntegrationPanel({
  item,
  integration,
  canManage,
  integrationActionKey,
  onIntegrationAction
}: {
  item: UnifiedScheduleItem;
  integration: ScheduleRecordIntegrationState;
  canManage: boolean;
  integrationActionKey: string;
  onIntegrationAction: (item: UnifiedScheduleItem, action: "push" | "resync" | "acknowledge") => Promise<void>;
}) {
  const actionPrefix = `${item.item_kind}:${item.id}`;
  return (
    <section className="shoot-briefing__section">
      <div className="section-title">Outlook Sync</div>
      <div className="shoot-briefing__stack">
        <div className="shoot-briefing__chip-row">
          <span className={`risk-pill risk-pill--${mapIntegrationTone(integration.sync_health)}`}>
            {integration.link_state === "linked" ? "Linked Outlook" : "Not Linked"}
          </span>
          <span className={`risk-pill risk-pill--${mapIntegrationTone(integration.sync_health)}`}>
            {humanizeLabel(integration.sync_state)}
          </span>
          <span className="meta-pill">
            {integration.last_sync_direction === "none" ? "No sync yet" : `${humanizeLabel(integration.last_sync_direction)} sync`}
          </span>
        </div>
        <div className="shoot-briefing__row">
          <span>Source Of Truth</span>
          <strong>{integration.source_of_truth}</strong>
        </div>
        <div className="shoot-briefing__row">
          <span>Last Synced</span>
          <strong>{integration.last_synced_at ? new Date(integration.last_synced_at).toLocaleString() : "Not synced yet"}</strong>
        </div>
        {integration.external_last_modified_at ? (
          <div className="shoot-briefing__row">
            <span>Last Outlook Change</span>
            <strong>{new Date(integration.external_last_modified_at).toLocaleString()}</strong>
          </div>
        ) : null}
        {integration.changed_field_labels.length ? (
          <div className="shoot-briefing__chip-row">
            {integration.changed_field_labels.map((label) => (
              <span key={label} className="meta-pill">
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {integration.manual_review_required ? (
          <div className="shoot-briefing__callout shoot-briefing__callout--warning">
            <strong>Manual Review Required</strong>
            <div className="muted">{integration.review_reason ?? "Outlook changed a calendar-owned field after Mission Control staffing already existed."}</div>
          </div>
        ) : null}
        {integration.last_sync_error ? (
          <div className="shoot-briefing__callout shoot-briefing__callout--critical">
            <strong>Sync Failure</strong>
            <div className="muted">{integration.last_sync_error}</div>
          </div>
        ) : null}
        {integration.recommended_next_action ? (
          <div className="muted">{integration.recommended_next_action}</div>
        ) : null}
        {canManage ? (
          <div className="shoot-briefing__actions">
            <button
              className="secondary-button"
              disabled={integrationActionKey === `push:${actionPrefix}`}
              onClick={() => void onIntegrationAction(item, "push")}
            >
              {integrationActionKey === `push:${actionPrefix}` ? "Queueing..." : integration.link_state === "linked" ? "Push To Outlook" : "Create Outlook Link"}
            </button>
            <button
              className="secondary-button"
              disabled={!integration.external_record_id || !integration.external_calendar_id || integrationActionKey === `resync:${actionPrefix}`}
              onClick={() => void onIntegrationAction(item, "resync")}
            >
              {integrationActionKey === `resync:${actionPrefix}` ? "Refreshing..." : "Manual Resync"}
            </button>
            <button
              className="secondary-button"
              disabled={!integration.manual_review_required || integrationActionKey === `acknowledge:${actionPrefix}`}
              onClick={() => void onIntegrationAction(item, "acknowledge")}
            >
              {integrationActionKey === `acknowledge:${actionPrefix}` ? "Saving..." : "Mark Reviewed"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ScheduleEventPanel({
  event,
  canManage,
  integrationActionKey,
  onIntegrationAction,
  onOpenShoot
}: {
  event: UnifiedScheduleEventItem;
  canManage: boolean;
  integrationActionKey: string;
  onIntegrationAction: (item: UnifiedScheduleItem, action: "push" | "resync" | "acknowledge") => Promise<void>;
  onOpenShoot: (shootId: string) => void;
}) {
  return (
    <div className="schedule-selected-detail">
      <div className="schedule-selected-detail__meta">
        <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(event.department)}`}>{humanizeLabel(event.event_kind)}</span>
        <span className="meta-pill">{humanizeLabel(event.status)}</span>
        <span className={`risk-pill risk-pill--${mapIntegrationTone(event.integration.sync_health)}`}>Sync {humanizeLabel(event.schedule_sync_state)}</span>
      </div>
      <div className="shoot-briefing">
        <section className="shoot-briefing__section">
          <div className="section-title">Timing</div>
          <div className="shoot-briefing__grid">
            <div className="shoot-briefing__metric">
              <span>Starts</span>
              <strong>{new Date(event.starts_at).toLocaleString()}</strong>
            </div>
            <div className="shoot-briefing__metric">
              <span>Ends</span>
              <strong>{new Date(event.ends_at).toLocaleString()}</strong>
            </div>
            <div className="shoot-briefing__metric">
              <span>Lead</span>
              <strong>{event.lead_name || "Unassigned"}</strong>
            </div>
          </div>
        </section>
        <section className="shoot-briefing__section">
          <div className="section-title">Travel</div>
          <div className="shoot-briefing__stack">
            <div className="shoot-briefing__row">
              <span>Location</span>
              <strong>{event.location_name || event.location_address || "Location pending"}</strong>
            </div>
            {event.location_address ? (
              <div className="shoot-briefing__row">
                <span>Address</span>
                <strong>{event.location_address}</strong>
              </div>
            ) : null}
            <div className="shoot-briefing__actions">
              {event.navigation_url ? (
                <a className="secondary-button" href={event.navigation_url} target="_blank" rel="noreferrer">
                  Open In Maps
                </a>
              ) : null}
              {event.linked_shoot_id ? (
                <button className="secondary-button" onClick={() => onOpenShoot(event.linked_shoot_id!)}>
                  Open Linked Shoot
                </button>
              ) : null}
            </div>
          </div>
        </section>
        <section className="shoot-briefing__section">
          <div className="section-title">Notes</div>
          <div className="muted">{event.notes || "No additional notes are attached to this operational event yet."}</div>
        </section>
        <ScheduleIntegrationPanel
          item={event}
          integration={event.integration}
          canManage={canManage}
          integrationActionKey={integrationActionKey}
          onIntegrationAction={onIntegrationAction}
        />
      </div>
    </div>
  );
}

function ScheduleAvailabilityPanel({ availability }: { availability: UnifiedScheduleAvailabilityItem }) {
  const tone =
    availability.warning_level === "critical" || availability.warning_level === "high"
      ? "critical"
      : availability.warning_level === "medium"
        ? "watch"
        : "normal";

  return (
    <div className="schedule-selected-detail">
      <div className="schedule-selected-detail__meta">
        <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(availability.department)}`}>
          {availability.availability_kind === "absence"
            ? "Absence"
            : availability.availability_kind === "blocked_date"
              ? "Blocked Date"
              : "Availability"}
        </span>
        <span className={`risk-pill risk-pill--${tone}`}>{availability.badge_label || humanizeLabel(availability.status)}</span>
      </div>
      <div className="shoot-briefing">
        <section className="shoot-briefing__section">
          <div className="section-title">Coverage Impact</div>
          <div className="shoot-briefing__grid">
            <div className="shoot-briefing__metric">
              <span>Affected Assignments</span>
              <strong>{availability.impacted_assignment_count}</strong>
            </div>
            <div className="shoot-briefing__metric">
              <span>Minimum Staffing Risk</span>
              <strong>{availability.minimum_staffing_break_count}</strong>
            </div>
            <div className="shoot-briefing__metric">
              <span>Lead Coverage Risk</span>
              <strong>{availability.lead_coverage_break_count}</strong>
            </div>
          </div>
        </section>
        <section className="shoot-briefing__section">
          <div className="section-title">Availability Detail</div>
          <div className="shoot-briefing__stack">
            <div className="dashboard-summary-row">
              <span className="muted">Scope</span>
              <strong>{availability.user_name || "Shared operational block"}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Window</span>
              <strong>
                {availability.starts_at && availability.ends_at
                  ? formatTimeRange(availability.starts_at, availability.ends_at)
                  : "All day"}
              </strong>
            </div>
            {availability.reason_category ? (
              <div className="dashboard-summary-row">
                <span className="muted">Reason Category</span>
                <strong>{humanizeLabel(availability.reason_category)}</strong>
              </div>
            ) : null}
            {availability.note ? (
              <div className="feedback-strip feedback-strip--warning">{availability.note}</div>
            ) : null}
            {availability.protected_date_severity ? (
              <div className="dashboard-summary-row">
                <span className="muted">Protected Date</span>
                <strong>{humanizeLabel(availability.protected_date_severity)} escalation</strong>
              </div>
            ) : null}
            {availability.live_operational_absence_state ? (
              <div className="dashboard-summary-row">
                <span className="muted">Absence State</span>
                <strong>{humanizeLabel(availability.live_operational_absence_state)}</strong>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScheduleShiftLayer({
  shifts,
  employeeOnlyMode,
  personalPresentation,
  onOpenShift,
  title
}: {
  shifts: ShiftRecord[];
  employeeOnlyMode: boolean;
  personalPresentation?: boolean;
  onOpenShift?: (shift: ShiftRecord) => void;
  title: string;
}) {
  if (!shifts.length) {
    return null;
  }

  return (
    <section className="schedule-shift-layer">
      <div className="schedule-shift-layer__header">
        <div className="eyebrow">{title}</div>
        <span className="meta-pill">
          {shifts.length} assignment{shifts.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="schedule-shift-layer__list">
        {shifts.map((shift) => {
          const personalShiftView = personalPresentation ?? employeeOnlyMode;
          const attendanceState = formatAttendanceStateLabel(shift.attendance_state);
          const locationState = getShiftLocationStateLabel(shift.latest_geofence_status);
          const attendanceAttention = isAttendanceExceptionState(shift.attendance_state);
          const locationAttention = isLocationExceptionState(shift.latest_geofence_status);
          const headline = personalShiftView ? shift.shoot_title || shift.title : shift.assigned_user_name;
          const secondary = personalShiftView
            ? `${humanizeLabel(shift.staffing_role ?? shift.shift_kind)} | ${shift.location_name || shift.location_address || "Location pending"}`
            : `${humanizeLabel(shift.staffing_role ?? shift.shift_kind)} | ${shift.shoot_title || shift.title}`;

          return (
            <button
              key={shift.id}
              type="button"
              className={`schedule-shift-card${attendanceAttention || locationAttention ? " schedule-shift-card--attention" : ""}`}
              onClick={() => openScheduleShift(shift, personalShiftView, onOpenShift)}
            >
              <div className="schedule-shift-card__header">
                <strong>{headline}</strong>
                <span className="schedule-shift-card__time">{formatTimeRange(shift.starts_at, shift.ends_at)}</span>
              </div>
              <div className="muted">{secondary}</div>
              <div className="schedule-shift-card__meta">
                <span className={`risk-pill risk-pill--${attendanceAttention ? "critical" : "normal"}`}>{attendanceState}</span>
                {locationState ? (
                  <span className={`risk-pill risk-pill--${locationAttention ? "watch" : "neutral"}`}>{locationState}</span>
                ) : null}
                {shift.satisfies_lead_coverage ? <span className="meta-pill">Lead coverage</span> : null}
                {shift.latest_punch_direction ? <span className="meta-pill">Clock {humanizeLabel(shift.latest_punch_direction)}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function renderEventSyncPreview(integration: ScheduleRecordIntegrationState) {
  if (integration.manual_review_required) {
    return {
      label: "Outlook Review",
      tone: "warning" as const
    };
  }
  if (integration.sync_state === "sync_error") {
    return {
      label: "Sync Failed",
      tone: "critical" as const
    };
  }
  if (integration.sync_required) {
    return {
      label: "Push Pending",
      tone: "info" as const
    };
  }
  if (integration.link_state === "linked") {
    return {
      label: "Linked Outlook",
      tone: "neutral" as const
    };
  }
  return null;
}

function toShootSummary(item: UnifiedScheduleShootItem): ShootSummary {
  return {
    id: item.id,
    department: item.department,
    shoot_category: item.shoot_category ?? null,
    shoot_code: item.shoot_code,
    title: item.title,
    shoot_date: item.date_key,
    location_name: item.location_name ?? "",
    location_address: item.location_address ?? null,
    navigation_url: item.navigation_url ?? null,
    estimated_drive_minutes: item.estimated_drive_minutes ?? null,
    showtime: item.showtime ?? item.arrival_time ?? item.starts_at ?? null,
    arrival_time: item.arrival_time ?? item.starts_at ?? null,
    start_time: item.start_time ?? item.starts_at ?? null,
    end_time_est: item.end_time_est ?? item.ends_at ?? null,
    projected_students: item.projected_students ?? null,
    status: item.status,
    operations_priority: item.operations_priority ?? null,
    big_shoot_manual_override: item.big_shoot_manual_override ?? false,
    special_equipment: item.special_equipment ?? null,
    scheduled_employee_count: item.assigned_staff_count ?? 0,
    clocked_in_employee_count: 0,
    open_attendance_exception_count: item.open_attendance_exception_count ?? 0,
    planned_staff_count: item.planned_staff_count ?? 0,
    required_lead_count: item.required_lead_count ?? 0,
    lead_coverage_count: item.lead_coverage_count ?? 0,
    lead_name: item.lead_name ?? null,
    staffing_state: item.staffing_state,
    under_staffed: item.under_staffed,
    over_staffed: item.over_staffed ?? false,
    missing_lead: item.missing_lead,
    conflict_warning_count: item.conflict_warning_count ?? 0,
    draft_shift_count: item.draft_shift_count ?? 0,
    published_shift_count: item.published_shift_count ?? 0,
    publish_state: item.publish_state ?? "draft",
    schedule_sync_state: item.schedule_sync_state,
    schedule_sync_required: item.schedule_sync_required,
    priority_label: item.priority_label ?? null,
    priority_label_display: item.priority_label_display ?? null,
    priority_reasons: item.priority_reasons ?? [],
    big_shoot: item.priority_label === "big_shoot" || item.priority_label === "critical_shoot",
    future_profitability_flag: item.future_profitability_flag ?? null,
    future_profitability_display: item.future_profitability_display ?? null,
    scale_label: item.scale_label,
    integration: item.integration
  };
}

type ScheduleDayGroup = {
  dateKey: string;
  label: string;
  items: UnifiedScheduleItem[];
};

type ScheduleDaySummary = {
  shootCount: number;
  eventCount: number;
  availabilityCount: number;
  totalCount: number;
  staffingWatchCount: number;
  reviewCount: number;
  bigShootCount: number;
};

function summarizeDayItems(items: UnifiedScheduleItem[]): ScheduleDaySummary {
  return items.reduce<ScheduleDaySummary>(
    (summary, item) => {
      if (isShootItem(item)) {
        const reviewNeeded =
          item.integration.manual_review_required ||
          item.integration.sync_required ||
          item.integration.stale_data_warning ||
          item.integration.pending_external_changes ||
          item.integration.sync_state === "sync_error";
        const staffingWatch =
          item.under_staffed ||
          item.missing_lead ||
          (item.conflict_warning_count ?? 0) > 0 ||
          (item.open_alert_count ?? 0) > 0 ||
          (item.open_attendance_exception_count ?? 0) > 0 ||
          item.missing_fields.length > 0;

        return {
          shootCount: summary.shootCount + 1,
          eventCount: summary.eventCount,
          availabilityCount: summary.availabilityCount,
          totalCount: summary.totalCount + 1,
          staffingWatchCount: summary.staffingWatchCount + (staffingWatch ? 1 : 0),
          reviewCount: summary.reviewCount + (reviewNeeded ? 1 : 0),
          bigShootCount: summary.bigShootCount + (item.priority_label === "big_shoot" || item.priority_label === "critical_shoot" ? 1 : 0)
        };
      }

      if (isAvailabilityItem(item)) {
        const staffingWatch =
          item.warning_level === "high" ||
          item.warning_level === "critical" ||
          item.minimum_staffing_break_count > 0 ||
          item.lead_coverage_break_count > 0;
        return {
          shootCount: summary.shootCount,
          eventCount: summary.eventCount,
          availabilityCount: summary.availabilityCount + 1,
          totalCount: summary.totalCount + 1,
          staffingWatchCount: summary.staffingWatchCount + (staffingWatch ? 1 : 0),
          reviewCount: summary.reviewCount + (item.status === "needs_review" || item.availability_kind === "absence" ? 1 : 0),
          bigShootCount: summary.bigShootCount
        };
      }

      const reviewNeeded =
        item.integration.manual_review_required ||
        item.integration.sync_required ||
        item.integration.stale_data_warning ||
        item.integration.pending_external_changes ||
        item.integration.sync_state === "sync_error";

      return {
        shootCount: summary.shootCount,
        eventCount: summary.eventCount + 1,
        availabilityCount: summary.availabilityCount,
        totalCount: summary.totalCount + 1,
        staffingWatchCount: summary.staffingWatchCount,
        reviewCount: summary.reviewCount + (reviewNeeded ? 1 : 0),
        bigShootCount: summary.bigShootCount
      };
    },
    {
      shootCount: 0,
      eventCount: 0,
      availabilityCount: 0,
      totalCount: 0,
      staffingWatchCount: 0,
      reviewCount: 0,
      bigShootCount: 0
    }
  );
}

function getDaySummaryTone(summary: ScheduleDaySummary) {
  if (summary.staffingWatchCount > 0 || summary.reviewCount > 1) {
    return "critical" as const;
  }
  if (summary.reviewCount > 0 || summary.bigShootCount > 0) {
    return "watch" as const;
  }
  return "normal" as const;
}

function getDaySummaryLine(summary: ScheduleDaySummary) {
  if (!summary.totalCount) {
    return "No schedule items are currently landing on this day.";
  }
  const parts = [`${summary.shootCount} shoot${summary.shootCount === 1 ? "" : "s"}`];
  if (summary.eventCount) {
    parts.push(`${summary.eventCount} event${summary.eventCount === 1 ? "" : "s"}`);
  }
  if (summary.availabilityCount) {
    parts.push(`${summary.availabilityCount} availability item${summary.availabilityCount === 1 ? "" : "s"}`);
  }
  if (summary.staffingWatchCount) {
    parts.push(`${summary.staffingWatchCount} staffing watch${summary.staffingWatchCount === 1 ? "" : "es"}`);
  }
  if (summary.reviewCount) {
    parts.push(`${summary.reviewCount} sync or review flag${summary.reviewCount === 1 ? "" : "s"}`);
  }
  return parts.join(" | ");
}

function getItemKey(item: UnifiedScheduleItem) {
  return `${item.item_kind}:${item.id}`;
}

function ScheduleDayBriefing({
  canManage,
  dayGroups,
  integrationActionKey,
  onIntegrationAction,
  onOpenShoot,
  onOpenStaffing,
  onSelectAvailability,
  onSelectEvent,
  onSelectShoot,
  selectedAvailability,
  selectedDayItems,
  selectedDayKey,
  selectedEvent,
  selectedItemKey,
  selectedShootBriefing,
  showStaffingDetails,
  windowMode
}: {
  canManage: boolean;
  dayGroups: ScheduleDayGroup[];
  integrationActionKey: string;
  onIntegrationAction: (item: UnifiedScheduleItem, action: "push" | "resync" | "acknowledge") => Promise<void>;
  onOpenShoot: (shootId: string) => void;
  onOpenStaffing?: (shoot: UnifiedScheduleShootItem) => void;
  onSelectAvailability: (item: UnifiedScheduleAvailabilityItem) => void;
  onSelectEvent: (event: UnifiedScheduleEventItem) => void;
  onSelectShoot: (shoot: UnifiedScheduleShootItem) => void;
  selectedAvailability: UnifiedScheduleAvailabilityItem | null;
  selectedDayItems: UnifiedScheduleItem[];
  selectedDayKey: string;
  selectedEvent: UnifiedScheduleEventItem | null;
  selectedItemKey: string;
  selectedShootBriefing: ReturnType<typeof buildShootBriefing> | null;
  showStaffingDetails: boolean;
  windowMode: WindowMode;
}) {
  const selectedDayLabel =
    dayGroups.find((group) => group.dateKey === selectedDayKey)?.label ??
    (selectedDayKey ? formatDayLabel(selectedDayKey, windowMode === "30day" ? "30day" : "week") : "Choose A Day");
  const selectedDaySummary = summarizeDayItems(selectedDayItems);
  const selectedShoot =
    selectedShootBriefing
      ? selectedDayItems.find((item) => isShootItem(item) && item.id === selectedShootBriefing.shootId) ?? null
      : null;

  return (
    <aside className="panel shoot-briefing-panel schedule-day-briefing">
      <div className="shoot-briefing-panel__header">
        <div>
          <div className="eyebrow">Day Briefing</div>
          <h3>{selectedDayKey ? selectedDayLabel : "Choose A Day"}</h3>
          <p className="section-subtitle">
            {selectedDayKey
              ? getDaySummaryLine(selectedDaySummary)
              : "Pick a day to review schedule load, staffing watch points, and item-level detail."}
          </p>
        </div>
      </div>

      {selectedDayKey ? (
        <div className="schedule-day-briefing__summary">
          <article className="schedule-day-summary-card">
            <span>Shoots</span>
            <strong>{selectedDaySummary.shootCount}</strong>
          </article>
          <article className="schedule-day-summary-card">
            <span>Events & Blocks</span>
            <strong>{selectedDaySummary.eventCount + selectedDaySummary.availabilityCount}</strong>
          </article>
          <article className="schedule-day-summary-card">
            <span>Staffing Watch</span>
            <strong>{selectedDaySummary.staffingWatchCount}</strong>
          </article>
          <article className={`schedule-day-summary-card schedule-day-summary-card--${getDaySummaryTone(selectedDaySummary)}`}>
            <span>Review Flags</span>
            <strong>{selectedDaySummary.reviewCount}</strong>
          </article>
        </div>
      ) : null}

      {selectedDayItems.length ? (
        <section className="shoot-briefing__section">
          <div className="section-title">Day Queue</div>
          <div className="schedule-day-queue">
            {selectedDayItems.map((item) =>
              isShootItem(item) ? (
                <button
                  key={item.id}
                  type="button"
                  className={`schedule-day-queue__item${selectedItemKey === getItemKey(item) ? " is-selected" : ""}`}
                  onClick={() => onSelectShoot(item)}
                >
                  <div className="schedule-day-queue__top">
                    <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(item.shoot_category ?? item.department)}`}>
                      {humanizeLabel(item.shoot_category ?? "shoot")}
                    </span>
                    <span className="schedule-day-queue__time">{formatTimeRange(item.starts_at, item.ends_at)}</span>
                  </div>
                  <strong>{item.shoot_code} | {item.title}</strong>
                  <div className="muted" title={item.location_name || item.location_address || "Location pending"}>
                    {item.location_name || item.location_address || "Location pending"}
                  </div>
                  <div className="schedule-day-queue__meta">
                    {showStaffingDetails ? (
                      <span className={`risk-pill risk-pill--${item.under_staffed || item.missing_lead ? "critical" : "normal"}`}>
                        {(item.assigned_staff_count ?? 0)}/{item.planned_staff_count ?? item.assigned_staff_count ?? 0} staffed
                      </span>
                    ) : (
                      <span className="meta-pill">{humanizeLabel(item.status)}</span>
                    )}
                    {(item.open_alert_count ?? 0) + (item.open_attendance_exception_count ?? 0) > 0 ? (
                      <span className="meta-pill">
                        {(item.open_alert_count ?? 0) + (item.open_attendance_exception_count ?? 0)} issue
                        {(item.open_alert_count ?? 0) + (item.open_attendance_exception_count ?? 0) === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {item.integration.manual_review_required || item.integration.sync_required ? (
                      <span className="meta-pill">Sync review</span>
                    ) : null}
                  </div>
                </button>
              ) : isEventItem(item) ? (
                <button
                  key={item.id}
                  type="button"
                  className={`schedule-day-queue__item${selectedItemKey === getItemKey(item) ? " is-selected" : ""}`}
                  onClick={() => onSelectEvent(item)}
                >
                  <div className="schedule-day-queue__top">
                    <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(item.department)}`}>
                      {humanizeLabel(item.event_kind)}
                    </span>
                    <span className="schedule-day-queue__time">{formatTimeRange(item.starts_at, item.ends_at)}</span>
                  </div>
                  <strong>{item.title}</strong>
                  <div className="muted" title={item.location_name || item.location_address || "Location pending"}>
                    {item.location_name || item.location_address || "Location pending"}
                  </div>
                  <div className="schedule-day-queue__meta">
                    <span className="meta-pill">{item.lead_name || "Lead pending"}</span>
                    {item.integration.manual_review_required || item.integration.sync_required ? (
                      <span className="meta-pill">Sync review</span>
                    ) : null}
                  </div>
                </button>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  className={`schedule-day-queue__item${selectedItemKey === getItemKey(item) ? " is-selected" : ""}`}
                  onClick={() => onSelectAvailability(item)}
                >
                  <div className="schedule-day-queue__top">
                    <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(item.department)}`}>
                      {item.availability_kind === "absence" ? "Absence" : item.availability_kind === "blocked_date" ? "Blocked" : "Availability"}
                    </span>
                    <span className="schedule-day-queue__time">
                      {item.starts_at && item.ends_at ? formatTimeRange(item.starts_at, item.ends_at) : "All day"}
                    </span>
                  </div>
                  <strong>{item.title}</strong>
                  <div className="muted">
                    {item.user_name
                      ? `${item.user_name}${item.reason_category ? ` | ${humanizeLabel(item.reason_category)}` : ""}`
                      : item.note || "Operational availability block"}
                  </div>
                  <div className="schedule-day-queue__meta">
                    <span className={`risk-pill risk-pill--${item.warning_level === "critical" || item.warning_level === "high" ? "critical" : item.warning_level === "medium" ? "watch" : "normal"}`}>
                      {item.badge_label || humanizeLabel(item.status)}
                    </span>
                    {item.minimum_staffing_break_count > 0 ? <span className="meta-pill">Breaks minimum staffing</span> : null}
                    {item.lead_coverage_break_count > 0 ? <span className="meta-pill">Lead coverage risk</span> : null}
                  </div>
                </button>
              )
            )}
          </div>
        </section>
      ) : (
        <div className="empty-state empty-state--panel">No schedule items land on this day yet.</div>
      )}

      {selectedShootBriefing ? (
        <div className="schedule-selected-detail">
          <div className="schedule-selected-detail__actions">
            <button className="secondary-button" onClick={() => onOpenShoot(selectedShootBriefing.shootId)}>
              Open Shoot Workspace
            </button>
            {canManage && onOpenStaffing && selectedShoot && isShootItem(selectedShoot) ? (
              <button className="primary-button" onClick={() => onOpenStaffing(selectedShoot)}>
                Staff Shoot
              </button>
            ) : null}
            <button
              className="secondary-button"
              onClick={() => window.open(selectedShootBriefing.mapsUrl ?? "#", "_blank", "noreferrer")}
              disabled={!selectedShootBriefing.mapsUrl}
            >
              Open Maps
            </button>
          </div>
          {selectedShoot && isShootItem(selectedShoot) ? (
            <ScheduleIntegrationPanel
              item={selectedShoot}
              integration={selectedShoot.integration}
              canManage={canManage}
              integrationActionKey={integrationActionKey}
              onIntegrationAction={onIntegrationAction}
            />
          ) : null}
          <ShootBriefingBody briefing={selectedShootBriefing} />
        </div>
      ) : selectedEvent ? (
        <ScheduleEventPanel
          event={selectedEvent}
          canManage={canManage}
          integrationActionKey={integrationActionKey}
          onIntegrationAction={onIntegrationAction}
          onOpenShoot={onOpenShoot}
        />
      ) : selectedAvailability ? (
        <ScheduleAvailabilityPanel availability={selectedAvailability} />
      ) : selectedDayItems.length ? (
        <div className="empty-state empty-state--panel">Select a shoot, event, or availability block from the day queue to review the full detail.</div>
      ) : null}
    </aside>
  );
}

function renderCalendarSurface(input: {
  anchorDate: string;
  canManage: boolean;
  dayGroups: Array<{ dateKey: string; label: string; items: UnifiedScheduleItem[] }>;
  detailCache: Record<string, ShootDetail>;
  employeeOnlyMode: boolean;
  integrationActionKey: string;
  isNarrowLayout: boolean;
  onError: (message: string) => void;
  onIntegrationAction: (item: UnifiedScheduleItem, action: "push" | "resync" | "acknowledge") => Promise<void>;
  onOpenShift?: (shift: ShiftRecord) => void;
  onOpenShoot: (shootId: string) => void;
  onOpenStaffing?: (shoot: UnifiedScheduleShootItem) => void;
  handleAvailabilitySelect: (item: UnifiedScheduleAvailabilityItem) => void;
  shiftsByShootId: Map<string, ShiftRecord[]>;
  handleEventSelect: (event: UnifiedScheduleEventItem) => void;
  handleShootToggle: (shoot: UnifiedScheduleShootItem) => void;
  movingItemId: string;
  moveItem: (item: UnifiedScheduleItem, targetDate: string) => Promise<void>;
  selectedDayItems: UnifiedScheduleItem[];
  selectedDayKey: string;
  selectedAvailability: UnifiedScheduleAvailabilityItem | null;
  selectedEvent: UnifiedScheduleEventItem | null;
  selectedItemKey: string;
  selectedShootBriefing: ReturnType<typeof buildShootBriefing> | null;
  showStaffingDetails: boolean;
  setSelectedDayKey: (value: string) => void;
  setSelectedItemKey: (value: string) => void;
  standaloneShiftRowsByDay: Map<string, ShiftRecord[]>;
  staffingDisplayMode: StaffingDisplayMode;
  viewMode: ScheduleGridMode;
  ensureShootDetail: (shootId: string) => Promise<void>;
}) {
  const allVisibleItems = input.dayGroups.flatMap((group) => group.items);
  const selectedDay = input.dayGroups.find((group) => group.dateKey === input.selectedDayKey) ?? null;
  const visibleDayGroups =
    input.viewMode === "day" ? (selectedDay ? [selectedDay] : input.dayGroups.slice(0, 1)) : input.dayGroups;

  function focusDay(dateKey: string, items: UnifiedScheduleItem[]) {
    input.setSelectedDayKey(dateKey);
    const currentItem = allVisibleItems.find((item) => getItemKey(item) === input.selectedItemKey);
    if (currentItem && currentItem.date_key !== dateKey) {
      input.setSelectedItemKey("");
    }
    if (!currentItem && items.length === 1) {
      const onlyItem = items[0];
      input.setSelectedItemKey(getItemKey(onlyItem));
      if (isShootItem(onlyItem)) {
        void input.ensureShootDetail(onlyItem.id);
      }
    }
  }

  if (input.viewMode === "month") {
    return (
      <div className="schedule-month-layout">
        <div className="schedule-month-grid">
          {buildMonthGrid(input.anchorDate).map((day) => {
            const items = input.dayGroups.find((group) => group.dateKey === day.dateKey)?.items ?? [];
            const summary = summarizeDayItems(items);
            const selected = input.selectedDayKey === day.dateKey;
            return (
              <button
                key={day.dateKey}
                className={`schedule-month-day${day.inCurrentMonth ? "" : " schedule-month-day--outside"}${selected ? " schedule-month-day--selected" : ""}`}
                onClick={() => focusDay(day.dateKey, items)}
              >
                <span className="schedule-month-day__number">{day.dayOfMonth}</span>
                <span className="schedule-month-day__count">{items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""}</span>
                {summary.staffingWatchCount || summary.reviewCount ? (
                  <span className="schedule-month-day__flag">
                    {summary.staffingWatchCount ? `${summary.staffingWatchCount} watch` : `${summary.reviewCount} review`}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <ScheduleDayBriefing
          canManage={input.canManage}
          dayGroups={input.dayGroups}
          integrationActionKey={input.integrationActionKey}
          onIntegrationAction={input.onIntegrationAction}
          onOpenShoot={input.onOpenShoot}
          onOpenStaffing={input.onOpenStaffing}
          onSelectAvailability={input.handleAvailabilitySelect}
          onSelectEvent={input.handleEventSelect}
          onSelectShoot={input.handleShootToggle}
          selectedAvailability={input.selectedAvailability}
          selectedDayItems={input.selectedDayItems}
          selectedDayKey={input.selectedDayKey}
          selectedEvent={input.selectedEvent}
          selectedItemKey={input.selectedItemKey}
          selectedShootBriefing={input.selectedShootBriefing}
          showStaffingDetails={input.showStaffingDetails}
          windowMode={input.viewMode === "month" ? "30day" : "week"}
        />
      </div>
    );
  }

  return (
    <div className={`schedule-calendar-layout schedule-calendar-layout--${input.viewMode}`}>
      <div className={`schedule-day-columns schedule-day-columns--${input.viewMode}${input.isNarrowLayout ? " schedule-day-columns--narrow" : ""}`}>
        {visibleDayGroups.map((group) => {
          const daySummary = summarizeDayItems(group.items);
          const standaloneShiftRows = input.standaloneShiftRowsByDay.get(group.dateKey) ?? [];
          return (
            <section
              key={group.dateKey}
              className={`schedule-day-column schedule-day-surface${input.selectedDayKey === group.dateKey ? " is-selected" : ""}`}
              onDragOver={(event) => {
                if (input.canManage) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                if (!input.canManage) {
                  return;
                }
                event.preventDefault();
                try {
                  const payload = JSON.parse(event.dataTransfer.getData("application/json")) as UnifiedScheduleItem;
                  void input.moveItem(payload, group.dateKey);
                  focusDay(group.dateKey, group.items);
                } catch {
                  input.onError("We couldn't read the dragged schedule item.");
                }
              }}
            >
              <button type="button" className="schedule-day-surface__header" onClick={() => focusDay(group.dateKey, group.items)}>
                <div>
                  <div className="eyebrow">{input.viewMode === "day" ? "Day View" : "Week View"}</div>
                  <strong>{group.label}</strong>
                </div>
                <span className={`risk-pill risk-pill--${getDaySummaryTone(daySummary)}`}>
                  {group.items.length ? `${group.items.length} item${group.items.length === 1 ? "" : "s"}` : "Clear"}
                </span>
              </button>
              <div className="schedule-day-surface__summary">
                <div className="schedule-day-surface__metric">
                  <span>Shoots</span>
                  <strong>{daySummary.shootCount}</strong>
                </div>
                <div className="schedule-day-surface__metric">
                  <span>Staffing Watch</span>
                  <strong>{daySummary.staffingWatchCount}</strong>
                </div>
                <div className="schedule-day-surface__metric">
                  <span>Review Flags</span>
                  <strong>{daySummary.reviewCount}</strong>
                </div>
              </div>
              <div className="schedule-day-column__items">
                {group.items.map((item) =>
                  isShootItem(item) ? (
                    <div key={item.id} draggable={input.canManage} onDragStart={(event) => event.dataTransfer.setData("application/json", JSON.stringify(item))}>
                      <ShootHotSheetCard
                        briefing={buildShootBriefing(toShootSummary(item), input.detailCache[item.id] ?? null)}
                        expanded={input.selectedItemKey === `shoot:${item.id}`}
                        expansionMode="panel"
                        onToggle={() => input.handleShootToggle(item)}
                      />
                      {input.staffingDisplayMode === "show_assignments" ? (
                        <ScheduleShiftLayer
                          shifts={input.shiftsByShootId.get(item.id) ?? []}
                          employeeOnlyMode={input.employeeOnlyMode}
                          personalPresentation={!input.showStaffingDetails}
                          onOpenShift={input.onOpenShift}
                          title={input.employeeOnlyMode ? "My Assignments" : "Assignments"}
                        />
                      ) : null}
                    </div>
                  ) : isEventItem(item) ? (
                    <button
                      key={item.id}
                      className={`schedule-event-card${input.selectedItemKey === getItemKey(item) ? " is-selected" : ""}`}
                      draggable={input.canManage}
                      onDragStart={(event) => event.dataTransfer.setData("application/json", JSON.stringify(item))}
                      onClick={() => input.handleEventSelect(item)}
                    >
                      {(() => {
                        const syncPreview = renderEventSyncPreview(item.integration);
                        return syncPreview ? (
                          <div className={`schedule-event-card__sync schedule-event-card__sync--${syncPreview.tone}`}>{syncPreview.label}</div>
                        ) : null;
                      })()}
                      <div className="schedule-event-card__top">
                        <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(item.department)}`}>{humanizeLabel(item.event_kind)}</span>
                        <span className="schedule-event-card__time">{formatTimeRange(item.starts_at, item.ends_at)}</span>
                      </div>
                      <strong>{item.title}</strong>
                      <div className="muted" title={item.location_name || item.location_address || "Location pending"}>
                        {item.location_name || item.location_address || "Location pending"}
                      </div>
                      <div className="muted">{item.lead_name || "Lead pending"}</div>
                    </button>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      className={`schedule-event-card schedule-event-card--availability${input.selectedItemKey === getItemKey(item) ? " is-selected" : ""}`}
                      onClick={() => input.handleAvailabilitySelect(item)}
                    >
                      <div className="schedule-event-card__top">
                        <span className={`shoot-type-chip shoot-type-chip--${getDepartmentCategory(item.department)}`}>
                          {item.availability_kind === "absence"
                            ? "Absence"
                            : item.availability_kind === "blocked_date"
                              ? "Blocked"
                              : "Availability"}
                        </span>
                        <span className="schedule-event-card__time">
                          {item.starts_at && item.ends_at ? formatTimeRange(item.starts_at, item.ends_at) : "All day"}
                        </span>
                      </div>
                      <strong>{item.title}</strong>
                      <div className="muted">{item.user_name || item.note || "Operational availability block"}</div>
                      <div className="schedule-event-card__meta">
                        <span className={`risk-pill risk-pill--${item.warning_level === "critical" || item.warning_level === "high" ? "critical" : item.warning_level === "medium" ? "watch" : "normal"}`}>
                          {item.badge_label || humanizeLabel(item.status)}
                        </span>
                        {item.minimum_staffing_break_count > 0 ? <span className="meta-pill">Breaks minimum staffing</span> : null}
                        {item.lead_coverage_break_count > 0 ? <span className="meta-pill">Lead coverage risk</span> : null}
                      </div>
                    </button>
                  )
                )}
                {input.staffingDisplayMode === "show_assignments" && standaloneShiftRows.length ? (
                  <ScheduleShiftLayer
                    shifts={standaloneShiftRows}
                    employeeOnlyMode={input.employeeOnlyMode}
                    personalPresentation={!input.showStaffingDetails}
                    onOpenShift={input.onOpenShift}
                    title="Internal Assignments"
                  />
                ) : null}
                {!group.items.length ? <div className="empty-state">No items scheduled.</div> : null}
              </div>
            </section>
          );
        })}
      </div>
      <ScheduleDayBriefing
        canManage={input.canManage}
        dayGroups={input.dayGroups}
        integrationActionKey={input.integrationActionKey}
        onIntegrationAction={input.onIntegrationAction}
        onOpenShoot={input.onOpenShoot}
        onOpenStaffing={input.onOpenStaffing}
        onSelectAvailability={input.handleAvailabilitySelect}
        onSelectEvent={input.handleEventSelect}
        onSelectShoot={input.handleShootToggle}
        selectedAvailability={input.selectedAvailability}
        selectedDayItems={selectedDay?.items ?? []}
        selectedDayKey={input.selectedDayKey}
        selectedEvent={input.selectedEvent}
        selectedItemKey={input.selectedItemKey}
        selectedShootBriefing={input.selectedShootBriefing}
        showStaffingDetails={input.showStaffingDetails}
        windowMode={input.viewMode === "day" ? "today" : "week"}
      />
    </div>
  );
}

function renderAgendaSurface(input: {
  dayGroups: Array<{ dateKey: string; label: string; items: UnifiedScheduleItem[] }>;
  employeeOnlyMode: boolean;
  scheduleWorkspace: boolean;
  filteredShiftRows: ShiftRecord[];
  onOpenShift?: (shift: ShiftRecord) => void;
  onOpenShoot: (shootId: string) => void;
  staffingDisplayMode: StaffingDisplayMode;
  selectedDayKey: string;
  setSelectedDayKey: (value: string) => void;
}) {
  const shiftsByDay = new Map<string, ShiftRecord[]>();
  for (const shift of input.filteredShiftRows) {
    const dateKey = shift.starts_at.slice(0, 10);
    const existing = shiftsByDay.get(dateKey);
    if (existing) {
      existing.push(shift);
    } else {
      shiftsByDay.set(dateKey, [shift]);
    }
  }
  shiftsByDay.forEach((rows) => rows.sort(compareShiftRows));

  const agendaDays = input.dayGroups.filter((group) => group.items.length > 0 || (shiftsByDay.get(group.dateKey)?.length ?? 0) > 0);

  return (
    <div className="schedule-agenda-layout">
      {agendaDays.map((group) => {
        const shifts = shiftsByDay.get(group.dateKey) ?? [];
        const shoots = group.items.filter(isShootItem);
        const events = group.items.filter(isEventItem);
        const availabilityItems = group.items.filter(isAvailabilityItem);
        const showAssignments =
          shifts.length > 0 && (input.scheduleWorkspace || input.employeeOnlyMode || input.staffingDisplayMode === "show_assignments" || shoots.length === 0);
        const showShoots = shoots.length > 0 && (input.scheduleWorkspace ? shifts.length === 0 : !input.employeeOnlyMode || shifts.length === 0);
        const selected = input.selectedDayKey === group.dateKey;
        const summary = summarizeDayItems(group.items);

        return (
          <section key={group.dateKey} className={`schedule-agenda-day${selected ? " is-selected" : ""}`}>
            <button type="button" className="schedule-agenda-day__header" onClick={() => input.setSelectedDayKey(group.dateKey)}>
              <div>
                <div className="eyebrow">List View</div>
                <strong>{group.label}</strong>
              </div>
              <div className="schedule-agenda-day__summary">
                <span className="meta-pill">{summary.shootCount} shoots</span>
                {shifts.length ? <span className="meta-pill">{shifts.length} assignments</span> : null}
                {summary.staffingWatchCount || summary.reviewCount ? (
                  <span className={`risk-pill risk-pill--${getDaySummaryTone(summary)}`}>
                    {summary.staffingWatchCount ? `${summary.staffingWatchCount} watch` : `${summary.reviewCount} review`}
                  </span>
                ) : null}
              </div>
            </button>

            {showAssignments ? (
              <ScheduleShiftLayer
                shifts={shifts}
                employeeOnlyMode={input.employeeOnlyMode}
                personalPresentation={input.scheduleWorkspace}
                onOpenShift={input.onOpenShift}
                title={input.employeeOnlyMode ? "My Assignments" : "Assignments"}
              />
            ) : null}

            {showShoots ? (
              <div className="schedule-agenda-stack">
                <div className="schedule-agenda-section__label">Shoots</div>
                {shoots.map((shoot) => {
                  const issueCount = (shoot.open_alert_count ?? 0) + (shoot.open_attendance_exception_count ?? 0);
                  return (
                    <button key={shoot.id} type="button" className="schedule-agenda-card" onClick={() => input.onOpenShoot(shoot.id)}>
                      <div className="schedule-agenda-card__header">
                        <div>
                          <div className="schedule-agenda-card__time">{formatTimeRange(shoot.starts_at, shoot.ends_at)}</div>
                          <strong>
                            {shoot.shoot_code} | {shoot.title}
                          </strong>
                        </div>
                        <span className="meta-pill">{humanizeLabel(shoot.status)}</span>
                      </div>
                      <div className="muted">{shoot.location_name || shoot.location_address || "Location pending"}</div>
                      <div className="schedule-agenda-card__meta">
                        {input.scheduleWorkspace ? null : <span className="meta-pill">{shoot.lead_name || "Lead pending"}</span>}
                        {input.scheduleWorkspace ? (
                          <span className="meta-pill">{humanizeLabel(shoot.status)}</span>
                        ) : (
                          <span className={`risk-pill risk-pill--${shoot.under_staffed || shoot.missing_lead ? "critical" : "normal"}`}>
                            {(shoot.assigned_staff_count ?? 0)}/{shoot.planned_staff_count ?? shoot.assigned_staff_count ?? 0} staffed
                          </span>
                        )}
                        {!input.scheduleWorkspace && (shoot.priority_label === "big_shoot" || shoot.priority_label === "critical_shoot") ? (
                          <span className="risk-pill risk-pill--watch">{shoot.priority_label_display ?? humanizeLabel(shoot.priority_label)}</span>
                        ) : null}
                        {!input.scheduleWorkspace && shoot.missing_lead ? <span className="risk-pill risk-pill--critical">Missing lead</span> : null}
                        {!input.scheduleWorkspace && shoot.under_staffed ? <span className="risk-pill risk-pill--critical">Understaffed</span> : null}
                        {!input.scheduleWorkspace && (shoot.conflict_warning_count ?? 0) > 0 ? <span className="risk-pill risk-pill--watch">Conflict warning</span> : null}
                        {issueCount > 0 ? <span className="meta-pill">{issueCount} issue{issueCount === 1 ? "" : "s"}</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {events.length ? (
              <div className="schedule-agenda-stack">
                <div className="schedule-agenda-section__label">Operational Events</div>
                {events.map((event) => (
                  <button key={event.id} type="button" className="schedule-agenda-card schedule-agenda-card--event">
                    <div className="schedule-agenda-card__header">
                      <div>
                        <div className="schedule-agenda-card__time">{formatTimeRange(event.starts_at, event.ends_at)}</div>
                        <strong>{event.title}</strong>
                      </div>
                      <span className="meta-pill">{humanizeLabel(event.event_kind)}</span>
                    </div>
                    <div className="muted">{event.location_name || event.location_address || "Location pending"}</div>
                    <div className="schedule-agenda-card__meta">
                      <span className="meta-pill">{event.lead_name || "Lead pending"}</span>
                      {event.integration.manual_review_required || event.integration.sync_required ? (
                        <span className="risk-pill risk-pill--watch">Sync review</span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {availabilityItems.length ? (
              <div className="schedule-agenda-stack">
                <div className="schedule-agenda-section__label">Availability & Blocks</div>
                {availabilityItems.map((item) => (
                  <div key={item.id} className="schedule-agenda-card schedule-agenda-card--event">
                    <div className="schedule-agenda-card__header">
                      <div>
                        <div className="schedule-agenda-card__time">
                          {item.starts_at && item.ends_at ? formatTimeRange(item.starts_at, item.ends_at) : "All day"}
                        </div>
                        <strong>{item.title}</strong>
                      </div>
                      <span className="meta-pill">
                        {item.availability_kind === "absence"
                          ? "Absence"
                          : item.availability_kind === "blocked_date"
                            ? "Blocked"
                            : "Availability"}
                      </span>
                    </div>
                    <div className="muted">{item.user_name || item.note || "Operational availability block"}</div>
                    <div className="schedule-agenda-card__meta">
                      <span className={`risk-pill risk-pill--${item.warning_level === "critical" || item.warning_level === "high" ? "critical" : item.warning_level === "medium" ? "watch" : "normal"}`}>
                        {item.badge_label || humanizeLabel(item.status)}
                      </span>
                      {item.minimum_staffing_break_count > 0 ? <span className="meta-pill">Breaks minimum staffing</span> : null}
                      {item.lead_coverage_break_count > 0 ? <span className="meta-pill">Lead coverage risk</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      {!agendaDays.length ? <div className="empty-state empty-state--panel">No shoots or assignments match the current schedule filters.</div> : null}
    </div>
  );
}

function renderBoardSurface(input: {
  canManage: boolean;
  detailCache: Record<string, ShootDetail>;
  filteredBoardGroups: UnifiedScheduleBoardResponse["groups"];
  handleShootToggle: (shoot: UnifiedScheduleShootItem) => void;
  integrationActionKey: string;
  onIntegrationAction: (item: UnifiedScheduleItem, action: "push" | "resync" | "acknowledge") => Promise<void>;
  onOpenShoot: (shootId: string) => void;
  onOpenStaffing?: (shoot: UnifiedScheduleShootItem) => void;
  selectedItemKey: string;
  selectedShootBriefing: ReturnType<typeof buildShootBriefing> | null;
  selectedShootIds: string[];
  toggleShootSelection: (shootId: string) => void;
}) {
  return (
    <div className="schedule-board-layout">
      <div className="schedule-board-columns">
        {input.filteredBoardGroups.map((group) => (
          <section key={group.key} className="schedule-board-column">
            <div className="schedule-board-column__header">
              <div>
                <div className="eyebrow">{group.label}</div>
                <strong>{group.shoots.length} shoots</strong>
              </div>
            </div>
            <div className="schedule-board-column__stack">
              {group.shoots.map((shoot) => (
                <div key={shoot.id} className="schedule-board-card-shell">
                  {input.canManage ? (
                    <label className="schedule-select-toggle">
                      <input
                        type="checkbox"
                        checked={input.selectedShootIds.includes(shoot.id)}
                        onChange={() => input.toggleShootSelection(shoot.id)}
                      />
                      <span>Select</span>
                    </label>
                  ) : null}
                  <ShootHotSheetCard
                    briefing={buildShootBriefing(toShootSummary(shoot), input.detailCache[shoot.id] ?? null)}
                    expanded={input.selectedItemKey === `shoot:${shoot.id}`}
                    expansionMode="panel"
                    onToggle={() => input.handleShootToggle(shoot)}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        {!input.filteredBoardGroups.length ? <div className="empty-state empty-state--panel">No shoots match the current board filters.</div> : null}
      </div>
      <aside className="panel shoot-briefing-panel">
        <div className="shoot-briefing-panel__header">
          <div>
            <div className="eyebrow">Board Detail</div>
            <h3>{input.selectedShootBriefing ? `${input.selectedShootBriefing.shootCode} | ${input.selectedShootBriefing.title}` : "Select A Shoot"}</h3>
            <p className="section-subtitle">Board view keeps workflow and staffing grouped without losing the operational briefing.</p>
          </div>
        </div>
        {input.selectedShootBriefing ? (
          <div className="schedule-selected-detail">
            <div className="schedule-selected-detail__actions">
              <button className="secondary-button" onClick={() => input.onOpenShoot(input.selectedShootBriefing!.shootId)}>
                Open Shoot Workspace
              </button>
              {input.canManage && input.onOpenStaffing ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    const selected = input.filteredBoardGroups
                      .flatMap((group) => group.shoots)
                      .find((shoot) => shoot.id === input.selectedShootBriefing!.shootId);
                    if (selected) {
                      input.onOpenStaffing?.(selected);
                    }
                  }}
                >
                  Staff Shoot
                </button>
              ) : null}
            </div>
            {(() => {
              const selected = input.filteredBoardGroups.flatMap((group) => group.shoots).find(
                (shoot) => shoot.id === input.selectedShootBriefing!.shootId
              );
              return selected ? (
                <ScheduleIntegrationPanel
                  item={selected}
                  integration={selected.integration}
                  canManage={input.canManage}
                  integrationActionKey={input.integrationActionKey}
                  onIntegrationAction={input.onIntegrationAction}
                />
              ) : null;
            })()}
            <ShootBriefingBody briefing={input.selectedShootBriefing} />
          </div>
        ) : (
          <div className="empty-state empty-state--panel">Choose a shoot from the board to review staffing, timing, sync, and risk details.</div>
        )}
      </aside>
    </div>
  );
}

function isShootItem(item: UnifiedScheduleItem): item is UnifiedScheduleShootItem {
  return item.item_kind === "shoot";
}

function isEventItem(item: UnifiedScheduleItem): item is UnifiedScheduleEventItem {
  return item.item_kind === "event";
}

function isAvailabilityItem(item: UnifiedScheduleItem): item is UnifiedScheduleAvailabilityItem {
  return item.item_kind === "availability";
}

function enumerateDateKeys(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function formatDayLabel(dateKey: string, windowMode: WindowMode) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: windowMode === "30day" ? "long" : "short",
    month: "short",
    day: "numeric"
  });
}

function compareScheduleItems(left: UnifiedScheduleItem, right: UnifiedScheduleItem) {
  const leftValue = new Date(String(left.starts_at ?? left.date_key)).getTime();
  const rightValue = new Date(String(right.starts_at ?? right.date_key)).getTime();
  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }
  return String(left.title).localeCompare(String(right.title));
}

function filterItemsBySearch(items: UnifiedScheduleItem[], search: string) {
  const lowered = search.trim().toLowerCase();
  if (!lowered) {
    return items;
  }
  return items.filter((item) => {
    if (isShootItem(item)) {
      return matchesShootSearch(item, lowered);
    }
    if (isEventItem(item)) {
      return [item.title, item.location_name, item.location_address, item.lead_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(lowered);
    }
    return [item.title, item.user_name, item.request_type, item.reason_category, item.note, item.badge_label]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(lowered);
  });
}

function matchesShootSearch(shoot: UnifiedScheduleShootItem, lowered: string) {
  if (!lowered) {
    return true;
  }
  return [shoot.shoot_code, shoot.title, shoot.location_name, shoot.location_address, shoot.lead_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(lowered);
}

function formatTimeRange(startsAt?: string | null, endsAt?: string | null) {
  const start = formatTime(startsAt);
  const end = formatTime(endsAt);
  return start && end ? `${start} - ${end}` : start || end || "Time pending";
}

function formatTime(value?: string | null) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function getDepartmentCategory(department?: string | null) {
  if (department === "sports") {
    return "sports";
  }
  if (department === "schools") {
    return "schools";
  }
  if (department === "studio" || department === "production") {
    return "studio";
  }
  return "events";
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function mapIntegrationTone(health: ScheduleRecordIntegrationState["sync_health"]) {
  if (health === "healthy") {
    return "normal";
  }
  if (health === "neutral") {
    return "normal";
  }
  if (health === "pending" || health === "warning") {
    return "watch";
  }
  if (health === "error") {
    return "critical";
  }
  return "neutral";
}

function formatCompactDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function matchesNarrowScheduleLayout() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 860px)").matches : false;
}

function mapScheduleRangeToWindow(rangeMode: ScheduleRangeMode): WindowMode {
  if (rangeMode === "day") {
    return "today";
  }
  if (rangeMode === "3day") {
    return "3day";
  }
  if (rangeMode === "30day") {
    return "30day";
  }
  return "week";
}

function getClientWindowRange(anchorDate: string, windowMode: WindowMode) {
  const anchor = new Date(`${anchorDate}T12:00:00`);
  let startDate = anchorDate;
  let endDate = anchorDate;

  if (windowMode === "3day") {
    endDate = addDateDays(anchor, 2).toISOString().slice(0, 10);
  } else if (windowMode === "week") {
    const weekday = anchor.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = addDateDays(anchor, mondayOffset);
    startDate = monday.toISOString().slice(0, 10);
    endDate = addDateDays(monday, 6).toISOString().slice(0, 10);
  } else if (windowMode === "30day") {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0, 0);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12, 0, 0, 0);
    startDate = monthStart.toISOString().slice(0, 10);
    endDate = monthEnd.toISOString().slice(0, 10);
  }

  return { startDate, endDate };
}

function addDateDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function filterScheduleItems(
  items: UnifiedScheduleItem[],
  filters: {
    search: string;
    shootTypeFilter: string;
    staffingHealthFilter: string;
    priorityFilter: string;
    staffingRoleFilter?: string;
    myItemsOnly: boolean;
    shiftsByShootId?: Map<string, ShiftRecord[]>;
  }
) {
  const lowered = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (isShootItem(item)) {
      if (!matchesShootSearch(item, lowered)) {
        return false;
      }
      return matchesShootFilters(item, filters);
    }
    if (lowered) {
      const matches = (
        isEventItem(item)
          ? [item.title, item.location_name, item.location_address, item.lead_name]
          : [item.title, item.user_name, item.request_type, item.reason_category, item.note, item.badge_label]
      )
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(lowered);
      if (!matches) {
        return false;
      }
    }
    if (filters.priorityFilter || filters.staffingHealthFilter) {
      return false;
    }
    if (filters.shootTypeFilter) {
      return getDepartmentCategory(item.department) === filters.shootTypeFilter;
    }
    return true;
  });
}

function matchesShootFilters(
  shoot: UnifiedScheduleShootItem,
  filters: {
    shootTypeFilter: string;
    staffingHealthFilter: string;
    priorityFilter: string;
    staffingRoleFilter?: string;
    shiftsByShootId?: Map<string, ShiftRecord[]>;
  }
) {
  if (filters.shootTypeFilter) {
    const category = shoot.shoot_category ?? getDepartmentCategory(shoot.department);
    if (category !== filters.shootTypeFilter) {
      return false;
    }
  }

  if (filters.priorityFilter === "big_critical" && !isBigOrCriticalShoot(shoot)) {
    return false;
  }

  if (filters.staffingRoleFilter) {
    const roleMatches = (filters.shiftsByShootId?.get(shoot.id) ?? []).some((shift) => shift.staffing_role === filters.staffingRoleFilter);
    if (!roleMatches) {
      return false;
    }
  }

  if (!filters.staffingHealthFilter) {
    return true;
  }

  if (filters.staffingHealthFilter === "ready") {
    return !hasShootAttention(shoot);
  }
  if (filters.staffingHealthFilter === "understaffed") {
    return shoot.under_staffed;
  }
  if (filters.staffingHealthFilter === "missing_lead") {
    return shoot.missing_lead;
  }
  if (filters.staffingHealthFilter === "attendance_issue") {
    return (shoot.open_attendance_exception_count ?? 0) > 0;
  }
  if (filters.staffingHealthFilter === "conflict") {
    return (shoot.conflict_warning_count ?? 0) > 0 || (shoot.open_alert_count ?? 0) > 0;
  }
  if (filters.staffingHealthFilter === "overstaffed") {
    return Boolean(shoot.over_staffed);
  }
  if (filters.staffingHealthFilter === "unconfirmed") {
    return (shoot.unconfirmed_staff_count ?? 0) > 0;
  }
  return true;
}

function filterShiftRows(
  rows: ShiftRecord[],
  filters: {
    search: string;
    departmentFilter: string;
    statusFilter: string;
    leadUserId: string;
    employeeId: string;
    staffingRoleFilter: string;
    locationQuery: string;
    shootTypeFilter: string;
    staffingHealthFilter: string;
    myItemsOnly: boolean;
    currentUserId: string;
    shootIndexById: Map<string, UnifiedScheduleShootItem>;
  }
) {
  const loweredSearch = filters.search.trim().toLowerCase();
  const loweredLocation = filters.locationQuery.trim().toLowerCase();

  return rows
    .filter((shift) => {
      const shoot = shift.shoot_id ? filters.shootIndexById.get(shift.shoot_id) : undefined;

      if (filters.myItemsOnly && shift.assigned_user_id !== filters.currentUserId) {
        return false;
      }
      if (filters.employeeId && shift.assigned_user_id !== filters.employeeId) {
        return false;
      }
      if (filters.leadUserId && shift.manager_user_id !== filters.leadUserId) {
        return false;
      }
      if (filters.staffingRoleFilter && shift.staffing_role !== filters.staffingRoleFilter) {
        return false;
      }
      if (filters.departmentFilter && shift.department !== filters.departmentFilter) {
        return false;
      }
      if (filters.statusFilter && !String(shift.status).toLowerCase().includes(filters.statusFilter.trim().toLowerCase())) {
        return false;
      }
      if (loweredLocation) {
        const locationText = [shift.location_name, shift.location_address].filter(Boolean).join(" ").toLowerCase();
        if (!locationText.includes(loweredLocation)) {
          return false;
        }
      }
      if (filters.shootTypeFilter) {
        const category = shoot?.shoot_category ?? (shift.shift_kind === "shoot" ? getDepartmentCategory(shift.department) : null);
        if (category !== filters.shootTypeFilter) {
          return false;
        }
      }
      if (loweredSearch && !matchesShiftSearch(shift, loweredSearch)) {
        return false;
      }
      if (!matchesShiftFilters(shift, shoot, filters.staffingHealthFilter)) {
        return false;
      }
      return true;
    })
    .sort(compareShiftRows);
}

function matchesShiftSearch(shift: ShiftRecord, lowered: string) {
  if (!lowered) {
    return true;
  }
  return [
    shift.assigned_user_name,
    shift.manager_name,
    shift.staffing_role,
    shift.title,
    shift.shoot_code,
    shift.shoot_title,
    shift.location_name,
    shift.location_address
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(lowered);
}

function matchesShiftFilters(shift: ShiftRecord, shoot: UnifiedScheduleShootItem | undefined, staffingHealthFilter: string) {
  if (!staffingHealthFilter) {
    return true;
  }
  if (staffingHealthFilter === "ready") {
    return !isAttendanceExceptionState(shift.attendance_state) && !(shoot && hasShootAttention(shoot));
  }
  if (staffingHealthFilter === "understaffed") {
    return Boolean(shoot?.under_staffed);
  }
  if (staffingHealthFilter === "missing_lead") {
    return Boolean(shoot?.missing_lead);
  }
  if (staffingHealthFilter === "attendance_issue") {
    return isAttendanceExceptionState(shift.attendance_state) || isLocationExceptionState(shift.latest_geofence_status);
  }
  if (staffingHealthFilter === "conflict") {
    return Boolean((shoot?.conflict_warning_count ?? 0) > 0 || (shoot?.open_alert_count ?? 0) > 0);
  }
  if (staffingHealthFilter === "overstaffed") {
    return Boolean(shoot?.over_staffed);
  }
  if (staffingHealthFilter === "unconfirmed") {
    return Boolean((shoot?.unconfirmed_staff_count ?? 0) > 0 || shift.status === "draft");
  }
  return true;
}

function compareShiftRows(left: ShiftRecord, right: ShiftRecord) {
  const leftValue = new Date(left.starts_at).getTime();
  const rightValue = new Date(right.starts_at).getTime();
  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }
  return left.assigned_user_name.localeCompare(right.assigned_user_name);
}

function isBigOrCriticalShoot(shoot: UnifiedScheduleShootItem) {
  return shoot.priority_label === "big_shoot" || shoot.priority_label === "critical_shoot";
}

function hasShootAttention(shoot: UnifiedScheduleShootItem) {
  return (
    shoot.under_staffed ||
    shoot.missing_lead ||
    (shoot.conflict_warning_count ?? 0) > 0 ||
    (shoot.open_alert_count ?? 0) > 0 ||
    (shoot.open_attendance_exception_count ?? 0) > 0 ||
    shoot.missing_fields.length > 0
  );
}

function formatAttendanceStateLabel(value?: string | null) {
  if (!value) {
    return "Attendance pending";
  }
  if (value === "missed_clock_in") {
    return "Missing Clock-In";
  }
  if (value === "no_show_suspected") {
    return "Probable No-Show";
  }
  return humanizeLabel(value);
}

function isAttendanceExceptionState(value?: string | null) {
  return [
    "late",
    "critically_late",
    "missing_clock_in",
    "missed_clock_in",
    "wrong_location",
    "probable_no_show",
    "no_show_suspected",
    "missed_clock_out"
  ].includes(String(value ?? ""));
}

function getShiftLocationStateLabel(value?: string | null) {
  if (!value) {
    return null;
  }
  if (value === "valid_on_site") {
    return "Valid On-Site";
  }
  if (value === "near_site") {
    return "Near Site";
  }
  if (value === "wrong_location") {
    return "Wrong Location";
  }
  if (value === "outside_allowed_zone") {
    return "Outside Allowed Zone";
  }
  if (value === "manual_override") {
    return "Manual Override";
  }
  if (value === "clock_in_pending_location_review") {
    return "Location Review";
  }
  return humanizeLabel(value);
}

function isLocationExceptionState(value?: string | null) {
  return ["wrong_location", "outside_allowed_zone", "clock_in_pending_location_review"].includes(String(value ?? ""));
}

function openScheduleShift(shift: ShiftRecord, employeeOnlyMode: boolean, onOpenShift?: (shift: ShiftRecord) => void) {
  if (onOpenShift) {
    onOpenShift(shift);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.hash = employeeOnlyMode ? "#dashboard/my-day" : "#operations/staffing";
  }
}
