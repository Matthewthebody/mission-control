import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  ConciergeAccessSearchInput,
  ConciergeAccessSearchResponse,
  ConciergeAccessSearchResult,
  ConciergeIntentKind,
  ConciergeEntityType,
  ConciergeQuickAction,
  ConciergeRecentSearch,
  ConciergeRecentSearchResponse,
  ConciergeResultLookupResponse,
  ConciergeResultTone,
  ConciergeSavedSearch,
  ConciergeSavedSearchResponse,
  ConciergeSavedSearchUpdateInput,
  ConciergeSavedSearchUpsertInput,
  ConciergeAccessSearchScope,
  ConciergeSearchIndexRecord,
  ConciergeSearchInput,
  ConciergeSearchPermissionPayload,
  ConciergeSearchResponse,
  ConciergeSearchResult,
  ConciergeSearchSection,
  ConciergeSearchSuggestion,
  ConciergeSuggestionResponse
} from "../../types/concierge.js";
import { maskVisibilityValue } from "../policy/policyEngine.js";
import { buildConciergeAnswerCards, buildConciergeRelatedClusters } from "./conciergeIntelligence.js";
import {
  buildConciergeSqlPermissionClause,
  evaluateConciergeRecordPermission
} from "./conciergePermissions.js";
import { parseConciergeSearchInput } from "./conciergeQueryParser.js";

const SEARCH_ENTITY_ORDER: ConciergeEntityType[] = [
  "organization",
  "contact",
  "location",
  "shoot",
  "production_item",
  "task",
  "resource_library_item",
  "note",
  "comment",
  "staffing_assignment",
  "urgent_watch_alert",
  "post_shoot_evaluation"
];

type SearchCandidateRow = Omit<ConciergeSearchIndexRecord, "permissions_payload"> & {
  permissions_payload: ConciergeSearchPermissionPayload;
  rank_score: number | string;
};

type RecentSearchRow = {
  id: string;
  query_text: string;
  last_used_at: string;
  use_count: string;
};

type SavedSearchRow = {
  id: string;
  name: string;
  query_text: string;
  filters_json: Record<string, unknown> | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

function nowMs() {
  return Date.now();
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function excerpt(text: string | null | undefined, max = 220) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function sanitizeLike(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function sectionTitle(entityType: ConciergeEntityType) {
  switch (entityType) {
    case "organization":
      return "Organizations";
    case "contact":
      return "Contacts";
    case "location":
      return "Locations";
    case "shoot":
      return "Shoots";
    case "production_item":
      return "Production";
    case "task":
      return "Tasks";
    case "resource_library_item":
      return "SOPs & Files";
    case "note":
      return "Notes";
    case "comment":
      return "Comments";
    case "staffing_assignment":
      return "Staffing";
    case "urgent_watch_alert":
      return "Exceptions";
    case "post_shoot_evaluation":
      return "Post-Shoot Evaluations";
    default:
      return "Results";
  }
}

function resultTone(row: Pick<ConciergeSearchIndexRecord, "status" | "risk_level">): ConciergeResultTone {
  const status = row.status?.toLowerCase() ?? "";
  const risk = row.risk_level?.toLowerCase() ?? "";
  if (["blocked", "rejected", "overdue", "late", "on_hold", "major_issues", "needs_leadership_review"].includes(status)) {
    return "critical";
  }
  if (["critical", "blocked", "at_risk", "red"].includes(risk)) {
    return "critical";
  }
  if (["in_progress", "awaiting_review", "awaiting_approval", "warning", "reviewed"].includes(status)) {
    return "warning";
  }
  if (["high", "warning", "medium", "yellow"].includes(risk)) {
    return "warning";
  }
  if (status === "active" || status === "ready" || status === "submitted") {
    return "info";
  }
  return "neutral";
}

function buildSnippet(text: string | null | undefined, searchTerms: string[], max = 160) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  const lowered = normalized.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  for (const term of searchTerms) {
    if (!term || term.length < 3) {
      continue;
    }
    const index = lowered.indexOf(term.toLowerCase());
    if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
      matchIndex = index;
      matchLength = term.length;
    }
  }
  if (matchIndex < 0) {
    return excerpt(normalized, max);
  }
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(normalized.length, matchIndex + matchLength + 88);
  const snippet = normalized.slice(start, end).trim();
  return `${start > 0 ? "..." : ""}${snippet}${end < normalized.length ? "..." : ""}`;
}

function buildQuickActions(row: SearchCandidateRow): ConciergeQuickAction[] {
  const actions: ConciergeQuickAction[] = [{ key: "open", label: "Open", deep_link: row.deep_link }];
  const relatedJobId = row.related_ids.find((value) => Boolean(value)) ?? null;
  switch (row.entity_type) {
    case "shoot":
      actions.push({ key: "view_staffing", label: "View Staffing", deep_link: `#photography/staffing?shoot=${row.entity_id}` });
      actions.push({
        key: "create_task",
        label: "Create Task",
        deep_link: `#tasks/new?department=photography&jobId=${encodeURIComponent(relatedJobId ?? row.entity_id)}`
      });
      break;
    case "production_item":
      actions.push({ key: "view_production", label: "View Production", deep_link: row.deep_link });
      actions.push({
        key: "create_task",
        label: "Create Task",
        deep_link: `#tasks/new?department=production&jobId=${encodeURIComponent(relatedJobId ?? "")}`
      });
      break;
    case "task":
      if (relatedJobId) {
        actions.push({ key: "view_production", label: "Open Job", deep_link: `#jobs/${relatedJobId}` });
      }
      break;
    case "resource_library_item":
      actions.push({ key: "open", label: "Open File", deep_link: row.deep_link });
      break;
    case "note":
    case "comment":
      actions.push({ key: "view_notes", label: "View Notes", deep_link: row.deep_link });
      break;
    case "staffing_assignment":
      if (relatedJobId) {
        actions.push({ key: "view_staffing", label: "View Staffing", deep_link: `#schedule/staffing?job=${relatedJobId}` });
      }
      break;
    case "urgent_watch_alert":
      actions.push({ key: "view_production", label: "Open Linked Work", deep_link: row.deep_link });
      break;
    case "post_shoot_evaluation":
      actions.push({ key: "view_notes", label: "View Evaluation", deep_link: row.deep_link });
      break;
    default:
      break;
  }
  return actions.filter(
    (action, index, all) => all.findIndex((candidate) => candidate.key === action.key && candidate.deep_link === action.deep_link) === index
  );
}

function buildProtectedPreview(
  text: string | null | undefined,
  renderer: (value: string) => string | null,
  allowPreview: boolean,
  maskingStrategy: SearchCandidateRow["permissions_payload"]["masking_strategy"] | null | undefined
) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  if (allowPreview) {
    return renderer(normalized);
  }
  if (!maskingStrategy) {
    return null;
  }
  return maskVisibilityValue(renderer(normalized), "masked", maskingStrategy) as string | null;
}

function toResult(
  row: SearchCandidateRow,
  searchTerms: string[],
  decision: ReturnType<typeof evaluateConciergeRecordPermission>
): ConciergeSearchResult {
  return {
    search_index_id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    title: row.title,
    subtitle: row.subtitle,
    body: buildProtectedPreview(row.body_search_text, (value) => excerpt(value, 260), decision.allow_snippet_preview, decision.masking_strategy),
    snippet: buildProtectedPreview(
      row.body_search_text,
      (value) => buildSnippet(value, searchTerms),
      decision.allow_snippet_preview,
      decision.masking_strategy
    ),
    status: row.status,
    department: row.department,
    org_id: row.org_id,
    org_name: row.org_name,
    primary_date: row.primary_date,
    risk_level: row.risk_level,
    deep_link: row.deep_link,
    tone: resultTone(row),
    score: Number(row.rank_score ?? 0),
    has_notes: row.has_notes,
    has_alerts: row.has_alerts,
    has_staffing_gap: row.has_staffing_gap,
    quick_actions: buildQuickActions(row)
  };
}

function applyRelationshipBoost(query: string, rows: SearchCandidateRow[]) {
  const needle = query.toLowerCase();
  if (!needle) {
    return rows;
  }
  const directOrgIds = new Set<string>();
  const directRelatedIds = new Set<string>();
  for (const row of rows) {
    const title = row.title.toLowerCase();
    const subtitle = row.subtitle?.toLowerCase() ?? "";
    if (title === needle || title.startsWith(`${needle} `) || subtitle.includes(needle)) {
      if (row.org_id) {
        directOrgIds.add(row.org_id);
      }
      for (const relatedId of row.related_ids) {
        directRelatedIds.add(relatedId);
      }
    }
  }
  if (!directOrgIds.size && !directRelatedIds.size) {
    return rows;
  }
  return rows.map((row) => {
    let boost = 0;
    if (row.org_id && directOrgIds.has(row.org_id)) {
      boost += 18;
    }
    if (row.related_ids.some((relatedId) => directRelatedIds.has(relatedId))) {
      boost += 10;
    }
    return {
      ...row,
      rank_score: Number(row.rank_score ?? 0) + boost
    };
  });
}

function intentEntityBoost(kind: ConciergeIntentKind, row: SearchCandidateRow) {
  switch (kind) {
    case "contact_lookup":
      return row.entity_type === "contact" ? 34 : row.entity_type === "organization" ? 24 : 0;
    case "risk_review":
      return row.has_alerts || row.has_staffing_gap || ["blocked", "overdue", "rejected", "major_issues"].includes(normalizeText(row.status).toLowerCase())
        ? 18
        : ["shoot", "production_item", "urgent_watch_alert"].includes(row.entity_type)
          ? 10
          : 0;
    case "staffing_review":
      return row.entity_type === "staffing_assignment" ? 26 : row.has_staffing_gap ? 18 : row.entity_type === "shoot" ? 10 : 0;
    case "issue_lookup":
      return ["post_shoot_evaluation", "note", "comment", "urgent_watch_alert"].includes(row.entity_type) ? 26 : 0;
    case "note_history_lookup":
      return ["note", "comment", "post_shoot_evaluation"].includes(row.entity_type) ? 24 : 0;
    case "overdue_work_lookup":
      return row.primary_date && new Date(row.primary_date).getTime() < Date.now() ? 20 : ["task", "production_item", "shoot"].includes(row.entity_type) ? 8 : 0;
    case "production_blockage_lookup":
      return row.entity_type === "production_item" ? 26 : row.entity_type === "task" ? 16 : row.entity_type === "urgent_watch_alert" ? 12 : 0;
    default:
      return 0;
  }
}

function applyIntentBoost(kind: ConciergeIntentKind | null | undefined, rows: SearchCandidateRow[]) {
  if (!kind || kind === "direct_lookup") {
    return rows;
  }
  return rows.map((row) => {
    const status = normalizeText(row.status).toLowerCase();
    const text = normalizeText([row.title, row.subtitle, row.body_search_text].filter(Boolean).join(" ")).toLowerCase();
    let boost = intentEntityBoost(kind, row);
    if (kind === "production_blockage_lookup" && /\b(upload|qa|release|approval)\b/.test(text)) {
      boost += 10;
    }
    if (kind === "issue_lookup" && /\b(issue|problem|wrong|watch out|leadership review)\b/.test(text)) {
      boost += 12;
    }
    if (kind === "staffing_review" && (row.has_staffing_gap || /\b(staff|coverage|lead|crew)\b/.test(text))) {
      boost += 10;
    }
    if (kind === "overdue_work_lookup" && (status === "blocked" || status === "overdue")) {
      boost += 8;
    }
    return {
      ...row,
      rank_score: Number(row.rank_score ?? 0) + boost
    };
  });
}

function buildIntentStructuredMatchClause(kind: ConciergeIntentKind | null | undefined) {
  switch (kind) {
    case "risk_review":
      return `
        OR g.has_alerts = true
        OR g.has_staffing_gap = true
        OR lower(coalesce(g.risk_level, '')) IN ('critical', 'high', 'warning', 'at_risk', 'blocked', 'red')
        OR lower(coalesce(g.status, '')) IN ('blocked', 'overdue', 'rejected', 'major_issues', 'needs_leadership_review')
      `;
    case "staffing_review":
      return `
        OR g.has_staffing_gap = true
        OR g.entity_type = 'staffing_assignment'
      `;
    case "overdue_work_lookup":
      return `
        OR (g.primary_date IS NOT NULL AND g.primary_date < now())
      `;
    case "production_blockage_lookup":
      return `
        OR (
          g.entity_type IN ('production_item', 'task', 'urgent_watch_alert')
          AND lower(coalesce(g.status, '')) IN ('blocked', 'waiting', 'overdue', 'rejected')
        )
      `;
    default:
      return "";
  }
}

async function querySearchCandidates(
  client: PoolClient,
  auth: AuthUser,
  input: ConciergeSearchInput,
  candidateLimit: number
) {
  const parsed = parseConciergeSearchInput(input);
  const query = parsed.query;
  const expandedQuery = parsed.expanded_query || query;
  const subjectNeedle = normalizeText(parsed.intent?.subject).toLowerCase();
  const subjectLike = subjectNeedle ? `%${sanitizeLike(subjectNeedle)}%` : "";
  const hasStructuredFilters =
    parsed.filters.entity_types.length > 0 ||
    Boolean(parsed.filters.department) ||
    Boolean(parsed.filters.status) ||
    Boolean(parsed.filters.owner) ||
    Boolean(parsed.filters.assignee) ||
    Boolean(parsed.filters.org) ||
    Boolean(parsed.filters.date) ||
    Boolean(parsed.filters.risk) ||
    parsed.filters.has_any.length > 0;

  if (!expandedQuery && !hasStructuredFilters) {
    return { parsed, rows: [] as SearchCandidateRow[] };
  }

  const params: unknown[] = [auth.tenantId, expandedQuery, query, subjectNeedle, subjectLike];
  let sql = `
    WITH query_input AS (
      SELECT
        lower(trim($2::text)) AS expanded_needle,
        lower(trim($3::text)) AS raw_needle,
        CASE
          WHEN nullif(trim($2::text), '') IS NULL THEN NULL::tsquery
          ELSE websearch_to_tsquery('simple', trim($2::text))
        END AS ts_query
    )
    SELECT
      g.id::text,
      g.tenant_id::text,
      g.entity_type::text,
      g.entity_id::text,
      g.title,
      g.subtitle,
      g.body_search_text,
      g.status,
      g.department,
      g.org_id::text,
      g.org_name,
      g.owner_id::text,
      COALESCE(g.assignee_ids::text[], ARRAY[]::text[]) AS assignee_ids,
      COALESCE(g.related_ids::text[], ARRAY[]::text[]) AS related_ids,
      g.primary_date::text,
      g.risk_level,
      g.permissions_payload,
      g.deep_link,
      g.updated_at::text,
      g.activity_at::text,
      g.has_notes,
      g.has_alerts,
      g.has_staffing_gap,
      (
        CASE WHEN lower(g.title) = query_input.raw_needle THEN 180 ELSE 0 END +
        CASE WHEN lower(g.title) LIKE query_input.raw_needle || '%' THEN 96 ELSE 0 END +
        CASE WHEN lower(coalesce(g.subtitle, '')) LIKE query_input.raw_needle || '%' THEN 30 ELSE 0 END +
        CASE WHEN $4::text <> '' AND lower(g.title) = $4::text THEN 120 ELSE 0 END +
        CASE WHEN $4::text <> '' AND lower(coalesce(g.org_name, '')) = $4::text THEN 88 ELSE 0 END +
        CASE WHEN $5::text <> '' AND lower(coalesce(g.subtitle, '')) LIKE $5::text THEN 24 ELSE 0 END +
        GREATEST(
          similarity(lower(g.title), query_input.raw_needle),
          similarity(lower(coalesce(g.subtitle, '')), query_input.raw_needle),
          similarity(lower(coalesce(g.org_name, '')), query_input.raw_needle),
          similarity(lower(coalesce(g.body_search_text, '')), query_input.expanded_needle)
        ) * 60 +
        COALESCE(ts_rank_cd(g.search_document, query_input.ts_query), 0) * 58 +
        CASE
          WHEN lower(coalesce(g.status, '')) IN ('blocked', 'overdue', 'rejected', 'late', 'on_hold', 'major_issues') THEN 14
          WHEN lower(coalesce(g.status, '')) IN ('ready', 'in_progress', 'active', 'submitted') THEN 5
          ELSE 0
        END +
        CASE
          WHEN lower(coalesce(g.risk_level, '')) IN ('critical', 'blocked', 'at_risk', 'red') THEN 14
          WHEN lower(coalesce(g.risk_level, '')) IN ('high', 'warning', 'medium', 'yellow') THEN 7
          ELSE 0
        END +
        CASE
          WHEN g.primary_date IS NOT NULL AND g.primary_date < now() THEN 11
          WHEN g.primary_date IS NOT NULL AND g.primary_date < now() + interval '2 days' THEN 7
          ELSE 0
        END +
        CASE
          WHEN g.activity_at IS NOT NULL AND g.activity_at >= now() - interval '3 days' THEN 10
          WHEN g.updated_at >= now() - interval '14 days' THEN 4
          ELSE 0
        END
      ) AS rank_score
    FROM global_search_index g
    CROSS JOIN query_input
    WHERE g.tenant_id = $1
  `;

  const permissionClause = buildConciergeSqlPermissionClause(auth, params.length + 1);
  params.push(...permissionClause.params);
  sql += permissionClause.clause;

  if (parsed.intent?.kind === "contact_lookup" && !parsed.filters.entity_types.length) {
    sql += ` AND g.entity_type IN ('organization', 'contact')`;
  }

  if (query || expandedQuery) {
    const intentStructuredMatchClause = buildIntentStructuredMatchClause(parsed.intent?.kind);
    sql += `
      AND (
        query_input.expanded_needle = ''
        OR lower(g.title) = query_input.raw_needle
        OR lower(g.title) LIKE query_input.raw_needle || '%'
        OR lower(coalesce(g.subtitle, '')) LIKE query_input.raw_needle || '%'
        OR lower(coalesce(g.org_name, '')) LIKE '%' || query_input.raw_needle || '%'
        OR (query_input.ts_query IS NOT NULL AND g.search_document @@ query_input.ts_query)
        OR similarity(lower(g.title), query_input.raw_needle) >= 0.18
        OR similarity(lower(coalesce(g.subtitle, '')), query_input.raw_needle) >= 0.18
        OR similarity(lower(coalesce(g.body_search_text, '')), query_input.expanded_needle) >= 0.14
        OR similarity(lower(coalesce(g.org_name, '')), query_input.raw_needle) >= 0.24
        OR (
          $4::text <> ''
          AND (
            lower(g.title) = $4::text
            OR lower(g.title) LIKE $5::text
            OR lower(coalesce(g.subtitle, '')) LIKE $5::text
            OR lower(coalesce(g.org_name, '')) LIKE $5::text
          )
        )
        ${intentStructuredMatchClause}
      )
    `;
  }

  if (parsed.filters.department && parsed.filters.department !== "all") {
    params.push(parsed.filters.department);
    sql += ` AND g.department = $${params.length}::text`;
  }
  if (parsed.filters.entity_types.length) {
    params.push(parsed.filters.entity_types);
    sql += ` AND g.entity_type = ANY($${params.length}::text[])`;
  }
  if (parsed.filters.status) {
    params.push(`%${sanitizeLike(parsed.filters.status)}%`);
    sql += ` AND lower(coalesce(g.status, '')) LIKE $${params.length}`;
  }
  if (parsed.filters.owner) {
    params.push(`%${sanitizeLike(parsed.filters.owner)}%`);
    sql += ` AND lower(coalesce(g.body_search_text, '')) LIKE $${params.length}`;
  }
  if (parsed.filters.assignee) {
    params.push(`%${sanitizeLike(parsed.filters.assignee)}%`);
    sql += ` AND lower(coalesce(g.body_search_text, '')) LIKE $${params.length}`;
  }
  if (parsed.filters.org) {
    params.push(`%${sanitizeLike(parsed.filters.org)}%`);
    sql += ` AND (lower(coalesce(g.org_name, '')) LIKE $${params.length} OR lower(coalesce(g.subtitle, '')) LIKE $${params.length})`;
  }
  if (parsed.filters.risk) {
    params.push(`%${sanitizeLike(parsed.filters.risk)}%`);
    sql += ` AND lower(coalesce(g.risk_level, '')) LIKE $${params.length}`;
  }
  if (parsed.filters.date) {
    switch (parsed.filters.date) {
      case "today":
        sql += ` AND g.primary_date IS NOT NULL AND g.primary_date::date = timezone('America/Chicago', now())::date`;
        break;
      case "tomorrow":
        sql += ` AND g.primary_date IS NOT NULL AND g.primary_date::date = (timezone('America/Chicago', now())::date + 1)`;
        break;
      case "next_24h":
        sql += ` AND g.primary_date IS NOT NULL AND g.primary_date BETWEEN now() AND now() + interval '24 hours'`;
        break;
      case "next_7d":
        sql += ` AND g.primary_date IS NOT NULL AND g.primary_date BETWEEN now() AND now() + interval '7 days'`;
        break;
      case "overdue":
        sql += ` AND g.primary_date IS NOT NULL AND g.primary_date < now()`;
        break;
      default:
        break;
    }
  }
  if (parsed.filters.has_any.length) {
    const clauses: string[] = [];
    for (const filter of parsed.filters.has_any) {
      if (filter === "notes") {
        clauses.push(`(g.has_notes = true OR g.entity_type IN ('note', 'comment', 'post_shoot_evaluation'))`);
      } else if (filter === "alerts") {
        clauses.push(`(g.has_alerts = true OR g.entity_type = 'urgent_watch_alert')`);
      } else if (filter === "staffing_gap") {
        clauses.push(`(g.has_staffing_gap = true OR g.entity_type = 'staffing_assignment')`);
      }
    }
    if (clauses.length) {
      sql += ` AND ${clauses.map((clause) => `(${clause})`).join(" AND ")}`;
    }
  }

  params.push(candidateLimit);
  sql += `
    ORDER BY rank_score DESC, g.updated_at DESC, g.title ASC
    LIMIT $${params.length}
  `;

  const { rows } = await client.query<SearchCandidateRow>(sql, params);
  return {
    parsed,
    rows: applyIntentBoost(parsed.intent?.kind, applyRelationshipBoost(parsed.query, rows))
  };
}

function buildSections(results: ConciergeSearchResult[]) {
  return SEARCH_ENTITY_ORDER.reduce<ConciergeSearchSection[]>((sections, entityType) => {
    const grouped = results.filter((result) => result.entity_type === entityType);
    if (!grouped.length) {
      return sections;
    }
    sections.push({
      entity_type: entityType,
      title: sectionTitle(entityType),
      total: grouped.length,
      results: grouped
    });
    return sections;
  }, []);
}

type VisibleSearchEntry = {
  decision: ReturnType<typeof evaluateConciergeRecordPermission>;
  result: ConciergeSearchResult;
};

export type FlatConciergeSearchResponse = {
  parsed: ReturnType<typeof parseConciergeSearchInput>;
  results: ConciergeSearchResult[];
  answer_safe_results: ConciergeSearchResult[];
  access_limited: boolean;
  took_ms: number;
};

function buildVisibleSearchEntries(auth: AuthUser, rows: SearchCandidateRow[], searchTerms: string[]) {
  return rows
    .map((row) => {
      const decision = evaluateConciergeRecordPermission(auth, row);
      return decision.can_access
        ? {
            decision,
            result: toResult(row, searchTerms, decision)
          }
        : null;
    })
    .filter((entry): entry is VisibleSearchEntry => Boolean(entry));
}

async function loadRecentSearchRows(client: PoolClient, auth: AuthUser, searchText?: string | null, limit = 8) {
  const params: unknown[] = [auth.tenantId, auth.id];
  let sql = `
    SELECT
      id::text,
      query_text,
      last_used_at::text,
      use_count::text
    FROM global_search_recent_search
    WHERE tenant_id = $1
      AND user_id = $2
  `;
  const normalized = normalizeText(searchText).toLowerCase();
  if (normalized) {
    params.push(`%${normalized}%`);
    sql += ` AND lower(query_text) LIKE $${params.length}`;
  }
  params.push(limit);
  sql += ` ORDER BY last_used_at DESC, use_count DESC LIMIT $${params.length}`;
  const { rows } = await client.query<RecentSearchRow>(sql, params);
  return rows;
}

function normalizeFilters(filters: Partial<ReturnType<typeof parseConciergeSearchInput>["filters"]> | null | undefined) {
  const parsed = parseConciergeSearchInput({
    department: filters?.department ?? null,
    entity_types: filters?.entity_types ?? null,
    status: filters?.status ?? null,
    owner: filters?.owner ?? null,
    assignee: filters?.assignee ?? null,
    org: filters?.org ?? null,
    date: filters?.date ?? null,
    risk: filters?.risk ?? null,
    has_any: filters?.has_any ?? null
  });
  return parsed.filters;
}

function mapSavedSearch(row: SavedSearchRow): ConciergeSavedSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query_text,
    filters: normalizeFilters((row.filters_json ?? {}) as Partial<ReturnType<typeof parseConciergeSearchInput>["filters"]>),
    pinned: row.is_pinned,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at
  };
}

async function loadSavedSearchRows(client: PoolClient, auth: AuthUser, searchText?: string | null, limit = 10) {
  const params: unknown[] = [auth.tenantId, auth.id];
  let sql = `
    SELECT
      id::text,
      name,
      query_text,
      filters_json,
      is_pinned,
      created_at::text,
      updated_at::text,
      last_used_at::text
    FROM global_search_saved_search
    WHERE tenant_id = $1
      AND user_id = $2
  `;
  const normalized = normalizeText(searchText).toLowerCase();
  if (normalized) {
    params.push(`%${normalized}%`);
    sql += ` AND (lower(name) LIKE $${params.length} OR lower(query_text) LIKE $${params.length})`;
  }
  params.push(limit);
  sql += ` ORDER BY is_pinned DESC, coalesce(last_used_at, updated_at) DESC LIMIT $${params.length}`;
  const { rows } = await client.query<SavedSearchRow>(sql, params);
  return rows;
}

export async function searchConciergeFlat(
  client: PoolClient,
  auth: AuthUser,
  input: ConciergeSearchInput = {}
): Promise<FlatConciergeSearchResponse> {
  const startedAt = nowMs();
  const limit = Math.min(Math.max(Number(input.limit ?? 24), 1), 48);
  const { parsed, rows } = await querySearchCandidates(client, auth, input, Math.max(limit * 5, 96));
  const visibleEntries = buildVisibleSearchEntries(auth, rows, parsed.search_terms);
  const visibleResults = visibleEntries.map((entry) => entry.result);
  visibleResults.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  const answerSafeResults = visibleEntries.filter((entry) => entry.decision.allow_answer_summary).map((entry) => entry.result);
  return {
    parsed,
    results: visibleResults.slice(0, limit),
    answer_safe_results: answerSafeResults,
    access_limited: rows.length > visibleEntries.length,
    took_ms: nowMs() - startedAt
  };
}

export async function searchConcierge(client: PoolClient, auth: AuthUser, input: ConciergeSearchInput = {}): Promise<ConciergeSearchResponse> {
  const { parsed, results, answer_safe_results, access_limited, took_ms } = await searchConciergeFlat(client, auth, input);
  const [answerCards, relatedClusters] = await Promise.all([
    buildConciergeAnswerCards({
      client,
      tenantId: auth.tenantId,
      parsed,
      results: answer_safe_results
    }),
    Promise.resolve(
      buildConciergeRelatedClusters({
        parsed,
        results
      })
    )
  ]);
  return {
    product_name: "Kemmetmueller Concierge",
    query: parsed.query,
    total_results: results.length,
    access_limited,
    interpreted_intent: parsed.intent,
    answer_cards: answerCards,
    related_clusters: relatedClusters,
    sections: buildSections(results),
    applied_filters: parsed.filters,
    took_ms
  };
}

export async function suggestConcierge(client: PoolClient, auth: AuthUser, input: ConciergeSearchInput = {}): Promise<ConciergeSuggestionResponse> {
  const startedAt = nowMs();
  const parsed = parseConciergeSearchInput(input);
  const [recentRows, savedRows] = await Promise.all([
    loadRecentSearchRows(client, auth, parsed.query, parsed.query ? 4 : 8),
    loadSavedSearchRows(client, auth, parsed.query, parsed.query ? 4 : 8)
  ]);
  const suggestions: ConciergeSearchSuggestion[] = [
    ...savedRows.map((row) => {
      const saved = mapSavedSearch(row);
      return {
        kind: "saved_search" as const,
        id: `saved:${saved.id}`,
        label: saved.name,
        subtitle: saved.pinned ? "Pinned search" : "Saved search",
        saved_search_id: saved.id,
        query: saved.query,
        filters: saved.filters,
        pinned: saved.pinned
      };
    }),
    ...recentRows.map((row) => ({
      kind: "recent_query" as const,
      id: row.id,
      label: row.query_text,
      subtitle: "Recent search",
      query: row.query_text
    }))
  ];

  if (parsed.query || parsed.filters.entity_types.length || parsed.filters.has_any.length) {
    const { rows } = await querySearchCandidates(client, auth, input, 12);
    for (const row of rows) {
      const decision = evaluateConciergeRecordPermission(auth, row);
      if (!decision.can_access) {
        continue;
      }
      const result = toResult(row, parsed.search_terms, decision);
      suggestions.push({
        ...result,
        kind: "result",
        label: result.title,
        subtitle: [sectionTitle(result.entity_type).replace(/s$/, ""), result.subtitle].filter(Boolean).join(" | ")
      });
      if (suggestions.length >= 12) {
        break;
      }
    }
  }

  const deduped: ConciergeSearchSuggestion[] = [];
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const key =
      suggestion.kind === "recent_query"
        ? `recent:${suggestion.query.toLowerCase()}`
        : suggestion.kind === "saved_search"
          ? `saved:${suggestion.saved_search_id}`
          : `result:${suggestion.search_index_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(suggestion);
  }

  return {
    product_name: "Kemmetmueller Concierge",
    query: parsed.query,
    suggestions: deduped.slice(0, 12),
    took_ms: nowMs() - startedAt
  };
}

export async function listRecentConciergeSearches(client: PoolClient, auth: AuthUser, limit = 8): Promise<ConciergeRecentSearchResponse> {
  const startedAt = nowMs();
  const rows = await loadRecentSearchRows(client, auth, null, Math.min(Math.max(limit, 1), 20));
  const recentSearches: ConciergeRecentSearch[] = rows.map((row) => ({
    id: row.id,
    query: row.query_text,
    last_used_at: row.last_used_at,
    use_count: Number(row.use_count ?? 0)
  }));
  return {
    product_name: "Kemmetmueller Concierge",
    recent_searches: recentSearches,
    took_ms: nowMs() - startedAt
  };
}

export async function recordRecentConciergeSearch(
  client: PoolClient,
  auth: AuthUser,
  input: { query: string; selected_search_index_id?: string | null }
) {
  const normalizedQuery = normalizeText(input.query);
  if (!normalizedQuery) {
    return;
  }
  await client.query(
    `
      INSERT INTO global_search_recent_search (
        tenant_id,
        user_id,
        normalized_query,
        query_text,
        last_used_at,
        use_count,
        selected_search_index_id
      )
      VALUES ($1, $2, lower($3), $3, now(), 1, $4::uuid)
      ON CONFLICT (tenant_id, user_id, normalized_query)
      DO UPDATE SET
        query_text = EXCLUDED.query_text,
        last_used_at = now(),
        use_count = global_search_recent_search.use_count + 1,
        selected_search_index_id = EXCLUDED.selected_search_index_id
    `,
    [auth.tenantId, auth.id, normalizedQuery, input.selected_search_index_id ?? null]
  );
}

export async function listSavedConciergeSearches(client: PoolClient, auth: AuthUser): Promise<ConciergeSavedSearchResponse> {
  const startedAt = nowMs();
  const rows = await loadSavedSearchRows(client, auth, null, 24);
  return {
    product_name: "Kemmetmueller Concierge",
    saved_searches: rows.map(mapSavedSearch),
    took_ms: nowMs() - startedAt
  };
}

export async function createSavedConciergeSearch(
  client: PoolClient,
  auth: AuthUser,
  input: ConciergeSavedSearchUpsertInput
): Promise<ConciergeSavedSearchResponse> {
  const filters = normalizeFilters(input.filters ?? null);
  const name = normalizeText(input.name);
  const query = normalizeText(input.query);
  if (!name || !query) {
    throw new ApiError(400, "Saved searches need both a name and a query.");
  }
  await client.query(
    `
      INSERT INTO global_search_saved_search (
        tenant_id,
        user_id,
        name,
        normalized_query,
        query_text,
        filters_json,
        is_pinned,
        last_used_at
      )
      VALUES ($1,$2,$3,lower($4),$4,$5::jsonb,$6,now())
    `,
    [auth.tenantId, auth.id, name, query, JSON.stringify(filters), Boolean(input.pinned)]
  );
  return listSavedConciergeSearches(client, auth);
}

export async function updateSavedConciergeSearch(
  client: PoolClient,
  auth: AuthUser,
  savedSearchId: string,
  input: ConciergeSavedSearchUpdateInput
): Promise<ConciergeSavedSearchResponse> {
  const existing = (
    await client.query<SavedSearchRow>(
      `
        SELECT
          id::text,
          name,
          query_text,
          filters_json,
          is_pinned,
          created_at::text,
          updated_at::text,
          last_used_at::text
        FROM global_search_saved_search
        WHERE tenant_id = $1
          AND user_id = $2
          AND id = $3
        LIMIT 1
      `,
      [auth.tenantId, auth.id, savedSearchId]
    )
  ).rows[0];
  if (!existing) {
    throw new ApiError(404, "Saved search not found.");
  }

  const nextName = normalizeText(input.name ?? existing.name) || existing.name;
  const nextQuery = normalizeText(input.query ?? existing.query_text) || existing.query_text;
  const nextFilters = normalizeFilters((input.filters as Partial<ReturnType<typeof parseConciergeSearchInput>["filters"]> | null | undefined) ?? (existing.filters_json as any));
  const nextPinned = typeof input.pinned === "boolean" ? input.pinned : existing.is_pinned;

  await client.query(
    `
      UPDATE global_search_saved_search
      SET name = $4,
          normalized_query = lower($5),
          query_text = $5,
          filters_json = $6::jsonb,
          is_pinned = $7,
          last_used_at = CASE WHEN $8 THEN now() ELSE last_used_at END,
          updated_at = now()
      WHERE tenant_id = $1
        AND user_id = $2
        AND id = $3
    `,
    [auth.tenantId, auth.id, savedSearchId, nextName, nextQuery, JSON.stringify(nextFilters), nextPinned, Boolean(input.touch)]
  );
  return listSavedConciergeSearches(client, auth);
}

export async function deleteSavedConciergeSearch(client: PoolClient, auth: AuthUser, savedSearchId: string) {
  const { rowCount } = await client.query(
    `
      DELETE FROM global_search_saved_search
      WHERE tenant_id = $1
        AND user_id = $2
        AND id = $3
    `,
    [auth.tenantId, auth.id, savedSearchId]
  );
  if (!rowCount) {
    throw new ApiError(404, "Saved search not found.");
  }
  return listSavedConciergeSearches(client, auth);
}

export async function lookupConciergeResult(
  client: PoolClient,
  auth: AuthUser,
  searchIndexId: string
): Promise<ConciergeResultLookupResponse> {
  const startedAt = nowMs();
  const { rows } = await client.query<SearchCandidateRow>(
    `
      SELECT
        id::text,
        tenant_id::text,
        entity_type::text,
        entity_id::text,
        title,
        subtitle,
        body_search_text,
        status,
        department,
        org_id::text,
        org_name,
        owner_id::text,
        COALESCE(assignee_ids::text[], ARRAY[]::text[]) AS assignee_ids,
        COALESCE(related_ids::text[], ARRAY[]::text[]) AS related_ids,
        primary_date::text,
        risk_level,
        permissions_payload,
        deep_link,
        updated_at::text,
        activity_at::text,
        has_notes,
        has_alerts,
        has_staffing_gap,
        0::float AS rank_score
      FROM global_search_index
      WHERE tenant_id = $1
        AND id = $2::uuid
      LIMIT 1
    `,
    [auth.tenantId, searchIndexId]
  );
  const row = rows[0] ?? null;
  const decision = row ? evaluateConciergeRecordPermission(auth, row) : null;
  const result = row && decision?.can_access ? toResult(row, [], decision) : null;
  return {
    product_name: "Kemmetmueller Concierge",
    result,
    took_ms: nowMs() - startedAt
  };
}
