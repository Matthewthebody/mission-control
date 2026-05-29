import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/adminSettings.js", () => ({
  resolveRuntimeAdminSettingValue: vi.fn(async () => null)
}));

type MicrosoftEntraContractsModule = typeof import("../src/services/microsoftEntraContracts.js");

let extractMicrosoftEntraClaimsSnapshot: MicrosoftEntraContractsModule["extractMicrosoftEntraClaimsSnapshot"];
let isMicrosoftEntraStepUpSatisfied: MicrosoftEntraContractsModule["isMicrosoftEntraStepUpSatisfied"];
let resolveMicrosoftEntraAuthorization: MicrosoftEntraContractsModule["resolveMicrosoftEntraAuthorization"];

beforeAll(async () => {
  const module = await import("../src/services/microsoftEntraContracts.js");
  extractMicrosoftEntraClaimsSnapshot = module.extractMicrosoftEntraClaimsSnapshot;
  isMicrosoftEntraStepUpSatisfied = module.isMicrosoftEntraStepUpSatisfied;
  resolveMicrosoftEntraAuthorization = module.resolveMicrosoftEntraAuthorization;
});

type MicrosoftEntraAuthorizationContract = MicrosoftEntraContractsModule["MicrosoftEntraAuthorizationContract"];

describe("microsoftEntraContracts", () => {
  it("derives session assurance from Entra amr and auth context claims instead of falling back to standard", () => {
    const fromAmr = extractMicrosoftEntraClaimsSnapshot({
      tenantId: "tenant-1",
      userId: "user-amr",
      email: "amr@example.com",
      scopes: ["openid", "profile"],
      claims: {
        amr: ["pwd", "mfa"]
      }
    });

    const fromAuthContext = extractMicrosoftEntraClaimsSnapshot({
      tenantId: "tenant-1",
      userId: "user-acrs",
      email: "acrs@example.com",
      scopes: ["openid", "profile"],
      claims: {
        acrs: ["c1"]
      }
    });

    const phishingResistant = extractMicrosoftEntraClaimsSnapshot({
      tenantId: "tenant-1",
      userId: "user-fido",
      email: "fido@example.com",
      scopes: ["openid", "profile"],
      claims: {
        amr: ["fido"]
      }
    });

    expect(fromAmr.session_assurance).toBe("mfa");
    expect(fromAmr.session_assurance).not.toBe("standard");
    expect(fromAuthContext.session_assurance).toBe("mfa");
    expect(fromAuthContext.session_assurance).not.toBe("standard");
    expect(phishingResistant.session_assurance).toBe("phishing_resistant");
  });

  it("maps Entra app roles into base role, overlays, and permission outcomes", () => {
    const contract: MicrosoftEntraAuthorizationContract = {
      contract_version: "1",
      require_assignment_for_sign_in: true,
      fail_closed_for_privileged: true,
      app_role_mappings: {
        MissionControl_Manager: {
          authority_tier: "supervisor",
          base_role: "Manager",
          capability_overlays: ["Finance", "CommunicationsModerator"],
          internal_role_groups: ["schools"],
          policy_roles: ["department_manager"],
          permission_keys: ["profitability.read", "communication.moderate"],
          privileged: true
        }
      },
      group_mappings: []
    };

    const claims = extractMicrosoftEntraClaimsSnapshot({
      tenantId: "tenant-1",
      userId: "user-1",
      email: "manager@example.com",
      scopes: ["openid", "profile"],
      claims: {
        roles: ["MissionControl_Manager"],
        amr: ["pwd", "mfa"]
      }
    });

    const resolved = resolveMicrosoftEntraAuthorization({
      contract,
      claims,
      currentAuthorityTier: null
    });

    expect(resolved.sign_in_allowed).toBe(true);
    expect(resolved.resolved.authority_tier).toBe("supervisor");
    expect(resolved.resolved.base_role).toBe("Manager");
    expect(resolved.resolved.capability_overlays).toEqual(["Finance", "CommunicationsModerator"]);
    expect(resolved.resolved.permission_keys).toEqual(
      expect.arrayContaining(["profitability.read", "communication.moderate"])
    );
    expect(resolved.resolved.finance_sensitive_access).toBe(true);
    expect(resolved.resolved.communications_moderation).toBe(true);
    expect(resolved.issues).toEqual([]);
  });

  it("fails closed for privileged authority when no Entra mapping is present", () => {
    const contract: MicrosoftEntraAuthorizationContract = {
      contract_version: "1",
      require_assignment_for_sign_in: false,
      fail_closed_for_privileged: true,
      app_role_mappings: {},
      group_mappings: []
    };

    const claims = extractMicrosoftEntraClaimsSnapshot({
      tenantId: "tenant-1",
      userId: "user-2",
      email: "lead@example.com",
      scopes: ["openid"],
      claims: {
        roles: [],
        amr: ["pwd", "mfa"]
      }
    });

    const resolved = resolveMicrosoftEntraAuthorization({
      contract,
      claims,
      currentAuthorityTier: "leadership"
    });

    expect(resolved.sign_in_allowed).toBe(false);
    expect(resolved.resolved.authority_tier).toBeNull();
    expect(resolved.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "privileged.assignment_missing",
          severity: "error"
        })
      ])
    );
  });

  it("validates fresh reauth and auth context for step-up", () => {
    const freshTimestamp = new Date(Date.now() - 4 * 60_000).toISOString();
    const staleTimestamp = new Date(Date.now() - 20 * 60_000).toISOString();
    const rule = {
      required_assurance: "phishing_resistant" as const,
      auth_context_id: "c1",
      reauth_window_minutes: 15
    };

    expect(
      isMicrosoftEntraStepUpSatisfied(
        {
          sessionAssurance: "phishing_resistant",
          lastReauthenticatedAt: freshTimestamp,
          activeAuthContextIds: ["c1", "c2"]
        },
        rule
      )
    ).toBe(true);

    expect(
      isMicrosoftEntraStepUpSatisfied(
        {
          sessionAssurance: "phishing_resistant",
          lastReauthenticatedAt: staleTimestamp,
          activeAuthContextIds: ["c1"]
        },
        rule
      )
    ).toBe(false);

    expect(
      isMicrosoftEntraStepUpSatisfied(
        {
          sessionAssurance: "phishing_resistant",
          lastReauthenticatedAt: freshTimestamp,
          activeAuthContextIds: ["c2"]
        },
        rule
      )
    ).toBe(false);
  });
});
