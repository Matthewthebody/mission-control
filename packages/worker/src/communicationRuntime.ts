import { config } from "./config.js";

export function assertCommunicationWorkerStartupConfig() {
  const issues: string[] = [];

  if (config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED) {
    if (!config.COMMUNICATION_IDENTITY_LINKING_ENABLED) {
      issues.push("Teams messaging is enabled while communication identity linking is disabled.");
    }
    if (!config.MICROSOFT_TEAMS_BOT_APP_ID || !config.MICROSOFT_TEAMS_BOT_APP_PASSWORD || !config.MICROSOFT_GRAPH_TENANT_ID) {
      issues.push("Teams messaging is enabled but bot application credentials are incomplete.");
    }
    if (!(config.TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS > 0)) {
      issues.push("Teams messaging requires a positive TEAMS_COMMUNICATION_GRAPH_TIMEOUT_MS value.");
    }
  }

  if (config.MICROSOFT_TEAMS_MEETINGS_ENABLED) {
    if (!config.COMMUNICATION_IDENTITY_LINKING_ENABLED) {
      issues.push("Teams meetings are enabled while communication identity linking is disabled.");
    }
    if (!config.MICROSOFT_GRAPH_CLIENT_ID || !config.MICROSOFT_GRAPH_CLIENT_SECRET || !config.MICROSOFT_GRAPH_TENANT_ID) {
      issues.push("Teams meetings are enabled but Microsoft Graph application credentials are incomplete.");
    }
    if (!(config.TEAMS_MEETING_GRAPH_TIMEOUT_MS > 0)) {
      issues.push("Teams meetings require a positive TEAMS_MEETING_GRAPH_TIMEOUT_MS value.");
    }
  }

  if (config.NODE_ENV === "production" && issues.length > 0) {
    throw new Error(`Communication worker startup validation failed: ${issues.join(" ")}`);
  }
}
