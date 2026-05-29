import {
  canCreateOrEditShootDepartment,
  hasAuthorityTier,
  hasJobFunctionProfile,
  hasPermissionCode,
  isDepartmentScopedScheduler
} from "../../authz/authority.js";
import { isFieldRole } from "../../authz/policy.js";
import type { AuthUser, DepartmentCode, SharedMaskingStrategy, SharedSensitivityCategory } from "../../types/auth.js";
import type {
  ConciergeAccessScope,
  ConciergeSearchIndexRecord,
  ConciergeSearchPermissionPayload
} from "../../types/concierge.js";
import { getOperatingSystemQueryScope } from "../operatingSystemAccess.js";
import { hasReadScope } from "../jobTruth/jobService.js";
import { canReadTaskDepartment } from "../jobTruth/workTaskService.js";

const JOB_DEPARTMENTS = ["schools", "sports", "corporate", "headshots", "other"] as const;
const WORK_DEPARTMENTS = ["schools", "sports", "production", "photography", "operations", "other"] as const;
const ALL_CONCIERGE_DEPARTMENTS = [
  "schools",
  "sports",
  "production",
  "photography",
  "operations",
  "corporate",
  "headshots",
  "office",
  "customer_service",
  "executive",
  "other",
  "unassigned"
] as const;

type ConciergeAccessOrigin = "shared" | "department" | "assigned" | "principal" | "manager" | "leadership";

type ConciergePermissionRow = Pick<
  ConciergeSearchIndexRecord,
  "entity_type" | "department" | "owner_id" | "assignee_ids" | "permissions_payload" | "primary_date"
>;

export type NormalizedConciergePermissionPayload = ConciergeSearchPermissionPayload & {
  access_scope: ConciergeAccessScope;
  sensitivity: SharedSensitivityCategory;
  allowed_department_codes: string[];
  principal_user_ids: string[];
  manager_user_ids: string[];
  masking_strategy: SharedMaskingStrategy | null;
  allow_snippet_preview: boolean;
  allow_answer_summary: boolean;
};

export type ConciergePermissionDecision = {
  can_access: boolean;
  access_origin: ConciergeAccessOrigin | null;
  access_scope: ConciergeAccessScope;
  sensitivity: SharedSensitivityCategory;
  allow_snippet_preview: boolean;
  allow_answer_summary: boolean;
  masking_strategy: SharedMaskingStrategy | null;
};

function normalizeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function isJobDepartment(value: string | null | undefined): value is (typeof JOB_DEPARTMENTS)[number] {
  return Boolean(value && JOB_DEPARTMENTS.includes(value as (typeof JOB_DEPARTMENTS)[number]));
}

function isWorkDepartment(value: string | null | undefined): value is (typeof WORK_DEPARTMENTS)[number] {
  return Boolean(value && WORK_DEPARTMENTS.includes(value as (typeof WORK_DEPARTMENTS)[number]));
}

function isShootDepartment(value: string | null | undefined): value is DepartmentCode {
  return value === "schools" || value === "sports" || value === "operations" || value === "production" || value === "executive";
}

function hasConciergeLeadershipAccess(auth: AuthUser) {
  return hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]);
}

function hasConciergeManagerAccess(auth: AuthUser, department: string | null | undefined) {
  if (hasConciergeLeadershipAccess(auth) || hasAuthorityTier(auth, "supervisor")) {
    return true;
  }
  if (
    hasJobFunctionProfile(auth, [
      "director_of_photography",
      "director_of_school_photography",
      "director_of_sports_photography",
      "director_of_digital_production",
      "leadership_team_member",
      "leadership_viewer"
    ])
  ) {
    return true;
  }
  if (department && auth.department === department && hasPermissionCode(auth, "attendance.manage")) {
    return true;
  }
  return false;
}

function getShootLikeAccessOrigin(auth: AuthUser, department: string | null | undefined, assigneeIds: string[]): ConciergeAccessOrigin | null {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return "leadership";
  }
  if (hasAuthorityTier(auth, ["read_only_viewer"])) {
    return "department";
  }
  if (department && isShootDepartment(department) && !isFieldRole(auth) && canCreateOrEditShootDepartment(auth, department)) {
    return "department";
  }
  if (isFieldRole(auth) && assigneeIds.includes(auth.id)) {
    return "assigned";
  }
  return null;
}

function getManagerScopeOrigin(
  auth: AuthUser,
  payload: {
    department: string | null;
    manager_user_id: string | null;
    lead_user_ids: string[];
  }
): ConciergeAccessOrigin | null {
  if (hasConciergeLeadershipAccess(auth)) {
    return "leadership";
  }
  if (payload.lead_user_ids.includes(auth.id) || payload.manager_user_id === auth.id) {
    return "manager";
  }
  if (hasConciergeManagerAccess(auth, payload.department)) {
    return "manager";
  }
  return null;
}

function getDepartmentCodes(payload: ConciergeSearchPermissionPayload) {
  const configured = payload.allowed_department_codes ?? [];
  switch (payload.access_model) {
    case "directory":
      return uniqueStrings(configured);
    case "shoot":
      return uniqueStrings([...configured, payload.department]);
    case "production_item":
      return uniqueStrings([...configured, payload.department]);
    case "task":
      return uniqueStrings([...configured, payload.department]);
    case "resource_library_item":
      return uniqueStrings([...configured, payload.department]);
    case "note":
      return uniqueStrings([...configured, payload.department]);
    case "comment":
      return uniqueStrings([...configured, payload.department]);
    case "staffing_assignment":
      return uniqueStrings([...configured, payload.department]);
    case "urgent_watch_alert":
      return uniqueStrings([...configured, payload.scope_department]);
    case "post_shoot_evaluation":
      return uniqueStrings([...configured, payload.department]);
    default:
      return uniqueStrings(configured);
  }
}

function getPrincipalUserIds(payload: ConciergeSearchPermissionPayload) {
  const configured = payload.principal_user_ids ?? [];
  switch (payload.access_model) {
    case "directory":
    case "shoot":
    case "production_item":
      return uniqueStrings(configured);
    case "task":
      return uniqueStrings([...configured, payload.created_by_user_id]);
    case "resource_library_item":
      return uniqueStrings([...configured, payload.uploader_user_id]);
    case "note":
      return uniqueStrings([...configured, payload.assigned_user_id, ...payload.assigned_user_ids]);
    case "comment":
      return uniqueStrings([...configured, ...payload.principal_user_ids]);
    case "staffing_assignment":
      return uniqueStrings([...configured, payload.assigned_user_id, payload.owner_user_id]);
    case "urgent_watch_alert":
      return uniqueStrings([...configured, payload.owner_user_id]);
    case "post_shoot_evaluation":
      return uniqueStrings([...configured, payload.photographer_user_id, ...payload.assigned_user_ids]);
    default:
      return uniqueStrings(configured);
  }
}

function getManagerUserIds(payload: ConciergeSearchPermissionPayload) {
  const configured = payload.manager_user_ids ?? [];
  switch (payload.access_model) {
    case "note":
      return uniqueStrings([...configured, payload.manager_user_id, ...payload.lead_user_ids]);
    case "post_shoot_evaluation":
      return uniqueStrings([...configured, payload.manager_user_id, ...payload.lead_user_ids]);
    default:
      return uniqueStrings(configured);
  }
}

function deriveAccessScope(payload: ConciergeSearchPermissionPayload): ConciergeAccessScope {
  if (payload.access_scope) {
    return payload.access_scope;
  }
  switch (payload.access_model) {
    case "directory":
      return "shared";
    case "shoot":
    case "production_item":
    case "task":
      return "department";
    case "resource_library_item":
      return "shared";
    case "staffing_assignment":
      return payload.department ? "department" : "assigned";
    case "urgent_watch_alert":
      return payload.scope_department ? "department" : "assigned";
    case "note":
      switch (payload.visibility_scope) {
        case "assigned_staff_and_managers":
          return "assigned";
        case "managers_and_leadership":
          return "manager";
        case "leadership_only":
          return "leadership";
        case "object_viewers":
        default:
          return payload.department ? "department" : "shared";
      }
    case "comment":
      switch (payload.visibility) {
        case "manager_only":
          return "manager";
        case "leadership_only":
          return "leadership";
        case "standard_internal":
        default:
          return payload.department ? "department" : "shared";
      }
    case "post_shoot_evaluation":
      return payload.department ? "department" : "assigned";
    default:
      return "shared";
  }
}

function deriveSensitivity(payload: ConciergeSearchPermissionPayload): SharedSensitivityCategory {
  if (payload.sensitivity) {
    return payload.sensitivity;
  }
  switch (payload.access_model) {
    case "directory":
      return "operational_standard";
    case "shoot":
    case "production_item":
    case "task":
    case "staffing_assignment":
    case "urgent_watch_alert":
    case "resource_library_item":
      return "operational_standard";
    case "note":
      switch (payload.visibility_scope) {
        case "leadership_only":
          return "leadership_restricted";
        case "managers_and_leadership":
          return "operational_sensitive";
        case "assigned_staff_and_managers":
          return "personnel_restricted";
        case "object_viewers":
        default:
          return "operational_sensitive";
      }
    case "comment":
      switch (payload.visibility) {
        case "leadership_only":
          return "leadership_restricted";
        case "manager_only":
          return "personnel_restricted";
        case "standard_internal":
        default:
          return "operational_sensitive";
      }
    case "post_shoot_evaluation":
      return "operational_sensitive";
    default:
      return "operational_standard";
  }
}

export function normalizeConciergePermissionPayload(payload: ConciergeSearchPermissionPayload): NormalizedConciergePermissionPayload {
  return {
    ...payload,
    access_scope: deriveAccessScope(payload),
    sensitivity: deriveSensitivity(payload),
    allowed_department_codes: getDepartmentCodes(payload),
    principal_user_ids: getPrincipalUserIds(payload),
    manager_user_ids: getManagerUserIds(payload),
    masking_strategy: payload.masking_strategy ?? null,
    allow_snippet_preview: payload.allow_snippet_preview ?? true,
    allow_answer_summary: payload.allow_answer_summary ?? true
  };
}

function getNoteAccessOrigin(
  auth: AuthUser,
  row: ConciergePermissionRow,
  payload: Extract<ConciergeSearchPermissionPayload, { access_model: "note" }>
): ConciergeAccessOrigin | null {
  const normalized = normalizeConciergePermissionPayload(payload);
  const isAssigned = payload.assigned_user_id === auth.id || payload.assigned_user_ids.includes(auth.id);
  const managerScope = getManagerScopeOrigin(auth, payload);

  if (payload.object_type === "location" && payload.visibility_scope === "object_viewers") {
    return hasPermissionCode(auth, "shoot.read") || hasPermissionCode(auth, "schedule.read") || hasPermissionCode(auth, "shoot_locations.view")
      ? "shared"
      : null;
  }
  if (payload.object_type === "alert" && payload.visibility_scope === "object_viewers") {
    return hasPermissionCode(auth, "alerts.read") ? "shared" : null;
  }

  switch (payload.visibility_scope) {
    case "object_viewers":
      if (payload.object_type === "shoot") {
        return getShootLikeAccessOrigin(auth, payload.department, payload.assigned_user_ids);
      }
      if (payload.object_type === "shift") {
        if (hasConciergeLeadershipAccess(auth)) {
          return "leadership";
        }
        if (isAssigned) {
          return "assigned";
        }
        if (managerScope) {
          return managerScope;
        }
        if (payload.department && isDepartmentScopedScheduler(auth) && auth.department === payload.department) {
          return "department";
        }
      }
      return normalized.access_scope === "shared" ? "shared" : null;
    case "assigned_staff_and_managers":
      if (isAssigned) {
        return "assigned";
      }
      return managerScope;
    case "managers_and_leadership":
      return managerScope;
    case "leadership_only":
      return hasConciergeLeadershipAccess(auth) ? "leadership" : null;
    default:
      return null;
  }
}

function getCommentAccessOrigin(
  auth: AuthUser,
  payload: Extract<ConciergeSearchPermissionPayload, { access_model: "comment" }>
): ConciergeAccessOrigin | null {
  const leadership = hasConciergeLeadershipAccess(auth);
  const manager = hasConciergeManagerAccess(auth, payload.department);
  const inPrincipals = payload.principal_user_ids.includes(auth.id);
  const readScope = payload.department ? hasReadScope(auth, payload.department) : "none";

  if (payload.visibility === "leadership_only") {
    return leadership ? "leadership" : null;
  }
  if (payload.visibility === "manager_only") {
    if (leadership) {
      return "leadership";
    }
    if (inPrincipals) {
      return "principal";
    }
    return manager ? "manager" : null;
  }
  if (leadership) {
    return "leadership";
  }
  if (inPrincipals) {
    return "principal";
  }
  if (readScope !== "none") {
    return "department";
  }
  return null;
}

function getStaffingAssignmentAccessOrigin(
  auth: AuthUser,
  payload: Extract<ConciergeSearchPermissionPayload, { access_model: "staffing_assignment" }>
): ConciergeAccessOrigin | null {
  if (!payload.department) {
    return payload.assigned_user_id === auth.id || payload.owner_user_id === auth.id ? "assigned" : null;
  }
  const scope = hasReadScope(auth, payload.department);
  if (scope === "all") {
    return "department";
  }
  if (scope === "own" && (payload.assigned_user_id === auth.id || payload.owner_user_id === auth.id)) {
    return "assigned";
  }
  return null;
}

function isRecentResourceLibraryItem(primaryDate: string | null | undefined) {
  const normalized = normalizeText(primaryDate);
  if (!normalized) {
    return false;
  }
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  const twoYearsAgo = Date.now() - 1000 * 60 * 60 * 24 * 365 * 2;
  return timestamp >= twoYearsAgo;
}

function getResourceLibraryAccessOrigin(
  auth: AuthUser,
  row: ConciergePermissionRow,
  payload: Extract<ConciergeSearchPermissionPayload, { access_model: "resource_library_item" }>
): ConciergeAccessOrigin | null {
  if (!isFieldRole(auth)) {
    return hasConciergeLeadershipAccess(auth) ? "leadership" : "shared";
  }
  if (payload.approval_status !== "approved" || payload.visibility_scope !== "photographer_prep") {
    return null;
  }
  if (payload.is_best_reference || isRecentResourceLibraryItem(row.primary_date)) {
    return "department";
  }
  return null;
}

function getUrgentWatchAccessOrigin(
  auth: AuthUser,
  payload: Extract<ConciergeSearchPermissionPayload, { access_model: "urgent_watch_alert" }>
): ConciergeAccessOrigin | null {
  const scope = getOperatingSystemQueryScope(auth, "urgent_watch");
  if (scope.level === "none") {
    return null;
  }
  if (scope.level === "all") {
    return "leadership";
  }
  if (scope.level === "department") {
    if (payload.scope_department === auth.department) {
      return "department";
    }
    return payload.owner_user_id === auth.id ? "assigned" : null;
  }
  return payload.owner_user_id === auth.id ? "assigned" : null;
}

function getPostShootEvaluationAccessOrigin(
  auth: AuthUser,
  row: ConciergePermissionRow,
  payload: Extract<ConciergeSearchPermissionPayload, { access_model: "post_shoot_evaluation" }>
): ConciergeAccessOrigin | null {
  if (hasConciergeLeadershipAccess(auth)) {
    return "leadership";
  }
  if (payload.photographer_user_id === auth.id || payload.assigned_user_ids.includes(auth.id)) {
    return "assigned";
  }
  const managerScope = getManagerScopeOrigin(auth, payload);
  if (managerScope) {
    return managerScope;
  }
  return getShootLikeAccessOrigin(auth, payload.department, row.assignee_ids);
}

function canSummarizeFromOrigin(origin: ConciergeAccessOrigin | null, normalized: NormalizedConciergePermissionPayload) {
  if (!origin || !normalized.allow_answer_summary) {
    return false;
  }
  if (normalized.sensitivity === "system_admin_only") {
    return origin === "leadership";
  }
  if (normalized.sensitivity === "leadership_restricted") {
    return origin === "leadership";
  }
  return true;
}

function canPreviewFromOrigin(origin: ConciergeAccessOrigin | null, normalized: NormalizedConciergePermissionPayload) {
  if (!origin || !normalized.allow_snippet_preview) {
    return false;
  }
  if (normalized.sensitivity === "system_admin_only") {
    return origin === "leadership";
  }
  if (normalized.sensitivity === "leadership_restricted") {
    return origin === "leadership";
  }
  return true;
}

export function evaluateConciergeRecordPermission(auth: AuthUser, row: ConciergePermissionRow): ConciergePermissionDecision {
  const normalized = normalizeConciergePermissionPayload(row.permissions_payload);
  let accessOrigin: ConciergeAccessOrigin | null = null;

  switch (row.permissions_payload.access_model) {
    case "directory":
      accessOrigin = "shared";
      break;
    case "task": {
      const department = isWorkDepartment(row.department) ? row.department : null;
      if (department && canReadTaskDepartment(auth, department)) {
        accessOrigin = "department";
      } else if (row.owner_id === auth.id || row.assignee_ids.includes(auth.id)) {
        accessOrigin = "assigned";
      }
      break;
    }
    case "resource_library_item":
      accessOrigin = getResourceLibraryAccessOrigin(auth, row, row.permissions_payload);
      break;
    case "production_item": {
      const department = isJobDepartment(row.department) ? row.department : null;
      if (!department) {
        accessOrigin = null;
      } else {
        const scope = hasReadScope(auth, department);
        if (scope === "all") {
          accessOrigin = "department";
        } else if (scope === "own" && (row.owner_id === auth.id || row.assignee_ids.includes(auth.id))) {
          accessOrigin = "assigned";
        }
      }
      break;
    }
    case "shoot":
      accessOrigin = getShootLikeAccessOrigin(auth, row.department, row.assignee_ids);
      break;
    case "note":
      accessOrigin = getNoteAccessOrigin(auth, row, row.permissions_payload);
      break;
    case "comment":
      accessOrigin = getCommentAccessOrigin(auth, row.permissions_payload);
      break;
    case "staffing_assignment":
      accessOrigin = getStaffingAssignmentAccessOrigin(auth, row.permissions_payload);
      break;
    case "urgent_watch_alert":
      accessOrigin = getUrgentWatchAccessOrigin(auth, row.permissions_payload);
      break;
    case "post_shoot_evaluation":
      accessOrigin = getPostShootEvaluationAccessOrigin(auth, row, row.permissions_payload);
      break;
    default:
      accessOrigin = null;
      break;
  }

  return {
    can_access: accessOrigin !== null,
    access_origin: accessOrigin,
    access_scope: normalized.access_scope,
    sensitivity: normalized.sensitivity,
    allow_snippet_preview: canPreviewFromOrigin(accessOrigin, normalized),
    allow_answer_summary: canSummarizeFromOrigin(accessOrigin, normalized),
    masking_strategy: normalized.masking_strategy
  };
}

export function getReadableConciergeDepartments(auth: AuthUser) {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return [...ALL_CONCIERGE_DEPARTMENTS];
  }

  const departments = new Set<string>();
  for (const department of JOB_DEPARTMENTS) {
    if (hasReadScope(auth, department)) {
      departments.add(department);
    }
  }
  for (const department of WORK_DEPARTMENTS) {
    if (canReadTaskDepartment(auth, department)) {
      departments.add(department);
    }
  }
  const urgentScope = getOperatingSystemQueryScope(auth, "urgent_watch");
  if (urgentScope.department) {
    departments.add(urgentScope.department);
  }
  if (auth.department && auth.department !== "unassigned") {
    departments.add(auth.department);
  }
  return [...departments];
}

export function buildConciergeSqlPermissionClause(auth: AuthUser, startingParamIndex: number) {
  const params: unknown[] = [auth.id, getReadableConciergeDepartments(auth), hasConciergeLeadershipAccess(auth), hasConciergeManagerAccess(auth, null)];
  const userParam = `$${startingParamIndex}`;
  const departmentParam = `$${startingParamIndex + 1}`;
  const leadershipParam = `$${startingParamIndex + 2}`;
  const managerParam = `$${startingParamIndex + 3}`;

  return {
    params,
    clause: `
      AND (
        NOT (g.permissions_payload ? 'access_scope')
        OR g.permissions_payload->>'access_scope' = 'shared'
        OR (
          g.permissions_payload->>'access_scope' = 'department'
          AND (
            g.department = ANY(${departmentParam}::text[])
            OR jsonb_exists_any(COALESCE(g.permissions_payload->'allowed_department_codes', '[]'::jsonb), ${departmentParam}::text[])
            OR g.owner_id = ${userParam}::uuid
            OR ${userParam}::uuid = ANY(COALESCE(g.assignee_ids, ARRAY[]::uuid[]))
            OR jsonb_exists(COALESCE(g.permissions_payload->'principal_user_ids', '[]'::jsonb), ${userParam}::text)
          )
        )
        OR (
          g.permissions_payload->>'access_scope' IN ('assigned', 'private')
          AND (
            g.owner_id = ${userParam}::uuid
            OR ${userParam}::uuid = ANY(COALESCE(g.assignee_ids, ARRAY[]::uuid[]))
            OR jsonb_exists(COALESCE(g.permissions_payload->'principal_user_ids', '[]'::jsonb), ${userParam}::text)
          )
        )
        OR (
          g.permissions_payload->>'access_scope' = 'manager'
          AND (
            ${managerParam}::boolean = true
            OR jsonb_exists(COALESCE(g.permissions_payload->'manager_user_ids', '[]'::jsonb), ${userParam}::text)
            OR jsonb_exists(COALESCE(g.permissions_payload->'principal_user_ids', '[]'::jsonb), ${userParam}::text)
          )
        )
        OR (
          g.permissions_payload->>'access_scope' = 'leadership'
          AND ${leadershipParam}::boolean = true
        )
      )
    `
  };
}
