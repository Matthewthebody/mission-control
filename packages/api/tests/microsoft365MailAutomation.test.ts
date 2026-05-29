import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  buildMailAutomationDeliverySyncView,
  deriveMailAutomationCallbackSyncOutcome,
  getMicrosoft365MailAutomationValidationIssues,
  getPublicMicrosoft365MailAutomationHealthSummary
} from "../src/services/microsoft365MailAutomation.js";

const originalConfig = {
  NODE_ENV: config.NODE_ENV,
  API_PUBLIC_URL: config.API_PUBLIC_URL,
  ADMIN_WEB_URL: config.ADMIN_WEB_URL,
  MICROSOFT_365_GOVERNANCE_ENV: config.MICROSOFT_365_GOVERNANCE_ENV,
  MICROSOFT_365_OPERATING_SYSTEM_ENV: config.MICROSOFT_365_OPERATING_SYSTEM_ENV,
  MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: config.MICROSOFT_365_DASHBOARD_INTEGRATION_ENV,
  MICROSOFT_365_MAIL_AUTOMATION_ENV: config.MICROSOFT_365_MAIL_AUTOMATION_ENV,
  MICROSOFT_365_MAIL_AUTOMATION_ENABLED: config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED,
  MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS: config.MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS,
  MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS },
  MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET,
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
    MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: { ...originalConfig.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS }
  });
});

describe("Microsoft 365 shared mailbox email automation", () => {
  it("surfaces missing flow endpoints and callback configuration as validation issues", () => {
    Object.assign(config, {
      NODE_ENV: "development",
      API_PUBLIC_URL: "http://localhost:4000",
      ADMIN_WEB_URL: "http://localhost:5173",
      MICROSOFT_365_GOVERNANCE_ENV: "development",
      MICROSOFT_365_OPERATING_SYSTEM_ENV: "development",
      MICROSOFT_365_DASHBOARD_INTEGRATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENV: "development",
      MICROSOFT_365_MAIL_AUTOMATION_ENABLED: true,
      MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS: 8000,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {},
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const issues = getMicrosoft365MailAutomationValidationIssues();

    expect(issues.some((issue) => issue.code === "power_automate.flow_endpoints.missing")).toBe(true);
    expect(issues.some((issue) => issue.code.startsWith("power_automate.flow_endpoint_missing."))).toBe(true);
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
      MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS: 8000,
      MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS: {
        kickoff_email_flow: "https://example.test/kickoff",
        reminder_email_flow: "https://example.test/reminder",
        overdue_email_flow: "https://example.test/overdue",
        confirmation_email_flow: "https://example.test/confirmation",
        approval_request_email_flow: "https://example.test/approval",
        escalation_email_flow: "https://example.test/escalation"
      },
      MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET: "dev-secret",
      MICROSOFT_365_TENANT_PRIMARY_DOMAIN: "dev.example.com",
      MICROSOFT_365_SHAREPOINT_ROOT_URL: "https://pmcdev.sharepoint.com",
      MICROSOFT_365_SHAREPOINT_HUB_SITE_URL: "https://pmcdev.sharepoint.com/sites/pmc-dev-operations-hub",
      MICROSOFT_365_WORKSPACE_NAME_PREFIX: "PMC DEV",
      MICROSOFT_365_POWER_PLATFORM_ENVIRONMENT_ID: "power-platform-dev",
      MICROSOFT_365_SECURITY_GROUP_PREFIX: "PMC",
      MICROSOFT_ENTRA_AUTH_ENABLED: true,
      ALLOW_PASSWORD_LOGIN: false
    });

    const health = getPublicMicrosoft365MailAutomationHealthSummary();

    expect(health.baseline_environment).toBe("development");
    expect(health.shared_mailbox_count).toBeGreaterThan(0);
    expect(health.template_count).toBeGreaterThan(0);
    expect(health.flow_count).toBeGreaterThan(0);
  });

  it("treats callback acceptance and confirmed delivery as different sync outcomes", () => {
    const sent = deriveMailAutomationCallbackSyncOutcome({
      deliveryId: "delivery-1",
      recordType: "job",
      recordId: "job-1",
      canonicalDashboardId: "project:job-1",
      sharedMailboxKey: "schools_ops",
      senderAlias: "schools@example.com",
      recipientEmail: "contact@example.com",
      status: "sent",
      providerMessageId: "graph-message-1",
      flowRunId: "flow-run-1",
      occurredAt: "2026-04-24T12:00:00.000Z"
    });

    expect(sent.syncStatus).toBe("succeeded");
    expect(sent.errorMessage).toBeNull();
    expect(sent.resultPayload).toMatchObject({
      callback_status: "sent",
      source_object: {
        type: "job",
        id: "job-1",
        canonical_dashboard_id: "project:job-1"
      },
      target_object: {
        type: "microsoft365_mail_delivery",
        id: "delivery-1",
        owner_email: "schools@example.com",
        recipient_email: "contact@example.com",
        flow_run_id: "flow-run-1",
        provider_message_id: "graph-message-1"
      },
      sync_state: {
        provider_accepted: true,
        delivery_confirmed: true,
        retry_state: "none",
        last_successful_sync_at: "2026-04-24T12:00:00.000Z"
      }
    });

    const skipped = deriveMailAutomationCallbackSyncOutcome({
      deliveryId: "delivery-2",
      recordType: "work_task",
      recordId: "task-9",
      canonicalDashboardId: "task:task-9",
      sharedMailboxKey: "graphics_ops",
      senderAlias: "graphics@example.com",
      recipientEmail: "client@example.com",
      status: "skipped",
      flowRunId: "flow-run-2",
      errorMessage: "Recipient opted out.",
      occurredAt: "2026-04-24T12:05:00.000Z"
    });

    expect(skipped.syncStatus).toBe("failed");
    expect(skipped.errorMessage).toBe("Recipient opted out.");
    expect(skipped.resultPayload).toMatchObject({
      callback_status: "skipped",
      sync_state: {
        provider_accepted: true,
        delivery_confirmed: false,
        retry_state: "manual_retry_required",
        last_failed_sync_at: "2026-04-24T12:05:00.000Z"
      }
    });
  });

  it("exposes queued and flow-accepted deliveries as inspectable sync envelopes", () => {
    const queued = buildMailAutomationDeliverySyncView({
      id: "delivery-queued",
      related_record_type: "job",
      related_record_id: "job-1",
      canonical_dashboard_id: "project:job-1",
      shared_mailbox_key: "schools_ops",
      sender_alias: "schools@example.com",
      recipient_email: "contact@example.com",
      status: "queued",
      microsoft_message_id: null,
      microsoft_message_url: null,
      flow_run_id: null,
      flow_run_url: null,
      queued_at: "2026-04-24T11:00:00.000Z",
      last_dispatched_at: null,
      sent_at: null,
      last_error_at: null
    });

    expect(queued).toMatchObject({
      source_object: {
        type: "job",
        id: "job-1",
        canonical_dashboard_id: "project:job-1"
      },
      target_object: {
        type: "microsoft365_mail_delivery",
        id: "delivery-queued",
        owner_email: "schools@example.com",
        recipient_email: "contact@example.com"
      },
      sync_state: {
        last_attempted_sync_at: "2026-04-24T11:00:00.000Z",
        last_successful_sync_at: null,
        last_failed_sync_at: null,
        retry_state: "pending_dispatch",
        provider_accepted: false,
        delivery_confirmed: false,
        callback_status: null
      }
    });

    const accepted = buildMailAutomationDeliverySyncView({
      id: "delivery-accepted",
      related_record_type: "work_task",
      related_record_id: "task-9",
      canonical_dashboard_id: "task:task-9",
      shared_mailbox_key: "graphics_ops",
      sender_alias: "graphics@example.com",
      recipient_email: "client@example.com",
      status: "flow_accepted",
      microsoft_message_id: null,
      microsoft_message_url: null,
      flow_run_id: "flow-run-2",
      flow_run_url: "https://flow.example.com/run/2",
      queued_at: "2026-04-24T11:05:00.000Z",
      last_dispatched_at: "2026-04-24T11:06:00.000Z",
      sent_at: null,
      last_error_at: null
    });

    expect(accepted.sync_state).toMatchObject({
      last_attempted_sync_at: "2026-04-24T11:06:00.000Z",
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      retry_state: "awaiting_callback",
      provider_accepted: true,
      delivery_confirmed: false,
      callback_status: null
    });
  });
});
