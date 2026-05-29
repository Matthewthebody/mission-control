import { describe, expect, it } from "vitest";
import {
  ACTION_REGISTRY,
  AUTHORIZATION_ACTOR_TYPE_REGISTRY,
  AUTHORIZATION_DECISION_REASON_REGISTRY,
  RESOURCE_REGISTRY,
  ROLE_REGISTRY,
  SCOPE_REGISTRY,
  isAction,
  isResource,
  isRole,
  isScope,
  type AuthorizationActor,
  type AuthorizationContext,
  type AuthorizationDecision,
  type PermissionGrant
} from "../src/domain/auth/index.js";

describe("authorization domain phase 1A foundations", () => {
  it("exposes deterministic registries without duplicates", () => {
    expect(new Set(ROLE_REGISTRY).size).toBe(ROLE_REGISTRY.length);
    expect(new Set(ACTION_REGISTRY).size).toBe(ACTION_REGISTRY.length);
    expect(new Set(RESOURCE_REGISTRY).size).toBe(RESOURCE_REGISTRY.length);
    expect(new Set(SCOPE_REGISTRY).size).toBe(SCOPE_REGISTRY.length);
    expect(new Set(AUTHORIZATION_ACTOR_TYPE_REGISTRY).size).toBe(AUTHORIZATION_ACTOR_TYPE_REGISTRY.length);
    expect(new Set(AUTHORIZATION_DECISION_REASON_REGISTRY).size).toBe(AUTHORIZATION_DECISION_REASON_REGISTRY.length);
  });

  it("provides runtime guards for canonical authorization primitives", () => {
    expect(isRole("leadership")).toBe(true);
    expect(isRole("unknown_role")).toBe(false);

    expect(isAction("approve")).toBe(true);
    expect(isAction("launch")).toBe(false);

    expect(isResource("shoot")).toBe(true);
    expect(isResource("random_resource")).toBe(false);

    expect(isScope("assigned_shoot")).toBe(true);
    expect(isScope("wildcard")).toBe(false);
  });

  it("supports actor, context, grant, and decision model composition", () => {
    const grant: PermissionGrant = {
      role: "leadership",
      action: "approve",
      resource: "approval_request",
      scope: "global",
      description: "Leadership can approve operational requests."
    };

    const actor: AuthorizationActor = {
      actorId: "actor-123",
      actorType: "user",
      tenantId: "tenant-123",
      active: true,
      roles: ["leadership"],
      grants: [grant],
      departmentKey: "operations"
    };

    const context: AuthorizationContext = {
      action: "approve",
      resource: "approval_request",
      tenantId: "tenant-123",
      departmentKey: "operations",
      shootId: "shoot-123"
    };

    const decision: AuthorizationDecision = {
      allowed: true,
      reason: "allowed",
      action: context.action,
      resource: context.resource,
      evaluatedScope: grant.scope,
      matchedGrant: grant
    };

    expect(actor.grants[0].resource).toBe("approval_request");
    expect(context.action).toBe("approve");
    expect(decision.allowed).toBe(true);
    expect(decision.matchedGrant?.role).toBe("leadership");
  });
});
