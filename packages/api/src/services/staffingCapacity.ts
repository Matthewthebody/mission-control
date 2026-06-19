import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { getOperatingSystemScope } from "./operatingSystemAccess.js";
import { getLocalDayBounds } from "../utils/localDate.js";
import { loadAvailabilityWindowsForUsersOnDate, type AvailabilityWindow } from "./availabilityRequests.js";
import { config } from "../config.js";
import {
  STAFFING_CAPACITY_TIMEZONE,
  parseCapacityInterval,
  durationMinutes,
  rawAssignedMinutes,
  uniqueScheduledMinutes,
  overlapMinutes,
  operatingDate,
  weekStartDate,
  addOperatingDays,
  clipInterval,
  classifyTimingQuality,
  type CapacityInterval,
  type TimingQuality
} from "../domain/staffing/staffing-capacity.js";

// Canonical read model for SCHEDULED staffing capacity (work_shift intervals), not payroll/actual hours.
// One service serves day / week / month. All date math is America/Chicago (Monday-anchored weeks, DST-correct).
// Totals are computed here, never in React. See docs/staffing-capacity-planning-contract.md.

const HEURISTIC_DAILY_MINUTES = 480; // 8h — a heuristic watch signal, NOT a canonical target
const HEURISTIC_WEEKLY_MINUTES = 2400; // 40h — heuristic only

// Hard server-side cap on the number of operating dates a single request can span. The window is always
// derived from (window, anchorDate) — callers cannot pass a free-form range — so this can only be reached
// by a malformed month, never by a legitimate request. It exists so the endpoint can never be used to pull
// all staffing history in one response. day=1, week=7, month<=42 (the complete Mon-anchored weeks of one
// calendar month). 45 leaves headroom for the largest 6-week month.
const MAX_OPERATING_DATES = 45;

const CAPACITY_WINDOWS = ["day", "week", "month"] as const;

export type CapacityWindow = (typeof CAPACITY_WINDOWS)[number];

export type CapacityAvailabilityState =
  | "availability_not_recorded"
  | "available"
  | "available_with_warning"
  | "unavailable";

export type CapacityCalendarSource = "calendar_not_connected" | "calendar_unavailable";

export type CapacityLifecycleState = "draft" | "published" | "pending" | "acknowledged" | "declined" | "canceled";

export type CapacityFilters = {
  department: string | null;
  staffingRole: string | null;
  employeeUserId: string | null;
  locationName: string | null;
  assignmentState: "draft" | "published" | "completed" | null;
  acknowledgmentState: "pending" | "acknowledged" | "declined" | "none" | null;
  warningState: "overlap" | "availability" | "any" | null;
};

export type CapacityRequest = {
  window: CapacityWindow;
  anchorDate: string; // YYYY-MM-DD interpreted as an America/Chicago operating date
  filters?: Partial<CapacityFilters>;
};

export type CapacityAssignmentView = {
  shift_id: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_name: string | null;
  department: string;
  location_name: string | null;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  operating_date: string | null;
  starts_at: string | null; // canonical, never clipped — for display + drilldown
  ends_at: string | null; // canonical, never clipped — for display + drilldown
  duration_minutes: number | null; // canonical (source) shift length, for display
  source_duration_minutes: number | null; // full canonical interval length (null if incomplete)
  clipped_duration_minutes: number; // portion intersecting the requested window — what counts toward totals
  timing_quality: TimingQuality; // valid | incomplete | suspicious
  timing_warning_reason: string | null; // human-readable reason when not valid
  shift_status: string;
  response_status: string | null;
  lifecycle_state: CapacityLifecycleState;
  coverage_eligible: boolean;
  has_overlap: boolean;
  availability_state: CapacityAvailabilityState;
  incomplete_timing: boolean;
  destination: {
    link_kind: "shoot_staffing" | "shift_only";
    shoot_id: string | null;
    shift_id: string;
    operating_date: string | null;
  };
};

export type CapacityDayBreakdown = {
  operating_date: string;
  scheduled_minutes: number;
  raw_assigned_minutes: number;
  overlap_minutes: number;
  assignment_count: number;
  shoot_count: number;
  overtime_day_flag: boolean;
};

export type CapacityWeekBreakdown = {
  week_start: string;
  week_end: string;
  scheduled_minutes: number;
  raw_assigned_minutes: number;
  overlap_minutes: number;
  assignment_count: number;
  shoot_count: number;
  overtime_week_flag: boolean;
};

export type CapacityNextAssignment = {
  shift_id: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  operating_date: string;
  starts_at: string;
};

export type CapacityEmployeeView = {
  employee_user_id: string;
  employee_name: string | null;
  department: string | null;
  staffing_roles: string[];
  raw_assigned_minutes: number;
  unique_scheduled_minutes: number;
  published_minutes: number;
  coverage_eligible_minutes: number;
  confirmed_minutes: number;
  pending_confirmation_minutes: number;
  declined_minutes: number;
  overlap_minutes: number;
  overlap_assignment_count: number;
  assignment_count: number;
  shoot_count: number;
  schedule_conflict_count: number;
  availability_warning_count: number;
  incomplete_timing_count: number;
  suspicious_timing_count: number;
  pending_assignment_count: number;
  declined_assignment_count: number;
  overtime_day_flag_count: number;
  overtime_week_flag: boolean;
  warning_severity: "none" | "warning" | "critical";
  next_assignment: CapacityNextAssignment | null;
  days: CapacityDayBreakdown[];
  weeks: CapacityWeekBreakdown[];
  assignments: CapacityAssignmentView[];
};

export type StaffingCapacityPlan = {
  window: CapacityWindow;
  anchor_date: string;
  range_start: string;
  range_end: string;
  month_start: string | null;
  month_end: string | null;
  week_buckets: Array<{ week_start: string; week_end: string }>;
  timezone: string;
  week_definition: "monday_sunday";
  capacity_target: null;
  overtime_heuristic: { daily_minutes: number; weekly_minutes: number; note: string };
  availability_source: "block_list_only";
  calendar_source: CapacityCalendarSource;
  includes_zero_assignment_employees: boolean;
  scope: "all" | "department";
  filters: CapacityFilters;
  summary: {
    employee_count: number;
    scheduled_minutes: number;
    raw_assigned_minutes: number;
    overlap_minutes: number;
    published_minutes: number;
    coverage_eligible_minutes: number;
    confirmed_minutes: number;
    pending_confirmation_minutes: number;
    declined_minutes: number;
    assignment_count: number;
    shoot_count: number;
    employees_with_overlap: number;
    employees_with_availability_warning: number;
    incomplete_timing_count: number;
    suspicious_timing_count: number;
  };
  employees: CapacityEmployeeView[];
};

type ShiftRow = {
  shift_id: string;
  assigned_user_id: string;
  employee_name: string | null;
  employee_department: string | null;
  shift_department: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_name: string | null;
  location_name: string | null;
  response_status: string | null;
};

type ShiftRecord = ShiftRow & { interval: CapacityInterval | null };

type DateBounds = { startMs: number; endMs: number };

function normalizeFilters(input?: Partial<CapacityFilters>): CapacityFilters {
  return {
    department: input?.department ?? null,
    staffingRole: input?.staffingRole ?? null,
    employeeUserId: input?.employeeUserId ?? null,
    locationName: input?.locationName ?? null,
    assignmentState: input?.assignmentState ?? null,
    acknowledgmentState: input?.acknowledgmentState ?? null,
    warningState: input?.warningState ?? null
  };
}

function assertSupportedWindow(window: string): asserts window is CapacityWindow {
  if (!CAPACITY_WINDOWS.includes(window as CapacityWindow)) {
    throw new ApiError(400, `Unsupported capacity view "${window}". Use one of: ${CAPACITY_WINDOWS.join(", ")}.`);
  }
}

/** Validate a real America/Chicago operating date (YYYY-MM-DD that round-trips — rejects 2027-13-99 etc.). */
function assertValidOperatingDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, `anchorDate must be a YYYY-MM-DD operating date, got "${value}".`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new ApiError(400, `anchorDate "${value}" is not a valid calendar date.`);
  }
}

/** Chicago day bounds (UTC instants) for a YYYY-MM-DD operating date. Noon UTC always lands on the same Chicago date. */
function chicagoDayBoundsMs(dateStr: string): DateBounds {
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const bounds = getLocalDayBounds(noonUtc, { timeZone: STAFFING_CAPACITY_TIMEZONE });
  return { startMs: bounds.start.getTime(), endMs: bounds.endExclusive.getTime() };
}

function enumerateOperatingDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 400) {
    guard += 1;
    dates.push(cursor);
    cursor = addOperatingDays(cursor, 1);
  }
  return dates;
}

type WindowRange = {
  rangeStart: string;
  rangeEnd: string;
  monthStart: string | null;
  monthEnd: string | null;
  weekBuckets: Array<{ week_start: string; week_end: string }>;
  operatingDates: string[];
};

function computeWindowRange(window: CapacityWindow, anchorDate: string): WindowRange {
  if (window === "day") {
    const weekStart = weekStartDate(anchorDate);
    return {
      rangeStart: anchorDate,
      rangeEnd: anchorDate,
      monthStart: null,
      monthEnd: null,
      weekBuckets: [{ week_start: weekStart, week_end: addOperatingDays(weekStart, 6) }],
      operatingDates: [anchorDate]
    };
  }
  if (window === "week") {
    const weekStart = weekStartDate(anchorDate);
    const weekEnd = addOperatingDays(weekStart, 6);
    return {
      rangeStart: weekStart,
      rangeEnd: weekEnd,
      monthStart: null,
      monthEnd: null,
      weekBuckets: [{ week_start: weekStart, week_end: weekEnd }],
      operatingDates: enumerateOperatingDates(weekStart, weekEnd)
    };
  }
  // month: rolled up by the complete Monday-anchored weeks the calendar month touches
  const [year, month] = anchorDate.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const firstWeekStart = weekStartDate(monthStart);
  const lastWeekStart = weekStartDate(monthEnd);
  const rangeStart = firstWeekStart;
  const rangeEnd = addOperatingDays(lastWeekStart, 6);
  const weekBuckets: Array<{ week_start: string; week_end: string }> = [];
  let cursor = firstWeekStart;
  let guard = 0;
  while (cursor <= lastWeekStart && guard < 60) {
    guard += 1;
    weekBuckets.push({ week_start: cursor, week_end: addOperatingDays(cursor, 6) });
    cursor = addOperatingDays(cursor, 7);
  }
  return {
    rangeStart,
    rangeEnd,
    monthStart,
    monthEnd,
    weekBuckets,
    operatingDates: enumerateOperatingDates(rangeStart, rangeEnd)
  };
}

/** Set of shift ids that overlap at least one other shift of the same employee. */
function computeOverlappingShiftIds(items: Array<{ shiftId: string; interval: CapacityInterval }>): Set<string> {
  const sorted = [...items].sort((a, b) => a.interval.startMs - b.interval.startMs);
  const result = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].interval.startMs >= sorted[i].interval.endMs) {
        break;
      }
      result.add(sorted[i].shiftId);
      result.add(sorted[j].shiftId);
    }
  }
  return result;
}

function classifyShift(status: string, responseStatus: string | null): {
  published: boolean;
  lifecycle: CapacityLifecycleState;
  coverageEligible: boolean;
} {
  const published = status === "published" || status === "completed";
  if (!published) {
    return { published: false, lifecycle: "draft", coverageEligible: false };
  }
  if (responseStatus === "declined") {
    return { published: true, lifecycle: "declined", coverageEligible: false };
  }
  if (responseStatus === "canceled") {
    return { published: true, lifecycle: "canceled", coverageEligible: false };
  }
  if (responseStatus === "acknowledged") {
    return { published: true, lifecycle: "acknowledged", coverageEligible: true };
  }
  if (responseStatus === "pending") {
    return { published: true, lifecycle: "pending", coverageEligible: true };
  }
  // Published shift with no current recipient row (studio/office shift, or pre-publication recipient sync).
  return { published: true, lifecycle: "published", coverageEligible: true };
}

function availabilityStateFor(
  windows: AvailabilityWindow[] | undefined,
  interval: CapacityInterval | null
): CapacityAvailabilityState {
  // Availability today is block-list only — there is no positive "available" record. The honest residual
  // is therefore "availability_not_recorded" (we hold no signal), never "available" (which would imply a
  // confirmed positive record). A future positive availability source could upgrade the residual.
  if (!interval || !windows || windows.length === 0) {
    return "availability_not_recorded";
  }
  let warning = false;
  for (const window of windows) {
    const windowStart = new Date(window.starts_at).getTime();
    const windowEnd = new Date(window.ends_at).getTime();
    if (Number.isNaN(windowStart) || Number.isNaN(windowEnd)) {
      continue;
    }
    const overlaps = windowStart < interval.endMs && windowEnd > interval.startMs;
    if (!overlaps) {
      continue;
    }
    if (window.warning_only) {
      warning = true;
    } else {
      return "unavailable";
    }
  }
  return warning ? "available_with_warning" : "availability_not_recorded";
}

function assemblePlan(
  window: CapacityWindow,
  anchorDate: string,
  range: WindowRange,
  planScope: "all" | "department",
  filters: CapacityFilters,
  includesZeroAssignmentEmployees: boolean,
  employees: CapacityEmployeeView[]
): StaffingCapacityPlan {
  const summary = employees.reduce(
    (acc, employee) => {
      acc.scheduled_minutes += employee.unique_scheduled_minutes;
      acc.raw_assigned_minutes += employee.raw_assigned_minutes;
      acc.overlap_minutes += employee.overlap_minutes;
      acc.published_minutes += employee.published_minutes;
      acc.coverage_eligible_minutes += employee.coverage_eligible_minutes;
      acc.confirmed_minutes += employee.confirmed_minutes;
      acc.pending_confirmation_minutes += employee.pending_confirmation_minutes;
      acc.declined_minutes += employee.declined_minutes;
      acc.assignment_count += employee.assignment_count;
      acc.shoot_count += employee.shoot_count;
      acc.incomplete_timing_count += employee.incomplete_timing_count;
      acc.suspicious_timing_count += employee.suspicious_timing_count;
      if (employee.schedule_conflict_count > 0) {
        acc.employees_with_overlap += 1;
      }
      if (employee.availability_warning_count > 0) {
        acc.employees_with_availability_warning += 1;
      }
      return acc;
    },
    {
      employee_count: employees.length,
      scheduled_minutes: 0,
      raw_assigned_minutes: 0,
      overlap_minutes: 0,
      published_minutes: 0,
      coverage_eligible_minutes: 0,
      confirmed_minutes: 0,
      pending_confirmation_minutes: 0,
      declined_minutes: 0,
      assignment_count: 0,
      shoot_count: 0,
      employees_with_overlap: 0,
      employees_with_availability_warning: 0,
      incomplete_timing_count: 0,
      suspicious_timing_count: 0
    }
  );

  return {
    window,
    anchor_date: anchorDate,
    range_start: range.rangeStart,
    range_end: range.rangeEnd,
    month_start: range.monthStart,
    month_end: range.monthEnd,
    week_buckets: range.weekBuckets,
    timezone: STAFFING_CAPACITY_TIMEZONE,
    week_definition: "monday_sunday",
    capacity_target: null,
    overtime_heuristic: {
      daily_minutes: HEURISTIC_DAILY_MINUTES,
      weekly_minutes: HEURISTIC_WEEKLY_MINUTES,
      note: "8h/day and 40h/week are heuristic watch thresholds, not a canonical per-employee target."
    },
    availability_source: "block_list_only",
    calendar_source: "calendar_not_connected",
    includes_zero_assignment_employees: includesZeroAssignmentEmployees,
    scope: planScope,
    filters,
    summary,
    employees
  };
}

/** A zero-hour roster row: a scoped employee with no current work_shift in the window. */
function buildZeroEmployeeView(
  id: string,
  name: string | null,
  department: string | null,
  range: WindowRange
): CapacityEmployeeView {
  return {
    employee_user_id: id,
    employee_name: name,
    department,
    staffing_roles: [],
    raw_assigned_minutes: 0,
    unique_scheduled_minutes: 0,
    published_minutes: 0,
    coverage_eligible_minutes: 0,
    confirmed_minutes: 0,
    pending_confirmation_minutes: 0,
    declined_minutes: 0,
    overlap_minutes: 0,
    overlap_assignment_count: 0,
    assignment_count: 0,
    shoot_count: 0,
    schedule_conflict_count: 0,
    availability_warning_count: 0,
    incomplete_timing_count: 0,
    suspicious_timing_count: 0,
    pending_assignment_count: 0,
    declined_assignment_count: 0,
    overtime_day_flag_count: 0,
    overtime_week_flag: false,
    warning_severity: "none",
    next_assignment: null,
    days: [],
    weeks: range.weekBuckets.map((bucket) => ({
      week_start: bucket.week_start,
      week_end: bucket.week_end,
      scheduled_minutes: 0,
      raw_assigned_minutes: 0,
      overlap_minutes: 0,
      assignment_count: 0,
      shoot_count: 0,
      overtime_week_flag: false
    })),
    assignments: []
  };
}

export async function getStaffingCapacityPlan(
  client: PoolClient,
  auth: AuthUser,
  request: CapacityRequest
): Promise<StaffingCapacityPlan> {
  assertSupportedWindow(request.window);
  assertValidOperatingDate(request.anchorDate);

  const scope = getOperatingSystemScope(auth, "schedule");
  if (scope === "none" || scope === "own") {
    throw new ApiError(403, "Staffing capacity planning requires manager-level schedule access.");
  }

  const filters = normalizeFilters(request.filters);
  const departmentScopeFilter = scope === "department" ? (auth.department ? String(auth.department) : null) : null;
  const planScope: "all" | "department" = departmentScopeFilter ? "department" : "all";

  let departmentFilter = filters.department;
  let outOfScope = false;
  if (departmentScopeFilter) {
    if (departmentFilter && departmentFilter !== departmentScopeFilter) {
      // A department-scoped manager requested a department they do not own (e.g. a crafted deep link).
      outOfScope = true;
    }
    departmentFilter = departmentScopeFilter;
  }

  const range = computeWindowRange(request.window, request.anchorDate);
  if (range.operatingDates.length > MAX_OPERATING_DATES) {
    throw new ApiError(400, "Requested capacity window is too large to return in one response.");
  }

  // Zero-assignment roster fill applies to week/month only (the dense day view stays assignment-only),
  // and only when no shift-attribute filter is active (role/status/ack would have no zero-hour match).
  const includeRoster =
    request.window !== "day" &&
    !filters.staffingRole &&
    !filters.assignmentState &&
    !filters.acknowledgmentState &&
    !filters.warningState;

  if (outOfScope) {
    return assemblePlan(request.window, request.anchorDate, range, planScope, filters, includeRoster, []);
  }

  const windowStartMs = chicagoDayBoundsMs(range.rangeStart).startMs;
  const windowEndMs = chicagoDayBoundsMs(range.rangeEnd).endMs;

  const params: unknown[] = [auth.tenantId, new Date(windowEndMs).toISOString(), new Date(windowStartMs).toISOString()];
  const conditions: string[] = [];
  const addCondition = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(clause.replace("$$", `$${params.length}`));
  };
  if (departmentFilter) {
    addCondition("AND ws.department = $$", departmentFilter);
  }
  if (filters.staffingRole) {
    addCondition("AND ws.staffing_role = $$", filters.staffingRole);
  }
  if (filters.employeeUserId) {
    addCondition("AND ws.assigned_user_id = $$::uuid", filters.employeeUserId);
  }
  if (filters.locationName) {
    addCondition("AND COALESCE(ws.location_name, s.location_name) = $$", filters.locationName);
  }
  if (filters.assignmentState) {
    addCondition("AND ws.status = $$", filters.assignmentState);
  }
  if (filters.acknowledgmentState === "none") {
    conditions.push("AND spr.response_status IS NULL");
  } else if (filters.acknowledgmentState) {
    addCondition("AND spr.response_status = $$", filters.acknowledgmentState);
  }

  const rows = (
    await client.query<ShiftRow>(
      `
        SELECT
          ws.id::text AS shift_id,
          ws.assigned_user_id::text AS assigned_user_id,
          u.full_name AS employee_name,
          u.department::text AS employee_department,
          ws.department::text AS shift_department,
          ws.staffing_role::text AS staffing_role,
          COALESCE(ws.satisfies_lead_coverage, false) AS satisfies_lead_coverage,
          ws.starts_at::text AS starts_at,
          ws.ends_at::text AS ends_at,
          ws.status::text AS status,
          ws.shoot_id::text AS shoot_id,
          s.shoot_code AS shoot_code,
          s.title AS shoot_title,
          org.display_name AS organization_name,
          COALESCE(ws.location_name, s.location_name) AS location_name,
          spr.response_status AS response_status
        FROM work_shift ws
        JOIN app_user u
          ON u.id = ws.assigned_user_id
         AND u.tenant_id = ws.tenant_id
        LEFT JOIN shoot s
          ON s.id = ws.shoot_id
         AND s.tenant_id = ws.tenant_id
        LEFT JOIN organization org
          ON org.id = s.organization_id
         AND org.tenant_id = s.tenant_id
        LEFT JOIN staffing_plan_recipient spr
          ON spr.tenant_id = ws.tenant_id
         AND spr.shoot_id = ws.shoot_id
         AND spr.employee_user_id = ws.assigned_user_id
         AND spr.superseded_at IS NULL
        WHERE ws.tenant_id = $1
          AND ws.assigned_user_id IS NOT NULL
          AND ws.cancelled_at IS NULL
          AND ws.status IN ('draft', 'published', 'completed')
          AND ws.starts_at < $2::timestamptz
          AND ws.ends_at > $3::timestamptz
          ${conditions.join("\n          ")}
        ORDER BY u.full_name NULLS LAST, ws.starts_at ASC, ws.id ASC
      `,
      params
    )
  ).rows;

  // Dedupe by shift id (defends against any duplicate current-recipient rows multiplying a shift).
  const recordByShiftId = new Map<string, ShiftRecord>();
  for (const row of rows) {
    if (recordByShiftId.has(row.shift_id)) {
      continue;
    }
    recordByShiftId.set(row.shift_id, { ...row, interval: parseCapacityInterval(row.starts_at, row.ends_at) });
  }

  const recordsByEmployee = new Map<string, ShiftRecord[]>();
  for (const record of recordByShiftId.values()) {
    const existing = recordsByEmployee.get(record.assigned_user_id) ?? [];
    existing.push(record);
    recordsByEmployee.set(record.assigned_user_id, existing);
  }

  // Availability is loaded per distinct operating date that actually has assignments (batched across ALL
  // employees on that date — O(distinct assignment dates), never per-employee). The fan-out is bounded by
  // the window: <=1 date for day, <=7 for week. The month rollup intentionally skips per-assignment
  // availability (it is surfaced on drill-down to a week/day), so month never incurs the per-day load.
  const availabilityByUserDate = new Map<string, AvailabilityWindow[]>();
  if (request.window !== "month") {
    const employeeContextById = new Map<string, { id: string; department: string }>();
    const employeeIdsByDate = new Map<string, Set<string>>();
    for (const record of recordByShiftId.values()) {
      if (!record.interval) {
        continue;
      }
      employeeContextById.set(record.assigned_user_id, {
        id: record.assigned_user_id,
        department: record.employee_department ?? record.shift_department
      });
      const startDate = operatingDate(record.interval.startMs);
      const endDate = operatingDate(record.interval.endMs - 1); // inclusive end side for cross-midnight shifts
      for (const date of endDate === startDate ? [startDate] : [startDate, endDate]) {
        const set = employeeIdsByDate.get(date) ?? new Set<string>();
        set.add(record.assigned_user_id);
        employeeIdsByDate.set(date, set);
      }
    }

    for (const [date, userIds] of employeeIdsByDate) {
      const userContexts = [...userIds]
        .map((id) => employeeContextById.get(id))
        .filter((value): value is { id: string; department: string } => Boolean(value));
      if (userContexts.length === 0) {
        continue;
      }
      const windowsByUser = await loadAvailabilityWindowsForUsersOnDate(client, {
        tenantId: auth.tenantId,
        userContexts,
        anchorDate: date,
        includePendingRequests: true
      });
      for (const [userId, windows] of windowsByUser) {
        availabilityByUserDate.set(`${userId}|${date}`, windows);
      }
    }
  }

  // Pre-compute Chicago day/week bounds for the window so per-day / per-week rollups reuse them.
  const dayBoundsByDate = new Map<string, DateBounds>();
  for (const date of range.operatingDates) {
    dayBoundsByDate.set(date, chicagoDayBoundsMs(date));
  }
  const weekBoundsList = range.weekBuckets.map((bucket) => ({
    bucket,
    startMs: chicagoDayBoundsMs(bucket.week_start).startMs,
    endMs: chicagoDayBoundsMs(bucket.week_end).endMs
  }));

  const windowBounds = { startMs: windowStartMs, endMs: windowEndMs };
  const suspiciousThresholdMinutes = config.CAPACITY_SUSPICIOUS_SHIFT_MINUTES;
  const employeeMap = new Map<string, CapacityEmployeeView>();
  for (const [employeeUserId, records] of recordsByEmployee) {
    employeeMap.set(
      employeeUserId,
      buildEmployeeView(
        employeeUserId,
        records,
        range,
        dayBoundsByDate,
        weekBoundsList,
        availabilityByUserDate,
        windowBounds,
        suspiciousThresholdMinutes
      )
    );
  }

  // Zero-assignment roster fill: every employee inside the authorized staffing scope appears in week/month
  // results, zero-filled, even with no current work_shift. One roster query (no per-employee fan-out). The
  // same department/employee scope and filters that bound the shift query also bound the roster.
  if (includeRoster) {
    const rosterParams: unknown[] = [auth.tenantId];
    const rosterConditions: string[] = [];
    const addRoster = (clause: string, value: unknown) => {
      rosterParams.push(value);
      rosterConditions.push(clause.replace("$$", `$${rosterParams.length}`));
    };
    if (departmentFilter) {
      addRoster("AND u.department = $$", departmentFilter);
    }
    if (filters.employeeUserId) {
      addRoster("AND u.id = $$::uuid", filters.employeeUserId);
    }
    const rosterRows = (
      await client.query<{ id: string; full_name: string | null; department: string | null }>(
        `
          SELECT u.id::text AS id, u.full_name, u.department::text AS department
          FROM app_user u
          WHERE u.tenant_id = $1
            AND u.is_active = true
            ${rosterConditions.join("\n            ")}
          ORDER BY u.full_name NULLS LAST, u.id ASC
        `,
        rosterParams
      )
    ).rows;
    for (const roster of rosterRows) {
      if (!employeeMap.has(roster.id)) {
        employeeMap.set(roster.id, buildZeroEmployeeView(roster.id, roster.full_name, roster.department, range));
      }
    }
  }

  const employees = [...employeeMap.values()];

  // Warning-state filter is applied after computation (it depends on overlap + availability signals).
  let visibleEmployees = employees;
  if (filters.warningState === "overlap") {
    visibleEmployees = employees.filter((employee) => employee.schedule_conflict_count > 0);
  } else if (filters.warningState === "availability") {
    visibleEmployees = employees.filter((employee) => employee.availability_warning_count > 0);
  } else if (filters.warningState === "any") {
    visibleEmployees = employees.filter((employee) => employee.warning_severity !== "none");
  }

  visibleEmployees.sort((a, b) => {
    if (b.unique_scheduled_minutes !== a.unique_scheduled_minutes) {
      return b.unique_scheduled_minutes - a.unique_scheduled_minutes;
    }
    return (a.employee_name ?? "").localeCompare(b.employee_name ?? "");
  });

  return assemblePlan(request.window, request.anchorDate, range, planScope, filters, includeRoster, visibleEmployees);
}

function buildEmployeeView(
  employeeUserId: string,
  records: ShiftRecord[],
  range: WindowRange,
  dayBoundsByDate: Map<string, DateBounds>,
  weekBoundsList: Array<{ bucket: { week_start: string; week_end: string }; startMs: number; endMs: number }>,
  availabilityByUserDate: Map<string, AvailabilityWindow[]>,
  windowBounds: DateBounds,
  suspiciousThresholdMinutes: number
): CapacityEmployeeView {
  const first = records[0];
  // Every total is computed from intervals CLIPPED to the requested window, so an out-of-window or corrupt
  // (multi-year) shift can only ever contribute the portion that intersects the window. Canonical starts_at/
  // ends_at are preserved unchanged on the assignment detail.
  const windowClippedById = new Map<string, CapacityInterval | null>();
  for (const record of records) {
    windowClippedById.set(record.shift_id, record.interval ? clipInterval(record.interval, windowBounds.startMs, windowBounds.endMs) : null);
  }
  const validIntervals: CapacityInterval[] = [];
  const validWithId: Array<{ shiftId: string; interval: CapacityInterval }> = [];
  const roleSet = new Set<string>();
  const shootSet = new Set<string>();

  let rawAssigned = 0;
  let publishedMinutes = 0;
  let coverageEligibleMinutes = 0;
  let confirmedMinutes = 0;
  let pendingMinutes = 0;
  let declinedMinutes = 0;
  let incompleteTimingCount = 0;
  let suspiciousTimingCount = 0;
  let unavailableCount = 0;
  let availabilityWarningSoftCount = 0;
  let pendingAssignmentCount = 0;
  let declinedAssignmentCount = 0;

  for (const record of records) {
    if (record.staffing_role) {
      roleSet.add(record.staffing_role);
    }
    if (record.shoot_id) {
      shootSet.add(record.shoot_id);
    }
    if (!record.interval) {
      incompleteTimingCount += 1;
      continue;
    }
    if (classifyTimingQuality(record.interval, suspiciousThresholdMinutes) === "suspicious") {
      suspiciousTimingCount += 1;
    }
    // Minutes are counted from the WINDOW-CLIPPED interval only. A shift entirely outside the window clips to
    // null and contributes zero; one that straddles the boundary contributes only the overlapping portion.
    const clipped = windowClippedById.get(record.shift_id) ?? null;
    if (!clipped) {
      continue;
    }
    validIntervals.push(clipped);
    validWithId.push({ shiftId: record.shift_id, interval: clipped });

    const minutes = durationMinutes(clipped);
    const { published, lifecycle, coverageEligible } = classifyShift(record.status, record.response_status);
    rawAssigned += minutes;
    if (published) {
      publishedMinutes += minutes;
    }
    if (coverageEligible) {
      coverageEligibleMinutes += minutes;
    }
    if (lifecycle === "acknowledged") {
      confirmedMinutes += minutes;
    } else if (lifecycle === "pending") {
      pendingMinutes += minutes;
    } else if (lifecycle === "declined") {
      declinedMinutes += minutes;
    }
  }

  const overlappingShiftIds = computeOverlappingShiftIds(validWithId);
  const uniqueScheduled = uniqueScheduledMinutes(validIntervals);
  const overlap = overlapMinutes(validIntervals);

  // Per-assignment detail (includes incomplete-timing assignments, surfaced but unvalued).
  const assignments: CapacityAssignmentView[] = records.map((record) => {
    const incomplete = !record.interval;
    const { lifecycle, coverageEligible } = classifyShift(record.status, record.response_status);
    if (lifecycle === "pending") {
      pendingAssignmentCount += 1;
    } else if (lifecycle === "declined") {
      declinedAssignmentCount += 1;
    }
    const opDate = record.interval ? operatingDate(record.interval.startMs) : null;
    const availabilityWindows = record.interval ? availabilityByUserDate.get(`${employeeUserId}|${opDate}`) : undefined;
    const availabilityState = availabilityStateFor(availabilityWindows, record.interval);
    if (record.interval) {
      if (availabilityState === "unavailable") {
        unavailableCount += 1;
      } else if (availabilityState === "available_with_warning") {
        availabilityWarningSoftCount += 1;
      }
    }
    const sourceDuration = record.interval ? durationMinutes(record.interval) : null;
    const clippedInterval = windowClippedById.get(record.shift_id) ?? null;
    const clippedDuration = clippedInterval ? durationMinutes(clippedInterval) : 0;
    const timingQuality = classifyTimingQuality(record.interval, suspiciousThresholdMinutes);
    const timingWarningReason =
      timingQuality === "incomplete"
        ? "Missing or invalid start/end time — excluded from totals, no duration invented."
        : timingQuality === "suspicious"
          ? `Source interval is ${Math.round((sourceDuration ?? 0) / 60)}h, beyond the ${Math.round(suspiciousThresholdMinutes / 60)}h plausibility limit; likely corrupt — only the in-window portion is counted.`
          : null;
    return {
      shift_id: record.shift_id,
      shoot_id: record.shoot_id,
      shoot_code: record.shoot_code,
      shoot_title: record.shoot_title,
      organization_name: record.organization_name,
      department: record.shift_department,
      location_name: record.location_name,
      staffing_role: record.staffing_role,
      satisfies_lead_coverage: record.satisfies_lead_coverage,
      operating_date: opDate,
      starts_at: record.starts_at,
      ends_at: record.ends_at,
      duration_minutes: sourceDuration,
      source_duration_minutes: sourceDuration,
      clipped_duration_minutes: clippedDuration,
      timing_quality: timingQuality,
      timing_warning_reason: timingWarningReason,
      shift_status: record.status,
      response_status: record.response_status,
      lifecycle_state: lifecycle,
      coverage_eligible: coverageEligible,
      has_overlap: overlappingShiftIds.has(record.shift_id),
      availability_state: availabilityState,
      incomplete_timing: incomplete,
      destination: {
        link_kind: record.shoot_id ? "shoot_staffing" : "shift_only",
        shoot_id: record.shoot_id,
        shift_id: record.shift_id,
        operating_date: opDate
      }
    };
  });

  // Per-day rollups (clip each interval to the Chicago day; shifts touching the day count once per day).
  const days: CapacityDayBreakdown[] = [];
  let overtimeDayFlagCount = 0;
  for (const date of range.operatingDates) {
    const bounds = dayBoundsByDate.get(date);
    if (!bounds) {
      continue;
    }
    const clipped: CapacityInterval[] = [];
    const dayShoots = new Set<string>();
    let count = 0;
    for (const record of records) {
      if (!record.interval) {
        continue;
      }
      const clip = clipInterval(record.interval, bounds.startMs, bounds.endMs);
      if (!clip) {
        continue;
      }
      clipped.push(clip);
      count += 1;
      if (record.shoot_id) {
        dayShoots.add(record.shoot_id);
      }
    }
    if (count === 0) {
      continue;
    }
    const scheduled = uniqueScheduledMinutes(clipped);
    const overtimeDayFlag = scheduled > HEURISTIC_DAILY_MINUTES;
    if (overtimeDayFlag) {
      overtimeDayFlagCount += 1;
    }
    days.push({
      operating_date: date,
      scheduled_minutes: scheduled,
      raw_assigned_minutes: rawAssignedMinutes(clipped),
      overlap_minutes: overlapMinutes(clipped),
      assignment_count: count,
      shoot_count: dayShoots.size,
      overtime_day_flag: overtimeDayFlag
    });
  }

  // Per-week rollups (same intervals clipped to the Monday-anchored week bounds).
  const weeks: CapacityWeekBreakdown[] = [];
  let overtimeWeekFlag = false;
  for (const week of weekBoundsList) {
    const clipped: CapacityInterval[] = [];
    const weekShoots = new Set<string>();
    let count = 0;
    for (const record of records) {
      if (!record.interval) {
        continue;
      }
      const clip = clipInterval(record.interval, week.startMs, week.endMs);
      if (!clip) {
        continue;
      }
      clipped.push(clip);
      count += 1;
      if (record.shoot_id) {
        weekShoots.add(record.shoot_id);
      }
    }
    const scheduled = uniqueScheduledMinutes(clipped);
    const weekFlag = scheduled > HEURISTIC_WEEKLY_MINUTES;
    if (weekFlag) {
      overtimeWeekFlag = true;
    }
    weeks.push({
      week_start: week.bucket.week_start,
      week_end: week.bucket.week_end,
      scheduled_minutes: scheduled,
      raw_assigned_minutes: rawAssignedMinutes(clipped),
      overlap_minutes: overlapMinutes(clipped),
      assignment_count: count,
      shoot_count: weekShoots.size,
      overtime_week_flag: weekFlag
    });
  }

  // Earliest-starting assignment in the window — the soonest thing this employee is scheduled for.
  let nextAssignment: CapacityNextAssignment | null = null;
  let earliestStart = Number.POSITIVE_INFINITY;
  for (const record of records) {
    if (!record.interval || !record.starts_at) {
      continue;
    }
    if (record.interval.startMs < earliestStart) {
      earliestStart = record.interval.startMs;
      nextAssignment = {
        shift_id: record.shift_id,
        shoot_id: record.shoot_id,
        shoot_code: record.shoot_code,
        shoot_title: record.shoot_title,
        operating_date: operatingDate(record.interval.startMs),
        starts_at: record.starts_at
      };
    }
  }

  const scheduleConflictCount = overlappingShiftIds.size;
  const availabilityWarningCount = unavailableCount + availabilityWarningSoftCount;
  let warningSeverity: "none" | "warning" | "critical" = "none";
  if (scheduleConflictCount > 0 || unavailableCount > 0) {
    warningSeverity = "critical";
  } else if (availabilityWarningSoftCount > 0 || overtimeDayFlagCount > 0 || overtimeWeekFlag) {
    warningSeverity = "warning";
  }

  return {
    employee_user_id: employeeUserId,
    employee_name: first.employee_name,
    department: first.employee_department ?? first.shift_department ?? null,
    staffing_roles: [...roleSet].sort(),
    raw_assigned_minutes: rawAssigned,
    unique_scheduled_minutes: uniqueScheduled,
    published_minutes: publishedMinutes,
    coverage_eligible_minutes: coverageEligibleMinutes,
    confirmed_minutes: confirmedMinutes,
    pending_confirmation_minutes: pendingMinutes,
    declined_minutes: declinedMinutes,
    overlap_minutes: overlap,
    overlap_assignment_count: overlappingShiftIds.size,
    assignment_count: records.length,
    shoot_count: shootSet.size,
    schedule_conflict_count: scheduleConflictCount,
    availability_warning_count: availabilityWarningCount,
    incomplete_timing_count: incompleteTimingCount,
    suspicious_timing_count: suspiciousTimingCount,
    pending_assignment_count: pendingAssignmentCount,
    declined_assignment_count: declinedAssignmentCount,
    overtime_day_flag_count: overtimeDayFlagCount,
    overtime_week_flag: overtimeWeekFlag,
    warning_severity: warningSeverity,
    next_assignment: nextAssignment,
    days,
    weeks,
    assignments
  };
}
