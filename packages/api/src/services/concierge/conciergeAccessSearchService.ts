import type { PoolClient } from "pg";
import type {
  ConciergeAccessSearchInput,
  ConciergeAccessSearchMetadata,
  ConciergeAccessSearchResponse,
  ConciergeAccessSearchResult,
  ConciergeAccessSearchScope,
  ConciergeEntityType,
  ConciergeSearchInput,
  ConciergeSearchResult
} from "../../types/concierge.js";
import type { AuthUser } from "../../types/auth.js";
import { searchConciergeFlat } from "./conciergeSearchService.js";

const DEFAULT_SCOPES: ConciergeAccessSearchScope[] = [
  "jobs",
  "locations",
  "organizations",
  "contacts",
  "staffing_assignments",
  "sops_files",
  "production"
];

const SCOPE_ENTITY_TYPES: Record<ConciergeAccessSearchScope, ConciergeEntityType[]> = {
  jobs: ["shoot"],
  locations: ["location"],
  organizations: ["organization"],
  contacts: ["contact"],
  staffing_assignments: ["staffing_assignment"],
  sops_files: ["resource_library_item"],
  production: ["production_item", "task"]
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function resolveScopes(input: ConciergeAccessSearchInput) {
  const requested = (input.scopes ?? []).filter(Boolean);
  return requested.length ? unique(requested) : DEFAULT_SCOPES;
}

function resolveEntityTypes(scopes: ConciergeAccessSearchScope[]) {
  return unique(scopes.flatMap((scope) => SCOPE_ENTITY_TYPES[scope] ?? []));
}

function mapEntityTypeToScope(entityType: ConciergeEntityType): ConciergeAccessSearchScope {
  switch (entityType) {
    case "shoot":
      return "jobs";
    case "location":
      return "locations";
    case "organization":
      return "organizations";
    case "contact":
      return "contacts";
    case "staffing_assignment":
      return "staffing_assignments";
    case "resource_library_item":
      return "sops_files";
    case "production_item":
    case "task":
    default:
      return "production";
  }
}

function entityLabel(result: ConciergeSearchResult) {
  switch (result.entity_type) {
    case "shoot":
      return "Job";
    case "organization":
      return "Organization";
    case "contact":
      return "Contact";
    case "location":
      return "Location";
    case "staffing_assignment":
      return "Staffing";
    case "resource_library_item":
      return "SOP / File";
    case "production_item":
      return "Production Issue";
    case "task":
      return "Production Task";
    default:
      return "Record";
  }
}

function formatPrimaryDate(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const hasTime = !(
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0
  );
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(parsed);
}

function compactMetadata(result: ConciergeSearchResult): ConciergeAccessSearchMetadata[] {
  const metadata: ConciergeAccessSearchMetadata[] = [{ label: "Type", value: entityLabel(result) }];
  if (result.status) {
    metadata.push({ label: "Status", value: result.status.replace(/_/g, " ") });
  }
  if (result.org_name && result.entity_type !== "organization") {
    metadata.push({ label: "Org", value: result.org_name });
  }
  if (result.department) {
    metadata.push({ label: "Department", value: result.department });
  }
  const formattedDate = formatPrimaryDate(result.primary_date);
  if (formattedDate) {
    metadata.push({ label: "When", value: formattedDate });
  }
  if (result.has_staffing_gap) {
    metadata.push({ label: "Staffing", value: "Gap detected" });
  }
  if (result.has_alerts) {
    metadata.push({ label: "Alerts", value: "Active" });
  }
  return metadata.slice(0, 4);
}

function toAccessResult(result: ConciergeSearchResult): ConciergeAccessSearchResult {
  return {
    search_index_id: result.search_index_id,
    entity_type: result.entity_type,
    entity_id: result.entity_id,
    scope: mapEntityTypeToScope(result.entity_type),
    title: result.title,
    subtitle: result.subtitle,
    status: result.status,
    primary_date: result.primary_date,
    deep_link: result.deep_link,
    score: result.score,
    metadata: compactMetadata(result)
  };
}

export async function searchConciergeAccess(
  client: PoolClient,
  auth: AuthUser,
  input: ConciergeAccessSearchInput = {}
): Promise<ConciergeAccessSearchResponse> {
  const scopes = resolveScopes(input);
  const searchInput: ConciergeSearchInput = {
    q: input.q,
    limit: input.limit ?? 12,
    entity_types: resolveEntityTypes(scopes)
  };
  const payload = await searchConciergeFlat(client, auth, searchInput);
  return {
    product_name: "Kemmetmueller Concierge",
    query: payload.parsed.query,
    scopes,
    total_results: payload.results.length,
    access_limited: payload.access_limited,
    results: payload.results.map(toAccessResult),
    took_ms: payload.took_ms
  };
}
