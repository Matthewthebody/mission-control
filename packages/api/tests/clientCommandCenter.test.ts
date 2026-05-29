import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let pool: Pool;
let leadershipToken = "";
let testRun = "";

const createdOrganizationIds: string[] = [];
const createdContactIds: string[] = [];
const createdTaskIds: string[] = [];
const createdLocationIds: string[] = [];

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

async function createParentOrganization(name: string) {
  const response = await request(app)
    .post("/api/client-command-center/organizations")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      name,
      organization_type: "school_district",
      external_code: `ccc-test-${testRun}`,
      notes: `client command center test ${testRun}`
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const id = response.body.account.id as string;
  createdOrganizationIds.push(id);
  return id;
}

async function createAccount(parentOrganizationId: string, name: string) {
  const response = await request(app)
    .post("/api/client-command-center/accounts")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      organization_id: parentOrganizationId,
      name,
      account_type: "high_school",
      external_code: `ccc-test-${testRun}`,
      notes: `client command center test ${testRun}`
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const id = response.body.account.id as string;
  createdOrganizationIds.push(id);
  return id;
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool: dbPool } = await import("../src/db/pool.js");
  app = createApp();
  pool = dbPool;
  leadershipToken = await login("leadership@example.com");
  testRun = `run-${Date.now()}`;
}, 30_000);

afterAll(async () => {
  if (createdOrganizationIds.length || createdContactIds.length || createdTaskIds.length) {
    const serviceRows = await pool.query<{ id: string }>(
      "SELECT id::text FROM account_service WHERE account_id = ANY($1::uuid[])",
      [createdOrganizationIds]
    );
    const ownerRows = await pool.query<{ id: string }>(
      "SELECT id::text FROM client_internal_owner WHERE account_id = ANY($1::uuid[]) OR organization_id = ANY($1::uuid[])",
      [createdOrganizationIds]
    );
    const relationshipRows = await pool.query<{ id: string }>(
      "SELECT id::text FROM organization_contact_relationship WHERE organization_id = ANY($1::uuid[]) OR contact_id = ANY($2::uuid[])",
      [createdOrganizationIds, createdContactIds]
    );
    const touchpointRows = await pool.query<{ id: string }>(
      "SELECT id::text FROM directory_touchpoint WHERE organization_id = ANY($1::uuid[])",
      [createdOrganizationIds]
    );
    const testAggregateIds = [
      ...createdOrganizationIds,
      ...createdContactIds,
      ...createdTaskIds,
      ...createdLocationIds,
      ...serviceRows.rows.map((row) => row.id),
      ...ownerRows.rows.map((row) => row.id),
      ...relationshipRows.rows.map((row) => row.id),
      ...touchpointRows.rows.map((row) => row.id)
    ];
    await pool.query(
      "DELETE FROM app_event WHERE aggregate_id = ANY($1::uuid[])",
      [testAggregateIds]
    );
    await pool.query("DELETE FROM client_context_link WHERE task_id = ANY($1::uuid[]) OR account_id = ANY($2::uuid[]) OR contact_id = ANY($3::uuid[])", [
      createdTaskIds,
      createdOrganizationIds,
      createdContactIds
    ]);
    await pool.query("DELETE FROM work_task WHERE id = ANY($1::uuid[])", [createdTaskIds]);
    await pool.query("DELETE FROM directory_touchpoint WHERE organization_id = ANY($1::uuid[])", [createdOrganizationIds]);
    await pool.query("DELETE FROM location_reference_attachment WHERE location_id = ANY($1::uuid[])", [createdLocationIds]);
    await pool.query("DELETE FROM shoot_location WHERE id = ANY($1::uuid[])", [createdLocationIds]);
    await pool.query("DELETE FROM account_service WHERE account_id = ANY($1::uuid[])", [createdOrganizationIds]);
    await pool.query("DELETE FROM client_internal_owner WHERE account_id = ANY($1::uuid[]) OR organization_id = ANY($1::uuid[])", [createdOrganizationIds]);
    await pool.query("DELETE FROM organization_contact_relationship WHERE contact_id = ANY($1::uuid[])", [createdContactIds]);
    await pool.query("DELETE FROM organization_contact WHERE id = ANY($1::uuid[])", [createdContactIds]);
    await pool.query("DELETE FROM organization WHERE id = ANY($1::uuid[])", [createdOrganizationIds]);
  }
});

describe("Client Command Center V1", () => {
  it("uses the canonical directory tables for organizations, accounts, contacts, relationship roles, services, ownership, readiness, and tasks", async () => {
    const firstDistrictId = await createParentOrganization(`CCC Test District ${testRun} A`);
    const secondDistrictId = await createParentOrganization(`CCC Test District ${testRun} B`);
    const firstAccountId = await createAccount(firstDistrictId, `Shared High School ${testRun}`);
    const secondAccountId = await createAccount(secondDistrictId, `Shared High School ${testRun}`);

    expect(firstAccountId).not.toBe(secondAccountId);

    const locationResult = await pool.query<{ id: string }>(
      `
        INSERT INTO shoot_location (
          tenant_id,
          external_source,
          external_key,
          name,
          normalized_name,
          address,
          normalized_address,
          organization_id,
          address_line_1,
          city,
          state,
          zip,
          navigation_url,
          navigation_notes,
          location_type,
          parking_instructions,
          entrance_instructions,
          setup_area,
          power_availability_notes,
          wifi_cell_notes,
          client_facing_notes,
          employee_facing_notes,
          internal_only_notes,
          location_details
        )
        SELECT
          tenant_id,
          'client_command_center_test',
          $2,
          $3,
          lower($3),
          '100 Test Ave, Plymouth, MN 55446',
          '100 test ave plymouth mn 55446',
          id,
          '100 Test Ave',
          'Plymouth',
          'MN',
          '55446',
          NULL,
          'Use Door 1, not the activities entrance.',
          'main_building',
          'Visitor lot near Door 1.',
          'Check in at the main office.',
          'Commons by the media center.',
          'Bring a 25-foot extension cord.',
          'Guest Wi-Fi requires office approval.',
          'Client-safe: use Door 1 and check in at the office.',
          'Employee briefing: bring extension cord and arrive after bus drop-off.',
          'Internal-only: do not include the bus drop-off note in client prep.',
          'General reusable location notes.'
        FROM organization
        WHERE id = $1
        RETURNING id::text
      `,
      [firstAccountId, `ccc-location-${testRun}`, `CCC Location ${testRun}`]
    );
    const locationId = locationResult.rows[0].id;
    createdLocationIds.push(locationId);

    const manualLocationResult = await pool.query<{ id: string }>(
      `
        INSERT INTO shoot_location (
          tenant_id,
          external_source,
          external_key,
          name,
          normalized_name,
          address,
          normalized_address,
          organization_id,
          address_line_1,
          city,
          state,
          zip,
          navigation_url,
          location_type
        )
        SELECT
          tenant_id,
          'client_command_center_test',
          $2,
          $3,
          lower($3),
          '200 Manual Way, Plymouth, MN 55446',
          '200 manual way plymouth mn 55446',
          id,
          '200 Manual Way',
          'Plymouth',
          'MN',
          '55446',
          'https://maps.google.com/?q=manual-location-test',
          'main_building'
        FROM organization
        WHERE id = $1
        RETURNING id::text
      `,
      [firstAccountId, `ccc-manual-location-${testRun}`, `CCC Manual Maps Location ${testRun}`]
    );
    const manualLocationId = manualLocationResult.rows[0].id;
    createdLocationIds.push(manualLocationId);

    await pool.query(
      `
        INSERT INTO location_reference_attachment (
          tenant_id,
          location_id,
          title,
          description,
          attachment_type,
          audience,
          file_url,
          storage_key
        )
        SELECT tenant_id, $2::uuid, 'Door 1 Parking Map', 'Employee parking map reference.', 'parking_map'::location_reference_attachment_type, 'employee_facing'::location_reference_attachment_audience, 'https://example.com/parking-map.png', NULL
        FROM organization
        WHERE id = $1
        UNION ALL
        SELECT tenant_id, $2::uuid, 'Internal Commons Setup', 'Internal-only setup reminder.', 'setup_reference'::location_reference_attachment_type, 'internal_only'::location_reference_attachment_audience, NULL, 'demo/internal-setup.png'
        FROM organization
        WHERE id = $1
      `,
      [firstAccountId, locationId]
    );

    const duplicateSameParent = await request(app)
      .post("/api/client-command-center/accounts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        organization_id: firstDistrictId,
        name: `Shared High School ${testRun}`,
        account_type: "high_school"
      });
    expect(duplicateSameParent.status).toBe(409);

    const contactResponse = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: firstAccountId,
        first_name: "Alex",
        last_name: "Readiness",
        email: `alex.readiness.${testRun}@example.com`,
        phone: "555-0111",
        mobile_phone: "555-2111",
        office_phone: "555-3111",
        preferred_contact_method: "email",
        allow_sms: true,
        sms_consent_status: "opted_in",
        sms_consent_source: "test_fixture"
      });
    expect(contactResponse.status, JSON.stringify(contactResponse.body)).toBe(201);
    const contactId = contactResponse.body.id as string;
    createdContactIds.push(contactId);

    const duplicateContact = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: firstAccountId,
        first_name: "Alex",
        last_name: "Duplicate",
        email: `alex.readiness.${testRun}@example.com`
      });
    expect(duplicateContact.status).toBe(409);

    const relationshipResponse = await request(app)
      .post("/api/client-command-center/contact-relationships")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: firstAccountId,
        contact_id: contactId,
        roles: ["primary_contact", "principal", "picture_day_contact", "picture_day_prep_recipient", "yearbook_contact", "billing_contact", "emergency_day_of_contact"],
        is_primary: true
      });
    expect(relationshipResponse.status, JSON.stringify(relationshipResponse.body)).toBe(201);
    expect(relationshipResponse.body.contacts[0].client_roles).toEqual(
      expect.arrayContaining(["primary_contact", "principal", "picture_day_contact", "picture_day_prep_recipient", "yearbook_contact", "billing_contact", "emergency_day_of_contact"])
    );

    const doNotContactResponse = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: firstAccountId,
        first_name: "Drew",
        last_name: "DoNotContact",
        email: `drew.dnc.${testRun}@example.com`,
        mobile_phone: "555-2999",
        preferred_contact_method: "text",
        allow_email: true,
        allow_sms: true,
        do_not_contact: true,
        sms_consent_status: "opted_in"
      });
    expect(doNotContactResponse.status, JSON.stringify(doNotContactResponse.body)).toBe(201);
    const doNotContactId = doNotContactResponse.body.id as string;
    createdContactIds.push(doNotContactId);

    const doNotContactRelationship = await request(app)
      .post("/api/client-command-center/contact-relationships")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: firstAccountId,
        contact_id: doNotContactId,
        roles: ["picture_day_prep_recipient"]
      });
    expect(doNotContactRelationship.status, JSON.stringify(doNotContactRelationship.body)).toBe(201);

    const serviceResponse = await request(app)
      .post(`/api/client-command-center/accounts/${firstAccountId}/services`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ service_type: "yearbook", status: "active" });
    expect(serviceResponse.status, JSON.stringify(serviceResponse.body)).toBe(201);

    const { rows: leadershipUsers } = await pool.query<{ id: string }>(
      "SELECT id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1"
    );
    const ownerUserId = leadershipUsers[0].id;
    const ownerResponse = await request(app)
      .post("/api/client-command-center/owners")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: firstAccountId,
        owner_user_id: ownerUserId,
        owner_type: "studio_bestie"
      });
    expect(ownerResponse.status, JSON.stringify(ownerResponse.body)).toBe(201);

    const taskResponse = await request(app)
      .post(`/api/client-command-center/accounts/${firstAccountId}/tasks`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        title: `Client-aware follow-up ${testRun}`,
        contact_id: contactId,
        assigned_to_user_id: ownerUserId,
        service_type: "yearbook",
        communication_type: "yearbook_deadline"
      });
    expect(taskResponse.status, JSON.stringify(taskResponse.body)).toBe(201);
    const task = taskResponse.body.open_tasks.find((entry: any) => entry.title === `Client-aware follow-up ${testRun}`);
    expect(task).toBeTruthy();
    createdTaskIds.push(task.id);

    const detailResponse = await request(app)
      .get(`/api/client-command-center/accounts/${firstAccountId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(detailResponse.status, JSON.stringify(detailResponse.body)).toBe(200);
    expect(detailResponse.body.parent_organization.name).toBe(`CCC Test District ${testRun} A`);
    expect(detailResponse.body.locations).toHaveLength(2);
    const generatedMapLocation = detailResponse.body.locations.find((location: any) => location.id === locationId);
    expect(generatedMapLocation).toMatchObject({
      id: locationId,
      location_name: `CCC Location ${testRun}`,
      location_type: "main_building",
      address_line_1: "100 Test Ave",
      address_display: "100 Test Ave, Plymouth, MN 55446",
      navigation_notes: "Use Door 1, not the activities entrance.",
      parking_instructions: "Visitor lot near Door 1.",
      entrance_instructions: "Check in at the main office.",
      setup_area: "Commons by the media center.",
      client_facing_notes: "Client-safe: use Door 1 and check in at the office.",
      employee_facing_notes: "Employee briefing: bring extension cord and arrive after bus drop-off.",
      internal_only_notes: "Internal-only: do not include the bus drop-off note in client prep."
    });
    expect(generatedMapLocation.google_maps_url).toContain("https://www.google.com/maps/search/?api=1&query=");
    expect(decodeURIComponent(generatedMapLocation.google_maps_url)).toContain(`CCC Location ${testRun}`);
    expect(generatedMapLocation.reference_attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Door 1 Parking Map", attachment_type: "parking_map", audience: "employee_facing", file_url: "https://example.com/parking-map.png" }),
        expect.objectContaining({ title: "Internal Commons Setup", attachment_type: "setup_reference", audience: "internal_only", storage_key: "demo/internal-setup.png" })
      ])
    );
    const manualMapLocation = detailResponse.body.locations.find((location: any) => location.id === manualLocationId);
    expect(manualMapLocation.google_maps_url).toBe("https://maps.google.com/?q=manual-location-test");
    expect(detailResponse.body.readiness.status).toBe("ready");
    const readinessContact = detailResponse.body.contacts.find((contact: any) => contact.id === contactId);
    expect(readinessContact).toMatchObject({
      office_phone: "555-3111",
      mobile_phone: "555-2111",
      allow_email: true,
      allow_sms: true,
      allow_phone: true,
      do_not_contact: false,
      sms_consent_status: "opted_in",
      sms_consent_source: "test_fixture",
      prep_email_eligible: true,
      prep_email_exclusion_reason: null,
      prep_sms_eligible: true,
      prep_sms_exclusion_reason: null
    });
    const excludedContact = detailResponse.body.contacts.find((contact: any) => contact.id === doNotContactId);
    expect(excludedContact).toMatchObject({
      do_not_contact: true,
      prep_email_eligible: false,
      prep_email_exclusion_reason: "Do not contact is enabled.",
      prep_sms_eligible: false,
      prep_sms_exclusion_reason: "Do not contact is enabled."
    });
    expect(detailResponse.body.readiness.checks).toContainEqual(
      expect.objectContaining({
        code: "has_yearbook_contact",
        passed: true,
        detail: "Yearbook service has a deadline/reminder contact."
      })
    );
    expect(detailResponse.body.services.map((service: any) => service.service_type)).toContain("yearbook");
    expect(detailResponse.body.owners.map((owner: any) => owner.owner_type)).toContain("studio_bestie");

    const taskContext = await pool.query<{ organization_id: string; contact_id: string; communication_type: string; service_type: string }>(
      `
        SELECT organization_id::text, contact_id::text, communication_type::text, service_type::text
        FROM work_task
        WHERE id = $1
      `,
      [task.id]
    );
    expect(taskContext.rows[0]).toMatchObject({
      organization_id: firstAccountId,
      contact_id: contactId,
      communication_type: "yearbook_deadline",
      service_type: "yearbook"
    });

    const eventRows = await pool.query<{ payload: any }>(
      `
        SELECT payload
        FROM app_event
        WHERE aggregate_id = $1
          AND event_type = 'client.task_created'
        LIMIT 1
      `,
      [task.id]
    );
    expect(eventRows.rows[0]?.payload.provider_targets_supported).toEqual(["in_app", "email", "teams", "outlook"]);
  });

  it("denies Client Command Center writes without backend authorization", async () => {
    const staffToken = await login("associate@example.com");
    const response = await request(app)
      .post("/api/client-command-center/organizations")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        name: `Unauthorized CCC Test ${testRun}`,
        organization_type: "company"
      });
    expect(response.status).toBe(403);
  });
});
