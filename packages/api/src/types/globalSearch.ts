import type { ConciergeEntityType } from "./concierge.js";

export type GlobalSearchDomain =
  | "jobs"
  | "organizations"
  | "locations"
  | "contacts"
  | "staffing_assignments"
  | "tasks"
  | "production"
  | "resources";

export type GlobalSearchMetadataItem = {
  label: string;
  value: string;
};

export type GlobalSearchDomainDefinition = {
  key: GlobalSearchDomain;
  label: string;
  entity_types: ConciergeEntityType[];
  searchable_fields: string[];
};

export type GlobalSearchInput = {
  q: string;
  limit?: number | null;
  domains?: GlobalSearchDomain[] | null;
};

export type GlobalSearchResult = {
  search_index_id: string;
  entity_type: ConciergeEntityType;
  entity_id: string;
  domain: GlobalSearchDomain;
  title: string;
  subtitle: string | null;
  status: string | null;
  primary_date: string | null;
  deep_link: string;
  score: number;
  metadata: GlobalSearchMetadataItem[];
};

export type GlobalSearchGroup = {
  domain: GlobalSearchDomain;
  title: string;
  total: number;
  results: GlobalSearchResult[];
};

export type GlobalSearchResponse = {
  product_name: "Kemmetmueller Search";
  query: string;
  domains: GlobalSearchDomain[];
  total_results: number;
  access_limited: boolean;
  groups: GlobalSearchGroup[];
  took_ms: number;
};

export type GlobalSearchTelemetryItem = {
  id: string;
  event_type: string;
  result: string;
  created_at: string;
  actor_name: string | null;
  context: Record<string, unknown> | null;
};
