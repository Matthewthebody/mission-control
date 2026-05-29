import { SignJWT, jwtVerify } from "jose";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import type {
  ConciergeAccessSearchInput,
  ConciergeAccessSearchResult,
  ConciergeAccessSearchScope
} from "../types/concierge.js";
import type {
  TeamsMessageExtensionClickType,
  TeamsMessageExtensionQueryActivity,
  TeamsMessageExtensionResponse,
  TeamsMessageExtensionTelemetryItem
} from "../types/microsoftTeams.js";
import type { AuthUser } from "../types/auth.js";
import { writeAuditEvent } from "./diagnostics/auditEventService.js";
import { searchConciergeAccess } from "./concierge/conciergeAccessSearchService.js";
import { recordMicrosoftIntegrationEvent } from "./microsoftIntegrationObservability.js";
import { buildTeamsEmbeddedAppUrl } from "./microsoftTeamsLinks.js";

const OPEN_TOKEN_SECRET = new TextEncoder().encode(config.JWT_SECRET);
const ALLOWED_SCOPES = new Set<ConciergeAccessSearchScope>([
  "jobs",
  "locations",
  "organizations",
  "contacts",
  "staffing_assignments",
  "sops_files",
  "production"
]);

type TeamsOpenTokenPayload = {
  tenant_id: string;
  user_id: string;
  search_index_id: string;
  entity_type: string;
  deep_link: string;
  click_type: TeamsMessageExtensionClickType;
  query: string;
};

function absoluteUrl(baseUrl: string, suffix: string) {
  return `${baseUrl.replace(/\/$/, "")}${suffix.startsWith("/") || suffix.startsWith("#") ? suffix : `/${suffix}`}`;
}

function normalizeAppDeepLink(deepLink: string) {
  return buildTeamsEmbeddedAppUrl(deepLink.startsWith("http://") || deepLink.startsWith("https://") ? deepLink : deepLink.startsWith("#") ? deepLink : `#${deepLink}`);
}

function normalizeScope(rawValue: unknown): ConciergeAccessSearchScope[] {
  if (typeof rawValue !== "string") {
    return [];
  }
  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is ConciergeAccessSearchScope => ALLOWED_SCOPES.has(entry as ConciergeAccessSearchScope));
}

function getCommandParameter(activity: TeamsMessageExtensionQueryActivity, name: string) {
  const parameter = activity.value?.parameters?.find((entry) => entry?.name?.toLowerCase() === name.toLowerCase());
  return parameter?.value;
}

function getQuery(activity: TeamsMessageExtensionQueryActivity) {
  const direct = getCommandParameter(activity, "query");
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const fallback = activity.value?.parameters?.find((entry) => typeof entry?.value === "string" && String(entry.value).trim());
  return typeof fallback?.value === "string" ? fallback.value.trim() : "";
}

function getScopes(activity: TeamsMessageExtensionQueryActivity) {
  return normalizeScope(getCommandParameter(activity, "scope"));
}

function buildSubtitle(result: ConciergeAccessSearchResult) {
  const parts = [result.metadata.find((entry) => entry.label === "Type")?.value, result.subtitle].filter(Boolean);
  return parts.join(" | ");
}

function buildSummaryText(result: ConciergeAccessSearchResult) {
  return result.metadata
    .filter((entry) => entry.label !== "Type")
    .map((entry) => `${entry.label}: ${entry.value}`)
    .join("\n");
}

async function createOpenRedirectUrl(
  auth: AuthUser,
  result: ConciergeAccessSearchResult,
  query: string,
  clickType: TeamsMessageExtensionClickType
) {
  const token = await new SignJWT({
    tenant_id: auth.tenantId,
    user_id: auth.id,
    search_index_id: result.search_index_id,
    entity_type: result.entity_type,
    deep_link: result.deep_link,
    click_type: clickType,
    query
  } satisfies TeamsOpenTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(auth.id)
    .setIssuer("kemmet-concierge")
    .setAudience("teams-message-extension-open")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(OPEN_TOKEN_SECRET);
  return absoluteUrl(config.API_PUBLIC_URL, `/api/integrations/teams/message-extension/open?token=${encodeURIComponent(token)}`);
}

async function toAttachment(auth: AuthUser, query: string, result: ConciergeAccessSearchResult) {
  const previewUrl = await createOpenRedirectUrl(auth, result, query, "preview_tap");
  const buttonUrl = await createOpenRedirectUrl(auth, result, query, "open_button");
  const absoluteDeepLink = normalizeAppDeepLink(result.deep_link);
  const subtitle = buildSubtitle(result);
  const text = buildSummaryText(result);

  return {
    contentType: "application/vnd.microsoft.card.hero",
    content: {
      title: result.title,
      subtitle,
      text,
      buttons: [
        {
          type: "openUrl",
          title: "Open in Kemmet",
          value: buttonUrl
        },
        {
          type: "openUrl",
          title: "Open Direct",
          value: absoluteDeepLink
        }
      ]
    },
    preview: {
      contentType: "application/vnd.microsoft.card.thumbnail",
      content: {
        title: result.title,
        subtitle,
        text,
        tap: {
          type: "openUrl",
          value: previewUrl
        }
      }
    }
  };
}

async function logTeamsSearchTelemetry(
  client: PoolClient,
  auth: AuthUser,
  input: {
    query: string;
    scopes: ConciergeAccessSearchScope[];
    resultCount: number;
    topResultTypes: string[];
  }
) {
  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "microsoft_teams_search",
    eventType: "teams.message_extension.search",
    resourceType: "teams_message_extension_query",
    context: {
      query: input.query,
      scopes: input.scopes,
      result_count: input.resultCount,
      top_result_types: input.topResultTypes
    },
    result: input.resultCount > 0 ? "results" : "no_results"
  });
  if (input.resultCount === 0) {
    await writeAuditEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      eventCategory: "microsoft_teams_search",
      eventType: "teams.message_extension.no_results",
      resourceType: "teams_message_extension_query",
      context: {
        query: input.query,
        scopes: input.scopes
      },
      result: "no_results"
    });
  }
}

export async function buildTeamsMessageExtensionResponse(
  client: PoolClient,
  auth: AuthUser,
  activity: TeamsMessageExtensionQueryActivity
): Promise<TeamsMessageExtensionResponse> {
  const query = getQuery(activity);
  const scopes = getScopes(activity);
  try {
    const commandId = activity.value?.commandId?.trim() || "search";
    if (commandId !== "search") {
      return {
        composeExtension: {
          type: "result",
          attachmentLayout: "list",
          attachments: []
        }
      };
    }

    const searchInput: ConciergeAccessSearchInput = {
      q: query,
      limit: 8,
      scopes
    };
    const searchPayload = await searchConciergeAccess(client, auth, searchInput);
    await logTeamsSearchTelemetry(client, auth, {
      query: searchPayload.query,
      scopes: searchPayload.scopes,
      resultCount: searchPayload.results.length,
      topResultTypes: searchPayload.results.slice(0, 4).map((result) => result.entity_type)
    });

    return {
      composeExtension: {
        type: "result",
        attachmentLayout: "list",
        attachments: await Promise.all(searchPayload.results.map((result) => toAttachment(auth, searchPayload.query, result)))
      }
    };
  } catch (error) {
    await recordMicrosoftIntegrationEvent(client, {
      tenantId: auth.tenantId,
      integrationArea: "teams_search",
      eventLevel: "error",
      eventType: "teams.message_extension.search_failed",
      summary: "Teams message extension search failed before results could be returned.",
      detail: {
        query,
        scopes,
        message: error instanceof Error ? error.message : "Unknown Teams search failure."
      },
      actorUserId: auth.id
    });
    throw error;
  }
}

export async function resolveTeamsMessageExtensionOpen(token: string) {
  const { payload } = await jwtVerify(token, OPEN_TOKEN_SECRET, {
    issuer: "kemmet-concierge",
    audience: "teams-message-extension-open"
  });
  return payload as unknown as TeamsOpenTokenPayload;
}

export async function logTeamsMessageExtensionOpen(client: PoolClient, payload: TeamsOpenTokenPayload) {
  await writeAuditEvent(client, {
    tenantId: payload.tenant_id,
    actorUserId: payload.user_id,
    eventCategory: "microsoft_teams_search",
    eventType: "teams.message_extension.open",
    resourceType: "global_search_index",
    resourceId: payload.search_index_id,
    context: {
      entity_type: payload.entity_type,
      click_type: payload.click_type,
      query: payload.query,
      deep_link: payload.deep_link
    },
    result: payload.click_type
  });
}

export async function listTeamsMessageExtensionTelemetry(
  client: PoolClient,
  auth: AuthUser,
  limit = 50
): Promise<TeamsMessageExtensionTelemetryItem[]> {
  const { rows } = await client.query<TeamsMessageExtensionTelemetryItem>(
    `
      SELECT
        audit.id::text,
        audit.event_type,
        audit.result,
        audit.created_at::text AS created_at,
        actor.full_name AS actor_name,
        audit.context_json AS context
      FROM audit_events audit
      LEFT JOIN app_user actor
        ON actor.tenant_id = audit.tenant_id
       AND actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.event_category = 'microsoft_teams_search'
      ORDER BY audit.created_at DESC
      LIMIT $2
    `,
    [auth.tenantId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}
