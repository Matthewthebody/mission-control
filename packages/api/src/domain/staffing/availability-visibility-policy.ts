import type { Role } from "../auth/role.js";
import { ROLE_REGISTRY } from "../auth/role.js";
import { roleHasStaffingCapability } from "./staffing-authority-policy.js";
import type { AvailabilityVisibilityLevel } from "./availability-visibility-level.js";

export interface AvailabilityVisibilityPolicy {
  role: Role;
  visibilityLevel: AvailabilityVisibilityLevel;
  requiresAvailabilityCapability: boolean;
  canViewAvailabilityStatus: boolean;
  canViewCurrentAssignment: boolean;
  canViewTimeWindow: boolean;
  canViewLeadQualification: boolean;
  description: string;
}

export const AVAILABILITY_VISIBILITY_POLICY_REGISTRY: AvailabilityVisibilityPolicy[] = [
  {
    role: "super_admin",
    visibilityLevel: "organization",
    requiresAvailabilityCapability: true,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: true,
    description: "Super admins can inspect availability visibility across the organization."
  },
  {
    role: "leadership",
    visibilityLevel: "organization",
    requiresAvailabilityCapability: true,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: true,
    description: "Leadership can inspect staffing availability across the organization."
  },
  {
    role: "director_admin",
    visibilityLevel: "organization",
    requiresAvailabilityCapability: true,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: true,
    description: "Directors can inspect organization-wide staffing availability."
  },
  {
    role: "assistant_manager",
    visibilityLevel: "department",
    requiresAvailabilityCapability: true,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: true,
    description: "Assistant managers can inspect staffing availability within their department."
  },
  {
    role: "staffing_coordinator",
    visibilityLevel: "department",
    requiresAvailabilityCapability: true,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: true,
    description: "Staffing coordinators can inspect staffing availability within their department."
  },
  {
    role: "customer_service",
    visibilityLevel: "none",
    requiresAvailabilityCapability: false,
    canViewAvailabilityStatus: false,
    canViewCurrentAssignment: false,
    canViewTimeWindow: false,
    canViewLeadQualification: false,
    description: "Customer service does not receive staffing availability visibility by default."
  },
  {
    role: "photographer",
    visibilityLevel: "self",
    requiresAvailabilityCapability: false,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: false,
    description: "Photographers can inspect their own availability without gaining staffing-board visibility."
  },
  {
    role: "graphic_artist",
    visibilityLevel: "self",
    requiresAvailabilityCapability: false,
    canViewAvailabilityStatus: true,
    canViewCurrentAssignment: true,
    canViewTimeWindow: true,
    canViewLeadQualification: false,
    description: "Graphic artists can inspect their own availability without cross-employee visibility."
  },
  {
    role: "read_only_viewer",
    visibilityLevel: "none",
    requiresAvailabilityCapability: false,
    canViewAvailabilityStatus: false,
    canViewCurrentAssignment: false,
    canViewTimeWindow: false,
    canViewLeadQualification: false,
    description: "Read-only viewers do not receive staffing availability visibility."
  },
  {
    role: "integration_service",
    visibilityLevel: "none",
    requiresAvailabilityCapability: false,
    canViewAvailabilityStatus: false,
    canViewCurrentAssignment: false,
    canViewTimeWindow: false,
    canViewLeadQualification: false,
    description: "Integration services do not receive human-facing availability visibility."
  }
];

const AVAILABILITY_VISIBILITY_POLICY_BY_ROLE = new Map<Role, AvailabilityVisibilityPolicy>(
  AVAILABILITY_VISIBILITY_POLICY_REGISTRY.map((policy) => [policy.role, policy])
);

export function getAvailabilityVisibilityPolicy(role: Role): AvailabilityVisibilityPolicy {
  return (
    AVAILABILITY_VISIBILITY_POLICY_BY_ROLE.get(role) ?? {
      role,
      visibilityLevel: "none",
      requiresAvailabilityCapability: false,
      canViewAvailabilityStatus: false,
      canViewCurrentAssignment: false,
      canViewTimeWindow: false,
      canViewLeadQualification: false,
      description: "No availability visibility policy has been assigned for this role."
    }
  );
}

export function roleCanUseAvailabilityVisibilityPolicy(role: Role): boolean {
  const policy = getAvailabilityVisibilityPolicy(role);
  if (!policy.requiresAvailabilityCapability) {
    return policy.visibilityLevel !== "none";
  }
  return roleHasStaffingCapability(role, "view_staffing_availability");
}

export function getRolesWithAvailabilityVisibilityLevel(
  visibilityLevel: AvailabilityVisibilityLevel
): Role[] {
  return ROLE_REGISTRY.filter((role) => getAvailabilityVisibilityPolicy(role).visibilityLevel === visibilityLevel);
}
