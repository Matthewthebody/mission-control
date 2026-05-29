import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { assertShootStatusApprovalRights, getApprovalLevelLabel, resolveAttendanceApprovalLevel, resolvePhase1RoleGroup, resolveStaffingApprovalLevel } from "../src/services/approvalRights.js";
import type { AuthUser, AuthorityTier, DepartmentCode, JobFunctionProfile } from "../src/types/auth.js";

function buildAuth(input: {
  authorityTier: AuthorityTier;
  department?: DepartmentCode;
  primaryJobFunctionProfile?: JobFunctionProfile;
  jobFunctionProfiles?: JobFunctionProfile[];
  permissions?: string[];
}): AuthUser {
  const primaryJobFunctionProfile = input.primaryJobFunctionProfile ?? "customer_service_rep";
  return {
    id: "user-1",
    tenantId: "tenant-1",
    accountId: null,
    sessionId: "session-1",
    email: "user@example.com",
    fullName: "Test User",
    status: "active",
    department: input.department ?? "office",
    isEmailVerified: true,
    authVersion: 1,
    authorityTier: input.authorityTier,
    primaryJobFunctionProfile,
    jobFunctionProfiles: input.jobFunctionProfiles ?? [primaryJobFunctionProfile],
    permissionGrants: [],
    effectiveScopes: [],
    roles: [],
    permissions: input.permissions ?? [],
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
    }
  };
}

const fakeClient = {} as PoolClient;

describe("approval rights", () => {
  it("maps Phase 1 business role groups from existing authority and profile signals", () => {
    expect(resolvePhase1RoleGroup(buildAuth({ authorityTier: "super_admin" }))).toBe("system_admin_owner");
    expect(resolvePhase1RoleGroup(buildAuth({ authorityTier: "leadership", primaryJobFunctionProfile: "leadership_team_member" }))).toBe(
      "leadership"
    );
    expect(
      resolvePhase1RoleGroup(
        buildAuth({
          authorityTier: "supervisor",
          primaryJobFunctionProfile: "schools_client_success"
        })
      )
    ).toBe("department_manager_coordinator");
    expect(
      resolvePhase1RoleGroup(
        buildAuth({
          authorityTier: "standard_employee",
          primaryJobFunctionProfile: "director_of_digital_production"
        })
      )
    ).toBe("production_lead");
  });

  it("allows a manager-level ready override only with a reason and records it as level 2", async () => {
    const manager = buildAuth({
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "schools_client_success"
    });

    await expect(
      assertShootStatusApprovalRights(fakeClient, manager, {
        shootId: "shoot-1",
        currentStatus: "CONFIRMED",
        nextStatus: "READY",
        readyEligible: false,
        reason: null
      })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      assertShootStatusApprovalRights(fakeClient, manager, {
        shootId: "shoot-1",
        currentStatus: "CONFIRMED",
        nextStatus: "READY",
        readyEligible: false,
        reason: "Roster delivery is delayed, but operations approved the readiness exception."
      })
    ).resolves.toMatchObject({
      approvalLevel: 2,
      readinessOverrideApplied: true,
      dangerousActionCode: null
    });
  });

  it("keeps cancellation leadership-controlled in Phase 1", async () => {
    const manager = buildAuth({
      authorityTier: "supervisor",
      primaryJobFunctionProfile: "schools_client_success"
    });
    const leadership = buildAuth({
      authorityTier: "leadership",
      primaryJobFunctionProfile: "leadership_team_member"
    });

    await expect(
      assertShootStatusApprovalRights(fakeClient, manager, {
        shootId: "shoot-1",
        currentStatus: "CONFIRMED",
        nextStatus: "CANCELLED",
        readyEligible: true,
        reason: "Customer canceled the event."
      })
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      assertShootStatusApprovalRights(fakeClient, leadership, {
        shootId: "shoot-1",
        currentStatus: "CONFIRMED",
        nextStatus: "CANCELLED",
        readyEligible: true,
        reason: "Customer canceled the event."
      })
    ).resolves.toMatchObject({
      approvalLevel: 3,
      dangerousActionCode: "cancel_operational_shoot"
    });
  });

  it("allows production work to move into post-production but protects reopen from complete", async () => {
    const productionLead = buildAuth({
      authorityTier: "standard_employee",
      department: "production",
      primaryJobFunctionProfile: "director_of_digital_production"
    });

    await expect(
      assertShootStatusApprovalRights(fakeClient, productionLead, {
        shootId: "shoot-1",
        currentStatus: "SHOOT_COMPLETE",
        nextStatus: "POST_PRODUCTION",
        readyEligible: true,
        reason: null
      })
    ).resolves.toMatchObject({
      approvalLevel: 1
    });

    await expect(
      assertShootStatusApprovalRights(fakeClient, productionLead, {
        shootId: "shoot-1",
        currentStatus: "COMPLETE",
        nextStatus: "POST_PRODUCTION",
        readyEligible: true,
        reason: "Need to reopen the final package."
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("labels staffing and attendance approval levels consistently", () => {
    expect(
      getApprovalLevelLabel(
        resolveStaffingApprovalLevel({
          insideProtectedWindow: true,
          leadAssignmentChange: false,
          warningOverride: false,
          conflictOverride: false
        })
      )
    ).toBe("level_2_manager_approval");

    expect(
      getApprovalLevelLabel(
        resolveAttendanceApprovalLevel({
          protectedHistoryEdit: true,
          exceptionReview: false
        })
      )
    ).toBe("level_3_leadership_or_admin_approval");
  });
});
