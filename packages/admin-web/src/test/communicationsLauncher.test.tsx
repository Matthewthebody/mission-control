// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunicationsLauncher } from "../components/communications/CommunicationsLauncher";
import type { SessionUser } from "../types";

const getTeamsEmbeddedCommunicationHubMock = vi.fn();

vi.mock("../permissions", () => ({
  canAccessTeamsCommunicationSurface: vi.fn(() => true)
}));

vi.mock("../services/teamsEmbeddedCommunicationsApi", () => ({
  getTeamsEmbeddedCommunicationHub: (...args: unknown[]) => getTeamsEmbeddedCommunicationHubMock(...args)
}));

function createUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-communications",
    tenantId: "tenant-demo",
    accountId: "account-communications",
    sessionId: "session-communications",
    email: "communications@example.com",
    fullName: "Jordan Communication",
    status: "active",
    department: "schools",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["manager"],
    permissions: ["communication.use"],
    authorityTier: "supervisor",
    primaryJobFunctionProfile: "schools_client_success",
    jobFunctionProfiles: ["schools_client_success"],
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
      status: "incomplete"
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
      breakGlassModeActive: false,
      lastReauthenticatedAt: null,
      activeAuthContextIds: []
    },
    ...overrides
  };
}

function createHub() {
  return {
    generated_at: "2026-04-04T15:00:00.000Z",
    feature_flags: {
      personal_app_enabled: true,
      messaging_enabled: true,
      meetings_enabled: true
    },
    communication_identity_status: "incomplete" as const,
    availability: {
      state: "setup_required" as const,
      title: "Finish Microsoft communication setup",
      detail: "Your Microsoft identity is not fully linked yet.",
      fix_hint: "Open My Account to finish setup."
    },
    permissions: {
      can_use: true,
      can_send: false,
      can_manage_meetings: false,
      can_configure: false,
      can_view_history: true,
      can_send_proactive: false
    },
    summary: {
      action_records: 2,
      active_meetings: 1,
      urgent_alerts: 1,
      missing_destinations: 1,
      latest_activity_at: "2026-04-04T14:01:00.000Z"
    },
    entries: [
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
        due_at: "2026-04-04T16:00:00.000Z",
        latest_activity_at: "2026-04-04T14:01:00.000Z",
        communication: {
          object_type: "task" as const,
          object_id: "task-1",
          object_label: "TASK-200 - Confirm roster notes",
          permissions: {
            can_use: true,
            can_send: false,
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
              first_attempted_at: "2026-04-04T14:00:00.000Z",
              last_attempted_at: "2026-04-04T14:01:00.000Z",
              sent_at: null,
              failed_at: "2026-04-04T14:01:00.000Z",
              last_error: "Graph timeout",
              external_message_id: null,
              moderated_at: null,
              moderated_by_user_id: null,
              moderation_reason: null,
              created_at: "2026-04-04T14:00:00.000Z",
              updated_at: "2026-04-04T14:01:00.000Z"
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
            can_manage: false,
            can_create: false,
            can_view_history: true
          },
          defaults: {
            suggested_title: "TASK-200 Internal Teams Meeting",
            suggested_description: "Internal Teams meeting linked to TASK-200.",
            scheduled_start_at: null,
            scheduled_end_at: null,
            app_deep_link: "https://app.example.test/#tasks/task-1",
            suggested_participants: []
          },
          meeting: null,
          recent_operations: []
        }
      }
    ]
  };
}

describe("CommunicationsLauncher", () => {
  beforeEach(() => {
    getTeamsEmbeddedCommunicationHubMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#dashboard");
  });

  it("keeps communications discoverable with a compact launcher and honest setup guidance", async () => {
    getTeamsEmbeddedCommunicationHubMock.mockResolvedValue(createHub());

    render(<CommunicationsLauncher token="launcher-token" currentUser={createUser()} mobile={false} fullRouteId="teams-communications" />);

    fireEvent.click(screen.getByRole("button", { name: /teams/i }));

    expect(await screen.findByText("Quick access")).toBeInTheDocument();
    expect(screen.getByText(/your Microsoft identity is not fully linked yet/i)).toBeInTheDocument();
    expect(screen.getByText("TASK-200 - Confirm roster notes send failed")).toBeInTheDocument();
    expect(screen.getByText("TASK-200 - Confirm roster notes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => {
      expect(window.localStorage.getItem("pmc-communications-pins")).toContain("task:task-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Actions Page" }));
    expect(window.location.hash).toBe("#teams/communications");
  });
});
