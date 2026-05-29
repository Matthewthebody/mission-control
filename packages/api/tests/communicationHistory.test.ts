import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { getCommunicationHistoryForRecord } from "../src/services/communicationHistory.js";
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
    permissions: ["job.read", "communication.use", "communication.send", "communication.meeting.manage", "communication.history.read"],
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

function createClient() {
  return {
    query: vi.fn(async (sql: string) => {
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

      if (sql.includes("to_regclass('public.teams_communication_reference')")) {
        return {
          rows: [
            {
              has_reference: true,
              has_reference_link: true,
              has_delivery: true
            }
          ]
        };
      }

      if (sql.includes("to_regclass('public.teams_meeting_reference')")) {
        return {
          rows: [
            {
              has_reference: true,
              has_operation: true
            }
          ]
        };
      }

      if (sql.includes("to_regclass('public.communication_post_call_outcome')")) {
        return {
          rows: [
            {
              ready: true
            }
          ]
        };
      }

      if (sql.includes("FROM teams_communication_reference_link link")) {
        return {
          rows: [
            {
              id: "link-1",
              target_reference_id: "reference-1",
              target_type: "channel",
              target_id: "channel-1",
              target_label: "Day Of Channel",
              target_url: "https://teams.microsoft.com/l/channel/day-of",
              actor_user_id: "user-1",
              actor_name: "Alex Owner",
              is_primary: true,
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:00:00.000Z"
            }
          ]
        };
      }

      if (sql.includes("FROM teams_communication_delivery delivery")) {
        return {
          rows: [
            {
              id: "delivery-1",
              target_reference_id: "reference-1",
              target_type: "channel",
              target_id: "channel-1",
              target_label: "Day Of Channel",
              target_url: "https://teams.microsoft.com/l/channel/day-of",
              actor_user_id: "user-1",
              actor_name: "Alex Owner",
              status: "sent",
              message_text: "Crew is loaded in and ready.",
              first_attempted_at: "2026-04-03T12:10:00.000Z",
              last_attempted_at: "2026-04-03T12:10:00.000Z",
              sent_at: "2026-04-03T12:10:01.000Z",
              failed_at: null,
              last_error: null,
              created_at: "2026-04-03T12:10:00.000Z",
              updated_at: "2026-04-03T12:10:01.000Z"
            }
          ]
        };
      }

      if (sql.includes("FROM teams_meeting_reference meeting") && sql.includes("JOIN teams_meeting_sync_operation operation")) {
        return {
          rows: [
            {
              id: "operation-1",
              target_reference_id: "meeting-1",
              target_id: "meeting-external-1",
              target_label: "JOB-001 Internal Teams Meeting",
              target_url: "https://outlook.office.com/calendar/item/meeting-1",
              join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
              actor_user_id: "user-1",
              actor_name: "Alex Owner",
              operation_type: "update",
              status: "failed",
              last_error: "Organizer lost access to the linked calendar event.",
              last_attempted_at: "2026-04-03T12:20:00.000Z",
              completed_at: null,
              failed_at: "2026-04-03T12:20:01.000Z",
              created_at: "2026-04-03T12:20:00.000Z",
              updated_at: "2026-04-03T12:20:01.000Z"
            }
          ]
        };
      }

      if (sql.includes("FROM teams_meeting_reference meeting") && sql.includes("ORDER BY meeting.updated_at DESC")) {
        return {
          rows: [
            {
              id: "meeting-1",
              title: "JOB-001 Internal Teams Meeting",
              meeting_status: "sync_error",
              meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
              meeting_web_url: "https://outlook.office.com/calendar/item/meeting-1",
              external_meeting_id: "meeting-external-1",
              external_calendar_event_id: "calendar-event-1",
              created_by_user_id: "user-1",
              updated_by_user_id: "user-1",
              created_at: "2026-04-03T12:00:00.000Z",
              updated_at: "2026-04-03T12:20:01.000Z",
              sync_error: "Organizer lost access to the linked calendar event."
            }
          ]
        };
      }

      if (sql.includes("FROM communication_post_call_outcome outcome")) {
        return {
          rows: [
            {
              id: "post-call-1",
              target_reference_id: "meeting-1",
              target_id: "meeting-external-1",
              target_label: "JOB-001 Internal Teams Meeting",
              target_url: "https://outlook.office.com/calendar/item/meeting-1",
              join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
              actor_user_id: "user-1",
              actor_name: "Alex Owner",
              status: "follow_up_open",
              summary: "Logged post-call follow-up and created task TASK-201",
              notes: "Need confirmation from the athletics office before crew call.",
              reason_for_call: "Escalation",
              failure_reason: null,
              created_at: "2026-04-03T12:30:00.000Z",
              updated_at: "2026-04-03T12:30:00.000Z",
              occurred_at: "2026-04-03T12:30:00.000Z"
            }
          ]
        };
      }

      throw new Error(`Unhandled SQL in communicationHistory.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

describe("communication history service", () => {
  it("merges destination links, message outcomes, meeting sync activity, and post-call outcomes into one readable record view", async () => {
    const history = await getCommunicationHistoryForRecord(createClient(), createAuth(), {
      objectType: "job",
      objectId: "job-1"
    });

    expect(history.object_label).toBe("JOB-001 · Metro Football Media Day");
    expect(history.permissions.can_view_history).toBe(true);
    expect(history.permissions.can_use_actions).toBe(true);
    expect(history.permissions.can_view_messages).toBe(true);
    expect(history.permissions.can_view_meetings).toBe(true);
    expect(history.summary.latest_message?.summary).toBe("Sent update to Day Of Channel");
    expect(history.summary.latest_follow_up?.summary).toBe("Logged post-call follow-up and created task TASK-201");
    expect(history.summary.latest_meeting?.summary).toBe("Failed to update JOB-001 Internal Teams Meeting");
    expect(history.summary.latest_failure?.failure_reason).toBe("Organizer lost access to the linked calendar event.");
    expect(history.entries.map((entry) => entry.kind)).toEqual(["post_call", "meeting", "message", "destination_linked"]);
  });
});
