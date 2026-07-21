import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { hasAuthorityTier } from "../../authz/authority.js";

// Convergence slice 1 (MC-AUDIT-001, owner-ratified 2026-07-13): the reviewed
// Job↔Shoot bridge. A matching script PROPOSES links; a human confirms or
// rejects them here. Nothing but a human review (or the deterministic
// legacy_shoot_id FK / intake publish) ever produces a confirmed link.

const LINK_REVIEW_PAGE_LIMIT = 200;

function requireLinkReviewAccess(auth: AuthUser) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    throw new ApiError(403, "Job/Shoot link review requires an administrative role");
  }
}

export type JobShootLinkReviewRow = {
  id: string;
  status: string;
  source: string;
  relationship_type: string;
  confidence: string | null;
  reason: string | null;
  created_at: string;
  job_id: string;
  job_number: string | null;
  job_title: string;
  job_department: string;
  job_scheduled_start_at: string | null;
  shoot_id: string;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
};

export async function listJobShootLinkReview(client: PoolClient, auth: AuthUser) {
  requireLinkReviewAccess(auth);
  const { rows: proposals } = await client.query<JobShootLinkReviewRow>(
    `
      SELECT
        l.id, l.status, l.source, l.relationship_type, l.confidence::text, l.reason, l.created_at::text,
        j.id AS job_id, j.job_number, j.title AS job_title, j.department_type::text AS job_department,
        j.scheduled_start_at::text AS job_scheduled_start_at,
        s.id AS shoot_id, s.shoot_code, s.title AS shoot_title, s.shoot_date::text AS shoot_date
      FROM job_shoot_links l
      JOIN jobs j ON j.id = l.job_id AND j.tenant_id = l.tenant_id
      JOIN shoot s ON s.id = l.shoot_id AND s.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND l.status = 'proposed'
      ORDER BY l.created_at ASC
      LIMIT ${LINK_REVIEW_PAGE_LIMIT}
    `,
    [auth.tenantId]
  );

  const { rows: summaryRows } = await client.query<{
    proposed_count: number;
    confirmed_count: number;
    rejected_count: number;
    unlinked_active_job_count: number;
  }>(
    `
      SELECT
        (SELECT count(*)::int FROM job_shoot_links WHERE tenant_id = $1 AND status = 'proposed') AS proposed_count,
        (SELECT count(*)::int FROM job_shoot_links WHERE tenant_id = $1 AND status = 'confirmed') AS confirmed_count,
        (SELECT count(*)::int FROM job_shoot_links WHERE tenant_id = $1 AND status = 'rejected') AS rejected_count,
        (
          SELECT count(*)::int FROM jobs j
          WHERE j.tenant_id = $1
            AND j.archived_at IS NULL
            AND NOT (j.job_status = 'cancelled' OR j.cancelled_at IS NOT NULL)
            AND (j.data_origin IS NULL OR j.data_origin NOT IN ('seed_demo', 'test_fixture'))
            AND j.legacy_shoot_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM job_shoot_links l
              WHERE l.tenant_id = j.tenant_id AND l.job_id = j.id AND l.status = 'confirmed'
            )
        ) AS unlinked_active_job_count
    `,
    [auth.tenantId]
  );

  return {
    proposals,
    proposals_truncated_at: proposals.length === LINK_REVIEW_PAGE_LIMIT ? LINK_REVIEW_PAGE_LIMIT : null,
    summary: summaryRows[0]
  };
}

// A4 (owner-ratified): the matching script PROPOSES links for active-season
// shoots only — a human confirms in this review queue; historical shoots stay
// honestly unlinked. Two DETERMINISTIC rules only (the audits bar fuzzy
// backfill): (1) jobs.legacy_shoot_id = shoot.id — the 1:1 key intake wrote
// before engagement reuse; (2) the migration-177 engagement key — an existing
// Job for the shoot's organization + CURRENT service term + department, with
// the shoot dated inside the term window when the term declares one. Demo and
// test-fixture jobs never generate proposals. Idempotent: shoots with ANY
// existing link row (proposed/confirmed/rejected) are skipped, so re-running
// never re-proposes what a reviewer already rejected.
const PROPOSAL_BATCH_LIMIT = 200;

export async function proposeJobShootLinkBackfill(client: PoolClient, auth: AuthUser) {
  requireLinkReviewAccess(auth);
  const { rows: candidates } = await client.query<{
    shoot_id: string;
    job_id: string;
    rule: string;
    confidence: string;
    relationship_type: string;
    reason: string;
  }>(
    `
      WITH unlinked_shoot AS (
        SELECT s.id, s.organization_id, s.department, s.shoot_date
        FROM shoot s
        WHERE s.tenant_id = $1
          AND s.record_state = 'published'
          AND s.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM job_shoot_links l
            WHERE l.tenant_id = $1 AND l.shoot_id = s.id
          )
      ),
      legacy_match AS (
        SELECT us.id AS shoot_id, j.id AS job_id,
               'legacy_shoot_id' AS rule, '0.990' AS confidence,
               'primary' AS relationship_type,
               'Deterministic match: the Job''s legacy_shoot_id is this Shoot.' AS reason
        FROM unlinked_shoot us
        JOIN jobs j ON j.tenant_id = $1 AND j.legacy_shoot_id = us.id
        WHERE j.archived_at IS NULL
          AND j.job_status <> 'cancelled'::job_status_type
          AND (j.data_origin IS NULL OR j.data_origin NOT IN ('seed_demo', 'test_fixture'))
      ),
      engagement_match AS (
        SELECT us.id AS shoot_id, j.id AS job_id,
               'engagement_key' AS rule, '0.900' AS confidence,
               'additional_day' AS relationship_type,
               'Engagement-key match: same organization, current service term, and department.' AS reason
        FROM unlinked_shoot us
        JOIN school_service_term st
          ON st.tenant_id = $1
         AND st.organization_id = us.organization_id
         AND st.status = 'current'
         AND (st.start_date IS NULL OR us.shoot_date >= st.start_date)
         AND (st.end_date IS NULL OR us.shoot_date <= st.end_date)
        JOIN jobs j
          ON j.tenant_id = $1
         AND j.organization_id = us.organization_id
         AND j.service_term_id = st.id
         AND j.department_type::text = us.department::text
        WHERE j.archived_at IS NULL
          AND j.job_status <> 'cancelled'::job_status_type
          AND (j.data_origin IS NULL OR j.data_origin NOT IN ('seed_demo', 'test_fixture'))
          AND us.id NOT IN (SELECT shoot_id FROM legacy_match)
      )
      SELECT * FROM legacy_match
      UNION ALL
      SELECT * FROM engagement_match
      ORDER BY confidence DESC, shoot_id
    `,
    [auth.tenantId]
  );

  const batch = candidates.slice(0, PROPOSAL_BATCH_LIMIT);
  const proposedIds: string[] = [];
  for (const candidate of batch) {
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO job_shoot_links (
          tenant_id, job_id, shoot_id, link_reason, relationship_type, source, status,
          confidence, reason, linked_by_user_id
        )
        VALUES ($1, $2, $3, 'backfill_proposal', $4, 'suggested', 'proposed', $5::numeric, $6, $7)
        ON CONFLICT (tenant_id, job_id, shoot_id) DO NOTHING
        RETURNING id
      `,
      [auth.tenantId, candidate.job_id, candidate.shoot_id, candidate.relationship_type, candidate.confidence, candidate.reason, auth.id]
    );
    const linkId = inserted.rows[0]?.id;
    if (linkId) {
      proposedIds.push(linkId);
      await client.query(
        `INSERT INTO job_shoot_link_event (tenant_id, link_id, event_type, to_status, actor_user_id, metadata)
         VALUES ($1, $2, 'proposed', 'proposed', $3, $4::jsonb)`,
        [auth.tenantId, linkId, auth.id, JSON.stringify({ rule: candidate.rule, shoot_id: candidate.shoot_id, job_id: candidate.job_id })]
      );
    }
  }

  return {
    candidate_count: candidates.length,
    proposed_count: proposedIds.length,
    truncated_at: candidates.length > PROPOSAL_BATCH_LIMIT ? PROPOSAL_BATCH_LIMIT : null,
    proposed_link_ids: proposedIds
  };
}

async function loadLink(client: PoolClient, tenantId: string, linkId: string) {
  const { rows } = await client.query(
    `SELECT * FROM job_shoot_links WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, linkId]
  );
  return rows[0] ?? null;
}

export async function confirmJobShootLink(client: PoolClient, auth: AuthUser, linkId: string, note?: string | null) {
  requireLinkReviewAccess(auth);
  const link = await loadLink(client, auth.tenantId, linkId);
  if (!link) {
    throw new ApiError(404, "Link proposal not found");
  }
  if (link.status !== "proposed") {
    throw new ApiError(409, `Only a proposed link can be confirmed (current status: ${link.status}).`);
  }
  let updated;
  try {
    updated = await client.query(
      `
        UPDATE job_shoot_links
        SET status = 'confirmed', linked_at = now(), reviewed_by_user_id = $3, reviewed_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'proposed'
        RETURNING *
      `,
      [auth.tenantId, linkId, auth.id]
    );
  } catch (error) {
    // The confirmed-per-shoot uniqueness (167) is a hard product rule: a Shoot
    // belongs to at most one confirmed Job.
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "This Shoot already has a confirmed Job link. Reject this proposal or unlink the other Job first.");
    }
    throw error;
  }
  const row = updated.rows[0];
  if (!row) {
    throw new ApiError(409, "The proposal changed while you were reviewing it — reload and try again.");
  }
  await client.query(
    `INSERT INTO job_shoot_link_event (tenant_id, link_id, event_type, from_status, to_status, actor_user_id, metadata)
     VALUES ($1, $2, 'confirmed', 'proposed', 'confirmed', $3, $4::jsonb)`,
    [auth.tenantId, linkId, auth.id, JSON.stringify({ note: note ?? null })]
  );
  return row;
}

export async function rejectJobShootLink(client: PoolClient, auth: AuthUser, linkId: string, note?: string | null) {
  requireLinkReviewAccess(auth);
  const link = await loadLink(client, auth.tenantId, linkId);
  if (!link) {
    throw new ApiError(404, "Link proposal not found");
  }
  if (link.status !== "proposed") {
    throw new ApiError(409, `Only a proposed link can be rejected (current status: ${link.status}).`);
  }
  const updated = await client.query(
    `
      UPDATE job_shoot_links
      SET status = 'rejected', reviewed_by_user_id = $3, reviewed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'proposed'
      RETURNING *
    `,
    [auth.tenantId, linkId, auth.id]
  );
  const row = updated.rows[0];
  if (!row) {
    throw new ApiError(409, "The proposal changed while you were reviewing it — reload and try again.");
  }
  await client.query(
    `INSERT INTO job_shoot_link_event (tenant_id, link_id, event_type, from_status, to_status, actor_user_id, metadata)
     VALUES ($1, $2, 'rejected', 'proposed', 'rejected', $3, $4::jsonb)`,
    [auth.tenantId, linkId, auth.id, JSON.stringify({ note: note ?? null })]
  );
  return row;
}
