import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createClient(referenceType: "chat" | "channel") {
  const deliveryRow = {
    id: "delivery-1",
    actor_user_id: "user-1",
    status: "queued",
    message_text: "Please review the updated run sheet.",
    app_deep_link: "https://app.example.test/?teams=1#jobs/job-1",
    request_payload: {},
    reference_id: "reference-1",
    reference_status: "active",
    reference_label: referenceType === "chat" ? "Crew Chat" : "Ops Channel",
    reference_type: referenceType,
    teams_web_url:
      referenceType === "chat"
        ? "https://teams.microsoft.com/l/chat/0/0?users=user@example.com"
        : "https://teams.microsoft.com/l/channel/channel-id/Ops",
    team_id: referenceType === "channel" ? "team-1" : null,
    channel_id: referenceType === "channel" ? "channel-1" : null,
    chat_id: referenceType === "chat" ? "19:chat-id" : null
  };

  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM teams_communication_delivery delivery")) {
        return { rows: [deliveryRow] };
      }
      if (
        sql.includes("UPDATE teams_communication_delivery") ||
        sql.includes("INSERT INTO teams_communication_delivery_event") ||
        sql.includes("UPDATE teams_communication_reference") ||
        sql.includes("INSERT INTO audit_events")
      ) {
        return { rows: [] };
      }
      throw new Error(`Unhandled SQL in teamsMessagingGraph.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

async function loadDispatchModule() {
  vi.resetModules();
  vi.doMock("../src/config.js", () => ({
    config: {
      MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED: true,
      MICROSOFT_TEAMS_BOT_APP_ID: "bot-app-id",
      MICROSOFT_TEAMS_BOT_APP_PASSWORD: "bot-app-secret",
      MICROSOFT_GRAPH_TENANT_ID: "graph-tenant-id",
      TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS: 5000
    }
  }));
  return import("../src/communications/teamsMessagingGraph.js");
}

describe("teams messaging Graph delivery", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to an existing Teams chat", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "graph-token",
          expires_in: 3600
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "graph-message-1" })
      });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchTeamsCommunicationDelivery } = await loadDispatchModule();
    await dispatchTeamsCommunicationDelivery(createClient("chat"), "tenant-1", "delivery-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/chats/19%3Achat-id/messages");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("Open in Mission Control");
  });

  it("posts to an existing Teams channel", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "graph-token",
          expires_in: 3600
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "graph-message-2" })
      });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchTeamsCommunicationDelivery } = await loadDispatchModule();
    await dispatchTeamsCommunicationDelivery(createClient("channel"), "tenant-1", "delivery-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/teams/team-1/channels/channel-1/messages");
  });
});
