// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateChangeRequestPanel } from "../components/schedule/DateChangeRequestPanel";

const mocks = {
  create: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  feasibility: vi.fn(),
  alternative: vi.fn(),
  transition: vi.fn(),
  decide: vi.fn()
};
vi.mock("../services/dateChangeApi", () => ({
  createDateChangeRequest: (...a: unknown[]) => mocks.create(...a),
  listDateChangeRequestsForShoot: (...a: unknown[]) => mocks.list(...a),
  getDateChangeRequest: (...a: unknown[]) => mocks.detail(...a),
  runDateChangeFeasibility: (...a: unknown[]) => mocks.feasibility(...a),
  recordDateChangeAlternative: (...a: unknown[]) => mocks.alternative(...a),
  transitionDateChange: (...a: unknown[]) => mocks.transition(...a),
  decideDateChange: (...a: unknown[]) => mocks.decide(...a)
}));

const REQ = {
  id: "r1", shoot_id: "s1", original_shoot_date: "2026-09-01", requested_shoot_date: "2026-09-15",
  request_reason: "Gym double-booked", request_source: "manual", current_status: "feasibility_review",
  capacity_result: "ok", staffing_result: "review_required", equipment_result: "unavailable",
  schedule_conflict_result: "ok", affected_bookings: [], alternatives_offered: [], selected_alternative: null,
  client_communication_reference: null, decision: null, final_shoot_date: null
};

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.list.mockResolvedValue({ requests: [REQ] });
  mocks.detail.mockResolvedValue({ request: REQ, events: [{ id: "e1", event_type: "created", from_status: null, to_status: "requested", reason: null, communication_reference: null, created_at: "2026-06-22T10:00:00" }] });
});
afterEach(() => cleanup());

describe("DateChangeRequestPanel", () => {
  it("shows the read-only original date and creates a request without mutating the shoot", async () => {
    mocks.create.mockResolvedValue({ request: { ...REQ, id: "r2" }, created: true });
    render(<DateChangeRequestPanel token="t" shootId="s1" originalDate="2026-09-01" />);
    const original = await screen.findByLabelText("Original booked date");
    expect(original).toHaveValue("2026-09-01");
    expect(original).toHaveAttribute("readonly");

    fireEvent.change(screen.getByLabelText("Requested date"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Request reason"), { target: { value: "Venue change" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit date-change request" }));
    // creating a request calls the request endpoint — never a shoot-date mutation
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("t", expect.objectContaining({ shoot_id: "s1", requested_shoot_date: "2026-10-05", request_reason: "Venue change" })));
  });

  it("lists requests, opens detail, and shows equipment honestly unavailable", async () => {
    render(<DateChangeRequestPanel token="t" shootId="s1" originalDate="2026-09-01" />);
    fireEvent.click(await screen.findByRole("button", { name: /2026-09-01 → 2026-09-15/ }));
    const detail = await screen.findByLabelText("Date-change request r1");
    const d = within(detail);
    expect(d.getByText("Feasibility Review")).toBeInTheDocument();
    expect(d.getByText("Unavailable (no canonical source)")).toBeInTheDocument(); // equipment honesty
    expect(d.getByText("review_required")).toBeInTheDocument(); // staffing must be re-checked
    expect(within(detail).getByLabelText("Date-change history")).toBeInTheDocument();
  });

  it("a leadership user can approve; a non-approver cannot", async () => {
    mocks.decide.mockResolvedValue({ decision: "approved", final_shoot_date: "2026-09-15", original_shoot_date: "2026-09-01" });
    const { unmount } = render(<DateChangeRequestPanel token="t" shootId="s1" originalDate="2026-09-01" canApprove focusRequestId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith("t", "r1", "approved"));
    unmount();
    cleanup();

    // a non-approver never sees Approve/Decline (server also enforces it)
    render(<DateChangeRequestPanel token="t" shootId="s1" originalDate="2026-09-01" focusRequestId="r1" />);
    await screen.findByLabelText("Date-change request r1");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("runs feasibility from the detail panel", async () => {
    mocks.feasibility.mockResolvedValue({ overall: "feasible_with_warnings", capacity_result: "ok", staffing_result: "review_required", equipment_result: "unavailable", schedule_conflict_result: "ok", affected_bookings: [] });
    render(<DateChangeRequestPanel token="t" shootId="s1" originalDate="2026-09-01" focusRequestId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Run feasibility" }));
    await waitFor(() => expect(mocks.feasibility).toHaveBeenCalledWith("t", "r1"));
  });
});
