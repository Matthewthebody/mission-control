import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { isFieldRole } from "../authz/policy.js";
import { hasAuthorityTier, hasJobFunctionProfile, isDepartmentScopedScheduler, isOwnOnlyScheduleUser } from "../authz/authority.js";
import type { AuthUser } from "../types/auth.js";
import { getLocalDateString } from "../utils/localDate.js";

type ShiftAccessRow = {
  id: string;
  assigned_user_id: string;
  starts_at: string;
  ends_at: string | null;
  shoot_id: string | null;
  manager_user_id: string | null;
  status: string;
  cancelled_at: string | null;
};

export async function hasPublishedShiftOnShoot(client: PoolClient, auth: AuthUser, shootId: string) {
  const membership = await client.query(
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
  return Boolean(membership.rows[0]);
}

export async function hasPublishedSeniorScopeOnShoot(client: PoolClient, tenantId: string, shootId: string, userId: string) {
  const seniorScope = await client.query(
    `
      SELECT 1
      FROM work_shift ws
      JOIN user_job_function_profile ujp ON ujp.user_id = ws.assigned_user_id AND ujp.tenant_id = ws.tenant_id
      WHERE ws.tenant_id = $1
        AND ws.shoot_id = $2
        AND ws.assigned_user_id = $3
        AND ws.status = 'published'
        AND ws.cancelled_at IS NULL
        AND ujp.job_function_profile = 'senior_photographer'
      LIMIT 1
    `,
    [tenantId, shootId, userId]
  );
  return Boolean(seniorScope.rows[0]);
}

export async function assertShiftAccess(client: PoolClient, auth: AuthUser, shiftId: string) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return;
  }

  const shiftResult = await client.query(
    `
      SELECT ws.id, ws.assigned_user_id, ws.shoot_id, ws.department, ws.status, ws.cancelled_at
      FROM work_shift ws
      WHERE ws.id = $1
    `,
    [shiftId]
  );
  const shift = shiftResult.rows[0] as (Pick<ShiftAccessRow, "id" | "assigned_user_id" | "shoot_id" | "status" | "cancelled_at"> & {
    department?: string | null;
  }) | undefined;
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  if (String(shift.assigned_user_id) === auth.id) {
    return;
  }

  if (
    isFieldRole(auth) &&
    shift.shoot_id &&
    shift.status === "published" &&
    !shift.cancelled_at &&
    (await hasPublishedShiftOnShoot(client, auth, shift.shoot_id))
  ) {
      return;
  }

  if (isDepartmentScopedScheduler(auth) && String(shift.department ?? "") === auth.department) {
    return;
  }

  throw new ApiError(403, "Forbidden");
}

export async function assertShiftManagementScope(client: PoolClient, auth: AuthUser, shiftId: string) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return;
  }

  const shiftResult = await client.query(
    `
      SELECT ws.id, ws.assigned_user_id, ws.starts_at, ws.ends_at, ws.shoot_id, ws.manager_user_id
      FROM work_shift ws
      WHERE ws.id = $1
    `,
    [shiftId]
  );
  const shift = shiftResult.rows[0] as ShiftAccessRow | undefined;
  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  if (hasJobFunctionProfile(auth, "senior_photographer") && shift.shoot_id) {
    const startDate = getLocalDateString(shift.starts_at);
    const endDate = getLocalDateString(shift.ends_at ?? shift.starts_at);
    const today = getLocalDateString();
    if (startDate !== today && endDate !== today) {
      throw new ApiError(403, "Only same-day attendance actions are allowed");
    }

    if (String(shift.manager_user_id ?? "") === auth.id && String(shift.assigned_user_id) !== auth.id) {
      return;
    }

    if ((await hasPublishedSeniorScopeOnShoot(client, auth.tenantId, shift.shoot_id, auth.id)) && String(shift.assigned_user_id) !== auth.id) {
      return;
    }
  }

  if (hasJobFunctionProfile(auth, "senior_photographer") && !shift.shoot_id) {
    const startDate = getLocalDateString(shift.starts_at);
    const endDate = getLocalDateString(shift.ends_at ?? shift.starts_at);
    const today = getLocalDateString();
    if (startDate !== today && endDate !== today) {
      throw new ApiError(403, "Only same-day attendance actions are allowed");
    }

    if (String(shift.manager_user_id ?? "") === auth.id && String(shift.assigned_user_id) !== auth.id) {
      return;
    }
  }

  throw new ApiError(403, "Forbidden");
}

export function shouldRestrictShiftList(auth: AuthUser) {
  return isOwnOnlyScheduleUser(auth);
}

export function shouldDepartmentScopeShiftList(auth: AuthUser) {
  return isDepartmentScopedScheduler(auth);
}
