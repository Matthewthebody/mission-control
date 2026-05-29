import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../../authz/authority.js";
import { ApiError } from "../../errors/apiError.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import type { AuthUser } from "../../types/auth.js";
import type { WatchlistSavedViewRecord, WatchlistSavedViewSummary } from "../../types/jobTruth.js";

type SavedViewInput = {
  name: string;
  scope_type?: string | null;
  department_type?: JobDepartmentType | null;
  filters_json?: Record<string, unknown> | null;
  is_default?: boolean;
  is_shared?: boolean;
};

function canManageSharedViews(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]);
}

export async function listWatchlistSavedViews(
  client: PoolClient,
  auth: AuthUser,
  departmentType: JobDepartmentType | null = null
): Promise<WatchlistSavedViewSummary[]> {
  const { rows } = await client.query<WatchlistSavedViewSummary>(
    `
      SELECT
        view.*,
        owner.full_name AS owner_name
      FROM watchlist_saved_views view
      LEFT JOIN app_user owner
        ON owner.id = view.owner_user_id
       AND owner.tenant_id = view.tenant_id
      WHERE view.tenant_id = $1
        AND ($2::text IS NULL OR view.department_type::text = $2::text OR view.department_type IS NULL)
        AND (
          view.owner_user_id = $3
          OR view.owner_user_id IS NULL
          OR view.is_shared = true
        )
      ORDER BY view.is_default DESC, view.is_shared DESC, view.name ASC
    `,
    [auth.tenantId, departmentType, auth.id]
  );
  return rows;
}

export async function createWatchlistSavedView(client: PoolClient, auth: AuthUser, input: SavedViewInput) {
  const makeShared = input.is_shared === true;
  if (makeShared && !canManageSharedViews(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const { rows } = await client.query<WatchlistSavedViewRecord>(
    `
      INSERT INTO watchlist_saved_views (
        tenant_id,
        owner_user_id,
        scope_type,
        department_type,
        name,
        filters_json,
        is_default,
        is_shared
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
      RETURNING *
    `,
    [
      auth.tenantId,
      makeShared ? null : auth.id,
      input.scope_type ?? (makeShared ? "shared" : "personal"),
      input.department_type ?? null,
      input.name,
      JSON.stringify(input.filters_json ?? {}),
      input.is_default ?? false,
      makeShared
    ]
  );
  return rows[0];
}

export async function updateWatchlistSavedView(client: PoolClient, auth: AuthUser, viewId: string, input: SavedViewInput) {
  const { rows: existingRows } = await client.query<WatchlistSavedViewRecord>(
    `
      SELECT *
      FROM watchlist_saved_views
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, viewId]
  );
  if (!existingRows.length) {
    throw new ApiError(404, "Saved view not found");
  }
  const existing = existingRows[0];
  const canManage =
    existing.owner_user_id === auth.id ||
    (existing.owner_user_id == null && canManageSharedViews(auth)) ||
    (existing.is_shared && canManageSharedViews(auth));
  if (!canManage) {
    throw new ApiError(403, "Forbidden");
  }

  const { rows } = await client.query<WatchlistSavedViewRecord>(
    `
      UPDATE watchlist_saved_views
      SET name = COALESCE($3, name),
          scope_type = COALESCE($4, scope_type),
          department_type = COALESCE($5::job_department_type, department_type),
          filters_json = COALESCE($6::jsonb, filters_json),
          is_default = COALESCE($7, is_default),
          is_shared = COALESCE($8, is_shared),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [
      auth.tenantId,
      viewId,
      input.name ?? null,
      input.scope_type ?? null,
      input.department_type ?? null,
      input.filters_json ? JSON.stringify(input.filters_json) : null,
      input.is_default ?? null,
      input.is_shared ?? null
    ]
  );
  return rows[0];
}

export async function deleteWatchlistSavedView(client: PoolClient, auth: AuthUser, viewId: string) {
  const { rows } = await client.query<WatchlistSavedViewRecord>(
    `
      DELETE FROM watchlist_saved_views
      WHERE tenant_id = $1
        AND id = $2
        AND (
          owner_user_id = $3
          OR (owner_user_id IS NULL AND $4::boolean = true)
          OR (is_shared = true AND $4::boolean = true)
        )
      RETURNING *
    `,
    [auth.tenantId, viewId, auth.id, canManageSharedViews(auth)]
  );
  if (!rows.length) {
    throw new ApiError(404, "Saved view not found");
  }
}

