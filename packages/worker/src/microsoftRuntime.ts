import { config } from "./config.js";

export function assertMicrosoftWorkerStartupConfig() {
  if (config.NODE_ENV !== "production") {
    return;
  }

  const errors: string[] = [];
  if (config.MICROSOFT_OUTLOOK_SYNC_ENABLED && config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED) {
    errors.push(
      "Outlook app-permission background sync is not allowed in the delegated read-only pilot. Disable OUTLOOK_APP_PERMISSION_FEATURES_ENABLED."
    );
  }
  if (config.TEAMS_OPERATIONAL_ALERTS_ENABLED && !(config.TEAMS_WEBHOOK_TIMEOUT_MS > 0)) {
    errors.push("Teams alerts are enabled but TEAMS_WEBHOOK_TIMEOUT_MS is invalid.");
  }
  if (config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    if (!(config.MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS > 0)) {
      errors.push("Microsoft 365 mail automation is enabled but MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS is invalid.");
    }
    if (!config.API_PUBLIC_URL) {
      errors.push("Microsoft 365 mail automation is enabled but API_PUBLIC_URL is missing.");
    }
    if (!Object.keys(config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS).length) {
      errors.push("Microsoft 365 mail automation is enabled but MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS is empty.");
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET) {
      errors.push("Microsoft 365 mail automation is enabled in production but MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET is missing.");
    }
  }
  if (config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
    if (!config.API_PUBLIC_URL) {
      errors.push("Microsoft 365 client intake is enabled but API_PUBLIC_URL is missing.");
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET) {
      errors.push("Microsoft 365 client intake is enabled in production but MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET is missing.");
    }
    if (!config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
      errors.push("Microsoft 365 client intake requires MICROSOFT_365_MAIL_AUTOMATION_ENABLED for confirmations and reminders.");
    }
  }
  if (config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED) {
    if (!config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
      errors.push("Microsoft 365 client intake operational control requires MICROSOFT_365_CLIENT_INTAKE_ENABLED.");
    }
    if (!config.TEAMS_OPERATIONAL_ALERTS_ENABLED) {
      errors.push("Microsoft 365 client intake operational control requires TEAMS_OPERATIONAL_ALERTS_ENABLED for escalations and daily digests.");
    }
  }
  if (config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED) {
    if (!(config.MICROSOFT_365_SMS_TIMEOUT_MS > 0)) {
      errors.push("Microsoft 365 SMS optimization is enabled but MICROSOFT_365_SMS_TIMEOUT_MS is invalid.");
    }
    if (!config.API_PUBLIC_URL) {
      errors.push("Microsoft 365 SMS optimization is enabled but API_PUBLIC_URL is missing.");
    }
    if (!config.MICROSOFT_365_SMS_FROM_NUMBER) {
      errors.push("Microsoft 365 SMS optimization is enabled but MICROSOFT_365_SMS_FROM_NUMBER is missing.");
    }
    if (!Object.keys(config.MICROSOFT_365_SMS_FLOW_ENDPOINTS).length) {
      errors.push("Microsoft 365 SMS optimization is enabled but MICROSOFT_365_SMS_FLOW_ENDPOINTS is empty.");
    }
    if (!config.MICROSOFT_365_CLIENT_INTAKE_ENABLED) {
      errors.push("Microsoft 365 SMS optimization requires MICROSOFT_365_CLIENT_INTAKE_ENABLED for reminder mappings.");
    }
    if (config.NODE_ENV === "production" && !config.MICROSOFT_365_SMS_CALLBACK_SECRET) {
      errors.push("Microsoft 365 SMS optimization is enabled in production but MICROSOFT_365_SMS_CALLBACK_SECRET is missing.");
    }
  }
  if (errors.length > 0) {
    throw new Error(`Microsoft worker startup validation failed: ${errors.join(" ")}`);
  }
}
