// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationHistorySurface } from "../components/location/LocationHistorySurface";
import type { LocationHistoricalContext, ShootLocationIntelligence } from "../types";

const getShootLocationIntelligenceMock = vi.fn();

vi.mock("../services/locationApi", async () => {
  const actual = await vi.importActual<typeof import("../services/locationApi")>("../services/locationApi");
  return {
    ...actual,
    getShootLocationIntelligence: (...args: unknown[]) => getShootLocationIntelligenceMock(...args)
  };
});

const historyContext: LocationHistoricalContext = {
  quick_context: {
    first_time_location: false,
    total_prior_visits: 17,
    last_visit_date: "2026-04-14",
    last_confirmed_memory_date: "2026-04-14",
    top_watch_outs: ["Load in through the west athletic entrance", "Gym lights are on a manual panel"],
    recommended_arrival_buffer_minutes: 30,
    recommended_staffing_note: null,
    freshness_state: "fresh",
    memory_status: "active",
    open_issue_count: 1,
    trust_source: "reviewed_memory"
  },
  last_time_here: {
    shoot_date: "2026-04-14",
    shoot_type: "School Picture Day",
    overall_outcome: "minor_issues",
    staffing_fit: "understaffed",
    setup_difficulty: "medium",
    major_issue: false,
    next_time_recommendation: "Plan an extra photographer",
    setup_photos_exist: false
  },
  repeat_pattern_signals: [
    {
      key: "understaffing",
      label: "Repeated understaffing",
      detail: "Understaffed on 3 of the last visits.",
      evidence_count: 3,
      severity: "warning",
      source: "repeated_structured_pattern"
    }
  ],
  open_follow_ups: [
    {
      id: "f1",
      type: "eval_follow_up",
      title: "Leadership review still needed",
      detail: "Lighting issue flagged.",
      related_shoot_name: null,
      related_shoot_date: null,
      created_at: null,
      source_label: "Eval"
    }
  ],
  setup_visuals: { photos: [], top_setup_instruction: null, top_load_in_instruction: "Load in through the west athletic entrance" },
  recent_comparable_shoots: []
};

function intel(context: LocationHistoricalContext | null): ShootLocationIntelligence {
  return {
    matched_location_id: context ? "loc-1" : null,
    match_source: context ? "fuzzy" : "none",
    confidence: context ? 1 : 0,
    location: null,
    recent_evaluations: [],
    recent_photos: [],
    suggestions: [],
    missing_setup_photo_alert: null,
    historical_context: context
  };
}

beforeEach(() => {
  getShootLocationIntelligenceMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("LocationHistorySurface", () => {
  it("detail: shows the history panel for a known location with prior visits", async () => {
    getShootLocationIntelligenceMock.mockResolvedValue(intel(historyContext));
    render(<LocationHistorySurface variant="detail" token="token" locationName="Wayzata High School" locationAddress="305 Vicksburg Ln N" />);

    expect(screen.getByRole("heading", { name: "Location Intelligence" })).toBeInTheDocument();
    expect(screen.getByText("Wayzata High School")).toBeInTheDocument();
    expect(await screen.findByText("What we know about this place")).toBeInTheDocument();
    expect(screen.getByText(/17 prior visit/)).toBeInTheDocument();
    expect(screen.queryByText("No prior location history has been recorded yet.")).not.toBeInTheDocument();
    expect(getShootLocationIntelligenceMock).toHaveBeenCalledWith("token", {
      shootLocationName: "Wayzata High School",
      shootLocationAddress: "305 Vicksburg Ln N"
    });
  });

  it("detail: shows an honest empty state for a known location with no history", async () => {
    getShootLocationIntelligenceMock.mockResolvedValue(intel(null));
    render(<LocationHistorySurface variant="detail" token="token" locationName="Some New Field" />);

    expect(await screen.findByText("No prior location history has been recorded yet.")).toBeInTheDocument();
    expect(screen.queryByText("Load in through the west athletic entrance")).not.toBeInTheDocument();
  });

  it("detail: renders nothing and does not fetch when there is no known location", () => {
    const { container } = render(<LocationHistorySurface variant="detail" token="token" locationName={null} />);

    expect(container).toBeEmptyDOMElement();
    expect(getShootLocationIntelligenceMock).not.toHaveBeenCalled();
  });

  it("detail: shows an honest error state when the fetch fails", async () => {
    getShootLocationIntelligenceMock.mockRejectedValue(new Error("network"));
    render(<LocationHistorySurface variant="detail" token="token" locationName="Wayzata High School" />);

    expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
  });

  it("preview: shows a compact known-history strip for a location with history", async () => {
    getShootLocationIntelligenceMock.mockResolvedValue(intel(historyContext));
    render(<LocationHistorySurface variant="preview" token="token" locationName="Wayzata High School" />);

    expect(await screen.findByText("Known history available")).toBeInTheDocument();
    expect(screen.getByText(/17 previous shoots/)).toBeInTheDocument();
    expect(screen.getByText("Load in through the west athletic entrance")).toBeInTheDocument();
  });

  it("preview: renders nothing for a location with no history", async () => {
    getShootLocationIntelligenceMock.mockResolvedValue(intel(null));
    const { container } = render(<LocationHistorySurface variant="preview" token="token" locationName="Some New Field" />);

    await waitFor(() => expect(getShootLocationIntelligenceMock).toHaveBeenCalled());
    expect(screen.queryByText("Known history available")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
