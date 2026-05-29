import { describe, expect, it } from "vitest";
import {
  DEFAULT_READINESS_RULE_RESOLVER,
  READINESS_COMPLEXITY_TIER_REGISTRY,
  READINESS_PROFILE_SHOOT_TYPE_REGISTRY,
  READINESS_RULE_PROFILE_REGISTRY,
  createProfiledReadinessCheckResult,
  isReadinessComplexityTier,
  isReadinessProfileShootType,
  listReadinessRuleProfiles,
  listResolvedOptionalReadinessChecks,
  listResolvedRequiredReadinessChecks,
  resolveReadinessComplexityTier,
  resolveReadinessRuleProfile
} from "../src/domain/readiness/index.js";

describe("readiness domain phase 2A rule profiles", () => {
  it("exposes deterministic shoot-type, complexity, and profile registries", () => {
    expect(new Set(READINESS_PROFILE_SHOOT_TYPE_REGISTRY).size).toBe(
      READINESS_PROFILE_SHOOT_TYPE_REGISTRY.length
    );
    expect(new Set(READINESS_COMPLEXITY_TIER_REGISTRY).size).toBe(
      READINESS_COMPLEXITY_TIER_REGISTRY.length
    );
    expect(Object.keys(READINESS_RULE_PROFILE_REGISTRY)).toEqual([
      "default_operations",
      "schools_standard",
      "schools_complex",
      "sports_complex",
      "studio_headshots",
      "internal_operations"
    ]);
    expect(isReadinessProfileShootType("sports")).toBe(true);
    expect(isReadinessProfileShootType("weddings")).toBe(false);
    expect(isReadinessComplexityTier("high")).toBe(true);
    expect(isReadinessComplexityTier("medium")).toBe(false);
  });

  it("derives complexity tiers from numeric complexity scores", () => {
    expect(resolveReadinessComplexityTier(null)).toBe("standard");
    expect(resolveReadinessComplexityTier(10)).toBe("low");
    expect(resolveReadinessComplexityTier(30)).toBe("standard");
    expect(resolveReadinessComplexityTier(60)).toBe("high");
    expect(resolveReadinessComplexityTier(80)).toBe("critical");
  });

  it("falls back to the default operations profile for unmatched standard shoot types", () => {
    const resolved = resolveReadinessRuleProfile({
      shootType: "commercial",
      complexityScore: 35
    });

    expect(resolved.profileKey).toBe("default_operations");
    expect(resolved.complexityTier).toBe("standard");
    expect(resolved.requiredChecks).toEqual([
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance"
    ]);
    expect(resolved.optionalChecks).toContain("location_ready");
  });

  it("resolves schools high-complexity profiles with required checks and overrides", () => {
    const resolved = DEFAULT_READINESS_RULE_RESOLVER.resolve({
      shootType: "schools_underclass_portraits",
      complexityScore: 82
    });

    expect(resolved.profileKey).toBe("schools_complex");
    expect(resolved.requiredChecks).toContain("setup_photo_received");
    expect(resolved.requiredChecks).toContain("open_issue_reviewed");
    expect(resolved.effectiveCheckDefinitions.location_ready.blockingByDefault).toBe(true);
    expect(resolved.effectiveCheckDefinitions.location_ready.weightCategory).toBe("critical");
    expect(resolved.effectiveCheckDefinitions.open_issue_reviewed.blockingByDefault).toBe(true);
  });

  it("resolves studio/headshots profiles with optional non-blocking checks", () => {
    const resolved = resolveReadinessRuleProfile({
      shootType: "studio",
      complexityScore: 20
    });

    expect(resolved.profileKey).toBe("studio_headshots");
    expect(listResolvedRequiredReadinessChecks(resolved).map((definition) => definition.checkCode)).toEqual([
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance"
    ]);
    expect(listResolvedOptionalReadinessChecks(resolved).map((definition) => definition.checkCode)).toEqual([
      "location_ready",
      "setup_photo_received",
      "pre_service_note_present",
      "open_issue_reviewed"
    ]);
    expect(resolved.effectiveCheckDefinitions.location_ready.weightCategory).toBe("low");
    expect(resolved.effectiveCheckDefinitions.setup_photo_received.weightCategory).toBe("low");
    expect(resolved.effectiveCheckDefinitions.lead_assigned.blockingByDefault).toBe(true);
  });

  it("creates check results against effective profile rules", () => {
    const resolved = resolveReadinessRuleProfile({
      shootType: "internal",
      complexityScore: 55
    });

    const locationCheck = createProfiledReadinessCheckResult(resolved, "location_ready", {
      passed: false,
      message: "Location detail is still incomplete."
    });
    const prepCheck = createProfiledReadinessCheckResult(resolved, "pre_service_note_present", {
      passed: false,
      message: "The internal runbook note is still missing."
    });
    const issueCheck = createProfiledReadinessCheckResult(resolved, "open_issue_reviewed", {
      passed: false,
      message: "The open operational issue still needs review."
    });

    expect(locationCheck.blocking).toBe(false);
    expect(locationCheck.weightCategory).toBe("low");
    expect(prepCheck.blocking).toBe(false);
    expect(prepCheck.weightCategory).toBe("high");
    expect(issueCheck.blocking).toBe(true);
  });

  it("lists profiles in deterministic priority order", () => {
    expect(listReadinessRuleProfiles().map((profile) => profile.profileKey)).toEqual([
      "schools_complex",
      "sports_complex",
      "internal_operations",
      "studio_headshots",
      "schools_standard",
      "default_operations"
    ]);
  });
});
