import { describe, expect, it } from "vitest";
import type { AuthUser, SharedPolicyGrant } from "../src/types/auth.js";
import {
  canApproveExceptions,
  canAssignStaff,
  canChangeStatuses,
  canConfigureSystemBehavior,
  canViewSensitiveOperationalNotes,
  canViewSensitivePostShootEvaluations,
  withDepartmentContext
} from "../src/services/policy/index.js";

function createGrant(permissionKey: string, scopeType: SharedPolicyGrant["scopeType"], scopeValue: string | null): SharedPolicyGrant {
  return {
    permissionKey,
    scopeType,
    scopeValue,
    effect: "allow",
    source: "role",
    roleKey: "test_role",
    delegationId: null,
    startsAt: null,
    endsAt: null
  };
}

function createAuth(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    accountId: "account-1",
    sessionId: "session-1",
    email: "user@example.com",
    fullName: "User Example",
    status: "active",
    department: "schools",
    isEmailVerified: true,
    authVersion: 1,
    authorityTier: "standard_employee",
    jobFunctionProfiles: ["schools_client_success"],
    primaryJobFunctionProfile: "schools_client_success",
    permissionGrants: [],
    policyGrants: [],
    policyRoles: [],
    internalRoleGroups: [],
    effectiveScopes: [],
    roles: ["office_employee"],
    permissions: [],
    sessionTrust: {
      identityProvider: "local_password",
      sessionAssurance: "standard",
      requestTransport: "bearer",
      elevatedUntil: null,
      privilegedModeUntil: null,
      breakGlassStartedAt: null,
      breakGlassUntil: null,
      breakGlassReason: null,
      breakGlassScopeType: null,
      breakGlassScopeId: null,
      elevatedSessionActive: false,
      privilegedModeActive: false,
      breakGlassModeActive: false
    },
    ...overrides
  };
}

describe("operational authorization helpers", () => {
  it("honors department scoped role grants for staffing, status changes, and approvals", () => {
    const auth = createAuth({
      policyGrants: [
        createGrant("job.assign_staff", "department", "schools"),
        createGrant("job.status.change", "department", "schools"),
        createGrant("exception.approve", "department", "schools")
      ]
    });

    expect(canAssignStaff(auth, withDepartmentContext("schools"))).toBe(true);
    expect(canAssignStaff(auth, withDepartmentContext("sports"))).toBe(false);
    expect(canChangeStatuses(auth, "job", withDepartmentContext("schools"))).toBe(true);
    expect(canChangeStatuses(auth, "job", withDepartmentContext("sports"))).toBe(false);
    expect(canApproveExceptions(auth, withDepartmentContext("schools"))).toBe(true);
    expect(canApproveExceptions(auth, withDepartmentContext("sports"))).toBe(false);
  });

  it("allows sensitive notes and evaluations only for explicitly privileged access", () => {
    const leadershipAuth = createAuth({
      authorityTier: "supervisor",
      internalRoleGroups: ["leadership"]
    });
    const standardAuth = createAuth();

    expect(canViewSensitiveOperationalNotes(leadershipAuth)).toBe(true);
    expect(canViewSensitivePostShootEvaluations(leadershipAuth)).toBe(true);
    expect(canViewSensitiveOperationalNotes(standardAuth)).toBe(false);
    expect(canViewSensitivePostShootEvaluations(standardAuth)).toBe(false);
  });

  it("keeps system configuration behind explicit privileged roles or permissions", () => {
    const systemAdmin = createAuth({
      internalRoleGroups: ["system_admin"]
    });
    const settingsManager = createAuth({
      permissions: ["settings.update"]
    });
    const standardAuth = createAuth();

    expect(canConfigureSystemBehavior(systemAdmin)).toBe(true);
    expect(canConfigureSystemBehavior(settingsManager)).toBe(true);
    expect(canConfigureSystemBehavior(standardAuth)).toBe(false);
  });
});
