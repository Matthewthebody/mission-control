import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import {
  AUTHORITY_TIERS,
  JOB_FUNCTION_PROFILES,
  getDefaultAuthorityAssignmentForLegacyRole,
  getPrimaryLegacyRoleForAuthority
} from "../authz/authority.js";
import { canManageMembership } from "../authz/policy.js";
import { syncUserAuthorityAssignment } from "./authority.js";
import { createAuditLog } from "./audit.js";
import { bumpAuthVersion, hashOpaqueToken, hashPassword, revokeAllSessionsForUser } from "./auth.js";
import { deriveCommunicationIdentityStatus } from "./communicationIdentity.js";
import { config } from "../config.js";
import { createMembershipRoleApprovalRequest, requiresDualApprovalForAuthorityTier } from "./securityApprovals.js";
import { deriveInternalRoleGroups } from "./internalRoleMapping.js";
import type {
  AuthRole,
  AuthUser,
  AuthorityTier,
  DepartmentCode,
  JobFunctionProfile,
  MembershipStatus
} from "../types/auth.js";

export const ALL_ROLE_CODES: AuthRole[] = [
  "owner_admin",
  "admin",
  "leadership",
  "senior_photographer",
  "associate_photographer",
  "office_employee",
  "photographer"
];

export const ALL_AUTHORITY_TIERS: AuthorityTier[] = [...AUTHORITY_TIERS];
export const ALL_JOB_FUNCTION_PROFILES: JobFunctionProfile[] = [...JOB_FUNCTION_PROFILES];

export const ALL_DEPARTMENTS: DepartmentCode[] = [
  "executive",
  "operations",
  "schools",
  "sports",
  "office",
  "production",
  "customer_service",
  "unassigned"
];

export type MembershipRecord = {
  id: string;
  tenant_id: string;
  account_id: string | null;
  email: string;
  full_name: string;
  status: MembershipStatus;
  department: DepartmentCode;
  last_login_at: string | null;
  latest_invite_id?: string | null;
  latest_invite_expires_at?: string | null;
  authority_tier: AuthorityTier | null;
  primary_job_function_profile: JobFunctionProfile | null;
  job_function_profiles: JobFunctionProfile[];
  roles: AuthRole[];
  microsoft_user_id?: string | null;
  microsoft_tenant_id?: string | null;
  auth_provider?: string | null;
  linked_at?: string | null;
  account_last_login_at?: string | null;
  communication_enabled?: boolean;
  teams_chat_default_target?: string | null;
  last_verified_at?: string | null;
  communication_identity_status?: "linked_ready" | "disabled" | "incomplete" | "unlinked";
  internal_role_groups?: string[];
};

type AccessAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type AuthoritySelectionInput = {
  role?: AuthRole | null;
  authorityTier?: AuthorityTier | null;
  primaryProfile?: JobFunctionProfile | null;
  jobFunctionProfiles?: JobFunctionProfile[] | null;
  department: DepartmentCode;
};

function resolveAuthoritySelection(input: AuthoritySelectionInput) {
  if (input.authorityTier && input.primaryProfile) {
    const profiles = [...new Set([input.primaryProfile, ...(input.jobFunctionProfiles ?? [])])];
    return {
      authorityTier: input.authorityTier,
      primaryProfile: input.primaryProfile,
      jobFunctionProfiles: profiles,
      compatibilityRole: getPrimaryLegacyRoleForAuthority(input.authorityTier, profiles)
    };
  }

  if (!input.role) {
    throw new ApiError(400, "Authority tier and primary profile are required");
  }

  const fallback = getDefaultAuthorityAssignmentForLegacyRole(input.role, input.department);
  return {
    authorityTier: fallback.authorityTier,
    primaryProfile: fallback.primaryJobFunctionProfile,
    jobFunctionProfiles: fallback.jobFunctionProfiles,
    compatibilityRole: input.role
  };
}

async function loadMembership(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<MembershipRecord>(
    `
      SELECT
        u.id,
        u.tenant_id,
        u.account_id,
        u.email,
        u.full_name,
        u.status::text AS status,
        u.department::text AS department,
        u.last_login_at::text AS last_login_at,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM app_user u
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND u.id = $2
      GROUP BY u.id, uaa.authority_tier, uaa.primary_job_function_profile
      LIMIT 1
    `,
    [tenantId, userId]
  );
  return rows[0] ?? null;
}

async function loadMembershipByEmail(client: PoolClient, tenantId: string, email: string) {
  const { rows } = await client.query<MembershipRecord>(
    `
      SELECT
        u.id,
        u.tenant_id,
        u.account_id,
        u.email,
        u.full_name,
        u.status::text AS status,
        u.department::text AS department,
        u.last_login_at::text AS last_login_at,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM app_user u
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND lower(u.email) = lower($2)
      GROUP BY u.id, uaa.authority_tier, uaa.primary_job_function_profile
      LIMIT 1
    `,
    [tenantId, email]
  );
  return rows[0] ?? null;
}

async function countActiveOwners(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT u.id)::text AS count
      FROM app_user u
      JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      WHERE u.tenant_id = $1
        AND u.status = 'active'
        AND uaa.authority_tier = 'super_admin'
    `,
    [tenantId]
  );
  return Number(rows[0]?.count ?? 0);
}

function assertManagedRole(role: AuthRole | null | undefined) {
  if (!role || !ALL_ROLE_CODES.includes(role)) {
    throw new ApiError(400, "Invalid role");
  }
}

function assertManagedAuthorityTier(authorityTier: AuthorityTier | null | undefined) {
  if (!authorityTier || !ALL_AUTHORITY_TIERS.includes(authorityTier)) {
    throw new ApiError(400, "Invalid authority tier");
  }
}

function assertManagedProfile(profile: JobFunctionProfile | null | undefined) {
  if (!profile || !ALL_JOB_FUNCTION_PROFILES.includes(profile)) {
    throw new ApiError(400, "Invalid job-function profile");
  }
}

function assertManagedDepartment(department: DepartmentCode | null | undefined) {
  if (!department || !ALL_DEPARTMENTS.includes(department)) {
    throw new ApiError(400, "Invalid department");
  }
}

async function assertMembershipManageable(
  client: PoolClient,
  auth: AuthUser,
  targetUserId: string,
  action: "user.invite" | "user.approve" | "user.role.update" | "user.department.update" | "user.suspend" | "user.reactivate" | "user.revoke",
  proposedRole?: AuthRole | null
) {
  const target = await loadMembership(client, auth.tenantId, targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }

  if (
    !canManageMembership(auth, {
      type: "membership",
      targetUserId: target.id,
      targetRoles: target.roles,
      targetStatus: target.status,
      proposedRole
    }, action)
  ) {
    throw new ApiError(403, "Forbidden");
  }

  if (target.authority_tier === "super_admin") {
    const activeOwners = await countActiveOwners(client, auth.tenantId);
    const ownerRemovingAction = action === "user.role.update" || action === "user.suspend" || action === "user.revoke";
    if (ownerRemovingAction && activeOwners <= 1 && proposedRole !== "owner_admin") {
      throw new ApiError(400, "Cannot remove the last active owner_admin");
    }
  }

  return target;
}

export async function listUsers(
  client: PoolClient,
  tenantId: string,
  filters: {
    status?: MembershipStatus;
    role?: AuthRole;
    authorityTier?: AuthorityTier;
    profile?: JobFunctionProfile;
    department?: DepartmentCode;
    search?: string;
  }
) {
  const values: unknown[] = [tenantId];
  const where: string[] = ["u.tenant_id = $1"];

  if (filters.status) {
    values.push(filters.status);
    where.push(`u.status = $${values.length}`);
  }
  if (filters.department) {
    values.push(filters.department);
    where.push(`u.department = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search.toLowerCase()}%`);
    where.push(`(lower(u.email) LIKE $${values.length} OR lower(u.full_name) LIKE $${values.length})`);
  }
  if (filters.role) {
    values.push(filters.role);
    where.push(`EXISTS (
      SELECT 1
      FROM user_role urf
      JOIN role rf ON rf.id = urf.role_id
      WHERE urf.tenant_id = u.tenant_id
        AND urf.user_id = u.id
        AND rf.code = $${values.length}
    )`);
  }
  if (filters.authorityTier) {
    values.push(filters.authorityTier);
    where.push(`uaa.authority_tier = $${values.length}::authority_tier`);
  }
  if (filters.profile) {
    values.push(filters.profile);
    where.push(`EXISTS (
      SELECT 1
      FROM user_job_function_profile ujpf
      WHERE ujpf.tenant_id = u.tenant_id
        AND ujpf.user_id = u.id
        AND ujpf.job_function_profile = $${values.length}::job_function_profile
    )`);
  }

  const { rows } = await client.query(
    `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.status,
        u.department,
        u.last_login_at,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        a.auth_provider,
        a.linked_at::text AS linked_at,
        a.last_login_at::text AS account_last_login_at,
        COALESCE(a.communication_enabled, false) AS communication_enabled,
        a.teams_chat_default_target,
        a.last_verified_at::text AS last_verified_at,
        latest_invite.id AS latest_invite_id,
        latest_invite.expires_at::text AS latest_invite_expires_at,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM app_user u
      LEFT JOIN user_account a ON a.id = u.account_id
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN LATERAL (
        SELECT ui.id, ui.expires_at
        FROM user_invite ui
        WHERE ui.app_user_id = u.id
          AND ui.tenant_id = u.tenant_id
          AND ui.revoked_at IS NULL
        ORDER BY ui.created_at DESC
        LIMIT 1
      ) latest_invite ON true
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE ${where.join(" AND ")}
      GROUP BY
        u.id,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        a.auth_provider,
        a.linked_at,
        a.last_login_at,
        a.communication_enabled,
        a.teams_chat_default_target,
        a.last_verified_at,
        latest_invite.id,
        latest_invite.expires_at,
        uaa.authority_tier,
        uaa.primary_job_function_profile
      ORDER BY u.created_at ASC
    `,
    values
  );
  return rows.map((row) => ({
    ...row,
    communication_identity_status: deriveCommunicationIdentityStatus({
      microsoftUserId: row.microsoft_user_id,
      microsoftTenantId: row.microsoft_tenant_id,
      communicationEnabled: row.communication_enabled,
      teamsChatDefaultTarget: row.teams_chat_default_target,
      linkedAt: row.linked_at,
      lastVerifiedAt: row.last_verified_at,
      authProvider: row.auth_provider
    }),
    internal_role_groups: deriveInternalRoleGroups({
      authorityTier: row.authority_tier ?? null,
      department: row.department,
      primaryJobFunctionProfile: row.primary_job_function_profile ?? null,
      jobFunctionProfiles: row.job_function_profiles ?? []
    })
  }));
}

export async function listAuditLogs(
  client: PoolClient,
  tenantId: string,
  filters: { actorUserId?: string; targetUserId?: string; action?: string; dateFrom?: string; dateTo?: string }
) {
  const values: unknown[] = [tenantId];
  const where: string[] = ["al.tenant_id = $1"];
  if (filters.actorUserId) {
    values.push(filters.actorUserId);
    where.push(`al.actor_user_id = $${values.length}`);
  }
  if (filters.targetUserId) {
    values.push(filters.targetUserId);
    where.push(`al.target_user_id = $${values.length}`);
  }
  if (filters.action) {
    values.push(filters.action);
    where.push(`al.action = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    where.push(`al.created_at >= $${values.length}`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    where.push(`al.created_at <= $${values.length}`);
  }

  const { rows } = await client.query(
    `
      SELECT
        al.*,
        actor.email AS actor_email,
        actor.full_name AS actor_name,
        target.email AS target_email,
        target.full_name AS target_name
      FROM audit_log al
      LEFT JOIN app_user actor ON actor.id = al.actor_user_id
      LEFT JOIN app_user target ON target.id = al.target_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY al.created_at DESC
      LIMIT 200
    `,
    values
  );
  return rows;
}

export async function inviteUser(
  client: PoolClient,
  auth: AuthUser,
  input: {
    email: string;
    fullName?: string | null;
    role?: AuthRole | null;
    authorityTier?: AuthorityTier | null;
    primaryProfile?: JobFunctionProfile | null;
    jobFunctionProfiles?: JobFunctionProfile[] | null;
    department: DepartmentCode;
  },
  metadata: AccessAuditContext
) {
  assertManagedDepartment(input.department);
  if (input.role) {
    assertManagedRole(input.role);
  }
  if (input.authorityTier) {
    assertManagedAuthorityTier(input.authorityTier);
  }
  if (input.primaryProfile) {
    assertManagedProfile(input.primaryProfile);
  }
  const authoritySelection = resolveAuthoritySelection({
    role: input.role ?? null,
    authorityTier: input.authorityTier ?? null,
    primaryProfile: input.primaryProfile ?? null,
    jobFunctionProfiles: input.jobFunctionProfiles ?? null,
    department: input.department
  });

  const existing = await loadMembershipByEmail(client, auth.tenantId, input.email);
  if (existing?.status === "active") {
    throw new ApiError(409, "User already exists");
  }

  let membershipId = existing?.id;
  if (!membershipId) {
    const insert = await client.query<{ id: string }>(
      `
        INSERT INTO app_user (
          tenant_id, email, full_name, department, status, invited_by_user_id, invited_at, is_active
        )
        VALUES ($1,$2,$3,$4,'invited',$5,now(),false)
        RETURNING id
      `,
      [auth.tenantId, input.email, input.fullName?.trim() || input.email, input.department, auth.id]
    );
    membershipId = insert.rows[0].id;
  } else {
    await client.query(
      `
        UPDATE app_user
        SET full_name = $2,
            department = $3,
            status = 'invited',
            invited_by_user_id = $4,
            invited_at = now(),
            suspended_at = NULL,
            revoked_at = NULL,
            is_active = false
        WHERE id = $1
      `,
      [membershipId, input.fullName?.trim() || input.email, input.department, auth.id]
    );
  }

  await syncUserAuthorityAssignment(client, {
    tenantId: auth.tenantId,
    userId: membershipId,
    authorityTier: authoritySelection.authorityTier,
    primaryJobFunctionProfile: authoritySelection.primaryProfile,
    jobFunctionProfiles: authoritySelection.jobFunctionProfiles,
    scopeDepartment: input.department,
    assignedByUserId: auth.id
  });
  await client.query("UPDATE user_invite SET revoked_at = now() WHERE app_user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [membershipId]);

  const rawToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = hashOpaqueToken(rawToken);
  const invite = (
    await client.query(
      `
        INSERT INTO user_invite (
          tenant_id, app_user_id, email, invited_role, invited_department, invited_authority_tier, invited_job_function_profile,
          invited_by_user_id, token_hash, expires_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10::text || ' hours')::interval)
        RETURNING *
      `,
      [
        auth.tenantId,
        membershipId,
        input.email,
        authoritySelection.compatibilityRole,
        input.department,
        authoritySelection.authorityTier,
        authoritySelection.primaryProfile,
        auth.id,
        tokenHash,
        String(config.INVITE_TTL_HOURS)
      ]
    )
  ).rows[0];

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: membershipId,
    action: "user.invited",
    entityType: "user_invite",
    entityId: invite.id,
    metadata: {
      email: input.email,
      authority_tier: authoritySelection.authorityTier,
      primary_profile: authoritySelection.primaryProfile,
      profiles: authoritySelection.jobFunctionProfiles,
      compatibility_role: authoritySelection.compatibilityRole,
      department: input.department
    },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });

  return {
    invite,
    invite_token: config.NODE_ENV !== "production" ? rawToken : undefined
  };
}

export async function resendInvite(client: PoolClient, auth: AuthUser, inviteId: string, metadata: AccessAuditContext) {
  const inviteResult = await client.query<{
    id: string;
    app_user_id: string;
    email: string;
    invited_role: AuthRole | null;
    invited_department: DepartmentCode | null;
    invited_authority_tier: AuthorityTier | null;
    invited_job_function_profile: JobFunctionProfile | null;
  }>(
    "SELECT id, app_user_id, email, invited_role, invited_department, invited_authority_tier::text AS invited_authority_tier, invited_job_function_profile::text AS invited_job_function_profile FROM user_invite WHERE tenant_id = $1 AND id = $2 LIMIT 1",
    [auth.tenantId, inviteId]
  );
  const invite = inviteResult.rows[0];
  if (!invite) {
    throw new ApiError(404, "Invite not found");
  }
  const membership = await assertMembershipManageable(client, auth, invite.app_user_id, "user.invite", invite.invited_role ?? undefined);
  void membership;
  await client.query("UPDATE user_invite SET revoked_at = now() WHERE id = $1", [inviteId]);
  return inviteUser(
    client,
    auth,
    {
      email: invite.email,
      fullName: membership.full_name,
      role: invite.invited_role ?? null,
      authorityTier: invite.invited_authority_tier ?? null,
      primaryProfile: invite.invited_job_function_profile ?? null,
      department: invite.invited_department ?? "unassigned"
    },
    metadata
  );
}

export async function acceptInvite(
  client: PoolClient,
  input: { token: string; fullName: string; password: string },
  metadata: AccessAuditContext
) {
  const inviteResult = await client.query<{
    id: string;
    tenant_id: string;
    app_user_id: string;
    email: string;
    invited_role: AuthRole | null;
    invited_department: DepartmentCode | null;
    invited_authority_tier: AuthorityTier | null;
    invited_job_function_profile: JobFunctionProfile | null;
  }>(
    `
      SELECT id, tenant_id, app_user_id, email, invited_role, invited_department,
             invited_authority_tier::text AS invited_authority_tier,
             invited_job_function_profile::text AS invited_job_function_profile
      FROM user_invite
      WHERE token_hash = $1
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
    [hashOpaqueToken(input.token)]
  );
  const invite = inviteResult.rows[0];
  if (!invite) {
    throw new ApiError(400, "Invite is invalid or expired");
  }

  const accountResult = await client.query<{ id: string }>("SELECT id FROM user_account WHERE lower(email) = lower($1) LIMIT 1", [invite.email]);
  let accountId = accountResult.rows[0]?.id ?? null;
  const passwordHash = await hashPassword(input.password);

  if (!accountId) {
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO user_account (email, full_name, password_hash, is_email_verified)
        VALUES ($1,$2,$3,$4)
        RETURNING id
      `,
      [invite.email, input.fullName, passwordHash, config.NODE_ENV === "development"]
    );
    accountId = created.rows[0].id;
  } else {
    await client.query(
      "UPDATE user_account SET full_name = $2, password_hash = $3, updated_at = now() WHERE id = $1",
      [accountId, input.fullName, passwordHash]
    );
  }

  await client.query(
    `
      UPDATE app_user
      SET account_id = $2,
          full_name = $3,
          department = COALESCE($4, department),
          status = 'pending_approval',
          is_active = false
      WHERE id = $1
    `,
    [invite.app_user_id, accountId, input.fullName, invite.invited_department ?? null]
  );
  const authoritySelection = resolveAuthoritySelection({
    role: invite.invited_role ?? null,
    authorityTier: invite.invited_authority_tier ?? null,
    primaryProfile: invite.invited_job_function_profile ?? null,
    department: invite.invited_department ?? "unassigned"
  });
  await syncUserAuthorityAssignment(client, {
    tenantId: invite.tenant_id,
    userId: invite.app_user_id,
    authorityTier: authoritySelection.authorityTier,
    primaryJobFunctionProfile: authoritySelection.primaryProfile,
    jobFunctionProfiles: authoritySelection.jobFunctionProfiles,
    scopeDepartment: invite.invited_department ?? "unassigned"
  });
  await client.query("UPDATE user_invite SET accepted_at = now() WHERE id = $1", [invite.id]);

  await createAuditLog(client, {
    tenantId: invite.tenant_id,
    targetUserId: invite.app_user_id,
    action: "user.invite_accepted",
    entityType: "user_invite",
    entityId: invite.id,
    metadata: { email: invite.email },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });
}

export async function approveMembership(
  client: PoolClient,
  auth: AuthUser,
  targetUserId: string,
  input: {
    role?: AuthRole | null;
    authorityTier?: AuthorityTier | null;
    primaryProfile?: JobFunctionProfile | null;
    jobFunctionProfiles?: JobFunctionProfile[] | null;
    department: DepartmentCode;
  },
  metadata: AccessAuditContext
) {
  assertManagedDepartment(input.department);
  if (input.role) {
    assertManagedRole(input.role);
  }
  if (input.authorityTier) {
    assertManagedAuthorityTier(input.authorityTier);
  }
  if (input.primaryProfile) {
    assertManagedProfile(input.primaryProfile);
  }
  const authoritySelection = resolveAuthoritySelection({
    role: input.role ?? null,
    authorityTier: input.authorityTier ?? null,
    primaryProfile: input.primaryProfile ?? null,
    jobFunctionProfiles: input.jobFunctionProfiles ?? null,
    department: input.department
  });
  const target = await assertMembershipManageable(client, auth, targetUserId, "user.approve", authoritySelection.compatibilityRole);

  await syncUserAuthorityAssignment(client, {
    tenantId: auth.tenantId,
    userId: targetUserId,
    authorityTier: authoritySelection.authorityTier,
    primaryJobFunctionProfile: authoritySelection.primaryProfile,
    jobFunctionProfiles: authoritySelection.jobFunctionProfiles,
    scopeDepartment: input.department,
    assignedByUserId: auth.id
  });
  await client.query(
    `
      UPDATE app_user
      SET status = 'active',
          department = $2,
          approved_by_user_id = $3,
          approved_at = now(),
          suspended_at = NULL,
          revoked_at = NULL,
          is_active = true
      WHERE id = $1
    `,
    [targetUserId, input.department, auth.id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId,
    action: "user.approved",
    entityType: "membership",
    entityId: targetUserId,
    metadata: {
      authority_tier: authoritySelection.authorityTier,
      primary_profile: authoritySelection.primaryProfile,
      profiles: authoritySelection.jobFunctionProfiles,
      compatibility_role: authoritySelection.compatibilityRole,
      department: input.department,
      previous_status: target.status
    },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });
}

export async function updateMembershipRole(
  client: PoolClient,
  auth: AuthUser,
  targetUserId: string,
  input: {
    role?: AuthRole | null;
    authorityTier?: AuthorityTier | null;
    primaryProfile?: JobFunctionProfile | null;
    jobFunctionProfiles?: JobFunctionProfile[] | null;
    reason?: string | null;
  },
  metadata: AccessAuditContext
) {
  if (input.role) {
    assertManagedRole(input.role);
  }
  if (input.authorityTier) {
    assertManagedAuthorityTier(input.authorityTier);
  }
  if (input.primaryProfile) {
    assertManagedProfile(input.primaryProfile);
  }
  const target = await loadMembership(client, auth.tenantId, targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }
  const authoritySelection = resolveAuthoritySelection({
    role: input.role ?? target.roles[0] ?? null,
    authorityTier: input.authorityTier ?? target.authority_tier ?? null,
    primaryProfile: input.primaryProfile ?? target.primary_job_function_profile ?? null,
    jobFunctionProfiles: input.jobFunctionProfiles ?? target.job_function_profiles ?? null,
    department: target.department
  });
  await assertMembershipManageable(client, auth, targetUserId, "user.role.update", authoritySelection.compatibilityRole);

  if (requiresDualApprovalForAuthorityTier(authoritySelection.authorityTier)) {
    const approval = await createMembershipRoleApprovalRequest(
      client,
      auth,
      {
        targetUserId,
        authorityTier: authoritySelection.authorityTier,
        primaryProfile: authoritySelection.primaryProfile,
        jobFunctionProfiles: authoritySelection.jobFunctionProfiles,
        department: target.department,
        compatibilityRole: authoritySelection.compatibilityRole,
        reason:
          input.reason?.trim() ||
          `Privileged access change requested: ${target.full_name} -> ${authoritySelection.authorityTier}`
      },
      metadata
    );
    return {
      outcome: "pending_approval" as const,
      approvalRequestId: approval.approvalRequestId,
      requiredApproverTier: approval.requiredApproverTier
    };
  }

  await syncUserAuthorityAssignment(client, {
    tenantId: auth.tenantId,
    userId: targetUserId,
    authorityTier: authoritySelection.authorityTier,
    primaryJobFunctionProfile: authoritySelection.primaryProfile,
    jobFunctionProfiles: authoritySelection.jobFunctionProfiles,
    scopeDepartment: target.department,
    assignedByUserId: auth.id
  });
  await bumpAuthVersion(client, targetUserId);
  await revokeAllSessionsForUser(client, targetUserId, "role_changed");
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId,
    action: "user.role_changed",
    entityType: "membership",
    entityId: targetUserId,
    metadata: {
      previous_roles: target.roles,
      previous_authority_tier: target.authority_tier,
      previous_profiles: target.job_function_profiles,
      next_role: authoritySelection.compatibilityRole,
      next_authority_tier: authoritySelection.authorityTier,
      next_profiles: authoritySelection.jobFunctionProfiles
    },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });

  return {
    outcome: "updated" as const
  };
}

export async function updateMembershipDepartment(
  client: PoolClient,
  auth: AuthUser,
  targetUserId: string,
  nextDepartment: DepartmentCode,
  metadata: AccessAuditContext
) {
  assertManagedDepartment(nextDepartment);
  const target = await assertMembershipManageable(client, auth, targetUserId, "user.department.update");
  await client.query("UPDATE app_user SET department = $2 WHERE id = $1", [targetUserId, nextDepartment]);
  await syncUserAuthorityAssignment(client, {
    tenantId: auth.tenantId,
    userId: targetUserId,
    authorityTier: target.authority_tier ?? getDefaultAuthorityAssignmentForLegacyRole(target.roles[0] ?? "office_employee", nextDepartment).authorityTier,
    primaryJobFunctionProfile:
      target.primary_job_function_profile ?? getDefaultAuthorityAssignmentForLegacyRole(target.roles[0] ?? "office_employee", nextDepartment).primaryJobFunctionProfile,
    jobFunctionProfiles:
      target.job_function_profiles?.length
        ? target.job_function_profiles
        : getDefaultAuthorityAssignmentForLegacyRole(target.roles[0] ?? "office_employee", nextDepartment).jobFunctionProfiles,
    scopeDepartment: nextDepartment,
    assignedByUserId: auth.id
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId,
    action: "user.department_changed",
    entityType: "membership",
    entityId: targetUserId,
    metadata: { previous_department: target.department, next_department: nextDepartment },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });
}

export async function suspendMembership(client: PoolClient, auth: AuthUser, targetUserId: string, metadata: AccessAuditContext) {
  const target = await assertMembershipManageable(client, auth, targetUserId, "user.suspend");
  await client.query(
    "UPDATE app_user SET status = 'suspended', suspended_at = now(), is_active = false WHERE id = $1",
    [targetUserId]
  );
  await bumpAuthVersion(client, targetUserId);
  await revokeAllSessionsForUser(client, targetUserId, "membership_suspended");
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId,
    action: "user.suspended",
    entityType: "membership",
    entityId: targetUserId,
    metadata: { previous_status: target.status },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });
}

export async function reactivateMembership(client: PoolClient, auth: AuthUser, targetUserId: string, metadata: AccessAuditContext) {
  const target = await assertMembershipManageable(client, auth, targetUserId, "user.reactivate");
  await client.query(
    "UPDATE app_user SET status = 'active', suspended_at = NULL, revoked_at = NULL, is_active = true WHERE id = $1",
    [targetUserId]
  );
  await bumpAuthVersion(client, targetUserId);
  await revokeAllSessionsForUser(client, targetUserId, "membership_reactivated");
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId,
    action: "user.reactivated",
    entityType: "membership",
    entityId: targetUserId,
    metadata: { previous_status: target.status },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });
}

export async function revokeMembership(client: PoolClient, auth: AuthUser, targetUserId: string, metadata: AccessAuditContext) {
  const target = await assertMembershipManageable(client, auth, targetUserId, "user.revoke");
  await client.query(
    "UPDATE app_user SET status = 'revoked', revoked_at = now(), suspended_at = NULL, is_active = false WHERE id = $1",
    [targetUserId]
  );
  await bumpAuthVersion(client, targetUserId);
  await revokeAllSessionsForUser(client, targetUserId, "membership_revoked");
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId,
    action: "user.revoked",
    entityType: "membership",
    entityId: targetUserId,
    metadata: { previous_status: target.status },
    ipAddress: metadata.ipAddress ?? null,
    userAgent: metadata.userAgent ?? null
  });
}
