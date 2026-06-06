// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleAwareHomeDashboard } from "../components/jobs/SharedJobCommandCenter";
import { Alerts } from "../pages/Alerts";
import { ExecutiveDashboardPage } from "../pages/ExecutiveDashboardPage";
import { SharedWatchlistPage } from "../pages/SharedWatchlistPage";
import type { SessionUser } from "../types";

const acknowledgeSharedWatchFlagMock = vi.fn();
const dismissSharedWatchFlagMock = vi.fn();
const escalateSharedWatchFlagMock = vi.fn();
const getSharedDashboardMock = vi.fn();
const listSharedAlertsMock = vi.fn();
const listSharedDashboardWidgetPreferencesMock = vi.fn();
const listSharedWatchlistMock = vi.fn();
const markSharedAlertActedMock = vi.fn();
const markSharedAlertReadMock = vi.fn();
const resolveSharedWatchFlagMock = vi.fn();
const saveSharedDashboardWidgetPreferencesMock = vi.fn();
const snoozeSharedWatchFlagMock = vi.fn();
const listDirectoryOwnerOptionsMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  acknowledgeSharedWatchFlag: (...args: unknown[]) => acknowledgeSharedWatchFlagMock(...args),
  dismissSharedWatchFlag: (...args: unknown[]) => dismissSharedWatchFlagMock(...args),
  escalateSharedWatchFlag: (...args: unknown[]) => escalateSharedWatchFlagMock(...args),
  getSharedDashboard: (...args: unknown[]) => getSharedDashboardMock(...args),
  listSharedAlerts: (...args: unknown[]) => listSharedAlertsMock(...args),
  listSharedDashboardWidgetPreferences: (...args: unknown[]) => listSharedDashboardWidgetPreferencesMock(...args),
  listSharedExceptions: (...args: unknown[]) => listSharedWatchlistMock(...args),
  markSharedAlertActed: (...args: unknown[]) => markSharedAlertActedMock(...args),
  markSharedAlertRead: (...args: unknown[]) => markSharedAlertReadMock(...args),
  resolveSharedWatchFlag: (...args: unknown[]) => resolveSharedWatchFlagMock(...args),
  saveSharedDashboardWidgetPreferences: (...args: unknown[]) => saveSharedDashboardWidgetPreferencesMock(...args),
  snoozeSharedWatchFlag: (...args: unknown[]) => snoozeSharedWatchFlagMock(...args)
}));

vi.mock("../services/organizationApi", () => ({
  listDirectoryOwnerOptions: (...args: unknown[]) => listDirectoryOwnerOptionsMock(...args)
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

const managerUser: SessionUser = {
  id: "user-ops",
  tenantId: "tenant-demo",
  accountId: "account-demo",
  sessionId: "session-demo",
  email: "ops@example.com",
  fullName: "Ops Manager",
  status: "active",
  department: "sports",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["manager"],
  permissions: ["shoot.read", "shoot.create", "shoot.update", "alerts.read", "sports_hub.manage", "project.manage"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "director_of_sports_photography",
  jobFunctionProfiles: ["director_of_sports_photography"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

function buildWatchFlagItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "flag-1",
    tenant_id: "tenant-demo",
    job_id: "job-1",
    job_day_id: null,
    production_item_id: "prod-1",
    approval_request_id: null,
    qa_review_record_id: null,
    deliverable_item_id: null,
    source_entity_type: "production_item",
    source_entity_id: "prod-1",
    severity: "critical",
    flag_type: "production_blocked",
    title: "Banner batch blocked",
    description: "Vendor confirmation is missing for a same-week banner run.",
    status: "open",
    owner_user_id: "owner-1",
    created_by_user_id: "user-ops",
    due_at: "2026-04-03T12:00:00.000Z",
    snooze_until: null,
    escalated_at: null,
    escalated_to_role: null,
    resolved_at: null,
    resolved_by_user_id: null,
    auto_key: null,
    created_at: "2026-04-02T08:00:00.000Z",
    updated_at: "2026-04-02T08:00:00.000Z",
    department_type: "sports",
    job_number: "SPT-2026-0012",
    job_title: "Metro FC Banner Day",
    organization_id: "org-1",
    organization_name: "Metro FC",
    owner_name: "Alex Owner",
    created_by_name: "Ops Manager",
    resolved_by_name: null,
    source_entity_label: "Production Item",
    source_scope_label: "Sports",
    next_action_label: "Unblock production",
    priority_rank: 510,
    ...overrides
  } as any;
}

function buildDashboardResponse(overrides: Record<string, unknown> = {}) {
  const urgentWatch = buildWatchFlagItem();
  return {
    scope: "home",
    department_type: null,
    summary: {
      jobs_today: 4,
      jobs_next_7_days: 11,
      urgent_count: 3,
      critical_watch_count: 1,
      high_watch_count: 2,
      blocked_production_count: 2,
      overdue_approval_count: 1,
      overdue_checklist_count: 2,
      awaiting_checklist_approval_count: 1,
      rejected_checklist_count: 1,
      blocked_job_count: 2,
      delivery_risk_count: 1,
      staffing_gap_count: 2,
      missing_ready_confirmation_count: 1
    },
    health: {
      score: 62,
      state: "at_risk",
      explanation: ["Blocked production and same-day staffing gaps are driving operational pressure."]
    },
    widgets: [
      {
        widget_key: "urgent_watch_next_24h",
        title: "Priority Exceptions Next 24h",
        metric: "3",
        description: "Unresolved high-severity items due in the next 24 hours.",
        route_hash: "#exceptions",
        tone: "danger",
        count: 3
      },
      {
        widget_key: "blocked_production",
        title: "Blocked Production",
        metric: "2",
        description: "Production items blocked and needing intervention.",
        route_hash: "#production",
        tone: "warning",
        count: 2
      },
      {
        widget_key: "qa_rework_queue",
        title: "QA / Rework",
        metric: "3",
        description: "Items needing QA follow-through or rework.",
        route_hash: "#production",
        tone: "info",
        count: 3
      }
    ],
    widget_layout: {
      role_key: "leadership",
      supports_personalization: true,
      items: [
        {
          widget_key: "urgent_watch_next_24h",
          required: true,
          default_visible: true,
          default_position: 0,
          reason: "Leadership needs priority exceptions pinned on every homepage."
        },
        {
          widget_key: "blocked_production",
          required: true,
          default_visible: true,
          default_position: 1,
          reason: "Blocked production stays pinned for leadership oversight."
        },
        {
          widget_key: "qa_rework_queue",
          required: false,
          default_visible: false,
          default_position: 2,
          reason: "Optional queue for deeper QA and rework monitoring."
        }
      ]
    },
    checklist_attention_summary: {
      total_count: 3,
      overdue_count: 2,
      awaiting_approval_count: 1,
      rejected_count: 1,
      blocked_count: 2,
      missing_proof_count: 1,
      assigned_to_me_count: 1
    },
    checklist_attention: [
      {
        instance_id: "checklist-1",
        scope_type: "production_item",
        scope_id: "prod-1",
        department_type: "sports",
        job_id: "job-1",
        shoot_id: null,
        production_item_id: "prod-1",
        title: "Peer Review Sign-Off",
        template_name: "Peer Review Sign-Off",
        target_title: "Banner batch",
        organization_name: "Metro FC",
        owner_user_id: "owner-1",
        owner_name: "Alex Owner",
        reviewer_user_id: "reviewer-1",
        approver_user_id: "approver-1",
        status: "overdue",
        attention_state: "overdue",
        blocking_level: "hard_block",
        due_at: "2026-04-02T10:00:00.000Z",
        progress_percent: 72,
        missing_required_count: 1,
        missing_proof_count: 1,
        missing_approval: false,
        blocked_transition: true,
        awaiting_approval: false,
        rejected: false,
        overdue: true
      },
      {
        instance_id: "checklist-2",
        scope_type: "shoot",
        scope_id: "shoot-1",
        department_type: "sports",
        job_id: "job-1",
        shoot_id: "shoot-1",
        production_item_id: null,
        title: "End-of-Shoot Wrap",
        template_name: "End-of-Shoot Wrap",
        target_title: "Metro FC Banner Day",
        organization_name: "Metro FC",
        owner_user_id: "owner-1",
        owner_name: "Alex Owner",
        reviewer_user_id: null,
        approver_user_id: "manager-1",
        status: "submitted",
        attention_state: "awaiting_approval",
        blocking_level: "hard_block",
        due_at: "2026-04-02T12:00:00.000Z",
        progress_percent: 100,
        missing_required_count: 0,
        missing_proof_count: 0,
        missing_approval: true,
        blocked_transition: true,
        awaiting_approval: true,
        rejected: false,
        overdue: false
      },
      {
        instance_id: "checklist-3",
        scope_type: "production_item",
        scope_id: "prod-2",
        department_type: "sports",
        job_id: "job-2",
        shoot_id: null,
        production_item_id: "prod-2",
        title: "Captura Upload QA",
        template_name: "Captura Upload QA",
        target_title: "Coach proof packet",
        organization_name: "Metro FC",
        owner_user_id: "owner-2",
        owner_name: "Taylor Lead",
        reviewer_user_id: "reviewer-2",
        approver_user_id: null,
        status: "rejected",
        attention_state: "rejected",
        blocking_level: "soft_block",
        due_at: "2026-04-03T08:00:00.000Z",
        progress_percent: 84,
        missing_required_count: 0,
        missing_proof_count: 0,
        missing_approval: false,
        blocked_transition: false,
        awaiting_approval: false,
        rejected: true,
        overdue: false
      }
    ],
    urgent_watch: [urgentWatch],
    upcoming_risks: [buildWatchFlagItem({ id: "flag-2", severity: "high", title: "Proof approval overdue", flag_type: "approval_delay" })],
    today_jobs: [
      {
        id: "job-1",
        department_type: "sports",
        job_number: "SPT-2026-0012",
        organization_name: "Metro FC",
        title: "Metro FC Banner Day",
        primary_day_date: "2026-04-02",
        primary_location_name: "Main Arena",
        staffing_status: "gap_flagged",
        readiness_status: "at_risk",
        urgent_flag_count: 2,
        risk_status: "high"
      }
    ],
    blocked_production: [
      {
        id: "prod-1",
        title: "Banner batch",
        job_number: "SPT-2026-0012",
        organization_name: "Metro FC",
        status: "blocked"
      }
    ],
    overdue_approvals: [
      {
        id: "approval-1",
        title: "Coach proof packet",
        organization_name: "Metro FC",
        approval_status: "overdue"
      }
    ],
    delivery_risks: [
      {
        id: "deliverable-1",
        title: "Banner shipment",
        organization_name: "Metro FC",
        deliverable_status: "issue_flagged"
      }
    ],
    recent_movement: [
      {
        id: "movement-1",
        event_type: "watch_flag_resolved",
        summary: "Critical staffing gap resolved for Metro FC Banner Day",
        created_at: "2026-04-02T09:00:00.000Z",
        actor_name: "Ops Manager",
        department_type: "sports",
        job_id: "job-1",
        job_number: "SPT-2026-0012",
        organization_name: "Metro FC"
      }
    ],
    workload_pressure: [
      {
        owner_user_id: "owner-1",
        owner_name: "Alex Owner",
        open_flag_count: 3,
        blocked_production_count: 2,
        due_today_count: 1,
        score: 8
      }
    ],
    production_snapshot: {
      open_items: 12,
      overdue_items: 3,
      blocked_items: 2,
      due_this_week: 7,
      average_turnaround_days: 3.4,
      on_time_release_percentage: 91,
      rework_rate: 15,
      first_pass_approval_rate: 83
    },
    ...overrides
  } as any;
}

function buildAlertPayload() {
  return {
    summary: {
      unread_count: 1,
      critical_count: 1,
      acted_count: 0
    },
    items: [
      {
        id: "delivery-1",
        watch_flag_id: "flag-1",
        read_at: null,
        acted_at: null,
        action_type: null,
        job_id: "job-1",
        job_number: "SPT-2026-0012",
        organization_name: "Metro FC",
        department_type: "sports",
        watch_flag: buildWatchFlagItem(),
        alert_event: {
          id: "alert-1",
          severity: "critical",
          title: "Critical staffing gap",
          message: "Critical issue on SPT-2026-0012: Banner batch blocked",
          triggered_at: "2026-04-02T08:00:00.000Z"
        }
      }
    ]
  } as any;
}

function buildWatchlistPayload() {
  return {
    summary: {
      total_count: 2,
      next_24_hours_count: 1,
      critical_count: 1,
      high_count: 1,
      snoozed_count: 0,
      escalated_count: 0
    },
    saved_views: [
      { id: "view-1", name: "Next 24 Hours" },
      { id: "view-2", name: "Blocked Production" }
    ],
    items: [
      buildWatchFlagItem(),
      buildWatchFlagItem({
        id: "flag-2",
        severity: "high",
        title: "Coach approval overdue",
        flag_type: "approval_delay",
        source_entity_type: "approval_request",
        source_entity_label: "Approval Request"
      })
    ]
  } as any;
}

beforeEach(() => {
  getSharedDashboardMock.mockReset();
  listSharedAlertsMock.mockReset();
  listSharedDashboardWidgetPreferencesMock.mockReset();
  saveSharedDashboardWidgetPreferencesMock.mockReset();
  listSharedWatchlistMock.mockReset();
  acknowledgeSharedWatchFlagMock.mockReset();
  snoozeSharedWatchFlagMock.mockReset();
  resolveSharedWatchFlagMock.mockReset();
  dismissSharedWatchFlagMock.mockReset();
  escalateSharedWatchFlagMock.mockReset();
  markSharedAlertReadMock.mockReset();
  markSharedAlertActedMock.mockReset();
  listDirectoryOwnerOptionsMock.mockReset();
  window.location.hash = "#dashboard";

  getSharedDashboardMock.mockResolvedValue(buildDashboardResponse());
  listSharedAlertsMock.mockResolvedValue(buildAlertPayload());
  listSharedDashboardWidgetPreferencesMock.mockResolvedValue({ preferences: [] });
  saveSharedDashboardWidgetPreferencesMock.mockResolvedValue({ preferences: [] });
  listSharedWatchlistMock.mockResolvedValue(buildWatchlistPayload());
  acknowledgeSharedWatchFlagMock.mockResolvedValue(undefined);
  snoozeSharedWatchFlagMock.mockResolvedValue(undefined);
  resolveSharedWatchFlagMock.mockResolvedValue(undefined);
  dismissSharedWatchFlagMock.mockResolvedValue(undefined);
  escalateSharedWatchFlagMock.mockResolvedValue(undefined);
  markSharedAlertReadMock.mockResolvedValue({});
  markSharedAlertActedMock.mockResolvedValue({});
  listDirectoryOwnerOptionsMock.mockResolvedValue({
    owners: [{ user_id: "owner-1", full_name: "Alex Owner", department: "sports" }]
  });
});

afterEach(() => {
  cleanup();
});

describe("shared command center", () => {
  it("renders the role-aware dashboard and saves widget visibility", async () => {
    render(
      <RoleAwareHomeDashboard
        token="token-demo"
        currentUser={managerUser}
        scope="home"
        title="Operational Dashboard"
        summary="Shared command layer summary."
      />
    );

    expect(await screen.findByText("Operational Dashboard")).toBeInTheDocument();
    expect((await screen.findAllByText("Priority Exceptions Next 24h")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Blocked Production")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Overdue Checklists").length).toBeGreaterThan(0);
    expect(screen.getByText("Checklist Attention")).toBeInTheDocument();
    expect(screen.getAllByText("Peer Review Sign-Off").length).toBeGreaterThan(0);
    expect(screen.getByText("Production Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Homepage Layout")).toBeInTheDocument();
    expect(getSharedDashboardMock).toHaveBeenCalledWith("token-demo", "home", undefined);

    expect(screen.getByLabelText("Priority Exceptions Next 24h")).toBeDisabled();
    expect(screen.getByText("Leadership")).toBeInTheDocument();
    expect(screen.getAllByText("QA / Rework").length).toBe(1);
    fireEvent.click(screen.getByLabelText("QA / Rework"));
    expect(screen.getAllByText("QA / Rework").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByLabelText("Blocked Production"));
    fireEvent.click(screen.getByRole("button", { name: "Move Blocked Production up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Layout" }));

    await waitFor(() => {
      expect(saveSharedDashboardWidgetPreferencesMock).toHaveBeenCalled();
    });
    expect(saveSharedDashboardWidgetPreferencesMock).toHaveBeenCalledWith(
      "token-demo",
      expect.objectContaining({
        preferences: expect.arrayContaining([
          expect.objectContaining({ widget_key: "blocked_production", position_index: 0 }),
          expect.objectContaining({ widget_key: "urgent_watch_next_24h", is_visible: true })
        ])
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset To Role Default" }));
    expect(screen.getByLabelText("Blocked Production")).toBeChecked();
  });

  it("does not refetch the role-aware dashboard for equivalent user object rerenders", async () => {
    const { rerender } = render(
      <RoleAwareHomeDashboard
        token="token-demo"
        currentUser={managerUser}
        scope="home"
        departmentType="sports"
        title="Sports Command Layer"
        summary="Shared command layer summary."
      />
    );

    expect(await screen.findByText("Sports Command Layer")).toBeInTheDocument();
    expect(getSharedDashboardMock).toHaveBeenCalledTimes(1);
    expect(listSharedAlertsMock).toHaveBeenCalledTimes(1);

    rerender(
      <RoleAwareHomeDashboard
        token="token-demo"
        currentUser={{ ...managerUser }}
        scope="home"
        departmentType="sports"
        title="Sports Command Layer"
        summary="Shared command layer summary."
      />
    );

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(getSharedDashboardMock).toHaveBeenCalledTimes(1);
    expect(listSharedAlertsMock).toHaveBeenCalledTimes(1);
  });

  it("renders the executive dashboard through the shared widget system", async () => {
    const executiveResponse = buildDashboardResponse({ scope: "executive" });
    executiveResponse.widget_layout.supports_personalization = false;
    getSharedDashboardMock.mockResolvedValueOnce(executiveResponse);

    render(<ExecutiveDashboardPage token="token-demo" currentUser={managerUser} />);

    expect(await screen.findByText("Executive Dashboard")).toBeInTheDocument();
    await waitFor(() => {
      expect(getSharedDashboardMock).toHaveBeenCalledWith("token-demo", "executive", undefined);
    });
    expect(screen.getByText("Urgent Next 24 Hours")).toBeInTheDocument();
  });

  it("supports drag reordering inside the homepage widget layout editor", async () => {
    render(
      <RoleAwareHomeDashboard
        token="token-demo"
        currentUser={managerUser}
        scope="home"
        title="Operational Dashboard"
        summary="Shared command layer summary."
      />
    );

    expect(await screen.findByText("Homepage Layout")).toBeInTheDocument();

    const dragData = {
      effectAllowed: "move",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("qa_rework_queue")
    };

    const qaRow = screen.getByLabelText("QA / Rework").closest(".shared-command__widget-picker-row");
    const urgentRow = screen.getByLabelText("Priority Exceptions Next 24h").closest(".shared-command__widget-picker-row");

    expect(qaRow).not.toBeNull();
    expect(urgentRow).not.toBeNull();

    fireEvent.dragStart(qaRow as Element, { dataTransfer: dragData });
    fireEvent.dragOver(urgentRow as Element);
    fireEvent.drop(urgentRow as Element, { dataTransfer: dragData });
    fireEvent.click(screen.getByRole("button", { name: "Save Layout" }));

    await waitFor(() => {
      expect(saveSharedDashboardWidgetPreferencesMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          preferences: expect.arrayContaining([expect.objectContaining({ widget_key: "qa_rework_queue", position_index: 0 })])
        })
      );
    });
  });

  it("renders the shared exceptions queue and supports triage actions", async () => {
    render(<SharedWatchlistPage token="token-demo" currentUser={managerUser} departmentType="sports" title="Sports Exceptions" />);

    expect(await screen.findByText("Sports Exceptions")).toBeInTheDocument();
    expect((await screen.findAllByText("Banner batch blocked")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Blocked Production" }));
    await waitFor(() => {
      expect(listSharedWatchlistMock).toHaveBeenLastCalledWith("token-demo", expect.objectContaining({ view_id: "view-2" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => {
      expect(acknowledgeSharedWatchFlagMock).toHaveBeenCalledWith("token-demo", "flag-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    expect(await screen.findByText("Snooze Exception")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Waiting on vendor callback" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Snooze" }));
    await waitFor(() => {
      expect(snoozeSharedWatchFlagMock).toHaveBeenCalledWith("token-demo", "flag-1", expect.any(String), "Waiting on vendor callback");
    });

    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    expect(await screen.findByText("Escalate Exception")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Escalation Note"), { target: { value: "Escalating to leadership." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Escalation" }));
    await waitFor(() => {
      expect(escalateSharedWatchFlagMock).toHaveBeenCalledWith(
        "token-demo",
        "flag-1",
        expect.objectContaining({ note: "Escalating to leadership." })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(await screen.findByText("Resolve Exception")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Resolution Note"), { target: { value: "Replacement vendor confirmed." } });
    fireEvent.click(screen.getByRole("button", { name: "Resolve Flag" }));
    await waitFor(() => {
      expect(resolveSharedWatchFlagMock).toHaveBeenCalledWith(
        "token-demo",
        "flag-1",
        expect.objectContaining({ resolution_note: "Replacement vendor confirmed." })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Dismiss Exception")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dismissal Reason"), { target: { value: "Client withdrew request." } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Flag" }));
    await waitFor(() => {
      expect(dismissSharedWatchFlagMock).toHaveBeenCalledWith("token-demo", "flag-1", "Client withdrew request.");
    });
  });

  it("renders the alert center and supports read, acknowledge, and resolve actions", async () => {
    render(<Alerts token="token-demo" socket={null} />);

    expect(await screen.findByText("Notification Center")).toBeInTheDocument();
    expect(await screen.findByText("Critical staffing gap")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));
    await waitFor(() => {
      expect(markSharedAlertReadMock).toHaveBeenCalledWith("token-demo", "delivery-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => {
      expect(acknowledgeSharedWatchFlagMock).toHaveBeenCalledWith("token-demo", "flag-1");
      expect(markSharedAlertActedMock).toHaveBeenCalledWith("token-demo", "delivery-1", "acknowledge_watch_flag");
    });

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(resolveSharedWatchFlagMock).toHaveBeenCalledWith(
        "token-demo",
        "flag-1",
        expect.objectContaining({ resolution_note: "Resolved from alert center" })
      );
      expect(markSharedAlertActedMock).toHaveBeenCalledWith("token-demo", "delivery-1", "resolve_watch_flag");
    });
  });
});
