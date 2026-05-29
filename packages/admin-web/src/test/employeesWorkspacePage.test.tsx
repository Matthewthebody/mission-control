// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeesWorkspace } from "../pages/EmployeesWorkspace";
import type { EmployeesWorkspaceResponse } from "../services/employeesWorkspace";
import type { SessionUser } from "../types";

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

const managerUser: SessionUser = {
  ...employeeUser,
  id: "user-manager",
  accountId: "account-manager",
  sessionId: "session-manager",
  email: "manager@example.com",
  fullName: "Manager Demo",
  department: "operations",
  roles: ["manager"],
  permissions: [
    "schedule.read",
    "time.clock",
    "training.view",
    "requests.view",
    "approval.read",
    "pto.approve",
    "trade.approve",
    "dashboard.read"
  ],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "operations_manager",
  jobFunctionProfiles: ["operations_manager"],
  effectiveScopes: ["department_scope"]
};

const adminUser: SessionUser = {
  ...managerUser,
  id: "user-admin",
  accountId: "account-admin",
  sessionId: "session-admin",
  email: "admin@example.com",
  fullName: "Admin Demo",
  roles: ["leadership"],
  permissions: [...managerUser.permissions, "reports.view", "labor.read", "attendance.read"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  effectiveScopes: ["organization_wide_scope"]
};

const employeePayload: EmployeesWorkspaceResponse = {
  generated_at: "2026-03-31T15:00:00.000Z",
  anchor_date: "2026-03-31",
  refresh_interval_seconds: 90,
  role_mode: "employee",
  summary_strip: [
    {
      id: "requests_awaiting_action",
      label: "My Requests",
      count: 2,
      detail: "2 requests still need follow-through.",
      tone: "warning",
      action_hash: "#employees/requests"
    },
    {
      id: "time_review_status",
      label: "Time / Pay Review",
      count: 1,
      detail: "Punch In Needed. 1 time review item is open.",
      tone: "warning",
      action_hash: "#dashboard/my-day"
    }
  ],
  my_work: {
    visible: true,
    headline: "My Work / My Day",
    summary_line: "See today's assignment picture and where to open the full employee work surface.",
    cards: [
      {
        id: "today",
        label: "Today",
        count: 2,
        detail: "Published assignments are on your board.",
        tone: "info",
        action_hash: "#dashboard/my-day"
      }
    ],
    highlights: [
      {
        id: "shift-1",
        eyebrow: "SPRING-001",
        title: "Spring Portrait Day",
        summary: "8:00 AM - 11:00 AM | Main Gym",
        status_label: "Ready To Shoot",
        tone: "info",
        action_hash: "#dashboard/my-day"
      }
    ],
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
    summary_line: "1 time review item is open.",
    helper_text: "Shift starts in 10m at Main Gym.",
    elapsed_label: null,
    shift_label: "Spring Portrait Day",
    location_label: "Main Gym",
    review_label: "Missed clock-in request still open.",
    action_hash: "#dashboard/my-day",
    action_label: "Open My Day",
    schedule_hash: "#schedule",
    secondary_action_hash: null,
    secondary_action_label: null,
    metrics: [
      {
        id: "time_review",
        label: "Review Open",
        count: 1,
        detail: "Missed punch or review items still need follow-through.",
        tone: "warning",
        action_hash: "#dashboard/my-day"
      }
    ]
  },
  requests_approvals: {
    visible: true,
    headline: "Requests / Approvals / Availability",
    summary_line: "Your request queue still has active items.",
    cards: [
      {
        id: "my_requests",
        label: "My Open Requests",
        count: 2,
        detail: "2 requests still need follow-through.",
        tone: "warning",
        action_hash: "#employees/requests"
      }
    ],
    highlights: [],
    primary_action_hash: "#approvals",
    primary_action_label: "Open Approvals",
    secondary_action_hash: "#employees/requests",
    secondary_action_label: "Open Requests"
  },
  training_readiness: {
    visible: true,
    headline: "Training / Readiness / Certifications",
    summary_line: "Training and readiness are clear right now.",
    cards: [
      {
        id: "training_due",
        label: "Training Due",
        count: 0,
        detail: "Required training looks clear right now.",
        tone: "success",
        action_hash: "#employees/training"
      }
    ],
    highlights: [],
    primary_action_hash: "#employees/training",
    primary_action_label: "Open Training",
    secondary_action_hash: "#employees/readiness",
    secondary_action_label: "Open Readiness"
  },
  record: {
    visible: true,
    headline: "Personal / Employee Record",
    summary_line: "Keep profile basics and people-system links calm and secondary.",
    items: [
      { label: "Name", value: "Employee Demo" },
      { label: "Department", value: "Schools" }
    ],
    links: [{ label: "Open My Account", action_hash: "#account" }]
  }
};

const managerPayload: EmployeesWorkspaceResponse = {
  ...employeePayload,
  role_mode: "manager",
  summary_strip: [
    {
      id: "requests_awaiting_action",
      label: "Requests Awaiting Action",
      count: 5,
      detail: "5 requests still need follow-through.",
      tone: "critical",
      action_hash: "#employees/requests"
    },
    {
      id: "approvals_awaiting_me",
      label: "Approvals Awaiting Me",
      count: 3,
      detail: "3 approvals are sitting on you.",
      tone: "warning",
      action_hash: "#approvals"
    }
  ],
  requests_approvals: {
    ...employeePayload.requests_approvals!,
    summary_line: "Requests and people-facing approvals still need follow-through.",
    cards: [
      {
        id: "awaiting_my_approval",
        label: "Awaiting My Approval",
        count: 3,
        detail: "3 people-facing approvals are still waiting on you.",
        tone: "warning",
        action_hash: "#approvals"
      }
    ],
    highlights: [
      {
        id: "approval-1",
        eyebrow: "Missed Punch",
        title: "Corrected clock-in for Jamie Doe",
        summary: "Correction request is waiting on approval.",
        status_label: "Pending",
        tone: "warning",
        action_hash: "#approvals"
      }
    ]
  }
};

const adminPayload: EmployeesWorkspaceResponse = {
  ...managerPayload,
  role_mode: "admin",
  summary_strip: [
    ...managerPayload.summary_strip,
    {
      id: "training_due",
      label: "Training Due",
      count: 4,
      detail: "4 training requirements still need attention.",
      tone: "critical",
      action_hash: "#employees/training"
    }
  ],
  record: {
    ...employeePayload.record!,
    links: [
      { label: "Open My Account", action_hash: "#account" },
      { label: "Open Payroll Review", action_hash: "#employees/payroll" }
    ]
  }
};

describe("Employees workspace", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.location.hash = "#employees";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the employee workspace with a read-only canonical time band and safe schedule deep links", async () => {
    apiFetchMock.mockResolvedValue(employeePayload);

    render(<EmployeesWorkspace token="token-demo" currentUser={employeeUser} socket={null} />);

    expect(await screen.findByText("Stay ahead of your people-side work")).toBeInTheDocument();
    expect(screen.getByText("My Work / My Day")).toBeInTheDocument();
    expect(screen.getByText("Time / Pay / Review")).toBeInTheDocument();
    expect(screen.getAllByText("Punch In Needed")).toHaveLength(2);
    expect(screen.getByText(/still the live punch surface/i)).toBeInTheDocument();
    expect(screen.queryByText("Urgent Watch")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Open Schedule" })[0]);
    await waitFor(() => {
      expect(window.location.hash).toBe("#schedule");
    });
  });

  it("renders manager-facing request pressure without turning Employees into Operations", async () => {
    apiFetchMock.mockResolvedValue(managerPayload);

    render(<EmployeesWorkspace token="token-demo" currentUser={managerUser} socket={null} />);

    expect(await screen.findByText("Run the people side of the day")).toBeInTheDocument();
    expect(screen.getByText("Requests Awaiting Action")).toBeInTheDocument();
    expect(screen.getByText("Approvals Awaiting Me")).toBeInTheDocument();
    expect(screen.getByText("Awaiting My Approval")).toBeInTheDocument();
    expect(screen.queryByText("Run the live day")).not.toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/dashboard\/employees\/workspace\?date=\d{4}-\d{2}-\d{2}$/),
      "token-demo"
    );
  });

  it("renders the admin workspace with elevated people links without creating a second payroll system", async () => {
    apiFetchMock.mockResolvedValue(adminPayload);

    render(<EmployeesWorkspace token="token-demo" currentUser={adminUser} socket={null} />);

    expect(await screen.findByText("Run the people side of the day")).toBeInTheDocument();
    expect(screen.getAllByText("Training Due").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open Payroll Review" })).toBeInTheDocument();
    expect(screen.queryByText("Urgent Watch")).not.toBeInTheDocument();
  });
});
