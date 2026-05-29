import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getProactiveCommunicationDefaultsConfigurationMock = vi.fn();
const queueTeamsCommunicationMessageMock = vi.fn();
const emitOperationalEventMock = vi.fn();

vi.mock("../src/services/adminConfiguration.js", () => ({
  getProactiveCommunicationDefaultsConfiguration: (...args: unknown[]) =>
    getProactiveCommunicationDefaultsConfigurationMock(...args)
}));

vi.mock("../src/services/teamsMessaging.js", () => ({
  queueTeamsCommunicationMessage: (...args: unknown[]) => queueTeamsCommunicationMessageMock(...args)
}));

vi.mock("../src/services/operationalEvents.js", () => ({
  emitOperationalEvent: (...args: unknown[]) => emitOperationalEventMock(...args)
}));

import { applyProactiveCommunicationRule } from "../src/services/proactiveCommunicationRules.js";
import type { AuthUser } from "../src/types/auth.js";

function createAuth(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    accountId: "account-1",
    sessionId: "session-1",
    email: "alex@example.com",
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
    roles: ["admin"],
    permissions: ["job.read", "task.read", "communication.use", "communication.send", "communication.meeting.manage", "communication.proactive.send"],
    communicationIdentity: {
      provider: "microsoft_teams",
      microsoftUserId: "ms-user-1",
      microsoftTenantId: "ms-tenant-1",
      communicationEnabled: true,
      postingDisabledAt: null,
      postingDisabledReason: null,
      canPost: true,
      teamsChatDefaultTarget: null,
      linkedAt: "2026-04-03T12:00:00.000Z",
      lastVerifiedAt: "2026-04-03T12:00:00.000Z",
      status: "linked_ready"
    },
    sessionTrust: {
      identityProvider: "microsoft_entra",
      sessionAssurance: "mfa",
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

function createClient(options: {
  throttleMatchId?: string | null;
  references?: Array<{ id: string; reference_type: "chat" | "channel"; label: string; teams_web_url: string; is_primary?: boolean }>;
}) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("to_regclass('public.proactive_communication_decision')")) {
        return { rows: [{ has_decision: true }] };
      }
      if (sql.includes("to_regclass('public.teams_communication_reference')")) {
        return { rows: [{ has_reference: true, has_link: true }] };
      }
      if (sql.includes("FROM jobs")) {
        return {
          rows: [
            {
              id: "job-1",
              title: "Metro Football Media Day",
              job_number: "JOB-001",
              department_type: "sports",
              organization_id: "org-1",
              primary_location_id: "location-1",
              account_owner_user_id: "user-1",
              created_by_user_id: "user-1"
            }
          ]
        };
      }
      if (sql.includes("FROM job_staff_assignments")) {
        return {
          rows: [
            { user_id: "user-1" },
            { user_id: "user-2" }
          ]
        };
      }
      if (sql.includes("FROM work_task task")) {
        return {
          rows: [
            {
              id: "task-1",
              title: "Confirm bus arrival window",
              task_number: "TASK-001",
              department_type: "sports",
              related_job_id: "job-1",
              assigned_to_user_id: "user-2",
              created_by_user_id: "user-1",
              organization_id: "org-1",
              location_id: "location-1",
              account_owner_user_id: "user-1"
            }
          ]
        };
      }
      if (sql.includes("FROM proactive_communication_decision") && sql.includes("throttle_key = $2")) {
        return { rows: options.throttleMatchId ? [{ id: options.throttleMatchId }] : [] };
      }
      if (sql.includes("FROM teams_communication_reference_link link")) {
        return {
          rows: (options.references ?? []).map((reference) => ({
            id: reference.id,
            reference_type: reference.reference_type,
            label: reference.label,
            teams_web_url: reference.teams_web_url,
            is_primary: reference.is_primary ?? true
          }))
        };
      }
      if (sql.includes("INSERT INTO proactive_communication_decision")) {
        return {
          rows: [
            {
              id: "decision-1",
              trigger_type: params?.[1],
              source_module: params?.[2],
              source_object_type: params?.[3],
              source_object_id: params?.[4],
              source_object_label: params?.[5] ?? null,
              communication_object_type: params?.[6],
              communication_object_id: params?.[7],
              route_kind: params?.[8],
              route_status: params?.[9],
              actor_user_id: params?.[10] ?? null,
              recipient_user_ids: params?.[11] ?? [],
              teams_reference_id: params?.[12] ?? null,
              teams_delivery_id: params?.[13] ?? null,
              operational_event_id: params?.[14] ?? null,
              title: params?.[15],
              summary: params?.[16],
              throttle_key: params?.[17] ?? null,
              throttle_window_minutes: params?.[18],
              throttled_by_decision_id: params?.[19] ?? null,
              failure_reason: params?.[20] ?? null,
              metadata: JSON.parse(String(params?.[21] ?? "{}")),
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }
      throw new Error(`Unhandled SQL in proactiveCommunicationRules.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

describe("proactive communication rules", () => {
  beforeEach(() => {
    getProactiveCommunicationDefaultsConfigurationMock.mockReset();
    queueTeamsCommunicationMessageMock.mockReset();
    emitOperationalEventMock.mockReset();

    getProactiveCommunicationDefaultsConfigurationMock.mockResolvedValue({
      default_fallback_route: "in_app_notification",
      default_throttle_window_minutes: 120,
      max_direct_message_recipients: 3,
      trigger_overrides: {}
    });
    queueTeamsCommunicationMessageMock.mockResolvedValue({
      id: "delivery-1",
      status: "queued"
    });
    emitOperationalEventMock.mockResolvedValue({
      event: { id: "event-1" },
      deliveries: [],
      queued_count: 1,
      throttled_count: 0
    });
  });

  it("routes assignment changes to a direct Teams chat when an active chat is linked", async () => {
    const client = createClient({
      references: [
        {
          id: "chat-ref-1",
          reference_type: "chat",
          label: "Crew Chat",
          teams_web_url: "https://teams.microsoft.com/l/chat/0/0?users=crew@example.com"
        }
      ]
    });

    const result = await applyProactiveCommunicationRule(client, createAuth(), {
      triggerType: "assignment_changed",
      sourceModule: "jobs",
      sourceObjectType: "job_staff_assignment",
      sourceObjectId: "assignment-1",
      sourceObjectLabel: "JOB-001",
      communicationObjectType: "job",
      communicationObjectId: "job-1",
      title: "Assignment updated for JOB-001",
      summary: "You were assigned on JOB-001.",
      recipientUserIds: ["user-2"],
      appDeepLink: "#jobs/job-1"
    });

    expect(result.route_kind).toBe("direct_teams_message");
    expect(result.route_status).toBe("queued");
    expect(queueTeamsCommunicationMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        reference_id: "chat-ref-1",
        object_type: "job",
        object_id: "job-1"
      }),
      expect.objectContaining({
        sourceSurface: "proactive_rule"
      })
    );
    expect(emitOperationalEventMock).not.toHaveBeenCalled();
  });

  it("routes overdue task signals into an open-Teams recommendation with in-app delivery metadata", async () => {
    const client = createClient({
      references: [
        {
          id: "channel-ref-1",
          reference_type: "channel",
          label: "Day Of Channel",
          teams_web_url: "https://teams.microsoft.com/l/channel/channel-id/Day-Of"
        }
      ]
    });

    const result = await applyProactiveCommunicationRule(client, createAuth(), {
      triggerType: "overdue_task_tied_to_job",
      sourceModule: "tasks",
      sourceObjectType: "work_task",
      sourceObjectId: "task-1",
      sourceObjectLabel: "TASK-001",
      communicationObjectType: "task",
      communicationObjectId: "task-1",
      title: "Task overdue: TASK-001",
      summary: "Confirm bus arrival window is overdue.",
      recipientUserIds: ["user-2"],
      appDeepLink: "#tasks/task-1"
    });

    expect(result.route_kind).toBe("open_teams_recommendation");
    expect(result.route_status).toBe("recommended");
    expect(emitOperationalEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "task.overdue",
        recipientUserIds: ["user-2"],
        metadata: expect.objectContaining({
          recommended_action: "open_teams_destination",
          teams_reference_id: "channel-ref-1",
          teams_destination_url: "https://teams.microsoft.com/l/channel/channel-id/Day-Of"
        })
      })
    );
    expect(queueTeamsCommunicationMessageMock).not.toHaveBeenCalled();
  });

  it("throttles repeated triggers before they enqueue another delivery or notification", async () => {
    const client = createClient({
      throttleMatchId: "decision-prior-1",
      references: [
        {
          id: "chat-ref-1",
          reference_type: "chat",
          label: "Crew Chat",
          teams_web_url: "https://teams.microsoft.com/l/chat/0/0?users=crew@example.com"
        }
      ]
    });

    const result = await applyProactiveCommunicationRule(client, createAuth(), {
      triggerType: "assignment_changed",
      sourceModule: "jobs",
      sourceObjectType: "job_staff_assignment",
      sourceObjectId: "assignment-1",
      sourceObjectLabel: "JOB-001",
      communicationObjectType: "job",
      communicationObjectId: "job-1",
      title: "Assignment updated for JOB-001",
      summary: "You were assigned on JOB-001.",
      recipientUserIds: ["user-2"],
      appDeepLink: "#jobs/job-1"
    });

    expect(result.route_status).toBe("throttled");
    expect(queueTeamsCommunicationMessageMock).not.toHaveBeenCalled();
    expect(emitOperationalEventMock).not.toHaveBeenCalled();
  });

  it("suppresses routing when the actor lacks proactive communication permission on the record", async () => {
    const client = createClient({
      references: [
        {
          id: "chat-ref-1",
          reference_type: "chat",
          label: "Crew Chat",
          teams_web_url: "https://teams.microsoft.com/l/chat/0/0?users=crew@example.com"
        }
      ]
    });

    const result = await applyProactiveCommunicationRule(
      client,
      createAuth({
        permissions: ["job.read", "task.read", "communication.use", "communication.send", "communication.meeting.manage"]
      }),
      {
        triggerType: "assignment_changed",
        sourceModule: "jobs",
        sourceObjectType: "job_staff_assignment",
        sourceObjectId: "assignment-1",
        sourceObjectLabel: "JOB-001",
        communicationObjectType: "job",
        communicationObjectId: "job-1",
        title: "Assignment updated for JOB-001",
        summary: "You were assigned on JOB-001.",
        recipientUserIds: ["user-2"],
        appDeepLink: "#jobs/job-1"
      }
    );

    expect(result.route_status).toBe("suppressed");
    expect(result.failure_reason).toBe("The actor is not allowed to send proactive communications from this record.");
    expect(queueTeamsCommunicationMessageMock).not.toHaveBeenCalled();
    expect(emitOperationalEventMock).not.toHaveBeenCalled();
  });
});
