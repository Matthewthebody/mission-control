// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsHomePage } from "../pages/TeamsHomePage";
import type { EmployeeMyWorkResponse } from "../services/employeeExperience";
import type { OperationalApprovalWorkspace, SessionUser, StaffingDashboardResponse } from "../types";

const fetchEmployeeMyWorkMock = vi.fn();
const getOperationalApprovalWorkspaceMock = vi.fn();
const getStaffingDashboardMock = vi.fn();

vi.mock("../services/employeeExperience", () => ({
  fetchEmployeeMyWork: (...args: unknown[]) => fetchEmployeeMyWorkMock(...args)
}));

vi.mock("../services/operationalApprovals", () => ({
  getOperationalApprovalWorkspace: (...args: unknown[]) => getOperationalApprovalWorkspaceMock(...args)
}));

vi.mock("../services/scheduleStaffing", () => ({
  getStaffingDashboard: (...args: unknown[]) => getStaffingDashboardMock(...args)
}));

function createUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-teams-home",
    tenantId: "tenant-demo",
    accountId: "account-teams-home",
    sessionId: "session-teams-home",
    email: "teams.home@example.com",
    fullName: "Taylor Field",
    status: "active",
    department: "schools",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["photographer"],
    permissions: ["schedule.read"],
    authorityTier: "standard_employee",
    primaryJobFunctionProfile: "associate_photographer",
    jobFunctionProfiles: ["associate_photographer"],
    permissionGrants: [],
    effectiveScopes: ["self_only"],
    sessionTrust: {
      identityProvider: "microsoft_entra",
      sessionAssurance: "standard",
      requestTransport: "cookie",
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
    },
    ...overrides
  };
}

function createMyWorkResponse(): EmployeeMyWorkResponse {
  return {
    anchor_date: "2026-04-03",
    window_end_date: "2026-04-10",
    summary: {
      events_today: 2,
      upcoming_events: 3,
      shifts_today: 2,
      upcoming_shifts: 3,
      pending_trade_requests: 1,
      unread_notifications: 2,
      clocked_in_shift_count: 0,
      attention_needed_count: 1,
      closeout_due_count: 1,
      late_or_exception_count: 0,
      mileage_review_count: 0,
      assigned_job_count: 1,
      assigned_event_count: 1,
      assigned_task_count: 1,
      acknowledgement_count: 1,
      owned_exception_count: 0,
      approval_waiting_count: 0,
      recent_change_count: 1,
      next_event_label: "North Gym at 8:00 AM",
      next_shift_label: "North Gym at 8:00 AM"
    },
    shifts: [
      {
        id: "shift-1",
        shoot_id: "shoot-1",
        shoot_code: "SCH-100",
        shoot_title: "North Prep Day",
        shoot_date: "2026-04-03",
        title: "Lead Photographer",
        shift_kind: "field",
        status: "assigned",
        department: "schools",
        staffing_role: "Lead Photographer",
        satisfies_lead_coverage: true,
        starts_at: "2026-04-03T13:00:00.000Z",
        ends_at: "2026-04-03T18:00:00.000Z",
        location_name: "North Gym",
        has_pre_service_notes: true,
        notes_acknowledged: false,
        trade_request_count: 0,
        open_exception_count: 0
      }
    ],
    notifications: [
      {
        id: "notification-1",
        notification_type: "approval",
        channel: "in_app",
        priority: "high",
        status: "unread",
        title: "Roster update needed",
        body: "Double-check the roster before call time.",
        deep_link: "#dashboard/alerts",
        created_at: "2026-04-03T12:30:00.000Z"
      }
    ],
    jobs: [
      {
        id: "job-1",
        job_number: "JOB-100",
        title: "North Prep Day",
        department: "schools",
        status: "staffed",
        status_label: "Staffed",
        organization_display_name: "North District",
        assigned_task_count: 1,
        assigned_event_count: 1,
        open_exception_count: 0,
        next_event_at: "2026-04-03T13:00:00.000Z"
      }
    ],
    events: [
      {
        id: "shift-1",
        event_id: "shift-1",
        source: "work_shift",
        source_record_type: "work_shift",
        source_record_id: "shift-1",
        shift_id: "shift-1",
        linked_job_id: "job-1",
        linked_job_number: "JOB-100",
        linked_job_title: "North Prep Day",
        title: "SCH-100",
        subtitle: "North Prep Day",
        department: "schools",
        staffing_role: "Lead Photographer",
        status: "assigned",
        starts_at: "2026-04-03T13:00:00.000Z",
        ends_at: "2026-04-03T18:00:00.000Z",
        location_name: "North Gym",
        location_address: null,
        action_label: "Upcoming",
        follow_through_label: null,
        note_summary: null,
        open_exception_count: 0,
        notes_acknowledged: false
      }
    ],
    tasks: [
      {
        id: "task-1",
        task_number: "TSK-SCH-2026-0001",
        title: "Confirm roster",
        department: "schools",
        status: "in_progress",
        status_label: "In Progress",
        priority: "normal",
        due_at: "2026-04-03T12:45:00.000Z",
        blocked_reason: null,
        job_id: "job-1",
        event_id: null,
        workflow_run_id: null,
        linked_job_number: "JOB-100",
        linked_job_title: "North Prep Day",
        organization_display_name: "North District",
        proof_required: false
      }
    ],
    acknowledgements: [
      {
        id: "ack-1",
        acknowledgement_type: "pre_service_notes",
        title: "SCH-100",
        summary: "Review pre-service notes before arrival.",
        department: "schools",
        due_at: "2026-04-03T13:00:00.000Z",
        event_id: "shift-1",
        source_record_type: "work_shift",
        source_record_id: "shift-1",
        shift_id: "shift-1",
        linked_job_id: "job-1",
        linked_job_number: "JOB-100",
        linked_job_title: "North Prep Day",
        action_label: "Acknowledge notes"
      }
    ],
    exceptions: [],
    approvals: [],
    recent_changes: [
      {
        id: "change-1",
        change_type: "notification",
        title: "Roster update needed",
        summary: "Double-check the roster before call time.",
        created_at: "2026-04-03T12:30:00.000Z",
        tone: "action_needed",
        department: "schools",
        related_record_type: "notification",
        related_record_id: "notification-1"
      }
    ],
    schedule_context: {
      active_now_count: 0,
      upcoming_today_count: 1,
      current_event: null,
      next_event: {
        id: "shift-1",
        event_id: "shift-1",
        source: "work_shift",
        source_record_type: "work_shift",
        source_record_id: "shift-1",
        shift_id: "shift-1",
        linked_job_id: "job-1",
        linked_job_number: "JOB-100",
        linked_job_title: "North Prep Day",
        title: "SCH-100",
        subtitle: "North Prep Day",
        department: "schools",
        staffing_role: "Lead Photographer",
        status: "assigned",
        starts_at: "2026-04-03T13:00:00.000Z",
        ends_at: "2026-04-03T18:00:00.000Z",
        location_name: "North Gym",
        location_address: null,
        action_label: "Upcoming",
        follow_through_label: null,
        note_summary: null,
        open_exception_count: 0,
        notes_acknowledged: false
      }
    }
  };
}

function createApprovalsResponse(): OperationalApprovalWorkspace {
  return {
    generated_at: "2026-04-03T12:00:00.000Z",
    summary: {
      awaiting_my_decision: 2,
      submitted_by_me: 0,
      overdue: 1,
      escalated: 0,
      pending_blocking: 1,
      needs_clarification: 0
    },
    awaiting_my_decision: [
      {
        id: "approval-1",
        request_type: "staffing_exception_approval",
        request_type_label: "Staffing Exception Approval",
        status: "pending",
        status_label: "Pending",
        source_module: "schedule",
        source_entity_type: "shoot",
        source_entity_id: "shoot-1",
        source_entity_label: "North Prep Day",
        requested_action_code: "approve",
        request_title: "Approve staffing override",
        request_summary: "Lead override requested.",
        reason: "Coverage gap",
        severity: "high",
        blocking: true,
        requester_department: "schools",
        requested_by_user_id: "user-requester",
        requested_by_name: "Requester",
        approval_chain: ["department_manager"],
        current_approver_user_id: "user-teams-home",
        current_approver_name: "Taylor Field",
        current_approver_role_group: "department_manager",
        current_approver_role_group_label: "Department Manager",
        sla_due_at: null,
        overdue: true,
        escalated: false,
        escalation_level: 0,
        decided_at: null,
        executed_at: null,
        created_at: "2026-04-03T11:00:00.000Z",
        updated_at: "2026-04-03T11:30:00.000Z",
        can_decide: true,
        can_cancel: false,
        can_resubmit: false,
        can_delegate: false
      }
    ],
    submitted_by_me: [],
    overdue: [],
    escalated: []
  };
}

function createStaffingResponse(): StaffingDashboardResponse {
  return {
    generated_at: "2026-04-03T12:00:00.000Z",
    anchor_date: "2026-04-03",
    summary: {
      shoots_today: 4,
      shoots_tomorrow: 2,
      open_staffing_slots: 3,
      shoots_missing_lead: 1,
      understaffed_shoots: 2,
      conflict_warnings: 1,
      available_staff_today: 9,
      unavailable_staff_today: 2
    },
    open_coverage: [
      {
        shoot_id: "shoot-1",
        shoot_code: "SCH-100",
        title: "North Prep Day",
        shoot_date: "2026-04-03",
        department: "schools",
        location_label: "North Gym",
        time_label: "8:00 AM",
        assigned_staff_count: 3,
        planned_staff_count: 4,
        required_lead_count: 1,
        lead_coverage_count: 1,
        lead_present: true,
        lead_name: "Alex Lead",
        missing_lead: false,
        under_staffed: true,
        conflict_warning_count: 1,
        sync_state: "ready",
        next_action: "fill_open_slot"
      }
    ],
    missing_lead: [
      {
        shoot_id: "shoot-2",
        shoot_code: "SCH-101",
        title: "South Prep Day",
        shoot_date: "2026-04-03",
        department: "schools",
        location_label: "South Gym",
        time_label: "10:00 AM",
        assigned_staff_count: 2,
        planned_staff_count: 3,
        required_lead_count: 1,
        lead_coverage_count: 0,
        lead_present: false,
        lead_name: null,
        missing_lead: true,
        under_staffed: true,
        conflict_warning_count: 0,
        sync_state: "ready",
        next_action: "assign_lead"
      }
    ],
    availability_groups: []
  };
}

describe("TeamsHomePage", () => {
  beforeEach(() => {
    fetchEmployeeMyWorkMock.mockReset();
    getOperationalApprovalWorkspaceMock.mockReset();
    getStaffingDashboardMock.mockReset();
    window.history.replaceState(null, "", "/?teams=1#teams/home");
  });

  it("renders the focused Teams home modules and wires quick search actions", async () => {
    fetchEmployeeMyWorkMock.mockResolvedValue(createMyWorkResponse());
    getOperationalApprovalWorkspaceMock.mockResolvedValue(createApprovalsResponse());
    getStaffingDashboardMock.mockResolvedValue(createStaffingResponse());
    const onOpenConcierge = vi.fn();

    render(
      <TeamsHomePage
        token="teams-token"
        currentUser={createUser({ permissions: ["schedule.read", "approvals.view", "staffing.view"] })}
        onOpenConcierge={onOpenConcierge}
      />
    );

    expect(await screen.findByText("My Jobs / Assignments")).toBeInTheDocument();
    expect(screen.getByText("Today's Schedule")).toBeInTheDocument();
    expect(screen.getByText("My Tasks / Approvals")).toBeInTheDocument();
    expect(screen.getByText("Staffing Alerts")).toBeInTheDocument();
    expect(screen.getByText("Quick Search")).toBeInTheDocument();
    expect(screen.getByText("Recent Important Updates")).toBeInTheDocument();
    expect(screen.getByText("Approve staffing override")).toBeInTheDocument();
    expect(screen.getAllByText("North Prep Day").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Today's schedule" }));
    expect(onOpenConcierge).toHaveBeenCalledWith("today's schedule");

    fireEvent.click(screen.getAllByRole("button", { name: /North Prep Day/i })[0]);
    expect(window.location.hash).toBe("#schedule?shoot=shoot-1");
  });

  it("keeps oversight-only modules hidden for field roles without the matching access", async () => {
    fetchEmployeeMyWorkMock.mockResolvedValue(createMyWorkResponse());
    getOperationalApprovalWorkspaceMock.mockResolvedValue(createApprovalsResponse());
    getStaffingDashboardMock.mockResolvedValue(createStaffingResponse());

    render(<TeamsHomePage token="teams-token" currentUser={createUser()} onOpenConcierge={vi.fn()} />);

    expect(await screen.findByText("My Jobs / Assignments")).toBeInTheDocument();
    await waitFor(() => {
      expect(getOperationalApprovalWorkspaceMock).not.toHaveBeenCalled();
      expect(getStaffingDashboardMock).not.toHaveBeenCalled();
    });
    expect(screen.queryByText("Staffing Alerts")).not.toBeInTheDocument();
    expect(screen.getByText("Your role does not need the shared approvals desk today, so this card stays focused on personal follow-through.")).toBeInTheDocument();
  });

  it("shows the communications quick-open module when the user can access Teams communication workflows", async () => {
    fetchEmployeeMyWorkMock.mockResolvedValue(createMyWorkResponse());
    getOperationalApprovalWorkspaceMock.mockResolvedValue(createApprovalsResponse());
    getStaffingDashboardMock.mockResolvedValue(createStaffingResponse());

    render(
      <TeamsHomePage
        token="teams-token"
        currentUser={createUser({
          permissions: ["schedule.read", "communication.use", "communication.send"],
          communicationIdentity: {
            provider: "microsoft_teams",
            microsoftUserId: "ms-user-1",
            microsoftTenantId: "ms-tenant-1",
            communicationEnabled: true,
            teamsChatDefaultTarget: null,
            linkedAt: "2026-04-03T12:00:00.000Z",
            lastVerifiedAt: "2026-04-03T12:00:00.000Z",
            status: "linked_ready"
          }
        })}
        onOpenConcierge={vi.fn()}
      />
    );

    expect(await screen.findByText("Teams Entry Points")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Actions" }));
    expect(window.location.hash).toBe("#teams/communications");
  });
});
