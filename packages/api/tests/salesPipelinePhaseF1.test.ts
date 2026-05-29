import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();

let schoolsToken = "";
let sportsToken = "";
let photographerToken = "";
let organizationId = "";
let contactId = "";
const opportunityIds: string[] = [];

describe("sales pipeline phase F1", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    sportsToken = (await devLogin(app, "sports-office@example.com")).body.token;
    photographerToken = (await devLogin(app, "photo@example.com")).body.token;

    const organizationResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `Sales Pipeline School ${testStamp}`,
        display_name: `Sales Pipeline School ${testStamp}`,
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
  });

  afterAll(async () => {
    if (opportunityIds.length) {
      await pool.query("DELETE FROM sales_opportunity WHERE id = ANY($1::uuid[])", [opportunityIds]);
    }
    if (contactId) {
      await pool.query("DELETE FROM organization_contact WHERE id = $1", [contactId]);
    }
    if (organizationId) {
      await pool.query("DELETE FROM organization WHERE id = $1", [organizationId]);
    }
  });

  it("allows pipeline-scoped opportunity creation and blocks cross-pipeline viewing", async () => {
    const createSchoolsOpportunity = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "renewal",
        pipeline_type: "schools",
        stage: "lead",
        estimated_value: 24000,
        next_action_date: "2026-04-10",
        last_touch_date: "2026-03-28",
        notes: "Renewal relationship planning for next school year."
      });

    expect(createSchoolsOpportunity.status).toBe(201);
    const schoolsOpportunityId = createSchoolsOpportunity.body.opportunity.id as string;
    opportunityIds.push(schoolsOpportunityId);

    const sportsViewAttempt = await request(app)
      .get(`/api/sales/opportunities/${schoolsOpportunityId}`)
      .set("Authorization", `Bearer ${sportsToken}`);

    expect(sportsViewAttempt.status).toBe(403);

    const createSportsOpportunity = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "expansion",
        pipeline_type: "sports",
        stage: "contacted",
        estimated_value: 18000,
        next_action_date: "2026-04-12",
        last_touch_date: "2026-03-28",
        notes: "Sports upsell conversation."
      });

    expect(createSportsOpportunity.status).toBe(201);
    opportunityIds.push(createSportsOpportunity.body.opportunity.id);
  });

  it("enforces stage rules for proposal, contract, dormant, and won", async () => {
    const proposalWithoutValue = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "new",
        pipeline_type: "schools",
        stage: "proposal_sent",
        next_action_date: "2026-04-15",
        last_touch_date: "2026-03-28"
      });

    expect(proposalWithoutValue.status).toBe(400);
    expect(proposalWithoutValue.body.error).toContain("estimated value");

    const contractWithoutContact = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        opportunity_type: "new",
        pipeline_type: "schools",
        stage: "contract_sent",
        estimated_value: 15000,
        next_action_date: "2026-04-18",
        last_touch_date: "2026-03-28"
      });

    expect(contractWithoutContact.status).toBe(400);
    expect(contractWithoutContact.body.error).toContain("primary Contact");

    const dormantWithoutFollowUp = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "renewal",
        pipeline_type: "schools",
        stage: "dormant",
        estimated_value: 10000,
        next_action_date: "2026-04-20",
        last_touch_date: "2026-03-28"
      });

    expect(dormantWithoutFollowUp.status).toBe(400);
    expect(dormantWithoutFollowUp.body.error).toContain("follow-up date");

    const wonWithoutAgreement = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "renewal",
        pipeline_type: "schools",
        stage: "won",
        estimated_value: 26000,
        next_action_date: "2026-04-21",
        last_touch_date: "2026-03-28"
      });

    expect(wonWithoutAgreement.status).toBe(400);
    expect(wonWithoutAgreement.body.error).toContain("Agreement");
  });

  it("surfaces dormant opportunities that are ready to resurface", async () => {
    const dormantResponse = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "renewal",
        pipeline_type: "schools",
        stage: "dormant",
        estimated_value: 22000,
        next_action_date: "2026-04-22",
        last_touch_date: "2026-03-28",
        follow_up_date: "2026-04-05",
        notes: "Pause until contract window reopens."
      });

    expect(dormantResponse.status).toBe(201);
    const dormantOpportunityId = dormantResponse.body.opportunity.id as string;
    opportunityIds.push(dormantOpportunityId);

    const boardResponse = await request(app)
      .get("/api/sales/board?pipeline_type=schools")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(boardResponse.status).toBe(200);
    const schoolsPipeline = boardResponse.body.pipelines.find((pipeline: { pipeline_type: string }) => pipeline.pipeline_type === "schools");
    expect(schoolsPipeline).toBeTruthy();
    expect(
      schoolsPipeline.resurfacing_soon.some((opportunity: { id: string; resurface_ready: boolean }) => opportunity.id === dormantOpportunityId && opportunity.resurface_ready)
    ).toBe(true);

    const resurfacingListResponse = await request(app)
      .get("/api/sales/opportunities?pipeline_type=schools&resurfacing_only=true")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(resurfacingListResponse.status).toBe(200);
    expect(
      resurfacingListResponse.body.opportunities.some((opportunity: { id: string; resurface_ready: boolean }) => opportunity.id === dormantOpportunityId && opportunity.resurface_ready)
    ).toBe(true);
  });

  it("blocks photographers from the sales pipeline", async () => {
    const response = await request(app)
      .get("/api/sales/board")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(403);
  });
});
