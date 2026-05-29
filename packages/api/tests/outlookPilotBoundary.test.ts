import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { isOutlookCalendarGraphAvailable } from "../src/services/outlookCalendarGraph.js";

const ORIGINAL_CONFIG = {
  outlookSyncEnabled: config.MICROSOFT_OUTLOOK_SYNC_ENABLED,
  appPermissionFeaturesEnabled: config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED,
  graphClientId: config.MICROSOFT_GRAPH_CLIENT_ID,
  graphClientSecret: config.MICROSOFT_GRAPH_CLIENT_SECRET,
  graphTenantId: config.MICROSOFT_GRAPH_TENANT_ID
};

afterEach(() => {
  config.MICROSOFT_OUTLOOK_SYNC_ENABLED = ORIGINAL_CONFIG.outlookSyncEnabled;
  config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED = ORIGINAL_CONFIG.appPermissionFeaturesEnabled;
  config.MICROSOFT_GRAPH_CLIENT_ID = ORIGINAL_CONFIG.graphClientId;
  config.MICROSOFT_GRAPH_CLIENT_SECRET = ORIGINAL_CONFIG.graphClientSecret;
  config.MICROSOFT_GRAPH_TENANT_ID = ORIGINAL_CONFIG.graphTenantId;
});

describe("Outlook Phase 1 pilot boundary", () => {
  it("keeps legacy app-permission calendar reads disabled even when the legacy flag is enabled", () => {
    config.MICROSOFT_OUTLOOK_SYNC_ENABLED = true;
    config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED = false;
    config.MICROSOFT_GRAPH_CLIENT_ID = "legacy-client-id";
    config.MICROSOFT_GRAPH_CLIENT_SECRET = "legacy-client-secret";
    config.MICROSOFT_GRAPH_TENANT_ID = "legacy-tenant-id";

    expect(isOutlookCalendarGraphAvailable()).toBe(false);

    config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED = true;
    expect(isOutlookCalendarGraphAvailable()).toBe(false);
  });
});
