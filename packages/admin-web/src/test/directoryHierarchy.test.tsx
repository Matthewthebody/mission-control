import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParentDistrictSelector } from "../components/directory/ParentDistrictSelector";
import { OrganizationHierarchyCard } from "../components/directory/OrganizationHierarchyCard";
import type { OrganizationDetail } from "../types";

// Phase 4 Slice 5 — the canonical District ↔ School hierarchy surfaces:
// the searchable Parent-District selector and the hierarchy card (parent link /
// child schools / "Review required" for an unreconciled parentless school).

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    apiUrl: "http://localhost:4000"
  };
});

const DISTRICTS = {
  districts: [
    { id: "district-1", display_name: "Maple District", client_organization_type: "school_district", child_organization_count: 3 },
    { id: "district-2", display_name: "Oak District", client_organization_type: "school_district", child_organization_count: 0 }
  ]
};

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((path: string) => {
    if (path.includes("/organizations/districts")) {
      return Promise.resolve(DISTRICTS);
    }
    return Promise.resolve({});
  });
});

function detail(overrides: Partial<OrganizationDetail["organization"]>, childOrgs: OrganizationDetail["child_organizations"] = []): OrganizationDetail {
  return {
    organization: {
      id: "org-1",
      canonical_name: "Org",
      display_name: "Org",
      account_type: "schools_underclass_portraits",
      active_status: "active",
      aliases: [],
      ...overrides
    },
    contacts: [],
    locations: [],
    child_organizations: childOrgs
  } as unknown as OrganizationDetail;
}

describe("ParentDistrictSelector", () => {
  it("searches canonical districts and selects one", async () => {
    const onChange = vi.fn();
    render(<ParentDistrictSelector token="t" value="" initialName={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose district" }));
    await waitFor(() => expect(screen.getByText("Maple District")).toBeInTheDocument());
    expect(screen.getByText("3 schools")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Maple District"));
    expect(onChange).toHaveBeenCalledWith("district-1", "Maple District");
  });

  it("shows the seeded name and can clear the selection", async () => {
    const onChange = vi.fn();
    render(<ParentDistrictSelector token="t" value="district-1" initialName="Maple District" onChange={onChange} />);
    expect(screen.getByText("Maple District")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("", null);
  });
});

describe("OrganizationHierarchyCard", () => {
  it("lists child schools for a District and opens one", () => {
    const onSelect = vi.fn();
    render(
      <OrganizationHierarchyCard
        detail={detail({ client_entity_kind: "parent_organization" }, [
          { id: "school-1", display_name: "Maple High", account_type: "schools_underclass_portraits", active_status: "active" }
        ])}
        isSchoolAccount
        onSelectOrganization={onSelect}
      />
    );
    expect(screen.getByText("District Hierarchy")).toBeInTheDocument();
    expect(screen.getByText("1 linked school")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Maple High"));
    expect(onSelect).toHaveBeenCalledWith("school-1");
  });

  it("flags a parentless school account as Review required", () => {
    render(
      <OrganizationHierarchyCard
        detail={detail({ client_entity_kind: "account", parent_organization_id: null })}
        isSchoolAccount
        onSelectOrganization={vi.fn()}
      />
    );
    expect(screen.getByText("Review required")).toBeInTheDocument();
  });

  it("links to the parent district for a school that has one", () => {
    const onSelect = vi.fn();
    render(
      <OrganizationHierarchyCard
        detail={detail({ client_entity_kind: "account", parent_organization_id: "district-1", parent_organization_name: "Maple District" })}
        isSchoolAccount
        onSelectOrganization={onSelect}
      />
    );
    fireEvent.click(screen.getByText("Maple District"));
    expect(onSelect).toHaveBeenCalledWith("district-1");
  });
});
