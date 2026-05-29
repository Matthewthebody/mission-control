import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsMeetingPanel } from "../components/TeamsMeetingPanel";
import type { SessionUser } from "../types";

const getTeamsMeetingRecordViewMock = vi.fn();
const upsertTeamsMeetingMock = vi.fn();
const cancelTeamsMeetingMock = vi.fn();
const writeTextMock = vi.fn();

vi.mock("../services/teamsMeetingsApi", () => ({
  getTeamsMeetingRecordView: (...args: unknown[]) => getTeamsMeetingRecordViewMock(...args),
  upsertTeamsMeeting: (...args: unknown[]) => upsertTeamsMeetingMock(...args),
  cancelTeamsMeeting: (...args: unknown[]) => cancelTeamsMeetingMock(...args)
}));

const currentUser: SessionUser = {
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
  roles: ["admin"],
  permissions: ["communication.use", "communication.meeting.manage"],
  authorityTier: "supervisor",
  primaryJobFunctionProfile: "sports_client_success",
  jobFunctionProfiles: ["sports_client_success"],
  permissionGrants: [],
  policyGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  communicationIdentity: {
    provider: "microsoft_teams",
    microsoftUserId: "ms-user-1",
    microsoftTenantId: "ms-tenant-1",
    communicationEnabled: true,
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
  }
};

function buildView() {
  return {
    object_type: "job" as const,
    object_id: "job-1",
    object_label: "JOB-001 | Metro Football Media Day",
    feature_enabled: true,
    permissions: {
      can_use: true,
      can_manage: true
    },
    defaults: {
      suggested_title: "JOB-001 Internal Teams Meeting",
      suggested_description: "Internal Teams meeting linked to JOB-001.",
      scheduled_start_at: "2026-04-10T15:00:00.000Z",
      scheduled_end_at: "2026-04-10T16:00:00.000Z",
      app_deep_link: "https://app.example.test/?teams=1#sports/shoots/job-1",
      default_lifecycle_type: "scheduled_record_meeting" as const,
      allowed_lifecycle_types: ["scheduled_record_meeting", "internal_review"] as const,
      schedule_guidance: "Scheduled record meetings follow the job schedule. Internal review meetings keep their own manual schedule.",
      suggested_participants: [
        {
          user_id: "user-1",
          full_name: "Alex Owner",
          email: "alex@example.com",
          role: "organizer" as const
        }
      ]
    },
    meeting: {
      id: "meeting-1",
      linked_record_type: "job" as const,
      linked_record_id: "job-1",
      meeting_provider: "microsoft_teams" as const,
      meeting_mode: "calendar_event" as const,
      meeting_status: "scheduled" as const,
      lifecycle_type: "scheduled_record_meeting" as const,
      record_sync_policy: "follow_record_schedule" as const,
      timing_state: "upcoming" as const,
      status_summary: "Upcoming",
      record_behavior_summary: "This meeting follows the linked job schedule and participant context.",
      title: "JOB-001 Internal Teams Meeting",
      description: "Internal Teams meeting linked to JOB-001.",
      meeting_join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
      meeting_web_url: "https://outlook.office.com/calendar/item/meeting-1",
      external_meeting_id: null,
      external_calendar_event_id: "graph-event-1",
      organizer_user_id: "user-1",
      organizer_email: "alex@example.com",
      organizer_microsoft_user_id: "ms-user-1",
      participant_snapshot: [
        {
          user_id: "user-1",
          full_name: "Alex Owner",
          email: "alex@example.com",
          role: "organizer" as const
        }
      ],
      app_deep_link: "https://app.example.test/?teams=1#sports/shoots/job-1",
      scheduled_start_at: "2026-04-10T15:00:00.000Z",
      scheduled_end_at: "2026-04-10T16:00:00.000Z",
      created_by_user_id: "user-1",
      updated_by_user_id: "user-1",
      last_sync_operation_id: "operation-1",
      last_sync_attempt_at: "2026-04-03T12:00:00.000Z",
      last_synced_at: "2026-04-03T12:00:10.000Z",
      sync_error: null,
      cancelled_at: null,
      created_at: "2026-04-03T12:00:00.000Z",
      updated_at: "2026-04-03T12:00:10.000Z"
    },
    recent_operations: [
      {
        id: "operation-1",
        meeting_id: "meeting-1",
        operation_type: "create" as const,
        trigger_source: "manual_create",
        actor_user_id: "user-1",
        status: "succeeded" as const,
        app_event_id: "app-event-1",
        attempt_count: 1,
        first_attempted_at: "2026-04-03T12:00:00.000Z",
        last_attempted_at: "2026-04-03T12:00:05.000Z",
        completed_at: "2026-04-03T12:00:10.000Z",
        failed_at: null,
        last_error: null,
        created_at: "2026-04-03T12:00:00.000Z",
        updated_at: "2026-04-03T12:00:10.000Z"
      }
    ]
  };
}

describe("TeamsMeetingPanel", () => {
  beforeEach(() => {
    getTeamsMeetingRecordViewMock.mockReset();
    upsertTeamsMeetingMock.mockReset();
    cancelTeamsMeetingMock.mockReset();
    writeTextMock.mockReset();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock
      }
    });
    getTeamsMeetingRecordViewMock.mockResolvedValue(buildView());
    upsertTeamsMeetingMock.mockResolvedValue(buildView().meeting);
  });

  it("shows the join link, supports copying the meeting link, and queues meeting updates from the record panel", async () => {
    render(
      <TeamsMeetingPanel
        token="token-demo"
        currentUser={currentUser}
        objectType="job"
        objectId="job-1"
        renderPreCallContext={() => <div>Pre-call context preview</div>}
      />
    );

    expect(await screen.findByRole("link", { name: "Join / Start Teams Meeting" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/meetup-join/meeting-1"
    );
    expect(screen.getByText("Pre-call context preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy / Share Meeting Link" }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("https://teams.microsoft.com/l/meetup-join/meeting-1")
    );
    expect(await screen.findByText("Meeting link copied.")).toBeInTheDocument();
    expect(screen.getAllByText("Scheduled record meeting").length).toBeGreaterThan(0);
    expect(screen.getByText("Follows linked record schedule")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "JOB-001 Updated Internal Teams Meeting" }
    });
    fireEvent.change(screen.getByLabelText("Purpose"), {
      target: { value: "internal_review" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Queue Meeting Update" }));

    await waitFor(() =>
      expect(upsertTeamsMeetingMock).toHaveBeenCalledWith("token-demo", expect.objectContaining({
        object_type: "job",
        object_id: "job-1",
        lifecycle_type: "internal_review",
        meeting_mode: "calendar_event",
        title: "JOB-001 Updated Internal Teams Meeting"
      }))
    );

    expect(await screen.findByText("Teams meeting update queued.")).toBeInTheDocument();
  });

  it("offers a quick internal call action when no meeting is linked yet", async () => {
    getTeamsMeetingRecordViewMock.mockResolvedValueOnce({
      ...buildView(),
      meeting: null,
      defaults: {
        ...buildView().defaults,
        scheduled_start_at: null,
        scheduled_end_at: null
      }
    });

    render(<TeamsMeetingPanel token="token-demo" currentUser={currentUser} objectType="job" objectId="job-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Internal Call" }));

    await waitFor(() =>
      expect(upsertTeamsMeetingMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          object_type: "job",
          object_id: "job-1",
          meeting_mode: "standalone_online_meeting",
          scheduled_start_at: expect.any(String),
          scheduled_end_at: expect.any(String)
        })
      )
    );

    expect(await screen.findByText("Internal call queued in Teams.")).toBeInTheDocument();
  });
});
