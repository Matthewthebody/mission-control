import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import { hasReadScope } from "./jobService.js";
import { JOBS_RECENT_COMPLETION_DAYS } from "./jobsLifecycle.js";

// ── Canonical Jobs index read model (Phase 3B) ───────────────────────────────
// ONE predicate layer shared by the returned rows AND every summary count, so
// `summary[metric] === total returned when that metric filter is applied` holds
// by construction. Uses ONLY canonical Jobs data (the `jobs` table + its canonical
// children) plus *confirmed* Shoot links (jobs.legacy_shoot_id ∪ job_shoot_links).
// It never derives Job state from unlinked Shoots, fuzzy candidates, or legacy
// scheduling state, and never fabricates Shoot-derived staffing/schedule data for an
// unlinked Job. See docs/jobs-shoot-convergence-audit.md.

const ALL_DEPARTMENTS: JobDepartmentType[] = ["schools", "sports", "corporate", "headshots", "other"];

export const JOB_INDEX_MAX_PAGE_SIZE = 100;
export const JOB_INDEX_DEFAULT_PAGE_SIZE = 25;

// Metric registry. Each metric is BOTH a summary count (COUNT(*) FILTER (WHERE sql))
// and a row filter (?metric=key adds `AND sql`). `available:false` metrics are
// surfaced honestly with a reason and contribute NO enabled count/filter — they are
// not fabricated from demo data.
type JobIndexMetric = {
  key: string;
  label: string;
  available: boolean;
  reason?: string;
  // SQL predicate over the columns exposed by the `filtered` CTE below. Omitted for
  // unavailable metrics.
  sql?: string;
};

export const JOB_INDEX_METRICS: JobIndexMetric[] = [
  { key: "needs_review", label: "Needs Review", available: true, sql: "f.job_status IN ('draft','pending_confirmation')" },
  { key: "intake_review", label: "Intake Review", available: true, sql: "f.job_status = 'pending_confirmation'" },
  {
    key: "needs_attention",
    label: "Needs Attention",
    available: true,
    sql: "(f.readiness_status IN ('at_risk','off_track') OR f.risk_status IN ('high','critical'))"
  },
  {
    key: "blocked",
    label: "Blocked",
    available: true,
    sql: "(f.production_status = 'blocked' OR f.blocker_count > 0 OR f.open_watch_flag_count > 0)"
  },
  { key: "missing_required_details", label: "Missing Required Details", available: true, sql: "f.incomplete_required_count > 0" },
  {
    key: "behind_promised_delivery",
    label: "Behind Promised Delivery",
    available: true,
    sql:
      "((f.production_deadline_at < now() OR f.client_deadline_at < now()) " +
      "AND f.production_status NOT IN ('delivered','complete') " +
      "AND f.job_status NOT IN ('execution_complete','cancelled','archived'))"
  },
  { key: "unowned", label: "Unowned", available: true, sql: "f.account_owner_user_id IS NULL" },
  {
    key: "active_this_week",
    label: "Active This Week",
    available: true,
    sql: "(f.scheduled_start_at IS NOT NULL AND f.scheduled_start_at::date BETWEEN current_date AND current_date + 7)"
  },
  {
    key: "recently_completed",
    label: "Recently Completed",
    available: true,
    sql: "(f.job_status = 'execution_complete' OR f.production_status IN ('delivered','complete'))"
  },
  // Honestly unavailable on canonical Job data alone (see audit §4/§8):
  {
    key: "waiting_on_client",
    label: "Waiting on Client",
    available: false,
    reason: "Derived from a client-side missing-info breakdown; no canonical Jobs predicate yet."
  },
  {
    key: "date_conflict",
    label: "Date Conflict",
    available: false,
    reason: "A schedule conflict is Shoot-derived; unavailable until a confirmed Shoot link is established and labeled."
  }
];

const AVAILABLE_METRICS = JOB_INDEX_METRICS.filter((m) => m.available && m.sql);
const METRIC_BY_KEY = new Map(JOB_INDEX_METRICS.map((m) => [m.key, m]));

// Canonical "Needs Attention" reasons computable from Job-native data. The two
// missing ones — `not_acknowledged` (ack lives on the Shoot staffing plan) and
// `affects_client_or_shoot_72h` (needs a Shoot date) — are intentionally NOT
// inferred for an (unlinked) Job; they only arrive via a confirmed related record.
const JOB_NATIVE_ATTENTION_REASONS: Array<{ reason: string; sql: string }> = [
  { reason: "late", sql: "(f.client_deadline_at < now() AND f.job_status NOT IN ('execution_complete','cancelled','archived'))" },
  {
    reason: "behind_promised_delivery",
    sql:
      "((f.production_deadline_at < now() OR f.client_deadline_at < now()) " +
      "AND f.production_status NOT IN ('delivered','complete') AND f.job_status NOT IN ('execution_complete','cancelled','archived'))"
  },
  { reason: "blocked_no_owner", sql: "((f.production_status='blocked' OR f.blocker_count>0 OR f.open_watch_flag_count>0) AND f.account_owner_user_id IS NULL)" },
  { reason: "missing_required_details", sql: "(f.incomplete_required_count > 0)" }
];

export const JOB_INDEX_UNAVAILABLE_ATTENTION_REASONS = [
  { reason: "not_acknowledged", explanation: "Acknowledgment is tracked on the Shoot staffing plan; unavailable until a Shoot is linked." },
  { reason: "affects_client_or_shoot_72h", explanation: "Requires a Shoot date; not inferred for a Job without a confirmed Shoot link." }
];

const SORTABLE = new Map<string, string>([
  ["date", "f.scheduled_start_at"],
  ["created", "f.created_at"],
  ["updated", "f.updated_at"],
  ["name", "lower(coalesce(f.title,''))"],
  ["status", "f.job_status::text"]
]);

export type JobIndexFilters = {
  search?: string | null;
  department_type?: string | null;
  owner_user_id?: string | null;
  job_status?: string | null;
  production_status?: string | null;
  readiness_status?: string | null;
  risk_status?: string | null;
  staffing_status?: string | null;
  date_window?: string | null; // today | next-7 | next-14 | overdue | all
  shoot_link_status?: string | null; // linked | unlinked
  workflow_link_status?: string | null; // linked | unlinked
  lifecycle_scope?: string | null; // active(default)|needs_attention|upcoming|waiting|recently_completed|completed|archived|canceled|demo_test|review_required|all
  show_demo?: boolean | string | null; // include seed_demo/test_fixture in the active/needs_attention default views (default off)
  metric?: string | null; // one of JOB_INDEX_METRICS (available) keys
  sort?: string | null; // date | created | updated | name | status
  direction?: string | null; // asc | desc
  limit?: number | null;
  offset?: number | null;
};

function readableDepartments(auth: AuthUser, requested: string | null): JobDepartmentType[] {
  if (requested) {
    const dep = requested as JobDepartmentType;
    if (!ALL_DEPARTMENTS.includes(dep) || hasReadScope(auth, dep) == null) {
      throw new ApiError(403, "Forbidden");
    }
    return [dep];
  }
  return ALL_DEPARTMENTS.filter((d) => hasReadScope(auth, d) != null);
}

// Build the base WHERE (everything EXCEPT the metric selector — the summary is
// computed over this base so summary[X] equals the row total when metric=X is added).
function buildBase(auth: AuthUser, filters: JobIndexFilters) {
  const departments = readableDepartments(auth, filters.department_type ?? null);
  const params: unknown[] = [auth.tenantId, departments];
  const where: string[] = ["f.tenant_id = $1", "f.department_type::text = ANY($2::text[])"];

  // Lifecycle scope (default operating view = active). The default excludes
  // archived, canceled, demo/test-fixture-marked, and historical-completed (outside
  // the recent-completion window), while keeping recently-completed work visible.
  const COMPLETE = "(f.job_status='execution_complete' OR f.production_status IN ('delivered','complete') OR f.completed_at IS NOT NULL)";
  const CANCELED = "(f.job_status='cancelled' OR f.cancelled_at IS NOT NULL)";
  const DEMO = "(f.data_origin IN ('seed_demo','test_fixture'))";
  // NULL-safe negation: a NULL data_origin is an ordinary (non-demo) record.
  const NOT_DEMO = "(f.data_origin IS NULL OR f.data_origin NOT IN ('seed_demo','test_fixture'))";
  const HISTORICAL = `(${COMPLETE} AND COALESCE(f.completed_at, f.updated_at) < now() - interval '${JOBS_RECENT_COMPLETION_DAYS} days')`;
  const RECENT = `(${COMPLETE} AND COALESCE(f.completed_at, f.updated_at) >= now() - interval '${JOBS_RECENT_COMPLETION_DAYS} days')`;
  const ATTENTION = "(f.readiness_status IN ('at_risk','off_track') OR f.risk_status IN ('high','critical') OR f.blocker_count>0 OR f.open_watch_flag_count>0 OR f.account_owner_user_id IS NULL)";
  // "Show Demo Data" (default off): the operating views hide seed/test-fixture Jobs.
  // When enabled, demo Jobs are included so the curated demo set is visible. The same
  // base predicate feeds rows AND summary counts, so the toggle moves both together.
  const showDemo = filters.show_demo === true || filters.show_demo === "true" || filters.show_demo === "1";
  const NOT_HIDDEN = `f.archived_at IS NULL AND NOT ${CANCELED}${showDemo ? "" : ` AND ${NOT_DEMO}`}`;
  const scope = (filters.lifecycle_scope ?? "active").trim();
  switch (scope) {
    case "active":
      where.push(`${NOT_HIDDEN} AND NOT ${HISTORICAL}`);
      break;
    case "needs_attention":
      where.push(`${NOT_HIDDEN} AND NOT ${HISTORICAL} AND ${ATTENTION}`);
      break;
    case "upcoming":
      where.push(`f.archived_at IS NULL AND NOT ${COMPLETE} AND NOT ${CANCELED} AND f.scheduled_start_at > now()`);
      break;
    case "waiting":
      where.push("f.archived_at IS NULL AND f.job_status IN ('weather_hold','postponed')");
      break;
    case "recently_completed":
      where.push(`f.archived_at IS NULL AND ${RECENT}`);
      break;
    case "completed":
      where.push(`f.archived_at IS NULL AND ${COMPLETE}`);
      break;
    case "archived":
      where.push("f.archived_at IS NOT NULL");
      break;
    case "canceled":
      where.push(`f.archived_at IS NULL AND ${CANCELED}`);
      break;
    case "demo_test":
      where.push(DEMO);
      break;
    case "review_required":
      where.push(`f.archived_at IS NULL AND ${COMPLETE} AND (f.blocker_count>0 OR f.open_watch_flag_count>0)`);
      break;
    case "all":
    default:
      break;
  }

  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = (filters.search ?? "").trim().toLowerCase();
  if (search) {
    const p = push(`%${search}%`);
    where.push(`(lower(f.title) LIKE ${p} OR lower(coalesce(f.event_name,'')) LIKE ${p} OR lower(coalesce(f.job_number,'')) LIKE ${p})`);
  }
  const eq = (col: string, value?: string | null) => {
    const v = (value ?? "").trim();
    if (v) where.push(`${col}::text = ${push(v)}`);
  };
  eq("f.job_status", filters.job_status);
  eq("f.production_status", filters.production_status);
  eq("f.readiness_status", filters.readiness_status);
  eq("f.risk_status", filters.risk_status);
  eq("f.staffing_status", filters.staffing_status);
  if ((filters.owner_user_id ?? "").trim()) where.push(`f.account_owner_user_id = ${push((filters.owner_user_id ?? "").trim())}::uuid`);

  const win = (filters.date_window ?? "all").trim();
  if (win === "today") where.push("f.scheduled_start_at::date = current_date");
  else if (win === "next-7") where.push("f.scheduled_start_at::date BETWEEN current_date AND current_date + 7");
  else if (win === "next-14") where.push("f.scheduled_start_at::date BETWEEN current_date AND current_date + 14");
  else if (win === "overdue") where.push("f.scheduled_start_at::date < current_date");

  const link = (filters.shoot_link_status ?? "").trim();
  if (link === "linked") where.push("f.linked_shoot_count > 0");
  else if (link === "unlinked") where.push("f.linked_shoot_count = 0");

  const wf = (filters.workflow_link_status ?? "").trim();
  if (wf === "linked") where.push("f.workflow_run_count > 0");
  else if (wf === "unlinked") where.push("f.workflow_run_count = 0");

  return { where: where.join(" AND "), params };
}

// The shared `filtered` CTE: canonical job columns + canonical derived aggregates +
// the deduped confirmed-shoot-link count. Everything downstream (rows + counts)
// reads from here, so they cannot diverge.
const FILTERED_CTE = `
  filtered AS (
    SELECT
      j.*,
      (SELECT count(*) FROM job_readiness_items r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id AND r.is_blocker AND NOT r.is_complete)::int AS blocker_count,
      (SELECT count(*) FROM job_readiness_items r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id AND r.is_required AND NOT r.is_complete)::int AS incomplete_required_count,
      (SELECT count(*) FROM job_watch_flags w WHERE w.tenant_id=j.tenant_id AND w.job_id=j.id AND w.status IN ('open','acknowledged','snoozed'))::int AS open_watch_flag_count,
      (SELECT count(*) FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id)::int AS workflow_run_count,
      (SELECT count(*) FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id)::int AS production_item_count,
      COALESCE((
        SELECT count(DISTINCT shoot_id) FROM (
          SELECT j.legacy_shoot_id AS shoot_id WHERE j.legacy_shoot_id IS NOT NULL
          UNION
          SELECT l.shoot_id FROM job_shoot_links l WHERE l.tenant_id=j.tenant_id AND l.job_id=j.id
        ) u WHERE shoot_id IS NOT NULL
      ), 0)::int AS linked_shoot_count
    FROM jobs j
  )`;

function attentionReasonsSelect(): string {
  // Build a text[] of the canonical, Job-native attention reasons per row.
  const parts = JOB_NATIVE_ATTENTION_REASONS.map((r) => `CASE WHEN ${r.sql} THEN '${r.reason}' END`);
  return `ARRAY_REMOVE(ARRAY[${parts.join(", ")}], NULL) AS attention_reasons`;
}

export type JobIndexResult = {
  rows: Record<string, unknown>[];
  summary: { total: number; metrics: Array<{ key: string; label: string; available: boolean; reason?: string; count: number | null }> };
  page: { limit: number; offset: number; total: number; returned: number; has_more: boolean };
  attention_reason_availability: { job_native: string[]; unavailable: typeof JOB_INDEX_UNAVAILABLE_ATTENTION_REASONS };
  applied_metric: string | null;
};

export async function getJobsCanonicalIndex(client: PoolClient, auth: AuthUser, filters: JobIndexFilters): Promise<JobIndexResult> {
  const { where, params } = buildBase(auth, filters);

  // Resolve the active metric selector (a filterable predicate over the base).
  const metricKey = (filters.metric ?? "").trim() || null;
  let metricSql = "";
  if (metricKey) {
    const metric = METRIC_BY_KEY.get(metricKey);
    if (!metric || !metric.available || !metric.sql) {
      throw new ApiError(400, `Unknown or unavailable metric filter: ${metricKey}`);
    }
    metricSql = ` AND ${metric.sql}`;
  }

  // 1) Summary over the base (NOT including the metric selector), one query.
  const metricCountCols = AVAILABLE_METRICS.map((m, i) => `count(*) FILTER (WHERE ${m.sql})::int AS m_${i}`);
  const summarySql = `
    WITH ${FILTERED_CTE}
    SELECT count(*)::int AS total ${metricCountCols.length ? ", " + metricCountCols.join(", ") : ""}
    FROM filtered f
    WHERE ${where}`;
  const summaryRow = (await client.query(summarySql, params)).rows[0] ?? {};
  const baseTotal: number = summaryRow.total ?? 0;
  const metrics = AVAILABLE_METRICS.map((m, i) => ({ key: m.key, label: m.label, available: true as const, count: summaryRow[`m_${i}`] ?? 0 }));
  const unavailableMetrics = JOB_INDEX_METRICS.filter((m) => !m.available).map((m) => ({ key: m.key, label: m.label, available: false as const, reason: m.reason, count: null }));

  // 2) Filtered total (base + metric selector) — equals summary[metric] when a metric is applied.
  const filteredTotal: number = metricKey
    ? (await client.query(`WITH ${FILTERED_CTE} SELECT count(*)::int AS total FROM filtered f WHERE ${where}${metricSql}`, params)).rows[0]?.total ?? 0
    : baseTotal;

  // 3) Page of rows (base + metric selector), deterministic sort with jobs.id tiebreaker.
  const sortKey = (filters.sort ?? "date").trim();
  const sortCol = SORTABLE.get(sortKey) ?? SORTABLE.get("date")!;
  const dir = (filters.direction ?? (sortKey === "name" ? "asc" : "desc")).trim().toLowerCase() === "asc" ? "ASC" : "DESC";
  const nullsLast = sortCol.includes("scheduled_start_at") ? " NULLS LAST" : "";
  const limit = Math.min(Math.max(Number(filters.limit) || JOB_INDEX_DEFAULT_PAGE_SIZE, 1), JOB_INDEX_MAX_PAGE_SIZE);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const rowParams = [...params, limit, offset];
  const rowsSql = `
    WITH ${FILTERED_CTE}
    SELECT
      f.id, f.job_number, f.title, f.event_name, f.department_type, f.job_category,
      f.organization_id, org.canonical_name AS organization_name,
      f.account_owner_user_id, owner_u.full_name AS owner_name,
      f.scheduled_start_at AS job_date, f.scheduled_end_at,
      f.job_status, f.production_status, f.readiness_status, f.risk_status, f.staffing_status,
      f.client_deadline_at, f.production_deadline_at,
      f.blocker_count, f.open_watch_flag_count, f.incomplete_required_count,
      f.workflow_run_count, f.production_item_count, f.linked_shoot_count,
      (f.linked_shoot_count > 0) AS shoot_data_available,
      (f.linked_shoot_count > 0) AS staffing_data_available,
      (f.linked_shoot_count > 0) AS schedule_data_available,
      (f.workflow_run_count > 0) AS workflow_data_available,
      (f.production_item_count > 0) AS production_data_available,
      CASE WHEN f.linked_shoot_count > 0 THEN 'linked' ELSE 'unlinked' END AS shoot_link_status,
      ${attentionReasonsSelect()}
    FROM filtered f
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN app_user owner_u ON owner_u.id = f.account_owner_user_id
    WHERE ${where}${metricSql}
    ORDER BY ${sortCol} ${dir}${nullsLast}, f.id ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const rawRows = (await client.query(rowsSql, rowParams)).rows;

  // Per-row confirmed-link projection (ids + sources), deduped. Done as a single
  // batched query over the returned page (no N+1).
  const pageIds = rawRows.map((r) => r.id as string);
  const linkRows = pageIds.length
    ? (
        await client.query(
          `SELECT job_id, shoot_id, source FROM (
             SELECT id AS job_id, legacy_shoot_id AS shoot_id, 'legacy_shoot_id' AS source FROM jobs WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND legacy_shoot_id IS NOT NULL
             UNION
             SELECT job_id, shoot_id, 'job_shoot_links' AS source FROM job_shoot_links WHERE tenant_id=$1 AND job_id = ANY($2::uuid[])
           ) u`,
          [auth.tenantId, pageIds]
        )
      ).rows
    : [];
  const linksByJob = new Map<string, { ids: Set<string>; sources: Set<string> }>();
  for (const lr of linkRows) {
    const e = linksByJob.get(lr.job_id) ?? { ids: new Set<string>(), sources: new Set<string>() };
    if (lr.shoot_id) e.ids.add(lr.shoot_id);
    e.sources.add(lr.source);
    linksByJob.set(lr.job_id, e);
  }

  const rows = rawRows.map((r) => {
    const link = linksByJob.get(r.id as string);
    const ids = link ? Array.from(link.ids) : [];
    const sources = link ? Array.from(link.sources) : [];
    const linked = ids.length > 0;
    return {
      ...r,
      linked_shoot_ids: ids,
      link_sources: sources,
      single_linked_shoot_id: ids.length === 1 ? ids[0] : null,
      operational_data_available: linked || r.workflow_data_available || r.production_data_available,
      operational_link_explanation: linked
        ? null
        : "No Shoot linked — operational scheduling and staffing data are unavailable until a Shoot is linked."
    };
  });

  return {
    rows,
    summary: { total: baseTotal, metrics: [...metrics, ...unavailableMetrics] },
    page: { limit, offset, total: filteredTotal, returned: rows.length, has_more: offset + rows.length < filteredTotal },
    attention_reason_availability: { job_native: JOB_NATIVE_ATTENTION_REASONS.map((r) => r.reason), unavailable: JOB_INDEX_UNAVAILABLE_ATTENTION_REASONS },
    applied_metric: metricKey
  };
}
