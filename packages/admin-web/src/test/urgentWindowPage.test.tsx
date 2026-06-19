// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationalExceptionListItem, OperationalExceptionWorkspace } from "../exceptionTypes";
import type { SessionUser } from "../types";

vi.mock("../services/exceptionsApi", () => ({
  getExceptionWorkspace: vi.fn(),
  applyExceptionAction: vi.fn()
}));
vi.mock("../permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../permissions")>();
  return { ...actual, canManageOperatingSystemModule: vi.fn(() => true) };
});

import { getExceptionWorkspace } from "../services/exceptionsApi";
import { canManageOperatingSystemModule } from "../permissions";
import { UrgentWindowPage } from "../pages/UrgentWindowPage";

const mockGetWorkspace = vi.mocked(getExceptionWorkspace);
const mockCanManage = vi.mocked(canManageOperatingSystemModule);

function makeItem(overrides: Partial<OperationalExceptionListItem> = {}): OperationalExceptionListItem {
  return {
    id: "item-staffing",
    entity_type: "shoot",
    entity_id: "shoot-12345678abcd",
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
    title: "Edina Soccer needs a lead",
    summary: "No lead assigned for tomorrow.",
    due_at: null,
    due_label: null,
    timing_state: "overdue",
    timing_label: "Overdue",
    next_action_label: "Open Scheduling",
    action_hash: "#scheduling?area=staffing&shoot=shoot-12345678abcd",
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

const workspace: OperationalExceptionWorkspace = {
  generated_at: "2026-06-18T12:00:00.000Z",
  scope: "all",
  summary: { open_count: 1, blocking_count: 1, at_risk_count: 0, warning_count: 0, overdue_count: 1, snoozed_count: 0 },
  home_ready_summary: { visible: true, tone: "action_needed", summary_line: "", urgent_count: 1, items: [] },
  owner_options: [],
  items: [makeItem()]
};

const user = { id: "me" } as unknown as SessionUser;

describe("Urgent Window page", () => {
  beforeEach(() => {
    mockGetWorkspace.mockResolvedValue(workspace);
    mockCanManage.mockReturnValue(true);
    window.location.hash = "#urgent-window";
  });
  afterEach(() => cleanup());

  it("renders live urgent rows carrying the exact source id and a live provenance label", async () => {
    render(<UrgentWindowPage token="t" currentUser={user} />);
    expect(await screen.findByText("Edina Soccer needs a lead")).toBeInTheDocument();
    // exact source record id (truncated display) is present
    expect(screen.getByText(/shoot · shoot-12/)).toBeInTheDocument();
    // provenance is honestly labeled as live/tracked
    expect(screen.getAllByText(/Live · tracked/).length).toBeGreaterThan(0);
  });

  it("shows an honest not-connected state for the Weather category and no fabricated rows", async () => {
    window.location.hash = "#urgent-window?category=weather";
    render(<UrgentWindowPage token="t" currentUser={user} />);
    expect(await screen.findByText(/is not connected/i)).toBeInTheDocument();
    expect(screen.getByText(/No live weather provider/i)).toBeInTheDocument();
    expect(screen.queryByText("Edina Soccer needs a lead")).toBeNull();
  });

  it("carries the focused issue in the URL when a row is selected", async () => {
    render(<UrgentWindowPage token="t" currentUser={user} />);
    fireEvent.click(await screen.findByRole("button", { name: /Edina Soccer needs a lead/i }));
    expect(window.location.hash).toContain("focus=item-staffing");
  });

  it("is read-only when the user cannot manage exceptions", async () => {
    mockCanManage.mockReturnValue(false);
    window.location.hash = "#urgent-window?focus=item-staffing";
    render(<UrgentWindowPage token="t" currentUser={user} />);
    expect(await screen.findByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assign to me/i })).toBeNull();
  });
});
