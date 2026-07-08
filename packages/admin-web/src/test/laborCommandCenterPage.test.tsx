import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LaborCommandCenter } from "../pages/LaborCommandCenter";
import type { LaborCommandCenterOverview, QuickBooksStatus, SelfCheckBoard } from "../services/laborCommandCenterApi";

vi.mock("../api", () => ({
  apiFetch: vi.fn()
}));

import { apiFetch } from "../api";

const apiFetchMock = vi.mocked(apiFetch);

function buildOverview(overrides: Partial<LaborCommandCenterOverview> = {}): LaborCommandCenterOverview {
  return {
    generated_at: "2026-07-08T12:00:00.000Z",
    access: { can_manage_periods: true, can_finalize_payroll: true },
    period: {
      id: "period-1",
      period_start: "2026-07-06",
      period_end: "2026-07-12",
      status: "payroll_review",
      lock_scheduled_at: "2026-07-14T12:00:00.000Z",
      self_check_opened_at: "2026-07-11T12:00:00.000Z",
      locked_at: null,
      exported_at: null,
      synced_at: null,
      correction_reason: null
    },
    self_check: {
      employee_count: 4,
      confirmed_count: 3,
      pending_count: 1,
      discrepancy_count: 0,
      open_discrepancy_items: 0,
      no_break_claims: 1,
      missing_punch_claims: 0,
      unresolved_geofence_punches: 2,
      payroll_ready_count: 2,
      travel_review_minutes: 0
    },
    overtime: {
      active_warning_count: 1,
      critical_warning_count: 1,
      warnings: [
        {
          id: "warning-1",
          employee_id: "emp-1",
          employee_name: "Demo Photographer",
          department: "schools",
          workweek_start: "2026-07-06",
          warning_type: "in_overtime",
          severity: "critical",
          status: "active",
          actual_minutes: 2500,
          projected_minutes: 2700,
          threshold_minutes: 2400,
          details: { message: "Past the 40h threshold." },
          first_detected_at: "2026-07-08T10:00:00.000Z",
          last_evaluated_at: "2026-07-08T11:00:00.000Z"
        }
      ]
    },
    blockers: {
      open_exception_requests: 3,
      unresolved_geofence_punches: 2,
      open_self_check_items: 0,
      missing_manager_approvals: 5,
      edited_after_review_count: 1
    },
    export_readiness: {
      can_lock: false,
      can_export: false,
      quickbooks_ready: false,
      export_batch_count: 0,
      last_export_at: null
    },
    recent_events: [
      {
        id: "event-1",
        event_type: "transition",
        from_status: "manager_review",
        to_status: "payroll_review",
        reason: null,
        actor_name: "Leadership User",
        created_at: "2026-07-08T09:00:00.000Z"
      }
    ],
    ...overrides
  };
}

function buildBoard(): SelfCheckBoard {
  return {
    period: {
      id: "period-1",
      period_start: "2026-07-06",
      period_end: "2026-07-12",
      status: "payroll_review",
      lock_scheduled_at: null
    },
    open_items: [
      {
        item_id: "item-1",
        employee_id: "emp-1",
        employee_name: "Demo Photographer",
        work_date: "2026-07-06",
        response: "no_break_taken",
        note: "No lunch on picture day.",
        manager_approved_claimed: true,
        linked_exception_request_id: "er-1",
        created_at: "2026-07-07T00:00:00.000Z"
      }
    ],
    summary: buildOverview().self_check,
    rows: [
      {
        employee_id: "emp-1",
        employee_name: "Demo Photographer",
        department: "schools",
        self_check_status: "discrepancy_reported",
        confirmed_at: null,
        open_discrepancy_count: 1,
        missing_punch_claims: 0,
        no_break_claims: 1,
        open_exception_requests: 1,
        unresolved_geofence_punches: 2,
        total_worked_minutes: 2500,
        payable_minutes: 2400,
        pay_code_minutes: { session_labor: 2000, studio_admin: 400 },
        travel_review_minutes: 90,
        is_part_time: true,
        edited_after_review: true,
        payroll_ready: false
      }
    ]
  };
}

function buildQuickBooks(): QuickBooksStatus {
  return {
    connection: {
      environment: "sandbox",
      connection_status: "not_connected",
      realm_id: null,
      last_connected_at: null,
      last_error: null
    },
    employee_mappings: {
      mapped_count: 1,
      active_employee_count: 4,
      unmapped_employees: [{ employee_id: "emp-2", employee_name: "Second Shooter", department: "sports" }]
    },
    pay_type_mappings: {
      mapped_categories: ["overtime"],
      missing_categories: ["regular_office_drive", "regular_photography", "mileage_reimbursement"]
    },
    quickbooks_ready: false
  };
}

function mockRoutes(overview: LaborCommandCenterOverview) {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/labor/command-center")) {
      return overview;
    }
    if (path.includes("/self-check-board")) {
      return buildBoard();
    }
    if (path.includes("/quickbooks/status")) {
      return buildQuickBooks();
    }
    throw new Error(`Unexpected apiFetch path in test: ${path}`);
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("LaborCommandCenter page", () => {
  it("renders exception-first blockers, self-check board, and overtime warnings", async () => {
    mockRoutes(buildOverview());
    render(<LaborCommandCenter token="test-token" />);

    expect(await screen.findByRole("heading", { name: "Labor Command Center" })).toBeInTheDocument();
    expect(screen.getByText(/of 4 employees confirmed/)).toBeInTheDocument();
    expect(screen.getByText("Open time exception requests")).toBeInTheDocument();
    expect(screen.getByText("Unresolved geofence punch exceptions")).toBeInTheDocument();
    expect(screen.getByText("Sessions edited after payroll review")).toBeInTheDocument();
    expect(screen.getAllByText("Demo Photographer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/in overtime/)).toBeInTheDocument();
    expect(screen.getByText(/edited after review/)).toBeInTheDocument();
  });

  it("keeps the CSV export disabled until the period is locked (no fake actions)", async () => {
    mockRoutes(buildOverview());
    render(<LaborCommandCenter token="test-token" />);

    const exportButton = await screen.findByRole("button", { name: "Generate payroll CSV" });
    expect(exportButton).toBeDisabled();
    expect(screen.getByText(/Export unlocks once the period is locked/)).toBeInTheDocument();
  });

  it("offers only legal next lifecycle steps: payroll_review hands off to owner review, never straight to lock", async () => {
    mockRoutes(buildOverview());
    render(<LaborCommandCenter token="test-token" />);

    expect(await screen.findByRole("button", { name: "Move to Owner Review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to Locked" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to Synced" })).not.toBeInTheDocument();
  });

  it("shows the owner QuickBooks send button disabled with an honest reason while not connected", async () => {
    mockRoutes(buildOverview());
    render(<LaborCommandCenter token="test-token" />);

    const sendButton = await screen.findByRole("button", { name: "Send Approved Time to QuickBooks" });
    expect(sendButton).toBeDisabled();
    expect(screen.getByText(/QuickBooks Online is not connected/)).toBeInTheDocument();
  });

  it("lets a manager resolve an open self-check report", async () => {
    mockRoutes(buildOverview());
    render(<LaborCommandCenter token="test-token" />);

    fireEvent.click(await screen.findByRole("button", { name: "Mark resolved" }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/labor/self-check/items/item-1/resolve",
        "test-token",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("hides period lifecycle and export controls from non-admin reviewers", async () => {
    mockRoutes(buildOverview({ access: { can_manage_periods: false, can_finalize_payroll: false } }));
    render(<LaborCommandCenter token="test-token" />);

    expect(await screen.findByRole("heading", { name: "Labor Command Center" })).toBeInTheDocument();
    expect(screen.queryByText("Period lifecycle")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate payroll CSV" })).not.toBeInTheDocument();
  });
});
