import { describe, expect, it } from "vitest";
import {
  GO_NO_GO_STATE_REGISTRY,
  READINESS_CHECK_CODE_REGISTRY,
  READINESS_CHECK_DEFINITIONS,
  READINESS_CHECK_SEVERITY_REGISTRY,
  READINESS_STATE_REGISTRY,
  READINESS_WEIGHT_CATEGORY_REGISTRY,
  READINESS_WEIGHT_VALUE_REGISTRY,
  createReadinessCheckResult,
  getReadinessCheckDefinition,
  getReadinessWeightValue,
  isGoNoGoState,
  isReadinessCheckCode,
  isReadinessCheckSeverity,
  isReadinessState,
  isReadinessWeightCategory,
  listBlockingReadinessCheckDefinitions,
  listReadinessCheckDefinitions,
  type ReadinessEvaluationResult
} from "../src/domain/readiness/index.js";

describe("readiness domain phase 1A foundations", () => {
  it("exposes deterministic readiness registries without duplicates", () => {
    expect(new Set(READINESS_STATE_REGISTRY).size).toBe(READINESS_STATE_REGISTRY.length);
    expect(new Set(GO_NO_GO_STATE_REGISTRY).size).toBe(GO_NO_GO_STATE_REGISTRY.length);
    expect(new Set(READINESS_CHECK_CODE_REGISTRY).size).toBe(READINESS_CHECK_CODE_REGISTRY.length);
    expect(new Set(READINESS_CHECK_SEVERITY_REGISTRY).size).toBe(READINESS_CHECK_SEVERITY_REGISTRY.length);
    expect(new Set(READINESS_WEIGHT_CATEGORY_REGISTRY).size).toBe(READINESS_WEIGHT_CATEGORY_REGISTRY.length);
  });

  it("provides runtime guards for readiness enums", () => {
    expect(isReadinessState("ready")).toBe(true);
    expect(isReadinessState("complete")).toBe(false);

    expect(isGoNoGoState("hold")).toBe(true);
    expect(isGoNoGoState("pending")).toBe(false);

    expect(isReadinessCheckCode("staffing_complete")).toBe(true);
    expect(isReadinessCheckCode("staff_ready")).toBe(false);

    expect(isReadinessCheckSeverity("blocking")).toBe(true);
    expect(isReadinessCheckSeverity("critical")).toBe(false);

    expect(isReadinessWeightCategory("high")).toBe(true);
    expect(isReadinessWeightCategory("medium")).toBe(false);
  });

  it("exposes a complete readiness definition registry with sorted lookup helpers", () => {
    expect(Object.keys(READINESS_CHECK_DEFINITIONS)).toHaveLength(READINESS_CHECK_CODE_REGISTRY.length);

    const staffingComplete = getReadinessCheckDefinition("staffing_complete");
    expect(staffingComplete.blockingByDefault).toBe(true);
    expect(staffingComplete.severity).toBe("blocking");
    expect(staffingComplete.weightCategory).toBe("critical");

    const sorted = listReadinessCheckDefinitions();
    expect(sorted.map((definition) => definition.checkCode)).toEqual([
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "location_ready",
      "equipment_ready",
      "setup_photo_received",
      "pre_service_note_present",
      "approval_clearance",
      "open_issue_reviewed"
    ]);

    const blocking = listBlockingReadinessCheckDefinitions();
    expect(blocking.map((definition) => definition.checkCode)).toEqual([
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance"
    ]);
  });

  it("resolves readiness weights and supports deterministic check result composition", () => {
    expect(READINESS_WEIGHT_VALUE_REGISTRY.critical).toBe(40);
    expect(getReadinessWeightValue("standard")).toBe(15);

    const failedBlockingCheck = createReadinessCheckResult("staffing_complete", {
      passed: false,
      message: "Open staffing slots remain."
    });
    expect(failedBlockingCheck.blocking).toBe(true);
    expect(failedBlockingCheck.severity).toBe("blocking");

    const advisoryPass = createReadinessCheckResult("setup_photo_received", {
      passed: true,
      message: "Setup photo already attached."
    });
    expect(advisoryPass.blocking).toBe(false);
    expect(advisoryPass.weightCategory).toBe("standard");
  });

  it("supports readiness evaluation result composition without requiring an engine yet", () => {
    const evaluation: ReadinessEvaluationResult = {
      readinessState: "needs_attention",
      goNoGoState: "hold",
      checkResults: [
        createReadinessCheckResult("staffing_complete", {
          passed: false,
          message: "Open staffing slots remain."
        }),
        createReadinessCheckResult("setup_photo_received", {
          passed: true,
          message: "Setup photo attached."
        })
      ],
      missingItems: [
        {
          checkCode: "staffing_complete",
          label: "Staffing Complete",
          severity: "blocking",
          weightCategory: "critical",
          blocking: true,
          hardBlocker: true,
          message: "Open staffing slots remain."
        }
      ],
      blockers: [
        {
          checkCode: "staffing_complete",
          label: "Staffing Complete",
          severity: "blocking",
          hardBlocker: true,
          message: "Open staffing slots remain."
        }
      ],
      passedCheckCount: 1,
      failedCheckCount: 1,
      blockingCheckCount: 1,
      warningCheckCount: 0,
      scoreEarned: 15,
      scorePossible: 55,
      scorePercentage: 27
    };

    expect(evaluation.readinessState).toBe("needs_attention");
    expect(evaluation.goNoGoState).toBe("hold");
    expect(evaluation.checkResults[0]?.blocking).toBe(true);
  });
});
