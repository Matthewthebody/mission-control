// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api";
import { GlobalPunchControl } from "../components/GlobalPunchControl";
import type { TimeClockShellControlState } from "../services/timeClockApi";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();
const getBrowserLocationMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

vi.mock("../services/browserLocation", () => ({
  getBrowserLocation: (...args: unknown[]) => getBrowserLocationMock(...args)
}));

afterEach(() => {
  cleanup();
});

function buildUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-1",
    tenantId: "tenant-demo",
    accountId: "account-1",
    sessionId: "session-1",
    email: "photo@example.com",
    fullName: "Demo Photographer",
    status: "active",
    department: "schools",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["photographer"],
    permissions: ["dashboard.read", "schedule.read", "time.clock", "trade.request"],
    authorityTier: "standard_employee",
    primaryJobFunctionProfile: "associate_photographer",
    jobFunctionProfiles: ["associate_photographer"],
    permissionGrants: [],
    effectiveScopes: ["self_only"],
    sessionTrust: {
      identityProvider: "local_password",
      sessionAssurance: "standard",
      requestTransport: "bearer",
      elevatedUntil: null,
      privilegedModeUntil: null,
      breakGlassStartedAt: null,
      breakGlassUntil: null,
      breakGlassReason: null,
      breakGlassScopeType: null,
      breakGlassScopeId: null,
      elevatedSessionActive: false,
      privilegedModeActive: false,
      breakGlassModeActive: false
    },
    ...overrides
  };
}

function buildState(overrides: Partial<TimeClockShellControlState> = {}) {
  return {
    generated_at: "2026-03-31T14:00:00.000Z",
    state: "action_needed" as const,
    emphasis: "red" as const,
    label: "Punch In Needed",
    helper_text: "Shift starts in 5m at Main Office.",
    time_clock_state: {
      session_id: null,
      session_status: "off_clock" as const,
      current_state: "off_clock" as const,
      current_segment_id: null,
      current_segment_review_status: null,
      current_linked_shoot_id: null,
      current_linked_location_id: null,
      current_segment_started_at: null,
      needs_end_of_day_confirmation: false,
      last_clock_event_at: null
    },
    active_shift: {
      id: "shift-1",
      shoot_id: null,
      title: "Main Office Coverage",
      shift_kind: "office",
      starts_at: "2026-03-31T14:05:00.000Z",
      ends_at: "2026-03-31T18:00:00.000Z",
      location_name: "Main Office",
      actionable_now: true,
      starts_in_minutes: 5,
      late_by_minutes: null
    },
    next_shift: null,
    latest_session: null,
    review: {
      has_open_review: false,
      open_request_count: 0,
      label: null
    },
    action: {
      direction: "in" as const,
      label: "Punch In",
      enabled: true,
      shift_id: "shift-1",
      shoot_id: null,
      work_state: "office_drive" as const
    },
    ...overrides
  };
}

describe("GlobalPunchControl", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    getBrowserLocationMock.mockReset();
    getBrowserLocationMock.mockResolvedValue({
      latitude: 44.98,
      longitude: -93.26,
      accuracy: 18
    });
    document.documentElement.dataset.theme = "dark";
    Object.defineProperty(window, "crypto", {
      value: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      configurable: true
    });
  });

  it("renders a red action-needed state when the canonical backend says the user is off clock", async () => {
    apiFetchMock.mockResolvedValueOnce(buildState());

    render(<GlobalPunchControl token="demo-token" currentUser={buildUser()} />);

    const trigger = await screen.findByRole("button", { name: /global time clock control/i });
    expect(trigger).toHaveTextContent("Punch In Needed");
    expect(trigger.className).toContain("global-punch-control__trigger--red");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/attendance/time-clock/state", "demo-token");
  });

  it("renders a green active state when the canonical backend says the user is punched in", async () => {
    apiFetchMock.mockResolvedValueOnce(
      buildState({
        state: "active",
        emphasis: "green",
        label: "Punched In",
        helper_text: "Main Office Coverage · Main Office",
        time_clock_state: {
          session_id: "session-1",
          session_status: "open",
          current_state: "office_drive",
          current_segment_id: "segment-1",
          current_segment_review_status: "not_required",
          current_linked_shoot_id: null,
          current_linked_location_id: null,
          current_segment_started_at: new Date(Date.now() - 20 * 60_000).toISOString(),
          needs_end_of_day_confirmation: false,
          last_clock_event_at: new Date(Date.now() - 20 * 60_000).toISOString()
        },
        action: {
          direction: "out",
          label: "Punch Out",
          enabled: true,
          shift_id: "shift-1",
          shoot_id: null,
          work_state: null
        }
      })
    );

    render(<GlobalPunchControl token="demo-token" currentUser={buildUser()} />);

    const trigger = await screen.findByRole("button", { name: /global time clock control/i });
    expect(trigger).toHaveTextContent("Punched In");
    expect(trigger.className).toContain("global-punch-control__trigger--green");
  });

  it("uses the canonical attendance punch mutation and refreshes from the canonical state route after punching", async () => {
    apiFetchMock
      .mockResolvedValueOnce(buildState())
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(
        buildState({
          state: "active",
          emphasis: "green",
          label: "Punched In",
          helper_text: "Main Office Coverage · Main Office",
          time_clock_state: {
            session_id: "session-1",
            session_status: "open",
            current_state: "office_drive",
            current_segment_id: "segment-1",
            current_segment_review_status: "not_required",
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: new Date().toISOString(),
            needs_end_of_day_confirmation: false,
            last_clock_event_at: new Date().toISOString()
          },
          action: {
            direction: "out",
            label: "Punch Out",
            enabled: true,
            shift_id: "shift-1",
            shoot_id: null,
            work_state: null
          }
        })
      );

    render(<GlobalPunchControl token="demo-token" currentUser={buildUser()} />);

    fireEvent.click(await screen.findByRole("button", { name: /global time clock control/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Punch In" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/attendance/punches",
        "demo-token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Idempotency-Key": "11111111-1111-4111-8111-111111111111"
          })
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /global time clock control/i })).toHaveTextContent("Punched In");
    });
  });

  it("deep-links employees to My Day and their personal Schedule from the header panel", async () => {
    apiFetchMock.mockResolvedValueOnce(buildState());

    render(<GlobalPunchControl token="demo-token" currentUser={buildUser()} />);

      fireEvent.click(await screen.findByRole("button", { name: /global time clock control/i }));

      fireEvent.click(screen.getByRole("button", { name: "Open My Day" }));
      expect(window.location.hash).toBe("#my-work");

      fireEvent.click(screen.getByRole("button", { name: "Open Schedule" }));
      expect(window.location.hash).toBe("#schedule");
  });

  it("requires an explicit confirmation step before punching in without location permission", async () => {
    getBrowserLocationMock.mockResolvedValueOnce(null);
    apiFetchMock.mockResolvedValueOnce(
      buildState({
        action: {
          direction: "in",
          label: "Punch In",
          enabled: true,
          shift_id: "shift-1",
          shoot_id: "shoot-1",
          work_state: "photography"
        }
      })
    );

    render(<GlobalPunchControl token="demo-token" currentUser={buildUser()} />);

    fireEvent.click(await screen.findByRole("button", { name: /global time clock control/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Punch In" }));

    expect(await screen.findByText("Location confirmation required")).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    apiFetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(
        buildState({
          state: "active",
          emphasis: "green",
          label: "Punched In",
          helper_text: "Spring Portrait Day | Main Gym",
          time_clock_state: {
            session_id: "session-1",
            session_status: "open",
            current_state: "photography",
            current_segment_id: "segment-1",
            current_segment_review_status: "pending_review",
            current_linked_shoot_id: "shoot-1",
            current_linked_location_id: "location-1",
            current_segment_started_at: new Date().toISOString(),
            needs_end_of_day_confirmation: false,
            last_clock_event_at: new Date().toISOString()
          },
          action: {
            direction: "out",
            label: "Punch Out",
            enabled: true,
            shift_id: "shift-1",
            shoot_id: "shoot-1",
            work_state: null
          }
        })
      );

    fireEvent.click(screen.getByRole("button", { name: "Continue Without Location" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/attendance/punches",
        "demo-token",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"confirmed_permission":true')
        })
      );
    });
  });

  it("uses backend confirmation details instead of dumping a raw office-drive error on the user", async () => {
    apiFetchMock
      .mockResolvedValueOnce(buildState())
      .mockRejectedValueOnce(
        new ApiClientError(400, "Starting Office/Drive outside the studio or linked Shoot context requires confirmation.", {
          code: "office_drive_confirmation_required",
          confirmation_kind: "outside_context",
          suggested_reason_code: "gps_issue"
        })
      );

    render(<GlobalPunchControl token="demo-token" currentUser={buildUser()} />);

    fireEvent.click(await screen.findByRole("button", { name: /global time clock control/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Punch In" }));

    expect(await screen.findByText("Confirm office or drive time")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't update your time clock.")).not.toBeInTheDocument();

    apiFetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(
        buildState({
          state: "active",
          emphasis: "green",
          label: "Punched In",
          helper_text: "Main Office Coverage | Main Office",
          time_clock_state: {
            session_id: "session-1",
            session_status: "open",
            current_state: "office_drive",
            current_segment_id: "segment-1",
            current_segment_review_status: "pending_review",
            current_linked_shoot_id: null,
            current_linked_location_id: null,
            current_segment_started_at: new Date().toISOString(),
            needs_end_of_day_confirmation: false,
            last_clock_event_at: new Date().toISOString()
          },
          action: {
            direction: "out",
            label: "Punch Out",
            enabled: true,
            shift_id: "shift-1",
            shoot_id: null,
            work_state: null
          }
        })
      );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Office/Drive Start" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/attendance/punches",
        "demo-token",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"confirmed_outside_context":true')
        })
      );
    });
  });

  it("does not render or fetch a duplicate state source for users who cannot clock time", () => {
    render(
      <GlobalPunchControl
        token="demo-token"
        currentUser={buildUser({
          permissions: ["dashboard.read", "schedule.read"]
        })}
      />
    );

    expect(screen.queryByRole("button", { name: /global time clock control/i })).not.toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
