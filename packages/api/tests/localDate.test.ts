import { describe, expect, it } from "vitest";
import { getLocalDateString, getLocalDayBounds } from "../src/utils/localDate.js";

describe("local date utilities", () => {
  it("resolves the correct local work date for cross-midnight timestamps in a tenant timezone", () => {
    const capturedAt = "2026-04-01T04:30:00.000Z";

    expect(getLocalDateString(capturedAt, { timeZone: "America/Chicago" })).toBe("2026-03-31");
    expect(getLocalDateString(capturedAt, { timeZone: "UTC" })).toBe("2026-04-01");
  });

  it("builds timezone-safe day bounds for payroll work-date lookups", () => {
    const bounds = getLocalDayBounds("2026-03-31T23:45:00.000Z", { timeZone: "America/Chicago" });

    expect(bounds.start.toISOString()).toBe("2026-03-31T05:00:00.000Z");
    expect(bounds.endExclusive.toISOString()).toBe("2026-04-01T05:00:00.000Z");
  });
});
