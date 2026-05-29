import crypto from "node:crypto";
import { URLSearchParams } from "node:url";
import type { PoolClient } from "pg";
import { decodeJwt } from "jose";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import { createAuditLog } from "./audit.js";
import {
  hashOpaqueToken,
  issueAuthSession,
  loadAuthenticatedUserBySession,
  normalizeEmail,
  updateSessionIdentityTrust,
  type RequestAuditContext
} from "./auth.js";
import { writeCommunicationAuditEvent } from "./communicationObservability.js";
import { deriveInternalRoleGroups } from "./internalRoleMapping.js";
import {
  extractMicrosoftEntraClaimsSnapshot,
  getMicrosoftEntraAuthorizationContract,
  getMicrosoftEntraStepUpRule,
  isSessionAssuranceAtLeast,
  resolveMicrosoftEntraAuthorization,
  type MicrosoftEntraAuthorizationState,
  type MicrosoftEntraClaimsSnapshot
} from "./microsoftEntraContracts.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";
import type { AuthRole, AuthorityTier, DepartmentCode, JobFunctionProfile, MembershipStatus, AuthUser } from "../types/auth.js";
import { decryptSecret, encryptSecret } from "../utils/encryptedSecrets.js";
import { createOauthPkcePair } from "../utils/oauthPkce.js";

const MICROSOFT_ENTRA_SCOPES = ["openid", "profile", "email", "User.Read"];
const MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MICROSOFT_ENTRA_CALLBACK_PATH = "/auth/microsoft/callback";

type MicrosoftTokenResponse = {
  access_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type MicrosoftGraphUser = {
  id?: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  givenName?: string | null;
  surname?: string | null;
  error?: { message?: string };
};

type MicrosoftIdentity = {
  microsoftUserId: string;
  microsoftTenantId: string;
  email: string;
  fullName: string;
  scopes: string[];
  claimsSnapshot: MicrosoftEntraClaimsSnapshot;
};

type MicrosoftAuthStateRow = {
  id: string;
  return_hash: string | null;
  flow_purpose: "sign_in" | "step_up";
  session_id: string | null;
  requested_action_key: string | null;
  requested_auth_context_id: string | null;
  requested_assurance: "standard" | "mfa" | "phishing_resistant" | null;
  state_context: Record<string, unknown>;
};

type MicrosoftMembershipRow = {
  id: string;
  tenant_id: string;
  account_id: string | null;
  email: string;
  full_name: string;
  status: MembershipStatus;
  department: DepartmentCode;
  auth_version: number;
  authority_tier: AuthorityTier | null;
  primary_job_function_profile: JobFunctionProfile | null;
  job_function_profiles: JobFunctionProfile[];
  roles: AuthRole[];
  microsoft_user_id: string | null;
  microsoft_tenant_id: string | null;
  account_auth_provider: string | null;
};

type UserAccountRow = {
  id: string;
  email: string;
  full_name: string;
  microsoft_user_id: string | null;
  microsoft_tenant_id: string | null;
  auth_provider: string | null;
  linked_at: string | null;
  communication_enabled: boolean;
  teams_chat_default_target: string | null;
  last_verified_at: string | null;
};

type MicrosoftIdentityReviewRow = {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  email: string;
  full_name: string;
  microsoft_user_id: string;
  microsoft_tenant_id: string;
  auth_provider: string;
  review_status: "pending_review" | "linked" | "rejected";
  reason_code: string;
  matched_user_id: string | null;
  matched_account_id: string | null;
  matched_user_email: string | null;
  matched_user_name: string | null;
  matched_user_status: MembershipStatus | null;
  matched_user_department: DepartmentCode | null;
  matched_user_authority_tier: AuthorityTier | null;
  matched_user_primary_job_function_profile: JobFunctionProfile | null;
  matched_user_job_function_profiles: JobFunctionProfile[];
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  linked_at: string | null;
  last_login_at: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type MicrosoftReviewRecord = MicrosoftIdentityReviewRow & {
  matched_user_internal_role_groups: string[];
};

export function isMicrosoftEntraAuthEnabled() {
  return (
    config.MICROSOFT_ENTRA_AUTH_ENABLED &&
    Boolean(config.MICROSOFT_GRAPH_CLIENT_ID) &&
    Boolean(config.MICROSOFT_GRAPH_CLIENT_SECRET) &&
    Boolean(config.MICROSOFT_GRAPH_TENANT_ID)
  );
}

export async function createMicrosoftEntraAuthorizationUrl(
  client: PoolClient,
  input: {
    returnHash?: string | null;
    flowPurpose?: "sign_in" | "step_up";
    sessionId?: string | null;
    requestedActionKey?: string | null;
    requestedAuthContextId?: string | null;
    requestedAssurance?: "standard" | "mfa" | "phishing_resistant" | null;
    stateContext?: Record<string, unknown>;
    prompt?: "login" | "select_account";
  },
  metadata: RequestAuditContext = {}
) {
  if (!isMicrosoftEntraAuthEnabled()) {
    throw new ApiError(404, "Microsoft sign-in is not enabled");
  }

  const rawState = crypto.randomBytes(24).toString("hex");
  const stateHash = hashOpaqueToken(rawState);
  const flowPurpose = input.flowPurpose ?? "sign_in";
  const pkce = createOauthPkcePair();
  const nonce = crypto.randomBytes(24).toString("base64url");
  const stateContext = {
    ...(input.stateContext ?? {}),
    pkce_verifier_ciphertext: encryptSecret(pkce.codeVerifier, stateHash),
    pkce_method: pkce.codeChallengeMethod,
    nonce
  };
  await client.query(
    `
      INSERT INTO microsoft_auth_state (
        state_hash,
        return_hash,
        flow_purpose,
        session_id,
        requested_action_key,
        requested_auth_context_id,
        requested_assurance,
        state_context,
        ip_address,
        user_agent,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, now() + ($11::text || ' minutes')::interval)
    `,
    [
      stateHash,
      sanitizeReturnHash(input.returnHash ?? null),
      flowPurpose,
      input.sessionId ?? null,
      input.requestedActionKey ?? null,
      input.requestedAuthContextId ?? null,
      input.requestedAssurance ?? null,
      JSON.stringify(stateContext),
      metadata.ipAddress ?? null,
      metadata.userAgent ?? null,
      String(config.MICROSOFT_ENTRA_STATE_MINUTES)
    ]
  );

  const params = new URLSearchParams({
    client_id: config.MICROSOFT_GRAPH_CLIENT_ID,
    response_type: "code",
    redirect_uri: getMicrosoftEntraRedirectUri(),
    response_mode: "query",
    scope: MICROSOFT_ENTRA_SCOPES.join(" "),
    state: rawState,
    prompt: input.prompt ?? (flowPurpose === "step_up" ? "login" : "select_account"),
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    nonce
  });
  if (input.requestedAuthContextId) {
    params.set(
      "claims",
      JSON.stringify({
        id_token: {
          acrs: {
            essential: true,
            value: input.requestedAuthContextId
          }
        }
      })
    );
  }

  return `https://login.microsoftonline.com/${config.MICROSOFT_GRAPH_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function createMicrosoftEntraStepUpUrl(
  client: PoolClient,
  auth: AuthUser,
  input: {
    actionKey: string;
    returnHash?: string | null;
  },
  metadata: RequestAuditContext = {}
) {
  if (auth.sessionTrust.identityProvider !== "microsoft_entra") {
    throw new ApiError(400, "Microsoft enterprise step-up is only available for Microsoft Entra sessions.");
  }
  const stepUp = await getMicrosoftEntraStepUpRule(client, auth.tenantId, input.actionKey);
  return createMicrosoftEntraAuthorizationUrl(
    client,
    {
      returnHash: input.returnHash ?? null,
      flowPurpose: "step_up",
      sessionId: auth.sessionId,
      requestedActionKey: stepUp.actionKey,
      requestedAuthContextId: stepUp.rule.auth_context_id,
      requestedAssurance: stepUp.rule.required_assurance,
      stateContext: {
        reauth_window_minutes: stepUp.rule.reauth_window_minutes,
        elevated_window_minutes: stepUp.rule.elevated_window_minutes,
        privileged_window_minutes: stepUp.rule.privileged_window_minutes
      },
      prompt: stepUp.rule.prompt
    },
    metadata
  );
}

export async function handleMicrosoftEntraCallback(
  client: PoolClient,
  input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  },
  metadata: RequestAuditContext = {}
) {
  if (!isMicrosoftEntraAuthEnabled()) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "auth",
      eventLevel: "warning",
      eventType: "auth.microsoft.callback.disabled",
      summary: "Microsoft sign-in callback was hit while Microsoft auth is disabled.",
      detail: {
        reason_code: "disabled"
      }
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "Microsoft sign-in is not enabled."
    });
  }

  if (!input.state) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "auth",
      eventLevel: "error",
      eventType: "auth.microsoft.callback.missing_state",
      summary: "Microsoft sign-in callback failed because the OAuth state was missing.",
      detail: {
        reason_code: "missing_state"
      }
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "Microsoft sign-in could not be verified.",
      reasonCode: "missing_state"
    });
  }

  const state = await consumeMicrosoftAuthState(client, input.state);
  if (!state) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "auth",
      eventLevel: "error",
      eventType: "auth.microsoft.callback.invalid_state",
      summary: "Microsoft sign-in callback failed because the OAuth state was invalid or expired.",
      detail: {
        reason_code: "invalid_state"
      }
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "This Microsoft sign-in link is no longer valid.",
      reasonCode: "invalid_state"
    });
  }

  if (input.error) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "auth",
      eventLevel: "warning",
      eventType: "auth.microsoft.callback.denied",
      summary: "Microsoft sign-in was denied or canceled by the user.",
      detail: {
        reason_code: "callback_denied",
        microsoft_error: input.error,
        microsoft_error_description: input.errorDescription ?? null
      }
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "Microsoft sign-in was canceled or denied.",
      returnHash: state.return_hash,
      reasonCode: "callback_denied"
    });
  }

  if (!input.code) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "auth",
      eventLevel: "error",
      eventType: "auth.microsoft.callback.missing_code",
      summary: "Microsoft sign-in callback failed because the authorization code was missing.",
      detail: {
        reason_code: "missing_code"
      }
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "Microsoft sign-in did not return an authorization code.",
      returnHash: state.return_hash,
      reasonCode: "missing_code"
    });
  }

  try {
    const codeVerifier = extractMicrosoftPkceVerifier(state, input.state);
    const expectedNonce = extractMicrosoftNonce(state);
    const tokens = await exchangeMicrosoftAuthorizationCode(input.code, codeVerifier);
    const identity = await fetchMicrosoftIdentity(tokens, {
      expectedClientId: config.MICROSOFT_GRAPH_CLIENT_ID,
      expectedNonce,
      expectedTenantId: config.MICROSOFT_GRAPH_TENANT_ID
    });

    if (state.flow_purpose === "step_up") {
      return completeMicrosoftEntraStepUp(client, state, identity, metadata);
    }

    const linkedMembership = await loadMembershipByMicrosoftIdentity(client, identity.microsoftTenantId, identity.microsoftUserId);
    if (linkedMembership) {
      if (linkedMembership.status !== "active") {
        await createOrUpdateMicrosoftIdentityReview(client, {
          tenantId: linkedMembership.tenant_id,
          identity,
          reasonCode: "linked_membership_inactive",
          notes: `Existing linked account is ${linkedMembership.status}.`
        });
        await recordMicrosoftIntegrationEvent(client, {
          tenantId: linkedMembership.tenant_id,
          integrationArea: "account_linking",
          eventLevel: "warning",
          eventType: "auth.microsoft.review_needed.linked_membership_inactive",
          summary: "Microsoft sign-in matched an existing linked employee record that is not active.",
          detail: {
            email: identity.email,
            membership_status: linkedMembership.status
          },
          relatedEntityType: "app_user",
          relatedEntityId: linkedMembership.id
        });
        return buildAuthCallbackRedirect({
          status: "pending_review",
          notice: "Your Microsoft account is linked, but the employee record is not active yet.",
          returnHash: state.return_hash,
          email: identity.email
        });
      }

      const authorization = await resolveMicrosoftEntraAuthorizationForMembership(client, linkedMembership, identity);
      if (!authorization.sign_in_allowed) {
        return buildDeniedMicrosoftAuthorizationRedirect(client, linkedMembership, identity, authorization, state.return_hash, metadata);
      }
      const session = await finalizeMicrosoftLogin(client, linkedMembership, identity, authorization, metadata, {
        auditAction: "auth.microsoft.login.success",
        linkReason: "existing_link"
      });
      return buildAuthCallbackRedirect({
        status: "signed_in",
        notice: "Signed in with Microsoft.",
        token: session.token,
        returnHash: state.return_hash
      });
    }

    const emailMatches = await loadMembershipsByEmail(client, identity.email);
    const distinctTenantIds = [...new Set(emailMatches.map((membership) => membership.tenant_id))];
    if (emailMatches.length > 1 && distinctTenantIds.length > 1) {
      const reviewTenantId = await resolveReviewTenantId(client, identity.email, identity.microsoftTenantId);
      await createOrUpdateMicrosoftIdentityReview(client, {
        tenantId: reviewTenantId,
        identity,
        reasonCode: "ambiguous_email_match",
        notes: `Multiple employee records matched ${identity.email}.`
      });
      await createMicrosoftIdentityAudit(
        client,
        reviewTenantId,
        null,
        "auth.microsoft.login.review_needed",
        {
          email: identity.email,
          reason_code: "ambiguous_email_match"
        },
        metadata
      );
      await recordMicrosoftIntegrationEvent(client, {
        tenantId: reviewTenantId,
        integrationArea: "account_linking",
        eventLevel: "warning",
        eventType: "auth.microsoft.review_needed.ambiguous_email_match",
        summary: "Microsoft sign-in matched multiple employee records and requires admin review.",
        detail: {
          email: identity.email,
          reason_code: "ambiguous_email_match"
        }
      });
      return buildAuthCallbackRedirect({
        status: "pending_review",
        notice: "Your Microsoft account needs admin review before access can be granted.",
        returnHash: state.return_hash,
        email: identity.email
      });
    }

    const emailMembership = emailMatches[0] ?? null;
    if (emailMembership) {
      if (emailMembership.status !== "active") {
        await createOrUpdateMicrosoftIdentityReview(client, {
          tenantId: emailMembership.tenant_id,
          identity,
          reasonCode: "matched_membership_inactive",
          notes: `Matched employee record is ${emailMembership.status}.`
        });
        await createMicrosoftIdentityAudit(
          client,
          emailMembership.tenant_id,
          emailMembership.id,
          "auth.microsoft.login.review_needed",
          {
            email: identity.email,
            reason_code: "matched_membership_inactive",
            membership_status: emailMembership.status
          },
          metadata
        );
        await recordMicrosoftIntegrationEvent(client, {
          tenantId: emailMembership.tenant_id,
          integrationArea: "account_linking",
          eventLevel: "warning",
          eventType: "auth.microsoft.review_needed.inactive_membership",
          summary: "Microsoft sign-in matched an inactive employee record and requires admin review.",
          detail: {
            email: identity.email,
            membership_status: emailMembership.status
          },
          relatedEntityType: "app_user",
          relatedEntityId: emailMembership.id
        });
        return buildAuthCallbackRedirect({
          status: "pending_review",
          notice: "Your Microsoft account was found, but the employee record still needs admin approval.",
          returnHash: state.return_hash,
          email: identity.email
        });
      }

      const authorization = await resolveMicrosoftEntraAuthorizationForMembership(client, emailMembership, identity);
      if (!authorization.sign_in_allowed) {
        return buildDeniedMicrosoftAuthorizationRedirect(client, emailMembership, identity, authorization, state.return_hash, metadata);
      }
      const session = await finalizeMicrosoftLogin(client, emailMembership, identity, authorization, metadata, {
        auditAction: "auth.microsoft.login.success",
        linkReason: "email_match"
      });
      return buildAuthCallbackRedirect({
        status: "signed_in",
        notice: "Signed in with Microsoft.",
        token: session.token,
        returnHash: state.return_hash
      });
    }

    const reviewTenantId = await resolveReviewTenantId(client, identity.email, identity.microsoftTenantId);
    await createOrUpdateMicrosoftIdentityReview(client, {
      tenantId: reviewTenantId,
      identity,
      reasonCode: "unmatched_email"
    });
    await createMicrosoftIdentityAudit(
      client,
      reviewTenantId,
      null,
      "auth.microsoft.login.review_needed",
      {
        email: identity.email,
        reason_code: "unmatched_email"
      },
      metadata
    );
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: reviewTenantId,
      integrationArea: "account_linking",
      eventLevel: "warning",
      eventType: "auth.microsoft.review_needed.unmatched_email",
      summary: "Microsoft sign-in could not be linked to an employee record and requires admin review.",
      detail: {
        email: identity.email,
        reason_code: "unmatched_email"
      }
    });
    return buildAuthCallbackRedirect({
      status: "pending_review",
      notice: "Your Microsoft account is waiting for admin review before access can be granted.",
      returnHash: state.return_hash,
      email: identity.email
    });
  } catch (error) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "auth",
      eventLevel: "error",
      eventType: "auth.microsoft.callback.exchange_failed",
      summary: "Microsoft sign-in failed during code exchange or profile lookup.",
      detail: {
        reason_code: "callback_exchange_failed",
        message: error instanceof Error ? error.message : "Unknown Microsoft auth failure."
      }
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: error instanceof Error ? error.message : "Microsoft sign-in failed.",
      returnHash: state.return_hash,
      reasonCode: "callback_exchange_failed"
    });
  }
}

async function resolveMicrosoftEntraAuthorizationForMembership(
  client: PoolClient,
  membership: MicrosoftMembershipRow,
  identity: MicrosoftIdentity
) {
  const contract = await getMicrosoftEntraAuthorizationContract(client, membership.tenant_id);
  return resolveMicrosoftEntraAuthorization({
    contract,
    claims: identity.claimsSnapshot,
    currentAuthorityTier: membership.authority_tier ?? null
  });
}

async function buildDeniedMicrosoftAuthorizationRedirect(
  client: PoolClient,
  membership: MicrosoftMembershipRow,
  identity: MicrosoftIdentity,
  authorization: MicrosoftEntraAuthorizationState,
  returnHash: string | null,
  metadata: RequestAuditContext
) {
  const message =
    authorization.issues.find((issue) => issue.severity === "error")?.message ||
    "Your Microsoft assignment does not grant access to Mission Control yet.";
  await createMicrosoftIdentityAudit(
    client,
    membership.tenant_id,
    membership.id,
    "auth.microsoft.login.denied",
    {
      email: identity.email,
      microsoft_user_id: identity.microsoftUserId,
      microsoft_tenant_id: identity.microsoftTenantId,
      authorization_issues: authorization.issues,
      resolved_authority_tier: authorization.resolved.authority_tier,
      mapped_app_roles: authorization.resolved.mapped_app_roles,
      mapped_group_ids: authorization.resolved.mapped_group_ids
    },
    metadata,
    membership.id
  );
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: membership.tenant_id,
    integrationArea: "auth",
    eventLevel: "warning",
    eventType: "auth.microsoft.login.denied",
    summary: "Microsoft sign-in was denied because the Entra assignment contract did not resolve to an allowed Mission Control access profile.",
    detail: {
      email: identity.email,
      authorization_issues: authorization.issues,
      mapped_app_roles: authorization.resolved.mapped_app_roles,
      mapped_group_ids: authorization.resolved.mapped_group_ids
    },
    relatedEntityType: "app_user",
    relatedEntityId: membership.id
  });
  return buildAuthCallbackRedirect({
    status: "error",
    notice: message,
    returnHash,
    reasonCode: "authorization_denied"
  });
}

async function completeMicrosoftEntraStepUp(
  client: PoolClient,
  state: MicrosoftAuthStateRow,
  identity: MicrosoftIdentity,
  metadata: RequestAuditContext
) {
  if (!state.session_id) {
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "The Microsoft step-up request is missing a target session.",
      returnHash: state.return_hash,
      reasonCode: "step_up_session_missing"
    });
  }

  const auth = await loadAuthenticatedUserBySession(client, state.session_id);
  if (!auth) {
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "The original session for Microsoft step-up is no longer active.",
      returnHash: state.return_hash,
      reasonCode: "step_up_session_invalid"
    });
  }

  if (auth.sessionTrust.identityProvider !== "microsoft_entra") {
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "This step-up flow only applies to Microsoft Entra sessions.",
      returnHash: state.return_hash,
      reasonCode: "step_up_provider_mismatch"
    });
  }

  const expectedMicrosoftUserId = auth.communicationIdentity?.microsoftUserId;
  const expectedMicrosoftTenantId = auth.communicationIdentity?.microsoftTenantId;
  if (
    !expectedMicrosoftUserId ||
    !expectedMicrosoftTenantId ||
    expectedMicrosoftUserId !== identity.microsoftUserId ||
    expectedMicrosoftTenantId !== identity.microsoftTenantId
  ) {
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: auth.tenantId,
      integrationArea: "auth",
      eventLevel: "warning",
      eventType: "auth.microsoft.step_up.identity_mismatch",
      summary: "Microsoft step-up returned a different identity than the currently linked Mission Control session.",
      detail: {
        expected_microsoft_user_id: expectedMicrosoftUserId,
        expected_microsoft_tenant_id: expectedMicrosoftTenantId,
        returned_microsoft_user_id: identity.microsoftUserId,
        returned_microsoft_tenant_id: identity.microsoftTenantId
      },
      actorUserId: auth.id,
      relatedEntityType: "session",
      relatedEntityId: auth.sessionId
    });
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "The Microsoft step-up completed with a different account than the current Mission Control session.",
      returnHash: state.return_hash,
      reasonCode: "step_up_identity_mismatch"
    });
  }

  const contract = await getMicrosoftEntraAuthorizationContract(client, auth.tenantId);
  const authorization = resolveMicrosoftEntraAuthorization({
    contract,
    claims: identity.claimsSnapshot,
    currentAuthorityTier: auth.authorityTier as AuthorityTier
  });

  if (!authorization.sign_in_allowed) {
    return buildAuthCallbackRedirect({
      status: "error",
      notice:
        authorization.issues.find((issue) => issue.severity === "error")?.message ||
        "The Microsoft session no longer resolves to an allowed Mission Control access profile.",
      returnHash: state.return_hash,
      reasonCode: "step_up_authorization_denied"
    });
  }

  if (
    state.requested_auth_context_id &&
    !identity.claimsSnapshot.auth_context_ids.includes(state.requested_auth_context_id)
  ) {
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "Microsoft step-up completed, but the required authentication context was not satisfied.",
      returnHash: state.return_hash,
      reasonCode: "step_up_auth_context_missing"
    });
  }

  if (
    state.requested_assurance &&
    !isSessionAssuranceAtLeast(identity.claimsSnapshot.session_assurance, state.requested_assurance)
  ) {
    return buildAuthCallbackRedirect({
      status: "error",
      notice: "Microsoft step-up completed without the required authentication strength.",
      returnHash: state.return_hash,
      reasonCode: "step_up_assurance_missing"
    });
  }

  const reauthenticatedAt = new Date().toISOString();
  await updateSessionIdentityTrust(client, {
    sessionId: auth.sessionId,
    sessionAssurance: identity.claimsSnapshot.session_assurance,
    lastReauthenticatedAt: reauthenticatedAt,
    activeAuthContextIds: identity.claimsSnapshot.auth_context_ids,
    identityClaims: identity.claimsSnapshot.raw_claims,
    identityAuthorization: authorization
  });

  await createMicrosoftIdentityAudit(
    client,
    auth.tenantId,
    auth.id,
    "auth.microsoft.step_up.completed",
    {
      action_key: state.requested_action_key,
      required_auth_context_id: state.requested_auth_context_id,
      required_assurance: state.requested_assurance,
      auth_context_ids: identity.claimsSnapshot.auth_context_ids,
      session_assurance: identity.claimsSnapshot.session_assurance
    },
    metadata,
    auth.id
  );
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: auth.tenantId,
    integrationArea: "auth",
    eventLevel: "info",
    eventType: "auth.microsoft.step_up.completed",
    summary: "Microsoft enterprise step-up completed and refreshed the session assurance state.",
    detail: {
      action_key: state.requested_action_key,
      auth_context_ids: identity.claimsSnapshot.auth_context_ids,
      session_assurance: identity.claimsSnapshot.session_assurance
    },
    actorUserId: auth.id,
    relatedEntityType: "session",
    relatedEntityId: auth.sessionId
  });

  return buildAuthCallbackRedirect({
    status: "step_up_complete",
    notice: "Microsoft reauthentication completed. Retry the privileged action.",
    returnHash: state.return_hash
  });
}

export function buildMicrosoftLogoutUrl() {
  if (!isMicrosoftEntraAuthEnabled()) {
    return config.ADMIN_WEB_URL;
  }
  const params = new URLSearchParams({
    post_logout_redirect_uri: getMicrosoftPostLogoutRedirectUri()
  });
  return `https://login.microsoftonline.com/${config.MICROSOFT_GRAPH_TENANT_ID}/oauth2/v2.0/logout?${params.toString()}`;
}

export async function listMicrosoftIdentityReviews(client: PoolClient, auth: AuthUser) {
  const includeUnscoped = auth.authorityTier === "super_admin";
  const { rows } = await client.query<MicrosoftIdentityReviewRow>(
    `
      SELECT
        review.id,
        review.tenant_id,
        tenant.name AS tenant_name,
        review.email,
        review.full_name,
        review.microsoft_user_id,
        review.microsoft_tenant_id,
        review.auth_provider,
        review.review_status,
        review.reason_code,
        review.matched_user_id,
        review.matched_account_id,
        matched.email AS matched_user_email,
        matched.full_name AS matched_user_name,
        matched.status::text AS matched_user_status,
        matched.department::text AS matched_user_department,
        matched_assignment.authority_tier::text AS matched_user_authority_tier,
        matched_assignment.primary_job_function_profile::text AS matched_user_primary_job_function_profile,
        COALESCE(
          array_agg(DISTINCT matched_profile.job_function_profile::text)
            FILTER (WHERE matched_profile.job_function_profile IS NOT NULL),
          '{}'
        ) AS matched_user_job_function_profiles,
        review.reviewed_by_user_id,
        reviewer.full_name AS reviewed_by_name,
        review.reviewed_at::text AS reviewed_at,
        review.linked_at::text AS linked_at,
        review.last_login_at::text AS last_login_at,
        review.notes,
        review.metadata,
        review.created_at::text AS created_at,
        review.updated_at::text AS updated_at
      FROM microsoft_identity_review review
      LEFT JOIN tenant ON tenant.id = review.tenant_id
      LEFT JOIN app_user matched ON matched.id = review.matched_user_id
      LEFT JOIN user_authority_assignment matched_assignment
        ON matched_assignment.user_id = matched.id
       AND matched_assignment.tenant_id = matched.tenant_id
      LEFT JOIN user_job_function_profile matched_profile
        ON matched_profile.user_id = matched.id
       AND matched_profile.tenant_id = matched.tenant_id
      LEFT JOIN app_user reviewer ON reviewer.id = review.reviewed_by_user_id
      WHERE review.review_status = 'pending_review'
        AND (review.tenant_id = $1 OR ($2::boolean = true AND review.tenant_id IS NULL))
      GROUP BY
        review.id,
        tenant.name,
        matched.id,
        matched_assignment.authority_tier,
        matched_assignment.primary_job_function_profile,
        reviewer.full_name
      ORDER BY review.created_at ASC
    `,
    [auth.tenantId, includeUnscoped]
  );

  return rows.map((row) => ({
    ...row,
    matched_user_internal_role_groups:
      row.matched_user_id && row.matched_user_department
        ? deriveInternalRoleGroups({
            authorityTier: row.matched_user_authority_tier ?? null,
            department: row.matched_user_department,
            primaryJobFunctionProfile: row.matched_user_primary_job_function_profile ?? null,
            jobFunctionProfiles: row.matched_user_job_function_profiles ?? []
          })
        : []
  })) satisfies MicrosoftReviewRecord[];
}

export async function linkMicrosoftIdentityReview(
  client: PoolClient,
  auth: AuthUser,
  input: { reviewId: string; targetUserId: string; note?: string | null },
  metadata: RequestAuditContext = {}
) {
  const review = await loadPendingReviewById(client, auth, input.reviewId);
  if (!review) {
    throw new ApiError(404, "Review record not found");
  }

  const membership = await loadMembershipById(client, auth.tenantId, input.targetUserId);
  if (!membership) {
    throw new ApiError(404, "Employee record not found");
  }

  const identity: MicrosoftIdentity = {
    microsoftUserId: review.microsoft_user_id,
    microsoftTenantId: review.microsoft_tenant_id,
    email: normalizeEmail(review.email),
    fullName: review.full_name,
    scopes: [],
    claimsSnapshot: extractMicrosoftEntraClaimsSnapshot({
      claims: {},
      scopes: [],
      tenantId: review.microsoft_tenant_id,
      userId: review.microsoft_user_id,
      email: normalizeEmail(review.email)
    })
  };

  const linkedAccount = await linkMicrosoftIdentityToMembership(client, membership, identity);
  await upsertMicrosoftTenantMapping(client, membership.tenant_id, identity.microsoftTenantId);

  await client.query(
    `
      UPDATE microsoft_identity_review
      SET tenant_id = $2,
          matched_user_id = $3,
          matched_account_id = $4,
          review_status = 'linked',
          reviewed_by_user_id = $5,
          reviewed_at = now(),
          linked_at = now(),
          notes = $6,
          updated_at = now()
      WHERE id = $1
    `,
    [
      review.id,
      membership.tenant_id,
      membership.id,
      linkedAccount.id,
      auth.id,
      input.note?.trim() || `Linked to ${membership.email}.`
    ]
  );

  await createMicrosoftIdentityAudit(
    client,
    membership.tenant_id,
    membership.id,
    "auth.microsoft.identity_linked",
    {
      email: identity.email,
      microsoft_user_id: identity.microsoftUserId,
      reason: "admin_review_linked"
    },
    metadata,
    auth.id
  );
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: membership.tenant_id,
    integrationArea: "account_linking",
    eventLevel: "info",
    eventType: "auth.microsoft.identity_linked",
    summary: "An admin linked a pending Microsoft identity review to an employee account.",
    detail: {
      email: identity.email,
      reason: "admin_review_linked"
    },
    actorUserId: auth.id,
    relatedEntityType: "app_user",
    relatedEntityId: membership.id
  });
}

export async function rejectMicrosoftIdentityReview(
  client: PoolClient,
  auth: AuthUser,
  input: { reviewId: string; reason: string },
  metadata: RequestAuditContext = {}
) {
  const review = await loadPendingReviewById(client, auth, input.reviewId);
  if (!review) {
    throw new ApiError(404, "Review record not found");
  }

  await client.query(
    `
      UPDATE microsoft_identity_review
      SET review_status = 'rejected',
          reviewed_by_user_id = $2,
          reviewed_at = now(),
          notes = $3,
          updated_at = now()
      WHERE id = $1
    `,
    [review.id, auth.id, input.reason.trim()]
  );

  await createMicrosoftIdentityAudit(
    client,
    review.tenant_id ?? auth.tenantId,
    null,
    "auth.microsoft.review_rejected",
    {
      email: review.email,
      microsoft_user_id: review.microsoft_user_id,
      reason: input.reason.trim()
    },
    metadata,
    auth.id
  );
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: review.tenant_id ?? auth.tenantId,
    integrationArea: "account_linking",
    eventLevel: "warning",
    eventType: "auth.microsoft.review_rejected",
    summary: "A pending Microsoft identity review was rejected by an admin.",
    detail: {
      email: review.email,
      reason: input.reason.trim()
    },
    actorUserId: auth.id,
    relatedEntityType: "microsoft_identity_review",
    relatedEntityId: review.id
  });
}

async function finalizeMicrosoftLogin(
  client: PoolClient,
  membership: MicrosoftMembershipRow,
  identity: MicrosoftIdentity,
  authorization: MicrosoftEntraAuthorizationState,
  metadata: RequestAuditContext,
  options: {
    auditAction: string;
    linkReason: "existing_link" | "email_match";
  }
) {
  const linkResult = await linkMicrosoftIdentityToMembership(client, membership, identity);
  await upsertMicrosoftTenantMapping(client, membership.tenant_id, identity.microsoftTenantId);

  const session = await issueAuthSession(client, {
    userId: membership.id,
    tenantId: membership.tenant_id,
    authVersion: membership.auth_version,
    provider: "microsoft_entra",
    metadata,
    sessionAssurance: identity.claimsSnapshot.session_assurance,
    lastReauthenticatedAt: new Date().toISOString(),
    activeAuthContextIds: identity.claimsSnapshot.auth_context_ids,
    identityClaims: identity.claimsSnapshot.raw_claims,
    identityAuthorization: authorization
  });

  await client.query("UPDATE app_user SET last_login_at = now() WHERE id = $1", [membership.id]);
  await client.query(
    `
      UPDATE user_account
      SET last_login_at = now(),
          communication_enabled = true,
          last_verified_at = now(),
          updated_at = now()
      WHERE id = $1
    `,
    [linkResult.id]
  );

  if (linkResult.newlyLinked || options.linkReason === "email_match") {
    await createMicrosoftIdentityAudit(
      client,
      membership.tenant_id,
      membership.id,
      "auth.microsoft.identity_linked",
      {
        email: identity.email,
        microsoft_user_id: identity.microsoftUserId,
        microsoft_tenant_id: identity.microsoftTenantId,
        reason: options.linkReason
      },
      metadata,
      membership.id
    );
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: membership.tenant_id,
      integrationArea: "account_linking",
      eventLevel: "info",
      eventType: "auth.microsoft.identity_linked",
      summary: "A Microsoft identity was linked to an employee account during sign-in.",
      detail: {
        email: identity.email,
        reason: options.linkReason
      },
      actorUserId: membership.id,
      relatedEntityType: "app_user",
      relatedEntityId: membership.id
    });
  }

  await createMicrosoftIdentityAudit(
    client,
    membership.tenant_id,
    membership.id,
    options.auditAction,
      {
        email: identity.email,
        microsoft_user_id: identity.microsoftUserId,
        microsoft_tenant_id: identity.microsoftTenantId,
        entra_app_roles: identity.claimsSnapshot.app_role_values,
        entra_group_ids: identity.claimsSnapshot.group_ids,
        entra_auth_context_ids: identity.claimsSnapshot.auth_context_ids,
        session_assurance: identity.claimsSnapshot.session_assurance,
        authorization_issues: authorization.issues,
        resolved_authority_tier: authorization.resolved.authority_tier,
        resolved_internal_role_groups: authorization.resolved.internal_role_groups,
        resolved_policy_roles: authorization.resolved.policy_roles,
        resolved_permission_keys: authorization.resolved.permission_keys,
        internal_role_groups: deriveInternalRoleGroups({
          authorityTier: membership.authority_tier ?? null,
          department: membership.department,
        primaryJobFunctionProfile: membership.primary_job_function_profile ?? null,
        jobFunctionProfiles: membership.job_function_profiles ?? []
      })
    },
    metadata,
    membership.id
  );
  await recordMicrosoftIntegrationEvent(client, {
    tenantId: membership.tenant_id,
    integrationArea: "auth",
    eventLevel: "info",
    eventType: "auth.microsoft.login.success",
    summary: "Microsoft sign-in completed successfully for an employee account.",
    detail: {
      email: identity.email,
      link_reason: options.linkReason
    },
    actorUserId: membership.id,
    relatedEntityType: "app_user",
    relatedEntityId: membership.id
  });

  return session;
}

async function linkMicrosoftIdentityToMembership(client: PoolClient, membership: MicrosoftMembershipRow, identity: MicrosoftIdentity) {
  const existingAccount = membership.account_id
    ? await loadUserAccountById(client, membership.account_id)
    : await loadUserAccountByEmail(client, membership.email);

  if (
    existingAccount?.microsoft_user_id &&
    (existingAccount.microsoft_user_id !== identity.microsoftUserId || existingAccount.microsoft_tenant_id !== identity.microsoftTenantId)
  ) {
    throw new ApiError(409, "This employee record is already linked to a different Microsoft account.");
  }

  if (!existingAccount) {
    const { rows } = await client.query<UserAccountRow>(
      `
        INSERT INTO user_account (
          email,
          full_name,
          is_email_verified,
          microsoft_user_id,
          microsoft_tenant_id,
          auth_provider,
          linked_at,
          last_login_at,
          communication_enabled,
          last_verified_at
        )
        VALUES ($1, $2, true, $3, $4, 'microsoft_entra', now(), now(), true, now())
        RETURNING
          id,
          email,
          full_name,
          microsoft_user_id,
          microsoft_tenant_id,
          auth_provider,
          linked_at::text AS linked_at,
          communication_enabled,
          teams_chat_default_target,
          last_verified_at::text AS last_verified_at
      `,
      [identity.email, identity.fullName, identity.microsoftUserId, identity.microsoftTenantId]
    );
    const account = rows[0];
    await client.query(
      `
        UPDATE app_user
        SET account_id = $2,
            full_name = CASE
              WHEN full_name = email OR trim(full_name) = '' THEN $3
              ELSE full_name
            END
        WHERE id = $1
      `,
      [membership.id, account.id, identity.fullName]
    );
    return { ...account, newlyLinked: true };
  }

  const { rows } = await client.query<UserAccountRow>(
    `
      UPDATE user_account
      SET email = $2,
          full_name = CASE WHEN trim(full_name) = '' THEN $3 ELSE full_name END,
          is_email_verified = true,
          microsoft_user_id = $4,
          microsoft_tenant_id = $5,
          auth_provider = 'microsoft_entra',
          communication_enabled = true,
          linked_at = COALESCE(linked_at, now()),
          last_login_at = now(),
          last_verified_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        email,
        full_name,
        microsoft_user_id,
        microsoft_tenant_id,
        auth_provider,
        linked_at::text AS linked_at,
        communication_enabled,
        teams_chat_default_target,
        last_verified_at::text AS last_verified_at
    `,
    [existingAccount.id, identity.email, identity.fullName, identity.microsoftUserId, identity.microsoftTenantId]
  );

  await client.query(
    `
      UPDATE app_user
      SET account_id = $2
      WHERE id = $1
        AND account_id IS DISTINCT FROM $2
    `,
    [membership.id, existingAccount.id]
  );

  return { ...rows[0], newlyLinked: !existingAccount.microsoft_user_id };
}

async function createOrUpdateMicrosoftIdentityReview(
  client: PoolClient,
  input: { tenantId: string | null; identity: MicrosoftIdentity; reasonCode: string; notes?: string | null }
) {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM microsoft_identity_review
      WHERE microsoft_tenant_id = $1
        AND microsoft_user_id = $2
        AND review_status = 'pending_review'
      LIMIT 1
    `,
    [input.identity.microsoftTenantId, input.identity.microsoftUserId]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE microsoft_identity_review
        SET tenant_id = COALESCE($2, tenant_id),
            email = $3,
            full_name = $4,
            reason_code = $5,
            last_login_at = now(),
            notes = COALESCE($6, notes),
            updated_at = now()
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        input.tenantId,
        input.identity.email,
        input.identity.fullName,
        input.reasonCode,
        input.notes?.trim() || null
      ]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO microsoft_identity_review (
        tenant_id,
        email,
        full_name,
        microsoft_user_id,
        microsoft_tenant_id,
        auth_provider,
        review_status,
        reason_code,
        notes,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, 'microsoft_entra', 'pending_review', $6, $7, $8)
      RETURNING id
    `,
    [
      input.tenantId,
      input.identity.email,
      input.identity.fullName,
      input.identity.microsoftUserId,
      input.identity.microsoftTenantId,
      input.reasonCode,
      input.notes?.trim() || null,
      JSON.stringify({ scopes: input.identity.scopes })
    ]
  );

  return inserted.rows[0].id;
}

async function consumeMicrosoftAuthState(client: PoolClient, rawState: string) {
  const { rows } = await client.query<MicrosoftAuthStateRow>(
    `
      UPDATE microsoft_auth_state
      SET consumed_at = now()
      WHERE state_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING
        id,
        return_hash,
        flow_purpose,
        session_id,
        requested_action_key,
        requested_auth_context_id,
        requested_assurance,
        state_context
    `,
    [hashOpaqueToken(rawState)]
  );
  return rows[0] ?? null;
}

async function exchangeMicrosoftAuthorizationCode(code: string, codeVerifier: string) {
  const response = await fetchWithTimeout(
    `https://login.microsoftonline.com/${config.MICROSOFT_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.MICROSOFT_GRAPH_CLIENT_ID,
        client_secret: config.MICROSOFT_GRAPH_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: getMicrosoftEntraRedirectUri(),
        code_verifier: codeVerifier
      })
    }
  );

  const payload = (await response.json()) as MicrosoftTokenResponse;
  if (!response.ok || !payload.access_token || !payload.id_token) {
    throw new ApiError(401, payload.error_description ?? "Microsoft token exchange failed.");
  }
  return payload;
}

async function fetchMicrosoftIdentity(
  tokens: MicrosoftTokenResponse,
  expected: {
    expectedClientId: string;
    expectedNonce: string;
    expectedTenantId: string;
  }
): Promise<MicrosoftIdentity> {
  const claims = decodeJwt(tokens.id_token ?? "");
  assertMicrosoftIdTokenClaims(claims, expected);
  const graphProfile = await fetchMicrosoftGraphProfile(tokens.access_token ?? "");
  const scopes = (tokens.scope ?? "")
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean);

  const microsoftUserId = stringifyClaim(claims.oid) || graphProfile.id?.trim() || "";
  const microsoftTenantId = stringifyClaim(claims.tid) || "";
  const email = normalizeEmail(
    graphProfile.mail?.trim() ||
      graphProfile.userPrincipalName?.trim() ||
      stringifyClaim(claims.email) ||
      stringifyClaim(claims.preferred_username) ||
      ""
  );
  const fullName =
    graphProfile.displayName?.trim() ||
    stringifyClaim(claims.name) ||
    [graphProfile.givenName?.trim(), graphProfile.surname?.trim()].filter(Boolean).join(" ") ||
    email;

  if (!microsoftUserId || !microsoftTenantId || !email) {
    throw new ApiError(400, "Microsoft sign-in did not provide a usable work email.");
  }

  return {
    microsoftUserId,
    microsoftTenantId,
    email,
    fullName,
    scopes,
    claimsSnapshot: extractMicrosoftEntraClaimsSnapshot({
      claims,
      scopes,
      tenantId: microsoftTenantId,
      userId: microsoftUserId,
      email
    })
  };
}

async function fetchMicrosoftGraphProfile(accessToken: string) {
  const response = await fetchWithTimeout(`${MICROSOFT_GRAPH_BASE}/me?$select=id,displayName,mail,userPrincipalName,givenName,surname`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const payload = (await response.json()) as MicrosoftGraphUser;
  if (!response.ok) {
    throw new ApiError(401, payload.error?.message ?? "Microsoft profile lookup failed.");
  }
  return payload;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OUTLOOK_GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "Microsoft sign-in timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadMembershipByMicrosoftIdentity(client: PoolClient, microsoftTenantId: string, microsoftUserId: string) {
  const { rows } = await client.query<MicrosoftMembershipRow>(
    membershipSelectSql(`
      a.microsoft_tenant_id = $1
      AND a.microsoft_user_id = $2
    `),
    [microsoftTenantId, microsoftUserId]
  );
  return rows[0] ?? null;
}

async function loadMembershipsByEmail(client: PoolClient, email: string) {
  const { rows } = await client.query<MicrosoftMembershipRow>(
    membershipSelectSql(`
      lower(u.email) = lower($1)
    `),
    [email]
  );
  return rows;
}

async function loadMembershipById(client: PoolClient, tenantId: string, userId: string) {
  const { rows } = await client.query<MicrosoftMembershipRow>(
    membershipSelectSql(`
      u.tenant_id = $1
      AND u.id = $2
    `),
    [tenantId, userId]
  );
  return rows[0] ?? null;
}

function membershipSelectSql(whereClause: string) {
  return `
    SELECT
      u.id,
      u.tenant_id,
      u.account_id,
      u.email,
      u.full_name,
      u.status::text AS status,
      u.department::text AS department,
      u.auth_version,
      uaa.authority_tier::text AS authority_tier,
      uaa.primary_job_function_profile::text AS primary_job_function_profile,
      COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles,
      COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
      a.microsoft_user_id,
      a.microsoft_tenant_id,
      a.auth_provider AS account_auth_provider
    FROM app_user u
    LEFT JOIN user_account a ON a.id = u.account_id
    LEFT JOIN user_authority_assignment uaa ON uaa.user_id = u.id AND uaa.tenant_id = u.tenant_id
    LEFT JOIN user_job_function_profile ujp ON ujp.user_id = u.id AND ujp.tenant_id = u.tenant_id
    LEFT JOIN user_role ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
    LEFT JOIN role r ON r.id = ur.role_id
    WHERE ${whereClause}
    GROUP BY u.id, uaa.authority_tier, uaa.primary_job_function_profile, a.microsoft_user_id, a.microsoft_tenant_id, a.auth_provider
    ORDER BY CASE u.status
      WHEN 'active' THEN 1
      WHEN 'pending_approval' THEN 2
      WHEN 'invited' THEN 3
      WHEN 'suspended' THEN 4
      WHEN 'revoked' THEN 5
      ELSE 99
    END, u.created_at ASC
  `;
}

async function loadUserAccountById(client: PoolClient, accountId: string) {
  const { rows } = await client.query<UserAccountRow>(
    `
      SELECT
        id,
        email,
        full_name,
        microsoft_user_id,
        microsoft_tenant_id,
        auth_provider,
        linked_at::text AS linked_at,
        COALESCE(communication_enabled, false) AS communication_enabled,
        teams_chat_default_target,
        last_verified_at::text AS last_verified_at
      FROM user_account
      WHERE id = $1
      LIMIT 1
    `,
    [accountId]
  );
  return rows[0] ?? null;
}

async function loadUserAccountByEmail(client: PoolClient, email: string) {
  const { rows } = await client.query<UserAccountRow>(
    `
      SELECT
        id,
        email,
        full_name,
        microsoft_user_id,
        microsoft_tenant_id,
        auth_provider,
        linked_at::text AS linked_at,
        COALESCE(communication_enabled, false) AS communication_enabled,
        teams_chat_default_target,
        last_verified_at::text AS last_verified_at
      FROM user_account
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    [email]
  );
  return rows[0] ?? null;
}

async function resolveReviewTenantId(client: PoolClient, email: string, microsoftTenantId: string) {
  const emailMatch = await client.query<{ tenant_id: string }>(
    `
      SELECT tenant_id
      FROM app_user
      WHERE lower(email) = lower($1)
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [email]
  );
  if (emailMatch.rows[0]?.tenant_id) {
    return emailMatch.rows[0].tenant_id;
  }

  const mapping = await client.query<{ tenant_id: string }>(
    `
      SELECT tenant_id
      FROM microsoft_tenant_mapping
      WHERE microsoft_tenant_id = $1
      LIMIT 1
    `,
    [microsoftTenantId]
  );
  if (mapping.rows[0]?.tenant_id) {
    return mapping.rows[0].tenant_id;
  }

  const tenants = await client.query<{ id: string }>(
    `
      SELECT id
      FROM tenant
      ORDER BY created_at ASC
      LIMIT 2
    `
  );
  return tenants.rows.length === 1 ? tenants.rows[0].id : null;
}

async function upsertMicrosoftTenantMapping(client: PoolClient, tenantId: string, microsoftTenantId: string) {
  await client.query(
    `
      INSERT INTO microsoft_tenant_mapping (tenant_id, microsoft_tenant_id, last_linked_at, updated_at)
      VALUES ($1, $2, now(), now())
      ON CONFLICT (microsoft_tenant_id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          last_linked_at = now(),
          updated_at = now()
    `,
    [tenantId, microsoftTenantId]
  );
}

async function loadPendingReviewById(client: PoolClient, auth: AuthUser, reviewId: string) {
  const includeUnscoped = auth.authorityTier === "super_admin";
  const { rows } = await client.query<MicrosoftIdentityReviewRow>(
    `
      SELECT
        review.id,
        review.tenant_id,
        tenant.name AS tenant_name,
        review.email,
        review.full_name,
        review.microsoft_user_id,
        review.microsoft_tenant_id,
        review.auth_provider,
        review.review_status,
        review.reason_code,
        review.matched_user_id,
        review.matched_account_id,
        matched.email AS matched_user_email,
        matched.full_name AS matched_user_name,
        matched.status::text AS matched_user_status,
        matched.department::text AS matched_user_department,
        matched_assignment.authority_tier::text AS matched_user_authority_tier,
        matched_assignment.primary_job_function_profile::text AS matched_user_primary_job_function_profile,
        COALESCE(
          array_agg(DISTINCT matched_profile.job_function_profile::text)
            FILTER (WHERE matched_profile.job_function_profile IS NOT NULL),
          '{}'
        ) AS matched_user_job_function_profiles,
        review.reviewed_by_user_id,
        reviewer.full_name AS reviewed_by_name,
        review.reviewed_at::text AS reviewed_at,
        review.linked_at::text AS linked_at,
        review.last_login_at::text AS last_login_at,
        review.notes,
        review.metadata,
        review.created_at::text AS created_at,
        review.updated_at::text AS updated_at
      FROM microsoft_identity_review review
      LEFT JOIN tenant ON tenant.id = review.tenant_id
      LEFT JOIN app_user matched ON matched.id = review.matched_user_id
      LEFT JOIN user_authority_assignment matched_assignment
        ON matched_assignment.user_id = matched.id
       AND matched_assignment.tenant_id = matched.tenant_id
      LEFT JOIN user_job_function_profile matched_profile
        ON matched_profile.user_id = matched.id
       AND matched_profile.tenant_id = matched.tenant_id
      LEFT JOIN app_user reviewer ON reviewer.id = review.reviewed_by_user_id
      WHERE review.id = $1
        AND review.review_status = 'pending_review'
        AND (review.tenant_id = $2 OR ($3::boolean = true AND review.tenant_id IS NULL))
      GROUP BY
        review.id,
        tenant.name,
        matched.id,
        matched_assignment.authority_tier,
        matched_assignment.primary_job_function_profile,
        reviewer.full_name
      LIMIT 1
    `,
    [reviewId, auth.tenantId, includeUnscoped]
  );
  return rows[0] ?? null;
}

async function createMicrosoftIdentityAudit(
  client: PoolClient,
  tenantId: string | null,
  targetUserId: string | null,
  action: string,
  metadataPayload: Record<string, unknown>,
  requestMeta: RequestAuditContext = {},
  actorUserId: string | null = null
) {
  if (!tenantId) {
    return;
  }

  await createAuditLog(client, {
    tenantId,
    actorUserId,
    targetUserId,
    action,
    entityType: "microsoft_identity",
    entityId: targetUserId ?? null,
    metadata: metadataPayload,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  const normalizedAction = action.toLowerCase();
  const result = normalizedAction.includes("rejected")
    ? "rejected"
    : normalizedAction.includes("review_needed")
      ? "pending_review"
      : normalizedAction.includes("linked") || normalizedAction.includes("signed_in")
        ? "success"
        : "observed";

  await writeCommunicationAuditEvent(client, {
    tenantId,
    actorUserId,
    targetUserId,
    eventType: action,
    resourceType: "microsoft_identity",
    resourceId: targetUserId ?? null,
    result,
    context: metadataPayload
  });
}

function sanitizeReturnHash(returnHash: string | null) {
  if (!returnHash) {
    return null;
  }
  return returnHash.startsWith("#") ? returnHash : null;
}

function buildAuthCallbackRedirect(input: {
  status: "signed_in" | "pending_review" | "error" | "step_up_complete";
  notice: string;
  token?: string;
  email?: string;
  returnHash?: string | null;
  reasonCode?: string;
}) {
  const params = new URLSearchParams({
    status: input.status,
    notice: input.notice
  });
  if (input.token) {
    params.set("token", input.token);
  }
  if (input.email) {
    params.set("email", input.email);
  }
  if (input.returnHash) {
    params.set("return_hash", input.returnHash);
  }
  if (input.reasonCode) {
    params.set("reason", input.reasonCode);
  }
  return `${config.ADMIN_WEB_URL.replace(/\/$/, "")}/#auth/callback?${params.toString()}`;
}

function getMicrosoftEntraRedirectUri() {
  return validateMicrosoftRedirectUri(
    config.MICROSOFT_ENTRA_REDIRECT_URI || `http://localhost:${config.API_PORT}${MICROSOFT_ENTRA_CALLBACK_PATH}`,
    MICROSOFT_ENTRA_CALLBACK_PATH,
    "Microsoft Entra redirect URI"
  );
}

function getMicrosoftPostLogoutRedirectUri() {
  return validateMicrosoftRedirectUri(
    config.MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI || config.ADMIN_WEB_URL,
    null,
    "Microsoft Entra post-logout redirect URI"
  );
}

function stringifyClaim(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function extractMicrosoftPkceVerifier(state: MicrosoftAuthStateRow, rawState: string) {
  const ciphertext = state.state_context?.pkce_verifier_ciphertext;
  if (typeof ciphertext !== "string" || ciphertext.trim() === "") {
    throw new ApiError(401, "Microsoft sign-in could not verify the PKCE challenge.");
  }
  return decryptSecret(ciphertext, hashOpaqueToken(rawState));
}

function extractMicrosoftNonce(state: MicrosoftAuthStateRow) {
  const nonce = state.state_context?.nonce;
  if (typeof nonce !== "string" || nonce.trim() === "") {
    throw new ApiError(401, "Microsoft sign-in did not return a valid nonce.");
  }
  return nonce;
}

function assertMicrosoftIdTokenClaims(
  claims: ReturnType<typeof decodeJwt>,
  expected: {
    expectedClientId: string;
    expectedNonce: string;
    expectedTenantId: string;
  }
) {
  if (!claimContainsAudience(claims.aud, expected.expectedClientId)) {
    throw new ApiError(401, "Microsoft sign-in returned a token for the wrong audience.");
  }

  const tenantId = stringifyClaim(claims.tid);
  if (tenantId !== expected.expectedTenantId) {
    throw new ApiError(401, "Microsoft sign-in returned a token for the wrong tenant.");
  }

  const issuer = stringifyClaim(claims.iss);
  if (issuer !== `https://login.microsoftonline.com/${expected.expectedTenantId}/v2.0`) {
    throw new ApiError(401, "Microsoft sign-in returned a token from an unexpected issuer.");
  }

  const nonce = stringifyClaim(claims.nonce);
  if (nonce !== expected.expectedNonce) {
    throw new ApiError(401, "Microsoft sign-in returned an unexpected nonce.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = readNumericDateClaim(claims.exp);
  if (!expiresAt || expiresAt <= nowSeconds - 60) {
    throw new ApiError(401, "Microsoft sign-in returned an expired token.");
  }

  const notBefore = readNumericDateClaim(claims.nbf);
  if (notBefore && notBefore > nowSeconds + 300) {
    throw new ApiError(401, "Microsoft sign-in returned a token that is not yet valid.");
  }
}

function claimContainsAudience(value: unknown, expectedAudience: string) {
  if (typeof value === "string") {
    return value.trim() === expectedAudience;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim() === expectedAudience);
  }
  return false;
}

function readNumericDateClaim(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateMicrosoftRedirectUri(value: string, requiredPath: string | null, label: string) {
  try {
    const url = new URL(value);
    if (requiredPath && url.pathname !== requiredPath) {
      throw new Error("path_mismatch");
    }
    if (config.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("insecure_protocol");
    }
    return url.toString();
  } catch {
    throw new ApiError(500, `${label} is invalid.`);
  }
}
