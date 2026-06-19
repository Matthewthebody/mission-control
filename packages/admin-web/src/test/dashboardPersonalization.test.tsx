// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../pages/Dashboard";
import type { SessionUser } from "../types";

// The role-aware Home is demo-data-driven EXCEPT the live "On Fire" count, which
// fetches the unresolved total from the canonical /api/exceptions source. The mock
// proves the Company Command Home makes exactly that one backend call and no more.
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

function renderHome(user: SessionUser) {
  return render(<Dashboard token="token" currentUser={user} socket={null} onOpenConcierge={vi.fn()} />);
}

function setRole(roleId: string) {
  fireEvent.change(screen.getByLabelText("Viewing as"), { target: { value: roleId } });
}

function emphasizedCardText(): string {
  return screen.getByText("Your area").closest(".home-pulse-card")?.textContent ?? "";
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
  window.localStorage.clear();
  window.location.hash = "#home";
});

afterEach(() => {
  cleanup();
});

describe("role-aware Home", () => {
  it("defaults leadership to Company Command with exactly the eight locked cards", () => {
    renderHome(leadershipUser);
    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    for (const label of LOCKED_CARDS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: /Needs Attention/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Operating Areas/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /People \/ Attendance Risk/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Weather Impact/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Reports$/i })).toBeInTheDocument();
    // Exactly one backend call — the live On Fire unresolved count — and nothing else.
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(String(apiFetchMock.mock.calls[0]?.[0])).toContain("/api/exceptions");
  });

  it("defaults associates to My Workspace, not Company Command", () => {
    renderHome(associateUser);
    expect(screen.getByRole("heading", { name: "My Workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company Command" })).not.toBeInTheDocument();
  });

  it("switches to the seasonal photographer workspace and hides every company surface", () => {
    renderHome(leadershipUser);
    setRole("seasonal_photographer");
    expect(screen.getByRole("heading", { name: "My Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Today's Assignment/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company Command" })).not.toBeInTheDocument();
    expect(screen.queryByText("On Fire")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Reports$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /People \/ Attendance Risk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Needs Attention/i })).not.toBeInTheDocument();
  });

  it("emphasizes Schools for Jessica while keeping company issues visible", () => {
    renderHome(leadershipUser);
    setRole("jessica");
    expect(screen.getByRole("heading", { name: "Company Command" })).toBeInTheDocument();
    expect(emphasizedCardText()).toContain("Schools");
    expect(screen.getAllByText("Sports").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Production").length).toBeGreaterThan(0);
  });

  it("renders the Sports Command Center for Josh", () => {
    renderHome(leadershipUser);
    setRole("josh");
    expect(screen.getByRole("heading", { name: "Sports Command Center" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Sports Pulse/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Current Season/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Building Next Season/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Specialty Product Tracker/i })).toBeInTheDocument();
    // Josh gets the sports command center, not the generic company command strip
    expect(screen.queryByText("On Fire")).not.toBeInTheDocument();
  });

  it("renders Sam's task workspace without company KPIs or the sports pulse", () => {
    renderHome(leadershipUser);
    setRole("sam");
    expect(screen.getByRole("heading", { name: "My Sports Work" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /My Groups/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /My Next Actions/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Waiting On/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Sports Pulse/i })).not.toBeInTheDocument();
    expect(screen.queryByText("On Fire")).not.toBeInTheDocument();
  });

  it("emphasizes Photography / Staffing for Carisa", () => {
    renderHome(leadershipUser);
    setRole("carisa");
    expect(emphasizedCardText()).toContain("Photography");
  });

  it("emphasizes Production for Spencer", () => {
    renderHome(leadershipUser);
    setRole("spencer");
    expect(emphasizedCardText()).toContain("Production");
  });

  it("shows the Client Success queue for the CSR with no company surfaces", () => {
    renderHome(leadershipUser);
    setRole("csr");
    expect(screen.getByRole("heading", { name: "My Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Client Success Queue/i })).toBeInTheDocument();
    expect(screen.queryByText("On Fire")).not.toBeInTheDocument();
  });

  it("shows the production queue for the graphic artist", () => {
    renderHome(leadershipUser);
    setRole("graphic_artist");
    expect(screen.getByRole("heading", { name: /My Production Queue/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company Command" })).not.toBeInTheDocument();
  });

  it("persists the previewed role across remounts", () => {
    const first = renderHome(leadershipUser);
    setRole("seasonal_photographer");
    expect(screen.getByRole("heading", { name: "My Workspace" })).toBeInTheDocument();
    first.unmount();
    renderHome(leadershipUser);
    expect(screen.getByRole("heading", { name: "My Workspace" })).toBeInTheDocument();
  });
});
