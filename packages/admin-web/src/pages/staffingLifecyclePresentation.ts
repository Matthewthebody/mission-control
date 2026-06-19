import type { StaffingPlanLifecycleRecipientView, StaffingPlanLifecycleView } from "../types";

// Pure manager-facing presentation for the staffing-plan lifecycle. No data fetching — derives the
// approved labels from the canonical read model so the Staff Assignment drawer stays a thin renderer
// and the logic is unit-tested. Honest about notifications: the legacy aggregate is the only delivery,
// so we never claim an individual was notified, a channel, a successful delivery, or a read receipt.

export function publishedVersionLabel(view: StaffingPlanLifecycleView): string {
  return view.has_published_version ? `Published version ${view.latest_version}` : "No published version";
}

export function draftComparisonLabel(view: StaffingPlanLifecycleView): string {
  if (view.draft_comparison === "no_published_plan") {
    return "Assigned Draft — not yet published";
  }
  if (view.republish_required) {
    return `Draft Changes — Republish Required (since version ${view.latest_version})`;
  }
  return `Up to date with version ${view.latest_version}`;
}

export function operationalReadinessLabel(view: StaffingPlanLifecycleView): string {
  switch (view.operational_readiness_status) {
    case "ready":
      return "Operationally Ready";
    case "awaiting_acknowledgment":
      return "Coverage Complete — Confirmation Pending";
    case "confirmation_overdue":
      return "Coverage Complete — Confirmation Overdue";
    case "at_risk":
    default:
      return view.declined_staff_count > 0 ? "At Risk — Replacement Required" : "At Risk — Coverage Incomplete";
  }
}

export function coverageSummaryLabel(view: StaffingPlanLifecycleView): string {
  return `${view.coverage_eligible_staff_count} of ${view.planned_staff_count} positions covered`;
}

export function acknowledgmentSummaryLabel(view: StaffingPlanLifecycleView): string {
  return `${view.acknowledged_staff_count} of ${view.published_recipient_count} employees acknowledged`;
}

export function recipientStatusLabel(recipient: StaffingPlanLifecycleRecipientView): string {
  if (recipient.draft_change === "newly_added" || recipient.response_status === "draft") {
    return "Assigned Draft";
  }
  if (recipient.response_status === "declined") {
    return "Declined — Replacement Required";
  }
  if (recipient.draft_change === "removed") {
    return "Removed in Draft";
  }
  if (recipient.draft_change === "changed") {
    return "Draft Changes — Republish Required";
  }
  if (recipient.response_status === "acknowledged") {
    return recipient.carried_forward_from_recipient_id ? "Acknowledgment Carried Forward" : "Acknowledged";
  }
  if (recipient.response_status === "pending") {
    return recipient.overdue ? "Published — Acknowledgment Overdue" : "Published — Awaiting Acknowledgment";
  }
  return recipient.response_status;
}

export function recipientLeadLabel(recipient: StaffingPlanLifecycleRecipientView): string | null {
  if (!recipient.lead_coverage) {
    return null;
  }
  const name = recipient.employee_name ?? "Lead";
  if (recipient.response_status === "declined") {
    return `Lead: ${name} — Declined; replacement required`;
  }
  if (recipient.response_status === "acknowledged") {
    return `Lead: ${name} — Acknowledged`;
  }
  if (recipient.response_status === "pending") {
    return recipient.overdue ? `Lead: ${name} — Confirmation overdue` : `Lead: ${name} — Awaiting acknowledgment`;
  }
  if (recipient.draft_change === "newly_added" || recipient.response_status === "draft") {
    return `Lead: ${name} — Assigned (draft)`;
  }
  return `Lead: ${name}`;
}

export function recipientCarryForwardLabel(recipient: StaffingPlanLifecycleRecipientView): string | null {
  if (recipient.requires_renewed_acknowledgment) {
    return "Republishing will require renewed acknowledgment";
  }
  if (recipient.can_carry_forward) {
    return "Acknowledgment can carry forward";
  }
  return null;
}

// Honest notification copy — never claims individual delivery, channel, success, or a read receipt.
export function notificationStatusLabel(view: StaffingPlanLifecycleView): string {
  if (!view.has_published_version) {
    return "Not published";
  }
  return "Published — notification queued through the current staffing notification flow";
}
