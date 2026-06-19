// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CapacityAssignmentView,
  CapacityEmployeeView,
  CapacityHashState,
  CapacityView,
  StaffingCapacityPlan
} from "../services/staffingCapacity";
import type { SessionUser } from "../types";

const getPlanMock = vi.fn();

vi.mock("../services/staffingCapacity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/staffingCapacity")>();
  return { ...actual, getStaffingCapacityPlan: (...args: unknown[]) => getPlanMock(...args) };
});

vi.mock("../components/ShootStaffingCommand", () => ({
  ShootStaffingCommand: (props: { shootId: string | null }) => (
    <div data-testid="staffing-drawer">Staffing drawer for {props.shootId}</div>
  )
}));

import { StaffingCapacityPlanning } from "../pages/StaffingCapacityPlanning";
import { buildCapacityHash, readCapacityState } from "../services/staffingCapacity";

afterEach(() => {
  cleanup();
  getPlanMock.mockReset();
  window.location.hash = "";
});

beforeEach(() => {
  window.location.hash = "";
});

// ---- fixtures ----------------------------------------------------------------------------------------------

function emp(over: Partial<CapacityEmployeeView> & { employee_user_id: string }): CapacityEmployeeView {
  return {
    employee_name: over.employee_user_id,
    department: "schools",
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
    weeks: [],
    assignments: [],
    ...over
  };
}

function assignment(over: Partial<CapacityAssignmentView> & { shift_id: string }): CapacityAssignmentView {
  return {
    shoot_id: "shoot-1",
    shoot_code: "CAP-1",
    shoot_title: "Picture Day",
    organization_name: "White Bear Lake HS",
    department: "schools",
    location_name: "Gymnasium",
    staffing_role: "photographer",
    satisfies_lead_coverage: false,
    operating_date: "2027-06-07",
    starts_at: "2027-06-07T14:00:00.000Z",
    ends_at: "2027-06-07T17:00:00.000Z",
    duration_minutes: 180,
    source_duration_minutes: 180,
    clipped_duration_minutes: 180,
    timing_quality: "valid",
    timing_warning_reason: null,
    shift_status: "published",
    response_status: "pending",
    lifecycle_state: "pending",
    coverage_eligible: true,
    has_overlap: false,
    availability_state: "availability_not_recorded",
    incomplete_timing: false,
    destination: { link_kind: "shoot_staffing", shoot_id: "shoot-1", shift_id: over.shift_id, operating_date: "2027-06-07" },
    ...over
  };
}

function plan(view: CapacityView, employees: CapacityEmployeeView[], over: Partial<StaffingCapacityPlan> = {}): StaffingCapacityPlan {
  return {
    window: view,
    anchor_date: "2027-06-07",
    range_start: "2027-06-07",
    range_end: view === "day" ? "2027-06-07" : "2027-06-13",
    month_start: view === "month" ? "2027-06-01" : null,
    month_end: view === "month" ? "2027-06-30" : null,
    week_buckets: [{ week_start: "2027-06-07", week_end: "2027-06-13" }],
    timezone: "America/Chicago",
    week_definition: "monday_sunday",
    capacity_target: null,
    overtime_heuristic: { daily_minutes: 480, weekly_minutes: 2400, note: "heuristic" },
    availability_source: "block_list_only",
    calendar_source: "calendar_not_connected",
    includes_zero_assignment_employees: view !== "day",
    scope: "all",
    filters: {},
    summary: {
      employee_count: employees.length,
      scheduled_minutes: employees.reduce((s, e) => s + e.unique_scheduled_minutes, 0),
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
    },
    employees,
    ...over
  };
}

function managerUser(): SessionUser {
  return {
    id: "leader-1",
    tenantId: "tenant-demo",
    accountId: "account-1",
    sessionId: "session-1",
    email: "lead@example.com",
    fullName: "Demo Leadership",
    status: "active",
    department: "operations",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["leadership"],
    permissions: ["dashboard.read", "schedule.read", "schedule.manage", "staffing.manage"],
    authorityTier: "leadership",
    primaryJobFunctionProfile: "leadership_team_member",
    jobFunctionProfiles: ["leadership_team_member"],
    permissionGrants: [],
    effectiveScopes: ["organization_wide_scope"],
    sessionTrust: {
      identityProvider: "local_password",
      sessionAssurance: "standard",
      requestTransport: "bearer",
      elevatedUntil: null,
      privilegedModeUntil: null,
      breakGlassStartedAt: null,
      breakGlassUntil: null,
      breakGlassReason: null,
      breakGlassScopeType: null,
      breakGlassScopeId: null,
      elevatedSessionActive: false,
      privilegedModeActive: false,
      breakGlassModeActive: false
    }
  } as unknown as SessionUser;
}

function employeeUser(): SessionUser {
  return {
    ...managerUser(),
    id: "emp-1",
    roles: ["employee"],
    permissions: [],
    authorityTier: "associate",
    primaryJobFunctionProfile: "field_photographer",
    jobFunctionProfiles: ["field_photographer"]
  } as unknown as SessionUser;
}

function renderBoard(user: SessionUser = managerUser()) {
  return render(<StaffingCapacityPlanning token="token" currentUser={user} socket={null} />);
}

/** Default mock: return a plan for whichever view the component requests. */
function respondByView(builders: Partial<Record<CapacityView, () => StaffingCapacityPlan>>) {
  getPlanMock.mockImplementation((_token: string, state: CapacityHashState) =>
    Promise.resolve((builders[state.view] ?? builders.week ?? (() => plan("week", [])))())
  );
}

// ---- tests -------------------------------------------------------------------------------------------------

describe("Staffing Capacity Planning view", () => {
  it("1. defaults to the Week view", async () => {
    respondByView({ week: () => plan("week", [emp({ employee_user_id: "Ada", unique_scheduled_minutes: 480 })]) });
    renderBoard();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Ada")).toBeInTheDocument();
    const weekButton = screen.getByRole("button", { name: "Week" });
    expect(weekButton).toHaveAttribute("aria-pressed", "true");
    expect(getPlanMock.mock.calls[0][1].view).toBe("week");
  });

  it("2. a zero-hour employee appears in the week grid", async () => {
    respondByView({
      week: () => plan("week", [emp({ employee_user_id: "Zoe", unique_scheduled_minutes: 0, assignment_count: 0 })])
    });
    renderBoard();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Zoe").closest("tr")!;
    expect(within(row).getByText("0h")).toBeInTheDocument();
  });

  it("3. the unique scheduled total is primary while raw and overlap remain available", async () => {
    respondByView({
      week: () =>
        plan("week", [
          emp({
            employee_user_id: "Ola",
            unique_scheduled_minutes: 300,
            raw_assigned_minutes: 360,
            overlap_minutes: 60,
            schedule_conflict_count: 2
          })
        ])
    });
    renderBoard();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Ola").closest("tr")!;
    expect(within(row).getByText("5h")).toBeInTheDocument(); // unique, prominent
    expect(within(row).getByText(/6h assigned/)).toBeInTheDocument();
    expect(within(row).getByText(/1h overlapping/)).toBeInTheDocument();
  });

  it("4. daily cells reconcile with the API day breakdown", async () => {
    respondByView({
      week: () =>
        plan("week", [
          emp({
            employee_user_id: "Ivy",
            unique_scheduled_minutes: 480,
            days: [
              { operating_date: "2027-06-07", scheduled_minutes: 240, raw_assigned_minutes: 240, overlap_minutes: 0, assignment_count: 1, shoot_count: 1, overtime_day_flag: false },
              { operating_date: "2027-06-09", scheduled_minutes: 240, raw_assigned_minutes: 240, overlap_minutes: 0, assignment_count: 1, shoot_count: 1, overtime_day_flag: false }
            ]
          })
        ])
    });
    renderBoard();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Ivy").closest("tr")!;
    // Two day cells of 4h each and an 8h weekly total — all straight from the API, no recomputation.
    expect(within(row).getAllByText("4h").length).toBe(2);
    expect(within(row).getByText("8h")).toBeInTheDocument();
  });

  it("5. pending and confirmed assignments are distinguishable in the day view", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({
            employee_user_id: "Ada",
            assignments: [
              assignment({ shift_id: "s1", lifecycle_state: "acknowledged", response_status: "acknowledged" }),
              assignment({ shift_id: "s2", lifecycle_state: "pending", response_status: "pending", starts_at: "2027-06-07T18:00:00.000Z" })
            ]
          })
        ])
    });
    window.location.hash = buildCapacityHash({ ...readCapacityState(new URLSearchParams(), "2027-06-07"), view: "day" });
    renderBoard();
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Pending acknowledgment")).toBeInTheDocument();
  });

  it("6. a declined assignment stays visible and is flagged replacement-required", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({
            employee_user_id: "Ada",
            assignments: [assignment({ shift_id: "s1", lifecycle_state: "declined", response_status: "declined", coverage_eligible: false })]
          })
        ])
    });
    window.location.hash = "#operations/staffing/capacity?view=day&date=2027-06-07";
    renderBoard();
    expect(await screen.findByText(/Declined . replacement required/)).toBeInTheDocument();
  });

  it("7. missing timing is shown without inventing a duration", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({
            employee_user_id: "Ada",
            incomplete_timing_count: 1,
            assignments: [
              assignment({ shift_id: "s1", incomplete_timing: true, duration_minutes: null, starts_at: null, ends_at: null, operating_date: null })
            ]
          })
        ])
    });
    window.location.hash = "#operations/staffing/capacity?view=day&date=2027-06-07";
    renderBoard();
    // The assignment is surfaced with an explicit "Incomplete timing" badge and no fabricated hour figure.
    const badge = await screen.findByText("Incomplete timing");
    const row = badge.closest("li")!;
    expect(within(row).queryByText(/\dh/)).toBeNull(); // no invented duration like "3h"
  });

  it("8. missing availability is never shown as available", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({ employee_user_id: "Ada", assignments: [assignment({ shift_id: "s1", availability_state: "availability_not_recorded" })] })
        ])
    });
    window.location.hash = "#operations/staffing/capacity?view=day&date=2027-06-07";
    renderBoard();
    expect(await screen.findByText("Availability not recorded")).toBeInTheDocument();
    // The bare positive "Available" badge must not appear for a not-recorded state.
    expect(screen.queryByText("Available", { exact: true })).not.toBeInTheDocument();
  });

  it("9. the calendar stub is surfaced as not connected", async () => {
    respondByView({ week: () => plan("week", [emp({ employee_user_id: "Ada" })]) });
    renderBoard();
    expect(await screen.findByText("Calendar not connected")).toBeInTheDocument();
  });

  it("10. filters update the request and the URL", async () => {
    respondByView({ week: () => plan("week", [emp({ employee_user_id: "Ada" })]) });
    renderBoard();
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "schools" } });
    fireEvent.change(screen.getByLabelText("Warning"), { target: { value: "overlap" } });
    expect(window.location.hash).toContain("department=schools");
    expect(window.location.hash).toContain("warning=overlap");
    const lastState = getPlanMock.mock.calls[getPlanMock.mock.calls.length - 1][1] as CapacityHashState;
    expect(lastState.department).toBe("schools");
    expect(lastState.warning).toBe("overlap");
  });

  it("11. a refreshed/shared URL restores view + filters, and round-trips through history", async () => {
    respondByView({ month: () => plan("month", [emp({ employee_user_id: "Ada" })]) });
    window.location.hash = "#operations/staffing/capacity?view=month&date=2027-06-07&department=sports";
    renderBoard();
    await screen.findByRole("table");
    const state = getPlanMock.mock.calls[0][1] as CapacityHashState;
    expect(state.view).toBe("month");
    expect(state.department).toBe("sports");

    // Pure URL contract (history round-trip).
    const built = buildCapacityHash({ view: "week", date: "2027-06-07", department: "schools", role: "", employee: "", location: "", assignment: "", ack: "acknowledged", warning: "" });
    const params = new URLSearchParams(built.slice(built.indexOf("?") + 1));
    const read = readCapacityState(params, "2027-01-01");
    expect(read.view).toBe("week");
    expect(read.department).toBe("schools");
    expect(read.ack).toBe("acknowledged");
  });

  it("12. clicking an assignment opens the exact staffing drawer", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({ employee_user_id: "Ada", assignments: [assignment({ shift_id: "s1", shoot_id: "shoot-77", destination: { link_kind: "shoot_staffing", shoot_id: "shoot-77", shift_id: "s1", operating_date: "2027-06-07" } })] })
        ])
    });
    window.location.hash = "#operations/staffing/capacity?view=day&date=2027-06-07";
    renderBoard();
    const row = await screen.findByRole("button", { name: /Open staffing for/ });
    fireEvent.click(row);
    expect(await screen.findByTestId("staffing-drawer")).toHaveTextContent("Staffing drawer for shoot-77");
  });

  it("13. switching between day, week, and month re-requests the matching window", async () => {
    respondByView({
      week: () => plan("week", [emp({ employee_user_id: "Wk" })]),
      day: () => plan("day", [emp({ employee_user_id: "Dy", assignments: [assignment({ shift_id: "s1" })] })]),
      month: () => plan("month", [emp({ employee_user_id: "Mo" })])
    });
    renderBoard();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(await screen.findByRole("rowheader", { name: /Mo/ })).toBeInTheDocument();
    expect((getPlanMock.mock.calls[getPlanMock.mock.calls.length - 1][1] as CapacityHashState).view).toBe("month");
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    const list = await screen.findByRole("list", { name: "Assignments" });
    expect(within(list).getByText("Dy")).toBeInTheDocument();
    expect((getPlanMock.mock.calls[getPlanMock.mock.calls.length - 1][1] as CapacityHashState).view).toBe("day");
  });

  it("14. clicking a month week cell drills into that week", async () => {
    respondByView({
      month: () => plan("month", [emp({ employee_user_id: "Ada", weeks: [{ week_start: "2027-06-07", week_end: "2027-06-13", scheduled_minutes: 480, raw_assigned_minutes: 480, overlap_minutes: 0, assignment_count: 2, shoot_count: 2, overtime_week_flag: false }] })]),
      week: () => plan("week", [emp({ employee_user_id: "AdaWeek" })])
    });
    window.location.hash = "#operations/staffing/capacity?view=month&date=2027-06-07";
    renderBoard();
    const cell = await screen.findByRole("button", { name: /Open week of 2027-06-07/ });
    fireEvent.click(cell);
    expect(await screen.findByRole("rowheader", { name: /AdaWeek/ })).toBeInTheDocument();
    const lastState = getPlanMock.mock.calls[getPlanMock.mock.calls.length - 1][1] as CapacityHashState;
    expect(lastState.view).toBe("week");
    expect(lastState.date).toBe("2027-06-07");
  });

  it("15. a non-manager sees a permission-denied state and no request is made", async () => {
    respondByView({ week: () => plan("week", [emp({ employee_user_id: "Ada" })]) });
    renderBoard(employeeUser());
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(getPlanMock).not.toHaveBeenCalled();
  });

  it("16. loading, empty, and error states each render", async () => {
    // loading
    getPlanMock.mockImplementation(() => new Promise(() => {}));
    const loadingView = renderBoard();
    expect(await screen.findByText(/Loading staffing capacity/)).toBeInTheDocument();
    loadingView.unmount();

    // empty
    getPlanMock.mockReset();
    respondByView({ week: () => plan("week", []) });
    const emptyView = renderBoard();
    expect(await screen.findByText(/No staffing capacity matches/)).toBeInTheDocument();
    emptyView.unmount();

    // error
    getPlanMock.mockReset();
    getPlanMock.mockRejectedValue(new Error("Capacity API unavailable"));
    renderBoard();
    expect(await screen.findByText("Capacity API unavailable")).toBeInTheDocument();
  });

  it("17. renders densely at realistic staff volume", async () => {
    const employees = Array.from({ length: 40 }, (_, index) =>
      emp({ employee_user_id: `Emp ${index}`, unique_scheduled_minutes: index * 30 })
    );
    respondByView({ week: () => plan("week", employees) });
    renderBoard();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Emp 39")).toBeInTheDocument();
    expect(within(table).getByText("Emp 0")).toBeInTheDocument();
  });

  it("18. status is conveyed with text/labels, not color alone, and controls are keyboard-operable buttons", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({
            employee_user_id: "Ada",
            assignments: [assignment({ shift_id: "s1", has_overlap: true, availability_state: "unavailable" })]
          })
        ])
    });
    window.location.hash = "#operations/staffing/capacity?view=day&date=2027-06-07";
    renderBoard();
    // Status text, not color-only (scoped to the assignment row, distinct from the legend vocabulary):
    const list = await screen.findByRole("list", { name: "Assignments" });
    expect(within(list).getByText("Schedule overlap")).toBeInTheDocument();
    expect(within(list).getByText("Unavailable")).toBeInTheDocument();
    // View controls are real buttons (keyboard-operable) with aria-pressed:
    const dayButton = screen.getByRole("button", { name: "Day" });
    expect(dayButton).toHaveAttribute("aria-pressed", "true");
    // The assignment is an actionable button (focusable / keyboard-operable):
    expect(within(list).getByRole("button", { name: /Open staffing for/ })).toBeInTheDocument();
  });

  it("19. a suspicious (corrupt-duration) assignment is surfaced, not silently dropped", async () => {
    respondByView({
      day: () =>
        plan("day", [
          emp({
            employee_user_id: "Ada",
            suspicious_timing_count: 1,
            assignments: [
              assignment({
                shift_id: "s1",
                timing_quality: "suspicious",
                source_duration_minutes: 2358191,
                clipped_duration_minutes: 10080,
                timing_warning_reason: "Source interval is 39303h, beyond the 24h plausibility limit; likely corrupt — only the in-window portion is counted."
              })
            ]
          })
        ])
    });
    window.location.hash = "#operations/staffing/capacity?view=day&date=2027-06-07";
    renderBoard();
    const list = await screen.findByRole("list", { name: "Assignments" });
    expect(within(list).getByText(/Suspicious timing/)).toBeInTheDocument();
    // The corrupt source duration is visible alongside the bounded counted amount — nothing disappears.
    expect(within(list).getByText(/counted/)).toBeInTheDocument();
  });
});
