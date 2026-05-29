import { describe, expect, it } from "vitest";
import { validateShootLifecycleTransition } from "../src/domain/lifecycle/index.js";

describe("shoot lifecycle phase 3B approval metadata compatibility", () => {
  it("does not require approval context for manual lifecycle transitions", () => {
    const result = validateShootLifecycleTransition(
      {
        currentStatus: "CONFIRMED",
        targetStatus: "READY",
        actorRoles: ["leadership"],
        reason: "Ready to publish the day."
      },
      {
        approvalContext: {
          approvalSatisfied: false,
          approvalRequestId: "approval-123"
        }
      }
    );

    expect(result.allowed).toBe(true);
    expect(result.denialReason).toBeNull();
    expect(result.approvalRequirement).toBeNull();
    expect(result.matchedTransition?.controlClass).toBe("manual");
  });

  it("still enforces reasons on exception transitions", () => {
    const result = validateShootLifecycleTransition(
      {
        currentStatus: "LIVE",
        targetStatus: "CANCELLED",
        actorRoles: ["leadership"],
        reason: ""
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBe("reason_required");
    expect(result.reasonRequired).toBe(true);
  });
});
