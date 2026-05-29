import { describe, expect, it } from "vitest";
import {
  DEFAULT_READINESS_STATE_THRESHOLDS,
  READINESS_HARD_BLOCKER_CHECK_CODE_REGISTRY,
  createReadinessBlockers,
  createReadinessCheckResult,
  createReadinessMissingItems,
  evaluateReadiness,
  isReadinessHardBlockerCheckCode,
  resolveGoNoGoState,
  resolveReadinessState
} from "../src/domain/readiness/index.js";

describe("readiness domain phase 1B scoring and classification", () => {
  it("exposes locked hard blockers and default thresholds", () => {
    expect(new Set(READINESS_HARD_BLOCKER_CHECK_CODE_REGISTRY).size).toBe(
      READINESS_HARD_BLOCKER_CHECK_CODE_REGISTRY.length
    );
    expect(isReadinessHardBlockerCheckCode("staffing_complete")).toBe(true);
    expect(isReadinessHardBlockerCheckCode("location_ready")).toBe(false);
    expect(DEFAULT_READINESS_STATE_THRESHOLDS).toEqual({
      readyMinimumScore: 85,
      needsAttentionMinimumScore: 60
    });
  });

  it("returns not_evaluated and hold when no readiness checks exist yet", () => {
    const result = evaluateReadiness([]);

    expect(result.readinessState).toBe("not_evaluated");
    expect(result.goNoGoState).toBe("hold");
    expect(result.scorePossible).toBe(0);
    expect(result.scorePercentage).toBe(0);
    expect(result.missingItems).toEqual([]);
    expect(result.blockers).toEqual([]);
  });

  it("returns ready and go when all evaluated checks pass above the ready threshold", () => {
    const result = evaluateReadiness([
      createReadinessCheckResult("staffing_complete", { passed: true }),
      createReadinessCheckResult("lead_assigned", { passed: true }),
      createReadinessCheckResult("schedule_timing_confirmed", { passed: true }),
      createReadinessCheckResult("equipment_ready", { passed: true }),
      createReadinessCheckResult("setup_photo_received", { passed: true })
    ]);

    expect(result.scorePercentage).toBe(100);
    expect(result.readinessState).toBe("ready");
    expect(result.goNoGoState).toBe("go");
    expect(result.missingItems).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });

  it("generates missing items and hold state for non-blocking readiness gaps", () => {
    const checkResults = [
      createReadinessCheckResult("staffing_complete", { passed: true }),
      createReadinessCheckResult("lead_assigned", { passed: true }),
      createReadinessCheckResult("location_ready", {
        passed: false,
        message: "Location access details still need review."
      }),
      createReadinessCheckResult("setup_photo_received", {
        passed: false,
        message: "Setup photo has not been uploaded yet."
      })
    ];

    const missingItems = createReadinessMissingItems(checkResults);
    const blockers = createReadinessBlockers(checkResults);
    const readinessState = resolveReadinessState(checkResults);
    const goNoGoState = resolveGoNoGoState(readinessState, blockers);

    expect(missingItems.map((item) => item.checkCode)).toEqual([
      "location_ready",
      "setup_photo_received"
    ]);
    expect(blockers).toEqual([]);
    expect(readinessState).toBe("needs_attention");
    expect(goNoGoState).toBe("hold");
  });

  it("generates hard blockers and no_go when locked blocker checks fail", () => {
    const checkResults = [
      createReadinessCheckResult("staffing_complete", {
        passed: false,
        message: "Staffing coverage is still incomplete.",
        blocking: false
      }),
      createReadinessCheckResult("lead_assigned", {
        passed: false,
        message: "Lead coverage is still open."
      }),
      createReadinessCheckResult("setup_photo_received", {
        passed: true
      })
    ];

    const result = evaluateReadiness(checkResults);

    expect(result.readinessState).toBe("not_ready");
    expect(result.goNoGoState).toBe("no_go");
    expect(result.blockers.map((blocker) => blocker.checkCode)).toEqual([
      "staffing_complete",
      "lead_assigned"
    ]);
    expect(result.blockers.every((blocker) => blocker.hardBlocker)).toBe(true);
    expect(result.missingItems.every((item) => item.hardBlocker)).toBe(true);
  });

  it("drops to not_ready on score threshold even without a hard blocker", () => {
    const result = evaluateReadiness([
      createReadinessCheckResult("location_ready", {
        passed: false,
        message: "Location details are incomplete."
      }),
      createReadinessCheckResult("setup_photo_received", {
        passed: false,
        message: "Setup photo missing."
      }),
      createReadinessCheckResult("pre_service_note_present", {
        passed: false,
        message: "Pre-service note is missing."
      }),
      createReadinessCheckResult("open_issue_reviewed", {
        passed: true
      })
    ]);

    expect(result.scorePercentage).toBeLessThan(DEFAULT_READINESS_STATE_THRESHOLDS.needsAttentionMinimumScore);
    expect(result.readinessState).toBe("not_ready");
    expect(result.goNoGoState).toBe("hold");
    expect(result.blockers).toHaveLength(0);
    expect(result.missingItems).toHaveLength(3);
  });
});
