import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JobIntakeCanonicalContext } from "../components/jobIntake/JobIntakeCanonicalContext";
import type { OrganizationDetail, SchoolServiceTermRecord } from "../types";

// Phase 4 Slice F — the canonical directory context shown in job intake.

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

function term(overrides: Partial<SchoolServiceTermRecord>): SchoolServiceTermRecord {
  return {
    id: "term-1",
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

describe("JobIntakeCanonicalContext", () => {
  it("shows the parent district and current service term for a linked school", () => {
    render(
      <JobIntakeCanonicalContext
        organizationDetail={detail({ client_entity_kind: "account", parent_organization_id: "d1", parent_organization_name: "Maple District" })}
        currentServiceTerm={term({ period_label: "2025–2026" })}
        loadingServiceTerm={false}
      />
    );
    expect(screen.getByText("District: Maple District")).toBeInTheDocument();
    expect(screen.getByText(/2025–2026 \(School Year\)/)).toBeInTheDocument();
  });

  it("flags a school with no parent district as Review required and no current term", () => {
    render(
      <JobIntakeCanonicalContext
        organizationDetail={detail({ client_entity_kind: "account", parent_organization_id: null })}
        currentServiceTerm={null}
        loadingServiceTerm={false}
      />
    );
    expect(screen.getByText(/Review required — no parent district linked/)).toBeInTheDocument();
    expect(screen.getByText("No current term set")).toBeInTheDocument();
  });

  it("marks an unconfirmed (rolled-over) current term as needs review", () => {
    render(
      <JobIntakeCanonicalContext
        organizationDetail={detail({ client_entity_kind: "account", parent_organization_id: "d1", parent_organization_name: "Maple District" })}
        currentServiceTerm={term({ confirmation_state: "unconfirmed" })}
        loadingServiceTerm={false}
      />
    );
    expect(screen.getByText(/needs review/)).toBeInTheDocument();
  });

  it("summarizes child schools for a District", () => {
    render(
      <JobIntakeCanonicalContext
        organizationDetail={detail({ client_entity_kind: "parent_organization" }, [
          { id: "s1", display_name: "Maple High", account_type: "schools_underclass_portraits", active_status: "active" },
          { id: "s2", display_name: "Maple Middle", account_type: "schools_underclass_portraits", active_status: "active" }
        ])}
        currentServiceTerm={null}
        loadingServiceTerm={false}
      />
    );
    expect(screen.getByText(/District · 2 schools roll up/)).toBeInTheDocument();
  });

  it("renders nothing for a non-school organization", () => {
    const { container } = render(
      <JobIntakeCanonicalContext
        organizationDetail={detail({ account_type: "sports", client_entity_kind: "account" })}
        currentServiceTerm={null}
        loadingServiceTerm={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
