import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  getMicrosoft365GovernanceDiagnostics,
  getMicrosoft365GovernanceValidationIssues,
  getPublicMicrosoft365GovernanceHealthSummary
} from "../src/services/microsoft365Governance.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  ALLOW_DEV_LOGIN: config.ALLOW_DEV_LOGIN,
  ALLOW_PASSWORD_LOGIN: config.ALLOW_PASSWORD_LOGIN,
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_TENANT_PRIMARY_DOMAIN: config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN,
  MICROSOFT_365_SHAREPOINT_ROOT_URL: config.MICROSOFT_365_SHAREPOINT_ROOT_URL,
  MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: config.MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID,
  MICROSOFT_365_SECURITY_GROUP_PREFIX: config.MICROSOFT_365_SECURITY_GROUP_PREFIX,
  MICROSOFT_365_GOVERNANCE_STRICT_VALIDATION: config.MICROSOFT_365_GOVERNANCE_STRICT_VALIDATION
};

afterEach(() => {
  Object.assign(config, originalConfig);
});

describe("Microsoft 365 governance foundation", () => {
  it("surfaces missing tenant governance config as validation issues", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: ""
    });

    const issues = getMicrosoft365GovernanceValidationIssues();

    expect(issues.some((issue) => issue.code === "tenant.primary_domain.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "sharepoint.root_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "entra_access_model.group_prefix.missing")).toBe(true);
  });

  it("returns a stable diagnostics payload tied to the active baseline environment", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://devtenant.sharepoint.com",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC-DEV"
    });

    const payload = getMicrosoft365GovernanceDiagnostics();
    const health = getPublicMicrosoft365GovernanceHealthSummary();

    expect(payload.baseline_environment).toBe("development");
    expect(payload.permissions_matrix.length).toBeGreaterThan(0);
    expect(payload.manual_admin_checklist.length).toBeGreaterThan(0);
    expect(payload.governance_docs.some((doc) => doc.key === "phase_summary")).toBe(true);
    expect(health.baseline_environment).toBe("development");
    expect(typeof health.issue_count).toBe("number");
  });

  it("flags production password fallback as a governance blocker when Entra is enabled", () => {
    Object.assign(config, {
      NODE_ENV: "production",
      ALLOW_DEV_LOGIN: false,
      ALLOW_PASSWORD_LOGIN: true,
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      MICROSOFT_365_GOVERNANCE_ENV: "production",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://tenant.sharepoint.com",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "prod-power-platform",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC"
    });

    const issues = getMicrosoft365GovernanceValidationIssues();

    expect(issues.some((issue) => issue.code === "auth.local_password_enabled_with_entra" && issue.severity === "error")).toBe(true);
  });
});
