export const CENTRAL_JOB_RECORD_STATES = ["draft", "published", "cancelled", "archived"] as const;
export type CentralJobRecordState = (typeof CENTRAL_JOB_RECORD_STATES)[number];

export const CENTRAL_JOB_STATUSES = [
  "new",
  "confirmed",
  "scheduled",
  "in_progress",
  "in_production",
  "complete",
  "cancelled"
] as const;
export type CentralJobStatus = (typeof CENTRAL_JOB_STATUSES)[number];

export const CENTRAL_JOB_READINESS_STATUSES = ["blocked", "needs_info", "ready"] as const;
export type CentralJobReadinessStatus = (typeof CENTRAL_JOB_READINESS_STATUSES)[number];

export const CENTRAL_JOB_DEPARTMENTS = ["schools", "sports"] as const;
export type CentralJobDepartment = (typeof CENTRAL_JOB_DEPARTMENTS)[number];

export const CENTRAL_JOB_REQUEST_SOURCES = [
  "manual",
  "smart_paste",
  "bulk_import",
  "api",
  "converted_from_inquiry",
  "internal_request"
] as const;
export type CentralJobRequestSource = (typeof CENTRAL_JOB_REQUEST_SOURCES)[number];

export const CENTRAL_JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CentralJobPriority = (typeof CENTRAL_JOB_PRIORITIES)[number];

export const CENTRAL_JOB_DELIVERY_TYPES = [
  "ship_to_home",
  "school_delivery",
  "digital_gallery",
  "specialty_products",
  "mixed"
] as const;
export type CentralJobDeliveryType = (typeof CENTRAL_JOB_DELIVERY_TYPES)[number];

export const CENTRAL_JOB_PRODUCTION_GROUPING_RULES = [
  "one_per_job",
  "one_per_day",
  "one_per_delivery",
  "one_per_gallery",
  "manual"
] as const;
export type CentralJobProductionGroupingRule = (typeof CENTRAL_JOB_PRODUCTION_GROUPING_RULES)[number];
