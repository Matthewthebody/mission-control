import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsCommunicationPanel } from "../components/TeamsCommunicationPanel";
import type { SessionUser } from "../types";

const getTeamsCommunicationRecordViewMock = vi.fn();
const createTeamsCommunicationReferenceMock = vi.fn();
const queueTeamsCommunicationMessageMock = vi.fn();

vi.mock("../services/teamsCommunicationApi", () => ({
  getTeamsCommunicationRecordView: (...args: unknown[]) => getTeamsCommunicationRecordViewMock(...args),
  createTeamsCommunicationReference: (...args: unknown[]) => createTeamsCommunicationReferenceMock(...args),
  queueTeamsCommunicationMessage: (...args: unknown[]) => queueTeamsCommunicationMessageMock(...args)
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
  permissions: ["communication.use", "communication.send", "communication.configure"],
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
    permissions: {
      can_use: true,
      can_send: true,
      can_configure: true
    },
    feature_enabled: true,
    references: [
      {
        id: "reference-1",
        reference_type: "chat" as const,
        status: "active" as const,
        label: "Crew Chat",
        description: "Day-of internal crew chat",
        teams_web_url: "https://teams.microsoft.com/l/chat/0/0?users=user@example.com",
        team_id: null,
        channel_id: null,
        chat_id: "19:chat-id",
        is_primary: true,
        created_at: "2026-04-03T12:00:00.000Z",
        updated_at: "2026-04-03T12:00:00.000Z",
        last_verified_at: "2026-04-03T12:05:00.000Z"
      }
    ],
    recent_deliveries: [
      {
        id: "delivery-1",
        reference_id: "reference-1",
        reference_label: "Crew Chat",
        reference_type: "chat" as const,
        status: "sent" as const,
        message_text: "Please review the updated run sheet.",
        app_deep_link: "https://app.example.test/?teams=1#jobs/job-1",
        teams_destination_url: "https://teams.microsoft.com/l/chat/0/0?users=user@example.com",
        attempt_count: 1,
        first_attempted_at: "2026-04-03T12:10:00.000Z",
        last_attempted_at: "2026-04-03T12:10:00.000Z",
        sent_at: "2026-04-03T12:10:01.000Z",
        failed_at: null,
        last_error: null,
        external_message_id: "graph-message-1",
        created_at: "2026-04-03T12:10:00.000Z",
        updated_at: "2026-04-03T12:10:01.000Z"
      }
    ]
  };
}

describe("TeamsCommunicationPanel", () => {
  beforeEach(() => {
    getTeamsCommunicationRecordViewMock.mockReset();
    createTeamsCommunicationReferenceMock.mockReset();
    queueTeamsCommunicationMessageMock.mockReset();
    getTeamsCommunicationRecordViewMock.mockResolvedValue(buildView());
    createTeamsCommunicationReferenceMock.mockResolvedValue(buildView().references[0]);
    queueTeamsCommunicationMessageMock.mockResolvedValue({
      ...buildView().recent_deliveries[0],
      status: "queued"
    });
    window.location.hash = "#sports/shoots/job-1";
  });

  it("shows linked Teams destinations and queues a message", async () => {
    render(<TeamsCommunicationPanel token="token-demo" currentUser={currentUser} objectType="job" objectId="job-1" />);

    expect(await screen.findByRole("link", { name: "Open Related Chat" })).toHaveAttribute(
      "href",
      "https://teams.microsoft.com/l/chat/0/0?users=user@example.com"
    );

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Please review the updated run sheet." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Teams Message" }));

    await waitFor(() =>
      expect(queueTeamsCommunicationMessageMock).toHaveBeenCalledWith("token-demo", {
        reference_id: "reference-1",
        object_type: "job",
        object_id: "job-1",
        message_text: "Please review the updated run sheet.",
        app_deep_link: "#sports/shoots/job-1"
      })
    );
    expect(await screen.findByText("Teams message queued.")).toBeInTheDocument();
  });

  it("lets an admin link a new Teams channel destination", async () => {
    render(<TeamsCommunicationPanel token="token-demo" currentUser={currentUser} objectType="job" objectId="job-1" />);

    await screen.findByRole("link", { name: "Open Related Chat" });

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "channel" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Day Of Channel" } });
    fireEvent.change(screen.getByLabelText("Teams URL"), {
      target: { value: "https://teams.microsoft.com/l/channel/channel-id/Day-Of" }
    });
    fireEvent.change(screen.getByLabelText("Team ID"), { target: { value: "team-1" } });
    fireEvent.change(screen.getByLabelText("Channel ID"), { target: { value: "channel-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Teams Destination" }));

    await waitFor(() =>
      expect(createTeamsCommunicationReferenceMock).toHaveBeenCalledWith("token-demo", "job", "job-1", {
        reference_type: "channel",
        label: "Day Of Channel",
        description: null,
        teams_web_url: "https://teams.microsoft.com/l/channel/channel-id/Day-Of",
        team_id: "team-1",
        channel_id: "channel-1",
        chat_id: null,
        is_primary: true
      })
    );
    expect(await screen.findByText("Teams destination saved.")).toBeInTheDocument();
  });
});
