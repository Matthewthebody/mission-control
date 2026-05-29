// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactActiveWorkPanel } from "../components/workspace/CompactActiveWorkPanel";
import type { SessionUser } from "../types";

const listSharedJobsMock = vi.fn();
const listSharedProductionQueueMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args),
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

const currentUser: SessionUser = {
  id: "user-photo",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-demo",
  email: "photo@example.com",
  fullName: "Alex Photographer",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["photographer"],
  permissions: ["dashboard.read", "job.read"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"],
  permissionGrants: [],
  effectiveScopes: ["self_only"],
  sessionTrust
};

function buildJob(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: "tenant-demo",
    legacy_shoot_id: null,
    job_number: `JOB-${id}`,
    department_type: "schools",
    job_category: "school_picture_day",
    organization_id: "org-1",
    primary_location_id: "loc-1",
    primary_contact_id: "contact-1",
    account_owner_user_id: "user-rep",
    title: `Job ${id}`,
    event_name: "Picture Day",
    description_internal: null,
    job_status: "confirmed",
    production_status: "queued",
    staffing_status: "staffed",
    readiness_status: "ready",
    sync_status: "clean",
    risk_status: "low",
    priority_level: "normal",
    delivery_type: "mixed",
    gallery_type: "individual",
    scheduled_start_at: "2026-04-03T08:00:00.000Z",
    scheduled_end_at: "2026-04-03T15:00:00.000Z",
    timezone: "America/Chicago",
    estimated_subject_count: 250,
    actual_subject_count: null,
    estimated_staff_count: 4,
    actual_staff_count: null,
    client_deadline_at: null,
    production_deadline_at: null,
    published_at: "2026-04-01T10:00:00.000Z",
    archived_at: null,
    cancelled_at: null,
    cancel_reason: null,
    production_required: true,
    location_override_note: null,
    contact_override_note: null,
    created_by_user_id: "user-admin",
    updated_by_user_id: "user-admin",
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    organization_name: "North High",
    primary_location_name: "Main Gym",
    primary_location_address: "123 Main Street",
    primary_contact_name: "Jamie Contact",
    account_owner_name: "Casey Rep",
    lead_owner_user_id: "user-photo",
    lead_owner_name: "Alex Photographer",
    primary_day_date: "2026-04-03",
    primary_day_start_time: "08:00",
    primary_day_end_time: "15:00",
    primary_day_label: "Picture Day",
    school_profile: null,
    sports_profile: null,
    department_summary: {
      assigned_team: "Field Team A",
      production_assignee_name: "Morgan Producer",
      production_assignee_user_id: "user-prod"
    },
    proof_status: null,
    open_watch_flag_count: 0,
    readiness_percent: 88,
    blocker_count: 0,
    day_count: 1,
    assigned_staff_count: 4,
    checked_in_staff_count: 2,
    ready_present_count: 2,
    ...overrides
  } as any;
}

describe("CompactActiveWorkPanel", () => {
  beforeEach(() => {
    listSharedJobsMock.mockReset();
    listSharedProductionQueueMock.mockReset();
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        buildJob("job-1", {
          title: "North High Picture Day",
          blocker_count: 1,
          risk_status: "high"
        }),
        buildJob("job-2", {
          title: "South High Retake Day",
          lead_owner_user_id: "user-other",
          lead_owner_name: "Taylor Lead",
          department_summary: {
            assigned_team: "Field Team B",
            production_assignee_name: "Jordan Producer",
            production_assignee_user_id: "user-prod-2"
          }
        })
      ]
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to team work and lets the user narrow the strip to my work", async () => {
    render(
      <CompactActiveWorkPanel
        token="token"
        currentUser={currentUser}
        title="Photography Active Work"
        summary="Scan the next jobs quickly."
        defaultDepartment="schools"
        routeHash="#schools/jobs"
      />
    );

    expect(await screen.findByText("North High Picture Day")).toBeInTheDocument();
    expect(screen.getByText("South High Retake Day")).toBeInTheDocument();
    expect(screen.getByText("2 in view")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "My Work" }));

    await waitFor(() => {
      expect(screen.getByText("North High Picture Day")).toBeInTheDocument();
      expect(screen.queryByText("South High Retake Day")).not.toBeInTheDocument();
      expect(screen.getByText("1 in view")).toBeInTheDocument();
    });
  });

  it("supports board mode and exposes the advanced scan filters", async () => {
    render(
      <CompactActiveWorkPanel
        token="token"
        currentUser={currentUser}
        title="Photography Active Work"
        summary="Scan the next jobs quickly."
        defaultDepartment="schools"
        routeHash="#schools/jobs"
      />
    );

    expect(await screen.findByText("North High Picture Day")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(await screen.findByText("Due now")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More Filters" }));

    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Assigned team")).toBeInTheDocument();
    expect(screen.getByLabelText("Photographer")).toBeInTheDocument();
    expect(screen.getByLabelText("Account rep")).toBeInTheDocument();
    expect(screen.getByLabelText("Production assignee")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
  });
});
