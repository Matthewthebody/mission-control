// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffAssignmentBoard } from "../pages/StaffAssignmentBoard";
import type { SessionUser, StaffingDashboardResponse } from "../types";

const getStaffingDashboardMock = vi.fn();
const getShootStaffingSnapshotMock = vi.fn();

vi.mock("../services/scheduleStaffing", () => ({
  getStaffingDashboard: (...args: unknown[]) => getStaffingDashboardMock(...args),
  // Keep the embedded staffing command in a loading state so this test stays focused on the board.
  getShootStaffingSnapshot: (...args: unknown[]) => getShootStaffingSnapshotMock(...args),
  assignShootStaffingSlot: vi.fn(),
  removeShootStaffingAssignment: vi.fn(),
  publishShootStaffing: vi.fn()
}));

afterEach(() => {
  cleanup();
  getStaffingDashboardMock.mockReset();
  getShootStaffingSnapshotMock.mockReset();
});

const dashboard: StaffingDashboardResponse = {
  anchor_date: "2026-05-01",
  summary: {
    shoots_today: 3,
    shoots_tomorrow: 1,
    open_staffing_slots: 4,
    shoots_missing_lead: 1,
    understaffed_shoots: 2,
    conflict_warnings: 1,
    available_staff_today: 6,
    unavailable_staff_today: 2
  },
  open_coverage: [
    {
      shoot_id: "shoot-1",
      shoot_code: "S1",
      title: "Wayzata Picture Day",
      shoot_date: "2026-05-01",
      department: "schools",
      location_label: "Wayzata High School",
      time_label: "8:00 AM - 12:00 PM",
      assigned_staff_count: 1,
      planned_staff_count: 3,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_present: false,
      lead_name: null,
      missing_lead: true,
      under_staffed: true,
      conflict_warning_count: 1,
      sync_state: "clean",
      next_action: "Assign 2 more photographers"
    }
  ],
  missing_lead: [],
  availability_groups: [
    {
      key: "available",
      label: "Available",
      count: 1,
      staff: [
        {
          user_id: "u1",
          name: "Sam Carter",
          title: "Photographer",
          status: "available",
          current_assignment: null,
          time_window: "All day",
          quick_note: null,
          lead_qualified: true
        }
      ]
    }
  ]
};

function buildUser(): SessionUser {
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
  };
}

describe("StaffAssignmentBoard", () => {
  it("renders a date-first staffing board and opens a real assignment drawer on card click", async () => {
    getStaffingDashboardMock.mockResolvedValue(dashboard);
    getShootStaffingSnapshotMock.mockImplementation(() => new Promise(() => {}));

    render(<StaffAssignmentBoard token="token" currentUser={buildUser()} socket={null} />);

    expect(await screen.findByRole("heading", { name: "Staff Assignment Board" })).toBeInTheDocument();

    // Summary + a real coverage card with computed gap.
    expect(screen.getByText("Open slots")).toBeInTheDocument();
    const card = await screen.findByRole("button", { name: /Wayzata Picture Day/i });
    expect(card).toBeInTheDocument();
    expect(screen.getByText("1 of 3 positions filled")).toBeInTheDocument();
    expect(screen.getByText("2 open")).toBeInTheDocument();
    expect(screen.getByText("Lead still required")).toBeInTheDocument();
    expect(screen.getByText("1 schedule overlap")).toBeInTheDocument();

    // Availability rail is real data.
    expect(screen.getByText("Sam Carter")).toBeInTheDocument();

    // Clicking the card opens the real assignment drawer (not a dead button).
    fireEvent.click(card);
    expect(screen.getByText("Assign staff")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});
