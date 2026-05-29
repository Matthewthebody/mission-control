import type { PermissionGrant } from "./permission-grant.js";
import type { Role } from "./role.js";

export const AUTHORIZATION_ACTOR_TYPE_REGISTRY = ["user", "system", "integration"] as const;

export type AuthorizationActorType = (typeof AUTHORIZATION_ACTOR_TYPE_REGISTRY)[number];

export interface AuthorizationActor {
  actorId: string;
  actorType: AuthorizationActorType;
  tenantId: string;
  active: boolean;
  roles: Role[];
  grants: PermissionGrant[];
  departmentKey?: string | null;
}
