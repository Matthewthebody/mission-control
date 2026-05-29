import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobCloseoutV1 } from "../pages/JobCloseoutV1";
import type { JobCloseoutWorkspace } from "../jobCloseoutTypes";
import type { SessionUser } from "../types";

const getJobCloseoutWorkspaceMock = vi.fn();
const submitJobCloseoutEvaluationMock = vi.fn();
const createShootCheckInRequestsMock = vi.fn();
const respondToShootCheckInMock = vi.fn();
const generateOperationsReportSnapshotMock = vi.fn();
const listOperationsReportSnapshotsMock = vi.fn();

vi.mock("../featureFlags", () => ({
  featureFlags: {
    centralJobIntakeV1: false,
    jobCloseoutV1: true
  }
}));

vi.mock("../services/jobCloseoutApi", () => ({
  getJobCloseoutWorkspace: (...args: unknown[]) => getJobCloseoutWorkspaceMock(...args),
  submitJobCloseoutEvaluation: (...args: unknown[]) => submitJobCloseoutEvaluationMock(...args),
  createShootCheckInRequests: (...args: unknown[]) => createShootCheckInRequestsMock(...args),
  respondToShootCheckIn: (...args: unknown[]) => respondToShootCheckInMock(...args),
  generateOperationsReportSnapshot: (...args: unknown[]) => generateOperationsReportSnapshotMock(...args),
  listOperationsReportSnapshots: (...args: unknown[]) => listOperationsReportSnapshotsMock(...args)
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

const leadershipUser: SessionUser = {
  id: "leader-1",
  tenantId: "tenant-1",
  accountId: null,
  sessionId: "session-1",
  email: "leader@example.com",
  fullName: "Leadership User",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["job_closeout.read", "job_closeout.submit", "job_closeout.manage", "job_closeout.reporting.read", "job_closeout.reporting.sensitive"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "operations_admin",
  jobFunctionProfiles: ["operations_admin"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

function createWorkspace(): JobCloseoutWorkspace {
  return {
    rules: {
      feature_flag: "JOB_CLOSEOUT_V1_ENABLED",
      enabled: true,
      timezone: "America/Chicago",
      check_in_offset_minutes: 30,
      missed_check_in_grace_minutes: 15,
      lateness_threshold_minutes: 10,
      senior_evaluation_required: true,
      associate_evaluation_required: false,
      daily_report_time: "06:00",
      weekly_report_time: "Monday 06:00",
      photo_upload_soft_reminder_enabled: true
    },
    permissions: {
      can_submit: true,
      can_manage: true,
      can_view_sensitive: true,
      can_manage_mileage: true
    },
    job: {
      id: "job-1",
      department_type: "schools",
      job_category: "photo_day",
      job_number: "JOB-1",
      title: "Maple Grove Picture Day",
      event_name: "Maple Grove Picture Day",
      scheduled_start_at: "2026-05-04T13:00:00.000Z",
      scheduled_end_at: "2026-05-04T15:00:00.000Z",
      timezone: "America/Chicago",
      organization_id: "org-1",
      organization_name: "Maple Grove HS",
      primary_location_id: "location-1",
      location_name: "Main Gym",
      is_assigned_to_user: true,
      is_lead_for_user: true
    },
    check_ins: [
      {
        id: "check-in-1",
        job_id: "job-1",
        requested_for_user_id: "leader-1",
        requested_for_name: "Leadership User",
        due_at: "2026-05-04T13:30:00.000Z",
        responded_at: null,
        status: "pending",
        issue_note: null
      }
    ],
    evaluations: [],
    latest_evaluation: null,
    mileage_reviews: [],
    attachments: [],
    flags: [],
    pre_shoot_brief: {
      prior_post_shoot_evaluations: [],
      prior_next_year_notes: ["Use the north gym entrance next year."],
      prior_data_issues: ["qr_sorting_issue"],
      customer_survey_summary: null,
      customer_survey_summary_status: "not_connected"
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#job-closeout/jobs/job-1";
  getJobCloseoutWorkspaceMock.mockResolvedValue(createWorkspace());
  submitJobCloseoutEvaluationMock.mockResolvedValue({
    evaluation: {
      id: "eval-1",
      job_id: "job-1",
      eval_status: "submitted",
      submitter_role: "shoot_lead",
      overall_status: "smooth",
      image_confidence_score: 5,
      mileage_qualified: true
    },
    flag_ids: [],
    late_staff_entry_ids: [],
    attachment_ids: [],
    mileage_review: null
  });
  createShootCheckInRequestsMock.mockResolvedValue({ check_ins: [] });
  respondToShootCheckInMock.mockResolvedValue({ check_in: { id: "check-in-1", status: "good", issue_note: null }, flag_id: null });
  generateOperationsReportSnapshotMock.mockResolvedValue({ snapshot: { id: "report-1", report_type: "daily", summary_metrics: {}, source_evaluation_ids: [], source_flag_ids: [] } });
  listOperationsReportSnapshotsMock.mockResolvedValue({ snapshots: [] });
});

describe("JobCloseoutV1 page", () => {
  it("renders the job closeout workspace and submits a senior evaluation without typed miles", async () => {
    render(<JobCloseoutV1 token="token-demo" currentUser={leadershipUser} />);

    expect(await screen.findByText(/Closeout: Maple Grove Picture Day/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Pre-shoot brief/i })).toBeInTheDocument();
    expect(screen.getByText(/Use the north gym entrance next year/i)).toBeInTheDocument();

    const form = screen.getByText(/Post-shoot closeout/i).closest("form");
    expect(form).toBeTruthy();
    fireEvent.change(within(form as HTMLElement).getByLabelText(/How do you feel about the images/i), { target: { value: "4" } });
    fireEvent.change(within(form as HTMLElement).getByLabelText(/Do you qualify for mileage/i), { target: { value: "yes" } });
    fireEvent.click(within(form as HTMLElement).getByRole("button", { name: /Submit closeout/i }));

    await waitFor(() => expect(submitJobCloseoutEvaluationMock).toHaveBeenCalled());
    const payload = submitJobCloseoutEvaluationMock.mock.calls[0][2];
    expect(payload.mileage_qualified).toBe(true);
    expect(payload).not.toHaveProperty("miles_driven");
    expect(payload.evaluation_type).toBe("post_shoot");
  });

  it("lets the lead respond to the pending check-in", async () => {
    render(<JobCloseoutV1 token="token-demo" currentUser={leadershipUser} />);

    expect(await screen.findByText(/Shoot check-in/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /We are good/i }));

    await waitFor(() => expect(respondToShootCheckInMock).toHaveBeenCalledWith("token-demo", "job-1", "check-in-1", { status: "good" }));
  });
});
