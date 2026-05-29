import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

describe("checklist reminder monitor", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls the internal checklist reminder sweep endpoint with the internal secret", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant_count: 1,
        scanned_instance_count: 4,
        alert_count: 2,
        watch_flag_count: 2
      })
    });

    const { monitorChecklistReminders } = await import("../src/jobs/checklistMonitor.js");
    const result = await monitorChecklistReminders();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/checklists/internal/reminders/sweep");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json"
    });
    expect(result.alert_count).toBe(2);
  });

  it("throws a readable error when the sweep endpoint fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service unavailable",
      text: async () => "scheduler offline"
    });

    const { monitorChecklistReminders } = await import("../src/jobs/checklistMonitor.js");

    await expect(monitorChecklistReminders()).rejects.toThrow("Checklist reminder sweep failed (503): scheduler offline");
  });
});
