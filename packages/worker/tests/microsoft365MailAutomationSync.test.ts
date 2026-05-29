import { describe, expect, it } from "vitest";
import { buildMailAutomationDispatchAcceptedPayload } from "../src/integrations/microsoft365MailAutomationSync.js";

describe("Microsoft 365 mail automation worker dispatch contract", () => {
  it("treats flow acceptance as awaiting callback instead of confirmed delivery", () => {
    const payload = buildMailAutomationDispatchAcceptedPayload({
      delivery: {
        id: "delivery-1",
        related_record_type: "job",
        related_record_id: "job-42",
        shared_mailbox_key: "schools_ops",
        sender_alias: "schools@example.com",
        recipient_email: "client@example.com",
        flow_key: "kickoff_email_flow"
      },
      endpoint: "https://flow.example.test/kickoff",
      responseBody: {
        accepted: true
      },
      flowRunId: "flow-run-1",
      flowRunUrl: "https://flow.example.test/runs/1",
      occurredAt: "2026-04-24T12:00:00.000Z"
    });

    expect(payload).toMatchObject({
      dispatch_status: "flow_accepted",
      source_object: {
        type: "job",
        id: "job-42"
      },
      target_object: {
        type: "microsoft365_mail_delivery",
        id: "delivery-1",
        owner_email: "schools@example.com",
        recipient_email: "client@example.com",
        shared_mailbox_key: "schools_ops",
        flow_run_id: "flow-run-1"
      },
      sync_state: {
        last_attempted_sync_at: "2026-04-24T12:00:00.000Z",
        last_successful_sync_at: null,
        last_failed_sync_at: null,
        retry_state: "awaiting_callback",
        provider_accepted: true,
        delivery_confirmed: false,
        callback_status: null
      }
    });
  });
});
