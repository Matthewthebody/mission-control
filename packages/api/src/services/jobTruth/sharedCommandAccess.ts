import {
  canManageSchoolsHub,
  canManageSportsWorkspace,
  canViewLeadershipReports,
  getSchoolsHubAccessScope,
  getSportsWorkspaceAccessScope,
  hasAuthorityTier
} from "../../authz/authority.js";
import type { JobDepartmentType } from "../../domain/jobTruth/index.js";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { canSharedPolicy } from "../policy/policyEngine.js";

export type SharedDepartmentScope = "all" | "own" | null;

function hasDepartmentScopedGrant(auth: AuthUser, permissionKey: string, department: JobDepartmentType) {
  return auth.policyGrants.some(
    (grant) =>
      grant.permissionKey === permissionKey &&
      grant.effect === "allow" &&
      (grant.scopeType === "global" || (grant.scopeType === "department" && (!grant.scopeValue || grant.scopeValue === department)))
  );
}

function hasOwnScopedGrant(auth: AuthUser, permissionKey: string) {
  return auth.policyGrants.some(
    (grant) =>
      grant.permissionKey === permissionKey &&
      grant.effect === "allow" &&
      ["assigned", "owned", "self"].includes(grant.scopeType)
  );
}

export function getSharedDepartmentReadScope(auth: AuthUser, department: JobDepartmentType): SharedDepartmentScope {
  if (hasDepartmentScopedGrant(auth, "job.read", department)) {
    return "all";
  }
  if (hasOwnScopedGrant(auth, "job.read")) {
    return "own";
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return "all";
  }
  if (department === "schools") {
    return getSchoolsHubAccessScope(auth);
  }
  if (department === "sports") {
    return getSportsWorkspaceAccessScope(auth);
  }
  return canViewLeadershipReports(auth) ? "all" : null;
}

export function hasSharedDepartmentManageAccess(auth: AuthUser, department: JobDepartmentType) {
  if (hasDepartmentScopedGrant(auth, "job.update", department) || hasDepartmentScopedGrant(auth, "job.publish", department)) {
    return true;
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  if (department === "schools") {
    return canManageSchoolsHub(auth);
  }
  if (department === "sports") {
    return canManageSportsWorkspace(auth);
  }
  return canViewLeadershipReports(auth);
}

export function getReadableJobDepartments(auth: AuthUser): JobDepartmentType[] {
  return (["schools", "sports", "corporate", "headshots", "other"] as JobDepartmentType[]).filter(
    (department) => getSharedDepartmentReadScope(auth, department) != null
  );
}

export function assertCanReadSharedDepartment(auth: AuthUser, department: JobDepartmentType) {
  if (!getSharedDepartmentReadScope(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
}

export function assertCanManageSharedDepartment(auth: AuthUser, department: JobDepartmentType) {
  if (!hasSharedDepartmentManageAccess(auth, department)) {
    throw new ApiError(403, "Forbidden");
  }
}

export function canAccessSharedCommandLayer(auth: AuthUser) {
  return canSharedPolicy(auth, "dashboard.read") || getReadableJobDepartments(auth).length > 0;
}

export function canAccessExecutiveCommandLayer(auth: AuthUser) {
  return canSharedPolicy(auth, "executive.read") || hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) || canViewLeadershipReports(auth);
}
