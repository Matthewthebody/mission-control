import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Approvals } from "../pages/Approvals";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

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

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args)
}));

const routedApprover: SessionUser = {
  id: "user-approver",
  tenantId: "tenant-demo",
  accountId: "account-approver",
  sessionId: "session-approver",
  email: "approver@example.com",
  fullName: "Department Supervisor",
  status: "active",
  department: "schools",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["office_employee"],
  permissions: ["trade.request", "pto.request", "notification.read", "schedule.read"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "schools_client_success",
  jobFunctionProfiles: ["schools_client_success"],
  permissionGrants: [],
  effectiveScopes: ["department_only"],
  sessionTrust: standardSessionTrust
};

describe("Approvals page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("shows routed trade and PTO approvals even without broad approval permission codes", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/shifts/trade-requests/list") {
        return [
          {
            id: "trade-1",
            shift_id: "shift-1",
            requester_user_id: "user-requester",
            requester_name: "Field Photographer",
            requested_with_user_id: "user-recipient",
            requested_with_name: "Backup Photographer",
            approver_user_id: "user-approver",
            approver_name: "Department Supervisor",
            shift_title: "North Gym Coverage",
            shoot_code: "DEMO-001",
            shoot_title: "Spring Portrait Day",
            department: "schools",
            starts_at: "2026-03-25T14:15:00.000Z",
            ends_at: "2026-03-25T17:15:00.000Z",
            staffing_role: "photographer",
            satisfies_lead_coverage: false,
            status: "pending_manager",
            reason: "Need swap coverage",
            same_day_exception_eligible: false,
            requested_with_conflict: false,
            conflict_summary: null,
            recipient_notes: null,
            manager_notes: null,
            notes: null,
            created_at: "2026-03-25T10:00:00.000Z"
          }
        ];
      }
      if (path === "/api/shifts/pto-requests/list") {
        return [
          {
            id: "pto-1",
            user_id: "user-requester",
            user_name: "Field Photographer",
            department: "schools",
            requested_on: "2026-03-28",
            request_unit: "full_day",
            requested_hours: 7.5,
            approver_user_id: "user-approver",
            approver_name: "Department Supervisor",
            status: "submitted",
            reason: "Family event",
            notes: null,
            created_at: "2026-03-25T11:00:00.000Z"
          }
        ];
      }
      if (path.startsWith("/api/shifts?assigned_user_id=")) {
        return [
          {
            id: "shift-1",
            title: "North Gym Coverage",
            starts_at: "2026-03-25T14:15:00.000Z",
            ends_at: "2026-03-25T17:15:00.000Z",
            status: "published",
            shoot_code: "DEMO-001",
            shoot_title: "Spring Portrait Day",
            location_name: "North Gym",
            staffing_role: "photographer",
            satisfies_lead_coverage: false
          }
        ];
      }
      if (path === "/api/shifts/shift-1/trade-candidates") {
        return [];
      }
      if (path === "/api/alerts?status=open") {
        return [];
      }
      if (path.startsWith("/api/attendance/exceptions?")) {
        return [];
      }
      if (path === "/api/notifications") {
        return [];
      }
      if (path === "/api/approvals/operational") {
        return {
          generated_at: "2026-03-25T12:00:00.000Z",
          summary: {
            awaiting_my_decision: 1,
            submitted_by_me: 0,
            overdue: 0,
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
              source_module: "scheduling",
              source_entity_type: "shoot",
              source_entity_id: "shoot-1",
              source_entity_label: "DEMO-001",
              requested_action_code: "schedule.staffing.publish",
              request_title: "Approval needed to publish staffing for DEMO-001",
              request_summary: "Publishing still carries operational staffing risk.",
              reason: "Need same-day approval",
              severity: "high",
              blocking: true,
              requester_department: "schools",
              requested_by_user_id: "user-requester",
              requested_by_name: "Field Photographer",
              approval_chain: ["scheduling_lead"],
              current_approver_user_id: "user-approver",
              current_approver_name: "Department Supervisor",
              current_approver_role_group: "scheduling_lead",
              current_approver_role_group_label: "Scheduling Lead",
              sla_due_at: "2026-03-25T15:00:00.000Z",
              overdue: false,
              escalated: false,
              escalation_level: 0,
              decided_at: null,
              executed_at: null,
              created_at: "2026-03-25T12:00:00.000Z",
              updated_at: "2026-03-25T12:00:00.000Z",
              can_decide: true,
              can_cancel: false,
              can_resubmit: false,
              can_delegate: true
            }
          ],
          submitted_by_me: [],
          overdue: [],
          escalated: []
        };
      }
      if (path === "/api/approvals/operational/approval-1") {
        return {
          request: {
            id: "approval-1",
            request_type: "staffing_exception_approval",
            request_type_label: "Staffing Exception Approval",
            status: "pending",
            status_label: "Pending",
            source_module: "scheduling",
            source_entity_type: "shoot",
            source_entity_id: "shoot-1",
            source_entity_label: "DEMO-001",
            requested_action_code: "schedule.staffing.publish",
            request_title: "Approval needed to publish staffing for DEMO-001",
            request_summary: "Publishing still carries operational staffing risk.",
            reason: "Need same-day approval",
            severity: "high",
            blocking: true,
            requester_department: "schools",
            requested_by_user_id: "user-requester",
            requested_by_name: "Field Photographer",
            approval_chain: ["scheduling_lead"],
            current_approver_user_id: "user-approver",
            current_approver_name: "Department Supervisor",
            current_approver_role_group: "scheduling_lead",
            current_approver_role_group_label: "Scheduling Lead",
            sla_due_at: "2026-03-25T15:00:00.000Z",
            overdue: false,
            escalated: false,
            escalation_level: 0,
            decided_at: null,
            executed_at: null,
            created_at: "2026-03-25T12:00:00.000Z",
            updated_at: "2026-03-25T12:00:00.000Z",
            can_decide: true,
            can_cancel: false,
            can_resubmit: false,
            can_delegate: true
          },
          steps: [
            {
              id: "step-1",
              step_order: 1,
              approver_role_group: "scheduling_lead",
              approver_role_group_label: "Scheduling Lead",
              approver_department: "schools",
              approver_user_id: "user-approver",
              approver_name: "Department Supervisor",
              status: "pending",
              status_label: "Pending",
              acted_by_user_id: null,
              acted_by_name: null,
              delegated_from_user_id: null,
              delegated_from_name: null,
              note: null,
              due_at: "2026-03-25T15:00:00.000Z",
              acted_at: null,
              created_at: "2026-03-25T12:00:00.000Z",
              updated_at: "2026-03-25T12:00:00.000Z"
            }
          ],
          events: [
            {
              id: "event-1",
              approval_step_id: null,
              event_type: "approval.requested",
              event_type_label: "Requested",
              summary: "Staffing Exception Approval submitted",
              note: "Need same-day approval",
              actor_user_id: "user-requester",
              actor_name: "Field Photographer",
              metadata: {},
              created_at: "2026-03-25T12:00:00.000Z"
            }
          ],
          candidate_approvers: [
            {
              id: "user-approver",
              label: "Department Supervisor",
              detail: "Schools | Supervisor"
            }
          ],
          current_state: {},
          requested_state: {},
          metadata: {}
        };
      }
      throw new Error(`Unexpected approvals call: ${path}`);
    });

    render(<Approvals token="token" currentUser={routedApprover} socket={null} />);

    expect(await screen.findByText("Approval Command Center")).toBeInTheDocument();
    expect(screen.getByText("Needs Your Action")).toBeInTheDocument();
    expect(screen.getByText("Manager Review")).toBeInTheDocument();
    expect(screen.getByText("PTO Review")).toBeInTheDocument();

    const managerSection = screen.getByText("Needs Your Action").closest("section");
    expect(managerSection).not.toBeNull();
    expect(within(managerSection as HTMLElement).getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
    expect(
      within(managerSection as HTMLElement).queryAllByRole("button", { name: "Deny" }).length +
        within(managerSection as HTMLElement).queryAllByRole("button", { name: "Reject" }).length
    ).toBeGreaterThan(0);

    expect(screen.getAllByText("Field Photographer").length).toBeGreaterThan(0);
    expect(screen.getByText("Need swap coverage")).toBeInTheDocument();
    expect(screen.getByText("Family event")).toBeInTheDocument();
    expect(screen.getByText("Operational Approval Inbox")).toBeInTheDocument();
    expect(screen.getByText("Approval needed to publish staffing for DEMO-001")).toBeInTheDocument();
  });
});
