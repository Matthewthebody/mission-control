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
