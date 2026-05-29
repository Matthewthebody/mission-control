import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthRole, AuthUser, AuthorityTier, DepartmentCode, JobFunctionProfile } from "../types/auth.js";
import { syncUserAuthorityAssignment } from "./authority.js";
import { createAuditLog } from "./audit.js";
import { bumpAuthVersion, revokeAllSessionsForUser } from "./auth.js";

type SecurityApprovalStatus = "pending" | "approved" | "rejected" | "canceled" | "executed";

type SecurityApprovalRow = {
  id: string;
  request_type: string;
  action_code: string;
  subject_resource_type: string;
  subject_resource_id: string | null;
  status: SecurityApprovalStatus;
  required_approver_tier: AuthorityTier;
  requested_by_user_id: string;
  target_user_id: string | null;
  reason: string;
  current_state: Record<string, unknown>;
  requested_state: Record<string, unknown>;
  decision_note: string | null;
  approved_by_user_id: string | null;
  rejected_by_user_id: string | null;
  canceled_by_user_id: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
};

type MembershipSummary = {
  id: string;
  email: string;
  full_name: string;
  department: DepartmentCode;
  authority_tier: AuthorityTier | null;
  primary_job_function_profile: JobFunctionProfile | null;
  job_function_profiles: JobFunctionProfile[];
  roles: AuthRole[];
};

type AccessMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export function requiresDualApprovalForAuthorityTier(authorityTier: AuthorityTier) {
  return authorityTier === "leadership" || authorityTier === "super_admin";
}

function requiredApproverTierForAuthority(authorityTier: AuthorityTier): AuthorityTier {
  return authorityTier === "super_admin" ? "super_admin" : "leadership";
}

async function loadMembership(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<MembershipSummary>(
    `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.department::text AS department,
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

async function loadApprovalRequest(client: PoolClient, tenantId: string, approvalRequestId: string) {
  const { rows } = await client.query<SecurityApprovalRow>(
    `
      SELECT
        id,
        request_type,
        action_code,
        subject_resource_type,
        subject_resource_id,
        status,
        required_approver_tier::text AS required_approver_tier,
        requested_by_user_id,
        target_user_id,
        reason,
        current_state,
        requested_state,
        decision_note,
        approved_by_user_id,
        rejected_by_user_id,
        canceled_by_user_id,
        created_at::text,
        decided_at::text,
        executed_at::text
      FROM security_approval_request
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, approvalRequestId]
  );
  return rows[0] ?? null;
}

function assertApprovalAuthority(auth: AuthUser, requiredTier: AuthorityTier) {
  if (!hasAuthorityTier(auth, [requiredTier, "super_admin"])) {
    throw new ApiError(403, "This approval requires a higher-trust reviewer.");
  }
}

export async function createMembershipRoleApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  input: {
    targetUserId: string;
    authorityTier: AuthorityTier;
    primaryProfile: JobFunctionProfile;
    jobFunctionProfiles: JobFunctionProfile[];
    department: DepartmentCode;
    compatibilityRole: AuthRole;
    reason: string;
  },
  meta: AccessMeta
) {
  const target = await loadMembership(client, auth.tenantId, input.targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO security_approval_request (
        tenant_id,
        request_type,
        action_code,
        subject_resource_type,
        subject_resource_id,
        status,
        required_approver_tier,
        requested_by_user_id,
        target_user_id,
        reason,
        current_state,
        requested_state
      )
      VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10::jsonb,$11::jsonb)
      RETURNING id
    `,
    [
      auth.tenantId,
      "membership_role_change",
      "grant_privileged_access",
      "membership",
      input.targetUserId,
      requiredApproverTierForAuthority(input.authorityTier),
      auth.id,
      input.targetUserId,
      input.reason,
      JSON.stringify({
        authority_tier: target.authority_tier,
        primary_profile: target.primary_job_function_profile,
        job_function_profiles: target.job_function_profiles,
        roles: target.roles,
        department: target.department
      }),
      JSON.stringify({
        authority_tier: input.authorityTier,
        primary_profile: input.primaryProfile,
        job_function_profiles: input.jobFunctionProfiles,
        compatibility_role: input.compatibilityRole,
        department: input.department
      })
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: input.targetUserId,
    action: "security_approval.requested",
    entityType: "security_approval_request",
    entityId: rows[0].id,
    metadata: {
      request_type: "membership_role_change",
      action_code: "grant_privileged_access",
      requested_authority_tier: input.authorityTier,
      requested_primary_profile: input.primaryProfile,
      requested_profiles: input.jobFunctionProfiles,
      requested_department: input.department,
      reason: input.reason
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return {
    approvalRequestId: rows[0].id,
    requiredApproverTier: requiredApproverTierForAuthority(input.authorityTier)
  };
}

export async function listSecurityApprovalRequests(client: PoolClient, auth: AuthUser, filters?: { status?: SecurityApprovalStatus | null }) {
  const values: unknown[] = [auth.tenantId];
  const where: string[] = ["sar.tenant_id = $1"];
  if (filters?.status) {
    values.push(filters.status);
    where.push(`sar.status = $${values.length}`);
  }
  const { rows } = await client.query(
    `
      SELECT
        sar.id,
        sar.request_type,
        sar.action_code,
        sar.subject_resource_type,
        sar.subject_resource_id,
        sar.status,
        sar.required_approver_tier::text AS required_approver_tier,
        sar.requested_by_user_id,
        sar.target_user_id,
        sar.reason,
        sar.current_state,
        sar.requested_state,
        sar.decision_note,
        sar.approved_by_user_id,
        sar.rejected_by_user_id,
        sar.canceled_by_user_id,
        sar.created_at,
        sar.decided_at,
        sar.executed_at,
        requester.full_name AS requester_name,
        requester.email AS requester_email,
        target.full_name AS target_name,
        target.email AS target_email,
        approver.full_name AS approver_name,
        rejector.full_name AS rejector_name
      FROM security_approval_request sar
      LEFT JOIN app_user requester ON requester.id = sar.requested_by_user_id
      LEFT JOIN app_user target ON target.id = sar.target_user_id
      LEFT JOIN app_user approver ON approver.id = sar.approved_by_user_id
      LEFT JOIN app_user rejector ON rejector.id = sar.rejected_by_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY sar.created_at DESC
      LIMIT 200
    `,
    values
  );
  return rows;
}

export async function approveSecurityApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  approvalRequestId: string,
  input: { note?: string | null },
  meta: AccessMeta
) {
  const request = await loadApprovalRequest(client, auth.tenantId, approvalRequestId);
  if (!request) {
    throw new ApiError(404, "Approval request not found");
  }
  if (request.status !== "pending") {
    throw new ApiError(409, "This approval request is no longer pending.");
  }
  if (request.requested_by_user_id === auth.id) {
    throw new ApiError(403, "You cannot approve your own privileged request.");
  }
  assertApprovalAuthority(auth, request.required_approver_tier);

  if (request.request_type === "membership_role_change") {
    const requestedState = request.requested_state as {
      authority_tier: AuthorityTier;
      primary_profile: JobFunctionProfile;
      job_function_profiles: JobFunctionProfile[];
      department: DepartmentCode;
    };
    const target = await loadMembership(client, auth.tenantId, request.target_user_id ?? "");
    if (!target) {
      throw new ApiError(404, "The target user no longer exists.");
    }

    await client.query(
      `
        UPDATE security_approval_request
        SET status = 'approved',
            approved_by_user_id = $2,
            decision_note = $3,
            decided_at = now()
        WHERE id = $1
      `,
      [approvalRequestId, auth.id, input.note ?? null]
    );

    await syncUserAuthorityAssignment(client, {
      tenantId: auth.tenantId,
      userId: target.id,
      authorityTier: requestedState.authority_tier,
      primaryJobFunctionProfile: requestedState.primary_profile,
      jobFunctionProfiles: requestedState.job_function_profiles,
      scopeDepartment: requestedState.department,
      assignedByUserId: auth.id
    });
    await bumpAuthVersion(client, target.id);
    await revokeAllSessionsForUser(client, target.id, "privileged_role_change");

    await client.query(
      `
        UPDATE security_approval_request
        SET status = 'executed',
            executed_at = now()
        WHERE id = $1
      `,
      [approvalRequestId]
    );

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: target.id,
      action: "security_approval.executed",
      entityType: "security_approval_request",
      entityId: approvalRequestId,
      metadata: {
        request_type: request.request_type,
        action_code: request.action_code,
        previous_state: request.current_state,
        requested_state: request.requested_state,
        decision_note: input.note ?? null
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      targetUserId: target.id,
      action: "user.role_changed",
      entityType: "membership",
      entityId: target.id,
      metadata: {
        approval_request_id: approvalRequestId,
        previous_authority_tier: request.current_state?.authority_tier ?? null,
        previous_profiles: request.current_state?.job_function_profiles ?? [],
        next_authority_tier: requestedState.authority_tier,
        next_profiles: requestedState.job_function_profiles
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    });

    return { ok: true, status: "executed" as const };
  }

  throw new ApiError(409, "Unsupported approval request type.");
}

export async function rejectSecurityApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  approvalRequestId: string,
  input: { note?: string | null },
  meta: AccessMeta
) {
  const request = await loadApprovalRequest(client, auth.tenantId, approvalRequestId);
  if (!request) {
    throw new ApiError(404, "Approval request not found");
  }
  if (request.status !== "pending") {
    throw new ApiError(409, "This approval request is no longer pending.");
  }
  if (request.requested_by_user_id === auth.id) {
    throw new ApiError(403, "You cannot reject your own privileged request.");
  }
  assertApprovalAuthority(auth, request.required_approver_tier);

  await client.query(
    `
      UPDATE security_approval_request
      SET status = 'rejected',
          rejected_by_user_id = $2,
          decision_note = $3,
          decided_at = now()
      WHERE id = $1
    `,
    [approvalRequestId, auth.id, input.note ?? null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: request.target_user_id ?? null,
    action: "security_approval.rejected",
    entityType: "security_approval_request",
    entityId: approvalRequestId,
    metadata: {
      request_type: request.request_type,
      action_code: request.action_code,
      decision_note: input.note ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return { ok: true, status: "rejected" as const };
}

export async function cancelSecurityApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  approvalRequestId: string,
  input: { note?: string | null },
  meta: AccessMeta
) {
  const request = await loadApprovalRequest(client, auth.tenantId, approvalRequestId);
  if (!request) {
    throw new ApiError(404, "Approval request not found");
  }
  if (request.status !== "pending") {
    throw new ApiError(409, "This approval request is no longer pending.");
  }
  if (request.requested_by_user_id !== auth.id && !hasAuthorityTier(auth, ["super_admin", "leadership"])) {
    throw new ApiError(403, "Only the requester or a privileged reviewer can cancel this request.");
  }

  await client.query(
    `
      UPDATE security_approval_request
      SET status = 'canceled',
          canceled_by_user_id = $2,
          decision_note = $3,
          decided_at = now()
      WHERE id = $1
    `,
    [approvalRequestId, auth.id, input.note ?? null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: request.target_user_id ?? null,
    action: "security_approval.canceled",
    entityType: "security_approval_request",
    entityId: approvalRequestId,
    metadata: {
      request_type: request.request_type,
      action_code: request.action_code,
      decision_note: input.note ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return { ok: true, status: "canceled" as const };
}

export async function listBreakGlassEvents(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query(
    `
      SELECT
        bge.id,
        bge.scope_type,
        bge.scope_id,
        bge.reason,
        bge.started_at,
        bge.expires_at,
        bge.ended_at,
        bge.ended_reason,
        bge.review_status,
        actor.full_name AS actor_name,
        reviewer.full_name AS reviewer_name,
        ender.full_name AS ended_by_name
      FROM break_glass_event bge
      JOIN app_user actor ON actor.id = bge.actor_user_id
      LEFT JOIN app_user reviewer ON reviewer.id = bge.reviewed_by_user_id
      LEFT JOIN app_user ender ON ender.id = bge.ended_by_user_id
      WHERE bge.tenant_id = $1
      ORDER BY bge.started_at DESC
      LIMIT 100
    `,
    [auth.tenantId]
  );
  return rows;
}

export async function markBreakGlassReviewed(
  client: PoolClient,
  auth: AuthUser,
  breakGlassEventId: string,
  input: { note?: string | null },
  meta: AccessMeta
) {
  const result = await client.query(
    `
      UPDATE break_glass_event
      SET review_status = 'reviewed',
          reviewed_at = now(),
          reviewed_by_user_id = $2,
          metadata = metadata || $3::jsonb
      WHERE tenant_id = $1
        AND id = $4
      RETURNING id
    `,
    [auth.tenantId, auth.id, JSON.stringify({ review_note: input.note ?? null }), breakGlassEventId]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Break-glass event not found");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "auth.break_glass.reviewed",
    entityType: "break_glass_event",
    entityId: breakGlassEventId,
    metadata: {
      review_note: input.note ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return { ok: true };
}

export async function getSecurityOverview(client: PoolClient, auth: AuthUser) {
  const pendingApprovals = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM security_approval_request WHERE tenant_id = $1 AND status = 'pending'",
    [auth.tenantId]
  );
  const activeBreakGlass = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM break_glass_event WHERE tenant_id = $1 AND ended_at IS NULL AND expires_at > now()",
    [auth.tenantId]
  );
  const pendingBreakGlassReview = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM break_glass_event WHERE tenant_id = $1 AND review_status = 'pending_review'",
    [auth.tenantId]
  );
  const recentDangerousActions = await client.query(
    `
      SELECT
        dae.id,
        dae.action_code,
        dae.status,
        dae.entity_type,
        dae.entity_id,
        dae.source_module,
        dae.reason,
        dae.created_at,
        actor.full_name AS actor_name
      FROM dangerous_action_execution dae
      LEFT JOIN app_user actor ON actor.id = dae.actor_user_id
      WHERE dae.tenant_id = $1
      ORDER BY dae.created_at DESC
      LIMIT 25
    `,
    [auth.tenantId]
  );

  return {
    session_policy: {
      elevated_minutes: config.AUTH_ELEVATED_MINUTES,
      privileged_mode_minutes: config.AUTH_PRIVILEGED_MODE_MINUTES,
      break_glass_max_minutes: config.AUTH_BREAK_GLASS_MAX_MINUTES
    },
    current_session: {
      identity_provider: auth.sessionTrust.identityProvider,
      session_assurance: auth.sessionTrust.sessionAssurance,
      authenticated_at: auth.sessionTrust.authenticatedAt,
      last_reauthenticated_at: auth.sessionTrust.lastReauthenticatedAt,
      active_auth_context_ids: auth.sessionTrust.activeAuthContextIds,
      elevated_session_active: auth.sessionTrust.elevatedSessionActive,
      privileged_mode_active: auth.sessionTrust.privilegedModeActive,
      break_glass_mode_active: auth.sessionTrust.breakGlassModeActive
    },
    microsoft_auth_diagnostics: auth.sessionTrust.identityProvider === "microsoft_entra"
      ? {
          raw_inputs: auth.microsoftEntraAuthorization?.raw ?? null,
          resolved_access: auth.microsoftEntraAuthorization?.resolved ?? null,
          issues: auth.microsoftEntraAuthorization?.issues ?? [],
          sign_in_allowed: auth.microsoftEntraAuthorization?.signInAllowed ?? true
        }
      : null,
    risky_fallbacks: {
      allow_dev_login: config.ALLOW_DEV_LOGIN,
      allow_password_login: config.ALLOW_PASSWORD_LOGIN,
      allow_password_login_break_glass_only: config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY,
      teams_dev_bypass_auth: config.MICROSOFT_TEAMS_DEV_BYPASS_AUTH
    },
    pending_approval_count: Number(pendingApprovals.rows[0]?.count ?? 0),
    active_break_glass_count: Number(activeBreakGlass.rows[0]?.count ?? 0),
    pending_break_glass_review_count: Number(pendingBreakGlassReview.rows[0]?.count ?? 0),
    recent_dangerous_actions: recentDangerousActions.rows
  };
}
