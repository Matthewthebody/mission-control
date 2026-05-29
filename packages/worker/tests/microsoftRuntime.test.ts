import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { assertMicrosoftWorkerStartupConfig } from "../src/microsoftRuntime.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  MICROSOFT_OUTLOOK_SYNC_ENABLED: config.MICROSOFT_OUTLOOK_SYNC_ENABLED,
  OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED,
  MICROSOFT_GRAPH_CLIENT_ID: config.MICROSOFT_GRAPH_CLIENT_ID,
  MICROSOFT_GRAPH_CLIENT_SECRET: config.MICROSOFT_GRAPH_CLIENT_SECRET,
  MICROSOFT_GRAPH_TENANT_ID: config.MICROSOFT_GRAPH_TENANT_ID,
  TEAMS_OPERATIONAL_ALERTS_ENABLED: config.TEAMS_OPERATIONAL_ALERTS_ENABLED,
  MICROSOFT_365_MAIL_AUTOMATION_ENABLED: config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED,
  MICROSOFT_365_CLIENT_INTAKE_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_ENABLED,
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED,
  MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED
};

function resetMicrosoftWorkerConfig() {
  Object.assign(config, originalConfig);
}

describe("assertMicrosoftWorkerStartupConfig", () => {
  afterEach(() => {
    resetMicrosoftWorkerConfig();
  });

  it("allows the delegated Outlook pilot to run without worker Graph app credentials when app-permission features are off", () => {
    Object.assign(config, {
      NODE_ENV: "production",
      MICROSOFT_OUTLOOK_SYNC_ENABLED: true,
      OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: false,
      MICROSOFT_GRAPH_CLIENT_ID: "",
      MICROSOFT_GRAPH_CLIENT_SECRET: "",
      MICROSOFT_GRAPH_TENANT_ID: "",
      TEAMS_OPERATIONAL_ALERTS_ENABLED: false,
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: false,
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: false,
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: false,
      MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: false
    });

    expect(() => assertMicrosoftWorkerStartupConfig()).not.toThrow();
  });

  it("blocks worker startup whenever the retired Outlook app-permission background path is enabled", () => {
    Object.assign(config, {
      NODE_ENV: "production",
      MICROSOFT_OUTLOOK_SYNC_ENABLED: true,
      OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: true,
      MICROSOFT_GRAPH_CLIENT_ID: "legacy-client-id",
      MICROSOFT_GRAPH_CLIENT_SECRET: "legacy-client-secret",
      MICROSOFT_GRAPH_TENANT_ID: "legacy-tenant-id",
      TEAMS_OPERATIONAL_ALERTS_ENABLED: false,
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: false,
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: false,
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: false,
      MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: false
    });

    expect(() => assertMicrosoftWorkerStartupConfig()).toThrow(/not allowed in the delegated read-only pilot/i);
  });
});
