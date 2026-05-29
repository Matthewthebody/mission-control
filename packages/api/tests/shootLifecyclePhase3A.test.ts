import { describe, expect, it } from "vitest";
import {
  SHOOT_LIFECYCLE_AUTOMATION_HOOK_OUTCOME_REGISTRY,
  SHOOT_LIFECYCLE_AUTOMATION_POLICY_KEY_REGISTRY,
  SHOOT_LIFECYCLE_AUTOMATION_POLICY_REGISTRY,
  SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_TRANSITION_CONTROL_CLASS_REGISTRY,
  evaluateShootLifecycleAutomationCandidates,
  type ShootLifecycleAutomationHookRegistry
} from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 3A control metadata and automation hooks", () => {
  it("exposes deterministic control and automation registries", () => {
    expect(new Set(SHOOT_LIFECYCLE_TRANSITION_CONTROL_CLASS_REGISTRY).size).toBe(
      SHOOT_LIFECYCLE_TRANSITION_CONTROL_CLASS_REGISTRY.length
    );
    expect(new Set(SHOOT_LIFECYCLE_AUTOMATION_POLICY_KEY_REGISTRY).size).toBe(
      SHOOT_LIFECYCLE_AUTOMATION_POLICY_KEY_REGISTRY.length
    );
    expect(new Set(SHOOT_LIFECYCLE_AUTOMATION_HOOK_OUTCOME_REGISTRY).size).toBe(
      SHOOT_LIFECYCLE_AUTOMATION_HOOK_OUTCOME_REGISTRY.length
    );
  });

  it("registers the optional automatic candidate transitions with control metadata", () => {
    const automaticTransitions = SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY.filter(
      (transition) => transition.controlClass === "automatic"
    );

    expect(automaticTransitions.map((transition) => transition.transitionKey)).toEqual(["start_live_shoot"]);
    expect(automaticTransitions.every((transition) => transition.automationPolicyKey)).toBe(true);
  });

  it("surfaces automatic candidates safely as held when required hooks are missing", () => {
    const candidates = evaluateShootLifecycleAutomationCandidates({
      currentStatus: "READY"
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.policy).toBe(SHOOT_LIFECYCLE_AUTOMATION_POLICY_REGISTRY.ready_to_live_window);
    expect(candidates[0]?.eligibleForAutomation).toBe(false);
    expect(candidates[0]?.hookResults[0]?.reasonCode).toBe("hook_not_registered");
  });

  it("marks automatic candidates eligible only when all required hooks pass", () => {
    const hookRegistry: ShootLifecycleAutomationHookRegistry = {
      live_start_window_hook: {
        hookKey: "live_start_window_hook",
        evaluate: () => ({
          hookKey: "live_start_window_hook",
          outcome: "pass",
          reasonCode: null,
          message: null
        })
      }
    };

    const candidates = evaluateShootLifecycleAutomationCandidates(
      {
        currentStatus: "READY"
      },
      {
        hookRegistry
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.transition.transitionKey).toBe("start_live_shoot");
    expect(candidates[0]?.eligibleForAutomation).toBe(true);
  });

  it("holds automation when a required hook returns hold", () => {
    const hookRegistry: ShootLifecycleAutomationHookRegistry = {
      live_start_window_hook: {
        hookKey: "live_start_window_hook",
        evaluate: () => ({
          hookKey: "live_start_window_hook",
          outcome: "hold",
          reasonCode: "live_window_not_open",
          message: "The live start window has not opened yet."
        })
      }
    };

    const candidates = evaluateShootLifecycleAutomationCandidates(
      {
        currentStatus: "READY"
      },
      {
        hookRegistry
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eligibleForAutomation).toBe(false);
    expect(candidates[0]?.hookResults[0]?.reasonCode).toBe("live_window_not_open");
  });
});
