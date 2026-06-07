// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import type { HomeDashboardResponse, SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

afterEach(() => {
  cleanup();
});

const standardSessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
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
};

function buildUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: "user-1",
    tenantId: "tenant-demo",
    accountId: "account-1",
    sessionId: "session-1",
    email: "user@example.com",
    fullName: "Demo User",
    status: "active",
    department: "operations",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["employee"],
    permissions: ["dashboard.read", "schedule.read", "notification.read"],
    authorityTier: "standard_employee",
    primaryJobFunctionProfile: "associate_photographer",
    jobFunctionProfiles: ["associate_photographer"],
    permissionGrants: [],
    effectiveScopes: ["self_only"],
    sessionTrust: standardSessionTrust,
    ...overrides
  };
}

function buildHomeResponse(homeSurface: NonNullable<HomeDashboardResponse["home_surface"]>): HomeDashboardResponse {
  return {
    generated_at: "2026-03-31T12:00:00.000Z",
    anchor_date: "2026-03-31",
    mode: "app",
    refresh_interval_seconds: 60,
    tv_rotation_seconds: 15,
    public_safe: false,
    tv_names_enabled: true,
    critical_banner: null,
    home_surface: homeSurface,
    widgets: {
      today_strip: {
        shoot_count: 0,
        urgent_issue_count: 0,
        approvals_waiting_count: 0,
        late_arrival_count: 0,
        production_at_risk_count: 0
      },
      business_pulse: {
        tiles: [],
        week_start: "2026-03-30",
        week_end: "2026-04-05",
        week_schedule: [],
        weekly_department_mix: [],
        jobs: []
      },
      today_shoots: {
        total: 12,
        upcoming_count: 4,
        in_progress_count: 5,
        complete_count: 3,
        needs_attention_count: 2,
        big_shoot_count: 1,
        shoots: []
      },
      weather_travel_watch: {
        tone: "neutral",
        summary_line: "No weather or travel issues right now.",
        items: []
      },
      customer_service_pulse: {
        safe_summary: true,
        tone: "neutral",
        summary_line: "Support looks steady right now.",
        open_tickets: 0,
        urgent_signal_count: 0,
        backlog_count: 0,
        trend_label: "Steady",
        top_categories: [],
        connected: true,
        drilldown_enabled: false
      },
      places_that_need_more_love: {
        summary_line: "No places need extra love right now.",
        items: []
      },
      labor_snapshot_today: null,
      attendance_awareness: {
        visible: false,
        summary: {
          clocked_in_count: 0,
          not_clocked_in_count: 0,
          late_count: 0,
          missing_count: 0,
          wrong_location_count: 0
        },
        clocked_in: { count: 0, items: [] },
        not_clocked_in: { count: 0, items: [] },
        late: { count: 0, items: [] },
        missing: { count: 0, items: [] },
        wrong_location: { count: 0, items: [] },
        in_office: { count: 0, items: [] },
        in_field: { count: 0, items: [] },
        assigned_but_missing: { count: 0, items: [] }
      },
      urgent_watch: {
        visible: false,
        tone: "neutral",
        summary_line: "No urgent issues are open.",
        items: []
      },
      department_task_counts: {
        schools: 5,
        sports: 3,
        production: 7
      },
      production_projects: {
        visible: true,
        generated_at: "2026-03-31T12:00:00.000Z",
        summary_line: "Production is moving.",
        tone: "heads_up",
        counts: {
          unassigned_jobs: 1,
          active_jobs: 11,
          on_time: 8,
          overdue: 1,
          blocked: 2,
          due_within_24_hours: 3,
          jobs_in_qa: 2,
          ready_to_release: 4
        },
        assessment_cards: [],
        owners: [],
        focus_items: [],
        urgent_items: []
      }
    }
  };
}

describe("dashboard home command surface", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.location.hash = "#home";
  });

  it("renders a compact operational home for management with direct actions, attendance, summary cards, and urgent drilldowns", async () => {
    const onOpenConcierge = vi.fn();
    const managerResponse = buildHomeResponse({
      role_template: "leadership",
      layout: "manager",
      visibility_matrix: {
        staffing_tracker: true,
        time_band: true,
        today_strip: false,
        urgent_watch: true,
        today_and_next_up: true,
        my_day: false,
        attendance_awareness: false,
        production_snapshot: true,
        approvals_summary: false,
        staffing_health: true,
        my_follow_ups: true,
        schools_risk: true
      },
      module_access: {
        home: { module: "home", can_view: true, can_manage: false, scope: "all", route_path: "/home", description: "", manager_only: false },
        operations: { module: "operations", can_view: true, can_manage: true, scope: "all", route_path: "/operations", description: "", manager_only: true },
        exceptions: { module: "exceptions", can_view: true, can_manage: true, scope: "all", route_path: "/operations/exceptions", description: "", manager_only: true },
        scheduling: { module: "scheduling", can_view: true, can_manage: true, scope: "all", route_path: "/scheduling", description: "", manager_only: true },
        schedule: { module: "schedule", can_view: true, can_manage: true, scope: "all", route_path: "/schedule", description: "", manager_only: false },
        graphics: { module: "graphics", can_view: true, can_manage: true, scope: "all", route_path: "/graphics", description: "", manager_only: false },
        approvals: { module: "approvals", can_view: true, can_manage: true, scope: "all", route_path: "/approvals", description: "", manager_only: false },
        reports: { module: "reports", can_view: true, can_manage: true, scope: "all", route_path: "/reports", description: "", manager_only: true }
      },
      staffing_band: {
        visible: true,
        headline: "Attendance",
        summary_line: "Two people should already be clocked in.",
        action_hash: "#operations/attendance",
        metrics: [
          { id: "clocked_in", label: "Clocked In", count: 8, detail: "Eight team members are active.", tone: "good", action_hash: "#operations/attendance" },
          { id: "in_office", label: "In Office", count: 3, detail: "Office staff are present.", tone: "info", action_hash: "#operations/attendance" },
          { id: "in_field", label: "In Field", count: 5, detail: "Field crews are moving.", tone: "info", action_hash: "#operations/attendance" },
          {
            id: "assigned_but_missing",
            label: "Scheduled But Missing",
            count: 2,
            detail: "Jordan Lee and Pat Gomez still need follow-through.",
            tone: "action_needed",
            action_hash: "#operations/attendance"
          }
        ]
      },
      time_band: {
        visible: true,
        headline: "Time Clock",
        state: "off_shift",
        emphasis: "amber",
        label: "Clock In",
        summary_line: "Your next shift is approaching.",
        elapsed_label: null,
        shift_label: "School operations block | 8:00 AM - 5:00 PM",
        location_label: "Main Office",
        action_label: "Clock In",
        action_hash: "#dashboard/my-day",
        schedule_hash: "#my-schedule"
      },
      today_strip: {
        headline: "",
        items: []
      },
      urgent_attention: {
        visible: true,
        headline: "Urgent Issues",
        summary_line: "Two issues need attention today.",
        items: [
          {
            id: "watch-1",
            kind: "attendance",
            kind_label: "Attendance",
            title: "Lead still missing",
            summary: "Coverage is still unsafe for the first school arrival window.",
            supporting_label: "Owner: Demo Leadership",
            tone: "action_needed",
            urgency_state: "overdue",
            urgency_label: "Overdue",
            action_label: "Open attendance",
            action_hash: "#operations/attendance",
            shoot_id: null,
            location_id: null,
            project_id: null
          }
        ]
      },
      today_and_next_up: {
        visible: true,
        headline: "What is moving",
        summary_line: "Work is moving in two places.",
        today: [
          {
            id: "focus-1",
            source_label: "Needs Staffing",
            title: "White Bear Lake High School",
            summary: "Lead coverage is still open.",
            owner_label: "Demo Leadership",
            due_label: "Picture day today",
            status_label: "Needs Staffing",
            tone: "action_needed",
            next_action: "Open staffing control",
            action_hash: "#operations/staffing?area=staffing"
          }
        ],
        next_up: [
          {
            id: "focus-2",
            source_label: "Production",
            title: "Gallery release review",
            summary: "A gallery release is still waiting on approval.",
            owner_label: "Office Team",
            due_label: "Release today",
            status_label: "Awaiting release",
            tone: "heads_up",
            next_action: "Open production queue",
            action_hash: "#project-tracking/workflows/workflow-gallery-release"
          }
        ]
      },
      my_day: null,
      compact_widgets: [
        {
          id: "staffing_health",
          title: "Staffing",
          count: 2,
          summary: "Two staffing gaps are active.",
          tone: "action_needed",
          action_hash: "#operations/staffing?area=staffing"
        },
        {
          id: "production_snapshot",
          title: "Production",
          count: 11,
          summary: "Digital production is active.",
          tone: "heads_up",
          action_hash: "#production/digital"
        }
      ]
    });

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/dashboard/home?mode=app") {
        return managerResponse;
      }
      throw new Error(`Unexpected dashboard test call: ${path}`);
    });

    render(
      <Dashboard
        token="token"
        currentUser={buildUser({
          id: "manager-1",
          fullName: "Demo Leadership",
          department: "operations",
          authorityTier: "leadership",
          roles: ["leadership", "manager"],
          primaryJobFunctionProfile: "leadership_team_member",
          jobFunctionProfiles: ["leadership_team_member"],
          permissions: [
            "dashboard.read",
            "schedule.read",
            "schedule.manage",
            "shoot.create",
            "task.create",
            "alerts.read",
            "approval.read",
            "production_projects.view",
            "notification.read",
            "training.view"
          ]
        })}
        socket={null}
        onOpenConcierge={onOpenConcierge}
      />
    );

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText(/Daily operating view for today's schedule/i)).toBeInTheDocument();
    const conciergeInput = screen.getByRole("searchbox", { name: /Ask Concierge Anything/i });
    expect(conciergeInput).toHaveAttribute("placeholder", "Ask Concierge Anything...");
    fireEvent.change(conciergeInput, { target: { value: "staffing gaps today" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onOpenConcierge).toHaveBeenCalledWith("staffing gaps today");
    expect(screen.queryByRole("button", { name: "Add Task" })).not.toBeInTheDocument();
    expect(screen.getByText("Today's Briefing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Event" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alerts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Tasks" })).not.toBeInTheDocument();

    expect(screen.getByText("Time Clock")).toBeInTheDocument();
    expect(screen.getByText("Ready to clock in")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clock In" }).length).toBeGreaterThan(0);

    expect(screen.getByText("Attendance needs attention")).toBeInTheDocument();
    expect(screen.getByText("Expected In, Not Clocked In")).toBeInTheDocument();
    expect(screen.queryByText("Clocked In - Field")).not.toBeInTheDocument();
    expect(screen.queryByText("Clocked In - Office")).not.toBeInTheDocument();

    expect(screen.queryByText("Today at a glance")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Today's Shoots/i })).toBeInTheDocument();
    expect(screen.getByText(/scheduled item.*still need readiness follow-through/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Staffing Gaps/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Schools Tasks/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Sports Tasks/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Urgent Issues · 1/i })).toBeInTheDocument();
    expect(screen.getByText("Staffing needs attention")).toBeInTheDocument();
    expect(screen.getByText("This Week's Operational Priorities")).toBeInTheDocument();
    expect(screen.queryByText("Work That Needs To Be Processed This Week")).not.toBeInTheDocument();
    expect(screen.queryByText("Jobs That Need To Go Out This Week")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Shoots scheduled this week/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Staffing gaps/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Jobs awaiting production/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Work ready to release/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Projects blocked or at risk/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Client follow-ups/i })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Open Needs Attention" })).not.toBeInTheDocument();
    expect(screen.queryByText("Lead still missing")).not.toBeInTheDocument();
    expect(screen.queryByText("Why it matters")).not.toBeInTheDocument();
    expect(screen.queryByText(/Owner\/context: Owner: Demo Leadership/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Work moving now/i)).not.toBeInTheDocument();

    expect(screen.queryByText("Today Strip")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational Modules")).not.toBeInTheDocument();
    expect(screen.queryByText("Widget Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("Watchlist")).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("searchbox", { name: /Ask Concierge Anything/i }).closest("form")!);
    expect(onOpenConcierge).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /Today's Shoots/i }));
    expect(window.location.hash).toBe("#studios/shoots");

    fireEvent.click(screen.getAllByRole("button", { name: /Staffing Gaps/i })[0]);
    expect(window.location.hash).toBe("#operations/staffing?area=staffing");

    fireEvent.click(screen.getByRole("button", { name: /Schools Tasks/i }));
    expect(window.location.hash).toBe("#schools/tasks");

    fireEvent.click(screen.getAllByRole("button", { name: /Sports Tasks/i })[0]);
    expect(window.location.hash).toBe("#sports/tasks");

    fireEvent.click(screen.getByRole("button", { name: /Work ready to release/i }));
    expect(window.location.hash).toBe("#graphics/release?queue=ready_to_release_queue&stage=ready_to_release");

    fireEvent.click(screen.getByRole("button", { name: /Urgent Issues · 1/i }));
    expect(window.location.hash).toBe("#employees/attendance");
  });

  it("keeps the employee home simple, action-oriented, and free of the old placeholder language", async () => {
    const employeeResponse = buildHomeResponse({
      role_template: "standard_employee",
      layout: "employee",
      visibility_matrix: {
        staffing_tracker: false,
        time_band: true,
        today_strip: false,
        urgent_watch: false,
        today_and_next_up: false,
        my_day: true,
        attendance_awareness: false,
        production_snapshot: false,
        approvals_summary: false,
        staffing_health: false,
        my_follow_ups: false,
        schools_risk: false
      },
      module_access: {
        home: { module: "home", can_view: true, can_manage: false, scope: "own", route_path: "/home", description: "", manager_only: false },
        operations: { module: "operations", can_view: false, can_manage: false, scope: "none", route_path: "/operations", description: "", manager_only: true },
        exceptions: { module: "exceptions", can_view: false, can_manage: false, scope: "none", route_path: "/operations/exceptions", description: "", manager_only: true },
        scheduling: { module: "scheduling", can_view: false, can_manage: false, scope: "none", route_path: "/scheduling", description: "", manager_only: true },
        schedule: { module: "schedule", can_view: true, can_manage: false, scope: "own", route_path: "/schedule", description: "", manager_only: false },
        graphics: { module: "graphics", can_view: false, can_manage: false, scope: "none", route_path: "/graphics", description: "", manager_only: false },
        approvals: { module: "approvals", can_view: true, can_manage: false, scope: "own", route_path: "/approvals", description: "", manager_only: false },
        reports: { module: "reports", can_view: false, can_manage: false, scope: "none", route_path: "/reports", description: "", manager_only: true }
      },
      staffing_band: null,
      time_band: {
        visible: true,
        headline: "Time Clock",
        state: "action_needed",
        emphasis: "red",
        label: "Punch In Needed",
        summary_line: "You are off the clock. Your next assignment is about to start.",
        elapsed_label: null,
        shift_label: "Spring Portrait Day | 8:00 AM - 12:00 PM",
        location_label: "Main Gym",
        action_label: "Open My Day",
        action_hash: "#dashboard/my-day",
        schedule_hash: "#schedule"
      },
      today_strip: {
        headline: "",
        items: []
      },
      urgent_attention: {
        visible: false,
        headline: "Urgent Issues",
        summary_line: "Urgent issues are hidden for this role.",
        items: []
      },
      today_and_next_up: null,
      my_day: {
        visible: true,
        headline: "My Day",
        summary_line: "One item in your day still needs action.",
        next_shift_label: "Next call at 8:00 AM",
        items: [
          {
            id: "shift-1",
            title: "Spring Portrait Day",
            summary: "Review the main office entry instructions.",
            location_label: "Main Gym",
            time_label: "8:00 AM - 12:00 PM",
            role_label: "Photographer",
            status_label: "Closeout due",
            tone: "heads_up",
            next_action: "Review notes",
            action_hash: "#dashboard/my-day"
          }
        ],
        updates: [
          {
            id: "update-1",
            title: "Shoot time changed",
            summary: "Arrival moved to 7:45 AM.",
            created_at_label: "Mar 31, 7:10 AM",
            action_hash: "#notifications"
          }
        ]
      },
      compact_widgets: []
    });

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/dashboard/home?mode=app") {
        return employeeResponse;
      }
      throw new Error(`Unexpected dashboard test call: ${path}`);
    });

    render(
      <Dashboard
        token="token"
        currentUser={buildUser({
          id: "employee-1",
          fullName: "Demo Photographer",
          department: "schools",
          permissions: ["dashboard.read", "schedule.read", "notification.read", "alerts.read_own", "approval.read"],
          authorityTier: "standard_employee"
        })}
        socket={null}
      />
    );

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText(/Daily operating view for today's schedule/i)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /Ask Concierge Anything/i })).toHaveAttribute("placeholder", "Ask Concierge Anything...");
    expect(screen.getByText("Today's Briefing")).toBeInTheDocument();
    expect(screen.queryByText("Today at a glance")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alerts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Tasks" })).not.toBeInTheDocument();
    expect(screen.getByText("Time Clock")).toBeInTheDocument();
    expect(screen.getByText("Clock-in needed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clock In" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Work moving now/i)).not.toBeInTheDocument();

    expect(screen.queryByText("Attendance")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Urgent Issues · 0/i })).toBeInTheDocument();
    expect(screen.queryByText("Today Strip")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational Modules")).not.toBeInTheDocument();
    expect(screen.queryByText("What Needs Attention Right Now")).not.toBeInTheDocument();
    expect(screen.queryByText(/red or green shell punch control/i)).not.toBeInTheDocument();
  });
});
