import { describe, expect, it } from "vitest";
import {
  buildOperationsControlRoomSummaryBand,
  buildOperationsRecentActivity
} from "../src/services/operationsControlRoom.js";

describe("operations control room helpers", () => {
  it("aggregates watch, staffing, attendance, live shoot, and exception pressure into the summary band", () => {
    const summaryBand = buildOperationsControlRoomSummaryBand({
      urgentWatch: {
        summary: {
          active_count: 4,
          red_count: 2,
          yellow_count: 2,
          overdue_count: 2,
          snoozed_count: 0
        },
        items: [
          { status: "active", watch_type: "critical_role_gap" },
          { status: "active", watch_type: "unconfirmed_shoot" },
          { status: "active", watch_type: "missing_contact_info" },
          { status: "handled", watch_type: "missing_contact_info" }
        ]
      } as any,
      staffing: {
        summary: {
          open_staffing_slots: 5,
          shoots_missing_lead: 1,
          understaffed_shoots: 2,
          conflict_warnings: 1
        }
      } as any,
      attendance: {
        summary: {
          late_count: 1,
          unresolved_count: 2,
          replacement_needed_count: 1,
          no_show_count: 1,
          coverage_impact_count: 2
        }
      } as any,
      liveQueue: {
        summary: {
          needs_staffing: 2,
          needs_review: 3,
          unscheduled: 1
        }
      } as any,
      approvals: {
        summary: {
          pending_blocking: 2,
          needs_clarification: 1,
          overdue: 1
        }
      } as any
    });

    expect(summaryBand.map((item) => ({ id: item.id, count: item.count }))).toEqual([
      { id: "active_red_watch", count: 2 },
      { id: "yellow_watch", count: 2 },
      { id: "staffing_gaps", count: 5 },
      { id: "attendance_risk", count: 5 },
      { id: "live_shoot_pressure", count: 6 },
      { id: "unresolved_exceptions", count: 4 }
    ]);
    expect(summaryBand.find((item) => item.id === "staffing_gaps")?.detail).toContain("1 missing lead, 1 unconfirmed, 1 contact risk.");
  });

  it("filters recent activity toward operations-owned modules and maps them back to owner workspaces", () => {
    const items = buildOperationsRecentActivity([
      {
        id: "history-watch",
        module: "watch",
        summary: "Exception item reopened.",
        actor_name: "Manager Demo",
        created_at: "2026-03-31T12:00:00.000Z"
      },
      {
        id: "history-production",
        module: "production",
        summary: "Production task completed.",
        actor_name: "Artist Demo",
        created_at: "2026-03-31T11:55:00.000Z"
      },
      {
        id: "history-attendance",
        module: "attendance",
        summary: "Late arrival acknowledged.",
        actor_name: null,
        created_at: "2026-03-31T11:50:00.000Z"
      }
    ] as any);

    expect(items).toEqual([
      {
        id: "history-watch",
        module_label: "Exceptions",
        summary: "Exception item reopened.",
        actor_label: "Manager Demo",
        created_at: "2026-03-31T12:00:00.000Z",
        action_hash: "#operations/exceptions"
      },
      {
        id: "history-attendance",
        module_label: "Attendance",
        summary: "Late arrival acknowledged.",
        actor_label: "System",
        created_at: "2026-03-31T11:50:00.000Z",
        action_hash: "#operations/attendance"
      }
    ]);
  });
});
