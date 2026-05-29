import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

const createAuditLogMock = vi.fn();
const applyProactiveCommunicationRuleMock = vi.fn();

vi.mock("../src/services/audit.js", () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args)
}));

vi.mock("../src/services/proactiveCommunicationRules.js", () => ({
  applyProactiveCommunicationRule: (...args: unknown[]) => applyProactiveCommunicationRuleMock(...args)
}));

import { createOperationalApprovalRequest } from "../src/services/operationalApprovals.js";
import type { AuthUser } from "../src/types/auth.js";

function createAuth(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    accountId: "account-1",
    sessionId: "session-1",
    email: "owner@example.com",
    fullName: "Alex Owner",
    status: "active",
    department: "sports",
    isEmailVerified: true,
    authVersion: 1,
    authorityTier: "supervisor",
    primaryJobFunctionProfile: "sports_client_success",
    jobFunctionProfiles: ["sports_client_success"],
    permissionGrants: [],
    policyGrants: [],
    policyRoles: [],
    internalRoleGroups: ["sports"],
    effectiveScopes: ["organization_wide_scope"],
    roles: ["manager"],
    permissions: ["job.read", "job.update"],
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
    },
    ...overrides
  };
}

function createClient() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM jobs job")) {
        return {
          rows: [
            {
              id: "job-1",
              job_number: "JOB-001",
              title: "Metro Media Day",
              department_type: "sports",
              organization_id: "org-1",
              primary_location_id: "loc-1",
              account_owner_user_id: "user-1",
              created_by_user_id: "user-1"
            }
          ]
        };
      }
      if (sql.includes("FROM job_staff_assignments")) {
        return { rows: [] };
      }
      if (sql.includes("FROM operational_approval_request") && sql.includes("dedupe_key = $2")) {
        return { rows: [] };
      }
      if (sql.includes("FROM app_user au")) {
        return {
          rows: [
            {
              id: "leader-1",
              full_name: "Leadership Approver",
              department: "sports",
              authority_tier: "leadership",
              job_function_profiles: ["leadership_team_member"]
            }
          ]
        };
      }
      if (sql.includes("INSERT INTO operational_approval_request")) {
        return {
          rows: [{ id: "approval-1" }]
        };
      }
      if (sql.includes("INSERT INTO operational_approval_step")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO operational_approval_event")) {
        return { rows: [] };
      }
      if (sql.includes("FROM operational_approval_request req") && sql.includes("AND req.id = $2")) {
        return {
          rows: [
            {
              id: "approval-1",
              request_type: "fee_refund_approval",
              status: "pending",
              source_module: "jobs",
              source_entity_type: "job",
              source_entity_id: "job-1",
              source_entity_label: "JOB-001 | Metro Media Day",
              requester_department: "sports",
              blocking: true,
              requested_action_code: "job.fee_refund",
              request_title: "Fee / Refund Approval for JOB-001",
              request_summary: "Need a partial refund approved.",
              reason: "Customer service confirmed the service recovery request.",
              severity: "high",
              requested_by_user_id: "user-1",
              requested_by_name: "Alex Owner",
              approval_chain: ["leadership"],
              current_state: {},
              requested_state: {},
              metadata: {},
              clarification_note: null,
              decision_note: null,
              sla_due_at: null,
              overdue_at: null,
              escalated_at: null,
              escalation_level: 0,
              decided_at: null,
              executed_at: null,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z",
              current_approver_user_id: "leader-1",
              current_approver_name: "Leadership Approver",
              current_approver_role_group: "leadership"
            }
          ]
        };
      }
      return { rows: [] };
    })
  } as unknown as PoolClient;
}

describe("operational approvals", () => {
  it("creates a reusable record-linked approval request through the generic service", async () => {
    createAuditLogMock.mockReset();
    applyProactiveCommunicationRuleMock.mockReset();
    createAuditLogMock.mockResolvedValue(undefined);
    applyProactiveCommunicationRuleMock.mockResolvedValue({
      route_kind: "in_app_notification",
      route_status: "notified",
      decision: null,
      failure_reason: null
    });

    const client = createClient();

    const result = await createOperationalApprovalRequest(client, createAuth(), {
      request_type: "fee_refund_approval",
      source_module: "jobs",
      source_entity_type: "job",
      source_entity_id: "job-1",
      requested_action_code: "job.fee_refund",
      request_title: "Fee / Refund Approval for JOB-001",
      request_summary: "Need a partial refund approved.",
      reason: "Customer service confirmed the service recovery request.",
      severity: "high",
      blocking: true
    });

    expect(result.request_type).toBe("fee_refund_approval");
    expect(result.request_title).toBe("Fee / Refund Approval for JOB-001");
    expect(result.current_approver_role_group).toBe("leadership");
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    expect(applyProactiveCommunicationRuleMock).toHaveBeenCalledTimes(1);
    expect(applyProactiveCommunicationRuleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        triggerType: "approval_needed",
        sourceObjectType: "operational_approval_request",
        communicationObjectType: "job",
        communicationObjectId: "job-1"
      })
    );

    const queryMock = client.query as unknown as { mock: { calls: Array<[string, unknown[]]> } };
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO operational_approval_request")
    );
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining([
        "tenant-1",
        "fee_refund_approval",
        "jobs",
        "job",
        "job-1"
      ])
    );
  });
});
