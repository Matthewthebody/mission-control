import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    MICROSOFT_TEAMS_EMBEDDED_COMMUNICATIONS_ENABLED: true,
    MICROSOFT_TEAMS_PERSONAL_APP_ENABLED: true,
    MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED: true,
    MICROSOFT_TEAMS_MEETINGS_ENABLED: true
  }
}));

const getTeamsCommunicationRecordViewMock = vi.fn();
const getTeamsMeetingRecordViewMock = vi.fn();
const getTeamsEmbeddedCommunicationsDefaultsConfigurationMock = vi.fn();

vi.mock("../src/services/adminConfiguration.js", () => ({
  getTeamsEmbeddedCommunicationsDefaultsConfiguration: (...args: unknown[]) =>
    getTeamsEmbeddedCommunicationsDefaultsConfigurationMock(...args)
}));

vi.mock("../src/services/teamsMessaging.js", () => ({
  getTeamsCommunicationRecordView: (...args: unknown[]) => getTeamsCommunicationRecordViewMock(...args)
}));

vi.mock("../src/services/teamsMeetings.js", () => ({
  getTeamsMeetingRecordView: (...args: unknown[]) => getTeamsMeetingRecordViewMock(...args)
}));

import { ApiError } from "../src/errors/apiError.js";
import { getTeamsEmbeddedCommunicationHub } from "../src/services/teamsEmbeddedCommunications.js";
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
    department: "schools",
    isEmailVerified: true,
    authVersion: 1,
    authorityTier: "supervisor",
    baseRole: "Manager",
    capabilityOverlays: [],
    primaryJobFunctionProfile: "senior_photographer",
    jobFunctionProfiles: ["senior_photographer"],
    permissionGrants: [],
    policyGrants: [],
    policyRoles: [],
    internalRoleGroups: ["schools"],
    effectiveScopes: ["organization_wide_scope"],
    authorizationFlags: {
      financeSensitiveAccess: false,
      communicationsModeration: false,
      userAccessAdministration: false,
      securityAdministration: false
    },
    roles: ["admin"],
    permissions: ["communication.use", "communication.send", "communication.meeting.manage"],
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
      authenticatedAt: "2026-04-03T12:00:00.000Z",
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
      if (sql.includes("FROM job_staff_assignments assignment")) {
        return {
          rows: [
            {
              id: "job-1",
              title: "North Prep Day",
              job_number: "JOB-100",
              department_type: "schools",
              organization_label: "North Prep",
              location_label: "Main Gym",
              scheduled_start_at: "2026-04-03T15:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("FROM work_task task")) {
        return {
          rows: [
            {
              id: "task-1",
              title: "Confirm roster notes",
              task_number: "TASK-200",
              department_type: "schools",
              organization_label: "North Prep",
              location_label: "Main Gym",
              due_at: "2026-04-03T13:00:00.000Z"
            }
          ]
        };
      }
      throw new Error(`Unhandled SQL in teamsEmbeddedCommunications.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

describe("teams embedded communications hub", () => {
  beforeEach(() => {
    getTeamsCommunicationRecordViewMock.mockReset();
    getTeamsMeetingRecordViewMock.mockReset();
    getTeamsEmbeddedCommunicationsDefaultsConfigurationMock.mockReset();
    getTeamsEmbeddedCommunicationsDefaultsConfigurationMock.mockResolvedValue({
      max_entries: 8,
      max_assigned_jobs: 4,
      max_assigned_tasks: 4
    });
  });

  it("returns compact assigned job and task entries with sensible summary counts", async () => {
    getTeamsCommunicationRecordViewMock.mockImplementation(async (_client, _auth, input) => ({
      object_type: input.objectType,
      object_id: input.objectId,
      object_label: input.objectId,
      permissions: {
        can_use: true,
        can_send: true,
        can_configure: false,
        can_view_history: true,
        can_send_proactive: false,
        can_message_chats: true,
        can_message_channels: true,
        can_message_assigned_staff: true
      },
      feature_enabled: true,
      references:
        input.objectType === "job"
          ? [
              {
                id: "reference-1",
                reference_type: "channel",
                status: "active",
                label: "North Day Of",
                description: null,
                teams_web_url: "https://teams.microsoft.com/l/channel/channel-id",
                team_id: "team-1",
                channel_id: "channel-1",
                chat_id: null,
                is_primary: true,
                created_at: "2026-04-03T12:00:00.000Z",
                updated_at: "2026-04-03T12:00:00.000Z",
                last_verified_at: "2026-04-03T12:00:00.000Z"
              }
            ]
          : [],
      recent_deliveries:
        input.objectType === "task"
          ? [
              {
                id: "delivery-1",
                reference_id: "reference-2",
                reference_label: "Task Chat",
                reference_type: "chat",
                status: "failed",
                visibility_status: "visible",
                message_text: "Need follow-through.",
                app_deep_link: "#tasks/task-1",
                teams_destination_url: "https://teams.microsoft.com/l/chat/0/0",
                attempt_count: 1,
                first_attempted_at: "2026-04-03T12:00:00.000Z",
                last_attempted_at: "2026-04-03T12:01:00.000Z",
                sent_at: null,
                failed_at: "2026-04-03T12:01:00.000Z",
                last_error: "Graph timeout",
                external_message_id: null,
                moderated_at: null,
                moderated_by_user_id: null,
                moderation_reason: null,
                created_at: "2026-04-03T12:00:00.000Z",
                updated_at: "2026-04-03T12:01:00.000Z"
              }
            ]
          : []
    }));
    getTeamsMeetingRecordViewMock.mockImplementation(async (_client, _auth, input) => ({
      object_type: input.objectType,
      object_id: input.objectId,
      object_label: input.objectId,
      feature_enabled: true,
      permissions: {
        can_use: true,
        can_manage: true,
        can_create: true,
        can_view_history: true
      },
      defaults: {
        suggested_title: "Internal Teams Meeting",
        suggested_description: null,
        scheduled_start_at: null,
        scheduled_end_at: null,
        app_deep_link: null,
        suggested_participants: []
      },
      meeting:
        input.objectType === "job"
          ? {
              id: "meeting-1",
              linked_record_type: "job",
              linked_record_id: "job-1",
              meeting_provider: "microsoft_teams",
              meeting_mode: "calendar_event",
              meeting_status: "scheduled",
              title: "North Prep Internal Teams Meeting",
              description: null,
              meeting_join_url: "https://teams.microsoft.com/l/meetup-join/job-1",
              meeting_web_url: null,
              external_meeting_id: "meeting-1",
              external_calendar_event_id: "event-1",
              organizer_user_id: "user-1",
              organizer_email: "alex@example.com",
              organizer_microsoft_user_id: "ms-user-1",
              participant_snapshot: [],
              app_deep_link: "#schools/shoots/job-1",
              scheduled_start_at: "2026-04-03T15:00:00.000Z",
              scheduled_end_at: "2026-04-03T15:30:00.000Z",
              created_by_user_id: "user-1",
              updated_by_user_id: "user-1",
              last_sync_operation_id: null,
              last_sync_attempt_at: null,
              last_synced_at: "2026-04-03T12:10:00.000Z",
              sync_error: null,
              cancelled_at: null,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:10:00.000Z"
            }
          : null,
      recent_operations: []
    }));

    const hub = await getTeamsEmbeddedCommunicationHub(createClient(), createAuth());

    expect(hub.summary.action_records).toBe(2);
    expect(hub.summary.active_meetings).toBe(1);
    expect(hub.summary.urgent_alerts).toBe(2);
    expect(hub.summary.missing_destinations).toBe(1);
    expect(hub.summary.latest_activity_at).toBe("2026-04-03T12:10:00.000Z");
    expect(hub.availability.state).toBe("ready");
    expect(hub.entries.map((entry) => entry.object_type)).toEqual(["task", "job"]);
    expect(hub.entries[0]?.route_hash).toBe("#tasks/task-1");
    expect(hub.entries[1]?.route_hash).toBe("#schools/shoots/job-1");
  });

  it("keeps the hub readable for partially linked users instead of failing on record views", async () => {
    getTeamsCommunicationRecordViewMock.mockRejectedValue(new ApiError(403, "Forbidden"));
    getTeamsMeetingRecordViewMock.mockRejectedValue(new ApiError(403, "Forbidden"));

    const hub = await getTeamsEmbeddedCommunicationHub(
      createClient(),
      createAuth({
        communicationIdentity: {
          provider: "microsoft_teams",
          microsoftUserId: "ms-user-1",
          microsoftTenantId: null,
          communicationEnabled: false,
          postingDisabledAt: null,
          postingDisabledReason: null,
          canPost: false,
          teamsChatDefaultTarget: null,
          linkedAt: "2026-04-03T12:00:00.000Z",
          lastVerifiedAt: "2026-04-03T12:00:00.000Z",
          status: "incomplete"
        }
      })
    );

    expect(hub.communication_identity_status).toBe("incomplete");
    expect(hub.availability.state).toBe("setup_required");
    expect(hub.entries).toHaveLength(2);
    expect(hub.entries.every((entry) => entry.communication.references.length === 0)).toBe(true);
    expect(hub.entries.every((entry) => entry.meeting.meeting === null)).toBe(true);
  });
});
