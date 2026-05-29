import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, passwordLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();

function addDaysIso(days: number) {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

let schoolsToken = "";
let leadershipToken = "";
let photographerToken = "";
let organizationId = "";
let contactId = "";
let locationId = "";
let agreementId = "";

describe("contracts and agreements phase 1", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
    photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  });

  afterAll(async () => {
    if (agreementId) {
      await pool.query("DELETE FROM agreement_file WHERE agreement_id = $1", [agreementId]);
      await pool.query("DELETE FROM agreement_link WHERE agreement_id = $1", [agreementId]);
      await pool.query("DELETE FROM agreement_activity_log WHERE agreement_id = $1", [agreementId]);
      await pool.query("DELETE FROM agreement WHERE id = $1", [agreementId]);
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

  it("creates an Organization workspace record for contract tracking", async () => {
    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `Demo Agreements School ${testStamp}`,
        display_name: `Demo Agreements School ${testStamp}`,
        account_type: "schools_underclass_portraits",
        notes: "Organization created for agreements phase 1 validation."
      });

    expect(response.status).toBe(201);
    organizationId = response.body.organization.id;
  });

  it("creates linked Contact and Location records used by Agreements", async () => {
    const contactResponse = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Barb",
        last_name: `Byzee ${testStamp}`,
        title: "Principal",
        email: `barb.byzee.${testStamp}@example.com`
      });

    expect(contactResponse.status).toBe(201);
    contactId = contactResponse.body.contacts.find((contact: { full_name: string }) => contact.full_name === `Barb Byzee ${testStamp}`)?.id;
    expect(contactId).toBeTruthy();

    const locationResponse = await request(app)
      .post(`/api/organizations/${organizationId}/locations`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        location_name: `Main Campus ${testStamp}`,
        address_line_1: "123 School Street",
        city: "Deephaven",
        state: "MN",
        zip: "55391"
      });

    expect(locationResponse.status).toBe(201);
    locationId = locationResponse.body.locations.find((location: { location_name: string }) => location.location_name === `Main Campus ${testStamp}`)?.id;
    expect(locationId).toBeTruthy();
  });

  it("allows leadership to create and track Agreements on an Organization", async () => {
    const response = await request(app)
      .post(`/api/organizations/${organizationId}/agreements`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        agreement_title: `2026 Portrait Agreement ${testStamp}`,
        agreement_type: "schools",
        status: "sent",
        primary_contact_id: contactId,
        description: "Primary school portrait agreement for the upcoming season.",
        contract_value: 25000,
        revenue_share_terms: "Standard school revenue share",
        sent_at: "2026-03-01T16:00:00.000Z",
        linked_contact_ids: [contactId],
        linked_location_ids: [locationId]
      });

    expect(response.status).toBe(201);
    expect(response.body.agreement_summary.pending_signature).toBe(1);
    expect(response.body.agreements).toHaveLength(1);
    agreementId = response.body.agreements[0].id;
  });

  it("updates Agreement status and date context for expiring-soon tracking", async () => {
    const basePayload = {
      agreement_title: `2026 Portrait Agreement ${testStamp}`,
      agreement_type: "schools",
      status: "active",
      primary_contact_id: contactId,
      description: "Primary school portrait agreement for the upcoming season.",
      contract_value: 25000,
      revenue_share_terms: "Standard school revenue share",
      effective_date: addDaysIso(-30),
      signed_at: "2026-03-02T16:00:00.000Z",
      countersigned_at: "2026-03-03T17:00:00.000Z",
      linked_contact_ids: [contactId],
      linked_location_ids: [locationId]
    };

    const outsideWindowResponse = await request(app)
      .patch(`/api/organizations/${organizationId}/agreements/${agreementId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        ...basePayload,
        expiration_date: addDaysIso(120),
        renewal_date: addDaysIso(110),
        notice_deadline: addDaysIso(100),
        note: "Contract is active outside the expiring-soon window."
      });

    expect(outsideWindowResponse.status).toBe(200);
    expect(outsideWindowResponse.body.agreement_summary.expiring_soon).toBe(0);
    expect(outsideWindowResponse.body.agreement_summary.active).toBe(1);

    const expiredResponse = await request(app)
      .patch(`/api/organizations/${organizationId}/agreements/${agreementId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        ...basePayload,
        expiration_date: addDaysIso(-1),
        renewal_date: addDaysIso(-10),
        notice_deadline: addDaysIso(-20),
        note: "Contract is expired and should not count as expiring soon."
      });

    expect(expiredResponse.status).toBe(200);
    expect(expiredResponse.body.agreement_summary.expiring_soon).toBe(0);
    expect(expiredResponse.body.agreement_summary.expired).toBe(1);

    const response = await request(app)
      .patch(`/api/organizations/${organizationId}/agreements/${agreementId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        ...basePayload,
        expiration_date: addDaysIso(30),
        renewal_date: addDaysIso(20),
        notice_deadline: addDaysIso(15),
        note: "Contract is active and should show renewal attention."
      });

    expect(response.status).toBe(200);
    expect(response.body.agreement_summary.expiring_soon).toBe(1);
    expect(response.body.agreements[0].status).toBe("active");
  });

  it("registers file versions and preserves activity history", async () => {
    const response = await request(app)
      .post(`/api/organizations/${organizationId}/agreements/${agreementId}/files`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        file_type: "pdf",
        file_name: `portrait-agreement-${testStamp}.pdf`,
        storage_reference: `tenants/demo/agreements/${agreementId}/portrait-agreement-${testStamp}.pdf`,
        file_url: `https://example.test/portrait-agreement-${testStamp}.pdf`,
        content_type: "application/pdf",
        file_size_bytes: 182400,
        version_label: "Signed final",
        is_current: true,
        legacy_upload: true
      });

    expect(response.status).toBe(201);
    expect(response.body.agreements[0].files).toHaveLength(1);
    expect(response.body.agreements[0].files[0].is_current).toBe(true);
    expect(
      response.body.agreements[0].activity_log.some((activity: { activity_type: string }) => activity.activity_type === "legacy_file_registered")
    ).toBe(true);
  });

  it("keeps Agreement detail leadership-only even though Organization detail remains viewable", async () => {
    const leadershipDetail = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(leadershipDetail.status).toBe(200);
    expect(leadershipDetail.body.agreements_access.can_view).toBe(true);
    expect(leadershipDetail.body.agreements).toHaveLength(1);

    const photographerDetail = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(photographerDetail.status).toBe(200);
    expect(photographerDetail.body.agreements_access.can_view).toBe(false);
    expect(photographerDetail.body.agreements).toHaveLength(0);

    const deniedCreate = await request(app)
      .post(`/api/organizations/${organizationId}/agreements`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        agreement_title: "Blocked photographer agreement",
        agreement_type: "schools"
      });

    expect(deniedCreate.status).toBe(403);
  });
});
