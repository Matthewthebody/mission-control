import type { SharedMaskingStrategy, SharedSensitivityCategory } from "../types/auth.js";
import type { JobDepartmentType, WorkDepartmentType } from "../domain/jobTruth/index.js";

export type ConciergeEntityType =
  | "organization"
  | "contact"
  | "location"
  | "shoot"
  | "production_item"
  | "task"
  | "resource_library_item"
  | "note"
  | "comment"
  | "staffing_assignment"
  | "urgent_watch_alert"
  | "post_shoot_evaluation";

export type ConciergeDepartmentFilter = JobDepartmentType | WorkDepartmentType | "all";

export type ConciergeResultTone = "neutral" | "info" | "warning" | "critical";

export type ConciergeHasFilter = "notes" | "alerts" | "staffing_gap";

export type ConciergeDateFilter = "today" | "tomorrow" | "next_24h" | "next_7d" | "overdue";

export type ConciergeQuickActionKey = "open" | "view_notes" | "view_staffing" | "view_production" | "create_task";

export type ConciergeAccessSearchScope =
  | "jobs"
  | "locations"
  | "organizations"
  | "contacts"
  | "staffing_assignments"
  | "sops_files"
  | "production";

export type ConciergeIntentKind =
  | "direct_lookup"
  | "contact_lookup"
  | "risk_review"
  | "staffing_review"
  | "issue_lookup"
  | "note_history_lookup"
  | "overdue_work_lookup"
  | "production_blockage_lookup";

export type ConciergeAnswerCardKind =
  | "best_match"
  | "contact_lookup"
  | "risk_review"
  | "staffing_review"
  | "issue_lookup"
  | "note_history_lookup"
  | "overdue_work_lookup"
  | "production_blockage_lookup";

export type ConciergeAccessScope = "shared" | "department" | "assigned" | "manager" | "leadership" | "private";

export type ConciergePermissionEnvelope = {
  access_scope?: ConciergeAccessScope;
  sensitivity?: SharedSensitivityCategory;
  allowed_department_codes?: string[];
  principal_user_ids?: string[];
  manager_user_ids?: string[];
  masking_strategy?: SharedMaskingStrategy | null;
  allow_snippet_preview?: boolean;
  allow_answer_summary?: boolean;
};

export type ConciergeSearchPermissionPayload =
  | (ConciergePermissionEnvelope & {
      access_model: "directory";
    })
  | (ConciergePermissionEnvelope & {
      access_model: "shoot";
      department: string | null;
    })
  | (ConciergePermissionEnvelope & {
      access_model: "production_item";
      department: JobDepartmentType | null;
    })
  | (ConciergePermissionEnvelope & {
      access_model: "task";
      department: WorkDepartmentType | null;
      created_by_user_id: string | null;
    })
  | (ConciergePermissionEnvelope & {
      access_model: "resource_library_item";
      linked_scope: "shoot" | "location" | "organization" | "job" | "production_item";
      department: string | null;
      visibility_scope: "leadership_only" | "photographer_prep";
      approval_status: "pending_review" | "approved" | "leadership_only" | "rejected_not_useful";
      is_best_reference: boolean;
      uploader_user_id: string | null;
    })
  | (ConciergePermissionEnvelope & {
      access_model: "note";
      object_type: "shoot" | "shift" | "location" | "alert";
      visibility_scope: "object_viewers" | "assigned_staff_and_managers" | "managers_and_leadership" | "leadership_only";
      department: string | null;
      assigned_user_id: string | null;
      manager_user_id: string | null;
      assigned_user_ids: string[];
      lead_user_ids: string[];
    })
  | (ConciergePermissionEnvelope & {
      access_model: "comment";
      visibility: "standard_internal" | "manager_only" | "leadership_only";
      department: JobDepartmentType | null;
      principal_user_ids: string[];
    })
  | (ConciergePermissionEnvelope & {
      access_model: "staffing_assignment";
      department: JobDepartmentType | null;
      assigned_user_id: string | null;
      owner_user_id: string | null;
    })
  | (ConciergePermissionEnvelope & {
      access_model: "urgent_watch_alert";
      scope_department: string | null;
      owner_user_id: string | null;
    })
  | (ConciergePermissionEnvelope & {
      access_model: "post_shoot_evaluation";
      department: string | null;
      photographer_user_id: string | null;
      manager_user_id: string | null;
      assigned_user_ids: string[];
      lead_user_ids: string[];
    });

export type ConciergeSearchIndexRecord = {
  id: string;
  tenant_id: string;
  entity_type: ConciergeEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  body_search_text: string | null;
  status: string | null;
  department: ConciergeDepartmentFilter | null;
  org_id: string | null;
  org_name: string | null;
  owner_id: string | null;
  assignee_ids: string[];
  related_ids: string[];
  primary_date: string | null;
  risk_level: string | null;
  permissions_payload: ConciergeSearchPermissionPayload;
  deep_link: string;
  updated_at: string;
  activity_at: string | null;
  has_notes: boolean;
  has_alerts: boolean;
  has_staffing_gap: boolean;
};

export type ConciergeSearchIndexDocument = Omit<ConciergeSearchIndexRecord, "id">;

export type ConciergeQuickAction = {
  key: ConciergeQuickActionKey;
  label: string;
  deep_link: string;
};

export type ConciergeSearchIntent = {
  kind: ConciergeIntentKind;
  confidence: number;
  subject: string | null;
  person: string | null;
  department: ConciergeDepartmentFilter | null;
  date: ConciergeDateFilter | null;
  rationale: string;
};

export type ConciergeAnswerCardMetric = {
  label: string;
  value: string;
};

export type ConciergeAnswerCard = {
  id: string;
  kind: ConciergeAnswerCardKind;
  title: string;
  summary: string;
  tone: ConciergeResultTone;
  confidence: number;
  metrics: ConciergeAnswerCardMetric[];
  linked_result_ids: string[];
  actions: ConciergeQuickAction[];
};

export type ConciergeResultCluster = {
  id: string;
  title: string;
  summary: string;
  tone: ConciergeResultTone;
  results: ConciergeSearchResult[];
};

export type ConciergeSearchResult = {
  search_index_id: string;
  entity_type: ConciergeEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  snippet: string | null;
  status: string | null;
  department: ConciergeDepartmentFilter | null;
  org_id: string | null;
  org_name: string | null;
  primary_date: string | null;
  risk_level: string | null;
  deep_link: string;
  tone: ConciergeResultTone;
  score: number;
  has_notes: boolean;
  has_alerts: boolean;
  has_staffing_gap: boolean;
  quick_actions: ConciergeQuickAction[];
};

export type ConciergeSearchSection = {
  entity_type: ConciergeEntityType;
  title: string;
  total: number;
  results: ConciergeSearchResult[];
};

export type ConciergeAccessSearchMetadata = {
  label: string;
  value: string;
};

export type ConciergeAccessSearchResult = {
  search_index_id: string;
  entity_type: ConciergeEntityType;
  entity_id: string;
  scope: ConciergeAccessSearchScope;
  title: string;
  subtitle: string | null;
  status: string | null;
  primary_date: string | null;
  deep_link: string;
  score: number;
  metadata: ConciergeAccessSearchMetadata[];
};

export type ConciergeSearchFilters = {
  department: ConciergeDepartmentFilter | null;
  entity_types: ConciergeEntityType[];
  status: string | null;
  owner: string | null;
  assignee: string | null;
  org: string | null;
  date: ConciergeDateFilter | null;
  risk: string | null;
  has_any: ConciergeHasFilter[];
};

export type ConciergeSearchResponse = {
  product_name: "Kemmetmueller Concierge";
  query: string;
  total_results: number;
  access_limited: boolean;
  interpreted_intent: ConciergeSearchIntent | null;
  answer_cards: ConciergeAnswerCard[];
  related_clusters: ConciergeResultCluster[];
  sections: ConciergeSearchSection[];
  applied_filters: ConciergeSearchFilters;
  took_ms: number;
};

export type ConciergeAccessSearchResponse = {
  product_name: "Kemmetmueller Concierge";
  query: string;
  scopes: ConciergeAccessSearchScope[];
  total_results: number;
  access_limited: boolean;
  results: ConciergeAccessSearchResult[];
  took_ms: number;
};

export type ConciergeSearchSuggestion =
  | {
      kind: "recent_query";
      id: string;
      label: string;
      subtitle: string | null;
      query: string;
    }
  | {
      kind: "saved_search";
      id: string;
      label: string;
      subtitle: string | null;
      saved_search_id: string;
      query: string;
      filters: ConciergeSearchFilters;
      pinned: boolean;
    }
  | ({
      kind: "result";
      label: string;
      subtitle: string | null;
    } & ConciergeSearchResult);

export type ConciergeSuggestionResponse = {
  product_name: "Kemmetmueller Concierge";
  query: string;
  suggestions: ConciergeSearchSuggestion[];
  took_ms: number;
};

export type ConciergeRecentSearch = {
  id: string;
  query: string;
  last_used_at: string;
  use_count: number;
};

export type ConciergeRecentSearchResponse = {
  product_name: "Kemmetmueller Concierge";
  recent_searches: ConciergeRecentSearch[];
  took_ms: number;
};

export type ConciergeSavedSearch = {
  id: string;
  name: string;
  query: string;
  filters: ConciergeSearchFilters;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type ConciergeSavedSearchResponse = {
  product_name: "Kemmetmueller Concierge";
  saved_searches: ConciergeSavedSearch[];
  took_ms: number;
};

export type ConciergeResultLookupResponse = {
  product_name: "Kemmetmueller Concierge";
  result: ConciergeSearchResult | null;
  took_ms: number;
};

export type ConciergeSearchInput = {
  q?: string | null;
  limit?: number | null;
  department?: ConciergeDepartmentFilter | null;
  entity_types?: ConciergeEntityType[] | null;
  status?: string | null;
  owner?: string | null;
  assignee?: string | null;
  org?: string | null;
  date?: ConciergeDateFilter | null;
  risk?: string | null;
  has_any?: ConciergeHasFilter[] | null;
};

export type ConciergeAccessSearchInput = {
  q?: string | null;
  limit?: number | null;
  scopes?: ConciergeAccessSearchScope[] | null;
};

export type ConciergeSavedSearchUpsertInput = {
  name: string;
  query: string;
  filters?: Partial<ConciergeSearchFilters> | null;
  pinned?: boolean;
};

export type ConciergeSavedSearchUpdateInput = {
  name?: string | null;
  query?: string | null;
  filters?: Partial<ConciergeSearchFilters> | null;
  pinned?: boolean | null;
  touch?: boolean | null;
};
