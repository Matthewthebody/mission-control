import { describe, expect, it } from "vitest";
import {
  buildMasterScheduleHash,
  buildScheduleWorkspaceHash,
  parseScheduleWorkspaceRouteState
} from "../scheduleWorkspaceRouting";

describe("scheduleWorkspaceRouting", () => {
  it("parses master schedule hashes into the expected view state", () => {
    expect(parseScheduleWorkspaceRouteState("#schedule/jobs?date=2026-04-02")).toEqual({
      area: null,
      view: "jobs",
      date: "2026-04-02",
      shootId: null,
      shiftId: null
    });
    expect(parseScheduleWorkspaceRouteState("#schedule/staffing?date=2026-04-03&shift=shift-1")).toEqual({
      area: null,
      view: "staffing",
      date: "2026-04-03",
      shootId: null,
      shiftId: "shift-1"
    });
    expect(parseScheduleWorkspaceRouteState("#schedule/assignment-board?date=2026-04-04&shoot=shoot-2")).toEqual({
      area: null,
      view: "assignment_board",
      date: "2026-04-04",
      shootId: "shoot-2",
      shiftId: null
    });
  });

  it("builds canonical master schedule hashes for jobs, staffing, and assignment board views", () => {
    expect(buildMasterScheduleHash("jobs", { date: "2026-04-02" })).toBe("#schedule/jobs?date=2026-04-02");
    expect(buildMasterScheduleHash("staffing", { date: "2026-04-03", shiftId: "shift-1" })).toBe(
      "#schedule/staffing?date=2026-04-03&shift=shift-1"
    );
    expect(buildMasterScheduleHash("assignment_board", { date: "2026-04-04", shootId: "shoot-2" })).toBe(
      "#schedule/assignment-board?date=2026-04-04&shoot=shoot-2"
    );
    expect(buildScheduleWorkspaceHash({ date: "2026-04-05" })).toBe("#schedule/jobs?date=2026-04-05");
  });
});
