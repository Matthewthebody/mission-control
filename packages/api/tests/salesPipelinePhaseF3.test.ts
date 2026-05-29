import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();

let schoolsToken = "";
let organizationId = "";
let contactId = "";
let opportunityId = "";
let agreementId = "";
let shootId = "";
let leadershipId = "";
let studioId = "";

describe("sales pipeline phase F3", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;

    const leadershipResult = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM app_user
        WHERE email = 'leadership@example.com'
        LIMIT 1
      `
    );
    leadershipId = leadershipResult.rows[0]?.id ?? "";

    const studioResult = await pool.query<{ id: string }>("SELECT id FROM studio LIMIT 1");
    studioId = studioResult.rows[0]?.id ?? "";

    const organizationResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `CRM Automation School ${testStamp}`,
        display_name: `CRM Automation School ${testStamp}`,
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
    if (shootId) {
      await pool.query("DELETE FROM shoot WHERE id = $1", [shootId]);
    }
    if (opportunityId) {
      await pool.query("DELETE FROM sales_pipeline_alert WHERE opportunity_id = $1", [opportunityId]);
      await pool.query("DELETE FROM sales_opportunity WHERE id = $1", [opportunityId]);
    }
    if (agreementId) {
      await pool.query("DELETE FROM agreement WHERE id = $1", [agreementId]);
    }
    if (contactId) {
      await pool.query("DELETE FROM organization_contact WHERE id = $1", [contactId]);
    }
    if (organizationId) {
      await pool.query("DELETE FROM organization WHERE id = $1", [organizationId]);
    }
  });

  it("surfaces CRM automation signals in sales board, opportunity detail, and account detail", async () => {
    const createOpportunity = await request(app)
      .post("/api/sales/opportunities")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        primary_contact_id: contactId,
        opportunity_type: "renewal",
        pipeline_type: "schools",
        stage: "meeting_scheduled",
        estimated_value: 24000,
        next_action_date: null,
        last_touch_date: "2026-03-01",
        last_verified_contact_date: "2026-02-20",
        notes: "Needs CRM automation follow-up."
      });

    expect(createOpportunity.status).toBe(201);
    opportunityId = createOpportunity.body.opportunity.id;
    expect(createOpportunity.body.opportunity.next_action_date).toBeNull();

    await pool.query(
      `
        INSERT INTO sales_pipeline_alert (
          tenant_id,
          alert_type,
          status,
          severity,
          dedupe_key,
          pipeline_type,
          opportunity_id,
          organization_id,
          title,
          message,
          metadata
        )
        VALUES (
          (SELECT tenant_id FROM organization WHERE id = $1),
          'missing_next_action',
          'open',
          'critical',
          $2,
          'schools',
          $3,
          $1,
          'Missing Next Action',
          'This opportunity is active without a next action date.',
          '{}'::jsonb
        )
      `,
      [organizationId, `sales-opportunity:${opportunityId}:missing-next-action`, opportunityId]
    );

    const agreementInsert = await pool.query<{ id: string }>(
      `
        INSERT INTO agreement (
          tenant_id,
          agreement_title,
          agreement_type,
          status,
          organization_id,
          client_account_id,
          primary_contact_id,
          contract_value,
          revenue_share_terms,
          effective_date,
          expiration_date,
          renewal_date,
          notice_deadline,
          auto_renew,
          sent_at,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (
          (SELECT tenant_id FROM organization WHERE id = $1),
          $2,
          'schools',
          'sent',
          $1,
          $1,
          $3,
          24000,
          'Standard terms',
          current_date - 30,
          current_date + 20,
          current_date + 20,
          current_date + 5,
          false,
          now() - interval '31 days',
          $4,
          $4
        )
        RETURNING id
      `,
      [organizationId, `CRM Automation Agreement ${testStamp}`, contactId, leadershipId]
    );
    agreementId = agreementInsert.rows[0]?.id ?? "";

    const shootInsert = await pool.query<{ id: string }>(
      `
        INSERT INTO shoot (
          tenant_id,
          studio_id,
          organization_id,
          primary_contact_id,
          shoot_code,
          title,
          shoot_date,
          location_name,
          location_address,
          location_lat,
          location_lng,
          geofence_radius_meters,
          arrival_time,
          showtime,
          start_time,
          end_time_est,
          projected_students,
          created_by
        )
        VALUES (
          (SELECT tenant_id FROM organization WHERE id = $1),
          $2,
          $1,
          $3,
          $4,
          'CRM Automation Upcoming Shoot',
          current_date + 10,
          'CRM Test Venue',
          '123 Test Street',
          44.9778,
          -93.2649,
          200,
          now() + interval '10 days 1 hour',
          now() + interval '10 days 1 hour',
          now() + interval '10 days 2 hours',
          now() + interval '10 days 4 hours',
          25,
          $5
        )
        RETURNING id
      `,
      [organizationId, studioId, contactId, `CRM-AUTO-${testStamp}`, leadershipId]
    );
    shootId = shootInsert.rows[0]?.id ?? "";

    const boardResponse = await request(app)
      .get("/api/sales/board?pipeline_type=schools")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(boardResponse.status).toBe(200);
    expect(boardResponse.body.automation_summary.missing_next_action).toBeGreaterThanOrEqual(1);
    expect(boardResponse.body.automation_summary.contract_reminders_due).toBeGreaterThanOrEqual(1);
    expect(boardResponse.body.automation_summary.renewals_due).toBeGreaterThanOrEqual(1);
    expect(boardResponse.body.automation_summary.upcoming_shoot_risk).toBeGreaterThanOrEqual(1);
    expect(
      boardResponse.body.automation_alerts.some((alert: { alert_type: string }) => alert.alert_type === "missing_next_action")
    ).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/sales/opportunities/${opportunityId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.opportunity.next_action_date).toBeNull();
    expect(detailResponse.body.alerts.some((alert: { alert_type: string }) => alert.alert_type === "missing_next_action")).toBe(true);

    const organizationDetailResponse = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(organizationDetailResponse.status).toBe(200);
    expect(organizationDetailResponse.body.sales_pipeline_summary.linked_opportunities).toBe(1);
    expect(organizationDetailResponse.body.sales_pipeline_summary.open_alerts).toBeGreaterThanOrEqual(1);
    expect(
      organizationDetailResponse.body.sales_pipeline_alerts.some(
        (alert: { alert_type: string }) => alert.alert_type === "missing_next_action"
      )
    ).toBe(true);
  });
});
