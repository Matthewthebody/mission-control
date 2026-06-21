import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogoHistoryPanel } from "../components/directory/LogoHistoryPanel";
import type { OrganizationLogoHistoryEntry } from "../types";

// Phase 4.1 — logo history + restore over the migration-162 backend.

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    apiUrl: "http://localhost:4000"
  };
});

function entry(overrides: Partial<OrganizationLogoHistoryEntry>): OrganizationLogoHistoryEntry {
  return {
    id: "h1",
    logo_url: "https://cdn.example.com/a.png",
    source: "upload",
    status: "current",
    note: null,
    set_by_user_id: "u1",
    set_by_user_name: "Jordan Lee",
    created_at: "2026-06-01T12:00:00.000Z",
    ...overrides
  };
}

const HISTORY = {
  logo_history: [
    entry({ id: "current", source: "upload", set_by_user_name: "Jordan Lee" }),
    entry({ id: "older", source: "restore", logo_url: "https://cdn.example.com/old.png", status: "outdated", note: "Reverted to the spring athletic mark", set_by_user_name: "Sam Rivera" })
  ]
};

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
    if (path.includes("/logo-restore")) {
      return Promise.resolve({ logo_history: [entry({ id: "older", source: "restore" }), ...HISTORY.logo_history] });
    }
    return Promise.resolve(HISTORY);
  });
});

describe("LogoHistoryPanel", () => {
  it("shows the current logo and prior history with actor + source", async () => {
    render(<LogoHistoryPanel token="t" organizationId="org-1" organizationName="Demo High" currentLogoUrl="https://cdn.example.com/a.png" canManage />);
    await waitFor(() => expect(screen.getByText("Current logo")).toBeInTheDocument());
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByText(/Jordan Lee/)).toBeInTheDocument();
    expect(screen.getByText("Restored from history")).toBeInTheDocument();
    expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument();
  });

  it("restores a prior logo via the endpoint (manager)", async () => {
    render(<LogoHistoryPanel token="t" organizationId="org-1" organizationName="Demo High" currentLogoUrl="https://cdn.example.com/a.png" canManage />);
    await waitFor(() => expect(screen.getByText("Current logo")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/org-1/logo-restore"),
        "t",
        expect.objectContaining({ method: "POST", body: expect.stringContaining("older") })
      )
    );
  });

  it("hides Restore for non-managers and shows read-only", async () => {
    render(<LogoHistoryPanel token="t" organizationId="org-1" organizationName="Demo High" currentLogoUrl={null} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Current logo")).toBeInTheDocument());
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("shows an empty state when there is no history", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve({ logo_history: [] }));
    render(<LogoHistoryPanel token="t" organizationId="org-1" organizationName="Demo High" currentLogoUrl={null} canManage />);
    await waitFor(() => expect(screen.getByText("No logo history recorded yet.")).toBeInTheDocument());
  });
});
