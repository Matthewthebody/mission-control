import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createClient(options: {
  meetingMode: "calendar_event" | "standalone_online_meeting";
  operationType?: "create" | "update" | "cancel";
  externalCalendarEventId?: string | null;
  externalMeetingId?: string | null;
}) {
  const operationRow = {
    id: "operation-1",
    tenant_id: "tenant-1",
    meeting_id: "meeting-1",
    operation_type: options.operationType ?? "create",
    trigger_source: "manual_create",
    actor_user_id: "user-1",
    status: "queued",
    request_payload: {},
    meeting_mode: options.meetingMode,
    meeting_status: options.operationType === "cancel" ? "pending_cancel" : "pending_create",
    title: "JOB-001 Internal Teams Meeting",
    description: "Internal Teams meeting linked to JOB-001.",
    meeting_join_url: null,
    meeting_web_url: null,
    external_meeting_id: options.externalMeetingId ?? null,
    external_calendar_event_id: options.externalCalendarEventId ?? null,
    organizer_user_id: "user-1",
    organizer_email: "alex@example.com",
    organizer_microsoft_user_id: "ms-user-1",
    participant_snapshot: [
      {
        user_id: "owner-1",
        full_name: "Alex Owner",
        email: "alex@example.com",
        role: "organizer"
      },
      {
        user_id: "attendee-1",
        full_name: "Crew Member",
        email: "crew@example.com",
        role: "attendee"
      }
    ],
    app_deep_link: "https://app.example.test/?teams=1#sports/shoots/job-1",
    scheduled_start_at: "2026-04-10T15:00:00.000Z",
    scheduled_end_at: "2026-04-10T16:00:00.000Z",
    linked_record_type: "job",
    linked_record_id: "job-1"
  };

  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM teams_meeting_sync_operation operation")) {
        return { rows: [operationRow] };
      }
      if (
        sql.includes("UPDATE teams_meeting_sync_operation") ||
        sql.includes("UPDATE teams_meeting_reference") ||
        sql.includes("INSERT INTO audit_events")
      ) {
        return { rows: [] };
      }
      throw new Error(`Unhandled SQL in teamsMeetingsGraph.test.ts: ${sql}`);
    })
  } as unknown as PoolClient;
}

async function loadDispatchModule() {
  vi.resetModules();
  vi.doMock("../src/config.js", () => ({
    config: {
      MICROSOFT_TEAMS_MEETINGS_ENABLED: true,
      MICROSOFT_GRAPH_CLIENT_ID: "graph-client-id",
      MICROSOFT_GRAPH_CLIENT_SECRET: "graph-client-secret",
      MICROSOFT_GRAPH_TENANT_ID: "graph-tenant-id",
      TEAMS_MEETING_GRAPH_TIMEOUT_MS: 5000,
      OUTLOOK_CALENDAR_TIMEZONE: "America/Chicago"
    }
  }));
  return import("../src/communications/teamsMeetingsGraph.js");
}

describe("teams meetings Graph sync", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a calendar-backed Teams meeting through the organizer calendar event path", async () => {
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
        text: async () =>
          JSON.stringify({
            id: "graph-event-1",
            webLink: "https://outlook.office.com/calendar/item/graph-event-1",
            onlineMeeting: {
              joinUrl: "https://teams.microsoft.com/l/meetup-join/graph-event-1"
            }
          })
      });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchTeamsMeetingSyncOperation } = await loadDispatchModule();
    await dispatchTeamsMeetingSyncOperation(createClient({ meetingMode: "calendar_event" }), "tenant-1", "operation-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/users/ms-user-1/events");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("\"isOnlineMeeting\":true");
  });

  it("creates a standalone onlineMeeting for quick internal huddles", async () => {
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
        text: async () =>
          JSON.stringify({
            id: "graph-meeting-1",
            joinWebUrl: "https://teams.microsoft.com/l/meetup-join/graph-meeting-1"
          })
      });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchTeamsMeetingSyncOperation } = await loadDispatchModule();
    await dispatchTeamsMeetingSyncOperation(
      createClient({ meetingMode: "standalone_online_meeting" }),
      "tenant-1",
      "operation-1"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/users/ms-user-1/onlineMeetings");
  });
});
