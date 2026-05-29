import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { isFieldRole } from "../authz/policy.js";
import { canCreateOrEditShootDepartment, hasAuthorityTier } from "../authz/authority.js";
import type { AuthUser } from "../types/auth.js";

async function hasPublishedShiftOnShoot(client: PoolClient, auth: AuthUser, shootId: string) {
  const shift = await client.query(
    `
      SELECT 1
      FROM work_shift
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND assigned_user_id = $3
        AND status = 'published'
        AND cancelled_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shootId, auth.id]
  );

  return Boolean(shift.rows[0]);
}

export async function assertShootAccess(client: PoolClient, auth: AuthUser, shootId: string) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return;
  }

  const shootResult = await client.query<{ department: AuthUser["department"] }>(
    `
      SELECT department::text AS department
      FROM shoot
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [auth.tenantId, shootId]
  );
  const shoot = shootResult.rows[0];
  if (!shoot) {
    throw new ApiError(404, "Shoot not found");
  }

  if (!isFieldRole(auth) && canCreateOrEditShootDepartment(auth, shoot.department)) {
    return;
  }

  if (!isFieldRole(auth)) {
    throw new ApiError(403, "Forbidden");
  }

  const assignment = await client.query(
    `
      SELECT 1
      FROM shoot_assignment
      WHERE tenant_id = $1
        AND shoot_id = $2
        AND user_id = $3
      LIMIT 1
    `,
    [auth.tenantId, shootId, auth.id]
  );

  if (assignment.rows[0] || (await hasPublishedShiftOnShoot(client, auth, shootId))) {
    return;
  }

  throw new ApiError(403, "Forbidden");
}
