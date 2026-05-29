import { describe, expect, it } from "vitest";
import {
  READINESS_ALERT_SEVERITY_REGISTRY,
  READINESS_ESCALATION_RULE_CODE_REGISTRY,
  createShootReadinessDetailDto,
  createReadinessCheckResult,
  evaluateReadiness,
  evaluateReadinessEscalation,
  isReadinessAlertSeverity,
  isReadinessEscalationRuleCode
} from "../src/domain/readiness/index.js";

describe("readiness domain phase 3B escalation hooks", () => {
  it("exposes deterministic readiness alert registries and guards", () => {
    expect(new Set(READINESS_ALERT_SEVERITY_REGISTRY).size).toBe(READINESS_ALERT_SEVERITY_REGISTRY.length);
    expect(new Set(READINESS_ESCALATION_RULE_CODE_REGISTRY).size).toBe(
      READINESS_ESCALATION_RULE_CODE_REGISTRY.length
    );
    expect(isReadinessAlertSeverity("major")).toBe(true);
    expect(isReadinessAlertSeverity("minor")).toBe(false);
    expect(isReadinessEscalationRuleCode("no_go_state")).toBe(true);
    expect(isReadinessEscalationRuleCode("escalate_now")).toBe(false);
  });

  it("creates a critical escalation candidate when readiness is no-go", () => {
    const readinessDetail = createShootReadinessDetailDto(
      "shoot-1",
      evaluateReadiness([
        createReadinessCheckResult("staffing_complete", {
          passed: false,
          message: "Staffing is still incomplete."
        }),
        createReadinessCheckResult("setup_photo_received", {
          passed: true
        })
      ])
    );

    const result = evaluateReadinessEscalation({
      shootId: "shoot-1",
      shootCode: "SC-100",
      shootStartsAt: "2026-03-29T10:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      readinessDetail
    });

    expect(result.escalationRequired).toBe(true);
    expect(result.highestSeverity).toBe("critical");
    expect(result.alertCandidates[0]?.ruleCode).toBe("no_go_state");
  });

  it("creates a major escalation for needs-attention readiness close to shoot time", () => {
    const readinessDetail = createShootReadinessDetailDto(
      "shoot-2",
      evaluateReadiness([
        createReadinessCheckResult("staffing_complete", { passed: true }),
        createReadinessCheckResult("lead_assigned", { passed: true }),
        createReadinessCheckResult("location_ready", {
          passed: false,
          message: "Access details still need review."
        }),
        createReadinessCheckResult("setup_photo_received", {
          passed: false,
          message: "Setup photo is still missing."
        })
      ])
    );

    const result = evaluateReadinessEscalation({
      shootId: "shoot-2",
      shootStartsAt: "2026-03-29T06:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      readinessDetail
    });

    expect(result.highestSeverity).toBe("major");
    expect(result.alertCandidates.some((candidate) => candidate.ruleCode === "needs_attention_protected_window")).toBe(
      true
    );
  });

  it("creates a warning when an upcoming shoot has not been evaluated yet", () => {
    const readinessDetail = createShootReadinessDetailDto("shoot-3", evaluateReadiness([]));

    const result = evaluateReadinessEscalation({
      shootId: "shoot-3",
      shootStartsAt: "2026-03-30T12:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      readinessDetail
    });

    expect(result.escalationRequired).toBe(true);
    expect(result.highestSeverity).toBe("warning");
    expect(result.alertCandidates.map((candidate) => candidate.ruleCode)).toContain("upcoming_not_evaluated");
  });

  it("returns no escalation candidates when readiness is healthy", () => {
    const readinessDetail = createShootReadinessDetailDto(
      "shoot-4",
      evaluateReadiness([
        createReadinessCheckResult("staffing_complete", { passed: true }),
        createReadinessCheckResult("lead_assigned", { passed: true }),
        createReadinessCheckResult("schedule_timing_confirmed", { passed: true }),
        createReadinessCheckResult("equipment_ready", { passed: true }),
        createReadinessCheckResult("approval_clearance", { passed: true })
      ])
    );

    const result = evaluateReadinessEscalation({
      shootId: "shoot-4",
      shootStartsAt: "2026-04-01T12:00:00.000Z",
      evaluationTime: "2026-03-28T12:00:00.000Z",
      readinessDetail
    });

    expect(result.escalationRequired).toBe(false);
    expect(result.highestSeverity).toBeNull();
    expect(result.alertCandidates).toEqual([]);
  });
});
