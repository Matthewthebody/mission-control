import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();
const shootDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

let schoolsToken = "";
let sportsToken = "";
let customerServiceToken = "";
let photographerToken = "";
let schoolsOfficeUserId = "";
let officeUserId = "";
let studioId = "";
let organizationId = "";
let secondaryOrganizationId = "";
let contactId = "";
let secondaryContactId = "";
let locationId = "";
let shootId = "";
let duplicateReviewId = "";

describe("canonical organization directory", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    sportsToken = (await devLogin(app, "sports-office@example.com")).body.token;
    customerServiceToken = (await devLogin(app, "office@example.com")).body.token;
    photographerToken = (await devLogin(app, "photo@example.com")).body.token;
    schoolsOfficeUserId = (await getMembershipId("schools-office@example.com")) ?? "";
    officeUserId = (await getMembershipId("office@example.com")) ?? "";

    const studioResult = await pool.query(
      `
        SELECT st.id
        FROM studio st
        JOIN tenant t ON t.id = st.tenant_id
        WHERE t.name = 'Demo Studio'
          AND st.name = 'Main Studio'
        LIMIT 1
      `
    );
    studioId = String(studioResult.rows[0]?.id ?? "");
  });

  afterAll(async () => {
    if (duplicateReviewId) {
      await pool.query("DELETE FROM directory_duplicate_review WHERE id = $1", [duplicateReviewId]);
    }
    if (organizationId || secondaryOrganizationId) {
      await pool.query(
        "DELETE FROM directory_relationship_follow_up WHERE organization_id = ANY($1::uuid[])",
        [[organizationId, secondaryOrganizationId].filter(Boolean)]
      );
      await pool.query(
        "DELETE FROM directory_relationship_memory WHERE organization_id = ANY($1::uuid[])",
        [[organizationId, secondaryOrganizationId].filter(Boolean)]
      );
      await pool.query(
        "DELETE FROM directory_touchpoint_plan WHERE organization_id = ANY($1::uuid[])",
        [[organizationId, secondaryOrganizationId].filter(Boolean)]
      );
    }
    if (shootId) {
      await pool.query("DELETE FROM directory_touchpoint WHERE shoot_id = $1", [shootId]);
      await pool.query("DELETE FROM shoot_contact_link WHERE shoot_id = $1", [shootId]);
      await pool.query("DELETE FROM shoot WHERE id = $1", [shootId]);
    }
    if (locationId) {
      await pool.query("DELETE FROM directory_touchpoint WHERE location_id = $1", [locationId]);
      await pool.query("DELETE FROM location_contact_link WHERE location_id = $1", [locationId]);
    }
    if (contactId || secondaryContactId) {
      await pool.query(
        "DELETE FROM directory_touchpoint WHERE contact_id = ANY($1::uuid[])",
        [[contactId, secondaryContactId].filter(Boolean)]
      );
      await pool.query(
        "DELETE FROM organization_contact_relationship WHERE contact_id = ANY($1::uuid[])",
        [[contactId, secondaryContactId].filter(Boolean)]
      );
      await pool.query(
        "DELETE FROM organization_contact WHERE id = ANY($1::uuid[])",
        [[contactId, secondaryContactId].filter(Boolean)]
      );
    }
    if (organizationId) {
      await pool.query("DELETE FROM shoot_location WHERE organization_id = $1", [organizationId]);
      await pool.query("DELETE FROM organization WHERE id = $1", [organizationId]);
    }
    if (secondaryOrganizationId) {
      await pool.query("DELETE FROM shoot_location WHERE organization_id = $1", [secondaryOrganizationId]);
      await pool.query("DELETE FROM organization WHERE id = $1", [secondaryOrganizationId]);
    }
  });

  it("allows approved office roles to create Organizations", async () => {
    const response = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `White Bear Lake High School ${testStamp}`,
        display_name: `White Bear Lake High School ${testStamp}`,
        logo_url: `https://example.test/white-bear-${testStamp}.png`,
        account_type: "schools_underclass_portraits",
        aliases: [`WBL High School ${testStamp}`, `White Bear HS ${testStamp}`],
        notes: "Canonical school account for scheduling and recurring location intelligence."
      });

    expect(response.status).toBe(201);
    expect(response.body.organization.display_name).toContain("White Bear Lake High School");
    expect(response.body.organization.logo_url).toBe(`https://example.test/white-bear-${testStamp}.png`);
    expect(response.body.organization.aliases).toContain(`WBL High School ${testStamp}`);
    organizationId = response.body.organization.id;

    const secondaryResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `North Metro Booster Club ${testStamp}`,
        display_name: `North Metro Booster Club ${testStamp}`,
        account_type: "sports",
        notes: "Secondary organization used to validate relationship attachment."
      });

    expect(secondaryResponse.status).toBe(201);
    secondaryOrganizationId = secondaryResponse.body.organization.id;
  });

  it("requires authentication before reading the canonical directory", async () => {
    const response = await request(app).get("/api/organizations");
    expect(response.status).toBe(401);
  });

  it("allows the schools team to create school contacts and locations within a school organization", async () => {
    expect(schoolsOfficeUserId).toBeTruthy();
    expect(officeUserId).toBeTruthy();

    const contactResponse = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Jamie",
        last_name: `Carlson ${testStamp}`,
        preferred_name: "Jamie",
        title: "Activities Director",
        department_program: "Activities Office",
        phone: "555-0188",
        email: `jamie.carlson.${testStamp}@example.com`,
        photo_url: `https://example.test/jamie-${testStamp}.jpg`,
        contact_status: "needs_review",
        role_category: "school_administration",
        operational_importance: "critical",
        decision_influence: "decision_maker",
        primary_internal_owner_user_id: schoolsOfficeUserId,
        backup_internal_owner_user_id: officeUserId,
        relationship_strength: "strong_relationship",
        handoff_ready: false,
        last_confirmed_at: "2025-08-01",
        uncertainty_flag: true,
        notes: "Primary planning contact for picture day logistics."
      });

    expect(contactResponse.status).toBe(201);
    const createdContact = contactResponse.body.contacts.find(
      (contact: { full_name: string }) => contact.full_name === `Jamie Carlson ${testStamp}`
    );
    expect(createdContact).toBeTruthy();
    expect(createdContact.preferred_name).toBe("Jamie");
    expect(createdContact.department_program).toBe("Activities Office");
    expect(createdContact.contact_status).toBe("needs_review");
    expect(createdContact.role_category).toBe("school_administration");
    expect(createdContact.operational_importance).toBe("critical");
    expect(createdContact.decision_influence).toBe("decision_maker");
    expect(createdContact.relationship_strength).toBe("strong_relationship");
    expect(createdContact.primary_internal_owner?.user_id).toBe(schoolsOfficeUserId);
    expect(createdContact.backup_internal_owner?.user_id).toBe(officeUserId);
    expect(createdContact.ownership_state).toBe("shared");
    expect(createdContact.freshness_state).toBe("needs_review");
    expect(Array.isArray(createdContact.maintenance_signals)).toBe(true);
    expect(
      createdContact.maintenance_signals.some((signal: { code: string }) => signal.code === "contact_needs_review")
    ).toBe(true);
    contactId = createdContact.id;

    const secondContactResponse = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Morgan",
        last_name: `Stark ${testStamp}`,
        title: "Assistant Coordinator",
        phone: "555-0115",
        email: `morgan.stark.${testStamp}@example.com`,
        notes: "Secondary day-of coordination contact."
      });

    expect(secondContactResponse.status).toBe(201);
    const createdSecondContact = secondContactResponse.body.contacts.find(
      (contact: { full_name: string }) => contact.full_name === `Morgan Stark ${testStamp}`
    );
    expect(createdSecondContact).toBeTruthy();
    secondaryContactId = createdSecondContact.id;

    const locationResponse = await request(app)
      .post(`/api/organizations/${organizationId}/locations`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        location_name: `South Gym ${testStamp}`,
        address_line_1: "123 School Street",
        city: "White Bear Lake",
        state: "MN",
        zip: "55110",
        maps_label: `South Gym ${testStamp}`,
        notes: "Use the south loading door and hold overflow cases near the athletics office."
      });

    expect(locationResponse.status).toBe(201);
    const createdLocation = locationResponse.body.locations.find(
      (location: { location_name: string }) => location.location_name === `South Gym ${testStamp}`
    );
    expect(createdLocation).toBeTruthy();
    locationId = createdLocation.id;
  });

  it("supports the canonical school profile, contact category, rules, and activity timeline flows", async () => {
    const initialDetail = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(initialDetail.status).toBe(200);
    expect(initialDetail.body.school_profile).toEqual(
      expect.objectContaining({
        organization_id: organizationId
      })
    );
    expect(Array.isArray(initialDetail.body.school_rules)).toBe(true);
    expect(Array.isArray(initialDetail.body.school_activity)).toBe(true);

    const profileUpdate = await request(app)
      .patch(`/api/organizations/${organizationId}/school-profile`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        district_name: "White Bear Lake Area Schools",
        school_type: "High School",
        school_year_label: "2026-2027",
        primary_internal_owner_user_id: schoolsOfficeUserId,
        backup_internal_owner_user_id: officeUserId,
        relationship_health_state: "needs_attention",
        relationship_summary: "Roster turnaround still needs closer attention before the next spring run.",
        primary_location_id: locationId,
        tags: ["yearbook", "graduation"],
        notes: "Confirm front-office packet delivery before every spring volume day."
      });

    expect(profileUpdate.status).toBe(200);
    expect(profileUpdate.body.school_profile).toEqual(
      expect.objectContaining({
        district_name: "White Bear Lake Area Schools",
        school_type: "High School",
        school_year_label: "2026-2027",
        relationship_health_state: "needs_attention",
        primary_location_id: locationId,
        tags: ["yearbook", "graduation"]
      })
    );

    const categoriesUpdate = await request(app)
      .patch(`/api/organizations/${organizationId}/contacts/${contactId}/school-categories`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        school_contact_categories: ["principal", "photo_day_contact", "yearbook_contact"]
      });

    expect(categoriesUpdate.status).toBe(200);
    const schoolContactDetail = await request(app)
      .get(`/api/organizations/contacts/${contactId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(schoolContactDetail.status).toBe(200);
    expect(schoolContactDetail.body.contact.school_contact_categories).toEqual(
      expect.arrayContaining(["principal", "photo_day_contact", "yearbook_contact"])
    );

    const createRule = await request(app)
      .post(`/api/organizations/${organizationId}/school-rules`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        rule_type: "subject_directory_requirements",
        title: "Subject directory delivery",
        summary: "Deliver subject directories grouped by homeroom with the yearbook packet.",
        structured_value: {
          grouping: "Homeroom",
          copies: "3",
          delivery_owner: "Yearbook adviser"
        },
        sort_order: 10
      });

    expect(createRule.status).toBe(201);
    const createdRule = createRule.body.school_rules.find(
      (rule: { title: string; rule_type: string }) =>
        rule.title === "Subject directory delivery" && rule.rule_type === "subject_directory_requirements"
    );
    expect(createdRule).toBeTruthy();

    const updateRule = await request(app)
      .patch(`/api/organizations/${organizationId}/school-rules/${createdRule.id}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        summary: "Deliver subject directories grouped by advisory with updated counts for yearbook assembly.",
        structured_value: {
          grouping: "Advisory",
          copies: "4",
          delivery_owner: "Yearbook adviser"
        }
      });

    expect(updateRule.status).toBe(200);
    expect(
      updateRule.body.school_rules.some(
        (rule: { id: string; structured_value: { grouping?: string; copies?: string }; summary: string | null }) =>
          rule.id === createdRule.id &&
          rule.summary === "Deliver subject directories grouped by advisory with updated counts for yearbook assembly." &&
          rule.structured_value.grouping === "Advisory" &&
          rule.structured_value.copies === "4"
      )
    ).toBe(true);

    const addNote = await request(app)
      .post(`/api/organizations/${organizationId}/school-notes`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        summary: "Graduation packet timing changed",
        detail: "The office now wants graduation admin packets delivered two weeks earlier."
      });

    expect(addNote.status).toBe(201);
    expect(
      addNote.body.school_activity.some(
        (entry: { activity_type: string; summary: string }) =>
          entry.activity_type === "note_added" && entry.summary === "Graduation packet timing changed"
      )
    ).toBe(true);

    const finalDetail = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(finalDetail.status).toBe(200);
    expect(finalDetail.body.school_profile).toEqual(
      expect.objectContaining({
        district_name: "White Bear Lake Area Schools",
        school_year_label: "2026-2027",
        primary_location_id: locationId
      })
    );
    expect(
      finalDetail.body.school_rules.some(
        (rule: { id: string; structured_value: { grouping?: string }; summary: string | null }) =>
          rule.id === createdRule.id &&
          rule.summary === "Deliver subject directories grouped by advisory with updated counts for yearbook assembly." &&
          rule.structured_value.grouping === "Advisory"
      )
    ).toBe(true);
    expect(
      finalDetail.body.school_activity.some(
        (entry: { activity_type: string; summary: string }) =>
          entry.activity_type === "note_added" && entry.summary === "Graduation packet timing changed"
      )
    ).toBe(true);
    expect(
      finalDetail.body.contacts.some(
        (contact: { id: string; school_contact_categories?: string[] }) =>
          contact.id === contactId &&
          Array.isArray(contact.school_contact_categories) &&
          contact.school_contact_categories.includes("principal") &&
          contact.school_contact_categories.includes("yearbook_contact")
      )
    ).toBe(true);
  });

  it("keeps school rules, notes, and school contact edits with the schools team", async () => {
    const deniedProfile = await request(app)
      .patch(`/api/organizations/${organizationId}/school-profile`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        relationship_summary: "Should not be able to update the school foundation."
      });

    const deniedCategories = await request(app)
      .patch(`/api/organizations/${organizationId}/contacts/${contactId}/school-categories`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        school_contact_categories: ["principal"]
      });

    const deniedRule = await request(app)
      .post(`/api/organizations/${organizationId}/school-rules`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        rule_type: "hat_policy",
        title: "Should fail"
      });

    const deniedNote = await request(app)
      .post(`/api/organizations/${organizationId}/school-notes`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        summary: "Should fail"
      });

    const deniedContactEdit = await request(app)
      .patch(`/api/organizations/contacts/${contactId}`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        title: "Unauthorized school contact edit"
      });

    const deniedArchive = await request(app)
      .post(`/api/organizations/contacts/${secondaryContactId}/archive`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({});

    const deniedReactivate = await request(app)
      .post(`/api/organizations/contacts/${secondaryContactId}/reactivate`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    const deniedAttach = await request(app)
      .post(`/api/organizations/${organizationId}/contact-links`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        contact_id: contactId,
        relationship_role: "planning",
        is_primary: false
      });

    expect(deniedProfile.status).toBe(403);
    expect(deniedCategories.status).toBe(403);
    expect(deniedRule.status).toBe(403);
    expect(deniedNote.status).toBe(403);
    expect(deniedContactEdit.status).toBe(403);
    expect(deniedArchive.status).toBe(403);
    expect(deniedReactivate.status).toBe(403);
    expect(deniedAttach.status).toBe(403);
  });

  it("supports edit flows and safe archive/reactivate lifecycle actions", async () => {
    const organizationResponse = await request(app)
      .patch(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        display_name: `White Bear Lake High School Ops ${testStamp}`,
        logo_url: `https://example.test/wbl-ops-${testStamp}.png`,
        aliases: [`WBL Ops ${testStamp}`],
        notes: "Updated org notes for operational routing."
      });

    expect(organizationResponse.status).toBe(200);
    expect(organizationResponse.body.organization.display_name).toBe(`White Bear Lake High School Ops ${testStamp}`);
    expect(organizationResponse.body.organization.logo_url).toBe(`https://example.test/wbl-ops-${testStamp}.png`);
    expect(organizationResponse.body.organization.aliases).toEqual([`WBL Ops ${testStamp}`]);

    const contactUpdate = await request(app)
      .patch(`/api/organizations/contacts/${contactId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        title: "Senior Activities Director",
        phone: "555-0210",
        notes: "Updated contact notes for production planning."
      });

    expect(contactUpdate.status).toBe(200);
    const updatedContact = contactUpdate.body.contacts.find((contact: { id: string }) => contact.id === contactId);
    expect(updatedContact.title).toBe("Senior Activities Director");
    expect(updatedContact.phone).toBe("555-0210");

    const contactArchive = await request(app)
      .post(`/api/organizations/contacts/${secondaryContactId}/archive`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({});

    expect(contactArchive.status).toBe(200);
    const archivedContact = contactArchive.body.contacts.find((contact: { id: string }) => contact.id === secondaryContactId);
    expect(archivedContact.active_status).toBe("inactive");

    const contactReactivate = await request(app)
      .post(`/api/organizations/contacts/${secondaryContactId}/reactivate`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({});

    expect(contactReactivate.status).toBe(200);
    const reactivatedContact = contactReactivate.body.contacts.find((contact: { id: string }) => contact.id === secondaryContactId);
    expect(reactivatedContact.active_status).toBe("active");

    const locationUpdate = await request(app)
      .patch(`/api/organizations/locations/${locationId}`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        location_name: `South Gym Annex ${testStamp}`,
        address_line_1: "456 School Street",
        maps_label: `South Annex ${testStamp}`,
        notes: "Use the annex doors and stage cases by the athletics office."
      });

    expect(locationUpdate.status).toBe(200);
    const updatedLocation = locationUpdate.body.locations.find((location: { id: string }) => location.id === locationId);
    expect(updatedLocation.location_name).toBe(`South Gym Annex ${testStamp}`);
    expect(updatedLocation.address_display).toContain("456 School Street");

    const locationArchive = await request(app)
      .post(`/api/organizations/locations/${locationId}/archive`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    expect(locationArchive.status).toBe(200);
    const archivedLocation = locationArchive.body.locations.find((location: { id: string }) => location.id === locationId);
    expect(archivedLocation.active_status).toBe("inactive");

    const locationReactivate = await request(app)
      .post(`/api/organizations/locations/${locationId}/reactivate`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});

    expect(locationReactivate.status).toBe(200);
    const reactivatedLocation = locationReactivate.body.locations.find((location: { id: string }) => location.id === locationId);
    expect(reactivatedLocation.active_status).toBe("active");
  });

  it("supports relationship metadata across organizations and locations", async () => {
    const attachToOrganization = await request(app)
      .post(`/api/organizations/${secondaryOrganizationId}/contact-links`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        contact_id: contactId,
        relationship_role: "billing",
        is_primary: true
      });

    expect(attachToOrganization.status).toBe(200);
    expect(
      attachToOrganization.body.contacts.some(
        (contact: { id: string; relationship_role: string; is_primary: boolean; canonical_organization_id: string }) =>
          contact.id === contactId &&
          contact.relationship_role === "billing" &&
          contact.is_primary === true &&
          contact.canonical_organization_id === organizationId
      )
    ).toBe(true);

    const attachHistoricalRelationship = await request(app)
      .post(`/api/organizations/${secondaryOrganizationId}/contact-links`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        contact_id: contactId,
        relationship_role: "planning",
        is_primary: false,
        start_date: "2024-01-15",
        end_date: "2024-10-30",
        is_current: false
      });

    expect(attachHistoricalRelationship.status).toBe(200);

    const attachToLocation = await request(app)
      .post(`/api/organizations/locations/${locationId}/contacts`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        contact_id: secondaryContactId,
        relationship_role: "day_of",
        is_primary: true
      });

    expect(attachToLocation.status).toBe(200);
    const attachedLocation = attachToLocation.body.locations.find((location: { id: string }) => location.id === locationId);
    expect(attachedLocation.contact_links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contact_id: secondaryContactId,
          relationship_role: "day_of",
          is_primary: true
        })
      ])
    );

    const detachFromLocation = await request(app)
      .delete(`/api/organizations/locations/${locationId}/contacts/${secondaryContactId}`)
      .set("Authorization", `Bearer ${sportsToken}`);

    expect(detachFromLocation.status).toBe(200);
    const detachedLocation = detachFromLocation.body.locations.find((location: { id: string }) => location.id === locationId);
    expect(detachedLocation.contact_links).toEqual([]);

    const contactDetail = await request(app)
      .get(`/api/organizations/contacts/${contactId}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(contactDetail.status).toBe(200);
    expect(
      contactDetail.body.contact.relationship_history.some(
        (relationship: { organization_id: string; relationship_state: string; start_date: string; end_date: string }) =>
          relationship.organization_id === secondaryOrganizationId &&
          relationship.relationship_state === "previous" &&
          relationship.start_date === "2024-01-15" &&
          relationship.end_date === "2024-10-30"
      )
    ).toBe(true);
    expect(
      contactDetail.body.contact.relationship_history.some(
        (relationship: { organization_id: string; relationship_state: string }) =>
          relationship.organization_id === organizationId && relationship.relationship_state === "current"
      )
    ).toBe(true);
    expect(contactDetail.body.contact.primary_internal_owner?.user_id).toBe(schoolsOfficeUserId);
    expect(contactDetail.body.contact.backup_internal_owner?.user_id).toBe(officeUserId);
    expect(contactDetail.body.contact.ownership_state).toBe("shared");
    expect(contactDetail.body.contact.freshness_state).toBe("needs_review");
    expect(Array.isArray(contactDetail.body.contact.maintenance_signals)).toBe(true);
    expect(
      contactDetail.body.contact.maintenance_signals.some(
        (signal: { code: string; severity: string }) => signal.code === "contact_needs_review" && signal.severity === "critical"
      )
    ).toBe(true);
  });

  it("supports internal owner lookup and managed contact filters", async () => {
    const ownersResponse = await request(app)
      .get("/api/organizations/internal-owners")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(ownersResponse.status).toBe(200);
    expect(
      ownersResponse.body.owners.some((owner: { user_id: string; email: string | null }) => owner.user_id === schoolsOfficeUserId)
    ).toBe(true);

    const filteredContacts = await request(app)
      .get(
        `/api/organizations/contacts?contact_status=needs_review&needs_review=true&primary_internal_owner_user_id=${schoolsOfficeUserId}&my_contacts_only=true`
      )
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(filteredContacts.status).toBe(200);
    expect(
      filteredContacts.body.contacts.some(
        (contact: {
          id: string;
          freshness_state: string;
          ownership_state: string;
          primary_internal_owner?: { user_id: string };
        }) =>
          contact.id === contactId &&
          contact.freshness_state === "needs_review" &&
          contact.ownership_state === "shared" &&
          contact.primary_internal_owner?.user_id === schoolsOfficeUserId
      )
    ).toBe(true);

    const deniedOwnersResponse = await request(app)
      .get("/api/organizations/internal-owners")
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(deniedOwnersResponse.status).toBe(403);
  });

  it("supports duplicate review scaffolding without executing a merge", async () => {
    const createReview = await request(app)
      .post("/api/organizations/duplicate-reviews")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        primary_contact_id: contactId,
        suspected_duplicate_contact_id: secondaryContactId,
        summary: "Potential duplicate planning contacts from manual imports.",
        notes: "Review before consolidating historical contact threads."
      });

    expect(createReview.status).toBe(201);
    expect(createReview.body.status).toBe("open");
    expect(createReview.body.decision).toBe("pending");
    duplicateReviewId = createReview.body.id;

    const listReviews = await request(app)
      .get("/api/organizations/duplicate-reviews")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(listReviews.status).toBe(200);
    expect(listReviews.body.reviews.some((review: { id: string }) => review.id === duplicateReviewId)).toBe(true);

    const updateReview = await request(app)
      .patch(`/api/organizations/duplicate-reviews/${duplicateReviewId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        decision: "merge_candidate",
        notes: "Keep in review queue until historical shoot links are inspected."
      });

    expect(updateReview.status).toBe(200);
    expect(updateReview.body.decision).toBe("merge_candidate");
    expect(updateReview.body.status).toBe("resolved");
  });

  it("supports shoot contact attach and detach workflows with relationship metadata", async () => {
    const createShootResponse = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        studio_id: studioId,
        organization_id: organizationId,
        location_id: locationId,
        primary_contact_id: contactId,
        additional_contact_ids: [],
        shoot_type: "schools_underclass_portraits",
        shoot_code: `DIR-${testStamp}`,
        title: "Directory Workflow Shoot",
        shoot_date: shootDate,
        geofence_radius_meters: 200,
        showtime: `${shootDate}T13:45:00.000Z`,
        arrival_time: `${shootDate}T14:00:00.000Z`,
        start_time: `${shootDate}T14:15:00.000Z`,
        end_time_est: `${shootDate}T15:15:00.000Z`,
        planned_staff_count: 2,
        required_lead_count: 1
      });

    expect(createShootResponse.status).toBe(201);
    shootId = createShootResponse.body.id;

    const attachSecondary = await request(app)
      .post(`/api/organizations/shoots/${shootId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        contact_id: secondaryContactId,
        relationship_role: "operations",
        is_primary: false
      });

    expect(attachSecondary.status).toBe(200);
    expect(
      attachSecondary.body.contact_links.some(
        (link: { contact_id: string; relationship_role: string; contact_role: string }) =>
          link.contact_id === secondaryContactId &&
          link.relationship_role === "operations" &&
          link.contact_role === "additional"
      )
    ).toBe(true);

    const promoteSecondary = await request(app)
      .post(`/api/organizations/shoots/${shootId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        contact_id: secondaryContactId,
        relationship_role: "day_of",
        is_primary: true
      });

    expect(promoteSecondary.status).toBe(200);
    expect(promoteSecondary.body.primary_contact_id).toBe(secondaryContactId);
    expect(
      promoteSecondary.body.contact_links.some(
        (link: { contact_id: string; is_primary: boolean; contact_role: string }) =>
          link.contact_id === secondaryContactId &&
          link.is_primary === true &&
          link.contact_role === "primary"
      )
    ).toBe(true);

    const detachOriginal = await request(app)
      .delete(`/api/organizations/shoots/${shootId}/contacts/${contactId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(detachOriginal.status).toBe(200);
    expect(detachOriginal.body.contact_links.every((link: { contact_id: string }) => link.contact_id !== contactId)).toBe(true);
  });

  it("supports touchpoint create and list workflows", async () => {
    const createTouchpoint = await request(app)
      .post(`/api/organizations/${organizationId}/touchpoints`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        contact_id: contactId,
        location_id: locationId,
        shoot_id: shootId,
        channel: "email",
        summary: "Confirmed arrival window and equipment staging plan.",
        outcome: "Location is ready and the client expects a 1:45 PM arrival.",
        follow_up_date: shootDate
      });

    expect(createTouchpoint.status).toBe(201);
    expect(createTouchpoint.body.channel).toBe("email");
    expect(createTouchpoint.body.contact_id).toBe(contactId);

    const organizationTouchpoints = await request(app)
      .get(`/api/organizations/${organizationId}/touchpoints`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(organizationTouchpoints.status).toBe(200);
    expect(
      organizationTouchpoints.body.touchpoints.some(
        (touchpoint: { summary: string; shoot_id: string }) =>
          touchpoint.summary === "Confirmed arrival window and equipment staging plan." &&
          touchpoint.shoot_id === shootId
      )
    ).toBe(true);

    const contactTouchpoints = await request(app)
      .get(`/api/organizations/contacts/${contactId}/touchpoints`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(contactTouchpoints.status).toBe(200);
    expect(contactTouchpoints.body.total).toBeGreaterThan(0);
  });

  it("returns relationship continuity across plans, communication logs, memory, and follow-ups", async () => {
    const createPlan = await request(app)
      .post(`/api/organizations/${organizationId}/touchpoint-plans`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        contact_id: contactId,
        location_id: locationId,
        linked_shoot_id: shootId,
        category: "pre_shoot_confirmation",
        title: "10-day readiness check",
        summary: "Confirm office access, arrival timing, and yearbook adviser handoff.",
        owner_user_id: schoolsOfficeUserId,
        backup_owner_user_id: officeUserId,
        due_at: `${shootDate}T15:00:00.000Z`
      });

    expect(createPlan.status).toBe(201);
    expect(createPlan.body.title).toBe("10-day readiness check");

    const createCommunication = await request(app)
      .post(`/api/organizations/${organizationId}/communications`)
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({
        contact_id: contactId,
        location_id: locationId,
        shoot_id: shootId,
        touchpoint_plan_id: createPlan.body.id,
        channel: "call",
        category: "pre_shoot_confirmation",
        subject: "Readiness call complete",
        summary: "Confirmed office access and the yearbook adviser handoff for shoot day.",
        outcome: "Customer prefers a quick arrival call before the crew unloads.",
        outcome_state: "confirmed",
        follow_up_date: shootDate,
        follow_up_needed: true,
        follow_up_owner_user_id: schoolsOfficeUserId,
        relationship_memory_suggested: true,
        memory_type: "day_of_coordination_preference",
        memory_summary: "Call the front office 15 minutes before arrival.",
        memory_why_it_matters: "The staff unlock the south entrance after that call and keep load-in smoother.",
        memory_visibility: "assignment_relevant"
      });

    expect(createCommunication.status).toBe(201);
    expect(createCommunication.body.subject).toBe("Readiness call complete");
    expect(createCommunication.body.touchpoint_plan_id).toBe(createPlan.body.id);

    const organizationContinuity = await request(app)
      .get(`/api/organizations/${organizationId}/continuity`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(organizationContinuity.status).toBe(200);
    expect(organizationContinuity.body.scope).toBe("organization");
    expect(organizationContinuity.body.summary).toEqual(
      expect.objectContaining({
        relationship_health_state: expect.any(String),
        last_communication_label: expect.any(String),
        open_follow_up_count: expect.any(Number),
        active_memory_count: expect.any(Number)
      })
    );
    expect(
      organizationContinuity.body.touchpoint_plans.some(
        (plan: { id: string; status: string }) => plan.id === createPlan.body.id && plan.status === "completed"
      )
    ).toBe(true);
    expect(
      organizationContinuity.body.communication_logs.some(
        (entry: { subject: string | null }) => entry.subject === "Readiness call complete"
      )
    ).toBe(true);
    expect(
      organizationContinuity.body.relationship_memory.some(
        (entry: { summary: string; status: string }) =>
          entry.summary === "Call the front office 15 minutes before arrival." && entry.status === "needs_review"
      )
    ).toBe(true);
    expect(
      organizationContinuity.body.follow_ups.some(
        (entry: { title: string; contact_id: string | null }) =>
          entry.title === "Readiness call complete" && entry.contact_id === contactId
      )
    ).toBe(true);

    const contactContinuity = await request(app)
      .get(`/api/organizations/contacts/${contactId}/continuity`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(contactContinuity.status).toBe(200);
    expect(contactContinuity.body.scope).toBe("contact");
    expect(contactContinuity.body.contact_id).toBe(contactId);
    expect(
      contactContinuity.body.communication_logs.every(
        (entry: { contact_id: string | null }) => entry.contact_id === contactId
      )
    ).toBe(true);
    expect(
      contactContinuity.body.follow_ups.every(
        (entry: { contact_id: string | null }) => entry.contact_id === contactId
      )
    ).toBe(true);
  });

  it("returns an operations hub projection for account workflow follow-up", async () => {
    const response = await request(app)
      .get(`/api/organizations/${organizationId}/operations-hub`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.organization_id).toBe(organizationId);
    expect(response.body.summary).toEqual(
      expect.objectContaining({
        last_touch_label: expect.any(String),
        next_action: expect.any(String),
        owner_label: expect.any(String),
        relationship_health_state: expect.any(String),
        relationship_health_summary: expect.any(String)
      })
    );
    expect(response.body.queues).toEqual(
      expect.objectContaining({
        contact_cleanup: expect.objectContaining({
          count: expect.any(Number),
          items: expect.any(Array)
        }),
        follow_up: expect.objectContaining({
          count: expect.any(Number),
          items: expect.any(Array)
        }),
        projects: expect.objectContaining({
          count: expect.any(Number),
          items: expect.any(Array)
        }),
        duplicate_review: expect.objectContaining({
          count: expect.any(Number),
          items: expect.any(Array)
        })
      })
    );
    expect(Array.isArray(response.body.timeline)).toBe(true);
    expect(
      response.body.timeline.some(
        (item: { kind: string; summary: string }) =>
          item.kind === "touchpoint" && item.summary === "Confirmed arrival window and equipment staging plan."
      )
    ).toBe(true);
    expect(
      response.body.timeline.every(
        (item: { action_hash?: string | null }) =>
          item.action_hash === null || item.action_hash === undefined || typeof item.action_hash === "string"
      )
    ).toBe(true);
  });

  it("allows all authenticated users to search and view Organizations, but not create them", async () => {
    const listResponse = await request(app)
      .get(`/api/organizations?search=${encodeURIComponent(`White Bear Lake High School Ops ${testStamp}`)}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.organizations.some((organization: { id: string }) => organization.id === organizationId)).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.organization.id).toBe(organizationId);
    expect(detailResponse.body.contacts.length).toBeGreaterThan(0);
    expect(detailResponse.body.locations.length).toBeGreaterThan(0);
    expect(Array.isArray(detailResponse.body.touchpoints)).toBe(true);
    expect(detailResponse.body.account_overview.contract_status).toBe("No Active Agreement");
    expect(detailResponse.body.account_overview.revenue_check_status).toBe("not_tracked");
    expect(Array.isArray(detailResponse.body.sales_opportunities)).toBe(true);
    expect(detailResponse.body.sales_pipeline_summary.schools_pipeline_count).toBe(0);
    expect(detailResponse.body.sales_pipeline_summary.sports_pipeline_count).toBe(0);
    expect(detailResponse.body.resource_library.summary.total_items).toBe(0);
    expect(Array.isArray(detailResponse.body.resource_library.media)).toBe(true);

    const contactsResponse = await request(app)
      .get(`/api/organizations/contacts?search=${encodeURIComponent(`Jamie Carlson ${testStamp}`)}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(contactsResponse.status).toBe(200);
    expect(
      contactsResponse.body.contacts.some(
        (contact: { full_name: string; organization_id: string; organization_display_name: string }) =>
          contact.full_name === `Jamie Carlson ${testStamp}` &&
          contact.organization_id === organizationId &&
          contact.organization_display_name.includes("White Bear Lake High School Ops")
      )
    ).toBe(true);

    const locationsResponse = await request(app)
      .get(`/api/organizations/locations?search=${encodeURIComponent(`South Gym Annex ${testStamp}`)}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(locationsResponse.status).toBe(200);
    expect(
      locationsResponse.body.locations.some(
        (location: { location_name: string; organization_id: string; maps_url: string | null }) =>
          location.location_name === `South Gym Annex ${testStamp}` &&
          location.organization_id === organizationId &&
          typeof location.maps_url === "string"
      )
    ).toBe(true);

    const deniedCreate = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        canonical_name: `Blocked Photographer Org ${testStamp}`,
        display_name: `Blocked Photographer Org ${testStamp}`,
        account_type: "events"
      });

    expect(deniedCreate.status).toBe(403);

    const deniedUpdate = await request(app)
      .patch(`/api/organizations/contacts/${contactId}`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        title: "Blocked Photographer Edit"
      });

    expect(deniedUpdate.status).toBe(403);
  });

  it("feeds canonical Contacts into shoot reference data", async () => {
    const response = await request(app)
      .get("/api/shoots/reference-data")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.contacts.some(
        (contact: { full_name?: string; name: string; source_kind: string }) =>
          contact.name === `Jamie Carlson ${testStamp}` && contact.source_kind === "organization_contact"
      )
    ).toBe(true);
  });

  it("surfaces seeded Resource Library history on canonical seeded Organizations", async () => {
    const seededDetail = await request(app)
      .get("/api/organizations?search=White%20Bear%20Lake%20High%20School")
      .set("Authorization", `Bearer ${schoolsToken}`);

    const seededOrganization = seededDetail.body.organizations.find(
      (organization: { display_name: string }) => organization.display_name === "White Bear Lake High School"
    );

    const response = await request(app)
      .get(`/api/organizations/${seededOrganization.id}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(response.status).toBe(200);
    expect(response.body.resource_library.summary.total_items).toBeGreaterThan(0);
    expect(response.body.account_overview).not.toBeNull();
    expect(response.body.resource_library.prep_highlights.some((item: { is_best_reference: boolean }) => item.is_best_reference)).toBe(true);
    expect(response.body.resource_library.recurring_location_intelligence).not.toBeNull();
    expect(
      response.body.resource_library.recurring_location_intelligence.best_reference.some(
        (item: { is_best_reference: boolean }) => item.is_best_reference
      )
    ).toBe(true);
    expect(Array.isArray(response.body.resource_library.recurring_location_intelligence.recurring_contacts)).toBe(true);
  });
});
