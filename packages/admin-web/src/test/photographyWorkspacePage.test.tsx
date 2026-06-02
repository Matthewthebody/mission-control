// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouteById, getVisibleChildRoutes, resolveRouteId, type TabKey } from "../navigation";
import { StudiosWorkspace } from "../pages/PhotographyWorkspace";
import { Schedule } from "../pages/Schedule";
import type { SharedJobListItem } from "../jobTruthTypes";
import type { SessionUser } from "../types";

const listSharedJobsMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  listSharedJobs: (...args: unknown[]) => listSharedJobsMock(...args)
}));

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args)
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

const availableTabs: TabKey[] = ["dashboard", "calendar", "shoots", "projects", "time", "alerts"];

function buildSharedJob(overrides: Partial<SharedJobListItem> = {}): SharedJobListItem {
  return {
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
    ready_present_count: 4,
    ...overrides
  };
}

describe("StudiosWorkspace", () => {
  beforeEach(() => {
    listSharedJobsMock.mockReset();
    apiFetchMock.mockReset();
    window.location.hash = "#studios";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a calendar-first studios homepage without redundant quick actions", async () => {
    listSharedJobsMock.mockResolvedValue({ jobs: [] });
    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} />);

    expect(await screen.findByRole("heading", { level: 2, name: "Photography Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "30-Day Photography Calendar" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")[0]).toHaveAccessibleName("Open 30-Day Calendar");
    fireEvent.click(screen.getByRole("button", { name: "Open 30-Day Calendar" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#studios/calendar");
    });

    expect(screen.getByRole("button", { name: /Photography Today's Shoots/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Photography Post-Shoot \/ Evaluations/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Photography 30-Day Calendar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Staffing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Compact Active Work")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Job \/ Event/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Studios Task/i })).not.toBeInTheDocument();
  });

  it("routes launch cards into the new studios hashes", async () => {
    listSharedJobsMock.mockResolvedValue({ jobs: [] });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="pre_service" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Pre-Service \/ Readiness" })).toBeInTheDocument();
    expect(screen.getByText("Job Prep Desk")).toBeInTheDocument();
    expect(screen.getByText("Reference Packet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Travel & Logistics" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#studios/travel");
    });
  });

  it("renders a Photography-specific Today's Shoots route without generic create-task actions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    listSharedJobsMock.mockResolvedValue({
      jobs: [
        buildSharedJob({
          id: "job-today",
          title: "North Metro Stadium Media Day",
          organization_name: "North Metro Athletics",
          primary_location_name: "North Metro Stadium",
          primary_day_date: today,
          primary_day_start_time: "09:30",
          primary_day_end_time: "12:00",
          lead_owner_name: "Carisa Lead",
          readiness_percent: 82,
          open_watch_flag_count: 1
        })
      ]
    });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="today" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Today's Shoots / Day at a Glance" })).toBeInTheDocument();
    expect(screen.getByText("North Metro Stadium Media Day")).toBeInTheDocument();
    expect(screen.getByText("North Metro Athletics")).toBeInTheDocument();
    expect(screen.getByText("North Metro Stadium")).toBeInTheDocument();
    expect(screen.getByText("Carisa Lead")).toBeInTheDocument();
    expect(screen.getByText(/1 watch flag/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Pre-Service" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Travel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Task/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/school task/i)).not.toBeInTheDocument();
  });

  it("routes studios shoots to the Photography Today surface", () => {
    const routeId = resolveRouteId("#studios/shoots", availableTabs, false);
    expect(routeId).toBe("studios-shoots");
    expect(getRouteById(routeId)?.render).toEqual({ kind: "studios-workspace", focus: "today" });
  });

  it("keeps staffing and attendance owned by Leadership navigation instead of Photography", () => {
    const photographyRoutes = getVisibleChildRoutes("photography", availableTabs, false);
    const leadershipRoutes = getVisibleChildRoutes("leadership", availableTabs, false);
    const photographyRouteIds = photographyRoutes.map((route) => route.id);
    const leadershipRouteIds = leadershipRoutes.map((route) => route.id);

    expect(photographyRouteIds).toEqual([
      "studios-calendar",
      "studios-shoots",
      "studios-pre-service",
      "job-closeout-v1",
      "studios-travel",
      "studios-workload"
    ]);
    expect(photographyRouteIds).not.toContain("studios-staffing");
    expect(photographyRouteIds).not.toContain("operations-attendance");

    expect(leadershipRouteIds[0]).toBe("operations-staffing");
    expect(leadershipRouteIds[1]).toBe("operations-attendance");
    expect(getRouteById("operations-staffing")?.label).toBe("Staff Assignment Board");
    expect(getRouteById("operations-attendance")?.canonicalHash).toBe("#employees/attendance");
  });

  it("routes old Photography staffing deep links to the Leadership staff assignment board", () => {
    expect(resolveRouteId("#photography/staffing", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#studios/staffing", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#schedule/assignment-board", availableTabs, false)).toBe("operations-staffing");
    expect(resolveRouteId("#employees/attendance", availableTabs, false)).toBe("operations-attendance");
  });

  it("opens Photography calendar in 30-day mode without staffing or sync controls", async () => {
    window.location.hash = "#studios/calendar";
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/shifts/resources/members")) {
        return [{ id: currentUser.id, full_name: currentUser.fullName, department: currentUser.department, roles: currentUser.roles }];
      }
      if (path.startsWith("/api/schedule/calendar?")) {
        return {
          range: { start_date: "2026-06-01", end_date: "2026-06-30" },
          items: [],
          sync: {
            source_of_truth: "outlook_mock",
            outlook_connected: false,
            outlook_health_state: "OUTLOOK_MOCK",
            pending_sync_count: 3
          }
        };
      }
      if (path.startsWith("/api/shifts?")) {
        return [];
      }
      return [];
    });

    render(<Schedule token="token-demo" currentUser={currentUser} />);

    expect(await screen.findByRole("heading", { name: "Photography Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30-Day" })).toHaveClass("is-active");
    expect(screen.queryByRole("tab", { name: /Staffing Schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Coverage Requests/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/OUTLOOK MOCK/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending sync/i)).not.toBeInTheDocument();
  });

  it("keeps focused subpages above the repeated homepage launch stack and labels workload for senior photographers", async () => {
    listSharedJobsMock.mockResolvedValue({ jobs: [] });

    render(<StudiosWorkspace token="token-demo" currentUser={currentUser} focus="workload" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Senior Photographer View" })).toBeInTheDocument();
    expect(screen.queryByText("Open First")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open 30-Day Calendar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Senior Photographer View" })).toBeInTheDocument();
  });
});
