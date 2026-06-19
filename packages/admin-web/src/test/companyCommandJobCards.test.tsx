// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSharedJobStatusCountsMock = vi.fn();
const getExceptionWorkspaceMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  getSharedJobStatusCounts: (...args: unknown[]) => getSharedJobStatusCountsMock(...args)
}));
vi.mock("../services/exceptionsApi", () => ({
  getExceptionWorkspace: (...args: unknown[]) => getExceptionWorkspaceMock(...args)
}));

import { CompanyCommandHome } from "../home/CompanyCommandHome";
import { getHomeRole } from "../home/homeRoles";

function counts(overrides: Record<string, number> = {}) {
  return {
    total_active: 297,
    behind: 0,
    at_risk: 284,
    blocked_production: 7,
    high_risk: 0,
    staffing_gap: 0,
    ...overrides
  };
}

beforeEach(() => {
  window.location.hash = "#home";
  // The "On Fire" card also goes live when a token is present; keep it resolved and empty.
  getExceptionWorkspaceMock.mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
  getSharedJobStatusCountsMock.mockReset();
  getExceptionWorkspaceMock.mockReset();
  window.location.hash = "#home";
});

// Phase 3 Slice 1: the "Jobs Behind" / "Production Load" cards show real, uncapped
// counts from the canonical jobs world and drill into the matching #jobs filter, so
// the number a leader sees equals the records its drilldown opens.
describe("Company Command job-status cards (canonical, live)", () => {
  it("renders the live canonical counts from /api/jobs/status-counts", async () => {
    getSharedJobStatusCountsMock.mockResolvedValue({ counts: counts({ behind: 3, blocked_production: 7 }) });
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);

    expect(await screen.findByText("3 jobs behind on readiness — open to act.")).toBeInTheDocument();
    expect(screen.getByText("7 jobs blocked in production — open to clear.")).toBeInTheDocument();
  });

  it("deep-links each card to the matching canonical jobs filter (count == destination)", async () => {
    getSharedJobStatusCountsMock.mockResolvedValue({ counts: counts({ behind: 2, blocked_production: 7 }) });
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    await screen.findByText(/jobs behind on readiness/);

    fireEvent.click(screen.getByRole("button", { name: /Jobs Behind/i }));
    expect(window.location.hash).toBe("#jobs?readinessStatus=off_track");

    window.location.hash = "#home";
    fireEvent.click(screen.getByRole("button", { name: /Production Load/i }));
    expect(window.location.hash).toBe("#jobs?productionStatus=blocked");
  });

  it("shows an honest unavailable state — never a fabricated number — when the live count errors", async () => {
    getSharedJobStatusCountsMock.mockRejectedValue(new Error("boom"));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);

    const unavailable = await screen.findAllByText("Live count unavailable — open Jobs.");
    expect(unavailable).toHaveLength(2); // Jobs Behind + Production Load, both honestly blank
  });

  it("renders a real zero honestly (an empty queue is not an error)", async () => {
    getSharedJobStatusCountsMock.mockResolvedValue({ counts: counts({ behind: 0, blocked_production: 0 }) });
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);

    expect(await screen.findByText("No jobs behind on readiness right now.")).toBeInTheDocument();
    expect(screen.getByText("No jobs blocked in production right now.")).toBeInTheDocument();
  });
});
