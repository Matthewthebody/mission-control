import { createHash, createSecretKey, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import { connectGuardedClient, pool } from "../db/pool.js";
import { ApiError } from "../errors/apiError.js";
import {
  buildEffectivePermissionGrants,
  buildEffectiveScopes,
  buildPermissionCodesForAuthority,
  getDefaultAuthorityAssignmentForLegacyRole,
  getLegacyRolesForAuthority
} from "../authz/authority.js";
import type {
  AuthPermissionGrant,
  AuthIdentityProvider,
  AuthRole,
  AuthUser,
  AuthorityTier,
  DepartmentCode,
  JobFunctionProfile,
  MembershipStatus,
  PermissionScope,
  SessionAssuranceLevel
} from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { deriveAppAuthorizationProfile } from "./appAuthorization.js";
import { buildCommunicationIdentity } from "./communicationIdentity.js";
import { deriveInternalRoleGroups } from "./internalRoleMapping.js";
import { parseStoredMicrosoftEntraAuthorization } from "./microsoftEntraContracts.js";
import { hydrateSharedPolicyAccess } from "./policy/index.js";
import { getRequestContext } from "./requestContext.js";

const scrypt = promisify(scryptCallback);
const currentSecret = createSecretKey(Buffer.from(config.JWT_SECRET));
const previousSecret = config.JWT_SECRET_PREVIOUS ? createSecretKey(Buffer.from(config.JWT_SECRET_PREVIOUS)) : null;

function shouldTouchSessionLastSeen() {
  const method = getRequestContext()?.method?.toUpperCase() ?? "";
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

type MembershipAccessRow = {
  id: string;
  tenant_id: string;
  account_id: string | null;
  session_id: string | null;
  identity_provider: AuthIdentityProvider | null;
  session_assurance: SessionAssuranceLevel | null;
  authenticated_at: string | null;
  csrf_token_hash: string | null;
  last_reauthenticated_at: string | null;
  active_auth_context_ids: string[] | null;
  identity_claims: Record<string, unknown> | null;
  identity_authorization: Record<string, unknown> | null;
  elevated_until: string | null;
  privileged_mode_until: string | null;
  break_glass_started_at: string | null;
  break_glass_until: string | null;
  break_glass_reason: string | null;
  break_glass_scope_type: string | null;
  break_glass_scope_id: string | null;
  email: string;
  full_name: string;
  status: MembershipStatus;
  department: DepartmentCode;
  is_email_verified: boolean;
  microsoft_user_id: string | null;
  microsoft_tenant_id: string | null;
  communication_enabled: boolean;
  communication_posting_disabled_at: string | null;
  communication_posting_disabled_reason: string | null;
  teams_chat_default_target: string | null;
  linked_at: string | null;
  last_verified_at: string | null;
  account_auth_provider: AuthIdentityProvider | null;
  auth_version: number;
  roles: AuthRole[];
  authority_tier: AuthorityTier | null;
  primary_job_function_profile: JobFunctionProfile | null;
  job_function_profiles: JobFunctionProfile[];
};

export type RequestAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
  csrfTokenHash?: string | null;
};

function mapMicrosoftEntraAuthorization(value: unknown) {
  const parsed = parseStoredMicrosoftEntraAuthorization(value);
  if (!parsed) {
    return null;
  }
  return {
    provider: "microsoft_entra" as const,
    sourceContractVersion: parsed.source_contract_version,
    raw: {
      tenantId: parsed.raw.tenant_id,
      userId: parsed.raw.user_id,
      email: parsed.raw.email,
      scopes: parsed.raw.scopes,
      appRoleValues: parsed.raw.app_role_values,
      groupIds: parsed.raw.group_ids,
      groupClaimsOverage: parsed.raw.group_claims_overage,
      authContextIds: parsed.raw.auth_context_ids,
      amr: parsed.raw.amr,
      acr: parsed.raw.acr,
      sessionAssurance: parsed.raw.session_assurance,
      rawClaims: parsed.raw.raw_claims
    },
    resolved: {
      authorityTier: parsed.resolved.authority_tier,
      baseRole: parsed.resolved.base_role,
      capabilityOverlays: parsed.resolved.capability_overlays,
      internalRoleGroups: parsed.resolved.internal_role_groups,
      policyRoles: parsed.resolved.policy_roles,
      permissionKeys: parsed.resolved.permission_keys,
      mappedAppRoles: parsed.resolved.mapped_app_roles,
      mappedGroupIds: parsed.resolved.mapped_group_ids,
      financeSensitiveAccess: parsed.resolved.finance_sensitive_access,
      communicationsModeration: parsed.resolved.communications_moderation,
      userAccessAdministration: parsed.resolved.user_access_administration,
      securityAdministration: parsed.resolved.security_administration
    },
    issues: parsed.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message
    })),
    signInAllowed: parsed.sign_in_allowed
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function mapAuthUser(row: MembershipAccessRow): AuthUser {
  const microsoftEntraAuthorization = mapMicrosoftEntraAuthorization(row.identity_authorization);
  const fallback = getDefaultAuthorityAssignmentForLegacyRole(row.roles[0] ?? "office_employee", row.department);
  const authorityTier = microsoftEntraAuthorization?.resolved.authorityTier ?? row.authority_tier ?? fallback.authorityTier;
  const jobFunctionProfiles =
    row.job_function_profiles && row.job_function_profiles.length
      ? row.job_function_profiles
      : fallback.jobFunctionProfiles;
  const primaryJobFunctionProfile = row.primary_job_function_profile ?? fallback.primaryJobFunctionProfile;
  const permissionGrants: AuthPermissionGrant[] = buildEffectivePermissionGrants(authorityTier, jobFunctionProfiles);
  const effectiveScopes: PermissionScope[] = buildEffectiveScopes(permissionGrants);
  const roles = row.roles?.length ? row.roles : getLegacyRolesForAuthority(authorityTier, jobFunctionProfiles);
  const sessionPermissionKeys = microsoftEntraAuthorization?.resolved.permissionKeys ?? [];
  const combinedPermissions = uniqueStrings([...buildPermissionCodesForAuthority(authorityTier, jobFunctionProfiles), ...sessionPermissionKeys]);
  const internalRoleGroups = uniqueStrings([
    ...deriveInternalRoleGroups({
      authorityTier,
      department: row.department,
      primaryJobFunctionProfile,
      jobFunctionProfiles
    }),
    ...(microsoftEntraAuthorization?.resolved.internalRoleGroups ?? [])
  ]) as AuthUser["internalRoleGroups"];
  const authorizationProfile = deriveAppAuthorizationProfile({
    authorityTier,
    department: row.department,
    roles,
    internalRoleGroups: internalRoleGroups ?? [],
    jobFunctionProfiles,
    primaryJobFunctionProfile,
    permissionKeys: combinedPermissions,
    explicitBaseRole: microsoftEntraAuthorization?.resolved.baseRole ?? null,
    explicitCapabilityOverlays: microsoftEntraAuthorization?.resolved.capabilityOverlays ?? []
  });

  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    sessionId: row.session_id ?? "",
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    department: row.department,
    isEmailVerified: row.is_email_verified,
    authVersion: Number(row.auth_version),
    authorityTier,
    baseRole: authorizationProfile.baseRole,
    capabilityOverlays: authorizationProfile.capabilityOverlays,
    jobFunctionProfiles,
    primaryJobFunctionProfile,
    permissionGrants,
    policyGrants: [],
    policyRoles: [],
    internalRoleGroups,
    microsoftEntraAuthorization,
    communicationIdentity: buildCommunicationIdentity({
      microsoftUserId: row.microsoft_user_id,
      microsoftTenantId: row.microsoft_tenant_id,
      communicationEnabled: row.communication_enabled,
      communicationPostingDisabledAt: row.communication_posting_disabled_at,
      communicationPostingDisabledReason: row.communication_posting_disabled_reason,
      teamsChatDefaultTarget: row.teams_chat_default_target,
      linkedAt: row.linked_at,
      lastVerifiedAt: row.last_verified_at,
      authProvider: row.account_auth_provider ?? row.identity_provider ?? null
    }),
    effectiveScopes,
    roles,
    permissions: combinedPermissions,
    authorizationFlags: authorizationProfile.authorizationFlags,
    sessionTrust: {
      identityProvider: row.identity_provider ?? "local_password",
      sessionAssurance: row.session_assurance ?? "standard",
      requestTransport: "bearer",
      authenticatedAt: row.authenticated_at ?? null,
      lastReauthenticatedAt: row.last_reauthenticated_at ?? null,
      activeAuthContextIds: row.active_auth_context_ids ?? [],
      elevatedUntil: row.elevated_until ?? null,
      privilegedModeUntil: row.privileged_mode_until ?? null,
      breakGlassStartedAt: row.break_glass_started_at ?? null,
      breakGlassUntil: row.break_glass_until ?? null,
      breakGlassReason: row.break_glass_reason ?? null,
      breakGlassScopeType: row.break_glass_scope_type ?? null,
      breakGlassScopeId: row.break_glass_scope_id ?? null,
      elevatedSessionActive: Boolean(row.elevated_until && new Date(row.elevated_until).getTime() > Date.now()),
      privilegedModeActive: Boolean(row.privileged_mode_until && new Date(row.privileged_mode_until).getTime() > Date.now()),
      breakGlassModeActive: Boolean(row.break_glass_until && new Date(row.break_glass_until).getTime() > Date.now())
    }
  };
}

async function applySharedPolicyAccess(client: PoolClient, user: AuthUser) {
  const hydrated = await hydrateSharedPolicyAccess(client, user);
  const sessionAuthorization = user.microsoftEntraAuthorization;
  const sessionPolicyRoles = sessionAuthorization?.resolved.policyRoles ?? [];
  const sessionPermissionKeys = sessionAuthorization?.resolved.permissionKeys ?? [];
  // Shared policy grants extend the canonical authority-derived permission set; they do not replace it.
  const permissions = uniqueStrings([...user.permissions, ...hydrated.permissionKeys, ...sessionPermissionKeys]);
  const authorizationProfile = deriveAppAuthorizationProfile({
    authorityTier: user.authorityTier,
    department: user.department,
    roles: user.roles,
    internalRoleGroups: user.internalRoleGroups ?? [],
    jobFunctionProfiles: user.jobFunctionProfiles,
    primaryJobFunctionProfile: user.primaryJobFunctionProfile,
    permissionKeys: permissions,
    explicitBaseRole: sessionAuthorization?.resolved.baseRole ?? user.baseRole,
    explicitCapabilityOverlays: sessionAuthorization?.resolved.capabilityOverlays ?? user.capabilityOverlays
  });
  return {
    ...user,
    baseRole: authorizationProfile.baseRole,
    capabilityOverlays: authorizationProfile.capabilityOverlays,
    policyRoles: uniqueStrings([...hydrated.policyRoles, ...sessionPolicyRoles]),
    policyGrants: hydrated.policyGrants,
    permissions,
    authorizationFlags: authorizationProfile.authorizationFlags
  };
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string | null | undefined) {
  if (!hash) {
    return false;
  }
  const [algorithm, salt, digest] = hash.split("$");
  if (algorithm !== "scrypt" || !salt || !digest) {
    return false;
  }
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const digestBuffer = Buffer.from(digest, "hex");
  if (digestBuffer.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(digestBuffer, derived);
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createRawToken() {
  return randomBytes(32).toString("hex");
}

function createCsrfToken() {
  return randomBytes(24).toString("base64url");
}

async function loadMembershipAccessBySession(client: PoolClient, sessionId: string) {
  const { rows } = await client.query<MembershipAccessRow>(
    `
      SELECT
        u.id,
        u.tenant_id,
        u.account_id,
        s.id AS session_id,
        s.identity_provider,
        s.session_assurance,
        s.authenticated_at::text AS authenticated_at,
        s.csrf_token_hash,
        s.last_reauthenticated_at::text AS last_reauthenticated_at,
        COALESCE(s.active_auth_context_ids, '{}') AS active_auth_context_ids,
        s.identity_claims,
        s.identity_authorization,
        s.elevated_until::text AS elevated_until,
        s.privileged_mode_until::text AS privileged_mode_until,
        s.break_glass_started_at::text AS break_glass_started_at,
        s.break_glass_until::text AS break_glass_until,
        s.break_glass_reason,
        s.break_glass_scope_type,
        s.break_glass_scope_id,
        u.email,
        u.full_name,
        u.status::text AS status,
        u.department::text AS department,
        COALESCE(a.is_email_verified, false) AS is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        COALESCE(a.communication_enabled, false) AS communication_enabled,
        a.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at::text AS linked_at,
        a.last_verified_at::text AS last_verified_at,
        a.auth_provider AS account_auth_provider,
        u.auth_version,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM auth_session s
      JOIN app_user u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
      LEFT JOIN user_account a ON a.id = u.account_id
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      GROUP BY
        u.id,
        s.id,
        a.is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        a.communication_enabled,
        a.communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at,
        a.last_verified_at,
        a.auth_provider,
        uaa.authority_tier,
        uaa.primary_job_function_profile
    `,
    [sessionId]
  );
  return rows[0] ?? null;
}

export async function loadAuthenticatedUserBySession(client: PoolClient, sessionId: string) {
  const row = await loadMembershipAccessBySession(client, sessionId);
  if (!row || row.status !== "active") {
    return null;
  }
  return applySharedPolicyAccess(client, mapAuthUser(row));
}

async function loadMembershipByEmail(client: PoolClient, email: string) {
  const { rows } = await client.query<
    MembershipAccessRow & {
      password_hash: string | null;
      account_created_at: string | null;
    }
  >(
    `
      SELECT
        u.id,
        u.tenant_id,
        u.account_id,
        NULL::uuid AS session_id,
        NULL::text AS identity_provider,
        NULL::text AS session_assurance,
        NULL::text AS authenticated_at,
        NULL::text AS csrf_token_hash,
        NULL::text AS last_reauthenticated_at,
        '{}'::text[] AS active_auth_context_ids,
        '{}'::jsonb AS identity_claims,
        '{}'::jsonb AS identity_authorization,
        NULL::text AS elevated_until,
        NULL::text AS privileged_mode_until,
        NULL::text AS break_glass_started_at,
        NULL::text AS break_glass_until,
        NULL::text AS break_glass_reason,
        NULL::text AS break_glass_scope_type,
        NULL::text AS break_glass_scope_id,
        u.email,
        u.full_name,
        u.status::text AS status,
        u.department::text AS department,
        COALESCE(a.is_email_verified, false) AS is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        COALESCE(a.communication_enabled, false) AS communication_enabled,
        a.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at::text AS linked_at,
        a.last_verified_at::text AS last_verified_at,
        a.auth_provider AS account_auth_provider,
        u.auth_version,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
        a.password_hash,
        a.created_at::text AS account_created_at
      FROM app_user u
      LEFT JOIN user_account a ON a.id = u.account_id
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE lower(u.email) = lower($1)
      GROUP BY
        u.id,
        a.password_hash,
        a.created_at,
        a.is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        a.communication_enabled,
        a.communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at,
        a.last_verified_at,
        a.auth_provider,
        uaa.authority_tier,
        uaa.primary_job_function_profile
      ORDER BY CASE u.status
        WHEN 'active' THEN 1
        WHEN 'pending_approval' THEN 2
        WHEN 'invited' THEN 3
        WHEN 'suspended' THEN 4
        WHEN 'revoked' THEN 5
        ELSE 99
      END, u.created_at ASC
      LIMIT 1
    `,
    [email]
  );
  return rows[0] ?? null;
}

export async function loadAuthenticatedUserByUserId(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<MembershipAccessRow>(
    `
      SELECT
        u.id,
        u.tenant_id,
        u.account_id,
        NULL::uuid AS session_id,
        NULL::text AS identity_provider,
        NULL::text AS session_assurance,
        NULL::text AS authenticated_at,
        NULL::text AS csrf_token_hash,
        NULL::text AS last_reauthenticated_at,
        '{}'::text[] AS active_auth_context_ids,
        '{}'::jsonb AS identity_claims,
        '{}'::jsonb AS identity_authorization,
        NULL::text AS elevated_until,
        NULL::text AS privileged_mode_until,
        NULL::text AS break_glass_started_at,
        NULL::text AS break_glass_until,
        NULL::text AS break_glass_reason,
        NULL::text AS break_glass_scope_type,
        NULL::text AS break_glass_scope_id,
        u.email,
        u.full_name,
        u.status::text AS status,
        u.department::text AS department,
        COALESCE(a.is_email_verified, false) AS is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        COALESCE(a.communication_enabled, false) AS communication_enabled,
        a.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at::text AS linked_at,
        a.last_verified_at::text AS last_verified_at,
        a.auth_provider AS account_auth_provider,
        u.auth_version,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM app_user u
      LEFT JOIN user_account a ON a.id = u.account_id
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE u.tenant_id = $1
        AND u.id = $2
      GROUP BY
        u.id,
        a.is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        a.communication_enabled,
        a.communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at,
        a.last_verified_at,
        a.auth_provider,
        uaa.authority_tier,
        uaa.primary_job_function_profile
      LIMIT 1
    `,
    [tenantId, userId]
  );
  const row = rows[0] ?? null;
  if (!row || row.status !== "active") {
    return null;
  }
  return applySharedPolicyAccess(client, mapAuthUser(row));
}

export async function loadAuthenticatedUserByMicrosoftIdentity(
  client: PoolClient,
  microsoftTenantId: string,
  microsoftUserId: string
) {
  const { rows } = await client.query<MembershipAccessRow>(
    `
      SELECT
        u.id,
        u.tenant_id,
        u.account_id,
        NULL::uuid AS session_id,
        NULL::text AS identity_provider,
        NULL::text AS session_assurance,
        NULL::text AS authenticated_at,
        NULL::text AS csrf_token_hash,
        NULL::text AS last_reauthenticated_at,
        '{}'::text[] AS active_auth_context_ids,
        '{}'::jsonb AS identity_claims,
        '{}'::jsonb AS identity_authorization,
        NULL::text AS elevated_until,
        NULL::text AS privileged_mode_until,
        NULL::text AS break_glass_started_at,
        NULL::text AS break_glass_until,
        NULL::text AS break_glass_reason,
        NULL::text AS break_glass_scope_type,
        NULL::text AS break_glass_scope_id,
        u.email,
        u.full_name,
        u.status::text AS status,
        u.department::text AS department,
        COALESCE(a.is_email_verified, false) AS is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        COALESCE(a.communication_enabled, false) AS communication_enabled,
        a.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at::text AS linked_at,
        a.last_verified_at::text AS last_verified_at,
        a.auth_provider AS account_auth_provider,
        u.auth_version,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM app_user u
      JOIN user_account a
        ON a.id = u.account_id
      LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
      LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
      LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
      LEFT JOIN role r ON r.id = ur.role_id
      WHERE a.microsoft_tenant_id = $1
        AND a.microsoft_user_id = $2
      GROUP BY
        u.id,
        a.is_email_verified,
        a.microsoft_user_id,
        a.microsoft_tenant_id,
        a.communication_enabled,
        a.communication_posting_disabled_at,
        a.communication_posting_disabled_reason,
        a.teams_chat_default_target,
        a.linked_at,
        a.last_verified_at,
        a.auth_provider,
        uaa.authority_tier,
        uaa.primary_job_function_profile
      ORDER BY CASE u.status
        WHEN 'active' THEN 1
        WHEN 'pending_approval' THEN 2
        WHEN 'invited' THEN 3
        WHEN 'suspended' THEN 4
        WHEN 'revoked' THEN 5
        ELSE 99
      END, u.created_at ASC
      LIMIT 1
    `,
    [microsoftTenantId, microsoftUserId]
  );
  const row = rows[0] ?? null;
  if (!row || row.status !== "active") {
    return null;
  }
  return applySharedPolicyAccess(client, mapAuthUser(row));
}

async function signAuthToken(user: Pick<AuthUser, "id" | "tenantId" | "sessionId" | "authVersion">) {
  return new SignJWT({
    tenant_id: user.tenantId,
    sid: user.sessionId,
    ver: user.authVersion
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${config.AUTH_SESSION_HOURS}h`)
    .sign(currentSecret);
}

async function verifySignedToken(token: string) {
  const secrets = previousSecret ? [currentSecret, previousSecret] : [currentSecret];
  let lastError: unknown;
  for (const secret of secrets) {
    try {
      const { payload } = await jwtVerify(token, secret);
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function createSessionRow(
  client: PoolClient,
  userId: string,
  tenantId: string,
  provider: AuthIdentityProvider,
  metadata: RequestAuditContext & {
    sessionAssurance?: SessionAssuranceLevel;
    lastReauthenticatedAt?: string | null;
    activeAuthContextIds?: string[];
    identityClaims?: Record<string, unknown>;
    identityAuthorization?: Record<string, unknown>;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO auth_session (
        tenant_id,
        user_id,
        auth_provider,
        identity_provider,
        session_assurance,
        last_reauthenticated_at,
        active_auth_context_ids,
        identity_claims,
        identity_authorization,
        csrf_token_hash,
        ip_address,
        user_agent,
        expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8::jsonb,$9::jsonb,$10,$11,$12, now() + ($13::text || ' hours')::interval)
      RETURNING id
    `,
    [
      tenantId,
      userId,
      provider === "local_password" ? "password" : provider,
      provider,
        // Generic fallback only when issueAuthSession() is called without provider trust metadata.
        // This covers local development and other non-Entra flows that do not supply assurance claims.
        // Normal Microsoft Entra sign-in and step-up flows pass sessionAssurance explicitly and should not hit this path.
        metadata.sessionAssurance ?? "standard",
      metadata.lastReauthenticatedAt ?? null,
      metadata.activeAuthContextIds ?? [],
      JSON.stringify(metadata.identityClaims ?? {}),
      JSON.stringify(metadata.identityAuthorization ?? {}),
      metadata.csrfTokenHash ?? null,
      metadata.ipAddress ?? null,
      metadata.userAgent ?? null,
      String(config.AUTH_SESSION_HOURS)
    ]
  );
  return rows[0].id;
}

export async function issueAuthSession(
  client: PoolClient,
  input: {
    userId: string;
    tenantId: string;
    authVersion: number;
    provider: AuthIdentityProvider;
    metadata: RequestAuditContext;
    sessionAssurance?: SessionAssuranceLevel;
    lastReauthenticatedAt?: string | null;
    activeAuthContextIds?: string[];
    identityClaims?: Record<string, unknown>;
    identityAuthorization?: Record<string, unknown>;
  }
) {
  const csrfToken = createCsrfToken();
  const sessionId = await createSessionRow(client, input.userId, input.tenantId, input.provider, {
    ...input.metadata,
    csrfTokenHash: hashOpaqueToken(csrfToken),
    sessionAssurance: input.sessionAssurance,
    lastReauthenticatedAt: input.lastReauthenticatedAt,
    activeAuthContextIds: input.activeAuthContextIds,
    identityClaims: input.identityClaims,
    identityAuthorization: input.identityAuthorization
  });
  const token = await signAuthToken({
    id: input.userId,
    tenantId: input.tenantId,
    sessionId,
    authVersion: input.authVersion
  });
  return { sessionId, token, csrfToken };
}

export async function updateSessionIdentityTrust(
  client: PoolClient,
  input: {
    sessionId: string;
    sessionAssurance: SessionAssuranceLevel;
    lastReauthenticatedAt?: string | null;
    activeAuthContextIds?: string[];
    identityClaims?: Record<string, unknown>;
    identityAuthorization?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE auth_session
      SET
        session_assurance = $2,
        last_reauthenticated_at = COALESCE($3::timestamptz, last_reauthenticated_at),
        active_auth_context_ids = COALESCE($4::text[], active_auth_context_ids),
        identity_claims = COALESCE($5::jsonb, identity_claims),
        identity_authorization = COALESCE($6::jsonb, identity_authorization),
        updated_at = now()
      WHERE id = $1
    `,
    [
      input.sessionId,
      input.sessionAssurance,
      input.lastReauthenticatedAt ?? null,
      input.activeAuthContextIds ?? null,
      input.identityClaims ? JSON.stringify(input.identityClaims) : null,
      input.identityAuthorization ? JSON.stringify(input.identityAuthorization) : null
    ]
  );
}

export async function resolveAuthenticatedUser(token: string): Promise<AuthUser | null> {
  const payload = await verifySignedToken(token);
  const sessionId = String(payload.sid ?? "");
  const userId = String(payload.sub ?? "");
  const tenantId = String(payload.tenant_id ?? "");
  const tokenVersion = Number(payload.ver ?? 0);
  if (!sessionId || !userId || !tenantId) {
    return null;
  }

  const client = await connectGuardedClient();
  try {
    const row = await loadMembershipAccessBySession(client, sessionId);
    if (!row) {
      return null;
    }
    if (row.id !== userId || row.tenant_id !== tenantId || Number(row.auth_version) !== tokenVersion) {
      return null;
    }
    if (row.status !== "active") {
      return null;
    }
    if (shouldTouchSessionLastSeen()) {
      await client.query("UPDATE auth_session SET last_seen_at = now() WHERE id = $1", [sessionId]);
    }
    return applySharedPolicyAccess(client, mapAuthUser(row));
  } finally {
    client.release();
  }
}

export async function revokeSession(client: PoolClient, sessionId: string, reason: string) {
  await client.query("UPDATE auth_session SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL", [sessionId, reason]);
}

export async function revokeAllSessionsForUser(client: PoolClient, userId: string, reason: string) {
  await client.query(
    "UPDATE auth_session SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL",
    [userId, reason]
  );
}

export async function bumpAuthVersion(client: PoolClient, userId: string) {
  await client.query("UPDATE app_user SET auth_version = auth_version + 1 WHERE id = $1", [userId]);
}

export async function devLogin(email: string, metadata: RequestAuditContext) {
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    const membership = await loadMembershipByEmail(client, normalizeEmail(email));
    if (!membership) {
      throw new ApiError(404, "User not found");
    }
    if (membership.status !== "active") {
      throw new ApiError(403, "Account is not active");
    }
    const { sessionId, token, csrfToken } = await issueAuthSession(client, {
      userId: membership.id,
      tenantId: membership.tenant_id,
      authVersion: membership.auth_version,
      provider: "dev",
      metadata
    });
    await client.query("UPDATE app_user SET last_login_at = now() WHERE id = $1", [membership.id]);
    await createAuditLog(client, {
      tenantId: membership.tenant_id,
      actorUserId: membership.id,
      targetUserId: membership.id,
      action: "auth.dev_login",
      entityType: "session",
      entityId: sessionId,
      metadata: { email: membership.email },
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null
    });
    await client.query("COMMIT");
    return { token, csrfToken };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loginWithPassword(email: string, password: string, metadata: RequestAuditContext) {
  if (!config.ALLOW_PASSWORD_LOGIN) {
    throw new ApiError(404, "Not found");
  }
  const normalizedEmail = normalizeEmail(email);
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    const membership = await loadMembershipByEmail(client, normalizedEmail);
    const passwordOk = await verifyPassword(password, membership?.password_hash);

    if (!membership || !passwordOk) {
      if (membership) {
        await createAuditLog(client, {
          tenantId: membership.tenant_id,
          targetUserId: membership.id,
          action: "auth.login.failed",
          entityType: "session",
          metadata: { email: normalizedEmail, reason: "invalid_credentials" },
          ipAddress: metadata.ipAddress ?? null,
          userAgent: metadata.userAgent ?? null
        });
      }
      await client.query("COMMIT");
      throw new ApiError(401, "Invalid email or password");
    }

    if (membership.status !== "active") {
      await createAuditLog(client, {
        tenantId: membership.tenant_id,
        targetUserId: membership.id,
        action: "auth.login.blocked",
        entityType: "session",
        metadata: { email: normalizedEmail, status: membership.status },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null
      });
      await client.query("COMMIT");
      throw new ApiError(403, "Account is not active");
    }

    if (
      config.MICROSOFT_ENTRA_AUTH_ENABLED &&
      config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY &&
      !["leadership", "super_admin"].includes(membership.authority_tier ?? "")
    ) {
      await createAuditLog(client, {
        tenantId: membership.tenant_id,
        targetUserId: membership.id,
        action: "auth.login.blocked",
        entityType: "session",
        metadata: {
          email: normalizedEmail,
          reason: "password_login_break_glass_only",
          microsoft_entra_enabled: true
        },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null
      });
      await client.query("COMMIT");
      throw new ApiError(403, "Password sign-in is limited to configured break-glass accounts in this environment.");
    }

    const { sessionId, token, csrfToken } = await issueAuthSession(client, {
      userId: membership.id,
      tenantId: membership.tenant_id,
      authVersion: membership.auth_version,
      provider: "local_password",
      metadata
    });
    await client.query("UPDATE app_user SET last_login_at = now() WHERE id = $1", [membership.id]);
    await createAuditLog(client, {
      tenantId: membership.tenant_id,
      actorUserId: membership.id,
      targetUserId: membership.id,
      action: "auth.login.success",
      entityType: "session",
      entityId: sessionId,
      metadata: {
        email: normalizedEmail,
        break_glass_only_mode: Boolean(config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY && config.MICROSOFT_ENTRA_AUTH_ENABLED)
      },
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null
    });
    await client.query("COMMIT");
    return { token, csrfToken };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function logout(auth: AuthUser, metadata: RequestAuditContext) {
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    await revokeSession(client, auth.sessionId, "logout");
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: auth.id,
      action: "auth.logout",
      entityType: "session",
      entityId: auth.sessionId,
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function changePassword(auth: AuthUser, currentPassword: string, newPassword: string, metadata: RequestAuditContext) {
  if (!auth.accountId) {
    throw new ApiError(400, "Password login is not configured for this account");
  }

  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    const accountResult = await client.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM user_account WHERE id = $1",
      [auth.accountId]
    );
    const account = accountResult.rows[0];
    if (!account || !(await verifyPassword(currentPassword, account.password_hash))) {
      throw new ApiError(400, "Current password is incorrect");
    }

    const nextHash = await hashPassword(newPassword);
    await client.query("UPDATE user_account SET password_hash = $2, updated_at = now() WHERE id = $1", [auth.accountId, nextHash]);
    await bumpAuthVersion(client, auth.id);
    await revokeAllSessionsForUser(client, auth.id, "password_changed");
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: auth.id,
      action: "auth.password_changed",
      entityType: "user_account",
      entityId: auth.accountId,
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestPasswordReset(email: string, metadata: RequestAuditContext) {
  const normalizedEmail = normalizeEmail(email);
  const rawToken = createRawToken();
  const tokenHash = hashOpaqueToken(rawToken);
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    const membership = await loadMembershipByEmail(client, normalizedEmail);
    if (membership?.account_id) {
      await client.query(
        `
          INSERT INTO password_reset_token (account_id, token_hash, expires_at, requested_ip)
          VALUES ($1,$2, now() + ($3::text || ' minutes')::interval, $4)
        `,
        [membership.account_id, tokenHash, String(config.PASSWORD_RESET_TTL_MINUTES), metadata.ipAddress ?? null]
      );
      await createAuditLog(client, {
        tenantId: membership.tenant_id,
        targetUserId: membership.id,
        action: "auth.password_reset.requested",
        entityType: "user_account",
        entityId: membership.account_id,
        metadata: { email: normalizedEmail },
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null
      });
    }
    await client.query("COMMIT");
    return {
      message: "If an account matches that email, reset instructions have been created.",
      reset_token: config.NODE_ENV === "development" ? rawToken : undefined
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resetPassword(rawToken: string, newPassword: string, metadata: RequestAuditContext) {
  const tokenHash = hashOpaqueToken(rawToken);
  const client = await connectGuardedClient();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query<{ account_id: string }>(
      `
        SELECT account_id
        FROM password_reset_token
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        LIMIT 1
      `,
      [tokenHash]
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new ApiError(400, "Reset token is invalid or expired");
    }

    const membershipResult = await client.query<{ id: string; tenant_id: string }>(
      "SELECT id, tenant_id FROM app_user WHERE account_id = $1 ORDER BY created_at ASC LIMIT 1",
      [token.account_id]
    );
    const membership = membershipResult.rows[0];
    const nextHash = await hashPassword(newPassword);
    await client.query("UPDATE user_account SET password_hash = $2, updated_at = now() WHERE id = $1", [token.account_id, nextHash]);
    await client.query("UPDATE password_reset_token SET used_at = now() WHERE token_hash = $1", [tokenHash]);
    if (membership) {
      await bumpAuthVersion(client, membership.id);
      await revokeAllSessionsForUser(client, membership.id, "password_reset");
      await createAuditLog(client, {
        tenantId: membership.tenant_id,
        targetUserId: membership.id,
        action: "auth.password_reset.completed",
        entityType: "user_account",
        entityId: token.account_id,
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
