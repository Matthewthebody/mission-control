import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();

let schoolsToken = "";
let tenantId = "";
let organizationId = "";
let contactId = "";
let opportunityId = "";
let communicationId = "";
let insertedTemplateIds: string[] = [];

const SALES_EMAIL_TEMPLATE_FIXTURES = [
  {
    template_key: "proposal_email",
    template_name: "Proposal Email",
    subject_template: "Proposal for {{organization_name}}",
    body_template: "Hi {{contact_name}},\n\nHere is the current proposal.\n\nBest,\n{{sender_name}}",
    merge_fields: ["organization_name", "contact_name", "sender_name"],
    automation_enabled: false
  },
  {
    template_key: "contract_follow_up",
    template_name: "Contract Follow-Up",
    subject_template: "Following up on {{organization_name}}",
    body_template: "Hi {{contact_name}},\n\nChecking in on the agreement.\n\nBest,\n{{sender_name}}",
    merge_fields: ["organization_name", "contact_name", "sender_name"],
    automation_enabled: true
  },
  {
    template_key: "renewal_outreach",
    template_name: "Renewal Outreach",
    subject_template: "Renewal planning for {{organization_name}}",
    body_template: "Hi {{contact_name}},\n\nLet's reconnect on renewal planning.\n\nBest,\n{{sender_name}}",
    merge_fields: ["organization_name", "contact_name", "sender_name"],
    automation_enabled: true
  },
  {
    template_key: "onboarding_message",
    template_name: "Onboarding Message",
    subject_template: "Welcome from Kemmetmueller Photography",
    body_template: "Hi {{contact_name}},\n\nWe are excited to get started.\n\nBest,\n{{sender_name}}",
    merge_fields: ["contact_name", "sender_name"],
    automation_enabled: false
  },
  {
    template_key: "post_shoot_follow_up",
    template_name: "Post-Shoot Follow-Up",
    subject_template: "Post-shoot follow-up for {{organization_name}}",
    body_template: "Hi {{contact_name}},\n\nFollowing up after the shoot.\n\nBest,\n{{sender_name}}",
    merge_fields: ["organization_name", "contact_name", "sender_name"],
    automation_enabled: true
  }
] as const;

async function ensureSalesEmailTemplates() {
  const tenantResult = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM app_user WHERE lower(email) = lower($1) LIMIT 1",
    ["schools-office@example.com"]
  );
  tenantId = tenantResult.rows[0]?.tenant_id ?? "";
  expect(tenantId).toBeTruthy();

  const existingResult = await pool.query<{ template_key: string }>(
    `
      SELECT template_key::text AS template_key
      FROM sales_email_template
      WHERE tenant_id = $1
        AND active_status = true
        AND template_key = ANY($2::sales_email_template_key[])
    `,
    [tenantId, SALES_EMAIL_TEMPLATE_FIXTURES.map((fixture) => fixture.template_key)]
  );
  const existingKeys = new Set(existingResult.rows.map((row) => row.template_key));

  for (const fixture of SALES_EMAIL_TEMPLATE_FIXTURES) {
    if (existingKeys.has(fixture.template_key)) {
      continue;
    }
    const insertResult = await pool.query<{ id: string }>(
      `
        INSERT INTO sales_email_template (
          tenant_id,
          template_key,
          template_name,
          subject_template,
          body_template,
          merge_fields,
          automation_enabled
        )
        VALUES ($1,$2::sales_email_template_key,$3,$4,$5,$6::jsonb,$7)
        RETURNING id
      `,
      [
        tenantId,
        fixture.template_key,
        `${fixture.template_name} ${testStamp}`,
        fixture.subject_template,
        fixture.body_template,
        JSON.stringify(fixture.merge_fields),
        fixture.automation_enabled
      ]
    );
    if (insertResult.rows[0]?.id) {
      insertedTemplateIds.push(insertResult.rows[0].id);
    }
  }
}

describe("sales pipeline phase F4", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    await ensureSalesEmailTemplates();

    const organizationResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `CRM Email School ${testStamp}`,
        display_name: `CRM Email School ${testStamp}`,
        account_type: "schools_underclass_portraits"
      });

    expect(organizationResponse.status).toBe(201);
    organizationId = organizationResponse.body.organization.id;

    const contactResponse = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Barb",
        last_name: `Byzee ${testStamp}`,
        title: "Activities Director",
        phone: "555-0110",
        email: `barb.byzee.${testStamp}@example.com`
      });

    expect(contactResponse.status).toBe(201);
    contactId = contactResponse.body.contacts.find(
      (contact: { email: string | null }) => contact.email === `barb.byzee.${testStamp}@example.com`
    )?.id;
    expect(contactId).toBeTruthy();

    const opportunityResponse = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "renewal",
        pipeline_type: "schools",
        stage: "proposal_sent",
        estimated_value: 28000,
        next_action_date: "2026-04-10",
        last_touch_date: "2026-03-28",
        notes: "Testing sales communication tracking."
      });

    expect(opportunityResponse.status).toBe(201);
    opportunityId = opportunityResponse.body.opportunity.id;
  });

  afterAll(async () => {
    if (communicationId) {
      await pool.query("DELETE FROM sales_email_communication_event WHERE communication_id = $1", [communicationId]);
      await pool.query("DELETE FROM sales_email_communication WHERE id = $1", [communicationId]);
    }
    if (opportunityId) {
      await pool.query("DELETE FROM sales_pipeline_alert WHERE opportunity_id = $1", [opportunityId]);
      await pool.query("DELETE FROM sales_opportunity WHERE id = $1", [opportunityId]);
    }
    if (contactId) {
      await pool.query("DELETE FROM organization_contact WHERE id = $1", [contactId]);
    }
    if (organizationId) {
      await pool.query("DELETE FROM organization WHERE id = $1", [organizationId]);
    }
    if (insertedTemplateIds.length > 0) {
      await pool.query("DELETE FROM sales_email_template WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [
        tenantId,
        insertedTemplateIds
      ]);
      insertedTemplateIds = [];
    }
  });

  it("queues templated email sends and surfaces linked communication history on opportunity and account views", async () => {
    const detailBeforeSend = await request(app)
      .get(`/api/sales/opportunities/${opportunityId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(detailBeforeSend.status).toBe(200);
    expect(detailBeforeSend.body.email_templates.length).toBeGreaterThanOrEqual(5);
    const proposalTemplate = detailBeforeSend.body.email_templates.find(
      (template: { template_key: string }) => template.template_key === "proposal_email"
    );
    expect(proposalTemplate).toBeTruthy();

    const sendResponse = await request(app)
      .post("/api/sales/communications/send")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        opportunity_id: opportunityId,
        contact_id: contactId,
        template_id: proposalTemplate.id,
        subject: "Proposal follow-up for CRM Email School",
        body: "Hi Barb,\n\nWe attached the current proposal and wanted to keep the conversation moving.\n\nBest,\nBrenda"
      });

    expect(sendResponse.status).toBe(201);
    communicationId = sendResponse.body.id;
    expect(sendResponse.body.status).toBe("queued");
    expect(sendResponse.body.opportunity_id).toBe(opportunityId);
    expect(sendResponse.body.contact_id).toBe(contactId);
    expect(sendResponse.body.events.some((event: { event_type: string }) => event.event_type === "queued")).toBe(true);

    const detailAfterSend = await request(app)
      .get(`/api/sales/opportunities/${opportunityId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(detailAfterSend.status).toBe(200);
    expect(detailAfterSend.body.communications.some((communication: { id: string; subject: string }) => communication.id === communicationId && communication.subject.includes("Proposal follow-up"))).toBe(true);

    const organizationDetail = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(organizationDetail.status).toBe(200);
    expect(organizationDetail.body.sales_email_templates.length).toBeGreaterThanOrEqual(5);
    expect(
      organizationDetail.body.sales_communications.some(
        (communication: { id: string; opportunity_id: string | null; contact_id: string | null }) =>
          communication.id === communicationId && communication.opportunity_id === opportunityId && communication.contact_id === contactId
      )
    ).toBe(true);
  });
});
