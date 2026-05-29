import type { Action } from "./action.js";
import type { PermissionGrant } from "./permission-grant.js";
import type { Resource } from "./resource.js";
import type { Scope } from "./scope.js";

export const AUTHORIZATION_DECISION_REASON_REGISTRY = [
  "allowed",
  "actor_inactive",
  "grant_missing",
  "scope_mismatch",
  "missing_context"
] as const;

export type AuthorizationDecisionReason = (typeof AUTHORIZATION_DECISION_REASON_REGISTRY)[number];

export interface AuthorizationDecision {
  allowed: boolean;
  reason: AuthorizationDecisionReason;
  action: Action;
  resource: Resource;
  evaluatedScope: Scope | null;
  matchedGrant: PermissionGrant | null;
}
