import type { Action } from "./action.js";
import type { Resource } from "./resource.js";

export interface AuthorizationContext {
  action: Action;
  resource: Resource;
  tenantId: string;
  departmentKey?: string | null;
  organizationId?: string | null;
  locationId?: string | null;
  shootId?: string | null;
  ownerActorId?: string | null;
  assignedActorIds?: string[];
  metadata?: Record<string, unknown>;
}
