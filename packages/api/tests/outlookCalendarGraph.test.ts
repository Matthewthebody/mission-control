import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { listOutlookBusyWindowsForUsers } from "../src/services/outlookCalendarGraph.js";

const originalConfig = {
  MICROSOFT_OUTLOOK_SYNC_ENABLED: config.MICROSOFT_OUTLOOK_SYNC_ENABLED,
  OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED,
  MICROSOFT_GRAPH_CLIENT_ID: config.MICROSOFT_GRAPH_CLIENT_ID,
  MICROSOFT_GRAPH_CLIENT_SECRET: config.MICROSOFT_GRAPH_CLIENT_SECRET,
  MICROSOFT_GRAPH_TENANT_ID: config.MICROSOFT_GRAPH_TENANT_ID,
  OUTLOOK_GRAPH_TIMEOUT_MS: config.OUTLOOK_GRAPH_TIMEOUT_MS
};

afterEach(() => {
  Object.assign(config, originalConfig);
  vi.restoreAllMocks();
});

describe("Outlook app-permission busy-window graph client", () => {
  it("stays disabled and returns no busy windows even when the legacy flag is enabled", async () => {
    Object.assign(config, {
      MICROSOFT_OUTLOOK_SYNC_ENABLED: true,
      OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: true,
      MICROSOFT_GRAPH_CLIENT_ID: "graph-client-id",
      MICROSOFT_GRAPH_CLIENT_SECRET: "graph-client-secret",
      MICROSOFT_GRAPH_TENANT_ID: "graph-tenant-id",
      OUTLOOK_GRAPH_TIMEOUT_MS: 5000
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const busyWindows = await listOutlookBusyWindowsForUsers({
      staff: [{ userId: "user-1", email: "photo@example.com" }],
      startsAt: "2026-04-24T13:00:00.000Z",
      endsAt: "2026-04-24T15:00:00.000Z"
    });

    expect(busyWindows).toBeInstanceOf(Map);
    expect(busyWindows.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
