import { describe, expect, it } from "vitest";
import {
  SHOOT_LIFECYCLE_TRANSITION_REGISTRY,
  TRANSITION_BLOCKER_POLICY,
  validateShootLifecycleTransition,
  type ShootLifecycleBlockerEvaluatorRegistry
} from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 2B blocker framework", () => {
  it("maps blocker policy keys to registered transitions", () => {
    const transitionKeys = new Set(
      SHOOT_LIFECYCLE_TRANSITION_REGISTRY.map((transition) => transition.transitionKey)
    );

    for (const transitionKey of Object.keys(TRANSITION_BLOCKER_POLICY)) {
      expect(transitionKeys.has(transitionKey)).toBe(true);
    }
  });

  it("returns an allowed result with no blocker evaluations when no registry is provided", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "CONFIRMED",
      targetStatus: "READY",
      actorRoles: ["leadership"]
    });

    expect(result.allowed).toBe(true);
    expect(result.blockerEvaluations).toEqual([]);
  });

  it("runs configured blocker evaluators and preserves a passing transition", () => {
    const registry: ShootLifecycleBlockerEvaluatorRegistry = {
      ready_eligibility_guard: {
        evaluatorKey: "ready_eligibility_guard",
        evaluate: () => ({
          evaluatorKey: "ready_eligibility_guard",
          outcome: "clear",
          blockerCode: null,
          message: null
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
        transitionContext: {
          shootId: "shoot-123"
        },
        blockerEvaluatorRegistry: registry
      }
    );

    expect(result.allowed).toBe(true);
    expect(result.denialReason).toBeNull();
    expect(result.blockerEvaluations).toHaveLength(1);
    expect(result.hardBlockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("denies a transition when a configured evaluator reports a blocker", () => {
    const registry: ShootLifecycleBlockerEvaluatorRegistry = {
      ready_eligibility_guard: {
        evaluatorKey: "ready_eligibility_guard",
        evaluate: () => ({
          evaluatorKey: "ready_eligibility_guard",
          outcome: "hard_blocker",
          blockerCode: "not_ready_eligible",
          message: "2 readiness items still open."
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
    expect(result.hardBlockers[0]?.blockerCode).toBe("not_ready_eligible");
    expect(result.warnings).toEqual([]);
  });
});
