import { describe, expect, it } from "vitest";
import {
  PROFITABILITY_IMPORT_RUN_MODE_REGISTRY,
  PROFITABILITY_IMPORT_RUN_STATUS_REGISTRY,
  PROFITABILITY_METRIC_KEY_REGISTRY,
  PROFITABILITY_SNAPSHOT_SCOPE_REGISTRY,
  PROFITABILITY_SNAPSHOT_STATUS_REGISTRY,
  createEmployeeSafeProfitabilityProjection,
  createLeadershipProfitabilityProjection,
  getEmployeeSafeProfitabilityMetricKeys,
  getLeadershipProfitabilityMetricKeys,
  getProfitabilityMetricDefinition,
  isEmployeeSafeProfitabilityMetricValue,
  isProfitabilityImportRunMode,
  isProfitabilityImportRunStatus,
  isProfitabilityMetricKey,
  isProfitabilitySnapshotScope,
  isProfitabilitySnapshotStatus,
  type ProfitabilityCoachingFlag,
  type ProfitabilityRecommendationFlag,
  type ProfitabilitySnapshot
} from "../src/domain/profitability/index.js";

function createSnapshot(): ProfitabilitySnapshot {
  return {
    snapshotId: "snapshot-1",
    tenantId: "tenant-1",
    snapshotScope: "job",
    scopeId: "shoot-1",
    scopeLabel: "Spring Picture Day",
    calculationVersionId: "calc-1",
    snapshotStatus: "fresh",
    capturedAt: "2026-03-28T20:00:00.000Z",
    staleMarkedAt: null,
    staleReason: null,
    sourceWindowStart: "2026-03-01",
    sourceWindowEnd: "2026-03-31",
    jobId: "shoot-1",
    accountId: "org-1",
    seasonId: "2026-spring",
    divisionId: "schools",
    staffId: "staff-1",
    locationId: "location-1",
    metricValues: [
      {
        metricKey: "gross_revenue",
        numericValue: 4250
      },
      {
        metricKey: "fully_loaded_margin",
        numericValue: 1325
      },
      {
        metricKey: "on_time_rate",
        percentageValue: 0.96
      },
      {
        metricKey: "remake_follow_up_count",
        countValue: 2
      },
      {
        metricKey: "shoot_readiness_signal",
        signalValue: "watch"
      }
    ],
    lineageReferences: [
      {
        sourceType: "imported",
        sourceEntity: "profitability_revenue_entry",
        sourceId: "revenue-entry-1"
      }
    ],
    overrideCount: 1,
    recommendationCount: 1,
    coachingFlagCount: 1,
    createdAt: "2026-03-28T20:00:00.000Z"
  };
}

describe("profitability domain foundation", () => {
  it("exposes deterministic profitability registries and guards", () => {
    expect(new Set(PROFITABILITY_METRIC_KEY_REGISTRY).size).toBe(
      PROFITABILITY_METRIC_KEY_REGISTRY.length
    );
    expect(new Set(PROFITABILITY_SNAPSHOT_SCOPE_REGISTRY).size).toBe(
      PROFITABILITY_SNAPSHOT_SCOPE_REGISTRY.length
    );
    expect(new Set(PROFITABILITY_SNAPSHOT_STATUS_REGISTRY).size).toBe(
      PROFITABILITY_SNAPSHOT_STATUS_REGISTRY.length
    );
    expect(new Set(PROFITABILITY_IMPORT_RUN_MODE_REGISTRY).size).toBe(
      PROFITABILITY_IMPORT_RUN_MODE_REGISTRY.length
    );
    expect(new Set(PROFITABILITY_IMPORT_RUN_STATUS_REGISTRY).size).toBe(
      PROFITABILITY_IMPORT_RUN_STATUS_REGISTRY.length
    );

    expect(isProfitabilityMetricKey("gross_revenue")).toBe(true);
    expect(isProfitabilitySnapshotScope("job")).toBe(true);
    expect(isProfitabilitySnapshotStatus("fresh")).toBe(true);
    expect(isProfitabilityImportRunMode("dry_run")).toBe(true);
    expect(isProfitabilityImportRunStatus("completed")).toBe(true);

    expect(isProfitabilityMetricKey("gross_margin")).toBe(false);
    expect(isProfitabilitySnapshotScope("tenant")).toBe(false);
    expect(isProfitabilitySnapshotStatus("current")).toBe(false);
  });

  it("keeps leadership-only and employee-safe metric sets distinct", () => {
    const leadershipKeys = getLeadershipProfitabilityMetricKeys();
    const employeeSafeKeys = getEmployeeSafeProfitabilityMetricKeys();

    expect(leadershipKeys).toContain("gross_revenue");
    expect(leadershipKeys).toContain("fully_loaded_margin");
    expect(employeeSafeKeys).toContain("on_time_rate");
    expect(employeeSafeKeys).toContain("shoot_readiness_signal");
    expect(employeeSafeKeys).not.toContain("gross_revenue");
    expect(leadershipKeys).not.toContain("on_time_rate");
  });

  it("creates leadership projections with both financial metrics and employee-safe signals", () => {
    const recommendationFlags: ProfitabilityRecommendationFlag[] = [
      {
        recommendationFlagId: "recommendation-1",
        tenantId: "tenant-1",
        snapshotId: "snapshot-1",
        scopeType: "job",
        scopeId: "shoot-1",
        recommendationType: "review-pricing",
        severity: "warning",
        title: "Review pricing",
        message: "Low fully loaded margin compared with seasonal peers.",
        driverMetrics: ["fully_loaded_margin"],
        createdAt: "2026-03-28T20:00:00.000Z",
        dismissedAt: null,
        dismissedByActorId: null
      }
    ];

    const projection = createLeadershipProfitabilityProjection(
      createSnapshot(),
      recommendationFlags
    );

    expect(projection.audience).toBe("leadership");
    expect(projection.financialMetrics.map((metric) => metric.metricKey)).toEqual(
      expect.arrayContaining(["gross_revenue", "fully_loaded_margin"])
    );
    expect(projection.employeeSafeSignals.map((metric) => metric.metricKey)).toEqual(
      expect.arrayContaining(["on_time_rate", "shoot_readiness_signal"])
    );
    expect(projection.recommendationFlags).toHaveLength(1);
  });

  it("creates employee-safe projections that exclude leadership-only financial metrics", () => {
    const coachingFlags: ProfitabilityCoachingFlag[] = [
      {
        coachingFlagId: "coaching-1",
        tenantId: "tenant-1",
        snapshotId: "snapshot-1",
        staffId: "staff-1",
        jobId: "shoot-1",
        flagType: "readiness-follow-up",
        severity: "watch",
        title: "Readiness follow-up",
        message: "Setup photo and note prep need attention before call time.",
        signalKey: "shoot_readiness_signal",
        createdAt: "2026-03-28T20:00:00.000Z",
        resolvedAt: null,
        resolvedByActorId: null
      }
    ];

    const snapshot = createSnapshot();
    const projection = createEmployeeSafeProfitabilityProjection(snapshot, coachingFlags);

    expect(projection.audience).toBe("employee_safe");
    expect(projection.metricValues.map((metric) => metric.metricKey)).toEqual([
      "on_time_rate",
      "remake_follow_up_count",
      "shoot_readiness_signal"
    ]);
    expect(projection.coachingFlags).toHaveLength(1);
    expect(Object.keys(projection.coachingFlags[0])).not.toContain("signalPayload");
    expect(Object.keys(projection.coachingFlags[0])).not.toContain("tenantId");
    expect(JSON.stringify(projection)).not.toContain("gross_revenue");
    expect(JSON.stringify(projection)).not.toContain("4250");
    expect(JSON.stringify(projection)).not.toContain("fully_loaded_margin");
  });

  it("marks only non-currency employee-safe metric values as safe for employee payloads", () => {
    const grossRevenueDefinition = getProfitabilityMetricDefinition("gross_revenue");
    const onTimeDefinition = getProfitabilityMetricDefinition("on_time_rate");

    expect(grossRevenueDefinition.visibility).toBe("leadership_only");
    expect(onTimeDefinition.visibility).toBe("employee_safe");
    expect(onTimeDefinition.unit).toBe("percentage");

    expect(
      isEmployeeSafeProfitabilityMetricValue({
        metricKey: "on_time_rate",
        percentageValue: 0.91
      })
    ).toBe(true);

    expect(
      isEmployeeSafeProfitabilityMetricValue({
        metricKey: "gross_revenue",
        numericValue: 1800
      })
    ).toBe(false);
  });
});
