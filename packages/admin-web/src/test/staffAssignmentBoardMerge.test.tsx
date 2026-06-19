// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import type { SessionUser, ShootStaffingSnapshot, StaffingDashboardResponse } from "../types";

const getStaffingDashboardMock = vi.fn();
const { drawerState } = vi.hoisted(() => ({ drawerState: { snapshot: null as ShootStaffingSnapshot | null } }));

vi.mock("../services/scheduleStaffing", () => ({
  getStaffingDashboard: (...args: unknown[]) => getStaffingDashboardMock(...args),
  getShootStaffingSnapshot: () => new Promise(() => {}),
  assignShootStaffingSlot: vi.fn(),
  removeShootStaffingAssignment: vi.fn(),
  publishShootStaffing: vi.fn()
}));

// Drive the board's onUpdated/onError directly to isolate the merge wiring.
vi.mock("../components/ShootStaffingCommand", () => ({
  ShootStaffingCommand: (props: {
    onUpdated?: (snapshot: ShootStaffingSnapshot) => void;
    onError?: (message: string) => void;
  }) => (
    <div data-testid="drawer-mock">
      <button type="button" onClick={() => props.onUpdated?.(drawerState.snapshot as ShootStaffingSnapshot)}>
        mock-assign
      </button>
      <button type="button" onClick={() => props.onError?.("Persist failed")}>
        mock-error
      </button>
    </div>
  )
}));

import { StaffAssignmentBoard } from "../pages/StaffAssignmentBoard";

afterEach(() => {
  cleanup();
  getStaffingDashboardMock.mockReset();
  drawerState.snapshot = null;
});

const dashboard: StaffingDashboardResponse = {
  anchor_date: "2026-05-01",
  summary: {
    shoots_today: 1,
    shoots_tomorrow: 0,
    open_staffing_slots: 2,
    shoots_missing_lead: 1,
    understaffed_shoots: 1,
    conflict_warnings: 0,
    available_staff_today: 4,
    unavailable_staff_today: 1
  },
  open_coverage: [
    {
      shoot_id: "shoot-1",
      shoot_code: "S1",
      title: "Wayzata Picture Day",
      shoot_date: "2026-05-01",
      department: "schools",
      location_label: "Wayzata HS",
      time_label: "8-12",
      assigned_staff_count: 1,
      planned_staff_count: 3,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_present: false,
      lead_name: null,
      missing_lead: true,
      under_staffed: true,
      conflict_warning_count: 0,
      sync_state: "clean",
      next_action: "Assign 2 more"
    }
  ],
  missing_lead: [],
  availability_groups: []
};

function snapshot(shoot: Partial<ShootStaffingSnapshot["shoot"]>): ShootStaffingSnapshot {
  return {
    shoot: {
      id: "shoot-1",
      shoot_code: "S1",
      title: "Wayzata Picture Day",
      shoot_date: "2026-05-01",
      department: "schools",
      location_name: "Wayzata HS",
      location_address: null,
      planned_staff_count: 3,
      minimum_staff_count: 2,
      assigned_staff_count: 1,
      required_lead_count: 1,
      lead_coverage_count: 0,
      lead_name: null,
      conflict_warning_count: 0,
      draft_shift_count: 1,
      published_shift_count: 0,
      schedule_sync_state: "clean",
      ...shoot
    }
  } as unknown as ShootStaffingSnapshot;
}

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
    permissions: ["dashboard.read", "schedule.read", "schedule.manage"],
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

function summaryTileValue(label: string): string {
  const tile = screen.getByText(label).closest(".staff-board__summary-tile") as HTMLElement;
  return within(tile).getByText(/^\d+$/).textContent ?? "";
}

describe("StaffAssignmentBoard merge coherence", () => {
  it("merges the mutation snapshot into the board without another GET (lead clears, name + counts update)", async () => {
    getStaffingDashboardMock.mockResolvedValue(dashboard);
    render(<StaffAssignmentBoard token="token" currentUser={buildUser()} socket={null} />);

    const card = await screen.findByRole("button", { name: /Wayzata Picture Day/i });
    expect(within(card).getByText("1 of 3 positions filled")).toBeInTheDocument();
    expect(within(card).getByText("Lead still required")).toBeInTheDocument();
    expect(summaryTileValue("Missing lead")).toBe("1");
    expect(getStaffingDashboardMock).toHaveBeenCalledTimes(1);

    fireEvent.click(card);
    // A qualified lead is assigned (draft): assigned 2/3, lead covered by Sarah.
    drawerState.snapshot = snapshot({ assigned_staff_count: 2, lead_coverage_count: 1, lead_name: "Sarah" });
    fireEvent.click(screen.getByRole("button", { name: "mock-assign" }));

    const updated = screen.getByRole("button", { name: /Wayzata Picture Day/i });
    expect(within(updated).getByText("2 of 3 positions filled")).toBeInTheDocument();
    expect(within(updated).getByText("Lead: Sarah")).toBeInTheDocument();
    expect(within(updated).queryByText("Lead still required")).toBeNull();
    expect(summaryTileValue("Missing lead")).toBe("0");
    // The merge is authoritative — no second dashboard GET was required to update the board.
    expect(getStaffingDashboardMock).toHaveBeenCalledTimes(1);
  });

  it("a failed mutation surfaces an error and leaves no false optimistic staffing state", async () => {
    getStaffingDashboardMock.mockResolvedValue(dashboard);
    render(<StaffAssignmentBoard token="token" currentUser={buildUser()} socket={null} />);

    const card = await screen.findByRole("button", { name: /Wayzata Picture Day/i });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: "mock-error" }));

    expect(screen.getByText("Persist failed")).toBeInTheDocument();
    // The card still shows the pre-mutation truth — no fabricated success state.
    const stillThere = screen.getByRole("button", { name: /Wayzata Picture Day/i });
    expect(within(stillThere).getByText("1 of 3 positions filled")).toBeInTheDocument();
    expect(within(stillThere).getByText("Lead still required")).toBeInTheDocument();
  });

  it("a slower earlier GET in flight cannot overwrite a newer mutation merge", async () => {
    let resolveStale: (value: StaffingDashboardResponse) => void = () => {};
    getStaffingDashboardMock
      .mockResolvedValueOnce(dashboard)
      .mockImplementationOnce(
        () => new Promise<StaffingDashboardResponse>((resolve) => { resolveStale = resolve; })
      );

    let scheduleHandler: (() => void) | null = null;
    const socket = {
      on: (event: string, handler: () => void) => {
        if (event === "schedule_changed") scheduleHandler = handler;
      },
      off: () => {}
    } as unknown as Socket;

    render(<StaffAssignmentBoard token="token" currentUser={buildUser()} socket={socket} />);
    const card = await screen.findByRole("button", { name: /Wayzata Picture Day/i });
    fireEvent.click(card);

    // A background reconcile (socket-triggered) is now in flight with the OLD payload.
    act(() => {
      scheduleHandler?.();
    });

    // A newer mutation merges after that GET started.
    drawerState.snapshot = snapshot({ assigned_staff_count: 2, lead_coverage_count: 1, lead_name: "Sarah" });
    fireEvent.click(screen.getByRole("button", { name: "mock-assign" }));
    expect(
      within(screen.getByRole("button", { name: /Wayzata Picture Day/i })).getByText("Lead: Sarah")
    ).toBeInTheDocument();

    // The stale GET resolves with the older payload — it must NOT revert the merge.
    await act(async () => {
      resolveStale(dashboard);
      await Promise.resolve();
    });
    const finalCard = screen.getByRole("button", { name: /Wayzata Picture Day/i });
    expect(within(finalCard).getByText("Lead: Sarah")).toBeInTheDocument();
    expect(within(finalCard).queryByText("Lead still required")).toBeNull();
  });
});
