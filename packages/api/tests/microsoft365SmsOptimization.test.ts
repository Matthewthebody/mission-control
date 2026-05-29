import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  getMicrosoft365SmsOptimizationValidationIssues,
  getPublicMicrosoft365SmsOptimizationHealthSummary
} from "../src/services/microsoft365SmsOptimization.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  API_PUBLIC_URL: config.API_PUBLIC_URL,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_OPERATING_SYSTEM_ENV: config.MICROSOFT_365_OPERATING_SYSTEM_ENV,
  MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV,
  MICROSOFT_365_MAIL_AUTOMATION_ENV: config.MICROSOFT_365_MAIL_AUTOMATION_ENV,
  MICROSOFT_365_MAIL_AUTOMATION_ENABLED: config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED,
  MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS },
  MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET,
  MICROSOFT_365_CLIENT_INTAKE_ENV: config.MICROSOFT_365_CLIENT_INTAKE_ENV,
  MICROSOFT_365_CLIENT_INTAKE_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_ENABLED,
  MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: config.MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET,
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV,
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED,
  MICROSOFT_365_SMS_OPTIMIZATION_ENV: config.MICROSOFT_365_SMS_OPTIMIZATION_ENV,
  MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED,
  MICROSOFT_365_SMS_PROVIDER: config.MICROSOFT_365_SMS_PROVIDER,
  MICROSOFT_365_SMS_FROM_NUMBER: config.MICROSOFT_365_SMS_FROM_NUMBER,
  MICROSOFT_365_SMS_TIMEOUT_MS: config.MICROSOFT_365_SMS_TIMEOUT_MS,
  MICROSOFT_365_SMS_FLOW_ENDPOINTS: { ...config.MICROSOFT_365_SMS_FLOW_ENDPOINTS },
  MICROSOFT_365_SMS_CALLBACK_SECRET: config.MICROSOFT_365_SMS_CALLBACK_SECRET,
  MICROSOFT_365_TENANT_PRIMARY_DOMAIN: config.MICROSOFT_365_TENANT_PRIMARY_DOMAIN,
  MICROSOFT_365_SHAREPOINT_ROOT_URL: config.MICROSOFT_365_SHAREPOINT_ROOT_URL,
  MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: config.MICROSOFT_365_SHAREPOINT_HUB_SITE_URL,
  MICROSOFT_365_WORKSPACE_NAME_PREFIX: config.MICROSOFT_365_WORKSPACE_NAME_PREFIX,
  MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: config.MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID,
  MICROSOFT_365_SECURITY_GROUP_PREFIX: config.MICROSOFT_365_SECURITY_GROUP_PREFIX,
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  ALLOW_PASSWORD_LOGIN: config.ALLOW_PASSWORD_LOGIN
};

afterEach(() => {
  Object.assign(config, {
    ...originalConfig,
    MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...originalConfig.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS },
    MICROSOFT_365_SMS_FLOW_ENDPOINTS: { ...originalConfig.MICROSOFT_365_SMS_FLOW_ENDPOINTS }
  });
});

describe("Microsoft 365 SMS optimization", () => {
  it("surfaces missing flow endpoints and sender configuration as validation issues", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      API_PUBLIC_URL: "http://localhost:4000",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: true,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {
        kickoff_email_flow: "https://example.test/kickoff"
      },
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "dev-mail-secret",
      MICROSOFT_365_CLIENT_INTAKE_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: true,
      MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: "dev-intake-secret",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: true,
      MICROSOFT_365_SMS_OPTIMIZATION_ENV: "development",
      MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: true,
      MICROSOFT_365_SMS_PROVIDER: "azure_communication_services",
      MICROSOFT_365_SMS_FROM_NUMBER: "",
      MICROSOFT_365_SMS_TIMEOUT_MS: 8000,
      MICROSOFT_365_SMS_FLOW_ENDPOINTS: {},
      MICROSOFT_365_SMS_CALLBACK_SECRET: "",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const issues = getMicrosoft365SmsOptimizationValidationIssues();

    expect(issues.some((issue) => issue.code === "phase8.sender_number.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "phase8.flow_endpoints.missing")).toBe(true);
    expect(issues.some((issue) => issue.code.startsWith("phase8.flow_endpoint_missing."))).toBe(true);
  });

  it("returns a stable health summary when the baseline and endpoints are configured", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      API_PUBLIC_URL: "http://localhost:4000",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: true,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {
        kickoff_email_flow: "https://example.test/kickoff"
      },
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "dev-mail-secret",
      MICROSOFT_365_CLIENT_INTAKE_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_ENABLED: true,
      MICROSOFT_365_CLIENT_INTAKE_CALLBACK_SECRET: "dev-intake-secret",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: "development",
      MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: true,
      MICROSOFT_365_SMS_OPTIMIZATION_ENV: "development",
      MICROSOFT_365_SMS_OPTIMIZATION_ENABLED: true,
      MICROSOFT_365_SMS_PROVIDER: "azure_communication_services",
      MICROSOFT_365_SMS_FROM_NUMBER: "+15555550101",
      MICROSOFT_365_SMS_TIMEOUT_MS: 8000,
      MICROSOFT_365_SMS_FLOW_ENDPOINTS: {
        required_items_reminder_sms_flow: "https://example.test/sms/reminder",
        required_items_overdue_sms_flow: "https://example.test/sms/overdue",
        manual_follow_up_sms_flow: "https://example.test/sms/manual"
      },
      MICROSOFT_365_SMS_CALLBACK_SECRET: "dev-sms-secret",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const health = getPublicMicrosoft365SmsOptimizationHealthSummary();

    expect(health.baseline_environment).toBe("development");
    expect(health.sender_profile_count).toBeGreaterThan(0);
    expect(health.template_count).toBeGreaterThan(0);
    expect(health.kpi_count).toBeGreaterThan(0);
  });
});
