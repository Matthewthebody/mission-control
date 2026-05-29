import { describe, expect, it } from "vitest";
import {
  createReadinessCheckResult,
  createReadinessCompactBadgePayload,
  createReadinessDetailedPanelPayload,
  createShootReadinessDetailDto,
  createShootReadinessSummary,
  evaluateReadiness
} from "../src/domain/readiness/index.js";

describe("readiness domain phase 2B api-safe DTOs", () => {
  it("builds a compact badge payload from evaluated readiness", () => {
    const result = evaluateReadiness([
      createReadinessCheckResult("staffing_complete", {
        passed: true
      }),
      createReadinessCheckResult("lead_assigned", {
        passed: true
      }),
      createReadinessCheckResult("location_ready", {
        passed: false,
        message: "Location access details still need review."
      })
    ]);

    const badge = createReadinessCompactBadgePayload(result);

    expect(badge).toEqual({
      readinessState: "needs_attention",
      readinessLabel: "Needs Attention",
      goNoGoState: "hold",
      goNoGoLabel: "Hold",
      blocked: false,
      scorePercentage: 76
    });
  });

  it("builds a summary dto with shoot-scoped aggregate counts", () => {
    const result = evaluateReadiness([
      createReadinessCheckResult("staffing_complete", {
        passed: false,
        message: "Staffing is still incomplete."
      }),
      createReadinessCheckResult("setup_photo_received", {
        passed: true
      })
    ]);

    const summary = createShootReadinessSummary("shoot-123", result);

    expect(summary.shootId).toBe("shoot-123");
    expect(summary.readinessState).toBe("not_ready");
    expect(summary.goNoGoState).toBe("no_go");
    expect(summary.failedCheckCount).toBe(1);
    expect(summary.missingItemCount).toBe(1);
    expect(summary.blockerCount).toBe(1);
    expect(summary.compactBadge.blocked).toBe(true);
  });

  it("builds a detailed panel payload with sorted checks, missing items, and blockers", () => {
    const result = evaluateReadiness([
      createReadinessCheckResult("open_issue_reviewed", {
        passed: false,
        message: "Open issue has not been acknowledged."
      }),
      createReadinessCheckResult("staffing_complete", {
        passed: false,
        message: "Staffing remains incomplete."
      }),
      createReadinessCheckResult("setup_photo_received", {
        passed: true
      })
    ]);

    const panel = createReadinessDetailedPanelPayload(result);

    expect(panel.summaryLine).toBe("1 readiness blocker must be cleared before the Shoot is ready.");
    expect(panel.checks.map((check) => check.checkCode)).toEqual([
      "staffing_complete",
      "setup_photo_received",
      "open_issue_reviewed"
    ]);
    expect(panel.missingItems.map((item) => item.checkCode)).toEqual([
      "staffing_complete",
      "open_issue_reviewed"
    ]);
    expect(panel.blockers.map((blocker) => blocker.checkCode)).toEqual(["staffing_complete"]);
    expect(panel.checks[0]?.description).toContain("staffing plan");
  });

  it("builds a combined detail dto for API delivery", () => {
    const result = evaluateReadiness([
      createReadinessCheckResult("staffing_complete", {
        passed: true
      }),
      createReadinessCheckResult("lead_assigned", {
        passed: true
      }),
      createReadinessCheckResult("schedule_timing_confirmed", {
        passed: true
      }),
      createReadinessCheckResult("equipment_ready", {
        passed: true
      }),
      createReadinessCheckResult("approval_clearance", {
        passed: true
      })
    ]);

    const detail = createShootReadinessDetailDto("shoot-999", result);

    expect(detail.summary.shootId).toBe("shoot-999");
    expect(detail.summary.readinessState).toBe("ready");
    expect(detail.panel.readinessLabel).toBe("Ready");
    expect(detail.panel.goNoGoLabel).toBe("Go");
    expect(detail.panel.summaryLine).toBe("Readiness checks are currently satisfied.");
    expect(detail.panel.checks).toHaveLength(5);
  });
});
