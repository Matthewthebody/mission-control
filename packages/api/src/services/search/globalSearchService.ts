import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../../authz/authority.js";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type { ConciergeEntityType, ConciergeSearchResult } from "../../types/concierge.js";
import type {
  GlobalSearchDomain,
  GlobalSearchDomainDefinition,
  GlobalSearchGroup,
  GlobalSearchInput,
  GlobalSearchMetadataItem,
  GlobalSearchResponse,
  GlobalSearchResult,
  GlobalSearchTelemetryItem
} from "../../types/globalSearch.js";
import { writeAuditEvent } from "../diagnostics/auditEventService.js";
import { searchConciergeFlat } from "../concierge/conciergeSearchService.js";
import { getRequestContext } from "../requestContext.js";

const GLOBAL_SEARCH_DOMAIN_DEFINITIONS: GlobalSearchDomainDefinition[] = [
  {
    key: "jobs",
    label: "Jobs",
    entity_types: ["shoot"],
    searchable_fields: ["title", "subtitle", "org_name", "body_search_text", "status", "primary_date"]
  },
  {
    key: "organizations",
    label: "Organizations",
    entity_types: ["organization"],
    searchable_fields: ["title", "subtitle", "body_search_text", "org_name"]
  },
  {
    key: "locations",
    label: "Locations",
    entity_types: ["location"],
    searchable_fields: ["title", "subtitle", "body_search_text", "org_name"]
  },
  {
    key: "contacts",
    label: "Contacts",
    entity_types: ["contact"],
    searchable_fields: ["title", "subtitle", "body_search_text", "org_name"]
  },
  {
    key: "staffing_assignments",
    label: "Staffing Assignments",
    entity_types: ["staffing_assignment"],
    searchable_fields: ["title", "subtitle", "body_search_text", "status", "org_name", "primary_date"]
  },
  {
    key: "tasks",
    label: "Tasks",
    entity_types: ["task"],
    searchable_fields: ["title", "subtitle", "body_search_text", "status", "org_name", "primary_date"]
  },
  {
    key: "production",
    label: "Production",
    entity_types: ["production_item"],
    searchable_fields: ["title", "subtitle", "body_search_text", "status", "risk_level", "org_name", "primary_date"]
  },
  {
    key: "resources",
    label: "SOPs & Resources",
    entity_types: ["resource_library_item"],
    searchable_fields: ["title", "subtitle", "body_search_text", "status", "org_name"]
  }
];

const DEFAULT_DOMAINS = GLOBAL_SEARCH_DOMAIN_DEFINITIONS.map((definition) => definition.key);
const DOMAIN_ORDER = new Map<GlobalSearchDomain, number>(DEFAULT_DOMAINS.map((domain, index) => [domain, index]));

function normalizeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function resolveDomains(input: GlobalSearchInput) {
  const requested = (input.domains ?? []).filter(Boolean);
  const valid = requested.filter((domain): domain is GlobalSearchDomain =>
    GLOBAL_SEARCH_DOMAIN_DEFINITIONS.some((definition) => definition.key === domain)
  );
  return valid.length ? [...new Set(valid)] : DEFAULT_DOMAINS;
}

function resolveEntityTypes(domains: GlobalSearchDomain[]) {
  const values = domains.flatMap((domain) => GLOBAL_SEARCH_DOMAIN_DEFINITIONS.find((definition) => definition.key === domain)?.entity_types ?? []);
  return [...new Set(values)];
}

function mapEntityTypeToDomain(entityType: ConciergeEntityType): GlobalSearchDomain {
  switch (entityType) {
    case "shoot":
      return "jobs";
    case "organization":
      return "organizations";
    case "location":
      return "locations";
    case "contact":
      return "contacts";
    case "staffing_assignment":
      return "staffing_assignments";
    case "task":
      return "tasks";
    case "production_item":
      return "production";
    case "resource_library_item":
    default:
      return "resources";
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

function compactMetadata(result: ConciergeSearchResult): GlobalSearchMetadataItem[] {
  const metadata: GlobalSearchMetadataItem[] = [];
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

function applyOperationalUsefulnessBoosts(query: string, results: ConciergeSearchResult[]) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const now = Date.now();
  return results
    .map((result) => {
      let boost = 0;
      const status = normalizeText(result.status).toLowerCase();
      const title = normalizeText(result.title).toLowerCase();
      const primaryDateMs = result.primary_date ? new Date(result.primary_date).getTime() : null;

      if (title === normalizedQuery) {
        boost += result.entity_type === "organization" || result.entity_type === "contact" || result.entity_type === "location" ? 12 : 6;
      }

      if (result.entity_type === "shoot") {
        if (primaryDateMs && primaryDateMs >= now && primaryDateMs <= now + 7 * 24 * 60 * 60 * 1000) {
          boost += 10;
        }
        if (status === "active" || status === "published" || status === "ready") {
          boost += 4;
        }
        if (primaryDateMs && primaryDateMs < now - 90 * 24 * 60 * 60 * 1000) {
          boost -= 8;
        }
      }

      if (result.entity_type === "production_item") {
        if (["blocked", "overdue", "rejected", "waiting"].includes(status)) {
          boost += 12;
        }
        if (["released", "completed", "closed"].includes(status)) {
          boost -= 8;
        }
      }

      if (result.entity_type === "task") {
        if (["blocked", "overdue"].includes(status)) {
          boost += 8;
        }
        if (["completed", "closed", "done"].includes(status)) {
          boost -= 8;
        }
      }

      if (result.entity_type === "staffing_assignment" && primaryDateMs && primaryDateMs >= now && primaryDateMs <= now + 3 * 24 * 60 * 60 * 1000) {
        boost += 6;
      }

      if (result.entity_type === "resource_library_item" && status === "approved") {
        boost += 3;
      }

      return {
        ...result,
        score: result.score + boost
      };
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function toGlobalSearchResult(result: ConciergeSearchResult): GlobalSearchResult {
  return {
    search_index_id: result.search_index_id,
    entity_type: result.entity_type,
    entity_id: result.entity_id,
    domain: mapEntityTypeToDomain(result.entity_type),
    title: result.title,
    subtitle: result.subtitle,
    status: result.status,
    primary_date: result.primary_date,
    deep_link: result.deep_link,
    score: result.score,
    metadata: compactMetadata(result)
  };
}

function buildGroups(results: GlobalSearchResult[]): GlobalSearchGroup[] {
  const grouped = new Map<GlobalSearchDomain, GlobalSearchResult[]>();
  for (const result of results) {
    const current = grouped.get(result.domain) ?? [];
    current.push(result);
    grouped.set(result.domain, current);
  }

  return [...grouped.entries()]
    .map(([domain, domainResults]) => ({
      domain,
      title: GLOBAL_SEARCH_DOMAIN_DEFINITIONS.find((definition) => definition.key === domain)?.label ?? domain,
      total: domainResults.length,
      results: domainResults
    }))
    .sort((left, right) => {
      const leftScore = left.results[0]?.score ?? 0;
      const rightScore = right.results[0]?.score ?? 0;
      return rightScore - leftScore || (DOMAIN_ORDER.get(left.domain) ?? 99) - (DOMAIN_ORDER.get(right.domain) ?? 99);
    });
}

async function logGlobalSearchTelemetry(
  client: PoolClient,
  auth: AuthUser,
  input: {
    query: string;
    domains: GlobalSearchDomain[];
    resultCount: number;
    accessLimited: boolean;
    topEntityTypes: ConciergeEntityType[];
  }
) {
  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "global_search",
    eventType: "global_search.executed",
    resourceType: "global_search_query",
    context: {
      query: input.query,
      domains: input.domains,
      result_count: input.resultCount,
      access_limited: input.accessLimited,
      top_entity_types: input.topEntityTypes
    },
    result: input.resultCount > 0 ? "results" : "no_results"
  });

  if (input.resultCount === 0) {
    await writeAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventCategory: "global_search",
      eventType: "global_search.no_results",
      resourceType: "global_search_query",
      context: {
        query: input.query,
        domains: input.domains,
        access_limited: input.accessLimited
      },
      result: "no_results"
    });
  }
}

function assertGlobalSearchTelemetryAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Only leadership or audit admins can review global search telemetry.");
  }
}

export function listGlobalSearchDomainDefinitions() {
  return GLOBAL_SEARCH_DOMAIN_DEFINITIONS;
}

export async function searchGlobalSearch(
  client: PoolClient,
  auth: AuthUser,
  input: GlobalSearchInput
): Promise<GlobalSearchResponse> {
  const domains = resolveDomains(input);
  const query = normalizeText(input.q);
  const limit = Math.min(Math.max(Number(input.limit ?? 16), 1), 32);

  const flat = await searchConciergeFlat(client, auth, {
    q: query,
    limit: Math.min(Math.max(limit * 4, 48), 96),
    entity_types: resolveEntityTypes(domains)
  });

  const rankedResults = applyOperationalUsefulnessBoosts(query, flat.results)
    .map(toGlobalSearchResult)
    .slice(0, limit);

  if ((getRequestContext()?.method?.toUpperCase() ?? "") !== "GET") {
    await logGlobalSearchTelemetry(client, auth, {
      query,
      domains,
      resultCount: rankedResults.length,
      accessLimited: flat.access_limited,
      topEntityTypes: rankedResults.slice(0, 5).map((result) => result.entity_type)
    });
  }

  return {
    product_name: "Kemmetmueller Search",
    query,
    domains,
    total_results: rankedResults.length,
    access_limited: flat.access_limited,
    groups: buildGroups(rankedResults),
    took_ms: flat.took_ms
  };
}

export async function listGlobalSearchTelemetry(
  client: PoolClient,
  auth: AuthUser,
  limit = 50
): Promise<GlobalSearchTelemetryItem[]> {
  assertGlobalSearchTelemetryAccess(auth);
  const { rows } = await client.query<GlobalSearchTelemetryItem>(
    `
      SELECT
        audit.id::text,
        audit.event_type,
        audit.result,
        audit.created_at::text AS created_at,
        actor.full_name AS actor_name,
        audit.context_json AS context
      FROM audit_events audit
      LEFT JOIN app_user actor
        ON actor.tenant_id = audit.tenant_id
       AND actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.event_category = 'global_search'
      ORDER BY audit.created_at DESC
      LIMIT $2
    `,
    [auth.tenantId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}
