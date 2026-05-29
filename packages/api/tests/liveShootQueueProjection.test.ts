import { describe, expect, it } from "vitest";
import {
  buildLiveShootQueueEntry,
  buildLiveShootQueueProjection,
  classifyLiveShootQueueBucket,
  type LiveShootQueueSource
} from "../src/domain/lifecycle/live-shoot-queue-projection.js";

function createShootFixture(overrides: Partial<LiveShootQueueSource> = {}): LiveShootQueueSource {
  return {
    id: "shoot-1",
    title: "Friday Night Lights Media Day",
    department: "sports",
    shoot_date: "2026-03-28",
    arrival_time: "2026-03-28T14:00:00.000Z",
    start_time: "2026-03-28T15:00:00.000Z",
    end_time_est: "2026-03-28T18:00:00.000Z",
    location_name: "North Metro Stadium",
    location_address: "2500 Stadium Drive, Plymouth, MN",
    organization_display_name: "North Metro Athletics",
    primary_contact_name: "Coach Riley Hart",
    lead_name: "Avery Stone",
    status: "SCHEDULED",
    publish_state: "published",
    staffing_state: "staffed",
    missing_lead: false,
    under_staffed: false,
    big_shoot: false,
    planned_staff_count: 3,
    scheduled_employee_count: 3,
    open_attendance_exception_count: 0,
    conflict_warning_count: 0,
    schedule_sync_state: "linked",
    schedule_sync_required: false,
    future_profitability_flag: null,
    future_profitability_display: null,
    integration: {
      link_state: "linked",
      sync_required: false,
      manual_review_required: false,
      last_sync_error: null
    },
    ...overrides
  };
}

describe("live shoot queue projection", () => {
  it("classifies staffing blockers ahead of other buckets and recommends the right next action", () => {
    const entry = buildLiveShootQueueEntry(
      createShootFixture({
        missing_lead: true,
        scheduled_employee_count: 1,
        planned_staff_count: 3
      })
    );

    expect(entry.bucket).toBe("needs_staffing");
    expect(entry.next_action).toBe("Assign lead coverage");
    expect(entry.staffing_summary.gap_count).toBe(2);
    expect(entry.key_flags.map((flag) => flag.code)).toEqual(expect.arrayContaining(["lead_missing", "staffing_gap"]));
  });

  it("classifies review work from backend signals instead of relying on client interpretation", () => {
    const entry = buildLiveShootQueueEntry(
      createShootFixture({
        open_attendance_exception_count: 2,
        integration: {
          link_state: "linked",
          sync_required: false,
          manual_review_required: true,
          last_sync_error: null
        }
      })
    );

    expect(entry.bucket).toBe("needs_review");
    expect(entry.next_action).toBe("Resolve sync and readiness review");
    expect(entry.sync_summary.manual_review_required).toBe(true);
  });

  it("treats incomplete timing as unscheduled and completed statuses as historical", () => {
    expect(
      classifyLiveShootQueueBucket(
        createShootFixture({
          id: "shoot-unscheduled",
          arrival_time: null,
          start_time: null,
          end_time_est: "2026-03-28T23:00:00.000Z",
          status: "PLANNING"
        })
      )
    ).toBe("unscheduled");

    expect(
      classifyLiveShootQueueBucket(
        createShootFixture({
          id: "shoot-complete",
          status: "SHOOT_COMPLETE"
        })
      )
    ).toBe("completed");
  });

  it("builds a stable sectioned projection with backend-controlled ordering", () => {
    const projection = buildLiveShootQueueProjection([
      createShootFixture({ id: "shoot-scheduled", title: "Scheduled Shoot" }),
      createShootFixture({
        id: "shoot-review",
        title: "Review Shoot",
        open_attendance_exception_count: 1,
        arrival_time: "2026-03-28T13:00:00.000Z"
      }),
      createShootFixture({
        id: "shoot-staffing",
        title: "Staffing Shoot",
        missing_lead: true,
        arrival_time: "2026-03-28T16:00:00.000Z"
      })
    ]);

    expect(projection.sections.map((section) => section.id)).toEqual([
      "needs_staffing",
      "needs_review",
      "unscheduled",
      "scheduled",
      "completed"
    ]);
    expect(projection.sections[0].items[0].shoot.id).toBe("shoot-staffing");
    expect(projection.sections[1].items[0].shoot.id).toBe("shoot-review");
    expect(projection.summary.needs_staffing).toBe(1);
    expect(projection.summary.needs_review).toBe(1);
    expect(projection.summary.scheduled).toBe(1);
  });
});
