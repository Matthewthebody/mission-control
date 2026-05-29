import type { PoolClient } from "pg";
import { describe, expect, it, vi, beforeEach } from "vitest";

const createAuditLogMock = vi.fn();
const createAppEventMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED: true,
    MICROSOFT_TEAMS_BOT_APP_ID: "bot-app-id",
    MICROSOFT_TEAMS_BOT_APP_PASSWORD: "bot-secret",
    MICROSOFT_GRAPH_TENANT_ID: "graph-tenant-id",
    TEAMS_COMMUNICATION_THROTTLE_MINUTES: 5
  }
}));

vi.mock("../src/services/audit.js", () => ({
  createAuditLog: (...args: unknown[]) => createAuditLogMock(...args)
}));

vi.mock("../src/services/outbox.js", () => ({
  createAppEvent: (...args: unknown[]) => createAppEventMock(...args)
}));

vi.mock("../src/services/policy/operationalAuthorization.js", () => ({
  canViewRecords: () => true
}));

import { ApiError } from "../src/errors/apiError.js";
import { queueTeamsCommunicationMessage } from "../src/services/teamsMessaging.js";
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
    permissions: ["job.read", "communication.use", "communication.send"],
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
  referenceType?: "chat" | "channel";
  throttleExisting?: boolean;
  objectType?: "job" | "task";
}) {
  const referenceType = options.referenceType ?? "chat";
  const objectType = options.objectType ?? "job";
  let insertedDeliveryId = "delivery-queued-1";
  let insertedStatus = options.throttleExisting ? "throttled" : "queued";

  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("to_regclass('public.teams_communication_reference')")) {
        return {
          rows: [
            {
              has_reference: true,
              has_reference_link: true,
              has_delivery: true,
              has_delivery_event: true
            }
          ]
        };
      }
      if (sql.includes("FROM jobs") && sql.includes("WHERE tenant_id = $1")) {
        return {
          rows: [
            {
              id: "job-1",
              title: "Metro Football Media Day",
              job_number: "JOB-001",
              department_type: "sports",
              organization_id: "org-1",
              primary_location_id: "loc-1",
              account_owner_user_id: "owner-1",
              created_by_user_id: "owner-1"
            }
          ]
        };
      }
      if (sql.includes("FROM job_staff_assignments")) {
        return { rows: [{ user_id: "owner-1" }] };
      }
      if (sql.includes("FROM work_task task") && sql.includes("LEFT JOIN jobs job")) {
        return {
          rows: [
            {
              id: "task-1",
              title: "Confirm bus arrival window",
              task_number: "TASK-001",
              department_type: "sports",
              related_job_id: "job-1",
              assigned_to_user_id: "owner-1",
              created_by_user_id: "owner-1",
              organization_id: "org-1",
              location_id: "loc-1",
              account_owner_user_id: "owner-1"
            }
          ]
        };
      }
      if (sql.includes("FROM teams_communication_reference reference") && sql.includes("JOIN teams_communication_reference_link")) {
        return {
          rows: [
            {
              id: "reference-1",
              status: "active",
              label: referenceType === "chat" ? "Crew Chat" : "Day Of Channel",
              reference_type: referenceType,
              teams_web_url:
                referenceType === "chat"
                  ? "https://teams.microsoft.com/l/chat/0/0?users=user@example.com"
                  : "https://teams.microsoft.com/l/channel/channel-id/Day-Of",
              team_id: referenceType === "channel" ? "team-1" : null,
              channel_id: referenceType === "channel" ? "channel-1" : null,
              chat_id: referenceType === "chat" ? "19:chat-id" : null,
              link_id: "link-1",
              link_object_type: objectType,
              link_object_id: objectType === "task" ? "task-1" : "job-1"
            }
          ]
        };
      }
      if (sql.includes("FROM teams_communication_delivery") && sql.includes("throttle_key = $2")) {
        return { rows: options.throttleExisting ? [{ id: "delivery-prior-1" }] : [] };
      }
      if (sql.includes("INSERT INTO teams_communication_delivery (")) {
        insertedDeliveryId = options.throttleExisting ? "delivery-throttled-1" : "delivery-queued-1";
        insertedStatus = options.throttleExisting ? "throttled" : "queued";
        return {
          rows: [{ id: insertedDeliveryId }]
        };
      }
      if (sql.includes("INSERT INTO teams_communication_delivery_event")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO audit_events")) {
        return {
          rows: [
            {
              id: "audit-event-1",
              tenant_id: "tenant-1",
              actor_user_id: "user-1",
              event_category: "communication",
              event_type: "communication.teams_message.queued",
              resource_type: "teams_communication_delivery",
              resource_id: insertedDeliveryId,
              target_user_id: null,
              department_type: "sports",
              request_id: null,
              trace_id: "trace-1",
              old_values_json: null,
              new_values_json: null,
              context_json: {},
              result: insertedStatus,
              created_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("UPDATE teams_communication_delivery") && sql.includes("SET app_event_id = $3")) {
        return { rows: [] };
      }
      if (sql.includes("FROM teams_communication_delivery delivery") && sql.includes("JOIN teams_communication_reference reference")) {
        return {
          rows: [
            {
              id: insertedDeliveryId,
              reference_id: "reference-1",
              reference_label: referenceType === "chat" ? "Crew Chat" : "Day Of Channel",
              reference_type: referenceType,
              status: insertedStatus,
              message_text: "Crew is loaded in and ready.",
              app_deep_link:
                objectType === "task"
                  ? "https://app.example.test/?teams=1#tasks/task-1"
                  : "https://app.example.test/?teams=1#jobs/job-1",
              teams_destination_url:
                referenceType === "chat"
                  ? "https://teams.microsoft.com/l/chat/0/0?users=user@example.com"
                  : "https://teams.microsoft.com/l/channel/channel-id/Day-Of",
              attempt_count: 0,
              first_attempted_at: null,
              last_attempted_at: null,
              sent_at: null,
              failed_at: null,
              last_error: null,
              external_message_id: null,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }
      throw new Error(`Unhandled SQL in teamsMessaging.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

describe("teams messaging service", () => {
  beforeEach(() => {
    createAuditLogMock.mockReset();
    createAppEventMock.mockReset();
    createAuditLogMock.mockResolvedValue(undefined);
    createAppEventMock.mockResolvedValue({ id: "app-event-1" });
  });

  it("queues a Teams message to a known existing chat destination", async () => {
    const client = createClient({ referenceType: "chat" });

    const delivery = await queueTeamsCommunicationMessage(
      client,
      createAuth(),
      {
        reference_id: "reference-1",
        object_type: "job",
        object_id: "job-1",
        message_text: "Crew is loaded in and ready.",
        app_deep_link: "https://app.example.test/?teams=1#jobs/job-1"
      },
      {
        sourceSurface: "job_detail"
      }
    );

    expect(delivery.reference_type).toBe("chat");
    expect(delivery.status).toBe("queued");
    expect(createAppEventMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "teams.communication.dispatch",
      aggregateId: "delivery-queued-1"
    }));
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "communication.teams_message.queued",
      entityId: "delivery-queued-1"
    }));
  });

  it("queues a Teams message to a known task-linked destination", async () => {
    const client = createClient({ referenceType: "chat", objectType: "task" });

    const delivery = await queueTeamsCommunicationMessage(
      client,
      createAuth(),
      {
        reference_id: "reference-1",
        object_type: "task",
        object_id: "task-1",
        message_text: "Please confirm the arrival update in Teams.",
        app_deep_link: "https://app.example.test/?teams=1#tasks/task-1"
      },
      {
        sourceSurface: "task_detail"
      }
    );

    expect(delivery.reference_type).toBe("chat");
    expect(delivery.status).toBe("queued");
    expect(createAppEventMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "teams.communication.dispatch",
      aggregateId: "delivery-queued-1"
    }));
  });

  it("logs throttled repeats without enqueuing a duplicate app event", async () => {
    const client = createClient({ referenceType: "channel", throttleExisting: true });

    const delivery = await queueTeamsCommunicationMessage(
      client,
      createAuth(),
      {
        reference_id: "reference-1",
        object_type: "job",
        object_id: "job-1",
        message_text: "Crew is loaded in and ready.",
        app_deep_link: "https://app.example.test/?teams=1#jobs/job-1"
      },
      {
        sourceSurface: "job_detail"
      }
    );

    expect(delivery.reference_type).toBe("channel");
    expect(delivery.status).toBe("throttled");
    expect(createAppEventMock).not.toHaveBeenCalled();
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "communication.teams_message.throttled",
      entityId: "delivery-throttled-1"
    }));
  });

  it("rejects message sends for users without a valid linked communication identity", async () => {
    const client = createClient({ referenceType: "chat" });

    await expect(
      queueTeamsCommunicationMessage(
        client,
        createAuth({
          communicationIdentity: {
            provider: "microsoft_teams",
            microsoftUserId: null,
            microsoftTenantId: null,
            communicationEnabled: false,
            postingDisabledAt: null,
            postingDisabledReason: "Identity is not linked.",
            canPost: false,
            teamsChatDefaultTarget: null,
            linkedAt: null,
            lastVerifiedAt: null,
            status: "unlinked"
          }
        }),
        {
          reference_id: "reference-1",
          object_type: "job",
          object_id: "job-1",
          message_text: "Crew is loaded in and ready.",
          app_deep_link: null
        }
      )
    ).rejects.toMatchObject<ApiError>({
      status: 403
    });
  });
});
