// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Operations } from "../pages/Operations";
import type { OperationsControlRoomResponse, SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

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
  permissions: ["dashboard.read", "shoot.read", "schedule.read", "attendance.read", "attendance.manage", "alerts.read"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "operations_manager",
  jobFunctionProfiles: ["operations_manager"],
  permissionGrants: [],
  effectiveScopes: ["department_scope"],
  sessionTrust
};

const fieldUser: SessionUser = {
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
  sessionTrust
};

const payload: OperationsControlRoomResponse = {
  generated_at: "2026-03-31T14:00:00.000Z",
  anchor_date: "2026-03-31",
  refresh_interval_seconds: 60,
  summary_band: [
    {
      id: "active_red_watch",
      label: "Active Red",
      count: 2,
      detail: "Unsafe live work needs action now.",
      tone: "critical",
      action_hash: "#operations/exceptions"
    },
    {
      id: "staffing_gaps",
      label: "Staffing Gaps",
      count: 4,
      detail: "Coverage is still open.",
      tone: "warning",
      action_hash: "#operations/staffing?area=staffing"
    }
  ],
  urgent_watch: {
    generated_at: "2026-03-31T14:00:00.000Z",
    headline: "Exceptions",
    summary_line: "2 blocking exceptions need action now.",
    action_hash: "#operations/exceptions",
    items: [
      {
        id: "watch-1",
        eyebrow: "Scheduling",
        title: "DEMO-001 is missing lead coverage",
        summary: "Lead coverage is still open for tomorrow morning.",
        owner_label: "Needs owner",
        status_label: "Red Critical Role Gap",
        tone: "critical",
        meta: [{ label: "Overdue by 2h", tone: "critical" }],
        flags: [{ label: "schools", tone: "neutral" }],
        next_action: "Open Scheduling",
        action_hash: "#scheduling?shoot=shoot-1"
      }
    ]
  },
  staffing_pressure: {
    generated_at: "2026-03-31T14:00:00.000Z",
    headline: "Staffing / Schedule Pressure",
    summary_line: "4 open slots, 1 missing lead, 1 unconfirmed shoot.",
    action_hash: "#operations/staffing?area=staffing",
    metrics: [
      {
        id: "critical_role_gaps",
        label: "Critical Role Gaps",
        count: 1,
        detail: "Lead-qualified coverage is still open.",
        tone: "critical",
        action_hash: "#operations/staffing?area=staffing"
      }
    ],
    items: [
      {
        id: "shoot-1",
        eyebrow: "schools | 2026-03-31",
        title: "Spring Portrait Day",
        summary: "8:00 AM - 11:00 AM | Main Gym",
        owner_label: "Lead still open",
        status_label: "Missing lead",
        tone: "critical",
        meta: [{ label: "Critical Shoot", tone: "critical" }],
        flags: [{ label: "Sync Review", tone: "warning" }],
        next_action: "Assign a lead-qualified photographer",
        action_hash: "#operations/staffing?area=staffing&date=2026-03-31&shoot=shoot-1"
      }
    ]
  },
  attendance_impact: {
    generated_at: "2026-03-31T14:00:00.000Z",
    headline: "Attendance Impact",
    summary_line: "1 unresolved attendance item is affecting coverage.",
    action_hash: "#operations/attendance",
    metrics: [
      {
        id: "coverage_impact",
        label: "Coverage Impact",
        count: 1,
        detail: "Attendance failures are already reducing coverage.",
        tone: "critical",
        action_hash: "#operations/attendance"
      }
    ],
    items: [
      {
        id: "shift-1",
        eyebrow: "White Bear Lake",
        title: "Jamie Doe - Lead Coverage",
        summary: "8:00 AM - 12:00 PM | Main Gym",
        owner_label: "Manager Demo",
        status_label: "Unresolved No Check In",
        tone: "critical",
        meta: [{ label: "Coverage risk", tone: "critical" }],
        flags: [{ label: "Late", tone: "warning" }],
        next_action: "Open Scheduling",
        action_hash: "#operations/attendance"
      }
    ]
  },
  live_execution: {
    generated_at: "2026-03-31T14:00:00.000Z",
    headline: "Live Shoot Execution / Readiness / Travel / Exceptions",
    summary_line: "1 shoot needs review and 1 is still incomplete.",
    routes: [
      {
        id: "shoots",
        title: "Shoots Queue",
        count: 4,
        summary: "1 needs review and 1 is incomplete.",
        tone: "warning",
        action_hash: "#operations/shoots"
      },
      {
        id: "exceptions",
        title: "Exceptions",
        count: 2,
        summary: "Blocking or overdue exception work still needs decisions.",
        tone: "warning",
        action_hash: "#operations/exceptions?area=exceptions"
      }
    ],
    ready_signals: [
      {
        id: "shoot-1",
        shoot_code: "DEMO-001",
        title: "Spring Portrait Day",
        status_label: "Lead ready overdue",
        tone: "warning",
        detail: "Lead-ready confirmation reminder is due before execution trust slips.",
        confirmed_at: null,
        confirmed_by_label: null,
        action_hash: "#operations/shoots?date=2026-03-31&shoot=shoot-1"
      }
    ],
    items: [
      {
        id: "shoot-1-live",
        eyebrow: "Needs Review",
        title: "Spring Portrait Day",
        summary: "8:00 AM - 11:00 AM | Main Gym",
        owner_label: "Lead Photographer",
        status_label: "Needs Review",
        tone: "warning",
        meta: [{ label: "Staff 2/3", tone: "warning" }],
        flags: [{ label: "Lead ready overdue", tone: "critical" }],
        next_action: "Open shoot queue",
        action_hash: "#operations/shoots?date=2026-03-31&shoot=shoot-1"
      }
    ]
  },
  recent_activity: {
    generated_at: "2026-03-31T14:00:00.000Z",
    headline: "Recent Operational Updates",
    summary_line: "Recent changes across watch, staffing, attendance, and approvals.",
    items: [
      {
        id: "history-1",
        module_label: "Attendance",
        summary: "Manager marked a shift as called out.",
        actor_label: "Manager Demo",
        created_at: "2026-03-31T13:55:00.000Z",
        action_hash: "#operations/attendance"
      }
    ]
  }
};

describe("Operations control room", () => {
  beforeEach(() => {
    window.location.hash = "#operations";
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders exceptions first and hydrates from the single control-room endpoint", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/dashboard/operations/control-room?date=")) {
        return Promise.resolve(payload);
      }
      throw new Error(`Unhandled request: ${path}`);
    });

    render(<Operations token="token-demo" currentUser={managerUser} socket={null} />);

    const urgentHeading = await screen.findByRole("heading", { name: "Exceptions" });
    const staffingHeading = await screen.findByText("Staffing / Schedule Pressure", { selector: "strong" });
    const attendanceHeading = await screen.findByText("Attendance Impact", { selector: "strong" });

    expect(screen.getByText("Same-day live control room")).toBeInTheDocument();
    expect(screen.getByText("Ready to Shoot")).toBeInTheDocument();
    expect(urgentHeading.compareDocumentPosition(staffingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(staffingHeading.compareDocumentPosition(attendanceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/dashboard\/operations\/control-room\?date=/), "token-demo");
  });

  it("deep-links into owning workspaces instead of embedding duplicate queues", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/dashboard/operations/control-room?date=")) {
        return Promise.resolve(payload);
      }
      throw new Error(`Unhandled request: ${path}`);
    });

    render(<Operations token="token-demo" currentUser={managerUser} socket={null} />);

    fireEvent.click(await screen.findByRole("button", { name: /open full exceptions queue/i }));
    expect(window.location.hash).toBe("#operations/exceptions");

    fireEvent.click(screen.getAllByRole("button", { name: /critical role gaps/i })[0]);
    expect(window.location.hash).toBe("#operations/staffing?area=staffing");

    fireEvent.click(screen.getByRole("button", { name: /shoots queue/i }));
    expect(window.location.hash).toBe("#operations/shoots");

    fireEvent.click(screen.getByRole("button", { name: "Open Compliance" }));
    expect(window.location.hash).toBe("#employees/compliance");
  });

  it("shows an employee-safe fallback instead of a manager control room", async () => {
    render(<Operations token="token-demo" currentUser={fieldUser} socket={null} />);

    expect(screen.getByText("Operations Control Room")).toBeInTheDocument();
    expect(screen.getByText(/Operations is for live day-of coordination/i)).toBeInTheDocument();
    expect(screen.queryByText("Exceptions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Schedule" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#schedule");
    });
  });
});
