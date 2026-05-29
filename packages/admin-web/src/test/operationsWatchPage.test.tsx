// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsExceptions } from "../pages/OperationsWatch";
import type { OperationalExceptionDetail, OperationalExceptionWorkspace } from "../exceptionTypes";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
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
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-leadership",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["dashboard.read", "schedule.read", "schedule.manage", "attendance.read", "attendance.manage", "project.read", "project.manage"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const workspacePayload: OperationalExceptionWorkspace = {
  generated_at: "2026-03-31T12:00:00.000Z",
  scope: "all",
  summary: {
    open_count: 2,
    blocking_count: 1,
    at_risk_count: 1,
    warning_count: 0,
    overdue_count: 1,
    snoozed_count: 0
  },
  home_ready_summary: {
    visible: true,
    tone: "action_needed",
    summary_line: "1 blocking exception needs action now.",
    urgent_count: 2,
    items: []
  },
  owner_options: [
    { id: "user-leadership", label: "Demo Leadership", detail: "Operations" },
    { id: "user-scheduling", label: "Scheduling Lead", detail: "Schools" }
  ],
  items: [
    {
      id: "watch-1",
      entity_type: "shoot",
      entity_id: "shoot-1",
      workflow_run_id: null,
      category: "staffing",
      type: "critical_role_gap",
      blocking: true,
      source_module: "scheduling",
      source_module_label: "Scheduling",
      source_entity_label: "DEMO-001",
      scope_department: "schools",
      status: "open",
      severity: "blocking",
      severity_label: "Blocking",
      title: "DEMO-001 is missing lead coverage",
      summary: "Lead coverage is still open for tomorrow morning.",
      owner_user_id: null,
      owner_label: "Needs owner",
      assigned_team_id: null,
      due_at: "2026-03-31T14:00:00.000Z",
      due_label: "3/31/2026, 9:00:00 AM",
      timing_state: "overdue",
      timing_label: "Overdue by 3h",
      next_action_label: "Open Scheduling",
      action_hash: "#scheduling?shoot=shoot-1",
      operational_impact_score: 120,
      snoozed_until: null,
      status_detail: null,
      resolution_note: null,
      source_snapshot: {
        shoot_id: "shoot-1"
      },
      created_at: "2026-03-31T08:30:00.000Z",
      updated_at: "2026-03-31T11:45:00.000Z",
      resolved_at: null
    },
    {
      id: "watch-2",
      entity_type: "production_project",
      entity_id: "project-1",
      workflow_run_id: null,
      category: "production",
      type: "pending_peer_review",
      blocking: false,
      source_module: "production",
      source_module_label: "Production",
      source_entity_label: "Schools Gallery",
      scope_department: "production",
      status: "open",
      severity: "at_risk",
      severity_label: "At Risk",
      title: "Gallery is waiting on peer review",
      summary: "Peer review has not cleared yet.",
      owner_user_id: "user-leadership",
      owner_label: "Demo Leadership",
      assigned_team_id: null,
      due_at: "2026-04-02T16:00:00.000Z",
      due_label: "4/2/2026, 11:00:00 AM",
      timing_state: "at_risk",
      timing_label: "At risk in 2d",
      next_action_label: "Open Production",
      action_hash: "#production?project=project-1",
      operational_impact_score: 88,
      snoozed_until: null,
      status_detail: null,
      resolution_note: null,
      source_snapshot: {
        project_id: "project-1"
      },
      created_at: "2026-03-31T09:00:00.000Z",
      updated_at: "2026-03-31T10:00:00.000Z",
      resolved_at: null
    }
  ]
};

const detailPayload: OperationalExceptionDetail = {
  generated_at: "2026-03-31T12:00:00.000Z",
  item: workspacePayload.items[0],
  owner_options: workspacePayload.owner_options,
  history: [
    {
      id: "event-1",
      event_type: "watch.generated",
      summary: "Exception item created from a live source condition.",
      note: null,
      actor_user_id: null,
      actor_name: null,
      metadata: {},
      created_at: "2026-03-31T08:30:00.000Z"
    }
  ],
  available_actions: ["assign_owner", "snooze", "mark_handled"]
};

describe("OperationsExceptions", () => {
  beforeEach(() => {
    window.location.hash = "#operations/exceptions";
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((path: string, _token: string, options?: RequestInit) => {
      if (path.startsWith("/api/exceptions?")) {
        return Promise.resolve(workspacePayload);
      }
      if (path === "/api/exceptions/watch-1" && !options) {
        return Promise.resolve(detailPayload);
      }
      if (path === "/api/exceptions/watch-1/actions") {
        return Promise.resolve(detailPayload);
      }
      throw new Error(`Unhandled request: ${path}`);
    });
  });

  it("renders the ranked exceptions queue and submits quick actions", async () => {
    render(<OperationsExceptions token="token-demo" currentUser={leadershipUser} />);

    expect(await screen.findByText("Exceptions")).toBeInTheDocument();
    expect(await screen.findAllByText("DEMO-001 is missing lead coverage")).toHaveLength(2);
    expect(await screen.findByText("Event History")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Assign owner"), { target: { value: "user-scheduling" } });
    fireEvent.change(screen.getByLabelText("Assignment note"), { target: { value: "Scheduling is taking lead." } });
    fireEvent.click(screen.getByRole("button", { name: "Assign Owner" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/exceptions/watch-1/actions",
        "token-demo",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "assign_owner",
            owner_user_id: "user-scheduling",
            note: "Scheduling is taking lead."
          })
        })
      );
    });

    fireEvent.change(screen.getByLabelText("Snooze reason"), { target: { value: "Waiting on the lead callback." } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/exceptions/watch-1/actions",
        "token-demo",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "snooze",
            reason: "Waiting on the lead callback.",
            duration_minutes: 30,
            note: null
          })
        })
      );
    });

    fireEvent.change(screen.getByLabelText("Handled note"), {
      target: { value: "Owner assigned and same-day staffing fix is in motion." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark Handled" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/exceptions/watch-1/actions",
        "token-demo",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "mark_handled",
            note: "Owner assigned and same-day staffing fix is in motion."
          })
        })
      );
    });
  });
});
