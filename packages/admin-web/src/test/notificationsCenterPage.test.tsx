import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedAlertCenterResponse } from "../jobTruthTypes";
import { Alerts } from "../pages/Alerts";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args)
}));

function buildCenterResponse(overrides: Partial<SharedAlertCenterResponse> = {}): SharedAlertCenterResponse {
  return {
    summary: {
      unread_count: 1,
      critical_count: 1,
      acted_count: 0
    },
    items: [
      {
        id: "notification-1",
        tenant_id: "tenant-demo",
        alert_event_id: "alert-1",
        recipient_user_id: "user-manager",
        delivery_channel: "in_app",
        delivery_status: "delivered",
        delivered_at: "2026-03-30T16:20:00.000Z",
        read_at: null,
        acted_at: null,
        action_type: null,
        created_at: "2026-03-30T16:20:00.000Z",
        updated_at: "2026-03-30T16:20:00.000Z",
        alert_event: {
          id: "alert-1",
          tenant_id: "tenant-demo",
          watch_flag_id: "watch-flag-1",
          source_entity_type: "shift",
          source_entity_id: "shift-1",
          alert_type: "attendance.probable_no_show",
          severity: "critical",
          title: "Probable no-show on North Gym coverage",
          message: "Clock-in is still missing and lead coverage is at risk.",
          status: "open",
          triggered_at: "2026-03-30T16:20:00.000Z",
          dedupe_key: "attendance.probable_no_show:shift-1",
          payload_json: { deep_link: "/attendance/shifts/shift-1" },
          created_at: "2026-03-30T16:20:00.000Z",
          updated_at: "2026-03-30T16:20:00.000Z"
        },
        watch_flag: {
          id: "watch-flag-1",
          tenant_id: "tenant-demo",
          job_id: "job-1",
          job_day_id: null,
          production_item_id: null,
          approval_request_id: null,
          qa_review_record_id: null,
          deliverable_item_id: null,
          source_entity_type: "shift",
          source_entity_id: "shift-1",
          severity: "critical",
          flag_type: "probable_no_show",
          title: "Probable no-show on North Gym coverage",
          description: "Clock-in is still missing and lead coverage is at risk.",
          status: "open",
          owner_user_id: "user-manager",
          owner_name: "Demo Manager",
          created_by_user_id: "user-system",
          due_at: "2026-03-30T16:45:00.000Z",
          snooze_until: null,
          escalated_at: null,
          escalated_to_role: null,
          resolved_at: null,
          resolved_by_user_id: null,
          resolved_by_name: null,
          auto_key: "attendance.probable_no_show:shift-1",
          created_at: "2026-03-30T16:20:00.000Z",
          updated_at: "2026-03-30T16:20:00.000Z"
        },
        job_id: "job-1",
        job_number: "SCH-1001",
        job_title: "North Gym coverage",
        department_type: "schools",
        organization_name: "North High",
        recipient_name: "Demo Manager"
      },
      {
        id: "notification-2",
        tenant_id: "tenant-demo",
        alert_event_id: "alert-2",
        recipient_user_id: "user-manager",
        delivery_channel: "in_app",
        delivery_status: "delivered",
        delivered_at: "2026-03-30T15:55:00.000Z",
        read_at: "2026-03-30T16:05:00.000Z",
        acted_at: null,
        action_type: null,
        created_at: "2026-03-30T15:55:00.000Z",
        updated_at: "2026-03-30T16:00:00.000Z",
        alert_event: {
          id: "alert-2",
          tenant_id: "tenant-demo",
          watch_flag_id: null,
          source_entity_type: "request",
          source_entity_id: "request-1",
          alert_type: "schedule.pto_requested",
          severity: "medium",
          title: "PTO request needs review",
          message: "Field Photographer requested Friday off.",
          status: "open",
          triggered_at: "2026-03-30T15:55:00.000Z",
          dedupe_key: "schedule.pto_requested:request-1",
          payload_json: { deep_link: "/people-ops/requests" },
          created_at: "2026-03-30T15:55:00.000Z",
          updated_at: "2026-03-30T16:00:00.000Z"
        },
        watch_flag: null,
        job_id: null,
        job_number: null,
        job_title: null,
        department_type: "schools",
        organization_name: "North High",
        recipient_name: "Demo Manager"
      }
    ],
    ...overrides
  };
}

describe("Notification Center page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.location.hash = "#dashboard";
  });

  it("renders the operational inbox and records read plus acted alert actions explicitly", async () => {
    const firstPayload = buildCenterResponse();
    const refreshedPayload = buildCenterResponse({
      summary: {
        unread_count: 0,
        critical_count: 1,
        acted_count: 1
      },
      items: [
        {
          ...firstPayload.items[0],
          read_at: "2026-03-30T16:31:00.000Z",
          acted_at: "2026-03-30T16:31:30.000Z",
          action_type: "acknowledge_watch_flag",
          watch_flag: {
            ...firstPayload.items[0].watch_flag!,
            status: "acknowledged"
          }
        },
        firstPayload.items[1]
      ]
    });

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/jobs/alerts?limit=100") {
        return apiFetchMock.mock.calls.filter(([calledPath]) => calledPath === path).length > 1 ? refreshedPayload : firstPayload;
      }
      if (path === "/api/jobs/alerts/notification-1/read") {
        return { delivery: { id: "notification-1", alert_event_id: "alert-1", read_at: "2026-03-30T16:31:00.000Z" } };
      }
      if (path === "/api/jobs/watch-flags/watch-flag-1/acknowledge") {
        return {};
      }
      if (path === "/api/jobs/alerts/notification-1/acted") {
        return {
          delivery: {
            id: "notification-1",
            alert_event_id: "alert-1",
            acted_at: "2026-03-30T16:31:30.000Z",
            action_type: "acknowledge_watch_flag"
          }
        };
      }
      throw new Error(`Unexpected notification center call: ${path}`);
    });

    render(<Alerts token="token" socket={null} />);

    expect(await screen.findByText("Notification Center")).toBeInTheDocument();
    expect(screen.getAllByText(/Probable no-show on North Gym coverage/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("PTO request needs review").length).toBeGreaterThan(0);
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.getAllByText("Critical").length).toBeGreaterThan(0);
    expect(screen.getByText("Acted On")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Mark Read" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));

    await waitFor(() => {
      expect(
        apiFetchMock.mock.calls.some(
          ([path, token, init]) =>
            path === "/api/jobs/alerts/notification-1/read" &&
            token === "token" &&
            init &&
            typeof init === "object" &&
            "method" in init &&
            init.method === "POST"
        )
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/jobs/watch-flags/watch-flag-1/acknowledge",
        "token",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({})
        })
      );
    });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/jobs/alerts/notification-1/acted",
        "token",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action_type: "acknowledge_watch_flag" })
        })
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("Viewed").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Mark Read" })).not.toBeInTheDocument();
    });
  });
});
