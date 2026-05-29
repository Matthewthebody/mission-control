import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunicationHistoryPanel } from "../components/CommunicationHistoryPanel";
import type { SessionUser } from "../types";

const getCommunicationHistoryRecordViewMock = vi.fn();
const writeTextMock = vi.fn();

vi.mock("../services/communicationHistoryApi", () => ({
  getCommunicationHistoryRecordView: (...args: unknown[]) => getCommunicationHistoryRecordViewMock(...args)
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

describe("CommunicationHistoryPanel", () => {
  beforeEach(() => {
    getCommunicationHistoryRecordViewMock.mockReset();
    writeTextMock.mockReset();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock
      }
    });

    getCommunicationHistoryRecordViewMock.mockResolvedValue({
      object_type: "job",
      object_id: "job-1",
      object_label: "JOB-001 | Metro Football Media Day",
      feature_enabled: true,
      permissions: {
        can_view_history: true,
        can_use_actions: true,
        can_view_messages: true,
        can_view_meetings: true
      },
      summary: {
        latest_activity_at: "2026-04-03T12:20:01.000Z",
        latest_message: {
          kind: "message",
          action_type: "message_send",
          target_type: "channel",
          target_reference_id: "reference-1",
          target_id: "channel-1",
          target_label: "Day Of Channel",
          target_url: "https://teams.microsoft.com/l/channel/day-of",
          actor_user_id: "user-1",
          actor_name: "Alex Owner",
          status: "sent",
          summary: "Sent update to Day Of Channel",
          join_url: null,
          failure_reason: null,
          occurred_at: "2026-04-03T12:10:01.000Z",
          created_at: "2026-04-03T12:10:00.000Z",
          updated_at: "2026-04-03T12:10:01.000Z"
        },
        latest_meeting: {
          kind: "meeting",
          action_type: "meeting_update",
          target_type: "meeting",
          target_reference_id: "meeting-1",
          target_id: "meeting-external-1",
          target_label: "JOB-001 Internal Teams Meeting",
          target_url: "https://outlook.office.com/calendar/item/meeting-1",
          actor_user_id: "user-1",
          actor_name: "Alex Owner",
          status: "succeeded",
          summary: "Updated JOB-001 Internal Teams Meeting",
          join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
          failure_reason: null,
          occurred_at: "2026-04-03T12:20:01.000Z",
          created_at: "2026-04-03T12:20:00.000Z",
          updated_at: "2026-04-03T12:20:01.000Z"
        },
        latest_follow_up: null,
        latest_failure: null
      },
      entries: [
        {
          id: "meeting:operation-1",
          kind: "meeting",
          action_type: "meeting_update",
          target_type: "meeting",
          target_reference_id: "meeting-1",
          target_id: "meeting-external-1",
          target_label: "JOB-001 Internal Teams Meeting",
          target_url: "https://outlook.office.com/calendar/item/meeting-1",
          related_record_type: "job",
          related_record_id: "job-1",
          actor_user_id: "user-1",
          actor_name: "Alex Owner",
          status: "succeeded",
          summary: "Updated JOB-001 Internal Teams Meeting",
          join_url: "https://teams.microsoft.com/l/meetup-join/meeting-1",
          failure_reason: null,
          created_at: "2026-04-03T12:20:00.000Z",
          updated_at: "2026-04-03T12:20:01.000Z",
          occurred_at: "2026-04-03T12:20:01.000Z"
        }
      ]
    });
  });

  it("shows latest-state cards and lets the user copy a meeting link from history", async () => {
    render(<CommunicationHistoryPanel token="token-demo" currentUser={currentUser} objectType="job" objectId="job-1" />);

    expect(await screen.findByText("Latest Message")).toBeInTheDocument();
    expect(screen.getByText("Sent update to Day Of Channel")).toBeInTheDocument();
    expect(screen.getAllByText("Updated JOB-001 Internal Teams Meeting")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("https://teams.microsoft.com/l/meetup-join/meeting-1")
    );
    expect(await screen.findByText("Communication link copied.")).toBeInTheDocument();
  });
});
