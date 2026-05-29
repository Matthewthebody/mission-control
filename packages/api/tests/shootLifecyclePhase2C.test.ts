import { describe, expect, it } from "vitest";
import {
  SHOOT_LIFECYCLE_BLOCKER_OUTCOME_REGISTRY,
  validateShootLifecycleTransition,
  type ShootLifecycleBlockerEvaluatorRegistry
} from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 2C blocker-aware validation", () => {
  it("exposes deterministic blocker outcomes", () => {
    expect(new Set(SHOOT_LIFECYCLE_BLOCKER_OUTCOME_REGISTRY).size).toBe(
      SHOOT_LIFECYCLE_BLOCKER_OUTCOME_REGISTRY.length
    );
  });

  it("preserves warnings without denying the transition", () => {
    const registry: ShootLifecycleBlockerEvaluatorRegistry = {
      ready_eligibility_guard: {
        evaluatorKey: "ready_eligibility_guard",
        evaluate: () => ({
          evaluatorKey: "ready_eligibility_guard",
          outcome: "warning",
          blockerCode: "readiness_watch",
          message: "Readiness was updated recently."
        })
      }
    };

    const result = validateShootLifecycleTransition(
      {
        currentStatus: "CONFIRMED",
        targetStatus: "READY",
        actorRoles: ["leadership"]
      },
      {
        blockerEvaluatorRegistry: registry
      }
    );

    expect(result.allowed).toBe(true);
    expect(result.denialReason).toBeNull();
    expect(result.hardBlockers).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.blockerCode).toBe("readiness_watch");
  });

  it("denies the transition when a hard blocker exists", () => {
    const registry: ShootLifecycleBlockerEvaluatorRegistry = {
      ready_eligibility_guard: {
        evaluatorKey: "ready_eligibility_guard",
        evaluate: () => ({
          evaluatorKey: "ready_eligibility_guard",
          outcome: "hard_blocker",
          blockerCode: "not_ready_eligible",
          message: "Readiness checks still have blocking gaps."
        })
      }
    };

    const result = validateShootLifecycleTransition(
      {
        currentStatus: "CONFIRMED",
        targetStatus: "READY",
        actorRoles: ["leadership"]
      },
      {
        blockerEvaluatorRegistry: registry
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("blocked_by_evaluator");
    expect(result.hardBlockers).toHaveLength(1);
    expect(result.hardBlockers[0]?.blockerCode).toBe("not_ready_eligible");
    expect(result.warnings).toHaveLength(0);
    expect(result.blockerEvaluations).toHaveLength(1);
  });
});
