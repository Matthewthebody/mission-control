// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StaffingLifecyclePanel } from "../components/StaffingLifecyclePanel";
import type { StaffingPlanLifecycleRecipientView, StaffingPlanLifecycleView } from "../types";

afterEach(cleanup);

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

describe("StaffingLifecyclePanel", () => {
  it("renders coverage, version, republish, a declined lead with reason, and an acknowledged peer", () => {
    render(
      <StaffingLifecyclePanel
        lifecycle={view({
          republish_required: true,
          draft_comparison: "draft_changes_exist",
          declined_staff_count: 1,
          coverage_eligible_staff_count: 2,
          operational_readiness_status: "at_risk",
          recipients: [
            recipient({
              employee_name: "Sarah",
              response_status: "declined",
              lead_coverage: true,
              decline_reason: "Double-booked"
            }),
            recipient({
              recipient_id: "r2",
              employee_user_id: "e2",
              employee_name: "Alex",
              response_status: "acknowledged",
              lead_coverage: false
            })
          ]
        })}
      />
    );

    expect(screen.getByTestId("lifecycle-coverage")).toHaveTextContent("2 of 3 positions covered");
    expect(screen.getByTestId("lifecycle-version")).toHaveTextContent("Published version 2");
    expect(screen.getByTestId("lifecycle-republish")).toBeInTheDocument();
    expect(screen.getByText("Declined — Replacement Required")).toBeInTheDocument();
    expect(screen.getByText("Lead: Sarah — Declined; replacement required")).toBeInTheDocument();
    expect(screen.getByText("Reason: Double-booked")).toBeInTheDocument();
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    // Honest notification copy — no individual-delivery claim.
    expect(screen.getByTestId("lifecycle-notification")).toHaveTextContent(
      "notification queued through the current staffing notification flow"
    );
  });

  it("renders an honest draft-only state when nothing is published", () => {
    render(
      <StaffingLifecyclePanel
        lifecycle={view({
          has_published_version: false,
          latest_version: null,
          draft_comparison: "no_published_plan",
          published_recipient_count: 0,
          acknowledged_staff_count: 0,
          operational_readiness_status: "at_risk",
          recipients: [
            recipient({ response_status: "draft", draft_change: "newly_added", employee_name: "Sarah" })
          ]
        })}
      />
    );

    expect(screen.getByTestId("lifecycle-version")).toHaveTextContent("No published version");
    expect(screen.getByTestId("lifecycle-draft")).toHaveTextContent("Assigned Draft — not yet published");
    expect(screen.getByText("Assigned Draft")).toBeInTheDocument();
    expect(screen.getByTestId("lifecycle-notification")).toHaveTextContent("Not published");
  });
});
