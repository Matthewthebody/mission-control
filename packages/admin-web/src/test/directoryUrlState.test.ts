import { afterEach, describe, expect, it } from "vitest";
import { parseOrganizationsHash } from "../pages/Organizations";

// Phase 4.2 Slice 5 — the URL is authoritative for mode + search + primary filters.
// parseOrganizationsHash is the single source that hydrates route + filter state on mount,
// refresh, and Back/Forward.

function setHash(hash: string) {
  window.location.hash = hash;
}
afterEach(() => setHash(""));

describe("directory URL state", () => {
  it("hydrates mode, selected record, search, and filters from the hash", () => {
    setHash("#accounts?view=organizations&organization=org-1&q=wayzata&account_type=schools_underclass_portraits&status=inactive&tab=profile");
    const route = parseOrganizationsHash("organizations");
    expect(route.view).toBe("organizations");
    expect(route.organizationId).toBe("org-1");
    expect(route.search).toBe("wayzata");
    expect(route.accountType).toBe("schools_underclass_portraits");
    expect(route.activeStatus).toBe("inactive");
    expect(route.tab).toBe("profile");
  });

  it("defaults search empty, account-type all, status active when absent", () => {
    setHash("#accounts");
    const route = parseOrganizationsHash("organizations");
    expect(route.search).toBe("");
    expect(route.accountType).toBe("all");
    expect(route.activeStatus).toBe("active");
    expect(route.roleCategory).toBe("all");
  });

  it("a direct contact hash selects Contacts mode; a direct location hash selects Locations mode", () => {
    setHash("#directory/contacts?contact=contact-9");
    expect(parseOrganizationsHash("organizations").view).toBe("contacts");
    expect(parseOrganizationsHash("organizations").contactId).toBe("contact-9");
    setHash("#directory/locations?location=loc-4");
    expect(parseOrganizationsHash("organizations").view).toBe("locations");
    expect(parseOrganizationsHash("organizations").locationId).toBe("loc-4");
  });

  it("carries the role filter for contacts mode", () => {
    setHash("#directory/contacts?role=decision_maker");
    expect(parseOrganizationsHash("contacts").roleCategory).toBe("decision_maker");
  });
});
