import { describe, expect, it } from "vitest";
import { evaluateShootPriority } from "../src/services/shootPriority.js";

describe("shoot importance scoring", () => {
  it("can classify a mid-size but operationally fragile shoot as a big shoot", () => {
    const result = evaluateShootPriority({
      projectedHeadcount: 120,
      plannedStaffCount: 4,
      cameraStationCount: 3,
      hasSpecialtyRequirements: true,
      firstYearCustomerFlag: true,
      flagshipPriorityAccountFlag: true,
      complexityScore: 78,
      multiTeamCoordination: true,
      missingStaffingCoverageCount: 2,
      missingRequiredPrepCount: 2,
      weatherTravelRiskFlag: true,
      manualLeadershipBoost: 5
    });

    expect(result.weightedScore).toBeGreaterThanOrEqual(65);
    expect(result.calculatedLabel).toBe("big_shoot");
    expect(result.priorityLabel).toBe("big_shoot");
    expect(result.reasons.some((reason) => reason.label === "Deliverable Complexity")).toBe(true);
  });

  it("classifies a stacked operational risk shoot as critical when the score clears the critical band", () => {
    const result = evaluateShootPriority({
      projectedHeadcount: 850,
      plannedStaffCount: 8,
      cameraStationCount: 5,
      shootStructure: "open_house",
      hasSpecialtyRequirements: true,
      flagshipPriorityAccountFlag: true,
      priorMajorIssueExists: true,
      missingStaffingCoverageCount: 3,
      missingRequiredPrepCount: 4,
      weatherTravelRiskFlag: true,
      manualLeadershipBoost: 10
    });

    expect(result.weightedScore).toBeGreaterThanOrEqual(85);
    expect(result.calculatedLabel).toBe("critical_shoot");
    expect(result.priorityLabel).toBe("critical_shoot");
  });

  it("lets leadership override the designation with an explainable reason", () => {
    const result = evaluateShootPriority({
      projectedHeadcount: 40,
      plannedStaffCount: 2,
      importanceOverrideTier: "critical_shoot",
      importanceOverrideReason: "State finals media visibility requires extra leadership watch."
    });

    expect(result.weightedScore).toBeLessThan(40);
    expect(result.calculatedLabel).toBe("standard");
    expect(result.priorityLabel).toBe("critical_shoot");
    expect(result.override).toMatchObject({
      applied: true,
      label: "critical_shoot",
      reason: "State finals media visibility requires extra leadership watch.",
      source: "manual_override"
    });
  });
});
