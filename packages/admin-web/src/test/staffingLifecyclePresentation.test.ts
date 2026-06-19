import { describe, expect, it } from "vitest";
import type { StaffingPlanLifecycleRecipientView, StaffingPlanLifecycleView } from "../types";
import {
  acknowledgmentSummaryLabel,
  coverageSummaryLabel,
  draftComparisonLabel,
  notificationStatusLabel,
  operationalReadinessLabel,
  publishedVersionLabel,
  recipientCarryForwardLabel,
  recipientLeadLabel,
  recipientStatusLabel
} from "../pages/staffingLifecyclePresentation";

function recipient(overrides: Partial<StaffingPlanLifecycleRecipientView>): StaffingPlanLifecycleRecipientView {
  return {
    recipient_id: "r1",
    employee_user_id: "e1",
    employee_name: "Sarah",
    version: 2,
    response_status: "pending",
    acknowledgment_due_at: null,
    responded_at: null,
    decline_reason: null,
    carried_forward_from_recipient_id: null,
    recipient_hash: "h",
    hash_version: 1,
    lead_coverage: true,
    assignments: [],
    coverage_eligible: true,
    overdue: false,
    draft_change: "unchanged",
    requires_renewed_acknowledgment: false,
    can_carry_forward: false,
    ...overrides
  };
}

function view(overrides: Partial<StaffingPlanLifecycleView>): StaffingPlanLifecycleView {
  return {
    has_published_version: true,
    latest_version: 2,
    published_at: "2026-05-01T00:00:00Z",
    published_by_user_id: "u1",
    hash_version: 1,
    snapshot_schema_version: 1,
    has_draft_changes: false,
    republish_required: false,
    draft_comparison: "unchanged_since_publish",
    planned_staff_count: 3,
    required_lead_count: 1,
    assigned_staff_count: 3,
    published_recipient_count: 3,
    coverage_eligible_staff_count: 3,
    pending_acknowledgment_count: 1,
    acknowledged_staff_count: 2,
    declined_staff_count: 0,
    superseded_recipient_count: 0,
    lead_assignment_count: 1,
    coverage_eligible_lead_count: 1,
    acknowledged_lead_count: 1,
    next_acknowledgment_due_at: null,
    overdue_acknowledgment_count: 0,
    needs_acknowledgment_count: 0,
    acknowledgment_risk_state: "awaiting",
    coverage_state: "complete",
    operational_readiness_status: "awaiting_acknowledgment",
    recipients: [],
    ...overrides
  };
}

describe("staffing lifecycle presentation", () => {
  it("recipient status labels follow the approved manager vocabulary", () => {
    expect(recipientStatusLabel(recipient({ response_status: "pending", overdue: false }))).toBe(
      "Published — Awaiting Acknowledgment"
    );
    expect(recipientStatusLabel(recipient({ response_status: "acknowledged" }))).toBe("Acknowledged");
    expect(recipientStatusLabel(recipient({ response_status: "declined" }))).toBe("Declined — Replacement Required");
    expect(recipientStatusLabel(recipient({ response_status: "draft", draft_change: "newly_added" }))).toBe(
      "Assigned Draft"
    );
    expect(
      recipientStatusLabel(recipient({ response_status: "acknowledged", carried_forward_from_recipient_id: "prev" }))
    ).toBe("Acknowledgment Carried Forward");
    expect(recipientStatusLabel(recipient({ response_status: "pending", draft_change: "changed" }))).toBe(
      "Draft Changes — Republish Required"
    );
    expect(recipientStatusLabel(recipient({ response_status: "pending", overdue: true }))).toBe(
      "Published — Acknowledgment Overdue"
    );
  });

  it("lead labels render the required representations", () => {
    expect(recipientLeadLabel(recipient({ response_status: "pending", overdue: false }))).toBe(
      "Lead: Sarah — Awaiting acknowledgment"
    );
    expect(recipientLeadLabel(recipient({ response_status: "acknowledged" }))).toBe("Lead: Sarah — Acknowledged");
    expect(recipientLeadLabel(recipient({ response_status: "declined" }))).toBe(
      "Lead: Sarah — Declined; replacement required"
    );
    expect(recipientLeadLabel(recipient({ lead_coverage: false }))).toBeNull();
  });

  it("carry-forward labels reflect renewed-ack vs carry-forward", () => {
    expect(recipientCarryForwardLabel(recipient({ requires_renewed_acknowledgment: true }))).toBe(
      "Republishing will require renewed acknowledgment"
    );
    expect(recipientCarryForwardLabel(recipient({ can_carry_forward: true }))).toBe(
      "Acknowledgment can carry forward"
    );
    expect(recipientCarryForwardLabel(recipient({}))).toBeNull();
  });

  it("shoot-level labels render version, draft comparison, readiness and summaries", () => {
    expect(publishedVersionLabel(view({}))).toBe("Published version 2");
    expect(publishedVersionLabel(view({ has_published_version: false, latest_version: null }))).toBe(
      "No published version"
    );
    expect(draftComparisonLabel(view({ republish_required: true, draft_comparison: "draft_changes_exist" }))).toBe(
      "Draft Changes — Republish Required (since version 2)"
    );
    expect(
      draftComparisonLabel(view({ has_published_version: false, draft_comparison: "no_published_plan" }))
    ).toBe("Assigned Draft — not yet published");
    expect(operationalReadinessLabel(view({ operational_readiness_status: "ready" }))).toBe("Operationally Ready");
    expect(operationalReadinessLabel(view({ operational_readiness_status: "confirmation_overdue" }))).toBe(
      "Coverage Complete — Confirmation Overdue"
    );
    expect(coverageSummaryLabel(view({ coverage_eligible_staff_count: 2, planned_staff_count: 3 }))).toBe(
      "2 of 3 positions covered"
    );
    expect(acknowledgmentSummaryLabel(view({ acknowledged_staff_count: 2, published_recipient_count: 3 }))).toBe(
      "2 of 3 employees acknowledged"
    );
  });

  it("notification copy is honest (no individual delivery, channel, or read-receipt claim)", () => {
    const label = notificationStatusLabel(view({}));
    expect(label).toContain("notification queued through the current staffing notification flow");
    expect(label.toLowerCase()).not.toContain("delivered");
    expect(label.toLowerCase()).not.toContain("read receipt");
    expect(label.toLowerCase()).not.toContain("individually notified");
  });
});
