// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardMyTasksPage } from "../pages/DashboardMyTasksPage";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

afterEach(() => {
  cleanup();
});

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

function buildUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-1",
    tenantId: "tenant-demo",
    accountId: "account-1",
    sessionId: "session-1",
    email: "user@example.com",
    fullName: "Demo User",
    status: "active",
    department: "operations",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["leadership"],
    permissions: ["dashboard.read", "task.create", "approval.read", "production_projects.view", "schedule.read"],
    authorityTier: "leadership",
    primaryJobFunctionProfile: "leadership_team_member",
    jobFunctionProfiles: ["leadership_team_member"],
    permissionGrants: [],
    effectiveScopes: ["all"],
    sessionTrust: standardSessionTrust,
    ...overrides
  };
}

function buildTaskItems(count: number, departmentLabel = "Operations") {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
    tenant_id: "tenant-demo",
    task_number: `TASK-${index + 1}`,
    title: `Task ${index + 1}`,
    description: null,
    task_type: "follow_up",
    department_type: "operations",
    related_job_id: null,
    assigned_to_user_id: "user-1",
    assigned_team_id: null,
    status: "not_started",
    priority: "normal",
    due_at: "2026-03-31T15:00:00.000Z",
    blocked_reason: null,
    proof_required: false,
    completion_notes: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: "2026-03-31T12:00:00.000Z",
    updated_at: "2026-03-31T12:00:00.000Z",
    assigned_to_name: "Demo User",
    related_job_number: null,
    related_job_title: index === 0 ? "Spring Portrait Day" : null,
    related_job_status: null,
    related_job_department: null,
    organization_name: index === 0 ? "North High" : null,
    department_label: departmentLabel
  }));
}

describe("DashboardMyTasksPage", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/tasks?assigned_to_user_id=user-1&limit=25") {
        return { items: buildTaskItems(4, "Operations") };
      }
      if (path === "/api/tasks?assigned_to_user_id=user-1&due_bucket=overdue&limit=25") {
        return { items: buildTaskItems(2, "Operations") };
      }
      if (path === "/api/tasks?assigned_to_user_id=user-1&due_bucket=today&limit=25") {
        return { items: buildTaskItems(3, "Operations") };
      }
      if (path === "/api/tasks?department_type=schools&limit=25") {
        return { items: buildTaskItems(5, "Schools") };
      }
      if (path === "/api/tasks?department_type=sports&limit=25") {
        return { items: buildTaskItems(2, "Sports") };
      }
      if (path === "/api/tasks?department_type=production&limit=25") {
        return { items: buildTaskItems(7, "Production") };
      }
      throw new Error(`Unexpected task hub call: ${path}`);
    });
  });

  it("renders a real task hub with live lanes and assigned task detail links", async () => {
    render(<DashboardMyTasksPage token="token" currentUser={buildUser()} />);

    expect(await screen.findByRole("heading", { name: "My Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Open the queue that owns the next action instead of digging through the whole app.")).toBeInTheDocument();
    expect(screen.getByText("Today at a glance")).toBeInTheDocument();
    expect(screen.getByText("My Open Tasks")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Due Today")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /View School Tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Sports Tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Production Tasks/i })).toBeInTheDocument();

    expect(screen.getByText("Assigned to you")).toBeInTheDocument();
    expect(screen.getByText("Spring Portrait Day")).toBeInTheDocument();

    expect(screen.queryByText("Tasks are internal execution items that can stand alone or attach to a Job / Event.")).not.toBeInTheDocument();
  });
});
