// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Compliance } from "../pages/Compliance";
import type { ComplianceWorkspaceDetailPayload, ComplianceWorkspaceListPayload } from "../complianceTypes";
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
  permissions: ["attendance.read", "attendance.manage", "attendance_exceptions.approve", "missed_punches.approve"],
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

function makeBlocker(
  state: "payroll_blocked" | "mileage_blocked" | "closeout_blocked" | "presence_review" | "review_required" | "resolved",
  label: string,
  summary: string,
  owningWorkspaceLabel: string,
  owningWorkspaceHash: string
) {
  return {
    state,
    label,
    summary,
    owning_workspace_label: owningWorkspaceLabel,
    owning_workspace_hash: owningWorkspaceHash
  };
}

const listResponse: ComplianceWorkspaceListPayload = {
  summary: {
    open_count: 3,
    payroll_blocking_count: 2,
    mileage_blocking_count: 0,
    missing_closeout_count: 1,
    unresolved_end_of_day_confirmation_count: 0,
    missed_clock_in_review_count: 1,
    no_lunch_review_count: 1,
    off_clock_upload_review_count: 0,
    presence_incident_review_count: 0,
    counts_by_urgency: {
      urgent: 0,
      important: 3,
      watch: 0
    },
    counts_by_issue_type: {
      missing_setup_photo: 1,
      missing_post_shoot_evaluation: 0,
      mileage_blocked_missing_post_shoot_evaluation: 0,
      upload_while_off_clock: 0,
      unresolved_end_of_day_confirmation: 0,
      no_lunch_challenge: 1,
      missed_clock_in_request: 1,
      likely_present_missing_clock_in: 0,
      assigned_but_missing: 0
    }
  },
  filters: {
    employees: [{ id: "user-photo", name: "Jordan Fields" }],
    organizations: [{ id: "org-1", name: "Wayzata Public Schools" }],
    shoots: [{ id: "shoot-1", title: "Spring Tennis Day" }],
    issue_types: [
      { id: "missing_setup_photo", label: "Missing Setup Photo" },
      { id: "no_lunch_challenge", label: "No-Lunch Challenge" },
      { id: "missed_clock_in_request", label: "Missed Clock-In Request" }
    ]
  },
  freshness: {
    generated_at: "2026-03-28T12:30:00.000Z",
    latest_item_updated_at: "2026-03-28T12:20:00.000Z",
    latest_unresolved_item_updated_at: "2026-03-28T12:20:00.000Z"
  },
  rows: [
    {
      id: "compliance_flag:flag-1",
      source_kind: "compliance_flag",
      source_id: "flag-1",
      issue_type: "missing_setup_photo",
      issue_label: "Missing Setup Photo",
      urgency: "important",
      source_status: "open",
      status_bucket: "unresolved",
      message: "Setup Photo is still missing for this Shoot.",
      employee_id: "user-photo",
      employee_name: "Jordan Fields",
      shift_id: "shift-1",
      shift_title: "Spring Tennis Coverage",
      session_id: null,
      shoot_id: "shoot-1",
      shoot_code: "S-100",
      shoot_title: "Spring Tennis Day",
      organization_id: "org-1",
      organization_display_name: "Wayzata Public Schools",
      location_id: "location-1",
      location_name: "Main Gym",
      linked_exception_request_id: null,
      linked_attendance_exception_id: null,
      payroll_blocking: false,
      mileage_blocking: false,
      missing_closeout: true,
      unresolved_end_of_day_confirmation: false,
      blocker: makeBlocker(
        "closeout_blocked",
        "Closeout Blocked",
        "The required setup photo is still missing from closeout.",
        "Compliance",
        "#employees/compliance"
      ),
      occurred_at: "2026-03-28T11:00:00.000Z",
      updated_at: "2026-03-28T11:05:00.000Z",
      resolved_at: null,
      resolution_note: null
    },
    {
      id: "attendance_exception:exception-no-lunch",
      source_kind: "attendance_exception",
      source_id: "exception-no-lunch",
      issue_type: "no_lunch_challenge",
      issue_label: "No-Lunch Challenge",
      urgency: "important",
      source_status: "open",
      status_bucket: "unresolved",
      message: "Worked straight through lunch because the gym turnaround never paused.",
      employee_id: "user-photo",
      employee_name: "Jordan Fields",
      shift_id: "shift-1",
      shift_title: "Spring Tennis Coverage",
      session_id: null,
      shoot_id: "shoot-1",
      shoot_code: "S-100",
      shoot_title: "Spring Tennis Day",
      organization_id: "org-1",
      organization_display_name: "Wayzata Public Schools",
      location_id: "location-1",
      location_name: "Main Gym",
      linked_exception_request_id: "request-no-lunch",
      linked_attendance_exception_id: "exception-no-lunch",
      payroll_blocking: true,
      mileage_blocking: false,
      missing_closeout: false,
      unresolved_end_of_day_confirmation: false,
      blocker: makeBlocker(
        "payroll_blocked",
        "Payroll Blocked",
        "Payroll confidence is blocked until the no-lunch challenge is approved or rejected.",
        "Attendance",
        "#operations/attendance"
      ),
      occurred_at: "2026-03-28T12:00:00.000Z",
      updated_at: "2026-03-28T12:05:00.000Z",
      resolved_at: null,
      resolution_note: null
    },
    {
      id: "attendance_exception:exception-missed",
      source_kind: "attendance_exception",
      source_id: "exception-missed",
      issue_type: "missed_clock_in_request",
      issue_label: "Missed Clock-In Request",
      urgency: "important",
      source_status: "open",
      status_bucket: "unresolved",
      message: "Missed clock-in correction requested for 2026-03-28 10:00:00.",
      employee_id: "user-photo",
      employee_name: "Jordan Fields",
      shift_id: "shift-1",
      shift_title: "Spring Tennis Coverage",
      session_id: null,
      shoot_id: "shoot-1",
      shoot_code: "S-100",
      shoot_title: "Spring Tennis Day",
      organization_id: "org-1",
      organization_display_name: "Wayzata Public Schools",
      location_id: "location-1",
      location_name: "Main Gym",
      linked_exception_request_id: "request-missed",
      linked_attendance_exception_id: "exception-missed",
      payroll_blocking: true,
      mileage_blocking: false,
      missing_closeout: false,
      unresolved_end_of_day_confirmation: false,
      blocker: makeBlocker(
        "payroll_blocked",
        "Payroll Blocked",
        "Payroll confidence is blocked until the missed clock-in request is approved or rejected.",
        "Attendance",
        "#operations/attendance"
      ),
      occurred_at: "2026-03-28T12:15:00.000Z",
      updated_at: "2026-03-28T12:20:00.000Z",
      resolved_at: null,
      resolution_note: null
    }
  ]
};

const flagDetail: ComplianceWorkspaceDetailPayload = {
  item: listResponse.rows[0],
  available_actions: [
    { id: "open_compliance", label: "Open Compliance Workspace", kind: "drill_out", hash: "#employees/compliance" }
  ],
  deep_links: [
    { id: "compliance", label: "Open Compliance Workspace", hash: "#employees/compliance" }
  ],
  history: [
    {
      id: "flag-1:opened",
      occurred_at: "2026-03-28T11:00:00.000Z",
      source_label: "Compliance",
      title: "Missing Setup Photo detected",
      summary: "Setup Photo is still missing for this Shoot.",
      actor_name: null,
      tone: "warning"
    }
  ],
  payroll_impact: {
    blocked: false,
    reason: null,
    session_id: null,
    work_date: null,
    session_status: null,
    payable_minutes: null,
    lunch_challenge_status: null,
    manual_correction_count: null,
    missed_clock_in_approval_count: null
  },
  mileage_impact: {
    blocked: false,
    reason: null,
    reimbursement_id: null,
    work_date: null,
    status: null,
    review_reason_code: null,
    review_reason_label: null,
    issue_label: null,
    reimbursement_amount: null,
    zone_name: null,
    vehicle_type: null,
    submit_for_mileage: null
  },
  linked_records: {
    shift: {
      id: "shift-1",
      title: "Spring Tennis Coverage",
      starts_at: "2026-03-28T10:45:00.000Z",
      ends_at: "2026-03-28T15:00:00.000Z",
      attendance_state: "assigned",
      manager_user_id: "user-leadership",
      manager_name: "Demo Leadership",
      location_name: "Main Gym",
      location_address: "123 Main St",
      navigation_url: "https://maps.example/location"
    },
    shoot: {
      id: "shoot-1",
      shoot_code: "S-100",
      title: "Spring Tennis Day",
      shoot_date: "2026-03-28",
      showtime: "2026-03-28T11:00:00.000Z",
      start_time: "2026-03-28T11:15:00.000Z",
      estimated_end_time: "2026-03-28T15:00:00.000Z",
      status: "confirmed"
    },
    organization: { id: "org-1", display_name: "Wayzata Public Schools" },
    location: { id: "location-1", name: "Main Gym", address: "123 Main St", maps_url: "https://maps.example/location" },
    correction_request: null,
    post_shoot_evaluation: null,
    resource_uploads: [],
    presence_incident: null
  }
};

const noLunchDetail: ComplianceWorkspaceDetailPayload = {
  ...flagDetail,
  item: listResponse.rows[1],
  available_actions: [
    { id: "approve_no_lunch", label: "Approve no-lunch challenge", kind: "review", hash: null },
    { id: "reject_no_lunch", label: "Reject no-lunch challenge", kind: "review", hash: null },
    { id: "open_attendance", label: "Open Attendance", kind: "drill_out", hash: "#operations/attendance" },
    { id: "open_compliance", label: "Open Compliance Workspace", kind: "drill_out", hash: "#employees/compliance" }
  ],
  deep_links: [
    { id: "compliance", label: "Open Compliance Workspace", hash: "#employees/compliance" },
    { id: "attendance", label: "Open Attendance", hash: "#operations/attendance" },
    { id: "payroll_review", label: "Open Payroll Review", hash: "#employees/payroll" }
  ],
  payroll_impact: {
    blocked: true,
    reason: "Payroll confidence is blocked until the no-lunch challenge is approved or rejected.",
    session_id: "session-1",
    work_date: "2026-03-28",
    session_status: "closed",
    payable_minutes: 315,
    lunch_challenge_status: "submitted",
    manual_correction_count: 0,
    missed_clock_in_approval_count: 0
  },
  mileage_impact: {
    blocked: false,
    reason: null,
    reimbursement_id: null,
    work_date: null,
    status: null,
    review_reason_code: null,
    review_reason_label: null,
    issue_label: null,
    reimbursement_amount: null,
    zone_name: null,
    vehicle_type: null,
    submit_for_mileage: null
  },
  history: [
    {
      id: "exception-no-lunch:opened",
      occurred_at: "2026-03-28T12:00:00.000Z",
      source_label: "Compliance",
      title: "No-Lunch Challenge detected",
      summary: "Worked straight through lunch because the gym turnaround never paused.",
      actor_name: null,
      tone: "warning"
    }
  ],
  linked_records: {
    ...flagDetail.linked_records,
    correction_request: {
      id: "request-no-lunch",
      request_type: "lunch_deduction_challenge",
      status: "submitted",
      submitted_at: "2026-03-28T12:01:00.000Z",
      reviewed_at: null,
      requested_state: null,
      requested_start_time: null,
      requested_end_time: null,
      note: "Challenge lunch deduction for uninterrupted coverage.",
      reporting_flags: ["manual_adjustment"],
      original_values: {},
      resolved_values: {},
      requested_approver_id: "user-leadership",
      requested_approver_name: "Demo Leadership",
      reviewed_by_id: null,
      reviewed_by_name: null,
      approval_records: []
    }
  }
};

const missedDetail: ComplianceWorkspaceDetailPayload = {
  ...flagDetail,
  item: listResponse.rows[2],
  available_actions: [
    { id: "approve_missed_clock_in", label: "Approve missed clock-in request", kind: "review", hash: null },
    { id: "reject_missed_clock_in", label: "Reject missed clock-in request", kind: "review", hash: null },
    { id: "open_attendance", label: "Open Attendance", kind: "drill_out", hash: "#operations/attendance" },
    { id: "open_compliance", label: "Open Compliance Workspace", kind: "drill_out", hash: "#employees/compliance" }
  ],
  deep_links: [
    { id: "compliance", label: "Open Compliance Workspace", hash: "#employees/compliance" },
    { id: "attendance", label: "Open Attendance", hash: "#operations/attendance" },
    { id: "payroll_review", label: "Open Payroll Review", hash: "#employees/payroll" }
  ],
  payroll_impact: {
    blocked: true,
    reason: "Payroll confidence is blocked until the missed clock-in request is approved or rejected.",
    session_id: "session-2",
    work_date: "2026-03-28",
    session_status: "open",
    payable_minutes: 0,
    lunch_challenge_status: null,
    manual_correction_count: 1,
    missed_clock_in_approval_count: 1
  },
  mileage_impact: {
    blocked: false,
    reason: null,
    reimbursement_id: null,
    work_date: null,
    status: null,
    review_reason_code: null,
    review_reason_label: null,
    issue_label: null,
    reimbursement_amount: null,
    zone_name: null,
    vehicle_type: null,
    submit_for_mileage: null
  },
  history: [
    {
      id: "exception-missed:opened",
      occurred_at: "2026-03-28T12:15:00.000Z",
      source_label: "Compliance",
      title: "Missed Clock-In Request detected",
      summary: "Missed clock-in correction requested for 2026-03-28 10:00:00.",
      actor_name: null,
      tone: "warning"
    },
    {
      id: "approval-1",
      occurred_at: "2026-03-28T12:18:00.000Z",
      source_label: "Approval",
      title: "Submitted",
      summary: "Correction request routed for review.",
      actor_name: "Demo Leadership",
      tone: "info"
    }
  ],
  linked_records: {
    ...flagDetail.linked_records,
    correction_request: {
      id: "request-missed",
      request_type: "missing_clock_in",
      status: "submitted",
      submitted_at: "2026-03-28T12:16:00.000Z",
      reviewed_at: null,
      requested_state: "photography",
      requested_start_time: "2026-03-28T10:00:00.000Z",
      requested_end_time: null,
      note: "Please review missed clock-in correction.",
      reporting_flags: ["missed_clock_in_approval"],
      original_values: {},
      resolved_values: {},
      requested_approver_id: "user-leadership",
      requested_approver_name: "Demo Leadership",
      reviewed_by_id: null,
      reviewed_by_name: null,
      approval_records: []
    },
    post_shoot_evaluation: {
      id: "evaluation-1",
      submitted_at: "2026-03-28T16:00:00.000Z",
      photographer_name: "Jordan Fields",
      overall_shoot_status: "successful",
      issue_flag: false,
      went_well: "Crew flow was smooth.",
      remember_next_time: "Use the same gym setup.",
      open_comment: "Everything landed cleanly.",
      submit_for_mileage: true,
      vehicle_type: "personal_vehicle"
    },
    resource_uploads: [
      {
        id: "upload-1",
        file_name: "setup-reference.jpg",
        category: "setup_photo",
        approval_status: "approved",
        visibility_scope: "photographer_prep",
        note: "Setup captured after arrival.",
        issue_type: null,
        upload_source: "mobile_library",
        uploader_name: "Jordan Fields",
        captured_at: "2026-03-28T11:05:00.000Z",
        created_at: "2026-03-28T11:06:00.000Z",
        file_url: "https://files.example/setup-reference.jpg"
      }
    ],
    presence_incident: {
      id: "presence-1",
      alert_type: "likely_present_missing_clock_in",
      current_state: "off_clock",
      geofence_classification: "inside_soft_radius",
      repeat_count: 1,
      last_observed_at: "2026-03-28T10:15:00.000Z",
      last_notified_at: "2026-03-28T10:16:00.000Z",
      resolution_status: "open",
      resolved_at: null,
      resolution_reason: null
    }
  }
};

describe("Compliance page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.history.replaceState(null, "", "#needs-attention");
  });

  it("renders the Needs Attention queue and routes missed clock-in approval through the existing review endpoint", async () => {
    const reviewBodies: unknown[] = [];

    apiFetchMock.mockImplementation(async (path: string, _token?: string, init?: RequestInit) => {
      if (path.startsWith("/api/compliance/workspace?")) {
        return listResponse;
      }
      if (path === "/api/compliance/workspace/compliance_flag/flag-1") {
        return flagDetail;
      }
      if (path === "/api/compliance/workspace/attendance_exception/exception-no-lunch") {
        return noLunchDetail;
      }
      if (path === "/api/compliance/workspace/attendance_exception/exception-missed") {
        return missedDetail;
      }
      if (path === "/api/attendance/missed-punches/exception-missed/review") {
        reviewBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return {};
      }
      if (path === "/api/attendance/exceptions/exception-no-lunch/review") {
        reviewBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return {};
      }
      throw new Error(`Unexpected compliance call: ${path}`);
    });

    render(<Compliance token="token" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Needs Attention")).toBeTruthy();
    expect(screen.getByText(/blocked, missing, overdue, or approval-required/i)).toBeTruthy();
    expect(screen.getByText("Open Items")).toBeTruthy();
    expect(screen.getByText("Overdue / Urgent")).toBeTruthy();
    expect(screen.getByText("Blocking Payroll or Mileage")).toBeTruthy();
    expect(screen.getByText("Waiting on Review")).toBeTruthy();
    expect(screen.getAllByText("Missing Setup Photo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fix in Attendance").length).toBeGreaterThan(0);
    expect(screen.queryByText("missing_setup_photo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /No-Lunch Challenge/i }));
    expect(await screen.findByRole("button", { name: "Approve Challenge" })).toBeTruthy();
    expect(screen.getByText("Payroll Impact")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Missed Clock-In Request/i }));
    expect(await screen.findByRole("button", { name: "Approve Request" })).toBeTruthy();
    expect(screen.getByText("Blocker Summary")).toBeTruthy();
    expect(screen.getByText("Correction Request")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Attendance" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Needs Attention" })).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();

    const correctedInput = screen.getByLabelText("Corrected clock-in time");
    fireEvent.change(correctedInput, { target: { value: "2026-03-28T10:00:00.000Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve Request" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/attendance/missed-punches/exception-missed/review",
        "token",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(
      apiFetchMock.mock.calls.some(
        ([path, token]) => typeof path === "string" && path.startsWith("/api/compliance/workspace?") && token === "token"
      )
    ).toBe(true);
    expect(reviewBodies).toContainEqual({
      status: "approved",
      corrected_time: "2026-03-28T10:00:00.000Z",
      notes: null
    });
  });

  it("keeps the workspace restricted for users without compliance access", async () => {
    render(<Compliance token="token" currentUser={photographerUser} socket={null} />);

    expect(screen.getByText("Needs Attention access is restricted")).toBeTruthy();
    await waitFor(() => {
      expect(apiFetchMock).not.toHaveBeenCalled();
    });
  });

  it("shows a calm empty state when nothing needs review", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/compliance/workspace?")) {
        return {
          ...listResponse,
          summary: {
            ...listResponse.summary,
            open_count: 0,
            payroll_blocking_count: 0,
            mileage_blocking_count: 0,
            missed_clock_in_review_count: 0,
            no_lunch_review_count: 0,
            off_clock_upload_review_count: 0,
            presence_incident_review_count: 0,
            counts_by_urgency: { urgent: 0, important: 0, watch: 0 }
          },
          rows: []
        } satisfies ComplianceWorkspaceListPayload;
      }
      throw new Error(`Unexpected compliance call: ${path}`);
    });

    render(<Compliance token="token" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Needs Attention")).toBeTruthy();
    expect(screen.getByText("Nothing needs review right now.")).toBeTruthy();
  });
});
