import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffAssignmentCommunicationActions } from "../components/jobs/StaffAssignmentCommunicationActions";
import type { SharedJobStaffAssignment } from "../jobTruthTypes";
import type { SessionUser } from "../types";

const getTeamsCommunicationRecordViewMock = vi.fn();
const queueTeamsCommunicationMessageMock = vi.fn();
const getTeamsMeetingRecordViewMock = vi.fn();
const upsertTeamsMeetingMock = vi.fn();
const writeTextMock = vi.fn();

vi.mock("../services/teamsCommunicationApi", () => ({
  getTeamsCommunicationRecordView: (...args: unknown[]) => getTeamsCommunicationRecordViewMock(...args),
  createTeamsCommunicationReference: vi.fn(),
  queueTeamsCommunicationMessage: (...args: unknown[]) => queueTeamsCommunicationMessageMock(...args)
}));

vi.mock("../services/teamsMeetingsApi", () => ({
  getTeamsMeetingRecordView: (...args: unknown[]) => getTeamsMeetingRecordViewMock(...args),
  upsertTeamsMeeting: (...args: unknown[]) => upsertTeamsMeetingMock(...args),
  cancelTeamsMeeting: vi.fn()
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
  permissions: ["communication.use", "communication.send", "communication.meeting.manage"],
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

const assignment: SharedJobStaffAssignment = {
  id: "assignment-1",
  tenant_id: "tenant-1",
  job_id: "job-1",
  job_day_id: null,
  user_id: "user-photo-1",
  user_name: "Taylor Photographer",
  assignment_role: "lead_photographer",
  assignment_status: "assigned",
  is_lead: true,
  check_in_at: null,
  check_out_at: null,
  is_ready_present: false,
  notes: "Lead for day one.",
  created_at: "2026-04-03T12:00:00.000Z",
  updated_at: "2026-04-03T12:00:00.000Z"
};

describe("StaffAssignmentCommunicationActions", () => {
  beforeEach(() => {
    getTeamsCommunicationRecordViewMock.mockReset();
    queueTeamsCommunicationMessageMock.mockReset();
    getTeamsMeetingRecordViewMock.mockReset();
    upsertTeamsMeetingMock.mockReset();
    writeTextMock.mockReset();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock
      }
    });

    getTeamsCommunicationRecordViewMock.mockResolvedValue({
      object_type: "job",
      object_id: "job-1",
      object_label: "JOB-001 | Metro Football Media Day",
      permissions: {
        can_use: true,
        can_send: true,
        can_configure: false,
        can_view_history: true,
        can_send_proactive: false,
        can_message_chats: false,
        can_message_channels: true,
        can_message_assigned_staff: true
      },
      feature_enabled: true,
      references: [
        {
          id: "reference-1",
          reference_type: "channel",
          status: "active",
          label: "Day Of Channel",
          description: "Crew updates",
          teams_web_url: "https://teams.microsoft.com/l/channel/channel-id/day-of",
          team_id: "team-1",
          channel_id: "channel-1",
          chat_id: null,
          is_primary: true,
          created_at: "2026-04-03T12:00:00.000Z",
          updated_at: "2026-04-03T12:00:00.000Z",
          last_verified_at: "2026-04-03T12:10:00.000Z"
        }
      ],
      recent_deliveries: [
        {
          id: "delivery-1",
          reference_id: "reference-1",
          reference_label: "Day Of Channel",
          reference_type: "channel",
          status: "sent",
          message_text: "[Assignment: Taylor Photographer] Ready for load-in.",
          app_deep_link: "#sports/shoots/job-1?tab=staffing",
          teams_destination_url: "https://teams.microsoft.com/l/channel/channel-id/day-of",
          attempt_count: 1,
          first_attempted_at: "2026-04-03T12:20:00.000Z",
          last_attempted_at: "2026-04-03T12:20:00.000Z",
          sent_at: "2026-04-03T12:20:01.000Z",
          failed_at: null,
          last_error: null,
          external_message_id: "graph-message-1",
          created_at: "2026-04-03T12:20:00.000Z",
          updated_at: "2026-04-03T12:20:01.000Z"
        }
      ]
    });

    getTeamsMeetingRecordViewMock.mockResolvedValue({
      object_type: "job",
      object_id: "job-1",
      object_label: "JOB-001 | Metro Football Media Day",
      feature_enabled: true,
      permissions: {
        can_use: true,
        can_manage: true,
        can_create: true,
        can_view_history: true
      },
      defaults: {
        suggested_title: "JOB-001 Internal Teams Meeting",
        suggested_description: "Internal Teams meeting linked to JOB-001.",
        scheduled_start_at: "2026-04-10T15:00:00.000Z",
        scheduled_end_at: "2026-04-10T16:00:00.000Z",
        app_deep_link: "https://app.example.test/?teams=1#sports/shoots/job-1",
        suggested_participants: []
      },
      meeting: {
        id: "meeting-1",
        linked_record_type: "job",
        linked_record_id: "job-1",
        meeting_provider: "microsoft_teams",
        meeting_mode: "calendar_event",
        meeting_status: "scheduled",
        title: "JOB-001 Internal Teams Meeting",
        description: "Internal Teams meeting linked to JOB-001.",
        meeting_join_url: "https://teams.microsoft.com/l/meetup-join/job-meeting-1",
        meeting_web_url: "https://outlook.office.com/calendar/item/job-meeting-1",
        external_meeting_id: "meeting-1",
        external_calendar_event_id: "event-1",
        organizer_user_id: "user-1",
        organizer_email: "alex@example.com",
        organizer_microsoft_user_id: "ms-user-1",
        participant_snapshot: [],
        app_deep_link: "https://app.example.test/?teams=1#sports/shoots/job-1",
        scheduled_start_at: "2026-04-10T15:00:00.000Z",
        scheduled_end_at: "2026-04-10T16:00:00.000Z",
        created_by_user_id: "user-1",
        updated_by_user_id: "user-1",
        last_sync_operation_id: null,
        last_sync_attempt_at: null,
        last_synced_at: "2026-04-03T12:15:00.000Z",
        sync_error: null,
        cancelled_at: null,
        created_at: "2026-04-03T12:00:00.000Z",
        updated_at: "2026-04-03T12:15:00.000Z"
      },
      recent_operations: []
    });

    queueTeamsCommunicationMessageMock.mockResolvedValue({
      id: "delivery-2",
      reference_id: "reference-1",
      reference_label: "Day Of Channel",
      reference_type: "channel",
      status: "queued",
      message_text: "[Assignment: Taylor Photographer] Please head to the check-in table.",
      app_deep_link: "#sports/shoots/job-1?tab=staffing",
      teams_destination_url: "https://teams.microsoft.com/l/channel/channel-id/day-of",
      attempt_count: 0,
      first_attempted_at: null,
      last_attempted_at: null,
      sent_at: null,
      failed_at: null,
      last_error: null,
      external_message_id: null,
      created_at: "2026-04-03T12:25:00.000Z",
      updated_at: "2026-04-03T12:25:00.000Z"
    });
  });

  it("shows job-level Teams actions on a staffing assignment row and prefixes the outbound update", async () => {
    window.location.hash = "#sports/shoots/job-1?tab=staffing";

    render(<StaffAssignmentCommunicationActions token="token-demo" currentUser={currentUser} jobId="job-1" assignment={assignment} />);

    expect(await screen.findByText("Teams context")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open Related Channel" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/channel/channel-id/day-of"
    );
    expect(await screen.findByRole("link", { name: "Join Linked Meeting" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/meetup-join/job-meeting-1"
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy / Share Meeting Link" }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("https://teams.microsoft.com/l/meetup-join/job-meeting-1")
    );
    expect(await screen.findByText("Meeting link copied.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Message Assigned Staff" }));
    fireEvent.change(screen.getByLabelText("Internal update"), {
      target: { value: "Please head to the check-in table." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Internal Update" }));

    await waitFor(() =>
      expect(queueTeamsCommunicationMessageMock).toHaveBeenCalledWith("token-demo", {
        reference_id: "reference-1",
        object_type: "job",
        object_id: "job-1",
        message_text: "[Assignment: Taylor Photographer] Please head to the check-in table.",
        app_deep_link: "#sports/shoots/job-1?tab=staffing"
      })
    );
    expect(await screen.findByText("Assignment update queued to Teams.")).toBeInTheDocument();
  });
});
