import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

describe("project tracking SLA monitor", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls the internal workflow SLA sweep endpoint with the internal secret", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant_count: 1,
        scanned_step_count: 4,
        event_count: 2,
        levels: {
          early_warning: 1,
          risk: 0,
          urgent: 0,
          overdue: 1
        }
      })
    });

    const { monitorProjectTrackingSla } = await import("../src/jobs/projectTrackingSlaMonitor.js");
    const result = await monitorProjectTrackingSla();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/workflows/internal/sla/sweep");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json"
    });
    expect(result.event_count).toBe(2);
  });

  it("throws a readable error when the sweep endpoint fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service unavailable",
      text: async () => "workflow API offline"
    });

    const { monitorProjectTrackingSla } = await import("../src/jobs/projectTrackingSlaMonitor.js");

    await expect(monitorProjectTrackingSla()).rejects.toThrow("Project tracking SLA sweep failed (503): workflow API offline");
  });
});
