import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationEditorForm } from "../components/directory/DirectoryActionForms";
import { CanonicalLocationSelector } from "../components/directory/CanonicalLocationSelector";

// Phase 4.2 Part 3 — the Create Organization form builds ONE atomic payload: organization +
// multiple Contact relationships (existing canonical identity or deferred inline) + multiple
// Location relationships (existing or inline) + brand + optional term. Inline records are deferred
// into the single transaction (no separate persistence), so a failure rolls everything back.

const apiFetchMock = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args), apiUrl: "http://localhost:4000" };
});

const CONTACT_ITEM = {
  id: "c-existing",
  first_name: "Dana",
  last_name: "Lopez",
  full_name: "Dana Lopez",
  display_name: null,
  email: "dana@school.example.com",
  phone: "555-0150",
  preferred_contact_method: null,
  active_status: "active",
  source: "manual",
  created_at: "x",
  updated_at: "x",
  linked_organization_count: 1,
  role_summary: []
};

const LOCATION_ITEM = {
  id: "loc-existing",
  organization_id: "org-z",
  location_name: "Shared Stadium",
  address_line_1: "500 Field Ave",
  address_line_2: null,
  city: "Plymouth",
  state: "MN",
  zip: "55446",
  address_display: "500 Field Ave, Plymouth, MN",
  maps_label: null,
  maps_url: null,
  active_status: "active",
  notes: null,
  created_at: "x",
  updated_at: "x",
  organization_display_name: "Other School",
  organization_account_type: "schools_underclass_portraits"
};

beforeEach(() => apiFetchMock.mockReset());

describe("OrganizationEditorForm — atomic create", () => {
  function renderForm(onSubmit = vi.fn()) {
    render(
      <OrganizationEditorForm
        token="t"
        submitLabel="Create organization"
        submitting={false}
        onUploadLogo={async () => "https://img/logo.png"}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />
    );
    return onSubmit;
  }

  it("renders the Contacts and Locations sections in create mode", () => {
    apiFetchMock.mockResolvedValue({ contacts: [], total: 0, locations: [] });
    renderForm();
    expect(screen.getByRole("group", { name: "Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Locations" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search canonical contacts")).toBeInTheDocument();
    expect(screen.getByLabelText("Search canonical locations")).toBeInTheDocument();
  });

  it("adds an existing contact + an inline location and submits ONE atomic payload with both", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [CONTACT_ITEM], total: 1 });
      if ((path ?? "").includes("/locations")) return Promise.resolve({ locations: [] });
      return Promise.resolve({});
    });
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText("Organization Name"), { target: { value: "Atomic Form School" } });

    // add an EXISTING contact via the shared selector
    fireEvent.change(screen.getByLabelText("Search canonical contacts"), { target: { value: "dana" } });
    fireEvent.click(await screen.findByRole("button", { name: /Dana Lopez/ }));
    // set a contextual role + mark primary
    fireEvent.change(await screen.findByLabelText("Role for Dana Lopez"), { target: { value: "district_contact" } });
    fireEvent.click(screen.getByLabelText("Primary contact Dana Lopez"));

    // add an INLINE location (deferred into the atomic payload)
    fireEvent.click(screen.getByRole("button", { name: "+ New location" }));
    fireEvent.change(screen.getByLabelText("New location name"), { target: { value: "Main Gym" } });
    fireEvent.change(screen.getByLabelText("New location address"), { target: { value: "1 Court St" } });
    fireEvent.change(screen.getByLabelText("New location notes"), { target: { value: "east gym, door 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    fireEvent.click(await screen.findByLabelText("Primary location Main Gym"));

    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [, context] = onSubmit.mock.calls[0];
    expect(context.contacts).toEqual([
      expect.objectContaining({ existing_contact_id: "c-existing", client_roles: ["district_contact"], is_primary: true })
    ]);
    expect(context.locations).toEqual([
      expect.objectContaining({ location_name: "Main Gym", address_line_1: "1 Court St", notes: "east gym, door 3", is_primary: true })
    ]);
    // the location was inline (no existing id) → created inside the transaction
    expect(context.locations[0].existing_location_id ?? null).toBeNull();
  });

  it("defers inline contact creation into the atomic payload (no immediate persistence)", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      if ((path ?? "").includes("/locations")) return Promise.resolve({ locations: [] });
      return Promise.resolve({});
    });
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("Organization Name"), { target: { value: "Inline Contact Org" } });

    fireEvent.click(screen.getByRole("button", { name: "+ New person" }));
    fireEvent.change(screen.getByLabelText("New contact first name"), { target: { value: "Inez" } });
    fireEvent.change(screen.getByLabelText("New contact last name"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: /Create & use/ }));

    // no POST to create the identity happened (deferred) — only the GET searches
    expect(apiFetchMock.mock.calls.every(([, , init]) => (init?.method ?? "GET") === "GET")).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [, context] = onSubmit.mock.calls[0];
    expect(context.contacts).toEqual([expect.objectContaining({ first_name: "Inez", last_name: "New" })]);
    expect(context.contacts[0].existing_contact_id ?? null).toBeNull();
  });

  it("removes a pending contact row before submission (form state preserved)", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/contact-identities")) return Promise.resolve({ contacts: [CONTACT_ITEM], total: 1 });
      return Promise.resolve({ locations: [] });
    });
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("Organization Name"), { target: { value: "Remove Row Org" } });
    fireEvent.change(screen.getByLabelText("Search canonical contacts"), { target: { value: "dana" } });
    fireEvent.click(await screen.findByRole("button", { name: /Dana Lopez/ }));
    expect(screen.getByLabelText("Role for Dana Lopez")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove contact Dana Lopez"));
    await waitFor(() => expect(screen.queryByLabelText("Role for Dana Lopez")).not.toBeInTheDocument());
    // the organization name the operator typed is still there (form state preserved)
    expect((screen.getByLabelText("Organization Name") as HTMLInputElement).value).toBe("Remove Row Org");
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][1].contacts).toEqual([]);
  });
});

describe("CanonicalLocationSelector", () => {
  it("searches existing locations and selecting one returns its canonical address (existing id)", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/locations")) return Promise.resolve({ locations: [LOCATION_ITEM] });
      return Promise.resolve({});
    });
    const onSelect = vi.fn();
    render(<CanonicalLocationSelector token="t" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Search canonical locations"), { target: { value: "stadium" } });
    fireEvent.click(await screen.findByRole("button", { name: /Shared Stadium/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ existing_location_id: "loc-existing", location_name: "Shared Stadium", address_line_1: "500 Field Ave" }));
  });

  it("warns on an exact normalized-address match while creating inline and offers the existing location", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if ((path ?? "").includes("/locations")) return Promise.resolve({ locations: [LOCATION_ITEM] });
      return Promise.resolve({});
    });
    const onSelect = vi.fn();
    render(<CanonicalLocationSelector token="t" onSelect={onSelect} />);
    // surface the existing location in results, then start an inline entry with the same address
    fireEvent.change(screen.getByLabelText("Search canonical locations"), { target: { value: "field" } });
    await screen.findByRole("button", { name: /Shared Stadium/ });
    fireEvent.click(screen.getByRole("button", { name: "+ New location" }));
    fireEvent.change(screen.getByLabelText("New location address"), { target: { value: "500 Field Ave" } });
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the existing location" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ existing_location_id: "loc-existing" }));
  });
});
