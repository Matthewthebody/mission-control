import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceTermsPanel } from "../components/directory/ServiceTermsPanel";
import type { SchoolServiceTermRecord } from "../types";

// Phase 4 Slice 4B — the service-term panel reads from and writes to the Slice 4 API.
// We mock apiFetch (the wrappers in organizationApi call it) and route by path + method.

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    apiUrl: "http://localhost:4000"
  };
});

function term(overrides: Partial<SchoolServiceTermRecord>): SchoolServiceTermRecord {
  return {
    id: overrides.id ?? "term-1",
    organization_id: "org-1",
    period_type: "school_year",
    period_label: "2025–2026",
    start_date: null,
    end_date: null,
    status: "current",
    confirmation_state: "confirmed",
    internal_owner_user_id: null,
    source: "manual",
    service_config: {},
    copied_from_term_id: null,
    inherited_field_keys: [],
    confirmed_by_user_id: null,
    confirmed_at: null,
    notes: null,
    created_at: "2025-08-01T00:00:00.000Z",
    updated_at: "2025-08-01T00:00:00.000Z",
    ...overrides
  };
}

const LIST = {
  service_terms: [
    term({ id: "current-term", period_label: "2025–2026", status: "current", confirmation_state: "confirmed" }),
    term({
      id: "draft-term",
      period_label: "2026–2027",
      status: "draft",
      confirmation_state: "unconfirmed",
      copied_from_term_id: "current-term",
      inherited_field_keys: ["package_tier", "retake_policy"]
    }),
    term({ id: "closed-term", period_label: "2024–2025", status: "closed", confirmation_state: "confirmed" })
  ]
};

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((path: string, _token?: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (path.endsWith("/service-terms") && method === "GET") {
      return Promise.resolve(LIST);
    }
    if (path.includes("/rollover")) {
      return Promise.resolve({ service_term: LIST.service_terms[1] });
    }
    if (path.includes("/activate")) {
      return Promise.resolve({ service_term: LIST.service_terms[0] });
    }
    if (path.endsWith("/service-terms") && method === "POST") {
      return Promise.resolve({ service_term: LIST.service_terms[0] });
    }
    if (method === "PATCH") {
      return Promise.resolve({ service_term: LIST.service_terms[1] });
    }
    return Promise.resolve(LIST);
  });
});

describe("ServiceTermsPanel", () => {
  it("groups current / upcoming drafts / history and flags inherited unconfirmed drafts", async () => {
    render(<ServiceTermsPanel token="t" organizationId="org-1" organizationName="Demo High" canManage />);

    await waitFor(() => expect(screen.getByText("Upcoming drafts")).toBeInTheDocument());
    // "Current" appears as both a group label and a status pill, so assert it is present at least once.
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getByText("History")).toBeInTheDocument();

    // the rolled-over draft is marked Needs review and shows the inherited field keys
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText(/Inherited from the prior term: package_tier, retake_policy/)).toBeInTheDocument();
  });

  it("offers manage actions for managers and rolls a term over to a new draft", async () => {
    render(<ServiceTermsPanel token="t" organizationId="org-1" organizationName="Demo High" canManage />);
    await waitFor(() => expect(screen.getByText("Upcoming drafts")).toBeInTheDocument());

    // open the roll-over inline form on the current term and submit a label
    const rolloverButtons = screen.getAllByRole("button", { name: "Roll over to next" });
    fireEvent.click(rolloverButtons[0]);
    const labelInput = screen.getByLabelText("New period label");
    fireEvent.change(labelInput, { target: { value: "2027–2028" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/service-terms/current-term/rollover"),
        "t",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

  it("confirms an unconfirmed draft via the API", async () => {
    render(<ServiceTermsPanel token="t" organizationId="org-1" organizationName="Demo High" canManage />);
    await waitFor(() => expect(screen.getByText("Upcoming drafts")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed" }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/service-terms/draft-term"),
        "t",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining("\"confirm\":true") })
      )
    );
  });

  it("hides manage actions when the user cannot manage the school foundation", async () => {
    render(<ServiceTermsPanel token="t" organizationId="org-1" organizationName="Demo High" canManage={false} />);
    await waitFor(() => expect(screen.getByText("Upcoming drafts")).toBeInTheDocument());

    expect(screen.getByText("Read-only service terms")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add term" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Roll over to next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make current" })).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no terms", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve({ service_terms: [] }));
    render(<ServiceTermsPanel token="t" organizationId="org-1" organizationName="Demo High" canManage />);
    await waitFor(() => expect(screen.getByText(/No service terms yet/)).toBeInTheDocument());
  });
});
