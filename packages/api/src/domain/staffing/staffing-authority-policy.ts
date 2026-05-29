import type { Role } from "../auth/role.js";
import { ROLE_REGISTRY } from "../auth/role.js";
import type { StaffingCapability } from "./staffing-capability.js";

export const STAFFING_AUTHORITY_SCOPE_REGISTRY = ["none", "department", "organization"] as const;

export type StaffingAuthorityScope = (typeof STAFFING_AUTHORITY_SCOPE_REGISTRY)[number];

export interface StaffingAuthorityPolicy {
  role: Role;
  scope: StaffingAuthorityScope;
  capabilities: StaffingCapability[];
  description: string;
}

const STAFFING_AUTHORITY_SCOPE_SET = new Set<string>(STAFFING_AUTHORITY_SCOPE_REGISTRY);

const ALL_STAFFING_CAPABILITIES: StaffingCapability[] = [
  "view_staffing_dashboard",
  "view_staffing_board",
  "view_staffing_availability",
  "view_staffing_templates",
  "manage_staffing_templates",
  "assign_staffing_assignment",
  "publish_staffing",
  "override_staffing_conflict",
  "override_staffing_warnings"
];

export const STAFFING_AUTHORITY_POLICY_REGISTRY: StaffingAuthorityPolicy[] = [
  {
    role: "super_admin",
    scope: "organization",
    capabilities: ALL_STAFFING_CAPABILITIES,
    description: "Super admins can view, manage, publish, and override staffing across the organization."
  },
  {
    role: "leadership",
    scope: "organization",
    capabilities: ALL_STAFFING_CAPABILITIES,
    description: "Leadership can operate the staffing system organization-wide, including warning and conflict overrides."
  },
  {
    role: "director_admin",
    scope: "organization",
    capabilities: ALL_STAFFING_CAPABILITIES,
    description: "Directors can fully manage staffing operations, including publishing and override decisions."
  },
  {
    role: "assistant_manager",
    scope: "department",
    capabilities: [
      "view_staffing_dashboard",
      "view_staffing_board",
      "view_staffing_availability",
      "view_staffing_templates",
      "manage_staffing_templates",
      "assign_staffing_assignment",
      "publish_staffing"
    ],
    description: "Assistant managers can run department staffing workflows but cannot use leadership-grade overrides."
  },
  {
    role: "staffing_coordinator",
    scope: "department",
    capabilities: [
      "view_staffing_dashboard",
      "view_staffing_board",
      "view_staffing_availability",
      "view_staffing_templates",
      "manage_staffing_templates",
      "assign_staffing_assignment",
      "publish_staffing"
    ],
    description: "Staffing coordinators can manage day-to-day staffing and publication for their department."
  },
  {
    role: "customer_service",
    scope: "department",
    capabilities: ["view_staffing_dashboard", "view_staffing_board", "view_staffing_templates"],
    description: "Customer service can review staffing visibility relevant to client operations but cannot change assignments."
  },
  {
    role: "photographer",
    scope: "none",
    capabilities: [],
    description: "Photographers do not receive staffing-operations capabilities through this policy layer."
  },
  {
    role: "graphic_artist",
    scope: "none",
    capabilities: [],
    description: "Graphic artists do not receive staffing-operations capabilities through this policy layer."
  },
  {
    role: "read_only_viewer",
    scope: "organization",
    capabilities: ["view_staffing_dashboard", "view_staffing_board", "view_staffing_templates"],
    description: "Read-only viewers can inspect staffing surfaces without making operational changes."
  },
  {
    role: "integration_service",
    scope: "none",
    capabilities: [],
    description: "Integration services do not receive staffing-operations authority through this human-role policy registry."
  }
];

const STAFFING_AUTHORITY_POLICY_BY_ROLE = new Map<Role, StaffingAuthorityPolicy>(
  STAFFING_AUTHORITY_POLICY_REGISTRY.map((policy) => [policy.role, policy])
);

export function isStaffingAuthorityScope(value: string): value is StaffingAuthorityScope {
  return STAFFING_AUTHORITY_SCOPE_SET.has(value);
}

export function getStaffingAuthorityPolicy(role: Role): StaffingAuthorityPolicy {
  return (
    STAFFING_AUTHORITY_POLICY_BY_ROLE.get(role) ?? {
      role,
      scope: "none",
      capabilities: [],
      description: "No staffing authority policy has been assigned for this role."
    }
  );
}

export function getStaffingCapabilitiesForRole(role: Role): StaffingCapability[] {
  return getStaffingAuthorityPolicy(role).capabilities;
}

export function roleHasStaffingCapability(role: Role, capability: StaffingCapability): boolean {
  return getStaffingCapabilitiesForRole(role).includes(capability);
}

export function getRolesWithStaffingCapability(capability: StaffingCapability): Role[] {
  return ROLE_REGISTRY.filter((role) => roleHasStaffingCapability(role, capability));
}

export function getStaffingAuthorityScope(role: Role): StaffingAuthorityScope {
  return getStaffingAuthorityPolicy(role).scope;
}
