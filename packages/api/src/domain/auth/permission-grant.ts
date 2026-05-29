import type { Action } from "./action.js";
import type { Resource } from "./resource.js";
import type { Role } from "./role.js";
import type { Scope } from "./scope.js";

export interface PermissionGrant {
  role: Role;
  action: Action;
  resource: Resource;
  scope: Scope;
  description?: string;
}
