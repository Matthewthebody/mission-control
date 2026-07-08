import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollSelfCheck } from "../pages/PayrollSelfCheck";
import type { MySelfCheckPayload } from "../services/laborCommandCenterApi";

vi.mock("../api", () => ({
  apiFetch: vi.fn()
}));

import { apiFetch } from "../api";

const apiFetchMock = vi.mocked(apiFetch);

function buildPayload(overrides: Partial<MySelfCheckPayload> = {}): MySelfCheckPayload {
  return {
    window_state: "open",
    period: {
      id: "period-1",
      period_start: "2026-07-06",
      period_end: "2026-07-12",
      status: "self_check_open",
      lock_scheduled_at: "2026-07-14T12:00:00.000Z"
    },
    self_check: { id: "sc-1", status: "pending", confirmed_at: null },
    days: [
      {
        work_date: "2026-07-06",
        session_id: "session-1",
        clock_in_at: "2026-07-06T14:00:00.000Z",
        clock_out_at: "2026-07-06T22:30:00.000Z",
        total_worked_minutes: 510,
        payable_minutes: 480,
        lunch_deduction_minutes: 30,
        lunch_deduction_source: "auto_deducted",
        shift_title: "Studio Day",
        shoot_title: "Lincoln Elementary Picture Day",
        location_name: "Lincoln Elementary Gym",
        manager_edit_count: 1,
        open_exception_count: 0,
        geofence_exception: false,
        responses: []
      }
    ],
    open_discrepancy_count: 0,
    ...overrides
  };
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("PayrollSelfCheck page", () => {
  it("renders the day with punches, totals, job/location, break status, and manager edits", async () => {
    apiFetchMock.mockResolvedValue(buildPayload());
    render(<PayrollSelfCheck token="test-token" />);

    expect(await screen.findByText(/Lincoln Elementary Picture Day/)).toBeInTheDocument();
    expect(screen.getByText(/30m break deducted/)).toBeInTheDocument();
    expect(screen.getByText(/1 manager edit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Looks correct" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Something is wrong" })).toBeEnabled();
  });

  it("posts a looks_correct response for the reviewed day", async () => {
    apiFetchMock.mockResolvedValue(buildPayload());
    render(<PayrollSelfCheck token="test-token" />);

    fireEvent.click(await screen.findByRole("button", { name: "Looks correct" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/labor/self-check/responses",
        "test-token",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ period_id: "period-1", work_date: "2026-07-06", response: "looks_correct" })
        })
      );
    });
  });

  it("requires a note before a problem report can be submitted", async () => {
    apiFetchMock.mockResolvedValue(buildPayload());
    render(<PayrollSelfCheck token="test-token" />);

    fireEvent.click(await screen.findByRole("button", { name: "Something is wrong" }));
    const submit = await screen.findByRole("button", { name: "Submit report" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/I worked until/), { target: { value: "No lunch was taken." } });
    expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
  });

  it("blocks confirmation while a problem report is open", async () => {
    apiFetchMock.mockResolvedValue(
      buildPayload({
        open_discrepancy_count: 1,
        days: [
          {
            ...buildPayload().days[0],
            responses: [
              {
                id: "item-1",
                response: "no_break_taken",
                note: "No lunch",
                resolution_status: "open",
                linked_exception_request_id: "er-1",
                created_at: "2026-07-07T00:00:00.000Z"
              }
            ]
          }
        ]
      })
    );
    render(<PayrollSelfCheck token="test-token" />);

    expect(await screen.findByText(/open problem report/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm my time is correct" })).toBeDisabled();
  });

  it("shows the auto-break prompt with one-tap no-break and manager-approved claims", async () => {
    apiFetchMock.mockResolvedValue(buildPayload());
    render(<PayrollSelfCheck token="test-token" />);

    expect(
      await screen.findByText(/A 30-minute break was auto-deducted from this shift because it was over 5 hours/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Break deduction is correct" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Manager approved no break" }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/labor/self-check/responses",
        "test-token",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            period_id: "period-1",
            work_date: "2026-07-06",
            response: "no_break_taken",
            manager_approved_claimed: true,
            note: null
          })
        })
      );
    });
  });

  it("shows an honest not-open state instead of a dead flow", async () => {
    apiFetchMock.mockResolvedValue(buildPayload({ window_state: "not_open", self_check: null, days: [] }));
    render(<PayrollSelfCheck token="test-token" />);

    expect(await screen.findByText(/Self-check is not open yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm my time is correct" })).not.toBeInTheDocument();
  });
});
