import { apiFetch } from "../api";

// Client mirror of the API's canonical staffing-capacity read model (packages/api/src/services/staffingCapacity.ts).
// The API response is authoritative: the UI renders these values and NEVER recomputes hours, overlap, lifecycle
// categories, or availability. See docs/staffing-capacity-planning-contract.md.

export type CapacityView = "day" | "week" | "month";

export type CapacityAvailabilityState =
  | "availability_not_recorded"
  | "available"
  | "available_with_warning"
  | "unavailable";

export type CapacityLifecycleState = "draft" | "published" | "pending" | "acknowledged" | "declined" | "canceled";

export type CapacityCalendarSource = "calendar_not_connected" | "calendar_unavailable";

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
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number | null;
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
  window: CapacityView;
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
  filters: Record<string, string | null>;
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
  };
  employees: CapacityEmployeeView[];
};

// ---- URL (hash query) state ---------------------------------------------------------------------------------
// The capacity view is fully URL-backed: view, anchor date, and every filter live in the hash query string so
// refresh, browser back/forward, and shared links restore the exact surface.

export type CapacityFilterKey = "department" | "role" | "employee" | "location" | "assignment" | "ack" | "warning";

export const CAPACITY_FILTER_KEYS: CapacityFilterKey[] = [
  "department",
  "role",
  "employee",
  "location",
  "assignment",
  "ack",
  "warning"
];

export type CapacityHashState = {
  view: CapacityView;
  date: string; // anchor YYYY-MM-DD (America/Chicago operating date)
} & Record<CapacityFilterKey, string>; // "" means "all" / unset

const VIEWS: CapacityView[] = ["day", "week", "month"];

function isValidDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export const CAPACITY_HASH_PATH = "operations/staffing/capacity";

/** Read the capacity view + filters from a hash query string (everything after "?"). */
export function readCapacityState(params: URLSearchParams, fallbackDate: string): CapacityHashState {
  const view = params.get("view");
  const date = params.get("date");
  const state: CapacityHashState = {
    view: VIEWS.includes(view as CapacityView) ? (view as CapacityView) : "week", // default Week
    date: isValidDate(date) ? date : fallbackDate,
    department: params.get("department") ?? "",
    role: params.get("role") ?? "",
    employee: params.get("employee") ?? "",
    location: params.get("location") ?? "",
    assignment: params.get("assignment") ?? "",
    ack: params.get("ack") ?? "",
    warning: params.get("warning") ?? ""
  };
  return state;
}

/** Read directly from window.location.hash. */
export function readCapacityStateFromHash(fallbackDate: string): CapacityHashState {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex === -1 ? "" : hash.slice(queryIndex + 1));
  return readCapacityState(params, fallbackDate);
}

/** Build the canonical hash for a capacity state (omitting empty filters and a Week default). */
export function buildCapacityHash(state: CapacityHashState): string {
  const params = new URLSearchParams();
  params.set("view", state.view);
  params.set("date", state.date);
  for (const key of CAPACITY_FILTER_KEYS) {
    const value = state[key];
    if (value) {
      params.set(key, value);
    }
  }
  return `#${CAPACITY_HASH_PATH}?${params.toString()}`;
}

// ---- fetch --------------------------------------------------------------------------------------------------

export async function getStaffingCapacityPlan(token: string, state: CapacityHashState): Promise<StaffingCapacityPlan> {
  const params = new URLSearchParams();
  params.set("window", state.view);
  params.set("anchor_date", state.date);
  if (state.department) params.set("department", state.department);
  if (state.role) params.set("role", state.role);
  if (state.employee) params.set("employee_id", state.employee);
  if (state.location) params.set("location", state.location);
  if (state.assignment) params.set("status", state.assignment);
  if (state.ack) params.set("ack", state.ack);
  if (state.warning) params.set("warning", state.warning);
  return apiFetch<StaffingCapacityPlan>(`/api/schedule/capacity?${params.toString()}`, token);
}
