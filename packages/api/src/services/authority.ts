import type { PoolClient } from "pg";
import { getLegacyRolesForAuthority } from "../authz/authority.js";
import type { AuthorityTier, DepartmentCode, JobFunctionProfile } from "../types/auth.js";

export type AuthoritySyncInput = {
  tenantId: string;
  userId: string;
  authorityTier: AuthorityTier;
  primaryJobFunctionProfile: JobFunctionProfile;
  jobFunctionProfiles?: JobFunctionProfile[];
  scopeDepartment?: DepartmentCode | null;
  scopeOverrides?: Record<string, unknown>;
  assignedByUserId?: string | null;
};

export async function syncUserAuthorityAssignment(client: PoolClient, input: AuthoritySyncInput) {
  const profiles = [...new Set([input.primaryJobFunctionProfile, ...(input.jobFunctionProfiles ?? [])])];

  await client.query(
    `
      INSERT INTO user_authority_assignment (
        tenant_id, user_id, authority_tier, primary_job_function_profile, scope_department, scope_overrides, assigned_by_user_id
      )
      VALUES ($1,$2,$3::authority_tier,$4::job_function_profile,$5::department_code,$6::jsonb,$7)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET authority_tier = EXCLUDED.authority_tier,
          primary_job_function_profile = EXCLUDED.primary_job_function_profile,
          scope_department = EXCLUDED.scope_department,
          scope_overrides = EXCLUDED.scope_overrides,
          assigned_by_user_id = EXCLUDED.assigned_by_user_id,
          updated_at = now()
    `,
    [
      input.tenantId,
      input.userId,
      input.authorityTier,
      input.primaryJobFunctionProfile,
      input.scopeDepartment ?? null,
      JSON.stringify(input.scopeOverrides ?? {}),
      input.assignedByUserId ?? null
    ]
  );

  await client.query("DELETE FROM user_job_function_profile WHERE tenant_id = $1 AND user_id = $2", [input.tenantId, input.userId]);
  for (const profile of profiles) {
    await client.query(
      `
        INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
        VALUES ($1,$2,$3::job_function_profile)
        ON CONFLICT (tenant_id, user_id, job_function_profile) DO NOTHING
      `,
      [input.tenantId, input.userId, profile]
    );
  }

  const compatibilityRoles = getLegacyRolesForAuthority(input.authorityTier, profiles);
  const roleResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM role
      WHERE code = ANY($1::text[])
    `,
    [compatibilityRoles]
  );

  await client.query("DELETE FROM user_role WHERE tenant_id = $1 AND user_id = $2", [input.tenantId, input.userId]);
  for (const row of roleResult.rows) {
    await client.query("INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [
      input.tenantId,
      input.userId,
      row.id
    ]);
  }
}
