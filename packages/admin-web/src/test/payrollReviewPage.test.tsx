import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollReview } from "../pages/PayrollReview";
import type {
  PayrollExportPayload,
  PayrollReviewDetailPayload,
  PayrollReviewPayload
} from "../payrollReviewTypes";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

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

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["attendance.read", "attendance.manage", "labor.read", "labor_cost.view"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

const photographerUser: SessionUser = {
  ...leadershipUser,
  id: "user-photo",
  email: "photo@example.com",
  fullName: "Demo Photographer",
  roles: ["photographer"],
  permissions: ["shoot.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"]
};

const reviewPayload: PayrollReviewPayload = {
  source_of_truth: {
    primary_model: "canonical_labor_state",
    canonical_records: ["time_session", "time_segment", "time_session_payroll_summary", "payroll_export_aggregate"],
    legacy_compatibility_records: ["time_entry"]
  },
  pay_period: {
    start: "2026-03-23",
    end: "2026-03-29",
    overtime_basis: "weekly_over_40"
  },
  transition: {
    canonical_break_override_count: 1,
    legacy_time_entry_summary: {
      entry_count: 2,
      gross_hours: 12,
      break_deduction_hours: 0.5,
      payable_hours: 11.5,
      break_override_count: 1
    },
    comparison: {
      mismatch_employee_count: 0,
      canonical_only_employee_count: 0,
      legacy_only_employee_count: 0
    }
  },
  summary: {
    employee_count: 1,
    ready_count: 0,
    blocked_count: 1,
    exported_count: 0,
    regular_office_drive_hours: 2,
    regular_photography_hours: 8,
    overtime_hours: 0,
    lunch_deduction_hours: 0.5,
    mileage_reimbursement_amount: 38,
    manual_correction_count: 1,
    missed_clock_in_approval_count: 1,
    exception_count: 2,
    approval_count: 1
  },
  rows: [
    {
      id: "aggregate-1",
      employee_id: "user-photo",
      employee_name: "Jordan Fields",
      department: "schools",
      pay_period_start: "2026-03-23",
      pay_period_end: "2026-03-29",
      regular_office_drive_minutes: 120,
      regular_photography_minutes: 480,
      overtime_minutes: 0,
      overtime_base_rate: "22.50",
      overtime_rate: "33.75",
      lunch_deduction_minutes: 30,
      manual_correction_count: 1,
      missed_clock_in_approval_count: 1,
      mileage_reimbursement_amount: "38.00",
      exception_request_count: 2,
      approval_record_count: 1,
      exception_flags: ["manual_adjustment"],
      approval_flags: ["missed_clock_in_approval"],
      notes: {
        pending_lunch_challenge_count: 1,
        review_required_mileage_count: 1,
        canonical_break_override_count: 1
      },
      status: "draft",
      sessions: [
        {
          id: "session-rollup-1",
          session_id: "session-1",
          work_date: "2026-03-28",
          office_drive_minutes: 120,
          photography_minutes: 300,
          total_worked_minutes: 420,
          lunch_deduction_minutes: 30,
          payable_minutes: 390,
          regular_office_drive_minutes: 120,
          regular_photography_minutes: 270,
          overtime_minutes: 0,
          manual_correction_count: 1,
          missed_clock_in_approval_count: 0,
          reporting_flags: ["manual_adjustment"]
        }
      ],
      legacy_comparison: {
        entry_count: 1,
        payable_minutes: 390,
        payable_minutes_delta: 0,
        break_override_count: 1,
        amounts_match: true
      },
      transition_flags: [],
      review_state: "attention_required",
      export_readiness: "blocked",
      unresolved_issue_count: 2,
      review_issues: [
        {
          code: "pending_no_lunch_challenge",
          label: "Pending No-Lunch Challenge",
          severity: "important",
          blocks_export: true,
          message: "1 no-lunch challenge still needs review before payroll confidence is clean.",
          resolution_state: "unresolved"
        },
        {
          code: "review_required_mileage",
          label: "Mileage Review Required",
          severity: "important",
          blocks_export: true,
          message: "1 mileage reimbursement day still needs review.",
          resolution_state: "unresolved"
        }
      ]
    }
  ]
};

const detailPayload: PayrollReviewDetailPayload = {
  row: reviewPayload.rows[0],
  linked_records: {
    sessions: [
      {
        id: "session-rollup-1",
        session_id: "session-1",
        work_date: "2026-03-28",
        session_status: "closed",
        source_shift_id: "shift-1",
        shift_title: "Spring Tennis Coverage",
        shift_starts_at: "2026-03-28T11:00:00.000Z",
        shift_ends_at: "2026-03-28T16:00:00.000Z",
        shoot_id: "shoot-1",
        shoot_code: "S-100",
        shoot_title: "Spring Tennis Day",
        location_name: "Main Gym",
        office_drive_minutes: 120,
        photography_minutes: 300,
        total_worked_minutes: 420,
        lunch_deduction_minutes: 30,
        payable_minutes: 390,
        regular_office_drive_minutes: 120,
        regular_photography_minutes: 270,
        overtime_minutes: 0,
        manual_correction_count: 1,
        missed_clock_in_approval_count: 0,
        reporting_flags: ["manual_adjustment"],
        segments: [
          {
            id: "segment-1",
            linked_shift_id: "shift-1",
            linked_shoot_id: "shoot-1",
            linked_location_id: "location-1",
            work_state: "office_drive",
            start_time: "2026-03-28T11:00:00.000Z",
            end_time: "2026-03-28T13:00:00.000Z",
            duration_minutes: 120,
            source_type: "admin_override",
            review_status: "approved",
            reporting_flags: ["manual_adjustment"]
          },
          {
            id: "segment-2",
            linked_shift_id: "shift-1",
            linked_shoot_id: "shoot-1",
            linked_location_id: "location-1",
            work_state: "photography",
            start_time: "2026-03-28T13:00:00.000Z",
            end_time: "2026-03-28T18:00:00.000Z",
            duration_minutes: 300,
            source_type: "manual",
            review_status: "approved",
            reporting_flags: []
          }
        ]
      }
    ],
    exception_requests: [
      {
        id: "request-1",
        request_type: "lunch_deduction_challenge",
        status: "submitted",
        submitted_at: "2026-03-28T18:05:00.000Z",
        reviewed_at: null,
        requested_state: null,
        requested_start_time: null,
        requested_end_time: null,
        note: "Worked straight through lunch because coverage never paused.",
        reporting_flags: ["manual_adjustment", "lunch_challenge_pending"],
        work_date: "2026-03-28",
        linked_session_id: "session-1",
        linked_segment_id: null,
        shift_id: "shift-1",
        shift_title: "Spring Tennis Coverage",
        shoot_id: "shoot-1",
        shoot_code: "S-100",
        shoot_title: "Spring Tennis Day",
        requested_approver_id: "user-leadership",
        requested_approver_name: "Demo Leadership",
        reviewed_by_id: null,
        reviewed_by_name: null,
        approval_records: []
      }
    ],
    mileage_reimbursements: [
      {
        id: "mileage-1",
        work_date: "2026-03-28",
        linked_shoot_id: "shoot-1",
        linked_shoot_code: "S-100",
        linked_shoot_title: "Spring Tennis Day",
        organization_display_name: "Wayzata Public Schools",
        location_name: "Main Gym",
        zone_name: "Zone 2",
        studio_distance_miles: "24.50",
        reimbursement_amount: "38.00",
        vehicle_type: "other_needs_review",
        status: "review_required",
        review_reason_code: "other_needs_review",
        reporting_flags: ["phase5_mileage", "review_required"],
        source_evaluation_count: 1,
        created_at: "2026-03-28T18:10:00.000Z",
        updated_at: "2026-03-28T18:10:00.000Z",
        sources: [
          {
            id: "mileage-source-1",
            evaluation_id: null,
            shift_id: "shift-1",
            shoot_id: "shoot-1",
            shoot_code: "S-100",
            shoot_title: "Spring Tennis Day",
            organization_display_name: "Wayzata Public Schools",
            location_name: "Main Gym",
            zone_name: "Zone 2",
            studio_distance_miles: "24.50",
            reimbursement_amount: "38.00",
            submit_for_mileage: true,
            vehicle_type: "other_needs_review",
            eligible_for_selection: true,
            review_reason_code: "other_needs_review",
            created_at: "2026-03-28T18:10:00.000Z"
          }
        ]
      }
    ]
  },
  export_payload_row: {
    employee_id: "user-photo",
    employee_name: "Jordan Fields",
    department: "schools",
    pay_period_start: "2026-03-23",
    pay_period_end: "2026-03-29",
    review_state: "attention_required",
    export_readiness: "blocked",
    regular_office_drive_hours: 2,
    regular_photography_hours: 8,
    overtime_hours: 0,
    lunch_deduction_hours: 0.5,
    mileage_reimbursement_amount: 38,
    exception_count: 2,
    approval_count: 1,
    manual_correction_count: 1,
    missed_clock_in_approval_count: 1,
    exception_flags: ["manual_adjustment"],
    approval_flags: ["missed_clock_in_approval"],
    notes: "Pending No-Lunch Challenge; Mileage Review Required"
  }
};

const exportPayload: PayrollExportPayload = {
  source_of_truth: reviewPayload.source_of_truth,
  generated_at: "2026-03-28T18:15:00.000Z",
  pay_period: reviewPayload.pay_period,
  summary: {
    employee_count: 1,
    ready_count: 0,
    blocked_count: 1,
    exported_count: 0,
    total_labor_hours: 10,
    total_mileage_reimbursement_amount: 38
  },
  rows: [detailPayload.export_payload_row]
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("Payroll review page", () => {
  it("renders the pay-period review desk, employee drill-in, and export payload preview", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/attendance/payroll-review/user-photo?")) {
        return detailPayload;
      }
      if (path.startsWith("/api/attendance/payroll-review/export-payload?")) {
        return exportPayload;
      }
      if (path.startsWith("/api/attendance/payroll-review?")) {
        return reviewPayload;
      }
      throw new Error(`Unexpected payroll review call: ${path}`);
    });

    render(<PayrollReview token="token" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByRole("heading", { name: "Canonical payroll review desk" })).toBeInTheDocument();
    expect(screen.getByText("Regular Office/Drive Hours")).toBeInTheDocument();
    expect(screen.getAllByText("Jordan Fields").length).toBeGreaterThan(0);
    expect(await screen.findByText("Pending No-Lunch Challenge")).toBeInTheDocument();
    expect(screen.getAllByText("Mileage Reimbursements").length).toBeGreaterThan(0);
    expect(screen.getByText("Worked straight through lunch because coverage never paused.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview Export Payload" }));

    expect(await screen.findByText("Export Payload")).toBeInTheDocument();
    expect(screen.getAllByText("Jordan Fields").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending No-Lunch Challenge; Mileage Review Required").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/attendance/payroll-review?"))).toBe(true);
      expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/attendance/payroll-review/user-photo?"))).toBe(true);
      expect(apiFetchMock.mock.calls.some(([path]) => String(path).startsWith("/api/attendance/payroll-review/export-payload?"))).toBe(true);
    });
  });

  it("keeps the workspace restricted for users without payroll review access", () => {
    render(<PayrollReview token="token" currentUser={photographerUser} socket={null} />);

    expect(screen.getByText("Payroll review is restricted")).toBeInTheDocument();
  });
});
