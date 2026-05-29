import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { hashOpaqueToken } from "../src/services/auth.js";
import { devLogin, elevateSession, getMembershipId, getTenantId } from "./helpers.js";

const app = createApp();
const originalFetch = globalThis.fetch;
const originalMicrosoftConfig = {
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  ALLOW_PASSWORD_LOGIN: config.ALLOW_PASSWORD_LOGIN,
  ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY: config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY,
  MICROSOFT_GRAPH_CLIENT_ID: config.MICROSOFT_GRAPH_CLIENT_ID,
  MICROSOFT_GRAPH_CLIENT_SECRET: config.MICROSOFT_GRAPH_CLIENT_SECRET,
  MICROSOFT_GRAPH_TENANT_ID: config.MICROSOFT_GRAPH_TENANT_ID,
  MICROSOFT_ENTRA_REDIRECT_URI: config.MICROSOFT_ENTRA_REDIRECT_URI,
  MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI: config.MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL
};

let ownerToken = "";
let demoTenantId = "";
let ownerUserId = "";

beforeAll(async () => {
  await applyMigration("112_microsoft_integration_observability_phase6.sql");
  await applyMigration("119_communication_identity_linking_phase1.sql");
  await applyMigration("120_teams_messaging_service_phase2.sql");
  await applyMigration("132_microsoft_phase1_auth_hardening_and_portal_diagnostics.sql");
  await applyMigration("133_phase1_security_overlays_and_communication_moderation.sql");
  ownerToken = String((await devLogin(app, "matthew@example.com")).body.token);
  await elevateSession(app, ownerToken);
  demoTenantId = String(await getTenantId("Demo Studio"));
  ownerUserId = String(await getMembershipId("matthew@example.com"));
});

afterEach(async () => {
  Object.assign(config, originalMicrosoftConfig);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  if (demoTenantId) {
    await pool.query(
      `
        DELETE FROM admin_setting_value
        WHERE tenant_id = $1
          AND setting_key = ANY($2::text[])
      `,
      [
        demoTenantId,
        [
          "roles_access.microsoft_entra_authorization_contract",
          "roles_access.microsoft_entra_sensitive_action_contract"
        ]
      ]
    );
  }
});

describe("Microsoft Entra auth phase 1", () => {
  it("redirects back to the app with a clear notice when Microsoft sign-in is disabled", async () => {
    config.MICROSOFT_ENTRA_AUTH_ENABLED = false;
    config.MICROSOFT_GRAPH_CLIENT_ID = "";
    config.MICROSOFT_GRAPH_CLIENT_SECRET = "";
    config.MICROSOFT_GRAPH_TENANT_ID = "";
    config.ADMIN_WEB_URL = "http://localhost:5173";

    const response = await request(app).get("/auth/microsoft/start?return_hash=%23home");

    expect(response.status).toBe(302);
    expect(String(response.headers.location)).toContain("#auth/callback?");

    const params = getCallbackParams(String(response.headers.location));
    expect(params.get("status")).toBe("error");
    expect(params.get("notice")).toBe("Microsoft sign-in is not enabled in this environment.");
    expect(params.get("return_hash")).toBe("#home");
  });

  it("starts the Microsoft sign-in flow and persists a verifiable state record", async () => {
    enableMicrosoftEntra("phase1-start");

    const response = await request(app).get("/auth/microsoft/start?return_hash=%23operations");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("login.microsoftonline.com/test-tenant-phase1-start/oauth2/v2.0/authorize");

    const redirectUrl = new URL(String(response.headers.location));
    const rawState = String(redirectUrl.searchParams.get("state"));
    const nonce = String(redirectUrl.searchParams.get("nonce"));
    expect(rawState).toBeTruthy();
    expect(nonce).toBeTruthy();
    expect(redirectUrl.searchParams.get("scope")).toContain("User.Read");
    expect(redirectUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirectUrl.searchParams.get("code_challenge")).toBeTruthy();

    const stateRow = await pool.query<{
      return_hash: string | null;
      consumed_at: string | null;
      state_context: Record<string, unknown>;
    }>(
      `
        SELECT return_hash, consumed_at::text AS consumed_at, state_context
        FROM microsoft_auth_state
        WHERE state_hash = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [hashOpaqueToken(rawState)]
    );

    expect(stateRow.rows[0]?.return_hash).toBe("#operations");
    expect(stateRow.rows[0]?.consumed_at).toBeNull();
    expect(stateRow.rows[0]?.state_context?.pkce_verifier_ciphertext).toBeTruthy();
    expect(stateRow.rows[0]?.state_context?.nonce).toBe(nonce);
  });

  it("links a matched employee by work email, persists Entra MFA assurance on the session, and returns a federated logout URL", async () => {
    enableMicrosoftEntra("phase1-linked");
    await setMicrosoftEntraAuthorizationContract({
      contract_version: "1",
      require_assignment_for_sign_in: true,
      fail_closed_for_privileged: true,
      app_role_mappings: {
        "MissionControl.Standard": {
          authority_tier: "standard_employee",
          internal_role_groups: ["customer_service"],
          policy_roles: ["communications_operator"],
          permission_keys: ["communication.use"],
          privileged: false
        }
      },
      group_mappings: []
    });
    const email = `ms-linked-${Date.now()}@example.com`;
    const membershipId = await provisionActiveMembership(email, "Microsoft Linked Employee");
    const { rawState, nonce } = await beginMicrosoftSignIn("#account");

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Linked Employee",
      microsoftUserId: `ms-user-${Date.now()}`,
      microsoftTenantId: "test-tenant-phase1-linked",
      roles: ["MissionControl.Standard"],
      amr: ["mfa"],
      expectedNonce: nonce
    });

    const callback = await request(app).get(`/auth/microsoft/callback?code=fake-code&state=${encodeURIComponent(rawState)}`);

    expect(callback.status).toBe(302);
    const params = getCallbackParams(String(callback.headers.location));
    expect(params.get("status")).toBe("signed_in");
    expect(params.get("return_hash")).toBe("#account");
    const issuedToken = String(params.get("token"));
    expect(issuedToken).toBeTruthy();

    const session = await request(app).get("/auth/session").set("Authorization", `Bearer ${issuedToken}`);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(email);
    expect(session.body.user.sessionTrust.identityProvider).toBe("microsoft_entra");
    expect(session.body.user.sessionTrust.sessionAssurance).toBe("mfa");
    expect(session.body.user.communicationIdentity.status).toBe("linked_ready");
    expect(session.body.user.communicationIdentity.communicationEnabled).toBe(true);
    expect(session.body.user.permissions).toContain("communication.use");
    expect(session.body.user.microsoftEntraAuthorization?.resolved.mappedAppRoles).toContain("MissionControl.Standard");

    const accountRow = await pool.query<{
      microsoft_user_id: string | null;
      microsoft_tenant_id: string | null;
      auth_provider: string | null;
      communication_enabled: boolean;
      last_verified_at: string | null;
      linked_at: string | null;
      last_login_at: string | null;
    }>(
      `
        SELECT
          account.microsoft_user_id,
          account.microsoft_tenant_id,
          account.auth_provider,
          account.communication_enabled,
          account.last_verified_at::text AS last_verified_at,
          account.linked_at::text AS linked_at,
          account.last_login_at::text AS last_login_at
        FROM app_user membership
        JOIN user_account account ON account.id = membership.account_id
        WHERE membership.id = $1
        LIMIT 1
      `,
      [membershipId]
    );

    expect(accountRow.rows[0]?.microsoft_user_id).toMatch(/^ms-user-/);
    expect(accountRow.rows[0]?.microsoft_tenant_id).toBe("test-tenant-phase1-linked");
    expect(accountRow.rows[0]?.auth_provider).toBe("microsoft_entra");
    expect(accountRow.rows[0]?.communication_enabled).toBe(true);
    expect(accountRow.rows[0]?.last_verified_at).toBeTruthy();
    expect(accountRow.rows[0]?.linked_at).toBeTruthy();
    expect(accountRow.rows[0]?.last_login_at).toBeTruthy();
    const sessionRow = await pool.query<{
      session_assurance: string;
      last_reauthenticated_at: string | null;
      active_auth_context_ids: string[] | null;
      identity_authorization: {
        resolved?: {
          mapped_app_roles?: string[];
        };
      } | null;
    }>(
      `
        SELECT
          session_assurance::text AS session_assurance,
          last_reauthenticated_at::text AS last_reauthenticated_at,
          active_auth_context_ids,
          identity_authorization
        FROM auth_session
        WHERE id = $1
        LIMIT 1
      `,
      [session.body.user.sessionId]
    );
    expect(sessionRow.rows[0]?.session_assurance).toBe("mfa");
    expect(sessionRow.rows[0]?.last_reauthenticated_at).toBeTruthy();
    expect(sessionRow.rows[0]?.active_auth_context_ids).toEqual([]);
    expect(sessionRow.rows[0]?.identity_authorization?.resolved?.mapped_app_roles).toContain("MissionControl.Standard");

    const auditRows = await pool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND target_user_id = $2
          AND action LIKE 'auth.microsoft.%'
        ORDER BY created_at ASC
      `,
      [demoTenantId, membershipId]
    );

    const auditActions = auditRows.rows.map((row) => row.action);
    expect(auditActions).toContain("auth.microsoft.identity_linked");
    expect(auditActions).toContain("auth.microsoft.login.success");

    const logout = await request(app).post("/auth/logout").set("Authorization", `Bearer ${issuedToken}`);
    expect(logout.status).toBe(200);
    expect(String(logout.body.federated_logout_url)).toContain("/oauth2/v2.0/logout");
    expect(String(logout.body.federated_logout_url)).toContain(encodeURIComponent("http://localhost:5173/signed-out"));
  });

  it("denies Microsoft sign-in cleanly when the Entra assignment contract does not resolve an allowed app role", async () => {
    enableMicrosoftEntra("phase1-denied");
    await setMicrosoftEntraAuthorizationContract({
      contract_version: "1",
      require_assignment_for_sign_in: true,
      fail_closed_for_privileged: true,
      app_role_mappings: {
        "MissionControl.Standard": {
          authority_tier: "standard_employee",
          internal_role_groups: ["customer_service"],
          policy_roles: [],
          permission_keys: ["communication.use"],
          privileged: false
        }
      },
      group_mappings: []
    });
    const email = `ms-denied-${Date.now()}@example.com`;
    await provisionActiveMembership(email, "Denied Microsoft Employee");
    const { rawState, nonce } = await beginMicrosoftSignIn("#home");

    mockMicrosoftOauth({
      email,
      fullName: "Denied Microsoft Employee",
      microsoftUserId: `ms-denied-user-${Date.now()}`,
      microsoftTenantId: "test-tenant-phase1-denied",
      roles: ["MissionControl.Unmapped"],
      amr: ["mfa"],
      expectedNonce: nonce
    });

    const callback = await request(app).get(`/auth/microsoft/callback?code=denied-code&state=${encodeURIComponent(rawState)}`);

    expect(callback.status).toBe(302);
    const params = getCallbackParams(String(callback.headers.location));
    expect(params.get("status")).toBe("error");
    expect(params.get("reason")).toBe("authorization_denied");
    expect(params.get("notice")).toContain("No approved Entra app role");
  });

  it("flags unmatched Microsoft identities for admin review and allows an elevated admin to link them", async () => {
    enableMicrosoftEntra("phase1-review");
    const { rawState, nonce } = await beginMicrosoftSignIn("#home");
    const reviewEmail = `ms-review-${Date.now()}@example.com`;

    mockMicrosoftOauth({
      email: reviewEmail,
      fullName: "Needs Review",
      microsoftUserId: `ms-review-user-${Date.now()}`,
      microsoftTenantId: "test-tenant-phase1-review",
      expectedNonce: nonce
    });

    const callback = await request(app).get(`/auth/microsoft/callback?code=fake-review-code&state=${encodeURIComponent(rawState)}`);

    expect(callback.status).toBe(302);
    const callbackParams = getCallbackParams(String(callback.headers.location));
    expect(callbackParams.get("status")).toBe("pending_review");
    expect(callbackParams.get("token")).toBeNull();
    expect(callbackParams.get("email")).toBe(reviewEmail);

    const reviewRow = await pool.query<{ id: string; review_status: string }>(
      `
        SELECT id, review_status
        FROM microsoft_identity_review
        WHERE email = $1
          AND review_status = 'pending_review'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [reviewEmail]
    );
    const reviewId = String(reviewRow.rows[0]?.id);
    expect(reviewId).toBeTruthy();

    const reviewList = await request(app)
      .get("/api/access/microsoft-identities/reviews")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(reviewList.status).toBe(200);
    expect(reviewList.body.some((row: { id: string }) => row.id === reviewId)).toBe(true);

    const targetEmail = `ms-review-linked-${Date.now()}@example.com`;
    const targetMembershipId = await provisionActiveMembership(targetEmail, "Reviewed Employee");

    const link = await request(app)
      .post(`/api/access/microsoft-identities/reviews/${reviewId}/link`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        user_id: targetMembershipId,
        note: "Linked after verifying work email ownership."
      });

    expect(link.status).toBe(200);

    const linkedReview = await pool.query<{ review_status: string; matched_user_id: string | null; linked_at: string | null }>(
      `
        SELECT
          review_status,
          matched_user_id,
          linked_at::text AS linked_at
        FROM microsoft_identity_review
        WHERE id = $1
      `,
      [reviewId]
    );

    expect(linkedReview.rows[0]?.review_status).toBe("linked");
    expect(linkedReview.rows[0]?.matched_user_id).toBe(targetMembershipId);
    expect(linkedReview.rows[0]?.linked_at).toBeTruthy();

    const linkedAccount = await pool.query<{
      microsoft_user_id: string | null;
      microsoft_tenant_id: string | null;
      auth_provider: string | null;
      communication_enabled: boolean;
      last_verified_at: string | null;
    }>(
      `
        SELECT
          account.microsoft_user_id,
          account.microsoft_tenant_id,
          account.auth_provider,
          account.communication_enabled,
          account.last_verified_at::text AS last_verified_at
        FROM app_user membership
        JOIN user_account account ON account.id = membership.account_id
        WHERE membership.id = $1
        LIMIT 1
      `,
      [targetMembershipId]
    );

    expect(linkedAccount.rows[0]?.microsoft_user_id).toMatch(/^ms-review-user-/);
    expect(linkedAccount.rows[0]?.microsoft_tenant_id).toBe("test-tenant-phase1-review");
    expect(linkedAccount.rows[0]?.auth_provider).toBe("microsoft_entra");
    expect(linkedAccount.rows[0]?.communication_enabled).toBe(true);
    expect(linkedAccount.rows[0]?.last_verified_at).toBeTruthy();

    const reviewAuditRows = await pool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE tenant_id = $1
          AND target_user_id = $2
          AND action LIKE 'auth.microsoft.%'
        ORDER BY created_at ASC
      `,
      [demoTenantId, targetMembershipId]
    );
    expect(reviewAuditRows.rows.map((row) => row.action)).toContain("auth.microsoft.identity_linked");
  });

  it("requires Microsoft step-up, refreshes session trust, and then allows privileged elevation", async () => {
    enableMicrosoftEntra("phase1-step-up");
    await setMicrosoftEntraAuthorizationContract({
      contract_version: "1",
      require_assignment_for_sign_in: true,
      fail_closed_for_privileged: true,
      app_role_mappings: {
        "MissionControl.SecurityAdmin": {
          authority_tier: "leadership",
          internal_role_groups: ["leadership"],
          policy_roles: ["security_admin"],
          permission_keys: ["audit.read", "security.manage"],
          privileged: true
        }
      },
      group_mappings: []
    });
    await setMicrosoftEntraSensitiveActionContract({
      default_action_key: "session.elevate",
      actions: {
        "session.elevate": {
          auth_context_id: "c1",
          required_assurance: "mfa",
          reauth_window_minutes: 5,
          elevated_window_minutes: 10,
          privileged_window_minutes: 15,
          allow_break_glass: false,
          prompt: "login"
        },
        "break_glass.start": {
          auth_context_id: "c1",
          required_assurance: "mfa",
          reauth_window_minutes: 5,
          elevated_window_minutes: 10,
          privileged_window_minutes: 15,
          allow_break_glass: true,
          prompt: "login"
        }
      }
    });

    const email = `ms-step-up-${Date.now()}@example.com`;
    await provisionActiveMembership(email, "Microsoft Security Admin");
    const microsoftUserId = `ms-step-up-user-${Date.now()}`;
    const { rawState, nonce } = await beginMicrosoftSignIn("#account");

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Security Admin",
      microsoftUserId,
      microsoftTenantId: "test-tenant-phase1-step-up",
      roles: ["MissionControl.SecurityAdmin"],
      amr: ["mfa"],
      expectedNonce: nonce
    });

    const callback = await request(app).get(`/auth/microsoft/callback?code=step-up-sign-in&state=${encodeURIComponent(rawState)}`);
    const params = getCallbackParams(String(callback.headers.location));
    const issuedToken = String(params.get("token"));
    expect(params.get("status")).toBe("signed_in");
    expect(issuedToken).toBeTruthy();

    const missingStepUp = await request(app)
      .post("/auth/elevate")
      .set("Authorization", `Bearer ${issuedToken}`)
      .send({
        reason: "Need privileged access",
        action_key: "session.elevate",
        return_hash: "#account"
      });

    expect(missingStepUp.status).toBe(428);
    expect(missingStepUp.body.details.code).toBe("microsoft_entra_step_up_required");
    expect(missingStepUp.body.details.required_auth_context_id).toBe("c1");
    const stepUpUrl = new URL(String(missingStepUp.body.details.start_url));
    expect(stepUpUrl.searchParams.get("prompt")).toBe("login");
    const stepUpClaims = JSON.parse(String(stepUpUrl.searchParams.get("claims")));
    expect(stepUpClaims.id_token?.acrs?.value).toBe("c1");
    const stepUpContext = extractMicrosoftAuthorizationContext(String(missingStepUp.body.details.start_url));

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Security Admin",
      microsoftUserId,
      microsoftTenantId: "test-tenant-phase1-step-up",
      roles: ["MissionControl.SecurityAdmin"],
      amr: ["mfa"],
      acrs: ["c1"],
      expectedNonce: stepUpContext.nonce
    });

    const stepUpCallback = await request(app).get(
      `/auth/microsoft/callback?code=step-up-reauth&state=${encodeURIComponent(stepUpContext.state)}`
    );
    const stepUpParams = getCallbackParams(String(stepUpCallback.headers.location));
    expect(stepUpCallback.status).toBe(302);
    expect(stepUpParams.get("status")).toBe("step_up_complete");

    const session = await request(app).get("/auth/session").set("Authorization", `Bearer ${issuedToken}`);
    expect(session.status).toBe(200);
    expect(session.body.user.sessionTrust.sessionAssurance).toBe("mfa");
    expect(session.body.user.sessionTrust.activeAuthContextIds).toContain("c1");
    expect(session.body.user.sessionTrust.lastReauthenticatedAt).toBeTruthy();

    const overview = await request(app)
      .get("/api/admin/security/overview")
      .set("Authorization", `Bearer ${issuedToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.current_session.session_assurance).toBe("mfa");
    expect(overview.body.current_session.active_auth_context_ids).toContain("c1");
    expect(overview.body.microsoft_auth_diagnostics.resolved_access.mappedAppRoles).toContain("MissionControl.SecurityAdmin");
    expect(overview.body.microsoft_auth_diagnostics.resolved_access.permissionKeys).toContain("security.manage");

    const elevated = await request(app)
      .post("/auth/elevate")
      .set("Authorization", `Bearer ${issuedToken}`)
      .send({
        reason: "Need privileged access",
        action_key: "session.elevate"
      });

    expect(elevated.status).toBe(200);
    expect(elevated.body.user.sessionTrust.elevatedSessionActive).toBe(true);
  });

  it("treats stale Microsoft reauthentication as expired and requires a fresh step-up", async () => {
    enableMicrosoftEntra("phase1-expired");
    await setMicrosoftEntraAuthorizationContract({
      contract_version: "1",
      require_assignment_for_sign_in: true,
      fail_closed_for_privileged: true,
      app_role_mappings: {
        "MissionControl.SecurityAdmin": {
          authority_tier: "leadership",
          internal_role_groups: ["leadership"],
          policy_roles: ["security_admin"],
          permission_keys: ["audit.read", "security.manage"],
          privileged: true
        }
      },
      group_mappings: []
    });
    await setMicrosoftEntraSensitiveActionContract({
      default_action_key: "session.elevate",
      actions: {
        "session.elevate": {
          auth_context_id: "c1",
          required_assurance: "mfa",
          reauth_window_minutes: 5,
          elevated_window_minutes: 10,
          privileged_window_minutes: 15,
          allow_break_glass: false,
          prompt: "login"
        }
      }
    });

    const email = `ms-expired-${Date.now()}@example.com`;
    await provisionActiveMembership(email, "Microsoft Expired Step Up");
    const microsoftUserId = `ms-expired-user-${Date.now()}`;
    const { rawState, nonce } = await beginMicrosoftSignIn("#account");

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Expired Step Up",
      microsoftUserId,
      microsoftTenantId: "test-tenant-phase1-expired",
      roles: ["MissionControl.SecurityAdmin"],
      amr: ["mfa"],
      expectedNonce: nonce
    });

    const callback = await request(app).get(`/auth/microsoft/callback?code=expired-sign-in&state=${encodeURIComponent(rawState)}`);
    const token = String(getCallbackParams(String(callback.headers.location)).get("token"));

    const firstChallenge = await request(app)
      .post("/auth/elevate")
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Need privileged access",
        action_key: "session.elevate",
        return_hash: "#account"
      });
    const firstStepUpContext = extractMicrosoftAuthorizationContext(String(firstChallenge.body.details.start_url));

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Expired Step Up",
      microsoftUserId,
      microsoftTenantId: "test-tenant-phase1-expired",
      roles: ["MissionControl.SecurityAdmin"],
      amr: ["mfa"],
      acrs: ["c1"],
      expectedNonce: firstStepUpContext.nonce
    });
    await request(app).get(`/auth/microsoft/callback?code=expired-reauth&state=${encodeURIComponent(firstStepUpContext.state)}`);

    const session = await request(app).get("/auth/session").set("Authorization", `Bearer ${token}`);
    await pool.query(
      `
        UPDATE auth_session
        SET last_reauthenticated_at = now() - interval '20 minutes'
        WHERE id = $1
      `,
      [session.body.user.sessionId]
    );

    const expiredChallenge = await request(app)
      .post("/auth/elevate")
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Need privileged access again",
        action_key: "session.elevate",
        return_hash: "#account"
      });

    expect(expiredChallenge.status).toBe(428);
    expect(expiredChallenge.body.details.code).toBe("microsoft_entra_step_up_required");
  });

  it("requires Microsoft step-up before break-glass can start and allows it after reauthentication", async () => {
    enableMicrosoftEntra("phase1-break-glass");
    await setMicrosoftEntraAuthorizationContract({
      contract_version: "1",
      require_assignment_for_sign_in: true,
      fail_closed_for_privileged: true,
      app_role_mappings: {
        "MissionControl.SecurityAdmin": {
          authority_tier: "leadership",
          internal_role_groups: ["leadership"],
          policy_roles: ["security_admin"],
          permission_keys: ["audit.read", "security.manage"],
          privileged: true
        }
      },
      group_mappings: []
    });
    await setMicrosoftEntraSensitiveActionContract({
      default_action_key: "session.elevate",
      actions: {
        "break_glass.start": {
          auth_context_id: "c1",
          required_assurance: "mfa",
          reauth_window_minutes: 5,
          elevated_window_minutes: 10,
          privileged_window_minutes: 30,
          allow_break_glass: true,
          prompt: "login"
        }
      }
    });

    const email = `ms-breakglass-${Date.now()}@example.com`;
    await provisionActiveMembership(email, "Microsoft Break Glass Admin");
    const microsoftUserId = `ms-breakglass-user-${Date.now()}`;
    const { rawState, nonce } = await beginMicrosoftSignIn("#account");

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Break Glass Admin",
      microsoftUserId,
      microsoftTenantId: "test-tenant-phase1-break-glass",
      roles: ["MissionControl.SecurityAdmin"],
      amr: ["mfa"],
      expectedNonce: nonce
    });

    const callback = await request(app).get(`/auth/microsoft/callback?code=breakglass-sign-in&state=${encodeURIComponent(rawState)}`);
    const token = String(getCallbackParams(String(callback.headers.location)).get("token"));

    const blockedBreakGlass = await request(app)
      .post("/auth/break-glass")
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Emergency access for outage review",
        duration_minutes: 10
      });

    expect(blockedBreakGlass.status).toBe(428);
    expect(blockedBreakGlass.body.details.action_key).toBe("break_glass.start");
    expect(blockedBreakGlass.body.details.allow_break_glass).toBe(true);
    const stepUpContext = extractMicrosoftAuthorizationContext(String(blockedBreakGlass.body.details.start_url));

    mockMicrosoftOauth({
      email,
      fullName: "Microsoft Break Glass Admin",
      microsoftUserId,
      microsoftTenantId: "test-tenant-phase1-break-glass",
      roles: ["MissionControl.SecurityAdmin"],
      amr: ["mfa"],
      acrs: ["c1"],
      expectedNonce: stepUpContext.nonce
    });
    await request(app).get(`/auth/microsoft/callback?code=breakglass-reauth&state=${encodeURIComponent(stepUpContext.state)}`);

    const breakGlass = await request(app)
      .post("/auth/break-glass")
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Emergency access for outage review",
        duration_minutes: 10
      });

    expect(breakGlass.status).toBe(200);
    expect(String(breakGlass.body.break_glass_event_id)).toBeTruthy();
    expect(breakGlass.body.user.sessionTrust.breakGlassModeActive).toBe(true);
  });
});


function enableMicrosoftEntra(suffix: string) {
  config.MICROSOFT_ENTRA_AUTH_ENABLED = true;
  config.ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY = false;
  config.MICROSOFT_GRAPH_CLIENT_ID = `test-client-${suffix}`;
  config.MICROSOFT_GRAPH_CLIENT_SECRET = `test-secret-${suffix}`;
  config.MICROSOFT_GRAPH_TENANT_ID = `test-tenant-${suffix}`;
  config.MICROSOFT_ENTRA_REDIRECT_URI = "http://localhost:4000/auth/microsoft/callback";
  config.MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI = "http://localhost:5173/signed-out";
  config.ADMIN_WEB_URL = "http://localhost:5173";
}

async function provisionActiveMembership(email: string, fullName: string) {
  const invite = await request(app)
    .post("/api/access/invites")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      email,
      full_name: fullName,
      authority_tier: "standard_employee",
      primary_profile: "customer_service_rep",
      job_function_profiles: ["customer_service_rep"],
      department: "office"
    });

  expect(invite.status).toBe(201);
  expect(invite.body.invite_token).toBeTruthy();

  const accept = await request(app).post("/auth/invites/accept").send({
    token: invite.body.invite_token,
    full_name: fullName,
    password: "LinkedDemo123!"
  });

  expect(accept.status).toBe(201);

  const membershipId = String(await getMembershipId(email));
  expect(membershipId).toBeTruthy();

  const approve = await request(app)
    .post(`/api/access/memberships/${membershipId}/approve`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      authority_tier: "standard_employee",
      primary_profile: "customer_service_rep",
      job_function_profiles: ["customer_service_rep"],
      department: "office"
    });

  expect(approve.status).toBe(200);
  return membershipId;
}

async function beginMicrosoftSignIn(returnHash: string) {
  const response = await request(app).get(`/auth/microsoft/start?return_hash=${encodeURIComponent(returnHash)}`);
  expect(response.status).toBe(302);
  const redirectUrl = new URL(String(response.headers.location));
  return {
    rawState: String(redirectUrl.searchParams.get("state")),
    nonce: String(redirectUrl.searchParams.get("nonce"))
  };
}

function mockMicrosoftOauth(input: {
  email: string;
  fullName: string;
  microsoftUserId: string;
  microsoftTenantId: string;
  roles?: string[];
  groups?: string[];
  amr?: string[];
  acr?: string | null;
  acrs?: string[];
  expectedNonce: string;
}) {
  const idToken = createUnsignedJwt({
    oid: input.microsoftUserId,
    tid: input.microsoftTenantId,
    aud: config.MICROSOFT_GRAPH_CLIENT_ID,
    iss: `https://login.microsoftonline.com/${input.microsoftTenantId}/v2.0`,
    nonce: input.expectedNonce,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nbf: Math.floor(Date.now() / 1000) - 60,
    email: input.email,
    preferred_username: input.email,
    name: input.fullName,
    ...(input.roles?.length ? { roles: input.roles } : {}),
    ...(input.groups?.length ? { groups: input.groups } : {}),
    ...(input.amr?.length ? { amr: input.amr } : {}),
    ...(input.acr ? { acr: input.acr } : {}),
    ...(input.acrs?.length ? { acrs: input.acrs } : {})
  });

  globalThis.fetch = vi.fn(async (requestUrl: RequestInfo | URL, init?: RequestInit) => {
    const url = String(requestUrl);
    if (url.includes("/oauth2/v2.0/token")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      expect(body.get("code_verifier")).toBeTruthy();
      return new Response(
        JSON.stringify({
          access_token: `access-${input.microsoftUserId}`,
          id_token: idToken,
          scope: "openid profile email User.Read"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (url.includes("/v1.0/me")) {
      return new Response(
        JSON.stringify({
          id: input.microsoftUserId,
          displayName: input.fullName,
          mail: input.email,
          userPrincipalName: input.email
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    throw new Error(`Unexpected Microsoft fetch: ${url}`);
  }) as typeof fetch;
}

function createUnsignedJwt(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

function getCallbackParams(location: string) {
  const redirectUrl = new URL(location);
  const queryIndex = redirectUrl.hash.indexOf("?");
  return new URLSearchParams(queryIndex >= 0 ? redirectUrl.hash.slice(queryIndex + 1) : "");
}

function extractMicrosoftAuthorizationContext(location: string) {
  const url = new URL(location);
  return {
    state: String(url.searchParams.get("state")),
    nonce: String(url.searchParams.get("nonce"))
  };
}

async function applyMigration(filename: string) {
  const sql = await readFile(resolve(process.cwd(), `../../db/migrations/${filename}`), "utf8");
  try {
    await pool.query(sql);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (!error.message.includes("already exists") &&
        !error.message.includes('duplicate key value violates unique constraint "pg_type_typname_nsp_index"'))
    ) {
      throw error;
    }
  }
}

async function setMicrosoftEntraAuthorizationContract(value: Record<string, unknown>) {
  await setRoleAccessSetting("roles_access.microsoft_entra_authorization_contract", value);
}

async function setMicrosoftEntraSensitiveActionContract(value: Record<string, unknown>) {
  await setRoleAccessSetting("roles_access.microsoft_entra_sensitive_action_contract", value);
}

async function setRoleAccessSetting(settingKey: string, value: Record<string, unknown>) {
  await pool.query(
    `
      DELETE FROM admin_setting_value
      WHERE tenant_id = $1
        AND setting_key = $2
    `,
    [demoTenantId, settingKey]
  );

  await pool.query(
    `
      INSERT INTO admin_setting_value (
        tenant_id,
        setting_key,
        setting_category,
        scope_type,
        scope_id,
        scope_label,
        value,
        value_type,
        status,
        requires_approval,
        is_override,
        effective_at,
        requested_by_user_id,
        approved_by_user_id,
        approved_at,
        reason,
        impact_snapshot,
        metadata
      )
      VALUES (
        $1,
        $2,
        'roles_access_rules'::admin_setting_category,
        'global'::admin_setting_scope_type,
        NULL,
        'Global',
        $3::jsonb,
        'json',
        'approved'::admin_setting_status,
        false,
        false,
        now(),
        $4,
        $4,
        now(),
        'Microsoft Entra auth test contract.',
        '{}'::jsonb,
        '{}'::jsonb
      )
    `,
    [demoTenantId, settingKey, JSON.stringify(value), ownerUserId]
  );
}
