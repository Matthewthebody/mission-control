import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();
const publishRealtime = vi.fn();

vi.mock("../../worker/src/realtime/internalPublisher.js", () => ({
  publishRealtime
}));

let handleAgreementSignatureSend: typeof import("../../worker/src/agreements/agreementSignatureProvider.js").handleAgreementSignatureSend;
let handleAgreementSignatureReminder: typeof import("../../worker/src/agreements/agreementSignatureProvider.js").handleAgreementSignatureReminder;
let handleAgreementSignatureSync: typeof import("../../worker/src/agreements/agreementSignatureProvider.js").handleAgreementSignatureSync;
let handleAgreementSignatureWebhook: typeof import("../../worker/src/agreements/agreementSignatureProvider.js").handleAgreementSignatureWebhook;
let schoolsToken = "";
let leadershipToken = "";
let tenantId = "";
let organizationId = "";
let contactId = "";
let locationId = "";
let templateId = "";
let agreementId = "";
const createdAppEventIds: string[] = [];

describe("contracts and agreements phase 3", () => {
  beforeAll(async () => {
    ({
      handleAgreementSignatureSend,
      handleAgreementSignatureReminder,
      handleAgreementSignatureSync,
      handleAgreementSignatureWebhook
    } = await import("../../worker/src/agreements/agreementSignatureProvider.js"));
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
    const tenantResult = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
    tenantId = tenantResult.rows[0]?.id ?? "";
  });

  beforeEach(async () => {
    publishRealtime.mockReset();
  });

  afterAll(async () => {
    if (agreementId) {
      await deleteAgreement(agreementId);
    }
    if (templateId) {
      await pool.query("DELETE FROM agreement_template WHERE id = $1", [templateId]);
    }
    if (locationId) {
      await pool.query("DELETE FROM shoot_location WHERE id = $1", [locationId]);
    }
    if (contactId) {
      await pool.query("DELETE FROM organization_contact WHERE id = $1", [contactId]);
    }
    if (organizationId) {
      await pool.query("DELETE FROM organization WHERE id = $1", [organizationId]);
    }
  });

  it("sends Agreements through the provider lifecycle and registers the final signed package", async () => {
    const orgResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `Provider Lifecycle School ${testStamp}`,
        display_name: `Provider Lifecycle School ${testStamp}`,
        account_type: "schools_underclass_portraits"
      });

    expect(orgResponse.status).toBe(201);
    organizationId = orgResponse.body.organization.id;

    const contactResponse = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Dana",
        last_name: `Lifecycle ${testStamp}`,
        title: "Principal",
        email: `dana.lifecycle.${testStamp}@example.com`
      });

    expect(contactResponse.status).toBe(201);
    contactId = contactResponse.body.contacts.find(
      (contact: { email: string }) => contact.email === `dana.lifecycle.${testStamp}@example.com`
    )?.id;
    expect(contactId).toBeTruthy();

    const locationResponse = await request(app)
      .post(`/api/organizations/${organizationId}/locations`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        location_name: `Gym ${testStamp}`,
        address_line_1: "123 School Street",
        city: "Deephaven",
        state: "MN",
        zip: "55391"
      });

    expect(locationResponse.status).toBe(201);
    locationId = locationResponse.body.locations.find((location: { location_name: string }) => location.location_name === `Gym ${testStamp}`)?.id;
    expect(locationId).toBeTruthy();

    const templateResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreement-templates`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        template_name: `Schools E-Sign ${testStamp}`,
        agreement_type: "schools",
        template_body: "Agreement for {{organization_name}} and {{contact_name}} effective {{effective_date}}.",
        merge_fields: ["organization_name", "contact_name", "effective_date", "contract_value"]
      });

    expect(templateResponse.status).toBe(201);
    templateId = templateResponse.body.agreement_templates.find(
      (template: { template_name: string }) => template.template_name === `Schools E-Sign ${testStamp}`
    )?.id;
    expect(templateId).toBeTruthy();

    const draftResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/from-template`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        template_id: templateId,
        agreement_title: `E-Sign Lifecycle Agreement ${testStamp}`,
        primary_contact_id: contactId,
        description: "Phase 3 provider lifecycle Agreement.",
        contract_value: 28000,
        revenue_share_terms: "Standard school revenue split",
        effective_date: "2026-04-01",
        expiration_date: "2027-04-01",
        renewal_date: "2027-03-01",
        notice_deadline: "2027-01-15",
        linked_contact_ids: [contactId],
        linked_location_ids: [locationId],
        signers: [
          {
            contact_id: contactId,
            signer_name: `Dana Lifecycle ${testStamp}`,
            signer_email: `dana.lifecycle.${testStamp}@example.com`,
            signer_role: "Principal",
            signer_order: 1,
            signer_type: "external"
          },
          {
            signer_name: "Matthew Kemmetmueller",
            signer_email: "leadership@example.com",
            signer_role: "Leadership Countersigner",
            signer_order: 2,
            signer_type: "countersigner"
          }
        ]
      });

    expect(draftResponse.status).toBe(201);
    const draftedAgreement = draftResponse.body.agreements.find(
      (agreement: { agreement_title: string }) => agreement.agreement_title === `E-Sign Lifecycle Agreement ${testStamp}`
    );
    expect(draftedAgreement).toBeTruthy();
    agreementId = draftedAgreement.id;
    expect(draftedAgreement.versions[0].version_stage).toBe("draft");

    const sendResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/${agreementId}/send`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        provider_name: "provider_stub",
        note: "Send the Agreement through the phase 3 provider lifecycle."
      });

    expect(sendResponse.status).toBe(202);
    const queuedAgreement = sendResponse.body.agreements.find((agreement: { id: string }) => agreement.id === agreementId);
    expect(queuedAgreement.status).toBe("sent");
    expect(queuedAgreement.external_provider_name).toBe("provider_stub");
    expect(queuedAgreement.external_status).toBe("send_requested");
    expect(queuedAgreement.provider_lifecycle_bucket).toBe("queued_to_send");

    const sendEvent = await loadPendingAgreementEvent("agreement.signature.send_requested", agreementId);
    await runAgreementWorkerStep(tenantId, handleAgreementSignatureSend, sendEvent.payload);
    await markAppEventProcessed(sendEvent.id);

    const sentAgreement = await fetchAgreement(organizationId, agreementId);
    expect(sentAgreement.status).toBe("sent");
    expect(sentAgreement.external_provider_name).toBe("provider_stub");
    expect(sentAgreement.external_envelope_id).toBeTruthy();
    expect(sentAgreement.external_status).toBe("sent");
    expect(sentAgreement.provider_lifecycle_bucket).toBe("sent_unsigned");
    expect(sentAgreement.signers.every((signer: { external_recipient_id: string | null; external_status: string | null }) => Boolean(signer.external_recipient_id) && signer.external_status === "sent")).toBe(true);
    expect(sentAgreement.provider_events.some((event: { event_type: string }) => event.event_type === "send_requested")).toBe(true);
    expect(sentAgreement.provider_events.some((event: { event_type: string }) => event.event_type === "sent")).toBe(true);
    expect(sentAgreement.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "sent_via_provider")).toBe(true);

    const reminderResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/${agreementId}/reminders`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        reminder_type: "manual_follow_up",
        channels: ["email", "internal_notice"],
        note: "Resend this Agreement through the provider reminder flow."
      });

    expect(reminderResponse.status).toBe(201);
    const reminderEvent = await loadPendingAgreementEvent("agreement.signature.reminder_requested", agreementId);
    await runAgreementWorkerStep(tenantId, handleAgreementSignatureReminder, reminderEvent.payload);
    await markAppEventProcessed(reminderEvent.id);

    const syncResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/${agreementId}/provider-sync`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        note: "Refresh the provider lifecycle state."
      });

    expect(syncResponse.status).toBe(202);
    const syncEvent = await loadPendingAgreementEvent("agreement.signature.sync_requested", agreementId);
    await runAgreementWorkerStep(tenantId, handleAgreementSignatureSync, syncEvent.payload);
    await markAppEventProcessed(syncEvent.id);

    const agreementAfterSync = await fetchAgreement(organizationId, agreementId);
    expect(agreementAfterSync.provider_events.some((event: { event_type: string }) => event.event_type === "reminder_requested")).toBe(true);
    expect(agreementAfterSync.provider_events.some((event: { event_type: string }) => event.event_type === "reminder_sent")).toBe(true);
    expect(agreementAfterSync.provider_events.some((event: { event_type: string }) => event.event_type === "sync_requested")).toBe(true);
    expect(agreementAfterSync.provider_events.some((event: { event_type: string }) => event.event_type === "sync_updated")).toBe(true);
    expect(agreementAfterSync.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "provider_reminder_sent")).toBe(true);
    expect(agreementAfterSync.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "provider_sync_updated")).toBe(true);

    const externalSigner = agreementAfterSync.signers.find((signer: { signer_type: string }) => signer.signer_type === "external");
    const countersigner = agreementAfterSync.signers.find((signer: { signer_type: string }) => signer.signer_type === "countersigner");
    expect(externalSigner).toBeTruthy();
    expect(countersigner).toBeTruthy();

    const viewedWebhookResponse = await request(app)
      .post(`/api/integrations/agreement_signature/webhook?tenant_id=${tenantId}`)
      .send({
        provider_name: "provider_stub",
        agreement_id: agreementId,
        external_envelope_id: agreementAfterSync.external_envelope_id,
        external_status: "viewed",
        occurred_at: "2026-04-02T15:00:00.000Z",
        signer_updates: [
          {
            signer_id: externalSigner.id,
            external_recipient_id: externalSigner.external_recipient_id,
            external_status: "viewed",
            viewed_at: "2026-04-02T15:00:00.000Z"
          }
        ]
      });

    expect(viewedWebhookResponse.status).toBe(202);
    const viewedWebhookEvent = await loadAppEventById(viewedWebhookResponse.body.id);
    await runAgreementWorkerStep(tenantId, handleAgreementSignatureWebhook, viewedWebhookEvent.payload);
    await markAppEventProcessed(viewedWebhookEvent.id);

    const viewedAgreement = await fetchAgreement(organizationId, agreementId);
    expect(viewedAgreement.status).toBe("viewed");
    expect(viewedAgreement.external_status).toBe("viewed");
    expect(viewedAgreement.provider_lifecycle_bucket).toBe("viewed_not_signed");
    expect(viewedAgreement.viewed_at).toBeTruthy();
    expect(viewedAgreement.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "provider_viewed")).toBe(true);

    const countersignedWebhookResponse = await request(app)
      .post(`/api/integrations/agreement_signature/webhook?tenant_id=${tenantId}`)
      .send({
        provider_name: "provider_stub",
        agreement_id: agreementId,
        external_envelope_id: viewedAgreement.external_envelope_id,
        external_status: "countersigned",
        occurred_at: "2026-04-03T18:30:00.000Z",
        signer_updates: [
          {
            signer_id: externalSigner.id,
            external_recipient_id: externalSigner.external_recipient_id,
            external_status: "signed",
            signed_at: "2026-04-03T17:00:00.000Z"
          },
          {
            signer_id: countersigner.id,
            external_recipient_id: countersigner.external_recipient_id,
            external_status: "signed",
            signed_at: "2026-04-03T18:30:00.000Z"
          }
        ],
        final_documents: [
          {
            file_name: `countersigned-agreement-${testStamp}.pdf`,
            storage_reference: `provider://provider_stub/${agreementId}/countersigned-final.pdf`,
            file_url: `https://example.test/countersigned-${testStamp}.pdf`,
            content_type: "application/pdf",
            version_label: "Countersigned Final",
            version_stage: "countersigned_final"
          }
        ]
      });

    expect(countersignedWebhookResponse.status).toBe(202);
    const countersignedWebhookEvent = await loadAppEventById(countersignedWebhookResponse.body.id);
    await runAgreementWorkerStep(tenantId, handleAgreementSignatureWebhook, countersignedWebhookEvent.payload);
    await markAppEventProcessed(countersignedWebhookEvent.id);

    const completedAgreement = await fetchAgreement(organizationId, agreementId);
    expect(completedAgreement.status).toBe("countersigned");
    expect(completedAgreement.external_status).toBe("countersigned");
    expect(completedAgreement.provider_lifecycle_bucket).toBe("completed");
    expect(completedAgreement.signed_at).toBeTruthy();
    expect(completedAgreement.countersigned_at).toBeTruthy();
    expect(
      completedAgreement.signers.every((signer: { status: string; signed_at: string | null }) => signer.status === "signed" && Boolean(signer.signed_at))
    ).toBe(true);
    expect(completedAgreement.provider_events.some((event: { event_type: string }) => event.event_type === "countersigned")).toBe(true);
    expect(completedAgreement.provider_events.some((event: { event_type: string }) => event.event_type === "completed_package_registered")).toBe(true);
    expect(completedAgreement.versions.some((version: { version_stage: string }) => version.version_stage === "countersigned_final")).toBe(true);
    expect(
      completedAgreement.files.some(
        (file: { version_label: string | null; is_current: boolean; storage_reference: string }) =>
          file.is_current && file.version_label === "Countersigned Final" && file.storage_reference.includes("provider_stub")
      )
    ).toBe(true);
    expect(completedAgreement.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "provider_countersigned")).toBe(true);
    expect(
      completedAgreement.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "final_signed_file_registered")
    ).toBe(true);
  }, 20000);
});

async function fetchAgreement(organizationId: string, agreementId: string) {
  const detailResponse = await request(app)
    .get(`/api/organizations/${organizationId}`)
    .set("Authorization", `Bearer ${leadershipToken}`);
  expect(detailResponse.status).toBe(200);
  const agreement = detailResponse.body.agreements.find((item: { id: string }) => item.id === agreementId);
  expect(agreement).toBeTruthy();
  return agreement;
}

async function runAgreementWorkerStep(
  tenantId: string,
  handler: (client: PoolClient, payload: Record<string, unknown>) => Promise<void>,
  payload: Record<string, unknown>
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenantId]);
    await handler(client, payload);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadPendingAgreementEvent(eventType: string, agreementId: string) {
  const result = await pool.query<{ id: string; payload: Record<string, unknown> }>(
    `
      SELECT id, payload
      FROM app_event
      WHERE processed_at IS NULL
        AND event_type = $1
        AND aggregate_id::text = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [eventType, agreementId]
  );
  expect(result.rows[0]).toBeTruthy();
  createdAppEventIds.push(result.rows[0].id);
  return result.rows[0];
}

async function loadAppEventById(id: string) {
  expect(id).toBeTruthy();
  const result = await pool.query<{ id: string; payload: Record<string, unknown> }>(
    `
      SELECT id, payload
      FROM app_event
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  expect(result.rows[0]).toBeTruthy();
  createdAppEventIds.push(result.rows[0].id);
  return result.rows[0];
}

async function markAppEventProcessed(id: string) {
  await pool.query("UPDATE app_event SET processed_at = now(), last_error = NULL WHERE id = $1", [id]);
}

async function deleteAgreement(id: string) {
  await pool.query(
    "DELETE FROM app_event WHERE id = ANY($1::uuid[]) OR aggregate_id = $2::uuid",
    [createdAppEventIds, id]
  );
  await pool.query("DELETE FROM agreement_provider_event WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_reminder WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_file WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_version WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_signer WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_link WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_activity_log WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement WHERE id = $1", [id]);
}
