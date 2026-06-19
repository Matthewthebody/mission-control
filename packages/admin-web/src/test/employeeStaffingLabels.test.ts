import { describe, expect, it } from "vitest";
import type { EmployeeStaffingAssignment } from "../services/employeeStaffing";
import {
  assignmentRoleSummary,
  assignmentStatusLabel,
  assignmentStatusTone,
  isOutstandingConfirmation
} from "../pages/employeeStaffingLabels";

function assignment(overrides: Partial<EmployeeStaffingAssignment>): EmployeeStaffingAssignment {
  return {
    recipient_id: "r1",
    shoot_id: "s1",
    shoot_code: "S1",
    shoot_title: "Wayzata Picture Day",
    organization_name: "Wayzata HS",
    version: 1,
    shoot_date: "2026-05-01",
    arrival_time: null,
    start_time: null,
    end_time_est: null,
    location_name: "Wayzata HS",
    location_address: null,
    assignments: [{ staffing_role: "lead_photographer", satisfies_lead_coverage: true }],
    lead_coverage: true,
    response_status: "pending",
    acknowledgment_state: "awaiting",
    acknowledgment_due_at: null,
    responded_at: null,
    decline_reason: null,
    carried_forward: false,
    requires_renewed_acknowledgment: false,
    can_acknowledge: true,
    can_decline: true,
    schedule_link: "#my-work?focus_shoot=s1",
    ...overrides
  };
}

describe("employee staffing labels", () => {
  it("maps each state to the required employee copy", () => {
    expect(assignmentStatusLabel(assignment({ acknowledgment_state: "awaiting" }))).toBe("Awaiting acknowledgment");
    expect(assignmentStatusLabel(assignment({ acknowledgment_state: "needs_attention" }))).toBe(
      "Confirmation needs attention"
    );
    expect(assignmentStatusLabel(assignment({ acknowledgment_state: "overdue" }))).toBe("Confirmation overdue");
    expect(
      assignmentStatusLabel(assignment({ response_status: "acknowledged", acknowledgment_state: "acknowledged" }))
    ).toBe("Acknowledged");
    expect(
      assignmentStatusLabel(
        assignment({ response_status: "acknowledged", acknowledgment_state: "acknowledged", carried_forward: true })
      )
    ).toBe("Acknowledgment carried forward");
    expect(assignmentStatusLabel(assignment({ response_status: "declined", acknowledgment_state: "declined" }))).toBe(
      "Declined"
    );
    expect(
      assignmentStatusLabel(assignment({ acknowledgment_state: "awaiting", requires_renewed_acknowledgment: true }))
    ).toBe("Assignment changed — review and acknowledge again");
    expect(assignmentStatusLabel(assignment({ acknowledgment_state: "canceled" }))).toBe(
      "This assignment is no longer current"
    );
  });

  it("tone escalates for overdue / declined / needs-attention", () => {
    expect(assignmentStatusTone(assignment({ acknowledgment_state: "awaiting" }))).toBe("normal");
    expect(assignmentStatusTone(assignment({ acknowledgment_state: "needs_attention" }))).toBe("high");
    expect(assignmentStatusTone(assignment({ acknowledgment_state: "overdue" }))).toBe("urgent");
    expect(assignmentStatusTone(assignment({ response_status: "declined", acknowledgment_state: "declined" }))).toBe(
      "urgent"
    );
  });

  it("outstanding = still actionable; role summary marks the lead", () => {
    expect(isOutstandingConfirmation(assignment({ can_acknowledge: true }))).toBe(true);
    expect(isOutstandingConfirmation(assignment({ can_acknowledge: false }))).toBe(false);
    expect(assignmentRoleSummary(assignment({ lead_coverage: true }))).toBe("lead_photographer (Lead)");
    expect(
      assignmentRoleSummary(assignment({ lead_coverage: false, assignments: [{ staffing_role: "photographer" }] }))
    ).toBe("photographer");
  });
});
