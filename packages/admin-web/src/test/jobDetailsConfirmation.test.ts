import { describe, expect, it } from "vitest";
import {
  buildDetailsConfirmationFromProjectWork,
  buildDetailsConfirmationFromScheduleShoot,
  detailsConfirmationChipLabel,
  type DetailsConfirmationRecord
} from "../jobDetailsConfirmation";
import type { UnifiedScheduleShootItem } from "../types";

describe("job details confirmation readiness", () => {
  const referenceDate = new Date("2026-06-10T12:00:00Z");

  it("marks booked jobs with missing core details as needing details", () => {
    const cue = buildDetailsConfirmationFromProjectWork(
      {
        shootDate: "2026-09-15",
        departmentType: "schools",
        jobCategory: "school_picture_day",
        missingFields: ["Roster", "Main contact", "Location"]
      },
      referenceDate
    );

    expect(cue.state).toBe("needs_details");
    expect(detailsConfirmationChipLabel(cue)).toBe("Needs details");
    expect(cue.missingLabels).toContain("Roster");
  });

  it("marks jobs with some details but remaining gaps as partial", () => {
    const cue = buildDetailsConfirmationFromProjectWork(
      {
        shootDate: "2026-09-15",
        organizationName: "Wayzata Public Schools",
        ownerName: "Jessica",
        departmentType: "schools",
        jobCategory: "school_picture_day",
        missingFields: ["Call time"]
      },
      referenceDate
    );

    expect(cue.state).toBe("partial");
    expect(cue.label).toBe("Partial");
  });

  it("marks mostly complete near-term jobs as due for confirmation", () => {
    const cue = buildDetailsConfirmationFromProjectWork(
      {
        shootDate: "2026-06-25",
        organizationName: "Tonka United",
        ownerName: "Josh",
        departmentType: "sports",
        jobCategory: "sports_picture_day"
      },
      referenceDate
    );

    expect(cue.state).toBe("confirmation_due");
    expect(cue.label).toBe("Confirm");
    expect(cue.confirmationDueDate).toBe("2026-06-04");
    expect(cue.finalDueDate).toBe("2026-06-18");
  });

  it("records confirmed details and flags later changes for reconfirmation", () => {
    const confirmed: DetailsConfirmationRecord = {
      confirmedAt: "2026-06-10T14:00:00.000Z",
      confirmedByName: "Jessica"
    };

    const confirmedCue = buildDetailsConfirmationFromProjectWork(
      {
        shootDate: "2026-06-25",
        organizationName: "Wayzata Public Schools",
        ownerName: "Jessica",
        departmentType: "schools",
        jobCategory: "school_picture_day",
        confirmed
      },
      referenceDate
    );

    expect(confirmedCue.state).toBe("confirmed");
    expect(confirmedCue.summary).toContain("Details confirmed by Jessica");

    const reconfirmCue = buildDetailsConfirmationFromProjectWork(
      {
        shootDate: "2026-06-25",
        organizationName: "Wayzata Public Schools",
        ownerName: "Jessica",
        departmentType: "schools",
        jobCategory: "school_picture_day",
        updatedAt: "2026-06-10T14:05:00.000Z",
        missingFields: [],
        confirmed
      },
      referenceDate
    );

    expect(reconfirmCue.state).toBe("reconfirm");
    expect(reconfirmCue.label).toBe("Reconfirm");
  });

  it("adds text readiness labels to schedule shoot cards without relying on color only", () => {
    const shoot = {
      id: "shoot-1",
      item_kind: "shoot",
      date_key: "2026-06-25",
      title: "Wayzata High School",
      department: "schools",
      starts_at: "2026-06-25T14:00:00Z",
      ends_at: "2026-06-25T18:00:00Z",
      start_time: "09:00",
      end_time_est: "13:00",
      location_name: "Wayzata High School",
      lead_name: "Carisa",
      planned_staff_count: 2,
      assigned_staff_count: 2,
      missing_fields: [],
      staffing_health_state: "ready",
      staffing_state: "ready_confirmed",
      status: "ready_to_execute",
      operations_priority: "normal",
      special_equipment: "Standard yearbook setup"
    } as unknown as UnifiedScheduleShootItem;

    const cue = buildDetailsConfirmationFromScheduleShoot(shoot, referenceDate);

    expect(cue.state).toBe("confirmed");
    expect(detailsConfirmationChipLabel(cue)).toBe("Confirmed");
  });
});
