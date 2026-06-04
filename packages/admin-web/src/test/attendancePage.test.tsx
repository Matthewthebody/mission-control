// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Attendance } from "../pages/Attendance";
import type { OperationsDashboard, SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args)
}));

vi.mock("../components/attendance/AttendanceOperationsPanel", () => ({
  AttendanceOperationsPanel: () => <div data-testid="attendance-operations-panel">Attendance operations panel</div>
}));

const currentUser: SessionUser = {
  id: "user-manager",
  tenantId: "tenant-demo",
  accountId: "account-manager",
  sessionId: "session-demo",
  email: "manager@example.com",
  fullName: "Demo Manager",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: ["attendance.read", "attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
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

const dashboardResponse = {
  summary: {
    scheduled_employees: 8,
    clocked_in_employees: 6,
    late_employees: 1,
    no_shows: 0,
    missed_punch_count: 2,
    missed_clock_out_count: 1,
    unscheduled_punches: 0,
    out_of_bounds_punches: 1,
    no_show_suspected_count: 1,
    break_override_count: 0
  },
  notifications: [],
  shoots: [],
  shifts: [],
  reporting: {
    labor: [],
    punches: [],
    exceptions: [],
    payroll: []
  },
  generated_at: "2026-03-31T14:00:00.000Z",
  date: "2026-03-31"
} as unknown as OperationsDashboard;

describe("Attendance page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/attendance/exceptions?")) {
        return [];
      }
      if (path === "/api/notifications") {
        return [];
      }
      if (path.startsWith("/api/dashboard/operations?date=")) {
        return dashboardResponse;
      }
      throw new Error(`Unexpected Attendance call: ${path}`);
    });
  });

  it("keeps Attendance focused on live operations and does not fetch duplicate compliance review payloads", async () => {
    render(<Attendance token="token" currentUser={currentUser} socket={null} />);

    expect(await screen.findByText("Attendance Operating System")).toBeInTheDocument();
    expect(screen.getByText("Leadership Attendance Review")).toBeInTheDocument();
    expect(screen.getByText(/Employees should start from Home or My Work/i)).toBeInTheDocument();
    expect(screen.getByText("Attendance operations panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Compliance Review" })).toHaveAttribute("href", "#employees/compliance");
    expect(screen.getByRole("link", { name: "Open Payroll Review" })).toHaveAttribute("href", "#employees/payroll");

    expect(screen.queryByText("Compliance Snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("Mileage Review")).not.toBeInTheDocument();
    expect(screen.queryByText("Payroll Rollup")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Labor" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(3);
    });

    const requestedPaths = apiFetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedPaths).not.toContain("/api/attendance/compliance-review");
    expect(requestedPaths).not.toContain("/api/attendance/mileage-reimbursements");
    expect(requestedPaths).not.toContain("/api/attendance/payroll-summary");
  });
});
