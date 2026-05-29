import { describe, expect, it } from "vitest";
import {
  SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_TRANSITION_REGISTRY,
  validateShootLifecycleTransition
} from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 2A rollback transitions", () => {
  it("registers the required rollback transitions explicitly", () => {
    const rollbackKeys = SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY.map((transition) => transition.transitionKey);

    expect(rollbackKeys).toEqual([
      "move_tentative_back_to_draft",
      "move_ready_back_to_confirmed",
      "resume_confirmed_from_hold",
      "resume_ready_from_hold",
      "resume_live_from_hold",
      "resume_shot_complete_from_hold",
      "resume_post_production_from_hold"
    ]);
  });

  it("assembles the lifecycle registry from forward and rollback transitions", () => {
    expect(SHOOT_LIFECYCLE_TRANSITION_REGISTRY).toHaveLength(
      SHOOT_LIFECYCLE_FORWARD_TRANSITION_REGISTRY.length +
        SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY.length +
        SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY.length
    );
    expect(
      SHOOT_LIFECYCLE_TRANSITION_REGISTRY.filter((transition) => transition.transitionDirection === "rollback")
    ).toHaveLength(SHOOT_LIFECYCLE_ROLLBACK_TRANSITION_REGISTRY.length);
  });

  it("allows a controlled rollback when the actor is permitted and a reason is provided", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "READY",
      targetStatus: "CONFIRMED",
      actorRoles: ["leadership"],
      reason: "Lead assignment changed."
    });

    expect(result.allowed).toBe(true);
    expect(result.matchedTransition?.transitionDirection).toBe("rollback");
    expect(result.matchedTransition?.transitionKey).toBe("move_ready_back_to_confirmed");
  });

  it("requires a reason for rollback transitions", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "TENTATIVE",
      targetStatus: "DRAFT",
      actorRoles: ["director_admin"],
      reason: ""
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("reason_required");
  });
});
