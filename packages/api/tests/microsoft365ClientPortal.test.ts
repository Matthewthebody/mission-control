import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  getMicrosoft365ClientPortalPhaseOneMvpDefinition,
  getMicrosoft365ClientPortalValidationIssues,
  getPublicMicrosoft365ClientPortalHealthSummary
} from "../src/services/microsoft365ClientPortal.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  API_PUBLIC_URL: config.API_PUBLIC_URL,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_OPERATING_SYSTEM_ENV: config.MICROSOFT_365_OPERATING_SYSTEM_ENV,
  MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV,
  MICROSOFT_365_MAIL_AUTOMATION_ENV: config.MICROSOFT_365_MAIL_AUTOMATION_ENV,
  MICROSOFT_365_CLIENT_INTAKE_ENV: config.MICROSOFT_365_CLIENT_INTAKE_ENV,
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENV,
  MICROSOFT_365_CLIENT_PORTAL_ENV: config.MICROSOFT_365_CLIENT_PORTAL_ENV,
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
  MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED: config.MICROSOFT_365_CLIENT_INTAKE_OPERATIONS_ENABLED,
  MICROSOFT_365_CLIENT_PORTAL_ENABLED: config.MICROSOFT_365_CLIENT_PORTAL_ENABLED,
  MICROSOFT_365_CLIENT_PORTAL_SITE_URL: config.MICROSOFT_365_CLIENT_PORTAL_SITE_URL,
  MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER: config.MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER,
  MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY: config.MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY,
  MICROSOFT_ENTRA_AUTH_ENABLED: config.MICROSOFT_ENTRA_AUTH_ENABLED,
  ALLOW_PASSWORD_LOGIN: config.ALLOW_PASSWORD_LOGIN
};

afterEach(() => {
  Object.assign(config, {
    ...originalConfig,
    MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...originalConfig.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS }
  });
});

describe("Microsoft 365 Power Pages client portal", () => {
  it("exposes a bounded phase-one runtime owner and route plan", () => {
    Object.assign(config, {
      MICROSOFT_365_CLIENT_PORTAL_SITE_URL: "https://portal-dev.powerappsportals.com"
    });

    const plan = getMicrosoft365ClientPortalPhaseOneMvpDefinition();

    expect(plan.runtime_owner.owner_key).toBe("microsoft365_client_portal");
    expect(plan.runtime_owner.diagnostics_route).toBe("/api/admin/system/microsoft-client-portal");
    expect(plan.auth_boundary.provider).toBe("entra_external_id");
    expect(plan.shell_boundary.admin_shell_rule).toContain("outside the internal admin-web hash shell");
    expect(plan.required_runtime_modules.backend).toContain("packages/api/src/services/microsoft365ClientPortal.ts");
    expect(plan.required_runtime_modules.frontend).toContain("packages/admin-web/src/navigation.ts");
    expect(plan.default_entry_route).toBe("/projects/{portal_project_key}/status");
    expect(plan.routes.map((route) => route.key)).toEqual(["projects", "status", "schedule", "files", "history"]);
    expect(plan.compatibility_aliases).toEqual([
      expect.objectContaining({
        route: "/projects/{portal_project_key}",
        resolves_to: "/projects/{portal_project_key}/status"
      })
    ]);
    expect(plan.deferred).toContain("general CRM behavior");
  });

  it("surfaces missing portal-specific prerequisites as validation issues", () => {
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
      MICROSOFT_365_CLIENT_PORTAL_ENV: "development",
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
      MICROSOFT_365_CLIENT_PORTAL_ENABLED: true,
      MICROSOFT_365_CLIENT_PORTAL_SITE_URL: undefined as unknown as string,
      MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER: undefined as unknown as string,
      MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY: undefined as unknown as string,
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const issues = getMicrosoft365ClientPortalValidationIssues();

    expect(issues.some((issue) => issue.code === "phase7.portal_site_url.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "phase7.auth_provider.missing")).toBe(true);
    expect(issues.some((issue) => issue.code === "phase7.default_help_mailbox_key.missing")).toBe(true);
  });

  it("returns a stable health summary from the active Phase 7 baseline", () => {
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
      MICROSOFT_365_CLIENT_PORTAL_ENV: "development",
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
      MICROSOFT_365_CLIENT_PORTAL_ENABLED: true,
      MICROSOFT_365_CLIENT_PORTAL_SITE_URL: "https://portal-dev.powerappsportals.com",
      MICROSOFT_365_CLIENT_PORTAL_AUTH_PROVIDER: "entra_external_id",
      MICROSOFT_365_CLIENT_PORTAL_DEFAULT_HELP_MAILBOX_KEY: "support_ops",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const health = getPublicMicrosoft365ClientPortalHealthSummary();

    expect(health.baseline_environment).toBe("development");
    expect(health.enabled).toBe(true);
    expect(health.auth_provider).toBe("entra_external_id");
    expect(health.recommendation).toMatch(/go|conditional_go|no_go/);
  });
});
