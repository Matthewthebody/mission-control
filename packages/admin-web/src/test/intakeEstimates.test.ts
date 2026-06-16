import { describe, expect, it } from "vitest";
import { addBusinessDays, yearFromIsoDate } from "../components/jobs/intakeEstimates";

describe("intake production deadline estimates", () => {
  it("adds business days and skips weekends", () => {
    // Wed 2026-08-26 + 5 business days = Wed 2026-09-02 (Sat/Sun skipped).
    expect(addBusinessDays("2026-08-26", 5)).toBe("2026-09-02");
  });

  it("rolls a Friday + 1 business day to the following Monday", () => {
    expect(addBusinessDays("2026-08-28", 1)).toBe("2026-08-31");
  });

  it("returns empty for missing or non-positive inputs (no mysterious deadline)", () => {
    expect(addBusinessDays("", 5)).toBe("");
    expect(addBusinessDays("2026-08-26", 0)).toBe("");
    expect(addBusinessDays("2026-08-26", -3)).toBe("");
    expect(addBusinessDays("not-a-date", 5)).toBe("");
  });

  it("reads the shoot year for the auto-generated job name", () => {
    expect(yearFromIsoDate("2026-08-21")).toBe("2026");
    expect(yearFromIsoDate("")).toBe("");
    expect(yearFromIsoDate("08/21/2026")).toBe("");
  });
});
