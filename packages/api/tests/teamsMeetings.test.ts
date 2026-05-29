import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuditLogMock = vi.fn();
const createAppEventMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    MICROSOFT_TEAMS_MEETINGS_ENABLED: true,
    MICROSOFT_GRAPH_CLIENT_ID: "graph-client-id",
    MICROSOFT_GRAPH_CLIENT_SECRET: "graph-client-secret",
    MICROSOFT_GRAPH_TENANT_ID: "graph-tenant-id",
    TEAMS_MEETING_SYNC_THROTTLE_MINUTES: 3,
    ADMIN_WEB_URL: "https://app.example.test"
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

import type { AuthUser } from "../src/types/auth.js";
import {
  cancelTeamsMeeting,
  queueTeamsMeetingJobRecordLifecycleSync,
  queueTeamsMeetingTaskRecordLifecycleSync,
  upsertTeamsMeetingForRecord
} from "../src/services/teamsMeetings.js";

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
    permissions: ["job.read", "communication.use", "communication.meeting.manage"],
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
  existingMeeting?: boolean;
  throttleExisting?: boolean;
  organizerReady?: boolean;
  existingOrganizerUserId?: string | null;
  objectType?: "job" | "task";
  lifecycleType?: "ad_hoc_call" | "scheduled_record_meeting" | "internal_review";
  recordSyncPolicy?: "manual" | "follow_record_schedule";
}) {
  const objectType = options.objectType ?? "job";
  const lifecycleType = options.lifecycleType ?? (objectType === "job" || objectType === "task" ? "scheduled_record_meeting" : "internal_review");
  const recordSyncPolicy = options.recordSyncPolicy ?? (lifecycleType === "scheduled_record_meeting" ? "follow_record_schedule" : "manual");
  const state = {
    meetingId: "meeting-1",
    operationId: "operation-1",
    insertedStatus: options.throttleExisting ? "throttled" : "queued"
  };

  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("to_regclass('public.teams_meeting_reference')")) {
        return {
          rows: [{ has_reference: true, has_sync_operation: true }]
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
              created_by_user_id: "owner-1",
              scheduled_start_at: "2026-04-10T15:00:00.000Z",
              scheduled_end_at: "2026-04-10T16:00:00.000Z"
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
              account_owner_user_id: "owner-1",
              due_at: "2026-04-10T15:00:00.000Z",
              related_job_scheduled_start_at: "2026-04-10T15:00:00.000Z",
              related_job_scheduled_end_at: "2026-04-10T16:00:00.000Z"
            }
          ]
        };
      }

      if (sql.includes("FROM work_task_assignment")) {
        return { rows: [{ user_id: "owner-1" }] };
      }

      if (sql.includes("AND u.id = ANY($2::uuid[])")) {
        return {
          rows: [
            {
              user_id: "owner-1",
              full_name: "Alex Owner",
              email: "alex@example.com",
              microsoft_user_id: "ms-user-1",
              microsoft_tenant_id: "ms-tenant-1",
              communication_enabled: true,
              linked_at: "2026-04-03T12:00:00.000Z",
              last_verified_at: "2026-04-03T12:00:00.000Z",
              auth_provider: "microsoft_entra"
            }
          ]
        };
      }

      if (sql.includes("LEFT JOIN user_account account ON account.id = u.account_id")) {
        const requestedUserId = String((params ?? [])[1] ?? "");
        if (requestedUserId === "user-1" && options.organizerReady === false) {
          return {
            rows: [
              {
                user_id: "user-1",
                tenant_id: "tenant-1",
                email: "alex@example.com",
                full_name: "Alex Owner",
                membership_status: "active",
                microsoft_user_id: null,
                microsoft_tenant_id: null,
                communication_enabled: false,
                teams_chat_default_target: null,
                linked_at: null,
                last_verified_at: null,
                auth_provider: "microsoft_entra"
              }
            ]
          };
        }

        if (requestedUserId === "fallback-organizer") {
          return {
            rows: [
              {
                user_id: "fallback-organizer",
                tenant_id: "tenant-1",
                email: "fallback@example.com",
                full_name: "Fallback Organizer",
                membership_status: "active",
                microsoft_user_id: "ms-user-2",
                microsoft_tenant_id: "ms-tenant-1",
                communication_enabled: true,
                teams_chat_default_target: null,
                linked_at: "2026-04-03T12:00:00.000Z",
                last_verified_at: "2026-04-03T12:00:00.000Z",
                auth_provider: "microsoft_entra"
              }
            ]
          };
        }

        return {
          rows: [
            {
              user_id: "user-1",
              tenant_id: "tenant-1",
              email: "alex@example.com",
              full_name: "Alex Owner",
              membership_status: "active",
              microsoft_user_id: "ms-user-1",
              microsoft_tenant_id: "ms-tenant-1",
              communication_enabled: true,
              teams_chat_default_target: null,
              linked_at: "2026-04-03T12:00:00.000Z",
              last_verified_at: "2026-04-03T12:00:00.000Z",
              auth_provider: "microsoft_entra"
            }
          ]
        };
      }

      if (sql.includes("FROM teams_meeting_reference") && sql.includes("linked_record_type = $2::teams_meeting_link_object_type")) {
        if (!options.existingMeeting) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: state.meetingId,
              linked_record_type: objectType,
              linked_record_id: objectType === "task" ? "task-1" : "job-1",
              meeting_provider: "microsoft_teams",
              meeting_mode: "calendar_event",
              meeting_status: "scheduled",
              metadata: {
                meeting_lifecycle_type: lifecycleType,
                record_sync_policy: recordSyncPolicy
              },
              title: objectType === "task" ? "TASK-001 Internal Teams Meeting" : "JOB-001 Internal Teams Meeting",
              description:
                objectType === "task"
                  ? "Internal Teams meeting linked to TASK-001."
                  : "Internal Teams meeting linked to JOB-001.",
              meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
              meeting_web_url: "https://outlook.office.com/calendar/item/meeting-1",
              external_meeting_id: null,
              external_calendar_event_id: "graph-event-1",
              organizer_user_id: options.existingOrganizerUserId ?? "user-1",
              organizer_email: "alex@example.com",
              organizer_microsoft_user_id: "ms-user-1",
              participant_snapshot: [],
              app_deep_link:
                objectType === "task"
                  ? "https://app.example.test/?teams=1#tasks/task-1"
                  : "https://app.example.test/?teams=1#sports/shoots/job-1",
              scheduled_start_at: "2026-04-10T15:00:00.000Z",
              scheduled_end_at: "2026-04-10T16:00:00.000Z",
              created_by_user_id: "user-1",
              updated_by_user_id: "user-1",
              last_sync_operation_id: null,
              last_sync_attempt_at: null,
              last_synced_at: null,
              sync_error: null,
              cancelled_at: null,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }

      if (sql.includes("INSERT INTO teams_meeting_reference")) {
        return {
          rows: [{ id: state.meetingId }]
        };
      }

      if (sql.includes("FROM teams_meeting_reference meeting") && sql.includes("WHERE meeting.tenant_id = $1")) {
        return {
          rows: [
            {
              id: state.meetingId,
              linked_record_type: objectType,
              linked_record_id: objectType === "task" ? "task-1" : "job-1",
              meeting_provider: "microsoft_teams",
              meeting_mode: "calendar_event",
              meeting_status: options.existingMeeting ? "pending_cancel" : "pending_create",
              metadata: {
                meeting_lifecycle_type: lifecycleType,
                record_sync_policy: recordSyncPolicy
              },
              title: objectType === "task" ? "TASK-001 Internal Teams Meeting" : "JOB-001 Internal Teams Meeting",
              description:
                objectType === "task"
                  ? "Internal Teams meeting linked to TASK-001."
                  : "Internal Teams meeting linked to JOB-001.",
              meeting_join_url: null,
              meeting_web_url: null,
              external_meeting_id: null,
              external_calendar_event_id: options.existingMeeting ? "graph-event-1" : null,
              organizer_user_id: options.existingOrganizerUserId ?? "user-1",
              organizer_email: "alex@example.com",
              organizer_microsoft_user_id: "ms-user-1",
              participant_snapshot: [],
              app_deep_link:
                objectType === "task"
                  ? "https://app.example.test/?teams=1#tasks/task-1"
                  : "https://app.example.test/?teams=1#sports/shoots/job-1",
              scheduled_start_at: "2026-04-10T15:00:00.000Z",
              scheduled_end_at: "2026-04-10T16:00:00.000Z",
              created_by_user_id: "user-1",
              updated_by_user_id: "user-1",
              last_sync_operation_id: null,
              last_sync_attempt_at: null,
              last_synced_at: null,
              sync_error: null,
              cancelled_at: null,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z",
              object_label: "JOB-001 · Metro Football Media Day",
              permission_entity: "job",
              department_type: "sports",
              organization_id: "org-1",
              location_id: "loc-1",
              owner_user_ids: ["owner-1"],
              assigned_user_ids: ["owner-1"]
            }
          ]
        };
      }

      if (sql.includes("FROM teams_meeting_sync_operation") && sql.includes("throttle_key = $2")) {
        return { rows: options.throttleExisting ? [{ id: "prior-operation-1" }] : [] };
      }

      if (sql.includes("INSERT INTO teams_meeting_sync_operation")) {
        return {
          rows: [{ id: state.operationId }]
        };
      }

      if (sql.includes("INSERT INTO audit_events")) {
        return {
          rows: [
            {
              id: "audit-event-1",
              tenant_id: "tenant-1",
              actor_user_id: "user-1",
              event_category: "communication",
              event_type: "communication.teams_meeting",
              resource_type: "teams_meeting_reference",
              resource_id: state.meetingId,
              target_user_id: null,
              department_type: null,
              request_id: null,
              trace_id: null,
              old_values_json: null,
              new_values_json: null,
              context_json: null,
              result: "queued",
              created_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }

      if (sql.includes("UPDATE teams_meeting_sync_operation") || sql.includes("UPDATE teams_meeting_reference")) {
        return { rows: [] };
      }

      if (sql.includes("FROM teams_meeting_sync_operation") && sql.includes("WHERE tenant_id = $1") && sql.includes("AND id = $2")) {
        return {
          rows: [
            {
              id: state.operationId,
              meeting_id: state.meetingId,
              operation_type: options.existingMeeting ? "cancel" : "create",
              trigger_source: options.existingMeeting ? "manual_cancel" : "manual_create",
              actor_user_id: "user-1",
              status: state.insertedStatus,
              app_event_id: options.throttleExisting ? null : "app-event-1",
              attempt_count: 0,
              first_attempted_at: null,
              last_attempted_at: null,
              completed_at: null,
              failed_at: null,
              last_error: null,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }

      throw new Error(`Unhandled SQL in teamsMeetings.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

describe("teams meeting service", () => {
  beforeEach(() => {
    createAuditLogMock.mockReset();
    createAppEventMock.mockReset();
    createAuditLogMock.mockResolvedValue(undefined);
    createAppEventMock.mockResolvedValue({ id: "app-event-1" });
  });

  it("queues a calendar-backed Teams meeting create for a job record", async () => {
    const client = createClient({ existingMeeting: false });

    await upsertTeamsMeetingForRecord(
      client,
      createAuth(),
      {
        object_type: "job",
        object_id: "job-1",
        meeting_mode: "calendar_event",
        title: "JOB-001 Crew Huddle",
        description: "Cover transport and call-time details.",
        scheduled_start_at: "2026-04-10T15:00:00.000Z",
        scheduled_end_at: "2026-04-10T16:00:00.000Z"
      },
      {
        sourceSurface: "job_detail"
      }
    );

    expect(createAppEventMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "teams.meeting.sync",
      aggregateId: "operation-1"
    }));
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "communication.teams_meeting.create_queued"
    }));
  });

  it("queues a Teams meeting create for a task record", async () => {
    const client = createClient({ existingMeeting: false, objectType: "task" });

    await upsertTeamsMeetingForRecord(
      client,
      createAuth(),
      {
        object_type: "task",
        object_id: "task-1",
        meeting_mode: "calendar_event",
        title: "TASK-001 Quick Huddle",
        description: "Resolve the transport handoff.",
        scheduled_start_at: "2026-04-10T15:00:00.000Z",
        scheduled_end_at: "2026-04-10T15:30:00.000Z"
      },
      {
        sourceSurface: "task_detail"
      }
    );

    expect(createAppEventMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "teams.meeting.sync",
      aggregateId: "operation-1"
    }));
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "communication.teams_meeting.create_queued"
    }));
  });

  it("queues a Teams meeting cancel for an existing linked meeting", async () => {
    const client = createClient({ existingMeeting: true });

    await cancelTeamsMeeting(
      client,
      createAuth(),
      {
        meeting_id: "meeting-1",
        reason: "Job postponed"
      },
      {
        sourceSurface: "job_detail"
      }
    );

    expect(createAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "communication.teams_meeting.cancel_queued"
    }));
  });

  it("marks linked meetings as sync_error instead of blocking job changes when organizer sync prerequisites are broken", async () => {
    const client = createClient({
      existingMeeting: true,
      organizerReady: false,
      existingOrganizerUserId: null
    });

    await expect(queueTeamsMeetingJobRecordLifecycleSync(client, createAuth(), "job-1", "update")).resolves.not.toThrow();
    expect(
      (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).includes("meeting_status = 'sync_error'::teams_meeting_status")
      )
    ).toBe(true);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "communication.teams_meeting.record_sync_failed",
      entityId: "meeting-1"
    }));
  });

  it("does not auto-reschedule manual review meetings when the linked job changes", async () => {
    const client = createClient({
      existingMeeting: true,
      lifecycleType: "internal_review",
      recordSyncPolicy: "manual"
    });

    await queueTeamsMeetingJobRecordLifecycleSync(client, createAuth(), "job-1", "update");

    expect(
      (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).includes("INSERT INTO teams_meeting_sync_operation")
      )
    ).toBe(false);
  });

  it("queues lifecycle-driven updates for task-linked scheduled meetings", async () => {
    const client = createClient({
      existingMeeting: true,
      objectType: "task",
      lifecycleType: "scheduled_record_meeting",
      recordSyncPolicy: "follow_record_schedule"
    });

    await queueTeamsMeetingTaskRecordLifecycleSync(client, createAuth(), "task-1", "update");

    expect(createAppEventMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "teams.meeting.sync",
      aggregateId: "operation-1"
    }));
  });
});
