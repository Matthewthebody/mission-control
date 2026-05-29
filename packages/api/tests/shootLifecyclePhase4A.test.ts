import { describe, expect, it } from "vitest";
import {
  SHOOT_LIFECYCLE_DANGEROUS_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY,
  SHOOT_LIFECYCLE_TERMINAL_STATUS_REGISTRY,
  validateShootLifecycleTransition
} from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 4A reopen and terminal hardening", () => {
  it("registers the required reopen transitions explicitly", () => {
    expect(SHOOT_LIFECYCLE_REOPEN_TRANSITION_REGISTRY.map((transition) => transition.transitionKey)).toEqual([
      "reopen_complete_to_post_production"
    ]);
  });

  it("tracks dangerous transitions and terminal statuses explicitly", () => {
    expect(SHOOT_LIFECYCLE_TERMINAL_STATUS_REGISTRY).toEqual(["COMPLETE", "CANCELLED"]);
    expect(SHOOT_LIFECYCLE_DANGEROUS_TRANSITION_REGISTRY).toContain("reopen_complete_to_post_production");
    expect(SHOOT_LIFECYCLE_DANGEROUS_TRANSITION_REGISTRY).toContain("cancel_live_shoot");
  });

  it("blocks undefined transitions out of terminal statuses", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "CANCELLED",
      targetStatus: "READY",
      actorRoles: ["leadership"],
      reason: "Trying to skip reopen."
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("terminal_status_locked");
  });

  it("allows explicit reopen transitions from terminal statuses", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "COMPLETE",
      targetStatus: "POST_PRODUCTION",
      actorRoles: ["leadership"],
      reason: "A final correction still needs to run."
    });

    expect(result.allowed).toBe(true);
    expect(result.matchedTransition?.transitionDirection).toBe("reopen");
    expect(result.dangerousTransition).toBe(true);
    expect(result.matchedTransition?.controlClass).toBe("override_only");
  });

  it("requires a reason for dangerous reopen transitions", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "COMPLETE",
      targetStatus: "POST_PRODUCTION",
      actorRoles: ["director_admin"],
      reason: ""
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("reason_required");
    expect(result.dangerousTransition).toBe(true);
  });
});
