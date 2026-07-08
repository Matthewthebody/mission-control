// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolsLeadershipOperations } from "../pages/SchoolsLeadershipOperations";
import type {
  LeadershipIssue,
  SchoolsLeadershipOperations as OperationsPayload
} from "../services/schoolsLeadershipOperationsApi";

const getSchoolsLeadershipOperationsMock = vi.fn();
vi.mock("../services/schoolsLeadershipOperationsApi", async () => {
  const actual = await vi.importActual<typeof import("../services/schoolsLeadershipOperationsApi")>(
    "../services/schoolsLeadershipOperationsApi"
  );
  return { ...actual, getSchoolsLeadershipOperations: (...args: unknown[]) => getSchoolsLeadershipOperationsMock(...args) };
});

function issue(overrides: Partial<LeadershipIssue> = {}): LeadershipIssue {
  return {
    issue_id: "shoots_today:s1",
    section: "current_season",
    category: "shoots_today",
    source_type: "shoot",
    source_id: "s1",
    district_id: "d1",
    district_name: "Wayzata Public Schools",
    school_id: "sc1",
    school_name: "Wayzata High School",
    owner_user_id: "u1",
    owner_name: "Jess Brown",
    internal_owner: "Jess Brown",
    reason: "Confirmed shoot today (on_track)",
    severity: "critical",
    status: "on_track",
    date_deadline: "2026-07-08",
    time_state: "today",
    exact_destination_hash: "#schools/jobs/detail?job=s1",
    focus_reason: "Open the confirmed job to verify readiness.",
    can_act: true,
    primary_action: "open_job",
    source_availability: "live",
    provenance: "shoot(record_state=published)",
    ...overrides
  };
}

function payload(scope: "all" | "own" = "all"): OperationsPayload {
  return {
    generated_at: "2026-07-08T00:00:00.000Z",
    scope,
    sections: {
      current_season: [
        // available WITH issues, actionable (can_act true + primary_action)
        { category: "shoots_today", section: "current_season", available: true, count: 1, issues: [issue()] },
        // available but EMPTY — must render a calm empty state, not disappear
        { category: "shoots_this_week", section: "current_season", available: true, count: 0, issues: [] },
        // available WITH an issue that has NO owner and is NOT actionable (can_act false)
        {
          category: "missing_current_service_term",
          section: "current_season",
          available: true,
          count: 1,
          issues: [
            issue({
              issue_id: "missing_current_service_term:sc2",
              category: "missing_current_service_term",
              source_type: "organization",
              source_id: "sc2",
              school_name: "Blake School",
              district_name: "Blake District",
              owner_user_id: null,
              owner_name: null,
              internal_owner: null,
              reason: "No current service term is set for this School.",
              severity: "warning",
              status: "missing",
              date_deadline: null,
              time_state: "none",
              exact_destination_hash: "#directory/organizations/sc2?tab=profile",
              can_act: false,
              primary_action: null
            })
          ]
        },
        // UNAVAILABLE by design — must render "Not connected yet" + reason, never a zero
        {
          category: "schedule_change_requests",
          section: "current_season",
          available: false,
          count: null,
          reason: "No canonical schedule-change-request source is connected."
        }
      ],
      building_next_season: [
        {
          category: "next_season_ownership_gap",
          section: "building_next_season",
          available: true,
          count: 1,
          issues: [
            issue({
              issue_id: "next_season_ownership_gap:sc9",
              section: "building_next_season",
              category: "next_season_ownership_gap",
              source_type: "organization",
              source_id: "sc9",
              school_name: "Edina Elementary",
              district_name: "Edina Public Schools",
              owner_user_id: null,
              owner_name: null,
              internal_owner: null,
              reason: "No internal/CSR owner assigned for next-season planning.",
              severity: "warning",
              status: "ownership_gap",
              date_deadline: null,
              time_state: "none",
              exact_destination_hash: "#directory/organizations/sc9?tab=profile",
              can_act: true,
              primary_action: "assign_owner"
            })
          ]
        },
        {
          category: "rebooking_state",
          section: "building_next_season",
          available: false,
          count: null,
          reason: "No canonical rebooking/next-season transaction source is connected."
        }
      ]
    }
  };
}

function rowFor(schoolName: string): HTMLElement {
  const cell = screen.getByText(schoolName);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${schoolName}`);
  return row as HTMLElement;
}

beforeEach(() => {
  getSchoolsLeadershipOperationsMock.mockReset();
  getSchoolsLeadershipOperationsMock.mockResolvedValue(payload());
});

afterEach(() => {
  cleanup();
});

describe("SchoolsLeadershipOperations", () => {
  it("renders both season sections", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    expect(await screen.findByText("Current season")).toBeInTheDocument();
    expect(screen.getByText("Building next season")).toBeInTheDocument();
  });

  it("renders an available category with its issue rows", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    const row = await screen.findByText("Wayzata High School").then(() => rowFor("Wayzata High School"));
    expect(within(row).getByText("Wayzata Public Schools")).toBeInTheDocument();
    expect(within(row).getByText("Confirmed shoot today (on_track)")).toBeInTheDocument();
    expect(within(row).getByText("Jess Brown")).toBeInTheDocument();
  });

  it("renders a calm empty state for an available category with no issues", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    // the empty category header is still present (not hidden), with its own calm empty state
    expect(await screen.findByText("Shoots this week")).toBeInTheDocument();
    expect(screen.getByText("All clear — nothing needs attention here.")).toBeInTheDocument();
  });

  it("renders an unavailable category as 'Not connected yet' with the reason — never a zero", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    expect(await screen.findByText("Schedule-change requests")).toBeInTheDocument();
    // both unavailable categories carry the honest not-connected treatment
    expect(screen.getAllByText("Not connected yet").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("No canonical schedule-change-request source is connected.")).toBeInTheDocument();
  });

  it("shows severity for an issue row", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    const row = await screen.findByText("Wayzata High School").then(() => rowFor("Wayzata High School"));
    expect(within(row).getByText("Critical")).toBeInTheDocument();
  });

  it("makes the ownership gap visible when owner_name is null", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    const row = await screen.findByText("Blake School").then(() => rowFor("Blake School"));
    expect(within(row).getByText("Unowned")).toBeInTheDocument();
  });

  it("does not present the primary action as clickable when can_act is false", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    const row = await screen.findByText("Blake School").then(() => rowFor("Blake School"));
    // no action verb offered; only a plain Open deep-link to the record
    expect(within(row).queryByRole("link", { name: /service term/i })).not.toBeInTheDocument();
    const open = within(row).getByRole("link", { name: "Open" });
    expect(open).toHaveAttribute("href", "#directory/organizations/sc2?tab=profile");
  });

  it("renders the primary action as a deep-link when can_act is true", async () => {
    render(<SchoolsLeadershipOperations token="t" />);
    const wayzata = await screen.findByText("Wayzata High School").then(() => rowFor("Wayzata High School"));
    expect(within(wayzata).getByRole("link", { name: "Open job" })).toHaveAttribute(
      "href",
      "#schools/jobs/detail?job=s1"
    );
    const edina = rowFor("Edina Elementary");
    expect(within(edina).getByRole("link", { name: "Assign owner" })).toHaveAttribute(
      "href",
      "#directory/organizations/sc9?tab=profile"
    );
  });

  it("shows the scope badge from the server payload", async () => {
    getSchoolsLeadershipOperationsMock.mockResolvedValue(payload("own"));
    render(<SchoolsLeadershipOperations token="t" />);
    expect(await screen.findByText("My schools")).toBeInTheDocument();
  });

  it("shows an honest error with retry when the load fails", async () => {
    getSchoolsLeadershipOperationsMock.mockRejectedValueOnce(new Error("boom"));
    render(<SchoolsLeadershipOperations token="t" />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
