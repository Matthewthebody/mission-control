import type { JobDepartmentType } from "./jobTruthTypes";
import type { WorkDepartmentType } from "./workModelTypes";

export type ConciergeEntityType =
  | "organization"
  | "contact"
  | "location"
  | "shoot"
  | "production_item"
  | "task"
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

export type ConciergeResultCluster = {
  id: string;
  title: string;
  summary: string;
  tone: ConciergeResultTone;
  results: ConciergeSearchResult[];
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
  q?: string;
  limit?: number;
  department?: ConciergeDepartmentFilter | null;
  entity_types?: ConciergeEntityType[];
  status?: string | null;
  owner?: string | null;
  assignee?: string | null;
  org?: string | null;
  date?: ConciergeDateFilter | null;
  risk?: string | null;
  has_any?: ConciergeHasFilter[];
};

export type ConciergeSavedSearchUpsertInput = {
  name: string;
  query: string;
  filters?: Partial<ConciergeSearchFilters>;
  pinned?: boolean;
};

export type ConciergeSavedSearchUpdateInput = {
  name?: string | null;
  query?: string | null;
  filters?: Partial<ConciergeSearchFilters> | null;
  pinned?: boolean | null;
  touch?: boolean | null;
};
