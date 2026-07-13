import type { PoolClient } from "pg";

// Convergence slice 1 backfill (MC-AUDIT-001 / audit prompt 6; owner-ratified
// 2026-07-13). Two tiers, exactly as the 2026-06-19 convergence dry run
// (docs/jobs-shoot-convergence-audit.md §6) prescribes:
//
//   Tier 1 — DETERMINISTIC: jobs.legacy_shoot_id is an explicit FK; those links
//            are written as CONFIRMED (source legacy_backfill).
//   Tier 2 — SUGGESTED: organization + exact date + department with EXACTLY ONE
//            matching shoot. Written as PROPOSED — a human confirms or rejects
//            in the link-review queue. Multi-shoot (ambiguous) matches are
//            reported but NEVER proposed as links; fuzzy/title matching is
//            forbidden outright.
//
// Idempotent: re-runs never duplicate rows, never resurrect rejected proposals,
// and never touch confirmed links. Output is a reviewable JSON report.

type Report = {
  tenant_id: string;
  tier1_deterministic: { confirmed_created: number; already_present: number };
  tier2_suggested: {
    proposed_created: number;
    already_present_or_rejected: number;
    proposals: Array<{
      job_id: string;
      job_number: string | null;
      job_title: string;
      shoot_id: string;
      shoot_code: string | null;
      shoot_title: string | null;
      date: string;
    }>;
  };
  ambiguous_job_count: number;
  no_candidate_job_count: number;
  unlinked_active_job_count: number;
};

function mapJobDepartmentToShootDepartment(departmentType: string): string | null {
  if (departmentType === "schools") return "schools";
  if (departmentType === "sports") return "sports";
  if (departmentType === "corporate") return "office";
  return null; // headshots/other have no shoot-department counterpart — org+date only would over-match
}

export async function proposeJobShootLinks(client: PoolClient, tenantId: string, actorUserId: string | null): Promise<Report> {
  // Tier 1 — deterministic legacy FK → confirmed.
  const tier1 = await client.query<{ id: string; created: boolean }>(
    `
      INSERT INTO job_shoot_links (
        tenant_id, job_id, shoot_id, link_reason, relationship_type, source, status,
        linked_at, reason, legacy_source_identifier
      )
      SELECT j.tenant_id, j.id, j.legacy_shoot_id, 'legacy_primary', 'primary', 'legacy_backfill', 'confirmed',
             now(), 'Deterministic jobs.legacy_shoot_id FK', 'jobs.legacy_shoot_id'
      FROM jobs j
      WHERE j.tenant_id = $1 AND j.legacy_shoot_id IS NOT NULL
      ON CONFLICT (tenant_id, job_id, shoot_id) DO NOTHING
      RETURNING id, true AS created
    `,
    [tenantId]
  );
  const tier1Total = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM jobs WHERE tenant_id = $1 AND legacy_shoot_id IS NOT NULL`,
    [tenantId]
  );

  // Candidate scan — org + exact date, counting matching shoots per job.
  // Only active, non-demo jobs without a confirmed link participate.
  const { rows: candidates } = await client.query<{
    job_id: string;
    job_number: string | null;
    job_title: string;
    department_type: string;
    date: string;
    shoot_ids: string[];
  }>(
    `
      SELECT
        j.id AS job_id, j.job_number, j.title AS job_title, j.department_type::text,
        j.scheduled_start_at::date::text AS date,
        COALESCE(array_agg(s.id) FILTER (WHERE s.id IS NOT NULL), '{}') AS shoot_ids
      FROM jobs j
      LEFT JOIN shoot s
        ON s.tenant_id = j.tenant_id
       AND s.deleted_at IS NULL
       AND s.organization_id = j.organization_id
       AND s.shoot_date = j.scheduled_start_at::date
      WHERE j.tenant_id = $1
        AND j.archived_at IS NULL
        AND NOT (j.job_status = 'cancelled' OR j.cancelled_at IS NOT NULL)
        AND (j.data_origin IS NULL OR j.data_origin NOT IN ('seed_demo', 'test_fixture'))
        AND j.organization_id IS NOT NULL
        AND j.scheduled_start_at IS NOT NULL
        AND j.legacy_shoot_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_shoot_links l
          WHERE l.tenant_id = j.tenant_id AND l.job_id = j.id AND l.status = 'confirmed'
        )
      GROUP BY j.id
    `,
    [tenantId]
  );

  // Department filter + single-shoot rule, excluding shoots already confirmed elsewhere.
  const { rows: confirmedShootRows } = await client.query<{ shoot_id: string }>(
    `SELECT shoot_id FROM job_shoot_links WHERE tenant_id = $1 AND status = 'confirmed'`,
    [tenantId]
  );
  const confirmedShoots = new Set(confirmedShootRows.map((r) => r.shoot_id));

  let ambiguous = 0;
  let none = 0;
  const singles: Array<{ job_id: string; job_number: string | null; job_title: string; shoot_id: string; date: string }> = [];
  for (const candidate of candidates) {
    const shootDepartment = mapJobDepartmentToShootDepartment(candidate.department_type);
    if (!shootDepartment) {
      none += 1;
      continue;
    }
    const eligible = candidate.shoot_ids.filter((id) => !confirmedShoots.has(id));
    if (eligible.length === 0) {
      none += 1;
    } else if (eligible.length > 1) {
      ambiguous += 1; // reported, never proposed — the ambiguity IS the finding
    } else {
      // Verify the department actually matches before proposing.
      const departmentOk = await client.query<{ ok: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM shoot s WHERE s.tenant_id = $1 AND s.id = $2 AND s.department = $3::department_code
         ) AS ok`,
        [tenantId, eligible[0], shootDepartment]
      );
      if (departmentOk.rows[0]?.ok) {
        singles.push({
          job_id: candidate.job_id,
          job_number: candidate.job_number,
          job_title: candidate.job_title,
          shoot_id: eligible[0],
          date: candidate.date
        });
      } else {
        none += 1;
      }
    }
  }

  // Tier 2 — write proposals (never resurrecting rejected pairs).
  let proposedCreated = 0;
  const proposals: Report["tier2_suggested"]["proposals"] = [];
  for (const single of singles) {
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO job_shoot_links (
          tenant_id, job_id, shoot_id, link_reason, relationship_type, source, status, confidence, reason
        )
        VALUES ($1, $2, $3, 'org_date_match', 'primary', 'suggested', 'proposed', 0.700,
                'Single shoot for this organization on the exact scheduled date, matching department')
        ON CONFLICT (tenant_id, job_id, shoot_id) DO NOTHING
        RETURNING id
      `,
      [tenantId, single.job_id, single.shoot_id]
    );
    if (inserted.rows[0]) {
      proposedCreated += 1;
      await client.query(
        `INSERT INTO job_shoot_link_event (tenant_id, link_id, event_type, to_status, actor_user_id, metadata)
         VALUES ($1, $2, 'proposed', 'proposed', $3, $4::jsonb)`,
        [tenantId, inserted.rows[0].id, actorUserId, JSON.stringify({ matcher: "org+date+department single", date: single.date })]
      );
      const shootMeta = await client.query<{ shoot_code: string | null; title: string | null }>(
        `SELECT shoot_code, title FROM shoot WHERE tenant_id = $1 AND id = $2`,
        [tenantId, single.shoot_id]
      );
      proposals.push({
        ...single,
        shoot_code: shootMeta.rows[0]?.shoot_code ?? null,
        shoot_title: shootMeta.rows[0]?.title ?? null
      });
    }
  }

  const unlinked = await client.query<{ n: number }>(
    `
      SELECT count(*)::int AS n FROM jobs j
      WHERE j.tenant_id = $1 AND j.archived_at IS NULL
        AND NOT (j.job_status = 'cancelled' OR j.cancelled_at IS NOT NULL)
        AND (j.data_origin IS NULL OR j.data_origin NOT IN ('seed_demo', 'test_fixture'))
        AND j.legacy_shoot_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_shoot_links l
          WHERE l.tenant_id = j.tenant_id AND l.job_id = j.id AND l.status = 'confirmed'
        )
    `,
    [tenantId]
  );

  return {
    tenant_id: tenantId,
    tier1_deterministic: {
      confirmed_created: tier1.rowCount ?? 0,
      already_present: (tier1Total.rows[0]?.n ?? 0) - (tier1.rowCount ?? 0)
    },
    tier2_suggested: {
      proposed_created: proposedCreated,
      already_present_or_rejected: singles.length - proposedCreated,
      proposals
    },
    ambiguous_job_count: ambiguous,
    no_candidate_job_count: none,
    unlinked_active_job_count: unlinked.rows[0]?.n ?? 0
  };
}

async function main() {
  const { pool } = await import("../src/db/pool.js");
  const client = await pool.connect();
  try {
    const tenant = await client.query(`SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1`);
    if (tenant.rows.length === 0) {
      throw new Error("Demo Studio tenant not found.");
    }
    const tenantId = tenant.rows[0].id as string;
    await client.query("BEGIN");
    await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenantId]);
    const report = await proposeJobShootLinks(client, tenantId, null);
    await client.query("COMMIT");
    console.log(JSON.stringify({ job_shoot_link_proposals: report }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("propose-job-shoot-links.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
