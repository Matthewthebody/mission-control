// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import type { SessionUser } from "../types";

// Role-aware Home AFTER the MC-AUDIT-003 fix: the rendered experience derives
// from the REAL session role. Leadership gets Company Command plus a clearly
// labeled preview switcher; everyone else lands on their LIVE My Work page.
// The localStorage persona key can never change what a real employee sees.
const apiFetchMock = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) };
});

const standardSessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
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
};

function buildUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: "user-1",
    tenantId: "tenant-demo",
    accountId: "account-1",
    sessionId: "session-1",
    email: "user@example.com",
    fullName: "Demo User",
    status: "active",
    department: "operations",
    isEmailVerified: true,
    authVersion: 1,
    roles: ["employee"],
    permissions: ["dashboard.read", "schedule.read", "notification.read"],
    authorityTier: "standard_employee",
    baseRole: "AssociatePhotographer",
    primaryJobFunctionProfile: "associate_photographer",
    jobFunctionProfiles: ["associate_photographer"],
    permissionGrants: [],
    effectiveScopes: ["self_only"],
    sessionTrust: standardSessionTrust,
    ...overrides
  };
}

const leadershipUser = buildUser({
  roles: ["leadership"],
  authorityTier: "leadership",
  baseRole: "Leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissions: ["dashboard.read", "shoot.read", "schedule.read", "user.read", "reports.read"],
  effectiveScopes: ["organization_wide_scope"]
});

const associateUser = buildUser({});

// One live urgent-watch item so the live Needs Attention panel has a real row.
const liveExceptionItem = {
  id: "watch-1",
  source_module: "scheduling",
  category: "staffing",
  type: "under_staffed",
  title: "Central High picture day is short one photographer",
  summary: "Coverage gap within 24 hours.",
  entity_type: "shoot",
  entity_id: "shoot-1",
  severity: "blocking",
  severity_label: "Blocking",
  scope_department: "schools",
  owner_label: "Carisa Lead",
  owner_user_id: "user-carisa",
  due_at: null,
  timing_label: "Today",
  status: "open",
  action_hash: "#operations/staffing",
  next_action_label: "Open staffing board"
};

function mockLiveEndpoints() {
  apiFetchMock.mockImplementation(async (path: unknown) => {
    const url = String(path);
    if (url.includes("/api/exceptions")) {
      return { items: [liveExceptionItem] };
    }
    if (url.includes("/api/jobs/status-counts")) {
      return { counts: { behind: 2 } };
    }
    if (url.includes("/api/production/operations")) {
      return { metrics: [{ key: "blocked", available: true, count: 1 }] };
    }
    // Everything else (the live My Work payload in these unit tests) is
    // unavailable — the page must degrade to its honest error state.
    throw new Error("not mocked");
  });
}

function renderHome(user: SessionUser) {
  return render(<Dashboard token="token" currentUser={user} socket={null} onOpenConcierge={vi.fn()} />);
}

function setPreviewSeat(roleId: string) {
  fireEvent.change(screen.getByLabelText("Preview seat"), { target: { value: roleId } });
}

const LOCKED_CARDS = [
  "On Fire",
  "Shoots Today",
  "Staffing Risk",
  "Late / Not Clocked In",
  "Jobs Behind",
  "Weather Watch",
  "Production Load",
  "Client Issues"
];

beforeEach(() => {
  apiFetchMock.mockReset();
  mockLiveEndpoints();
  window.localStorage.clear();
  window.location.hash = "#home";
});

afterEach(() => {
  cleanup();
});

describe("role-aware Home", () => {
  it("defaults leadership to Company Command with exactly the eight locked cards and labeled sample panels", async () => {
    renderHome(leadershipUser);
    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    for (const label of LOCKED_CARDS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: /Urgent Watch/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Operating Areas/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /People \/ Attendance Risk/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Weather Impact/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Reports$/i })).toBeInTheDocument();
    // Every panel without a live source is visibly labeled (honest contract).
    expect(screen.getAllByText("Sample data").length).toBeGreaterThanOrEqual(3);
    // Live backend calls only: the exception feed (On Fire + Needs Attention),
    // canonical job-status counts, and the canonical Production read model.
    const calledUrls = apiFetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("/api/exceptions"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/api/jobs/status-counts"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/api/production/operations"))).toBe(true);
    expect(calledUrls.every((url) => /exceptions|status-counts|production\/operations/.test(url))).toBe(true);
  });

  it("renders the LIVE exception feed in Urgent Watch — no fabricated incidents", async () => {
    renderHome(leadershipUser);
    expect(
      await screen.findByText("Central High picture day is short one photographer")
    ).toBeInTheDocument();
    // The Needs Attention panel itself carries only live rows — the fabricated
    // incident set (e.g. the infamous fake Edina Soccer clock-in) is gone from it.
    const panel = screen.getByLabelText("Company urgent watch");
    expect(panel.textContent).not.toMatch(/Edina Soccer/i);
    expect(panel.textContent).toContain("Central High picture day is short one photographer");
  });

  it("lands associates on their LIVE My Work page — no persona workspace, no preview switcher", () => {
    renderHome(associateUser);
    expect(screen.getByRole("heading", { name: "My Work" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company Command" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Preview seat")).not.toBeInTheDocument();
    expect(screen.queryByText("On Fire")).not.toBeInTheDocument();
  });

  it("ignores a stored persona for real associates — localStorage can never change what an employee sees", () => {
    window.localStorage.setItem("pmc-home-demo-role", "matthew");
    renderHome(associateUser);
    expect(screen.getByRole("heading", { name: "My Work" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company Command" })).not.toBeInTheDocument();
  });

  it("previewing an associate seat shows the leader's own LIVE My Work, clearly labeled as a preview", () => {
    renderHome(leadershipUser);
    setPreviewSeat("seasonal_photographer");
    expect(screen.getByRole("heading", { name: "My Workspace (Preview)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My Work" })).toBeInTheDocument();
    // The fabricated seasonal-assignment workspace is gone for good.
    expect(screen.queryByRole("heading", { name: /Today's Assignment/i })).not.toBeInTheDocument();
    expect(screen.queryByText("On Fire")).not.toBeInTheDocument();
  });

  it("Josh previews the sports seat as Company Command — the fabricated Sports Command Center is gone", () => {
    renderHome(leadershipUser);
    setPreviewSeat("josh");
    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sports Command Center" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Sports Pulse/i })).not.toBeInTheDocument();
  });

  it("emphasizes Schools for Jessica while keeping company issues visible", () => {
    renderHome(leadershipUser);
    setPreviewSeat("jessica");
    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    const emphasized = screen.getByText("Your area").closest(".home-pulse-card")?.textContent ?? "";
    expect(emphasized).toContain("Schools");
    expect(screen.getAllByText("Sports").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Production").length).toBeGreaterThan(0);
  });

  it("persists the previewed seat across remounts for leadership only", () => {
    const first = renderHome(leadershipUser);
    setPreviewSeat("jessica");
    first.unmount();
    renderHome(leadershipUser);
    const emphasized = screen.getByText("Your area").closest(".home-pulse-card")?.textContent ?? "";
    expect(emphasized).toContain("Schools");
  });
});
