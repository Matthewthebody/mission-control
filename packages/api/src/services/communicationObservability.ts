import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { AuditEventListItem } from "../types/diagnostics.js";
import type {
  CommunicationAdminControls,
  CommunicationArea,
  CommunicationDiagnosticsPayload,
  CommunicationFeatureFlags,
  CommunicationHealthCheck,
  CommunicationHealthStatus,
  CommunicationSupportBucket,
  CommunicationSupportExample,
  CommunicationSupportWorkspace,
  CommunicationValidationIssue
} from "../types/communicationDiagnostics.js";
import {
  getCommunicationMeetingDefaultsConfiguration,
  getTeamsEmbeddedCommunicationsDefaultsConfiguration
} from "./adminConfiguration.js";
import { writeAuditEvent } from "./diagnostics/auditEventService.js";
import { withClientTransaction } from "../db/tx.js";

type CountRow = {
  [key: string]: string | null;
};

type DeepLinkCandidateRow = {
  source_kind: "delivery" | "meeting";
  source_id: string;
  app_deep_link: string | null;
  created_at: string;
};

type DeepLinkIssueCode =
  | "relative_link"
  | "invalid_url"
  | "host_mismatch"
  | "missing_route"
  | "missing_teams_shell";

type CommunicationRelationAvailability = {
  has_microsoft_identity_review: boolean;
  has_teams_communication_reference: boolean;
  has_teams_communication_delivery: boolean;
  has_teams_meeting_reference: boolean;
  has_teams_meeting_sync_operation: boolean;
  has_proactive_communication_decision: boolean;
  has_communication_post_call_outcome: boolean;
};

type CommunicationAuditExampleRow = {
  id: string;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  result: string;
  created_at: string;
  context_json: Record<string, unknown> | null;
};

type CommunicationDeliveryExampleRow = {
  id: string;
  status: string;
  reference_label: string | null;
  object_type: string;
  object_id: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type CommunicationMeetingIssueExampleRow = {
  id: string;
  title: string | null;
  meeting_status: string;
  sync_error: string | null;
  meeting_join_url: string | null;
  organizer_user_id: string | null;
  updated_at: string;
};

type CommunicationRoutingIssueExampleRow = {
  id: string;
  trigger_type: string;
  route_kind: string;
  route_status: string;
  source_object_type: string;
  source_object_id: string;
  failure_reason: string | null;
  created_at: string;
};

type AreaFailureSummaryRow = {
  communication_area: string | null;
  total_count: string;
  last_event_at: string | null;
};

type CommunicationFailureBucket = "failed_launches" | "permission_failures";

const COMMUNICATION_PERMISSION_KEYS = [
  "communication.use",
  "communication.send",
  "communication.meeting.manage",
  "communication.configure"
] as const;

function humanizeArea(area: CommunicationArea) {
  return area
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function countValue(row: CountRow | undefined, key: string) {
  return Number(row?.[key] ?? "0");
}

function getDiagnosticsLookbackDays() {
  return Math.max(1, config.COMMUNICATION_DIAGNOSTICS_LOOKBACK_DAYS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapFailureResult(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return "invalid";
      case 401:
        return "unauthorized";
      case 403:
        return "forbidden";
      case 404:
        return "not_found";
      case 409:
        return "conflict";
      case 503:
        return "disabled";
      default:
        return "failed";
    }
  }
  return "failed";
}

function mapFailureKind(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return "validation_failed";
      case 401:
        return "authentication_required";
      case 403:
        return "permission_denied";
      case 404:
        return "record_not_found";
      case 409:
        return "state_conflict";
      case 503:
        return "feature_unavailable";
      default:
        return "execution_failed";
    }
  }
  return "execution_failed";
}

function mapFailureMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown communication support failure.";
}

function toSupportExample(
  row: Pick<CommunicationAuditExampleRow, "id" | "event_type" | "resource_type" | "resource_id" | "result" | "created_at">,
  summary: string,
  details: Record<string, unknown> = {}
): CommunicationSupportExample {
  return {
    id: row.id,
    event_type: row.event_type,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    result: row.result,
    summary,
    created_at: row.created_at,
    details
  };
}

function buildSupportBucket(input: {
  count: number;
  lastEventAt: string | null;
  summary: string;
  examples: CommunicationSupportExample[];
  details?: Record<string, unknown>;
}): CommunicationSupportBucket {
  return {
    count: input.count,
    last_event_at: input.lastEventAt,
    summary: input.summary,
    examples: input.examples,
    details: input.details ?? {}
  };
}

function buildHealthCheck(
  area: CommunicationArea,
  input: {
    enabled: boolean;
    status: CommunicationHealthStatus;
    summary: string;
    detailCount: number;
    lastEventAt?: string | null;
    details?: Record<string, unknown>;
  }
): CommunicationHealthCheck {
  if (!input.enabled && area !== "config") {
    return {
      area,
      status: "disabled",
      summary: `${humanizeArea(area)} is disabled by feature flag.`,
      detail_count: 0,
      last_event_at: input.lastEventAt ?? null,
      details: { enabled: false }
    };
  }

  return {
    area,
    status: input.status,
    summary: input.summary,
    detail_count: input.detailCount,
    last_event_at: input.lastEventAt ?? null,
    details: {
      enabled: input.enabled,
      ...(input.details ?? {})
    }
  };
}

function buildDefaultCountRow(values: Record<string, string | null> = {}): { rows: [CountRow] } {
  return {
    rows: [values]
  };
}

function getTeamsManifestPath() {
  return resolve(fileURLToPath(new URL("../../../../teams/appPackage/manifest.json", import.meta.url)));
}

function safeParseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeParseUrlHost(value: string) {
  return safeParseUrl(value)?.hostname.toLowerCase() ?? null;
}

function getExpectedAdminHosts() {
  const parsed = safeParseUrl(config.ADMIN_WEB_URL);
  if (!parsed) {
    return new Set<string>();
  }

  const hosts = new Set<string>([parsed.hostname.toLowerCase()]);
  if (parsed.hostname === "localhost") {
    hosts.add("127.0.0.1");
  } else if (parsed.hostname === "127.0.0.1") {
    hosts.add("localhost");
  }
  return hosts;
}

function loadTeamsManifestSummary() {
  try {
    const raw = readFileSync(getTeamsManifestPath(), "utf8");
    return JSON.parse(raw) as {
      id?: string;
      validDomains?: string[];
      staticTabs?: Array<{ entityId?: string; contentUrl?: string; websiteUrl?: string; name?: string }>;
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read Teams manifest."
    };
  }
}

function isAreaEnabled(area: CommunicationArea, flags: CommunicationFeatureFlags) {
  switch (area) {
    case "identity_linking":
      return flags.identity_linking_enabled;
    case "teams_messaging":
      return flags.teams_messaging_enabled;
    case "teams_meetings":
      return flags.teams_meetings_enabled;
    case "in_app_actions":
      return flags.in_app_actions_enabled;
    case "communication_history":
      return flags.communication_history_enabled;
    case "proactive_messaging_rules":
      return flags.proactive_messaging_rules_enabled;
    case "post_call_follow_up":
      return flags.post_call_follow_up_enabled;
    case "pre_call_context":
      return flags.pre_call_context_enabled;
    case "governance":
      return true;
    case "teams_embedded_entry_points":
      return flags.teams_embedded_entry_points_enabled;
    case "config":
      return true;
    default:
      return false;
  }
}

function validateCommunicationDeepLink(value: string | null): DeepLinkIssueCode | null {
  if (!value) {
    return null;
  }
  if (!/^https?:\/\//i.test(value)) {
    return "relative_link";
  }

  const parsed = safeParseUrl(value);
  if (!parsed) {
    return "invalid_url";
  }

  const expectedHosts = getExpectedAdminHosts();
  if (expectedHosts.size > 0 && !expectedHosts.has(parsed.hostname.toLowerCase())) {
    return "host_mismatch";
  }
  if (parsed.searchParams.get("teams") !== "1") {
    return "missing_teams_shell";
  }
  if (!parsed.hash && (parsed.pathname === "/" || parsed.pathname === "")) {
    return "missing_route";
  }
  return null;
}

export function getCommunicationFeatureFlags(): CommunicationFeatureFlags {
  return {
    diagnostics_enabled: Boolean(config.COMMUNICATIONS_DIAGNOSTICS_ENABLED),
    identity_linking_enabled: Boolean(config.COMMUNICATION_IDENTITY_LINKING_ENABLED),
    teams_messaging_enabled: Boolean(config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED),
    teams_meetings_enabled: Boolean(config.MICROSOFT_TEAMS_MEETINGS_ENABLED),
    in_app_actions_enabled: Boolean(config.COMMUNICATION_IN_APP_ACTIONS_ENABLED),
    communication_history_enabled: Boolean(config.COMMUNICATION_HISTORY_ENABLED),
    proactive_messaging_rules_enabled: Boolean(config.COMMUNICATION_PROACTIVE_RULES_ENABLED),
    post_call_follow_up_enabled: Boolean(config.COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED),
    pre_call_context_enabled: Boolean(config.COMMUNICATION_PRE_CALL_CONTEXT_ENABLED),
    teams_embedded_entry_points_enabled: Boolean(config.MICROSOFT_TEAMS_EMBEDDED_COMMUNICATIONS_ENABLED)
  };
}

export function getCommunicationValidationIssues(): CommunicationValidationIssue[] {
  const issues: CommunicationValidationIssue[] = [];
  const flags = getCommunicationFeatureFlags();

  if (!flags.diagnostics_enabled) {
    issues.push({
      area: "config",
      severity: "warning",
      code: "config.diagnostics_disabled",
      summary: "Communication diagnostics are disabled, so operators lose the main internal communications health view."
    });
  }

  if (flags.identity_linking_enabled && !config.MICROSOFT_ENTRA_AUTH_ENABLED) {
    issues.push({
      area: "identity_linking",
      severity: "error",
      code: "identity_linking.microsoft_entra_disabled",
      summary: "Communication identity linking is enabled but Microsoft Entra auth is disabled."
    });
  }

  if (flags.teams_messaging_enabled) {
    if (!flags.identity_linking_enabled) {
      issues.push({
        area: "teams_messaging",
        severity: "error",
        code: "teams_messaging.identity_linking_disabled",
        summary: "Teams messaging is enabled while communication identity linking is disabled."
      });
    }
    if (!config.MICROSOFT_TEAMS_BOT_APP_ID || !config.MICROSOFT_TEAMS_BOT_APP_PASSWORD || !config.MICROSOFT_GRAPH_TENANT_ID) {
      issues.push({
        area: "teams_messaging",
        severity: "error",
        code: "teams_messaging.credentials_missing",
        summary: "Teams messaging is enabled but bot application credentials are incomplete."
      });
    }
    if (!(config.TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS > 0)) {
      issues.push({
        area: "teams_messaging",
        severity: "error",
        code: "teams_messaging.timeout_invalid",
        summary: "Teams messaging requires a positive TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS value."
      });
    }
  }

  if (flags.teams_meetings_enabled) {
    if (!flags.identity_linking_enabled) {
      issues.push({
        area: "teams_meetings",
        severity: "error",
        code: "teams_meetings.identity_linking_disabled",
        summary: "Teams meetings are enabled while communication identity linking is disabled."
      });
    }
    if (!config.MICROSOFT_GRAPH_CLIENT_ID || !config.MICROSOFT_GRAPH_CLIENT_SECRET || !config.MICROSOFT_GRAPH_TENANT_ID) {
      issues.push({
        area: "teams_meetings",
        severity: "error",
        code: "teams_meetings.graph_credentials_missing",
        summary: "Teams meetings are enabled but Microsoft Graph application credentials are incomplete."
      });
    }
    if (!(config.TEAMS_MEETING_GRAPH_TIMEOUT_MS > 0)) {
      issues.push({
        area: "teams_meetings",
        severity: "error",
        code: "teams_meetings.timeout_invalid",
        summary: "Teams meetings require a positive TEAMS_MEETING_GRAPH_TIMEOUT_MS value."
      });
    }
  }

  if (flags.in_app_actions_enabled) {
    if (!flags.identity_linking_enabled) {
      issues.push({
        area: "in_app_actions",
        severity: "error",
        code: "in_app_actions.identity_linking_disabled",
        summary: "In-app communication actions are enabled while communication identity linking is disabled."
      });
    }
    if (!config.ADMIN_WEB_URL) {
      issues.push({
        area: "in_app_actions",
        severity: "error",
        code: "in_app_actions.admin_web_url_missing",
        summary: "In-app communication actions need ADMIN_WEB_URL for stable Teams deep links."
      });
    }
    if (!flags.teams_messaging_enabled && !flags.teams_meetings_enabled) {
      issues.push({
        area: "in_app_actions",
        severity: "warning",
        code: "in_app_actions.no_delivery_capability_enabled",
        summary: "In-app communication actions are enabled while both Teams messaging and Teams meetings are disabled."
      });
    }
  }

  if (flags.communication_history_enabled) {
    if (!flags.teams_messaging_enabled && !flags.teams_meetings_enabled && !flags.post_call_follow_up_enabled) {
      issues.push({
        area: "communication_history",
        severity: "warning",
        code: "communication_history.no_history_sources_enabled",
        summary: "Communication history is enabled, but no message, meeting, or post-call sources are enabled."
      });
    }
  }

  if (flags.proactive_messaging_rules_enabled) {
    if (!flags.in_app_actions_enabled) {
      issues.push({
        area: "proactive_messaging_rules",
        severity: "error",
        code: "proactive_messaging_rules.in_app_actions_disabled",
        summary: "Proactive communication rules are enabled while in-app communication actions are disabled."
      });
    }
    if (!flags.teams_messaging_enabled && !config.CORE_FOUNDATION_OPERATIONAL_EVENTS_ENABLED) {
      issues.push({
        area: "proactive_messaging_rules",
        severity: "error",
        code: "proactive_messaging_rules.no_delivery_path_enabled",
        summary: "Proactive communication rules need Teams messaging or operational events enabled to route notifications."
      });
    }
  }

  if (flags.post_call_follow_up_enabled) {
    if (!flags.in_app_actions_enabled) {
      issues.push({
        area: "post_call_follow_up",
        severity: "error",
        code: "post_call_follow_up.in_app_actions_disabled",
        summary: "Post-call follow-up is enabled while in-app communication actions are disabled."
      });
    }
    if (!flags.teams_meetings_enabled) {
      issues.push({
        area: "post_call_follow_up",
        severity: "warning",
        code: "post_call_follow_up.meetings_disabled",
        summary: "Post-call follow-up is enabled while Teams meetings are disabled, so new follow-up flows cannot start from linked meeting state."
      });
    }
  }

  if (flags.pre_call_context_enabled && !flags.in_app_actions_enabled) {
    issues.push({
      area: "pre_call_context",
      severity: "warning",
      code: "pre_call_context.in_app_actions_disabled",
      summary: "Pre-call context is enabled while in-app communication actions are disabled."
    });
  }

  if (flags.teams_embedded_entry_points_enabled) {
    if (!flags.in_app_actions_enabled) {
      issues.push({
        area: "teams_embedded_entry_points",
        severity: "error",
        code: "teams_embedded_entry_points.in_app_actions_disabled",
        summary: "Teams embedded communication entry points are enabled while in-app communication actions are disabled."
      });
    }
    if (!config.MICROSOFT_TEAMS_PERSONAL_APP_ENABLED) {
      issues.push({
        area: "teams_embedded_entry_points",
        severity: "error",
        code: "teams_embedded_entry_points.personal_app_disabled",
        summary: "Teams embedded communication entry points are enabled while the Teams personal app shell is disabled."
      });
    }
    if (!config.ADMIN_WEB_URL) {
      issues.push({
        area: "teams_embedded_entry_points",
        severity: "error",
        code: "teams_embedded_entry_points.admin_web_url_missing",
        summary: "Teams embedded communication entry points require ADMIN_WEB_URL."
      });
    }
  }

  if (
    config.NODE_ENV === "production" &&
    (flags.in_app_actions_enabled || flags.teams_embedded_entry_points_enabled) &&
    !config.ADMIN_WEB_URL.startsWith("https://")
  ) {
    issues.push({
      area: "config",
      severity: "error",
      code: "config.admin_web_url_not_https",
      summary: "Communication actions use ADMIN_WEB_URL in production, and it must be HTTPS."
    });
  }

  if (flags.teams_embedded_entry_points_enabled) {
    const manifest = loadTeamsManifestSummary();
    if ("error" in manifest) {
      issues.push({
        area: "teams_embedded_entry_points",
        severity: "error",
        code: "teams_embedded_entry_points.manifest_unreadable",
        summary: "Teams embedded communications are enabled but the Teams app manifest could not be read.",
        details: {
          path: getTeamsManifestPath(),
          error: manifest.error
        }
      });
    } else {
      const staticTabs = manifest.staticTabs ?? [];
      const communicationsTab = staticTabs.find((tab) =>
        [tab.contentUrl, tab.websiteUrl].some((value) => typeof value === "string" && value.includes("#teams/communications"))
      );
      if (!communicationsTab) {
        issues.push({
          area: "teams_embedded_entry_points",
          severity: "error",
          code: "teams_embedded_entry_points.manifest_communications_tab_missing",
          summary: "Teams embedded communications are enabled but the Teams app manifest does not declare the communications personal tab."
        });
      }

      const adminHost = safeParseUrlHost(config.ADMIN_WEB_URL);
      const validDomains = new Set((manifest.validDomains ?? []).map((entry) => entry.toLowerCase()));
      if (adminHost && !validDomains.has(adminHost)) {
        issues.push({
          area: "teams_embedded_entry_points",
          severity: "warning",
          code: "teams_embedded_entry_points.manifest_domain_missing",
          summary: `Teams app validDomains is missing ${adminHost}.`,
          details: {
            domain: adminHost
          }
        });
      }
    }
  }

  return issues;
}

export function assertCommunicationStartupConfig(target: "api" | "worker") {
  const issues = getCommunicationValidationIssues().filter((issue) => {
    if (target !== "worker") {
      return true;
    }
    return issue.area !== "in_app_actions" && issue.area !== "teams_embedded_entry_points" && issue.code !== "config.diagnostics_disabled";
  });

  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const strictIssues = config.COMMUNICATIONS_STRICT_STARTUP_VALIDATION ? issues : blockingIssues;
  if (config.NODE_ENV === "production" && strictIssues.length > 0) {
    throw new Error(
      `Communication startup validation failed: ${strictIssues.map((issue) => `${issue.area}:${issue.code}`).join(", ")}`
    );
  }
}

export function getPublicCommunicationHealthSummary() {
  const flags = getCommunicationFeatureFlags();
  const issues = getCommunicationValidationIssues();
  return {
    enabled_features: Object.entries(flags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
    startup_valid: issues.every((issue) => issue.severity !== "error"),
    issue_count: issues.length
  };
}

export async function writeCommunicationAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    eventType: string;
    resourceType: string;
    resourceId?: string | null;
    targetUserId?: string | null;
    result: string;
    context?: Record<string, unknown>;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
  }
) {
  return writeAuditEvent(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventCategory: "communication",
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    targetUserId: input.targetUserId ?? null,
    oldValues: input.oldValues ?? null,
    newValues: input.newValues ?? null,
    context: input.context ?? {},
    result: input.result
  });
}

export async function captureCommunicationFailure(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    eventType: string;
    resourceType: string;
    resourceId?: string | null;
    area: CommunicationArea;
    action: string;
    bucket?: CommunicationFailureBucket;
    error: unknown;
    context?: Record<string, unknown>;
  }
) {
  try {
    const auditInput = {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      result: mapFailureResult(input.error),
      context: {
        diagnostic_bucket: input.bucket ?? "failed_launches",
        communication_area: input.area,
        communication_action: input.action,
        failure_kind: mapFailureKind(input.error),
        error_message: mapFailureMessage(input.error),
        ...(input.context ?? {})
      }
    } as const;

    if (typeof config.DB_URL === "string" && config.DB_URL.trim().length > 0) {
      await withClientTransaction(input.tenantId, input.actorUserId ?? null, async (auditClient) => {
        await writeCommunicationAuditEvent(auditClient, auditInput);
      });
      return;
    }

    await writeCommunicationAuditEvent(client, auditInput);
  } catch (auditError) {
    console.error("Failed to capture communication support audit event", {
      eventType: input.eventType,
      area: input.area,
      action: input.action,
      error: auditError instanceof Error ? auditError.message : String(auditError)
    });
  }
}

function assertCommunicationDiagnosticsAccess(auth: Pick<AuthUser, "authorityTier">) {
  if (!hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    throw new ApiError(403, "Only leadership or audit admins can review communication diagnostics.");
  }
}

async function loadRecentCommunicationEvents(client: PoolClient, auth: AuthUser, limit: number): Promise<AuditEventListItem[]> {
  const { rows } = await client.query<AuditEventListItem>(
    `
      SELECT
        audit.id::text,
        audit.tenant_id::text,
        audit.actor_user_id::text,
        actor.full_name AS actor_name,
        audit.event_category,
        audit.event_type,
        audit.resource_type,
        audit.resource_id,
        audit.target_user_id::text,
        target_user.full_name AS target_name,
        audit.department_type::text AS department_type,
        audit.request_id,
        audit.trace_id,
        audit.old_values_json,
        audit.new_values_json,
        audit.context_json,
        audit.result,
        audit.created_at::text,
        concat(audit.event_category, ' / ', audit.event_type) AS message
      FROM audit_events audit
      LEFT JOIN app_user actor
        ON actor.tenant_id = audit.tenant_id
       AND actor.id = audit.actor_user_id
      LEFT JOIN app_user target_user
        ON target_user.tenant_id = audit.tenant_id
       AND target_user.id = audit.target_user_id
      WHERE audit.tenant_id = $1
        AND audit.event_category = 'communication'
      ORDER BY audit.created_at DESC
      LIMIT $2
    `,
    [auth.tenantId, Math.min(Math.max(limit, 1), 50)]
  );

  return rows;
}

async function loadCommunicationAdminControls(client: PoolClient, auth: AuthUser): Promise<CommunicationAdminControls> {
  const meetingDefaults = await getCommunicationMeetingDefaultsConfiguration(client, auth);
  const embeddedDefaults = await getTeamsEmbeddedCommunicationsDefaultsConfiguration(client, auth);

  return {
    default_meeting_mode: meetingDefaults.default_mode,
    strict_startup_validation: Boolean(config.COMMUNICATIONS_STRICT_STARTUP_VALIDATION),
    diagnostics_lookback_days: getDiagnosticsLookbackDays(),
    embedded_defaults: {
      max_assigned_jobs: embeddedDefaults.max_assigned_jobs,
      max_assigned_tasks: embeddedDefaults.max_assigned_tasks,
      max_entries: embeddedDefaults.max_entries
    },
    rollout_controls: {
      communication_history_enabled: Boolean(config.COMMUNICATION_HISTORY_ENABLED),
      proactive_messaging_rules_enabled: Boolean(config.COMMUNICATION_PROACTIVE_RULES_ENABLED),
      post_call_follow_up_enabled: Boolean(config.COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED),
      pre_call_context_enabled: Boolean(config.COMMUNICATION_PRE_CALL_CONTEXT_ENABLED)
    }
  };
}

async function loadCommunicationRelationAvailability(client: PoolClient): Promise<CommunicationRelationAvailability> {
  const { rows } = await client.query<CommunicationRelationAvailability>(
    `
      SELECT
        (to_regclass('public.microsoft_identity_review') IS NOT NULL) AS has_microsoft_identity_review,
        (to_regclass('public.teams_communication_reference') IS NOT NULL) AS has_teams_communication_reference,
        (to_regclass('public.teams_communication_delivery') IS NOT NULL) AS has_teams_communication_delivery,
        (to_regclass('public.teams_meeting_reference') IS NOT NULL) AS has_teams_meeting_reference,
        (to_regclass('public.teams_meeting_sync_operation') IS NOT NULL) AS has_teams_meeting_sync_operation,
        (to_regclass('public.proactive_communication_decision') IS NOT NULL) AS has_proactive_communication_decision,
        (to_regclass('public.communication_post_call_outcome') IS NOT NULL) AS has_communication_post_call_outcome
    `
  );

  return (
    rows[0] ?? {
      has_microsoft_identity_review: false,
      has_teams_communication_reference: false,
      has_teams_communication_delivery: false,
      has_teams_meeting_reference: false,
      has_teams_meeting_sync_operation: false,
      has_proactive_communication_decision: false,
      has_communication_post_call_outcome: false
    }
  );
}

function listMissingCommunicationRelations(
  availability: CommunicationRelationAvailability,
  relationKeys: Array<keyof CommunicationRelationAvailability>
) {
  const relationLabels: Record<keyof CommunicationRelationAvailability, string> = {
    has_microsoft_identity_review: "microsoft_identity_review",
    has_teams_communication_reference: "teams_communication_reference",
    has_teams_communication_delivery: "teams_communication_delivery",
    has_teams_meeting_reference: "teams_meeting_reference",
    has_teams_meeting_sync_operation: "teams_meeting_sync_operation",
    has_proactive_communication_decision: "proactive_communication_decision",
    has_communication_post_call_outcome: "communication_post_call_outcome"
  };

  return relationKeys.filter((key) => !availability[key]).map((key) => relationLabels[key]);
}

async function loadDeepLinkCandidates(
  client: PoolClient,
  tenantId: string,
  availability: CommunicationRelationAvailability
) {
  const candidateQueries: string[] = [];
  if (availability.has_teams_communication_delivery) {
    candidateQueries.push(`
      SELECT
        'delivery'::text AS source_kind,
        delivery.id::text AS source_id,
        delivery.app_deep_link,
        delivery.created_at::text AS created_at
      FROM teams_communication_delivery delivery
      WHERE delivery.tenant_id = $1
        AND delivery.app_deep_link IS NOT NULL
    `);
  }
  if (availability.has_teams_meeting_reference) {
    candidateQueries.push(`
      SELECT
        'meeting'::text AS source_kind,
        meeting.id::text AS source_id,
        meeting.app_deep_link,
        meeting.created_at::text AS created_at
      FROM teams_meeting_reference meeting
      WHERE meeting.tenant_id = $1
        AND meeting.app_deep_link IS NOT NULL
    `);
  }

  if (candidateQueries.length === 0) {
    return [] as DeepLinkCandidateRow[];
  }

  const { rows } = await client.query<DeepLinkCandidateRow>(
    `
      SELECT *
      FROM (
        ${candidateQueries.join("\nUNION ALL\n")}
      ) candidates
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [tenantId]
  );

  return rows;
}

function summarizeDeepLinkIssues(candidates: DeepLinkCandidateRow[]) {
  const issueCounts = new Map<DeepLinkIssueCode, number>();
  const examples: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const issue = validateCommunicationDeepLink(candidate.app_deep_link);
    if (!issue) {
      continue;
    }
    issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    if (examples.length < 8) {
      examples.push({
        source_kind: candidate.source_kind,
        source_id: candidate.source_id,
        issue,
        app_deep_link: candidate.app_deep_link
      });
    }
  }

  return {
    total_candidates: candidates.length,
    broken_count: [...issueCounts.values()].reduce((total, count) => total + count, 0),
    issue_counts: Object.fromEntries(issueCounts),
    examples
  };
}

async function loadAreaFailureSummaries(client: PoolClient, tenantId: string, lookbackDays: number) {
  const { rows } = await client.query<AreaFailureSummaryRow>(
    `
      SELECT
        context_json->>'communication_area' AS communication_area,
        count(*)::text AS total_count,
        max(created_at)::text AS last_event_at
      FROM audit_events
      WHERE tenant_id = $1
        AND event_category = 'communication'
        AND created_at >= now() - ($2::text || ' days')::interval
        AND context_json ? 'communication_area'
      GROUP BY context_json->>'communication_area'
    `,
    [tenantId, String(lookbackDays)]
  );

  return new Map(
    rows.map((row) => [
      row.communication_area ?? "unknown",
      {
        count: Number(row.total_count ?? "0"),
        last_event_at: row.last_event_at ?? null
      }
    ])
  );
}

async function loadCommunicationAuditExamples(
  client: PoolClient,
  input: {
    tenantId: string;
    lookbackDays: number;
    whereSql: string;
    values?: unknown[];
  }
) {
  const { rows } = await client.query<CommunicationAuditExampleRow>(
    `
      SELECT
        id::text,
        event_type,
        resource_type,
        resource_id,
        result,
        created_at::text,
        context_json
      FROM audit_events
      WHERE tenant_id = $1
        AND event_category = 'communication'
        AND created_at >= now() - ($2::text || ' days')::interval
        AND ${input.whereSql}
      ORDER BY created_at DESC
      LIMIT 8
    `,
    [input.tenantId, String(input.lookbackDays), ...(input.values ?? [])]
  );

  return rows;
}

async function loadAuditBucketCounts(
  client: PoolClient,
  input: {
    tenantId: string;
    lookbackDays: number;
    whereSql: string;
    values?: unknown[];
  }
) {
  const { rows } = await client.query<CountRow>(
    `
      SELECT
        count(*)::text AS total_count,
        count(*) FILTER (WHERE result = 'forbidden')::text AS forbidden_count,
        count(*) FILTER (WHERE result = 'disabled')::text AS disabled_count,
        count(*) FILTER (WHERE result = 'invalid')::text AS invalid_count,
        count(*) FILTER (WHERE result = 'conflict')::text AS conflict_count,
        count(*) FILTER (WHERE result = 'failed')::text AS failed_count,
        count(*) FILTER (WHERE result = 'not_found')::text AS not_found_count,
        max(created_at)::text AS last_event_at
      FROM audit_events
      WHERE tenant_id = $1
        AND event_category = 'communication'
        AND created_at >= now() - ($2::text || ' days')::interval
        AND ${input.whereSql}
    `,
    [input.tenantId, String(input.lookbackDays), ...(input.values ?? [])]
  );

  return rows[0] ?? {};
}

async function loadCommunicationSupportWorkspace(
  client: PoolClient,
  auth: AuthUser,
  relationAvailability: CommunicationRelationAvailability
): Promise<CommunicationSupportWorkspace> {
  const lookbackDays = getDiagnosticsLookbackDays();
  const launchCounts = await loadAuditBucketCounts(client, {
    tenantId: auth.tenantId,
    lookbackDays,
    whereSql: "context_json->>'diagnostic_bucket' = $3",
    values: ["failed_launches"]
  });
  const launchExamples = await loadCommunicationAuditExamples(client, {
    tenantId: auth.tenantId,
    lookbackDays,
    whereSql: "context_json->>'diagnostic_bucket' = $3",
    values: ["failed_launches"]
  });
  const permissionCounts = await loadAuditBucketCounts(client, {
    tenantId: auth.tenantId,
    lookbackDays,
    whereSql: "context_json->>'failure_kind' = $3",
    values: ["permission_denied"]
  });
  const permissionExamples = await loadCommunicationAuditExamples(client, {
    tenantId: auth.tenantId,
    lookbackDays,
    whereSql: "context_json->>'failure_kind' = $3",
    values: ["permission_denied"]
  });

  const failedLaunches = buildSupportBucket({
    count: countValue(launchCounts, "total_count"),
    lastEventAt: launchCounts.last_event_at ?? null,
    summary:
      countValue(launchCounts, "total_count") > 0
        ? `${countValue(launchCounts, "total_count")} communication launch failure${countValue(launchCounts, "total_count") === 1 ? "" : "s"} or denials were captured in the last ${lookbackDays} days.`
        : "No recent communication launch failures were captured.",
    examples: launchExamples.map((row) =>
      toSupportExample(
        row,
        `${String(row.context_json?.communication_action ?? row.event_type).replace(/_/g, " ")} -> ${row.result}`,
        {
          ...(isRecord(row.context_json) ? row.context_json : {})
        }
      )
    ),
    details: {
      forbidden_count: countValue(launchCounts, "forbidden_count"),
      disabled_count: countValue(launchCounts, "disabled_count"),
      invalid_count: countValue(launchCounts, "invalid_count"),
      conflict_count: countValue(launchCounts, "conflict_count"),
      failed_count: countValue(launchCounts, "failed_count"),
      not_found_count: countValue(launchCounts, "not_found_count"),
      lookback_days: lookbackDays
    }
  });

  const permissionFailures = buildSupportBucket({
    count: countValue(permissionCounts, "total_count"),
    lastEventAt: permissionCounts.last_event_at ?? null,
    summary:
      countValue(permissionCounts, "total_count") > 0
        ? `${countValue(permissionCounts, "total_count")} permission-related communication failure${countValue(permissionCounts, "total_count") === 1 ? "" : "s"} were logged in the last ${lookbackDays} days.`
        : "No recent permission-related communication failures were logged.",
    examples: permissionExamples.map((row) =>
      toSupportExample(
        row,
        `${String(row.context_json?.communication_action ?? row.event_type).replace(/_/g, " ")} permission denied`,
        {
          ...(isRecord(row.context_json) ? row.context_json : {})
        }
      )
    ),
    details: {
      lookback_days: lookbackDays,
      affected_areas: Array.from(
        new Set(
          permissionExamples
            .map((row) => (isRecord(row.context_json) ? row.context_json.communication_area : null))
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      )
    }
  });

  const failedSendsCounts = relationAvailability.has_teams_communication_delivery
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (WHERE status = 'failed'::teams_communication_delivery_status AND created_at >= now() - ($2::text || ' days')::interval)::text AS failed_count,
            count(*) FILTER (WHERE status = 'queued'::teams_communication_delivery_status AND created_at < now() - interval '15 minutes')::text AS stale_queued_count,
            count(*) FILTER (
              WHERE status = 'sending'::teams_communication_delivery_status
                AND COALESCE(last_attempted_at, created_at) < now() - interval '15 minutes'
            )::text AS stale_sending_count,
            max(updated_at)::text AS last_event_at
          FROM teams_communication_delivery
          WHERE tenant_id = $1
        `,
        [auth.tenantId, String(lookbackDays)]
      )
    : buildDefaultCountRow({
        failed_count: "0",
        stale_queued_count: "0",
        stale_sending_count: "0",
        last_event_at: null
      });

  const failedSendExamples = relationAvailability.has_teams_communication_delivery
    ? await client.query<CommunicationDeliveryExampleRow>(
        `
          SELECT
            delivery.id::text,
            delivery.status::text AS status,
            reference.label AS reference_label,
            delivery.object_type::text AS object_type,
            delivery.object_id::text AS object_id,
            delivery.last_error,
            delivery.created_at::text,
            delivery.updated_at::text
          FROM teams_communication_delivery delivery
          LEFT JOIN teams_communication_reference reference
            ON reference.tenant_id = delivery.tenant_id
           AND reference.id = delivery.reference_id
          WHERE delivery.tenant_id = $1
            AND (
              (delivery.status = 'failed'::teams_communication_delivery_status AND delivery.created_at >= now() - ($2::text || ' days')::interval)
              OR (delivery.status = 'queued'::teams_communication_delivery_status AND delivery.created_at < now() - interval '15 minutes')
              OR (
                delivery.status = 'sending'::teams_communication_delivery_status
                AND COALESCE(delivery.last_attempted_at, delivery.created_at) < now() - interval '15 minutes'
              )
            )
          ORDER BY delivery.updated_at DESC
          LIMIT 8
        `,
        [auth.tenantId, String(lookbackDays)]
      )
    : { rows: [] };

  const failedSends = buildSupportBucket({
    count:
      countValue(failedSendsCounts.rows[0], "failed_count") +
      countValue(failedSendsCounts.rows[0], "stale_queued_count") +
      countValue(failedSendsCounts.rows[0], "stale_sending_count"),
    lastEventAt: failedSendsCounts.rows[0]?.last_event_at ?? null,
    summary:
      countValue(failedSendsCounts.rows[0], "failed_count") +
        countValue(failedSendsCounts.rows[0], "stale_queued_count") +
        countValue(failedSendsCounts.rows[0], "stale_sending_count") >
      0
        ? "Teams messaging has failed or stuck sends that need operator review."
        : "Teams messaging delivery has no recent failed or stuck sends.",
    examples: failedSendExamples.rows.map((row) => ({
      id: row.id,
      event_type: "teams_communication_delivery",
      resource_type: "teams_communication_delivery",
      resource_id: row.id,
      result: row.status,
      summary:
        row.status === "failed"
          ? `Send to ${row.reference_label ?? "Teams destination"} failed`
          : `Send to ${row.reference_label ?? "Teams destination"} is stalled in ${row.status}`,
      created_at: row.updated_at ?? row.created_at,
      details: {
        object_type: row.object_type,
        object_id: row.object_id,
        last_error: row.last_error
      }
    })),
    details: {
      failed_count: countValue(failedSendsCounts.rows[0], "failed_count"),
      stale_queued_count: countValue(failedSendsCounts.rows[0], "stale_queued_count"),
      stale_sending_count: countValue(failedSendsCounts.rows[0], "stale_sending_count")
    }
  });

  const brokenMeetingCounts = relationAvailability.has_teams_meeting_reference
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (
              WHERE sync_error IS NOT NULL
                AND meeting_status <> 'cancelled'::teams_meeting_status
            )::text AS sync_error_count,
            count(*) FILTER (
              WHERE meeting_status <> 'cancelled'::teams_meeting_status
                AND (meeting_join_url IS NULL OR btrim(meeting_join_url) = '')
            )::text AS missing_join_url_count,
            count(*) FILTER (WHERE organizer_user_id IS NULL)::text AS missing_organizer_count,
            max(updated_at)::text AS last_event_at
          FROM teams_meeting_reference
          WHERE tenant_id = $1
        `,
        [auth.tenantId]
      )
    : buildDefaultCountRow({
        sync_error_count: "0",
        missing_join_url_count: "0",
        missing_organizer_count: "0",
        last_event_at: null
      });

  const brokenMeetingExamples = relationAvailability.has_teams_meeting_reference
    ? await client.query<CommunicationMeetingIssueExampleRow>(
        `
          SELECT
            id::text,
            title,
            meeting_status::text AS meeting_status,
            sync_error,
            meeting_join_url,
            organizer_user_id::text AS organizer_user_id,
            updated_at::text
          FROM teams_meeting_reference
          WHERE tenant_id = $1
            AND (
              (sync_error IS NOT NULL AND meeting_status <> 'cancelled'::teams_meeting_status)
              OR (meeting_status <> 'cancelled'::teams_meeting_status AND (meeting_join_url IS NULL OR btrim(meeting_join_url) = ''))
              OR organizer_user_id IS NULL
            )
          ORDER BY updated_at DESC
          LIMIT 8
        `,
        [auth.tenantId]
      )
    : { rows: [] };

  const brokenMeetings = buildSupportBucket({
    count:
      countValue(brokenMeetingCounts.rows[0], "sync_error_count") +
      countValue(brokenMeetingCounts.rows[0], "missing_join_url_count") +
      countValue(brokenMeetingCounts.rows[0], "missing_organizer_count"),
    lastEventAt: brokenMeetingCounts.rows[0]?.last_event_at ?? null,
    summary:
      countValue(brokenMeetingCounts.rows[0], "sync_error_count") +
        countValue(brokenMeetingCounts.rows[0], "missing_join_url_count") +
        countValue(brokenMeetingCounts.rows[0], "missing_organizer_count") >
      0
        ? "Linked meeting references have sync errors or broken metadata that need review."
        : "No broken linked meeting references were detected.",
    examples: brokenMeetingExamples.rows.map((row) => ({
      id: row.id,
      event_type: "teams_meeting_reference",
      resource_type: "teams_meeting_reference",
      resource_id: row.id,
      result: row.meeting_status,
      summary: row.sync_error
        ? `Meeting sync error on ${row.title ?? row.id}`
        : !row.meeting_join_url
          ? `Meeting ${row.title ?? row.id} is missing a join link`
          : `Meeting ${row.title ?? row.id} is missing an organizer`,
      created_at: row.updated_at,
      details: {
        meeting_status: row.meeting_status,
        sync_error: row.sync_error,
        organizer_user_id: row.organizer_user_id,
        meeting_join_url: row.meeting_join_url
      }
    })),
    details: {
      sync_error_count: countValue(brokenMeetingCounts.rows[0], "sync_error_count"),
      missing_join_url_count: countValue(brokenMeetingCounts.rows[0], "missing_join_url_count"),
      missing_organizer_count: countValue(brokenMeetingCounts.rows[0], "missing_organizer_count")
    }
  });

  const routingProblemCounts = relationAvailability.has_proactive_communication_decision
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (WHERE route_status = 'failed'::proactive_communication_route_status AND created_at >= now() - ($2::text || ' days')::interval)::text AS failed_count,
            count(*) FILTER (
              WHERE route_status = 'suppressed'::proactive_communication_route_status
                AND failure_reason IS NOT NULL
                AND created_at >= now() - ($2::text || ' days')::interval
            )::text AS suppressed_count,
            count(*) FILTER (WHERE route_status = 'throttled'::proactive_communication_route_status AND created_at >= now() - ($2::text || ' days')::interval)::text AS throttled_count,
            max(created_at)::text AS last_event_at
          FROM proactive_communication_decision
          WHERE tenant_id = $1
        `,
        [auth.tenantId, String(lookbackDays)]
      )
    : buildDefaultCountRow({
        failed_count: "0",
        suppressed_count: "0",
        throttled_count: "0",
        last_event_at: null
      });

  const routingProblemExamples = relationAvailability.has_proactive_communication_decision
    ? await client.query<CommunicationRoutingIssueExampleRow>(
        `
          SELECT
            id::text,
            trigger_type::text AS trigger_type,
            route_kind::text AS route_kind,
            route_status::text AS route_status,
            source_object_type::text AS source_object_type,
            source_object_id::text AS source_object_id,
            failure_reason,
            created_at::text
          FROM proactive_communication_decision
          WHERE tenant_id = $1
            AND created_at >= now() - ($2::text || ' days')::interval
            AND (
              route_status = 'failed'::proactive_communication_route_status
              OR (route_status = 'suppressed'::proactive_communication_route_status AND failure_reason IS NOT NULL)
            )
          ORDER BY created_at DESC
          LIMIT 8
        `,
        [auth.tenantId, String(lookbackDays)]
      )
    : { rows: [] };

  const routingProblems = buildSupportBucket({
    count:
      countValue(routingProblemCounts.rows[0], "failed_count") +
      countValue(routingProblemCounts.rows[0], "suppressed_count"),
    lastEventAt: routingProblemCounts.rows[0]?.last_event_at ?? null,
    summary:
      countValue(routingProblemCounts.rows[0], "failed_count") +
        countValue(routingProblemCounts.rows[0], "suppressed_count") >
      0
        ? "Proactive communication rules have recent failed or suppressed routing decisions that need review."
        : "No recent proactive communication routing problems were detected.",
    examples: routingProblemExamples.rows.map((row) => ({
      id: row.id,
      event_type: "proactive_communication_decision",
      resource_type: "proactive_communication_decision",
      resource_id: row.id,
      result: row.route_status,
      summary: `${row.trigger_type.replace(/_/g, " ")} -> ${row.route_kind.replace(/_/g, " ")} ${row.route_status.replace(/_/g, " ")}`,
      created_at: row.created_at,
      details: {
        source_object_type: row.source_object_type,
        source_object_id: row.source_object_id,
        failure_reason: row.failure_reason
      }
    })),
    details: {
      failed_count: countValue(routingProblemCounts.rows[0], "failed_count"),
      suppressed_count: countValue(routingProblemCounts.rows[0], "suppressed_count"),
      throttled_count: countValue(routingProblemCounts.rows[0], "throttled_count")
    }
  });

  return {
    failed_launches: failedLaunches,
    failed_sends: failedSends,
    broken_meeting_references: brokenMeetings,
    routing_rule_problems: routingProblems,
    permission_failures: permissionFailures
  };
}

export async function getCommunicationDiagnostics(
  client: PoolClient,
  auth: AuthUser
): Promise<CommunicationDiagnosticsPayload> {
  assertCommunicationDiagnosticsAccess(auth);
  const flags = getCommunicationFeatureFlags();
  const issues = getCommunicationValidationIssues();
  const adminControls = await loadCommunicationAdminControls(client, auth);
  const lookbackDays = getDiagnosticsLookbackDays();
  const relationAvailability = await loadCommunicationRelationAvailability(client);
  const supportWorkspace = await loadCommunicationSupportWorkspace(client, auth, relationAvailability);
  const areaFailureSummaries = await loadAreaFailureSummaries(client, auth.tenantId, lookbackDays);

  const identityCounts = await client.query<CountRow>(
    `
      WITH permissioned_users AS (
        SELECT DISTINCT assignment.user_id
        FROM user_role_assignment assignment
        JOIN role_permission_grant role_grant
          ON role_grant.role_id = assignment.role_id
        JOIN permission permission
          ON permission.id = role_grant.permission_id
        WHERE assignment.tenant_id = $1
          AND permission.code = ANY($2::text[])
          AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
          AND (assignment.ends_at IS NULL OR assignment.ends_at > now())
      ),
      population AS (
        SELECT
          app_member.id,
          app_member.status::text AS membership_status,
          account.microsoft_user_id,
          account.microsoft_tenant_id,
          COALESCE(account.communication_enabled, false) AS communication_enabled,
          account.auth_provider,
          account.linked_at,
          account.last_verified_at
        FROM app_user app_member
        JOIN permissioned_users permissioned
          ON permissioned.user_id = app_member.id
        LEFT JOIN user_account account
          ON account.id = app_member.account_id
        WHERE app_member.tenant_id = $1
      )
      SELECT
        count(*) FILTER (WHERE membership_status = 'active')::text AS permissioned_user_count,
        count(*) FILTER (
          WHERE membership_status = 'active'
            AND microsoft_user_id IS NOT NULL
            AND microsoft_tenant_id IS NOT NULL
            AND communication_enabled = true
        )::text AS linked_ready_count,
        count(*) FILTER (
          WHERE membership_status = 'active'
            AND microsoft_user_id IS NOT NULL
            AND microsoft_tenant_id IS NOT NULL
            AND communication_enabled = false
        )::text AS disabled_count,
        count(*) FILTER (
          WHERE membership_status = 'active'
            AND (
              (microsoft_user_id IS NOT NULL AND microsoft_tenant_id IS NULL)
              OR (microsoft_user_id IS NULL AND microsoft_tenant_id IS NOT NULL)
              OR (auth_provider = 'microsoft_entra' AND (microsoft_user_id IS NULL OR microsoft_tenant_id IS NULL))
              OR ((linked_at IS NOT NULL OR last_verified_at IS NOT NULL) AND NOT (microsoft_user_id IS NOT NULL AND microsoft_tenant_id IS NOT NULL))
            )
        )::text AS incomplete_count,
        count(*) FILTER (
          WHERE membership_status = 'active'
            AND microsoft_user_id IS NULL
            AND microsoft_tenant_id IS NULL
            AND auth_provider IS DISTINCT FROM 'microsoft_entra'
            AND linked_at IS NULL
            AND last_verified_at IS NULL
        )::text AS unlinked_count
      FROM population
    `,
    [auth.tenantId, [...COMMUNICATION_PERMISSION_KEYS]]
  );

  const reviewCounts = relationAvailability.has_microsoft_identity_review
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (WHERE review_status = 'pending_review')::text AS pending_review_count,
            max(updated_at)::text AS last_review_at
          FROM microsoft_identity_review
          WHERE tenant_id = $1 OR ($2::boolean = true AND tenant_id IS NULL)
        `,
        [auth.tenantId, auth.authorityTier === "super_admin"]
      )
    : buildDefaultCountRow({
        pending_review_count: "0",
        last_review_at: null
      });

  const messageCounts = relationAvailability.has_teams_communication_delivery
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (WHERE status = 'failed'::teams_communication_delivery_status AND created_at >= now() - interval '14 days')::text AS failed_recent,
            count(*) FILTER (WHERE status = 'queued'::teams_communication_delivery_status AND created_at < now() - interval '15 minutes')::text AS stale_queued,
            count(*) FILTER (
              WHERE status = 'sending'::teams_communication_delivery_status
                AND COALESCE(last_attempted_at, created_at) < now() - interval '15 minutes'
            )::text AS stale_sending,
            count(*) FILTER (WHERE status = 'throttled'::teams_communication_delivery_status AND created_at >= now() - interval '7 days')::text AS throttled_recent,
            max(created_at) FILTER (WHERE status = 'failed'::teams_communication_delivery_status)::text AS last_failed_at
          FROM teams_communication_delivery
          WHERE tenant_id = $1
        `,
        [auth.tenantId]
      )
    : buildDefaultCountRow({
        failed_recent: "0",
        stale_queued: "0",
        stale_sending: "0",
        throttled_recent: "0",
        last_failed_at: null
      });

  const referenceCounts = relationAvailability.has_teams_communication_reference
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (WHERE status <> 'active'::teams_communication_reference_status)::text AS disabled_reference_count,
            max(updated_at)::text AS last_reference_at
          FROM teams_communication_reference
          WHERE tenant_id = $1
        `,
        [auth.tenantId]
      )
    : buildDefaultCountRow({
        disabled_reference_count: "0",
        last_reference_at: null
      });

  const meetingCounts = relationAvailability.has_teams_meeting_sync_operation
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (WHERE status = 'failed'::teams_meeting_sync_operation_status AND created_at >= now() - interval '14 days')::text AS failed_recent,
            count(*) FILTER (WHERE status = 'queued'::teams_meeting_sync_operation_status AND created_at < now() - interval '15 minutes')::text AS stale_queued,
            count(*) FILTER (
              WHERE status = 'processing'::teams_meeting_sync_operation_status
                AND COALESCE(last_attempted_at, created_at) < now() - interval '15 minutes'
            )::text AS stale_processing,
            max(created_at) FILTER (WHERE status = 'failed'::teams_meeting_sync_operation_status)::text AS last_failed_at
          FROM teams_meeting_sync_operation
          WHERE tenant_id = $1
        `,
        [auth.tenantId]
      )
    : buildDefaultCountRow({
        failed_recent: "0",
        stale_queued: "0",
        stale_processing: "0",
        last_failed_at: null
      });

  const meetingStateCounts = relationAvailability.has_teams_meeting_reference
    ? await client.query<CountRow>(
        `
          SELECT
            count(*) FILTER (
              WHERE sync_error IS NOT NULL
                AND meeting_status <> 'cancelled'::teams_meeting_status
            )::text AS sync_error_count,
            max(updated_at) FILTER (WHERE sync_error IS NOT NULL)::text AS last_sync_error_at
          FROM teams_meeting_reference
          WHERE tenant_id = $1
        `,
        [auth.tenantId]
      )
    : buildDefaultCountRow({
        sync_error_count: "0",
        last_sync_error_at: null
      });

  const recentEvents = await loadRecentCommunicationEvents(client, auth, 20);
  const deepLinkCandidates = await loadDeepLinkCandidates(client, auth.tenantId, relationAvailability);

  const deepLinkSummary = summarizeDeepLinkIssues(deepLinkCandidates);
  const missingMessagingRelations = listMissingCommunicationRelations(relationAvailability, [
    "has_teams_communication_reference",
    "has_teams_communication_delivery"
  ]);
  const missingMeetingRelations = listMissingCommunicationRelations(relationAvailability, [
    "has_teams_meeting_reference",
    "has_teams_meeting_sync_operation"
  ]);
  const missingSchemaRelations = listMissingCommunicationRelations(relationAvailability, [
    "has_microsoft_identity_review",
    "has_teams_communication_reference",
    "has_teams_communication_delivery",
    "has_teams_meeting_reference",
    "has_teams_meeting_sync_operation",
    "has_proactive_communication_decision",
    "has_communication_post_call_outcome"
  ]);
  const permissionedUsers = countValue(identityCounts.rows[0], "permissioned_user_count");
  const linkedReady = countValue(identityCounts.rows[0], "linked_ready_count");
  const disabledLinks = countValue(identityCounts.rows[0], "disabled_count");
  const incompleteLinks = countValue(identityCounts.rows[0], "incomplete_count");
  const unlinkedUsers = countValue(identityCounts.rows[0], "unlinked_count");
  const pendingReviews = countValue(reviewCounts.rows[0], "pending_review_count");
  const messagingFailures = countValue(messageCounts.rows[0], "failed_recent");
  const messagingQueued = countValue(messageCounts.rows[0], "stale_queued");
  const messagingSending = countValue(messageCounts.rows[0], "stale_sending");
  const throttledMessages = countValue(messageCounts.rows[0], "throttled_recent");
  const disabledReferences = countValue(referenceCounts.rows[0], "disabled_reference_count");
  const meetingFailures = countValue(meetingCounts.rows[0], "failed_recent");
  const meetingQueued = countValue(meetingCounts.rows[0], "stale_queued");
  const meetingProcessing = countValue(meetingCounts.rows[0], "stale_processing");
  const meetingSyncErrors = countValue(meetingStateCounts.rows[0], "sync_error_count");
  const notReadyPermissionedUsers = disabledLinks + incompleteLinks + unlinkedUsers;
  const historyFailures = areaFailureSummaries.get("communication_history")?.count ?? 0;
  const historyFailureAt = areaFailureSummaries.get("communication_history")?.last_event_at ?? null;
  const postCallFailures = areaFailureSummaries.get("post_call_follow_up")?.count ?? 0;
  const postCallFailureAt = areaFailureSummaries.get("post_call_follow_up")?.last_event_at ?? null;
  const inAppLaunchFailures = areaFailureSummaries.get("in_app_actions")?.count ?? 0;
  const inAppLaunchFailureAt = areaFailureSummaries.get("in_app_actions")?.last_event_at ?? null;
  const embeddedLaunchFailures = areaFailureSummaries.get("teams_embedded_entry_points")?.count ?? 0;
  const embeddedLaunchFailureAt = areaFailureSummaries.get("teams_embedded_entry_points")?.last_event_at ?? null;

  const healthChecks: CommunicationHealthCheck[] = [
    buildHealthCheck("identity_linking", {
      enabled: isAreaEnabled("identity_linking", flags),
      status:
        permissionedUsers > 0 && linkedReady === 0
          ? "failing"
          : incompleteLinks > 0
            ? "failing"
            : disabledLinks > 0 || unlinkedUsers > 0 || pendingReviews > 0
              ? "warning"
              : "healthy",
      summary:
        permissionedUsers > 0 && linkedReady === 0
          ? "No permissioned employees are fully ready for communication identity linking."
          : incompleteLinks > 0
            ? `${incompleteLinks} permissioned employee${incompleteLinks === 1 ? "" : "s"} have incomplete communication identity links.`
            : disabledLinks > 0 || unlinkedUsers > 0 || pendingReviews > 0
              ? "Some employee communication identities still need review or enablement."
              : "Communication identity linking looks healthy.",
      detailCount: notReadyPermissionedUsers + pendingReviews,
      lastEventAt: reviewCounts.rows[0]?.last_review_at ?? null,
      details: {
        permissioned_user_count: permissionedUsers,
        linked_ready_count: linkedReady,
        disabled_count: disabledLinks,
        incomplete_count: incompleteLinks,
        unlinked_count: unlinkedUsers,
        pending_review_count: pendingReviews
      }
    }),
    buildHealthCheck("teams_messaging", {
      enabled: isAreaEnabled("teams_messaging", flags),
      status:
        missingMessagingRelations.length > 0
          ? "failing"
          : messagingFailures > 0 || messagingQueued > 0 || messagingSending > 0
          ? "failing"
          : disabledReferences > 0 || throttledMessages > 10
            ? "warning"
            : "healthy",
      summary:
        missingMessagingRelations.length > 0
          ? "Teams messaging tables are not available in this environment."
          : messagingFailures > 0 || messagingQueued > 0 || messagingSending > 0
          ? "Teams messaging has failed or stuck outbound sends."
          : disabledReferences > 0 || throttledMessages > 10
            ? "Teams messaging has throttled sends or disabled destinations that need review."
            : "Teams messaging delivery looks healthy.",
      detailCount: messagingFailures + messagingQueued + messagingSending + disabledReferences + throttledMessages + missingMessagingRelations.length,
      lastEventAt: messageCounts.rows[0]?.last_failed_at ?? referenceCounts.rows[0]?.last_reference_at ?? null,
      details: {
        failed_recent: messagingFailures,
        stale_queued: messagingQueued,
        stale_sending: messagingSending,
        throttled_recent: throttledMessages,
        disabled_reference_count: disabledReferences,
        missing_relations: missingMessagingRelations
      }
    }),
    buildHealthCheck("teams_meetings", {
      enabled: isAreaEnabled("teams_meetings", flags),
      status:
        missingMeetingRelations.length > 0
          ? "failing"
          : meetingFailures > 0 || meetingQueued > 0 || meetingProcessing > 0 || meetingSyncErrors > 0
          ? "failing"
          : "healthy",
      summary:
        missingMeetingRelations.length > 0
          ? "Teams meeting tables are not available in this environment."
          : meetingFailures > 0 || meetingQueued > 0 || meetingProcessing > 0 || meetingSyncErrors > 0
          ? "Teams meetings have failed or stuck sync operations."
          : "Teams meeting sync looks healthy.",
      detailCount: meetingFailures + meetingQueued + meetingProcessing + meetingSyncErrors + missingMeetingRelations.length,
      lastEventAt: meetingCounts.rows[0]?.last_failed_at ?? meetingStateCounts.rows[0]?.last_sync_error_at ?? null,
      details: {
        failed_recent: meetingFailures,
        stale_queued: meetingQueued,
        stale_processing: meetingProcessing,
        sync_error_count: meetingSyncErrors,
        missing_relations: missingMeetingRelations
      }
    }),
    buildHealthCheck("in_app_actions", {
      enabled: isAreaEnabled("in_app_actions", flags),
      status:
        inAppLaunchFailures > 0
          ? "failing"
          : notReadyPermissionedUsers > 0
            ? "warning"
            : "healthy",
      summary:
        inAppLaunchFailures > 0
          ? `${inAppLaunchFailures} in-app communication launch failure${inAppLaunchFailures === 1 ? "" : "s"} were captured recently.`
          : notReadyPermissionedUsers > 0
          ? `${notReadyPermissionedUsers} permissioned employee${notReadyPermissionedUsers === 1 ? "" : "s"} cannot use communication actions yet.`
          : "In-app communication actions look healthy.",
      detailCount: notReadyPermissionedUsers + inAppLaunchFailures,
      lastEventAt: inAppLaunchFailureAt,
      details: {
        permissioned_user_count: permissionedUsers,
        permissioned_not_ready_count: notReadyPermissionedUsers,
        launch_failure_count: inAppLaunchFailures
      }
    }),
    buildHealthCheck("communication_history", {
      enabled: isAreaEnabled("communication_history", flags),
      status: historyFailures > 0 ? "warning" : "healthy",
      summary:
        historyFailures > 0
          ? `${historyFailures} communication history access or load failure${historyFailures === 1 ? "" : "s"} were captured recently.`
          : "Communication history access looks healthy.",
      detailCount: historyFailures,
      lastEventAt: historyFailureAt,
      details: {
        recent_failures: historyFailures
      }
    }),
    buildHealthCheck("proactive_messaging_rules", {
      enabled: isAreaEnabled("proactive_messaging_rules", flags),
      status:
        supportWorkspace.routing_rule_problems.details.failed_count && Number(supportWorkspace.routing_rule_problems.details.failed_count) > 0
          ? "failing"
          : supportWorkspace.routing_rule_problems.count > 0
            ? "warning"
            : "healthy",
      summary: supportWorkspace.routing_rule_problems.summary,
      detailCount: supportWorkspace.routing_rule_problems.count,
      lastEventAt: supportWorkspace.routing_rule_problems.last_event_at,
      details: supportWorkspace.routing_rule_problems.details
    }),
    buildHealthCheck("post_call_follow_up", {
      enabled: isAreaEnabled("post_call_follow_up", flags),
      status: postCallFailures > 0 ? "warning" : "healthy",
      summary:
        postCallFailures > 0
          ? `${postCallFailures} post-call follow-up failure${postCallFailures === 1 ? "" : "s"} were captured recently.`
          : "Post-call follow-up looks healthy.",
      detailCount: postCallFailures,
      lastEventAt: postCallFailureAt,
      details: {
        recent_failures: postCallFailures
      }
    }),
    buildHealthCheck("pre_call_context", {
      enabled: isAreaEnabled("pre_call_context", flags),
      status: issues.some((issue) => issue.area === "pre_call_context") ? "warning" : "healthy",
      summary: issues.some((issue) => issue.area === "pre_call_context")
        ? "Pre-call context has rollout dependency issues to review."
        : "Pre-call context is enabled for the meeting workflow.",
      detailCount: issues.filter((issue) => issue.area === "pre_call_context").length,
      details: {
        issue_codes: issues.filter((issue) => issue.area === "pre_call_context").map((issue) => issue.code)
      }
    }),
    buildHealthCheck("governance", {
      enabled: true,
      status: supportWorkspace.permission_failures.count > 0 ? "warning" : "healthy",
      summary: supportWorkspace.permission_failures.summary,
      detailCount: supportWorkspace.permission_failures.count,
      lastEventAt: supportWorkspace.permission_failures.last_event_at,
      details: supportWorkspace.permission_failures.details
    }),
    buildHealthCheck("teams_embedded_entry_points", {
      enabled: isAreaEnabled("teams_embedded_entry_points", flags),
      status:
        deepLinkSummary.broken_count > 0
          || embeddedLaunchFailures > 0
          ? "failing"
          : issues.some((issue) => issue.area === "teams_embedded_entry_points" && issue.severity === "error")
            ? "failing"
            : issues.some((issue) => issue.area === "teams_embedded_entry_points")
              ? "warning"
              : "healthy",
      summary:
        deepLinkSummary.broken_count > 0
          ? `${deepLinkSummary.broken_count} stored Teams communication deep link${deepLinkSummary.broken_count === 1 ? "" : "s"} are malformed or incomplete.`
          : embeddedLaunchFailures > 0
            ? `${embeddedLaunchFailures} Teams embedded communication launch failure${embeddedLaunchFailures === 1 ? "" : "s"} were captured recently.`
          : issues.some((issue) => issue.area === "teams_embedded_entry_points")
            ? "Teams embedded communication entry points have rollout or manifest issues to review."
            : "Teams embedded communication entry points look healthy.",
      detailCount:
        deepLinkSummary.broken_count + embeddedLaunchFailures + issues.filter((issue) => issue.area === "teams_embedded_entry_points").length,
      lastEventAt: embeddedLaunchFailureAt,
      details: {
        ...deepLinkSummary,
        launch_failure_count: embeddedLaunchFailures
      }
    }),
    buildHealthCheck("config", {
      enabled: true,
      status:
        issues.some((issue) => issue.severity === "error") || missingSchemaRelations.length > 0
          ? "failing"
          : issues.length > 0
            ? "warning"
            : "healthy",
      summary:
        issues.length > 0 || missingSchemaRelations.length > 0
          ? `${issues.length + missingSchemaRelations.length} communication validation or schema issue${issues.length + missingSchemaRelations.length === 1 ? "" : "s"} should be reviewed.`
          : "Communication startup validation passed.",
      detailCount: issues.length + missingSchemaRelations.length,
      details: {
        issues,
        missing_relations: missingSchemaRelations
      }
    })
  ];

  return {
    generated_at: new Date().toISOString(),
    feature_flags: flags,
    admin_controls: adminControls,
    startup_validation: {
      valid: issues.every((issue) => issue.severity !== "error"),
      issues
    },
    health_checks: healthChecks,
    support_workspace: supportWorkspace,
    recent_events: recentEvents
  };
}
