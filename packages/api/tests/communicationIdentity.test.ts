import { describe, expect, it } from "vitest";
import { buildCommunicationIdentity, canUseCommunicationActions, deriveCommunicationIdentityStatus } from "../src/services/communicationIdentity.js";

describe("communication identity linking", () => {
  it("derives the correct readiness states from Microsoft identity linkage", () => {
    expect(
      deriveCommunicationIdentityStatus({
        microsoftUserId: "ms-user",
        microsoftTenantId: "tenant",
        communicationEnabled: true
      })
    ).toBe("linked_ready");

    expect(
      deriveCommunicationIdentityStatus({
        microsoftUserId: "ms-user",
        microsoftTenantId: "tenant",
        communicationEnabled: false
      })
    ).toBe("disabled");

    expect(
      deriveCommunicationIdentityStatus({
        microsoftUserId: "ms-user",
        authProvider: "microsoft_entra"
      })
    ).toBe("incomplete");

    expect(deriveCommunicationIdentityStatus({})).toBe("unlinked");
  });

  it("only allows communication actions for linked and permissioned users", () => {
    const linkedIdentity = buildCommunicationIdentity({
      microsoftUserId: "ms-user",
      microsoftTenantId: "tenant",
      communicationEnabled: true,
      linkedAt: "2026-04-03T12:00:00.000Z",
      lastVerifiedAt: "2026-04-03T12:00:00.000Z"
    });

    expect(
      canUseCommunicationActions({
        permissions: ["communication.use"],
        policyGrants: [],
        communicationIdentity: linkedIdentity
      } as never)
    ).toBe(true);

    expect(
      canUseCommunicationActions({
        permissions: [],
        policyGrants: [],
        communicationIdentity: linkedIdentity
      } as never)
    ).toBe(false);

    expect(
      canUseCommunicationActions({
        permissions: ["communication.use"],
        policyGrants: [],
        communicationIdentity: buildCommunicationIdentity({})
      } as never)
    ).toBe(false);
  });
});
