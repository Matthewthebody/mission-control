// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionHub } from "../pages/ProductionHub";
import type { SessionUser } from "../types";

const listSharedProductionQueueMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  listSharedProductionQueue: (...args: unknown[]) => listSharedProductionQueueMock(...args)
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

const productionUser: SessionUser = {
  id: "user-production",
  tenantId: "tenant-demo",
  accountId: "account-production",
  sessionId: "session-production",
  email: "production@example.com",
  fullName: "Production Lead",
  status: "active",
  department: "production",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["production"],
  permissions: ["dashboard.read", "production.read", "project.read", "projects.read", "qa.read", "release.read"],
  authorityTier: "manager",
  primaryJobFunctionProfile: "director_of_digital_production",
  jobFunctionProfiles: ["director_of_digital_production"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const baseProductionItem = {
  tenant_id: "tenant-demo",
  job_day_id: null,
  production_group_key: "default",
  job_type: "school_portraits",
  production_template_key: null,
  completion_rule_key: null,
  created_from_source: "demo",
  status: "queued",
  workflow_status: "READY_FOR_PRODUCTION",
  health_state: "ON_TRACK",
  sync_state: "SYNCED",
  priority: "normal",
  assigned_to_user_id: "user-production",
  assigned_to_name: "Production Lead",
  organization_id: "org-1",
  location_id: null,
  location_name: "Lincoln Elementary",
  primary_contact_id: null,
  account_owner_user_id: null,
  account_owner_name: null,
  department_owner_user_id: null,
  assigned_peer_reviewer_user_id: null,
  assigned_peer_reviewer_name: null,
  assigned_release_reviewer_user_id: null,
  assigned_release_reviewer_name: null,
  escalation_owner_user_id: null,
  escalation_owner_name: null,
  department_type: "schools",
  shoot_date_start: "2026-06-08T14:00:00.000Z",
  shoot_date_end: "2026-06-08T18:00:00.000Z",
  production_start_at: null,
  approval_required: false,
  proof_required: true,
  qa_required: true,
  due_at: "2026-06-10T17:00:00.000Z",
  release_due_at: "2026-06-11T17:00:00.000Z",
  delivery_deadline_at: "2026-06-12T17:00:00.000Z",
  completed_at: null,
  closed_at: null,
  readiness_score: 82,
  blocker_count: 0,
  rework_count: 0,
  file_count_expected: 100,
  file_count_received: 100,
  file_match_status: "MATCHED",
  roster_received: true,
  naming_verified: true,
  folder_structure_verified: true,
  tags_or_flags_verified: true,
  handoff_complete: true,
  upload_status: "NOT_STARTED",
  release_status: "NOT_STARTED",
  release_target: "Gallery",
  gallery_or_output_reference: null,
  vendor_name: null,
  vendor_reference: null,
  blocked_reason: null,
  client_visible_label: null,
  qa_status: "pending",
  creator_review_complete: false,
  peer_review_complete: false,
  final_release_review_complete: false,
  qa_fail_count: 0,
  first_pass_approved: false,
  internal_notes: null,
  production_notes: null,
  post_shoot_eval_summary: null,
  risk_flag: false,
  legacy_source_reference: null,
  imported_status_source: null,
  legacy_owner_history_json: null,
  hold_reason: null,
  hold_owner_user_id: null,
  hold_owner_name: null,
  hold_review_at: null,
  merged_into_production_item_id: null,
  linked_shoot_ids: [],
  days_since_shoot: 2,
  days_open: 2,
  days_to_due: 4,
  days_past_due: null,
  stage_age: 1,
  turnaround_days: null,
  job_number: "JOB-100",
  job_title: "Lincoln Spring Portraits",
  organization_name: "Lincoln Elementary",
  primary_location_name: "Lincoln Elementary",
  primary_contact_name: "Morgan Admin",
  approval_status: "not_required",
  qa_summary_status: "pending",
  deliverable_status: "not_started",
  file_receipt_state: "exact_match",
  overdue_approval_count: 0,
  open_issue_count: 0,
  blocking_issue_count: 0,
  job_risk_status: "on_track",
  job_readiness_status: "ready",
  title: "Lincoln Spring Portraits"
};

function createProductionPayload() {
  return {
    summary: {
      total_count: 4,
      blocked_count: 1,
      overdue_count: 1,
      awaiting_approval_count: 1,
      qa_pending_count: 2,
      due_today_count: 1
    },
    items: [
      {
        ...baseProductionItem,
        id: "prod-waiting",
        job_id: "job-waiting",
        assigned_to_user_id: null,
        assigned_to_name: null,
        file_receipt_state: "missing_receipt",
        job_number: "JOB-101",
        job_title: "Roosevelt Gallery",
        title: "Roosevelt Gallery"
      },
      {
        ...baseProductionItem,
        id: "prod-editing",
        job_id: "job-editing",
        workflow_status: "IN_PRODUCTION",
        status: "editing",
        job_number: "JOB-102",
        job_title: "Central Sports Release",
        title: "Central Sports Release",
        department_type: "sports"
      },
      {
        ...baseProductionItem,
        id: "prod-blocked",
        job_id: "job-blocked",
        health_state: "BLOCKED",
        blocker_count: 1,
        blocking_issue_count: 1,
        blocked_reason: "missing roster data",
        roster_received: false,
        approval_required: true,
        approval_status: "requested",
        days_past_due: 1,
        job_number: "JOB-103",
        job_title: "Kennedy Underclass",
        title: "Kennedy Underclass"
      },
      {
        ...baseProductionItem,
        id: "prod-complete",
        job_id: "job-complete",
        workflow_status: "RELEASED",
        status: "complete",
        qa_summary_status: "passed",
        peer_review_complete: true,
        final_release_review_complete: true,
        release_status: "RELEASED",
        deliverable_status: "delivered",
        completed_at: "2026-06-06T15:00:00.000Z",
        job_number: "JOB-104",
        job_title: "Northview Upload",
        title: "Northview Upload"
      }
    ]
  };
}

describe("ProductionHub", () => {
  beforeEach(() => {
    listSharedProductionQueueMock.mockReset();
    listSharedProductionQueueMock.mockResolvedValue(createProductionPayload());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Production as a first-class compact department hub", async () => {
    render(<ProductionHub token="token-demo" currentUser={productionUser} />);

    expect(await screen.findByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByText("Monitor editing, QA, packaging, release preparation, and jobs at risk.")).toBeInTheDocument();
    expect(screen.getByText("Open First")).toBeInTheDocument();
    expect(screen.getByText("Attention Needed")).toBeInTheDocument();
    expect(screen.getByText("This Week's Work")).toBeInTheDocument();
    expect(screen.getByText("Work Queues")).toBeInTheDocument();
    expect(screen.getByText("Jobs Waiting For Processing")).toBeInTheDocument();
    expect(screen.getByText("Rush / At Risk")).toBeInTheDocument();
    expect(screen.getAllByText("Exports / Releases").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Due This Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QA Needed").length).toBeGreaterThan(0);
    expect(screen.getByText("At Risk / Blocked")).toBeInTheDocument();
    expect(screen.getAllByText("Recently Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("Department Help Needed")).toBeInTheDocument();
    expect(screen.getByText("Viewing as Production Lead")).toBeInTheDocument();
    expect(screen.getByText("Production Work Areas")).toBeInTheDocument();
    expect(screen.getByText("Job type stays with Schools, Sports, or Specialty. These tabs show where the same work sits in Production.")).toBeInTheDocument();

    const workAreaTabs = screen.getByRole("tablist", { name: "Production work area tabs" });
    expect(within(workAreaTabs).getByRole("tab", { name: /Initial Process\s*2/i })).toHaveAttribute("aria-selected", "true");
    expect(within(workAreaTabs).getByRole("tab", { name: /In Production\s*1/i })).toBeInTheDocument();
    expect(within(workAreaTabs).getByRole("tab", { name: /D-Card Process\s*0/i })).toBeInTheDocument();
    expect(within(workAreaTabs).getByRole("tab", { name: /Gallery \/ Portal\s*4/i })).toBeInTheDocument();
    expect(within(workAreaTabs).getByRole("tab", { name: /Review \/ Exceptions\s*3/i })).toBeInTheDocument();
    expect(screen.getByText("Jobs being checked in, confirmed, assigned, or prepared for production.")).toBeInTheDocument();

    fireEvent.click(within(workAreaTabs).getByRole("tab", { name: /Review \/ Exceptions\s*3/i }));
    expect(within(workAreaTabs).getByRole("tab", { name: /Review \/ Exceptions\s*3/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Blocked, at-risk, QA-needed, ownerless, or review-needed production work.")).toBeInTheDocument();
    expect(screen.getAllByText(/Kennedy Underclass/).length).toBeGreaterThan(0);

    expect(screen.getByRole("link", { name: /Open Production Queue/i })).toHaveAttribute("href", "#production/queue");
    expect(screen.getByRole("link", { name: /Review QA/i })).toHaveAttribute("href", "#production/qa");
    expect(
      screen.getAllByRole("link", { name: /Release Readiness/i }).some((link) => link.getAttribute("href") === "#production/release"),
    ).toBe(true);
    expect(screen.getByRole("link", { name: /Jobs Waiting For Processing/i })).toHaveAttribute("href", "#production/queue");
    expect(screen.getByText("Blocked by missing files or partial upload handoff.")).toBeInTheDocument();
    expect(screen.getByText("Waiting on uploaded files or a complete file handoff.")).toBeInTheDocument();
    expect(screen.getAllByText(/Northview Upload/).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(listSharedProductionQueueMock).toHaveBeenCalledWith("token-demo");
    });
  });

  it("does not expose the demo admin user label in the Production status line", async () => {
    render(<ProductionHub token="token-demo" currentUser={{ ...productionUser, fullName: "Demo Admin" }} />);

    expect(await screen.findByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByText("Viewing as Mission Control User")).toBeInTheDocument();
    expect(screen.queryByText("Viewing as Demo Admin")).not.toBeInTheDocument();
  });

  it("shows a safe demo state instead of raw internal errors when production data is unavailable", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    listSharedProductionQueueMock.mockRejectedValueOnce(new Error("Internal server error"));

    try {
      const { container } = render(<ProductionHub token="token-demo" currentUser={productionUser} />);

      expect(await screen.findByRole("heading", { name: "Production" })).toBeInTheDocument();
      expect(await screen.findByText("Production data is not available in this demo view.")).toBeInTheDocument();
      expect(screen.getByText("Demo data unavailable")).toBeInTheDocument();
      expect(screen.getByText("Open First")).toBeInTheDocument();
      expect(screen.getByText("Work Queues")).toBeInTheDocument();
      expect(screen.queryByText("Internal server error")).not.toBeInTheDocument();
      expect(container.querySelector(".error-banner")).toBeNull();

      await waitFor(() => {
        expect(listSharedProductionQueueMock).toHaveBeenCalledWith("token-demo");
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith("Production queue failed to load", expect.any(Error));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
