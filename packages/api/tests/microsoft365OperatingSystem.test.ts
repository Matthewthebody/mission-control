import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  getMicrosoft365OperatingSystemDiagnostics,
  getMicrosoft365OperatingSystemValidationIssues,
  getPublicMicrosoft365OperatingSystemHealthSummary
} from "../src/services/microsoft365OperatingSystem.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL,
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_TENANT_PRIMARY_DOMAIN: config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN,
  MICROSOFT_365_SHAREPOINT_ROOT_URL: config.MICROSOFT_365_SHAREPOINT_ROOT_URL,
  MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: config.MICROSOFT_365_SHAREPOINT_HUB_SITE_URL,
  MICROSOFT_365_SECURITY_GROUP_PREFIX: config.MICROSOFT_365_SECURITY_GROUP_PREFIX,
  MICROSOFT_365_OPERATING_SYSTEM_ENV: config.MICROSOFT_365_OPERATING_SYSTEM_ENV,
  MICROSOFT_365_WORKSPACE_NAME_PREFIX: config.MICROSOFT_365_WORKSPACE_NAME_PREFIX,
  MICROSOFT_365_OPERATING_SYSTEM_STRICT_VALIDATION: config.MICROSOFT_365_OPERATING_SYSTEM_STRICT_VALIDATION
};

afterEach(() => {
  Object.assign(config, originalConfig);
});

describe("Microsoft 365 internal operating system", () => {
  it("surfaces missing workspace config as validation issues", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC-DEV",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: ""
    });

    const issues = getMicrosoft365OperatingSystemValidationIssues();

    expect(issues.some((issue) => issue.code === "sharepoint.hub_site_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "workspace_naming.prefix.missing")).toBe(true);
  });

  it("returns a stable diagnostics payload tied to the active workspace baseline", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC-DEV",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV"
    });

    const payload = getMicrosoft365OperatingSystemDiagnostics();
    const health = getPublicMicrosoft365OperatingSystemHealthSummary();

    expect(payload.baseline_environment).toBe("development");
    expect(payload.teams_information_architecture.supported_departments.length).toBeGreaterThan(0);
    expect(payload.lists_schema.length).toBeGreaterThan(0);
    expect(payload.planner_structure.buckets.length).toBeGreaterThan(0);
    expect(payload.teams_tabs_and_navigation.channel_defaults.length).toBeGreaterThan(0);
    expect(health.baseline_environment).toBe("development");
    expect(Array.isArray(health.supported_departments)).toBe(true);
  });

  it("flags Phase 1 governance blockers as a Phase 2 prerequisite issue", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV"
    });

    const issues = getMicrosoft365OperatingSystemValidationIssues();

    expect(issues.some((issue) => issue.code === "phase1_prerequisite.governance_not_ready")).toBe(true);
  });
});
