import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  getMicrosoft365ClientIntakeValidationIssues,
  getPublicMicrosoft365ClientIntakeHealthSummary
} from "../src/services/microsoft365ClientIntake.js";
import {
  getMicrosoft365ClientIntakeOperationalControlValidationIssues,
  getPublicMicrosoft365ClientIntakeOperationalControlHealthSummary
} from "../src/services/microsoft365ClientIntakeOperations.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  API_PUBLIC_URL: config.API_PUBLIC_URL,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_OPERATING_SYSTEM_ENV: config.MICROSOFT_365_OPERATING_SYSTEM_ENV,
  MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV,
  MICROSOFT_365_MAIL_AUTOMATION_ENV: config.MICROSOFT_365_MAIL_AUTOMATION_ENV,
  MICROSOFT_365_CLIENT_INTAKE_ENV: config.MICROSOFT_365_CLIENT_INTAKE_ENV,
  MICROSOFT_365_TENANT_PRIMARY_DOMAIN: config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN,
  MICROSOFT_365_SHAREPOINT_ROOT_URL: config.MICROSOFT_365_SHAREPOINT_ROOT_URL,
  MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: config.MICROSOFT_365_SHAREPOINT_HUB_SITE_URL,
  MICROSOFT_365_WORKSPACE_NAME_PREFIX: config.MICROSOFT_365_WORKSPACE_NAME_PREFIX,
  MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: config.MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID,
  MICROSOFT_365_SECURITY_GROUP_PREFIX: config.MICROSOFT_365_SECURITY_GROUP_PREFIX,
  MICROSOFT_365_MAIL_AUTOMATION_ENABLED: config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED,
  MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS },
  MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET,
  MICROSOFT_365_CLIENT_INTAKE_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_ENABLED,
  MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET,
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV,
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED,
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  ALLOW_PASSWORD_LOGIN: config.ALLOW_PASSWORD_LOGIN
};

afterEach(() => {
  Object.assign(config, {
    ...originalConfig,
    MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...originalConfig.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS }
  });
});

describe("Microsoft 365 secure client intake", () => {
  it("surfaces missing intake prerequisites as validation issues", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      API_PUBLIC_URL: "",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: false,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {},
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "",
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: true,
      MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: "",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: true,
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const issues = getMicrosoft365ClientIntakeValidationIssues();

    expect(issues.some((issue) => issue.code === "config.sharepoint_root_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "config.api_public_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "config.mail_automation_disabled")).toBe(true);
  });

  it("returns a stable health summary from the active Phase 5 baseline", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      API_PUBLIC_URL: "http://localhost:4000",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: true,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {
        kickoff_email_flow: "https://example.test/kickoff",
        reminder_email_flow: "https://example.test/reminder",
        overdue_email_flow: "https://example.test/overdue",
        confirmation_email_flow: "https://example.test/confirmation",
        approval_request_email_flow: "https://example.test/approval",
        escalation_email_flow: "https://example.test/escalation"
      },
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "dev-secret",
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: true,
      MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: "dev-client-intake-secret",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: true,
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const health = getPublicMicrosoft365ClientIntakeHealthSummary();

    expect(health.baseline_environment).toBe("development");
    expect(health.matching_rule_count).toBeGreaterThan(0);
    expect(health.reminder_cadence_hours).toBeGreaterThan(0);
    expect(health.recommendation).toMatch(/go|conditional_go|no_go/);
  });

  it("returns a stable Phase 6 operational-control health summary", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      API_PUBLIC_URL: "http://localhost:4000",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: "development",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: true,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {
        kickoff_email_flow: "https://example.test/kickoff",
        reminder_email_flow: "https://example.test/reminder",
        overdue_email_flow: "https://example.test/overdue",
        confirmation_email_flow: "https://example.test/confirmation",
        approval_request_email_flow: "https://example.test/approval",
        escalation_email_flow: "https://example.test/escalation"
      },
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "dev-secret",
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: true,
      MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: "dev-client-intake-secret",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: true,
      TEAMS_OPERATIONAL_ALERTS_ENABLED: true,
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const issues = getMicrosoft365ClientIntakeOperationalControlValidationIssues();
    const health = getPublicMicrosoft365ClientIntakeOperationalControlHealthSummary();

    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(health.default_review_due_hours).toBeGreaterThan(0);
    expect(health.daily_digest_enabled).toBe(true);
  });
});
