// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeStaffingAssignment } from "../services/employeeStaffing";

const fetchMock = vi.fn();
const ackMock = vi.fn();
const declineMock = vi.fn();

vi.mock("../services/employeeStaffing", () => ({
  fetchEmployeeStaffingAssignments: (...args: unknown[]) => fetchMock(...args),
  acknowledgeEmployeeStaffingAssignment: (...args: unknown[]) => ackMock(...args),
  declineEmployeeStaffingAssignment: (...args: unknown[]) => declineMock(...args)
}));

import { EmployeeStaffingConfirmations } from "../components/EmployeeStaffingConfirmations";

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  ackMock.mockReset();
  declineMock.mockReset();
});

function assignment(overrides: Partial<EmployeeStaffingAssignment>): EmployeeStaffingAssignment {
  return {
    recipient_id: "r1",
    shoot_id: "s1",
    shoot_code: "S1",
    shoot_title: "Wayzata Picture Day",
    organization_name: "Wayzata HS",
    version: 1,
    shoot_date: "2026-05-01",
    arrival_time: "2026-05-01T14:45:00.000Z",
    start_time: "2026-05-01T15:00:00.000Z",
    end_time_est: "2026-05-01T17:00:00.000Z",
    location_name: "Wayzata HS",
    location_address: null,
    assignments: [{ staffing_role: "lead_photographer", satisfies_lead_coverage: true }],
    lead_coverage: true,
    response_status: "pending",
    acknowledgment_state: "awaiting",
    acknowledgment_due_at: "2026-05-01T12:00:00.000Z",
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

describe("EmployeeStaffingConfirmations", () => {
  it("renders nothing when there are no assignments to confirm", async () => {
    fetchMock.mockResolvedValue({ assignments: [] });
    render(<EmployeeStaffingConfirmations token="t" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("employee-staffing-confirmations")).not.toBeInTheDocument()
    );
  });

  it("focuses and highlights the package linked from a publication notification", async () => {
    fetchMock.mockResolvedValue({
      assignments: [
        assignment({ recipient_id: "rA", shoot_id: "shootA", shoot_title: "Alpha Day" }),
        assignment({ recipient_id: "rB", shoot_id: "shootB", shoot_title: "Beta Day" })
      ]
    });
    render(<EmployeeStaffingConfirmations token="t" focusShootId="shootB" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('[data-shoot-id="shootB"]')).toHaveClass("notification-card--focus"));
    expect(document.querySelector('[data-shoot-id="shootA"]')).not.toHaveClass("notification-card--focus");
  });

  it("renders a pending package and acknowledges by merging the response (no reload)", async () => {
    fetchMock.mockResolvedValue({ assignments: [assignment({})] });
    ackMock.mockResolvedValue({
      assignment: assignment({
        response_status: "acknowledged",
        acknowledgment_state: "acknowledged",
        can_acknowledge: false,
        can_decline: true
      })
    });
    render(<EmployeeStaffingConfirmations token="t" />);

    expect(await screen.findByText("Wayzata Picture Day")).toBeInTheDocument();
    // Compact copy: an outstanding confirmation IS its deadline — one line, no
    // separate "Awaiting acknowledgment" + "Confirm by" pair.
    expect(screen.getByTestId("assignment-status-r1")).toHaveTextContent(/Confirm by/);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(screen.getByTestId("assignment-status-r1")).toHaveTextContent("Acknowledged"));
    expect(ackMock).toHaveBeenCalledWith("t", "r1");
    expect(fetchMock).toHaveBeenCalledTimes(1); // merged authoritative response, no reload
  });

  it("requires a reason in the decline dialog, then submits and merges", async () => {
    fetchMock.mockResolvedValue({ assignments: [assignment({})] });
    declineMock.mockResolvedValue({
      assignment: assignment({
        response_status: "declined",
        acknowledgment_state: "declined",
        can_acknowledge: false,
        can_decline: false,
        decline_reason: "Double-booked"
      })
    });
    render(<EmployeeStaffingConfirmations token="t" />);

    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    const dialog = screen.getByTestId("decline-dialog");
    expect(dialog).toBeInTheDocument();
    // honest copy — no "removed from schedule" / channel claim
    expect(dialog).toHaveTextContent("not removed from the schedule until they confirm");
    expect(document.activeElement).toBe(screen.getByTestId("decline-reason")); // focus moved to the reason field

    // empty reason -> validation error, no API call
    fireEvent.click(screen.getByRole("button", { name: "Submit decline" }));
    expect(screen.getByText("A reason is required.")).toBeInTheDocument();
    expect(declineMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("decline-reason"), { target: { value: "Double-booked" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit decline" }));
    await waitFor(() => expect(screen.getByTestId("assignment-status-r1")).toHaveTextContent("Declined"));
    expect(declineMock).toHaveBeenCalledWith("t", "r1", "Double-booked");
    expect(screen.queryByTestId("decline-dialog")).not.toBeInTheDocument();
  });

  it("renders distinct timing + renewed-ack + carried-forward labels and an error state", async () => {
    fetchMock.mockResolvedValue({
      assignments: [
        assignment({ recipient_id: "a", shoot_id: "sa", acknowledgment_state: "needs_attention" }),
        assignment({ recipient_id: "b", shoot_id: "sb", acknowledgment_state: "overdue" }),
        assignment({ recipient_id: "c", shoot_id: "sc", requires_renewed_acknowledgment: true }),
        assignment({
          recipient_id: "d",
          shoot_id: "sd",
          response_status: "acknowledged",
          acknowledgment_state: "acknowledged",
          carried_forward: true,
          can_acknowledge: false
        })
      ]
    });
    render(<EmployeeStaffingConfirmations token="t" />);
    expect(await screen.findByTestId("assignment-status-a")).toHaveTextContent("Confirmation needs attention");
    expect(screen.getByTestId("assignment-status-b")).toHaveTextContent("Confirmation overdue");
    expect(screen.getByTestId("assignment-status-c")).toHaveTextContent(
      "Assignment changed — review and acknowledge again"
    );
    expect(screen.getByTestId("assignment-status-d")).toHaveTextContent("Acknowledgment carried forward");
  });

  it("surfaces a stale/conflict error and re-syncs on a failed acknowledge", async () => {
    fetchMock.mockResolvedValueOnce({ assignments: [assignment({})] });
    ackMock.mockRejectedValueOnce(new Error("This assignment is no longer current."));
    fetchMock.mockResolvedValueOnce({
      assignments: [assignment({ acknowledgment_state: "awaiting", version: 2 })]
    });
    render(<EmployeeStaffingConfirmations token="t" />);

    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(screen.getByText("This assignment is no longer current.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2); // re-synced after the conflict
  });
});
