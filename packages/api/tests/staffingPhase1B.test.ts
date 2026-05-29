import { describe, expect, it } from "vitest";
import { ROLE_REGISTRY } from "../src/domain/auth/index.js";
import {
  STAFFING_AUTHORITY_POLICY_REGISTRY,
  STAFFING_AUTHORITY_SCOPE_REGISTRY,
  STAFFING_CAPABILITY_REGISTRY,
  getRolesWithStaffingCapability,
  getStaffingAuthorityPolicy,
  getStaffingAuthorityScope,
  getStaffingCapabilitiesForRole,
  isStaffingAuthorityScope,
  isStaffingCapability,
  roleHasStaffingCapability
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 1B authority policies", () => {
  it("exposes deterministic staffing authority registries without duplicates", () => {
    expect(new Set(STAFFING_CAPABILITY_REGISTRY).size).toBe(STAFFING_CAPABILITY_REGISTRY.length);
    expect(new Set(STAFFING_AUTHORITY_SCOPE_REGISTRY).size).toBe(STAFFING_AUTHORITY_SCOPE_REGISTRY.length);
    expect(new Set(STAFFING_AUTHORITY_POLICY_REGISTRY.map((policy) => policy.role)).size).toBe(
      STAFFING_AUTHORITY_POLICY_REGISTRY.length
    );
  });

  it("provides runtime guards and a policy for every canonical role", () => {
    expect(isStaffingCapability("publish_staffing")).toBe(true);
    expect(isStaffingCapability("approve_staffing")).toBe(false);

    expect(isStaffingAuthorityScope("department")).toBe(true);
    expect(isStaffingAuthorityScope("global")).toBe(false);

    for (const role of ROLE_REGISTRY) {
      const policy = getStaffingAuthorityPolicy(role);
      expect(policy.role).toBe(role);
      expect(STAFFING_AUTHORITY_SCOPE_REGISTRY.includes(policy.scope)).toBe(true);
    }
  });

  it("grants leadership-grade override capabilities only to the intended roles", () => {
    expect(roleHasStaffingCapability("leadership", "override_staffing_conflict")).toBe(true);
    expect(roleHasStaffingCapability("director_admin", "override_staffing_warnings")).toBe(true);
    expect(roleHasStaffingCapability("assistant_manager", "override_staffing_conflict")).toBe(false);
    expect(roleHasStaffingCapability("staffing_coordinator", "override_staffing_warnings")).toBe(false);

    expect(getRolesWithStaffingCapability("override_staffing_conflict")).toEqual([
      "super_admin",
      "leadership",
      "director_admin"
    ]);
  });

  it("supports lookup helpers for staffing capabilities and scope", () => {
    expect(getStaffingCapabilitiesForRole("staffing_coordinator")).toEqual([
      "view_staffing_dashboard",
      "view_staffing_board",
      "view_staffing_availability",
      "view_staffing_templates",
      "manage_staffing_templates",
      "assign_staffing_assignment",
      "publish_staffing"
    ]);

    expect(getStaffingAuthorityScope("staffing_coordinator")).toBe("department");
    expect(getStaffingCapabilitiesForRole("photographer")).toEqual([]);
    expect(getStaffingAuthorityScope("photographer")).toBe("none");
  });
});
