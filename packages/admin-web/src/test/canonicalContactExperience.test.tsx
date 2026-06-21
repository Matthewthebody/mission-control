import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalContactSelector } from "../components/directory/CanonicalContactSelector";
import { CanonicalContactsPanel } from "../components/directory/CanonicalContactsPanel";
import type { CanonicalContactListItem } from "../types";

// Phase 4.2 Part 2 — reusable canonical contact identity experience.

const apiFetchMock = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args), apiUrl: "http://localhost:4000" };
});

function item(over: Partial<CanonicalContactListItem>): CanonicalContactListItem {
  return {
    id: "c1",
    first_name: "Sam",
    last_name: "Rivera",
    full_name: "Sam Rivera",
    display_name: null,
    email: "sam@example.com",
    phone: "555-0100",
    preferred_contact_method: null,
    active_status: "active",
    source: "manual",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    linked_organization_count: 2,
    role_summary: ["district_contact"],
    ...over
  };
}

beforeEach(() => apiFetchMock.mockReset());

describe("CanonicalContactSelector", () => {
  it("searches canonical identities and selecting one returns the canonical record", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({}), item({ id: "c2", full_name: "Avery Nelson", email: "avery@example.com", linked_organization_count: 1 })], total: 2 });
      return Promise.resolve({});
    });
    const onSelect = vi.fn();
    render(<CanonicalContactSelector token="t" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Search canonical contacts"), { target: { value: "rivera" } });
    await waitFor(() => expect(screen.getByText("Sam Rivera")).toBeInTheDocument());
    expect(screen.getByText(/2 orgs/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sam Rivera"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("warns when a contact is already linked to the organization in context", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("organization_id=org-1")) return Promise.resolve({ contacts: [item({ id: "c1" })], total: 1 });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({ id: "c1" })], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactSelector token="t" organizationId="org-1" onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search canonical contacts"), { target: { value: "sam" } });
    await waitFor(() => expect(screen.getByText("Already linked here")).toBeInTheDocument());
  });

  it("creates a new identity inline and selects it (no reduced second form)", async () => {
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      if ((path ?? "").endsWith("/contact-identities") && (init?.method ?? "GET") === "POST") {
        return Promise.resolve({ contact: { id: "new-1", first_name: "New", last_name: "Person", full_name: "New Person", email: "new@example.com", display_name: null, phone: null, preferred_contact_method: null, active_status: "active", source: "manual", created_at: "x", updated_at: "x" } });
      }
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      return Promise.resolve({});
    });
    const onSelect = vi.fn();
    render(<CanonicalContactSelector token="t" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New person" }));
    fireEvent.change(screen.getByLabelText("New contact first name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("New contact last name"), { target: { value: "Person" } });
    fireEvent.click(screen.getByRole("button", { name: /Create & use/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "new-1" })));
  });
});

describe("CanonicalContactsPanel", () => {
  it("lists canonical identities with linked-org count and expands to show relationships", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/relationships")) {
        return Promise.resolve({ identity: item({}), relationships: [
          { organization_id: "d1", organization_name: "Maple District", organization_contact_id: "oc1", relationship_role: "general", client_roles: ["district_contact"], is_primary: true },
          { organization_id: "s1", organization_name: "Maple High", organization_contact_id: "oc2", relationship_role: "general", client_roles: ["picture_day_contact"], is_primary: false }
        ] });
      }
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    expect(screen.getByText(/1 person/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sam Rivera/ }));
    await waitFor(() => expect(screen.getByText("Maple District")).toBeInTheDocument());
    expect(screen.getByText("Maple High")).toBeInTheDocument(); // same person, two orgs (cross-org rollup)
  });

  it("shows an empty state when no contacts match", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve({ contacts: [], total: 0 }));
    render(<CanonicalContactsPanel token="t" />);
    await waitFor(() => expect(screen.getByText("No contacts match.")).toBeInTheDocument());
  });
});
