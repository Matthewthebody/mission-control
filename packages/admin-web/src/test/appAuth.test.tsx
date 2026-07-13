// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { getAvailableTabs, getPrimarySections, resolveHeaderCollapsedState } from "../app";
import { ApiClientError } from "../api";
import { buildShellRouteHash, resolveRouteId } from "../navigation";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

const sessionTrust = {
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

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

vi.mock("../realtime", () => ({
  connectRealtime: vi.fn(() => ({
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn()
  }))
}));

vi.mock("../pages/Schedule", () => ({
  Schedule: () => (
    <section>
      <h2>Schedule</h2>
      <p>Who is working, where, when, and coverage status.</p>
    </section>
  )
}));

afterEach(() => {
  cleanup();
});

describe("app auth bootstrap", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as typeof window.matchMedia;
  });

  it("clears a stale token on unauthorized session fetch and returns to login with a notice", async () => {
    window.localStorage.setItem("pmc_admin_token", "stale-token");
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        throw new ApiClientError(401, "Unauthorized");
      }
      return {};
    });

    render(<App />);

    expect(await screen.findByText("Sign In")).toBeInTheDocument();
    expect(window.localStorage.getItem("pmc_admin_token")).toBeNull();
  });

  it("hides Microsoft sign-in when local auth options say Entra is disabled", async () => {
    apiFetchMock.mockResolvedValueOnce({
      microsoft_entra_enabled: false,
      password_login_enabled: true,
      password_login_break_glass_only: false,
      dev_login_enabled: true
    });

    render(<App />);

    expect(await screen.findByText("Sign In")).toBeInTheDocument();
    expect(screen.getByText("Microsoft Entra sign-in is disabled in this environment. Use password sign-in for local development or break-glass access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in with microsoft/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Password Sign-In" })).toBeInTheDocument();
  });

  it("hydrates a Microsoft callback token from the hash and resumes the authenticated shell", async () => {
    window.history.replaceState(null, "", "/#auth/callback?status=signed_in&token=entra-token&return_hash=%23account");

    const entraUser: SessionUser = {
      id: "user-entra",
      tenantId: "tenant-demo",
      accountId: "account-entra",
      sessionId: "session-entra",
      email: "entra.user@example.com",
      fullName: "Entra User",
      status: "active",
      department: "office",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["office_employee"],
      permissions: ["dashboard.read", "account.read"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissionGrants: [],
      effectiveScopes: ["own_records_only"],
      sessionTrust: {
        ...sessionTrust,
        identityProvider: "microsoft_entra"
      }
    };

    apiFetchMock.mockImplementation(async (path: string, token?: string) => {
      if (path === "/auth/session") {
        expect(token).toBe("entra-token");
        return { user: entraUser };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Account & Session")).toBeInTheDocument();
    expect(window.localStorage.getItem("pmc_admin_token")).toBe("entra-token");
    expect(window.location.hash).toBe("#account");
  });

  it("refreshes the current session after a Microsoft step-up callback without dropping the existing token", async () => {
    window.localStorage.setItem("pmc_admin_token", "existing-entra-token");
    window.history.replaceState(null, "", "/#auth/callback?status=step_up_complete&return_hash=%23account");

    const elevatedUser: SessionUser = {
      id: "user-entra",
      tenantId: "tenant-demo",
      accountId: "account-entra",
      sessionId: "session-entra",
      email: "entra.user@example.com",
      fullName: "Entra User",
      status: "active",
      department: "office",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["office_employee"],
      permissions: ["dashboard.read", "account.read", "communication.use"],
      authorityTier: "leadership",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      policyGrants: [],
      internalRoleGroups: ["leadership"],
      communicationIdentity: {
        provider: "microsoft_teams",
        microsoftUserId: "ms-user-1",
        microsoftTenantId: "ms-tenant-1",
        communicationEnabled: true,
        teamsChatDefaultTarget: null,
        linkedAt: "2026-04-03T12:00:00.000Z",
        lastVerifiedAt: "2026-04-03T12:05:00.000Z",
        status: "linked_ready"
      },
      microsoftEntraAuthorization: {
        provider: "microsoft_entra",
        sourceContractVersion: "1",
        raw: {
          tenantId: "ms-tenant-1",
          userId: "ms-user-1",
          email: "entra.user@example.com",
          scopes: ["User.Read"],
          appRoleValues: ["MissionControl.SecurityAdmin"],
          groupIds: [],
          groupClaimsOverage: false,
          authContextIds: ["c1"],
          amr: ["mfa"],
          acr: "c1",
          sessionAssurance: "mfa",
          rawClaims: {}
        },
        resolved: {
          authorityTier: "leadership",
          internalRoleGroups: ["leadership"],
          policyRoles: ["security_admin"],
          permissionKeys: ["audit.read", "security.manage"],
          mappedAppRoles: ["MissionControl.SecurityAdmin"],
          mappedGroupIds: []
        },
        issues: [],
        signInAllowed: true
      },
      sessionTrust: {
        ...sessionTrust,
        identityProvider: "microsoft_entra",
        sessionAssurance: "mfa",
        lastReauthenticatedAt: "2026-04-04T15:00:00.000Z",
        activeAuthContextIds: ["c1"]
      }
    };

    apiFetchMock.mockImplementation(async (path: string, token?: string) => {
      if (path === "/auth/session") {
        expect(token).toBe("existing-entra-token");
        return { user: elevatedUser };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Account & Session")).toBeInTheDocument();
    expect(window.localStorage.getItem("pmc_admin_token")).toBe("existing-entra-token");
    expect(window.location.hash).toBe("#account");
  });

  it("shows the Microsoft review notice and keeps the shell unauthenticated when callback sign-in is pending", async () => {
    window.localStorage.setItem("pmc_admin_token", "old-token");
    window.history.replaceState(
      null,
      "",
      "/#auth/callback?status=pending_review&notice=Your%20Microsoft%20account%20is%20waiting%20for%20admin%20review."
    );
    apiFetchMock.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    expect(await screen.findByText("Sign In")).toBeInTheDocument();
    expect(screen.getByText("Your Microsoft account is waiting for admin review.")).toBeInTheDocument();
    expect(window.localStorage.getItem("pmc_admin_token")).toBeNull();
    expect(window.location.hash).toBe("#home");
  });

  it("does not show the global punch control on unauthenticated pages", async () => {
    render(<App />);

    expect(await screen.findByText("Sign In")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /global time clock control/i })).not.toBeInTheDocument();
  });

  it("keeps the saved token when session verification fails for network reasons and offers retry", async () => {
    window.localStorage.setItem("pmc_admin_token", "network-token");
    apiFetchMock
      .mockRejectedValueOnce(new ApiClientError(0, "Network request failed"))
      .mockRejectedValueOnce(new ApiClientError(0, "Network request failed"));

    render(<App />);

    expect(await screen.findByText("Session Check Failed")).toBeInTheDocument();
    expect(screen.getByText(/couldn't verify your session/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("pmc_admin_token")).toBe("network-token");

    fireEvent.click(screen.getByRole("button", { name: "Retry Session Check" }));

    await waitFor(() => {
      const sessionCalls = apiFetchMock.mock.calls.filter(([path]) => path === "/auth/session");
      expect(sessionCalls).toHaveLength(2);
    });
  });

  it("shows the global punch control in the authenticated shell and sources its state from the canonical backend route", async () => {
    window.localStorage.setItem("pmc_admin_token", "shell-token");
    window.location.hash = "#operations";

    const managerUser: SessionUser = {
      id: "user-manager",
      tenantId: "tenant-demo",
      accountId: "account-manager",
      sessionId: "session-manager",
      email: "manager@example.com",
      fullName: "Demo Manager",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["manager"],
      permissions: ["dashboard.read", "schedule.read", "time.clock", "shoot.read"],
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "operations_manager",
      jobFunctionProfiles: ["operations_manager"],
      permissionGrants: [],
      effectiveScopes: ["department_scope"],
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
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: managerUser };
      }
      if (path.startsWith("/api/dashboard/operations/control-room?date=")) {
        return {
          generated_at: "2026-03-31T14:00:00.000Z",
          anchor_date: "2026-03-31",
          refresh_interval_seconds: 60,
          summary_band: [],
          urgent_watch: {
            generated_at: "2026-03-31T14:00:00.000Z",
            headline: "Exceptions",
            summary_line: "No open exceptions.",
            action_hash: "#operations/exceptions",
            items: []
          },
          staffing_pressure: {
            generated_at: "2026-03-31T14:00:00.000Z",
            headline: "Staffing / Schedule Pressure",
            summary_line: "No staffing blockers.",
            action_hash: "#operations/staffing?area=staffing",
            metrics: [],
            items: []
          },
          attendance_impact: {
            generated_at: "2026-03-31T14:00:00.000Z",
            headline: "Attendance Impact",
            summary_line: "No attendance blockers.",
            action_hash: "#operations/attendance",
            metrics: [],
            items: []
          },
          live_execution: {
            generated_at: "2026-03-31T14:00:00.000Z",
            headline: "Live Shoot Execution / Readiness / Travel / Exceptions",
            summary_line: "No live execution blockers.",
            routes: [],
            items: []
          },
          recent_activity: {
            generated_at: "2026-03-31T14:00:00.000Z",
            headline: "Recent Operational Updates",
            summary_line: "Nothing new.",
            items: []
          }
        };
      }
      if (path === "/api/attendance/time-clock/state") {
        return {
          generated_at: "2026-03-31T14:00:00.000Z",
          state: "action_needed",
          emphasis: "red",
          label: "Punch In Needed",
          helper_text: "Shift starts in 5m at Main Office.",
          time_clock_state: {
            session_id: null,
            session_status: "off_clock",
            current_state: "off_clock",
            current_segment_id: null,
            current_segment_review_status: null,
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: null,
            needs_end_of_day_confirmation: false,
            last_clock_event_at: null
          },
          active_shift: {
            id: "shift-1",
            shoot_id: null,
            title: "Main Office Coverage",
            shift_kind: "office",
            starts_at: "2026-03-31T14:05:00.000Z",
            ends_at: "2026-03-31T18:00:00.000Z",
            location_name: "Main Office",
            actionable_now: true,
            starts_in_minutes: 5,
            late_by_minutes: null
          },
          next_shift: null,
          latest_session: null,
          review: {
            has_open_review: false,
            open_request_count: 0,
            label: null
          },
          action: {
            direction: "in",
            label: "Punch In",
            enabled: true,
            shift_id: "shift-1",
            shoot_id: null,
            work_state: "office_drive"
          }
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    const trigger = await screen.findByRole("button", { name: /global time clock control/i });
    await waitFor(() => {
      expect(trigger).toHaveTextContent("Punch In Needed");
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/attendance/time-clock/state", "shell-token");
    expect(screen.getByText("Start Here")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.queryByText("Work Spine")).not.toBeInTheDocument();
    expect(screen.getByText("Departments")).toBeInTheDocument();
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Needs Attention" })).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Operations" })).not.toBeInTheDocument();
    const homeButton = screen.getByRole("button", { name: "My Dashboard" });
    homeButton.focus();
    expect(homeButton).toHaveFocus();
  });

  it("keeps the Schedule route free of the generic Quick Access rail", async () => {
    window.localStorage.setItem("pmc_admin_token", "schedule-token");
    window.location.hash = "#schedule";

    const scheduleUser: SessionUser = {
      id: "user-scheduler",
      tenantId: "tenant-demo",
      accountId: "account-scheduler",
      sessionId: "session-scheduler",
      email: "scheduler@example.com",
      fullName: "Demo Admin",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["manager"],
      permissions: ["dashboard.read", "schedule.read", "shoot.read"],
      authorityTier: "director_admin",
      primaryJobFunctionProfile: "director_of_photography",
      jobFunctionProfiles: ["director_of_photography"],
      permissionGrants: [],
      effectiveScopes: ["department_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: scheduleUser };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findAllByRole("heading", { name: "Schedule" })).toHaveLength(1);
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Quick Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).not.toBeInTheDocument();
    expect(screen.queryByText("Demo Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Director Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Director Of Photography")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected Standard")).not.toBeInTheDocument();
  });

  it("keeps the Jobs route focused on the database without the generic Quick Access rail", async () => {
    window.localStorage.setItem("pmc_admin_token", "jobs-token");
    window.location.hash = "#jobs";

    const jobsUser: SessionUser = {
      id: "user-jobs",
      tenantId: "tenant-demo",
      accountId: "account-jobs",
      sessionId: "session-jobs",
      email: "jobs@example.com",
      fullName: "Jobs User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["office_employee"],
      permissions: ["dashboard.read", "job.read"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissionGrants: [],
      effectiveScopes: ["department_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: jobsUser };
      }
      if (path.startsWith("/api/jobs/index")) {
        return {
          rows: [],
          summary: { total: 0, metrics: [] },
          page: { limit: 25, offset: 0, total: 0, returned: 0, has_more: false },
          attention_reason_availability: { job_native: [], unavailable: [] },
          applied_metric: null
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    // The global Jobs route now renders the canonical Phase 3B/3C index.
    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("No jobs match this view.")).toBeInTheDocument();
    expect(screen.queryByText("Jobs Database")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Jobs" })).toHaveLength(1);
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Quick Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).not.toBeInTheDocument();
  });

  it("keeps the Photography overview free of duplicate shell title and Quick Access clutter", async () => {
    window.localStorage.setItem("pmc_admin_token", "photography-token");
    window.location.hash = "#studios";

    const photographyUser: SessionUser = {
      id: "user-photography",
      tenantId: "tenant-demo",
      accountId: "account-photography",
      sessionId: "session-photography",
      email: "photography@example.com",
      fullName: "Photography User",
      status: "active",
      department: "photography",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["dashboard.read", "shoot.read", "schedule.read", "job.read", "project.read"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "lead_photographer",
      jobFunctionProfiles: ["lead_photographer"],
      permissionGrants: [],
      effectiveScopes: ["department_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: photographyUser };
      }
      if (path.startsWith("/api/jobs")) {
        return { jobs: [] };
      }
      if (path.startsWith("/api/workflows/command-center")) {
        return {
          generated_at: "2026-06-05T12:00:00.000Z",
          view: "department",
          summary: {},
          alerts: [],
          steps: [],
          job_rows: []
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Photography", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Photography", level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Quick Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).not.toBeInTheDocument();
    expect(screen.getByText("Open First")).toBeInTheDocument();
  });

  it("keeps the My Work launchpad free of duplicate shell title and Quick Access clutter", async () => {
    window.localStorage.setItem("pmc_admin_token", "my-work-token");
    window.location.hash = "#my-work";

    const myWorkUser: SessionUser = {
      id: "user-my-work",
      tenantId: "tenant-demo",
      accountId: "account-my-work",
      sessionId: "session-my-work",
      email: "my.work@example.com",
      fullName: "My Work User",
      status: "active",
      department: "schools",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["dashboard.read", "schedule.read", "time.clock", "notification.read", "project.read"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "seasonal_photographer",
      jobFunctionProfiles: ["seasonal_photographer"],
      permissionGrants: [],
      effectiveScopes: ["self_only"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: myWorkUser };
      }
      if (path.startsWith("/api/employee/my-work?anchor_date=")) {
        return {
          anchor_date: "2026-03-30",
          window_end_date: "2026-04-06",
          summary: {
            events_today: 0,
            upcoming_events: 0,
            shifts_today: 0,
            upcoming_shifts: 0,
            pending_trade_requests: 0,
            unread_notifications: 0,
            clocked_in_shift_count: 0,
            attention_needed_count: 0,
            closeout_due_count: 0,
            late_or_exception_count: 0,
            mileage_review_count: 0,
            assigned_job_count: 0,
            assigned_event_count: 0,
            assigned_task_count: 0,
            live_workflow_step_count: 0,
            acknowledgement_count: 0,
            owned_exception_count: 0,
            approval_waiting_count: 0,
            recent_change_count: 0,
            next_event_label: null,
            next_shift_label: null
          },
          shifts: [],
          notifications: [],
          jobs: [],
          live_workflow_steps: [],
          events: [],
          tasks: [],
          acknowledgements: [],
          exceptions: [],
          approvals: [],
          recent_changes: []
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    // The My Work chunk is reachable both lazily (shell route) and statically
    // (employee Home) since MC-AUDIT-003, so the page can mount, suspend, and
    // remount — wait for it to settle, then assert on a fresh query (a node
    // captured mid-remount can be detached by assertion time).
    await screen.findByRole("heading", { name: "My Work", level: 2 }, { timeout: 3000 });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My Work", level: 2 })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "My Work", level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Quick Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Clocked Out" })).toHaveLength(1);
    expect(screen.queryByText("Off Shift")).not.toBeInTheDocument();
  });

  it("keeps the Directory route focused on lookup without generic shell status clutter", async () => {
    window.localStorage.setItem("pmc_admin_token", "directory-token");
    window.location.hash = "#accounts";

    const directoryUser: SessionUser = {
      id: "user-directory",
      tenantId: "tenant-demo",
      accountId: "account-directory",
      sessionId: "session-directory",
      email: "directory@example.com",
      fullName: "Directory User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["leadership"],
      permissions: ["dashboard.read", "directory.read", "organizations.read", "contacts.read", "shoot_locations.view", "user.read"],
      authorityTier: "leadership",
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: directoryUser };
      }
      if (path === "/api/organizations/internal-owners") {
        return { owners: [] };
      }
      if (path.startsWith("/api/organizations?")) {
        return { organizations: [], search: { query: "", total: 0 } };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Search for a school, sports organization, contact, or location. Find the school, sports organization, client, or location first, then open the record for details.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Directory" })).toHaveLength(1);
    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Quick Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).not.toBeInTheDocument();
    expect(screen.queryByText("In Directory")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Standard")).not.toBeInTheDocument();
    expect(screen.queryByText("Team Member")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Client Command Center" })).not.toBeInTheDocument();
  });

  it("routes Directory Locations to the address-book lookup surface", async () => {
    window.localStorage.setItem("pmc_admin_token", "directory-locations-token");
    window.location.hash = "#directory/locations";

    const directoryUser: SessionUser = {
      id: "user-directory-locations",
      tenantId: "tenant-demo",
      accountId: "account-directory-locations",
      sessionId: "session-directory-locations",
      email: "directory.locations@example.com",
      fullName: "Directory Locations User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["leadership"],
      permissions: ["dashboard.read", "directory.read", "organizations.read", "contacts.read", "shoot_locations.view", "user.read"],
      authorityTier: "leadership",
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: directoryUser };
      }
      if (path === "/api/organizations/internal-owners") {
        return { owners: [] };
      }
      if (path.startsWith("/api/organizations/locations")) {
        return { locations: [], search: { query: "", total: 0 } };
      }
      if (path.startsWith("/api/organizations?")) {
        return { organizations: [], search: { query: "", total: 0 } };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Search for a school, sports organization, contact, or location. Use Locations when the place matters first, then open the connected organization for the full record.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Locations" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search locations by place, organization, address, or notes")).toBeInTheDocument();
    expect(screen.queryByText("Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Shortcuts" })).not.toBeInTheDocument();
    expect(screen.queryByText("In Directory")).not.toBeInTheDocument();
    expect(screen.queryByText("Kemmetmueller Location Guide")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Client Command Center" })).not.toBeInTheDocument();
  });

  it("renders the communications launcher in the authenticated shell", async () => {
    window.localStorage.setItem("pmc_admin_token", "shell-token");
    window.location.hash = "#dashboard";

    const shellUser: SessionUser = {
      id: "user-communications-shell",
      tenantId: "tenant-demo",
      accountId: "account-communications-shell",
      sessionId: "session-communications-shell",
      email: "communications.shell@example.com",
      fullName: "Communications Shell User",
      status: "active",
      department: "office",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["office_employee"],
      permissions: ["dashboard.read", "communication.use"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "customer_service_rep",
      jobFunctionProfiles: ["customer_service_rep"],
      permissionGrants: [],
      effectiveScopes: ["own_records_only"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string, token?: string) => {
      if (path === "/auth/session") {
        expect(token).toBe("shell-token");
        return { user: shellUser };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    const communicationButtons = await screen.findAllByRole("button", { name: /teams/i });
    expect(communicationButtons.some((button) => button.className.includes("communications-launcher__trigger"))).toBe(true);
  });

  it("keeps route identity in the mobile shell without repeating the route description stack above the page workspace", async () => {
    window.localStorage.setItem("pmc_admin_token", "mobile-shell-token");
    window.location.hash = "#employees";
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 860px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as typeof window.matchMedia;

    const employeeUser: SessionUser = {
      id: "user-employee-mobile",
      tenantId: "tenant-demo",
      accountId: "account-employee-mobile",
      sessionId: "session-employee-mobile",
      email: "employee.mobile@example.com",
      fullName: "Mobile Employee",
      status: "active",
      department: "schools",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["schedule.read", "time.clock", "training.view", "trade.request", "requests.view"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissionGrants: [],
      effectiveScopes: ["self_only"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: employeeUser };
      }
      if (path.startsWith("/api/dashboard/employees/workspace?date=")) {
        return {
          generated_at: "2026-03-31T14:00:00.000Z",
          anchor_date: "2026-03-31",
          refresh_interval_seconds: 90,
          role_mode: "employee",
          summary_strip: [],
          my_work: {
            visible: true,
            headline: "My Work / My Day",
            summary_line: "Open the employee work surface from here.",
            cards: [],
            highlights: [],
            primary_action_hash: "#dashboard/my-day",
            primary_action_label: "Open My Day",
            secondary_action_hash: "#schedule",
            secondary_action_label: "Open Schedule"
          },
          time_pay: {
            visible: true,
            headline: "Time / Pay / Review",
            state: "action_needed",
            emphasis: "red",
            label: "Punch In Needed",
            summary_line: "No time review items are open.",
            helper_text: "Shift starts in 10m at Main Gym.",
            elapsed_label: null,
            shift_label: "Spring Portrait Day",
            location_label: "Main Gym",
            review_label: null,
            action_hash: "#dashboard/my-day",
            action_label: "Open My Day",
            schedule_hash: "#schedule",
            secondary_action_hash: null,
            secondary_action_label: null,
            metrics: []
          },
          requests_approvals: {
            visible: true,
            headline: "Requests / Approvals / Availability",
            summary_line: "Requests are clear.",
            cards: [],
            highlights: [],
            primary_action_hash: "#approvals",
            primary_action_label: "Open Approvals",
            secondary_action_hash: "#employees/requests",
            secondary_action_label: "Open Requests"
          },
          training_readiness: {
            visible: true,
            headline: "Training / Readiness / Certifications",
            summary_line: "Training is clear.",
            cards: [],
            highlights: [],
            primary_action_hash: "#employees/training",
            primary_action_label: "Open Training",
            secondary_action_hash: "#employees/readiness",
            secondary_action_label: "Open Readiness"
          },
          record: {
            visible: true,
            headline: "Personal / Employee Record",
            summary_line: "Record context only.",
            items: [],
            links: []
          }
        };
      }
      if (path === "/api/attendance/time-clock/state") {
        return {
          generated_at: "2026-03-31T14:00:00.000Z",
          state: "neutral",
          emphasis: "blue",
          label: "Time Clock Ready",
          helper_text: "No active shift.",
          time_clock_state: {
            session_id: null,
            session_status: "off_clock",
            current_state: "off_clock",
            current_segment_id: null,
            current_segment_review_status: null,
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: null,
            needs_end_of_day_confirmation: false,
            last_clock_event_at: null
          },
          active_shift: null,
          next_shift: null,
          latest_session: null,
          review: {
            has_open_review: false,
            open_request_count: 0,
            label: null
          },
          action: {
            direction: "in",
            label: "Punch In",
            enabled: true,
            shift_id: null,
            shoot_id: null,
            work_state: "office_drive"
          }
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Stay ahead of your people-side work")).toBeInTheDocument();
    expect(
      screen.queryByText("People-side work for requests, approvals, training, readiness, and employee administration.")
    ).not.toBeInTheDocument();
  });

  it("opens #employees as the real Employees workspace instead of the generic shell scaffold", async () => {
    window.localStorage.setItem("pmc_admin_token", "employees-token");
    window.location.hash = "#employees";

    const employeeUser: SessionUser = {
      id: "user-employee",
      tenantId: "tenant-demo",
      accountId: "account-employee",
      sessionId: "session-employee",
      email: "employee@example.com",
      fullName: "Employee Demo",
      status: "active",
      department: "schools",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["schedule.read", "time.clock", "training.view", "trade.request", "requests.view"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissionGrants: [],
      effectiveScopes: ["self_only"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: employeeUser };
      }
      if (path === "/api/attendance/time-clock/state") {
        return {
          generated_at: "2026-03-31T14:00:00.000Z",
          state: "action_needed",
          emphasis: "red",
          label: "Punch In Needed",
          helper_text: "Shift starts in 10m at Main Gym.",
          time_clock_state: {
            session_id: null,
            session_status: "off_clock",
            current_state: "off_clock",
            current_segment_id: null,
            current_segment_review_status: null,
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: null,
            needs_end_of_day_confirmation: false,
            last_clock_event_at: null
          },
          active_shift: null,
          next_shift: null,
          latest_session: null,
          review: {
            has_open_review: false,
            open_request_count: 0,
            label: null
          },
          action: {
            direction: "in",
            label: "Punch In",
            enabled: true,
            shift_id: null,
            shoot_id: null,
            work_state: "office_drive"
          }
        };
      }
      if (path.startsWith("/api/dashboard/employees/workspace?date=")) {
        return {
          generated_at: "2026-03-31T14:00:00.000Z",
          anchor_date: "2026-03-31",
          refresh_interval_seconds: 90,
          role_mode: "employee",
          summary_strip: [],
          my_work: {
            visible: true,
            headline: "My Work / My Day",
            summary_line: "Open the employee work surface from here.",
            cards: [],
            highlights: [],
            primary_action_hash: "#dashboard/my-day",
            primary_action_label: "Open My Day",
            secondary_action_hash: "#schedule",
            secondary_action_label: "Open Schedule"
          },
          time_pay: {
            visible: true,
            headline: "Time / Pay / Review",
            state: "action_needed",
            emphasis: "red",
            label: "Punch In Needed",
            summary_line: "No time review items are open.",
            helper_text: "Shift starts in 10m at Main Gym.",
            elapsed_label: null,
            shift_label: "Spring Portrait Day",
            location_label: "Main Gym",
            review_label: null,
            action_hash: "#dashboard/my-day",
            action_label: "Open My Day",
            schedule_hash: "#schedule",
            secondary_action_hash: null,
            secondary_action_label: null,
            metrics: []
          },
          requests_approvals: {
            visible: true,
            headline: "Requests / Approvals / Availability",
            summary_line: "Requests are clear.",
            cards: [],
            highlights: [],
            primary_action_hash: "#approvals",
            primary_action_label: "Open Approvals",
            secondary_action_hash: "#employees/requests",
            secondary_action_label: "Open Requests"
          },
          training_readiness: {
            visible: true,
            headline: "Training / Readiness / Certifications",
            summary_line: "Training is clear.",
            cards: [],
            highlights: [],
            primary_action_hash: "#employees/training",
            primary_action_label: "Open Training",
            secondary_action_hash: "#employees/readiness",
            secondary_action_label: "Open Readiness"
          },
          record: {
            visible: true,
            headline: "Personal / Employee Record",
            summary_line: "Record context only.",
            items: [],
            links: []
          }
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Stay ahead of your people-side work")).toBeInTheDocument();
    expect(screen.getByText("My Work / My Day")).toBeInTheDocument();
    expect(screen.queryByText("This route is defined in the shell, but it does not have an owner page wired up yet.")).not.toBeInTheDocument();
  });

  it("opens #admin as the real Admin workspace instead of a generic settings bucket", async () => {
    window.localStorage.setItem("pmc_admin_token", "admin-token");
    window.location.hash = "#admin";

    const adminUser: SessionUser = {
      id: "user-admin",
      tenantId: "tenant-demo",
      accountId: "account-admin",
      sessionId: "session-admin",
      email: "admin@example.com",
      fullName: "Admin Demo",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["admin"],
      permissions: [
        "access.manage",
        "audit.read",
        "security.manage",
        "outlook.manage",
        "labor.read",
        "settings.permissions.read"
      ],
      authorityTier: "super_admin",
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: adminUser };
      }
      if (path === "/api/attendance/time-clock/state") {
        return {
          generated_at: "2026-03-31T16:00:00.000Z",
          state: "ended_today",
          emphasis: "neutral",
          label: "Ended Today",
          helper_text: "Last session ended at 2:15 PM.",
          time_clock_state: {
            session_id: null,
            session_status: "off_clock",
            current_state: "off_clock",
            current_segment_id: null,
            current_segment_review_status: null,
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: null,
            needs_end_of_day_confirmation: false,
            last_clock_event_at: "2026-03-31T14:15:00.000Z"
          },
          active_shift: null,
          next_shift: null,
          latest_session: null,
          review: {
            has_open_review: false,
            open_request_count: 0,
            label: null
          },
          action: {
            direction: "in",
            label: "Punch In",
            enabled: true,
            shift_id: null,
            shoot_id: null,
            work_state: "office_drive"
          }
        };
      }
      if (path.startsWith("/api/dashboard/admin/workspace?date=")) {
        return {
          generated_at: "2026-03-31T16:00:00.000Z",
          anchor_date: "2026-03-31",
          refresh_interval_seconds: 90,
          role_mode: "manage",
          summary_strip: [
            {
              id: "roles_access",
              label: "Roles / Access",
              count: 1,
              detail: "One access issue still needs follow-through.",
              tone: "warning",
              action_hash: "#admin/roles"
            }
          ],
          roles_access: {
            visible: true,
            headline: "Roles and Access",
            summary_line: "Access posture is visible here.",
            action_hash: "#admin/roles",
            action_label: "Open Roles & Access",
            helper_text: "Admin owns access posture.",
            cards: [],
            items: []
          },
          integrations: {
            visible: true,
            headline: "Integrations",
            summary_line: "Integration controls live here.",
            action_hash: "#admin/integrations",
            action_label: "Open Integrations",
            helper_text: null,
            cards: [],
            items: []
          },
          automations: {
            visible: true,
            headline: "Automations",
            summary_line: "Automation health lives here.",
            action_hash: "#admin/automations",
            action_label: "Open Automations",
            helper_text: null,
            cards: [],
            items: []
          },
          settings_reference: {
            visible: true,
            headline: "Settings and Reference Data",
            summary_line: "Configuration lives here.",
            action_hash: "#admin/system",
            action_label: "Open System Configuration",
            helper_text: null,
            cards: [],
            items: []
          },
          audit_security: {
            visible: true,
            headline: "Audit and Security",
            summary_line: "Dangerous actions stay visible here.",
            action_hash: "#admin/audit",
            action_label: "Open Audit & Security",
            helper_text: null,
            cards: [],
            items: []
          },
          review_tools: {
            visible: true,
            headline: "Admin Review Tools",
            summary_line: "Payroll and mileage review stay admin-only.",
            action_hash: "#admin/review-tools",
            action_label: "Open Review Tools",
            helper_text: null,
            cards: [],
            items: []
          }
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    render(<App />);

    expect(await screen.findByText("Admin workspace")).toBeInTheDocument();
    expect(await screen.findByText("Roles and Access")).toBeInTheDocument();
    expect(screen.queryByText("This route is defined in the shell, but it does not have an owner page wired up yet.")).not.toBeInTheDocument();
  });

  it("uses hysteresis for the collapsing shell header so it does not thrash near the threshold", () => {
    expect(resolveHeaderCollapsedState(80, false)).toBe(false);
    expect(resolveHeaderCollapsedState(124, false)).toBe(true);
    expect(resolveHeaderCollapsedState(60, true)).toBe(true);
    expect(resolveHeaderCollapsedState(18, true)).toBe(false);
  });

  it("keeps employee-only users out of directory management while preserving broad shell visibility", () => {
    const fieldEmployee: SessionUser = {
      id: "user-photo",
      tenantId: "tenant-demo",
      accountId: "account-photo",
      sessionId: "session-photo",
      email: "photo@example.com",
      fullName: "Demo Photographer",
      status: "active",
      department: "schools",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["schedule.read", "time.clock", "trade.request", "media.attach"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissionGrants: [],
      effectiveScopes: ["self_only"],
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
    };

    const tabs = getAvailableTabs(fieldEmployee);
    const sections = getPrimarySections(tabs, true);
    const sectionKeys = sections.map((section) => section.key);

    expect(tabs).toContain("my-work");
    expect(tabs).toContain("calendar");
    expect(tabs).toContain("account");
    expect(tabs).not.toContain("organizations");
    expect(tabs).not.toContain("projects");
    expect(sectionKeys).toContain("home");
    expect(sectionKeys).not.toContain("my-work");
    expect(sectionKeys).not.toContain("needs-attention");
    expect(sectionKeys).toContain("schools");
    expect(sectionKeys).toContain("photography");
    expect(sectionKeys).toContain("contacts");
    expect(sectionKeys).toContain("schedule");
    expect(sectionKeys).toContain("hr-admin");
    expect(sectionKeys).not.toContain("departments");
    expect(sectionKeys).not.toContain("operations");
    expect(sectionKeys).not.toContain("admin");
  });

  it("keeps Accounts as a Directory alias while exposing Directory as the relationship spine", () => {
    const leadershipUser: SessionUser = {
      id: "user-leadership",
      tenantId: "tenant-demo",
      accountId: "account-leadership",
      sessionId: "session-leadership",
      email: "leadership@example.com",
      fullName: "Leadership User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["leadership"],
      permissions: ["dashboard.read", "shoot.read", "schedule.read", "user.read"],
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
    };

    const tabs = getAvailableTabs(leadershipUser);
    const sections = getPrimarySections(tabs, false);
    const sectionKeys = sections.map((section) => section.key);
    const contactsTabs = sections.find((section) => section.key === "contacts")?.tabs ?? [];

    expect(tabs).toContain("organizations");
    expect(tabs).toContain("contacts");
    expect(sectionKeys).toContain("contacts");
    expect(sections.find((section) => section.key === "contacts")?.label).toBe("Directory");
    expect(sectionKeys).not.toContain("operations");
    expect(sectionKeys).not.toContain("directory");
    expect(contactsTabs).toContain("organizations");
    expect(contactsTabs).toContain("contacts");
  });

  it("resolves the new operating-system shell aliases without breaking legacy hashes", () => {
    const tabs = ["dashboard", "my-work", "calendar", "alerts", "approvals", "reports", "projects", "time", "shoots", "compliance", "access", "admin-config", "organizations", "contacts"] as const;
    const availableTabs = [...tabs];

    expect(buildShellRouteHash("people-ops-approvals")).toBe("#approvals");
    expect(buildShellRouteHash("business-health-reports")).toBe("#reports");
    expect(buildShellRouteHash("dashboard-my-day")).toBe("#my-work");
    expect(buildShellRouteHash("dashboard-my-tasks")).toBe("#tasks");
    expect(buildShellRouteHash("exceptions")).toBe("#exceptions");
    expect(buildShellRouteHash("studios")).toBe("#studios");
    expect(buildShellRouteHash("graphics")).toBe("#graphics");
    expect(buildShellRouteHash("directory-accounts")).toBe("#accounts");
    expect(buildShellRouteHash("people-ops")).toBe("#people");
    expect(buildShellRouteHash("files")).toBe("#files");
    expect(buildShellRouteHash("admin-checklists")).toBe("#admin/templates");
    expect(buildShellRouteHash("dashboard-my-schedule")).toBe("#my-schedule");
    expect(buildShellRouteHash("dashboard-alerts")).toBe("#notifications");
    expect(buildShellRouteHash("people-ops-compliance")).toBe("#needs-attention");
    expect(buildShellRouteHash("sports-shoots")).toBe("#sports/jobs");
    expect(buildShellRouteHash("task-new")).toBe("#tasks/new");
    expect(resolveRouteId("#home", availableTabs, false)).toBe("dashboard");
    expect(resolveRouteId("#search", availableTabs, false)).toBe("search");
    expect(resolveRouteId("#my-work", availableTabs, false)).toBe("dashboard-my-day");
    expect(resolveRouteId("#tasks", availableTabs, false)).toBe("dashboard-my-tasks");
    expect(resolveRouteId("#my-schedule", availableTabs, false)).toBe("dashboard-my-schedule");
    expect(resolveRouteId("#notifications", availableTabs, false)).toBe("dashboard-alerts");
    expect(resolveRouteId("#exceptions", availableTabs, false)).toBe("exceptions");
    expect(resolveRouteId("#schools", availableTabs, false)).toBe("operations-schools");
    expect(resolveRouteId("#operations/overview", availableTabs, false)).toBe("operations");
    expect(resolveRouteId("#operations/watch", availableTabs, false)).toBe("operations-exceptions");
    expect(resolveRouteId("#operations/urgent-watch", availableTabs, false)).toBe("operations-exceptions");
    expect(resolveRouteId("#scheduling", availableTabs, false)).toBe("operations-scheduling");
    expect(resolveRouteId("#operations/job-admin", availableTabs, false)).toBe("operations-job-admin");
    expect(resolveRouteId("#leadership", availableTabs, false)).toBe("executive");
    expect(resolveRouteId("#settings", availableTabs, false)).toBe("admin");
    expect(resolveRouteId("#operations/shoots/import", availableTabs, false)).toBe("studios-shoots");
    expect(resolveRouteId("#schedule", availableTabs, false)).toBe("operations-schedule");
    expect(resolveRouteId("#schedule/jobs", availableTabs, false)).toBe("operations-schedule");
    expect(resolveRouteId("#schedule/staffing", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#schedule/assignment-board", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#photography", availableTabs, false)).toBe("studios");
    expect(resolveRouteId("#studios", availableTabs, false)).toBe("studios");
    expect(resolveRouteId("#photography/shoots", availableTabs, false)).toBe("studios-shoots");
    expect(resolveRouteId("#photography/pre-service", availableTabs, false)).toBe("studios-pre-service");
    expect(resolveRouteId("#photography/job-prep", availableTabs, false)).toBe("studios-pre-service");
    expect(resolveRouteId("#studios/job-prep", availableTabs, false)).toBe("studios-pre-service");
    expect(resolveRouteId("#photography/travel", availableTabs, false)).toBe("studios-travel");
    expect(resolveRouteId("#operations/travel", availableTabs, false)).toBe("studios-travel");
    expect(resolveRouteId("#photography/readiness", availableTabs, false)).toBe("studios-readiness");
    expect(resolveRouteId("#photography/staffing", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#photography/calendar", availableTabs, false)).toBe("studios-calendar");
    expect(resolveRouteId("#photography/workload", availableTabs, false)).toBe("studios-workload");
    expect(resolveRouteId("#production", availableTabs, false)).toBe("production");
    expect(resolveRouteId("#production", availableTabs.filter((tab) => tab !== "projects"), false)).toBe("production");
    expect(resolveRouteId("#graphics", availableTabs, false)).toBe("graphics");
    expect(resolveRouteId("#production/queue", availableTabs, false)).toBe("graphics-queue");
    expect(resolveRouteId("#graphics/queue", availableTabs, false)).toBe("graphics-queue");
    expect(resolveRouteId("#graphics/qa", availableTabs, false)).toBe("graphics-qa");
    expect(resolveRouteId("#graphics/release", availableTabs, false)).toBe("graphics-release");
    expect(resolveRouteId("#graphics/workload", availableTabs, false)).toBe("graphics-workload");
    expect(resolveRouteId("#production/digital", availableTabs, false)).toBe("graphics");
    expect(resolveRouteId("#production/review", availableTabs, false)).toBe("people-ops-compliance");
    expect(resolveRouteId("#approvals", availableTabs, false)).toBe("people-ops-approvals");
    expect(resolveRouteId("#settings/access", availableTabs, false)).toBe("admin-roles");
    expect(resolveRouteId("#employees/attendance", availableTabs, false)).toBe("operations-attendance");
    expect(resolveRouteId("#employees/exceptions", availableTabs, false)).toBe("people-exceptions");
    expect(resolveRouteId("#employees/requests", availableTabs, false)).toBe("people-ops-requests");
    expect(resolveRouteId("#needs-attention", availableTabs, false)).toBe("people-ops-compliance");
    expect(resolveRouteId("#compliance", availableTabs, false)).toBe("people-ops-compliance");
    expect(resolveRouteId("#employees/compliance", availableTabs, false)).toBe("people-ops-compliance");
    expect(resolveRouteId("#people-ops/approvals", availableTabs, false)).toBe("people-ops-approvals");
    expect(resolveRouteId("#review-desk", availableTabs, false)).toBe("people-ops-compliance");
    expect(resolveRouteId("#reports", availableTabs, false)).toBe("business-health-reports");
    expect(resolveRouteId("#business-health/reports", availableTabs, false)).toBe("business-health-reports");
    expect(resolveRouteId("#directory/organizations", availableTabs, false)).toBe("directory-accounts");
    expect(resolveRouteId("#accounts", availableTabs, false)).toBe("directory-accounts");
    expect(resolveRouteId("#people", availableTabs, false)).toBe("people-ops");
    expect(resolveRouteId("#dashboard", availableTabs, false)).toBe("dashboard");
    expect(resolveRouteId("#operations/schedule", availableTabs, false)).toBe("operations-schedule");
    expect(resolveRouteId("#jobs", availableTabs, false)).toBe("jobs");
    expect(resolveRouteId("#jobs/new", availableTabs, false)).toBe("job-new");
    expect(resolveRouteId("#jobs/job-1", availableTabs, false)).toBe("job-detail");
    expect(resolveRouteId("#jobs/job-1/edit", availableTabs, false)).toBe("job-edit");
    expect(resolveRouteId("#tasks/new", availableTabs, false)).toBe("task-new");
    expect(resolveRouteId("#tasks/task-1", availableTabs, false)).toBe("task-detail");
    expect(resolveRouteId("#schools/jobs", availableTabs, false)).toBe("schools-jobs");
    expect(resolveRouteId("#schools/tasks", availableTabs, false)).toBe("schools-tasks");
    expect(resolveRouteId("#schools/watchlist", availableTabs, false)).toBe("schools-exceptions");
    expect(resolveRouteId("#schools/exceptions", availableTabs, false)).toBe("schools-exceptions");
    expect(resolveRouteId("#schools/jobs/new", availableTabs, false)).toBe("schools-job-new");
    expect(resolveRouteId("#schools/jobs/job-1", availableTabs, false)).toBe("schools-job-detail");
    expect(resolveRouteId("#schools/jobs/job-1/edit", availableTabs, false)).toBe("schools-job-edit");
    expect(resolveRouteId("#sports/jobs", availableTabs, false)).toBe("sports-shoots");
    expect(resolveRouteId("#sports/jobs/new", availableTabs, false)).toBe("sports-shoot-new");
    expect(resolveRouteId("#sports/jobs/job-1", availableTabs, false)).toBe("sports-shoot-detail");
    expect(resolveRouteId("#sports/jobs/job-1/edit", availableTabs, false)).toBe("sports-shoot-edit");
    expect(resolveRouteId("#sports/shoots", availableTabs, false)).toBe("sports-shoots");
    expect(resolveRouteId("#sports/shoots/new", availableTabs, false)).toBe("sports-shoot-new");
    expect(resolveRouteId("#sports/shoots/job-1", availableTabs, false)).toBe("sports-shoot-detail");
    expect(resolveRouteId("#sports/shoots/job-1/edit", availableTabs, false)).toBe("sports-shoot-edit");
    expect(resolveRouteId("#sports/exceptions", availableTabs, false)).toBe("sports-exceptions");
    expect(resolveRouteId("#sports/graphics", availableTabs, false)).toBe("sports-graphics");
    expect(resolveRouteId("#files", availableTabs, false)).toBe("files");
    expect(resolveRouteId("#admin/templates", availableTabs, false)).toBe("admin-checklists");
  });

  it("keeps the contract-owned sections visible for leadership in the new Mission Control shell", () => {
    const leadershipUser: SessionUser = {
      id: "user-leadership",
      tenantId: "tenant-demo",
      accountId: "account-leadership",
      sessionId: "session-leadership",
      email: "leadership@example.com",
      fullName: "Leadership User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["leadership"],
      permissions: [
        "dashboard.read",
        "shoot.read",
        "schedule.read",
        "user.read",
        "profitability.read",
        "production.read",
        "access.manage"
      ],
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
    };

    const tabs = getAvailableTabs(leadershipUser);
    const sections = getPrimarySections(tabs, false);
    const sectionKeys = sections.map((section) => section.key);
    const photographySection = sections.find((section) => section.key === "photography");
    const productionSection = sections.find((section) => section.key === "production");
    const leadershipSection = sections.find((section) => section.key === "leadership");

    expect(tabs).toContain("projects");
    expect(tabs).toContain("profitability");
    expect(sectionKeys).toEqual([
      "home",
      "schools",
      "sports",
      "photography",
      "production",
      "project-tracking",
      "jobs",
      "contacts",
      "schedule",
      "hr-admin",
      "leadership",
      "settings",
      "admin"
    ]);
    expect(photographySection?.label).toBe("Photography");
    expect(productionSection?.label).toBe("Production");
    expect(productionSection?.routeId).toBe("production");
    expect(sections.find((section) => section.key === "needs-attention")).toBeUndefined();
    expect(sections.find((section) => section.key === "contacts")?.label).toBe("Directory");
    expect(leadershipSection?.childRouteIds).toContain("growth");
    expect(leadershipSection?.childRouteIds).toContain("business-health-reports");
    expect(leadershipSection?.childRouteIds).not.toContain("people-ops-performance");
  });

  it("orders the primary shell sections in the Mission Control hierarchy", () => {
    const leadershipUser: SessionUser = {
      id: "user-leadership-shell",
      tenantId: "tenant-demo",
      accountId: "account-leadership-shell",
      sessionId: "session-leadership-shell",
      email: "leadership-shell@example.com",
      fullName: "Leadership Shell",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["leadership"],
      permissions: ["dashboard.read", "shoot.read", "schedule.read", "production.read", "user.read", "reports.read", "notification.read", "access.manage"],
      authorityTier: "leadership",
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      sessionTrust
    };

    const sections = getPrimarySections(getAvailableTabs(leadershipUser), false).map((section) => section.key);

    expect(sections).toEqual([
      "home",
      "schools",
      "sports",
      "photography",
      "production",
      "project-tracking",
      "jobs",
      "contacts",
      "schedule",
      "hr-admin",
      "leadership",
      "settings",
      "admin"
    ]);
  });

  it("shows a simple bottom nav for narrow field users and keeps More separate from the main tabs", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 860px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as typeof window.matchMedia;

    const fieldEmployee: SessionUser = {
      id: "user-photo",
      tenantId: "tenant-demo",
      accountId: "account-photo",
      sessionId: "session-photo",
      email: "photo@example.com",
      fullName: "Demo Photographer",
      status: "active",
      department: "schools",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["schedule.read", "time.clock", "trade.request", "media.attach", "notification.read"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissionGrants: [],
      effectiveScopes: ["self_only"],
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
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: fieldEmployee };
      }
      if (typeof path === "string" && path.startsWith("/api/employee/my-work?anchor_date=")) {
        // Employee Home IS live My Work now (MC-AUDIT-003), so the payload must
        // carry the full contract shape — the page reads every list below.
        return {
          anchor_date: "2026-03-30",
          window_end_date: "2026-04-06",
          summary: {
            shifts_today: 1,
            upcoming_shifts: 0,
            pending_trade_requests: 0,
            unread_notifications: 0,
            clocked_in_shift_count: 0,
            attention_needed_count: 0,
            closeout_due_count: 0,
            late_or_exception_count: 0,
            mileage_review_count: 0,
            next_shift_label: "Next call at 8:00 AM",
            assigned_task_count: 0,
            live_workflow_step_count: 0,
            acknowledgement_count: 0,
            owned_exception_count: 0,
            approval_waiting_count: 0,
            recent_change_count: 0,
            next_event_label: null
          },
          shifts: [],
          notifications: [],
          jobs: [],
          live_workflow_steps: [],
          events: [],
          tasks: [],
          acknowledgements: [],
          exceptions: [],
          approvals: [],
          recent_changes: []
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    window.localStorage.setItem("pmc_admin_token", "mobile-token");

    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My Work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Requests" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByText("Additional destinations")).toBeInTheDocument();
    expect(screen.getAllByText("My Work").length).toBeGreaterThan(0);
  });

  it("opens Kemmetmueller Concierge from the global keyboard shortcut", async () => {
    const searchUser: SessionUser = {
      id: "user-search",
      tenantId: "tenant-demo",
      accountId: "account-search",
      sessionId: "session-search",
      email: "search@example.com",
      fullName: "Search User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["manager"],
      permissions: ["dashboard.read", "schedule.read"],
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "operations_manager",
      jobFunctionProfiles: ["operations_manager"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      sessionTrust
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: searchUser };
      }
      if (path === "/api/concierge/recent") {
        return {
          product_name: "Kemmetmueller Concierge",
          recent_searches: [],
          took_ms: 2
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    window.localStorage.setItem("pmc_admin_token", "search-token");
    window.location.hash = "#search";

    render(<App />);

    expect(await screen.findByRole("searchbox", { name: /ask concierge anything/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Kemmetmueller Concierge" })).toBeInTheDocument();
    });
    expect(window.location.hash).toBe("#search");
  });

  it("boots into the focused Teams home when the personal tab is loaded without a hash", async () => {
    const teamsUser: SessionUser = {
      id: "user-teams",
      tenantId: "tenant-demo",
      accountId: "account-teams",
      sessionId: "session-teams",
      email: "teams.user@example.com",
      fullName: "Teams User",
      status: "active",
      department: "schools",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["photographer"],
      permissions: ["schedule.read"],
      authorityTier: "standard_employee",
      primaryJobFunctionProfile: "associate_photographer",
      jobFunctionProfiles: ["associate_photographer"],
      permissionGrants: [],
      effectiveScopes: ["self_only"],
      sessionTrust: {
        ...sessionTrust,
        identityProvider: "microsoft_entra",
        requestTransport: "cookie"
      }
    };

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user: teamsUser };
      }
      if (path.startsWith("/api/employee/my-work?anchor_date=")) {
        return {
          anchor_date: "2026-04-03",
          window_end_date: "2026-04-10",
          summary: {
            shifts_today: 1,
            upcoming_shifts: 2,
            pending_trade_requests: 0,
            unread_notifications: 1,
            clocked_in_shift_count: 0,
            attention_needed_count: 1,
            closeout_due_count: 0,
            late_or_exception_count: 0,
            mileage_review_count: 0,
            next_shift_label: "North Gym at 8:00 AM"
          },
          shifts: [
            {
              id: "shift-1",
              shoot_id: "shoot-1",
              shoot_code: "SCH-100",
              shoot_title: "North Prep Day",
              shoot_date: "2026-04-03",
              title: "Lead Photographer",
              shift_kind: "field",
              status: "assigned",
              staffing_role: "Lead Photographer",
              satisfies_lead_coverage: true,
              starts_at: "2026-04-03T13:00:00.000Z",
              ends_at: "2026-04-03T18:00:00.000Z",
              location_name: "North Gym",
              has_pre_service_notes: true,
              notes_acknowledged: false,
              trade_request_count: 0,
              open_exception_count: 0
            }
          ],
          notifications: [
            {
              id: "notification-1",
              notification_type: "approval",
              channel: "in_app",
              priority: "high",
              status: "unread",
              title: "Roster update needed",
              body: "Double-check the roster before call time.",
              deep_link: "#notifications",
              created_at: "2026-04-03T12:30:00.000Z"
            }
          ]
        };
      }
      throw new Error(`Unexpected app call: ${path}`);
    });

    window.localStorage.setItem("pmc_admin_token", "teams-token");
    window.history.replaceState(null, "", "/?teams=1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Employee Home" })).toBeInTheDocument();
    expect(await screen.findByText("My Jobs / Assignments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Full App" })).toBeInTheDocument();
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#teams/home");
  });
});
