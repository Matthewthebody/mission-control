// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionOperationsView } from "../pages/ProductionOperationsView";

const getProductionOperationsMock = vi.fn();
vi.mock("../services/productionOperationsApi", async () => {
  const actual = await vi.importActual<typeof import("../services/productionOperationsApi")>("../services/productionOperationsApi");
  return { ...actual, getProductionOperations: (...args: unknown[]) => getProductionOperationsMock(...args) };
});

const PAYLOAD = {
  generated_at: "2026-06-22T00:00:00.000Z",
  scope: "all" as const,
  metrics: [
    { key: "ready_to_delegate", available: true, count: 3 },
    { key: "working", available: true, count: 5 },
    { key: "blocked", available: true, count: 2 },
    { key: "unowned", available: true, count: 1 }
  ],
  rows: [
    { source_type: "production_project" as const, source_id: "p1", job_id: "j1", organization_id: "o1", title: "Wayzata Fall Retouch", stage: "Working", current_step: "Color correction", owner_user_id: "u1", due_date: "2026-09-01", next_action: "Advance: Color correction", waiting_on: null, missing_inputs: 0, blocker_count: 0, approval_state: "none", risk: "none" as const, age_in_stage_days: 2, exact_destination_hash: "#production?project=p1", provenance: "production_project" },
    { source_type: "production_project" as const, source_id: "p2", job_id: null, organization_id: "o2", title: "Osseo ID Cards", stage: "Waiting", current_step: null, owner_user_id: null, due_date: "2026-08-01", next_action: "Delegate / assign owner", waiting_on: "Awaiting roster", missing_inputs: 2, blocker_count: 1, approval_state: "pending_review", risk: "critical" as const, age_in_stage_days: 9, exact_destination_hash: "#production?project=p2", provenance: "production_project" }
  ],
  page: { limit: 50, offset: 0, total: 2 }
};

beforeEach(() => {
  getProductionOperationsMock.mockReset();
  window.location.hash = "#production/operations";
});
afterEach(() => {
  cleanup();
  window.location.hash = ""; // prevent hash state leaking into other test files
});

describe("ProductionOperationsView", () => {
  it("renders server-computed metric chips and a dense row table (no client re-totaling)", async () => {
    getProductionOperationsMock.mockResolvedValue(PAYLOAD);
    render(<ProductionOperationsView token="t" />);
    expect(await screen.findByRole("button", { name: /Ready to Delegates*3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workings*5/ })).toBeInTheDocument();
    // dense rows
    expect(screen.getByRole("button", { name: "Wayzata Fall Retouch" })).toBeInTheDocument();
    expect(screen.getByText("Color correction")).toBeInTheDocument(); // live workflow step shown for Working
    expect(screen.getAllByText("Unowned").length).toBeGreaterThan(0);
  });

  it("a metric chip URL-filters the table by the canonical stage", async () => {
    getProductionOperationsMock.mockResolvedValue(PAYLOAD);
    render(<ProductionOperationsView token="t" />);
    await screen.findByRole("button", { name: /Blockeds*2/ });
    fireEvent.click(screen.getByRole("button", { name: /Blockeds*2/ }));
    // the view reloads with the canonical stage filter (blocked)
    await waitFor(() => expect(getProductionOperationsMock).toHaveBeenLastCalledWith("t", expect.objectContaining({ stage: "blocked" })));
    expect(window.location.hash).toContain("stage=blocked");
  });

  it("opens a quick-view drawer (Production Truth Snapshot) with the exact source + full-record link", async () => {
    getProductionOperationsMock.mockResolvedValue(PAYLOAD);
    render(<ProductionOperationsView token="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Osseo ID Cards" }));
    const drawer = await screen.findByRole("dialog", { name: /Production snapshot: Osseo ID Cards/ });
    const d = within(drawer);
    expect(d.getByText("Production Truth Snapshot")).toBeInTheDocument();
    expect(d.getByText("Awaiting roster")).toBeInTheDocument(); // exact blocker
    expect(d.getByText(/production_project · p2/)).toBeInTheDocument(); // exact source id
    expect(d.getByRole("link", { name: "Open Full Record" })).toHaveAttribute("href", "#production?project=p2");
  });

  it("shows an honest error (no demo fallback) when the API fails", async () => {
    getProductionOperationsMock.mockRejectedValue(new Error("boom"));
    render(<ProductionOperationsView token="t" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument(); // no fabricated rows
  });

  it("shows an honest empty state when there is no production work", async () => {
    getProductionOperationsMock.mockResolvedValue({ ...PAYLOAD, rows: [], page: { limit: 50, offset: 0, total: 0 } });
    render(<ProductionOperationsView token="t" />);
    expect(await screen.findByText("No production work matches this view.")).toBeInTheDocument();
  });
});
