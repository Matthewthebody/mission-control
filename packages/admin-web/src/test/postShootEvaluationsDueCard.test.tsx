// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostShootEvaluationsDueCard } from "../components/PostShootEvaluationsDueCard";
import type { EvaluationObligationsPayload } from "../services/postShootApi";

const getEvaluationObligationsMock = vi.fn();
vi.mock("../services/postShootApi", async () => {
  const actual = await vi.importActual<typeof import("../services/postShootApi")>("../services/postShootApi");
  return { ...actual, getEvaluationObligations: (...args: unknown[]) => getEvaluationObligationsMock(...args) };
});

function payload(outstanding: number, scope: "own" | "team" = "own"): EvaluationObligationsPayload {
  const items = Array.from({ length: outstanding }, (_, i) => ({
    obligation_id: `sh${i}:emp`,
    shift_id: `sh${i}`,
    shoot_id: `shoot${i}`,
    shoot_title: `Fixture Shoot ${i}`,
    shoot_code: null,
    shoot_date: "2026-07-01",
    employee_id: "emp",
    employee_name: "Me",
    role_on_shoot: "photographer",
    is_lead: i === 0,
    template_type: (i === 0 ? "lead_10_question" : "standard") as "lead_10_question" | "standard",
    status: "required" as const,
    blocks_mileage: true,
    exact_destination_hash: "#operations/staffing?shoot=x",
    focus_reason: "due"
  }));
  return {
    as_of: "2026-07-08T00:00:00.000Z",
    scope,
    summary: {
      total_obligations: outstanding,
      submitted_count: 0,
      outstanding_count: outstanding,
      outstanding_lead_count: items.filter((item) => item.is_lead).length,
      mileage_blocked_photographer_count: outstanding ? 1 : 0,
      shoots_covered: outstanding
    },
    items_total: outstanding,
    items_shown: outstanding,
    items
  };
}

beforeEach(() => {
  getEvaluationObligationsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PostShootEvaluationsDueCard", () => {
  it("renders outstanding evaluations with honest mileage copy and true-total disclosure", async () => {
    getEvaluationObligationsMock.mockResolvedValue(payload(5));
    render(<PostShootEvaluationsDueCard token="t" />);
    expect(await screen.findByText("Post-shoot evaluations due")).toBeInTheDocument();
    expect(screen.getByText(/5 shoots still need your post-shoot evaluation/)).toBeInTheDocument();
    expect(screen.getByText(/Mileage reimbursement stays blocked/)).toBeInTheDocument();
    // capped list with true total
    expect(screen.getByText(/Fixture Shoot 0 — 2026-07-01 \(lead evaluation\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Fixture Shoot 3/)).not.toBeInTheDocument();
    expect(screen.getByText("Showing the first 3 of 5.")).toBeInTheDocument();
    // no fake action: admin-web has no eval form, so the card says where to complete it instead
    expect(screen.getByText(/shift closeout on mobile/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no outstanding obligations (quiet empty state)", async () => {
    getEvaluationObligationsMock.mockResolvedValue(payload(0));
    const { container } = render(<PostShootEvaluationsDueCard token="t" />);
    await waitFor(() => expect(getEvaluationObligationsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a team-scoped (manager) response — never shows team obligations here", async () => {
    getEvaluationObligationsMock.mockResolvedValue(payload(4, "team"));
    const { container } = render(<PostShootEvaluationsDueCard token="t" />);
    await waitFor(() => expect(getEvaluationObligationsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent on fetch failure", async () => {
    getEvaluationObligationsMock.mockRejectedValue(new Error("boom"));
    const { container } = render(<PostShootEvaluationsDueCard token="t" />);
    await waitFor(() => expect(getEvaluationObligationsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
