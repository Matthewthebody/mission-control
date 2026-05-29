import type { Role } from "../auth/role.js";
import type { AvailabilityVisibilityPolicy } from "./availability-visibility-policy.js";
import {
  getAvailabilityVisibilityPolicy,
  roleCanUseAvailabilityVisibilityPolicy
} from "./availability-visibility-policy.js";
import type { AvailabilityVisibilityLevel } from "./availability-visibility-level.js";

export interface AvailabilityVisibilityEvaluationContext {
  actorRoles: Role[];
  actorEmployeeId?: string | null;
  subjectEmployeeId: string;
  sameDepartment?: boolean;
  assignedToSameShoot?: boolean;
  subjectPublishedOnSameShoot?: boolean;
}

export interface AvailabilityVisibilityEvaluationResult {
  allowed: boolean;
  effectiveVisibilityLevel: AvailabilityVisibilityLevel;
  matchedRole: Role | null;
  canViewAvailabilityStatus: boolean;
  canViewCurrentAssignment: boolean;
  canViewTimeWindow: boolean;
  canViewLeadQualification: boolean;
  reason: string;
}

const AVAILABILITY_VISIBILITY_LEVEL_RANK: Record<AvailabilityVisibilityLevel, number> = {
  none: 0,
  self: 1,
  assigned_shoot: 2,
  department: 3,
  organization: 4
};

function resolveHighestAvailabilityVisibilityPolicy(
  actorRoles: Role[]
): { matchedRole: Role | null; policy: AvailabilityVisibilityPolicy | null } {
  let bestRole: Role | null = null;
  let bestPolicy: AvailabilityVisibilityPolicy | null = null;

  for (const role of actorRoles) {
    if (!roleCanUseAvailabilityVisibilityPolicy(role)) {
      continue;
    }

    const policy = getAvailabilityVisibilityPolicy(role);
    if (
      !bestPolicy ||
      AVAILABILITY_VISIBILITY_LEVEL_RANK[policy.visibilityLevel] >
        AVAILABILITY_VISIBILITY_LEVEL_RANK[bestPolicy.visibilityLevel]
    ) {
      bestRole = role;
      bestPolicy = policy;
    }
  }

  return {
    matchedRole: bestRole,
    policy: bestPolicy
  };
}

export function evaluateAvailabilityVisibility(
  context: AvailabilityVisibilityEvaluationContext
): AvailabilityVisibilityEvaluationResult {
  const selfMatch =
    Boolean(context.actorEmployeeId) && String(context.actorEmployeeId) === String(context.subjectEmployeeId);
  const { matchedRole, policy } = resolveHighestAvailabilityVisibilityPolicy(context.actorRoles);

  if (!policy) {
    return {
      allowed: false,
      effectiveVisibilityLevel: "none",
      matchedRole: null,
      canViewAvailabilityStatus: false,
      canViewCurrentAssignment: false,
      canViewTimeWindow: false,
      canViewLeadQualification: false,
      reason: "No actor role grants staffing availability visibility."
    };
  }

  const allowed =
    policy.visibilityLevel === "organization"
      ? true
      : policy.visibilityLevel === "department"
        ? selfMatch || Boolean(context.sameDepartment)
        : policy.visibilityLevel === "assigned_shoot"
          ? selfMatch || (Boolean(context.assignedToSameShoot) && Boolean(context.subjectPublishedOnSameShoot))
          : policy.visibilityLevel === "self"
            ? selfMatch
            : false;

  return {
    allowed,
    effectiveVisibilityLevel: policy.visibilityLevel,
    matchedRole,
    canViewAvailabilityStatus: allowed ? policy.canViewAvailabilityStatus : false,
    canViewCurrentAssignment: allowed ? policy.canViewCurrentAssignment : false,
    canViewTimeWindow: allowed ? policy.canViewTimeWindow : false,
    canViewLeadQualification: allowed ? policy.canViewLeadQualification : false,
    reason: allowed
      ? `Availability visibility allowed through ${matchedRole}.`
      : `Availability visibility denied by ${policy.visibilityLevel} scope rules.`
  };
}
