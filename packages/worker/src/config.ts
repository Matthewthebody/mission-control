import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { resolveWorkerRepoPath } from "./utils/repoPaths.js";

// The repo root .env is the documented source of truth for local development.
// A legacy parent-folder .env can still supply missing values, but it should not override repo-local settings.
loadEnv({ path: resolveWorkerRepoPath(".env"), override: false });
loadEnv({ path: resolve(resolveWorkerRepoPath(), "..", ".env"), override: false });

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

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DB_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  INTERNAL_SOCKET_SECRET: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  MICROSOFT_GRAPH_CLIENT_ID: z.string().default(""),
  MICROSOFT_GRAPH_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_GRAPH_TENANT_ID: z.string().default(""),
  MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE: z.string().default(""),
  MICROSOFT_OUTLOOK_SYNC_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  OUTLOOK_GRAPH_TIMEOUT_MS: z.coerce.number().default(5000),
  OUTLOOK_CALENDAR_TIMEZONE: z.string().default("America/Chicago"),
  OUTLOOK_SYNC_CANCEL_MODE: z.enum(["cancel", "delete"]).default("cancel"),
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
  MICROSOFT_365_CLIENT_INTAKE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: z.string().default(""),
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
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
  TEAMS_OPERATIONAL_ALERTS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
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
  TEAMS_WEBHOOK_TIMEOUT_MS: z.coerce.number().default(5000),
  TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS: z.coerce.number().default(5000),
  TEAMS_MEETING_GRAPH_TIMEOUT_MS: z.coerce.number().default(5000),
  COMMUNICATIONS_STRICT_STARTUP_VALIDATION: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  SMS_FROM_NUMBER: z.string().default(""),
  SMTP_FROM_ADDRESS: z.string().default(""),
  FIREBASE_PROJECT_ID: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default(""),
  FIREBASE_PRIVATE_KEY: z.string().default(""),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default(""),
  AGREEMENT_ESIGN_PROVIDER: z.enum(["provider_stub", "dropbox_sign"]).default("provider_stub"),
  AGREEMENT_ESIGN_API_KEY: z.string().default(""),
  AGREEMENT_ESIGN_BASE_URL: z.string().default(""),
  PILOT_MODE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value === "true")
});

export const config = schema.parse(process.env);
