import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { hasAuthorityTier } from "../authz/authority.js";

// June 18 feedback — canonical Production / Graphics operating read model over production_project
// (+ production_project_task for missing-inputs). One server-side aggregate: metrics are scoped
// COUNT(*) over an explicit predicate (displayed count === filtered total); the dense row list is
// paginated, deterministically sorted, single-query (no N+1). Scope: leadership = all; otherwise own
// (owner_user_id = self). "Working" exposes the current live workflow step (the active task).

export type ProductionMetric = { key: string; available: boolean; count: number | null; reason?: string };
export type ProductionRow = {
  source_type: "production_project";
  source_id: string;
  job_id: string | null;
  organization_id: string | null;
  title: string;
  stage: string;
  current_step: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  next_action: string | null;
  waiting_on: string | null;
  missing_inputs: number;
  blocker_count: number;
  approval_state: string;
  risk: "none" | "warning" | "critical";
  age_in_stage_days: number | null;
  exact_destination_hash: string;
  provenance: string;
};
export type ProductionOperations = {
  generated_at: string;
  scope: "all" | "own";
  metrics: ProductionMetric[];
  rows: ProductionRow[];
  page: { limit: number; offset: number; total: number };
};

// status → normalized stage. Canonical statuses are new | active | blocked (+ completed/canceled).
function normalizeStage(status: string, stage: string | null): string {
  if (status === "completed") return "Done";
  if (status === "canceled") return "Done";
  if (status === "blocked") return "Waiting";
  if (status === "new") return "To Delegate / Ready";
  // active — prefer an explicit canonical stage label when present
  if (stage && /review|qc/i.test(stage)) return "Review";
  if (stage && /deliver|launch|release/i.test(stage)) return "Delivery / Launch";
  return "Working";
}

const PRODUCTION_TIERS = ["super_admin", "leadership", "director_admin"] as const;

export async function getProductionOperations(
  client: PoolClient,
  auth: AuthUser,
  filters: { stage?: string | null; risk?: string | null; limit?: number; offset?: number } = {}
): Promise<ProductionOperations> {
  const scope: "all" | "own" = hasAuthorityTier(auth, [...PRODUCTION_TIERS]) ? "all" : "own";
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  // scope predicate (parameterized): own restricts to projects this user owns.
  const scopeSql = scope === "own" ? `AND p.owner_user_id = $2` : "";
  const params: unknown[] = scope === "own" ? [auth.tenantId, auth.id] : [auth.tenantId];

  // ── Metrics — each an explicit scoped COUNT(*) predicate (count === filtered total) ──────────
  const metricDefs: { key: string; predicate: string }[] = [
    { key: "ready_to_delegate", predicate: "p.status = 'new'" },
    { key: "working", predicate: "p.status = 'active'" },
    { key: "blocked", predicate: "p.status = 'blocked'" },
    { key: "unowned", predicate: "p.owner_user_id IS NULL AND p.status NOT IN ('completed','canceled')" },
    { key: "behind_promised_delivery", predicate: "p.due_date IS NOT NULL AND p.due_date < current_date AND p.completed_at IS NULL" },
    { key: "missing_inputs", predicate: "EXISTS (SELECT 1 FROM production_project_task t WHERE t.tenant_id = p.tenant_id AND t.project_id = p.id AND t.required = true AND t.status NOT IN ('done','skipped'))" },
    { key: "delivery_risk", predicate: "p.status NOT IN ('completed','canceled') AND p.due_date IS NOT NULL AND p.due_date < current_date + 3" },
    { key: "done_recently", predicate: "p.completed_at IS NOT NULL AND p.completed_at >= current_date - 7" }
  ];
  const metrics: ProductionMetric[] = [];
  for (const m of metricDefs) {
    const row = await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM production_project p WHERE p.tenant_id = $1 ${scopeSql} AND (${m.predicate})`,
      params
    );
    metrics.push({ key: m.key, available: true, count: Number(row.rows[0].n) });
  }

  // ── Dense rows — single query, deterministic sort, bounded page (no N+1, no full-detail) ─────
  const stageFilterSql = filters.stage ? `AND p.status = $${params.length + 1}` : "";
  const rowParams = filters.stage ? [...params, filters.stage] : [...params];
  const totalRow = await client.query<{ n: string }>(
    `SELECT count(*)::text n FROM production_project p WHERE p.tenant_id = $1 ${scopeSql} ${stageFilterSql}`,
    rowParams
  );
  const total = Number(totalRow.rows[0].n);
  const { rows } = await client.query<any>(
    `SELECT p.id::text AS source_id, p.linked_shoot_id::text AS job_id, p.linked_organization_id::text AS organization_id,
            p.title, p.status::text AS status, p.stage AS stage, p.owner_user_id::text AS owner_user_id,
            p.due_date::text AS due_date, p.latest_note AS latest_note,
            (p.status = 'blocked')::int AS blocked,
            COALESCE(p.release_state::text, p.qa_state::text) AS approval_state,
            (current_date - p.updated_at::date) AS age_in_stage_days,
            (SELECT count(*)::int FROM production_project_task t WHERE t.tenant_id = p.tenant_id AND t.project_id = p.id AND t.required = true AND t.status NOT IN ('done','skipped')) AS missing_inputs,
            (SELECT t.title FROM production_project_task t WHERE t.tenant_id = p.tenant_id AND t.project_id = p.id AND t.status IN ('in_progress','todo') ORDER BY t.sort_order, t.created_at LIMIT 1) AS current_step
       FROM production_project p
      WHERE p.tenant_id = $1 ${scopeSql} ${stageFilterSql}
      ORDER BY (p.status = 'blocked') DESC, p.due_date NULLS LAST, p.priority DESC, p.id
      LIMIT ${limit} OFFSET ${offset}`,
    rowParams
  );

  const productionRows: ProductionRow[] = rows.map((r) => {
    const overdue = r.due_date && r.due_date < new Date().toISOString().slice(0, 10);
    const risk: "none" | "warning" | "critical" = r.blocked || overdue ? "critical" : r.missing_inputs > 0 ? "warning" : "none";
    return {
      source_type: "production_project",
      source_id: r.source_id,
      job_id: r.job_id,
      organization_id: r.organization_id,
      title: r.title,
      stage: normalizeStage(r.status, r.stage),
      current_step: r.current_step ?? null,
      owner_user_id: r.owner_user_id,
      due_date: r.due_date,
      next_action: r.current_step ? `Advance: ${r.current_step}` : r.status === "new" ? "Delegate / assign owner" : null,
      waiting_on: r.status === "blocked" ? r.latest_note ?? "Blocked" : null,
      missing_inputs: Number(r.missing_inputs ?? 0),
      blocker_count: r.blocked ? 1 : 0,
      approval_state: r.approval_state ?? "none",
      risk,
      age_in_stage_days: r.age_in_stage_days != null ? Number(r.age_in_stage_days) : null,
      exact_destination_hash: `#production?project=${r.source_id}`,
      provenance: "production_project"
    };
  });

  return {
    generated_at: new Date().toISOString(),
    scope,
    metrics,
    rows: productionRows,
    page: { limit, offset, total }
  };
}
