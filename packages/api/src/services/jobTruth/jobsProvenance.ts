import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { hasAuthorityTier } from "../../authz/authority.js";

// ── Jobs provenance classification + curated demo (Phase 3C.1) ───────────────
// Deterministic, tenant-scoped. Marks Jobs as seed_demo ONLY on provable signals
// (a hard-coded [DEMO_MARKER] description, a *-DEMO-* job_number, or a conclusively
// demo tenant). Never marks demo on name artificiality alone. Ambiguous Jobs in a
// real tenant are left unmarked (Review Required). Includes a deterministic,
// reproducible curated-demo selection. See docs/jobs-demo-and-bloat-closure-audit.md.

export const JOB_CURATED_DEMO_TARGET = 30;

// A Job is provably demo when ANY of these hold (used in backfill + the dry-run).
const PROVABLE_DEMO_SQL = "(j.description_internal ~ '^\\[[a-z_0-9]+\\]' OR j.job_number LIKE '%-DEMO-%')";

export async function tenantIsDemo(client: PoolClient, tenantId: string): Promise<boolean> {
  const r = await client.query<{ name: string }>(`SELECT name FROM tenant WHERE id=$1`, [tenantId]);
  return /demo/i.test(r.rows[0]?.name ?? "");
}

// Deterministic curated-demo set: the explicitly-marked scenario Jobs, padded with
// capability-bearing Jobs (workflow / production / confirmed Shoot link) ordered by
// id, up to JOB_CURATED_DEMO_TARGET. Reproducible: same DB state -> same ids.
export async function getCuratedDemoJobIds(client: PoolClient, tenantId: string): Promise<Set<string>> {
  const rows = (
    await client.query<{ id: string }>(
      `
      WITH marked AS (
        SELECT j.id, 0 AS ord, j.id::text AS tie FROM jobs j
        WHERE j.tenant_id=$1 AND j.archived_at IS NULL AND ${PROVABLE_DEMO_SQL}
      ),
      padding AS (
        SELECT j.id, 1 AS ord, j.id::text AS tie FROM jobs j
        WHERE j.tenant_id=$1 AND j.archived_at IS NULL AND NOT COALESCE(${PROVABLE_DEMO_SQL}, false)
          AND (
            EXISTS(SELECT 1 FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id)
            OR EXISTS(SELECT 1 FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id)
            OR j.legacy_shoot_id IS NOT NULL
            OR EXISTS(SELECT 1 FROM job_shoot_links l WHERE l.tenant_id=j.tenant_id AND l.job_id=j.id)
          )
      )
      SELECT id::text FROM (SELECT * FROM marked UNION ALL SELECT * FROM padding) u
      ORDER BY ord, tie
      LIMIT $2
      `,
      [tenantId, JOB_CURATED_DEMO_TARGET]
    )
  ).rows;
  return new Set(rows.map((r) => r.id));
}

export type JobsProvenanceReport = {
  dry_run: boolean;
  tenant_is_demo: boolean;
  total_unmarked: number;
  proposed_seed_demo: number;
  proposed_review_required: number;
  applied_seed_demo: number;
  by_signal: { marker_or_demo_number: number; demo_tenant_only: number };
};

// Backfill data_origin='seed_demo' for currently-unmarked Jobs that are provably
// demo. Dry-run by default; apply requires an administrative role.
export async function backfillJobsProvenance(client: PoolClient, auth: AuthUser, options: { dryRun?: boolean } = {}): Promise<JobsProvenanceReport> {
  const dryRun = options.dryRun !== false;
  if (!dryRun && !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Provenance backfill apply requires an administrative role");
  }
  const isDemo = await tenantIsDemo(client, auth.tenantId);
  const counts = (
    await client.query(
      `
      SELECT
        count(*) FILTER (WHERE data_origin IS NULL)::int AS total_unmarked,
        count(*) FILTER (WHERE data_origin IS NULL AND COALESCE(${PROVABLE_DEMO_SQL}, false))::int AS by_signal,
        count(*) FILTER (WHERE data_origin IS NULL AND NOT COALESCE(${PROVABLE_DEMO_SQL}, false))::int AS no_signal
      FROM jobs j WHERE j.tenant_id=$1
      `,
      [auth.tenantId]
    )
  ).rows[0] as { total_unmarked: number; by_signal: number; no_signal: number };

  // Proposed marking: by-signal always; no-signal only when the tenant is conclusively demo.
  const proposedSeedDemo = counts.by_signal + (isDemo ? counts.no_signal : 0);
  const proposedReview = isDemo ? 0 : counts.no_signal;

  let applied = 0;
  if (!dryRun && proposedSeedDemo > 0) {
    const whereProvable = isDemo ? "data_origin IS NULL" : `data_origin IS NULL AND ${PROVABLE_DEMO_SQL}`;
    const res = await client.query(`UPDATE jobs j SET data_origin='seed_demo', updated_at=now() WHERE j.tenant_id=$1 AND ${whereProvable}`, [auth.tenantId]);
    applied = res.rowCount ?? 0;
  }

  return {
    dry_run: dryRun,
    tenant_is_demo: isDemo,
    total_unmarked: counts.total_unmarked,
    proposed_seed_demo: proposedSeedDemo,
    proposed_review_required: proposedReview,
    applied_seed_demo: applied,
    by_signal: { marker_or_demo_number: counts.by_signal, demo_tenant_only: isDemo ? counts.no_signal : 0 }
  };
}
