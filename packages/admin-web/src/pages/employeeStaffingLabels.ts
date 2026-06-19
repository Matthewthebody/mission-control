import type { EmployeeStaffingAssignment } from "../services/employeeStaffing";

// Pure employee-facing labels for staffing confirmations. Honest copy: a decline flags the shoot for
// staffing leadership (who see it on the staffing board / readiness immediately) — it never claims a
// message was sent, a channel was used, or that the employee was removed from the schedule.

export function assignmentStatusLabel(assignment: EmployeeStaffingAssignment): string {
  switch (assignment.acknowledgment_state) {
    case "awaiting":
      return assignment.requires_renewed_acknowledgment
        ? "Assignment changed — review and acknowledge again"
        : "Awaiting acknowledgment";
    case "needs_attention":
      return "Confirmation needs attention";
    case "overdue":
      return "Confirmation overdue";
    case "acknowledged":
      return assignment.carried_forward ? "Acknowledgment carried forward" : "Acknowledged";
    case "declined":
      return "Declined";
    case "canceled":
      return "This assignment is no longer current";
    default:
      return assignment.response_status;
  }
}

export function assignmentStatusTone(assignment: EmployeeStaffingAssignment): "urgent" | "high" | "normal" {
  if (assignment.acknowledgment_state === "overdue" || assignment.acknowledgment_state === "declined") {
    return "urgent";
  }
  if (assignment.acknowledgment_state === "needs_attention" || assignment.requires_renewed_acknowledgment) {
    return "high";
  }
  return "normal";
}

/** Outstanding = still needs the employee's confirmation (sorted to the top). */
export function isOutstandingConfirmation(assignment: EmployeeStaffingAssignment): boolean {
  return assignment.can_acknowledge;
}

export function assignmentRoleSummary(assignment: EmployeeStaffingAssignment): string {
  const roles = assignment.assignments
    .map((entry) => entry.staffing_role)
    .filter((role): role is string => Boolean(role));
  const unique = [...new Set(roles)];
  const base = unique.length ? unique.join(", ") : "Assignment";
  return assignment.lead_coverage ? `${base} (Lead)` : base;
}
