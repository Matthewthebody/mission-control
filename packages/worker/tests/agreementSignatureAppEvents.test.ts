import { beforeEach, describe, expect, it, vi } from "vitest";

const publishRealtime = vi.fn();
const processIntegrationSyncOperation = vi.fn();
const syncShiftToOutlook = vi.fn();
const reconcileExternalCalendarChange = vi.fn();
const handleAgreementSignatureSend = vi.fn();
const handleAgreementSignatureReminder = vi.fn();
const handleAgreementSignatureSync = vi.fn();
const handleAgreementSignatureWebhook = vi.fn();

vi.mock("../src/realtime/internalPublisher.js", () => ({
  publishRealtime
}));

vi.mock("../src/calendar/outlookGraph.js", () => ({
  processIntegrationSyncOperation,
  syncShiftToOutlook,
  reconcileExternalCalendarChange
}));

vi.mock("../src/agreements/agreementSignatureProvider.js", () => ({
  handleAgreementSignatureSend,
  handleAgreementSignatureReminder,
  handleAgreementSignatureSync,
  handleAgreementSignatureWebhook
}));

const { handleAppEvent } = await import("../src/handlers/appEventHandler.js");

describe("agreement signature app event wiring", () => {
  beforeEach(() => {
    publishRealtime.mockReset();
    processIntegrationSyncOperation.mockReset();
    syncShiftToOutlook.mockReset();
    reconcileExternalCalendarChange.mockReset();
    handleAgreementSignatureSend.mockReset();
    handleAgreementSignatureReminder.mockReset();
    handleAgreementSignatureSync.mockReset();
    handleAgreementSignatureWebhook.mockReset();
  });

  it("routes provider send requests through the agreement signature worker and publishes agreement realtime", async () => {
    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "agreement.signature.send_requested",
      payload: {
        agreement_id: "agreement-1",
        provider_name: "provider_stub"
      }
    });

    expect(handleAgreementSignatureSend).toHaveBeenCalledWith(expect.anything(), {
      agreement_id: "agreement-1",
      provider_name: "provider_stub"
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "agreement_changed", {
      agreement_id: "agreement-1",
      change_type: "signature_send_processed"
    });
  });

  it("routes provider reminder and sync requests through the agreement signature worker", async () => {
    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "agreement.signature.reminder_requested",
      payload: {
        agreement_id: "agreement-2"
      }
    });
    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "agreement.signature.sync_requested",
      payload: {
        agreement_id: "agreement-2"
      }
    });

    expect(handleAgreementSignatureReminder).toHaveBeenCalledWith(expect.anything(), {
      agreement_id: "agreement-2"
    });
    expect(handleAgreementSignatureSync).toHaveBeenCalledWith(expect.anything(), {
      agreement_id: "agreement-2"
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "agreement_changed", {
      agreement_id: "agreement-2",
      change_type: "signature_reminder_processed"
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "agreement_changed", {
      agreement_id: "agreement-2",
      change_type: "signature_sync_processed"
    });
  });

  it("routes agreement signature webhooks through the provider worker and keeps them on the integration realtime channel", async () => {
    await handleAppEvent({} as never, {
      tenant_id: "tenant-1",
      event_type: "agreement_signature.webhook.received",
      payload: {
        provider: "agreement_signature",
        body: {
          agreement_id: "agreement-3",
          external_status: "countersigned"
        }
      }
    });

    expect(handleAgreementSignatureWebhook).toHaveBeenCalledWith(expect.anything(), {
      provider: "agreement_signature",
      body: {
        agreement_id: "agreement-3",
        external_status: "countersigned"
      }
    });
    expect(publishRealtime).toHaveBeenCalledWith("tenant-1", "integration_event", {
      provider: "agreement_signature",
      body: {
        agreement_id: "agreement-3",
        external_status: "countersigned"
      }
    });
  });
});
