import { createRemoteJWKSet, jwtVerify } from "jose";
import type { PoolClient } from "pg";
import type { IncomingHttpHeaders } from "node:http";
import { ApiError } from "../errors/apiError.js";
import { config } from "../config.js";
import type { AuthUser } from "../types/auth.js";
import type { TeamsMessageExtensionQueryActivity } from "../types/microsoftTeams.js";
import { loadAuthenticatedUserByMicrosoftIdentity, loadAuthenticatedUserByUserId } from "./auth.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";

const BOTFRAMEWORK_JWKS = createRemoteJWKSet(new URL("https://login.botframework.com/v1/.well-known/keys"));

function normalizeHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getBearerToken(headers: IncomingHttpHeaders) {
  const header = normalizeHeaderValue(headers.authorization);
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function getTeamsTenantId(activity: TeamsMessageExtensionQueryActivity) {
  return activity.conversation?.tenantId ?? activity.channelData?.tenant?.id ?? null;
}

async function loadAuthenticatedUserByEmail(client: PoolClient, email: string) {
  const lookup = await client.query<{ id: string; tenant_id: string }>(
    `
      SELECT id::text, tenant_id::text
      FROM app_user
      WHERE lower(email) = lower($1)
      ORDER BY CASE status
        WHEN 'active' THEN 1
        WHEN 'pending_approval' THEN 2
        WHEN 'invited' THEN 3
        ELSE 9
      END, created_at ASC
      LIMIT 1
    `,
    [email]
  );
  const row = lookup.rows[0] ?? null;
  if (!row) {
    return null;
  }
  return loadAuthenticatedUserByUserId(client, row.tenant_id, row.id);
}

async function verifyTeamsConnectorToken(token: string) {
  if (!config.MICROSOFT_TEAMS_BOT_APP_ID) {
    throw new ApiError(503, "Teams message extension is not fully configured.");
  }
  try {
    await jwtVerify(token, BOTFRAMEWORK_JWKS, {
      issuer: "https://api.botframework.com",
      audience: config.MICROSOFT_TEAMS_BOT_APP_ID
    });
  } catch {
    throw new ApiError(401, "Teams authentication failed.");
  }
}

export async function authenticateTeamsMessageExtension(
  client: PoolClient,
  headers: IncomingHttpHeaders,
  activity: TeamsMessageExtensionQueryActivity
): Promise<AuthUser> {
  if (!config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "teams_search",
      eventLevel: "warning",
      eventType: "teams.message_extension.disabled",
      summary: "A Teams message extension search request was received while the feature is disabled.",
      detail: {
        reason_code: "disabled"
      }
    });
    throw new ApiError(404, "Teams message extension is not enabled.");
  }

  const devBypassEmail = normalizeHeaderValue(headers["x-pmc-teams-dev-user-email"]);
  if (config.MICROSOFT_TEAMS_DEV_BYPASS_AUTH && devBypassEmail) {
    const bypassUser = await loadAuthenticatedUserByEmail(client, devBypassEmail);
    if (!bypassUser) {
      await recordMicrosoftIntegrationEvent(client, {
        integrationArea: "teams_search",
        eventLevel: "error",
        eventType: "teams.message_extension.dev_bypass_user_missing",
        summary: "Teams message extension development bypass failed because the user email could not be resolved.",
        detail: {
          email: devBypassEmail
        }
      });
      throw new ApiError(401, "Teams development bypass user was not found.");
    }
    return bypassUser;
  }

  const token = getBearerToken(headers);
  if (!token) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "teams_search",
      eventLevel: "error",
      eventType: "teams.message_extension.missing_bearer_token",
      summary: "Teams message extension request failed because the Bot Framework bearer token was missing.",
      detail: {
        reason_code: "missing_token"
      }
    });
    throw new ApiError(401, "Teams authentication is required.");
  }
  try {
    await verifyTeamsConnectorToken(token);
  } catch (error) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "teams_search",
      eventLevel: "error",
      eventType: "teams.message_extension.token_verification_failed",
      summary: "Teams message extension request failed because Bot Framework token verification failed.",
      detail: {
        reason_code: "token_verification_failed"
      }
    });
    throw error;
  }

  const microsoftUserId = activity.from?.aadObjectId?.trim() ?? "";
  const microsoftTenantId = getTeamsTenantId(activity)?.trim() ?? "";
  if (!microsoftUserId || !microsoftTenantId) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "teams_search",
      eventLevel: "error",
      eventType: "teams.message_extension.identity_context_missing",
      summary: "Teams message extension request failed because the Teams identity context was incomplete.",
      detail: {
        has_microsoft_user_id: Boolean(microsoftUserId),
        has_microsoft_tenant_id: Boolean(microsoftTenantId)
      }
    });
    throw new ApiError(401, "Teams did not provide enough identity context.");
  }

  const auth = await loadAuthenticatedUserByMicrosoftIdentity(client, microsoftTenantId, microsoftUserId);
  if (!auth) {
    await recordMicrosoftIntegrationEvent(client, {
      integrationArea: "teams_search",
      eventLevel: "warning",
      eventType: "teams.message_extension.identity_unlinked",
      summary: "Teams message extension request failed because the Microsoft identity is not linked to an active employee account.",
      detail: {
        microsoft_tenant_id: microsoftTenantId,
        microsoft_user_id: microsoftUserId
      }
    });
    throw new ApiError(403, "Your Teams identity is not linked to an active employee account.");
  }
  return auth;
}
