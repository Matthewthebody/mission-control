import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Profitability } from "../pages/Profitability";
import type { ProfitabilityWorkspaceResponse } from "../services/profitability";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiUrl: "http://localhost:4000"
}));

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["dashboard.read", "profitability.read"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
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
  }
};

const workspace: ProfitabilityWorkspaceResponse = {
  generated_at: "2026-03-29T14:00:00.000Z",
  anchor_date: "2026-03-29",
  filters: {
    date_from: "2026-03-01",
    date_to: "2026-04-30",
    department: null,
    focus: "watch"
  },
  headline: {
    title: "Profitability",
    summary_line: "2 watch items need leadership review across upcoming shoots and production delay pressure.",
    tone: "action_needed"
  },
  overview_cards: [
    {
      id: "watch_items",
      label: "Watch Items",
      value: 2,
      detail: "Shoots or calculated profitability flags that need leadership review.",
      tone: "action_needed",
      action_hash: "#business-health/profitability?focus=watch&date_from=2026-03-01&date_to=2026-04-30"
    },
    {
      id: "production_burden",
      label: "Overdue Production",
      value: 1,
      detail: "Post-shoot production work already behind or still missing a release path.",
      tone: "action_needed",
      action_hash: "#production?queue=at_risk_queue&due_state=overdue"
    },
    {
      id: "qa_rework_burden",
      label: "QA / Rework",
      value: 1,
      detail: "Changes requested and review pressure affecting delivery confidence.",
      tone: "heads_up",
      action_hash: "#production?queue=at_risk_queue"
    },
    {
      id: "labor_variance_today",
      label: "Labor Variance Today",
      value: "1.5h",
      detail: "Actual labor above scheduled plan for today.",
      tone: "heads_up",
      action_hash: "#business-health/labor"
    },
    {
      id: "data_health_issues",
      label: "Data Health",
      value: 0,
      detail: "Unresolved import issues that can weaken imported profitability confidence.",
      tone: "good",
      action_hash: "#business-health/profitability?focus=data_health&date_from=2026-03-01&date_to=2026-04-30"
    }
  ],
  watch_items: [
    {
      id: "shoot:shoot-2",
      kind: "shoot_watch",
      title: "Friday Night Lights Media Day",
      summary: "Travel crew and setup complexity make this shoot worth a profitability watch.",
      tone: "action_needed",
      status_label: "Watch",
      driver_label: "DEMO-002",
      context_label: "Sports | Friday Night Lights Media Day | 2026-03-31",
      workspace_hash: "#business-health/profitability?focus=watch&date_from=2026-03-01&date_to=2026-04-30",
      action_hash: "#operations/shoots?shoot=shoot-2"
    }
  ],
  operational_burden: {
    summary_line: "Production delays and review queues are the clearest current profitability drag.",
    rows: [
      {
        id: "production_overdue",
      label: "Overdue Production",
        value: "1",
        detail: "Post-shoot production work already overdue is a direct profitability drag.",
        tone: "action_needed",
        action_hash: "#production?queue=at_risk_queue&due_state=overdue"
      }
    ]
  },
  breakdowns: {
    by_department: [
      {
        id: "sports",
        label: "Sports",
        watch_count: 1,
        production_count: 1,
        detail: "1 shoot in window | 1 watch flag",
        tone: "heads_up",
        action_hash: "#business-health/profitability?date_from=2026-03-01&date_to=2026-04-30&department=sports"
      }
    ],
    by_shoot_type: [
      {
        id: "sports",
        label: "Sports",
        watch_count: 1,
        production_count: 1,
        detail: "1 shoot in window | 1 linked production item",
        tone: "heads_up",
        action_hash: "#business-health/profitability?date_from=2026-03-01&date_to=2026-04-30"
      }
    ]
  },
  data_health: {
    summary_line: "Fresh operational watch signals are available even though imported profitability detail is still sparse.",
    cards: [
      {
        id: "latest_import_status",
        label: "Latest Import",
        value: "None Yet",
        detail: "No profitability import runs have been recorded yet.",
        tone: "heads_up"
      }
    ],
    latest_import: null
  }
};

describe("Profitability", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.history.replaceState(null, "", "#business-health/profitability?focus=watch&date_from=2026-03-01&date_to=2026-04-30");
  });

  it("renders the leadership workspace and deep-links into watch and production drivers", async () => {
    apiFetchMock.mockResolvedValue(workspace);

    render(<Profitability token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Profitability")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText(/leadership view of profitability watch signals/i)).toBeInTheDocument();
    expect(screen.getByText("Watch List (1)")).toBeInTheDocument();
    expect(screen.getByText("Friday Night Lights Media Day")).toBeInTheDocument();
    expect(screen.getByText("Operational Burden")).toBeInTheDocument();
    expect(screen.getByText("By Department")).toBeInTheDocument();
    expect(screen.getAllByText("Data Health").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Overdue Production/i })[0]);
    expect(window.location.hash).toBe("#production?queue=at_risk_queue&due_state=overdue");

    fireEvent.click(screen.getByRole("button", { name: /Friday Night Lights Media Day/i }));
    expect(window.location.hash).toBe("#operations/shoots?shoot=shoot-2");
  });

  it("sends filter changes back through the profitability workspace contract", async () => {
    apiFetchMock.mockResolvedValue(workspace);

    render(<Profitability token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Profitability")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "production" } });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/profitability/workspace?"),
        "token"
      );
      expect(
        apiFetchMock.mock.calls.some(
          ([path]) => String(path).includes("department=production")
        )
      ).toBe(true);
    });

    expect(window.location.hash).toContain("department=production");
  });
});
