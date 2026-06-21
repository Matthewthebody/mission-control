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

  it("edits the person (manager) via PATCH and reloads", async () => {
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if ((path ?? "").includes("/relationships")) return Promise.resolve({ identity: item({}), relationships: [] });
      if (method === "PATCH") return Promise.resolve({ contact: item({ phone: "555-1212" }) });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" canManage />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sam Rivera/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit person" }));
    fireEvent.change(screen.getByLabelText("Edit phone"), { target: { value: "555-1212" } });
    fireEvent.click(screen.getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/contact-identities/c1"),
        "t",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining("555-1212") })
      )
    );
  });

  it("links the contact to another organization (manager) via POST", async () => {
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if ((path ?? "").includes("/relationships")) return Promise.resolve({ identity: item({}), relationships: [] });
      if ((path ?? "").includes("/links") && method === "POST") return Promise.resolve({ organization_contact_id: "oc-new" });
      if ((path ?? "").includes("/api/organizations?") || (path ?? "").includes("search=")) return Promise.resolve({ organizations: [{ id: "org-x", display_name: "Eastview High", canonical_name: "eastview", account_type: "schools_underclass_portraits", active_status: "active", aliases: [], contact_count: 0, location_count: 0 }], search: { query: "east", total: 1 } });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" canManage />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sam Rivera/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Link to organization" }));
    fireEvent.change(screen.getByLabelText("Link organization search"), { target: { value: "east" } });
    fireEvent.click(await screen.findByRole("button", { name: "Eastview High" }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/contact-identities/c1/links"),
        "t",
        expect.objectContaining({ method: "POST", body: expect.stringContaining("org-x") })
      )
    );
  });

  it("edits one relationship's role (manager) via PATCH on the link, in isolation", async () => {
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if ((path ?? "").includes("/relationships")) {
        return Promise.resolve({ identity: item({}), relationships: [
          { organization_id: "d1", organization_name: "Maple District", organization_contact_id: "oc1", relationship_role: "general", client_roles: ["district_contact"], is_primary: true },
          { organization_id: "s1", organization_name: "Maple High", organization_contact_id: "oc2", relationship_role: "general", client_roles: ["picture_day_contact"], is_primary: false }
        ] });
      }
      if ((path ?? "").includes("/links/oc2") && method === "PATCH") return Promise.resolve({ updated: true });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" canManage />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sam Rivera/ }));
    await waitFor(() => expect(screen.getByText("Maple High")).toBeInTheDocument());
    // edit the School (2nd) relationship's role
    fireEvent.click(screen.getAllByRole("button", { name: "Edit role" })[1]);
    fireEvent.change(screen.getByLabelText("Edit relationship role"), { target: { value: "yearbook_contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/contact-identities/c1/links/oc2"),
        "t",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining("yearbook_contact") })
      )
    );
  });

  it("unlinks one relationship (manager) via the DELETE endpoint and keeps the other", async () => {
    let relCall = 0;
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if ((path ?? "").includes("/relationships")) {
        relCall += 1;
        // first load: two relationships; after unlink: only the District remains
        const rels = relCall === 1
          ? [
              { organization_id: "d1", organization_name: "Maple District", organization_contact_id: "oc1", relationship_role: "general", client_roles: ["district_contact"], is_primary: true },
              { organization_id: "s1", organization_name: "Maple High", organization_contact_id: "oc2", relationship_role: "general", client_roles: ["picture_day_contact"], is_primary: false }
            ]
          : [{ organization_id: "d1", organization_name: "Maple District", organization_contact_id: "oc1", relationship_role: "general", client_roles: ["district_contact"], is_primary: true }];
        return Promise.resolve({ identity: item({}), relationships: rels });
      }
      if (method === "DELETE") return Promise.resolve({ unlinked: true });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" canManage />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sam Rivera/ }));
    await waitFor(() => expect(screen.getByText("Maple High")).toBeInTheDocument());
    // unlink the School relationship (the 2nd Unlink button)
    fireEvent.click(screen.getAllByRole("button", { name: "Unlink" })[1]);
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/contact-identities/c1/links/oc2"),
        "t",
        expect.objectContaining({ method: "DELETE" })
      )
    );
    // after the reload the School is gone, the District remains
    await waitFor(() => expect(screen.queryByText("Maple High")).not.toBeInTheDocument());
    expect(screen.getByText("Maple District")).toBeInTheDocument();
  });

  it("archives a person (manager) via POST to /archive (soft, no hard delete)", async () => {
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if ((path ?? "").includes("/relationships")) return Promise.resolve({ identity: item({}), relationships: [] });
      if ((path ?? "").includes("/archive") && method === "POST") return Promise.resolve({ contact: item({ active_status: "inactive" }) });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" canManage />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sam Rivera/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive person" }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/contact-identities/c1/archive"),
        "t",
        expect.objectContaining({ method: "POST", body: expect.stringContaining("\"archived\":true") })
      )
    );
  });

  it("full-page focus mode renders the identity, and an archived identity is read-only with restore", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/relationships")) {
        return Promise.resolve({ identity: item({ active_status: "inactive" }), relationships: [
          { organization_id: "d1", organization_name: "Maple District", organization_contact_id: "oc1", relationship_role: "general", client_roles: ["district_contact"], is_primary: true }
        ] });
      }
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" canManage focusContactId="c1" />);
    await waitFor(() => expect(screen.getByText("Maple District")).toBeInTheDocument());
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    // mutation controls are hidden while archived; only restore is offered
    expect(screen.queryByRole("button", { name: "Edit person" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlink" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore person" })).toBeInTheDocument();
  });

  it("urlBacked Contacts mode exposes filters and an Open button that routes to the canonical Contact page", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    window.location.hash = "#directory/contacts?view=contacts";
    render(<CanonicalContactsPanel token="t" canManage urlBacked />);
    await waitFor(() => expect(screen.getByText(/Sam Rivera/)).toBeInTheDocument());
    expect(screen.getByLabelText("Filter by role")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open Sam Rivera full page/ }));
    expect(window.location.hash).toContain("directory/contacts/c1");
  });

  it("shows a loading state before the list resolves", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" />);
    // the first paint shows loading (initial state) before the effect's fetch microtask flushes
    expect(screen.getByText("Loading contacts…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No contacts match.")).toBeInTheDocument());
  });

  it("paginates the canonical list (Next requests the next page offset)", async () => {
    const page = Array.from({ length: 25 }, (_, i) => item({ id: `p${i}`, full_name: `Person ${i}` }));
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: page, total: 60 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" />);
    await waitFor(() => expect(screen.getByText("Person 0")).toBeInTheDocument());
    expect(screen.getByText(/1–25 of 60/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(apiFetchMock.mock.calls.some(([p]) => typeof p === "string" && p.includes("offset=25"))).toBe(true)
    );
  });

  it("urlBacked mode seeds filters from the URL and re-syncs on Back/Forward (hashchange)", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    window.location.hash = "#directory/contacts?view=contacts&cq=rivera";
    render(<CanonicalContactsPanel token="t" urlBacked />);
    await waitFor(() => expect((screen.getByLabelText("Search people") as HTMLInputElement).value).toBe("rivera"));
    // simulate Back/Forward to a different query
    window.location.hash = "#directory/contacts?view=contacts&cq=nelson";
    window.dispatchEvent(new Event("hashchange"));
    await waitFor(() => expect((screen.getByLabelText("Search people") as HTMLInputElement).value).toBe("nelson"));
  });

  it("exposes keyboard-focusable controls and reflects selection state (aria-expanded / aria-current)", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/relationships")) return Promise.resolve({ identity: item({}), relationships: [] });
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [item({})], total: 1 });
      return Promise.resolve({});
    });
    render(<CanonicalContactsPanel token="t" />);
    const row = await screen.findByRole("button", { name: /Sam Rivera/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    const searchInput = screen.getByLabelText("Search people");
    (searchInput as HTMLInputElement).focus();
    expect(searchInput).toHaveFocus();
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute("aria-expanded", "true"));
  });
});
