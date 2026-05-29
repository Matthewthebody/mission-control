import { hasAuthorityTier } from "../../authz/authority.js";
import type { AuthUser, InternalRoleGroup } from "../../types/auth.js";
import { canSharedPolicy, type PolicyResourceContext } from "./policyEngine.js";

export type OperationalPermissionContext = PolicyResourceContext;

function hasAny(values: string[] | undefined, targets: string[]) {
  const normalized = new Set((values ?? []).map((value) => value.trim().toLowerCase()));
  return targets.some((target) => normalized.has(target.trim().toLowerCase()));
}

export function hasInternalRoleGroup(auth: Pick<AuthUser, "internalRoleGroups">, groups: InternalRoleGroup | InternalRoleGroup[]) {
  const requested = Array.isArray(groups) ? groups : [groups];
  return hasAny(auth.internalRoleGroups, requested);
}

export function hasOperationalPermission(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  permissionKey: string,
  context: OperationalPermissionContext = {}
) {
  return auth.permissions.includes(permissionKey) || canSharedPolicy(auth as AuthUser, permissionKey, context);
}

export function hasAnyOperationalPermission(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  permissionKeys: readonly string[],
  context: OperationalPermissionContext = {}
) {
  return permissionKeys.some((permissionKey) => hasOperationalPermission(auth, permissionKey, context));
}

export function withDepartmentContext(
  departmentType: string | null | undefined,
  context: OperationalPermissionContext = {}
): OperationalPermissionContext {
  return {
    ...context,
    departmentType: context.departmentType ?? departmentType ?? null
  };
}

export function canViewRecords(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  entityType: "job" | "task" | "production" | "organization" | "contact" | "location",
  context: OperationalPermissionContext = {}
) {
  const permissionMap = {
    job: "job.read",
    task: "task.read",
    production: "production.read",
    organization: "organization.read",
    contact: "contact.read",
    location: "location.read"
  } as const;
  return hasOperationalPermission(auth, permissionMap[entityType], context);
}

export function canEditRecords(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  entityType: "job" | "task" | "production" | "organization" | "contact" | "location",
  context: OperationalPermissionContext = {}
) {
  const permissionMap = {
    job: ["job.update", "job.create"],
    task: ["task.update", "task.create"],
    production: ["production.update", "production.create"],
    organization: ["organization.update", "organization.create"],
    contact: ["contact.update", "contact.create"],
    location: ["location.update", "location.create"]
  } as const;
  return hasAnyOperationalPermission(auth, permissionMap[entityType], context);
}

export function canAssignStaff(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasOperationalPermission(auth, "job.assign_staff", context);
}

export function canApproveExceptions(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasAnyOperationalPermission(auth, ["exception.approve", "approval.manage"], context);
}

export function canChangeStatuses(
  auth: Pick<AuthUser, "permissions" | "policyGrants">,
  entityType: "job" | "task" | "production",
  context: OperationalPermissionContext = {}
) {
  const permissionMap = {
    job: ["job.status.change", "job.update", "job.publish", "job.cancel", "job.archive"],
    task: ["task.status.change", "task.update"],
    production: ["production.status.change", "production.update", "production.mark_blocked"]
  } as const;
  return hasAnyOperationalPermission(auth, permissionMap[entityType], context);
}

export function canViewOperationalNotes(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasOperationalPermission(auth, "note.read", context);
}

export function canCreateOperationalNotes(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasAnyOperationalPermission(auth, ["note.create", "note.update"], context);
}

export function canUpdateOperationalNotes(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasOperationalPermission(auth, "note.update", context);
}

export function canArchiveOperationalNotes(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasAnyOperationalPermission(auth, ["note.archive", "note.update"], context);
}

export function canPublishOperationalNotes(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasAnyOperationalPermission(auth, ["note.publish", "note.update"], context);
}

export function canViewSensitiveOperationalNotes(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "internalRoleGroups" | "authorityTier">,
  context: OperationalPermissionContext = {}
) {
  return (
    hasOperationalPermission(auth, "note.read_sensitive", context) ||
    hasInternalRoleGroup(auth, ["system_admin", "leadership"]) ||
    hasAuthorityTier(auth as AuthUser, ["super_admin", "leadership", "director_admin"])
  );
}

export function canViewPostShootEvaluations(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasOperationalPermission(auth, "evaluation.read", context);
}

export function canCreatePostShootEvaluations(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasAnyOperationalPermission(auth, ["evaluation.create", "evaluation.update"], context);
}

export function canUpdatePostShootEvaluations(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasOperationalPermission(auth, "evaluation.update", context);
}

export function canReviewPostShootEvaluations(auth: Pick<AuthUser, "permissions" | "policyGrants">, context: OperationalPermissionContext = {}) {
  return hasAnyOperationalPermission(auth, ["evaluation.review", "evaluation.read_sensitive", "approval.manage"], context);
}

export function canViewSensitivePostShootEvaluations(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "internalRoleGroups" | "authorityTier">,
  context: OperationalPermissionContext = {}
) {
  return (
    hasOperationalPermission(auth, "evaluation.read_sensitive", context) ||
    hasInternalRoleGroup(auth, ["system_admin", "leadership"]) ||
    hasAuthorityTier(auth as AuthUser, ["super_admin", "leadership", "director_admin"])
  );
}

export function canConfigureSystemBehavior(
  auth: Pick<AuthUser, "permissions" | "policyGrants" | "internalRoleGroups" | "authorityTier">
) {
  return (
    hasAnyOperationalPermission(auth, ["system.configure", "settings.permissions.manage", "settings.update", "security.manage"]) ||
    hasInternalRoleGroup(auth, "system_admin") ||
    hasAuthorityTier(auth as AuthUser, "super_admin")
  );
}
