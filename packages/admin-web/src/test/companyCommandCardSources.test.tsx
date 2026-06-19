// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationalExceptionListItem, OperationalExceptionWorkspace } from "../exceptionTypes";

vi.mock("../services/exceptionsApi", () => ({
  getExceptionWorkspace: vi.fn(),
  applyExceptionAction: vi.fn()
}));

import { getExceptionWorkspace } from "../services/exceptionsApi";
import { CompanyCommandHome } from "../home/CompanyCommandHome";
import { getHomeRole } from "../home/homeRoles";

const mockGetWorkspace = vi.mocked(getExceptionWorkspace);

function item(overrides: Partial<OperationalExceptionListItem>): OperationalExceptionListItem {
  return {
    id: "x",
    entity_type: "shoot",
    entity_id: "shoot-1",
    workflow_run_id: null,
    category: "staffing",
    type: "critical_role_gap",
    severity: "blocking",
    severity_label: "Blocking",
    blocking: true,
    status: "open",
    owner_user_id: null,
    owner_label: null,
    assigned_team_id: null,
    source_module: "scheduling",
    source_module_label: "Scheduling",
    source_entity_label: null,
    scope_department: "schools",
    title: "Needs a lead",
    summary: "No lead.",
    due_at: null,
    due_label: null,
    timing_state: "overdue",
    timing_label: "Overdue",
    next_action_label: "Open Scheduling",
    action_hash: "#scheduling?shoot=shoot-1",
    operational_impact_score: 1,
    snoozed_until: null,
    status_detail: null,
    resolution_note: null,
    source_snapshot: {},
    created_at: "2026-06-18T00:00:00.000Z",
    updated_at: "2026-06-18T00:00:00.000Z",
    resolved_at: null,
    ...overrides
  };
}

function workspaceWith(items: OperationalExceptionListItem[]): OperationalExceptionWorkspace {
  return {
    generated_at: "2026-06-18T12:00:00.000Z",
    scope: "all",
    summary: { open_count: 0, blocking_count: 0, at_risk_count: 0, warning_count: 0, overdue_count: 0, snoozed_count: 0 },
    home_ready_summary: { visible: false, tone: "neutral", summary_line: "", urgent_count: 0, items: [] },
    owner_options: [],
    items
  };
}

function commandCard(label: string): HTMLElement {
  return screen.getByText(label).closest(".home-command-card") as HTMLElement;
}

describe("Company Command card sources", () => {
  beforeEach(() => {
    mockGetWorkspace.mockReset();
    window.location.hash = "#home";
  });
  afterEach(() => cleanup());

  it("shows a live On Fire count from the same source the Urgent Window uses", async () => {
    mockGetWorkspace.mockResolvedValue(
      workspaceWith([
        item({ id: "o1", status: "open" }),
        item({ id: "o2", status: "open" }),
        item({ id: "o3", status: "open" }),
        item({ id: "s1", status: "snoozed" })
      ])
    );
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    expect(await screen.findByText(/3 unresolved urgent issues/)).toBeInTheDocument();
    expect(within(commandCard("On Fire")).getByText("3")).toBeInTheDocument();
  });

  it("shows zero honestly when there are no unresolved urgent items", async () => {
    mockGetWorkspace.mockResolvedValue(workspaceWith([]));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    expect(await screen.findByText(/0 unresolved urgent issues/)).toBeInTheDocument();
    expect(within(commandCard("On Fire")).getByText("0")).toBeInTheDocument();
  });

  it("never falls back to a fabricated number while loading or on API failure", async () => {
    mockGetWorkspace.mockReturnValue(new Promise<OperationalExceptionWorkspace>(() => {}));
    const loading = render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    expect(within(commandCard("On Fire")).getByText("…")).toBeInTheDocument();
    loading.unmount();

    mockGetWorkspace.mockReset();
    mockGetWorkspace.mockRejectedValue(new Error("boom"));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    expect(await screen.findByText(/Live count unavailable/)).toBeInTheDocument();
    expect(within(commandCard("On Fire")).getByText("—")).toBeInTheDocument();
  });

  it("visibly labels sample cards and shows no count or CTA on unavailable cards", async () => {
    mockGetWorkspace.mockResolvedValue(workspaceWith([]));
    render(<CompanyCommandHome role={getHomeRole("matthew")} token="t" />);
    await screen.findByText(/unresolved urgent issues/);

    // Sample card carries a visible Sample label (never an unlabeled demo count).
    expect(within(commandCard("Staffing Risk")).getByText("Sample")).toBeInTheDocument();

    // Unavailable cards: not connected, no enabled CTA, and no fabricated number.
    expect(screen.queryByRole("button", { name: /Weather Watch/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Client Issues/i })).toBeNull();
    const client = commandCard("Client Issues");
    expect(within(client).getByText("Not connected")).toBeInTheDocument();
    expect(within(client).queryByText("2")).toBeNull();
  });
});
