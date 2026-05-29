// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudiosWorkspace } from "../pages/PhotographyWorkspace";
import type { SessionUser } from "../types";

const listSharedJobsMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args)
}));

const currentUser: SessionUser = {
  id: "user-photo",
  tenantId: "tenant-demo",
  accountId: "account-photo",
  sessionId: "session-photo",
  email: "photo@example.com",
  fullName: "Photo Lead",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["photographer"],
  permissions: ["shoot.read", "schedule.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "lead_photographer",
  jobFunctionProfiles: ["lead_photographer"],
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

describe("StudiosWorkspace", () => {
  beforeEach(() => {
    listSharedJobsMock.mockReset();
    window.location.hash = "#studios";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the studios launch workspace and compact active work list", async () => {
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        {
          id: "job-1",
          tenant_id: "tenant-demo",
          legacy_shoot_id: null,
          job_number: "SCH-101",
          department_type: "schools",
          job_category: "photo_day",
          organization_id: "org-1",
          primary_location_id: "loc-1",
          primary_contact_id: "contact-1",
          account_owner_user_id: "account-owner-1",
          title: "Spring Picture Day",
          event_name: null,
          description_internal: null,
          job_status: "ready_to_execute",
          production_status: "queued",
          staffing_status: "ready_confirmed",
          readiness_status: "ready",
          sync_status: "clean",
          risk_status: "low",
          priority_level: "normal",
          delivery_type: null,
          gallery_type: null,
          scheduled_start_at: null,
          scheduled_end_at: null,
          timezone: "America/Chicago",
          estimated_subject_count: 100,
          actual_subject_count: null,
          estimated_staff_count: 4,
          actual_staff_count: 3,
          client_deadline_at: null,
          production_deadline_at: null,
          published_at: null,
          archived_at: null,
          cancelled_at: null,
          cancel_reason: null,
          production_required: true,
          location_override_note: null,
          contact_override_note: null,
          created_by_user_id: null,
          updated_by_user_id: null,
          created_at: "2026-04-01T10:00:00.000Z",
          updated_at: "2026-04-01T10:00:00.000Z",
          organization_name: "Lakeview High School",
          primary_location_name: "Main Gym",
          primary_location_address: "123 Lakeview Ave",
          primary_contact_name: "Jordan Lee",
          account_owner_name: "Alex Account",
          lead_owner_user_id: "user-photo",
          lead_owner_name: "Photo Lead",
          primary_day_date: "2026-04-10",
          primary_day_start_time: "08:00",
          primary_day_end_time: "13:00",
          primary_day_label: "Picture Day",
          school_profile: null,
          sports_profile: null,
          department_summary: {},
          proof_status: null,
          open_watch_flag_count: 0,
          readiness_percent: 100,
          blocker_count: 0,
          day_count: 1,
          assigned_staff_count: 4,
          checked_in_staff_count: 0,
          ready_present_count: 4
        }
      ]
    });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} />);

    expect(await screen.findByRole("heading", { level: 2, name: "Studios Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Studios Shoots/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Job \/ Event/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Studios Task/i })).toBeInTheDocument();
    expect(await screen.findByText("Spring Picture Day")).toBeInTheDocument();
    expect(screen.getByText("Lakeview High School")).toBeInTheDocument();
  });

  it("routes launch cards into the new studios hashes", async () => {
    listSharedJobsMock.mockResolvedValue({ jobs: [] });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="pre_service" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Pre-Service" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Studios Travel/i }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#studios/travel");
    });
  });
});
