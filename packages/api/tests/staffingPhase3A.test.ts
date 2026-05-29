import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_VISIBILITY_LEVEL_REGISTRY,
  AVAILABILITY_VISIBILITY_POLICY_REGISTRY,
  evaluateAvailabilityVisibility,
  getAvailabilityVisibilityPolicy,
  getRolesWithAvailabilityVisibilityLevel,
  isAvailabilityVisibilityLevel,
  roleCanUseAvailabilityVisibilityPolicy
} from "../src/domain/staffing/index.js";

describe("staffing domain phase 3A availability visibility", () => {
  it("exposes deterministic visibility registries and guards", () => {
    expect(new Set(AVAILABILITY_VISIBILITY_LEVEL_REGISTRY).size).toBe(
      AVAILABILITY_VISIBILITY_LEVEL_REGISTRY.length
    );
    expect(new Set(AVAILABILITY_VISIBILITY_POLICY_REGISTRY.map((policy) => policy.role)).size).toBe(
      AVAILABILITY_VISIBILITY_POLICY_REGISTRY.length
    );
    expect(isAvailabilityVisibilityLevel("department")).toBe(true);
    expect(isAvailabilityVisibilityLevel("global")).toBe(false);
  });

  it("grants organization-wide visibility to leadership-grade staffing roles", () => {
    const result = evaluateAvailabilityVisibility({
      actorRoles: ["leadership"],
      actorEmployeeId: "employee-1",
      subjectEmployeeId: "employee-2",
      sameDepartment: false
    });

    expect(result.allowed).toBe(true);
    expect(result.effectiveVisibilityLevel).toBe("organization");
    expect(result.canViewAvailabilityStatus).toBe(true);
    expect(result.canViewCurrentAssignment).toBe(true);
    expect(result.canViewTimeWindow).toBe(true);
    expect(result.canViewLeadQualification).toBe(true);
  });

  it("scopes assistant managers to department visibility", () => {
    const sameDepartment = evaluateAvailabilityVisibility({
      actorRoles: ["assistant_manager"],
      actorEmployeeId: "employee-1",
      subjectEmployeeId: "employee-2",
      sameDepartment: true
    });
    const otherDepartment = evaluateAvailabilityVisibility({
      actorRoles: ["assistant_manager"],
      actorEmployeeId: "employee-1",
      subjectEmployeeId: "employee-3",
      sameDepartment: false
    });

    expect(sameDepartment.allowed).toBe(true);
    expect(sameDepartment.effectiveVisibilityLevel).toBe("department");
    expect(otherDepartment.allowed).toBe(false);
  });

  it("limits photographer visibility to self only", () => {
    const self = evaluateAvailabilityVisibility({
      actorRoles: ["photographer"],
      actorEmployeeId: "employee-1",
      subjectEmployeeId: "employee-1"
    });
    const other = evaluateAvailabilityVisibility({
      actorRoles: ["photographer"],
      actorEmployeeId: "employee-1",
      subjectEmployeeId: "employee-2",
      assignedToSameShoot: true,
      subjectPublishedOnSameShoot: true
    });

    expect(self.allowed).toBe(true);
    expect(self.effectiveVisibilityLevel).toBe("self");
    expect(self.canViewAvailabilityStatus).toBe(true);
    expect(self.canViewLeadQualification).toBe(false);
    expect(other.allowed).toBe(false);
  });

  it("supports policy lookups and capability-gated policy usage", () => {
    expect(getAvailabilityVisibilityPolicy("staffing_coordinator").visibilityLevel).toBe("department");
    expect(roleCanUseAvailabilityVisibilityPolicy("staffing_coordinator")).toBe(true);
    expect(roleCanUseAvailabilityVisibilityPolicy("read_only_viewer")).toBe(false);
    expect(getRolesWithAvailabilityVisibilityLevel("organization")).toEqual([
      "super_admin",
      "leadership",
      "director_admin"
    ]);
  });
});
