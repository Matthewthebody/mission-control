import { describe, expect, it } from "vitest";
import {
  SHOOT_LIFECYCLE_TRANSITION_DENIAL_REASON_REGISTRY,
  SHOOT_LIFECYCLE_TRANSITION_REGISTRY,
  SHOOT_STATUS_REGISTRY,
  isShootStatus,
  validateShootLifecycleTransition
} from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 1C validation", () => {
  it("exposes deterministic shoot status and denial registries", () => {
    expect(new Set(SHOOT_STATUS_REGISTRY).size).toBe(SHOOT_STATUS_REGISTRY.length);
    expect(new Set(SHOOT_LIFECYCLE_TRANSITION_DENIAL_REASON_REGISTRY).size).toBe(
      SHOOT_LIFECYCLE_TRANSITION_DENIAL_REASON_REGISTRY.length
    );
    expect(new Set(SHOOT_LIFECYCLE_TRANSITION_REGISTRY.map((transition) => transition.transitionKey)).size).toBe(
      SHOOT_LIFECYCLE_TRANSITION_REGISTRY.length
    );
  });

  it("provides a runtime guard for canonical shoot statuses", () => {
    expect(isShootStatus("CONFIRMED")).toBe(true);
    expect(isShootStatus("ARCHIVED")).toBe(false);
  });

  it("allows a valid transition for an allowed actor", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "READY",
      targetStatus: "LIVE",
      actorRoles: ["photographer"]
    });

    expect(result.allowed).toBe(true);
    expect(result.denialReason).toBeNull();
    expect(result.matchedTransition?.transitionKey).toBe("start_live_shoot");
  });

  it("denies transitions that are not registered", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "LIVE",
      targetStatus: "DRAFT",
      actorRoles: ["leadership"]
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("transition_not_found");
    expect(result.matchedTransition).toBeNull();
  });

  it("denies actors that are not allowed for the transition", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "CONFIRMED",
      targetStatus: "CANCELLED",
      actorRoles: ["photographer"],
      reason: "Weather closure"
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("actor_not_allowed");
    expect(result.allowedRoles).toContain("leadership");
  });

  it("denies reason-required transitions when the reason is blank", () => {
    const result = validateShootLifecycleTransition({
      currentStatus: "LIVE",
      targetStatus: "CANCELLED",
      actorRoles: ["leadership"],
      reason: "   "
    });

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("reason_required");
    expect(result.reasonRequired).toBe(true);
  });
});
