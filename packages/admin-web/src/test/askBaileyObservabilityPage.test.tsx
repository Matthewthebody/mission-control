import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRouteId } from "../navigation";
import { canAccessRoute } from "../permissions";
import AskBaileyObservability from "../pages/AskBaileyObservability";
import type { SessionUser } from "../types";

// Ask Bailey H7 — reviewer observability page: route wiring, gating, and the
// release-gate render.

const getObservability = vi.fn();
const getReleaseGate = vi.fn();
vi.mock("../services/askBaileyObservabilityApi", () => ({
  getObservability: (...a: unknown[]) => getObservability(...a),
  getReleaseGate: (...a: unknown[]) => getReleaseGate(...a)
}));

beforeEach(() => {
  vi.clearAllMocks();
  getObservability.mockResolvedValue({
    window_days: 30,
    provider_usage: [{ provider: "deterministic", status: "ok", events: 5, prompt_tokens: 0, completion_tokens: 0, est_cost_cents: 0, avg_latency_ms: 12 }],
    answer_states: [{ status: "supported", n: 4 }, { status: "no_approved_answer", n: 1 }],
    citations: { total: 9, invalid: 0 },
    unresolved_open: 2,
    training: { assignments: 3, readiness_attempts: 5, needs_review: 0 }
  });
  getReleaseGate.mockResolvedValue({
    generated_for_tenant: "t",
    overall: "pass",
    gates: [
      { id: "no_invalid_citation_ids", title: "Zero invalid citation IDs rendered", status: "pass", detail: "0 invalid." },
      { id: "regressions_and_typechecks", title: "Official regressions + typechecks green", status: "external", detail: "see report" }
    ]
  });
});

function user(tier: string): SessionUser {
  return { authorityTier: tier, roles: [], permissions: [], permissionGrants: [], effectiveScopes: [], jobFunctionProfiles: [] } as unknown as SessionUser;
}

describe("H7 observability route + gating", () => {
  it("resolves the reviewer observability route and gates it", () => {
    expect(resolveRouteId("#knowledge/observability", ["dashboard"] as never[], false)).toBe("ask-bailey-observability");
    expect(canAccessRoute(user("standard_employee"), "ask-bailey-observability")).toBe(false);
    expect(canAccessRoute(user("leadership"), "ask-bailey-observability")).toBe(true);
  });
});

describe("AskBaileyObservability page", () => {
  it("renders the release gate and telemetry", async () => {
    render(<AskBaileyObservability token="t" />);
    expect(await screen.findByText("Zero invalid citation IDs rendered")).toBeInTheDocument();
    expect(screen.getByText("Release gate")).toBeInTheDocument();
    expect(screen.getByText("Invalid citations: 0")).toBeInTheDocument();
    expect(screen.getByText(/supported: 4/)).toBeInTheDocument();
  });
});
