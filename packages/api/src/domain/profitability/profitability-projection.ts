import {
  getLeadershipProfitabilityMetricKeys,
  getProfitabilityMetricDefinition
} from "./profitability-contract.registry.js";
import type { ProfitabilityMetricKey } from "./profitability-phase0-contract.js";
import type {
  ProfitabilityCoachingFlag,
  ProfitabilityRecommendationFlag,
  ProfitabilitySnapshot,
  ProfitabilitySnapshotMetricValue
} from "./profitability-snapshot.js";

export interface LeadershipProfitabilityMetricProjection {
  metricKey: ProfitabilityMetricKey;
  label: string;
  unit: string;
  numericValue?: number | null;
  percentageValue?: number | null;
  countValue?: number | null;
  signalValue?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LeadershipProfitabilityProjection {
  audience: "leadership";
  snapshotId: string;
  snapshotScope: ProfitabilitySnapshot["snapshotScope"];
  scopeId: string;
  scopeLabel: string | null;
  calculationVersionId: string;
  snapshotStatus: ProfitabilitySnapshot["snapshotStatus"];
  capturedAt: string;
  staleMarkedAt: string | null;
  financialMetrics: LeadershipProfitabilityMetricProjection[];
  employeeSafeSignals: LeadershipProfitabilityMetricProjection[];
  recommendationFlags: ProfitabilityRecommendationFlag[];
}

export interface EmployeeSafeProfitabilityMetricProjection {
  metricKey: ProfitabilityMetricKey;
  label: string;
  unit: string;
  percentageValue?: number | null;
  countValue?: number | null;
  signalValue?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EmployeeSafeProfitabilityProjection {
  audience: "employee_safe";
  snapshotId: string;
  snapshotScope: ProfitabilitySnapshot["snapshotScope"];
  scopeId: string;
  scopeLabel: string | null;
  capturedAt: string;
  snapshotStatus: ProfitabilitySnapshot["snapshotStatus"];
  metricValues: EmployeeSafeProfitabilityMetricProjection[];
  coachingFlags: EmployeeSafeCoachingFlagProjection[];
}

export interface EmployeeSafeCoachingFlagProjection {
  coachingFlagId: string;
  jobId: string | null;
  flagType: string;
  severity: ProfitabilityCoachingFlag["severity"];
  title: string;
  message: string;
  signalKey: ProfitabilityCoachingFlag["signalKey"];
  createdAt: string;
  resolvedAt: string | null;
}

function toLeadershipMetricProjection(
  metricValue: ProfitabilitySnapshotMetricValue
): LeadershipProfitabilityMetricProjection {
  const definition = getProfitabilityMetricDefinition(metricValue.metricKey);

  return {
    metricKey: metricValue.metricKey,
    label: definition.label,
    unit: definition.unit,
    numericValue: metricValue.numericValue ?? null,
    percentageValue: metricValue.percentageValue ?? null,
    countValue: metricValue.countValue ?? null,
    signalValue: metricValue.signalValue ?? null,
    metadata: metricValue.metadata
  };
}

function toEmployeeSafeMetricProjection(
  metricValue: ProfitabilitySnapshotMetricValue
): EmployeeSafeProfitabilityMetricProjection {
  const definition = getProfitabilityMetricDefinition(metricValue.metricKey);

  return {
    metricKey: metricValue.metricKey,
    label: definition.label,
    unit: definition.unit,
    percentageValue: metricValue.percentageValue ?? null,
    countValue: metricValue.countValue ?? null,
    signalValue: metricValue.signalValue ?? null,
    metadata: metricValue.metadata
  };
}

export function createLeadershipProfitabilityProjection(
  snapshot: ProfitabilitySnapshot,
  recommendationFlags: ReadonlyArray<ProfitabilityRecommendationFlag> = []
): LeadershipProfitabilityProjection {
  const leadershipMetricKeys = new Set<ProfitabilityMetricKey>(
    getLeadershipProfitabilityMetricKeys()
  );

  const financialMetrics = snapshot.metricValues
    .filter((metricValue) => leadershipMetricKeys.has(metricValue.metricKey))
    .map(toLeadershipMetricProjection);

  const employeeSafeSignals = snapshot.metricValues
    .filter((metricValue) => !leadershipMetricKeys.has(metricValue.metricKey))
    .map(toLeadershipMetricProjection);

  return {
    audience: "leadership",
    snapshotId: snapshot.snapshotId,
    snapshotScope: snapshot.snapshotScope,
    scopeId: snapshot.scopeId,
    scopeLabel: snapshot.scopeLabel,
    calculationVersionId: snapshot.calculationVersionId,
    snapshotStatus: snapshot.snapshotStatus,
    capturedAt: snapshot.capturedAt,
    staleMarkedAt: snapshot.staleMarkedAt,
    financialMetrics,
    employeeSafeSignals,
    recommendationFlags: [...recommendationFlags]
  };
}

export function isEmployeeSafeProfitabilityMetricValue(
  metricValue: ProfitabilitySnapshotMetricValue
): boolean {
  const definition = getProfitabilityMetricDefinition(metricValue.metricKey);

  return definition.visibility === "employee_safe" && definition.unit !== "currency";
}

export function createEmployeeSafeProfitabilityProjection(
  snapshot: ProfitabilitySnapshot,
  coachingFlags: ReadonlyArray<ProfitabilityCoachingFlag> = []
): EmployeeSafeProfitabilityProjection {
  const metricValues = snapshot.metricValues
    .filter(isEmployeeSafeProfitabilityMetricValue)
    .map(toEmployeeSafeMetricProjection);

  return {
    audience: "employee_safe",
    snapshotId: snapshot.snapshotId,
    snapshotScope: snapshot.snapshotScope,
    scopeId: snapshot.scopeId,
    scopeLabel: snapshot.scopeLabel,
    capturedAt: snapshot.capturedAt,
    snapshotStatus: snapshot.snapshotStatus,
    metricValues,
    coachingFlags: coachingFlags.map((coachingFlag) => ({
      coachingFlagId: coachingFlag.coachingFlagId,
      jobId: coachingFlag.jobId,
      flagType: coachingFlag.flagType,
      severity: coachingFlag.severity,
      title: coachingFlag.title,
      message: coachingFlag.message,
      signalKey: coachingFlag.signalKey,
      createdAt: coachingFlag.createdAt,
      resolvedAt: coachingFlag.resolvedAt
    }))
  };
}
