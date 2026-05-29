export const PROFITABILITY_METRIC_KEY_REGISTRY = [
  "gross_revenue",
  "adjusted_revenue",
  "net_operating_revenue",
  "direct_job_cost",
  "contribution_margin",
  "allocated_overhead_cost",
  "fully_loaded_margin",
  "profit_per_subject",
  "profit_per_labor_hour",
  "customer_service_burden_cost",
  "remake_cost",
  "reshoot_cost",
  "operational_burden_score",
  "on_time_rate",
  "clock_exception_rate",
  "setup_photo_completion_rate",
  "post_shoot_evaluation_completion_rate",
  "issue_free_shoot_rate",
  "remake_follow_up_count",
  "qa_return_for_fix_rate",
  "shoot_complexity_signal",
  "shoot_readiness_signal"
] as const;

export type ProfitabilityMetricKey = (typeof PROFITABILITY_METRIC_KEY_REGISTRY)[number];

export const PROFITABILITY_METRIC_VISIBILITY_REGISTRY = [
  "leadership_only",
  "employee_safe"
] as const;

export type ProfitabilityMetricVisibility =
  (typeof PROFITABILITY_METRIC_VISIBILITY_REGISTRY)[number];

export const PROFITABILITY_AGGREGATION_LEVEL_REGISTRY = [
  "job",
  "account",
  "season",
  "division",
  "staff",
  "location",
  "dashboard"
] as const;

export type ProfitabilityAggregationLevel =
  (typeof PROFITABILITY_AGGREGATION_LEVEL_REGISTRY)[number];

export const PROFITABILITY_VALUE_UNIT_REGISTRY = [
  "currency",
  "percentage",
  "hours",
  "subjects",
  "score",
  "count",
  "ratio",
  "signal"
] as const;

export type ProfitabilityValueUnit = (typeof PROFITABILITY_VALUE_UNIT_REGISTRY)[number];

export const PROFITABILITY_SOURCE_OF_TRUTH_OWNER_REGISTRY = [
  "operational",
  "imported",
  "derived"
] as const;

export type ProfitabilitySourceOfTruthOwner =
  (typeof PROFITABILITY_SOURCE_OF_TRUTH_OWNER_REGISTRY)[number];

export const PROFITABILITY_RECALC_SCOPE_REGISTRY = [
  "job",
  "account",
  "season",
  "division",
  "staff",
  "date_range",
  "full_rebuild"
] as const;

export type ProfitabilityRecalcScope = (typeof PROFITABILITY_RECALC_SCOPE_REGISTRY)[number];

export const PROFITABILITY_IMPORT_SOURCE_REGISTRY = [
  "revenue_summary",
  "lab_cost",
  "shipping_cost",
  "support_burden",
  "specialty_revenue",
  "yearbook_revenue"
] as const;

export type ProfitabilityImportSource = (typeof PROFITABILITY_IMPORT_SOURCE_REGISTRY)[number];

export const PROFITABILITY_JOB_TYPE_REGISTRY = [
  "profitability.import.validate",
  "profitability.import.apply",
  "profitability.snapshot.refresh",
  "profitability.snapshot.refresh-range",
  "profitability.recommendations.refresh",
  "profitability.coaching-flags.refresh",
  "profitability.stale-snapshot.scan"
] as const;

export type ProfitabilityJobType = (typeof PROFITABILITY_JOB_TYPE_REGISTRY)[number];

export const PROFITABILITY_API_AUDIENCE_REGISTRY = [
  "leadership",
  "employee_safe",
  "admin"
] as const;

export type ProfitabilityApiAudience = (typeof PROFITABILITY_API_AUDIENCE_REGISTRY)[number];

const PROFITABILITY_METRIC_KEY_SET = new Set<string>(PROFITABILITY_METRIC_KEY_REGISTRY);
const PROFITABILITY_METRIC_VISIBILITY_SET = new Set<string>(
  PROFITABILITY_METRIC_VISIBILITY_REGISTRY
);
const PROFITABILITY_AGGREGATION_LEVEL_SET = new Set<string>(
  PROFITABILITY_AGGREGATION_LEVEL_REGISTRY
);
const PROFITABILITY_VALUE_UNIT_SET = new Set<string>(PROFITABILITY_VALUE_UNIT_REGISTRY);
const PROFITABILITY_SOURCE_OF_TRUTH_OWNER_SET = new Set<string>(
  PROFITABILITY_SOURCE_OF_TRUTH_OWNER_REGISTRY
);
const PROFITABILITY_RECALC_SCOPE_SET = new Set<string>(PROFITABILITY_RECALC_SCOPE_REGISTRY);
const PROFITABILITY_IMPORT_SOURCE_SET = new Set<string>(PROFITABILITY_IMPORT_SOURCE_REGISTRY);
const PROFITABILITY_JOB_TYPE_SET = new Set<string>(PROFITABILITY_JOB_TYPE_REGISTRY);
const PROFITABILITY_API_AUDIENCE_SET = new Set<string>(PROFITABILITY_API_AUDIENCE_REGISTRY);

export function isProfitabilityMetricKey(value: string): value is ProfitabilityMetricKey {
  return PROFITABILITY_METRIC_KEY_SET.has(value);
}

export function isProfitabilityMetricVisibility(
  value: string
): value is ProfitabilityMetricVisibility {
  return PROFITABILITY_METRIC_VISIBILITY_SET.has(value);
}

export function isProfitabilityAggregationLevel(
  value: string
): value is ProfitabilityAggregationLevel {
  return PROFITABILITY_AGGREGATION_LEVEL_SET.has(value);
}

export function isProfitabilityValueUnit(value: string): value is ProfitabilityValueUnit {
  return PROFITABILITY_VALUE_UNIT_SET.has(value);
}

export function isProfitabilitySourceOfTruthOwner(
  value: string
): value is ProfitabilitySourceOfTruthOwner {
  return PROFITABILITY_SOURCE_OF_TRUTH_OWNER_SET.has(value);
}

export function isProfitabilityRecalcScope(value: string): value is ProfitabilityRecalcScope {
  return PROFITABILITY_RECALC_SCOPE_SET.has(value);
}

export function isProfitabilityImportSource(
  value: string
): value is ProfitabilityImportSource {
  return PROFITABILITY_IMPORT_SOURCE_SET.has(value);
}

export function isProfitabilityJobType(value: string): value is ProfitabilityJobType {
  return PROFITABILITY_JOB_TYPE_SET.has(value);
}

export function isProfitabilityApiAudience(
  value: string
): value is ProfitabilityApiAudience {
  return PROFITABILITY_API_AUDIENCE_SET.has(value);
}

export interface ProfitabilityDefinition {
  key: ProfitabilityMetricKey;
  label: string;
  visibility: ProfitabilityMetricVisibility;
  unit: ProfitabilityValueUnit;
  aggregation_levels: ProfitabilityAggregationLevel[];
  definition: string;
  formula_summary: string;
}

export interface ProfitabilitySourceOfTruthRule {
  subject: string;
  owner: ProfitabilitySourceOfTruthOwner;
  source_entities: string[];
  notes: string;
}

export interface ProfitabilityIdentityRule {
  identity: string;
  canonical_source: string;
  profitability_alias: string;
  mapping_rule: string;
  fallback_rule: string;
  notes: string;
}

export interface ProfitabilityImportContract {
  source: ProfitabilityImportSource;
  description: string;
  required_mapping_keys: string[];
  required_fields: string[];
  dry_run_supported: boolean;
  lineage_fields: string[];
}

export interface ProfitabilityPermissionMatrixRow {
  audience: string;
  leadership_projection_access: string;
  employee_projection_access: string;
  import_access: string;
  override_access: string;
  notes: string;
}

export interface ProfitabilityRecalcTrigger {
  trigger: string;
  source_event: string;
  scope: ProfitabilityRecalcScope;
  job_type: ProfitabilityJobType;
  stale_marking_behavior: string;
}

export interface ProfitabilitySchemaTableProposal {
  table: string;
  purpose: string;
  key_columns: string[];
  notes: string;
}

export interface ProfitabilityApiSurfaceProposal {
  route_group: string;
  audience: ProfitabilityApiAudience;
  endpoints: string[];
  includes_financial_fields: boolean;
  notes: string;
}

export interface ProfitabilitySnapshotStrategy {
  live_source_policy: string;
  snapshot_tables: string[];
  versioning_strategy: string;
  stale_marking_strategy: string;
}

export interface ProfitabilityCalculationLifecyclePlan {
  versioning: string;
  reproducibility: string;
  override_policy: string;
  backfill_policy: string;
}

export interface ProfitabilityAuditAndObservabilityPlan {
  audit_events: string[];
  operational_metrics: string[];
  traceability_requirements: string[];
}

export interface ProfitabilityRolloutPhase {
  phase: string;
  scope: string;
  exit_criteria: string[];
}

export interface ProfitabilityBackfillPlan {
  initial_window: string;
  sequencing: string[];
  safety_notes: string[];
}

export interface ProfitabilityPhase0Contract {
  domain_name: "Profitability";
  architecture_choice: string;
  dictionary: ProfitabilityDefinition[];
  source_of_truth_matrix: ProfitabilitySourceOfTruthRule[];
  identity_rules: ProfitabilityIdentityRule[];
  permissions_matrix: ProfitabilityPermissionMatrixRow[];
  import_contracts: ProfitabilityImportContract[];
  recalc_triggers: ProfitabilityRecalcTrigger[];
  schema_proposal: ProfitabilitySchemaTableProposal[];
  api_surface_proposal: ProfitabilityApiSurfaceProposal[];
  snapshot_strategy: ProfitabilitySnapshotStrategy;
  calculation_lifecycle: ProfitabilityCalculationLifecyclePlan;
  audit_and_observability_plan: ProfitabilityAuditAndObservabilityPlan;
  rollout_plan: {
    phases: ProfitabilityRolloutPhase[];
  };
  backfill_plan: ProfitabilityBackfillPlan;
}
