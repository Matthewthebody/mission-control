import type {
  ProfitabilityImportSource,
  ProfitabilityMetricKey
} from "./profitability-phase0-contract.js";

export const PROFITABILITY_SNAPSHOT_SCOPE_REGISTRY = [
  "job",
  "account",
  "season",
  "division",
  "staff",
  "location",
  "dashboard"
] as const;

export type ProfitabilitySnapshotScope =
  (typeof PROFITABILITY_SNAPSHOT_SCOPE_REGISTRY)[number];

export const PROFITABILITY_SNAPSHOT_STATUS_REGISTRY = [
  "pending",
  "fresh",
  "stale",
  "failed",
  "restated"
] as const;

export type ProfitabilitySnapshotStatus =
  (typeof PROFITABILITY_SNAPSHOT_STATUS_REGISTRY)[number];

export const PROFITABILITY_IMPORT_RUN_MODE_REGISTRY = ["dry_run", "apply"] as const;

export type ProfitabilityImportRunMode =
  (typeof PROFITABILITY_IMPORT_RUN_MODE_REGISTRY)[number];

export const PROFITABILITY_IMPORT_RUN_STATUS_REGISTRY = [
  "queued",
  "running",
  "completed",
  "completed_with_issues",
  "failed"
] as const;

export type ProfitabilityImportRunStatus =
  (typeof PROFITABILITY_IMPORT_RUN_STATUS_REGISTRY)[number];

export const PROFITABILITY_IMPORT_VALIDATION_ISSUE_SEVERITY_REGISTRY = [
  "info",
  "warning",
  "blocking"
] as const;

export type ProfitabilityImportValidationIssueSeverity =
  (typeof PROFITABILITY_IMPORT_VALIDATION_ISSUE_SEVERITY_REGISTRY)[number];

export const PROFITABILITY_OVERRIDE_TYPE_REGISTRY = [
  "revenue_adjustment",
  "expense_restatement",
  "allocation_override",
  "mapping_override",
  "snapshot_restated",
  "coaching_signal_suppression",
  "recommendation_dismissal"
] as const;

export type ProfitabilityOverrideType =
  (typeof PROFITABILITY_OVERRIDE_TYPE_REGISTRY)[number];

export const PROFITABILITY_FLAG_SEVERITY_REGISTRY = [
  "info",
  "watch",
  "warning",
  "critical"
] as const;

export type ProfitabilityFlagSeverity =
  (typeof PROFITABILITY_FLAG_SEVERITY_REGISTRY)[number];

const PROFITABILITY_SNAPSHOT_SCOPE_SET = new Set<string>(
  PROFITABILITY_SNAPSHOT_SCOPE_REGISTRY
);
const PROFITABILITY_SNAPSHOT_STATUS_SET = new Set<string>(
  PROFITABILITY_SNAPSHOT_STATUS_REGISTRY
);
const PROFITABILITY_IMPORT_RUN_MODE_SET = new Set<string>(
  PROFITABILITY_IMPORT_RUN_MODE_REGISTRY
);
const PROFITABILITY_IMPORT_RUN_STATUS_SET = new Set<string>(
  PROFITABILITY_IMPORT_RUN_STATUS_REGISTRY
);
const PROFITABILITY_IMPORT_VALIDATION_ISSUE_SEVERITY_SET = new Set<string>(
  PROFITABILITY_IMPORT_VALIDATION_ISSUE_SEVERITY_REGISTRY
);
const PROFITABILITY_OVERRIDE_TYPE_SET = new Set<string>(
  PROFITABILITY_OVERRIDE_TYPE_REGISTRY
);
const PROFITABILITY_FLAG_SEVERITY_SET = new Set<string>(
  PROFITABILITY_FLAG_SEVERITY_REGISTRY
);

export function isProfitabilitySnapshotScope(
  value: string
): value is ProfitabilitySnapshotScope {
  return PROFITABILITY_SNAPSHOT_SCOPE_SET.has(value);
}

export function isProfitabilitySnapshotStatus(
  value: string
): value is ProfitabilitySnapshotStatus {
  return PROFITABILITY_SNAPSHOT_STATUS_SET.has(value);
}

export function isProfitabilityImportRunMode(
  value: string
): value is ProfitabilityImportRunMode {
  return PROFITABILITY_IMPORT_RUN_MODE_SET.has(value);
}

export function isProfitabilityImportRunStatus(
  value: string
): value is ProfitabilityImportRunStatus {
  return PROFITABILITY_IMPORT_RUN_STATUS_SET.has(value);
}

export function isProfitabilityImportValidationIssueSeverity(
  value: string
): value is ProfitabilityImportValidationIssueSeverity {
  return PROFITABILITY_IMPORT_VALIDATION_ISSUE_SEVERITY_SET.has(value);
}

export function isProfitabilityOverrideType(
  value: string
): value is ProfitabilityOverrideType {
  return PROFITABILITY_OVERRIDE_TYPE_SET.has(value);
}

export function isProfitabilityFlagSeverity(
  value: string
): value is ProfitabilityFlagSeverity {
  return PROFITABILITY_FLAG_SEVERITY_SET.has(value);
}

export interface ProfitabilityCalculationVersion {
  calculationVersionId: string;
  tenantId: string;
  versionTag: string;
  definitionHash: string;
  formulaBundleVersion: string;
  allocationBundleVersion: string;
  recommendationBundleVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdByActorId: string;
  createdAt: string;
}

export interface ProfitabilityImportRun {
  importRunId: string;
  tenantId: string;
  sourceType: ProfitabilityImportSource;
  runMode: ProfitabilityImportRunMode;
  status: ProfitabilityImportRunStatus;
  fileName: string | null;
  batchReference: string | null;
  requestedByActorId: string;
  startedAt: string;
  completedAt: string | null;
  sourceLineCount: number;
  appliedLineCount: number;
  rejectedLineCount: number;
  mappingConfig: Record<string, unknown>;
  dryRunSummary: Record<string, unknown> | null;
  errorSummary: Record<string, unknown> | null;
}

export interface ProfitabilityImportValidationIssue {
  validationIssueId: string;
  tenantId: string;
  importRunId: string;
  severity: ProfitabilityImportValidationIssueSeverity;
  issueCode: string;
  message: string;
  fieldName: string | null;
  rowNumber: number | null;
  sourceLineHash: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByActorId: string | null;
}

export interface ProfitabilitySnapshotMetricValue {
  metricKey: ProfitabilityMetricKey;
  numericValue?: number | null;
  percentageValue?: number | null;
  countValue?: number | null;
  signalValue?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProfitabilitySnapshotLineageReference {
  sourceType: "operational" | "imported" | "allocation" | "override";
  sourceEntity: string;
  sourceId: string;
  sourceVersionTag?: string | null;
  notes?: string | null;
}

export interface ProfitabilitySnapshot {
  snapshotId: string;
  tenantId: string;
  snapshotScope: ProfitabilitySnapshotScope;
  scopeId: string;
  scopeLabel: string | null;
  calculationVersionId: string;
  snapshotStatus: ProfitabilitySnapshotStatus;
  capturedAt: string;
  staleMarkedAt: string | null;
  staleReason: string | null;
  sourceWindowStart: string | null;
  sourceWindowEnd: string | null;
  jobId: string | null;
  accountId: string | null;
  seasonId: string | null;
  divisionId: string | null;
  staffId: string | null;
  locationId: string | null;
  metricValues: ProfitabilitySnapshotMetricValue[];
  lineageReferences: ProfitabilitySnapshotLineageReference[];
  overrideCount: number;
  recommendationCount: number;
  coachingFlagCount: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ProfitabilityOverride {
  overrideId: string;
  tenantId: string;
  targetScope: ProfitabilitySnapshotScope;
  targetId: string;
  snapshotId: string | null;
  calculationVersionId: string | null;
  overrideType: ProfitabilityOverrideType;
  reason: string;
  previousValue: Record<string, unknown> | null;
  overrideValue: Record<string, unknown>;
  createdByActorId: string;
  createdAt: string;
  revertedAt: string | null;
  revertedByActorId: string | null;
  revertReason: string | null;
}

export interface ProfitabilityCoachingFlag {
  coachingFlagId: string;
  tenantId: string;
  snapshotId: string;
  staffId: string;
  jobId: string | null;
  flagType: string;
  severity: ProfitabilityFlagSeverity;
  title: string;
  message: string;
  signalKey: ProfitabilityMetricKey;
  signalPayload?: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByActorId: string | null;
}

export interface ProfitabilityRecommendationFlag {
  recommendationFlagId: string;
  tenantId: string;
  snapshotId: string;
  scopeType: ProfitabilitySnapshotScope;
  scopeId: string;
  recommendationType: string;
  severity: ProfitabilityFlagSeverity;
  title: string;
  message: string;
  driverMetrics: ProfitabilityMetricKey[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  dismissedAt: string | null;
  dismissedByActorId: string | null;
}

export interface ProfitabilityDashboardMetricSnapshot {
  dashboardMetricSnapshotId: string;
  tenantId: string;
  audience: "leadership" | "employee_safe" | "admin";
  metricKey: ProfitabilityMetricKey;
  scopeType: ProfitabilitySnapshotScope;
  scopeId: string;
  snapshotId: string;
  capturedAt: string;
  numericValue?: number | null;
  percentageValue?: number | null;
  countValue?: number | null;
  signalValue?: string | null;
  metadata?: Record<string, unknown>;
}
