import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { elevateSession } from "./helpers.js";

const app = createApp();
let token = "";
let leadershipToken = "";
let studioId = "";
let createdShootId = "";
let seededBigShootId = "";
let organizationId = "";
let locationId = "";
let primaryContactId = "";
let secondaryContactId = "";
const shootCode = `CRUD-${Date.now()}`;
const shootDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

beforeAll(async () => {
  const login = await request(app).post("/auth/dev-login").send({ email: "admin@example.com" });
  token = login.body.token;
  const leadershipLogin = await request(app).post("/auth/dev-login").send({ email: "leadership@example.com" });
  leadershipToken = leadershipLogin.body.token;
  await elevateSession(app, leadershipToken);

  const studio = await pool.query(
    `
      SELECT st.id
      FROM studio st
      JOIN tenant t ON t.id = st.tenant_id
      WHERE t.name = 'Demo Studio' AND st.name = 'Main Studio'
      LIMIT 1
    `
  );
  studioId = studio.rows[0].id;
  seededBigShootId = (await pool.query("SELECT id FROM shoot WHERE shoot_code = 'DEMO-002' LIMIT 1")).rows[0].id;
  const canonicalDirectory = await pool.query(
    `
      SELECT
        o.id AS organization_id,
        sl.id AS location_id,
        primary_contact.id AS primary_contact_id,
        secondary_contact.id AS secondary_contact_id
      FROM organization o
      JOIN shoot_location sl
        ON sl.tenant_id = o.tenant_id
       AND sl.organization_id = o.id
      JOIN organization_contact primary_contact
        ON primary_contact.tenant_id = o.tenant_id
       AND primary_contact.organization_id = o.id
       AND primary_contact.full_name = 'Jamie Carlson'
      JOIN organization_contact secondary_contact
        ON secondary_contact.tenant_id = o.tenant_id
       AND secondary_contact.organization_id = o.id
       AND secondary_contact.full_name = 'Megan Stark'
      WHERE o.display_name = 'White Bear Lake High School'
        AND sl.name = 'Downtown Demo Park'
      LIMIT 1
    `
  );
  organizationId = canonicalDirectory.rows[0].organization_id;
  locationId = canonicalDirectory.rows[0].location_id;
  primaryContactId = canonicalDirectory.rows[0].primary_contact_id;
  secondaryContactId = canonicalDirectory.rows[0].secondary_contact_id;
});

describe("shoot CRUD endpoints", () => {
  it("creates a shoot", async () => {
    const response = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        studio_id: studioId,
        organization_id: organizationId,
        location_id: locationId,
        primary_contact_id: primaryContactId,
        additional_contact_ids: [secondaryContactId],
        shoot_type: "schools_underclass_portraits",
        shoot_code: shootCode,
        title: "CRUD Coverage Shoot",
        shoot_date: shootDate,
        geofence_radius_meters: 200,
        showtime: `${shootDate}T13:45:00.000Z`,
        arrival_time: `${shootDate}T14:00:00.000Z`,
        start_time: `${shootDate}T14:15:00.000Z`,
        end_time_est: `${shootDate}T15:15:00.000Z`,
        planned_staff_count: 2,
        required_lead_count: 1,
        operations_priority: "elevated",
        importance_override_tier: "big_shoot",
        importance_override_reason: "Leadership wants this shoot to stay visible during the first customer ramp.",
        special_instructions: "Use the north loading door.",
        special_equipment: "Portable backdrop"
      });

    expect(response.status).toBe(201);
    expect(response.body.shoot_code).toBe(shootCode);
    expect(response.body.shoot_category).toBe("schools");
    expect(response.body.organization_display_name).toBe("White Bear Lake High School");
    expect(response.body.primary_contact_name).toBe("Jamie Carlson");
    expect(response.body.big_shoot_manual_override).toBe(true);
    expect(response.body.importance_override_tier).toBe("big_shoot");
    expect(response.body.importance_override_reason).toBe(
      "Leadership wants this shoot to stay visible during the first customer ramp."
    );
    createdShootId = response.body.id;
  });

  it("retrieves the shoot by id", async () => {
    const response = await request(app)
      .get(`/api/shoots/${createdShootId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(createdShootId);
    expect(response.body.shoot_code).toBe(shootCode);
    expect(response.body.organization_display_name).toBe("White Bear Lake High School");
    expect(response.body.special_instructions).toBe("Use the north loading door.");
    expect(response.body.special_equipment).toBe("Portable backdrop");
    expect(response.body.resource_library.summary.total_items).toBeGreaterThan(0);
    expect(response.body.resource_library.summary.prep_highlight_count).toBeGreaterThan(0);
    expect(
      response.body.resource_library.historical_references.some(
        (item: { organization_display_name: string | null }) => item.organization_display_name === "White Bear Lake High School"
      )
    ).toBe(true);
    expect(Array.isArray(response.body.resource_library.media)).toBe(true);
    expect(response.body.resource_library.recurring_location_intelligence).not.toBeNull();
    expect(Array.isArray(response.body.resource_library.recurring_location_intelligence.recent_post_shoot_evaluations)).toBe(true);
  });

  it("returns computed priority and profitability signals for leadership-facing shoot records", async () => {
    const response = await request(app)
      .get(`/api/shoots/${seededBigShootId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.shoot_code).toBe("DEMO-002");
    expect(response.body.priority_label).toBe("big_shoot");
    expect(response.body.priority_label_display).toBe("Big Shoot");
    expect(response.body.importance_tier).toBe("big_shoot");
    expect(response.body.importance_tier_display).toBe("Big Shoot");
    expect(response.body.importance_score).toBeGreaterThanOrEqual(65);
    expect(response.body.big_shoot).toBe(true);
    expect(response.body.priority_reasons.some((reason: { label: string }) => reason.label === "Priority Account")).toBe(true);
    expect(response.body.future_profitability_flag).toBe("watch");
    expect(response.body.future_profitability_display).toBe("Watch");
  });

  it("lists shoots across a date range", async () => {
    const response = await request(app)
      .get(`/api/shoots?date_from=${shootDate}&date_to=${shootDate}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.some((shoot: { id: string; shoot_code: string }) => shoot.id === createdShootId && shoot.shoot_code === shootCode)).toBe(true);
  });

  it("updates the shoot", async () => {
    const response = await request(app)
      .patch(`/api/shoots/${createdShootId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "CRUD Coverage Shoot Updated",
        additional_contact_ids: [],
        day_of_notes: "Arrive through the north lot office."
      });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("CRUD Coverage Shoot Updated");
    expect(response.body.additional_contacts).toEqual([]);
    expect(response.body.day_of_notes).toBe("Arrive through the north lot office.");
  });

  it("returns reusable scheduling reference data", async () => {
    const response = await request(app)
      .get("/api/shoots/reference-data")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.contacts)).toBe(true);
    expect(
      response.body.contacts.some(
        (contact: { name: string; source_kind: string }) =>
          contact.name === "Jamie Carlson" && contact.source_kind === "organization_contact"
      )
    ).toBe(true);
  });

  it("soft deletes the shoot", async () => {
    const response = await request(app)
      .delete(`/api/shoots/${createdShootId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(true);

    const fetchDeleted = await request(app)
      .get(`/api/shoots/${createdShootId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(fetchDeleted.status).toBe(404);
  });
});
