// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSharedJobStatusCountsMock = vi.fn();
const getExceptionWorkspaceMock = vi.fn();
const getProductionOperationsMock = vi.fn();

vi.mock("../services/jobsApi", () => ({
  getSharedJobStatusCounts: (...args: unknown[]) => getSharedJobStatusCountsMock(...args)
}));
vi.mock("../services/exceptionsApi", () => ({
  getExceptionWorkspace: (...args: unknown[]) => getExceptionWorkspaceMock(...args)
}));
// Production Load now sources from the canonical Production read model (not the jobs counts).
vi.mock("../services/productionOperationsApi", () => ({
  getProductionOperations: (...args: unknown[]) => getProductionOperationsMock(...args)
}));
function productionBlocked(count: number) {
  return { generated_at: "x", scope: "all", metrics: [{ key: "blocked", available: true, count }], rows: [], page: { limit: 1, offset: 0, total: count } };
}

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
  getProductionOperationsMock.mockReset();
  window.location.hash = "#home";
});

// Phase 3 Slice 1: the "Jobs Behind" / "Production Load" cards show real, uncapped
// counts from the canonical jobs world and drill into the matching #jobs filter, so
// the number a leader sees equals the records its drilldown opens.
describe("Company Command job-status cards (canonical, live)", () => {
  it("renders Jobs Behind from jobs counts and Production Load from the canonical Production read model", async () => {
    getSharedJobStatusCountsMock.mockResolvedValue({ counts: counts({ behind: 3 }) });
    getProductionOperationsMock.mockResolvedValue(productionBlocked(7));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);

    expect(await screen.findByText("3 jobs behind on readiness — open to act.")).toBeInTheDocument();
    // Production Load count comes from the Production "blocked" metric (same predicate as the view)
    expect(await screen.findByText("7 jobs blocked in production — open to clear.")).toBeInTheDocument();
  });

  it("deep-links Jobs Behind to #jobs and Production Load to the exact Production blocked view", async () => {
    getSharedJobStatusCountsMock.mockResolvedValue({ counts: counts({ behind: 2 }) });
    getProductionOperationsMock.mockResolvedValue(productionBlocked(7));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    await screen.findByText(/jobs behind on readiness/);

    fireEvent.click(screen.getByRole("button", { name: /Jobs Behind/i }));
    expect(window.location.hash).toBe("#jobs?readinessStatus=off_track");

    window.location.hash = "#home";
    fireEvent.click(screen.getByRole("button", { name: /Production Load/i }));
    // exact destination: the Production operating view filtered by the SAME blocked predicate
    expect(window.location.hash).toBe("#production/operations?stage=blocked");
  });

  it("shows an honest unavailable state — never a fabricated number — when a live count errors", async () => {
    getSharedJobStatusCountsMock.mockRejectedValue(new Error("boom"));
    getProductionOperationsMock.mockRejectedValue(new Error("boom"));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);

    expect(await screen.findByText("Live count unavailable — open Jobs.")).toBeInTheDocument(); // Jobs Behind
    expect(await screen.findByText("Live count unavailable — open the Production queue.")).toBeInTheDocument(); // Production Load
  });

  it("renders a real zero honestly (an empty queue is not an error)", async () => {
    getSharedJobStatusCountsMock.mockResolvedValue({ counts: counts({ behind: 0 }) });
    getProductionOperationsMock.mockResolvedValue(productionBlocked(0));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);

    expect(await screen.findByText("No jobs behind on readiness right now.")).toBeInTheDocument();
    expect(await screen.findByText("No jobs blocked in production right now.")).toBeInTheDocument();
  });
});
