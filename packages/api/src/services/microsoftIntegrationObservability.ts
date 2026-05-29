import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { getMissingOutlookOauthEnvVars } from "../config/outlook.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { OutlookAccount } from "../types/outlook.js";
import type {
  MicrosoftIntegrationArea,
  MicrosoftIntegrationEventLevel,
  MicrosoftIntegrationEventRecord,
  MicrosoftIntegrationFeatureFlags,
  MicrosoftIntegrationHealthCheck,
  MicrosoftIntegrationHealthPayload,
  MicrosoftIntegrationHealthStatus,
  MicrosoftIntegrationValidationIssue
} from "../types/microsoftIntegration.js";
import { resolveApiRepoPath } from "../utils/repoPaths.js";
import { getRequestContext } from "./requestContext.js";
import { loadOutlookTenantState, resolveOutlookAccount, type OutlookConnectionRow } from "./outlookStore.js";

const MICROSOFT_AREAS: MicrosoftIntegrationArea[] = [
  "auth",
  "account_linking",
  "outlook_calendar_sync",
  "mail_automation",
  "client_intake",
  "sms_automation",
  "teams_alerts",
  "teams_search",
  "teams_personal_app",
  "config"
];

type IntegrationEventAggregateRow = {
  integration_area: MicrosoftIntegrationArea;
  failure_count: string;
  warning_count: string;
  last_event_at: string | null;
};

type OutlookSyncAggregateRow = {
  failed_count: string;
  pending_count: string;
  success_count: string;
  warning_count: string;
  last_failed_at: string | null;
};

type TeamsAlertAggregateRow = {
  failed_count: string;
  queued_count: string;
  last_failed_at: string | null;
};

type MailAutomationAggregateRow = {
  failed_count: string;
  queued_count: string;
  last_failed_at: string | null;
};

type ClientIntakeAggregateRow = {
  unmatched_count: string;
  failed_count: string;
  last_failed_at: string | null;
};

type SmsAutomationAggregateRow = {
  failed_count: string;
  queued_count: string;
  opted_out_count: string;
  last_failed_at: string | null;
};

function buildTraceId(area: MicrosoftIntegrationArea, eventType: string, relatedEntityType?: string | null, relatedEntityId?: string | null) {
  const requestId = getRequestContext()?.requestId ?? null;
  return [area, eventType, relatedEntityType ?? "resource", relatedEntityId ?? "record", requestId ?? "no-request"].join(":");
}

function getTeamsManifestPath() {
  return resolveApiRepoPath("teams", "appPackage", "manifest.json");
}

function safeParseUrlHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function addMissingConfigIssue(
  issues: MicrosoftIntegrationValidationIssue[],
  area: MicrosoftIntegrationArea,
  field: string,
  summary: string
) {
  issues.push({
    area,
    severity: "error",
    code: `${area}.${field}.missing`,
    summary
  });
}

function loadTeamsManifestSummary() {
  try {
    const raw = readFileSync(getTeamsManifestPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      id?: string;
      validDomains?: string[];
      staticTabs?: Array<{ contentUrl?: string; websiteUrl?: string }>;
      composeExtensions?: Array<{ botId?: string }>;
    };
    return parsed;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read Teams manifest."
    };
  }
}

export function getMicrosoftIntegrationFeatureFlags(): MicrosoftIntegrationFeatureFlags {
  return {
    auth_enabled: Boolean(config.MICROSOFT_ENTRA_AUTH_ENABLED),
    outlook_sync_enabled: Boolean(config.MICROSOFT_OUTLOOK_SYNC_ENABLED),
    mail_automation_enabled: Boolean(config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED),
    client_intake_enabled: Boolean(config.MICROSOFT_365_CLIENT_INTAKE_ENABLED),
    sms_automation_enabled: Boolean(config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED),
    teams_alerts_enabled: Boolean(config.TEAMS_OPERATIONAL_ALERTS_ENABLED),
    teams_search_enabled: Boolean(config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED),
    teams_personal_app_enabled: Boolean(config.MICROSOFT_TEAMS_PERSONAL_APP_ENABLED)
  };
}

export function getMicrosoftIntegrationValidationIssues(): MicrosoftIntegrationValidationIssue[] {
  const issues: MicrosoftIntegrationValidationIssue[] = [];
  const flags = getMicrosoftIntegrationFeatureFlags();

  if (flags.auth_enabled) {
    if (!config.MICROSOFT_GRAPH_CLIENT_ID) {
      addMissingConfigIssue(issues, "auth", "graph_client_id", "Microsoft auth is enabled but MICROSOFT_GRAPH_CLIENT_ID is missing.");
    }
    if (!config.MICROSOFT_GRAPH_CLIENT_SECRET) {
      addMissingConfigIssue(
        issues,
        "auth",
        "graph_client_secret",
        "Microsoft auth is enabled but MICROSOFT_GRAPH_CLIENT_SECRET is missing."
      );
    }
    if (!config.MICROSOFT_GRAPH_TENANT_ID) {
      addMissingConfigIssue(issues, "auth", "graph_tenant_id", "Microsoft auth is enabled but MICROSOFT_GRAPH_TENANT_ID is missing.");
    }
    if (!config.MICROSOFT_ENTRA_REDIRECT_URI) {
      addMissingConfigIssue(issues, "auth", "redirect_uri", "Microsoft auth is enabled but MICROSOFT_ENTRA_REDIRECT_URI is missing.");
    }
    if (!config.MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI) {
      addMissingConfigIssue(
        issues,
        "auth",
        "post_logout_redirect_uri",
        "Microsoft auth is enabled but MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI is missing."
      );
    }
  }

  if (flags.outlook_sync_enabled) {
    const missingOutlookEnvVars = getMissingOutlookOauthEnvVars();
    const hasGraphWebhookClientState = config.MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE.trim().length > 0;
    const hasWebhookSharedSecret = config.WEBHOOK_SHARED_SECRET.trim().length > 0;
    if (missingOutlookEnvVars.length > 0) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: "error",
        code: "outlook_calendar_sync.oauth_config_missing",
        summary: `Outlook calendar sync is enabled but Outlook OAuth configuration is incomplete: ${missingOutlookEnvVars.join(", ")}.`
      });
    }
    if (!(config.OUTLOOK_GRAPH_TIMEOUT_MS > 0)) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: "error",
        code: "outlook_calendar_sync.timeout_invalid",
        summary: "Outlook calendar sync requires a positive OUTLOOK_GRAPH_TIMEOUT_MS value."
      });
    }
    if (config.NODE_ENV === "production" && !config.OUTLOOK_TOKEN_ENCRYPTION_SECRET) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: "error",
        code: "outlook_calendar_sync.token_encryption_secret_missing",
        summary: "Outlook calendar sync is enabled in production but OUTLOOK_TOKEN_ENCRYPTION_SECRET is missing."
      });
    } else if (!config.OUTLOOK_TOKEN_ENCRYPTION_SECRET) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: "warning",
        code: "outlook_calendar_sync.token_encryption_secret_fallback",
        summary:
          "Outlook calendar sync is falling back to JWT_SECRET for token encryption. Keep this to local development only and set OUTLOOK_TOKEN_ENCRYPTION_SECRET for pilot or production use."
      });
    }
    if (config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: "error",
        code: "outlook_calendar_sync.app_permission_features_enabled",
        summary:
          "Legacy Outlook app-permission features are enabled. The Outlook pilot is delegated read-only only, so app-permission execution must stay disabled."
      });
    }
    if (!hasGraphWebhookClientState && !hasWebhookSharedSecret) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: config.NODE_ENV === "production" ? "error" : "warning",
        code: "outlook_calendar_sync.webhook_verification_unconfigured",
        summary:
          "Outlook webhook verification is not configured. Set MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE for direct Graph callbacks or WEBHOOK_SHARED_SECRET for a trusted relay before pilot use."
      });
    } else if (!hasGraphWebhookClientState && hasWebhookSharedSecret) {
      issues.push({
        area: "outlook_calendar_sync",
        severity: "warning",
        code: "outlook_calendar_sync.webhook_client_state_missing",
        summary:
          "Outlook webhook validation is running in relay/shared-secret mode only. Set MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE before accepting direct Graph callbacks."
      });
    }
  }

  if (flags.mail_automation_enabled) {
    if (!config.API_PUBLIC_URL) {
      addMissingConfigIssue(
        issues,
        "mail_automation",
        "api_public_url",
        "Mail automation is enabled but API_PUBLIC_URL is missing."
      );
    }
    if (!(config.MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS > 0)) {
      issues.push({
        area: "mail_automation",
        severity: "error",
        code: "mail_automation.timeout_invalid",
        summary: "Mail automation requires a positive MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS value."
      });
    }
    if (!Object.keys(config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS).length) {
      issues.push({
        area: "mail_automation",
        severity: "error",
        code: "mail_automation.flow_endpoints_missing",
        summary: "Mail automation is enabled but MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS is empty."
      });
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET) {
      issues.push({
        area: "mail_automation",
        severity: "error",
        code: "mail_automation.callback_secret_missing",
        summary: "Mail automation is enabled in production but MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET is missing."
      });
    }
  }

  if (flags.client_intake_enabled) {
    if (!config.API_PUBLIC_URL) {
      addMissingConfigIssue(
        issues,
        "client_intake",
        "api_public_url",
        "Client intake is enabled but API_PUBLIC_URL is missing."
      );
    }
    if (!config.MICROSOFT_365_SHAREPOINT_ROOT_URL) {
      addMissingConfigIssue(
        issues,
        "client_intake",
        "sharepoint_root_url",
        "Client intake is enabled but MICROSOFT_365_SHAREPOINT_ROOT_URL is missing."
      );
    }
    if (!config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
      issues.push({
        area: "client_intake",
        severity: "error",
        code: "client_intake.mail_automation_disabled",
        summary: "Client intake is enabled but mail automation is disabled, so confirmations and reminders cannot run."
      });
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET) {
      issues.push({
        area: "client_intake",
        severity: "error",
        code: "client_intake.callback_secret_missing",
        summary: "Client intake is enabled in production but MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET is missing."
      });
    }
  }

  if (flags.sms_automation_enabled) {
    if (!config.API_PUBLIC_URL) {
      addMissingConfigIssue(
        issues,
        "sms_automation",
        "api_public_url",
        "SMS automation is enabled but API_PUBLIC_URL is missing."
      );
    }
    if (!config.MICROSOFT_365_SMS_FROM_NUMBER) {
      addMissingConfigIssue(
        issues,
        "sms_automation",
        "from_number",
        "SMS automation is enabled but MICROSOFT_365_SMS_FROM_NUMBER is missing."
      );
    }
    if (!(config.MICROSOFT_365_SMS_TIMEOUT_MS > 0)) {
      issues.push({
        area: "sms_automation",
        severity: "error",
        code: "sms_automation.timeout_invalid",
        summary: "SMS automation requires a positive MICROSOFT_365_SMS_TIMEOUT_MS value."
      });
    }
    if (!Object.keys(config.MICROSOFT_365_SMS_FLOW_ENDPOINTS).length) {
      issues.push({
        area: "sms_automation",
        severity: "error",
        code: "sms_automation.flow_endpoints_missing",
        summary: "SMS automation is enabled but MICROSOFT_365_SMS_FLOW_ENDPOINTS is empty."
      });
    }
    if (!config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
      issues.push({
        area: "sms_automation",
        severity: "error",
        code: "sms_automation.client_intake_disabled",
        summary: "SMS automation is enabled but client intake is disabled, so reminder context cannot be resolved."
      });
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_365_SMS_CALLBACK_SECRET) {
      issues.push({
        area: "sms_automation",
        severity: "error",
        code: "sms_automation.callback_secret_missing",
        summary: "SMS automation is enabled in production but MICROSOFT_365_SMS_CALLBACK_SECRET is missing."
      });
    }
  }

  if (flags.teams_alerts_enabled) {
    if (!(config.TEAMS_WEBHOOK_TIMEOUT_MS > 0)) {
      issues.push({
        area: "teams_alerts",
        severity: "error",
        code: "teams_alerts.timeout_invalid",
        summary: "Teams alerts require a positive TEAMS_WEBHOOK_TIMEOUT_MS value."
      });
    }
    if (!config.ADMIN_WEB_URL) {
      addMissingConfigIssue(issues, "teams_alerts", "admin_web_url", "Teams alerts need ADMIN_WEB_URL to generate app deep links.");
    }
  }

  if (flags.teams_search_enabled) {
    if (!config.MICROSOFT_TEAMS_BOT_APP_ID) {
      addMissingConfigIssue(issues, "teams_search", "bot_app_id", "Teams search is enabled but MICROSOFT_TEAMS_BOT_APP_ID is missing.");
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_TEAMS_BOT_APP_PASSWORD) {
      addMissingConfigIssue(
        issues,
        "teams_search",
        "bot_app_password",
        "Teams search is enabled in production but MICROSOFT_TEAMS_BOT_APP_PASSWORD is missing."
      );
    }
    if (!config.API_PUBLIC_URL) {
      addMissingConfigIssue(issues, "teams_search", "api_public_url", "Teams search needs API_PUBLIC_URL for tracked deep links.");
    }
    if (!config.ADMIN_WEB_URL) {
      addMissingConfigIssue(issues, "teams_search", "admin_web_url", "Teams search needs ADMIN_WEB_URL for app deep links.");
    }
  }

  if (flags.teams_personal_app_enabled && !config.ADMIN_WEB_URL) {
    addMissingConfigIssue(
      issues,
      "teams_personal_app",
      "admin_web_url",
      "Teams personal app embedding is enabled but ADMIN_WEB_URL is missing."
    );
  }

  const manifest = loadTeamsManifestSummary();
  if ("error" in manifest) {
    if (flags.teams_search_enabled || flags.teams_personal_app_enabled) {
      issues.push({
        area: "config",
        severity: "error",
        code: "config.teams_manifest_unreadable",
        summary: "Teams app package manifest could not be read for validation.",
        details: {
          path: getTeamsManifestPath(),
          error: manifest.error
        }
      });
    }
    return issues;
  }

  const appId = typeof manifest.id === "string" ? manifest.id : "";
  if (
    (flags.teams_search_enabled || flags.teams_personal_app_enabled) &&
    (!appId || appId === "00000000-0000-0000-0000-000000000000")
  ) {
    issues.push({
      area: "config",
      severity: "warning",
      code: "config.teams_manifest_placeholder_app_id",
      summary: "Teams app package still uses a placeholder app id.",
      details: {
        manifest_id: appId || null
      }
    });
  }

  const composeBotId = manifest.composeExtensions?.[0]?.botId ?? "";
  if (flags.teams_search_enabled && (!composeBotId || composeBotId === "11111111-1111-1111-1111-111111111111")) {
    issues.push({
      area: "config",
      severity: "warning",
      code: "config.teams_manifest_placeholder_bot_id",
      summary: "Teams message extension manifest still uses a placeholder bot id.",
      details: {
        bot_id: composeBotId || null
      }
    });
  }

  const validDomains = new Set((manifest.validDomains ?? []).map((entry) => entry.toLowerCase()));
  const requiredDomains = [safeParseUrlHost(config.ADMIN_WEB_URL), safeParseUrlHost(config.API_PUBLIC_URL)].filter(
    (entry): entry is string => Boolean(entry)
  );
  for (const domain of requiredDomains) {
    if ((flags.teams_search_enabled || flags.teams_personal_app_enabled) && !validDomains.has(domain)) {
      issues.push({
        area: "config",
        severity: "warning",
        code: "config.teams_manifest_missing_domain",
        summary: `Teams app package validDomains is missing ${domain}.`,
        details: {
          domain
        }
      });
    }
  }

  if (flags.teams_personal_app_enabled && !(manifest.staticTabs?.length)) {
    issues.push({
      area: "teams_personal_app",
      severity: "error",
      code: "teams_personal_app.manifest_tab_missing",
      summary: "Teams personal app embedding is enabled but the Teams manifest does not declare a static personal tab."
    });
  }

  return issues;
}

export function assertMicrosoftIntegrationStartupConfig(target: "api" | "worker") {
  const issues = getMicrosoftIntegrationValidationIssues().filter((issue) => {
    if (target === "worker") {
      return issue.area !== "teams_personal_app";
    }
    return true;
  });

  const errors = issues.filter((issue) => issue.severity === "error");
  if (config.NODE_ENV === "production" && errors.length > 0) {
    throw new Error(
      `Microsoft integration startup validation failed: ${errors.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicMicrosoftHealthSummary() {
  const flags = getMicrosoftIntegrationFeatureFlags();
  const issues = getMicrosoftIntegrationValidationIssues();
  return {
    enabled_features: Object.entries(flags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length
  };
}

export async function recordMicrosoftIntegrationEvent(
  client: PoolClient,
  input: {
    tenantId?: string | null;
    integrationArea: MicrosoftIntegrationArea;
    eventLevel: MicrosoftIntegrationEventLevel;
    eventType: string;
    eventStatus?: string;
    summary: string;
    detail?: Record<string, unknown>;
    actorUserId?: string | null;
    requestId?: string | null;
    traceId?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    externalTarget?: string | null;
  }
) {
  const requestContext = getRequestContext();
  const { rows } = await client.query<MicrosoftIntegrationEventRecord>(
    `
      INSERT INTO microsoft_integration_event (
        tenant_id,
        integration_area,
        event_level,
        event_type,
        event_status,
        summary,
        detail,
        request_id,
        trace_id,
        actor_user_id,
        related_entity_type,
        related_entity_id,
        external_target
      )
      VALUES ($1,$2::microsoft_integration_area,$3::microsoft_integration_event_level,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
      RETURNING
        id::text,
        tenant_id::text,
        integration_area::text,
        event_level::text,
        event_type,
        event_status,
        summary,
        detail,
        request_id,
        trace_id,
        actor_user_id::text,
        related_entity_type,
        related_entity_id,
        external_target,
        occurred_at::text
    `,
    [
      input.tenantId ?? null,
      input.integrationArea,
      input.eventLevel,
      input.eventType,
      input.eventStatus ?? "observed",
      input.summary,
      JSON.stringify(input.detail ?? {}),
      input.requestId ?? requestContext?.requestId ?? null,
      input.traceId ?? buildTraceId(input.integrationArea, input.eventType, input.relatedEntityType, input.relatedEntityId),
      input.actorUserId ?? requestContext?.auth?.id ?? null,
      input.relatedEntityType ?? null,
      input.relatedEntityId ?? null,
      input.externalTarget ?? null
    ]
  );
  return rows[0];
}

export async function listMicrosoftIntegrationEvents(
  client: PoolClient,
  auth: AuthUser,
  options: {
    area?: MicrosoftIntegrationArea | null;
    level?: MicrosoftIntegrationEventLevel | null;
    limit?: number;
  } = {}
) {
  assertMicrosoftObservabilityAccess(auth);
  const includeGlobal = auth.authorityTier === "super_admin";
  const { rows } = await client.query<MicrosoftIntegrationEventRecord>(
    `
      SELECT
        id::text,
        tenant_id::text,
        integration_area::text,
        event_level::text,
        event_type,
        event_status,
        summary,
        detail,
        request_id,
        trace_id,
        actor_user_id::text,
        related_entity_type,
        related_entity_id,
        external_target,
        occurred_at::text
      FROM microsoft_integration_event
      WHERE (tenant_id = $1 OR ($2::boolean = true AND tenant_id IS NULL))
        AND ($3::microsoft_integration_area IS NULL OR integration_area = $3::microsoft_integration_area)
        AND ($4::microsoft_integration_event_level IS NULL OR event_level = $4::microsoft_integration_event_level)
      ORDER BY occurred_at DESC
      LIMIT $5
    `,
    [auth.tenantId, includeGlobal, options.area ?? null, options.level ?? null, Math.min(Math.max(options.limit ?? 50, 1), 200)]
  );

  return rows.map((row) => ({
    ...row,
    detail: row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail : {}
  }));
}

export async function getMicrosoftIntegrationHealth(client: PoolClient, auth: AuthUser): Promise<MicrosoftIntegrationHealthPayload> {
  assertMicrosoftObservabilityAccess(auth);
  const validationIssues = getMicrosoftIntegrationValidationIssues();
  const flags = getMicrosoftIntegrationFeatureFlags();
  const includeGlobal = auth.authorityTier === "super_admin";

  const eventAggregates = await client.query<IntegrationEventAggregateRow>(
    `
      SELECT
        integration_area::text,
        count(*) FILTER (WHERE event_level = 'error'::microsoft_integration_event_level)::text AS failure_count,
        count(*) FILTER (WHERE event_level = 'warning'::microsoft_integration_event_level)::text AS warning_count,
        max(occurred_at)::text AS last_event_at
      FROM microsoft_integration_event
      WHERE (tenant_id = $1 OR ($2::boolean = true AND tenant_id IS NULL))
        AND occurred_at >= now() - interval '14 days'
      GROUP BY integration_area
    `,
    [auth.tenantId, includeGlobal]
  );
  const outlookAggregate = await client.query<OutlookSyncAggregateRow>(
    `
      SELECT
        count(*) FILTER (WHERE provider = 'outlook' AND status IN ('failed', 'conflict'))::text AS failed_count,
        count(*) FILTER (WHERE provider = 'outlook' AND status IN ('pending', 'processing'))::text AS pending_count,
        count(*) FILTER (WHERE provider = 'outlook' AND status = 'succeeded')::text AS success_count,
        count(*) FILTER (WHERE provider = 'outlook' AND status = 'warning')::text AS warning_count,
        max(updated_at) FILTER (WHERE provider = 'outlook' AND status IN ('failed', 'conflict'))::text AS last_failed_at
      FROM integration_sync_operation
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );
  const outlookTenantState = await loadOutlookTenantState(client, auth.tenantId);
  const mailAutomationAggregate = await client.query<MailAutomationAggregateRow>(
    `
      SELECT
        count(*) FILTER (WHERE status = 'failed'::microsoft_mail_automation_status)::text AS failed_count,
        count(*) FILTER (WHERE status IN ('queued'::microsoft_mail_automation_status, 'dispatching'::microsoft_mail_automation_status, 'flow_accepted'::microsoft_mail_automation_status))::text AS queued_count,
        max(last_error_at)::text AS last_failed_at
      FROM microsoft_mail_automation_delivery
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );
  const clientIntakeAggregate = await (async () => {
    try {
      return await client.query<ClientIntakeAggregateRow>(
        `
          SELECT
            count(*) FILTER (WHERE matching_status = 'received_unmatched'::microsoft_client_intake_submission_status)::text AS unmatched_count,
            count(*) FILTER (WHERE last_error IS NOT NULL)::text AS failed_count,
            max(updated_at) FILTER (WHERE last_error IS NOT NULL)::text AS last_failed_at
          FROM microsoft_client_intake_submission
          WHERE tenant_id = $1
        `,
        [auth.tenantId]
      );
    } catch {
      return {
        rows: [{ unmatched_count: "0", failed_count: "0", last_failed_at: null }]
      } as { rows: ClientIntakeAggregateRow[] };
    }
  })();
  const smsAutomationAggregate = await (async () => {
    try {
      return await client.query<SmsAutomationAggregateRow>(
        `
          SELECT
            count(*) FILTER (WHERE status = 'failed'::microsoft_sms_delivery_status)::text AS failed_count,
            count(*) FILTER (
              WHERE status IN (
                'queued'::microsoft_sms_delivery_status,
                'dispatching'::microsoft_sms_delivery_status,
                'provider_accepted'::microsoft_sms_delivery_status
              )
            )::text AS queued_count,
            (
              SELECT count(*)::text
              FROM microsoft_sms_consent consent
              WHERE consent.tenant_id = $1
                AND consent.consent_status = 'opted_out'::microsoft_sms_consent_status
            ) AS opted_out_count,
            max(last_error_at)::text AS last_failed_at
          FROM microsoft_sms_delivery delivery
          WHERE delivery.tenant_id = $1
        `,
        [auth.tenantId]
      );
    } catch {
      return {
        rows: [{ failed_count: "0", queued_count: "0", opted_out_count: "0", last_failed_at: null }]
      } as { rows: SmsAutomationAggregateRow[] };
    }
  })();
  const teamsAlertAggregate = await client.query<TeamsAlertAggregateRow>(
    `
      SELECT
        count(*) FILTER (WHERE status = 'failed'::operational_alert_delivery_status)::text AS failed_count,
        count(*) FILTER (WHERE status = 'queued'::operational_alert_delivery_status)::text AS queued_count,
        max(failed_at)::text AS last_failed_at
      FROM operational_alert_delivery
      WHERE tenant_id = $1
    `,
    [auth.tenantId]
  );

  const aggregateMap = new Map(
    eventAggregates.rows.map((row) => [
      row.integration_area,
      {
        failureCount: Number(row.failure_count ?? "0"),
        warningCount: Number(row.warning_count ?? "0"),
        lastEventAt: row.last_event_at ?? null
      }
    ])
  );

  const areaIssues = new Map<MicrosoftIntegrationArea, MicrosoftIntegrationValidationIssue[]>();
  for (const issue of validationIssues) {
    const list = areaIssues.get(issue.area) ?? [];
    list.push(issue);
    areaIssues.set(issue.area, list);
  }
  if (validationIssues.length > 0) {
    areaIssues.set("config", [...(areaIssues.get("config") ?? []), ...validationIssues]);
  }

  const outlookState = outlookAggregate.rows[0] ?? {
    failed_count: "0",
    pending_count: "0",
    success_count: "0",
    warning_count: "0",
    last_failed_at: null
  };
  const outlookAccount = resolveOutlookAccount(auth.tenantId, outlookTenantState);
  const outlookConnection = outlookTenantState.activeConnection;
  const mailAutomationState = mailAutomationAggregate.rows[0] ?? { failed_count: "0", queued_count: "0", last_failed_at: null };
  const clientIntakeState = clientIntakeAggregate.rows[0] ?? { unmatched_count: "0", failed_count: "0", last_failed_at: null };
  const smsAutomationState = smsAutomationAggregate.rows[0] ?? {
    failed_count: "0",
    queued_count: "0",
    opted_out_count: "0",
    last_failed_at: null
  };
  const teamsAlertState = teamsAlertAggregate.rows[0] ?? { failed_count: "0", queued_count: "0", last_failed_at: null };

  const healthChecks = MICROSOFT_AREAS.map((area) =>
    buildHealthCheck(area, {
      featureFlags: flags,
      aggregate: aggregateMap.get(area) ?? null,
      validationIssues: areaIssues.get(area) ?? [],
      outlookState,
      outlookAccount,
      outlookConnection,
      mailAutomationState,
      clientIntakeState,
      smsAutomationState,
      teamsAlertState
    })
  );

  return {
    generated_at: new Date().toISOString(),
    feature_flags: flags,
    startup_validation: {
      valid: validationIssues.every((issue) => issue.severity !== "error"),
      issues: validationIssues
    },
    health_checks: healthChecks
  };
}

function buildHealthCheck(
  area: MicrosoftIntegrationArea,
  input: {
    featureFlags: MicrosoftIntegrationFeatureFlags;
    aggregate: { failureCount: number; warningCount: number; lastEventAt: string | null } | null;
    validationIssues: MicrosoftIntegrationValidationIssue[];
    outlookState: OutlookSyncAggregateRow;
    outlookAccount: OutlookAccount;
    outlookConnection: OutlookConnectionRow | null;
    mailAutomationState: MailAutomationAggregateRow;
    clientIntakeState: ClientIntakeAggregateRow;
    smsAutomationState: SmsAutomationAggregateRow;
    teamsAlertState: TeamsAlertAggregateRow;
  }
): MicrosoftIntegrationHealthCheck {
  const isEnabled = isAreaEnabled(area, input.featureFlags);
  if (!isEnabled) {
    return {
      area,
      status: "disabled",
      summary: `${humanizeArea(area)} is disabled.`,
      recent_failure_count: 0,
      last_event_at: input.aggregate?.lastEventAt ?? null,
      details: {
        enabled: false
      }
    };
  }

  const errorCount = input.validationIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = input.validationIssues.filter((issue) => issue.severity === "warning").length;
  let recentFailureCount = input.aggregate?.failureCount ?? 0;
  let derivedWarnings = input.aggregate?.warningCount ?? 0;
  const details: Record<string, unknown> = {
    enabled: true,
    validation_issue_count: input.validationIssues.length
  };

  if (area === "outlook_calendar_sync") {
    recentFailureCount += Number(input.outlookState.failed_count ?? "0");
    details.pending_sync_count = Number(input.outlookState.pending_count ?? "0");
    details.recent_success_count = Number(input.outlookState.success_count ?? "0");
    details.recent_warning_count = Number(input.outlookState.warning_count ?? "0");
    details.last_sync_failure_at = input.outlookState.last_failed_at ?? null;
    details.connection_status = input.outlookAccount.connection_status;
    details.provider_mode = input.outlookAccount.provider_mode;
    details.connection_health_state = input.outlookAccount.health_state;
    details.connected_account_email = input.outlookAccount.connected_as;
    details.connection_warning_count = input.outlookAccount.warning_count;
    details.connection_error_count = input.outlookAccount.error_count;
    details.last_successful_sync_at = input.outlookAccount.last_sync_at ?? null;
    details.last_disconnected_at = input.outlookConnection?.disconnected_at ?? null;
    details.alert_thresholds = {
      failure_rate_attention_count: 3,
      slow_call_attention_ms: 300,
      abnormal_refresh_attention_count_per_hour: 3
    };
    if (!input.outlookConnection) {
      derivedWarnings += 1;
    } else if (input.outlookAccount.provider_mode === "mock") {
      derivedWarnings += 1;
    } else if (input.outlookAccount.connection_status === "disconnected") {
      derivedWarnings += 1;
    } else if (input.outlookAccount.connection_status === "attention") {
      recentFailureCount += Math.max(1, input.outlookAccount.error_count ?? 0);
    }
  }

  if (area === "teams_alerts") {
    recentFailureCount += Number(input.teamsAlertState.failed_count ?? "0");
    details.queued_delivery_count = Number(input.teamsAlertState.queued_count ?? "0");
    details.last_delivery_failure_at = input.teamsAlertState.last_failed_at ?? null;
  }

  if (area === "mail_automation") {
    recentFailureCount += Number(input.mailAutomationState.failed_count ?? "0");
    details.pending_delivery_count = Number(input.mailAutomationState.queued_count ?? "0");
    details.last_delivery_failure_at = input.mailAutomationState.last_failed_at ?? null;
  }

  if (area === "client_intake") {
    recentFailureCount += Number(input.clientIntakeState.failed_count ?? "0");
    derivedWarnings += Number(input.clientIntakeState.unmatched_count ?? "0");
    details.unmatched_submission_count = Number(input.clientIntakeState.unmatched_count ?? "0");
    details.last_submission_failure_at = input.clientIntakeState.last_failed_at ?? null;
  }

  if (area === "sms_automation") {
    recentFailureCount += Number(input.smsAutomationState.failed_count ?? "0");
    derivedWarnings += Number(input.smsAutomationState.opted_out_count ?? "0");
    details.pending_delivery_count = Number(input.smsAutomationState.queued_count ?? "0");
    details.opted_out_consent_count = Number(input.smsAutomationState.opted_out_count ?? "0");
    details.last_delivery_failure_at = input.smsAutomationState.last_failed_at ?? null;
  }

  let status: MicrosoftIntegrationHealthStatus = "healthy";
  if (errorCount > 0 || recentFailureCount > 0) {
    status = "failing";
  } else if (warningCount > 0 || derivedWarnings > 0) {
    status = "warning";
  }

  let summary =
    status === "healthy"
      ? `${humanizeArea(area)} looks healthy.`
      : status === "warning"
        ? `${humanizeArea(area)} has rollout or warning conditions that need review.`
        : `${humanizeArea(area)} has active failures or blocking setup issues.`;

  if (area === "outlook_calendar_sync") {
    if (!input.outlookConnection && input.outlookAccount.provider_mode === "graph_live") {
      summary = "Outlook Calendar Sync is enabled, but no Outlook account is connected yet.";
    } else if (input.outlookAccount.provider_mode === "mock" && input.outlookAccount.connection_status === "connected") {
      summary = "Outlook Calendar Sync is running in mock preview mode. No live Microsoft 365 account is connected.";
    } else if (input.outlookAccount.provider_mode === "mock") {
      summary = "Outlook Calendar Sync is using the mock preview path, but the mock workspace is currently disconnected.";
    } else if (input.outlookAccount.connection_status === "disconnected") {
      summary = "Outlook Calendar Sync is configured, but the live Microsoft 365 connection is disconnected.";
    } else if (input.outlookAccount.connection_status === "attention") {
      summary = "Outlook Calendar Sync needs attention before the live delegated connection can be trusted.";
    } else if (input.outlookAccount.health_state === "connected_pending_sync") {
      summary = "Outlook Calendar Sync is connected, but the live delegated preview still needs its first successful refresh.";
    }
  }

  if (input.validationIssues.length > 0) {
    details.validation_issues = input.validationIssues;
  }

  return {
    area,
    status,
    summary,
    recent_failure_count: recentFailureCount,
    last_event_at: input.aggregate?.lastEventAt ?? null,
    details
  };
}

function isAreaEnabled(area: MicrosoftIntegrationArea, flags: MicrosoftIntegrationFeatureFlags) {
  switch (area) {
    case "auth":
    case "account_linking":
      return flags.auth_enabled;
    case "outlook_calendar_sync":
      return flags.outlook_sync_enabled;
    case "mail_automation":
      return flags.mail_automation_enabled;
    case "client_intake":
      return flags.client_intake_enabled;
    case "sms_automation":
      return flags.sms_automation_enabled;
    case "teams_alerts":
      return flags.teams_alerts_enabled;
    case "teams_search":
      return flags.teams_search_enabled;
    case "teams_personal_app":
      return flags.teams_personal_app_enabled;
    case "config":
      return true;
    default:
      return false;
  }
}

function humanizeArea(area: MicrosoftIntegrationArea) {
  return area
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function assertMicrosoftObservabilityAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Only leadership or audit admins can review Microsoft integration diagnostics.");
  }
}
