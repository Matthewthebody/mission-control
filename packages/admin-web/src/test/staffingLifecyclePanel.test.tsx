// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaffingPlanLifecycleRecipientView, StaffingPlanLifecycleView } from "../types";

const resendMock = vi.fn();
vi.mock("../services/scheduleStaffing", () => ({
  resendStaffingReminder: (...args: unknown[]) => resendMock(...args)
}));

import { StaffingLifecyclePanel } from "../components/StaffingLifecyclePanel";

afterEach(() => {
  cleanup();
  resendMock.mockReset();
});

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
    last_reminder_at: null,
    reminder_count: 0,
    next_reminder_allowed_at: null,
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

  it("offers Resend Reminder for a pending recipient and reports the cooldown result", async () => {
    resendMock.mockResolvedValue({
      status: "queued",
      recipient_id: "r1",
      recipient_state: "pending",
      reminder_count: 1,
      last_reminder_at: "2026-05-01T10:00:00.000Z",
      next_reminder_allowed_at: "2026-05-01T11:00:00.000Z",
      cooldown_minutes: 60
    });
    render(
      <StaffingLifecyclePanel
        lifecycle={view({ recipients: [recipient({ employee_user_id: "e1", recipient_id: "r1", response_status: "pending" })] })}
        token="t"
        shootId="shoot-1"
        canManage
      />
    );
    const button = screen.getByTestId("remind-e1");
    fireEvent.click(button);
    expect(await screen.findByText(/Reminder queued/)).toBeInTheDocument();
    expect(resendMock).toHaveBeenCalledWith("t", "shoot-1", "r1");
  });

  it("hides Resend Reminder for non-pending recipients and without manage permission", () => {
    const { rerender } = render(
      <StaffingLifecyclePanel
        lifecycle={view({ recipients: [recipient({ employee_user_id: "e2", response_status: "acknowledged" })] })}
        token="t"
        shootId="shoot-1"
        canManage
      />
    );
    expect(screen.queryByTestId("remind-e2")).not.toBeInTheDocument();

    rerender(
      <StaffingLifecyclePanel
        lifecycle={view({ recipients: [recipient({ employee_user_id: "e1", response_status: "pending" })] })}
        token="t"
        shootId="shoot-1"
        canManage={false}
      />
    );
    expect(screen.queryByTestId("remind-e1")).not.toBeInTheDocument();
  });
});
