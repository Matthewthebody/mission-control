import { describe, expect, it } from "vitest";
import {
  parseCapacityInterval,
  durationMinutes,
  rawAssignedMinutes,
  uniqueScheduledMinutes,
  overlapMinutes,
  overlapAssignmentCount,
  mergeIntervals,
  operatingDate,
  splitMinutesByOperatingDate,
  weekStartDate,
  addOperatingDays,
  type CapacityInterval
} from "../src/domain/staffing/staffing-capacity.js";

// Pure scheduled-capacity interval math (no DB). America/Chicago operating dates, Monday weeks, DST-correct.
// All instants are explicit UTC (Z) so these tests are independent of the machine timezone.

function interval(startIso: string, endIso: string): CapacityInterval {
  const parsed = parseCapacityInterval(startIso, endIso);
  if (!parsed) {
    throw new Error(`expected a valid interval for ${startIso}..${endIso}`);
  }
  return parsed;
}

describe("staffing capacity interval math", () => {
  it("1. a single normal shift calculates its duration and operating date", () => {
    // 09:00–12:00 America/Chicago (CDT, summer) = 14:00Z–17:00Z.
    const shift = interval("2027-06-07T14:00:00Z", "2027-06-07T17:00:00Z");
    expect(durationMinutes(shift)).toBe(180);
    expect(rawAssignedMinutes([shift])).toBe(180);
    expect(uniqueScheduledMinutes([shift])).toBe(180);
    expect(overlapMinutes([shift])).toBe(0);
    expect(operatingDate(shift.startMs)).toBe("2027-06-07");
  });

  it("2. back-to-back shifts do not overlap: raw equals unique, overlap is zero", () => {
    const a = interval("2027-06-07T14:00:00Z", "2027-06-07T16:00:00Z");
    const b = interval("2027-06-07T16:00:00Z", "2027-06-07T18:00:00Z");
    expect(rawAssignedMinutes([a, b])).toBe(240);
    expect(uniqueScheduledMinutes([a, b])).toBe(240);
    expect(overlapMinutes([a, b])).toBe(0);
    expect(overlapAssignmentCount([a, b])).toBe(0);
  });

  it("3. overlapping shifts produce raw, unique, and overlap minutes correctly", () => {
    // 09:00–12:00 and 11:00–14:00 Chicago -> raw 6h, unique 5h, overlap 1h, both assignments flagged.
    const a = interval("2027-06-07T14:00:00Z", "2027-06-07T17:00:00Z");
    const b = interval("2027-06-07T16:00:00Z", "2027-06-07T19:00:00Z");
    expect(rawAssignedMinutes([a, b])).toBe(360);
    expect(uniqueScheduledMinutes([a, b])).toBe(300);
    expect(overlapMinutes([a, b])).toBe(60);
    expect(overlapAssignmentCount([a, b])).toBe(2);
  });

  it("3b. a fully-contained shift counts once and flags both assignments", () => {
    const outer = interval("2027-06-07T14:00:00Z", "2027-06-07T20:00:00Z"); // 6h
    const inner = interval("2027-06-07T15:00:00Z", "2027-06-07T16:00:00Z"); // 1h inside
    expect(rawAssignedMinutes([outer, inner])).toBe(420);
    expect(uniqueScheduledMinutes([outer, inner])).toBe(360);
    expect(overlapMinutes([outer, inner])).toBe(60);
    expect(overlapAssignmentCount([outer, inner])).toBe(2);
  });

  it("3c. a non-overlapping third shift is not flagged while the overlapping pair is", () => {
    const a = interval("2027-06-07T14:00:00Z", "2027-06-07T17:00:00Z");
    const b = interval("2027-06-07T16:00:00Z", "2027-06-07T19:00:00Z");
    const c = interval("2027-06-07T20:00:00Z", "2027-06-07T21:00:00Z");
    expect(overlapAssignmentCount([a, b, c])).toBe(2);
    expect(mergeIntervals([a, b, c])).toHaveLength(2);
  });

  it("4. a cross-midnight assignment splits into the correct operating dates", () => {
    // 22:00 Chicago to 02:00 next day = 03:00Z–07:00Z. 2h on day 1, 2h on day 2.
    const overnight = interval("2027-06-08T03:00:00Z", "2027-06-08T07:00:00Z");
    const split = splitMinutesByOperatingDate(overnight);
    expect(split.get("2027-06-07")).toBe(120);
    expect(split.get("2027-06-08")).toBe(120);
    expect([...split.values()].reduce((sum, value) => sum + value, 0)).toBe(durationMinutes(overnight));
  });

  it("5. America/Chicago spring-forward day is 23 hours (the skipped hour is never invented)", () => {
    // DST begins 2027-03-14 02:00. Local midnight->midnight = 06:00Z (Mar 14 CST) to 05:00Z (Mar 15 CDT).
    const fullDay = interval("2027-03-14T06:00:00Z", "2027-03-15T05:00:00Z");
    const split = splitMinutesByOperatingDate(fullDay);
    expect(split.get("2027-03-14")).toBe(23 * 60);
    expect(split.size).toBe(1);
  });

  it("6. America/Chicago fall-back day is 25 hours (the repeated hour is counted once of real time)", () => {
    // DST ends 2027-11-07 02:00. Local midnight->midnight = 05:00Z (Nov 7 CDT) to 06:00Z (Nov 8 CST).
    const fullDay = interval("2027-11-07T05:00:00Z", "2027-11-08T06:00:00Z");
    const split = splitMinutesByOperatingDate(fullDay);
    expect(split.get("2027-11-07")).toBe(25 * 60);
    expect(split.size).toBe(1);
  });

  it("5b. a shift across the spring-forward gap counts only real elapsed minutes", () => {
    // 01:00 CST (07:00Z) to 04:00 CDT (08:00Z): wall clock looks like 3h but only 2h elapsed.
    const acrossGap = interval("2027-03-14T07:00:00Z", "2027-03-14T08:00:00Z");
    expect(durationMinutes(acrossGap)).toBe(60);
  });

  it("7. week starts on Monday and Sunday belongs to that same Monday-anchored week", () => {
    // 2027-06-07 is a Monday.
    expect(weekStartDate("2027-06-07")).toBe("2027-06-07"); // Monday -> itself
    expect(weekStartDate("2027-06-09")).toBe("2027-06-07"); // Wednesday -> Monday
    expect(weekStartDate("2027-06-13")).toBe("2027-06-07"); // Sunday -> the prior Monday
    expect(weekStartDate("2027-06-14")).toBe("2027-06-14"); // next Monday rolls to a new week
    expect(addOperatingDays(weekStartDate("2027-06-13"), 6)).toBe("2027-06-13"); // week end = Sunday
  });

  it("8. a missing or invalid end time produces no interval and never invents hours", () => {
    expect(parseCapacityInterval("2027-06-07T14:00:00Z", null)).toBeNull();
    expect(parseCapacityInterval(null, "2027-06-07T17:00:00Z")).toBeNull();
    expect(parseCapacityInterval("not-a-date", "2027-06-07T17:00:00Z")).toBeNull();
    expect(parseCapacityInterval("2027-06-07T17:00:00Z", "2027-06-07T14:00:00Z")).toBeNull(); // end before start
    expect(parseCapacityInterval("2027-06-07T14:00:00Z", "2027-06-07T14:00:00Z")).toBeNull(); // zero length
    // An employee whose only shift is incomplete contributes zero minutes.
    expect(rawAssignedMinutes([])).toBe(0);
    expect(uniqueScheduledMinutes([])).toBe(0);
  });

  it("9. multi-day enumeration and addOperatingDays are pure calendar arithmetic across a month edge", () => {
    expect(addOperatingDays("2027-06-30", 1)).toBe("2027-07-01");
    expect(addOperatingDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addOperatingDays("2027-03-15", -1)).toBe("2027-03-14"); // across the DST date, calendar-stable
  });
});
