import type { PoolClient, QueryResultRow } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type {
  AuthUser,
  SharedMaskingStrategy,
  SharedPolicyGrant,
  SharedPolicyScopeType,
  SharedVisibilityState
} from "../../types/auth.js";
import type {
  FieldVisibilityRuleRecord,
  SectionVisibilityRuleRecord,
  SharedResourcePolicySnapshot
} from "../../types/policy.js";
import { getRequestCacheValue, setRequestCacheValue } from "../requestContext.js";
import { writeAuthPolicyAuditEvent } from "./policyAuditService.js";

type PolicyGrantRow = QueryResultRow & {
  permission_code: string;
  role_code: string | null;
  grant_scope_type: SharedPolicyScopeType;
  grant_scope_value: string | null;
  assignment_scope_type: SharedPolicyScopeType;
  assignment_scope_value: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

type OverrideGrantRow = QueryResultRow & {
  permission_code: string;
  scope_type: SharedPolicyScopeType;
  scope_value: string | null;
  effect: "allow" | "deny";
  starts_at: string | null;
  ends_at: string | null;
};

export type PolicyResourceContext = {
  departmentType?: string | null;
  organizationId?: string | null;
  locationId?: string | null;
  ownerUserIds?: Array<string | null | undefined>;
  assignedUserIds?: Array<string | null | undefined>;
  targetUserId?: string | null;
  customScopeValues?: string[] | null;
};

function normalizeIds(values: Array<string | null | undefined> | undefined) {
  return new Set(values?.filter((value): value is string => Boolean(value)) ?? []);
}

function resolveEffectiveScope(
  assignmentScopeType: SharedPolicyScopeType,
  assignmentScopeValue: string | null,
  grantScopeType: SharedPolicyScopeType,
  grantScopeValue: string | null
) {
  if (assignmentScopeType === "global") {
    return { scopeType: grantScopeType, scopeValue: grantScopeValue };
  }
  if (grantScopeType === "global") {
    return { scopeType: assignmentScopeType, scopeValue: assignmentScopeValue };
  }
  if (grantScopeType === assignmentScopeType) {
    return {
      scopeType: grantScopeType,
      scopeValue: grantScopeValue ?? assignmentScopeValue ?? null
    };
  }
  if (["assigned", "owned", "self", "team", "custom"].includes(grantScopeType)) {
    return { scopeType: grantScopeType, scopeValue: grantScopeValue };
  }
  return {
    scopeType: assignmentScopeType,
    scopeValue: assignmentScopeValue ?? grantScopeValue ?? null
  };
}

function matchesScope(auth: AuthUser, scopeType: SharedPolicyScopeType, scopeValue: string | null, context: PolicyResourceContext) {
  const ownerIds = normalizeIds(context.ownerUserIds);
  const assignedIds = normalizeIds(context.assignedUserIds);
  switch (scopeType) {
    case "global":
      return true;
    case "department":
      return Boolean(context.departmentType && scopeValue && context.departmentType === scopeValue);
    case "organization":
      return Boolean(context.organizationId && scopeValue && context.organizationId === scopeValue);
    case "location":
      return Boolean(context.locationId && scopeValue && context.locationId === scopeValue);
    case "owned":
      return ownerIds.has(auth.id);
    case "assigned":
      return assignedIds.has(auth.id);
    case "self":
      return context.targetUserId === auth.id;
    case "team":
      return Boolean(scopeValue && context.customScopeValues?.includes(scopeValue));
    case "custom":
      return Boolean(scopeValue && context.customScopeValues?.includes(scopeValue));
    default:
      return false;
  }
}

function permissionCacheKey(tenantId: string, userId: string) {
  return `policy-access:${tenantId}:${userId}`;
}

function fieldRuleCacheKey(resourceType: string, departmentType: string | null) {
  return `policy-field-rules:${resourceType}:${departmentType ?? "all"}`;
}

function sectionRuleCacheKey(resourceType: string, departmentType: string | null) {
  return `policy-section-rules:${resourceType}:${departmentType ?? "all"}`;
}

export async function hydrateSharedPolicyAccess(
  client: PoolClient,
  auth: Pick<AuthUser, "id" | "tenantId" | "permissions">
): Promise<{ policyRoles: string[]; policyGrants: SharedPolicyGrant[]; permissionKeys: string[] }> {
  const cached = getRequestCacheValue<{ policyRoles: string[]; policyGrants: SharedPolicyGrant[]; permissionKeys: string[] }>(
    permissionCacheKey(auth.tenantId, auth.id)
  );
  if (cached) {
    return cached;
  }

  const roleGrantRows = await client.query<PolicyGrantRow>(
    `
      SELECT
        permission.code AS permission_code,
        role.code AS role_code,
        role_grant.scope_type::text AS grant_scope_type,
        role_grant.scope_value AS grant_scope_value,
        assignment.scope_type::text AS assignment_scope_type,
        assignment.scope_value AS assignment_scope_value,
        assignment.starts_at::text AS starts_at,
        assignment.ends_at::text AS ends_at
      FROM user_role_assignment assignment
      JOIN role ON role.id = assignment.role_id
      JOIN role_permission_grant role_grant ON role_grant.role_id = role.id
      JOIN permission ON permission.id = role_grant.permission_id
      WHERE assignment.tenant_id = $1
        AND assignment.user_id = $2
        AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
        AND (assignment.ends_at IS NULL OR assignment.ends_at >= now())
    `,
    [auth.tenantId, auth.id]
  );
  const overrideRows = await client.query<OverrideGrantRow>(
    `
      SELECT
        permission.code AS permission_code,
        permission_override.scope_type::text AS scope_type,
        permission_override.scope_value,
        permission_override.effect::text AS effect,
        permission_override.starts_at::text AS starts_at,
        permission_override.ends_at::text AS ends_at
      FROM permission_override
      JOIN permission ON permission.id = permission_override.permission_id
      WHERE permission_override.tenant_id = $1
        AND permission_override.user_id = $2
        AND (permission_override.starts_at IS NULL OR permission_override.starts_at <= now())
        AND (permission_override.ends_at IS NULL OR permission_override.ends_at >= now())
    `,
    [auth.tenantId, auth.id]
  );
  const delegationRows = await client.query<PolicyGrantRow>(
    `
      SELECT
        permission.code AS permission_code,
        role.code AS role_code,
        role_grant.scope_type::text AS grant_scope_type,
        role_grant.scope_value AS grant_scope_value,
        delegation.scope_type::text AS assignment_scope_type,
        delegation.scope_value AS assignment_scope_value,
        delegation.starts_at::text AS starts_at,
        delegation.ends_at::text AS ends_at
      FROM delegation_assignment delegation
      JOIN role
        ON role.id = delegation.role_id
        OR role.code = delegation.permission_bundle_key
      JOIN role_permission_grant role_grant ON role_grant.role_id = role.id
      JOIN permission ON permission.id = role_grant.permission_id
      WHERE delegation.tenant_id = $1
        AND delegation.to_user_id = $2
        AND delegation.status = 'active'::delegation_status_type
        AND delegation.starts_at <= now()
        AND delegation.ends_at >= now()
    `,
    [auth.tenantId, auth.id]
  );

  const policyRoles = new Set<string>();
  const policyGrants: SharedPolicyGrant[] = [];

  for (const row of roleGrantRows.rows) {
    policyRoles.add(row.role_code ?? "");
    const resolved = resolveEffectiveScope(
      row.assignment_scope_type,
      row.assignment_scope_value,
      row.grant_scope_type,
      row.grant_scope_value
    );
    policyGrants.push({
      permissionKey: row.permission_code,
      scopeType: resolved.scopeType,
      scopeValue: resolved.scopeValue,
      effect: "allow",
      source: "role",
      roleKey: row.role_code,
      delegationId: null,
      startsAt: row.starts_at,
      endsAt: row.ends_at
    });
  }

  for (const row of delegationRows.rows) {
    if (row.role_code) {
      policyRoles.add(row.role_code);
    }
    const resolved = resolveEffectiveScope(
      row.assignment_scope_type,
      row.assignment_scope_value,
      row.grant_scope_type,
      row.grant_scope_value
    );
    policyGrants.push({
      permissionKey: row.permission_code,
      scopeType: resolved.scopeType,
      scopeValue: resolved.scopeValue,
      effect: "allow",
      source: "delegation",
      roleKey: row.role_code,
      delegationId: row.role_code ? `delegated:${row.role_code}` : "delegated",
      startsAt: row.starts_at,
      endsAt: row.ends_at
    });
  }

  for (const row of overrideRows.rows) {
    policyGrants.push({
      permissionKey: row.permission_code,
      scopeType: row.scope_type,
      scopeValue: row.scope_value,
      effect: row.effect,
      source: "override",
      roleKey: null,
      delegationId: null,
      startsAt: row.starts_at,
      endsAt: row.ends_at
    });
  }

  const permissionKeys = new Set(auth.permissions);
  for (const grant of policyGrants) {
    if (grant.effect === "allow") {
      permissionKeys.add(grant.permissionKey);
    }
  }

  const hydrated = {
    policyRoles: [...policyRoles].filter(Boolean),
    policyGrants,
    permissionKeys: [...permissionKeys]
  };
  setRequestCacheValue(permissionCacheKey(auth.tenantId, auth.id), hydrated);
  return hydrated;
}

export function canSharedPolicy(auth: AuthUser, permissionKey: string, context: PolicyResourceContext = {}) {
  const relevantGrants = auth.policyGrants.filter((grant) => grant.permissionKey === permissionKey);
  if (!relevantGrants.length) {
    return auth.permissions.includes(permissionKey);
  }
  if (relevantGrants.some((grant) => grant.effect === "deny" && matchesScope(auth, grant.scopeType, grant.scopeValue, context))) {
    return false;
  }
  return relevantGrants.some((grant) => grant.effect === "allow" && matchesScope(auth, grant.scopeType, grant.scopeValue, context));
}

export async function assertSharedPolicy(
  client: PoolClient,
  auth: AuthUser,
  permissionKey: string,
  context: PolicyResourceContext = {},
  options: { resourceType?: string | null; resourceId?: string | null; auditOnDeny?: boolean } = {}
) {
  if (canSharedPolicy(auth, permissionKey, context)) {
    return;
  }
  if (options.auditOnDeny) {
    await writeAuthPolicyAuditEvent(client, auth, {
      policyEventType: "permission_denied",
      resourceType: options.resourceType ?? null,
      resourceId: options.resourceId ?? null,
      permissionCode: permissionKey,
      result: "denied",
      details: {
        context
      }
    });
  }
  throw new ApiError(403, "Forbidden");
}

export async function getFieldVisibilityRules(client: PoolClient, resourceType: string, departmentType: string | null) {
  const cached = getRequestCacheValue<FieldVisibilityRuleRecord[]>(fieldRuleCacheKey(resourceType, departmentType));
  if (cached) {
    return cached;
  }
  const result = await client.query<FieldVisibilityRuleRecord>(
    `
      SELECT
        id::text,
        resource_type,
        field_key,
        sensitivity_category::text,
        required_permission_code,
        default_visibility::text,
        masking_strategy::text,
        department_type,
        created_at::text,
        updated_at::text
      FROM field_visibility_rule
      WHERE resource_type = $1
        AND (department_type IS NULL OR department_type = $2)
      ORDER BY department_type NULLS FIRST, field_key ASC
    `,
    [resourceType, departmentType]
  );
  setRequestCacheValue(fieldRuleCacheKey(resourceType, departmentType), result.rows);
  return result.rows;
}

export async function getSectionVisibilityRules(client: PoolClient, resourceType: string, departmentType: string | null) {
  const cached = getRequestCacheValue<SectionVisibilityRuleRecord[]>(sectionRuleCacheKey(resourceType, departmentType));
  if (cached) {
    return cached;
  }
  const result = await client.query<SectionVisibilityRuleRecord>(
    `
      SELECT
        id::text,
        resource_type,
        section_key,
        required_permission_code,
        sensitivity_category::text,
        default_visibility::text,
        department_type,
        created_at::text,
        updated_at::text
      FROM section_visibility_rule
      WHERE resource_type = $1
        AND (department_type IS NULL OR department_type = $2)
      ORDER BY department_type NULLS FIRST, section_key ASC
    `,
    [resourceType, departmentType]
  );
  setRequestCacheValue(sectionRuleCacheKey(resourceType, departmentType), result.rows);
  return result.rows;
}

function elevateVisibility(defaultVisibility: SharedVisibilityState, hasRequiredPermission: boolean): SharedVisibilityState {
  if (!hasRequiredPermission) {
    return defaultVisibility;
  }
  if (defaultVisibility === "hidden" || defaultVisibility === "masked") {
    return "editable";
  }
  return defaultVisibility;
}

export async function getVisibleFields(
  client: PoolClient,
  auth: AuthUser,
  resourceType: string,
  context: PolicyResourceContext = {}
) {
  const rules = await getFieldVisibilityRules(client, resourceType, context.departmentType ?? null);
  const fields: Record<string, SharedVisibilityState> = {};
  for (const rule of rules) {
    const hasRequiredPermission = rule.required_permission_code
      ? canSharedPolicy(auth, rule.required_permission_code, context)
      : false;
    fields[rule.field_key] = elevateVisibility(rule.default_visibility, hasRequiredPermission);
  }
  return fields;
}

export async function getVisibleSections(
  client: PoolClient,
  auth: AuthUser,
  resourceType: string,
  context: PolicyResourceContext = {}
) {
  const rules = await getSectionVisibilityRules(client, resourceType, context.departmentType ?? null);
  const sections: Record<string, SharedVisibilityState> = {};
  for (const rule of rules) {
    const hasRequiredPermission = rule.required_permission_code
      ? canSharedPolicy(auth, rule.required_permission_code, context)
      : false;
    sections[rule.section_key] = elevateVisibility(rule.default_visibility, hasRequiredPermission);
  }
  return sections;
}

export async function buildSharedResourcePolicySnapshot(
  client: PoolClient,
  auth: AuthUser,
  resourceType: string,
  context: PolicyResourceContext,
  actionPermissions: Record<string, string>
): Promise<SharedResourcePolicySnapshot> {
  const fields = await getVisibleFields(client, auth, resourceType, context);
  const sections = await getVisibleSections(client, auth, resourceType, context);
  const actions = Object.fromEntries(
    Object.entries(actionPermissions).map(([actionKey, permissionKey]) => [actionKey, canSharedPolicy(auth, permissionKey, context)])
  );
  return {
    permissions: auth.permissions,
    fields,
    sections,
    actions,
    reasons: Object.fromEntries(
      Object.entries(actionPermissions)
        .filter(([, permissionKey]) => !canSharedPolicy(auth, permissionKey, context))
        .map(([actionKey, permissionKey]) => [actionKey, `Missing ${permissionKey}`])
    )
  };
}

export function maskVisibilityValue(value: unknown, state: SharedVisibilityState, strategy: SharedMaskingStrategy | null) {
  if (state !== "masked") {
    return value;
  }
  if (value == null) {
    return null;
  }
  const text = String(value);
  switch (strategy) {
    case "partial_email": {
      const [localPart, domain] = text.split("@");
      if (!domain || !localPart) {
        return "***";
      }
      return `${localPart.slice(0, 1)}***@${domain}`;
    }
    case "partial_phone":
      return text.length >= 4 ? `(***) ***-${text.slice(-4)}` : "***";
    case "money_summary_only":
      return "Restricted summary only";
    case "initials_only":
      return text
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.slice(0, 1).toUpperCase())
        .join("");
    case "redacted_text":
      return "Redacted";
    default:
      return "***";
  }
}
