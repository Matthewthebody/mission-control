import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRouteId } from "../navigation";
import { DirectoryRecordDetailPage } from "../pages/DirectoryRecordDetailPage";
import type { SessionUser } from "../types";

// Phase 4.2 — stable full-page canonical detail routes: resolution + page states.

const ALL_TABS = [
  "dashboard",
  "schedule",
  "organizations",
  "contacts",
  "locations",
  "jobs",
  "shoots"
] as any;

describe("directory detail route resolution", () => {
  it("resolves #directory/<entity>/<id> to the full-page detail routes, and bare list hashes to the list", () => {
    expect(resolveRouteId("#directory/organizations/org-123", ALL_TABS, false)).toBe("directory-organization-detail");
    expect(resolveRouteId("#accounts/org-123", ALL_TABS, false)).toBe("directory-organization-detail");
    expect(resolveRouteId("#directory/contacts/contact-9", ALL_TABS, false)).toBe("directory-contact-detail");
    expect(resolveRouteId("#directory/locations/loc-4", ALL_TABS, false)).toBe("directory-location-detail");
    // bare list hashes are NOT detail routes
    expect(resolveRouteId("#accounts", ALL_TABS, false)).not.toBe("directory-organization-detail");
    expect(resolveRouteId("#directory/contacts", ALL_TABS, false)).not.toBe("directory-contact-detail");
    expect(resolveRouteId("#directory/locations", ALL_TABS, false)).not.toBe("directory-location-detail");
  });
});

const apiFetchMock = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args), apiUrl: "http://localhost:4000" };
});

const USER: SessionUser = {
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
  permissions: ["dashboard.read", "shoot.read", "schedule.read"],
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
} as SessionUser;

function setHash(hash: string) {
  window.location.hash = hash;
}

const ORG_DETAIL = {
  organization: { id: "org-1", canonical_name: "Wayzata High", display_name: "Wayzata High School", account_type: "schools_underclass_portraits", active_status: "active", aliases: [], client_entity_kind: "account", parent_organization_id: "d1", parent_organization_name: "Wayzata School District", logo_url: null, website: "https://wayzata.example.org", main_phone: "555-0100", notes: "Door 3 for load-in." },
  contacts: [{ id: "c1", organization_id: "org-1", full_name: "Avery Nelson", title: "Principal", email: "avery@wayzata.org", phone: null, photo_url: null, active_status: "active", notes: null }],
  locations: [{ id: "loc-1", location_name: "Main Gym", city: "Plymouth", state: "MN", active_status: "active" }],
  child_organizations: []
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("DirectoryRecordDetailPage", () => {
  it("renders a full-page Organization detail with hierarchy, contacts, and locations", async () => {
    setHash("#directory/organizations/org-1");
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/organizations/org-1") return Promise.resolve(ORG_DETAIL);
      if (path.endsWith("/service-terms")) return Promise.resolve({ service_terms: [] });
      if (path.endsWith("/logo-history")) return Promise.resolve({ logo_history: [] });
      if (path.includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      return Promise.resolve({});
    });
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="organization" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Wayzata High School" })).toBeInTheDocument());
    expect(screen.getByText("Account Hierarchy")).toBeInTheDocument();
    expect(screen.getByText(/Contacts \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Avery Nelson/)).toBeInTheDocument();
    expect(screen.getByText(/Locations \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Directory/ })).toBeInTheDocument();
  });

  it("shows a not-found state when the record 404s", async () => {
    setHash("#directory/organizations/missing");
    const { ApiClientError } = await vi.importActual<typeof import("../api")>("../api");
    apiFetchMock.mockRejectedValue(new (ApiClientError as any)(404, "Not found"));
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="organization" />);
    await waitFor(() => expect(screen.getByText(/no longer exists or could not be found/)).toBeInTheDocument());
  });

  it("shows a permission-denied state on 403", async () => {
    setHash("#directory/organizations/denied");
    const { ApiClientError } = await vi.importActual<typeof import("../api")>("../api");
    apiFetchMock.mockRejectedValue(new (ApiClientError as any)(403, "Forbidden"));
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="organization" />);
    await waitFor(() => expect(screen.getByText(/don't have access/)).toBeInTheDocument());
  });

  it("shows an archived read-only banner for an inactive record", async () => {
    setHash("#directory/organizations/org-1");
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/organizations/org-1") return Promise.resolve({ ...ORG_DETAIL, organization: { ...ORG_DETAIL.organization, active_status: "inactive" } });
      if (path.endsWith("/service-terms")) return Promise.resolve({ service_terms: [] });
      if (path.endsWith("/logo-history")) return Promise.resolve({ logo_history: [] });
      if (path.includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      return Promise.resolve({});
    });
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="organization" />);
    await waitFor(() => expect(screen.getByText("Archived — read-only")).toBeInTheDocument());
  });

  it("Back to Directory returns to the organizations list hash", async () => {
    setHash("#directory/organizations/org-1");
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/organizations/org-1") return Promise.resolve(ORG_DETAIL);
      if (path.endsWith("/service-terms")) return Promise.resolve({ service_terms: [] });
      if (path.endsWith("/logo-history")) return Promise.resolve({ logo_history: [] });
      if (path.includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      return Promise.resolve({});
    });
    sessionStorage.removeItem("directory:return-hash");
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="organization" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Wayzata High School" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Back to Directory/ }));
    expect(window.location.hash).toBe("#accounts");
  });

  it("Organization detail links an existing person through the shared canonical selector", async () => {
    setHash("#directory/organizations/org-1");
    apiFetchMock.mockImplementation((path: string, _t?: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/organizations/org-1") return Promise.resolve(ORG_DETAIL);
      if (path.endsWith("/service-terms")) return Promise.resolve({ service_terms: [] });
      if (path.endsWith("/logo-history")) return Promise.resolve({ logo_history: [] });
      if (path.includes("/links") && method === "POST") return Promise.resolve({ organization_contact_id: "oc9" });
      if (path.includes("/contact-identities") && path.includes("search=priya")) {
        return Promise.resolve({ contacts: [{ id: "c9", first_name: "Priya", last_name: "Sharma", full_name: "Priya Sharma", display_name: null, email: "priya@id.example.com", phone: null, preferred_contact_method: null, active_status: "active", source: "manual", created_at: "x", updated_at: "x", linked_organization_count: 1, role_summary: [] }], total: 1 });
      }
      if (path.includes("/contact-identities")) return Promise.resolve({ contacts: [], total: 0 });
      return Promise.resolve({});
    });
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="organization" />);
    await waitFor(() => expect(screen.getByText("Add a person to this organization")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search canonical contacts"), { target: { value: "priya" } });
    // click the result inside the selector's own listbox (not a contextual-contacts link)
    const results = await screen.findByRole("listbox", { name: "Canonical contacts" });
    fireEvent.click(await within(results).findByRole("button", { name: /Priya Sharma/ }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/contact-identities/c9/links"),
        "t",
        expect.objectContaining({ method: "POST", body: expect.stringContaining("org-1") })
      )
    );
  });

  it("renders the canonical Contact identity experience at #directory/contacts/<id>", async () => {
    setHash("#directory/contacts/cc1");
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes("/contact-identities/cc1/relationships")) {
        return Promise.resolve({
          identity: { id: "cc1", first_name: "Sam", last_name: "Rivera", full_name: "Sam Rivera", display_name: null, email: "sam@id.example.com", phone: "555-0100", preferred_contact_method: null, active_status: "active", source: "manual", created_at: "x", updated_at: "x" },
          relationships: [
            { organization_id: "d1", organization_name: "Maple District", organization_contact_id: "oc1", relationship_role: "general", client_roles: ["district_contact"], is_primary: true },
            { organization_id: "s1", organization_name: "Maple High", organization_contact_id: "oc2", relationship_role: "general", client_roles: ["picture_day_contact"], is_primary: false }
          ]
        });
      }
      return Promise.resolve({});
    });
    render(<DirectoryRecordDetailPage token="t" currentUser={USER} recordType="contact" />);
    // canonical cross-org rollup for one reusable identity (District + School)
    await waitFor(() => expect(screen.getByText("Maple District")).toBeInTheDocument());
    expect(screen.getByText("Maple High")).toBeInTheDocument();
    expect(screen.getAllByText(/Sam Rivera/).length).toBeGreaterThan(0);
  });
});
