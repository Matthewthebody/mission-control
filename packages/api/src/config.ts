import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { resolveApiRepoPath } from "./utils/repoPaths.js";
import { DEFAULT_SUSPICIOUS_SHIFT_MINUTES } from "./domain/staffing/staffing-capacity.js";

// The repo root .env is the documented source of truth for local development.
// A legacy parent-folder .env can still supply missing values, but it should not override repo-local settings.
loadEnv({ path: resolveApiRepoPath(".env"), override: false });
loadEnv({ path: resolve(resolveApiRepoPath(), "..", ".env"), override: false });

function parseStringMap(value: string | undefined, fallback: Record<string, string> = {}) {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
    );
  } catch {
    return fallback;
  }
}

// MC-016: passwordless dev-login must FAIL CLOSED when the runtime environment is
// ambiguous. A deploy that forgets to set NODE_ENV lands on the "development"
// default above — that must never silently enable dev-login. The default is true
// ONLY for an explicitly non-production NODE_ENV (the repo .env sets development;
// vitest sets test); an unset NODE_ENV means dev-login requires ALLOW_DEV_LOGIN=true.
export function devLoginDefaultFor(nodeEnvRaw: string | undefined) {
  return nodeEnvRaw !== undefined && nodeEnvRaw !== "production";
}

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOW_DEV_LOGIN: z
    .string()
    .optional()
    .transform((value) => value === undefined ? devLoginDefaultFor(process.env.NODE_ENV) : value === "true"),
  ALLOW_PASSWORD_LOGIN: z
    .string()
    .optional()
    .transform((value) => value === undefined ? process.env.NODE_ENV !== "production" : value === "true"),
  ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY: z
    .string()
    .optional()
    .transform((value) => value === undefined ? process.env.NODE_ENV === "production" : value === "true"),
  DB_URL: z.string().min(1),
  DB_READONLY_GET_ENFORCEMENT: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().min(1).default(300),
  JWT_SECRET: z.string().min(1),
  JWT_SECRET_PREVIOUS: z.string().optional().default(""),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  AWS_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  AWS_ACCESS_KEY_ID: z.string().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().default(""),
  GOOGLE_MAPS_API_KEY: z.string().default(""),
  MICROSOFT_GRAPH_CLIENT_ID: z.string().default(""),
  MICROSOFT_GRAPH_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_GRAPH_TENANT_ID: z.string().default(""),
  MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE: z.string().default(""),
  MICROSOFT_365_GOVERNANCE_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_TENANT_DISPLAY_NAME: z.string().default(""),
  MICROSOFT_365_TENANT_PRIMARY_DOMAIN: z.string().default(""),
  MICROSOFT_365_SHAREPOINT_ROOT_URL: z.string().default(""),
  MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: z.string().default(""),
  MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: z.string().default(""),
  MICROSOFT_365_SECURITY_GROUP_PREFIX: z.string().default(""),
  MICROSOFT_365_OPERATING_SYSTEM_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_WORKSPACE_NAME_PREFIX: z.string().default(""),
  MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_DASHBOARD_INTEGRATION_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_MAIL_AUTOMATION_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_MAIL_AUTOMATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS: z.coerce.number().default(8000),
  MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: z
    .string()
    .optional()
    .transform((value) => parseStringMap(value)),
  MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: z.string().default(""),
  MICROSOFT_365_MAIL_AUTOMATION_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_CLIENT_INTAKE_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_CLIENT_INTAKE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: z.string().default(""),
  MICROSOFT_365_CLIENT_INTAKE_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_CLIENT_PORTAL_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_CLIENT_PORTAL_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_CLIENT_PORTAL_SITE_URL: z.string().default(""),
  MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER: z.string().default(""),
  MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY: z.string().default(""),
  MICROSOFT_365_CLIENT_PORTAL_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_SMS_OPTIMIZATION_ENV: z.enum(["development", "staging", "production"]).optional(),
  MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_SMS_PROVIDER: z.enum(["azure_communication_services", "power_automate_sms_bridge"]).default("azure_communication_services"),
  MICROSOFT_365_SMS_FROM_NUMBER: z.string().default(""),
  MICROSOFT_365_SMS_TIMEOUT_MS: z.coerce.number().default(8000),
  MICROSOFT_365_SMS_FLOW_ENDPOINTS: z
    .string()
    .optional()
    .transform((value) => parseStringMap(value)),
  MICROSOFT_365_SMS_CALLBACK_SECRET: z.string().default(""),
  MICROSOFT_365_SMS_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_OPERATING_SYSTEM_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  MICROSOFT_365_GOVERNANCE_STRICT_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  OUTLOOK_CALENDAR_TIMEZONE: z.string().default("America/Chicago"),
  MICROSOFT_ENTRA_AUTH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_OUTLOOK_SYNC_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_ENTRA_REDIRECT_URI: z.string().default(""),
  MICROSOFT_ENTRA_POST_LOGOUT_REDIRECT_URI: z.string().default(""),
  MICROSOFT_ENTRA_STATE_MINUTES: z.coerce.number().default(15),
  OUTLOOK_TOKEN_ENCRYPTION_SECRET: z.string().default(""),
  OUTLOOK_OAUTH_STATE_MINUTES: z.coerce.number().default(15),
  OUTLOOK_GRAPH_TIMEOUT_MS: z.coerce.number().default(5000),
  OUTLOOK_CONFLICT_TRAVEL_BUFFER_MINUTES: z.coerce.number().default(30),
  OUTLOOK_CONFLICT_MODE: z.enum(["warning", "blocking"]).default("warning"),
  OUTLOOK_SYNC_CANCEL_MODE: z.enum(["cancel", "delete"]).default("cancel"),
  TEAMS_OPERATIONAL_ALERTS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  COMMUNICATION_HISTORY_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMMUNICATION_PROACTIVE_RULES_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMMUNICATION_PRE_CALL_CONTEXT_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMMUNICATIONS_DIAGNOSTICS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMMUNICATION_IDENTITY_LINKING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMMUNICATION_IN_APP_ACTIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_TEAMS_MEETINGS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_TEAMS_EMBEDDED_COMMUNICATIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  MICROSOFT_TEAMS_PERSONAL_APP_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_TEAMS_BOT_APP_ID: z.string().default(""),
  MICROSOFT_TEAMS_BOT_APP_PASSWORD: z.string().default(""),
  MICROSOFT_TEAMS_DEV_BYPASS_AUTH: z
    .string()
    .optional()
    .transform((value) => value === undefined ? process.env.NODE_ENV !== "production" : value === "true"),
  TEAMS_WEBHOOK_TIMEOUT_MS: z.coerce.number().default(5000),
  TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS: z.coerce.number().default(5000),
  TEAMS_COMMUNICATION_THROTTLE_MINUTES: z.coerce.number().default(5),
  TEAMS_MEETING_GRAPH_TIMEOUT_MS: z.coerce.number().default(5000),
  TEAMS_MEETING_SYNC_THROTTLE_MINUTES: z.coerce.number().default(3),
  ZENDESK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  ZENDESK_SUBDOMAIN: z.string().default(""),
  ZENDESK_AUTH_MODE: z.enum(["api_token", "oauth"]).default("api_token"),
  ZENDESK_EMAIL: z.string().default(""),
  ZENDESK_API_TOKEN: z.string().default(""),
  ZENDESK_CLIENT_ID: z.string().default(""),
  ZENDESK_CLIENT_SECRET: z.string().default(""),
  ZENDESK_ACCESS_TOKEN: z.string().default(""),
  ZENDESK_REFRESH_TOKEN: z.string().default(""),
  ZENDESK_TIMEOUT_MS: z.coerce.number().default(8000),
  ZENDESK_SYNC_LOOKBACK_DAYS: z.coerce.number().default(120),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  SMS_FROM_NUMBER: z.string().default(""),
  SMTP_FROM_ADDRESS: z.string().default(""),
  FIREBASE_PROJECT_ID: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default(""),
  FIREBASE_PRIVATE_KEY: z.string().default(""),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default(""),
  SOCKET_IO_CORS_ORIGIN: z.string().default("http://localhost:5173"),
  INTERNAL_SOCKET_SECRET: z.string().min(1),
  WEBHOOK_SHARED_SECRET: z.string().default(""),
  INTEGRATION_WEBHOOK_ALLOW_QUERY_TENANT_ROUTING: z
    .string()
    .optional()
    .transform((value) => value === undefined ? process.env.NODE_ENV !== "production" : value === "true"),
  TRUST_PROXY: z.string().default(""),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  ADMIN_WEB_URL: z.string().default("http://localhost:5173"),
  // A single work_shift longer than this many minutes is treated as suspicious/corrupt (flagged, still clipped).
  CAPACITY_SUSPICIOUS_SHIFT_MINUTES: z.coerce.number().int().positive().default(DEFAULT_SUSPICIOUS_SHIFT_MINUTES),
  // Cooldown between manual staffing acknowledgment reminders for the same recipient (minutes). Conservative
  // default of one reminder per recipient per hour; a second request inside the window is an honest no-op.
  STAFFING_REMINDER_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),
  AUTH_SESSION_HOURS: z.coerce.number().default(8),
  AUTH_ELEVATED_MINUTES: z.coerce.number().default(10),
  AUTH_PRIVILEGED_MODE_MINUTES: z.coerce.number().default(15),
  AUTH_BREAK_GLASS_MAX_MINUTES: z.coerce.number().default(30),
  AUTH_COOKIE_NAME: z.string().default("pmc_session"),
  AUTH_CSRF_COOKIE_NAME: z.string().default("pmc_csrf"),
  INVITE_TTL_HOURS: z.coerce.number().default(72),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().default(30),
  MONDAY_API_TOKEN: z.string().default(""),
  MONDAY_ITEM_URL_TEMPLATE: z.string().default(""),
  AGREEMENT_ESIGN_PROVIDER: z.enum(["provider_stub", "dropbox_sign"]).default("provider_stub"),
  AGREEMENT_ESIGN_API_KEY: z.string().default(""),
  AGREEMENT_ESIGN_BASE_URL: z.string().default(""),
  HOME_LABOR_WIDGET_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_DIAGNOSTICS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_WORKFLOW_ENGINE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_OPERATIONAL_EVENTS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_GLOBAL_SEARCH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_ACTIVITY_TIMELINE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_ADMIN_CONFIGURATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_APPROVAL_FRAMEWORK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_REPORTING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  CORE_FOUNDATION_STRICT_STARTUP_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  COMMUNICATIONS_STRICT_STARTUP_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  COMMUNICATION_DIAGNOSTICS_LOOKBACK_DAYS: z.coerce.number().int().min(1).default(14),
  // ON by default since 2026-07-13 (owner-ratified E21): the intake cascade is
  // the ONE front door. Opt out with CENTRAL_JOB_INTAKE_V1_ENABLED=false.
  CENTRAL_JOB_INTAKE_V1_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  JOB_CLOSEOUT_V1_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? process.env.NODE_ENV !== "production" : value === "true"),
  JOB_CLOSEOUT_CHECK_IN_OFFSET_MINUTES: z.coerce.number().int().min(0).default(30),
  JOB_CLOSEOUT_MISSED_CHECK_IN_GRACE_MINUTES: z.coerce.number().int().min(1).default(15),
  JOB_CLOSEOUT_LATENESS_THRESHOLD_MINUTES: z.coerce.number().int().min(1).default(10),
  JOB_CLOSEOUT_REQUIRE_SENIOR_EVALUATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  // Owner rule #1 (ratified 2026-07-13): EVERYONE who works a shoot owes a
  // post-shoot evaluation — associates included. Default ON; opt out per env.
  JOB_CLOSEOUT_REQUIRE_ASSOCIATE_EVALUATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  // Ask Bailey (docs/ask-bailey/2026-07-13-ask-bailey-architecture.md, D4/D7).
  // Providers are server-env configured and replaceable; the deterministic
  // adapters are the honest default with no external dependency or secret.
  ASK_BAILEY_LLM_PROVIDER: z.string().default("deterministic"),
  ASK_BAILEY_LLM_BASE_URL: z.string().default(""),
  ASK_BAILEY_LLM_API_KEY: z.string().default(""),
  ASK_BAILEY_LLM_MODEL: z.string().default(""),
  ASK_BAILEY_TRANSCRIPTION_PROVIDER: z.string().default("deterministic"),
  ASK_BAILEY_MAX_RETRIEVED_SEGMENTS: z.coerce.number().int().min(1).max(24).default(8),
  ASK_BAILEY_MAX_ANSWER_CHARS: z.coerce.number().int().min(200).max(20000).default(4000),
  ASK_BAILEY_ASK_RATE_MAX_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(12),
  // H1 retrieval quality: embedding lifecycle + hybrid ranking knobs.
  ASK_BAILEY_EMBEDDING_PROVIDER: z.string().default("deterministic"),
  ASK_BAILEY_EMBEDDING_BASE_URL: z.string().default(""),
  ASK_BAILEY_EMBEDDING_API_KEY: z.string().default(""),
  ASK_BAILEY_EMBEDDING_MODEL: z.string().default(""),
  ASK_BAILEY_SEMANTIC_TOP_K: z.coerce.number().int().min(1).max(24).default(8),
  ASK_BAILEY_SEMANTIC_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.45),
  ASK_BAILEY_MIN_MATCHED_CONCEPTS: z.coerce.number().int().min(1).max(4).default(2),
  ASK_BAILEY_TYPO_SIMILARITY: z.coerce.number().min(0.3).max(1).default(0.5),
  ASK_BAILEY_MIN_EVIDENCE_SCORE: z.coerce.number().min(0).max(1).default(0.12),
  ASK_BAILEY_MAX_SEGMENTS_PER_SOURCE: z.coerce.number().int().min(1).max(8).default(3),
  JOB_CLOSEOUT_DAILY_REPORT_TIME: z.string().default("06:00"),
  JOB_CLOSEOUT_WEEKLY_REPORT_TIME: z.string().default("Monday 06:00"),
  JOB_CLOSEOUT_TIMEZONE: z.string().default("America/Chicago"),
  JOB_CLOSEOUT_PHOTO_SOFT_REMINDER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  COMPLIANCE_WORKSPACE_V1_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value === "true"),
  TV_MODE_SHOW_EMPLOYEE_NAMES: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  PILOT_MODE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true")
});

export const config = configSchema.parse(process.env);
