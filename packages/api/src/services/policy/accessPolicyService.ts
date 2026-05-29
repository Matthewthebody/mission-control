import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser, SharedPolicyEffect, SharedPolicyScopeType } from "../../types/auth.js";
import { deriveCommunicationIdentityStatus } from "../communicationIdentity.js";
import type {
  AccessPolicyPreview,
  AccessPolicyWorkspace,
  DelegationAssignmentRecord,
  FieldVisibilityRuleRecord,
  PermissionOverrideRecord,
  PolicyAuditEventRecord,
  PolicyPermissionRecord,
  PolicyRolePermissionGrantRecord,
  PolicyRoleRecord,
  SectionVisibilityRuleRecord,
  UserRoleAssignmentRecord
} from "../../types/policy.js";
import { loadAuthenticatedUserByUserId } from "../auth.js";
import { writePolicyDecisionTrace } from "../diagnostics/policyTraceService.js";
import { writeAuthPolicyAuditEvent } from "./policyAuditService.js";
import {
  buildSharedResourcePolicySnapshot,
  canSharedPolicy,
  getVisibleFields,
  getVisibleSections,
  hydrateSharedPolicyAccess,
  type PolicyResourceContext
} from "./policyEngine.js";

type RoleAssignmentInput = {
  userId: string;
  roleCode: string;
  scopeType: SharedPolicyScopeType;
  scopeValue: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
};

type PermissionOverrideInput = {
  userId: string;
  permissionCode: string;
  scopeType: SharedPolicyScopeType;
  scopeValue: string | null;
  effect: SharedPolicyEffect;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
};

type DelegationInput = {
  fromUserId: string;
  toUserId: string;
  roleCode: string | null;
  permissionBundleKey: string | null;
  scopeType: SharedPolicyScopeType;
  scopeValue: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
};

type FieldRuleUpdateInput = {
  requiredPermissionCode: string | null;
  defaultVisibility: "hidden" | "masked" | "readonly" | "editable";
  maskingStrategy: "partial_email" | "partial_phone" | "money_summary_only" | "initials_only" | "redacted_text" | "none" | null;
};

type SectionRuleUpdateInput = {
  requiredPermissionCode: string | null;
  defaultVisibility: "hidden" | "masked" | "readonly" | "editable";
};

type PreviewInput = {
  targetUserId: string;
  routeId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  permissionKeys?: string[];
  context?: PolicyResourceContext;
};

async function listUsersSummary(client: PoolClient, tenantId: string) {
  const result = await client.query<
    {
      user_id: string;
      full_name: string;
      email: string;
      department: string;
      membership_status: "invited" | "pending_approval" | "active" | "suspended" | "revoked";
      authority_tier: string | null;
      primary_job_function_profile: string | null;
      active_role_codes: string[];
      microsoft_user_id: string | null;
      microsoft_tenant_id: string | null;
      auth_provider: string | null;
      communication_enabled: boolean;
      communication_posting_disabled_at: string | null;
      communication_posting_disabled_reason: string | null;
      teams_chat_default_target: string | null;
      linked_at: string | null;
      last_verified_at: string | null;
    }
  >(
    `
      SELECT
        u.id::text AS user_id,
        u.full_name,
        u.email,
        u.department::text AS department,
        u.status::text AS membership_status,
        uaa.authority_tier::text AS authority_tier,
        uaa.primary_job_function_profile::text AS primary_job_function_profile,
        account.microsoft_user_id,
        account.microsoft_tenant_id,
        account.auth_provider,
        COALESCE(account.communication_enabled, false) AS communication_enabled,
        account.communication_posting_disabled_at::text AS communication_posting_disabled_at,
        account.communication_posting_disabled_reason,
        account.teams_chat_default_target,
        account.linked_at::text AS linked_at,
        account.last_verified_at::text AS last_verified_at,
        COALESCE(
          array_agg(DISTINCT role.code) FILTER (
            WHERE role.code IS NOT NULL
              AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
              AND (assignment.ends_at IS NULL OR assignment.ends_at >= now())
          ),
          '{}'
        ) AS active_role_codes
      FROM app_user u
      LEFT JOIN user_account account ON account.id = u.account_id
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = u.tenant_id
       AND uaa.user_id = u.id
      LEFT JOIN user_role_assignment assignment
        ON assignment.tenant_id = u.tenant_id
       AND assignment.user_id = u.id
      LEFT JOIN role ON role.id = assignment.role_id
      WHERE u.tenant_id = $1
      GROUP BY
        u.id,
        u.status,
        uaa.authority_tier,
        uaa.primary_job_function_profile,
        account.microsoft_user_id,
        account.microsoft_tenant_id,
        account.auth_provider,
        account.communication_enabled,
        account.communication_posting_disabled_at,
        account.communication_posting_disabled_reason,
        account.teams_chat_default_target,
        account.linked_at,
        account.last_verified_at
      ORDER BY u.full_name ASC
    `,
    [tenantId]
  );
  return result.rows.map((row) => ({
    ...row,
    communication_identity_status: deriveCommunicationIdentityStatus({
      microsoftUserId: row.microsoft_user_id,
      microsoftTenantId: row.microsoft_tenant_id,
      communicationEnabled: row.communication_enabled,
      teamsChatDefaultTarget: row.teams_chat_default_target,
      linkedAt: row.linked_at,
      lastVerifiedAt: row.last_verified_at,
      authProvider: row.auth_provider
    })
  }));
}

export async function getAccessPolicyWorkspace(client: PoolClient, auth: AuthUser): Promise<AccessPolicyWorkspace> {
  const [roles, permissions, roleGrants, users, assignments, delegations, overrides, fieldRules, sectionRules, auditEvents] =
    await Promise.all([
      client.query<PolicyRoleRecord>(
        `SELECT id::text, code, name, description, department_type, is_system_role, is_assignable, created_at::text, updated_at::text FROM role ORDER BY name ASC`
      ),
      client.query<PolicyPermissionRecord>(
        `SELECT id::text, code, name, description, resource_type, action_group, created_at::text, updated_at::text FROM permission ORDER BY code ASC`
      ),
      client.query<PolicyRolePermissionGrantRecord>(
        `
          SELECT
            role_grant.id::text,
            role_grant.role_id::text,
            role_grant.permission_id::text,
            permission.code AS permission_code,
            role_grant.scope_type::text AS scope_type,
            role_grant.scope_value,
            role_grant.effect::text AS effect,
            role_grant.created_at::text,
            role_grant.updated_at::text
          FROM role_permission_grant role_grant
          JOIN permission ON permission.id = role_grant.permission_id
          ORDER BY permission.code ASC
        `
      ),
      listUsersSummary(client, auth.tenantId),
      client.query<UserRoleAssignmentRecord>(
        `
          SELECT
            assignment.id::text,
            assignment.tenant_id::text,
            assignment.user_id::text,
            user_target.full_name AS user_name,
            user_target.email AS user_email,
            assignment.role_id::text,
            role.code AS role_code,
            role.name AS role_name,
            assignment.scope_type::text,
            assignment.scope_value,
            assignment.starts_at::text,
            assignment.ends_at::text,
            assignment.assigned_by_user_id::text,
            user_actor.full_name AS assigned_by_name,
            assignment.reason,
            assignment.created_at::text,
            assignment.updated_at::text
          FROM user_role_assignment assignment
          JOIN role ON role.id = assignment.role_id
          JOIN app_user user_target ON user_target.id = assignment.user_id AND user_target.tenant_id = assignment.tenant_id
          LEFT JOIN app_user user_actor ON user_actor.id = assignment.assigned_by_user_id AND user_actor.tenant_id = assignment.tenant_id
          WHERE assignment.tenant_id = $1
          ORDER BY assignment.created_at DESC
        `,
        [auth.tenantId]
      ),
      client.query<DelegationAssignmentRecord>(
        `
          SELECT
            delegation.id::text,
            delegation.tenant_id::text,
            delegation.from_user_id::text,
            from_user.full_name AS from_user_name,
            delegation.to_user_id::text,
            to_user.full_name AS to_user_name,
            delegation.role_id::text,
            role.code AS role_code,
            role.name AS role_name,
            delegation.permission_bundle_key,
            delegation.scope_type::text,
            delegation.scope_value,
            delegation.starts_at::text,
            delegation.ends_at::text,
            CASE
              WHEN delegation.status = 'revoked'::delegation_status_type THEN delegation.status::text
              WHEN delegation.ends_at < now() THEN 'expired'
              WHEN delegation.starts_at <= now() THEN 'active'
              ELSE 'pending'
            END AS status,
            delegation.reason,
            delegation.approved_by_user_id::text,
            approver.full_name AS approved_by_name,
            delegation.created_at::text,
            delegation.updated_at::text
          FROM delegation_assignment delegation
          LEFT JOIN role ON role.id = delegation.role_id
          JOIN app_user from_user ON from_user.id = delegation.from_user_id AND from_user.tenant_id = delegation.tenant_id
          JOIN app_user to_user ON to_user.id = delegation.to_user_id AND to_user.tenant_id = delegation.tenant_id
          LEFT JOIN app_user approver ON approver.id = delegation.approved_by_user_id AND approver.tenant_id = delegation.tenant_id
          WHERE delegation.tenant_id = $1
          ORDER BY delegation.created_at DESC
        `,
        [auth.tenantId]
      ),
      client.query<PermissionOverrideRecord>(
        `
          SELECT
            permission_override.id::text,
            permission_override.tenant_id::text,
            permission_override.user_id::text,
            user_target.full_name AS user_name,
            user_target.email AS user_email,
            permission_override.permission_id::text,
            permission.code AS permission_code,
            permission_override.scope_type::text,
            permission_override.scope_value,
            permission_override.effect::text,
            permission_override.starts_at::text,
            permission_override.ends_at::text,
            permission_override.reason,
            permission_override.approved_by_user_id::text,
            approver.full_name AS approved_by_name,
            permission_override.created_at::text,
            permission_override.updated_at::text
          FROM permission_override
          JOIN permission ON permission.id = permission_override.permission_id
          JOIN app_user user_target ON user_target.id = permission_override.user_id AND user_target.tenant_id = permission_override.tenant_id
          LEFT JOIN app_user approver ON approver.id = permission_override.approved_by_user_id AND approver.tenant_id = permission_override.tenant_id
          WHERE permission_override.tenant_id = $1
          ORDER BY permission_override.created_at DESC
        `,
        [auth.tenantId]
      ),
      client.query<FieldVisibilityRuleRecord>(
        `
          SELECT
            id::text, resource_type, field_key, sensitivity_category::text, required_permission_code,
            default_visibility::text, masking_strategy::text, department_type, created_at::text, updated_at::text
          FROM field_visibility_rule
          ORDER BY resource_type ASC, field_key ASC
        `
      ),
      client.query<SectionVisibilityRuleRecord>(
        `
          SELECT
            id::text, resource_type, section_key, required_permission_code, sensitivity_category::text,
            default_visibility::text, department_type, created_at::text, updated_at::text
          FROM section_visibility_rule
          ORDER BY resource_type ASC, section_key ASC
        `
      ),
      client.query<PolicyAuditEventRecord>(
        `
          SELECT
            event.id::text,
            event.tenant_id::text,
            event.actor_user_id::text,
            actor.full_name AS actor_name,
            event.target_user_id::text,
            target_user.full_name AS target_name,
            event.policy_event_type,
            event.resource_type,
            event.resource_id,
            event.permission_code,
            event.result,
            event.details_json,
            event.created_at::text
          FROM policy_audit_event event
          LEFT JOIN app_user actor ON actor.id = event.actor_user_id AND actor.tenant_id = event.tenant_id
          LEFT JOIN app_user target_user ON target_user.id = event.target_user_id AND target_user.tenant_id = event.tenant_id
          WHERE event.tenant_id = $1
          ORDER BY event.created_at DESC
          LIMIT 200
        `,
        [auth.tenantId]
      )
    ]);

  return {
    summary: {
      role_count: roles.rows.length,
      assignment_count: assignments.rows.length,
      delegation_count: delegations.rows.length,
      override_count: overrides.rows.length,
      audit_event_count: auditEvents.rows.length
    },
    roles: roles.rows,
    permissions: permissions.rows,
    role_grants: roleGrants.rows,
    users,
    assignments: assignments.rows,
    delegations: delegations.rows,
    overrides: overrides.rows,
    field_rules: fieldRules.rows,
    section_rules: sectionRules.rows,
    audit_events: auditEvents.rows
  };
}

export async function createUserRoleAssignment(client: PoolClient, auth: AuthUser, input: RoleAssignmentInput) {
  const role = await client.query<{ id: string }>(`SELECT id::text FROM role WHERE code = $1 LIMIT 1`, [input.roleCode]);
  if (!role.rows[0]) {
    throw new ApiError(400, "Unknown role");
  }
  await client.query(
    `
      INSERT INTO user_role_assignment (
        tenant_id, user_id, role_id, scope_type, scope_value, starts_at, ends_at, assigned_by_user_id, reason
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      auth.tenantId,
      input.userId,
      role.rows[0].id,
      input.scopeType,
      input.scopeValue,
      input.startsAt,
      input.endsAt,
      auth.id,
      input.reason
    ]
  );
  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: input.userId,
    policyEventType: "role_assignment_created",
    resourceType: "user_role_assignment",
    permissionCode: "settings.roles.manage",
    result: "allowed",
    details: input
  });
}

export async function expireUserRoleAssignment(client: PoolClient, auth: AuthUser, assignmentId: string, reason: string | null) {
  const result = await client.query<{ user_id: string }>(
    `
      UPDATE user_role_assignment
      SET ends_at = now(),
          updated_at = now(),
          reason = COALESCE($3, reason)
      WHERE tenant_id = $1
        AND id = $2
      RETURNING user_id::text
    `,
    [auth.tenantId, assignmentId, reason]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Role assignment not found");
  }
  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: result.rows[0].user_id,
    policyEventType: "role_assignment_expired",
    resourceType: "user_role_assignment",
    resourceId: assignmentId,
    permissionCode: "settings.roles.manage",
    result: "allowed",
    details: { reason }
  });
}

export async function createPermissionOverrideRecord(client: PoolClient, auth: AuthUser, input: PermissionOverrideInput) {
  const permission = await client.query<{ id: string }>(`SELECT id::text FROM permission WHERE code = $1 LIMIT 1`, [input.permissionCode]);
  if (!permission.rows[0]) {
    throw new ApiError(400, "Unknown permission");
  }
  await client.query(
    `
      INSERT INTO permission_override (
        tenant_id, user_id, permission_id, scope_type, scope_value, effect, starts_at, ends_at, reason, approved_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      auth.tenantId,
      input.userId,
      permission.rows[0].id,
      input.scopeType,
      input.scopeValue,
      input.effect,
      input.startsAt,
      input.endsAt,
      input.reason,
      auth.id
    ]
  );
  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: input.userId,
    policyEventType: "permission_override_created",
    resourceType: "permission_override",
    permissionCode: "settings.permissions.manage",
    result: "allowed",
    details: input
  });
}

export async function expirePermissionOverrideRecord(client: PoolClient, auth: AuthUser, overrideId: string, reason: string | null) {
  const result = await client.query<{ user_id: string }>(
    `
      UPDATE permission_override
      SET ends_at = now(),
          updated_at = now(),
          reason = CASE
            WHEN $3::text IS NULL OR $3::text = '' THEN reason
            ELSE reason || E'\nRevoked: ' || $3::text
          END
      WHERE tenant_id = $1
        AND id = $2
      RETURNING user_id::text
    `,
    [auth.tenantId, overrideId, reason]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Override not found");
  }
  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: result.rows[0].user_id,
    policyEventType: "permission_override_expired",
    resourceType: "permission_override",
    resourceId: overrideId,
    permissionCode: "settings.permissions.manage",
    result: "allowed",
    details: { reason }
  });
}

export async function createDelegationRecord(client: PoolClient, auth: AuthUser, input: DelegationInput) {
  const roleIdRow = input.roleCode
    ? await client.query<{ id: string }>(`SELECT id::text FROM role WHERE code = $1 LIMIT 1`, [input.roleCode])
    : { rows: [] as Array<{ id: string }> };
  const status = new Date(input.startsAt).getTime() <= Date.now() ? "active" : "pending";
  await client.query(
    `
      INSERT INTO delegation_assignment (
        tenant_id, from_user_id, to_user_id, role_id, permission_bundle_key, scope_type, scope_value,
        starts_at, ends_at, status, reason, approved_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `,
    [
      auth.tenantId,
      input.fromUserId,
      input.toUserId,
      roleIdRow.rows[0]?.id ?? null,
      input.permissionBundleKey,
      input.scopeType,
      input.scopeValue,
      input.startsAt,
      input.endsAt,
      status,
      input.reason,
      auth.id
    ]
  );
  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: input.toUserId,
    policyEventType: "delegation_created",
    resourceType: "delegation_assignment",
    permissionCode: "settings.delegations.manage",
    result: "allowed",
    details: input
  });
}

export async function revokeDelegationRecord(client: PoolClient, auth: AuthUser, delegationId: string, reason: string | null) {
  const result = await client.query<{ to_user_id: string }>(
    `
      UPDATE delegation_assignment
      SET status = 'revoked'::delegation_status_type,
          ends_at = LEAST(ends_at, now()),
          updated_at = now(),
          reason = CASE
            WHEN $3::text IS NULL OR $3::text = '' THEN reason
            ELSE reason || E'\nRevoked: ' || $3::text
          END
      WHERE tenant_id = $1
        AND id = $2
      RETURNING to_user_id::text
    `,
    [auth.tenantId, delegationId, reason]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Delegation not found");
  }
  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: result.rows[0].to_user_id,
    policyEventType: "delegation_revoked",
    resourceType: "delegation_assignment",
    resourceId: delegationId,
    permissionCode: "settings.delegations.manage",
    result: "allowed",
    details: { reason }
  });
}

export async function updateFieldVisibilityRule(client: PoolClient, auth: AuthUser, ruleId: string, input: FieldRuleUpdateInput) {
  const result = await client.query<{ id: string }>(
    `
      UPDATE field_visibility_rule
      SET required_permission_code = $3,
          default_visibility = $4::visibility_state_type,
          masking_strategy = CASE
            WHEN $5::text IS NULL OR $5::text = 'none' THEN NULL
            ELSE $5::masking_strategy_type
          END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id::text
    `,
    [auth.tenantId, ruleId, input.requiredPermissionCode, input.defaultVisibility, input.maskingStrategy]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Field visibility rule not found");
  }
  await writeAuthPolicyAuditEvent(client, auth, {
    policyEventType: "field_visibility_rule_updated",
    resourceType: "field_visibility_rule",
    resourceId: ruleId,
    permissionCode: "settings.field_policies.manage",
    result: "allowed",
    details: input
  });
}

export async function updateSectionVisibilityRule(client: PoolClient, auth: AuthUser, ruleId: string, input: SectionRuleUpdateInput) {
  const result = await client.query<{ id: string }>(
    `
      UPDATE section_visibility_rule
      SET required_permission_code = $3,
          default_visibility = $4::visibility_state_type,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id::text
    `,
    [auth.tenantId, ruleId, input.requiredPermissionCode, input.defaultVisibility]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Section visibility rule not found");
  }
  await writeAuthPolicyAuditEvent(client, auth, {
    policyEventType: "section_visibility_rule_updated",
    resourceType: "section_visibility_rule",
    resourceId: ruleId,
    permissionCode: "settings.field_policies.manage",
    result: "allowed",
    details: input
  });
}

export async function previewAccessPolicy(client: PoolClient, auth: AuthUser, input: PreviewInput): Promise<AccessPolicyPreview> {
  const targetAuth = await loadAuthenticatedUserByUserId(client, auth.tenantId, input.targetUserId);
  if (!targetAuth) {
    throw new ApiError(404, "User not found");
  }
  const hydrated = await hydrateSharedPolicyAccess(client, targetAuth);
  const effectiveTarget: AuthUser = {
    ...targetAuth,
    policyRoles: hydrated.policyRoles,
    policyGrants: hydrated.policyGrants,
    permissions: hydrated.permissionKeys
  };

  const permissions = input.permissionKeys ?? ["dashboard.read"];
  const allowed = permissions.every((permissionKey) => canSharedPolicy(effectiveTarget, permissionKey, input.context ?? {}));
  const fields = input.resourceType ? await getVisibleFields(client, effectiveTarget, input.resourceType, input.context ?? {}) : {};
  const sections = input.resourceType ? await getVisibleSections(client, effectiveTarget, input.resourceType, input.context ?? {}) : {};
  const policy = input.resourceType
    ? await buildSharedResourcePolicySnapshot(
        client,
        effectiveTarget,
        input.resourceType,
        input.context ?? {},
        Object.fromEntries(permissions.map((permissionKey) => [permissionKey, permissionKey]))
      )
    : {
        actions: Object.fromEntries(permissions.map((permissionKey) => [permissionKey, canSharedPolicy(effectiveTarget, permissionKey, input.context ?? {})])),
        reasons: {}
      };

  await writeAuthPolicyAuditEvent(client, auth, {
    targetUserId: input.targetUserId,
    policyEventType: "access_preview",
    resourceType: input.resourceType ?? "route",
    resourceId: input.resourceId ?? input.routeId ?? null,
    permissionCode: "access_preview.use",
    result: "allowed",
    details: {
      routeId: input.routeId,
      permissions
    }
  });
  const trace = await writePolicyDecisionTrace(client, auth, {
    permissionKey: permissions.join(", "),
    resourceType: input.resourceType ?? "route",
    resourceId: input.resourceId ?? input.routeId ?? null,
    scopeContext: {
      route_id: input.routeId ?? null,
      preview_target_user_id: input.targetUserId,
      ...(input.context ?? {})
    },
    decision: allowed ? "allowed" : "denied",
    decisionReason: permissions
      .map((permissionKey) =>
        canSharedPolicy(effectiveTarget, permissionKey, input.context ?? {})
          ? `${permissionKey} allowed in current scope`
          : `${permissionKey} denied in current scope`
      )
      .join(" | "),
    matchedRules: {
      requested_permissions: permissions,
      actions: policy.actions,
      fields,
      sections
    }
  });

  return {
    user_id: input.targetUserId,
    route_id: input.routeId ?? null,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    allowed,
    permissions,
    fields,
    sections,
    actions: policy.actions,
    explanation: permissions.map((permissionKey) =>
      canSharedPolicy(effectiveTarget, permissionKey, input.context ?? {})
        ? `${permissionKey} allowed in current scope`
        : `${permissionKey} denied in current scope`
    ),
    trace_id: trace.id
  };
}
