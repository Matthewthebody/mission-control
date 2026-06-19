import { beforeEach, describe, expect, it, vi } from "vitest";

const publishRealtime = vi.fn();
const processIntegrationSyncOperation = vi.fn();
const syncShiftToOutlook = vi.fn();
const reconcileExternalCalendarChange = vi.fn();
const sendEmail = vi.fn();
const sendTeamsWebhook = vi.fn();
const runSchoolsHubAutomationForTenant = vi.fn();
const handleSchoolsHubUploadTrigger = vi.fn();
const handleSchoolsHubYearbookTrigger = vi.fn();
const handleSchoolsHubDeliverableTrigger = vi.fn();
const recordWorkerMicrosoftIntegrationEvent = vi.fn();
const writeWorkerMicrosoftExternalAudit = vi.fn();
const dispatchTeamsCommunicationDelivery = vi.fn();
const dispatchTeamsMeetingSyncOperation = vi.fn();
const dispatchMicrosoft365ProvisioningSync = vi.fn();
const dispatchMicrosoft365MailAutomationSync = vi.fn();
const dispatchMicrosoft365SmsAutomationSync = vi.fn();

vi.mock("../src/realtime/internalPublisher.js", () => ({
  publishRealtime
}));

vi.mock("../src/calendar/outlookGraph.js", () => ({
  processIntegrationSyncOperation,
  syncShiftToOutlook,
  reconcileExternalCalendarChange
}));

vi.mock("../src/notifications/emailStub.js", () => ({
  sendEmail
}));

vi.mock("../src/notifications/teamsWebhook.js", () => ({
  sendTeamsWebhook
}));

vi.mock("../src/jobs/schoolsHubAutomation.js", () => ({
  runSchoolsHubAutomationForTenant,
  handleSchoolsHubUploadTrigger,
  handleSchoolsHubYearbookTrigger,
  handleSchoolsHubDeliverableTrigger
}));

vi.mock("../src/diagnostics/microsoftIntegrationEvents.js", () => ({
  recordWorkerMicrosoftIntegrationEvent,
  writeWorkerMicrosoftExternalAudit
}));

vi.mock("../src/integrations/microsoft365ProvisioningSync.js", () => ({
  dispatchMicrosoft365ProvisioningSync
}));

vi.mock("../src/integrations/microsoft365MailAutomationSync.js", () => ({
  dispatchMicrosoft365MailAutomationSync
}));

vi.mock("../src/integrations/microsoft365SmsAutomationSync.js", () => ({
  dispatchMicrosoft365SmsAutomationSync
}));

vi.mock("../src/communications/teamsMessagingGraph.js", () => ({
  dispatchTeamsCommunicationDelivery
}));

vi.mock("../src/communications/teamsMeetingsGraph.js", () => ({
  dispatchTeamsMeetingSyncOperation
}));

const { handleAppEvent } = await import("../src/handlers/appEventHandler.js");

describe("app event realtime wiring", () => {
  beforeEach(() => {
    publishRealtime.mockReset();
    processIntegrationSyncOperation.mockReset();
    syncShiftToOutlook.mockReset();
    reconcileExternalCalendarChange.mockReset();
    sendEmail.mockReset();
    sendTeamsWebhook.mockReset();
    runSchoolsHubAutomationForTenant.mockReset();
    handleSchoolsHubUploadTrigger.mockReset();
    handleSchoolsHubYearbookTrigger.mockReset();
    handleSchoolsHubDeliverableTrigger.mockReset();
    recordWorkerMicrosoftIntegrationEvent.mockReset();
    writeWorkerMicrosoftExternalAudit.mockReset();
    dispatchTeamsCommunicationDelivery.mockReset();
    dispatchTeamsMeetingSyncOperation.mockReset();
    dispatchMicrosoft365ProvisioningSync.mockReset();
    dispatchMicrosoft365MailAutomationSync.mockReset();
    dispatchMicrosoft365SmsAutomationSync.mockReset();
  });

  it("publishes schedule realtime changes to the admin socket event used by Scheduling", async () => {
    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "schedule.realtime.changed",
      payload: {
        shift_id: "shift-1",
        change_type: "published"
      }
    });

    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "schedule_changed", {
      shift_id: "shift-1",
      change_type: "published"
    });
  });

  it("publishes attendance realtime changes to the admin socket event used by Attendance", async () => {
    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "attendance.realtime.changed",
      payload: {
        shift_id: "shift-2",
        change_type: "exception_reviewed"
      }
    });

    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "attendance_changed", {
      shift_id: "shift-2",
      change_type: "exception_reviewed"
    });
  });

  it("keeps calendar sync separate from the UI realtime event path", async () => {
    syncShiftToOutlook.mockResolvedValue({ code: "stubbed" });

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "schedule.calendar.sync",
      payload: {
        shift_id: "shift-3"
      }
    });

    expect(syncShiftToOutlook).toHaveBeenCalled();
    expect(publishRealtime).not.toHaveBeenCalled();
  });

  it("dispatches Teams operational alerts and records a realtime integration event", async () => {
    sendTeamsWebhook.mockResolvedValue({
      code: "sent",
      response: {
        status: 200
      }
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "delivery-1",
            route_id: "route-1",
            delivery_channel: "teams_webhook",
            status: "queued",
            request_payload: {
              route: {
                route_name: "Ops Channel",
                destination_label: "Operations",
                destination_config: {
                  webhook_url: "https://example.test/webhook"
                }
              },
              alert: {
                type: "approval_needed",
                title: "Approval Needed",
                summary: "Checklist approval is waiting.",
                severity: "high",
                deep_link: "https://app.test/#approvals",
                facts: []
              }
            }
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await handleAppEvent({ query } as never, {
      tenant_id: "tenant-1",
      event_type: "operational_alert.dispatch",
      payload: {
        delivery_id: "delivery-1"
      }
    });

    expect(sendTeamsWebhook).toHaveBeenCalledWith({
      route: {
        route_name: "Ops Channel",
        destination_label: "Operations",
        destination_config: {
          webhook_url: "https://example.test/webhook"
        }
      },
      alert: {
        type: "approval_needed",
        title: "Approval Needed",
        summary: "Checklist approval is waiting.",
        severity: "high",
        deep_link: "https://app.test/#approvals",
        facts: []
      }
    });
    expect(recordWorkerMicrosoftIntegrationEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "teams_alerts",
      eventType: "teams.alert_delivery.sent"
    }));
    expect(writeWorkerMicrosoftExternalAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "teams.alert_delivery.write",
      result: "sent"
    }));
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      operational_alert_delivery_id: "delivery-1",
      provider: "teams",
      direction: "outbound"
    });
  });

  it("routes Teams communication dispatch events into the dedicated sender", async () => {
    dispatchTeamsCommunicationDelivery.mockResolvedValue(undefined);

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "teams.communication.dispatch",
      payload: {
        delivery_id: "delivery-1"
      }
    });

    expect(dispatchTeamsCommunicationDelivery).toHaveBeenCalledWith(expect.anything(), "tenant-1", "delivery-1");
  });

  it("routes Teams meeting sync events into the dedicated meeting sync worker", async () => {
    dispatchTeamsMeetingSyncOperation.mockResolvedValue(undefined);

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "teams.meeting.sync",
      payload: {
        operation_id: "operation-1"
      }
    });

    expect(dispatchTeamsMeetingSyncOperation).toHaveBeenCalledWith(expect.anything(), "tenant-1", "operation-1");
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      teams_meeting_sync_operation_id: "operation-1",
      provider: "teams_meetings",
      direction: "outbound"
    });
  });

  it("routes Microsoft workspace sync operations into the provisioning scaffold worker", async () => {
    dispatchMicrosoft365ProvisioningSync.mockResolvedValue({
      code: "planned"
    });

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "integration.sync.process",
      payload: {
        sync_operation_id: "operation-2",
        provider: "microsoft365_workspace",
        direction: "outbound"
      }
    });

    expect(dispatchMicrosoft365ProvisioningSync).toHaveBeenCalledWith(expect.anything(), "operation-2");
    expect(processIntegrationSyncOperation).not.toHaveBeenCalled();
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      sync_operation_id: "operation-2",
      provider: "microsoft365_workspace",
      direction: "outbound"
    });
  });

  it("routes Microsoft mail automation sync operations into the dedicated flow dispatcher", async () => {
    dispatchMicrosoft365MailAutomationSync.mockResolvedValue({
      code: "flow_accepted"
    });

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "integration.sync.process",
      payload: {
        sync_operation_id: "operation-3",
        provider: "microsoft365_mail_automation",
        direction: "outbound"
      }
    });

    expect(dispatchMicrosoft365MailAutomationSync).toHaveBeenCalledWith(expect.anything(), "operation-3");
    expect(processIntegrationSyncOperation).not.toHaveBeenCalled();
    expect(recordWorkerMicrosoftIntegrationEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        area: "mail_automation",
        eventType: "mail_automation.dispatch.processed"
      })
    );
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      sync_operation_id: "operation-3",
      provider: "microsoft365_mail_automation",
      direction: "outbound"
    });
  });

  it("routes Microsoft SMS automation sync operations into the dedicated SMS dispatcher", async () => {
    dispatchMicrosoft365SmsAutomationSync.mockResolvedValue({
      code: "provider_accepted"
    });

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "integration.sync.process",
      payload: {
        sync_operation_id: "operation-3b",
        provider: "microsoft365_sms_automation",
        direction: "outbound"
      }
    });

    expect(dispatchMicrosoft365SmsAutomationSync).toHaveBeenCalledWith(expect.anything(), "operation-3b");
    expect(processIntegrationSyncOperation).not.toHaveBeenCalled();
    expect(recordWorkerMicrosoftIntegrationEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        area: "sms_automation",
        eventType: "sms_automation.dispatch.processed"
      })
    );
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      sync_operation_id: "operation-3b",
      provider: "microsoft365_sms_automation",
      direction: "outbound"
    });
  });

  it("links operational event deliveries to the created in-app notification record", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "notification-1"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            email: "recipient@example.com",
            phone_number: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await handleAppEvent({ query } as never, {
      id: "app-event-1",
      tenant_id: "tenant-1",
      event_type: "notification.dispatch",
      payload: {
        recipient_user_id: "user-1",
        notification_type: "job.assigned",
        priority: "high",
        title: "Assigned to DEMO-001",
        body: "You were assigned to DEMO-001.",
        channels: ["in_app"],
        metadata: {
          operational_event_delivery_id: "delivery-1"
        }
      }
    });

    expect(query.mock.calls.some((call) => String(call[0]).includes("UPDATE operational_event_delivery"))).toBe(true);
    expect(query.mock.calls.some((call) => Array.isArray(call[1]) && call[1][1] === "delivery-1" && call[1][2] === "notification-1")).toBe(true);
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "notification_created", expect.objectContaining({ id: "notification-1" }));
  });

  it("runs Schools Hub automation when explicitly requested", async () => {
    runSchoolsHubAutomationForTenant.mockResolvedValue(undefined);

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "schools_hub.automation.requested",
      payload: {
        requested_by_user_id: "user-1"
      }
    });

    expect(runSchoolsHubAutomationForTenant).toHaveBeenCalledWith(expect.anything(), "tenant-1");
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "schools_hub_changed", {
      change_type: "automation_run_completed"
    });
  });

  it("routes Schools Hub upload triggers into the automation handler", async () => {
    handleSchoolsHubUploadTrigger.mockResolvedValue(undefined);

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "schools_hub.trigger.upload_state_changed",
      payload: {
        organization_id: "school-1",
        trigger_type: "gallery_deadline_set"
      }
    });

    expect(handleSchoolsHubUploadTrigger).toHaveBeenCalledWith(expect.anything(), "tenant-1", {
      organization_id: "school-1",
      trigger_type: "gallery_deadline_set"
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "schools_hub_changed", {
      change_type: "upload_trigger_processed"
    });
  });

  it("routes Schools Hub yearbook and deliverable triggers into the automation handlers", async () => {
    handleSchoolsHubYearbookTrigger.mockResolvedValue(undefined);
    handleSchoolsHubDeliverableTrigger.mockResolvedValue(undefined);

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "schools_hub.trigger.yearbook_request_received",
      payload: {
        organization_id: "school-1",
        request_type: "yearbook_request_received"
      }
    });

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "schools_hub.trigger.deliverable_arrived",
      payload: {
        organization_id: "school-1",
        deliverable_type: "yearbooks_arrived"
      }
    });

    expect(handleSchoolsHubYearbookTrigger).toHaveBeenCalledWith(expect.anything(), "tenant-1", {
      organization_id: "school-1",
      request_type: "yearbook_request_received"
    });
    expect(handleSchoolsHubDeliverableTrigger).toHaveBeenCalledWith(expect.anything(), "tenant-1", {
      organization_id: "school-1",
      deliverable_type: "yearbooks_arrived"
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "schools_hub_changed", {
      change_type: "yearbook_trigger_processed"
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "schools_hub_changed", {
      change_type: "deliverable_trigger_processed"
    });
  });

  it("processes integration sync operations and publishes an integration event", async () => {
    processIntegrationSyncOperation.mockResolvedValue(undefined);

    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "integration.sync.process",
      payload: {
        sync_operation_id: "sync-1",
        provider: "outlook",
        direction: "outbound"
      }
    });

    expect(processIntegrationSyncOperation).toHaveBeenCalledWith(expect.anything(), "sync-1");
    expect(recordWorkerMicrosoftIntegrationEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "outlook_calendar_sync",
      eventType: "outlook.calendar_sync.processed"
    }));
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      sync_operation_id: "sync-1",
      provider: "outlook",
      direction: "outbound"
    });
    expect(syncShiftToOutlook).not.toHaveBeenCalled();
  });

  it("processes agreement reminder email hooks and updates agreement realtime", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    sendEmail.mockResolvedValue({ code: "sent", response: { provider: "smtp_stub" } });

    await handleAppEvent({ query } as never, {
      id: "event-1",
      tenant_id: "tenant-1",
      event_type: "agreement.reminder_requested",
      payload: {
        reminder_id: "reminder-1",
        agreement_id: "agreement-1",
        agreement_title: "Lakeside Agreement",
        recipient_email: "barb@example.com",
        note: "Please sign this agreement."
      }
    });

    expect(sendEmail).toHaveBeenCalledWith("barb@example.com", "Reminder: Lakeside Agreement", "Please sign this agreement.");
    expect(query).toHaveBeenCalled();
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "agreement_changed", {
      agreement_id: "agreement-1",
      change_type: "reminder_processed"
    });
  });

  it("processes sales email send hooks and records delivery state", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    sendEmail.mockResolvedValue({ code: "sent", response: { provider: "smtp_stub" } });

    await handleAppEvent({ query } as never, {
      id: "event-2",
      tenant_id: "tenant-1",
      event_type: "sales.email.send_requested",
      payload: {
        communication_id: "communication-1",
        organization_id: "organization-1",
        opportunity_id: "opportunity-1",
        recipient_email: "barb@example.com",
        subject: "Proposal for Lakeside",
        body: "Hello from Mission Control."
      }
    });

    expect(sendEmail).toHaveBeenCalledWith("barb@example.com", "Proposal for Lakeside", "Hello from Mission Control.");
    expect(query).toHaveBeenCalledTimes(2);
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "sales_pipeline_changed", {
      communication_id: "communication-1",
      organization_id: "organization-1",
      opportunity_id: "opportunity-1",
      change_type: "sales_email_processed"
    });
  });
});

describe("per-recipient staffing publication delivery", () => {
  const publishedEvent = {
    tenant_id: "tenant-1",
    aggregate_id: "recipient-1",
    event_type: "staffing.plan.recipient_published",
    payload: {
      shoot_id: "shoot-1",
      version: 2,
      employee_user_id: "emp-1",
      recipient_hash: "hash-abc",
      response_status: "pending",
      acknowledgment_due_at: "2027-06-07T12:00:00.000Z"
    }
  };

  function findInsert(query: ReturnType<typeof vi.fn>) {
    return query.mock.calls.find((call) => /INSERT INTO app_event/.test(String(call[0])));
  }

  it("queues exactly one notification.dispatch for a current pending recipient, deep-linked to My Work", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ recipient_hash: "hash-abc", response_status: "pending" }] }) // currency
      .mockResolvedValueOnce({ rows: [{ shoot_code: "WBL-01", title: "Picture Day", shoot_date: "2027-06-07", role: "lead_photographer" }] }) // context
      .mockResolvedValueOnce({ rows: [] }); // insert

    await handleAppEvent({ query } as never, publishedEvent);

    const insert = findInsert(query);
    expect(insert).toBeTruthy();
    const params = insert![1] as unknown[];
    expect(String(insert![0])).toMatch(/ON CONFLICT.*DO NOTHING/s); // idempotent insert
    expect(params[0]).toBe("tenant-1");
    const dispatch = JSON.parse(String(params[2]));
    expect(dispatch.recipient_user_id).toBe("emp-1");
    expect(dispatch.notification_type).toBe("schedule.staffing.published");
    expect(dispatch.deep_link).toBe("#my-work?focus_shoot=shoot-1");
    expect(dispatch.channels).toEqual(["in_app", "push"]); // honest channels only
    expect(dispatch.body).toMatch(/WBL-01/);
    expect(dispatch.body).toMatch(/Lead Photographer/);
    expect(dispatch.body).toMatch(/acknowledge/i);
    // Dedupe identity = tenant + shoot + version + employee + recipient hash + purpose.
    expect(params[3]).toBe("staffing-recipient-publish:shoot-1:2:emp-1:hash-abc");
    expect(dispatch.metadata.purpose).toBe("staffing_publication");
  });

  it("does not notify when a newer version superseded the package (hash mismatch)", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ recipient_hash: "hash-NEWER", response_status: "pending" }] });
    await handleAppEvent({ query } as never, publishedEvent);
    expect(findInsert(query)).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1); // stops at the currency check
  });

  it("does not notify an already-acknowledged recipient", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ recipient_hash: "hash-abc", response_status: "acknowledged" }] });
    await handleAppEvent({ query } as never, publishedEvent);
    expect(findInsert(query)).toBeUndefined();
  });

  it("does not notify when there is no current recipient (superseded/removed)", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await handleAppEvent({ query } as never, publishedEvent);
    expect(findInsert(query)).toBeUndefined();
  });
});
