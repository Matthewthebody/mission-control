import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();

let schoolsToken = "";
let leadershipToken = "";
let organizationId = "";
let contactId = "";
let locationId = "";
let templateId = "";
let agreementId = "";
let renewalAgreementId = "";

describe("contracts and agreements phase 2", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  });

  afterAll(async () => {
    if (renewalAgreementId) {
      await deleteAgreement(renewalAgreementId);
    }
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

  it("creates the canonical Organization context for agreement lifecycle testing", async () => {
    const orgResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `Lifecycle School ${testStamp}`,
        display_name: `Lifecycle School ${testStamp}`,
        account_type: "schools_underclass_portraits"
      });

    expect(orgResponse.status).toBe(201);
    organizationId = orgResponse.body.organization.id;

    const contactResponse = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Dana",
        last_name: `Signer ${testStamp}`,
        title: "Principal",
        email: `dana.signer.${testStamp}@example.com`
      });

    expect(contactResponse.status).toBe(201);
    contactId = contactResponse.body.contacts.find((contact: { email: string }) => contact.email === `dana.signer.${testStamp}@example.com`)?.id;
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
  });

  it("creates templates and drafts agreements from template with signer/version structure", async () => {
    const templateResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreement-templates`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        template_name: `Schools Master ${testStamp}`,
        agreement_type: "schools",
        template_body: "Agreement for {{organization_name}} and {{contact_name}} effective {{effective_date}}.",
        merge_fields: ["organization_name", "contact_name", "effective_date"]
      });

    expect(templateResponse.status).toBe(201);
    templateId = templateResponse.body.agreement_templates.find((template: { template_name: string }) => template.template_name === `Schools Master ${testStamp}`)?.id;
    expect(templateId).toBeTruthy();

    const draftResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/from-template`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        template_id: templateId,
        agreement_title: `Lifecycle Agreement ${testStamp}`,
        primary_contact_id: contactId,
        description: "Draft agreement created from template.",
        effective_date: "2026-04-01",
        expiration_date: "2027-04-01",
        renewal_date: "2027-03-01",
        notice_deadline: "2027-01-15",
        linked_contact_ids: [contactId],
        linked_location_ids: [locationId],
        signers: [
          {
            contact_id: contactId,
            signer_name: `Dana Signer ${testStamp}`,
            signer_email: `dana.signer.${testStamp}@example.com`,
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
    const agreement = draftResponse.body.agreements.find((item: { agreement_title: string }) => item.agreement_title === `Lifecycle Agreement ${testStamp}`);
    expect(agreement).toBeTruthy();
    agreementId = agreement.id;
    expect(agreement.source_template_id).toBe(templateId);
    expect(agreement.signers).toHaveLength(2);
    expect(agreement.versions).toHaveLength(1);
    expect(agreement.versions[0].version_stage).toBe("draft");
  });

  it("logs reminder history and renewal lineage", async () => {
    const reminderResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/${agreementId}/reminders`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        reminder_type: "manual_follow_up",
        channels: ["email", "internal_notice"],
        note: "Manual signature follow-up"
      });

    expect(reminderResponse.status).toBe(201);
    const remindedAgreement = reminderResponse.body.agreements.find((item: { id: string }) => item.id === agreementId);
    expect(remindedAgreement.reminders.some((reminder: { reminder_type: string }) => reminder.reminder_type === "manual_follow_up")).toBe(true);

    const renewalResponse = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/${agreementId}/renewal`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        agreement_title: `Lifecycle Agreement ${testStamp} Renewal`,
        effective_date: "2027-04-02",
        expiration_date: "2028-04-01",
        renewal_date: "2028-03-01",
        notice_deadline: "2028-01-15",
        note: "Renewal created from prior agreement"
      });

    expect(renewalResponse.status).toBe(201);
    const renewalAgreement = renewalResponse.body.agreements.find(
      (item: { agreement_title: string; prior_agreement_id: string | null }) =>
        item.agreement_title === `Lifecycle Agreement ${testStamp} Renewal` && item.prior_agreement_id === agreementId
    );
    expect(renewalAgreement).toBeTruthy();
    renewalAgreementId = renewalAgreement.id;
    const priorAgreement = renewalResponse.body.agreements.find((item: { id: string }) => item.id === agreementId);
    expect(priorAgreement.replaced_by_agreement_id).toBe(renewalAgreementId);
    expect(
      renewalAgreement.activity_log.some((activity: { activity_type: string }) => activity.activity_type === "renewal_draft_created")
    ).toBe(true);
  });
});

async function deleteAgreement(id: string) {
  await pool.query("DELETE FROM agreement_reminder WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_file WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_version WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_signer WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_link WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement_activity_log WHERE agreement_id = $1", [id]);
  await pool.query("DELETE FROM agreement WHERE id = $1", [id]);
}
