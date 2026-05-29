// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsCommunicationsPage } from "../pages/TeamsCommunicationsPage";
import type { SessionUser } from "../types";

const getTeamsEmbeddedCommunicationHubMock = vi.fn();
const queueTeamsCommunicationMessageMock = vi.fn();
const upsertTeamsMeetingMock = vi.fn();

vi.mock("../permissions", () => ({
  canAccessTeamsCommunicationSurface: vi.fn(() => true),
  canModerateCommunications: vi.fn(() => true),
  canManageCommunicationMeetings: vi.fn(() => true),
  canSendCommunicationMessages: vi.fn(() => true),
  canUseCommunicationActions: vi.fn(() => true)
}));

vi.mock("../services/teamsEmbeddedCommunicationsApi", () => ({
  getTeamsEmbeddedCommunicationHub: (...args: unknown[]) => getTeamsEmbeddedCommunicationHubMock(...args)
}));

vi.mock("../services/teamsCommunicationApi", () => ({
  queueTeamsCommunicationMessage: (...args: unknown[]) => queueTeamsCommunicationMessageMock(...args)
}));

vi.mock("../services/teamsMeetingsApi", () => ({
  upsertTeamsMeeting: (...args: unknown[]) => upsertTeamsMeetingMock(...args)
}));

function createUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-communications",
    tenantId: "tenant-demo",
    accountId: "account-communications",
    sessionId: "session-communications",
    email: "teams.communications@example.com",
    fullName: "Jordan Communication",
    status: "active",
    department: "schools",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["manager"],
    permissions: ["communication.use", "communication.send", "communication.meeting.manage"],
    authorityTier: "supervisor",
    primaryJobFunctionProfile: "senior_photographer",
    jobFunctionProfiles: ["senior_photographer"],
    permissionGrants: [],
    effectiveScopes: ["organization_wide_scope"],
    policyGrants: [],
    internalRoleGroups: ["schools"],
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

function createHub() {
  return {
    generated_at: "2026-04-03T12:00:00.000Z",
    feature_flags: {
      personal_app_enabled: true,
      messaging_enabled: true,
      meetings_enabled: true
    },
    communication_identity_status: "linked_ready" as const,
    availability: {
      state: "ready" as const,
      title: "Communications is ready",
      detail: "Record-linked messaging and meetings are available.",
      fix_hint: null
    },
    permissions: {
      can_use: true,
      can_send: true,
      can_manage_meetings: true,
      can_configure: false,
      can_view_history: true,
      can_send_proactive: false
    },
    summary: {
      action_records: 2,
      active_meetings: 1,
      urgent_alerts: 1,
      missing_destinations: 1,
      latest_activity_at: "2026-04-03T12:01:00.000Z"
    },
    entries: [
      {
        object_type: "job" as const,
        object_id: "job-1",
        object_label: "JOB-100 - North Prep Day",
        record_kind_label: "Assigned job",
        route_hash: "#schools/shoots/job-1",
        department_type: "schools",
        organization_label: "North Prep",
        location_label: "Main Gym",
        scheduled_start_at: "2026-04-03T15:00:00.000Z",
        due_at: null,
        latest_activity_at: "2026-04-03T12:00:00.000Z",
        communication: {
          object_type: "job" as const,
          object_id: "job-1",
          object_label: "JOB-100 - North Prep Day",
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
          references: [
            {
              id: "reference-1",
              reference_type: "channel" as const,
              status: "active" as const,
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
          ],
          recent_deliveries: []
        },
        meeting: {
          object_type: "job" as const,
          object_id: "job-1",
          object_label: "JOB-100 - North Prep Day",
          feature_enabled: true,
          permissions: {
            can_use: true,
            can_manage: true,
            can_create: true,
            can_view_history: true
          },
          defaults: {
            suggested_title: "JOB-100 Internal Teams Meeting",
            suggested_description: "Internal Teams meeting linked to JOB-100.",
            scheduled_start_at: "2026-04-03T15:00:00.000Z",
            scheduled_end_at: "2026-04-03T15:30:00.000Z",
            app_deep_link: "https://app.example.test/?teams=1#schools/shoots/job-1",
            suggested_participants: []
          },
          meeting: {
            id: "meeting-1",
            linked_record_type: "job" as const,
            linked_record_id: "job-1",
            meeting_provider: "microsoft_teams" as const,
            meeting_mode: "calendar_event" as const,
            meeting_status: "scheduled" as const,
            title: "JOB-100 Internal Teams Meeting",
            description: null,
            meeting_join_url: "https://teams.microsoft.com/l/meetup-join/job-1",
            meeting_web_url: null,
            external_meeting_id: "meeting-1",
            external_calendar_event_id: "event-1",
            organizer_user_id: "user-communications",
            organizer_email: "teams.communications@example.com",
            organizer_microsoft_user_id: "ms-user-1",
            participant_snapshot: [],
            app_deep_link: "https://app.example.test/?teams=1#schools/shoots/job-1",
            scheduled_start_at: "2026-04-03T15:00:00.000Z",
            scheduled_end_at: "2026-04-03T15:30:00.000Z",
            created_by_user_id: "user-communications",
            updated_by_user_id: "user-communications",
            last_sync_operation_id: null,
            last_sync_attempt_at: null,
            last_synced_at: "2026-04-03T12:00:00.000Z",
            sync_error: null,
            cancelled_at: null,
            created_at: "2026-04-03T12:00:00.000Z",
            updated_at: "2026-04-03T12:00:00.000Z"
          },
          recent_operations: []
        }
      },
      {
        object_type: "task" as const,
        object_id: "task-1",
        object_label: "TASK-200 - Confirm roster notes",
        record_kind_label: "Assigned task",
        route_hash: "#tasks/task-1",
        department_type: "schools",
        organization_label: "North Prep",
        location_label: "Main Gym",
        scheduled_start_at: null,
        due_at: "2026-04-03T13:00:00.000Z",
        latest_activity_at: "2026-04-03T12:01:00.000Z",
        communication: {
          object_type: "task" as const,
          object_id: "task-1",
          object_label: "TASK-200 - Confirm roster notes",
          permissions: {
            can_use: true,
            can_send: true,
            can_configure: false,
            can_view_history: true,
            can_send_proactive: false,
            can_message_chats: true,
            can_message_channels: false,
            can_message_assigned_staff: false
          },
          feature_enabled: true,
          references: [],
          recent_deliveries: [
            {
              id: "delivery-1",
              reference_id: "reference-x",
              reference_label: "North Follow Through",
              reference_type: "chat" as const,
              status: "failed" as const,
              visibility_status: "visible" as const,
              message_text: "Need roster confirmation.",
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
        },
        meeting: {
          object_type: "task" as const,
          object_id: "task-1",
          object_label: "TASK-200 - Confirm roster notes",
          feature_enabled: true,
          permissions: {
            can_use: true,
            can_manage: true,
            can_create: true,
            can_view_history: true
          },
          defaults: {
            suggested_title: "TASK-200 Internal Teams Meeting",
            suggested_description: "Internal Teams meeting linked to TASK-200.",
            scheduled_start_at: null,
            scheduled_end_at: null,
            app_deep_link: "https://app.example.test/?teams=1#tasks/task-1",
            suggested_participants: []
          },
          meeting: null,
          recent_operations: []
        }
      }
    ]
  };
}

describe("TeamsCommunicationsPage", () => {
  beforeEach(() => {
    getTeamsEmbeddedCommunicationHubMock.mockReset();
    queueTeamsCommunicationMessageMock.mockReset();
    upsertTeamsMeetingMock.mockReset();
    window.history.replaceState(null, "", "/?teams=1#teams/communications");
  });

  it("renders the focused Teams communication sections and preserves record deep links on sends", async () => {
    getTeamsEmbeddedCommunicationHubMock.mockResolvedValue(createHub());
    queueTeamsCommunicationMessageMock.mockResolvedValue({
      id: "delivery-queued",
      reference_id: "reference-1",
      reference_label: "North Day Of",
      reference_type: "channel",
      status: "queued",
      message_text: "Heads up",
      app_deep_link: "#schools/shoots/job-1",
      teams_destination_url: "https://teams.microsoft.com/l/channel/channel-id",
      attempt_count: 0,
      first_attempted_at: null,
      last_attempted_at: null,
      sent_at: null,
      failed_at: null,
      last_error: null,
      external_message_id: null,
      created_at: "2026-04-03T12:00:00.000Z",
      updated_at: "2026-04-03T12:00:00.000Z"
    });

    render(<TeamsCommunicationsPage token="teams-token" currentUser={createUser()} />);

    expect(await screen.findByText("My Teams Actions")).toBeInTheDocument();
    expect(screen.getByText("My Meetings")).toBeInTheDocument();
    expect(screen.getByText("Urgent Communication Alerts")).toBeInTheDocument();
    expect(screen.getByText("Quick Open")).toBeInTheDocument();
    expect(screen.getAllByText("JOB-100 - North Prep Day").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TASK-200 - Confirm roster notes").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Send Record-Linked Update" }));
    fireEvent.change(screen.getByPlaceholderText("Share a short operational update for JOB-100 - North Prep Day."), {
      target: { value: "Crews are staged and ready." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Teams Message" }));

    await waitFor(() => {
      expect(queueTeamsCommunicationMessageMock).toHaveBeenCalledWith(
        "teams-token",
        expect.objectContaining({
          object_type: "job",
          object_id: "job-1",
          app_deep_link: "#schools/shoots/job-1"
        })
      );
    });
  });

  it("shows a setup state for users with communication permissions but incomplete linking", async () => {
    getTeamsEmbeddedCommunicationHubMock.mockResolvedValue({
      ...createHub(),
      communication_identity_status: "incomplete",
      availability: {
        state: "setup_required",
        title: "Finish Microsoft communication setup",
        detail: "Your Microsoft communication identity is not fully linked yet.",
        fix_hint: "Open My Account or Access Control to finish setup."
      },
      entries: []
    });

    render(
      <TeamsCommunicationsPage
        token="teams-token"
        currentUser={createUser({
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
        })}
      />
    );

    expect(await screen.findByText("Finish Microsoft communication setup")).toBeInTheDocument();
    expect(screen.getByText(/Your Microsoft communication identity is not fully linked yet/i)).toBeInTheDocument();
  });
});
