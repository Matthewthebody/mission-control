export type ProfitabilityWorkerJobType =
  | "profitability.import.validate"
  | "profitability.import.apply"
  | "profitability.snapshot.refresh"
  | "profitability.snapshot.refresh-range"
  | "profitability.recommendations.refresh"
  | "profitability.coaching-flags.refresh"
  | "profitability.stale-snapshot.scan";

export type ProfitabilityRefreshScope =
  | "job"
  | "account"
  | "season"
  | "division"
  | "staff"
  | "date_range"
  | "full_rebuild";

export type ProfitabilityRefreshJobPayload = {
  tenantId: string;
  scope: ProfitabilityRefreshScope;
  scopeIds?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  calculationVersionTag?: string | null;
  reason: string;
  staleSourceEvent?: string | null;
};

export type ProfitabilityImportJobPayload = {
  tenantId: string;
  importRunId: string;
  sourceType:
    | "revenue_summary"
    | "lab_cost"
    | "shipping_cost"
    | "support_burden"
    | "specialty_revenue"
    | "yearbook_revenue";
  runMode: "dry_run" | "apply";
  requestedBy: string;
};

export type ProfitabilityRecommendationRefreshPayload = {
  tenantId: string;
  snapshotIds?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  reason: string;
};
