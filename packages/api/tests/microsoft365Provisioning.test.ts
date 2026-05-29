import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  buildMicrosoft365CanonicalDashboardId,
  getMicrosoft365ProvisioningDiagnostics,
  getMicrosoft365ProvisioningValidationIssues,
  getPublicMicrosoft365ProvisioningHealthSummary
} from "../src/services/microsoft365Provisioning.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL,
  API_PUBLIC_URL: config.API_PUBLIC_URL,
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_OPERATING_SYSTEM_ENV: config.MICROSOFT_365_OPERATING_SYSTEM_ENV,
  MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV,
  MICROSOFT_365_TENANT_PRIMARY_DOMAIN: config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN,
  MICROSOFT_365_SHAREPOINT_ROOT_URL: config.MICROSOFT_365_SHAREPOINT_ROOT_URL,
  MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: config.MICROSOFT_365_SHAREPOINT_HUB_SITE_URL,
  MICROSOFT_365_WORKSPACE_NAME_PREFIX: config.MICROSOFT_365_WORKSPACE_NAME_PREFIX,
  MICROSOFT_365_DASHBOARD_INTEGRATION_STRICT_VALIDATION: config.MICROSOFT_365_DASHBOARD_INTEGRATION_STRICT_VALIDATION
};

afterEach(() => {
  Object.assign(config, originalConfig);
});

describe("Microsoft 365 dashboard integration contract", () => {
  it("surfaces missing backlink and api url config as validation issues", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      ADMIN_WEB_URL: "",
      API_PUBLIC_URL: "",
      MICROSOFT_ENTRA_AUTH_ENABLED: false,
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV"
    });

    const issues = getMicrosoft365ProvisioningValidationIssues();

    expect(issues.some((issue) => issue.code === "backlinks.admin_web_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "sync_entrypoints.api_public_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "identity.entra_auth.disabled")).toBe(true);
  });

  it("returns a stable diagnostics payload tied to the active Phase 3 baseline", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      ADMIN_WEB_URL: "http://localhost:5173",
      API_PUBLIC_URL: "http://localhost:4000",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV"
    });

    const payload = getMicrosoft365ProvisioningDiagnostics();
    const health = getPublicMicrosoft365ProvisioningHealthSummary();

    expect(payload.baseline_environment).toBe("development");
    expect(payload.canonical_entity_contract.length).toBeGreaterThan(0);
    expect(payload.data_ownership.length).toBeGreaterThan(0);
    expect(payload.provisioning_flows.length).toBeGreaterThan(0);
    expect(payload.retry_and_reconciliation.failure_states.length).toBeGreaterThan(0);
    expect(health.supported_dashboard_entities.length).toBeGreaterThan(0);
    expect(buildMicrosoft365CanonicalDashboardId("job", "job-123")).toBe("project:job-123");
  });

  it("flags Phase 2 blockers as a Phase 3 prerequisite issue", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      ADMIN_WEB_URL: "http://localhost:5173",
      API_PUBLIC_URL: "http://localhost:4000",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: ""
    });

    const issues = getMicrosoft365ProvisioningValidationIssues();

    expect(issues.some((issue) => issue.code === "phase2_prerequisite.operating_system_not_ready")).toBe(true);
  });
});
