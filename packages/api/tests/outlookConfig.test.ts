import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import {
  OUTLOOK_PILOT_CALLBACK_PATH,
  OUTLOOK_PILOT_SCOPE_STRING,
  assertOutlookOauthConfig,
  createOutlookOauthConfig,
  getMissingOutlookOauthEnvVars,
  isOutlookOauthConfigured
} from "../src/config/outlook.js";

const BASE_ENV = {
  OUTLOOK_TENANT_ID: "c9898c8a-8f34-4007-8210-13d6e8b8af30",
  OUTLOOK_CLIENT_ID: "c07e248d-ce8a-441e-84a4-00defaccbf03",
  OUTLOOK_CLIENT_SECRET: "replace-with-secret",
  OUTLOOK_REDIRECT_URI: `http://localhost:4000${OUTLOOK_PILOT_CALLBACK_PATH}`,
  OUTLOOK_SCOPES: `offline_access User.Read Calendars.Read User.Read`
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("outlook OAuth config", () => {
  it("parses and de-duplicates scopes into a safe config object", () => {
    const outlookConfig = createOutlookOauthConfig(BASE_ENV);

    expect(outlookConfig.tenantId).toBe(BASE_ENV.OUTLOOK_TENANT_ID);
    expect(outlookConfig.clientId).toBe(BASE_ENV.OUTLOOK_CLIENT_ID);
    expect(outlookConfig.redirectUri).toBe(`http://localhost:4000${OUTLOOK_PILOT_CALLBACK_PATH}`);
    expect(outlookConfig.scopesArray).toEqual(["offline_access", "User.Read", "Calendars.Read"]);
    expect(outlookConfig.scopesString).toBe(OUTLOOK_PILOT_SCOPE_STRING);
    expect(outlookConfig.authorityUrl).toBe(`https://login.microsoftonline.com/${BASE_ENV.OUTLOOK_TENANT_ID}`);
    expect(outlookConfig.authorizeUrl).toBe(`${outlookConfig.authorityUrl}/oauth2/v2.0/authorize`);
    expect(outlookConfig.tokenUrl).toBe(`${outlookConfig.authorityUrl}/oauth2/v2.0/token`);
    expect(outlookConfig.graphBaseUrl).toBe("https://graph.microsoft.com/v1.0");
  });

  it("fails fast when required variables are missing", () => {
    expect(() =>
      assertOutlookOauthConfig({
        ...BASE_ENV,
        OUTLOOK_CLIENT_SECRET: ""
      })
    ).toThrow("Missing required Outlook OAuth environment variable: OUTLOOK_CLIENT_SECRET");

    expect(getMissingOutlookOauthEnvVars({ ...BASE_ENV, OUTLOOK_CLIENT_SECRET: "" })).toContain("OUTLOOK_CLIENT_SECRET");
    expect(isOutlookOauthConfigured({ ...BASE_ENV, OUTLOOK_CLIENT_SECRET: "" })).toBe(false);
  });

  it("rejects an invalid redirect URI", () => {
    expect(() =>
      createOutlookOauthConfig({
        ...BASE_ENV,
        OUTLOOK_REDIRECT_URI: "/api/integrations/outlook/oauth/callback"
      })
    ).toThrow("OUTLOOK_REDIRECT_URI must be a valid absolute URL.");
  });

  it("rejects a redirect URI that does not use the delegated pilot callback path", () => {
    expect(() =>
      createOutlookOauthConfig({
        ...BASE_ENV,
        OUTLOOK_REDIRECT_URI: "http://localhost:4000/auth/outlook/callback"
      })
    ).toThrow(`OUTLOOK_REDIRECT_URI must use the Phase 1 Outlook callback path ${OUTLOOK_PILOT_CALLBACK_PATH}.`);
  });

  it("rejects an empty scopes value after trimming", () => {
    expect(() =>
      createOutlookOauthConfig({
        ...BASE_ENV,
        OUTLOOK_SCOPES: "   "
      })
    ).toThrow("OUTLOOK_SCOPES must contain at least one scope.");
  });

  it("rejects scopes outside the delegated calendar-only pilot boundary", () => {
    expect(() =>
      createOutlookOauthConfig({
        ...BASE_ENV,
        OUTLOOK_SCOPES: "offline_access User.Read Calendars.Read Mail.Read"
      })
    ).toThrow(`OUTLOOK_SCOPES must exactly match the Phase 1 delegated Outlook pilot scopes: ${OUTLOOK_PILOT_SCOPE_STRING}.`);
  });

  it("fails app startup when Outlook sync is enabled without valid OAuth config", () => {
    const originalOutlookSyncEnabled = config.MICROSOFT_OUTLOOK_SYNC_ENABLED;
    process.env = {
      ...ORIGINAL_ENV,
      OUTLOOK_TENANT_ID: "",
      OUTLOOK_CLIENT_ID: "",
      OUTLOOK_CLIENT_SECRET: "",
      OUTLOOK_REDIRECT_URI: "",
      OUTLOOK_SCOPES: ""
    };
    config.MICROSOFT_OUTLOOK_SYNC_ENABLED = true;
    try {
      expect(() =>
        createApp()
      ).toThrow("Missing required Outlook OAuth environment variable: OUTLOOK_TENANT_ID");
    } finally {
      config.MICROSOFT_OUTLOOK_SYNC_ENABLED = originalOutlookSyncEnabled;
    }
  });

  it("fails app startup in production when Outlook token encryption is still falling back to JWT secret", () => {
    const originalOutlookSyncEnabled = config.MICROSOFT_OUTLOOK_SYNC_ENABLED;
    const originalNodeEnv = config.NODE_ENV;
    const originalTokenEncryptionSecret = config.OUTLOOK_TOKEN_ENCRYPTION_SECRET;
    process.env = {
      ...ORIGINAL_ENV,
      ...BASE_ENV
    };
    config.MICROSOFT_OUTLOOK_SYNC_ENABLED = true;
    config.NODE_ENV = "production";
    config.OUTLOOK_TOKEN_ENCRYPTION_SECRET = "";
    try {
      expect(() => createApp()).toThrow("OUTLOOK_TOKEN_ENCRYPTION_SECRET is required when Outlook sync is enabled in production.");
    } finally {
      config.MICROSOFT_OUTLOOK_SYNC_ENABLED = originalOutlookSyncEnabled;
      config.NODE_ENV = originalNodeEnv;
      config.OUTLOOK_TOKEN_ENCRYPTION_SECRET = originalTokenEncryptionSecret;
    }
  });
});
