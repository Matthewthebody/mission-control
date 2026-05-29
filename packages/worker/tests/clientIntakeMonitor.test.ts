import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

describe("client intake reminder monitor", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls the internal client intake reminder sweep endpoint with the internal secret", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant_count: 1,
        scanned_mapping_count: 6,
        reminder_queued_count: 2,
        overdue_queued_count: 1,
        suppressed_count: 3,
        unmatched_open_count: 1,
        failed_count: 0
      })
    });

    const { monitorClientIntakeReminders } = await import("../src/jobs/clientIntakeMonitor.js");
    const result = await monitorClientIntakeReminders();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/integrations/microsoft/client-intake/internal/reminders/sweep");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json"
    });
    expect(result.reminder_queued_count).toBe(2);
    expect(result.overdue_queued_count).toBe(1);
  });

  it("throws a readable error when the client intake sweep endpoint fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service unavailable",
      text: async () => "client intake scheduler offline"
    });

    const { monitorClientIntakeReminders } = await import("../src/jobs/clientIntakeMonitor.js");

    await expect(monitorClientIntakeReminders()).rejects.toThrow(
      "Client intake reminder sweep failed (503): client intake scheduler offline"
    );
  });

  it("calls the internal client intake operational control sweep endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tenant_count: 1,
        scanned_submission_count: 4,
        review_assignment_count: 1,
        escalated_count: 2,
        digest_queued_count: 1,
        suppressed_count: 1,
        failed_count: 0
      })
    });

    const { monitorClientIntakeOperationalControl } = await import("../src/jobs/clientIntakeMonitor.js");
    const result = await monitorClientIntakeOperationalControl();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/integrations/microsoft/client-intake/internal/operations/sweep");
    expect(options.method).toBe("POST");
    expect(result.escalated_count).toBe(2);
    expect(result.digest_queued_count).toBe(1);
  });
});
